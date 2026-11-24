import {
  type CognitoIdentityProviderClient,
  CreateUserPoolClientCommand,
  ListUserPoolClientsCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import type { OAuthClient, OAuthClientRegistry } from "../services/ports";

/** OAuth clients as Cognito user pool app clients. */
export class CognitoClientRegistry implements OAuthClientRegistry {
  constructor(
    private readonly client: CognitoIdentityProviderClient,
    private readonly userPoolId: string,
    /** The resource server scope clients may ask for (besides openid). */
    private readonly scope: string,
    /** How people sign in: the pool's identity providers' names. */
    private readonly providers: string[] = ["Google"],
  ) {}

  async list(): Promise<OAuthClient[]> {
    const clients: OAuthClient[] = [];
    let next: string | undefined;
    do {
      const page = await this.client.send(
        new ListUserPoolClientsCommand({
          UserPoolId: this.userPoolId,
          MaxResults: 60,
          NextToken: next,
        }),
      );
      for (const c of page.UserPoolClients ?? []) {
        if (c.ClientId && c.ClientName) clients.push({ clientId: c.ClientId, name: c.ClientName });
      }
      next = page.NextToken;
    } while (next);
    return clients;
  }

  async create(name: string, redirectUris: string[]): Promise<OAuthClient> {
    const out = await this.client.send(
      new CreateUserPoolClientCommand({
        UserPoolId: this.userPoolId,
        ClientName: name,
        // Public: MCP clients use PKCE instead of a secret.
        GenerateSecret: false,
        AllowedOAuthFlowsUserPoolClient: true,
        AllowedOAuthFlows: ["code"],
        AllowedOAuthScopes: ["openid", this.scope],
        CallbackURLs: redirectUris,
        SupportedIdentityProviders: this.providers,
        ExplicitAuthFlows: ["ALLOW_REFRESH_TOKEN_AUTH"],
        PreventUserExistenceErrors: "ENABLED",
        EnableTokenRevocation: true,
        // An hour per access token; a connector stays signed in for 90 days.
        AccessTokenValidity: 60,
        IdTokenValidity: 60,
        RefreshTokenValidity: 90,
        TokenValidityUnits: { AccessToken: "minutes", IdToken: "minutes", RefreshToken: "days" },
      }),
    );
    const clientId = out.UserPoolClient?.ClientId;
    if (!clientId) throw new Error("Cognito created no client");
    return { clientId, name };
  }
}
