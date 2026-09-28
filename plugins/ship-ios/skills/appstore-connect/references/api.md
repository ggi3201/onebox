# App Store Connect API: details and traps

Base URL: `https://api.appstoreconnect.apple.com`. Every call needs
`Authorization: Bearer <JWT>`. The JWT is ES256, signed with the `.p8` key,
with `kid` = key ID, `iss` = issuer ID, `aud` = `appstoreconnect-v1`, and an
`exp` at most 20 minutes out. `asc.mjs` makes a fresh one per call.

Reference: https://developer.apple.com/documentation/appstoreconnectapi

## Endpoints the skill uses

| Job | Request |
|---|---|
| Find an app by bundle ID | `GET /v1/apps?filter[bundleId]=com.example.myapp` |
| Newest builds | `GET /v1/builds?filter[app]=<appId>&sort=-uploadedDate&limit=10&include=preReleaseVersion,buildBetaDetail` |
| One build | `GET /v1/builds/<id>?include=preReleaseVersion,buildBetaDetail,betaGroups` |
| Expire a build | `PATCH /v1/builds/<id>` with `attributes.expired = true` |
| Export compliance for one build | `PATCH /v1/builds/<id>` with `attributes.usesNonExemptEncryption = false` |
| Beta groups | `GET /v1/apps/<appId>/betaGroups` |
| Testers in a group | `GET /v1/betaGroups/<id>/betaTesters` |
| Add a build to a group | `POST /v1/betaGroups/<id>/relationships/builds` |
| Invite a tester | `POST /v1/betaTesters` with a `betaGroups` relationship |
| Subscription groups | `GET /v1/apps/<appId>/subscriptionGroups` |

On a build, `version` is the **build number** (`CFBundleVersion`). The
marketing version (`1.2.0`) is on the related `preReleaseVersion`.

With curl, percent-encode `[` and `]` (`%5B`, `%5D`) in filter URLs, or curl
reads them as a range and fails with "bad range in URL". `asc.mjs` encodes
them for you.

## Build states

`processingState`: `PROCESSING`, `VALID`, `FAILED`, `INVALID`.

`buildBetaDetail.internalBuildState`: `PROCESSING`, `PROCESSING_EXCEPTION`,
`MISSING_EXPORT_COMPLIANCE`, `READY_FOR_BETA_TESTING`, `IN_BETA_TESTING`,
`EXPIRED`, `IN_EXPORT_COMPLIANCE_REVIEW`.

`externalBuildState` adds the Beta App Review steps: `READY_FOR_BETA_SUBMISSION`,
`WAITING_FOR_BETA_REVIEW`, `IN_BETA_REVIEW`, `BETA_REJECTED`, `BETA_APPROVED`.
Internal testers (members of your team) never need Beta App Review. External
testers do, for the first build of each version.

TestFlight builds expire 90 days after upload.

## Timing

- Processing takes 5 to 30 minutes after the upload finishes.
- `VALID` is the API's answer. The push to testers' phones can lag 5 to 60
  minutes more. Do not tell the user "it is on your phone" from the API alone.
- When the user asks for a status, query the API. Do not tail build logs.

## Upload failures that look like something else

- **"You've already submitted this version"** or a rejected upload long after
  the build: the marketing version (`expo.version`) is already live or in
  review. Bump `version` and build again. A remote build number does not help.
- **Duplicate build number:** two submissions of the same build (for example a
  retried `eas submit`) make Apple reject the second one. The first one is fine.
  Check `builds` before retrying.
- **Missing purpose string (ITMS-90683):** an `NS...UsageDescription` key is
  missing for an API a library links. Add it to `ios.infoPlist` and rebuild.
- **Missing API declaration (ITMS-91053):** the privacy manifest lacks a
  required-reason API. Add it to `ios.privacyManifests` and rebuild.
- **Invalid icon:** the 1024 px icon has transparency, or the icon set is empty.

## Uploading without EAS

Expo projects upload with `eas submit`. Other ways, if the user has no EAS:

- Xcode Organizer (Distribute App), after an archive.
- Apple's **Transporter** app for Mac, with the `.ipa`.
- `xcrun altool --upload-app`. Apple deprecated altool for notarization only
  (TN3147). It still uploads apps to App Store Connect.
- The API's Build uploads resource (`/v1/buildUploads`,
  `/v1/buildUploadFiles`): reserve, upload, commit.
  https://developer.apple.com/documentation/appstoreconnectapi/build-uploads

## Subscriptions: the plan file

```json
{
  "app": "com.example.myapp",
  "group": {
    "referenceName": "Pro",
    "localizations": [{ "locale": "en-US", "name": "Pro" }]
  },
  "subscriptions": [
    {
      "productId": "com.example.myapp.pro.yearly",
      "name": "Pro Yearly",
      "period": "ONE_YEAR",
      "level": 1,
      "localizations": [{ "locale": "en-US", "name": "Pro Yearly", "description": "Every feature, billed once a year" }],
      "price": { "territory": "USA", "customerPrice": "44.99" }
    },
    {
      "productId": "com.example.myapp.pro.monthly",
      "name": "Pro Monthly",
      "period": "ONE_MONTH",
      "level": 2,
      "localizations": [{ "locale": "en-US", "name": "Pro Monthly", "description": "Every feature, billed monthly" }],
      "price": { "territory": "USA", "customerPrice": "6.49" }
    }
  ]
}
```

`period` is one of `ONE_WEEK`, `ONE_MONTH`, `TWO_MONTHS`, `THREE_MONTHS`,
`SIX_MONTHS`, `ONE_YEAR`. `customerPrice` must match one of Apple's price
points exactly; the script lists the nearest ones if it does not.

Product IDs are permanent. You cannot reuse one, even after you delete the
product. Pick a pattern like `<bundleId>.<tier>.<period>` and keep it.

## Subscriptions: three traps

Each of these answers 409 with a message that names the wrong thing.

1. **Availability before price.** A product needs a `subscriptionAvailability`
   before it can be priced. Without it, `POST /v1/subscriptionPrices` fails and
   points at the price point, which looks like a wrong price. The script sets
   availability first, with `availableInNewTerritories: true`, so a new
   storefront does not silently leave the product out.
2. **Level 1 is the highest tier.** In a group, `groupLevel` 1 is the top
   tier. If monthly ends up above yearly, then yearly to monthly counts as an
   upgrade (immediate, with a prorated refund of the year) and monthly to
   yearly as a downgrade (waits for renewal). Both are backwards. Put the
   yearly plan at level 1. The script sets the level and checks it.
3. **Introductory offers are per territory.** "All countries or regions" in the
   web UI is one row per territory in the API (about 175). Leaving out the
   territory is a 409, not a default. Set up a free trial in the web UI unless
   you are ready to script every territory.

After creation, products sit at `MISSING_METADATA` until the review
screenshot of the paywall is attached (web UI). That is expected until the
paywall exists.

Apple keeps about 15% of subscription revenue for members of the App Store
Small Business Program, and 30% otherwise. The `proceeds` field on a price
point shows what you get.

Your first subscription must be submitted for review together with a new app
version. Select it on the version page before you submit.

## Store page text (`listing`, `listing-set`)

The name, subtitle and privacy policy URL live on the **app info**
(`/v1/appInfos/{id}/appInfoLocalizations`). The description, keywords,
promotional text, What's New, support URL and marketing URL live on one **App
Store version** (`/v1/appStoreVersions/{id}/appStoreVersionLocalizations`).
Both can change only while they are not in review or live. The one exception
is promotional text, which can change on a live version at any time.

`listing-set` takes a file with any of these fields, for one locale:

```json
{
  "locale": "en-US",
  "name": "Myapp",
  "subtitle": "Plan meals in one minute",
  "description": "…",
  "keywords": "meal plan,recipes,grocery list",
  "promotionalText": "…",
  "whatsNew": "…",
  "supportUrl": "https://example.com/support",
  "marketingUrl": "https://example.com",
  "privacyPolicyUrl": "https://example.com/privacy"
}
```

It checks the limits before it sends anything: name and subtitle 30
characters, promotional text 170, description and What's New 4000, keywords
100 bytes. A new language must be added in the web UI first. What's New
cannot be set on an app's first version.

