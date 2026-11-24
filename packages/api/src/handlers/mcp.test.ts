import { AdminApiError } from "@kids-dash/mcp/transport";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import { fakeWorld } from "../../test/fakes";
import { adminRoutes } from "./admin";
import { router } from "./http";
import { InProcessAdmin, matchRoute } from "./in-process-admin";
import { createMcpHandler, type McpEvent } from "./mcp";

/** Turns a fetch from the MCP client into an API Gateway event for the handler. */
function bridge(handle: ReturnType<typeof createMcpHandler>, token: string | null = SIGNED_IN) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const event = {
      version: "2.0",
      routeKey: `${request.method} ${url.pathname}`,
      rawPath: url.pathname,
      rawQueryString: "",
      headers: {
        ...Object.fromEntries(request.headers),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: request.method === "POST" ? await request.text() : undefined,
      isBase64Encoded: false,
      requestContext: {
        domainName: url.host,
        http: { method: request.method, path: url.pathname },
      },
    } as unknown as McpEvent;
    const result = await handle(event);
    return new Response(result.body ?? null, {
      status: result.statusCode,
      headers: result.headers as Record<string, string>,
    });
  };
}

/** An OAuth access token the fake verifier accepts (see FakeTokenVerifier). */
const SIGNED_IN = "jwt.parent.sig";

async function connect(token: string | null = SIGNED_IN) {
  const w = fakeWorld();
  const handle = createMcpHandler(() => w.services);
  const client = new Client({ name: "test-agent", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("https://api.example/mcp"), {
      fetch: bridge(handle, token),
    }),
  );
  return { w, client, handle };
}

describe("hosted MCP", () => {
  it("offers the remote tool set and runs tools against the real services", async () => {
    const { w, client } = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("list_events");
    expect(names).not.toContain("set_event");
    expect(names).not.toContain("delete_event");
    expect(names).not.toContain("register_device");
    expect(names).not.toContain("set_kid_photo");

    const added = await client.callTool({
      name: "set_note",
      arguments: {
        date: "2026-11-16",
        noteId: "book",
        owner: { kind: "kid", kidId: "maya" },
        text: "Library book goes back",
      },
    });
    expect(added.isError).toBeFalsy();
    expect(w.notes.items.size).toBe(1);

    const preview = await client.callTool({ name: "preview_dashboard", arguments: {} });
    const text = (preview.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text).toContain("Library book goes back");
    await client.close();
  });

  it("returns the API's validation errors to the agent", async () => {
    const { client } = await connect();
    const result = await client.callTool({
      name: "set_note",
      arguments: {
        date: "2026-11-16",
        noteId: "x",
        owner: { kind: "kid", kidId: "sam" },
        text: "Hi",
      },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("Unknown kid sam");
    await client.close();
  });

  it("asks for a sign-in and accepts only signed-in callers", async () => {
    const w = fakeWorld();
    const handle = createMcpHandler(() => w.services);
    const post = (token: string | null) =>
      bridge(handle, token)("https://api.example/mcp", { method: "POST", body: "{}" });
    const { token: deviceToken } = await w.services.devices.register({
      name: "Kitchen",
      role: "device",
    });
    const { token: agentToken } = await w.services.devices.register({
      name: "Duet",
      role: "agent",
    });
    for (const token of [null, "jwt.parent.forged", "nope", deviceToken, agentToken]) {
      const anonymous = await post(token);
      expect(anonymous.status).toBe(401);
      expect(anonymous.headers.get("www-authenticate")).toBe(
        'Bearer resource_metadata="https://api.example/.well-known/oauth-protected-resource/mcp"',
      );
    }
    const agent = new Client({ name: "agent", version: "1" });
    await agent.connect(
      new StreamableHTTPClientTransport(new URL("https://api.example/mcp"), {
        fetch: bridge(handle, "jwt.parent.sig"),
      }),
    );
    expect((await agent.listTools()).tools.length).toBeGreaterThan(5);
    await agent.close();
    const get = await bridge(handle)("https://api.example/mcp", { method: "GET" });
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
  });

  it("decodes base64 bodies", async () => {
    const w = fakeWorld();
    const handle = createMcpHandler(() => w.services);
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const result = await handle({
      version: "2.0",
      routeKey: "POST /mcp",
      rawPath: "/mcp",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${SIGNED_IN}`,
      },
      body: Buffer.from(body).toString("base64"),
      isBase64Encoded: true,
      requestContext: {
        http: { method: "POST", path: "/mcp" },
      },
    } as unknown as McpEvent);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(String(result.body)).result.tools.length).toBeGreaterThan(5);
  });
});

describe("InProcessAdmin", () => {
  it("matches concrete paths to admin routes", () => {
    expect(matchRoute("PUT", "/admin/chores/maya/make-bed")).toEqual({
      routeKey: "PUT /admin/chores/{kidId}/{choreId}",
      pathParameters: { kidId: "maya", choreId: "make-bed" },
    });
    expect(matchRoute("GET", "/admin/settings")?.routeKey).toBe("GET /admin/settings");
    expect(matchRoute("PATCH", "/admin/settings")).toBeNull();
    expect(matchRoute("GET", "/admin/nope")).toBeNull();
  });

  it("passes queries and bodies through and raises API errors", async () => {
    const w = fakeWorld();
    const admin = new InProcessAdmin(router(adminRoutes(w.services), w.logger), "agent-1");
    await admin.request("PUT", "/admin/chores/maya/bed", { body: { title: "Make bed" } });
    const listed = await admin.request<{ chores: unknown[] }>("GET", "/admin/chores", {
      query: { kidId: "maya", other: undefined },
    });
    expect(listed.chores).toHaveLength(1);
    expect(await admin.request("DELETE", "/admin/chores/maya/bed")).toBeUndefined();
    await expect(admin.request("DELETE", "/admin/chores/maya/bed")).rejects.toBeInstanceOf(
      AdminApiError,
    );
    await expect(admin.request("GET", "/admin/unknown")).rejects.toMatchObject({ status: 404 });
    await expect(
      admin.request("POST", "/admin/devices", { body: { name: "x", role: "agent" } }),
    ).rejects.toMatchObject({ status: 403 });
    expect(w.devices.items.size).toBe(0);
    // Frames' settings and the app every frame installs stay with people.
    await expect(
      admin.request("PUT", "/admin/devices/0123456789abcdef/settings", { body: {} }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(admin.request("PUT", "/admin/app", { body: {} })).rejects.toMatchObject({
      status: 403,
    });
    await expect(admin.request("GET", "/admin/app")).rejects.toMatchObject({ status: 403 });
  });
});
