# Adopt a box that already serves apps

`preflight` refuses a box with a Traefik, a tunnel or a port 80/443 it did not
set up. That box works, and people use it. Do not run `base`, `proxy` or
`tunnel` on it. Fix what `check` finds, one thing at a time, in place.

## The order

1. Run `check`. It is read-only.
2. Show the user every FAIL and WARN, with the line from the table below:
   what it stops, and whether it matters for this box type.
3. Fix one item. **Ask before each change.** Show the exact command or diff
   first. Fix the FAILs first.
4. Check the apps still answer, then run `check` again.

Before the first change, write down what answers now. Then compare after
each change:

```bash
ssh "$BOX" 'docker ps --format "{{.Names}}\t{{.Status}}\t{{.Ports}}"' > before.txt
for h in $(ssh "$BOX" "sudo grep -oP '^\s*- hostname:\s*\K\S+' /etc/cloudflared/config.yml"); do
  printf '%s %s\n' "$h" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$h/")"
done > before-hosts.txt
```

Some hostnames are on the LAN or the tailnet only, so run that loop from a
device that can reach them. A dashboard-managed tunnel has no local list.
There, take the names from `box:expose-service`'s `audit-exposure.py`.

**Where a compose file lives decides where you change it.** A file under the
runner's `_work/` folder is checked out again on every deploy, so a change
there is lost. Change it in the app's repo and deploy. A file in a folder you
manage by hand (`/srv/apps/<app>`, `~/<app>`) you change on the box. To find
it:

```bash
docker inspect <container> --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}'
```

## Fixes, line by line

### A database or admin port on all interfaces

`check` lists `0.0.0.0:5432->5432/tcp` and similar. Docker writes its own
iptables rules, so ufw does not cover these ports. At home every device on the
LAN reaches them. On a VPS the whole internet does.

Change the port in the compose file:

```yaml
    ports:
      - "127.0.0.1:5432:5432"    # was "5432:5432"
```

No container on the same compose network needs the port, so remove `ports:`
when only containers use the database. Then recreate only that service:
`docker compose up -d <service>`. That restarts the database for a few
seconds.

A tool on your Mac that used the port goes through SSH from now on:
`ssh -N -L 5432:127.0.0.1:5432 "$BOX"`, then connect to `localhost:5432`.

### The Traefik dashboard open (`--api.insecure=true`)

`check` warns about `api.insecure`. It serves the API and dashboard on port
8080, with no login. The API lists every router, LAN-only and tailnet-only
hostnames too. Any container on the proxy network reaches it, and so does
everyone the 8080 port is published to.

1. Remove `--api.insecure=true` from the Traefik command.
   If Traefik reads a static file (`traefik.yml`) instead of flags, remove
   `insecure: true` under `api:` there, and make the same changes below in
   that file.
2. To keep the dashboard, add `--api=true`, `--api.dashboard=true` and
   `--entrypoints.traefik.address=:8081`, and publish only
   `"127.0.0.1:8081:8081"`. Remove the old `8080` port.
3. Copy `dynamic/api.yml` from the `proxy` phase in `scripts/box-setup.sh`
   into the folder Traefik's file provider reads. Replace `$gw` with the proxy
   network's gateway:
   `docker network inspect <network> -f '{{range .IPAM.Config}}{{.Gateway}}{{end}}'`.
   Without a file provider, add one:
   `--providers.file.directory=/etc/traefik/dynamic` and mount the folder
   read-only.
4. `docker compose up -d traefik`, then `curl -s 127.0.0.1:8081/ping` on the
   box. Open the dashboard from the Mac:
   `ssh -N -L 8081:127.0.0.1:8081 "$BOX"`, then `http://localhost:8081/dashboard/`.

Traefik restarts, so every site is down for a few seconds. Do it at a quiet
time.

### Traefik not pinned (`traefik:latest`)

`check` warns that the image has no version. Any `pull` or new box then gets a
different Traefik, maybe a new major one. Pin the version that runs now, so
nothing changes today:

```bash
ssh "$BOX" 'docker exec <traefik container> traefik version' | awk '/^Version/{print $2}'
```

Set `image: traefik:v<that version>` in the compose file. Then
`docker compose up -d traefik` keeps the same image. Later updates:
`references/updates.md`.

### ufw not active

The tunnel dials out, so it needs no inbound rule. Docker-published ports skip
ufw, so turning it on does not cut off a container. It closes what runs on
the host itself: sshd, Samba, a database installed with apt, and others.

1. List what listens on the host, outside Docker:
   ```bash
   ssh "$BOX" "sudo ss -ltnup | grep -v docker-proxy"
   ```
   Ask the user which of these the LAN or the tailnet uses.
2. Turn ufw on with an undo timer. If you lock yourself out, it turns itself
   off after 5 minutes. Replace `192.168.1.0/24` with the LAN.
   ```bash
   ssh "$BOX" 'sudo ufw default deny incoming && sudo ufw default allow outgoing \
     && sudo ufw allow from 192.168.1.0/24 to any port 22 proto tcp \
     && (ip link show tailscale0 >/dev/null 2>&1 && sudo ufw allow in on tailscale0 || true) \
     && sudo systemd-run --unit=ufw-undo --on-active=5min /usr/sbin/ufw disable \
     && sudo ufw --force enable'
   ```
   Add one `ufw allow from <LAN> to any port <port>` for each host service from
   step 1. On a VPS, allow SSH as `base` does (`ufw allow 22/tcp`, or only on
   `tailscale0`).
3. Open a **new** SSH session. If it works, stop the timer:
   `ssh "$BOX" 'sudo systemctl stop ufw-undo.timer'`.
4. Check the LAN services from step 1 from another device.

### Other lines

| `check` says | Fix on a box set up by hand |
|---|---|
| SSH password login is ON, root login allowed | `ssh-lockdown --user <you> --confirmed-key-login`. It does not touch Traefik or the tunnel, so `preflight` does not stop it. Test the key login in a new session first. |
| unattended-upgrades not configured | `sudo apt-get install -y unattended-upgrades`, then write `/etc/apt/apt.conf.d/20auto-upgrades` as `base` does, and `sudo systemctl enable --now unattended-upgrades`. |
| updates waiting, traefik older than the pin | `references/updates.md`. Restart the tunnel units one at a time. |
| docker socket mounted in a service | Remove the mount, unless it is a backup or update tool that is not on the proxy network. |
| `cert.pem` left in `~/.cloudflared` | Delete it. The running tunnel does not need it. |
| one tunnel replica only | Fine to keep. A restart drops traffic for a few seconds. A second unit needs its own `--metrics` port (`box:expose-service`, `references/topology.md`). |
| network `proxy` missing | Your Traefik uses another network. Set `box.proxyNetwork` to its name: `docker inspect <traefik container> -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}'`. |

## Backups

`check` warns when the onebox timer is off and names your own backup timers.
It does not know what they cover. Two ways on:

- **Keep your own.** For each app, check that it dumps the database with
  `pg_dump` or `pg_dumpall` (a copied data folder is not consistent), that the
  copy leaves the box, and that you restored it once (`references/restore.md`).
  Add each new app's database to it on the day the app goes live.
- **Move to `onebox-backup`.** The `backup` phase does not run `preflight`, so
  it works on this box. It dumps every running Postgres container. Set
  `BACKUP_PATHS` in `/etc/onebox/backup.env` to the folders that hold your
  compose files and uploads. Run both for a week, restore once from the new
  one, then turn off your own timer.

## The other box skills

`box:expose-service` finds a Traefik and a tunnel set up by hand
(`references/topology.md`, "A box set up by hand may differ"). Set these in
the onebox config first, so the skills use your names:

| Key | Value on this box |
|---|---|
| `box.proxyNetwork` | the network Traefik routes on (table above) |
| `box.appsDir` | where your hand-made compose projects live. Apps deployed by the runner live in its `_work/` folder instead. |
| `box.tunnelName` | `awk '/^tunnel:/{print $2}' /etc/cloudflared/config.yml` gives the ID. `cloudflared tunnel list` gives the name. |

Router names: every stack shares one Traefik. Prefix each router with the app
name, or a new app can take over an old route (`box:expose-service`,
`references/pitfalls.md`).
