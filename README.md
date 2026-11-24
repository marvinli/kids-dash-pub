# kids-dash

A kawaii morning dashboard for a Frameo photo frame: the weather and what to wear,
each kid's day, the week's special days, and a tap-to-check chore list.

- [Architecture](docs/architecture.md): how it fits together, sources of truth, security
- [Frame and ADB guide](docs/device/frameo.md): connecting, installs, troubleshooting,
  and device precautions
- [Operations](docs/operations.md): day-to-day operations: deploys, the MCP, devices, alerts,
  app updates, key rotation
- `packages/`: `core` (pure domain), `api` (Lambdas), `infra` (CDK), `mcp` (agent
  tools), `frame-web` (the dashboard page), `frame-android` (the frame's app)
- `assets/art/`: sticker and backdrop art (`source/` generated PNGs, `web/` what the
  frame ships)

## Develop

Start with [AGENTS.md](AGENTS.md) (also exposed as `CLAUDE.md`). Commands below
run from the repository root. Use Node 24, pnpm 9 and JDK 17. Java tests need
`JAVA_17_HOME` or `JAVA_HOME` pointing to JDK 17; the macOS Homebrew installation
is a fallback. No cloud credentials, device, Android SDK or deployment config
are needed for lint and coverage.

```sh
pnpm install --frozen-lockfile
pnpm lint       # biome + tsc + shareability checks
pnpm test       # TypeScript, Java and operator-script tests
pnpm coverage   # tests with coverage thresholds
```

Preview the dashboard with example data:

```sh
pnpm --filter @kids-dash/frame-web dev
```

Open `packages/frame-web/dist-dev/index.html` in a browser at a 1920×1080 viewport.
For infrastructure validation, `pnpm synth` bundles the Lambdas and ffmpeg layer;
it needs a running Docker engine, but no deployment credentials. Building the
Android APK additionally needs the SDK and your own frame config (step 10).

## Set up your own

These steps assume you have your own AWS account and a coding agent (Claude Code
or similar) working in a clone of this repo. Hand it this section: *"Set up
kids-dash in my AWS account by following the README."* The agent runs the
commands. Steps marked **You:** need a person, because they mean signing in to
Google, clicking in a web console or an email, or holding the frame. The agent
should request help when those steps require your interaction and continue with
independent work while waiting.

At the end you have, in your own AWS account and Google account:

- the API (Lambdas, DynamoDB, S3, KMS) that builds and signs the dashboard,
- Google Calendars, one per kid plus one for everyone, that the dashboard reads,
- an MCP server so you (or an agent such as Claude) can manage kids, chores and
  notes and preview the dashboard,
- a frame running the dashboard app, updating itself over the air.

Events always live in Google Calendar: you add, move and delete them there, and
the dashboard syncs them every 15 minutes. Everything else (kids, chores, notes,
photos, settings) is in DynamoDB and is managed through the MCP tools or the admin
CLI.

### What you need

| Thing | Notes |
| --- | --- |
| AWS credentials | An admin-level named profile the agent can use. Everything goes into one region (the default is `us-east-1`). |
| A Google account | It owns the Cloud project and gets owner access to the kids' calendars. |
| `aws`, `gcloud`, Node 24, pnpm 9 | On the machine the agent runs on (macOS or Linux). |
| JDK 17 | Needed for JVM tests and building the frame app. Set `JAVA_17_HOME` or `JAVA_HOME`. |
| Android SDK | Build-tools 36.0.0 and platform android-36. Set `ANDROID_SDK`, `ANDROID_HOME` or `ANDROID_SDK_ROOT`; macOS Homebrew is a fallback. Needed only to build or publish the APK. |
| Docker | A running engine, needed for CDK synth and deploy to package the ffmpeg layer. |
| `adb` | Only for the one-time frame install. |
| A frame | An Android 8.1+ device with ADB access **and root (`su`)**: provisioning puts the device token into the app's private storage as root. The reference device is a Frameo 159K (15.6", 1920×1080). A stock Frameo has neither ADB nor root; firmware-specific unlocking is outside this repo. Any rooted Android tablet or frame with a 1920×1080 landscape screen works. |

The agent should set these in every shell it uses (ask the user which profile):

```sh
export AWS_PROFILE="<your-profile>"
export AWS_REGION="<your-region>"
export CDK_DEFAULT_REGION="$AWS_REGION"
```

### 1. Install and check

```sh
git clone "<repository-url>" kids-dash
cd kids-dash
pnpm install --frozen-lockfile
pnpm lint && pnpm coverage
```

If this account has never used CDK in this region, bootstrap it once:

```sh
pnpm --filter @kids-dash/infra exec cdk bootstrap
```

### 2. Deploy the data stack

The data stack holds the tables, buckets, the signing key and an empty secret for
the Google service account key. Deploy it on its own first, because the next step
writes into that secret:

```sh
pnpm --filter @kids-dash/infra exec cdk deploy KidsDash-Data
```

Everything in it is retained if you later delete the stack.

### 3. Create the Google service account

The service account owns the kids' calendars and reads them, plus the Drive
slideshow folders. Pick a globally unique Cloud project id (for example
`kids-dash-<something>`):

**You:** run `gcloud auth login` in a terminal and finish the browser sign-in.
Then the agent runs:

```sh
scripts/google/create-service-account.sh <project-id>
gcloud services enable drive.googleapis.com --project <project-id>   # for the slideshow
```

The script creates the project if needed, enables the Calendar API, creates
`kids-dash-sync@<project-id>.iam.gserviceaccount.com` with no IAM roles, and pipes
a new key straight into the `KidsDash-Data` secret, so it never touches disk.
Rerunning it is safe, but each run mints a new key; delete old keys in the
console.

### 4. Create the Google sign-in client for the MCP

The hosted MCP lets people sign in with Google through a Cognito user pool. Cognito
needs an OAuth client from your Cloud project, and the API stack reads it while
deploying, so create it first.

1. Work out your sign-in domain. It's fixed by the stage, account and region:
   `https://kids-dash-prod-<aws-account-id>.auth.<region>.amazoncognito.com`
   (`aws sts get-caller-identity` shows the account id).
2. **You:** in the Google Cloud console for `<project-id>`, open **APIs & Services → OAuth
   consent screen**. Choose External, fill in the app name and your email, and
   add yourself (and anyone else who will sign in) as **test users**. You can
   leave it in Testing.
3. **You:** open **APIs & Services → Credentials → Create credentials → OAuth client ID →
   Web application**. Add the authorized redirect URI
   `https://kids-dash-prod-<aws-account-id>.auth.<region>.amazoncognito.com/oauth2/idpresponse`.
4. Give the agent the client's ID and secret, and it stores them (don't paste
   them anywhere else):

```sh
aws secretsmanager create-secret --name kids-dash/prod/google-sign-in \
  --secret-string '{"clientId":"<client id>","clientSecret":"<client secret>"}'
```

### 5. Deploy everything

```sh
pnpm run deploy        # not `pnpm deploy`, which is pnpm's own command
```

Note these stack outputs of `KidsDash-Api` (they're also in the CloudFormation
console):

| Output | Used for |
| --- | --- |
| `ApiUrl` | The admin CLI, the local MCP and the frame app |
| `McpUrl` | Adding the hosted MCP to Claude |
| `McpUserPoolId` | Giving people access |
| `AlertTopicArn` | Email alerts when a frame goes quiet |

```sh
export KIDS_DASH_API_URL=<ApiUrl>
pnpm --filter @kids-dash/mcp build
node packages/mcp/dist/cli.js call GET /admin/settings     # checks the deploy end to end
```

The admin CLI (`packages/mcp/dist/cli.js`, also called `kids-dash-admin`) signs
each request with your AWS credentials, so anyone with IAM access to the API in
this account can use it. No other login is involved.

### 6. Describe your family

**You:** tell the agent the kids' names and colours, your city and the sleep hours
you want. Settings are one record that you replace as a whole. Set the timezone, the
weather location, the kids and (optionally) screen sleep hours. Kid ids are
lowercase slugs that never change; names can. Colours are `pink`, `blue`,
`purple`, `green` or `orange`. There can be up to six kids.

The following names and New York location are example data; replace them with
your own family and location.

```sh
node packages/mcp/dist/cli.js call PUT /admin/settings '{
  "timezone": "America/New_York",
  "location": { "name": "Home", "latitude": 40.71, "longitude": -74.01 },
  "kids": [
    { "id": "maya", "name": "Maya", "color": "pink" },
    { "id": "theo", "name": "Theo", "color": "blue" }
  ],
  "sleep": { "start": "20:00", "end": "06:00" }
}'
```

Weather comes from Open-Meteo and needs no key. A `sleep` of `null` keeps the
screen on all the time.

### 7. Create the calendars

```sh
node scripts/google/setup-calendars.mjs --share-with <your google email>
```

This creates **Kids · <name>** for each kid and **Kids · Everyone**, owned by the
service account and shared with you as owner. It then writes their ids into
settings and runs a sync. **You:** accept the sharing emails Google sends, and the
calendars appear in your Google Calendar like your own. It's safe to rerun after
adding a kid. New calendars use the timezone in your family settings.

How events are read:

- an event's own calendar says whose it is (Everyone = every kid),
- the first line of its description is shown under the title,
- `kids: special` in the description pins it to the top of the day (all-day
  events pin by themselves),
- `sticker=<name>` chooses the sticker, otherwise one is guessed from the title.

The details are in `docs/architecture.md`.

### 8. Connect the MCP

**Local (Claude Code, Claude Desktop, any MCP client on your machine):** it uses
your AWS credentials and has every tool, including registering frames and setting
kid photos. Copy `.mcp.example.json` to `.mcp.json` (git-ignored) and set your
URL and profile. This is a stdio MCP configuration; adapt it to your client's
configuration format and use an absolute server path if it runs outside the
repository root:

```json
{
  "mcpServers": {
    "kids-dash": {
      "command": "node",
      "args": ["packages/mcp/dist/server.js"],
      "env": { "KIDS_DASH_API_URL": "<ApiUrl>", "AWS_PROFILE": "<your profile>" }
    }
  }
}
```

**Hosted (Claude on the web or phone, or a cloud agent):** add `McpUrl` as a custom
connector, with no client ID. Nobody can sign up; give each person access first,
using the same email as their Google account:

```sh
POOL=<McpUserPoolId>
aws cognito-idp admin-create-user --user-pool-id $POOL --username <email> \
  --user-attributes Name=email,Value=<email> Name=email_verified,Value=true \
  --message-action SUPPRESS
aws cognito-idp admin-add-user-to-group --user-pool-id $POOL --username <email> --group-name dashboard
```

**You:** add the connector in Claude's settings and sign in with Google. The very
first sign-in can fail once with a "linked" error; signing in again works. The
hosted MCP leaves out the frame tools (devices, frame settings, outages) and kid
photos. Those stay on the local MCP, which uses your AWS credentials.

Things to do through the MCP now:

- `set_kid_photo` for each kid (local only; give the agent the photo files). It's
  shown as their avatar.
- `set_chore` for the morning, after-school and evening chores the kids tick off.
- `set_note` for one-off reminders ("Library book goes back today").
- `preview_dashboard` shows exactly what the frame will show.

### 9. Optional: slideshow and alerts

**Slideshow.** After 5 minutes untouched in the daytime, the frame plays photos and
videos from a Google Drive folder. **You:** make a folder and share it (Viewer) with
`kids-dash-sync@<project-id>.iam.gserviceaccount.com` in Drive. The agent puts
its id (the last part of the folder URL) in settings as `slideshowFolderId`.
Remember that `PUT /admin/settings` replaces the whole record, so send everything
again (`get_settings` / `update_settings` in the MCP make that easier). HDR HEVC
videos are converted on the server to SDR H.264 before the Frameo downloads them.

**Alerts.** To get an email when a frame hasn't checked in for an hour, and when
it's back:

```sh
aws sns subscribe --topic-arn <AlertTopicArn> --protocol email --notification-endpoint <address>
```

**You:** click the confirmation link SNS sends.

### 10. Build the frame app

The app has the API URL and the bundle signing public key compiled in, and it
refuses any bundle not signed by that key. Point it at your deployment:

```sh
node packages/mcp/dist/cli.js signing-key     # prints {"keyId", "publicKeyPem"}
```

Copy `packages/frame-android/frame.config.example.json` to
`packages/frame-android/frame.config.json` (git-ignored). Fill in those two fields
and `"apiUrl": "<ApiUrl>"`. Then build:

```sh
pnpm turbo run build --filter=@kids-dash/frame-android
```

The APK is `packages/frame-android/build/kids-dash-frame.apk`. The first build
creates the app signing key `local/frame/frame-signing.p12` (+ `.pass`, both
git-ignored). **Back it up.** Android installs an update only if it's signed with
the same key, so losing it means re-installing every frame by hand.

### 11. Install the frame

The agent's machine must be on the same network as the frame. Start with the
[Wi-Fi ADB connection instructions](docs/device/frameo.md#connecting), including
the macOS "No route to host" workaround. Read the
[device precautions](docs/device/frameo.md#do-not) before working on the frame.
These instructions assume ADB and root are already enabled; they do not cover
unlocking a stock Frameo.

**You:** have the frame on Wi-Fi with ADB and root working, and give the agent its
IP address. If `adb` asks to authorize the computer, accept it on the frame's
screen.

```sh
export FRAME_ADB="<frame-ip>:5555"
adb connect "$FRAME_ADB"
```

1. **Register the frame** with `register_device` in the local MCP (give it a name
   such as "Kitchen frame"). The token is shown once. Save it as
   `local/frame/device.json` in the form `{"token": "<token>"}`. For a second
   frame, use another file name and set `FRAME_DEVICE=<file name without .json>`
   when provisioning.
2. **Install** the app, make it the Home app and start it:
   `pnpm --filter @kids-dash/frame-android frame:install`
3. **Provision** the token (it needs root):
   `pnpm --filter @kids-dash/frame-android frame:provision`
4. **Make it device owner** so it can install its own updates silently:
   `node packages/frame-android/scripts/frame.mjs owner`
   Android only allows this while no accounts are signed in on the device.
5. On a Frameo, disable the stock app so it doesn't compete for the screen:
   `adb -s "$FRAME_ADB" shell pm disable-user --user 0 net.frameo.frame`

Within a minute the frame shows your dashboard. `list_devices` shows when it last
checked in and which app version it runs. After this, the frame needs no cable or
ADB. It polls the API over Wi-Fi, keeps the last good dashboard if Wi-Fi drops,
and reports every outage of 5 minutes or more (`list_incidents`).

Each frame can have its own settings: its own slideshow folder, and a greeting
such as "Good morning, Nana!" for a grandparent's frame (`set_device_settings`;
it replaces all of the frame's settings, so send every field).

### 12. Updating

- **Backend:** `pnpm run deploy`.
- **Frame app:** build as in step 10, then publish. Every frame on an older
  version installs it within a couple of minutes:

```sh
pnpm turbo run build --filter=@kids-dash/frame-android
node packages/frame-android/scripts/frame.mjs publish
```

Build through turbo as shown. `pnpm --filter @kids-dash/frame-android build`
packages a stale dashboard page.

### Separate test copy

`pnpm --filter @kids-dash/infra exec cdk deploy --all -c stage=dev` deploys an
independent `KidsDash-dev-*` copy. It needs its own `kids-dash/dev/google-sign-in`
secret, with its own redirect URI (`kids-dash-dev-…`). The setup scripts in
`scripts/google/` assume the `prod` stacks.

### Troubleshooting

| Symptom | Look at |
| --- | --- |
| Deploy fails on `google-sign-in` | The secret from step 4 is missing, or it's in another region. |
| `setup-calendars.mjs`: "does not hold a service account key" | Run step 3 again. |
| Events don't show up | `sync_now`, then check that each kid's `calendarId` is set in `get_settings`. The sync runs every 15 minutes. |
| Slideshow is empty | The folder isn't shared with the service account, or the Drive API isn't enabled (step 3). |
| Hosted MCP returns 401 or refuses sign-in | The person needs a Cognito user in the `dashboard` group with their Google email (step 8), and must be a test user on the consent screen. Refusals are logged as "access token refused" in the MCP function's log group. |
| Frame stays blank | Provision again (step 11.3), and check `adb -s "$FRAME_ADB" logcat -s KidsDash`. |
| Frame stays on an old version | It isn't device owner (step 11.4), or the new APK was signed with a different key. |
| `adb`: "No route to host" on macOS | **You:** start the ADB server from Terminal.app (`adb kill-server; adb start-server`); see the [macOS ADB workaround](docs/device/frameo.md#macos-start-the-adb-server-from-terminal). |

Day-to-day operations (logs, outages, alerts, key rotation) are covered in
`docs/operations.md`.

### Sharing a copy

Deployment settings belong in the ignored `.mcp.json` and
`packages/frame-android/frame.config.json`; share their `.example.json` templates
instead. Keep `local/`, `.env` files, build outputs, keystores and ADB keys out of
any shared copy. The preview and test family is example data, not a deployment
configuration.

A clone carries every earlier commit, including any deployment details later
removed. To publish, export a committed revision into a new repository instead
of pushing this one or zipping the working directory:

```sh
mkdir ../kids-dash-pub
git archive HEAD | tar -x -C ../kids-dash-pub
cd ../kids-dash-pub && git init -b main && git add -A
pnpm audit:share
```

`pnpm audit:share` checks source files for common credentials, cloud
identifiers, private LAN addresses and personal paths. It does not read Git
history or image metadata, and it does not prove that arbitrary data is safe to
publish. Review assets and metadata separately. Keep your own deployment in the
original repository.

The Android versionCode comes from the Git commit count. Rewriting or resetting
history makes new APK versionCodes lower than existing releases, and a frame
refuses an update with a lower versionCode. Use a fresh deployment for a
shared project; an existing deployment needs a versionCode above its current
release before it can accept another update.
