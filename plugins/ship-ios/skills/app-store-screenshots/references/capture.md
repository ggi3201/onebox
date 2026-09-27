# Getting good captures

The set is only as good as its screens. If the existing captures look weak,
for example a blurry food photo or an empty state, take new ones before you
design around them.

## Survey what exists

- Look for earlier sets and raw captures. Places to check: the Desktop, a
  marketing folder, the repo's docs, and earlier App Store folders.
  `sheet.py grid` puts them all into one image with file names.
- Note the size of each capture. A 600px-wide capture turns soft in a 6.9"
  set. Prefer 1320×2868 from an iPhone Pro Max simulator, or 1206×2622 from
  a device.

## Pick the content, not only the screen

The data inside the screen decides whether it looks good. If the app has a
local database or API, list the candidate content and look at it in bulk. Do
not scroll the app to find it.

- Query the dev database read-only for items that have images. Download the
  images and run `sheet.py grid` over them. Choose styled, well-lit photos
  with short titles. Skip video frames, text overlays and hands.
- Get each chosen item's id so you can deep-link straight to it.

## Drive the simulator

Use the iOS Simulator tool, or `xcrun simctl`. Get the booted device and the
app's bundle id with `xcrun simctl listapps <udid>`.

1. Clean the status bar first, and clear it again when you are done:
   ```
   xcrun simctl status_bar <udid> override --time 09:41 --batteryState discharging --batteryLevel 100 --wifiBars 3 --cellularBars 4 --dataNetwork wifi
   xcrun simctl status_bar <udid> clear
   ```
   This removes the green charging battery and the random time.
2. Deep-link to a screen with `<scheme>:///<route>`. The scheme is in the app
   config, and the routes are the file-based routes (for example
   `recipe/[id]`). The app can take 3–5 seconds to navigate, so wait before
   you capture.
3. Capture at full resolution with
   `xcrun simctl io <udid> screenshot <file.png>`. The tool's own screenshot
   is scaled; use it only to look.
4. In dev builds, close the LogBox toast ("Open debugger to view warnings")
   before you capture.
5. Show the feature in use. For example, select 2× so a "Scaled to 12
   servings" banner shows. Scroll so that no title sits under the status bar.
   Open a bottom sheet part way with a slow touch path.
6. Tap coordinates are in points. The screenshot image is at a different
   scale, so divide by that scale first.

## Throwaway simulators for exact sizes

Do not capture on the user's everyday simulator. It holds their other apps and
logged-in test accounts. Make a new one, capture, and delete it:

```bash
SIM=$(xcrun simctl create shots-69 "iPhone 17 Pro Max")    # any 6.9" model
xcrun simctl boot "$SIM"
xcrun simctl install "$SIM" path/to/MyApp.app
xcrun simctl launch "$SIM" com.example.myapp
xcrun simctl io "$SIM" screenshot shot.png
xcrun simctl shutdown "$SIM" && xcrun simctl delete "$SIM"
```

`xcrun simctl list devicetypes` and `xcrun simctl list runtimes` show what is
installed. For a 6.5" set, use an older Max model (for example an iPhone 11 Pro
Max type) with a runtime it supports.

A fresh simulator has no account and no data, so it shows the empty state.
That is fine for checking layout, but not for the store. Seed data, or sign in
to the dev build's seeded account, before you capture.

`simctl openurl` can raise an "Open in <App>?" system dialog. If you cannot tap
it, restart SpringBoard to clear it:
`xcrun simctl spawn "$SIM" launchctl kickstart -k system/com.apple.SpringBoard`.

## Device captures

Real device screenshots have no Dynamic Island. Add one in the frame (the
template's `.island`). Leave it off when the capture already has a pill, for
example a live activity.

## Do not

- Do not regenerate or repaint UI, people or results. Crop and scale only.
- Do not type real credentials into the app. Use the dev build's seeded account.
