import { describe, expect, it } from "vitest";
import { JOKES, JOKES_PER_DAY, jokesFor } from "./jokes";

const DAY_MS = 86_400_000;
const dates = (from: string, count: number) =>
  Array.from({ length: count }, (_, i) =>
    new Date(Date.parse(`${from}T12:00:00Z`) + i * DAY_MS).toISOString().slice(0, 10),
  );

describe("jokes", () => {
  it("are plenty, all different, and short enough for big type", () => {
    expect(JOKES.length).toBeGreaterThanOrEqual(150);
    expect(new Set(JOKES.map((j) => j.setup)).size).toBe(JOKES.length);
    for (const j of JOKES) {
      expect(j.setup.length, j.setup).toBeLessThanOrEqual(60);
      expect(j.punchline.length, j.punchline).toBeLessThanOrEqual(60);
    }
  });

  it("gives every day the same few different jokes on every frame", () => {
    expect(jokesFor("2026-11-18")).toEqual(jokesFor("2026-11-18"));
    for (const date of dates("2026-01-01", 400)) {
      const day = jokesFor(date);
      expect(day).toHaveLength(JOKES_PER_DAY);
      expect(new Set(day).size).toBe(JOKES_PER_DAY);
    }
  });

  it("works through the whole list before telling them again", () => {
    // Any 37 days hold 148 tellings, all different.
    for (const from of ["2026-11-18", "2027-03-02", "2030-07-14"]) {
      const told = dates(from, 37).flatMap(jokesFor);
      expect(new Set(told).size).toBe(told.length);
    }
    const ofTheDay = dates("2026-11-18", 60).map((d) => jokesFor(d)[0]);
    for (let i = 1; i < ofTheDay.length; i++) expect(ofTheDay[i]).not.toBe(ofTheDay[i - 1]);
  });
});
