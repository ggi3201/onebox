#!/usr/bin/env python3
"""Audit what the box exposes, and how.

Runs on: your box (over SSH). Read-only.

Answers the question expose-service exists for: did anything put the origin IP
back into public DNS, or leave a certificate resolver that cannot renew behind
the tunnel?

Exits non-zero if anything is wrong, so it can gate a workflow. A check that
cannot run counts as a problem, not a pass: a silent false negative here is
worse than no audit.

  audit-exposure.py --domain example.com [--domain other.example] [--token-stdin]
                    [--public-ok grafana.example.com]

It also requests every tunnelled hostname whose name looks like an admin tool
(grafana, portainer, admin, dash, ...) and flags it when the answer is not a
Cloudflare Access login redirect. --public-ok accepts one you made public on
purpose, for example a tool with its own strong login.

Token: CLOUDFLARE_API_TOKEN in the environment, or one line on stdin with
--token-stdin. It needs DNS read on the zone(s). It is never printed.
"""
import argparse
import ipaddress
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

API = "https://api.cloudflare.com/client/v4"
problems = []
notes = []


def get(url, headers=None, timeout=20):
    req = urllib.request.Request(url, headers=headers or {})
    return json.load(urllib.request.urlopen(req, timeout=timeout))


def cf(path, tok):
    d = get(API + path, {"Authorization": f"Bearer {tok}"})
    if not d.get("success"):
        raise RuntimeError(json.dumps(d.get("errors"))[:200])
    return d["result"]


def records(domain, tok):
    z = cf(f"/zones?name={domain}", tok)
    if not z:
        raise RuntimeError("zone not found, or the token cannot read it")
    out, page = [], 1
    while True:
        rs = cf(f"/zones/{z[0]['id']}/dns_records?per_page=100&page={page}", tok)
        out += rs
        if len(rs) < 100:
            return out
        page += 1


def sh(cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=15).stdout
    except Exception:
        return ""


# Names of admin tools and dashboards. Matched as whole parts of the first label,
# so "grafana", "grafana-stg" and "stg-admin" match and "qrcode" does not.
ADMIN_NAMES = re.compile(
    r"(^|-)(admin|dash|dashboard|traefik|portainer|dozzle|grafana|prometheus|alertmanager|kibana|"
    r"pgadmin|adminer|phpmyadmin|kuma|uptime|netdata|glances|cockpit|webmin|n8n|metabase|minio|"
    r"console|langfuse|jupyter|code|vault|studio|supabase|airflow|flower|rabbitmq|mailpit|registry)(-|$)",
    re.I)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def access_state(host):
    """'access' if Cloudflare Access answers with its login redirect, else the status seen."""
    opener = urllib.request.build_opener(NoRedirect)
    try:
        r = opener.open(urllib.request.Request(f"https://{host}/", headers={"User-Agent": "onebox-audit"}), timeout=10)
        return f"HTTP {r.status}"
    except urllib.error.HTTPError as e:
        if "cloudflareaccess.com" in (e.headers.get("Location") or ""):
            return "access"
        return f"HTTP {e.code}"


def private(addr):
    try:
        ip = ipaddress.ip_address(addr)
    except ValueError:
        return False
    return ip.is_private or ip in ipaddress.ip_network("100.64.0.0/10")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--domain", action="append", default=[], help="zone to check (box.domain); repeat for more")
    p.add_argument("--traefik-api", default=os.environ.get("TRAEFIK_API", "http://127.0.0.1:8081"))
    p.add_argument("--resolver", default="cloudflare", help="the only certResolver that renews behind the tunnel")
    p.add_argument("--tunnel-config", default="/etc/cloudflared/config.yml")
    p.add_argument("--token-stdin", action="store_true")
    p.add_argument("--public-ok", action="append", default=[], help="admin-looking hostname that is public on purpose; repeat for more")
    a = p.parse_args()
    domains = a.domain or [d for d in [os.environ.get("BOX_DOMAIN")] if d]
    if not domains:
        sys.exit("pass --domain (box.domain)")

    tok = sys.stdin.readline().strip() if a.token_stdin else os.environ.get("CLOUDFLARE_API_TOKEN", "")
    if not tok:
        sys.exit("no Cloudflare token: set CLOUDFLARE_API_TOKEN or pipe it with --token-stdin")

    try:
        origin = urllib.request.urlopen("https://api.ipify.org", timeout=10).read().decode().strip()
    except Exception as exc:
        origin = None
        problems.append("origin-ip:unknown")
        print(f"origin IP: COULD NOT READ ({exc})")
    else:
        print(f"origin IP: {origin}")

    # -- tunnel config first: DNS checks compare against it
    conf = ""
    try:
        conf = open(a.tunnel_config).read()
    except PermissionError:
        conf = sh(["sudo", "-n", "cat", a.tunnel_config])
    except FileNotFoundError:
        pass
    ingress, tunnel_id = [], None
    if conf.strip():
        try:
            import yaml
            y = yaml.safe_load(conf) or {}
            ingress = y.get("ingress", [])
            tunnel_id = str(y.get("tunnel", "")) or None
        except Exception as exc:
            problems.append("ingress:unparsable")
            print(f"ingress: COULD NOT PARSE - {exc}")
    ing_hosts = {r.get("hostname") for r in ingress if r.get("hostname")}

    print("\n== DNS records pointing at the origin ==")
    by_zone = {}
    for d in domains:
        try:
            by_zone[d] = records(d, tok)
        except Exception as exc:
            print(f"  {d}: COULD NOT CHECK - {exc}")
            problems.append(f"dns:{d}")
            continue
        hits = [r for r in by_zone[d] if origin and r["content"] == origin]
        if not hits:
            print(f"  {d}: clean")
        for r in hits:
            how = ("proxied, but needs 80/443 open on the origin" if r["proxied"]
                   else "LEAKS THE ORIGIN IP IN PUBLIC DNS")
            print(f"  {d}: {r['type']} {r['name']} - {how}")
            problems.append(f"origin-record:{r['name']}")

    print("\n== wildcard records (answer for names that never existed) ==")
    for d, rs in by_zone.items():
        w = [r["name"] for r in rs if r["name"].startswith("*")]
        print(f"  {d}: {', '.join(w) if w else 'none'}")
        problems.extend(f"wildcard:{x}" for x in w)

    print("\n== private addresses in public DNS (deliberate LAN/tailnet names; check each) ==")
    for d, rs in by_zone.items():
        pv = [f"{r['name']} -> {r['content']}" for r in rs if r["type"] in ("A", "AAAA") and private(r["content"])]
        for x in pv:
            print(f"  {x}")
            name = x.split(" ")[0]
            if name in ing_hosts:
                print(f"    ^ ALSO IN THE TUNNEL INGRESS: it is public anyway")
                problems.append(f"private-but-ingress:{name}")
        if not pv:
            print(f"  {d}: none")

    if tunnel_id:
        print("\n== tunnel CNAMEs vs ingress ==")
        target = f"{tunnel_id}.cfargotunnel.com"
        cn = {r["name"] for rs in by_zone.values() for r in rs if r["type"] == "CNAME" and r["content"] == target}
        unprox = [r["name"] for rs in by_zone.values() for r in rs
                  if r["type"] == "CNAME" and r["content"] == target and not r["proxied"]]
        for n in unprox:
            print(f"  NOT PROXIED: {n}")
            problems.append(f"unproxied-tunnel:{n}")
        for n in sorted(cn - ing_hosts):
            print(f"  DNS but no ingress (hits the 404 catch-all): {n}")
        for n in sorted(h for h in ing_hosts - cn if any(h.endswith(d) for d in by_zone)):
            print(f"  ingress but no DNS: {n}")
        if not unprox and cn == ing_hosts:
            print(f"  {len(cn)} hostnames, DNS and ingress match")

    print("\n== admin-looking hostnames without Cloudflare Access ==")
    admin_hosts = sorted(h for h in ing_hosts if ADMIN_NAMES.search(h.split(".")[0]))
    for h in admin_hosts:
        if h in a.public_ok:
            print(f"  {h}: public on purpose (--public-ok)")
            continue
        try:
            state = access_state(h)
        except Exception as exc:
            print(f"  {h}: COULD NOT CHECK - {exc}")
            problems.append(f"admin-check:{h}")
            continue
        if state == "access":
            print(f"  {h}: behind Cloudflare Access")
        else:
            print(f"  {h}: PUBLIC ({state}), no Access login in front of it")
            problems.append(f"admin-no-access:{h}")
    if not admin_hosts:
        print("  none by name (a public admin tool under another name is not detected)")

    print("\n== certificate resolvers that cannot renew behind the tunnel ==")
    try:
        routers = get(f"{a.traefik_api}/api/http/routers", timeout=10)
    except Exception as exc:
        print(f"  COULD NOT CHECK - Traefik API unreachable at {a.traefik_api} ({exc})")
        print("  run this on the box")
        problems.append("traefik:unreachable")
    else:
        bad = [r for r in routers
               if (r.get("tls") or {}).get("certResolver") not in (None, a.resolver)]
        for r in bad:
            print(f"  {r['tls']['certResolver']}: {r.get('rule', '?')}  ({r.get('name')})")
            problems.append(f"resolver:{r.get('name')}")
        if not bad:
            print(f"  none  ({len(routers)} routers checked, all on '{a.resolver}' or no TLS)")

    print("\n== tunnel ==")
    unit_list = [line.split()[0] for line in
                 sh(["systemctl", "list-units", "cloudflared*.service", "--all", "--plain", "--no-legend"]).splitlines()
                 if line.strip()]
    if not unit_list:
        print("  no cloudflared unit found")
        problems.append("unit:none")
    remote = False
    for u in unit_list:
        state = sh(["systemctl", "is-active", u]).strip() or "unknown"
        print(f"  {u:<28} {state}")
        if state != "active":
            problems.append(f"unit:{u}")
        es = sh(["systemctl", "show", "-p", "ExecStart", "-p", "Environment", "--value", u])
        if "--token" in es or "TUNNEL_TOKEN" in es:
            remote = True
    if remote:
        print("  remotely managed: the local config is NOT what runs. Check ingress in the dashboard or API.")
        notes.append("remote tunnel: ingress not audited")
    elif conf.strip() and ingress:
        print(f"  ingress rules: {len(ingress)}")
        if ingress[-1] != {"service": "http_status:404"}:
            print("  the http_status:404 catch-all is not the last rule")
            problems.append("ingress:catch-all-not-last")
        loop = [r.get("hostname") for r in ingress
                if re.match(r"^https?://(localhost|127\.0\.0\.1):80/?$", str(r.get("service", "")))]
        for h in loop:
            print(f"  {h} targets port 80: loops through Traefik's redirect")
            problems.append(f"ingress-80:{h}")
    elif not conf.strip():
        print(f"  {a.tunnel_config}: not readable (run with sudo)")
        problems.append("ingress:unreadable")

    print()
    for n in notes:
        print(f"note: {n}")
    if problems:
        print(f"PROBLEMS FOUND ({len(problems)}): " + ", ".join(problems))
        return 1
    print("OK - nothing exposed that should not be")
    return 0


if __name__ == "__main__":
    sys.exit(main())
