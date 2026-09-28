---
name: test-loop
description: Make the coding agent prove a change before it says "done" in an Expo / React Native iOS app with an ASP.NET Core or Node backend. It runs lint, strict types, unit tests and integration tests against a real database, then checks the change in the iOS Simulator and saves a screenshot as proof. It starts with a preflight that catches a simulator running another worktree's Metro and a binary that needs a native rebuild. Use when the user says "verify", "test it", "make sure it works", "check it on the simulator", "is it fixed?", "it still doesn't work", "my change doesn't show up", "Fast Refresh isn't working", "wrong Metro", "do I need to rebuild?", "run the flows", "before release", or whenever you are about to report a change as done.
---

# Test loop

Runs on: your Mac. It needs Xcode with the iOS Simulator, and Docker for the
test database.

Passing tests do not mean the change is done. A change the user can see is
done when you have seen it on a simulator that runs **this checkout's** code.
Agents skip that step, and then report a fix that was never on screen.

The one-time setup (strict types, ESLint, test runners, a test database, a
seed, the first flow) is in `https://onebox.lokkesveen.com/guides/agent-test-loop.md`.

## 0. Find the repo's commands

Once per session, from the repo root:

```bash
node <skill-dir>/scripts/discover.mjs .
```

It lists the lint, typecheck, test, seed and run scripts of every
`package.json` and .NET solution, plus the TypeScript strict flags and the
test setup. Use the repo's own scripts. If the repo has a `check` script that
chains them, use that. If a step has no command, use the suggested one, and
tell the user the repo lacks it.

## 1. Preflight: is the simulator running this code?

Run it before you debug anything on the simulator, and before every device
check:

```bash
node <skill-dir>/scripts/preflight.mjs --dir <expo-app-dir>
```

It checks, read-only:

- **Metro:** every running Metro server, its project root and port, and which
  app on which simulator is connected to it. FAIL when the app runs another
  checkout's bundle, or when no Metro serves this checkout.
- **Simulators:** warns when more than one is booted, because `booted` in
  `simctl` then picks either one.
- **Native build:** whether each native package has code in the installed
  binary, whether `ios/Podfile.lock` is newer than the binary, and whether the
  Expo fingerprint changed since the last marked build.

After every native build (`npx expo run:ios`), run it once with
`--mark-built`. Later runs then compare against that build.

Fix every FAIL before you look at the bug. Read `references/preflight.md` for
the fixes, the reload-or-rebuild table, one Metro port per worktree, and the
traps from real sessions. To prove the bundle is yours, change a visible
string, watch it appear, then revert it.

## 2. The loop

Run it in this order on every change. Stop at the first red step and fix it.

1. **Lint.** The repo's lint script, on changed files first if it allows.
2. **Types.** `tsc --noEmit` for each TypeScript package. For .NET,
   `dotnet build <sln> -warnaserror`.
3. **Unit tests.** Related tests first (`vitest related <files> --run`,
   `jest --findRelatedTests <files>`, `dotnet test --filter
   "FullyQualifiedName~<Class>"`), then the full suite.
4. **Integration tests against a real database.** `dotnet test` with
   Testcontainers, or the Node test script against a throwaway Postgres.
   Check `docker info` first. Never test against the dev database. An
   in-memory provider is not a real database: it skips SQL translation,
   constraints and query filters.
5. **Bundle check.** After you change imports, config or a dependency, run
   `npx expo export --platform ios --output-dir <tmp-dir>`. It finds Metro
   build errors without a device.
6. **Device check.** Preflight OK. Reach the screen with a deep link or taps.
   Take a screenshot and read it. Check the seed users that stress this screen
   (empty, long names, many rows: `references/seed-data.md`). Run the
   `*.flow.md` files in the feature folders you touched
   (`references/flows.md`).
7. **Report** with proof (below).

**A bug fix starts red.** Write a test that fails for the bug. Run it and
watch it fail for the right reason. Then fix the code and watch it pass. If
the bug came from a data shape, add a seed row too.

## 3. The report

```
Verified
- lint      pnpm lint: 0 problems
- types     pnpm typecheck: 0 errors
- unit      pnpm test: 412 passed
- database  dotnet test: 874 passed (Testcontainers, Postgres 17)
- device    iPhone 17 Pro <udid>, Metro :8123 from this worktree, preflight OK
            /abs/path/proof/lists-empty.png: "No lists yet" and the "New list" button
            lists.flow.md: steps 1-7 passed
Not verified
- The purchase sheet needs a sandbox Apple account. Not run.
```

Put the screenshot paths in the report. Keep them outside the repo, or in a
git-ignored folder.

## 4. Definition of done

All of these are true:

- Every step ran and passed, or it is under "Not verified" with the reason.
- A user-visible change was seen on a simulator after preflight OK, and the
  report holds the screenshot path.
- A bug fix has a test that failed before the fix and passes after it.
- No test was skipped, deleted or loosened to get green.
- Flows that mention changed text or screens are updated in the same change.

## 5. When a step cannot run

Say so. Name the step, the reason, and what would let it run. Examples:
"Integration tests did not run: Docker is not running." "Not checked on a
device: no simulator tool in this session."

- Never write "fixed", "works" or "done" for something you did not verify.
  Write "changed, not verified on a device".
- Do not swap in a weaker check without saying so.
- Some steps need the user: a system permission dialog, the "Open in <app>?"
  prompt, Sign in with Apple, the camera, a real phone. Ask for them by name.

## 6. Before a release

- The whole loop, then every flow on a fresh install, on the smallest and the
  largest simulator you support.
- Dependency audit: `dotnet list package --vulnerable --include-transitive`,
  and `pnpm audit` or `npm audit`.
- The `ship-ios:app-store-ready` skill.
- A test where user B asks for user A's row and gets 404
  (`https://onebox.lokkesveen.com/guides/backend.md`, "Keep each user's data apart"), and a rate-limit test
  for the auth and AI endpoints (`https://onebox.lokkesveen.com/guides/backend.md`, "Protect the API").

## 7. Make every agent follow it

Paste `assets/AGENTS.snippet.md` into the repo's `AGENTS.md` or `CLAUDE.md`.
Replace the placeholders with the commands `discover.mjs` found.
