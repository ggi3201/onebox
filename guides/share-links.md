# Share links and a share extension

Runs on: your Mac (the app and EAS), and your server (the API on the box, or
your hosted backend). The phone tests need a real iPhone.

This guide covers sharing in both directions:

- **Out of the app.** The user shares an item. The friend gets an `https://`
  link with a preview card in iMessage, WhatsApp or Slack. A tap opens the
  app at that item. A friend without the app gets a web page with an App
  Store link.
- **Into the app.** The user taps Share in Safari or another app and picks
  your app. Your app gets the link, and it can read the page.

You need it only when the app has items worth sending to a friend, or reads
content from the web.

## What it costs

| Item | Cost | Notes |
|---|---|---|
| Universal links (`applinks:`) | included | Part of the Apple Developer Program. |
| A domain | about 10 USD a year | You likely have one already ([domain.md](domain.md)). |
| `expo-share-intent` | free | An open-source config plugin. It adds a second iOS target. |

Both parts are native changes. Each needs a new build. Neither can ship in an
EAS Update ([ship-an-update.md](ship-an-update.md)).

## How it fits together

```
app: Share  ──>  https://example.com/item/123
                    │
     friend has the app? ── yes ──>  iOS opens the app at /item/123
                    │
                    no ──>  your server: a page with Open Graph tags and an App Store link

the preview card:  iMessage, WhatsApp, Slack  ──GET /item/123──>  the same page, read for og:* tags
the association:   Apple's CDN  ──GET /.well-known/apple-app-site-association──>  your server
```

A **universal link** is a normal `https://` link that iOS opens in your app
instead of Safari. iOS does this only when two halves match: the app claims
the domain (the entitlement), and the domain names the app (the association
file). If either half is missing, the link opens Safari. Nothing warns you.

## Part 1: links that open the app

### 1. One https link per item

Pick one path pattern for shared items, for example
`https://example.com/item/<id>`. Use the same host the app already talks to,
or your site's host. Use an id that is hard to guess (a UUID), not 1, 2, 3.

Share it with React Native's share sheet:

```ts
import { Share } from "react-native";

export const shareItem = (id: string, name: string) =>
  Share.share({ url: `https://example.com/item/${id}`, message: name });
```

Do not share a custom-scheme link (`myapp://item/123`). Messages and
WhatsApp show it as plain text, it gets no preview card, and it does nothing
for a friend without the app.

### 2. Claim the domain in the app config

```json
{
  "expo": {
    "scheme": "myapp",
    "ios": {
      "bundleIdentifier": "com.example.myapp",
      "associatedDomains": ["applinks:example.com"]
    }
  }
}
```

- No `https://` in the value. Expo's docs call that a common mistake.
- `applinks:example.com` does not cover `www.example.com`. List each host
  you share links on.
- EAS turns on the Associated Domains capability for your App ID on the next
  `eas build`. This is a native change: make a new development build
  ([expo-app.md](expo-app.md), step 5).

### 3. Serve the association file

Your server answers at exactly
`https://example.com/.well-known/apple-app-site-association`:

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": ["ABCDE12345.com.example.myapp"],
        "components": [{ "/": "/item/*" }]
      }
    ]
  }
}
```

`ABCDE12345` is your Team ID ([apple-developer.md](apple-developer.md)). The
app ID is `<Team ID>.<bundle ID>`. The older form, with `appID` and a
`paths` list, still works too.

Apple's rules (checked 2026-10-15 at
https://developer.apple.com/documentation/xcode/supporting-associated-domains
and https://developer.apple.com/documentation/technotes/tn3155-debugging-universal-links):

- The path has no file extension.
- HTTPS with a valid certificate. No redirect: a 301 or 302 fails.
- No login, and no block by user agent. Apple's CDN fetches the file, from
  addresses Apple does not publish. If Cloudflare sits in front
  ([cloudflare.md](cloudflare.md)), make sure bot protection does not
  challenge this path. Test with a made-up user agent:
  `curl -A "MyAgent-Bot/1" https://example.com/.well-known/apple-app-site-association`.
- Serve it as `Content-Type: application/json`. The uncompressed file must be
  under 128 KB.

Each host in `associatedDomains` serves its own copy. A redirect from
`example.com` to `www.example.com` does not count.

On the box ([backend.md](backend.md)), add one anonymous route to the API
that returns this JSON. On a hosted backend ([hosted-backend.md](hosted-backend.md)),
serve it from a function or from your site's host; the file only has to be
on the domain in `associatedDomains`.

The trap: the entitlement can ship in an App Store build for months while
nothing serves this file. Every shared link then opens Safari, and no error
shows anywhere. Check the file before the first release.

### 4. Let Expo Router open the screen

Expo Router routes an incoming universal link by its path. The link
`https://example.com/item/123` opens `src/app/item/[id].tsx` with
`id = "123"`. If the app has no such screen yet, add it. The screen loads
the item from the API as usual, so the server still checks access.

### 5. A public page per item, with a preview card

The same URL must also work in a browser. iMessage, WhatsApp and Slack fetch
it to build the card. A friend without the app opens it in Safari.

Serve plain HTML from the server. The preview fetchers do not run
JavaScript, so the tags must be in the HTML the server sends:

```html
<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lemon cake - My App</title>
<meta property="og:title" content="Lemon cake">
<meta property="og:description" content="A short line about the item.">
<meta property="og:image" content="https://example.com/images/123.jpg">
<meta property="og:url" content="https://example.com/item/123">
<meta property="og:type" content="article">
<meta name="twitter:card" content="summary_large_image">
<meta name="apple-itunes-app" content="app-id=1234567890">
</head><body>
<h1>Lemon cake</h1>
<p>A short line about the item.</p>
<a href="https://apps.apple.com/app/id1234567890">Get My App on the App Store</a>
<a href="myapp://item/123">Open in My App</a>
</body></html>
```

- `og:image` is an absolute `https://` URL that loads without a login.
- HTML-escape every value that comes from a user: the name, the description.
- `apple-itunes-app` shows Safari's banner for the app. `1234567890` is the
  app's Apple ID (`ascAppId` in `eas.json`).
- The "Open in My App" button uses the custom scheme on purpose. Safari never
  opens the app for a universal link on the same domain the user is already
  on, or one typed into the address bar.
- Do not redirect to `myapp://` by script on page load. Without the app,
  Safari shows an error instead of your page.

This page is public. Serve only items the owner chose to share, for example
a `shared` flag the share button sets. A private item, or a missing one,
gets a plain 404 page with no `og:` tags, so a dead link shows no card.

## Part 2: a share extension

A **share extension** puts your app in the iOS share sheet. `expo-share-intent`
adds it as a second iOS target, with an App Group that hands the share to the
app.

Checked 2026-10-15 at https://github.com/achorein/expo-share-intent.

### 1. Install it

Pick the version for your Expo SDK from the table in its README (SDK 55 needs
6.0 or later). From the Expo app folder:

```bash
npx expo install expo-share-intent expo-linking
```

`app.json`:

```json
{
  "expo": {
    "scheme": "myapp",
    "plugins": [
      ["expo-share-intent", {
        "iosActivationRules": {
          "NSExtensionActivationSupportsWebURLWithMaxCount": 1,
          "NSExtensionActivationSupportsWebPageWithMaxCount": 1
        }
      }]
    ]
  }
}
```

- These two rules are the default: a link, and the web page it came from. Add
  `NSExtensionActivationSupportsText`, images or files only if the app uses
  them.
- With `WebPage` on, a share from Safari carries the page's title and its
  `<meta>` tags in `shareIntent.meta`.
- Expo Go cannot run it. Make a new development build. The README says the
  extension works in the Simulator, so you can test the flow there.

### 2. Receive the share with Expo Router

Wrap the root layout in `ShareIntentProvider`, before any other provider.
Then read `useShareIntentContext()` on the screen that handles the share.

The share opens the app with a deep link, and Expo Router tries to route it.
Send it to your share screen in `src/app/+native-intent.ts`:

```ts
import { getShareExtensionKey } from "expo-share-intent";

export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  if (path.includes(`dataUrl=${getShareExtensionKey()}`)) return "/share";
  return path;
}
```

The README has a full Expo Router example in `example/expo-router`.

### 3. Make the config fail when the plugin is missing

If someone removes the plugin entry, or a merge drops its options, the
extension can still build and still share. It just stops carrying what the
app needs, and nothing says so. Make the app config throw instead. In
`app.config.js`, next to `app.json`:

```js
module.exports = ({ config }) => {
  const found = (config.plugins ?? []).some(
    (p) => (Array.isArray(p) ? p[0] : p) === "expo-share-intent",
  );
  if (!found) throw new Error("app.config.js: expo-share-intent is missing from plugins.");
  return config;
};
```

Now every `expo config`, prebuild and build stops with that line.

The same file is a good place to add `preprocessorInjectJS` to the plugin's
options. That script runs inside the shared page in Safari, before the
extension gets it. It can add more values to `shareIntent.meta`, for example
the page's JSON-LD or its main image. Keep the script in its own `.js` file,
so the app and the config read one copy.

### 4. Read the page on the phone, not on the server

Many sites block server fetches. Cloudflare challenges them, and some
publishers answer bots with an error status. The same page loads fine in
WebKit on the user's phone.

So when the app needs the page content:

- From a Safari share: use what `preprocessorInjectJS` put in
  `shareIntent.meta`. The page is already loaded.
- From a link only (another app shared just the URL, or the user pasted it):
  load it in a hidden `react-native-webview`, run the same script with
  `injectedJavaScript`, and send the result back with
  `window.ReactNativeWebView.postMessage(...)`. If the site shows a "verify
  you are human" check, show the WebView so the person can pass it.

Then send the result to your API. The server never fetches the page. Read
only the page the user chose to share.

### 5. Signing the second target

The extension has its own bundle ID (`com.example.myapp.share-extension`)
and an App Group (`group.com.example.myapp`). On the first `eas build`
after you add the plugin, EAS asks to set up credentials for the extension
too. Say yes. The README warns that EAS must see only one extension target:
keep `extra.eas.projectId` in `app.json` and an `eas.json` file, so Expo does
not add its own `appExtensions` entry.

## Privacy

The share page and the association file are public by design. Add a line to
your privacy policy ([privacy-and-support-pages.md](privacy-and-support-pages.md)):

> When you share an item, anyone with the link can see its name, description
> and photo on a web page. You can stop sharing it at any time.

If the app sends a shared web page to your server or an AI service, say that
too ([ai-consent.md](ai-consent.md)).

## Where the values go

| Value | Where |
|---|---|
| The share host | `ios.associatedDomains` as `applinks:example.com` |
| Team ID and bundle ID | `appIDs` in the association file |
| The App Store ID | `submit.production.ios.ascAppId` in `eas.json`; the share page uses it |
| The share extension options | the `expo-share-intent` entry in `app.json` |
| The page script | its own `.js` file, read by `app.config.js` |

## Check it works

- `curl -i https://example.com/.well-known/apple-app-site-association`:
  status `200`, `content-type: application/json`, no redirect.
- `curl https://app-site-association.cdn-apple.com/a/v1/example.com` returns
  the same JSON. That is Apple's cached copy. It can lag behind your file,
  and there is no way to clear it.
- On a Mac: `sudo swcutil dl -d example.com` downloads and checks the file.
- On an iPhone with the new build: paste the link into Notes, then long-press
  it. "Open in My App" is in the menu. A tap opens the item.
- In iOS Settings, **Developer**, turn on **Associated Domains Development**,
  then open **Diagnostics** and type the full URL. It says if the link
  matches your app.
- Paste the link into Messages. A card with the title and image shows.
- Open the link in a private Safari tab: the page shows, with the App Store
  link.
- In Safari, share a page, pick your app. The app opens on the share screen
  with the URL.
- Remove `expo-share-intent` from `plugins` and run `npx expo config`. It
  fails.

Test universal links on a real iPhone. Apple's test steps use a device.

## Common errors

- **The link opens Safari, not the app.** Check in this order: the
  association file (status, content type, redirect, Team ID); the app was
  rebuilt after `associatedDomains` changed; the link was not typed into
  Safari or opened from a page on the same domain.
- **It works on one host, not the other.** `www.example.com` and
  `example.com` each need an entry in `associatedDomains` and their own file.
- **A change to the file does not reach the phone.** Apple's CDN caches it.
  Devices check about once a week. Reinstall the app to fetch it again. For
  fast tests in a development build, add `?mode=developer` to the entitlement
  (`applinks:example.com?mode=developer`), turn on Associated Domains
  Development on the phone, and remove the suffix before release.
- **No preview card.** The `og:` tags are added by JavaScript, `og:image` is
  a relative URL, or the page needs a login. Messages also caches cards: test
  with a new item.
- **The share extension shows, but the app gets only the URL.** `WebPage`
  is not in `iosActivationRules`, or `preprocessorInjectJS` is missing.
- **Two extension targets in `eas credentials`.** An `appExtensions` entry
  was added to `app.json`. Remove it and keep `eas.json`.
- **"Config sync failed" on prebuild.** An `expo-share-intent` older than 6.0
  needs `patch-package` and the README's Xcode patch. Update to the version
  for your SDK.
