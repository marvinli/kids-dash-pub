import {
  addDays,
  type ChorePeriod,
  type ChoreSticker,
  DashboardBundle,
  type EventSticker,
} from "@kids-dash/core";
import { z } from "zod";
import { backdropFor } from "./backdrop";
import shippedBackdrops from "./backdrops.json";
import type { FrameApi, FrameStatus, NativeBridge } from "./bridge";
import { clockFace, greeting, localTime } from "./format";
import { html } from "./html";
import { jokesFor } from "./jokes";
import {
  addChoreSheet,
  type ChoreDraft,
  canSaveChore,
  choreDraftPayload,
  choreDraftSticker,
  newChoreDraft,
  presetDays,
  toggleDay,
} from "./render/add-chore";
import {
  addEventSheet,
  canSave,
  canStepDay,
  type Draft,
  draftPayload,
  draftSticker,
  editDraft,
  isEditable,
  newDraft,
  withScope,
} from "./render/add-event";
import { choreDates, choresScreen } from "./render/chores";
import { findDay, type Screen, type ViewContext } from "./render/common";
import { detailSheet, findDetail, findWeekItem } from "./render/details";
import { historySheet, placeSheet } from "./render/facts";
import { jokeSheet } from "./render/joke";
import { DeviceInfo, settingsSheet } from "./render/settings";
import { todayScreen } from "./render/today";
import { triviaSheet } from "./render/trivia";
import { daySheet, weekPages, weekScreen } from "./render/week";

const DAY_SHEET = "day:";
const SETTINGS_SHEET = "settings";
const JOKE_SHEET = "joke";
const TRIVIA_SHEET = "trivia";
const HISTORY_SHEET = "history";
const PLACE_SHEET = "place";
/** Panels that show the frosted backdrop (see --frost-image in app.css). */
const FROSTED = ".weather, .kid-column, .week-strip, .week-day, .chore-panel";
const ADD_SHEET = "add";
const ADD_CHORE_SHEET = "add-chore";
/** Filling in an event takes longer than reading one. */
export const ADD_CLOSE_MS = 3 * 60 * 1000;

import { backdropFiles, backdropImage, type HeaderTones, headerInk, skyBlend } from "./sky";
import { art } from "./theme";

/** Leave Week or Chores open this long untouched and the frame goes back to Today. */
export const IDLE_RETURN_MS = 2 * 60 * 1000;
export const TICK_MS = 15 * 1000;
/** The backdrop paintings in this build, with their header brightness (scripts/art/prep.py). */
const BACKDROP_TONES: Readonly<Record<string, HeaderTones>> = shippedBackdrops;
const SHIPPED = new Set(Object.keys(BACKDROP_TONES));

/** Today is redrawn this often so "up next" and finished items keep up with the clock. */
export const REFRESH_MS = 5 * 60 * 1000;
/** An open details sheet closes itself after this long untouched. */
export const SHEET_CLOSE_MS = 45 * 1000;

const SCREENS: Screen[] = ["today", "week", "chores"];
const Photos = z.record(z.string(), z.string().startsWith("data:image/"));
const ArtNames = z.array(z.string()).max(5000);
const Status = z.object({ online: z.boolean(), updatedAt: z.string().nullable() });

interface Override {
  done: boolean;
  saved: boolean;
}

export interface AppOptions {
  root: HTMLElement;
  native: NativeBridge;
  now?: () => Date;
  log?: (message: string) => void;
}

/**
 * Owns the page: holds the latest verified bundle and what the kids have
 * tapped, and re-renders screens from them. Rendering is whole-screen
 * innerHTML from pure functions, which on this hardware is cheaper and
 * simpler than diffing: a new bundle arrives at most every minute.
 */
export class App implements FrameApi {
  private bundle: DashboardBundle | null = null;
  private screen: Screen = "today";
  /** Week screen page: 0 is the 7 days from today, -1 the week before, … */
  private weekPage = 0;
  /** The day the Chores screen shows; null is today. */
  private choreDate: string | null = null;
  /** The joke sheet: which of the day's jokes, and whether its punchline shows. */
  private jokeAt = 0;
  private jokeRevealed = false;
  /** The day whose joke of the day has been told (its Joke button stops saying NEW). */
  private jokeHeard: string | null = null;
  /** Today's trivia game: which questions (date and ids), the one shown, the answers picked. */
  private triviaKey = "";
  private triviaAt = 0;
  private triviaPicks: (number | null)[] = [];
  private photos: Record<string, string> = {};
  private status: FrameStatus = { online: true, updatedAt: null };
  private readonly overrides = new Map<string, Override>();
  private lastInteraction: number;
  private readonly now: () => Date;
  private readonly log: (message: string) => void;
  private readonly screens: Record<Screen, HTMLElement>;
  private readonly statusEl: HTMLElement;
  private readonly sheetEl: HTMLElement;
  /** Event id whose details are open, if any. */
  private openItem: string | null = null;
  private draft: Draft | null = null;
  /** The add-event save the shell is working on. */
  private addRequest: string | null = null;
  private choreDraft: ChoreDraft | null = null;
  /** The add-chore save the shell is working on. */
  private choreRequest: string | null = null;
  private refreshedAt = 0;
  /** The backdrop images last set, so a tick only repaints when the blend steps. */
  private backdrop: string | null = null;
  /**
   * The paintings whose files are all on the frame (setArt). Most download
   * after the app installs; until the shell says, every one in the build.
   */
  private paintings: ReadonlySet<string> = SHIPPED;

  constructor(private readonly options: AppOptions) {
    this.now = options.now ?? (() => new Date());
    this.log = options.log ?? ((m) => console.warn(m));
    this.lastInteraction = this.now().getTime();

    const { root } = options;
    root.innerHTML = html`<div class="backdrop"></div>${SCREENS.map(
      (s) => html`<section class="screen" data-screen="${s}" aria-hidden="true"></section>`,
    )}<div class="sheet" data-action="close-sheet" hidden></div><div class="status" hidden></div>`.__raw;
    this.screens = Object.fromEntries(
      SCREENS.map((s) => [s, root.querySelector<HTMLElement>(`[data-screen="${s}"]`)]),
    ) as Record<Screen, HTMLElement>;
    this.statusEl = root.querySelector<HTMLElement>(".status") as HTMLElement;
    this.sheetEl = root.querySelector<HTMLElement>(".sheet") as HTMLElement;
    root.addEventListener("click", (event) => this.onClick(event));
    root.addEventListener("input", (event) => this.onInput(event));

    this.screens.today.innerHTML =
      html`<div class="splash"><img src="${art.bear("sun")}" alt="" width="320" height="320"><p>Getting your day ready…</p></div>`.__raw;
    this.showScreen("today");
  }

  render(bundleJson: string): void {
    let bundle: DashboardBundle;
    try {
      bundle = DashboardBundle.parse(JSON.parse(bundleJson));
    } catch (error) {
      this.log(`Ignoring a bundle that does not match the schema: ${String(error)}`);
      return;
    }
    this.bundle = bundle;
    // Saved taps are now reflected in the bundle; unsaved ones still override it.
    for (const [key, o] of this.overrides) if (o.saved) this.overrides.delete(key);
    this.renderAll();
    // Refresh an open sheet (or close it if its item is gone); never the add
    // forms, which would lose what is being typed.
    if (this.openItem && !this.isForm(this.openItem)) this.openSheet(this.openItem);
  }

  /**
   * `namesJson`: the art files the frame has (art/<name>), in the app or
   * downloaded since. A painting joins the rotation once all its files are in.
   */
  setArt(namesJson: string): void {
    const parsed = ArtNames.safeParse(safeJson(namesJson));
    if (!parsed.success) {
      this.log("Ignoring malformed art list");
      return;
    }
    const have = new Set(parsed.data);
    this.paintings = new Set(
      [...SHIPPED].filter((name) => backdropFiles(name).every((f) => have.has(f))),
    );
    this.renderBackdrop();
  }

  setPhotos(photosJson: string): void {
    const parsed = Photos.safeParse(safeJson(photosJson));
    if (!parsed.success) {
      this.log("Ignoring malformed photos");
      return;
    }
    this.photos = parsed.data;
    this.renderAll();
  }

  choreSaved(kidId: string, choreId: string, date?: string): void {
    const o = this.overrides.get(key(kidId, choreId, date ?? this.bundle?.date ?? ""));
    if (o) o.saved = true;
  }

  choreFailed(kidId: string, choreId: string, date?: string): void {
    this.overrides.delete(key(kidId, choreId, date ?? this.bundle?.date ?? ""));
    this.renderChores();
  }

  eventSaved(requestId: string, _eventId: string): void {
    if (requestId !== this.addRequest) return;
    this.addRequest = null;
    this.closeSheet();
  }

  eventFailed(requestId: string, reason: string): void {
    if (requestId !== this.addRequest || !this.draft) return;
    this.addRequest = null;
    this.draft = { ...this.draft, saving: false, error: reason };
    this.renderAddSheet();
  }

  choreAdded(requestId: string, _choreJson: string): void {
    if (requestId !== this.choreRequest) return;
    this.choreRequest = null;
    this.closeSheet();
  }

  choreAddFailed(requestId: string, reason: string): void {
    if (requestId !== this.choreRequest || !this.choreDraft) return;
    this.choreRequest = null;
    this.choreDraft = { ...this.choreDraft, saving: false, error: reason };
    this.renderChoreSheet();
  }

  /** The add-chore form's state, while it is open. */
  get addChoreDraft(): ChoreDraft | null {
    return this.choreDraft;
  }

  private isForm(id: string): boolean {
    return id === ADD_SHEET || id === ADD_CHORE_SHEET;
  }

  private renderChoreSheet(): void {
    if (!this.bundle || !this.choreDraft) return;
    this.openItem = ADD_CHORE_SHEET;
    this.sheetEl.innerHTML = addChoreSheet(this.choreDraft, this.bundle).__raw;
    this.sheetEl.hidden = false;
  }

  private onChoreAction(action: string, data: DOMStringMap): void {
    if (!this.choreDraft) return;
    const d = this.choreDraft;
    if (action === "chore-who") {
      this.choreDraft = { ...d, kidId: data.kid ?? null };
    } else if (action === "chore-period") {
      this.choreDraft = { ...d, period: data.period as ChorePeriod };
    } else if (action === "chore-preset") {
      this.choreDraft = { ...d, days: presetDays(data.preset ?? "") ?? d.days };
    } else if (action === "chore-day") {
      this.choreDraft = { ...d, days: toggleDay(d.days, Number(data.day)) };
    } else if (action === "chore-sticker") {
      this.choreDraft = { ...d, sticker: (data.sticker as ChoreSticker) ?? null };
    } else if (action === "chore-save") {
      if (!canSaveChore(d) || !this.options.native.addChore) return;
      this.choreRequest = `c${this.now().getTime()}`;
      this.choreDraft = { ...d, saving: true, error: null };
      this.options.native.addChore(this.choreRequest, choreDraftPayload(d));
    }
    this.renderChoreSheet();
  }

  /** The add-event form's state, while it is open. */
  get addDraft(): Draft | null {
    return this.draft;
  }

  private renderAddSheet(): void {
    if (!this.bundle || !this.draft) return;
    this.openItem = ADD_SHEET;
    this.sheetEl.innerHTML = addEventSheet(
      this.draft,
      this.bundle,
      typeof this.options.native.deleteEvent === "function",
    ).__raw;
    this.sheetEl.hidden = false;
  }

  /** Typing only updates the sticker preview and the Add button, so focus stays put. */
  private onInput(event: Event): void {
    this.lastInteraction = this.now().getTime();
    const input = event.target as HTMLInputElement | null;
    if (this.draft && input?.classList.contains("add-description")) {
      this.draft = { ...this.draft, description: input.value, error: null };
      return;
    }
    if (this.choreDraft && input?.classList.contains("chore-title-input")) {
      this.choreDraft = { ...this.choreDraft, title: input.value, error: null };
      const sticker = choreDraftSticker(this.choreDraft);
      const preview = this.sheetEl.querySelector<HTMLImageElement>(".add-sticker");
      if (preview) preview.src = art.chore(sticker);
      for (const pick of this.sheetEl.querySelectorAll<HTMLElement>(".add-sticker-pick")) {
        pick.classList.toggle("on", pick.dataset.sticker === sticker);
      }
      const save = this.sheetEl.querySelector<HTMLButtonElement>('[data-action="chore-save"]');
      if (save) save.disabled = !canSaveChore(this.choreDraft);
      return;
    }
    if (!this.draft || !input?.classList.contains("add-title")) return;
    this.draft = { ...this.draft, title: input.value, error: null };
    const preview = this.sheetEl.querySelector<HTMLImageElement>(".add-sticker");
    if (preview) preview.src = art.sticker(draftSticker(this.draft));
    for (const pick of this.sheetEl.querySelectorAll<HTMLElement>(".add-sticker-pick")) {
      pick.classList.toggle("on", pick.dataset.sticker === draftSticker(this.draft));
    }
    const save = this.sheetEl.querySelector<HTMLButtonElement>('[data-action="add-save"]');
    if (save) save.disabled = !canSave(this.draft);
  }

  private onAddAction(action: string, data: DOMStringMap): void {
    if (!this.draft) return;
    // Touching anything else in the form takes back a "Delete …?" question.
    const d = action.startsWith("add-delete") ? this.draft : { ...this.draft, deleting: false };
    if (action === "add-delete") {
      if (!d.editing || d.saving) return;
      this.draft = { ...d, deleting: true, error: null };
    } else if (action === "add-delete-cancel") {
      this.draft = { ...d, deleting: false, error: null };
    } else if (action === "add-delete-confirm") {
      const native = this.options.native;
      if (!d.editing || d.saving || !native.deleteEvent) return;
      const request = `r${this.now().getTime()}`;
      native.deleteEvent(request, d.editing.id, d.editing.repeating ? d.scope : "one");
      this.addRequest = request;
      this.draft = { ...d, deleting: true, saving: true, error: null };
    } else if (action === "add-who") {
      this.draft = {
        ...d,
        owner:
          data.owner === "everyone"
            ? { kind: "everyone" }
            : { kind: "kid", kidId: data.owner ?? "" },
      };
    } else if (action === "add-allday") {
      this.draft = { ...d, hour: null, minute: 0 };
    } else if (action === "add-hour") {
      this.draft = { ...d, hour: Number(data.hour) };
    } else if (action === "add-minute") {
      this.draft = { ...d, minute: Number(data.minute) };
    } else if (action === "add-sticker") {
      this.draft = { ...d, sticker: (data.sticker as EventSticker) ?? null };
    } else if (action === "add-day" && this.bundle) {
      const step = Number(data.step) || 0;
      if (canStepDay(d, step, this.bundle.date)) this.draft = { ...d, date: addDays(d.date, step) };
    } else if (action === "add-scope") {
      this.draft = withScope(d, data.scope === "all" ? "all" : "one");
    } else if (action === "add-save") {
      const native = this.options.native;
      if (!canSave(d)) return;
      const request = `r${this.now().getTime()}`;
      if (d.editing) {
        if (!native.editEvent) return;
        native.editEvent(request, d.editing.id, draftPayload(d));
      } else {
        if (!native.addEvent) return;
        native.addEvent(request, draftPayload(d));
      }
      this.addRequest = request;
      this.draft = { ...d, saving: true, error: null };
    }
    this.renderAddSheet();
  }

  setStatus(statusJson: string): void {
    const parsed = Status.safeParse(safeJson(statusJson));
    if (!parsed.success) return;
    this.status = parsed.data;
    this.renderStatus();
  }

  /** Called on a timer: keeps the clock current and drifts back to Today. */
  tick(): void {
    this.renderBackdrop();
    if (this.bundle && this.now().getTime() - this.refreshedAt >= REFRESH_MS) {
      this.screens.today.innerHTML = todayScreen(this.bundle, this.context()).__raw;
      this.alignFrost();
      this.refreshedAt = this.now().getTime();
    }
    const idle = this.now().getTime() - this.lastInteraction;
    const closeAfter = this.openItem && this.isForm(this.openItem) ? ADD_CLOSE_MS : SHEET_CLOSE_MS;
    if (this.openItem && idle >= closeAfter) this.closeSheet();
    if (this.screen !== "today" && idle >= IDLE_RETURN_MS) {
      this.showScreen("today");
    }
    this.updateClock();
  }

  get currentScreen(): Screen {
    return this.screen;
  }

  private context(): ViewContext {
    return {
      now: this.now(),
      photos: this.photos,
      isDone: (kidId, choreId, date) => this.isDone(kidId, choreId, date),
      canAddEvents: typeof this.options.native.addEvent === "function",
      canEditEvents: this.canEdit(),
      canAddChores: typeof this.options.native.addChore === "function",
      canSleep: typeof this.options.native.sleepNow === "function",
      jokeNew: this.bundle !== null && this.jokeHeard !== this.bundle.date,
      triviaNew: this.bundle !== null && !this.triviaStarted(),
    };
  }

  private canEdit(): boolean {
    return typeof this.options.native.editEvent === "function";
  }

  private isDone(kidId: string, choreId: string, date?: string): boolean {
    const bundle = this.bundle;
    if (!bundle) return false;
    const day = date ?? bundle.date;
    const override = this.overrides.get(key(kidId, choreId, day));
    if (override) return override.done;
    const chores =
      day === bundle.date
        ? bundle.kids.find((k) => k.id === kidId)?.chores
        : findDay(bundle, day)?.chores.find((d) => d.kidId === kidId)?.chores;
    return chores?.find((c) => c.id === choreId)?.done ?? false;
  }

  private renderAll(): void {
    if (!this.bundle) return;
    this.renderBackdrop();
    const ctx = this.context();
    this.screens.today.innerHTML = todayScreen(this.bundle, ctx).__raw;
    this.refreshedAt = this.now().getTime();
    this.renderWeek();
    this.screens.chores.innerHTML = choresScreen(
      this.bundle,
      ctx,
      this.choreDate ?? undefined,
    ).__raw;
    this.alignFrost();
    this.updateClock();
  }

  /**
   * The painted season/holiday backdrop behind every screen, in day, dusk or
   * night light (a step of a crossfade around sunrise and sunset). Its frosted
   * copy follows it. Set only when it changes.
   */
  private renderBackdrop(): void {
    if (!this.bundle) return;
    const { date, timezone, weather } = this.bundle;
    const name = backdropFor(date, this.paintings);
    const blend = skyBlend(
      localTime(this.now(), timezone),
      weather?.sunrise ?? null,
      weather?.sunset ?? null,
    );
    const image = backdropImage(name, blend);
    if (image === this.backdrop) return;
    this.backdrop = image;
    const { root } = this.options;
    root.dataset.backdrop = name;
    root.dataset.light = blend.amount === 0 ? blend.from : `${blend.from}-${blend.to}`;
    const tones = BACKDROP_TONES[name];
    root.dataset.header = tones ? headerInk(tones, blend) : "dark";
    root.style.setProperty("--backdrop-image", image);
    root.style.setProperty("--frost-image", backdropImage(name, blend, true));
  }

  /**
   * Points each frosted panel's blurred-backdrop layer at the part of the
   * painting behind it. Runs after screens are (re)rendered; the layout is
   * fixed, so this is a one-off style write per panel, never per frame.
   */
  private alignFrost(): void {
    const root = this.options.root.getBoundingClientRect();
    const scale = root.width > 0 ? root.width / 1920 : 1;
    for (const el of this.options.root.querySelectorAll<HTMLElement>(FROSTED)) {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--bx", `${-Math.round((r.left - root.left) / scale)}px`);
      el.style.setProperty("--by", `${-Math.round((r.top - root.top) / scale)}px`);
    }
  }

  /** A tap only changes chore state, which shows on Chores, Today's counts and the week's. */
  private renderChores(): void {
    if (!this.bundle) return;
    const ctx = this.context();
    this.screens.chores.innerHTML = choresScreen(
      this.bundle,
      ctx,
      this.choreDate ?? undefined,
    ).__raw;
    this.screens.today.innerHTML = todayScreen(this.bundle, ctx).__raw;
    this.renderWeek();
    this.updateClock();
  }

  /** The Chores screen on `date` (null: today). */
  private openChores(date: string | null): void {
    this.choreDate = date && this.bundle && date !== this.bundle.date ? date : null;
    this.renderChores();
    this.showScreen("chores");
  }

  private renderStatus(): void {
    const { online, updatedAt } = this.status;
    this.statusEl.hidden = online;
    if (!online && this.bundle) {
      const when = updatedAt ? clockFace(new Date(updatedAt), this.bundle.timezone) : null;
      this.statusEl.textContent = when
        ? `Offline · updated ${when.time} ${when.period}`
        : "Offline";
    } else if (!online) {
      this.statusEl.textContent = "Offline";
    }
  }

  private updateClock(): void {
    if (!this.bundle) return;
    const face = clockFace(this.now(), this.bundle.timezone);
    const set = (selector: string, text: string) => {
      for (const el of this.options.root.querySelectorAll(selector)) el.textContent = text;
    };
    set("[data-clock-time]", face.time);
    set("[data-clock-period]", face.period);
    set("[data-clock-date]", face.date);
    set("[data-greeting]", greeting(face.hour));
  }

  get openDetails(): string | null {
    return this.openItem;
  }

  /** The picks so far, if they belong to the bundle's questions (a new day starts afresh). */
  private triviaStarted(): boolean {
    return this.triviaKey === this.triviaKeyNow() && this.triviaPicks.some((p) => p !== null);
  }

  private triviaKeyNow(): string {
    return this.bundle
      ? `${this.bundle.date}:${this.bundle.trivia.map((q) => q.id).join(",")}`
      : "";
  }

  /** `id` is an item id, `day:<date>` for a whole day, or `settings`. */
  private openSheet(id: string): void {
    if (id === HISTORY_SHEET || id === PLACE_SHEET) {
      const place = this.bundle?.place ?? null;
      const history = this.bundle?.history ?? [];
      if (!this.bundle || (id === PLACE_SHEET ? !place : !history.length)) {
        this.closeSheet();
        return;
      }
      this.openItem = id;
      this.sheetEl.innerHTML = (
        place && id === PLACE_SHEET ? placeSheet(place) : historySheet(history, this.bundle.date)
      ).__raw;
      this.sheetEl.hidden = false;
      return;
    }
    if (id === TRIVIA_SHEET) {
      if (!this.bundle?.trivia.length) {
        this.closeSheet();
        return;
      }
      if (this.triviaKey !== this.triviaKeyNow()) {
        this.triviaKey = this.triviaKeyNow();
        this.triviaAt = 0;
        this.triviaPicks = this.bundle.trivia.map(() => null);
      }
      this.openItem = id;
      this.sheetEl.innerHTML = triviaSheet(
        this.bundle.trivia,
        this.triviaAt,
        this.triviaPicks,
      ).__raw;
      this.sheetEl.hidden = false;
      return;
    }
    if (id === JOKE_SHEET) {
      if (!this.bundle) return;
      this.openItem = id;
      this.sheetEl.innerHTML = jokeSheet(
        jokesFor(this.bundle.date),
        this.jokeAt,
        this.jokeRevealed,
      ).__raw;
      this.sheetEl.hidden = false;
      return;
    }
    if (id === SETTINGS_SHEET) {
      if (!this.bundle) return;
      const native = this.options.native;
      const info = DeviceInfo.safeParse(safeJson(native.deviceInfo?.() ?? "{}"));
      this.openItem = id;
      this.sheetEl.innerHTML = settingsSheet(
        this.bundle,
        info.success ? info.data : {},
        this.status,
        typeof native.openWifiSettings === "function",
      ).__raw;
      this.sheetEl.hidden = false;
      return;
    }
    if (id.startsWith(DAY_SHEET)) {
      const date = id.slice(DAY_SHEET.length);
      const day =
        this.bundle && [...this.bundle.days, ...this.bundle.week].find((d) => d.date === date);
      if (!day || !this.bundle) {
        this.closeSheet();
        return;
      }
      this.openItem = id;
      this.sheetEl.innerHTML = daySheet(day, this.bundle, this.canEdit()).__raw;
      this.sheetEl.hidden = false;
      return;
    }
    const editable =
      this.canEdit() &&
      isEditable(id) &&
      this.bundle !== null &&
      findWeekItem(this.bundle, id) !== null;
    const detail = this.bundle ? findDetail(this.bundle, id, editable) : null;
    if (!detail) {
      this.closeSheet();
      return;
    }
    this.openItem = id;
    this.sheetEl.innerHTML = detailSheet(detail, editable ? id : null).__raw;
    this.sheetEl.hidden = false;
  }

  private closeSheet(): void {
    this.openItem = null;
    this.draft = null;
    this.addRequest = null;
    this.choreDraft = null;
    this.choreRequest = null;
    this.sheetEl.hidden = true;
    this.sheetEl.innerHTML = "";
  }

  private renderWeek(): void {
    if (!this.bundle) return;
    const { min, max } = weekPages(this.bundle);
    this.weekPage = Math.min(max, Math.max(min, this.weekPage));
    this.screens.week.innerHTML = weekScreen(this.bundle, this.context(), this.weekPage).__raw;
    this.alignFrost();
  }

  private showScreen(screen: Screen): void {
    this.closeSheet();
    // Every visit to the week screen starts on this week.
    if (screen === "week" && this.screen !== "week") {
      this.weekPage = 0;
      this.renderWeek();
    }
    this.screen = screen;
    for (const s of SCREENS) {
      const active = s === screen;
      this.screens[s].classList.toggle("active", active);
      this.screens[s].setAttribute("aria-hidden", String(!active));
    }
  }

  private onClick(event: Event): void {
    this.lastInteraction = this.now().getTime();
    const target = (event.target as Element | null)?.closest<HTMLElement>("[data-action]");
    if (!target) return;
    const { action, screen, kid, chore, item, step, date } = target.dataset;
    if (action === "add-chore" && this.bundle) {
      this.choreDraft = newChoreDraft(this.bundle);
      this.renderChoreSheet();
      this.sheetEl.querySelector<HTMLInputElement>(".add-title")?.focus();
      return;
    }
    if (action?.startsWith("chore-")) {
      this.onChoreAction(action, target.dataset);
      return;
    }
    if (action?.startsWith("add-")) {
      this.onAddAction(action, target.dataset);
      return;
    }
    if (action === "noop") return;
    if (action === "edit-event" && item && this.bundle) {
      const found = findWeekItem(this.bundle, item);
      if (!found) return;
      this.draft = editDraft(found.item, found.date);
      this.renderAddSheet();
      return;
    }
    if (action === "close-sheet") {
      this.closeSheet();
    } else if (action === "details" && item) {
      this.openSheet(item);
    } else if (action === "photos") {
      this.options.native.showPhotos?.();
    } else if (action === "sleep") {
      // Waking starts fresh on Today with nothing open.
      this.showScreen("today");
      this.options.native.sleepNow?.();
    } else if (action === "add" && date) {
      this.draft = newDraft(date);
      this.renderAddSheet();
      this.sheetEl.querySelector<HTMLInputElement>(".add-title")?.focus();
    } else if (action === "settings") {
      this.openSheet(SETTINGS_SHEET);
    } else if (action === "wifi") {
      this.closeSheet();
      this.options.native.openWifiSettings?.();
    } else if (action === "day" && date) {
      this.openSheet(`${DAY_SHEET}${date}`);
    } else if (action === "week-page" && this.bundle) {
      this.weekPage += Number(step) || 0;
      this.renderWeek();
    } else if (action === "joke") {
      // Every telling starts with the joke of the day, punchline hidden.
      this.jokeAt = 0;
      this.jokeRevealed = false;
      this.openSheet(JOKE_SHEET);
    } else if (action === "joke-reveal" && this.bundle) {
      this.jokeRevealed = true;
      this.openSheet(JOKE_SHEET);
      if (this.jokeAt === 0 && this.jokeHeard !== this.bundle.date) {
        this.jokeHeard = this.bundle.date;
        this.screens.today.innerHTML = todayScreen(this.bundle, this.context()).__raw;
        this.alignFrost();
        this.updateClock();
      }
    } else if (action === "joke-next" && this.bundle) {
      this.jokeAt = Math.min(this.jokeAt + 1, jokesFor(this.bundle.date).length - 1);
      this.jokeRevealed = false;
      this.openSheet(JOKE_SHEET);
    } else if (action === "history" || action === "place") {
      this.openSheet(action);
    } else if (action === "trivia" && this.bundle) {
      // Picks up where the team left off: the first unanswered question, or the score.
      this.openSheet(TRIVIA_SHEET);
      const next = this.triviaPicks.indexOf(null);
      this.triviaAt = next < 0 ? Math.max(0, this.triviaPicks.length - 1) : next;
      this.openSheet(TRIVIA_SHEET);
    } else if (action === "trivia-answer" && this.bundle) {
      const index = Number(target.dataset.index);
      if (this.triviaPicks[this.triviaAt] !== null || !Number.isInteger(index)) return;
      const first = !this.triviaStarted();
      this.triviaPicks[this.triviaAt] = index;
      this.openSheet(TRIVIA_SHEET);
      if (first) {
        this.screens.today.innerHTML = todayScreen(this.bundle, this.context()).__raw;
        this.alignFrost();
        this.updateClock();
      }
    } else if (action === "trivia-next" && this.bundle) {
      this.triviaAt = Math.min(this.triviaAt + 1, this.triviaPicks.length - 1);
      this.openSheet(TRIVIA_SHEET);
    } else if (action === "chores") {
      this.openChores(date ?? null);
    } else if (action === "chores-day" && this.bundle) {
      const dates = choreDates(this.bundle);
      const at = dates.indexOf(this.choreDate ?? this.bundle.date);
      const next = dates[Math.min(dates.length - 1, Math.max(0, at + (Number(step) || 0)))];
      this.openChores(next ?? null);
    } else if (action === "go" && screen === "chores") {
      this.openChores(null);
    } else if (action === "go" && SCREENS.includes(screen as Screen)) {
      this.showScreen(screen as Screen);
    } else if (action === "toggle-chore" && kid && chore && this.bundle) {
      // Today or an earlier day still in the window; days ahead have no tiles to tap.
      const day = date ?? this.bundle.date;
      if (day > this.bundle.date) return;
      const done = !this.isDone(kid, chore, day);
      this.overrides.set(key(kid, chore, day), { done, saved: false });
      this.renderChores();
      this.options.native.setChore(kid, chore, day, done);
    }
  }
}

function key(kidId: string, choreId: string, date: string): string {
  return `${date}/${kidId}/${choreId}`;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
