# Media providers (image and video generation)

Runs on: your Mac, where the `content:image` and `content:video` skills run.

Used by: `content:image` (`plugins/content/skills/image`) and `content:video`
(`plugins/content/skills/video`).

Both skills call a **provider**: a paid API that runs the actual model. This
page helps you pick one. Read it only if you want a provider other than the
default, kie.ai. [kie-ai.md](kie-ai.md) covers the account and the key for
the default.

Every number below is a snapshot from the date it was checked, not a live
quote. **Check the provider's own pricing page when you generate.** These
prices move. A router resells compute, and its margin changes.

## kie.ai: the default, has an adapter

One API key and one wallet in front of 30+ models (Kling, Veo, Seedance,
Runway, Hailuo/MiniMax, and more). All of them use one async flow:
`jobs/createTask`, then `jobs/recordInfo`. Pricing is in **credits**. kie.ai's
own pages put video tasks at roughly 100-500 credits per clip, and stills at a
few cents each (checked 2026-09-28). `probe` in either skill's script reports
your balance, not a price per call. The model's own market page on kie.ai has
the current rate.

Pick kie.ai when you want one key for both image and video, and you do not
need one provider's exact model. kie.ai re-hosts most popular models,
sometimes at a different price than the model's own provider.

## fal.ai: has an adapter

A queue-based REST API: `queue.fal.run/<model>`, then status, then result.
Each model has its own endpoint path. You pick the exact model id (for
example `fal-ai/kling-video/v2.1/standard/image-to-video`), with no router in
between. Auth is `Authorization: Key <FAL_KEY>` (checked against fal's docs on
2026-09-28). Pricing is quoted **per model**, often per second of video or per
image. For example, fal's own Kling tiers ranged from about $0.056/s to
$0.42/s, depending on version and resolution (checked 2026-09-28).

fal's raw REST upload endpoint is not publicly documented. Only its SDKs use
it. So the adapter here sends small reference images inline, as a base64 data
URI. fal's model docs list that as an accepted form for an `image_url` field.

Pick fal.ai when you want a specific model that fal hosts directly, or lower
latency than a router adds.

## Replicate: has an adapter

Two forms of `--model`. An official model (`owner/model`, no version id)
runs at `POST /v1/models/{owner}/{model}/predictions` with `{ input }`, and
always uses its latest version. Any other model needs
`owner/model:version_id`, and runs at the generic `POST /v1/predictions` with
`{ version, input }`. The version id is on the model's page, under
"Versions". Auth is `Authorization: Bearer <REPLICATE_API_TOKEN>`.

Uploads: a file under 256KB can go inline as a data URI. A larger file goes
to Replicate's `/v1/files` upload endpoint. You pass the URL it returns as the
input field. Pricing is quoted **per model**, usually per second of compute or
as a flat price per run, shown on the model's own Replicate page.

Pick Replicate when the model you want is hosted only there, or best there.
Of the three, it has the widest catalog of community and research models.

## Others: no adapter yet

None of these has a `scripts/providers.mjs` adapter. Each one is still an API
with the same shape as the three above: submit a job, poll for status, fetch
the result. To add one later, write the same three functions (`submit`,
`poll`, `uploadLocal`) against that provider's docs.

- **WaveSpeedAI.** A router like kie.ai, with a large model catalog. It has a
  pricing API to estimate the cost before a batch. Checked 2026-09-28: images
  from about $0.005/image, video from about $0.01/second on its fastest tier.
- **Runware.** Another router. It says it is cheaper than the models' own
  APIs. Checked 2026-09-28: images from about $0.0006/image, video from about
  $0.14/clip on its cheapest tier.
- **OpenRouter.** Mainly an LLM router. In 2026 it added an image generation
  API for 30+ image models (Gemini/"Nano Banana", GPT Image, Seedream, and
  others) that return image bytes. No video models at this check
  (2026-09-28). Useful here only for images.
- **Together AI.** Mainly an inference host for open models. It serves FLUX
  image models directly, from roughly $0.003/image for the fast "schnell"
  tier up to $0.03/image for FLUX.2 Pro (checked 2026-09-28). No general
  video catalog at this check.

## How pricing is quoted

Three shapes show up across these providers. If you mix them up, you can
misjudge the cost of a batch:

- **Per image** (most stills): a flat price per generated image. Some
  providers have tiers by resolution or quality setting.
- **Per second of video**: the length multiplies the price. A 10s clip costs
  roughly double a 5s clip, all else equal.
- **Credits** (kie.ai, and routers in general): you buy credits in a package
  priced in dollars. Each model then uses a published number of credits per
  call. The dollars-per-credit rate and the model's credit cost are two
  separate numbers to check.

Whatever the shape, treat any number in this guide, in [kie-ai.md](kie-ai.md)
or in either skill's `SKILL.md` as a ballpark from the date it was checked.
Before a batch that matters, run `--dry-run` (video) or `probe` (either
skill, kie.ai only), and read the provider's own current pricing page.

## Where the values go

Set your choice in `~/.config/onebox/config.json` under `media`, or override
it for one call with `--provider`:

```jsonc
{
  "media": {
    "imageProvider": "kie",
    "videoProvider": "kie",
    "providers": {
      "kie": { "keyRef": "KIE_AI_API_KEY" },
      "fal": { "keyRef": "FAL_KEY" },
      "replicate": { "keyRef": "REPLICATE_API_TOKEN" }
    }
  }
}
```

Each `keyRef` is a secret reference, not the key itself. See
[CONFIG.md](https://github.com/ggi3201/onebox/blob/main/CONFIG.md).
