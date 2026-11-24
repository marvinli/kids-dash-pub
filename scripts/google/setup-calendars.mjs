// Creates the dashboard's calendars, owned by the sync service account and
// shared with a person as owner, then points the dashboard settings at them.
// Idempotent: calendars are found by name, sharing is only added if missing.
//
//   AWS_PROFILE="<your-profile>" KIDS_DASH_API_URL=<ApiUrl> \
//     node scripts/google/setup-calendars.mjs --share-with you@example.com
//
// The service account key is read from the KidsDash-Data secret into memory
// only. Needs the MCP CLI built (pnpm --filter @kids-dash/mcp build).
import { execFileSync } from "node:child_process";
import { createSign } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { calendarDescription, calendarSettings } from "./calendar-settings.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const shareWith = process.argv[process.argv.indexOf("--share-with") + 1];
if (!process.argv.includes("--share-with") || !shareWith?.includes("@")) {
  console.error("usage: setup-calendars.mjs --share-with <google account email>");
  process.exit(2);
}
const API = "https://www.googleapis.com/calendar/v3";

const aws = (...args) => execFileSync("aws", args, { encoding: "utf8" }).trim();
const admin = (...args) =>
  JSON.parse(
    execFileSync("node", [join(root, "packages/mcp/dist/cli.js"), "call", ...args], {
      encoding: "utf8",
    }),
  );

const secretArn = aws(
  "cloudformation",
  "describe-stacks",
  "--stack-name",
  "KidsDash-Data",
  "--query",
  "Stacks[0].Outputs[?contains(OutputKey,'GoogleServiceAccount')].OutputValue",
  "--output",
  "text",
);
const key = JSON.parse(
  aws(
    "secretsmanager",
    "get-secret-value",
    "--secret-id",
    secretArn,
    "--query",
    "SecretString",
    "--output",
    "text",
  ),
);
if (!key.client_email)
  throw new Error("The secret does not hold a service account key; run create-service-account.sh");

async function accessToken() {
  const enc = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token",
    iat,
    exp: iat + 600,
  })}`;
  const assertion = `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(key.private_key).toString("base64url")}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`token: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

const token = await accessToken();
async function google(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

const settings = admin("GET", "/admin/settings").settings;
if (!settings) throw new Error("Configure the kids in settings first");
const wanted = [
  ...settings.kids.map((kid) => ({ kid, summary: `Kids · ${kid.name}` })),
  { kid: null, summary: "Kids · Everyone" },
];

const existing = (await google("GET", "/users/me/calendarList")).items ?? [];
for (const entry of wanted) {
  let calendar = existing.find((c) => c.summary === entry.summary);
  if (!calendar) {
    calendar = await google("POST", "/calendars", {
      summary: entry.summary,
      timeZone: settings.timezone,
      description: calendarDescription(entry.kid),
    });
    console.log(`created ${entry.summary}`);
  }
  entry.id = calendar.id;
  const acl =
    (await google("GET", `/calendars/${encodeURIComponent(calendar.id)}/acl`)).items ?? [];
  if (!acl.some((rule) => rule.scope?.value === shareWith && rule.role === "owner")) {
    await google(
      "POST",
      `/calendars/${encodeURIComponent(calendar.id)}/acl?sendNotifications=true`,
      {
        role: "owner",
        scope: { type: "user", value: shareWith },
      },
    );
    console.log(`shared ${entry.summary} with ${shareWith}`);
  }
}

const next = calendarSettings(settings, wanted);
admin("PUT", "/admin/settings", JSON.stringify(next));
console.log(JSON.stringify(admin("POST", "/admin/sync")));
console.log(wanted.map((w) => `${w.summary}: ${w.id}`).join("\n"));
