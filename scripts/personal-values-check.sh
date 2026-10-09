#!/usr/bin/env bash
# The repo is public, so a personal value in a diff is a bug (CONTRIBUTING.md,
# rule 1). This reads the lines a change adds, against a base, and fails on:
#   - a home path:        /Users/<name>, /home/<name>
#   - a private address:  10.x, 172.16-31.x, 192.168.x, 100.64-127.x (CGNAT)
#   - an email address
# A few intended values are allowed (the ALLOW_* lists below).
#
#   bash scripts/personal-values-check.sh [base]      (default: origin/main)
set -euo pipefail
cd "$(dirname "$0")/.."
base="${1:-origin/main}"
since="$(git merge-base HEAD "$base")"

# Only added lines, and not the lockfiles (version ranges look like addresses).
added="$(git diff --no-renames -U0 "$since" -- . ':(exclude)*package-lock.json' ':(exclude)*pnpm-lock.yaml' \
  | awk '/^\+\+\+ /{f=substr($0,7); next} /^\+/{print f": "substr($0,2)}')"

ALLOW_PATH='/(Users|home)/(you|me|user|username|name|someone|\$|<|\{)'
# A range written as CIDR (a list of private ranges in code), the placeholders
# the guides use for a LAN address, the Docker bridge gateways, and the RFC 5737
# documentation ranges.
ALLOW_IP='[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/[0-9]+|192\.168\.1\.(1|20)([^0-9]|$)|172\.1[78]\.0\.1([^0-9]|$)|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.'
# The project's own contact domain, example domains, and noreply addresses.
ALLOW_MAIL='@(([a-z0-9-]+\.)*example\.(com|org|net)|lokkesveen\.com|users\.noreply\.github\.com)$|^(no-?reply|git)@'

found=0
report() { # <what> <pattern> <allow pattern>
  local hits
  hits="$(printf '%s\n' "$added" | grep -E "$2" || true)"
  [ -n "$hits" ] || return 0
  while IFS= read -r line; do
    # Test each match on its own, so one allowed value does not hide another.
    while IFS= read -r m; do
      if ! printf '%s' "$m" | grep -Eq "$3"; then
        echo "personal value ($1): ${line%%: *}: $m"; found=1
      fi
    done < <(printf '%s' "${line#*: }" | grep -oE "$2" | sed -E 's/^[^0-9A-Za-z@\/]+//')
  done <<< "$hits"
}

report "home path" '/(Users|home)/[A-Za-z0-9_.<${{-][A-Za-z0-9_.-]*' "$ALLOW_PATH"
report "private address" '(^|[^0-9.])(10\.[0-9]+\.[0-9]+\.[0-9]+|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]+\.[0-9]+|192\.168\.[0-9]+\.[0-9]+|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]+\.[0-9]+)(/[0-9]+)?' "$ALLOW_IP"
report "email" '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}' "$ALLOW_MAIL"

if [ "$found" = 1 ]; then
  echo "Take the value out, or use a placeholder (example.com, myapp, you). An intended value goes in the allow lists in scripts/personal-values-check.sh."
  exit 1
fi
echo "personal-values-check: ok"
