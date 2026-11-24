import { z } from "zod";

/** A calendar date in the family's timezone, `YYYY-MM-DD`. */
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
export type IsoDate = z.infer<typeof IsoDate>;

/** A wall-clock time in the family's timezone, `HH:MM` (24h). */
export const LocalTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM");
export type LocalTime = z.infer<typeof LocalTime>;

/** An IANA timezone name the runtime's Intl understands, e.g. `America/New_York`. */
export const TimeZone = z.string().refine(isValidTimeZone, "unknown IANA timezone");

export const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The calendar date an instant falls on in `timeZone`. */
export function localDate(instant: Date, timeZone: string): IsoDate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/**
 * Date arithmetic on plain dates. Done in UTC so no timezone or DST transition
 * can shift the result: these are calendar dates, not instants.
 */
export function addDays(date: IsoDate, days: number): IsoDate {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayIndex(date: IsoDate): number {
  return toUtc(date).getUTCDay();
}

/** The Monday that starts `date`'s week (weeks run Monday to Sunday). */
export function weekStart(date: IsoDate): IsoDate {
  return addDays(date, -((weekdayIndex(date) + 6) % 7));
}

export function weekdayOf(date: IsoDate): Weekday {
  return WEEKDAYS[weekdayIndex(date)] as Weekday;
}

/** `days` consecutive dates starting at `start`. */
export function dateRange(start: IsoDate, days: number): IsoDate[] {
  return Array.from({ length: days }, (_, i) => addDays(start, i));
}

function toUtc(date: IsoDate): Date {
  const parsed = IsoDate.parse(date);
  return new Date(`${parsed}T00:00:00Z`);
}
