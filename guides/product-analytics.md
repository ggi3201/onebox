# Product analytics with PostHog

Runs on: your browser (PostHog), then your Mac (the app). Your box does not
change.

Crash reports tell you what broke. Product analytics tell you what people
do: where new users give up, and who reaches the first useful moment. This
guide adds PostHog to an Expo app, with a small set of named events, an
opt-in, and the privacy paperwork.

**Do this before your first public release, not before.** First get the app
working end to end in TestFlight. A new app has few users and no question
that numbers can answer yet. Every analytics tool also adds one more
processor to your privacy policy and one more answer in App Privacy, so add
it once you have a question for it. It is optional. The app ships without it.

## Why

- You see where new users stop: after sign-up, in onboarding, before the
  first useful result, at the paywall.
- You decide what to fix from numbers, not from the loudest message in your
  inbox.
- A **funnel** is a list of steps in order. PostHog shows how many people
  reach each step. You will build one funnel (see "After launch").
- An **event** is one named thing the app reports, such as
  `signup_completed`.

## What it costs

| | Free | After the free amount |
|---|---|---|
| PostHog Cloud, product analytics | 1,000,000 events a month, no credit card | Pay as you go: 0.00005 USD per event for the 1,000,001st to the 2,000,000th, then less |
| PostHog, session replay (optional) | 2,500 mobile recordings a month (the 5,000 on the pricing page are web recordings) | Pay as you go |
| Projects | 1 project on the free plan | 6 projects on pay-as-you-go |
| Seats | Your whole team, no per-seat price | |

Checked 2026-10-05 at https://posthog.com/pricing and
https://posthog.com/docs/product-analytics/pricing. Replay and projects
checked 2026-10-09 at https://posthog.com/docs/session-replay/pricing and
https://posthog.com/pricing. The free amounts reset every month. A small app with about ten events stays far below them.

- **Do not add a payment method** until you need one. The free plan needs no
  card, so it cannot charge you.
- If you add a card later, set a **billing limit** for each product first.
  It is in the billing settings of your PostHog organization, at the bottom of
  each product's page. Set it to 0 USD, so only the free amount is
  used. PostHog's page does not say that 0 is allowed, so if it refuses,
  use the lowest amount it accepts. When a limit is reached, PostHog drops the
  new data for good. That is the point of the limit.

## Decide first: the region

PostHog has two separate clouds: US and EU. The EU cloud runs in Frankfurt.
**You choose at sign-up, and you cannot move later.** PostHog moves a project
between regions only for its highest paid plans, with an engineer's help
(https://posthog.com/docs/migrate, checked 2026-10-05). So decide now.

- Users in the EU or EEA: use the **EU cloud**. Sign up at
  https://eu.posthog.com. The app sends events to
  `https://eu.i.posthog.com`.
- All other users: either cloud works. The US host is
  `https://us.i.posthog.com`.
- The key from one cloud does not work on the other cloud's host.

How to check which one you have: after you sign in, the address in the browser
starts with `eu.posthog.com` for the EU cloud. Also, the project's settings
page shows the host the SDK must use. It must say `eu.i.posthog.com`.

## Steps

### 1. Make the account and the project

1. Sign up on the cloud you chose above. Make one **organization** and one
   **project** for the app. The free plan has only 1 project. A second
   project, for staging, needs the pay-as-you-go plan.
2. Open the project's settings and set these. PostHog moves its labels
   around, so look for the page for each name. The project is for a phone
   app, so most web features are noise.
   - **Web autocapture, heatmaps and web vitals: off.** They only apply to
     web pages. The app sends none of them.
   - **Console log capture: off.** Logs can hold personal data.
   - **IP data capture: discard.** The page is Settings, Project, General,
     "IP data capture configuration". New projects on the EU cloud start with
     it off. Check it anyway.
   - **Timezone:** your own, so a day in a chart is your day.
3. Copy the **project API key**. It starts with `phc_`. PostHog's newer
   pages also call it the project token. It is not a secret: it only lets
   someone send events to your project, and it ships inside the app.

### 2. Install the SDK

From the app folder:

```bash
npx expo install posthog-react-native expo-file-system expo-application \
  expo-device expo-localization @react-native-async-storage/async-storage
```

The four `expo-*` packages are the Expo peer dependencies in PostHog's guide
for React Native (https://posthog.com/docs/libraries/react-native, checked
2026-10-05). AsyncStorage keeps the user's answer to the opt-in (step 6). If
the app has some of these already, `expo install` skips them.

These packages have native code, so you need a **new native build**. Ship
it with a release, not as an EAS Update ([ship-an-update.md](ship-an-update.md)).
An OTA update cannot add native code, and it only reaches builds with a
matching runtime version.

### 3. Put the key in the EAS environment

The app reads two values. Both are optional:

| Variable | Value |
|---|---|
| `EXPO_PUBLIC_POSTHOG_KEY` | the project API key, `phc_...` |
| `EXPO_PUBLIC_POSTHOG_HOST` | only to override the default, `https://eu.i.posthog.com` |

Run the command in the **app folder**, the one with `eas.json`, not in the
repository root:

```bash
cd apps/mobile
eas env:set production --name EXPO_PUBLIC_POSTHOG_KEY --value phc_xxxxxxxx \
  --visibility plaintext --non-interactive
eas env:list --environment production        # check that it is there
```

Older versions of `eas-cli` call the same command `eas env:create`.

Why here and not in the `env` block of `eas.json` ([expo-app.md](expo-app.md),
step 6)? Both work for a build. But `eas update` does not read that block, so a
key kept only there is missing from an OTA bundle. `ship-ios:eas-update` fills
that gap. One place is simpler. Use `plaintext`, because a local build cannot
read a `secret` variable ([expo-eas.md](expo-eas.md)).

Set it for `production` only. Then development and preview builds send
nothing, and your own testing stays out of the numbers. Remember that
`EXPO_PUBLIC_*` values are put into the bundle when the build is made
([expo-app.md](expo-app.md), step 4).

### 4. A small wrapper

Do not call PostHog from every screen. Put it behind one file. The file
has four jobs: do nothing without a key, send only the events you named,
send nothing before the user said yes, and never throw.

```ts
// src/analytics.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import PostHog from "posthog-react-native";

// The project API key is public by design. Without it, every call below does nothing.
const KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY?.trim();
const HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST?.trim() || "https://eu.i.posthog.com";
const CONSENT_KEY = "analytics.consent"; // "granted", "denied", or missing: not asked yet

// Every event the app sends. A typo does not compile. Properties are ids and
// fixed words only: never an email, a name, a file path or text the user typed.
type Events = {
  signup_completed: undefined;
  signed_in: undefined;
  onboarding_step_viewed: { step: string };
  onboarding_skipped: { step: string };
  core_action_started: { kind: string };
  core_action_completed: { kind: string };
  paywall_shown: { trigger: string };
  purchase_completed: { product: string };
  share_tapped: { kind: string };
};

let client: PostHog | null = null; // exists only while the user has said yes
let userId: string | null = null;

function start() {
  if (!KEY || client) return;
  client = new PostHog(KEY, {
    host: HOST,
    personProfiles: "identified_only", // no profile for people you never identify
    captureAppLifecycleEvents: false,  // fewer events; turn on later for retention
  });
  if (userId) client.identify(userId);
}

async function stop() {
  const old = client;
  client = null;
  if (!old) return;
  old.reset();         // wipe the id kept on the phone
  await old.shutdown();
}

// Call once at launch. Nothing starts unless the user said yes before.
export async function initAnalytics() {
  try {
    if ((await AsyncStorage.getItem(CONSENT_KEY)) === "granted") start();
  } catch {}
}

export async function getAnalyticsConsent(): Promise<"granted" | "denied" | "unknown"> {
  try {
    const v = await AsyncStorage.getItem(CONSENT_KEY);
    return v === "granted" || v === "denied" ? v : "unknown";
  } catch {
    return "unknown";
  }
}

export async function setAnalyticsConsent(granted: boolean) {
  try {
    await AsyncStorage.setItem(CONSENT_KEY, granted ? "granted" : "denied");
  } catch {}
  if (granted) start();
  else await stop();
}

export function track<E extends keyof Events>(
  event: E,
  ...props: Events[E] extends undefined ? [] : [Events[E]]
) {
  try {
    client?.capture(event, props[0] as Record<string, string> | undefined);
  } catch {}
}

export function screen(name: string) {
  try {
    client?.screen(name);
  } catch {}
}

// After sign-in: your own user id. Never an email or a name.
export function identify(id: string) {
  userId = id;
  try {
    client?.identify(id);
  } catch {}
}

// On sign-out and on account deletion.
export function resetAnalytics() {
  userId = null;
  try {
    client?.reset();
  } catch {}
}
```

This is the whole SDK surface the app uses. There is no `PostHogProvider`, so
PostHog's touch autocapture never runs. It is off unless you add the
provider with `captureTouches` on. Leave it off: taps give noise and can
record what a user touched.

Wire it in the root layout (`src/app/_layout.tsx`). The tabs and screens of
Expo Router do not report themselves, so send the route yourself. Use the
route pattern (`recipe/[id]`), not the URL: a URL can hold a name or an id of
something private.

```tsx
import { useEffect } from "react";
import { useSegments } from "expo-router";
import { initAnalytics, screen } from "../analytics";   // src/analytics.ts

// inside the root layout component
useEffect(() => { void initAnalytics(); }, []);

const route = useSegments().join("/");
useEffect(() => { if (route) screen(route); }, [route]);
```

After sign-in call `identify(user.id)`. On sign-out and on account deletion
call `resetAnalytics()`. Use your own internal user id, never the email,
the name or the Apple relay address.

Local development and tests keep working. Without the key, `start()` does
nothing and no PostHog client exists.

### 5. The events

Name the events for your activation funnel: the steps a new user takes
from the first launch to the first useful result, and on to paying. Start
with these nine. Rename `core_action` after the one thing your app is for
(`recipe_imported`, `workout_logged`, `photo_scanned`).

| Event | Fires when |
|---|---|
| `signup_completed` | The API created a new account. |
| `signed_in` | A returning user signed in. |
| `onboarding_step_viewed {step}` | Each onboarding screen shows. `step` is a fixed word such as `welcome`. |
| `onboarding_skipped {step}` | The user taps Skip, with the step they were on. |
| `core_action_started {kind}` | The user starts the main thing. |
| `core_action_completed {kind}` | The main thing worked, and the user saw the result. This is the first value moment. |
| `paywall_shown {trigger}` | The paywall opens. `trigger` says why: `limit`, `feature`, `settings`. |
| `purchase_completed {product}` | RevenueCat's purchase call succeeded ([revenuecat.md](revenuecat.md)). `product` is the store product id. |
| `share_tapped {kind}` | The user shares something out of the app. |

Rules:

- **Fire on success, where the code knows it.** Not on the tap that starts it.
  `core_action_completed` goes after the result is on screen.
- **`signup_completed` needs a fact from the API.** The sign-in response must
  say whether this call created the account (for example `isNewUser`). The
  app cannot guess it.
- **No personal data in a property.** No email, no name, no file path or photo
  URI, no text the user typed, no search query. Ids of your own things and
  fixed words are fine.
- **Few events.** Each event is one more thing to keep true and to put in the
  privacy policy. Add one only when a question needs it.
- **Touches are not events.** No screen-wide tap capture.

### 6. Ask the user first

This is not legal advice. It is the cautious setup.

Apple's Guideline 5.1.1(ii) says an app that collects user or usage data
must get the user's consent, even if the data is anonymous. It also says
the user must have an easy way to withdraw, and that paid features must not
depend on the answer. The EU's GDPR and the ePrivacy rules point the same
way. So one rule is easiest, for every user:

**Nothing is sent until the user says yes.** That is what the wrapper does:
no PostHog client exists before a yes, so no event leaves the phone and no id
is written to it.

Build two things:

1. **A one-time ask.** A card on the first home screen after sign-up, not a
   blocking dialog. Do not show it on the very first screen. Do not show it
   on a paywall or after an error. Say what you collect, in plain words.
   Two buttons of equal weight: "Yes, share" and "No thanks". Never ask
   twice. Both answers go through `setAnalyticsConsent(true | false)`.
2. **A toggle in Settings.** "Share usage stats", reading
   `getAnalyticsConsent()`. Turning it off calls `setAnalyticsConsent(false)`:
   the wrapper resets PostHog's stored id and shuts the client down.

Suggested wording for the card:

> **Help improve the app?**
> We count which screens and features people use, to find what to fix. If
> you say yes, this is linked to your account. You can turn it off in
> Settings at any time.

Do not call it "anonymous" when you call `identify()`. After a yes the events
are linked to the account. Say that.

What this costs you, honestly: only people who said yes are in the numbers,
and they are fewer than all users. Use the funnel to see where people stop,
not to count users exactly.

A softer option exists: before the answer, send events with no id, kept in
memory only (`persistence: "memory"` in the PostHog options), and no identify.
You see more users. But Apple's rule above covers anonymous data too, so it
carries risk in review and in the EU. Take it only after you have checked
it with someone who can give legal advice. This guide does not do it.

Deleting your own account in the app does not delete what PostHog already
holds for that user id. On a deletion request, also delete that person in
PostHog, and say in the privacy policy how you do it.

### 7. Session replay (optional)

Session replay records the screen of a session, so you can watch where
someone got stuck. It sees what the user sees, so use it only after the
opt-in, and only if you need it. Most apps do not need it at first.

1. Install the native plugin and make a new build (not an OTA update):

   ```bash
   npx expo install @posthog/react-native-plugin
   ```

   Replay needs a development build. It does not run in Expo Go
   (https://posthog.com/docs/session-replay/installation/react-native,
   checked 2026-10-05).
2. In the project's settings, turn on **Record user sessions**.
3. Add this to the options in `start()` in the wrapper. The client exists
   only after a yes, so replay can only run after a yes too:

   ```ts
   enableSessionReplay: true,
   sessionReplayConfig: {
     maskAllImages: true,          // the user's photos and your artwork
     maskAllTextInputs: true,
     maskAllSandboxedViews: true,
     captureLog: false,            // logs can hold personal data
     captureNetworkTelemetry: false, // URLs can hold personal data
     captureTouches: false,
   },
   ```

4. Say it in the consent card ("and screen recordings with photos and text
   hidden"), and in the privacy policy.

Watch two of your own recordings before release. Look for anything readable
that should be hidden.

## Paperwork before release

The privacy policy, the App Privacy answers and the app must say the same
thing. A mismatch is a common rejection ([submit-for-review.md](submit-for-review.md)).

**The privacy policy.** Add PostHog as a processor
([privacy-and-support-pages.md](privacy-and-support-pages.md)). For example:

> If you agree, the app sends usage events (for example "import started")
> and the screens you visit to PostHog, our product analytics service. They
> are linked to your account id, never to your name or email. [If you also
> agree to screen recordings: The recordings hide photos and all text.] They
> are stored in the EU (Frankfurt) for [how long]. You can turn this off in
> Settings. Then we stop sending, and we delete the data we hold about you
> on request.

Fill in "how long" from the data retention shown in the PostHog project
settings. Write the number you see there, not a number you like.

**App Privacy** in App Store Connect ([submit-for-review.md](submit-for-review.md),
step 1):

| Data type | Linked to the user | Tracking | Purpose |
|---|---|---|---|
| Usage Data: Product Interaction | Yes | No | Analytics |
| Identifiers: User ID (when you call `identify()`) | Yes | No | Analytics |

When in doubt, answer "Linked". It is the safe answer. If you use session
replay, also declare Other Usage Data. Apple's definitions:
https://developer.apple.com/app-store/app-privacy-details/ (checked
2026-10-05).

**The privacy manifest.** The App Privacy answers and the manifest must
agree. Add this under `expo.ios.privacyManifests.NSPrivacyCollectedDataTypes`
in `app.json`, next to any entries you already have
([crash-reports.md](crash-reports.md), the Sentry step):

```json
{ "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeProductInteraction",
  "NSPrivacyCollectedDataTypeLinked": true, "NSPrivacyCollectedDataTypeTracking": false,
  "NSPrivacyCollectedDataTypePurposes": ["NSPrivacyCollectedDataTypePurposeAnalytics"] },
{ "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeUserID",
  "NSPrivacyCollectedDataTypeLinked": true, "NSPrivacyCollectedDataTypeTracking": false,
  "NSPrivacyCollectedDataTypePurposes": ["NSPrivacyCollectedDataTypePurposeAnalytics"] }
```

`ship-ios:app-store-ready` checks the privacy manifest.

**No tracking prompt.** Apple says "tracking" is linking your app's data
with third-party data for advertising, or sharing it with a data broker.
Product analytics for your own use is neither. So you do not show the App
Tracking Transparency prompt, and you answer "No" to tracking. Do not
connect PostHog to an ad network, and do not send its data to a data
broker. That would change the answer.

## After launch

1. **Build one funnel.** In PostHog, make a funnel insight with the events in
   order: `signup_completed`, `onboarding_step_viewed`, `core_action_started`,
   `core_action_completed`, `paywall_shown`, `purchase_completed`. Add it to a
   dashboard. One funnel is enough for months.
2. **Read it once a week.** Find the biggest drop between two steps. Fix that
   one. Look again after the next release.
3. **Optional: let the agent read it.** PostHog has an MCP server that can
   run queries and read insights. The address is
   `https://mcp.posthog.com/mcp`. It signs in with the account you log in
   with, and PostHog says it picks the US or the EU data for you
   (https://posthog.com/docs/model-context-protocol, checked 2026-10-05).
   In Claude Code:

   ```bash
   claude mcp add --transport http posthog https://mcp.posthog.com/mcp
   ```

   PostHog's own installer does the same for several agents:
   `npx @posthog/wizard mcp add`. The agent then sees your usage data. Add it
   only on your own machine.

## Where the values go

| Value | Where |
|---|---|
| Project API key (`phc_...`) | the EAS `production` environment, as `EXPO_PUBLIC_POSTHOG_KEY`. Not a secret. |
| Host | the code defaults to the EU host. `EXPO_PUBLIC_POSTHOG_HOST` overrides it. |
| The user's answer | AsyncStorage on the phone, key `analytics.consent` |
| Project settings (IP, autocapture, timezone) | the PostHog project, set once |
| What you collect | the privacy policy, App Privacy, `privacyManifests` in `app.json` |

## Check it works

Use a build that has the key (a production build, or a preview build that has
the variable).

- **Without the key**: run a development build. The app works and sends
  nothing.
- **Before the answer**: sign in and use the app. PostHog's page for live
  events shows nothing from your phone.
- **After "Yes"**: the events appear, with your internal user id. Check that
  the project lives on the cloud you chose: the address starts with
  `eu.posthog.com` for the EU.
- **No personal data**: open a few events. No email, no name, no file path.
  The IP address is not stored.
- **After "No"**, or the Settings toggle off: no new events. The stored id is
  gone, so a new "Yes" starts with a new id.
- **Replay**, if you use it: photos and text are hidden in the recording.
- **Sign-out and account deletion** call `resetAnalytics()`.

Remove any test events from the funnel before you read it for real.

## Common errors

- **No events at all.** The key is missing from that build. Run
  `eas env:list --environment production`. `EXPO_PUBLIC_*` values are fixed
  when the build is made, so set the key first and build again. Or the user
  has not said yes.
- **Events never arrive, and the key looks right.** The key and the host are
  from different clouds. An EU key needs `https://eu.i.posthog.com`.
- **`Cannot find native module 'ExpoApplication'`** (or `ExpoDevice`,
  `ExpoLocalization`). A peer package was added without a new build, or the
  change shipped as an EAS Update. Make a new build.
- **`posthog-react-native` cannot resolve a package.** A peer dependency is
  missing. Run the `expo install` line in step 2 again.
- **Replay shows nothing.** **Record user sessions** is off in the project, or
  you are in Expo Go. Use a development build.
- **Replay shows a photo or typed text.** A masking option is off, or the
  view is custom. Check `sessionReplayConfig`, and mask that view.
- **The event count grows fast.** Lifecycle events or autocapture is on.
  Keep `captureAppLifecycleEvents: false`, and do not add `PostHogProvider`.
- **Two people for one user.** `identify()` ran with a different id, such as
  the email on one screen and the user id on another. Use the user id
  everywhere.
- **App Review asks why the app collects usage data.** The App Privacy
  answers or the policy do not name PostHog, or the app sends data before the
  user said yes. Fix both to match.
