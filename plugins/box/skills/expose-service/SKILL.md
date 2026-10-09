---
name: expose-service
description: "Make a service on the box reachable at a hostname under your domain, or change how an existing one is reached - Traefik labels, Cloudflare Tunnel ingress and the DNS record, done in the safe order with a before/after check. Also audits which hostnames leak the origin IP. Use when the user says 'give it a URL', 'make this public', 'expose', 'publish', 'put it on a subdomain', 'add a DNS record', 'point the domain at', 'A record', 'CNAME', 'cloudflare tunnel', 'cloudflared', 'certresolver', 'traefik router', 'host this', 'make it LAN-only', 'put the dashboard behind a login', 'Cloudflare Access', or 'rate limit this route'. Also use when a task only needs a URL on the side - a new site, an API for an app, a webhook - because the DNS step is where the mistake gets made."
---

# Expose a service

Runs on: your Mac for the plan and the DNS token; the scripts run on your box (over SSH).

## The rule

**Never create a DNS record that points at the origin IP.** Every public
hostname is a **proxied CNAME to the Cloudflare tunnel**.

An A record to the public IP works at once. That is why it keeps getting
written. It also puts the origin address in public DNS, skips the WAF, and
needs open ports. All of this is invisible on the day it happens.

The one exception is `box.tunnel: none` on a VPS. Then a proxied A record is the
design, and the provider firewall must limit 80/443 to Cloudflare.

**An `ipAllowList` middleware does not make a host private.** cloudflared reaches
Traefik from the Docker gateway (for example `172.18.0.1`). Any allowlist that
permits the gateway range lets every tunnel request through. A hostname with an
ingress entry is public, whatever the middleware says. What keeps a host private
is: no ingress entry, and a DNS record to a private address.

## Config it reads

```bash
cfg() { jq -s '.[0] * .[1]' ~/.config/onebox/config.json .onebox.json 2>/dev/null \
  || cat ~/.config/onebox/config.json 2>/dev/null || echo '{}'; }
BOX=$(cfg | jq -r .box.ssh); DOMAIN=$(cfg | jq -r .box.domain)
NET=$(cfg | jq -r '.box.proxyNetwork // "proxy"'); TUNNEL=$(cfg | jq -r '.box.tunnel // "cloudflare"')
REF=$(cfg | jq -r '.box.cloudflareTokenRef // "CLOUDFLARE_API_TOKEN"')
```

The token comes from `scripts/secret.sh "$REF"` and goes on stdin. No token
yet: follow `https://onebox.lokkesveen.com/guides/cloudflare.md`. No box yet: run `box:box-setup`.

## Decide first

| Where it should live | Record | When |
|---|---|---|
| Cloudflare tunnel | proxied CNAME -> `<tunnel-id>.cfargotunnel.com` | Anything the internet should reach. **The default.** |
| LAN only (home box) | A -> the box's LAN IP, unproxied, no ingress | Reachable from the house only. |
| Tailnet only (home box) | A -> the box's Tailscale IP, unproxied, no ingress | Dashboards and tools that follow you off the LAN. |
| Another host (Vercel, Cloudflare Pages, ...) | what that host says | Sites deployed there. Attach the domain in that host's project too, or it serves no certificate. |

LAN and tailnet records need Traefik to listen on that address. On a VPS with
the tunnel it listens on `127.0.0.1` only, so they reach nothing there, and
`expose.py --mode private` refuses. Use the tunnel with Cloudflare Access
(below) instead.

Anything else, above all an A record to the public IP, is wrong. Say so rather
than write it. Use one level below the domain: `api-stg.example.com`, not
`api.stg.example.com`. The free Cloudflare certificate covers only one level.

## Procedure

Read `references/topology.md` for paths, label shape and the tunnel modes.
Read `references/pitfalls.md` before you edit tunnel or Traefik config.

1. **Check the name is free:** `dig +short @1.1.1.1 <host>` and
   `ssh $BOX 'curl -s 127.0.0.1:8081/api/http/routers' | grep -i <name>`.
   There is deliberately no `*` wildcard. Add a real record.
2. **Traefik router:** labels in the service's `docker-compose.yml`, in the
   repo, not in the runner's working copy. Always `certresolver=cloudflare`.
   Name the service explicitly on every router (pitfall 3). Container on the
   `$NET` network, no `ports:`.
3. **Verify locally, before DNS:**
   `ssh $BOX "curl -sk -o /dev/null -w '%{http_code} %{size_download}\n' --resolve <host>:443:127.0.0.1 https://<host>/"`
4. **Ingress, restart, DNS:** copy the script and run it. Dry run first.
   The scripts run as root, so they go in a folder only the admin user can
   write, not `/tmp`. `-I` keeps Python from loading modules next to them.

   ```bash
   ssh "$BOX" 'install -d -m 700 ~/.onebox'
   scp <skill-dir>/scripts/expose.py <skill-dir>/scripts/audit-exposure.py "$BOX":.onebox/
   <skill-dir>/scripts/secret.sh "$REF" | ssh "$BOX" "sudo python3 -I ~/.onebox/expose.py <host> --domain $DOMAIN --token-stdin --dry-run"
   <skill-dir>/scripts/secret.sh "$REF" | ssh "$BOX" "sudo python3 -I ~/.onebox/expose.py <host> --domain $DOMAIN --token-stdin"
   ```

   It records a baseline, backs up the tunnel config, inserts the entry before
   the catch-all, validates (and restores on failure), probes every other
   tunnelled hostname, restarts the cloudflared replicas one by one, probes
   again, then writes the proxied CNAME. `--ingress-only` / `--dns-only` split it.
   `--mode private --ip <addr>` writes a LAN or tailnet record instead.
5. **Verify** as below. Then commit the label changes.

## Admin tools and dashboards: behind Cloudflare Access

Traefik's dashboard, Portainer, Grafana, a database UI, n8n, a log viewer: none
of them should answer to the whole internet. Their own login is one password
and one unpatched bug away from your box.

Best: no public hostname at all (LAN or tailnet record, above). When you need
it from anywhere, put **Cloudflare Access** in front. It is free for up to 50
users. Cloudflare asks for a login (a one-time PIN to your email is enough)
before any request reaches the tunnel. Steps: `https://onebox.lokkesveen.com/guides/cloudflare.md`, "Put
admin tools behind Access". Expose the hostname as usual, then add the Access
application **before** you share the URL.

On a home box, Traefik also listens on the LAN, so devices at home can reach
the tool without Access. That is usually fine. It is one more reason to keep
the tool's own login on.

Never put Access in front of the API the app calls. The app cannot log in to
Access, and every request fails.

## Rate limit a public route (optional)

The app should limit its own endpoints (`https://onebox.lokkesveen.com/guides/backend.md`, "Protect the
API"). For a route whose code you do not control, add Traefik's `ratelimit`
middleware, counted by `Cf-Connecting-Ip`: `references/topology.md`, "Rate
limit middleware".

## Verify against a baseline, not against 200

A status code alone proves nothing. The tunnel catch-all returns 404, and so
does a healthy API with no root route. Record the response before the change
and compare after:

- same status **and** same body size or content type as expected
- `dig +short @1.1.1.1 <host>` returns Cloudflare IPs, not the origin
- the origin certificate is from Let's Encrypt, not `TRAEFIK DEFAULT CERT`. Check it on
  the box, because from outside you see Cloudflare's edge certificate:
  `ssh $BOX "echo | openssl s_client -connect 127.0.0.1:443 -servername <host> 2>/dev/null | openssl x509 -noout -issuer"`
  A new certificate can take a minute or two after the container starts.
- other tunnelled hostnames still respond. A bad ingress edit takes all of them down.

## Pitfalls (details in references/pitfalls.md)

1. Tunnel ingress targets **443, not 80**. Traefik redirects 80, so 80 loops.
2. A **TLS-ALPN or HTTP challenge resolver cannot renew** behind the tunnel. Use DNS-01 (`cloudflare`).
3. Two Traefik **services** on one container make Traefik drop **every** router on it.
4. A single-file bind mount of Traefik dynamic config must be written **in place**.
5. Client IPs need `forwardedHeaders.trustedIPs` in Traefik **and** a forward limit of 2 in the app.
6. Cloudflare free plan: **100 MB** request bodies, **100 s** to first byte.
7. A **remotely managed** tunnel ignores `/etc/cloudflared/config.yml`.
8. Router names must be **unique across all stacks** on the proxy network.

## Audit

Run after any change that touched DNS, and before you call a service safely exposed:

```bash
<skill-dir>/scripts/secret.sh "$REF" | ssh "$BOX" "sudo python3 -I ~/.onebox/audit-exposure.py --domain $DOMAIN --token-stdin"
```

With `box.tunnel: none`, add `--tunnel none`: proxied records to the origin
are how that box works, and the tunnel checks are skipped.

It lists records that point at the origin IP (IPv4 and IPv6), wildcards, private addresses in
public DNS that also have ingress, tunnel CNAMEs that are not proxied, routers on
a resolver other than `cloudflare`, and tunnel unit health. It also requests
each tunnelled hostname whose name looks like an admin tool (`grafana`,
`portainer`, `admin`, `dash`, ...) and flags it when no Cloudflare Access login
answers. `--public-ok <host>` accepts one that is public on purpose. It exits
non-zero on any problem, including a check it could not run.

The name check cannot see an admin tool under a neutral name. Keep your own
list, and check each one: `curl -sI https://<host>/ | grep -i location` must
point at `cloudflareaccess.com`.

## Finish

End with one line: the next step, as one question. "Next: <step>. Continue?".
"Yes" must be enough. Take the step from the app's plan (`/start:plan`). If
something blocks it, name only that one thing, in plain words, and offer the
fix.
