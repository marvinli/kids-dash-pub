import { describe, expect, it } from "vitest";
import { dressFor, skyFromCode, wearTip } from "./weather";

const day = (high: number, low: number, rainChance = 0, code = 0) => ({
  high,
  low,
  rainChance,
  code,
  current: null,
  sunrise: null,
  sunset: null,
});

describe("skyFromCode", () => {
  it.each([
    [0, "sunny"],
    [1, "partly"],
    [2, "partly"],
    [3, "cloudy"],
    [45, "foggy"],
    [61, "rainy"],
    [81, "rainy"],
    [73, "snowy"],
    [86, "snowy"],
    [95, "stormy"],
  ])("code %i is %s", (code, sky) => {
    expect(skyFromCode(code)).toBe(sky);
  });
});

describe("wearTip", () => {
  it("puts on rain gear when rain is likely, with a layer when it is cold", () => {
    expect(wearTip(day(52, 41, 80, 3))).toMatchObject({
      bear: "rain",
      tip: "Raincoat + rain boots",
      detail: "Add a cozy layer underneath",
      skyLabel: "Cloudy",
    });
    expect(wearTip(day(70, 60, 20, 63))).toMatchObject({
      bear: "rain",
      detail: "Keep an umbrella handy",
    });
  });

  it("dresses for snow over everything else", () => {
    expect(wearTip(day(28, 15, 90, 73))).toMatchObject({ bear: "snow", sky: "snowy" });
  });

  it("scales with temperature when it is dry", () => {
    expect(wearTip(day(34, 22)).tip).toBe("Puffy coat, hat & mittens");
    expect(wearTip(day(66, 52))).toMatchObject({ bear: "cool", tip: "Long sleeves + a jacket" });
    expect(wearTip(day(76, 66)).tip).toBe("T-shirt + a light hoodie");
    expect(wearTip(day(86, 70))).toMatchObject({
      tip: "T-shirt & shorts!",
      detail: "Sunscreen and a water bottle",
    });
  });

  it("dresses for the cold morning, not the warm afternoon", () => {
    // 2026-11-18: 40 at breakfast, 64 by the afternoon. Coat weather.
    expect(dressFor(day(64, 38))).toBeCloseTo(46.7, 1);
    expect(wearTip(day(64, 38))).toMatchObject({
      bear: "cold",
      tip: "Puffy coat, hat & mittens",
      detail: "Chilly early, warmer later",
    });
    expect(wearTip(day(58, 44)).tip).toBe("Puffy coat, hat & mittens");
    expect(wearTip(day(70, 55)).tip).toBe("Long sleeves + a jacket");
  });

  it("warns about a big morning-to-afternoon swing", () => {
    expect(wearTip(day(66, 40)).detail).toBe("Chilly early, warmer later");
    expect(wearTip(day(66, 55)).detail).toBeNull();
  });
});
