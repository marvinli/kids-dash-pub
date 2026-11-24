import { describe, expect, it, vi } from "vitest";
import { OpenMeteoReader } from "./open-meteo";

const HOME = { name: "Home", latitude: 40.71, longitude: -74.01 };

const daily = (overrides: Record<string, unknown[]> = {}) => ({
  daily: {
    time: ["2026-11-16"],
    temperature_2m_max: [52.4],
    temperature_2m_min: [40.6],
    precipitation_probability_max: [78],
    weather_code: [61],
    ...overrides,
  },
});

const respond = (body: unknown, status = 200) =>
  vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify(body), { status }));

describe("OpenMeteoReader", () => {
  it("asks for one day in °F in the family's zone and rounds", async () => {
    const fetchFn = respond(daily());
    const weather = await new OpenMeteoReader(fetchFn).forecast(
      HOME,
      "America/New_York",
      "2026-11-16",
    );
    expect(weather).toEqual({
      high: 52,
      low: 41,
      rainChance: 78,
      code: 61,
      current: null,
      sunrise: null,
      sunset: null,
    });
    const now = await new OpenMeteoReader(
      respond({ ...daily(), current: { temperature_2m: 47.6 } }),
    ).forecast(HOME, "America/New_York", "2026-11-16");
    expect(now.current).toBe(48);
    const url = new URL(String(fetchFn.mock.calls[0]?.[0]));
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      latitude: "40.71",
      longitude: "-74.01",
      temperature_unit: "fahrenheit",
      timezone: "America/New_York",
      start_date: "2026-11-16",
      current: "temperature_2m",
      end_date: "2026-11-16",
    });
  });

  it("keeps the local sunrise and sunset clock times", async () => {
    const fetchFn = respond(daily({ sunrise: ["2026-11-16T06:41"], sunset: ["2026-11-16T16:37"] }));
    const weather = await new OpenMeteoReader(fetchFn).forecast(
      HOME,
      "America/New_York",
      "2026-11-16",
    );
    expect(weather).toMatchObject({ sunrise: "06:41", sunset: "16:37" });
    const url = new URL(String(fetchFn.mock.calls[0]?.[0]));
    expect(url.searchParams.get("daily")).toContain("sunrise,sunset");
    const polar = await new OpenMeteoReader(
      respond(daily({ sunrise: [null], sunset: ["bogus"] })),
    ).forecast(HOME, "UTC", "2026-11-16");
    expect(polar).toMatchObject({ sunrise: null, sunset: null });
  });

  it("treats a missing rain probability as zero", async () => {
    const weather = await new OpenMeteoReader(
      respond(daily({ precipitation_probability_max: [null] })),
    ).forecast(HOME, "UTC", "2026-11-16");
    expect(weather.rainChance).toBe(0);
  });

  it("fails on HTTP errors and missing days", async () => {
    await expect(
      new OpenMeteoReader(respond({}, 500)).forecast(HOME, "UTC", "2026-11-16"),
    ).rejects.toThrow(/500/);
    await expect(
      new OpenMeteoReader(respond(daily())).forecast(HOME, "UTC", "2026-11-17"),
    ).rejects.toThrow(/no forecast/);
    await expect(
      new OpenMeteoReader(respond(daily({ temperature_2m_max: [null] }))).forecast(
        HOME,
        "UTC",
        "2026-11-16",
      ),
    ).rejects.toThrow(/no forecast/);
  });
});
