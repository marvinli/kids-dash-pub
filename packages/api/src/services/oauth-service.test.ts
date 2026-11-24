import { describe, expect, it } from "vitest";
import { FakeTokenVerifier, fakeWorld, MemoryOAuthClients, OAUTH } from "../../test/fakes";
import { InvalidRequestError, NotConfiguredError } from "./errors";
import { InvalidRedirectError, MAX_CLIENTS, OAuthService, ROLE_CACHE_MS } from "./oauth-service";

const CLAUDE = "https://claude.ai/api/mcp/auth_callback";

describe("OAuthService", () => {
  it("describes the MCP resource and points sign-in at the hosted login", () => {
    const { services } = fakeWorld();
    expect(services.oauth.protectedResource("https://api.example")).toEqual({
      resource: "https://api.example/mcp",
      authorization_servers: ["https://api.example"],
      scopes_supported: [OAUTH.scope],
      bearer_methods_supported: ["header"],
      resource_name: "Kids dashboard",
    });
    expect(services.oauth.authorizationServer("https://api.example")).toMatchObject({
      issuer: "https://api.example",
      authorization_endpoint: "https://kids.auth.example/oauth2/authorize",
      token_endpoint: "https://kids.auth.example/oauth2/token",
      registration_endpoint: "https://api.example/oauth/register",
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  });

  it("registers one public client per set of redirect URIs", async () => {
    const w = fakeWorld();
    const first = await w.services.oauth.register({
      redirect_uris: [CLAUDE, CLAUDE],
      client_name: "Claude",
      token_endpoint_auth_method: "client_secret_post",
    });
    expect(first).toEqual({
      client_id: "client-1",
      client_id_issued_at: Date.parse("2026-11-16T12:42:00Z") / 1000,
      client_name: "Claude",
      redirect_uris: [CLAUDE],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
    expect(w.clients.clients[0]?.redirectUris).toEqual([CLAUDE]);
    const again = await w.services.oauth.register({ redirect_uris: [CLAUDE] });
    expect(again.client_id).toBe("client-1");
    const local = await w.services.oauth.register({
      redirect_uris: [
        "http://localhost:33418/callback",
        "https://claude.com/api/mcp/auth_callback",
      ],
    });
    expect(local.client_id).toBe("client-2");
    expect(local.client_name).toMatch(/^mcp-[0-9a-f]{16}$/);
  });

  it("refuses other redirect URIs, bad metadata and too many clients", async () => {
    const w = fakeWorld();
    for (const uri of [
      "https://evil.example/callback",
      "https://claude.ai.evil.example/api/mcp/auth_callback",
      "http://claude.ai/api/mcp/auth_callback",
      "http://127.0.0.1:8080/callback",
    ]) {
      await expect(w.services.oauth.register({ redirect_uris: [uri] })).rejects.toBeInstanceOf(
        InvalidRedirectError,
      );
    }
    await expect(w.services.oauth.register({})).rejects.toBeInstanceOf(InvalidRequestError);
    await expect(
      w.services.oauth.register({ redirect_uris: ["not a url"] }),
    ).rejects.toBeInstanceOf(InvalidRequestError);
    for (let i = 0; i < MAX_CLIENTS; i++) await w.clients.create(`mcp-${i}`, [CLAUDE]);
    await w.clients.create("hand-made", [CLAUDE]);
    await expect(
      w.services.oauth.register({ redirect_uris: ["http://localhost:1/cb"] }),
    ).rejects.toThrow(/Too many/);
    expect(w.clients.clients).toHaveLength(MAX_CLIENTS + 1);
  });

  it("authenticates sign-ins as agents and nothing else", async () => {
    const w = fakeWorld();
    expect(await w.services.oauth.authenticate("Bearer jwt.parent.sig")).toEqual({
      id: "oauth:parent",
      role: "agent",
    });
    expect(await w.services.oauth.authenticate("Bearer jwt.parent.bad")).toBeNull();
    // A valid sign-in without the role, or with no account behind it.
    w.directory.groups.set("guest", ["other"]);
    expect(await w.services.oauth.authenticate("Bearer jwt.guest.sig")).toBeNull();
    expect(await w.services.oauth.authenticate("Bearer jwt.ghost.sig")).toBeNull();
    expect(await w.services.oauth.authenticate(undefined)).toBeNull();
    const { token } = await w.services.devices.register({ name: "Duet", role: "agent" });
    expect(await w.services.oauth.authenticate(`Bearer ${token}`)).toBeNull();
  });

  it("remembers an account's role for a few minutes", async () => {
    const w = fakeWorld();
    const ask = () => w.services.oauth.authenticate("Bearer jwt.parent.sig");
    expect(await ask()).not.toBeNull();
    w.directory.groups.set("parent", []);
    expect(await ask()).not.toBeNull();
    expect(w.directory.lookups).toBe(1);
    w.clock.current = new Date(w.clock.current.getTime() + ROLE_CACHE_MS);
    expect(await ask()).toBeNull();
    expect(w.directory.lookups).toBe(2);
  });

  it("lets a Google sign-in through only for an account an admin made, and links it", async () => {
    const w = fakeWorld();
    const join = (over: Partial<Parameters<typeof w.services.oauth.mayJoin>[0]>) =>
      w.services.oauth.mayJoin({
        userPoolId: "pool",
        trigger: "PreSignUp_ExternalProvider",
        userName: "Google_1234",
        email: "Parent@Example.com ",
        emailVerified: "true",
        ...over,
      });
    expect(await join({ emailVerified: "false" })).toBe(false);
    expect(await join({ email: undefined })).toBe(false);
    expect(await join({ userName: "Facebook_1" })).toBe(false);
    expect(await join({ email: "stranger@example.com" })).toBe(false);
    expect(w.directory.accounts.get("parent-1")?.links).toEqual([]);
    expect(await join({})).toBe(true);
    expect(w.directory.accounts.get("parent-1")?.links).toEqual(["1234"]);
    // Admins make accounts; nobody signs themselves up.
    expect(await join({ trigger: "PreSignUp_AdminCreateUser" })).toBe(true);
    expect(await join({ trigger: "PreSignUp_SignUp" })).toBe(false);
  });

  it("is off until the stack provides a user pool", async () => {
    const w = fakeWorld();
    const off = new OAuthService({
      ...w,
      config: null,
      clients: new MemoryOAuthClients(),
      tokens: new FakeTokenVerifier(),
    });
    expect(() => off.protectedResource("https://api.example")).toThrow(NotConfiguredError);
    expect(() => off.authorizationServer("https://api.example")).toThrow(NotConfiguredError);
    await expect(off.register({ redirect_uris: [CLAUDE] })).rejects.toBeInstanceOf(
      NotConfiguredError,
    );
    expect(await off.authenticate("Bearer jwt.parent.sig")).toBeNull();
  });
});
