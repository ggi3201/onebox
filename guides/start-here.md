# Start here: from an idea to the App Store, the cheap way

You built an app idea with Claude Code. It runs on your phone or in the
simulator. Now you want it in the App Store, with a real backend, real
sign-in and maybe a subscription. This page is the map for that.

This is the setup I use for my own apps:

- an **Expo / React Native** iOS app,
- a **backend API and Postgres** in Docker on **one cheap box** (a mini PC at
  home or a small VPS), behind **Traefik** and a **Cloudflare Tunnel**,
- **Sign in with Apple**,
- **RevenueCat** for subscriptions (optional),
- **local iOS builds** on your Mac, then **TestFlight**, then the **App Store**.

It is not the only way. It is a way that works, costs little, and has no
parts you do not need on day one.

## What it costs

| Item | Cost | Notes |
|---|---|---|
| Apple Developer Program | $99 a year | Required to ship on the App Store. See [apple-developer.md](apple-developer.md). |
| The box | about €5 a month, or €0 | A small VPS ([vps.md](vps.md)), or a mini PC you already own. |
| A domain | about €10 a year | Any registrar. The DNS moves to Cloudflare. |
| Cloudflare | free | DNS, the tunnel and the edge certificate are on the free plan. See [cloudflare.md](cloudflare.md). |
| iOS builds | free | Local builds on your Mac with Xcode. Cloud builds on EAS are optional. See [expo-eas.md](expo-eas.md). |
| Expo account | free | Needed for `eas` commands, also for local builds. |
| RevenueCat | free to start | Optional. It charges only after your app earns real money. See [revenuecat.md](revenuecat.md). |

Apple also keeps a share of each sale. Prices on the other guides are checked
when they were written. Treat every number as a ballpark and check the
provider's own page.

## The whole thing in one picture

```
iPhone app  ──https──>  api.example.com  (Cloudflare, proxied DNS)
                              │
                        Cloudflare Tunnel (the box dials out; no open ports)
                              │
                     ┌── your box ─────────────────────────┐
                     │  Traefik :443  ──>  myapp-api        │
                     │                        │             │
                     │                     myapp-db (Postgres)
                     │  nightly backup ──> off-box storage  │
                     └──────────────────────────────────────┘

Your Mac: Xcode, the Expo project, local builds, upload to App Store Connect.
GitHub:   push to main  ──>  runner on the box  ──>  docker compose up
```

## Install the onebox skills

In Claude Code:

```
/plugin marketplace add ggi3201/onebox
/plugin install ship-ios@onebox
/plugin install box@onebox
/plugin install content@onebox
/plugin install budget@onebox
```

`ship-ios` is the app and App Store side. `box` is the server side. `content`
and `budget` are helpers. Install only what you need.

For other agent tools (Codex, Cursor and others):

```bash
npx skills add ggi3201/onebox
```

The skills read one config file, `~/.config/onebox/config.json`, plus an
optional `.onebox.json` in each project. See [CONFIG.md](../CONFIG.md) in the repo root. A
skill asks you for a missing value once and offers to save it.

## The phases

Do them in order. Each phase ends with a "done when" line. Do not start the
next phase before that line is true.

### Phase 0: accounts and tools

1. Join the Apple Developer Program. Approval can take from minutes to a few
   days, so start this first.
   Guide: [apple-developer.md](apple-developer.md).
2. Install Xcode on your Mac and sign in with your Apple account. Guide:
   [xcode.md](xcode.md).

Done when: you can see your Team ID in your Apple Developer account, and
Xcode builds and runs any app on your own iPhone.

### Phase 1: the app

Make the Expo project fit this setup: a fixed bundle identifier, an API URL
per build profile, a development build instead of Expo Go, and three EAS
build profiles.

Guide: [expo-app.md](expo-app.md). Skill: `ship-ios:expo-local-build` (for the first
development build on your phone).

Done when: a development build of your app runs on your iPhone, and the API
URL comes from `eas.json`, not from a file only your laptop has.

### Phase 2: the box

Get one Linux machine and bring it to a known baseline: SSH keys only,
firewall, Docker, Traefik, a Cloudflare Tunnel, nightly backups.

1. Put your domain on Cloudflare and make an API token. Guide: [cloudflare.md](cloudflare.md).
2. Rent a small VPS ([vps.md](vps.md)), or install Ubuntu Server on a mini PC you own.
3. Run the setup. Skill: `box:box-setup`.

Done when: `box:box-setup`'s `check` phase ends with `0 fail`, and the backup
has run once to an off-box target.

### Phase 3: the backend

Put your API and its Postgres in one Docker Compose project on the box. Give
the API a health endpoint and a public hostname. Deploy it on every push to
`main`.

Guide: [backend.md](backend.md). Skills: `box:expose-service` (the hostname),
`box:box-setup` (the GitHub Actions runner, in its `references/runner.md`).

Done when: `curl https://api.example.com/health` returns 200 from your phone
on mobile data, and a push to `main` redeploys the API without you logging
in to the box.

### Phase 4: Sign in with Apple

Turn on the capability, add the button to the app, and verify Apple's token
on your server. Add account deletion now, not later. App Review checks it.

Guide: [sign-in-with-apple.md](sign-in-with-apple.md).

Done when: you can sign in on your phone, the server logs show a verified
Apple `sub`, and deleting the account in the app removes the user and
revokes the Apple token.

### Phase 5: payments (optional)

Skip this phase if the app is free.

1. Sign the Paid Apps agreement and add tax and bank details. Nothing can be
   sold before that. Guide: [app-store-connect-setup.md](app-store-connect-setup.md) (the agreements part).
2. Create the subscription products and connect RevenueCat. Guide:
   [revenuecat.md](revenuecat.md). Skill: `ship-ios:appstore-connect` (it can create the
   subscription group and products).

Done when: a sandbox purchase in a development build unlocks the paid
feature, and your server agrees that the user is paid.

### Phase 6: App Store Connect

Create the app record and an App Store Connect API key. The key lets scripts
and skills upload builds and read their state without your Apple password.

Guides: [app-store-connect-setup.md](app-store-connect-setup.md), [app-store-connect-api-key.md](app-store-connect-api-key.md).
Skill: `ship-ios:appstore-connect`.

Done when: `ship-ios:appstore-connect` lists your app by its bundle ID.

### Phase 7: builds

1. **Preview build on your phone.** A release build that installs directly on
   registered devices, pointed at your real API. Skill:
   `ship-ios:ios-preview-build`.
2. **TestFlight.** A production build, made on your Mac and uploaded to App
   Store Connect. Guide: [expo-eas.md](expo-eas.md). Skills: `ship-ios:expo-local-build`,
   then `ship-ios:appstore-connect` to wait for processing and answer export
   compliance.

Done when: you install the TestFlight build on your phone, sign in, and use
the main feature end to end against the production API.

### Phase 8: the store page

1. **Icon.** Skill: `ship-ios:draw-app-icon`. For a matching set of in-app
   icons: `ship-ios:draw-icon-set`.
2. **Screenshots.** Skill: `ship-ios:app-store-screenshots`. For extra
   artwork: `content:image` (needs [kie-ai.md](kie-ai.md)).
3. **Privacy.** You need a privacy policy at a public URL, and the App
   Privacy answers in App Store Connect must match what the app really
   collects. A simple site for the policy and a support page: skill
   `box:new-landing-page`.
4. **Review notes.** Tell App Review how to reach every feature. If a feature
   needs a subscription, say so. If sign-in needs anything other than Sign in
   with Apple, give a demo account.
5. **Readiness check.** Skill: `ship-ios:app-store-ready`. It looks for the
   usual rejection causes before Apple does.

Done when: `ship-ios:app-store-ready` reports nothing blocking, and every
field on the version page in App Store Connect is filled.

### Phase 9: submit, and what to do on a rejection

Pick the TestFlight build on the version page and submit it for review.

A rejection is normal. It is not the end.

1. Read the full message from App Review. It names a guideline number.
2. Common ones for this kind of app:
   - **2.1** (app completeness): a crash, a dead button, a server that did
     not answer, or missing review notes.
   - **4.8** (login services): you offer Google or another social login
     without an equivalent private option. See [sign-in-with-apple.md](sign-in-with-apple.md).
   - **5.1.1(v)** (account deletion): the app creates accounts but has no
     way to delete one inside the app.
   - **3.1.2** (subscriptions): the paywall does not show what the user
     pays, how often, or links to your terms and privacy policy.
3. Fix it in a new build if code must change. If it was a misunderstanding,
   reply to the message and explain.
4. Run `ship-ios:app-store-ready` again before you resubmit.

Done when: the app is approved and released.

### Phase 10: after launch

- **Change things safely.** Test a backend change on a staging copy before
  it reaches your users. Skills: `box:staging-env` (a second API and database
  on the same box) and `ship-ios:ios-preview-build` (a phone build pointed at
  it).
- **A landing page** for the app, on the same box. Skill:
  `box:new-landing-page`.
- **Research.** Turn a video or a reel into text you can work with. Skill:
  `content:transcribe`.
- **Spend fewer tokens.** Skills: `budget:delegate` (send work to cheaper
  models) and `budget:usage` (see what you have used).

## Checklist

- [ ] Apple Developer Program active, Team ID noted in the onebox config
- [ ] Xcode installed, signed in, runs an app on your iPhone
- [ ] Bundle identifier chosen and written down (it cannot change later)
- [ ] Expo project in `apps/mobile`, EAS project linked
- [ ] `eas.json` has `development`, `preview` and `production` profiles
- [ ] API URL set per profile, always `https://`, never `localhost`
- [ ] Development build runs on your phone
- [ ] Domain on Cloudflare, API token stored with your secrets tool
- [ ] Box set up, `check` ends with `0 fail`
- [ ] Off-box backup set, one test restore done
- [ ] API and Postgres in Docker Compose, no published ports
- [ ] `https://api.example.com/health` answers from mobile data
- [ ] Push to `main` deploys the API
- [ ] Sign in with Apple works, server verifies the token
- [ ] Account deletion in the app, with Apple token revocation
- [ ] (Optional) Paid Apps agreement signed, products created, RevenueCat connected
- [ ] App record in App Store Connect, API key stored
- [ ] Preview build tested on your phone
- [ ] TestFlight build tested end to end
- [ ] Icon, screenshots, privacy policy URL, App Privacy answers, review notes
- [ ] `ship-ios:app-store-ready` passes
- [ ] Submitted
