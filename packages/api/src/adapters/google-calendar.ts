import { addDays, type CalendarEntry, type IsoDate } from "@kids-dash/core";
import { z } from "zod";
import {
  type CalendarReader,
  CalendarRefusedError,
  type CalendarWriter,
  type NewCalendarEvent,
  type StoredCalendarEvent,
} from "../services/ports";
import type { GoogleAuth } from "./google-auth";

const CALENDAR_URL = "https://www.googleapis.com/calendar/v3/calendars";

const Event = z.object({
  id: z.string(),
  status: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  start: z.object({ date: z.string().optional(), dateTime: z.string().optional() }),
  end: z.object({ date: z.string().optional(), dateTime: z.string().optional() }),
  recurringEventId: z.string().optional(),
});
type GoogleEvent = z.infer<typeof Event>;

const EventsPage = z.object({
  items: z.array(Event).default([]),
  nextPageToken: z.string().optional(),
});

/** Reads the calendars the Google service account owns or has been shared. */
export class GoogleCalendarReader implements CalendarReader {
  constructor(
    private readonly auth: GoogleAuth,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async listEntries(
    calendarId: string,
    from: IsoDate,
    to: IsoDate,
    timeZone: string,
  ): Promise<CalendarEntry[]> {
    const token = await this.auth.accessToken();
    const entries: CalendarEntry[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        // Generous UTC bounds; occursOn() trims to the family's dates later.
        timeMin: `${addDays(from, -1)}T00:00:00Z`,
        timeMax: `${addDays(to, 1)}T00:00:00Z`,
        singleEvents: "true",
        orderBy: "startTime",
        timeZone,
        maxResults: "250",
        ...(pageToken ? { pageToken } : {}),
      });
      const response = await this.fetchFn(
        `${CALENDAR_URL}/${encodeURIComponent(calendarId)}/events?${params}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      if (!response.ok) {
        throw new Error(`Google Calendar ${calendarId} answered ${response.status}`);
      }
      const page = EventsPage.parse(await response.json());
      for (const item of page.items) {
        const entry = toEntry(item);
        if (entry) entries.push(entry);
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    return entries;
  }
}

/**
 * With `timeZone` set, Google returns dateTime in that zone's offset, so the
 * local date and time are simply the string's prefix.
 */
export function toEntry(item: GoogleEvent): CalendarEntry | null {
  if (item.status === "cancelled") return null;
  const start = moment(item.start);
  const end = moment(item.end);
  if (!start || !end) return null;
  return {
    id: item.id,
    title: item.summary ?? "",
    description: item.description ?? null,
    start,
    end,
    allDay: start.time === null,
  };
}

function moment(value: { date?: string; dateTime?: string }) {
  if (value.dateTime)
    return { date: value.dateTime.slice(0, 10), time: value.dateTime.slice(11, 16) };
  if (value.date) return { date: value.date, time: null };
  return null;
}

const InsertedEvent = z.object({ id: z.string().min(1) });

/** Adds and edits events on calendars the service account owns (`calendar.events` scope). */
export class GoogleCalendarWriter implements CalendarWriter {
  constructor(
    private readonly auth: GoogleAuth,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async getEvent(
    calendarId: string,
    eventId: string,
    timeZone: string,
  ): Promise<StoredCalendarEvent | null> {
    const token = await this.auth.accessToken();
    const response = await this.fetchFn(
      `${eventUrl(calendarId, eventId)}?${new URLSearchParams({ timeZone })}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    // 404: not on this calendar. 410: deleted.
    if (response.status === 404 || response.status === 410) return null;
    if (!response.ok) {
      throw new Error(`Google Calendar ${calendarId} get answered ${response.status}`);
    }
    const item = Event.parse(await response.json());
    const entry = toEntry(item);
    if (!entry) return null;
    const start = item.start.dateTime ? Date.parse(item.start.dateTime) : Number.NaN;
    const end = item.end.dateTime ? Date.parse(item.end.dateTime) : Number.NaN;
    return {
      ...entry,
      seriesId: item.recurringEventId ?? null,
      durationMinutes:
        Number.isFinite(start) && Number.isFinite(end) ? Math.round((end - start) / 60_000) : null,
    };
  }

  async updateEvent(calendarId: string, eventId: string, event: NewCalendarEvent): Promise<void> {
    const token = await this.auth.accessToken();
    const response = await this.fetchFn(eventUrl(calendarId, eventId), {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        summary: event.title,
        description: event.description,
        ...eventTimes(event),
      }),
    });
    refused(response, calendarId, "update");
  }

  async moveEvent(calendarId: string, eventId: string, destinationId: string): Promise<void> {
    const token = await this.auth.accessToken();
    const response = await this.fetchFn(
      `${eventUrl(calendarId, eventId)}/move?${new URLSearchParams({ destination: destinationId })}`,
      { method: "POST", headers: { authorization: `Bearer ${token}` } },
    );
    refused(response, calendarId, "move");
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    const token = await this.auth.accessToken();
    const response = await this.fetchFn(eventUrl(calendarId, eventId), {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    // 410: already deleted (or that occurrence already cancelled).
    if (response.status === 410) return;
    refused(response, calendarId, "delete");
  }

  async insertEvent(calendarId: string, event: NewCalendarEvent): Promise<string> {
    const token = await this.auth.accessToken();
    const response = await this.fetchFn(
      `${CALENDAR_URL}/${encodeURIComponent(calendarId)}/events`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          summary: event.title,
          description: event.description,
          ...eventTimes(event),
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`Google Calendar ${calendarId} insert answered ${response.status}`);
    }
    return InsertedEvent.parse(await response.json()).id;
  }
}

function eventUrl(calendarId: string, eventId: string): string {
  return `${CALENDAR_URL}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
}

/** Throws for a failed write: CalendarRefusedError when Google says no rather than fails. */
function refused(response: Response, calendarId: string, what: string): void {
  if (response.ok) return;
  const message = `Google Calendar ${calendarId} ${what} answered ${response.status}`;
  if ([400, 403, 404, 410].includes(response.status)) throw new CalendarRefusedError(message);
  throw new Error(message);
}

/**
 * Google's start/end. All day: exclusive end date (`days` long). Timed: real instants with
 * the zone's offset at each end, so an event crossing midnight or a DST change
 * lasts exactly `durationMinutes`.
 */
export function eventTimes(event: NewCalendarEvent) {
  if (event.time === null) {
    return {
      start: { date: event.date },
      end: { date: addDays(event.date, Math.max(1, event.days ?? 1)) },
    };
  }
  const start = zonedInstant(event.date, event.time, event.timeZone);
  const end = start + event.durationMinutes * 60_000;
  return {
    start: { dateTime: offsetDateTime(start, event.timeZone), timeZone: event.timeZone },
    end: { dateTime: offsetDateTime(end, event.timeZone), timeZone: event.timeZone },
  };
}

/**
 * The instant a wall-clock date and time names in `timeZone`. A time that
 * does not exist (skipped by a DST change) lands just after the gap.
 */
export function zonedInstant(date: IsoDate, time: string, timeZone: string): number {
  const wall = Date.parse(`${date}T${time}:00Z`);
  const first = wall - zoneOffsetMs(wall, timeZone);
  const second = wall - zoneOffsetMs(first, timeZone);
  return second + zoneOffsetMs(second, timeZone) === wall ? second : first;
}

/** `YYYY-MM-DDTHH:MM:SS±HH:MM` in `timeZone`. */
export function offsetDateTime(instant: number, timeZone: string): string {
  const offset = zoneOffsetMs(instant, timeZone);
  const local = new Date(instant + offset).toISOString().slice(0, 19);
  const minutes = Math.abs(offset) / 60_000;
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${local}${offset < 0 ? "-" : "+"}${hh}:${mm}`;
}

/** How far `timeZone`'s wall clock is ahead of UTC at `instant`. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return wall - Math.floor(instant / 1000) * 1000;
}
