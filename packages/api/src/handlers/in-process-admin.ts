import { AdminApiError, type AdminTransport, type HttpMethod } from "@kids-dash/mcp/transport";
import type { AdminEvent } from "./admin";
import type { HttpResult } from "./http";
import { ADMIN_ROUTES } from "./routes";

/**
 * Admin routes an agent may never reach, whatever tools exist: managing frames
 * and their credentials, and publishing the app frames install, stay with
 * people holding AWS credentials.
 */
const AGENT_FORBIDDEN = /^\w+ \/admin\/(devices|app)(\/|$)/;

export interface RouteMatch {
  routeKey: string;
  pathParameters: Record<string, string>;
}

/** Finds the admin route a concrete path belongs to, as API Gateway would. */
export function matchRoute(method: string, path: string): RouteMatch | null {
  const segments = path.split("/").filter(Boolean);
  for (const routeKey of ADMIN_ROUTES) {
    const [routeMethod = "", template = ""] = routeKey.split(" ");
    if (routeMethod !== method) continue;
    const parts = template.split("/").filter(Boolean);
    if (parts.length !== segments.length) continue;
    const pathParameters: Record<string, string> = {};
    const matches = parts.every((part, i) => {
      const segment = segments[i] ?? "";
      const name = /^\{(\w+)\}$/.exec(part)?.[1];
      if (name) {
        pathParameters[name] = decodeURIComponent(segment);
        return true;
      }
      return part === segment;
    });
    if (matches) return { routeKey, pathParameters };
  }
  return null;
}

/**
 * The hosted MCP's way to the admin API: the same route handlers, called in
 * process instead of over HTTP. Tools therefore get exactly the validation,
 * rules and error bodies a direct API caller gets, without a second network
 * hop or a second set of credentials.
 */
export class InProcessAdmin implements AdminTransport {
  constructor(
    private readonly handle: (event: AdminEvent) => Promise<HttpResult>,
    private readonly caller: string,
  ) {}

  async request<T = unknown>(
    method: HttpMethod,
    path: string,
    options: { query?: Record<string, string | undefined>; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(path, "https://in-process.invalid");
    const match = matchRoute(method, url.pathname);
    if (!match) throw new AdminApiError(404, { error: "not_found" });
    if (AGENT_FORBIDDEN.test(match.routeKey)) throw new AdminApiError(403, { error: "forbidden" });
    const query = Object.fromEntries(
      Object.entries(options.query ?? {}).filter((e): e is [string, string] => e[1] !== undefined),
    );
    const event = {
      version: "2.0",
      routeKey: match.routeKey,
      rawPath: url.pathname,
      rawQueryString: new URLSearchParams(query).toString(),
      headers: { "content-type": "application/json" },
      queryStringParameters: Object.keys(query).length ? query : undefined,
      pathParameters: match.pathParameters,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      isBase64Encoded: false,
      requestContext: {
        http: { method, path: url.pathname, protocol: "HTTP/1.1", sourceIp: "", userAgent: "mcp" },
        authorizer: { iam: { userArn: `mcp-agent:${this.caller}` } },
      },
    } as unknown as AdminEvent;

    const result = await this.handle(event);
    const parsed = result.body ? JSON.parse(String(result.body)) : undefined;
    const status = result.statusCode ?? 200;
    if (status >= 400) throw new AdminApiError(status, parsed);
    return parsed as T;
  }
}
