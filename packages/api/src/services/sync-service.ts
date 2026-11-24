import {
  addDays,
  daysBetween,
  fromCalendarEntry,
  localDate,
  type Owner,
  PLACE_KINDS,
  type Place,
  type PlannedEvent,
  type Settings,
} from "@kids-dash/core";
import {
  type CalendarReader,
  type Clock,
  type DeviceStore,
  GoogleNotConfiguredError,
  type HistoryReader,
  type Logger,
  type MediaFolderReader,
  type PhotoStore,
  type PlaceCandidate,
  type PlaceReader,
  type SettingsStore,
  type SnapshotStore,
  type TriviaReader,
  type VideoConversionQueue,
  type VideoConversionStore,
  type WeatherReader,
} from "./ports";
import { type SlideSyncResult, syncSlides } from "./slide-sync";

/** Days of calendar to keep: yesterday (for the midnight edge) through the week. */
// Covers the week screen's pages (core WEEK_PAGES_BEFORE/AFTER) with a day to spare.
// Weeks start on Monday, so the week before this one starts up to 13 days back.
export const SYNC_DAYS_BEFORE = 14;
export const SYNC_DAYS_AFTER = 36;
/** Trivia questions a day, and how many asked-before ids to remember. */
export const TRIVIA_PER_DAY = 3;
const TRIVIA_CANDIDATES = 20;
const TRIVIA_REMEMBER = 3000;
/** Place lists are refetched this often (Wikidata's query service is the fragile part). */
export const PLACES_MAX_AGE_MS = 30 * 24 * 60 * 60_000;
const PLACES_REMEMBER = 500;

/** The id a Google event has in the calendar snapshot (and so in the bundle). */
export function snapshotEventId(googleEventId: string): string {
  return `g-${googleEventId}`;
}

export type SyncOutcome = "ok" | "skipped" | "not-configured" | "failed";

export interface CalendarSyncResult {
  calendar: SyncOutcome;
  events: number;
}

export interface SyncResult extends SlideSyncResult, CalendarSyncResult {
  weather: SyncOutcome;
  trivia: SyncOutcome;
  history: SyncOutcome;
  place: SyncOutcome;
}

export interface SyncServiceDeps {
  clock: Clock;
  settings: SettingsStore;
  snapshots: SnapshotStore;
  devices: DeviceStore;
  calendar: CalendarReader;
  weather: WeatherReader;
  trivia: TriviaReader;
  history: HistoryReader;
  places: PlaceReader;
  /** For picking the day's place; tests pass their own. */
  random?: () => number;
  media: MediaFolderReader;
  photos: PhotoStore;
  conversions: VideoConversionStore;
  /** Null where videos cannot be converted (they are then left out). */
  videos: VideoConversionQueue | null;
  logger: Logger;
}

/**
 * Copies Google Calendar, the forecast and the slideshow folder into
 * snapshots so the device API never waits on, or fails because of, a third
 * party. A failed source keeps its previous snapshot; sources fail
 * independently.
 */
export class SyncService {
  constructor(private readonly deps: SyncServiceDeps) {}

  async run(): Promise<SyncResult> {
    const settings = await this.deps.settings.get();
    if (!settings) {
      return {
        calendar: "skipped",
        events: 0,
        weather: "skipped",
        trivia: "skipped",
        history: "skipped",
        place: "skipped",
        slides: "skipped",
        slideCount: 0,
      };
    }
    const now = this.deps.clock.now();
    const today = localDate(now, settings.timezone);

    const [calendar, weather, trivia, facts, slides] = await Promise.all([
      this.calendarFor(settings, now),
      this.syncWeather(settings, today, now),
      this.syncTrivia(today, now),
      this.syncToday(today, now),
      this.syncSlides(settings, now),
    ]);
    const result = { ...calendar, weather, trivia, ...facts, ...slides };
    this.deps.logger.info("sync finished", { ...result });
    return result;
  }

  /**
   * Only the calendar snapshot: seconds, not the minutes a slideshow sync can
   * take. Used right after a frame adds an event so the next bundle shows it.
   */
  async syncCalendar(): Promise<CalendarSyncResult> {
    const settings = await this.deps.settings.get();
    if (!settings) return { calendar: "skipped", events: 0 };
    const result = await this.calendarFor(settings, this.deps.clock.now());
    this.deps.logger.info("calendar sync finished", { ...result });
    return result;
  }

  private async calendarFor(settings: Settings, now: Date): Promise<CalendarSyncResult> {
    const today = localDate(now, settings.timezone);
    const timeZone = settings.timezone;
    const sources: Array<{ calendarId: string; owner: Owner }> = [
      ...settings.kids.flatMap((kid) =>
        kid.calendarId
          ? [{ calendarId: kid.calendarId, owner: { kind: "kid" as const, kidId: kid.id } }]
          : [],
      ),
      ...settings.sharedCalendarIds.map((calendarId) => ({
        calendarId,
        owner: { kind: "everyone" as const },
      })),
    ];
    if (sources.length === 0) {
      await this.deps.snapshots.putCalendar({ events: [], syncedAt: now.toISOString() });
      return { calendar: "skipped", events: 0 };
    }
    const from = addDays(today, -SYNC_DAYS_BEFORE);
    const to = addDays(today, SYNC_DAYS_AFTER);
    try {
      const perCalendar = await Promise.all(
        sources.map(async ({ calendarId, owner }) => {
          const entries = await this.deps.calendar.listEntries(calendarId, from, to, timeZone);
          return entries
            .map((entry) => fromCalendarEntry({ ...entry, id: snapshotEventId(entry.id) }, owner))
            .filter((e): e is PlannedEvent => e !== null);
        }),
      );
      const events = dedupe(perCalendar.flat());
      await this.deps.snapshots.putCalendar({ events, syncedAt: now.toISOString() });
      return { calendar: "ok", events: events.length };
    } catch (error) {
      if (error instanceof GoogleNotConfiguredError) {
        return { calendar: "not-configured", events: 0 };
      }
      this.deps.logger.error("calendar sync failed", { error: String(error) });
      return { calendar: "failed", events: 0 };
    }
  }

  /** The family's slideshow folder and every active frame's own. */
  private async syncSlides(settings: Settings, now: Date): Promise<SlideSyncResult> {
    const devices = await this.deps.devices.list();
    const others = devices.flatMap((d) =>
      d.role === "device" && !d.revokedAt && d.settings.slideshowFolderId
        ? [d.settings.slideshowFolderId]
        : [],
    );
    return syncSlides(this.deps, { family: settings.slideshowFolderId, others }, now);
  }

  /** Once a day: TRIVIA_PER_DAY questions never asked before. Retried each sync until it works. */
  private async syncTrivia(today: string, now: Date): Promise<SyncOutcome> {
    try {
      const previous = await this.deps.snapshots.getTrivia();
      if (previous?.date === today && previous.questions.length) return "skipped";
      const seen = new Set(previous?.seen ?? []);
      const fresh = (await this.deps.trivia.questions(TRIVIA_CANDIDATES)).filter(
        (q) => !seen.has(q.id),
      );
      const questions = fresh.slice(0, TRIVIA_PER_DAY);
      if (!questions.length) throw new Error("no new trivia questions");
      await this.deps.snapshots.putTrivia({
        date: today,
        questions,
        seen: [...questions.map((q) => q.id), ...(previous?.seen ?? [])].slice(0, TRIVIA_REMEMBER),
        syncedAt: now.toISOString(),
      });
      return "ok";
    } catch (error) {
      this.deps.logger.error("trivia sync failed", { error: String(error) });
      return "failed";
    }
  }

  /**
   * Once a day each: a few things that happened on this date, and a place.
   * A part that fails is retried at the next sync; the other is kept.
   */
  private async syncToday(
    today: string,
    now: Date,
  ): Promise<{ history: SyncOutcome; place: SyncOutcome }> {
    const previous = await this.deps.snapshots.getToday().catch(() => null);
    const same = previous?.date === today;
    let history = same ? previous.history : [];
    let place: Place | null = same ? previous.place : null;
    let placesSeen = previous?.placesSeen ?? [];
    let historyOutcome: SyncOutcome = "skipped";
    let placeOutcome: SyncOutcome = "skipped";
    if (!history.length) {
      try {
        history = await this.deps.history.onThisDay(today);
        historyOutcome = history.length ? "ok" : "failed";
      } catch (error) {
        this.deps.logger.error("history sync failed", { error: String(error) });
        historyOutcome = "failed";
      }
    }
    if (!place) {
      try {
        const pick = await this.pickPlace(today, new Set(placesSeen));
        place = await this.deps.places.describe(pick);
        placesSeen = [pick.id, ...placesSeen].slice(0, PLACES_REMEMBER);
        placeOutcome = "ok";
      } catch (error) {
        this.deps.logger.error("place sync failed", { error: String(error) });
        placeOutcome = "failed";
      }
    }
    if (historyOutcome !== "skipped" || placeOutcome !== "skipped") {
      await this.deps.snapshots.putToday({
        date: today,
        history,
        place,
        placesSeen,
        syncedAt: now.toISOString(),
      });
    }
    return { history: historyOutcome, place: placeOutcome };
  }

  /** Country, US state and big city take turns by day; one not shown lately, at random. */
  private async pickPlace(today: string, seen: Set<string>): Promise<PlaceCandidate> {
    const kind = PLACE_KINDS[daysBetween("1970-01-01", today) % PLACE_KINDS.length] ?? "country";
    const cached = await this.deps.snapshots.getPlaces(kind);
    let candidates = cached?.candidates ?? [];
    const stale = !cached || Date.now() - Date.parse(cached.fetchedAt) > PLACES_MAX_AGE_MS;
    if (stale || !candidates.length) {
      try {
        const fresh = await this.deps.places.candidates(kind);
        if (fresh.length) {
          candidates = fresh;
          await this.deps.snapshots.putPlaces(kind, {
            candidates,
            fetchedAt: new Date().toISOString(),
          });
        }
      } catch (error) {
        // A stale list still does: keep going with it if there is one.
        if (!candidates.length) throw error;
      }
    }
    const unseen = candidates.filter((c) => !seen.has(c.id));
    const pool = unseen.length ? unseen : candidates;
    const pick = pool[Math.floor((this.deps.random ?? Math.random)() * pool.length)];
    if (!pick) throw new Error(`no ${kind} to show`);
    return pick;
  }

  private async syncWeather(settings: Settings, today: string, now: Date): Promise<SyncOutcome> {
    if (!settings.location) return "skipped";
    try {
      const weather = await this.deps.weather.forecast(settings.location, settings.timezone, today);
      await this.deps.snapshots.putWeather({ date: today, weather, syncedAt: now.toISOString() });
      return "ok";
    } catch (error) {
      this.deps.logger.error("weather sync failed", { error: String(error) });
      return "failed";
    }
  }
}

/**
 * The same Google event can sit on several calendars (an invite to a kid's and
 * the shared one). A shared copy already shows in every column, so it wins over
 * kid copies; copies on two kids' calendars stay, one per kid.
 */
export function dedupe(events: PlannedEvent[]): PlannedEvent[] {
  const shared = new Set(events.filter((e) => e.owner.kind === "everyone").map((e) => e.id));
  const seen = new Set<string>();
  return events.filter((e) => {
    if (e.owner.kind === "kid" && shared.has(e.id)) return false;
    const key = `${e.id}|${e.owner.kind === "kid" ? e.owner.kidId : "everyone"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
