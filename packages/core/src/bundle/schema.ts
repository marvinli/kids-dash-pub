import { z } from "zod";
import { IsoDate, LocalTime, WEEKDAYS } from "../dates";
import { ChorePeriod, KidColor, Owner, Sha256Hex, SleepWindow, Slug } from "../family";
import { ChoreSticker, EventSticker } from "../stickers";
import { Weather } from "../weather";

/**
 * The one document the frame renders. Versioned: the frame refuses a
 * `schemaVersion` it does not know rather than half-rendering it.
 */
export const BUNDLE_SCHEMA_VERSION = 1;

export const TodayItem = z.object({
  id: z.string(),
  title: z.string(),
  note: z.string().nullable(),
  /** Shown when the item is tapped; null means it is not tappable. */
  details: z.string().nullable().default(null),
  time: LocalTime.nullable(),
  endTime: LocalTime.nullable(),
  sticker: EventSticker,
  /** Set on specials only. */
  badge: z.string().nullable(),
});
export type TodayItem = z.infer<typeof TodayItem>;

export const BundleChore = z.object({
  id: Slug,
  title: z.string(),
  sticker: ChoreSticker,
  period: ChorePeriod,
  done: z.boolean(),
});
export type BundleChore = z.infer<typeof BundleChore>;

export const BundleKid = z.object({
  id: Slug,
  name: z.string(),
  color: KidColor,
  /** Fetch from the device API at `/v1/photos/<kid id>`; verify against sha256. */
  photo: z.object({ sha256: Sha256Hex }).nullable(),
  specials: z.array(TodayItem),
  activities: z.array(TodayItem),
  notes: z.array(z.object({ id: z.string(), text: z.string() })),
  chores: z.array(BundleChore),
});
export type BundleKid = z.infer<typeof BundleKid>;

export const WeekItem = z.object({
  id: z.string(),
  title: z.string(),
  owner: Owner,
  time: LocalTime.nullable(),
  sticker: EventSticker,
  special: z.boolean(),
  note: z.string().nullable().default(null),
  details: z.string().nullable().default(null),
});
export type WeekItem = z.infer<typeof WeekItem>;

/** One kid's chores on one day, with whether each was done (never, for days ahead). */
export const DayChores = z.object({
  kidId: Slug,
  chores: z.array(BundleChore),
});
export type DayChores = z.infer<typeof DayChores>;

export const WeekDay = z.object({
  date: IsoDate,
  weekday: z.enum(WEEKDAYS),
  isToday: z.boolean(),
  items: z.array(WeekItem),
  /** Each kid's chores that day (kids with none are left out); empty from older servers. */
  chores: z.array(DayChores).default([]),
});
export type WeekDay = z.infer<typeof WeekDay>;

/** One multiple-choice trivia question (from The Trivia API, via the server's sync). */
export const TriviaQuestion = z.object({
  id: z.string(),
  /** A short label: "Science", "Geography"… */
  category: z.string(),
  question: z.string(),
  /** In the order to show them; `correct` is the right one's index. */
  answers: z.array(z.string()).min(2).max(6),
  correct: z.number().int().min(0),
});
export type TriviaQuestion = z.infer<typeof TriviaQuestion>;

/** A small picture carried inside the bundle (the frame has no network of its own). */
export const DataImage = z
  .string()
  .max(500_000)
  .regex(/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/);

/** One thing that happened on this date, from Wikipedia's "On this day". */
export const HistoryEvent = z.object({
  year: z.number().int(),
  text: z.string(),
  image: DataImage.nullable(),
});
export type HistoryEvent = z.infer<typeof HistoryEvent>;

export const PLACE_KINDS = ["country", "state", "city"] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

/** The day's place: a country, US state or big city, with its locator map and facts (Wikidata, Wikipedia). */
export const Place = z.object({
  kind: z.enum(PLACE_KINDS),
  name: z.string(),
  /** The country a city is in; null for countries and states. */
  where: z.string().nullable(),
  map: DataImage.nullable(),
  facts: z.array(z.object({ label: z.string(), value: z.string() })).max(4),
  blurb: z.string(),
});
export type Place = z.infer<typeof Place>;

/** Most slides a bundle carries; also caps the frame's storage. */
export const MAX_SLIDES = 100;

export const SLIDE_KINDS = ["photo", "video"] as const;
export type SlideKind = (typeof SLIDE_KINDS)[number];

/** Fetch from the device API at `/v1/slides/<sha256>`; verify against sha256. */
export const Slide = z.object({
  sha256: Sha256Hex,
  kind: z.enum(SLIDE_KINDS),
});
export type Slide = z.infer<typeof Slide>;

/** The frame app every frame should run; fetch `/v1/app/<sha256>` and verify. */
export const AppRelease = z.object({
  versionCode: z.number().int().positive(),
  versionName: z.string(),
  sha256: Sha256Hex,
});
export type AppRelease = z.infer<typeof AppRelease>;

/** Which frame this bundle was made for. */
export const BundleDevice = z.object({
  id: z.string(),
  name: z.string(),
  /** Greet this name instead of the kids' names. */
  greetingName: z.string().nullable().default(null),
});
export type BundleDevice = z.infer<typeof BundleDevice>;

export const DashboardBundle = z.object({
  schemaVersion: z.literal(BUNDLE_SCHEMA_VERSION),
  generatedAt: z.iso.datetime(),
  date: IsoDate,
  timezone: z.string(),
  location: z.string().nullable(),
  weather: Weather.nullable(),
  kids: z.array(BundleKid),
  /** Notes for everyone, shown once rather than in each column. */
  familyNotes: z.array(z.object({ id: z.string(), text: z.string() })),
  /** This week, Monday to Sunday (today is the one with isToday). */
  week: z.array(WeekDay),
  /**
   * Every day from WEEK_PAGES_BEFORE weeks before this one to WEEK_PAGES_AFTER
   * weeks after, so the week screen can page back and forward. Starts on a
   * Monday; pages are Monday-to-Sunday weeks.
   */
  days: z.array(WeekDay).default([]),
  /** Today's trivia, played as a team; empty when the sync has none for today. */
  trivia: z.array(TriviaQuestion).default([]),
  /** A few kid-friendly things that happened on this date; empty when the sync has none. */
  history: z.array(HistoryEvent).default([]),
  /** Today's place to learn about; null when the sync has none. */
  place: Place.nullable().default(null),
  /** Screen-off hours in `timezone`; the frame turns its display off inside them. */
  sleep: SleepWindow.nullable().default(null),
  /** Played full screen when the frame has been left alone (outside sleep). */
  slides: z.array(Slide).max(MAX_SLIDES).default([]),
  /** Latest published frame app; a frame on an older versionCode updates itself. */
  app: AppRelease.nullable().default(null),
  device: BundleDevice.nullable().default(null),
});
export type DashboardBundle = z.infer<typeof DashboardBundle>;

/**
 * What the device API returns. `payload` is the bundle's UTF-8 JSON, base64url;
 * `signature` is base64 DER ECDSA P-256/SHA-256 over those payload bytes.
 */
export const BundleEnvelope = z.object({
  payload: z.string().min(1),
  signature: z.string().min(1),
  keyId: z.string().min(1),
});
export type BundleEnvelope = z.infer<typeof BundleEnvelope>;
