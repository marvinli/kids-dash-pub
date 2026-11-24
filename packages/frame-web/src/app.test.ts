import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADD_CLOSE_MS, App, IDLE_RETURN_MS, SHEET_CLOSE_MS } from "./app";
import type { NativeBridge } from "./bridge";
import { boot, fitStage } from "./main";
import { sampleBundle } from "./test-bundle";

// A fixed art manifest, so these tests do not change as new paintings ship.
vi.mock("./backdrops.json", () => ({
  default: { fall: { day: 0.84, dusk: 0.39, night: 0.05 } },
}));

const texts = (root: ParentNode, selector: string) =>
  [...root.querySelectorAll(selector)].map((el) => el.textContent?.trim());

function setup() {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById("app") as HTMLElement;
  const native = { ready: vi.fn(), setChore: vi.fn(), showPhotos: vi.fn() } satisfies NativeBridge;
  let now = new Date("2026-11-16T12:42:00Z");
  const log = vi.fn();
  const app = new App({ root, native, now: () => now, log });
  return {
    app,
    root,
    native,
    log,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
    click: (selector: string) => (root.querySelector(selector) as HTMLElement).click(),
    active: () => root.querySelector(".screen.active")?.getAttribute("data-screen"),
  };
}

describe("App", () => {
  it("shows a splash until the first bundle, then renders all screens and the clock", () => {
    const t = setup();
    expect(t.root.querySelector(".splash")).not.toBeNull();
    t.app.render(JSON.stringify(sampleBundle()));
    expect(t.root.querySelector(".splash")).toBeNull();
    expect(t.root.querySelector("[data-clock-time]")?.textContent).toBe("7:42");
    expect(t.root.querySelector("[data-clock-period]")?.textContent).toBe("AM");
    expect(t.root.querySelector('[data-screen="week"] .week-grid')).not.toBeNull();
    expect(t.active()).toBe("today");
    // The sample day (Nov 16) paints the fall backdrop.
    expect(t.root.dataset.backdrop).toBe("fall");
    expect(t.root.style.getPropertyValue("--backdrop-image")).toBe('url("art/bg-fall.webp")');
    expect(t.root.dataset.light).toBe("day");
    expect(t.root.dataset.header).toBe("dark");
    // Frosted panels get the blurred copy, aligned to where they sit.
    expect(t.root.style.getPropertyValue("--frost-image")).toContain("art/bg-fall-blur.webp");
    const column = t.root.querySelector<HTMLElement>(".kid-column");
    expect(column?.style.getPropertyValue("--bx")).toBe("0px");
  });

  it("steps the backdrop from day through dusk to night around sunset", () => {
    const t = setup();
    const bundle = sampleBundle();
    bundle.weather = {
      high: 52,
      low: 41,
      rainChance: 80,
      code: 61,
      current: null,
      sunrise: "06:41",
      sunset: "16:37",
    };
    t.app.render(JSON.stringify(bundle));
    const image = () => t.root.style.getPropertyValue("--backdrop-image");
    expect(image()).toBe('url("art/bg-fall.webp")');
    // 16:00 in New York: eight minutes into the day-to-dusk fade.
    t.advance((8 * 60 + 18) * 60 * 1000);
    t.app.tick();
    expect(t.root.dataset.light).toBe("day-dusk");
    expect(image()).toBe(
      '-webkit-cross-fade(url("art/bg-fall.webp"), url("art/bg-fall-dusk.webp"), 17%)',
    );
    expect(t.root.style.getPropertyValue("--frost-image")).toContain("bg-fall-dusk-blur.webp");
    // 17:30: full night.
    t.advance(90 * 60 * 1000);
    t.app.tick();
    expect(t.root.dataset.light).toBe("night");
    // Light header text over the night sky.
    expect(t.root.dataset.header).toBe("light");
    expect(image()).toBe('url("art/bg-fall-night.webp")');
    expect(t.root.style.getPropertyValue("--frost-image")).toBe(
      'url("art/bg-fall-night-blur.webp")',
    );
  });

  it("ignores bundles that do not match the schema", () => {
    const t = setup();
    t.app.render(JSON.stringify(sampleBundle()));
    t.app.render('{"schemaVersion":2}');
    t.app.render("not json");
    expect(t.log).toHaveBeenCalledTimes(2);
    expect(t.root.querySelector(".kid-column")).not.toBeNull();
  });

  it("opens details for tappable items and closes on tap, screen change or idle", () => {
    const t = setup();
    t.app.render(JSON.stringify(sampleBundle()));
    const sheet = t.root.querySelector(".sheet") as HTMLElement;
    expect(sheet.hidden).toBe(true);
    // Only items with details are tappable, and they say so.
    const tappable = t.root.querySelectorAll('[data-screen="today"] [data-action="details"]');
    expect(tappable).toHaveLength(1);
    expect(tappable[0]?.querySelector(".tap-hint svg")).not.toBeNull();

    t.click('[data-screen="today"] [data-action="details"]');
    expect(sheet.hidden).toBe(false);
    expect(t.app.openDetails).toBe("e1");
    expect(sheet.querySelector(".sheet-title")?.textContent).toBe("Science Museum");
    expect(sheet.querySelector(".sheet-when")?.textContent).toBe("9:00 AM");
    expect(sheet.querySelector(".sheet-details")?.textContent).toBe(
      "The bus leaves at 9.\nYou will see the dinosaurs!",
    );
    t.click(".sheet-card");
    expect(sheet.hidden).toBe(true);

    // A new bundle keeps an open sheet current; one without the item closes it.
    t.click('[data-screen="today"] [data-action="details"]');
    t.app.render(JSON.stringify(sampleBundle()));
    expect(sheet.hidden).toBe(false);
    const gone = sampleBundle();
    for (const kid of gone.kids) for (const i of kid.specials) i.details = null;
    for (const day of [...gone.week, ...gone.days]) for (const i of day.items) i.details = null;
    t.app.render(JSON.stringify(gone));
    expect(sheet.hidden).toBe(true);

    t.app.render(JSON.stringify(sampleBundle()));
    t.click('[data-action="go"][data-screen="week"]');
    t.click('[data-screen="week"] .week-item[data-action="details"][data-item="e8"]');
    expect(sheet.querySelector(".sheet-when")?.textContent).toBe("Fri Nov 20 · 5:00 PM");
    t.click('[data-action="go"][data-screen="today"]'); // behind the sheet: closes it first
    t.click('[data-screen="today"] [data-action="details"]');
    t.advance(SHEET_CLOSE_MS - 1000);
    t.app.tick();
    expect(sheet.hidden).toBe(false);
    t.advance(1000);
    t.app.tick();
    expect(sheet.hidden).toBe(true);
  });

  it("navigates between screens and drifts back to Today when left alone", () => {
    const t = setup();
    t.app.render(JSON.stringify(sampleBundle()));
    t.click('[data-action="go"][data-screen="week"]');
    expect(t.active()).toBe("week");
    expect(t.app.currentScreen).toBe("week");
    t.advance(IDLE_RETURN_MS - 1000);
    t.app.tick();
    expect(t.active()).toBe("week");
    t.advance(1000);
    t.app.tick();
    expect(t.active()).toBe("today");
  });

  it("offers a Photos button only when there are slides, and asks the shell to show them", () => {
    const t = setup();
    t.app.render(JSON.stringify({ ...sampleBundle(), slides: [] }));
    expect(t.root.querySelector('[data-action="photos"]')).toBeNull();
    t.app.render(
      JSON.stringify({ ...sampleBundle(), slides: [{ sha256: "a".repeat(64), kind: "photo" }] }),
    );
    t.click('[data-action="photos"]');
    expect(t.native.showPhotos).toHaveBeenCalledOnce();
  });

  it("offers a power button only to shells that can sleep, and asks the shell to sleep", () => {
    const t = setup();
    t.app.render(JSON.stringify(sampleBundle()));
    expect(t.root.querySelector('[data-action="sleep"]')).toBeNull();
    const native = t.native as typeof t.native & { sleepNow: ReturnType<typeof vi.fn> };
    native.sleepNow = vi.fn();
    t.app.render(JSON.stringify(sampleBundle()));
    t.click('[data-action="settings"]');
    expect(t.app.openDetails).toBe("settings");
    t.click('[data-screen="today"] [data-action="sleep"]');
    expect(native.sleepNow).toHaveBeenCalledOnce();
    expect(t.app.openDetails).toBeNull();
    expect(t.active()).toBe("today");
  });

  it("opens the week from anywhere on Today's week bar and pages through weeks", () => {
    const t = setup();
    t.app.render(JSON.stringify(sampleBundle()));
    t.click(".week-strip .week-strip-days");
    expect(t.active()).toBe("week");
    const title = () =>
      t.root.querySelector('[data-screen="week"] .week-title')?.firstChild?.textContent;
    const pager = (step: string) =>
      t.root.querySelector<HTMLButtonElement>(`[data-action="week-page"][data-step="${step}"]`);
    const firstDay = () => t.root.querySelector('[data-screen="week"] .week-day .dom')?.textContent;
    expect(title()).toBe("This week");
    expect(firstDay()).toBe("16");
    pager("1")?.click();
    expect(title()).toBe("Next week");
    expect(firstDay()).toBe("23");
    for (let i = 0; i < 5; i++) pager("1")?.click();
    expect(title()).toBe("In 4 weeks");
    expect(pager("1")?.disabled).toBe(true);
    for (let i = 0; i < 6; i++) pager("-1")?.click();
    expect(title()).toBe("Last week");
    expect(pager("-1")?.disabled).toBe(true);
    t.click('[data-screen="week"] [data-action="go"][data-screen="today"]');
    t.click(".week-strip");
    expect(title()).toBe("This week");
  });

  it("opens a whole day from a crowded column's more chip, and closes it when the day is gone", () => {
    const t = setup();
    const crowded = sampleBundle();
    const day = crowded.days.find((d) => d.date === "2026-11-18");
    const base = day?.items[0] ?? crowded.week.flatMap((d) => d.items)[0];
    if (!day || !base) throw new Error("sample has no items");
    day.items = Array.from({ length: 9 }, (_, i) => ({ ...base, id: `c${i}`, details: null }));
    t.app.render(JSON.stringify(crowded));
    t.click('[data-action="go"][data-screen="week"]');
    t.click('[data-screen="week"] [data-action="day"][data-date="2026-11-18"]');
    const sheet = t.root.querySelector(".sheet") as HTMLElement;
    expect(sheet.hidden).toBe(false);
    expect(sheet.querySelectorAll(".week-item")).toHaveLength(9);
    expect(t.app.openDetails).toBe("day:2026-11-18");
    // A bundle that no longer has that day closes the sheet.
    t.app.render(JSON.stringify({ ...sampleBundle(), days: [], week: [] }));
    expect(sheet.hidden).toBe(true);
  });

  it("opens frame settings from the gear and hands Wi-Fi to the shell", () => {
    const t = setup();
    const native = t.native as typeof t.native & {
      deviceInfo: () => string;
      openWifiSettings: () => void;
    };
    native.deviceInfo = () =>
      JSON.stringify({
        versionName: "1.0.40",
        autoUpdates: true,
        network: "Home",
        ip: "192.0.2.10",
      });
    native.openWifiSettings = vi.fn();
    t.app.render(
      JSON.stringify({ ...sampleBundle(), device: { id: "d1", name: "Kitchen frame" } }),
    );
    t.app.setStatus(JSON.stringify({ online: false, updatedAt: "2026-11-16T12:40:00Z" }));
    t.click('[data-action="settings"]');
    const sheet = t.root.querySelector(".sheet") as HTMLElement;
    expect(sheet.hidden).toBe(false);
    expect(sheet.querySelector(".sheet-title")?.textContent).toBe("Kitchen frame");
    const values = [...sheet.querySelectorAll(".settings-value")].map((e) => e.textContent);
    expect(values).toEqual([
      "Home · 192.0.2.10",
      "Offline since 7:40 AM",
      "No photos yet",
      "1.0.40 · updates itself",
    ]);
    t.click('[data-action="wifi"]');
    expect(native.openWifiSettings).toHaveBeenCalledOnce();
    expect(sheet.hidden).toBe(true);
  });

  it("shows sensible settings for an older shell", () => {
    const t = setup();
    t.app.render(JSON.stringify(sampleBundle()));
    t.app.setStatus(JSON.stringify({ online: true, updatedAt: null }));
    t.click('[data-action="settings"]');
    const sheet = t.root.querySelector(".sheet") as HTMLElement;
    expect(sheet.querySelector(".sheet-title")?.textContent).toBe("This frame");
    expect(sheet.querySelector('[data-action="wifi"]')).toBeNull();
    const values = [...sheet.querySelectorAll(".settings-value")].map((e) => e.textContent);
    expect(values[0]).toBe("Not connected");
    expect(values[1]).toBe("Up to date");
    expect(values[3]).toBe("Unknown");
  });

  it("adds an event from a day's + : who, when, title, sticker, then save", () => {
    const t = setup();
    const native = t.native as typeof t.native & { addEvent: ReturnType<typeof vi.fn> };
    native.addEvent = vi.fn();
    t.app.render(JSON.stringify(sampleBundle()));
    t.click('[data-action="go"][data-screen="week"]');
    // No + on days before today; one on today and after.
    expect(t.root.querySelectorAll('[data-screen="week"] [data-action="add"]')).toHaveLength(7);
    t.click('[data-screen="week"] [data-action="add"][data-date="2026-11-18"]');
    const sheet = t.root.querySelector(".sheet") as HTMLElement;
    expect(sheet.querySelector(".sheet-title")?.textContent).toBe("Add to Wednesday, Nov 18");
    const save = () => sheet.querySelector<HTMLButtonElement>('[data-action="add-save"]');
    expect(save()?.disabled).toBe(true);

    const title = sheet.querySelector(".add-title") as HTMLInputElement;
    title.value = "Library books due";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    expect(sheet.querySelector(".add-sticker")?.getAttribute("src")).toBe("art/stk-book.webp");
    expect(save()?.disabled).toBe(true); // still needs who
    t.click('[data-action="add-who"][data-owner="theo"]');
    t.click('[data-action="add-hour"][data-hour="15"]');
    t.click('[data-action="add-minute"][data-minute="30"]');
    expect(sheet.querySelector(".add-when")?.textContent).toBe("3:30 PM");
    t.click('[data-action="add-sticker"][data-sticker="star"]');
    // Taps on the card itself never close the form.
    t.click(".add-sheet");
    expect(sheet.hidden).toBe(false);
    t.click('[data-action="add-save"]');
    expect(native.addEvent).toHaveBeenCalledOnce();
    const [requestId, json] = native.addEvent.mock.calls[0] as [string, string];
    expect(JSON.parse(json)).toEqual({
      owner: { kind: "kid", kidId: "theo" },
      title: "Library books due",
      date: "2026-11-18",
      time: "15:30",
      sticker: "star",
      description: "",
    });
    expect(sheet.querySelector(".add-status")?.textContent).toBe("Saving…");
    // A new bundle mid-save does not wipe the form.
    t.app.render(JSON.stringify(sampleBundle()));
    expect(t.app.addDraft?.title).toBe("Library books due");

    t.app.eventFailed(requestId, "offline");
    expect(sheet.querySelector(".add-status")?.textContent).toBe(
      "Couldn’t save. Is the frame online?",
    );
    t.click('[data-action="add-allday"]');
    t.click('[data-action="add-who"][data-owner="everyone"]');
    t.click('[data-action="add-save"]');
    const [second, json2] = native.addEvent.mock.calls[1] as [string, string];
    expect(JSON.parse(json2)).toMatchObject({ owner: { kind: "everyone" }, time: null });
    t.app.eventFailed(second, "invalid");
    expect(sheet.querySelector(".add-status")?.textContent).toMatch(/Check the title/);
    t.click('[data-action="add-save"]');
    const [third] = native.addEvent.mock.calls[2] as [string, string];
    t.app.eventSaved("stale", "x");
    expect(sheet.hidden).toBe(false);
    t.app.eventSaved(third, "g-new");
    expect(sheet.hidden).toBe(true);
    expect(t.app.addDraft).toBeNull();
  });

  it("sends what is typed in Notes with a new event", () => {
    const t = setup();
    const native = t.native as typeof t.native & { addEvent: ReturnType<typeof vi.fn> };
    native.addEvent = vi.fn();
    t.app.render(JSON.stringify(sampleBundle()));
    t.click('[data-action="go"][data-screen="week"]');
    t.click('[data-screen="week"] [data-action="add"][data-date="2026-11-18"]');
    type(t, ".add-title", "Dentist");
    type(t, ".add-description", "  Brush first\nDr. Lee, room 4 ");
    t.click('[data-action="add-who"][data-owner="maya"]');
    t.click('[data-action="add-save"]');
    expect(JSON.parse(native.addEvent.mock.calls[0]?.[1] as string)).toMatchObject({
      title: "Dentist",
      description: "Brush first\nDr. Lee, room 4",
    });
  });

  describe("editing an event", () => {
    /** The sample bundle with Google ids: Soccer is a one-off, Pajama day repeats. */
    function googleBundle() {
      const bundle = sampleBundle();
      const ids: Record<string, string> = {
        "Soccer practice": "g-soc1",
        "Pajama day": "g-pj_20261119",
        "Science Museum": "g-sci1",
      };
      for (const day of [...bundle.days, ...bundle.week]) {
        for (const item of day.items) item.id = ids[item.title] ?? item.id;
      }
      for (const kid of bundle.kids) {
        for (const item of [...kid.specials, ...kid.activities])
          item.id = ids[item.title] ?? item.id;
      }
      return bundle;
    }
    function editing() {
      const t = setup();
      const native = t.native as typeof t.native & { editEvent: ReturnType<typeof vi.fn> };
      native.editEvent = vi.fn();
      t.app.render(JSON.stringify(googleBundle()));
      t.click('[data-action="go"][data-screen="week"]');
      const sheet = t.root.querySelector(".sheet") as HTMLElement;
      const sent = (n = 0) => {
        const [requestId, eventId, json] = native.editEvent.mock.calls[n] as [
          string,
          string,
          string,
        ];
        return { requestId, eventId, body: JSON.parse(json) };
      };
      return { ...t, native, sheet, sent };
    }

    it("opens any Google event, then edits it in the form and saves to the shell", () => {
      const t = editing();
      // Soccer has no details, yet opens: its sheet carries the Edit button.
      t.click('[data-screen="week"] [data-item="g-soc1"]');
      expect(t.sheet.querySelector(".sheet-title")?.textContent).toBe("Soccer practice");
      expect(t.sheet.querySelector(".sheet-details")).toBeNull();
      t.click('[data-action="edit-event"]');

      expect(t.sheet.querySelector(".sheet-title")?.textContent).toBe("Tuesday, Nov 17");
      expect((t.sheet.querySelector(".add-title") as HTMLInputElement).value).toBe(
        "Soccer practice",
      );
      expect(t.sheet.querySelector(".add-chip.who.on")?.textContent).toBe("Theo");
      expect(t.sheet.querySelector('[data-action="add-hour"].on')?.textContent).toBe("4p");
      expect(t.sheet.querySelector('[data-action="add-save"]')?.textContent).toBe("Save");
      // A one-off event has no "every time" switch.
      expect(t.sheet.querySelector('[data-action="add-scope"]')).toBeNull();

      type(t, ".add-description", "Shin guards\nField 3");
      t.click('[data-action="add-day"][data-step="1"]');
      expect(t.sheet.querySelector(".sheet-title")?.textContent).toBe("Wednesday, Nov 18");
      t.click('[data-action="add-minute"][data-minute="30"]');
      t.click('[data-action="add-save"]');
      const { requestId, eventId, body } = t.sent();
      expect(eventId).toBe("g-soc1");
      expect(body).toEqual({
        owner: { kind: "kid", kidId: "theo" },
        title: "Soccer practice",
        date: "2026-11-18",
        time: "16:30",
        sticker: null,
        description: "Shin guards\nField 3",
        from: "2026-11-17",
        scope: "one",
      });

      t.app.eventFailed(requestId, "refused");
      expect(t.sheet.querySelector(".add-status")?.textContent).toMatch(
        /Couldn’t change that event/,
      );
      t.click('[data-action="add-save"]');
      t.app.eventSaved(t.sent(1).requestId, "g-soc1");
      expect(t.sheet.hidden).toBe(true);
    });

    it("prefills the note and details, and keeps the event's sticker", () => {
      const t = editing();
      t.click('[data-screen="week"] [data-item="g-sci1"]');
      expect(t.sheet.querySelector(".sheet-details")).not.toBeNull();
      t.click('[data-action="edit-event"]');
      expect((t.sheet.querySelector(".add-description") as HTMLTextAreaElement).value).toBe(
        "Sneakers on · packed lunch\nThe bus leaves at 9.\nYou will see the dinosaurs!",
      );
      // Yesterday is the earliest day offered (the server allows it); later is always fine.
      t.click('[data-action="add-day"][data-step="-1"]');
      expect(t.sheet.querySelector(".sheet-title")?.textContent).toBe("Sunday, Nov 15");
      expect(
        t.sheet.querySelector<HTMLButtonElement>('[data-action="add-day"][data-step="-1"]')
          ?.disabled,
      ).toBe(true);
    });

    it("asks whether a repeating event changes just this day or every time", () => {
      const t = editing();
      t.click('[data-screen="week"] [data-item="g-pj_20261119"]');
      t.click('[data-action="edit-event"]');
      // It stays whose it is: only its own chip is offered.
      expect([...t.sheet.querySelectorAll(".add-chip.who")].map((c) => c.textContent)).toEqual([
        "Everyone",
      ]);
      t.click('[data-action="add-day"][data-step="1"]');
      t.click('[data-action="add-scope"][data-scope="all"]');
      expect(t.sheet.querySelector(".sheet-title")?.textContent).toBe("Every time");
      // The whole series keeps its day and stays all day.
      expect(t.sheet.querySelector<HTMLButtonElement>('[data-step="1"]')?.disabled).toBe(true);
      expect(t.sheet.querySelector('[data-action="add-hour"]')).toBeNull();
      type(t, ".add-title", "PJ day");
      t.click('[data-action="add-save"]');
      expect(t.sent().body).toMatchObject({
        title: "PJ day",
        date: "2026-11-19",
        from: "2026-11-19",
        time: null,
        scope: "all",
      });
    });

    it("deletes an event after asking, and only for shells that can", () => {
      const t = editing();
      const native = t.native as typeof t.native & { deleteEvent: ReturnType<typeof vi.fn> };
      // Without deleteEvent in the shell, no Delete button.
      t.click('[data-screen="week"] [data-item="g-soc1"]');
      t.click('[data-action="edit-event"]');
      expect(t.sheet.querySelector('[data-action="add-delete"]')).toBeNull();
      t.click('[data-action="close-sheet"]');

      native.deleteEvent = vi.fn();
      t.click('[data-screen="week"] [data-item="g-soc1"]');
      t.click('[data-action="edit-event"]');
      t.click('[data-action="add-delete"]');
      expect(t.sheet.querySelector(".add-status")?.textContent).toBe("Delete this event?");
      expect(t.sheet.querySelector('[data-action="add-save"]')).toBeNull();
      // Keep takes it back; so does touching the form.
      t.click('[data-action="add-delete-cancel"]');
      expect(t.sheet.querySelector('[data-action="add-save"]')).not.toBeNull();
      t.click('[data-action="add-delete"]');
      t.click('[data-action="add-minute"][data-minute="15"]');
      expect(t.sheet.querySelector('[data-action="add-delete-confirm"]')).toBeNull();
      expect(native.deleteEvent).not.toHaveBeenCalled();

      t.click('[data-action="add-delete"]');
      t.click('[data-action="add-delete-confirm"]');
      const [requestId, eventId, scope] = native.deleteEvent.mock.calls[0] as string[];
      expect([eventId, scope]).toEqual(["g-soc1", "one"]);
      expect(t.sheet.querySelector(".add-status")?.textContent).toBe("Deleting…");
      t.app.eventFailed(requestId as string, "offline");
      expect(t.sheet.querySelector(".add-status")?.textContent).toMatch(/Is the frame online/);
      t.click('[data-action="add-delete-confirm"]');
      t.app.eventSaved(native.deleteEvent.mock.calls[1]?.[0] as string, "g-soc1");
      expect(t.sheet.hidden).toBe(true);
    });

    it("deletes just this day or every time of a repeating event", () => {
      const t = editing();
      const native = t.native as typeof t.native & { deleteEvent: ReturnType<typeof vi.fn> };
      native.deleteEvent = vi.fn();
      t.click('[data-screen="week"] [data-item="g-pj_20261119"]');
      t.click('[data-action="edit-event"]');
      t.click('[data-action="add-delete"]');
      expect(t.sheet.querySelector(".add-status")?.textContent).toBe("Delete just this day?");
      t.click('[data-action="add-scope"][data-scope="all"]');
      t.click('[data-action="add-delete"]');
      expect(t.sheet.querySelector(".add-status")?.textContent).toBe(
        "Delete every time it repeats?",
      );
      t.click('[data-action="add-delete-confirm"]');
      expect(native.deleteEvent.mock.calls[0]?.slice(1)).toEqual(["g-pj_20261119", "all"]);
    });

    it("opens any Google event on Today too, with the same Edit button", () => {
      const t = setup();
      const native = t.native as typeof t.native & { editEvent: ReturnType<typeof vi.fn> };
      native.editEvent = vi.fn();
      const bundle = googleBundle();
      // An activity on Today without details: tappable only because it can be edited.
      const ballet = bundle.kids[0]?.activities.find((i) => i.title === "Ballet");
      if (!ballet) throw new Error("no Ballet in the sample");
      for (const day of bundle.days) {
        for (const item of day.items) if (item.title === "Ballet") item.id = "g-bal1";
      }
      ballet.id = "g-bal1";
      t.app.render(JSON.stringify(bundle));
      t.click('[data-screen="today"] [data-item="g-bal1"]');
      const sheet = t.root.querySelector(".sheet") as HTMLElement;
      expect(sheet.querySelector(".sheet-title")?.textContent).toBe("Ballet");
      t.click('[data-action="edit-event"]');
      expect((sheet.querySelector(".add-title") as HTMLInputElement).value).toBe("Ballet");
      // Items without a synced Google id stay read-only.
      expect(t.root.querySelector('[data-screen="today"] [data-item="e3"]')).toBeNull();
      const noa = [...t.root.querySelectorAll('[data-screen="today"] .special')].find((el) =>
        el.textContent?.includes("A friend comes over"),
      );
      expect(noa?.getAttribute("data-action")).toBeNull();
    });

    it("offers no Edit to older shells", () => {
      const t = setup();
      t.app.render(JSON.stringify(googleBundle()));
      t.click('[data-action="go"][data-screen="week"]');
      expect(t.root.querySelector('[data-screen="week"] [data-item="g-soc1"]')).toBeNull();
      t.click('[data-screen="week"] [data-item="g-sci1"]');
      expect(t.root.querySelector('[data-action="edit-event"]')).toBeNull();
    });
  });

  it("closes an idle add form after a few minutes, and offers no + to older shells", () => {
    const t = setup();
    t.app.render(JSON.stringify(sampleBundle()));
    t.click('[data-action="go"][data-screen="week"]');
    expect(t.root.querySelector('[data-action="add"]')).toBeNull();
    (t.native as typeof t.native & { addEvent: () => void }).addEvent = vi.fn();
    t.app.render(JSON.stringify(sampleBundle()));
    t.click('[data-action="add"]');
    t.advance(SHEET_CLOSE_MS + 1000);
    t.app.tick();
    expect(t.app.addDraft).not.toBeNull();
    t.advance(ADD_CLOSE_MS);
    t.app.tick();
    expect(t.app.addDraft).toBeNull();
  });

  it("adds a chore from the Chores screen: title, who, when, days, sticker, then save", () => {
    const t = setup();
    const native = t.native as typeof t.native & { addChore: ReturnType<typeof vi.fn> };
    native.addChore = vi.fn();
    t.app.render(JSON.stringify(sampleBundle()));
    t.click('[data-screen="today"] .chore-card');
    expect(t.app.currentScreen).toBe("chores");
    t.click('[data-screen="chores"] [data-action="add-chore"]');
    const sheet = t.root.querySelector(".sheet") as HTMLElement;
    expect(sheet.querySelector(".sheet-title")?.textContent).toBe("Add a chore");
    const save = () => sheet.querySelector<HTMLButtonElement>('[data-action="chore-save"]');
    expect(save()?.disabled).toBe(true);
    expect(
      sheet.querySelector('[data-action="chore-preset"][data-preset="every"]')?.className,
    ).toContain(" on");

    const title = sheet.querySelector(".add-title") as HTMLInputElement;
    title.value = "Brush teeth";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    expect(sheet.querySelector(".add-sticker")?.getAttribute("src")).toBe("art/chore-teeth.webp");
    expect(sheet.querySelector(".add-sticker-pick.on")?.getAttribute("data-sticker")).toBe("teeth");
    expect(save()?.disabled).toBe(true); // still needs who
    t.click('[data-action="chore-who"][data-kid="theo"]');
    expect(save()?.disabled).toBe(false);
    t.click('[data-action="chore-period"][data-period="evening"]');
    t.click('[data-action="chore-preset"][data-preset="weekdays"]');
    t.click('[data-action="chore-day"][data-day="5"]'); // Friday off
    t.click('[data-action="chore-day"][data-day="6"]'); // Saturday on
    t.click(".chore-sheet");
    expect(sheet.hidden).toBe(false);
    t.click('[data-action="chore-save"]');
    expect(native.addChore).toHaveBeenCalledOnce();
    const [requestId, json] = native.addChore.mock.calls[0] as [string, string];
    expect(JSON.parse(json)).toEqual({
      kidId: "theo",
      title: "Brush teeth",
      period: "evening",
      days: [1, 2, 3, 4, 6],
      sticker: "teeth",
    });
    expect(sheet.querySelector(".add-status")?.textContent).toBe("Saving…");
    // A new bundle mid-save does not wipe the form.
    t.app.render(JSON.stringify(sampleBundle()));
    expect(t.app.addChoreDraft?.title).toBe("Brush teeth");

    t.app.choreAddFailed(requestId, "invalid");
    expect(sheet.querySelector(".add-status")?.textContent).toMatch(/Check the title/);
    t.click('[data-action="chore-preset"][data-preset="every"]');
    t.click('[data-action="chore-sticker"][data-sticker="star"]');
    t.click('[data-action="chore-save"]');
    const [second, json2] = native.addChore.mock.calls[1] as [string, string];
    expect(JSON.parse(json2)).toMatchObject({ days: [], sticker: "star" });
    t.app.choreAdded("stale", "{}");
    expect(sheet.hidden).toBe(false);
    t.app.choreAdded(second, "{}");
    expect(sheet.hidden).toBe(true);
    expect(t.app.addChoreDraft).toBeNull();
  });

  it("keeps the last day on, offers no Add chore to older shells, and closes when idle", () => {
    const t = setup();
    t.app.render(JSON.stringify(sampleBundle()));
    expect(t.root.querySelector('[data-action="add-chore"]')).toBeNull();
    (t.native as typeof t.native & { addChore: () => void }).addChore = vi.fn();
    t.app.render(JSON.stringify(sampleBundle()));
    t.click('[data-action="add-chore"]');
    t.click('[data-action="chore-preset"][data-preset="weekends"]');
    t.click('[data-action="chore-day"][data-day="0"]');
    t.click('[data-action="chore-day"][data-day="6"]');
    expect(t.app.addChoreDraft?.days).toEqual([6]);
    t.advance(SHEET_CLOSE_MS + 1000);
    t.app.tick();
    expect(t.app.addChoreDraft).not.toBeNull();
    t.advance(ADD_CLOSE_MS);
    t.app.tick();
    expect(t.app.addChoreDraft).toBeNull();
  });

  it("checks off a chore immediately and tells the shell", () => {
    const t = setup();
    t.app.render(JSON.stringify(sampleBundle()));
    t.click('[data-screen="chores"] .chore-tile[data-kid="theo"][data-chore="bed"]');
    expect(t.native.setChore).toHaveBeenCalledWith("theo", "bed", "2026-11-16", true);
    const tile = () =>
      t.root.querySelector('[data-screen="chores"] .chore-tile[data-kid="theo"][data-chore="bed"]');
    expect(tile()?.classList.contains("done")).toBe(true);
    expect(texts(t.root, '[data-screen="today"] .chore-card-count')).toEqual([
      "3 of 6 done",
      "2 of 6 done",
    ]);

    // A bundle fetched before the save landed must not undo the tap...
    t.app.render(JSON.stringify(sampleBundle()));
    expect(tile()?.classList.contains("done")).toBe(true);
    // ...but once saved, the next bundle is the truth.
    t.app.choreSaved("theo", "bed");
    t.app.render(JSON.stringify(sampleBundle({ done: ["theo/bed"] })));
    expect(tile()?.classList.contains("done")).toBe(true);
    t.app.render(JSON.stringify(sampleBundle({ done: [] })));
    expect(tile()?.classList.contains("done")).toBe(false);
  });

  it("steps the Chores screen through the days and catches up a missed one", () => {
    const t = setup();
    const native = t.native as typeof t.native & { addChore: ReturnType<typeof vi.fn> };
    native.addChore = vi.fn();
    // Wednesday: Monday had Theo's bed done, Tuesday nothing.
    const now = new Date("2026-11-18T15:00:00Z");
    const bundle = sampleBundle({ now, done: [] });
    const monday = bundle.days.find((d) => d.date === "2026-11-16");
    const bed = monday?.chores.find((d) => d.kidId === "theo")?.chores.find((c) => c.id === "bed");
    if (bed) bed.done = true;
    t.app.render(JSON.stringify(bundle));
    const day = () => t.root.querySelector('[data-screen="chores"] .chore-day-name')?.textContent;

    // From the week, a day's Chores module opens that day.
    t.click('[data-action="go"][data-screen="week"]');
    t.click('[data-screen="week"] .week-chores[data-date="2026-11-17"]');
    expect(t.app.currentScreen).toBe("chores");
    expect(day()).toBe("Tuesday, Nov 17");
    const tile = (kid: string, chore: string) =>
      t.root.querySelector(
        `[data-screen="chores"] .chore-tile[data-kid="${kid}"][data-chore="${chore}"]`,
      );
    expect(tile("theo", "bed")?.classList.contains("missed")).toBe(true);
    t.click('[data-screen="chores"] .chore-tile[data-kid="theo"][data-chore="bed"]');
    expect(t.native.setChore).toHaveBeenCalledWith("theo", "bed", "2026-11-17", true);
    expect(tile("theo", "bed")?.classList.contains("done")).toBe(true);
    // The week's count follows the tap; today's does not.
    expect(
      texts(t.root, '[data-screen="week"] .week-chores[data-date="2026-11-17"] .week-chore'),
    ).toEqual(["M0/6", "T1/6"]);
    expect(texts(t.root, '[data-screen="today"] .chore-card-count')).toEqual([
      "0 of 6 done",
      "0 of 6 done",
    ]);
    t.app.choreSaved("theo", "bed", "2026-11-17");

    // Back a day: Monday's done one shows done.
    t.click('[data-screen="chores"] [data-action="chores-day"][data-step="-1"]');
    expect(day()).toBe("Monday, Nov 16");
    expect(tile("theo", "bed")?.classList.contains("done")).toBe(true);
    // Forward past today: days ahead show their chores but cannot be ticked.
    for (let i = 0; i < 3; i++)
      t.click('[data-screen="chores"] [data-action="chores-day"][data-step="1"]');
    expect(day()).toBe("Thursday, Nov 19");
    expect(t.root.querySelector('[data-screen="chores"] [data-action="toggle-chore"]')).toBeNull();
    expect(
      t.root.querySelectorAll('[data-screen="chores"] .chore-tile.ahead').length,
    ).toBeGreaterThan(0);
    // A failed catch-up rolls back on its own day.
    t.click('[data-screen="chores"] [data-action="chores-day"][data-step="-1"]');
    t.click('[data-screen="chores"] [data-action="chores-day"][data-step="-1"]');
    t.click('[data-screen="chores"] .chore-tile[data-kid="maya"][data-chore="teeth"]');
    t.app.choreFailed("maya", "teeth", "2026-11-17");
    expect(tile("maya", "teeth")?.classList.contains("missed")).toBe(true);
    // Today's chores from the Today card, whatever day was open before.
    t.click('[data-action="go"][data-screen="today"]');
    t.click('[data-screen="today"] .chore-card');
    expect(day()).toBe("Wednesday, Nov 18");
    expect(t.native.setChore.mock.calls.map((c) => c[2])).not.toContain("2026-11-19");
  });

  it("tells the joke of the day, then bonus ones, and stops saying NEW once heard", () => {
    const t = setup();
    t.app.render(JSON.stringify(sampleBundle()));
    const sheet = t.root.querySelector(".sheet") as HTMLElement;
    expect(t.root.querySelector("[data-action='joke'] .rail-new")).not.toBeNull();
    t.click('[data-action="joke"]');
    expect(sheet.hidden).toBe(false);
    expect(t.app.openDetails).toBe("joke");
    // Taps on the card do not close it.
    t.click(".joke-sheet");
    expect(sheet.hidden).toBe(false);
    t.click('[data-action="joke-reveal"]');
    expect(sheet.querySelector(".joke-punch")).not.toBeNull();
    expect(t.root.querySelector("[data-action='joke'] .rail-new")).toBeNull();
    // A new bundle keeps the joke where it was.
    t.app.render(JSON.stringify(sampleBundle()));
    expect(sheet.querySelector(".joke-punch")).not.toBeNull();
    for (let i = 0; i < 3; i++) {
      t.click('[data-action="joke-next"]');
      t.click('[data-action="joke-reveal"]');
    }
    expect(sheet.querySelector(".joke-tag")?.textContent).toBe("BONUS JOKE 3 OF 3");
    t.click('.joke-foot [data-action="close-sheet"]');
    expect(sheet.hidden).toBe(true);
    // Opening again starts over with the joke of the day.
    t.click('[data-action="joke"]');
    expect(sheet.querySelector(".joke-tag")?.textContent).toBe("JOKE OF THE DAY");
    expect(sheet.querySelector(".joke-punch")).toBeNull();
  });

  it("plays the day's trivia as a team, picking up where it left off", () => {
    const t = setup();
    t.app.render(JSON.stringify(sampleBundle()));
    const sheet = t.root.querySelector(".sheet") as HTMLElement;
    const tag = () => sheet.querySelector(".joke-tag")?.textContent;
    expect(t.root.querySelector("[data-action='trivia'] .rail-new")).not.toBeNull();
    t.click('[data-action="trivia"]');
    expect(tag()).toBe("TRIVIA · 1 OF 3");
    t.click('[data-action="trivia-answer"][data-index="1"]');
    expect(sheet.querySelector(".trivia-verdict")?.textContent).toBe("You got it!");
    expect(t.root.querySelector("[data-action='trivia'] .rail-new")).toBeNull();
    t.click('[data-action="trivia-next"]');
    expect(tag()).toBe("TRIVIA · 2 OF 3");
    // Closing and coming back resumes at the unanswered question.
    t.click('[data-action="close-sheet"]');
    t.click('[data-action="trivia"]');
    expect(tag()).toBe("TRIVIA · 2 OF 3");
    t.click('[data-action="trivia-answer"][data-index="0"]');
    t.click('[data-action="trivia-next"]');
    t.click('[data-action="trivia-answer"][data-index="0"]');
    expect(sheet.querySelector(".trivia-score")?.textContent).toBe("2 of 3, nice!");
    // Done: reopening shows the score; a new day's questions start afresh.
    t.click('.trivia-result [data-action="close-sheet"]');
    t.click('[data-action="trivia"]');
    expect(sheet.querySelector(".trivia-score")).not.toBeNull();
    t.app.render(JSON.stringify(sampleBundle({ now: new Date("2026-11-17T12:00:00Z") })));
    t.click('[data-action="close-sheet"]');
    t.click('[data-action="trivia"]');
    expect(tag()).toBe("TRIVIA · 1 OF 3");
    expect(sheet.querySelector(".trivia-result")).toBeNull();
    // No trivia today: no button, and a stale open sheet closes.
    t.app.render(JSON.stringify({ ...sampleBundle(), trivia: [] }));
    expect(t.root.querySelector('[data-action="trivia"]')).toBeNull();
    expect(sheet.hidden).toBe(true);
  });

  it("opens today's history and place, and closes them when a bundle has none", () => {
    const t = setup();
    t.app.render(JSON.stringify(sampleBundle()));
    const sheet = t.root.querySelector(".sheet") as HTMLElement;
    t.click('[data-action="history"]');
    expect(sheet.querySelectorAll(".history-event")).toHaveLength(3);
    t.click(".facts-sheet");
    expect(sheet.hidden).toBe(false);
    t.click('[data-action="close-sheet"]');
    t.click('[data-action="place"]');
    expect(sheet.querySelector(".place-name")?.textContent).toBe("Vermont");
    t.app.render(JSON.stringify({ ...sampleBundle(), place: null, history: [] }));
    expect(sheet.hidden).toBe(true);
    expect(t.root.querySelector('[data-action="place"]')).toBeNull();
    expect(t.root.querySelector('[data-action="history"]')).toBeNull();
  });

  it("un-checks a done chore, and rolls back a failed save", () => {
    const t = setup();
    t.app.render(JSON.stringify(sampleBundle()));
    t.click('.chore-tile[data-kid="maya"][data-chore="bed"]');
    expect(t.native.setChore).toHaveBeenCalledWith("maya", "bed", "2026-11-16", false);
    t.app.choreFailed("maya", "bed");
    expect(
      t.root
        .querySelector('.chore-tile[data-kid="maya"][data-chore="bed"]')
        ?.classList.contains("done"),
    ).toBe(true);
    t.app.choreSaved("nobody", "nothing");
  });

  it("ignores clicks outside actions and taps before a bundle", () => {
    const t = setup();
    t.root.click();
    t.app.choreFailed("maya", "bed");
    t.app.tick();
    expect(t.native.setChore).not.toHaveBeenCalled();
  });

  it("uses verified photos and rejects anything else", () => {
    const t = setup();
    t.app.render(JSON.stringify(sampleBundle()));
    t.app.setPhotos(JSON.stringify({ maya: "data:image/jpeg;base64,AAAA" }));
    expect(t.root.querySelector(".kid-column img.avatar")?.getAttribute("src")).toBe(
      "data:image/jpeg;base64,AAAA",
    );
    t.app.setPhotos(JSON.stringify({ maya: "https://evil.example/x.jpg" }));
    expect(t.log).toHaveBeenCalledWith("Ignoring malformed photos");
  });

  it("shows when the frame is offline and since when", () => {
    const t = setup();
    const status = () => t.root.querySelector<HTMLElement>(".status");
    t.app.setStatus(JSON.stringify({ online: false, updatedAt: null }));
    expect(status()?.textContent).toBe("Offline");
    t.app.render(JSON.stringify(sampleBundle()));
    t.app.setStatus(JSON.stringify({ online: false, updatedAt: "2026-11-16T12:40:00Z" }));
    expect(status()?.hidden).toBe(false);
    expect(status()?.textContent).toBe("Offline · updated 7:40 AM");
    t.app.setStatus(JSON.stringify({ online: false, updatedAt: null }));
    expect(status()?.textContent).toBe("Offline");
    t.app.setStatus(JSON.stringify({ online: true, updatedAt: null }));
    expect(status()?.hidden).toBe(true);
    t.app.setStatus("garbage");
    expect(status()?.hidden).toBe(true);
  });
});

describe("boot", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("installs window.kidsDash, asks the shell for data and ticks", () => {
    document.body.innerHTML = '<div id="app"></div>';
    const native = { ready: vi.fn(), setChore: vi.fn() };
    const app = boot(native, document.getElementById("app") as HTMLElement);
    expect(window.kidsDash).toBe(app);
    expect(native.ready).toHaveBeenCalledOnce();
    const tick = vi.spyOn(app, "tick");
    vi.advanceTimersByTime(15_000);
    expect(tick).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event("resize"));
  });
});

describe("fitStage", () => {
  it("is identity at the frame's size and scales elsewhere", () => {
    const stage = document.createElement("div");
    expect(fitStage(stage, 1920, 1080)).toBe(1);
    expect(stage.style.transform).toBe("");
    expect(fitStage(stage, 960, 1080)).toBe(0.5);
    expect(stage.style.transform).toBe("scale(0.5)");
  });
});

function type(t: { root: HTMLElement }, selector: string, value: string) {
  const field = t.root.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}
