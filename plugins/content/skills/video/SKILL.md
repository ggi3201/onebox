---
name: video
description: Generate video with kie.ai (default), fal.ai, or Replicate — text-to-video, image-to-video, first+last frame pinning, and multi-leg chains with invisible cuts. Use for App Store preview videos, landing-page hero loops, social clips, scroll-driven story sites, or any "generate a video", "animate this still", "make a camera move", "chain these shots together" request. Costs real money per call, more than a still image. Needs an API key — see https://onebox.lokkesveen.com/guides/media-providers.md and https://onebox.lokkesveen.com/guides/kie-ai.md.
---

# Video

Runs on: your Mac, or anywhere with Node 18+ — calling a paid provider API.
kie.ai is the default provider; fal.ai and Replicate also work. Needs an
account and an API key for whichever you use — read
`https://onebox.lokkesveen.com/guides/media-providers.md` once to pick a provider, then `https://onebox.lokkesveen.com/guides/kie-ai.md`
if you're staying with the default. Every call spends real credits; always
`--dry-run` a new prompt/model combination before running it for real.

**Stills first, video second.** Generating a still is cheap; generating a
clip is not. Get the still right with `content:image` — reroll it as many
times as it takes — then animate the one still you've approved. Rerolling a
five-second clip because the framing was off costs five to ten times what
rerolling the still would have.

## Setup

The key comes from config, never from a value typed into a prompt. See
the `media` section of https://github.com/ggi3201/onebox/blob/main/CONFIG.md: `media.videoProvider` (default `kie`) and
`media.providers.<name>.keyRef`. The common case needs no config file: set
`KIE_AI_API_KEY` in the environment, or drop it in a `.env` file anywhere
from your project up to your home directory. `scripts/video.mjs` never
prints the key, and it isn't read at all for `--help`, no-args usage, or
`--dry-run`.

## Commands

```bash
node <skill-dir>/scripts/video.mjs probe                                                    # kie.ai credit balance
node <skill-dir>/scripts/video.mjs text-to-video  "<prompt>" out.mp4 --ar 16:9 --dur 5
node <skill-dir>/scripts/video.mjs image-to-video "<prompt>" head.png out.mp4               # first frame only
node <skill-dir>/scripts/video.mjs image-to-video "<prompt>" head.png out.mp4 --tail last.png  # first + last frame (tail pinning)
node <skill-dir>/scripts/video.mjs chain out/ head.png --legs 3 --prompt "<one camera move for every leg>"
```

`--dry-run` on any generating command prints the exact request (provider,
model, input) and a cost estimate where one is known, and calls nothing —
use it on every new combination before spending credits.

### Options

| Flag | Meaning |
|---|---|
| `--provider kie\|fal\|replicate` | default: `media.videoProvider`, else `kie` |
| `--model <id>` | override the default model for the command (see table below) |
| `--dur <seconds>` | clip length; each model has its own allowed values, see the table |
| `--ar <16:9\|9:16\|...>` | aspect ratio, where the model takes one |
| `--resolution <720p\|1080p\|...>` | where the model takes one |
| `--seed <n>` | forwarded on fal/Replicate; on kie.ai only via `--extra` (none of the models below expose one — see the file header) |
| `--extra '<json>'` | merged on top of the built request — the escape hatch for a field this script doesn't know about, or a provider it has no built-in shape for |
| `--tail <img>` | (`image-to-video` only) pin the last frame too, not just the first |

## Verified kie.ai video models (checked 2026-09-28 against docs.kie.ai)

| Model id | Takes | Frames | Notes |
|---|---|---|---|
| `kling-2.6/text-to-video` | text | — | default for `text-to-video`. `duration` is `"5"` or `"10"` only |
| `kling-2.6/image-to-video` | image | first only | default for `image-to-video` with no `--tail` |
| `kling/v3-turbo-image-to-video` | image | first only | `resolution` 720p/1080p |
| `kling/v2-1-pro` | image | first + tail | the model `content:image`'s `shot` command already uses |
| `veo-3-1` | text or image | first, or first+last | Google Veo, served through kie.ai's unified endpoint, not a dedicated one. `resolution` up to 4k |
| `bytedance/seedance-2` | text or image | first, last, or both | default for `image-to-video --tail` and for `chain` — the only one here with native `first_frame_url`/`last_frame_url` input fields |
| `runway` | text or image | first only | no tail/last-frame field |
| `minimax-h3/text-to-video` | text | — | text-to-video only; no image input in the docs as of this check |

Only kie.ai gets a hand-built request from this script. For `--provider fal`
or `--provider replicate`, pass `--model <id>` and put the model's own input
fields in `--extra '<json>'` — the provider layer (`scripts/providers.mjs`)
only handles submit/poll/download, not per-model field names, for those two.
See `https://onebox.lokkesveen.com/guides/media-providers.md`.

## `chain`: legs with invisible cuts

`chain` generates N legs where leg *N*'s last frame becomes leg *N+1*'s
first frame, so the cut between them is frame-identical and invisible. Give
it one shared `--prompt` (the same camera move repeated) or `--prompts
"p1|p2|p3"` (one move per leg, pipe-separated, exactly N of them). Add
`--final-tail img.png` to close the last leg on a specific frame — a full
loop, for instance.

Only a model with a last-frame input works here (`kling/v2-1-pro`,
`bytedance/seedance-2` — the default — or `veo-3-1`); the command refuses
any other model up front.

**`chain` needs ffmpeg; nothing else does.** Each leg starts from the last
frame of the one before, and ffmpeg cuts it from the clip
(`ffmpeg -sseof -0.05 ...`). Without ffmpeg, `chain` with more than one leg
stops before anything is sent, so no leg is paid for. Install it with
`brew install ffmpeg`.

## Shot brief

Write one of these before generating, per shot — cheap to redo on paper,
expensive to redo on video:

```
Subject:        what's in frame, specifically
First frame:     the exact starting composition (or: the still it's animating)
Last frame:      the exact ending composition, if pinned — otherwise "open"
Camera move:     one move only (slow push-in, slow orbit, slight drift) —
                 never combine two moves in one shot
Duration:        seconds
Aspect ratio:    16:9 / 9:16 / 1:1 / ...
Must not change:  the one or two things a viewer would notice drifting
                 (a logo, a face, a product's shape) — call these out
                 explicitly so you catch it on the first look, not the fifth
```

## Lessons that hold up in practice

- **One consistent look across every asset in a sequence** — same lens
  description, same light direction, same palette — in every prompt. This
  is what makes separately generated clips read as one shoot rather than a
  slideshow.
- **One camera move per shot, described plainly.** "Slow push-in" or "slow
  orbit," not both, and not "the camera moves suddenly, then dollies out
  while rotating" — motion models degrade fast on compound moves.
- **Keep the subject still-ish.** A camera move animates the frame around a
  subject; a subject that also moves a lot invites warping. Push the motion
  into the camera, not the thing in front of it.
- **Look at every clip before using it.** A bad take costs nothing extra to
  reject; a bad take that ships costs a redo cycle plus the embarrassment.
- **Mobile/vertical framing is its own composition, not a crop.** A 16:9
  clip center-cropped to 9:16 throws away whatever was in the side
  negative space. If a vertical cut matters, generate it at `9:16`
  natively, or compose the original with the subject already centered and
  copy in a bottom band rather than to the side.
- **Budget rerolls up front.** Decide, before generating, how many retries
  a shot gets before you change the brief instead of the seed. Video is
  expensive enough that "just try again" without a cap is how a batch runs
  away from its estimate.

## Use cases

- **App Store preview videos** — a few seconds of the app in a real
  context, or a still-to-motion hero shot for the listing.
- **Landing-page hero loops** — a slow, seamless camera move behind a
  headline; `chain` with `--final-tail` set back to the first frame gives a
  loop with no visible seam.
- **Social clips** — short, subject-forward, usually `9:16` or `1:1`.
- **Scroll-driven story sites** — a `chain` of legs whose cuts disappear
  under the scrub, one per beat of the story.

## Troubleshooting

- **`could not resolve secret ...`** — follow `https://onebox.lokkesveen.com/guides/media-providers.md` and
  `https://onebox.lokkesveen.com/guides/kie-ai.md`, or check `media.videoProvider` /
  `media.providers.<name>.keyRef` in your onebox config.
- **`chain` stops with "chain needs ffmpeg"** — install ffmpeg. Nothing was
  sent.
- **A clip fails after it was submitted** — the script printed
  `submitted: <provider> job <id>` first. The job may still finish on your
  account: look it up there by that id.
- **A field-not-found error from `createTask`** — usually a value outside
  what that specific model accepts (see the table above); `--dry-run` first
  to see the exact request being built.
- **`probe` only works for kie.ai** — check fal.ai's or Replicate's own
  dashboard for balance on those providers.

## Finish

End with one line: the next step, as one question. "Next: <step>. Continue?".
"Yes" must be enough. Take the step from the app's plan (`/start:plan`). If
something blocks it, name only that one thing, in plain words, and offer the
fix.
