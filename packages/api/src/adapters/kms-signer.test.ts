import { createHash, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { GetPublicKeyCommand, KMSClient, SignCommand } from "@aws-sdk/client-kms";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { KmsSigner } from "./kms-signer";

const kms = mockClient(KMSClient);
const ARN = "arn:aws:kms:us-east-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab";
const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });

beforeEach(() => kms.reset());

describe("KmsSigner", () => {
  it("sends KMS the message's SHA-256 digest and returns its signature untouched", async () => {
    // Node cannot sign a precomputed digest, so this cannot emulate KMS end to
    // end; the deployed key is checked against real verification in the smoke
    // test (docs/operations.md). Here: exactly sha256(message), DIGEST mode.
    const kmsSignature = sign("SHA256", Buffer.from("anything"), privateKey);
    kms.on(SignCommand).resolves({ Signature: kmsSignature });
    const message = new TextEncoder().encode("hello frame");
    const signer = new KmsSigner(new KMSClient({ region: "us-east-1" }), ARN);
    const signature = await signer.sign(message);

    const call = kms.commandCalls(SignCommand)[0]?.args[0].input;
    expect(call).toMatchObject({
      KeyId: ARN,
      MessageType: "DIGEST",
      SigningAlgorithm: "ECDSA_SHA_256",
    });
    expect(Buffer.from(call?.Message ?? [])).toEqual(createHash("sha256").update(message).digest());
    expect(Buffer.from(signature)).toEqual(kmsSignature);
    expect(signer.keyId).toBe("1234abcd-12ab-34cd-56ef-1234567890ab");
  });

  it("fails loudly when KMS returns nothing", async () => {
    kms.on(SignCommand).resolves({});
    kms.on(GetPublicKeyCommand).resolves({});
    const signer = new KmsSigner(new KMSClient({ region: "us-east-1" }), ARN);
    await expect(signer.sign(new Uint8Array([1]))).rejects.toThrow(/no signature/);
    await expect(signer.publicKeyPem()).rejects.toThrow(/no public key/);
  });

  it("exports the public key as PEM, fetched once", async () => {
    const der = publicKey.export({ type: "spki", format: "der" });
    kms.on(GetPublicKeyCommand).resolves({ PublicKey: new Uint8Array(der) });
    const signer = new KmsSigner(new KMSClient({ region: "us-east-1" }), ARN);
    const pem = await signer.publicKeyPem();
    await signer.publicKeyPem();
    expect(createPublicKey(pem).export({ type: "spki", format: "der" })).toEqual(der);
    expect(kms.commandCalls(GetPublicKeyCommand)).toHaveLength(1);
  });
});
