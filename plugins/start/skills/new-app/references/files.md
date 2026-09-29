# The files no guide has

Replace `myapp` with the slug and `MyApp` with the slug in PascalCase. Every
other part of the skeleton comes from a guide; the skill says which.

## Root files (API in the repo)

`package.json`. Root scripts only delegate, so every command runs in the
right folder. Write it without `packageManager`. Then run
`corepack use pnpm@10` at the root: it adds `packageManager` with the exact
version and its hash.

Keep pnpm on major 10. pnpm 12 does not start through corepack yet (it has
no `bin/pnpm.cjs`), so do not "upgrade" it until `corepack pnpm@<new> -v`
works on this Node.

```json
{
  "name": "myapp",
  "private": true,
  "scripts": {
    "start": "pnpm --filter mobile start",
    "ios": "pnpm --filter mobile ios",
    "typecheck": "pnpm --filter mobile typecheck",
    "lint": "pnpm --filter mobile lint",
    "test:mobile": "pnpm --filter mobile test",
    "test:api": "dotnet test apps/api/MyApp.sln",
    "test": "pnpm test:mobile && pnpm test:api",
    "check": "pnpm typecheck && pnpm lint && dotnet build apps/api/MyApp.sln -warnaserror && pnpm test",
    "db:up": "docker compose -f docker-compose.dev.yml up -d --wait",
    "dev:api": "dotnet watch --non-interactive --project apps/api/MyApp.Api"
  }
}
```

`dev:api` runs with `--non-interactive`, because an agent runs it with no
terminal. Without the flag, a change that needs a restart (a new package, a
new attribute) makes `dotnet watch` ask "Do you want to restart your app?".
Nobody can answer. The old API keeps running the old code and holds the port.
With the flag, `dotnet watch` restarts the app on its own.

A Node API: use its own `test`, `build` and `dev` scripts through
`pnpm --filter api` instead of the `dotnet` ones. No API: the Expo app is the
root, and its own `package.json` needs a `check` script that runs
`typecheck`, `lint` and `test`.

`.node-version`: the Node major this app uses, for your version manager and
for CI. Use an LTS (an even major).

```bash
node -p 'process.versions.node.split(".")[0]' > .node-version   # for example 24
```

`pnpm-workspace.yaml`:

```yaml
# Only the Expo app. apps/api is .NET, not a pnpm package.
# A Node API is a package: add apps/api.
packages:
  - apps/mobile
```

`.npmrc`:

```
# Metro and CocoaPods do not follow pnpm's symlinked node_modules.
node-linker=hoisted
```

`.gitignore`. Keep the one `create-expo-app` wrote in `apps/mobile`. Why the
worktree lines, and why there is no `.easignore`: `expo-app.md`, "Recommended
layout".

```
node_modules/
.env*.local
.onebox.json
apps/mobile/ios/
apps/mobile/android/
*.ipa
*.p8
*.p12
*.mobileprovision
bin/
obj/
# eas build --local packs every file git does not ignore.
.claude/worktrees/
.worktrees/
```

## The Expo app

The app folder is `apps/mobile` with an API, and the repo root without one.
`create-expo-app` writes more than the app. Per file:

| File in the app folder | What to do |
|---|---|
| `AGENTS.md` | Keep. It is Expo's guide for agents: read the docs for this SDK, not your memory. With an API, link it from the root `AGENTS.md`. Without one, it is the root `AGENTS.md`: put the onebox blocks at its top. |
| `CLAUDE.md` | Keep. It only says `@AGENTS.md`. |
| `.claude/settings.json` | Keep. It turns on Expo's own Claude Code plugin. |
| `LICENSE` | Delete. It is Expo's licence for the template, not the app's. |

`reset-project` deletes `scripts/` and `src/`, and writes a new `src/app/`.
Delete its `reset-project` entry from `package.json` after it runs. The
script it points to is gone.

Without an API, the Expo app's `package.json` is the root one. Give it the
script that runs every check:

```json
"check": "pnpm typecheck && pnpm lint && pnpm test"
```

The first test, in `src/config/eas-profiles.test.ts`. It reads `eas.json`
with Node's `fs`, so it needs `"node"` in the tsconfig `types`
(`agent-test-loop.md`, step 1). These four tests fit every layout:

```ts
// The build profiles: expo-app.md, steps 4, 6, 7 and 10.
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Profile = { developmentClient?: boolean; autoIncrement?: boolean; env?: Record<string, string> };

const eas = JSON.parse(readFileSync(join(__dirname, "../../eas.json"), "utf8")) as {
  build: Record<string, Profile>;
};

const shipped = Object.entries(eas.build).filter(([, p]) => !p.developmentClient);

test("eas.json has the three profiles", () => {
  expect(Object.keys(eas.build)).toEqual(expect.arrayContaining(["development", "preview", "production"]));
});

test("only the development profile has the dev client", () => {
  expect(Object.keys(eas.build).filter((name) => eas.build[name]?.developmentClient)).toEqual(["development"]);
});

test("production raises the build number", () => {
  expect(eas.build.production?.autoIncrement).toBe(true);
});

test("profiles that leave the Mac use only https URLs", () => {
  for (const [name, profile] of shipped) {
    for (const [key, value] of Object.entries(profile.env ?? {})) {
      if (key.endsWith("_URL")) expect(`${name} ${key}=${value}`).toMatch(/=https:\/\//);
    }
  }
});
```

With an API in the repo, add the test `expo-app.md` step 4 asks for. Every
build that leaves the Mac must have an API URL:

```ts
test.each(shipped)("profile %s has an https API URL", (_name, profile) => {
  expect(profile.env?.EXPO_PUBLIC_API_URL).toMatch(/^https:\/\//);
});
```

Without an API, leave it out. The app has no API URL, and a placeholder
URL only hides that.

## The API

For .NET, from the repo root:

```bash
dotnet new sln -n MyApp -o apps/api --format sln
dotnet new web -n MyApp.Api -o apps/api/MyApp.Api
dotnet new xunit -n MyApp.Api.Tests -o apps/api/MyApp.Api.Tests
rm apps/api/MyApp.Api.Tests/UnitTest1.cs
dotnet sln apps/api/MyApp.sln add apps/api/MyApp.Api apps/api/MyApp.Api.Tests
dotnet add apps/api/MyApp.Api.Tests reference apps/api/MyApp.Api
```

Add the test project to the solution. A test project outside the solution
builds on your Mac and never runs in CI.

Packages. Npgsql comes first, because it decides the EF Core version.
`Microsoft.EntityFrameworkCore.Design` and `dotnet-ef` must use that same
version. The newest `Design` pulls in a newer EF Core than Npgsql's. The test
project then gets two versions, and the build fails with CS1705 (MSB3277
under `-warnaserror`).

```bash
dotnet add apps/api/MyApp.Api package Npgsql.EntityFrameworkCore.PostgreSQL
dotnet list apps/api/MyApp.Api package --include-transitive | grep EntityFrameworkCore
V=$(dotnet list apps/api/MyApp.Api package --include-transitive \
  | awk '$2 == "Microsoft.EntityFrameworkCore" { print $3 }')   # for example 10.0.4
dotnet add apps/api/MyApp.Api package Microsoft.EntityFrameworkCore.Design --version "$V"
(cd apps/api && dotnet new tool-manifest && dotnet tool install dotnet-ef --version "$V")
dotnet add apps/api/MyApp.Api.Tests package Testcontainers.PostgreSql
dotnet add apps/api/MyApp.Api.Tests package Microsoft.AspNetCore.Mvc.Testing
```

The xunit template already has `coverlet.collector`. Add
`Directory.Build.props` and `.editorconfig` in `apps/api` from
`agent-test-loop.md` step 3. With them, every analyzer warning is an error,
and the EF Core migrations count as generated code (CA1861 skips them). Log
lines are `[LoggerMessage]` methods, from the same step (CA1848). Two rules
touch the files below:

- CA1050: every type has a namespace. `Program` stays global.
- CA1707: the test names are sentences with underscores. Turn it off in the
  test project only, in its `<PropertyGroup>`:

  ```xml
  <!-- Test names are sentences with underscores. CA1707 is for public library APIs. -->
  <NoWarn>$(NoWarn);CA1707</NoWarn>
  ```

`Program.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;

var builder = WebApplication.CreateBuilder(args);

// Settings come from the environment. On this Mac, appsettings.Development.json.
// A missing one stops the start and names the setting.
string Required(string key) =>
    builder.Configuration[key] is { Length: > 0 } v
        ? v
        : throw new InvalidOperationException($"{key} is not set.");

builder.Services.AddDbContext<AppDb>(o => o.UseNpgsql(Required("DATABASE_URL")));

var app = builder.Build();

app.MapGet("/health", () => Results.Ok(new { ok = true }));

using (var scope = app.Services.CreateScope())
    await scope.ServiceProvider.GetRequiredService<AppDb>().Database.MigrateAsync();

app.Run();

public partial class Program;   // lets the tests start the app
```

`Data/AppDb.cs`, with no tables yet, and a design-time factory, so
`dotnet ef` never starts the app or needs its settings:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace MyApp.Api.Data;

public sealed class AppDb(DbContextOptions<AppDb> options) : DbContext(options);

public sealed class DesignTimeDbFactory : IDesignTimeDbContextFactory<AppDb>
{
    public AppDb CreateDbContext(string[] args) => new(new DbContextOptionsBuilder<AppDb>()
        .UseNpgsql(Environment.GetEnvironmentVariable("DATABASE_URL")
            ?? "Host=127.0.0.1;Port=5433;Database=myapp;Username=myapp;Password=dev")
        .Options);
}
```

`Data/IOwned.cs`, the marker from `backend.md`, "Keep each user's data
apart", step 1:

```csharp
namespace MyApp.Api.Data;

public interface IOwned { string OwnerId { get; set; } }
```

Use the dev database port you picked, here and below.
`appsettings.Development.json` gets the same dev connection string under
`DATABASE_URL`. It is a dev value, not a secret. In `launchSettings.json`,
set the port the API listens on locally, and write it in `AGENTS.md`.

Then the first migration: `(cd apps/api && dotnet ef migrations add Initial --project MyApp.Api)`.

Tests, from `agent-test-loop.md` step 5. `MyApp.Api.Tests/ApiFactory.cs`
starts one Postgres container for the run and one database per test class,
then runs the real app on it:

```csharp
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Npgsql;
using Testcontainers.PostgreSql;

namespace MyApp.Api.Tests;

// One Postgres server for the whole test run. Testcontainers removes it when the run ends.
static class TestDatabase
{
    static readonly PostgreSqlContainer Server = new PostgreSqlBuilder("postgres:17-alpine").Build();
    static readonly Lazy<Task> Started = new(() => Server.StartAsync());

    // A new, empty database on that server. Returns its connection string.
    public static async Task<string> CreateAsync()
    {
        await Started.Value;
        var name = $"test_{Guid.NewGuid():N}";
        await using (var conn = new NpgsqlConnection(Server.GetConnectionString()))
        {
            await conn.OpenAsync();
            await using var cmd = new NpgsqlCommand($"CREATE DATABASE \"{name}\"", conn);
            await cmd.ExecuteNonQueryAsync();
        }
        // A small pool: many fixtures with the default pool exhaust Postgres' 100 connections.
        return new NpgsqlConnectionStringBuilder(Server.GetConnectionString())
        {
            Database = name,
            MaxPoolSize = 5,
        }.ConnectionString;
    }
}

// The real app, on its own database. One per test class (IClassFixture<ApiFactory>).
public sealed class ApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    string connectionString = "";

    public async Task InitializeAsync() => connectionString = await TestDatabase.CreateAsync();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        // "Testing", so appsettings.Development.json and its dev database stay out.
        builder.UseEnvironment("Testing");
        // UseSetting, not ConfigureAppConfiguration: Program reads DATABASE_URL before Build().
        builder.UseSetting("DATABASE_URL", connectionString);
    }

    Task IAsyncLifetime.DisposeAsync() => DisposeAsync().AsTask();
}
```

`MyApp.Api.Tests/SkeletonTests.cs`, the two first tests:

- `GET /health` returns 200 against a real Postgres. This proves the start,
  the settings and the migration.
- The query-filter test from `backend.md`, "Keep each user's data apart",
  step 5. It passes with no tables. It fails on the first owned table that
  has no filter.

```csharp
using System.Net;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MyApp.Api.Data;

namespace MyApp.Api.Tests;

public sealed class SkeletonTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task health_returns_200()
    {
        using var client = factory.CreateClient();
        using var res = await client.GetAsync(new Uri("/health", UriKind.Relative));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }

    [Fact]
    public void every_owned_entity_has_a_query_filter()
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDb>();

        var unguarded = db.Model.GetEntityTypes()
            .Where(e => typeof(IOwned).IsAssignableFrom(e.ClrType))
            .Where(e => e.GetDeclaredQueryFilters().Count == 0)
            .Select(e => e.ClrType.Name)
            .ToList();

        Assert.True(unguarded.Count == 0,
            $"Owned entities with no query filter, so their rows leak across users: {string.Join(", ", unguarded)}");
    }
}
```

The fixture uses the xunit v2 `IAsyncLifetime`, which the `dotnet new xunit`
template installs. In xunit v3 its methods return `ValueTask`.

For Node, follow `backend.md` "The language" and "On Node", with
`@testcontainers/postgresql` for the same two tests.

## `docker-compose.dev.yml`

The database for this Mac. The production compose file comes later, from
`backend.md` step 2.

```yaml
# Local development only.
name: myapp-dev   # fixed, so every worktree uses the same database and port

services:
  myapp-db:
    image: postgres:17-alpine   # the major version you deploy
    environment:
      POSTGRES_DB: myapp
      POSTGRES_USER: myapp
      POSTGRES_PASSWORD: dev    # dev only; the port is bound to this Mac
    ports: ["127.0.0.1:5433:5432"]
    volumes: [myapp-dev-db:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U myapp -d myapp"]
      interval: 5s
      retries: 10

volumes:
  myapp-dev-db:
```

Use a different host port for each app on this Mac.

## `.github/workflows/ci.yml`

On GitHub's machines, never on the box's runner (`backend.md` step 7, "Rules
for the runner"). Docker is there, so Testcontainers works.

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  mobile:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4       # before setup-node, or its pnpm cache fails
      - uses: actions/setup-node@v4
        with: { node-version-file: .node-version, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test:mobile

  api:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-dotnet@v4
        with: { dotnet-version: "10.0.x" }
      - run: dotnet build apps/api/MyApp.sln -c Release -warnaserror
      - run: dotnet test apps/api/MyApp.sln -c Release --no-build
```

Without an API, delete the `api` job. The Expo app's `package.json` is the
root one, and it has `test`, not `test:mobile`. So the last `mobile` step is:

```yaml
      - run: pnpm test
```

## `AGENTS.md`

Start with the block for this layout. Put the test-loop block under it.

With an API in the repo:

```markdown
# MyApp

- `apps/mobile`: the Expo app. `apps/api`: the API.
- Before you change the app, read `apps/mobile/AGENTS.md`. It is Expo's
  guide for this SDK.
- Run Expo and EAS commands only from `apps/mobile`. The root `app.config.js`
  throws on purpose.
- `apps/mobile/ios/` is generated. Change `app.json` or a config plugin, then
  rebuild.
- Dev database: `pnpm db:up`, on port <db port>. API: `pnpm dev:api`, on port
  <api port>. The dev client reads that URL from `apps/mobile/.env.local`
  (not in git). Change the port in both places.
- Every setting the API needs is listed in the compose file's `environment:`
  block. A value only in the secrets tool never reaches the container.
- The user id comes from the token, never from the request.
```

Hosted backend or no server. The template's `AGENTS.md` is already at the
root, so put this block at its top:

```markdown
# MyApp

- The Expo app is the repo root. There is no API in this repo.
- Before you change the app, read the Expo part further down in this file.
  It is Expo's guide for this SDK.
- Run Expo and EAS commands from the repo root.
- `ios/` and `android/` are generated. Change `app.json` or a config plugin,
  then rebuild.
- All checks: `pnpm check` (typecheck, lint, tests).
```

With a hosted backend, change the first line to: "The Expo app is the repo
root. The backend is <service>, hosted. There is no API in this repo."
