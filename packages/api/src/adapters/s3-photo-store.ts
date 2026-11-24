import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { PhotoStore } from "../services/ports";

export class S3PhotoStore implements PhotoStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
        // Keys are content-addressed (sha256), so a cached copy is never stale.
        CacheControl: "private, max-age=31536000, immutable",
      }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  presignPut(
    key: string,
    contentType: string,
    sha256: string,
    ttlSeconds: number,
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        // S3 checks the body against this. Without it the SDK would presign a
        // CRC32 of the (empty) body it has here, and every real upload would fail.
        ChecksumAlgorithm: "SHA256",
        ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"),
      }),
      { expiresIn: ttlSeconds, signableHeaders: new Set(["content-type"]) },
    );
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const object = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return object.Body ? await object.Body.transformToByteArray() : null;
    } catch (error) {
      if ((error as { name?: string }).name === "NoSuchKey") return null;
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (error) {
      if ((error as { name?: string }).name === "NotFound") return false;
      throw error;
    }
  }

  presign(key: string, ttlSeconds: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: ttlSeconds,
    });
  }
}
