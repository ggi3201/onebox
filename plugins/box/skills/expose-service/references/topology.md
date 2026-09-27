# Topology

What `box:box-setup` builds, and how to read the live state. **Derive the
hostname map from the live config every time.** A written map goes stale: one
that was wrong for a week after a few hosts moved to the tailnet cost an
afternoon of debugging 403s.

## Request path

```
client -> Cloudflare edge (proxied CNAME, WAF, edge certificate)
       -> tunnel (outbound connection from cloudflared on the box)
       -> https://localhost:443 on the box, SNI = hostname
       -> Traefik (router by Host(), certresolver=cloudflare)
       -> container on the proxy network, internal port, no published port
```

## Paths (box-setup defaults)

| What | Where |
|---|---|
| Tunnel ingress | `/etc/cloudflared/config.yml` (root) |
| Tunnel credentials | `/etc/cloudflared/<tunnel-id>.json` (root, 600) |
| Tunnel units | `cloudflared.service` (metrics 127.0.0.1:20241), `cloudflared-replica.service` (127.0.0.1:20243) |
| Traefik stack | `<box.appsDir>/traefik/docker-compose.yml` |
| Traefik dynamic config | `<box.appsDir>/traefik/dynamic/*.yml` (directory mount) |
| Traefik API | `http://127.0.0.1:8081/api/http/routers` (box only) |
| Traefik DNS token | `<box.appsDir>/traefik/.env` as `CF_DNS_API_TOKEN` (root, 600) |

A box set up by hand may differ. Look before you assume:

```bash
systemctl list-units 'cloudflared*' --no-legend
systemctl show -p ExecStart --value cloudflared | sed 's/--token [^ ]*/--token <hidden>/'
docker ps --filter name=traefik --format '{{.Names}} {{.Image}} {{.Ports}}'
docker inspect traefik --format '{{range .Args}}{{println .}}{{end}}' | grep -E 'entrypoints|certificatesresolvers|providers'
```

## Tunnel

Every public hostname is a **proxied** CNAME to `<tunnel-id>.cfargotunnel.com`
**and** an ingress entry. Both halves are needed. DNS without ingress hits the
404 catch-all. Ingress without DNS is unreachable.

The two units are **replicas of one tunnel**. Cloudflare balances across them,
so restarting them a few seconds apart reloads the ingress with no downtime.
A new replica needs its own `--metrics` port.

Tunnel ID: `awk '/^tunnel:/{print $2}' /etc/cloudflared/config.yml`, or
`cloudflared tunnel list` with the login certificate.

### Local or remote management

| | Locally managed (box-setup) | Remotely managed (dashboard) |
|---|---|---|
| Ingress lives in | `/etc/cloudflared/config.yml` | Cloudflare; the local file is ignored |
| Unit runs | `tunnel run` with `--config` | `tunnel run --token ...`, or shows `Updated to new configuration` in the journal |
| Change it with | edit + validate + rolling restart | API `PUT .../cfd_tunnel/<id>/configurations`, no restart |

## Traefik

Entrypoints `web` (:80) and `websecure` (:443). `web` redirects to `websecure`
for every host, which is why ingress targets 443.

Resolvers:

| Resolver | Challenge | Works behind the tunnel |
|---|---|---|
| `cloudflare` | DNS-01 | yes. **Always use this.** |
| any `tlschallenge` or `httpchallenge` resolver | TLS-ALPN-01 / HTTP-01 | no, and it fails silently at renewal |

Label shape for a tunnelled service (`proxy` = your `box.proxyNetwork`):

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.docker.network=proxy"
  - "traefik.http.routers.NAME.rule=Host(`HOST`)"
  - "traefik.http.routers.NAME.service=NAME"
  - "traefik.http.routers.NAME.entrypoints=websecure"
  - "traefik.http.routers.NAME.tls.certresolver=cloudflare"
  - "traefik.http.services.NAME.loadbalancer.server.port=PORT"
networks:
  - proxy
```

## Live hostname map

```bash
# ingress (local mode)
sudo grep -E '^\s*- hostname:' /etc/cloudflared/config.yml
# routers Traefik has loaded
curl -s 127.0.0.1:8081/api/http/routers | jq -r '.[] | "\(.name)\t\(.rule)\t\(.tls.certResolver // "-")"'
# everything in DNS: run audit-exposure.py
```

A hostname may go **direct** to a host port instead of through Traefik (an
ingress `service: http://localhost:3002`, for example a webhook receiver). That
works, but no Traefik middleware applies to it. Mark such entries with a comment
in the config.

## Zone facts

- Zone ID and account ID come from the API: `GET /zones?name=<domain>`. Do not
  hard-code them.
- Keep **no `*` wildcard** record. A wildcard to the tunnel answers for every
  invented subdomain, so scanners get a live answer for names that never existed.
- The free edge certificate covers `example.com` and `*.example.com`. A name two
  levels deep (`a.b.example.com`) fails TLS at the edge.

## Rate limit middleware

A Traefik middleware is a cheap first layer for a route whose code
you do not control, such as a self-hosted tool or a form on a site. Behind the
tunnel every request comes from the Docker gateway, so count by the header
Cloudflare sets, not by the remote address:

```yaml
- "traefik.http.middlewares.myapp-rl.ratelimit.average=10"       # requests per period, per client
- "traefik.http.middlewares.myapp-rl.ratelimit.period=1s"
- "traefik.http.middlewares.myapp-rl.ratelimit.burst=50"
- "traefik.http.middlewares.myapp-rl.ratelimit.sourcecriterion.requestheadername=Cf-Connecting-Ip"
- "traefik.http.routers.myapp.middlewares=myapp-rl,secure-headers@file"
```

Traefik answers `429` above the limit. Without `sourcecriterion`, the limit is
shared by all users. Check it: a loop of 100 quick `curl` calls gets some 429s,
and a normal page load does not.
