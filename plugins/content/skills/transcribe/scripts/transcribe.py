#!/usr/bin/env python3
"""Fetch a video's transcript: real subtitles if they exist, ASR if they don't.

Whole chain in one command — installs what is missing, downloads, transcribes,
writes .srt and .txt, prints the timestamped result.

    transcribe.py <url-or-file> [options]

The tools it leans on are installed on demand and cached in
~/.cache/claude-transcribe, so the first run pays for all later ones. The ASR
engine is chosen for the machine: MLX on Apple silicon, faster-whisper on
everything else.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import re
import shutil
import subprocess
import sys
from pathlib import Path

CACHE = Path.home() / ".cache" / "claude-transcribe"
VENV = CACHE / "venv"

# Whisper is the default engine because it is the only one here that covers
# Norwegian. Parakeet is faster but its 25 languages are English plus 24 other
# European ones, and Norwegian is not among them.
DEFAULT_WHISPER_MODEL = "mlx-community/whisper-large-v3-turbo"
DEFAULT_PARAKEET_MODEL = "mlx-community/parakeet-tdt-0.6b-v3"
DEFAULT_FASTER_WHISPER_MODEL = "large-v3-turbo"

FASTER_WHISPER_DRIVER = Path(__file__).with_name("_faster_whisper_srt.py")


def is_apple_silicon() -> bool:
    return platform.system() == "Darwin" and platform.machine() == "arm64"


def default_engine() -> str:
    """MLX runs only on Apple silicon, so everything else gets CTranslate2."""
    return "whisper" if is_apple_silicon() else "faster-whisper"


def log(message: str) -> None:
    print(f"[transcribe] {message}", file=sys.stderr)


def die(message: str) -> None:
    print(f"[transcribe] error: {message}", file=sys.stderr)
    raise SystemExit(1)


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, **kwargs)


# --- input ------------------------------------------------------------------

def normalize_url(raw: str) -> str:
    """Salvage the URL from what a share sheet actually pastes.

    Instagram's "copy link" regularly yields the same URL twice head to tail
    with a tracking token wedged between them. yt-dlp rejects that outright, so
    keep the first URL and drop the params that identify the sharer.
    """
    text = raw.strip()
    starts = [m.start() for m in re.finditer(r"https?://", text)]
    if len(starts) > 1:
        text = text[starts[0]:starts[1]]
    text = re.split(r"[?&](?:stkn|igsh|igshid|si|feature|fbclid|utm_[a-z]+)=", text)[0]
    return text.rstrip("?&")


def is_url(value: str) -> bool:
    return value.startswith(("http://", "https://"))


# --- dependencies -----------------------------------------------------------

def ensure_ffmpeg() -> None:
    """yt-dlp needs ffmpeg to extract audio; every engine needs it to decode."""
    if shutil.which("ffmpeg"):
        return

    hint = "brew install ffmpeg" if platform.system() == "Darwin" else "sudo apt install ffmpeg"
    die(f"ffmpeg is missing — install it with `{hint}`")


_YTDLP: str | None = None


def ytdlp() -> str:
    """Prefer a system yt-dlp, else pip it into the venv.

    Deliberately not via Homebrew: the venv path works the same on macOS and on
    the Linux boxes, and needs no sudo on either.
    """
    global _YTDLP
    if _YTDLP is None:
        _YTDLP = shutil.which("yt-dlp") or ensure_venv_tool("yt-dlp", "yt-dlp")
    return _YTDLP


def ensure_venv_tool(tool: str, package: str) -> str:
    """A shared venv under ~/.cache, so the ASR install is paid for once."""
    binary = VENV / "bin" / tool
    marker = VENV / f".installed-{package}"
    if binary.exists() and marker.exists():
        return str(binary)

    if not VENV.exists():
        log("creating the transcription venv (one time)")
        CACHE.mkdir(parents=True, exist_ok=True)
        run([sys.executable, "-m", "venv", str(VENV)], stdout=subprocess.DEVNULL)

    log(f"installing {package} (one time, ~1 min)")
    run([str(VENV / "bin" / "pip"), "install", "-q", package], stdout=subprocess.DEVNULL)
    if not binary.exists():
        die(f"installed {package} but {tool} is missing from the venv")
    marker.touch()
    return str(binary)


# --- acquisition ------------------------------------------------------------

def pick_subtitle_track(info: dict, lang: str | None) -> str | None:
    """Choose which caption track is actually this video's own speech.

    YouTube publishes a video's auto-captions machine-translated into ~30
    languages alongside the original, all under sibling codes like `en-ar`. A
    naive pick lands on one of those and yields a transcript that reads fine
    and says something the speaker never said, so prefer, in order: a
    human-written track in the wanted language, that language's auto-captions,
    and an `-orig` track — never an unexamined translation.
    """
    manual = {k: v for k, v in (info.get("subtitles") or {}).items() if k != "live_chat"}
    auto = info.get("automatic_captions") or {}
    wanted = lang or info.get("language")

    if wanted:
        for store in (manual, auto):
            for code in (wanted, f"{wanted}-orig"):
                if code in store:
                    return code

    # `-orig` marks the untranslated auto-caption track.
    for code in auto:
        if code.endswith("-orig"):
            return code

    # A track the uploader published by hand, in whatever language it is in.
    return next(iter(manual), None)


def fetch_subtitles(url: str, outdir: Path, lang: str | None) -> Path | None:
    """Published captions beat ASR: instant, free, and often human-written.

    YouTube has them almost always, Instagram and TikTok almost never — so
    finding none is the normal case, not an error.
    """
    log("checking for published subtitles")
    probe = subprocess.run(
        [ytdlp(), "-J", "--skip-download", url],
        capture_output=True, text=True,
    )
    if probe.returncode != 0:
        log("could not read video metadata, transcribing instead")
        return None

    try:
        info = json.loads(probe.stdout)
    except json.JSONDecodeError:
        log("unreadable video metadata, transcribing instead")
        return None

    code = pick_subtitle_track(info, lang)
    if code is None:
        log("no subtitles published for this video, transcribing instead")
        return None

    result = subprocess.run(
        [
            ytdlp(), "--skip-download",
            "--write-subs", "--write-auto-subs",
            "--sub-langs", code,
            "--convert-subs", "srt",
            "-o", str(outdir / "source.%(ext)s"),
            url,
        ],
        capture_output=True, text=True,
    )
    srt = outdir / f"source.{code}.srt"
    if result.returncode != 0 or not srt.exists():
        log(f"subtitle track {code} would not download, transcribing instead")
        return None

    kind = "human-written" if code in (info.get("subtitles") or {}) else "auto-generated"
    log(f"using {kind} subtitles ({code})")
    return srt


def download_audio(url: str, outdir: Path) -> Path:
    log("downloading audio")
    run(
        [
            ytdlp(), "-x", "--audio-format", "mp3",
            "-o", str(outdir / "audio.%(ext)s"),
            url,
        ],
        stdout=subprocess.DEVNULL,
    )
    audio = outdir / "audio.mp3"
    if not audio.exists():
        die("yt-dlp reported success but produced no audio file")
    return audio


# --- transcription ----------------------------------------------------------

def transcribe_whisper(audio: Path, outdir: Path, model: str, lang: str | None) -> Path:
    binary = ensure_venv_tool("mlx_whisper", "mlx-whisper")
    log(f"transcribing with {model}")
    cmd = [
        binary, str(audio),
        "--model", model,
        "--output-format", "srt",
        "--output-dir", str(outdir),
    ]
    if lang:
        cmd += ["--language", lang]
    run(cmd, stdout=subprocess.DEVNULL)

    srt = outdir / f"{audio.stem}.srt"
    if not srt.exists():
        die("mlx_whisper wrote no .srt")
    return srt


def transcribe_parakeet(audio: Path, outdir: Path, model: str) -> Path:
    binary = ensure_venv_tool("parakeet-mlx", "parakeet-mlx")
    log(f"transcribing with {model}")
    run(
        [
            binary, str(audio),
            "--model", model,
            "--output-format", "srt",
            "--output-dir", str(outdir),
        ],
        stdout=subprocess.DEVNULL,
    )
    srt = outdir / f"{audio.stem}.srt"
    if not srt.exists():
        die("parakeet-mlx wrote no .srt")
    return srt


# --- output -----------------------------------------------------------------

CUE = re.compile(r"(\d\d):(\d\d):(\d\d)[,.](\d\d\d)\s*-->\s*(\d\d):(\d\d):(\d\d)[,.](\d\d\d)")


def transcribe_faster_whisper(
    audio: Path, outdir: Path, model: str, lang: str | None
) -> Path:
    python = ensure_venv_tool("python", "faster-whisper")
    log(f"transcribing with faster-whisper {model} (CPU, int8)")

    srt = outdir / f"{audio.stem}.srt"
    cmd = [
        python, str(FASTER_WHISPER_DRIVER), str(audio),
        "--model", model,
        "--out", str(srt),
    ]
    if lang:
        cmd += ["--lang", lang]
    run(cmd)

    if not srt.exists():
        die("faster-whisper wrote no .srt")
    return srt


def parse_srt(path: Path) -> list[tuple[float, float, str]]:
    cues: list[tuple[float, float, str]] = []
    start = end = None
    lines: list[str] = []

    def flush() -> None:
        if start is None or not lines:
            return
        text = " ".join(lines).strip()
        # Auto-captions repeat the previous cue as a scrolling "karaoke" line.
        if text and (not cues or cues[-1][2] != text):
            cues.append((start, end, text))

    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        match = CUE.search(line)
        if match:
            flush()
            h1, m1, s1, ms1, h2, m2, s2, ms2 = (int(g) for g in match.groups())
            start = h1 * 3600 + m1 * 60 + s1 + ms1 / 1000
            end = h2 * 3600 + m2 * 60 + s2 + ms2 / 1000
            lines = []
        elif not line or line.isdigit():
            continue
        else:
            lines.append(re.sub(r"<[^>]+>", "", line))

    flush()
    return cues


def clock(seconds: float) -> str:
    minutes, secs = divmod(int(seconds), 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours:d}:{minutes:02d}:{secs:02d}" if hours else f"{minutes:d}:{secs:02d}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", help="video URL, or a path to a local audio/video file")
    parser.add_argument("--out", type=Path, help="output directory (default: a temp dir)")
    parser.add_argument("--lang", help="ISO code, e.g. no, en. Whisper guesses when omitted")
    parser.add_argument("--model", help="override the ASR model")
    parser.add_argument(
        "--engine", choices=["whisper", "parakeet", "faster-whisper"],
        default=default_engine(),
        help="whisper (MLX, the default on Apple silicon) handles any language "
             "including Norwegian; parakeet is faster but has no Norwegian; "
             "faster-whisper is the CPU engine used off Apple silicon",
    )
    parser.add_argument(
        "--force-asr", action="store_true",
        help="transcribe the audio even if the platform publishes subtitles",
    )
    args = parser.parse_args()

    outdir = args.out or (CACHE / "runs" / str(os.getpid()))
    outdir.mkdir(parents=True, exist_ok=True)

    srt: Path | None = None
    if is_url(args.source):
        url = normalize_url(args.source)
        if url != args.source.strip():
            log(f"normalized URL to {url}")
        ensure_ffmpeg()

        if not args.force_asr:
            srt = fetch_subtitles(url, outdir, args.lang)
        audio = None if srt else download_audio(url, outdir)
    else:
        source = Path(args.source).expanduser()
        if not source.exists():
            die(f"no such file: {source}")
        ensure_ffmpeg()
        audio = source

    if srt is None:
        assert audio is not None
        if args.engine != "faster-whisper" and not is_apple_silicon():
            die(f"--engine {args.engine} needs MLX, which runs only on Apple silicon")

        if args.engine == "parakeet":
            srt = transcribe_parakeet(audio, outdir, args.model or DEFAULT_PARAKEET_MODEL)
        elif args.engine == "faster-whisper":
            srt = transcribe_faster_whisper(
                audio, outdir, args.model or DEFAULT_FASTER_WHISPER_MODEL, args.lang
            )
        else:
            srt = transcribe_whisper(audio, outdir, args.model or DEFAULT_WHISPER_MODEL, args.lang)

    cues = parse_srt(srt)
    if not cues:
        die(f"{srt} parsed to zero cues — the video may have no speech")

    plain = outdir / f"{srt.stem}.txt"
    plain.write_text(" ".join(text for _, _, text in cues) + "\n", encoding="utf-8")

    print(f"# {srt}")
    print(f"# {plain}")
    print(f"# {len(cues)} cues, {clock(cues[-1][1])} long")
    print()
    for start, _, text in cues:
        print(f"[{clock(start)}] {text}")


if __name__ == "__main__":
    main()
