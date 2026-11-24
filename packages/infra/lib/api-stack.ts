import { join } from "node:path";
import { ADMIN_ROUTES, DEVICE_ROUTES, MCP_ROUTES, OAUTH_ROUTES } from "@kids-dash/api/routes";
import {
  CfnOutput,
  DockerImage,
  Duration,
  RemovalPolicy,
  SecretValue,
  Size,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import * as authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cognito from "aws-cdk-lib/aws-cognito";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as awsIam from "aws-cdk-lib/aws-iam";
import type * as kms from "aws-cdk-lib/aws-kms";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import type * as s3 from "aws-cdk-lib/aws-s3";
import type * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as sns from "aws-cdk-lib/aws-sns";
import type { Construct } from "constructs";

const REPO_ROOT = join(import.meta.dirname, "../../..");
const HANDLERS = join(REPO_ROOT, "packages/api/src/handlers");
const FFMPEG = join(import.meta.dirname, "ffmpeg");

export const SYNC_INTERVAL = Duration.minutes(15);
export const AUTHORIZER_CACHE = Duration.minutes(5);
/** How often the watch looks for frames that stopped checking in. */
export const WATCH_INTERVAL = Duration.minutes(10);
/** The role (Cognito group) an account needs to use the hosted MCP. */
export const MCP_GROUP = "dashboard";

export interface ApiStackProps extends StackProps {
  stage: string;
  table: dynamodb.ITableV2;
  photos: s3.IBucket;
  signingKey: kms.IKey;
  googleSecret: secretsmanager.ISecret;
}

export class ApiStack extends Stack {
  readonly api: apigw.HttpApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const environment = {
      TABLE_NAME: props.table.tableName,
      PHOTOS_BUCKET: props.photos.bucketName,
      SIGNING_KEY_ARN: props.signingKey.keyArn,
      GOOGLE_SECRET_ARN: props.googleSecret.secretArn,
      NODE_OPTIONS: "--enable-source-maps",
    };
    const fn = (
      name: string,
      entry: string,
      timeout = Duration.seconds(10),
      memorySize = 512,
      extra: Partial<nodejs.NodejsFunctionProps> = {},
    ) =>
      new nodejs.NodejsFunction(this, name, {
        ...extra,
        entry: join(HANDLERS, entry),
        runtime: lambda.Runtime.NODEJS_24_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize,
        timeout,
        environment,
        projectRoot: REPO_ROOT,
        depsLockFilePath: join(REPO_ROOT, "pnpm-lock.yaml"),
        bundling: { minify: true, sourceMap: true, target: "node24" },
        logGroup: new logs.LogGroup(this, `${name}Logs`, {
          retention: logs.RetentionDays.ONE_MONTH,
        }),
      });

    // Adding an event from a frame writes to Google, then re-syncs the calendar.
    const device = fn("DeviceFunction", "device.ts", Duration.seconds(30));
    const admin = fn("AdminFunction", "admin.ts", Duration.seconds(30));
    const authorizer = fn("AuthorizerFunction", "authorizer.ts");
    const sync = fn("SyncFunction", "sync.ts", Duration.minutes(5), 1024);
    const mcp = fn("McpFunction", "mcp.ts", Duration.seconds(60));
    // OAuth discovery and client registration for the hosted MCP.
    const oauth = fn("OAuthFunction", "oauth.ts", Duration.seconds(10), 256);

    // Frame alerts. Email subscriptions are added by hand (docs/operations.md),
    // so no address is in the code; SNS asks each one to confirm.
    const alerts = new sns.Topic(this, "FrameAlerts", { displayName: "Kids dashboard" });
    const watch = fn("WatchFunction", "watch.ts", Duration.seconds(30), 256);
    watch.addEnvironment("ALERT_TOPIC_ARN", alerts.topicArn);
    props.table.grantReadWriteData(watch);
    alerts.grantPublish(watch);

    // Least privilege per function: the device path can read state, record
    // check-offs, sign, and add calendar events (Google secret, then a calendar
    // snapshot refresh in the table); it cannot write photos.
    props.table.grantReadWriteData(device);
    props.signingKey.grant(device, "kms:Sign");
    props.photos.grantRead(device);
    props.googleSecret.grantRead(device);

    props.table.grantReadWriteData(authorizer);

    props.table.grantReadWriteData(admin);
    props.signingKey.grant(admin, "kms:Sign", "kms:GetPublicKey");
    props.photos.grantReadWrite(admin);
    props.photos.grantDelete(admin);
    props.googleSecret.grantRead(admin);

    props.table.grantReadWriteData(sync);
    props.googleSecret.grantRead(sync);
    props.photos.grantReadWrite(sync, "slides/*");
    props.photos.grantDelete(sync, "slides/*");

    // Slideshow videos are converted for the frame (1080p SDR H.264) by ffmpeg
    // in their own function: minutes of CPU each, started by whichever sync
    // finds one and left to run. ffmpeg is a static arm64 build (lib/ffmpeg),
    // built by Docker at synth into a layer at /opt/bin/ffmpeg.
    const ffmpeg = new lambda.LayerVersion(this, "Ffmpeg", {
      description: "Static ffmpeg 7.1 (arm64) at /opt/bin/ffmpeg",
      compatibleArchitectures: [lambda.Architecture.ARM_64],
      code: lambda.Code.fromAsset(FFMPEG, {
        bundling: {
          image: DockerImage.fromBuild(FFMPEG),
          command: [
            "sh",
            "-c",
            "mkdir -p /asset-output/bin && cp /usr/local/bin/ffmpeg /asset-output/bin/",
          ],
        },
      }),
    });
    // 6 GB buys about 3.5 vCPUs; the original and the result sit in /tmp.
    const convertVideo = fn(
      "ConvertVideoFunction",
      "convert-video.ts",
      Duration.minutes(15),
      6144,
      {
        layers: [ffmpeg],
        ephemeralStorageSize: Size.gibibytes(4),
      },
    );
    // A failure is recorded and the sync retries it later; Lambda need not.
    convertVideo.configureAsyncInvoke({ retryAttempts: 0 });
    props.table.grantReadWriteData(convertVideo);
    props.googleSecret.grantRead(convertVideo);
    props.photos.grantPut(convertVideo, "slides/*");

    // Agents get the admin use cases minus credentials and signing: settings
    // changes may delete a removed kid's photo, and sync_now reads Google.
    props.table.grantReadWriteData(mcp);
    props.photos.grantRead(mcp);
    props.photos.grantDelete(mcp);
    props.googleSecret.grantRead(mcp);

    // Every function that can run the slideshow sync may start a conversion.
    for (const starter of [sync, admin, mcp]) {
      convertVideo.grantInvoke(starter);
      starter.addEnvironment("VIDEO_CONVERTER_FUNCTION", convertVideo.functionName);
    }

    this.api = new apigw.HttpApi(this, "HttpApi", {
      description: `kids-dash ${props.stage}`,
      createDefaultStage: false,
    });
    new apigw.HttpStage(this, "DefaultStage", {
      httpApi: this.api,
      stageName: "$default",
      autoDeploy: true,
      // A family's traffic is a frame polling every minute or two.
      throttle: { rateLimit: 20, burstLimit: 40 },
    });

    const deviceAuthorizer = new authorizers.HttpLambdaAuthorizer("DeviceToken", authorizer, {
      responseTypes: [authorizers.HttpLambdaResponseType.SIMPLE],
      identitySource: ["$request.header.Authorization"],
      resultsCacheTtl: AUTHORIZER_CACHE,
    });
    const deviceIntegration = new integrations.HttpLambdaIntegration("Device", device);
    for (const route of DEVICE_ROUTES) {
      this.addRoute(route, deviceIntegration, deviceAuthorizer);
    }

    // People sign in here for the hosted MCP (Claude's connectors speak only
    // OAuth), with Google. Accounts are made by hand (docs/operations.md) and
    // only those in the MCP_GROUP role get access; a Google sign-in is let
    // through only for an existing account, which it is linked to (the
    // pre-sign-up trigger). No self sign-up; a password sign-in, if one were
    // ever enabled, needs an authenticator app. Clients are registered by the
    // API (POST /oauth/register), limited to Claude's callbacks.
    const users = new cognito.UserPool(this, "McpUsers", {
      userPoolName: `kids-dash-${props.stage}`,
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      mfa: cognito.Mfa.REQUIRED,
      mfaSecondFactor: { otp: true, sms: false },
      passwordPolicy: { minLength: 12 },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    // The trigger gets the pool from its event: granting on this pool's ARN
    // would make the pool and its own trigger depend on each other.
    const preSignUp = fn("PreSignUpFunction", "pre-sign-up.ts", Duration.seconds(10), 256);
    preSignUp.addToRolePolicy(
      new awsIam.PolicyStatement({
        actions: ["cognito-idp:ListUsers", "cognito-idp:AdminLinkProviderForUser"],
        resources: [`arn:aws:cognito-idp:${this.region}:${this.account}:userpool/*`],
      }),
    );
    users.addTrigger(cognito.UserPoolOperation.PRE_SIGN_UP, preSignUp);
    new cognito.CfnUserPoolGroup(this, "DashboardRole", {
      userPoolId: users.userPoolId,
      groupName: MCP_GROUP,
      description: "May use the kids dashboard MCP",
    });
    // A Google OAuth client made by hand in the GCP project; its ID and secret
    // live in this secret ({"clientId", "clientSecret"}), never in the code.
    const googleSecret = `kids-dash/${props.stage}/google-sign-in`;
    new cognito.UserPoolIdentityProviderGoogle(this, "Google", {
      userPool: users,
      clientId: SecretValue.secretsManager(googleSecret, { jsonField: "clientId" }).unsafeUnwrap(),
      clientSecretValue: SecretValue.secretsManager(googleSecret, { jsonField: "clientSecret" }),
      scopes: ["openid", "email", "profile"],
      attributeMapping: {
        email: cognito.ProviderAttribute.GOOGLE_EMAIL,
        emailVerified: cognito.ProviderAttribute.GOOGLE_EMAIL_VERIFIED,
      },
    });
    const login = users.addDomain("Login", {
      cognitoDomain: { domainPrefix: `kids-dash-${props.stage}-${this.account}` },
    });
    // The MCP endpoint is the resource server, so a client's `resource`
    // (RFC 8707) names something Cognito knows.
    const mcpResource = `${this.api.apiEndpoint}/mcp`;
    users.addResourceServer("McpResource", {
      // The name defaults to the identifier, which Cognito refuses in names.
      userPoolResourceServerName: "kids-dash-mcp",
      identifier: mcpResource,
      scopes: [
        new cognito.ResourceServerScope({
          scopeName: "dashboard",
          scopeDescription: "Read and change the kids' dashboard",
        }),
      ],
    });
    for (const f of [mcp, oauth]) {
      f.addEnvironment("USER_POOL_ID", users.userPoolId);
      f.addEnvironment("USER_POOL_LOGIN_URL", login.baseUrl());
      f.addEnvironment("MCP_SCOPE", `${mcpResource}/dashboard`);
      f.addEnvironment("MCP_GROUP", MCP_GROUP);
    }
    users.grant(oauth, "cognito-idp:ListUserPoolClients", "cognito-idp:CreateUserPoolClient");
    // Linked Google sign-ins get access tokens without `cognito:groups`, so the
    // MCP looks the caller's role up itself.
    users.grant(mcp, "cognito-idp:ListUsers", "cognito-idp:AdminListGroupsForUser");

    // The MCP handler authenticates callers itself (OAuth sign-ins only), so a
    // missing credential gets the MCP spec's 401 with a pointer to the OAuth
    // metadata, which an API Gateway authorizer cannot send.
    const mcpIntegration = new integrations.HttpLambdaIntegration("Mcp", mcp);
    for (const route of MCP_ROUTES) this.addRoute(route, mcpIntegration);
    const oauthIntegration = new integrations.HttpLambdaIntegration("OAuth", oauth);
    for (const route of OAUTH_ROUTES) this.addRoute(route, oauthIntegration);

    const iam = new authorizers.HttpIamAuthorizer();
    const adminIntegration = new integrations.HttpLambdaIntegration("Admin", admin);
    for (const route of ADMIN_ROUTES) {
      this.addRoute(route, adminIntegration, iam);
    }

    new events.Rule(this, "SyncSchedule", {
      description: "Refresh the calendar and weather snapshots",
      schedule: events.Schedule.rate(SYNC_INTERVAL),
      targets: [new targets.LambdaFunction(sync, { retryAttempts: 0 })],
    });

    new events.Rule(this, "WatchSchedule", {
      description: "Email when a frame goes offline or comes back",
      schedule: events.Schedule.rate(WATCH_INTERVAL),
      targets: [new targets.LambdaFunction(watch, { retryAttempts: 0 })],
    });

    new CfnOutput(this, "AlertTopicArn", { value: alerts.topicArn });
    new CfnOutput(this, "ApiUrl", { value: this.api.apiEndpoint });
    new CfnOutput(this, "McpUrl", { value: `${this.api.apiEndpoint}/mcp` });
    new CfnOutput(this, "AdminFunctionName", { value: admin.functionName });
    new CfnOutput(this, "McpUserPoolId", { value: users.userPoolId });
    new CfnOutput(this, "McpLoginUrl", { value: login.baseUrl() });
  }

  private addRoute(
    routeKey: string,
    integration: apigw.HttpRouteIntegration,
    authorizer?: apigw.IHttpRouteAuthorizer,
  ): void {
    const [method = "", path = ""] = routeKey.split(" ");
    new apigw.HttpRoute(this, `Route ${routeKey}`, {
      httpApi: this.api,
      routeKey: apigw.HttpRouteKey.with(path, method as apigw.HttpMethod),
      integration,
      ...(authorizer ? { authorizer } : {}),
    });
  }
}
