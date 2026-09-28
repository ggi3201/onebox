---
name: plan
description: The first step with onebox. It looks at the app in the current folder, asks only what it cannot see, and writes PLAN.md with the steps, guides and plugins this app needs, in order, with done items ticked. Run it again later to tick what is new and see the next step. Use when the user says "where do I start", "what do I need", "plan my app", "set up onebox", "which plugins do I need", "get my app on the App Store", "what is next", "update my plan", "check my plan", or mentions PLAN.md.
---

# Plan

Runs on: your Mac, in your app's repo.

This skill writes one file: `PLAN.md` in the repo root. It does not install
plugins, change the app or touch the config. The user does those, step by
step, with the plan in hand.

`<skill-dir>` below is this skill's folder. The catalog of questions, phases
and items is `references/catalog.json`. The website's picker uses the same
file, so the plan and the site agree.

## 1. Detect first

From the repo root:

```bash
node <skill-dir>/scripts/detect.mjs . > "$TMPDIR/onebox-detect.json"
```

It is read-only and needs Node 18+. It never runs the app's code. It reads
`app.config.js` as text, because some repos keep a root `app.config.js` that
throws on purpose. It looks at the root, each direct subfolder, and `apps/*`
and `packages/*`. It prints JSON:

- `expo`: the app folder, bundle id, EAS profiles, dev client or Expo Go,
  Sign in with Apple, RevenueCat, `expo-secure-store`.
- `backends`: ASP.NET projects and Node servers (express, fastify, hono and
  others). `hosted`: Supabase or Firebase SDKs. `compose`, `sites`.
- `ai`: AI SDKs and AI API hosts named in the code.
- `config`: which onebox config keys are set. Key names only, never values.
- `plan`: whether `PLAN.md` exists and whether this skill made it.
- `answers`: guesses for the catalog questions, each with `confidence`
  (`high`, `likely`, `low`) and `why`.
- `done` and `seen`: evidence per plan item. `done` ticks the item. `seen`
  only adds a note.
- `notes` and `cannotDetect`: tell the user about both.

If `expo.found` is false, say so. The user may be in the wrong folder. Ask
before you go on.

## 2. Ask second

```bash
node <skill-dir>/scripts/plan.mjs questions --detect "$TMPDIR/onebox-detect.json"
```

It prints `state`, `ask` and `skipped`:

- **`state`**: answers detection knows. Do not ask them. Say them in one short
  list, with the `why`, and let the user correct any of them. For example:
  "Found: an ASP.NET API in `apps/api` (so: your own server), Sign in with
  Apple, RevenueCat. Tell me if any of this is wrong."
- **`ask`**: the questions left, with options in order. Use the
  AskUserQuestion tool if you have it: up to 4 questions per call, `header`
  from the item, the option labels as given, with `tag` added to the label
  ("(detected)" or "(recommended)"). Set `multiSelect` when `multi` is true.
  Put the `why` or `hint` in the question text when there is one. Without the
  tool, ask them in one message as a numbered list.
- **`skipped`**: questions no answer would change, given what is known. Do
  not ask them.

If the user answers only some questions, run `questions` again with
`--answers` holding what you have. Questions can drop out (for example,
remote access only matters with your own box). If the user asks what a
question means, answer from `references/questions.md`.

## 3. Write the plan

```bash
node <skill-dir>/scripts/plan.mjs write --detect "$TMPDIR/onebox-detect.json" \
  --answers '{"backend":"box","login":"apple","paid":"subs","site":"yes","ai":["chat"],"remote":"yes"}'
```

Answers are option ids from the catalog. `ai` is a list; `[]` means none.
Include the answers the user confirmed from `state`. A missing answer falls
back to the user's earlier answer, then detection, then the catalog default.

It writes `PLAN.md` with:

1. The answers, and where each came from (you, detected, default).
2. **Install**: the exact `/plugin install <name>@onebox` lines, only for the
   plugins the plan uses.
3. **Config keys** the chosen path needs (from https://github.com/ggi3201/onebox/blob/main/CONFIG.md), marked set or
   not set. Never values.
4. One section per phase, in order. Each item is a checkbox with its guide
   link (web and raw Markdown) or its skill (`/plugin:skill`). Items detection
   found done are ticked, with a `detected:` line. Partial evidence adds a
   `found:` line and no tick. An answer can also mark an item as likely done
   (an app already on TestFlight has an Apple account and an App Store
   Connect record): it starts ticked with a `likely done:` line, and the user
   can untick it. Detection wins over "likely done".
5. **Notes**, for the user.

The same answers and the same repo give the same file. Show the user the
summary the script prints. Do not paste the whole file.

## 4. Run again later

When `PLAN.md` exists and this skill made it, run steps 1 and 3 again. Pass
`--answers` only for answers the user wants to change. The script:

- keeps every tick the user made, and every line they added, where they put
  it;
- ticks items detection now finds done, but not one the user unticked;
- moves items that no longer fit the answers to "Kept from your old plan",
  if they are ticked or have notes. Nothing the user wrote is deleted;
- prints the next unticked step.

If the script says a detected answer now differs from the user's answer
(a "Check:" line), tell the user and ask which one is right.

## 5. A PLAN.md this skill did not make

`write` stops with exit code 3 and writes nothing. Ask the user which they
want:

- keep it, and write the plan to another file: add `--out ONEBOX-PLAN.md`;
- convert it: add `--convert`. All its text moves, as it is, under "Kept
  from your old plan".

Never overwrite it without that answer.

## 6. Hand off

End with the next step from the summary, and offer to start it:

- A skill: check it is installed. If not, give the one install line from the
  plan. Then ask, for example: "Run `/dev:test-loop` next?"
- A guide: offer to go through it together. Fetch the raw `.md` link from the
  plan and follow its steps with the user.

Say what detection cannot see (the `cannotDetect` list), in one line, so the
user knows why some items stay unticked.

## Rules

- Write only `PLAN.md` (or the `--out` file). No other file, no config, no
  app code.
- Never run `/plugin install` or any installer. Show the lines; the user runs
  them.
- Never print a config value or a secret. Detection reads key names only.
- Do not ask a question that detection answered with `high` confidence. State
  it instead.
- Keep it short. The plan is the long part, and it is in the file.
