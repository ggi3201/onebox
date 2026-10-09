#!/usr/bin/env bash
# Build an Expo iOS app and send it to TestFlight.
#
#   build.sh [--profile production] [--skip-submit] [--interactive] [--cloud]
#            [--dir <mobile-dir>] [--groups <TestFlight group>] [--upload altool|eas]
#
# Local (default, free): `eas build --local` on this Mac, then upload the .ipa.
# The upload goes straight to Apple with `xcrun altool` when an App Store Connect
# key is in the config: it takes seconds, while `eas submit` can wait in Expo's
# queue for hours and then fail as a duplicate. `--upload eas` (or --groups, which
# only eas submit can do) uses eas submit instead.
# Only one build per app runs at a time: a second one stops at the lock.
# Cloud: `eas build --auto-submit` on Expo's servers. Used when --cloud is passed,
# when expo.buildMode is "cloud" in the onebox config, or when this is not a Mac.
#
# Reads the onebox config (~/.config/onebox/config.json, then the nearest .onebox.json):
#   expo.buildMode, expo.tokenRef, apple.teamId,
#   apple.ascKeyId, apple.ascIssuerId, apple.ascKeyPath | apple.ascKeyRef, secrets.*
# Never prints a secret. Do not run it with EXPO_DEBUG=1: that dumps the API key.
set -euo pipefail

PROFILE=production; SUBMIT=true; INTERACTIVE=false; FORCE_CLOUD=false; DIR=""; TF_GROUP=""; UPLOAD=""
while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --skip-submit) SUBMIT=false; shift ;;
    --interactive) INTERACTIVE=true; shift ;;
    --cloud) FORCE_CLOUD=true; shift ;;
    --dir) DIR="$2"; shift 2 ;;
    --groups) TF_GROUP="$2"; shift 2 ;;
    --upload) UPLOAD="$2"; shift 2 ;;
    --) shift ;;   # pnpm/npm pass a literal -- through
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

say()  { printf '\033[0;34m[build]\033[0m %s\n' "$*"; }
ok()   { printf '\033[0;32m[build]\033[0m %s\n' "$*"; }
warn() { printf '\033[0;33m[build]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[0;31m[build]\033[0m %s\n' "$*" >&2; exit "${2:-1}"; }
CLEANUP=(); cleanup() { local x; for x in "${CLEANUP[@]:-}"; do [ -n "$x" ] && rm -rf "$x"; done; }; trap cleanup EXIT

command -v jq >/dev/null || die "jq is required (brew install jq)."
# The project config is the nearest .onebox.json, from the app folder up: in
# a monorepo it sits at the repo root, not next to app.json.
PROJ_CFG=""; d="$PWD"
while :; do [ -f "$d/.onebox.json" ] && { PROJ_CFG="$d/.onebox.json"; break; }; [ "$d" = / ] && break; d="$(dirname "$d")"; done
cfg() {
  local f=(); [ -f ~/.config/onebox/config.json ] && f+=(~/.config/onebox/config.json); [ -n "$PROJ_CFG" ] && f+=("$PROJ_CFG")
  if [ ${#f[@]} -gt 0 ]; then jq -s 'reduce .[] as $x ({}; . * $x)' "${f[@]}" 2>/dev/null || echo '{}'; else echo '{}'; fi
}
c() { cfg | jq -r "$1 // empty"; }

# Read a secret by reference, the way CONFIG.md says ("Secrets"). Prints to
# stdout: only ever call it inside $(...) and put the result in a variable.
SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
secret() { "$SCRIPTS/secret.sh" "$1"; }

# ---- 1. Find the mobile project -------------------------------------------
[ -n "$DIR" ] && cd "$DIR"
has_app_config() { local f; for f in app.json app.config.js app.config.ts app.config.mjs app.config.cjs; do [ -f "$1/$f" ] && return 0; done; return 1; }
if ! has_app_config . || [ ! -f eas.json ]; then
  found="$(find . -maxdepth 3 -name eas.json -not -path '*/node_modules/*' | head -3)"
  die "Run this from the Expo app folder (the one with app.json/app.config and eas.json).${found:+ Found: $(echo $found)}"
fi
APP_DIR="$PWD"

# A stray app config ABOVE the app folder is dangerous. EAS reads the config of
# the folder it runs in and syncs capabilities to Apple. Run from a monorepo root
# whose app.json lacks a capability (Sign in with Apple, push) and EAS DISABLES it
# on the App ID, while printing a green tick. A root app.config.js that throws is
# the durable guard; a plain app.json there is a trap (EAS may recreate one).
d="$(dirname "$APP_DIR")"; top="$(git -C "$APP_DIR" rev-parse --show-toplevel 2>/dev/null || dirname "$(dirname "$d")")"
while [ "${#d}" -ge "${#top}" ] && [ "$d" != "/" ]; do
  for f in "$d"/app.json "$d"/app.config.js "$d"/app.config.ts; do
    [ -f "$f" ] || continue
    if grep -q "throw" "$f" 2>/dev/null; then continue; fi
    warn "Found $f above the app folder. If anyone runs eas from there, Apple capabilities can be turned off."
    warn "Replace it with an app.config.js that throws: throw new Error('Run Expo/EAS from <app folder>')."
  done
  d="$(dirname "$d")"
done

# ---- 2. Tools -----------------------------------------------------------------
# Use a global eas-cli. `npx eas-cli` has broken on some Node versions
# ("Cannot find module 'fdir'"). If eas times out on GraphQL calls (ETIMEDOUT with
# an empty reason) while curl to expo.dev works, try a different Node version for
# eas only; keep the project itself on the Node LTS that Expo supports.
command -v eas >/dev/null || die "eas-cli not found. Install it: npm install -g eas-cli"
say "eas-cli $(eas --version 2>/dev/null | head -1)"

MODE="$(c '.expo.buildMode')"; MODE="${MODE:-local}"
[ "$FORCE_CLOUD" = true ] && MODE=cloud
if [ "$MODE" = local ] && { [ "$(uname)" != Darwin ] || ! command -v xcodebuild >/dev/null; }; then
  warn "No Mac with Xcode here, so a local iOS build is impossible. Using the EAS cloud build."
  MODE=cloud
fi

# ---- 3. Expo login ------------------------------------------------------------
if ! eas whoami >/dev/null 2>&1; then
  REF="$(c '.expo.tokenRef')"; REF="${REF:-EXPO_TOKEN}"
  EXPO_TOKEN="$(secret "$REF" || true)"
  [ -n "$EXPO_TOKEN" ] || die "Not logged in to Expo. Run 'eas login', or set $REF (https://onebox.lokkesveen.com/guides/expo-eas.md)." 2
  export EXPO_TOKEN
  eas whoami >/dev/null 2>&1 || die "The Expo token did not work. Make a new one (https://onebox.lokkesveen.com/guides/expo-eas.md)." 2
fi
ok "Expo account: $(eas whoami 2>/dev/null | head -1)"

# ---- 4. eas.json sanity ---------------------------------------------------------
jq -e --arg p "$PROFILE" '.build[$p]' eas.json >/dev/null || die "eas.json has no build profile \"$PROFILE\"."
SUB="$(jq -c --arg p "$PROFILE" '.submit[$p].ios // {}' eas.json)"
n_key="$(echo "$SUB" | jq '[.ascApiKeyPath, .ascApiKeyId, .ascApiKeyIssuerId] | map(select(. != null)) | length')"
# eas submit ignores the EXPO_ASC_* env vars. It uses a local key only when all
# three fields are in the submit profile, refuses with some, and with none falls
# back to the key EAS stores on its servers, silently. A stale server key fails
# only after the submission waits in the queue, sometimes for an hour.
case "$n_key" in
  0) say "Submit uses the App Store Connect key stored on EAS (eas credentials). If you rotated your key, update it there too." ;;
  3) cfg_id="$(c '.apple.ascKeyId')"; eas_id="$(echo "$SUB" | jq -r '.ascApiKeyId')"
     if [ -n "$cfg_id" ] && [ "$cfg_id" != "$eas_id" ]; then
       die "eas.json submit.$PROFILE.ios.ascApiKeyId ($eas_id) is not the key in your config ($cfg_id). Fix one of them first."
     fi
     kp="$(echo "$SUB" | jq -r '.ascApiKeyPath')"; kp="${kp/#\~/$HOME}"
     [ -f "$kp" ] || die "eas.json ascApiKeyPath points at a missing file: $kp. (A literal ~ is not always expanded; use a full or relative path.)" ;;
  *) die "eas.json submit.$PROFILE.ios sets only some of ascApiKeyPath / ascApiKeyId / ascApiKeyIssuerId. Set all three or none." ;;
esac
if [ "$SUBMIT" = true ] && [ "$(echo "$SUB" | jq -r '.ascAppId // empty')" = "" ]; then
  warn "eas.json has no submit.$PROFILE.ios.ascAppId. A non-interactive submit may stop to ask for it. Find it with the appstore-connect skill (asc.mjs apps)."
fi

# ---- 5. Cloud path -------------------------------------------------------------
if [ "$MODE" = cloud ]; then
  warn "Cloud build: it runs on Expo's servers and counts against your plan's monthly builds."
  flags=(--platform ios --profile "$PROFILE")
  [ "$INTERACTIVE" = false ] && flags+=(--non-interactive)
  [ "$SUBMIT" = true ] && flags+=(--auto-submit)
  exec eas build "${flags[@]}"
fi

# ---- 6. Local path: checks that each cost someone a failed build ------------------
if [ -n "${SSH_CONNECTION:-}" ]; then
  die "This shell is an SSH session. Code signing fails there (errSecInternalComponent, or a keychain prompt nobody can answer). Run this in Terminal on the Mac itself, or use --cloud." 3
fi
xv="$(xcodebuild -version 2>/dev/null | awk '/^Xcode/{print $2}')"; xmajor="${xv%%.*}"
say "Xcode $xv"
# Checked 2026-09-28 at developer.apple.com/news/upcoming-requirements:
# since 2026-04-28 uploads must be built with Xcode 26+ and an iOS 26 SDK.
if [ -n "$xmajor" ] && [ "$xmajor" -lt 26 ]; then
  warn "App Store Connect requires Xcode 26 or later for uploads. This build will be rejected at upload. See https://onebox.lokkesveen.com/guides/xcode.md."
fi
# The Expo SDK decides the Xcode (guides/xcode.md, "Which Xcode for your Expo SDK").
sdk="$(node -p 'String((require("./package.json").dependencies||{}).expo||"").replace(/^[^0-9]*/,"").split(".")[0]' 2>/dev/null || true)"
case "$sdk" in ''|*[!0-9]*) sdk="" ;; esac
xminor="$(printf '%s' "$xv" | cut -d. -f2)"; case "$xminor" in ''|*[!0-9]*) xminor=0 ;; esac
XGUIDE="See https://onebox.lokkesveen.com/guides/xcode.md, \"Which Xcode for your Expo SDK\"."
if [ -n "$sdk" ] && [ -n "$xmajor" ]; then
  if [ "$sdk" -ge 56 ] && [ "$xmajor" -eq 26 ] && [ "$xminor" -lt 4 ]; then
    die "Expo SDK $sdk needs Xcode 26.4 or later; this is $xv. $XGUIDE"
  elif [ "$xmajor" -ge 27 ] && [ "$sdk" -le 56 ]; then
    die "Xcode $xv builds with the iOS 27 SDK, and Expo SDK $sdk has no scene support: the app would not launch on iOS 27. Build with Xcode 26.4 or later (sudo xcode-select -s <that Xcode>), or upgrade the SDK. $XGUIDE"
  elif [ "$xmajor" -ge 27 ] && [ "$sdk" -eq 57 ] && ! grep -qsE 'enableSceneSupport"?[[:space:]]*:[[:space:]]*true' app.json app.config.*; then
    die "Xcode $xv builds with the iOS 27 SDK. Expo SDK 57 then needs scene support turned on (expo-build-properties, ios.enableSceneSupport), or the app does not launch on iOS 27. $XGUIDE"
  fi
fi

# CocoaPods dies on "Unicode Normalization not appropriate for ASCII-8BIT" when
# the shell has no UTF-8 locale (cron, CI, agents). The error you then read comes
# later and points elsewhere.
case "${LC_ALL:-${LANG:-}}" in *UTF-8|*utf8|*UTF8) ;; *) export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 ;; esac
command -v pod >/dev/null || die "CocoaPods not found. Install it: brew install cocoapods (https://onebox.lokkesveen.com/guides/xcode.md)."
command -v fastlane >/dev/null || die "fastlane not found. eas build --local needs it: brew install fastlane (https://onebox.lokkesveen.com/guides/xcode.md)."
# macOS system Ruby 2.6 cannot parse Expo's precompiled-module configs. pod install
# then "succeeds" with a WARNING, and the app installs and dies at launch, or a
# native module is silently left out.
if ! pod --version >/dev/null 2>&1 || ! ruby -e 'exit((RUBY_VERSION.split(".").map(&:to_i) <=> [2,7,0]) >= 0)' 2>/dev/null; then
  warn "CocoaPods may run on Ruby $(ruby -e 'print RUBY_VERSION' 2>/dev/null || echo '?'). Expo needs Ruby 2.7+. Homebrew's cocoapods brings its own Ruby."
fi

# Without a team ID the credentials step stops on an "Apple Team ID:" prompt that
# a non-interactive run cannot answer. Do NOT guess EXPO_APPLE_TEAM_TYPE: a wrong
# value (e.g. IN_HOUSE) makes Apple answer 403 about program membership.
TEAM="$(c '.apple.teamId')"
if [ -n "$TEAM" ]; then export EXPO_APPLE_TEAM_ID="$TEAM" EXPO_ASC_TEAM_ID="$TEAM"; fi

# Give eas the local App Store Connect key, so it does not fall back to a stale
# copy on EAS servers (that shows up as "Apple 401 detected", which looks like a
# login problem and is not one).
KID="$(c '.apple.ascKeyId')"; ISS="$(c '.apple.ascIssuerId')"; KPATH="$(c '.apple.ascKeyPath')"; KREF="$(c '.apple.ascKeyRef')"
if [ -n "$KID" ] && [ -n "$ISS" ]; then
  if [ -n "$KPATH" ]; then
    KPATH="${KPATH/#\~/$HOME}"   # eas does not expand a literal ~ and reports ENOENT
    [ -f "$KPATH" ] || die "apple.ascKeyPath points at a missing file: $KPATH"
  elif [ -n "$KREF" ]; then
    # eas needs a file path. Write the key to a private temp file for this run
    # only, and delete it on exit.
    KDIR="$(mktemp -d)"; KPATH="$KDIR/AuthKey_$KID.p8"; CLEANUP+=("$KDIR")
    # A key kept on one line in .env or the environment has \n for its line
    # breaks. asc.mjs turns them back into line breaks, so do the same here.
    ( umask 077; { secret "$KREF"; echo; } | perl -pe 's/\\n/\n/g' > "$KPATH" ) || die "could not read apple.ascKeyRef ($KREF)."
    openssl pkey -noout -in "$KPATH" 2>/dev/null || die "apple.ascKeyRef did not resolve to a readable .p8 key."
  fi
  if [ -n "$KPATH" ]; then export EXPO_ASC_API_KEY_PATH="$KPATH" EXPO_ASC_KEY_ID="$KID" EXPO_ASC_ISSUER_ID="$ISS"; fi
fi

# ---- 7. One build per app at a time -------------------------------------------
# Two agents building the same app upload two builds, with build numbers that
# do not match their upload order. Key the lock on the bundle id, not the folder,
# so two worktrees of one app share it.
# An app with only app.config.* has no app.json; that is fine (|| true).
APP_KEY="$(jq -r '.expo.ios.bundleIdentifier // empty' app.json 2>/dev/null || true)"
APP_KEY="${APP_KEY:-$(basename "$APP_DIR")}"
LOCK="${TMPDIR:-/tmp}/onebox-build-$APP_KEY.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  other="$(cat "$LOCK/pid" 2>/dev/null)"
  if [ -n "$other" ] && kill -0 "$other" 2>/dev/null; then
    die "Another build of $APP_KEY is running (pid $other, $(cat "$LOCK/dir" 2>/dev/null)). Wait for it, or stop it first."
  fi
  warn "Removing a stale lock from pid ${other:-?}."; rm -rf "$LOCK"; mkdir "$LOCK"
fi
echo $$ > "$LOCK/pid"; echo "$APP_DIR" > "$LOCK/dir"; CLEANUP+=("$LOCK")

# ---- 8. Build ------------------------------------------------------------------
mkdir -p build
OUT="build/ios-$PROFILE-$(date +%Y%m%d-%H%M%S).ipa"
say "Building locally, profile $PROFILE. This takes 10-20 minutes."
flags=(--platform ios --profile "$PROFILE" --local --output "$OUT")
[ "$INTERACTIVE" = false ] && flags+=(--non-interactive)
if ! eas build "${flags[@]}"; then
  warn "Build failed. Common causes are in references/pitfalls.md. A new app target (widget, share extension)"
  warn "needs one --interactive run so EAS can create its credentials."
  exit 1
fi
ok "Built $OUT"

# ---- 9. Upload ------------------------------------------------------------------
[ "$SUBMIT" = true ] || { ok "Skipping upload. Send it later: xcrun altool --upload-app -f $OUT -t ios --apiKey <key id> --apiIssuer <issuer id>"; exit 0; }
if [ -z "$UPLOAD" ]; then
  if [ -z "$TF_GROUP" ] && [ -n "$KID" ] && [ -n "$ISS" ] && [ -n "${KPATH:-}" ] && xcrun --find altool >/dev/null 2>&1; then UPLOAD=altool; else UPLOAD=eas; fi
fi
if [ "$UPLOAD" = altool ]; then
  [ -n "$KID" ] && [ -n "$ISS" ] && [ -n "${KPATH:-}" ] || die "--upload altool needs apple.ascKeyId, apple.ascIssuerId and a key file in the onebox config."
  # altool looks for AuthKey_<key id>.p8 in API_PRIVATE_KEYS_DIR.
  ADIR="$(mktemp -d)"; CLEANUP+=("$ADIR"); ( umask 077; cp "$KPATH" "$ADIR/AuthKey_$KID.p8" )
  say "Uploading to App Store Connect with altool..."
  LOG="build/upload-$(date +%Y%m%d-%H%M%S).log"
  set +e; API_PRIVATE_KEYS_DIR="$ADIR" xcrun altool --upload-app -f "$OUT" -t ios --apiKey "$KID" --apiIssuer "$ISS" 2>&1 | tee "$LOG"; rc=${PIPESTATUS[0]}; set -e
  if [ "$rc" -eq 0 ] && grep -q "UPLOAD SUCCEEDED" "$LOG"; then
    ok "Uploaded. Apple processes it in 5 to 30 minutes: node <appstore-connect>/scripts/asc.mjs builds --app $APP_KEY"
    exit 0
  fi
  die "Upload failed (log: $LOG). Fix the cause and upload the same file again; do not rebuild."
fi
say "Submitting to App Store Connect with eas submit..."
LOG="build/submit-$(date +%Y%m%d-%H%M%S).log"
sflags=(--platform ios --path "$OUT")
jq -e --arg p "$PROFILE" '.submit[$p]' eas.json >/dev/null 2>&1 && sflags+=(--profile "$PROFILE")
[ "$INTERACTIVE" = false ] && sflags+=(--non-interactive)
[ -n "$TF_GROUP" ] && sflags+=(--groups "$TF_GROUP")
set +e; eas submit "${sflags[@]}" 2>&1 | tee "$LOG"; rc=${PIPESTATUS[0]}; set -e
# The exit code of eas submit is not the answer. Once it prints "Scheduled iOS
# submission" the upload is queued on EAS; the client can still die afterwards
# while polling. Do NOT resubmit: a second upload of the same build number is
# rejected as a duplicate.
if grep -q "Scheduled iOS submission" "$LOG"; then
  ok "Submission scheduled. Check App Store Connect, not this exit code: node <appstore-connect>/scripts/asc.mjs builds --app <bundleId>"
  exit 0
fi
[ "$rc" -eq 0 ] || die "Submit failed (log: $LOG). Do not rebuild just to resubmit: eas submit --platform ios --path $OUT"
ok "Submitted."
