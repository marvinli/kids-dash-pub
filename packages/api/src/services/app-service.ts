import { createHash } from "node:crypto";
import { AppReleaseInput, AppUploadInput, ArtUploadInput } from "@kids-dash/core";
import { ConflictError, InvalidRequestError, NotFoundError } from "./errors";
import { decodeBase64, PHOTO_URL_TTL_SECONDS } from "./photo-service";
import type { AppReleaseRecord, Clock, PhotoStore, SnapshotStore } from "./ports";

export const APK_CONTENT_TYPE = "application/vnd.android.package-archive";
export const ART_CONTENT_TYPE = "image/webp";

/** How long an upload URL from `uploadUrl` stays valid. */
export const UPLOAD_URL_TTL_SECONDS = 15 * 60;

/** An APK is a zip: local file header magic. */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

export interface AppServiceDeps {
  clock: Clock;
  snapshots: SnapshotStore;
  photos: PhotoStore;
}

/**
 * Over-the-air updates for the frame app. One release is current; the bundle
 * names it and each frame installs it when it is newer than what it runs.
 * Frames still check the APK's hash and signing certificate before installing.
 */
export class AppService {
  constructor(private readonly deps: AppServiceDeps) {}

  /**
   * Builds too big for one API request (the Lambda payload limit) go straight
   * to storage: PUT the APK to this URL, then publish with its sha256.
   */
  async uploadUrl(input: unknown): Promise<{ url: string; contentType: string }> {
    const { sha256 } = AppUploadInput.parse(input);
    const url = await this.deps.photos.presignPut(
      apkKey(sha256),
      APK_CONTENT_TYPE,
      sha256,
      UPLOAD_URL_TTL_SECONDS,
    );
    return { url, contentType: APK_CONTENT_TYPE };
  }

  /**
   * The backdrop paintings live outside the APK (it stays small enough for
   * a frame's Wi-Fi), stored by content hash. The publish script sends every
   * hash its build downloads; this answers upload URLs for the ones not
   * stored yet. A stored painting is never replaced, so a frame on an older
   * build still finds its own.
   */
  async artUploads(
    input: unknown,
  ): Promise<{ contentType: string; uploads: Array<{ sha256: string; url: string }> }> {
    const sha256s = [...new Set(ArtUploadInput.parse(input).sha256s)];
    const stored = await Promise.all(sha256s.map((sha) => this.deps.photos.exists(artKey(sha))));
    const missing = sha256s.filter((_, i) => !stored[i]);
    const uploads = await Promise.all(
      missing.map(async (sha256) => ({
        sha256,
        url: await this.deps.photos.presignPut(
          artKey(sha256),
          ART_CONTENT_TYPE,
          sha256,
          UPLOAD_URL_TTL_SECONDS,
        ),
      })),
    );
    return { contentType: ART_CONTENT_TYPE, uploads };
  }

  /** A presigned URL for a backdrop painting, by its hash (the frame checks the bytes). */
  async artUrl(sha256: string): Promise<string> {
    return this.deps.photos.presign(artKey(sha256), PHOTO_URL_TTL_SECONDS);
  }

  async publish(input: unknown): Promise<AppReleaseRecord> {
    const parsed = AppReleaseInput.parse(input);
    const { versionCode, versionName } = parsed;
    const previous = await this.deps.snapshots.getApp();
    if (previous && versionCode <= previous.versionCode) {
      throw new ConflictError(
        `versionCode ${versionCode} is not newer than the current ${previous.versionCode}`,
      );
    }

    let bytes: Uint8Array;
    if ("dataBase64" in parsed) {
      bytes = decodeBase64(parsed.dataBase64);
    } else {
      const uploaded = await this.deps.photos.get(apkKey(parsed.sha256));
      if (!uploaded) throw new InvalidRequestError("Upload the APK first (POST /admin/app/upload)");
      bytes = uploaded;
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (
      !ZIP_MAGIC.every((b, i) => bytes[i] === b) ||
      ("sha256" in parsed && parsed.sha256 !== sha256)
    ) {
      // A bad upload is not kept around (unless it is somehow the current release).
      if ("sha256" in parsed && previous?.key !== apkKey(parsed.sha256)) {
        await this.deps.photos.delete(apkKey(parsed.sha256));
      }
      throw new InvalidRequestError("Bytes are not an APK with that sha256");
    }

    const release: AppReleaseRecord = {
      versionCode,
      versionName,
      sha256,
      key: apkKey(sha256),
      publishedAt: this.deps.clock.now().toISOString(),
    };
    if ("dataBase64" in parsed) await this.deps.photos.put(release.key, bytes, APK_CONTENT_TYPE);
    await this.deps.snapshots.putApp(release);
    if (previous && previous.key !== release.key) await this.deps.photos.delete(previous.key);
    return release;
  }

  current(): Promise<AppReleaseRecord | null> {
    return this.deps.snapshots.getApp();
  }

  /** A presigned URL for the current release's APK, by its hash. */
  async downloadUrl(sha256: string): Promise<string> {
    const release = await this.deps.snapshots.getApp();
    if (release?.sha256 !== sha256) throw new NotFoundError("No such app release");
    return this.deps.photos.presign(release.key, PHOTO_URL_TTL_SECONDS);
  }
}

const apkKey = (sha256: string) => `app/${sha256}.apk`;
const artKey = (sha256: string) => `art/${sha256}.webp`;
