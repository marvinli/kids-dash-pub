import {
  CHORE_PERIODS,
  CHORE_STICKERS,
  type ChorePeriod,
  type ChoreSticker,
  type DashboardBundle,
  inferChoreSticker,
} from "@kids-dash/core";
import { html, type Raw } from "../html";
import { art, PALETTES } from "../theme";

/** The add-chore form's state while it is open. */
export interface ChoreDraft {
  kidId: string | null;
  title: string;
  period: ChorePeriod;
  /** Weekdays it happens on, 0 = Sunday, always sorted; all seven means every day. */
  days: number[];
  /** Picked by hand; otherwise the title decides. */
  sticker: ChoreSticker | null;
  saving: boolean;
  error: string | null;
}

export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
export const WEEKDAYS = [1, 2, 3, 4, 5];
export const WEEKENDS = [0, 6];
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PERIOD_LABELS: Record<ChorePeriod, string> = {
  morning: "Morning",
  afterSchool: "After school",
  evening: "Evening",
};
const PRESETS = { every: EVERY_DAY, weekdays: WEEKDAYS, weekends: WEEKENDS } as const;
export type DaysPreset = keyof typeof PRESETS;

/** A new form; with only one kid there is nobody else to pick. */
export function newChoreDraft(bundle: DashboardBundle): ChoreDraft {
  return {
    kidId: bundle.kids.length === 1 ? (bundle.kids[0]?.id ?? null) : null,
    title: "",
    period: "morning",
    days: [...EVERY_DAY],
    sticker: null,
    saving: false,
    error: null,
  };
}

export function presetDays(preset: string): number[] | null {
  return preset in PRESETS ? [...PRESETS[preset as DaysPreset]] : null;
}

/** Flips one day; the last day left stays on (a chore needs a day). */
export function toggleDay(days: number[], day: number): number[] {
  if (!days.includes(day)) return [...days, day].sort((a, b) => a - b);
  return days.length > 1 ? days.filter((d) => d !== day) : days;
}

export function choreDraftSticker(d: ChoreDraft): ChoreSticker {
  return d.sticker ?? inferChoreSticker(d.title);
}

export function canSaveChore(d: ChoreDraft): boolean {
  return d.kidId !== null && d.title.trim().length > 0 && !d.saving;
}

/** What the shell posts to /v1/chores (core FrameChoreInput). */
export function choreDraftPayload(d: ChoreDraft): string {
  return JSON.stringify({
    kidId: d.kidId,
    title: d.title.trim(),
    period: d.period,
    days: d.days.length === 7 ? [] : d.days,
    sticker: choreDraftSticker(d),
  });
}

function sameDays(a: number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((d, i) => d === b[i]);
}

/** Who, what, when: big buttons for everything but the title. */
export function addChoreSheet(d: ChoreDraft, bundle: DashboardBundle): Raw {
  const sticker = choreDraftSticker(d);
  const who = bundle.kids.map((kid) => {
    const p = PALETTES[kid.color];
    return html`<button type="button" class="add-chip who${d.kidId === kid.id ? " on" : ""}" style="--ink:${p.ink};--chip:${p.chip}" data-action="chore-who" data-kid="${kid.id}">${kid.name}</button>`;
  });
  const status = d.saving
    ? "Saving…"
    : d.error === "invalid"
      ? "That didn’t work. Check the title and try again."
      : d.error
        ? "Couldn’t save. Is the frame online?"
        : "";
  return html`<div class="sheet-card add-sheet chore-sheet" role="dialog" aria-label="Add a chore" data-action="noop">
    <h2 class="sheet-title">Add a chore</h2>
    <div class="add-what">
      <img class="add-sticker" src="${art.chore(sticker)}" alt="" width="96" height="96">
      <input class="add-title chore-title-input" type="text" maxlength="40" placeholder="What’s the chore?" value="${d.title}" autocomplete="off" enterkeyhint="done">
    </div>
    <div class="add-row"><span class="add-label">Who</span><div class="add-chips">${who}</div></div>
    <div class="add-row"><span class="add-label">When</span><div class="add-chips">${CHORE_PERIODS.map(
      (p) =>
        html`<button type="button" class="add-chip${d.period === p ? " on" : ""}" data-action="chore-period" data-period="${p}">${PERIOD_LABELS[p]}</button>`,
    )}</div></div>
    <div class="add-row"><span class="add-label">Days</span><div class="add-chips">
      ${(Object.keys(PRESETS) as DaysPreset[]).map(
        (preset) =>
          html`<button type="button" class="add-chip${sameDays(d.days, PRESETS[preset]) ? " on" : ""}" data-action="chore-preset" data-preset="${preset}">${preset === "every" ? "Every day" : preset === "weekdays" ? "Weekdays" : "Weekends"}</button>`,
      )}
    </div></div>
    <div class="add-row"><span class="add-label"></span><div class="add-chips">
      ${DAY_LABELS.map(
        (label, day) =>
          html`<button type="button" class="add-chip day${d.days.includes(day) ? " on" : ""}" data-action="chore-day" data-day="${String(day)}" aria-pressed="${d.days.includes(day)}">${label}</button>`,
      )}
    </div></div>
    <div class="add-row"><span class="add-label">Sticker</span><div class="add-stickers">${CHORE_STICKERS.map(
      (s) =>
        html`<button type="button" class="add-sticker-pick big${s === sticker ? " on" : ""}" data-action="chore-sticker" data-sticker="${s}" aria-label="${s}"><img src="${art.chore(s)}" alt="" width="70" height="70"></button>`,
    )}</div></div>
    <div class="add-actions">
      <span class="add-status">${status}</span>
      <button type="button" class="nav-button" data-action="close-sheet">Cancel</button>
      <button type="button" class="nav-button dark" data-action="chore-save"${canSaveChore(d) ? "" : html` disabled`}>Add</button>
    </div>
  </div>`;
}
