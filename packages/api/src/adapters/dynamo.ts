import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  addDays,
  Chore,
  CredentialRole,
  DeviceSettings,
  FrameIncident,
  HistoryEvent,
  type IsoDate,
  Note,
  PLACE_KINDS,
  Place,
  type PlaceKind,
  PlannedEvent,
  Settings,
  SLIDE_KINDS,
  TriviaQuestion,
  Weather,
} from "@kids-dash/core";
import { z } from "zod";
import type {
  AppReleaseRecord,
  CalendarSnapshot,
  ChoreStore,
  CompletionStore,
  CounterStore,
  DeviceRecord,
  DeviceStore,
  FrameWatchStore,
  IncidentStore,
  NoteStore,
  PlacesSnapshot,
  SettingsStore,
  SlidesSnapshot,
  SnapshotStore,
  TodaySnapshot,
  TriviaSnapshot,
  VideoConversion,
  VideoConversionStore,
  WeatherSnapshot,
} from "../services/ports";

/**
 * One table, `pk`/`sk` strings, the entity in `data`, optional `expiresAt` TTL:
 *
 *   SETTINGS       SETTINGS
 *   CHORE          <kidId>#<choreId>
 *   NOTE           <date>#<noteId>          expires 30 days after its date
 *   EVENT          <eventId>                expires 30 days after it ends
 *   SNAPSHOT       CALENDAR | WEATHER | APP
 *   SNAPSHOT       SLIDES#<folderId>        one per slideshow folder in use
 *   SNAPSHOT       SLIDES_INDEX             { folderIds } the last sync mirrored
 *   SNAPSHOT       SLIDES                   legacy, pre-per-folder (family folder)
 *   DONE#<date>    <kidId>#<choreId>        expires 21 days after the date
 *   DEVICE         <deviceId>
 *   COUNTER        <key>                    { n }, expires when its window ends
 *   INCIDENT       <receivedAt>#<id>        a frame's outage report, expires after 90 days
 *   VIDEO          <sourceId>#<version>     a slideshow video's conversion, expires after 30 days
 *
 * A family's data is tiny, so every list is a single-partition query. Items are
 * re-validated on read so a hand-edited row cannot reach the frame malformed.
 */
export const KEEP_NOTES_DAYS = 30;
// Check-offs count back to last week's Monday (up to 13 days), with room to spare.
export const KEEP_COMPLETIONS_DAYS = 21;
export const KEEP_INCIDENTS_DAYS = 90;
// The sync adopts a converted video within minutes; after that the slide snapshot holds it.
export const KEEP_CONVERSIONS_DAYS = 30;

export class Table {
  constructor(
    readonly client: DynamoDBDocumentClient,
    readonly name: string,
  ) {}

  static fromEnv(name: string): Table {
    return new Table(
      DynamoDBDocumentClient.from(new DynamoDBClient({}), {
        marshallOptions: { removeUndefinedValues: true },
      }),
      name,
    );
  }

  async get(pk: string, sk: string): Promise<unknown | null> {
    const out = await this.client.send(new GetCommand({ TableName: this.name, Key: { pk, sk } }));
    return out.Item?.data ?? null;
  }

  async put(pk: string, sk: string, data: unknown, expiresOn?: IsoDate): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.name,
        Item: { pk, sk, data, ...(expiresOn ? { expiresAt: epochSeconds(expiresOn) } : {}) },
      }),
    );
  }

  /** Deletes and reports whether the item existed. */
  async delete(pk: string, sk: string): Promise<boolean> {
    const out = await this.client.send(
      new DeleteCommand({ TableName: this.name, Key: { pk, sk }, ReturnValues: "ALL_OLD" }),
    );
    return out.Attributes !== undefined;
  }

  async query(
    pk: string,
    range?: { from: string; to: string },
  ): Promise<Array<Record<string, unknown>>> {
    const items: Array<Record<string, unknown>> = [];
    let start: Record<string, unknown> | undefined;
    do {
      const out = await this.client.send(
        new QueryCommand({
          TableName: this.name,
          KeyConditionExpression: range ? "pk = :pk AND sk BETWEEN :from AND :to" : "pk = :pk",
          ExpressionAttributeValues: {
            ":pk": pk,
            ...(range ? { ":from": range.from, ":to": range.to } : {}),
          },
          ExclusiveStartKey: start,
        }),
      );
      items.push(...(out.Items ?? []));
      start = out.LastEvaluatedKey;
    } while (start);
    return items;
  }
}

function epochSeconds(date: IsoDate): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
}

export class DynamoSettingsStore implements SettingsStore {
  constructor(private readonly table: Table) {}

  async get(): Promise<Settings | null> {
    const data = await this.table.get("SETTINGS", "SETTINGS");
    return data === null ? null : Settings.parse(data);
  }

  async put(settings: Settings): Promise<void> {
    await this.table.put("SETTINGS", "SETTINGS", Settings.parse(settings));
  }
}

export class DynamoChoreStore implements ChoreStore {
  constructor(private readonly table: Table) {}

  async list(): Promise<Chore[]> {
    return (await this.table.query("CHORE")).map((item) => Chore.parse(item.data));
  }

  async put(chore: Chore): Promise<void> {
    await this.table.put("CHORE", `${chore.kidId}#${chore.id}`, Chore.parse(chore));
  }

  async delete(kidId: string, choreId: string): Promise<boolean> {
    return this.table.delete("CHORE", `${kidId}#${choreId}`);
  }
}

export class DynamoNoteStore implements NoteStore {
  constructor(private readonly table: Table) {}

  async listBetween(from: IsoDate, to: IsoDate): Promise<Note[]> {
    // `~` sorts after every id character, so `<to>#~` closes the range on `to`.
    const items = await this.table.query("NOTE", { from: `${from}#`, to: `${to}#~` });
    return items.map((item) => Note.parse(item.data));
  }

  async put(note: Note): Promise<void> {
    await this.table.put(
      "NOTE",
      `${note.date}#${note.id}`,
      Note.parse(note),
      addDays(note.date, KEEP_NOTES_DAYS),
    );
  }

  async delete(date: IsoDate, noteId: string): Promise<boolean> {
    return this.table.delete("NOTE", `${date}#${noteId}`);
  }
}

const CalendarSnapshotSchema = z.object({
  events: z.array(PlannedEvent),
  syncedAt: z.string(),
});
const WeatherSnapshotSchema = z.object({
  date: z.string(),
  weather: Weather,
  syncedAt: z.string(),
});

const TriviaSnapshotSchema = z.object({
  date: z.string(),
  questions: z.array(TriviaQuestion),
  seen: z.array(z.string()),
  syncedAt: z.string(),
});

const TodaySnapshotSchema = z.object({
  date: z.string(),
  history: z.array(HistoryEvent),
  place: Place.nullable(),
  placesSeen: z.array(z.string()),
  syncedAt: z.string(),
});

const PlacesSnapshotSchema = z.object({
  candidates: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(PLACE_KINDS),
      name: z.string(),
      title: z.string(),
      map: z.string(),
      population: z.number().nullable(),
      areaKm2: z.number().nullable(),
      capital: z.string().nullable(),
      country: z.string().nullable(),
    }),
  ),
  fetchedAt: z.string(),
});

const SlidesSnapshotSchema = z.object({
  slides: z.array(
    z.object({
      sourceId: z.string(),
      version: z.string(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      kind: z.enum(SLIDE_KINDS),
      key: z.string(),
      contentType: z.string(),
      converted: z.boolean().optional(),
    }),
  ),
  syncedAt: z.string(),
});

const VideoConversionSchema = z.object({
  state: z.enum(["pending", "done", "failed"]),
  at: z.string(),
  attempts: z.number().int().nonnegative(),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  key: z.string().optional(),
  error: z.string().optional(),
});

const SlidesIndexSchema = z.object({ folderIds: z.array(z.string()) });

const AppReleaseSchema = z.object({
  versionCode: z.number().int().positive(),
  versionName: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  key: z.string(),
  publishedAt: z.string(),
});

export class DynamoSnapshotStore implements SnapshotStore {
  constructor(private readonly table: Table) {}

  async getCalendar(): Promise<CalendarSnapshot | null> {
    const data = await this.table.get("SNAPSHOT", "CALENDAR");
    return data === null ? null : CalendarSnapshotSchema.parse(data);
  }

  async putCalendar(snapshot: CalendarSnapshot): Promise<void> {
    await this.table.put("SNAPSHOT", "CALENDAR", snapshot);
  }

  async getWeather(): Promise<WeatherSnapshot | null> {
    const data = await this.table.get("SNAPSHOT", "WEATHER");
    return data === null ? null : WeatherSnapshotSchema.parse(data);
  }

  async putWeather(snapshot: WeatherSnapshot): Promise<void> {
    await this.table.put("SNAPSHOT", "WEATHER", snapshot);
  }

  async getTrivia(): Promise<TriviaSnapshot | null> {
    const data = await this.table.get("SNAPSHOT", "TRIVIA");
    return data === null ? null : TriviaSnapshotSchema.parse(data);
  }

  async putTrivia(snapshot: TriviaSnapshot): Promise<void> {
    await this.table.put("SNAPSHOT", "TRIVIA", snapshot);
  }

  async getToday(): Promise<TodaySnapshot | null> {
    const data = await this.table.get("SNAPSHOT", "TODAY");
    return data === null ? null : TodaySnapshotSchema.parse(data);
  }

  async putToday(snapshot: TodaySnapshot): Promise<void> {
    await this.table.put("SNAPSHOT", "TODAY", snapshot);
  }

  async getPlaces(kind: PlaceKind): Promise<PlacesSnapshot | null> {
    const data = await this.table.get("SNAPSHOT", `PLACES#${kind}`);
    return data === null ? null : PlacesSnapshotSchema.parse(data);
  }

  async putPlaces(kind: PlaceKind, snapshot: PlacesSnapshot): Promise<void> {
    await this.table.put("SNAPSHOT", `PLACES#${kind}`, snapshot);
  }

  async getSlides(folderId: string): Promise<SlidesSnapshot | null> {
    const data = await this.table.get("SNAPSHOT", `SLIDES#${folderId}`);
    return data === null ? null : SlidesSnapshotSchema.parse(data);
  }

  async putSlides(folderId: string, snapshot: SlidesSnapshot): Promise<void> {
    await this.table.put("SNAPSHOT", `SLIDES#${folderId}`, snapshot);
  }

  async deleteSlides(folderId: string): Promise<void> {
    await this.table.delete("SNAPSHOT", `SLIDES#${folderId}`);
  }

  async getSlidesIndex(): Promise<string[] | null> {
    const data = await this.table.get("SNAPSHOT", "SLIDES_INDEX");
    return data === null ? null : SlidesIndexSchema.parse(data).folderIds;
  }

  async putSlidesIndex(folderIds: string[]): Promise<void> {
    await this.table.put("SNAPSHOT", "SLIDES_INDEX", { folderIds });
  }

  async getLegacySlides(): Promise<SlidesSnapshot | null> {
    const data = await this.table.get("SNAPSHOT", "SLIDES");
    return data === null ? null : SlidesSnapshotSchema.parse(data);
  }

  async deleteLegacySlides(): Promise<void> {
    await this.table.delete("SNAPSHOT", "SLIDES");
  }

  async getApp(): Promise<AppReleaseRecord | null> {
    const data = await this.table.get("SNAPSHOT", "APP");
    return data === null ? null : AppReleaseSchema.parse(data);
  }

  async putApp(release: AppReleaseRecord): Promise<void> {
    await this.table.put("SNAPSHOT", "APP", release);
  }
}

export class DynamoCompletionStore implements CompletionStore {
  constructor(private readonly table: Table) {}

  async listDone(date: IsoDate): Promise<Set<string>> {
    const items = await this.table.query(`DONE#${date}`);
    return new Set(items.map((item) => String(item.sk).replace("#", "/")));
  }

  async set(date: IsoDate, kidId: string, choreId: string, done: boolean): Promise<void> {
    const pk = `DONE#${date}`;
    const sk = `${kidId}#${choreId}`;
    if (done) await this.table.put(pk, sk, { doneAt: date }, addDays(date, KEEP_COMPLETIONS_DAYS));
    else await this.table.delete(pk, sk);
  }
}

const DeviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  // Credentials created before roles existed were all frames.
  role: CredentialRole.default("device"),
  secretHash: z.string(),
  createdAt: z.string(),
  lastSeenAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  // Records from before per-frame settings and version reports.
  settings: DeviceSettings.default({ slideshowFolderId: null, greetingName: null }),
  appVersion: z.number().int().nullable().default(null),
  appVersionAt: z.string().nullable().default(null),
});

export class DynamoDeviceStore implements DeviceStore {
  constructor(private readonly table: Table) {}

  async get(id: string): Promise<DeviceRecord | null> {
    const data = await this.table.get("DEVICE", id);
    return data === null ? null : DeviceSchema.parse(data);
  }

  async list(): Promise<DeviceRecord[]> {
    return (await this.table.query("DEVICE")).map((item) => DeviceSchema.parse(item.data));
  }

  async put(device: DeviceRecord): Promise<void> {
    await this.table.put("DEVICE", device.id, device);
  }
}

export class DynamoCounterStore implements CounterStore {
  constructor(private readonly table: Table) {}

  async increment(key: string, expiresAt: Date): Promise<number> {
    const out = await this.table.client.send(
      new UpdateCommand({
        TableName: this.table.name,
        Key: { pk: "COUNTER", sk: key },
        UpdateExpression: "ADD n :one SET expiresAt = if_not_exists(expiresAt, :exp)",
        ExpressionAttributeValues: {
          ":one": 1,
          ":exp": Math.floor(expiresAt.getTime() / 1000),
        },
        ReturnValues: "UPDATED_NEW",
      }),
    );
    return Number(out.Attributes?.n ?? 1);
  }
}

/** One item: the frames the watch has emailed about as offline. */
const WatchSchema = z.record(z.string(), z.string());

export class DynamoFrameWatchStore implements FrameWatchStore {
  constructor(private readonly table: Table) {}

  async get(): Promise<Record<string, string>> {
    const data = await this.table.get("WATCH", "OFFLINE");
    return data === null ? {} : WatchSchema.parse(data);
  }

  async put(offline: Record<string, string>): Promise<void> {
    await this.table.put("WATCH", "OFFLINE", offline);
  }
}

export class DynamoIncidentStore implements IncidentStore {
  constructor(private readonly table: Table) {}

  async put(incident: FrameIncident): Promise<void> {
    const day = incident.receivedAt.slice(0, 10) as IsoDate;
    await this.table.put(
      "INCIDENT",
      `${incident.receivedAt}#${incident.id}`,
      FrameIncident.parse(incident),
      addDays(day, KEEP_INCIDENTS_DAYS),
    );
  }

  async list(): Promise<FrameIncident[]> {
    // Sort keys start with the ISO receive time, so reversing gives newest first.
    const items = await this.table.query("INCIDENT");
    return items.reverse().map((item) => FrameIncident.parse(item.data));
  }
}

export class DynamoVideoConversionStore implements VideoConversionStore {
  constructor(
    private readonly table: Table,
    private readonly today: () => IsoDate,
  ) {}

  async getConversion(sourceId: string, version: string): Promise<VideoConversion | null> {
    const data = await this.table.get("VIDEO", `${sourceId}#${version}`);
    return data === null ? null : VideoConversionSchema.parse(data);
  }

  async putConversion(sourceId: string, version: string, conversion: VideoConversion) {
    await this.table.put(
      "VIDEO",
      `${sourceId}#${version}`,
      VideoConversionSchema.parse(conversion),
      addDays(this.today(), KEEP_CONVERSIONS_DAYS),
    );
  }
}
