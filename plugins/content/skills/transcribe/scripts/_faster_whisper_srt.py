#!/usr/bin/env python3
"""Write an SRT with faster-whisper. Runs inside the venv, not as the skill.

faster-whisper ships no CLI, so this is the thin driver the main script calls.
It exists because MLX is Apple-silicon-only: on Linux and Intel this is the
engine that actually runs.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def timestamp(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    hours, ms = divmod(ms, 3_600_000)
    minutes, ms = divmod(ms, 60_000)
    secs, ms = divmod(ms, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{ms:03d}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio")
    parser.add_argument("--model", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--lang")
    args = parser.parse_args()

    from faster_whisper import WhisperModel

    # int8 on CPU: this engine runs where there is no CUDA GPU, and float32
    # on a large model there can run slower than the audio itself.
    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    segments, info = model.transcribe(
        args.audio,
        language=args.lang,
        vad_filter=True,
    )

    print(f"detected language: {info.language}", file=sys.stderr)

    lines: list[str] = []
    for index, segment in enumerate(segments, start=1):
        text = segment.text.strip()
        if not text:
            continue
        lines.append(str(index))
        lines.append(f"{timestamp(segment.start)} --> {timestamp(segment.end)}")
        lines.append(text)
        lines.append("")

    Path(args.out).write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
