#!/usr/bin/env bash
# A re-run of /start:plan must keep the user's own text byte for byte,
# blank lines too, and their ticks. This writes a plan, adds notes (some in
# the planner's own shapes), ticks and unticks, and runs `plan.mjs write`
# twice. Both runs must print "unchanged". Then the same for a converted plan.
#   bash scripts/plan-notes-check.sh
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
plan="$here/plugins/start/skills/plan/scripts/plan.mjs"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/repo"
# A fake HOME, so the onebox config of this Mac plays no part. Its team ID
# makes detection tick the Apple Developer item, for the user to untick.
export HOME="$tmp/home"
mkdir -p "$HOME/.config/onebox"
echo '{"apple":{"teamId":"ABCDE12345"}}' > "$HOME/.config/onebox/config.json"
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
// Lines in the planner's shapes: an install line, a "found:" note, a copy of
// an item line. A title above the header. A hand tick, and an untick of the
// item detection ticked.
t = t.replace("/plugin install ship-ios@onebox", "/plugin install ship-ios@onebox\n/plugin install content@onebox");
t = t.replace(/- \[ \] (Install Xcode.*<!-- guide:xcode -->)/, "- [x] $1\n  - found: the old keys are in 1Password");
t = t.replace(/- \[x\] (Join the Apple Developer Program.*)/, "- [ ] $1");
t += "\nReminder:\n" + t.match(/- \[.\] .*<!-- guide:secrets -->/)[0] + "\n";
t = "# My app\n\n" + t;
fs.writeFileSync(f, t);
JS
cp "$tmp/repo/PLAN.md" "$tmp/expected.md"

fail=0
for run in 1 2; do
  out="$(node "$plan" write --repo "$tmp/repo" | head -n 1)"
  # Run 1 rewrites the header line only: the untick hands that tick to the user.
  case "$run:$out" in
    *": unchanged."*|1:*": updated."*) echo "run $run: $out" ;;
    *) echo "run $run: expected \"unchanged\", got: $out"; fail=1 ;;
  esac
done
nohead() { grep -v '^<!-- onebox-plan v1 ' "$1"; }
if ! diff -u <(nohead "$tmp/expected.md") <(nohead "$tmp/repo/PLAN.md"); then
  echo "FAIL: the re-run changed the user's text (diff above)"; fail=1
fi
[ "$fail" = 0 ] && echo "ok: notes and ticks kept byte for byte"

# Windows line endings: a re-run must not double the file.
sed -i.bak 's/$/\r/' "$tmp/repo/PLAN.md"
out="$(node "$plan" write --repo "$tmp/repo" | head -n 1)"
case "$out" in *": unchanged."*) echo "ok: CRLF plan unchanged" ;; *) echo "CRLF: expected \"unchanged\", got: $out"; fail=1 ;; esac

# A converted plan: a second run keeps the old plan's text as it is.
mkdir -p "$tmp/conv"
printf '# Plan\n\nMy own plan.\n\n## Notes\n\n- buy a domain\n' > "$tmp/conv/PLAN.md"
node "$plan" write --answers '{"stage":"idea"}' --repo "$tmp/conv" --convert >/dev/null
cp "$tmp/conv/PLAN.md" "$tmp/converted.md"
out="$(node "$plan" write --repo "$tmp/conv" | head -n 1)"
case "$out" in *": unchanged."*) echo "ok: converted plan unchanged" ;; *) echo "convert: expected \"unchanged\", got: $out"; diff -u "$tmp/converted.md" "$tmp/conv/PLAN.md"; fail=1 ;; esac
# An item whose skill left the kit: dropped when untouched, kept when ticked.
mkdir -p "$tmp/gone"
node "$plan" write --answers '{"stage":"idea"}' --repo "$tmp/gone" >/dev/null
node - "$tmp/gone/PLAN.md" <<'JS'
const fs = require("fs"), f = process.argv[2];
const lines = fs.readFileSync(f, "utf8").split("\n");
const i = lines.findIndex((l) => /^- \[[ x]\] .*<!-- (guide|skill):\S+ -->$/.test(l));
lines.splice(i + 1, 0, "- [ ] An old step — skill: /dev:old-skill <!-- skill:dev/old-skill -->",
  "- [x] A done old step — skill: /dev:done-skill <!-- skill:dev/done-skill -->");
fs.writeFileSync(f, lines.join("\n"));
JS
node "$plan" write --repo "$tmp/gone" >/dev/null
if grep -q "old-skill" "$tmp/gone/PLAN.md"; then echo "gone: an untouched item of a removed skill was kept"; fail=1
elif ! grep -q "done-skill" "$tmp/gone/PLAN.md"; then echo "gone: a ticked item of a removed skill was dropped"; fail=1
else echo "ok: removed skills dropped unless ticked"; fi
exit "$fail"
