import type { BundleKid, DashboardBundle, KidColor, TodayItem, WeekDay } from "@kids-dash/core";
import { clockFace, dayOfMonth, greeting, localTime, shortTime } from "../format";
import { html, type Raw } from "../html";
import { art, PALETTES, paletteStyle } from "../theme";
import { isEditable } from "./add-event";
import {
  avatar,
  choreProgress,
  dayProgress,
  forwardArrow,
  moreChip,
  ownerLabel,
  type ViewContext,
} from "./common";
import { tappable } from "./details";
import { fitToBudget, type Sized } from "./fit";
import { gearButton } from "./settings";
import { weatherCard } from "./weather";

// Pixel budget of a kid column below its name row, and each block's height.
export const COLUMN_BUDGET = 470;
const GAP = 12;
const HEIGHTS = { special: 104, activity: 88, note: 66 } as const;
/** The Chores card at the foot of a kid's column (with its gap). */
const CHORE_CARD = 104;
// Week strip day cells: room under the date for this many pixels of items,
// less a row for the day's chore counts when it has any.
const STRIP_BUDGET = 132;
const STRIP_CHORES = 34;
const STRIP_ITEM = 40;
const STRIP_GAP = 6;
const STRIP_CHIP = 26;

/** Where a timed item sits relative to now: done, the next thing, or later. */
type When = "past" | "next" | "later";

type Entry =
  | { kind: "special"; item: TodayItem; when: When }
  | { kind: "activity"; item: TodayItem; when: When }
  | { kind: "note"; text: string };

export function todayScreen(bundle: DashboardBundle, ctx: ViewContext): Raw {
  const hour = clockFace(ctx.now, bundle.timezone).hour;
  return html`<div class="screen-inner today">
    <div class="today-body" style="grid-template-columns:minmax(0, 1fr) ${RAIL_WIDTH}px">
    <header class="top">
      <div class="greeting">
        <h1><img class="greeting-art bob" src="${art.sky(timeOfDayArt(hour))}" alt="" width="84" height="84"><span><span data-greeting>${greeting(hour)}</span>${greetingNames(bundle)}</span></h1>
        ${familyLine(bundle)}
      </div>
      <div class="top-right">
        <div class="clock" aria-live="off">
          <div class="clock-time"><span data-clock-time></span><span class="clock-period" data-clock-period></span></div>
          <div class="clock-date-row">${gearButton()}<div class="clock-date" data-clock-date></div></div>
        </div>
      </div>
    </header>
      <main class="today-main" style="grid-template-columns:540px repeat(${Math.max(bundle.kids.length, 1)}, minmax(0, 1fr))">
        ${weatherCard(bundle.weather, bundle.location)}
        ${bundle.kids.length ? bundle.kids.map((kid) => kidColumn(kid, ctx, localTime(ctx.now, bundle.timezone))) : noKids()}
      </main>
      ${weekStrip(bundle, ctx)}
      ${rail(bundle, ctx)}
    </div>
  </div>`;
}

function timeOfDayArt(hour: number): "sunny" | "partly" | "night" {
  if (hour >= 18 || hour < 5) return "night";
  return hour < 12 ? "sunny" : "partly";
}

/** ", Maya & Theo!" with each name in its own colour. */
function greetingNames(bundle: DashboardBundle): Raw {
  const custom = bundle.device?.greetingName;
  // Each name in its colour: the ink over a light header band, the pastel over a dark one.
  const name = (text: string, color: KidColor) =>
    html`<span class="greet-name" style="--name-ink:${PALETTES[color].ink};--name-light:${PALETTES[color].bg}">${text}</span>`;
  if (custom) return html`, ${name(custom, "purple")}!`;
  const names = bundle.kids.map((kid) => name(kid.name, kid.color));
  if (!names.length) return html`!`;
  const joined =
    names.length === 1
      ? names
      : [
          ...names.slice(0, -1).flatMap((n, i) => (i ? [html`, `, n] : [n])),
          html` &amp; `,
          names.at(-1),
        ];
  return html`, ${joined}!`;
}

function familyLine(bundle: DashboardBundle): Raw {
  if (!bundle.familyNotes.length) return html``;
  return html`<p class="subline family-notes">${bundle.familyNotes
    .slice(0, 2)
    .map(
      (n) =>
        html`<span class="family-note"><img src="${art.sticker("star")}" alt="" width="34" height="34">${n.text}</span>`,
    )}</p>`;
}

/** A kid's chores today as a count; the Chores screen has the list. */
function choreCard(kid: BundleKid, ctx: ViewContext): Raw {
  const { done, total } = choreProgress(kid, ctx);
  return html`<button type="button" class="chore-card${done === total ? " all-done" : ""}" data-action="chores" aria-label="${kid.name}'s chores: ${done} of ${total} done">
    <img src="${art.sticker("star")}" alt="" width="64" height="64">
    <span class="chore-card-text"><span class="chore-card-label">CHORES</span><span class="chore-card-count">${done} of ${total} done</span></span>
    <span class="chore-card-go">${forwardArrow()}</span>
  </button>`;
}

/** The right rail's width: round buttons with a word under each. */
const RAIL_WIDTH = 100;

/**
 * Down the right edge: the photos on top, then the fun modes (the joke, and
 * the day's trivia, history and place when the sync has them), with
 * sleep at the foot, apart from the rest. Room for more modes as they come.
 */
function rail(bundle: DashboardBundle, ctx: ViewContext): Raw {
  return html`<nav class="rail" aria-label="Fun">
    ${
      bundle.slides.length
        ? railButton(
            "photos",
            "Photos",
            html`<svg width="44" height="44" viewBox="0 0 40 40" aria-hidden="true"><rect x="3" y="7" width="34" height="26" rx="7" fill="#fff" stroke="currentColor" stroke-width="3.5"/><circle cx="27" cy="16" r="3.5" fill="#ffc94d"/><path d="M5 30 15 19l7 7 4-4 9 9" fill="#9fd7a8" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/></svg>`,
          )
        : ""
    }
    ${railButton(
      "joke",
      "Joke",
      html`<img src="${art.bear("party")}" alt="" width="76" height="76">`,
      ctx.jokeNew ? html`<span class="rail-new">NEW</span>` : html``,
    )}
    ${
      bundle.trivia.length
        ? railButton(
            "trivia",
            "Trivia",
            html`<img src="${art.sticker("dice")}" alt="" width="64" height="64">`,
            ctx.triviaNew ? html`<span class="rail-new">NEW</span>` : html``,
          )
        : ""
    }
    ${
      bundle.history.length
        ? railButton(
            "history",
            "History",
            html`<img src="${art.sticker("museum")}" alt="" width="62" height="62">`,
          )
        : ""
    }
    ${
      bundle.place
        ? railButton(
            "place",
            "Places",
            html`<svg width="50" height="50" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="16" fill="#bfe0ff" stroke="currentColor" stroke-width="3"/><path d="M11 12c3 1 4 4 7 4s2 4 5 5-1 6 2 8M27 8c-1 3 1 5 4 5M8 24c3 0 5 2 5 5" fill="none" stroke="#3f8f4f" stroke-width="3" stroke-linecap="round"/></svg>`,
          )
        : ""
    }
    ${
      ctx.canSleep
        ? railButton(
            "sleep",
            "Sleep",
            html`<svg width="42" height="42" viewBox="0 0 40 40" aria-hidden="true"><path d="M12.5 10.5a13 13 0 1 0 15 0" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M20 5v15" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>`,
            html``,
            " rail-foot",
          )
        : ""
    }
  </nav>`;
}

function railButton(
  action: string,
  label: string,
  icon: Raw,
  badge: Raw = html``,
  extra = "",
): Raw {
  return html`<button type="button" class="rail-button${extra}" data-action="${action}" aria-label="${label}">
    <span class="rail-icon">${icon}${badge}</span>
    <span class="rail-label">${label}</span>
  </button>`;
}

/** Items with no end time count as an hour long. */
const ASSUMED_MINUTES = 60;

/**
 * Timed items already over are "past"; the first one still ahead or under way
 * is "next". Untimed items are always "later" (never dimmed or tagged).
 */
export function timeline(items: readonly TodayItem[], now: string): Map<string, When> {
  const when = new Map<string, When>();
  const nowMin = minutes(now);
  const timed = items
    .filter((i) => i.time)
    .sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
  let nextFound = false;
  for (const item of timed) {
    const start = minutes(item.time ?? "00:00");
    const end = item.endTime ? minutes(item.endTime) : start + ASSUMED_MINUTES;
    if (end <= nowMin) {
      when.set(item.id, "past");
    } else if (!nextFound) {
      when.set(item.id, "next");
      nextFound = true;
    } else {
      when.set(item.id, "later");
    }
  }
  return when;
}

function minutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

function kidColumn(kid: BundleKid, ctx: ViewContext, now: string): Raw {
  const when = timeline([...kid.specials, ...kid.activities], now);
  const state = (item: TodayItem): When => when.get(item.id) ?? "later";
  const entries: Sized<Entry>[] = [
    ...kid.specials.map((item) => ({
      item: { kind: "special", item, when: state(item) } as Entry,
      height: HEIGHTS.special,
    })),
    ...kid.activities.map((item) => ({
      item: { kind: "activity", item, when: state(item) } as Entry,
      height: HEIGHTS.activity,
    })),
    ...kid.notes.map((n) => ({
      item: { kind: "note", text: n.text } as Entry,
      height: HEIGHTS.note,
    })),
  ];
  const budget = COLUMN_BUDGET - (kid.chores.length ? CHORE_CARD : 0);
  const { shown, hidden } = fitToBudget(entries, budget, GAP);
  return html`<section class="card kid-column" style="${paletteStyle(kid.color)}">
    <div class="kid-name-row">
      ${avatar(kid, ctx.photos, 84)}
      <h2>${kid.name}</h2>
      <img class="mascot bob" src="${art.mascot(kid.color)}" alt="" width="104" height="104">
    </div>
    ${shown.length ? shown.map((e) => entry(e, Boolean(ctx.canEditEvents))) : freeDay()}
    ${moreChip(hidden)}
    ${kid.chores.length ? choreCard(kid, ctx) : ""}
  </section>`;
}

/** With `canEdit`, every Google event opens its sheet (for the Edit button), details or not. */
function entry(e: Entry, canEdit: boolean): Raw {
  if (e.kind === "note") {
    return html`<div class="note"><img src="${art.sticker("star")}" alt="" width="46" height="46"><span>${e.text}</span></div>`;
  }
  const { item, when } = e;
  const tap = tappable(item.id, item.details, canEdit && isEditable(item.id));
  if (e.kind === "special") {
    return html`<div class="special is-${when}"${tap.attrs}>
      <img class="special-sticker" src="${art.sticker(item.sticker)}" alt="" width="72" height="72">
      <div class="special-text">
        <span class="badge">${(item.badge ?? "Special").toUpperCase()}</span>
        <span class="special-title">${item.title}</span>
        ${item.note ? html`<span class="special-note">${item.note}</span>` : ""}
      </div>
      ${item.time ? html`<span class="special-time">${shortTime(item.time)}</span>` : ""}
      ${tap.hint}
    </div>`;
  }
  return html`<div class="activity is-${when}"${tap.attrs}>
    <img src="${art.sticker(item.sticker)}" alt="" width="72" height="72">
    <div class="activity-text">
      <span class="activity-title">${item.title}</span>
      ${item.note ? html`<span class="activity-note">${item.note}</span>` : ""}
    </div>
    ${item.time ? html`<span class="time-chip">${shortTime(item.time)}</span>` : ""}
    ${tap.hint}
  </div>`;
}

function freeDay(): Raw {
  return html`<div class="free-day"><img src="${art.sticker("star")}" alt="" width="72" height="72"><span>Nothing planned. Free play!</span></div>`;
}

function noKids(): Raw {
  return html`<section class="card kid-column empty-setup"><h2>Almost ready!</h2><p>Add the kids in the dashboard settings.</p></section>`;
}

export function weekStrip(bundle: DashboardBundle, ctx: ViewContext): Raw {
  return html`<section class="card week-strip" data-action="go" data-screen="week">
    <div class="week-strip-head">
      <h2>This week</h2>
      <button type="button" class="nav-button dark" data-action="go" data-screen="week"><span>See all days</span></button>
    </div>
    <div class="week-strip-days">${bundle.week.map((day) => stripDay(day, bundle, ctx))}</div>
  </section>`;
}

function stripDay(day: WeekDay, bundle: DashboardBundle, ctx: ViewContext): Raw {
  // Specials first: the strip is for spotting the week's big days at a glance.
  const items = [...day.items.filter((i) => i.special), ...day.items.filter((i) => !i.special)];
  const { shown, hidden } = fitToBudget(
    items.map((item) => ({ item, height: STRIP_ITEM })),
    STRIP_BUDGET - (day.chores.length ? STRIP_CHORES : 0),
    STRIP_GAP,
    STRIP_CHIP,
  );
  const when = day.isToday ? " is-today" : day.date < bundle.date ? " is-past" : "";
  return html`<div class="strip-day${when}">
    <div class="strip-day-head"><span class="dow">${day.isToday ? "TODAY" : day.weekday}</span><span class="dom">${dayOfMonth(day.date)}</span></div>
    ${
      shown.length
        ? shown.map((item) => {
            const who = ownerLabel(item.owner, bundle);
            return html`<div class="strip-item${item.special ? " is-special" : ""}" style="--who:${who.ink};--who-bg:${who.chip}">
              <img src="${art.sticker(item.sticker)}" alt="" width="40" height="40">
              <span class="strip-title">${item.title}</span>
            </div>`;
          })
        : html`<span class="strip-quiet">Free day</span>`
    }
    ${hidden > 0 ? html`<span class="strip-more">+${hidden} more</span>` : ""}
    ${day.chores.length ? stripChores(day, bundle, ctx) : ""}
  </div>`;
}

/** Each kid's chores that day as "A 2/5", in their colour. */
function stripChores(day: WeekDay, bundle: DashboardBundle, ctx: ViewContext): Raw {
  return html`<div class="strip-chores">${bundle.kids.flatMap((kid) => {
    const chores = day.chores.find((d) => d.kidId === kid.id)?.chores;
    if (!chores?.length) return [];
    const { done, total } = dayProgress(kid.id, chores, day.date, ctx);
    return [
      html`<span class="strip-chore" style="${paletteStyle(kid.color)}">${kid.name.slice(0, 1)} ${done}/${total}</span>`,
    ];
  })}</div>`;
}
