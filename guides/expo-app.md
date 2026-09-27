# The Expo app

Runs on: your Mac.

This guide makes an Expo / React Native project ready for the rest of the
setup: a fixed bundle identifier, an API URL per build profile, a development
build, three EAS build profiles, and version numbers that EAS manages. It works
for a new project and for one you already have.

## What it is and what it costs

Expo is a framework and toolchain on top of React Native. EAS (Expo
Application Services) is Expo's build and submit service. The Expo account is
free. Local builds on your Mac are free. Cloud builds on EAS have a free tier
and paid plans; you do not need them for this setup. See [expo-eas.md](expo-eas.md).

Before you start you need Xcode ([xcode.md](xcode.md)) and an Apple Developer account
([apple-developer.md](apple-developer.md)).

## Recommended layout

One repo per app, with the app and the backend side by side:

```
myapp/
  apps/
    mobile/            the Expo project (app.json, eas.json, package.json, src/ or app/)
    api/               the backend (see backend.md), with its Dockerfile
  docker-compose.yml   the production stack for the box
  .github/workflows/   ci.yml and deploy-api.yml
  scripts/             build and helper scripts
  app.config.js        a tripwire, see below
  package.json         workspace root (pnpm or npm workspaces)
```

`ios/` and `android/` inside `apps/mobile` are **generated** and belong in
`.gitignore`. Expo writes them from your app config when you build
("continuous native generation"). Change native settings through the app
config or a config plugin, never by editing `ios/` by hand. The next build
throws hand edits away.

### The tripwire at the root

Expo and EAS read the app config from the directory you run them in. If you
run `eas build` from the repo root by mistake, EAS can create an empty config
there and sync it to Apple. An empty config does not declare Sign in with
Apple, so EAS **turns that capability off on your App ID**. The build output
says so in one line, and the build still looks successful. Sign-in then
breaks for everyone.

Put this file at the repo root so the mistake fails loudly instead:

```js
// app.config.js at the repo root. Not a config: a guard.
throw new Error("Run Expo/EAS commands from apps/mobile, not the repo root.");
```

Expo prefers `app.config.js` over `app.json`, so this file wins at the root.
Root scripts should delegate, for example
`pnpm --filter mobile exec eas build --profile preview --platform ios`.

## Steps

### 1. Create or adopt the project

New project:

```bash
mkdir -p myapp/apps && cd myapp/apps
npx create-expo-app@latest mobile
```

Existing project: move it into `apps/mobile` (or keep it at the root if there
is no backend in the same repo; then skip the tripwire).

Link it to an Expo project once. This writes `extra.eas.projectId` into the
app config:

```bash
cd apps/mobile
npx eas-cli@latest login
npx eas-cli@latest init
```

### 2. Choose the bundle identifier

The bundle identifier is your app's permanent ID at Apple. Use reverse-DNS on
a domain you control: `com.example.myapp`. Lowercase, no spaces.

**It cannot change after the first upload to App Store Connect.** A new
bundle identifier means a new app with no reviews, no ratings and no users.
Decide it now, write it down, and use the same value for:

- `ios.bundleIdentifier` in the app config,
- the App ID in your developer account ([apple-developer.md](apple-developer.md)),
- the app record in App Store Connect ([app-store-connect-setup.md](app-store-connect-setup.md)),
- the audience check in your backend ([sign-in-with-apple.md](sign-in-with-apple.md)).

Use the same value for `android.package` if you ever ship Android.

### 3. The app config

A static `app.json` is enough for most apps. The parts this setup needs:

```json
{
  "expo": {
    "name": "My App",
    "slug": "myapp",
    "version": "1.0.0",
    "scheme": "myapp",
    "ios": {
      "bundleIdentifier": "com.example.myapp",
      "supportsTablet": false,
      "usesAppleSignIn": true,
      "infoPlist": {
        "ITSAppUsesNonExemptEncryption": false,
        "NSCameraUsageDescription": "My App uses the camera to scan a receipt and add it to your list."
      }
    },
    "plugins": ["expo-apple-authentication", "expo-secure-store"],
    "extra": { "eas": { "projectId": "set-by-eas-init" } }
  }
}
```

- `ITSAppUsesNonExemptEncryption: false` answers Apple's export compliance
  question for every build, if the app uses only standard HTTPS and the
  system's own encryption. Without it every TestFlight build waits on
  "Missing Compliance".
- Every permission prompt needs a usage description that says what the app
  does with it. A vague one is a common rejection.
- `supportsTablet: true` means App Review also tests on iPad, and you need
  iPad screenshots. Leave it `false` unless you designed for iPad.

If you need values that change per build profile inside the config itself (a
different app name for a dev variant, for example), use `app.config.ts`
instead and read an `APP_ENV` variable that each profile in `eas.json` sets.
Most apps do not need this. The API URL does not need it (next step).

### 4. The API URL, per build profile

The app reads its server address from `EXPO_PUBLIC_API_URL`. Metro **inlines
`EXPO_PUBLIC_*` variables into the JavaScript bundle when the build is made**.
The value is fixed in that binary forever.

That has a trap. If the URL lives only in a git-ignored `.env.local` on your
laptop, a build made anywhere else gets an empty URL. The app still opens. It
just never reaches the server, and nothing tells you.

So set the URL in `eas.json`, per profile (step 6). It is not a secret; it is
visible to anyone who opens the app. Then read it in one place and refuse to
guess:

```ts
// src/config/api.ts
const configured = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/+$/, "");

export const API_URL = configured ?? (__DEV__ ? "http://localhost:8080" : "");

if (!__DEV__) {
  if (!API_URL) console.error("[config] EXPO_PUBLIC_API_URL is not set in this build.");
  else if (!API_URL.startsWith("https://")) console.error("[config] API URL must be https.");
}
```

Rules:

- A build that leaves your Mac always uses `https://api.example.com`. Never
  `localhost` (on a phone that is the phone itself) and never `http://` to a
  public host (iOS App Transport Security blocks it with no useful error).
- `http://` to a LAN address like `http://192.168.1.20:8080` works in a
  development build on your home Wi-Fi. That is for development only.
- Better than a console line: show a visible banner in release builds when
  the URL is missing, and add a test that walks every `eas.json` profile and
  fails if one has no `https` URL.

### 5. A development build, not Expo Go

Expo Go is a ready-made app from the App Store. It is fast for a first
prototype. It stops working for this setup as soon as you add native modules:

- **Sign in with Apple** in Expo Go returns a token for Expo Go's bundle ID,
  not yours. Your server correctly rejects it.
- **RevenueCat** (`react-native-purchases`) needs its native code, which Expo
  Go does not have. Real purchases need your own build.

A development build is your own app with Expo's developer menu inside. Install
the client and build it once:

```bash
npx expo install expo-dev-client
npx expo run:ios --device        # builds on this Mac and installs on the plugged-in iPhone
```

After that, `npx expo start` serves JavaScript changes to it, like Expo Go.
Rebuild only when you add or change a native module or a config plugin. The
`ship-ios:expo-local-build` skill covers the local build in detail.

### 6. `eas.json`: three profiles

```json
{
  "cli": { "version": ">= 16.0.0", "appVersionSource": "remote" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "env": {
        "EXPO_PUBLIC_API_URL": "https://api.example.com",
        "EXPO_PUBLIC_REVENUECAT_IOS_KEY": "appl_public_sdk_key"
      }
    },
    "production": {
      "autoIncrement": true,
      "env": {
        "EXPO_PUBLIC_API_URL": "https://api.example.com",
        "EXPO_PUBLIC_REVENUECAT_IOS_KEY": "appl_public_sdk_key"
      }
    }
  },
  "submit": {
    "production": { "ios": { "ascAppId": "1234567890" } }
  }
}
```

- **development**: your dev client, installed on registered devices. It gets
  its JavaScript from `npx expo start` on your Mac, so the API URL comes from
  the Mac's `apps/mobile/.env.local` (git-ignored), for example
  `EXPO_PUBLIC_API_URL=http://192.168.1.20:8080`.
- **preview**: a release build for registered devices ("ad hoc"), pointed at
  a real server. For testing on your phone without TestFlight. Register each
  phone once with `npx eas-cli device:create`. Skill:
  `ship-ios:ios-preview-build`.
- **production**: the build you upload to App Store Connect for TestFlight
  and the store.
- `ascAppId` is the numeric Apple ID of the app record in App Store Connect
  ([app-store-connect-setup.md](app-store-connect-setup.md)). It is not secret.

EAS also has hosted environment variables with `development`, `preview` and
`production` environments, selected by an `environment` field on each
profile. Use them if you want the values out of the repo. [expo-eas.md](expo-eas.md) covers
them. Keeping public values in the `env` block is simpler and works the same
for local and cloud builds.

### 7. Version numbers

Apple uses two numbers:

| Field | Who sees it | Example | Who changes it |
|---|---|---|---|
| `version` | users, in the store | `1.2.0` | you, in `app.json`, once per release |
| `ios.buildNumber` | Apple and you | `57` | EAS, on every production build |

With `"appVersionSource": "remote"` EAS stores the build number on its
servers. `"autoIncrement": true` on the production profile raises it on every
build, local builds included. You never edit `buildNumber` by hand, and you
never get "this build number was already used".

One `version` can have many builds in TestFlight. After a version goes live
in the store, raise `version` before the next upload.

If your backend has a minimum-version check, send the app's `version` in a
header on every request (for example `X-App-Version`, read from
`expo-constants`). The server can then tell a user of an old build to update
instead of failing in odd ways.

### 8. Keep secrets out of the app

Everything in the app bundle can be read by anyone who downloads the app.
`EXPO_PUBLIC_` means public. So does anything under `extra` in the app config:
`expo-constants` ships it inside the app.

Fine in the app:

- the API URL,
- RevenueCat's **public** SDK key (starts with `appl_`),
- your Expo project ID.

Never in the app:

- AI provider keys (OpenAI, Gemini and others). Call them from your backend.
- RevenueCat's **secret** key (starts with `sk_`), your JWT signing key,
  database passwords, the App Store Connect `.p8`, the Sign in with Apple
  `.p8`.

If a secret key was ever in a build, **rotate it**. Removing it from the next
build does not remove it from the builds people already have.

Check it: export the bundle and search it.

```bash
npx expo export --platform ios --output-dir /tmp/myapp-bundle
grep -raoE 'sk_(live|test)_[A-Za-z0-9]{8,}|sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|BEGIN [A-Z ]*PRIVATE KEY' /tmp/myapp-bundle | head
```

Expect no lines. `ship-ios:app-store-ready` runs a similar check on the
config and the source.

### 9. Store tokens in the Keychain

Store the user's session tokens with `expo-secure-store` (the iOS Keychain),
not in AsyncStorage. AsyncStorage is a plain file in the app's folder. It goes
into device backups, and anyone with access to the files can read it. The
Keychain is encrypted by the system.

```ts
import * as SecureStore from "expo-secure-store";

await SecureStore.setItemAsync("refreshToken", token);
const token = await SecureStore.getItemAsync("refreshToken");
await SecureStore.deleteItemAsync("refreshToken");   // on sign-out and account deletion
```

AsyncStorage is fine for settings that are not secret: a theme, a dismissed
tip, a cache of public data. Run only one token refresh at a time; see the
token part of [backend.md](backend.md) ("Protect the API").

### 10. No debug doors in release builds

- **No `NSAllowsArbitraryLoads`.** It turns off App Transport Security for
  every host. Review asks you to justify it. The API is `https`, so the app
  does not need it. The same goes for `NSExceptionAllowsInsecureHTTPLoads` on a
  public domain. A LAN address during development works without either.
- **Debug code behind `__DEV__`.** `__DEV__` is `false` in release builds, and
  the bundler removes the code inside `if (__DEV__) { ... }`. A test login, a
  "skip paywall" switch, a server picker, extra logging: put them there. Do not
  gate them on an `EXPO_PUBLIC_` flag. A flag is one wrong `eas.json` line away
  from production.
- **The server decides.** A debug or admin endpoint on the API checks the
  environment and a role on the server. Hiding its button in the app protects
  nothing: anyone can call the URL.
- **The development client stays in development.** Only the `development`
  profile has `developmentClient: true`. Preview and production builds have no
  developer menu.

**Certificate pinning: usually not.** Pinning makes the app trust only your
certificate, even when the phone trusts others. It protects against an
attacker who can install a trusted certificate on the user's phone. For most
apps that is not the risk. It has a real cost: Cloudflare renews its edge
certificates on its own schedule, and a pin that no longer matches breaks the
app for every user until they install an update. HTTPS with App Transport
Security is enough. Consider pinning only for very sensitive data, with a
backup pin and a plan to rotate.

## Where the values go

| Value | Where |
|---|---|
| Bundle identifier | `ios.bundleIdentifier` in `app.json`; `.onebox.json` if a skill asks for it |
| API URL | `env.EXPO_PUBLIC_API_URL` on each profile in `eas.json` |
| Build mode | `expo.buildMode` in the onebox config: `local` (default) or `cloud` |
| Expo token (for scripts and CI) | your secrets tool, referenced by `expo.tokenRef` |
| App Store Connect app ID | `submit.production.ios.ascAppId` in `eas.json` |

## Check it works

```bash
cd apps/mobile
npx expo-doctor                                   # dependency and config problems
npx expo config --type public | grep -E 'bundleIdentifier|version'
```

Then, on your phone, in a preview build: open the screen that calls your API.
It must load real data from `https://api.example.com`. On the box, the API
log must show the request.

## Common errors

- **Sign in with Apple stopped working after a build.** An EAS command ran
  from the wrong directory and synced a config without the capability. Look
  for a line about synced capabilities in the build log. Turn the capability
  back on for the App ID ([apple-developer.md](apple-developer.md)) and add the root tripwire.
- **The app works on your Mac and does nothing on the phone.** The API URL is
  empty, `localhost` or `http://`. Check the `env` block of the profile you
  built.
- **Sign in with Apple fails only in Expo Go.** Expected. Use a development
  build.
- **"Missing Compliance" on every TestFlight build.** Add
  `ITSAppUsesNonExemptEncryption: false` (if it is true for your app) and
  build again. For the build already uploaded, use `ship-ios:appstore-connect`.
- **A native change does nothing.** You edited `ios/` by hand, or you changed
  a config plugin without rebuilding. Change the app config and rebuild the
  dev client.
