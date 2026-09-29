# Cloudflare

Runs on: your browser (the Cloudflare dashboard). `box:box-setup` does the
tunnel part on the box.

Used by: `box:box-setup`, `box:expose-service`, `box:new-landing-page`,
`box:staging-env`, and the "Protect the API" part of [backend.md](backend.md).

Cloudflare runs DNS for your domain and sits in front of your box. The
Cloudflare Tunnel (`cloudflared`) dials out from the box to Cloudflare, so no
port on the box or your router has to be open. Set it up in Phase 2, after you
have a domain ([domain.md](domain.md)) and before `box:box-setup`.

## What it costs

The Free plan covers all of this: DNS, proxying, the edge certificate and
Cloudflare Tunnel. You pay only for the domain, at whatever registrar you use.

Free-plan limits that matter here: request bodies up to 100 MB, 100 seconds to
the first byte. The free edge certificate covers `example.com` and
`*.example.com`, one level deep.

## Steps

### 1. Create an account

Sign up at `dash.cloudflare.com`. Turn on two-factor login in your profile.

### 2. Move the domain's DNS to Cloudflare

1. In the dashboard, open **Domains** and choose **Onboard a domain**. Enter the
   apex domain (`example.com`). Pick the Free plan.
2. Check the DNS records Cloudflare copied from your old DNS host. Keep mail
   records (MX, SPF, DKIM, DMARC) exactly as they were. Mail records are never
   proxied.
3. Cloudflare shows two nameservers. Copy them.
4. At your registrar: **turn DNSSEC off first** if it is on. If you skip this,
   the domain can stop resolving. Then replace the nameservers with the two
   from Cloudflare.
5. Wait until the domain shows **Active** on the Domains page. It can take up to
   24 hours; often it is minutes.
6. Turn DNSSEC back on, this time in Cloudflare, and add the DS record it gives
   you at the registrar.

### 3. Create the API token for DNS

The box skills write DNS records, and Traefik proves domain ownership for its
certificates, through one scoped token.

1. Go to **My Profile > API Tokens** (`dash.cloudflare.com/profile/api-tokens`).
2. Create a token from the **Edit zone DNS** template.
3. Permissions: keep DNS Edit. Add Zone Read for the same zone, so skills can
   look up the zone ID by name.
4. Zone resources: include **only** your domain, not all zones.
5. Optional, only if your tunnel is managed in the dashboard (`box:box-setup`
   does not make one): add the Account permission for Cloudflare Tunnel with Edit.
6. Review and create. Copy the token once. Cloudflare will not show it again.

This token cannot list accounts. That is expected. Skills read the account ID
from the zone instead.

### 4. The tunnel

You do not create the tunnel by hand. `box:box-setup` runs
`cloudflared tunnel login` on the box. That prints a URL. Open it on your Mac,
choose your domain and approve. Then `box:box-setup` creates a tunnel named
`box.tunnelName` and keeps its ingress in `/etc/cloudflared/config.yml` on the
box.

### 5. Put admin tools behind Access

Cloudflare Access puts a login in front of a hostname, at Cloudflare's edge.
The request never reaches the tunnel until the person has logged in. Use it
for every admin tool and dashboard that has a public hostname: Traefik's
dashboard, Portainer, Grafana, a database UI, n8n, a staging web site. The
Zero Trust Free plan covers up to 50 users.

1. In the dashboard, open **Zero Trust**. The first time, pick a team name
   (it becomes `<team>.cloudflareaccess.com`) and the Free plan.
2. Check that the one-time PIN login method is on, in the Zero Trust settings
   for authentication. Cloudflare then emails a code to an allowed address. No
   other identity provider is needed.
3. Go to **Access controls > Applications**, choose **Create new application**,
   then **Self-hosted and private**. Add the public hostname, for example
   `grafana.example.com`.
4. Add a policy: action Allow, include the email addresses that may log in.
   Access denies everyone else by default.
5. Save. Scripts that must reach the tool can use an Access service token
   (two headers) instead of a login.

Never put Access in front of the API your app calls. The app cannot log in,
and every request fails.

Check it: open the hostname in a private browser window. You must see the
Cloudflare Access login, not the tool. From the terminal:
`curl -sI https://grafana.example.com/ | grep -i location` points at
`cloudflareaccess.com`. The `box:expose-service` audit runs the same check on
hostnames that look like admin tools.

### 6. Free-plan protection for the API (optional)

The API limits itself ([backend.md](backend.md), "Protect the API"). Cloudflare can
drop the worst traffic before it reaches the box. What the Free plan gives you
(checked 2026-09-28):

- **One rate limiting rule.** It counts by client IP, over 10 seconds, and
  blocks for 10 seconds. It can match on the URL path. Use it for sign-in:
  expression `starts_with(http.request.uri.path, "/api/auth/")`, 20 requests per
  10 seconds, action Block. Keep it generous: many phones on one mobile
  carrier can share one IP. It sits on the page for rate limiting rules in the
  domain's Security section.
- **Five custom (WAF) rules.** One cheap use: block the scanner paths your API
  never serves, so they do not reach the box at all. Expression:
  `starts_with(http.request.uri.path, "/.env") or starts_with(http.request.uri.path, "/.git") or starts_with(http.request.uri.path, "/wp-")`,
  action Block.
- **Bot Fight Mode: leave it off** on a domain that serves your app's API. It
  may challenge API and mobile app traffic. An app cannot solve a challenge,
  so the request fails with an HTML page instead of JSON. On the Free plan it
  covers the whole domain, and WAF rules cannot skip it.

Check it: 25 quick requests to `/api/auth/...` from one machine get a Cloudflare
block page for 10 seconds. `curl -s -o /dev/null -w '%{http_code}\n' https://api.example.com/.env`
returns `403` and nothing shows in the API log.

## Where the values go

| Value | Goes to |
|---|---|
| The domain | `box.domain` in `~/.config/onebox/config.json` |
| Tunnel name | `box.tunnelName` (default `onebox`) |
| The token | your secrets tool, under the name in `box.cloudflareTokenRef` (default `CLOUDFLARE_API_TOKEN`) |

Store the token by `secrets.tool` (see
[CONFIG.md](https://github.com/ggi3201/onebox/blob/main/CONFIG.md)):

- `env`: add `CLOUDFLARE_API_TOKEN=...` to a `.env` that is git-ignored.
- `doppler`: `doppler secrets set CLOUDFLARE_API_TOKEN -p <project> -c <config>`, then paste it when asked.
- `1password`: save it as an item, and set `box.cloudflareTokenRef` to its `op://vault/item/field` reference.

The config holds the reference, never the token. `box:box-setup` also copies the
token to the box once, into `<box.appsDir>/traefik/.env` (root only), because
Traefik needs it to renew certificates.

## Check it works

```bash
# read the token with your secrets tool, e.g. T=$(doppler secrets get CLOUDFLARE_API_TOKEN --plain)
T=$(printenv CLOUDFLARE_API_TOKEN)
curl -s https://api.cloudflare.com/client/v4/user/tokens/verify -H "Authorization: Bearer $T" | jq .result.status
curl -s "https://api.cloudflare.com/client/v4/zones?name=example.com" -H "Authorization: Bearer $T" | jq -r '.result[0].status'
unset T
dig ns example.com @1.1.1.1 +short
```

Expect `active`, `active`, and two `*.ns.cloudflare.com` names.

## Common errors

| Symptom | Cause |
|---|---|
| Zone lookup returns an empty list | The token does not include this zone, or lacks Zone Read. |
| `Authentication error` (code 10000) | Wrong token, or it was revoked. Check with the verify call. |
| Domain stuck at pending | Nameservers not changed yet, or DNSSEC still on at the registrar. |
| Site gives `ERR_SSL_VERSION_OR_CIPHER_MISMATCH` | The hostname is two levels deep (`a.b.example.com`). Use `a-b.example.com`. |
| `413` on upload, nothing in the box's logs | The 100 MB request-body limit at the edge. |
| `524` | The origin took more than 100 s to send the first byte. |
| The app gets `403` with an HTML body; nothing in the API log | Bot Fight Mode or a WAF rule challenged the request. Turn Bot Fight Mode off; check the Security events log. |
| Every Access login loops back to the login page | The email is not in the application's Allow policy, or the one-time PIN login is off. |
| Traefik log: DNS challenge `403` | The token in `<appsDir>/traefik/.env` lacks DNS Edit on this zone. |
