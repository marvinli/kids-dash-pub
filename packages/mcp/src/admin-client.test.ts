import { describe, expect, it, vi } from "vitest";
import { AdminApiError, AdminClient, clientFromEnv, regionFromApiUrl } from "./admin-client";

const credentials = async () => ({ accessKeyId: "AKIDEXAMPLE", secretAccessKey: "secret" });

function client(response: Response) {
  const fetchFn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => response);
  return {
    fetchFn,
    client: new AdminClient({
      baseUrl: "https://abc.execute-api.us-east-1.amazonaws.com",
      region: "us-east-1",
      credentials,
      fetchFn,
    }),
  };
}

describe("AdminClient", () => {
  it("signs requests for execute-api with SigV4 and sends JSON", async () => {
    const { client: c, fetchFn } = client(new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    const result = await c.request("PUT", "/admin/chores/maya/bed", { body: { title: "Bed" } });
    expect(result).toEqual({ ok: 1 });

    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "https://abc.execute-api.us-east-1.amazonaws.com/admin/chores/maya/bed",
    );
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/us-east-1\/execute-api\/aws4_request, SignedHeaders=.*host.*, Signature=[0-9a-f]{64}$/,
    );
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["x-amz-content-sha256"] ?? headers["x-amz-date"]).toBeDefined();
    expect(init?.body).toBe('{"title":"Bed"}');
  });

  it("puts defined query parameters in both the URL and the signature", async () => {
    const { client: c, fetchFn } = client(new Response("{}", { status: 200 }));
    await c.request("GET", "/admin/chores", { query: { kidId: "maya", skip: undefined } });
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(new URL(String(url)).search).toBe("?kidId=maya");
    expect(init?.body).toBeUndefined();
  });

  it("returns undefined for empty bodies and raises API errors with their body", async () => {
    expect(
      await client(new Response(null, { status: 204 })).client.request("DELETE", "/x"),
    ).toBeUndefined();

    const failing = client(new Response('{"error":"not_found"}', { status: 404 })).client;
    const error = await failing.request("GET", "/x").catch((e) => e);
    expect(error).toBeInstanceOf(AdminApiError);
    expect(error).toMatchObject({ status: 404, body: { error: "not_found" } });

    const html = client(new Response("<html>bad gateway</html>", { status: 502 })).client;
    await expect(html.request("GET", "/x")).rejects.toMatchObject({
      body: "<html>bad gateway</html>",
    });
  });
});

describe("configuration", () => {
  it("reads the region from an API Gateway URL", () => {
    expect(regionFromApiUrl("https://abc.execute-api.eu-west-2.amazonaws.com")).toBe("eu-west-2");
    expect(regionFromApiUrl("https://example.com")).toBeNull();
  });

  it("builds a client from the environment and requires the URL", () => {
    expect(() => clientFromEnv({})).toThrow(/KIDS_DASH_API_URL/);
    expect(
      clientFromEnv({ KIDS_DASH_API_URL: "https://abc.execute-api.us-west-2.amazonaws.com" }),
    ).toBeInstanceOf(AdminClient);
    expect(
      clientFromEnv({ KIDS_DASH_API_URL: "https://example.com", AWS_REGION: "eu-west-1" }),
    ).toBeInstanceOf(AdminClient);
    expect(clientFromEnv({ KIDS_DASH_API_URL: "https://example.com" })).toBeInstanceOf(AdminClient);
  });
});
