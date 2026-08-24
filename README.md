# Raspberry Pi Song Tracker

Automatically identifies songs playing through your stereo receiver and builds a browsable history accessible on your local network. Integrates with your Discogs vinyl collection, generates AI-powered listening recommendations, and fetches lyrics on demand.

---

## How it Works

```
Receiver Line-Out → USB Audio Adapter → Raspberry Pi
                                           │
                               ┌───────────┴──────────────┐
                               │  song_tracker.py (daemon)│
                               │  • monitors audio stream │
                               │  • identifies via Shazam │
                               │  • stores in SQLite       │
                               └───────────┬──────────────┘
                                           │
                               ┌───────────┴──────────────┐
                               │  web_server.py (Flask)   │
                               │  • REST API /api/*       │
                               │  • React dashboard :8080 │
                               └──────────────────────────┘
```

Song identification uses [ShazamIO](https://github.com/dotX12/ShazamIO) — free, no API key required.

---

## Features

- **Now Playing card** — album art, artist, title, star rating, Discogs ownership badge, lyrics
- **Song history** — scrollable log with search, inline ratings, and delete
- **Discogs collection** — sync your vinyl collection and see which albums you own highlighted throughout the UI
- **AI recommendations** — ask Claude what to play next based on your collection, current song, time of day, season, and weather
- **Lyrics** — on-demand lyrics via [lrclib.net](https://lrclib.net), shown in a modal
- **Top artists** — play counts with owned-album highlights
- **Activity chart** — hourly play distribution over the last 24 hours
- **System stats** — CPU, memory, temperature, uptime, Shazam call rate
- **Demo mode** — append `?demo` to the URL to preview the UI without a live Pi

---

## Hardware

| Item | Notes |
|------|-------|
| Raspberry Pi 2B or later | Tested on Pi 2 Model B (900MHz ARMv7, 1GB RAM) |
| MicroSD card (16GB+) | Class 10 recommended |
| USB audio adapter | Must have stereo **line-in** (not mic-in) |
| 3.5mm TRS cable | Or dual-RCA to 3.5mm if your receiver has RCA outputs |
| Power supply | 5V micro-USB (Pi 2) or USB-C (Pi 4+) |

**Tested adapter:** TROND AC2 (C-Media CM100B chipset). Use `plughw:X,0` not `hw:X,0` with this adapter — ALSA's plughw handles format conversion transparently.

> Many cheap USB adapters only have a microphone input (mono, mic-level). You need one with a **stereo line-in** / line-level input.

### Wiring

Connect your receiver's **TAPE OUT**, **REC OUT**, or **PRE OUT** to the USB adapter's line input. This gives a fixed-level signal independent of the volume knob.

```
Receiver TAPE OUT ──── 3.5mm TRS ──── USB Audio Adapter LINE IN ──── Pi USB
```

---

## System Dependencies

```bash
sudo apt-get install -y \
    python3 python3-venv python3-pip \
    alsa-utils \
    libopenblas-dev \
    ffmpeg
```

`libopenblas-dev` is required for NumPy on ARM. `ffmpeg` is required by ShazamIO.

---

## Installation

```bash
# Clone the repo onto your Pi (or rsync from your dev machine)
git clone https://github.com/ajanuszkiewicz/played.git
cd played

# Run the installer
sudo bash install.sh
```

### Find your audio device

```bash
arecord -l
# e.g. "card 2: Device [TROND AC2], device 0: USB Audio"
# → use plughw:2,0
```

Test capture:
```bash
arecord -D plughw:2,0 -f S16_LE -r 44100 -c 1 -d 5 /tmp/test.wav && aplay /tmp/test.wav
```

---

## Configuration

```bash
sudo nano /etc/song-tracker/env
```

### Core settings

| Variable | Default | Description |
|----------|---------|-------------|
| `AUDIO_DEVICE` | `default` | ALSA device string — use `plughw:X,0` |
| `SAMPLE_DURATION` | `10` | Seconds of audio captured per identification |
| `POLL_INTERVAL` | `45` | Seconds between identification attempts |
| `SILENCE_THRESHOLD` | `500` | RMS level below which audio is considered silent |
| `IDENTIFY_THRESHOLD` | `1000` | Minimum RMS to trigger a Shazam call |
| `DB_PATH` | `/var/lib/song-tracker/songs.db` | SQLite database path |
| `WEB_HOST` | `0.0.0.0` | Interface to bind the web server to |
| `WEB_PORT` | `8080` | HTTP port for the dashboard |
| `LOG_LEVEL` | `INFO` | `DEBUG` / `INFO` / `WARNING` |

### Optional integrations

| Variable | Description |
|----------|-------------|
| `DISCOGS_TOKEN` | Personal access token from [discogs.com/settings/developers](https://www.discogs.com/settings/developers) |
| `DISCOGS_USERNAME` | Your Discogs username (exact, case-sensitive) |
| `ANTHROPIC_API_KEY` | API key for Claude AI recommendations |
| `LATITUDE` | Your latitude (used for weather-aware recommendations) |
| `LONGITUDE` | Your longitude |

---

## Starting the Services

```bash
sudo systemctl enable --now song-tracker song-tracker-web
```

Open the dashboard on any device on your network:
```
http://platipi.local:8080
# or use the Pi's IP address
```

---

## Discogs Collection

1. Add `DISCOGS_TOKEN` and `DISCOGS_USERNAME` to the env file and restart the web service
2. Click the sync button (refresh icon) in the Now Playing card, or `POST /api/discogs/sync`
3. Owned albums are highlighted in emerald throughout the dashboard
4. The tracker uses your Discogs collection to correct Shazam's album attribution — if Shazam identifies the right song but the wrong album, it looks up which album in your collection the track actually belongs to

Collection data is stored in SQLite and re-synced daily in the background.

---

## AI Recommendations

Requires an `ANTHROPIC_API_KEY`. Uses Claude Haiku to suggest what to play next from your Discogs collection, factoring in:

- Current song (if something is playing)
- Time of day and season
- Local weather (fetched automatically via Open-Meteo if latitude/longitude are set)
- A free-text prompt you can type in the recommendations card

Recommendations are cached for 30 minutes per context. Each request uses approximately 700–900 input tokens and 150–200 output tokens (Claude Haiku pricing).

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/songs` | Paginated history (`?page=1&limit=20&q=search`) |
| GET | `/api/songs/:id` | Single song detail |
| PATCH | `/api/songs/:id` | Update rating (`{"rating": 4.5}`) |
| DELETE | `/api/songs/:id` | Delete a song |
| GET | `/api/stats` | Totals, top artists, hourly activity |
| GET | `/api/artists` | All artists with play counts |
| GET | `/api/system` | CPU, memory, temperature, uptime |
| GET | `/api/lyrics` | Fetch lyrics from lrclib.net (`?artist=X&title=Y&album=Z`) |
| GET | `/api/discogs/check` | Check if an album is in your collection |
| GET | `/api/discogs/status` | Sync status and collection count |
| POST | `/api/discogs/sync` | Trigger a collection sync |
| POST | `/api/discogs/normalize` | Backfill canonical Discogs names onto existing songs |
| GET | `/api/recommendations` | Get AI recommendations (`?current_artist=X&current_album=Y&custom_prompt=Z`) |
| POST | `/api/trigger` | Force an immediate identification attempt |

---

## Deploy from Dev Machine

```bash
./deploy.sh
```

This builds the React frontend, rsyncs everything to the Pi, and restarts both services. Requires `ssh-copy-id adamj@platipi.local` set up first.

---

## Useful Pi Commands

```bash
# Service status
sudo systemctl status song-tracker song-tracker-web

# Live logs
sudo journalctl -u song-tracker -f
sudo journalctl -u song-tracker-web -f

# Recent songs
/usr/bin/python3 -c "
import sqlite3
conn = sqlite3.connect('/var/lib/song-tracker/songs.db')
for r in conn.execute('SELECT played_at, artist, title FROM songs ORDER BY played_at DESC LIMIT 10').fetchall():
    print(r)
"

# Audio test
arecord -D plughw:2,0 -f S16_LE -r 44100 -c 1 -d 5 /tmp/test.wav && aplay /tmp/test.wav
```

---

## Troubleshooting

**No audio / arecord errors**
- Run `arecord -l` and note your card number
- Use `plughw:X,0` not `hw:X,0`
- Check the cable connection at the receiver and adapter

**Songs not identified**
- Ensure music is audible and the input level is reasonable
- Check `LOG_LEVEL=DEBUG` and watch `journalctl -u song-tracker -f`
- ShazamIO may take 30–60 seconds on a Pi 2 — this is normal

**Dashboard not loading**
- `sudo systemctl status song-tracker-web`
- `curl http://localhost:8080` from the Pi

**Discogs sync failing with 404**
- Verify `DISCOGS_USERNAME` is your exact Discogs username (case-sensitive)
- Check your personal access token is still valid at discogs.com/settings/developers

---

## License

MIT
