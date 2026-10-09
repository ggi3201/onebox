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
