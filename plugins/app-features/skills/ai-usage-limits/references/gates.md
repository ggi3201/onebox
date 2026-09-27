# Gates

## One gate, every spender

Every endpoint that reaches a model spends money: the chat, a photo reader,
an import, a "suggest" button, a background job. Each one:

1. validates input (400),
2. asks `IAgentAccess.CheckAsync` (403 consent / 402 subscription / 429 budget),
3. calls the model,
4. records usage.

The app's own checks are presentation. The server is the enforcement.

## Finding the family

A test that lists spenders by a code pattern ("handlers that call
`GetRequiredService<AgentLoop>`") misses the next one written differently. It
happened: a new endpoint took the model client as an injected parameter,
matched none of the patterns, and let unentitled accounts call a model forty
times an hour.

**Derive the family from the dependency.** Collect every type that takes the
model client (`ChatClient`, `IOpenAIService`, your wrapper) and treat any
endpoint that reaches one as a spender. Then assert each spender is gated.
Two traps when you write that test:

- Match declarations, not text. A scan of the source finds the comment that
  explains the test.
- An endpoint body in `Program.cs` runs to the next `app.Map…`; the LAST one
  runs to the end of the file. Bound your scan.

## Never inject the model client into an endpoint

Minimal-API parameters are built BEFORE the handler body runs. If the client
throws without a key, every request dies at DI with a 500, before the cheap
400 that refuses a huge body. A developer machine has a key, so it only shows
in CI. Take `IServiceProvider` and resolve the client after the checks. Keep a
test for it.

## Background jobs

A job has no request, so gate it where it is scheduled: skip users who are
over budget or not entitled (`UsageService.CurrentAsync`, `ISubscriptions`)
before you enqueue, and again when the job starts.

## Rate limits

- Per ACCOUNT for anything behind sign-in.
- Per IP only before there is an account (sign-up, sign-in, webhooks), and
  only with forwarded headers set up. Behind Traefik, `RemoteIpAddress` is
  the proxy, so a per-IP limit is one bucket for the whole internet.
- A partitioned limit is only tested by a test with more than one partition.
  `TestServer` leaves `RemoteIpAddress` null, so every test comes from the same
  nowhere. Set it from a header in a test-only startup filter, then test two
  clients.
- Polling endpoints (job status) get their own, looser bucket. Charging polls to
  the AI bucket starves the AI features.
