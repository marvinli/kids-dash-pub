import type { Settings } from "@kids-dash/core";
import { NotFoundError } from "./errors";
import type { DeviceRecord, DeviceStore, SlidesSnapshot, SnapshotStore } from "./ports";

/** The Drive folder a frame plays: its own override, else the family's. */
export function folderFor(device: DeviceRecord | null, settings: Settings): string | null {
  return device?.settings.slideshowFolderId ?? settings.slideshowFolderId;
}

/** A device's record, for a device-specific answer; unknown or revoked ids are a 404. */
export async function activeDevice(devices: DeviceStore, id: string): Promise<DeviceRecord> {
  const record = await devices.get(id);
  if (!record || record.revokedAt) throw new NotFoundError(`No device ${id}`);
  return record;
}

/**
 * What a folder's slideshow holds. Until the first per-folder sync, the family
 * folder's slides are still in the single legacy snapshot, so read that.
 */
export async function readSlides(
  snapshots: SnapshotStore,
  folderId: string | null,
  familyFolderId: string | null,
): Promise<SlidesSnapshot | null> {
  if (!folderId) return null;
  const snapshot = await snapshots.getSlides(folderId);
  if (snapshot || folderId !== familyFolderId) return snapshot;
  return snapshots.getLegacySlides();
}
