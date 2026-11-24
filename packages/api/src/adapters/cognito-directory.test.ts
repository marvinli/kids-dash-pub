import {
  AdminLinkProviderForUserCommand,
  AdminListGroupsForUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { CognitoDirectory } from "./cognito-directory";

const cognito = mockClient(CognitoIdentityProviderClient);
const directory = () =>
  new CognitoDirectory(new CognitoIdentityProviderClient({ region: "us-east-1" }));

beforeEach(() => cognito.reset());

describe("CognitoDirectory", () => {
  it("finds the admin-made account for an email, not federated ones", async () => {
    cognito.on(ListUsersCommand).resolves({
      Users: [
        { Username: "Google_9", UserStatus: "EXTERNAL_PROVIDER" },
        { Username: "abc-123", UserStatus: "FORCE_CHANGE_PASSWORD" },
      ],
    });
    expect(await directory().findByEmail("pool", 'a"b@example.com')).toBe("abc-123");
    expect(cognito.commandCalls(ListUsersCommand)[0]?.args[0].input).toMatchObject({
      UserPoolId: "pool",
      Filter: 'email = "ab@example.com"',
    });
    cognito.reset();
    cognito.on(ListUsersCommand).resolves({});
    expect(await directory().findByEmail("pool", "x@example.com")).toBeNull();
  });

  it("links a Google identity to an account", async () => {
    cognito.on(AdminLinkProviderForUserCommand).resolves({});
    await directory().linkGoogle("pool", "abc-123", "42");
    expect(cognito.commandCalls(AdminLinkProviderForUserCommand)[0]?.args[0].input).toEqual({
      UserPoolId: "pool",
      DestinationUser: { ProviderName: "Cognito", ProviderAttributeValue: "abc-123" },
      SourceUser: {
        ProviderName: "Google",
        ProviderAttributeName: "Cognito_Subject",
        ProviderAttributeValue: "42",
      },
    });
  });

  it("looks up an account's groups by sub, across pages", async () => {
    cognito.on(ListUsersCommand).resolves({ Users: [{ Username: "abc-123", Enabled: true }] });
    cognito
      .on(AdminListGroupsForUserCommand)
      .resolvesOnce({ Groups: [{ GroupName: "other" }, {}], NextToken: "n" })
      .resolvesOnce({ Groups: [{ GroupName: "dashboard" }] });
    expect(await directory().groupsOf("pool", 'sub-"1')).toEqual(["other", "dashboard"]);
    expect(cognito.commandCalls(ListUsersCommand)[0]?.args[0].input).toMatchObject({
      UserPoolId: "pool",
      Filter: 'sub = "sub-1"',
    });
    expect(cognito.commandCalls(AdminListGroupsForUserCommand)[1]?.args[0].input).toEqual({
      UserPoolId: "pool",
      Username: "abc-123",
      NextToken: "n",
    });
  });

  it("has no groups for a missing or disabled account", async () => {
    cognito.on(ListUsersCommand).resolves({});
    expect(await directory().groupsOf("pool", "nobody")).toBeNull();
    cognito.on(ListUsersCommand).resolves({ Users: [{ Username: "abc-123", Enabled: false }] });
    expect(await directory().groupsOf("pool", "abc")).toBeNull();
    expect(cognito.commandCalls(AdminListGroupsForUserCommand)).toHaveLength(0);
  });
});
