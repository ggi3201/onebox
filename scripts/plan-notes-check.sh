#!/usr/bin/env bash
# A re-run of /start:plan must keep the user's own text byte for byte,
# blank lines too. This writes a plan, adds notes with blank lines, and runs
# `plan.mjs write` twice. Both runs must print "unchanged".
#   bash scripts/plan-notes-check.sh
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
plan="$here/plugins/start/skills/plan/scripts/plan.mjs"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/repo" "$tmp/home"
# A fake HOME, so the onebox config of this Mac plays no part.
export HOME="$tmp/home"
# No tool checks in detection: they mean nothing with a fake HOME.
export ONEBOX_DETECT_NO_RUN=1
node "$plan" write --answers '{"stage":"idea"}' --repo "$tmp/repo" >/dev/null

# Notes under an item and in the Notes section, with one and two blank lines.
node - "$tmp/repo/PLAN.md" <<'JS'
const fs = require("fs");
const f = process.argv[2];
const lines = fs.readFileSync(f, "utf8").split("\n");
// After the first item and its detected/found line, before the next item.
let i = lines.findIndex((l) => /^- \[[ x]\] .*<!-- (guide|skill):\S+ -->$/.test(l));
if (i < 0) { console.error("no item in the plan"); process.exit(1); }
while (/^ {2}- (detected|likely done|found): /.test(lines[i + 1])) i++;
lines.splice(i + 1, 0, "  My note under an item.", "", "  A second paragraph, after a blank line.", "");
let t = lines.join("\n");
t += "\nFirst note, after a blank line.\n\nSecond note.\n\n\nThird note, after two blank lines.\n";
// A code fence: "```" is also one of the planner's own lines, under Install.
t += "\n```bash\neas build --local\n```\n";
fs.writeFileSync(f, t);
JS
cp "$tmp/repo/PLAN.md" "$tmp/expected.md"

fail=0
for run in 1 2; do
  out="$(node "$plan" write --repo "$tmp/repo" | head -n 1)"
  case "$out" in
    *": unchanged."*) echo "run $run: $out" ;;
    *) echo "run $run: expected \"unchanged\", got: $out"; fail=1 ;;
  esac
done
if ! diff -u "$tmp/expected.md" "$tmp/repo/PLAN.md"; then
  echo "FAIL: the re-run changed the user's text (diff above)"; fail=1
fi
[ "$fail" = 0 ] && echo "ok: notes kept byte for byte"
exit "$fail"
