---
name: transcribe
description: Turn a reel, TikTok, YouTube or X video — or a local audio/video file — into timestamped text an LLM can use. Use when the user shares a video link or a local audio/video file and wants to know what is said in it — "transcribe this", "what does this video say", "extract the transcript", "summarize this reel", "turn this reel into notes". Handles the whole chain: installing tools, downloading, fetching published subtitles when they exist, and running local speech recognition when they do not.
---

# Transcribe

Runs on: your Mac. Free, local, no API key, nothing leaves the machine
except the download itself.

It turns a reel or a clip into a timestamped transcript. Paste it back into a
conversation, summarize it, or mine it for hooks and structure.

One command does everything — dependency install, download, subtitle
lookup, speech recognition, and output:

```bash
python3 scripts/transcribe.py "<url-or-file>"
```

Run it from this skill's folder, or give the full path to
`scripts/transcribe.py` in this skill's folder. It prints a timestamped
transcript and writes `.srt` and `.txt` next to each other. Paste the URL
exactly as the user gave it; the script salvages the doubled-up,
token-stuffed strings that Instagram's share sheet produces.

## What it does, in order

1. **Installs what is missing, and says so first.** The first run installs
   `yt-dlp` (to download) and one ASR engine package — `mlx-whisper` on
   Apple silicon, `faster-whisper` off it, or `parakeet-mlx` if you ask for
   that engine — all into a private venv at `~/.cache/claude-transcribe/venv`.
   Nothing is installed system-wide or via Homebrew. First run costs a
   minute or two plus the model download from Hugging Face; later runs
   reuse all of it. `ffmpeg` is the one thing it will not install for you,
   because installing it needs `brew` (Mac) or `sudo` (Linux) — it tells you
   the exact command instead.
2. **Tries the platform's own subtitles first.** Free, instant, and often
   human-written. YouTube nearly always has them; Instagram and TikTok
   nearly never do, so this step failing is the normal case, not an error.
   It prefers a human-written track, then that language's auto-captions, then
   an `-orig` track — never an unexamined translation. YouTube publishes the
   auto-captions machine-translated into ~30 languages under sibling codes
   like `en-ar`, and picking one of those yields a transcript that reads
   perfectly well and says something the speaker never said.
3. **Falls back to local speech recognition** on the downloaded audio.
4. **Writes and prints the result** — `.srt` with cue timings, `.txt` as one
   paragraph, and a `[m:ss] line` view on stdout.

## Options

| flag | use |
|---|---|
| `--lang xx` | skip language detection; also picks the subtitle track (ISO code) |
| `--force-asr` | ignore published subtitles and transcribe the audio |
| `--engine parakeet` | faster, English + 24 European languages, no other-language support |
| `--engine faster-whisper` | the CPU engine; the default off Apple silicon |
| `--model <hf-id>` | override the model |
| `--out DIR` | keep the files somewhere specific |

## Choosing an engine

**Default to `whisper` on Apple silicon.** `mlx-community/whisper-large-v3-turbo`
runs via MLX on the Neural Engine, handles roughly 100 languages, detects the
language itself, and emits cue timings.

Reach for `--engine parakeet` for English or mainstream-European audio where
speed matters — on a 43-second clip with both models cached, whisper-large-v3-turbo
took 6.7s against parakeet-tdt-0.6b-v3's 2.0s, and parakeet segments at
sentence boundaries, which reads better. The catch: parakeet covers a fixed
set of languages, so check its docs before assuming your language is one of
them — a language being related to a supported one does not mean it is
covered.

For a language whisper-large-v3-turbo handles badly, try
`--model mlx-community/whisper-large-v3` (the full model, not turbo) — more
accurate at some cost in speed.

MLX is Apple-silicon-only, so `--engine whisper` and `--engine parakeet` are
refused with a clear error off Apple silicon rather than failing deep inside
a pip install. `--engine faster-whisper` is the CPU fallback everywhere else;
drop to `--model small` or `--model medium` if `large-v3-turbo` is too slow
for the clip in hand.

## Run it on your box instead

Optional. If you'd rather not tie up your Mac, or want this running where
your other automation lives, copy this skill to `box.ssh` from your onebox
config and run it there over SSH:

```bash
scp -r <skill-dir> "$(jq -r '.box.ssh' ~/.config/onebox/config.json):~/transcribe"
ssh "$(jq -r '.box.ssh' ~/.config/onebox/config.json)" 'python3 ~/transcribe/scripts/transcribe.py "<url-or-file>"'
```

Stick to small Whisper models there (`--model small` or `--engine
faster-whisper`, which is what a non-Apple-silicon box needs anyway) — a
small VPS has no GPU and no Neural Engine, so `large-v3-turbo` on CPU can
take several times the clip's own length to transcribe. Copying the skill
does not keep it in sync; re-run the `scp` after any local edit.

## When it fails

- **"No video formats found" / login wall** — the post is private or
  age-gated. `yt-dlp` can use browser cookies (`--cookies-from-browser
  chrome`), but that hands it the user's session; ask first.
- **Zero cues** — the clip has music and on-screen text but no speech. Say so
  rather than guessing at the words; if the content is only visual, the answer
  is a screenshot, not a transcript.
- **A wrong-language transcript** — Whisper guessed from the first 30 seconds.
  Re-run with `--lang`.

## Reporting it back

Give the timestamped view for anything with structure worth navigating, and
lead with what the video actually claims. A transcript is source material the
user asked for, so quoting it back in full is fine — but it is someone else's
recording, so keep it inside the conversation rather than republishing it.
