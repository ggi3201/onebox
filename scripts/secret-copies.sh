#!/usr/bin/env bash
# The secret readers in scripts/shared/ are copied into every skill that reads
# a secret: an installed plugin has only its own files. This keeps the copies
# the same, and checks the ASC auth block the two asc.mjs files share.
#   bash scripts/secret-copies.sh check   fails when a copy differs
#   bash scripts/secret-copies.sh sync    writes every copy from scripts/shared/
set -euo pipefail
cd "$(dirname "$0")/.."

COPIES=(
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
    # The ASC auth block is copied by hand between the two asc.mjs files.
    a=plugins/ship-ios/skills/appstore-connect/scripts/asc.mjs; b=plugins/ship-ios/skills/app-store-screenshots/scripts/asc.mjs
    range='/^\/\/ ---- onebox ASC auth/,/^\/\/ ---- end onebox ASC auth/p'
    cmp -s <(sed -n "$range" "$a") <(sed -n "$range" "$b") || { echo "the onebox ASC auth block differs (copy it by hand): $a, $b" >&2; bad=1; }
    [ "$bad" = 0 ] || { echo "run: bash scripts/secret-copies.sh sync" >&2; exit 1; }
    echo "secret-copies: ok" ;;
  *) echo "usage: secret-copies.sh check|sync" >&2; exit 2 ;;
esac
