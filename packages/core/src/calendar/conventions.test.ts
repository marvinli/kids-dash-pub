import { describe, expect, it } from "vitest";
import {
  type CalendarEntry,
  fromCalendarEntry,
  occursOn,
  parseDescription,
  withKidsText,
} from "./conventions";

describe("parseDescription", () => {
  it("returns empty directives for no description", () => {
    expect(parseDescription(null)).toEqual({
      note: null,
      details: null,
      special: false,
      hidden: false,
      badge: null,
      sticker: null,
    });
  });

  it("reads the note and directives, ignoring the parents-only rest", () => {
    const d = parseDescription(
      "Sneakers on · packed lunch\nkids: special, badge=Field trip, sticker=BUS\nPermission slip signed.",
    );
    expect(d).toEqual({
      note: "Sneakers on · packed lunch",
      details: null,
      special: true,
      hidden: false,
      badge: "Field trip",
      sticker: "bus",
    });
  });

  it("reads kid-facing details between the note and the directives", () => {
    const d = parseDescription(
      "Bring a can of soup\nDrop it outside 590.\n\n\n\nIt goes to the soup kitchen.\nkids: special\nParents only.",
    );
    expect(d.note).toBe("Bring a can of soup");
    expect(d.details).toBe("Drop it outside 590.\n\nIt goes to the soup kitchen.");
  });

  it("never treats text as details without a directives line, or below it", () => {
    expect(parseDescription("Bring your flute!\nLesson after dismissal.").details).toBeNull();
    expect(parseDescription("Note\nkids: special\nParents only.").details).toBeNull();
    expect(parseDescription("kids: special\nNote\nMore").details).toBeNull();
  });

  it("caps details", () => {
    const d = parseDescription(`Note\n${"x".repeat(500)}\nkids: special`);
    expect(d.details).toHaveLength(400);
  });

  it("does not show the directive line as the note", () => {
    expect(parseDescription("kids: hide").note).toBeNull();
    expect(parseDescription("kids: hide").hidden).toBe(true);
  });

  it("ignores unknown stickers and directives", () => {
    const d = parseDescription("kids: sticker=unicorn, sparkle, badge=");
    expect(d.sticker).toBeNull();
    expect(d.badge).toBeNull();
    expect(d.special).toBe(false);
  });

  it("reads descriptions Google stored as HTML", () => {
    const d = parseDescription(
      "<p>Bring cleats &amp; water</p><br>kids: special<br/>Coach&#39;s cell",
    );
    expect(d.note).toBe("Bring cleats & water");
    expect(d.special).toBe(true);
  });

  it("decodes the remaining entities", () => {
    expect(parseDescription("&lt;3&nbsp;&quot;hi&quot; &gt;").note).toBe('<3 "hi" >');
  });

  it("truncates long notes and badges", () => {
    const d = parseDescription(`${"x".repeat(200)}\nkids: badge=${"b".repeat(40)}`);
    expect(d.note).toHaveLength(120);
    expect(d.badge).toHaveLength(24);
  });
});

const entry = (overrides: Partial<CalendarEntry> = {}): CalendarEntry => ({
  id: "evt1",
  title: "Field trip",
  description: null,
  start: { date: "2026-11-16", time: "09:00" },
  end: { date: "2026-11-16", time: "14:00" },
  allDay: false,
  ...overrides,
});

describe("fromCalendarEntry", () => {
  const maya = { kind: "kid", kidId: "maya" } as const;

  it("infers the sticker and leaves plain events unpinned", () => {
    const e = fromCalendarEntry(entry({ title: "Soccer practice" }), maya);
    expect(e).toMatchObject({ sticker: "soccer", special: false, badge: null, source: "google" });
  });

  it("pins specials with a default badge", () => {
    const e = fromCalendarEntry(entry({ description: "Packed lunch\nkids: special" }), maya);
    expect(e).toMatchObject({ special: true, badge: "Field trip", note: "Packed lunch" });
  });

  it("treats a badge as making an event special", () => {
    const e = fromCalendarEntry(entry({ description: "kids: badge=Big day" }), maya);
    expect(e).toMatchObject({ special: true, badge: "Big day" });
  });

  it("drops hidden events and names untitled ones", () => {
    expect(fromCalendarEntry(entry({ description: "kids: hide" }), maya)).toBeNull();
    expect(fromCalendarEntry(entry({ title: "  " }), maya)?.title).toBe("Busy");
  });
});

describe("occursOn", () => {
  it("places timed events on their start date", () => {
    const e = entry();
    expect(occursOn(e, "2026-11-16")).toBe(true);
    expect(occursOn(e, "2026-11-17")).toBe(false);
  });

  it("treats all-day end dates as exclusive", () => {
    const e = entry({
      allDay: true,
      start: { date: "2026-11-18", time: null },
      end: { date: "2026-11-20", time: null },
    });
    expect(
      ["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"].map((d) => occursOn(e, d)),
    ).toEqual([false, true, true, false]);
  });

  it("covers the start day when an all-day end is missing or equal", () => {
    const e = entry({
      allDay: true,
      start: { date: "2026-11-18", time: null },
      end: { date: "2026-11-18", time: null },
    });
    expect(occursOn(e, "2026-11-18")).toBe(true);
    expect(occursOn(e, "2026-11-19")).toBe(false);
  });
});

describe("withKidsText", () => {
  const roundTrip = (description: string) => {
    const d = parseDescription(description);
    return { note: d.note, details: d.details, sticker: d.sticker, special: d.special };
  };

  it("writes a one-line note on its own", () => {
    expect(withKidsText(null, "Bring shin guards")).toBe("Bring shin guards");
    expect(withKidsText("", "  ")).toBe("");
  });

  it("puts a directives line under details so they show on tap", () => {
    const out = withKidsText(null, "Bring shin guards\nField 3, by the swings\n");
    expect(out).toBe("Bring shin guards\nField 3, by the swings\nkids:");
    expect(roundTrip(out)).toMatchObject({
      note: "Bring shin guards",
      details: "Field 3, by the swings",
    });
  });

  it("replaces only the kid-facing part, keeping directives and parents-only lines", () => {
    const before =
      "Old note\nOld details\nkids: special, badge=Trip\nPermission slip is in the drawer";
    const out = withKidsText(before, "New note");
    expect(out).toBe("New note\nkids: special, badge=Trip\nPermission slip is in the drawer");
    expect(roundTrip(out)).toMatchObject({ note: "New note", details: null, special: true });
  });

  it("keeps parents-only lines hidden when an event had no directives line", () => {
    const out = withKidsText("Old note\nCall Sam's mom first", "");
    expect(out).toBe("kids:\nCall Sam's mom first");
    expect(roundTrip(out).note).toBeNull();
    expect(withKidsText("Old note\nCall Sam's mom first", "Snacks!")).toBe(
      "Snacks!\nkids:\nCall Sam's mom first",
    );
  });

  it("drops the old note of an event with nothing else", () => {
    expect(withKidsText("Old note", "")).toBe("");
  });

  it("sets or replaces the sticker directive", () => {
    expect(withKidsText("kids: special, sticker=bus\nparents", "", "cake")).toBe(
      "kids: special, sticker=cake\nparents",
    );
    expect(withKidsText("Note", "Note", "soccer")).toBe("Note\nkids: sticker=soccer");
    expect(roundTrip(withKidsText(null, "", "soccer")).sticker).toBe("soccer");
  });

  it("defuses a typed line that would read as directives", () => {
    const out = withKidsText(null, "Kids: wear red\nhide");
    expect(out).toBe("Kids - wear red\nhide\nkids:");
    expect(parseDescription(out)).toMatchObject({ note: "Kids - wear red", hidden: false });
  });

  it("reads HTML from Google's web UI as plain text", () => {
    expect(withKidsText("Old<br>more<br>kids: special<br><b>parents</b>", "Hi")).toBe(
      "Hi\nkids: special\nparents",
    );
  });
});
