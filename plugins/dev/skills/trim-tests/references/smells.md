# Test smells: what to cut, what to keep

Short examples of each kind of waste, and what to do with it.

## Duplicates and overlap

```ts
it("formats 1 kg", () => expect(formatKg(1)).toBe("1 kg"));
it("formats 2 kg", () => expect(formatKg(2)).toBe("2 kg"));
it("formats 3 kg", () => expect(formatKg(3)).toBe("3 kg"));
it("formats 0.5 kg", () => expect(formatKg(0.5)).toBe("0.5 kg"));
```

`1`, `2` and `3` are one equivalence class. Keep one of them, plus the cases
that differ: zero, a fraction, a rounding boundary, a negative number.

```ts
it.each([
  [2, "2 kg"],
  [0, "0 kg"],
  [0.5, "0.5 kg"],
  [18.182999, "18.2 kg"],   // rounding: this shipped unrounded once
])("formatKg(%s) is %s", (v, out) => expect(formatKg(v)).toBe(out));
```

.NET: the same with `[Theory]` and `[InlineData(...)]`.

Overlap across layers is also common. Several tests check one rule: a unit
test, a component test and an API test. Keep the cheapest test that fully
checks the rule. Keep the API test when the rule depends on the database or
the HTTP pipeline (auth, query filters, validation).

## Tests of the mock

```ts
repo.getUser.mockResolvedValue({ id: "u1", name: "Ada" });
const user = await repo.getUser("u1");
expect(user.name).toBe("Ada");          // tests the mock, not the code
```

Delete. No line of the app ran.

## Implementation details

```ts
await saveProfile(form);
expect(api.put).toHaveBeenCalledWith("/profile", { name: "Ada" });
expect(normalize).toHaveBeenCalledTimes(1);
```

The second assertion breaks on every refactor and catches no bug. Assert what
the user or the caller gets: the saved profile, the screen text, the HTTP
response. Keep a call assertion only when the call **is** the behaviour (a
payment is charged exactly once, an analytics event is sent).

## Snapshot noise

A 400-line snapshot of a screen, updated with `-u` in the same commit as every
change to that screen. No one reads the diff, so it catches nothing. Check the
history:

```bash
git log --format=%h -- 'src/**/__snapshots__/*.snap' | wc -l
```

Replace each large snapshot with one or two assertions on what matters: the
title, the empty-state text, the disabled button. Keep a small snapshot of
pure data (a serialized request body) if it is stable.

## Trivial tests

- Getters, setters, constructors, `record` equality.
- A constant equals itself.
- A mapper that copies fields one to one, tested field by field.
- The framework: EF Core saves a row, React renders a `View`, Zod parses a
  valid object.

Delete, unless the coverage diff shows they are the only test of those lines.
Then those lines probably need one real test, not a trivial one.

## Old skips and flaky tests

- `it.skip`, `xit`, `describe.skip`, `[Fact(Skip = "...")]` older than a few
  months. Fix them or delete them. A skipped test is a comment that looks like
  a test.
- A test that uses `SkippableFact` and skips on every machine but CI. Check
  that CI really runs it (the CI log says "Skipped: 0").
- A flaky test: find the cause (time zone, current time, test order, shared
  database rows, a real network call). Fix it with a fixed clock, its own data
  or a fake HTTP handler. Delete it only if another test covers the same rule,
  and say so.

## Keep these, even when they look redundant

- A regression test for a real past bug, even if it looks like a duplicate.
  The duplicate input is often the exact shape that broke.
- Two-user isolation tests: user B asks for user A's row and gets 404.
- Architecture tests that walk the model or the routes (every owned table has
  a filter, every endpoint requires auth unless it is on the allow list).
- Time zone and DST tests, and tests pinned to a locale.
- Tests of money, subscriptions and entitlements.
- The one test that runs a migration against a real database.
