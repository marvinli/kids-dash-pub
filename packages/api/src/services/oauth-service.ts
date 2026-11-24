import { createHash } from "node:crypto";
import { type CredentialRole, OAuthClientRegistration } from "@kids-dash/core";
import { InvalidRequestError, NotConfiguredError } from "./errors";
import type { AccessTokenVerifier, Clock, OAuthClientRegistry, SignInDirectory } from "./ports";

/**
 * Where people sign in for the hosted MCP: a Cognito user pool's hosted login.
 * Null until the stack provides one.
 */
export interface OAuthConfig {
  /** The hosted login's base URL, e.g. https://kids-dash.auth.us-east-1.amazoncognito.com */
  loginBaseUrl: string;
  /** The scope an access token needs to use the MCP (the resource server's). */
  scope: string;
  /** The user pool people sign in to. */
  userPoolId: string;
  /** The group (role) an account needs to use the MCP. */
  group: string;
}

/** How long an account's role is trusted before it is looked up again. */
export const ROLE_CACHE_MS = 5 * 60 * 1000;

export interface OAuthServiceDeps {
  clock: Clock;
  config: OAuthConfig | null;
  clients: OAuthClientRegistry;
  tokens: AccessTokenVerifier;
  directory: SignInDirectory;
}

/** A first sign-in, as the identity provider's pre-sign-up check sees it. */
export interface Joiner {
  userPoolId: string;
  /** How the account is being made: by an admin, by sign-up, or by a Google sign-in. */
  trigger: string;
  /** For a Google sign-in, `Google_<subject>`. */
  userName: string;
  email: string | undefined;
  emailVerified: string | boolean | undefined;
}

/**
 * Redirect URIs a client may register: Claude's connector callback (claude.ai
 * and claude.com) and loopback callbacks for desktop and CLI clients. Anything
 * else is refused, so a registered client can only send sign-in codes back to
 * those places.
 */
const ALLOWED_REDIRECTS = [
  /^https:\/\/claude\.ai\/api\/mcp\/auth_callback$/,
  /^https:\/\/claude\.com\/api\/mcp\/auth_callback$/,
  /^http:\/\/localhost(:\d{1,5})?(\/[\w\-./]*)?$/,
];

/** Registration is open, so the number of clients it can create is bounded. */
export const MAX_CLIENTS = 50;
const CLIENT_PREFIX = "mcp-";

/** What an MCP caller authenticated as. OAuth sign-ins act as agents. */
export interface McpCaller {
  id: string;
  role: CredentialRole;
}

/**
 * OAuth for the hosted MCP, so clients that only speak OAuth (Claude's custom
 * connectors) can use it: discovery metadata (RFC 9728, RFC 8414), dynamic
 * client registration (RFC 7591) onto the identity provider, and checking the
 * bearer tokens it issues. Agent tokens keep working alongside.
 */
export class OAuthService {
  constructor(private readonly deps: OAuthServiceDeps) {}

  /** RFC 9728 protected resource metadata for the MCP endpoint at `origin`. */
  protectedResource(origin: string) {
    const config = this.config();
    return {
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      scopes_supported: [config.scope],
      bearer_methods_supported: ["header"],
      resource_name: "Kids dashboard",
    };
  }

  /**
   * RFC 8414 metadata. The API is the issuer clients discover; sign-in and
   * tokens are the identity provider's endpoints, registration is ours.
   */
  authorizationServer(origin: string) {
    const config = this.config();
    return {
      issuer: origin,
      authorization_endpoint: `${config.loginBaseUrl}/oauth2/authorize`,
      token_endpoint: `${config.loginBaseUrl}/oauth2/token`,
      revocation_endpoint: `${config.loginBaseUrl}/oauth2/revoke`,
      registration_endpoint: `${origin}/oauth/register`,
      scopes_supported: ["openid", config.scope],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    };
  }

  /**
   * Registers (or, for the same redirect URIs, returns) a public client. The
   * identity provider holds the clients; their names are a hash of the URIs.
   */
  async register(input: unknown) {
    this.config();
    const parsed = OAuthClientRegistration.safeParse(input);
    if (!parsed.success) throw new InvalidRequestError("redirect_uris must be 1-5 URLs");
    const redirectUris = [...new Set(parsed.data.redirect_uris)].sort();
    const refused = redirectUris.find((uri) => !ALLOWED_REDIRECTS.some((re) => re.test(uri)));
    if (refused) throw new InvalidRedirectError(`Redirect URI not allowed: ${refused}`);

    const name =
      CLIENT_PREFIX +
      createHash("sha256").update(redirectUris.join(" ")).digest("hex").slice(0, 16);
    const existing = await this.deps.clients.list();
    let client = existing.find((c) => c.name === name);
    if (!client) {
      if (existing.filter((c) => c.name.startsWith(CLIENT_PREFIX)).length >= MAX_CLIENTS) {
        throw new InvalidRequestError("Too many registered clients");
      }
      client = await this.deps.clients.create(name, redirectUris);
    }
    return {
      client_id: client.clientId,
      client_id_issued_at: Math.floor(this.deps.clock.now().getTime() / 1000),
      client_name: parsed.data.client_name ?? name,
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  /**
   * The caller behind an MCP request's Authorization header: an OAuth access
   * token from a sign-in by an account with the role. Null for anything else,
   * agent and device tokens included: the MCP is for signed-in people only.
   */
  async authenticate(header: string | undefined): Promise<McpCaller | null> {
    const token = header?.replace(/^Bearer\s+/i, "") ?? "";
    if (!JWT.test(token) || !this.deps.config) return null;
    const who = await this.deps.tokens.verify(token);
    if (!who || !(await this.hasRole(who.subject))) return null;
    return { id: `oauth:${who.subject}`, role: "agent" };
  }

  private readonly roles = new Map<string, { allowed: boolean; until: number }>();

  /** Whether the account is in the MCP's group, remembered for a few minutes. */
  private async hasRole(sub: string): Promise<boolean> {
    const config = this.deps.config;
    if (!config) return false;
    const now = this.deps.clock.now().getTime();
    const known = this.roles.get(sub);
    if (known && known.until > now) return known.allowed;
    const groups = await this.deps.directory.groupsOf(config.userPoolId, sub);
    const allowed = groups?.includes(config.group) ?? false;
    this.roles.set(sub, { allowed, until: now + ROLE_CACHE_MS });
    return allowed;
  }

  /**
   * Whether a first sign-in may go ahead. Accounts are made by an admin, one
   * per person, and only those in the role group get MCP access (the token
   * check). A Google sign-in would otherwise create a fresh account for anyone
   * with a Google account (self sign-up being off does not stop federated
   * ones), so it is let through only when its verified address belongs to an
   * existing account, and is linked to it: the person then signs in as that
   * account, role and all. Sign-up is refused.
   */
  async mayJoin(joiner: Joiner): Promise<boolean> {
    const { userPoolId, trigger, userName, email, emailVerified } = joiner;
    if (trigger === "PreSignUp_AdminCreateUser") return true;
    if (trigger !== "PreSignUp_ExternalProvider") return false;
    const subject = /^Google_(.+)$/.exec(userName)?.[1];
    if (!subject || !email || String(emailVerified) !== "true") return false;
    const account = await this.deps.directory.findByEmail(userPoolId, email.trim().toLowerCase());
    if (!account) return false;
    await this.deps.directory.linkGoogle(userPoolId, account, subject);
    return true;
  }

  private config(): OAuthConfig {
    if (!this.deps.config) throw new NotConfiguredError("OAuth sign-in is not set up");
    return this.deps.config;
  }
}

/** Three base64url segments (device and agent tokens are `<id>.<secret>`). */
const JWT = /^[\w-]+\.[\w-]+\.[\w-]+$/;

/** RFC 7591's invalid_redirect_uri. */
export class InvalidRedirectError extends InvalidRequestError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRedirectError";
  }
}
