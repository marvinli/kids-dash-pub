import { BundleEnvelope, DashboardBundle } from "@kids-dash/core";
import { describe, expect, it } from "vitest";
import { httpEvent } from "../../test/events";
import { deviceRecord, FAMILY, fakeWorld } from "../../test/fakes";
import { createDeviceHandler, type DeviceEvent, deviceRoutes } from "./device";
import { DEVICE_ROUTES } from "./routes";

const JPEG_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64");

function setup(settings?: Parameters<typeof fakeWorld>[0]) {
  const w = settings === undefined ? fakeWorld() : fakeWorld(settings);
  // httpEvent's authorizer context names this device.
  w.devices.items.set("0123456789abcdef", deviceRecord());
  const handle = createDeviceHandler(() => w.services);
  const call = (routeKey: string, options = {}) =>
    handle(httpEvent<DeviceEvent>(routeKey, options));
  return { w, call };
}

describe("device API", () => {
  it("serves a signed bundle with an ETag, then 304 for the same ETag", async () => {
    const { call } = setup();
    const first = await call("GET /v1/bundle");
    expect(first.statusCode).toBe(200);
    expect(BundleEnvelope.parse(JSON.parse(String(first.body))).keyId).toBe("test-key");
    const etag = first.headers?.etag as string;

    const second = await call("GET /v1/bundle", { headers: { "if-none-match": etag } });
    expect(second).toMatchObject({ statusCode: 304, headers: { etag } });
    expect(second.body).toBeUndefined();
  });

  it("answers 409 before the family is set up", async () => {
    const { call } = setup(null);
    expect((await call("GET /v1/bundle")).statusCode).toBe(409);
  });

  it("records chore check-offs", async () => {
    const { w, call } = setup();
    await w.chores.put({
      id: "bed",
      kidId: "maya",
      title: "Bed",
      sticker: "bed",
      period: "morning",
      days: [],
      order: 0,
    });
    const result = await call("PUT /v1/chores/{kidId}/{choreId}", {
      pathParameters: { kidId: "maya", choreId: "bed" },
      body: { date: "2026-11-16", done: true },
    });
    expect(result.statusCode).toBe(204);
    expect(await w.completions.listDone("2026-11-16")).toEqual(new Set(["maya/bed"]));
  });

  it("validates check-off input", async () => {
    const { call } = setup();
    const bad = await call("PUT /v1/chores/{kidId}/{choreId}", {
      pathParameters: { kidId: "Maya!", choreId: "bed" },
      body: { date: "2026-11-16", done: true },
    });
    expect(bad.statusCode).toBe(400);
    const badBody = await call("PUT /v1/chores/{kidId}/{choreId}", {
      pathParameters: { kidId: "maya", choreId: "bed" },
      body: { date: "today", done: "yes" },
    });
    expect(badBody.statusCode).toBe(400);
    expect(JSON.parse(String(badBody.body)).issues).toHaveLength(2);
  });

  it("adds a chore from the frame: 201 with the saved chore, in the next bundle", async () => {
    const { w, call } = setup();
    const result = await call("POST /v1/chores", {
      body: { kidId: "theo", title: "Water plants", period: "afterSchool", sticker: "plants" },
    });
    expect(result.statusCode).toBe(201);
    expect(JSON.parse(String(result.body))).toEqual({
      chore: {
        id: "water-plants",
        kidId: "theo",
        title: "Water plants",
        sticker: "plants",
        period: "afterSchool",
        days: [],
        order: 0,
      },
    });
    expect(w.chores.items.has("theo#water-plants")).toBe(true);

    const bundle = await call("GET /v1/bundle");
    const payload = BundleEnvelope.parse(JSON.parse(String(bundle.body))).payload;
    expect(Buffer.from(payload, "base64url").toString("utf8")).toContain('"water-plants"');
  });

  it("answers 400 for a bad chore and 429 when over the limit", async () => {
    const { w, call } = setup();
    const bad = await call("POST /v1/chores", {
      body: { kidId: "theo", title: "", period: "night" },
    });
    expect(bad.statusCode).toBe(400);
    expect(JSON.parse(String(bad.body)).issues).toHaveLength(2);
    expect(
      (await call("POST /v1/chores", { body: { kidId: "sam", title: "x", period: "morning" } }))
        .statusCode,
    ).toBe(400);

    w.counters.increment = async () => 21;
    const limited = await call("POST /v1/chores", {
      body: { kidId: "theo", title: "x", period: "morning" },
    });
    expect(limited.statusCode).toBe(429);
    expect(w.chores.items.size).toBe(0);
  });

  it("adds an event from the frame: 201 with the id it will have in the bundle", async () => {
    const { w, call } = setup();
    const result = await call("POST /v1/events", {
      body: {
        owner: { kind: "kid", kidId: "maya" },
        title: "Soccer",
        date: "2026-11-18",
        time: "16:30",
      },
    });
    expect(result.statusCode).toBe(201);
    expect(JSON.parse(String(result.body))).toEqual({ event: { id: "g-new1" } });
    expect(w.calendarWriter.inserted[0]).toMatchObject({
      calendarId: "maya@cal",
      event: { description: "kids:\nAdded on the Kitchen frame." },
    });

    const bundle = await call("GET /v1/bundle");
    const payload = BundleEnvelope.parse(JSON.parse(String(bundle.body))).payload;
    expect(Buffer.from(payload, "base64url").toString("utf8")).toContain('"g-new1"');
  });

  it("edits a Google event and answers 200 with its bundle id", async () => {
    const { w, call } = setup();
    w.calendarWriter.seed("maya@cal", {
      id: "abc",
      title: "Soccer",
      description: null,
      start: { date: "2026-11-18", time: "16:00" },
      end: { date: "2026-11-18", time: "17:00" },
      allDay: false,
      seriesId: null,
      durationMinutes: 60,
    });
    const edit = {
      owner: { kind: "kid", kidId: "maya" },
      title: "Soccer at the park",
      date: "2026-11-18",
      from: "2026-11-18",
      time: "16:30",
      description: "Bring water",
    };
    const result = await call("PUT /v1/events/{eventId}", {
      pathParameters: { eventId: "g-abc" },
      body: edit,
    });
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(String(result.body))).toEqual({ event: { id: "g-abc" } });
    expect(w.calendarWriter.updated[0]?.event).toMatchObject({
      title: "Soccer at the park",
      description: "Bring water",
    });

    const missing = await call("PUT /v1/events/{eventId}", {
      pathParameters: { eventId: "g-gone" },
      body: edit,
    });
    expect(missing.statusCode).toBe(404);
    const notGoogle = await call("PUT /v1/events/{eventId}", {
      pathParameters: { eventId: "manual-1" },
      body: edit,
    });
    expect(notGoogle.statusCode).toBe(400);
  });

  it("deletes a Google event (or a whole series) and answers 204", async () => {
    const { w, call } = setup();
    const event = {
      title: "Soccer",
      description: null,
      start: { date: "2026-11-18", time: "16:00" },
      end: { date: "2026-11-18", time: "17:00" },
      allDay: false,
      durationMinutes: 60,
    };
    w.calendarWriter.seed("maya@cal", { ...event, id: "abc", seriesId: null });
    w.calendarWriter.seed("maya@cal", { ...event, id: "rep_20261118", seriesId: "rep" });

    const one = await call("DELETE /v1/events/{eventId}", { pathParameters: { eventId: "g-abc" } });
    expect(one.statusCode).toBe(204);
    const series = await call("DELETE /v1/events/{eventId}", {
      pathParameters: { eventId: "g-rep_20261118" },
      queryStringParameters: { scope: "all" },
    });
    expect(series.statusCode).toBe(204);
    expect(w.calendarWriter.deleted).toEqual([
      { calendarId: "maya@cal", eventId: "abc" },
      { calendarId: "maya@cal", eventId: "rep" },
    ]);

    const gone = await call("DELETE /v1/events/{eventId}", {
      pathParameters: { eventId: "g-abc" },
    });
    expect(gone.statusCode).toBe(404);
    const badScope = await call("DELETE /v1/events/{eventId}", {
      pathParameters: { eventId: "g-x" },
      queryStringParameters: { scope: "everything" },
    });
    expect(badScope.statusCode).toBe(400);
  });

  it("answers 400 for a bad event, 409 without a calendar, 429 when over the limit", async () => {
    const { w, call } = setup();
    const bad = await call("POST /v1/events", {
      body: { owner: { kind: "kid", kidId: "maya" }, title: "", date: "soon" },
    });
    expect(bad.statusCode).toBe(400);
    expect(JSON.parse(String(bad.body)).issues).toHaveLength(2);
    expect((await call("POST /v1/events", { rawBody: "{" })).statusCode).toBe(400);
    const noCalendar = await call("POST /v1/events", {
      body: { owner: { kind: "kid", kidId: "theo" }, title: "x", date: "2026-11-18" },
    });
    expect(noCalendar.statusCode).toBe(409);
    expect(w.calendarWriter.inserted).toEqual([]);

    w.counters.increment = async () => 21;
    const limited = await call("POST /v1/events", {
      body: { owner: { kind: "everyone" }, title: "x", date: "2026-11-18" },
    });
    expect(limited.statusCode).toBe(429);
    expect(JSON.parse(String(limited.body)).error).toBe("rate_limited");
  });

  it("redirects photo requests to a short-lived URL, 404 without a photo", async () => {
    const { w, call } = setup();
    expect(
      (await call("GET /v1/photos/{kidId}", { pathParameters: { kidId: "maya" } })).statusCode,
    ).toBe(404);
    await w.services.photos.setPhoto("maya", { contentType: "image/jpeg", dataBase64: JPEG_B64 });
    const result = await call("GET /v1/photos/{kidId}", { pathParameters: { kidId: "maya" } });
    expect(result.statusCode).toBe(302);
    expect(result.headers?.location).toMatch(
      /^https:\/\/photos\.example\/photos\/maya\/.+\?ttl=300$/,
    );
  });

  it("redirects slide requests by hash and rejects malformed hashes", async () => {
    const { w, call } = setup({ ...FAMILY, slideshowFolderId: "family-folder" });
    w.snapshots.slides.set("family-folder", {
      slides: [
        {
          sourceId: "d1",
          version: "1",
          sha256: "a".repeat(64),
          kind: "photo",
          key: "slides/aaa.jpg",
          contentType: "image/jpeg",
        },
      ],
      syncedAt: "t",
    });
    const ok = await call("GET /v1/slides/{sha256}", {
      pathParameters: { sha256: "a".repeat(64) },
    });
    expect(ok.statusCode).toBe(302);
    expect(ok.headers?.location).toBe("https://photos.example/slides/aaa.jpg?ttl=300");
    const missing = await call("GET /v1/slides/{sha256}", {
      pathParameters: { sha256: "b".repeat(64) },
    });
    expect(missing.statusCode).toBe(404);
    const bad = await call("GET /v1/slides/{sha256}", { pathParameters: { sha256: "../x" } });
    expect(bad.statusCode).toBe(400);
  });

  it("builds the bundle for the calling frame and records its reported version", async () => {
    const { w, call } = setup();
    const decode = (result: { body?: string }) =>
      DashboardBundle.parse(
        JSON.parse(
          Buffer.from(
            BundleEnvelope.parse(JSON.parse(String(result.body))).payload,
            "base64url",
          ).toString("utf8"),
        ),
      );
    const first = await call("GET /v1/bundle", { headers: { "x-frame-version": "7" } });
    expect(decode(first).device).toEqual({
      id: "0123456789abcdef",
      name: "Kitchen",
      greetingName: null,
    });
    expect(w.devices.items.get("0123456789abcdef")).toMatchObject({
      appVersion: 7,
      appVersionAt: w.clock.current.toISOString(),
    });

    for (const header of ["0", "-1", "abc", "1.5", "99999999999"]) {
      await call("GET /v1/bundle", { headers: { "x-frame-version": header } });
    }
    expect(w.devices.items.get("0123456789abcdef")?.appVersion).toBe(7);
  });

  it("still serves the bundle when recording the version fails", async () => {
    const { w, call } = setup();
    w.devices.put = async () => {
      throw new Error("throttled");
    };
    const result = await call("GET /v1/bundle", { headers: { "x-frame-version": "8" } });
    expect(result.statusCode).toBe(200);
    expect(w.logger.lines).toContainEqual(
      expect.objectContaining({ level: "warn", message: "version report failed" }),
    );
  });

  it("redirects app downloads for the current release only", async () => {
    const { w, call } = setup();
    w.snapshots.app = {
      versionCode: 3,
      versionName: "1.3",
      sha256: "c".repeat(64),
      key: `app/${"c".repeat(64)}.apk`,
      publishedAt: "t",
    };
    const ok = await call("GET /v1/app/{sha256}", { pathParameters: { sha256: "c".repeat(64) } });
    expect(ok).toMatchObject({
      statusCode: 302,
      headers: { location: `https://photos.example/app/${"c".repeat(64)}.apk?ttl=300` },
    });
    const old = await call("GET /v1/app/{sha256}", { pathParameters: { sha256: "d".repeat(64) } });
    expect(old.statusCode).toBe(404);
    const art = await call("GET /v1/art/{sha256}", { pathParameters: { sha256: "e".repeat(64) } });
    expect(art).toMatchObject({
      statusCode: 302,
      headers: { location: `https://photos.example/art/${"e".repeat(64)}.webp?ttl=300` },
    });
  });

  it("records an outage report: 201 with its id, 400 when malformed", async () => {
    const { w, call } = setup();
    const report = {
      since: "2026-11-16T11:00:00Z",
      until: "2026-11-16T12:00:00Z",
      wifi: "disconnected",
      asleep: true,
      reboot: "none",
      appVersion: 67,
    };
    const created = await call("POST /v1/incidents", { body: report });
    expect(created.statusCode).toBe(201);
    const { incident } = JSON.parse(String(created.body));
    expect(w.incidents.items.map((i) => i.id)).toEqual([incident.id]);
    expect(w.incidents.items[0]).toMatchObject({ deviceId: "0123456789abcdef", minutes: 60 });
    expect(
      (await call("POST /v1/incidents", { body: { ...report, asleep: "yes" } })).statusCode,
    ).toBe(400);
  });

  it("refuses agent credentials", async () => {
    const w = fakeWorld();
    const handle = createDeviceHandler(() => w.services);
    const result = await handle(httpEvent<DeviceEvent>("GET /v1/bundle", { role: "agent" }));
    expect(result.statusCode).toBe(403);
  });

  it("implements exactly the declared routes and 404s anything else", async () => {
    const { w, call } = setup();
    expect(Object.keys(deviceRoutes(w.services)).sort()).toEqual([...DEVICE_ROUTES].sort());
    expect((await call("GET /admin/settings")).statusCode).toBe(404);
  });
});
