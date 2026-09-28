---
name: store-listing
description: Write or improve an iOS app's App Store page text - name, subtitle, keywords, promotional text, description and What's New - from the app's real features, within Apple's limits and search rules, and push it to App Store Connect when asked. Reads the current listing first, checks lengths and keyword waste (spaces, repeats, plurals, words already in the name), and never claims what the app cannot do. Use when the user asks for "App Store description", "keywords", "ASO", "subtitle", "store page text", "what's new text", "release notes for the App Store", "promotional text", "nobody finds my app in search", or before a first submission. Not for screenshots (use app-store-screenshots) or the icon (use draw-app-icon).
---

# Store listing

Runs on: your Mac or anywhere with Node 18+. Reading and writing App Store
Connect needs an App Store Connect API key (see the `appstore-connect` skill).

The store page is where strangers decide. Search finds the app by its name,
subtitle, keywords and category. People then read the first lines of the
description and look at the screenshots. This skill writes the text; the
`appstore-connect` skill's `listing` and `listing-set` commands read and write
it.

## What counts, and the limits

| Field | Limit | Counts for search | Changes without a new version |
|---|---|---|---|
| Name | 30 characters | yes | no |
| Subtitle | 30 characters | yes | no |
| Keywords | 100 bytes | yes | no |
| Promotional text | 170 characters | no | **yes** |
| Description | 4000 characters | no | no |
| What's New | 4000 characters | no | no (not on the first version) |

Checked on 2026-09-28 against https://developer.apple.com/app-store/search/
and https://developer.apple.com/app-store/product-page/.

## 1. Gather the facts

- **The current listing:**
  `node <appstore-connect skill-dir>/scripts/asc.mjs listing --app <bundle id>`.
  It prints each field with its length and notes on wasted keyword bytes. If
  there is no API key, ask the user to paste the current text.
- **What the app really does.** Read the screens and features in the code,
  the landing page copy, and the last release notes (`git log` since the last
  version tag). Every claim in the listing must be true today.
- **Who it is for, and one sentence on why they would pick it.** Ask the user
  if the code and the site do not say.
- **The words people would search for.** Ask the user for five to ten, and
  add your own from the features. Plain words a user types, not marketing
  words.

## 2. Write it

- **Name:** the brand, plus a plain word or two if room is left, so a stranger
  knows what it is. Do not stuff keywords into it; Apple rejects that
  (Guideline 2.3.7).
- **Subtitle:** what it does for the user, in their words. Not "the best app".
- **Keywords:** comma separated, **no spaces after the commas**. Do not repeat
  any word from the name, the subtitle or the category. Do not add a plural of
  a word already there. No competitor or other app names, no "app", no filler
  words. Single words combine with the name and subtitle in search, so
  `meal,plan` covers "meal plan" and saves bytes. Fill close to 100 bytes.
- **Description:** the first sentence is the only one most people read
  before "more". Say what the app does and for whom. Then a short paragraph,
  then a short list of the main features, then required lines such as the
  terms of use link for subscriptions. Plain words. No keyword lists.
- **Promotional text:** news that changes: a new feature, a season, a sale.
  It sits above the description, can change at any time, and does not affect
  search.
- **What's New:** what changed for the user in this version, most useful
  first. Not internal work.

Show the user a draft with the length of each field, and say which keyword
words you dropped and why.

## 3. Check it

Run it through `listing-set` with `--dry-run`. It refuses anything over a
limit and prints the exact request:

```bash
A=<appstore-connect skill-dir>/scripts/asc.mjs
node $A listing-set listing.json --app com.example.myapp --dry-run
```

The file format is in the `appstore-connect` skill's `references/api.md`.
Then read it once more against the app: every feature named is in the build
that ships with this text.

## 4. Push it (only when asked)

```bash
node $A listing-set listing.json --app com.example.myapp
node $A listing --app com.example.myapp   # read it back
```

- The name, subtitle and privacy URL change only while a version is being
  prepared. The same goes for the rest, except promotional text.
- A new language must be added in App Store Connect first.
- Writing is an outward action: it is what users see once the version is live.
  Push only after the user says yes, and show the dry run first.

## Rules

- Never claim what the app does not do, or a result it cannot promise.
  App Review checks the text against the app (Guideline 2.3).
- Never name a competitor, in any field.
- Keep the old text. Save the `listing` output to a file before you replace
  anything, so the user can go back.
- One language at a time. Translate only when the user asks, and say that a
  native speaker should read it.
