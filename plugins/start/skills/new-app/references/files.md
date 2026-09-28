# The files no guide has

Replace `myapp` with the slug and `MyApp` with the slug in PascalCase. Every
other part of the skeleton comes from a guide; the skill says which.

## Root files (API in the repo)

`package.json`. Set `packageManager` to the output of `pnpm -v`. Root scripts
only delegate, so every command runs in the right folder.

```json
{
  "name": "myapp",
  "private": true,
  "packageManager": "pnpm@<version>",
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
    "dev:api": "dotnet watch --project apps/api/MyApp.Api"
  }
}
```

A Node API: use its own `test`, `build` and `dev` scripts through
`pnpm --filter api` instead of the `dotnet` ones. No API: the Expo app is the
root, and its own `package.json` needs a `check` script that runs
`typecheck`, `lint` and `test`.

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

## The API

For .NET, from the repo root:

```bash
dotnet new sln -n MyApp -o apps/api
dotnet new web -n MyApp.Api -o apps/api/MyApp.Api
dotnet new xunit -n MyApp.Api.Tests -o apps/api/MyApp.Api.Tests
dotnet sln apps/api/MyApp.sln add apps/api/MyApp.Api apps/api/MyApp.Api.Tests
dotnet add apps/api/MyApp.Api.Tests reference apps/api/MyApp.Api
(cd apps/api && dotnet new tool-manifest && dotnet tool install dotnet-ef)
```

Add the test project to the solution. A test project outside the solution
builds on your Mac and never runs in CI.

Packages: `Npgsql.EntityFrameworkCore.PostgreSQL` and
`Microsoft.EntityFrameworkCore.Design` in the API. In the tests, the ones
`agent-test-loop.md` step 5 names. Add `Directory.Build.props` in `apps/api`
from `agent-test-loop.md` step 3.

`Program.cs`:

```csharp
using Microsoft.EntityFrameworkCore;

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

public sealed class AppDb(DbContextOptions<AppDb> options) : DbContext(options);

public sealed class DesignTimeDbFactory : IDesignTimeDbContextFactory<AppDb>
{
    public AppDb CreateDbContext(string[] args) => new(new DbContextOptionsBuilder<AppDb>()
        .UseNpgsql(Environment.GetEnvironmentVariable("DATABASE_URL")
            ?? "Host=127.0.0.1;Port=5433;Database=myapp;Username=myapp;Password=dev")
        .Options);
}
```

Use the dev database port you picked, here and below.
`appsettings.Development.json` gets the same dev connection string under
`DATABASE_URL`. It is a dev value, not a secret. In `launchSettings.json`,
set the port the API listens on locally, and write it in `AGENTS.md`.

Then the first migration: `(cd apps/api && dotnet ef migrations add Initial --project MyApp.Api)`.

Tests, from `agent-test-loop.md` step 5 (one Postgres container per run, the
app through `WebApplicationFactory<Program>`):

- `GET /health` returns 200 against a real Postgres. This proves the start,
  the settings and the migration.
- The query-filter test from `backend.md`, "Keep each user's data apart",
  step 5, with the `IOwned` interface from step 1. It passes with no tables.
  It fails on the first owned table that has no filter.

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
        with: { node-version: 22, cache: pnpm }
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

## `AGENTS.md`

Start with this block. Put the test-loop block under it.

```markdown
# MyApp

- `apps/mobile`: the Expo app. `apps/api`: the API.
- Run Expo and EAS commands only from `apps/mobile`. The root `app.config.js`
  throws on purpose.
- `apps/mobile/ios/` is generated. Change `app.json` or a config plugin, then
  rebuild.
- Dev database: `pnpm db:up`, on port <db port>. API: `pnpm dev:api`, on port
  <api port>.
- Every setting the API needs is listed in the compose file's `environment:`
  block. A value only in the secrets tool never reaches the container.
- The user id comes from the token, never from the request.
```
