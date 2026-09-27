# A small VPS

Used by: `box:box-setup` when `box.type` is `vps`.

## What it is and what it costs

A VPS is a small rented server with a public IP. It runs the same stack as a
mini PC at home: Docker, Traefik, a Cloudflare tunnel. Pick one when you have no
spare machine at home, or your home connection is not reliable enough.

What to get: **x86_64, 2 vCPU, 4 GB RAM, 40 GB disk or more, Ubuntu LTS.** That
runs a few APIs, their Postgres databases and some sites. Do not buy more "to be
safe". Resize later if the box is really short.

Prices, checked **2026-09-28** (Hetzner Cloud, Germany/Finland, excluding VAT):

| Plan | Size | Price | Note |
|---|---|---|---|
| CX23 (cost-optimized) | 2 vCPU, 4 GB, 40 GB | about €5.50-6.00/month | Hetzner's page showed every CX plan as "not available" on this date. |
| CPX22 (regular) | 2 vCPU, 4 GB, 80 GB | about €19.50-20.00/month | Orderable; also in US and Singapore locations. |

Hetzner raised cloud prices in April and June 2026, and trackers disagree on
the exact CX23 figure. Check the current price on hetzner.com/cloud before you
order. A primary IPv4 address adds about €0.50/month. **Keep it**: some
services a box needs (GitHub, for one) have not reliably worked over IPv6 only.

Sources: hetzner.com/cloud/cost-optimized (sizes and availability),
costgoat.com/pricing/hetzner (updated 2026-09-05),
vincentschmalbach.com/hetzner-cheap-cloud-unavailable-price-increases (price history).

Any provider works if it gives you an x86 Ubuntu VPS with a public IPv4 and
lets you add an SSH key at creation. The steps below use Hetzner and its `hcloud`
CLI, because CLI commands do not change as often as a web page.

## Steps

### 1. An SSH key on your Mac

```bash
ls ~/.ssh/id_ed25519.pub || ssh-keygen -t ed25519 -C "you@example.com"
```

### 2. Account and API token

1. Create a Hetzner account and a Cloud project in the Cloud Console.
2. In the project, open the page for API tokens and create one with read and
   write access. Copy it once.
3. On your Mac: `brew install hcloud`, then `hcloud context create onebox` and
   paste the token when asked. The token stays in hcloud's own config.

### 3. Create the server with your key

```bash
hcloud ssh-key create --name mac --public-key-from-file ~/.ssh/id_ed25519.pub
hcloud server-type list          # check the type exists and its price
hcloud image list --type system | grep -i ubuntu
hcloud server create --name box --type cx23 --image ubuntu-24.04 --ssh-key mac --location fsn1
```

If `cx23` is not available, try another location (`nbg1`, `hel1`) or `cpx22`.
Pick the location closest to your users.

The server starts with only `root` and your key. There is no root password.

### 4. Optional: the provider firewall

Hetzner's cloud firewall filters traffic before it reaches the server, so
Docker cannot bypass it. With a tunnel you need only SSH:

```bash
hcloud firewall create --name box
hcloud firewall add-rule box --direction in --protocol tcp --port 22 \
  --source-ips 0.0.0.0/0 --source-ips ::/0
hcloud firewall apply-to-resource box --type server --server box
```

Closing SSH too (Tailscale only) is possible. Then the Hetzner console is your
only way in when Tailscale breaks. [remote-access.md](remote-access.md) sets up
Tailscale on the box, your Mac and your phone.

### 5. Run box-setup

Ask Claude to run `box:box-setup` with `box.type: vps`. It starts as `root`,
creates your admin user, and turns off root login at the end.

## Where the values go

`~/.config/onebox/config.json`:

```json
{ "box": { "type": "vps", "ssh": "alice@203.0.113.10", "tunnel": "cloudflare" } }
```

Use `root@<ip>` only until box-setup has created your user.

## Check it works

```bash
hcloud server list
ssh root@<ip> 'uname -m; . /etc/os-release; echo $PRETTY_NAME'    # x86_64, Ubuntu
```

After box-setup: `ssh alice@<ip> 'sudo bash /root/box-setup.sh check'` (or
wherever you copied the script) ends with `0 fail`. That covers the security
baseline too: password and root login off, ufw on, automatic security
updates, no container port on the public IP, and the Docker socket only in
Traefik.

## Common errors

| Symptom | Cause |
|---|---|
| `REMOTE HOST IDENTIFICATION HAS CHANGED` | You rebuilt a server on the same IP. `ssh-keygen -R <ip>`, then connect again. |
| `Permission denied (publickey)` as root | The key was not added at creation. Rebuild with `--ssh-key`, or use the console. |
| Locked out after a firewall or SSH change | Use the web console in the Hetzner Cloud Console, or boot the rescue system. |
| Image build killed, exit code 137 | Out of memory. box-setup adds 2 GB of swap on a VPS; check `free -m`. |
| `server type not available` | Stock is out for that type or location. Try another location or `cpx22`. |
