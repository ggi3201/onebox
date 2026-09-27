# Preflight: fixes, rebuilds, worktrees and traps

Read this when `scripts/preflight.mjs` reports a FAIL or a WARN, or when a
change does not show up on the simulator.

## Fix each finding

| Finding | Fix |
|---|---|
| No Metro serves this checkout | Start one from the Expo app folder on this worktree's port: `npx expo start --dev-client --port <port>`. Open the app from it. |
| The app runs another checkout's bundle | Do not stop the other Metro. Another session may own it. Open the dev client's server list and pick this checkout's port, or rebuild here with `npx expo run:ios --port <port> --device "<simulator>"`. |
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

## One Metro port per worktree

Every worktree runs its own Metro, so each needs its own port. Derive the port
from the worktree path, so it is the same every time and needs no registry:

```bash
# scripts/metro-port.sh — the main checkout keeps 8081, worktrees get 8100-8199
root=$(git rev-parse --show-toplevel)
if [ "$(git rev-parse --path-format=absolute --git-dir)" = "$(git rev-parse --path-format=absolute --git-common-dir)" ]; then
  echo 8081
else
  printf '%s' "$root" | cksum | awk '{print 8100 + ($1 % 100)}'
fi
```

Pass the same port to both commands:

```bash
npx expo start --dev-client --port "$(scripts/metro-port.sh)"
npx expo run:ios --port "$(scripts/metro-port.sh)"
```

`expo run:ios --port` builds that port into the debug binary as the default
Metro address. A binary built in one worktree keeps looking for that
worktree's port. Put both commands in `package.json` scripts so no one types
the port by hand.

Two ports can still collide (100 slots). The preflight shows it: the root of
the Metro on your port is not your checkout.

## Several agent sessions at once

- **One simulator per worktree** when two sessions test at the same time. Two
  sessions that share a simulator install over each other's builds, because the
  bundle id is the same. Create one: `xcrun simctl clone <udid> "<name>"` or
  `xcrun simctl create "<name>" "iPhone 17 Pro"`, then
  `xcrun simctl boot <new-udid>`. Some agent simulator tools ask the user to
  allow each new device once.
- **Do not stop a Metro or an API you did not start.** Check its project root
  first (the preflight prints it).
- **One API per dev database** if the API runs background workers. A second
  API on the same database also picks up the queued jobs.
- **Logs in your own folder.** Write Metro and build logs to the worktree or a
  scratch folder, not to a shared `/tmp/metro.log`.

## Traps from real sessions

- **Another session installed its build over yours.** The code is right, but
  the screen is old. The preflight's "binary from" time is later than your
  build. Use your own simulator.
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
