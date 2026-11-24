import { RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as kms from "aws-cdk-lib/aws-kms";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";

export interface DataStackProps extends StackProps {
  stage: string;
}

/**
 * Everything stateful. Kept apart from the API stack so the API can be torn
 * down and redeployed freely; every resource here is retained on delete.
 */
export class DataStack extends Stack {
  readonly table: dynamodb.TableV2;
  readonly photos: s3.Bucket;
  readonly signingKey: kms.Key;
  readonly googleSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    this.table = new dynamodb.TableV2(this, "Table", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      timeToLiveAttribute: "expiresAt",
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.photos = new s3.Bucket(this, "Photos", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: false,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // The bundle signing key. Asymmetric: the private half never leaves KMS and
    // the frame verifies with the public half compiled into the app.
    this.signingKey = new kms.Key(this, "BundleSigningKey", {
      description: `kids-dash ${props.stage}: signs the dashboard bundle (ECDSA P-256)`,
      keySpec: kms.KeySpec.ECC_NIST_P256,
      keyUsage: kms.KeyUsage.SIGN_VERIFY,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Holds the Google service account JSON. Created with a random placeholder,
    // which the sync treats as "not configured"; see docs/operations.md.
    this.googleSecret = new secretsmanager.Secret(this, "GoogleServiceAccount", {
      description: `kids-dash ${props.stage}: Google service account JSON with read access to the family calendars`,
      removalPolicy: RemovalPolicy.RETAIN,
    });
  }
}
