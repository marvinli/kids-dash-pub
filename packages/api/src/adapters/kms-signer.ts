import { createHash } from "node:crypto";
import { GetPublicKeyCommand, type KMSClient, SignCommand } from "@aws-sdk/client-kms";
import type { Signer } from "../services/ports";

/**
 * ECDSA P-256 signing with an asymmetric KMS key; the private key never leaves
 * KMS. KMS signs RAW messages only up to 4 KB, so we send the SHA-256 digest
 * (MessageType DIGEST), which yields the same signature as signing the bytes.
 */
export class KmsSigner implements Signer {
  private publicKey?: Promise<string>;

  constructor(
    private readonly client: KMSClient,
    private readonly keyArn: string,
  ) {}

  /** The key's UUID: stable, short, and not an ARN the frame has to carry. */
  get keyId(): string {
    return this.keyArn.split("/").pop() ?? this.keyArn;
  }

  async sign(message: Uint8Array): Promise<Uint8Array> {
    const digest = createHash("sha256").update(message).digest();
    const out = await this.client.send(
      new SignCommand({
        KeyId: this.keyArn,
        Message: digest,
        MessageType: "DIGEST",
        SigningAlgorithm: "ECDSA_SHA_256",
      }),
    );
    if (!out.Signature) throw new Error("KMS returned no signature");
    return out.Signature;
  }

  publicKeyPem(): Promise<string> {
    this.publicKey ??= this.fetchPublicKey();
    return this.publicKey;
  }

  private async fetchPublicKey(): Promise<string> {
    const out = await this.client.send(new GetPublicKeyCommand({ KeyId: this.keyArn }));
    if (!out.PublicKey) throw new Error("KMS returned no public key");
    const body = Buffer.from(out.PublicKey)
      .toString("base64")
      .replace(/(.{64})/g, "$1\n");
    return `-----BEGIN PUBLIC KEY-----\n${body.trimEnd()}\n-----END PUBLIC KEY-----\n`;
  }
}
