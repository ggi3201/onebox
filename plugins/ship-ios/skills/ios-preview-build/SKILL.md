---
name: ios-preview-build
description: Make an installable iOS test build of an Expo app for your own iPhone, without TestFlight or App Review. Sets up an EAS `preview` profile (internal / ad hoc distribution) with its own API URL, usually a staging server, builds it locally on your Mac, and installs it on a cabled or paired phone. Use when the user asks "how do I test this branch on my phone", "install a build without TestFlight", "ad hoc build", "internal distribution", "preview build", "point the app at staging", or when a preview build talks to the wrong server or has an empty API URL.
---

# iOS preview build

Runs on: your Mac. The phone must be registered with your Apple Developer
account and paired with the Mac.

A preview build is signed for a fixed list of devices (ad hoc). It installs
straight onto those phones. It needs no TestFlight upload and no review. Point
it at a staging API, so testers never touch production data.

The server half (a second copy of the backend at its own hostname) is the
`box:staging-env` skill. This skill is the app half.

## Before you start

```bash
cd <app folder>             # the folder with app.json / app.config.* and eas.json
find . -maxdepth 3 -name eas.json -not -path "*/node_modules/*"
ls ../app.json ../../app.json 2>/dev/null   # a stray config above the app folder is a trap
```

Always run eas from the app folder, never a monorepo root. See the capability
trap in the `expo-local-build` skill's `references/pitfalls.md`.

## 1. The preview profile

In `eas.json`:

```json
{
  "cli": { "appVersionSource": "remote" },
  "build": {
    "preview": {
      "distribution": "internal",
      "environment": "preview",
      "autoIncrement": true
    },
    "production": {
      "environment": "production",
      "autoIncrement": true
    }
  }
}
```

`distribution: internal` makes an ad hoc build for registered devices.
`autoIncrement` matters here too. Without it, two local builds can carry the
same build number, and iOS may keep the old one (see step 5).

## 2. The API URL for this profile

`EXPO_PUBLIC_*` values are inlined into the JavaScript bundle at build time.
A value that exists only in a git-ignored `.env.local` is empty in every
build made anywhere else. The app may then run "fine" and send nothing
anywhere.

Put the URL where the build can see it, per environment. Either in the
profile's `env` in `eas.json` (fine for public values like a URL), or as an
EAS environment variable. **Check the scope first:**

```bash
eas env:list --environment production --format long   # read the "Environments:" line
eas env:list --environment preview --format long
```

If one variable is shared by `preview` and `production`, do **not** run
`eas env:update --environment preview` on it. That re-scopes it to preview
only, and production silently loses the value. The next TestFlight build then
has an empty API URL. Create a separate preview-scoped variable instead:

```bash
eas env:create --name EXPO_PUBLIC_API_URL --value https://staging-api.example.com \
  --environment preview --visibility plaintext --scope project --non-interactive
```

Then list **both** environments again and confirm each has the right value.

Local builds do not support EAS variables with `secret` visibility. Use
`plaintext` or `sensitive` for values a local build needs.

## 3. Register the phone

Ad hoc builds only install on devices listed in the provisioning profile.

```bash
eas device:create          # prints a link / QR code; open it on the iPhone
```

After adding a device, build again. The old build does not include it.

## 4. Build locally

The first ad hoc build must be interactive. It creates the ad hoc provisioning
profile and needs Apple auth. In `--non-interactive` it fails with "couldn't
find any credentials suitable for internal distribution".

```bash
eas build --platform ios --profile preview --local --output build/preview.ipa   # add --non-interactive after the first run
```

Local costs no build credits and has no queue. Use the cloud builder only if
the Mac cannot build, or the user wants a link to share with a tester:
`eas build --platform ios --profile preview`. For a cloud build, the tester
opens the build page on the phone and taps Install. Give them the URL. You
cannot push it to their phone.

The `expo-local-build` skill's `build.sh --profile preview --skip-submit`
does the same with its preflight checks.

## 5. Install on the phone

```bash
xcrun devicectl list devices                                    # need "available (paired)"
xcrun devicectl device install app --device <UDID> build/preview.ipa
xcrun devicectl device process launch --device <UDID> com.example.myapp   # proves it starts
```

Only a paired device can be installed to. If it is not listed as available
(paired), connect it by cable once, unlock it, and trust the Mac.

**Did the new build really replace the old one?** `devicectl device install`
prints an `installationURL` with a UUID in it. A new UUID means the replace
happened. If the UUID is unchanged and the change is missing, the two builds
had the same version and build number. Deleting the app first fixes that, but
it also deletes any data stored only on the phone. Warn the user before they
delete.

## 6. Prove it talks to staging

Open a screen that loads data. Check the staging server's logs for the
request, or show the API URL in a debug or settings screen of the preview
build. Do not assume the URL is right because the build succeeded.

## Notes

- A preview build with the same bundle ID replaces the production app on the
  phone. To keep both, use an app variant: a different bundle ID and name for
  the preview profile, set in `app.config.js` from an env var such as
  `APP_VARIANT`. Each bundle ID needs its own App ID and profile.
- Staging copied from production contains real user data. Say so to the
  user. `box:staging-env` covers scrubbing it.
- A preview build is not proof that TestFlight works. Payments in particular
  must be checked with a sandbox purchase on a TestFlight or preview build,
  not in the simulator alone.
