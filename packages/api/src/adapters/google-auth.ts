import { createSign } from "node:crypto";
import { z } from "zod";
import { GoogleNotConfiguredError } from "../services/ports";

const ServiceAccount = z.object({
  client_email: z.string().email(),
  private_key: z.string().includes("PRIVATE KEY"),
});
type ServiceAccount = z.infer<typeof ServiceAccount>;

/** Loads the service account JSON; null when the secret holds anything else. */
export type CredentialSource = () => Promise<string | null>;

const TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * Events of the calendars (read, and add from the frame: the service account
 * owns them) and, read-only, files of shared Drive folders.
 */
export const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.readonly",
];

/**
 * Access tokens for the Google service account, cached until shortly before
 * they expire. The service account JSON lives in Secrets Manager; until it is
 * put there every call throws GoogleNotConfiguredError and sync skips Google.
 */
export class GoogleAuth {
  private token?: { value: string; expiresAt: number };

  constructor(
    private readonly credentials: CredentialSource,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - 60_000 > this.now()) return this.token.value;
    const raw = await this.credentials();
    const parsed = raw ? ServiceAccount.safeParse(safeJson(raw)) : null;
    if (!parsed?.success) throw new GoogleNotConfiguredError();

    const response = await this.fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: signedAssertion(parsed.data, this.now()),
      }),
    });
    if (!response.ok) throw new Error(`Google token endpoint answered ${response.status}`);
    const body = z
      .object({ access_token: z.string(), expires_in: z.number() })
      .parse(await response.json());
    this.token = { value: body.access_token, expiresAt: this.now() + body.expires_in * 1000 };
    return body.access_token;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function signedAssertion(account: ServiceAccount, nowMs: number): string {
  const iat = Math.floor(nowMs / 1000);
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: account.client_email,
    scope: SCOPES.join(" "),
    aud: TOKEN_URL,
    iat,
    exp: iat + 3600,
  })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(account.private_key);
  return `${unsigned}.${signature.toString("base64url")}`;
}
