---
name: expo-local-build
description: Build an Expo / React Native iOS app on your own Mac with `eas build --local` (free, no build credits) and upload it to TestFlight with `eas submit`. Falls back to an EAS cloud build when there is no Mac or the config says cloud. Use when the user says "ship a build", "push to TestFlight", "deploy the iOS app", "release a new build", "build locally", "eas build failed", "signing failed", "errSecInternalComponent", "Apple 401", or asks how to get their Expo app onto TestFlight without paying for cloud builds.
---

# Build locally, submit to TestFlight

Runs on: your Mac, in your own logged-in session. The cloud fallback runs
anywhere.

Always submits to TestFlight unless the user says build only.

## Before the first build

The user needs, once:

- An Apple Developer account: `guides/apple-developer.md`.
- Xcode, CocoaPods, fastlane and a signed-in Apple ID in Xcode: `guides/xcode.md`.
- The app record in App Store Connect: `guides/app-store-connect-setup.md`.
- An Expo account and a global `eas-cli`: `guides/expo-eas.md`.
- Optional but recommended: an App Store Connect API key, so no Apple ID
  prompt stops a build: `guides/app-store-connect-api-key.md`.

Run the `app-store-ready` skill first if the app has never been on TestFlight.

## Build and submit

From the Expo app folder (the one with `app.json` or `app.config.*` and
`eas.json`, never a monorepo root):

```bash
<skill-dir>/scripts/build.sh                        # production, local, submit
<skill-dir>/scripts/build.sh --skip-submit          # build only
<skill-dir>/scripts/build.sh --interactive          # first run, or a new app target
<skill-dir>/scripts/build.sh --cloud                # EAS servers instead of this Mac
<skill-dir>/scripts/build.sh --groups "Internal"    # also add the build to a TestFlight group
```

The script:

1. Checks it is in the app folder, and warns about a stray `app.json` above it.
2. Picks local or cloud: `--cloud`, `expo.buildMode` in the onebox config, or
   no Xcode on this machine.
3. Logs in to Expo with `eas login` state or `expo.tokenRef`.
4. Checks `eas.json`: the profile exists, and the submit key fields are all
   set or all unset and match the config.
5. Local only: stops in an SSH session, warns about an Xcode too old for
   uploads, forces a UTF-8 locale, checks CocoaPods, fastlane and Ruby, and passes the
   team ID and App Store Connect key to eas.
6. Builds to `build/ios-<profile>-<time>.ipa`, then runs
   `eas submit --path` on it.

## Who runs the build

Code signing needs the user's unlocked login keychain.

- Run it in a Terminal on the Mac, or from Claude Code running on that Mac in
  the user's own session.
- Never over SSH. It fails with `errSecInternalComponent`, or with a keychain
  password prompt that nobody can answer. The script refuses.
- The first signed build may show "codesign wants to use the key ... in your
  keychain". The user clicks **Always Allow** once. Tell them before the
  build starts, because the build waits on it.

## After the build

- `✔ Scheduled iOS submission` is the success signal. The `eas submit` exit
  code is not: the client can die afterwards while it polls. Do not resubmit.
  A second upload of the same build number is rejected as a duplicate.
- Confirm in App Store Connect, not in EAS output: use the `appstore-connect`
  skill (`asc.mjs builds`, then `asc.mjs wait <buildId>`).
- Processing takes 5 to 30 minutes. The TestFlight notification can lag the
  API by up to an hour.

## Versions and build numbers

- `expo.version` is the marketing version (`1.2.0`). Bump it for every
  release. Uploading a version that is already live or in review is rejected
  ("You've already submitted this version"), often long after the build.
- The build number must go up for every upload. Set
  `"cli": { "appVersionSource": "remote" }` and `"autoIncrement": true` on the
  production profile, and EAS manages it. Profiles without `autoIncrement` do
  not bump it.

## When it fails

Read `references/pitfalls.md`. It lists each error that cost a failed build,
what it really means, and the fix. The most common three:

- **"Apple 401 detected"** or a surprise Apple login prompt: EAS is using a
  stale App Store Connect key stored on its servers.
- **Build succeeds, app dies at launch, or a native module does nothing:**
  CocoaPods ran on the macOS system Ruby.
- **"Credentials are not set up"** in a non-interactive run: a new app target
  needs one `--interactive` run.

## Rules

- Local first. Cloud builds use the plan's monthly quota (see
  `guides/expo-eas.md`).
- Do not start a build because a PR merged. Ask first.
- Never run eas with `EXPO_DEBUG=1` in a shared log. It prints the API key.
