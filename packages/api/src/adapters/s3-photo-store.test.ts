import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { S3PhotoStore } from "./s3-photo-store";

const s3 = mockClient(S3Client);
const client = new S3Client({
  region: "us-east-1",
  credentials: { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "secret" },
});

beforeEach(() => s3.reset());

describe("S3PhotoStore", () => {
  it("puts immutable private objects and deletes them", async () => {
    s3.on(PutObjectCommand).resolves({});
    s3.on(DeleteObjectCommand).resolves({});
    const store = new S3PhotoStore(client, "photos-bucket");
    await store.put("photos/maya/x.jpg", new Uint8Array([1, 2]), "image/jpeg");
    await store.delete("photos/maya/x.jpg");
    expect(s3.commandCalls(PutObjectCommand)[0]?.args[0].input).toMatchObject({
      Bucket: "photos-bucket",
      Key: "photos/maya/x.jpg",
      ContentType: "image/jpeg",
      CacheControl: "private, max-age=31536000, immutable",
    });
    expect(s3.commandCalls(DeleteObjectCommand)[0]?.args[0].input).toEqual({
      Bucket: "photos-bucket",
      Key: "photos/maya/x.jpg",
    });
  });

  it("presigns short-lived GET URLs", async () => {
    const url = new URL(
      await new S3PhotoStore(client, "photos-bucket").presign("photos/a.jpg", 300),
    );
    expect(url.pathname).toContain("photos/a.jpg");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
  });

  it("presigns short-lived PUT URLs for one content type and hash", async () => {
    const url = new URL(
      await new S3PhotoStore(client, "photos-bucket").presignPut(
        "app/abc.apk",
        "application/vnd.android.package-archive",
        "cc".repeat(32),
        900,
      ),
    );
    expect(url.pathname).toContain("app/abc.apk");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-type;host");
    // The real hash, not a checksum of an empty body.
    expect(url.searchParams.get("x-amz-checksum-sha256")).toBe(
      Buffer.from("cc".repeat(32), "hex").toString("base64"),
    );
    expect(url.searchParams.get("x-amz-checksum-crc32")).toBeNull();
  });

  it("reads objects, null when missing", async () => {
    const store = new S3PhotoStore(client, "photos-bucket");
    s3.on(GetObjectCommand, { Key: "app/a.apk" }).resolves({
      // The SDK's stream body, reduced to the one method the store uses.
      Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } as never,
    });
    s3.on(GetObjectCommand, { Key: "app/empty.apk" }).resolves({});
    s3.on(GetObjectCommand, { Key: "app/gone.apk" }).rejects(
      new NoSuchKey({ message: "gone", $metadata: {} }),
    );
    s3.on(GetObjectCommand, { Key: "app/denied.apk" }).rejects(new Error("AccessDenied"));
    expect(await store.get("app/a.apk")).toEqual(new Uint8Array([1, 2, 3]));
    expect(await store.get("app/empty.apk")).toBeNull();
    expect(await store.get("app/gone.apk")).toBeNull();
    await expect(store.get("app/denied.apk")).rejects.toThrow("AccessDenied");
  });

  it("tells whether an object exists", async () => {
    const store = new S3PhotoStore(client, "photos-bucket");
    s3.on(HeadObjectCommand, { Key: "art/a.webp" }).resolves({});
    s3.on(HeadObjectCommand, { Key: "art/b.webp" }).rejects(
      new NotFound({ message: "gone", $metadata: {} }),
    );
    s3.on(HeadObjectCommand, { Key: "art/c.webp" }).rejects(new Error("AccessDenied"));
    expect(await store.exists("art/a.webp")).toBe(true);
    expect(await store.exists("art/b.webp")).toBe(false);
    await expect(store.exists("art/c.webp")).rejects.toThrow("AccessDenied");
    expect(s3.commandCalls(HeadObjectCommand)[0]?.args[0].input).toEqual({
      Bucket: "photos-bucket",
      Key: "art/a.webp",
    });
  });
});
