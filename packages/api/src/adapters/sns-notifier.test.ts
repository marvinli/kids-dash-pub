import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryLogger } from "../../test/fakes";
import { LogNotifier, SnsNotifier } from "./sns-notifier";

const sns = mockClient(SNSClient);
beforeEach(() => sns.reset());

describe("SnsNotifier", () => {
  it("publishes to the topic, subject capped at SNS's limit", async () => {
    sns.on(PublishCommand).resolves({ MessageId: "m" });
    await new SnsNotifier(new SNSClient({ region: "us-east-1" }), "arn:topic").send(
      "x".repeat(150),
      "body",
    );
    expect(sns.commandCalls(PublishCommand)[0]?.args[0].input).toEqual({
      TopicArn: "arn:topic",
      Subject: "x".repeat(100),
      Message: "body",
    });
  });
});

describe("LogNotifier", () => {
  it("only logs", async () => {
    const logger = new MemoryLogger();
    await new LogNotifier(logger).send("s", "b");
    expect(logger.lines).toEqual([
      {
        level: "warn",
        message: "alert (no topic configured)",
        fields: { subject: "s", body: "b" },
      },
    ]);
  });
});
