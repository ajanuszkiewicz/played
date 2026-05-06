#!/usr/bin/env python3
"""
Song Tracker Web Server
Serves the dashboard and a JSON REST API over the local network.
"""

import os
import struct
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory, g, Response, stream_with_context

DB_PATH       = os.getenv("DB_PATH", "/var/lib/song-tracker/songs.db")
HOST          = os.getenv("WEB_HOST", "0.0.0.0")
PORT          = int(os.getenv("WEB_PORT", "8080"))
AUDIO_FIFO    = os.getenv("AUDIO_FIFO", "/var/lib/song-tracker/audio.fifo")
TRIGGER_FILE  = os.getenv("TRIGGER_FILE", "/var/lib/song-tracker/manual_trigger")
WEB_DIR       = Path(__file__).parent / "web"

app = Flask(__name__, static_folder=str(WEB_DIR))


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


@app.route("/api/trigger", methods=["POST"])
def api_trigger():
    try:
        Path(TRIGGER_FILE).touch()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


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
