import { createMcpServer } from "@kids-dash/mcp/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { adminRoutes } from "./admin";
import { type HttpResult, json, router } from "./http";
import { InProcessAdmin } from "./in-process-admin";
import { origin } from "./oauth";
import { lazyServices, type Services } from "./wiring";

export type McpEvent = APIGatewayProxyEventV2;

/**
 * The hosted MCP endpoint: Streamable HTTP in stateless JSON mode, so every
 * POST is self-contained and any Lambda instance can answer it. Callers
 * authenticate here rather than in an API Gateway authorizer, so a missing or
 * bad credential gets the MCP spec's 401 pointing at the OAuth metadata. Only
 * OAuth access tokens from a sign-in (Claude's connectors) are accepted; they
 * act as agents and get the remote tool set, which cannot mint credentials.
 */
export function createMcpHandler(services: () => Services) {
  return async (event: McpEvent): Promise<HttpResult> => {
    const s = services();
    const caller = await s.oauth.authenticate(event.headers?.authorization);
    if (!caller) {
      const header = event.headers?.authorization;
      s.logger.info("mcp unauthorized", {
        credential: !header
          ? "none"
          : /^Bearer\s+[\w-]+\.[\w-]+\.[\w-]+$/i.test(header)
            ? "jwt"
            : "other",
        method: event.requestContext.http.method,
      });
      const metadata = `${origin(event)}/.well-known/oauth-protected-resource/mcp`;
      return json(
        401,
        { error: "unauthorized", message: "Sign in to use the dashboard MCP" },
        { "www-authenticate": `Bearer resource_metadata="${metadata}"` },
      );
    }
    const deviceId = caller.id;
    const method = event.requestContext.http.method;
    if (method !== "POST") {
      return json(
        405,
        { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null },
        { allow: "POST" },
      );
    }

    const admin = new InProcessAdmin(router(adminRoutes(s), s.logger), deviceId);
    const server = createMcpServer(admin, "remote");
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      const response = await transport.handleRequest(toRequest(event));
      s.logger.info("mcp request", { agent: deviceId, status: response.status });
      return {
        statusCode: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text(),
      };
    } finally {
      await server.close();
    }
  };
}

function toRequest(event: McpEvent): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(event.headers)) {
    if (value !== undefined) headers.set(name, value);
  }
  const body =
    event.body === undefined
      ? undefined
      : event.isBase64Encoded
        ? Buffer.from(event.body, "base64").toString("utf8")
        : event.body;
  return new Request(`https://${event.requestContext.domainName ?? "mcp.local"}${event.rawPath}`, {
    method: event.requestContext.http.method,
    headers,
    body,
  });
}

export const handler = createMcpHandler(lazyServices);
