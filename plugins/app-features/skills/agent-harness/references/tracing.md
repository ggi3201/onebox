# Tracing (opt-in)

Tracing answers "why did it do that?" about a run that happened yesterday:
which tools ran, in what order, how long each took, what the run cost.

It is **off unless the user turns it on.** `AddAgentTracing` registers an
exporter only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set. Without it, the span
calls do nothing and nothing leaves the server. Ask once; do not assume.

## Turning it on

1. The user picks where traces go. Langfuse is the default here: a free cloud
   tier, or self-hosted on the box. See `https://onebox.lokkesveen.com/guides/langfuse.md`.
2. Add the packages: `OpenTelemetry.Extensions.Hosting` and
   `OpenTelemetry.Exporter.OpenTelemetryProtocol`.
3. `builder.Services.AddAgentTracing(builder.Configuration);`
4. Set, in the app's secrets:
   ```
   OTEL_EXPORTER_OTLP_ENDPOINT=https://cloud.langfuse.com/api/public/otel
   OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <base64 of pk-lf-...:sk-lf-...>
   OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
   OTEL_SERVICE_NAME=myapp-api
   ```
   Langfuse speaks OTLP over HTTP only, not gRPC. Do not quote the header
   value in a `.env` file: the quotes become part of the value and every
   export fails.
5. Run one chat and open the trace. You should see `chat <model>` with
   `execute_tool <name>` children, token counts and a cost.
6. Add a line to the privacy policy: which service receives traces, and that
   they hold ids and counts, not content.

## The rule

**A span may carry ids and shapes. It may never carry contents.**

- Allowed: user id, run id, model, tool names, durations, token counts,
  argument LENGTH, proposal target and command COUNT, error type.
- Not allowed: prompts, messages, tool arguments, tool results, memory text.
- `AgentTelemetry` has no method that takes free text from a request. Keep it
  that way. Keep a test that runs a real sentence through a run and searches
  every tag for it.
- The cost of the rule: a trace cannot show you the prompt. So render prompt
  blocks in a test and read them there (`prompts.md`).

## Names

- Span names follow the GenAI conventions: `chat {model}` for a run,
  `execute_tool {name}` for a tool.
- Langfuse prices a span as a GENERATION when `gen_ai.operation.name` is
  `chat` and a model is set. A job span that wraps a run must NOT set it, or
  the cost shows twice.
- Cached input: `gen_ai.usage.input_cached_tokens`. Found by probing a running
  Langfuse; other plausible names (`gen_ai.usage.cached_tokens`,
  `cache_read_input_tokens`) are stored and ignored, so the span looks right
  and the cost does not change. Check it again after a Langfuse upgrade.
- Write the cached count also when it is zero.

## Two traps

- **Langfuse prices from its own table.** When a provider changes prices or a
  new model appears, Langfuse can carry the old rate. One app found every run
  over-reported five times. Compare one trace's cost with the provider's price
  page after you add a model.
- **Tests produce no traces.** The test host has no `OTEL_*` variables, so evals
  do not show up in Langfuse. That is fine; do not "fix" it by exporting from CI.
