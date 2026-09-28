# App Store Connect setup (the manual parts)

Runs on: your browser (App Store Connect and your Apple Developer account).

App Store Connect (https://appstoreconnect.apple.com) is where your app's
store listing, builds, testers and sales live. Some setup can only be done in
the web UI. This guide lists all of it, in the order you need it, and says
which onebox skill takes over afterwards. You need it before the first
TestFlight build, and before you create subscription products.

## What it costs

Nothing extra. It comes with the Apple Developer Program (see
[apple-developer.md](apple-developer.md)).

Where this guide says "the page for X", it names the section; Apple moves
buttons around, so look for that section rather than a specific button.

## Steps

### 1. Register the bundle ID

The bundle ID (for example `com.example.myapp`) is permanent. Pick it now and
put the same value in `ios.bundleIdentifier` in your app config.

- **Automatic:** the first `eas build` registers it for you, with the
  capabilities your app config declares.
- **By hand:** in https://developer.apple.com/account, open **Certificates,
  Identifiers & Profiles**, click **Identifiers**, then the add button (+).
  Choose **App IDs**, then **App**, enter a Description and an **Explicit**
  Bundle ID, tick the capabilities you use (Sign in with Apple, Push
  Notifications ...), then **Continue** and **Register**.

Some capabilities cannot be set by EAS and must be ticked here by hand (see
the pitfalls in `ship-ios:expo-local-build`).

### 2. Create the app record

**The API cannot do this** (`POST /v1/apps` answers 403).

1. In App Store Connect, open **Apps** and click the add button (+), then
   **New App**.
2. Fill in:
   - **Platforms:** iOS.
   - **Name:** the App Store name, up to 30 characters. It must be unique on
     the store. Your home screen name (`expo.name`) can be shorter.
   - **Primary Language.**
   - **Bundle ID:** pick the one from step 1.
   - **SKU:** any internal code you like, for example the bundle ID.
   - **User Access:** Full Access, unless you have a team and want to limit it.
3. Click **Create**. The app appears with the status Prepare for Submission.

Copy the numeric **Apple ID** of the app (on the app's App Information page).
Put it in `eas.json` at `submit.production.ios.ascAppId`, so `eas submit`
needs no prompts. It is not a secret.

### 3. Agreements, tax and banking (only if you sell anything)

Needed for paid apps, in-app purchases and subscriptions. Only the Account
Holder can do it.

1. Open **Business** at the top of App Store Connect.
2. On the **Agreements** tab, find **Paid Apps** and click
   **View and Agree to Terms**.
3. Add tax and banking information when asked.

Until the Paid Apps Agreement is active, products load empty in your app: the
paywall shows no prices and no buy button, with no error.

### 4. Users and Access

- Invite teammates, and internal testers who are not on your team yet, in
  **Users and Access**.
- The **App Store Connect API key** is created here too (Integrations tab):
  follow [app-store-connect-api-key.md](app-store-connect-api-key.md).
- The **In-App Purchase key** for RevenueCat is created on the same
  Integrations page: see [revenuecat.md](revenuecat.md).

### 5. TestFlight: internal group and testers

1. Open your app, then the **TestFlight** tab.
2. Click the add button (+) next to **Internal Testing** and name the group.
   Tick **Enable automatic distribution** if every new build should go to it.
3. Open the group, click **Invite Testers**, select people, click **Add**.

Internal testers must be users on your App Store Connect team (up to 100 per
group). Anyone else is an external tester: make an external group, and the
first build of each version needs Beta App Review.

### 6. Export compliance

Each build asks whether the app uses non-exempt encryption. Answer it once for
all builds in the app config: `ITSAppUsesNonExemptEncryption: false` under
`ios.infoPlist` ([expo-app.md](expo-app.md), step 3). The
`ios.config.usesNonExemptEncryption` key does the same. The
`ship-ios:app-store-ready` skill explains the answer. Without it, each build
waits as "Missing Compliance" until you answer on its page.

### 7. Subscriptions and in-app purchases (if paid)

In your app, open the page for **Subscriptions** (or **In-App Purchases**):
create a subscription group, then products with product IDs, durations and
prices. The first subscription must be submitted together with an app
version. Each product needs a review screenshot of your paywall.

### 8. The store listing and review information

On your app's pages in App Store Connect:

- **App Information:** name, subtitle (30 characters), category, **Content
  Rights**, **Age Rating** (answer the questionnaire; the updated questions
  were due 2026-01-31).
- **App Privacy:** the privacy policy URL, and the data-collection answers
  ("nutrition labels"). Answer from what your code and SDKs really collect.
- **Pricing and Availability:** price (Free is fine) and countries.
- The **version page** (1.0 Prepare for Submission): screenshots, promotional
  text, description, keywords, support URL, marketing URL, the build, and
  **App Review Information** (contact details, a demo account or a note on how
  to sign in, and notes for the reviewer).
- **EU trader status** (Digital Services Act): declare whether you are a
  trader. Without it the app is not shown in the EU. Apple's help page
  "Manage European Union Digital Services Act trader requirements" shows where.

### 9. Submit

On the version page, click the button to add it for review, then submit.
Watch for messages in App Review (on your app's pages) and your email.

## What the onebox skills automate afterwards

| Task | Manual or skill |
|---|---|
| Bundle ID registration | `ship-ios:expo-local-build` (EAS does it on first build) |
| App record | **manual**, once |
| Paid Apps Agreement, tax, banking | **manual**, once (Account Holder) |
| API key, In-App Purchase key | **manual**, once |
| Build upload | `ship-ios:expo-local-build` |
| Export compliance | app config (once), or `ship-ios:appstore-connect` per build |
| TestFlight groups, testers, adding builds | `ship-ios:appstore-connect` (after you create the first group, or via `add-tester`) |
| Build status and processing | `ship-ios:appstore-connect` |
| Subscription group and products | `ship-ios:appstore-connect` (`subs-create`); trial offers and the review screenshot stay **manual** |
| Screenshots | `ship-ios:app-store-screenshots` |
| Checking you did not miss anything | `ship-ios:app-store-ready` |
| App Privacy, age rating, pricing, review info, EU trader status, Submit | **manual** |

## Where the values go

- The app's numeric Apple ID: `eas.json` → `submit.production.ios.ascAppId`.
- Nothing here is a secret. The API keys you make in step 4 are; see their
  guides.

## Check it works

- The app shows in **Apps** with status Prepare for Submission.
- `node <ship-ios>/skills/appstore-connect/scripts/asc.mjs apps` lists it
  (once you have an API key).
- The `ship-ios:app-store-ready` skill's report has no BLOCKED items.

## Common errors

- **"The bundle ID is not available"** when creating the app: the ID is
  registered under a different team, or used by another app. Pick a new one.
- **"The app name you entered is already being used."** App Store names are
  unique across the store. Add a word ("Myapp: Budget Planner").
- **Products show "Missing Metadata".** Normal until you attach a review
  screenshot and fill in localizations.
- **The paywall shows no products.** Paid Apps Agreement not active, product
  IDs do not match, or products not "Ready to Submit".
- **Build does not show up under TestFlight.** It is still processing (5 to
  30 minutes), or it failed and Apple emailed you why.
