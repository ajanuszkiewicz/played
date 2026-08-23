"""
Shared Discogs collection matching logic used by both web_server.py and song_tracker.py.
"""

from __future__ import annotations

import re
import sqlite3


def normalize_album(title: str) -> str:
    """Lowercase + strip edition/remaster suffixes for fuzzy matching."""
    t = title.lower().strip()
    t = re.sub(
        r'\s*\([^)]*\b(edition|remaster(?:ed)?|anniversary|deluxe|expanded|bonus|'
        r'special|version|mix|mono|stereo|re-?issue)\b[^)]*\)',
        '', t, flags=re.IGNORECASE,
    )
    t = re.sub(r'\s*\(\d{4}\)\s*$', '', t)
    t = re.sub(r'[^\w\s]', ' ', t)
    return re.sub(r'\s+', ' ', t).strip()


def find_in_collection(db: sqlite3.Connection, artist: str, album: str) -> dict | None:
    """
    Return the best-matching discogs_collection row for the given artist/album,
    or None if no match is found.

    Tries four tiers in order:
      1. Exact case-insensitive title match
      2. Normalized match (ignores edition/remaster suffixes)
      3. Shazam title is a substring of the Discogs title
      4. Discogs title is a substring of the Shazam title
    """
    try:
        rows = db.execute(
            "SELECT artist, title, format, url FROM discogs_collection WHERE LOWER(artist) = LOWER(?)",
            (artist,),
        ).fetchall()
    except sqlite3.OperationalError:
        return None  # table may not exist yet

    if not rows:
        return None

    al    = album.lower()
    anorm = normalize_album(album)

    for r in rows:
        if r["title"].lower() == al:
            return dict(r)

    if anorm:
        for r in rows:
            if normalize_album(r["title"]) == anorm:
                return dict(r)

    if len(al) >= 5:
        for r in rows:
            if al in r["title"].lower():
                return dict(r)

    for r in rows:
        tl = r["title"].lower()
        if len(tl) >= 5 and tl in al:
            return dict(r)

    return None


def find_album_by_track(db: sqlite3.Connection, artist: str, track_title: str) -> dict | None:
    """
    Return the collection album that contains a track matching track_title for
    the given artist. Falls back to a normalized (punctuation-stripped) match.
    Returns None if discogs_tracks is empty or not yet populated.
    """
    try:
        # Exact case-insensitive match
        rows = db.execute("""
            SELECT c.artist, c.title, c.format, c.url
            FROM   discogs_tracks t
            JOIN   discogs_collection c ON c.release_id = t.release_id
            WHERE  LOWER(c.artist) = LOWER(?)
              AND  LOWER(t.title)  = LOWER(?)
        """, (artist, track_title)).fetchall()
        if rows:
            return dict(rows[0])

        # Normalized fallback — handles punctuation / whitespace differences
        norm = normalize_album(track_title)
        if not norm:
            return None

        rows = db.execute("""
            SELECT c.artist, c.title, c.format, c.url, t.title AS track_title
            FROM   discogs_tracks t
            JOIN   discogs_collection c ON c.release_id = t.release_id
            WHERE  LOWER(c.artist) = LOWER(?)
        """, (artist,)).fetchall()

        for r in rows:
            if normalize_album(r["track_title"]) == norm:
                return {"artist": r["artist"], "title": r["title"],
                        "format": r["format"], "url": r["url"]}

        return None
    except sqlite3.OperationalError:
        return None  # table may not exist yet


def normalize_songs(db: sqlite3.Connection) -> int:
    """
    Update all songs in the DB to use canonical Discogs artist/album naming.
    For each song, tries album-level matching first, then track-level as fallback.
    Returns the number of rows updated.
    """
    try:
        rows = db.execute(
            "SELECT DISTINCT artist, album, title FROM songs WHERE album IS NOT NULL"
        ).fetchall()
    except sqlite3.OperationalError:
        return 0

    # Cache album-level results to avoid repeating the same lookup per album
    album_cache: dict = {}
    updated = 0

    for row in rows:
        key = (row["artist"], row["album"])
        if key not in album_cache:
            album_cache[key] = find_in_collection(db, row["artist"], row["album"])

        match = album_cache[key]

        # Fall back to track-level lookup using the song title
        if not match:
            match = find_album_by_track(db, row["artist"], row["title"])

        if not match:
            continue

        d_artist = match["artist"]
        d_album  = match["title"]

        if d_artist != row["artist"] or d_album != row["album"]:
            db.execute(
                "UPDATE songs SET artist = ?, album = ? "
                "WHERE artist = ? AND album = ? AND title = ?",
                (d_artist, d_album, row["artist"], row["album"], row["title"]),
            )
            updated += 1

    if updated:
        db.commit()
    return updated
