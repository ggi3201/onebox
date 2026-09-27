# RevenueCat

## What it is and what it costs

RevenueCat sits between your app and Apple's in-app purchase system. The app
asks RevenueCat what to show and who has paid. RevenueCat validates
purchases with Apple, tracks renewals and cancellations, and can tell your
server with webhooks. You do not need to parse Apple receipts.

- Free up to 2,500 USD of monthly tracked revenue. Above that, 1% of tracked
  revenue. Checked 2026-09-28 at https://www.revenuecat.com/pricing/.
- You still need the Paid Apps Agreement in App Store Connect
  (`app-store-connect-setup.md`, step 3). RevenueCat cannot sell anything
  without it.

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

onebox does not repeat that work. This guide covers the account and the
Apple side.

## Steps

1. **Make an account** at https://app.revenuecat.com and create a
   **project** for your app.
2. **Create the subscription products in App Store Connect first**, with the
   `appstore-connect` skill (`subs-create`) or in the web UI. Pick product IDs
   you will keep forever, for example `com.yourname.myapp.pro.yearly`.
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

## Where the value goes

- Public SDK key (`appl_...`): in the app, via `eas.json` `env`. Never the
  secret key.
- Secret key (`sk_...`): only on your server, and only if your server calls
  the RevenueCat REST API or you use the MCP server without OAuth. Create it
  on the project's API keys page (**+ New secret API key**). Store it in your
  secrets tool and reference it in `~/.config/onebox/config.json`:
  ```json
  { "revenuecat": { "apiKeyRef": "REVENUECAT_API_KEY" } }
  ```
  RevenueCat has two REST API versions, and a secret key is made for one of
  them. A v2 key does not work on v1 endpoints (for example
  `GET /v1/subscribers/{id}`), and the reverse. Make the version your code
  calls.
- Webhook secret: you choose it in RevenueCat's webhook settings, and your
  server checks it in the Authorization header. Store it with your secrets
  tool too.

## How to check it works

- In the app, `Purchases.getOfferings()` returns your offering with prices.
  Empty offerings mean: wrong or missing SDK key, product IDs that do not
  match, or no active Paid Apps Agreement.
- A sandbox purchase shows up in the RevenueCat dashboard under the customer
  with **your** user ID. That needs `Purchases.logIn(<your user id>)` after
  sign-in.
- The `app-store-ready` skill's Payments section has no BLOCKED items.

## Common errors

- **The paywall shows no prices and no buy button, and nothing errors.**
  Offerings came back empty. See "How to check it works".
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
