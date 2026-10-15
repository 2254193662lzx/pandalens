# -*- coding: utf-8 -*-
"""
dub.py — replaces the demo video's narration with an open-source TTS voice.

The video itself is never re-encoded: only the audio track is rebuilt and muxed
back in with `-c:v copy`, so the picture and the burned-in captions stay exactly
as they were. Each scene's narration is fitted into that scene's original time
slot (neural rate + a small atempo correction, then silence padding), which keeps
audio and picture in sync and the total length unchanged.

TTS: edge-tts (open-source project, GPL-3.0) — zh-CN-XiaoxiaoNeural.

    python tools/dub.py [--voice V] [--rate +18%] [--dry]
"""
import os
import re
import subprocess
import sys
import json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VIDEO = os.path.join(ROOT, "video", "PandaLens-demo.mp4")
SRT = os.path.join(ROOT, "video", "PandaLens-demo.zh.srt")
RECORD_JS = os.path.join(ROOT, "tools", "record.js")
WORK = os.path.join(ROOT, "tts", "dub")
FFMPEG = os.path.join(ROOT, "tools", "node_modules", "ffmpeg-static", "ffmpeg.exe")

VOICE = "zh-CN-XiaoxiaoNeural"
RATE = "+18%"
GAP = 0.35          # silence kept before the next scene starts
# only ever speed a scene up (never stretch it slower — that would add
# artefacts to the neural voice); a short narration simply gains a pause
ATEMPO_MIN, ATEMPO_MAX = 1.0, 1.3

argv = sys.argv[1:]
DRY = "--dry" in argv
for flag in ("--voice", "--rate"):
    if flag in argv:
        val = argv[argv.index(flag) + 1]
        if flag == "--voice":
            VOICE = val
        else:
            RATE = val


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw)


def media_duration(path):
    out = subprocess.run([FFMPEG, "-hide_banner", "-i", path],
                         capture_output=True, text=True)
    m = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", out.stderr)
    if not m:
        raise RuntimeError("cannot read duration of " + path)
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))


def srt_seconds(stamp):
    h, m, rest = stamp.split(":")
    return int(h) * 3600 + int(m) * 60 + float(rest)


def scene_texts():
    """The per-scene narration scripts, in order, from the recorder."""
    src = open(RECORD_JS, encoding="utf-8").read()
    return re.findall(r"narration: '([^']*)'", src)


def scene_slots():
    """Original scene boundaries taken from the subtitle timings."""
    src = open(SRT, encoding="utf-8").read()
    starts = [srt_seconds(s) for s in re.findall(r"(\d+:\d+:\d+\.\d+) -->", src)]
    total = media_duration(VIDEO)
    slots = []
    for i, st in enumerate(starts):
        end = starts[i + 1] if i + 1 < len(starts) else total
        slots.append((st, end - st))
    return slots, total


def tts(text, out_mp3):
    run([sys.executable, "-m", "edge_tts", "--voice", VOICE, "--rate", RATE,
         "--text", text, "--write-media", out_mp3])


def main():
    os.makedirs(WORK, exist_ok=True)
    texts = scene_texts()
    slots, total = scene_slots()
    if len(texts) != len(slots):
        print(f"!! {len(texts)} narration scripts vs {len(slots)} subtitle slots")
        sys.exit(1)
    print(f"video {total:.2f}s | {len(slots)} scenes | voice {VOICE} rate {RATE}")

    rows, parts = [], []
    for i, (text, (start, slot)) in enumerate(zip(texts, slots)):
        mp3 = os.path.join(WORK, f"n{i:02d}.mp3")
        if not os.path.exists(mp3) or os.path.getsize(mp3) == 0:
            tts(text, mp3)
        raw = media_duration(mp3)
        budget = slot - GAP
        tempo = max(ATEMPO_MIN, min(ATEMPO_MAX, raw / budget))
        part = os.path.join(WORK, f"p{i:02d}.wav")
        run([FFMPEG, "-hide_banner", "-loglevel", "error", "-i", mp3,
             "-af", f"atempo={tempo:.4f},apad=whole_dur={slot:.3f},aresample=44100",
             "-ac", "1", "-c:a", "pcm_s16le", "-y", part])
        got = media_duration(part)
        rows.append({"scene": i, "start": round(start, 2), "slot": round(slot, 2),
                     "tts": round(raw, 2), "tempo": round(tempo, 3), "out": round(got, 2)})
        parts.append(part)
        print(f"  scene {i:2d}  slot {slot:6.2f}s  tts {raw:6.2f}s  atempo {tempo:5.3f}  -> {got:6.2f}s")

    # concatenate into one narration track
    listfile = os.path.join(WORK, "parts.txt")
    with open(listfile, "w", encoding="utf-8") as fh:
        for p in parts:
            fh.write("file '%s'\n" % p.replace("\\", "/"))
    narration = os.path.join(WORK, "narration.wav")
    run([FFMPEG, "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0",
         "-i", listfile, "-c:a", "pcm_s16le", "-ar", "44100", "-ac", "1", "-y", narration])
    ndur = media_duration(narration)
    print(f"narration {ndur:.2f}s vs video {total:.2f}s  (drift {ndur - total:+.2f}s)")

    if DRY:
        print("dry run — nothing muxed")
        return

    # remux: picture copied untouched, audio replaced
    out = os.path.join(WORK, "PandaLens-demo-dubbed.mp4")
    run([FFMPEG, "-hide_banner", "-loglevel", "error",
         "-i", VIDEO, "-i", narration,
         "-map", "0:v:0", "-map", "1:a:0",
         "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
         # no -shortest: the picture must be copied verbatim, and the last
         # scene already ends with silence, so a slightly shorter audio tail is fine
         "-movflags", "+faststart", "-y", out])
    print(f"wrote {out} ({os.path.getsize(out) / 1048576:.1f} MB, {media_duration(out):.2f}s)")

    with open(os.path.join(WORK, "plan.json"), "w", encoding="utf-8") as fh:
        json.dump({"voice": VOICE, "rate": RATE, "video": total, "narration": ndur,
                   "scenes": rows}, fh, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
