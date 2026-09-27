# Providers

The loop speaks the OpenAI **Chat Completions** format. Many providers offer
it. Set three values:

| Provider | `Llm__BaseUrl` | Example `Llm__Model` | Prompt caching |
|---|---|---|---|
| OpenAI | `https://api.openai.com/v1` | a current GPT model | automatic above ~1024 tokens |
| OpenRouter (many vendors, one key) | `https://openrouter.ai/api/v1` | `anthropic/claude-sonnet-5`, `anthropic/claude-haiku-4.5` | automatic for OpenAI/Gemini models; Claude needs `Llm__CacheControl=true` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai/` | a current Gemini Flash model | automatic (implicit) |
| Anthropic (compatibility layer) | `https://api.anthropic.com/v1/` | `claude-sonnet-5`, `claude-haiku-4-5-20251001` | **none** through this layer |
| Local (Ollama, LM Studio) | `http://localhost:11434/v1` | any local model | n/a |

Checked 2026-09-28 against each provider's docs and OpenRouter's model list.
Model names change often: check the provider's list before you pick.

## Claude

- **For production, use OpenRouter or the native Messages API.** Anthropic
  says its OpenAI-compatible layer is for testing and comparing, not a
  long-term production path. Through it, prompt caching does not work,
  `response_format` is ignored, `strict` on tools is ignored, and every system
  message is merged into one at the top.
- **Through OpenRouter**, set `Llm__CacheControl=true`. The loop then sends
  `cache_control: {type: "ephemeral"}` at the top level, and OpenRouter places
  the cache breakpoint. Without it, Claude calls are not cached. Cache writes
  cost more than plain input on Claude (about 1.25x); reads cost about 0.1x.
- **The native Messages API** gives caching, structured outputs and thinking
  in full. Moving there means rewriting `AgentLoop.cs` only, with the official
  `Anthropic` SDK: system prompt as a list of blocks with `cache_control` on
  the stable block, `tool_use` / `tool_result` content blocks instead of
  `tool_calls` / `tool` messages, and the stream events
  (`content_block_delta` with `text_delta` / `input_json_delta`). The events,
  tools, prompt and client stay as they are.
- Current models: Opus 5.5 (`claude-opus-5-5`), Sonnet 5 (`claude-sonnet-5`),
  Haiku 4.5 (`claude-haiku-4-5-20251001`). A chat agent over the app's own data
  is usually a mid-size model's job. Put the heavy model on the one task that
  needs it.

## Choosing a model

- **Measure on your own cases, several runs each** (`evals.md`). A cheaper
  model can be better at a narrow task: one app found its cheap model read
  photos of food better than the expensive one, at a sixth of the price.
- **Reasoning tokens bill as output.** If the app computes the numbers and the
  model only picks tools and phrases answers, reasoning adds cost and latency
  and little else. Some models cannot combine tools with reasoning on Chat
  Completions at all; `Llm__ReasoningEffort` is empty by default for that
  reason.
- **Latency matters on a phone.** Time to first token is what a person feels.
  Measure it, not only the total.
- **A price table is yours to keep.** `app-features:ai-usage-limits` has a
  script that reads current prices from OpenRouter's public model list.

## SDK notes

- **.NET:** the official `OpenAI` package (2.x). It is async, takes the full
  base URL, and sends `stream_options.include_usage` itself. It retries 429 and
  5xx a few times by default. Extra JSON fields (`cache_control`,
  `reasoning_effort`) go through `ChatCompletionOptions.Patch`, which is marked
  experimental (`SCME0001`).
- **Betalgo.Ranul.OpenAI** also works, with two catches found by probing
  version 9.2.6: it keeps only the HOST of `BaseDomain` and appends
  `ApiVersion`, so put the path there (`BaseDomain = "https://openrouter.ai"`,
  `ApiVersion = "api/v1"`); and its streaming call sends the request with the
  SYNCHRONOUS `HttpClient.Send`, which blocks a thread-pool thread until the
  provider answers.
- **Node:** the official `openai` package, `new OpenAI({ baseURL, apiKey })`.
  Set `stream_options: { include_usage: true }` yourself.
