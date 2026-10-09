# Updating Traefik, Docker and cloudflared

## Traefik

The image is pinned (`traefik:v3.7.14`, the latest stable v3 on 2026-10-07), so
an install today matches an install next month. `check` warns when the box
runs an older one. To bump it:

```bash
gh api repos/traefik/traefik/releases/latest --jq .tag_name   # e.g. v3.7.15
```

Read the release notes. For a new minor (v3.7 -> v3.8) also read the migration
guide on doc.traefik.io. Then on the box, edit `image:` in
`<appsDir>/traefik/docker-compose.yml`, and run
`docker compose -p traefik pull && docker compose -p traefik up -d`, then
`box-setup.sh check`. Pass `--traefik-image traefik:vX.Y.Z` on later runs, or
the proxy phase writes the old pin back. Do not edit the installed copy of
`box-setup.sh`: a plugin update replaces it. If the kit's pin is behind, open
an issue on ggi3201/onebox.

## Docker and cloudflared

Automatic updates install Ubuntu's own packages only. Docker, containerd (it
holds runc) and cloudflared come from their makers' repos. A Docker update
restarts every container, so these wait for you. `check` warns when updates
are waiting. At a quiet time:

```bash
ssh "$BOX" 'sudo apt-get update && sudo apt-get install -y --only-upgrade docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin'
ssh "$BOX" 'sudo apt-get install -y --only-upgrade cloudflared && sudo systemctl restart cloudflared && sleep 10 && sudo systemctl restart cloudflared-replica'
```

Restart the two tunnel units apart, as above, never together. Then run
`box-setup.sh check`.
