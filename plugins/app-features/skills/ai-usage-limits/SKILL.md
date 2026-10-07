---
name: ai-usage-limits
description: Put a ceiling on what AI features can cost you - a per-user monthly budget in Postgres counted from real token usage, a model price table filled from OpenRouter's public list, one server-side gate for subscription, budget and consent on every endpoint that reaches a model, per-account rate limits, and forwarded-headers setup so per-IP limits work behind Traefik and a Cloudflare Tunnel. Use when the user asks "how much will the AI cost me", "one user could run up my OpenAI bill", "gate AI behind the subscription", "set a fair-use limit", "what should I charge for the AI features", "rate limit my AI endpoint", or when every request seems to share one rate limit behind a proxy.
---

# AI usage limits

Runs on: your Mac (code); the limits run in your API on your box.

A flat subscription plus an AI feature is an open tab: a per-hour rate limit
still allows thousands of runs a month. This skill adds a monthly budget per
user, counted from the provider's own token numbers, and one gate in front of
every model call.

It plugs into `app-features:agent-harness` through two seams:
`IUsageRecorder` (the loop records every run) and `IAgentAccess` (the endpoint
asks before it streams). Other AI endpoints call the same gate.

## Before you touch anything

```bash
grep -rnE 'IUsageRecorder|IAgentAccess|AddRateLimiter|UseForwardedHeaders|RevenueCat' apps/api --include=*.cs | head
grep -rnE 'ChatClient|IOpenAIService|OpenAIClient|chat.completions' apps/api --include=*.cs --include=*.ts | head
```

The second list is **the family of endpoints that spend money**. Every one of
them must go through the gate. Write it down; step 5 checks it.

**No sign-in?** The gate and the budget count per user. Without accounts
there is no user, and the limits can only count per device and per IP,
which a person can reset. Say so to the user, then follow
`references/no-accounts.md`: a per-install id issued by the server, a per-IP
limit, a lower daily cap, and the app-wide budget as the real backstop.

## Steps

1. **Prices.** Run `scripts/prices.sh <model-id>...` for each model the API
   uses (`--search <word>` to find ids). Paste the block into
   `appsettings.json`. If the API calls a provider directly, rename each key to
   the exact `Llm__Model` string. An unlisted model is charged at the dearest
   listed rate, never at zero.
2. **Budget.** Copy `assets/dotnet/Usage.cs`. Map `UserUsage` in the
   DbContext (`UserUsageModel.Map(b)`), add a migration, and register
   `ModelPricing`, `UsageService` and `IUsageRecorder` AFTER `AddAgent`. Set
   `Usage:MonthlyBudgetUsd` with the user; `references/pricing.md` shows how
   to pick it.
3. **The gate.** Copy `assets/dotnet/AiAccess.cs`. Implement `ISubscriptions`
   from the app's RevenueCat state (webhook table or entitlement check), and
   register `AiAccess` as `IAgentAccess`. `Payments:Enforced=false` ships the
   budget now and the paywall later.
4. **Rate limits.** Copy `assets/dotnet/RateLimits.cs`.
   `AddAiRateLimits`, `app.UseAiForwardedHeaders()` first in the pipeline,
   `app.UseRateLimiter()` after auth, and `.RequireRateLimiting(AiRateLimits.Agent)`
   on the chat. Set `Network__TrustedProxies` to the proxy network's subnet.
5. **Every spender behind the gate.** For each endpoint from the list above
   that is not the chat: call `IAgentAccess.CheckAsync` first and return its
   status and `{code, message}`; record usage with `IUsageRecorder` after the
   call. Then add a test that finds spenders by their DEPENDENCY (any handler
   that uses the model client type), not by a code pattern.
   `references/gates.md` says why.
6. **The app.** Map the codes: 402 `entitlementRequired` opens the paywall;
   429 `budgetExhausted` shows the server's sentence (it names the reset date);
   429 `rateLimited` says "give it a minute". The chat store's `refusalOf`
   and `explainError` do this; reuse them for other AI calls. Gate the entry
   points in the UI too, so a free user does not tap into a refusal.
7. **Check it.** Set `Usage:MonthlyBudgetUsd=0.01` locally, run one chat, and
   see the next one refused with `budgetExhausted`. Check the `UserUsages` row:
   runs, tokens, cost. Then reset the budget.
8. **Tell the user** the budget, what one run costs (from the row), how many
   runs a month the budget allows, and which endpoints are gated.

## Rules

1. Count what the provider billed, from its usage numbers. Estimate from
   characters only for a call that never reported (the harness does this).
2. Money in integer microdollars; one atomic upsert per run.
3. Cached tokens are a subset of input tokens. Never add them on top.
4. The budget check runs before a run, so one run can overshoot. That is fine;
   it bounds the month, not the run.
5. Zero or negative budget means "no ceiling", not "refuse everyone".
6. Refusals happen before the stream opens and carry a `code`.
7. In-memory limits (the rate limiter, the concurrency slot) work for ONE API
   instance. With two, move them to Postgres or Redis.

## References

- `references/pricing.md`: choosing a price and a budget from measured cost.
- `references/gates.md`: where the gates sit, and the tests that keep them there.
- `references/no-accounts.md`: limits for an app without sign-in.
