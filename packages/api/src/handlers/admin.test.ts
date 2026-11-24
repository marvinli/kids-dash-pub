import { describe, expect, it } from "vitest";
import { type EventOptions, httpEvent } from "../../test/events";
import { fakeWorld } from "../../test/fakes";
import { type AdminEvent, adminRoutes, createAdminHandler } from "./admin";
import { ADMIN_ROUTES } from "./routes";

function setup() {
  const w = fakeWorld();
  const handle = createAdminHandler(() => w.services);
  const call = async (routeKey: string, options: EventOptions = {}) => {
    const result = await handle(httpEvent<AdminEvent>(routeKey, options));
    return {
      status: result.statusCode,
      body: result.body ? JSON.parse(String(result.body)) : undefined,
    };
  };
  return { w, call };
}

describe("admin API", () => {
  it("implements exactly the declared routes", () => {
    expect(Object.keys(adminRoutes(fakeWorld().services)).sort()).toEqual([...ADMIN_ROUTES].sort());
  });

  it("reads and replaces settings", async () => {
    const { call } = setup();
    expect((await call("GET /admin/settings")).body.settings.kids).toHaveLength(2);
    const put = await call("PUT /admin/settings", {
      body: { timezone: "America/Chicago", kids: [{ id: "maya", name: "Maya", color: "pink" }] },
    });
    expect(put).toMatchObject({ status: 200, body: { settings: { timezone: "America/Chicago" } } });
    expect((await call("PUT /admin/settings", { body: { timezone: "Nowhere/Land" } })).status).toBe(
      400,
    );
    expect((await call("PUT /admin/settings", { rawBody: "{not json" })).status).toBe(400);
  });

  it("manages chores", async () => {
    const { call } = setup();
    const path = { pathParameters: { kidId: "maya", choreId: "bed" } };
    expect(
      (
        await call("PUT /admin/chores/{kidId}/{choreId}", {
          ...path,
          body: { title: "Make bed", sticker: "bed" },
        })
      ).body,
    ).toMatchObject({ chore: { id: "bed", kidId: "maya", period: "morning" } });
    expect(
      (await call("GET /admin/chores", { queryStringParameters: { kidId: "maya" } })).body.chores,
    ).toHaveLength(1);
    expect((await call("GET /admin/chores")).body.chores).toHaveLength(1);
    expect((await call("DELETE /admin/chores/{kidId}/{choreId}", path)).status).toBe(204);
    expect((await call("DELETE /admin/chores/{kidId}/{choreId}", path)).status).toBe(404);
  });

  it("manages notes", async () => {
    const { call } = setup();
    const path = { pathParameters: { date: "2026-11-16", noteId: "book" } };
    const put = await call("PUT /admin/notes/{date}/{noteId}", {
      ...path,
      body: { owner: { kind: "kid", kidId: "maya" }, text: "Library book" },
    });
    expect(put.status).toBe(200);
    const list = await call("GET /admin/notes", {
      queryStringParameters: { from: "2026-11-16", to: "2026-11-16" },
    });
    expect(list.body.notes).toHaveLength(1);
    expect(
      (await call("GET /admin/notes", { queryStringParameters: { from: "x", to: "y" } })).status,
    ).toBe(400);
    expect((await call("DELETE /admin/notes/{date}/{noteId}", path)).status).toBe(204);
  });

  it("lists events but has no way to write them (Google Calendar only)", async () => {
    const { call } = setup();
    const list = await call("GET /admin/events", {
      queryStringParameters: { from: "2026-11-16", to: "2026-11-22" },
    });
    expect(list.body.events).toEqual([]);
    expect(ADMIN_ROUTES).not.toContain("PUT /admin/events/{eventId}");
    expect(ADMIN_ROUTES).not.toContain("DELETE /admin/events/{eventId}");
  });

  it("uploads and removes kid photos", async () => {
    const { call } = setup();
    const path = { pathParameters: { kidId: "theo" } };
    const dataBase64 = Buffer.from([0xff, 0xd8, 0xff, 0xdb]).toString("base64");
    const put = await call("PUT /admin/kids/{kidId}/photo", {
      ...path,
      body: { contentType: "image/jpeg", dataBase64 },
    });
    expect(put.body.photo.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await call("DELETE /admin/kids/{kidId}/photo", path)).status).toBe(204);
  });

  it("registers, lists and revokes devices", async () => {
    const { call } = setup();
    const created = await call("POST /admin/devices", { body: { name: "Kitchen frame" } });
    expect(created.status).toBe(201);
    expect(created.body.token).toContain(".");
    expect((await call("GET /admin/devices")).body.devices).toHaveLength(1);
    const revoked = await call("DELETE /admin/devices/{deviceId}", {
      pathParameters: { deviceId: created.body.device.id },
    });
    expect(revoked.body.device.revokedAt).not.toBeNull();
  });

  it("sets a frame's own settings and previews its bundle", async () => {
    const { call } = setup();
    const created = await call("POST /admin/devices", { body: { name: "Bedroom" } });
    const deviceId = created.body.device.id;
    const put = await call("PUT /admin/devices/{deviceId}/settings", {
      pathParameters: { deviceId },
      body: { slideshowFolderId: "1AbCdEfGhIjKlMnOp" },
    });
    expect(put).toMatchObject({
      status: 200,
      body: { device: { id: deviceId, settings: { slideshowFolderId: "1AbCdEfGhIjKlMnOp" } } },
    });
    const bad = await call("PUT /admin/devices/{deviceId}/settings", {
      pathParameters: { deviceId },
      body: { slideshowFolderId: 5 },
    });
    expect(bad.status).toBe(400);
    const missing = await call("PUT /admin/devices/{deviceId}/settings", {
      pathParameters: { deviceId: "f".repeat(16) },
      body: {},
    });
    expect(missing.status).toBe(404);

    const preview = await call("GET /admin/bundle", { queryStringParameters: { deviceId } });
    expect(preview.body.bundle.device).toEqual({
      id: deviceId,
      name: "Bedroom",
      greetingName: null,
    });
  });

  it("lists frames' outage reports and returns one with its log", async () => {
    const { w, call } = setup();
    const created = await call("POST /admin/devices", { body: { name: "Kitchen frame" } });
    const deviceId = created.body.device.id;
    const incident = await w.services.incidents.record(deviceId, {
      since: "2026-11-16T11:00:00Z",
      until: "2026-11-16T12:00:00Z",
      wifi: "no-networks",
      asleep: false,
      reboot: "watchdog",
      appVersion: 67,
      log: "wlan0: link down",
    });

    const list = await call("GET /admin/incidents", {
      queryStringParameters: { deviceId, limit: "5" },
    });
    expect(list.status).toBe(200);
    expect(list.body.incidents).toEqual([
      expect.objectContaining({ id: incident.id, deviceName: "Kitchen frame", logChars: 16 }),
    ]);
    expect(
      (await call("GET /admin/incidents", { queryStringParameters: { limit: "x" } })).status,
    ).toBe(400);

    const one = await call("GET /admin/incidents/{incidentId}", {
      pathParameters: { incidentId: incident.id },
    });
    expect(one.body.incident.log).toBe("wlan0: link down");
    expect(
      (
        await call("GET /admin/incidents/{incidentId}", {
          pathParameters: { incidentId: "f".repeat(16) },
        })
      ).status,
    ).toBe(404);
  });

  it("publishes app releases, newest only", async () => {
    const { w, call } = setup();
    expect((await call("GET /admin/app")).body).toEqual({ release: null });
    const apk = (n: number) => Buffer.from([0x50, 0x4b, 0x03, 0x04, n]).toString("base64");
    const put = await call("PUT /admin/app", {
      body: { versionCode: 2, versionName: "1.2", dataBase64: apk(2) },
    });
    expect(put).toMatchObject({ status: 200, body: { release: { versionCode: 2 } } });
    expect((await call("GET /admin/app")).body.release.versionName).toBe("1.2");
    const stale = await call("PUT /admin/app", {
      body: { versionCode: 2, versionName: "1.2b", dataBase64: apk(3) },
    });
    expect(stale).toMatchObject({ status: 409, body: { error: "conflict" } });
    const notApk = await call("PUT /admin/app", {
      body: { versionCode: 3, versionName: "1.3", dataBase64: "aGVsbG8=" },
    });
    expect(notApk.status).toBe(400);
    expect([...w.photos.objects.keys()]).toEqual([`app/${put.body.release.sha256}.apk`]);
    const upload = await call("POST /admin/app/upload", { body: { sha256: "c".repeat(64) } });
    expect(upload).toMatchObject({
      status: 200,
      body: { contentType: "application/vnd.android.package-archive" },
    });
    expect(upload.body.url).toContain(`app/${"c".repeat(64)}.apk`);
    const art = await call("POST /admin/art/upload", { body: { sha256s: ["e".repeat(64)] } });
    expect(art).toMatchObject({ status: 200, body: { contentType: "image/webp" } });
    expect(art.body.uploads[0].url).toContain(`art/${"e".repeat(64)}.webp`);
  });

  it("syncs, previews the bundle and publishes the signing key", async () => {
    const { call } = setup();
    expect((await call("POST /admin/sync")).body).toEqual({
      calendar: "ok",
      events: 0,
      weather: "ok",
      trivia: "ok",
      history: "ok",
      place: "ok",
      slides: "skipped",
      slideCount: 0,
    });
    expect((await call("GET /admin/bundle")).body.bundle.weather.high).toBe(52);
    const key = await call("GET /admin/signing-key");
    expect(key.body).toMatchObject({
      keyId: "test-key",
      publicKeyPem: expect.stringContaining("BEGIN PUBLIC KEY"),
    });
  });

  it("returns 500 without leaking details on unexpected errors", async () => {
    const { w, call } = setup();
    w.settings.get = async () => {
      throw new Error("table is on fire");
    };
    const result = await call("GET /admin/settings");
    expect(result).toEqual({ status: 500, body: { error: "internal" } });
    expect(w.logger.lines.at(-1)).toMatchObject({ level: "error", message: "unhandled error" });
  });

  it("decodes base64-encoded bodies", async () => {
    const { call } = setup();
    const result = await call("POST /admin/devices", { body: { name: "Frame" }, base64: true });
    expect(result.status).toBe(201);
  });
});
