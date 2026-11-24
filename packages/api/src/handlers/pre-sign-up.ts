import type { PreSignUpTriggerEvent } from "aws-lambda";
import { lazyServices, type Services } from "./wiring";

/**
 * Cognito's pre-sign-up trigger for the MCP sign-in pool: a first Google
 * sign-in goes ahead only for someone an admin made an account for, and is
 * linked to that account (OAuthService.mayJoin).
 * Throwing refuses the sign-in; Cognito shows the message.
 */
export function createPreSignUp(services: () => Pick<Services, "oauth" | "logger">) {
  return async (event: PreSignUpTriggerEvent): Promise<PreSignUpTriggerEvent> => {
    const s = services();
    const attributes = event.request.userAttributes;
    const allowed = await s.oauth.mayJoin({
      userPoolId: event.userPoolId,
      trigger: event.triggerSource,
      userName: event.userName,
      email: attributes.email,
      emailVerified: attributes.email_verified,
    });
    s.logger.info("sign-up", { trigger: event.triggerSource, allowed });
    if (!allowed) throw new Error("This account may not sign in to the kids dashboard.");
    return event;
  };
}

export const handler = createPreSignUp(lazyServices);
