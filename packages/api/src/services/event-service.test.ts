import { parseDescription } from "@kids-dash/core";
import { describe, expect, it } from "vitest";
import { deviceRecord, FAMILY, fakeWorld } from "../../test/fakes";
import {
  ConflictError,
  ForbiddenError,
  InvalidRequestError,
  NotConfiguredError,
  NotFoundError,
  RateLimitedError,
} from "./errors";
import { FRAME_EVENTS_PER_HOUR, frameEventDescription } from "./event-service";
import { CalendarRefusedError, GoogleNotConfiguredError, type StoredCalendarEvent } from "./ports";

const DEVICE = "0123456789abcdef";

function setup(settings: Parameters<typeof fakeWorld>[0] = structuredClone(FAMILY)) {
  const w = fakeWorld(settings);
  w.devices.items.set(DEVICE, deviceRecord({ name: "Kitchen" }));
  const add = (input: unknown) => w.services.events.addFromFrame(DEVICE, input);
  return { w, add };
}

describe("EventService.addFromFrame", () => {
  it("adds a kid's timed event to that kid's calendar and refreshes the snapshot", async () => {
    const { w, add } = setup();
    const result = await add({
      owner: { kind: "kid", kidId: "maya" },
      title: "  Soccer  ",
      date: "2026-11-18",
      time: "16:30",
    });

    expect(result).toEqual({ id: "g-new1" });
    expect(w.calendarWriter.inserted).toEqual([
      {
        calendarId: "maya@cal",
        id: "new1",
        event: {
          title: "Soccer",
          description: "kids:\nAdded on the Kitchen frame.",
          date: "2026-11-18",
          time: "16:30",
          durationMinutes: 60,
          timeZone: "America/New_York",
        },
      },
    ]);
    // Only the calendar was synced (no weather, no slides), and it holds the event.
    expect(w.snapshots.weather).toBeNull();
    expect(w.media.listed).toEqual([]);
    expect(w.snapshots.calendar?.events).toContainEqual(
      expect.objectContaining({
        id: "g-new1",
        owner: { kind: "kid", kidId: "maya" },
        title: "Soccer",
        note: null,
        details: null,
        sticker: "soccer",
      }),
    );
  });

  it("puts everyone's all-day events on the first shared calendar with the picked sticker", async () => {
    const { w, add } = setup({ ...FAMILY, sharedCalendarIds: ["family@cal", "other@cal"] });
    const result = await add({
      owner: { kind: "everyone" },
      title: "Grandma visits",
      date: "2026-11-16",
      time: null,
      sticker: "cake",
    });
    expect(result.id).toBe("g-new1");
    expect(w.calendarWriter.inserted[0]).toMatchObject({
      calendarId: "family@cal",
      event: { time: null, description: "kids: sticker=cake\nAdded on the Kitchen frame." },
    });
    expect(w.snapshots.calendar?.events).toContainEqual(
      expect.objectContaining({ id: "g-new1", owner: { kind: "everyone" }, sticker: "cake" }),
    );
  });

  it("still answers with the id when the refresh fails, and logs it", async () => {
    const { w, add } = setup();
    w.calendar.error = new Error("503");
    const result = await add({ owner: { kind: "everyone" }, title: "Pizza", date: "2026-11-17" });
    expect(result).toEqual({ id: "g-new1" });
    expect(w.logger.lines).toContainEqual(
      expect.objectContaining({ level: "warn", message: "calendar refresh after frame event" }),
    );
  });

  it("names an unknown device generically", async () => {
    const { w } = setup();
    await w.services.events.addFromFrame("ffffffffffffffff", {
      owner: { kind: "everyone" },
      title: "x",
      date: "2026-11-17",
    });
    expect(w.calendarWriter.inserted[0]?.event.description).toBe("kids:\nAdded on a frame.");
  });

  it("rejects bad input, unknown kids and far-off dates without writing", async () => {
    const { w, add } = setup();
    const kid = (kidId: string) => ({ kind: "kid", kidId });
    await expect(add({ owner: kid("maya"), title: "", date: "2026-11-17" })).rejects.toThrow();
    await expect(
      add({ owner: kid("maya"), title: "x", date: "2026-11-17", time: "25:00" }),
    ).rejects.toThrow();
    await expect(add({ owner: kid("zed"), title: "x", date: "2026-11-17" })).rejects.toThrow(
      InvalidRequestError,
    );
    // Yesterday is fine (midnight edge); the day before is not, nor over a year out.
    await expect(add({ owner: kid("maya"), title: "x", date: "2026-11-14" })).rejects.toThrow(
      InvalidRequestError,
    );
    await expect(add({ owner: kid("maya"), title: "x", date: "2027-11-18" })).rejects.toThrow(
      InvalidRequestError,
    );
    expect(w.calendarWriter.inserted).toEqual([]);
    await add({ owner: kid("maya"), title: "x", date: "2026-11-15" });
    await add({ owner: kid("maya"), title: "x", date: "2027-11-17" });
    expect(w.calendarWriter.inserted).toHaveLength(2);
  });

  it("needs settings, a calendar for the owner and Google credentials", async () => {
    await expect(
      setup(null).add({ owner: { kind: "everyone" }, title: "x", date: "2026-11-17" }),
    ).rejects.toThrow(NotConfiguredError);

    const { add } = setup({ ...FAMILY, sharedCalendarIds: [] });
    await expect(
      add({ owner: { kind: "everyone" }, title: "x", date: "2026-11-17" }),
    ).rejects.toThrow(/no shared calendar/);
    await expect(
      add({ owner: { kind: "kid", kidId: "theo" }, title: "x", date: "2026-11-17" }),
    ).rejects.toThrow(/Theo has no calendar/);

    const google = setup();
    google.w.calendarWriter.error = new GoogleNotConfiguredError();
    await expect(
      google.add({ owner: { kind: "everyone" }, title: "x", date: "2026-11-17" }),
    ).rejects.toThrow(NotConfiguredError);
    google.w.calendarWriter.error = new ConflictError("other");
    await expect(
      google.add({ owner: { kind: "everyone" }, title: "x", date: "2026-11-17" }),
    ).rejects.toThrow(ConflictError);
  });

  it("limits each frame to a number of events per hour", async () => {
    const { w, add } = setup();
    const input = { owner: { kind: "everyone" }, title: "x", date: "2026-11-17" };
    for (let i = 0; i < FRAME_EVENTS_PER_HOUR; i++) await add(input);
    await expect(add(input)).rejects.toThrow(RateLimitedError);
    expect(w.calendarWriter.inserted).toHaveLength(FRAME_EVENTS_PER_HOUR);
    expect([...w.counters.counts.keys()]).toEqual([`frame-events#${DEVICE}#2026-11-16T12`]);
    expect(w.counters.counts.get(`frame-events#${DEVICE}#2026-11-16T12`)?.expiresAt).toEqual(
      new Date("2026-11-16T14:42:00Z"),
    );
    // The next hour starts afresh.
    w.clock.current = new Date("2026-11-16T13:00:00Z");
    await expect(add(input)).resolves.toEqual({ id: `g-new${FRAME_EVENTS_PER_HOUR + 1}` });
  });
});

describe("frameEventDescription", () => {
  it("never shows the parents-only origin line on the frame", () => {
    for (const sticker of [null, "bus"] as const) {
      for (const name of ["Kitchen", "Living\nroom  frame", null]) {
        const parsed = parseDescription(frameEventDescription(sticker, name));
        expect(parsed).toEqual({
          note: null,
          details: null,
          special: false,
          hidden: false,
          badge: null,
          sticker,
        });
      }
    }
    expect(frameEventDescription("bus", "Living\nroom  frame")).toBe(
      "kids: sticker=bus\nAdded on the Living room frame.",
    );
  });
});

describe("EventService.addFromFrame with a description", () => {
  it("puts the typed note and details above the directives line", async () => {
    const { w, add } = setup();
    await add({
      owner: { kind: "kid", kidId: "maya" },
      title: "Soccer",
      date: "2026-11-18",
      description: "Bring shin guards\nField 3",
    });
    const description = w.calendarWriter.inserted[0]?.event.description;
    expect(description).toBe("Bring shin guards\nField 3\nkids:\nAdded on the Kitchen frame.");
    expect(parseDescription(description)).toMatchObject({
      note: "Bring shin guards",
      details: "Field 3",
    });
  });
});

describe("EventService.editFromFrame", () => {
  const timed = (over: Partial<StoredCalendarEvent> = {}): StoredCalendarEvent => ({
    id: "abc",
    title: "Soccer",
    description: "Old note\nkids: special\nCoach is Sam",
    start: { date: "2026-11-18", time: "16:00" },
    end: { date: "2026-11-18", time: "17:30" },
    allDay: false,
    seriesId: null,
    durationMinutes: 90,
    ...over,
  });
  const edit = (over: Record<string, unknown> = {}) => ({
    owner: { kind: "kid", kidId: "maya" },
    title: "Soccer practice",
    date: "2026-11-18",
    from: "2026-11-18",
    time: "17:00",
    description: "Bring water",
    ...over,
  });
  function seeded(event = timed(), calendarId = "maya@cal") {
    const s = setup();
    s.w.calendarWriter.seed(calendarId, event);
    const save = (input: unknown, id = `g-${event.id}`) =>
      s.w.services.events.editFromFrame(DEVICE, id, input);
    return { ...s, save };
  }

  it("rewrites title, time and kid text in Google, keeping length, directives and parents' lines", async () => {
    const { w, save } = seeded();
    expect(await save(edit())).toEqual({ id: "g-abc" });
    expect(w.calendarWriter.updated).toEqual([
      {
        calendarId: "maya@cal",
        eventId: "abc",
        event: {
          title: "Soccer practice",
          description: "Bring water\nkids: special\nCoach is Sam",
          date: "2026-11-18",
          time: "17:00",
          durationMinutes: 90,
          timeZone: "America/New_York",
        },
      },
    ]);
    expect(w.calendarWriter.moved).toEqual([]);
    // Re-synced: the frame sees the edit on its next poll.
    expect(w.snapshots.calendar?.events).toContainEqual(
      expect.objectContaining({ id: "g-abc", title: "Soccer practice", note: "Bring water" }),
    );
  });

  it("sets a picked sticker and turns a timed event into one all-day event", async () => {
    const { w, save } = seeded();
    await save(edit({ time: null, sticker: "cake", date: "2026-11-19" }));
    expect(w.calendarWriter.updated[0]?.event).toMatchObject({
      date: "2026-11-19",
      time: null,
      days: 1,
      description: "Bring water\nkids: special, sticker=cake\nCoach is Sam",
    });
  });

  it("moves a multi-day all-day event by the days it was moved, keeping its length", async () => {
    const trip = timed({
      start: { date: "2026-11-18", time: null },
      end: { date: "2026-11-21", time: null },
      allDay: true,
      durationMinutes: null,
    });
    const { w, save } = seeded(trip);
    // Opened on its second day (the 19th) and moved to the 20th: one day later.
    await save(edit({ time: null, from: "2026-11-19", date: "2026-11-20" }));
    expect(w.calendarWriter.updated[0]?.event).toMatchObject({
      date: "2026-11-19",
      time: null,
      days: 3,
    });
  });

  it("gives an all-day event a time for an hour", async () => {
    const { w, save } = seeded(
      timed({
        start: { date: "2026-11-18", time: null },
        end: { date: "2026-11-19", time: null },
        allDay: true,
        durationMinutes: null,
      }),
    );
    await save(edit({ time: "09:15" }));
    expect(w.calendarWriter.updated[0]?.event).toMatchObject({
      time: "09:15",
      durationMinutes: 60,
    });
  });

  it("moves the event to the new owner's calendar first", async () => {
    const { w, save } = seeded();
    await save(edit({ owner: { kind: "everyone" } }));
    expect(w.calendarWriter.moved).toEqual([
      { calendarId: "maya@cal", eventId: "abc", destinationId: "family@cal" },
    ]);
    expect(w.calendarWriter.updated[0]?.calendarId).toBe("family@cal");
    expect(w.snapshots.calendar?.events).toContainEqual(
      expect.objectContaining({ id: "g-abc", owner: { kind: "everyone" } }),
    );
  });

  describe("a repeating event", () => {
    const occurrence = timed({ id: "abc_20261118T210000Z", seriesId: "abc" });
    const series = timed({
      id: "abc",
      start: { date: "2026-09-02", time: "16:00" },
      end: { date: "2026-09-02", time: "17:30" },
      description: "Series note\nkids: sticker=soccer",
    });
    function repeating() {
      const s = seeded(occurrence);
      s.w.calendarWriter.seed("maya@cal", series);
      return s;
    }

    it("changes only that day by default", async () => {
      const { w, save } = repeating();
      await save(edit({ date: "2026-11-19" }));
      expect(w.calendarWriter.updated).toEqual([
        expect.objectContaining({ eventId: "abc_20261118T210000Z" }),
      ]);
      expect(w.calendarWriter.updated[0]?.event.date).toBe("2026-11-19");
    });

    it("changes every occurrence through the series, keeping its first day", async () => {
      const { w, save } = repeating();
      expect(await save(edit({ scope: "all" }))).toEqual({ id: "g-abc_20261118T210000Z" });
      expect(w.calendarWriter.updated).toEqual([
        {
          calendarId: "maya@cal",
          eventId: "abc",
          event: {
            title: "Soccer practice",
            description: "Bring water\nkids: sticker=soccer",
            date: "2026-09-02",
            time: "17:00",
            durationMinutes: 90,
            timeZone: "America/New_York",
          },
        },
      ]);
    });

    it("refuses to move the whole series or change whose it is", async () => {
      const { w, save } = repeating();
      await expect(save(edit({ scope: "all", date: "2026-11-19" }))).rejects.toThrow(
        InvalidRequestError,
      );
      await expect(save(edit({ scope: "all", owner: { kind: "everyone" } }))).rejects.toThrow(
        InvalidRequestError,
      );
      await expect(save(edit({ scope: "all", time: null }))).rejects.toThrow(InvalidRequestError);
      // Nor can one occurrence change calendars (Google can't move it alone).
      await expect(save(edit({ owner: { kind: "everyone" } }))).rejects.toThrow(
        /repeating event can't change whose/,
      );
      expect(w.calendarWriter.updated).toEqual([]);
      expect(w.calendarWriter.moved).toEqual([]);
    });

    it("answers not found when the series is gone", async () => {
      const { w, save } = repeating();
      w.calendarWriter.stored.delete("maya@cal/abc");
      await expect(save(edit({ scope: "all" }))).rejects.toThrow(NotFoundError);
    });

    it("treats 'all' on a one-off event as that event", async () => {
      const { w, save } = seeded();
      await save(edit({ scope: "all" }));
      expect(w.calendarWriter.updated[0]?.eventId).toBe("abc");
    });
  });

  it("finds the event on any family calendar", async () => {
    const { w, save } = seeded(timed(), "family@cal");
    await save(edit({ owner: { kind: "everyone" } }));
    expect(w.calendarWriter.moved).toEqual([]);
    expect(w.calendarWriter.updated[0]?.calendarId).toBe("family@cal");
  });

  it("answers not found, forbidden or invalid without writing", async () => {
    const { w, save } = seeded();
    await expect(save(edit(), "g-gone")).rejects.toThrow(NotFoundError);
    await expect(save(edit(), "manual-1")).rejects.toThrow();
    await expect(save(edit({ title: "" }))).rejects.toThrow();
    await expect(save(edit({ date: "2026-11-01" }))).rejects.toThrow(InvalidRequestError);
    expect(w.calendarWriter.updated).toEqual([]);

    w.calendarWriter.error = new CalendarRefusedError("403");
    await expect(save(edit())).rejects.toThrow(ForbiddenError);
    w.calendarWriter.error = new GoogleNotConfiguredError();
    await expect(save(edit())).rejects.toThrow(NotConfiguredError);
  });

  it("shares the hourly limit with adds", async () => {
    const { w, save, add } = seeded();
    for (let i = 0; i < FRAME_EVENTS_PER_HOUR; i++) {
      await add({ owner: { kind: "everyone" }, title: "x", date: "2026-11-17" });
    }
    await expect(save(edit())).rejects.toThrow(RateLimitedError);
    expect(w.calendarWriter.updated).toEqual([]);
  });
});

describe("EventService.deleteFromFrame", () => {
  const stored = (over: Partial<StoredCalendarEvent> = {}): StoredCalendarEvent => ({
    id: "abc",
    title: "Soccer",
    description: null,
    start: { date: "2026-11-18", time: "16:00" },
    end: { date: "2026-11-18", time: "17:30" },
    allDay: false,
    seriesId: null,
    durationMinutes: 90,
    ...over,
  });
  function seeded(events = [stored()], calendarId = "maya@cal") {
    const s = setup();
    for (const event of events) s.w.calendarWriter.seed(calendarId, event);
    const remove = (id: string, scope?: unknown) =>
      s.w.services.events.deleteFromFrame(DEVICE, id, scope);
    return { ...s, remove };
  }

  it("deletes the event from Google and from the refreshed snapshot", async () => {
    const { w, remove } = seeded();
    await w.services.sync.syncCalendar();
    expect(w.snapshots.calendar?.events.map((e) => e.id)).toContain("g-abc");

    await remove("g-abc");
    expect(w.calendarWriter.deleted).toEqual([{ calendarId: "maya@cal", eventId: "abc" }]);
    expect(w.snapshots.calendar?.events.map((e) => e.id)).not.toContain("g-abc");
  });

  describe("a repeating event", () => {
    const occurrence = stored({ id: "abc_20261118T210000Z", seriesId: "abc" });
    const series = stored({ id: "abc", start: { date: "2026-09-02", time: "16:00" } });

    it("cancels only that day by default", async () => {
      const { w, remove } = seeded([occurrence, series]);
      await remove("g-abc_20261118T210000Z");
      expect(w.calendarWriter.deleted).toEqual([
        { calendarId: "maya@cal", eventId: "abc_20261118T210000Z" },
      ]);
    });

    it("deletes the whole series for 'all'", async () => {
      const { w, remove } = seeded([occurrence, series]);
      await remove("g-abc_20261118T210000Z", "all");
      expect(w.calendarWriter.deleted).toEqual([{ calendarId: "maya@cal", eventId: "abc" }]);
    });

    it("treats 'all' on a one-off event as that event", async () => {
      const { w, remove } = seeded();
      await remove("g-abc", "all");
      expect(w.calendarWriter.deleted).toEqual([{ calendarId: "maya@cal", eventId: "abc" }]);
    });
  });

  it("finds the event on any family calendar", async () => {
    const { w, remove } = seeded([stored()], "family@cal");
    await remove("g-abc");
    expect(w.calendarWriter.deleted).toEqual([{ calendarId: "family@cal", eventId: "abc" }]);
  });

  it("answers not found, forbidden or invalid without deleting", async () => {
    const { w, remove } = seeded();
    await expect(remove("g-gone")).rejects.toThrow(NotFoundError);
    await expect(remove("manual-1")).rejects.toThrow();
    await expect(remove("g-abc", "everything")).rejects.toThrow();
    expect(w.calendarWriter.deleted).toEqual([]);

    w.calendarWriter.error = new CalendarRefusedError("403");
    await expect(remove("g-abc")).rejects.toThrow(ForbiddenError);
    w.calendarWriter.error = new GoogleNotConfiguredError();
    await expect(remove("g-abc")).rejects.toThrow(NotConfiguredError);
  });

  it("needs settings", async () => {
    const w = fakeWorld(null);
    await expect(w.services.events.deleteFromFrame(DEVICE, "g-abc", undefined)).rejects.toThrow(
      NotConfiguredError,
    );
  });

  it("shares the hourly limit with adds and edits", async () => {
    const { w, remove, add } = seeded();
    for (let i = 0; i < FRAME_EVENTS_PER_HOUR; i++) {
      await add({ owner: { kind: "everyone" }, title: "x", date: "2026-11-17" });
    }
    await expect(remove("g-abc")).rejects.toThrow(RateLimitedError);
    expect(w.calendarWriter.deleted).toEqual([]);
  });
});
