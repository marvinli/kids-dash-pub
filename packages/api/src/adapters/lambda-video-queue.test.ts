import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { LambdaVideoQueue } from "./lambda-video-queue";

const lambda = mockClient(LambdaClient);
beforeEach(() => lambda.reset());

const item = { sourceId: "v1", version: "3", kind: "video" as const, sizeBytes: 9, durationMs: 4 };

describe("LambdaVideoQueue", () => {
  it("invokes the converter asynchronously with the item", async () => {
    lambda.on(InvokeCommand).resolves({ StatusCode: 202 });
    await new LambdaVideoQueue(new LambdaClient({ region: "us-east-1" }), "convert").start(item);
    const input = lambda.commandCalls(InvokeCommand)[0]?.args[0].input;
    expect(input).toMatchObject({ FunctionName: "convert", InvocationType: "Event" });
    expect(JSON.parse(new TextDecoder().decode(input?.Payload as Uint8Array))).toEqual(item);
  });

  it("fails when Lambda does not accept it", async () => {
    lambda.on(InvokeCommand).resolves({ StatusCode: 500 });
    await expect(
      new LambdaVideoQueue(new LambdaClient({ region: "us-east-1" }), "convert").start(item),
    ).rejects.toThrow(/500/);
  });
});
