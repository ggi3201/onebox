---
name: trim-tests
description: Cut a bloated test suite by about 20% while keeping its coverage and its power to catch real bugs. It measures coverage first, finds duplicate and overlapping tests, tests of implementation details or of mocks, snapshot noise, trivial getters and tests that cover nothing unique. It deletes or merges them, re-measures, and reports before and after (count, runtime, coverage). Works for Jest, Vitest and .NET (xUnit with coverlet). Use when the user says "trim the tests", "too many tests", "the test suite is slow", "clean up the tests", "remove useless tests", "dedupe tests", "the agent wrote too many tests", or asks which tests are worth keeping.
---

# Trim the test suite

Runs anywhere the tests run. For an Expo app with a .NET or Node backend,
that is your Mac, with Docker for the database tests.

Run this now and then, not on every change: every few months, when the suite
feels slow, or after an agent wrote a big batch of tests. Coding agents add
tests freely. Many of them repeat each other or check the mock instead of the
code.

The target is about 20% fewer tests. It is a target, not a quota. If only 8%
can go safely, stop at 8% and say so.

## Rules

- **Coverage must not drop.** No file may lose a covered line, unless you name
  the lines and say why they no longer need a test.
- **Keep every regression test for a real past bug.** If you want to remove
  one, name it and the bug in the report and ask first.
- **Always keep** tests of data isolation between users, auth, rate limits,
  money and subscriptions, migrations, and time zone or DST cases. Also keep
  architecture tests, such as "every owned table has a query filter".
- Work on a branch. Make one change per category, so each one is easy to
  revert. Commit only if the user asks.

## 1. Measure the baseline

Save everything outside the repo, for example in `$TMP/trim/before`.

**Vitest** (needs `@vitest/coverage-v8` as a dev dependency; ask before you add it):

```bash
npx vitest list --json | jq length                       # test count
npx vitest run --reporter=json --outputFile=$TMP/trim/before.json \
  --coverage --coverage.provider=v8 --coverage.include='src/**' \
  --coverage.reporter=json-summary --coverage.reporter=text-summary \
  --coverage.reportsDirectory=$TMP/trim/before
```

Pass `--coverage.include`. Without it, Vitest reports only the files that
some test loads, so a file whose last test you delete drops out of the total
instead of showing 0%.

**Jest:**

```bash
npx jest --json --outputFile=$TMP/trim/before.json \
  --coverage --coverageReporters=json-summary --coverageReporters=text-summary \
  --coverageDirectory=$TMP/trim/before
jq .numTotalTests $TMP/trim/before.json                    # test count
```

**.NET** (the test project needs the `coverlet.collector` package):

```bash
dotnet test <sln> --logger "trx;LogFileName=before.trx" \
  --collect:"XPlat Code Coverage" --results-directory $TMP/trim/before \
  -- 'DataCollectionRunSettings.DataCollectors.DataCollector.Configuration.ExcludeByFile=**/Migrations/*.cs'
```

The exclude keeps EF migrations out of the numbers. Without it, generated
migration code can make up half the lines. The summary line gives the count
and the duration.

Run the suite twice. A test that fails only sometimes is in scope: fix it, or
delete it and say so.

Slowest tests:

```bash
jq -r '.testResults[].assertionResults[] | "\(.duration)\t\(.fullName)"' $TMP/trim/before.json | sort -rn | head -20
grep -o '<UnitTestResult [^>]*>' $TMP/trim/before/before.trx \
  | sed -E 's/.*testName="([^"]*)".*duration="([^"]*)".*/\2  \1/' | sort -r | head -20
```

## 2. List what is protected

Before you look for waste, list the tests you must not touch:

```bash
# test files that a fix commit added or changed
git log --name-only --format='@@%s' -- '*.test.*' '*.spec.*' '*Tests.cs' \
  | awk '/^@@/{fix = tolower($0) ~ /fix|bug|regress|crash|leak/; next} fix && NF' | sort -u
```

In those files, the tests that the fix commits added are regression tests.
Add tests whose name or comment names a bug, an issue number or a date, and
the always-keep list from the rules. Show the list to the user.

## 3. Find the waste

Read `references/smells.md` for examples of each. In order of payoff:

1. **Duplicates and overlap.** Tests that call the same code with inputs of
   the same kind. Keep one per equivalence class, plus the boundaries. Merge
   the rest into one table test (`it.each`, `[Theory]` with `[InlineData]`).
2. **Tests of the mock.** Set the mock to return X, then assert X.
3. **Implementation details.** Asserting that a private helper or a mock was
   called, with which arguments, or in what order, when the result is what
   matters. Rewrite to assert the result, or delete if another test does.
4. **Snapshot noise.** Large snapshots that get updated with `-u` every time
   the component changes. Replace each with one or two assertions on what the
   user sees, or delete it.
5. **Trivial tests.** Getters, setters, constructors, constants, mapping that
   copies fields one to one, and framework behaviour (EF saves a row, React
   renders a `View`).
6. **Old skips.** `it.skip`, `xit`, `[Fact(Skip = ...)]`. Fix them or delete
   them.
7. **Slow tests that repeat a fast one.** An integration test that checks
   only what a unit test already checks. Keep the integration test when it is
   the only one that touches the real database or HTTP pipeline.
8. **Junk patterns.** Tests that cannot fail for the reason their name says:
   no assertion, a test of a copy of the code, an expected value made by the
   code under test, a mock that does the work, a negative case that passes
   for another reason. The full list is in `references/smells.md`.

A test that never failed and covers no line that other tests miss is a
candidate. Coverage tells you which: delete the candidates, re-measure, and
put back any test whose lines were lost.

### Evidence before you delete

Write down these fields for each candidate. A candidate with an empty field
is not ready to delete.

- The test: name, file and line, or the table row.
- What bug it can catch. "None" is a valid answer: say why.
- The test that stays and catches the same bug. Name it.
- Its history: why it was added (`git log -S '<test name>'`).
- What else the delete frees: a test-only export, a helper, a fixture.

"Same branch" is a claim, not proof. It fails often for one alternative of a
regex (`https?`), a type check (`Array.isArray`), and one value in a range
(`>= 500`). Step 5 checks it.

## 4. Re-measure

Run the same commands into `$TMP/trim/after`, then:

```bash
node <skill-dir>/scripts/coverage-diff.mjs $TMP/trim/before $TMP/trim/after
```

It reads Istanbul `coverage-summary.json` (Jest, Vitest) and Cobertura XML
(coverlet), merges several reports in a folder, and lists every file that lost
covered lines. For Cobertura it gives the line numbers. It exits 1 if any file
lost a covered line. Put back a test for each loss, or name it in the report.

## 5. Check that the rest still catches bugs

Coverage shows that lines run, not that a test would notice a bug in them. For
each area where you removed tests, make two or three small bugs by hand: flip
a condition, change `<` to `<=`, drop a filter, return early. Run the
remaining tests. Each bug must turn at least one test red. Revert every bug.
Show the reverted diff is empty (`git diff --stat` on those files).

If a bug survives, a deleted test was doing real work. Put it back.

To tell which, run the surviving bug against the original tests
(`git stash` the test changes, or check out the test files from `HEAD`). If
it survives there too, no deleted test caught it. A kept test is weak: it
passes for the wrong reason. Report it as a weak test, and offer to fix it.
Do not delete it to raise the count.

For a deeper check on one small module, use a mutation testing tool
(StrykerJS for JS and TS, Stryker.NET for .NET). They are slow on a whole
repo, so run them on one folder only.

## 6. Report

```
                before   after   change
tests           2398     1905    -20.6%
runtime         48 s     37 s    -23%
line coverage   81.2%    81.2%   0.0 pts
branch coverage 70.4%    70.1%   -0.3 pts   (explain)

Removed or merged, by reason
- 212 duplicates merged into 31 table tests (src/features/stats/...)
- 97 tests of mocks deleted (...)
- 64 snapshots replaced by 18 assertions (...)
Lines that lost coverage: none (coverage-diff.mjs exit 0)
Hand-made bugs: 14 tried, 14 caught
Weak tests found: 1 (a 404 case that passes without its 404 branch)
Protected regression tests touched: none
Flaky tests: 1 fixed (...)
```

## Finish

End with one line: the next step, as one question. "Next: <step>. Continue?".
"Yes" must be enough. Take the step from the app's plan (`/start:plan`). If
something blocks it, name only that one thing, in plain words, and offer the
fix.
