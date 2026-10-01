---
name: new-landing-page
description: Scaffold a self-hosted Next.js landing page on your box, with the privacy policy and support page App Store Connect asks for - Dockerfile, compose file with Traefik labels, and a deploy-on-push workflow - then put it on a hostname through the Cloudflare tunnel. Also moves an existing Next.js site off Vercel onto the box with no downtime. Use when the user asks for a new landing page, marketing site or microsite, says "make a landing page for X", "put X on a domain", "host this site", "self-host this Next.js app", "get off Vercel", or "move this site to my server".
---

# New self-hosted landing page

Runs on: your Mac for the repo; your box (over SSH) for the build and the exposure.

A Next.js site on your box, deployed on every push, at a hostname under
`box.domain`. No registry and no preview deploys: the runner and the Docker host
are the same machine.

**Static only?** If the site is a static export with no server features, host
it on Cloudflare Pages instead. Its free plan covers it, and it needs no box.
Use this skill when the site needs a Next server (image optimization, route
handlers, server rendering), or when you want everything on one box.

## Config it reads

```bash
cfg() { jq -s '.[0] * .[1]' ~/.config/onebox/config.json .onebox.json 2>/dev/null \
  || cat ~/.config/onebox/config.json 2>/dev/null || echo '{}'; }
BOX=$(cfg | jq -r .box.ssh); DOMAIN=$(cfg | jq -r .box.domain)
NET=$(cfg | jq -r '.box.proxyNetwork // "proxy"'); LABEL=$(cfg | jq -r '.box.runnerLabel // "box"')
```

The box must pass `box-setup.sh check` and have a runner for this repo
(`box:box-setup`, `references/runner.md` there).

## Architecture

```
push -> self-hosted runner on the box -> docker build (this IS the CI gate)
     -> docker compose up -d --wait
     -> container on the proxy network, :3000, NO published host port
     -> Traefik (certresolver=cloudflare)
     -> cloudflared tunnel -> proxied CNAME
```

**No published host ports.** Never add a `ports:` mapping. It is the one change
that can break something else on the box, and on a VPS it is public.

## Procedure

### 1. Pick the hostname and check it is free

```sh
dig +short @1.1.1.1 www.example.com
ssh "$BOX" 'curl -s 127.0.0.1:8081/api/http/routers' | grep -i www
```

One level below the domain. No `*` wildcard; add a real record.

### 2. Scaffold or adapt the app

New site: `npx create-next-app@latest --ts --tailwind --app --eslint`.
Existing site: keep it as it is and only add the files below. In
`next.config.ts` add `output: "standalone"`.

### 3. Add the pages Apple asks for

If the site belongs to an iOS app, App Store Connect needs a public privacy
policy and a support page. A paywall also needs terms. Add them as routes:

- `/privacy`: what the app collects, why, which services get it (hosting,
  RevenueCat, the AI provider), how to delete the account, and the date.
- `/support`: the app's name, a contact email, and answers to "how do I restore
  my purchase" and "how do I delete my account". Link to `/privacy`.
- `/terms`: only when the app sells subscriptions. Apple's standard EULA is
  fine if the user has no terms of their own.

The full checklist for each page:
`https://onebox.lokkesveen.com/guides/privacy-and-support-pages.md`. It has
sample wording for deleting the account: use it in `/privacy` and `/support`,
and make the app's Settings text say the same. Read the app's code for what it
really sends where, and for what the delete code removes. Do not copy another
app's policy.
Put the URLs in the footer, so App Review can find them from the home page.

### 4. Add the four files

Copy from `assets/` and replace `myapp-landing`, `myapp_landing`,
`www.example.com`, `proxy` (your `box.proxyNetwork`) and the `box` runner
label in `runs-on` (your `box.runnerLabel`). The reasons behind
each line: `references/templates.md`. Read it before you "simplify" anything.

- `Dockerfile` (npm; pnpm variant in templates.md), `.dockerignore`
- `docker-compose.yml`: Traefik labels, proxy network, no ports
- `.github/workflows/deploy.yml`: `runs-on: [self-hosted, $LABEL]`, per-site concurrency

**Look for `NEXT_PUBLIC_*` variables first.** Next inlines them at *build*
time. A compose `environment:` entry is too late and fails silently. Make them
`ARG`s in the Dockerfile and assert they got inlined. When you move a site off
Vercel, read the live values from the deployed bundle instead of guessing:

```sh
curl -s https://www.example.com/ | grep -oE '/_next/static/chunks/[^"]+\.js' | sort -u \
  | while read c; do curl -s "https://www.example.com$c"; done \
  | grep -ohE 'https?://[a-z0-9.-]+/api[^"]*' | sort -u
```

### 5. Build and verify on the box, before any DNS

Push to the deploy branch (or run the workflow by hand). Then:

```sh
ssh "$BOX" "docker ps --filter name=myapp_landing --format '{{.Names}} {{.Status}} ports=[{{.Ports}}]'"
# ports MUST read 3000/tcp with no 0.0.0.0: mapping
ssh "$BOX" "curl -sk -o /dev/null -w '%{http_code} %{size_download}\n' \
  --resolve www.example.com:443:127.0.0.1 https://www.example.com/"
```

### 6. Tunnel ingress and DNS

Use **`box:expose-service`**. Its `expose.py` backs up the tunnel config, adds
the ingress before the catch-all, validates, restarts the cloudflared replicas
one by one while it watches every other hostname, and writes the proxied CNAME.
Use `--ingress-only` first and `--dns-only` later when you move a live site.

### 7. Verify

Never with "did it 200". The tunnel catch-all returns 404, and so does a healthy
app with no root route. Compare with a baseline taken *before* the change, and
run expose-service's `audit-exposure.py`. Add an uptime monitor if you run one.

## Moving a site off Vercel

1. `git pull` first. Local checkouts drift.
2. Record a rollback baseline: DNS record ID, current CNAME target, body size.
3. Do steps 1 to 5 while Vercel still serves all traffic.
4. `expose.py --ingress-only`, test through the tunnel, soak, then `--dns-only`.
   Rollback is pointing the record back at the Vercel target.
5. Prove parity: strip Vercel's `?dpl=<id>` cache-busting parameter from its HTML,
   then compare byte counts with the box. They should match exactly.
6. Delete the Vercel project only after the user confirms.

## Hard constraints

Each of these has caused an outage or a silent time bomb.

- `certresolver=cloudflare`, never a TLS-ALPN or HTTP challenge resolver. They
  issue and then stop renewing behind the tunnel, with no error.
- Name the Traefik service on every router (`.service=NAME`). Two services on
  one container make Traefik drop every router on it.
- Tunnel ingress targets `https://localhost:443`, never `:80`.
- Proxied CNAME to the tunnel. Never an A record to the origin IP.
- No `ports:` in the compose file.
- Scoped prune only. Never `docker system prune -a` on a shared box.
- No `pull_request` trigger on a workflow that runs on the box.

## References

- `references/templates.md`: the four files, explained
- `box:expose-service`: DNS rules, tunnel modes, pitfalls, audit
- `box:box-setup`: the baseline and the runner
