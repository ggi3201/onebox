#!/usr/bin/env bash
# The secret readers in scripts/shared/ are copied into every skill that reads
# a secret: an installed plugin has only its own files. This keeps the copies
# the same.
#   bash scripts/secret-copies.sh check   fails when a copy differs
#   bash scripts/secret-copies.sh sync    writes every copy from scripts/shared/
set -euo pipefail
cd "$(dirname "$0")/.."

COPIES=(
  "scripts/shared/secret.mjs plugins/content/skills/image/scripts/secret.mjs"
  "scripts/shared/secret.mjs plugins/content/skills/video/scripts/secret.mjs"
  "scripts/shared/secret.mjs plugins/ship-ios/skills/appstore-connect/scripts/secret.mjs"
  "scripts/shared/secret.mjs plugins/ship-ios/skills/app-store-screenshots/scripts/secret.mjs"
  "scripts/shared/secret.mjs plugins/start/skills/plan/scripts/secret.mjs"
  "scripts/shared/secret.sh plugins/box/skills/expose-service/scripts/secret.sh"
  "scripts/shared/secret.sh plugins/ship-ios/skills/expo-local-build/scripts/secret.sh"
)

case "${1:-check}" in
  sync)
    for pair in "${COPIES[@]}"; do
      read -r src dst <<<"$pair"
      cp "$src" "$dst"
      case "$dst" in *.sh) chmod +x "$dst" ;; esac
    done
    echo "secret-copies: synced ${#COPIES[@]} copies" ;;
  check)
    bad=0
    for pair in "${COPIES[@]}"; do
      read -r src dst <<<"$pair"
      cmp -s "$src" "$dst" || { echo "differs from $src: $dst" >&2; bad=1; }
    done
    [ "$bad" = 0 ] || { echo "run: bash scripts/secret-copies.sh sync" >&2; exit 1; }
    echo "secret-copies: ok" ;;
  *) echo "usage: secret-copies.sh check|sync" >&2; exit 2 ;;
esac
