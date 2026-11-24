import { z } from "zod";
import { IsoDate, LocalTime, TimeZone } from "./dates";
import { ChoreSticker, EventSticker } from "./stickers";

/** Lowercase slug used as a stable id in keys and URLs. */
export const Slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "lowercase letters, digits and dashes, max 40");
export type Slug = z.infer<typeof Slug>;

export const KID_COLORS = ["pink", "blue", "purple", "green", "orange"] as const;
export const KidColor = z.enum(KID_COLORS);
export type KidColor = z.infer<typeof KidColor>;

export const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "expected sha256 hex");

export const KidPhoto = z.object({
  key: z.string().min(1),
  sha256: Sha256Hex,
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
});
export type KidPhoto = z.infer<typeof KidPhoto>;

export const Kid = z.object({
  id: Slug,
  name: z.string().trim().min(1).max(40),
  color: KidColor,
  /** Google calendar whose events belong to this kid. */
  calendarId: z.string().min(1).nullable().default(null),
  photo: KidPhoto.nullable().default(null),
});
export type Kid = z.infer<typeof Kid>;

export const Location = z.object({
  name: z.string().trim().min(1).max(80),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type Location = z.infer<typeof Location>;

/**
 * When the frame's screen is off, in the family's local time. `end` before
 * `start` crosses midnight (20:00 to 06:00 is overnight).
 */
export const SleepWindow = z
  .object({ start: LocalTime, end: LocalTime })
  .refine((w) => w.start !== w.end, "start and end must differ");
export type SleepWindow = z.infer<typeof SleepWindow>;

export const DriveFolderId = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{10,100}$/, "a Google Drive folder id");

export const Settings = z.object({
  timezone: TimeZone,
  location: Location.nullable().default(null),
  kids: z
    .array(Kid)
    .max(6)
    .refine((kids) => new Set(kids.map((k) => k.id)).size === kids.length, "kid ids must be unique")
    .default([]),
  /** Google calendars whose events belong to everyone. */
  sharedCalendarIds: z.array(z.string().min(1)).default([]),
  /** Screen-off hours; null keeps the screen on around the clock. */
  sleep: SleepWindow.nullable().default(null),
  /**
   * Google Drive folder (shared with the service account) whose photos and
   * videos the frame plays when nobody has touched it for a while.
   */
  slideshowFolderId: DriveFolderId.nullable().default(null),
});
export type Settings = z.infer<typeof Settings>;

export const CHORE_PERIODS = ["morning", "afterSchool", "evening"] as const;
export const ChorePeriod = z.enum(CHORE_PERIODS);
export type ChorePeriod = z.infer<typeof ChorePeriod>;

export const Chore = z.object({
  id: Slug,
  kidId: Slug,
  title: z.string().trim().min(1).max(40),
  sticker: ChoreSticker.default("star"),
  period: ChorePeriod.default("morning"),
  /** Weekdays it applies to, 0 = Sunday; empty means every day. */
  days: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  order: z.number().int().min(0).default(0),
});
export type Chore = z.infer<typeof Chore>;

/** Whose column an event or note belongs in. */
export const Owner = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("kid"), kidId: Slug }),
  z.object({ kind: z.literal("everyone") }),
]);
export type Owner = z.infer<typeof Owner>;

export const Note = z.object({
  id: Slug,
  date: IsoDate,
  owner: Owner,
  text: z.string().trim().min(1).max(80),
});
export type Note = z.infer<typeof Note>;

export const EventMoment = z.object({
  date: IsoDate,
  /** Null for all-day events. */
  time: LocalTime.nullable(),
});
export type EventMoment = z.infer<typeof EventMoment>;

/**
 * An event after parsing Google Calendar's description conventions: what the
 * dashboard needs. Events only come from Google Calendar. `end` is exclusive
 * for all-day events, as in iCalendar and Google.
 */
export const PlannedEvent = z.object({
  id: z.string().min(1),
  source: z.literal("google"),
  owner: Owner,
  title: z.string().trim().min(1).max(80),
  note: z.string().max(120).nullable(),
  /** Longer kid-facing text, shown when the item is tapped. */
  details: z.string().max(400).nullable().default(null),
  special: z.boolean(),
  badge: z.string().max(24).nullable(),
  sticker: EventSticker,
  start: EventMoment,
  end: EventMoment,
  allDay: z.boolean(),
});
export type PlannedEvent = z.infer<typeof PlannedEvent>;
