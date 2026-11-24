import { describe, expect, it } from "vitest";
import {
  clockFace,
  dayOfMonth,
  greeting,
  joinNames,
  longTime,
  monthDay,
  shortTime,
} from "./format";
import { escapeHtml, html, raw } from "./html";
import { fitToBudget, MORE_CHIP_HEIGHT } from "./render/fit";
import { art, PALETTES, paletteStyle } from "./theme";

describe("html", () => {
  it("escapes interpolations, joins arrays and passes raw through", () => {
    const name = '<img src=x onerror="alert(1)">';
    expect(html`<b>${name}</b>`.__raw).toBe(
      "<b>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</b>",
    );
    expect(html`${["a", raw("<i>b</i>"), 3]}`.__raw).toBe("a<i>b</i>3");
    expect(html`${null}${undefined}${false}${true}`.__raw).toBe("true");
    expect(escapeHtml("Tom & 'Jerry'")).toBe("Tom &amp; &#39;Jerry&#39;");
  });
});

describe("format", () => {
  it("shows 12-hour times", () => {
    expect(shortTime("16:30")).toBe("4:30");
    expect(shortTime("00:05")).toBe("12:05");
    expect(shortTime("12:00")).toBe("12:00");
    expect(longTime("09:15")).toBe("9:15 AM");
    expect(longTime("18:00")).toBe("6:00 PM");
  });

  it("reads the clock in the family's zone", () => {
    const face = clockFace(new Date("2026-11-16T12:42:00Z"), "America/New_York");
    expect(face).toEqual({ time: "7:42", period: "AM", date: "Monday, November 16", hour: 7 });
    expect(clockFace(new Date("2026-11-16T23:05:00Z"), "America/New_York").hour).toBe(18);
  });

  it("greets by time of day and joins names", () => {
    expect([greeting(7), greeting(13), greeting(19)]).toEqual([
      "Good morning",
      "Good afternoon",
      "Good evening",
    ]);
    expect(joinNames([])).toBe("");
    expect(joinNames(["Maya"])).toBe("Maya");
    expect(joinNames(["Maya", "Theo"])).toBe("Maya & Theo");
    expect(joinNames(["Maya", "Theo", "Sam"])).toBe("Maya, Theo & Sam");
  });

  it("formats dates without timezone drift", () => {
    expect(dayOfMonth("2026-11-06")).toBe("6");
    expect(monthDay("2026-11-16")).toBe("Nov 16");
  });
});

describe("fitToBudget", () => {
  const sized = (...heights: number[]) => heights.map((height, i) => ({ item: i, height }));

  it("keeps everything that fits", () => {
    expect(fitToBudget(sized(100, 100), 212, 12)).toEqual({ shown: [0, 1], hidden: 0 });
  });

  it("reserves room for the more chip when items are left over", () => {
    // 100 + 12 + 100 = 212, but a third item remains, so the chip needs 12 + 44.
    expect(fitToBudget(sized(100, 100, 100), 212 + 12 + MORE_CHIP_HEIGHT - 1, 12)).toEqual({
      shown: [0],
      hidden: 2,
    });
  });

  it("lets the last item use the chip's room", () => {
    expect(fitToBudget(sized(100, 150), 262, 12)).toEqual({ shown: [0, 1], hidden: 0 });
  });

  it("shows nothing when the first item cannot fit", () => {
    expect(fitToBudget(sized(500, 10), 100, 12)).toEqual({ shown: [], hidden: 2 });
  });
});

describe("theme", () => {
  it("exposes kid palettes as CSS variables and maps art", () => {
    expect(paletteStyle("pink")).toBe(
      `--kid-bg:${PALETTES.pink.bg};--kid-ink:${PALETTES.pink.ink};--kid-chip:${PALETTES.pink.chip};--kid-special:${PALETTES.pink.special}`,
    );
    expect(art.sticker("bus")).toBe("art/stk-bus.webp");
    expect(art.chore("fish")).toBe("art/chore-fish.webp");
    expect(art.chore("star")).toBe("art/stk-star.webp");
    expect(art.bear("snow")).toBe("art/polarbear-cold.webp");
    expect(art.bear("party")).toBe("art/polarbear-party.webp");
  });
});
