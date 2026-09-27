---
name: delegate
description: >
  Save tokens in Claude Code by routing reading and well-specified coding to
  subagents on the cheapest model that can do the job, while the main session
  keeps the judgment. Use when the user says "delegate", "use subagents",
  "save tokens", "use a cheaper model", "offload this" or "fan out", or when a
  task needs reading across many files or several independent pieces of work.
  Stays active for the rest of the session once invoked. Do NOT use for a
  one-fact lookup where the file is already known, a small edit to a known
  file, or a task that is only conversation.
argument-hint: "[task] | off | status"
---

# Delegate

Runs in: Claude Code only. It needs the `Agent` tool with a `model` choice.

Route work to subagents by cost. The main session stays the architect and
reviewer. Subagents do the reading and the typing.

The goal is fewer tokens on the expensive model, not lower quality. Every
rule below has an escalation path. When in doubt, do it yourself or escalate.
Never loop a cheap model on a task it is failing.

## Persistence

Active for every response once invoked. The user turns it off by invoking
this skill again with `off`. With `status`, list what was delegated so far:
what, to which agent type and model, and the result in a few words.

## When it pays

A subagent is not free. Each one starts a fresh context with the system
prompt, tool definitions and project instructions before it reads anything.
That start-up cost is paid on every agent.

- **Delegate** when the work would take the main session more than about five
  tool calls, or would pull more than two or three files into the main
  context. The saving is the context the main session does not grow; every
  later turn re-reads that context.
- **Do it yourself** when you already know the file and the answer is one read
  or one grep away, or when the edit is a few lines in a file you have open.

## Model order

`haiku` < `sonnet` < `opus` < `fable` in cost. Pass `model` explicitly on
every `Agent` call. Never route to a model that costs more than the main
session. If the main session is `sonnet`, "escalate" means you take over.

## Routing table

Pick the row that matches.

| Task shape | Agent type | Model | Why |
| --- | --- | --- | --- |
| Find where X lives, list call sites, which files touch Y | `Explore` | `haiku` | Pattern matching, no judgment |
| Explain how a flow works across files, summarize a module | `Explore` | `sonnet` | Needs synthesis, not design |
| Read docs, a PR, a log or an API reference and report the relevant part | `general-purpose` | `haiku` | Extraction |
| Well-specified change: clear spec, known files, tests or types catch mistakes | `general-purpose` | `sonnet` | Typing work, verifiable |
| Write tests for existing behaviour, add a migration, wire a known pattern | `general-purpose` | `sonnet` | Follows an existing example |
| Mechanical refactor: rename, move, apply one pattern to N places | `general-purpose` | `sonnet` | Repetitive, checkable |
| Review a diff for bugs | `general-purpose` | `sonnet` | Second pair of eyes; the main session makes the call |
| Design decision, ambiguous spec, cross-cutting change, security-sensitive code, auth, payments, data loss | main session | current | Judgment. Do not delegate |
| A `sonnet` agent failed twice, or says it is unsure | `general-purpose` | `opus` (if cheaper than main) | Escalate once, then take over |

A subagent may gather facts for a decision ("summarize how sessions are stored
today"). It never makes the decision.

**Never delegate:** deciding what to build, choosing between approaches,
anything the user must confirm, git commits and pushes, destructive commands.

## Before delegating

1. Decide what you need back: a location, a summary, a diff or a test result.
2. Check whether you already know the answer from context. If yes, stop.
3. Split independent work into separate agents and launch them in one message
   so they run in parallel.
4. Parallel agents that write files must own different files. If they cannot,
   give each one `isolation: "worktree"`, or run them one after another.

## The subagent prompt

Subagents start with zero context. Write the prompt so a new hire could act on
it without asking. Use this shape:

```
GOAL
One sentence. What done looks like.

CONTEXT
- Repo root and the 1-5 files or directories that matter, with paths.
- The existing pattern to copy, with a file:line example.
- Constraints from CLAUDE.md that apply (style, commit rules, banned tools).

DO
Numbered steps. Include the verification command (tsc, tests, build).

DO NOT
- Do not commit, push, or run destructive commands.
- Do not refactor beyond the goal.
- Do not guess. If blocked, stop and report what you found.

REPORT BACK
Exact format, with a length cap. Examples:
- "List of file:line with a one-line note each. No code dumps."
- "The diff you applied, the verification command you ran, and its output."
- "Under 200 words. Conclusion first, then evidence."
```

Always cap the report length. The report enters the main context and is the
main cost. Ask for conclusions and pointers, not file contents.

## While agents run

Agents may run in the background. Do not guess or announce their results
before they report. Do other work, or end the turn and wait for the
notification. Run an agent in the foreground only when your very next step
needs its result.

## After the agent returns

- Read only the files the agent pointed at, and only the ranges you need.
- Verify with a command (tests, `tsc`, build), not by re-reading everything.
- If the result is wrong or vague, rewrite the prompt with what was missing
  and retry once on the same model. On a second failure, escalate per the
  table.
- Do not redo the agent's search yourself. That defeats the purpose.

## Reporting to the user

At the end of a delegated task, add one short line per agent:

`Delegated: <what> -> <agent type>/<model>. <result in a few words>.`

This lets the user see where the tokens went and correct the routing.

## Examples

**"Where is the rate-limit check for the search endpoint?"** (file unknown)
`Explore`/`haiku`: "Find where rate limiting is checked under src/. Report
file:line for each check and the function name. No code."

**"What is MAX_UPLOAD_MB in src/config.ts?"**
Do it yourself. One read of a known file.

**"Add a `status` filter to the orders list like the existing `region` filter"**
`general-purpose`/`sonnet`: goal, path to the `region` filter as the pattern,
the test command as verification, report the diff and the test output.

**"Should the dedup step hash the raw bytes or a normalized form?"**
Main session. This is a design decision. `Explore`/`sonnet` can first summarize
how the hash is used today, and that summary feeds the decision.
