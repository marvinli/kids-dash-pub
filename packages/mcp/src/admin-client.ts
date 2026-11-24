import { Sha256 } from "@aws-crypto/sha256-js";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import { HttpRequest } from "@smithy/protocol-http";
import { SignatureV4 } from "@smithy/signature-v4";
import { AdminApiError, type AdminTransport, type HttpMethod } from "./transport";

export { AdminApiError, type HttpMethod } from "./transport";

export interface AdminClientOptions {
  baseUrl: string;
  region: string;
  /** Defaults to the standard chain (env, AWS_PROFILE, SSO, instance role…). */
  credentials?: SignatureV4["credentialProvider"];
  fetchFn?: typeof fetch;
}

/**
 * Calls the IAM-protected admin API, signing each request with SigV4 as the
 * caller's own AWS identity. Nothing here is a secret of ours: whoever can call
 * it already holds credentials that IAM lets invoke the API.
 */
export class AdminClient implements AdminTransport {
  private readonly signer: SignatureV4;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: AdminClientOptions) {
    this.signer = new SignatureV4({
      credentials: options.credentials ?? fromNodeProviderChain(),
      region: options.region,
      service: "execute-api",
      sha256: Sha256,
    });
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async request<T = unknown>(
    method: HttpMethod,
    path: string,
    options: { query?: Record<string, string | undefined>; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(path, this.options.baseUrl);
    const query: Record<string, string> = {};
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) {
        query[key] = value;
        url.searchParams.set(key, value);
      }
    }
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const signed = await this.signer.sign(
      new HttpRequest({
        method,
        protocol: url.protocol,
        hostname: url.hostname,
        path: url.pathname,
        query,
        headers: {
          host: url.hostname,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body,
      }),
    );

    const response = await this.fetchFn(url, { method, headers: signed.headers, body });
    const text = await response.text();
    const parsed = text ? safeJson(text) : undefined;
    if (!response.ok) throw new AdminApiError(response.status, parsed);
    return parsed as T;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** API Gateway URLs carry their region: https://<id>.execute-api.<region>.amazonaws.com */
export function regionFromApiUrl(url: string): string | null {
  return /\.execute-api\.([a-z0-9-]+)\.amazonaws\.com/.exec(url)?.[1] ?? null;
}

export function clientFromEnv(env: NodeJS.ProcessEnv = process.env): AdminClient {
  const baseUrl = env.KIDS_DASH_API_URL;
  if (!baseUrl) throw new Error("Set KIDS_DASH_API_URL to the admin API URL (stack output ApiUrl)");
  const region = env.AWS_REGION ?? regionFromApiUrl(baseUrl) ?? "us-east-1";
  return new AdminClient({ baseUrl, region });
}
