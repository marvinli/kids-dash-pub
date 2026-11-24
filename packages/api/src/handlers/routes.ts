/**
 * Every route each API serves, as API Gateway route keys. The routers are typed
 * against these lists (a missing handler is a compile error) and infra creates
 * exactly these routes, so the two cannot drift. Dependency-free on purpose:
 * infra imports this file.
 */
export const DEVICE_ROUTES = [
  "GET /v1/bundle",
  "PUT /v1/chores/{kidId}/{choreId}",
  "POST /v1/chores",
  "POST /v1/events",
  "PUT /v1/events/{eventId}",
  "DELETE /v1/events/{eventId}",
  "GET /v1/photos/{kidId}",
  "GET /v1/slides/{sha256}",
  "GET /v1/app/{sha256}",
  "GET /v1/art/{sha256}",
  "POST /v1/incidents",
] as const;

export const ADMIN_ROUTES = [
  "GET /admin/settings",
  "PUT /admin/settings",
  "GET /admin/chores",
  "PUT /admin/chores/{kidId}/{choreId}",
  "DELETE /admin/chores/{kidId}/{choreId}",
  "GET /admin/notes",
  "PUT /admin/notes/{date}/{noteId}",
  "DELETE /admin/notes/{date}/{noteId}",
  "GET /admin/events",
  "PUT /admin/kids/{kidId}/photo",
  "DELETE /admin/kids/{kidId}/photo",
  "GET /admin/devices",
  "POST /admin/devices",
  "DELETE /admin/devices/{deviceId}",
  "PUT /admin/devices/{deviceId}/settings",
  "GET /admin/incidents",
  "GET /admin/incidents/{incidentId}",
  "GET /admin/app",
  "PUT /admin/app",
  "POST /admin/app/upload",
  "POST /admin/art/upload",
  "POST /admin/sync",
  "GET /admin/bundle",
  "GET /admin/signing-key",
] as const;

/**
 * The hosted MCP endpoint (Streamable HTTP, stateless). Only POST carries
 * messages; GET and DELETE exist so they answer 405 as the spec asks rather
 * than API Gateway's 404.
 */
export const MCP_ROUTES = ["POST /mcp", "GET /mcp", "DELETE /mcp"] as const;

/**
 * OAuth for the hosted MCP (see OAuthService): discovery metadata and dynamic
 * client registration. Public by design; sign-in itself is Cognito's.
 */
export const OAUTH_ROUTES = [
  "GET /.well-known/oauth-protected-resource",
  "GET /.well-known/oauth-protected-resource/mcp",
  "GET /.well-known/oauth-authorization-server",
  "GET /.well-known/openid-configuration",
  "POST /oauth/register",
] as const;

export type DeviceRoute = (typeof DEVICE_ROUTES)[number];
export type AdminRoute = (typeof ADMIN_ROUTES)[number];
