import {
  ChoreId,
  ChoreInput,
  IsoDate,
  KidId,
  NoteId,
  NoteInput,
  PhotoInput,
} from "@kids-dash/core";
import type { APIGatewayProxyEventV2WithIAMAuthorizer } from "aws-lambda";
import { z } from "zod";
import {
  body,
  empty,
  type HttpResult,
  json,
  param,
  query,
  type RouteHandler,
  router,
} from "./http";
import type { AdminRoute } from "./routes";
import { lazyServices, type Services } from "./wiring";

export type AdminEvent = APIGatewayProxyEventV2WithIAMAuthorizer;

const DeviceId = z.string().regex(/^[0-9a-f]{16}$/);
const IncidentId = z.string().regex(/^[0-9a-f]{16}$/);
const Limit = z.coerce.number().int().min(1).max(100);

/** Routes for agents and people, behind IAM auth. The MCP is the main caller. */
export function adminRoutes(s: Services): Record<AdminRoute, RouteHandler<AdminEvent>> {
  return {
    "GET /admin/settings": async () => json(200, { settings: await s.family.getSettings() }),
    "PUT /admin/settings": async (e) =>
      json(200, { settings: await s.family.updateSettings(body(e)) }),

    "GET /admin/chores": async (e) =>
      json(200, { chores: await s.family.listChores(query(e, "kidId", KidId.optional())) }),
    "PUT /admin/chores/{kidId}/{choreId}": async (e) =>
      json(200, {
        chore: await s.family.putChore(
          param(e, "kidId", KidId),
          param(e, "choreId", ChoreId),
          ChoreInput.parse(body(e)),
        ),
      }),
    "DELETE /admin/chores/{kidId}/{choreId}": async (e) => {
      await s.family.deleteChore(param(e, "kidId", KidId), param(e, "choreId", ChoreId));
      return empty(204);
    },

    "GET /admin/notes": async (e) =>
      json(200, {
        notes: await s.family.listNotes(query(e, "from", IsoDate), query(e, "to", IsoDate)),
      }),
    "PUT /admin/notes/{date}/{noteId}": async (e) =>
      json(200, {
        note: await s.family.putNote(
          param(e, "date", IsoDate),
          param(e, "noteId", NoteId),
          NoteInput.parse(body(e)),
        ),
      }),
    "DELETE /admin/notes/{date}/{noteId}": async (e) => {
      await s.family.deleteNote(param(e, "date", IsoDate), param(e, "noteId", NoteId));
      return empty(204);
    },

    "GET /admin/events": async (e) =>
      json(200, {
        events: await s.family.listEvents(query(e, "from", IsoDate), query(e, "to", IsoDate)),
      }),

    "PUT /admin/kids/{kidId}/photo": async (e) =>
      json(200, {
        photo: await s.photos.setPhoto(param(e, "kidId", KidId), PhotoInput.parse(body(e))),
      }),
    "DELETE /admin/kids/{kidId}/photo": async (e) => {
      await s.photos.removePhoto(param(e, "kidId", KidId));
      return empty(204);
    },

    "GET /admin/devices": async () => json(200, { devices: await s.devices.list() }),
    "POST /admin/devices": async (e) => json(201, await s.devices.register(body(e))),
    "DELETE /admin/devices/{deviceId}": async (e) =>
      json(200, { device: await s.devices.revoke(param(e, "deviceId", DeviceId)) }),
    "PUT /admin/devices/{deviceId}/settings": async (e) =>
      json(200, {
        device: await s.devices.updateSettings(param(e, "deviceId", DeviceId), body(e)),
      }),

    "GET /admin/incidents": async (e) =>
      json(200, {
        incidents: await s.incidents.list({
          deviceId: query(e, "deviceId", DeviceId.optional()),
          limit: query(e, "limit", Limit.optional()),
        }),
      }),
    "GET /admin/incidents/{incidentId}": async (e) =>
      json(200, { incident: await s.incidents.get(param(e, "incidentId", IncidentId)) }),

    "GET /admin/app": async () => json(200, { release: await s.app.current() }),
    "PUT /admin/app": async (e) => json(200, { release: await s.app.publish(body(e)) }),
    "POST /admin/app/upload": async (e) => json(200, await s.app.uploadUrl(body(e))),
    "POST /admin/art/upload": async (e) => json(200, await s.app.artUploads(body(e))),

    "POST /admin/sync": async () => json(200, await s.sync.run()),
    "GET /admin/bundle": async (e) =>
      json(200, { bundle: await s.bundle.build(query(e, "deviceId", DeviceId.optional())) }),
    "GET /admin/signing-key": async () =>
      json(200, { keyId: s.signer.keyId, publicKeyPem: await s.signer.publicKeyPem() }),
  };
}

export function createAdminHandler(services: () => Services) {
  let handle: ((event: AdminEvent) => Promise<HttpResult>) | undefined;
  return (event: AdminEvent) => {
    const s = services();
    handle ??= router(adminRoutes(s), s.logger);
    return handle(event);
  };
}

export const handler = createAdminHandler(lazyServices);
