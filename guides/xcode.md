# Xcode

Runs on: your Mac.

Xcode is Apple's free developer tool. It contains the iOS SDK, the compiler,
code signing, and the iOS Simulator. You need it on your Mac to build an iOS
app locally, including `eas build --local` and `npx expo run:ios`. Install it
in Phase 0, right after you join the Apple Developer Program.

## What it costs

- Free. It runs only on macOS.
- **App Store Connect only accepts builds from a current Xcode.** Since
  2026-04-28, uploads must be built with **Xcode 26 or later** using the
  **iOS 26 SDK**. Checked 2026-09-28 at
  https://developer.apple.com/news/upcoming-requirements/. Apple raises this
  every spring, so check that page again if this date is old.
- Disk space: Xcode 26 takes roughly 8 to 10 GB on disk, and each iOS
  Simulator runtime adds several GB more. Keep at least 40 GB free for the
  install and your first builds.

No Mac? You can still build in the EAS cloud (see [expo-eas.md](expo-eas.md)), but you
cannot run the simulator or do local builds.

## Which Xcode for your Expo SDK

Your app's Expo SDK decides the Xcode, not "the newest". Checked 2026-10-09 at
https://docs.expo.dev/versions/latest/ and https://expo.dev/changelog/sdk-57.

| Expo SDK | Xcode |
|---|---|
| 55 | 26.2 or later, but not 27 |
| 56 | 26.4 or later, but not 27 |
| 57 | 26.4 or later. Xcode 27 only with scene support turned on (below) |

**Xcode 27 builds with the iOS 27 SDK, and an app built with it must use the
UIKit scene life cycle, or it does not launch on iOS 27.** SDK 57 can do that
from `expo` 57.0.23. Run `npx expo install --fix`, then turn it on in
`app.json`:

```json
["expo-build-properties", { "ios": { "enableSceneSupport": true } }]
```

That entry goes in `expo.plugins` (`npx expo install expo-build-properties`
first). Then test the app on an iOS 27 device or Simulator before you ship.
Older SDKs have no scene support: stay on Xcode 26 until you upgrade the SDK.

## Steps

1. **Install Xcode.**
   - The Mac App Store installs the newest Xcode (27 now). Use it only if the
     table above allows it for your SDK.
   - Otherwise, download the Xcode the table names from
     https://developer.apple.com/download/ (sign in with your Apple Account),
     unpack it, and move it to `/Applications`. Two versions can sit side by
     side, for example `/Applications/Xcode-26.4.app`; point the command-line
     tools at the one you build with (step 3).
   Your macOS version limits which Xcode you can install. If the App Store
   says your Mac is too old, update macOS first.
2. **Open Xcode once.** It installs extra components on first launch. Accept
   the license when it asks. From a terminal you can accept it with:
   ```bash
   sudo xcodebuild -license accept
   ```
3. **Point the command-line tools at this Xcode.** In Xcode, open
   **Xcode > Settings… > Locations** and choose the version you build with in
   the **Command Line Tools** menu. Or from a terminal:
   ```bash
   sudo xcode-select -s /Applications/Xcode.app
   ```
   (`xcode-select --install` installs only the small Command Line Tools
   package. That is not enough for iOS builds; you need the full Xcode.)
4. **Download an iOS Simulator runtime.** Open **Xcode > Settings… >
   Components**. Under Platform Support, find iOS and click **Get**.
5. **Sign in with your Apple Account.** Open **Xcode > Settings… > Accounts**,
   click the add button (+), and sign in with the Apple Account that is in
   your Apple Developer team (see [apple-developer.md](apple-developer.md)). Xcode then shows the
   team and can manage signing certificates.
6. **Install the build helpers for local EAS builds** with Homebrew
   (https://brew.sh):
   ```bash
   brew install cocoapods fastlane
   ```
   `eas build --local` needs both. Homebrew's CocoaPods brings its own Ruby,
   which avoids a silent failure with the old Ruby that ships with macOS (see
   Common errors). Watchman is only needed for projects on Expo SDK 55 or
   older: `brew install watchman`.

## Where the values go

Nothing to store. The onebox config key `expo.buildMode` decides whether
builds run here (`"local"`, the default) or on EAS servers (`"cloud"`).

## Check it works

```bash
xcodebuild -version        # the version the table above names for your SDK
xcode-select -p            # /Applications/Xcode.app/Contents/Developer
xcrun simctl list runtimes # at least one iOS runtime
xcrun simctl list devices available
pod --version && fastlane --version
```

Then, in your Expo app folder, `npx expo run:ios` should build and open the
app in the simulator.

## Common errors

- **The app does not launch on iOS 27** (it closes or stays black), but works
  on iOS 26. It was built with Xcode 27 without scene support. See "Which
  Xcode for your Expo SDK".

- **`xcode-select: error: tool 'xcodebuild' requires Xcode, but active
  developer directory ... is a command line tools instance`.** Run
  `sudo xcode-select -s /Applications/Xcode.app`.
- **"You have not agreed to the Xcode license agreements."** Run
  `sudo xcodebuild -license accept`, or open Xcode once.
- **No simulators in the list.** No iOS runtime is installed. Do step 4.
- **Upload rejected for the SDK version.** The build was made with an Xcode
  older than Apple's current minimum. Update Xcode and build again.
- **`pod install` "works", then the app crashes at launch, or a native
  feature silently does nothing. Or `pod install` crashes with
  `Unicode Normalization not appropriate for ASCII-8BIT`.** CocoaPods ran on
  the macOS system Ruby (2.6), or the shell has no UTF-8 locale (common in
  scripts, CI and agent shells). Expo needs Ruby 2.7 or later and a UTF-8
  locale. Use Homebrew's CocoaPods, and see "Common errors" in
  [tools.md](tools.md) for the fix and how to check it.
- **Not enough disk space during install.** The installer needs room for the
  download and the unpacked app at the same time. Free more space, or delete
  old simulator runtimes: `xcrun simctl runtime list`, then
  `xcrun simctl runtime delete <id>`.
