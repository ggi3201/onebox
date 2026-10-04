---
name: check-features
description: Check that every feature the user asked for is built and works. It reads FEATURES.md (the app's features, in the user's words, plus the ones the plan promises), finds the click-through flow that covers each one, and shows which have no flow, which flow never ran, failed, or ran on older code. Then it writes or runs the next flow, one gap at a time, until every feature has a passing flow on the current code. Use when the user says "is everything built", "check all features", "did we build everything I asked for", "what is left to build", "check the features", "prove it works", "feature check", "before I ship", or mentions FEATURES.md.
---

# Check features

Runs on: your Mac, in your app's repo. Running a flow needs the iOS Simulator.

A feature counts as built when a flow proves it, not when code for it exists.
The check is a script: the same files always give the same answer. The agent
does the parts a script cannot: it writes the flows and runs them in the
Simulator. The script then compares, counts and says what is next.

`<skill-dir>` below is this skill's folder. `<plan-dir>` is
`<skill-dir>/../plan`, in the same plugin.

## The three pieces

- **`FEATURES.md`** in the repo root. One line per feature, each with an id:
  `- Remind me 30 days before a warranty ends <!-- feature:warranty-reminder -->`.
  "What the app does" holds the user's own features. "From your plan" holds
  the features the plan's items promise, each with what its proof must show
  (`proves` in the plan's `catalog.json`). The user owns the file.
- **Flows**, `*.flow.md` next to the feature's code. A flow covers a feature
  with a `Covers:` line in its header:
  ```markdown
  # Receipts: add, see, delete

  Feature: src/features/receipts/, src/app/index.tsx
  Covers: add-receipt, delete-receipt
  Needs: the seed user `dev-empty`.
  ```
  `Feature:` names the code the flow tests, relative to the app folder. When
  any of that code or the flow file changes, its last pass no longer counts.
  How to write a flow: `https://onebox.lokkesveen.com/guides/agent-test-loop.md`,
  "The first flow", and the `dev:test-loop` skill's `references/flows.md`.
- **Runs**, `.onebox/runs/*.json`. One file per flow: pass or fail, the failed
  step, the commit, and a fingerprint of the flow and its code. Commit them
  with the change, so the next session sees the same state.

## 1. Make or update FEATURES.md

If there is no `FEATURES.md`, or the plan changed:

```bash
node <skill-dir>/scripts/features.mjs sync --add '["Add a receipt with a photo", "Remind me before a warranty ends"]'
```

`--add` takes the app's own features, one short line each, in the user's
words. `sync` also adds the plan's features from `PLAN.md`. It never removes
or changes a line. Without app features, ask once: "What should the app do?
A few short lines, one per thing." Suggest lines from what you know (the
idea, the screens in the repo), and let the user change them. The user must
agree to the list: it is what "done" means.

## 2. Check

```bash
node <skill-dir>/scripts/features.mjs check > "$TMPDIR/onebox-features.json"
```

It reads files only. Exit 0: every feature is done. Exit 1: a gap. Exit 3: no
`FEATURES.md`. The JSON has each feature's `state`, each flow's last run,
`summary` ("5 of 8 features proven.") and `say`, the next step. The states:

| State | Means | What to do |
|---|---|---|
| `missing` | no flow covers it | write a flow, or add the id to a flow's `Covers:` line |
| `failed` | a flow that covers it failed | fix the app, not the flow, then run it again |
| `unproven` | its flow never ran | run the flow |
| `stale` | the flow or its code changed since it passed | run the flow again |
| `done` | every flow that covers it passed on the current code | nothing |

Also read `unknownCovers` (a flow names an id that is not in `FEATURES.md`:
a typo, or a feature to add) and `flowsWithoutCovers`. Mention them only when
they are the reason for a gap.

## 3. Close the gap, one at a time

Say the `summary` and the `say` line, and nothing else:

```
5 of 8 features proven.
Next: run receipts.flow.md to prove "Add a receipt with a photo". Continue?
```

On "yes":

- **Write a flow** for a `missing` feature. Follow the flow format. Name what
  a person sees, and put the feature's id in `Covers:`. A feature the code
  does not have yet is not a flow problem: say so, and build it first
  (`dev:test-loop` proves the change).
- **Run a flow** the way `dev:test-loop` says: preflight first, one
  simulator, a screenshot at every `Expect`. Then record the result:
  ```bash
  node <skill-dir>/scripts/features.mjs record --flow apps/mobile/src/features/receipts/receipts.flow.md --pass
  node <skill-dir>/scripts/features.mjs record --flow <path> --fail --step 4 --note "the sheet stayed open"
  ```
  Record a pass only when every step passed and you read every screenshot.
  A step you could not run (Sign in with Apple, a real purchase, the camera)
  is not a pass. Ask the user to do that step, or record a fail with the
  step and the reason.
- Run `check` again and give the next nudge.

When `check` exits 0, say: "Done: every feature has a flow that passed on the
current code." Then run `/start:plan`: it ticks this step.

## Rules

- Never edit a flow to make it pass. A flow that fails on a broken screen is
  right. Change a flow only when the user changed what the feature should do.
- Never write a run file by hand. Only `record` writes one, so the
  fingerprint is real.
- Never remove a line from `FEATURES.md` yourself. Ask the user.
- In the repo, write only `FEATURES.md`, `.onebox/runs/` and the flows.
