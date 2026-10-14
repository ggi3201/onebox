# AI consent

Runs on: your Mac (the app) and your server (the check).

App Review guideline **5.1.2(i)** (checked 2026-09-28 at
https://developer.apple.com/app-store/review/guidelines/): when the app shares
personal data with a third-party AI, it must say so clearly and get the user's
explicit permission before the data goes. You need this step only if the app
sends what the user writes, their photos or their app data to an AI provider
([llm-api-key.md](llm-api-key.md)). It costs nothing.

## What App Review checks

A reviewer taps your AI feature and looks for this:

1. **Before** anything is sent, a prompt appears.
2. The prompt says **what** is sent (text, photos, which app data), **who**
   gets it (the provider, by name) and **why**.
3. There is a real choice: agree, or not now. Saying no does not break the
   rest of the app.
4. The privacy policy, linked from the prompt and from the store page, names
   the provider.

A line in the privacy policy alone is not permission. A general "this app uses
AI" banner is not disclosure.

## Steps

1. **The prompt.** One screen, shown the first time the user starts any AI
   feature. Text that passes, with your own nouns and provider:

   > **Using AI in MyApp**
   > To answer you, MyApp sends what you write, the photos you add, and the
   > parts of your MyApp data the answer needs to OpenAI, an AI service. It is
   > used only to answer you and is not used to train AI models.
   > [Read the privacy policy]
   > **Agree** · Not now

   Remove the training sentence unless your provider's data policy promises
   it ([llm-api-key.md](llm-api-key.md), step 6). Never pre-tick, never hide
   "Not now".
2. **One gate before every AI call.** Every AI feature awaits the same
   function before it sends anything: chat, photo reading, import, "suggest"
   buttons. Two features started at once show one prompt.
3. **Store the answer per user, on the server.** The server refuses an AI call
   from a user with no yes on record. Keep a copy on the phone only as a
   cache, and clear it on sign-out: otherwise the next person who signs in on
   that phone skips the prompt. Account deletion deletes the record.
4. **A way to say no later.** A "Use AI features" switch in Settings that
   withdraws consent. Background jobs that run on the user's data check the
   same record.
5. **Privacy policy and App Privacy.** Add the provider to the policy's list
   of third parties, with what is sent and why
   ([privacy-and-support-pages.md](privacy-and-support-pages.md)). In App
   Store Connect, data that leaves the phone counts as collected: messages are
   User Content, photos are Photos or Videos, and anything your server sends
   to the model from its database is the data type it is
   ([submit-for-review.md](submit-for-review.md)).

Change the provider, or what you send: ask everyone again. Keep a version
number with the stored answer and raise it.

## Check it works

On a fresh install: the first AI action shows the prompt, "Not now" sends
nothing, "Agree" sends and never asks again. Sign out and sign in as another
user: the prompt shows again. Call the AI endpoint with a user that has no
record: the server refuses it.

## Common errors

- **Rejected under 5.1.2(i)**: the prompt came after the first request, did
  not name the provider, or the privacy policy does not list it.
- **The prompt does not appear inside a sheet**: iOS will not show a second
  modal over one that is up. Show the prompt as an overlay inside that sheet.
- **The reviewer cannot reach the feature**: it sits behind a subscription.
  Give them a demo account or a sandbox purchase in the review notes.
