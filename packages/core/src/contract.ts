import { z } from "zod";
import { IsoDate, LocalTime } from "./dates";
import {
  Chore,
  ChorePeriod,
  DriveFolderId,
  Kid,
  Note,
  Owner,
  Settings,
  Sha256Hex,
  Slug,
} from "./family";
import { ChoreSticker, EventSticker } from "./stickers";

/**
 * Request bodies of the admin and device APIs. The API validates with these and
 * the MCP builds tool inputs from them, so the two cannot drift.
 */

/** Settings as an admin writes them. Photos are managed by their own route. */
export const SettingsInput = Settings.extend({
  kids: z
    .array(Kid.omit({ photo: true }))
    .max(6)
    .refine((kids) => new Set(kids.map((k) => k.id)).size === kids.length, "kid ids must be unique")
    .default([]),
});
export type SettingsInput = z.input<typeof SettingsInput>;

/** PUT /admin/chores/{kidId}/{choreId} */
export const ChoreInput = Chore.omit({ id: true, kidId: true });
export type ChoreInput = z.input<typeof ChoreInput>;

/** PUT /admin/notes/{date}/{noteId} */
export const NoteInput = Note.omit({ id: true, date: true });
export type NoteInput = z.input<typeof NoteInput>;

/** Kept small: the frame shows a kid's photo as an 84px circle. */
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

/** PUT /admin/kids/{kidId}/photo */
export const PhotoInput = z.object({
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  /** Raw image bytes, base64; the cap is exactly MAX_PHOTO_BYTES of data. */
  dataBase64: z
    .string()
    .min(1)
    .max(Math.ceil(MAX_PHOTO_BYTES / 3) * 4, "photo is over 3 MB"),
});
export type PhotoInput = z.input<typeof PhotoInput>;

/**
 * A credential's role. `device`: a frame (device API only). `agent`: an AI agent
 * using the hosted MCP endpoint (admin powers minus credential management).
 */
export const CREDENTIAL_ROLES = ["device", "agent"] as const;
export const CredentialRole = z.enum(CREDENTIAL_ROLES);
export type CredentialRole = z.infer<typeof CredentialRole>;

/** POST /admin/devices */
export const DeviceInput = z.object({
  name: z.string().trim().min(1).max(40),
  role: CredentialRole.default("device"),
});

/** Per-frame overrides of the family settings; null means "use the family's". */
export const DeviceSettings = z.object({
  slideshowFolderId: DriveFolderId.nullable().default(null),
  /** Who the greeting addresses ("Good morning, <greetingName>!"); null names the kids. */
  greetingName: z.string().trim().min(1).max(30).nullable().default(null),
});
export type DeviceSettings = z.infer<typeof DeviceSettings>;

export const DeviceSummary = z.object({
  id: z.string(),
  name: z.string(),
  role: CredentialRole,
  createdAt: z.string(),
  lastSeenAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  settings: DeviceSettings,
  /** App versionCode the frame last reported, and when. */
  appVersion: z.number().int().nullable(),
  appVersionAt: z.string().nullable(),
});

/**
 * PUT /admin/app: a new frame app build for every frame to install. Either the
 * bytes inline (small builds; the API's request limit is ~6 MB of base64) or
 * the sha256 of an APK already uploaded to the URL from POST /admin/app/upload.
 */
export const AppReleaseInput = z.union([
  z.object({
    versionCode: z.number().int().positive(),
    versionName: z.string().trim().min(1).max(60),
    dataBase64: z.string().min(1),
  }),
  z.object({
    versionCode: z.number().int().positive(),
    versionName: z.string().trim().min(1).max(60),
    sha256: Sha256Hex,
  }),
]);
export type AppReleaseInput = z.infer<typeof AppReleaseInput>;

/** POST /admin/app/upload: where to PUT an APK with this hash (straight to storage). */
export const AppUploadInput = z.object({ sha256: Sha256Hex });
export type AppUploadInput = z.infer<typeof AppUploadInput>;
/**
 * POST /admin/art/upload: the content hashes of the backdrop paintings a
 * build downloads (see AppService.artUploads); the answer has upload URLs for
 * the ones storage does not have yet.
 */
export const ArtUploadInput = z.object({ sha256s: z.array(Sha256Hex).min(1).max(1000) });
export type ArtUploadInput = z.infer<typeof ArtUploadInput>;
export type DeviceSummary = z.infer<typeof DeviceSummary>;

/**
 * POST /v1/events from the frame: someone added an event on the week screen.
 * It is written to the owner's Kids Google Calendar (Everyone: the first
 * shared calendar). A null time means all day; timed events last an hour.
 * A sticker is only sent when someone picked one by hand.
 */
export const FrameEventInput = z.object({
  owner: Owner,
  title: z.string().trim().min(1).max(80),
  date: IsoDate,
  time: LocalTime.nullable().default(null),
  sticker: EventSticker.nullable().default(null),
  /**
   * What the kids see: the first line is the note on the item, the rest the
   * details shown when it is tapped (the calendar conventions' top part).
   */
  description: z.string().max(600).default(""),
});
export type FrameEventInput = z.infer<typeof FrameEventInput>;

/**
 * PUT /v1/events/{eventId} from the frame: someone edited a calendar event.
 * Same fields as an add, plus `from`, the day the event was opened on (a
 * multi-day event moves by date − from days and keeps its length), and `scope`. A
 * null sticker keeps the event's own; the description replaces only the
 * kid-facing part, keeping directives and parents-only lines.
 */
/**
 * For an occurrence of a repeating event: "one" is that day only, "all" the
 * whole series. Ignored for an event that doesn't repeat.
 */
export const FrameEventScope = z.enum(["one", "all"]);
export type FrameEventScope = z.infer<typeof FrameEventScope>;

export const FrameEventEdit = FrameEventInput.extend({
  from: IsoDate,
  /**
   * For an occurrence of a repeating event: "one" changes that day only,
   * "all" the whole series (title, time, sticker, description; not the day,
   * whose it is, or all day vs timed).
   */
  scope: FrameEventScope.default("one"),
});
export type FrameEventEdit = z.infer<typeof FrameEventEdit>;

/** An event the frame can edit: one from Google, as its bundle id (`g-<google id>`). */
export const FrameEventId = z
  .string()
  .regex(/^g-[A-Za-z0-9_-]{1,250}$/, "a Google event id from the bundle");

/**
 * POST /v1/chores from the frame: someone added a chore on the Chores screen.
 * The server picks the id (from the title) and puts it after the kid's other
 * chores. `days` as in Chore: 0 = Sunday, empty means every day.
 */
export const FrameChoreInput = z.object({
  kidId: Slug,
  title: z.string().trim().min(1).max(40),
  period: ChorePeriod,
  days: z
    .array(z.number().int().min(0).max(6))
    .max(7)
    .refine((days) => new Set(days).size === days.length, "days must be unique")
    .default([]),
  sticker: ChoreSticker.default("star"),
});
export type FrameChoreInput = z.infer<typeof FrameChoreInput>;

/** PUT /v1/chores/{kidId}/{choreId} from the frame. */
export const ChoreCompletionInput = z.object({
  date: IsoDate,
  done: z.boolean(),
});
export type ChoreCompletionInput = z.infer<typeof ChoreCompletionInput>;

/**
 * How the frame's Wi-Fi looked when it first could not reach the API:
 * associated with a network, not associated, not associated with every scan
 * empty (the chip itself has gone quiet), or not readable.
 */
export const INCIDENT_WIFI_STATES = [
  "connected",
  "disconnected",
  "no-networks",
  "unknown",
] as const;
/** Whether the frame restarted during the outage: not at all, by its own watchdog, or otherwise (power). */
export const INCIDENT_REBOOTS = ["none", "watchdog", "other"] as const;
/** The longest log excerpt a frame may attach to a report. */
export const MAX_INCIDENT_LOG = 60_000;

/** POST /v1/incidents: a frame reporting a stretch when it could not reach the API. */
export const FrameIncidentInput = z
  .object({
    /** The last successful poll before the outage. */
    since: z.iso.datetime(),
    /** The first successful poll after it. */
    until: z.iso.datetime(),
    wifi: z.enum(INCIDENT_WIFI_STATES),
    /** The screen was dark (sleep hours or the power button) when the outage began. */
    asleep: z.boolean(),
    reboot: z.enum(INCIDENT_REBOOTS),
    /** The app build that saw it go down. */
    appVersion: z.number().int().positive(),
    /** System log lines about the network, captured before a watchdog reboot. */
    log: z.string().max(MAX_INCIDENT_LOG).nullable().default(null),
  })
  .refine((i) => Date.parse(i.since) <= Date.parse(i.until), "since must not be after until");
export type FrameIncidentInput = z.infer<typeof FrameIncidentInput>;

/** A stored report, as the admin API lists it (newest first). */
export const FrameIncident = z.object({
  id: z.string(),
  deviceId: z.string(),
  deviceName: z.string(),
  receivedAt: z.string(),
  since: z.string(),
  until: z.string(),
  /** Whole minutes from since to until. */
  minutes: z.number().int().nonnegative(),
  wifi: z.enum(INCIDENT_WIFI_STATES),
  asleep: z.boolean(),
  reboot: z.enum(INCIDENT_REBOOTS),
  appVersion: z.number().int().positive(),
  log: z.string().nullable(),
});
export type FrameIncident = z.infer<typeof FrameIncident>;

/** Path parameters shared by both APIs. */
export const KidId = Slug;
export const ChoreId = Slug;
export const NoteId = Slug;

/**
 * POST /oauth/register (RFC 7591 dynamic client registration), as MCP clients
 * such as Claude send it. Only the redirect URIs matter; other metadata is
 * accepted and the response states what was actually registered.
 */
export const OAuthClientRegistration = z.looseObject({
  redirect_uris: z.array(z.url()).min(1).max(5),
  client_name: z.string().max(200).optional(),
});
export type OAuthClientRegistration = z.infer<typeof OAuthClientRegistration>;
