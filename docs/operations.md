# Operations

## Where things run

| What                 | Where                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------ |
| AWS account / region | Your AWS account and region (select with `AWS_PROFILE`, `AWS_REGION` and `CDK_DEFAULT_REGION`)                      |
| Stacks               | `KidsDash-Data` (stateful, everything retained) and `KidsDash-Api`                         |
| API                  | `<ApiUrl>` (stack output `ApiUrl`)           |
| Logs                 | CloudWatch log groups of the `KidsDash-Api-*Function*` Lambdas, JSON lines, one month |
| Frame                | `dev.kidsdash.frame` on the Frameo, Home app; see `docs/device/frameo.md`                  |

## Deploy

```sh
pnpm install && pnpm lint && pnpm coverage
AWS_PROFILE="<your-profile>" pnpm run deploy      # cdk deploy --all
```

`-c stage=dev` deploys a separate `KidsDash-dev-*` copy. There is no CI deploy
yet; CI (`.github/workflows/ci.yml`) runs lint, tests and a synth.

Check that your IAM credentials can request an assembled dashboard bundle:

```sh
export AWS_PROFILE="<your-profile>" KIDS_DASH_API_URL=<ApiUrl>
pnpm --filter @kids-dash/mcp build
node packages/mcp/dist/cli.js call GET /admin/bundle
```

## MCP servers for agents

**Hosted (cloud agents):** `<McpUrl>`
(stack output `McpUrl`), Streamable HTTP, stateless. It accepts only OAuth
sign-ins (below); agent and device tokens get `401`. Signed-in callers act as
agents: every tool except credentials and kid photos, and no reach to the
credential routes even in-process.

**OAuth (Claude custom connectors):** add the URL as a custom connector
with no client ID; Claude discovers the rest. `/mcp` answers an unauthenticated
request with `401` and `WWW-Authenticate: Bearer resource_metadata=...`; the
metadata (`/.well-known/oauth-protected-resource[/mcp]`,
`/.well-known/oauth-authorization-server`) sends sign-in and tokens to the
Cognito pool's hosted login (stack outputs `McpUserPoolId`, `McpLoginUrl`) and
registration to `POST /oauth/register`, which creates a public PKCE app client
in the pool, only for Claude's callbacks (`https://claude.ai|claude.com/api/mcp/auth_callback`)
or `http://localhost`, one per set of redirect URIs, at most 50. Access tokens
last an hour, refresh tokens 90 days. The pool is Essentials tier (free under
10,000 monthly users).

People sign in with Google. Access is by role: an account an admin made, in the
`dashboard` group, looked up by the token's `sub` (Cognito leaves
`cognito:groups` out of tokens from linked Google sign-ins) and cached for five
minutes; `/mcp` refuses accounts outside the group. Refusals are logged as
"access token refused" with the reason in the MCP function's log group. Nobody can sign
themselves up, and a Google sign-in creates nothing: the pool's pre-sign-up
trigger lets a first Google sign-in through only when its verified address
belongs to an existing account, and links the Google identity to that account
(the very first sign-in may fail once with a "linked" error; signing in again
works).

Google sign-in needs an OAuth client in the GCP project (APIs & Services →
Credentials → OAuth client ID → Web application) with the authorized redirect
URI `<McpLoginUrl>/oauth2/idpresponse`, and its ID and secret in Secrets
Manager before deploying:

```sh
AWS_PROFILE="<your-profile>" aws secretsmanager create-secret --name kids-dash/prod/google-sign-in \
  --secret-string '{"clientId":"<id>","clientSecret":"<secret>"}'
```

Give a person access (the account's email is how their Google sign-in finds it;
`SUPPRESS` skips Cognito's password email, since nobody signs in with a password):

```sh
export AWS_PROFILE="<your-profile>" POOL=<McpUserPoolId>
aws cognito-idp admin-create-user --user-pool-id $POOL --username <email> \
  --user-attributes Name=email,Value=<email> Name=email_verified,Value=true \
  --message-action SUPPRESS
aws cognito-idp admin-add-user-to-group --user-pool-id $POOL --username <email> --group-name dashboard
```

Take it away with `admin-remove-user-from-group` (tokens already issued work
until they expire, at most an hour) or `admin-delete-user`; cut off one
connector by deleting its app client (`list-user-pool-clients`).

## Google Calendar

The dashboard reads one calendar per kid (**Kids · <name>**) and
**Kids · Everyone**, owned by a Google service account and shared with you as
owner (you can edit them like your own; they appear once you accept the
sharing email). The sync reads them every 15 minutes. Events added with a
frame's "+" are written to them by the device API (`calendar.events` scope, read
and write; Drive stays read-only); each says "Added on the <name> frame." below
its `kids:` line, so you can tell where it came from. Fix or delete one in
Google Calendar like any other event.

```sh
gcloud auth login                                     # once, interactively
AWS_PROFILE="<your-profile>" scripts/google/create-service-account.sh <project-id>
AWS_PROFILE="<your-profile>" KIDS_DASH_API_URL=<ApiUrl> \
  node scripts/google/setup-calendars.mjs --share-with <your google email>
```

The first script creates the Cloud project, enables the Calendar API, creates
the service account and pipes a key straight into the `KidsDash-Data` secret.
The second creates or finds the calendars, shares them, writes their ids into
settings and syncs. Both are safe to rerun. How event descriptions are read
(note line, `kids: special`): `docs/architecture.md`.

## Weather

Set `location` in settings (`update_settings`, name plus latitude/longitude).
Open-Meteo needs no key. The sync refreshes it every 15 minutes.

## Screen sleep

For example, `sleep` in settings (`update_settings`) can be `{ "start": "20:00", "end": "06:00" }`
in the family's timezone, crossing midnight when `end` is earlier; `null` keeps
the screen on. The frame applies it from the next
bundle; see `packages/frame-android/README.md`.

The power button on Today (next to Photos) puts the frame into the same sleep
right away: black cover, backlight off, touch still live. It stays asleep
through bundle polls until someone touches it or the sleep window starts or
ends (so it wakes at the configured end time); then the schedule takes over again (by day it is simply awake; during sleep hours a
touch gives the usual two minutes).

## Devices

Register with `register_device` (the token is shown once; save it to
`local/frame/device.json`), provision with
`pnpm --filter @kids-dash/frame-android frame:provision`, revoke with
`revoke_device` (effective within the authorizer's five-minute cache).

Each frame has its own settings: `set_device_settings` (local MCP) or
`PUT /admin/devices/<id>/settings` with `{"slideshowFolderId": "<drive folder>"}`
makes that frame play its own Drive folder (shared with the service account);
`null` goes back to the family's `slideshowFolderId`. The next sync mirrors the
folder. `greetingName` (e.g. `"Nana"`) makes that frame say
"Good morning, Nana!" instead of naming the kids. The endpoint replaces all of
a frame's settings, so send every field. Preview what a frame gets with `GET /admin/bundle?deviceId=<id>`.

Health: `list_devices` / `GET /admin/devices` shows each frame's `lastSeenAt`
(about ten-minute resolution) and `appVersion` / `appVersionAt`, the
versionCode it sends as `X-Frame-Version` on every bundle poll.

Outages: each frame reports every stretch of five minutes or more when it
could not reach the API, once it is back (`list_incidents`, newest first; a
report's system log with `get_incident`). In CloudWatch they are the
`frame was offline` warnings in the device function's log group. A frame whose
Wi-Fi chip dies reboots itself (`reboot: "watchdog"`), but never with the screen
dark; see "Outages and the Wi-Fi watchdog" in docs/architecture.md.

Alerts: every 10 minutes the watch function (`WatchService`) emails once when
a frame has not checked in for an hour, and once when it is back, with what its
outage report says happened. Mail goes through the SNS topic in the stack
output `AlertTopicArn`. No address is in the code; subscribe one by hand (SNS
emails a confirmation link that must be clicked):

```sh
AWS_PROFILE="<your-profile>" aws sns subscribe --topic-arn <AlertTopicArn> \
  --protocol email --notification-endpoint <address>
```

`aws sns list-subscriptions-by-topic` shows who gets them; unsubscribe from
the link in any alert.

## App updates (over the air)

Frames install whatever build is current; there is no per-frame rollout. Build
the APK (its `versionCode` is the commit count), then publish it (not an MCP tool):

```sh
# Through turbo, so frame-web (the page, its art and the art manifest) is rebuilt
# first; `pnpm --filter @kids-dash/frame-android build` would package a stale dist.
pnpm turbo run build --filter=@kids-dash/frame-android
AWS_PROFILE="<your-profile>" KIDS_DASH_API_URL=<ApiUrl> node packages/frame-android/scripts/frame.mjs publish
node packages/mcp/dist/cli.js call GET /admin/app
```

`publish` asks `POST /admin/app/upload {sha256}` for a presigned S3 URL, PUTs
the APK there (S3 checks it against the hash), then `PUT /admin/app
{versionCode, versionName, sha256}`. The bytes skip the API because a Lambda
request tops out at 6 MB as base64. Small builds may still send `dataBase64`
inline instead of `sha256`. Before that, `publish` uploads the backdrop
paintings the build downloads instead of carrying (its
`assets/web/art-remote.txt`): `POST /admin/art/upload {sha256s}` answers
upload URLs for the ones not yet in S3 `art/`, so usually none. Build before
publishing (`pnpm turbo run build --filter=@kids-dash/frame-android`): it
refuses art changed since the build.

The API refuses a versionCode that is not above the current one (409) and
bytes that are not a zip or do not match the hash (and deletes such an upload). The bundle then carries `app: {versionCode,
versionName, sha256}`; a frame running an older build downloads
`GET /v1/app/<sha256>` (a five-minute presigned S3 URL), checks the hash and
installs it. Watch `appVersion` in `list_devices` to see each frame pick it up.
Rolling back means publishing the old code again under a new, higher versionCode.

## Rotating the bundle signing key

Create a new key (change the construct id in `DataStack`), deploy, update
`packages/frame-android/frame.config.json` from `kids-dash-admin signing-key`,
rebuild and install the APK, then schedule deletion of the old key in KMS.
