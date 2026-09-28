# Secrets: for your app and for your agent

Runs on: your Mac, the box and GitHub Actions.

You have two kinds of secrets, and they need the same care:

- **App secrets.** Your API uses them: the database password, the key that
  signs login tokens, the Sign in with Apple key, the RevenueCat webhook
  secret, the AI provider key.
- **Agent secrets.** Your coding agent uses them to do the work for you: the
  App Store Connect API key, the Expo token, the Cloudflare token, the kie.ai
  key.

Both stay out of git and out of the chat. This guide helps you pick one place
for them, and set it up so an agent can read a secret without ever seeing
your other passwords.

## The rules, whatever tool you pick

- **Never commit a secret.** Put `.env` and `.env.*` in `.gitignore` before
  the first secret goes in.
- **Never paste a secret into the chat with your agent.** The chat is saved
  in transcripts and logs. Give the agent a *reference* instead (a name like
  `KIE_AI_API_KEY`, or `op://agent-secrets/kie/credential`). The skills read
  the value themselves and never print it.
- **`EXPO_PUBLIC_*` values are not secret.** They are built into the app, and
  anyone can read them from the download. A key that costs money or grants
  access belongs on your server, never in the app.
  `ship-ios:app-store-ready` checks the app for this.
- **Staging gets its own values.** A staging bug must not be able to spend
  production's money or sign tokens production accepts. `box:staging-env`
  sets this up.
- **If a secret leaks, rotate it first.** Make a new key and revoke the old
  one. Cleaning git history comes after, because a pushed secret is already
  public.

## Pick a tool

| Tool | What it costs | Good for | Watch out |
|---|---|---|---|
| `.env` files | Free | Your first weeks, on one Mac | One copy per machine, no history, easy to commit by mistake |
| **1Password** | Nothing extra if you already pay for it | You already keep your passwords there | Agents need a separate vault and a service account (below) |
| **Doppler** | Free for up to 3 users | App secrets per environment (dev, staging, production), for the box and GitHub Actions | A cloud service; your secrets live there |
| Infisical | Free cloud tier for up to 5 identities; the open-source version is free to run on your box | You want secrets on your own box | Running it yourself is one more service to update and back up |
| Bitwarden Secrets Manager | Free for 2 users, 3 projects and 3 machine accounts | You already use Bitwarden | |

Prices checked on 2026-09-28.

**A simple default:** if you already pay for 1Password, use it for both kinds.
If not, start with `.env` files on your Mac, and move the app secrets to
Doppler when you add staging or GitHub Actions.

The onebox skills read secrets through the onebox config
(`~/.config/onebox/config.json`), key `secrets.tool`: `env`, `doppler` or
`1password`. See
[CONFIG.md](https://github.com/ggi3201/onebox/blob/main/CONFIG.md). With
Infisical or Bitwarden, load the secrets into the environment and use `env`:
`infisical run -- <command>` or `bws run -- <command>`.

## 1Password: a separate vault for your agent

Plain `op` asks for Touch ID through the 1Password app. In an agent run nobody
answers that prompt, so the run hangs. A **service account** reads without a
prompt. It can only see the vaults you give it, and 1Password never lets it
see your Personal or Private vault. So you give agents their own vault, with
only what they need.

Service accounts work on Families, Teams and Business plans. On an Individual
plan, check your account settings first.

1. **Make a vault** called `agent-secrets`. Move or copy in only the secrets
   agents need: the App Store Connect key, the Expo token, the Cloudflare
   token, API keys. Leave everything else where it is.
2. **Make a service account** in the 1Password web app, under Developer, then
   Service accounts. Give it **read** access to `agent-secrets` only. Copy the
   token. 1Password shows it once.
3. **Store the token in the macOS Keychain**, not in a file or a shell
   profile:

   ```sh
   security add-generic-password -s agent-op -a service-account-token -w
   ```

   It asks for the token. Paste it there, not in the chat.
4. **Give agents a helper** that uses the token for one command only. Put it
   in `~/.zshenv`, so the shells agents start also have it:

   ```sh
   opa() { OP_SERVICE_ACCOUNT_TOKEN="$(security find-generic-password -s agent-op -a service-account-token -w)" op "$@"; }
   ```

   Do **not** `export OP_SERVICE_ACCOUNT_TOKEN` globally. Your own `op` would
   then see only the agent vault.
5. **Tell your agent the rule.** Add this to `AGENTS.md` or `CLAUDE.md`:

   ```md
   Secrets: read them with `opa read "op://agent-secrets/<item>/<field>"`,
   never with plain `op`. Never print a secret. Put it in a variable or pipe
   it to the command. If an item is not in agent-secrets, ask me to move it.
   ```

6. **Point the onebox config at it:** `"secrets": { "tool": "1password" }`,
   and use `op://agent-secrets/...` references for each key.

On the box and in GitHub Actions there is no Keychain. Use a second service
account for each, so you can revoke one without breaking the others:

- **The box:** keep its token in a root-only file (`chmod 600`) and read it in
  the deploy step.
- **GitHub Actions:** save the token as the repository secret
  `OP_SERVICE_ACCOUNT_TOKEN` and load secrets with 1Password's
  `load-secrets-action`.

## Doppler: one config per environment

1. Make a project for the app, with the configs `dev`, `stg` and `prd`.
2. On your Mac, run `doppler login` once, then `doppler setup` in the repo.
   After that, agents read without a prompt:
   `doppler secrets get NAME --plain -p <project> -c dev`.
3. For the box and GitHub Actions, make a **service token** per config
   (`doppler configs tokens create`). A token for `stg` cannot read `prd`.
   `box:staging-env` shows the exact steps.
4. Set `"secrets": { "tool": "doppler", "doppler": { "project": "<project>", "config": "dev" } }`
   in the onebox config.

## Where the values go

| Secret | Where it lives | Who reads it |
|---|---|---|
| App Store Connect key, Expo token, Cloudflare token, media API keys | `agent-secrets` vault, Doppler `dev`, or `.env` on your Mac | Your agent, through the skills |
| Database password, token signing key, webhook secrets, AI provider key | Doppler `prd` or a 1Password vault for the app; the box reads them at deploy | The API on the box |
| The same for staging, with **new values** | Doppler `stg`, or a separate vault or item | The staging API |
| Anything `EXPO_PUBLIC_*` | `eas.json` or EAS environment variables | Everyone. It is not a secret |

## Check it works

- `git status` never shows a `.env` file.
- With 1Password: `opa vault list` shows only `agent-secrets`, and your own
  `op vault list` still shows all your vaults.
- Your agent can run a skill that needs a key, and the key never appears in
  the chat or in the terminal output.
- Staging and production have different database passwords and signing
  keys.

## Common errors

- **The agent hangs on a 1Password command.** It used plain `op`, which waits
  for Touch ID. Use `opa`.
- **Your own `op` shows only one vault.** `OP_SERVICE_ACCOUNT_TOKEN` is
  exported somewhere in your shell profile. Remove the export and keep the
  `opa` function.
- **"Rate limit exceeded" from 1Password.** Service accounts have hourly and
  daily limits. Read a secret once into a variable, not inside a loop.
- **A secret was committed.** Rotate it now, then remove it from history.
  Removing it from history alone does not help: it may already be copied.
