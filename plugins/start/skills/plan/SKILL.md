---
name: plan
description: The first step with onebox. It looks at the app in the current folder, asks only what it cannot see, and writes PLAN.md with the steps, guides and plugins this app needs, in order, with done items ticked. Run it again later to tick what is new and see the next step. Use when the user says "where do I start", "what do I need", "plan my app", "set up onebox", "which plugins do I need", "get my app on the App Store", "what is next", "update my plan", "check my plan", or mentions PLAN.md.
---

# Plan

Runs on: your Mac, in your app's repo.

This skill writes two files in the repo root: `PLAN.md`, and `FEATURES.md`
through the `check-features` skill's script (section 3b). It does not install
plugins, change the app or touch the config. The user does those, step by
step, with the plan in hand.

**The user sees a nudge, not a checklist.** The plan is the long part, and it
is in the file. In chat, end with one line: the next step as a question
(section 6). Show lists, config keys and `detected:` lines only when the user
asks for them.

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
and `packages/*`. The only commands it runs are the tool checks of the
command-line tools step, the same ones `ready` runs (section 6). They take
under a second, ask nothing, and time out. The step is ticked only when every
check passes; a check that cannot run never ticks it. It prints JSON:

- `expo`: the app folder, bundle id, EAS profiles, dev client or Expo Go,
  Sign in with Apple, RevenueCat, `expo-secure-store`, `expo-updates`,
  `expo-notifications`, `expo-store-review`. `reviewCall`: the first app
  file that calls `requestReview()`.
- `backends`: ASP.NET projects and Node servers (express, fastify, hono and
  others). `hosted`: Supabase, Convex or Firebase SDKs. `compose`, `sites`.
- `ai`: AI SDKs and AI API hosts named in the code.
- `config`: which onebox config keys are set. Key names only, never values.
- `plan`: whether `PLAN.md` exists and whether this skill made it.
- `answers`: guesses for the catalog questions, each with `confidence`
  (`high`, `likely`, `low`) and `why`.
- `workflows`, `traefikHosts`, `secretsRunIn`: GitHub workflows, compose
  files with a Traefik router, and files that run `doppler run` or `op run`.
- `done`, `seen` and `open`: evidence per plan item. `done` ticks the item.
  `seen` only adds a note. `open` names what is still missing: it adds a note
  and stops a "likely done" tick.
- `notes` and `cannotDetect`: keep them for when the user asks "why".

If `expo.found` is false, say so. The user may be in the wrong folder. Ask
before you go on. If they have no app yet, offer `/start:new-app`: it makes the
repo, then they run this skill again.

## 2. Ask second

```bash
node <skill-dir>/scripts/plan.mjs questions --detect "$TMPDIR/onebox-detect.json"
```

It prints `state`, `ask` and `skipped`:

- **`state`**: answers detection knows. Do not ask them. Say them in one plain
  sentence, without folder or package names, and let the user correct any of
  them. For example: "Your app has its own server, Sign in with Apple and
  in-app purchases. Tell me if that is wrong." The `why` is for when the user
  asks.
- **`ask`**: the questions left, with options in order. Use the
  AskUserQuestion tool if you have it: up to 4 questions per call, `header`
  from the item, the option labels as given, with `tag` added to the label
  ("(detected)" or "(recommended)"). Set `multiSelect` when `multi` is true.
  Put the `why` or `hint` in the question text when there is one. Without the
  tool, ask them in one message as a numbered list.
- **`skipped`**: questions no answer would change, given what is known. Do
  not ask them.

**Answers from the website.** The picker on the onebox site gives the user a
prompt that ends with `My answers from the onebox site: {...}`. That JSON
holds option ids from the catalog, the same shape `--answers` takes. Treat
them as the user's own answers: pass the JSON to `questions` and to `write`
with `--answers`, and do not ask those questions again. Detection still runs.
If detection says something different with `high` confidence (for example,
the site says "no server" but the repo has an ASP.NET API), say both and ask
which is right. Drop keys the catalog does not know before you pass them; the
script rejects them. One of them is `does`: a list of what the app should do,
in the user's words. It is not a catalog answer. Pass it to `sync` in
section 3b, and do not ask for it again.

**Answers from `/start:new-app`.** When `/start:new-app` made the repo in this
session, the user already answered the server and sign-in questions there.
The repo shows an API in `apps/api`, but not "no server", "hosted" or "sign
in later". Pass those answers with `--answers` to `questions` and `write`, and
do not ask them again:

| new-app answer | `--answers` |
|---|---|
| Server: Own box, .NET API / Own box, Node API | `"backend":"box"` |
| Server: Hosted (Supabase, Convex, Firebase) | `"backend":"hosted"` |
| Server: No server | `"backend":"none"` |
| Sign in with Apple now: Yes | `"login":"apple"` |
| Sign in with Apple now: Later | `"login":"later"` |

`write` keeps them in `PLAN.md`, so a later run does not ask them either.

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

1. The answers, and where each came from (you, detected, default). Only the
   questions that change this plan: without your own box, remote access is
   left out.
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
   can untick it. Detection wins over "likely done", both ways: an item
   detection sees as incomplete gets its `found:` line and no tick.
5. **Notes**, for the user.

The same answers and the same repo give the same file. The script prints a
summary for you: counts, answers, install lines, config keys not set, a
`Newly done:` line and the next step. Do not show it to the user, and do not
paste the file. Go to section 6.

## 3b. What the app does

`FEATURES.md` lists what the app must do. `/start:check-features` later
checks that each feature has a flow that passed. `<check-dir>` is
`<skill-dir>/../check-features`, in the same plugin.

If `FEATURES.md` does not exist, and no `does` list came from the site, ask
one more question: "What should the app do? A few short lines, one per
thing." Suggest lines from what you know (the idea, the app name, the screens
in the repo), so the user can say yes or change them. "Not sure yet" is a
fine answer: write the file without them. Then:

```bash
node <check-dir>/scripts/features.mjs sync --add '["Add a receipt with a photo", "Remind me before a warranty ends"]'
```

Leave out `--add` when there is nothing to add. With `--out`, add `--plan <that file>`. `sync` also copies the
features the plan's items promise (sign-in, payments, AI) from `PLAN.md`, so
run it after `write`, on every run. It adds lines and never changes or
removes one. Do not show its output unless the user asks.

## 4. Run again later

When `PLAN.md` exists and this skill made it, run steps 1 and 3 again. Pass
`--answers` only for answers the user wants to change. The script:

- keeps every tick the user made, and every line they added, where they put
  it;
- ticks items detection now finds done, but not one the user unticked;
- unticks an item it ticked itself, when detection now sees what is still
  missing. A tick the user made stays;
- moves items that no longer fit the answers to "Kept from your old plan",
  if they are ticked or have notes. Nothing the user wrote is deleted;
- prints `Newly done:` (what detection ticked since the last run) and the
  next unticked step.

If the script says a detected answer now differs from the user's answer
(a "Check:" line), tell the user and ask which one is right.

## 5. A PLAN.md this skill did not make

`write` stops with exit code 3 and writes nothing. Ask the user which they
want:

- keep it, and write the plan to another file: add `--out ONEBOX-PLAN.md`;
- convert it: add `--convert`. All its text moves, as it is, under "Kept
  from your old plan".

Never overwrite it without that answer.

## 6. Hand off: one nudge

After `write`, run `ready` with the same flags (`--answers`, `--out`) you gave
`write`:

```bash
node <skill-dir>/scripts/plan.mjs ready --detect "$TMPDIR/onebox-detect.json" > "$TMPDIR/onebox-ready.json"
```

It checks only what the next step needs (`references/needs.json`: tools,
logins, keys, plugins). It is read-only, installs nothing and never prints a
secret or a config value. A check it cannot make is `unknown`, never a
blocker. The JSON has `next`, `blocker` (the first need that stops the step,
or `null`), `needs`, and `say`: the line to say.

Then say at most two lines, and nothing else:

1. `Done: ...`, only when something changed since last time: what the user
   just finished, or the `Newly done:` line from `write`. Say it as what now
   works: "Done: your app runs in the Simulator."
2. The `say` line, as it is. It has one of these shapes:

   ```
   Next: Sign in with Apple. Continue?
   Next: Your agent tests its work in the Simulator. One thing first: CocoaPods is not installed (brew install cocoapods). Should I run it, then continue?
   Next: Sign in with Apple. This part is yours: turn it on for your app in your Apple Developer account (2 minutes, I will show you where). Ready when you are.
   ```

"Yes" is enough to go on:

- **No blocker.** Start the step. A skill: run it (`/<plugin>:<skill>`). A
  guide: go through it together. Fetch the raw `.md` link from the plan and
  follow its steps with the user. If it does not load, try
  `https://raw.githubusercontent.com/ggi3201/onebox/main/guides/<name>.md`,
  then `guides/<name>.md` in a local checkout of the onebox repo. If none
  loads, say so and stop. Never go through a guide from memory.
- **A blocker with `safe: true`.** Its `fix` is a local install. Run it only
  after the user says yes. Then run `ready` again, and start the step.
- **A blocker with `ask`.** Ask it, then start the step with the answer.
  Writing it to the config is the step's job (`CONFIG.md`), not this skill's.
- **A `yours` blocker.** Only the user can do it: an Apple or App Store Connect
  page, a payment, a login in their own terminal, a plugin install. Never run
  its `fix`. Fetch its `guide` link and show the user where to go. When they
  say it is done, run `ready` again. A hand check (`status: "yours"`) cannot
  see the result: believe the user, and do not bring it up again.

**When the user asks for more**, give it:

- "Show the plan": the summary from `write`, and the parts of `PLAN.md` they
  ask about.
- "What is missing?", "What will I need?": run `ready --all` and show its
  `say`. It checks every step left, and names each need once.
- "Why?" (a tick, no tick, or a blocker): the item's `detected:` or `found:`
  line, the need's `why`, or the `cannotDetect` list.

The first time you use a technical word (a dev client, an App ID, an API key),
explain it in a few plain words and link
`https://onebox.lokkesveen.com/guides/glossary/`.

If the plan is wrong for this app (a wrong tick, a missed item, a question
the repo already answers), offer to report it: `when-you-are-stuck.md`,
"When to ask a person", says how. Leave out the app's name and hosts.

## Rules

- In the repo, write only `PLAN.md` (or the `--out` file) and, through
  `features.mjs sync`, `FEATURES.md`. No other file, no config, no app code.
- Never run `/plugin install`. The user types it. Run another installer only
  when `ready` marks it `safe`, and only after the user says yes.
- Never print a config value or a secret. Detection reads key names only.
- Do not ask a question that detection answered with `high` confidence. State
  it instead.
- End with the nudge: one "Next: ... Continue?" line, or its blocker version.
  No lists, config keys or detection lines unless the user asks.
