---
name: ai-consent
description: Add the consent step Apple requires before an app sends personal data to a third-party AI (App Store guideline 5.1.2(i)) - a one-time prompt that names the provider and what is sent, one shared answer for every AI feature, a versioned record on the server that it enforces, a Settings switch to withdraw, and the matching privacy policy and App Privacy answers. Use when the user adds any AI feature to an iOS app, got an App Review rejection mentioning 5.1.2 or "third-party AI", asks "do I need consent for OpenAI/Claude/Gemini", "what do I tell users about AI", or when the consent prompt does not appear inside a modal sheet.
---

# AI consent (App Review 5.1.2(i))

Runs on: your Mac (code); the check runs in your API.

Apple's rule, in short: say clearly where personal data goes when it is shared
with a third-party AI, and get explicit permission BEFORE it goes. The full
text and what reviewers look for: `references/app-review.md`.

Every AI feature in the app awaits one function, `ensureAiConsent()`. The first
call shows the prompt; the answer is shared by every caller; a yes is stored on
the phone and on the server; the server refuses AI calls without it.

## Before you touch anything

```bash
grep -rnE 'ensureAiConsent|requestConsent|aiConsent|AiConsent' apps --include=*.ts --include=*.tsx --include=*.cs | head
grep -rnE 'ImagePicker|fetch\(|runAgent|/api/ai|/api/agent' apps/mobile --include=*.ts --include=*.tsx | head -20
```

List every place the app sends data to a model: chat, photo reading, import,
voice, "suggest" buttons, and background jobs that run on the user's data.
Each needs the gate. Find out which provider(s) receive the data: the prompt
must name them.

## Steps

1. **App.** Copy `assets/mobile/aiConsent/` to `src/features/aiConsent/`.
   Wire `consentApi` to the app's fetch helper. Put the provider's name and the
   privacy URL in `AiConsentPrompt.tsx`. Edit the text so it is TRUE for this
   app: what is sent, to whom, why.
2. **Mount the prompt** once at the root layout AND inside every Modal that
   hosts an AI feature. It is an overlay because iOS will not show a second
   Modal over one that is up.
3. **Gate every AI call.** `if (!(await ensureAiConsent())) return;` at the
   start of each one, BEFORE anything is added to the screen or sent. When the
   API answers 403 `consentRequired`, call `consentRefused()`: the next AI
   action asks again. The chat feature's `config.ts` has a slot for each.
4. **Server.** Copy `assets/dotnet/AiConsent.cs`. Map `AiConsentRecord` in
   the DbContext, add a migration, `app.MapAiConsent()`, and register
   `AiConsentCheck` as `IAiConsentCheck`. `AiAccess` (from `ai-usage-limits`)
   then refuses AI calls with 403 `consentRequired`. Without that skill, call
   `HasConsentedAsync` at the top of each AI endpoint.
5. **Roll out safely.** Leave `AiConsent:Enforced=false` until the app build
   that records consent is live and older builds are blocked by a minimum
   app version. Then set it to true.
6. **Settings.** Add a "Use AI features" row that shows the state and calls
   `revoke()` to withdraw. Account deletion deletes the row.
7. **Background jobs** on the user's data count too: skip users without
   consent when you schedule them.
8. **Privacy policy and App Privacy.** Add the provider to the policy's list of
   third parties, with what is sent and why. In App Store Connect's App
   Privacy answers, the data types sent (user content, photos, and so on) are
   "collected" if they leave the device. `references/app-review.md` has the
   wording.
9. **Check it.** Fresh install: the first AI action shows the prompt; "Not now"
   sends nothing; "Agree" sends and never asks again; two AI actions started
   at once show ONE prompt. With Enforced=true: the first AI action after
   "Agree" works, a user with no record gets 403 from the API, and the app
   then asks again.

## Rules

- Say only what is true. "Not used to train AI models" is true only if your
  provider contract says so: check the provider's API data policy; on
  OpenRouter, turn on the zero-data-retention setting or route to providers
  that do not train.
- Change the provider or what you send: bump `CONSENT_VERSION` on the phone and
  `AiConsent:Version` on the server, together. Everyone is asked again.
- Never pre-tick, never hide "Not now", never make the whole app depend on the
  yes. Features without AI keep working.

## Finish

End with one line: the next step, as one question. "Next: <step>. Continue?".
"Yes" must be enough. Take the step from the app's plan (`/start:plan`). If
something blocks it, name only that one thing, in plain words, and offer the
fix.
