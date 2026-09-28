---
name: eas-update
description: Set up EAS Update (over-the-air updates) in an Expo iOS app, and publish a JavaScript-only fix to phones without a new build or App Review, safely. Sets the fingerprint runtime policy and a channel per build profile, then builds the update bundle with the right EAS environment, checks it calls the right API, and publishes only when asked, optionally to a share of users first. Also rolls back a bad update. Use when the user says "push a fix without App Review", "OTA update", "over the air", "EAS Update", "expo-updates", "hotfix the JS", "update without a new build", "roll back the update", "runtime version", or asks why an update did not reach a phone.
---

# EAS Update

Runs on: your Mac. Publishing needs an Expo login; the phones download from
Expo's servers.

An EAS Update replaces the app's JavaScript and assets on phones that already
have a build. It cannot change native code. Builds check for an update at
launch, download it in the background, and use it on the **next** launch.

Only builds made after `expo-updates` was added can receive updates. So the
setup ships with one normal build first.

## What it costs, and what Apple allows

- Expo's free plan includes 1,000 monthly active users of updates and
  100 GiB of bandwidth. Starter ($19 a month) includes 3,000. Checked on
  2026-09-28 at https://expo.dev/pricing. Every phone on the channel
  downloads each update, so large images and fonts use bandwidth fast.
- Apple allows downloaded JavaScript only when it does not change what the
  app is for (App Review Guideline 2.5.2 and the developer agreement). Use
  updates for fixes and small changes. Ship new features through App Review.

## 1. Set it up (once per app)

From the Expo app folder, never a monorepo root:

```bash
npx expo install expo-updates
eas update:configure -p ios
```

Then fix what `update:configure` gets wrong. Read the diff of `app.json`
before you keep it:

1. **It writes resolved plugin values back into `app.json`.** In a real app it
   added `android.permissions` with every location permission twice, even
   with `-p ios`. Remove anything the command added that is not `updates`,
   `runtimeVersion` or `channel`.
2. **Use the `fingerprint` runtime policy, at the top level of `expo`:**

   ```json
   "runtimeVersion": { "policy": "fingerprint" }
   ```

   `update:configure` writes `{"policy": "appVersion"}` under `ios`. With
   `appVersion`, a native change without a version bump lets old builds
   download JavaScript they cannot run, and the app crashes at launch.
   `fingerprint` changes whenever anything native changes, so that cannot
   happen. The cost: you make a new build more often.
3. **Check each build profile in `eas.json` has a `channel`**: `development`,
   `preview`, `production`. A build only gets updates published to its
   channel.

Check the setup:

```bash
npx expo-updates runtimeversion:resolve --platform ios   # run twice: the same hash both times
npx expo prebuild --platform ios --no-install            # only if ios/ is git-ignored
plutil -p ios/*/Supporting/Expo.plist | grep EXUpdates   # URL, "file:fingerprint", CheckOnLaunch ALWAYS
npx expo export --platform ios --output-dir "$TMPDIR/x"  # the bundle still builds
```

Then commit, and make a normal build (`ship-ios:expo-local-build`). Tell the
user plainly: **no phone gets an update until it runs a build made from this
commit.**

## 2. Publish a fix

The script builds the bundle with the channel's EAS environment, checks it,
and prints the publish command. It publishes only with `--publish`.

```bash
<skill-dir>/scripts/update.sh --channel production --expect-host api.example.com \
  -m "fix: paywall button text"                          # dry run: build and check
<skill-dir>/scripts/update.sh ... --publish               # publish this bundle
<skill-dir>/scripts/update.sh ... --publish --rollout 10  # to 10% of users first
```

What it checks, and why:

- **The app folder, `expo-updates`, `updates.url`, and a build profile that
  uses this channel.** Publishing to a channel no build listens on reaches
  nobody, silently.
- **The runtime version.** It prints it. An update reaches only builds with
  the same runtime version.
- **The environment.** `eas update` does **not** read the `env` blocks in
  `eas.json`; those apply to builds only. The script builds with
  `eas env:exec <environment>`, so every `EXPO_PUBLIC_*` value must be an EAS
  environment variable. Check with `eas env:list --environment production`.
- **`--expect-host`.** The production API host must be in the bundle. If it
  is not, a public value is missing and the update would send users to the
  wrong server, or to nowhere. A local address in the bundle is a warning:
  apps often have a dev-only `localhost` fallback. Read the code before you
  dismiss it.

Always run the dry run first and show the user what it found. Publishing is an
outward action: phones download it. Publish only after the user says yes.

After publishing, say when users get it: on their next launch the phone
downloads it, and it runs from the launch after that.

## 3. Roll out, then widen

With `--rollout 10`, only 10% of phones take the update. Watch crash reports
and support email for a day, then raise it:

```bash
eas update:list --branch production
eas update:edit <group id> --rollout-percentage 100
```

## 4. Undo a bad update

Publish the last good update again:

```bash
eas update:list --branch production              # find the last good group id
eas update:republish --group <group id>
```

Phones pick it up on their next launch or the one after. If an update
crashes at launch, `expo-updates` may detect it and go back to the previous
update on that phone. Do not count on it: republish.

## Why an update did not arrive

- **The build is older than the setup.** No `expo-updates` in that build.
- **Different runtime version.** A native change since the build. Make a new
  build; updates cannot fix native code.
- **Wrong channel.** A TestFlight build from the `production` profile listens
  on `production`, not `preview`.
- **Too soon.** The phone downloads at launch and uses it on the next launch.
  Close the app fully and open it twice.
- **A development build.** It loads updates from the Extensions tab, not on
  its own.

## Rules

- Only JavaScript and assets. A new native package, a config plugin, a
  permission string, an icon or an SDK upgrade needs a new build.
- Never publish from the monorepo root, and never from a checkout with
  uncommitted changes you do not mean to ship: the bundle is built from the
  files on disk.
- Dry run first, show the checks, publish on an explicit yes.
- Write what changed in `-m`. It is the only record of what users got.
