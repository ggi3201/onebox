#!/usr/bin/env bash
# Writes src/data/example-plan.md: what /start:plan makes for a sample Expo
# app. Run it after a change to the catalog or plan.mjs:
#   bash site/scripts/example-plan.sh
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
plan="$here/../plugins/start/skills/plan/scripts"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/apps/mobile"
cat > "$tmp/apps/mobile/package.json" <<'JSON'
{ "name": "mobile", "private": true, "dependencies": { "expo": "~55.0.0", "react-native": "0.83.0", "expo-dev-client": "~6.0.0" } }
JSON
cat > "$tmp/apps/mobile/app.json" <<'JSON'
{ "expo": { "name": "My App", "slug": "my-app", "version": "1.0.0", "ios": { "bundleIdentifier": "com.example.myapp" } } }
JSON
cat > "$tmp/apps/mobile/eas.json" <<'JSON'
{ "cli": { "appVersionSource": "remote" }, "build": { "development": { "developmentClient": true, "distribution": "internal" }, "preview": { "distribution": "internal" }, "production": { "autoIncrement": true } } }
JSON
(cd "$tmp" && git init -q)
# A fake HOME, so the page never shows the onebox config of the Mac that ran this.
HOME="$tmp" node "$plan/detect.mjs" "$tmp" > "$tmp/detect.json"
node "$plan/plan.mjs" write --repo "$tmp" --detect "$tmp/detect.json" --out EXAMPLE.md \
  --answers '{"stage":"expo","backend":"box","login":"apple","paid":"subs","site":"yes","ai":["chat"],"remote":"yes"}' >/dev/null
# Drop the machine-readable first line; the page does not need it.
tail -n +2 "$tmp/EXAMPLE.md" > "$here/src/data/example-plan.md"
echo "wrote src/data/example-plan.md"
