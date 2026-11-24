# Architecture

A kawaii morning dashboard for the kids on a Frameo photo frame: today's
weather and what to wear, each kid's day (specials pinned first), the week's
special days, and a chore checklist the kids tap.

```
 emails, calendars, "add X"                     Open-Meteo
          │                                         │
       [agent] ─ Google Calendar MCP ─▶ Google Calendar
          │                                 │       │
          └─ kids-dash MCP (stdio) ─SigV4─▶ admin API (IAM)        sync Lambda (every 15 min)
                                              │                      │
                                              ▼                      ▼
                                           DynamoDB ◀──── calendar + weather snapshots
                                              │
                         frame ─Bearer device token─▶ device API ─▶ bundle (signed with KMS)
                                                       chore check-offs
```

## Sources of truth

| What                                                              | Where                                             | Written by                                             |
| ----------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------ |
| Dated events (activities, field trips, playdates, no-school days) | Google Calendar                                   | the agent via a Calendar connector, or people directly |
| Family settings: kids, their calendars, timezone, location        | DynamoDB `SETTINGS`                               | MCP `update_settings`                                  |
| Chores per kid                                                    | DynamoDB `CHORE#<kid>`                            | MCP chore tools; the frame (add only)                  |
| Dated notes ("Library book goes back today")                      | DynamoDB `NOTE#<date>`                            | MCP note tools                                         |
| Chore check-offs                                                  | DynamoDB `DONE#<date>`                            | the frame                                              |
| Kid photos                                                        | private S3 bucket                                 | MCP `set_kid_photo`                                 |
| Devices, each frame's own settings, reported app version          | DynamoDB `DEVICE` (hashed tokens)                 | MCP device tools; the frame (`X-Frame-Version`)        |
| Slideshow mirrors (one per Drive folder in use)                   | DynamoDB `SNAPSHOT/SLIDES#<folder>`, S3 `slides/` | the sync Lambda                                        |
| Slideshow video conversions (kept 30 days)                        | DynamoDB `VIDEO`, S3 `slides/<sha256>.mp4`        | the converter Lambda, started by the sync              |
| Current frame app release                                         | DynamoDB `SNAPSHOT/APP`, S3 `app/<sha256>.apk`    | `PUT /admin/app` (CLI, not MCP)                        |
| Backdrop paintings the app downloads (never replaced)             | S3 `art/<sha256>.webp`                            | `frame.mjs publish` (`POST /admin/art/upload`)         |
| Frame outage reports (kept 90 days)                               | DynamoDB `INCIDENT`                               | the frame, once back online                            |

Google Calendar is the source of truth for anything with a date because people
already read and edit it on their phones, and mistakes are fixed there. Things a
calendar models badly (chores, completion, notes, photos) live in DynamoDB.

## Calendar conventions

Each kid has a Google calendar, plus one shared calendar for everyone, listed in
settings. The calendar decides whose column an event lands in. The event's
description is read like this:

```
Sneakers on · packed lunch          ← first line: the note the kids see
The bus leaves at 9. Back by 2:30.  ← details: shown when the item is tapped
kids: special, badge=Field trip, sticker=bus   ← directives line
Anything else is for parents only and never shown.
```

Details are the lines between the note and the directives line, so they need a
directives line (a bare `kids:` is enough); without one, everything after the
note stays parents-only. Tappable items carry a small "more" tag; the details
sheet closes on any tap, on a screen change, or after 45 seconds.

Directives (comma-separated, any order): `special` pins the event as a big block
at the top of the kid's column; `badge=<text>` labels it (default derived from the
sticker); `sticker=<id>` picks the art (otherwise inferred from the title:
"soccer" → soccer ball, "playdate" → house, "birthday" → cake…); `hide` keeps the
event off the frame. All-day events appear in the week strip; an all-day event on
the shared calendar whose title says "no school" gets the sleepy-school sticker.

The parsing rules are pure functions in `packages/core/src/calendar/`.

## Events added on the frame

The week screen's "+" posts `FrameEventInput` (core `contract.ts`) to
`POST /v1/events`. The device API writes it straight to Google Calendar, which
stays the only source of truth: a kid's event goes to that kid's `calendarId`,
an everyone event to the first of `sharedCalendarIds`. Timed events last an
hour (an end past midnight lands on the next day; the times are sent with the
family timezone's offset, so DST is handled); all-day events cover one day.
The description is

```
kids: sticker=<id>                ← only if a sticker was picked; else a bare "kids:"
Added on the <device name> frame. ← parents-only (after the directives line)
```

so the frame shows no note or details, and the sticker is either the picked one
or inferred from the title as usual. Right after the insert the API re-syncs the
calendar snapshot only (not weather or slides), so the next bundle poll shows
the event; the response is `201 { event: { id: "g-<google event id>" } }`, the
id the event has in the bundle. Dates must be from yesterday to a year ahead,
and a frame may add at most 20 events per clock hour (DynamoDB `COUNTER` row,
then `429`).

The form also has a Notes box: its first line becomes the event's note and the
rest its details (the conventions' top part), placed above the directives line.

## Events edited on the frame

On Today, the week screen and a day's "+N more" sheet, every Google event opens on
tap, details or not; its sheet has an Edit button that opens the add form
filled in, with a day stepper. Saving sends `FrameEventEdit` (core
`contract.ts`: the add fields plus `from`, the day it was opened on, and
`scope`) to `PUT /v1/events/{g-<google id>}`. The API reads the event back from
Google (trying the calendar it should end up on first, then every family
calendar), then patches it there:

- the title, and times: a timed event keeps its length (an hour if it was all
  day); an all-day event keeps how many days it covers and moves by
  `date − from` days;
- the description through core `withKidsText`: only the kid-facing note and
  details change; the directives line and parents-only lines stay (a picked
  sticker replaces `sticker=`; a directives line is added when something has to
  stay below it). An HTML description from Google's web UI comes back as plain
  text;
- a new owner moves the event to that calendar first (`events.move`).

Repeating events show "Just this day / Every time". Just
this day patches the occurrence (Google's instance id), which can change day
and time but not owner: Google can't move one occurrence to another calendar.
Every time patches the series (`recurringEventId`): title, notes, sticker and
time of day, keeping its first day; the day, owner, and all-day-vs-timed can
only change for one day (`400` otherwise). Occurrences already changed on their
own keep those changes. Edits share the add budget (20 per frame per hour),
answer `200 { event: { id } }`, refresh the calendar snapshot, and a refused
Google write is `403`, a vanished event `404`. The shell reports `invalid`
(400), `refused` (403/404/409/429) or `offline`, and the form says which.
Every event comes from Google Calendar; there is no separate event store
(the admin API and MCP only list them).

The edit form also has Delete, which asks first ("Delete this event?", or for
a repeating event "Delete just this day?" / "Delete every time it repeats?"
following the scope switch). It sends `DELETE /v1/events/{g-<google id>}?scope=one|all`
(a query, since DELETE bodies are unreliable on Android 8): one cancels the
occurrence (Google's instance id), all deletes the series with every
occurrence, past ones included. Deletes share the 20-per-hour budget, answer
`204` and refresh the snapshot; an event already gone is `404`, which the
shell treats as deleted.

This is why the service account's token asks for the read-write
`calendar.events` scope (Drive stays `drive.readonly`); it owns the Kids
calendars, so no domain-wide delegation or extra consent is involved.

## The rail and the joke of the day

Today's right edge is a rail of round buttons: the photos on top (when the
frame has slides), then the fun modes (the joke), sleep at the foot. New modes go in
the rail. The joke of the day lives in the page (`frame-web/src/jokes.ts`,
no network): one fixed shuffled order, four a day (the joke of the day, then
three bonus ones behind "Another one!"), so every frame tells the same joke
and none repeats until all have been told. The setup shows first; "Tell me!"
reveals the punchline. The Joke button says NEW until today's joke is heard.

## Trivia

The sync fetches three multiple-choice questions a day from The Trivia API
(`api/src/adapters/trivia-api.ts`; keyless, free for non-commercial use under
CC BY-NC 4.0, so the frame shows a credit). It asks for the family content
filter, easy and medium, no niche questions, in science, geography, food,
general knowledge and history (sport, society and culture, film and music
skew grown-up), and drops anything matching a small blocklist (drink, drugs
and the like) as a second guard. The `SNAPSHOT#TRIVIA` row keeps today's
questions and the last 3,000 ids asked, so none repeats. Answers are shuffled
once on the server, so every frame shows the same order. The family plays
as a team from the rail's Trivia button: a pick lights up the right answer,
the score comes after the third, and closing and reopening picks up where
they left off. No questions today (the source failed): no button.

## On this day, and the day's place

Two more rail modes, fetched by the sync once a day (`api/src/adapters/wikimedia.ts`,
keyless; text CC BY-SA, credited on the frame) into `SNAPSHOT#TODAY`:

- **History:** Wikipedia's "On this day" feed (editors' picks first, then the
  full list). Most entries are wars, disasters and crimes, so anything matching
  a long blocklist is dropped; three kid-suitable ones are kept, oldest first,
  with one picture embedded as a `data:` URL.
- **Places:** country, US state and big city take turns by day. The candidates
  (everything of the kind with a locator map and an English article) come from
  one Wikidata SPARQL query per kind, cached a month in `SNAPSHOT#PLACES#<kind>`,
  to tolerate query-service rate limits; a stale list keeps serving. Each day one
  not shown in the last 500 is picked; its locator map comes from Commons at 420 px (embedded
  in the bundle), its facts from Wikidata (capital or country, people, size in
  square miles) and two sentences from its Wikipedia summary.

## Chores across the days

Today shows each kid's chores as a count ("2 of 5 done") that opens the
Chores screen; the week strip and each Week screen day show a count per kid
("A 2/5"), and a day's count opens the Chores screen on that day. The Chores
screen steps day by day (arrows either side of the date) through the bundle's
`days`. Each day in `days` and `week` carries each kid's chores with their done
state (`DayChores`): today's from today's check-offs, earlier days' from their
`DONE#<date>` rows, days ahead never done.

Check-offs (`PUT /v1/chores/{kid}/{chore}` with a date) are accepted from
`checkOffFrom` (core: last week's Monday, the week screen's first page) to
today, so a missed day can be caught up; days ahead show their chores but
cannot be ticked. `DONE#` rows are kept 21 days, longer than that window. The
shell answers `choreSaved`/`choreFailed` with the date, so the page matches
the answer to the tap.

## Chores added on the frame

The Chores screen's "Add chore" posts `FrameChoreInput` (core `contract.ts`) to
`POST /v1/chores`: the kid, a title, the period (morning, after school,
evening), the weekdays (empty means every day) and a sticker (the form guesses
one from the title with core's `inferChoreSticker`; a tap overrides it). The
device API stores it as a normal `CHORE#<kid>` row, the same thing MCP
`set_chore` writes: the id is a slug of the title (`-2`, `-3`… when the kid
already has one), and it goes after the kid's other chores. The response is
`201 { chore }`, and the shell re-polls so it shows at once. A kid may have at
most 30 chores, and a frame may add at most 20 per clock hour (`COUNTER` row,
then `429`). Editing and removing chores stays with the MCP.

## Outages and the Wi-Fi watchdog

A frame that cannot reach the API keeps an outage record on disk
(`files/outage.json`: when its last good poll was, the worst Wi-Fi state it saw,
whether the screen was dark, and whether it rebooted). At the first good poll
after an outage of five minutes or more it posts `FrameIncidentInput` (core
`contract.ts`) to `POST /v1/incidents`; shorter blips are dropped. The API
stores the report (`INCIDENT` rows, 90 days, at most 12 per frame per hour) and
logs it as a `frame was offline` warning, so CloudWatch has every one with the
frame's id and name. `list_incidents` / `GET /admin/incidents` lists them
without logs; `get_incident` / `GET /admin/incidents/{id}` includes the log.

Wi-Fi states: `connected` (on the network, API unreachable: the internet or
the API was down), `disconnected` (not on Wi-Fi, but networks are around or
scans are unreadable), `no-networks` (not on Wi-Fi and no scan has seen a
network for five minutes: the frame's own chip has gone quiet). `reboot` is
`none`, `watchdog`, or `other` (it booted for another reason, usually a power
cycle).

The watchdog (`OutagePolicy` in frame-android) handles both `no-networks` and
persistent `disconnected` states. It first reloads the driver, including while
the screen is dark, retrying with backoff. A reboot is a fallback after at least
15 minutes of outage and uptime and three minutes of reload attempts while lit;
it never reboots with a dark screen or while Wi-Fi settings are open, and acts
at most once an hour. Outages of ten minutes keep a network log excerpt even
before a reboot, so the next report retains evidence after a power cycle.
See [the frame guide](device/frameo.md#wi-fi-reliability).

`WifiPower` also reloads the AIC driver once per boot with `ps_on=0` and a
25 MHz SDIO clock. The driver cannot change power saving at runtime. A failed
startup reload is remembered; the watchdog handles subsequent recovery.

Alerts: the watch function emails (SNS) when a frame has been quiet for an
hour and when it is back; see docs/operations.md.

## The bundle

The frame renders exactly one document, `DashboardBundle`
(`packages/core/src/bundle/schema.ts`): date, weather (high, low, rain chance, sunrise and sunset),
each kid's today (specials, activities, notes, chores with done state) and the
seven-day week. The API assembles it per request from DynamoDB with the pure
`assembleBundle` in core, so chore check-offs and edits show up on the next poll
without a publish step.

The response is an envelope `{ payload, signature, keyId }`: `payload` is the
base64url JSON bytes and `signature` is ECDSA P-256 / SHA-256 over those bytes by
a KMS key whose private half never leaves KMS. The frame verifies with the public
key compiled into the app before rendering. Signing over raw bytes avoids JSON
canonicalization entirely. The frame polls with `If-None-Match`; unchanged
bundles are a `304`.

The bundle is built per frame: it names the frame (`device: {id, name}`), uses
that frame's settings where it has its own (`slideshowFolderId`, falling back
to the family's, and `greetingName`, carried as `device.greetingName`), and carries the current app release (`app:
{versionCode, versionName, sha256}`) so frames update themselves over the air.
The APK download is paced (about 384 KB/s) and resumable: pulling it flat out
can make the reference hardware lose Wi-Fi mid-download, so a cut download keeps
`update-<sha256>.part` and the next poll asks S3 for the rest (`Range`; the
presigned GET honours it). A cut is not a failure; only a hash mismatch or a
refused install holds the release off for six hours.
Slides download the same way (`<sha256>.part` next to them in `slides/`):
converted videos can reach tens of MB and need the same Wi-Fi pacing.
The sync mirrors every slideshow folder in use (the family's plus each active
frame's override) under `slides/<sha256>.<ext>`; a file shared by folders is
stored once and deleted only when no folder in use refers to it. The admin
preview (`GET /admin/bundle`) is the family view unless `?deviceId=` is given.

Videos are converted before the frame sees one: its decoder plays 8-bit H.264
up to 1080p, not the 10-bit HDR HEVC phones record. The sync never downloads a
video. For a new one (source up to 1.5 GB and 2 minutes) it records a
`VIDEO/<sourceId>#<version>` conversion as pending and invokes the converter
Lambda asynchronously (at most two per run). The converter streams the
original from Drive to `/tmp` and runs ffmpeg (a static arm64 build in a layer,
`packages/infra/lib/ffmpeg`). It tone-maps HLG/PQ to SDR BT.709, fits within
1920×1080, caps at 30 fps and 4 Mbit/s, and drops the sound. It stores
`slides/<sha256>.mp4` and records the conversion as done. The next sync takes
it as a `converted` slide, replacing any unconverted copy from before. A
conversion still pending after 20 minutes, or one that failed 6 hours ago, is
started again, three attempts per version at most.

The "what to wear" tip is not in the bundle: `wearTip` in core derives it from the
weather, and the app runs the same function. It dresses for the morning (a third
of the way from the day's low to its high), not the afternoon high.

Nor is the backdrop: the app picks the painting from the date
(`frame-web/src/backdrop.ts`) and its light from the clock and the weather's
sunrise and sunset (`frame-web/src/sky.ts`). A holiday's painting shows around
it (overlapping holidays take turns a day each; Jewish holidays and Lunar New
Year come from date tables checked against
the Hebrew and Chinese calendars in the tests); other days rotate one painting
a day, alternating the season's paintings with fun year-round scenes, each list
shuffled so nothing repeats until all have shown. Each painting comes in day,
dusk and night versions (`assets/art/source/bg-<name>[-dusk|-night].png`,
prepared by `scripts/art/prep.py`); around sunrise and sunset the page steps a
`-webkit-cross-fade()` between neighbours (night → dawn → day → dusk → night), one
static repaint per step. Without sun times it assumes 06:45 and 17:45.

`prep.py` also writes `frame-web/src/backdrops.json`: the scenes with all three
versions (only those can be picked, so new art needs no code change) and how
bright each painting is behind the header. The header text sits straight on
the painting, so its ink (dark, or light with a hard shadow) is whichever
contrasts more with that measured brightness at the current blend; space or
the deep sea can be dark at noon. Paintings keep the top ~18% plain for it.

The app carries only the four season originals (`winter`,
`spring`, `summer`, `fall`), so there is always a backdrop and an update
stays near 7 MB instead of 36 MB. frame-web's build lists the other
paintings' files in `art-remote.txt` (`<sha256> <name>`); `frame.mjs
publish` uploads any that storage lacks to `art/<sha256>.webp` before the
release. After installing, the shell downloads them one at a time after the
slides (`GET /v1/art/{sha256}`, paced and resumable like slides, checked by
hash) into `files/art/<sha256>` (`ArtLibrary`), serves `art/<name>` from
there when the app does not have it, and tells the page what it has
(`setArt`). A painting joins the rotation once all six of its files are in,
so a frame that just installed shows fewer paintings for a few minutes.

## Security

- The frame holds one device token (`<deviceId>.<secret>`, 256-bit secret). Only
  its SHA-256 is stored; a Lambda authorizer checks it in constant time. A token
  can read the bundle, fetch photos and the app build named in it, report its
  app version and its outages, record chore check-offs, add a chore, and add an event
  to the family's Kids calendars, and nothing else. Revoke a device
  with the MCP. Agent credentials cannot reach device or app routes.
- The admin API uses IAM auth (SigV4). The MCP signs with the caller's local AWS
  credentials; nothing is exposed without them.
- The hosted MCP (`/mcp`) accepts only OAuth sign-ins: Cognito access tokens
  with the MCP scope, from an admin-made account in the `dashboard` group.
  Agent and device tokens are refused there.
- The Google service account key lives in Secrets Manager and is read by the
  functions that call Google: sync, admin and MCP (`sync_now`), and device
  (frame-added events). It can read and add events on the Kids calendars it
  owns and read the shared Drive folders, and nothing else.
- Photos are in a private bucket (no public access, TLS only); the device API
  answers a photo request with a five-minute presigned URL, and the bundle carries
  each photo's SHA-256 so the frame can check what it downloaded.

## Packages

| Package         | Role                                                                                                                                                                             | Depends on                    |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `core`          | Domain types, bundle schema (zod), calendar conventions, week/today assembly, wear tips, date helpers. Pure: no I/O, no Node or AWS APIs. Runs in Lambda, the MCP and the frame. | zod                           |
| `api`           | Lambdas. `handlers/` (routing, auth, HTTP shape) → `services/` (use cases, written against ports) → `adapters/` (DynamoDB, KMS, S3, Google Calendar, Open-Meteo).                | core                          |
| `infra`         | CDK: data stack (table, photos bucket, signing key, Google secret) and API stack (HTTP API, authorizers, Lambdas, schedule).                                                     | — (bundles `api` entry files) |
| `mcp`           | stdio MCP server for agents. Tools validate input with core's schemas and call the admin API; no business logic.                                                                 | core                          |
| `frame-web`     | The dashboard page: plain TypeScript and CSS, fixed 1920×1080, no scrolling, no network. Renders the bundle pushed in by the shell.                                              | core                          |
| `frame-android` | Kiosk shell: fetches and verifies the signed bundle, caches it, fetches photos, sends chore check-offs, serves frame-web from an app-only origin. Plain SDK build, no Gradle.    | frame-web (assets)            |

Where code goes: a pure rule used by more than one package → `core`; anything
that does I/O on the server → `api` (service if it is a use case, adapter if it
talks to something external); `mcp` only translates tool calls to admin API calls.
