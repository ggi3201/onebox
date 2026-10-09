#!/usr/bin/env bash
#
# Print one secret to stdout. Pipe it into the command that needs it. Never
# echo it, never put it in a URL, never write it to a file the user did not ask
# for. Usage: secret.sh <reference>
#
# First match wins (CONFIG.md, "Secrets"):
#   1. The environment variable named by the reference. It is there when you
#      start the agent through your secrets tool (`doppler run -- claude`).
#   2. Your command: `secrets.command` in the onebox config, with {ref} in it.
#      `secrets.tool` "doppler" or "1password" is a ready-made command.
#   3. The reference in the nearest .env file, walking up from the folder.
#
# Runs on: your Mac (or wherever the secrets tool is signed in).
# Do not edit a copy inside a skill: edit scripts/shared/secret.sh and run
# `bash scripts/secret-copies.sh sync`.

set -euo pipefail
REF="${1:?usage: secret.sh <reference>}"
HOW='Put it in the environment (start your agent through your secrets tool, for example `doppler run -- claude`), set secrets.command in your onebox config, or add it to a git-ignored .env file. CONFIG.md, "Secrets".'

cfg() { jq -s '.[0] * .[1]' ~/.config/onebox/config.json .onebox.json 2>/dev/null \
  || cat ~/.config/onebox/config.json 2>/dev/null || cat .onebox.json 2>/dev/null || echo '{}'; }
quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
is_name=0; [[ "$REF" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] && is_name=1

# 1. The environment.
if [ "$is_name" = 1 ] && [ -n "${!REF:-}" ]; then printf '%s' "${!REF}"; exit 0; fi

# 2. Your command.
CMD="$(cfg | jq -r '.secrets.command // empty')"
if [ -z "$CMD" ]; then
  case "$(cfg | jq -r '.secrets.tool // "env"')" in
    doppler)
      CMD="doppler secrets get {ref} --plain"
      P="$(cfg | jq -r '.secrets.doppler.project // empty')"; [ -n "$P" ] && CMD="$CMD -p $(quote "$P")"
      C="$(cfg | jq -r '.secrets.doppler.config // empty')"; [ -n "$C" ] && CMD="$CMD -c $(quote "$C")" ;;
    1password) CMD="op read {ref}" ;;
  esac
fi
if [ -n "$CMD" ]; then
  shopt -u patsub_replacement 2>/dev/null || true   # bash 5.2: keep & literal below
  CMD="${CMD//\{ref\}/$(quote "$REF")}"
  # perl's alarm is a timeout that exists on macOS and Linux alike.
  if out="$(perl -e 'alarm shift; exec @ARGV' 60 /bin/sh -c "$CMD")"; then
    out="${out%"${out##*[![:space:]]}"}"
    [ -n "$out" ] || { echo "the secrets command for $REF printed nothing" >&2; exit 1; }
    printf '%s' "$out"; exit 0
  else
    rc=$?
    if [ "$rc" = 142 ]; then
      echo "the secrets command for $REF did not answer in 60 s. It may be waiting for a prompt, such as Touch ID. $HOW" >&2
    else
      echo "the secrets command for $REF failed (exit $rc). Check that your secrets tool is installed and signed in." >&2
    fi
    exit 1
  fi
fi

# 3. The nearest .env.
if [ "$is_name" = 1 ]; then
  d="$PWD"
  while :; do
    if [ -f "$d/.env" ] && line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?$REF[[:space:]]*=" "$d/.env" | tail -1)" && [ -n "$line" ]; then
      v="${line#*=}"; v="${v#"${v%%[![:space:]]*}"}"; v="${v%"${v##*[![:space:]]}"}"
      v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
      [ -n "$v" ] && { printf '%s' "$v"; exit 0; }
      break
    fi
    [ "$d" = / ] && break
    d="$(dirname "$d")"
  done
fi
echo "secret $REF not found. $HOW" >&2
exit 1
