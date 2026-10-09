# The Node API

For "Own box, Node API". This page replaces three parts of `files.md`: the
root `package.json` scripts, "The API" and the `api` job in `ci.yml`. The rest
of `files.md` stays as it is. The Dockerfile is `backend.md` step 1, the Node
part.

Replace `myapp` with the slug.

## The picks

`backend.md`, "The language", leaves some choices open. These are the kit's:

- **Fastify, with `@fastify/rate-limit`.** `app.inject()` tests the real
  app without a port. The skeleton has the settings from `backend.md`,
  "Protect the API", "On Node": `trustProxy`, a rate limit and `bodyLimit`.
- **Drizzle, with `pg` and `drizzle-kit`.** Migrations are plain SQL files.
  The migrator runs in the app before `listen()` (`backend.md` step 5). There
  is no generated client and no engine in the image.
- **Row-level security** for "Keep each user's data apart". Postgres refuses
  other users' rows whatever the query says. A test reads the catalog and
  fails on a table that has no policy.
- **Vitest.** It runs TypeScript as it is, and its `globalSetup` starts one
  Postgres for the whole run.
- **Node runs the `.ts` files directly** in dev (type stripping). `tsc`
  builds `dist/` for the image.
- **TypeScript: the same version as the Expo app.** typescript-eslint does
  not support TypeScript 7 yet.

## Root files

`package.json` scripts. Root scripts only delegate, as in `files.md`:

```json
{
  "name": "myapp",
  "private": true,
  "scripts": {
    "start": "pnpm --filter mobile start",
    "ios": "pnpm --filter mobile ios",
    "typecheck": "pnpm --filter mobile typecheck && pnpm --filter api typecheck",
    "lint": "pnpm --filter mobile lint && pnpm --filter api lint",
    "test:mobile": "pnpm --filter mobile test",
    "test:api": "pnpm --filter api test",
    "test": "pnpm test:mobile && pnpm test:api",
    "check": "pnpm typecheck && pnpm lint && pnpm --filter api build && pnpm test",
    "db:up": "docker compose -f docker-compose.dev.yml up -d --wait",
    "dev:api": "pnpm --filter api dev"
  }
}
```

`pnpm-workspace.yaml`. The API is a package:

```yaml
packages:
  - apps/mobile
  - apps/api
```

`.gitignore`: in place of `bin/` and `obj/`, add the build output:

```
dist/
```

`.dockerignore` at the repo root: `backend.md` step 1, the Node part.

## The package

Write `apps/api/package.json` first. `files` lists what the image gets
(`backend.md` step 1): the build output and the migrations.

```json
{
  "name": "api",
  "private": true,
  "type": "module",
  "files": ["dist", "drizzle"],
  "scripts": {
    "dev": "node --watch --env-file=.env.development src/server.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/server.js",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "db:new": "drizzle-kit generate"
  }
}
```

Then add the packages from the root. The versions come from the registry.
TypeScript takes the Expo app's range, and `@types/node` the major in
`.node-version`:

```bash
mkdir -p apps/api/src apps/api/test
pnpm --filter api add fastify @fastify/rate-limit drizzle-orm pg
T=$(node -p 'require("./apps/mobile/package.json").devDependencies.typescript')   # for example ~6.0.3
pnpm --filter api add -D "typescript@$T" "@types/node@$(cat .node-version)" @types/pg \
  drizzle-kit vitest @testcontainers/postgresql eslint typescript-eslint
```

pnpm 10 says "Ignored build scripts" for `esbuild` and a few others. Leave
it: nothing here needs those scripts.

`apps/api/tsconfig.json`. Strict, as in `agent-test-loop.md` step 1. The four
options from `erasableSyntaxOnly` to `rewriteRelativeImportExtensions` let
Node run the `.ts` files and let `tsc` build them:

```json
{
  "compilerOptions": {
    "target": "es2024",
    "module": "nodenext",
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "test", "*.ts"]
}
```

`apps/api/tsconfig.build.json`. It builds `src` only, so the tests stay out
of `dist/`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": false, "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

Imports between the API's own files end in `.ts` (`./app.ts`). `tsc` rewrites
them to `.js` in `dist/`.

`apps/api/eslint.config.js`. The type-checked rules are the Node side of the
.NET analyzers. They catch a promise that nobody awaits:

```js
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores(["dist/", "eslint.config.js"]),
  tseslint.configs.strictTypeChecked,
  { languageOptions: { parserOptions: { projectService: true } } },
);
```

## The server

It meets the five rules in `backend.md`, "The language". It has the first
protections from `backend.md`, "Protect the API": step 1 (the real client
IP), step 2 (rate limits) and step 4 (request body size). The settings are
the same as for .NET (`files.md`, `Program.cs`): `TRUSTED_PROXIES`,
`RATE_LIMIT_PER_MINUTE`, `AUTH_RATE_LIMIT_PER_MINUTE` and
`MAX_REQUEST_BODY_BYTES`. The Dockerfile sets `NODE_ENV=production`, and
then a missing `TRUSTED_PROXIES` stops the start.

`src/settings.ts`:

```ts
// Every setting comes from the environment. On this Mac: .env.development.
// A missing one stops the start and names the setting.
export type Settings = { databaseUrl: string; host: string; port: number; limits: Limits };

// backend.md, "Protect the API". The defaults are for production; the tests set small ones.
export type Limits = {
  trustedProxies: string; // TRUSTED_PROXIES: the proxy network, for example 172.18.0.0/16 (step 1)
  rateLimitPerMinute: number; // every request, per user or IP (step 2)
  authRateLimitPerMinute: number; // sign-in, refresh and sign-out, per IP (step 2)
  maxRequestBodyBytes: number; // step 4
};

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`${key} is not set.`);
  return value;
}

export function loadLimits(env: NodeJS.ProcessEnv = process.env): Limits {
  return {
    trustedProxies: env.TRUSTED_PROXIES ?? "",
    rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE ?? 100),
    authRateLimitPerMinute: Number(env.AUTH_RATE_LIMIT_PER_MINUTE ?? 10),
    maxRequestBodyBytes: Number(env.MAX_REQUEST_BODY_BYTES ?? 1_000_000),
  };
}

export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  const limits = loadLimits(env);
  if (!limits.trustedProxies && env.NODE_ENV === "production") {
    throw new Error("TRUSTED_PROXIES is not set; every client would share one rate-limit bucket.");
  }
  return {
    databaseUrl: required(env, "DATABASE_URL"),
    host: env.HOST ?? "127.0.0.1", // the Dockerfile sets 0.0.0.0
    port: Number(env.PORT ?? 8080),
    limits,
  };
}
```

`src/db.ts`. The migrations run as the login user, who owns the tables. The
API's own queries run as `app_user`. Row-level security skips a superuser and
the table owner, and the Postgres image's `POSTGRES_USER` is a superuser:

```ts
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as schema from "./schema.ts";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

// As the login user, who owns the tables. server.ts runs it before listen().
export async function runMigrations(databaseUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await migrate(drizzle({ client }), { migrationsFolder });
  } finally {
    await client.end();
  }
}

// Every API connection runs as app_user (the first migration makes it).
// app_user owns no table and is not a superuser, so row-level security
// applies to every query the API makes.
export function createDb(databaseUrl: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl, options: "-c role=app_user" });
  return drizzle({ client: pool, schema });
}

export type Db = ReturnType<typeof createDb>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// One transaction as one user. The policies read app.user_id.
// Take userId from the token, never from the request.
export function asUser<T>(db: Db, userId: string, work: (tx: Tx) => Promise<T>): Promise<T> {
  if (!userId) throw new Error("no user on this request");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return work(tx);
  });
}
```

`src/app.ts`:

```ts
import rateLimit, { normalizeIP, type RateLimitOptions } from "@fastify/rate-limit";
import Fastify, { type FastifyRequest } from "fastify";
import type { Db } from "./db.ts";
import { loadLimits, type Limits } from "./settings.ts";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    // Sign-in, token refresh and sign-out: { config: { rateLimit: app.authRateLimit } }.
    authRateLimit: RateLimitOptions;
  }
  interface FastifyRequest {
    userId?: string; // set by the sign-in code, from the token
  }
}

// backend.md, "Protect the API", step 2. Partition only on values you trust.
const byIp = (req: FastifyRequest) => `ip:${normalizeIP(req.ip)}`; // groups IPv6 by subnet
const byUserOrIp = (req: FastifyRequest) => (req.userId ? `u:${req.userId}` : byIp(req));

// The whole API. The tests call it with app.inject(), with no port.
export async function buildApp(db: Db, { logger = false, limits = loadLimits({}) }: { logger?: boolean; limits?: Limits } = {}) {
  const app = Fastify({
    logger,
    // Step 1: req.ip is the client. Trust X-Forwarded-For only from the proxy network, never `true`.
    trustProxy: limits.trustedProxies || false,
    // Step 4: the largest request body. An upload route raises it for itself only: { bodyLimit: 10_000_000 }.
    bodyLimit: limits.maxRequestBodyBytes,
  });
  app.decorate("db", db);
  app.addHook("onClose", () => db.$client.end());

  // Step 2: every route, per user when signed in, else per IP. It answers 429 with Retry-After.
  // Its check runs after the app's onRequest hooks, so a sign-in hook that sets req.userId comes first.
  await app.register(rateLimit, { max: limits.rateLimitPerMinute, timeWindow: "1 minute", keyGenerator: byUserOrIp });
  // Stricter, and per IP: there is no user yet. There are no such routes yet; each one uses it when it comes.
  app.decorate("authRateLimit", { max: limits.authRateLimitPerMinute, timeWindow: "1 minute", keyGenerator: byIp });

  app.get("/health", { logLevel: "silent", config: { rateLimit: false } }, () => ({ ok: true }));

  return app;
}
```

`src/server.ts`. Settings, then migrations, then `listen()`:

```ts
import { buildApp } from "./app.ts";
import { createDb, runMigrations } from "./db.ts";
import { loadSettings } from "./settings.ts";

const settings = loadSettings();
await runMigrations(settings.databaseUrl);

const app = await buildApp(createDb(settings.databaseUrl), { logger: true, limits: settings.limits });
await app.listen({ host: settings.host, port: settings.port });

// docker stop sends SIGTERM. Node as PID 1 ignores it unless it has a handler.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => void app.close());
}
```

`src/schema.ts`, with no tables yet:

```ts
// The tables. After a change, `pnpm --filter api db:new` writes the migration.
export {};
```

`apps/api/.env.development`. Dev values, not secrets, so commit it (the root
`.gitignore` ignores `.env` and `.env.*`, and lets this one file through).
This file sets the local ports:

- `DATABASE_URL` has the dev database port. Pick it now, with the check in
  the skill's step 7, and use the same port in `docker-compose.dev.yml`.
- `PORT` is the API port. Pick a free one (`lsof -iTCP:8090 -sTCP:LISTEN`
  prints nothing). It is the `<api port>` in `apps/mobile/.env.local`
  (step 7) and in `AGENTS.md`.

```
# Dev values for this Mac, not secrets. Production settings come from the compose file.
DATABASE_URL=postgres://myapp:dev@127.0.0.1:5433/myapp
PORT=8090
```

## Migrations

`apps/api/drizzle.config.ts`. `drizzle-kit` only writes migration files; it
never connects:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
});
```

The first migration. With no tables, a plain `drizzle-kit generate` prints
"No schema changes, nothing to migrate" and writes nothing. The migrator then
finds no `meta/_journal.json` and fails. So make an empty custom one:

```bash
pnpm --filter api db:new --custom --name initial
```

It writes `drizzle/0000_initial.sql` and `drizzle/meta/`. Put the role in
that file:

```sql
-- The role the API runs as (src/db.ts). It owns no table and is not a
-- superuser, so row-level security applies to it.
DO $$
BEGIN
  CREATE ROLE app_user NOLOGIN;
EXCEPTION
  -- Roles belong to the server, not the database. The tests make many databases on one server.
  WHEN duplicate_object OR unique_violation THEN NULL;
END $$;
--> statement-breakpoint
GRANT app_user TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_user;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;
```

Later, each change to `src/schema.ts` gets
`pnpm --filter api db:new --name <what>`. An owned table has an `owner_id`
column and a policy. With a `pgPolicy`, `drizzle-kit` writes
`ENABLE ROW LEVEL SECURITY` and `CREATE POLICY` into the migration:

```ts
import { sql } from "drizzle-orm";
import { pgPolicy, pgTable, text, uuid } from "drizzle-orm/pg-core";

// Set by asUser. After that transaction, a pooled connection keeps the setting
// as ''. nullif turns '' (and a missing setting) into null, which matches no row.
const me = sql`nullif(current_setting('app.user_id', true), '')`;

export const notes = pgTable(
  "notes",
  {
    id: uuid().primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull().default(me),   // the database stamps the owner
    body: text().notNull(),
  },
  (t) => [pgPolicy("notes_owner", { for: "all", using: sql`${t.ownerId} = ${me}`, withCheck: sql`${t.ownerId} = ${me}` })],
);
```

Handlers run their queries in `asUser(app.db, userId, (tx) => ...)`. Outside
it, a query on an owned table finds no rows, and an insert fails. It never
finds all rows. `withCheck` stops an insert or update
that sets another owner.

## Tests

From `agent-test-loop.md` step 5: one Postgres container for the run, one
database per test file, and the real app on it.

`apps/api/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["test/global-setup.ts"],
  },
});
```

`test/global-setup.ts`:

```ts
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    postgresUri: string;
  }
}

// One Postgres server for the whole test run. Pin the major version you deploy.
export default async function setup(project: TestProject) {
  const server = await new PostgreSqlContainer("postgres:17-alpine").start();
  project.provide("postgresUri", server.getConnectionUri());
  return async () => {
    await server.stop();
  };
}
```

`test/database.ts`:

```ts
import { randomUUID } from "node:crypto";
import pg from "pg";
import { inject } from "vitest";
import { buildApp } from "../src/app.ts";
import { createDb, runMigrations } from "../src/db.ts";
import type { Limits } from "../src/settings.ts";

// A new, empty database on the run's server, migrated. One per test file,
// so test files that run in parallel never see each other's rows.
export async function createDatabase(): Promise<string> {
  const server = inject("postgresUri");
  const name = `test_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: server });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  const url = new URL(server);
  url.pathname = `/${name}`;
  await runMigrations(url.href);
  return url.href;
}

// The real app on its own database, as server.ts starts it, without a port.
export async function createTestApp(limits?: Limits) {
  const databaseUrl = await createDatabase();
  return buildApp(createDb(databaseUrl), { limits });
}
```

The two first tests, as for .NET. `test/health.test.ts`:

```ts
import { afterAll, expect, test } from "vitest";
import { createTestApp } from "./database.ts";

const app = await createTestApp();
afterAll(() => app.close());

// Proves the start, the settings and the migration against a real Postgres.
test("GET /health returns 200", async () => {
  const res = await app.inject({ method: "GET", url: "/health" });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ ok: true });
});
```

`test/isolation.test.ts`, the Node form of `backend.md`, "Keep each user's
data apart", step 5. There is no `IOwned` marker: the `owner_id` column is
the marker. It passes with no tables. It fails on the first table with an
`owner_id` and no policy. The second test fails if the API runs as a role
that skips the policies:

```ts
// backend.md, "Keep each user's data apart", step 5 and "On Node".
// The owner_id column is the marker: a table that has one belongs to a user.
import { sql } from "drizzle-orm";
import { afterAll, expect, test } from "vitest";
import { createTestApp } from "./database.ts";

const app = await createTestApp();
afterAll(() => app.close());

test("every table with an owner_id has row-level security and a policy", async () => {
  const { rows } = await app.db.execute<{ table: string }>(sql`
    select c.relname as table
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'owner_id' and not a.attisdropped
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and (not c.relrowsecurity or not exists (select 1 from pg_policy p where p.polrelid = c.oid))
    order by 1`);
  expect(rows.map((r) => r.table), "Tables with no row-level security, so their rows leak across users").toEqual([]);
});

// A superuser, a BYPASSRLS role or the table owner skips every policy.
test("the API runs as a role that row-level security applies to", async () => {
  const { rows } = await app.db.execute(sql`
    select r.rolsuper as superuser, r.rolbypassrls as bypass_rls,
      exists (select 1 from pg_class c where c.relowner = r.oid and c.relnamespace = 'public'::regnamespace) as owns_tables
    from pg_roles r where r.rolname = current_user`);
  expect(rows).toEqual([{ superuser: false, bypass_rls: false, owns_tables: false }]);
});
```

Add the behaviour test with the first owned table: user A creates a row, user
B asks for it and gets 404.

`test/protection.test.ts`, the two tests from .NET and one more: past the rate
limit, 429 with `Retry-After`, also with a new `X-Forwarded-For` on each
request; over the body size limit, 413; and behind a trusted proxy, one bucket
per client from `X-Forwarded-For`. Each test builds its own app with one
small limit. The skeleton has no POST route yet, so the test adds one:

```ts
// backend.md, "Protect the API", steps 1, 2 and 4. Each test builds its own app with one small limit.
import { expect, test } from "vitest";
import { loadLimits } from "../src/settings.ts";
import { createTestApp } from "./database.ts";

async function appWith(env: NodeJS.ProcessEnv) {
  const app = await createTestApp(loadLimits(env));
  // The skeleton has no POST route yet. This one stands in for the first JSON endpoint.
  app.post("/read-body", () => ({ ok: true }));
  return app;
}

test("requests past the rate limit get 429", async () => {
  const app = await appWith({ RATE_LIMIT_PER_MINUTE: "3" });
  const codes: number[] = [];
  for (let i = 1; i <= 4; i++) {
    // A new X-Forwarded-For on each request. The API must not trust it (step 1),
    // or a bot gets a fresh bucket for every request.
    const res = await app.inject({ method: "POST", url: "/read-body", payload: {}, headers: { "x-forwarded-for": `203.0.113.${String(i)}` } });
    codes.push(res.statusCode);
    if (res.statusCode === 429) expect(res.headers["retry-after"]).toBeDefined();
  }
  await app.close();
  expect(codes).toEqual([200, 200, 200, 429]);
});

test("a body over the size limit gets 413", async () => {
  const app = await appWith({ MAX_REQUEST_BODY_BYTES: "1000" });
  const small = await app.inject({ method: "POST", url: "/read-body", payload: { text: "x".repeat(900) } });
  const large = await app.inject({ method: "POST", url: "/read-body", payload: { text: "x".repeat(2000) } });
  await app.close();
  expect(small.statusCode).toBe(200);
  expect(large.statusCode).toBe(413);
});

test("behind a trusted proxy, each client gets its own bucket", async () => {
  // inject() comes from 127.0.0.1. Here that address is the proxy, as Traefik
  // is in production (step 1), so X-Forwarded-For names the client.
  const app = await appWith({ RATE_LIMIT_PER_MINUTE: "3", TRUSTED_PROXIES: "127.0.0.1/32" });
  const send = async (ip: string) =>
    (await app.inject({ method: "POST", url: "/read-body", payload: {}, headers: { "x-forwarded-for": ip } })).statusCode;
  const fourClients = [await send("203.0.113.1"), await send("203.0.113.2"), await send("203.0.113.3"), await send("203.0.113.4")];
  const oneClient = [await send("203.0.113.9"), await send("203.0.113.9"), await send("203.0.113.9"), await send("203.0.113.9")];
  await app.close();
  expect(fourClients).toEqual([200, 200, 200, 200]);
  expect(oneClient).toEqual([200, 200, 200, 429]);
});
```

## `ci.yml`: the `api` job

In place of the .NET job. The `mobile` job's `pnpm typecheck` and `pnpm lint`
cover the API too, through the root scripts.

```yaml
  api:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with: { node-version-file: .node-version, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter api build
      - run: pnpm test:api
      - run: docker build -f apps/api/Dockerfile .
```

## `AGENTS.md`

The block in `files.md` stays. Add these lines under it:

```markdown
- API tables: change `apps/api/src/schema.ts`, then
  `pnpm --filter api db:new --name <what>`. Never edit a migration that ran.
- An owned table has an `owner_id` column and a `pgPolicy`. Handlers query it
  in `asUser()`. `test/isolation.test.ts` fails without the policy.
- The `auth` limit is `app.authRateLimit`: a sign-in route takes
  `{ config: { rateLimit: app.authRateLimit } }`.
```

In the test-loop block, step 2 is
`` Types: `pnpm typecheck` and `pnpm --filter api build` `` in place of the
`dotnet build` line.
