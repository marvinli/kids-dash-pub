import type { DashboardBundle, EventSticker, LocalTime, WeekItem } from "@kids-dash/core";
import { longTime, monthDay } from "../format";
import { html, type Raw } from "../html";
import { art } from "../theme";

/** What the details sheet shows for one tapped item. */
export interface Detail {
  title: string;
  sticker: EventSticker;
  note: string | null;
  details: string | null;
  /** Null for items on today's columns. */
  date: string | null;
  weekday: string | null;
  time: LocalTime | null;
  endTime: LocalTime | null;
}

/**
 * Finds a tappable item by event id: today's columns first (they know the end
 * time), then the week. Items without details are only tappable when they
 * can be edited (`editable`).
 */
export function findDetail(bundle: DashboardBundle, id: string, editable = false): Detail | null {
  const opens = (details: string | null) => details !== null || editable;
  for (const kid of bundle.kids) {
    const item = [...kid.specials, ...kid.activities].find((i) => i.id === id);
    if (item && opens(item.details)) {
      return { ...item, date: null, weekday: null };
    }
  }
  for (const day of bundle.days.length ? bundle.days : bundle.week) {
    const item = day.items.find((i) => i.id === id);
    if (item && opens(item.details)) {
      const today = day.isToday;
      return {
        ...item,
        date: today ? null : day.date,
        weekday: today ? null : day.weekday,
        endTime: null,
      };
    }
  }
  return null;
}

/** The week item and the first day it shows on, for the edit form. */
export function findWeekItem(
  bundle: DashboardBundle,
  id: string,
): { item: WeekItem; date: string } | null {
  for (const day of bundle.days.length ? bundle.days : bundle.week) {
    const item = day.items.find((i) => i.id === id);
    if (item) return { item, date: day.date };
  }
  return null;
}

/**
 * Attributes and hint that make an item open its details when tapped. An
 * editable item opens too (its sheet has an Edit button), but only items with
 * details carry the hint.
 */
export function tappable(
  id: string,
  details: string | null,
  editable = false,
): { attrs: Raw; hint: Raw } {
  if (!details && !editable) return { attrs: html``, hint: html`` };
  if (!details) return { attrs: html` data-action="details" data-item="${id}"`, hint: html`` };
  return {
    attrs: html` data-action="details" data-item="${id}"`,
    // A small ⓘ in the corner: tap me for more.
    hint: html`<span class="tap-hint" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="currentColor"/><circle cx="12" cy="7" r="1.6" fill="#fff"/><path d="M12 10.8v6.4" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></svg></span>`,
  };
}

/** `editId`: show an Edit button that opens the form for that event. */
export function detailSheet(d: Detail, editId: string | null = null): Raw {
  const when = [
    d.weekday && d.date ? `${titleCase(d.weekday)} ${monthDay(d.date)}` : null,
    d.time
      ? d.endTime && d.endTime !== d.time
        ? `${longTime(d.time)} – ${longTime(d.endTime)}`
        : longTime(d.time)
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return html`<div class="sheet-card" role="dialog" aria-label="${d.title}">
    <div class="sheet-head">
      <img src="${art.sticker(d.sticker)}" alt="" width="128" height="128">
      <div class="sheet-title-group">
        <h2 class="sheet-title">${d.title}</h2>
        ${when ? html`<span class="sheet-when">${when}</span>` : ""}
      </div>
    </div>
    ${d.note ? html`<p class="sheet-note">${d.note}</p>` : ""}
    ${d.details ? html`<p class="sheet-details">${d.details}</p>` : ""}
    <div class="sheet-foot">
      <span class="sheet-close">Tap anywhere to close</span>
      ${editId ? html`<button type="button" class="nav-button dark sheet-edit" data-action="edit-event" data-item="${editId}">Edit</button>` : ""}
    </div>
  </div>`;
}

function titleCase(word: string): string {
  return word.charAt(0) + word.slice(1).toLowerCase();
}
