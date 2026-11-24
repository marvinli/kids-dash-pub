import { CognitoJwtVerifier } from "aws-jwt-verify";
import type { AccessTokenVerifier, Logger } from "../services/ports";

type Verifier = ReturnType<
  typeof CognitoJwtVerifier.create<{
    userPoolId: string;
    tokenUse: "access";
    clientId: null;
    scope: string;
  }>
>;

/**
 * Cognito access tokens: signature against the pool's published keys (fetched
 * once and cached per Lambda instance), issuer, expiry, token use and scope.
 * Any client of the pool will do; the pool only has clients we registered.
 * The role is not checked here: tokens from a linked Google sign-in carry no
 * `cognito:groups` claim, so the service looks it up.
 */
export class CognitoTokenVerifier implements AccessTokenVerifier {
  private readonly verifier: Verifier;

  constructor(
    userPoolId: string,
    scope: string,
    private readonly logger?: Logger,
    jwks?: Parameters<Verifier["cacheJwks"]>[0],
  ) {
    this.verifier = CognitoJwtVerifier.create({
      userPoolId,
      tokenUse: "access",
      clientId: null,
      scope,
    });
    if (jwks) this.verifier.cacheJwks(jwks, userPoolId);
  }

  async verify(token: string): Promise<{ subject: string } | null> {
    try {
      const payload = await this.verifier.verify(token);
      return { subject: payload.sub };
    } catch (error) {
      this.logger?.warn("access token refused", {
        reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        claims: unverifiedClaims(token),
      });
      return null;
    }
  }
}

/** Claims worth seeing when a token is refused; never the token or its signature. */
const SHOWN = ["iss", "aud", "client_id", "token_use", "scope", "cognito:groups", "exp", "iat"];

function unverifiedClaims(token: string): Record<string, unknown> | null {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
    );
    const header = JSON.parse(Buffer.from(token.split(".")[0] ?? "", "base64url").toString("utf8"));
    const shown: Record<string, unknown> = { kid: header.kid };
    for (const key of SHOWN) if (key in payload) shown[key] = payload[key];
    return shown;
  } catch {
    return null;
  }
}
