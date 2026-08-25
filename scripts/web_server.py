#!/usr/bin/env python3
"""
Song Tracker Web Server
Serves the dashboard and a JSON REST API over the local network.
"""

import json
import os
import re
import struct
import sqlite3
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory, g, Response, stream_with_context
from discogs_utils import (
    find_in_collection as _find_in_collection,
    find_album_by_track as _find_album_by_track,
    normalize_songs as _normalize_songs,
)

DB_PATH       = os.getenv("DB_PATH", "/var/lib/song-tracker/songs.db")
HOST          = os.getenv("WEB_HOST", "0.0.0.0")
PORT          = int(os.getenv("WEB_PORT", "8080"))
AUDIO_FIFO    = os.getenv("AUDIO_FIFO", "/var/lib/song-tracker/audio.fifo")
TRIGGER_FILE        = os.getenv("TRIGGER_FILE",  "/var/lib/song-tracker/manual_trigger")
STATUS_FILE         = os.getenv("STATUS_FILE",   "/var/lib/song-tracker/tracker_status")
RMS_FILE            = os.getenv("RMS_FILE",      "/var/lib/song-tracker/rms")
SILENCE_THRESHOLD   = int(os.getenv("SILENCE_THRESHOLD",  "50"))
IDENTIFY_THRESHOLD  = int(os.getenv("IDENTIFY_THRESHOLD", "100"))
DISCOGS_TOKEN     = os.getenv("DISCOGS_TOKEN", "")
DISCOGS_USERNAME  = os.getenv("DISCOGS_USERNAME", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
LATITUDE          = os.getenv("LATITUDE",  "").strip()
LONGITUDE         = os.getenv("LONGITUDE", "").strip()
WEB_DIR           = Path(__file__).parent / "web"

_sync_lock               = threading.Lock()
_sync_in_progress        = False
_tracklist_sync_in_progress = False
_setup_done              = False
_setup_lock              = threading.Lock()

_location_cache: tuple | None = None   # (lat, lon, city)
_rec_cache: dict = {}                  # cache_key -> {data, ts}
_lyrics_cache: dict = {}               # "artist::title::album" -> response dict
REC_CACHE_TTL = 1800  # seconds


def _weather_code_desc(code: int) -> str:
    if code == 0:      return "clear sky"
    if code <= 3:      return "partly cloudy"
    if code <= 48:     return "foggy"
    if code <= 57:     return "drizzle"
    if code <= 67:     return "rain"
    if code <= 77:     return "snow"
    if code <= 82:     return "showers"
    if code <= 86:     return "snow showers"
    if code >= 95:     return "thunderstorm"
    return "cloudy"



def _get_location() -> tuple | None:
    global _location_cache
    if _location_cache is not None:
        return _location_cache
    if LATITUDE and LONGITUDE:
        _location_cache = (float(LATITUDE), float(LONGITUDE), None)
        return _location_cache
    try:
        req = urllib.request.Request(
            "https://ipapi.co/json/",
            headers={"User-Agent": "SongTracker/1.0"},
        )
        data = json.loads(urllib.request.urlopen(req, timeout=5).read())
        _location_cache = (data["latitude"], data["longitude"], data.get("city"))
        return _location_cache
    except Exception:
        return None


def _get_weather() -> dict | None:
    loc = _get_location()
    if not loc:
        return None
    lat, lon, city = loc
    try:
        url = (
            f"https://api.open-meteo.com/v1/forecast"
            f"?latitude={lat}&longitude={lon}"
            f"&current=temperature_2m,weather_code"
        )
        data = json.loads(urllib.request.urlopen(url, timeout=5).read())
        cur  = data.get("current", {})
        return {
            "temp_c":    cur.get("temperature_2m"),
            "condition": _weather_code_desc(cur.get("weather_code", 0)),
            "city":      city,
        }
    except Exception:
        return None


def _discogs_get(url: str, params: dict) -> dict:
    full_url = url + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(full_url, headers={
        "Authorization": f"Discogs token={DISCOGS_TOKEN}",
        "User-Agent": "SongTracker/1.0",
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def _plain_db() -> sqlite3.Connection:
    """Open a thread-safe DB connection outside Flask's request context."""
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_discogs_tables(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS discogs_collection (
            release_id INTEGER PRIMARY KEY,
            artist     TEXT NOT NULL,
            title      TEXT NOT NULL,
            format     TEXT,
            url        TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS discogs_meta (
            key   TEXT PRIMARY KEY,
            value TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS discogs_tracks (
            release_id INTEGER NOT NULL,
            title      TEXT    NOT NULL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_tracks_release ON discogs_tracks(release_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_tracks_title   ON discogs_tracks(LOWER(title))")
    conn.commit()


def _sync_discogs_collection() -> None:
    global _sync_in_progress
    with _sync_lock:
        if _sync_in_progress:
            return
        _sync_in_progress = True
    try:
        page, all_releases = 1, []
        while True:
            data = _discogs_get(
                f"https://api.discogs.com/users/{DISCOGS_USERNAME}/collection/folders/0/releases",
                {"per_page": 100, "page": page},
            )
            all_releases.extend(data.get("releases", []))
            if page >= data.get("pagination", {}).get("pages", 1):
                break
            page += 1

        conn = _plain_db()
        _ensure_discogs_tables(conn)
        conn.execute("DELETE FROM discogs_collection")
        for r in all_releases:
            info       = r.get("basic_information", {})
            release_id = info.get("id") or r.get("id")
            artists    = info.get("artists", [])
            # Strip Discogs disambiguation suffixes like "Artist (2)"
            artist = re.sub(r"\s*\(\d+\)$", "", artists[0].get("name", "")).strip() if artists else ""
            title  = info.get("title", "").strip()
            fmts   = info.get("formats", [])
            fmt_parts = []
            for f in fmts:
                descs = f.get("descriptions", [])
                fmt_parts.append(f"{f.get('name', '')}, {', '.join(descs)}" if descs else f.get("name", ""))
            fmt = " / ".join(p for p in fmt_parts if p).strip() or None
            url = f"https://www.discogs.com/release/{release_id}" if release_id else None
            if release_id and artist and title:
                conn.execute(
                    "INSERT OR REPLACE INTO discogs_collection (release_id, artist, title, format, url) VALUES (?,?,?,?,?)",
                    (release_id, artist, title, fmt, url),
                )
        conn.execute(
            "INSERT OR REPLACE INTO discogs_meta (key, value) VALUES ('last_sync', ?)",
            (datetime.utcnow().isoformat(timespec="seconds") + "Z",),
        )
        conn.commit()
        _normalize_songs(conn)
        conn.close()
        # Kick off tracklist sync in its own thread so _sync_in_progress is released first
        threading.Thread(target=_sync_tracklists, args=(all_releases,), daemon=True).start()
    except Exception as e:
        app.logger.error("Discogs sync failed: %s", e)
    finally:
        with _sync_lock:
            _sync_in_progress = False


def _sync_tracklists(releases: list) -> None:
    global _tracklist_sync_in_progress
    _tracklist_sync_in_progress = True
    try:
        conn = _plain_db()
        _ensure_discogs_tables(conn)
        conn.execute("DELETE FROM discogs_tracks")
        conn.commit()
        for r in releases:
            info       = r.get("basic_information", {})
            release_id = info.get("id") or r.get("id")
            if not release_id:
                continue
            try:
                data = _discogs_get(f"https://api.discogs.com/releases/{release_id}", {})
                for track in data.get("tracklist", []):
                    t = track.get("title", "").strip()
                    if t:
                        conn.execute(
                            "INSERT INTO discogs_tracks (release_id, title) VALUES (?,?)",
                            (release_id, t),
                        )
                conn.commit()
            except Exception:
                pass
            time.sleep(1)   # stay within Discogs 60 req/min limit
        conn.close()
    except Exception as e:
        app.logger.error("Tracklist sync failed: %s", e)
    finally:
        _tracklist_sync_in_progress = False


def _maybe_trigger_sync() -> None:
    """Start a background sync if collection is stale (>24 h) or never fetched."""
    if not DISCOGS_TOKEN or not DISCOGS_USERNAME:
        return
    try:
        conn = _plain_db()
        _ensure_discogs_tables(conn)
        row = conn.execute("SELECT value FROM discogs_meta WHERE key='last_sync'").fetchone()
        conn.close()
        if row:
            last = datetime.fromisoformat(row[0].rstrip("Z"))
            if (datetime.utcnow() - last).total_seconds() < 86400:
                return
    except Exception:
        pass
    threading.Thread(target=_sync_discogs_collection, daemon=True).start()

app = Flask(__name__, static_folder=str(WEB_DIR))


@app.before_request
def _setup_once():
    global _setup_done
    if _setup_done:
        return
    with _setup_lock:
        if _setup_done:
            return
        _setup_done = True
    _maybe_trigger_sync()


# ── DB helper ──────────────────────────────────────────────────────────────────
def get_db() -> sqlite3.Connection:
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH, check_same_thread=False)
        g.db.row_factory = sqlite3.Row
    return g.db

@app.teardown_appcontext
def close_db(exc=None):
    db = g.pop("db", None)
    if db:
        db.close()


# ── API ────────────────────────────────────────────────────────────────────────
@app.route("/api/songs")
def api_songs():
    db    = get_db()
    page  = max(1, int(request.args.get("page", 1)))
    limit = min(200, max(1, int(request.args.get("limit", 50))))
    offset = (page - 1) * limit

    where_clauses = []
    params: list = []

    artist = request.args.get("artist")
    if artist:
        where_clauses.append("artist LIKE ?")
        params.append(f"%{artist}%")

    q = request.args.get("q")
    if q:
        where_clauses.append("(title LIKE ? OR artist LIKE ?)")
        params.extend([f"%{q}%", f"%{q}%"])

    since = request.args.get("since")
    if since:
        where_clauses.append("played_at >= ?")
        params.append(since)

    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    total = db.execute(
        f"SELECT COUNT(*) FROM songs {where_sql}", params
    ).fetchone()[0]

    rows = db.execute(
        f"""SELECT id, played_at, title, artist, album, release_date,
                   cover_art, apple_id, rating
            FROM songs {where_sql}
            ORDER BY played_at DESC
            LIMIT ? OFFSET ?""",
        params + [limit, offset],
    ).fetchall()

    return jsonify({
        "total": total,
        "page": page,
        "limit": limit,
        "songs": [dict(r) for r in rows],
    })


@app.route("/api/stats")
def api_stats():
    db = get_db()

    total = db.execute("SELECT COUNT(*) FROM songs").fetchone()[0]
    today = datetime.utcnow().date().isoformat()
    today_count = db.execute(
        "SELECT COUNT(*) FROM songs WHERE played_at >= ?", (today,)
    ).fetchone()[0]

    top_artists = db.execute("""
        SELECT artist, COUNT(*) as plays
        FROM songs GROUP BY artist
        ORDER BY plays DESC LIMIT 10
    """).fetchall()

    top_songs = db.execute("""
        SELECT title, artist, COUNT(*) as plays
        FROM songs GROUP BY title, artist
        ORDER BY plays DESC LIMIT 10
    """).fetchall()

    recent = db.execute("""
        SELECT id, played_at, title, artist, album, cover_art, rating
        FROM songs ORDER BY played_at DESC LIMIT 5
    """).fetchall()

    since_24h = (datetime.utcnow() - timedelta(hours=24)).isoformat(timespec="seconds") + "Z"
    hourly = db.execute("""
        SELECT strftime('%H', played_at) as hour, COUNT(*) as count
        FROM songs WHERE played_at >= ?
        GROUP BY hour ORDER BY hour
    """, (since_24h,)).fetchall()

    return jsonify({
        "total_songs": total,
        "today_count": today_count,
        "top_artists": [dict(r) for r in top_artists],
        "top_songs":   [dict(r) for r in top_songs],
        "recent":      [dict(r) for r in recent],
        "hourly_24h":  [dict(r) for r in hourly],
    })


@app.route("/api/artists")
def api_artists():
    db = get_db()
    since = request.args.get("since")
    where = "WHERE played_at >= ?" if since else ""
    params = [since] if since else []
    rows = db.execute(
        f"SELECT artist, COUNT(*) as plays, MAX(played_at) as last_played "
        f"FROM songs {where} GROUP BY artist ORDER BY plays DESC",
        params,
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/artists/detail")
def api_artist_detail():
    artist = request.args.get("name", "")
    db = get_db()
    top_songs = db.execute("""
        SELECT title, COUNT(*) as plays
        FROM songs WHERE artist = ?
        GROUP BY title ORDER BY plays DESC LIMIT 5
    """, (artist,)).fetchall()
    albums = db.execute("""
        SELECT DISTINCT album FROM songs
        WHERE artist = ? AND album IS NOT NULL
        ORDER BY album LIMIT 5
    """, (artist,)).fetchall()
    avg = db.execute(
        "SELECT ROUND(AVG(rating), 1) FROM songs WHERE artist = ? AND rating IS NOT NULL",
        (artist,),
    ).fetchone()[0]
    return jsonify({
        "top_songs": [dict(r) for r in top_songs],
        "albums":    [r["album"] for r in albums],
        "avg_rating": avg,
    })


@app.route("/api/songs/<int:song_id>", methods=["PATCH"])
def api_song_patch(song_id):
    db   = get_db()
    data = request.get_json(silent=True) or {}
    if "rating" not in data:
        return jsonify({"error": "rating required"}), 400
    rating = data["rating"]
    if rating is not None and not (0 <= rating <= 5 and rating * 2 == int(rating * 2)):
        return jsonify({"error": "rating must be 0–5 in 0.5 steps"}), 400
    db.execute("UPDATE songs SET rating = ? WHERE id = ?", (rating, song_id))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/songs/<int:song_id>", methods=["DELETE"])
def api_song_delete(song_id):
    db = get_db()
    db.execute("DELETE FROM songs WHERE id = ?", (song_id,))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/artists", methods=["DELETE"])
def api_artist_delete():
    artist = request.args.get("name", "").strip()
    if not artist:
        return jsonify({"error": "name required"}), 400
    db = get_db()
    db.execute("DELETE FROM songs WHERE artist = ?", (artist,))
    db.commit()
    return jsonify({"ok": True})


def _read_rms() -> int | None:
    try:
        p = Path(RMS_FILE)
        if p.exists() and (time.time() - p.stat().st_mtime) < 10:
            return int(p.read_text().strip())
    except (OSError, ValueError):
        pass
    return None


@app.route("/api/discogs/check")
def api_discogs_check():
    artist = request.args.get("artist", "").strip()
    album  = request.args.get("album",  "").strip()
    title  = request.args.get("title",  "").strip()   # song title for track-level fallback
    if not artist or not album:
        return jsonify({"owned": None, "reason": "no_album"})
    if not DISCOGS_TOKEN or not DISCOGS_USERNAME:
        return jsonify({"owned": None, "reason": "not_configured"})

    _maybe_trigger_sync()

    rms = _read_rms()
    db = get_db()
    try:
        match = _find_in_collection(db, artist, album, rms=rms)
        if not match and title:
            match = _find_album_by_track(db, artist, title)
        if match:
            return jsonify({"owned": True, "format": match["format"], "url": match["url"]})
        count = db.execute("SELECT COUNT(*) FROM discogs_collection").fetchone()[0]
        if count == 0:
            return jsonify({"owned": None, "reason": "syncing"})
        return jsonify({"owned": False, "format": None, "url": None})
    except Exception as e:
        return jsonify({"owned": None, "reason": f"error: {e}"})


@app.route("/api/discogs/status")
def api_discogs_status():
    if not DISCOGS_TOKEN or not DISCOGS_USERNAME:
        return jsonify({"configured": False, "syncing": False, "last_sync": None, "count": 0,
                        "tracklist_syncing": False, "tracklist_count": 0})
    db = get_db()
    try:
        row            = db.execute("SELECT value FROM discogs_meta WHERE key='last_sync'").fetchone()
        count          = db.execute("SELECT COUNT(*) FROM discogs_collection").fetchone()[0]
        tracklist_count = db.execute("SELECT COUNT(*) FROM discogs_tracks").fetchone()[0]
        return jsonify({
            "configured":        True,
            "syncing":           _sync_in_progress,
            "last_sync":         row[0] if row else None,
            "count":             count,
            "tracklist_syncing": _tracklist_sync_in_progress,
            "tracklist_count":   tracklist_count,
        })
    except Exception:
        return jsonify({"configured": True, "syncing": _sync_in_progress, "last_sync": None,
                        "count": 0, "tracklist_syncing": _tracklist_sync_in_progress, "tracklist_count": 0})


@app.route("/api/discogs/sync", methods=["POST"])
def api_discogs_sync():
    if not DISCOGS_TOKEN or not DISCOGS_USERNAME:
        return jsonify({"error": "not_configured"}), 400
    threading.Thread(target=_sync_discogs_collection, daemon=True).start()
    return jsonify({"ok": True, "syncing": True})


@app.route("/api/discogs/normalize", methods=["POST"])
def api_discogs_normalize():
    db      = get_db()
    updated = _normalize_songs(db)
    return jsonify({"ok": True, "updated": updated})


@app.route("/api/lyrics")
def api_lyrics():
    artist = request.args.get("artist", "").strip()
    title  = request.args.get("title",  "").strip()
    album  = request.args.get("album",  "").strip()
    if not artist or not title:
        return jsonify({"error": "missing params"}), 400

    cache_key = f"{artist}::{title}::{album}"
    if cache_key in _lyrics_cache:
        return jsonify(_lyrics_cache[cache_key])

    params = {"artist_name": artist, "track_name": title}
    if album:
        params["album_name"] = album
    url = "https://lrclib.net/api/get?" + urllib.parse.urlencode(params)
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "SongTracker/1.0 (https://github.com/ajanuszkiewicz/played)"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
        result = {
            "found": True,
            "instrumental": data.get("instrumental", False),
            "plainLyrics": data.get("plainLyrics"),
        }
    except urllib.error.HTTPError as e:
        if e.code == 404:
            result = {"found": False, "instrumental": False, "plainLyrics": None}
        else:
            return jsonify({"error": f"lrclib {e.code}"}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 502

    _lyrics_cache[cache_key] = result
    return jsonify(result)


@app.route("/api/recommendations")
def api_recommendations():
    if not ANTHROPIC_API_KEY:
        return jsonify({"error": "not_configured"}), 400

    current_artist = request.args.get("current_artist", "").strip()
    current_album  = request.args.get("current_album",  "").strip()
    custom_prompt  = request.args.get("custom_prompt",  "").strip()
    force          = request.args.get("refresh") == "1"
    now_ts         = time.time()
    cache_key      = f"{current_artist}::{current_album}::{custom_prompt}" if (current_artist or custom_prompt) else "__none__"

    if not force and cache_key in _rec_cache:
        cached = _rec_cache[cache_key]
        if (now_ts - cached["ts"]) < REC_CACHE_TTL:
            return jsonify(cached["data"])

    db = get_db()
    try:
        rows = db.execute(
            "SELECT artist, title FROM discogs_collection ORDER BY artist"
        ).fetchall()
    except Exception:
        rows = []
    if not rows:
        return jsonify({"error": "no_collection"}), 400

    collection = "\n".join(f"- {r['artist']} — {r['title']}" for r in rows)

    now_dt      = datetime.now()
    hour        = now_dt.hour
    hour12      = hour % 12 or 12
    ampm        = "AM" if hour < 12 else "PM"
    time_of_day = (
        "morning"   if 5  <= hour < 12 else
        "afternoon" if 12 <= hour < 17 else
        "evening"   if 17 <= hour < 21 else
        "night"
    )
    month  = now_dt.month
    season = (
        "winter" if month in (12, 1, 2) else
        "spring" if month in (3,  4, 5) else
        "summer" if month in (6,  7, 8) else
        "autumn"
    )
    time_str = now_dt.strftime(f"%A {hour12}:%M {ampm}")

    if custom_prompt:
        currently = f" They are currently listening to {current_artist} — {current_album}." if (current_artist and current_album) else ""
        prompt = f"""You are a music recommendation assistant helping someone decide what to play from their vinyl/music collection.

Records from their collection:
{collection}

The user is asking: "{custom_prompt}."{currently} Suggest exactly 4 albums from the list that best answer their request. Only recommend albums explicitly listed above.

Respond with JSON only, no markdown fences, no explanation outside the JSON:
{{"mood": "2-5 word mood phrase", "recommendations": [{{"artist": "...", "album": "...", "reason": "one vivid sentence on why this fits"}}]}}"""
    else:
        if current_artist and current_album:
            playing_ctx = f"\n\nThe user is currently listening to {current_artist} — {current_album}. Suggest 4 albums from the list that would make a great follow-on listen, considering the mood and feel of that album alongside the time, season, and weather."
        else:
            playing_ctx = "\n\nRecommend exactly 4 albums from the list above that best suit this specific moment."

        weather     = _get_weather()
        weather_ctx = ""
        if weather:
            city_part   = f" in {weather['city']}" if weather.get("city") else ""
            weather_ctx = f"\n- Weather{city_part}: {weather['temp_c']}°C, {weather['condition']}"

        prompt = f"""You are a music recommendation assistant helping someone decide what to play from their vinyl/music collection.

Current context:
- Time: {time_str} ({time_of_day})
- Season: {season}{weather_ctx}

Records from their collection:
{collection}{playing_ctx} Let the time of day, season, and weather genuinely shape your choices. Only recommend albums explicitly listed above.

IMPORTANT: In each reason, do NOT mention the city, weather, temperature, or specific weather conditions. Write about mood, feel, and musical qualities only.

Respond with JSON only, no markdown fences, no explanation outside the JSON:
{{"mood": "2-5 word mood phrase", "recommendations": [{{"artist": "...", "album": "...", "reason": "one vivid sentence on why this fits right now"}}]}}"""

    try:
        body = json.dumps({
            "model":      "claude-haiku-4-5-20251001",
            "max_tokens": 600,
            "messages":   [{"role": "user", "content": prompt}],
        }).encode()
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=body,
            headers={
                "x-api-key":         ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type":      "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())

        text = result["content"][0]["text"].strip()
        if text.startswith("```"):
            lines = text.splitlines()
            text  = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

        data = json.loads(text)
        _rec_cache[cache_key] = {"data": data, "ts": now_ts}
        return jsonify(data)

    except Exception as e:
        app.logger.error("Recommendations failed: %s", e)
        return jsonify({"error": str(e)}), 500


@app.route("/api/trigger", methods=["POST"])
def api_trigger():
    try:
        Path(TRIGGER_FILE).touch()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/rms/stream")
def api_rms_stream():
    def generate():
        last = None
        while True:
            try:
                p = Path(RMS_FILE)
                if p.exists() and (time.time() - p.stat().st_mtime) < 5:
                    val = p.read_text().strip()
                    if val != last:
                        last = val
                        yield f"data: {val}\n\n"
                elif last is not None:
                    last = None
                    yield "data: null\n\n"
            except OSError:
                pass
            time.sleep(0.2)
    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.route("/api/tracker-status")
def api_tracker_status():
    try:
        p = Path(STATUS_FILE)
        if p.exists() and (time.time() - p.stat().st_mtime) < 120:
            return jsonify({"phase": p.read_text().strip() or None})
    except OSError:
        pass
    return jsonify({"phase": None})


@app.route("/api/songs/<int:song_id>")
def api_song_detail(song_id):
    db = get_db()
    row = db.execute("SELECT * FROM songs WHERE id = ?", (song_id,)).fetchone()
    if not row:
        return jsonify({"error": "Not found"}), 404
    return jsonify(dict(row))


@app.route("/api/system")
def api_system():
    stats = {}

    try:
        load1 = os.getloadavg()[0]
        stats["cpu_percent"] = round(min(load1 / (os.cpu_count() or 1) * 100, 100), 1)
        stats["load_avg"]    = round(load1, 2)
    except Exception:
        stats["cpu_percent"] = stats["load_avg"] = None

    try:
        meminfo = {}
        with open("/proc/meminfo") as f:
            for line in f:
                k, v = line.split(":", 1)
                meminfo[k.strip()] = int(v.split()[0])
        total = meminfo["MemTotal"] // 1024
        used  = total - meminfo["MemAvailable"] // 1024
        stats["ram_used_mb"]  = used
        stats["ram_total_mb"] = total
        stats["ram_percent"]  = round(used / total * 100, 1)
    except Exception:
        stats["ram_used_mb"] = stats["ram_total_mb"] = stats["ram_percent"] = None

    try:
        with open("/sys/class/thermal/thermal_zone0/temp") as f:
            stats["temp_c"] = round(int(f.read().strip()) / 1000, 1)
    except Exception:
        stats["temp_c"] = None

    try:
        db = get_db()
        since_1h = (datetime.utcnow() - timedelta(hours=1)).isoformat(timespec="seconds") + "Z"
        row = db.execute(
            "SELECT COUNT(*) FROM shazam_calls WHERE called_at >= ?", (since_1h,)
        ).fetchone()
        stats["shazam_calls_per_hour"] = row[0] if row else 0
    except Exception:
        stats["shazam_calls_per_hour"] = None

    try:
        sv = os.statvfs(DB_PATH)
        total_kb = sv.f_blocks * sv.f_frsize // 1024
        free_kb  = sv.f_bavail * sv.f_frsize // 1024
        used_kb  = total_kb - free_kb
        stats["disk_used_gb"]  = round(used_kb  / 1_048_576, 1)
        stats["disk_total_gb"] = round(total_kb / 1_048_576, 1)
        stats["disk_percent"]  = round(used_kb / total_kb * 100, 1) if total_kb else 0
    except Exception:
        stats["disk_used_gb"] = stats["disk_total_gb"] = stats["disk_percent"] = None

    try:
        p = Path(RMS_FILE)
        if p.exists() and (time.time() - p.stat().st_mtime) < 10:
            stats["input_rms"] = int(p.read_text().strip())
        else:
            stats["input_rms"] = None
    except Exception:
        stats["input_rms"] = None
    stats["silence_threshold"]  = SILENCE_THRESHOLD
    stats["identify_threshold"] = IDENTIFY_THRESHOLD

    return jsonify(stats)


# ── Audio stream ──────────────────────────────────────────────────────────────
def _wav_header(sample_rate=44100, channels=1, bits=16) -> bytes:
    """WAV header with max data size — standard trick for streaming WAV."""
    data_size   = 0x7FFFFFFF
    byte_rate   = sample_rate * channels * bits // 8
    block_align = channels * bits // 8
    return struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF", data_size + 36, b"WAVE",
        b"fmt ", 16, 1, channels, sample_rate,
        byte_rate, block_align, bits,
        b"data", data_size,
    )


@app.route("/api/stream/audio")
def stream_audio():
    if not os.path.exists(AUDIO_FIFO):
        return jsonify({"error": "Audio stream unavailable — tracker not running"}), 503

    def generate():
        yield _wav_header()
        try:
            with open(AUDIO_FIFO, "rb") as fifo:
                while True:
                    chunk = fifo.read(4096)
                    if not chunk:
                        break
                    yield chunk
        except GeneratorExit:
            pass
        except Exception:
            pass

    return Response(
        stream_with_context(generate()),
        mimetype="audio/wav",
        headers={"Cache-Control": "no-cache, no-store"},
    )


# ── Static / SPA ──────────────────────────────────────────────────────────────
@app.route("/")
@app.route("/<path:path>")
def serve_frontend(path="index.html"):
    target = WEB_DIR / path
    if target.exists() and target.is_file():
        return send_from_directory(str(WEB_DIR), path)
    return send_from_directory(str(WEB_DIR), "index.html")


if __name__ == "__main__":
    app.run(host=HOST, port=PORT, debug=False, threaded=True)
