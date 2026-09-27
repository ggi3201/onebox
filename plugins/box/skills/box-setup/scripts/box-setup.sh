#!/usr/bin/env bash
#
# Bring a fresh Ubuntu box (a small VPS or a mini PC) to the onebox baseline:
# admin user, SSH keys, firewall, automatic security updates, Docker, Traefik
# on a shared proxy network, a Cloudflare tunnel, nightly backups, and a
# health check.
#
# Runs ON the box, as root (or with sudo). Every phase is idempotent: it checks
# the current state first and changes only what differs. Use --dry-run to see
# what a phase would change.
#
# It refuses to touch a box that already runs a Traefik or a cloudflared it did
# not install (a home server set up by hand, for example) unless you pass
# --allow-existing. The `check` phase is read-only and always allowed.
#
# Usage:
#   box-setup.sh <phase> [options]
#
# Phases, in order:
#   preflight     report what is there; change nothing
#   base          packages, admin user, SSH key, ufw, unattended-upgrades, swap (vps)
#   ssh-lockdown  SSH: keys only, no root login. Needs --confirmed-key-login
#   docker        Docker Engine + compose plugin, log rotation
#   proxy         proxy network + Traefik (needs the Cloudflare token once)
#   tunnel        cloudflared + a locally managed tunnel, two replica units
#   backup        nightly Postgres dumps + restic, as a systemd timer
#   check         health check, read-only, exits non-zero on a FAIL
#   all           base, docker, proxy, tunnel, backup, check (not ssh-lockdown)
#
# Options. Defaults come from --config (the onebox config, box.* keys), then
# the built-in value in brackets. A flag always wins over the config.
#   --config FILE           onebox config JSON [~/.config/onebox/config.json if present]
#   --type home|vps         box.type [vps]
#   --user NAME             admin user to create or use [$SUDO_USER, else "admin"]
#   --pubkey-file PATH      public key(s) to authorize [/root/.ssh/authorized_keys]
#   --apps-dir DIR          box.appsDir [/srv/apps]
#   --network NAME          box.proxyNetwork [proxy]
#   --tunnel none|cloudflare box.tunnel [cloudflare]
#   --tunnel-name NAME      box.tunnelName [onebox]
#   --acme-email EMAIL      box.acmeEmail: optional contact for Let's Encrypt
#   --traefik-image IMAGE   pinned Traefik image [traefik:v3.7.13]
#   --sudo-password         admin user needs a password for sudo (no NOPASSWD)
#   --token-stdin           read the Cloudflare API token from stdin (proxy phase)
#   --ssh-tailscale-only    vps: allow SSH only on the tailscale0 interface
#   --auto-reboot           let unattended-upgrades reboot at 04:00 when needed
#   --no-swap               do not create a swap file on a vps
#   --confirmed-key-login   you have logged in as --user with a key in a new session
#   --allow-existing        the user said yes to working on a box with Traefik already
#   --dry-run               print what would change; change nothing
#
# Exit codes: 0 ok, 1 failed, 2 bad usage, 3 refused (existing setup), 4 needs a manual step.

set -euo pipefail

PHASE="${1:-}"; [ -n "$PHASE" ] && shift || true

TYPE=vps
ADMIN="${SUDO_USER:-}"; [ "$ADMIN" = root ] && ADMIN=""; ADMIN="${ADMIN:-admin}"
PUBKEY_FILE=/root/.ssh/authorized_keys
APPS_DIR=/srv/apps
NET=proxy
TUNNEL=cloudflare
TUNNEL_NAME=onebox
ACME_EMAIL=""
TOKEN_STDIN=0
SSH_TS_ONLY=0
AUTO_REBOOT=0
SWAP=1
KEY_LOGIN_OK=0
ALLOW_EXISTING=0
DRY=0
# Pinned. To bump: see "Updating Traefik" in SKILL.md.
TRAEFIK_IMAGE=traefik:v3.7.13
SUDO_PW=0

# Config defaults. python3 is on every Ubuntu install; jq may not be yet.
CONFIG_FILE=""
prev=""; for a in "$@"; do [ "$prev" = --config ] && CONFIG_FILE="$a"; prev="$a"; done
[ -z "$CONFIG_FILE" ] && [ -f "$HOME/.config/onebox/config.json" ] && CONFIG_FILE="$HOME/.config/onebox/config.json"
if [ -n "$CONFIG_FILE" ]; then
  [ -f "$CONFIG_FILE" ] || { echo "config not found: $CONFIG_FILE" >&2; exit 2; }
  command -v python3 >/dev/null || { echo "reading --config needs python3 (apt-get install -y python3)" >&2; exit 2; }
  eval "$(python3 - "$CONFIG_FILE" <<'PY'
import json, shlex, sys
b = (json.load(open(sys.argv[1])) or {}).get("box", {}) or {}
m = {"type": "TYPE", "appsDir": "APPS_DIR", "proxyNetwork": "NET", "tunnel": "TUNNEL",
     "tunnelName": "TUNNEL_NAME", "acmeEmail": "ACME_EMAIL"}
for k, v in m.items():
    if isinstance(b.get(k), str) and b[k]:
        print(f"{v}={shlex.quote(b[k])}")
PY
)" || { echo "could not read $CONFIG_FILE" >&2; exit 2; }
fi

while [ $# -gt 0 ]; do
  case "$1" in
    --type) TYPE="$2"; shift ;;
    --user) ADMIN="$2"; shift ;;
    --pubkey-file) PUBKEY_FILE="$2"; shift ;;
    --apps-dir) APPS_DIR="$2"; shift ;;
    --network) NET="$2"; shift ;;
    --tunnel) TUNNEL="$2"; shift ;;
    --tunnel-name) TUNNEL_NAME="$2"; shift ;;
    --acme-email) ACME_EMAIL="$2"; shift ;;
    --token-stdin) TOKEN_STDIN=1 ;;
    --ssh-tailscale-only) SSH_TS_ONLY=1 ;;
    --auto-reboot) AUTO_REBOOT=1 ;;
    --no-swap) SWAP=0 ;;
    --confirmed-key-login) KEY_LOGIN_OK=1 ;;
    --allow-existing) ALLOW_EXISTING=1 ;;
    --dry-run) DRY=1 ;;
    --config) shift ;;   # read before this loop
    --traefik-image) TRAEFIK_IMAGE="$2"; shift ;;
    --sudo-password) SUDO_PW=1 ;;
    -h|--help) sed -n '2,50p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

case "$TYPE" in home|vps) ;; *) echo "--type must be home or vps" >&2; exit 2 ;; esac
case "$TUNNEL" in cloudflare|none) ;; *) echo "--tunnel must be cloudflare or none" >&2; exit 2 ;; esac

MARK="# managed by onebox box-setup"
TRAEFIK_DIR="$APPS_DIR/traefik"
CF_DIR=/etc/cloudflared
CF_CONF="$CF_DIR/config.yml"
BACKUP_ENV=/etc/onebox/backup.env
HERE="$(cd "$(dirname "$0")" && pwd)"

log()  { printf '\n=== %s\n' "$*"; }
say()  { printf '  %s\n' "$*"; }
die()  { printf '  ERROR: %s\n' "$1" >&2; exit "${2:-1}"; }
run()  { if [ "$DRY" = 1 ]; then say "(dry run) would run: $*"; else "$@"; fi; }
have() { command -v "$1" >/dev/null 2>&1; }

# Write a file only if its content differs. Prints what happened.
put() {  # put PATH MODE OWNER <<< content
  local path="$1" mode="$2" owner="$3" tmp
  tmp="$(mktemp)"; cat > "$tmp"
  if [ -f "$path" ] && cmp -s "$tmp" "$path"; then
    say "unchanged: $path"; rm -f "$tmp"; return 1
  fi
  if [ "$DRY" = 1 ]; then
    say "(dry run) would write $path"; rm -f "$tmp"; return 0
  fi
  install -D -m "$mode" -o "${owner%:*}" -g "${owner#*:}" "$tmp" "$path"
  rm -f "$tmp"; say "wrote: $path"; return 0
}

need_root() { [ "$(id -u)" = 0 ] || die "run as root: sudo bash $0 $PHASE ..." 2; }

# ---------------------------------------------------------------- preflight --

foreign_traefik() {
  have docker || return 1
  docker ps -a --format '{{.ID}} {{.Image}} {{.Names}}' 2>/dev/null | grep -i traefik \
    | while read -r id _; do
        [ "$(docker inspect -f '{{index .Config.Labels "onebox.managed"}}' "$id" 2>/dev/null)" = true ] || echo "$id"
      done | grep -q .
}

foreign_cloudflared() {
  [ -f "$CF_CONF" ] && ! grep -qF "$MARK" "$CF_CONF"
}

port_busy() { ss -ltnH "sport = :$1" 2>/dev/null | grep -q .; }

PREFLIGHT_DONE=0
preflight() {
  [ "$PREFLIGHT_DONE" = 1 ] && return 0; PREFLIGHT_DONE=1
  log "Preflight (changes nothing)"
  . /etc/os-release 2>/dev/null || true
  say "os: ${PRETTY_NAME:-unknown}   arch: $(uname -m)   type: $TYPE   tunnel: $TUNNEL"
  [ "${ID:-}" = ubuntu ] || say "WARN: not Ubuntu. The steps assume Ubuntu LTS."
  [ "$(uname -m)" = x86_64 ] || say "WARN: not x86_64. Most images work on arm64, some do not."
  say "memory: $(free -m | awk '/^Mem:/{print $2" MB"}')   swap: $(free -m | awk '/^Swap:/{print $2" MB"}')"
  say "disk /: $(df -h / | awk 'NR==2{print $4" free of "$2}')"
  id "$ADMIN" >/dev/null 2>&1 && say "admin user $ADMIN: exists" || say "admin user $ADMIN: will be created"
  have docker && say "docker: $(docker --version 2>/dev/null)" || say "docker: not installed"
  have cloudflared && say "cloudflared: $(cloudflared --version 2>/dev/null | head -1)" || say "cloudflared: not installed"
  local refuse=0
  if foreign_traefik; then say "FOUND: a Traefik container that onebox did not create."; refuse=1; fi
  if foreign_cloudflared; then say "FOUND: $CF_CONF that onebox did not write."; refuse=1; fi
  if ! [ -f "$TRAEFIK_DIR/docker-compose.yml" ] && { port_busy 80 || port_busy 443; }; then
    say "FOUND: something already listens on port 80 or 443."; refuse=1
  fi
  if [ "$refuse" = 1 ]; then
    if [ "$ALLOW_EXISTING" = 1 ]; then
      say "Continuing because --allow-existing was given."
    else
      say "REFUSING: this box already has a proxy or tunnel. It may be a working server."
      say "Show this to the user. Re-run with --allow-existing only after a clear yes."
      say "The read-only 'check' phase works on any box."
      exit 3
    fi
  else
    say "no existing Traefik or tunnel found"
  fi
}

# --------------------------------------------------------------------- base --

phase_base() {
  need_root; preflight
  log "Packages"
  local pkgs="ca-certificates curl gnupg jq ufw unattended-upgrades restic python3-yaml"
  local missing=""
  for p in $pkgs; do dpkg -s "$p" >/dev/null 2>&1 || missing="$missing $p"; done
  if [ -n "$missing" ]; then
    run apt-get update -qq
    run env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $missing
  else
    say "all present"
  fi

  log "Admin user: $ADMIN"
  if id "$ADMIN" >/dev/null 2>&1; then say "exists"; else
    run adduser --disabled-password --gecos "" "$ADMIN"
  fi
  run usermod -aG sudo "$ADMIN"
  # Agents run sudo over SSH without a terminal. A password prompt there hangs
  # the run, so the admin user gets NOPASSWD. Key-only SSH is what protects it.
  local sudoers="/etc/sudoers.d/90-onebox-$ADMIN"
  if [ "$SUDO_PW" = 1 ]; then
    [ -f "$sudoers" ] && run rm -f "$sudoers"
    say "sudo needs a password (--sudo-password). Set one now in an interactive session:"
    say "  sudo passwd $ADMIN"
    say "Agents cannot answer the prompt, so you run the sudo steps yourself from here."
  elif printf '%s\n%s ALL=(ALL) NOPASSWD:ALL\n' "$MARK" "$ADMIN" | put "$sudoers" 0440 root:root; then
    [ "$DRY" = 1 ] || visudo -cf "$sudoers" >/dev/null || { rm -f "$sudoers"; die "sudoers check failed"; }
  fi

  log "SSH key for $ADMIN"
  local home; home="$(getent passwd "$ADMIN" | cut -d: -f6 || true)"; home="${home:-/home/$ADMIN}"
  local ak="$home/.ssh/authorized_keys"
  [ -s "$PUBKEY_FILE" ] || die "no public key at $PUBKEY_FILE. Pass --pubkey-file." 4
  if [ "$DRY" = 1 ]; then
    say "(dry run) would add keys from $PUBKEY_FILE to $ak"
  else
    install -d -m 700 -o "$ADMIN" -g "$ADMIN" "$home/.ssh"
    touch "$ak"
    local added=0
    while IFS= read -r key; do
      case "$key" in ''|'#'*) continue ;; esac
      grep -qxF "$key" "$ak" || { printf '%s\n' "$key" >> "$ak"; added=$((added+1)); }
    done < "$PUBKEY_FILE"
    chown "$ADMIN:$ADMIN" "$ak"; chmod 600 "$ak"
    say "$added key(s) added, $(grep -c . "$ak") total"
  fi

  log "Firewall (ufw)"
  local SSH_PORT; SSH_PORT="$(sshd -T 2>/dev/null | awk '/^port /{print $2; exit}' || true)"; SSH_PORT="${SSH_PORT:-22}"
  # Docker writes its own iptables rules, so a published container port skips
  # ufw. ufw guards host services (sshd). Containers are guarded by publishing
  # nothing, or only on 127.0.0.1 (see the proxy phase).
  run ufw default deny incoming >/dev/null
  run ufw default allow outgoing >/dev/null
  if [ "$SSH_TS_ONLY" = 1 ]; then
    ip link show tailscale0 >/dev/null 2>&1 || die "tailscale0 not found. Install and log in to Tailscale first." 4
    run ufw allow in on tailscale0 to any port "$SSH_PORT" proto tcp >/dev/null
    run ufw delete allow "$SSH_PORT/tcp" >/dev/null 2>&1 || true
    say "SSH allowed on tailscale0 only. Keep the provider's web console as the way back in."
  else
    run ufw allow "$SSH_PORT/tcp" >/dev/null
  fi
  if [ "$TUNNEL" = none ]; then
    say "tunnel is none: 80/443 are published by Docker and do not go through ufw."
    say "Use the provider's firewall to limit them to Cloudflare's IP ranges."
  fi
  run ufw --force enable >/dev/null
  [ "$DRY" = 1 ] || ufw status | sed 's/^/  /'

  log "Automatic security updates"
  put /etc/apt/apt.conf.d/20auto-upgrades 0644 root:root <<'EOF' || true
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
  if [ "$AUTO_REBOOT" = 1 ]; then
    put /etc/apt/apt.conf.d/52onebox-reboot 0644 root:root <<'EOF' || true
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
EOF
  else
    say "automatic reboot: off (check shows when a reboot is pending)"
  fi
  run systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true

  if [ "$TYPE" = vps ] && [ "$SWAP" = 1 ]; then
    log "Swap"
    # A 4 GB VPS runs out of memory during a Next.js or .NET image build.
    if swapon --show --noheadings | grep -q .; then say "swap already on"; else
      run fallocate -l 2G /swapfile
      run chmod 600 /swapfile
      run mkswap /swapfile >/dev/null
      run swapon /swapfile
      grep -q '^/swapfile ' /etc/fstab || run sh -c 'echo "/swapfile none swap sw 0 0" >> /etc/fstab'
    fi
  fi

  log "Next"
  say "1. From your Mac, open a NEW session: ssh $ADMIN@<box> 'sudo -n true && echo ok'"
  say "2. Only if that prints ok: box-setup.sh ssh-lockdown --user $ADMIN --confirmed-key-login"
}

# ------------------------------------------------------------- ssh-lockdown --

phase_ssh_lockdown() {
  need_root
  log "SSH lockdown"
  local home; home="$(getent passwd "$ADMIN" | cut -d: -f6 || true)"
  [ -s "$home/.ssh/authorized_keys" ] || die "$ADMIN has no authorized_keys. Run base first." 4
  [ "$KEY_LOGIN_OK" = 1 ] || die "log in as $ADMIN with your key in a new session first, then pass --confirmed-key-login" 4
  # sshd uses the FIRST value it reads for each setting. Ubuntu reads
  # sshd_config.d/*.conf in name order, and some cloud images ship
  # 50-cloud-init.conf with PasswordAuthentication yes. A 00- file wins.
  put /etc/ssh/sshd_config.d/00-onebox.conf 0644 root:root <<EOF || true
$MARK
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
  if [ "$DRY" = 0 ]; then
    sshd -t || die "sshd config test failed; nothing reloaded"
    systemctl reload ssh 2>/dev/null || systemctl reload sshd
    sshd -T | grep -E '^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin) ' | sed 's/^/  /'
    say "Existing sessions stay open. Test a new login before closing this one."
  fi
}

# ------------------------------------------------------------------- docker --

phase_docker() {
  need_root; preflight
  log "Docker"
  if docker compose version >/dev/null 2>&1; then
    say "present: $(docker --version), compose $(docker compose version --short)"
  else
    # Docker's own apt repository, as in docs.docker.com for Ubuntu.
    run install -m 0755 -d /etc/apt/keyrings
    run curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    run chmod a+r /etc/apt/keyrings/docker.asc
    . /etc/os-release
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' \
      "$(dpkg --print-architecture)" "${UBUNTU_CODENAME:-$VERSION_CODENAME}" \
      | put /etc/apt/sources.list.d/docker.list 0644 root:root || true
    run apt-get update -qq
    run env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
      docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
  # Default json-file logs grow without limit and fill a small disk.
  if [ -f /etc/docker/daemon.json ]; then
    say "keeping existing /etc/docker/daemon.json"
  else
    put /etc/docker/daemon.json 0644 root:root <<'EOF' && run systemctl restart docker || true
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
EOF
  fi
  run systemctl enable --now docker >/dev/null 2>&1
  # Membership in the docker group is root on this box. Only the admin user gets it.
  id -nG "$ADMIN" 2>/dev/null | grep -qw docker && say "$ADMIN is in the docker group" \
    || run usermod -aG docker "$ADMIN"
}

# -------------------------------------------------------------------- proxy --

phase_proxy() {
  need_root; preflight
  have docker || die "run the docker phase first" 4
  log "Proxy network: $NET"
  docker network inspect "$NET" >/dev/null 2>&1 && say "exists" || run docker network create "$NET"
  local gw
  gw="$(docker network inspect -f '{{range .IPAM.Config}}{{.Gateway}}{{end}}' "$NET" 2>/dev/null || true)"
  gw="${gw:-172.18.0.1}"
  say "gateway: $gw (cloudflared on the host reaches Traefik from this address)"

  log "Traefik in $TRAEFIK_DIR"
  run install -d -m 755 -o "$ADMIN" -g "$ADMIN" "$APPS_DIR"
  run install -d -m 755 "$TRAEFIK_DIR" "$TRAEFIK_DIR/dynamic" "$TRAEFIK_DIR/acme"
  [ -f "$TRAEFIK_DIR/acme/acme.json" ] || run install -m 600 /dev/null "$TRAEFIK_DIR/acme/acme.json"

  if [ "$TOKEN_STDIN" = 1 ]; then
    local tok; IFS= read -r tok || true
    [ -n "$tok" ] || die "--token-stdin given but stdin was empty"
    printf '%s\nCF_DNS_API_TOKEN=%s\n' "$MARK" "$tok" | put "$TRAEFIK_DIR/.env" 0600 root:root || true
    unset tok
  elif [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
    printf '%s\nCF_DNS_API_TOKEN=%s\n' "$MARK" "$CLOUDFLARE_API_TOKEN" | put "$TRAEFIK_DIR/.env" 0600 root:root || true
  elif [ -s "$TRAEFIK_DIR/.env" ]; then
    say "token: keeping $TRAEFIK_DIR/.env"
  else
    die "Traefik needs the Cloudflare DNS token for certificates. Pipe it in with --token-stdin." 4
  fi

  # A directory mount, not a single-file mount: editors that replace the file
  # change its inode, and a single-file bind mount keeps watching the old one.
  put "$TRAEFIK_DIR/dynamic/middlewares.yml" 0644 root:root <<'EOF' || true
# Traefik file provider. Any *.yml in this folder is loaded and hot-reloaded.
http:
  middlewares:
    secure-headers:
      headers:
        stsSeconds: 31536000
        contentTypeNosniff: true
        referrerPolicy: strict-origin-when-cross-origin
EOF

  # With a tunnel, nothing needs to reach 80/443 from outside. On a VPS the
  # ports bind to 127.0.0.1, because Docker-published ports skip ufw. At home
  # the router already blocks inbound, and LAN-only hostnames need the LAN IP.
  local bind=0.0.0.0
  [ "$TYPE" = vps ] && [ "$TUNNEL" = cloudflare ] && bind=127.0.0.1
  local email_line="      # no ACME email set (optional)"
  [ -n "$ACME_EMAIL" ] && email_line="      - --certificatesresolvers.cloudflare.acme.email=$ACME_EMAIL"

  put "$TRAEFIK_DIR/docker-compose.yml" 0644 root:root <<EOF || true
$MARK
# Edit the flags here, then: docker compose -p traefik up -d
services:
  traefik:
    image: $TRAEFIK_IMAGE
    container_name: traefik
    restart: unless-stopped
    env_file: .env
    command:
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --providers.docker.network=$NET
      - --providers.file.directory=/etc/traefik/dynamic
      - --providers.file.watch=true
      - --entrypoints.web.address=:80
      - --entrypoints.web.http.redirections.entrypoint.to=websecure
      - --entrypoints.web.http.redirections.entrypoint.scheme=https
      - --entrypoints.websecure.address=:443
      # Trust the tunnel hop, or every client IP becomes $gw.
      - --entrypoints.websecure.forwardedHeaders.trustedIPs=$gw/32,127.0.0.1/32,::1/128
      - --entrypoints.traefik.address=:8081
      - --api.insecure=true
      - --ping=true
      # DNS-01 needs no inbound port, so it renews behind the tunnel.
      - --certificatesresolvers.cloudflare.acme.dnschallenge=true
      - --certificatesresolvers.cloudflare.acme.dnschallenge.provider=cloudflare
      - --certificatesresolvers.cloudflare.acme.dnschallenge.resolvers=1.1.1.1:53,1.0.0.1:53
      - --certificatesresolvers.cloudflare.acme.storage=/acme/acme.json
$email_line
    ports:
      - "$bind:80:80"
      - "$bind:443:443"
      - "127.0.0.1:8081:8081"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./dynamic:/etc/traefik/dynamic:ro
      - ./acme:/acme
    labels:
      - onebox.managed=true
    networks:
      - $NET

networks:
  $NET:
    external: true
EOF
  if [ "$DRY" = 0 ]; then
    (cd "$TRAEFIK_DIR" && docker compose -p traefik up -d --wait --wait-timeout 60)
    local i; for i in 1 2 3 4 5 6; do curl -sf http://127.0.0.1:8081/ping >/dev/null && break; sleep 2; done
    curl -sf http://127.0.0.1:8081/ping >/dev/null && say "Traefik answers on 127.0.0.1:8081" \
      || die "Traefik did not answer. docker logs traefik --tail 50"
  else
    say "(dry run) would run: docker compose -p traefik up -d --wait"
  fi
}

# ------------------------------------------------------------------- tunnel --

unit_file() {  # unit_file NAME METRICS_PORT
  cat <<EOF
$MARK
[Unit]
Description=Cloudflare Tunnel ($1)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=$(command -v cloudflared || echo /usr/bin/cloudflared) --no-autoupdate --config $CF_CONF tunnel --metrics 127.0.0.1:$2 run
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
}

phase_tunnel() {
  need_root; preflight
  [ "$TUNNEL" = cloudflare ] || { say "tunnel is none; skipping"; return 0; }
  log "cloudflared"
  if have cloudflared; then say "present"; else
    run mkdir -p --mode=0755 /usr/share/keyrings
    run sh -c 'curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg > /usr/share/keyrings/cloudflare-main.gpg'
    echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' \
      | put /etc/apt/sources.list.d/cloudflared.list 0644 root:root || true
    run apt-get update -qq
    run env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq cloudflared
  fi

  log "Tunnel: $TUNNEL_NAME"
  local tid=""
  if [ -f "$CF_CONF" ]; then tid="$(awk '/^tunnel:/{print $2}' "$CF_CONF")"; fi
  if [ -n "$tid" ]; then say "config exists for tunnel $tid"; else
    local home cert
    home="$(getent passwd "$ADMIN" | cut -d: -f6 || true)"
    for cert in "$home/.cloudflared/cert.pem" /root/.cloudflared/cert.pem; do [ -f "$cert" ] && break; done
    if ! [ -f "$cert" ]; then
      say "MANUAL STEP: log cloudflared in to your Cloudflare account once."
      say "  As $ADMIN on the box run: cloudflared tunnel login"
      say "  It prints a URL. Open it on your Mac, pick your domain, approve."
      say "  Then run this phase again."
      exit 4
    fi
    if [ "$DRY" = 1 ]; then say "(dry run) would create tunnel $TUNNEL_NAME and write $CF_CONF"; return 0; fi
    local existing
    existing="$(TUNNEL_ORIGIN_CERT="$cert" cloudflared tunnel list -o json 2>/dev/null \
      | jq -r --arg n "$TUNNEL_NAME" '[.[] | select(.name==$n)][0].id // empty')"
    if [ -n "$existing" ]; then
      say "A tunnel named $TUNNEL_NAME already exists in Cloudflare ($existing),"
      say "but this box has no config for it. Either copy its credentials JSON to"
      say "$CF_DIR/$existing.json and write $CF_CONF by hand, or pick another --tunnel-name."
      exit 4
    fi
    install -d -m 755 "$CF_DIR"
    local creds="$CF_DIR/new-tunnel.json"
    TUNNEL_ORIGIN_CERT="$cert" cloudflared tunnel create --credentials-file "$creds" "$TUNNEL_NAME" >/dev/null
    tid="$(jq -r .TunnelID "$creds")"
    [ -n "$tid" ] && [ "$tid" != null ] || die "could not read the tunnel ID from $creds"
    mv "$creds" "$CF_DIR/$tid.json"; chmod 600 "$CF_DIR/$tid.json"; chown root:root "$CF_DIR/$tid.json"
    say "created tunnel $tid"
    put "$CF_CONF" 0644 root:root <<EOF || true
$MARK
tunnel: $tid
credentials-file: $CF_DIR/$tid.json
ingress:
  - service: http_status:404
EOF
  fi
  if [ "$DRY" = 0 ]; then
    cloudflared --config "$CF_CONF" tunnel ingress validate >/dev/null && say "ingress valid"
  fi

  log "Units: cloudflared + cloudflared-replica"
  # Two replicas of one tunnel. Restarting them a few seconds apart reloads
  # the ingress with no downtime. Restarting both at once drops every hostname.
  local changed=0
  unit_file primary 20241 | put /etc/systemd/system/cloudflared.service 0644 root:root && changed=1
  unit_file replica 20243 | put /etc/systemd/system/cloudflared-replica.service 0644 root:root && changed=1
  if [ "$DRY" = 0 ]; then
    [ "$changed" = 1 ] && systemctl daemon-reload
    systemctl enable --now cloudflared >/dev/null 2>&1; sleep 8
    systemctl enable --now cloudflared-replica >/dev/null 2>&1; sleep 5
    local p; for p in 20241 20243; do
      curl -sf --max-time 5 "http://127.0.0.1:$p/ready" >/dev/null && say "127.0.0.1:$p ready" || say "WARN: 127.0.0.1:$p not ready yet"
    done
    say "CNAME target for every public hostname: $tid.cfargotunnel.com (proxied)"
  fi
}

# ------------------------------------------------------------------- backup --

phase_backup() {
  need_root
  log "Backups"
  [ -f "$HERE/onebox-backup.sh" ] || die "onebox-backup.sh must sit next to this script" 2
  put /usr/local/sbin/onebox-backup 0755 root:root < "$HERE/onebox-backup.sh" || true
  if [ -f "$BACKUP_ENV" ]; then say "keeping $BACKUP_ENV"; else
    put "$BACKUP_ENV" 0600 root:root <<EOF || true
$MARK
# Nightly: every running Postgres container is dumped to DUMP_DIR, then restic
# copies DUMP_DIR and BACKUP_PATHS off the box. Leave RESTIC_REPOSITORY empty
# to keep local dumps only (they do not survive a lost disk).
DUMP_DIR=/var/backups/onebox/postgres
KEEP_LOCAL_DAYS=7
BACKUP_PATHS="$APPS_DIR /etc/cloudflared /etc/onebox"
# Examples: sftp:user@backup-host:/onebox   s3:https://s3.example.com/bucket/onebox
RESTIC_REPOSITORY=
RESTIC_PASSWORD_FILE=/etc/onebox/restic-password
# Credentials for an S3-compatible repository, if it needs them:
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
EOF
  fi
  put /etc/systemd/system/onebox-backup.service 0644 root:root <<'EOF' || true
[Unit]
Description=onebox nightly backup
After=docker.service
Wants=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/onebox-backup
Nice=10
IOSchedulingClass=idle
EOF
  put /etc/systemd/system/onebox-backup.timer 0644 root:root <<'EOF' || true
[Unit]
Description=onebox nightly backup

[Timer]
OnCalendar=*-*-* 03:30
RandomizedDelaySec=20m
Persistent=true

[Install]
WantedBy=timers.target
EOF
  run systemctl daemon-reload
  run systemctl enable --now onebox-backup.timer >/dev/null 2>&1
  say "timer on: $(systemctl show -p NextElapseUSecRealtime --value onebox-backup.timer 2>/dev/null || echo '?')"
  if ! grep -qE '^RESTIC_REPOSITORY=.+' "$BACKUP_ENV" 2>/dev/null; then
    say "MANUAL STEP: no off-box target yet. Set RESTIC_REPOSITORY in $BACKUP_ENV,"
    say "  put a long random password in /etc/onebox/restic-password (chmod 600),"
    say "  store the same password OFF the box, then run: onebox-backup --init"
  fi
}

# -------------------------------------------------------------------- check --

phase_check() {
  local fail=0 warn=0
  ok()   { printf '  PASS  %s\n' "$*"; }
  bad()  { printf '  FAIL  %s\n' "$*"; fail=$((fail+1)); }
  meh()  { printf '  WARN  %s\n' "$*"; warn=$((warn+1)); }
  S() { if [ "$(id -u)" = 0 ]; then "$@"; else sudo -n "$@"; fi; }

  log "Health check ($TYPE)"
  local sshd; sshd="$(S sshd -T 2>/dev/null || true)"
  if [ -z "$sshd" ]; then meh "sshd -T needs root; SSH settings not checked"
  else
    echo "$sshd" | grep -q '^passwordauthentication no' && ok "SSH password login off" || bad "SSH password login is ON"
    echo "$sshd" | grep -q '^permitrootlogin no' && ok "SSH root login off" || meh "SSH root login allowed (run ssh-lockdown)"
  fi
  S ufw status 2>/dev/null | grep -q '^Status: active' && ok "ufw active" || bad "ufw not active"
  if [ "$TYPE" = vps ]; then
    S ufw status 2>/dev/null | grep -qE '^(80|443)(/tcp)? ' && meh "ufw allows 80/443; not needed with a tunnel"
  fi
  [ -f /etc/apt/apt.conf.d/20auto-upgrades ] && ok "unattended-upgrades configured" || bad "unattended-upgrades not configured"
  [ -f /var/run/reboot-required ] && meh "a reboot is pending (security update)"
  if [ "$TYPE" = vps ]; then swapon --show --noheadings | grep -q . && ok "swap on" || meh "no swap; image builds may run out of memory"; fi

  if S docker info >/dev/null 2>&1; then
    ok "docker $(S docker version -f '{{.Server.Version}}' 2>/dev/null), compose $(S docker compose version --short 2>/dev/null)"
    S docker network inspect "$NET" >/dev/null 2>&1 && ok "network $NET exists" || bad "network $NET missing"
    [ "$(S docker inspect -f '{{.State.Running}}' traefik 2>/dev/null)" = true ] && ok "traefik running" || bad "traefik not running"
    curl -sf --max-time 5 http://127.0.0.1:8081/ping >/dev/null 2>&1 && ok "traefik API on 127.0.0.1:8081" || bad "traefik API not answering"
    local open
    open="$(S docker ps --format '{{.Names}} {{.Ports}}' | grep -E '(0\.0\.0\.0|\[::\]|:::)[0-9]+->' || true)"
    if [ -n "$open" ]; then
      if [ "$TYPE" = vps ] && [ "$TUNNEL" = cloudflare ]; then
        bad "ports published on all interfaces (Docker skips ufw):"; echo "$open" | sed 's/^/          /'
      else
        meh "ports published on all interfaces:"; echo "$open" | sed 's/^/          /'
      fi
    else ok "no container port published on all interfaces"; fi
  else
    bad "docker not reachable"
  fi

  if [ "$TUNNEL" = cloudflare ]; then
    local u
    for u in $(systemctl list-units 'cloudflared*.service' --all --plain --no-legend 2>/dev/null | awk '{print $1}'); do
      [ "$(systemctl is-active "$u")" = active ] && ok "$u active" || bad "$u not active"
    done
    systemctl list-units 'cloudflared*.service' --all --plain --no-legend 2>/dev/null | grep -q . || bad "no cloudflared unit"
    local p; for p in 20241 20243; do
      curl -sf --max-time 5 "http://127.0.0.1:$p/ready" >/dev/null 2>&1 && ok "tunnel replica on :$p ready" || meh "nothing ready on 127.0.0.1:$p"
    done
    [ "$(systemctl list-units 'cloudflared*.service' --state=active --plain --no-legend 2>/dev/null | wc -l)" -ge 2 ] \
      || meh "one tunnel replica only; a restart drops traffic for a few seconds"
  fi

  systemctl is-enabled onebox-backup.timer >/dev/null 2>&1 && ok "backup timer enabled" || bad "backup timer not enabled"
  local last=/var/backups/onebox/last-run
  if [ -f "$last" ]; then
    local age=$(( $(date +%s) - $(stat -c %Y "$last") ))
    grep -q '^ok' "$last" && [ "$age" -lt 129600 ] && ok "last backup ok, $((age/3600)) h ago" \
      || bad "last backup: $(head -1 "$last"), $((age/3600)) h ago"
    grep -q 'offsite=none' "$last" && meh "backups stay on this box (no RESTIC_REPOSITORY)"
  else
    meh "no backup has run yet (run: sudo onebox-backup)"
  fi

  local use; use="$(df -P / | awk 'NR==2{gsub("%","",$5); print $5}')"
  [ "$use" -lt 85 ] && ok "disk / ${use}% used" || bad "disk / ${use}% used"

  printf '\n  %s fail, %s warn\n' "$fail" "$warn"
  [ "$fail" = 0 ]
}

# --------------------------------------------------------------------- main --

[ "$DRY" = 1 ] && log "DRY RUN: nothing will be changed"
case "$PHASE" in
  preflight)    preflight ;;
  base)         phase_base ;;
  ssh-lockdown) phase_ssh_lockdown ;;
  docker)       phase_docker ;;
  proxy)        phase_proxy ;;
  tunnel)       phase_tunnel ;;
  backup)       phase_backup ;;
  check)        phase_check ;;
  all)          phase_base; phase_docker; phase_proxy; phase_tunnel; phase_backup; phase_check ;;
  *) sed -n '2,50p' "$0"; exit 2 ;;
esac
