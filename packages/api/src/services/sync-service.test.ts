import { describe, expect, it } from "vitest";
import { FAMILY, fakeWorld } from "../../test/fakes";
import { GoogleNotConfiguredError } from "./ports";
import { dedupe } from "./sync-service";

const entry = (id: string, title: string, description: string | null = null) => ({
  id,
  title,
  description,
  start: { date: "2026-11-16", time: "09:00" },
  end: { date: "2026-11-16", time: "10:00" },
  allDay: false,
});

describe("SyncService", () => {
  it("snapshots each kid's and the shared calendars with owners, and the weather", async () => {
    const w = fakeWorld();
    w.calendar.entries.set("maya@cal", [
      entry("a1", "Field trip", "kids: special"),
      entry("a2", "x", "kids: hide"),
    ]);
    w.calendar.entries.set("family@cal", [entry("f1", "Pizza night")]);

    const result = await w.services.sync.run();

    expect(result).toEqual({
      calendar: "ok",
      events: 2,
      weather: "ok",
      trivia: "ok",
      history: "ok",
      place: "ok",
      slides: "skipped",
      slideCount: 0,
    });
    expect(w.calendar.calls.map((c) => [c.calendarId, c.from, c.to, c.timeZone])).toEqual([
      ["maya@cal", "2026-11-02", "2026-12-22", "America/New_York"],
      ["family@cal", "2026-11-02", "2026-12-22", "America/New_York"],
    ]);
    expect(w.snapshots.calendar?.events.map((e) => [e.id, e.owner, e.special])).toEqual([
      ["g-a1", { kind: "kid", kidId: "maya" }, true],
      ["g-f1", { kind: "everyone" }, false],
    ]);
    expect(w.snapshots.weather).toMatchObject({ date: "2026-11-16", weather: { high: 52 } });
  });

  it("skips everything before settings exist", async () => {
    expect(await fakeWorld(null).services.sync.run()).toEqual({
      calendar: "skipped",
      events: 0,
      weather: "skipped",
      trivia: "skipped",
      history: "skipped",
      place: "skipped",
      slides: "skipped",
      slideCount: 0,
    });
  });

  it("clears the calendar snapshot when no calendars are configured, and skips weather without a location", async () => {
    const w = fakeWorld({
      ...FAMILY,
      location: null,
      sharedCalendarIds: [],
      kids: FAMILY.kids.map((k) => ({ ...k, calendarId: null })),
    });
    w.snapshots.calendar = { events: [], syncedAt: "old" };
    expect(await w.services.sync.run()).toEqual({
      calendar: "skipped",
      events: 0,
      weather: "skipped",
      trivia: "ok",
      history: "ok",
      place: "ok",
      slides: "skipped",
      slideCount: 0,
    });
    expect(w.snapshots.calendar?.syncedAt).toBe("2026-11-16T12:42:00.000Z");
  });

  it("keeps previous snapshots when a source fails, and reports why", async () => {
    const w = fakeWorld();
    w.snapshots.calendar = { events: [], syncedAt: "old" };
    w.calendar.error = new Error("503");
    w.weather.error = new Error("timeout");
    expect(await w.services.sync.run()).toEqual({
      calendar: "failed",
      events: 0,
      weather: "failed",
      trivia: "ok",
      history: "ok",
      place: "ok",
      slides: "skipped",
      slideCount: 0,
    });
    expect(w.snapshots.calendar.syncedAt).toBe("old");
    expect(w.logger.lines.filter((l) => l.level === "error")).toHaveLength(2);
  });

  it("fetches three new trivia questions once a day, never repeating one", async () => {
    const w = fakeWorld();
    await w.services.sync.run();
    expect(w.snapshots.trivia?.date).toBe("2026-11-16");
    expect(w.snapshots.trivia?.questions.map((q) => q.id)).toEqual(["q0", "q1", "q2"]);
    // Later syncs the same day keep today's.
    w.trivia.pool = w.trivia.pool.slice(10);
    expect((await w.services.sync.run()).trivia).toBe("skipped");
    expect(w.snapshots.trivia?.questions.map((q) => q.id)).toEqual(["q0", "q1", "q2"]);
    // The next day: asked ones are skipped even if the source offers them again.
    w.snapshots.trivia = {
      ...(w.snapshots.trivia as NonNullable<typeof w.snapshots.trivia>),
      date: "2026-11-15",
    };
    w.trivia.pool = [
      ...["q1", "q2"].map((id) => ({
        ...(w.trivia.pool[0] as (typeof w.trivia.pool)[number]),
        id,
      })),
      ...w.trivia.pool,
    ];
    expect((await w.services.sync.run()).trivia).toBe("ok");
    expect(w.snapshots.trivia?.questions.map((q) => q.id)).toEqual(["q10", "q11", "q12"]);
    expect(w.snapshots.trivia?.seen.slice(0, 6)).toEqual(["q10", "q11", "q12", "q0", "q1", "q2"]);
  });

  it("keeps yesterday's trivia when the source fails or has nothing new", async () => {
    const w = fakeWorld();
    w.trivia.error = new Error("503");
    expect((await w.services.sync.run()).trivia).toBe("failed");
    expect(w.snapshots.trivia).toBeNull();
    w.trivia.error = null;
    w.trivia.pool = [];
    expect((await w.services.sync.run()).trivia).toBe("failed");
  });

  it("fetches today's history and place once a day, taking turns by kind", async () => {
    const w = fakeWorld();
    const first = await w.services.sync.run();
    expect([first.history, first.place]).toEqual(["ok", "ok"]);
    // 2026-11-16 is day 20408 since 1970: country, state, city take turns; it is a state day.
    expect(w.snapshots.today?.place?.kind).toBe("state");
    expect(w.snapshots.today?.place?.name).toBe("state 1");
    expect(w.snapshots.today?.history.map((e) => e.year)).toEqual([2011]);
    expect(w.places.listed).toEqual(["state"]);
    // Later syncs keep them; the place list is cached.
    const again = await w.services.sync.run();
    expect([again.history, again.place]).toEqual(["skipped", "skipped"]);
    // A new day of the same kind: the one shown is skipped, the list not refetched.
    w.snapshots.today = {
      ...(w.snapshots.today as NonNullable<typeof w.snapshots.today>),
      date: "2026-11-13",
    };
    await w.services.sync.run();
    expect(w.snapshots.today?.place?.name).toBe("state 2");
    expect(w.snapshots.today?.placesSeen).toEqual(["state2", "state1"]);
    expect(w.places.listed).toEqual(["state"]);
  });

  it("keeps the part that worked, and uses a stale place list when Wikidata is down", async () => {
    const w = fakeWorld();
    w.history.error = new Error("503");
    w.places.error = new Error("rate limited");
    const result = await w.services.sync.run();
    expect([result.history, result.place]).toEqual(["failed", "failed"]);
    // A month-old list still serves while the query service refuses.
    w.snapshots.places.set("state", {
      candidates: (w.places.lists.get("state") ?? []).slice(2),
      fetchedAt: "2026-09-01T00:00:00Z",
    });
    w.history.error = null;
    w.history.events = [];
    const next = await w.services.sync.run();
    expect([next.history, next.place]).toEqual(["failed", "ok"]);
    expect(w.snapshots.today?.place?.name).toBe("state 3");
    // With no list at all, the error stands.
    w.snapshots.places.clear();
    w.snapshots.today = null;
    expect((await w.services.sync.run()).place).toBe("failed");
  });

  it("can refresh the calendar alone, without weather or slides", async () => {
    const w = fakeWorld({ ...FAMILY, slideshowFolderId: "folder" });
    w.calendar.entries.set("family@cal", [entry("f1", "Pizza night")]);
    expect(await w.services.sync.syncCalendar()).toEqual({ calendar: "ok", events: 1 });
    expect(w.snapshots.calendar?.events.map((e) => e.id)).toEqual(["g-f1"]);
    expect(w.snapshots.weather).toBeNull();
    expect(w.media.listed).toEqual([]);
    expect(await fakeWorld(null).services.sync.syncCalendar()).toEqual({
      calendar: "skipped",
      events: 0,
    });
  });

  it("reports a calendar without credentials as not configured", async () => {
    const w = fakeWorld();
    w.calendar.error = new GoogleNotConfiguredError();
    expect((await w.services.sync.run()).calendar).toBe("not-configured");
  });
});

describe("dedupe", () => {
  it("prefers the shared copy and keeps one copy per kid", async () => {
    const base = {
      source: "google",
      title: "t",
      note: null,
      details: null,
      special: false,
      badge: null,
      sticker: "star",
      start: { date: "2026-11-16", time: null },
      end: { date: "2026-11-17", time: null },
      allDay: true,
    } as const;
    const maya = { kind: "kid", kidId: "maya" } as const;
    const theo = { kind: "kid", kidId: "theo" } as const;
    const result = dedupe([
      { ...base, id: "x", owner: maya },
      { ...base, id: "x", owner: { kind: "everyone" } },
      { ...base, id: "y", owner: maya },
      { ...base, id: "y", owner: theo },
      { ...base, id: "y", owner: theo },
    ]);
    expect(result.map((e) => [e.id, e.owner.kind === "kid" ? e.owner.kidId : "all"])).toEqual([
      ["x", "all"],
      ["y", "maya"],
      ["y", "theo"],
    ]);
  });
});
