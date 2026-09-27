---
name: chat-feature
description: Add an in-app AI chat to an Expo / React Native app - streamed answers over SSE with expo/fetch, a typed event protocol, markdown rendering that survives partial text, tool status chips, proposal cards the person taps to apply, Stop, photo attachments resized on the phone, and clear errors for paywall, budget and consent. Pairs with the agent-harness backend. Use when the user wants a chat screen, an AI assistant or coach inside their app, says "stream the reply into the app", "the answer arrives all at once", "response.body is undefined in React Native", "add image upload to the chat", "render markdown in chat bubbles", or "the chat stops working after a long conversation".
---

# Chat feature (Expo app)

Runs on: your Mac. The app talks to `POST /api/agent/chat` from
`app-features:agent-harness`; set that up first, or point `chatConfig` at an
API that speaks the same protocol.

## What you get

`assets/mobile/chat/`, a self-contained folder:

| File | Job |
|---|---|
| `protocol.ts` | The event union, a parser that drops what it does not know, an SSE decoder that survives any chunking. |
| `stream.ts` | Authenticated streaming POST with `expo/fetch`, one retry on 401, refusals read as `{code, message}`. |
| `store.ts` | Zustand store: `send`, `stop`, `reset`, proposals, one exhaustive `switch` over events, history cap. |
| `config.ts` | The four things the chat needs from your app: base URL, token, refresh, consent. |
| `ChatScreen.tsx` | Messages, tool chips, proposal cards, composer, photo button, Stop. |
| `Markdown.tsx` + `parseMarkdown.ts` | `marked` lexes; your components render. |
| `attach.ts` | Pick, then shrink to 1024 px JPEG before upload. |
| `*.test.ts` | Decoder at every chunk size; markdown at every prefix. |

## Before you touch anything

```bash
cd apps/mobile 2>/dev/null || true
jq -r '.dependencies | {expo, "react-native", zustand, marked, "expo-image-picker", "expo-image-manipulator"}' package.json
ls src/features app 2>/dev/null | head -30
grep -rn "EXPO_PUBLIC_API\|baseURL\|BASE_URL" --include=*.ts --include=*.tsx src app 2>/dev/null | head -5
grep -rln "getAccessToken\|authToken\|Bearer" --include=*.ts --include=*.tsx src app 2>/dev/null | head -5
```

- Expo SDK 52 or newer is needed (`expo/fetch` with a streaming body).
- Find the app's API base URL and its token getter. `config.ts` needs both.
- Find the app's state library. If it is not zustand, keep the store's logic
  and port the container; do not add a second state library for one screen.

## Steps

1. **Copy** `assets/mobile/chat/` to `src/features/chat/` (or the app's
   feature folder). Install what is missing:
   `npx expo install expo-image-picker expo-image-manipulator` and `npm i marked zustand`.
2. **Fill `config.ts`**: base URL, token, refresh. Consent: if
   `app-features:ai-consent` is not set up yet, do it now. Apple rejects AI
   features that send data without a prior yes (guideline 5.1.2(i)).
3. **Match the server.** `ViewContext` in `store.ts` must mirror the server's
   `ViewContext` kinds. `ProposalTarget` in `protocol.ts` must list the targets
   the server's write tools use. Write `applyCommands` for each target with
   the app's own write path, so undo and sync work as for a button.
4. **Mount** `ChatScreen` as a route (`app/chat.tsx`) or in a sheet. Pass the
   screen's `view` and an `onPaywall` that opens the app's paywall.
5. **Permissions.** Add `NSCameraUsageDescription` and
   `NSPhotoLibraryUsageDescription` to the app config, saying what the photo
   is for. They reach the binary only after a prebuild or a new build.
6. **Theme.** Replace the colors in `ChatScreen.tsx` and `Markdown.tsx` with
   the app's tokens.
7. **Test.** Run the two test files (vitest or jest). Then on a simulator:
   send a message and watch words arrive one by one. Tap Stop mid-answer:
   the input comes back at once. Send a photo. Turn on Airplane mode mid-answer:
   you see "The connection dropped".
8. **Tell the user** what was added, what each proposal target does on Apply,
   and what is not persisted (the thread is cleared on reset).

## Pitfalls this template already avoids

1. React Native's own `fetch` has no `response.body`. Import `fetch` from `expo/fetch`.
2. A network chunk is not an event. The decoder buffers until `\n\n`.
3. A UTF-8 character can be split across chunks: `TextDecoder` with `{ stream: true }`.
4. Stop must cancel the reader, or the model keeps generating into nothing.
5. A stream that ends with no `runFinished` is an error, not a finished answer.
6. Unbounded history makes the server refuse after about twenty exchanges.
   `MAX_HISTORY` keeps it under the server's limit.
7. Old photos are not re-sent: only the newest turn carries image data.
8. An unknown event type or proposal target is dropped, so a newer server
   cannot crash an older app still in the store.
9. A refusal before the stream (402, 429, 403) is read as `{code, message}`,
   so the app shows the paywall or the server's sentence, not "HTTP 429".

More, with the reasons: `references/streaming.md` and `references/ux.md`.
