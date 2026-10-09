---
name: appstore-connect
description: Talk to Apple App Store Connect through its API with an API key, for any iOS app. Lists apps and TestFlight builds, waits for a build to finish processing, answers export compliance, expires old builds, manages beta groups and testers, and creates subscription groups and products. For App Review it shows what the version page still misses, sets the age rating, copyright, categories, review notes and contact, picks the build and the release type, submits the version and releases it after approval. Use when the user asks "is my build on TestFlight yet", "why is my build stuck processing", "Missing Compliance", "expire a build", "add a tester", "invite someone to TestFlight", "create my subscriptions", "set up in-app purchase products", "submit for review", "send it to App Review", "what is missing on the version page", "age rating", "review notes", "is my app in review", "release my app", or mentions App Store Connect, ASC, TestFlight builds, beta groups or processing state.
---

# App Store Connect

Runs anywhere (Node 18+). No Apple ID password. An App Store Connect API key
signs a short-lived token for each call.

The helper is `scripts/asc.mjs`. Its header lists every command.

## Credentials

The script reads the key from the onebox config (see https://github.com/ggi3201/onebox/blob/main/CONFIG.md):

- `apple.ascKeyId` and `apple.ascIssuerId`
- `apple.ascKeyPath` (path to the `.p8` file), or `apple.ascKeyRef` (a secret
  reference to the `.p8` text, read as CONFIG.md "Secrets" says)

It also accepts `ASC_KEY_ID`, `ASC_ISSUER_ID` and `ASC_KEY_PATH` env vars, or
the common `~/.appstoreconnect/config.json` (`key_id`, `issuer_id`, `key_path`).

If nothing is set, ask the user once. If they have no key, send them to
`https://onebox.lokkesveen.com/guides/app-store-connect-api-key.md`. Offer to write the IDs and the path to
`~/.config/onebox/config.json`. Never print the key. Never ask for the Apple ID
password.

## Common jobs

Always start with a read. One GET usually answers the question.

```bash
A=<skill-dir>/scripts/asc.mjs
node $A apps                                   # names, bundle IDs, app IDs
node $A builds --app com.example.myapp         # newest builds and their states
node $A wait <buildId>                         # poll until testers can install it
node $A groups --app com.example.myapp
node $A testers --group <groupId>
node $A listing --app com.example.myapp        # store page text, with length checks
```

Writes change live state. Run each with `--dry-run` first, show the user the
request, then run it for real when they say yes:

```bash
node $A expire <buildId> --dry-run             # hide a build from TestFlight (permanent)
node $A compliance <buildId> --no-encryption   # answer "Missing Compliance" for one build
node $A add-build --group <groupId> --build <buildId>
node $A add-tester --group <groupId> --email tester@example.com
node $A subs-create plan.json --dry-run        # subscription group + products
node $A listing-set listing.json --app com.example.myapp --dry-run   # store page text
```

Writing the store page text well is the `store-listing` skill's job. This
skill only reads and writes it.

## Build states, in short

- `processingState`: `PROCESSING` then `VALID`. It takes 5 to 30 minutes after
  upload. `FAILED` or `INVALID` means Apple emailed the reason.
- Internal state `MISSING_EXPORT_COMPLIANCE`: the build is processed but no
  tester can install it until the export question is answered. Fix it for this
  build with `compliance`. Fix it for every future build by setting
  `ITSAppUsesNonExemptEncryption` in the app config.
- `VALID` does not mean the tester's phone shows the update. The TestFlight
  notification lags the API by 5 to 60 minutes.

Details, more states and the raw endpoints: `references/api.md`.

## Subscriptions

`subs-create` takes a plan file and creates, in this order: the group, its
localizations, each product, its localizations, its availability in all
territories, and a base price. `--equalize` also sets prices in every other
territory from Apple's equalized price points. The plan format and three traps
the API does not explain are in `references/api.md`.

Some steps stay in the web UI: the review screenshot of the paywall,
introductory offers across all territories, and the Paid Apps Agreement. If the
price step fails, set the price in the web UI instead of retrying blindly.

For offerings, entitlements and the paywall itself, use RevenueCat's own plugin
(see `https://onebox.lokkesveen.com/guides/revenuecat.md`).

## Submit for review

The guide is `https://onebox.lokkesveen.com/guides/submit-for-review.md`. It
says what each field on the version page means and what to answer. Go through
it with the user. This skill fills the fields the API allows.

1. Read the page: `node $A review-status --app com.example.myapp`. Each line
   is OK, MISSING or CHECK. CHECK means the API cannot see it.
2. Fill what is missing, one command at a time. Each takes `--dry-run`. Show
   the user the dry run, then run it for real when they say yes.

   ```bash
   node $A age-rating-set age.json --app com.example.myapp --dry-run
   node $A version-set version.json --app com.example.myapp --dry-run   # copyright, categories, content rights,
                                                                        # review contact and notes, release type, phased
   node $A attach-build --app com.example.myapp --build <buildId> --dry-run
   ```

   The file formats are in `references/api.md`. A demo account password goes
   in the user's secrets. The file holds only its reference
   (`demoAccountPasswordRef`). The script never prints it.
3. Run `review-status` again. Then submit, again dry run first:
   `node $A submit --app com.example.myapp --dry-run`.
4. After approval, a manual release waits for the user:
   `node $A release --app com.example.myapp --dry-run`.

The skill does not set these. The user does them on the web, with the guide:
the **App Privacy** answers and the **EU trader status** (the API cannot set
them), the **price** (Free is fine) and the countries, the Paid Apps
agreement, and adding a first subscription to the version. `review-status`
reads the price and the countries. Never guess the App Privacy answers. Read the
app's code and SDKs with the user, and follow the guide.

Write the answers from the app, not from habit. The age rating answers, the
review notes and the content rights must be true for this app. Ask the user
when the code does not show it.

## Rules

- Apps cannot be created through the API (`POST /v1/apps` answers 403). The
  user creates the app record in the web UI. See
  `https://onebox.lokkesveen.com/guides/app-store-connect-setup.md`.
- Uploading a build is not this skill's job. Expo apps upload with
  `eas submit` (see the `expo-local-build` skill).
- When a PR with an iOS change merges, do not start a build or an upload on
  your own. Ask whether they want a TestFlight build now or want to batch more
  changes first.
- `expire` cannot be undone. Deleting screenshots cannot be undone. Confirm.
- `submit` and `release` act at once and are seen by Apple or by users. Run
  each only after the user's clear yes to its dry run. A yes to one command is
  not a yes to the next.

## End with a nudge

After a submit, end with one line: "Sent to App Review. Apple usually answers
within a day or two. Should I check the state tomorrow?". After `release`, or
any other job, say the next step from the user's plan as one question
(`/start:plan` finds it).

## Finish

End with one line: the next step, as one question. "Next: <step>. Continue?".
"Yes" must be enough. Take the step from the app's plan (`/start:plan`). If
something blocks it, name only that one thing, in plain words, and offer the
fix.
