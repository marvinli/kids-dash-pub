import type {
  CalendarEntry,
  Chore,
  CredentialRole,
  DeviceSettings,
  FrameIncident,
  HistoryEvent,
  IsoDate,
  Location,
  Note,
  Place,
  PlaceKind,
  PlannedEvent,
  Settings,
  SlideKind,
  TriviaQuestion,
  Weather,
} from "@kids-dash/core";

/**
 * What services need from the outside world. Services depend only on these;
 * adapters/ implements them, handlers/wiring.ts plugs one into the other, and
 * tests substitute in-memory fakes (test/fakes.ts).
 */

export interface Clock {
  now(): Date;
}

export interface SettingsStore {
  get(): Promise<Settings | null>;
  put(settings: Settings): Promise<void>;
}

export interface ChoreStore {
  list(): Promise<Chore[]>;
  put(chore: Chore): Promise<void>;
  delete(kidId: string, choreId: string): Promise<boolean>;
}

export interface NoteStore {
  listBetween(from: IsoDate, to: IsoDate): Promise<Note[]>;
  put(note: Note): Promise<void>;
  delete(date: IsoDate, noteId: string): Promise<boolean>;
}

export interface CalendarSnapshot {
  events: PlannedEvent[];
  syncedAt: string;
}

export interface WeatherSnapshot {
  date: IsoDate;
  weather: Weather;
  syncedAt: string;
}

/** Today's "on this day" events and place, and the places shown before (newest first). */
export interface TodaySnapshot {
  date: IsoDate;
  history: HistoryEvent[];
  place: Place | null;
  placesSeen: string[];
  syncedAt: string;
}

/** One place the day's place can be: what Wikidata knows, kept a month per kind. */
export interface PlaceCandidate {
  /** Wikidata id, "Q99". */
  id: string;
  kind: PlaceKind;
  name: string;
  /** Its English Wikipedia article. */
  title: string;
  /** Commons file name of its locator map. */
  map: string;
  population: number | null;
  areaKm2: number | null;
  capital: string | null;
  country: string | null;
}

export interface PlacesSnapshot {
  candidates: PlaceCandidate[];
  fetchedAt: string;
}

/** Today's trivia, and the ids already asked (newest first) so none repeats. */
export interface TriviaSnapshot {
  date: IsoDate;
  questions: TriviaQuestion[];
  seen: string[];
  syncedAt: string;
}

/** One slideshow file as stored for the frame. */
export interface SlideRecord {
  /** Where it came from, and which version of it (re-fetched when this changes). */
  sourceId: string;
  version: string;
  sha256: string;
  kind: SlideKind;
  /** Object key in the photo store. */
  key: string;
  contentType: string;
  /** A video converted for the frame (1080p H.264 MP4); other videos get converted again. */
  converted?: boolean;
}

export interface SlidesSnapshot {
  /** Newest first. */
  slides: SlideRecord[];
  syncedAt: string;
}

/** The frame app build every frame should run. */
export interface AppReleaseRecord {
  versionCode: number;
  versionName: string;
  sha256: string;
  /** Object key of the APK in the photo store. */
  key: string;
  publishedAt: string;
}

export interface SnapshotStore {
  getCalendar(): Promise<CalendarSnapshot | null>;
  putCalendar(snapshot: CalendarSnapshot): Promise<void>;
  getWeather(): Promise<WeatherSnapshot | null>;
  putWeather(snapshot: WeatherSnapshot): Promise<void>;
  getTrivia(): Promise<TriviaSnapshot | null>;
  putTrivia(snapshot: TriviaSnapshot): Promise<void>;
  getToday(): Promise<TodaySnapshot | null>;
  putToday(snapshot: TodaySnapshot): Promise<void>;
  getPlaces(kind: PlaceKind): Promise<PlacesSnapshot | null>;
  putPlaces(kind: PlaceKind, snapshot: PlacesSnapshot): Promise<void>;
  /** The mirrored contents of one Drive folder. */
  getSlides(folderId: string): Promise<SlidesSnapshot | null>;
  putSlides(folderId: string, snapshot: SlidesSnapshot): Promise<void>;
  deleteSlides(folderId: string): Promise<void>;
  /** The folders the last sync mirrored, so one that falls out of use is cleaned up. */
  getSlidesIndex(): Promise<string[] | null>;
  putSlidesIndex(folderIds: string[]): Promise<void>;
  /** The single pre-per-folder snapshot (the family folder's); read until migrated. */
  getLegacySlides(): Promise<SlidesSnapshot | null>;
  deleteLegacySlides(): Promise<void>;
  getApp(): Promise<AppReleaseRecord | null>;
  putApp(release: AppReleaseRecord): Promise<void>;
}

export interface CompletionStore {
  /** Keys `${kidId}/${choreId}` done on `date`. */
  listDone(date: IsoDate): Promise<Set<string>>;
  set(date: IsoDate, kidId: string, choreId: string, done: boolean): Promise<void>;
}

export interface DeviceRecord {
  id: string;
  name: string;
  role: CredentialRole;
  /** sha256 hex of the token secret; the secret itself is never stored. */
  secretHash: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  settings: DeviceSettings;
  /** The app versionCode the frame last reported, and when that changed. */
  appVersion: number | null;
  appVersionAt: string | null;
}

export interface DeviceStore {
  get(id: string): Promise<DeviceRecord | null>;
  list(): Promise<DeviceRecord[]>;
  put(device: DeviceRecord): Promise<void>;
}

/** Outage reports frames send once they are back online. */
export interface IncidentStore {
  put(incident: FrameIncident): Promise<void>;
  /** Every stored report, newest first (they expire after a while). */
  list(): Promise<FrameIncident[]>;
}

/**
 * The frames the watch has emailed about as offline: device id → the
 * lastSeenAt it went quiet after. A frame leaves it once it is back.
 */
export interface FrameWatchStore {
  get(): Promise<Record<string, string>>;
  put(offline: Record<string, string>): Promise<void>;
}

/** Sends a short message to the family (email, through an SNS topic). */
export interface Notifier {
  send(subject: string, body: string): Promise<void>;
}

export interface PhotoStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** A short-lived GET URL. */
  presign(key: string, ttlSeconds: number): Promise<string>;
  /**
   * A short-lived URL that accepts a PUT of `contentType` bytes to `key`; the
   * store refuses bytes whose sha256 (hex) is not `sha256`.
   */
  presignPut(key: string, contentType: string, sha256: string, ttlSeconds: number): Promise<string>;
  /** The object's bytes, or null when there is none. */
  get(key: string): Promise<Uint8Array | null>;
  /** Whether there is an object at `key`. */
  exists(key: string): Promise<boolean>;
}

export interface Signer {
  readonly keyId: string;
  /** ECDSA P-256 signature (DER) over sha256(message). */
  sign(message: Uint8Array): Promise<Uint8Array>;
  publicKeyPem(): Promise<string>;
}

/** Google refused a write: the calendar is not one the service account may change. */
export class CalendarRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarRefusedError";
  }
}

export class GoogleNotConfiguredError extends Error {
  constructor() {
    super("Google credentials are not configured");
    this.name = "GoogleNotConfiguredError";
  }
}

export interface CalendarReader {
  /**
   * Events overlapping [from, to) in `timeZone`, normalized to that zone.
   * Throws GoogleNotConfiguredError when there are no credentials.
   */
  listEntries(
    calendarId: string,
    from: IsoDate,
    to: IsoDate,
    timeZone: string,
  ): Promise<CalendarEntry[]>;
}

/** One event to add to a Google calendar. */
export interface NewCalendarEvent {
  title: string;
  description: string;
  date: IsoDate;
  /** Wall-clock start in `timeZone`; null for an all-day event on `date`. */
  time: string | null;
  durationMinutes: number;
  /** Days an all-day event covers (default 1); ignored for timed events. */
  days?: number;
  /** IANA zone the date and time are in. */
  timeZone: string;
}

/** An event read back from Google before an edit. */
export interface StoredCalendarEvent extends CalendarEntry {
  /** For an occurrence of a repeating event, the series' id; else null. */
  seriesId: string | null;
  /** Exact length of a timed event (DST-safe); null when all day. */
  durationMinutes: number | null;
}

export interface CalendarWriter {
  /**
   * Inserts the event and returns Google's event id.
   * Throws GoogleNotConfiguredError when there are no credentials.
   */
  insertEvent(calendarId: string, event: NewCalendarEvent): Promise<string>;
  /** The event in `timeZone`, or null when it is not on that calendar (or was deleted). */
  getEvent(
    calendarId: string,
    eventId: string,
    timeZone: string,
  ): Promise<StoredCalendarEvent | null>;
  /**
   * Rewrites the title, description and times. Throws CalendarRefusedError
   * when Google refuses the write.
   */
  updateEvent(calendarId: string, eventId: string, event: NewCalendarEvent): Promise<void>;
  /** Moves the event to another calendar, keeping its id. Throws CalendarRefusedError when refused. */
  moveEvent(calendarId: string, eventId: string, destinationId: string): Promise<void>;
  /**
   * Deletes the event; an occurrence's id cancels just that day. Already gone
   * counts as done. Throws CalendarRefusedError when refused.
   */
  deleteEvent(calendarId: string, eventId: string): Promise<void>;
}

/** Fixed-window counters (e.g. events a frame added this hour). */
export interface CounterStore {
  /** Adds one to `key` and returns the new count; the counter expires at `expiresAt`. */
  increment(key: string, expiresAt: Date): Promise<number>;
}

/** A photo or video in the slideshow folder, as listed (not yet downloaded). */
export interface MediaItem {
  sourceId: string;
  /** Changes whenever the file's content does. */
  version: string;
  kind: SlideKind;
  /** Bytes of the original; videos over the limit are skipped before download. */
  sizeBytes: number | null;
  durationMs: number | null;
}

export interface MediaFile {
  bytes: Uint8Array;
  contentType: string;
}

export interface MediaFolderReader {
  /**
   * Photos and videos in the folder, newest first, at most `limit`.
   * Throws GoogleNotConfiguredError when there are no credentials.
   */
  list(folderId: string, limit: number): Promise<MediaItem[]>;
  /** Photos come back sized for the frame (≤1920×1080 JPEG); videos as uploaded. */
  download(item: MediaItem): Promise<MediaFile>;
  /** Streams a video as uploaded to a local file (originals can be hundreds of MB). */
  downloadTo(item: MediaItem, path: string): Promise<void>;
}

/**
 * A slideshow video's conversion for the frame, per source file and version:
 * pending while the converter runs, then done (the converted file) or failed.
 */
export interface VideoConversion {
  state: "pending" | "done" | "failed";
  /** When the latest attempt started, or when it finished. */
  at: string;
  /** Attempts so far for this version. */
  attempts: number;
  /** The converted file, once done. */
  sha256?: string;
  key?: string;
  error?: string;
}

export interface VideoConversionStore {
  getConversion(sourceId: string, version: string): Promise<VideoConversion | null>;
  putConversion(sourceId: string, version: string, conversion: VideoConversion): Promise<void>;
}

/** Hands a video to the converter, which runs in the background (minutes). */
export interface VideoConversionQueue {
  start(item: MediaItem): Promise<void>;
}

/** Downloads a video and converts it for the frame: muted, ≤1080p, SDR H.264 MP4. */
export interface VideoConverter {
  convert(item: MediaItem): Promise<Uint8Array>;
}

export interface WeatherReader {
  forecast(location: Location, timeZone: string, date: IsoDate): Promise<Weather>;
}

export interface HistoryReader {
  /** A few kid-suitable things that happened on this month and day. */
  onThisDay(date: IsoDate): Promise<HistoryEvent[]>;
}

export interface PlaceReader {
  /** Every place of a kind that has a locator map. */
  candidates(kind: PlaceKind): Promise<PlaceCandidate[]>;
  /** Its map, facts and a few sentences about it. */
  describe(place: PlaceCandidate): Promise<Place>;
}

export interface TriviaReader {
  /** Up to `count` fresh, kid-suitable questions, answers in the order to show them. */
  questions(count: number): Promise<TriviaQuestion[]>;
}

export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/** Checks an OAuth access token's signature, expiry and scope. */
export interface AccessTokenVerifier {
  /** Who holds the token (its `sub`), or null when it is not a valid one. */
  verify(token: string): Promise<{ subject: string } | null>;
}

/** An OAuth client (an app that may send people to sign in), as the identity provider holds it. */
export interface OAuthClient {
  clientId: string;
  name: string;
}

/** The OAuth clients registered with the identity provider. */
export interface OAuthClientRegistry {
  list(): Promise<OAuthClient[]>;
  /** A public client (no secret, PKCE) for the authorization-code flow. */
  create(name: string, redirectUris: string[]): Promise<OAuthClient>;
}

/** The sign-in pool's accounts, as the pre-sign-up check needs them. */
export interface SignInDirectory {
  /** The username of the account an admin made for this email, or null. */
  findByEmail(userPoolId: string, email: string): Promise<string | null>;
  /** From now on, this Google identity signs in as that account. */
  linkGoogle(userPoolId: string, username: string, googleSubject: string): Promise<void>;
  /**
   * The groups (roles) of the account whose `sub` this is, or null when there
   * is no such account. Access tokens from a linked Google sign-in carry no
   * `cognito:groups` claim, so the role is looked up rather than read from them.
   */
  groupsOf(userPoolId: string, sub: string): Promise<string[] | null>;
}
