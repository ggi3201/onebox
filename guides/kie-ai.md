# kie.ai

Runs on: your browser (the kie.ai account), then your Mac, where the
`content:*` skills run.

Used by: `content:image` (`plugins/content/skills/image`) and `content:video`
(`plugins/content/skills/video`). kie.ai is the default provider for both.
See [media-providers.md](media-providers.md) for the other providers either
skill can use instead (`--provider fal` or `--provider replicate`).

kie.ai is a paid API gateway in front of several third-party image and video
models (Seedream, Kling, and others). You need a kie.ai key only if you want
the `content:*` skills to make store artwork, landing page images or video
with the default provider.

## What it costs

You pay in credits. Each generation spends credits, whether or not you like
the result.

Checked on 2026-09-28: kie.ai sells credits in packages priced in dollars.
The smallest package works out at roughly $0.005 per credit. Larger top-ups
get a discount. Each model's own page states its price per call. For example,
kie.ai's marketing pages quote a Seedream 5.0 Pro still at around $0.075 per
image. The `creditsConsumed` numbers in the API's own example callbacks do not
always match that quote exactly. **Treat any number here, and any number in
the skill, as a ballpark.** Only kie.ai's dashboard shows your real balance
and what a given task cost. Check it there. Do not work it out from an old
quote.

### Video pricing and credits

Checked on 2026-09-28: video tasks use the same credit system as stills, but
cost far more per call. kie.ai's own market pages put most video models at
roughly **100-500 credits per clip** (a few cents to around $2). A still costs
a few credits. The exact rate varies a lot by model and tier. Kling's cheaper
standard tiers are near the low end. Veo and 4K or longer clips are near the
high end. Each model's own page on kie.ai/market states its rate.
[media-providers.md](media-providers.md) lists the model family names,
checked against docs.kie.ai on the same date. As with stills, the published
credit count and what is really taken from your balance are two different
numbers. Check both. The note on stills above applies to video too.

`node plugins/content/skills/video/scripts/video.mjs probe` reports your
credit balance, the same way the image skill's `probe` does. Run it before
and after a video batch. Video's `--dry-run` flag (not available for stills)
prints the exact request and a rough cost note for the model. It spends
nothing. Use it before you run an unfamiliar model or prompt for real.

## Steps

1. Create an account at kie.ai.
2. Add credit. A small top-up is enough to test with: a still costs cents.
3. Find the API key page in your kie.ai account dashboard and generate a
   key. The menu wording may have changed since this was written. Look for
   "API key" or "API" in the account settings.
4. Copy the key. Do not paste it into a prompt, a commit, or anywhere it
   would get logged.

## Where the values go

The `content:image` and `content:video` skills read the key the same way
every onebox skill reads a secret. See
[CONFIG.md](https://github.com/ggi3201/onebox/blob/main/CONFIG.md).

- Default: put it in the environment as `KIE_AI_API_KEY`, or in a `.env`
  file anywhere from your project directory up to your home directory.
- To use a different variable name or a secrets tool, set these in
  `~/.config/onebox/config.json`:
  ```jsonc
  {
    "secrets": { "tool": "env" },
    "media": {
      "imageProvider": "kie",
      "videoProvider": "kie",
      "providers": { "kie": { "keyRef": "KIE_AI_API_KEY" } }
    }
  }
  ```
  The older `images.provider` and `images.keyRef` keys still work.
- The key is read in this order: the environment variable named by `keyRef`,
  then your `secrets.command` (`secrets.tool` `doppler` and `1password` are
  ready-made ones), then the nearest `.env`. With 1Password, `keyRef` is a
  full reference like `op://vault/item/field`. See
  [CONFIG.md](https://github.com/ggi3201/onebox/blob/main/CONFIG.md), "Secrets".

## Check it works

```bash
node plugins/content/skills/image/scripts/kie.mjs probe
```

This prints your current credit balance and nothing else. It confirms that
the key resolves and is valid, and it spends nothing. If it fails, the
message names what it looked for (an environment variable, `.env`, or the
config key). Fix that, then run it again.

## Common errors

- **`could not resolve the kie.ai key`.** Nothing is set. Set
  `KIE_AI_API_KEY`, or check `media.providers.kie.keyRef` and `secrets.tool`
  in your config.
- **401 or unauthorized on `probe`.** The key is wrong or revoked, or you
  copied it with extra whitespace.
- **402 on a `still` or `shot` call.** You are out of credit. Top up, then run
  `probe` again to confirm the new balance before you retry.
- **A field-not-found error from `createTask`, with no field named.** See the
  troubleshooting section in the `content:image` skill. It is almost always a
  missing required field or an unconfirmed aspect ratio, not an account
  problem.
