# No accounts

Without sign-in there is no user id. This skill keys the gate, the budget
and the `agent` rate limit on the token's `sub`. With no token, the rate
limit counts per client IP, and the budget has no one to count.

Be honest with the user: without accounts, AI limits can only count per
device and per IP, and a person can reset both. A reinstall or a script
gets a new id; a new network gets a new IP. The limits slow abuse down. They
do not stop a determined person. Sign in with Apple makes the limits hold,
and it is the cheap fix.

If the app stays without accounts, do four things.

1. **A per-install id, issued by the server.** On first launch the app calls
   one endpoint (for example `POST /api/install`). The server makes 32
   random bytes, stores only their SHA-256 hash, and returns the id. The app
   keeps it with `expo-secure-store` and sends it as a header on every AI
   call. The server looks up the hash and uses `install:<row id>` wherever
   this skill uses the user id: `IAgentAccess.CheckAsync`,
   `IUsageRecorder.RecordAsync` and the rate-limit partition. Refuse an id
   the server did not issue (401). Otherwise a script sends a new made-up id
   with every request, and each one starts with a full allowance.
2. **A per-IP limit.** Strict on the id endpoint (for example 10 per hour per
   IP), so a script cannot mint ids in a loop. Loose on the AI endpoints, as a
   backstop only: a mobile carrier puts many phones behind one address. A
   per-IP limit needs the real client IP first (backend guide, "Protect the
   API", part 1). Without it, every request has the proxy's address, and the
   limit is one bucket for the whole internet.
3. **A lower cap, by the day.** A new id costs nothing, so a month is a long
   window for one. Count calls per install per day (the `ai_usage` table in
   the backend guide, "Protect the API", part 3), with a lower limit than
   you would give an account.
4. **The app-wide budget is the real backstop.** Every call's cost is
   recorded. Before each call, compare today's total over all installs with
   a daily budget, and answer "unavailable, try later" above it (the backend
   guide, part 3, cap 3). The rest of the app keeps working. Also set a
   spend limit or an alert in the AI provider's console: it works even when
   your own code fails.

Tell the user the daily budget, and that it, not the per-install cap, is
what bounds the bill.

Guide: https://onebox.lokkesveen.com/guides/backend.md ("Protect the API").
