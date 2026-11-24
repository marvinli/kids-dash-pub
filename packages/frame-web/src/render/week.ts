import {
  type DashboardBundle,
  daysBetween,
  type WeekDay,
  type WeekItem,
  weekStart,
} from "@kids-dash/core";
import { dayOfMonth, monthDay, shortTime } from "../format";
import { html, type Raw } from "../html";
import { art, paletteStyle } from "../theme";
import { isEditable } from "./add-event";
import { backArrow, dayProgress, forwardArrow, ownerLabel, type ViewContext } from "./common";
import { tappable } from "./details";
import { fitToBudget } from "./fit";

export const DAY_BUDGET = 700;
const GAP = 10;
/** The Chores module at a day's foot: its frame and label, then a line per kid. */
const CHORES_BASE = 64;
const CHORES_LINE = 34;
/** Item box: padding + sticker/time row + gap, then one title line each. */
const ITEM_BASE = 66;
const TITLE_LINE = 25;
/** Characters a title line holds in a column (bold 21px, ~190px), a little conservative. */
const LINE_CHARS = 15;

/** Lines a title wraps to at LINE_CHARS a line, breaking at spaces like the browser. */
export function titleLines(title: string, perLine = LINE_CHARS): number {
  let lines = 1;
  let used = 0;
  for (const word of title.split(/\s+/).filter(Boolean)) {
    if (word.length > perLine) {
      // An over-long word fills lines on its own.
      lines += (used ? 1 : 0) + Math.ceil(word.length / perLine) - 1;
      used = word.length % perLine || perLine;
      continue;
    }
    const next = used ? used + 1 + word.length : word.length;
    if (next > perLine) {
      lines += 1;
      used = word.length;
    } else {
      used = next;
    }
  }
  return lines;
}

export function itemHeight(item: WeekItem): number {
  return ITEM_BASE + titleLines(item.title) * TITLE_LINE;
}

/** Where this week's Monday is in `days`; -1 without today. */
function mondayAt(bundle: DashboardBundle): number {
  const todayAt = bundle.days.findIndex((d) => d.isToday);
  return todayAt < 0 ? -1 : todayAt - daysBetween(weekStart(bundle.date), bundle.date);
}

/** Pages a bundle offers, as offsets from this week: 0 is this Monday to Sunday. */
export function weekPages(bundle: DashboardBundle): { min: number; max: number } {
  const monday = mondayAt(bundle);
  if (monday < 0) return { min: 0, max: 0 };
  return {
    min: -Math.floor(monday / 7),
    max: Math.max(0, Math.floor((bundle.days.length - monday - 7) / 7)),
  };
}

/** The 7 days of a page, falling back to `week` for bundles without `days`. */
export function weekDays(bundle: DashboardBundle, page: number): WeekDay[] {
  const monday = mondayAt(bundle);
  if (monday < 0) return page === 0 ? bundle.week : [];
  const start = monday + page * 7;
  return start < 0 ? [] : bundle.days.slice(start, start + 7);
}

/** "Nov 16 – 22", or "Nov 30 – Dec 6" across a month end. */
export function dateSpan(first: string, last: string): string {
  return first.slice(0, 7) === last.slice(0, 7)
    ? `${monthDay(first)} – ${dayOfMonth(last)}`
    : `${monthDay(first)} – ${monthDay(last)}`;
}

/** Kid-friendly page names; the dates follow on the same line. */
function pageTitle(page: number): string {
  if (page === 0) return "This week";
  if (page === 1) return "Next week";
  if (page === -1) return "Last week";
  return page > 0 ? `In ${page} weeks` : `${-page} weeks ago`;
}

export function weekScreen(bundle: DashboardBundle, ctx: ViewContext, page = 0): Raw {
  const { min, max } = weekPages(bundle);
  const days = weekDays(bundle, page);
  const first = days[0]?.date;
  const last = days.at(-1)?.date;
  const pager = (step: -1 | 1, disabled: boolean) =>
    html`<button type="button" class="nav-button header-button page-button" data-action="week-page" data-step="${String(step)}" aria-label="${step < 0 ? "Earlier week" : "Later week"}"${disabled ? html` disabled` : ""}>${step < 0 ? backArrow() : forwardArrow()}</button>`;
  // One row: back to Today, the week arrows (fixed in place), then the title and its dates.
  return html`<div class="screen-inner week">
    <header class="top">
      <div class="week-head">
        <button type="button" class="nav-button header-button" data-action="go" data-screen="today">${backArrow()}<span>Today</span></button>
        <div class="week-pager">${pager(-1, page <= min)}${pager(1, page >= max)}</div>
        <h1 class="week-title">${pageTitle(page)}${first && last ? html`<span class="week-dates">${dateSpan(first, last)}</span>` : ""}</h1>
      </div>
    </header>
    <div class="week-grid">${days.map((day) => weekDay(day, bundle, ctx))}</div>
  </div>`;
}

function weekDay(day: WeekDay, bundle: DashboardBundle, ctx: ViewContext): Raw {
  const canAdd = Boolean(ctx.canAddEvents);
  const canEdit = Boolean(ctx.canEditEvents);
  const sized = day.items.map((item) => ({ item, height: itemHeight(item) }));
  const chores = day.chores.length ? CHORES_BASE + CHORES_LINE * day.chores.length + GAP : 0;
  const { shown, hidden } = fitToBudget(sized, DAY_BUDGET - chores, GAP);
  const when = day.isToday ? " is-today" : day.date < bundle.date ? " is-past" : "";
  return html`<section class="card week-day${when}">
    <div class="week-day-head">
      <span class="dow">${day.weekday}</span>
      <span class="dom">${dayOfMonth(day.date)}</span>
      ${canAdd && day.date >= bundle.date ? html`<button type="button" class="add-day" data-action="add" data-date="${day.date}" aria-label="Add an event">+</button>` : ""}
      ${day.isToday ? html`<span class="today-tag">TODAY</span>` : ""}
    </div>
    ${shown.length ? shown.map((item) => weekItem(item, bundle, canEdit)) : html`<span class="week-free">Free day</span>`}
    ${hidden > 0 ? html`<button type="button" class="more-chip" data-action="day" data-date="${day.date}">+${hidden} more</button>` : ""}
    ${day.chores.length ? dayChores(day, bundle, ctx) : ""}
  </section>`;
}

/** The day's chores as a count per kid; a tap opens the Chores screen on that day. */
function dayChores(day: WeekDay, bundle: DashboardBundle, ctx: ViewContext): Raw {
  const lines = bundle.kids.flatMap((kid) => {
    const chores = day.chores.find((d) => d.kidId === kid.id)?.chores;
    if (!chores?.length) return [];
    const { done, total } = dayProgress(kid.id, chores, day.date, ctx);
    return [
      html`<span class="week-chore" style="${paletteStyle(kid.color)}"><span class="week-chore-kid">${kid.name.slice(0, 1)}</span>${done}/${total}</span>`,
    ];
  });
  return html`<button type="button" class="week-chores" data-action="chores" data-date="${day.date}" aria-label="Chores">
    <span class="week-chores-list"><span class="week-chores-label">CHORES</span>${lines}</span>
    <span class="week-chores-go">${forwardArrow()}</span>
  </button>`;
}

/**
 * Every item looks the same: sticker and time on top, the whole title under
 * it, whose it is in a chip. Special ones are tinted in the owner's colour;
 * ones with details carry the "more" tag and open on tap. With `canEdit`,
 * Google events open on tap too, for their Edit button.
 */
export function weekItem(item: WeekItem, bundle: DashboardBundle, canEdit = false): Raw {
  const who = ownerLabel(item.owner, bundle);
  const tap = tappable(item.id, item.details, canEdit && isEditable(item.id));
  return html`<div class="week-item${item.special ? " is-special" : ""}" style="--who:${who.ink};--who-bg:${who.chip}"${tap.attrs}>
    <div class="week-item-top">
      <img src="${art.sticker(item.sticker)}" alt="" width="40" height="40">
      ${item.time ? html`<span class="week-time">${shortTime(item.time)}</span>` : ""}
      <span class="who-chip">${who.name}</span>
    </div>
    <span class="week-item-title">${item.title}</span>
    ${tap.hint}
  </div>`;
}

/** A whole day in the sheet, for columns with more than fits. */
export function daySheet(day: WeekDay, bundle: DashboardBundle, canEdit = false): Raw {
  return html`<div class="sheet-card day-sheet" role="dialog" aria-label="${titleCase(day.weekday)} ${monthDay(day.date)}">
    <h2 class="sheet-title">${titleCase(day.weekday)} ${monthDay(day.date)}</h2>
    <div class="day-sheet-items">${day.items.map((item) => weekItem(item, bundle, canEdit))}</div>
    <span class="sheet-close">Tap anywhere to close</span>
  </div>`;
}

function titleCase(word: string): string {
  return word.charAt(0) + word.slice(1).toLowerCase();
}
