import {
  CognitoIdentityProviderClient,
  CreateUserPoolClientCommand,
  ListUserPoolClientsCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { CognitoClientRegistry } from "./cognito-clients";

const cognito = mockClient(CognitoIdentityProviderClient);
const registry = () =>
  new CognitoClientRegistry(
    new CognitoIdentityProviderClient({ region: "us-east-1" }),
    "us-east-1_pool",
    "https://api.example/mcp/dashboard",
  );

beforeEach(() => cognito.reset());

describe("CognitoClientRegistry", () => {
  it("lists every page of app clients", async () => {
    cognito
      .on(ListUserPoolClientsCommand, { NextToken: undefined })
      .resolves({
        UserPoolClients: [{ ClientId: "a", ClientName: "mcp-1" }, { ClientId: "x" }],
        NextToken: "p2",
      })
      .on(ListUserPoolClientsCommand, { NextToken: "p2" })
      .resolves({ UserPoolClients: [{ ClientId: "b", ClientName: "mcp-2" }] });
    expect(await registry().list()).toEqual([
      { clientId: "a", name: "mcp-1" },
      { clientId: "b", name: "mcp-2" },
    ]);
    cognito.reset();
    cognito.on(ListUserPoolClientsCommand).resolves({});
    expect(await registry().list()).toEqual([]);
  });

  it("creates public authorization-code clients with PKCE-only sign-in", async () => {
    cognito.on(CreateUserPoolClientCommand).resolves({ UserPoolClient: { ClientId: "new" } });
    expect(await registry().create("mcp-1", ["https://claude.ai/api/mcp/auth_callback"])).toEqual({
      clientId: "new",
      name: "mcp-1",
    });
    expect(cognito.commandCalls(CreateUserPoolClientCommand)[0]?.args[0].input).toMatchObject({
      UserPoolId: "us-east-1_pool",
      ClientName: "mcp-1",
      GenerateSecret: false,
      AllowedOAuthFlows: ["code"],
      AllowedOAuthScopes: ["openid", "https://api.example/mcp/dashboard"],
      CallbackURLs: ["https://claude.ai/api/mcp/auth_callback"],
      SupportedIdentityProviders: ["Google"],
    });
    cognito.on(CreateUserPoolClientCommand).resolves({});
    await expect(registry().create("mcp-2", [])).rejects.toThrow(/no client/);
  });
});
