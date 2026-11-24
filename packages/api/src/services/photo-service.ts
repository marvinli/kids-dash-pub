import { createHash } from "node:crypto";
import { type KidPhoto, PhotoInput } from "@kids-dash/core";
import { InvalidRequestError, NotConfiguredError, NotFoundError } from "./errors";
import type { DeviceStore, PhotoStore, SettingsStore, SnapshotStore } from "./ports";
import { activeDevice, folderFor, readSlides } from "./slide-folders";

export const PHOTO_URL_TTL_SECONDS = 300;

const EXTENSIONS: Record<KidPhoto["contentType"], string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export interface PhotoServiceDeps {
  settings: SettingsStore;
  photos: PhotoStore;
  snapshots: SnapshotStore;
  devices: DeviceStore;
}

/**
 * Kid portraits and slideshow media: stored privately, served to devices by
 * short-lived URL.
 */
export class PhotoService {
  constructor(private readonly deps: PhotoServiceDeps) {}

  async setPhoto(kidId: string, input: PhotoInput): Promise<KidPhoto> {
    const { contentType, dataBase64 } = PhotoInput.parse(input);
    const bytes = decodeBase64(dataBase64);
    if (!matchesContentType(bytes, contentType)) {
      throw new InvalidRequestError(`Bytes are not a ${contentType} image`);
    }

    const settings = await this.deps.settings.get();
    if (!settings) throw new NotConfiguredError();
    const kid = settings.kids.find((k) => k.id === kidId);
    if (!kid) throw new NotFoundError(`Unknown kid ${kidId}`);

    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const photo: KidPhoto = {
      key: `photos/${kidId}/${sha256}.${EXTENSIONS[contentType]}`,
      sha256,
      contentType,
    };
    await this.deps.photos.put(photo.key, bytes, contentType);
    await this.deps.settings.put({
      ...settings,
      kids: settings.kids.map((k) => (k.id === kidId ? { ...k, photo } : k)),
    });
    if (kid.photo && kid.photo.key !== photo.key) await this.deps.photos.delete(kid.photo.key);
    return photo;
  }

  async removePhoto(kidId: string): Promise<void> {
    const settings = await this.deps.settings.get();
    const kid = settings?.kids.find((k) => k.id === kidId);
    if (!settings || !kid?.photo) throw new NotFoundError(`No photo for ${kidId}`);
    await this.deps.settings.put({
      ...settings,
      kids: settings.kids.map((k) => (k.id === kidId ? { ...k, photo: null } : k)),
    });
    await this.deps.photos.delete(kid.photo.key);
  }

  /** A presigned URL for a kid's current photo. */
  async photoUrl(kidId: string): Promise<string> {
    const settings = await this.deps.settings.get();
    const photo = settings?.kids.find((k) => k.id === kidId)?.photo;
    if (!photo) throw new NotFoundError(`No photo for ${kidId}`);
    return this.deps.photos.presign(photo.key, PHOTO_URL_TTL_SECONDS);
  }

  /**
   * A presigned URL for a slide, by content hash, if it is in the slideshow
   * this frame plays (the family's, when no device is given).
   */
  async slideUrl(sha256: string, deviceId?: string): Promise<string> {
    const [settings, device] = await Promise.all([
      this.deps.settings.get(),
      deviceId === undefined ? null : activeDevice(this.deps.devices, deviceId),
    ]);
    const family = settings?.slideshowFolderId ?? null;
    const folder = settings ? folderFor(device, settings) : null;
    const snapshot = await readSlides(this.deps.snapshots, folder, family);
    const slide = snapshot?.slides.find((s) => s.sha256 === sha256);
    if (!slide) throw new NotFoundError("No such slide");
    return this.deps.photos.presign(slide.key, PHOTO_URL_TTL_SECONDS);
  }
}

export function decodeBase64(data: string): Uint8Array {
  const clean = data.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 !== 0) {
    throw new InvalidRequestError("dataBase64 is not valid base64");
  }
  return new Uint8Array(Buffer.from(clean, "base64"));
}

/** Checks magic bytes so a mislabelled upload cannot be served as an image. */
export function matchesContentType(bytes: Uint8Array, contentType: string): boolean {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  switch (contentType) {
    case "image/jpeg":
      return starts(0xff, 0xd8, 0xff);
    case "image/png":
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/webp":
      return (
        starts(0x52, 0x49, 0x46, 0x46) &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      );
    default:
      return false;
  }
}
