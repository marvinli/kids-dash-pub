import type { Chore } from "@kids-dash/core";
import { describe, expect, it } from "vitest";
import { fakeWorld } from "../../test/fakes";
import { InvalidRequestError, NotConfiguredError, NotFoundError } from "./errors";

const bed: Chore = {
  id: "bed",
  kidId: "maya",
  title: "Bed",
  sticker: "bed",
  period: "morning",
  days: [],
  order: 0,
};

describe("CompletionService", () => {
  it("checks off and un-checks a chore for today", async () => {
    const w = fakeWorld();
    await w.chores.put(bed);
    await w.services.completions.set("maya", "bed", { date: "2026-11-16", done: true });
    expect(await w.completions.listDone("2026-11-16")).toEqual(new Set(["maya/bed"]));
    await w.services.completions.set("maya", "bed", { date: "2026-11-16", done: false });
    expect(await w.completions.listDone("2026-11-16")).toEqual(new Set());
  });

  it("accepts missed days back to last week's Monday, but nothing older or ahead", async () => {
    const w = fakeWorld();
    await w.chores.put(bed);
    // Today is Monday 2026-11-16: last week's Monday is the 9th.
    for (const date of ["2026-11-09", "2026-11-15", "2026-11-16"]) {
      await w.services.completions.set("maya", "bed", { date, done: true });
    }
    for (const date of ["2026-11-08", "2026-11-17"]) {
      await expect(
        w.services.completions.set("maya", "bed", { date, done: true }),
      ).rejects.toBeInstanceOf(InvalidRequestError);
    }
  });

  it("refuses unknown chores and unconfigured families", async () => {
    const w = fakeWorld();
    await expect(
      w.services.completions.set("theo", "bed", { date: "2026-11-16", done: true }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      fakeWorld(null).services.completions.set("maya", "bed", { date: "2026-11-16", done: true }),
    ).rejects.toBeInstanceOf(NotConfiguredError);
  });
});
