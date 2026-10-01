---
name: app-store-ready
description: Audit an Expo / React Native iOS app for everything that blocks a TestFlight upload or App Store approval, and report each item as OK, needs fixing, or blocked, with the fix. Covers app config (bundle ID, versions, icon, permission strings), privacy manifest, export compliance, tracking, account deletion, Sign in with Apple, in-app purchases and the paywall, backend URLs, secrets and tokens in the app bundle, App Transport Security, placeholder content, eas.json, and the App Store Connect metadata a reviewer checks. Use when the user asks "is my app ready for the App Store", "will Apple reject this", "what do I need before TestFlight", "App Review checklist", "why was my app rejected", "Guideline 5.1.1", "Missing Compliance", "ITMS-91053", or before a first submission.
---

# App Store ready?

Runs on: your Mac (for the Xcode check). The rest runs anywhere with Node 18+.

This skill reads the project and reports. It changes nothing until the user
asks for a fix.

## 1. Run the static check

From the Expo app folder (the one with `app.json` or `app.config.*`):

```bash
node <skill-dir>/scripts/check.mjs .            # text report, exit 1 if anything is BLOCKED
node <skill-dir>/scripts/check.mjs . --json     # for further processing
node <skill-dir>/scripts/check.mjs . --offline  # never fetch a page
```

When the app has account deletion, the script also checks that the privacy
policy and the support page say how to delete the account. It reads each page
from a site folder in the repo (`site/`, `web/`, `landing/`, or a Next.js or
Astro project). With no site folder, it fetches the live URL with one GET and
a short timeout. It finds the URL in the app config's `extra`, in
`app.privacyUrl` and `app.supportUrl` of the onebox config, in `listing.json`,
or in a link in the app code. A page it cannot load is CHECK, not FIX.

It resolves the full config with the project's own `expo config --type
introspect`, so it sees permission strings that plugins add. Without Expo
installed it falls back to `app.json` and says so. Install dependencies first
for a complete answer.

Statuses:

- **BLOCKED**: the upload, TestFlight or review will fail.
- **FIX**: likely rejection or a broken experience. Fix before submitting.
- **CHECK**: the repo cannot show it. Check it by hand or in App Store Connect.
- **OK**.

The script uses heuristics (it greps the source). Read each finding before you
repeat it. A comment, a test fixture or a dev-only branch can trigger a false
alarm. Say so when you dismiss one.

## 2. Check what the script cannot see

Go through `references/checklist.md`. For each item the script marked CHECK,
and for each section the app touches (accounts, payments, AI, health, kids,
user-generated content), read the section and look at the code or ask the
user.

If an App Store Connect API key is set up, use the `appstore-connect` skill to
read real state: the app record exists, a build is processed, beta groups,
subscription products. Do not guess at App Store Connect state.

If the user got a rejection, ask for the exact text from App Review (the
guideline number and the message). Match it to the checklist. Do not guess
from memory which guideline it was.

## 3. Report

One list, worst first. For each item:

```
BLOCKED  Account deletion (5.1.1(v))
         The app creates accounts, but there is no way to delete one in the app.
         Fix: add "Delete account" to Settings. It must delete the server data,
         revoke Sign in with Apple, and warn paying users that the subscription
         continues until they cancel it.
```

Group items under: Build and upload, Privacy, Accounts, Payments, Content,
Security, App Store Connect. Keep each fix to what the user does next. Cite the
guideline number when there is one.

When the user asks what else can help, name the skills from the rest of this
plugin, only the ones that apply:

- Fix the icon: `draw-app-icon`.
- Store screenshots: `app-store-screenshots`.
- Test on a phone without TestFlight: `ios-preview-build`.
- Build and upload: `expo-local-build`.
- Builds, testers, subscriptions in App Store Connect: `appstore-connect`.
- Accounts and keys: the guides at https://onebox.lokkesveen.com/guides/ (start with
  https://onebox.lokkesveen.com/guides/apple-developer.md).

## 4. Hand off: one nudge

End with one line, after the report:

- **Nothing BLOCKED or FIX:** "Next: Submit for review. Continue?". On yes,
  go through https://onebox.lokkesveen.com/guides/submit-for-review.md with
  the user. The `appstore-connect` skill fills what the API allows.
- **Something BLOCKED or FIX:** name only the worst one, in plain words, and
  offer to fix it: "One thing first: the app has no way to delete an
  account. Should I add it?".

## Rules

- Report first. Fix only what the user asks you to fix.
- Never invent a guideline number. If unsure, link the guidelines page:
  https://developer.apple.com/app-store/review/guidelines/
- Apple's upload requirements change each year. The dated ones in this skill
  were checked on 2026-09-28. If a date is more than a few months old, check
  https://developer.apple.com/news/upcoming-requirements/ again.
