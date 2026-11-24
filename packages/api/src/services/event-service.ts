import {
  addDays,
  daysBetween,
  type EventSticker,
  FrameEventEdit,
  FrameEventId,
  FrameEventInput,
  FrameEventScope,
  localDate,
  type Owner,
  type Settings,
  withKidsText,
} from "@kids-dash/core";
import {
  ForbiddenError,
  InvalidRequestError,
  NotConfiguredError,
  NotFoundError,
  RateLimitedError,
} from "./errors";
import {
  CalendarRefusedError,
  type CalendarWriter,
  type Clock,
  type CounterStore,
  type DeviceStore,
  GoogleNotConfiguredError,
  type Logger,
  type NewCalendarEvent,
  type SettingsStore,
  type StoredCalendarEvent,
} from "./ports";
import { type CalendarSyncResult, snapshotEventId } from "./sync-service";

/** Timed events added on the frame last this long. */
export const FRAME_EVENT_MINUTES = 60;
/** How far from today a frame-added event may be. */
export const FRAME_EVENT_DAYS_BEFORE = 1;
export const FRAME_EVENT_DAYS_AFTER = 366;
/** Events one frame may add or edit per clock hour. */
export const FRAME_EVENTS_PER_HOUR = 20;

export interface EventServiceDeps {
  clock: Clock;
  settings: SettingsStore;
  devices: DeviceStore;
  calendarWriter: CalendarWriter;
  counters: CounterStore;
  /** Refreshes the calendar snapshot (SyncService.syncCalendar). */
  sync: { syncCalendar(): Promise<CalendarSyncResult> };
  logger: Logger;
}

/** Events someone adds on a frame's week screen, written to Google Calendar. */
export class EventService {
  constructor(private readonly deps: EventServiceDeps) {}

  /** Returns the id the event has in the bundle (`g-<google id>`). */
  async addFromFrame(deviceId: string, input: unknown): Promise<{ id: string }> {
    const event = FrameEventInput.parse(input);
    const settings = await this.deps.settings.get();
    if (!settings) throw new NotConfiguredError();

    this.checkDate(settings, event.date);
    const calendarId = calendarFor(settings, event.owner);
    await this.countWrite(deviceId);

    const device = await this.deps.devices.get(deviceId);
    const googleId = await google(() =>
      this.deps.calendarWriter.insertEvent(calendarId, {
        title: event.title,
        description: frameEventDescription(event.sticker, device?.name ?? null, event.description),
        date: event.date,
        time: event.time,
        durationMinutes: FRAME_EVENT_MINUTES,
        timeZone: settings.timezone,
      }),
    );
    this.deps.logger.info("frame added event", { deviceId, calendarId, googleId });
    await this.refresh();
    return { id: snapshotEventId(googleId) };
  }

  /**
   * Edits a Google event someone opened on the frame (`eventId` is its bundle
   * id). Google stays the source of truth: the event is read back, changed
   * there, and the snapshot refreshed. Returns the (unchanged) bundle id.
   */
  async editFromFrame(deviceId: string, eventId: string, input: unknown): Promise<{ id: string }> {
    const googleId = FrameEventId.parse(eventId).slice(2);
    const edit = FrameEventEdit.parse(input);
    const settings = await this.deps.settings.get();
    if (!settings) throw new NotConfiguredError();
    this.checkDate(settings, edit.date);
    const target = calendarFor(settings, edit.owner);
    await this.countWrite(deviceId);

    const found = await google(() => this.find(settings, googleId, target));
    if (!found) throw new NotFoundError("That event is no longer on the calendar");
    const { calendarId, event } = found;
    const timeZone = settings.timezone;

    if (edit.scope === "all" && event.seriesId) {
      if (calendarId !== target || edit.date !== edit.from) {
        throw new InvalidRequestError("Change the day or whose it is for one day only");
      }
      if ((edit.time === null) !== event.allDay) {
        throw new InvalidRequestError("Switch between all day and a time for one day only");
      }
      const seriesId = event.seriesId;
      const series = await google(() =>
        this.deps.calendarWriter.getEvent(calendarId, seriesId, timeZone),
      );
      if (!series) throw new NotFoundError("That repeating event is no longer on the calendar");
      await google(() =>
        this.deps.calendarWriter.updateEvent(calendarId, seriesId, {
          ...changes(series, edit, timeZone),
          // The series keeps its first day; only the time of day changes.
          date: series.start.date,
        }),
      );
      this.deps.logger.info("frame edited series", { deviceId, calendarId, seriesId });
      await this.refresh();
      return { id: snapshotEventId(googleId) };
    }

    if (calendarId !== target) {
      if (event.seriesId) {
        throw new InvalidRequestError("A repeating event can't change whose it is on the frame");
      }
      await google(() => this.deps.calendarWriter.moveEvent(calendarId, googleId, target));
    }
    await google(() =>
      this.deps.calendarWriter.updateEvent(target, googleId, changes(event, edit, timeZone)),
    );
    this.deps.logger.info("frame edited event", { deviceId, calendarId: target, googleId });
    await this.refresh();
    return { id: snapshotEventId(googleId) };
  }

  /**
   * Deletes an event someone removed on the frame, from whichever family
   * calendar has it. For an occurrence of a repeating event, `scope` "one"
   * cancels that day and "all" deletes the whole series.
   */
  async deleteFromFrame(deviceId: string, eventId: string, scope: unknown): Promise<void> {
    const googleId = FrameEventId.parse(eventId).slice(2);
    const which = FrameEventScope.parse(scope ?? "one");
    const settings = await this.deps.settings.get();
    if (!settings) throw new NotConfiguredError();
    await this.countWrite(deviceId);

    const found = await google(() => this.find(settings, googleId, null));
    if (!found) throw new NotFoundError("That event is no longer on the calendar");
    const { calendarId, event } = found;
    const target = which === "all" && event.seriesId ? event.seriesId : googleId;
    await google(() => this.deps.calendarWriter.deleteEvent(calendarId, target));
    this.deps.logger.info("frame deleted event", { deviceId, calendarId, eventId: target });
    await this.refresh();
  }

  /** The event on the calendar it would end up on (when given), else on any other family calendar. */
  private async find(
    settings: Settings,
    googleId: string,
    first: string | null,
  ): Promise<{ calendarId: string; event: StoredCalendarEvent } | null> {
    const calendars = [
      ...(first ? [first] : []),
      ...settings.kids.flatMap((k) => (k.calendarId ? [k.calendarId] : [])),
      ...settings.sharedCalendarIds,
    ];
    for (const calendarId of new Set(calendars)) {
      const event = await this.deps.calendarWriter.getEvent(
        calendarId,
        googleId,
        settings.timezone,
      );
      if (event) return { calendarId, event };
    }
    return null;
  }

  private checkDate(settings: Settings, date: string): void {
    const today = localDate(this.deps.clock.now(), settings.timezone);
    if (
      date < addDays(today, -FRAME_EVENT_DAYS_BEFORE) ||
      date > addDays(today, FRAME_EVENT_DAYS_AFTER)
    ) {
      throw new InvalidRequestError("Events can only be from yesterday to a year ahead");
    }
  }

  /** Adds and edits share one budget per frame per clock hour. */
  private async countWrite(deviceId: string): Promise<void> {
    const now = this.deps.clock.now();
    const hour = now.toISOString().slice(0, 13);
    const count = await this.deps.counters.increment(
      `frame-events#${deviceId}#${hour}`,
      new Date(now.getTime() + 2 * 3600 * 1000),
    );
    if (count > FRAME_EVENTS_PER_HOUR) {
      throw new RateLimitedError("Too many events changed from this frame; try again later");
    }
  }

  /** The change is in Google now; a failed refresh only delays it to the next sync. */
  private async refresh(): Promise<void> {
    const refreshed = await this.deps.sync.syncCalendar();
    if (refreshed.calendar !== "ok") {
      this.deps.logger.warn("calendar refresh after frame event", { ...refreshed });
    }
  }
}

/** Runs a Google call, turning its errors into the API's. */
async function google<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof GoogleNotConfiguredError) {
      throw new NotConfiguredError("Google Calendar is not connected");
    }
    if (error instanceof CalendarRefusedError) {
      throw new ForbiddenError("Google Calendar would not change that event");
    }
    throw error;
  }
}

/**
 * The event's new title, description and times. A timed event keeps its
 * length (an hour when it was all day); an all-day one keeps how many days it
 * covers and moves by as many days as it was dragged (date − from).
 */
export function changes(
  event: StoredCalendarEvent,
  edit: FrameEventEdit,
  timeZone: string,
): NewCalendarEvent {
  const base = {
    title: edit.title,
    description: withKidsText(event.description, edit.description, edit.sticker),
    timeZone,
  };
  if (edit.time === null) {
    const days = event.allDay ? Math.max(1, daysBetween(event.start.date, event.end.date)) : 1;
    const date = event.allDay
      ? addDays(event.start.date, daysBetween(edit.from, edit.date))
      : edit.date;
    return { ...base, date, time: null, days, durationMinutes: FRAME_EVENT_MINUTES };
  }
  return {
    ...base,
    date: edit.date,
    time: edit.time,
    durationMinutes: event.allDay
      ? FRAME_EVENT_MINUTES
      : (event.durationMinutes ?? FRAME_EVENT_MINUTES),
  };
}

function calendarFor(settings: Settings, owner: Owner): string {
  if (owner.kind === "everyone") {
    const shared = settings.sharedCalendarIds[0];
    if (!shared) throw new NotConfiguredError("There is no shared calendar for everyone");
    return shared;
  }
  const kid = settings.kids.find((k) => k.id === owner.kidId);
  if (!kid) throw new InvalidRequestError(`No kid ${owner.kidId}`);
  if (!kid.calendarId) throw new NotConfiguredError(`${kid.name} has no calendar`);
  return kid.calendarId;
}

/**
 * What was typed (note, then details), the directives line, and the
 * parents-only origin line after it. A bare `kids:` when no sticker was
 * picked lets the title infer one.
 */
export function frameEventDescription(
  sticker: EventSticker | null,
  deviceName: string | null,
  text = "",
) {
  const directives = sticker ? `kids: sticker=${sticker}` : "kids:";
  const name = deviceName?.replace(/\s+/g, " ").trim();
  const frame = name ? (/\bframe$/i.test(name) ? name : `${name} frame`) : null;
  const origin = frame ? `Added on the ${frame}.` : "Added on a frame.";
  return withKidsText(`${directives}\n${origin}`, text);
}
