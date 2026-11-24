import { describe, expect, it } from "vitest";
import {
  addDays,
  dateRange,
  daysBetween,
  IsoDate,
  LocalTime,
  localDate,
  TimeZone,
  weekdayOf,
} from "./dates";

describe("localDate", () => {
  it("uses the family's timezone, not UTC", () => {
    // 03:30 UTC on the 16th is still the evening of the 15th in New York.
    const instant = new Date("2026-11-16T03:30:00Z");
    expect(localDate(instant, "America/New_York")).toBe("2026-11-15");
    expect(localDate(instant, "Asia/Tokyo")).toBe("2026-11-16");
  });
});

describe("addDays", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("is unaffected by a DST change", () => {
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
  });

  it("rejects malformed dates", () => {
    expect(() => addDays("11/16/2026", 1)).toThrow();
  });
});

describe("weekdays and ranges", () => {
  it("names weekdays", () => {
    expect(weekdayOf("2026-11-15")).toBe("SUN");
    expect(weekdayOf("2026-11-16")).toBe("MON");
    expect(weekdayOf("2026-11-21")).toBe("SAT");
  });

  it("builds consecutive ranges", () => {
    expect(dateRange("2026-11-29", 3)).toEqual(["2026-11-29", "2026-11-30", "2026-12-01"]);
  });
});

describe("schemas", () => {
  it("validates dates, times and zones", () => {
    expect(IsoDate.safeParse("2026-11-16").success).toBe(true);
    expect(IsoDate.safeParse("2026-11-16T00:00").success).toBe(false);
    expect(LocalTime.safeParse("09:05").success).toBe(true);
    expect(LocalTime.safeParse("24:00").success).toBe(false);
    expect(TimeZone.safeParse("America/Los_Angeles").success).toBe(true);
    expect(TimeZone.safeParse("Mars/Olympus").success).toBe(false);
  });
});

describe("daysBetween", () => {
  it("counts calendar days either way, across months and DST changes", () => {
    expect(daysBetween("2026-11-18", "2026-11-21")).toBe(3);
    expect(daysBetween("2026-11-21", "2026-11-18")).toBe(-3);
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2026-11-18", "2026-11-18")).toBe(0);
  });
});
