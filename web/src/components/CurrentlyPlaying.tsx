import { useState, useEffect } from 'react'
import { Music, Disc3, RefreshCw, ScrollText, X, Pin, PinOff } from 'lucide-react'
import { toUTC } from '../App'
import { StarRating } from './StarRating'

interface Song {
  id: number
  artist: string
  title: string
  album: string | null
  albumArt?: string
  rating: number | null
  isPinned?: boolean
}

interface LastSong {
  artist: string
  title: string
  playedAt: string
}

interface DiscogsStatus {
  configured: boolean
  syncing: boolean
  last_sync: string | null
  count: number
}

interface Props {
  song: Song | null
  lastSong: LastSong | null
  onRate?: (songId: number, rating: number | null) => void
  discogs?: { owned: boolean | null; format?: string | null; url?: string | null } | null
  discogsStatus?: DiscogsStatus | null
  onDiscogsSync?: () => void
  onArtworkChange?: () => void
}

type LyricsState = { found: boolean; instrumental: boolean; plainLyrics?: string | null }

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - toUTC(iso)) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return new Date(iso.endsWith('Z') ? iso : iso + 'Z')
    .toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function syncedAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export function CurrentlyPlaying({ song, lastSong, onRate, discogs, discogsStatus, onDiscogsSync, onArtworkChange }: Props) {
  const [lyricsOpen, setLyricsOpen] = useState(false)
  const [lyrics, setLyrics] = useState<LyricsState | null>(null)
  const [lyricsLoading, setLyricsLoading] = useState(false)
  const [pinning, setPinning] = useState(false)

  // Reset when song changes
  useEffect(() => {
    setLyricsOpen(false)
    setLyrics(null)
  }, [song?.id])

  const togglePin = async () => {
    if (!song?.album || !song.albumArt || pinning) return
    setPinning(true)
    try {
      if (song.isPinned) {
        const params = new URLSearchParams({ artist: song.artist, album: song.album })
        await fetch('/api/artwork/pin?' + params, { method: 'DELETE' })
      } else {
        await fetch('/api/artwork/pin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ artist: song.artist, album: song.album, cover_art: song.albumArt }),
        })
      }
      onArtworkChange?.()
    } finally {
      setPinning(false)
    }
  }

  const openLyrics = async () => {
    setLyricsOpen(true)
    if (lyrics || !song) return
    setLyricsLoading(true)
    try {
      const params = new URLSearchParams({ artist: song.artist, title: song.title })
      if (song.album) params.set('album', song.album)
      const r = await fetch('/api/lyrics?' + params)
      setLyrics(await r.json())
    } catch {
      setLyrics({ found: false, instrumental: false })
    } finally {
      setLyricsLoading(false)
    }
  }

  if (!song) {
    return (
      <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-2xl p-8 flex flex-col items-center justify-center min-h-[400px] h-full gap-4">
        <div className="text-center text-gray-500">
          <Music className="mx-auto mb-3" size={56} strokeWidth={1.5} />
          <p className="text-sm">Nothing playing</p>
        </div>
        {lastSong && (
          <div className="text-center mt-2">
            <p className="text-xs text-gray-600 mb-1">{timeAgo(lastSong.playedAt)}</p>
            <p className="text-sm text-gray-400">
              <span className="text-gray-300">{lastSong.artist}</span>
              <span className="text-gray-600 mx-1.5">·</span>
              {lastSong.title}
            </p>
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-2xl p-6 h-full hover:border-gray-600/50 transition-colors">
        <p className="text-xs text-emerald-400 mb-4 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
          Now Playing
        </p>
        <div className="group relative aspect-square bg-gradient-to-br from-gray-700 to-gray-800 rounded-xl mb-6 flex items-center justify-center overflow-hidden shadow-xl">
          {song.albumArt ? (
            <img src={song.albumArt} alt={song.album ?? song.title} className="w-full h-full object-cover" />
          ) : (
            <Music className="text-gray-600" size={96} strokeWidth={1.5} />
          )}
          {song.album && song.albumArt && (
            <button
              onClick={togglePin}
              disabled={pinning}
              title={song.isPinned ? 'Unpin art' : 'Pin this art for album'}
              className={`absolute bottom-2 right-2 p-1.5 rounded-lg transition-all disabled:opacity-50
                ${song.isPinned
                  ? 'bg-black/60 text-emerald-400 opacity-100'
                  : 'bg-black/50 text-gray-300 opacity-0 group-hover:opacity-100 hover:text-white'
                }`}
            >
              {song.isPinned ? <PinOff size={13} /> : <Pin size={13} />}
            </button>
          )}
        </div>
        <div className="text-center space-y-2">
          <p className="text-sm text-gray-300 leading-relaxed">
            <span className="text-white font-medium">{song.artist}</span>
            <span className="text-gray-500 mx-1.5">·</span>
            <span className="text-gray-300">{song.title}</span>
          </p>
          {song.album && <p className="text-xs text-gray-500">{song.album}</p>}
          {discogs?.owned === true && (
            <a
              href={discogs.url ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center justify-center gap-1.5 text-emerald-400 ${discogs.url ? 'hover:text-emerald-300 transition-colors' : 'pointer-events-none'}`}
            >
              <Disc3 size={13} />
              <span className="text-xs">In Collection{discogs.format ? ` - ${discogs.format.split(',')[0].trim()}` : ''}</span>
            </a>
          )}
          {discogs?.owned === false && (
            <a
              href={`https://www.discogs.com/search/?q=${encodeURIComponent(`${song.artist} ${song.album}`)}&type=release`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 text-gray-600 hover:text-gray-400 transition-colors"
            >
              <Disc3 size={13} />
              <span className="text-xs">Not in Collection</span>
            </a>
          )}
          {discogsStatus?.configured && (
            <div className="flex items-center justify-center gap-1.5 text-gray-700 text-xs">
              {discogsStatus.syncing ? (
                <span className="flex items-center gap-1"><RefreshCw size={10} className="animate-spin" />Syncing collection…</span>
              ) : discogsStatus.last_sync ? (
                <button onClick={onDiscogsSync} className="flex items-center gap-1 hover:text-gray-500 transition-colors" title="Sync Discogs collection now">
                  <RefreshCw size={10} />
                  {discogsStatus.count} records · {syncedAgo(discogsStatus.last_sync)}
                </button>
              ) : (
                <button onClick={onDiscogsSync} className="flex items-center gap-1 hover:text-gray-500 transition-colors">
                  <RefreshCw size={10} />Sync collection
                </button>
              )}
            </div>
          )}
          <div className="flex justify-center pt-1">
            <StarRating key={song.id} songId={song.id} initial={song.rating} onRate={r => onRate?.(song.id, r)} />
          </div>
          <div className="flex justify-center pt-2">
            <button
              onClick={openLyrics}
              className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-400 transition-colors"
            >
              <ScrollText size={12} />
              Lyrics
            </button>
          </div>
        </div>
      </div>

      {/* Lyrics modal */}
      {lyricsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={() => setLyricsOpen(false)}
        >
          <div
            className="bg-gray-900 border border-gray-700/50 rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-start justify-between p-5 border-b border-gray-700/50 shrink-0">
              <div>
                <p className="text-white text-sm font-medium">{song.title}</p>
                <p className="text-gray-500 text-xs mt-0.5">{song.artist}</p>
              </div>
              <button
                onClick={() => setLyricsOpen(false)}
                className="text-gray-600 hover:text-gray-300 transition-colors ml-4 shrink-0"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal body */}
            <div className="overflow-y-auto p-5 scrollbar-thin">
              {lyricsLoading ? (
                <p className="text-gray-500 text-sm text-center py-8">Loading…</p>
              ) : lyrics?.instrumental ? (
                <p className="text-gray-500 text-sm text-center py-8">Instrumental track</p>
              ) : lyrics?.found && lyrics.plainLyrics ? (
                <p className="text-gray-300 text-sm leading-7 whitespace-pre-line">{lyrics.plainLyrics}</p>
              ) : (
                <p className="text-gray-500 text-sm text-center py-8">No lyrics found</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
