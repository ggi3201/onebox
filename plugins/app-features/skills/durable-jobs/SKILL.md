---
name: durable-jobs
description: Run slow work (an import, a long model call, image generation) as a background job in your own API and Postgres - leased and fenced so two instances never run one job, heartbeats so Cancel reaches a running job in seconds, at-most-once for work with side effects, quota refunded exactly once on failure, a push when done, and an Expo hook that polls in the foreground and resumes after a relaunch. ASP.NET Core template. Use when the user says "this request times out", "Cloudflare 524", "move the import to a background job", "the user closes the app and the import is lost", "add a job queue", "show progress while it works", or "cancel a running AI call".
---

# Durable jobs

Runs on: your Mac (code); the worker runs inside your API on your box.

An HTTP request is the wrong home for work that takes 30 seconds or more.
Cloudflare returns 524 after about 100 s; the phone goes to sleep; the person
closes the app. A job row in Postgres outlives all three. No broker: Postgres
is already there, and one box needs no more.

```
POST /api/jobs/import {input} ──> row Queued ──> JobWorker claims it (lease)
                                                 │  heartbeat every 5 s
app polls GET /api/jobs/{id} (foreground)  <─────┤  progress line, fenced
push "done" ────────────────────────────────────>┘  Completed / Failed (refund once)
DELETE /api/jobs/{id} ──> Cancelled; the worker's next heartbeat stops the work
```

## Before you touch anything

```bash
grep -rnE 'BackgroundService|IHostedService|Hangfire|Quartz|Channel<' apps/api --include=*.cs | head
grep -rnE 'Timeout|CancelAfter|HttpClient' apps/api --include=*.cs | grep -iE 'ai|import|scrape|image' | head
```

If the app already has a job runner, add the lease, fence and refund rules to
it instead of a second one. Find the slow endpoint to move, and ask: **does
running it twice cause harm?** (creates a second row, spends twice). That sets
`SafeToRetry`.

## Steps

1. **Copy** `assets/dotnet/Jobs/` into the API. Map `JobModel.Map(b)` in the
   DbContext and add a migration. `builder.Services.AddHostedService<JobWorker>();`
   and `app.MapJobs();`. Without `agent-harness`, delete the `IAgentAccess`
   lines in `JobEndpoints.cs` and gate there directly.
2. **Write the handler** for the slow work: `IJobHandler` with a `Kind`,
   `SafeToRetry`, `Validate` (runs before anything is spent) and `RunAsync`.
   Pass the `CancellationToken` to EVERY call inside, model calls included:
   without it, Cancel and a lost lease stop nothing and the model calls run on.
   Throw `JobFailedException("a sentence for the person")` for known failures.
3. **Progress.** Call `progress.ReportAsync("Reading the page", ct)` between
   steps. It returns false when the job is no longer yours: stop then.
4. **Refunds.** If starting a job takes from a quota, implement `IJobRefunds`.
   The worker calls it once per job, on the move to Failed (and on cancel of a
   job that never started).
5. **Done notification.** Implement `IJobNotifier` with the app's push service.
   It runs only after the Completed write landed, and should open the result
   when tapped. Check the push handler: an app that sets
   `Notifications.setNotificationHandler` in two modules gets the behaviour of
   whichever loaded last, for every notification.
6. **App.** Copy `assets/mobile/useJob.ts`, wire `jobsApi`, and call
   `clearJobPointers()` on sign-out. Show `job.progress`, a Cancel button, the
   result, or `job.error` (already a sentence).
7. **Rate limits.** The start endpoint gets the AI bucket; the GET gets its
   own, looser polling bucket.
8. **Check it.** Start a job and kill the API mid-way: after the lease (5 min)
   the sweep marks it Failed and refunds. Start one and tap Cancel: the worker
   log says "no longer ours" within about 5 s. Start one, close the app, open
   it: the screen picks the job up again.

## Rules

1. Every worker write is fenced: `WHERE Id = @id AND LeaseId = @mine AND Status = Running`.
   Zero rows means someone else decided; do not overwrite.
2. At-most-once unless `SafeToRetry`. A crash after the side effect and before
   the result write must not replay an import.
3. Refund exactly once: only the transition that flips `Refunded` refunds.
4. `Error` holds a sentence for the person. Exception text goes to the log.
5. Keep `Input` small (a URL, a few fields). A 5 MB base64 photo in a row kept
   30 days is a storage bill; upload the file first and pass its key.
6. One worker per instance, one job at a time. That is plenty on one box; add
   workers (or instances) only when a queue actually builds up.

More: `references/lease.md`.
