import { PublishCommand, type SNSClient } from "@aws-sdk/client-sns";
import type { Logger, Notifier } from "../services/ports";

/** SNS caps an email subject at 100 characters. */
const MAX_SUBJECT = 100;

/** Publishes to the alerts topic; its email subscriptions deliver it. */
export class SnsNotifier implements Notifier {
  constructor(
    private readonly client: SNSClient,
    private readonly topicArn: string,
  ) {}

  async send(subject: string, body: string): Promise<void> {
    await this.client.send(
      new PublishCommand({
        TopicArn: this.topicArn,
        Subject: subject.slice(0, MAX_SUBJECT),
        Message: body,
      }),
    );
  }
}

/** Where there is no topic (a local run): the message only goes to the log. */
export class LogNotifier implements Notifier {
  constructor(private readonly logger: Logger) {}

  async send(subject: string, body: string): Promise<void> {
    this.logger.warn("alert (no topic configured)", { subject, body });
  }
}
