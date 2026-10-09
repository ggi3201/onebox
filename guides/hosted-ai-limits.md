# AI cost limits on a hosted backend

Runs on: your Mac (the code, deployed with the vendor's CLI) and your browser
(the vendor's dashboard, to change a limit). The limits run in your Supabase,
Convex or Firebase project.

An AI feature costs you money on every call. A flat subscription plus an AI
feature is an open tab: one script in a loop, one bug in the app's retry
code, or one keen user can turn into a large bill. This guide puts a ceiling
on that bill when your backend is hosted. It is the hosted version of
[backend.md](backend.md), "Protect the API", parts 2 and 3. Set up the
backend first with [hosted-backend.md](hosted-backend.md).

Facts about each vendor were checked on **2026-10-07**, in the vendor's own
docs. The code was checked the same day: the Supabase SQL in Postgres 17, the
Edge Function with `deno check`, the Convex code on a local Convex backend,
and the Firebase function with `tsc`.

## What it is and what it costs

It costs nothing extra: two small tables (or documents) and about 60 lines
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

What each platform gives you:

| | **Supabase** | **Convex** | **Firebase** |
|---|---|---|---|
| The atomic daily count | A table and a Postgres function, called with the user's JWT | A mutation (each mutation is a transaction) | A Firestore transaction in the Cloud Function |
| Short-window rate limit | Not built in for Edge Functions. Auth endpoints only | The rate limiter component, `@convex-dev/rate-limiter` | Not built in. `maxInstances` caps how many copies of a function run at once |
| Bot check | CAPTCHA on sign-up and sign-in | None built in. I did not find one in the docs | App Check, with App Attest on iOS |
| Function time limit | 150 s (Free), 400 s (paid) wall clock | Node actions: 10 minutes | Callable: up to 3,600 s, 60 s by default |
| Platform spend cap | Spend Cap: Supabase usage only | Spending limits and per-deployment usage limits | Budget alerts. They do not stop spending |

**No platform cap covers your AI provider's bill.** The model call goes to
OpenRouter, OpenAI or another provider, and that provider bills you. Only
your own code (this guide) and the provider's own spend limit stop that bill.

## The design, on all three

**The limits live in the database**, in one row or document. You change them
in the dashboard, with no deploy. Start with 30 calls per user a day and an
app budget you could pay on a bad day, for example $5. A budget of 0 or less
means no ceiling, the same as in the box skill. It does not turn AI off. The
skill `app-features:ai-usage-limits` has
[a page on choosing a budget](../plugins/app-features/skills/ai-usage-limits/references/pricing.md).

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

**A refusal carries a `code` and a sentence.** The app shows the sentence.
`budgetExhausted` and `rateLimited` have the same names as on the box
(`app-features:ai-usage-limits`). The other codes exist only here:

| Code | When | What the user sees |
|---|---|---|
| `budgetExhausted` | this user reached today's count | "You have used today's AI. It resets at midnight UTC." |
| `aiUnavailable` | the app's daily budget is spent, or the model call failed | "AI is unavailable right now. Try again later." |
| `rateLimited` | too many calls in a minute (Convex) | "Too fast. Wait a minute and try again." |
| `tooLong` | the input is over the cap | "Keep it under 4,000 characters." |

The code below uses one prompt of up to 4,000 characters, 800 output tokens
and a 60-second deadline. Change the numbers for your feature. For a chat,
also cap the number of messages you send to the model.

New accounts each get a fresh daily count. A bot that makes many accounts
gets many counts. The app budget caps that. Sign in with Apple slows it down
too: each account needs an Apple Account.

**No sign-in?** Every count here is per user. Anonymous sign-in (Supabase and
Firebase have it) gives each install a user id, but a reinstall gives a new
one. Then the limits slow abuse down, and the app budget is the real
backstop. The box skill's
[no-accounts page](../plugins/app-features/skills/ai-usage-limits/references/no-accounts.md)
explains the trade-off. Sign in with Apple makes the limits hold.

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
- Supabase has no device check like Firebase App Check.

### 4. Spend

The Pro plan's Spend Cap stops overage on Supabase items such as Edge
Function calls and egress. It does not cover compute, and it never covers
your AI provider: https://supabase.com/docs/guides/platform/cost-control.
Set the AI provider's spend limit ([llm-api-key.md](llm-api-key.md), step 3).

## Convex

### 1. The tables

Add these to `convex/schema.ts`:

```ts
aiUsage: defineTable({ userId: v.string(), day: v.string(), calls: v.number(), costMicros: v.number() })
  .index("by_user_day", ["userId", "day"]),
aiDays: defineTable({ day: v.string(), costMicros: v.number() }).index("by_day", ["day"]),
aiLimits: defineTable({ userDailyCalls: v.number(), appDailyBudgetMicros: v.number() }),
```

Then add one `aiLimits` document in the dashboard (**Data**, then the table),
for example `{ "userDailyCalls": 30, "appDailyBudgetMicros": 5000000 }`.

### 2. The check: a mutation, with the rate limiter

Convex has an official rate limiter component:
https://www.convex.dev/components/rate-limiter (source:
https://github.com/get-convex/rate-limiter). Install it with `npm install
@convex-dev/rate-limiter`, then add it to the app:

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";

const app = defineApp();
app.use(rateLimiter);
export default app;
```

A Convex mutation is one transaction. So the check, the rate limit and the
count happen together, or not at all:

```ts
// convex/aiLimits.ts
import { internalMutation } from "./_generated/server";
import { components } from "./_generated/api";
import { v } from "convex/values";
import { RateLimiter, MINUTE } from "@convex-dev/rate-limiter";

const rateLimiter = new RateLimiter(components.rateLimiter, {
  ai: { kind: "token bucket", rate: 5, period: MINUTE, capacity: 5 },   // 5 a minute per user
});
const today = () => new Date(Date.now()).toISOString().slice(0, 10);   // UTC

// A mutation is one transaction. Two calls at once cannot both slip under the limit.
export const tryUse = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }): Promise<string> => {
    const limits = await ctx.db.query("aiLimits").first();
    if (!limits) throw new Error("Add one aiLimits document first.");
    const day = today();
    const app = await ctx.db.query("aiDays").withIndex("by_day", (q) => q.eq("day", day)).unique();
    const budget = limits.appDailyBudgetMicros;   // 0 or less means no ceiling
    if (budget > 0 && (app?.costMicros ?? 0) >= budget) return "aiUnavailable";
    const { ok } = await rateLimiter.limit(ctx, "ai", { key: userId });
    if (!ok) return "rateLimited";
    const row = await ctx.db.query("aiUsage")
      .withIndex("by_user_day", (q) => q.eq("userId", userId).eq("day", day)).unique();
    if (row && row.calls >= limits.userDailyCalls) return "budgetExhausted";
    if (row) await ctx.db.patch(row._id, { calls: row.calls + 1 });
    else await ctx.db.insert("aiUsage", { userId, day, calls: 1, costMicros: 0 });
    return "ok";
  },
});

export const addCost = internalMutation({
  args: { userId: v.string(), costMicros: v.number() },
  handler: async (ctx, { userId, costMicros }) => {
    const day = today();
    const row = await ctx.db.query("aiUsage")
      .withIndex("by_user_day", (q) => q.eq("userId", userId).eq("day", day)).unique();
    if (row) await ctx.db.patch(row._id, { costMicros: row.costMicros + costMicros });
    const app = await ctx.db.query("aiDays").withIndex("by_day", (q) => q.eq("day", day)).unique();
    if (app) await ctx.db.patch(app._id, { costMicros: app.costMicros + costMicros });
    else await ctx.db.insert("aiDays", { day, costMicros });
  },
});
```

Both are `internalMutation`, so the app cannot call them. No public
function writes these tables, so users cannot change their counter.

### 3. The action

Set `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_INPUT_USD_PER_M` and
`LLM_OUTPUT_USD_PER_M` with `npx convex env set`, for each deployment
([hosted-backend.md](hosted-backend.md), "Secrets and AI calls").

```ts
// convex/ai.ts
"use node";   // for AbortSignal.timeout; this file may hold actions only
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";

const MESSAGES: Record<string, string> = {
  budgetExhausted: "You have used today's AI. It resets at midnight UTC.",
  aiUnavailable: "AI is unavailable right now. Try again later.",
  rateLimited: "Too fast. Wait a minute and try again.",
  notSignedIn: "Sign in first.",
  tooLong: "Keep it under 4,000 characters.",
};
// Throw a ConvexError: production hides the message of any other error.
const refuse = (code: string) => new ConvexError({ code, message: MESSAGES[code] ?? "Something went wrong." });
const price = (name: string) => Number(process.env[name]);   // dollars per 1M tokens

export const ask = action({
  args: { prompt: v.string() },
  handler: async (ctx, { prompt }): Promise<string> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw refuse("notSignedIn");
    if (prompt.length > 4000) throw refuse("tooLong");   // cap 2: the input
    const userId = identity.tokenIdentifier;

    // Caps 1 and 3, and the rate limit: check and count, before the model call.
    const verdict = await ctx.runMutation(internal.aiLimits.tryUse, { userId });
    if (verdict !== "ok") throw refuse(verdict);

    // Cap 2: the output and the time.
    let data;
    try {
      const res = await fetch(`${process.env.LLM_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.LLM_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.LLM_MODEL,
          messages: [{ role: "user", content: prompt }],
          max_completion_tokens: 800,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`model ${res.status}`);
      data = await res.json();
    } catch (e) {
      console.error(e);
      throw refuse("aiUnavailable");
    }

    // Cap 3: add what the call really cost. Dollars per 1M tokens times tokens = microdollars.
    const { prompt_tokens = 0, completion_tokens = 0 } = data.usage ?? {};
    const costMicros = Math.ceil(prompt_tokens * price("LLM_INPUT_USD_PER_M") + completion_tokens * price("LLM_OUTPUT_USD_PER_M"));
    await ctx.runMutation(internal.aiLimits.addCost, { userId, costMicros });
    return data.choices[0].message.content as string;
  },
});
```

The check runs in its own mutation, before the model call. Each
`ctx.runMutation` is a separate transaction, so keep the whole check in
`tryUse`, not in several calls from the action.

### 4. Spend

Convex has two caps, for Convex usage only:

- **Spending limits** for the team, on the billing page. A warning threshold
  emails you. A disable threshold turns off all the team's projects:
  https://docs.convex.dev/dashboard/teams/teams.
- **Usage limits** per deployment, per day or month (function calls, action
  compute and more): https://docs.convex.dev/production/usage-limits.

Neither covers your AI provider. Set its spend limit too
([llm-api-key.md](llm-api-key.md), step 3).

## Firebase

### 1. The counter documents and the rules

The counters live in a top-level `aiDays` collection:
`aiDays/{day}` holds the app's cost for the day, and
`aiDays/{day}/users/{uid}` holds one user's calls and cost. The limits live
in one document, `aiConfig/limits`. Add it on the Firestore page of the
console, for example `userDailyCalls: 30` and
`appDailyBudgetMicros: 5000000`, both numbers.

**Do not put the counter under `users/{uid}`.** The rules in
[hosted-backend.md](hosted-backend.md) let each user write everything under
their own `users/{uid}`. A counter there is a counter the user can reset.

Rules deny every path you do not match, so the app can neither read nor write
`aiDays` and `aiConfig`. The Cloud Function uses the Admin SDK, which skips
the rules. To show users their own usage, allow reads only:

```
match /aiDays/{day}/users/{uid} {
  allow read: if request.auth != null && request.auth.uid == uid;
}
```

### 2. The function

`LLM_API_KEY` is a function secret
([hosted-backend.md](hosted-backend.md), "Secrets and AI calls"). The other
values are not secret. Put them in `functions/.env`: `LLM_BASE_URL`,
`LLM_MODEL`, `LLM_INPUT_USD_PER_M` and `LLM_OUTPUT_USD_PER_M`.

```ts
// functions/src/ai.ts
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { getFirestore, FieldValue } from "firebase-admin/firestore";   // initializeApp() runs once, in index.ts

const llmKey = defineSecret("LLM_API_KEY");
const MESSAGES: Record<string, string> = {
  budgetExhausted: "You have used today's AI. It resets at midnight UTC.",
  aiUnavailable: "AI is unavailable right now. Try again later.",
};
const refuse = (code: string) => new HttpsError("resource-exhausted", MESSAGES[code], { code });
const price = (name: string) => Number(process.env[name]);   // dollars per 1M tokens, from functions/.env

// Check and count in one transaction. Firestore retries it if another call changed the same documents.
async function tryUse(uid: string, day: string): Promise<string> {
  const db = getFirestore();
  const limitsRef = db.doc("aiConfig/limits");
  const dayRef = db.doc(`aiDays/${day}`);
  const userRef = db.doc(`aiDays/${day}/users/${uid}`);
  return db.runTransaction(async (tx) => {
    const [limits, app, user] = await tx.getAll(limitsRef, dayRef, userRef);
    if (!limits.exists) throw new Error("Add the aiConfig/limits document first.");
    const budget = limits.get("appDailyBudgetMicros");   // 0 or less means no ceiling
    if (budget > 0 && (app.get("costMicros") ?? 0) >= budget) return "aiUnavailable";
    if ((user.get("calls") ?? 0) >= limits.get("userDailyCalls")) return "budgetExhausted";
    tx.set(userRef, { calls: FieldValue.increment(1) }, { merge: true });
    return "ok";
  });
}

export const ask = onCall(
  { secrets: [llmKey], timeoutSeconds: 90, enforceAppCheck: true },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
    const prompt = request.data?.prompt;
    if (typeof prompt !== "string" || prompt.length > 4000) {   // cap 2: the input
      throw new HttpsError("invalid-argument", "Keep it under 4,000 characters.", { code: "tooLong" });
    }
    const uid = request.auth.uid;
    const day = new Date().toISOString().slice(0, 10);   // UTC

    // Caps 1 and 3: check and count, before the model call.
    const verdict = await tryUse(uid, day);
    if (verdict !== "ok") throw refuse(verdict);

    // Cap 2: the output and the time.
    let data;
    try {
      const res = await fetch(`${process.env.LLM_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${llmKey.value()}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.LLM_MODEL,
          messages: [{ role: "user", content: prompt }],
          max_completion_tokens: 800,
        }),
        signal: AbortSignal.timeout(60_000),   // under timeoutSeconds
      });
      if (!res.ok) throw new Error(`model ${res.status}`);
      data = await res.json();
    } catch (e) {
      console.error(e);
      throw refuse("aiUnavailable");
    }

    // Cap 3: add what the call really cost. Dollars per 1M tokens times tokens = microdollars.
    const { prompt_tokens = 0, completion_tokens = 0 } = data.usage ?? {};
    const cost = Math.ceil(prompt_tokens * price("LLM_INPUT_USD_PER_M") + completion_tokens * price("LLM_OUTPUT_USD_PER_M"));
    const db = getFirestore();
    await Promise.all([
      db.doc(`aiDays/${day}`).set({ costMicros: FieldValue.increment(cost) }, { merge: true }),
      db.doc(`aiDays/${day}/users/${uid}`).set({ costMicros: FieldValue.increment(cost) }, { merge: true }),
    ]);
    return { answer: data.choices[0].message.content as string };
  },
);
```

- `timeoutSeconds` is 60 by default. A callable function can go up to 3,600.
  Keep the model deadline below it, so your code answers before Firebase
  stops the function.
- `maxInstances` (another `onCall` option) caps how many copies of the
  function run at the same time. It is a blunt brake on a flood of calls.
  Firebase has no per-user rate limit for functions.
- Remove `enforceAppCheck: true` until the next step is done, or every call
  fails.

### 3. App Check, with App Attest

App Check makes the function accept calls only from your real app on a real
device. On iOS it uses Apple's App Attest. It does not limit a real user. It
stops scripts that call your function with a stolen session.

1. In the Firebase console, open App Check (**Security**, **App Check**).
   Register your iOS app with the App Attest provider:
   https://firebase.google.com/docs/app-check/ios/app-attest-provider.
2. Add the App Attest entitlement in the app config. App Check does not
   accept tokens from App Attest's development environment, so set it to
   `production`:

   ```json
   "ios": {
     "entitlements": { "com.apple.developer.devicecheck.appattest-environment": "production" }
   }
   ```

3. `npx expo install @react-native-firebase/app-check`. Add it to the
   plugins list, and make a new development build. Then start it once, at app
   start:

   ```ts
   import { getApp } from "@react-native-firebase/app";
   import { initializeAppCheck, ReactNativeFirebaseAppCheckProvider } from "@react-native-firebase/app-check";

   const provider = new ReactNativeFirebaseAppCheckProvider();
   provider.configure({
     apple: {
       provider: __DEV__ ? "debug" : "appAttestWithDeviceCheckFallback",
       debugToken: process.env.EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN,   // development project only
     },
   });
   await initializeAppCheck(getApp(), { provider, isTokenAutoRefreshEnabled: true });
   ```

   The simulator cannot attest. Development builds use the debug provider,
   with a debug token you make in the console's App Check page (manage debug
   tokens). React Native Firebase's page has the rest:
   https://rnfirebase.io/app-check/usage.
4. Ship that app version. Then add `enforceAppCheck: true` and deploy the
   function. Older app versions send no token and get refused, so wait until
   most users have updated.

`consumeAppCheckToken: true` adds replay protection: each token works once.
It is beta, and it adds a network round trip:
https://firebase.google.com/docs/app-check/cloud-functions.

Apple limits how many attestations an app can do. For a large existing user
base, Apple asks you to turn App Attest on gradually (the App Attest provider
page above links to Apple's note).

### 4. Spend

A Google Cloud budget on Blaze sends alerts. It does not cap spending:
https://docs.cloud.google.com/billing/docs/how-to/budgets. Google documents a
way to turn billing off from a budget alert, but it shuts down every service
in the project and can delete resources:
https://docs.cloud.google.com/billing/docs/how-to/disable-billing-with-notifications.
Do not use that for a live app. Use the app budget above, and set the AI
provider's spend limit ([llm-api-key.md](llm-api-key.md), step 3).

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
// Supabase
import { FunctionsHttpError } from "@supabase/supabase-js";
const { data, error } = await supabase.functions.invoke("ask", { body: { prompt } });
if (error instanceof FunctionsHttpError) {
  const { code, message } = await error.context.json();   // show message
}

// Convex
import { ConvexError } from "convex/values";
try { await ask({ prompt }); }
catch (e) { if (e instanceof ConvexError) { const { code, message } = e.data as { code: string; message: string }; } }

// Firebase (React Native Firebase)
try { await httpsCallable(getFunctions(), "ask")({ prompt }); }
catch (e: any) { const code = e.details?.code; const message = e.message; }
```

On the box, the chat store maps its refusals with `refusalOf` and
`explainError` (`store.ts` in `app-features:chat-feature`). They know only
the box's codes. `aiUnavailable`, `tooLong` and `notSignedIn` are not among
them. If you reuse them here, add those codes, or show the server's sentence.

## Where the values go

| Value | Secret? | Where |
|---|---|---|
| `LLM_API_KEY` | **yes** | the vendor's function secrets: `supabase secrets set`, `npx convex env set`, `firebase functions:secrets:set` |
| `LLM_BASE_URL`, `LLM_MODEL` | no | Supabase secrets, Convex environment variables, or `functions/.env` on Firebase |
| `LLM_INPUT_USD_PER_M`, `LLM_OUTPUT_USD_PER_M` | no | the same place as `LLM_MODEL`. Update them when you change the model |
| Per-user daily calls, app daily budget | no | the database: `ai_limits` (Supabase), `aiLimits` (Convex), `aiConfig/limits` (Firebase). Change them in the dashboard, with no deploy |
| `EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN` (Firebase) | treat as private | the `development` profile in `eas.json` only. Never in a production build |

The model's prices come from its provider's pricing page. The skill
`app-features:ai-usage-limits` has a script that prints current prices from
OpenRouter's public list.

## Check it works

Do this on the development project.

1. **The user limit.** Set the per-user daily calls to 2:
   - Supabase, in the SQL editor: `update public.ai_limits set user_daily_calls = 2;`
   - Convex: edit the `aiLimits` document in the dashboard.
   - Firebase: edit `aiConfig/limits` in the console.

   Call the AI feature three times from a development build. The first two
   answer. The third shows "You have used today's AI. It resets at midnight
   UTC." The provider's usage page shows two calls, not three.

   On Convex you can do it from the terminal. `--identity` makes the call as
   a test user:

   ```bash
   for i in 1 2 3; do
     npx convex run ai:ask '{"prompt":"Say ok"}' \
       --identity '{"subject":"test-user","issuer":"https://example.com","tokenIdentifier":"https://example.com|test-user"}'
   done
   ```

   Expect `"ok"` twice (or the model's answer), then a `ConvexError` with
   `"code":"budgetExhausted"`.
2. **The cost.** Look at the usage row (`ai_usage`, `aiUsage` or
   `aiDays/{day}/users/{uid}`). `calls` is 2 and the cost is above 0. If the
   cost is 0, the two price settings are missing.
3. **The app budget.** Set the app's daily budget to 1 (one microdollar).
   The next call, from any user, shows "AI is unavailable right now. Try
   again later." The rest of the app still works.
4. **The rate limit (Convex).** Set the daily calls high and call six times
   within a minute. The sixth returns `rateLimited`.
5. **App Check (Firebase).** Call the function from a build with App Check
   off, or with `curl`. It is refused.
6. Put the limits back to your real values.

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
- **The third call still works.** The limits row or document is missing, or
  the limit is stored as text. On Firebase, store both limits as numbers.
- **The cost stays at 0.** `LLM_INPUT_USD_PER_M` or `LLM_OUTPUT_USD_PER_M` is
  not set where the function reads it.
- **The app shows "Server Error" instead of the sentence (Convex).** The
  code threw a plain `Error`. Production hides its message. Throw a
  `ConvexError`.
- **`components.rateLimiter` does not exist (Convex).** `convex/convex.config.ts`
  is missing, or `npx convex dev` has not run since you added it.
- **A Convex deploy fails on `ai.ts`.** A file with `"use node"` may hold
  actions only. Keep the mutations in `aiLimits.ts`.
- **Users can reset their own counter (Firebase).** The counter is under
  `users/{uid}`, where the rules allow writes. Move it to `aiDays`.
- **Every call fails after you turn on `enforceAppCheck` (Firebase).** The app
  sends no App Check token. Check the entitlement, the `initializeAppCheck`
  call and a new build. On the simulator, register the debug token.
- **400 on `max_completion_tokens`.** An older or local model server wants
  `max_tokens` ([llm-api-key.md](llm-api-key.md)).
- **The user sees a timeout instead of `aiUnavailable`.** The model deadline
  is longer than the function's limit, so the platform stops the function
  first. Keep the deadline below the limit.
- **A failed model call still counts.** That is on purpose: the count runs
  before the call. A user who hits many failures uses up their day. Raise the
  limit, or fix the provider error.
