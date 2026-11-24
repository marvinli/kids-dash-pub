# kids-dash: agent instructions

Read `docs/architecture.md` before changing code, and `docs/device/frameo.md`
before touching the frame.

## Start here

- Read [README.md](README.md) for setup and [docs/operations.md](docs/operations.md)
  for an existing deployment. Work from the repository root.
- Use Node 24 and pnpm 9 (`packageManager` pins the version). Run
  `pnpm install --frozen-lockfile`, then `pnpm lint` and `pnpm coverage`.
- Coverage includes Java tests: install JDK 17 and set `JAVA_17_HOME` or
  `JAVA_HOME`. Android SDK, AWS credentials and frame config are not needed for
  those tests. `pnpm synth` additionally needs a running Docker engine.
- For a local UI preview, run `pnpm --filter @kids-dash/frame-web dev` and open
  `packages/frame-web/dist-dev/index.html`. It uses example data and needs no
  cloud account or frame.
- Deployment values are local: copy `.mcp.example.json` to `.mcp.json` and
  `packages/frame-android/frame.config.example.json` to `frame.config.json` in
  the same directory only when configuring a deployment. Never invent or reuse
  someone else's endpoint, profile, key, device address, calendar or folder ID.
- For authorized deployment work, confirm the intended AWS account and region
  from the operator's configuration and `aws sts get-caller-identity`. Keep
  `AWS_REGION` and `CDK_DEFAULT_REGION` consistent. Routine development and
  checks do not require deploying or contacting a frame.
- `pnpm audit:share` checks source files for deployment identifiers and credential
  patterns; it also runs with lint. It does not inspect ignored private files,
  image metadata or Git history. Keep the manual sharing review in the README.
- Before any frame or ADB work, read "The frame" below: never invalidate eMMC
  bootloader headers, never kill a working Terminal-started ADB server, and
  keep the existing ADB keys.

## Repository rules

- pnpm workspaces + turbo. Packages under `packages/`: `core`, `api`, `infra`,
  `mcp`, `frame-web`, `frame-android`. Package names are `@kids-dash/<dir>`.
- `core` is pure: no I/O, no `node:` imports, no AWS SDK. Only dependency: zod.
- `api` has three layers. `handlers/` parse and authorize requests and shape
  responses. `services/` hold use cases and depend only on the ports in
  `services/ports.ts`. `adapters/` implement those ports against DynamoDB, KMS,
  S3, Google and Open-Meteo. Handlers never import adapters except in the
  composition root `handlers/wiring.ts`.
- `mcp` contains no business logic: it validates tool input and calls the admin API.
- Events live in Google Calendar only: add, change and delete them there (the
  dashboard syncs it). Don't add another way to write events (admin routes,
  MCP tools, a store of their own); the admin API only lists them.
- `frame-web` has no network access and renders only what the shell pushes in.
  `frame-android` verifies every bundle before the page sees it; keep that
  boundary. Performance rules for the frame are at the top of
  `packages/frame-web/src/styles/app.css` (measured, not guessed).
- Every change keeps `pnpm lint` and `pnpm coverage` green. New behaviour gets
  tests; services are tested against in-memory fakes, adapters against mocked SDK
  clients or `fetch`.
- Commit messages: conventional commits (`feat(api): …`, `fix(core): …`).

## Private material

`local/` (git-ignored) holds device recovery evidence, bootloader backups, ADB
authorization state and the throwaway prototype. Never commit, upload or copy it
elsewhere. The pre-commit hook refuses it; do not bypass the hook.

## The frame

For a frame with Wi-Fi ADB and root, get its address from the operator and set
`FRAME_ADB=<ip>:5555`. Use `adb -s "$FRAME_ADB"` explicitly. Reuse an existing
Terminal-started ADB server; if the agent gets "No route to host", ask the user
to restart the server from Terminal. Preserve the ADB keys. Never invalidate
eMMC bootloader headers.
