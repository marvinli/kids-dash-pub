#!/usr/bin/env node
import { App, Tags } from "aws-cdk-lib";
import { ApiStack } from "../lib/api-stack";
import { DataStack } from "../lib/data-stack";
import { stackName } from "../lib/naming";

const app = new App();
const stage = (app.node.tryGetContext("stage") as string | undefined) ?? "prod";
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
};

const data = new DataStack(app, stackName(stage, "Data"), { env, stage });
new ApiStack(app, stackName(stage, "Api"), {
  env,
  stage,
  table: data.table,
  photos: data.photos,
  signingKey: data.signingKey,
  googleSecret: data.googleSecret,
});

Tags.of(app).add("project", "kids-dash");
Tags.of(app).add("stage", stage);
