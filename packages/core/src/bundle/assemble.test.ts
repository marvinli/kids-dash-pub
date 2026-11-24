import { describe, expect, it } from "vitest";
import { Chore, type PlannedEvent, Settings } from "../family";
import { type SampleEventInput, sampleEvent } from "../sample";
import {
  assembleBundle,
  type BundleInputs,
  checkOffFrom,
  choresFor,
  completionKey,
} from "./assemble";
import { DashboardBundle, MAX_SLIDES } from "./schema";

// Monday 2026-11-16, 7:42 in New York.
const NOW = new Date("2026-11-16T12:42:00Z");

const settings = Settings.parse({
  timezone: "America/New_York",
  location: { name: "Home", latitude: 40.7, longitude: -74 },
  kids: [
    { id: "maya", name: "Maya", color: "pink" },
    { id: "theo", name: "Theo", color: "blue" },
  ],
});

let seq = 0;
const event = (input: SampleEventInput): PlannedEvent => sampleEvent(`e${++seq}`, input);

const maya = { kind: "kid", kidId: "maya" } as const;
const theo = { kind: "kid", kidId: "theo" } as const;
const everyone = { kind: "everyone" } as const;

const inputs = (overrides: Partial<BundleInputs> = {}): BundleInputs => ({
  now: NOW,
  settings,
  events: [],
  weather: {
    high: 52,
    low: 41,
    rainChance: 80,
    code: 61,
    current: null,
    sunrise: null,
    sunset: null,
  },
  chores: [],
  notes: [],
  completed: new Set(),
  ...overrides,
});

describe("assembleBundle", () => {
  it("produces a bundle that satisfies its own schema", () => {
    const bundle = assembleBundle(
      inputs({
        events: [event({ owner: maya, title: "Ballet", date: "2026-11-16", time: "16:30" })],
      }),
    );
    expect(DashboardBundle.parse(bundle)).toEqual(bundle);
    expect(bundle).toMatchObject({
      date: "2026-11-16",
      location: "Home",
      generatedAt: NOW.toISOString(),
    });
  });

  it("carries notes and tap-for-details text to today and the week", () => {
    const bundle = assembleBundle(
      inputs({
        events: [
          event({
            owner: maya,
            title: "Food drive",
            date: "2026-11-16",
            time: "07:30",
            note: "Bring soup",
            details: "Drop it outside 590.",
          }),
        ],
      }),
    );
    expect(bundle.kids[0]?.activities[0]).toMatchObject({
      note: "Bring soup",
      details: "Drop it outside 590.",
    });
    expect(bundle.week[0]?.items[0]).toMatchObject({
      note: "Bring soup",
      details: "Drop it outside 590.",
    });
  });

  it("pins specials first and sorts the rest by time", () => {
    const bundle = assembleBundle(
      inputs({
        events: [
          event({ owner: theo, title: "Art club", date: "2026-11-16", time: "15:15" }),
          event({
            owner: theo,
            title: "A friend comes over",
            date: "2026-11-16",
            time: "16:30",
            special: true,
          }),
          event({ owner: theo, title: "Breakfast club", date: "2026-11-16", time: "07:30" }),
        ],
      }),
    );
    const kid = bundle.kids[1];
    expect(kid?.specials.map((s) => [s.title, s.badge])).toEqual([
      ["A friend comes over", "Playdate"],
    ]);
    expect(kid?.activities.map((a) => a.title)).toEqual(["Breakfast club", "Art club"]);
  });

  it("shows shared events in every column and all-day events as specials", () => {
    const bundle = assembleBundle(
      inputs({
        events: [event({ owner: everyone, title: "No school", date: "2026-11-16" })],
      }),
    );
    for (const kid of bundle.kids) {
      expect(kid.specials).toEqual([
        expect.objectContaining({
          title: "No school",
          badge: "No school",
          time: null,
          sticker: "school",
        }),
      ]);
    }
  });

  it("keeps each kid's events in their own column", () => {
    const bundle = assembleBundle(
      inputs({
        events: [event({ owner: maya, title: "Piano", date: "2026-11-16", time: "17:00" })],
      }),
    );
    expect(bundle.kids[0]?.activities).toHaveLength(1);
    expect(bundle.kids[1]?.activities).toHaveLength(0);
  });

  it("drops events for kids no longer in settings", () => {
    const bundle = assembleBundle(
      inputs({
        events: [
          event({
            owner: { kind: "kid", kidId: "sam" },
            title: "Swim",
            date: "2026-11-16",
            time: "10:00",
          }),
        ],
      }),
    );
    expect(bundle.week[0]?.items).toEqual([]);
  });

  it("builds this week, Monday to Sunday, timed items keeping their time", () => {
    const bundle = assembleBundle(
      inputs({
        events: [
          event({ owner: everyone, title: "Pajama day", date: "2026-11-19" }),
          event({
            owner: theo,
            title: "Soccer game",
            date: "2026-11-20",
            time: "17:00",
            special: true,
          }),
          event({ owner: maya, title: "Next week", date: "2026-11-23", time: "09:00" }),
        ],
      }),
    );
    expect(bundle.week.map((d) => d.weekday)).toEqual([
      "MON",
      "TUE",
      "WED",
      "THU",
      "FRI",
      "SAT",
      "SUN",
    ]);
    expect(bundle.week[0]?.isToday).toBe(true);
    expect(bundle.week[3]?.items).toEqual([
      expect.objectContaining({ title: "Pajama day", time: null, special: true, owner: everyone }),
    ]);
    expect(bundle.week[4]?.items[0]).toMatchObject({ time: "17:00", special: true });
    expect(bundle.week.flatMap((d) => d.items).map((i) => i.title)).not.toContain("Next week");
    // The pager's days run a week back to four weeks ahead, today included once.
    expect(bundle.days).toHaveLength(42);
    expect(bundle.days[0]?.date).toBe("2026-11-09");
    expect(bundle.days.at(-1)?.date).toBe("2026-12-20");
    expect(bundle.days.filter((d) => d.isToday).map((d) => d.date)).toEqual(["2026-11-16"]);
    expect(bundle.days.flatMap((d) => d.items).map((i) => i.title)).toContain("Next week");
  });

  it("starts the week on Monday even midweek", () => {
    // Wednesday 2026-11-18: the week is Mon 16 to Sun 22, today third.
    const bundle = assembleBundle(inputs({ now: new Date("2026-11-18T12:00:00Z") }));
    expect(bundle.week.map((d) => d.date)).toEqual([
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
      "2026-11-21",
      "2026-11-22",
    ]);
    expect(bundle.week.findIndex((d) => d.isToday)).toBe(2);
    expect(bundle.days[0]?.date).toBe("2026-11-09");
    expect(bundle.days.at(-1)?.date).toBe("2026-12-20");
    // Sunday is the end of its week, not the start of the next.
    const sunday = assembleBundle(inputs({ now: new Date("2026-11-22T12:00:00Z") }));
    expect(sunday.week[0]?.date).toBe("2026-11-16");
    expect(sunday.week[6]?.isToday).toBe(true);
  });

  it("spreads multi-day all-day events across the days they cover", () => {
    const bundle = assembleBundle(
      inputs({
        events: [
          event({
            owner: everyone,
            title: "Thanksgiving break",
            date: "2026-11-18",
            endDate: "2026-11-20",
          }),
        ],
      }),
    );
    expect(bundle.week.map((d) => d.items.length)).toEqual([0, 0, 1, 1, 1, 0, 0]);
  });

  it("splits notes between kids and the family", () => {
    const bundle = assembleBundle(
      inputs({
        notes: [
          { id: "book", date: "2026-11-16", owner: maya, text: "Library book goes back" },
          { id: "photos", date: "2026-11-16", owner: everyone, text: "Picture day" },
          { id: "later", date: "2026-11-17", owner: maya, text: "Tomorrow" },
        ],
      }),
    );
    expect(bundle.kids[0]?.notes).toEqual([{ id: "book", text: "Library book goes back" }]);
    expect(bundle.kids[1]?.notes).toEqual([]);
    expect(bundle.familyNotes).toEqual([{ id: "photos", text: "Picture day" }]);
  });

  it("carries photo hashes but not storage keys", () => {
    const withPhoto = Settings.parse({
      ...settings,
      kids: [
        {
          id: "maya",
          name: "Maya",
          color: "pink",
          photo: { key: "photos/maya/abc.jpg", sha256: "a".repeat(64), contentType: "image/jpeg" },
        },
      ],
    });
    const bundle = assembleBundle(inputs({ settings: withPhoto }));
    expect(bundle.kids[0]?.photo).toEqual({ sha256: "a".repeat(64) });
    expect(JSON.stringify(bundle)).not.toContain("photos/maya");
  });

  it("works with no location, weather or kids", () => {
    const bare = Settings.parse({ timezone: "America/New_York" });
    const bundle = assembleBundle(inputs({ settings: bare, weather: null }));
    expect(bundle).toMatchObject({
      location: null,
      weather: null,
      kids: [],
      familyNotes: [],
      sleep: null,
    });
  });

  it("carries at most MAX_SLIDES slides and nothing but hash and kind", () => {
    const slide = (i: number) => ({
      sha256: i.toString(16).padStart(64, "0"),
      kind: "photo" as const,
      key: "private/storage/key",
    });
    const bundle = assembleBundle(
      inputs({ slides: Array.from({ length: MAX_SLIDES + 5 }, (_, i) => slide(i)) }),
    );
    expect(bundle.slides).toHaveLength(MAX_SLIDES);
    expect(bundle.slides[0]).toEqual({ sha256: "0".repeat(64), kind: "photo" });
    expect(assembleBundle(inputs()).slides).toEqual([]);
  });

  it("passes the sleep window to the frame", () => {
    const sleepy = Settings.parse({ ...settings, sleep: { start: "20:00", end: "06:00" } });
    expect(assembleBundle(inputs({ settings: sleepy })).sleep).toEqual({
      start: "20:00",
      end: "06:00",
    });
  });
});

describe("chores across the days", () => {
  const chores = [
    Chore.parse({ kidId: "maya", id: "teeth", title: "Brush teeth", sticker: "teeth" }),
    Chore.parse({
      kidId: "maya",
      id: "bed",
      title: "Make your bed",
      sticker: "bed",
      days: [0, 6],
    }),
    Chore.parse({
      kidId: "theo",
      id: "toys",
      title: "Tidy up",
      sticker: "toys",
      period: "evening",
    }),
  ];
  // Wednesday 2026-11-18.
  const bundle = assembleBundle(
    inputs({
      now: new Date("2026-11-18T12:00:00Z"),
      chores,
      completed: new Set(["theo/toys"]),
      history: new Map([
        ["2026-11-16", new Set(["maya/teeth", "theo/toys"])],
        ["2026-11-10", new Set(["maya/teeth"])],
      ]),
    }),
  );
  const on = (date: string) => bundle.days.find((d) => d.date === date)?.chores;

  it("gives every day each kid's chores, done as checked off", () => {
    expect(on("2026-11-16")).toEqual([
      { kidId: "maya", chores: [expect.objectContaining({ id: "teeth", done: true })] },
      { kidId: "theo", chores: [expect.objectContaining({ id: "toys", done: true })] },
    ]);
    // Tuesday: nothing checked off.
    expect(on("2026-11-17")?.flatMap((d) => d.chores.map((c) => c.done))).toEqual([false, false]);
    // Today comes from today's check-offs, the same as the kids' own lists.
    expect(on("2026-11-18")?.find((d) => d.kidId === "theo")?.chores[0]?.done).toBe(true);
    expect(bundle.kids.find((k) => k.id === "theo")?.chores[0]?.done).toBe(true);
    // Last week counts too.
    expect(on("2026-11-10")?.[0]?.chores[0]?.done).toBe(true);
  });

  it("lists weekday chores on their days and never marks days ahead done", () => {
    const saturday = on("2026-11-21");
    expect(saturday?.[0]?.chores.map((c) => c.id)).toEqual(["teeth", "bed"]);
    expect(saturday?.flatMap((d) => d.chores).some((c) => c.done)).toBe(false);
    expect(bundle.week.every((d) => d.chores.length === 2)).toBe(true);
  });

  it("leaves out kids with no chores that day", () => {
    const solo = assembleBundle(inputs({ chores: [chores[1] as Chore] }));
    expect(solo.days.find((d) => d.date === "2026-11-16")?.chores).toEqual([]);
    expect(solo.days.find((d) => d.date === "2026-11-21")?.chores.map((d) => d.kidId)).toEqual([
      "maya",
    ]);
  });

  it("opens check-offs from last week's Monday", () => {
    expect(checkOffFrom("2026-11-18")).toBe("2026-11-09");
    expect(checkOffFrom("2026-11-16")).toBe("2026-11-09");
    expect(checkOffFrom("2026-11-22")).toBe("2026-11-09");
    expect(checkOffFrom("2026-11-23")).toBe("2026-11-16");
  });
});

describe("choresFor", () => {
  const chores = [
    Chore.parse({
      id: "fish",
      kidId: "maya",
      title: "Feed the fish",
      sticker: "fish",
      period: "afterSchool",
    }),
    Chore.parse({ id: "teeth", kidId: "maya", title: "Brush teeth", sticker: "teeth", order: 2 }),
    Chore.parse({ id: "bed", kidId: "maya", title: "Make your bed", sticker: "bed", order: 1 }),
    Chore.parse({ id: "bag", kidId: "maya", title: "Pack backpack", sticker: "bag", order: 1 }),
    Chore.parse({ id: "plants", kidId: "maya", title: "Water plants", days: [0, 3] }),
    Chore.parse({ id: "toys", kidId: "theo", title: "Put toys away" }),
  ];

  it("orders by period, then order, then title, and marks completions", () => {
    const result = choresFor("maya", "2026-11-16", chores, new Set([completionKey("maya", "bed")]));
    expect(result.map((c) => [c.id, c.done])).toEqual([
      ["bed", true],
      ["bag", false],
      ["teeth", false],
      ["fish", false],
    ]);
  });

  it("includes weekday-limited chores only on their days", () => {
    expect(choresFor("maya", "2026-11-18", chores, new Set()).map((c) => c.id)).toContain("plants");
    expect(choresFor("maya", "2026-11-16", chores, new Set()).map((c) => c.id)).not.toContain(
      "plants",
    );
  });
});
