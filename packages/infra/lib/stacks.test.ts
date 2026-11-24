import { ADMIN_ROUTES, DEVICE_ROUTES, MCP_ROUTES, OAUTH_ROUTES } from "@kids-dash/api/routes";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, it } from "vitest";
import { ApiStack } from "./api-stack";
import { DataStack } from "./data-stack";
import { stackName } from "./naming";

let data: Template;
let api: Template;

beforeAll(() => {
  // No Docker or esbuild in unit tests: assets are staged from their sources.
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const env = { account: "123456789012", region: "us-east-1" };
  const dataStack = new DataStack(app, "Data", { env, stage: "test" });
  const apiStack = new ApiStack(app, "Api", {
    env,
    stage: "test",
    table: dataStack.table,
    photos: dataStack.photos,
    signingKey: dataStack.signingKey,
    googleSecret: dataStack.googleSecret,
  });
  data = Template.fromStack(dataStack);
  api = Template.fromStack(apiStack);
});

describe("DataStack", () => {
  it("keeps one retained, recoverable table with TTL", () => {
    data.resourceCountIs("AWS::DynamoDB::GlobalTable", 1);
    data.hasResource("AWS::DynamoDB::GlobalTable", {
      DeletionPolicy: "Retain",
      Properties: Match.objectLike({
        KeySchema: [
          { AttributeName: "pk", KeyType: "HASH" },
          { AttributeName: "sk", KeyType: "RANGE" },
        ],
        TimeToLiveSpecification: { AttributeName: "expiresAt", Enabled: true },
        Replicas: [
          Match.objectLike({
            DeletionProtectionEnabled: true,
            PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
          }),
        ],
      }),
    });
  });

  it("keeps photos private, encrypted and TLS-only", () => {
    data.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: Match.anyValue(),
    });
    data.hasResourceProperties("AWS::S3::BucketPolicy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: "Deny",
            Condition: { Bool: { "aws:SecureTransport": "false" } },
          }),
        ]),
      },
    });
  });

  it("signs with an asymmetric P-256 key that is retained", () => {
    data.hasResource("AWS::KMS::Key", {
      DeletionPolicy: "Retain",
      Properties: Match.objectLike({ KeySpec: "ECC_NIST_P256", KeyUsage: "SIGN_VERIFY" }),
    });
    data.hasResource("AWS::SecretsManager::Secret", { DeletionPolicy: "Retain" });
  });
});

describe("ApiStack", () => {
  it("creates exactly the routes the API declares, each with the right auth", () => {
    const routes = api.findResources("AWS::ApiGatewayV2::Route");
    const byKey = Object.fromEntries(
      Object.values(routes).map((r) => [r.Properties.RouteKey, r.Properties.AuthorizationType]),
    );
    expect(Object.keys(byKey).sort()).toEqual(
      [...DEVICE_ROUTES, ...ADMIN_ROUTES, ...MCP_ROUTES, ...OAUTH_ROUTES].sort(),
    );
    for (const route of DEVICE_ROUTES) expect(byKey[route]).toBe("CUSTOM");
    // The MCP handler authenticates itself; OAuth discovery and registration are public.
    for (const route of [...MCP_ROUTES, ...OAUTH_ROUTES]) expect(byKey[route]).toBe("NONE");
    for (const route of ADMIN_ROUTES) expect(byKey[route]).toBe("AWS_IAM");
  });

  it("has a sign-in pool for the hosted MCP: no self sign-up, MFA required, kept on delete", () => {
    api.hasResourceProperties("AWS::Cognito::UserPool", {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
      MfaConfiguration: "ON",
      EnabledMfas: ["SOFTWARE_TOKEN_MFA"],
      UserPoolTier: "ESSENTIALS",
    });
    api.hasResource("AWS::Cognito::UserPool", { DeletionPolicy: "Retain" });
    api.hasResourceProperties("AWS::Cognito::UserPoolResourceServer", {
      Name: "kids-dash-mcp",
      Scopes: [{ ScopeName: "dashboard", ScopeDescription: "Read and change the kids' dashboard" }],
    });
    api.hasResourceProperties("AWS::Lambda::Function", {
      Environment: { Variables: { USER_POOL_ID: Match.anyValue(), MCP_SCOPE: Match.anyValue() } },
    });
    // Google sign-in, from a hand-made secret; a role group; the trigger that
    // lets Google sign-ins through only for existing accounts.
    api.hasResourceProperties("AWS::Cognito::UserPoolIdentityProvider", {
      ProviderName: "Google",
      ProviderType: "Google",
      ProviderDetails: Match.objectLike({
        client_secret:
          "{{resolve:secretsmanager:kids-dash/test/google-sign-in:SecretString:clientSecret::}}",
        authorize_scopes: "openid email profile",
      }),
    });
    api.hasResourceProperties("AWS::Cognito::UserPoolGroup", { GroupName: "dashboard" });
    api.hasResourceProperties("AWS::Cognito::UserPool", {
      LambdaConfig: { PreSignUp: Match.anyValue() },
    });
    api.hasResourceProperties("AWS::Lambda::Function", {
      Environment: { Variables: Match.objectLike({ MCP_GROUP: "dashboard" }) },
    });
    // Only the OAuth function may register clients.
    api.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: ["cognito-idp:ListUserPoolClients", "cognito-idp:CreateUserPoolClient"],
          }),
        ]),
      },
    });
    // The MCP looks up the caller's role (linked sign-ins carry no groups claim).
    api.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: ["cognito-idp:ListUsers", "cognito-idp:AdminListGroupsForUser"],
          }),
        ]),
      },
    });
  });

  it("caches the device authorizer on the Authorization header", () => {
    api.hasResourceProperties("AWS::ApiGatewayV2::Authorizer", {
      AuthorizerType: "REQUEST",
      EnableSimpleResponses: true,
      IdentitySource: ["$request.header.Authorization"],
      AuthorizerResultTtlInSeconds: 300,
    });
  });

  it("throttles the stage", () => {
    api.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      StageName: "$default",
      DefaultRouteSettings: { ThrottlingRateLimit: 20, ThrottlingBurstLimit: 40 },
    });
  });

  it("runs nine arm64 Node 24 functions with bounded log retention", () => {
    const fns = api.findResources("AWS::Lambda::Function", {
      Properties: { Runtime: "nodejs24.x", Architectures: ["arm64"] },
    });
    expect(Object.keys(fns)).toHaveLength(9);
    api.resourcePropertiesCountIs("AWS::Logs::LogGroup", { RetentionInDays: 30 }, 9);
  });

  it("converts videos in their own function, with ffmpeg, started by the syncs", () => {
    const fns = api.findResources("AWS::Lambda::Function");
    const [id, convert] =
      Object.entries(fns).find(([name]) => name.startsWith("ConvertVideoFunction")) ?? [];
    expect(convert?.Properties).toMatchObject({
      Timeout: 900,
      MemorySize: 6144,
      EphemeralStorage: { Size: 4096 },
    });
    expect(convert?.Properties.Layers).toHaveLength(1);
    api.hasResourceProperties("AWS::Lambda::LayerVersion", { CompatibleArchitectures: ["arm64"] });
    api.hasResourceProperties("AWS::Lambda::EventInvokeConfig", { MaximumRetryAttempts: 0 });
    const starters = Object.entries(fns)
      .filter(([, f]) => f.Properties.Environment?.Variables?.VIDEO_CONVERTER_FUNCTION)
      .map(([name]) => name.replace(/[A-F0-9]{8}$/, ""));
    expect(starters.sort()).toEqual(["AdminFunction", "McpFunction", "SyncFunction"]);
    const invokers = Object.entries(api.findResources("AWS::IAM::Policy"))
      .filter(([, p]) => JSON.stringify(p).includes("lambda:InvokeFunction"))
      .filter(([, p]) => JSON.stringify(p).includes(id ?? "?"))
      .map(([name]) => name.replace(/ServiceRoleDefaultPolicy.*$/, ""));
    expect(invokers.sort()).toEqual(["AdminFunction", "McpFunction", "SyncFunction"]);
    const policy = Object.entries(api.findResources("AWS::IAM::Policy")).find(([name]) =>
      name.startsWith("ConvertVideoFunction"),
    )?.[1];
    expect(JSON.stringify(policy)).toContain("/slides/*");
    expect(JSON.stringify(policy)).not.toContain("s3:DeleteObject");
  });

  it("lets sync write only slideshow objects", () => {
    const policies = api.findResources("AWS::IAM::Policy");
    const sync = Object.entries(policies).find(([id]) => id.startsWith("SyncFunction"))?.[1];
    const statements = JSON.stringify(sync);
    expect(statements).toContain("s3:PutObject");
    expect(statements).toContain("/slides/*");
    api.hasResourceProperties("AWS::Lambda::Function", { Timeout: 300, MemorySize: 1024 });
  });

  it("lets admin publish app builds and the device function presign them", () => {
    const policies = api.findResources("AWS::IAM::Policy");
    // S3 actions a function may use on objects in the photos bucket (any key, app/* included).
    const bucketActions = (prefix: string) => {
      const policy = Object.entries(policies).find(([id]) => id.startsWith(prefix))?.[1];
      const statements: Array<{ Action: string | string[]; Resource: unknown }> =
        policy?.Properties.PolicyDocument.Statement ?? [];
      return statements
        .filter((st) => JSON.stringify(st.Resource).includes('"/*"'))
        .flatMap((st) => (Array.isArray(st.Action) ? st.Action : [st.Action]))
        .filter((a) => a.startsWith("s3:"));
    };
    expect(bucketActions("AdminFunction")).toEqual(
      expect.arrayContaining(["s3:PutObject", "s3:DeleteObject*", "s3:GetObject*"]),
    );
    expect(bucketActions("DeviceFunction")).toContain("s3:GetObject*");
    expect(bucketActions("DeviceFunction")).not.toContain("s3:PutObject");
  });

  it("gives the device function time to add an event and re-sync the calendar", () => {
    const fns = api.findResources("AWS::Lambda::Function");
    const device = Object.entries(fns).find(([id]) => id.startsWith("DeviceFunction"))?.[1];
    expect(device?.Properties.Timeout).toBe(30);
  });

  it("watches the frames every 10 minutes, and only the watch may email", () => {
    api.hasResourceProperties("AWS::Events::Rule", { ScheduleExpression: "rate(10 minutes)" });
    api.resourceCountIs("AWS::SNS::Topic", 1);
    // No address in the code: subscriptions are added by hand.
    api.resourceCountIs("AWS::SNS::Subscription", 0);
    const publishers = Object.entries(api.findResources("AWS::IAM::Policy"))
      .filter(([, p]) => JSON.stringify(p).includes("sns:Publish"))
      .map(([id]) => id);
    expect(publishers).toHaveLength(1);
    expect(publishers[0]).toMatch(/^WatchFunction/);
    const fns = api.findResources("AWS::Lambda::Function");
    const watch = Object.entries(fns).find(([id]) => id.startsWith("WatchFunction"))?.[1];
    expect(watch?.Properties.Environment.Variables.ALERT_TOPIC_ARN).toBeDefined();
  });

  it("syncs every 15 minutes", () => {
    api.hasResourceProperties("AWS::Events::Rule", { ScheduleExpression: "rate(15 minutes)" });
  });

  it("gives the Google secret only to functions that call Google", () => {
    const policies = api.findResources("AWS::IAM::Policy");
    const readers = Object.entries(policies)
      .filter(([, p]) => JSON.stringify(p).includes("secretsmanager:GetSecretValue"))
      .map(([id]) => id);
    expect(readers.sort()).toEqual([
      expect.stringMatching(/^AdminFunction/),
      expect.stringMatching(/^ConvertVideoFunction/),
      expect.stringMatching(/^DeviceFunction/),
      expect.stringMatching(/^McpFunction/),
      expect.stringMatching(/^SyncFunction/),
    ]);
  });

  it("lets only the device and admin functions sign", () => {
    const policies = api.findResources("AWS::IAM::Policy");
    const signers = Object.entries(policies)
      .filter(([, p]) => JSON.stringify(p).includes("kms:Sign"))
      .map(([id]) => id);
    expect(signers.sort()).toEqual([
      expect.stringMatching(/^AdminFunction/),
      expect.stringMatching(/^DeviceFunction/),
    ]);
  });
});

describe("stackName", () => {
  it("prefixes non-prod stages and rejects odd ones", () => {
    expect(stackName("prod", "Api")).toBe("KidsDash-Api");
    expect(stackName("dev", "Api")).toBe("KidsDash-dev-Api");
    expect(() => stackName("Dev Stage", "Api")).toThrow();
  });
});
