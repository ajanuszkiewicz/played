import { useState, useEffect } from 'react'
import { ChevronRight, ChevronLeft, Users, Disc3, Music } from 'lucide-react'
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

export function TopArtists() {
  const [artists, setArtists] = useState<ArtistSummary[]>([])
  const [dateFilter, setDateFilter] = useState('all')
  const [selected, setSelected] = useState<ArtistSummary | null>(null)
  const [detail, setDetail] = useState<ArtistDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  useEffect(() => {
    const since = sinceISO(dateFilter)
    const params = since ? '?since=' + since : ''
    fetch('/api/artists' + params)
      .then(r => r.json())
      .then(setArtists)
      .catch(() => {})
  }, [dateFilter])

  const selectArtist = async (artist: ArtistSummary) => {
    setSelected(artist)
    setDetail(null)
    setLoadingDetail(true)
    try {
      const r = await fetch('/api/artists/detail?name=' + encodeURIComponent(artist.artist))
      setDetail(await r.json())
    } catch { /* show partial info */ } finally {
      setLoadingDetail(false)
    }
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
          <button
            onClick={() => { setSelected(null); setDetail(null) }}
            className="flex items-center gap-2 text-sm text-gray-400 mb-6 hover:text-white transition-colors group"
          >
            <ChevronLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
            Back to artists
          </button>
          <div>
            <div className="mb-6 pb-6 border-b border-gray-700/50">
              <h3 className="text-xl text-white mb-2">{selected.artist}</h3>
              <p className="text-sm text-gray-400">{selected.plays.toLocaleString()} plays</p>
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
                      {detail.albums.map((album, i) => (
                        <li key={i} className="text-sm text-gray-400 py-2 px-3 bg-gray-700/20 rounded-lg hover:bg-gray-700/40 transition-colors">
                          {album}
                        </li>
                      ))}
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
        <div className="space-y-2">
          {artists.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-8">No data yet.</p>
          ) : artists.map((artist, idx) => (
            <button
              key={artist.artist}
              onClick={() => selectArtist(artist)}
              className="w-full flex justify-between items-center py-3 px-4 hover:bg-gray-700/30 rounded-xl text-left transition-all group border border-transparent hover:border-gray-600/30"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs shrink-0">
                  {idx + 1}
                </div>
                <div>
                  <p className="text-sm text-white group-hover:text-blue-400 transition-colors">{artist.artist}</p>
                  <p className="text-xs text-gray-500">{artist.plays.toLocaleString()} plays</p>
                </div>
              </div>
              <ChevronRight size={18} className="text-gray-600 group-hover:text-gray-400 group-hover:translate-x-1 transition-all shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
