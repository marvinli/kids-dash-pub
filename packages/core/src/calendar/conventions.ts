import { addDays, type IsoDate } from "../dates";
import type { EventMoment, Owner, PlannedEvent } from "../family";
import { defaultBadge, EventSticker, inferEventSticker } from "../stickers";

/**
 * How we read a Google Calendar event's description (docs/architecture.md):
 *
 *     Sneakers on · packed lunch                      ← note the kids see
 *     Bus leaves at 9. Back by 2:30.                  ← details, shown on tap
 *     kids: special, badge=Field trip, sticker=bus    ← directives
 *     anything else is for parents and never shown
 *
 * Details are only read above a directives line, so an event written before
 * details existed never shows its parent text on the frame.
 */
export interface Directives {
  note: string | null;
  details: string | null;
  special: boolean;
  hidden: boolean;
  badge: string | null;
  sticker: EventSticker | null;
}

const DIRECTIVE_LINE = /^\s*kids\s*:(.*)$/i;
const NOTE_MAX = 120;
export const DETAILS_MAX = 400;
const BADGE_MAX = 24;

export function parseDescription(description: string | null | undefined): Directives {
  const result: Directives = {
    note: null,
    details: null,
    special: false,
    hidden: false,
    badge: null,
    sticker: null,
  };
  if (!description) return result;

  const lines = stripHtml(description)
    .split("\n")
    .map((line) => line.trim());
  const directiveAt = lines.findIndex((line) => DIRECTIVE_LINE.test(line));
  const directive = directiveAt >= 0 ? lines[directiveAt] : undefined;
  const firstAt = lines.findIndex((line) => line.length > 0);
  if (firstAt >= 0 && firstAt !== directiveAt) {
    result.note = (lines[firstAt] ?? "").slice(0, NOTE_MAX);
    if (directiveAt > firstAt) {
      const details = lines
        .slice(firstAt + 1, directiveAt)
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      if (details) result.details = details.slice(0, DETAILS_MAX);
    }
  }

  if (directive) {
    const body = DIRECTIVE_LINE.exec(directive)?.[1] ?? "";
    for (const raw of body.split(",")) {
      const [key = "", ...rest] = raw.split("=");
      const name = key.trim().toLowerCase();
      const value = rest.join("=").trim();
      if (name === "special") result.special = true;
      else if (name === "hide") result.hidden = true;
      else if (name === "badge" && value) result.badge = value.slice(0, BADGE_MAX);
      else if (name === "sticker") {
        const sticker = EventSticker.safeParse(value.toLowerCase());
        if (sticker.success) result.sticker = sticker.data;
      }
    }
  }
  return result;
}

/**
 * Replaces the kid-facing part of a description (the note and details above
 * the directives line) with `text`, keeping the directives line and the
 * parents-only lines below it. `sticker`, when given, replaces or adds the
 * `sticker=` directive. A directives line is added whenever something has to
 * stay below it: details, or parents-only lines of an event that had none.
 * HTML (from Google's web UI) comes back as plain text.
 */
export function withKidsText(
  description: string | null | undefined,
  text: string,
  sticker: EventSticker | null = null,
): string {
  const lines = description ? stripHtml(description).replace(/\r/g, "").split("\n") : [];
  const directiveAt = lines.findIndex((line) => DIRECTIVE_LINE.test(line));
  let directive: string | null = null;
  let rest: string[];
  if (directiveAt >= 0) {
    directive = (lines[directiveAt] ?? "").trim();
    rest = lines.slice(directiveAt + 1);
  } else {
    // Without a directives line only the first line was the kids' (the note).
    const firstAt = lines.findIndex((line) => line.trim().length > 0);
    rest = firstAt >= 0 ? lines.slice(firstAt + 1) : [];
  }
  const kids = kidsLines(text);
  if (sticker) directive = withSticker(directive ?? "kids:", sticker);
  const parentsOnly = rest.some((line) => line.trim().length > 0);
  if (!directive && (kids.length > 1 || parentsOnly)) directive = "kids:";
  return [...kids, ...(directive ? [directive] : []), ...(parentsOnly ? rest : [])]
    .join("\n")
    .trimEnd();
}

/** Typed text as description lines; a line that would read as directives is defused. */
function kidsLines(text: string): string[] {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trimEnd().replace(/^(\s*kids\s*):/i, "$1 -"));
  while (lines.length && !lines[0]?.trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1]?.trim()) lines.pop();
  return lines;
}

function withSticker(directive: string, sticker: EventSticker): string {
  const body = DIRECTIVE_LINE.exec(directive)?.[1] ?? "";
  const kept = body
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part && part.split("=")[0]?.trim().toLowerCase() !== "sticker");
  return `kids: ${[...kept, `sticker=${sticker}`].join(", ")}`;
}

// Google returns descriptions edited in its web UI as HTML.
function stripHtml(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** A Google Calendar event, already normalized to the family's timezone. */
export interface CalendarEntry {
  id: string;
  title: string;
  description: string | null;
  start: EventMoment;
  end: EventMoment;
  allDay: boolean;
}

/** Applies the conventions. Returns null for events marked `hide`. */
export function fromCalendarEntry(entry: CalendarEntry, owner: Owner): PlannedEvent | null {
  const directives = parseDescription(entry.description);
  if (directives.hidden) return null;
  const title = entry.title.trim().slice(0, 80) || "Busy";
  const sticker = directives.sticker ?? inferEventSticker(title);
  const special = directives.special || directives.badge !== null;
  return {
    id: entry.id,
    source: "google",
    owner,
    title,
    note: directives.note,
    details: directives.details,
    special,
    badge: special ? (directives.badge ?? defaultBadge(sticker)) : null,
    sticker,
    start: entry.start,
    end: entry.end,
    allDay: entry.allDay,
  };
}

/**
 * Whether an event shows on `date`. All-day events cover [start, end) like
 * Google's exclusive end date; timed events show on their start date.
 */
export function occursOn(event: Pick<PlannedEvent, "start" | "end" | "allDay">, date: IsoDate) {
  if (!event.allDay) return event.start.date === date;
  const end = event.end.date > event.start.date ? event.end.date : addDays(event.start.date, 1);
  return event.start.date <= date && date < end;
}
