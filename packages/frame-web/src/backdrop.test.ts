import { describe, expect, it } from "vitest";
import {
  backdropFor,
  easter,
  FUN_SCENES,
  HANUKKAH_FIRST_NIGHT,
  HOLIDAYS,
  holidayFor,
  LUNAR_NEW_YEAR,
  PASSOVER,
  PURIM,
  ROSH_HASHANAH,
  rotation,
  SEASON_SCENES,
  seasonOf,
  TU_BISHVAT,
  thanksgiving,
} from "./backdrop";
import shipped from "./backdrops.json";

/** The first nine paintings. */
const ORIGINAL = new Set([
  "fall",
  "winter",
  "spring",
  "summer",
  "thanksgiving",
  "hanukkah",
  "halloween",
  "valentines",
  "new-year",
]);
const EVERYTHING = new Set([
  ...Object.values(SEASON_SCENES).flat(),
  ...FUN_SCENES,
  ...HOLIDAYS.flatMap((h) => [h.name, ...(h.also ?? [])]),
]);

const DAY_MS = 86_400_000;
const days = (from: string, count: number) =>
  Array.from({ length: count }, (_, i) =>
    new Date(Date.parse(`${from}T12:00:00Z`) + i * DAY_MS).toISOString().slice(0, 10),
  );

describe("backdropFor", () => {
  it("follows the seasons", () => {
    expect(backdropFor("2026-01-20", ORIGINAL)).toBe("winter");
    expect(backdropFor("2026-03-01", ORIGINAL)).toBe("spring");
    expect(backdropFor("2026-07-04", ORIGINAL)).toBe("summer");
    expect(backdropFor("2026-09-15", ORIGINAL)).toBe("fall");
    expect(backdropFor("2026-11-16", ORIGINAL)).toBe("fall");
    expect(backdropFor("2026-12-20", ORIGINAL)).toBe("winter");
    expect(seasonOf("2026-06-01")).toBe("summer");
  });

  it("shows holidays around their dates", () => {
    expect(thanksgiving(2026)).toBe("2026-11-26");
    expect(thanksgiving(2027)).toBe("2027-11-25");
    expect(backdropFor("2026-11-19", ORIGINAL)).toBe("fall");
    expect(backdropFor("2026-11-20", ORIGINAL)).toBe("thanksgiving");
    expect(backdropFor("2026-11-29", ORIGINAL)).toBe("thanksgiving");
    expect(backdropFor("2026-11-30", ORIGINAL)).toBe("fall");
    expect(backdropFor("2026-12-04", ORIGINAL)).toBe("hanukkah");
    expect(backdropFor("2026-12-12", ORIGINAL)).toBe("hanukkah");
    expect(backdropFor("2026-12-13", ORIGINAL)).toBe("winter");
    // Hanukkah that runs into January.
    expect(backdropFor("2028-01-01", ORIGINAL)).toBe("hanukkah");
    expect(backdropFor("2026-12-31", ORIGINAL)).toBe("new-year");
    expect(backdropFor("2027-01-02", ORIGINAL)).toBe("new-year");
    expect(backdropFor("2027-02-10", ORIGINAL)).toBe("valentines");
    expect(backdropFor("2026-10-31", ORIGINAL)).toBe("halloween");
    expect(backdropFor("2026-10-23", ORIGINAL)).toBe("fall");
  });

  it("shows the newer holidays once their art ships", () => {
    const on = (date: string) => holidayFor(date, EVERYTHING);
    expect(on("2026-09-11")).toBe("rosh-hashanah");
    expect(on("2026-09-13")).toBe("rosh-hashanah");
    expect(on("2026-09-14")).toBeNull();
    expect(on("2026-09-25")).toBe("sukkot");
    expect(on("2026-10-04")).toBe("sukkot");
    expect(on("2026-10-05")).toBeNull();
    expect(on("2027-04-21")).toBe("passover");
    expect(on("2027-04-29")).toBe("passover");
    expect(on("2027-03-23")).toBe("purim");
    expect(on("2027-01-23")).toBe("tu-bishvat");
    expect(on("2027-02-06")).toBe("lunar-new-year");
    expect(on("2027-02-02")).toBe("groundhog-day");
    expect(on("2027-03-17")).toBe("st-patricks");
    expect(on("2027-07-04")).toBe("fourth-of-july");
    expect(on("2027-07-20")).toBe("moon-base");
    expect(on("2027-09-19")).toBe("pirate-cove");
    // A holiday's paintings take turns.
    const hanukkah = days("2026-12-04", 9).map(on);
    expect(new Set(hanukkah)).toEqual(new Set(["hanukkah", "hanukkah-lights"]));
    for (let i = 1; i < hanukkah.length; i++) expect(hanukkah[i]).not.toBe(hanukkah[i - 1]);
    // Overlapping holidays take turns a day at a time.
    expect(easter(2026)).toBe("2026-04-05");
    expect(easter(2027)).toBe("2027-03-28");
    expect(easter(2028)).toBe("2028-04-16");
    expect(on("2027-03-28")).toBe("easter");
    expect(on("2026-12-24")).toBe("christmas");
    // Christmas 2027 falls in Hanukkah: its paintings take turns, never twice running.
    const overlap = ["2027-12-23", "2027-12-24", "2027-12-25", "2027-12-26"].map(on);
    expect(overlap[0]).toBe("christmas");
    expect(overlap[1]).not.toBe("christmas");
    expect(overlap.slice(1, 3)).toContain("christmas");
    for (const pick of overlap)
      expect(["hanukkah", "hanukkah-lights", "christmas"]).toContain(pick);
    for (let i = 1; i < overlap.length; i++) expect(overlap[i]).not.toBe(overlap[i - 1]);
    expect(new Set(["2028-04-15", "2028-04-16"].map(on))).toEqual(new Set(["passover", "easter"]));
    const thanksgivukkah = days("2032-11-27", 3).map(on);
    expect(thanksgivukkah).toContain("thanksgiving");
    expect(thanksgivukkah.some((p) => p?.startsWith("hanukkah"))).toBe(true);
    for (let i = 1; i < 3; i++) expect(thanksgivukkah[i]).not.toBe(thanksgivukkah[i - 1]);
    // Not yet painted: the season shows instead.
    expect(holidayFor("2027-03-17", ORIGINAL)).toBeNull();
    expect(backdropFor("2027-03-17", ORIGINAL)).toBe("spring");
  });

  it("rotates daily, alternating the season's paintings with the fun scenes", () => {
    const span = days("2027-06-01", 92).filter((d) => !holidayFor(d, EVERYTHING));
    const picks = span.map((d) => backdropFor(d, EVERYTHING));
    for (let i = 1; i < picks.length; i++) expect(picks[i]).not.toBe(picks[i - 1]);
    const summer = picks.filter((p) => SEASON_SCENES.summer.includes(p));
    const fun = picks.filter((p) => FUN_SCENES.includes(p));
    expect(summer.length + fun.length).toBe(picks.length);
    expect(Math.abs(summer.length - fun.length)).toBeLessThanOrEqual(4);
    expect(new Set(summer)).toEqual(new Set(SEASON_SCENES.summer));
    expect(new Set(fun).size).toBe(FUN_SCENES.length);
  });

  it("never shows the same painting two days running, even with only one list shipped", () => {
    const winter = new Set(["winter", "winter-skating", "winter-village"]);
    const picks = days("2027-01-05", 30).map((d) => backdropFor(d, winter));
    for (let i = 1; i < picks.length; i++) expect(picks[i]).not.toBe(picks[i - 1]);
    const space = new Set(["outer-space", "deep-sea"]);
    const fun = days("2027-01-05", 10).map((d) => backdropFor(d, space));
    for (let i = 1; i < fun.length; i++) expect(fun[i]).not.toBe(fun[i - 1]);
  });

  it("only picks paintings that have shipped", () => {
    const some = new Set(["winter", "outer-space"]);
    for (const d of days("2027-01-05", 20)) expect(some.has(backdropFor(d, some))).toBe(true);
    // Nothing shipped at all: the season's name (the page falls back to paper).
    expect(backdropFor("2027-01-05", new Set())).toBe("winter");
  });
});

describe("rotation", () => {
  it("shows every item once per cycle and never repeats across a cycle boundary", () => {
    const list = ["a", "b", "c", "d", "e"];
    const picks = Array.from({ length: 50 }, (_, k) => rotation(list, k, 1));
    for (let c = 0; c < 10; c++) expect(new Set(picks.slice(c * 5, c * 5 + 5)).size).toBe(5);
    for (let i = 1; i < picks.length; i++) expect(picks[i]).not.toBe(picks[i - 1]);
  });
});

describe("the art manifest", () => {
  it("lists only scenes the calendar knows, each with day, dusk and night", () => {
    for (const [name, tones] of Object.entries(shipped)) {
      expect(EVERYTHING.has(name), name).toBe(true);
      expect(Object.keys(tones).sort()).toEqual(["day", "dusk", "night"]);
    }
  });
});

describe("lunisolar tables", () => {
  const hebrew = new Intl.DateTimeFormat("en-u-ca-hebrew", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
  });
  const hebrewDay = (iso: string, shift = 0) => {
    const parts = hebrew.formatToParts(new Date(Date.parse(`${iso}T12:00:00Z`) + shift * DAY_MS));
    return `${parts.find((p) => p.type === "day")?.value} ${parts.find((p) => p.type === "month")?.value}`;
  };

  it("match the Hebrew calendar", () => {
    for (const d of Object.values(ROSH_HASHANAH)) expect(hebrewDay(d)).toBe("1 Tishri");
    for (const d of Object.values(TU_BISHVAT)) expect(hebrewDay(d)).toBe("15 Shevat");
    for (const d of Object.values(PASSOVER)) expect(hebrewDay(d)).toBe("15 Nisan");
    for (const d of Object.values(PURIM)) expect(hebrewDay(d)).toMatch(/^14 Adar( II)?$/);
    // The first candle is lit the evening before 25 Kislev.
    for (const d of Object.values(HANUKKAH_FIRST_NIGHT)) expect(hebrewDay(d, 1)).toBe("25 Kislev");
  });

  it("match the Chinese calendar", () => {
    const chinese = new Intl.DateTimeFormat("en-u-ca-chinese", {
      timeZone: "UTC",
      day: "numeric",
      month: "numeric",
    });
    for (const d of Object.values(LUNAR_NEW_YEAR)) {
      const parts = chinese.formatToParts(new Date(`${d}T12:00:00Z`));
      expect(parts.find((p) => p.type === "month")?.value).toBe("1");
      expect(parts.find((p) => p.type === "day")?.value).toBe("1");
    }
  });
});
