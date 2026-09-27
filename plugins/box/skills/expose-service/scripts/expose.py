#!/usr/bin/env python3
"""Put a hostname on the box: tunnel ingress, rolling cloudflared restart, DNS.

Runs on: your box (over SSH). Run with sudo when it edits the local tunnel
config. The container must already run with its Traefik labels and be verified
locally; this script does only the exposure half.

Safe to re-run: the ingress insert and the DNS write are both idempotent.

  expose.py api.example.com --domain example.com [--token-stdin]
      tunnel mode (default): ingress entry + proxied CNAME to the tunnel
  expose.py tools.example.com --domain example.com --mode private --ip 192.168.1.20
      unproxied A record to a LAN or tailnet address, no ingress
  expose.py www.example.com --domain example.com --mode direct
      proxied A record to the box's public IP. Only for box.tunnel = none.

  --ingress-only / --dns-only   split the steps (migrations: ingress, soak, then DNS)
  --target URL                  ingress service (default https://localhost:443 = Traefik)
  --tunnel-mode auto|local|remote
  --dry-run                     show what would change

Token: CLOUDFLARE_API_TOKEN in the environment, or one line on stdin with
--token-stdin. It is never printed.
"""
import argparse
import concurrent.futures as cf
import datetime as dt
import ipaddress
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

API = "https://api.cloudflare.com/client/v4"
CATCHALL_RE = re.compile(r"^(\s*)- service:\s*http_status:404\s*$", re.M)
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def log(msg):
    print(f"\n=== {msg}", flush=True)


def say(msg):
    print(f"  {msg}", flush=True)


def die(msg, code=1):
    print(f"  ERROR: {msg}", file=sys.stderr)
    sys.exit(code)


# ------------------------------------------------------------------ helpers --

class CF:
    def __init__(self, token):
        self.token = token

    def call(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(API + path, data=data, method=method, headers={
            "Authorization": f"Bearer {self.token}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                d = json.load(r)
        except urllib.error.HTTPError as e:
            try:
                d = json.load(e)
            except Exception:
                d = {"success": False, "errors": [f"HTTP {e.code}"]}
        if not d.get("success"):
            raise RuntimeError(f"{method} {path.split('?')[0]}: {json.dumps(d.get('errors'))[:300]}")
        return d["result"]

    def zone(self, domain):
        z = self.call("GET", f"/zones?name={domain}")
        if not z:
            die(f"zone {domain} not found, or the token cannot read it")
        return z[0]["id"], z[0]["account"]["id"]


def read_token(from_stdin):
    if from_stdin:
        tok = sys.stdin.readline().strip()
    else:
        tok = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
    if not tok:
        die("no Cloudflare token: set CLOUDFLARE_API_TOKEN or pipe it with --token-stdin")
    return tok


def probe(host, timeout=8):
    req = urllib.request.Request(f"https://{host}/", headers={"User-Agent": "onebox-expose"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            return f"{r.status} {len(body)}b {r.headers.get('content-type', '-').split(';')[0]}"
    except urllib.error.HTTPError as e:
        body = e.read() if e.fp else b""
        return f"{e.code} {len(body)}b {e.headers.get('content-type', '-').split(';')[0]}"
    except Exception as e:
        return f"ERR {type(e).__name__}"


def probe_all(hosts):
    with cf.ThreadPoolExecutor(8) as ex:
        return dict(zip(hosts, ex.map(probe, hosts)))


def sh(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def units():
    out = sh(["systemctl", "list-units", "cloudflared*.service", "--state=active",
              "--plain", "--no-legend"]).stdout
    return [line.split()[0] for line in out.splitlines() if line.strip()]


def execstart(unit):
    # Never print this: a remotely managed tunnel carries its token here.
    return sh(["systemctl", "show", "-p", "ExecStart", "-p", "Environment", "--value", unit]).stdout


def detect_mode(conf_path):
    for u in units():
        es = execstart(u)
        if "--token" in es or "TUNNEL_TOKEN" in es:
            return "remote", f"{u} runs with a tunnel token"
        j = sh(["journalctl", "-u", u, "-b", "--no-pager", "-q", "-g", "Updated to new configuration"]).stdout
        if j.strip():
            return "remote", f"{u} loaded its ingress from Cloudflare (journal)"
    if os.path.exists(conf_path):
        return "local", f"{conf_path}"
    die("no cloudflared unit and no local config. Run box:box-setup first.")


def tunnel_ref(conf_path):
    try:
        for line in open(conf_path):
            m = re.match(r"^tunnel:\s*(\S+)", line)
            if m:
                return m.group(1)
    except OSError:
        pass
    return None


def tunnel_id(cfapi, account, conf_path, name):
    ref = tunnel_ref(conf_path) or name
    if ref and UUID_RE.match(ref):
        return ref
    if not ref:
        die("tunnel unknown: pass --tunnel-name (box.tunnelName)")
    t = cfapi.call("GET", f"/accounts/{account}/cfd_tunnel?name={ref}&is_deleted=false")
    if not t:
        die(f"no tunnel named {ref}. The token needs Cloudflare Tunnel read access for this lookup.")
    return t[0]["id"]


def ingress_entry(host, target, indent):
    lines = [f"{indent}- hostname: {host}", f"{indent}  service: {target}"]
    if target.startswith("https://localhost") or target.startswith("https://127.0.0.1"):
        # Traefik's certificate is for the hostname, not localhost, and SNI must
        # carry the hostname so Traefik picks the right router.
        lines += [f"{indent}  originRequest:", f"{indent}    noTLSVerify: true",
                  f"{indent}    originServerName: {host}"]
    return "\n".join(lines) + "\n"


def check_ingress(ing):
    if not ing or ing[-1] != {"service": "http_status:404"}:
        return "the http_status:404 catch-all is not the last rule"
    loop = [r.get("hostname") for r in ing
            if re.match(r"^https?://(localhost|127\.0\.0\.1):80/?$", str(r.get("service", "")))]
    if loop:
        return f"rules on port 80 loop through Traefik's redirect: {loop}"
    return None


# ------------------------------------------------------------------ ingress --

def ingress_local(a, host):
    if os.geteuid() != 0 and not a.dry_run:
        die("editing the tunnel config needs root: run with sudo")
    import yaml
    conf = a.tunnel_config
    s = open(conf).read()
    hosts = [r.get("hostname") for r in (yaml.safe_load(s) or {}).get("ingress", []) if r.get("hostname")]
    if host in hosts:
        say("already in the ingress, no change")
        return False
    m = CATCHALL_RE.findall(s)
    if len(m) != 1:
        die(f"expected exactly one '- service: http_status:404' line, found {len(m)}. Edit by hand.")
    indent = m[0]
    new = CATCHALL_RE.sub(lambda mm: ingress_entry(host, a.target, indent) + mm.group(0), s, count=1)
    if a.dry_run:
        say("(dry run) would insert before the catch-all:")
        print(ingress_entry(host, a.target, indent), end="")
        return False

    witnesses = [h for h in hosts if h and not h.startswith("*")]
    bak = f"{conf}.bak-{dt.datetime.now(dt.timezone.utc):%Y%m%dT%H%M%SZ}"
    shutil.copy2(conf, bak)
    say(f"backup: {bak}")
    with open(conf, "w") as f:
        f.write(new)

    log("Validating before restarting anything")
    v = sh(["cloudflared", "--config", conf, "tunnel", "ingress", "validate"])
    err = None if v.returncode == 0 else (v.stderr or v.stdout).strip()[:300]
    err = err or check_ingress(yaml.safe_load(open(conf)).get("ingress", []))
    if err:
        shutil.copy2(bak, conf)
        die(f"validation failed, config restored from backup: {err}")
    say("valid; catch-all last; nothing on :80")

    log("Witness probe BEFORE restart")
    before = probe_all(witnesses)
    for h, r in before.items():
        say(f"{h:<40} {r}")

    us = [u for u in units() if "--token" not in execstart(u)]
    if not us:
        die("no active cloudflared unit to restart")
    if len(us) == 1:
        say("WARN: one cloudflared unit only. Its restart drops tunnel traffic for a few seconds.")
    log("Rolling restart: " + ", ".join(us))
    # Replicas of one tunnel: Cloudflare balances across them, so a restart a
    # few seconds apart is a zero-downtime reload. Both at once drops every host.
    for u in us:
        sh(["systemctl", "restart", u])
        metrics = re.search(r"--metrics[= ](\S+)", execstart(u))
        ready = False
        for _ in range(10):
            time.sleep(3)
            if not metrics:
                ready = sh(["systemctl", "is-active", u]).stdout.strip() == "active"
            else:
                try:
                    ready = urllib.request.urlopen(f"http://{metrics.group(1)}/ready", timeout=3).status == 200
                except Exception:
                    ready = False
            if ready:
                break
        if not ready:
            die(f"{u} not ready after restart. Restore: sudo cp {bak} {conf} && sudo systemctl restart {u}")
        say(f"{u} ready")

    log("Witness probe AFTER restart")
    after = probe_all(witnesses)
    changed = {h: (before[h], after[h]) for h in witnesses if before[h].split()[0] != after[h].split()[0]}
    for h, r in after.items():
        say(f"{h:<40} {r}")
    if changed:
        say("*** a tunnelled hostname changed status ***")
        for h, (b, c) in changed.items():
            say(f"{h}: {b} -> {c}")
        die(f"restore with: sudo cp {bak} {conf}, then restart the units one by one")
    say("OK: no other tunnelled hostname changed status")
    return True


def ingress_remote(a, host, cfapi, account, tid):
    # The tunnel fetches its ingress from Cloudflare and ignores the local file.
    path = f"/accounts/{account}/cfd_tunnel/{tid}/configurations"
    conf = cfapi.call("GET", path).get("config") or {}
    ing = conf.get("ingress") or [{"service": "http_status:404"}]
    if any(r.get("hostname") == host for r in ing):
        say("already in the remote ingress, no change")
        return False
    if ing[-1].get("hostname"):
        die("remote ingress has no catch-all last. Fix it in the dashboard first.")
    rule = {"hostname": host, "service": a.target}
    if a.target.startswith("https://localhost") or a.target.startswith("https://127.0.0.1"):
        rule["originRequest"] = {"noTLSVerify": True, "originServerName": host}
    new = ing[:-1] + [rule] + ing[-1:]
    err = check_ingress(new)
    if err:
        die(err)
    if a.dry_run:
        say(f"(dry run) would PUT {len(new)} rules to the remote tunnel config")
        return False
    witnesses = [r["hostname"] for r in ing if r.get("hostname") and not r["hostname"].startswith("*")]
    before = probe_all(witnesses)
    conf["ingress"] = new
    cfapi.call("PUT", path, {"config": conf})
    say(f"remote ingress updated ({len(new)} rules). No restart needed.")
    time.sleep(10)
    after = probe_all(witnesses)
    bad = [h for h in witnesses if before[h].split()[0] != after[h].split()[0]]
    if bad:
        die(f"hostnames changed status after the update: {bad}")
    return True


# ---------------------------------------------------------------------- dns --

def upsert(cfapi, zone, host, rtype, content, proxied, dry):
    recs = cfapi.call("GET", f"/zones/{zone}/dns_records?name={host}")
    for r in recs:
        say(f"current: {r['type']} proxied={r['proxied']} -> {r['content']}   (record id {r['id']}, keep for rollback)")
    if not recs:
        say("current: none")
    if len(recs) > 1:
        die("more than one record for this name. Resolve by hand first.")
    if recs and recs[0]["type"] == rtype and recs[0]["content"] == content and recs[0]["proxied"] == proxied:
        say("already correct, no change")
        return
    body = {"type": rtype, "name": host, "content": content, "proxied": proxied, "ttl": 1}
    if dry:
        say(f"(dry run) would write {rtype} {host} -> {content} proxied={proxied}")
        return
    if recs:
        r = cfapi.call("PUT", f"/zones/{zone}/dns_records/{recs[0]['id']}", body)
    else:
        r = cfapi.call("POST", f"/zones/{zone}/dns_records", body)
    say(f"OK {r['name']} {r['type']} proxied={r['proxied']} -> {r['content']}")


def public_ip():
    with urllib.request.urlopen("https://api.ipify.org", timeout=10) as r:
        return r.read().decode().strip()


# --------------------------------------------------------------------- main --

def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("host")
    p.add_argument("--domain", default=os.environ.get("BOX_DOMAIN"), help="box.domain (the Cloudflare zone)")
    p.add_argument("--mode", choices=["tunnel", "private", "direct"], default="tunnel")
    p.add_argument("--ip", help="for --mode private: the LAN or tailnet address")
    p.add_argument("--target", default="https://localhost:443")
    p.add_argument("--tunnel-config", default="/etc/cloudflared/config.yml")
    p.add_argument("--tunnel-name", default=os.environ.get("BOX_TUNNEL_NAME"))
    p.add_argument("--tunnel-mode", choices=["auto", "local", "remote"], default="auto")
    g = p.add_mutually_exclusive_group()
    g.add_argument("--ingress-only", action="store_true")
    g.add_argument("--dns-only", action="store_true")
    p.add_argument("--token-stdin", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    a = p.parse_args()

    host = a.host.lower().rstrip(".")
    if not a.domain:
        die("pass --domain (box.domain)", 2)
    if host != a.domain and not host.endswith("." + a.domain):
        die(f"{host} is not under {a.domain}", 2)
    if host.startswith("*"):
        die("no wildcards: a * record answers for names that never existed", 2)
    if host.count(".") - a.domain.count(".") > 1:
        say("WARN: two levels below the zone. Cloudflare's free certificate covers one level")
        say("      (*.example.com), so a.b.example.com fails TLS at the edge. Prefer a-b.example.com.")
    if a.target.rstrip("/").endswith(":80"):
        die("ingress must target 443, not 80: Traefik redirects 80 to 443 and the tunnel loops", 2)

    cfapi = CF(read_token(a.token_stdin))
    zone, account = cfapi.zone(a.domain)
    if a.dry_run:
        log("DRY RUN: nothing will be changed")

    log(f"Baseline for {host}")
    base = probe(host)
    say(f"before: {base}")

    if a.mode == "private":
        ip = ipaddress.ip_address(a.ip or die("--mode private needs --ip", 2))
        if not (ip.is_private or ip in ipaddress.ip_network("100.64.0.0/10")):
            die(f"{ip} is a public address. Private mode takes a LAN or tailnet IP only.", 2)
        if host in (open(a.tunnel_config).read() if os.path.exists(a.tunnel_config) else ""):
            say("WARN: this host is still in the tunnel ingress. Remove it there too, or it stays public.")
        log("DNS: unproxied A record to a private address")
        upsert(cfapi, zone, host, "A", str(ip), False, a.dry_run)
    elif a.mode == "direct":
        ip = public_ip()
        say("WARN: direct mode puts the origin IP behind a proxied record. Use it only with box.tunnel = none.")
        log("DNS: proxied A record to the box")
        upsert(cfapi, zone, host, "A", ip, True, a.dry_run)
    else:
        mode = a.tunnel_mode
        if mode == "auto":
            mode, why = detect_mode(a.tunnel_config)
            say(f"tunnel is {mode}ly managed ({why})")
        tid = tunnel_id(cfapi, account, a.tunnel_config, a.tunnel_name)
        if not a.dns_only:
            log(f"Ingress for {host} -> {a.target}")
            if a.target != "https://localhost:443":
                say("NOTE: this target bypasses Traefik. No Traefik middleware applies.")
            if mode == "local":
                ingress_local(a, host)
            else:
                ingress_remote(a, host, cfapi, account, tid)
        if not a.ingress_only:
            log("DNS: proxied CNAME to the tunnel")
            upsert(cfapi, zone, host, "CNAME", f"{tid}.cfargotunnel.com", True, a.dry_run)

    if a.dry_run or a.ingress_only:
        log("Done")
        return 0

    log("Verify")
    time.sleep(20)
    if shutil.which("dig"):
        ips = sh(["dig", "+short", "@1.1.1.1", host, "A"]).stdout.split()
        say(f"dig @1.1.1.1: {' '.join(ips) or '(nothing yet)'}")
        if a.mode == "tunnel":
            try:
                origin = public_ip()
                say("*** ORIGIN IP IN DNS - investigate ***" if origin in ips else "no origin IP in DNS")
            except Exception:
                say("could not read the public IP to compare")
    say(f"after:  {probe(host, 15)}   (before: {base})")
    say("Compare status AND size/type with what you expect. A 404 can be the tunnel catch-all.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
