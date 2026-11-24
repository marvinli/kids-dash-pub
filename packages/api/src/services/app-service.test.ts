import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fakeWorld } from "../../test/fakes";
import { APK_CONTENT_TYPE, ART_CONTENT_TYPE } from "./app-service";
import { ConflictError, InvalidRequestError, NotFoundError } from "./errors";

const apk = (...rest: number[]) => new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...rest]);
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("AppService", () => {
  it("stores a release under its hash and makes it current", async () => {
    const w = fakeWorld();
    expect(await w.services.app.current()).toBeNull();
    const bytes = apk(1, 2, 3);
    const release = await w.services.app.publish({
      versionCode: 5,
      versionName: "1.5",
      dataBase64: b64(bytes),
    });
    expect(release).toEqual({
      versionCode: 5,
      versionName: "1.5",
      sha256: sha(bytes),
      key: `app/${sha(bytes)}.apk`,
      publishedAt: "2026-11-16T12:42:00.000Z",
    });
    expect(w.photos.objects.get(release.key)).toEqual({ bytes, contentType: APK_CONTENT_TYPE });
    expect(await w.services.app.current()).toEqual(release);
  });

  it("replaces the previous release and deletes its file", async () => {
    const w = fakeWorld();
    const first = await w.services.app.publish({
      versionCode: 1,
      versionName: "1.0",
      dataBase64: b64(apk(1)),
    });
    const second = await w.services.app.publish({
      versionCode: 2,
      versionName: "1.1",
      dataBase64: b64(apk(2)),
    });
    expect([...w.photos.objects.keys()]).toEqual([second.key]);
    expect(first.key).not.toBe(second.key);

    // The same bytes under a newer versionCode keep the (shared) file.
    const third = await w.services.app.publish({
      versionCode: 3,
      versionName: "1.1-again",
      dataBase64: b64(apk(2)),
    });
    expect(third.key).toBe(second.key);
    expect([...w.photos.objects.keys()]).toEqual([second.key]);
  });

  it("rejects versions that are not newer, non-APKs and bad base64", async () => {
    const w = fakeWorld();
    await w.services.app.publish({ versionCode: 4, versionName: "1.4", dataBase64: b64(apk(4)) });
    for (const versionCode of [4, 3]) {
      await expect(
        w.services.app.publish({ versionCode, versionName: "x", dataBase64: b64(apk(9)) }),
      ).rejects.toBeInstanceOf(ConflictError);
    }
    await expect(
      w.services.app.publish({
        versionCode: 5,
        versionName: "x",
        dataBase64: b64(new Uint8Array([0xff, 0xd8, 0xff])),
      }),
    ).rejects.toBeInstanceOf(InvalidRequestError);
    await expect(
      w.services.app.publish({ versionCode: 5, versionName: "x", dataBase64: "not base64!" }),
    ).rejects.toBeInstanceOf(InvalidRequestError);
    await expect(
      w.services.app.publish({ versionCode: 0, versionName: "x", dataBase64: b64(apk()) }),
    ).rejects.toThrow();
    expect((await w.services.app.current())?.versionCode).toBe(4);
    expect(w.photos.objects.size).toBe(1);
  });

  it("publishes a build uploaded straight to storage, checked against its hash", async () => {
    const w = fakeWorld();
    const bytes = apk(7, 7);
    const hash = sha(bytes);
    expect(await w.services.app.uploadUrl({ sha256: hash })).toEqual({
      url: `https://photos.example/app/${hash}.apk?put=application%2Fvnd.android.package-archive&sha256=${hash}&ttl=900`,
      contentType: APK_CONTENT_TYPE,
    });
    await expect(w.services.app.uploadUrl({ sha256: "nope" })).rejects.toThrow();
    // Not uploaded yet.
    await expect(
      w.services.app.publish({ versionCode: 7, versionName: "1.7", sha256: hash }),
    ).rejects.toBeInstanceOf(InvalidRequestError);

    await w.photos.put(`app/${hash}.apk`, bytes, APK_CONTENT_TYPE);
    const release = await w.services.app.publish({
      versionCode: 7,
      versionName: "1.7",
      sha256: hash,
    });
    expect(release).toMatchObject({ versionCode: 7, sha256: hash, key: `app/${hash}.apk` });
    expect(await w.services.app.current()).toEqual(release);

    // An upload that does not match its name, or is not an APK, is refused and removed.
    const wrong = "b".repeat(64);
    await w.photos.put(`app/${wrong}.apk`, apk(8), APK_CONTENT_TYPE);
    await expect(
      w.services.app.publish({ versionCode: 8, versionName: "1.8", sha256: wrong }),
    ).rejects.toBeInstanceOf(InvalidRequestError);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff]);
    await w.photos.put(`app/${sha(jpeg)}.apk`, jpeg, APK_CONTENT_TYPE);
    await expect(
      w.services.app.publish({ versionCode: 8, versionName: "1.8", sha256: sha(jpeg) }),
    ).rejects.toBeInstanceOf(InvalidRequestError);
    expect([...w.photos.objects.keys()]).toEqual([release.key]);
    // Re-publishing the current bytes under a newer code keeps the file.
    w.photos.objects.set(release.key, { bytes: apk(0), contentType: APK_CONTENT_TYPE });
    await expect(
      w.services.app.publish({ versionCode: 9, versionName: "1.9", sha256: hash }),
    ).rejects.toBeInstanceOf(InvalidRequestError);
    expect(w.photos.objects.has(release.key)).toBe(true);
  });

  it("presigns only the current release", async () => {
    const w = fakeWorld();
    await expect(w.services.app.downloadUrl("a".repeat(64))).rejects.toBeInstanceOf(NotFoundError);
    const release = await w.services.app.publish({
      versionCode: 1,
      versionName: "1.0",
      dataBase64: b64(apk(1)),
    });
    expect(await w.services.app.downloadUrl(release.sha256)).toBe(
      `https://photos.example/${release.key}?ttl=300`,
    );
    await expect(w.services.app.downloadUrl("a".repeat(64))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("hands out upload URLs only for the paintings not stored yet, and reads them by hash", async () => {
    const w = fakeWorld();
    const [a, b] = ["a".repeat(64), "b".repeat(64)];
    await w.photos.put(`art/${a}.webp`, new Uint8Array([1]), ART_CONTENT_TYPE);
    expect(await w.services.app.artUploads({ sha256s: [a, b, b] })).toEqual({
      contentType: "image/webp",
      uploads: [
        {
          sha256: b,
          url: `https://photos.example/art/${b}.webp?put=image%2Fwebp&sha256=${b}&ttl=900`,
        },
      ],
    });
    expect((await w.services.app.artUploads({ sha256s: [a] })).uploads).toEqual([]);
    await expect(w.services.app.artUploads({ sha256s: [] })).rejects.toThrow();
    await expect(w.services.app.artUploads({ sha256s: ["nope"] })).rejects.toThrow();
    expect(await w.services.app.artUrl(a)).toBe(`https://photos.example/art/${a}.webp?ttl=300`);
  });
});
