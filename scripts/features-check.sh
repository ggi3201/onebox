#!/usr/bin/env bash
# /start:check-features must give the same answer for the same files. This
# makes a small repo with a plan and two flows, and walks each state:
# missing, unproven, failed, done, stale. It also checks that a second
# `sync` keeps the user's edits byte for byte.
#   bash scripts/features-check.sh
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
plan="$here/plugins/start/skills/plan/scripts/plan.mjs"
detect="$here/plugins/start/skills/plan/scripts/detect.mjs"
feat="$here/plugins/start/skills/check-features/scripts/features.mjs"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/home" "$tmp/repo/src/notes"
# A fake HOME, so the onebox config of this Mac plays no part.
export HOME="$tmp/home" ONEBOX_DETECT_NO_RUN=1
cd "$tmp/repo"
echo '{"name":"myapp"}' > package.json
echo 'export const notes = [];' > src/notes/notes.ts

fail() { echo "features-check: $*" >&2; exit 1; }
state() { node "$feat" check 2>/dev/null | node -e 'const r=JSON.parse(require("fs").readFileSync(0));console.log(r.features.map(f=>f.id+"="+f.state).join(" "))' || true; }
expect() { local got; got="$(state)"; [ "$got" = "$1" ] || fail "expected: $1
got:      $got"; }

node "$plan" write --answers '{"stage":"idea","login":"apple","backend":"none"}' --repo . >/dev/null
node "$feat" sync --add '["Write a note", "Delete a note"]' >/dev/null
grep -q 'feature:sign-in-with-apple' FEATURES.md || fail "sync did not copy Sign in with Apple from the plan"
grep -q 'feature:ask-for-a-rating' FEATURES.md || fail "sync did not copy the rating prompt from the plan"

# The user edits a line, deletes two plan features and adds a note. A
# second sync keeps all of it: the deleted lines do not come back.
perl -pi -e 's/^- Write a note /- Write a note, with a title /' FEATURES.md
perl -ni -e 'print unless /feature:(ask-for-a-rating|revenuecat)/' FEATURES.md
printf '\nMy own note.\n' >> FEATURES.md
before="$(cat FEATURES.md)"
node "$feat" sync --add '["Write a note"]' >/dev/null
[ "$(cat FEATURES.md)" = "$before" ] || fail "a second sync changed the file"

expect "write-note=missing delete-note=missing sign-in-with-apple=missing"

cat > src/notes/notes.flow.md <<'MD'
# Notes: write and delete

Feature: src/notes/
Covers: write-note, delete-note

1. Tap "New note".
   Expect: an empty note.
MD
cat > src/notes/sign-in.flow.md <<'MD'
# Sign in

Feature: src/notes/notes.ts, /api/session
Covers: sign-in-with-apple

1. Tap "Sign in".
   Expect: the notes list.
MD
expect "write-note=unproven delete-note=unproven sign-in-with-apple=unproven"

node "$feat" record --flow src/notes/notes.flow.md --fail --step 1 >/dev/null
node "$feat" record --flow src/notes/sign-in.flow.md --pass >/dev/null
expect "write-note=failed delete-note=failed sign-in-with-apple=done"
say="$(node "$feat" check 2>&1 >/dev/null || true)"
case "$say" in *"failed at step 1"*) ;; *) fail "the nudge does not name the failed step: $say" ;; esac

node "$feat" record --flow src/notes/notes.flow.md --pass >/dev/null
expect "write-note=done delete-note=done sign-in-with-apple=done"
node "$feat" check >/dev/null 2>&1 || fail "check exits non-zero when every feature is done"
node "$detect" . > "$tmp/detect.json"
grep -q '"skill:start/check-features": "all 3 features' "$tmp/detect.json" || fail "detection does not tick the step when every feature is done"

# A change in the code a flow names makes its pass stale. A change elsewhere does not.
echo 'export const other = 1;' > other.ts
expect "write-note=done delete-note=done sign-in-with-apple=done"
echo 'export const notes = [1];' > src/notes/notes.ts
expect "write-note=stale delete-note=stale sign-in-with-apple=stale"
if node "$feat" check >/dev/null 2>&1; then fail "check exits zero with stale features"; fi
node "$detect" . > "$tmp/detect.json"
grep -q '"skill:start/check-features": "0 of 3 features proven' "$tmp/detect.json" || fail "detection does not see the stale features"
echo "features-check: ok"
