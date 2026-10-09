# Submit your app for App Review

Runs on: your browser (App Store Connect). The `ship-ios:appstore-connect`
skill can fill most fields from your Mac, with an App Store Connect API key.

App Review is Apple's check of every app before it goes on the App Store. You
fill in the version page in App Store Connect, pick a TestFlight build, and
press submit. A person at Apple then installs the build, tries it, and
approves or rejects it. This guide walks the version page field by field, in
the order that saves you a second round.

Where this guide says "the page for X", it names the section. Apple moves
buttons around, so look for that section rather than a specific button.

## What it costs

Nothing extra. Review is part of the Apple Developer Program
([apple-developer.md](apple-developer.md)). It takes about an hour the first
time, most of it on App Privacy and the review notes.

## Before you start

- A TestFlight build you tested end to end on your phone, against the
  production API ([start-here.md](start-here.md), Phase 7).
- `ship-ios:app-store-ready` reports nothing blocking.
- The store page text and screenshots are on the version page
  (`ship-ios:store-listing`, `ship-ios:app-store-screenshots`).
- The privacy policy and the support page are live at public URLs
  ([privacy-and-support-pages.md](privacy-and-support-pages.md), or
  `box:new-landing-page`).
- If the app has product analytics, the policy names PostHog and the
  App Privacy answers match ([product-analytics.md](product-analytics.md)).

The version page is the one under your app's iOS version, for example
"1.0 Prepare for Submission". App Store Connect makes it with the app record.

**With the skill.** One command shows what the page still misses, without
changing anything:

```bash
node <ship-ios>/skills/appstore-connect/scripts/asc.mjs review-status --app com.example.myapp
```

Each line says OK, MISSING or CHECK. CHECK means the API cannot see it, and
you check it on the web. Run it again after each step below.

## Steps

### 1. App Privacy

App Privacy is the "nutrition label" on your store page: which data the app
collects, whether it is linked to the user, and whether it is used for
tracking. Apple asks it for every app, also for a free app with no accounts.

**The API cannot read or set it.** You answer it on the page for App Privacy.

Answer from what the code really sends, not from memory. Look at every SDK
and every call to a server. Your answers must match your privacy policy
([privacy-and-support-pages.md](privacy-and-support-pages.md)). A mismatch is
a common rejection.

What the usual parts of this setup add:

| Part | Data type to declare | Linked to the user | Tracking |
|---|---|---|---|
| Sign in with Apple, when you ask for the name and email | Contact Info: Name, Email Address | Yes | No |
| Your own API with accounts | User ID, plus each kind of content the user saves (for example Other User Content, Photos) | Yes | No |
| RevenueCat | Purchases: Purchase History. Identifiers: User ID if you set your own app user ID | Follow RevenueCat's page | Follow RevenueCat's page |
| Crash reports (Sentry), product analytics (PostHog) | See the table in [crash-reports.md](crash-reports.md#app-privacy-answers-and-privacy-policy-lines), and [product-analytics.md](product-analytics.md#paperwork-before-release) | | |
| An AI provider | The content you send to it (for example Other User Content, Photos) | Yes, if your API sends it with the user's ID | No |

- RevenueCat explains its own answers on its page "Apple App Privacy"
  (https://www.revenuecat.com/docs/platform-resources/apple-platform-resources/apple-app-privacy).
- Data that Apple collects itself (TestFlight feedback, Xcode Organizer
  crashes) needs no answer.
- Data that stays on the phone and never leaves it is not "collected" in
  Apple's sense.
- An AI feature must also ask the user before it sends their data to the
  provider (`app-features:ai-consent`). Name the provider in the privacy
  policy.
- Pick a purpose for each type. For this setup it is usually App
  Functionality. Analytics only when you really measure use.

The privacy policy URL also goes on this page. The skill's
`listing-set privacyPolicyUrl` sets it too.

### 2. Age rating

The age rating is a questionnaire on the page for App Information. Apple
computes the rating (4+, 9+, 13+, 16+ or 18+) from your answers. The
questions changed in 2025. An app with old answers must answer the new ones
before its next submission.

Answer each question for what a user can see or do in the app. Two answers
people often get wrong:

- **User-generated content, messaging and chat:** if users can post or send
  anything others see, say yes. App Review then also wants a way to report
  and block users (Guideline 1.2).
- **Unrestricted web access:** yes only if the app opens any web page the
  user types or follows. A link to your own privacy policy is not that.

**With the skill.** Write the answers to a file (format in the skill's
`references/api.md`), then:

```bash
node $A age-rating-set age.json --app com.example.myapp --dry-run
```

`$A` is the path to `asc.mjs`. Without `--dry-run` it sends the answers.

### 3. Price and availability

On the page for Pricing and Availability:

- **Price.** Free is fine. Pick a price here only if the app itself costs
  money to download. Subscriptions have their own prices
  ([revenuecat.md](revenuecat.md)).
- **Countries.** All of them, unless you have a reason. Some countries ask
  for more. China, for example, asks for a government filing number for
  most apps. Leave a country out if you cannot meet its rules.
- **Paid Apps agreement.** A free app needs only the free agreement, which
  you accepted when you joined. A paid app or any in-app purchase needs the
  Paid Apps agreement, with tax and bank details
  ([app-store-connect-setup.md](app-store-connect-setup.md), step 3).
- **EU trader status.** Declare whether you are a trader under the EU
  Digital Services Act. Without it the app is not shown in the EU
  ([app-store-connect-setup.md](app-store-connect-setup.md), step 8). The API
  cannot set it.

The skill reads whether a price and the countries are set. It does not set
them: do it on the web.

### 4. Category

On the page for App Information: a **primary category** and, if you like, a
**secondary category**. The primary one decides where the app shows when
people browse the App Store. Pick what the app does for the user, not where
there are fewer apps.

**With the skill.** `categories` lists the category IDs, for example
`PRODUCTIVITY`. Put them in the version file (step 8) as `primaryCategory`
and `secondaryCategory`.

### 5. Copyright

On the version page: the year and the owner of the rights, for example
`2026 Example Ltd` or `2026 Ada Example`. No URL. The owner is you, or your
company if the developer account is a company's.

**With the skill:** `copyright` in the version file.

### 6. Content rights

On the page for App Information, Apple asks whether the app shows or uses
content from third parties (other people's text, images, music, video). Say
yes if it does, and have the rights to use it. An app that shows only what
its users make, or its own content, says no.

**With the skill:** `contentRights` in the version file:
`DOES_NOT_USE_THIRD_PARTY_CONTENT` or `USES_THIRD_PARTY_CONTENT`.

### 7. The build

On the version page, in the build section, pick the TestFlight build you
tested. Only processed builds with the same version number as the page (for
example 1.0) show up.

The build needs its **export compliance** answer. If the app config has
`ITSAppUsesNonExemptEncryption: false`, it is answered already
([app-store-connect-setup.md](app-store-connect-setup.md), step 6).

**With the skill:**

```bash
node $A builds --app com.example.myapp                          # find the build ID
node $A attach-build --app com.example.myapp --build <buildId> --dry-run
```

It refuses a build that is not processed or has another version number.

### 8. App Review information

On the version page, in the section for App Review Information. A reviewer
reads this before they open the app. Most "Information Needed" rejections
come from this section.

**Review notes.** Tell the reviewer how to reach every feature in a few
lines. For example:

> Sign in with Apple on the first screen. Tap Plan to make a meal plan. The
> AI suggestions need a network connection. Settings > Delete account
> deletes the account and its data. Pro features: buy the monthly plan on the
> paywall (sandbox).

- Name each feature that is hard to find, and where it is.
- Say where account deletion is (Guideline 5.1.1(v)).
- Keep the server up and the features on during the review. Do not deploy a
  breaking change to the production API while the app is in review.

**Demo account.** Give one only when sign-in needs more than Sign in with
Apple, for example an email and password or a code. The reviewer then uses
your demo account. Fill it with sample data, so every screen has something to
show. With Sign in with Apple as the only sign-in, the reviewer uses their
own Apple Account. Then leave the demo account empty, and do not mark
sign-in as required. An app with no accounts needs no demo account either.

**Subscriptions.** The reviewer buys in the sandbox, with test money, in your
production build. Make sure of three things:

- the first subscription is attached to this version. On the version page,
  in the section for in-app purchases and subscriptions, select it. Each
  product needs its review screenshot of the paywall;
- a sandbox purchase unlocks the paid features in a production build.
  RevenueCat handles sandbox receipts for you. Your own server must accept
  them too;
- the review notes say which plan to buy, and what it unlocks.

**Contact.** A first name, last name, phone number and email of a person
Apple can reach during the review. Apple uses it when the app does not work
for the reviewer.

**With the skill.** One file sets the copyright, categories, content rights,
review details and the release type (step 9):

```json
{
  "app": "com.example.myapp",
  "copyright": "2026 Example Ltd",
  "primaryCategory": "PRODUCTIVITY",
  "contentRights": "DOES_NOT_USE_THIRD_PARTY_CONTENT",
  "releaseType": "MANUAL",
  "review": {
    "contactFirstName": "Ada",
    "contactLastName": "Example",
    "contactEmail": "review@example.com",
    "contactPhone": "+1 555 0100",
    "notes": "Sign in with Apple on the first screen. ...",
    "demoAccountRequired": false
  }
}
```

```bash
node $A version-set version.json --app com.example.myapp --dry-run
```

For a demo account, set `demoAccountRequired: true`, `demoAccountName`, and
`demoAccountPasswordRef`: the name of the password in your secrets tool
([secrets.md](secrets.md)). The file never holds the password, and the
script never prints it.

### 9. The release choice

On the version page, in the section for the version release, pick when the
approved version goes live:

| Choice | What happens | Use it for |
|---|---|---|
| Manual | It waits for you to press release after approval | **The first release.** You pick the moment: the server ready, the landing page live, you awake |
| Automatic | It goes live as soon as App Review approves it | Small updates when you do not want to wait |
| Automatic, not before a date | It goes live after approval, but not before the date you give | A launch on a set day |

**Phased release** is for updates only. It sends the update to a small share
of users with automatic updates first, and to everyone over 7 days. You can
pause it for up to 30 days in total. Anyone can still get the update by hand
from the App Store. Use it for every update after the first: a bad update
then reaches few users before you see the crash reports.

**With the skill:** `releaseType` in the version file: `MANUAL`,
`AFTER_APPROVAL`, or `SCHEDULED` with `earliestReleaseDate`. Add
`"phasedRelease": true` for an update.

### 10. Submit

Run the status once more. Fix every MISSING line. Check the CHECK lines on
the web.

On the version page, add the version for review, then submit it. You can
also add a first subscription to the same submission there.

**With the skill:**

```bash
node $A review-status --app com.example.myapp
node $A submit --app com.example.myapp --dry-run
```

Without `--dry-run`, `submit` sends the version to App Review at once. It
refuses when the version has no build, or when a submission is already in
review.

## What happens next

The version state moves through these steps. Apple emails the account holder
at each change.

1. **Waiting for Review.** In the queue. Apple says it typically reviews at
   least 50% of submissions in less than 24 hours and 90% in less than 48
   hours (https://developer.apple.com/distribute/app-review/, checked
   2026-10-09). A first app can take longer.
2. **In Review.** A reviewer has the app. This takes minutes to hours.
3. Then one of:
   - **Pending Developer Release:** approved, and you chose manual release.
     Release it on the version page, or with
     `node $A release --app com.example.myapp --dry-run`, then without
     `--dry-run`.
   - **Ready for Distribution:** approved and live. The App Store can take
     up to a day to show it in every country.
   - **Rejected:** read on.

Change nothing on the production API that the review build needs while it
waits or is in review.

## A rejection

A rejection is normal, also for good apps. Read the message on the page for
App Review in your app. It names the guideline. The common ones for this kind
of app, and what to do, are in [start-here.md, Phase 9](start-here.md#phase-9-submit-and-what-to-do-on-a-rejection).

- If only the text or the screenshots are wrong, fix them and resubmit. No
  new build is needed.
- If the code must change, make a new build with a higher build number,
  attach it (step 7), and resubmit.
- If the reviewer misunderstood, reply to the message and explain. Short and
  polite works best.
- `node $A submit --app com.example.myapp` resubmits after a rejection. It
  reuses the open submission.

For a critical fix after launch, you can ask for an expedited review on
Apple's App Review contact page. Use it rarely.

## Where the values go

| Value | Where |
|---|---|
| App Privacy answers, price, countries, EU trader status | App Store Connect only (web) |
| Age rating answers | App Store Connect. A copy in `age.json` if you use the skill |
| Copyright, categories, content rights, review notes, contact, release type | App Store Connect. A copy in `version.json` if you use the skill |
| Demo account password | Your secrets tool. `version.json` holds only its name |

`version.json` holds your phone number and email. Keep it out of a public
repo: add it to `.gitignore`.

## Check it works

- `review-status` shows no MISSING line, and you checked each CHECK line on
  the web.
- After submit, the version state is Waiting for Review, and Apple sent an
  email.
- After approval: search for the app on the App Store on your phone, install
  it, and sign in.

## Common errors

- **The build does not show up on the version page.** It is still
  processing, it expired, or its version number differs from the page's.
  `builds` shows all three.
- **"Missing Compliance" on the build.** Answer export compliance:
  `node $A compliance <buildId> --no-encryption` if the app uses only HTTPS
  and the system's encryption.
- **The submit fails with a list of missing fields.** Apple names each one.
  Run `review-status`, fill them, and submit again.
- **"You must answer the new age rating questions."** Answer every question
  in step 2. `review-status` lists the open ones.
- **The phased release fails on version 1.0.** Phased release is for updates.
  Leave it off for the first version.
- **Rejected under 2.1, "we were unable to find the in-app purchases".** The
  first subscription was not attached to the version, or the paywall showed
  no products in the sandbox. See step 8, Subscriptions.
- **Rejected under 2.1, "Information Needed".** The demo account does not
  work, or the notes do not say how to reach a feature. Fix the notes, and
  reply to the message.
- **Rejected under 5.1.1 for privacy.** The App Privacy answers, the privacy
  policy and the app disagree. Make all three say the same thing.
- **The version cannot change: it is in review.** Wait, or remove the
  version from review on its page. Then it can change again.
