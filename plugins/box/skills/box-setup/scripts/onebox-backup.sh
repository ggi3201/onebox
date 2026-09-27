#!/usr/bin/env bash
#
# Nightly backup for a onebox box. Installed as /usr/local/sbin/onebox-backup
# by `box-setup.sh backup` and run by onebox-backup.timer.
#
# 1. Dumps every running Postgres container with pg_dumpall (a consistent
#    logical dump; copying a live data directory is not).
# 2. Keeps KEEP_LOCAL_DAYS of dumps on the box.
# 3. If RESTIC_REPOSITORY is set, sends the dumps and BACKUP_PATHS off the box
#    with restic (encrypted, deduplicated) and thins old snapshots.
#
# Skip a container by giving it the label onebox.backup=false.
#
# Usage:
#   onebox-backup            run a backup now
#   onebox-backup --init     create the restic repository once
#   onebox-backup --list     list restic snapshots
#
# Settings: /etc/onebox/backup.env. Writes a one-line status to
# /var/backups/onebox/last-run, which `box-setup.sh check` reads.

set -euo pipefail

ENV_FILE=/etc/onebox/backup.env
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE" >&2; exit 1; }
set -a; . "$ENV_FILE"; set +a

DUMP_DIR="${DUMP_DIR:-/var/backups/onebox/postgres}"
KEEP_LOCAL_DAYS="${KEEP_LOCAL_DAYS:-7}"
STATUS=/var/backups/onebox/last-run
mkdir -p "$DUMP_DIR"; chmod 700 "$(dirname "$DUMP_DIR")" "$DUMP_DIR"

case "${1:-}" in
  --init) [ -n "${RESTIC_REPOSITORY:-}" ] || { echo "set RESTIC_REPOSITORY first" >&2; exit 1; }
          restic cat config >/dev/null 2>&1 && echo "repository already exists" || restic init
          exit 0 ;;
  --list) restic snapshots; exit 0 ;;
esac

errors=0
stamp="$(date -u +%Y%m%dT%H%M%SZ)"

docker ps --format '{{.Names}}\t{{.Image}}' | while IFS=$'\t' read -r name image; do
  case "$image" in *postgres*|*postgis*|*timescale*) ;; *) continue ;; esac
  [ "$(docker inspect -f '{{index .Config.Labels "onebox.backup"}}' "$name")" = false ] && continue
  out="$DUMP_DIR/$name-$stamp.sql.gz"
  # POSTGRES_USER is read inside the container, so no credential passes through here.
  if docker exec "$name" sh -c 'pg_dumpall -U "${POSTGRES_USER:-postgres}"' | gzip > "$out.part" \
     && [ "$(gzip -dc "$out.part" | head -c 1024 | wc -c)" -gt 0 ]; then
    mv "$out.part" "$out"; chmod 600 "$out"
    echo "dumped $name -> $out ($(du -h "$out" | cut -f1))"
  else
    rm -f "$out.part"; echo "FAILED to dump $name" >&2
    echo x >> "$DUMP_DIR/.errors"
  fi
done
[ -f "$DUMP_DIR/.errors" ] && { errors=$(wc -l < "$DUMP_DIR/.errors"); rm -f "$DUMP_DIR/.errors"; }

find "$DUMP_DIR" -name '*.sql.gz' -mtime +"$KEEP_LOCAL_DAYS" -delete

offsite=none
if [ -n "${RESTIC_REPOSITORY:-}" ]; then
  # shellcheck disable=SC2086  # BACKUP_PATHS is a space-separated list on purpose
  if restic backup --tag onebox --exclude-caches "$DUMP_DIR" ${BACKUP_PATHS:-} \
     && restic forget --tag onebox --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune; then
    offsite=restic
  else
    echo "FAILED: restic" >&2; errors=$((errors+1)); offsite=failed
  fi
fi

if [ "$errors" = 0 ]; then
  echo "ok $stamp offsite=$offsite" > "$STATUS"
else
  echo "failed $stamp errors=$errors offsite=$offsite" > "$STATUS"; exit 1
fi
