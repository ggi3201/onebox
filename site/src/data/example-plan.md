# Plan

Made by `/start:plan` from onebox. Tick items as you go. Add notes anywhere: the next run keeps them.
To change an answer, run `/start:plan` again and say which one.

## Your answers

- Where is your app now? **An Expo app that runs on my phone or the simulator** (you)
- Does the app need a server? **Yes, my own API and database on one cheap box** (you)
- Do users sign in? **Yes, with Sign in with Apple (and maybe others)** (you)
- Will users pay inside the app? **Yes, subscriptions or one-time purchases** (you)
- Do you want a landing page? **Yes, a page for the app on my own domain** (you)
- Does the app use AI? **A chat or an agent that uses the app's data** (you)
- Do you want to fix things from your phone? **Yes, let me (or my coding agent) reach the box from anywhere** (you)

## Install

Only the plugins this plan uses. In Claude Code:

```
/plugin install dev@onebox
/plugin install box@onebox
/plugin install ship-ios@onebox
/plugin install app-features@onebox
```

In Codex: `codex plugin add <plugin>@onebox` for each of them.

Other agents (Cursor, Gemini CLI): `npx skills add ggi3201/onebox` installs every skill.

## Config keys

Skills read these from `~/.config/onebox/config.json`, or `.onebox.json` for this app. Never put a secret value there, only a reference. See https://github.com/ggi3201/onebox/blob/main/CONFIG.md.

- `secrets.tool` — not set
- `apple.teamId` — not set
- `apple.ascKeyId` — not set
- `apple.ascIssuerId` — not set
- `apple.ascKeyRef` or `apple.ascKeyPath` — not set
- `expo.tokenRef` — not set
- `expo.buildMode` — not set
- `revenuecat.apiKeyRef` — not set
- `box.type` — not set
- `box.ssh` — not set
- `box.domain` — not set
- `box.appsDir` — not set
- `box.tunnel` — not set
- `box.tunnelName` — not set
- `box.cloudflareTokenRef` — not set
- `box.runnerLabel` — not set
- `llm.baseUrl` — not set
- `llm.model` — not set
- `llm.keyRef` — not set
- `tracing.otlpEndpoint` — not set
- `tracing.authRef` — not set

## Accounts and tools

- [ ] Join the Apple Developer Program — guide: https://onebox.lokkesveen.com/guides/apple-developer/ (raw: https://onebox.lokkesveen.com/guides/apple-developer.md) <!-- guide:apple-developer -->
- [ ] Install Xcode — guide: https://onebox.lokkesveen.com/guides/xcode/ (raw: https://onebox.lokkesveen.com/guides/xcode.md) <!-- guide:xcode -->
- [ ] Install the command-line tools — guide: https://onebox.lokkesveen.com/guides/tools/ (raw: https://onebox.lokkesveen.com/guides/tools.md) <!-- guide:tools -->
- [ ] Pick one place for your secrets — guide: https://onebox.lokkesveen.com/guides/secrets/ (raw: https://onebox.lokkesveen.com/guides/secrets.md) <!-- guide:secrets -->
- [ ] Register a domain that stays cheap — guide: https://onebox.lokkesveen.com/guides/domain/ (raw: https://onebox.lokkesveen.com/guides/domain.md) <!-- guide:domain -->

## The app

- [x] Make the Expo project fit the setup — guide: https://onebox.lokkesveen.com/guides/expo-app/ (raw: https://onebox.lokkesveen.com/guides/expo-app.md) <!-- guide:expo-app -->
  - detected: Expo app in apps/mobile with a bundle id, a dev client and the three EAS profiles
- [ ] Give your agent a test loop — guide: https://onebox.lokkesveen.com/guides/agent-test-loop/ (raw: https://onebox.lokkesveen.com/guides/agent-test-loop.md) <!-- guide:agent-test-loop -->
- [ ] Agent checks its own work, then proves it in the Simulator — skill: /dev:test-loop <!-- skill:dev/test-loop -->
- [ ] Trim the test suite now and then — skill: /dev:trim-tests <!-- skill:dev/trim-tests -->

## The box

- [ ] Rent a small VPS (or use a mini PC) — guide: https://onebox.lokkesveen.com/guides/vps/ (raw: https://onebox.lokkesveen.com/guides/vps.md) <!-- guide:vps -->
- [ ] Put the domain on Cloudflare, with a tunnel — guide: https://onebox.lokkesveen.com/guides/cloudflare/ (raw: https://onebox.lokkesveen.com/guides/cloudflare.md) <!-- guide:cloudflare -->
- [ ] Bring the box to a safe baseline — skill: /box:box-setup <!-- skill:box/box-setup -->
- [ ] Reach the box from your phone — guide: https://onebox.lokkesveen.com/guides/remote-access/ (raw: https://onebox.lokkesveen.com/guides/remote-access.md) <!-- guide:remote-access -->
- [ ] Get an alert when the box or the API is down — guide: https://onebox.lokkesveen.com/guides/uptime-alerts/ (raw: https://onebox.lokkesveen.com/guides/uptime-alerts.md) <!-- guide:uptime-alerts -->

## The backend

- [ ] API and Postgres on the box, users kept apart, protected — guide: https://onebox.lokkesveen.com/guides/backend/ (raw: https://onebox.lokkesveen.com/guides/backend.md) <!-- guide:backend -->
- [ ] Give the API its public hostname — skill: /box:expose-service <!-- skill:box/expose-service -->
- [ ] A staging API for test builds — skill: /box:staging-env <!-- skill:box/staging-env -->
- [ ] A test build for your phone, pointed at a test backend — skill: /ship-ios:ios-preview-build <!-- skill:ship-ios/ios-preview-build -->

## Features

- [ ] Sign in with Apple, verified on the server — guide: https://onebox.lokkesveen.com/guides/sign-in-with-apple/ (raw: https://onebox.lokkesveen.com/guides/sign-in-with-apple.md) <!-- guide:sign-in-with-apple -->
- [ ] Send push notifications from your API — guide: https://onebox.lokkesveen.com/guides/push-notifications/ (raw: https://onebox.lokkesveen.com/guides/push-notifications.md) <!-- guide:push-notifications -->
- [ ] Get an LLM API key — guide: https://onebox.lokkesveen.com/guides/llm-api-key/ (raw: https://onebox.lokkesveen.com/guides/llm-api-key.md) <!-- guide:llm-api-key -->
- [ ] An agent in your API that calls your tools — skill: /app-features:agent-harness <!-- skill:app-features/agent-harness -->
- [ ] A streamed chat screen — skill: /app-features:chat-feature <!-- skill:app-features/chat-feature -->
- [ ] A cost budget per user — skill: /app-features:ai-usage-limits <!-- skill:app-features/ai-usage-limits -->
- [ ] The AI consent Apple asks for — skill: /app-features:ai-consent <!-- skill:app-features/ai-consent -->
- [ ] Slow AI work as background jobs — skill: /app-features:durable-jobs <!-- skill:app-features/durable-jobs -->
- [ ] Trace and cost every AI call — guide: https://onebox.lokkesveen.com/guides/langfuse/ (raw: https://onebox.lokkesveen.com/guides/langfuse.md) <!-- guide:langfuse -->
- [ ] Ask for a rating at a good moment — guide: https://onebox.lokkesveen.com/guides/ask-for-a-rating/ (raw: https://onebox.lokkesveen.com/guides/ask-for-a-rating.md) <!-- guide:ask-for-a-rating -->

## App Store Connect and builds

- [ ] The manual App Store Connect setup — guide: https://onebox.lokkesveen.com/guides/app-store-connect-setup/ (raw: https://onebox.lokkesveen.com/guides/app-store-connect-setup.md) <!-- guide:app-store-connect-setup -->
- [ ] An App Store Connect API key — guide: https://onebox.lokkesveen.com/guides/app-store-connect-api-key/ (raw: https://onebox.lokkesveen.com/guides/app-store-connect-api-key.md) <!-- guide:app-store-connect-api-key -->
- [ ] Subscriptions with RevenueCat — guide: https://onebox.lokkesveen.com/guides/revenuecat/ (raw: https://onebox.lokkesveen.com/guides/revenuecat.md) <!-- guide:revenuecat -->
- [ ] Expo account, and local vs cloud builds — guide: https://onebox.lokkesveen.com/guides/expo-eas/ (raw: https://onebox.lokkesveen.com/guides/expo-eas.md) <!-- guide:expo-eas -->
- [ ] Build on your Mac and send to TestFlight — skill: /ship-ios:expo-local-build <!-- skill:ship-ios/expo-local-build -->
- [ ] Ship JavaScript fixes without a new build — skill: /ship-ios:eas-update <!-- skill:ship-ios/eas-update -->
- [ ] TestFlight builds, testers and subscriptions — skill: /ship-ios:appstore-connect <!-- skill:ship-ios/appstore-connect -->

## Store page and submit

- [ ] The landing page with privacy, support and terms — skill: /box:new-landing-page <!-- skill:box/new-landing-page -->
- [ ] The app icon — skill: /ship-ios:draw-app-icon <!-- skill:ship-ios/draw-app-icon -->
- [ ] Store screenshots from real screens — skill: /ship-ios:app-store-screenshots <!-- skill:ship-ios/app-store-screenshots -->
- [ ] Store page text that search finds — skill: /ship-ios:store-listing <!-- skill:ship-ios/store-listing -->
- [ ] Check that every feature works, with proof — skill: /start:check-features <!-- skill:start/check-features -->
- [ ] Find what Apple will reject, before Apple does — skill: /ship-ios:app-store-ready <!-- skill:ship-ios/app-store-ready -->
- [ ] See crashes and errors after launch — guide: https://onebox.lokkesveen.com/guides/crash-reports/ (raw: https://onebox.lokkesveen.com/guides/crash-reports.md) <!-- guide:crash-reports -->
- [ ] Optional: see where new users drop off, before your first release — guide: https://onebox.lokkesveen.com/guides/product-analytics/ (raw: https://onebox.lokkesveen.com/guides/product-analytics.md) <!-- guide:product-analytics -->
- [ ] Fill in the version page and submit for App Review — guide: https://onebox.lokkesveen.com/guides/submit-for-review/ (raw: https://onebox.lokkesveen.com/guides/submit-for-review.md) <!-- guide:submit-for-review -->
- [ ] Ship an update: version 1.1 and every release after it — guide: https://onebox.lokkesveen.com/guides/ship-an-update/ (raw: https://onebox.lokkesveen.com/guides/ship-an-update.md) <!-- guide:ship-an-update -->

## Notes

Your own notes. The planner never changes them.
