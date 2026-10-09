---
name: new-app
description: Start a new Expo / React Native iOS app from an empty folder, in the layout the rest of onebox expects. It creates the Expo app with a dev client and the three EAS profiles, an optional ASP.NET Core or Node API with a Postgres test in the same repo, pnpm workspaces, strict types, lint, tests, CI and an AGENTS.md. It follows the onebox guides for each part and adds only the files that join them. Use when the user says "new app", "start a new app", "scaffold an app", "set up a new Expo project", "bootstrap my app", "create the repo for my idea", "I have an idea but no code yet", or when /start:plan finds no Expo app. Not for an app that already exists; use /start:plan for that.
---

# New app

Runs on: your Mac.

This skill makes a new repo with a skeleton and no features. The app opens in
the Simulator, the API (if there is one) answers `/health`, and every check
passes. Then `/start:plan` takes over.

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
- Config: `apple.teamId`, `box.domain`, `secrets.tool`. All optional here.
  Use them as defaults. Read them from `~/.config/onebox/config.json`, with
  `.onebox.json` in the repo over it. The rules:
  https://github.com/ggi3201/onebox/blob/main/CONFIG.md.
- Tools: after the questions in step 1, run the checks `/start:plan` uses.
  `<plan-dir>` is `<skill-dir>/../plan`, in the same plugin:

  ```bash
  node <plan-dir>/scripts/plan.mjs ready --step new-app --repo "$(mktemp -d)" \
    --answers '{"stage":"idea","backend":"box"}' --need dotnet --list
  ```

  `backend` is `box` with an API in the repo, else `hosted` or `none`. Add
  `--need dotnet` only for a .NET API. It checks git, Node 22 or newer,
  pnpm 10, `eas` and its login, Xcode, CocoaPods and its Ruby, a UTF-8
  locale, and, with an API, Docker. pnpm stays on 10 (`tools.md`). The check
  is read-only.

  **It checks what the user's own Terminal has, not what this app has.**
  The app often has a longer PATH, so a tool can work here and be missing
  where the user types. The check uses the PATH of a login shell. When a tool
  exists only in the app, it says so.

  **Show the whole list once.** `--list` puts every missing tool in one
  message, with how long each takes and one question. Say its `say` line and
  nothing else. Do not read out the blockers one at a time, and do not add
  to it from your own guesses: if you see a problem it did not name, say so
  after the list.

  - **"Should I install ...?"** On a "yes", run the `safe` fixes in the
    order listed, each in the user's own shell, so the tool lands where their
    Terminal finds it:

    ```bash
    env -i HOME="$HOME" USER="$USER" SHELL=/bin/zsh TERM=xterm-256color \
      /bin/zsh -lic '<the fix>'
    ```

    Say what you start and how long it takes.
  - A `yours` item is the user's to do (`/start:plan`, section 6, has the
    rules). Tell them when it is due, not before.
  - Run the check again after the installs. Go on when nothing is missing
    except `yours` items you have told them about and they have done.

## 1. Ask

Ask everything in one questionnaire, with your agent's question tool if it
has one (in Claude Code, AskUserQuestion: up to 4 questions in one call). Do
not ask them in chat, one by one. Only when you do not have such a tool, put
the same four questions in one numbered message. Fill in the
options yourself, from the user's idea and the config, so the user picks and
does not type. "Other" is always there for their own text. Do not ask a
question the user already answered.

- **App name**, as users see it on the App Store. Give one to three names from
  the idea (for example "Warranty Keeper"). Say in the question that App Store
  names must be unique.
- **Bundle identifier.** Say in the question that it can never change after
  the first upload (`expo-app.md`, step 2). Options:
  - `com.<domain reversed>.<slug>` (recommended), when `box.domain` is set.
  - "I have a domain": the user types the reversed pattern under "Other".
  - `com.example.<slug>`, "I have no domain yet": change it before the first
    upload to Apple. The Simulator build does not need the real one.
- **Server:** "Own box, .NET API (recommended)", "Own box, Node API",
  "Hosted (Supabase, Convex, Firebase)", "No server".
- **Sign in with Apple now:** "Yes (recommended)", "Later".

**The slug** is not a question. Make it from the app name: lowercase letters
and digits, no spaces (`warrantykeeper`). It names the folder, the scheme,
the containers and the solution. Put it in the bundle identifier options. If
the user types another name, make the slug again, and say the slug and the
bundle identifier in one line before you build: "Slug: `warrantykeeper`.
Bundle identifier: `com.example.warrantykeeper`. Tell me if either is
wrong."

Then check the tools (step 0).

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

**The app folder** below means the Expo app's folder: `apps/mobile` with an
API, the repo root without one. Run every `npx expo` and `eas` command there.

## 3. Build it, in this order

1. **Repo.** With an API: `git init`, the root files from
   `references/files.md` (with `.node-version`), and the tripwire from
   `expo-app.md`. Then pin pnpm 10 at the root (`expo-app.md`, "Pin pnpm").
   It writes `packageManager` and runs a first install. Without an API:
   nothing yet; step 2 makes the folder.
2. **Expo app.** Keep the default template (Expo Router, TypeScript).
   - With an API: in `apps/`, run
     `echo y | npx create-expo-app@latest mobile --no-install`, then
     `pnpm install` from the root. Inside a git repo it asks "Skip
     initializing a new git repository?". The `y` answers it.
   - Without one: in the parent folder, outside any git repo, run
     `npx create-expo-app@latest myapp --no-install`. It asks nothing. It
     runs `git init` and makes a first commit, "Initial commit", so do not
     run `git init` yourself. In `myapp`: `.node-version` and the `.npmrc`
     from `references/files.md`, then pin pnpm 10 (`expo-app.md`, "Pin pnpm"). Add
     `.claude/worktrees/` and `.worktrees/` to its `.gitignore`
     (`expo-app.md`, "Recommended layout", says why), and `.env`, `.env.*`,
     `.onebox.json`, `build/` and `*.ipa`: secrets and build output never go
     into git or an EAS upload.
   - Then, in the app folder: `echo n | pnpm reset-project`. It asks whether
     to move the example to `example/`. The `n` deletes it instead.
   - The template ships its own agent files and a `LICENSE`. Handle them as
     `references/files.md`, "The Expo app", says.
3. **App config.** Follow `expo-app.md` steps 2, 3, 4, 5, 6, 7 and 9: the
   bundle id, `app.json`, the API URL module, `expo-dev-client`, `eas.json`
   with three profiles, remote versions, `expo-secure-store`. Set `slug`,
   `name` and `scheme` to the app's slug (the template says `mobile`). Set
   `supportsTablet: false`. With "Sign in with Apple: Later", leave out
   `usesAppleSignIn` and its plugin.
   - `eas.json` gets `cli` and `build` only. No `submit` block and no
     RevenueCat key: their values come from later steps, and a placeholder
     such as `"ascAppId": "1234567890"` makes the plan think the app is
     already on TestFlight.
   - The API URL module (`expo-app.md` step 4) is for an API in the repo
     only. Hosted or no server: skip step 4. No `src/config/api.ts`, and no
     `EXPO_PUBLIC_API_URL` in `eas.json`. Never put a placeholder URL in.
     A hosted backend gets its URL later, from its own step in the plan.
4. **Link to Expo.** Ask the user to run `eas login` once in their own
   terminal if `eas whoami` fails. Then run
   `eas init --non-interactive --force` from the Expo app's folder
   (`apps/mobile` when there is an API; never the repo root then). In an
   agent's shell `eas init` needs both flags, and `--force` links any Expo
   project that already has this slug. So check the output: it must say it
   created a project. If it linked an existing one, stop and ask the user.
5. **App checks.** Follow `agent-test-loop.md` steps 1, 2, 4 and 7: strict
   TypeScript, ESLint, one test runner, one Metro port per app and per
   worktree. The Metro script goes in the app folder's `scripts/`
   (`apps/mobile/scripts/` with an API, `scripts/` at the root without).
   Make it after `reset-project`, which deletes `scripts/`. The first test
   checks `eas.json` (`references/files.md`, "The Expo app"). With an API,
   it also checks what `expo-app.md` step 4 asks for: every profile that
   leaves the Mac has an `https` API URL.
6. **API.** The project, the solution and the first tests:
   `references/files.md`, "The API". It meets the five rules in `backend.md`,
   "The language". It is protected from the first commit: the real client
   IP, rate limits and a request body size limit (`backend.md`, "Protect the
   API", steps 1, 2 and 4), each with a test. Its Dockerfile is `backend.md`
   step 1. A Node API: `references/node-api.md` has all its files.
7. **API: dev database and the app's API URL.** `docker-compose.dev.yml`
   from `references/files.md`. Pick a free port first
   (`lsof -iTCP:5433 -sTCP:LISTEN` prints nothing). Then point the dev
   client at the API port from step 6. Write `apps/mobile/.env.local`:

   ```
   EXPO_PUBLIC_API_URL=http://localhost:<api port>
   ```

   The Simulator reaches the Mac on `localhost`. The template's `.gitignore`
   already ignores `.env*.local`, so the file stays on this Mac. Builds that
   leave the Mac take the URL from `eas.json`. Write both ports in
   `AGENTS.md`.
8. **CI.** `.github/workflows/ci.yml` from `references/files.md`. Without
   an API, use its no-server form: no `api` job, and `pnpm test` instead of
   `pnpm test:mobile`.
9. **AGENTS.md.** The short block in `references/files.md` for this layout,
   then the test-loop block
   (`plugins/dev/skills/test-loop/assets/AGENTS.snippet.md`; without the
   `dev` plugin, fetch it from GitHub). Delete its lines for steps this repo
   does not have. With an API, link `CLAUDE.md` to it with
   `ln -s AGENTS.md CLAUDE.md`. Without an API, the template's `AGENTS.md`
   and `CLAUDE.md` are already at the root: put the blocks at the top of that
   `AGENTS.md`, and keep its `CLAUDE.md`.

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

Without an API, run the two `npx expo` lines at the repo root, with no `cd`.
There, every `npx` command prints `npm warn Unknown project config
"node-linker"`. It is harmless: npm reads the `.npmrc` too, and the setting
is for pnpm. Keep the line.

API:

```bash
pnpm db:up
pnpm dev:api                                 # in the background
curl -fsS http://127.0.0.1:<api port>/health # {"ok":true}
```

App: first check the shell the build runs in. Then give the app its own
simulator, so the build does not land on one another session uses.

```bash
# CocoaPods on a Ruby from rbenv or Homebrew (not /usr/bin/ruby), and a UTF-8 LANG
node <plan-dir>/scripts/plan.mjs ready --need cocoapods-ruby,utf8-locale --repo .
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
`pod install`, delete the app folder's `ios/` (`apps/mobile/ios` with an API,
`ios` at the root without) before you try again.

Then make one commit: `Skeleton from onebox new-app`. Do not push. The user
creates the GitHub repo. With an API, it is the repo's first commit. Without
one, it comes after the template's "Initial commit". Keep that commit.

## 5. Hand off

Run `/start:plan`. It now finds the app, ticks what this skill did, and ends
with one nudge. Say two lines and nothing else:

```
Done: your app runs in the Simulator.
Next: <the step `plan.mjs ready` names>. Continue?
```

The second line is the `say` line from `plan.mjs ready`, as it is. It changes
with the user's Mac and answers: it can be a blocker (something to install or
a part that is theirs) or a plain "Continue?". Do not write it from memory.
No file list and no check output, unless the user asks.

## Rules

- No features, no sample screens, no auth code. The skeleton only. The
  API's protections are not features: keep them.
- Never write a secret. The dev database password is a fixed dev value, and
  its port is bound to `127.0.0.1`.
- Run Expo and EAS commands only from the app folder: `apps/mobile` with an
  API (the root has the tripwire), the repo root without.
- Never commit `ios/` or `android/`. They are generated.
- If a guide step and this skill disagree, the guide wins. Tell the user, so
  the skill gets fixed.
