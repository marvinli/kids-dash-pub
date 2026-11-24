import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import {
  ChoreId,
  ChoreInput,
  DeviceInput,
  DeviceSettings,
  IsoDate,
  KidId,
  NoteId,
  NoteInput,
  SettingsInput,
} from "@kids-dash/core";
import { z } from "zod";
import { AdminApiError, type AdminTransport } from "./transport";

export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface Tool<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  inputSchema: S;
  /**
   * Only offered by the local stdio server: it reads local files, or manages
   * credentials, which a remote agent must not be able to mint for itself.
   */
  localOnly?: boolean;
  run(client: AdminTransport, input: z.infer<z.ZodObject<S>>): Promise<unknown>;
}

const tool = <S extends z.ZodRawShape>(t: Tool<S>): Tool => t as unknown as Tool;

const PHOTO_TYPES: Record<string, "image/jpeg" | "image/png" | "image/webp"> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const enc = encodeURIComponent;

/**
 * Every tool: a thin, validated mapping onto one admin API call. Business rules
 * (unknown kids, date windows, photo checks) live in the API, so an agent gets
 * the same answers a direct API caller would.
 */
export const TOOLS: Tool[] = [
  tool({
    name: "get_settings",
    title: "Get family settings",
    description:
      "Read the dashboard's settings: timezone, weather location, kids (id, name, color, Google calendar id, photo), shared calendar ids and the screen's sleep window.",
    inputSchema: {},
    run: (c) => c.request("GET", "/admin/settings"),
  }),
  tool({
    name: "update_settings",
    title: "Replace family settings",
    description:
      "Replace the settings. Send the complete object (read it first with get_settings). Kids keep their photos; removing a kid deletes their photo. kid.calendarId and sharedCalendarIds are Google calendar ids the service account can read. sleep {start, end} (HH:MM local, may cross midnight) turns the frame's screen off; null keeps it on. slideshowFolderId is a Google Drive folder id (shared with the service account) whose photos and videos the frame plays after 30 idle minutes; null turns the slideshow off.",
    inputSchema: SettingsInput.shape,
    run: (c, input) => c.request("PUT", "/admin/settings", { body: input }),
  }),

  tool({
    name: "list_chores",
    title: "List chores",
    description: "List chores, optionally for one kid.",
    inputSchema: { kidId: KidId.optional() },
    run: (c, { kidId }) => c.request("GET", "/admin/chores", { query: { kidId } }),
  }),
  tool({
    name: "set_chore",
    title: "Add or update a chore",
    description:
      "Create or replace a kid's chore. choreId is a lowercase slug you choose (e.g. make-bed). period: morning | afterSchool | evening. days: weekdays it applies to (0=Sunday), empty for every day. sticker: bed, teeth, dress, bag, fish, toys, table, plants or star.",
    inputSchema: { kidId: KidId, choreId: ChoreId, ...ChoreInput.shape },
    run: (c, { kidId, choreId, ...chore }) =>
      c.request("PUT", `/admin/chores/${enc(kidId)}/${enc(choreId)}`, { body: chore }),
  }),
  tool({
    name: "delete_chore",
    title: "Delete a chore",
    description: "Delete a kid's chore.",
    inputSchema: { kidId: KidId, choreId: ChoreId },
    run: (c, { kidId, choreId }) =>
      c.request("DELETE", `/admin/chores/${enc(kidId)}/${enc(choreId)}`),
  }),

  tool({
    name: "list_notes",
    title: "List notes",
    description: "List dated notes between two dates (inclusive, YYYY-MM-DD).",
    inputSchema: { from: IsoDate, to: IsoDate },
    run: (c, query) => c.request("GET", "/admin/notes", { query }),
  }),
  tool({
    name: "set_note",
    title: "Add or update a note",
    description:
      'Show a short note on a date ("Library book goes back today"). owner is {kind:"kid",kidId} for one kid\'s column or {kind:"everyone"}. noteId is a slug you choose. Max 80 characters.',
    inputSchema: { date: IsoDate, noteId: NoteId, ...NoteInput.shape },
    run: (c, { date, noteId, ...note }) =>
      c.request("PUT", `/admin/notes/${enc(date)}/${enc(noteId)}`, { body: note }),
  }),
  tool({
    name: "delete_note",
    title: "Delete a note",
    description: "Delete a note.",
    inputSchema: { date: IsoDate, noteId: NoteId },
    run: (c, { date, noteId }) => c.request("DELETE", `/admin/notes/${enc(date)}/${enc(noteId)}`),
  }),

  tool({
    name: "list_events",
    title: "List events",
    description:
      "List the events showing between two dates, as synced from Google Calendar (every 15 minutes). Events are added, changed and deleted in Google Calendar, never here.",
    inputSchema: { from: IsoDate, to: IsoDate },
    run: (c, query) => c.request("GET", "/admin/events", { query }),
  }),

  tool({
    name: "set_kid_photo",
    localOnly: true,
    title: "Set a kid's photo",
    description:
      "Upload a local JPEG, PNG or WebP (max 3 MB; it shows as a small circle) as a kid's portrait. Photos are stored privately.",
    inputSchema: { kidId: KidId, path: z.string().min(1).describe("Absolute path to the image") },
    run: async (c, { kidId, path }) => {
      const contentType = PHOTO_TYPES[extname(path).toLowerCase()];
      if (!contentType) throw new Error("Photo must be .jpg, .jpeg, .png or .webp");
      const dataBase64 = (await readFile(path)).toString("base64");
      return c.request("PUT", `/admin/kids/${enc(kidId)}/photo`, {
        body: { contentType, dataBase64 },
      });
    },
  }),
  tool({
    name: "delete_kid_photo",
    localOnly: true,
    title: "Remove a kid's photo",
    description: "Remove a kid's portrait.",
    inputSchema: { kidId: KidId },
    run: (c, { kidId }) => c.request("DELETE", `/admin/kids/${enc(kidId)}/photo`),
  }),

  tool({
    name: "list_devices",
    localOnly: true,
    title: "List devices",
    description:
      "List frames (and agent credentials) registered to read the dashboard: id, name, role, createdAt, lastSeenAt (last authenticated poll, ~10 minute resolution), revokedAt, settings (the frame's own overrides; slideshowFolderId null means it plays the family folder), appVersion (frame app versionCode it last reported) and appVersionAt (when that changed).",
    inputSchema: {},
    run: (c) => c.request("GET", "/admin/devices"),
  }),
  tool({
    name: "set_device_settings",
    localOnly: true,
    title: "Set a frame's own settings",
    description:
      'Replace one frame\'s settings. slideshowFolderId: a Google Drive folder id (shared with the service account) whose photos and videos this frame plays instead of the family\'s slideshow folder; null means "use the family folder" (from update_settings). A new folder\'s slides appear after the next sync (sync_now to hurry it). greetingName: who this frame greets ("Good morning, Nana!"); null greets the kids by name. Send every field: omitted ones reset to null.',
    inputSchema: { deviceId: z.string().regex(/^[0-9a-f]{16}$/), ...DeviceSettings.shape },
    run: (c, { deviceId, ...settings }) =>
      c.request("PUT", `/admin/devices/${enc(deviceId)}/settings`, { body: settings }),
  }),
  tool({
    name: "register_device",
    localOnly: true,
    title: "Register a device",
    description:
      "Create credentials for a new frame. The token is shown once; install it on the frame and do not store it elsewhere.",
    inputSchema: DeviceInput.shape,
    run: (c, input) => c.request("POST", "/admin/devices", { body: input }),
  }),
  tool({
    name: "revoke_device",
    localOnly: true,
    title: "Revoke a device",
    description: "Revoke a frame's credentials (takes effect within 5 minutes).",
    inputSchema: { deviceId: z.string().regex(/^[0-9a-f]{16}$/) },
    run: (c, { deviceId }) => c.request("DELETE", `/admin/devices/${enc(deviceId)}`),
  }),

  tool({
    name: "list_incidents",
    localOnly: true,
    title: "List frame outages",
    description:
      "Outages frames reported once they were back online, newest first (kept 90 days): deviceId, deviceName, since (last good poll), until (first good poll after), minutes, wifi (connected: the network was up but the API unreachable; disconnected: not on Wi-Fi; no-networks: not on Wi-Fi and every scan empty, the frame's Wi-Fi chip going quiet; unknown), asleep (screen dark at the time), reboot (none, watchdog: the frame restarted itself to get its Wi-Fi back, other: someone power-cycled it), appVersion, logChars (size of the attached system log; read it with get_incident).",
    inputSchema: {
      deviceId: z
        .string()
        .regex(/^[0-9a-f]{16}$/)
        .optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    run: (c, { deviceId, limit }) =>
      c.request("GET", "/admin/incidents", {
        query: { deviceId, limit: limit === undefined ? undefined : String(limit) },
      }),
  }),
  tool({
    name: "get_incident",
    localOnly: true,
    title: "Read a frame outage",
    description:
      "One outage report from list_incidents with its log: the frame's system log lines about Wi-Fi and the network, captured just before a watchdog reboot (null otherwise).",
    inputSchema: { incidentId: z.string().regex(/^[0-9a-f]{16}$/) },
    run: (c, { incidentId }) => c.request("GET", `/admin/incidents/${enc(incidentId)}`),
  }),

  tool({
    name: "sync_now",
    title: "Sync now",
    description:
      "Refresh Google Calendar and weather now instead of waiting for the 15-minute sync.",
    inputSchema: {},
    run: (c) => c.request("POST", "/admin/sync"),
  }),
  tool({
    name: "preview_dashboard",
    title: "Preview the dashboard",
    description: "The exact data the frame shows right now (today, each kid's day, chores, week).",
    inputSchema: {},
    run: (c) => c.request("GET", "/admin/bundle"),
  }),
];

/** The tools a server offers: everything locally, the safe subset remotely. */
export function toolsFor(mode: "local" | "remote"): Tool[] {
  return mode === "local" ? TOOLS : TOOLS.filter((t) => !t.localOnly);
}

/** Validates input, calls the API, and shapes the answer (or error) for MCP. */
export async function runTool(
  tool: Tool,
  client: AdminTransport,
  input: unknown,
): Promise<ToolResult> {
  try {
    const parsed = z.object(tool.inputSchema).parse(input ?? {});
    const result = await tool.run(client, parsed);
    return { content: [{ type: "text", text: JSON.stringify(result ?? { ok: true }, null, 2) }] };
  } catch (error) {
    const message =
      error instanceof AdminApiError
        ? `The dashboard API rejected this (${error.status}): ${JSON.stringify(error.body)}`
        : error instanceof z.ZodError
          ? `Invalid input: ${error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
          : String(error instanceof Error ? error.message : error);
    return { content: [{ type: "text", text: message }], isError: true };
  }
}
