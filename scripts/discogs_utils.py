"""
Shared Discogs collection matching logic used by both web_server.py and song_tracker.py.
"""

from __future__ import annotations

import ast
import re
import sqlite3

_VA_NAMES = frozenset(("various", "various artists", "v/a"))


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


def normalize_track_title(title: str) -> str:
    """Strip remaster/edition annotations from Shazam track titles."""
    t = re.sub(
        r'\s*[\(\[]\s*(?:\d{4}\s+)?(?:remaster(?:ed)?|re-?master(?:ed)?|'
        r'anniversary|mono|stereo|single version|radio edit|live|demo|'
        r'instrumental|extended|bonus track|album version)\b[^\)\]]*[\)\]]',
        '', title, flags=re.IGNORECASE,
    )
    # Catch bare trailing "(2009 Remaster)" / "(Remastered)" with a year
    t = re.sub(r'\s*\([^)]*\bremaster(?:ed)?\b[^)]*\)', '', t, flags=re.IGNORECASE)
    t = re.sub(r'\s*\([^)]*\b\d{4}\b[^)]*\)\s*$', '', t)
    return t.strip()


def _pick_by_format(candidates: list, rms: int | None) -> dict:
    """
    Given multiple matching rows, use RMS to prefer Vinyl (<1000) or CD (>=1000).
    Falls back to the first candidate if RMS is unavailable or no format matches.
    """
    if rms is None or len(candidates) == 1:
        return dict(candidates[0])
    prefer_cd = rms >= 1000
    for r in candidates:
        fmt = (r["format"] or "").lower()
        if prefer_cd and "cd" in fmt:
            return dict(r)
        if not prefer_cd and "vinyl" in fmt:
            return dict(r)
    return dict(candidates[0])


def find_in_collection(db: sqlite3.Connection, artist: str, album: str, rms: int | None = None) -> dict | None:
    """
    Return the best-matching discogs_collection row for the given artist/album,
    or None if no match is found.

    Tries four tiers in order:
      1. Exact case-insensitive title match
      2. Normalized match (ignores edition/remaster suffixes)
      3. Shazam title is a substring of the Discogs title
      4. Discogs title is a substring of the Shazam title

    Each tier is tried against the primary artist first, then against Various
    Artists entries (soundtracks/compilations). When a VA match is used, the
    performing artist passed in is preserved so callers are not overwritten
    with "Various".

    When multiple format variants exist (e.g. CD and Vinyl), rms is used to
    pick between them: rms >= 1000 prefers CD, rms < 1000 prefers Vinyl.
    """
    al    = album.lower()
    anorm = normalize_album(album)

    def _match_rows(rows: list, artist_override: str | None = None) -> dict | None:
        def _ret(candidates: list) -> dict:
            result = dict(_pick_by_format(candidates, rms))
            if artist_override:
                result["artist"] = artist_override
            return result

        candidates = [r for r in rows if r["title"].lower() == al]
        if candidates:
            return _ret(candidates)
        if anorm:
            candidates = [r for r in rows if normalize_album(r["title"]) == anorm]
            if candidates:
                return _ret(candidates)
        if len(al) >= 5:
            candidates = [r for r in rows if al in r["title"].lower()]
            if candidates:
                return _ret(candidates)
        candidates = [r for r in rows if len(r["title"].lower()) >= 5 and r["title"].lower() in al]
        if candidates:
            return _ret(candidates)
        return None

    try:
        rows = db.execute(
            "SELECT artist, title, format, url FROM discogs_collection WHERE LOWER(artist) = LOWER(?)",
            (artist,),
        ).fetchall()
        result = _match_rows(rows) if rows else None
        if result:
            return result

        # Soundtracks and compilations are stored under "Various" in Discogs.
        # Preserve the performing artist (passed in) so callers keep the right name.
        va_rows = db.execute(
            "SELECT artist, title, format, url FROM discogs_collection"
            " WHERE LOWER(artist) IN ('various', 'various artists', 'v/a')",
        ).fetchall()
        return _match_rows(va_rows, artist_override=artist) if va_rows else None
    except sqlite3.OperationalError:
        return None  # table may not exist yet


def find_album_by_track(
    db: sqlite3.Connection,
    artist: str,
    track_title: str,
    preferred_album: str | None = None,
) -> dict | None:
    """
    Return the collection album that contains a track matching track_title for
    the given artist. Falls back to a normalized (punctuation-stripped) match.
    Returns None if discogs_tracks is empty or not yet populated.

    When preferred_album is given and the track appears on multiple albums,
    the preferred album is returned if it matches — supporting album continuity.
    """
    def _pick(rows: list) -> dict:
        if preferred_album:
            for r in rows:
                if r["title"].lower() == preferred_album.lower():
                    return dict(r)
        return dict(rows[0])

    try:
        # Exact case-insensitive match
        rows = db.execute("""
            SELECT c.artist, c.title, c.format, c.url, t.title AS track_title
            FROM   discogs_tracks t
            JOIN   discogs_collection c ON c.release_id = t.release_id
            WHERE  LOWER(c.artist) = LOWER(?)
              AND  LOWER(t.title)  = LOWER(?)
        """, (artist, track_title)).fetchall()
        if rows:
            return _pick(rows)

        # If the previous song was from a VA album, check whether this track
        # appears on that same album. Scoped to preferred_album so it can't
        # misfire across unrelated VA releases.
        if preferred_album:
            rows = db.execute("""
                SELECT c.artist, c.title, c.format, c.url, t.title AS track_title
                FROM   discogs_tracks t
                JOIN   discogs_collection c ON c.release_id = t.release_id
                WHERE  LOWER(c.artist) IN ('various', 'various artists', 'v/a')
                  AND  LOWER(c.title)  = LOWER(?)
                  AND  LOWER(t.title)  = LOWER(?)
            """, (preferred_album, track_title)).fetchall()
            if rows:
                result = dict(rows[0])
                result["artist"] = artist  # preserve performing artist
                return result

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
        matches = [r for r in rows if normalize_album(r["track_title"]) == norm]
        if matches:
            return _pick(matches)

        # Normalized VA continuity fallback
        if preferred_album:
            rows = db.execute("""
                SELECT c.artist, c.title, c.format, c.url, t.title AS track_title
                FROM   discogs_tracks t
                JOIN   discogs_collection c ON c.release_id = t.release_id
                WHERE  LOWER(c.artist) IN ('various', 'various artists', 'v/a')
                  AND  LOWER(c.title)  = LOWER(?)
            """, (preferred_album,)).fetchall()
            matches = [r for r in rows if normalize_album(r["track_title"]) == norm]
            if matches:
                result = dict(matches[0])
                result["artist"] = artist
                return result

        return None
    except sqlite3.OperationalError:
        return None  # table may not exist yet


def normalize_songs(db: sqlite3.Connection) -> int:
    """
    Update all songs in the DB to use canonical Discogs artist/album naming.
    For each song, tries album-level matching first, then track-level as fallback.
    Returns the number of rows updated.
    """
    updated = 0

    # Recover performing artist from raw_json for songs stored under "Various".
    try:
        va_songs = db.execute(
            "SELECT id, raw_json FROM songs"
            " WHERE LOWER(artist) IN ('various', 'various artists', 'v/a')"
            "   AND raw_json IS NOT NULL"
        ).fetchall()
        for row in va_songs:
            try:
                shazam_data = ast.literal_eval(row["raw_json"])
                performing_artist = shazam_data.get("subtitle", "").strip()
                if performing_artist and performing_artist.lower() not in _VA_NAMES:
                    db.execute("UPDATE songs SET artist = ? WHERE id = ?",
                               (performing_artist, row["id"]))
                    updated += 1
            except (ValueError, SyntaxError):
                pass
        if updated:
            db.commit()
    except sqlite3.OperationalError:
        pass

    try:
        rows = db.execute(
            "SELECT DISTINCT artist, album, title FROM songs WHERE album IS NOT NULL"
        ).fetchall()
    except sqlite3.OperationalError:
        return updated

    # Cache album-level results to avoid repeating the same lookup per album
    album_cache: dict = {}

    for row in rows:
        key = (row["artist"], row["album"])
        if key not in album_cache:
            album_cache[key] = find_in_collection(db, row["artist"], row["album"])

        match = album_cache[key]

        # Fall back to track-level lookup using the song title
        if not match:
            match = find_album_by_track(db, row["artist"], row["title"])

        if not match:
            d_title = normalize_track_title(row["title"])
            if d_title != row["title"]:
                db.execute(
                    "UPDATE songs SET title = ? WHERE artist = ? AND album = ? AND title = ?",
                    (d_title, row["artist"], row["album"], row["title"]),
                )
                updated += 1
            continue

        d_artist = match["artist"]
        d_album  = match["title"]
        d_title  = match.get("track_title") or normalize_track_title(row["title"])

        if d_artist != row["artist"] or d_album != row["album"] or d_title != row["title"]:
            db.execute(
                "UPDATE songs SET artist = ?, album = ?, title = ? "
                "WHERE artist = ? AND album = ? AND title = ?",
                (d_artist, d_album, d_title, row["artist"], row["album"], row["title"]),
            )
            updated += 1

    if updated:
        db.commit()
    return updated
