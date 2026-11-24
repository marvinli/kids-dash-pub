import assert from "node:assert/strict";
import { test } from "node:test";
import { calendarDescription, calendarSettings } from "./calendar-settings.mjs";

test("calendar setup preserves family configuration when replacing calendar IDs", () => {
  const settings = {
    timezone: "Europe/Paris",
    location: { name: "Paris", latitude: 48.86, longitude: 2.35 },
    sleep: { start: "21:00", end: "07:00" },
    slideshowFolderId: "example-folder",
    kids: [{ id: "alex", name: "Alex", color: "green", photo: { key: "photo" } }],
    sharedCalendarIds: ["old-shared"],
  };
  const next = calendarSettings(settings, [
    { kid: settings.kids[0], id: "new-kid-calendar" },
    { kid: null, id: "new-shared" },
  ]);
  assert.deepEqual(next, {
    ...settings,
    kids: [{ id: "alex", name: "Alex", color: "green", calendarId: "new-kid-calendar" }],
    sharedCalendarIds: ["new-shared"],
  });
  assert.deepEqual(settings.sharedCalendarIds, ["old-shared"]);
  assert.ok(settings.kids[0].photo);
});

test("calendar descriptions do not assume a frame location", () => {
  assert.match(calendarDescription({ name: "Alex" }), /What Alex sees on the dashboard/);
  assert.equal(calendarDescription(null), "Shows in every kid's column on the dashboard.");
});
