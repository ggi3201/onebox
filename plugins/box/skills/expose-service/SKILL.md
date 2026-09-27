---
name: expose-service
description: "Make a service on the box reachable at a hostname under your domain, or change how an existing one is reached - Traefik labels, Cloudflare Tunnel ingress and the DNS record, done in the safe order with a before/after check. Also audits which hostnames leak the origin IP. Use when the user says 'give it a URL', 'make this public', 'expose', 'publish', 'put it on a subdomain', 'add a DNS record', 'point the domain at', 'A record', 'CNAME', 'cloudflare tunnel', 'cloudflared', 'certresolver', 'traefik router', 'host this', or 'make it LAN-only'. Also use when a task only needs a URL on the side - a new site, an API for an app, a webhook - because the DNS step is where the mistake gets made."
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
yet: follow `guides/cloudflare.md`. No box yet: run `box:box-setup`.

## Decide first

| Where it should live | Record | When |
|---|---|---|
| Cloudflare tunnel | proxied CNAME -> `<tunnel-id>.cfargotunnel.com` | Anything the internet should reach. **The default.** |
| LAN only (home box) | A -> the box's LAN IP, unproxied, no ingress | Reachable from the house only. |
| Tailnet only | A -> the box's Tailscale IP, unproxied, no ingress | Dashboards and tools that follow you off the LAN. |
| Another host (Vercel, Cloudflare Pages, ...) | what that host says | Sites deployed there. Attach the domain in that host's project too, or it serves no certificate. |

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

   ```bash
   scp scripts/expose.py scripts/audit-exposure.py "$BOX":/tmp/
   scripts/secret.sh "$REF" | ssh "$BOX" "sudo python3 /tmp/expose.py <host> --domain $DOMAIN --token-stdin --dry-run"
   scripts/secret.sh "$REF" | ssh "$BOX" "sudo python3 /tmp/expose.py <host> --domain $DOMAIN --token-stdin"
   ```

   It records a baseline, backs up the tunnel config, inserts the entry before
   the catch-all, validates (and restores on failure), probes every other
   tunnelled hostname, restarts the cloudflared replicas one by one, probes
   again, then writes the proxied CNAME. `--ingress-only` / `--dns-only` split it.
   `--mode private --ip <addr>` writes a LAN or tailnet record instead.
5. **Verify** as below. Then commit the label changes.

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
scripts/secret.sh "$REF" | ssh "$BOX" "sudo python3 /tmp/audit-exposure.py --domain $DOMAIN --token-stdin"
```

It lists records that point at the origin IP, wildcards, private addresses in
public DNS that also have ingress, tunnel CNAMEs that are not proxied, routers on
a resolver other than `cloudflare`, and tunnel unit health. It exits non-zero on
any problem, including a check it could not run.
