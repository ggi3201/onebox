# Streaming into a React Native app

## The transport

- **SSE over a POST, read with `expo/fetch`.** Not `EventSource` (GET only, no
  auth header, needs a polyfill), not WebSockets or SignalR (a connection
  lifecycle, reconnection, and the token in the query string).
- **`expo/fetch`, imported explicitly.** React Native's built-in `fetch` is
  XHR-based: `response.body` is undefined. A hook built on it passes every unit
  test and does nothing on a phone. Recent SDKs install `expo/fetch` as the
  global; the explicit import works everywhere and survives
  `EXPO_PUBLIC_USE_RN_FETCH=1`.
- **Lazy import** of `expo/fetch`, so unit tests in plain Node never load it.
  Tests pass a `fetchImpl`.
- **One retry on 401**, with the same serialised body. Safe because the body is
  a string. Never relax this to a stream body.
- **Bounded read of a refusal body.** A proxy can answer 402 with a megabyte of
  HTML; read at most 4 KB, then give up on parsing.

## Decoding

- Append each chunk to a buffer; take only complete events (`\n\n`).
- Normalise `\r\n` and `\r` to `\n` first.
- Read only `data:` lines. `:` lines are comments (keep-alives).
- `TextDecoder.decode(value, { stream: true })` so a character split across two
  reads is not replaced with `�`.
- Stop reading at the first terminal event (`runFinished`, `runError`).
- Cancel the reader in a `finally`. That runs when the consumer `break`s, which
  is how Stop works.

## Ending

Four ways a run ends, and each must re-enable the input:

| End | What the app shows |
|---|---|
| `runFinished` `stop` | nothing extra |
| `runFinished` `length` / `toolLimit` | a small note under the answer |
| `runError` | `explainError(code, message)` |
| stream closed with neither | "The connection dropped" (`connectionLost`) |
| refused before the stream | the server's `{code, message}` |

Put the "stop streaming" state change in a `finally`, not in each branch.

## Rendering while streaming

- The store appends deltas to one message by `messageId`. A run can have two
  text messages with a tool call between them; ids keep them apart.
- Tool activity can arrive BEFORE any text (the model reads first). It starts
  the assistant message.
- Markdown is re-parsed on each delta, per message, memoised on the text. That
  is fine for chat-length answers. For very long answers, parse only the last
  block again.
- Scroll to the end after layout (a short timeout), or it scrolls to the
  previous content height.

## Testing

- Decoder: the same byte stream cut at every size from 1 to 17 bytes gives the
  same events. Include non-ASCII and an emoji.
- Markdown: every prefix of a real answer parses without throwing.
- On a device, not only the simulator: streaming through a real network and
  your proxy is the case that buffers. Watch words arrive one by one.
