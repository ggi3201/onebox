# Live Activities

Runs on: your Mac (the app, Swift and the builds).

A Live Activity shows live data on the lock screen and in the Dynamic Island:
a workout clock, a delivery on its way, a timer. The app starts it, and it
stays there while the app is closed. The view is SwiftUI in a widget
extension. You cannot write it in JavaScript. This guide uses
`react-native-widget-extension`, an Expo config plugin that turns a folder of
Swift files into the widget extension during prebuild. Add a Live Activity
only when the app has something that changes while the user is away from it.

## What it costs

Nothing. ActivityKit is part of iOS. The plugin is free and open source.

A Live Activity is native code. It reaches users only in a new build, never
in an EAS Update ([ship-an-update.md](ship-an-update.md), step 1).

Apple's limits:

- A Live Activity stays active for up to **8 hours**. Then iOS ends it.
- After it ends, it stays on the lock screen for up to **4 hours** more,
  unless you remove it sooner.
- Its data, static and dynamic together, must stay under **4 KB**.

Checked 2026-10-15 at
https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities.

## Steps

### 1. Install the plugin

```bash
npx expo install react-native-widget-extension
```

Add it to `plugins` in `app.json`:

```json
["react-native-widget-extension", { "widgetsFolder": "widgets" }]
```

The options you may need:

| Option | Default | What it does |
|---|---|---|
| `widgetsFolder` | `widgets` | The folder with your Swift files, from the project root |
| `deploymentTarget` | `16.2` | The lowest iOS version for the app |
| `frequentUpdates` | `false` | Sets `NSSupportsLiveActivitiesFrequentUpdates` |
| `groupIdentifier` | none | An App Group (`group.com.example.myapp`), if the app and the widget share data |

The plugin also sets `NSSupportsLiveActivities` in the app's `Info.plist`. It
names the extension target `<AppName>Widgets`, with the bundle ID
`com.example.myapp.<AppName>Widgets`. It adds the target to the EAS
credentials list, so EAS makes a provisioning profile for it too.

Checked 2026-10-15 at
https://github.com/bndkt/react-native-widget-extension (version 0.3.0).

### 2. The Swift folder

The plugin reads fixed file names in `widgets/`:

- **`Attributes.swift`**: your `ActivityAttributes` type. The plugin copies it
  into the app and into the widget. Keep only data in it.
- **`Module.swift`**: the native module. It defines the functions JavaScript
  calls, such as `startActivity`, `updateActivity` and `endActivity`. It is
  compiled into the app, not into the widget. You write it for your own data;
  the library's example is a pizza delivery.
- **The other `.swift` files**: the widget bundle and the views for the lock
  screen and the Dynamic Island.

### 3. Send times, not countdowns

Put absolute times in the data (epoch milliseconds), never "seconds left".
SwiftUI's `Text(timerInterval:)` counts on its own from a date range. A
running clock then needs no updates at all. The app sends an update only when
the state changes, for example from "working" to "resting".

The app cannot run code while it is suspended. If the content stops being true
at a known time, give that time as the `staleDate`. iOS draws the view again
then, and the view reads `context.isStale` and shows the next state.

### 4. Call it from JavaScript, safely

The library calls `requireNativeModule` when it loads. In a build without the
module (Android, or an older build that gets your JavaScript through an EAS
Update) that throws, and a top-level `import` crashes the app at start. Load
it lazily and catch the error:

```ts
import { Platform } from "react-native";

let mod: any;
function liveActivity() {
  if (mod !== undefined) return mod;
  try {
    mod = Platform.OS === "ios" ? require("react-native-widget-extension") : null;
  } catch {
    mod = null;
  }
  return mod;
}

export function startLiveActivity(...args: unknown[]): boolean {
  try { return liveActivity()?.startActivity(...args) ?? false; } catch { return false; }
}
```

A missing Live Activity must never stop the main feature.

### 5. Do not start a second one after a relaunch

iOS keeps a Live Activity alive when the app is killed. After a relaunch the
app has no handle to it, but it is still on screen. Starting again leaves two,
and nothing can end the old one. In `Module.swift`, look up the running one
with `Activity<YourAttributes>.activities.first` before you start a new one.

### 6. Give the timer a fixed width

A timer `Text` reserves room for its widest value. Where it shares a row with
other text, set an explicit width that fits the longest time you expect:

```swift
Text(timerInterval: start...end, countsDown: false)
  .monospacedDigit()
  .frame(width: 64, alignment: .trailing)   // fits "1:59:59"; measure yours
```

Two fixes that look right and break:

- `.fixedSize()` in a `DynamicIslandExpandedRegion`: the region cannot give
  it a width, so the timer shows nothing. The build passes with no warning.
- `.layoutPriority(1)`: the timer takes the whole row, and the other text
  disappears.

### 7. Prebuild after every Swift edit

The plugin **copies** `widgets/` into `ios/` during prebuild. Nothing else
copies it. `npx expo run:ios` runs prebuild only when `app.json` or
`package.json` changed, and a Swift edit changes neither. So the app builds
and installs cleanly, with the old widget inside.

After any edit in `widgets/`:

```bash
npx expo prebuild --platform ios
```

Not sure which version is in the build? Compare the two copies:

```bash
diff widgets/MyLiveActivity.swift ios/<AppName>Widgets/MyLiveActivity.swift
```

Prebuild is slow, because it runs `pod install` again. While you only change
views, you may copy the view files into `ios/<AppName>Widgets/` by hand (not
`Module.swift`) and build again in Xcode. Run a real prebuild before you trust
the result.

### 8. Keep the fingerprint stable

The plugin also copies the Swift files into its own folder in
`node_modules` during prebuild. The `fingerprint` runtime version reads that
folder. So a fresh checkout and the same checkout after a prebuild give
different runtime versions. An EAS Update published from the wrong one
reaches no build, and nothing tells you.

Fingerprint the source folder and ignore the copies, in
`fingerprint.config.js` next to `app.json`:

```js
/** @type {import('expo/fingerprint').Config} */
module.exports = {
  extraSources: [{ type: "dir", filePath: "widgets", reasons: ["liveActivity"] }],
  ignorePaths: ["node_modules/react-native-widget-extension/ios/*.swift"],
};
```

In a monorepo, point `ignorePaths` at the `node_modules` where the package
really is, for example `../../node_modules/...`.

## Where the values go

| Value | Where |
|---|---|
| The plugin and its options | `plugins` in `app.json` |
| The Swift code | `widgets/` (in git); `ios/` is generated |
| The App Group, if you use one | `groupIdentifier` in the plugin options |
| Fingerprint rules | `fingerprint.config.js` |

No secrets.

## Check it works

1. Prebuild, then build to a simulator or a phone. Start the activity from
   the app.
2. Lock the screen. The activity shows on the lock screen. On a phone with a
   Dynamic Island, go to the home screen: it shows in the island.
3. Kill the app and open it again. There is still exactly one activity.
4. The runtime version is the same before and after a prebuild. In a fresh
   clone, after `npm ci`:

   ```bash
   npx expo-updates runtimeversion:resolve --platform ios
   npx expo prebuild --platform ios
   npx expo-updates runtimeversion:resolve --platform ios   # must print the same value
   ```

Check a fix on the surface and in the state where the bug showed. A bug on
the lock screen is not fixed because the compact island looks right.

## Common errors

**The timer shows dashes, like `1:--`, on the lock screen.** This is iOS, not
your layout. While the screen is idle, iOS shows the seconds of a timer as
dashes. The progress bar keeps moving, so it looks like a text bug. Tap the
screen and take the screenshot again. Digits now: iOS was idling. Still
dashes: the frame really is too narrow (step 6).

**"The fix did not take."** The build has the old widget. Prebuild (step 7)
and use the `diff` to check.

**The timer is empty in the expanded Dynamic Island.** `.fixedSize()` on the
timer. Use `.frame(width:)` (step 6).

**The other text on the lock screen is gone.** `.layoutPriority` on the
timer. Use `.frame(width:)` (step 6).

**The app crashes at start after an EAS Update.** A top-level import of the
library in a build that has no module. Load it lazily (step 4).

**Two Live Activities, and one never ends.** The app started a new one after
a relaunch. Adopt the running one (step 5).

**An EAS Update does not reach the build.** The runtime version changed with
the prebuild. Add `fingerprint.config.js` (step 8).

**`startActivity` returns false.** The user turned off Live Activities for
the app in Settings, or the device runs iOS below 16.2. Give `Module.swift`
an `areActivitiesEnabled()` that returns
`ActivityAuthorizationInfo().areActivitiesEnabled`. Call it first, and hide
the feature when it says no.
