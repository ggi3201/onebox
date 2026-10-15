# RevenueCat

Runs on: your browser (RevenueCat and App Store Connect), then your app and
your server.

RevenueCat sits between your app and Apple's in-app purchase system. The app
asks RevenueCat what to show and who has paid. RevenueCat validates
purchases with Apple, tracks renewals and cancellations, and can tell your
server with webhooks. You do not need to parse Apple receipts. You need it
only if the app sells subscriptions or other in-app purchases.

Before you start you need, in App Store Connect
([app-store-connect-setup.md](app-store-connect-setup.md)):

- the app record (step 2),
- the Paid Apps Agreement (step 3). RevenueCat cannot sell anything without
  it,
- the Issuer ID of your App Store Connect API key
  ([app-store-connect-api-key.md](app-store-connect-api-key.md)).

## What it costs

Free up to 2,500 USD of monthly tracked revenue. Above that, 1% of tracked
revenue. Checked 2026-09-28 at https://www.revenuecat.com/pricing/.

## Use RevenueCat's own Claude Code plugin

RevenueCat publishes an official plugin with an MCP server and skills for the
React Native SDK, offerings and paywalls. Use it for the SDK setup, products,
entitlements, offerings and paywall work:

```bash
claude plugins marketplace add RevenueCat/ai-toolkit
claude plugins install revenuecat
```

It signs in with OAuth in your browser, so it needs no API key.
Source: https://github.com/RevenueCat/ai-toolkit. MCP docs:
https://www.revenuecat.com/docs/tools/mcp

The plugin is for Claude Code. In another coding agent, you can connect the
MCP server directly. See the MCP docs above.

onebox does not repeat that work. This guide covers the account and the
Apple side.

## Steps

1. **Make an account** at https://app.revenuecat.com and create a
   **project** for your app.
2. **Create the subscription products in App Store Connect first**, with the
   `ship-ios:appstore-connect` skill (`subs-create`) or in the web UI. Pick
   product IDs you will keep forever, for example
   `com.example.myapp.pro.yearly`.
3. **Make an In-App Purchase key** in App Store Connect: **Users and Access**,
   **Integrations**, then **In-App Purchase**. Generate a key and download the
   `.p8` file (once only). RevenueCat needs it to record StoreKit 2
   purchases; without it, purchases can fail to record. Note its Key ID.
4. **Add the App Store app to the RevenueCat project**: bundle ID, the
   In-App Purchase key file and its Key ID, and the Issuer ID (the same one as
   your App Store Connect API key). RevenueCat can also take an App Store
   Connect API key to import your products.
5. **Set up products, an entitlement and an offering** in RevenueCat (or let
   the RevenueCat plugin do it). The product IDs must match App Store Connect
   exactly.
6. **Copy the public SDK key** for the App Store app (it starts with `appl_`)
   from the project's API keys page. It ships inside the app, so it is not a
   secret. Put it in `eas.json` `env` for each build profile, for example
   `EXPO_PUBLIC_REVENUECAT_IOS_KEY`.
7. **Make a sandbox tester** in App Store Connect (**Users and Access**,
   Sandbox), and test a purchase, a restore and a cancellation on a real
   device before you submit.

## Where the values go

- Public SDK key (`appl_...`): in the app, via `eas.json` `env`. Never the
  secret key.
- Secret key (`sk_...`): only on your server, and only if your server calls
  the RevenueCat REST API or you use the MCP server without OAuth. Create it
  on the project's API keys page (**+ New secret API key**). Store it in your
  secrets tool. RevenueCat has two REST API versions, and a secret key is made for one of
  them. A v2 key does not work on v1 endpoints (for example
  `GET /v1/subscribers/{id}`), and the reverse. Make the version your code
  calls.
- Webhook secret: you choose it in RevenueCat's webhook settings, and your
  server checks it in the Authorization header. Store it with your secrets
  tool too.

## Check it works

- In the app, `Purchases.getOfferings()` returns your offering with prices.
  Empty offerings mean: wrong or missing SDK key, product IDs that do not
  match, or no active Paid Apps Agreement.
- A sandbox purchase shows up in the RevenueCat dashboard under the customer
  with **your** user ID. That needs `Purchases.logIn(<your user id>)` after
  sign-in.
- The `ship-ios:app-store-ready` skill's Payments section has no BLOCKED items.

## The paywall

The RevenueCat plugin builds the paywall screen. This part is about what goes
on it and what it charges. Decide the price first, then the screens.

### Set the price

Two numbers set the price: what similar apps charge, and what one user costs
you.

1. **Write down what competitors charge.** Find 4 to 6 apps that do the same
   job. Note the monthly and the yearly price of each. Put your app where its
   features belong in that list. An app that only logs data sits at the low
   end. An app with AI that does real work for the user sits higher.
2. **Measure what one user costs you per month.** If the app calls an AI
   model, add up the cost of a light, a median and a heavy user per month.
   Use real token counts from a development build, not a guess.
   [hosted-ai-limits.md](hosted-ai-limits.md) records the cost of each call.
3. **Work out what you keep.** Apple keeps a commission on each sale. In the
   App Store Small Business Program it is 15%, so you keep 85%. Compare the
   yearly price net, per month, with the median user's cost.

An example. The median user costs 1.20 USD a month, the heavy user 5 USD:

| | price | you keep (85%) | per month | vs median user |
|---|---|---|---|---|
| Monthly | 7.99 USD | 6.79 USD | 6.79 USD | 5.7× |
| Yearly | 49.99 USD | 42.49 USD | 3.54 USD | 3.0× |

- **Price on the median user, not the heavy one.** A cost cap per user
  protects you from the heavy user ([hosted-ai-limits.md](hosted-ai-limits.md)).
  Without a cap, the median user pays for the heavy one.
- **Make yearly clearly cheaper than 12 months of monthly.** A yearly buyer
  pays up front and decides to stay only once a year.
- **Give a free trial instead of a free AI allowance.** A 7-day trial on
  the yearly plan costs you one week of AI. A free allowance needs its own
  counter and reset, and it costs money forever. Apple gives each person one
  introductory offer per subscription group.

**The 15% rate is not automatic. You must enroll.** The Account Holder accepts
the Paid Apps Agreement, then enrolls on Apple's page. The rate starts 15 days
after the end of the month in which Apple approves you. It holds while your
total proceeds stay at or below 1 million USD in a calendar year. Above that,
the standard rate applies to later sales. Enroll before your first sale.
Checked 2026-10-15 at
https://developer.apple.com/app-store/small-business-program/.

**Check the subscription levels in App Store Connect.** Level 1 is the highest
level in a subscription group. A move to a higher level happens at once, with a
prorated refund. A move to a lower level waits for the next renewal. The API
can give levels in the order you create the products. Then monthly may end up
above yearly, and a switch from yearly to monthly refunds most of the year. Put
yearly at the same level as monthly, or above it. Source:
https://developer.apple.com/app-store/subscriptions/.

### Design the paywall

- **One screen sells, the next takes the money.** A single screen with the
  value, the price, two plans, the trial terms, restore and the legal links is
  too much to read. Put the value on the first screen, with no numbers on it.
  Put the plans on the second. "Back" on the plans screen goes to the first
  screen, not out of the paywall.
- **Lead with what the user gets.** Write outcomes: "Plans your week from your
  own notes." Do not list internal feature names ("Smart Sync"), and do not lead
  with limits or quotas. Make no promise the app cannot always keep, such as
  "in about a minute".
- **Fit the headline to where the paywall opened.** Pass the reason in when you
  open it. A user who tapped the AI button mid-task reads about that task.
  Keep a true fallback headline for an unknown reason.
- **Preselect the yearly plan and its trial.** Show the yearly price and the
  same price per month. The monthly plan sits below it, plain.
- **Keep the plans and the buy button fixed on screen.** If the value part
  scrolls or pages, the plans stay put. A user who already knows can buy
  without scrolling.
- **Never hard-code a price.** Show the store's `priceString` from the
  offering. It is localised per storefront: a user in Japan sees yen. A
  hard-coded price is wrong in most countries, and a price change then needs a
  release. If offerings fail to load, show a retry, not a fallback price.
- **Show the trial only to people who can get it.** Someone who used the
  trial before gets none. Ask
  `Purchases.checkTrialOrIntroductoryPriceEligibility([productId])`, and show
  the trial only when the status is `INTRO_ELIGIBILITY_STATUS_ELIGIBLE`.
  Source: RevenueCat's
  [react-native-purchases](https://github.com/RevenueCat/react-native-purchases)
  SDK.
- **Say what happens after the trial.** One line: the price, the period, and
  that the user can cancel in Settings. A surprise charge brings a refund
  request and a bad review.
- **Show the paywall right after the first result.** Let the user get one
  real result for free, for example one AI answer, then show the paywall.
  When the free uses run out, open the paywall, not an alert.
- **Restore purchases, Terms of Use and Privacy Policy** are on the plans
  screen. App Review checks them (Guidelines 3.1.1 and 3.1.2). The
  `ship-ios:app-store-ready` skill checks them too.

### Tests that guard the paywall

The paywall makes claims about the user's money. Keep the copy as data (a
headline per reason, the trial line, the saving), so plain unit tests can
check it:

- **No false discount.** The "Save 40%" badge is computed from the two store
  prices. When yearly is not cheaper than 12 months, there is no badge. A
  missing or zero price gives no badge, not "Save 0%".
- **No false trial.** With 0 trial days, the screen says nothing about a
  trial. The renewal line still shows the price and how to cancel.
- **The price passes through as the store sent it.** A test feeds in
  `¥800` and expects exactly that text.
- **No screen skips the gate.** A test reads every screen file and fails if
  one renders the paid feature directly instead of through the gate
  component. Keep a short list of allowed files, each with a reason. Also
  check that the test finds more than a few screens, so it cannot pass on an
  empty list. A new screen that skips the gate still compiles and works,
  so only a test like this finds it.

Unit tests cannot buy anything. Test a real purchase with a sandbox tester on
a device (step 7).

## Free access for reviewers and family

You may want to give the paid tier to people who do not pay: family, a
tester, a reviewer. Do not write the gift into the paid tier. The webhook
owns the paid tier: the next purchase, `EXPIRATION` or `TRANSFER` event
rewrites it, and the gift is lost without a trace.

Keep the gift in its own column:

- `tier`: written only by the webhook.
- `complimentary_tier`: written only by you, by hand or from an admin screen.
  Record who gave it and when.
- The user gets the higher of the two. Compute it in one place on the server,
  and use it everywhere.

A gift needs a stable user ID. Give it after the user signs in with Apple.
An anonymous account gets a new ID on reinstall, and the gift stays on the
old one.

Tell the app when the access is a gift. Then it hides "Manage subscription"
and "Restore purchases", which would open an empty page.

Keep the AI cost cap on gifted accounts. The cap protects your bill, and a
gifted account can loop like any other.

## Yearly plans

A yearly plan sends `RENEWAL` once a year, not once a month. Code that refills
a monthly AI allowance on `INITIAL_PURCHASE` and `RENEWAL` leaves a yearly
buyer with nothing after the first month. Let the webhook set only the tier
and the expiry date. Reset the allowance on your own clock.
[hosted-ai-limits.md](hosted-ai-limits.md), "Paid plans", shows how.

## Common errors

- **The paywall shows no prices and no buy button, and nothing errors.**
  Offerings came back empty. See "Check it works".
- **Purchases do not reach your server.** The app never called
  `Purchases.logIn`, so purchases sit on an anonymous RevenueCat ID your server
  cannot match. Or the webhook checks a header RevenueCat does not send.
- **A secret key (`sk_`) in the app bundle.** Anyone can read it from the
  binary and change any customer. Remove it and rotate it now.
- **After a restore on a new phone, the subscription is on an empty account.**
  Call `Purchases.logIn` again whenever the signed-in user changes, and offer
  sign-in at the paywall so the account and the subscription stay together.
- **App Review cannot reach the paid features.** Reviewers buy in the sandbox.
  Make sure sandbox purchases work, and explain in the review notes.
