import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { InvalidRedirectError } from "../services/oauth-service";
import { body, errorResult, type HttpResult, json, router } from "./http";
import type { OAUTH_ROUTES } from "./routes";
import { lazyServices, type Services } from "./wiring";

type OAuthRoute = (typeof OAUTH_ROUTES)[number];

/** The API's own origin, as the client reached it. */
export function origin(event: APIGatewayProxyEventV2): string {
  return `https://${event.requestContext.domainName}`;
}

export function oauthRoutes(
  s: Services,
): Record<OAuthRoute, (e: APIGatewayProxyEventV2) => Promise<HttpResult>> {
  const resource = async (e: APIGatewayProxyEventV2) =>
    json(200, s.oauth.protectedResource(origin(e)));
  const server = async (e: APIGatewayProxyEventV2) =>
    json(200, s.oauth.authorizationServer(origin(e)));
  return {
    "GET /.well-known/oauth-protected-resource": resource,
    "GET /.well-known/oauth-protected-resource/mcp": resource,
    "GET /.well-known/oauth-authorization-server": server,
    "GET /.well-known/openid-configuration": server,
    "POST /oauth/register": async (e) => {
      try {
        return json(201, await s.oauth.register(body(e)));
      } catch (error) {
        // RFC 7591 error bodies for what a client can fix.
        if (error instanceof InvalidRedirectError) {
          return json(400, { error: "invalid_redirect_uri", error_description: error.message });
        }
        const result = errorResult(error, s.logger, e.routeKey);
        if (result.statusCode !== 400) return result;
        return json(400, {
          error: "invalid_client_metadata",
          error_description: JSON.parse(String(result.body)).message ?? "Invalid client metadata",
        });
      }
    },
  };
}

export function createOAuthHandler(services: () => Services) {
  return (event: APIGatewayProxyEventV2) => {
    const s = services();
    return router(oauthRoutes(s), s.logger)(event);
  };
}

export const handler = createOAuthHandler(lazyServices);
