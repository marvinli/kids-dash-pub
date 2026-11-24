import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { test } from "node:test";

test("calendar provisioning uses the configured timezone and preserves settings", async (t) => {
  const settings = {
    timezone: "Asia/Tokyo",
    location: null,
    kids: [{ id: "alex", name: "Alex", color: "green", photo: null }],
    sleep: { start: "21:00", end: "07:00" },
    slideshowFolderId: "example-folder",
    sharedCalendarIds: [],
  };
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const originalExec = childProcess.execFileSync;
  const originalFetch = globalThis.fetch;
  const originalArgv = process.argv;
  t.after(() => {
    childProcess.execFileSync = originalExec;
    syncBuiltinESMExports();
    globalThis.fetch = originalFetch;
    process.argv = originalArgv;
  });
  let written;
  childProcess.execFileSync = (command, args) => {
    if (command === "aws" && args[0] === "cloudformation") return "example-secret";
    if (command === "aws" && args[0] === "secretsmanager") {
      return JSON.stringify({
        client_email: "sync@example.iam.gserviceaccount.com",
        private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
      });
    }
    if (command === "node" && args[2] === "GET") return JSON.stringify({ settings });
    if (command === "node" && args[2] === "PUT") {
      written = JSON.parse(args[4]);
      return "{}";
    }
    if (command === "node" && args[2] === "POST") return "{}";
    assert.fail(`Unexpected subprocess: ${command}`);
  };
  syncBuiltinESMExports();
  const created = [];
  globalThis.fetch = async (url, options) => {
    if (url === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "test-token" });
    }
    if (options.method === "GET") return Response.json({ items: [] });
    if (url.endsWith("/calendars")) {
      created.push(JSON.parse(options.body));
      return Response.json({ id: `calendar-${created.length}` });
    }
    assert.match(url, /\/acl\?sendNotifications=true$/);
    return Response.json({});
  };
  process.argv = ["node", "setup-calendars.mjs", "--share-with", "parent@example.com"];
  await import("./setup-calendars.mjs");
  assert.equal(created.length, 2);
  assert.ok(created.every((calendar) => calendar.timeZone === "Asia/Tokyo"));
  assert.deepEqual(written, {
    ...settings,
    kids: [{ id: "alex", name: "Alex", color: "green", calendarId: "calendar-1" }],
    sharedCalendarIds: ["calendar-2"],
  });
});
