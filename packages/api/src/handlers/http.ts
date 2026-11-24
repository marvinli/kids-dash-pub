import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ZodError, type z } from "zod";
import {
  ConflictError,
  ForbiddenError,
  InvalidRequestError,
  NotConfiguredError,
  NotFoundError,
  RateLimitedError,
} from "../services/errors";
import type { Logger } from "../services/ports";

export type HttpResult = APIGatewayProxyStructuredResultV2;
export type RouteHandler<E> = (event: E) => Promise<HttpResult>;

const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

export function json(statusCode: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    statusCode,
    headers: { "content-type": "application/json", ...SECURITY_HEADERS, ...headers },
    body: JSON.stringify(body),
  } satisfies HttpResult;
}

export function empty(statusCode: number, headers: Record<string, string> = {}): HttpResult {
  return { statusCode, headers: { ...SECURITY_HEADERS, ...headers } };
}

export class BadJsonError extends Error {}

export function body(event: APIGatewayProxyEventV2): unknown {
  if (!event.body) return {};
  const text = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  try {
    return JSON.parse(text);
  } catch {
    throw new BadJsonError("Request body is not valid JSON");
  }
}

export function param<T>(event: APIGatewayProxyEventV2, name: string, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(event.pathParameters?.[name]);
  if (!parsed.success) throw new InvalidRequestError(`Invalid path parameter ${name}`);
  return parsed.data;
}

export function query<T>(event: APIGatewayProxyEventV2, name: string, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(event.queryStringParameters?.[name]);
  if (!parsed.success) throw new InvalidRequestError(`Invalid query parameter ${name}`);
  return parsed.data;
}

/** Dispatches by route key and turns service errors into HTTP statuses. */
export function router<E extends APIGatewayProxyEventV2, R extends string>(
  routes: Record<R, RouteHandler<E>>,
  logger: Logger,
): (event: E) => Promise<HttpResult> {
  return async (event) => {
    const handler = (routes as Record<string, RouteHandler<E> | undefined>)[event.routeKey];
    if (!handler) return json(404, { error: "not_found" });
    try {
      return await handler(event);
    } catch (error) {
      return errorResult(error, logger, event.routeKey);
    }
  };
}

export function errorResult(error: unknown, logger: Logger, routeKey: string): HttpResult {
  if (error instanceof ZodError) {
    return json(400, {
      error: "invalid_request",
      issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  if (error instanceof InvalidRequestError || error instanceof BadJsonError) {
    return json(400, { error: "invalid_request", message: error.message });
  }
  if (error instanceof NotFoundError)
    return json(404, { error: "not_found", message: error.message });
  if (error instanceof ForbiddenError) {
    return json(403, { error: "forbidden", message: error.message });
  }
  if (error instanceof ConflictError) {
    return json(409, { error: "conflict", message: error.message });
  }
  if (error instanceof NotConfiguredError) {
    return json(409, { error: "not_configured", message: error.message });
  }
  if (error instanceof RateLimitedError) {
    return json(429, { error: "rate_limited", message: error.message });
  }
  logger.error("unhandled error", {
    routeKey,
    error: String(error),
    stack: (error as Error)?.stack,
  });
  return json(500, { error: "internal" });
}
