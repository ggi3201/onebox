# Writing a onebox skill

## Layout

```
plugins/<plugin>/skills/<skill>/
  SKILL.md          the entry point, lean (aim under ~150 lines)
  references/*.md   detail the model reads only when needed
  scripts/*         executable helpers
  assets/*          templates
```

`SKILL.md` frontmatter has `name` (same as the folder) and `description`.
The description says what the skill does, then "Use when ..." with the words a
user would really type. It is the only part the model sees before it decides to
load the skill, so it must carry the trigger phrases.

## Rules

1. **No personal values.** No hostnames, IPs, domains, app names, bundle IDs,
   team IDs, usernames or file paths from anyone's machine. Read them from the
   config (see `CONFIG.md`). Examples use `example.com`, `myapp`,
   `com.example.myapp`, `user@host`.
2. **Secrets by reference only.** Follow the table in `CONFIG.md`. Never print a
   secret, never put one in a URL, never commit one.
3. **Missing config is normal.** If a key is missing, ask the user once, then
   offer to write it to `~/.config/onebox/config.json` or `.onebox.json`.
4. **Read config with jq**, merging project over user:
   ```bash
   cfg() { jq -s '.[0] * .[1]' ~/.config/onebox/config.json .onebox.json 2>/dev/null \
     || cat ~/.config/onebox/config.json 2>/dev/null || echo '{}'; }
   cfg | jq -r '.box.ssh // empty'
   ```
   Scripts may take the same values as flags or env vars instead.
5. **Cheap first.** Local builds before paid cloud builds. One box before many.
   Do not add scale the user did not ask for.
6. **Say where it runs.** State near the top: "Runs on: your Mac", "Runs on:
   your box (over SSH)", or "Runs anywhere".
7. **Plain English.** Short sentences. One idea per sentence. Active voice.
   Exact technical terms. No filler.
8. **Link a guide** in `guides/` when a skill needs an account or an API key.
   The skill tells the user which guide to follow; it does not repeat the guide.
   Link it by its site URL (`https://onebox.lokkesveen.com/guides/<name>.md`),
   not a relative path: an installed plugin has no `guides/` folder. A skill
   that fetches a guide falls back to the raw GitHub URL, then a local
   checkout, and otherwise stops. It never goes on from memory.
9. **Keep what was learned.** When adapting a personal skill, keep the hard-won
   lessons (pitfalls, ordering, verification steps). Remove only what is
   personal. Turn a personal story into a neutral example if it teaches
   something.
10. **Raise the version.** Claude Code updates an installed plugin only when
    its version goes up. Any change under `plugins/<plugin>/` needs
    `node scripts/versions.mjs bump <plugin>` in the same PR: patch for a
    fix, `minor` for a new skill. It changes `plugin.json` and
    `marketplace.json` together. `check` in the same script runs on every PR.
    A change in `guides/` needs no bump: skills fetch guides from the site.
11. **End with a nudge.** A skill ends with the next step as one plain
    question: "Next: Sign in with Apple. Continue?". "Yes" must be enough.
    No lists, config keys or detection lines unless the user asks. If
    something blocks the next step, name only that one thing, in plain
    words (`plan.mjs ready` finds it). Explain a technical word the first
    time you use it, and link
    `https://onebox.lokkesveen.com/guides/glossary/`. Offer a fix only when
    it is a safe local install, and run it only after the user says yes.

## Guides

`guides/<service>.md`: one page per account or key. Sections: what it is and
what it costs; steps (numbered, what to click, what to copy); where the value
goes (which config key, which secret reference); how to check it works;
common errors. Do not guess at UI labels you have not verified; say "the page
for X" rather than inventing a button name.
