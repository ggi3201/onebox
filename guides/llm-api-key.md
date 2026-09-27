# An LLM API key

Used by: `app-features:agent-harness`, `app-features:share-import`, and every
AI feature in your API (`plugins/app-features`).

## What it is and what it costs

Your API calls a model provider with a secret key. The provider bills you per
token: text in (input), text out (output), and a cheaper rate for input it has
seen before (cached input). Photos count as input by size.

The onebox templates speak the OpenAI **Chat Completions** format, which many
providers offer. Pick one:

| Provider | Good for | Base URL |
|---|---|---|
| **OpenRouter** | one key for many vendors (Claude, GPT, Gemini, open models); easy to compare | `https://openrouter.ai/api/v1` |
| **OpenAI** | GPT models directly | `https://api.openai.com/v1` |
| **Google Gemini** | cheap, fast Flash models | `https://generativelanguage.googleapis.com/v1beta/openai/` |
| **Anthropic** | Claude directly. Its OpenAI-compatible layer is for testing; for production use OpenRouter or the native API (see the harness's `providers.md`) | `https://api.anthropic.com/v1/` |

Prices change often and differ by model by 10x or more. Checked on
2026-09-28, examples per million tokens (input / output): Claude Sonnet 5
$2 / $10, Claude Haiku 4.5 $1 / $5, on OpenRouter's public list. **Treat these
as a ballpark** and check the provider's pricing page.
`app-features:ai-usage-limits` has a script that prints current prices.

All of them bill a card or prepaid credit. Set a monthly spending limit in
the provider's billing settings before you ship; it is your last line of
defence if your own budget code has a bug.

## Steps

1. Create an account with the provider you picked.
2. Add a payment method or prepaid credit.
3. Set a monthly usage limit on the billing or limits page.
4. Create an API key on the API keys page. Name it after the app and the
   environment (`myapp-prod`). Make a second key for development.
5. Copy the key once. Do not paste it into a prompt, a commit, a chat or an
   issue.
6. **Data policy.** Check the provider's API data policy: retention, and
   whether API data is used for training. On OpenRouter, the privacy settings
   let you allow only providers that do not train on your data, and turn on
   zero data retention. Your consent text (`app-features:ai-consent`) must match
   what you choose here.

## Where the value goes

Two places.

**The running API** reads environment variables (the backend guide shows how
the box gets them from your secrets tool):

```
Llm__BaseUrl=https://openrouter.ai/api/v1
Llm__ApiKey=<the key>
Llm__Model=anthropic/claude-sonnet-5
```

For a Node API: `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`.

**The onebox skills** (smoke tests, evals) read the key by reference, like every
secret (see `CONFIG.md`):

```jsonc
{
  "secrets": { "tool": "env" },
  "llm": {
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "anthropic/claude-sonnet-5",
    "keyRef": "LLM_API_KEY"
  }
}
```

With `env`, put `LLM_API_KEY` in your shell or a `.env` file that git ignores.
With `doppler` or `1password`, `keyRef` is the secret name or the `op://`
reference.

## Check it works

```bash
curl -sS "$BASE/chat/completions" -H "Authorization: Bearer $LLM_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"'"$MODEL"'","messages":[{"role":"user","content":"Say ok"}],"max_completion_tokens":5}' \
  | jq '.choices[0].message.content, .usage'
```

You see `"ok"` (or similar) and a `usage` object with token counts.

## Common errors

- **401**: wrong key, or a key for a different provider than the base URL.
- **404 model not found**: the model name is the provider's own. OpenRouter
  names have a vendor prefix (`anthropic/…`); direct APIs do not.
- **400 on `max_completion_tokens`**: an older or local server wants
  `max_tokens`.
- **429**: rate limit or no credit left. Check the billing page.
- **It works locally and not on the box**: the variable is set but empty in
  the container. See `box:staging-env`, gotcha 4.
