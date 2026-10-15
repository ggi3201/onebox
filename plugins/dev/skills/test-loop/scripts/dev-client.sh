#!/usr/bin/env bash
# Put this checkout's dev client on a simulator without a native build when
# one with the same native inputs was built before, then open it on Metro.
#
#   dev-client.sh <udid> <metro port>      run in the Expo app folder
#
# The cache key is the Expo fingerprint (every native input) plus the Xcode
# build. A hit installs the cached .app (seconds). A miss builds once with
# `expo run:ios --no-bundler` and copies the installed .app into the cache.
# The cache keeps the last 3 builds per app, in ~/Library/Caches/onebox.
# Start Metro on the port first; this script does not.
set -euo pipefail
U="${1:?usage: dev-client.sh <udid> <metro port>}"; P="${2:?usage: dev-client.sh <udid> <metro port>}"

BUNDLE="$(npx expo config --type public --json 2>/dev/null | jq -r '.ios.bundleIdentifier // empty')"
[ -n "$BUNDLE" ] || { echo "No ios.bundleIdentifier. Run this in the Expo app folder." >&2; exit 2; }
CLI="$(dirname "$(node -p "require.resolve('@expo/fingerprint/package.json', { paths: ['.'] })")")/bin/cli.js"
FP="$(node "$CLI" fingerprint:generate . | jq -r .hash)"
XC="$(xcodebuild -version | awk '/Build version/{print $3}')"
ROOT="$HOME/Library/Caches/onebox/dev-client/$BUNDLE"; C="$ROOT/${FP:0:16}-$XC"

xcrun simctl boot "$U" 2>/dev/null || true
if [ -d "$C" ]; then
  echo "Cache hit ${FP:0:12} (Xcode $XC): installing, no build."
  xcrun simctl install "$U" "$C"/*.app
else
  echo "Cache miss ${FP:0:12} (Xcode $XC): building once."
  npx expo run:ios --device "$U" --no-bundler   # no --port: the launch below picks it
  mkdir -p "$C.tmp"; cp -R "$(xcrun simctl get_app_container "$U" "$BUNDLE" app)" "$C.tmp/"; mv "$C.tmp" "$C"
  # ponytail: keeps the 3 newest builds per app; raise it if branches flip native deps often.
  ls -dt "$ROOT"/*/ | tail -n +4 | while read -r old; do rm -rf "$old"; done
fi
# --initialUrl opens Metro directly; `simctl openurl` stops at an "Open in ...?" prompt.
xcrun simctl terminate "$U" "$BUNDLE" 2>/dev/null || true
xcrun simctl launch "$U" "$BUNDLE" --initialUrl "http://localhost:$P"
