import {
  AdminLinkProviderForUserCommand,
  AdminListGroupsForUserCommand,
  type CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import type { SignInDirectory } from "../services/ports";

/** The sign-in pool's accounts, through the Cognito API. */
export class CognitoDirectory implements SignInDirectory {
  constructor(private readonly client: CognitoIdentityProviderClient) {}

  async findByEmail(userPoolId: string, email: string): Promise<string | null> {
    const out = await this.client.send(
      new ListUsersCommand({
        UserPoolId: userPoolId,
        Filter: `email = "${email.replace(/["\\]/g, "")}"`,
        Limit: 10,
      }),
    );
    // Only accounts made by an admin, not other federated identities.
    const account = (out.Users ?? []).find(
      (u) => u.Username && u.UserStatus !== "EXTERNAL_PROVIDER",
    );
    return account?.Username ?? null;
  }

  async linkGoogle(userPoolId: string, username: string, googleSubject: string): Promise<void> {
    await this.client.send(
      new AdminLinkProviderForUserCommand({
        UserPoolId: userPoolId,
        DestinationUser: { ProviderName: "Cognito", ProviderAttributeValue: username },
        SourceUser: {
          ProviderName: "Google",
          ProviderAttributeName: "Cognito_Subject",
          ProviderAttributeValue: googleSubject,
        },
      }),
    );
  }

  async groupsOf(userPoolId: string, sub: string): Promise<string[] | null> {
    const found = await this.client.send(
      new ListUsersCommand({
        UserPoolId: userPoolId,
        Filter: `sub = "${sub.replace(/["\\]/g, "")}"`,
        Limit: 1,
      }),
    );
    const user = found.Users?.[0];
    if (!user?.Username || user.Enabled === false) return null;
    const groups: string[] = [];
    let NextToken: string | undefined;
    do {
      const page = await this.client.send(
        new AdminListGroupsForUserCommand({
          UserPoolId: userPoolId,
          Username: user.Username,
          NextToken,
        }),
      );
      for (const g of page.Groups ?? []) if (g.GroupName) groups.push(g.GroupName);
      NextToken = page.NextToken;
    } while (NextToken);
    return groups;
  }
}
