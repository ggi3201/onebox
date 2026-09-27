# Local iOS build pitfalls

Each entry cost at least one failed build. The error you see is often not the
error that happened.

## Signing

**`errSecInternalComponent` while signing the first framework, then
`** ARCHIVE FAILED **`.**
The certificate is there (`security find-identity -v -p codesigning` lists
it). macOS refuses codesign access to the private key without a one-time
"Always Allow" in a keychain dialog. That dialog cannot appear in an SSH
session (`security unlock-keychain` answers "User interaction is not
allowed"). Driving Terminal remotely with `osascript` did not help either.
Fix: the user runs the build once in their own Terminal on the Mac and clicks
**Always Allow**. Later builds in their session sign without asking.

**A keychain password prompt with no usable "Always Allow".**
Same cause. Run in the user's own session.

## Apple credentials

**"Apple 401 detected", or "Log in to your Apple Developer account" in the
middle of a non-interactive build.**
EAS keeps its own copy of an App Store Connect API key on Expo's servers. It
is a separate copy from the key on your Mac. After you rotate the key, EAS
still holds the revoked one. Fix: pass the local key to eas with
`EXPO_ASC_API_KEY_PATH`, `EXPO_ASC_KEY_ID` and `EXPO_ASC_ISSUER_ID` (the
script does this from the onebox config), or update the key in
`eas credentials`. Keep one source of truth.

**`eas submit` uses the wrong key, or fails after an hour in the queue with
`SUBMISSION_SERVICE_INVALID_ASC_API_KEY`.**
`eas submit` ignores the `EXPO_ASC_*` variables. It uses a local key only when
`ascApiKeyPath`, `ascApiKeyId` and `ascApiKeyIssuerId` are all three set in the
submit profile of `eas.json`. With some set it refuses. With none set it uses
the server copy without saying so. A stale server key does not fail fast: the
submission can wait in the queue for an hour first. The script checks that the
key ID in `eas.json` matches the config before it builds.

**`ENOENT ... open '~/.../AuthKey_XXXX.p8'`.**
A path stored with a literal `~` is not expanded. It looks like a missing file.
Use a full path.

**The build stops at an "Apple Team ID:" prompt.**
A non-interactive run cannot answer it. Set `EXPO_APPLE_TEAM_ID` (the script
reads `apple.teamId`). Do not guess `EXPO_APPLE_TEAM_TYPE`. A wrong value
(for example `IN_HOUSE` for a normal account) makes Apple answer 403: "the
selected team does not have a program membership eligible for this feature".

**"Credentials are not set up. Run this command again in interactive mode."**
A new app target (widget, share extension, notification service) has no
credentials on EAS yet. Registering the bundle ID on Apple's side is not
enough; the EAS record is separate. Run once with `--interactive`.

## Capabilities

**`✔ Synced capabilities: Disabled: Sign In with Apple`, with a green tick.**
eas ran from a folder whose app config does not declare the capability,
usually a monorepo root with a stub `app.json`. EAS syncs capabilities to the
App ID on Apple's side, so it turned Sign in with Apple off for the live app.
If Apple is the only login, sign-in breaks for everyone.
Fix: run eas only from the app folder. Put an `app.config.js` at the repo root
that throws (`throw new Error("Run Expo/EAS from apps/mobile")`). Deleting the
stub is not durable; EAS can recreate `{"expo":{}}`. To recover, build again
from the right folder and look for `Enabled: Sign In with Apple`.

**The build stops because a capability request is rejected as malformed.**
Some entitlements (for example time-sensitive notifications) make EAS request
a capability the App Store Connect API does not know. Set
`EXPO_NO_CAPABILITY_SYNC=1` for the build, **and** turn the capability on by
hand once per bundle ID in the developer portal (Certificates, Identifiers &
Profiles, then Identifiers). If you skip the manual step, the entitlement is
ignored and the feature silently degrades.

## CocoaPods and the shell

**`Unicode Normalization not appropriate for ASCII-8BIT` from `pod install`.**
The shell has no UTF-8 locale. This happens in cron, CI and agent shells, not
in a normal Terminal. `expo run:ios` keeps going after the crash, and
xcodebuild then fails with "The sandbox is not in sync with the
Podfile.lock", which sends you the wrong way. Fix: `export LANG=en_US.UTF-8`
(the script does this).

**The build succeeds, the app installs, and dyld kills it at launch on a
missing `ReactNativeDependencies`. Or: a native feature (say a barcode
scanner) shows a perfect camera preview and never reads anything.**
`pod` ran on the macOS system Ruby 2.6. Expo's precompiled-module configs
need Ruby 2.7 or later. Under 2.6 they fail to parse as a WARNING, `pod
install` exits 0, and pods are silently left out. Only release builds may be
affected. Fix: use Homebrew's CocoaPods (it brings its own Ruby) or a Ruby
2.7+ from a version manager. Check `Podfile.lock` for the pods you expect.

## eas-cli itself

**`Cannot find module 'fdir'` from `npx eas-cli`.**
npx has broken on some Node versions. Install `eas-cli` globally and use
`eas`.

**GraphQL calls time out with `ETIMEDOUT` and an empty `reason:`, while curl
to expo.dev works.**
On one machine this depended on the Node version: some versions failed about
half of the calls, one never did. A build makes many calls, so it looked like
"Expo is down". Try another Node version for eas only. Keep the app itself on
the Node LTS that Expo supports.

## Submit

**`eas submit` exits non-zero after `✔ Scheduled iOS submission`.**
The submission is queued. The client died while polling. Check App Store
Connect. Do not resubmit: a second upload of the same build number is
rejected as a duplicate.

**"You've already submitted this version."**
`expo.version` is already live or in review. Bump the version. A new build
number alone does not help.

## Installing a build without TestFlight

For a phone test before TestFlight, use the `ios-preview-build` skill.
