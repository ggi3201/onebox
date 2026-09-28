# Remote access: fix things from your phone

Runs on: your box, your Mac and your phone.

This guide puts your box, your Mac and your phone on one private network. You
can then reach the box from anywhere without opening a port to the internet,
and ask your coding agent to do the devops work while you are away from the
desk.

If you already know Tailscale, skip to
[Your coding agent as your devops person](#your-coding-agent-as-your-devops-person).

## What it is and what it costs

A mesh VPN gives each of your devices a private address that works from any
network: home Wi-Fi, a café, mobile data. Traffic goes directly between your
devices when it can, and is encrypted end to end.

| Tool | Free plan (checked 2026-09-28) | Pick it when |
|---|---|---|
| **Tailscale** (recommended) | Personal plan: up to 6 users, unlimited devices | You want names like `box.your-tailnet.ts.net` and an iPhone app that just works |
| ZeroTier | New accounts: 10 devices, 1 network | You already use it, or you want to self-host the controller |

Both have iOS, macOS and Linux apps. The steps below use Tailscale. ZeroTier
works the same way; see [ZeroTier instead](#zerotier-instead).

## The setup

```
phone ──┐   Claude app (Remote Control), Termius
        │
        ├── tailnet ──── Mac   Claude Code, Xcode, your repos
        │
        └──────────────── box   Docker, your API, backups
```

- **The box** runs your services. Its SSH port is only reachable over the
  tailnet.
- **The Mac** runs Claude Code and does iOS builds. It reaches the box with
  `ssh box`.
- **The phone** drives Claude Code on the Mac, or opens a terminal on the box.

## Steps

### 1. Install Tailscale on all three

- **Box:** `curl -fsSL https://tailscale.com/install.sh | sh`, then
  `sudo tailscale up`. Open the link it prints and sign in.
- **Mac:** install the Tailscale app from the Mac App Store or
  tailscale.com/download, and sign in with the same account.
- **Phone:** install Tailscale from the App Store and sign in.

Run `tailscale status` on the box. It lists all three devices.

### 2. Names and key expiry

In the Tailscale admin console:

1. **DNS:** check that MagicDNS is on. It usually is for new tailnets. Your
   box is then reachable as `<machine-name>.<your-tailnet>.ts.net`. Rename the
   machine to something short, such as `box`.
2. **Machines → the box → Disable key expiry.** Device keys expire after 180
   days by default. On a phone that means a login prompt. On the box, which
   nobody logs into, it means the box silently drops off the tailnet.

### 3. One SSH alias on the Mac

Put this in `~/.ssh/config` on the Mac:

```
Host *
  UseKeychain yes
  AddKeysToAgent yes
  IdentityFile ~/.ssh/id_ed25519

Host box
  HostName box.your-tailnet.ts.net
  User alice
```

Then run this once, and enter your key's passphrase:

```bash
ssh-add --apple-use-keychain ~/.ssh/id_ed25519
```

Why this matters:

- **`ssh box` works at home and away.** Tailscale finds the direct path on your
  LAN when you are home, so there is no need for a second "LAN" alias.
- **The passphrase lives in the macOS Keychain.** An agent that runs `ssh box`
  or `git push` in a non-interactive shell cannot answer a passphrase prompt.
  Without the Keychain entry, the command just hangs.
- **Skills use the alias.** Set `"box": { "ssh": "box" }` in
  `~/.config/onebox/config.json` (see
  [CONFIG.md](https://github.com/ggi3201/onebox/blob/main/CONFIG.md)). Every
  box skill then reaches the box the same way you do.

### 4. Close SSH to the internet (VPS only)

A mini PC at home behind your router needs nothing here. A VPS has a public
IP, so allow SSH only on the Tailscale interface.

Keep your VPS provider's web console open while you do this, in case you lock
yourself out:

```bash
sudo ufw allow in on tailscale0 to any port 22 proto tcp
sudo ufw delete allow 22/tcp
sudo ufw status
```

`box:box-setup` does the same with its `--ssh-tailscale-only` flag. It refuses
to run if Tailscale is not up yet, so you cannot lock yourself out that way.

### 5. A terminal on the phone

Use any SSH app. Termius is a common choice on iOS.

1. In the app, create a new SSH key and copy its public key.
2. On the Mac, add it to the box: `ssh box 'cat >> ~/.ssh/authorized_keys'`,
   paste the key, then press Ctrl-D.
3. Add a host in the app: address `box.your-tailnet.ts.net`, user `alice`,
   the key from step 1.
4. Turn Wi-Fi off and connect over mobile data to prove it works away from
   home.

Alternative: **Tailscale SSH** (`sudo tailscale up --ssh` on the box). It uses
your tailnet login instead of SSH keys, so there are no keys to copy to the
phone. It is fine for a personal tailnet. With plain keys you have one less
moving part.

## Your coding agent as your devops person

Once the three devices can reach each other, you can hand the terminal work to
your coding agent from your phone. There are two ways, and you can use both.
Way A uses Claude Code's Remote Control. Way B works with any agent that runs
in a terminal.

### A. Drive Claude Code on your Mac from the phone

Start or open a Claude Code session on the Mac, in the folder with your repos,
and turn on Remote Control for it. Then open that session in the Claude app on
the phone. The session runs on the Mac, so it has everything: your repos, the
`box` alias, your secrets tool, Xcode and the onebox skills.

Ask it things like:

- "Check the API logs on the box for errors in the last hour."
- "The site is down. Find out why and fix it."
- "Deploy main and tell me when the health check is green."

Keep the Mac awake while you are away: turn on the keep-awake setting in the
Claude desktop app, or run `caffeinate -dis` in a terminal. A sleeping Mac
drops the session.

### B. Run Claude Code on the box itself

For when the Mac is off. SSH to the box from the phone, then run Claude Code
inside `tmux`, so a dropped connection does not kill the session:

```bash
tmux new -As ops      # attach to "ops", or create it
claude
```

Log in to Claude Code once on the box. Next time, `tmux attach -t ops` puts you
back where you left off. Another terminal agent works the same way: start it
inside `tmux` instead of `claude`. The box skills work here too, with `box.ssh` set to
`localhost` in the box's own config.

### What the agent should not do from the phone

- **Sign iOS builds over SSH.** See the next section.
- **Anything destructive without asking you first:** deleting volumes,
  dropping databases, force-pushing. A phone screen makes it easy to approve
  without reading. Read before you tap.

## iOS signing over SSH: the keychain wall

If an agent (or you) starts a local signed iOS build on the Mac over SSH, it
can fail with:

```
errSecInternalComponent
```

or `security unlock-keychain` answers "User interaction is not allowed".
The signing certificate is present, but macOS refuses to let `codesign` use
its private key until a person at the Mac approves it once.

The fix:

1. Sit at the Mac and run one signed build in your own Terminal
   (`ship-ios:expo-local-build` prints the command).
2. When macOS asks "codesign wants to use the key …", enter your login
   password and click **Always Allow**.

After that, remote and agent-driven builds sign without asking. If you are
away and have not done this yet, build on EAS instead
(`expo.buildMode: "cloud"`). It costs build credits, but needs no keychain.

## Where the values go

| Value | Where |
|---|---|
| SSH alias for the box | `box.ssh` in `~/.config/onebox/config.json`, e.g. `"box"` |
| The box's tailnet name | `HostName` in `~/.ssh/config` on the Mac, and in your phone's SSH app |
| Phone SSH key | the box's `~/.ssh/authorized_keys` |

No secret goes in the onebox config. Tailscale's own login lives in the
Tailscale apps.

## Check it works

- `tailscale status` on the box shows the Mac and the phone.
- On the Mac: `ssh box uptime` works at home, and again from a phone hotspot.
- On the phone, with Wi-Fi off: the SSH app connects to the box.
- On a VPS: from a machine outside the tailnet, `nc -vz <public-ip> 22` fails.
- From the Claude app: ask the Mac session to run `ssh box docker ps`, and it
  answers.

## Common errors

- **The box vanished from the tailnet after a few months.** Key expiry. Log in
  on the box (`sudo tailscale up`), then disable key expiry for it (step 2).
- **`box.your-tailnet.ts.net` does not resolve on the Mac.** Tailscale's DNS is
  off in the Mac app's settings ("Use Tailscale DNS"), or another VPN is
  overriding DNS.
- **`ssh box` hangs in an agent session but works in your terminal.** The key
  passphrase is not in the Keychain. Run the `ssh-add --apple-use-keychain`
  command from step 3.
- **The Remote Control session is gone.** The Mac went to sleep. Turn on
  keep-awake.
- **Locked out of a VPS after changing ufw.** Use the provider's web console,
  run `sudo ufw allow 22/tcp`, and fix the tailnet first.

## ZeroTier instead

1. Create a network at my.zerotier.com and copy its network ID.
2. Install ZeroTier on the box (`curl -s https://install.zerotier.com | sudo bash`),
   the Mac and the phone, and join the network: `sudo zerotier-cli join <network-id>`
   on the box, the "Join network" button in the apps.
3. Authorize each device in the network's member list.
4. Give the box a fixed managed IP there, and use that IP as `HostName` in
   `~/.ssh/config`. ZeroTier has no MagicDNS-style names by default.
5. Allow SSH only on the ZeroTier interface on a VPS
   (`sudo ufw allow in on <zt-interface> to any port 22 proto tcp`; find the
   interface with `ip link`, it starts with `zt`).

Everything from step 3 of the Tailscale steps onward is the same.
