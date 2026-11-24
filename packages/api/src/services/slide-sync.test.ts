import { createHash } from "node:crypto";
import { MAX_SLIDES } from "@kids-dash/core";
import { describe, expect, it } from "vitest";
import { deviceRecord, FAMILY, fakeWorld } from "../../test/fakes";
import { GoogleNotConfiguredError, type MediaItem } from "./ports";
import {
  CONVERSION_RETRY_MS,
  CONVERSION_STALE_MS,
  MAX_CONVERSION_ATTEMPTS,
  MAX_CONVERSIONS_PER_RUN,
  MAX_NEW_PER_RUN,
  MAX_SOURCE_VIDEO_BYTES,
  MAX_VIDEO_MS,
} from "./slide-sync";
import { SyncService } from "./sync-service";

const FOLDER = "1AbCdEfGhIjKlMnOp";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const photo = (id: string, version = "v1"): MediaItem => ({
  sourceId: id,
  version,
  kind: "photo",
  sizeBytes: 1000,
  durationMs: null,
});
const video = (id: string, over: Partial<MediaItem> = {}): MediaItem => ({
  sourceId: id,
  version: "v1",
  kind: "video",
  sizeBytes: 5000,
  durationMs: 10_000,
  ...over,
});

function world(folder: string | null = FOLDER) {
  const w = fakeWorld({ ...FAMILY, slideshowFolderId: folder });
  const bytesFor = (id: string) => new Uint8Array([...JPEG, ...new TextEncoder().encode(id)]);
  const addPhoto = (item: MediaItem) => {
    w.media.items.push(item);
    w.media.files.set(item.sourceId, {
      bytes: bytesFor(item.sourceId + item.version),
      contentType: "image/jpeg",
    });
  };
  return { w, addPhoto, bytesFor };
}

describe("slide sync", () => {
  it("stores new photos and converted videos under their hash and puts them in the bundle", async () => {
    const { w, addPhoto } = world();
    addPhoto(photo("p1"));
    w.media.items.push(video("v1"));

    // The first run stores the photo and starts converting the video.
    expect(await w.services.sync.run()).toMatchObject({ slides: "ok", slideCount: 1 });
    expect(w.videos.started.map((i) => i.sourceId)).toEqual(["v1"]);
    expect(w.conversions.records.get("v1#v1")).toMatchObject({ state: "pending", attempts: 1 });
    expect(w.media.downloads).toEqual(["p1"]);

    // The converter finishes; the next run takes the converted copy.
    w.converter.outputs.set("v1", MP4);
    await w.services.videos.convert(video("v1"));
    const result = await w.services.sync.run();
    expect(result).toMatchObject({ slides: "ok", slideCount: 2 });
    expect(w.videos.started).toHaveLength(1);
    const [p, v] = w.snapshots.slides.get(FOLDER)?.slides ?? [];
    expect(p).toMatchObject({ sourceId: "p1", kind: "photo", contentType: "image/jpeg" });
    expect(p?.key).toBe(`slides/${p?.sha256}.jpg`);
    expect(v).toMatchObject({ key: `slides/${sha(MP4)}.mp4`, kind: "video", converted: true });
    expect(w.photos.objects.get(v?.key ?? "")?.contentType).toBe("video/mp4");

    const bundle = await w.services.bundle.build();
    expect(bundle.slides).toEqual([
      { sha256: p?.sha256, kind: "photo" },
      { sha256: sha(MP4), kind: "video" },
    ]);
  });

  it("downloads each file once, re-fetches changed ones and deletes removed ones", async () => {
    const { w, addPhoto } = world();
    addPhoto(photo("keep"));
    addPhoto(photo("change"));
    addPhoto(photo("drop"));
    await w.services.sync.run();
    const before = new Map(w.snapshots.slides.get(FOLDER)?.slides.map((s) => [s.sourceId, s.key]));

    w.media.items = [];
    w.media.downloads = [];
    addPhoto(photo("keep"));
    addPhoto(photo("change", "v2"));
    await w.services.sync.run();

    expect(w.media.downloads).toEqual(["change"]);
    expect(w.snapshots.slides.get(FOLDER)?.slides.map((s) => s.sourceId)).toEqual([
      "keep",
      "change",
    ]);
    expect(w.photos.objects.has(before.get("keep") ?? "")).toBe(true);
    expect(w.photos.objects.has(before.get("change") ?? "")).toBe(false);
    expect(w.photos.objects.has(before.get("drop") ?? "")).toBe(false);
  });

  it("skips videos that are too long, too big or of unknown size, and bad photos", async () => {
    const { w, addPhoto } = world();
    w.media.items.push(
      video("long", { durationMs: MAX_VIDEO_MS + 1 }),
      video("big", { sizeBytes: MAX_SOURCE_VIDEO_BYTES + 1 }),
      video("unknown", { sizeBytes: null }),
    );
    addPhoto(photo("liar"));
    w.media.files.set("liar", { bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" });
    w.media.items.push(photo("broken"));

    expect(await w.services.sync.run()).toMatchObject({ slides: "ok", slideCount: 0 });
    expect(w.videos.started).toEqual([]);
    expect(w.media.downloads).toEqual(["liar", "broken"]);
    expect(w.logger.lines.filter((l) => l.level === "warn")).toHaveLength(2);
    expect(w.photos.objects.size).toBe(0);
  });

  it("downloads a bounded batch per run and keeps old versions until it gets to them", async () => {
    const { w, addPhoto } = world();
    for (let i = 0; i < MAX_NEW_PER_RUN + 3; i++) addPhoto(photo(`p${i}`));
    expect(await w.services.sync.run()).toMatchObject({ slideCount: MAX_NEW_PER_RUN });
    expect(await w.services.sync.run()).toMatchObject({ slideCount: MAX_NEW_PER_RUN + 3 });

    // A few conversions start per run; the old version of a changed video stays meanwhile.
    const v2 = world();
    v2.w.media.items.push(video("v"));
    v2.w.converter.outputs.set("v", MP4);
    await v2.w.services.sync.run();
    await v2.w.services.videos.convert(video("v"));
    await v2.w.services.sync.run();
    const ids = Array.from({ length: MAX_CONVERSIONS_PER_RUN + 1 }, (_, i) => `n${i}`);
    v2.w.media.items = [...ids.map((id) => video(id)), video("v", { version: "v2" })];
    v2.w.videos.started = [];
    await v2.w.services.sync.run();
    expect(v2.w.videos.started.map((i) => i.sourceId)).toEqual(
      ids.slice(0, MAX_CONVERSIONS_PER_RUN),
    );
    expect(v2.w.snapshots.slides.get(FOLDER)?.slides.map((s) => [s.sourceId, s.version])).toEqual([
      ["v", "v1"],
    ]);
    await v2.w.services.sync.run();
    expect(v2.w.videos.started.map((i) => i.sourceId)).toEqual(
      [...ids, "v"].slice(0, 2 * MAX_CONVERSIONS_PER_RUN),
    );
  });

  it("retries a stalled or failed conversion, then gives up", async () => {
    const { w } = world();
    w.media.items.push(video("v"));
    await w.services.sync.run();
    expect(w.videos.started).toHaveLength(1);

    // Still running: left alone. Stalled: started again.
    w.clock.current = new Date(w.clock.current.getTime() + CONVERSION_STALE_MS - 1);
    await w.services.sync.run();
    expect(w.videos.started).toHaveLength(1);
    w.clock.current = new Date(w.clock.current.getTime() + 2);
    await w.services.sync.run();
    expect(w.videos.started).toHaveLength(2);
    expect(w.conversions.records.get("v#v1")?.attempts).toBe(2);

    // Failed (the fake converter has no output for it): retried after a while.
    await w.services.videos.convert(video("v"));
    expect(w.conversions.records.get("v#v1")).toMatchObject({ state: "failed", attempts: 2 });
    expect(w.conversions.records.get("v#v1")?.error).toMatch(/cannot convert v/);
    await w.services.sync.run();
    expect(w.videos.started).toHaveLength(2);
    w.clock.current = new Date(w.clock.current.getTime() + CONVERSION_RETRY_MS);
    await w.services.sync.run();
    expect(w.videos.started).toHaveLength(MAX_CONVERSION_ATTEMPTS);

    await w.services.videos.convert(video("v"));
    w.clock.current = new Date(w.clock.current.getTime() + CONVERSION_RETRY_MS);
    await w.services.sync.run();
    expect(w.videos.started).toHaveLength(MAX_CONVERSION_ATTEMPTS);
    expect(w.snapshots.slides.get(FOLDER)?.slides).toEqual([]);
  });

  it("replaces a video stored before conversion once its converted copy is ready", async () => {
    const { w } = world();
    const original = {
      sourceId: "v",
      version: "v1",
      sha256: sha(JPEG),
      kind: "video" as const,
      key: `slides/${sha(JPEG)}.mov`,
      contentType: "video/quicktime",
    };
    w.snapshots.slides.set(FOLDER, { slides: [original], syncedAt: "2026-11-16T00:00:00Z" });
    w.snapshots.slidesIndex = [FOLDER];
    await w.photos.put(original.key, JPEG, original.contentType);
    w.media.items.push(video("v"));

    await w.services.sync.run();
    expect(w.videos.started).toHaveLength(1);
    expect(w.snapshots.slides.get(FOLDER)?.slides).toEqual([original]);

    w.converter.outputs.set("v", MP4);
    await w.services.videos.convert(video("v"));
    await w.services.sync.run();
    expect(w.snapshots.slides.get(FOLDER)?.slides.map((s) => s.key)).toEqual([
      `slides/${sha(MP4)}.mp4`,
    ]);
    expect(w.photos.objects.has(original.key)).toBe(false);
  });

  it("leaves videos out where they cannot be converted, and survives a refused start", async () => {
    const { w } = world();
    w.media.items.push(video("v"));
    w.videos.error = new Error("throttled");
    await w.services.sync.run();
    expect(w.logger.lines.find((l) => l.level === "warn")?.message).toBe(
      "video conversion not started",
    );
    expect(w.snapshots.slides.get(FOLDER)?.slides).toEqual([]);

    const off = world();
    off.w.media.items.push(video("v"));
    const sync = new SyncService({ ...off.w, videos: null });
    expect(await sync.run()).toMatchObject({ slides: "ok", slideCount: 0 });
    expect(off.w.conversions.records.size).toBe(0);
  });

  it("caps the slideshow at MAX_SLIDES", async () => {
    const { w, addPhoto } = world();
    for (let i = 0; i < MAX_SLIDES + 10; i++) addPhoto(photo(`p${i}`));
    for (let run = 0; run < 6; run++) await w.services.sync.run();
    expect(w.snapshots.slides.get(FOLDER)?.slides).toHaveLength(MAX_SLIDES);
  });

  it("keeps slides when listing fails, and clears them when the folder is unset", async () => {
    const { w, addPhoto } = world();
    addPhoto(photo("p1"));
    await w.services.sync.run();

    w.media.listError = new Error("503");
    expect(await w.services.sync.run()).toMatchObject({ slides: "failed", slideCount: 1 });
    w.media.listError = new GoogleNotConfiguredError();
    expect(await w.services.sync.run()).toMatchObject({ slides: "not-configured", slideCount: 1 });
    expect(w.snapshots.slides.get(FOLDER)?.slides).toHaveLength(1);

    const settings = await w.settings.get();
    if (!settings) throw new Error("no settings");
    await w.settings.put({ ...settings, slideshowFolderId: null });
    expect(await w.services.sync.run()).toMatchObject({ slides: "skipped", slideCount: 0 });
    expect(w.snapshots.slides.has(FOLDER)).toBe(false);
    expect(w.snapshots.slidesIndex).toEqual([]);
    expect(w.photos.objects.size).toBe(0);
  });

  it("serves slides by hash only while they are in the slideshow", async () => {
    const { w, addPhoto } = world();
    addPhoto(photo("p1"));
    await w.services.sync.run();
    const slide = w.snapshots.slides.get(FOLDER)?.slides[0];
    expect(await w.services.photos.slideUrl(slide?.sha256 ?? "")).toBe(
      `https://photos.example/${slide?.key}?ttl=300`,
    );
    await expect(w.services.photos.slideUrl("0".repeat(64))).rejects.toThrow(/No such slide/);
  });
});

describe("slide sync across folders", () => {
  const OTHER = "2ZyXwVuTsRqPoNmLk";
  const BEDROOM = "bbbbbbbbbbbbbbbb";

  function twoFrames() {
    const { w, bytesFor } = world();
    const file = (item: MediaItem) => {
      w.media.files.set(item.sourceId, {
        bytes: bytesFor(item.sourceId + item.version),
        contentType: "image/jpeg",
      });
      return item;
    };
    w.devices.items.set("aaaaaaaaaaaaaaaa", deviceRecord({ id: "aaaaaaaaaaaaaaaa" }));
    w.devices.items.set(
      BEDROOM,
      deviceRecord({
        id: BEDROOM,
        name: "Bedroom",
        settings: { slideshowFolderId: OTHER, greetingName: null },
      }),
    );
    w.media.folders.set(FOLDER, [file(photo("shared")), file(photo("fam"))]);
    w.media.folders.set(OTHER, [file(photo("own")), file(photo("shared"))]);
    return { w, file };
  }

  it("mirrors the family folder and each frame's own, sharing stored files", async () => {
    const { w } = twoFrames();
    // A revoked frame's and an agent's folders are not synced.
    w.devices.items.set(
      "cccccccccccccccc",
      deviceRecord({
        id: "cccccccccccccccc",
        revokedAt: "t",
        settings: { slideshowFolderId: "revokedFolder123", greetingName: null },
      }),
    );
    w.devices.items.set(
      "dddddddddddddddd",
      deviceRecord({
        id: "dddddddddddddddd",
        role: "agent",
        settings: { slideshowFolderId: "agentFolder12345", greetingName: null },
      }),
    );

    expect(await w.services.sync.run()).toMatchObject({ slides: "ok", slideCount: 4 });
    expect(w.media.listed).toEqual([FOLDER, OTHER]);
    expect(w.media.downloads).toEqual(["shared", "fam", "own"]);
    expect(w.snapshots.slidesIndex).toEqual([FOLDER, OTHER]);
    expect(w.photos.objects.size).toBe(3);

    const kitchen = await w.services.bundle.build("aaaaaaaaaaaaaaaa");
    const bedroom = await w.services.bundle.build(BEDROOM);
    const shas = (b: typeof kitchen) => b.slides.map((s) => s.sha256);
    expect(shas(kitchen)).toHaveLength(2);
    expect(shas(bedroom)).toHaveLength(2);
    expect(shas(bedroom)[1]).toBe(shas(kitchen)[0]);

    // Each frame may fetch only what its own slideshow holds.
    const own = shas(bedroom)[0] ?? "";
    expect(await w.services.photos.slideUrl(own, BEDROOM)).toMatch(/^https:/);
    await expect(w.services.photos.slideUrl(own, "aaaaaaaaaaaaaaaa")).rejects.toThrow(
      /No such slide/,
    );
  });

  it("keeps a file while any folder uses it and drops a folder that falls out of use", async () => {
    const { w } = twoFrames();
    await w.services.sync.run();
    const keyOf = (folder: string, id: string) =>
      w.snapshots.slides.get(folder)?.slides.find((s) => s.sourceId === id)?.key ?? "";
    const shared = keyOf(FOLDER, "shared");
    const own = keyOf(OTHER, "own");

    // Removed from the family folder, still in the bedroom's: kept.
    w.media.folders.set(FOLDER, [photo("fam")]);
    await w.services.sync.run();
    expect(w.photos.objects.has(shared)).toBe(true);

    // The bedroom frame goes back to the family folder.
    await w.services.devices.updateSettings(BEDROOM, { slideshowFolderId: null });
    w.media.downloads = [];
    expect(await w.services.sync.run()).toMatchObject({ slideCount: 1 });
    expect(w.media.downloads).toEqual([]);
    expect(w.snapshots.slides.has(OTHER)).toBe(false);
    expect(w.snapshots.slidesIndex).toEqual([FOLDER]);
    expect(w.photos.objects.has(shared)).toBe(false);
    expect(w.photos.objects.has(own)).toBe(false);
    expect([...w.photos.objects.keys()]).toEqual([keyOf(FOLDER, "fam")]);
  });

  it("shares one download budget across folders", async () => {
    const { w, file } = twoFrames();
    w.media.folders.set(
      FOLDER,
      Array.from({ length: MAX_NEW_PER_RUN - 1 }, (_, i) => file(photo(`f${i}`))),
    );
    w.media.folders.set(OTHER, [file(photo("o1")), file(photo("o2"))]);
    await w.services.sync.run();
    expect(w.media.downloads).toHaveLength(MAX_NEW_PER_RUN);
    expect(w.snapshots.slides.get(OTHER)?.slides.map((s) => s.sourceId)).toEqual(["o1"]);
    await w.services.sync.run();
    expect(w.snapshots.slides.get(OTHER)?.slides.map((s) => s.sourceId)).toEqual(["o1", "o2"]);
  });

  it("keeps a failing folder's slides and reports the worst outcome", async () => {
    const { w } = twoFrames();
    await w.services.sync.run();
    w.media.failing.add(OTHER);
    expect(await w.services.sync.run()).toMatchObject({ slides: "failed", slideCount: 4 });
    expect(w.snapshots.slides.get(OTHER)?.slides).toHaveLength(2);
    expect(w.photos.objects.size).toBe(3);
  });
});

describe("slide sync migration from the single legacy snapshot", () => {
  it("adopts the legacy slides for the family folder without re-downloading", async () => {
    const { w, addPhoto } = world();
    addPhoto(photo("keep"));
    addPhoto(photo("gone"));
    await w.services.sync.run();
    // Rewind to the pre-migration state: one legacy item, no index.
    const legacy = w.snapshots.slides.get(FOLDER) ?? null;
    w.snapshots.legacySlides = legacy;
    w.snapshots.slides.clear();
    w.snapshots.slidesIndex = null;
    const [keep, gone] = legacy?.slides ?? [];

    // Before the first sync the frames still get the legacy slides.
    expect((await w.services.bundle.build()).slides).toHaveLength(2);
    expect(await w.services.photos.slideUrl(keep?.sha256 ?? "")).toMatch(/^https:/);

    w.media.items = w.media.items.filter((i) => i.sourceId === "keep");
    w.media.downloads = [];
    await w.services.sync.run();
    expect(w.media.downloads).toEqual([]);
    expect(w.snapshots.slides.get(FOLDER)?.slides).toEqual([keep]);
    expect(w.snapshots.legacySlides).toBeNull();
    expect(w.photos.objects.has(keep?.key ?? "")).toBe(true);
    expect(w.photos.objects.has(gone?.key ?? "")).toBe(false);
  });

  it("keeps the legacy snapshot while the family folder cannot be listed", async () => {
    const { w } = world();
    const legacy = {
      slides: [
        {
          sourceId: "p",
          version: "v1",
          sha256: "a".repeat(64),
          kind: "photo" as const,
          key: "slides/a.jpg",
          contentType: "image/jpeg",
        },
      ],
      syncedAt: "t",
    };
    w.snapshots.legacySlides = legacy;
    await w.photos.put("slides/a.jpg", JPEG, "image/jpeg");
    w.media.listError = new Error("503");
    expect(await w.services.sync.run()).toMatchObject({ slides: "failed", slideCount: 1 });
    expect(w.snapshots.legacySlides).toEqual(legacy);
    expect(w.photos.objects.has("slides/a.jpg")).toBe(true);

    // With no family folder at all, the legacy slides are retired.
    const settings = await w.settings.get();
    if (!settings) throw new Error("no settings");
    await w.settings.put({ ...settings, slideshowFolderId: null });
    w.media.listError = null;
    expect(await w.services.sync.run()).toMatchObject({ slides: "skipped", slideCount: 0 });
    expect(w.snapshots.legacySlides).toBeNull();
    expect(w.photos.objects.size).toBe(0);
  });
});
