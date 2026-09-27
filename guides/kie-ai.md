# kie.ai

Used by: `content:image` (`plugins/content/skills/image`).

## What it is and what it costs

kie.ai is a paid API gateway in front of several third-party image and video
models (Seedream, Kling, and others). You pay in credits; credits are spent
per generation, whether or not you like the result.

Checked on 2026-09-28: kie.ai sells credits in dollar-denominated packages
(roughly $0.005 per credit at the smallest tier, with a discount at larger
top-ups), and each model's own page states its price per call — for example
a Seedream 5.0 Pro still is quoted around $0.075 per image on kie.ai's
marketing pages, while the API's own example callbacks show `creditsConsumed`
figures that don't always match that quote exactly. **Treat any number here,
and any number in the skill, as a ballpark.** kie.ai's dashboard is the only
authoritative source for your actual balance and what a given task cost —
check it, don't extrapolate from an old quote.

## Account and API key

1. Create an account at kie.ai.
2. Add credit (a small top-up is enough to test with — a still costs cents).
3. Find the API key page in your kie.ai account dashboard and generate a
   key. (Exact menu wording may have changed since this was written — look
   for "API key" or "API" in account settings.)
4. Copy the key. Do not paste it into a prompt, a commit, or anywhere it
   would get logged.

## Where the value goes

The `content:image` skill resolves the key the same way every onebox skill
resolves a secret — see `CONFIG.md`.

- Default: put it in the environment as `KIE_AI_API_KEY`, or in a `.env`
  file anywhere from your project directory up to your home directory.
- To use a different variable name or a different secrets tool (`doppler`,
  `1password`), set these in `~/.config/onebox/config.json`:
  ```jsonc
  {
    "secrets": { "tool": "env" },
    "images": { "provider": "kie", "keyRef": "KIE_AI_API_KEY" }
  }
  ```
- With `secrets.tool: "doppler"`, `keyRef` is the Doppler secret name, read
  via `doppler secrets get <keyRef> --plain -p <project> -c <config>` using
  `secrets.doppler.project`/`config` from the same file.
- With `secrets.tool: "1password"`, `keyRef` is a full reference like
  `op://vault/item/field`, read via `op read <keyRef>`.

## Test it

```bash
node plugins/content/skills/image/scripts/kie.mjs probe
```

This prints your current credit balance and nothing else. It confirms the
key resolves and is valid without spending anything. If it errors, the
message names what it looked for (env var, `.env`, or the config key) —
fix that, then re-run.

## Common errors

- **`could not resolve the kie.ai key`** — nothing set. Set `KIE_AI_API_KEY`
  or check `images.keyRef`/`secrets.tool` in your config.
- **401 / unauthorized on `probe`** — the key is wrong, revoked, or copied
  with extra whitespace.
- **402 on a `still`/`shot` call** — out of credit. Top up, then `probe`
  again to confirm the new balance before retrying.
- **A field-not-found error from `createTask` with no field named** — see
  the troubleshooting section in the `content:image` skill; it's almost
  always a missing required field or an unconfirmed aspect ratio, not an
  account problem.
