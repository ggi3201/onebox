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
npx expo install expo-updates      # pnpm workspace: pnpm --filter <app> exec expo install expo-updates
```

**Add the config by hand. Do not keep what `eas update:configure` writes to
`app.json`.** It writes resolved plugin values back into the static file. In
two real apps it added Android permissions (twice, even with `-p ios`), and
in one it also doubled the associated domain and the Sign in with Apple
entitlement. A doubled entitlement is the kind of change that breaks signing.
It also picks the weaker `appVersion` policy.

In `app.json`, under `expo`, add two keys. The project id is in
`extra.eas.projectId`:

```json
"runtimeVersion": { "policy": "fingerprint" },
"updates": { "url": "https://u.expo.dev/<project id>" }
```

In `eas.json`, give each build profile a `channel` with its own name:
`"channel": "production"` and so on. A build only gets updates published to
its channel.

Keep the file's own formatting: insert the lines, do not re-serialise the
JSON. Some apps keep entries on one line on purpose.

**Why `fingerprint`:** it changes whenever anything native changes, so old
builds never download JavaScript they cannot run. With `appVersion`, a native
change without a version bump lets them, and the app crashes at launch. The
cost: you make a new build more often.

Check the setup:

```bash
npx expo-updates runtimeversion:resolve --platform ios   # A: in a fresh checkout
npx expo prebuild --platform ios --no-install            # only if ios/ is git-ignored
npx expo-updates runtimeversion:resolve --platform ios   # B: must equal A
plutil -p ios/*/Supporting/Expo.plist | grep EXUpdates   # URL, "file:fingerprint", CheckOnLaunch ALWAYS
npx expo export --platform ios --output-dir "$TMPDIR/x"  # the bundle still builds
```

**A and B must match.** A build computes its runtime version after its own
prebuild. If B differs, an update published from a fresh checkout targets a
runtime version no build has, and it never arrives, silently. The usual cause
is a config plugin that copies files into its own folder in `node_modules`
during prebuild; `react-native-widget-extension` does this with the widget's
Swift files. Find it with `--debug` (it lists every source and its hash) and
diff the two runs. Fix it with `fingerprint.config.js` next to `app.json`:

```js
module.exports = {
  // Fingerprint the source folder, and ignore the copies the plugin writes.
  extraSources: [{ type: 'dir', filePath: 'widgets', reasons: ['widgets'] }],
  ignorePaths: ['../../node_modules/react-native-widget-extension/ios/*.swift'],
};
```

Then check again: A equals B, and an edit in `widgets/` changes both.

Measure after your last change to the setup, and compare with the build log's
`Resolved runtime version`. The app folder's `.gitignore` is one of the
fingerprint's inputs, so even adding `dist-update/` to it changes the runtime
version, and a later build gets the new one.

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
<skill-dir>/scripts/update.sh ... --publish --source-maps # keep dist-update/ with maps for Sentry
```

What it checks, and why:

- **The app folder, `expo-updates`, `updates.url`, and a build profile that
  uses this channel.** Publishing to a channel no build listens on reaches
  nobody, silently.
- **The runtime version.** It prints it. An update reaches only builds with
  the same runtime version.
- **The environment.** `eas update` reads neither the profile's
  `environment` nor its `env` block in `eas.json`; those apply to builds only.
  The script takes both from the build profile on this channel: it builds with
  `eas env:exec <environment>` and applies the `env` block on top, so the
  update gets the same `EXPO_PUBLIC_*` values as the build. That matters for
  apps that keep them in `eas.json` rather than as EAS environment variables.
- **`--expect-host`.** The production API host must be in the bundle.
  (To check your own text instead, remember that Hermes stores a string with
  any non-ASCII character, such as "·" or "é", as UTF-16. Plain `strings`
  misses it.) If it
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

Roll back the bad update by its group id:

```bash
eas update:list --branch production              # the bad update's group id
eas update:rollback <group id> -p ios -m "rollback: <why>"
```

It republishes the update before it. If there is none, as after the first
update ever, it rolls back to the code built into the app. To go back to a
specific older update instead, use `eas update:republish --group <group id>`.

Phones pick it up on their next launch or the one after. If an update
crashes at launch, `expo-updates` may detect it and go back to the previous
update on that phone. Do not count on it: republish.

## Test it once, on a real phone

After the first build with updates is in TestFlight: change one visible word
on a screen only you open, publish to `production`, close the app fully and
open it twice, and see the word. Then roll it back (step 4). Only phones on
builds with the same runtime version can take it, so App Store users on older
builds see nothing. In a real run this took about five minutes.

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
