import {
  type BundleChore,
  type BundleKid,
  type ChorePeriod,
  type DashboardBundle,
  daysBetween,
} from "@kids-dash/core";
import { monthDay, weekdayLong } from "../format";
import { html, type Raw } from "../html";
import { art, paletteStyle } from "../theme";
import { avatar, backArrow, choresOn, dayProgress, forwardArrow, type ViewContext } from "./common";

const PERIOD_LABELS: Record<ChorePeriod, string> = {
  morning: "MORNING",
  afterSchool: "AFTER SCHOOL",
  evening: "EVENING",
};

/** Tiles per kid that fit the panel without scrolling. */
export const MAX_CHORES = 10;

/** Whether a day's chores can be ticked: today, or caught up on an earlier day; never ahead. */
type DayWhen = "past" | "today" | "ahead";

const SUBLINES: Record<DayWhen, string> = {
  today: "Tap a chore when it's done!",
  past: "Forgot to tap one? You still can.",
  ahead: "Coming up. These can't be ticked yet.",
};

/** Days the Chores screen can step through: the bundle's pager days, or just today. */
export function choreDates(bundle: DashboardBundle): string[] {
  const days = (bundle.days.length ? bundle.days : bundle.week).map((d) => d.date);
  return days.includes(bundle.date) ? days : [bundle.date];
}

/** The chores for one day (today unless `date` names another), a panel per kid. */
export function choresScreen(bundle: DashboardBundle, ctx: ViewContext, date = bundle.date): Raw {
  const dates = choreDates(bundle);
  const day = dates.includes(date) ? date : bundle.date;
  const at = dates.indexOf(day);
  const when: DayWhen = day < bundle.date ? "past" : day > bundle.date ? "ahead" : "today";
  const kids = choresOn(bundle, day);
  const pager = (step: -1 | 1, disabled: boolean) =>
    html`<button type="button" class="nav-button header-button page-button" data-action="chores-day" data-step="${String(step)}" aria-label="${step < 0 ? "Day before" : "Next day"}"${disabled ? html` disabled` : ""}>${step < 0 ? backArrow() : forwardArrow()}</button>`;
  return html`<div class="screen-inner chores">
    <header class="top">
      <div class="title-group">
        <button type="button" class="nav-button header-button" data-action="go" data-screen="today">${backArrow()}<span>Today</span></button>
        <div>
          <h1>Chores</h1>
          <p class="subline">${SUBLINES[when]}</p>
        </div>
      </div>
      <div class="chore-day-nav">
        ${pager(-1, at <= 0)}
        <div class="chore-day">
          <span class="chore-day-name">${weekdayLong(day)}, ${monthDay(day)}</span>
          <span class="chore-day-rel">${relativeDay(daysBetween(bundle.date, day))}</span>
        </div>
        ${pager(1, at >= dates.length - 1)}
      </div>
      <div class="header-actions">
        ${ctx.canAddChores ? html`<button type="button" class="nav-button header-button add-chore-button" data-action="add-chore"><span class="plus" aria-hidden="true">+</span><span>Add chore</span></button>` : ""}
        <button type="button" class="nav-button header-button" data-action="go" data-screen="week"><span>This week</span></button>
      </div>
    </header>
    <div class="chores-grid" style="grid-template-columns:repeat(${Math.max(kids.length, 1)}, minmax(0, 1fr))">
      ${
        kids.length
          ? kids.map(({ kid, chores }) => kidPanel(kid, chores, day, when, ctx))
          : html`<section class="card chores-empty"><img src="${art.bear("party")}" alt="" width="220" height="220"><h2>${when === "today" ? "No chores today!" : `No chores on ${weekdayLong(day)}`}</h2></section>`
      }
    </div>
  </div>`;
}

function relativeDay(offset: number): string {
  if (offset === 0) return "Today";
  if (offset === -1) return "Yesterday";
  if (offset === 1) return "Tomorrow";
  return offset < 0 ? "Earlier" : "Coming up";
}

function kidPanel(
  kid: BundleKid,
  all: readonly BundleChore[],
  date: string,
  when: DayWhen,
  ctx: ViewContext,
): Raw {
  const chores = all.slice(0, MAX_CHORES);
  const { done, total } = dayProgress(kid.id, chores, date, ctx);
  const groups = (Object.keys(PERIOD_LABELS) as ChorePeriod[])
    .map((period) => ({ period, chores: chores.filter((c) => c.period === period) }))
    .filter((g) => g.chores.length);

  return html`<section class="card chore-panel" style="${paletteStyle(kid.color)}">
    <div class="chore-head">
      ${avatar(kid, ctx.photos, 96)}
      <div class="chore-head-text">
        <h2>${kid.name}</h2>
      </div>
      <span class="chore-count">${when === "ahead" ? `${total} ${total === 1 ? "chore" : "chores"}` : `${done} of ${total} done`}</span>
    </div>
    ${groups.map(
      (g) => html`<div class="chore-group">
        <span class="period-label">${PERIOD_LABELS[g.period]}</span>
        <div class="chore-tiles">${g.chores.map((c) => tile(kid.id, c, date, when, ctx.isDone(kid.id, c.id, date)))}</div>
      </div>`,
    )}
    ${footer(kid, date, when, done, total)}
  </section>`;
}

function footer(kid: BundleKid, date: string, when: DayWhen, done: number, total: number): Raw {
  if (when === "ahead") {
    return html`<div class="cheer"><img src="${art.sticker("star")}" alt="" width="50" height="50"><span>${total} ${total === 1 ? "chore" : "chores"} on ${weekdayLong(date)}</span></div>`;
  }
  if (done === total) {
    return html`<div class="celebrate"><img src="${art.bear("party")}" alt="Polar bear celebrating" width="150" height="150"><div><span class="celebrate-title">All done, ${kid.name}!</span><span>${when === "today" ? "You're a super star today" : "A super star that day"}</span></div></div>`;
  }
  const text = when === "today" ? cheer(total - done, total) : `${done} of ${total} done that day`;
  return html`<div class="cheer"><img src="${art.sticker("star")}" alt="" width="50" height="50"><span>${text}</span></div>`;
}

function tile(kidId: string, chore: BundleChore, date: string, when: DayWhen, done: boolean): Raw {
  if (when === "ahead") {
    return html`<div class="chore-tile ahead">
      <img src="${art.chore(chore.sticker)}" alt="" width="88" height="88">
      <span class="chore-text"><span class="chore-title">${chore.title}</span><span class="chore-state">Coming up</span></span>
    </div>`;
  }
  const missed = !done && when === "past";
  const state = done ? "Done!" : missed ? "Tap if you did it" : "Tap when done";
  return html`<button type="button" class="chore-tile${done ? " done" : missed ? " missed" : ""}" data-action="toggle-chore" data-kid="${kidId}" data-chore="${chore.id}" data-date="${date}" aria-pressed="${done}">
    <img src="${art.chore(chore.sticker)}" alt="" width="88" height="88">
    <span class="chore-text"><span class="chore-title">${chore.title}</span><span class="chore-state">${state}</span></span>
    <span class="check">${done ? html`<svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg>` : ""}</span>
  </button>`;
}

export function cheer(left: number, total: number): string {
  if (left === total) return "Let's get started!";
  if (left === 1) return "Just 1 more to go!";
  return `${left} more to go. You can do it!`;
}
