# onebox

Agent skills and guides for getting an Expo app onto the App Store. Read
`CONTRIBUTING.md` before you write or change a skill, and `CONFIG.md` before a
skill reads a value. Both are short.

## The layout

```
plugins/<plugin>/skills/<skill>/   the skills
.claude-plugin/marketplace.json    the plugins, for /plugin install
.agents/plugins/marketplace.json   the same, for Codex; made by scripts/versions.mjs
plugins/<plugin>/.codex-plugin/    made by scripts/versions.mjs; do not edit
guides/                            one page per account, key or topic
site/                              the Astro site; it serves guides/ as pages and raw .md
plugins/start/skills/plan/references/catalog.json
                                   every plan item; the site's picker reads it too
```

A new skill or guide needs an item in `catalog.json`. Without one, the plan
never shows it.

## Checks before a PR

```bash
node scripts/versions.mjs check          # a changed plugin needs a new version and a CHANGELOG.md entry (CONTRIBUTING.md, rule 10)
(cd site && npm ci && npm run build)
bash site/scripts/example-plan.sh && git diff --stat site/src/data/example-plan.md
node plugins/start/skills/plan/scripts/plan.mjs write --answers '{"stage":"idea"}' --repo "$(mktemp -d)" --dry-run
bash scripts/plan-notes-check.sh         # a re-run keeps the user's notes byte for byte
bash scripts/features-check.sh            # the feature check gives the same answer for the same files
bash scripts/plan-protect-check.sh        # the backend is ticked only when protected; AI answer conflicts
bash scripts/secret-copies.sh check       # every skill's copy of the secret reader matches scripts/shared/
bash scripts/personal-values-check.sh     # no home path, private address or email in the diff
```

`.github/workflows/checks.yml` runs all of these on every PR. The repo is
public. A personal value in a diff is a bug (`CONTRIBUTING.md`,
rule 1). That includes issue and PR text.

## What to work on

The work list is GitHub Issues on `ggi3201/onebox`. Not a TODO file, not
memory, not a chat. Read it at the start of every session:

```bash
gh issue list --repo ggi3201/onebox
```

Take them in this order. Inside a group, the oldest first.

1. `blocks-dogfood`: the dogfood app cannot go on until this is fixed.
2. Other `dogfood` issues: found by using the kit on a real app.
3. The rest.

**Claim an issue before you start.** Several agents work at the same time, in
separate worktrees, and they all use one GitHub account. An assignee tells
nothing, so use a label and a comment:

```bash
gh issue edit <n> --repo ggi3201/onebox --add-label in-progress
gh issue comment <n> --repo ggi3201/onebox --body "Working on this in branch <branch>."
```

Skip an issue with `in-progress`. If its claim is older than a day and no PR
links to it, ask the user.

Put `Fixes #<n>` in the PR body. GitHub closes the issue when the PR merges.
If you stop without a PR, remove the label and comment what you found.

Something else is wrong, but it is not your issue? Open a new issue. Do not
fix it in passing, unless it is a line in a file you already change.

## The dogfood loop

Dogfooding means using the kit on real apps, the way a user would, and fixing
what breaks.

- **The dogfood app.** One app built with onebox only: from `/start:new-app`
  to the App Store. No personal skills, and no knowledge carried over from
  other apps. The pinned issue that starts with "Dogfood run" names the app
  and its current step.
- **When to build what.** The dogfood app's `PLAN.md` is the roadmap. Its next
  unticked step decides what to test next. Build or fix a skill when the app
  reaches that step, not before.
- **Fix the kit, not the app.** When a skill fails in the dogfood app, do not
  work around it in the app. Fix the skill or the guide here, merge it,
  update the plugin (`README.md`, "To get fixes later"), then run the step
  again from the fixed version.
- **A new user.** Now and then, run the kit as a person who is new to it, on a
  second macOS user: `docs/clean-user-test.md`. It finds what the owner's
  own Mac hides: missing logins, unclear words, steps that need the owner.
- **Older apps.** Run `/start:plan` in apps that were made before onebox. A
  wrong tick, a missed item or a needless question is a detection bug.
- **After a step passes**, run `/start:plan` in the dogfood app to tick it.
  Then update the pinned issue with the new current step.

## Report a problem

From any repo, when a skill or guide is wrong or unclear:

```bash
gh issue create --repo ggi3201/onebox --label dogfood --label <plugin> \
  --title "<skill>: <what is wrong>" --body-file <file>
```

`<plugin>` is `start`, `ship-ios`, `box`, `content`, `dev`, `app-features` or
`guides`. Add `blocks-dogfood` when the dogfood app cannot go on. The body
follows `.github/ISSUE_TEMPLATE/dogfood.md`: the skill and step, what you ran,
what you expected, what happened, the first error in full, and the fix you
suggest. Write "the app" or `myapp`, never the real app name, host, domain or
team ID. Take secrets out.
