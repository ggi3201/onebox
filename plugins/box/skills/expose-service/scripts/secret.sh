#!/usr/bin/env bash
#
# Print one secret to stdout, read through the onebox secrets tool.
# Pipe the output into the command that needs it. Never echo it, never put it
# in a URL, never write it to a file the user did not ask for.
#
# Usage: secret.sh <reference>
#   env        (default) $REF from the environment, else the nearest .env walking up
#   doppler    doppler secrets get REF --plain -p <secrets.doppler.project> -c <secrets.doppler.config>
#   1password  op read REF   (REF looks like op://vault/item/field)
#
# Runs on: your Mac (or wherever the secrets tool is logged in).

set -euo pipefail
REF="${1:?usage: secret.sh <reference>}"

cfg() { jq -s '.[0] * .[1]' ~/.config/onebox/config.json .onebox.json 2>/dev/null \
  || cat ~/.config/onebox/config.json 2>/dev/null || echo '{}'; }

TOOL="$(cfg | jq -r '.secrets.tool // "env"')"

case "$TOOL" in
  env)
    if v="$(printenv "$REF")" && [ -n "$v" ]; then printf '%s' "$v"; exit 0; fi
    d="$PWD"
    while :; do
      if [ -f "$d/.env" ] && line="$(grep -E "^(export )?$REF=" "$d/.env" | tail -1)" && [ -n "$line" ]; then
        v="${line#*=}"; v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
        printf '%s' "$v"; exit 0
      fi
      [ "$d" = / ] && break
      d="$(dirname "$d")"
    done
    echo "secret $REF not found in the environment or any .env above $PWD" >&2; exit 1 ;;
  doppler)
    P="$(cfg | jq -r '.secrets.doppler.project // empty')"
    C="$(cfg | jq -r '.secrets.doppler.config // empty')"
    [ -n "$P" ] && [ -n "$C" ] || { echo "set secrets.doppler.project and .config" >&2; exit 1; }
    doppler secrets get "$REF" --plain -p "$P" -c "$C" ;;
  1password)
    op read "$REF" ;;
  *)
    echo "unknown secrets.tool: $TOOL" >&2; exit 1 ;;
esac
