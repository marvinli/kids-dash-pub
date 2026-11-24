import { describe, expect, it } from "vitest";
import { sampleEvent } from "./sample";

describe("sampleEvent", () => {
  it("builds a timed event with an inferred sticker", () => {
    const e = sampleEvent("abc", {
      owner: { kind: "kid", kidId: "theo" },
      title: "Soccer game",
      date: "2026-11-20",
      time: "17:00",
      endTime: "18:00",
      note: "Wear blue",
      details: "Cleats are in the hall closet.",
    });
    expect(e).toEqual({
      id: "abc",
      source: "google",
      owner: { kind: "kid", kidId: "theo" },
      title: "Soccer game",
      note: "Wear blue",
      details: "Cleats are in the hall closet.",
      special: false,
      badge: null,
      sticker: "soccer",
      start: { date: "2026-11-20", time: "17:00" },
      end: { date: "2026-11-20", time: "18:00" },
      allDay: false,
    });
  });

  it("makes all-day events end the day after their last day", () => {
    const e = sampleEvent("x", {
      owner: { kind: "everyone" },
      title: "Break",
      date: "2026-11-25",
      endDate: "2026-11-27",
    });
    expect(e).toMatchObject({ allDay: true, end: { date: "2026-11-28", time: null } });
  });

  it("uses an explicit sticker and badge, which makes it special", () => {
    const e = sampleEvent("x", {
      owner: { kind: "everyone" },
      title: "Visit",
      date: "2026-11-25",
      time: "10:00",
      sticker: "cake",
      badge: "Grandma!",
    });
    expect(e).toMatchObject({
      special: true,
      badge: "Grandma!",
      sticker: "cake",
      end: { time: "10:00" },
    });
  });
});
