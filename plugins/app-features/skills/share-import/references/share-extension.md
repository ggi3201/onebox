# The share extension

## app.json

```json
[
  "expo-share-intent",
  {
    "iosActivationRules": {
      "NSExtensionActivationSupportsWebURLWithMaxCount": 1,
      "NSExtensionActivationSupportsWebPageWithMaxCount": 1
    },
    "androidIntentFilters": ["text/*"],
    "preprocessorInjectJS": "<output of scripts/inline-preprocessor.sh>"
  }
]
```

- `WebPage` next to `WebURL` makes the share carry the PAGE, not only the
  link. Without it, the preprocessor never runs and `meta` is empty.
- Add `NSExtensionActivationSupportsText: true` to accept plain text on iOS.
  Android's `text/*` already accepts text with or without a link.
- The plugin adds an extension target and an app group. `ios/` is generated,
  so the plugin config is the only place they live. Signing: see the skill.

## Traps, each seen on a real device

1. **Two attachments, random order.** iOS can hand the extension the
   preprocessed page AND a bare URL for one share. The library keeps the first,
   so the page survives on some devices and not others (it worked on the
   simulator). `captureFromRawShare` reads the raw payload and scans every
   entry.
2. **"Page not found" flash.** The extension opens the app with
   `myapp://dataUrl=...`, which matches no route. `app/+native-intent.tsx`
   sends it to `/`; the hook navigates once the share is parsed.
3. **Cold, signed-out start.** The share can arrive before the router or the
   session exists. The provider holds the intent; the hook waits for
   `enabled`, and resets the intent only after handing it on.
4. **Keying the page by URL fails.** The extension sees `document.baseURI`;
   the URL attachment is what Safari handed over. A redirect or canonical
   rewrite makes them differ. Hold one pending page; take it once.
5. **Router params are URLs.** Tens of KB of JSON do not belong there; hold
   the page in a module (`sharedPage.ts`).
6. **Effects run twice** while the router settles. Remember what was routed,
   or a second import screen stacks on the first.
7. **Most apps share text that contains a link** ("Look at this: https://…").
   Use the library's extracted `webUrl`, not the raw text.
8. **The preprocessor is one string in app.json.** A `//` comment after code
   on the same line swallows everything after it once the lines are joined.
   The inline script refuses such lines.
9. **Test every change on a device.** Share from Safari, from another app, and
   with the app killed. The simulator hides trap 1.
