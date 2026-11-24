import type { PreSignUpTriggerEvent } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { fakeWorld } from "../../test/fakes";
import { createPreSignUp } from "./pre-sign-up";

const event = (email: string) =>
  ({
    userPoolId: "pool",
    triggerSource: "PreSignUp_ExternalProvider",
    userName: "Google_42",
    request: { userAttributes: { email, email_verified: "true" } },
    response: {},
  }) as unknown as PreSignUpTriggerEvent;

describe("pre-sign-up trigger", () => {
  it("passes the event on for a known person and refuses anyone else", async () => {
    const w = fakeWorld();
    const handle = createPreSignUp(() => w.services);
    const ok = event("parent@example.com");
    expect(await handle(ok)).toBe(ok);
    expect(w.directory.accounts.get("parent-1")?.links).toEqual(["42"]);
    await expect(handle(event("stranger@example.com"))).rejects.toThrow(/may not sign in/);
  });
});
