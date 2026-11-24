import { occursOn } from "../calendar/conventions";
import {
  addDays,
  dateRange,
  type IsoDate,
  localDate,
  weekdayIndex,
  weekdayOf,
  weekStart,
} from "../dates";
import type { Chore, Kid, Note, Owner, PlannedEvent, Settings } from "../family";
import { defaultBadge } from "../stickers";
import type { Weather } from "../weather";
import {
  type AppRelease,
  BUNDLE_SCHEMA_VERSION,
  type BundleChore,
  type BundleDevice,
  type BundleKid,
  type DashboardBundle,
  type DayChores,
  type HistoryEvent,
  MAX_SLIDES,
  type Place,
  type Slide,
  type TodayItem,
  type TriviaQuestion,
  type WeekDay,
} from "./schema";

export const WEEK_LENGTH = 7;
/** Weeks (Monday to Sunday) the week screen can page to either side of this one. */
export const WEEK_PAGES_BEFORE = 1;
export const WEEK_PAGES_AFTER = 4;

export interface BundleInputs {
  now: Date;
  settings: Settings;
  events: readonly PlannedEvent[];
  /** Today's forecast, or null when unknown (no location yet, or the fetch failed). */
  weather: Weather | null;
  chores: readonly Chore[];
  notes: readonly Note[];
  /** Keys `${kidId}/${choreId}` checked off today. */
  completed: ReadonlySet<string>;
  /** The same for earlier days the check-off window covers (checkOffFrom); missing dates had none. */
  history?: ReadonlyMap<IsoDate, ReadonlySet<string>>;
  /** Today's trivia questions (none when the sync has not fetched today's). */
  trivia?: readonly TriviaQuestion[];
  /** Today's "on this day" events and place (none when the sync has not fetched today's). */
  onThisDay?: readonly HistoryEvent[];
  place?: Place | null;
  /** Synced slideshow media, newest first. */
  slides?: readonly Slide[];
  app?: AppRelease | null;
  device?: BundleDevice | null;
}

export function completionKey(kidId: string, choreId: string): string {
  return `${kidId}/${choreId}`;
}

/**
 * The first day chores can still be checked off: the start of the week screen's
 * first page (last week's Monday). Days from there to today can be caught up.
 */
export function checkOffFrom(today: IsoDate): IsoDate {
  return addDays(weekStart(today), -WEEK_PAGES_BEFORE * WEEK_LENGTH);
}

/** Everything the frame shows, for "today" in the family's timezone. */
export function assembleBundle(input: BundleInputs): DashboardBundle {
  const { settings, now } = input;
  const today = localDate(now, settings.timezone);
  const monday = weekStart(today);
  const none: ReadonlySet<string> = new Set();
  // Days ahead are never done; earlier ones are as their check-offs left them.
  const doneOn = (date: IsoDate): ReadonlySet<string> =>
    date === today ? input.completed : date < today ? (input.history?.get(date) ?? none) : none;
  const dayChores = (date: IsoDate): DayChores[] =>
    settings.kids
      .map((kid) => ({
        kidId: kid.id,
        chores: choresFor(kid.id, date, input.chores, doneOn(date)),
      }))
      .filter((d) => d.chores.length);
  const kidIds = new Set(settings.kids.map((k) => k.id));
  // Events for kids no longer in settings would have no column to land in.
  const events = input.events.filter(
    (e) => e.owner.kind === "everyone" || kidIds.has(e.owner.kidId),
  );

  return {
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    date: today,
    timezone: settings.timezone,
    location: settings.location?.name ?? null,
    weather: input.weather,
    kids: settings.kids.map((kid) => buildKid(kid, today, events, input)),
    familyNotes: input.notes
      .filter((n) => n.date === today && n.owner.kind === "everyone")
      .map(({ id, text }) => ({ id, text })),
    week: buildDays(monday, WEEK_LENGTH, today, events, dayChores),
    days: buildDays(
      addDays(monday, -WEEK_PAGES_BEFORE * WEEK_LENGTH),
      (WEEK_PAGES_BEFORE + 1 + WEEK_PAGES_AFTER) * WEEK_LENGTH,
      today,
      events,
      dayChores,
    ),
    trivia: [...(input.trivia ?? [])],
    history: [...(input.onThisDay ?? [])],
    place: input.place ?? null,
    sleep: settings.sleep,
    slides: (input.slides ?? []).slice(0, MAX_SLIDES).map(({ sha256, kind }) => ({ sha256, kind })),
    app: input.app ?? null,
    device: input.device ?? null,
  };
}

function belongsTo(owner: Owner, kidId: string): boolean {
  return owner.kind === "everyone" || owner.kidId === kidId;
}

function buildKid(kid: Kid, today: IsoDate, events: readonly PlannedEvent[], input: BundleInputs) {
  const todays = events.filter((e) => belongsTo(e.owner, kid.id) && occursOn(e, today));
  // All-day events today are the day's headline ("No school!"), so they pin too.
  const specials = todays
    .filter((e) => e.special || e.allDay)
    .sort(byTime)
    .map(toTodayItem);
  const activities = todays
    .filter((e) => !e.special && !e.allDay)
    .sort(byTime)
    .map(toTodayItem);

  const result: BundleKid = {
    id: kid.id,
    name: kid.name,
    color: kid.color,
    photo: kid.photo ? { sha256: kid.photo.sha256 } : null,
    specials,
    activities,
    notes: input.notes
      .filter((n) => n.date === today && n.owner.kind === "kid" && n.owner.kidId === kid.id)
      .map(({ id, text }) => ({ id, text })),
    chores: choresFor(kid.id, today, input.chores, input.completed),
  };
  return result;
}

const PERIOD_ORDER = { morning: 0, afterSchool: 1, evening: 2 } as const;

export function choresFor(
  kidId: string,
  date: IsoDate,
  chores: readonly Chore[],
  completed: ReadonlySet<string>,
): BundleChore[] {
  const weekday = weekdayIndex(date);
  return chores
    .filter((c) => c.kidId === kidId && (c.days.length === 0 || c.days.includes(weekday)))
    .sort(
      (a, b) =>
        PERIOD_ORDER[a.period] - PERIOD_ORDER[b.period] ||
        a.order - b.order ||
        a.title.localeCompare(b.title),
    )
    .map((c) => ({
      id: c.id,
      title: c.title,
      sticker: c.sticker,
      period: c.period,
      done: completed.has(completionKey(kidId, c.id)),
    }));
}

function buildDays(
  start: IsoDate,
  count: number,
  today: IsoDate,
  events: readonly PlannedEvent[],
  chores: (date: IsoDate) => DayChores[],
): WeekDay[] {
  return dateRange(start, count).map((date) => ({
    date,
    weekday: weekdayOf(date),
    isToday: date === today,
    chores: chores(date),
    items: events
      .filter((e) => occursOn(e, date))
      .sort(byTime)
      .map((e) => ({
        id: e.id,
        title: e.title,
        owner: e.owner,
        time: e.allDay ? null : e.start.time,
        sticker: e.sticker,
        special: e.special || e.allDay,
        note: e.note,
        details: e.details,
      })),
  }));
}

/** All-day first, then by start time, then title, so output is deterministic. */
function byTime(a: PlannedEvent, b: PlannedEvent): number {
  const ta = a.allDay ? "" : (a.start.time ?? "");
  const tb = b.allDay ? "" : (b.start.time ?? "");
  return ta.localeCompare(tb) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}

function toTodayItem(e: PlannedEvent): TodayItem {
  const special = e.special || e.allDay;
  return {
    id: e.id,
    title: e.title,
    note: e.note,
    details: e.details,
    time: e.allDay ? null : e.start.time,
    endTime: e.allDay || e.end.date !== e.start.date ? null : e.end.time,
    sticker: e.sticker,
    badge: special ? (e.badge ?? defaultBadge(e.sticker)) : null,
  };
}
