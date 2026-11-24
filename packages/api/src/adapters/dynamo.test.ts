import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { Chore, FrameIncident } from "@kids-dash/core";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { FAMILY } from "../../test/fakes";
import {
  DynamoChoreStore,
  DynamoCompletionStore,
  DynamoCounterStore,
  DynamoDeviceStore,
  DynamoFrameWatchStore,
  DynamoIncidentStore,
  DynamoNoteStore,
  DynamoSettingsStore,
  DynamoSnapshotStore,
  DynamoVideoConversionStore,
  Table,
} from "./dynamo";

const ddb = mockClient(DynamoDBDocumentClient);
const table = new Table(
  DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" })),
  "kids",
);

beforeEach(() => ddb.reset());

const chore: Chore = {
  id: "bed",
  kidId: "maya",
  title: "Bed",
  sticker: "bed",
  period: "morning",
  days: [],
  order: 0,
};
const event = {
  id: "trip",
  source: "google",
  owner: { kind: "everyone" },
  title: "Trip",
  note: null,
  details: null,
  special: false,
  badge: null,
  sticker: "bus",
  start: { date: "2026-11-16", time: "09:00" },
  end: { date: "2026-11-16", time: "10:00" },
  allDay: false,
} as const;

describe("Table", () => {
  it("pages through query results", async () => {
    ddb
      .on(QueryCommand)
      .resolvesOnce({ Items: [{ data: chore }], LastEvaluatedKey: { pk: "CHORE", sk: "a" } })
      .resolvesOnce({ Items: [{ data: { ...chore, id: "teeth" } }] });
    const chores = await new DynamoChoreStore(table).list();
    expect(chores.map((c) => c.id)).toEqual(["bed", "teeth"]);
    expect(ddb.commandCalls(QueryCommand)[1]?.args[0].input.ExclusiveStartKey).toEqual({
      pk: "CHORE",
      sk: "a",
    });
  });

  it("builds a Table from the environment", () => {
    expect(Table.fromEnv("kids").name).toBe("kids");
  });
});

describe("settings", () => {
  it("round-trips and validates", async () => {
    const store = new DynamoSettingsStore(table);
    ddb.on(GetCommand).resolves({});
    expect(await store.get()).toBeNull();
    ddb.on(GetCommand).resolves({ Item: { data: FAMILY } });
    expect(await store.get()).toEqual(FAMILY);
    ddb.on(GetCommand).resolves({ Item: { data: { timezone: 5 } } });
    await expect(store.get()).rejects.toThrow();

    ddb.on(PutCommand).resolves({});
    await store.put(FAMILY);
    expect(ddb.commandCalls(PutCommand)[0]?.args[0].input).toMatchObject({
      TableName: "kids",
      Item: { pk: "SETTINGS", sk: "SETTINGS", data: FAMILY },
    });
  });
});

describe("chores", () => {
  it("keys by kid and chore, and reports deletes", async () => {
    const store = new DynamoChoreStore(table);
    ddb.on(PutCommand).resolves({});
    await store.put(chore);
    expect(ddb.commandCalls(PutCommand)[0]?.args[0].input.Item).toMatchObject({
      pk: "CHORE",
      sk: "maya#bed",
    });

    ddb.on(DeleteCommand).resolves({ Attributes: { pk: "CHORE" } });
    expect(await store.delete("maya", "bed")).toBe(true);
    ddb.on(DeleteCommand).resolves({});
    expect(await store.delete("maya", "bed")).toBe(false);
  });
});

describe("notes", () => {
  it("queries an inclusive date range and expires notes", async () => {
    const store = new DynamoNoteStore(table);
    const note = {
      id: "book",
      date: "2026-11-16",
      owner: { kind: "everyone" },
      text: "Book",
    } as const;
    ddb.on(QueryCommand).resolves({ Items: [{ data: note }] });
    expect(await store.listBetween("2026-11-16", "2026-11-17")).toEqual([note]);
    expect(ddb.commandCalls(QueryCommand)[0]?.args[0].input.ExpressionAttributeValues).toEqual({
      ":pk": "NOTE",
      ":from": "2026-11-16#",
      ":to": "2026-11-17#~",
    });

    ddb.on(PutCommand).resolves({});
    await store.put(note);
    expect(ddb.commandCalls(PutCommand)[0]?.args[0].input.Item).toMatchObject({
      pk: "NOTE",
      sk: "2026-11-16#book",
      expiresAt: Date.parse("2026-12-16T00:00:00Z") / 1000,
    });
    ddb.on(DeleteCommand).resolves({});
    expect(await store.delete("2026-11-16", "book")).toBe(false);
  });
});

describe("snapshots", () => {
  it("reads and writes both snapshots", async () => {
    const store = new DynamoSnapshotStore(table);
    ddb.on(GetCommand).resolves({});
    expect(await store.getCalendar()).toBeNull();
    expect(await store.getWeather()).toBeNull();

    const calendar = { events: [event], syncedAt: "now" };
    const weather = {
      date: "2026-11-16",
      weather: {
        high: 1,
        low: 0,
        rainChance: 0,
        code: 0,
        current: null,
        sunrise: null,
        sunset: null,
      },
      syncedAt: "now",
    };
    ddb
      .on(GetCommand, { Key: { pk: "SNAPSHOT", sk: "CALENDAR" } })
      .resolves({ Item: { data: calendar } });
    ddb
      .on(GetCommand, { Key: { pk: "SNAPSHOT", sk: "WEATHER" } })
      .resolves({ Item: { data: weather } });
    expect(await store.getCalendar()).toEqual(calendar);
    expect(await store.getWeather()).toEqual(weather);

    ddb.on(PutCommand).resolves({});
    await store.putCalendar(calendar);
    await store.putWeather(weather);
    expect(ddb.commandCalls(PutCommand).map((c) => c.args[0].input.Item?.sk)).toEqual([
      "CALENDAR",
      "WEATHER",
    ]);
  });
});

describe("slide and app snapshots", () => {
  const snapshot = {
    slides: [
      {
        sourceId: "d1",
        version: "1",
        sha256: "a".repeat(64),
        kind: "photo" as const,
        key: `slides/${"a".repeat(64)}.jpg`,
        contentType: "image/jpeg",
      },
    ],
    syncedAt: "now",
  };

  it("keeps one slides snapshot per folder, plus the index", async () => {
    const store = new DynamoSnapshotStore(table);
    ddb.on(GetCommand).resolves({});
    expect(await store.getSlides("folder1")).toBeNull();
    expect(await store.getSlidesIndex()).toBeNull();
    ddb
      .on(GetCommand, { Key: { pk: "SNAPSHOT", sk: "SLIDES#folder1" } })
      .resolves({ Item: { data: snapshot } });
    ddb
      .on(GetCommand, { Key: { pk: "SNAPSHOT", sk: "SLIDES_INDEX" } })
      .resolves({ Item: { data: { folderIds: ["folder1"] } } });
    expect(await store.getSlides("folder1")).toEqual(snapshot);
    expect(await store.getSlidesIndex()).toEqual(["folder1"]);

    ddb.on(PutCommand).resolves({});
    ddb.on(DeleteCommand).resolves({});
    await store.putSlides("folder1", snapshot);
    await store.putSlidesIndex(["folder1", "folder2"]);
    await store.deleteSlides("folder2");
    expect(ddb.commandCalls(PutCommand).map((c) => c.args[0].input.Item)).toEqual([
      { pk: "SNAPSHOT", sk: "SLIDES#folder1", data: snapshot },
      { pk: "SNAPSHOT", sk: "SLIDES_INDEX", data: { folderIds: ["folder1", "folder2"] } },
    ]);
    expect(ddb.commandCalls(DeleteCommand)[0]?.args[0].input.Key).toEqual({
      pk: "SNAPSHOT",
      sk: "SLIDES#folder2",
    });
  });

  it("reads and retires the legacy single slides snapshot", async () => {
    const store = new DynamoSnapshotStore(table);
    ddb.on(GetCommand).resolves({});
    expect(await store.getLegacySlides()).toBeNull();
    ddb
      .on(GetCommand, { Key: { pk: "SNAPSHOT", sk: "SLIDES" } })
      .resolves({ Item: { data: snapshot } });
    expect(await store.getLegacySlides()).toEqual(snapshot);
    ddb.on(DeleteCommand).resolves({});
    await store.deleteLegacySlides();
    expect(ddb.commandCalls(DeleteCommand)[0]?.args[0].input.Key).toEqual({
      pk: "SNAPSHOT",
      sk: "SLIDES",
    });
  });

  it("stores the current app release", async () => {
    const store = new DynamoSnapshotStore(table);
    const release = {
      versionCode: 2,
      versionName: "1.2",
      sha256: "b".repeat(64),
      key: `app/${"b".repeat(64)}.apk`,
      publishedAt: "now",
    };
    ddb.on(GetCommand).resolves({});
    expect(await store.getApp()).toBeNull();
    ddb
      .on(GetCommand, { Key: { pk: "SNAPSHOT", sk: "APP" } })
      .resolves({ Item: { data: release } });
    expect(await store.getApp()).toEqual(release);
    ddb.on(PutCommand).resolves({});
    await store.putApp(release);
    expect(ddb.commandCalls(PutCommand)[0]?.args[0].input.Item).toEqual({
      pk: "SNAPSHOT",
      sk: "APP",
      data: release,
    });
  });
});

describe("completions", () => {
  it("lists done keys and toggles by put/delete", async () => {
    const store = new DynamoCompletionStore(table);
    ddb.on(QueryCommand).resolves({ Items: [{ pk: "DONE#2026-11-16", sk: "maya#bed" }] });
    expect(await store.listDone("2026-11-16")).toEqual(new Set(["maya/bed"]));

    ddb.on(PutCommand).resolves({});
    ddb.on(DeleteCommand).resolves({});
    await store.set("2026-11-16", "maya", "bed", true);
    await store.set("2026-11-16", "maya", "bed", false);
    expect(ddb.commandCalls(PutCommand)[0]?.args[0].input.Item).toMatchObject({
      pk: "DONE#2026-11-16",
      sk: "maya#bed",
      expiresAt: Date.parse("2026-12-07T00:00:00Z") / 1000,
    });
    expect(ddb.commandCalls(DeleteCommand)[0]?.args[0].input.Key).toEqual({
      pk: "DONE#2026-11-16",
      sk: "maya#bed",
    });
  });
});

describe("devices", () => {
  it("gets, lists and puts devices", async () => {
    const store = new DynamoDeviceStore(table);
    const device = {
      id: "0123456789abcdef",
      name: "Frame",
      role: "device" as const,
      secretHash: "h",
      createdAt: "c",
      lastSeenAt: null,
      revokedAt: null,
      settings: { slideshowFolderId: "1AbCdEfGhIjKlMnOp", greetingName: null },
      appVersion: 3,
      appVersionAt: "v",
    };
    ddb.on(GetCommand).resolves({});
    expect(await store.get("x")).toBeNull();
    ddb.on(GetCommand).resolves({ Item: { data: device } });
    expect(await store.get(device.id)).toEqual(device);
    ddb.on(QueryCommand).resolves({ Items: [{ data: device }] });
    expect(await store.list()).toEqual([device]);
    ddb.on(PutCommand).resolves({});
    await store.put(device);
    expect(ddb.commandCalls(PutCommand)[0]?.args[0].input.Item).toMatchObject({
      pk: "DEVICE",
      sk: device.id,
    });
  });

  it("defaults the fields records written before per-frame settings lack", async () => {
    const store = new DynamoDeviceStore(table);
    const legacy = {
      id: "0123456789abcdef",
      name: "Frame",
      secretHash: "h",
      createdAt: "c",
      lastSeenAt: "l",
      revokedAt: null,
    };
    ddb.on(GetCommand).resolves({ Item: { data: legacy } });
    expect(await store.get(legacy.id)).toEqual({
      ...legacy,
      role: "device",
      settings: { slideshowFolderId: null, greetingName: null },
      appVersion: null,
      appVersionAt: null,
    });
  });
});

describe("counters", () => {
  it("adds one atomically, sets the expiry once and returns the new count", async () => {
    const store = new DynamoCounterStore(table);
    ddb
      .on(UpdateCommand)
      .resolvesOnce({ Attributes: { n: 3 } })
      .resolvesOnce({});
    expect(await store.increment("k", new Date("2026-11-16T14:00:00Z"))).toBe(3);
    expect(ddb.commandCalls(UpdateCommand)[0]?.args[0].input).toMatchObject({
      TableName: "kids",
      Key: { pk: "COUNTER", sk: "k" },
      UpdateExpression: "ADD n :one SET expiresAt = if_not_exists(expiresAt, :exp)",
      ExpressionAttributeValues: { ":one": 1, ":exp": 1794837600 },
    });
    expect(await store.increment("k", new Date())).toBe(1);
  });
});

describe("incidents", () => {
  const incident = (id: string, receivedAt: string): FrameIncident => ({
    id,
    deviceId: "4cd57a7dc2acdf5d",
    deviceName: "Kitchen frame",
    receivedAt,
    since: "2026-11-17T14:56:00.000Z",
    until: "2026-11-17T15:52:30.000Z",
    minutes: 56,
    wifi: "no-networks",
    asleep: false,
    reboot: "watchdog",
    appVersion: 67,
    log: "wlan0: disconnected",
  });

  it("stores reports by receive time with a 90-day expiry and lists newest first", async () => {
    const store = new DynamoIncidentStore(table);
    ddb.on(PutCommand).resolves({});
    await store.put(incident("aaaaaaaaaaaaaaaa", "2026-11-17T15:53:00.000Z"));
    expect(ddb.commandCalls(PutCommand)[0]?.args[0].input).toMatchObject({
      Item: {
        pk: "INCIDENT",
        sk: "2026-11-17T15:53:00.000Z#aaaaaaaaaaaaaaaa",
        expiresAt: Date.parse("2027-02-15T00:00:00Z") / 1000,
      },
    });

    ddb.on(QueryCommand).resolves({
      Items: [
        { data: incident("aaaaaaaaaaaaaaaa", "2026-11-16T01:00:00.000Z") },
        { data: incident("bbbbbbbbbbbbbbbb", "2026-11-17T15:53:00.000Z") },
      ],
    });
    expect((await store.list()).map((i) => i.id)).toEqual(["bbbbbbbbbbbbbbbb", "aaaaaaaaaaaaaaaa"]);
  });
});

describe("DynamoFrameWatchStore", () => {
  it("keeps the offline frames in one item", async () => {
    const store = new DynamoFrameWatchStore(table);
    ddb.on(GetCommand).resolves({});
    expect(await store.get()).toEqual({});

    ddb.on(GetCommand).resolves({ Item: { data: { abc: "2026-11-17T17:13:53.681Z" } } });
    expect(await store.get()).toEqual({ abc: "2026-11-17T17:13:53.681Z" });

    ddb.on(PutCommand).resolves({});
    await store.put({ abc: "t" });
    expect(ddb.commandCalls(PutCommand)[0]?.args[0].input).toMatchObject({
      Item: { pk: "WATCH", sk: "OFFLINE", data: { abc: "t" } },
    });
  });
});

describe("DynamoVideoConversionStore", () => {
  const store = new DynamoVideoConversionStore(table, () => "2026-11-18");

  it("keeps a conversion per source and version for 30 days", async () => {
    ddb.on(PutCommand).resolves({});
    const done = {
      state: "done" as const,
      at: "2026-11-18T20:00:00Z",
      attempts: 1,
      sha256: "a".repeat(64),
      key: `slides/${"a".repeat(64)}.mp4`,
    };
    await store.putConversion("file1", "v2", done);
    const item = ddb.commandCalls(PutCommand)[0]?.args[0].input.Item;
    expect(item).toMatchObject({ pk: "VIDEO", sk: "file1#v2", data: done });
    expect(item?.expiresAt).toBe(Date.UTC(2026, 11, 18) / 1000);

    ddb.on(GetCommand, { Key: { pk: "VIDEO", sk: "file1#v2" } }).resolves({ Item: { data: done } });
    expect(await store.getConversion("file1", "v2")).toEqual(done);
    ddb.on(GetCommand, { Key: { pk: "VIDEO", sk: "file1#v3" } }).resolves({});
    expect(await store.getConversion("file1", "v3")).toBeNull();
  });

  it("refuses a malformed record", async () => {
    await expect(
      store.putConversion("f", "v", { state: "done", at: "x", attempts: -1 }),
    ).rejects.toThrow();
  });
});
