# A dev database with the edge cases in it

Most UI bugs come from data shape, not from code paths. They show up for a
long name, an empty account, an emoji or a date on the wrong side of midnight.
The happy-path demo account never has any of those. So the dev seed must have
them, and the agent must look at them in the simulator.

## Rules

- **Development only.** The seed runs when the environment is Development,
  never in Production. Guard it in code, and add a test that fails if it runs
  in Production.
- **Idempotent.** Running it twice gives the same database. Use fixed ids and
  upserts, not "insert if the table is empty".
- **Deterministic.** No random data. Use fixed dates for the calendar cases
  (DST, leap day). Compute "today" and "yesterday" from the clock only for
  cases that must be recent.
- **Named users, fixed ids.** Each user exists for one reason, and the name
  says it. Flows and tests refer to them by name.
- **A dev-only sign-in.** Sign in with Apple does not work in the Simulator. A
  Development-only endpoint (for example `POST /api/auth/dev` with a user
  name) returns a token for a seed user. It must not exist in a Production
  build: register it only when the environment is Development, and test that
  it returns 404 in Production.
- **One source for shapes.** Build seed rows and test fixtures with the same
  helper functions, so they cannot drift apart.

## The users

| User | Has | Catches |
|---|---|---|
| `dev-empty` | nothing, first launch | empty states, onboarding, "no data" crashes |
| `dev-one` | exactly one of each thing | singular text ("1 items"), lists of one |
| `dev-rich` | two pages and more of each list | pagination, scroll, performance, sorting |
| `dev-edge` | the odd text, numbers and images below | layout, encoding, formatting |
| `dev-expired` | a subscription that ended yesterday | paywall gates, "restore", stale entitlements |
| `dev-other` | its own data, with names like `dev-rich`'s | data leaking between users |
| `dev-far` | profile time zone `Pacific/Auckland` (UTC+12/+13) | "today" on the server vs on the phone |

## The checklist

Put at least one row for each line in `dev-edge` (or in the user named).

**Empty and small**
- [ ] No rows at all (`dev-empty`).
- [ ] Exactly one row (`dev-one`).
- [ ] A parent with no children (a list with no items).

**Many**
- [ ] Page size × 2 + 1 rows, so a third page exists (`dev-rich`).
- [ ] Two rows with the same sort key (the same name, the same timestamp).
  Pagination by offset repeats or skips them.

**Text**
- [ ] A very long name: 120 characters with spaces, and one 60-character word
  with none (`Supercalifragilistic...`). One wraps, the other must truncate.
- [ ] Emoji, including a sequence of several code points: `👩🏽‍💻`, `🏳️‍🌈`.
  Check that length limits count them as one character.
- [ ] Right-to-left text: Arabic `قائمة التسوق`, Hebrew `רשימת קניות`.
- [ ] Accents, in both Unicode forms: `Zoë` as one code point (NFC) and as
  `e` plus a combining mark (NFD). Search must find both.
- [ ] CJK text: `買い物リスト`.
- [ ] A name with only spaces, and one with leading and trailing spaces.
- [ ] Multiline text in a field that is meant to be one line.
- [ ] HTML- and SQL-looking text: `<b>bold</b>`, `'; DROP TABLE x;--`. It must
  show as plain text.

**Numbers and money**
- [ ] Zero, a negative number, and a very large number (`1234567.89`).
- [ ] A price in a currency with no decimals (JPY) and one with three (KWD).
- [ ] A device locale that writes decimals with a comma.

**Images and files**
- [ ] A row with no image (`null`).
- [ ] A row whose image URL returns 404.
- [ ] A very large image, and a very tall one.

**Dates and time zones**
- [ ] An event at 23:30 and one at 00:30 local time. They belong to
  different days.
- [ ] Events on both DST change days of the zone you test in (for example the
  last Sundays of March and October in the EU, the second Sunday of March and
  first Sunday of November in the US).
- [ ] 29 February.
- [ ] A user whose time zone is far from the server's (`dev-far`).

**Accounts and money**
- [ ] Never subscribed, active, expired (`dev-expired`), and in a billing grace
  period, if your provider has one.
- [ ] A soft-deleted row, and an account that asked for deletion.

**Two users**
- [ ] `dev-other` owns rows with the same names as `dev-rich`. Sign in as one
  and search for the other's rows: nothing may show. The API test for the same
  rule is in the backend guide:
  `guides/backend.md`, section "Keep each user's data apart" (user B asks for
  user A's row and gets 404).

Pin the test runner's time zone too. Set `TZ` to a zone with DST (for example
`Europe/Berlin` or `America/New_York`) in the test config. Date code that only
ever runs in UTC is date code nobody has tested.

## Grow it from real bugs

Use your own app every day. When you find a bug:

1. Find the data that caused it.
2. Write a test that fails for that data. Watch it fail.
3. Fix the code. Watch the test pass.
4. If the bug needed a data shape the seed does not have, add a seed row.
   Put a one-line comment above it: the date and what broke.
   ```csharp
   // 2026-03-29: streak reset on the DST change day. See StreakTests.DstDay.
   ```
5. If a flow would have caught it, add a step to the flow.

Every fixed bug leaves a test, a seed row, or both. The seed then grows toward
the data your real users have.

## A sketch

ASP.NET Core, called at startup:

```csharp
public static class DevSeed
{
    public static async Task EnsureAsync(AppDb db, IHostEnvironment env)
    {
        if (!env.IsDevelopment()) return;              // never in Production

        await Upsert(db, User("dev-empty"));
        await Upsert(db, User("dev-edge"),
            List("l-long",  new string('a', 60)),       // one word, no spaces
            List("l-emoji", "Weekend 👩🏽‍💻 🏳️‍🌈"),
            List("l-rtl",   "قائمة التسوق"),
            List("l-nfd",   "Zoë"));             // e + combining diaeresis
        // ...
        await db.SaveChangesAsync();
    }
}
```

Node (Prisma or Drizzle): a `scripts/seed.ts` run by a `db:seed` script, with
`if (process.env.NODE_ENV === "production") throw new Error("no seed in production")`
as the first line. Use `upsert` with fixed ids.

Add a `db:reset` script that drops the dev database, migrates, and seeds. The
agent runs it before a flow that needs a known state.
