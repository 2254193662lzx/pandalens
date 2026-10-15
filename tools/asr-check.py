# -*- coding: utf-8 -*-
"""
asr-check.py — transcribes a WAV with Whisper and reports how much of the
expected text came back, so TTS output can be checked without listening to it.

    python tts/asr-check.py tts/out/test_piper.wav "期望的文本"
"""
import os
import sys

os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

import soundfile as sf  # noqa: E402
import torch  # noqa: E402
from transformers import pipeline  # noqa: E402

MODEL = os.environ.get("ASR_MODEL", "openai/whisper-small")


def load_audio(path):
    data, sr = sf.read(path, always_2d=False)
    if data.ndim > 1:
        data = data.mean(axis=1)
    if sr != 16000:                      # whisper wants 16 kHz mono
        import numpy as np
        n = int(round(len(data) * 16000 / sr))
        idx = np.linspace(0, len(data) - 1, n)
        data = np.interp(idx, np.arange(len(data)), data)
        sr = 16000
    return {"array": data.astype("float32"), "sampling_rate": sr}


def main():
    wav = sys.argv[1]
    expected = sys.argv[2] if len(sys.argv) > 2 else None
    print(f"loading ASR model {MODEL} (first run downloads it)…", flush=True)
    asr = pipeline("automatic-speech-recognition", model=MODEL, device=-1,
                   generate_kwargs={"language": "chinese", "task": "transcribe"})
    audio = load_audio(wav)
    dur = len(audio["array"]) / audio["sampling_rate"]
    out = asr(audio, return_timestamps=False)
    text = out["text"].strip()
    print(f"\n音频时长: {dur:.2f}s")
    print(f"ASR 识别: {text}")
    if expected:
        import re
        norm = lambda s: re.sub(r"[\s，。、；：！？,.;:!?\"'（）()\-—·…《》]", "", s).lower()
        exp, got = norm(expected), norm(text)
        # char-level recall of the expected string
        hit = sum(1 for ch in set(exp) if ch in got)
        print(f"\n期望文本: {expected}")
        print(f"字符覆盖率: {hit}/{len(set(exp))} = {hit / len(set(exp)) * 100:.0f}%")
        # longest common subsequence ratio as a rough similarity
        def lcs(a, b):
            prev = [0] * (len(b) + 1)
            for ca in a:
                cur = [0]
                for j, cb in enumerate(b):
                    cur.append(prev[j] + 1 if ca == cb else max(cur[-1], prev[j + 1]))
                prev = cur
            return prev[-1]
        sim = lcs(exp, got) / max(1, len(exp))
        print(f"序列相似度: {sim * 100:.0f}%")


if __name__ == "__main__":
    main()
