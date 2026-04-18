import { useState, useEffect, useRef } from 'react'
import { Clock, Search } from 'lucide-react'
import { toUTC } from '../App'
import type { Song } from '../types'

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

export function LastPlayedSongs() {
  const [songs, setSongs] = useState<Song[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = async (p: number, q: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(LIMIT) })
      if (q) params.set('q', q)
      const r = await fetch('/api/songs?' + params)
      const d = await r.json()
      setSongs(d.songs)
      setTotal(d.total)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(page, search) }, [page])

  const handleSearch = (val: string) => {
    setSearch(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setPage(1)
      load(1, val)
    }, 350)
  }

  const pages = Math.ceil(total / LIMIT)

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

      <div className="flex-1 overflow-y-auto space-y-0.5 max-h-80 scrollbar-thin">
        {loading ? (
          Array(6).fill(null).map((_, i) => (
            <div key={i} className="py-3 px-3 rounded-lg animate-pulse">
              <div className="h-3.5 bg-gray-700/50 rounded w-3/4" />
            </div>
          ))
        ) : songs.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-8">No songs found.</p>
        ) : songs.map(song => (
          <div key={song.id} className="text-sm py-2.5 px-3 rounded-lg hover:bg-gray-700/30 transition-colors group">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-gray-500 text-xs min-w-[80px]">{fmt(song.played_at)}</span>
              <span className="text-white group-hover:text-blue-400 transition-colors">{song.artist}</span>
              <span className="text-gray-600">·</span>
              <span className="text-gray-300">{song.title}</span>
              {song.album && <>
                <span className="text-gray-600">·</span>
                <span className="text-gray-500 text-xs">{song.album}</span>
              </>}
              {song.release_date && (
                <span className="text-gray-600 ml-auto text-xs">{song.release_date.slice(0, 4)}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-700/50">
          <span className="text-xs text-gray-500">{total.toLocaleString()} songs · page {page} of {pages}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => p - 1)}
              disabled={page <= 1}
              className="px-3 py-1.5 text-xs bg-gray-700/50 border border-gray-600/50 rounded-lg text-gray-300 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-default transition-colors"
            >← Prev</button>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page >= pages}
              className="px-3 py-1.5 text-xs bg-gray-700/50 border border-gray-600/50 rounded-lg text-gray-300 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-default transition-colors"
            >Next →</button>
          </div>
        </div>
      )}
    </div>
  )
}
