import { createVerify } from "node:crypto";
import {
  BundleEnvelope,
  DashboardBundle,
  type SampleEventInput,
  sampleEvent,
} from "@kids-dash/core";
import { describe, expect, it } from "vitest";
import { deviceRecord, FAMILY, fakeWorld } from "../../test/fakes";
import { contentEtag } from "./bundle-service";
import { NotConfiguredError, NotFoundError } from "./errors";
import type { SlidesSnapshot } from "./ports";

const event = (id: string, input: SampleEventInput) => sampleEvent(id, input);

describe("BundleService.build", () => {
  it("requires settings", async () => {
    const w = fakeWorld(null);
    await expect(w.services.bundle.build()).rejects.toBeInstanceOf(NotConfiguredError);
  });

  it("combines synced events, today's weather, notes and completions", async () => {
    const w = fakeWorld();
    w.snapshots.calendar = {
      syncedAt: "x",
      events: [
        event("g-1", {
          owner: { kind: "kid", kidId: "maya" },
          title: "Ballet",
          date: "2026-11-16",
          time: "16:30",
        }),
        event("g-2", {
          owner: { kind: "kid", kidId: "maya" },
          title: "Field trip",
          date: "2026-11-16",
          time: "09:00",
          special: true,
        }),
      ],
    };
    w.snapshots.weather = {
      date: "2026-11-16",
      weather: {
        high: 52,
        low: 41,
        rainChance: 80,
        code: 61,
        current: null,
        sunrise: null,
        sunset: null,
      },
      syncedAt: "x",
    };
    await w.chores.put({
      id: "bed",
      kidId: "maya",
      title: "Make bed",
      sticker: "bed",
      period: "morning",
      days: [],
      order: 0,
    });
    await w.completions.set("2026-11-16", "maya", "bed", true);
    // Last Wednesday, inside the check-off window: it shows on the week's days.
    await w.completions.set("2026-11-11", "maya", "bed", true);
    await w.notes.put({
      id: "book",
      date: "2026-11-16",
      owner: { kind: "kid", kidId: "maya" },
      text: "Library book",
    });

    const bundle = await w.services.bundle.build();
    const maya = bundle.kids[0];
    expect(maya?.specials.map((s) => s.title)).toEqual(["Field trip"]);
    expect(maya?.activities.map((s) => s.title)).toEqual(["Ballet"]);
    expect(maya?.chores).toEqual([expect.objectContaining({ id: "bed", done: true })]);
    expect(maya?.notes).toEqual([{ id: "book", text: "Library book" }]);
    const doneOn = (date: string) =>
      bundle.days.find((d) => d.date === date)?.chores[0]?.chores[0]?.done;
    expect([doneOn("2026-11-11"), doneOn("2026-11-12"), doneOn("2026-11-16")]).toEqual([
      true,
      false,
      true,
    ]);
    expect(bundle.weather?.high).toBe(52);
  });

  it("carries today's trivia, and none from another day", async () => {
    const w = fakeWorld();
    const questions = [
      { id: "q", category: "Science", question: "Baby seal?", answers: ["Pup", "Kit"], correct: 0 },
    ];
    w.snapshots.trivia = { date: "2026-11-16", questions, seen: ["q"], syncedAt: "x" };
    expect((await w.services.bundle.build()).trivia).toEqual(questions);
    w.snapshots.trivia = { date: "2026-11-15", questions, seen: ["q"], syncedAt: "x" };
    expect((await w.services.bundle.build()).trivia).toEqual([]);
  });

  it("carries today's history and place, and none from another day", async () => {
    const w = fakeWorld();
    const place = {
      kind: "state" as const,
      name: "Vermont",
      where: null,
      map: null,
      facts: [],
      blurb: "Green.",
    };
    const history = [{ year: 2011, text: "Minecraft left beta.", image: null }];
    w.snapshots.today = {
      date: "2026-11-16",
      history,
      place,
      placesSeen: ["Q16551"],
      syncedAt: "x",
    };
    const bundle = await w.services.bundle.build();
    expect(bundle.history).toEqual(history);
    expect(bundle.place).toEqual(place);
    w.snapshots.today = { date: "2026-11-15", history, place, placesSeen: [], syncedAt: "x" };
    const stale = await w.services.bundle.build();
    expect([stale.history, stale.place]).toEqual([[], null]);
  });

  it("ignores a weather snapshot from another day", async () => {
    const w = fakeWorld();
    w.snapshots.weather = {
      date: "2026-11-15",
      weather: {
        high: 1,
        low: 0,
        rainChance: 0,
        code: 0,
        current: null,
        sunrise: null,
        sunset: null,
      },
      syncedAt: "x",
    };
    expect((await w.services.bundle.build()).weather).toBeNull();
  });
});

const slides = (sha: string): SlidesSnapshot => ({
  slides: [
    {
      sourceId: sha,
      version: "1",
      sha256: sha.repeat(64),
      kind: "photo",
      key: `slides/${sha}.jpg`,
      contentType: "image/jpeg",
    },
  ],
  syncedAt: "t",
});

describe("BundleService.build per frame", () => {
  const APP = {
    versionCode: 4,
    versionName: "1.4",
    sha256: "e".repeat(64),
    key: `app/${"e".repeat(64)}.apk`,
    publishedAt: "t",
  };

  it("names the frame, plays its own folder, and carries the current app release", async () => {
    const w = fakeWorld({ ...FAMILY, slideshowFolderId: "family" });
    w.snapshots.slides.set("family", slides("a"));
    w.snapshots.slides.set("bedroom", slides("b"));
    w.snapshots.app = APP;
    await w.devices.put(deviceRecord({ id: "1111111111111111", name: "Kitchen" }));
    await w.devices.put(
      deviceRecord({
        id: "2222222222222222",
        name: "Bedroom",
        settings: { slideshowFolderId: "bedroom", greetingName: "Nana" },
      }),
    );

    const kitchen = await w.services.bundle.build("1111111111111111");
    expect(kitchen.device).toEqual({ id: "1111111111111111", name: "Kitchen", greetingName: null });
    expect(kitchen.slides.map((s) => s.sha256)).toEqual(["a".repeat(64)]);
    expect(kitchen.app).toEqual({ versionCode: 4, versionName: "1.4", sha256: "e".repeat(64) });

    const bedroom = await w.services.bundle.build("2222222222222222");
    expect(bedroom.slides.map((s) => s.sha256)).toEqual(["b".repeat(64)]);
    expect(bedroom.device?.greetingName).toBe("Nana");
    expect(contentEtag(bedroom)).not.toBe(contentEtag(kitchen));

    const preview = await w.services.bundle.build();
    expect(preview.device).toBeNull();
    expect(preview.slides.map((s) => s.sha256)).toEqual(["a".repeat(64)]);
  });

  it("reads the family folder from the legacy snapshot until it is migrated", async () => {
    const w = fakeWorld({ ...FAMILY, slideshowFolderId: "family" });
    w.snapshots.legacySlides = slides("a");
    await w.devices.put(
      deviceRecord({
        id: "2222222222222222",
        settings: { slideshowFolderId: "other", greetingName: null },
      }),
    );
    expect((await w.services.bundle.build()).slides).toHaveLength(1);
    expect((await w.services.bundle.build("2222222222222222")).slides).toEqual([]);
    expect((await w.services.bundle.build()).app).toBeNull();
  });

  it("rejects unknown and revoked frames", async () => {
    const w = fakeWorld();
    await w.devices.put(deviceRecord({ revokedAt: "t" }));
    await expect(w.services.bundle.build("0123456789abcdef")).rejects.toBeInstanceOf(NotFoundError);
    await expect(w.services.bundle.build("ffffffffffffffff")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("BundleService.signed", () => {
  it("signs the exact payload bytes so the frame can verify them", async () => {
    const w = fakeWorld();
    const result = await w.services.bundle.signed(undefined);
    if (result.status !== "ok") throw new Error("expected a bundle");
    const envelope = BundleEnvelope.parse(result.envelope);
    const bytes = Buffer.from(envelope.payload, "base64url");
    const valid = createVerify("SHA256")
      .update(bytes)
      .verify(w.signer.publicKey, Buffer.from(envelope.signature, "base64"));
    expect(valid).toBe(true);
    expect(envelope.keyId).toBe("test-key");
    expect(DashboardBundle.parse(JSON.parse(bytes.toString("utf8"))).date).toBe("2026-11-16");
  });

  it("answers not-modified for the same content, even as time passes", async () => {
    const w = fakeWorld();
    const first = await w.services.bundle.signed(undefined);
    w.clock.current = new Date("2026-11-16T12:50:00Z");
    expect(await w.services.bundle.signed(undefined, first.etag)).toEqual({
      status: "not-modified",
      etag: first.etag,
    });
  });

  it("changes the ETag when content changes", async () => {
    const w = fakeWorld();
    const before = await w.services.bundle.build();
    await w.notes.put({
      id: "n",
      date: "2026-11-16",
      owner: { kind: "everyone" },
      text: "Picture day",
    });
    const after = await w.services.bundle.build();
    expect(contentEtag(after)).not.toBe(contentEtag(before));
    expect(contentEtag({ ...before, generatedAt: "2030-01-01T00:00:00.000Z" })).toBe(
      contentEtag(before),
    );
  });
});
