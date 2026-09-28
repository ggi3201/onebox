# Staging gotchas

Each of these cost real time on a real box.

## 1. A workflow runs only if it exists on the pushed branch

An older branch has no `deploy-stg.yml`. `git push origin HEAD:refs/heads/qa/x`
then does nothing, silently. Merge the staging workflow to the default branch
first. Branches cut before that need the workflow cherry-picked.

## 2. Use a separate compose file, not an override

An override that forgets one `container_name` or one volume adopts the
production container instead of creating a new one. The first symptom is
staging writing to the production database. A separate file with a separate
project name (`-p myapp-stg`) cannot adopt anything.

## 3. The database must not sit on the shared proxy network

Service names are DNS names on every network a container joins. If production's
`db` and staging's `db` both join the proxy network, the name `db` resolves to
both, and the staging API may connect to production. Keep databases on the
stack's own `default` network only. Give the staging database its own service
name too (`db-stg`), and use that name in the staging connection string.

## 4. Compose turns `KEY: ${VAR}` into an empty string

When `VAR` is unset, compose passes `KEY=""`, not an absent variable. Code like
`config["KEY"] ?? "default"` keeps the `""`, and the app asks for a model or a
bucket named `""`. Deleting the secret does not help: compose puts it back empty
on every deploy. Use `${VAR:?required}` or `${VAR:-default}`, or omit the line,
and treat blank as unset in code.

## 5. Traefik router names are global

All stacks share one Traefik. A staging router named like production's silently
takes over production's route. Suffix every router and service with `-stg`.

## 6. A staging copy of production data is real user data

A staging database restored from production holds real users, behind a public
hostname. If it also shares production's JWT secret, production tokens work on
staging and the other way round. Default to an empty database plus migrations.
Copy production only when the user asks, say this out loud, give staging its own
JWT secret, and offer to scrub personal fields.

## 7. Renumbering a migration strands the staging database

Staging keeps the migration-history rows an earlier push of the same `qa/**`
branch wrote. Change a migration's ID (regenerate it, rebase, squash) and the
tool no longer recognises the applied row. It tries to create the table again,
and the deploy dies on `42P07 relation "X" already exists`. In EF Core the stack
trace is forty lines of Npgsql that name neither the migration nor the cause.

Check the schema really matches, then rename the row instead of dropping anything:

```bash
ssh user@host bash -s <<'EOF'
docker exec -i myapp_db_stg sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  <<< "UPDATE \"__EFMigrationsHistory\" SET \"MigrationId\" = '<new_id>' WHERE \"MigrationId\" = '<old_id>';"
EOF
```

Dropping the staging volume also works, and is cleaner when the schemas really
differ. It costs the staging data. Ask first: that is a delete.

## 8. Other stateful services need their own copy too

Object storage (for example MinIO), queues, caches: staging needs its own
container **and** its own volume or bucket, or it writes into production's.
List every service in the production compose file and give each one a staging
twin, or point staging at a separate bucket.

## 9. Doppler specifics

- `doppler secrets upload` takes a **file path** and has no `--no-interactive` flag.
- The `DOPPLER_*` keys are read-only. Strip them from a download before upload,
  or the upload fails.
- A service token is scoped to one config. The production `DOPPLER_TOKEN` cannot
  read `stg`; create `DOPPLER_TOKEN_STG` for it.
- Pipe the token into `gh secret set` (it reads stdin). Do not pass it through
  `xargs` or `--body`: that puts the secret on a command line.

## 10. Webhooks and OAuth callbacks still point at production

Third-party webhooks (payments, subscriptions) and OAuth redirect URLs are set to
production's hostname. Staging will not receive them unless you register the
staging hostname with each provider, usually in its sandbox or test mode.

## 11. Staging is public, and search engines find it

A hostname with a tunnel ingress answers to anyone. Scanners and search engines
find new hostnames within days, from certificate logs and DNS.

For every staging router, send a `noindex` header:

```yaml
- "traefik.http.middlewares.myapp-stg-noindex.headers.customresponseheaders.X-Robots-Tag=noindex, nofollow"
- "traefik.http.routers.myapp-api-stg.middlewares=myapp-stg-noindex,secure-headers@file"
```

For pages a browser opens, prefer Cloudflare Access (`https://onebox.lokkesveen.com/guides/cloudflare.md`).
The fallback is Traefik basic auth. Make the hash with `htpasswd -nB qa` and
store it in the staging secrets as `STG_BASIC_AUTH`, not in the repo:

```yaml
- "traefik.http.middlewares.myapp-stg-auth.basicauth.users=${STG_BASIC_AUTH:?required}"
- "traefik.http.routers.myapp-web-stg.middlewares=myapp-stg-auth,myapp-stg-noindex"
```

Compose substitutes the variable once, so the `$` signs inside the hash stay as
they are. Do not put basic auth on the API router: the app does not send it.

Check it: `curl -sI https://api-stg.example.com/health | grep -i x-robots-tag`
shows `noindex`. A staging page asks for a login in a private window.

