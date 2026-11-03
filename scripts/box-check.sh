#!/usr/bin/env bash
# box-setup.sh and audit-exposure.py must refuse and fail where they should.
# Offline, with fakes on PATH: no docker, no systemd, no network.
#   bash scripts/box-check.sh
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
setup="$here/plugins/box/skills/box-setup/scripts/box-setup.sh"
audit="$here/plugins/box/skills/expose-service/scripts/audit-exposure.py"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/home" "$tmp/bin"
export HOME="$tmp/home" CF_UNIT="$tmp/cloudflared.service"
export PATH="$tmp/bin:$PATH"

fail() { echo "box-check: $*" >&2; exit 1; }

# A docker with N containers named traefik and no onebox.managed label; an ss that sees no listener.
printf '#!/bin/sh\ncase "$1" in\n  ps) i=0; while [ "$i" -lt "${FAKE_TRAEFIKS:-0}" ]; do i=$((i+1)); echo "id$i traefik:v3 traefik$i"; done ;;\n  --version) echo "Docker version 0" ;;\nesac\n' > "$tmp/bin/docker"
printf '#!/bin/sh\nexit 0\n' > "$tmp/bin/ss"
chmod +x "$tmp/bin/docker" "$tmp/bin/ss"

# expect <exit code> <what> <command...>
expect() {
  local want="$1" what="$2" got=0; shift 2
  "$@" >"$tmp/out" 2>&1 || got=$?
  [ "$got" = "$want" ] || { cat "$tmp/out" >&2; fail "$what: exit $got, wanted $want"; }
}

expect 0 "preflight on a clean box" bash "$setup" preflight
FAKE_TRAEFIKS=2 expect 3 "two foreign Traefik containers" bash "$setup" preflight
echo '[Service]' > "$CF_UNIT"
expect 3 "a cloudflared unit onebox did not write" bash "$setup" preflight
rm -f "$CF_UNIT"

echo '{"box": {"type": "home",}}' > "$tmp/bad.json"
expect 2 "a config with a trailing comma" bash "$setup" preflight --config "$tmp/bad.json"
echo '{"box": {"appsDir": "/srv/a\"; touch /tmp/pwned; \""}}' > "$tmp/inject.json"
expect 2 "an appsDir with a quote" bash "$setup" preflight --config "$tmp/inject.json"

# audit-exposure.py: an admin host behind a remote (token) tunnel, with and without Access in front.
python3 -I - "$audit" <<'PY'
import contextlib, importlib.util, io, os, sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("audit", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
cname = "11111111-2222-3333-4444-555555555555.cfargotunnel.com"
def fake_urlopen(url, timeout=None):
    if url.endswith("//api.ipify.org"): return io.BytesIO(b"203.0.113.10")
    raise OSError("no IPv6")
m.urllib.request.urlopen = fake_urlopen
m.records = lambda d, tok: [{"type": "CNAME", "name": "grafana.example.com", "content": cname, "proxied": True}]
m.get = lambda url, headers=None, timeout=20: []
def fake_sh(cmd):
    if cmd[1] == "list-units": return "cloudflared.service loaded active running Cloudflare Tunnel\n"
    if cmd[1] == "is-active": return "active\n"
    return "/usr/bin/cloudflared tunnel run --token eyJh\n"
m.sh = fake_sh
os.environ["CLOUDFLARE_API_TOKEN"] = "dummy"
for state, want in (("HTTP 200", 1), ("access", 0)):
    m.access_state = lambda h, state=state: state
    m.problems.clear()
    sys.argv = ["audit-exposure.py", "--domain", "example.com", "--tunnel-config", "/nonexistent/config.yml"]
    with contextlib.redirect_stdout(io.StringIO()):
        rc = m.main()
    if (rc != 0) != bool(want):
        sys.exit(f"box-check: audit with Access state {state!r}: exit {rc}, wanted {'non-zero' if want else '0'}")
PY
# expose.py: the catch-all as the remote (dashboard) config returns it, with an empty originRequest.
python3 -I - "$here/plugins/box/skills/expose-service/scripts/expose.py" <<'PY'
import importlib.util, sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("expose", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
app = {"hostname": "app.example.com", "service": "https://localhost:443"}
if m.check_ingress([app, {"service": "http_status:404", "originRequest": {}}]) is not None:
    sys.exit("box-check: expose.py rejects the remote config's catch-all")
if m.check_ingress([{"service": "http_status:404"}, app]) is None:
    sys.exit("box-check: expose.py accepts a catch-all that is not last")
PY

# audit-exposure.py: a tunnel run with --config but managed from the dashboard (the journal says so). Its
# ingress must come from the API, not the stale local file, and the catch-all may carry an empty originRequest.
python3 -I - "$audit" <<'PY'
import contextlib, importlib.util, io, os, sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("audit", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
tid = "11111111-2222-3333-4444-555555555555"
def fake_urlopen(url, timeout=None):
    if url.endswith("//api.ipify.org"): return io.BytesIO(b"203.0.113.10")
    raise OSError("no IPv6")
m.urllib.request.urlopen = fake_urlopen
def fake_records(d, tok):
    m.accounts[d] = "acct"
    return [{"type": "CNAME", "name": "app.example.com", "content": f"{tid}.cfargotunnel.com", "proxied": True}]
m.records = fake_records
def fake_sh(cmd):
    if cmd[1] == "list-units": return "cloudflared.service loaded active running Cloudflare Tunnel\n"
    if cmd[1] == "is-active": return "active\n"
    if cmd[0] == "journalctl": return "INF Updated to new configuration\n"
    return "/usr/bin/cloudflared tunnel --config /etc/cloudflared/config.yml run\n"
m.sh = fake_sh
os.environ["CLOUDFLARE_API_TOKEN"] = "dummy"
for hosts, want in ((["app.example.com"], "DNS and ingress match"), ([], "DNS but no ingress")):
    def fake_get(url, headers=None, timeout=20, hosts=hosts):
        if url.endswith(f"/accounts/acct/cfd_tunnel/{tid}/configurations"):
            rules = [{"hostname": h, "service": "https://localhost:443"} for h in hosts]
            return {"success": True, "result": {"config": {"ingress": rules + [{"service": "http_status:404", "originRequest": {}}]}}}
        return []
    m.get = fake_get
    m.problems.clear(); m.notes.clear()
    sys.argv = ["audit-exposure.py", "--domain", "example.com", "--tunnel-config", "/nonexistent/config.yml"]
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        rc = m.main()
    text = out.getvalue()
    if rc != 0 or want not in text or "read from the API" not in text:
        sys.exit(f"box-check: audit of a dashboard-managed tunnel ({hosts}): exit {rc}\n{text}")
PY
echo "box-check: ok"
