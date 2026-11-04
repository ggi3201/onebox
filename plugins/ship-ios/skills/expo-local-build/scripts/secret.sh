#!/usr/bin/env bash
#
# Print one secret to stdout. Pipe it into the command that needs it. Never
# echo it, never put it in a URL, never write it to a file the user did not ask
# for. Usage: secret.sh <reference>
#
# First match wins (CONFIG.md, "Secrets"):
#   1. The environment variable named by the reference. It is there when you
#      start the agent through your secrets tool (`doppler run -- claude`).
#   2. Your command: `secrets.command` in ~/.config/onebox/config.json, with
#      {ref} in it. Never from a repo's .onebox.json: a cloned repo must not be
#      able to run a command on your Mac. `secrets.tool` "doppler" or
#      "1password" is a ready-made command, and may come from either file.
#   3. The reference in the nearest .env file, walking up from the folder.
#
# Runs on: your Mac (or wherever the secrets tool is signed in).
# Do not edit a copy inside a skill: edit scripts/shared/secret.sh and run
# `bash scripts/secret-copies.sh sync`.

set -euo pipefail
REF="${1:?usage: secret.sh <reference>}"
HOW='Put it in the environment (start your agent through your secrets tool, for example `doppler run -- claude`), set secrets.command in your onebox config, or add it to a git-ignored .env file. CONFIG.md, "Secrets".'

# Your config, then the nearest .onebox.json from here up (a monorepo keeps it at the root).
cfg() {
  local f=() d="$PWD"; [ -f ~/.config/onebox/config.json ] && f+=(~/.config/onebox/config.json)
  while :; do [ -f "$d/.onebox.json" ] && { f+=("$d/.onebox.json"); break; }; [ "$d" = / ] && break; d="$(dirname "$d")"; done
  if [ ${#f[@]} -gt 0 ]; then jq -s 'reduce .[] as $x ({}; . * $x)' "${f[@]}" 2>/dev/null || echo '{}'; else echo '{}'; fi
}
quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
is_name=0; [[ "$REF" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] && is_name=1

# 1. The environment.
if [ "$is_name" = 1 ] && [ -n "${!REF:-}" ]; then printf '%s' "${!REF}"; exit 0; fi

# 2. Your command.
CMD="$(jq -r '.secrets.command // empty' ~/.config/onebox/config.json 2>/dev/null || true)"
if [ -z "$CMD" ]; then
  case "$(cfg | jq -r '.secrets.tool // "env"')" in
    doppler)
      CMD="doppler secrets get {ref} --plain"
      for k in project config; do
        v="$(cfg | jq -r ".secrets.doppler.$k // empty")"
        if [ -n "$v" ]; then CMD="$CMD --$k $(quote "$v")"
        # Without it doppler stops with "You must specify a project". `doppler setup` sets both for a folder.
        # A service token (DOPPLER_TOKEN) carries both, and DOPPLER_PROJECT / DOPPLER_CONFIG set one each.
        elif [ -z "${DOPPLER_TOKEN:-}" ] && e="DOPPLER_$(echo "$k" | tr a-z A-Z)" && [ -z "${!e:-}" ] \
          && command -v doppler >/dev/null && [ -z "$(doppler configure get "$k" --plain 2>/dev/null)" ]; then
          echo "secrets.tool is doppler, but no Doppler $k is set. Set secrets.doppler.$k in ~/.config/onebox/config.json, or run \`doppler setup\` in this folder. CONFIG.md, \"Secrets\"." >&2
          exit 1
        fi
      done ;;
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
