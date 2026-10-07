# The four files, and why each line is there

The files themselves are in `assets/`: `Dockerfile`, `dockerignore` (copy it to
`.dockerignore`), `docker-compose.yml`, `workflows/deploy.yml` (copy it to
`.github/workflows/deploy.yml`). This page explains them, so a later edit does
not quietly undo something load-bearing.

## Dockerfile

Three stages, so the runtime image carries neither the toolchain nor the full
`node_modules`. `output: "standalone"` in `next.config.ts` makes Next emit a
`server.js` plus only the dependencies it traces.

**`bookworm-slim`, not `alpine`.** `sharp` does Next's production image
optimization, and image optimization is the reason to run a real Next server
instead of a static export. glibc has much better prebuilt-binary coverage than
musl. A missing binary degrades images *silently*; the build still passes.

**`static/` and `public/` are copied separately.** They are not part of the
standalone trace. Leave them out and every asset 404s while the page itself
still renders. A quick smoke test misses that.

**`HEALTHCHECK` uses Node's global `fetch`,** so the image needs no `curl`.
`docker compose up -d --wait` blocks on it. That is what makes the deploy wait
for real readiness, not only "process started".

**Node 22**, or whatever the repo's CI uses. The version that passes a pull
request should be the version that serves production.

### pnpm variant

```dockerfile
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
```

If `pnpm-workspace.yaml` lists more than one package, Next nests the standalone
output under the workspace path, and `CMD` needs the nested `server.js`. With
`packages: [.]` it lands at `/app/server.js`. Check the built image; do not assume:

```sh
docker run --rm --entrypoint sh <image> -c 'find / -maxdepth 4 -name server.js -not -path "*/node_modules/*"'
```

### Build-time environment variables

Next inlines `NEXT_PUBLIC_*` into the client bundle **at build time**. A compose
`environment:` entry does nothing: the value is already baked in. The failure is
silent. The app falls back to its default and, for example, posts a contact form
to `localhost:5000` forever.

```dockerfile
ARG NEXT_PUBLIC_API_URL=https://api.example.com
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
...
RUN grep -rq "api.example.com" .next/static \
 || (echo "ERROR: NEXT_PUBLIC_API_URL was not inlined" && exit 1)
```

Assert it. A build that fails loudly beats a form that silently posts nowhere.
Public values only: anything in `NEXT_PUBLIC_*` ships to every browser.

## .dockerignore

`.npmrc` is excluded on purpose. An `.npmrc` with `always-auth=true` makes npm
send credentials to the public registry, which can return 401 inside an image
that has none. The deps stage sets the default registry explicitly anyway.
`.env*` and `.onebox.json` stay out so no local secret or config lands in a layer.

## docker-compose.yml

**No `ports:`.** Traefik reaches the container over the proxy network on its
internal `:3000`. Every site can use `:3000`; nothing collides. A published port
is the one change most likely to break something else on a shared box, and on a
VPS it is public, because Docker-published ports skip ufw.

**`.service=NAME` on the router is not optional.** If Traefik sees two services
on one container, it drops *every* router on that container, silently.

**`certresolver=cloudflare`.** DNS-01 renews behind the tunnel. A TLS-ALPN
resolver issues fine on day one and then stops renewing without an error.

**Unique names.** Router and service names are global across every stack on the
box. Prefix them with the site.

## .github/workflows/deploy.yml

**No separate test job.** A landing page without a test suite would only run
`next build` in a hosted job, and the image build already does that, inside the
exact image that will serve. It fails safe: a red build is a no-op, not an
outage. Add a `needs: test` job in front if a real suite appears.

**Per-site `concurrency.group`.** The runner is shared with every other deploy
on the box. A shared group name makes unrelated sites queue behind each other.

**`cancel-in-progress: false`.** Killing a deploy in the middle of the swap
leaves nothing serving. That is worse than making the next push wait.

**Verify the live image.** `compose up` can succeed and leave the old container
running (for example when a name clashes). The step compares image IDs.

**Scoped prune.** Only old tags of this image. `docker system prune -a` on a
shared box deletes images other stacks still need for rollback.

**Push and `workflow_dispatch` only, in a private repo.** The runner is root
on the box. In a public repo, a fork's pull request can add its own workflow
that runs there, whatever this file triggers on. So the site's repo stays
private while it deploys from the box.

## Rollback

Images carry the commit sha as well as `latest`, so rollback is a retag, not a
rebuild. That is fast at the moment it is needed.

```sh
docker tag myapp-landing:<previous-sha> myapp-landing:latest
docker compose up -d --no-build --wait
```

For a site moved off Vercel, the other rollback is DNS: point the record back to
its old Vercel target. That works only while the Vercel project still exists.
