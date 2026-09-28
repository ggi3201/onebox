#!/usr/bin/env bash
# Build, check and (only with --publish) publish an EAS Update for iOS.
#
#   update.sh --channel production --expect-host api.example.com -m "fix: typo on paywall"
#   update.sh ... --publish                    # really publish
#   update.sh ... --publish --rollout 10       # to 10% of users first
#
# Run it from the Expo app folder (the one with app.json or app.config.* and
# eas.json). Without --publish it builds the update bundle with the EAS
# environment of the channel, checks it, prints the publish command, and
# publishes nothing.
set -euo pipefail

channel=""; env=""; message=""; publish=0; rollout=""; keep=0; hosts=()
while [ $# -gt 0 ]; do
  case "$1" in
    --channel) channel="$2"; shift 2 ;;
    --environment) env="$2"; shift 2 ;;
    -m|--message) message="$2"; shift 2 ;;
    --expect-host) hosts+=("$2"); shift 2 ;;
    --publish) publish=1; shift ;;
    --rollout) rollout="$2"; shift 2 ;;
    --keep) keep=1; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "update.sh: unknown flag $1" >&2; exit 2 ;;
  esac
done
fail() { echo "FAIL  $*" >&2; exit 1; }
ok() { echo "OK    $*"; }
warn() { echo "WARN  $*"; }

[ -n "$channel" ] || fail "--channel is required (development, preview or production)"
[ -n "$message" ] || fail "-m is required: say what the update changes"
[ ${#hosts[@]} -gt 0 ] || fail "--expect-host is required: the API host this channel must call, e.g. api.example.com"
if [ -z "$env" ]; then case "$channel" in production|preview|development) env="$channel" ;; *) fail "--environment is required for channel $channel" ;; esac; fi

# 1. The right folder, and the pieces EAS Update needs.
{ [ -f app.json ] || compgen -G "app.config.*" >/dev/null; } || fail "no app.json or app.config.* here. Run from the Expo app folder"
[ -f eas.json ] || fail "no eas.json here"
grep -q '"expo-updates"' package.json || fail "expo-updates is not installed. Set it up first (the skill's step 1)"
cfg=$(npx expo config --type public --json 2>/dev/null) || fail "expo config failed. Run: npx expo config --type public"
url=$(printf '%s' "$cfg" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=JSON.parse(s);console.log(c.updates?.url||"")})')
[ -n "$url" ] || fail "updates.url is not set. Run: eas update:configure -p ios"
node -e 'const j=require("./eas.json");const c=Object.values(j.build||{}).map(p=>p.channel).filter(Boolean);if(!c.includes(process.argv[1])){console.error("no build profile in eas.json uses channel "+process.argv[1]+" (found: "+(c.join(", ")||"none")+")");process.exit(1)}' "$channel" \
  || fail "no build listens on channel $channel, so nobody would get this update"
eas whoami >/dev/null 2>&1 || fail "not logged in to Expo. Run: eas login"
ok "app folder, expo-updates, updates.url, channel $channel in eas.json, logged in"

rv=$(npx expo-updates runtimeversion:resolve --platform ios 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).runtimeVersion||"")}catch{console.log("")}})')
[ -n "$rv" ] && ok "runtime version for iOS: $rv" || warn "could not resolve the runtime version"

# 2. Build the bundle with the channel's EAS environment, not with local .env files alone.
out="dist-update"
rm -rf "$out"
eas env:exec "$env" "npx expo export --platform ios --output-dir $out" --non-interactive >"$out.log" 2>&1 \
  || { tail -20 "$out.log" >&2; fail "export failed. Full log: $out.log"; }
rm -f "$out.log"
bundle=$(find "$out/_expo/static/js/ios" -type f \( -name '*.hbc' -o -name '*.js' \) | head -1)
[ -n "$bundle" ] || fail "no iOS bundle in $out"
ok "bundle built with EAS environment \"$env\": $(du -h "$bundle" | cut -f1), all files $(du -sh "$out" | cut -f1)"

# 3. Check it calls the right server. (strings to a file: grep -q in a pipe
# would stop early, and pipefail would read that as "not found".)
txt=$(mktemp); trap 'rm -f "$txt"' EXIT; strings "$bundle" > "$txt"
for h in "${hosts[@]}"; do
  if grep -qF "$h" "$txt"; then ok "bundle contains $h"; else fail "bundle does not contain $h. An EXPO_PUBLIC_* value is missing from EAS environment \"$env\" (eas env:list --environment $env)"; fi
done
if grep -qE 'https?://(localhost|127\.0\.0\.1|10\.|192\.168\.)' "$txt"; then
  warn "bundle mentions a local address. Fine if it is a dev-only fallback in the code; check before you publish"
fi

# 4. Publish, only when asked.
cmd=(eas update --channel "$channel" --environment "$env" --platform ios --skip-bundler --input-dir "$out" --message "$message" --non-interactive)
[ -n "$rollout" ] && cmd+=(--rollout-percentage "$rollout")
if [ "$publish" -eq 1 ]; then
  "${cmd[@]}"
  ok "published to channel $channel. Phones get it on their next launch, and use it on the launch after"
else
  echo; echo "Dry run: nothing published. To publish this exact bundle:"; printf '  %q' "${cmd[@]}"; echo
  keep=1
fi
[ "$keep" -eq 1 ] || rm -rf "$out"
