# Pitfalls

Each of these has caused an outage or a silent time bomb on a real box. They
are ordered by how expensive the mistake is, not by how likely.

- [1. Ingress must target 443](#1-ingress-must-target-443-not-80)
- [2. A TLS-ALPN resolver cannot renew behind the tunnel](#2-a-tls-alpn-resolver-cannot-renew-behind-the-tunnel)
- [3. A second Traefik service drops every router](#3-a-second-traefik-service-drops-every-router)
- [4. Single-file dynamic config must be written in place](#4-single-file-dynamic-config-must-be-written-in-place)
- [5. Client IPs are lost twice over](#5-client-ips-are-lost-twice-over)
- [6. Cloudflare free-plan limits](#6-cloudflare-free-plan-limits)
- [7. A remotely managed tunnel ignores the local file](#7-a-remotely-managed-tunnel-ignores-the-local-file)
- [8. Router names collide across stacks](#8-router-names-collide-across-stacks)
- [9. Runner working copies are disposable](#9-runner-working-copies-are-disposable)
- [10. Verifying from the wrong place](#10-verifying-from-the-wrong-place)
- [11. Docker-published ports skip the firewall](#11-docker-published-ports-skip-the-firewall)

## 1. Ingress must target 443, not 80

Traefik redirects `web` to `websecure` for every host. Point the tunnel at
`http://localhost:80` and the redirect goes back out to Cloudflare, which sends
it in again. The result is a redirect loop, not an error.

```yaml
- hostname: HOST
  service: https://localhost:443
  originRequest:
    noTLSVerify: true          # Traefik's cert is for the hostname, not localhost
    originServerName: HOST     # so SNI still selects the right router
```

## 2. A TLS-ALPN resolver cannot renew behind the tunnel

A resolver that uses TLS-ALPN-01 (`tlschallenge`) needs Let's Encrypt to open
port 443 on the origin and negotiate ALPN. Behind the tunnel that connection
ends at Cloudflare, which does not pass ALPN through. The HTTP-01 challenge
fails the same way when port 80 is closed.

**Nothing breaks on the day.** A certificate issued earlier (for example before
the move to the tunnel) stays valid for weeks. Renewal starts about 30 days
before expiry, fails quietly, and the certificate expires with no warning. Use
the DNS-01 resolver (`cloudflare` in box-setup). It needs no inbound port.

Audit: `audit-exposure.py` lists every router on another resolver.

## 3. A second Traefik service drops every router

If a container defines more than one `traefik.http.services.*`, Traefik does not
guess which service a router belongs to. It **discards every router on that
container**. Symptom: the old hostname and the new one both stop working. The
Traefik API shows both *services* and neither *router*.

Two hostnames on one container are one service and two routers:

```yaml
- "traefik.http.routers.first.rule=Host(`a.example.com`)"
- "traefik.http.routers.first.service=api"     # both name it
- "traefik.http.routers.second.rule=Host(`b.example.com`)"
- "traefik.http.routers.second.service=api"
- "traefik.http.services.api.loadbalancer.server.port=8080"   # defined once
```

## 4. Single-file dynamic config must be written in place

box-setup mounts a **directory** for the file provider, so this does not apply
to it. It applies to any Traefik that mounts one file (`./dynamic.yml:/...`).

A single-file bind mount holds the **inode**. Anything that writes a temporary
file and renames it (`sed -i`, most editors, atomic-write helpers) leaves the
container watching the old inode. The edit is on disk and has no effect.

```python
with open(path, "r+") as f:      # same inode
    f.write(new); f.truncate()
```

Confirm with `stat -c %i` before and after, then look for the change in
`http://127.0.0.1:8081/api/http/routers`. Traefik hot-reloads the file provider
once it really sees the write.

## 5. Client IPs are lost twice over

Two separate failures. Fixing only one changes nothing.

**At Traefik.** cloudflared runs on the host, so every request reaches Traefik
from the Docker gateway. If that hop is not trusted, Traefik throws away the
`X-Forwarded-For` that Cloudflare filled in and writes the gateway instead:

```
Cf-Connecting-Ip: <real client>     <- survives
X-Forwarded-For:  172.18.0.1        <- overwritten
```

Fix: `--entrypoints.websecure.forwardedHeaders.trustedIPs=<gateway>/32,127.0.0.1/32,::1/128`
(box-setup sets it). Then the header reads `<client>, <gateway>`. A client can
send its own `X-Forwarded-For`; Cloudflare appends to it rather than replacing
it. So only the two right-most entries are Cloudflare's and Traefik's, and the
app must read no further than that.

**In the app.** That added hop means a forward limit of 1 reads the gateway, the
same value for every request. The app needs a limit of 2 to reach the address
Cloudflare wrote, and both hops must be in its trusted-proxy list (the proxy
network's subnet covers them). In ASP.NET Core that is `ForwardLimit = 2`; other
frameworks call it "trusted hops" or "proxy count". Code for ASP.NET Core and
Node: `https://onebox.lokkesveen.com/guides/backend.md`, "Protect the API".

Why it matters: any rate limiter keyed on the remote IP becomes global. A
per-IP sign-in limit of 10 per minute becomes 10 per minute for all users. Anyone
can trigger that outage with ten requests, and no test catches it, because "per
IP" and "global" look the same when there is only one IP.

While ports 80/443 are still open to the internet, a request sent straight to
the origin can bring its own `X-Forwarded-For`. That closes when the tunnel is
the only way in.

## 6. Cloudflare free-plan limits

| Limit | Value | Failure |
|---|---|---|
| Request body | 100 MB | `413` at the edge. The origin never sees it and logs nothing. |
| Time to first byte | 100 s | `524` |

The body limit bites uploads. Check every upload endpoint's limit before you
tunnel the service. A cap set just under 100 MiB is already over the line
(100 MiB is more than 100 MB).

## 7. A remotely managed tunnel ignores the local file

A tunnel created in the dashboard, or converted to dashboard management, fetches
its ingress from Cloudflare. cloudflared may still run with
`--config /etc/cloudflared/config.yml`, and ignore the ingress in it. Editing
only the local file changes nothing.

Tell which one you have:

```bash
systemctl show -p ExecStart --value cloudflared | grep -c -- --token    # 1 = remote (do not print the line)
journalctl -u cloudflared -b | grep 'Updated to new configuration'      # present = remote
```

For a remote tunnel, edit the ingress with the API
(`PUT /accounts/<account>/cfd_tunnel/<id>/configurations`) or in the dashboard.
`expose.py` detects this and uses the API. The token then also needs the
Cloudflare Tunnel edit permission. A scoped token often cannot list accounts;
read the account ID from the zone: `GET /zones?name=<domain>` ->
`.result[0].account.id`.

## 8. Router names collide across stacks

All stacks share one Traefik on one proxy network. A router or service name
reused in a second compose project silently takes over the first one's route.
Prefix every name with the app: `myapp-api`, `myapp-api-stg`.

## 9. Runner working copies are disposable

Compose files under the runner's `_work/` folder are checked out again on every
deploy. Editing one fixes the running container until the next deploy undoes
it. Commit to the repo instead.

Recreating such a container by hand also needs its secrets and, sometimes, a
build order the workflow knows. Prefer to let the deploy do it.

## 10. Verifying from the wrong place

Two traps that give confident wrong answers:

- **A status code is not a baseline.** The tunnel catch-all returns 404, and so
  does a healthy API with no root route. Capture status *and* body size or
  content type before the change.
- **A second vantage point may not be one.** Another machine on the same network
  leaves through the same public IP. Using it to test per-IP behaviour compares
  an address with itself. To prove per-caller limits, send controlled
  `X-Forwarded-For` values to the origin directly.

## 11. Docker-published ports skip the firewall

Docker writes its own iptables rules. A container with `ports: - "8080:8080"`
is reachable on every interface, even with ufw set to deny. On a VPS that means
the internet. Publish nothing (Traefik reaches containers over the proxy
network), or bind to `127.0.0.1:`. `box-setup.sh check` fails on a `0.0.0.0` port
on a VPS.
