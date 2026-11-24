import { ChoreId, type CredentialRole, FrameEventId, KidId, Sha256Hex } from "@kids-dash/core";
import type { APIGatewayProxyEventV2WithLambdaAuthorizer } from "aws-lambda";
import { ForbiddenError } from "../services/errors";
import {
  body,
  empty,
  errorResult,
  type HttpResult,
  json,
  param,
  type RouteHandler,
  router,
} from "./http";
import type { DeviceRoute } from "./routes";
import { lazyServices, type Services } from "./wiring";

export type DeviceEvent = APIGatewayProxyEventV2WithLambdaAuthorizer<{
  deviceId: string;
  role: CredentialRole;
}>;

/** Routes a frame calls with its device token (checked by the authorizer). */
export function deviceRoutes(
  s: Pick<
    Services,
    | "bundle"
    | "completions"
    | "chores"
    | "events"
    | "photos"
    | "devices"
    | "app"
    | "incidents"
    | "logger"
  >,
): Record<DeviceRoute, RouteHandler<DeviceEvent>> {
  return {
    "GET /v1/bundle": async (event) => {
      const deviceId = event.requestContext.authorizer.lambda.deviceId;
      const version = frameVersion(event.headers["x-frame-version"]);
      if (version !== null) {
        // Health reporting only: never worth failing the frame's poll over.
        await s.devices.reportVersion(deviceId, version).catch((error: unknown) => {
          s.logger.warn("version report failed", { deviceId, error: String(error) });
        });
      }
      const result = await s.bundle.signed(deviceId, event.headers["if-none-match"]);
      if (result.status === "not-modified") return empty(304, { etag: result.etag });
      return json(200, result.envelope, { etag: result.etag });
    },

    "PUT /v1/chores/{kidId}/{choreId}": async (event) => {
      await s.completions.set(
        param(event, "kidId", KidId),
        param(event, "choreId", ChoreId),
        body(event),
      );
      return empty(204);
    },

    "POST /v1/chores": async (event) => {
      const chore = await s.chores.addFromFrame(
        event.requestContext.authorizer.lambda.deviceId,
        body(event),
      );
      return json(201, { chore });
    },

    "POST /v1/events": async (event) => {
      const added = await s.events.addFromFrame(
        event.requestContext.authorizer.lambda.deviceId,
        body(event),
      );
      return json(201, { event: added });
    },

    "PUT /v1/events/{eventId}": async (event) => {
      const edited = await s.events.editFromFrame(
        event.requestContext.authorizer.lambda.deviceId,
        param(event, "eventId", FrameEventId),
        body(event),
      );
      return json(200, { event: edited });
    },

    "DELETE /v1/events/{eventId}": async (event) => {
      await s.events.deleteFromFrame(
        event.requestContext.authorizer.lambda.deviceId,
        param(event, "eventId", FrameEventId),
        event.queryStringParameters?.scope,
      );
      return empty(204);
    },

    "GET /v1/photos/{kidId}": async (event) => {
      const url = await s.photos.photoUrl(param(event, "kidId", KidId));
      return empty(302, { location: url });
    },

    "GET /v1/slides/{sha256}": async (event) => {
      const url = await s.photos.slideUrl(
        param(event, "sha256", Sha256Hex),
        event.requestContext.authorizer.lambda.deviceId,
      );
      return empty(302, { location: url });
    },

    "GET /v1/art/{sha256}": async (event) => {
      const url = await s.app.artUrl(param(event, "sha256", Sha256Hex));
      return empty(302, { location: url });
    },

    "GET /v1/app/{sha256}": async (event) => {
      const url = await s.app.downloadUrl(param(event, "sha256", Sha256Hex));
      return empty(302, { location: url });
    },

    "POST /v1/incidents": async (event) => {
      const incident = await s.incidents.record(
        event.requestContext.authorizer.lambda.deviceId,
        body(event),
      );
      return json(201, { incident: { id: incident.id } });
    },
  };
}

/** The `X-Frame-Version` header: the app's versionCode, or null if absent or odd. */
function frameVersion(header: string | undefined): number | null {
  if (!header || !/^\d{1,9}$/.test(header.trim())) return null;
  const version = Number(header.trim());
  return version > 0 ? version : null;
}

export function createDeviceHandler(services: () => Services) {
  let handle: ((event: DeviceEvent) => Promise<HttpResult>) | undefined;
  return (event: DeviceEvent) => {
    const s = services();
    handle ??= router(deviceRoutes(s), s.logger);
    // The authorizer accepts any valid credential; only frames use these routes.
    if (event.requestContext.authorizer.lambda.role !== "device") {
      const forbidden = new ForbiddenError("Not a device credential");
      return Promise.resolve(errorResult(forbidden, s.logger, event.routeKey));
    }
    return handle(event);
  };
}

export const handler = createDeviceHandler(lazyServices);
