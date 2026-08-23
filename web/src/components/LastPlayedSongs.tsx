import { useState, useEffect, useRef, useCallback } from 'react'
import { Clock, Disc3, Search, Trash2 } from 'lucide-react'
import { toUTC } from '../App'
import { StarRating } from './StarRating'
import type { Song } from '../types'

type DiscogsEntry = { owned: boolean | null; url?: string | null }

const LIMIT = 20

function fmt(iso: string): string {
  const diff = Math.floor((Date.now() - toUTC(iso)) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z')
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

interface Props {
  latestId: number | null
  ratingPatch?: { id: number; rating: number | null } | null
}

export function LastPlayedSongs({ latestId, ratingPatch }: Props) {
  const [songs, setSongs] = useState<Song[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(true)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)

  const [pendingDelete, setPendingDelete] = useState<number | null>(null)
  const pendingDeleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [discogsCache, setDiscogsCache] = useState<Record<string, DiscogsEntry>>({})
  const fetchedKeysRef = useRef<Set<string>>(new Set())

  const handleTrash = useCallback(async (song: Song) => {
    if (pendingDelete === song.id) {
      // Second click — delete the song
      if (pendingDeleteTimer.current) clearTimeout(pendingDeleteTimer.current)
      setPendingDelete(null)
      setSongs(prev => prev.filter(s => s.id !== song.id))
      setTotal(prev => prev - 1)
      await fetch(`/api/songs/${song.id}`, { method: 'DELETE' })
    } else {
      // First click — clear the rating
      if (pendingDeleteTimer.current) clearTimeout(pendingDeleteTimer.current)
      setPendingDelete(song.id)
      setSongs(prev => prev.map(s => s.id === song.id ? { ...s, rating: null } : s))
      await fetch(`/api/songs/${song.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: null }),
      })
      // Auto-reset after 3s if no second click
      pendingDeleteTimer.current = setTimeout(() => setPendingDelete(null), 3000)
    }
  }, [pendingDelete])

  const load = useCallback(async (p: number, q: string, append: boolean) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(LIMIT) })
      if (q) params.set('q', q)
      const r = await fetch('/api/songs?' + params)
      const d = await r.json()
      setSongs(prev => append ? [...prev, ...d.songs] : d.songs)
      setTotal(d.total)
      setHasMore(p * LIMIT < d.total)
    } finally {
      setLoading(false)
    }
  }, [])

  // Reset and reload when search changes
  const handleSearch = (val: string) => {
    setSearch(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setPage(1)
      load(1, val, false)
    }, 350)
  }

  // Fetch Discogs for any newly loaded songs that have an album
  useEffect(() => {
    const toFetch: Array<{ artist: string; album: string; title: string; key: string }> = []
    songs.forEach(song => {
      if (!song.album) return
      const key = `${song.artist}::${song.album}`
      if (!fetchedKeysRef.current.has(key)) {
        fetchedKeysRef.current.add(key)
        toFetch.push({ artist: song.artist, album: song.album, title: song.title, key })
      }
    })
    if (toFetch.length === 0) return
    ;(async () => {
      for (const { artist, album, title, key } of toFetch) {
        try {
          const r = await fetch('/api/discogs/check?' + new URLSearchParams({ artist, album, title }))
          const d = await r.json()
          setDiscogsCache(prev => ({ ...prev, [key]: d }))
        } catch { /* non-fatal */ }
      }
    })()
  }, [songs])

  // Initial load
  useEffect(() => { load(1, '', false) }, [load])

  // Apply rating update from Now Playing
  useEffect(() => {
    if (!ratingPatch) return
    setSongs(prev => prev.map(s => s.id === ratingPatch.id ? { ...s, rating: ratingPatch.rating } : s))
  }, [ratingPatch])

  // Reload from page 1 when a new song appears (latestId changes)
  const prevLatestId = useRef<number | null>(null)
  useEffect(() => {
    if (latestId === null) return
    if (prevLatestId.current !== null && latestId !== prevLatestId.current) {
      setPage(1)
      load(1, search, false)
    }
    prevLatestId.current = latestId
  }, [latestId, search, load])

  // Load next page when sentinel is visible
  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect()
    if (!hasMore || loading) return

    observerRef.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        setPage(p => {
          const next = p + 1
          load(next, search, true)
          return next
        })
      }
    }, { threshold: 0.1 })

    if (sentinelRef.current) observerRef.current.observe(sentinelRef.current)
    return () => observerRef.current?.disconnect()
  }, [hasMore, loading, search, load])

  return (
    <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-2xl p-6 flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 mb-5">
        <div className="flex items-center gap-2">
          <Clock size={18} className="text-gray-400" strokeWidth={2} />
          <h2 className="text-white">Song History</h2>
        </div>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          <input
            type="text"
            placeholder="Search…"
            value={search}
            onChange={e => handleSearch(e.target.value)}
            className="pl-7 pr-3 py-1.5 text-xs bg-gray-700/50 border border-gray-600/50 rounded-lg text-gray-300 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50 w-44"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-0.5 max-h-109 scrollbar-thin">
        {songs.length === 0 && loading ? (
          Array(6).fill(null).map((_, i) => (
            <div key={i} className="py-3 px-3 rounded-lg animate-pulse">
              <div className="h-3.5 bg-gray-700/50 rounded w-3/4" />
            </div>
          ))
        ) : songs.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-8">No songs found.</p>
        ) : (
          <>
            {songs.map(song => (
              <div key={`${song.id}-${song.played_at}`} className="text-sm py-2 px-3 rounded-lg hover:bg-gray-700/30 transition-colors group">
                <div className="flex items-center gap-2">
                  <div className="flex items-baseline gap-2 flex-wrap flex-1 min-w-0">
                    <span className="text-gray-500 text-xs min-w-[80px] shrink-0">{fmt(song.played_at)}</span>
                    <span className="text-white group-hover:text-blue-400 transition-colors truncate">{song.artist}</span>
                    <span className="text-gray-600">·</span>
                    <span className="text-gray-300 truncate">{song.title}</span>
                    {song.album && (() => {
                      const dc = discogsCache[`${song.artist}::${song.album}`]
                      return <>
                        <span className="text-gray-600">·</span>
                        {dc?.owned && dc?.url ? (
                          <a href={dc.url} target="_blank" rel="noopener noreferrer"
                            className="text-xs truncate text-emerald-500 hover:text-emerald-400 transition-colors flex items-center gap-0.5">
                            {song.album}<Disc3 size={10} />
                          </a>
                        ) : (
                          <span className="text-gray-500 text-xs truncate">{song.album}</span>
                        )}
                      </>
                    })()}
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity" style={{ opacity: song.rating != null ? 1 : undefined }}>
                      <StarRating
                        songId={song.id}
                        initial={song.rating}
                        size={14}
                        monochrome
                        onRate={r => setSongs(prev => prev.map(s => s.id === song.id ? { ...s, rating: r } : s))}
                      />
                    </div>
                    <button
                      onClick={() => handleTrash(song)}
                      className={`transition-all opacity-0 group-hover:opacity-100 ${pendingDelete === song.id ? '!opacity-100 text-red-400' : 'text-gray-600 hover:text-red-400'}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <div ref={sentinelRef} className="py-2 text-center">
              {loading && <span className="text-xs text-gray-600">Loading…</span>}
            </div>
          </>
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-gray-700/50">
        <span className="text-xs text-gray-500">{total.toLocaleString()} songs · {songs.length} loaded</span>
      </div>
    </div>
  )
}
