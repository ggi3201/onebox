# Ask for a rating

Runs on: your Mac (the app).

Ratings help people trust the app, and they help it in search. iOS has one
system prompt for this. It shows the stars and an optional review, without
leaving the app. Apple decides when the prompt really shows. This guide
adds it at a good moment, within Apple's rules, plus a "Rate the app" row
for the settings screen.

## What it costs

Nothing. The Expo package is `expo-store-review`. It has native code, so it
needs a new build. Ship it with a release, not as an EAS Update.

## Apple's rules

Checked on 2026-10-01 against Apple's StoreKit documentation
(https://developer.apple.com/documentation/storekit/requesting-app-store-reviews)
and the App Review Guidelines.

- **At most three times a year.** iOS shows the prompt at most three times
  in 365 days to a person who has not rated the app. After a rating, it
  shows again only for a new version, and only when more than 365 days have
  passed.
- **It may show nothing.** Your code cannot know whether it showed. So never
  call it from a button: the tap may do nothing. Never show your own
  message because it did not show.
- **Only the system prompt.** Guideline 5.6.1 says to use Apple's API, and
  Apple does not allow custom review prompts. So do not ask "Do you like the
  app?" first, to send happy users to the prompt and unhappy users to email.
  Expo's documentation also says not to ask questions before the prompt.
- **Never gate anything on it.** No feature, reward or discount for a
  rating.
- **Testing.** In a development build the prompt always shows. In TestFlight
  it never shows.

## Steps

### 1. Install the package

From the Expo app folder:

```bash
npx expo install expo-store-review
```

Then make a new development build ([expo-app.md](expo-app.md), step 5).

### 2. Pick a success moment

Ask right after the user got what they came for: they saved their third
recipe, finished a workout, or shared a result. The moment is yours to
pick. Apple only limits how often the prompt shows.

Do not ask:

- on the first launch, or right after sign-up,
- after an error, a failed purchase or a crash,
- in the middle of a task, or on a paywall,
- from a button tap.

### 3. Ask once the moment comes

Count the successes, and ask after a few of them. AsyncStorage is fine for
this counter: it is not a secret ([expo-app.md](expo-app.md), step 9).

```ts
// src/review/askForReview.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as StoreReview from "expo-store-review";

const KEY = "review.successCount";
const ASK_AT = [3, 10, 30];   // iOS shows it at most 3 times a year anyway

// Call after a success, once the success screen shows.
export async function onSuccess() {
  const n = Number((await AsyncStorage.getItem(KEY)) ?? "0") + 1;
  await AsyncStorage.setItem(KEY, String(n));
  if (!ASK_AT.includes(n)) return;
  if (await StoreReview.isAvailableAsync()) await StoreReview.requestReview();
}
```

Then call it where the success happens:

```ts
await saveRecipe(recipe);
showSaved();
void onSuccess();
```

`isAvailableAsync()` returns `false` in TestFlight. `requestReview()`
returns nothing, whether the prompt showed or not.

### 4. A "Rate the app" row in settings

A row the user taps on purpose is fine. It opens the App Store page, where
the user can write a review:

```ts
import { Linking } from "react-native";

// The app's Apple ID: ascAppId in eas.json. It is not a secret.
const APP_STORE_ID = "1234567890";

export const openWriteReview = () =>
  Linking.openURL(`https://apps.apple.com/app/id${APP_STORE_ID}?action=write-review`);
```

This link is Apple's own. It works only after the app is live in the
store.

## Where the values go

| Value | Where |
|---|---|
| The App Store ID | `submit.production.ios.ascAppId` in `eas.json`; copy it into the code or the app config |
| The success counter | AsyncStorage on the phone |

## Check it works

- In a development build, reach the success moment three times. The prompt
  shows.
- In TestFlight, nothing shows. That is expected.
- In the store build you cannot force the prompt. Check that the code path
  runs, for example with a log line or a crash-report breadcrumb.
- The settings row opens the App Store page of your app, on the review form.

## Common errors

- **Nothing shows in TestFlight.** Expected. Test in a development build.
- **Nothing shows in the store build.** The yearly limit is used up, or the
  user turned off in-app rating requests in the App Store settings on the
  iPhone. Neither is a bug.
- **`Cannot find native module 'ExpoStoreReview'`.** The package was added
  without a new build, or shipped in an EAS Update. Make a new build.
- **A rejection under Guideline 5.6.1.** The app shows its own rating
  prompt, or asks a question first. Use only `requestReview()`.
- **The settings row opens an empty page.** The app is not live yet, or the
  ID is wrong. Use the numeric Apple ID, not the bundle identifier.
