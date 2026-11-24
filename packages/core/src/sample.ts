import { addDays, type IsoDate, type LocalTime } from "./dates";
import type { Owner, PlannedEvent } from "./family";
import { defaultBadge, type EventSticker, inferEventSticker } from "./stickers";

/**
 * A few fields that make a PlannedEvent, for tests and the frame-web preview
 * bundle. Real events only come from Google Calendar (calendar/conventions).
 */
export interface SampleEventInput {
  owner: Owner;
  title: string;
  date: IsoDate;
  /** Omit for an all-day event. */
  time?: LocalTime;
  endTime?: LocalTime;
  /** Last day of a multi-day all-day event (inclusive). */
  endDate?: IsoDate;
  note?: string;
  details?: string;
  special?: boolean;
  badge?: string;
  sticker?: EventSticker;
}

export function sampleEvent(id: string, input: SampleEventInput): PlannedEvent {
  const allDay = input.time === undefined;
  const sticker = input.sticker ?? inferEventSticker(input.title);
  const special = (input.special ?? false) || input.badge !== undefined;
  return {
    id,
    source: "google",
    owner: input.owner,
    title: input.title,
    note: input.note || null,
    details: input.details || null,
    special,
    badge: special ? (input.badge ?? defaultBadge(sticker)) : null,
    sticker,
    start: { date: input.date, time: input.time ?? null },
    end: allDay
      ? { date: addDays(input.endDate ?? input.date, 1), time: null }
      : { date: input.date, time: input.endTime ?? input.time ?? null },
    allDay,
  };
}
