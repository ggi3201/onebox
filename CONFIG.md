# Config contract

Every onebox skill reads the same config. Nothing personal lives inside a
skill: no hostnames, IPs, domains, app names, team IDs or usernames. If a skill
needs one of those, it reads it from here. If the value is missing, the skill
asks the user once and offers to write it to the config.

## Where it lives

1. `~/.config/onebox/config.json` — per machine. Your box, your Apple account,
   your secrets tool.
2. `.onebox.json` in the project root — per app. Overrides keys from (1).

Read (1), then merge (2) on top. Both are optional. Neither is committed to a
public repo; add `.onebox.json` to `.gitignore` if it holds anything private.

## Secrets

The config never holds a secret value. It holds a **reference**:

| `secrets.tool` | A reference looks like | How a skill reads it |
|---|---|---|
| `env` (default) | `"KIE_AI_API_KEY"` | `$KIE_AI_API_KEY`, else the nearest `.env` walking up from the cwd |
| `doppler` | `"KIE_AI_API_KEY"` | `doppler secrets get KIE_AI_API_KEY --plain -p <secrets.doppler.project> -c <secrets.doppler.config>` |
| `1password` | `"op://vault/item/field"` | `op read "op://vault/item/field"` |

Skills put a secret in a variable or pipe it. They never print it, never write
it to a file other than the one the user asked for, and never put it in a URL.

## Keys

```jsonc
{
  "secrets": {
    "tool": "env",                        // env | doppler | 1password
    "doppler": { "project": "", "config": "" }
  },

  "apple": {
    "teamId": "",                          // 10-char Apple team ID
    "ascKeyId": "",                        // App Store Connect API key ID
    "ascIssuerId": "",                     // App Store Connect issuer ID
    "ascKeyRef": "ASC_PRIVATE_KEY"          // secret reference to the .p8 contents, or a path under "ascKeyPath"
  },

  "expo": {
    "tokenRef": "EXPO_TOKEN",               // secret reference
    "buildMode": "local"                   // local (on this Mac, free) | cloud (EAS servers)
  },

  "revenuecat": {
    "apiKeyRef": "REVENUECAT_API_KEY"       // secret reference (v2 secret key)
  },

  "box": {
    "type": "home",                        // home (mini PC on your LAN) | vps
    "ssh": "user@host",                    // how to reach it
    "domain": "example.com",               // the domain you own, on Cloudflare
    "appsDir": "/srv/apps",                // where each app's compose project lives
    "proxy": "traefik",                    // traefik is the only supported proxy
    "proxyNetwork": "proxy",               // docker network Traefik watches
    "tunnel": "cloudflare",                // cloudflare | none (vps with open 80/443)
    "tunnelName": "onebox",
    "cloudflareTokenRef": "CLOUDFLARE_API_TOKEN",
    "acmeEmail": "",                      // for Traefik's certificates, if not tunnel-only
    "runnerLabel": "box"                   // GitHub Actions self-hosted runner label
  },

  "images": {
    "provider": "kie",                      // deprecated: use media.imageProvider — still read as a fallback
    "keyRef": "KIE_AI_API_KEY"               // deprecated: use media.providers.kie.keyRef — still read as a fallback
  },

  "media": {
    "imageProvider": "kie",                 // kie | fal | replicate — which provider content:image uses by default
    "videoProvider": "kie",                 // kie | fal | replicate — which provider content:video uses by default
    "providers": {
      "kie": { "keyRef": "KIE_AI_API_KEY" },
      "fal": { "keyRef": "FAL_KEY" },
      "replicate": { "keyRef": "REPLICATE_API_TOKEN" }
    }
  }
}
```

`media.imageProvider`/`media.videoProvider` pick the provider; `--provider` on
either skill's script overrides it for one call. `media.providers.<name>.keyRef`
is a secret reference, resolved the same way as any other (see **Secrets**
above) — it is never itself a secret value.

The old `images.provider` and `images.keyRef` keys still work: if `media` is
absent, `content:image` falls back to them for the kie.ai case, so an existing
config with just `images` keeps working unchanged. `content:video` only reads
`media` (it postdates the old keys) and defaults to `kie` /
`media.providers.kie.keyRef` / `KIE_AI_API_KEY` if `media` is absent entirely.

## Rule for skill authors

A personal value inside a skill is a bug. Examples in a skill use
`example.com`, `myapp`, `com.example.myapp`, `user@host`.
