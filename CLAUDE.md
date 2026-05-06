# Song Tracker — Project Context for Claude Code

## Project Overview

A Raspberry Pi-based system that listens via a USB microphone, identifies
songs using ShazamIO (free, no API key), stores them in a SQLite database,
and serves a web dashboard on the local network.

## Hardware

- **Pi:** Raspberry Pi 2 Model B (900MHz quad-core ARMv7, 1GB RAM, 32-bit OS)
- **OS:** Raspberry Pi OS Lite 32-bit (Bookworm / Debian 12), Python 3.11
- **Wi-Fi:** D-Link DWA-121 (RTL8188EU chipset, `r8188eu` kernel driver)
- **Audio:** TROND AC2 USB audio adapter (C-Media CM100B chipset), **line-in** input
  - Recording in mono (`-c 1`) — sufficient for Shazam and keeps buffer/CPU usage low
  - Use `plughw:X,0` not `hw:X,0` (plughw handles format conversion)
  - Card number found via `arecord -l` — currently card 2 (`plughw:2,0`)

## Project Structure

```
rpi-song-tracker/
├── scripts/
│   ├── song_tracker.py     # Main daemon — records audio, identifies songs
│   └── web_server.py       # Flask web server — REST API + dashboard
├── web/
│   └── index.html          # Single-page dashboard (vanilla JS, dark theme)
├── systemd/
│   ├── song-tracker.service
│   └── song-tracker-web.service
├── env.example             # Config template
├── install.sh              # Installer script
└── README.md
```

## Deployment Paths (on the Pi)

| Purpose            | Path                                          |
|--------------------|-----------------------------------------------|
| Python scripts     | `/usr/local/bin/song-tracker/`                |
| Virtual env        | `/usr/local/bin/song-tracker/venv/`           |
| Web dashboard      | `/usr/local/bin/song-tracker/web/`            |
| SQLite database    | `/var/lib/song-tracker/songs.db`              |
| Config / env file  | `/etc/song-tracker/env`                       |
| Log file           | `/var/log/song-tracker.log`                   |
| Temp audio files   | `/var/lib/song-tracker/tmp/`                  |
| Systemd services   | `/etc/systemd/system/song-tracker*.service`   |
| Service user       | `song-tracker` (member of `audio` group)      |

## Configuration (env file)

```bash
AUDIO_DEVICE=plughw:2,0     # Use plughw, not hw. Card number may vary.
SAMPLE_DURATION=10           # Seconds of audio per capture
POLL_INTERVAL=45             # Seconds between attempts
SILENCE_THRESHOLD=500        # RMS floor; skip Shazam if audio is below this
DB_PATH=/var/lib/song-tracker/songs.db
WEB_HOST=0.0.0.0
WEB_PORT=8080
LOG_LEVEL=INFO               # Set to DEBUG for verbose output
```

## Key Technical Decisions

- **ShazamIO** used instead of AudD API — free, no API key, reverse-engineered
  Shazam API. Requires `ffmpeg` and `libopenblas-dev` on the Pi.
- **Mono audio** — TROND mic jack is mono. `arecord` flags: `-f S16_LE -r 44100 -c 1`
- **plughw** — required instead of `hw` because the TROND doesn't natively
  support mono at the hardware level; ALSA's plughw handles conversion.
- **TMPDIR** set to `/var/lib/song-tracker/tmp` — required because
  `ProtectSystem=strict` in the systemd service blocks access to `/tmp`.
- **WEB_DIR** in `web_server.py` uses `Path(__file__).parent / "web"` —
  must be `.parent` not `.parent.parent`.
- **libopenblas-dev** and **ffmpeg** must be installed system-wide —
  ShazamIO's numpy dependency requires OpenBLAS on ARM.

## System Dependencies

```bash
sudo apt-get install -y \
    python3 python3-venv python3-pip \
    alsa-utils \
    libopenblas-dev \
    ffmpeg
```

## Python Dependencies (venv)

```
flask
shazamio
```

## Systemd Service Notes

- Both services run as user `song-tracker`, group `audio`
- `ProtectSystem=strict` is enabled for security
- `ReadWritePaths=/var/lib/song-tracker /var/log /tmp`
- `Environment=TMPDIR=/var/lib/song-tracker/tmp`
- `StartLimitIntervalSec=0` and `StartLimitBurst=0` prevent systemd
  rate-limiting restarts during crash loops
- Script file permissions must be `644` — install script sets this

## Database Schema

```sql
CREATE TABLE songs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    played_at    TEXT NOT NULL,          -- UTC ISO8601 e.g. 2026-04-16T22:00:00Z
    title        TEXT NOT NULL,
    artist       TEXT NOT NULL,          -- from ShazamIO 'subtitle' field
    album        TEXT,
    release_date TEXT,
    cover_art    TEXT,                   -- URL from ShazamIO images
    apple_id     TEXT,
    shazam_key   TEXT,
    fingerprint  TEXT UNIQUE,            -- SHA256 of first 4KB of WAV
    raw_json     TEXT
);
```

## REST API Endpoints

| Method | Endpoint          | Description                                      |
|--------|-------------------|--------------------------------------------------|
| GET    | `/api/songs`      | Paginated history. Params: `page`, `limit`, `q`  |
| GET    | `/api/stats`      | Totals, top artists/songs, hourly activity       |
| GET    | `/api/artists`    | All artists with play counts                     |
| GET    | `/api/songs/:id`  | Single song detail                               |

## Deploy Workflow

From your local machine (after `ssh-copy-id adamj@platipi.local`):

```bash
# Sync files
rsync -av --exclude='.DS_Store' ./ adamj@platipi.local:/home/adamj/rpi-song-tracker/

# Deploy and restart on Pi
ssh adamj@platipi.local "
  sudo cp ~/rpi-song-tracker/scripts/*.py /usr/local/bin/song-tracker/ &&
  sudo chmod 644 /usr/local/bin/song-tracker/*.py &&
  sudo cp -r ~/rpi-song-tracker/web/. /usr/local/bin/song-tracker/web/ &&
  sudo chmod -R 755 /usr/local/bin/song-tracker/web/ &&
  sudo systemctl restart song-tracker song-tracker-web
"
```

Or use `./deploy.sh` if the deploy script is present in the project root.

## Useful Pi Commands

```bash
# Service management
sudo systemctl status song-tracker
sudo systemctl status song-tracker-web
sudo systemctl restart song-tracker song-tracker-web
sudo journalctl -u song-tracker -f
sudo journalctl -u song-tracker -n 50 --no-pager

# Audio debugging
arecord -l                                              # list capture devices
arecord -D plughw:2,0 -f S16_LE -r 44100 -c 1 -d 5 /tmp/test.wav  # test capture
aplay /tmp/test.wav                                     # play back test

# Real-time RMS monitor (shows live level bar + threshold markers)
/usr/local/bin/song-tracker/venv/bin/python \
  /usr/local/bin/song-tracker/monitor_rms.py
# Override device/thresholds:
AUDIO_DEVICE=plughw:2,0 SILENCE_THRESHOLD=500 IDENTIFY_THRESHOLD=1000 \
  /usr/local/bin/song-tracker/venv/bin/python \
  /usr/local/bin/song-tracker/monitor_rms.py
# Or with flags:
#   monitor_rms.py --device plughw:2,0 --silence 500 --identify 1000

# Run daemon manually (bypasses systemd for debugging)
sudo -u song-tracker \
  TMPDIR=/var/lib/song-tracker/tmp \
  AUDIO_DEVICE=plughw:2,0 \
  SAMPLE_DURATION=10 \
  POLL_INTERVAL=30 \
  DB_PATH=/var/lib/song-tracker/songs.db \
  LOG_LEVEL=DEBUG \
  /usr/local/bin/song-tracker/venv/bin/python \
  /usr/local/bin/song-tracker/song_tracker.py

# Database
sqlite3 /var/lib/song-tracker/songs.db \
  "SELECT played_at, artist, title FROM songs ORDER BY played_at DESC LIMIT 20;"

# Safe shutdown
sudo systemctl stop song-tracker song-tracker-web
sudo shutdown now
```

## Known Issues / History

- `ProtectSystem=strict` blocks `/tmp` — solved by setting `TMPDIR` to
  `/var/lib/song-tracker/tmp` in the service Environment
- `web_server.py` originally had `Path(__file__).parent.parent / "web"` —
  corrected to `.parent / "web"`
- Script files need `chmod 644` after copying or the service user gets
  Permission denied
- `libopenblas-dev` not installed by default on Pi OS Lite — numpy fails
  to import without it
- `ffmpeg` not installed by default — ShazamIO/pydub warns and fails without it
- TROND AC2 requires `plughw:` not `hw:` — `hw:` may reject format/rate combos
- Pi 2 B is slow — ShazamIO may take 30-60 seconds to process on first run
- `/var/log/song-tracker.log` must be created and chowned to `song-tracker`
  user before starting the service

## Current Status

Services are installed and configured. The daemon starts correctly and
initialises the database. Audio capture via `arecord` works when tested
manually. Full end-to-end song identification not yet confirmed working —
debugging in progress, running daemon manually with DEBUG logging is the
next step to identify where the pipeline stalls.
