# Preflight: fixes, rebuilds, worktrees and traps

Read this when `scripts/preflight.mjs` reports a FAIL or a WARN, or when a
change does not show up on the simulator.

## Fix each finding

| Finding | Fix |
|---|---|
| No Metro serves this checkout | Start one from the Expo app folder on this worktree's port: `npx expo start --dev-client --port <port>`. Open the app from it. |
| The app runs another checkout's bundle | Do not stop the other Metro. Another session may own it. Open the dev client's server list and pick this checkout's port, or rebuild here with `npx expo run:ios --port <port> --device "<simulator>"`. |
| Another app is connected to this checkout's Metro | Two apps use one port, so the other app shows this app's code. Give each app its own port with `scripts/metro-port.sh` (below), start this Metro on its port, and rebuild this app with `npx expo run:ios --port <port>`. |
| This Metro runs in CI mode | Stop that Metro. Start it again without `CI`: `env -u CI npx expo start --dev-client --port <port>`. See "Metro in CI mode" below. |
| This Metro has no app connected | Open the app from this server: press `i` in the Metro terminal, or open the dev client and pick the port. |
| Two or more simulators booted | Choose one and pass its UDID to every command, or shut the others down: `xcrun simctl shutdown <udid>`. |
| Native package has no code in the binary | Rebuild: `npx expo run:ios --port <port>`. Then run the preflight with `--mark-built`. |
| Native package missing from `ios/Podfile.lock` | The same rebuild. `expo run:ios` runs prebuild and `pod install`. |
| `Podfile.lock` newer than the binary | The same rebuild. |
| Fingerprint changed | The same rebuild. |
| `app.json` changed after the build (WARN) | Rebuild only if the change is native: a plugin, a permission text, an entitlement, `infoPlist`, the icon or the splash screen. A version bump or `extra` does not need one. |

A binary that was built without a native package does not always crash. A
view from a missing package often renders as an empty or white box, the
placeholder React Native draws for a native view it does not know. That looks
like a styling bug. Style changes cannot fix it. One agent shipped a styling
"fix" for exactly this, and the user found it still broken.

## Reload or rebuild

| You changed | Do this |
|---|---|
| JS or TS code, styles, images that JS imports | Nothing. Fast Refresh applies it. |
| The initial value of a store or context, or code at module level | A full reload: `xcrun simctl terminate <udid> <bundle-id>`, then `launch`. Fast Refresh keeps store state, so old data can stay on screen. |
| `EXPO_PUBLIC_*` values or a `.env` file | Restart Metro with `--clear`. Metro writes these values into the bundle when it builds it. |
| A package with native code, a config plugin, permissions, entitlements, `infoPlist`, a native patch, the Podfile | Rebuild with `npx expo run:ios --port <port>`, then `preflight.mjs --mark-built`. |

When unsure, rebuild. It costs minutes. A wrong guess can cost hours.

## Metro in CI mode

When `CI` is `1` or `true` in Metro's environment, Expo turns off the file
watcher. Its log says "Metro is running in CI mode, reloads are disabled".
Metro then serves the bundle it built at start. No edit reaches the
simulator, and Fast Refresh and reload show old code. Expo Router's typed
routes (`.expo/types/router.d.ts`) are not generated again either, so `tsc`
fails on a new route.

Agent shells often set `CI=1` to stop tools from asking questions. Metro
inherits it. The preflight reads the Metro process's environment
(`ps -E -ww -o command= -p <pid>`) and fails when `CI` is on.

Metro does not need `CI=1` or a terminal. Start it in the background without
`CI`, with its log in the worktree:

```bash
mkdir -p .expo
env -u CI nohup npx expo start --dev-client --port <port> > .expo/metro.log 2>&1 < /dev/null &
```

`--non-interactive` does not help here. Current Expo CLI ignores it and prints
"use $CI=1 instead". Do not follow that advice for a dev server.

## One Metro port per app and per worktree

Every worktree runs its own Metro, so each needs its own port. So does every
app. If two apps both use 8081, the dev client of one app can reconnect to the
other app's Metro and show that app's code. Derive the port, so it is the same
every time and needs no registry:

- The main checkout gets 8200-8299, from the repo's folder name.
- A worktree gets 8100-8199, from the worktree path.

Copy `assets/metro-port.sh` to the app's `scripts/metro-port.sh`. Always call
it through `sh`: then it works without an exec bit too.

```bash
#!/bin/sh
# scripts/metro-port.sh: one Metro port per app and per worktree.
# Main checkout: 8200-8299, from the repo's folder name, so two apps' main
# checkouts do not share 8081. Worktrees: 8100-8199, from the worktree path.
root=$(git rev-parse --show-toplevel)
if [ "$(git rev-parse --path-format=absolute --git-dir)" = "$(git rev-parse --path-format=absolute --git-common-dir)" ]; then
  basename "$root" | cksum | awk '{print 8200 + ($1 % 100)}'
else
  printf '%s' "$root" | cksum | awk '{print 8100 + ($1 % 100)}'
fi
```

Pass the same port to both commands:

```bash
npx expo start --dev-client --port "$(sh scripts/metro-port.sh)"
npx expo run:ios --port "$(sh scripts/metro-port.sh)"
```

`expo run:ios --port` builds that port into the debug binary as the default
Metro address. A binary built in one worktree keeps looking for that
worktree's port. Put both commands in `package.json` scripts so no one types
the port by hand.

Two ports can still collide (100 slots in each range). The preflight shows
it: the root of the Metro on your port is not your checkout, or an app with
another bundle id is connected to your Metro.

## Several agent sessions at once

- **One simulator per worktree** when two sessions test at the same time. Two
  sessions that share a simulator install over each other's builds, because the
  bundle id is the same. Name it after the worktree and reuse it: each
  simulator keeps its own app data and caches, so a new one every session
  fills the disk. Create it only when it is missing:
  ```bash
  NAME="myapp-$(basename "$(git rev-parse --show-toplevel)")"
  U=$(xcrun simctl list devices -j | jq -r --arg n "$NAME" '.devices[][] | select(.name == $n and .isAvailable) | .udid' | head -1)
  [ -n "$U" ] || U=$(xcrun simctl clone <base udid> "$NAME")   # or: xcrun simctl create "$NAME" "iPhone 17 Pro"
  xcrun simctl boot "$U" 2>/dev/null || true                   # already booted is fine
  ```
  Clone a shut-down base simulator: a clone shares disk with it until it
  changes. When you remove the worktree, delete its simulator too:
  `xcrun simctl delete "$U"`. Some agent simulator tools ask the user to allow
  each new device once.
- **No native build per worktree.** Start this worktree's Metro, then run
  `scripts/dev-client.sh "$U" <port>` from the Expo app folder. It keys a
  cache on the Expo fingerprint and the Xcode build
  (`~/Library/Caches/onebox/dev-client/<bundle id>/`). A hit installs the
  cached `.app`. A miss runs `expo run:ios --no-bundler` once and caches what
  it installed. Then it launches with `--initialUrl http://localhost:<port>`,
  which skips the "Open in ...?" prompt, so one cached build serves every
  worktree's port. It keeps the last 3 builds per app.

  Measured on 2026-10-14 (Xcode 26.6, Expo SDK 57 skeleton, iPhone 17 Pro,
  iOS 26.5):

  | | Time to a loaded app | Disk |
  |---|---|---|
  | New worktree, native build (no cache) | 3 to 5 min | a new simulator: about 2.6 GB |
  | New worktree, cache hit, cloned simulator | about 1 min: `pnpm install` 4 s, clone 6 s, boot, install and launch 41 s, first bundle 5 s | the clone: about 250 MB written after its first boot; the worktree with `node_modules`: about 30 MB; the cache: 144 MB per build |

  `du` counts a clone at its full size, because it cannot see what APFS
  shares. Count the files written after the clone instead.

  Dead ends, measured on Xcode 26 with the React Native prebuilt core, so
  nobody retries them: DerivedData reused from another worktree path (full
  rebuild, the paths are baked in), `USE_CCACHE=1` (Xcode never calls it),
  Xcode's compilation cache across paths, one fixed build folder with branch
  switches (`expo prebuild` and `pod install` force a full rebuild), and
  symlinked paths. Never put build-cache settings in `app.json` or
  `package.json`: the fingerprint hashes them, and the update runtime would
  change.
- **Do not stop a Metro or an API you did not start.** Check its project root
  first (the preflight prints it).
- **A `dotnet watch` API needs `--non-interactive`.** Without it, a change
  that needs a restart makes it wait on "Do you want to restart your app?".
  Nobody answers in an agent's shell, and the old API keeps the port. Check
  the `dev:api` script.
- **Stopping a `dotnet watch` API: stop the `dotnet-watch.dll` process.**
  `kill` on the PID that `&` returned stops only the `dotnet` host. The watch
  child keeps running and keeps the port. Find the watch for this checkout
  by its working folder, and stop only that one:
  ```bash
  for p in $(pgrep -f dotnet-watch.dll); do
    echo "$p $(lsof -a -p "$p" -d cwd -Fn | sed -n 's/^n//p')"
  done
  ```
- **One API per dev database** if the API runs background workers. A second
  API on the same database also picks up the queued jobs.
- **Logs in your own folder.** Write Metro and build logs to the worktree or a
  scratch folder, not to a shared `/tmp/metro.log`.

## Traps from real sessions

- **Another session installed its build over yours.** The code is right, but
  the screen is old. The preflight's "binary from" time is later than your
  build. Use your own simulator.
- **Metro ran with `CI=1` from an agent shell.** The preflight passed, but
  Metro did not watch files. `tsc` failed on a new route against stale typed
  routes, and the simulator would have shown old code. The preflight now
  fails on it. Restart Metro without `CI`.
- **`pod install` printed a Ruby error and exited 0.** Read the output, not
  just the exit code. Use Homebrew's CocoaPods and a UTF-8 locale (see the
  `ship-ios:expo-local-build` skill).
- **`xcodebuild ... | tail` hides the exit code.** Use `set -o pipefail`, or
  save `${PIPESTATUS[0]}`.
- **Taps during an animation hit the wrong control**, and can create real
  rows in the dev database. Wait, take a screenshot, then tap.
- **A test lane that renders with `react-native-web` passes while the phone is
  broken.** It has no keyboard, no native layout and no real scroll. Keyboard
  overlap, row wrapping and scroll position need a device.
- **The screenshot is in pixels, taps are in points.** Divide by the screen
  scale (3 on current iPhones) before you tap by coordinates.
