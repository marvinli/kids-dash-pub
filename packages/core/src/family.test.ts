import { describe, expect, it } from "vitest";
import { Settings, SleepWindow } from "./family";

describe("SleepWindow", () => {
  it("accepts overnight and same-day windows but not empty ones", () => {
    expect(SleepWindow.safeParse({ start: "20:00", end: "06:00" }).success).toBe(true);
    expect(SleepWindow.safeParse({ start: "13:00", end: "14:30" }).success).toBe(true);
    expect(SleepWindow.safeParse({ start: "20:00", end: "20:00" }).success).toBe(false);
    expect(SleepWindow.safeParse({ start: "8pm", end: "06:00" }).success).toBe(false);
  });

  it("defaults to no sleep in settings", () => {
    expect(Settings.parse({ timezone: "UTC" }).sleep).toBeNull();
  });
});

describe("slideshowFolderId", () => {
  it("accepts Drive folder ids and defaults to none", () => {
    expect(Settings.parse({ timezone: "UTC" }).slideshowFolderId).toBeNull();
    const id = "1AbC-d_EfGhIjKlMnOpQrStUv";
    expect(Settings.parse({ timezone: "UTC", slideshowFolderId: id }).slideshowFolderId).toBe(id);
    expect(
      Settings.safeParse({ timezone: "UTC", slideshowFolderId: "../etc/passwd" }).success,
    ).toBe(false);
  });
});
