/**
 * How tools reach the admin API. Locally that is SigV4-signed HTTP
 * (AdminClient); in the hosted MCP Lambda it is an in-process dispatch to the
 * same route handlers (packages/api). Tools only know this interface.
 */
export type HttpMethod = "GET" | "PUT" | "POST" | "DELETE";

export interface AdminTransport {
  request<T = unknown>(
    method: HttpMethod,
    path: string,
    options?: { query?: Record<string, string | undefined>; body?: unknown },
  ): Promise<T>;
}

/** A non-2xx answer from the admin API, with its JSON error body. */
export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`Admin API answered ${status}: ${JSON.stringify(body)}`);
    this.name = "AdminApiError";
  }
}
