import { InvokeCommand, type LambdaClient } from "@aws-sdk/client-lambda";
import type { MediaItem, VideoConversionQueue } from "../services/ports";

/** Starts the converter function asynchronously (it runs for minutes; nobody waits). */
export class LambdaVideoQueue implements VideoConversionQueue {
  constructor(
    private readonly client: Pick<LambdaClient, "send">,
    private readonly functionName: string,
  ) {}

  async start(item: MediaItem): Promise<void> {
    const out = await this.client.send(
      new InvokeCommand({
        FunctionName: this.functionName,
        InvocationType: "Event",
        Payload: new TextEncoder().encode(JSON.stringify(item)),
      }),
    );
    if (out.StatusCode !== 202) throw new Error(`converter not started: ${out.StatusCode}`);
  }
}
