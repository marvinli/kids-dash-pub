import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import {
  addDays,
  type CalendarEntry,
  type Chore,
  type FrameIncident,
  type HistoryEvent,
  type Note,
  PLACE_KINDS,
  type PlaceKind,
  type Settings,
  type TriviaQuestion,
  type Weather,
} from "@kids-dash/core";
import type { Services } from "../src/handlers/wiring";
import { AppService } from "../src/services/app-service";
import { BundleService } from "../src/services/bundle-service";
import { ChoreService } from "../src/services/chore-service";
import { CompletionService } from "../src/services/completion-service";
import { DeviceService } from "../src/services/device-service";
import { EventService } from "../src/services/event-service";
import { FamilyService } from "../src/services/family-service";
import { IncidentService } from "../src/services/incident-service";
import { OAuthService } from "../src/services/oauth-service";
import { PhotoService } from "../src/services/photo-service";
import type {
  AccessTokenVerifier,
  AppReleaseRecord,
  CalendarReader,
  CalendarSnapshot,
  CalendarWriter,
  ChoreStore,
  Clock,
  CompletionStore,
  CounterStore,
  DeviceRecord,
  DeviceStore,
  FrameWatchStore,
  HistoryReader,
  IncidentStore,
  Logger,
  MediaFile,
  MediaFolderReader,
  MediaItem,
  NewCalendarEvent,
  NoteStore,
  Notifier,
  OAuthClient,
  OAuthClientRegistry,
  PhotoStore,
  PlaceCandidate,
  PlaceReader,
  PlacesSnapshot,
  SettingsStore,
  Signer,
  SignInDirectory,
  SlidesSnapshot,
  SnapshotStore,
  StoredCalendarEvent,
  TodaySnapshot,
  TriviaReader,
  TriviaSnapshot,
  VideoConversion,
  VideoConversionQueue,
  VideoConversionStore,
  VideoConverter,
  WeatherReader,
  WeatherSnapshot,
} from "../src/services/ports";
import { CalendarRefusedError } from "../src/services/ports";
import { SyncService } from "../src/services/sync-service";
import { VideoConvertService } from "../src/services/video-convert";
import { WatchService } from "../src/services/watch-service";

export class FakeClock implements Clock {
  constructor(public current = new Date("2026-11-16T12:42:00Z")) {}
  now() {
    return this.current;
  }
}

export class MemorySettings implements SettingsStore {
  constructor(public value: Settings | null = null) {}
  async get() {
    return this.value;
  }
  async put(settings: Settings) {
    this.value = structuredClone(settings);
  }
}

export class MemoryChores implements ChoreStore {
  items = new Map<string, Chore>();
  async list() {
    return [...this.items.values()];
  }
  async put(chore: Chore) {
    this.items.set(`${chore.kidId}#${chore.id}`, chore);
  }
  async delete(kidId: string, choreId: string) {
    return this.items.delete(`${kidId}#${choreId}`);
  }
}

export class MemoryNotes implements NoteStore {
  items = new Map<string, Note>();
  async listBetween(from: string, to: string) {
    return [...this.items.values()].filter((n) => n.date >= from && n.date <= to);
  }
  async put(note: Note) {
    this.items.set(`${note.date}#${note.id}`, note);
  }
  async delete(date: string, id: string) {
    return this.items.delete(`${date}#${id}`);
  }
}

export class MemorySnapshots implements SnapshotStore {
  calendar: CalendarSnapshot | null = null;
  weather: WeatherSnapshot | null = null;
  trivia: TriviaSnapshot | null = null;
  today: TodaySnapshot | null = null;
  places = new Map<PlaceKind, PlacesSnapshot>();
  /** Per folder id. */
  slides = new Map<string, SlidesSnapshot>();
  slidesIndex: string[] | null = null;
  legacySlides: SlidesSnapshot | null = null;
  app: AppReleaseRecord | null = null;
  async getSlides(folderId: string) {
    return this.slides.get(folderId) ?? null;
  }
  async putSlides(folderId: string, s: SlidesSnapshot) {
    this.slides.set(folderId, s);
  }
  async deleteSlides(folderId: string) {
    this.slides.delete(folderId);
  }
  async getSlidesIndex() {
    return this.slidesIndex;
  }
  async putSlidesIndex(folderIds: string[]) {
    this.slidesIndex = [...folderIds];
  }
  async getLegacySlides() {
    return this.legacySlides;
  }
  async deleteLegacySlides() {
    this.legacySlides = null;
  }
  async getApp() {
    return this.app;
  }
  async putApp(release: AppReleaseRecord) {
    this.app = release;
  }
  async getCalendar() {
    return this.calendar;
  }
  async putCalendar(s: CalendarSnapshot) {
    this.calendar = s;
  }
  async getWeather() {
    return this.weather;
  }
  async putWeather(s: WeatherSnapshot) {
    this.weather = s;
  }
  async getTrivia() {
    return this.trivia;
  }
  async putTrivia(s: TriviaSnapshot) {
    this.trivia = s;
  }
  async getToday() {
    return this.today;
  }
  async putToday(s: TodaySnapshot) {
    this.today = s;
  }
  async getPlaces(kind: PlaceKind) {
    return this.places.get(kind) ?? null;
  }
  async putPlaces(kind: PlaceKind, s: PlacesSnapshot) {
    this.places.set(kind, s);
  }
}

export class MemoryCompletions implements CompletionStore {
  done = new Map<string, Set<string>>();
  async listDone(date: string) {
    return new Set(this.done.get(date) ?? []);
  }
  async set(date: string, kidId: string, choreId: string, done: boolean) {
    const set = this.done.get(date) ?? new Set<string>();
    if (done) set.add(`${kidId}/${choreId}`);
    else set.delete(`${kidId}/${choreId}`);
    this.done.set(date, set);
  }
}

export class MemoryDevices implements DeviceStore {
  items = new Map<string, DeviceRecord>();
  async get(id: string) {
    return this.items.get(id) ?? null;
  }
  async list() {
    return [...this.items.values()];
  }
  async put(device: DeviceRecord) {
    this.items.set(device.id, device);
  }
}

export class MemoryPhotos implements PhotoStore {
  objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  async put(key: string, bytes: Uint8Array, contentType: string) {
    this.objects.set(key, { bytes, contentType });
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
  async presign(key: string, ttl: number) {
    return `https://photos.example/${key}?ttl=${ttl}`;
  }
  async presignPut(key: string, contentType: string, sha256: string, ttl: number) {
    return `https://photos.example/${key}?put=${encodeURIComponent(contentType)}&sha256=${sha256}&ttl=${ttl}`;
  }
  async get(key: string) {
    return this.objects.get(key)?.bytes ?? null;
  }
  async exists(key: string) {
    return this.objects.has(key);
  }
}

/** Signs locally with a fresh P-256 key, so tests can verify real signatures. */
export class LocalSigner implements Signer {
  readonly keyId = "test-key";
  readonly publicKey: KeyObject;
  private readonly privateKey: KeyObject;

  constructor() {
    const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.publicKey = pair.publicKey;
    this.privateKey = pair.privateKey;
  }

  async sign(message: Uint8Array) {
    return new Uint8Array(createSign("SHA256").update(message).sign(this.privateKey));
  }

  async publicKeyPem() {
    return this.publicKey.export({ type: "spki", format: "pem" }).toString();
  }
}

export class FakeCalendar implements CalendarReader {
  entries = new Map<string, CalendarEntry[]>();
  error: Error | null = null;
  calls: Array<{ calendarId: string; from: string; to: string; timeZone: string }> = [];
  async listEntries(calendarId: string, from: string, to: string, timeZone: string) {
    this.calls.push({ calendarId, from, to, timeZone });
    if (this.error) throw this.error;
    return this.entries.get(calendarId) ?? [];
  }
}

/**
 * Inserted events land in `calendar` (when given) as entries, so a following
 * sync sees them like Google would.
 */
export class FakeCalendarWriter implements CalendarWriter {
  inserted: Array<{ calendarId: string; event: NewCalendarEvent; id: string }> = [];
  updated: Array<{ calendarId: string; eventId: string; event: NewCalendarEvent }> = [];
  moved: Array<{ calendarId: string; eventId: string; destinationId: string }> = [];
  deleted: Array<{ calendarId: string; eventId: string }> = [];
  /** Events getEvent can find, by `<calendar id>/<event id>`. */
  stored = new Map<string, StoredCalendarEvent>();
  error: Error | null = null;
  constructor(private readonly calendar?: FakeCalendar) {}

  /** Puts an event on a calendar, for getEvent and the next sync. */
  seed(calendarId: string, event: StoredCalendarEvent) {
    this.stored.set(`${calendarId}/${event.id}`, event);
    const { seriesId: _s, durationMinutes: _d, ...entry } = event;
    const entries = this.calendar?.entries.get(calendarId) ?? [];
    this.calendar?.entries.set(calendarId, [...entries.filter((e) => e.id !== event.id), entry]);
  }

  async getEvent(calendarId: string, eventId: string, _timeZone: string) {
    if (this.error) throw this.error;
    return this.stored.get(`${calendarId}/${eventId}`) ?? null;
  }

  async updateEvent(calendarId: string, eventId: string, event: NewCalendarEvent) {
    if (this.error) throw this.error;
    const old = this.stored.get(`${calendarId}/${eventId}`);
    if (!old) throw new CalendarRefusedError(`no ${eventId} on ${calendarId}`);
    this.updated.push({ calendarId, eventId, event });
    const start = { date: event.date, time: event.time };
    this.seed(calendarId, {
      ...old,
      title: event.title,
      description: event.description,
      start,
      end: event.time === null ? { date: addDays(event.date, event.days ?? 1), time: null } : start,
      allDay: event.time === null,
    });
  }

  async moveEvent(calendarId: string, eventId: string, destinationId: string) {
    if (this.error) throw this.error;
    const old = this.stored.get(`${calendarId}/${eventId}`);
    if (!old) throw new CalendarRefusedError(`no ${eventId} on ${calendarId}`);
    this.moved.push({ calendarId, eventId, destinationId });
    this.stored.delete(`${calendarId}/${eventId}`);
    const entries = this.calendar?.entries.get(calendarId) ?? [];
    this.calendar?.entries.set(
      calendarId,
      entries.filter((e) => e.id !== eventId),
    );
    this.seed(destinationId, old);
  }

  async deleteEvent(calendarId: string, eventId: string) {
    if (this.error) throw this.error;
    this.deleted.push({ calendarId, eventId });
    // An occurrence goes, or a whole series with every occurrence.
    const gone = (id: string, seriesId: string | null) => id === eventId || seriesId === eventId;
    for (const [key, event] of this.stored) {
      if (key.startsWith(`${calendarId}/`) && gone(event.id, event.seriesId))
        this.stored.delete(key);
    }
    const entries = this.calendar?.entries.get(calendarId) ?? [];
    this.calendar?.entries.set(
      calendarId,
      entries.filter((e) => e.id !== eventId && !e.id.startsWith(`${eventId}_`)),
    );
  }

  async insertEvent(calendarId: string, event: NewCalendarEvent) {
    if (this.error) throw this.error;
    const id = `new${this.inserted.length + 1}`;
    this.inserted.push({ calendarId, event, id });
    const start = { date: event.date, time: event.time };
    const entries = this.calendar?.entries.get(calendarId) ?? [];
    this.calendar?.entries.set(calendarId, [
      ...entries,
      {
        id,
        title: event.title,
        description: event.description,
        start,
        end: event.time === null ? { date: event.date, time: null } : start,
        allDay: event.time === null,
      },
    ]);
    return id;
  }
}

export class MemoryIncidents implements IncidentStore {
  items: FrameIncident[] = [];
  async put(incident: FrameIncident) {
    this.items.push(incident);
  }
  async list() {
    return [...this.items].sort((a, b) =>
      `${b.receivedAt}#${b.id}`.localeCompare(`${a.receivedAt}#${a.id}`),
    );
  }
}

export class MemoryWatch implements FrameWatchStore {
  offline: Record<string, string> = {};
  puts = 0;
  async get() {
    return { ...this.offline };
  }
  async put(offline: Record<string, string>) {
    this.offline = { ...offline };
    this.puts++;
  }
}

export class FakeNotifier implements Notifier {
  sent: Array<{ subject: string; body: string }> = [];
  error: Error | null = null;
  async send(subject: string, body: string) {
    if (this.error) throw this.error;
    this.sent.push({ subject, body });
  }
}

export class MemoryCounters implements CounterStore {
  counts = new Map<string, { n: number; expiresAt: Date }>();
  async increment(key: string, expiresAt: Date) {
    const current = this.counts.get(key);
    const next = { n: (current?.n ?? 0) + 1, expiresAt: current?.expiresAt ?? expiresAt };
    this.counts.set(key, next);
    return next.n;
  }
}

/**
 * Drive folders in memory: items listed newest first, file bytes by source id.
 * `items` is what any folder not in `folders` holds.
 */
export class FakeMedia implements MediaFolderReader {
  items: MediaItem[] = [];
  folders = new Map<string, MediaItem[]>();
  files = new Map<string, MediaFile>();
  listError: Error | null = null;
  failing = new Set<string>();
  listed: string[] = [];
  downloads: string[] = [];
  async list(folderId: string, limit: number) {
    this.listed.push(folderId);
    if (this.listError) throw this.listError;
    if (this.failing.has(folderId)) throw new Error(`folder ${folderId} unavailable`);
    return (this.folders.get(folderId) ?? this.items).slice(0, limit);
  }
  async download(item: MediaItem) {
    this.downloads.push(item.sourceId);
    const file = this.files.get(item.sourceId);
    if (!file) throw new Error(`no file ${item.sourceId}`);
    return file;
  }
  async downloadTo(item: MediaItem, path: string) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, (await this.download(item)).bytes);
  }
}

/** Video conversion records in memory, keyed `${sourceId}#${version}`. */
export class MemoryConversions implements VideoConversionStore {
  records = new Map<string, VideoConversion>();
  async getConversion(sourceId: string, version: string) {
    return this.records.get(`${sourceId}#${version}`) ?? null;
  }
  async putConversion(sourceId: string, version: string, conversion: VideoConversion) {
    this.records.set(`${sourceId}#${version}`, structuredClone(conversion));
  }
}

/** The converter function's queue: records what was started; `error` makes it refuse. */
export class FakeVideoQueue implements VideoConversionQueue {
  started: MediaItem[] = [];
  error: Error | null = null;
  async start(item: MediaItem) {
    if (this.error) throw this.error;
    this.started.push(item);
  }
}

/** Converts to the bytes set for the source id; throws for any other. */
export class FakeVideoConverter implements VideoConverter {
  outputs = new Map<string, Uint8Array>();
  async convert(item: MediaItem) {
    const out = this.outputs.get(item.sourceId);
    if (!out) throw new Error(`cannot convert ${item.sourceId}`);
    return out;
  }
}

export class FakeWeather implements WeatherReader {
  value: Weather = {
    high: 52,
    low: 41,
    rainChance: 80,
    code: 61,
    current: null,
    sunrise: null,
    sunset: null,
  };
  error: Error | null = null;
  async forecast() {
    if (this.error) throw this.error;
    return this.value;
  }
}

export class FakeTrivia implements TriviaReader {
  /** Questions handed out, in order; each call takes the next `count`. */
  pool: TriviaQuestion[] = Array.from({ length: 30 }, (_, i) => ({
    id: `q${i}`,
    category: "Science",
    question: `Question ${i}?`,
    answers: ["Yes", "No", "Maybe"],
    correct: 0,
  }));
  error: Error | null = null;
  async questions(count: number) {
    if (this.error) throw this.error;
    return this.pool.slice(0, count);
  }
}

export class FakeHistory implements HistoryReader {
  events: HistoryEvent[] = [{ year: 2011, text: "Minecraft left beta.", image: null }];
  error: Error | null = null;
  async onThisDay() {
    if (this.error) throw this.error;
    return this.events;
  }
}

export class FakePlaces implements PlaceReader {
  lists = new Map<PlaceKind, PlaceCandidate[]>(
    PLACE_KINDS.map((kind) => [
      kind,
      [1, 2, 3].map((i) => ({
        id: `${kind}${i}`,
        kind,
        name: `${kind} ${i}`,
        title: `${kind}_${i}`,
        map: `${kind}${i}.svg`,
        population: 1000 * i,
        areaKm2: null,
        capital: null,
        country: null,
      })),
    ]),
  );
  error: Error | null = null;
  listed: PlaceKind[] = [];
  async candidates(kind: PlaceKind) {
    if (this.error) throw this.error;
    this.listed.push(kind);
    return this.lists.get(kind) ?? [];
  }
  async describe(place: PlaceCandidate) {
    return {
      kind: place.kind,
      name: place.name,
      where: null,
      map: null,
      facts: [{ label: "People", value: String(place.population) }],
      blurb: `About ${place.name}.`,
    };
  }
}

export class MemoryLogger implements Logger {
  lines: Array<{ level: string; message: string; fields?: Record<string, unknown> }> = [];
  info(message: string, fields?: Record<string, unknown>) {
    this.lines.push({ level: "info", message, fields });
  }
  warn(message: string, fields?: Record<string, unknown>) {
    this.lines.push({ level: "warn", message, fields });
  }
  error(message: string, fields?: Record<string, unknown>) {
    this.lines.push({ level: "error", message, fields });
  }
}

/** A frame's stored record, as DeviceService.register would write it. */
export function deviceRecord(overrides: Partial<DeviceRecord> = {}): DeviceRecord {
  return {
    id: "0123456789abcdef",
    name: "Kitchen",
    role: "device",
    secretHash: "0".repeat(64),
    createdAt: "2026-11-01T00:00:00.000Z",
    lastSeenAt: null,
    revokedAt: null,
    settings: { slideshowFolderId: null, greetingName: null },
    appVersion: null,
    appVersionAt: null,
    ...overrides,
  };
}

export const FAMILY: Settings = {
  timezone: "America/New_York",
  location: { name: "Home", latitude: 40.7, longitude: -74 },
  kids: [
    { id: "maya", name: "Maya", color: "pink", calendarId: "maya@cal", photo: null },
    { id: "theo", name: "Theo", color: "blue", calendarId: null, photo: null },
  ],
  sharedCalendarIds: ["family@cal"],
  sleep: null,
  slideshowFolderId: null,
};

/** A full set of services over in-memory fakes. */
export function fakeWorld(settings: Settings | null = structuredClone(FAMILY)) {
  const calendar = new FakeCalendar();
  const world = {
    clock: new FakeClock(),
    settings: new MemorySettings(settings),
    chores: new MemoryChores(),
    notes: new MemoryNotes(),
    snapshots: new MemorySnapshots(),
    completions: new MemoryCompletions(),
    devices: new MemoryDevices(),
    photos: new MemoryPhotos(),
    signer: new LocalSigner(),
    calendar,
    calendarWriter: new FakeCalendarWriter(calendar),
    counters: new MemoryCounters(),
    incidents: new MemoryIncidents(),
    watch: new MemoryWatch(),
    notifier: new FakeNotifier(),
    weather: new FakeWeather(),
    trivia: new FakeTrivia(),
    history: new FakeHistory(),
    places: new FakePlaces(),
    random: () => 0,
    media: new FakeMedia(),
    conversions: new MemoryConversions(),
    videos: new FakeVideoQueue(),
    converter: new FakeVideoConverter(),
    logger: new MemoryLogger(),
    clients: new MemoryOAuthClients(),
    tokens: new FakeTokenVerifier(),
    directory: new MemoryDirectory(),
  };
  const sync = new SyncService(world);
  const devices = new DeviceService(world);
  const services: Services = {
    bundle: new BundleService(world),
    family: new FamilyService(world),
    photos: new PhotoService(world),
    devices,
    app: new AppService(world),
    completions: new CompletionService(world),
    chores: new ChoreService(world),
    events: new EventService({ ...world, sync }),
    incidents: new IncidentService(world),
    oauth: new OAuthService({ ...world, config: OAUTH }),
    sync,
    videos: new VideoConvertService(world),
    watch: new WatchService(world),
    signer: world.signer,
    logger: world.logger,
  };
  return { ...world, services };
}

export const OAUTH = {
  loginBaseUrl: "https://kids.auth.example",
  scope: "https://api.example/mcp/dashboard",
  userPoolId: "us-east-1_TestPool1",
  group: "dashboard",
};

/** Cognito's app clients, in memory. */
export class MemoryOAuthClients implements OAuthClientRegistry {
  clients: (OAuthClient & { redirectUris: string[] })[] = [];
  async list() {
    return this.clients.map(({ clientId, name }) => ({ clientId, name }));
  }
  async create(name: string, redirectUris: string[]) {
    const client = { clientId: `client-${this.clients.length + 1}`, name, redirectUris };
    this.clients.push(client);
    return { clientId: client.clientId, name };
  }
}

/** The sign-in pool's accounts: one made by an admin for parent@example.com. */
export class MemoryDirectory implements SignInDirectory {
  accounts = new Map([["parent-1", { email: "parent@example.com", links: [] as string[] }]]);
  async findByEmail(_pool: string, email: string) {
    for (const [username, a] of this.accounts) if (a.email === email) return username;
    return null;
  }
  async linkGoogle(_pool: string, username: string, subject: string) {
    this.accounts.get(username)?.links.push(subject);
  }
  /** Groups by `sub`; "parent" has the dashboard role. */
  groups = new Map<string, string[]>([["parent", ["dashboard"]]]);
  lookups = 0;
  async groupsOf(_pool: string, sub: string) {
    this.lookups++;
    return this.groups.get(sub) ?? null;
  }
}

/** Accepts "jwt.<subject>.sig" as a valid access token for `subject`. */
export class FakeTokenVerifier implements AccessTokenVerifier {
  async verify(token: string) {
    const [, subject, sig] = token.split(".");
    return sig === "sig" && subject ? { subject } : null;
  }
}
