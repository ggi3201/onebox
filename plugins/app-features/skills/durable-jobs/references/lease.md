# Leases, fences and why

## The states

```
Queued ──claim──> Running ──fenced write──> Completed | Failed
   │                 │  └─ lease expires ─> Failed (or Queued, if SafeToRetry and attempts < 3)
   └──cancel──> Cancelled <──cancel── (clears the lease; the heartbeat notices)
```

## Claim

One conditional `UPDATE … WHERE Id = @id AND Status = 'Queued'`. During a
rolling deploy two instances can both read the same queued row; only one
update matches. Read a few candidates and try each, so two workers do not
fight over the same oldest row.

## Lease and heartbeat

- The claim writes a random `LeaseId` and an expiry (5 min).
- Every 5 s the worker renews: `UPDATE … SET LeaseExpiresAt = … WHERE Id AND LeaseId AND Running`.
- **Zero rows renewed** means cancelled or taken over. That is authoritative:
  cancel the work before it does another side effect.
- **An exception** while renewing (a database blip) is not a loss. Keep
  working and retry until the last CONFIRMED expiry, then stop. Compute the new
  expiry BEFORE the write, so the local idea of the lease is never later than
  the database's.
- The short heartbeat is also how Cancel from the phone reaches a running job:
  the endpoint clears the lease, the next renewal matches nothing.

## Why at-most-once

A crash can happen after the import created its row and before the job wrote
Completed. Replaying it creates a second copy and spends a second model call.
So an expired lease FAILS the job with "It was interrupted. Please start it
again." The person can start it again; a duplicate is worse than a retry tap.

Only a handler that is truly idempotent (it creates nothing, or checks first)
registers it with `safeToRetry: true`; then an expired lease re-queues it, up to three attempts.

## Refund once

A job that takes a free import and then fails should give it back. The
transitions that can fail a job are three: the worker, the lease sweep, and
the shutdown path. Each one is fenced, and the refund itself flips a
`Refunded` flag with a conditional update. Only the call that flips it
refunds. A cancel of a job that never started refunds too; a cancel of a
running job is your call (it may already have spent money).

## Authorisation inside the worker

Claims in a token are a point-in-time answer. If users can lose access (a
shared space they are removed from, a deleted account), check membership again
when the job starts and before you deliver the result or the push.

## Polling, push, or a stream

- **Polling** (1.5 s, foreground only) is the default: it survives app
  restarts and needs nothing on the server beyond the GET.
- **A push** when it completes covers the app being closed. Send it only
  after the Completed write landed.
- **A live stream** (SSE) of progress is nicer for a job the person watches.
  If you add one, the stream wins while the job runs and the server row wins
  once it is terminal: the row is the whole answer only then. Mixing two
  writers on one cache entry without that rule made a progress timeline
  vanish mid-run in one app.

## Housekeeping

- Delete terminal jobs after 30 days (the worker does, every 12 hours).
- An in-memory event broker for streams works on ONE instance only.
