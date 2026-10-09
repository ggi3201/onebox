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

- An Apple Developer account: `https://onebox.lokkesveen.com/guides/apple-developer.md`.
- Xcode, CocoaPods, fastlane and a signed-in Apple ID in Xcode: `https://onebox.lokkesveen.com/guides/xcode.md`.
- The app record in App Store Connect: `https://onebox.lokkesveen.com/guides/app-store-connect-setup.md`.
- An Expo account and a global `eas-cli`: `https://onebox.lokkesveen.com/guides/expo-eas.md`.
- Optional but recommended: an App Store Connect API key, so no Apple ID
  prompt stops a build: `https://onebox.lokkesveen.com/guides/app-store-connect-api-key.md`.

Run the `app-store-ready` skill first if the app has never been on TestFlight.

## Build and submit

From the Expo app folder (the one with `app.json` or `app.config.*` and
`eas.json`, never a monorepo root):

```bash
<skill-dir>/scripts/build.sh                        # production, local, submit
<skill-dir>/scripts/build.sh --skip-submit          # build only
<skill-dir>/scripts/build.sh --interactive          # first run, or a new app target
<skill-dir>/scripts/build.sh --cloud                # EAS servers instead of this Mac
<skill-dir>/scripts/build.sh --groups "Internal"    # also add the build to a TestFlight group (uses eas submit)
<skill-dir>/scripts/build.sh --upload eas           # upload through eas submit instead of altool
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
6. Takes a lock for the app's bundle id, so a second agent cannot build the
   same app at the same time. Two parallel builds upload two builds whose
   numbers do not match their upload order.
7. Builds to `build/ios-<profile>-<time>.ipa`, then uploads it straight to
   Apple with `xcrun altool` and the App Store Connect key from the config.
   That takes seconds. Without a key, or with `--groups`, it uses
   `eas submit`, which can wait in Expo's queue for hours.

## Who runs the build

Code signing needs the user's unlocked login keychain.

- Run it in a Terminal on the Mac, or from your coding agent running on that Mac in
  the user's own session.
- Never over SSH. It fails with `errSecInternalComponent`, or with a keychain
  password prompt that nobody can answer. The script refuses.
- The first signed build may show "codesign wants to use the key ... in your
  keychain". The user clicks **Always Allow** once. Tell them before the
  build starts, because the build waits on it.

## After the build

- With altool, `UPLOAD SUCCEEDED` is the success signal. With eas submit,
  `✔ Scheduled iOS submission` is. The `eas submit` exit
  code is not: the client can die afterwards while it polls. Do not resubmit.
  A second upload of the same build number is rejected as a duplicate.
- Confirm in App Store Connect, not in EAS output: use the `appstore-connect`
  skill (`asc.mjs builds`, then `asc.mjs wait <buildId>`).
- **Never upload one build twice.** If an eas submit is still queued, a direct
  upload of the same file makes the queued one fail later with "You've already
  submitted this build". That email is harmless.
- **Stuck in Expo's queue?** `eas submit` hands the upload to Expo's servers,
  and on the free plan it can wait in a queue for a long time. The `.ipa` is
  already on your Mac, so upload it to Apple directly with the same App Store
  Connect API key (the `.p8` must be in `~/.appstoreconnect/private_keys/` as
  `AuthKey_<key id>.p8`):

  ```bash
  xcrun altool --upload-app -f build/<file>.ipa -t ios --apiKey <key id> --apiIssuer <issuer id>
  ```

  If the queued Expo submission runs later, Apple rejects it as a duplicate
  build number. That does no harm.
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
  `https://onebox.lokkesveen.com/guides/expo-eas.md`).
- Do not start a build because a PR merged. Ask first.
- Never run eas with `EXPO_DEBUG=1` in a shared log. It prints the API key.

## Finish

End with one line: the next step, as one question. "Next: <step>. Continue?".
"Yes" must be enough. Take the step from the app's plan (`/start:plan`). If
something blocks it, name only that one thing, in plain words, and offer the
fix.
