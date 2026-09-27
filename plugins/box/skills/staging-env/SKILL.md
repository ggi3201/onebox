---
name: staging-env
description: Stand up a staging backend on the same box as production - its own API container, its own database, its own hostname - deployed from any qa/** branch, with migrations that cannot touch production. Use when the user wants a QA, staging or preview environment for an API, wants to test a breaking backend change or a database migration before main, says "deploy this branch to staging", "how do I test this PR against a real server", or "set up a staging API". Also use when a staging deploy fails with "relation already exists", or when an environment variable is set but empty inside a container.
---

# Staging backend on the same box

Runs on: your Mac for the repo and secrets; your box (over SSH) for the stack.

Gives one app a second backend on the same box: own API, own database, own
public hostname. Push a `qa/**` branch and get it deployed. The phone half (a
preview build pointed at this API) is `ship-ios:ios-preview-build`.

Cost is small. One idle api + db pair measured about 0.6% CPU, 85 MB RAM and
50 MB of disk. Leaving it running is fine. Tear it down because of copied data
or rebuild time, not because of cost.

## Config it reads

```bash
cfg() { jq -s '.[0] * .[1]' ~/.config/onebox/config.json .onebox.json 2>/dev/null \
  || cat ~/.config/onebox/config.json 2>/dev/null || echo '{}'; }
BOX=$(cfg | jq -r .box.ssh); DOMAIN=$(cfg | jq -r .box.domain)
APPS=$(cfg | jq -r '.box.appsDir // "/srv/apps"'); TOOL=$(cfg | jq -r '.secrets.tool // "env"')
LABEL=$(cfg | jq -r '.box.runnerLabel // "box"')
```

## Before you touch anything

These decide the shape of the work. Look; do not assume.

```bash
grep -E '^  [a-z0-9_-]+:' docker-compose*.yml          # every production service needs a staging twin
grep -oE 'Host\(`[^`]+`\)' docker-compose*.yml          # production hostname(s)
ls .github/workflows/                                    # the production deploy to copy
grep -nE 'doppler|op run|env-file|secrets\.' .github/workflows/*.yml   # how production gets secrets
```

Note the database image and mount path, and any other stateful service (object
storage, queue). Staging needs its own copy of each.

## Steps

1. **Staging compose file.** Start from `assets/docker-compose.stg.yml`. A
   *separate* file, never an override. Change every name: project, services,
   `container_name`, volumes, router and service labels. Database on the
   stack's own network only, never on the proxy network. No `ports:`.
2. **Hostname.** One level below the domain: `api-stg.example.com`. The free
   edge certificate does not cover `api.stg.example.com`.
3. **Secrets for staging** (by `secrets.tool`):
   **Never production's secret values.** Start from production's key *names*.
   Give staging new values for everything that grants access: the JWT secret,
   the database password, webhook secrets. For paid APIs use a separate key
   with a low spend limit, or the provider's test mode (RevenueCat sandbox,
   Stripe test keys). A staging bug must not be able to spend production's
   budget or sign tokens production accepts.
   - `env` (default): write `$APPS/myapp-stg/.env` on the box, mode 600, with
     those names and the new values. Point `DATABASE_URL` at `db-stg`.
   - `doppler`: create a `stg` config with the same key names and the new
     values, then make a token scoped to `stg`:
     `doppler configs tokens create gha-stg -p <proj> -c stg --plain | gh secret set DOPPLER_TOKEN_STG --repo owner/myapp`
     See gotcha 9 for upload quirks.
   - `1password`: a `.env.stg.tpl` of `op://` references, and a service account
     token in `OP_SERVICE_ACCOUNT_TOKEN_STG`.
4. **DNS and tunnel.** Use `box:expose-service` for `api-stg.<domain>`. It adds
   the ingress (copy of the production rule, with **both** `hostname` and
   `originServerName` changed) and the proxied CNAME.
   Staging is public from this moment. Keep it out of search results, and put
   anything a browser opens behind a login (see "Who can reach staging").
5. **Deploy workflow.** Start from `assets/deploy-stg.yml`: `push` on
   `qa/**`, one `concurrency` group, `-p myapp-stg`, the staging compose file,
   a health check through Traefik, and logs on failure. Put `$LABEL` in
   `runs-on` and `$APPS` in the env-file path. Keep only the secrets
   step that matches `secrets.tool`. **Merge it to the default branch first**
   (gotcha 1).
6. **Migrations.** They must run inside the staging stack, against
   `db-stg`: at API start-up, or as `docker compose -p myapp-stg run --rm api-stg <migrate command>`.
   Never run a migration command from the Mac with a connection string you copied.
7. **Deploy:** `git push origin HEAD:refs/heads/qa/<name>`. Watch it with
   `gh run watch`.
8. **Prove isolation.** This is the step that matters. Staging has the branch's
   migration; production does not:

   ```bash
   ssh "$BOX" bash -s <<'EOF'
   for c in myapp_db_stg myapp_db; do
     printf '%s: ' "$c"
     docker exec -i "$c" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA' \
       <<< 'select max("MigrationId") from "__EFMigrationsHistory";'
   done
   EOF
   ```

   History tables by tool: `__EFMigrationsHistory` (EF Core), `schema_migrations`
   (Rails, golang-migrate), `alembic_version` (Alembic), `_prisma_migrations`
   (Prisma), `flyway_schema_history` (Flyway).

9. **Tell the user** the staging URL, that it is public, and what data it holds.
   Then hand over to `ship-ios:ios-preview-build` if a phone build should point here.

## Who can reach staging

A staging hostname is on the internet like production. Proportionate defaults:

- **The staging API** stays reachable, because the preview build on your phone
  calls it. It holds no real user data (gotcha 6), has its own secrets (step 3)
  and the same rate limits and quotas as production. Add a `noindex` header so
  search engines drop it (the asset compose file has the labels).
- **Anything a browser opens** (a staging site, an admin page, API docs) goes
  behind Cloudflare Access: `guides/cloudflare.md`, "Put admin tools behind
  Access". The cheaper fallback is Traefik basic auth plus `noindex`
  (`references/gotchas.md`, gotcha 11).
- **Never a copy of production's personal data** behind a staging hostname,
  unless the user asks, knows it is public, and the personal fields are
  scrubbed.

## Gotchas

Full list with fixes: `references/gotchas.md`. The short version:

1. A workflow runs only if it exists **on the pushed branch**.
2. Separate compose file, not an override, or staging adopts production's containers.
3. Databases never on the proxy network: service names resolve across stacks there.
4. `KEY: ${VAR}` with `VAR` unset becomes `""`. Use `${VAR:?required}`.
5. Router names are global. Suffix `-stg`.
6. A copy of production data is real user data. Default to an empty database.
7. A renumbered migration fails with `42P07 relation already exists`. Rename the history row.
8. Object storage and queues need their own staging copy too.
9. Doppler: upload takes a file, `DOPPLER_*` keys are read-only, tokens are per config.
10. Webhooks and OAuth callbacks still point at production.
11. Staging is public. `noindex` for the API; Access or basic auth for pages.

## Tear down

`docker compose -p myapp-stg down` stops staging and keeps its volume.
Removing the volume (`down -v`) deletes the staging data: ask first. Then
remove the hostname: its ingress entry (see `box:expose-service`
`references/topology.md`) and its DNS record. Delete the staging secrets last.
