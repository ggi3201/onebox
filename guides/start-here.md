# Start here: from an idea to the App Store, the cheap way

Runs on: your browser. This page is the map. Each guide says where its own
steps run.

You built an app idea with an AI coding agent, such as Claude Code, Codex or
Cursor. It runs on your phone or in the simulator. Now you want it in the App
Store, with a real backend, real sign-in and maybe a subscription. This page
is the map for that. New words on the way? They are all in
[glossary.md](glossary.md). Stuck on a step? Read
[when-you-are-stuck.md](when-you-are-stuck.md).

The kit is for iOS only. Expo apps can also run on Android, but no guide or
skill here covers the Play Store yet.

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
| The box | about €6 a month, or €0 | A small VPS ([vps.md](vps.md)), or a mini PC you already own. |
| A domain | about €10–15 a year | `.com` or `.app` at cost on Cloudflare Registrar ([domain.md](domain.md)). The DNS moves to Cloudflare. |
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
/plugin install start@onebox
```

Then run `/start:plan` in your app's folder. It checks what your app already
has, asks what you want (a server or not, sign-in, paid or free, a landing
page, AI), and writes `PLAN.md` with only the steps below that your app needs,
plus the exact `/plugin install` lines for the rest. You can answer the same
questions on the home page first.

The plugins: `ship-ios` is the app and App Store side. `box` is the server
side. `dev` is the agent's test loop. `content` makes images and video. `app-features` adds features to your app and API: an AI chat and
agent, cost limits, AI consent, background jobs, import from a shared link.

For other agents (Codex, Cursor, Gemini CLI and others):

```bash
npx skills add ggi3201/onebox
```

Then ask the agent to use the plan skill. I build and test with Claude Code.
The skills are plain `SKILL.md` files, so other agents can use them too.

The skills read one config file, `~/.config/onebox/config.json`, plus an
optional `.onebox.json` in each project. See [CONFIG.md](https://github.com/ggi3201/onebox/blob/main/CONFIG.md) in the repo. A
skill asks you for a missing value once and offers to save it.

## The phases

Do them in order. Each phase ends with a "done when" line. Do not start the
next phase before that line is true.

### Phase 0: accounts and tools

1. Join the Apple Developer Program. Approval can take from minutes to a few
   days, so start this first.
   Guide: [apple-developer.md](apple-developer.md).
2. Install Xcode on your Mac and sign in with your Apple Account. Guide:
   [xcode.md](xcode.md).
3. Pick one place for your secrets, for your app and for your agent, before
   the first API key arrives. Guide: [secrets.md](secrets.md).

Done when: you can see your Team ID in your Apple Developer account, and
Xcode builds and runs any app on your own iPhone.

### Phase 1: the app

Make the Expo project fit this setup: a fixed bundle identifier, an API URL
per build profile, a development build instead of Expo Go, and three EAS
build profiles.

Guide: [expo-app.md](expo-app.md). Skill: `ship-ios:expo-local-build` (for the first
development build on your phone).

Then give your agent a way to check its own work: lint, strict types, tests,
and a look at the change in the Simulator before it says "done". Guide:
[agent-test-loop.md](agent-test-loop.md). Skill: `dev:test-loop`.

Done when: a development build of your app runs on your iPhone, the API URL
comes from `eas.json`, not from a file only your laptop has, and your agent
runs the test loop without you.

### Phase 2: the box

Get one Linux box and bring it to a known baseline: SSH keys only,
firewall, Docker, Traefik, a Cloudflare Tunnel, nightly backups.

1. Register a domain that stays cheap at renewal. Guide: [domain.md](domain.md).
2. Put your domain on Cloudflare and make an API token. Guide: [cloudflare.md](cloudflare.md).
3. Rent a small VPS ([vps.md](vps.md)), or install Ubuntu Server on a mini PC you own.
4. Put the box, your Mac and your phone on one private network, so you (or
   your coding agent) can fix things from anywhere. Guide: [remote-access.md](remote-access.md).
5. Run the setup. Skill: `box:box-setup`.

Done when: `box:box-setup`'s `check` phase ends with `0 fail`, and the backup
has run once to an off-box target.

### Phase 3: the backend

Put your API and its Postgres in one Docker Compose project on the box. Give
the API a health endpoint and a public hostname. Deploy it on every push to
`main`. Scope every user-owned table to its owner in the database layer, not
in each endpoint (the "Keep each user's data apart" section). Add rate limits,
per-user AI quotas and safe URL fetching (the "Protect the API" section).

Guide: [backend.md](backend.md). Skills: `box:expose-service` (the hostname),
`box:box-setup` (the GitHub Actions runner, in its `references/runner.md`).

Hosted instead of the box? Guide: [hosted-backend.md](hosted-backend.md). It
covers Supabase, Convex and Firebase, and skips Phase 2 unless you want a
landing page.

Done when: `curl https://api.example.com/health` returns 200 from your phone
on mobile data, a push to `main` redeploys the API without you logging in to
the box, and the "every owned entity has a query filter" test passes.

### Phase 4: Sign in with Apple

Turn on the capability, add the button to the app, and verify Apple's token
on your server. Add account deletion now, not later. App Review checks it.

Guide: [sign-in-with-apple.md](sign-in-with-apple.md).

Done when: you can sign in on your phone, the server logs show a verified
Apple `sub`, and deleting the account in the app removes the user and
revokes the Apple token.

### Phase 5: payments (optional)

Skip this phase if the app is free.

The products live on the app record, so create the app record first
([app-store-connect-setup.md](app-store-connect-setup.md), step 2).
RevenueCat also needs the Issuer ID of an App Store Connect API key
([app-store-connect-api-key.md](app-store-connect-api-key.md)). Both are Phase 6 steps. If
you sell anything, do those two first.

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
   collects. A site for the policy and a support page: skill
   `box:new-landing-page`. No landing page? Host the two pages for free:
   [privacy-and-support-pages.md](privacy-and-support-pages.md).
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
- **Images and video** for the store page, the landing page and social posts.
  Skills: `content:image`, `content:video`.
- **Keep the box healthy.** About 15 minutes a month, and an agent can do it
  with `box:box-setup`:
  - Security updates install themselves. Reboot when the box says a reboot
    is pending.
  - Once a month, and after any change, run the box check. It must end with
    `0 fail`.
  - Update Traefik, Postgres and your images a few times a year. Read the
    release notes first.
  - Make sure last night's backup ran (`onebox-backup --list`). Restore one
    once, so you know it works.
  - Watch the disk (`df -h`). Docker images and logs grow.
- **See crashes, and know when the box is down.** Guides:
  [crash-reports.md](crash-reports.md) and [uptime-alerts.md](uptime-alerts.md).
- **Push notifications,** when the app needs them. Guide:
  [push-notifications.md](push-notifications.md).
- **Ship JavaScript fixes without a new build.** Skill: `ship-ios:eas-update`.
- **Know when to go further.** One box is one point of failure. If it dies,
  the app is down until you restore it. At home, a power cut or an internet
  outage takes it down too. Move on when downtime costs you money or trust: a
  second server, a managed database with point-in-time recovery, and
  monitoring that wakes you up. For a big app, sensitive data (health,
  children) or a team, plan a larger setup from the start, and get advice.

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
- [ ] Real client IP, rate limits and AI quotas checked ("Protect the API")
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
