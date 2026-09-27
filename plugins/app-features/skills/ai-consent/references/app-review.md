# What App Review looks for

## The guideline

Guideline 5.1.2 (i) (checked 2026-09-28 at
https://developer.apple.com/app-store/review/guidelines/) requires you to
disclose clearly where personal data is shared with third parties, and it names
third-party AI explicitly. You must get explicit permission before the data goes.

In practice a reviewer taps your AI feature and checks:

1. **Before** anything is sent, a prompt appears.
2. The prompt says **what** is sent (text, photos, which app data), **who**
   receives it (the provider by name), and **why**.
3. There is a real choice: agree, or not now. Declining does not break the rest
   of the app.
4. The privacy policy linked from the prompt and from the store page names the
   provider.

A line in the privacy policy alone is not permission. A general "this app uses
AI" banner is not disclosure.

## Prompt text that passes

> **Using AI in MyApp**
> To answer you, MyApp sends what you write, the photos you add, and the parts
> of your MyApp data the answer needs to OpenAI, an AI service. It is used only
> to answer you and is not used to train AI models.
> [Read the privacy policy]
> **Agree** · Not now

Change the nouns to your app and your provider. Remove the training sentence
if you cannot promise it.

## Privacy policy

Add a section:

- **AI features.** Which features, which provider(s), what data each sends,
  that it is sent only after you agree, how to withdraw (Settings → Use AI
  features), and the provider's retention (link its data policy).
- **Tracing**, if you turned it on: the service name, and that it receives ids,
  counts and timings, not your content.

## App Privacy answers (App Store Connect)

Data that leaves the device to a third party counts as collected. For a typical
AI chat with photos:

- **User Content → Other User Content** (messages), **Photos or Videos** (if
  you send photos): used for App Functionality, linked to the user if your
  backend stores it under their account, not used for tracking.
- Anything the tools read from your database and send to the model is the data
  type it is (health, fitness, purchases, and so on). Declare those too.

## Related guidelines

- **1.2 (user-generated content):** if people can publish or share what the AI
  produced with other people, you need a way to report and filter
  objectionable content, block users, and a contact address.
- **Moderation before expensive calls:** a moderation check on input can save
  cost and trouble. Decide what happens when the moderation call itself fails,
  and write it down. Letting everything through on failure is a choice, not
  a default.
- **4.0 / 2.1:** the reviewer must be able to reach the AI feature. If it sits
  behind a subscription, give them a demo account or a sandbox purchase path
  in the review notes.
