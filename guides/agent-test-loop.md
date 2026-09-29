# A test loop your coding agent can run

Runs on: your Mac. You set this up once per app. After that, the agent runs
the loop on every change with the `dev:test-loop` skill.

A coding agent that cannot check its own work says "fixed" when it is not.
This guide gives it the checks: strict types, a linter, fast unit tests, tests
against a real database, a dev database full of edge cases, and click-through
scripts it follows in the iOS Simulator. Then one short block in `AGENTS.md`
makes every agent use them.

## What it costs

- **Free.** Everything runs on your Mac: TypeScript, ESLint, Vitest or Jest,
  `dotnet test`, Docker, and the iOS Simulator that comes with Xcode.
- **Time:** about an hour for an existing app. Most of it goes into the first
  seed and fixing what the stricter compiler finds.
- **You need:** Xcode ([xcode.md](xcode.md)), Docker Desktop or another
  Docker engine, and an Expo app with a development build
  ([expo-app.md](expo-app.md), step 5). For the backend shape, see
  [backend.md](backend.md).

## Steps

### 1. Strict TypeScript

In the app's `tsconfig.json`:

```jsonc
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,   // arr[i] may be undefined
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,
    "types": ["jest", "node"]           // the test runner's globals, and Node's
  }
}
```

TypeScript 6 no longer loads every `@types/*` package on its own. List the
ones your code uses in `types`: `"jest"` for Jest's `test` and `expect`,
`"node"` for `fs`, `path` and `__dirname` in tests and config. With Vitest,
import `test` and `expect` from `vitest` and list only `"node"`. Without the
list, the first test fails with `Cannot find name 'test'`. Add each package
as a direct dev dependency (step 4). One that is there only through another
package can go away on the next install.

`noUncheckedIndexedAccess` finds the most real bugs, and it also finds the
most code to change. Turn it on first, fix what it reports, then add the rest.
`exactOptionalPropertyTypes` is stricter still. Try it, and drop it if library
types fight it.

Add a script, so every agent calls the same command:

```json
"scripts": { "typecheck": "tsc --noEmit" }
```

### 2. ESLint

From the Expo app folder:

```bash
npx expo lint
```

The first run installs `eslint` and `eslint-config-expo`, writes
`eslint.config.js` and adds a `lint` script to `package.json`. It can then
crash with `Cannot find module 'eslint'` (from `lintAsync.js`). Run
`npx expo lint` a second time. The second run works. Then:

- Add `"ios/*"`, `"android/*"` and `"dist/*"` to `ignores`. With Continuous
  Native Generation those folders are generated. Lint errors there come back
  at every prebuild.
- A new `eslint-config-expo` can turn on new rules as errors. When a
  dependency bump brings many old findings, set those rules to `"warn"` with
  a comment that says why, and fix them later. Do not turn them off silently.

### 3. Strict .NET

In a `Directory.Build.props` at the backend root, so it applies to every
project:

```xml
<Project>
  <PropertyGroup>
    <Nullable>enable</Nullable>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
    <AnalysisLevel>latest-recommended</AnalysisLevel>
  </PropertyGroup>
</Project>
```

If warnings as errors slow you down locally, remove that line and run
`dotnet build -warnaserror` in CI and in the agent loop instead.

Next to it, an `.editorconfig`:

```ini
# EF Core writes the migrations. Analyzers skip generated code, so a
# composite index (CA1861) does not fail the strict build.
[**/Migrations/*.cs]
generated_code = true
```

Write log lines as source-generated `[LoggerMessage]` methods. Under these
settings, `log.LogInformation(...)` fails the build with CA1848. One class
holds them all:

```csharp
namespace MyApp.Api;

// CA1848 refuses the LogInformation(...) extension methods. Never log a token,
// an email or a request body (backend.md, "Protect the API", step 9).
public static partial class Log
{
    [LoggerMessage(Level = LogLevel.Warning, Message = "Apple identity token refused: {Reason}")]
    public static partial void AppleTokenRefused(ILogger log, string reason);

    [LoggerMessage(Level = LogLevel.Error, Message = "Job {JobId} failed")]
    public static partial void JobFailed(ILogger log, Exception error, Guid jobId);
}
```

Call it as `Log.AppleTokenRefused(log, "expired")`. An `Exception`
parameter becomes the log entry's exception, not a placeholder.

### 4. Unit tests for the app

Pick one runner:

- **Jest with `jest-expo`** is Expo's default. It mocks the native modules for
  you. Start here if you have no tests yet. From the Expo app folder:

  ```bash
  npx expo install jest-expo jest @types/jest @types/node -- --save-dev
  ```

  Then add `"jest": { "preset": "jest-expo" }` to `package.json`.
- **Vitest** is faster. It needs an alias for each React Native package that
  cannot load in Node, which is more setup. One working split: `*.test.ts` for
  pure logic in the `node` environment, and `*.test.tsx` for components in
  `jsdom` with `react-native` aliased to `react-native-web`. Know the limit of
  the second lane: it has no keyboard, no native layout and no real scroll.

Either way:

- Pin the time zone in the test config, to one with DST (`TZ: "Europe/Berlin"`
  or `"America/New_York"`). Date code that only ever runs in UTC is untested.
- Add a coverage provider now (`@vitest/coverage-v8` for Vitest; Jest has one
  built in). The `dev:trim-tests` skill needs it later.
- Add the script: `"test": "vitest run"` or `"test": "jest"`. For Jest, the
  script can pin the time zone too: `"test": "TZ=Europe/Berlin jest"`.

### 5. Tests against a real database

An in-memory database skips SQL translation, constraints and query filters,
which are where the bugs are. Test against Postgres, the same major version
you deploy.

**.NET:** add `Testcontainers.PostgreSql`, `Microsoft.AspNetCore.Mvc.Testing`
and `coverlet.collector` to the test project. Start one container per test
run, and create one database per test fixture, so parallel test classes
cannot see each other's rows:

```csharp
// One server for the run. Pin the image to the major version you deploy.
static readonly PostgreSqlContainer Server =
    new PostgreSqlBuilder("postgres:17-alpine").Build();
```

Testcontainers 4.14 and later take the image in the constructor. The empty
constructor is obsolete, and with warnings as errors it fails the build. Set
`MaxPoolSize` to a small number (5) in each fixture's connection string.
Twenty fixtures with the default pool size exhaust Postgres' 100
connections, and the tests fail with errors that look like a deadlock.

Hand each fixture's connection string to a `WebApplicationFactory<Program>`,
so the tests call the real HTTP endpoints.

**Node:** `@testcontainers/postgresql` does the same:

```ts
const pg = await new PostgreSqlContainer("postgres:17-alpine").start();
process.env.DATABASE_URL = pg.getConnectionUri();
```

Start it once per run, in Vitest's `globalSetup`, and make one database per
test file. The `start:new-app` skill has the code
(`references/node-api.md`, "Tests").

Or run a separate Postgres for tests in Docker Compose, on its own port, with
its data in memory:

```yaml
services:
  db-test:
    image: postgres:17-alpine
    environment: { POSTGRES_PASSWORD: test }
    ports: ["127.0.0.1:5439:5432"]
    tmpfs: /var/lib/postgresql/data
```

When the app has its own backend, write the two tests from
[backend.md](backend.md), "Keep each user's data apart": one that fails when a
table has no filter, and one where user B asks for user A's row and gets 404.
The backend comes in Phase 3 of [start-here.md](start-here.md), so come back
to this step then. Until then, the test database is enough.

### 6. A dev database with edge cases

Write a seed that runs only in Development and creates named users for the
hard cases: an empty account, very long names, emoji and right-to-left text,
many rows for pagination, missing images, an expired subscription, a second
user with look-alike data, and dates around midnight and DST. Add a
Development-only sign-in, because Sign in with Apple does not work in the
Simulator.

The full checklist, and how to grow it from real bugs, is in the skill:
`plugins/dev/skills/test-loop/references/seed-data.md`.

Add `db:seed` and `db:reset` scripts.

### 7. One Metro port per app and per worktree

Each app, and each git worktree of it, needs its own Metro port. Otherwise the
simulator quietly runs another worktree's code, or even another app's code.
Do not leave an app on the default 8081: a second app on the same Mac uses it
too. Add the small `scripts/metro-port.sh` from
`plugins/dev/skills/test-loop/references/preflight.md`. It gives the main
checkout a port in 8200-8299 from the repo's folder name, and each worktree a
port in 8100-8199 from its path.

The script goes in the Expo app folder, next to its `package.json`
(`apps/mobile/scripts/` in a monorepo), because `package.json` scripts run
in that folder. In a new app, add it after `reset-project`, which deletes
`scripts/`. Use it in both scripts:

```json
"start": "expo start --dev-client --port $(sh scripts/metro-port.sh)",
"ios": "expo run:ios --port $(sh scripts/metro-port.sh)"
```

### 8. A simulator tool for the agent

The agent needs a way to see and tap the simulator. Some agent apps include an
iOS Simulator tool (screenshot, tap, swipe, type). If yours does not, add an
iOS Simulator MCP server. Without any tool the agent can still take
screenshots and open deep links with `xcrun simctl`, but it cannot tap.

Give the app a URL scheme (`"scheme": "myapp"` in `app.json`), so the agent
can open a screen directly: `xcrun simctl openurl <udid> "myapp://settings"`.

### 9. The rules in AGENTS.md

Copy `plugins/dev/skills/test-loop/assets/AGENTS.snippet.md` into the repo's
`AGENTS.md` (or `CLAUDE.md`). Replace the placeholders with your commands. Run
the discovery script to find them:

```bash
node <path-to>/plugins/dev/skills/test-loop/scripts/discover.mjs .
```

### 10. The first flow

Pick the feature that would hurt most if it broke: sign-in, the paywall, the
main create action. Write `<feature>.flow.md` next to its code, with 5 to 15
numbered steps and an `Expect:` line after each step. The format and a full
example are in `plugins/dev/skills/test-loop/references/flows.md`.

Then ask the agent: "run the flows for <feature>".

## Where the values go

Nothing goes into the onebox config. All of it lives in the app repo:

| What | Where |
|---|---|
| Strict flags | `tsconfig.json`, `Directory.Build.props` |
| Commands | `package.json` scripts (`lint`, `typecheck`, `test`, `db:seed`, `db:reset`) |
| Test database | the test project (Testcontainers) or `docker-compose.yml` (`db-test`) |
| Seed | the API project, run at startup in Development only |
| Agent rules | `AGENTS.md` or `CLAUDE.md` |
| Flows | `src/features/<feature>/<feature>.flow.md` |
| Native build marker | `.expo/dev-loop-fingerprint.json` (Expo already git-ignores `.expo/`) |

## Check it works

1. `npm run lint`, `npm run typecheck` and `npm test` (or the pnpm or bun
   equivalents) each exit 0.
2. `dotnet test` passes on a clean checkout with only Docker running. No
   connection string to set.
3. Break an owner filter on purpose. The isolation test turns red. Revert.
4. Start Metro and the app, then run the preflight from the app folder:
   ```bash
   node <path-to>/plugins/dev/skills/test-loop/scripts/preflight.mjs
   ```
   It ends with `PREFLIGHT OK`. Build once with `npx expo run:ios`, then run
   it with `--mark-built`.
5. Ask the agent to change a label and verify it. Its report names the
   commands it ran and gives a screenshot path, and the screenshot shows the
   new label.

## Common errors

- **`dotnet test` hangs at the start.** A stale Testcontainers container or
  its reaper is still running from an earlier run. List them with
  `docker ps -a --filter label=org.testcontainers` and remove them with
  `docker rm -f <id>`.
- **`Docker is either not running or misconfigured`** from Testcontainers:
  start Docker. The agent must report "database tests did not run", not skip
  them quietly.
- **A change does not show in the simulator.** Run the preflight. The two
  usual causes: the app is on another worktree's Metro, or a native package
  was added after the binary was built.
- **A view renders as an empty white box.** The binary lacks that view's
  native code. Rebuild. Style changes cannot fix it.
- **`expo lint` added dependencies you did not expect.** That is its setup
  step. Commit the changes to `package.json` and the lockfile.
- **Tests pass locally and fail in CI on dates.** The machines are in
  different time zones. Pin `TZ` in the test config (step 4).
