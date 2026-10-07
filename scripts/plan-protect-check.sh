#!/usr/bin/env bash
# The plan must not call an API protected when it is not, and must flag an
# unsafe AI setup. This makes small repos with a .NET and a Node API, with
# and without the measures of backend.md ("Protect the API"), and checks what
# detect.mjs says. Then it checks the answer conflicts of plan.mjs.
#   bash scripts/plan-protect-check.sh
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
detect="$here/plugins/start/skills/plan/scripts/detect.mjs"
plan="$here/plugins/start/skills/plan/scripts/plan.mjs"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/home"
# A fake HOME, so the onebox config of this Mac plays no part.
# No tool checks in detection: they mean nothing with a fake HOME.
export HOME="$tmp/home" ONEBOX_DETECT_NO_RUN=1

fail() { echo "plan-protect-check: $*" >&2; exit 1; }

# A repo with an Expo app, a compose file with a Traefik router and a deploy
# workflow: everything the backend item needs except the protection.
base() {
  local r="$tmp/$1"
  mkdir -p "$r/apps/mobile" "$r/apps/api" "$r/.github/workflows"
  echo '{ "name": "mobile", "dependencies": { "expo": "~55.0.0" } }' > "$r/apps/mobile/package.json"
  printf 'services:\n  api:\n    labels:\n      - traefik.http.routers.api.rule=Host(`api.example.com`)\n' > "$r/docker-compose.yml"
  printf 'name: deploy\non: push\n' > "$r/.github/workflows/deploy.yml"
  echo "$r"
}
# get <repo> <js expression on the detect JSON `r`>
get() { node "$detect" "$1" | node -e "const r=JSON.parse(require('fs').readFileSync(0,'utf8')); const v=($2); console.log(v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v))"; }
has() { case "$1" in *"$2"*) ;; *) fail "$3: expected \"$2\" in: $1" ;; esac; }
hasnt() { case "$1" in *"$2"*) fail "$3: did not expect \"$2\" in: $1" ;; esac; }

# 1. .NET API with none of it. The markers in a test file do not count.
#    The API calls a model, and the app has its own AI key.
r="$(base dotnet-bare)"
echo '<Project Sdk="Microsoft.NET.Sdk.Web"><ItemGroup><PackageReference Include="OpenAI" Version="2.0.0" /></ItemGroup></Project>' > "$r/apps/api/Api.csproj"
echo 'var app = builder.Build(); app.MapGet("/health", () => 1); app.Run();' > "$r/apps/api/Program.cs"
echo '// AddRateLimiter( UseRateLimiter( UseForwardedHeaders( ForwardedHeadersOptions MaxRequestBodySize ai_usage' > "$r/apps/api/RateLimitTests.cs"
echo 'export const key = process.env.EXPO_PUBLIC_OPENAI_API_KEY;' > "$r/apps/mobile/ai.ts"
[ -z "$(get "$r" 'r.done["guide:backend"]')" ] || fail "dotnet-bare: the backend is ticked without protection"
o="$(get "$r" 'r.open["guide:backend"]')"
has "$o" "AddRateLimiter and UseRateLimiter" dotnet-bare
has "$o" "UseForwardedHeaders" dotnet-bare
has "$o" "MaxRequestBodySize" dotnet-bare
has "$(get "$r" 'r.open["skill:app-features/ai-usage-limits"]')" "no per-user usage count" dotnet-bare
has "$(get "$r" 'r.open["guide:llm-api-key"]')" "EXPO_PUBLIC_OPENAI_API_KEY" dotnet-bare
echo "ok: .NET API without protection is not ticked"

# 2. .NET API with the guide's code (parts 1, 2, 3 and 4).
r="$(base dotnet-guide)"
echo '<Project Sdk="Microsoft.NET.Sdk.Web"><ItemGroup><PackageReference Include="OpenAI" Version="2.0.0" /></ItemGroup></Project>' > "$r/apps/api/Api.csproj"
cat > "$r/apps/api/Program.cs" <<'CS'
using Microsoft.AspNetCore.HttpOverrides;
builder.WebHost.ConfigureKestrel(k => k.Limits.MaxRequestBodySize = 1_000_000);
builder.Services.Configure<ForwardedHeadersOptions>(o => { o.ForwardLimit = 2; });
builder.Services.AddRateLimiter(o => { o.RejectionStatusCode = 429; });
var app = builder.Build();
app.UseForwardedHeaders();
app.UseAuthentication();
app.UseRateLimiter();
CS
echo 'public class Usage { const string Sql = "insert into ai_usage (user_id, day, calls) values (@u, @d, 1)"; }' > "$r/apps/api/Usage.cs"
[ -z "$(get "$r" 'r.open["guide:backend"]')" ] || fail "dotnet-guide: $(get "$r" 'r.open["guide:backend"]')"
has "$(get "$r" 'r.done["guide:backend"]')" "a rate limiter and a body size limit" dotnet-guide
has "$(get "$r" 'r.done["skill:app-features/ai-usage-limits"]')" "per-user AI usage count" dotnet-guide
[ -z "$(get "$r" 'r.open["guide:llm-api-key"]')" ] || fail "dotnet-guide: the app has no AI key, but llm-api-key is open"
echo "ok: .NET API with the guide's code is ticked"

# 3. Node API that trusts every X-Forwarded-For and has no rate limiter.
r="$(base node-bare)"
echo '{ "name": "api", "dependencies": { "fastify": "^5.0.0" } }' > "$r/apps/api/package.json"
echo 'const app = Fastify({ trustProxy: true });' > "$r/apps/api/server.ts"
o="$(get "$r" 'r.open["guide:backend"]')"
has "$o" "trust proxy is true" node-bare
has "$o" "a rate limiter" node-bare
hasnt "$o" "body size" node-bare
echo "ok: Node API without protection is not ticked"

# 4. Node API with the guide's code.
r="$(base node-guide)"
echo '{ "name": "api", "dependencies": { "fastify": "^5.0.0", "@fastify/rate-limit": "^10.0.0" } }' > "$r/apps/api/package.json"
echo 'const app = Fastify({ trustProxy: "172.18.0.0/16" });' > "$r/apps/api/server.ts"
[ -z "$(get "$r" 'r.open["guide:backend"]')" ] || fail "node-guide: $(get "$r" 'r.open["guide:backend"]')"
has "$(get "$r" 'r.done["guide:backend"]')" "a rate limiter" node-guide
echo "ok: Node API with the guide's code is ticked"

# 5. Answers that do not work together.
r="$tmp/empty"; mkdir -p "$r"
q() { node "$plan" questions --repo "$r" --answers "$1" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).conflicts.map((c) => c.level + ':' + c.id).join(' '))"; }
[ "$(q '{"backend":"none","ai":["chat"],"login":"none"}')" = "conflict:ai-without-server warning:ai-without-sign-in" ] || fail "no server + AI + no accounts: $(q '{"backend":"none","ai":["chat"],"login":"none"}')"
[ "$(q '{"backend":"none","ai":["media"]}')" = "warning:media-without-server" ] || fail "no server + media: $(q '{"backend":"none","ai":["media"]}')"
[ -z "$(q '{"backend":"box","ai":["chat"],"login":"apple"}')" ] || fail "box + AI + Sign in with Apple raised a conflict"
[ -z "$(q '{"ai":["chat"]}')" ] || fail "a conflict before the server question has an answer"
out="$(node "$plan" write --repo "$r" --dry-run --answers '{"stage":"idea","backend":"none","ai":["chat"]}' 2>&1 >/dev/null)"
has "$out" "Check: AI needs a server" write
file="$(node "$plan" write --repo "$r" --dry-run --answers '{"stage":"idea","backend":"none","ai":["chat"]}' 2>/dev/null)"
has "$file" "**Warning:** AI needs a server" PLAN.md
# The warning line is the planner's: a re-run keeps the file as it is, and a
# new answer takes the line away without leaving it behind as a user note.
node "$plan" write --repo "$r" --answers '{"stage":"idea","backend":"none","ai":["chat"]}' >/dev/null 2>&1
has "$(node "$plan" write --repo "$r" 2>/dev/null | head -n 1)" ": unchanged." re-run
node "$plan" write --repo "$r" --answers '{"backend":"hosted"}' >/dev/null 2>&1
hasnt "$(cat "$r/PLAN.md")" "AI needs a server" "new answer"
hasnt "$(cat "$r/PLAN.md")" "Kept from your old plan" "new answer"
echo "ok: conflicts in questions, write and PLAN.md"
