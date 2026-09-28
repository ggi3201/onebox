# Expo and EAS

Runs on: your Mac. Cloud builds run on Expo's servers.

**Expo** is the framework and tooling around your React Native app. **EAS**
(Expo Application Services) is Expo's hosted service for builds, submissions
and updates. The `eas` command-line tool talks to it. This guide sets up the
Expo account, the `eas` CLI and the token. You need them before the first
build in [expo-app.md](expo-app.md), and again for the TestFlight build.

## What it costs

You need a free Expo account even for local builds: EAS stores your project
ID, build numbers and (if you let it) your signing credentials.

Two ways to build:

| | Local build (`eas build --local`) | Cloud build (`eas build`) |
|---|---|---|
| Runs on | your Mac, with Xcode | Expo's Mac servers |
| Cost | free, unlimited | Free plan: 15 iOS builds a month, low-priority queue, 45-minute timeout. Paid plans from 19 USD a month plus usage. |
| Needs | Xcode, CocoaPods, fastlane ([xcode.md](xcode.md)) | nothing on your machine |
| Speed | no queue | queue can be long on the Free plan |

Prices checked 2026-09-28 at https://expo.dev/pricing.

onebox builds locally by default (config `expo.buildMode: "local"`), and
uses the cloud only when there is no Mac or you ask for it.

## Steps

1. **Make an account** at https://expo.dev/signup.
2. **Install the CLI globally**:
   ```bash
   npm install -g eas-cli
   eas --version
   ```
   Use the global `eas`. `npx eas-cli` has broken on some Node versions with
   `Cannot find module 'fdir'`.
3. **Log in** on your Mac:
   ```bash
   eas login
   eas whoami
   ```
4. **Link the project.** In your Expo app folder (the one with `app.json` or
   `app.config.*`, not a monorepo root):
   ```bash
   eas init              # adds the EAS projectId to your app config
   eas build:configure   # creates eas.json with development, preview and production profiles
   ```
5. **Let EAS own the build number.** In `eas.json`, set
   `"appVersionSource": "remote"` under `cli` and `"autoIncrement": true` on
   the production profile. [expo-app.md](expo-app.md) (steps 6 and 7) has the
   full `eas.json` and explains the two numbers.
6. **Only for scripts, CI or a remote machine: make an access token.** On
   expo.dev, open your account settings and find **Access tokens**. Create a
   token and copy it once. For CI, Expo recommends a **robot user** with its
   own token and a limited role, instead of a token for your personal account.

## Where the values go

The token is a secret. Store it with your secrets tool and put only the
reference in `~/.config/onebox/config.json`:

```json
{ "expo": { "tokenRef": "EXPO_TOKEN", "buildMode": "local" } }
```

With `secrets.tool: "env"` (the default), `EXPO_TOKEN` is read from the
environment or the nearest `.env`. EAS reads `EXPO_TOKEN` itself too: when it
is set, you do not need `eas login`. Never commit it, never paste it into a
URL.

On your own Mac, `eas login` is enough. You only need the token where you
cannot log in interactively.

App settings that are not secret (the API URL of each build profile) go in
`eas.json` `env` or in EAS environment variables. See
[expo-app.md](expo-app.md), step 6, and the `ship-ios:ios-preview-build`
skill. EAS variables with **secret** visibility are not
available to local builds.

## Check it works

```bash
eas whoami                                   # your account name
eas project:info                             # run in the app folder: shows the project
eas build --platform ios --profile production --local --non-interactive   # or use ship-ios:expo-local-build
```

## Common errors

- **"Run this command inside a project directory."** You are not in the app
  folder, or it has no `package.json` with `expo`.
- **"An Expo user account is required."** Not logged in and no `EXPO_TOKEN`.
  Run `eas login`, or set the token.
- **`ETIMEDOUT` on GraphQL calls, with an empty reason, while the network
  works.** On some machines this depended on the Node version. Try another
  Node version for `eas` only.
- **A cloud build waits a long time.** Free plan builds use the low-priority
  queue. Build locally instead.
- **"Credentials are not set up. Run this command again in interactive
  mode."** Run the build once without `--non-interactive`. This is needed for
  a first ad hoc (preview) build and for each new app target.
- **You rotated your App Store Connect key and now see "Apple 401
  detected".** EAS still holds the old key. See
  [app-store-connect-api-key.md](app-store-connect-api-key.md).
