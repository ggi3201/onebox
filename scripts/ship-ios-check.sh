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
// The open review submission, when SUBMISSION names its state. it2 has no version: a live
// submission also holds items that show no relationship in the public API.
const version = i => ({ appStoreVersion: { data: i ? { type: 'appStoreVersions', id: 'v1' } : null } });
const items = [{ id: 'it1', attributes: { state: 'READY_FOR_REVIEW' }, relationships: version(true) }];
if (process.env.SUBMISSION === 'UNRESOLVED_ISSUES') {
  items[0].attributes.state = 'REJECTED';
  items.push({ id: 'it2', attributes: { state: 'REJECTED' }, relationships: version(false) }, { id: 'it3', attributes: { state: 'READY_FOR_REVIEW' }, relationships: version(false) });
}
const notReady = 'Version is not ready to be submitted yet, please try again later';
globalThis.fetch = async (url, o = {}) => {
  const u = new URL(url), m = (o.method || 'GET').toUpperCase(), p = u.pathname;
  fs.appendFileSync(process.env.LOG, `${m} ${p}\n`);
  if (process.env.SUBMISSION) {
    const attrs = o.body ? JSON.parse(o.body).data.attributes : {};
    if (m === 'GET' && p === '/v1/appStoreVersions/v1') return res({ data: { id: 'v1', attributes: { versionString: '1.1', appStoreState: 'PREPARE_FOR_SUBMISSION' }, relationships: { build: { data: { type: 'builds', id: 'b1' } } } },
      included: [{ type: 'builds', id: 'b1', attributes: { usesNonExemptEncryption: false } }] });
    if (m === 'GET' && p === '/v1/reviewSubmissions') return res({ data: [{ id: 's1', attributes: { state: process.env.SUBMISSION } }] });
    if (m === 'GET' && p === '/v1/reviewSubmissions/s1/items') return res({ data: items });
    if (m === 'PATCH' && p.startsWith('/v1/reviewSubmissionItems/')) {
      const item = items.find(i => p.endsWith('/' + i.id));
      if (attrs.resolved === true) item.attributes.state = 'READY_FOR_REVIEW';
      return res({ data: item });
    }
    // What Apple does: `submitted` answers 409 while an item is REJECTED, however long you wait.
    if (m === 'PATCH' && p === '/v1/reviewSubmissions/s1' && attrs.submitted === true && (process.env.APPLE_REFUSES || items.some(i => i.attributes.state === 'REJECTED')))
      return res({ errors: [{ status: '409', code: 'STATE_ERROR.ENTITY_STATE_INVALID', detail: process.env.APPLE_REFUSES || notReady }] }, 409);
  }
  const loc = p.match(/loc-(\w+)\/appScreenshotSets$/), set = p.match(/set-(\w+)\/appScreenshots$/);
  if (u.hostname === 'cdn.example' || u.hostname === 'upload.example') return res('x');
  if (m === 'DELETE') return res(null, 204);
  if (m === 'PATCH') return res({ data: {} });
  if (m === 'POST') return res({ data: { id: 'new', attributes: { uploadOperations: [{ url: 'https://upload.example/p', method: 'PUT', requestHeaders: [], offset: 0, length: 3 }] } } }, 201);
  if (p === '/v1/apps') return res({ data: [{ id: '1', attributes: { bundleId: process.env.BUNDLE, name: 'Myapp' } }] });
  if (p === '/v1/apps/1/appInfos') return res({ data: [{ id: 'i1', attributes: { state: 'READY_FOR_DISTRIBUTION', appStoreState: 'READY_FOR_SALE' } },
    { id: 'i2', attributes: { state: 'PENDING_RELEASE', appStoreState: 'PENDING_DEVELOPER_RELEASE' } }] });
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

# Resubmit after a rejection: each rejected item is marked resolved, then the submission is sent.
want="$(printf 'PATCH /v1/reviewSubmissionItems/%s\n' it1 it2; echo 'PATCH /v1/reviewSubmissions/s1')"
SUBMISSION=UNRESOLVED_ISSUES run rc "$asc" submit --app "$BUNDLE" --dry-run
[ "$rc" = 0 ] && ! grep -q '^PATCH' "$LOG" || fail "submit --dry-run on a rejected version must send no PATCH (exit $rc): $out"
[ "$(echo "$out" | sed -n 's/^dry run: //p')" = "$want" ] || fail "submit --dry-run on a rejected version must show the item PATCHes, then the submit: $out"
echo "$out" | grep -q '"resolved": true' || fail "submit --dry-run on a rejected version must show resolved: true: $out"
SUBMISSION=UNRESOLVED_ISSUES run rc "$asc" submit --app "$BUNDLE"
[ "$rc" = 0 ] && [ "$(grep '^PATCH' "$LOG")" = "$want" ] || fail "submit on a rejected version sent the wrong requests (exit $rc): $out / $(cat "$LOG")"
echo "$out" | grep -q 'sent to App Review' || fail "submit on a rejected version did not report the send: $out"

# Apple still refuses: one try, and the message names the web step and the page.
not_ready='Version is not ready to be submitted yet, please try again later'
SUBMISSION=UNRESOLVED_ISSUES APPLE_REFUSES="$not_ready" run rc "$asc" submit --app "$BUNDLE"
[ "$rc" != 0 ] && [ "$(grep -c '^PATCH /v1/reviewSubmissions/' "$LOG")" = 1 ] || fail "a refused resubmit must fail after one try (exit $rc): $out / $(cat "$LOG")"
echo "$out" | grep -q 'Update Review' && echo "$out" | grep -q '/apps/1/distribution/ios/version/inflight' || fail "a refused resubmit must name Update Review and the page: $out"
if echo "$out" | grep -q 'sent to App Review'; then fail "a refused resubmit must not report a send: $out"; fi

# A draft has nothing to resolve. Any other refusal keeps Apple's own message, without the web step.
SUBMISSION=READY_FOR_REVIEW run rc "$asc" submit --app "$BUNDLE"
[ "$rc" = 0 ] && ! grep -q '^PATCH /v1/reviewSubmissionItems' "$LOG" || fail "submit on a draft must not touch its items (exit $rc): $out"
SUBMISSION=UNRESOLVED_ISSUES APPLE_REFUSES='The copyright is missing' run rc "$asc" submit --app "$BUNDLE"
if [ "$rc" = 0 ] || ! echo "$out" | grep -q 'The copyright is missing' || echo "$out" | grep -q 'Update Review'; then fail "another refusal must show Apple's message, not the web step (exit $rc): $out"; fi

# An app info approved and waiting for release is locked: no PATCH to it.
run rc "$asc" listing --app "$BUNDLE"
echo "$out" | grep -q 'app info (not editable now' || fail "listing called a pending-release app info editable: $out"

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

# A broken DEVELOPER_DIR: build.sh stops and names it (xcode-select cannot fix it).
mkdir -p "$tmp/bin" "$tmp/eas"; cd "$tmp/eas"; echo '{"expo":{}}' > app.json; echo '{"build":{}}' > eas.json
printf '#!/bin/sh\necho Darwin\n' > "$tmp/bin/uname"; printf '#!/bin/sh\necho eas-cli/0\n' > "$tmp/bin/eas"; printf '#!/bin/sh\nexit 1\n' > "$tmp/bin/xcodebuild"
chmod +x "$tmp/bin/"*
out="$(PATH="$tmp/bin:$PATH" DEVELOPER_DIR=/nowhere bash "$sk/expo-local-build/scripts/build.sh" --skip-submit 2>&1)" && fail "build.sh went on with a broken DEVELOPER_DIR"
echo "$out" | grep -q 'DEVELOPER_DIR is set to /nowhere' || fail "build.sh did not name DEVELOPER_DIR: $out"
cd "$here"

# A key cut off after its first line (a multi-line value in .env) stops with the fix.
mkdir -p "$HOME/.config/onebox"; echo '{"apple":{"ascKeyId":"K","ascIssuerId":"I","ascKeyRef":"ASC_CUT"}}' > "$HOME/.config/onebox/config.json"
for s in "$asc apps" "$shots list"; do
  out="$(env -u ASC_KEY_ID ASC_CUT="$(echo "$ASC_PRIVATE_KEY" | head -2)" node $s 2>&1)" && fail "$s accepted a cut-off key"
  echo "$out" | grep -q 'END PRIVATE KEY' || fail "$s did not explain the cut-off key: $out"
done
rm "$HOME/.config/onebox/config.json"

# render.cjs fails on a missing font or CSS background, not only on a missing <img>.
# Needs playwright, sharp and Chrome (render.cjs, line 11); skipped without them.
if NODE_PATH="${NODE_DEPS:-}" node -e "require('playwright'); require('sharp')" 2>/dev/null; then
  r="$sk/app-store-screenshots/scripts/render.cjs"; mkdir -p "$tmp/set/source"
  page() { printf '<html><head><style>body{margin:0} .slide{width:440px;height:956px;background:#123} %s</style></head><body><div class="slide" data-name="a">%s</div></body></html>' "$1" "$2" > "$tmp/set/source/index.html"; }
  page '' 'ok'; node "$r" "$tmp/set" >/dev/null 2>&1 || fail "render.cjs failed on a page with nothing missing"
  page '@font-face{font-family:X;src:url(nope.woff2)} .slide{font-family:X}' 'text'
  out="$(node "$r" "$tmp/set" 2>&1)" && fail "render.cjs passed with a missing font"
  echo "$out" | grep -q 'nope.woff2' || fail "render.cjs did not name the missing font: $out"
  page '.slide{background:url(nope.png)}' ''
  out="$(node "$r" "$tmp/set" 2>&1)" && fail "render.cjs passed with a missing background image"
  echo "$out" | grep -q 'nope.png' || fail "render.cjs did not name the missing background: $out"
else echo "ship-ios-check: render.cjs check skipped (no playwright/sharp; set NODE_DEPS)"; fi

echo "ship-ios-check: ok"
