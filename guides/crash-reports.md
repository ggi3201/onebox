# Crash reports and error tracking

Runs on: your Mac (Xcode and the app), your browser (App Store Connect and
Sentry), and your box (the API).

Most users do not report a crash. They close the app, and some delete it. This
guide shows you what goes wrong after launch: first the free crash reports
from Apple, then Sentry for JavaScript errors with readable stack traces, then
an error reporter for your API. Set up the Apple part as soon as you have a
TestFlight build. Add Sentry before the first public release.

## What it costs

| Tool | Free | First paid step |
|---|---|---|
| Xcode Organizer crash reports | included in the Apple Developer Program | none |
| TestFlight feedback | included | none |
| Sentry | Developer plan: 1 user, 5,000 errors a month, unlimited projects, 30-day history, email alerts | Team plan: 26 USD a month billed annually; unlimited users, 50,000 errors a month, up to 90-day history |
| PostHog (optional analytics) | 1 million events, 5,000 session recordings and 100,000 exceptions a month; 1 project; no card | Pay-as-you-go: the same free amount each month, then you pay for use above it |

Checked 2026-09-28 at https://sentry.io/pricing/ and
https://posthog.com/pricing. PostHog's free plan stops at its limits, so it
cannot charge you by surprise.

One Sentry account on the free plan covers the app and the API: make one
project for each.

## Step 1: what Apple gives you for free

### Crashes in Xcode Organizer

In Xcode: **Window**, **Organizer**, then **Crashes**. Pick your app and a
version.

- Reports come from every TestFlight tester, whatever their device settings.
- From App Store users, reports come only from people who share analytics
  with developers (a setting on their iPhone).
- The reports show readable function names only if the build was uploaded
  with its symbols.
- Some events are not in the Crashes list: watchdog kills (for example a slow
  launch), high memory use (jetsam), overheating, and invalid code
  signatures.
- The same window has performance data (launch time, hangs, memory, battery)
  from users who share analytics. It needs enough users before it shows
  numbers.

The limit for a React Native app: Apple's report shows the native side of a
crash. When JavaScript throws and the app dies, it rarely tells you which line
of your JavaScript failed. That is the reason for Sentry below.

### TestFlight feedback

TestFlight testers can send a screenshot with a comment, or feedback about a
crash, from the TestFlight app. Read it in App Store Connect: **Apps**, your
app, **TestFlight**, then under **Feedback** click **Screenshots** or
**Crashes**. Crash reports stay there for download for 120 days. You can turn
feedback off per tester group, but keep it on.

Tell your testers about it. Most do not know the feature exists.

These two tools need no App Privacy answer. Apple says you are not
responsible for disclosing data that Apple collects.

## Step 2: Sentry in the app

Sentry catches JavaScript errors and native crashes, and maps the minified
code back to your source files with **source maps**.

1. **Make the account and the project.** At https://sentry.io, create an
   organization. Pick the **data storage location** (US or EU) now: you cannot
   change it later, only make a new organization. If your users are in the EU,
   pick EU. Create a **React Native** project. Note the **DSN**, the
   organization slug and the project slug.
2. **Make an organization auth token** in Sentry's settings, under Auth
   Tokens. The build uses it to upload source maps. It is a secret. Put it in
   your secrets tool as `SENTRY_AUTH_TOKEN` ([secrets.md](secrets.md)).
3. **Install the SDK** in the app folder:

   ```bash
   npx expo install @sentry/react-native
   ```

   The Sentry wizard (`npx @sentry/wizard@latest -i reactNative`) can do steps
   4 to 6 for you. If you use it, check its output: it turns on
   `sendDefaultPii` and full tracing, and this guide turns both off.
4. **Add the config plugin** in `app.json`:

   ```json
   {
     "expo": {
       "plugins": [
         ["@sentry/react-native/expo", {
           "url": "https://sentry.io/",
           "organization": "your-org-slug",
           "project": "your-app-project-slug"
         }]
       ]
     }
   }
   ```

5. **Use Sentry's Metro config** in `metro.config.js`. It gives each bundle a
   debug ID, so Sentry matches it with its source map:

   ```js
   const { getSentryExpoConfig } = require("@sentry/react-native/metro");
   module.exports = getSentryExpoConfig(__dirname);
   ```

6. **Start Sentry in the root layout** (`app/_layout.tsx`):

   ```tsx
   import * as Sentry from "@sentry/react-native";

   Sentry.init({
     dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
     environment: process.env.EXPO_PUBLIC_SENTRY_ENV,   // "production", "preview"
     enabled: !__DEV__,              // no events from your own development builds
     sendDefaultPii: false,          // no IP, cookies or user details from the SDK
     beforeBreadcrumb: (b) => (b.category === "console" ? null : b),   // console logs stay on the phone
   });

   function RootLayout() { /* your layout */ }
   export default Sentry.wrap(RootLayout);
   ```

   The DSN only lets someone send events to your project. It is not a secret,
   so it can live in `eas.json` `env` next to `EXPO_PUBLIC_API_URL`
   ([expo-app.md](expo-app.md)).
7. **Add Sentry's privacy manifest entries.** React Native links Sentry
   statically, so Apple does not see Sentry's own manifest. Add this under
   `expo.ios` in `app.json`, and merge it with any entries you already have:

   ```json
   "privacyManifests": {
     "NSPrivacyCollectedDataTypes": [
       { "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeCrashData",
         "NSPrivacyCollectedDataTypeLinked": false, "NSPrivacyCollectedDataTypeTracking": false,
         "NSPrivacyCollectedDataTypePurposes": ["NSPrivacyCollectedDataTypePurposeAppFunctionality"] },
       { "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypePerformanceData",
         "NSPrivacyCollectedDataTypeLinked": false, "NSPrivacyCollectedDataTypeTracking": false,
         "NSPrivacyCollectedDataTypePurposes": ["NSPrivacyCollectedDataTypePurposeAppFunctionality"] },
       { "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeOtherDiagnosticData",
         "NSPrivacyCollectedDataTypeLinked": false, "NSPrivacyCollectedDataTypeTracking": false,
         "NSPrivacyCollectedDataTypePurposes": ["NSPrivacyCollectedDataTypePurposeAppFunctionality"] }
     ],
     "NSPrivacyAccessedAPITypes": [
       { "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryUserDefaults", "NSPrivacyAccessedAPITypeReasons": ["CA92.1"] },
       { "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategorySystemBootTime", "NSPrivacyAccessedAPITypeReasons": ["35F9.1"] },
       { "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryFileTimestamp", "NSPrivacyAccessedAPITypeReasons": ["C617.1"] }
     ]
   }
   ```

   `ship-ios:app-store-ready` checks the privacy manifest.
8. **Rebuild.** The plugin changes native code. Make a new build.

## Step 3: source maps from local EAS builds

The config plugin adds Xcode build steps. In a release build they upload the
bundle, its source map and the debug symbols (dSYM) to Sentry. They need
`SENTRY_AUTH_TOKEN` in the environment of the build.

`eas build --local` does not get EAS environment variables with "secret"
visibility. It also builds from a copy of your repository, so a gitignored
`.env.local` may not reach it. Put the token in the environment of the build
command itself:

```bash
# Doppler
doppler run -- eas build --platform ios --profile production --local

# 1Password
SENTRY_AUTH_TOKEN="$(opa read op://agent-secrets/sentry/credential)" \
  eas build --platform ios --profile production --local
```

Debug builds skip the upload. Metro already maps the code in development.

If the token is missing or Sentry cannot be reached, the build can fail at the
Sentry step. `SENTRY_ALLOW_FAILURE=true` lets the build go on. Then upload the
maps by hand later, or the stack traces of that build stay unreadable.

If you ship JavaScript updates with `eas update`, upload their maps after each
update:

```bash
eas update
SENTRY_AUTH_TOKEN=... npx @sentry/expo-upload-sourcemaps dist
```

## Step 4: an error reporter for the API

Make a second Sentry project for the API (**ASP.NET Core** or **Node**). It
has its own DSN.

**.NET:**

```bash
dotnet add package Sentry.AspNetCore
```

```csharp
// Program.cs. The SDK reads SENTRY_DSN and SENTRY_ENVIRONMENT from the environment.
builder.WebHost.UseSentry(o =>
{
    o.SendDefaultPii = false;                                    // no user, headers or IP
    o.SetBeforeSend((e, _) => { e.ServerName = null; return e; }); // do not send the box's host name
});
```

Unhandled exceptions in a request are reported. `ILogger` entries at or above
`MinimumEventLevel` also become events, so a caught error that you log with
`LogError` still reaches you. Leave `MaxRequestBodySize` at its default,
`None`: request bodies are never sent.

**Node:** `npm install @sentry/node`, then a file that loads before the app:

```js
// instrument.mjs
import * as Sentry from "@sentry/node";
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT,
  sendDefaultPii: false,
});
```

Start the API with `node --import ./instrument.mjs dist/server.js`. In the
Dockerfile from [backend.md](backend.md) that is
`CMD ["node", "--import", "./instrument.mjs", "dist/server.js"]`. Check
Sentry's page for your framework: some need one more line for their error
handler.

Add both values to the API's `environment:` block in `docker-compose.yml`:

```yaml
      SENTRY_DSN: ${SENTRY_DSN:-}
      SENTRY_ENVIRONMENT: production
```

Staging gets `SENTRY_ENVIRONMENT: staging`, so you can filter it out.

In Sentry, set an alert rule for new issues in both projects. On the free plan
alerts come by email.

## Keep personal data out of reports

A crash report is a copy of the moment the app failed. It can hold whatever
was in memory, in the URL or in the log. Rules:

- **Keep `sendDefaultPii: false`** (app and API). Sentry's setup pages set it
  to `true` in their examples.
- **Identify the user by your own id only:** `Sentry.setUser({ id: user.id })`.
  Never the email or the name. Call `Sentry.setUser(null)` on sign-out.
- **Nothing private in URLs.** Sentry always sends the full URL and query
  string of outgoing requests. Tokens and emails belong in headers or bodies,
  never in the query string ([backend.md](backend.md), "Logs without tokens or
  personal data").
- **Nothing private in error messages.** `throw new Error("no recipe for " + email)`
  sends the email. Put ids in messages, not personal data.
- **No console breadcrumbs** in the app (the `beforeBreadcrumb` line above).
- **Keep Sentry's server-side scrubbing on.** It is on by default. It removes
  values that look like passwords, tokens, secrets and card numbers. Also turn
  on **Prevent Storing of IP Addresses** in the project's **Security &
  Privacy** settings: Sentry otherwise takes the IP from the incoming request.
- **No session replay** unless you need it and have checked its masking. It is
  off unless you add it.

## Product analytics (only if you need it)

Crash reports tell you what broke. Analytics tell you what people do: which
screens they use, where they give up. Skip it until you have a question that
only analytics can answer. Every tool you add is one more processor in your
privacy policy and one more App Privacy answer.

If you add one, PostHog is a good fit: it has a React Native SDK, an EU cloud
(Frankfurt), and the free amounts above. Rules:

- **Ask first.** Guideline 5.1.1(ii) says apps that collect user or usage data
  must get the user's consent, even for anonymous data. Start PostHog with
  `defaultOptIn: false` and call `posthog.optIn()` only after the user agrees.
  Paid features must not depend on that answer.
- Track a few named events (`import_started`, `import_finished`), not every
  tap.
- Do not connect it to an ad network or share its data with data brokers.
  That is tracking in Apple's sense, and it needs the App Tracking
  Transparency prompt.

## App Privacy answers and privacy policy lines

What each tool adds in App Store Connect, under App Privacy:

| Tool | Data types | Linked to the user | Tracking | Purpose |
|---|---|---|---|---|
| Xcode Organizer, TestFlight | nothing to declare (Apple collects it) | | | |
| Sentry in the app | Diagnostics: Crash Data, Performance Data, Other Diagnostic Data | No. **Yes** if you call `Sentry.setUser` with your user id | No | App Functionality |
| Sentry on the API | no new type if it only sends what the API already has | | | |
| PostHog | Usage Data: Product Interaction. Identifiers: User ID if you call `identify()` with your user id | Yes if you call `identify()` | No | Analytics |

If you call `Sentry.setUser`, also set `NSPrivacyCollectedDataTypeLinked` to
`true` in the three Sentry entries of the privacy manifest. The manifest and
the App Privacy answers must say the same thing.

Privacy policy lines ([privacy-and-support-pages.md](privacy-and-support-pages.md)).
Name each tool:

> When the app crashes or has an error, it sends a report to Sentry, our
> error tracking service. Reports are stored in the [US/EU]. The report holds
> technical data: the error, the device model, the iOS and app version, and
> our internal account id. It does not hold your name or email. Reports are
> deleted after [30/90] days.

> Our server reports its own errors to Sentry. Those reports can hold the
> address of the request and our internal account id, never the request
> content.

If you use PostHog:

> If you agree, the app sends usage events (for example "import started") to
> PostHog, stored in the EU. You can turn this off in the app's settings.

## Where the values go

| Value | Where |
|---|---|
| App DSN (`EXPO_PUBLIC_SENTRY_DSN`), `EXPO_PUBLIC_SENTRY_ENV` | `eas.json` `env` per build profile. Not a secret. |
| Organization and project slugs | the Sentry plugin entry in `app.json` |
| `SENTRY_AUTH_TOKEN` | your secrets tool; passed to the build command. Never in the repo or the app. |
| API DSN (`SENTRY_DSN`), `SENTRY_ENVIRONMENT` | the API's secrets and its `environment:` block in `docker-compose.yml` |
| PostHog project key and host | `eas.json` `env` per profile. Not a secret. |

## Check it works

- **Organizer:** after your first TestFlight testers, **Window**,
  **Organizer**, **Crashes** lists your app. (An empty list is fine. It fills
  only after a crash.)
- **Sentry, JavaScript:** in a preview or production build (not a development
  build), add a hidden button that calls
  `Sentry.captureException(new Error("Sentry test"))`. Tap it. Within a minute
  the issue appears, and its stack trace shows your file name and line, not
  `main.jsbundle` with short names.
- **Sentry, native:** a second hidden button that calls `Sentry.nativeCrash()`.
  The app closes. Open it again: the crash is sent at the next start, with
  readable native frames.
- **Sentry, API:** throw from a test endpoint on staging. The event shows
  `environment: staging` and no `Authorization` header, cookie or body.
- **No personal data:** open a few events and read them. No email, no name, no
  token. The user shows only as your internal id.
- **Alerts:** the test issues sent you an email.

Remove the test buttons before you submit.

## Common errors

- **Stack traces show `main.jsbundle` and minified names.** The source maps
  were not uploaded. `SENTRY_AUTH_TOKEN` was not in the build's environment,
  `metro.config.js` does not use `getSentryExpoConfig`, or the build was a
  debug build.
- **The build fails in a Sentry step.** A missing or wrong auth token, or no
  network. Fix the token, or set `SENTRY_ALLOW_FAILURE=true` and upload later.
- **No events at all.** `enabled: !__DEV__` is off in development on purpose.
  Test with a release build. Also check that `EXPO_PUBLIC_SENTRY_DSN` is set
  for that build profile.
- **Events from staging mixed with production.** `environment` is not set.
  Set it per build profile and per API instance.
- **Organizer shows no crashes, but users report some.** They do not share
  analytics with developers, or the crash was a watchdog or memory kill. Ask
  the user for the log: **Settings**, **Privacy & Security**, **Analytics &
  Improvements**, **Analytics Data**.
- **The free plan's 5,000 errors run out in days.** One bug in a loop. Fix
  it, and use Sentry's inbound filters to drop known noise.
- **App Review asks why the app collects diagnostics.** Your App Privacy
  answers or privacy policy do not name Sentry. Fix both to match.
