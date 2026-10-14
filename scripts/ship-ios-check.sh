#!/usr/bin/env bash
# The ship-ios scripts must not act on a mistyped flag, must not lose a backup,
# must not act on a similar bundle id, and must not hide a LAN URL behind a
# string like 'image/*'. A fetch stub stands in for Apple; nothing leaves this
# machine.
#   bash scripts/ship-ios-check.sh
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
sk="$here/plugins/ship-ios/skills"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/home" "$tmp/shots" "$tmp/app"; printf 'x' > "$tmp/shots/01.png"
export HOME="$tmp/home" LOG="$tmp/log" BUNDLE=com.example.myapp
fail() { echo "ship-ios-check: $*" >&2; exit 1; }

# A throwaway API key, and a fetch that logs "METHOD path" and answers from memory.
export ASC_KEY_ID=KEY1 ASC_ISSUER_ID=00000000-0000-0000-0000-000000000000
ASC_PRIVATE_KEY="$(node -e "console.log(require('crypto').generateKeyPairSync('ec',{namedCurve:'P-256'}).privateKey.export({type:'pkcs8',format:'pem'}))")"
export ASC_PRIVATE_KEY
cat > "$tmp/stub.mjs" <<'JS'
import fs from 'fs';
const res = (json, status = 200) => ({ ok: status < 300, status, text: async () => json == null ? '' : typeof json === 'string' ? json : JSON.stringify(json),
  arrayBuffer: async () => new TextEncoder().encode('PNG').buffer });
globalThis.fetch = async (url, o = {}) => {
  const u = new URL(url), m = (o.method || 'GET').toUpperCase(), p = u.pathname;
  fs.appendFileSync(process.env.LOG, `${m} ${p}\n`);
  const loc = p.match(/loc-(\w+)\/appScreenshotSets$/), set = p.match(/set-(\w+)\/appScreenshots$/);
  if (u.hostname === 'cdn.example' || u.hostname === 'upload.example') return res('x');
  if (m === 'DELETE') return res(null, 204);
  if (m === 'PATCH') return res({ data: {} });
  if (m === 'POST') return res({ data: { id: 'new', attributes: { uploadOperations: [{ url: 'https://upload.example/p', method: 'PUT', requestHeaders: [], offset: 0, length: 3 }] } } }, 201);
  if (p === '/v1/apps') return res({ data: [{ id: '1', attributes: { bundleId: process.env.BUNDLE, name: 'Myapp' } }] });
  if (p === '/v1/apps/1/appStoreVersions') return res({ data: [{ id: 'v1', attributes: { versionString: '1.1', appStoreState: 'PREPARE_FOR_SUBMISSION' } }] });
  if (p.endsWith('/appStoreVersionLocalizations')) return res({ data: [{ id: 'loc-en', attributes: { locale: 'en-US' } }, { id: 'loc-de', attributes: { locale: 'de-DE' } }] });
  if (loc) return res({ data: [{ id: 'set-' + loc[1], attributes: { screenshotDisplayType: 'APP_IPHONE_67' }, relationships: { appScreenshots: { data: [{ id: loc[1] }] } } }] });
  if (set) return res({ data: [{ id: set[1], attributes: { fileName: '01-hero.png', assetDeliveryState: { state: 'COMPLETE' },
    imageAsset: { templateUrl: 'https://cdn.example/{w}x{h}.{f}', width: 1, height: 1 } } }] });
  return res({ data: [] });
};
JS
# run <exit code var> <script> <args...>: the output goes to $out, the requests to $LOG.
run() { : > "$LOG"; local st=0; out="$(node --import "$tmp/stub.mjs" "${@:2}" 2>&1)" || st=$?; printf -v "$1" %s "$st"; }

asc="$sk/appstore-connect/scripts/asc.mjs"; shots="$sk/app-store-screenshots/scripts/asc.mjs"

run rc "$asc" expire 1 --dryrun
[ "$rc" = 2 ] && [ ! -s "$LOG" ] || fail "expire --dryrun must refuse and send nothing (exit $rc): $out"
run rc "$asc" expire 1 --dry-run
[ "$rc" = 0 ] && ! grep -q PATCH "$LOG" || fail "expire --dry-run must send no PATCH (exit $rc): $out"
run rc "$shots" replace --app "$BUNDLE" --dir "$tmp/shots" --dryrun
[ "$rc" = 2 ] && [ ! -s "$LOG" ] || fail "replace --dryrun must refuse and send nothing (exit $rc): $out"

BUNDLE=com.example.myapp.staging run rc "$asc" submit --app com.example.myapp --dry-run
[ "$rc" != 0 ] && ! grep -q appStoreVersions "$LOG" || fail "submit must refuse a similar bundle id (exit $rc): $out"

# Two locales, same file names: both backups stay.
for l in en-US de-DE; do
  run rc "$shots" replace --app "$BUNDLE" --dir "$tmp/shots" --locale "$l" --backup "$tmp/bk"
  [ "$rc" = 0 ] || fail "replace $l failed (exit $rc): $out"
done
n="$(find "$tmp/bk" -name '*.png' | wc -l)"
[ "$n" -eq 2 ] || fail "expected 2 screenshot backups, found $n"

# A string with /* in it must not hide the LAN URL behind it.
cat > "$tmp/app/app.json" <<'JSON'
{ "expo": { "name": "Myapp", "version": "1.0.0", "ios": { "bundleIdentifier": "com.mine.myapp" } } }
JSON
cat > "$tmp/app/App.tsx" <<'TSX'
const types = ['image/*'];
const API = 'http://192.168.1.20:8080';
/** doc */
export default function App() { return null; }
TSX
out="$(node "$sk/app-store-ready/scripts/check.mjs" "$tmp/app" --no-expo --offline 2>&1)" || true
echo "$out" | grep -Eq 'BLOCKED +backend-url +Local/LAN' || fail "check.mjs did not report the LAN URL: $out"

echo "ship-ios-check: ok"
