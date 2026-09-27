# The loop, and why each part is there

## Control flow

1. **Endpoint checks, cheap to expensive, before any byte is sent:** input
   bounds (400) → access: subscription, budget, consent (402/429/403 with a
   `code`) → a concurrency slot (429) → only then resolve `AgentLoop`.
2. **Headers, then a keep-alive comment.** This commits the 200 at once, so the
   phone sees the stream open even when the model takes seconds to start.
3. **`RunAsync`** sets the run deadline (90 s) and a `finally` that records
   spend. Inside it, `RunCoreAsync`:
   - builds the context ONCE (`ContextFor`), then the two system messages,
     then the history (empty assistant turns dropped, the photo only on the
     newest user turn, text before the photo);
   - offers the tools this run may use (`ToolAccess`);
   - calls the model up to `MaxToolIterations` times. Each call streams text as
     `textDelta` and gathers tool-call fragments by index;
   - no tool calls: `runFinished` with reason `stop` or `length`;
   - tool calls: runs each one (20 s timeout), sends `toolStart`, `toolResult`
     and any `proposal`, adds the results to the conversation, and loops;
   - the last call keeps the tools but sets `tool_choice: none` and adds a
     short user-role note, so the model must answer in text. Reason `toolLimit`.

## Streaming pitfalls

- **Flush every frame.** Kestrel buffers by default. Without the flush, the
  whole stream arrives at the end. That passes any test that checks only the
  final text, and a person watches a blank screen for nine seconds.
- **`X-Accel-Buffering: no`.** Reverse proxies buffer `text/event-stream`
  unless told not to. Traefik and Cloudflare Tunnel pass SSE through; nginx
  in front of anything does not without this header.
- **Serialise events as the base type.** In .NET, `JsonSerializer.Serialize<AgentEvent>(evt)`.
  Passing the derived type drops the `type` field, and the client parses nothing.
- **The usage chunk is last and has no choices.** Read usage before any
  "no choice, skip" check, or you never read it.
- **Ask for usage.** Streamed calls report no usage unless
  `stream_options.include_usage` is set. The official .NET SDK sets it; with
  Node you set it yourself (the template does).
- **Tool calls arrive in fragments.** The id in one chunk, the name in
  another, the arguments a few characters at a time. Key them by `index`.
- **Do not trust `finish_reason` to mean "wants tools".** Providers behind the
  same format disagree: some send `tool_calls`, some send `stop` with tool
  calls attached. The loop runs tools whenever there are tool calls.
- **One id per tool call.** If the provider omits one, make a fallback and use
  it in the assistant message, the tool message AND the events.
- **Keep-alive.** A model thinking for twenty seconds looks like an idle
  connection to a proxy. Send an SSE comment (`: keep-alive`) every 15 s.
- **Keep the run under your proxy's idle limit.** Cloudflare returns 524 after
  about 100 s with no response. The 90 s deadline stays under it.

## Cancellation and deadlines

- The run token is linked to `RequestAborted`. A phone that closes the sheet
  cancels the provider call, so the model stops generating into nothing.
- The deadline is inside `RunAsync`, so background jobs get it too.
- The endpoint tells them apart: if `RequestAborted` fired, nobody is left to
  tell; otherwise it was the deadline, and the client gets `runError timeout`.
- A tool's own timeout is not the run's cancellation. It becomes a refusal the
  model can read ("took too long"), and the run goes on.

## Failures

- A tool failure (unknown tool, bad JSON, exception, timeout) becomes text the
  model can read. Losing the whole answer to one bad query is worse than a
  slightly worse answer.
- A provider error becomes `runError providerError` with a plain sentence.
  The provider's own message goes to the log only.
- An exception after the headers are sent becomes a `runError` frame. Never
  send `e.Message`: database and transport errors carry host names.
- The official OpenAI .NET SDK retries 429 and 5xx responses a few times by
  itself. That is fine inside the deadline. Change it with
  `OpenAIClientOptions.RetryPolicy` if you need to.

## Spend

- `RunSpend` sums usage across every model call in the run. Reporting only the
  last call makes an expensive run look cheap.
- `Cached` is a SUBSET of `Input`. Providers report the prompt total and then
  how much of it was a cache hit. Adding the two bills the cheap part twice.
- The `finally` records the spend on every path, once. If a call was still
  open (no usage chunk), it is estimated from characters, about 4 per token.
- A failure to record must not fail the run. Log it with the user id: it is
  the only warning that this user is now under-counted.

## Photos

- The phone resizes to 1024 px on the long edge before sending. Vision models
  bill by pixel dimensions and downsample anyway.
- Only the newest photo is sent. Earlier ones would be uploaded and billed on
  every later message.
- Only `data:image/...;base64,` is accepted. A URL would be fetched by the
  provider on your key, past your size check.
- In .NET, pass the bytes (`CreateImagePart(BinaryData, mediaType)`), not a
  `data:` `Uri`. `System.Uri` has a length limit of about 65 000 characters.
- If a cheaper vision model reads a kind of photo better (plates of food,
  receipts), make a tool for it and keep the photo away from the main model.
  Let the PERSON choose which kind of photo it is, with two buttons. The model
  cannot decide before it has seen the photo, and by then you have paid.

## Background runs

The same loop runs on a timer (a nightly review, a weekly summary) with a
`BackgroundView`. Three differences:

- **An allow-list of tools** (`ToolAccess.BackgroundJob`). Nobody is watching,
  so no tool that writes without a tap, and no web search.
- **Silence is the default.** See `prompts.md`, "When nobody asked".
- **Record why it said nothing.** "I tried and could not compose a change" is
  not "nothing worth changing". If a write tool was called and no proposal
  came out, log that outcome separately, or a real bug looks like a healthy run.
