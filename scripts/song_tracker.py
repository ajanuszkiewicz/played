#!/usr/bin/env python3
"""
Song Tracker Daemon — ShazamIO edition
Captures audio from ALSA input, identifies songs via ShazamIO
(free, no API key required), and stores results in a SQLite database.
"""

import audioop
import os
import select
import sys
import time
import signal
import logging
import logging.handlers
import sqlite3
import hashlib
import asyncio
import subprocess
import tempfile
import threading
import wave
from datetime import datetime
from pathlib import Path

from shazamio import Shazam

# ── Configuration ──────────────────────────────────────────────────────────────
DB_PATH           = os.getenv("DB_PATH", "/var/lib/song-tracker/songs.db")
AUDIO_DEVICE      = os.getenv("AUDIO_DEVICE", "default")
AUDIO_FIFO        = os.getenv("AUDIO_FIFO", "/var/lib/song-tracker/audio.fifo")
SAMPLE_DURATION   = int(os.getenv("SAMPLE_DURATION", "10"))
POLL_INTERVAL     = int(os.getenv("POLL_INTERVAL", "45"))
SILENCE_THRESHOLD = int(os.getenv("SILENCE_THRESHOLD", "500"))
SILENCE_DURATION  = int(os.getenv("SILENCE_DURATION", "2"))
RETRY_INTERVAL    = int(os.getenv("RETRY_INTERVAL", "30"))
MONITOR_MODE      = os.getenv("MONITOR_MODE", "continuous")
LOG_LEVEL         = os.getenv("LOG_LEVEL", "INFO")

# ── Logging ────────────────────────────────────────────────────────────────────
class _HourlyPurgeHandler(logging.handlers.TimedRotatingFileHandler):
    """Rotate every hour but discard old content instead of keeping backups."""
    def doRollover(self):
        if self.stream:
            self.stream.close()
            self.stream = None
        open(self.baseFilename, "w").close()
        self.stream = self._open()
        self.rolloverAt = self.computeRollover(int(time.time()))

log_handlers = [logging.StreamHandler(sys.stdout)]

log_path = "/var/log/song-tracker.log"
try:
    with open(log_path, "a") as f:
        pass
    log_handlers.append(_HourlyPurgeHandler(log_path, when="h", interval=1, backupCount=0))
except PermissionError:
    pass  # journald will capture stdout anyway

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL),
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=log_handlers,
)
log = logging.getLogger(__name__)

running = True

def handle_signal(sig, frame):
    global running
    log.info("Shutdown signal received, stopping...")
    running = False

signal.signal(signal.SIGTERM, handle_signal)
signal.signal(signal.SIGINT, handle_signal)


# ── Database ───────────────────────────────────────────────────────────────────
def init_db(path: str) -> sqlite3.Connection:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS songs (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            played_at    TEXT NOT NULL,
            title        TEXT NOT NULL,
            artist       TEXT NOT NULL,
            album        TEXT,
            release_date TEXT,
            cover_art    TEXT,
            apple_id     TEXT,
            shazam_key   TEXT,
            fingerprint  TEXT UNIQUE,
            raw_json     TEXT
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_played_at ON songs(played_at DESC)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_artist ON songs(artist)")
    conn.commit()
    log.info("Database initialised at %s", path)
    return conn


def record_song(conn: sqlite3.Connection, track: dict, fingerprint: str) -> bool:
    now = datetime.utcnow().isoformat(timespec="seconds") + "Z"

    album, release_date = None, None
    for section in track.get("sections", []):
        for meta in section.get("metadata", []):
            title = meta.get("title", "").lower()
            if "album" in title:
                album = meta.get("text")
            elif "released" in title or "year" in title:
                release_date = meta.get("text")

    try:
        conn.execute("""
            INSERT OR IGNORE INTO songs
              (played_at, title, artist, album, release_date,
               cover_art, apple_id, shazam_key, fingerprint, raw_json)
            VALUES (?,?,?,?,?,?,?,?,?,?)
        """, (
            now,
            track.get("title", "Unknown"),
            track.get("subtitle", "Unknown"),
            album,
            release_date,
            track.get("images", {}).get("coverarthq") or track.get("images", {}).get("coverart"),
            str(track.get("key")),
            str(track.get("key")),
            fingerprint,
            str(track),
        ))
        conn.commit()
        if conn.execute("SELECT changes()").fetchone()[0]:
            log.info("Recorded: %s — %s", track.get("subtitle"), track.get("title"))
            return True
        log.debug("Duplicate fingerprint, skipping.")
        return False
    except sqlite3.Error as e:
        log.error("DB error: %s", e)
        return False


# ── Audio Capture ──────────────────────────────────────────────────────────────
def capture_audio(device: str, duration: int) -> str | None:
    """Record audio to a temp WAV file via arecord; returns path or None."""
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    cmd = [
        "arecord",
        "-D", device,
        "-f", "S16_LE",      # 16-bit signed
        "-r", "44100",       # 44100 Hz
        "-c", "1",           # mono — sufficient for Shazam, lower CPU/buffer
        "-d", str(duration),
        "-q",
        tmp.name,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=duration + 5)
        if result.returncode != 0:
            log.error("arecord failed: %s", result.stderr.decode())
            Path(tmp.name).unlink(missing_ok=True)
            return None
        return tmp.name
    except subprocess.TimeoutExpired:
        log.error("arecord timed out")
        Path(tmp.name).unlink(missing_ok=True)
        return None
    except FileNotFoundError:
        log.error("arecord not found — install alsa-utils")
        return None


def audio_fingerprint(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read(4096)).hexdigest()[:16]


def is_silent(path: str) -> bool:
    """Return True if the WAV file's RMS level is below SILENCE_THRESHOLD."""
    try:
        with wave.open(path, "rb") as wf:
            frames = wf.readframes(wf.getnframes())
            rms = audioop.rms(frames, wf.getsampwidth())
        if rms < SILENCE_THRESHOLD:
            log.debug("Audio is silent (RMS %d < threshold %d), skipping.", rms, SILENCE_THRESHOLD)
            return True
        return False
    except Exception as e:
        log.warning("Could not check audio levels: %s", e)
        return False


# ── Song Identification (ShazamIO) ─────────────────────────────────────────────
async def _recognize(wav_path: str) -> dict | None:
    try:
        shazam = Shazam()
        result = await shazam.recognize(wav_path)
        return result.get("track")
    except Exception as e:
        log.error("ShazamIO error: %s", e)
        return None


def identify_song(wav_path: str) -> dict | None:
    return asyncio.run(_recognize(wav_path))


# ── Audio FIFO (live stream tap) ───────────────────────────────────────────────
def open_fifo_writer(path: str) -> int:
    """Create the FIFO if needed and open it for non-blocking write.
    O_RDWR keeps the open from blocking when no reader is connected."""
    try:
        os.mkfifo(path, 0o666)
    except FileExistsError:
        pass
    return os.open(path, os.O_RDWR | os.O_NONBLOCK)


def fifo_write(fd: int, data: bytes) -> None:
    """Write chunk to FIFO, silently dropping if the buffer is full or no reader."""
    try:
        os.write(fd, data)
    except BlockingIOError:
        pass  # no reader connected or kernel buffer full — drop and continue


# ── Continuous monitoring helpers ──────────────────────────────────────────────
def open_arecord(device: str) -> subprocess.Popen:
    """Start a long-running arecord process that streams PCM audio to stdout."""
    return subprocess.Popen(
        ["arecord", "-D", device, "-f", "S16_LE", "-r", "44100", "-c", "1", "-q"],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )


def write_wav(pcm_bytes: bytes, path: str) -> None:
    """Write raw S16_LE mono 44100Hz PCM bytes to a proper WAV file."""
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(44100)
        wf.writeframes(pcm_bytes)


def _identify_worker(
    conn: sqlite3.Connection,
    pcm_bytes: bytes,
    done_event: threading.Event,
    last_song: list,
    last_song_lock: threading.Lock,
    retry_after: list,
) -> None:
    """Background thread: write PCM to WAV, identify via Shazam, record result."""
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    try:
        write_wav(pcm_bytes, tmp.name)
        fp     = audio_fingerprint(tmp.name)
        result = identify_song(tmp.name)
        if result:
            current = (result.get("title", ""), result.get("subtitle", ""))
            with last_song_lock:
                if current == last_song[0]:
                    log.debug("Consecutive duplicate (%s — %s), skipping.", current[1], current[0])
                else:
                    record_song(conn, result, fp)
                    last_song[0] = current
            retry_after[0] = None
            done_event.clear()
        else:
            log.debug("Song not identified — retrying in %ds.", RETRY_INTERVAL)
            retry_after[0] = time.time() + RETRY_INTERVAL
    except Exception as e:
        log.error("Identification worker error: %s", e)
        retry_after[0] = time.time() + RETRY_INTERVAL
    finally:
        Path(tmp.name).unlink(missing_ok=True)
        # done_event stays set until retry_after elapses or silence resets it


# ── Main Loops ─────────────────────────────────────────────────────────────────
def interval_loop(conn: sqlite3.Connection) -> None:
    """Original fixed-interval poll loop."""
    last_song: tuple[str, str] | None = None

    while running:
        log.debug("Capturing %d seconds of audio...", SAMPLE_DURATION)
        wav_path = capture_audio(AUDIO_DEVICE, SAMPLE_DURATION)

        if wav_path is None:
            log.warning("Audio capture failed, retrying in %ds", POLL_INTERVAL)
            time.sleep(POLL_INTERVAL)
            continue

        try:
            if is_silent(wav_path):
                last_song = None
            else:
                fp     = audio_fingerprint(wav_path)
                result = identify_song(wav_path)
                if result:
                    current = (result.get("title", ""), result.get("subtitle", ""))
                    if current == last_song:
                        log.debug("Consecutive duplicate (%s — %s), skipping.", current[1], current[0])
                    else:
                        record_song(conn, result, fp)
                        last_song = current
                else:
                    log.debug("Song not identified.")
        finally:
            Path(wav_path).unlink(missing_ok=True)

        for _ in range(POLL_INTERVAL):
            if not running:
                break
            time.sleep(1)


def continuous_loop(conn: sqlite3.Connection) -> None:
    """Continuous monitoring loop — triggers identification on audio-after-silence."""
    CHUNK_FRAMES         = int(44100 * 0.2)           # 200ms per chunk
    CHUNK_BYTES          = CHUNK_FRAMES * 2            # S16_LE = 2 bytes/sample
    BUFFER_CHUNKS_NEEDED = int(SAMPLE_DURATION / 0.2)  # chunks to accumulate before identifying
    SILENCE_CHUNKS_NEEDED = max(1, int(SILENCE_DURATION / 0.2))

    state            = "WAITING"
    pcm_buffer       = bytearray()
    silence_count    = 0
    _last_status_log = 0.0
    last_song      = [None]   # list so the worker thread can mutate it
    last_song_lock = threading.Lock()
    identifying    = threading.Event()
    retry_after    = [None]   # time.time() deadline set by worker on failure
    proc           = open_arecord(AUDIO_DEVICE)
    fifo_fd        = open_fifo_writer(AUDIO_FIFO)

    log.debug("Continuous monitor started — chunk=200ms, buffer=%ds, silence_reset=%ds",
              SAMPLE_DURATION, SILENCE_DURATION)

    arecord_fd  = proc.stdout.fileno()
    read_buffer = bytearray()

    def restart_arecord(reason: str):
        nonlocal proc, arecord_fd, state, silence_count
        log.warning("%s — restarting arecord...", reason)
        try:
            proc.kill()
            proc.wait(timeout=3)
        except Exception:
            pass
        time.sleep(1)
        proc        = open_arecord(AUDIO_DEVICE)
        arecord_fd  = proc.stdout.fileno()
        state       = "WAITING"
        pcm_buffer.clear()
        read_buffer.clear()
        silence_count = 0

    try:
        while running:
            ready, _, _ = select.select([arecord_fd], [], [], 5)
            if not ready:
                restart_arecord("arecord stopped producing audio")
                continue

            data = os.read(arecord_fd, CHUNK_BYTES)
            if not data:
                restart_arecord("arecord stream ended unexpectedly")
                continue

            read_buffer += data
            if len(read_buffer) < CHUNK_BYTES:
                continue  # wait until a full chunk is assembled

            chunk = bytes(read_buffer[:CHUNK_BYTES])
            del read_buffer[:CHUNK_BYTES]

            fifo_write(fifo_fd, chunk)
            rms     = audioop.rms(chunk, 2)
            is_loud = rms >= SILENCE_THRESHOLD

            now = time.time()

            if state == "WAITING":
                if is_loud:
                    pcm_buffer = bytearray(chunk)
                    state = "BUFFERING"
                    _last_status_log = now
                    log.debug("[WAITING→BUFFERING] Audio detected (RMS %d), buffering...", rms)
                elif now - _last_status_log >= 10:
                    log.debug("[WAITING] Silence (RMS %d, threshold %d)", rms, SILENCE_THRESHOLD)
                    _last_status_log = now

            elif state == "BUFFERING":
                pcm_buffer += chunk
                buffered_s = len(pcm_buffer) / CHUNK_BYTES * 0.2
                if len(pcm_buffer) >= CHUNK_BYTES * BUFFER_CHUNKS_NEEDED:
                    if not identifying.is_set():
                        identifying.set()
                        snapshot = bytes(pcm_buffer)
                        threading.Thread(
                            target=_identify_worker,
                            args=(conn, snapshot, identifying, last_song, last_song_lock, retry_after),
                            daemon=True,
                        ).start()
                        log.debug("[BUFFERING→COOLDOWN] %.1fs buffered, sending to Shazam.", buffered_s)
                    else:
                        log.debug("[BUFFERING→COOLDOWN] %.1fs buffered, identification already in flight.", buffered_s)
                    state = "COOLDOWN"
                    silence_count = 0
                    _last_status_log = now
                elif not is_loud:
                    silence_count += 1
                    if silence_count >= BUFFER_CHUNKS_NEEDED:
                        log.debug("[BUFFERING→WAITING] Audio dropped — %.1fs buffered, resetting.", buffered_s)
                        state = "WAITING"
                        pcm_buffer.clear()
                        silence_count = 0
                        _last_status_log = now
                    elif now - _last_status_log >= 2:
                        log.debug("[BUFFERING] Silent chunk (RMS %d) — %.1fs buffered so far.", rms, buffered_s)
                        _last_status_log = now
                else:
                    silence_count = 0
                    if now - _last_status_log >= 2:
                        log.debug("[BUFFERING] %.1fs / %ds buffered (RMS %d).", buffered_s, SAMPLE_DURATION, rms)
                        _last_status_log = now

            elif state == "COOLDOWN":
                if retry_after[0] is not None and now >= retry_after[0]:
                    retry_after[0] = None
                    identifying.clear()
                    state = "WAITING"
                    silence_count = 0
                    pcm_buffer.clear()
                    _last_status_log = now
                    log.debug("[COOLDOWN→WAITING] Retry interval elapsed, listening for audio again.")
                elif not is_loud:
                    silence_count += 1
                    if silence_count >= SILENCE_CHUNKS_NEEDED:
                        retry_after[0] = None
                        identifying.clear()
                        state = "WAITING"
                        silence_count = 0
                        pcm_buffer.clear()
                        _last_status_log = now
                        log.debug("[COOLDOWN→WAITING] Silence confirmed, ready for next track.")
                    elif now - _last_status_log >= 10:
                        if retry_after[0] is not None:
                            log.debug("[COOLDOWN] Silence (RMS %d) — retrying in %.0fs.", rms, max(0, retry_after[0] - now))
                        else:
                            log.debug("[COOLDOWN] Silence (RMS %d) — waiting for track end.", rms)
                        _last_status_log = now
                else:
                    silence_count = 0
                    if now - _last_status_log >= 10:
                        if retry_after[0] is not None:
                            log.debug("[COOLDOWN] Audio playing (RMS %d) — retrying in %.0fs.", rms, max(0, retry_after[0] - now))
                        else:
                            log.debug("[COOLDOWN] Audio playing (RMS %d) — waiting for silence.", rms)
                        _last_status_log = now
    finally:
        os.close(fifo_fd)
        proc.terminate()
        proc.wait()


def main():
    log.info("Song Tracker (ShazamIO) starting — device=%s, mode=%s",
             AUDIO_DEVICE, MONITOR_MODE)
    conn = init_db(DB_PATH)

    try:
        if MONITOR_MODE == "continuous":
            continuous_loop(conn)
        else:
            interval_loop(conn)
    finally:
        conn.close()
        log.info("Song Tracker stopped.")


if __name__ == "__main__":
    main()
