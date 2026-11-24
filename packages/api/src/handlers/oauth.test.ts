import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { fakeWorld } from "../../test/fakes";
import { createOAuthHandler } from "./oauth";

function setup() {
  const w = fakeWorld();
  const handle = createOAuthHandler(() => w.services);
  const call = async (routeKey: string, body?: unknown) => {
    const result = await handle({
      routeKey,
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      isBase64Encoded: false,
      requestContext: { domainName: "api.example" },
    } as unknown as APIGatewayProxyEventV2);
    return { status: result.statusCode, body: JSON.parse(String(result.body)) };
  };
  return { w, call };
}

describe("OAuth routes", () => {
  it("serves discovery metadata at the well-known paths", async () => {
    const { call } = setup();
    for (const path of ["oauth-protected-resource", "oauth-protected-resource/mcp"]) {
      const r = await call(`GET /.well-known/${path}`);
      expect(r).toMatchObject({ status: 200, body: { resource: "https://api.example/mcp" } });
    }
    for (const path of ["oauth-authorization-server", "openid-configuration"]) {
      const r = await call(`GET /.well-known/${path}`);
      expect(r.body.registration_endpoint).toBe("https://api.example/oauth/register");
    }
  });

  it("registers clients, with RFC 7591 errors", async () => {
    const { call } = setup();
    const ok = await call("POST /oauth/register", {
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
    });
    expect(ok).toMatchObject({ status: 201, body: { client_id: "client-1" } });
    const evil = await call("POST /oauth/register", { redirect_uris: ["https://evil.example/cb"] });
    expect(evil).toMatchObject({ status: 400, body: { error: "invalid_redirect_uri" } });
    const bad = await call("POST /oauth/register", "{not json");
    expect(bad).toMatchObject({
      status: 400,
      body: {
        error: "invalid_client_metadata",
        error_description: "Request body is not valid JSON",
      },
    });
    const missing = await call("POST /oauth/register", {});
    expect(missing.body.error).toBe("invalid_client_metadata");
  });
});
