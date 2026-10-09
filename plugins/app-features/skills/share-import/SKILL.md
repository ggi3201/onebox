---
name: share-import
description: Let people share a web page, a link or text from Safari or any app into your Expo app - an iOS share extension that captures the page's schema.org JSON-LD and text as the reader saw it (past sites that block scrapers), and opens a pre-filled import screen, without the "page not found" flash or a lost page. What your app does with it next is yours; the skill gives advice for the server side, not code. Use when the user wants "share to my app", "add a share extension", "import a recipe/product/event from a link", "import from Instagram or TikTok", when the share sheet shows "page not found" on launch, when the shared page is missing on a real phone, or when a site returns 402/403 to the importer.
---

# Share import

Runs on: your Mac (code, iOS build).

The skill ends when the import screen has the link, the page text and the
JSON-LD. What happens next is your app's own feature: parse it on the phone,
or send it to your API. `references/extraction.md` has the server advice.

```
Safari page ─share─> extension runs share-preprocessor.js in the page
                     └─ takes JSON-LD of the wanted type + the article text
app opens /import, FILLED IN, not submitted ─tap─> your import (yours)
```

## Before you touch anything

```bash
cd apps/mobile && jq '.expo.plugins, .expo.scheme, .expo.ios.bundleIdentifier' app.json
ls app/+native-intent.tsx app/_layout.tsx 2>/dev/null
grep -rn 'expo-share-intent\|ShareIntentProvider' --include=*.tsx --include=*.ts . | head -3
```

Ask the user one question if it is not clear: **what type of thing is being
shared?** (Recipe, Product, Event, ...). That sets `WANTED` in the
preprocessor.

## Steps

1. **Install** in `apps/mobile`: `npx expo install expo-share-intent`. Add the
   plugin to `app.json` (`references/share-extension.md` has the block). Set
   `WANTED` in `<skill-dir>/assets/mobile/share-preprocessor.js`, then paste
   the output of `<skill-dir>/scripts/inline-preprocessor.sh` as
   `preprocessorInjectJS`.
2. **Signing.** The plugin adds a second target
   (`<bundle id>.share-extension`) and an app group. Each needs to exist at
   Apple: EAS credentials create them; for local builds register the extension
   App ID and the app group first (`ship-ios:expo-local-build`). Prebuild
   again; `ios/` is generated.
3. **App code.** Copy `sharedPage.ts` and `useShareImport.ts` to the app,
   `+native-intent.tsx` to `app/`. Wrap the root layout in
   `<ShareIntentProvider>` and call `useShareImport(ready)`, where `ready` is
   "signed in and the router is mounted".
4. **Import screen** at `/import`: read `sharedUrl` / `sharedText` from the
   params and `takeSharedPage()` once. Show the link and an Import button.
   Never submit on arrival. What the button does is the app's feature. If it
   sends the page to an AI model, ask for consent first
   (`app-features:ai-consent`).
5. **Check on a DEVICE**, not only the simulator: share a page from Safari with
   JSON-LD (most large recipe and product sites), one without, a plain link
   from another app, and the same link twice. Each opens the import screen
   filled in, with no "page not found" flash, and the Safari pages arrive with
   their JSON-LD or text.
6. **Tell the user** which sources arrive with the page, and that social video
   (Instagram, TikTok) shares only a link and maybe a caption
   (`references/extraction.md`).

## Rules

1. Open the import screen filled in; the person taps. Shares are one mis-tap
   from the wrong link, and an import can cost money.
2. The page the extension captured is the best source: it is what the reader
   saw, past bot walls. Prefer it to fetching the URL again.
3. Hold the page in memory (`sharedPage.ts`), not in router params.

## Finish

End with one line: the next step, as one question. "Next: <step>. Continue?".
"Yes" must be enough. Take the step from the app's plan (`/start:plan`). If
something blocks it, name only that one thing, in plain words, and offer the
fix.

## References

- `references/share-extension.md`: the plugin block and the iOS traps.
- `references/extraction.md`: on the server, getting a record out of the
  page: the order to try sources in, JSON-LD shapes, one structured model
  call, social video.
