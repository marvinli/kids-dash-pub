import type { BundleChore, BundleKid, DashboardBundle, Owner, WeekDay } from "@kids-dash/core";
import { html, type Raw } from "../html";
import { PALETTES } from "../theme";

export type Screen = "today" | "week" | "chores";

/** What renderers need beyond the bundle: native-supplied photos and chore state. */
export interface ViewContext {
  now: Date;
  /** Kid id → data: URL of their verified photo. */
  photos: Readonly<Record<string, string>>;
  /** Done state including taps not yet confirmed by the server; `date` defaults to today. */
  isDone(kidId: string, choreId: string, date?: string): boolean;
  /** The shell can save events (newer shells only): show "+" on days. */
  canAddEvents?: boolean;
  /** The shell can save event edits (newer shells only): Google events open with an Edit button. */
  canEditEvents?: boolean;
  /** The shell can save new chores (newer shells only): show "Add chore". */
  canAddChores?: boolean;
  /** The shell can black the screen out on request (newer shells only). */
  canSleep?: boolean;
  /** Today's joke has not been heard yet: the rail's Joke button says so. */
  jokeNew?: boolean;
  /** Today's trivia has not been started yet. */
  triviaNew?: boolean;
}

export function avatar(
  kid: Pick<BundleKid, "id" | "name">,
  photos: ViewContext["photos"],
  size: number,
): Raw {
  const photo = photos[kid.id];
  if (photo) {
    return html`<img class="avatar" src="${photo}" alt="${kid.name}" width="${size}" height="${size}">`;
  }
  return html`<span class="avatar avatar-initial" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.5)}px" aria-hidden="true">${kid.name.slice(0, 1).toUpperCase()}</span>`;
}

export function moreChip(hidden: number): Raw {
  return hidden > 0 ? html`<span class="more-chip">+${hidden} more</span>` : html``;
}

export function navButton(screen: Screen, label: string, extra: Raw = html``, variant = ""): Raw {
  return html`<button type="button" class="nav-button ${variant}" data-action="go" data-screen="${screen}">${extra}<span>${label}</span></button>`;
}

export function backArrow(): Raw {
  return html`<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M14 4 7 11l7 7" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export function forwardArrow(): Raw {
  return html`<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M8 4l7 7-7 7" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export interface OwnerLabel {
  name: string;
  ink: string;
  chip: string;
}

export function ownerLabel(owner: Owner, bundle: DashboardBundle): OwnerLabel {
  if (owner.kind === "kid") {
    const kid = bundle.kids.find((k) => k.id === owner.kidId);
    if (kid) {
      const p = PALETTES[kid.color];
      return { name: kid.name, ink: p.ink, chip: p.chip };
    }
  }
  return { name: "Everyone", ink: "#564a72", chip: "#ece6fb" };
}

/** One kid's chores on a day, done / total, counting unconfirmed taps. */
export function dayProgress(
  kidId: string,
  chores: readonly BundleChore[],
  date: string,
  ctx: ViewContext,
): { done: number; total: number } {
  return {
    done: chores.filter((c) => ctx.isDone(kidId, c.id, date)).length,
    total: chores.length,
  };
}

/**
 * Each kid's chores on `date`, in the bundle's kid order: today's from the
 * kids themselves, other days' from the week's days. Kids with none are left out.
 */
export function choresOn(
  bundle: DashboardBundle,
  date: string,
): { kid: BundleKid; chores: BundleChore[] }[] {
  if (date === bundle.date) {
    return bundle.kids.filter((k) => k.chores.length).map((kid) => ({ kid, chores: kid.chores }));
  }
  const day = findDay(bundle, date);
  return bundle.kids.flatMap((kid) => {
    const chores = day?.chores.find((d) => d.kidId === kid.id)?.chores ?? [];
    return chores.length ? [{ kid, chores }] : [];
  });
}

export function findDay(bundle: DashboardBundle, date: string): WeekDay | undefined {
  return bundle.days.find((d) => d.date === date) ?? bundle.week.find((d) => d.date === date);
}

/** Chores done / total for a kid, counting unconfirmed taps. */
export function choreProgress(kid: BundleKid, ctx: ViewContext): { done: number; total: number } {
  return {
    done: kid.chores.filter((c) => ctx.isDone(kid.id, c.id)).length,
    total: kid.chores.length,
  };
}
