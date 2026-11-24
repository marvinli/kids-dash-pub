import { createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { CognitoTokenVerifier } from "./cognito-token-verifier";

const POOL = "us-east-1_TestPool1";
const SCOPE = "https://api.example/mcp/dashboard";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
function token(claims: Record<string, unknown>, kid = "k1"): string {
  const now = Math.floor(Date.now() / 1000);
  const head = `${b64({ alg: "RS256", kid })}.${b64({
    iss: `https://cognito-idp.us-east-1.amazonaws.com/${POOL}`,
    token_use: "access",
    client_id: "client-1",
    scope: `openid ${SCOPE}`,
    sub: "sub-1",
    username: "parent",
    "cognito:groups": ["dashboard"],
    iat: now,
    exp: now + 3600,
    ...claims,
  })}`;
  const sig = createSign("RSA-SHA256").update(head).sign(privateKey).toString("base64url");
  return `${head}.${sig}`;
}

describe("CognitoTokenVerifier", () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const verifier = new CognitoTokenVerifier(POOL, SCOPE, logger, {
    keys: [jwk as never],
  });

  it("accepts the pool's access tokens that carry the MCP scope", async () => {
    expect(await verifier.verify(token({}))).toEqual({ subject: "sub-1" });
  });

  it("leaves the role to the service: linked Google sign-ins carry no groups claim", async () => {
    // What Cognito issued for a linked Google sign-in bound to the MCP resource.
    expect(await verifier.verify(token({ "cognito:groups": undefined }))).toEqual({
      subject: "sub-1",
    });
  });

  it("refuses expired, mis-scoped, ID, foreign and tampered tokens", async () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    for (const bad of [
      token({ exp: past }),
      token({ scope: "openid" }),
      token({ token_use: "id" }),
      token({ iss: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Other" }),
      `${token({}).slice(0, -4)}AAAA`,
      "not.a.jwt",
    ]) {
      expect(await verifier.verify(bad)).toBeNull();
    }
  });

  it("logs why a token was refused, with its claims but never the token", async () => {
    logger.warn.mockClear();
    const bad = token({ scope: "openid" });
    expect(await verifier.verify(bad)).toBeNull();
    const [message, fields] = logger.warn.mock.calls[0] ?? [];
    expect(message).toBe("access token refused");
    expect(fields.reason).toMatch(/scope/i);
    expect(fields.claims).toMatchObject({ kid: "k1", scope: "openid", token_use: "access" });
    expect(JSON.stringify(fields)).not.toContain(bad.split(".")[2]);
    logger.warn.mockClear();
    await verifier.verify("not.a.jwt");
    expect(logger.warn.mock.calls[0]?.[1].claims).toBeNull();
  });
});
