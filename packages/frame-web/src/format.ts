import type { LocalTime } from "@kids-dash/core";

/** "16:30" → "4:30" (kids read a 12-hour clock; the period is obvious). */
export function shortTime(time: LocalTime): string {
  const [h = "0", m = "00"] = time.split(":");
  const hour = Number(h) % 12 || 12;
  return `${hour}:${m}`;
}

/** "16:30" → "4:30 PM", for places where the period matters. */
export function longTime(time: LocalTime): string {
  return `${shortTime(time)} ${Number(time.slice(0, 2)) < 12 ? "AM" : "PM"}`;
}

export interface ClockFace {
  time: string;
  period: string;
  date: string;
  hour: number;
}

export function clockFace(now: Date, timeZone: string): ClockFace {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hour24 = Number(
    new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(now),
  );
  return {
    time: `${get("hour")}:${get("minute")}`,
    period: get("dayPeriod").toUpperCase(),
    date: new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(now),
    hour: hour24,
  };
}

/** "07:42" in `timeZone`, comparable with bundle LocalTimes as strings. */
export function localTime(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}

export function greeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** "Maya", "Maya & Theo", "Maya, Theo & Sam". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} & ${names.at(-1)}`;
}

/** "2026-11-16" → "16" and "November 16". */
export function dayOfMonth(date: string): string {
  return String(Number(date.slice(8, 10)));
}

/** "2026-11-18" → "Wednesday". */
export function weekdayLong(date: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

export function monthDay(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}
