import { describe, expect, it } from "vitest";
import { backdropFiles, backdropImage, headerInk, skyBlend } from "./sky";

const at = (now: string) => skyBlend(now, "06:40", "16:40");

describe("skyBlend", () => {
  it("is plain night, day or dusk away from the fades", () => {
    expect(at("00:00")).toEqual({ from: "night", to: "night", amount: 0 });
    expect(at("05:30")).toEqual({ from: "night", to: "night", amount: 0 });
    expect(at("06:40")).toEqual({ from: "dusk", to: "dusk", amount: 0 });
    expect(at("12:00")).toEqual({ from: "day", to: "day", amount: 0 });
    expect(at("16:35")).toEqual({ from: "dusk", to: "dusk", amount: 0 });
    expect(at("17:25")).toEqual({ from: "night", to: "night", amount: 0 });
    expect(at("23:59")).toEqual({ from: "night", to: "night", amount: 0 });
  });

  it("crossfades in a few steps: night to dawn to day, day to dusk to night", () => {
    // Night to dawn runs 05:55–06:30 (35 minutes, six steps).
    expect(at("05:55")).toEqual({ from: "night", to: "night", amount: 0 });
    expect(at("06:01")).toEqual({ from: "night", to: "dusk", amount: 1 / 6 });
    expect(at("06:29")).toEqual({ from: "night", to: "dusk", amount: 5 / 6 });
    expect(at("07:10")).toEqual({ from: "dusk", to: "day", amount: 3 / 6 });
    expect(at("16:13")).toEqual({ from: "day", to: "dusk", amount: 3 / 6 });
    expect(at("17:08")).toEqual({ from: "dusk", to: "night", amount: 3 / 6 });
  });

  it("falls back to typical sun times when they are missing or unusable", () => {
    const typical = (now: string) => skyBlend(now, null, null);
    expect(typical("12:00").from).toBe("day");
    expect(typical("17:45").from).toBe("dusk");
    expect(typical("19:00").from).toBe("night");
    // Midnight sun / polar night would make the fades overlap or wrap.
    expect(skyBlend("17:45", "00:10", "23:55").from).toBe("dusk");
    expect(skyBlend("17:45", "11:50", "12:10").from).toBe("dusk");
  });
});

describe("backdropFiles", () => {
  it("names the six files a painting needs", () => {
    expect(backdropFiles("fall")).toEqual([
      "bg-fall.webp",
      "bg-fall-blur.webp",
      "bg-fall-dusk.webp",
      "bg-fall-dusk-blur.webp",
      "bg-fall-night.webp",
      "bg-fall-night-blur.webp",
    ]);
  });
});

describe("backdropImage", () => {
  it("names the painting, or cross-fades two of them", () => {
    const day = { from: "day", to: "day", amount: 0 } as const;
    expect(backdropImage("winter", day)).toBe('url("art/bg-winter.webp")');
    expect(backdropImage("winter", day, true)).toBe('url("art/bg-winter-blur.webp")');
    expect(backdropImage("new-year", { from: "dusk", to: "night", amount: 0.5 }, true)).toBe(
      '-webkit-cross-fade(url("art/bg-new-year-dusk-blur.webp"), url("art/bg-new-year-night-blur.webp"), 50%)',
    );
  });
});

describe("headerInk", () => {
  const farm = { day: 0.84, dusk: 0.39, night: 0.05 };
  const still = (light: "day" | "dusk" | "night") => ({ from: light, to: light, amount: 0 });

  it("uses dark ink on bright paintings and light ink on dark ones", () => {
    expect(headerInk(farm, still("day"))).toBe("dark");
    expect(headerInk(farm, still("dusk"))).toBe("dark");
    expect(headerInk(farm, still("night"))).toBe("light");
  });

  it("goes by the painting, not the clock: a dark scene is light-on-dark at noon", () => {
    expect(headerInk({ day: 0.12, dusk: 0.08, night: 0.03 }, still("day"))).toBe("light");
  });

  it("switches partway through a crossfade, where the blend gets dark enough", () => {
    const fade = (amount: number) => headerInk(farm, { from: "dusk", to: "night", amount });
    expect(fade(1 / 6)).toBe("dark");
    expect(fade(5 / 6)).toBe("light");
  });
});
