import type { CredentialRole } from "@kids-dash/core";
import type { APIGatewayRequestAuthorizerEventV2 } from "aws-lambda";
import { lazyServices, type Services } from "./wiring";

export interface AuthorizerResult {
  isAuthorized: boolean;
  context?: { deviceId: string; role: CredentialRole };
}

/** HTTP API "simple response" authorizer for device tokens. */
export function createAuthorizer(services: () => Pick<Services, "devices" | "logger">) {
  return async (event: APIGatewayRequestAuthorizerEventV2): Promise<AuthorizerResult> => {
    const s = services();
    try {
      const who = await s.devices.authenticate(event.headers?.authorization);
      if (!who) return { isAuthorized: false };
      return { isAuthorized: true, context: { deviceId: who.id, role: who.role } };
    } catch (error) {
      s.logger.error("authorizer failed", { error: String(error) });
      return { isAuthorized: false };
    }
  };
}

export const handler = createAuthorizer(lazyServices);
