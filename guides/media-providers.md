# Media providers (image and video generation)

Used by: `content:image` (`plugins/content/skills/image`) and `content:video`
(`plugins/content/skills/video`).

Both skills call a **provider** — a paid API that runs the actual model. This
page is about picking one; `guides/kie-ai.md` covers the account/key side of
the default. Set your choice in `~/.config/onebox/config.json` under `media`
(see `CONFIG.md`), or override per call with `--provider`.

Every number below is a snapshot from the date it was checked, not a live
quote. **Check the provider's own pricing page at the time you actually
generate** — these prices move, and a router's whole pitch is reselling
compute at a margin that changes.

## kie.ai — default, has an adapter

One API key and wallet in front of 30+ models (Kling, Veo, Seedance, Runway,
Hailuo/MiniMax, and more), behind a single `jobs/createTask` /
`jobs/recordInfo` async flow. Pricing is in **credits**: kie.ai's own pages
put video tasks at roughly 100-500 credits per clip and stills at a few
cents each (checked 2026-09-28). `probe` in either skill's script reports
your balance, not a per-call price — the model's own market page on kie.ai
has the current rate.

Pick kie.ai when you want one key covering both image and video, and you
don't need a specific provider's exact model (kie.ai re-hosts most popular
models, sometimes at a different price than going direct).

## fal.ai — has an adapter

A queue-based REST API (`queue.fal.run/<model>` → status → result) with one
model per endpoint path — you pick the exact model id (e.g.
`fal-ai/kling-video/v2.1/standard/image-to-video`) rather than going through
a router layer. Auth is `Authorization: Key <FAL_KEY>` (verified against
fal's docs on 2026-09-28). Pricing is quoted **per model**, often per second
of video or per image — for example fal's own Kling tiers ranged from about
$0.056/s to $0.42/s depending on version and resolution (checked
2026-09-28). fal's raw REST upload endpoint isn't publicly documented (only
its SDKs handle it); the adapter here inlines small reference images as a
base64 data URI instead, which fal's model docs list as an accepted form for
an `image_url` field.

Pick fal.ai when you want a specific model fal hosts directly, or lower
latency than a router adds.

## Replicate — has an adapter

`POST /v1/predictions` with `{ version, input }`, where `version` is
`owner/model:version_id` — Replicate's generic API is keyed off a model's
specific version id, not just its name (verified against Replicate's docs
on 2026-09-28). Auth is `Authorization: Bearer <REPLICATE_API_TOKEN>`.
Uploads: a file under 256KB can go inline as a data URI; anything larger
uses Replicate's `/v1/files` upload endpoint, whose returned URL you pass
as the input field. Pricing is quoted **per model**, usually per second of
compute or a flat per-run price shown on the model's own Replicate page.

Pick Replicate when the model you want is only, or best, hosted there — it
has the widest catalog of community and research models of the three.

## Others — no adapter yet, same pattern applies

None of these have a `scripts/providers.mjs` adapter. Each is still a
submit-a-job, poll-for-status, fetch-a-result API in the same shape as the
three above, so adding one later means writing the same three functions
(`submit`, `poll`, `uploadLocal`) against that provider's docs.

- **WaveSpeedAI** — a router like kie.ai, with a large model catalog and a
  stated pricing-API for estimating cost before a batch. Checked
  2026-09-28: image generation from about $0.005/image, video from about
  $0.01/second on its fastest tier.
- **Runware** — another router, pitched on being cheaper than the models'
  own APIs. Checked 2026-09-28: images from about $0.0006/image, video from
  about $0.14/clip on its cheapest tier.
- **OpenRouter** — primarily an LLM router, but it added a dedicated image
  generation API in 2026 covering 30+ image models (Gemini/"Nano Banana",
  GPT Image, Seedream, and others) that return image bytes. No video models
  as of this check (2026-09-28). Only relevant here for image generation,
  not video.
- **Together AI** — mainly an inference host for open models; it serves
  FLUX image models directly (from roughly $0.003/image for the fast
  "schnell" tier up to $0.03/image for FLUX.2 Pro, checked 2026-09-28). No
  general video-generation catalog as of this check.

## How pricing is quoted

Three shapes show up across these providers, and mixing them up is the
easiest way to misjudge a batch's cost:

- **Per image** (most stills): a flat price per generated image, sometimes
  tiered by resolution or quality setting.
- **Per second of video**: duration multiplies the price directly — a 10s
  clip costs roughly double a 5s one, all else equal.
- **Credits** (kie.ai, and routers generally): you buy credits in a
  dollar-denominated package, then each model consumes a published number
  of credits per call. The credits-to-dollars rate and the model's
  credit cost are two separate numbers to check.

Whatever the shape, treat any number in this guide, in `guides/kie-ai.md`,
or in either skill's `SKILL.md` as a ballpark from the date it was checked —
run `--dry-run` (video) or `probe` (either skill, kie.ai only) and read the
provider's own current pricing page before a batch that matters.
