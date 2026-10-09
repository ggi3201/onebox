# Changelog

What changed in each onebox plugin, newest version first. To get a new
version, run this in a shell (`/plugin update` is not a command inside a
Claude Code session), then type `/reload-plugins` in your session:

```
claude plugin marketplace update onebox
claude plugin update <plugin>@onebox
```

In Codex:

```
codex plugin marketplace upgrade onebox
codex plugin add <plugin>@onebox
```

A plugin updates only when its version went up. Guides are not in a plugin:
the skills read them from the site, so a guide fix reaches you without an
update.

## start

### 0.2.14 (2026-10-09)

- `new-app`: the links to the test-loop snippet and the CocoaPods pitfalls
  work in an installed plugin. The questionnaire's bundle identifier follows
  the name the user picks, and the slug line is always said. The domain
  option is gone: a user with a domain types it under "Other".
- `new-app`: CI uses checkout v7, setup-node v7, setup-dotnet v6 and
  pnpm/action-setup v6. AGENTS.md says that local builds with the global
  `eas` win over Expo's `npx eas-cli@latest` advice. The Node API gets a test
  for the trusted-proxy path.
- `plan`: the Node floor is 22.18 (a Node API runs `src/server.ts`
  directly). The pnpm fix first removes a corepack pnpm, which made
  `npm install -g pnpm` fail with `EEXIST`.

### 0.2.13 (2026-10-09)

- `plan` detection: `app.json` and `eas.json` with comments or trailing
  commas are read. Asset folders are skipped, and a walk that stops at its
  file limit says so. Firebase counts as a backend only for Firestore,
  Database, Functions, Auth or Storage, not Crashlytics alone. Supabase,
  Convex and Firebase functions next to an app at the repo root count as
  server code. RevenueCat and Sentry are ticked when the app also calls
  `Purchases.configure()` / `Sentry.init()`.
- `plan`: a plan written with `--out` is found by later runs, `ready`,
  detect and `check-features`. RevenueCat comes after the App Store Connect
  key, and the feature check just before `app-store-ready`. New items:
  `media-providers` and `draw-icon-set`. Lines the planner wrote are
  remembered by hash, so after an update its old words are dropped, not kept
  as your notes. A plan header that does not parse, or a bad answer in it,
  is named. A missing `--repo` folder is a plain error. The SSH key need
  accepts any key in `~/.ssh` or in the SSH agent.
- `check-features`: non-Latin feature lines get their own ids, and a line
  skipped because its id is taken is named. A pass with no `Feature:` line
  does not count. A run through a symlink works.

### 0.2.12 (2026-10-09)

- Internal: the plan's detection no longer looks for Xcode when run with
  `ONEBOX_DETECT_NO_RUN=1`, so the example plan is the same on every machine.

### 0.2.11 (2026-10-09)

- `/start:plan` checks plugin installs in the agent that runs it: Claude Code
  (a project install counts only in its folder) or Codex, and its fix says
  how to install in both.
- `/start:new-app` sets the app's slug and name, writes `eas.json` without
  placeholders, and runs `eas init` so it works in an agent's shell. The plan
  no longer reads the guides' placeholder `ascAppId` as an App Store record.

### 0.2.10 (2026-10-09)

- The tools check asks for Node 22.13 or later, which Expo SDK 57 needs.

### 0.2.9 (2026-10-09)

- `/start:plan` keeps code blocks in your notes, and drops the ticks an old
  answer made when you change that answer. Your own ticks stay.

### 0.2.8 (2026-10-09)

- `/start:plan` checks a secret the same way the scripts read it, including
  your `secrets.command`.

### 0.2.7 (2026-10-09)

- The plan's "Import from a shared link" step no longer needs an LLM key or
  your own box: it is the share extension.

### 0.2.6 (2026-10-07)

- `/start:new-app`: the root `.gitignore` keeps `.env` and `.env.*` (the
  default place for secrets), `build/` and `.ipa` files out of git and out of
  EAS uploads, in both layouts. In an existing app, add these lines yourself.
- Node API: the row-level security policy also refuses rows outside `asUser`
  on a reused connection. .NET API: per-IP limits group IPv6 by /64.

### 0.2.5 (2026-10-07)

- New optional plan step "Product analytics", with a guide. It adds PostHog
  before your first public release: the EU region, a small wrapper with named
  events, an opt-in, and the privacy paperwork. It is listed after "crash
  reports" and is never the "Next" step.

### 0.2.4 (2026-10-07)

- New plan step for an AI app on Supabase, Convex or Firebase: "A cost
  budget per user on your hosted backend". Its guide adds a per-user daily
  AI count, a cap on each request and an app-wide daily budget.

### 0.2.3 (2026-10-07)

- `/start:new-app` builds the API protected from the first commit, in .NET
  and in Node: the real client IP behind the tunnel, a rate limit per user
  or IP, a stricter `auth` limit for the sign-in routes to come, and a
  request body size limit. Two new tests check the 429 and the 413.

### 0.2.2 (2026-10-07)

- `/start:plan` ticks the backend only when the API is protected too: the
  real client IP, a rate limiter and, in .NET, a body size limit. It sees the
  per-user AI usage count, and an AI key inside the app.
- "No server" with AI chat or import is now a conflict the plan asks about,
  and "no accounts" with AI is a warning. The site's picker shows both.

### 0.2.1 (2026-10-04)

- `/start:plan` and `/start:new-app` ask their questions with any agent's
  question tool, not only Claude Code's. Without one, they ask in one
  numbered message, as before.
- The Install section of `PLAN.md` says how to add the plugins in Codex.

### 0.2.0 (2026-10-04)

- New skill `/start:check-features`. It checks that every feature you asked
  for has a flow that passed on the current code, and says the next gap.
- `/start:plan` now asks what the app should do and writes `FEATURES.md`.
  The site's picker has the same question. Sign-in, payments and AI steps
  add their own features, with what the proof must show.
- New plan step "Check that every feature works". It is ticked only while
  every feature's flow passes.

### 0.1.17 (2026-10-01)

- New plan step "Submit for review", the last launch step, with a guide that
  walks the version page field by field.
- Its nudge says the App Privacy answers are your part: the API cannot fill
  them in.

### 0.1.16 (2026-10-01)

- Two new plan steps, each with a guide. "Ship an update" covers version 1.1
  and later: build or EAS Update, backend first, phased release, and what to
  do when a release goes wrong. It is a now-and-then step, never "Next".
- "Ask for a rating" uses `expo-store-review`. `/start:plan` ticks it when
  the app calls `requestReview()`.

### 0.1.15 (2026-09-30)

- `/start:new-app` asks the app name, bundle identifier, server and sign-in in
  one questionnaire. It makes the slug from the name.
- With no domain in your config, you can pick `com.example.<slug>` as the
  bundle identifier and change it before the first upload to Apple.

### 0.1.14 (2026-09-29)

- The tool check runs with the PATH of your own Terminal. A tool that only
  the agent's app can find now shows as missing.
- `/start:new-app` lists every missing tool once, with the time each takes,
  and asks one question.
- pnpm is installed with `npm install -g pnpm@10`. Corepack is no longer
  needed, because Node 25 and newer do not ship it.

### 0.1.13 (2026-09-29)

- `/start:plan` no longer treats `docker-compose.dev.yml` as the production
  stack. The backend step now names what is really missing.
- The `/start:new-app` hand-off no longer shows a fixed "Next" line.

### 0.1.12 (2026-09-29)

- `/start:new-app` has every file for a Node API: Fastify, Drizzle,
  row-level security, Vitest with a real Postgres, CI and lint.
- The API connects as a role without superuser rights, so row-level security
  really applies. A test fails if it does not.

### 0.1.11 (2026-09-29)

- `/start:plan` ticks the tools step when all its checks pass on your Mac.
- A new sign-in answer, "later": Sign in with Apple comes after the first
  TestFlight build.
- The plan no longer asks what `/start:new-app` already answered, and lists
  only the answers that change your plan.

### 0.1.10 (2026-09-29)

- The no-server path of `/start:new-app` works as written: no fake API URL,
  no API job in CI, and an `AGENTS.md` for that layout.
- With an API, the dev client calls your own API port through
  `apps/mobile/.env.local`.

### 0.1.9 (2026-09-29)

- `/start:plan` ticks "Rent a small server" when your config has `box.ssh`.

### 0.1.8 (2026-09-29)

- Each step ends with one line, such as "Next: Sign in with Apple.
  Continue?". "Yes" is enough to go on.
- New `plan.mjs ready`: it checks only what the next step needs, and names
  one blocker if there is one.

### 0.1.7 (2026-09-29)

- A step you do now and then, like trimming the tests, is never the "Next"
  step.

### 0.1.6 (2026-09-29)

- A new .NET API from `/start:new-app` builds under the strict settings: an
  `.editorconfig` marks the migrations as generated code.
- `pnpm dev:api` runs `dotnet watch --non-interactive`, so it no longer hangs
  on a restart prompt.

### 0.1.5 (2026-09-29)

- `/start:plan` ticks Sign in with Apple only when the backend also deletes
  the account and revokes Apple's token.
- `/start:plan` ticks the `/dev:test-loop` step when the app has the checks
  and a workflow that runs the tests.
- A re-run keeps the blank lines in your own notes.

### 0.1.4 (2026-09-29)

- When a guide does not load from the site, the skills try GitHub, then a
  local checkout. If none loads, they stop and say which guide failed.

### 0.1.3 (2026-09-29)

- Fixes in `/start:new-app` from the first real run: pnpm, the .NET build
  under strict settings, the test fixture, current `create-expo-app`, and
  its own simulator.

### 0.1.2 (2026-09-29)

- `/start:plan` sees more work an older app has already done: EAS Update,
  push, Traefik, staging, secrets and the Apple team id.
- Instead of a silent open item, the plan says what is missing.
- The plan asks whether you aim for TestFlight or the App Store.

### 0.1.1 (2026-09-29)

- New plan step: install the command-line tools, with a guide for the Mac
  and the box.

### 0.1.0 (2026-09-28)

- First version. `/start:plan` looks at your app and writes `PLAN.md`.
  `/start:new-app` makes a new app repo in the layout the kit expects.

## ship-ios

### 0.1.10 (2026-10-09)

- `app-store-ready`: a placeholder API URL (`https://api.example.com`) in
  `eas.json` build env, a committed `.env` or the app code is BLOCKED. It
  passed before, and a TestFlight build then called a host that does not
  exist.

### 0.1.9 (2026-10-09)

- `app-store-ready`: an icon whose RGBA pixels are all opaque passes; only
  real transparency fails. The purpose string rule no longer flags its own
  example: "generic" now means a placeholder, under 30 characters, or "needs
  access" with no reason.
- `appstore-connect`: a second `subs-create` run adds the group and product
  texts and the availability that an earlier run left out, by locale.
- `expo-local-build`: reads the nearest `.onebox.json`, so a monorepo's file
  at the repo root counts when you build from `apps/mobile`.
- `eas-update`: an update still in a rollout is undone with
  `eas update:revert-update-rollout`; `update:rollback` is for one at 100%.

### 0.1.8 (2026-10-09)

- `app-store-screenshots` and `appstore-connect`: `--app <bundle id>` acts only
  on the app with exactly that bundle id. Before, `replace` could delete the
  screenshots of `myapp.staging` when you meant `myapp`, and `submit` or
  `release` could fall back to the first app the filter returned.

### 0.1.7 (2026-10-09)

- Every skill ends with the next step from your plan, as one question.

### 0.1.6 (2026-10-09)

- `expo-local-build` and `app-store-ready` check that Xcode fits the Expo SDK:
  SDK 56 and 57 need Xcode 26.4 or later, and an app built with Xcode 27 needs
  scene support (SDK 57, `ios.enableSceneSupport`) or it does not launch on
  iOS 27.
- `eas-update` has `--source-maps`, for Sentry.
- The references note which App Store Connect resources the skills use are
  deprecated, and what to do when they stop working.

### 0.1.5 (2026-10-09)

- `expo-local-build` no longer stops without a message when the app has only
  `app.config.*`; `eas-update` no longer stops when the runtime version cannot
  be resolved.
- `app-store-ready`: no false BLOCKED for `registerRootComponent`, for
  `expo-auth-session` used for other logins, for a missing `usesAppleSignIn`
  (now a CHECK), or for an `ios.icon` with light and dark variants. A
  git-ignored `.env` no longer counts as reaching builds.
- `ios-preview-build`: a variable shared by preview and production is split
  on expo.dev first; never `--force`.

### 0.1.4 (2026-10-09)

- Secrets are read the same way in every script: the environment variable,
  then your `secrets.command` (any tool; `doppler` and `1password` are
  ready-made), then the nearest `.env`. A command that waits for a prompt
  stops after 60 s with a clear message, instead of hanging. CONFIG.md,
  "Secrets".
- `expo-local-build` writes a working `.p8` key from a secret kept on one line
  with `\n` for its line breaks, and checks it before the build.

### 0.1.3 (2026-10-01)

- `/ship-ios:app-store-ready` checks that your privacy policy and support
  page mention deleting the account. It reads the pages from the repo, or
  from their live URLs.
- New `--offline` flag: it skips fetching the live pages.
- New config keys `app.privacyUrl` and `app.supportUrl` tell it where the
  pages are.

### 0.1.2 (2026-10-01)

- `/ship-ios:appstore-connect` can submit for App Review: `review-status`
  shows what the version page still misses, and `version-set`,
  `age-rating-set`, `attach-build`, `submit` and `release` fill it in. Each
  write command has `--dry-run`.
- `/ship-ios:app-store-ready` ends with "Next: Submit for review" when
  nothing blocks.

### 0.1.1 (2026-09-29)

- The Ruby advice for CocoaPods now works with macOS `path_helper`: put the
  rbenv path in `~/.zprofile`, and set `LANG` in `~/.zshenv`.

### 0.1.0 (2026-09-28)

- First version. Skills to check App Store readiness, build on your Mac,
  talk to App Store Connect, make preview builds, screenshots, icons and the
  store listing, and publish EAS updates.

## box

### 0.1.8 (2026-10-09)

- `box-setup`: the copy step works on a mini PC too. The scripts go to your
  home, then `sudo install` puts them in `/root/`. `base` takes the keys of
  the user who ran `sudo`, so a mini PC no longer stops at "no public key".
- `box-setup`, `tunnel: none`: Traefik trusts Cloudflare's IP ranges for
  `X-Forwarded-For`, so per-IP limits count per user, not per Cloudflare edge.
- `box-setup check` says when it could not read the backup status, instead of
  "no backup has run yet".
- `expose-service`: tailnet-only hostnames are for a home box. On a VPS with
  the tunnel, `--mode private` refuses: Traefik listens on `127.0.0.1` only.
  The DNS step keeps a TXT, MX or CAA record at the same name. The audit
  checks IPv6 too, and takes `--tunnel none`.
- `staging-env`: the compose file uses production's names (`JWT_SECRET_KEY`,
  `TRUSTED_PROXIES`) and `PROXY_NETWORK`. In an env file, single-quote the
  basic-auth hash.

### 0.1.7 (2026-10-09)

- `box-setup`: the restore steps work on a new box. They restore
  `/etc/cloudflared` before the `tunnel` phase, so the same tunnel runs and DNS
  stays; connect as the database's own superuser, not `postgres`; wait for
  Postgres's real start, not a fixed `sleep`; and give root a new SSH key for
  an `sftp:` backup. Keep `backup.env` and the restic password in your
  password manager: a restore needs both.

### 0.1.6 (2026-10-09)

- `box-setup`: a box that already serves apps gets fixed in place, not set up
  again (`references/adopt.md`). It covers databases on all interfaces, an
  open Traefik dashboard, an unpinned Traefik, turning on ufw with an undo
  timer, and keeping your own backups or moving to `onebox-backup`.
- `box-setup check`: warns when Traefik runs with `api.insecure` or with an
  image that has no version, such as `traefik:latest`. The version check now
  covers a Traefik set up by hand too.

### 0.1.5 (2026-10-09)

- Every skill ends with the next step from your plan, as one question.

### 0.1.4 (2026-10-09)

- Secrets are read the same way in every script: the environment variable,
  then your `secrets.command` (any tool; `doppler` and `1password` are
  ready-made), then the nearest `.env`. A command that waits for a prompt
  stops after 60 s with a clear message, instead of hanging. CONFIG.md,
  "Secrets".

### 0.1.3 (2026-10-07)

- A GitHub runner on your box is for private repos only. `references/runner.md`
  says why, shows how to check a repo, and how to remove a runner.
- `/box:box-setup`: only the box itself can read the Traefik API; Traefik is
  pinned to v3.7.14; `--ssh-tailscale-only` and `--sudo-password` stay chosen
  on later runs; the tunnel phase deletes the login's `cert.pem`. `check`
  reports these, and warns when Docker or cloudflared updates are waiting. Run
  the `proxy` phase again to apply (Traefik restarts for a few seconds).
- `/box:expose-service` copies its scripts to a private folder on the box.

### 0.1.2 (2026-10-01)

- `/box:new-landing-page` points to sample wording for deleting the account,
  and says to make the app's Settings text match it.

### 0.1.1 (2026-09-29)

- The `box-setup` check finds container ports open to the internet. Before,
  it missed them.
- It also reads a box set up by hand: a Traefik from another compose project,
  a root-only cloudflared config, and a backup timer of your own.

### 0.1.0 (2026-09-28)

- First version. Skills to set up a server, put a service on a hostname,
  host a landing page, and run a staging backend.

## dev

### 0.1.7 (2026-10-09)

- `test-loop` preflight: one simulator per worktree no longer fails both.
  Another checkout's simulator is information, unless this checkout has no
  simulator of its own; then the fix boots a new one instead of taking that
  one. A project path with a space no longer gives two false FAILs. Every
  "Rebuild" line keeps this checkout's Metro port.
- `test-loop`: `assets/metro-port.sh`, with a shebang. The docs call it
  through `sh`, so it works without an exec bit.
- `test-loop` discover: finds flow files up to 10 folders deep, such as
  `apps/mobile/src/features/<f>/<f>.flow.md`.
- `trim-tests`: one baseline folder per test runner, so Jest and Vitest do not
  overwrite each other, under `$TMPDIR` (macOS has no `$TMP`).

### 0.1.6 (2026-10-09)

- `trim-tests` lists junk patterns: tests that cannot fail for the reason
  their name gives. It asks for written evidence before each delete.
- A hand-made bug that also survives the original suite is now reported as a
  weak test to fix, not counted as a lost test.

### 0.1.5 (2026-10-09)

- Every skill ends with the next step from your plan, as one question.

### 0.1.4 (2026-10-04)

- A flow can name the features it proves with a `Covers:` line, and the
  test loop records each flow run for `/start:check-features`.

### 0.1.3 (2026-09-29)

- `/dev:test-loop` says that `dotnet watch` needs `--non-interactive`, and
  how to stop only your own checkout's watch.

### 0.1.2 (2026-09-29)

- The preflight fails when Metro runs in CI mode, because then no edit
  reaches the simulator.
- Seed data for owned rows uses `CurrentUser.ActAs(userId)`.
- Flows show how to type non-ASCII text into the simulator.

### 0.1.1 (2026-09-29)

- Each app gets its own Metro port.
- `discover.mjs` finds a `Directory.Build.props` next to the `.sln`, not only
  at the repo root.

### 0.1.0 (2026-09-28)

- First version. `/dev:test-loop` lets the agent check its own work in the
  Simulator. `/dev:trim-tests` cuts a bloated test suite.

## app-features

### 0.2.3 (2026-10-09)

- `agent-harness`: tracing exports chat runs. Before, a chat run in a request
  exported nothing: ASP.NET Core's request activity is not recorded, and the
  sampler dropped every span under it. The run now starts as a root span when
  the request is not traced, and tool spans name the run as their parent, so
  they keep it across each `yield`. Copy `AgentTelemetry.cs` and the
  `StartTool` line in `AgentLoop.cs` into your API again.
- `agent-harness`: the chat request's timezone and item id have size caps,
  and a client can no longer send the server-only `background` view. The last
  turn must be the person's, and a photo must be JPEG, PNG, WebP or GIF with
  valid base64: these got a 200 and then a vague provider error. The SSE
  keep-alive now comes every 15 s, not up to 30 s. With `APP_EVAL=1` and no
  key, the evals fail instead of passing.
- `ai-usage-limits`: `ModelPricing.EnsureConfigured` fails the start when a
  budget is set and `Usage:Prices` is empty; before, nothing was counted. A
  `:` in a model id is written and read as `_` (`.NET` config splits on `:`).
  `IAiConsentCheck` moved to `agent-harness`'s `AgentSeams.cs`, so
  `ai-consent` and `ai-usage-limits` each build alone.
- `ai-consent`: the server accepts only consent versions up to the current
  text's.
- `durable-jobs`: register handlers with `AddJobHandler<T>(kind, safeToRetry)`;
  `Kind` and `SafeToRetry` left `IJobHandler`. A handler that needs a missing
  model key gives 503 `notConfigured` for its own kind, and no longer breaks
  every job route and the worker. The worker acts as the job's owner through
  `IJobUser`. A timeout inside a job fails it, instead of leaving it Running.
- `chat-feature`: a message the server refused is marked "Not sent" and left
  out of later requests. Before, it broke the chat until a reset.
- The C# now imports `MyApp.Api.Data`, where new-app puts `AppDb`, and CI
  builds it in an API shaped like new-app's.

### 0.2.2 (2026-10-09)

- Every skill ends with the next step from your plan, as one question.

### 0.2.1 (2026-10-09)

- `agent-harness` reads the smoke-test key as CONFIG.md "Secrets" says.

### 0.2.0 (2026-10-09)

- `/app-features:share-import` is now the share extension only: a page shared
  from Safari opens your import screen with its link, text and JSON-LD. The
  example server import (a recipe job with a model call) is gone; its lessons
  stay as advice in `references/extraction.md`. Sharing the same link twice
  now works.
- `/app-features:ai-consent`: the first AI call after "Agree" waits until the
  server has the yes. When the API still answers `consentRequired`, call the
  new `consentRefused()` and the next AI action asks again. The chat feature
  has a `consentRefused` slot in `config.ts`.

### 0.1.3 (2026-10-07)

- `ai-usage-limits` adds its per-account limit as one policy on the API's
  own rate limiter. It no longer sets up a second limiter or a second
  forwarded-headers step, which an API from `/start:new-app` already has.

### 0.1.2 (2026-10-07)

- `ai-usage-limits` says what to do in an app without sign-in: a per-install
  id from the server, a per-IP limit, a lower daily cap, and the app-wide
  budget as the real backstop.

### 0.1.1 (2026-09-29)

- The .NET code reads the user from the `sub` claim. Before, it got no user:
  a 401 on every request, and one rate-limit bucket for everyone.
- The .NET code builds under the kit's strict settings. `JobFailed` is now
  `JobFailedException`.

### 0.1.0 (2026-09-28)

- First version. Skills for an AI agent, a chat screen, AI usage limits, AI
  consent, background jobs, and import from the share sheet.

## content

### 0.1.4 (2026-10-09)

- `video`: Veo 3.1 with one image starts the clip from it
  (`FIRST_AND_LAST_FRAMES_2_VIDEO`); before, the image was only a style
  reference. `chain` stops before leg 1 when ffmpeg is missing, so no leg is
  paid for. `--dur`, `--ar`, `--resolution` and `--tail` on a model with no
  built-in schema are named as not sent, with how to pass them.
- `image`, `video`: Replicate official models work as `owner/name`, with no
  version id. `still --ref ... --dry-run` uploads nothing and reads no key.
- `image`, `video`: every submitted job prints its id. One failed status
  check no longer loses a paid result: the script retries, and after five
  failures in a row it names the job, which may still finish on your account.
  `probe` with a bad key fails instead of printing `null`. `.jpeg` files
  upload as `image/jpeg`.

### 0.1.3 (2026-10-09)

- Every skill ends with the next step from your plan, as one question.

### 0.1.2 (2026-10-09)

- fal: a failed job is an error now. Before, fal's error page was saved as the
  output file and the script reported success.

### 0.1.1 (2026-10-09)

- Secrets are read the same way in every script: the environment variable,
  then your `secrets.command` (any tool; `doppler` and `1password` are
  ready-made), then the nearest `.env`. A command that waits for a prompt
  stops after 60 s with a clear message, instead of hanging. CONFIG.md,
  "Secrets".
- `/content:image` reads `media.providers.kie.keyRef`, like `/content:video`.

### 0.1.0 (2026-09-28)

- First version. Skills to make images and videos for your app.
