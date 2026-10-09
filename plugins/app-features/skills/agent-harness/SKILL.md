---
name: agent-harness
description: Add a server-side LLM agent to your API - a streamed tool-calling loop with a stable/volatile prompt split for caching, tools that propose changes instead of making them, per-run limits, spend recorded on every path, opt-in OpenTelemetry tracing (Langfuse) and opt-in evals. Works with any OpenAI-compatible provider (OpenAI, OpenRouter, Gemini, DeepSeek, Ollama, Claude). ASP.NET Core template, Node alternative. Use when the user wants an AI assistant, coach, stylist or agent in their backend, says "add an agent loop", "let the AI call tools", "LLM with function calling", "stream the model's answer over SSE", "trace my LLM calls in Langfuse", "why does my agent say it did something it did not", "my agent loops or runs out of tool calls", or "write evals for my prompt".
---

# Agent harness

Runs on: your Mac (code); the agent runs in your API on your box.

This adds one thing to your backend: `POST /api/agent/chat`, which runs a
model with your tools and streams typed events over SSE. The phone side is
`app-features:chat-feature`. Budgets and paywall gates are
`app-features:ai-usage-limits`. The consent prompt Apple requires is
`app-features:ai-consent`.

The design comes from agents running in App Store apps. Every rule in the
templates has a bug behind it; the references say which.

## What you get

```
POST /api/agent/chat  ──>  checks (400, 402/429, concurrency)  ──>  AgentLoop
                                                                     │
   SSE: runStarted, textStart/Delta/End, toolStart, toolResult,      │  model ⇄ tools
        proposal, runFinished{reason}, runError{code}   <────────────┘  (max 5 rounds,
                                                                         then a closing answer)
```

- **Any OpenAI-compatible provider**, through base URL, key and model in
  config. `references/providers.md` has the table.
- **Tools propose; the person taps.** A write tool returns a proposal card.
  Nothing changes until the app applies it.
- **Spend is recorded in a `finally`**, including when the client hangs up
  before the usage chunk.
- **Tracing is opt-in.** No `OTEL_EXPORTER_OTLP_ENDPOINT`, no exporter.
- **Evals are opt-in.** `APP_EVAL=1`, or they skip. Tests never spend money quietly.

## Config it reads

The skill writes code; the running API reads env vars. For a smoke test the
skill needs a key:

```bash
cfg() { jq -s '.[0] * .[1]' ~/.config/onebox/config.json .onebox.json 2>/dev/null \
  || cat ~/.config/onebox/config.json 2>/dev/null || echo '{}'; }
BASE=$(cfg | jq -r '.llm.baseUrl // "https://api.openai.com/v1"')
MODEL=$(cfg | jq -r '.llm.model // empty'); KEYREF=$(cfg | jq -r '.llm.keyRef // "LLM_API_KEY"')
```

No key yet: send the user to `https://onebox.lokkesveen.com/guides/llm-api-key.md`. Read the key by
reference the way CONFIG.md "Secrets" says (https://github.com/ggi3201/onebox/blob/main/CONFIG.md):
`$KEYREF` from the environment, else `secrets.command` with the reference in
place of `{ref}`, else the nearest `.env`. Put it in a variable, never print it.

## Before you touch anything

```bash
ls apps/api 2>/dev/null; grep -rlE 'WebApplication.CreateBuilder|express\(\)|new Hono|fastify\(' --include=*.cs --include=*.ts apps/api 2>/dev/null | head
grep -rniE 'openai|anthropic|betalgo|chatclient|langfuse|OTEL_' apps/api --include=*.cs --include=*.ts --include=*.csproj --include=package.json | head
```

- An existing model client or agent: adapt it to this shape; do not add a second.
- .NET: use `assets/dotnet/`. Node: use `assets/node/`. Anything else: port
  `AgentLoop.cs`; it is the only file that knows the SDK.
- Ask **one** question if it is not clear: what should the agent be able to
  read, and what should it be able to change? That list becomes the tools.

## Steps

1. **Copy the templates.** .NET: `assets/dotnet/Agent/` into `apps/api/<Project>/Agent/`,
   rename the namespace, `dotnet add package OpenAI` (2.x) and, only if the
   user wants tracing, the two `OpenTelemetry.*` packages from `AgentTracing.cs`.
   Node: `assets/node/*.ts`, `npm i openai`.
2. **Wire it.** `builder.Services.AddAgent(builder.Configuration);` then
   `app.MapAgentChat();`. Check that the user id claim in `AgentChatEndpoint`
   matches the app's auth.
3. **Write the tools** from the user's answer, starting from `Tools/ItemTools.cs`.
   Read `references/tools.md` first. The three rules: a directory before a
   detail read; every read returns the ids the next tool needs; every write
   returns a proposal and says it OFFERED.
4. **Write the prompt** in `SystemPrompt.cs`. Keep `Stable` free of anything
   from a request. Read `references/prompts.md`.
5. **Config.** Add `Llm__BaseUrl`, `Llm__ApiKey`, `Llm__Model` to the app's
   secrets (`box:staging-env` and the backend guide show where the box reads
   them). Never commit the key.
6. **Smoke test** locally with the real key: start the API, then
   ```bash
   curl -sN -X POST localhost:8080/api/agent/chat -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' \
     -d '{"messages":[{"role":"user","content":"what can you do?"}],"view":{"kind":"home"},"clientNow":0,"timezone":"UTC"}'
   ```
   You must see frames arrive one by one, ending in `runFinished`. All at once
   at the end means something buffers: see `references/loop.md`, "Streaming".
7. **Tracing (ask first).** Offer it once: "Do you want traces of each run in
   Langfuse?" Yes: `builder.Services.AddAgentTracing(builder.Configuration)`,
   `https://onebox.lokkesveen.com/guides/langfuse.md` for the keys, and a line in the privacy policy.
   No: skip; nothing is sent anywhere.
8. **Evals.** Copy `assets/dotnet/Tests/AgentEvalTests.cs`. Write one eval per
   behaviour the user cares about, asserting on tool calls. Run one only after
   asking, because it costs money: `APP_EVAL=1 dotnet test --filter Category=Eval`.
9. **Tell the user** what the agent can read, what it can propose, the limits
   (5 tool rounds, 90 s, 3 open runs per user), and that there is no budget
   yet until `ai-usage-limits` is added.

## Rules that are easy to break later

1. Checks before the first byte. After it, the status is 200 for good.
2. Never inject the model client into an endpoint signature.
3. `Stable` prompt first and unchanged; volatile facts in the second message.
4. A span carries ids and shapes, never content.
5. `toolResult` is sent for EVERY tool call, also failures, or a spinner never stops.
6. The model never produces a number the app can compute. Give it the number.
7. Background runs get an allow-list of tools, and silence is their default.

## Finish

End with one line: the next step, as one question. "Next: <step>. Continue?".
"Yes" must be enough. Take the step from the app's plan (`/start:plan`). If
something blocks it, name only that one thing, in plain words, and offer the
fix.

## References

- `references/loop.md`: the control flow, streaming pitfalls, cancellation, spend.
- `references/prompts.md`: prompt structure and the lessons behind it.
- `references/tools.md`: tool design.
- `references/providers.md`: providers, caching, retries, moving to a native API.
- `references/tracing.md`: opt-in tracing and Langfuse.
- `references/evals.md`: evals that can fail.
