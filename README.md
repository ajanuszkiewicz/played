# 🎵 Raspberry Pi Song Tracker

Automatically identifies songs playing through your stereo receiver and builds a browsable playlist history accessible on your local network.

---

## How it Works

```
Receiver Line-Out → USB Audio Adapter → Raspberry Pi
                                           │
                               ┌───────────┴──────────────┐
                               │  song_tracker.py (daemon)│
                               │  • records 10s of audio  │
                               │  • sends to AudD API     │
                               │  • stores in SQLite       │
                               └───────────┬──────────────┘
                                           │
                               ┌───────────┴──────────────┐
                               │  web_server.py (Flask)   │
                               │  • REST API /api/*       │
                               │  • Dashboard on :8080    │
                               └──────────────────────────┘
```

---

## Hardware Required

| Item | Notes | Approx. Cost |
|------|-------|-------------|
| Raspberry Pi 4 (2GB+) | Pi 3B+ also works | $35–55 |
| MicroSD card (16GB+) | Class 10 recommended | $8–15 |
| **USB audio adapter** | Stereo line-in required | $8–20 |
| 3.5mm stereo cable | TRS male-to-male | $5 |
| Power supply (5V 3A USB-C) | Official RPi one recommended | $10 |

### Recommended USB Audio Adapters
- **Behringer UCA202** — clean stereo line-in, great quality (~$30)
- **Sabrent USB External Stereo Sound Adapter** — budget option (~$8)
- **StarTech ICUSBAUDIOB** — reliable, line-in supported (~$20)

> ⚠️ **Important:** Many cheap USB adapters only have a microphone input (mono, mic-level). You need one with a **stereo line-in** (also called "aux in" or "line level input"). Check the product specs before buying.

### Wiring

```
Receiver/Amplifier
  ┌─────────────────┐
  │  TAPE OUT  ──── ├──── 3.5mm TRS cable ──── USB Audio Adapter LINE IN
  │  (or REC OUT)   │                                    │
  └─────────────────┘                           USB to Raspberry Pi
```

Connect your receiver's **TAPE OUT**, **REC OUT**, or **PRE OUT** jacks to the USB audio adapter's line input. This provides a fixed-level signal that won't vary with volume.

If your receiver only has RCA outputs, use a **dual-RCA to 3.5mm TRS adapter** (~$5).

---

## Software Setup

### 1. Prepare the Pi

Flash Raspberry Pi OS Lite (64-bit) to your SD card using the [Raspberry Pi Imager](https://www.raspberrypi.com/software/). Enable SSH in the imager settings.

```bash
# SSH into your Pi, then:
sudo apt-get update && sudo apt-get upgrade -y
```

### 2. Get an AudD API Key

1. Sign up at **https://audd.io** (free tier: 500 queries/month)
2. Copy your API token

### 3. Find Your Audio Device

Plug in the USB audio adapter, then:

```bash
arecord -l
```

You'll see output like:
```
card 1: Device [USB Audio Device], device 0: USB Audio [USB Audio]
```

Your device string is `hw:CARD,DEV` — e.g. `hw:1,0`.

Test capture works:
```bash
arecord -D hw:1,0 -f cd -d 5 /tmp/test.wav && aplay /tmp/test.wav
```

### 4. Install the Song Tracker

```bash
# Clone or copy the project files to your Pi, then:
sudo bash install.sh
```

### 5. Configure

```bash
sudo nano /etc/song-tracker/env
```

Set at minimum:
```
AUDD_API_KEY=your_key_here
AUDIO_DEVICE=hw:1,0
```

### 6. Start the Services

```bash
sudo systemctl enable --now song-tracker song-tracker-web
```

### 7. Open the Dashboard

Find your Pi's IP address:
```bash
hostname -I
```

Then open in any browser on your network:
```
http://192.168.1.XXX:8080
```

---

## Checking Status & Logs

```bash
# Service status
sudo systemctl status song-tracker
sudo systemctl status song-tracker-web

# Live logs
sudo journalctl -u song-tracker -f

# Check the database directly
sqlite3 /var/lib/song-tracker/songs.db "SELECT played_at, artist, title FROM songs ORDER BY played_at DESC LIMIT 20;"
```

---

## Configuration Reference

Edit `/etc/song-tracker/env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `AUDD_API_KEY` | (required) | Your AudD API token |
| `AUDIO_DEVICE` | `default` | ALSA device string (e.g. `hw:1,0`) |
| `SAMPLE_DURATION` | `10` | Seconds of audio per identification |
| `POLL_INTERVAL` | `30` | Seconds between attempts |
| `DB_PATH` | `/var/lib/song-tracker/songs.db` | SQLite database location |
| `WEB_PORT` | `8080` | HTTP port for the dashboard |
| `LOG_LEVEL` | `INFO` | `DEBUG` / `INFO` / `WARNING` |

---

## API Endpoints

The web server exposes a JSON API:

| Endpoint | Description |
|----------|-------------|
| `GET /api/songs` | Paginated song history (`?page=1&limit=50&q=search`) |
| `GET /api/stats` | Summary stats, top artists/songs, hourly activity |
| `GET /api/artists` | All artists with play counts |
| `GET /api/songs/:id` | Single song detail |

---

## Troubleshooting

**No audio captured / arecord errors**
- Run `arecord -l` and verify your USB adapter appears
- Try `hw:1,0`, `hw:2,0`, or `plughw:1,0` for the device name
- Check the cable connection between the receiver and adapter

**Songs not identified**
- Make sure music is actually playing and loud enough
- Check your API key in `/etc/song-tracker/env`
- Try increasing `SAMPLE_DURATION` to 15
- Verify internet connectivity: `curl -I https://api.audd.io`

**Dashboard not accessible**
- Check the web service: `sudo systemctl status song-tracker-web`
- Verify port 8080 isn't blocked: `sudo ss -tlnp | grep 8080`
- Try accessing from the Pi itself: `curl http://localhost:8080`

**API rate limiting (AudD free tier)**
- Free tier: 500 queries/month
- At 30s intervals: ~86,400 queries/month — upgrade to a paid plan or increase `POLL_INTERVAL`
- Recommended paid plan if using continuously: AudD's $10/month plan (10,000 queries)

---

## License

MIT — do whatever you like with it.
# played
