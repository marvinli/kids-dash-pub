import {
  addDays,
  type DashboardBundle,
  EVENT_STICKERS,
  type EventSticker,
  inferEventSticker,
  type Owner,
  type WeekItem,
} from "@kids-dash/core";
import { monthDay, shortTime } from "../format";
import { html, type Raw } from "../html";
import { art, PALETTES } from "../theme";

/** The event being edited, as it was when the form opened. */
export interface Editing {
  /** Bundle id (`g-<google id>`). */
  id: string;
  /** The day it was opened on. */
  from: string;
  /** An occurrence of a repeating event. */
  repeating: boolean;
  title: string;
  sticker: EventSticker;
  /** Its time; null when all day. */
  time: string | null;
  /** Whether it had a time (not all day). */
  timed: boolean;
}

/** The add/edit-event form's state while it is open. */
export interface Draft {
  date: string;
  owner: Owner | null;
  /** null: all day. */
  hour: number | null;
  minute: number;
  title: string;
  /** Picked by hand; otherwise the title (or, when editing, the event's own) decides. */
  sticker: EventSticker | null;
  /** What the kids see: first line on the item, the rest when it is tapped. */
  description: string;
  /** Null when adding. */
  editing: Editing | null;
  /** For a repeating event: this day only, or every time. */
  scope: "one" | "all";
  /** Asking "Delete …?" before deleting the edited event. */
  deleting: boolean;
  saving: boolean;
  error: string | null;
}

export function newDraft(date: string): Draft {
  return {
    date,
    owner: null,
    hour: null,
    minute: 0,
    title: "",
    sticker: null,
    description: "",
    editing: null,
    scope: "one",
    deleting: false,
    saving: false,
    error: null,
  };
}

/** Google's id for one occurrence of a repeating event ends in its start: `_20261118` or `_20261118T210000Z`. */
export function isRepeating(id: string): boolean {
  return /_\d{8}(T\d{6}Z)?$/.test(id);
}

/** Only synced Google events (ids "g-…") can be edited on the frame. */
export function isEditable(id: string): boolean {
  return id.startsWith("g-");
}

/** The form filled in from an event on the week screen, opened on `date`. */
export function editDraft(item: WeekItem, date: string): Draft {
  const [hour, minute] = item.time ? item.time.split(":").map(Number) : [null, 0];
  return {
    ...newDraft(date),
    owner: item.owner,
    hour: hour ?? null,
    minute: minute ?? 0,
    title: item.title,
    description: [item.note, item.details].filter(Boolean).join("\n"),
    editing: {
      id: item.id,
      from: date,
      repeating: isRepeating(item.id),
      title: item.title,
      sticker: item.sticker,
      time: item.time,
      timed: item.time !== null,
    },
  };
}

/** Hours offered as buttons: a family's day, 7 AM to 9 PM (plus an edited event's own). */
export const HOURS = Array.from({ length: 15 }, (_, i) => i + 7);
export const MINUTES = [0, 15, 30, 45];

export function draftTime(d: Draft): string | null {
  return d.hour === null
    ? null
    : `${String(d.hour).padStart(2, "0")}:${String(d.minute).padStart(2, "0")}`;
}

/**
 * The sticker the event will get. A picked one wins. An edited event keeps
 * its own unless its sticker was only inferred from the title and the title
 * changed, as the server's conventions would do.
 */
export function draftSticker(d: Draft): EventSticker {
  if (d.sticker) return d.sticker;
  const e = d.editing;
  if (e && (d.title.trim() === e.title || e.sticker !== inferEventSticker(e.title))) {
    return e.sticker;
  }
  return inferEventSticker(d.title);
}

/**
 * Switches a repeating event between this day and every time. The whole
 * series keeps its day and its all-day-or-timed kind, so those go back to the
 * event's own.
 */
export function withScope(d: Draft, scope: "one" | "all"): Draft {
  const e = d.editing;
  if (!e?.repeating) return d;
  if (scope === "one") return { ...d, scope };
  const back = (d.hour === null) === e.timed;
  const [hour, minute] = e.time ? e.time.split(":").map(Number) : [null, 0];
  return {
    ...d,
    scope,
    date: e.from,
    ...(back ? { hour: hour ?? null, minute: minute ?? 0 } : {}),
  };
}

export function canSave(d: Draft): boolean {
  return d.owner !== null && d.title.trim().length > 0 && !d.saving;
}

/** A repeating event's series can only change its words and time of day. */
function wholeSeries(d: Draft): boolean {
  return d.editing?.repeating === true && d.scope === "all";
}

/** Earliest day the server accepts: yesterday (the midnight edge). */
export function canStepDay(d: Draft, step: number, today: string): boolean {
  if (!d.editing || wholeSeries(d)) return false;
  return step > 0 || d.date > addDays(today, -1);
}

/** Core FrameEventInput for an add; FrameEventEdit (plus `from` and `scope`) for an edit. */
export function draftPayload(d: Draft): string {
  const base = {
    owner: d.owner,
    title: d.title.trim(),
    date: d.date,
    time: draftTime(d),
    sticker: d.sticker,
    description: d.description.trim(),
  };
  return JSON.stringify(
    d.editing
      ? { ...base, from: d.editing.from, scope: d.editing.repeating ? d.scope : "one" }
      : base,
  );
}

function weekdayName(date: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

function hourLabel(hour: number): string {
  return (
    shortTime(`${String(hour).padStart(2, "0")}:00`).replace(":00", "") + (hour < 12 ? "a" : "p")
  );
}

function withOwn(list: number[], own: number | null): number[] {
  return own === null || list.includes(own) ? list : [...list, own].sort((a, b) => a - b);
}

const STATUS: Record<string, string> = {
  invalid: "That didn’t work. Check the title and try again.",
  refused: "Couldn’t change that event. It may have been changed or removed.",
};

/** The question asked before deleting: which occurrences go depends on the scope. */
export function deleteQuestion(d: Draft): string {
  if (!d.editing?.repeating) return "Delete this event?";
  return d.scope === "all" ? "Delete every time it repeats?" : "Delete just this day?";
}

/**
 * Who, when, what: big buttons for everything but the title and the
 * description, which are the only typing. Editing adds a day stepper and, for
 * a repeating event, a "Just this day / Every time" switch. The card carries
 * its own action so taps on it never close the sheet.
 */
export function addEventSheet(d: Draft, bundle: DashboardBundle, canDelete = false): Raw {
  const sticker = draftSticker(d);
  const editing = d.editing;
  const series = wholeSeries(d);
  const isOwner = (o: Owner) =>
    d.owner !== null &&
    d.owner.kind === o.kind &&
    (o.kind === "everyone" || (d.owner.kind === "kid" && d.owner.kidId === o.kidId));
  // A repeating event stays on its own calendar (Google can't move one occurrence).
  const lockedOwner = editing?.repeating === true;
  const who = [
    ...bundle.kids.map((kid) => {
      const p = PALETTES[kid.color];
      const owner: Owner = { kind: "kid", kidId: kid.id };
      if (lockedOwner && !isOwner(owner)) return "";
      return html`<button type="button" class="add-chip who${isOwner(owner) ? " on" : ""}" style="--ink:${p.ink};--chip:${p.chip}" data-action="add-who" data-owner="${kid.id}">${kid.name}</button>`;
    }),
    lockedOwner && !isOwner({ kind: "everyone" })
      ? ""
      : html`<button type="button" class="add-chip who${isOwner({ kind: "everyone" }) ? " on" : ""}" style="--ink:#564a72;--chip:#ece6fb" data-action="add-who" data-owner="everyone">Everyone</button>`,
  ];
  const status = d.saving
    ? d.deleting
      ? "Deleting…"
      : "Saving…"
    : d.error
      ? (STATUS[d.error] ?? "Couldn’t save. Is the frame online?")
      : "";
  const day = `${weekdayName(d.date)}, ${monthDay(d.date)}`;
  const heading = editing
    ? html`<div class="add-head">
        <button type="button" class="add-step" data-action="add-day" data-step="-1" aria-label="Day before"${canStepDay(d, -1, bundle.date) ? "" : html` disabled`}>‹</button>
        <h2 class="sheet-title">${series ? "Every time" : day}</h2>
        <button type="button" class="add-step" data-action="add-day" data-step="1" aria-label="Day after"${canStepDay(d, 1, bundle.date) ? "" : html` disabled`}>›</button>
        ${
          editing.repeating
            ? html`<div class="add-chips add-scope">
                <button type="button" class="add-chip${d.scope === "one" ? " on" : ""}" data-action="add-scope" data-scope="one">Just this day</button>
                <button type="button" class="add-chip${d.scope === "all" ? " on" : ""}" data-action="add-scope" data-scope="all">Every time</button>
              </div>`
            : ""
        }
      </div>`
    : html`<h2 class="sheet-title">Add to ${day}</h2>`;
  // The whole series can't switch between all day and a time.
  const allDayChip =
    series && editing?.timed
      ? ""
      : html`<button type="button" class="add-chip${d.hour === null ? " on" : ""}" data-action="add-allday">All day</button>`;
  const hourChips =
    series && !editing?.timed
      ? []
      : withOwn(HOURS, d.hour).map(
          (h) =>
            html`<button type="button" class="add-chip hour${d.hour === h ? " on" : ""}" data-action="add-hour" data-hour="${String(h)}">${hourLabel(h)}</button>`,
        );
  return html`<div class="sheet-card add-sheet" role="dialog" aria-label="${editing ? "Edit an event" : "Add an event"}" data-action="noop">
    ${heading}
    <div class="add-what">
      <img class="add-sticker" src="${art.sticker(sticker)}" alt="" width="96" height="96">
      <input class="add-title" type="text" maxlength="80" placeholder="What’s happening?" value="${d.title}" autocomplete="off" enterkeyhint="done">
    </div>
    <div class="add-row"><span class="add-label">Who</span><div class="add-chips">${who}</div></div>
    <div class="add-row"><span class="add-label">When</span><div class="add-chips">
      ${allDayChip}
      ${hourChips}
    </div></div>
    ${
      d.hour === null
        ? ""
        : html`<div class="add-row"><span class="add-label"></span><div class="add-chips">${withOwn(
            MINUTES,
            d.minute,
          ).map(
            (m) =>
              html`<button type="button" class="add-chip${d.minute === m ? " on" : ""}" data-action="add-minute" data-minute="${String(m)}">:${String(m).padStart(2, "0")}</button>`,
          )}<span class="add-when">${shortTime(draftTime(d) ?? "00:00")} ${(d.hour ?? 0) < 12 ? "AM" : "PM"}</span></div></div>`
    }
    <div class="add-row"><span class="add-label">Notes</span><textarea class="add-description" rows="2" maxlength="520" placeholder="First line shows on the event; the rest when it’s tapped">${d.description}</textarea></div>
    <div class="add-row"><span class="add-label">Sticker</span><div class="add-stickers">${EVENT_STICKERS.map(
      (s) =>
        html`<button type="button" class="add-sticker-pick${s === sticker ? " on" : ""}" data-action="add-sticker" data-sticker="${s}" aria-label="${s}"><img src="${art.sticker(s)}" alt="" width="52" height="52"></button>`,
    )}</div></div>
    ${
      d.deleting
        ? html`<div class="add-actions confirm-delete">
            <span class="add-status">${d.saving || d.error ? status : deleteQuestion(d)}</span>
            <button type="button" class="nav-button" data-action="add-delete-cancel"${d.saving ? html` disabled` : ""}>Keep</button>
            <button type="button" class="nav-button danger" data-action="add-delete-confirm"${d.saving ? html` disabled` : ""}>Delete</button>
          </div>`
        : html`<div class="add-actions">
            ${editing && canDelete ? html`<button type="button" class="add-delete" data-action="add-delete">Delete</button>` : ""}
            <span class="add-status">${status}</span>
            <button type="button" class="nav-button" data-action="close-sheet">Cancel</button>
            <button type="button" class="nav-button dark" data-action="add-save"${canSave(d) ? "" : html` disabled`}>${editing ? "Save" : "Add"}</button>
          </div>`
    }
  </div>`;
}
