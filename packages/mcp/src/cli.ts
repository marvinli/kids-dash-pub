import { readFileSync } from "node:fs";
import { clientFromEnv, type HttpMethod } from "./admin-client";

/**
 * Operator CLI over the same signed client, for things that are not agent
 * tools (fetching the signing key for an app build) and for debugging:
 *
 *   kids-dash-admin signing-key
 *   kids-dash-admin call GET /admin/settings
 *   kids-dash-admin call PUT /admin/settings '{"timezone":"America/New_York"}'
 *   kids-dash-admin call PUT /admin/app @release.json   (body from a file: an
 *     APK as base64 is far over the shell's argument limit)
 */
const [command, ...args] = process.argv.slice(2);
const client = clientFromEnv();

if (command === "signing-key") {
  const key = await client.request<{ keyId: string; publicKeyPem: string }>(
    "GET",
    "/admin/signing-key",
  );
  process.stdout.write(JSON.stringify(key, null, 2));
} else if (command === "call" && args[0] && args[1]) {
  const [method, path, body] = args;
  const result = await client.request(method as HttpMethod, path as string, {
    body:
      body === undefined
        ? undefined
        : JSON.parse(body.startsWith("@") ? readFileSync(body.slice(1), "utf8") : body),
  });
  process.stdout.write(`${JSON.stringify(result ?? { ok: true }, null, 2)}\n`);
} else {
  console.error("usage: kids-dash-admin signing-key | call <METHOD> <path> [json | @file.json]");
  process.exit(2);
}
