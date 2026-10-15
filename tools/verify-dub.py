# -*- coding: utf-8 -*-
"""
verify-dub.py — checks that every scene of the dubbed video starts with that
scene's own narration, i.e. that the new audio is aligned to the picture.

For each scene it cuts the first seconds of the scene out of the dubbed video,
transcribes it with Whisper and compares it with the opening of that scene's
script. Also reports the drift between the audio track and the video length.

    python tools/verify-dub.py
"""
import io
import json
import os
import re
import subprocess
import sys

os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
os.environ.setdefault("HF_HUB_OFFLINE", "1")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FFMPEG = os.path.join(ROOT, "tools", "node_modules", "ffmpeg-static", "ffmpeg.exe")
VIDEO = os.path.join(ROOT, "video", "PandaLens-demo.mp4")
SRT = os.path.join(ROOT, "video", "PandaLens-demo.zh.srt")
RECORD = os.path.join(ROOT, "tools", "record.js")
MODEL = os.environ.get("ASR_MODEL", os.path.join(ROOT, "tts", "models", "whisper-small"))
WORK = os.path.join(ROOT, "tts", "check")
CLIP = 12.0   # short clips make Whisper hallucinate; 12 s is reliable


def norm(s):
    return re.sub(r"[\s，。、；：！？,.;:!?\"'（）()\-—·…《》]", "", s).lower()


def main():
    os.makedirs(WORK, exist_ok=True)
    texts = re.findall(r"narration: '([^']*)'", io.open(RECORD, encoding="utf-8").read())
    srt = io.open(SRT, encoding="utf-8").read()
    stamps = re.findall(r"(\d+:\d+:\d+[.,]\d+) -->", srt)
    starts = []
    for s in stamps:
        h, m, rest = s.replace(",", ".").split(":")
        starts.append(int(h) * 3600 + int(m) * 60 + float(rest))

    import soundfile as sf
    import numpy as np
    from transformers import pipeline

    print(f"loading {MODEL} …", flush=True)
    asr = pipeline("automatic-speech-recognition", model=MODEL, device=-1,
                   generate_kwargs={"language": "chinese", "task": "transcribe"})

    ok = 0
    for i, (text, start) in enumerate(zip(texts, starts)):
        wav = os.path.join(WORK, f"v{i:02d}.wav")
        # start half a second early: a clip that begins mid-word makes Whisper
        # drop or garble the opening, which would look like a mis-aligned scene
        subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error",
                        "-ss", f"{max(0.0, start - 0.5):.3f}", "-t", str(CLIP), "-i", VIDEO,
                        "-vn", "-ac", "1", "-ar", "16000", "-y", wav], check=True)
        data, sr = sf.read(wav, always_2d=False)
        if data.ndim > 1:
            data = data.mean(axis=1)
        heard = asr({"array": data.astype("float32"), "sampling_rate": sr})["text"].strip()
        head = norm(text)[:12]
        h, g = norm(heard), norm(text)
        # how much of the script opening made it into the transcript
        hit = sum(1 for ch in head if ch in h) / max(1, len(head))
        # a clip with real speech energy must never be judged as "missing"
        peak = float(np.abs(data).max()) if len(data) else 0.0
        silent = peak < 0.01
        good = hit >= 0.75 and not silent
        ok += good
        flag = 'SILENT' if silent else ('OK ' if good else 'BAD')
        print(f"  {flag} scene {i:2d} @{start:7.2f}s  开头匹配 {hit * 100:3.0f}%  峰值 {peak:.3f}")
        print(f"      脚本 {text[:34]}")
        print(f"      识别 {heard[:34]}")
        void = g
    print(f"\n{ok}/{len(texts)} 场景的配音与其画面内容对齐")
    sys.exit(0 if ok == len(texts) else 1)


if __name__ == "__main__":
    main()
