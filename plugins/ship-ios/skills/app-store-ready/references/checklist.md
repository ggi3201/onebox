# App Store readiness checklist

Each item has the id that `check.mjs` prints, the guideline when there is
one, why it matters, and the fix. Guideline text:
https://developer.apple.com/app-store/review/guidelines/

Dated upload requirements were checked on 2026-09-28 at
https://developer.apple.com/news/upcoming-requirements/.

---

## Build and upload

**xcode** (upload requirement). Since 2026-04-28, uploads must be built with
Xcode 26 or later and the iOS 26 SDK. Local builds use the Mac's Xcode
(`xcodebuild -version`). Cloud builds use the EAS build image; keep it current.

**deployment-target** (upload requirement). Since 2026-09-09, iOS apps must
target iOS 13 or later. Current Expo SDKs already do.

**bundle-id**. `ios.bundleIdentifier` is permanent once the app record exists.
Choose it before creating the record. A placeholder like `com.example.*` or
`com.anonymous.*` must go.

**name**. `expo.name` is the name under the icon. iOS truncates it at about
12 characters. The App Store name (up to 30 characters) and subtitle (up to
30) are set in App Store Connect. Short on the phone, full in the store is the
normal split.

**version**. `expo.version` is the marketing version. Uploading a version that
is already live or in review fails ("You've already submitted this version"),
often long after the binary was built. Bump it for each release.

**build-number**. Each upload needs a higher build number. Let EAS own it:
`"cli": {"appVersionSource": "remote"}` and `"autoIncrement": true` on the
production profile.

**icon**. A 1024×1024 PNG without alpha, or an Icon Composer `.icon` folder
plus an opaque PNG fallback. App Store Connect rejects a 1024 px icon with an
alpha channel. Expo flattens a transparent PNG onto white, so transparent
corners turn white. See the `draw-app-icon` skill.

**splash**. Configure `expo-splash-screen`, or the app opens on a blank white
screen.

**purpose-\*** (ITMS-90683). Every permission an installed library can ask for
needs its `NS...UsageDescription` string. A missing one crashes the app when
it asks, and can fail the upload. Plugins add Expo's default text ("Allow
$(PRODUCT_NAME) to access your camera") when you do not set one. Set your own
through the plugin's option or `ios.infoPlist`.

**purpose-text** (5.1.1). Say what the app does with the permission, in the
user's terms: "Take a photo of a receipt to add it to your expenses." Generic
text is a common rejection.

**export-compliance**. Without `ITSAppUsesNonExemptEncryption` every build
waits in TestFlight as "Missing Compliance" until someone answers the
question by hand. If the app only uses HTTPS, the keychain and OS-provided
crypto (for example SHA-256 inside an OAuth PKCE flow), set
`"ios": {"config": {"usesNonExemptEncryption": false}}`. Custom or
non-standard cryptography needs the real answer. For a build that is already
stuck: `asc.mjs compliance <buildId> --no-encryption`.

**eas-json**. The production profile must not use `"distribution":
"internal"` (that makes an ad hoc build that cannot go to the store).

**eas-submit**. Put the numeric App Store Connect app ID in
`submit.production.ios.ascAppId`, so `eas submit` runs without prompts.

**eas-submit-key**. `ascApiKeyPath`, `ascApiKeyId`, `ascApiKeyIssuerId`: all
three or none. With none, eas uses the key stored on EAS servers. See
`expo-local-build/references/pitfalls.md`.

**decoy-config**. An `app.json` above the app folder (a monorepo root) is a
trap. If eas runs there, it syncs that config's capabilities to Apple and can
turn Sign in with Apple or push off on the live App ID, with a green tick.
Replace it with an `app.config.js` that throws.

---

## Privacy

**privacy-manifest** (upload requirement since 2024-05-01, ITMS-91053).
Declare why the app's code and its SDKs use "required reason" APIs, in
`ios.privacyManifests`. Apple emails a list of missing ones a few minutes
after upload. Expo does not reliably merge the manifests of static CocoaPods
dependencies, so copy their reasons into the app config. Most React Native
apps need at least:

```json
"ios": {
  "privacyManifests": {
    "NSPrivacyAccessedAPITypes": [
      { "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryUserDefaults", "NSPrivacyAccessedAPITypeReasons": ["CA92.1"] },
      { "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryFileTimestamp", "NSPrivacyAccessedAPITypeReasons": ["C617.1"] },
      { "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategorySystemBootTime", "NSPrivacyAccessedAPITypeReasons": ["35F9.1"] },
      { "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryDiskSpace", "NSPrivacyAccessedAPITypeReasons": ["E174.1"] }
    ]
  }
}
```

Check each reason code against Apple's list before relying on it:
https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api
After a build, confirm `PrivacyInfo.xcprivacy` is in the app bundle.

The privacy manifest is **not** the App Privacy answers and **not** the
5.1.2(i) consent. It says which APIs the code uses. It does not say that
photos go to an AI provider. You need all three.

**att** (5.1.2(i)). If the app or an SDK tracks users across other companies'
apps or websites, ask with App Tracking Transparency before tracking starts,
and declare it in App Privacy. If nothing tracks, do not show the prompt. A
prompt with no tracking behind it is a rejection risk.

**ai-consent** (5.1.2(i)). "You must clearly disclose where personal data will
be shared with third parties, including with third-party AI, and obtain
explicit permission before doing so." Before the first chat message, photo,
voice clip or document goes to an AI provider:

- Show a one-time sheet that says what is sent and that a third-party AI
  service processes it. Link the privacy policy, which names the providers.
- "Not now" cancels that action. It does not block the rest of the app.
- Every entry point that sends data goes through the same consent gate.
- Record the answer on the server if the account moves between devices.

**app-privacy** (App Store Connect). Answer the App Privacy questions from
what the code really collects and sends, SDKs included (analytics, crash
reporting, RevenueCat, AI providers). Decide the ambiguous ones deliberately
and write down why. Example: a random ID the app creates for itself is not
automatically the "Device ID" data type; the advertising identifier is.

**privacy-policy** (5.1.1(i)). A privacy policy URL in App Store Connect, and
a link inside the app. It must match what the app does. Write it from the
code, not from a template.

---

## Accounts

**account-deletion** (5.1.1(v)). "If your app supports account creation, you
must also offer account deletion within the app." What reviewers and users
expect, learned from real apps:

- Reachable in about two taps from the main screen or Settings, labelled so
  someone looking for it finds it.
- It really deletes. Suffixing the email and hiding the row is not deletion.
  Delete personal data, history, memories, uploads and push tokens. Keep only
  what the law requires, and scrub it.
- Guest or anonymous accounts that hold data on the server need a delete too
  ("Delete my data"), not only signed-in ones.
- Deleted data must not come back from another device's sync or cache.
- **Sign in with Apple**: revoke the user's Apple tokens through Apple's REST
  API when the account is deleted.
- **Subscriptions**: tell paying users that the App Store subscription keeps
  billing until they cancel it, and link Manage Subscriptions. Delete the
  customer in RevenueCat too.
- Revoke every session and device credential, so no phone can still sign in
  as the deleted account.

**sign-in-with-apple** (4.8). If the app offers a third-party or social login
(Google, Facebook), it must also offer an equivalent login that limits data
collection. Sign in with Apple is the usual answer. With
`expo-apple-authentication`, set `"ios": {"usesAppleSignIn": true}`. Without
it, an EAS build can turn the capability off on the App ID.

**apple-button**. Use the system `AppleAuthenticationButton`. A styled button
that says "Continue with Apple" breaks Apple's button rules and is rejected.

**login-required** (5.1.1(v)). If the app has no significant account-based
features, let people use it without logging in.

**demo-account** (2.1). "Include demo account info (and turn on your back-end
service!)". In the App Review Information section of App Store Connect:

- Email or password login: a working demo account with sample data.
- Sign in with Apple only: say so. Reviewers use their own Apple ID, so a
  brand-new account must reach every feature. Explain anything they need to
  know (for example, how to reach the paid features: sandbox purchase).
- The backend must be up during review.

---

## Payments

**iap** (3.1.1, 3.1.3, 3.1.5). Digital content and features unlocked in the
app must use in-app purchase. Physical goods and real-world services must
**not** use in-app purchase; use a normal payment provider. Person-to-person
real-time services have their own rule (3.1.3(d)). Know which one you sell.

**restore** (3.1.1). A visible "Restore purchases" on the paywall, and
ideally in Settings.

**paywall-links** and paywall content (3.1.2). "Before asking a customer to
subscribe, you should clearly describe what the user will get for the price."
On the paywall, before the buy button:

- What is included, concretely.
- Price and billing period for each plan, from the store (localised).
- For a free trial: how long, and what it costs after.
- That it renews automatically and can be cancelled in Settings.
- Working links to Terms of Use (EULA) and the Privacy Policy. Also put the
  Terms of Use link in the App Store description or the EULA field.
- Restore purchases.

A two-step paywall works well: step 1 sells (what it does, no numbers), step 2
has plans, trial terms, restore and the links. A per-month figure for a
yearly plan must not round in your favour.

**paywall-prices**. Never hard-code prices. Show the store's localised price
string (RevenueCat `package.product.priceString`). Prices differ per country,
and a price change should not need a release.

**paid-apps-agreement** (App Store Connect, Business). The Paid Apps
Agreement, tax and banking must be active. Without it, products load empty,
and the paywall shows no prices and no buy button, with no error.

**products-match**. The subscription group and products exist in App Store
Connect, and their product IDs match RevenueCat's products and the code.
Product IDs are permanent. In a group, level 1 is the highest tier: put the
yearly plan at level 1, or upgrades and downgrades run backwards.

**iap-with-version**. The first subscription (or first IAP of each type) must
be submitted with a new app version. Select it on the version page before
submitting. Products stay "Missing Metadata" until a review screenshot of the
paywall is attached.

**iap-reviewable** (2.1(b)). In-app purchases must be "complete, up-to-date,
visible to the reviewer and functional". If one cannot be found in the app,
explain why in the review notes.

**sandbox-purchase**. Before submitting, on a real device: a sandbox purchase
unlocks the feature, a restore on a fresh install brings it back, and a
cancellation or expiry locks it again. Tests in Node or the simulator do not
prove purchases work.

**review-bypass**. Do not ship a global "grant everyone premium" switch for
App Review. Reviewers buy in the sandbox like testers. If a reviewer needs
free access, grant it to their account on the server.

**revenuecat-login**. Call `Purchases.logIn(<your user id>)` after sign-in,
and again whenever the account changes. Otherwise purchases sit on an
anonymous RevenueCat ID your server cannot match, or a restore moves the
subscription to the wrong account.

**revenuecat-key**. The app ships the public SDK key (`appl_...`). A secret
key (`sk_...`) in the app or in `eas.json` gives every reader of the binary
write access to all customers. Remove and rotate it. A missing public key
makes offerings empty: a paywall with no prices and no error.

**server entitlement** (if a backend gates features). Lessons from a real
integration:

- Let the server ask RevenueCat who is entitled, and treat webhooks as "go
  and re-check this user". Then a forged webhook or a tampered client cannot
  grant access.
- Check the webhook's Authorization header, and refuse all webhooks when the
  secret is not configured (fail closed).
- Decide access by the expiry date, not the event type. A CANCELLATION event
  fires when auto-renew is turned off, and the user keeps access until the
  period ends. A billing issue is still inside a grace period.
- Events arrive out of order. Drop an event older than the one already
  stored, or a late EXPIRATION revokes a fresh renewal.
- An unknown event type does not revoke. An unreachable store changes
  nothing.
- A TRANSFER moves the entitlement: grant the new account and revoke the old.
- A restore on a new phone can land the subscription on a fresh, empty
  account. Offer sign-in at the paywall so data and subscription stay
  together, and say so if a restore lands on an empty account.

---

## Content and behaviour

**backend-url** (2.1). The reviewer's phone cannot reach `localhost`, your
LAN or your laptop. Read the API URL from `EXPO_PUBLIC_API_URL` per EAS
profile, and make the production value a public `https://` URL.

**https**. iOS blocks plain `http://` by default (App Transport Security).
Requests fail on a phone before they leave it.

**env-in-builds**. `EXPO_PUBLIC_*` values are inlined into the bundle at build
time. A value that lives only in a git-ignored `.env.local` is empty in every
build made elsewhere. Define it per profile (`eas.json` `env`, or EAS
environment variables) and check with `eas env:list --environment production`.
Make "no server configured" show a clear error, separate from "server
unreachable". An app built to work offline can otherwise run for weeks
without sending anything.

**offline-launch** (2.1). Launch with airplane mode on and with the backend
down. The app must show something useful or a clear error. No crash, no
endless spinner, no swallowed rejection.

**placeholder** (2.1). No lorem ipsum, "coming soon", empty tabs, test
accounts or broken links.

**min-functionality** (4.2). "Your app should include features, content, and
UI that elevate it beyond a repackaged website." A WebView around a site is
rejected.

**other-platforms** (2.3.10). Do not mention Android or Google Play in the iOS
app or its metadata.

**AI output**. Label AI-generated content as AI. Health, diet, fitness and
medical answers need care (1.4.1): no unqualified medical advice, a clear
note that it is not medical advice, and scope the assistant to the app's
job. Filter generated images and text for objectionable content.

**user-generated content** (1.2). If users post content others can see:
filtering, a way to report content, a way to block users, and a published
contact.

**ipad**. With `ios.supportsTablet: true`, App Review tests on iPad and you
need an iPad screenshot set. Phone-only apps set it to `false`.

**device-test** (2.1). Test a release build on a real iPhone before you
submit. The `ios-preview-build` skill does this without TestFlight.

---

## Security in the app

App Review rarely rejects for these. Users get hurt by them. The script checks
the first four.

**public-secrets**. Everything in `EXPO_PUBLIC_*` variables and in the app
config's `extra` is inside the app, readable by anyone who downloads it. So is
any string in the source. The script looks for secret-looking values (`sk_`,
`sk-`, private keys, GitHub, AWS and Slack tokens) in `eas.json`, the `.env`
files, `extra` and the source, and for secret-looking names (`SECRET`,
`PASSWORD`, `OPENAI_API_KEY` and similar). Only public values belong in the
app: the API URL, the RevenueCat `appl_` key, the Expo project ID. Call AI
providers from your backend. A secret that was ever in a build must be
**rotated**: the builds people already installed keep it. Confirm on the real
bundle: `npx expo export --platform ios` and search the output
(`guides/expo-app.md`, step 8).

**google-key** (CHECK). Firebase and Maps keys are designed to be public. Restrict
each one to the bundle ID and to the APIs it needs in the Google Cloud console.
A Gemini (Google AI) key is a secret and must not be in the app.

**token-storage**. Access and refresh tokens go in `expo-secure-store` (the
Keychain), not in AsyncStorage. AsyncStorage is a plain file that goes into
device backups. The script flags `AsyncStorage.setItem` calls whose line
mentions a token, a session or auth, and a persisted store that holds tokens.
A push notification token is not a secret; ignore that hit.

**ats**. `NSAllowsArbitraryLoads`, `NSAllowsArbitraryLoadsInWebContent`, or
`NSExceptionAllowsInsecureHTTPLoads` for a public domain turn off App Transport
Security in release builds too. Review asks you to justify them. Serve every
host over `https`. Local addresses in development work without them.

**dev-flags**. The production profile must not set `developmentClient: true`,
and must not turn on `EXPO_PUBLIC_*` switches such as `DEBUG`, `MOCK`,
`BYPASS` or `SKIP_PAYWALL`. Put debug features behind `__DEV__`, which is
false in release builds. The script cannot see a debug screen that is reachable
by a gesture or a hidden tap: check by hand that a release build has no server
picker, test login or "grant premium" switch.

**backend-debug** (CHECK). Debug, admin and test endpoints on the API check the
environment and a role on the server. Hiding a button in the app protects
nothing, because anyone can call the URL. See `guides/backend.md`, "Protect the
API".

**cert-pinning** (CHECK, usually "not needed"). HTTPS with App Transport Security
is enough for most apps. A certificate pin that stops matching (Cloudflare
renews its edge certificates on its own schedule) breaks the app for every
user until they update.

---

## App Store Connect metadata

Set by hand in the web UI (see `guides/app-store-connect-setup.md`):

- **privacy-policy** URL and **support-url** that load and have a way to
  contact you.
- **app-privacy** answers.
- **age-rating** questionnaire. The new questions were due 2026-01-31; apps
  without answers cannot submit updates.
- **screenshots**: one iPhone set is required, 6.9" (1320×2868, 1290×2796 or
  1260×2736) or 6.5" if there is no 6.9" set. iPad set if the app runs on
  iPad. 1 to 10 per set. They must show the app in use (2.3.3).
- **Name and subtitle** (30 characters each), description, keywords, category.
- **Content Rights**: whether the app contains third-party content.
- **App Review Information**: contact, demo account, notes.
- **dsa-trader**: EU trader status. Without it, the app is not shown in the EU.
- **Pricing and Availability**.
