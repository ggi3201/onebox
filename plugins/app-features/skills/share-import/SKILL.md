---
name: share-import
description: Let people share a web page, a link or text from Safari or any app into your Expo app and turn it into a record - an iOS share extension that captures the page's schema.org JSON-LD and text as the reader saw it (past sites that block scrapers), routing into a pre-filled import screen, a server job that tries the cheapest faithful source first, an SSRF guard for fetching user URLs, and one structured model call that copies instead of inventing. Use when the user wants "import a recipe/product/event from a link", "share to my app", "add a share extension", "import from Instagram or TikTok", when the share sheet shows "page not found" on launch, when a site returns 402/403 to the importer, or when the import made something up.
---

# Share import

Runs on: your Mac (code, iOS build); the import runs as a job in your API.

Needs `app-features:durable-jobs` (the import is a job) and a model client
(`app-features:agent-harness` registers one). The example domain is a recipe;
rename the type and fields for yours (Product, Event, Book, Place, ...).

```
Safari page ─share─> extension runs share-preprocessor.js in the page
                     └─ takes JSON-LD of the wanted type + the article text
app opens /import, FILLED IN, not submitted ─tap─> POST /api/jobs/import
server ladder: shared JSON-LD → shared text (model) → fetch (guarded) → JSON-LD → text (model)
```

## Before you touch anything

```bash
cd apps/mobile && jq '.expo.plugins, .expo.scheme, .expo.ios.bundleIdentifier' app.json
ls app/+native-intent.tsx app/_layout.tsx 2>/dev/null
grep -rn 'expo-share-intent\|ShareIntentProvider' --include=*.tsx --include=*.ts . | head -3
```

Ask the user one question if it is not clear: **what type of thing is being
imported, and which fields must it have?** That sets `WANTED` in the
preprocessor and `Wanted`, `Keep`, `Required`, `Extracted` in the handler.

## Steps

1. **Install** in `apps/mobile`: `npx expo install expo-share-intent`. Add the
   plugin to `app.json` (`references/share-extension.md` has the block). Set
   `WANTED` in `assets/mobile/share-preprocessor.js`, then paste the output of
   `scripts/inline-preprocessor.sh` as `preprocessorInjectJS`.
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
   Never submit on arrival. On tap, `ensureAiConsent()` (if the model may be
   used), then `useJob('import', userId).start({ url, text, ldJson, pageText })`.
5. **Server.** Copy `assets/dotnet/*.cs`. Register the `public` HttpClient with
   `PublicNetworkGuard.CreateHandler`, `ImportHandler` as an `IJobHandler`,
   and your `IImportSink` (creates the record, returns its id). Every other
   HttpClient that fetches a user-supplied URL (images too) uses the same guard.
6. **Check on a DEVICE**, not only the simulator: share a page from Safari with
   JSON-LD (most large recipe and product sites), one without, and a plain
   link from another app. Each opens the import screen filled in, with no
   "page not found" flash, and imports without a model call when the JSON-LD
   is complete (the job log shows no model usage).
7. **Tell the user** which sources work, that social video (Instagram, TikTok)
   needs extra work (`references/extraction.md`), and what happens when a page
   has nothing to import (a sentence, no record).

## Rules

1. Never invent. The model returns `found: false` with a reason, and the job
   fails with that sentence. A prompt that said "if there is none, create one
   from the title" produced fake imports.
2. Cheapest faithful source first. A complete JSON-LD node needs no model.
3. Every fetch of a user URL goes through the guard, including redirects.
4. Open the import screen filled in; the person taps. Shares are one mis-tap
   from the wrong link, and imports cost money.
5. Keep job input small: text and JSON, not a photo. Upload photos first.
6. Pass the job's cancellation token to the fetch and the model call.

## References

- `references/share-extension.md`: the plugin block and the iOS traps.
- `references/extraction.md`: the ladder, JSON-LD shapes, structured output, social video.
