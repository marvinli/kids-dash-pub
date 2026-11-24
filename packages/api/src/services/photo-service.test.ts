import { createHash } from "node:crypto";
import { MAX_PHOTO_BYTES, type PhotoInput } from "@kids-dash/core";
import { describe, expect, it } from "vitest";
import { fakeWorld } from "../../test/fakes";
import { InvalidRequestError, NotConfiguredError, NotFoundError } from "./errors";
import { matchesContentType } from "./photo-service";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const WEBP = Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1");

const upload = (
  bytes: Buffer,
  contentType: PhotoInput["contentType"] = "image/jpeg",
): PhotoInput => ({
  contentType,
  dataBase64: bytes.toString("base64"),
});

describe("PhotoService", () => {
  it("stores a content-addressed photo and records it on the kid", async () => {
    const w = fakeWorld();
    const photo = await w.services.photos.setPhoto("maya", upload(JPEG));
    const sha = createHash("sha256").update(JPEG).digest("hex");
    expect(photo).toEqual({
      key: `photos/maya/${sha}.jpg`,
      sha256: sha,
      contentType: "image/jpeg",
    });
    expect(w.photos.objects.get(photo.key)?.contentType).toBe("image/jpeg");
    expect(w.settings.value?.kids[0]?.photo).toEqual(photo);
    expect(await w.services.photos.photoUrl("maya")).toBe(
      `https://photos.example/${photo.key}?ttl=300`,
    );
  });

  it("replaces the previous photo object", async () => {
    const w = fakeWorld();
    const first = await w.services.photos.setPhoto("maya", upload(JPEG));
    const second = await w.services.photos.setPhoto("maya", upload(PNG, "image/png"));
    expect(w.photos.objects.has(first.key)).toBe(false);
    expect(w.photos.objects.has(second.key)).toBe(true);
    // Uploading the same bytes again keeps the object.
    await w.services.photos.setPhoto("maya", upload(PNG, "image/png"));
    expect(w.photos.objects.has(second.key)).toBe(true);
  });

  it("rejects mislabelled, malformed and oversized uploads", async () => {
    const w = fakeWorld();
    await expect(w.services.photos.setPhoto("maya", upload(PNG))).rejects.toBeInstanceOf(
      InvalidRequestError,
    );
    await expect(
      w.services.photos.setPhoto("maya", { contentType: "image/jpeg", dataBase64: "not base64!" }),
    ).rejects.toBeInstanceOf(InvalidRequestError);
    const huge = Buffer.concat([JPEG, Buffer.alloc(MAX_PHOTO_BYTES)]);
    await expect(w.services.photos.setPhoto("maya", upload(huge))).rejects.toThrow(/over 3 MB/);
  });

  it("needs settings and a known kid", async () => {
    await expect(
      fakeWorld(null).services.photos.setPhoto("maya", upload(JPEG)),
    ).rejects.toBeInstanceOf(NotConfiguredError);
    await expect(fakeWorld().services.photos.setPhoto("sam", upload(JPEG))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("removes photos, and 404s when there is none", async () => {
    const w = fakeWorld();
    const photo = await w.services.photos.setPhoto("theo", upload(WEBP, "image/webp"));
    await w.services.photos.removePhoto("theo");
    expect(w.photos.objects.has(photo.key)).toBe(false);
    expect(w.settings.value?.kids[1]?.photo).toBeNull();
    await expect(w.services.photos.removePhoto("theo")).rejects.toBeInstanceOf(NotFoundError);
    await expect(w.services.photos.photoUrl("theo")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("matchesContentType", () => {
  it("checks magic bytes", () => {
    expect(matchesContentType(JPEG, "image/jpeg")).toBe(true);
    expect(matchesContentType(PNG, "image/png")).toBe(true);
    expect(matchesContentType(WEBP, "image/webp")).toBe(true);
    expect(matchesContentType(Buffer.from("RIFF\0\0\0\0WAVE", "latin1"), "image/webp")).toBe(false);
    expect(matchesContentType(JPEG, "image/gif")).toBe(false);
  });
});
