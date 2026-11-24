import { createHash } from "node:crypto";
import { MAX_SLIDES } from "@kids-dash/core";
import { matchesContentType } from "./photo-service";
import {
  GoogleNotConfiguredError,
  type Logger,
  type MediaFolderReader,
  type MediaItem,
  type PhotoStore,
  type SlideRecord,
  type SnapshotStore,
  type VideoConversionQueue,
  type VideoConversionStore,
} from "./ports";
import type { SyncOutcome } from "./sync-service";

/** A frame stores every slide, so videos stay short and, converted, small. */
export const MAX_VIDEO_BYTES = 80 * 1024 * 1024;
export const MAX_VIDEO_MS = 2 * 60 * 1000;
/** Originals the converter takes (phone 4K runs to hundreds of MB a minute). */
export const MAX_SOURCE_VIDEO_BYTES = 1536 * 1024 * 1024;
/** Conversions started per run; each takes the converter a few minutes. */
export const MAX_CONVERSIONS_PER_RUN = 2;
/** A conversion still pending after this died (the converter stops at 15 minutes). */
export const CONVERSION_STALE_MS = 20 * 60 * 1000;
/** A failed conversion is tried again after this, up to MAX_CONVERSION_ATTEMPTS times. */
export const CONVERSION_RETRY_MS = 6 * 60 * 60 * 1000;
export const MAX_CONVERSION_ATTEMPTS = 3;
/** What the converter makes. */
export const CONVERTED_TYPE = "video/mp4";
/** New downloads per run; the rest wait for the next sync (every 15 minutes). */
export const MAX_NEW_PER_RUN = 25;
export const MAX_BYTES_PER_RUN = 200 * 1024 * 1024;

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export interface SlideSyncDeps {
  snapshots: SnapshotStore;
  media: MediaFolderReader;
  photos: PhotoStore;
  conversions: VideoConversionStore;
  /** Null where videos cannot be converted (they are then left out). */
  videos: VideoConversionQueue | null;
  logger: Logger;
}

export interface SlideSyncResult {
  /** The worst outcome across folders. */
  slides: SyncOutcome;
  /** Slides across every folder in use. */
  slideCount: number;
}

/** A run's download allowance, shared by every folder. */
interface Budget {
  fetched: number;
  bytes: number;
  conversions: number;
}

const SEVERITY: SyncOutcome[] = ["skipped", "ok", "not-configured", "failed"];

/**
 * Mirrors each slideshow folder in use (the family's and any frame's own)
 * into the photo store: newest MAX_SLIDES files per folder, each downloaded
 * once (re-fetched only when its version changes), checked, and stored under
 * its content hash, so a file in two folders is stored once. A stored file is
 * deleted once no folder in use refers to it, and a folder that falls out of
 * use loses its snapshot. A failed listing keeps that folder's previous
 * slides; a failed file is skipped and retried next run. Videos are not
 * fetched here: the converter makes a frame-ready copy in the background
 * (see videoSlide) and a later run picks it up.
 */
export async function syncSlides(
  deps: SlideSyncDeps,
  folders: { family: string | null; others: string[] },
  now: Date,
): Promise<SlideSyncResult> {
  const inUse = [...new Set([folders.family, ...folders.others])].filter(
    (f): f is string => f !== null,
  );
  const [index, legacy] = await Promise.all([
    deps.snapshots.getSlidesIndex(),
    deps.snapshots.getLegacySlides(),
  ]);

  const stored = await Promise.all(inUse.map((f) => deps.snapshots.getSlides(f)));
  const budget: Budget = { fetched: 0, bytes: 0, conversions: 0 };
  /** Files already stored, by source and version, so one in two folders is fetched once. */
  const known = new Map<string, SlideRecord>();
  const outcomes: SyncOutcome[] = [];
  const current = new Map<string, SlideRecord[]>();
  /** Every file any snapshot referred to before this run. */
  const before = new Set<string>();
  const previousOf = inUse.map((folderId, i) => {
    const fromLegacy = !stored[i] && folderId === folders.family && legacy !== null;
    const previous = (stored[i] ?? (fromLegacy ? legacy : null))?.slides ?? [];
    for (const r of previous) {
      before.add(r.key);
      known.set(versionKey(r), r);
    }
    return { folderId, previous, fromLegacy };
  });

  let legacyMigrated = false;
  for (const { folderId, previous, fromLegacy } of previousOf) {
    const result = await syncFolder(deps, folderId, previous, known, budget, now);
    outcomes.push(result.outcome);
    current.set(folderId, result.slides ?? previous);
    if (result.slides) {
      await deps.snapshots.putSlides(folderId, {
        slides: result.slides,
        syncedAt: now.toISOString(),
      });
      if (fromLegacy) legacyMigrated = true;
    }
  }

  for (const folderId of index ?? []) {
    if (inUse.includes(folderId)) continue;
    for (const r of (await deps.snapshots.getSlides(folderId))?.slides ?? []) before.add(r.key);
    await deps.snapshots.deleteSlides(folderId);
  }
  await deps.snapshots.putSlidesIndex(inUse);
  // The legacy snapshot goes once the family folder has its own (it stays
  // only while it still stands in for one that could not be listed).
  const legacyStillRead = previousOf.some((p) => p.fromLegacy) && !legacyMigrated;
  if (legacy && !legacyStillRead) {
    for (const r of legacy.slides) before.add(r.key);
    await deps.snapshots.deleteLegacySlides();
  }

  const keep = new Set([...current.values()].flat().map((r) => r.key));
  for (const key of before) {
    if (!keep.has(key)) await deps.photos.delete(key);
  }

  const slideCount = [...current.values()].reduce((n, slides) => n + slides.length, 0);
  const slides = outcomes.reduce<SyncOutcome>(
    (worst, o) => (SEVERITY.indexOf(o) > SEVERITY.indexOf(worst) ? o : worst),
    "skipped",
  );
  return { slides, slideCount };
}

/** One folder's new slide list, or null (keep the previous one) when listing failed. */
async function syncFolder(
  deps: SlideSyncDeps,
  folderId: string,
  previous: SlideRecord[],
  stored: Map<string, SlideRecord>,
  budget: Budget,
  now: Date,
): Promise<{ outcome: SyncOutcome; slides: SlideRecord[] | null }> {
  let items: MediaItem[];
  try {
    items = await deps.media.list(folderId, MAX_SLIDES);
  } catch (error) {
    if (error instanceof GoogleNotConfiguredError) {
      return { outcome: "not-configured", slides: null };
    }
    deps.logger.error("slideshow listing failed", { folderId, error: String(error) });
    return { outcome: "failed", slides: null };
  }

  const known = new Map(previous.map((r) => [r.sourceId, r]));
  const next: SlideRecord[] = [];
  for (const item of items) {
    const old = known.get(item.sourceId);
    const same = stored.get(versionKey(item));
    if (same && (item.kind === "photo" || same.converted)) {
      next.push(same);
      continue;
    }
    if (item.kind === "video") {
      const converted = await videoSlide(deps, item, budget, now);
      if (converted) {
        stored.set(versionKey(converted), converted);
        next.push(converted);
      } else if (old) {
        next.push(old); // until the conversion is ready
      }
      continue;
    }
    if (
      budget.fetched >= MAX_NEW_PER_RUN ||
      budget.bytes + (item.sizeBytes ?? 0) > MAX_BYTES_PER_RUN
    ) {
      if (old) next.push(old); // keep the old version until there is room
      continue;
    }
    try {
      const record = await fetchSlide(deps, item);
      budget.fetched += 1;
      if (!record) continue;
      budget.bytes += record.size;
      stored.set(versionKey(record.slide), record.slide);
      next.push(record.slide);
    } catch (error) {
      deps.logger.warn("slide download failed", { sourceId: item.sourceId, error: String(error) });
      if (old) next.push(old);
    }
  }
  return { outcome: "ok", slides: next };
}

function versionKey(r: { sourceId: string; version: string }): string {
  return `${r.sourceId}\u0000${r.version}`;
}

/**
 * A video's converted slide once the converter has made it. Until then this
 * starts a conversion (a bounded few per run), waits on one in progress, and
 * retries a failed one later, giving up after MAX_CONVERSION_ATTEMPTS.
 */
async function videoSlide(
  deps: SlideSyncDeps,
  item: MediaItem,
  budget: Budget,
  now: Date,
): Promise<SlideRecord | null> {
  if (
    !deps.videos ||
    item.sizeBytes === null ||
    item.sizeBytes > MAX_SOURCE_VIDEO_BYTES ||
    (item.durationMs !== null && item.durationMs > MAX_VIDEO_MS)
  ) {
    return null;
  }
  try {
    const conversion = await deps.conversions.getConversion(item.sourceId, item.version);
    if (conversion?.state === "done" && conversion.sha256 && conversion.key) {
      return {
        sourceId: item.sourceId,
        version: item.version,
        sha256: conversion.sha256,
        kind: "video",
        key: conversion.key,
        contentType: CONVERTED_TYPE,
        converted: true,
      };
    }
    if (conversion) {
      const age = now.getTime() - Date.parse(conversion.at);
      const wait = conversion.state === "pending" ? CONVERSION_STALE_MS : CONVERSION_RETRY_MS;
      if (age < wait || conversion.attempts >= MAX_CONVERSION_ATTEMPTS) return null;
    }
    if (budget.conversions >= MAX_CONVERSIONS_PER_RUN) return null;
    budget.conversions += 1;
    await deps.conversions.putConversion(item.sourceId, item.version, {
      state: "pending",
      at: now.toISOString(),
      attempts: (conversion?.attempts ?? 0) + 1,
    });
    await deps.videos.start(item);
  } catch (error) {
    deps.logger.warn("video conversion not started", {
      sourceId: item.sourceId,
      error: String(error),
    });
  }
  return null;
}

async function fetchSlide(
  deps: SlideSyncDeps,
  item: MediaItem,
): Promise<{ slide: SlideRecord; size: number } | null> {
  const file = await deps.media.download(item);
  const valid = PHOTO_TYPES.some(
    (t) => t === file.contentType && matchesContentType(file.bytes, t),
  );
  if (!valid) {
    deps.logger.warn("slide skipped: unexpected content", {
      sourceId: item.sourceId,
      contentType: file.contentType,
    });
    return null;
  }
  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  const key = `slides/${sha256}.${EXTENSIONS[file.contentType]}`;
  await deps.photos.put(key, file.bytes, file.contentType);
  return {
    slide: {
      sourceId: item.sourceId,
      version: item.version,
      sha256,
      kind: item.kind,
      key,
      contentType: file.contentType,
    },
    size: file.bytes.length,
  };
}
