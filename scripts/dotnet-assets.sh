#!/usr/bin/env bash
# Build every .NET asset in plugins/app-features the way an app gets it: copied
# into an API from /start:new-app (namespace MyApp.Api, AppDb in
# MyApp.Api.Data, every analyzer warning an error). Also builds ai-consent and
# ai-usage-limits each without the other, because the skills say they work
# alone. Needs the .NET 10 SDK and network for NuGet. Run by CI.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$PWD"
A="$REPO/plugins/app-features/skills"
W="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$W"' EXIT

cd "$W"
dotnet new web -n MyApp.Api -o MyApp.Api >/dev/null
dotnet new xunit -n MyApp.Api.Tests -o MyApp.Api.Tests >/dev/null
dotnet add MyApp.Api.Tests reference MyApp.Api >/dev/null
rm -f MyApp.Api.Tests/UnitTest1.cs
# The strict settings from guides/agent-test-loop.md, step 3. CA1707: test
# names are sentences with underscores (new-app turns it off in tests too).
cat > Directory.Build.props <<'XML'
<Project>
  <PropertyGroup>
    <Nullable>enable</Nullable>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
    <AnalysisLevel>latest-recommended</AnalysisLevel>
  </PropertyGroup>
</Project>
XML
sed -i.bak 's#<PropertyGroup>#<PropertyGroup><NoWarn>$(NoWarn);CA1707</NoWarn>#' MyApp.Api.Tests/MyApp.Api.Tests.csproj
for p in Npgsql.EntityFrameworkCore.PostgreSQL OpenAI OpenTelemetry.Extensions.Hosting OpenTelemetry.Exporter.OpenTelemetryProtocol; do
  dotnet add MyApp.Api package "$p" >/dev/null
done
mkdir -p MyApp.Api/Data
cat > MyApp.Api/Data/AppDb.cs <<'CS'
using Microsoft.EntityFrameworkCore;

namespace MyApp.Api.Data;

public sealed class AppDb(DbContextOptions<AppDb> options) : DbContext(options);
CS

copy() {  # copy SKILL...: the given skills' assets, and nothing else
  rm -rf MyApp.Api/{Agent,Usage,Consent,Jobs} MyApp.Api.Tests/AgentEvalTests.cs
  for s in "$@"; do
    case "$s" in
      agent-harness)   cp -R "$A/agent-harness/assets/dotnet/Agent" MyApp.Api/Agent
                       cp "$A/agent-harness/assets/dotnet/Tests/"*.cs MyApp.Api.Tests/ ;;
      ai-usage-limits) mkdir -p MyApp.Api/Usage && cp "$A/ai-usage-limits/assets/dotnet/"*.cs MyApp.Api/Usage/ ;;
      ai-consent)      mkdir -p MyApp.Api/Consent && cp "$A/ai-consent/assets/dotnet/"*.cs MyApp.Api/Consent/ ;;
      durable-jobs)    cp -R "$A/durable-jobs/assets/dotnet/Jobs" MyApp.Api/Jobs ;;
    esac
  done
}

build() {  # build LABEL SKILL...
  local label="$1"; shift
  copy "$@"
  echo "== $label"
  if ! out="$(dotnet build MyApp.Api.Tests -v q 2>&1)"; then
    echo "$out" | grep -E "error|warn" | sed -E "s#$W/##; s# \[.*##" | sort -u
    echo "dotnet-assets: $label does not build" >&2
    exit 1
  fi
}

build "all app-features"          agent-harness ai-usage-limits ai-consent durable-jobs
build "ai-consent alone"          agent-harness ai-consent
build "ai-usage-limits alone"     agent-harness ai-usage-limits
build "durable-jobs alone"        agent-harness durable-jobs
echo "dotnet-assets: ok"
