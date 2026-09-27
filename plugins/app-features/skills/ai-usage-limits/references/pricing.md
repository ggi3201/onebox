# Pricing and the budget

## Measure first

Cost per run depends on your prompt, your tools and how people use them. Do
not guess it from a price page.

1. Run the feature for real (TestFlight testers, yourself for a week).
2. Read the `UserUsages` rows, or Langfuse if tracing is on:
   ```sql
   select "Month", count(*) users, sum("Runs") runs,
          round(sum("CostMicros") / 1e6, 2) usd,
          round(avg("CostMicros"::numeric / nullif("Runs", 0)) / 1e6, 4) usd_per_run,
          round(100.0 * sum("CachedInputTokens") / nullif(sum("InputTokens"), 0), 1) cached_pct
   from "UserUsages" group by 1 order by 1 desc;
   ```
3. Note three numbers: cost per run (average and worst), runs per heavy user
   per month, and the cached share of input.

A low cached share means the prompt split is not working (see the harness
`prompts.md`) or the provider needs `cache_control`.

## Set the budget against the price

Worked example with made-up numbers:

| | |
|---|---|
| Yearly plan, per month | $30 / 12 = $2.50 |
| After Apple's cut (15% small business) | about $2.10 |
| Heaviest real user | $1.60 a month |
| Worst single run | $0.10 |

- A budget of **$2** sits just above the heaviest real user: nobody honest sees
  it, and one runaway account cannot cost much more than it pays.
- A budget far above what the cheapest plan earns means one account can lose
  you money every month. A budget below the heaviest real use refuses paying
  users.
- Revisit it when you change models or prompts. Both move the cost per run.

## Free tiers

- A free tier on an AI feature needs a smaller budget, or a count of runs
  instead of dollars (for example 5 chats a week). Keep the same gate; only the
  limit differs.
- If a job consumes a free allowance and then fails, give the allowance back,
  exactly once (see `app-features:durable-jobs`).

## Where cost hides

- **Input, not output.** A chat agent often reads 100 tokens for every 1 it
  writes. Caching the stable prefix is the biggest lever.
- **The re-emit.** A step that sends a whole document to the model to get the
  same document back with one change pays for both directions. Send only what
  must change, or do the change in code.
- **Reasoning tokens** bill as output.
- **Images** bill by pixel size. Shrink on the phone.
- **Retries** of a failed call bill again.
- **Unpriced models** in the trace store: if Langfuse shows a cost far off the
  provider's page, its price table is stale.
