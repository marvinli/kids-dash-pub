import { z } from "zod";
import { LocalTime } from "./dates";

/** Today's forecast as the bundle carries it (°F, percent). */
export const Weather = z.object({
  high: z.number().int(),
  low: z.number().int(),
  rainChance: z.number().int().min(0).max(100),
  /** WMO weather interpretation code (Open-Meteo `weather_code`). */
  code: z.number().int().min(0).max(99),
  /** Temperature now (at the last sync, every 15 minutes); null when unknown. */
  current: z.number().int().nullable().default(null),
  /** Local sunrise and sunset that day; null when unknown (the frame falls back to typical times). */
  sunrise: LocalTime.nullable().default(null),
  sunset: LocalTime.nullable().default(null),
});
export type Weather = z.infer<typeof Weather>;

export type Sky = "sunny" | "partly" | "cloudy" | "foggy" | "rainy" | "snowy" | "stormy";

/** Which polar bear outfit to draw. `cool` falls back to cold art until it has its own. */
export type BearOutfit = "rain" | "snow" | "cold" | "cool" | "sun";

export interface WearTip {
  sky: Sky;
  skyLabel: string;
  bear: BearOutfit;
  tip: string;
  detail: string | null;
}

const SKY_LABELS: Record<Sky, string> = {
  sunny: "Sunny",
  partly: "Partly cloudy",
  cloudy: "Cloudy",
  foggy: "Foggy",
  rainy: "Rainy",
  snowy: "Snowy",
  stormy: "Stormy",
};

export function skyFromCode(code: number): Sky {
  if (code >= 95) return "stormy";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snowy";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rainy";
  if (code === 45 || code === 48) return "foggy";
  if (code >= 3) return "cloudy";
  if (code >= 1) return "partly";
  return "sunny";
}

/** Rain this likely means rain gear, whatever the sky code says. */
export const RAIN_GEAR_CHANCE = 50;

/**
 * The temperature to dress for. Kids dress for the walk to school, near the
 * day's low, not for the afternoon high: a third of the way from low to high
 * (38 to 64 dresses for 47, coat weather).
 */
export function dressFor(weather: Pick<Weather, "high" | "low">): number {
  return weather.low + (weather.high - weather.low) / 3;
}

/** What to wear, derived from the forecast. Shared by the API and the frame. */
export function wearTip(weather: Weather): WearTip {
  const sky = skyFromCode(weather.code);
  const wet = weather.rainChance >= RAIN_GEAR_CHANCE || sky === "rainy" || sky === "stormy";
  const { high, low } = weather;
  const temp = dressFor(weather);

  let bear: BearOutfit;
  let tip: string;
  if (sky === "snowy") {
    bear = "snow";
    tip = "Snow pants, boots & mittens";
  } else if (wet) {
    bear = "rain";
    tip = "Raincoat + rain boots";
  } else if (temp < 50) {
    bear = "cold";
    tip = "Puffy coat, hat & mittens";
  } else if (temp < 64) {
    bear = "cool";
    tip = "Long sleeves + a jacket";
  } else if (temp < 75) {
    bear = "sun";
    tip = "T-shirt + a light hoodie";
  } else {
    bear = "sun";
    tip = "T-shirt & shorts!";
  }

  let detail: string | null = null;
  if (wet && temp < 55) detail = "Add a cozy layer underneath";
  else if (wet) detail = "Keep an umbrella handy";
  else if (high >= 80) detail = "Sunscreen and a water bottle";
  else if (high - low >= 20) detail = "Chilly early, warmer later";

  return { sky, skyLabel: SKY_LABELS[sky], bear, tip, detail };
}
