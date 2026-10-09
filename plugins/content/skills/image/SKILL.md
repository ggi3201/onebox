---
name: image
description: Generate and edit images with kie.ai — text-to-image, image-to-image with reference photos, and an optional camera-move video. Use for App Store screenshot backgrounds, landing page hero images, social post images, app mockup scenes, or any "generate an image", "make a hero image", "edit this photo", "turn this into a background" request. Costs real money per call (a few cents per still). Needs an API key — see https://onebox.lokkesveen.com/guides/kie-ai.md.
---

# Image (kie.ai)

Runs on: your Mac, calling kie.ai's paid API. Needs an account and an API
key — follow `https://onebox.lokkesveen.com/guides/kie-ai.md` once, then come back here. Every call spends
real credits; see **Cost** below before generating a batch.

## Setup

The key comes from config, never from a value typed into a prompt:

- `media.providers.kie.keyRef` (default `KIE_AI_API_KEY`; the old
  `images.keyRef` still works)
- read as every onebox script reads a secret: the environment, then
  `secrets.command`, then the nearest `.env`
  (https://github.com/ggi3201/onebox/blob/main/CONFIG.md, "Secrets")

The common case needs no config file: set `KIE_AI_API_KEY` in the
environment, or drop it in a `.env` file anywhere from your project up to
your home directory. `scripts/kie.mjs` never prints the key.

## Commands

```bash
node scripts/kie.mjs probe                                          # credit balance — run before and after a batch
node scripts/kie.mjs still "<prompt>" out.png --ar 16:9              # text-to-image
node scripts/kie.mjs still "<prompt>" out.png --ref logo.png         # image-to-image (one or more --ref)
node scripts/kie.mjs shot  "<prompt>" head.png out.mp4 --dur 5       # optional: camera move over a still
```

`--model <id>` overrides the model on `still` or `shot` if you need a
different one than the defaults below. Defaults, verified against
docs.kie.ai on 2026-09-28:

`still` can also target another provider with `--provider fal|replicate`
plus `--model <id>` (that provider's own model id) and `--extra '<json>'`
for fields specific to that model — this script only knows seedream's shape
for kie.ai itself. See `https://onebox.lokkesveen.com/guides/media-providers.md` for when fal.ai or
Replicate is the better fit, and the `content:video` skill for generating
clips with the same provider layer.

| command | default model |
|---|---|
| `still` (no `--ref`) | `seedream/5-pro-text-to-image` |
| `still` (with `--ref`) | `seedream/5-pro-image-to-image` |
| `shot` | `kling/v2-1-pro` |

`shot` is optional — most tasks only need `still`. It exists for the rare
case of a short camera move over a generated scene (a hero background with
subtle drift, for example); it is slower and costs roughly 5-10x a still.

### Aspect ratio

seedream rejects some values without listing which ones it accepts — an
unsupported ratio fails at the API call with a bare "not within the range of
allowed options." Confirmed to work: `1:1`, `16:9`, `9:16`, `3:4`, `4:3`,
`3:2`, `2:3`, `21:9`. Treat that as a floor, not the full list — if you need
something else (the common social `4:5` portrait ratio is known to fail),
send one throwaway call before writing a batch of prompts around it. The
returned image lands near the ratio you asked for, not exactly on it, so
size layouts from the actual output file.

## Briefing a still

Write the prompt like a photo direction, not a caption. Cover, in order:

1. **Subject** — what's in frame, specifically enough that a photographer
   would know what to point the camera at.
2. **Composition** — where the empty space goes. Say it explicitly if copy
   or UI will sit over part of the image ("negative space in the upper
   third" beats hoping the model leaves room).
3. **Light** — direction and quality (soft window light from the left, hard
   overhead sun, warm practical lamps) does more for realism than extra
   adjectives on the subject.
4. **Lens and framing** — a focal length and distance ("35mm, eye level,
   slight low angle") reads as a real photo faster than style words do.
5. **Style** — photoreal, illustration, flat-lay, whatever the use case
   needs, stated once and last.

A few things that hold up in practice:

- **Stills are cheap — generate, look, reroll.** Don't over-engineer the
  first prompt; run it, look at the actual PNG, adjust one variable, run it
  again. Iterating on a bad frame after the fact costs more than a second
  generation would have.
- **Read every image before using it.** Generation is cheap; shipping a bad
  frame into a build or a store listing is not.
- **Pass the real asset as `--ref` for anything with a logo, product, or
  packaging.** A brand mark that drifts between images is the first thing
  anyone notices. Handing seedream the actual cutout holds up across very
  different scenes (a dark kitchen, a flat-lay, a plain studio backdrop)
  far better than describing it in words.
- **For anything composited onto a UI mockup or another image afterward**,
  match perspective, light direction, and material to the frame it will sit
  in — a generated object does not read as real just because it has a clean
  cutout. Prototype a rough placement before generating near-duplicates
  chasing a fit that a different shot would solve outright.

## Use cases

- **App Store screenshot backgrounds** — a scene behind a device mockup or
  UI capture. Generate the background separately from the UI; composite
  after.
- **Landing page hero images** — wide (`16:9` or `21:9`) scenes with
  deliberate negative space for a headline.
- **Social post images** — square or portrait, subject-forward, less
  negative space than a hero needs.
- **App mockup scenes** — a believable environment (desk, hand holding a
  phone, wall-mounted display) for a screenshot to sit inside; use `--ref`
  on the device/UI capture if it must match exactly.

## Cost

Every `still` and `shot` call spends credits, whether or not you like the
result. As of the 2026-09-28 check: a seedream still runs roughly
$0.03-$0.08 depending on quality tier, and a kling clip roughly $0.25-$0.50
for a 5-10s clip — kie.ai's own published per-call credit counts and what
actually gets debited have been observed to diverge, so treat these as
ballpark, not invoice-accurate. Run `probe` before a batch and again after
to see what it really cost; don't assume a probe delta is this batch's
spend if anything else is using the same key concurrently. Never loop
`still`/`shot` unattended — look at output before generating more.

## Troubleshooting

- **`ERROR: could not resolve the kie.ai key`** — follow `https://onebox.lokkesveen.com/guides/kie-ai.md`,
  or check `media.providers.kie.keyRef` and `secrets` in your onebox config.
- **`createTask` error naming no field** — usually a missing required field
  (`aspect_ratio`, `quality`, `output_format` for a still) or an
  unconfirmed aspect ratio; see above.
- **`probe` first, always** — if credit is at zero the account blocks new
  tasks with a 402, which is a clearer signal than a stalled `still` call.

## Finish

End with one line: the next step, as one question. "Next: <step>. Continue?".
"Yes" must be enough. Take the step from the app's plan (`/start:plan`). If
something blocks it, name only that one thing, in plain words, and offer the
fix.
