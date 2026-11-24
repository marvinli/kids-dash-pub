import { describe, expect, it } from "vitest";
import { FrameChoreInput, FrameIncidentInput, MAX_INCIDENT_LOG, SettingsInput } from "./contract";

describe("SettingsInput", () => {
  it("rejects duplicate kid ids and does not accept photos", () => {
    const kid = { id: "maya", name: "Maya", color: "pink" };
    expect(SettingsInput.safeParse({ timezone: "UTC", kids: [kid, kid] }).success).toBe(false);
    const parsed = SettingsInput.parse({
      timezone: "UTC",
      kids: [{ ...kid, photo: { key: "k", sha256: "a".repeat(64), contentType: "image/png" } }],
    });
    expect(parsed.kids[0]).not.toHaveProperty("photo");
  });
});

describe("FrameChoreInput", () => {
  it("defaults to every day with a star, and rejects repeated days", () => {
    expect(
      FrameChoreInput.parse({ kidId: "maya", title: " Feed fish ", period: "evening" }),
    ).toEqual({ kidId: "maya", title: "Feed fish", period: "evening", days: [], sticker: "star" });
    const base = { kidId: "maya", title: "Bed", period: "morning" };
    expect(FrameChoreInput.safeParse({ ...base, days: [0, 6] }).success).toBe(true);
    expect(FrameChoreInput.safeParse({ ...base, days: [6, 6] }).success).toBe(false);
    expect(FrameChoreInput.safeParse({ ...base, days: [7] }).success).toBe(false);
    expect(FrameChoreInput.safeParse({ ...base, period: "night" }).success).toBe(false);
  });
});

describe("FrameIncidentInput", () => {
  const base = {
    since: "2026-11-17T14:56:00Z",
    until: "2026-11-17T15:52:30.520Z",
    wifi: "no-networks",
    asleep: false,
    reboot: "other",
    appVersion: 64,
  } as const;

  it("accepts a report and defaults the log", () => {
    expect(FrameIncidentInput.parse(base).log).toBeNull();
  });

  it("rejects an outage that ends before it starts, odd states and oversized logs", () => {
    expect(FrameIncidentInput.safeParse({ ...base, until: base.since }).success).toBe(true);
    expect(FrameIncidentInput.safeParse({ ...base, until: "2026-11-17T14:00:00Z" }).success).toBe(
      false,
    );
    expect(FrameIncidentInput.safeParse({ ...base, since: "yesterday" }).success).toBe(false);
    expect(FrameIncidentInput.safeParse({ ...base, wifi: "flaky" }).success).toBe(false);
    expect(FrameIncidentInput.safeParse({ ...base, reboot: "kicked" }).success).toBe(false);
    expect(
      FrameIncidentInput.safeParse({ ...base, log: "x".repeat(MAX_INCIDENT_LOG + 1) }).success,
    ).toBe(false);
  });
});
