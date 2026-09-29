# Command-line tools: your Mac and your box

Runs on: your Mac, and your box (over SSH).

The skills call command-line tools (CLIs). Most of them go on your Mac. The box
needs almost nothing from you: `box:box-setup` installs what it needs. This
page lists each tool, which skill needs it, and how to install it.

## What it costs

All tools here are free. The Mac tools take about 15 GB of disk with Xcode and
one Simulator runtime, and more for Docker images.

## On your Mac

Install [Homebrew](https://brew.sh) first. Most of the tools below come from it.

### Everyone needs these

| Tool | Why | Install |
|---|---|---|
| Xcode | iOS builds, the Simulator, `xcodebuild`, `xcrun` | [xcode.md](xcode.md). The full Xcode, not only the Command Line Tools. |
| `git` | every repo | comes with Xcode |
| Node.js 22 or 24 (LTS) | the skills' scripts, Expo, `eas` | `brew install node@22`, or a version manager such as `fnm` |
| `pnpm` | the package manager in a `/start:new-app` repo | `npm install -g pnpm@10`. Node 25 and newer no longer ship corepack, so the kit does not rely on it. In a repo, pnpm 10 runs the version that `package.json` pins in `packageManager`. |
| `jq` | reads the onebox config | `brew install jq` |
| `eas` | Expo builds and updates, also local builds | `npm install -g eas-cli`. See [expo-eas.md](expo-eas.md). |
| CocoaPods (`pod`) | local iOS builds | `brew install cocoapods`. See [xcode.md](xcode.md), step 6. |
| `fastlane` | `eas build --local` | `brew install fastlane` |

### Only for some skills

| Tool | Needed by | Install |
|---|---|---|
| Docker (Docker Desktop, OrbStack or Colima) | `dev:test-loop` and the API tests (a real Postgres) | the Docker Desktop or OrbStack app, or `brew install colima docker` |
| .NET SDK 10 or newer | a .NET API | `brew install --cask dotnet-sdk` |
| `gh` (GitHub CLI) | `box:box-setup` (the runner token), `box:staging-env` | `brew install gh`, then `gh auth login` |
| `ssh` | every `box` skill | comes with macOS. Make a key: see [vps.md](vps.md), step 1. |
| `python3` | `ship-ios:app-store-screenshots` (contact sheets, with Pillow) | comes with Xcode. Then `python3 -m pip install --user Pillow`. |
| Playwright and sharp | `ship-ios:app-store-screenshots` (rendering) | `mkdir -p ~/.cache/onebox-render && cd ~/.cache/onebox-render && npm i playwright sharp` |
| `ffmpeg` | `content:video` (chained shots) | `brew install ffmpeg` |
| `hcloud` | renting a Hetzner VPS | `brew install hcloud`. See [vps.md](vps.md). |
| Tailscale | reaching the box from anywhere | the app from the Mac App Store. See [remote-access.md](remote-access.md). |

### Your secrets tool, one of these

Pick one in [secrets.md](secrets.md). You need only that one.

| `secrets.tool` | Install |
|---|---|
| `env` | nothing |
| `doppler` | `brew install dopplerhq/cli/doppler`, then `doppler login` |
| `1password` | `brew install --cask 1password-cli`, then turn on the CLI integration in the 1Password app |

## On your box

Start from **Ubuntu Server LTS**, x86_64. You need only an SSH login with your
key:

- **A VPS:** add your SSH key when you create it. You log in as `root`. See
  [vps.md](vps.md).
- **A mini PC:** in the Ubuntu installer, tick the option to install the
  OpenSSH server. Then run `ssh-copy-id user@host` from your Mac.

Then run `box:box-setup` from your Mac. It installs the rest over SSH: the
admin user, `curl`, `jq`, `ufw`, `unattended-upgrades`, `restic`,
`python3-yaml`, Docker with the Compose plugin, Traefik and `cloudflared`. Do
not set up Traefik or `cloudflared` by hand first. The setup refuses a box
that already runs a tunnel or a proxy it did not set up.

Two more, and only if you want them:

- **Tailscale**, to reach the box from anywhere without an open SSH port:
  [remote-access.md](remote-access.md).
- **The GitHub Actions runner**, for deploy on push. `box:box-setup` sets it
  up (its `references/runner.md`). You do not install it by hand.

You never install Node, .NET or Postgres on the box. They run inside Docker
images.

## Check it works

On your Mac:

```bash
xcodebuild -version && node -v && pnpm -v && jq --version && eas --version && pod --version && fastlane --version
```

Each line prints a version. With an API, also `docker info` and, for .NET,
`dotnet --version`.

On the box, after `box:box-setup`, its `check` phase must end with `0 fail`.

## Common errors

- **`xcode-select: error: tool 'xcodebuild' requires Xcode`.** The Command Line
  Tools are selected, not Xcode. Run
  `sudo xcode-select -s /Applications/Xcode.app`.
- **`pnpm -v` fails with `Cannot find module ... pnpm.cjs`.** Corepack picked a
  pnpm version it cannot start (pnpm 12). Stop using corepack for pnpm and
  install it directly: `npm install -g pnpm@10`. If `corepack: command not
  found`, your Node is 25 or newer and has no corepack; the same command works.
- **`npx eas-cli` fails with `Cannot find module 'fdir'`.** Use the global
  `eas` from `npm install -g eas-cli`.
- **`docker info` says it cannot connect.** The Docker app or Colima is not
  running. Start it, then try again.
- **`pod install` in an agent crashes with `ASCII-8BIT`, or runs on Ruby
  2.6, while your Terminal works.** The agent's shell has no UTF-8 locale.
  Also, macOS runs `path_helper` from `/etc/zprofile`, after `~/.zshenv`, in
  every login shell, and it puts the system folders (`/usr/bin`) back in
  front of a Ruby you added in `~/.zshenv`. Putting the Ruby path in
  `~/.zshenv` is not enough by itself. Fix: put Homebrew's or rbenv's bin
  first in `~/.zprofile` (it runs after `path_helper`), and set
  `export LANG="${LANG:-en_US.UTF-8}"` in `~/.zshenv` so every shell has a
  UTF-8 locale. Check the agent's own shell with `echo $LANG` and
  `which ruby pod`. Reproduce a clean login shell with
  `env -i HOME=$HOME PATH=/usr/bin:/bin TERM=dumb zsh -lc 'which ruby; echo $LANG'`.
  After a failed `pod install`, delete the generated `ios/` folder before you
  retry.
