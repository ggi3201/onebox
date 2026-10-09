---
name: box-setup
description: Take a fresh Ubuntu VPS or a fresh mini PC to the baseline the other box skills expect - admin user with SSH keys, password login off, ufw, automatic security updates, Docker, Traefik on the proxy network, a Cloudflare tunnel, nightly backups and a health check. Idempotent, with a dry run, and it refuses to set up a box that already runs Traefik; that box gets fixed in place instead (adopt). Use when the user says "set up my server", "set up the VPS", "I just bought a Hetzner box", "prepare the mini PC", "install Docker and Traefik", "harden the server", "set up backups on the box", "I already have a server with Traefik", or asks "is my box healthy" or "check the server".
---

# Set up the box

Runs on: your Mac, driving your box over SSH. The script runs on the box as root.

One cheap box runs everything: a mini PC at home or a small x86 VPS. Same
stack on both. No Kubernetes, no second server, no managed database.

## Config it reads

```bash
cfg() { jq -s '.[0] * .[1]' ~/.config/onebox/config.json .onebox.json 2>/dev/null \
  || cat ~/.config/onebox/config.json 2>/dev/null || echo '{}'; }
cfg | jq '.box'
```

Needs `box.type`, `box.ssh`, `box.domain`, `box.appsDir`, `box.proxyNetwork`,
`box.tunnel`, `box.tunnelName`, `box.cloudflareTokenRef`. Optional:
`box.acmeEmail`, `box.runnerLabel` (default `box`). Ask once for any required
key that is missing, then offer to write it to `~/.config/onebox/config.json`.

The script reads the `box.*` keys from a copy of the merged config (`--config`).
A flag on the command line wins over the config. The config holds references,
never secret values, so the copy is safe.

Before you start, the user needs:

- a Cloudflare account with the domain on it, and a DNS token: `https://onebox.lokkesveen.com/guides/cloudflare.md`
- for a VPS: the server, created with their SSH key: `https://onebox.lokkesveen.com/guides/vps.md`
- for a mini PC: Ubuntu Server installed and `ssh-copy-id user@host` done

## Refuse first, then build

**Never run this against a box that already serves things.** Run `preflight`
first. It changes nothing. If it reports an existing Traefik, a cloudflared
config it did not write, or something on port 80/443, it exits with code 3.
Show the user what it found and stop. Pass `--allow-existing` only after the
user says yes in chat. `check` is read-only and fine on any box.

That box needs no new setup. Fix it in place: `references/adopt.md`. It runs
`check`, then fixes each FAIL and WARN one at a time, with the user's yes,
without breaking what runs.

## Procedure

Copy the two scripts and the merged config over, then run one phase at a time.
Read each output before the next phase. Every phase takes `--dry-run`.

```bash
BOX=root@203.0.113.10            # a VPS starts with root; a mini PC uses its install user + sudo
cfg > /tmp/onebox.json
scp scripts/box-setup.sh scripts/onebox-backup.sh /tmp/onebox.json "$BOX":/root/
FLAGS="--config /root/onebox.json --user alice"
ssh "$BOX" "bash /root/box-setup.sh preflight $FLAGS"
ssh "$BOX" "bash /root/box-setup.sh base $FLAGS --dry-run"
ssh "$BOX" "bash /root/box-setup.sh base $FLAGS"
```

1. **`base`** - packages, admin user, your key, ufw, unattended-upgrades,
   2 GB swap on a VPS. **The admin user gets passwordless sudo by default.**
   Agents run sudo over SSH and cannot answer a password prompt. The protection
   is key-only SSH. Tell the user this. `--sudo-password` opts out: the user then
   sets a password with `sudo passwd alice` and runs the sudo steps themselves.
   `--sudo-password` and `--ssh-tailscale-only` stay chosen: a later `base`
   without them keeps them, and `check` fails if they come undone.
2. **Test the key login in a new session** before anything else:
   `ssh alice@<box> 'sudo -n true && echo ok'`. Only then run
   **`ssh-lockdown --confirmed-key-login`**. From here on use `alice@<box>` and
   `sudo`, and set `box.ssh` to it.
3. **`docker`** - Docker's apt repo, compose plugin, log rotation.
4. **`proxy`** - the `box.proxyNetwork` network and Traefik in
   `<appsDir>/traefik`. It needs the Cloudflare token once, on stdin (see below).
5. **`tunnel`** - cloudflared, a locally managed tunnel named `box.tunnelName`,
   and two replica units. The first run stops with exit 4 and asks for
   `cloudflared tunnel login` on the box. That prints a URL. The user opens it
   on the Mac and picks the domain. Then run the phase again. Once the tunnel
   exists, the phase deletes the login's `cert.pem`.
6. **`backup`** - the nightly timer. Then set the off-box target (below).
7. **`check`** - must end with `0 fail`. Fix every FAIL before you call the box ready.
8. For deploys, register a GitHub Actions runner: `references/runner.md`.

Passing the token without printing it:

```bash
REF=$(cfg | jq -r '.box.cloudflareTokenRef // "CLOUDFLARE_API_TOKEN"')
../expose-service/scripts/secret.sh "$REF" \
  | ssh "$BOX" "sudo bash /root/box-setup.sh proxy $FLAGS --token-stdin"
```

## Choices, and why

- **SSH on a VPS.** Default: port 22 open, keys only. Simple, and fine with
  password login off. Stricter: install Tailscale first (see
  `https://onebox.lokkesveen.com/guides/remote-access.md`), then
  `--ssh-tailscale-only` closes 22 to the internet. Keep the provider's web
  console as the way back in. A home box sits behind the router, so 22 is
  LAN-only anyway.
- **No 80/443 open.** The tunnel dials out, so nothing needs to reach the box.
  On a VPS Traefik binds 80/443 to `127.0.0.1` only. **Docker-published ports
  skip ufw**, so a `0.0.0.0` bind would be public whatever ufw says. At home
  Traefik binds `0.0.0.0` so LAN-only hostnames work.
- **`box.tunnel: none`** (VPS only) publishes 80/443. Then limit them to
  Cloudflare's IP ranges in the provider's firewall. Prefer the tunnel.
- **Locally managed tunnel.** The ingress lives in `/etc/cloudflared/config.yml`,
  so a skill can back it up, validate it and diff it. `box:expose-service` also
  handles a dashboard-managed tunnel.
- **Backups: `pg_dumpall` + restic.** Dumps are consistent; a copied data
  directory is not. restic encrypts and deduplicates and can write to SFTP or any
  S3-compatible bucket. Dumps alone on the same disk are not a backup.

## Off-box backups

Edit `/etc/onebox/backup.env` on the box: set `RESTIC_REPOSITORY` (for example
`sftp:user@backup-host:/onebox` or an S3-compatible bucket). Put a long random
password in `/etc/onebox/restic-password` (mode 600) and **store the same
password off the box**. Without it the backup cannot be read. Then:

```bash
ssh "$BOX" 'sudo onebox-backup --init && sudo onebox-backup && sudo onebox-backup --list'
```

A backup you never restored is a guess. Do one test restore: `references/restore.md`.

## What `check` must show

`check` is read-only. Run it after setup and after any change to the box. Each
line is a real protection, not a formality:

| Line | What it stops | If it fails |
|---|---|---|
| SSH password login off | password guessing on port 22 | run `ssh-lockdown`; read `sshd -T` for a cloud-init file that turns it back on |
| SSH root login off | a stolen key reaching root directly | run `ssh-lockdown --confirmed-key-login` |
| ufw active | host services (sshd, anything you install) open to the internet | run `base` again |
| unattended-upgrades on | known holes in the OS staying open for months | run `base` again; reboot when it says a reboot is pending |
| no "updates waiting" warning | Docker, runc and cloudflared holes. Automatic updates skip them. | `references/updates.md` |
| SSH on tailscale0 only, sudo needs a password | a stricter choice quietly undone (shown only if you chose it) | run `base` again: it keeps the choice |
| no container port on all interfaces | a database or admin UI on the public IP. **Docker-published ports skip ufw**, so ufw's "deny" does not cover them. | remove `ports:`, or bind to `127.0.0.1:`. If a port really must be public, limit it in the provider's firewall. |
| docker socket only in traefik | a public container with the socket is root on the box. `:ro` does not help: it limits the file, not the API. | remove the socket mount from that service. Tools that need it (backups, updaters) stay off the proxy network. |

On a box set up by hand, the fixes differ: `references/adopt.md`. It also
covers two warnings only such a box shows: Traefik with `api.insecure`, and a
Traefik image with no version (`traefik:latest`).

At home, a `0.0.0.0` port is a warning: the router blocks it from the
internet, but every device on the LAN can reach it. On a VPS with a tunnel it
is a failure.

## Pitfalls

- A `0.0.0.0:` port in `docker ps` on a VPS is public, even with ufw on. `check` fails on it.
- sshd uses the first value it reads. A cloud image's `50-cloud-init.conf` can turn
  password login back on. The script writes `00-onebox.conf` and prints `sshd -T`.
- Restart the two cloudflared units a few seconds apart, never together.
- If Traefik logs `client version ... is too old`, the Traefik image is older
  than the Docker Engine allows. Bump it (below).
- `cloudflared tunnel login` leaves `cert.pem` in the user's `~/.cloudflared`.
  It can create and delete every tunnel in the account. The running tunnel
  does not need it. The tunnel phase deletes it; `check` warns if one is left.
- The Traefik API on `127.0.0.1:8081` lists every router, LAN-only and
  tailnet-only hostnames too. Only the box itself may read it. Other
  containers on the proxy network get 403 (`dynamic/api.yml`).

## Updates

Traefik is pinned, and Docker, containerd (runc) and cloudflared are not in
automatic updates. `check` warns about both. How to update them:
`references/updates.md`.

## Finish

End with one line: the next step, as one question. "Next: <step>. Continue?".
"Yes" must be enough. Take the step from the app's plan (`/start:plan`). If
something blocks it, name only that one thing, in plain words, and offer the
fix.

## References

- `references/adopt.md` - a box that already serves apps: fix it in place
- `references/runner.md` - self-hosted GitHub Actions runner, and its risks
- `references/updates.md` - update Traefik, Docker and cloudflared
- `references/restore.md` - restore a dump, restore from restic
- `box:expose-service` - put a service on a hostname after this
