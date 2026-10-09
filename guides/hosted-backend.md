# A hosted backend: Supabase, Convex or Firebase

Runs on: your browser (the vendor's dashboard) and your Mac (the app, and the
server functions you deploy with the vendor's CLI). There is no box to run.

A hosted backend gives you a database, sign-in and server functions as a
service. You write the server code as small functions, and the vendor runs
them. You need a backend when data must live off the phone: accounts, sync
between devices, a RevenueCat webhook, or an AI call with a secret key. Pick a
hosted backend instead of the box when you do not want to run a server at
all, or you want to ship this month and learn servers later.

Prices and limits in this guide were checked on **2026-09-28**, on each
vendor's own pricing page unless the text says otherwise. They change often.
Treat them as a ballpark and check the page before you commit.

## When hosted beats the box

Hosted is the better choice when:

- You do not want to run a server. No updates, no backups to check, no disk
  to watch. The vendor does that.
- You have no box yet and no landing page. Then hosted means **no server at
  all** in your plan.
- Your app is mostly "each user reads and writes their own rows". Supabase,
  Convex and Firebase all do that well, with sign-in built in.
- You want live updates on screen (a list that changes when another device
  writes). Convex does this by default. Supabase and Firebase have it too.

The box is the better choice when:

- You already run a box for other apps. One more Compose project costs
  nothing. A hosted Pro plan costs about $25 a month per app or per developer.
- The app does long or heavy work on the server: slow AI jobs, imports that
  fetch web pages, background queues. Server functions have time limits (see
  "Pick one"). The onebox skills `app-features:agent-harness` and
  `app-features:durable-jobs` are written for an API on the box.
- You want one bill you can predict. On a box, a traffic spike makes the app
  slow. On a pay-as-you-go plan, it makes the bill bigger.
- You want to leave without a rewrite. See "Moving to the box later".

Both work. Many people start hosted and move later, or never.

## Pick one

| | **Supabase** | **Convex** | **Firebase** |
|---|---|---|---|
| What it is | Postgres, with auth, file storage and Edge Functions (Deno, TypeScript) around it | A reactive document database; your whole backend is TypeScript functions | Google's NoSQL database (Firestore), auth, Cloud Functions |
| Free tier | 2 active projects. 500 MB database, 50,000 monthly active users, 5 GB egress, 1 GB files, 500,000 function calls. Pauses after 1 week of inactivity | 1M function calls a month, 0.5 GB database, 1 GB files, 20 GB-hours of action compute, 1 GB egress. 1 to 6 developers. No daily backups | Spark plan: Firestore 1 GiB, 50,000 reads and 20,000 writes a day; Auth 50,000 monthly active users. **No Cloud Functions and no Cloud Storage** |
| First paid step | Pro, from $25 a month per organisation. Includes $10 of compute (one Micro database), 100,000 monthly active users, 8 GB disk. Spend cap on by default | Starter: pay as you go past the free limits (for example $2.20 per extra 1M calls). Professional: $25 per developer a month, with daily backups | Blaze: pay as you go, card required. The Spark quotas stay free. Functions: $0.40 per 1M calls past 2M a month |
| Native Sign in with Apple | Built in: `signInWithIdToken` | Through Clerk or Better Auth (below) | Built in: Apple credential in Firebase Auth |
| Apple token revoke on delete | You write it (an Edge Function) | You write it (an action) | Built in: `revokeToken` |
| Server code time limit | 150 s (Free), 400 s (paid) wall clock, 2 s CPU | Actions: 10 min (Node), 30 min (Convex runtime) | Configurable per function |
| Leaving later | Easy: it is Postgres. `pg_dump` and go | Medium: export to files, or self-host the open-source backend | Hard: NoSQL, so a move to Postgres is a rewrite of the data layer |

**A simple default:** pick **Supabase** if you may move to the box later, or
you like SQL. It is Postgres, the same database the box runs. Pick **Convex**
if you want the least backend code and live updates, and you are happy in
TypeScript. Pick **Firebase** if you already know it, or you need other Google
services. On Firebase, plan for the Blaze plan from day one: server functions
and file storage need it.

A Google Cloud budget on Blaze sends you alerts. It does not stop the
spending. Set one anyway, and check your usage in the first weeks.

### The others

These came up in the research. They are not the default here, for the reason
given.

- **Appwrite Cloud.** A full backend (database, auth, functions, storage),
  open source, and you can self-host it. Free plan: 2 projects. Pro: $25 a
  month (Appwrite's own announcement; its pricing page did not load its plan
  numbers for me). A Free project with no development activity in the
  Console for 7 days is paused, and a project that stays paused for 90 days
  is deleted. Native Sign in with Apple from an ID token arrived on
  2026-09-24. It is very new, so test it well.
- **PocketBase.** One Go binary with SQLite, auth, files and an admin UI. MIT
  licence. There is no hosted service from the project: you run it on a
  server, so it is really a box option. It is not at v1.0 yet (v0.40.4), and
  its README says backward compatibility is not guaranteed before v1.0. It
  has an Apple OAuth2 provider (a web flow). I did not find a built-in route
  for the native Apple sheet's ID token.
- **Neon.** Hosted Postgres that scales to zero. Free: 1 GB of storage per
  project (20 GB across all projects) and 100 compute-unit hours per project
  (https://neon.com/pricing, checked 2026-10-09). Paid (Launch): $0.106 per
  compute-unit hour and $0.35 per GB-month, no monthly minimum. It also
  offers Neon Auth (managed Better Auth). It is a database first. You still need your server
  code to run somewhere.
- **PlanetScale Postgres.** Hosted Postgres from $5 a month (single node,
  no high availability) or $15 a month (one primary and two replicas). No
  free plan is listed. Like Neon, it is only the database.

Neon or PlanetScale make sense later, when you run the API yourself and want
someone else to run the database.

## Before you start, for any of them

1. **One project per environment.** A production project and a development
   project. Never test on production data. Supabase Free allows 2 active
   projects. Convex gives each project a development and a production
   deployment. On Firebase, make two projects.
2. **The URL per build profile.** The app reads the backend URL from an
   `EXPO_PUBLIC_*` variable. Set it per profile in `eas.json`, exactly like
   `EXPO_PUBLIC_API_URL` in [expo-app.md](expo-app.md) (step 4). The
   `development` profile points at the development project, `production` at
   production.
3. **What may go in the app.** A Supabase publishable key, a Convex URL and a
   Firebase config file are public by design. The vendor's secret or admin
   key is not. It never goes in the app or in an `EXPO_PUBLIC_*` variable.
   See [secrets.md](secrets.md).
4. **Keep each user's data apart.** On the box, a query filter does this
   ([backend.md](backend.md), "Keep each user's data apart"). Hosted, the
   public key is in every copy of the app, so the database rules are the
   only wall between users. Each section below says how.
5. **A development build.** Sign in with Apple needs one. It does not work
   in Expo Go ([expo-app.md](expo-app.md), step 5).

## Supabase

### Setup with Expo

1. Make a project at https://supabase.com/dashboard. Make a second one for
   development.
2. Follow Supabase's Expo quickstart:
   https://supabase.com/docs/guides/getting-started/quickstarts/expo-react-native.
   It installs `@supabase/supabase-js`, `react-native-url-polyfill` and
   `expo-sqlite`, and makes one client for the whole app.
3. Put `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   in `eas.json`, per profile.
4. Install the Supabase CLI on your Mac and link the repo to the project.
   Keep the database schema in migration files in git, not only in the
   dashboard.

The quickstart keeps the session in `expo-sqlite` storage, not in the
Keychain. [expo-app.md](expo-app.md) (step 9) asks for the Keychain. A
Supabase session can be larger than one `expo-secure-store` value, so ask
your coding agent for a storage adapter that encrypts the session with a key
kept in `expo-secure-store`.

### Keep each user's data apart: Row Level Security

Turn on Row Level Security (RLS) on **every** table in the public schema, and
write a policy per table. A table without RLS can be read and changed by
anyone who has the publishable key, and that key is in your app.

```sql
alter table public.notes enable row level security;

create policy "own rows" on public.notes
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
```

The dashboard's Security Advisor lists tables without RLS. Check it before
every release.

### Sign in with Apple

Supabase checks Apple's token for you. You do not need your own
`/api/auth/apple` endpoint.

1. Turn on the capability and add `expo-apple-authentication`, as in
   [sign-in-with-apple.md](sign-in-with-apple.md), step 1.
2. In the dashboard: **Authentication**, **Providers**, **Apple**. Turn it on.
   In **Client IDs**, add your bundle ID. Add every variant you build (for
   example `com.example.myapp` and `com.example.myapp.dev`).
3. In the app:

```tsx
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import { supabase } from "../lib/supabase";

export async function signInWithApple() {
  // Apple gets the SHA-256 of the nonce. Supabase gets the raw value.
  const nonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);

  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
    nonce: hashedNonce,
  });
  if (!credential.identityToken) throw new Error("Apple returned no identity token.");

  const { error } = await supabase.auth.signInWithIdToken({
    provider: "apple",
    token: credential.identityToken,
    nonce,
  });
  if (error) throw error;

  // The name comes on the first sign-in only. Save it now or lose it.
  const name = [credential.fullName?.givenName, credential.fullName?.familyName]
    .filter(Boolean).join(" ");
  if (name) await supabase.auth.updateUser({ data: { full_name: name } });
}
```

Supabase's own guide:
https://supabase.com/docs/guides/auth/social-login/auth-apple. For a
native-only app you do not need Apple's six-month client secret in the
dashboard.

**Account deletion.** Supabase does not revoke Apple tokens when you delete
a user, and it does not store Apple's refresh token. Supabase closed the
request for this as "not planned"
(https://github.com/supabase/auth/issues/1308). So write an Edge Function
`delete-account` that does steps 3 to 6 of
[sign-in-with-apple.md](sign-in-with-apple.md), step 6: the app sends a fresh
`authorizationCode`, the function exchanges it, checks the `sub`, revokes,
then deletes the user with the admin API. The Sign in with Apple key
(`APPLE_SIGNIN_PRIVATE_KEY`) is a function secret.

### Secrets and AI calls: Edge Functions

Edge Functions run TypeScript on Deno. Set a secret once:

```bash
supabase secrets set LLM_API_KEY=... --project-ref <prod-ref>
```

Better: load them from your secrets tool with `supabase secrets set
--env-file`, so the value never appears in your shell history. Read it in the
function with `Deno.env.get("LLM_API_KEY")`. You do not need to redeploy
after you set a secret.

For an AI call, the app calls the function with the user's session. The
function reads the user from the request's `Authorization` header, never from
the request body. Then it calls the model and streams the answer back. The
Supabase guide shows the current way to read the user:
https://supabase.com/docs/guides/functions/auth. Mind the 150 s limit on the
Free plan. A long agent run must be split into steps, or run on the box.

Before the model call, check and count the user's AI budget. The table, the
Postgres function and the Edge Function are in
[hosted-ai-limits.md](hosted-ai-limits.md#supabase).

### RevenueCat

RevenueCat's webhook does not carry a Supabase login, so the gateway would
reject it. Turn off the JWT check for that one function only:

```toml
# supabase/config.toml
[functions.revenuecat-webhook]
verify_jwt = false
```

Then check RevenueCat's header yourself:

```ts
// supabase/functions/revenuecat-webhook/index.ts
// Hash both sides, then compare every byte: the time does not depend on
// where they differ. An empty or missing secret never matches.
async function sameSecret(given: string | null, expected: string | undefined) {
  if (!given || !expected) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([given, expected].map((s) => crypto.subtle.digest("SHA-256", enc.encode(s))));
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  if (!(await sameSecret(req.headers.get("Authorization"), Deno.env.get("REVENUECAT_WEBHOOK_AUTH")))) {
    return new Response("unauthorized", { status: 401 });
  }
  const { event } = await req.json();
  // Store event.id (to skip duplicates), event.type and event.app_user_id.
  // Then ask RevenueCat for the customer's current state and save that.
  return new Response(null, { status: 200 });
});
```

In RevenueCat's webhook settings, set the URL
`https://<project-ref>.supabase.co/functions/v1/revenuecat-webhook` and type
the same value you stored as `REVENUECAT_WEBHOOK_AUTH`. In the app, call
`Purchases.logIn(<the Supabase user id>)` after sign-in, so the webhook's
`app_user_id` matches your users. See [revenuecat.md](revenuecat.md).

## Convex

### Setup with Expo

1. Follow Convex's Expo quickstart:
   https://docs.convex.dev/quickstart/react-native. In short: `npm install
   convex`, then `npx convex dev`. It makes the `convex/` folder, logs you in
   and starts a development deployment.
2. Wrap the app in `ConvexProvider` (or the auth version, below) with a
   `ConvexReactClient`.
3. Put `EXPO_PUBLIC_CONVEX_URL` in `eas.json`, per profile. The `production`
   profile gets the production deployment's URL.
4. Deploy to production with `npx convex deploy`. `npx convex dev` only
   touches the development deployment.

Your backend is the `convex/` folder: queries (read), mutations (write) and
actions (can call the outside world, like an AI model).

### Keep each user's data apart

Convex has no row rules. Every public query and mutation must check the user
itself:

```ts
const identity = await ctx.auth.getUserIdentity();
if (!identity) throw new Error("Not signed in");
// then read and write only rows whose owner is this user
```

Put that check in one helper and use it in every function. Convex's AI rules
(below) call this "custom functions for auth". Functions you do not want the
app to call must be `internalQuery`, `internalMutation` or `internalAction`.

### Sign in with Apple

Convex does not check Apple tokens by itself. It trusts a login provider you
configure in `convex/auth.config.ts`. Two good choices for the native Apple
sheet in Expo:

- **Clerk.** Clerk's Expo SDK has a `useSignInWithApple()` hook built on
  `expo-apple-authentication`
  (https://clerk.com/docs/expo/guides/configure/auth-strategies/sign-in-with-apple).
  Connect it to Convex with `ConvexProviderWithClerk`
  (https://docs.convex.dev/auth/clerk). Clerk Free: 50,000 monthly retained
  users per app. Pro: $25 a month. One more vendor and one more bill.
- **Better Auth**, as a Convex component (`@convex-dev/better-auth`, with an
  Expo guide at https://labs.convex.dev/better-auth). Better Auth accepts
  Apple's ID token from the native sheet:
  `signIn.social({ provider: "apple", idToken: { token, nonce } })`. Set
  `appBundleIdentifier` to your bundle ID. Your users stay in your Convex
  database. It is version 0.x, so read the migration notes when you update.

**Convex Auth**, Convex's own library, is in beta and "may change in
backward-incompatible ways" (its docs). I did not find a native Apple ID-token
flow in its docs. The Convex agent plugin tends to suggest it. Tell your agent
you want the native Apple sheet, and point it at one of the two above.

**Account deletion.** Neither Convex nor Better Auth revokes Apple tokens for
you. I could not confirm whether Clerk does. Write a Node action
(`"use node"` at the top of the file) that does steps 3 to 6 of
[sign-in-with-apple.md](sign-in-with-apple.md), step 6. The `jose` code there
works as it is.

### Secrets and AI calls: actions

Set a secret per deployment:

```bash
npx convex env set LLM_API_KEY            # development; it asks for the value
npx convex env set LLM_API_KEY --prod     # production
```

The command asks for the value, so it stays out of your shell history. You
can also pipe it in from your secrets tool. Read it with
`process.env.LLM_API_KEY` inside an action. Only actions can
call the outside world:

```ts
// convex/ai.ts
import { action } from "./_generated/server";
import { v } from "convex/values";

export const ask = action({
  args: { prompt: v.string() },
  handler: async (ctx, { prompt }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    // Check and count the user's AI budget here, in one mutation (see below).
    const res = await fetch(`${process.env.LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.LLM_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.LLM_MODEL,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Model call failed: ${res.status}`);
    const data = await res.json();
    return data.choices[0].message.content as string;
  },
});
```

The budget check must be a mutation, not a query: a mutation checks and
counts in one transaction. The code is in
[hosted-ai-limits.md](hosted-ai-limits.md#convex).

The values match [llm-api-key.md](llm-api-key.md). For a chat that streams,
the usual Convex way is to write the answer into a table as it arrives. The
app's `useQuery` then shows it live.

### RevenueCat

Webhooks go to an HTTP action. Its URL ends in `.convex.site`, not
`.convex.cloud`.

```ts
// convex/http.ts
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

// Hash both sides, then compare every byte: the time does not depend on
// where they differ. An empty or missing secret never matches.
async function sameSecret(given: string | null, expected: string | undefined) {
  if (!given || !expected) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([given, expected].map((s) => crypto.subtle.digest("SHA-256", enc.encode(s))));
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

http.route({
  path: "/revenuecat",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!(await sameSecret(req.headers.get("Authorization"), process.env.REVENUECAT_WEBHOOK_AUTH))) {
      return new Response("unauthorized", { status: 401 });
    }
    const { event } = await req.json();
    await ctx.runMutation(internal.billing.recordEvent, { event }); // you write this
    return new Response(null, { status: 200 });
  }),
});

export default http;
```

In RevenueCat, the webhook URL is
`https://<your-deployment>.convex.site/revenuecat`. Call `Purchases.logIn`
with the same user ID your Convex functions use.

## Firebase

### Setup with Expo

Firebase has two SDKs for an Expo app. Expo's guide compares them:
https://docs.expo.dev/guides/using-firebase/.

- **The Firebase JS SDK** (`firebase`, version 12 or later). Works in Expo
  Go. No native code.
- **React Native Firebase** (`@react-native-firebase/*`). Native SDKs, needs
  a development build. It has `revokeToken` for Apple, which the account
  deletion step needs.

For an iOS app with Sign in with Apple, use React Native Firebase:

1. Make a Firebase project, and a second one for development. Add an iOS app
   with your bundle ID. Download `GoogleService-Info.plist`.
2. `npx expo install @react-native-firebase/app @react-native-firebase/auth
   @react-native-firebase/firestore expo-build-properties`.
3. In the app config: `ios.googleServicesFile` points at the plist, and the
   plugins list has `@react-native-firebase/app`, `@react-native-firebase/auth`
   and `expo-build-properties` with `"ios": { "useFrameworks": "dynamic" }`.
   React Native Firebase's own docs (https://rnfirebase.io) have the current
   list. Older guides say `"static"`; the current docs say `"dynamic"`.
4. Make a new development build.

Upgrade to **Blaze** before you write server code. On Spark you can run
functions in the local emulator, but not deploy them. Since 2026-02-03, Cloud
Storage needs Blaze too.

The plist is not a secret. Different plists for development and production
are the easiest way to keep the two projects apart.

### Keep each user's data apart: Security Rules

Firestore Security Rules decide who reads and writes each document. Start
from "deny all", then allow each user their own documents:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

Keep the rules file in git and deploy it with `firebase deploy --only
firestore:rules`. Test rules in the emulator before you deploy.

### Sign in with Apple

1. Turn on the capability and add `expo-apple-authentication`, as in
   [sign-in-with-apple.md](sign-in-with-apple.md), step 1.
2. In the Firebase console: **Authentication**, **Sign-in method**, **Apple**.
   Turn it on. Fill in the Services ID and the **OAuth code flow
   configuration** (Team ID, Key ID and the Sign in with Apple private key).
   Firebase's docs say token revocation needs these fields.
3. In the app, get the Apple credential with a hashed nonce (the same code as
   the Supabase section). Then:

```ts
import { getAuth, AppleAuthProvider, signInWithCredential } from "@react-native-firebase/auth";

const appleCredential = AppleAuthProvider.credential(credential.identityToken, nonce); // raw nonce
await signInWithCredential(getAuth(), appleCredential);
```

**Account deletion.** Ask for a fresh `authorizationCode` (call
`signInAsync` again), then call `revokeToken(getAuth(), authorizationCode)`,
then delete the user and their data. Firebase does not store Apple tokens,
so it needs that fresh code.

### Secrets and AI calls: Cloud Functions

```bash
firebase functions:secrets:set LLM_API_KEY    # it asks for the value
```

A callable function gets the signed-in user for free:

```ts
// functions/src/index.ts
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";

const llmKey = defineSecret("LLM_API_KEY");

export const ask = onCall({ secrets: [llmKey] }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const uid = request.auth.uid;
  // check and count uid's AI budget (see below), then call the model with llmKey.value()
});
```

The secret is only visible to functions that list it in `secrets`. Raise
`timeoutSeconds` on the function if your model is slow.

The budget check is a Firestore transaction in the function. The code, the
rules and App Check are in [hosted-ai-limits.md](hosted-ai-limits.md#firebase).

### RevenueCat

Two ways:

- **Your own webhook:** an `onRequest` HTTPS function that checks the
  `Authorization` header, as in the Supabase example.
- **RevenueCat's Firebase extension.** It writes purchase events and
  customer data to Firestore and can set entitlements as Firebase Auth
  custom claims. It needs Blaze, and the RevenueCat app user ID must be the
  Firebase UID. See
  https://www.revenuecat.com/docs/integrations/third-party-integrations/firebase-integration.

## Skills and tools for your agent

Each vendor publishes its own agent tooling. Install the one for your
backend before your agent writes backend code. Every repo below was checked
on 2026-09-28.

| Tool | What it does | Install | Licence |
|---|---|---|---|
| Supabase agent skills, https://github.com/supabase/agent-skills | `supabase` (all products, auth, RLS, CLI) and `supabase-postgres-best-practices` | `npx skills add supabase/agent-skills`, or in Claude Code: `claude plugin marketplace add supabase/agent-skills`, then `claude plugin install supabase@supabase-agent-skills` | MIT |
| Supabase MCP server, https://github.com/supabase/mcp | Lets the agent read the schema, run SQL, read logs and deploy functions | Hosted at `https://mcp.supabase.com/mcp`; it logs you in with OAuth. Add `?project_ref=<ref>&read_only=true` to limit it | Apache-2.0 |
| Supabase plugin, https://github.com/supabase-community/supabase-plugin | The skills plus the MCP server in one plugin, for Claude Code, Cursor, Codex and others. Listed in Anthropic's official directory | `/plugin install supabase@claude-plugins-official` | No licence file |
| Convex agent skills, https://github.com/get-convex/agent-skills | `convex`, `convex-quickstart`, `convex-setup-auth`, `convex-migration-helper`, `convex-performance-audit`, `convex-create-component` | `npx skills add get-convex/agent-skills` | Apache-2.0 |
| Convex AI files, https://docs.convex.dev/ai | Convex's rules for agents, written into `AGENTS.md` / `CLAUDE.md` | `npx convex ai-files install` | (part of the `convex` package, Apache-2.0) |
| Convex MCP server, https://docs.convex.dev/ai/convex-mcp-server | Tables, data, function specs, logs, environment variables. Production is read-only unless you allow more | `npx -y convex@latest mcp start` | Apache-2.0 |
| Convex plugin for Claude Code, https://github.com/get-convex/convex-backend-skill | Skills, a `convex-expert` subagent, an error monitor and the MCP server | `/plugin install convex@claude-plugins-official` | No licence file |
| Firebase agent skills, https://github.com/firebase/agent-skills | Firebase skills for many agents; also a Claude Code, Codex and Gemini CLI plugin | `npx skills add firebase/skills`, or `claude plugin marketplace add firebase/skills`, then `claude plugin install firebase@firebase` | Apache-2.0 |
| Firebase MCP server, part of https://github.com/firebase/firebase-tools | Firestore, Auth, rules, functions and more, through the Firebase CLI's login | `npx -y firebase-tools@latest mcp`, or `/plugin install firebase@claude-plugins-official` | MIT |
| Clerk skills, https://github.com/clerk/skills | Includes `clerk-expo`, for Clerk in an Expo app | `npx skills add clerk/skills` | No licence file |
| Appwrite skills, https://github.com/appwrite/skills | Per-language SDK skills (`appwrite-typescript` and others) | `npx skills add appwrite/agent-skills` | BSD-3-Clause |
| Appwrite MCP server, https://github.com/appwrite/mcp | Hosted MCP server for your Appwrite projects | `claude mcp add --transport http appwrite https://mcp.appwrite.io/`, or `/plugin install appwrite@claude-plugins-official` | MIT |
| Neon agent skills, https://github.com/neondatabase/agent-skills | Neon Postgres, Neon Auth, branches | `npx skills add neondatabase/agent-skills`, or `/plugin install neon@claude-plugins-official` | Apache-2.0 |
| Neon MCP server, https://github.com/neondatabase/mcp-server-neon | Projects, branches, SQL | Hosted at `https://mcp.neon.tech/mcp`; add `?readonly=true` to limit it | MIT |
| PlanetScale plugin, https://github.com/planetscale/claude-plugin | Hosted MCP server and database skills | `/plugin install planetscale@claude-plugins-official` | Apache-2.0 |

Notes:

- `npx skills` is the open skills installer from
  https://github.com/vercel-labs/skills (MIT). It works with most coding
  agents. The skills directory at https://skills.sh lists what it can install.
- `claude-plugins-official` is Anthropic's plugin directory for Claude Code:
  https://github.com/anthropics/claude-plugins-official. The plugins above
  point at the vendors' own repos.
- "No licence file" means GitHub shows no licence for that repo. You can
  still install and use it. Do not copy its files into your own repo.
- **An MCP server can change your data.** Connect it to the development
  project first. Use the read-only options for production.
- RevenueCat's tools are in [revenuecat.md](revenuecat.md).

## Moving to the box later

The hard part of a move is not the data. It is your users' logins and the
code that talks to the vendor's SDK.

**Keep the Apple `sub`.** Apple gives each user the same `sub` for all apps in
your team. The box's backend finds users by that `sub`
([sign-in-with-apple.md](sign-in-with-apple.md), step 4). If you know each
user's `sub`, they sign in on the new backend and land on their own account.
You can read it here:

- Supabase: `auth.identities.provider_id` for the Apple identity.
- Firebase: the Apple entry in the user's `providerData`.
- Clerk: the user's Apple external account.
- Better Auth: its `account` table.

Better still: copy the `sub` into your own `users` table from day one.

**By vendor:**

- **Supabase.** The database is plain Postgres. `pg_dump` your tables, and
  load them into the box's Postgres. RLS policies stay useful, but the box's
  API replaces them with its own checks. Swap `supabase-js` calls in the app
  for calls to your API. Supabase is also open source (Apache-2.0) and runs
  in Docker, but self-hosting it is a larger stack than the box's one API and
  one database.
- **Convex.** `npx convex export --path backup.zip` writes a snapshot of
  your data to a zip file. Add `--include-file-storage` for your files. The backend is open source
  (https://github.com/get-convex/convex-backend, licence FSL-1.1-Apache-2.0),
  so you can run it on the box and keep your code. Moving to Postgres and a
  normal API means you rewrite the functions.
- **Firebase.** `firebase auth:export` exports users. Firestore exports go to
  a Cloud Storage bucket (Blaze). Documents do not map one to one onto
  tables, so plan a data model rewrite, not a copy.

In every case, ship an app version that talks to the new backend, keep the
old one running until most users have updated, then turn it off.

## Where the values go

| Value | Secret? | Where |
|---|---|---|
| Supabase URL, publishable key (`sb_publishable_...`) | no | `eas.json` `env`, per profile |
| Supabase secret key (`sb_secret_...`) or the legacy `service_role` key | **yes** | your secrets tool; Edge Functions get it by default. Never in the app |
| Convex deployment URL | no | `eas.json` `env` (`EXPO_PUBLIC_CONVEX_URL`) |
| Convex deploy key (for CI) | **yes** | your secrets tool, as `CONVEX_DEPLOY_KEY` in CI |
| `GoogleService-Info.plist` | no | the repo, one per Firebase project |
| Firebase service account key | **yes** | avoid it; Cloud Functions do not need one |
| LLM key, RevenueCat webhook value, `APPLE_SIGNIN_PRIVATE_KEY` | **yes** | the vendor's function secrets, loaded from your secrets tool ([secrets.md](secrets.md)) |

Add the vendor's secret key pattern to the bundle check in
[expo-app.md](expo-app.md) (step 8), for example `sb_secret_`.

## Check it works

1. Install a development build on your iPhone. Sign in with Apple. A new user
   appears in the vendor's dashboard (Supabase: Authentication, Users;
   Convex with Clerk: the Clerk dashboard; Firebase: Authentication).
2. Sign out and in again. It is the same user.
3. Try to read another user's data: sign in as a second test user and
   request the first user's row by its ID. You get nothing or an error.
4. Call the AI function without signing in. It refuses.
5. Make a sandbox purchase. The webhook function logs the event with
   **your** user ID ([revenuecat.md](revenuecat.md)).
6. Delete the account in the app. The user is gone from the dashboard, and
   your app is gone from the list of apps that use Sign in with Apple in your
   Apple Account settings on the phone.
7. Build a `production` profile build and check that it talks to the
   production project, not the development one.

## Common errors

- **Sign-in fails with an audience error.** The token's `aud` is your bundle
  ID, and the backend expects something else. On Supabase, add the bundle ID
  to the Apple provider's Client IDs. On Better Auth, set
  `appBundleIdentifier`. In Expo Go the bundle ID is Expo Go's own: use a
  development build.
- **Nonce mismatch.** Apple must get the hashed nonce, and the backend the raw
  one. Hash it once only.
- **Everyone can read every row (Supabase).** A table has no RLS. Turn it on
  and add a policy. The Security Advisor lists such tables.
- **Every read fails with no error, or returns nothing (Supabase).** RLS is on
  and there is no policy for that operation yet. RLS with no policy denies
  everything.
- **The app stops working after a quiet week (Supabase Free).** The project
  was paused. Restore it in the dashboard. Do not run a paid app on a Free
  project.
- **The RevenueCat webhook gets 401 (Supabase).** The function still checks
  for a Supabase JWT. Set `verify_jwt = false` for that function and check
  RevenueCat's header in your code.
- **`ctx.auth.getUserIdentity()` is always `null` (Convex).**
  `convex/auth.config.ts` is not deployed to that deployment, its
  `applicationID` does not match the token's `aud`, or the app uses
  `ConvexProvider` instead of the auth provider.
- **The production app shows development data (Convex).** The `production`
  profile in `eas.json` has the development deployment's URL.
- **`firebase deploy` refuses to deploy functions.** The project is on Spark.
  Upgrade to Blaze.
- **Storage calls return 402 or 403 (Firebase).** Since 2026-02-03, Cloud
  Storage needs Blaze.
- **The app crashes at start with React Native Firebase.** It runs in Expo
  Go. React Native Firebase needs a development build.
- **App Review rejects under 5.1.1(v).** Account deletion only signs out, or
  it does not revoke the Apple token. See the account deletion part of your
  backend's section.
- **A server function times out.** The work is longer than the function's
  limit. Split it into steps, stream the answer, or move that one job to the
  box.
