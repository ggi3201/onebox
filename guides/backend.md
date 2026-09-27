# The backend: API and Postgres on the box

Runs on: your box. You edit files on your Mac and deploy by pushing to GitHub.

This guide puts your API and its database in one Docker Compose project on
the box, gives the API a public `https://` hostname, and deploys it on every
push to `main`.

Before you start, the box must be set up with `box:box-setup` (Docker,
Traefik on the `proxy` network, a Cloudflare Tunnel, backups). See
[vps.md](vps.md) or use your own mini PC, and [cloudflare.md](cloudflare.md).

**Using Supabase or Firebase instead?** You can skip this guide. Their auth
verifies the Apple token for you. Still read the account deletion part of
[sign-in-with-apple.md](sign-in-with-apple.md): App Review checks it whatever your backend is.

## What it is and what it costs

- One Compose project per app: an `api` container and a `db` container
  (Postgres).
- Traefik routes `api.example.com` to the API container over the shared
  `proxy` Docker network.
- The Cloudflare Tunnel carries internet traffic to Traefik. No port on the
  box is open to the internet.
- A GitHub Actions runner on the box builds and starts the containers.

Cost: nothing on top of the box. Postgres runs in the same box. No managed
database, no container registry, no second server.

## The language

I write my APIs in **ASP.NET Core (.NET)** with **Entity
Framework Core** migrations. The pattern below does not depend on that. A
**Node** API (Express, Fastify or Hono, with Prisma or Drizzle migrations)
fits the same shape. What matters:

- The API listens on one fixed port inside the container, for example `8080`.
- It reads every setting from environment variables.
- It has a `GET /health` endpoint that returns 200 without authentication.
- It runs database migrations before it serves traffic.
- It fails to start when a required setting is missing, with a message that
  names the setting.

## Steps

### 1. A Dockerfile for the API

Multi-stage: build with the SDK, ship only the runtime. Run as a non-root
user.

.NET (`apps/api/Dockerfile`):

```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY MyApp.Api/MyApp.Api.csproj MyApp.Api/
RUN dotnet restore MyApp.Api/MyApp.Api.csproj
COPY . .
RUN dotnet publish MyApp.Api/MyApp.Api.csproj -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
USER $APP_UID
COPY --from=build /app/publish .
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "MyApp.Api.dll"]
```

Node (`apps/api/Dockerfile`):

```dockerfile
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /app ./
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
```

Copy the project file (or `package.json`) and restore before you copy the
source. Then a source-only change reuses the cached restore layer.

### 2. `docker-compose.yml`

At the repo root. A minimal version:

```yaml
services:
  myapp-db:
    image: postgres:17-alpine
    container_name: myapp_db
    restart: unless-stopped
    environment:
      POSTGRES_DB: myapp
      POSTGRES_USER: myapp
      POSTGRES_PASSWORD: ${DATABASE_PASSWORD:?DATABASE_PASSWORD is required}
    volumes:
      - myapp-db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks: [myapp]

  myapp-api:
    build:
      context: ./apps/api
    image: myapp-api
    container_name: myapp_api
    restart: unless-stopped
    depends_on:
      myapp-db:
        condition: service_healthy
    environment:
      DATABASE_URL: "Host=myapp-db;Port=5432;Database=myapp;Username=myapp;Password=${DATABASE_PASSWORD}"
      JWT_SECRET_KEY: ${JWT_SECRET_KEY:?JWT_SECRET_KEY is required}
      APPLE_CLIENT_ID: com.example.myapp
      REVENUECAT_SECRET_KEY: ${REVENUECAT_SECRET_KEY:-}
    healthcheck:
      # The aspnet image has no curl. For a Node image use:
      # ["CMD", "node", "-e", "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      test: ["CMD", "bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/8080 && printf 'GET /health HTTP/1.0\\r\\n\\r\\n' >&3 && grep -q '200 OK' <&3"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s
    networks: [myapp, proxy]
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=proxy"
      - "traefik.http.routers.myapp-api.rule=Host(`api.example.com`)"
      - "traefik.http.routers.myapp-api.entrypoints=websecure"
      - "traefik.http.routers.myapp-api.tls.certresolver=cloudflare"
      - "traefik.http.routers.myapp-api.service=myapp-api"
      - "traefik.http.services.myapp-api.loadbalancer.server.port=8080"

networks:
  myapp:
  proxy:
    external: true   # owned by the Traefik stack; never removed by this project

volumes:
  myapp-db-data:
```

Why it looks like this:

- **No `ports:`.** Traefik reaches the API over `proxy`. The database is only
  on the private `myapp` network, so nothing else on the box can reach it.
  Docker-published ports skip the `ufw` firewall, so a published port can be
  public even when `ufw` says no. For a manual query, use
  `docker compose exec myapp-db psql -U myapp myapp`.
- **`depends_on: condition: service_healthy`.** Postgres accepts connections
  for a moment during first start and then restarts. The API waits for the
  real "ready".
- **`start_period`** gives migrations time before the first health check
  counts.
- **Router and service names are unique** on the whole box (`myapp-api`, not
  `api`). Two stacks with the same router name break each other.
- **`certresolver=cloudflare`** is the DNS-01 resolver `box:box-setup`
  created. Other challenge types cannot renew behind the tunnel.
- **Name the Postgres image `postgres:...`.** The nightly backup from
  `box:box-setup` finds databases by image name. An image such as
  `pgvector/pgvector` has no `postgres` in its name; check that the backup
  picks it up, or it is not backed up.

### 3. Secrets

Secrets never go in the compose file, the repo or the app. The compose file
only names them: `${JWT_SECRET_KEY}`. Where the values come from depends on
`secrets.tool` in your onebox config (see [CONFIG.md](../CONFIG.md)):

| `secrets.tool` | On the box | Deploy command |
|---|---|---|
| `env` | a file outside the repo, for example `/srv/apps/myapp/.env`, mode `600` | `docker compose --env-file /srv/apps/myapp/.env up -d` |
| `doppler` | the Doppler CLI on the box; a service token for one project and config as the GitHub secret `DOPPLER_TOKEN` | `doppler run -- docker compose up -d` |
| `1password` | the `op` CLI on the box; an `app.env` file in the repo that holds only `op://` references; a service account token as the GitHub secret `OP_SERVICE_ACCOUNT_TOKEN` | `op run --env-file=app.env -- docker compose up -d` |

I use Doppler: GitHub holds only a `DOPPLER_TOKEN` scoped to
one project and one config, and the runner calls `doppler run`.

Two traps:

- **Compose passes on only what the `environment:` block lists.** A secret
  that exists in Doppler or in the `.env` file, but is not listed in the
  service's `environment:`, is not inside the container. The deploy is green,
  and the feature silently does nothing.
- **A bare `${VAR}` becomes an empty string when the value is missing.** Use
  `${VAR:?VAR is required}` for anything the app cannot run without. Compose
  then refuses to start and names the variable. Use `${VAR:-}` only for truly
  optional settings.

Generate a long random value for `JWT_SECRET_KEY` and `DATABASE_PASSWORD`
(`openssl rand -base64 48`). Put it straight into your secrets tool. Do not
print it into a chat or a log.

### 4. Health endpoint

```
GET /health  ->  200 {"ok": true}
```

No authentication, no rate limit, cheap. Docker uses it through the
`healthcheck`, and the deploy waits on it. Keep it out of your request logs so
they are not full of health checks.

### 5. Migrations on deploy

Run migrations when the API starts, before it accepts requests:

- .NET / EF Core: `await db.Database.MigrateAsync();` in `Program.cs`.
- Prisma: start the container with `npx prisma migrate deploy && node dist/server.js`.
- Drizzle: run the migrator in the startup code before `listen()`.

This is fine for one API container, which is what this setup runs. Never use
`EnsureCreated` or a "sync schema" mode in production: it creates the tables
once and never changes them again.

A migration that drops or renames a column can lose data. Make a backup first
(`sudo onebox-backup` on the box) and test the change on staging
(`box:staging-env`).

### 6. The hostname

Use `box:expose-service`. It adds the tunnel ingress for `api.example.com`,
restarts the tunnel safely, and writes a **proxied CNAME to the tunnel**.
Never an A record to the box's IP.

Use one level below your domain: `api.example.com` or `api-stg.example.com`.
Cloudflare's free certificate does not cover `api.stg.example.com`.

### 7. Deploy from GitHub Actions

I use a **self-hosted runner on the box**. A push to `main`
runs the job on the box itself, so the deploy is a local `docker compose
build` and `up`. No registry, no SSH key stored in GitHub, no open port.
Register the runner with `box:box-setup` (`references/runner.md`).

`.github/workflows/deploy-api.yml`:

```yaml
name: Deploy API

on:
  push:
    branches: [main]
    paths: ["apps/api/**", "docker-compose.yml", ".github/workflows/deploy-api.yml"]
  workflow_dispatch:

concurrency:
  group: deploy-api
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest          # tests on GitHub's machines, not on the box
    steps:
      - uses: actions/checkout@v4
      - run: echo "run your test command here"

  deploy:
    needs: test                     # a failing test never reaches production
    runs-on: [self-hosted, box]
    steps:
      - uses: actions/checkout@v4
      - name: Build and start
        env:
          DOPPLER_TOKEN: ${{ secrets.DOPPLER_TOKEN }}
        run: |
          doppler run -- docker compose build myapp-api
          doppler run -- docker compose up -d myapp-db myapp-api
      - name: Wait for health
        run: |
          for i in $(seq 1 45); do
            s=$(docker inspect --format '{{.State.Health.Status}}' myapp_api 2>/dev/null || echo missing)
            [ "$s" = healthy ] && exit 0
            [ "$s" = unhealthy ] && break
            sleep 2
          done
          docker logs --tail 60 myapp_api; exit 1
      - name: Reclaim disk
        run: docker image prune -f
```

With `secrets.tool: env`, drop the `doppler run --` prefix and add
`--env-file /srv/apps/myapp/.env` to both compose commands.

Rules for the runner:

- **Never let a `pull_request` workflow run on the self-hosted runner.** In a
  public repo, a stranger's pull request would run code on your box. Trigger
  deploys only on `push` to your branches and on `workflow_dispatch`.
- The runner's user is in the `docker` group, which is root on the box.
  Keep `permissions: contents: read`.
- The runner's checkout on the box is thrown away on the next run. Fix a
  deploy in the repo, never by editing files there.

The other common way is a GitHub-hosted runner that connects to the box over
SSH and runs `git pull && docker compose up -d`. It needs an SSH port the
internet can reach and a private key in GitHub. On a home box behind a router
that is extra work. The self-hosted runner avoids both.

### 8. HTTPS and CORS

- The app always calls `https://api.example.com`. Never `localhost`, never
  plain `http://`. See [expo-app.md](expo-app.md).
- TLS is handled for you: Cloudflare at the edge, Traefik with a Let's
  Encrypt certificate at the box. The API itself speaks plain HTTP inside the
  Docker network.
- A native iOS app is not a browser. CORS does not apply to it. Turn CORS on
  only if a web page on another origin calls the API, and then allow only
  that origin.
- Behind the tunnel, every request reaches the API from Traefik. If you rate
  limit by client IP, trust `X-Forwarded-For` only from the `proxy` network,
  with a forward limit of 2 (client, tunnel gateway). Otherwise the whole
  internet shares one rate-limit bucket.

### 9. Backups

`box:box-setup` installs a nightly job: `pg_dumpall` of every Postgres
container, then `restic` to an off-box target. Dumps on the same disk are not
a backup; set the off-box target. Then restore once to prove it works
(`box:box-setup`, `references/restore.md`). A backup you never restored is a
guess.

## Keep each user's data apart

Every row a user creates belongs to that user (or to their household). Another
user must never read or change it.

Agents usually get the simple case right. Ask for "GET /workouts/:id" and they
filter by the logged-in user. In our tests, current Claude models did that in
17 of 18 runs, and refused to trust a `userId` sent by the app. The leaks come
from the places nobody looks at twice:

- a query that turns the filter off to search across all users, and forgets
  to add the scope back;
- a filter that lets everything through when the user is missing;
- a new table that nobody added to the filter;
- a public endpoint that looks something up by email or id;
- a webhook that trusts a user id from its payload.

So do not rely on every endpoint remembering. Make the database layer do it,
and make a test fail when someone forgets.

### 1. One owner column, set from the token

Give every user-owned table an owner column (`OwnerId`, or `TenantId` when a
household shares data). Take its value from the token on the server. Never
read it from the request body, the query string or the route.

Mark those entities with an interface, so code and tests can find them:

```csharp
public interface IOwned { string OwnerId { get; set; } }

public sealed class CurrentUser(IHttpContextAccessor http)
{
    // Throws instead of returning null: "no user" must never mean "all rows".
    public string Id =>
        http.HttpContext?.User.FindFirstValue("sub")
        ?? throw new UnauthorizedAccessException("no user on this request");
}
```

### 2. A global query filter on every owned table

EF Core adds a query filter to every LINQ query on that entity, including
`Find`, `Include` and joins. A handler that looks up by id alone is then still
scoped.

```csharp
public sealed class AppDb(DbContextOptions<AppDb> options, CurrentUser user) : DbContext(options)
{
    string OwnerId => user.Id;   // read per query, so it is always this request's user

    protected override void OnModelCreating(ModelBuilder b)
    {
        // There is no "all entities" hook. Every new owned table goes here,
        // and the test in step 5 fails if one is missing.
        b.Entity<Workout>().HasQueryFilter(w => w.OwnerId == OwnerId);
        b.Entity<Comment>().HasQueryFilter(c => c.OwnerId == OwnerId);
    }

    public override Task<int> SaveChangesAsync(CancellationToken ct = default)
    {
        // Stamp the owner on insert, and refuse to move a row to another owner.
        foreach (var e in ChangeTracker.Entries<IOwned>())
        {
            if (e.State == EntityState.Added) e.Entity.OwnerId = OwnerId;
            else if (e.State == EntityState.Modified && e.Property(x => x.OwnerId).IsModified)
                throw new InvalidOperationException("OwnerId cannot change");
        }
        return base.SaveChangesAsync(ct);
    }
}
```

The filter must **fail closed**. `w.OwnerId == OwnerId` with a throwing
`OwnerId` does that. A filter like `OwnerId == null || w.OwnerId == OwnerId`
fails open: on a request where the user did not load, it returns every row.

Shared content (a curated exercise list, public recipes) can live in the same
table. Say so in the filter: `e => e.OwnerId == "" || e.OwnerId == OwnerId`.

### 3. Composite keys (optional, strong)

Make the primary key `(OwnerId, Id)`:

```csharp
b.Entity<Workout>().HasKey(w => new { w.OwnerId, w.Id });
```

Foreign keys then carry the owner too. A comment cannot point at another
user's workout, even through a bug in a handler.

### 4. Treat every `IgnoreQueryFilters()` as a review point

Background jobs, admin tools and duplicate checks sometimes need to look
across all users. `IgnoreQueryFilters()` turns the filter off for that query.
Each use must add its own scope back and say why:

```csharp
// Duplicate check looks across users, but only at rows they chose to share.
var dup = await db.Recipes.IgnoreQueryFilters()
    .Where(r => r.Url == url && (r.OwnerId == me || r.IsShared))
    .FirstOrDefaultAsync(ct);
```

A duplicate check that forgets the `IsShared` part tells user A the name and
image of user B's private recipe. Keep the list of uses short and check it in
review:

```bash
git grep -n "IgnoreQueryFilters" -- '*.cs'
```

### 5. A test that fails when a table has no filter

The weak point of this design is a new table that nobody adds to step 2. Close
it with a test that walks the model:

```csharp
[Fact]
public void every_owned_entity_has_a_query_filter()
{
    using var scope = factory.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDb>();

    var unguarded = db.Model.GetEntityTypes()
        .Where(e => typeof(IOwned).IsAssignableFrom(e.ClrType))
        .Where(e => e.GetDeclaredQueryFilters().Count == 0)   // EF Core 10; older versions: GetQueryFilter() == null
        .Select(e => e.ClrType.Name)
        .ToList();

    Assert.True(unguarded.Count == 0,
        $"Owned entities with no query filter, so their rows leak across users: {string.Join(", ", unguarded)}");
}
```

Add one behaviour test next to it: create a row as user A, request it as user
B, expect 404.

### 6. The endpoints that skip auth

List every endpoint that does not require a logged-in user: health, webhooks,
public pages, sign-in. For each one:

- **Webhooks** check a signature or a shared secret in constant time, and fail
  closed when the secret is not set. Treat user ids in the payload as data,
  not as permission. The RevenueCat `app_user_id` is only as trustworthy as
  the app that set it, so set it to your server's user id at login.
- **Lookups by email or id** (a waitlist position, an invite, a share link)
  leak whether that person exists. Require login, or use a random token
  instead of the email or id.
- **Admin endpoints** check a role on the server, not a flag from the app.

### On Node

Prisma and Drizzle have no built-in global filter. Two options that keep the
"cannot forget" property:

- **Postgres row-level security.** Enable RLS on each owned table with a policy
  `owner_id = current_setting('app.user_id')`, and set that setting at the
  start of each request's transaction. The database refuses other users' rows
  whatever the query says. Connect as a role that is not the table owner, or
  the policy does not apply.
- **A scoped repository.** Handlers never import the raw client. They get a
  `db.forUser(userId)` object whose methods always add `where owner_id = ?`.
  Add a lint rule or a grep in CI that fails on raw client imports in route
  files.

## Where the values go

| Value | Where |
|---|---|
| Box SSH, domain, apps directory, proxy network | `box.*` in `~/.config/onebox/config.json` |
| Secret values (database password, JWT key, API keys) | your secrets tool; the compose file only references them |
| `DOPPLER_TOKEN` (if you use Doppler) | a GitHub Actions secret in the app's repo |
| The API hostname | Traefik labels in `docker-compose.yml`, and the app's `eas.json` |

## Check it works

On the box, before DNS exists:

```bash
curl -sk --resolve api.example.com:443:127.0.0.1 https://api.example.com/health
docker inspect --format '{{.State.Health.Status}}' myapp_api
```

From your phone on mobile data (not your home Wi-Fi):
`https://api.example.com/health` must show `{"ok":true}`.

Then push a small change to `main` and watch the Actions run finish green.

## Common errors

- **404 with an empty body.** The request reached the tunnel's catch-all.
  The hostname has no ingress entry yet. Run `box:expose-service`.
- **Browser shows `TRAEFIK DEFAULT CERT` on the box.** The router has no
  `certresolver`, or the certificate is still being issued. Wait two minutes,
  then check the Traefik logs.
- **The router does not appear in Traefik.** The container is not on the
  `proxy` network, `traefik.enable=true` is missing, or two Traefik services
  are defined on one container without naming the service on each router.
- **`required variable ... is missing a value`.** The secret is not in your
  secrets tool, or `doppler run` / `--env-file` is missing from the command.
- **A setting is in the secrets tool but the app does not see it.** It is not
  listed under `environment:` in the compose file.
- **The API is `unhealthy` right after a deploy.** Read `docker logs
  myapp_api`. Usually a failed migration or a missing setting.
- **The runner job waits forever.** The runner is offline, busy with another
  job, or the `runs-on` labels do not match.
