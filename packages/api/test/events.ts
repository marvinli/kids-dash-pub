import type { APIGatewayProxyEventV2 } from "aws-lambda";

export interface EventOptions {
  pathParameters?: Record<string, string>;
  queryStringParameters?: Record<string, string>;
  headers?: Record<string, string>;
  body?: unknown;
  rawBody?: string;
  base64?: boolean;
  role?: "device" | "agent";
}

/** A minimal API Gateway HTTP API (payload 2.0) event for a route key. */
export function httpEvent<E extends APIGatewayProxyEventV2>(
  routeKey: string,
  options: EventOptions = {},
): E {
  const raw =
    options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  const [method = "GET", path = "/"] = routeKey.split(" ");
  return {
    version: "2.0",
    routeKey,
    rawPath: path,
    rawQueryString: "",
    headers: options.headers ?? {},
    pathParameters: options.pathParameters,
    queryStringParameters: options.queryStringParameters,
    body:
      raw === undefined ? undefined : options.base64 ? Buffer.from(raw).toString("base64") : raw,
    isBase64Encoded: options.base64 ?? false,
    requestContext: {
      http: { method, path, protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent: "test" },
      authorizer: { lambda: { deviceId: "0123456789abcdef", role: options.role ?? "device" } },
    },
  } as unknown as E;
}
