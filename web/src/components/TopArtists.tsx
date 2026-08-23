import { useState, useEffect, useRef } from 'react'
import { ChevronRight, ChevronLeft, Users, Disc3, Music, Trash2 } from 'lucide-react'
import { StarDisplay } from './StarRating'
import type { ArtistSummary, ArtistDetail } from '../types'

const DATE_FILTERS = [
  { value: 'all',   label: 'All Time' },
  { value: 'week',  label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'year',  label: 'This Year' },
]

function sinceISO(filter: string): string {
  const now = Date.now()
  const days: Record<string, number> = { week: 7, month: 30, year: 365 }
  if (!days[filter]) return ''
  return new Date(now - days[filter] * 86_400_000).toISOString().slice(0, 10)
}

const PAGE_SIZE = 10

export function TopArtists() {
  const [artists, setArtists] = useState<ArtistSummary[]>([])
  const [dateFilter, setDateFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<ArtistSummary | null>(null)
  const [detail, setDetail] = useState<ArtistDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [ownedAlbums, setOwnedAlbums] = useState<Record<string, boolean>>({})
  const fetchedAlbumsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const since = sinceISO(dateFilter)
    const params = since ? '?since=' + since : ''
    fetch('/api/artists' + params)
      .then(r => r.json())
      .then((data: ArtistSummary[]) => { setArtists(data); setPage(1) })
      .catch(() => {})
  }, [dateFilter])

  const pages = Math.ceil(artists.length / PAGE_SIZE)
  const pageArtists = artists.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const globalOffset = (page - 1) * PAGE_SIZE

  useEffect(() => {
    if (!detail || !selected) return
    const toFetch = detail.albums.filter(album => {
      const key = `${selected.artist}::${album}`
      if (fetchedAlbumsRef.current.has(key)) return false
      fetchedAlbumsRef.current.add(key)
      return true
    })
    if (toFetch.length === 0) return
    ;(async () => {
      for (const album of toFetch) {
        try {
          const r = await fetch('/api/discogs/check?' + new URLSearchParams({ artist: selected.artist, album }))
          const d = await r.json()
          if (d.owned) setOwnedAlbums(prev => ({ ...prev, [`${selected.artist}::${album}`]: true }))
        } catch { /* non-fatal */ }
      }
    })()
  }, [detail, selected])

  const selectArtist = async (artist: ArtistSummary) => {
    setSelected(artist)
    setDetail(null)
    setOwnedAlbums({})
    fetchedAlbumsRef.current = new Set()
    setLoadingDetail(true)
    try {
      const r = await fetch('/api/artists/detail?name=' + encodeURIComponent(artist.artist))
      setDetail(await r.json())
    } catch { /* show partial info */ } finally {
      setLoadingDetail(false)
    }
  }

  const deleteArtist = async (name: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setArtists(prev => prev.filter(a => a.artist !== name))
    if (selected?.artist === name) { setSelected(null); setDetail(null) }
    await fetch('/api/artists?' + new URLSearchParams({ name }), { method: 'DELETE' })
  }

  return (
    <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-2xl p-6">
      <div className="flex justify-between items-center mb-5">
        <div className="flex items-center gap-2">
          <Users size={18} className="text-gray-400" strokeWidth={2} />
          <h2 className="text-white">Top Artists</h2>
        </div>
        {!selected && (
          <select
            value={dateFilter}
            onChange={e => setDateFilter(e.target.value)}
            className="text-sm bg-gray-700/50 border border-gray-600/50 rounded-lg px-3 py-2 text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
          >
            {DATE_FILTERS.map(f => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        )}
      </div>

      {selected ? (
        <div>
          <div className="flex items-center justify-between mb-6">
            <button
              onClick={() => { setSelected(null); setDetail(null) }}
              className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors group"
            >
              <ChevronLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
              Back to artists
            </button>
            <button
              onClick={() => deleteArtist(selected.artist)}
              className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-red-400 transition-colors"
            >
              <Trash2 size={13} />
              Delete all plays
            </button>
          </div>
          <div>
            <div className="mb-6 pb-6 border-b border-gray-700/50">
              <h3 className="text-xl text-white mb-2">{selected.artist}</h3>
              <div className="flex items-center gap-4 flex-wrap">
                <p className="text-sm text-gray-400">{selected.plays.toLocaleString()} plays</p>
                {detail?.avg_rating != null && (
                  <StarDisplay rating={detail.avg_rating} size={14} />
                )}
              </div>
            </div>
            {loadingDetail ? (
              <div className="space-y-2">
                {Array(3).fill(null).map((_, i) => (
                  <div key={i} className="h-9 bg-gray-700/20 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : detail && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {detail.albums.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Disc3 size={16} className="text-purple-400" />
                      <p className="text-sm text-gray-300">Albums</p>
                    </div>
                    <ul className="space-y-2">
                      {detail.albums.map((album, i) => {
                        const owned = ownedAlbums[`${selected.artist}::${album}`]
                        return (
                          <li key={i} className={`flex items-center justify-between text-sm py-2 px-3 bg-gray-700/20 rounded-lg hover:bg-gray-700/40 transition-colors ${owned ? 'text-emerald-400' : 'text-gray-400'}`}>
                            <span>{album}</span>
                            {owned && <Disc3 size={13} className="shrink-0 ml-2" />}
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}
                {detail.top_songs.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Music size={16} className="text-blue-400" />
                      <p className="text-sm text-gray-300">Top Songs</p>
                    </div>
                    <ul className="space-y-2">
                      {detail.top_songs.map((song, i) => (
                        <li key={i} className="flex justify-between items-center text-sm text-gray-400 py-2 px-3 bg-gray-700/20 rounded-lg hover:bg-gray-700/40 transition-colors">
                          <span>{song.title}</span>
                          <span className="text-xs text-gray-600 ml-4">{song.plays}×</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div>
          <div className="space-y-2">
            {artists.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-8">No data yet.</p>
            ) : pageArtists.map((artist, idx) => (
              <div key={artist.artist} className="group flex items-center">
                <button
                  onClick={() => selectArtist(artist)}
                  className="flex-1 flex justify-between items-center py-3 px-4 hover:bg-gray-700/30 rounded-xl text-left transition-all border border-transparent hover:border-gray-600/30"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs shrink-0">
                      {globalOffset + idx + 1}
                    </div>
                    <div>
                      <p className="text-sm text-white group-hover:text-blue-400 transition-colors">{artist.artist}</p>
                      <p className="text-xs text-gray-500">{artist.plays.toLocaleString()} plays</p>
                    </div>
                  </div>
                  <ChevronRight size={18} className="text-gray-600 group-hover:text-gray-400 group-hover:translate-x-1 transition-all shrink-0" />
                </button>
                <button
                  onClick={e => deleteArtist(artist.artist, e)}
                  className="ml-2 p-2 text-gray-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-700/50">
              <span className="text-xs text-gray-500">{artists.length} artists · page {page} of {pages}</span>
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
      )}
    </div>
  )
}
