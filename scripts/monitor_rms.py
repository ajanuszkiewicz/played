#!/usr/bin/env python3
"""
Real-time RMS monitor for the song tracker audio device.
Shows the live RMS level with a bar, and marks the SILENCE_THRESHOLD
and IDENTIFY_THRESHOLD lines so you can see where the tracker will act.

Usage:
    python monitor_rms.py
    python monitor_rms.py --device plughw:2,0
    python monitor_rms.py --silence 500 --identify 1000
"""

import audioop
import os
import subprocess
import sys
import argparse

# ── config (mirrors env vars used by song_tracker.py) ──────────────────────────
DEVICE            = os.getenv("AUDIO_DEVICE",      "hw:1,0")
SILENCE_THRESHOLD = int(os.getenv("SILENCE_THRESHOLD", "500"))
IDENTIFY_THRESHOLD= int(os.getenv("IDENTIFY_THRESHOLD","1000"))

SAMPLE_RATE  = 44100
CHANNELS     = 1
CHUNK_MS     = 200                              # update every 200 ms
CHUNK_FRAMES = int(SAMPLE_RATE * CHUNK_MS / 1000)
CHUNK_BYTES  = CHUNK_FRAMES * 2                 # S16_LE = 2 bytes/sample
BAR_WIDTH    = 40
RMS_MAX      = 8000                             # ceiling for the bar

# ── CLI overrides ───────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser(description="Real-time RMS monitor")
parser.add_argument("--device",   default=DEVICE,             help="ALSA device")
parser.add_argument("--silence",  type=int, default=SILENCE_THRESHOLD,  help="Silence threshold")
parser.add_argument("--identify", type=int, default=IDENTIFY_THRESHOLD, help="Identify threshold")
args = parser.parse_args()

DEVICE             = args.device
SILENCE_THRESHOLD  = args.silence
IDENTIFY_THRESHOLD = args.identify

# ── helpers ─────────────────────────────────────────────────────────────────────
def make_bar(rms: int) -> str:
    filled = int(BAR_WIDTH * min(rms, RMS_MAX) / RMS_MAX)
    bar    = "█" * filled + "░" * (BAR_WIDTH - filled)

    silence_pos  = int(BAR_WIDTH * SILENCE_THRESHOLD  / RMS_MAX)
    identify_pos = int(BAR_WIDTH * IDENTIFY_THRESHOLD / RMS_MAX)

    # overlay threshold markers on the bar string
    bar_list = list(bar)
    if 0 <= silence_pos  < BAR_WIDTH: bar_list[silence_pos]  = "│"
    if 0 <= identify_pos < BAR_WIDTH: bar_list[identify_pos] = "│"
    return "".join(bar_list)

def label(rms: int) -> str:
    if rms < SILENCE_THRESHOLD:
        return "SILENT  "
    if rms < IDENTIFY_THRESHOLD:
        return "AUDIO   "
    return "IDENTIFY"

# ── main ────────────────────────────────────────────────────────────────────────
def main():
    cmd = [
        "arecord",
        "-D", DEVICE,
        "-f", "S16_LE",
        "-r", str(SAMPLE_RATE),
        "-c", str(CHANNELS),
        "-t", "raw",   # raw PCM to stdout (no WAV header)
        "-q",          # quiet — suppress arecord's own output
    ]
    print(f"Monitoring {DEVICE}  |  silence={SILENCE_THRESHOLD}  identify={IDENTIFY_THRESHOLD}")
    print(f"{'─'*60}")
    print(f"  Legend:  │ = silence threshold    │ = identify threshold")
    print(f"{'─'*60}\n")

    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        while True:
            chunk = proc.stdout.read(CHUNK_BYTES)
            if not chunk:
                err = proc.stderr.read().decode(errors="replace").strip()
                print(f"\narecord process ended.{(' Error: ' + err) if err else ''}")
                break
            rms = audioop.rms(chunk, 2)
            bar = make_bar(rms)
            tag = label(rms)
            sys.stdout.write(f"\r  {tag}  [{bar}]  RMS {rms:5d}   ")
            sys.stdout.flush()
    except KeyboardInterrupt:
        print("\n\nStopped.")
    finally:
        try:
            proc.terminate()
        except Exception:
            pass

if __name__ == "__main__":
    main()
