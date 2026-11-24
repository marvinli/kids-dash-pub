import type { IsoDate, Location, Weather } from "@kids-dash/core";
import { z } from "zod";
import type { WeatherReader } from "../services/ports";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

const Daily = z.object({
  current: z.object({ temperature_2m: z.number().nullable() }).optional(),
  daily: z.object({
    time: z.array(z.string()),
    temperature_2m_max: z.array(z.number().nullable()),
    temperature_2m_min: z.array(z.number().nullable()),
    precipitation_probability_max: z.array(z.number().nullable()),
    weather_code: z.array(z.number().nullable()),
    // Local ISO date-times ("2026-11-16T06:41"); absent or null near the poles.
    sunrise: z.array(z.string().nullable()).optional(),
    sunset: z.array(z.string().nullable()).optional(),
  }),
});

/** Open-Meteo daily forecast: free, keyless, °F. */
export class OpenMeteoReader implements WeatherReader {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async forecast(location: Location, timeZone: string, date: IsoDate): Promise<Weather> {
    const params = new URLSearchParams({
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      daily:
        "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,sunrise,sunset",
      current: "temperature_2m",
      temperature_unit: "fahrenheit",
      timezone: timeZone,
      start_date: date,
      end_date: date,
    });
    const response = await this.fetchFn(`${FORECAST_URL}?${params}`);
    if (!response.ok) throw new Error(`Open-Meteo answered ${response.status}`);
    const { daily, current } = Daily.parse(await response.json());
    const i = daily.time.indexOf(date);
    const high = daily.temperature_2m_max[i];
    const low = daily.temperature_2m_min[i];
    const code = daily.weather_code[i];
    if (i < 0 || high == null || low == null || code == null) {
      throw new Error(`Open-Meteo has no forecast for ${date}`);
    }
    return {
      high: Math.round(high),
      low: Math.round(low),
      rainChance: Math.round(daily.precipitation_probability_max[i] ?? 0),
      code,
      current: current?.temperature_2m == null ? null : Math.round(current.temperature_2m),
      sunrise: clockTime(daily.sunrise?.[i]),
      sunset: clockTime(daily.sunset?.[i]),
    };
  }
}

/** "2026-11-16T06:41" → "06:41"; anything else → null. */
function clockTime(value: string | null | undefined): string | null {
  const time = value?.match(/T(\d{2}:\d{2})/)?.[1];
  return time ?? null;
}
