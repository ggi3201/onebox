---
name: new-app
description: Start a new Expo / React Native iOS app from an empty folder, in the layout the rest of onebox expects. It creates the Expo app with a dev client and the three EAS profiles, an optional ASP.NET Core or Node API with a Postgres test in the same repo, pnpm workspaces, strict types, lint, tests, CI and an AGENTS.md. It follows the onebox guides for each part and adds only the files that join them. Use when the user says "new app", "start a new app", "scaffold an app", "set up a new Expo project", "bootstrap my app", "create the repo for my idea", "I have an idea but no code yet", or when /start:plan finds no Expo app. Not for an app that already exists; use /start:plan for that.
---

# New app

Runs on: your Mac.

This skill makes a new repo with a skeleton and no features. The app opens in
the Simulator, the API answers `/health`, and every check passes. Then
`/start:plan` takes over.

**The guides are the source of truth.** This skill sets the order and adds the
files no guide has (`references/files.md`). When a step says "follow
`expo-app.md`, step 3", fetch
`https://onebox.lokkesveen.com/guides/expo-app.md` and do that step. Do not
work from memory, from another app, or from older Expo docs. If that URL does
not load, try `https://raw.githubusercontent.com/ggi3201/onebox/main/guides/expo-app.md`,
then `guides/expo-app.md` in a local checkout of the onebox repo. If none of
them loads, stop and tell the user which guide you could not read. Versions come
from `create-expo-app@latest` and `dotnet new`, never from memory. One
exception: pnpm is pinned to major 10 (step 0).

## 0. Check first

- The target folder is empty or does not exist. If it has an Expo app, stop
  and run `/start:plan` instead.
- Tools: `node -v` (an LTS: an even major, 22 or newer). `corepack enable`,
  then `corepack install -g pnpm@10`, then `pnpm -v` (10.x). pnpm 12 does not
  start through corepack yet, so do not take the newest pnpm (`tools.md`).
  `xcodebuild -version` (else `https://onebox.lokkesveen.com/guides/xcode.md`),
  `git`. With a .NET API also `dotnet --version` (10 or newer). With any API,
  `docker info` (the tests need it).
- Config (see `CONFIG.md`): `apple.teamId`, `box.domain`, `secrets.tool`. All
  optional here. Use them as defaults.

## 1. Ask

In chat, ask for:

- **The app name** as users see it, and a **slug**: lowercase, no spaces
  (`myapp`). The slug names the folder, the scheme, the containers and the
  solution.
- **The bundle identifier.** Suggest `com.<domain reversed>.<slug>` from
  `box.domain`. Say it once: it can never change after the first upload
  (`expo-app.md`, step 2).

Then ask, with AskUserQuestion if you have it:

- **Server:** "Own box, .NET API (recommended)", "Own box, Node API",
  "Hosted (Supabase, Convex, Firebase)", "No server".
- **Sign in with Apple now:** "Yes (recommended)", "Later".

## 2. The layout

With an API in the repo (own box):

```
myapp/
  apps/mobile/            Expo app
  apps/api/               the API, its tests and its Dockerfile
  app.config.js           the tripwire (expo-app.md, "The tripwire at the root")
  package.json  pnpm-workspace.yaml  .npmrc  .gitignore
  docker-compose.dev.yml  the dev database
  .github/workflows/ci.yml
  AGENTS.md  CLAUDE.md -> AGENTS.md
```

With a hosted backend or no server: the Expo app is the repo root. No `apps/`,
no tripwire, no workspace file, no API steps. Skip the steps marked **API**.

## 3. Build it, in this order

1. **Repo.** With an API: `git init`, the root files from
   `references/files.md` (with `.node-version`), and the tripwire from
   `expo-app.md`. Then `corepack use pnpm@10` at the root. It writes
   `packageManager` and runs a first install. Without an API: nothing yet;
   step 2 makes the folder.
2. **Expo app.** Keep the default template (Expo Router, TypeScript). Two
   commands ask a question, so pipe the answer in:
   - With an API: in `apps/`, run
     `echo y | npx create-expo-app@latest mobile --no-install`, then
     `pnpm install` from the root. The `y` answers "Skip initializing a new
     git repository?".
   - Without one: in the parent folder, run
     `echo y | npx create-expo-app@latest myapp --no-install`. In it:
     `git init`, `.node-version`, the `.npmrc`, then `corepack use pnpm@10`.
     Add `.claude/worktrees/` to its `.gitignore` (`expo-app.md`,
     "Recommended layout", says why).
   - Then, in the Expo app folder: `echo n | pnpm reset-project`. The `n`
     deletes the example instead of moving it to `example/`.
   - The template ships its own agent files and a `LICENSE`. Handle them as
     `references/files.md`, "The Expo app", says.
3. **App config.** Follow `expo-app.md` steps 2, 3, 4, 5, 6, 7 and 9: the
   bundle id, `app.json`, the API URL module, `expo-dev-client`, `eas.json`
   with three profiles, remote versions, `expo-secure-store`. Set `scheme` to
   the slug. Set `supportsTablet: false`. With "Sign in with Apple: Later",
   leave out `usesAppleSignIn` and its plugin.
4. **Link to Expo.** Ask the user to run `eas login` once in their own
   terminal if `eas whoami` fails. Then run `eas init` from the Expo app's
   folder (`apps/mobile` when there is an API; never the repo root then).
5. **App checks.** Follow `agent-test-loop.md` steps 1, 2, 4 and 7: strict
   TypeScript, ESLint, one test runner, one Metro port per app and per
   worktree. The Metro script goes in the Expo app's `scripts/`
   (`apps/mobile/scripts/`).
   Make it after `reset-project`, which deletes `scripts/`. The
   first test is the one `expo-app.md` step 4 asks for: every `eas.json`
   profile that leaves the Mac has an `https` API URL (`references/files.md`,
   "The Expo app").
6. **API.** The project, the solution and the first test:
   `references/files.md`, "The API". It meets the five rules in `backend.md`,
   "The language". Its Dockerfile is `backend.md` step 1.
7. **API: dev database.** `docker-compose.dev.yml` from `references/files.md`.
   Pick a free port first (`lsof -iTCP:5433 -sTCP:LISTEN` prints nothing).
   Write the port in `AGENTS.md`.
8. **CI.** `.github/workflows/ci.yml` from `references/files.md`. Drop the
   `api` job without an API.
9. **AGENTS.md.** The short block in `references/files.md`, then the
   test-loop block (`plugins/dev/skills/test-loop/assets/AGENTS.snippet.md`;
   without the `dev` plugin, fetch it from GitHub). Link `CLAUDE.md` to it
   with `ln -s AGENTS.md CLAUDE.md`. Without an API, the template's
   `AGENTS.md` and `CLAUDE.md` are already at the root: put the block at the
   top of that `AGENTS.md`, and keep its `CLAUDE.md`.

Leave for later, because the plan adds them in the right phase: the
production `docker-compose.yml` and `deploy-api.yml` (they need the box),
sign-in code, RevenueCat, the landing page.

## 4. Check it works

All of these must pass before you report done. Quote the output.

```bash
pnpm install --frozen-lockfile
pnpm check                                   # typecheck, lint, all tests
(cd apps/mobile && npx expo-doctor)
(cd apps/mobile && npx expo config --type public | grep -E 'bundleIdentifier|scheme')
```

API:

```bash
pnpm db:up
pnpm dev:api                                 # in the background
curl -fsS http://127.0.0.1:<api port>/health # {"ok":true}
```

App: first check the shell the build runs in. Then give the app its own
simulator, so the build does not land on one another session uses.

```bash
which ruby pod        # a Ruby from rbenv or Homebrew, not /usr/bin/ruby
echo $LANG            # en_US.UTF-8, not empty
U=$(xcrun simctl create "MyApp" "iPhone 17 Pro") && xcrun simctl boot "$U"
pnpm ios --device "$U"
```

Pick a device type that `xcrun simctl list devicetypes` shows. `pnpm ios`
builds the dev client and opens it in that simulator. The first build takes
minutes. Take a screenshot and read it.

- iOS can ask "Open in MyApp?" when the build or `xcrun simctl openurl`
  opens the app's URL. Tap Open.
- The first start of a dev client shows the developer menu sheet. Close it.

Both are normal, not errors. On a CocoaPods or Ruby error, read
`ship-ios:expo-local-build`, `references/pitfalls.md`. After a failed
`pod install`, delete the app's `ios/` folder (`apps/mobile/ios`) before you
try again.

Then make one commit: `Skeleton from onebox new-app`. Do not push. The user
creates the GitHub repo.

## 5. Hand off

Run `/start:plan`. It now finds the app, ticks what this skill did, and names
the next step: usually the Apple Developer account and the App Store Connect
record.

## Rules

- No features, no sample screens, no auth code. The skeleton only.
- Never write a secret. The dev database password is a fixed dev value, and
  its port is bound to `127.0.0.1`.
- Run Expo and EAS commands only from `apps/mobile`.
- Never commit `ios/` or `android/`. They are generated.
- If a guide step and this skill disagree, the guide wins. Tell the user, so
  the skill gets fixed.
