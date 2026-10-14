# AI cost limits on a hosted backend

Runs on: your Mac (the code, deployed with the vendor's CLI) and your browser
(the vendor's dashboard, to change a limit). The limits run in your Supabase
project.

An AI feature costs you money on every call. A flat subscription plus an AI
feature is an open tab: one script in a loop, one bug in the app's retry
code, or one keen user can turn into a large bill. This guide puts a ceiling
on that bill when your backend is hosted. It is the hosted version of
[backend.md](backend.md), "Protect the API", parts 2 and 3. Set up the
backend first with [hosted-backend.md](hosted-backend.md).

The code here is for Supabase, the simple default in
[hosted-backend.md](hosted-backend.md). On Convex or Firebase, build the same
design ("The design", below) with that platform's tools: a Convex mutation
is one transaction, and on Firebase a Firestore transaction in the Cloud
Function does the same.

Facts were checked on **2026-10-07**, in Supabase's own docs. The code was
checked the same day: the SQL in Postgres 17, the Edge Function with
`deno check`.

## What it is and what it costs

It costs nothing extra: two small tables and about 60 lines
of server code. It adds one database write before each model call and one
after it.

Four measures. The first three are the same as on the box:

1. **A per-user daily count.** Check and count in one atomic step, before the
   model call. Two calls at the same time cannot both slip under the limit.
2. **A cap on each request.** A maximum input size, a maximum number of
   output tokens, and a deadline for the model call.
3. **A budget for the whole app.** Record what each call really cost. When
   today's total passes your budget, AI answers "unavailable, try later" for
   everyone, and the rest of the app keeps working. Also set a spend limit at
   your AI provider. It still works when your own code fails.
4. **A short-window rate limit, and a bot check**, where the platform makes
   them cheap.

What Supabase gives you:

| | **Supabase** |
|---|---|
| The atomic daily count | A table and a Postgres function, called with the user's JWT |
| Short-window rate limit | Not built in for Edge Functions. Auth endpoints only |
| Bot check | CAPTCHA on sign-up and sign-in |
| Function time limit | 150 s (Free), 400 s (paid) wall clock |
| Platform spend cap | Spend Cap: Supabase usage only |

**No platform cap covers your AI provider's bill.** The model call goes to
OpenRouter, OpenAI or another provider, and that provider bills you. Only
your own code (this guide) and the provider's own spend limit stop that bill.

## The design

**The limits live in the database**, in one row. You change them
in the dashboard, with no deploy. Start with 30 calls per user a day and an
app budget you could pay on a bad day, for example $5. A budget of 0 or less
means no ceiling. It does not turn AI off.

**The cost comes from the provider's usage numbers.** Every Chat Completions
answer has `usage.prompt_tokens` and `usage.completion_tokens`. Keep the
model's prices as two settings, in dollars per million tokens:
`LLM_INPUT_USD_PER_M` and `LLM_OUTPUT_USD_PER_M`. Dollars per million tokens
times tokens is the cost in microdollars (millionths of a dollar), so the
math stays in whole numbers. Cached input is billed at the full input price
here. That counts a little high, which is the safe side.

**The day is the UTC day.** Every user's count resets at midnight UTC.

**One call can overshoot.** The check runs before the call, and the cost is
known only after it. So the budget bounds the day, not each call. That is
fine.

**A refusal carries a `code` and a sentence.** The app shows the sentence:

| Code | When | What the user sees |
|---|---|---|
| `budgetExhausted` | this user reached today's count | "You have used today's AI. It resets at midnight UTC." |
| `aiUnavailable` | the app's daily budget is spent, or the model call failed | "AI is unavailable right now. Try again later." |
| `tooLong` | the input is over the cap | "Keep it under 4,000 characters." |

The code below uses one prompt of up to 4,000 characters, 800 output tokens
and a 60-second deadline. Change the numbers for your feature. For a chat,
also cap the number of messages you send to the model.

New accounts each get a fresh daily count. A bot that makes many accounts
gets many counts. The app budget caps that. Sign in with Apple slows it down
too: each account needs an Apple Account.

**No sign-in?** Every count here is per user. Anonymous sign-in (Supabase has
it) gives each install a user id, but a reinstall gives a new
one. Then the limits slow abuse down, and the app budget is the real
backstop. Sign in with Apple makes the limits hold.

## Supabase

### 1. The usage table and the check

Put this in a migration (`supabase migration new ai_limits`), then
`supabase db push`:

```sql
-- One row per user per day (UTC). The app may read its own rows. It cannot write them.
create table public.ai_usage (
  user_id     uuid   not null references auth.users on delete cascade,
  day         date   not null,
  calls       int    not null default 0,
  cost_micros bigint not null default 0,   -- millionths of a dollar
  primary key (user_id, day)
);
create index on public.ai_usage (day);
alter table public.ai_usage enable row level security;
create policy "read own usage" on public.ai_usage
  for select using (user_id = (select auth.uid()));

-- The limits, in one row. RLS is on and there is no policy, so the app cannot read or change it.
create table public.ai_limits (
  id                      boolean primary key default true check (id),
  user_daily_calls        int    not null,
  app_daily_budget_micros bigint not null
);
alter table public.ai_limits enable row level security;
insert into public.ai_limits (user_daily_calls, app_daily_budget_micros)
values (30, 5000000);   -- 30 AI calls per user a day; $5.00 a day for the whole app

-- Check and count in one step. The user is auth.uid(), never an argument.
create function public.ai_try_use() returns text
language plpgsql security definer set search_path = ''
as $$
declare
  uid   uuid := auth.uid();
  today date := (now() at time zone 'utc')::date;
  lim   public.ai_limits;
begin
  if uid is null then return 'notSignedIn'; end if;
  select * into lim from public.ai_limits;
  -- 0 or less means no ceiling.
  if lim.app_daily_budget_micros > 0
     and (select coalesce(sum(cost_micros), 0) from public.ai_usage where day = today)
         >= lim.app_daily_budget_micros then
    return 'aiUnavailable';
  end if;
  -- The WHERE makes it one atomic step: at the limit, nothing is written.
  insert into public.ai_usage (user_id, day, calls) values (uid, today, 1)
  on conflict (user_id, day) do update set calls = public.ai_usage.calls + 1
    where public.ai_usage.calls < lim.user_daily_calls;
  if found then return 'ok'; end if;
  return 'budgetExhausted';
end $$;
revoke execute on function public.ai_try_use() from public, anon;
grant execute on function public.ai_try_use() to authenticated;

-- Add the real cost after the model answers. Only the secret key may call it.
create function public.ai_add_cost(p_user_id uuid, p_cost_micros bigint) returns void
language sql security definer set search_path = ''
as $$
  update public.ai_usage set cost_micros = cost_micros + p_cost_micros
  where user_id = p_user_id and day = (now() at time zone 'utc')::date;
$$;
revoke execute on function public.ai_add_cost(uuid, bigint) from public, anon, authenticated;
grant execute on function public.ai_add_cost(uuid, bigint) to service_role;
```

Why it is safe:

- **Users cannot write their counter.** `ai_usage` has RLS on and only a
  read policy. The two functions write it as their owner (`security
  definer`), and Supabase's docs ask for `set search_path = ''` on such a
  function.
- **Users cannot count for someone else.** `ai_try_use` reads the user from
  `auth.uid()`, the verified JWT. It takes no user argument.
- **Users cannot fake a cost.** `ai_add_cost` is granted to `service_role`
  only. A fake cost would let one user turn AI off for everyone.
- A user can call `ai_try_use` straight from the app. That only uses up
  their own calls.

### 2. The Edge Function

Set the settings once per project ([hosted-backend.md](hosted-backend.md),
"Secrets and AI calls"): `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`,
`LLM_INPUT_USD_PER_M` and `LLM_OUTPUT_USD_PER_M`. The function reads the
user with `withSupabase` from `@supabase/server`, the way Supabase's guide
does it today: https://supabase.com/docs/guides/functions/auth.

```ts
// supabase/functions/ask/index.ts
import { withSupabase } from "npm:@supabase/server@1";

const REFUSALS: Record<string, [number, string]> = {
  budgetExhausted: [429, "You have used today's AI. It resets at midnight UTC."],
  aiUnavailable: [503, "AI is unavailable right now. Try again later."],
  notSignedIn: [401, "Sign in first."],
  tooLong: [400, "Keep it under 4,000 characters."],
};
const refuse = (code: string) => {
  const [status, message] = REFUSALS[code] ?? [500, "Something went wrong."];
  return Response.json({ code, message }, { status });
};
const price = (name: string) => Number(Deno.env.get(name));   // dollars per 1M tokens

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    // Cap 2: the input.
    const { prompt } = await req.json();
    if (typeof prompt !== "string" || prompt.length > 4000) return refuse("tooLong");

    // Caps 1 and 3: check and count, before the model call.
    const { data: verdict, error } = await ctx.supabase.rpc("ai_try_use");
    if (error) throw error;
    if (verdict !== "ok") return refuse(verdict);

    // Cap 2: the output and the time.
    let data;
    try {
      const res = await fetch(`${Deno.env.get("LLM_BASE_URL")}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("LLM_API_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: Deno.env.get("LLM_MODEL"),
          messages: [{ role: "user", content: prompt }],
          max_completion_tokens: 800,
        }),
        signal: AbortSignal.timeout(60_000),   // well under the 150 s wall clock limit
      });
      if (!res.ok) return refuse("aiUnavailable");
      data = await res.json();
    } catch {
      return refuse("aiUnavailable");   // the deadline passed, or the network failed
    }

    // Cap 3: add what the call really cost. Dollars per 1M tokens times tokens = microdollars.
    const { prompt_tokens = 0, completion_tokens = 0 } = data.usage ?? {};
    const cost = Math.ceil(prompt_tokens * price("LLM_INPUT_USD_PER_M") + completion_tokens * price("LLM_OUTPUT_USD_PER_M"));
    const { error: costError } = await ctx.supabaseAdmin.rpc("ai_add_cost", {
      p_user_id: ctx.userClaims!.id,
      p_cost_micros: cost,
    });
    if (costError) console.error("ai_add_cost failed", costError);

    return Response.json({ answer: data.choices[0].message.content });
  }),
};
```

`ctx.supabase` acts as the user, so `auth.uid()` works in `ai_try_use`.
`ctx.supabaseAdmin` uses the project's secret key, which Edge Functions get
by default. Deploy with `supabase functions deploy ask`. Keep `verify_jwt`
on (the default) for this function: then the gateway refuses a call without a
valid user JWT before your code runs.

### 3. Rate limits and bots

- **Auth has rate limits; Edge Functions do not.** Supabase limits its auth
  endpoints (sign-up, sign-in, token refresh, OTP and email):
  https://supabase.com/docs/guides/auth/rate-limits. Nothing limits how often
  a signed-in user calls your Edge Function. The daily count above is your
  main guard.
- **A per-minute limit** needs a counter outside the function. Supabase's
  example uses Upstash Redis:
  https://supabase.com/docs/guides/functions/examples/rate-limiting.
  Add it only if bursts hurt you. Cost is bounded by the daily count anyway.
- **Bots that make accounts.** Supabase Auth supports a CAPTCHA (hCaptcha or
  Cloudflare Turnstile) on sign-up and sign-in:
  https://supabase.com/docs/guides/auth/auth-captcha. With Sign in with Apple
  only, you may not need it.

### 4. Spend

The Pro plan's Spend Cap stops overage on Supabase items such as Edge
Function calls and egress. It does not cover compute, and it never covers
your AI provider: https://supabase.com/docs/guides/platform/cost-control.
Set the AI provider's spend limit ([llm-api-key.md](llm-api-key.md), step 3).

## The AI provider's spend limit

Set it on every backend. It is the one cap that still works when your code
has a bug. Two examples, checked on 2026-10-07:

- **OpenRouter** lets you set a credit limit on each API key:
  https://openrouter.ai/docs/api-reference/limits. Use a separate key per app
  and per environment.
- **OpenAI** has hard spend limits per organisation or per project. Past the
  limit, calls get a 429:
  https://developers.openai.com/api/docs/guides/spend-limits.

For other providers, look for the limits page in their billing settings.

## In the app

Show the server's sentence. Do not retry a refusal in a loop.

```ts
import { FunctionsHttpError } from "@supabase/supabase-js";
const { data, error } = await supabase.functions.invoke("ask", { body: { prompt } });
if (error instanceof FunctionsHttpError) {
  const { code, message } = await error.context.json();   // show message
}

```

## Where the values go

| Value | Secret? | Where |
|---|---|---|
| `LLM_API_KEY` | **yes** | the function secrets: `supabase secrets set` |
| `LLM_BASE_URL`, `LLM_MODEL` | no | Supabase secrets |
| `LLM_INPUT_USD_PER_M`, `LLM_OUTPUT_USD_PER_M` | no | the same place as `LLM_MODEL`. Update them when you change the model |
| Per-user daily calls, app daily budget | no | the database: `ai_limits`. Change them in the dashboard, with no deploy |

The model's prices come from its provider's pricing page.

## Check it works

Do this on the development project.

1. **The user limit.** Set the per-user daily calls to 2, in the SQL
   editor: `update public.ai_limits set user_daily_calls = 2;`

   Call the AI feature three times from a development build. The first two
   answer. The third shows "You have used today's AI. It resets at midnight
   UTC." The provider's usage page shows two calls, not three.

2. **The cost.** Look at the usage row (`ai_usage`). `calls` is 2 and the cost is above 0. If the
   cost is 0, the two price settings are missing.
3. **The app budget.** Set the app's daily budget to 1 (one microdollar).
   The next call, from any user, shows "AI is unavailable right now. Try
   again later." The rest of the app still works.
4. Put the limits back to your real values.

After a week in production, compare the cost total with your provider's
invoice. If they differ by much, fix the price settings.

## Common errors

- **`permission denied for function ai_try_use` (Supabase).** The call has
  no user session, so it runs as `anon`. Call the function from the app
  after sign-in, and use `ctx.supabase`, not `ctx.supabaseAdmin`.
- **`ai_try_use` always returns `notSignedIn` (Supabase).** It was called
  with the secret key (`ctx.supabaseAdmin`). That client has no user, so
  `auth.uid()` is null.
- **`permission denied for function ai_add_cost` (Supabase).** It was called
  with `ctx.supabase`. Only `ctx.supabaseAdmin` may add a cost.
- **The third call still works.** The limits row is missing.
- **The cost stays at 0.** `LLM_INPUT_USD_PER_M` or `LLM_OUTPUT_USD_PER_M` is
  not set where the function reads it.
- **400 on `max_completion_tokens`.** An older or local model server wants
  `max_tokens` ([llm-api-key.md](llm-api-key.md)).
- **The user sees a timeout instead of `aiUnavailable`.** The model deadline
  is longer than the function's limit, so the platform stops the function
  first. Keep the deadline below the limit.
- **A failed model call still counts.** That is on purpose: the count runs
  before the call. A user who hits many failures uses up their day. Raise the
  limit, or fix the provider error.
