"""Builds the voice-over for the in-app video tutorial.

Reads src/ui/tutorial/script.json, speaks every line with the Kokoro neural
text-to-speech model (runs offline on the CPU), and writes

  public/tutorial/narration.mp3   one audio track for the whole tutorial
  src/ui/tutorial/timing.json     start and end time of every line, in seconds

The player uses the audio track as its clock, so captions and animations stay
in sync with the voice. Re-run this after editing the script.

  pip install kokoro-onnx soundfile numpy
  # model files from https://github.com/thewh1teagle/kokoro-onnx/releases (model-files-v1.0)
  python tools/tutorial/build_narration.py path/to/kokoro-v1.0.int8.onnx path/to/voices-v1.0.bin

Needs ffmpeg with libmp3lame.
"""

import json
import os
import subprocess
import sys
import tempfile

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SCRIPT = os.path.join(ROOT, "src", "ui", "tutorial", "script.json")
TIMING = os.path.join(ROOT, "src", "ui", "tutorial", "timing.json")
AUDIO = os.path.join(ROOT, "public", "tutorial", "narration.mp3")

LEAD_IN = 0.8  # silence before the first line
LINE_GAP = 0.45  # pause between lines in a chapter
CHAPTER_GAP = 1.0  # pause between chapters
TAIL = 2.0  # silence after the last line, while the end card shows
SPEED = 1.0


def spoken(line):
    text = line.get("say") or line["text"]
    return text.replace("“", "").replace("”", "").replace("’", "'")


def main(model, voices):
    with open(SCRIPT, encoding="utf-8") as f:
        script = json.load(f)
    kokoro = Kokoro(model, voices)
    voice = script.get("voice", "af_heart")

    sr = 24000
    pieces = []
    timing = []
    t = LEAD_IN
    pieces.append(np.zeros(int(LEAD_IN * sr), dtype=np.float32))
    for ci, chapter in enumerate(script["chapters"]):
        if ci:
            pieces.append(np.zeros(int((CHAPTER_GAP - LINE_GAP) * sr), dtype=np.float32))
            t += CHAPTER_GAP - LINE_GAP
        for li, line in enumerate(chapter["lines"]):
            samples, sr = kokoro.create(spoken(line), voice=voice, speed=SPEED, lang="en-us")
            samples = np.asarray(samples, dtype=np.float32)
            # Trim leading/trailing near-silence so the gaps are what we set.
            loud = np.flatnonzero(np.abs(samples) > 0.01)
            if loud.size:
                samples = samples[max(0, loud[0] - int(0.03 * sr)) : loud[-1] + int(0.08 * sr)]
            dur = len(samples) / sr
            timing.append([round(t, 3), round(t + dur, 3)])
            pieces.append(samples)
            pieces.append(np.zeros(int(LINE_GAP * sr), dtype=np.float32))
            t += dur + LINE_GAP
            print(f"{chapter['id']:>9} {li}: {dur:5.2f}s  {line['text'][:60]}")
    pieces.append(np.zeros(int((TAIL - LINE_GAP) * sr), dtype=np.float32))
    t += TAIL - LINE_GAP
    audio = np.concatenate(pieces)

    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, "narration.wav")
        sf.write(wav, audio, sr)
        os.makedirs(os.path.dirname(AUDIO), exist_ok=True)
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
             "-ar", "24000", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "64k", AUDIO],
            check=True,
        )
    with open(TIMING, "w", encoding="utf-8") as f:
        json.dump({"voice": voice, "duration": round(len(audio) / sr, 3), "lines": timing}, f)
        f.write("\n")
    print(f"total {len(audio) / sr:.1f}s -> {AUDIO} ({os.path.getsize(AUDIO) / 1024:.0f} KB)")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
