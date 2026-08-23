import { Music, Disc3, RefreshCw } from 'lucide-react'
import { toUTC } from '../App'
import { StarRating } from './StarRating'

interface Song {
  id: number
  artist: string
  title: string
  album: string | null
  albumArt?: string
  rating: number | null
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
}

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

export function CurrentlyPlaying({ song, lastSong, onRate, discogs, discogsStatus, onDiscogsSync }: Props) {
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
    <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-2xl p-6 h-full hover:border-gray-600/50 transition-colors">
      <p className="text-xs text-emerald-400 mb-4 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
        Now Playing
      </p>
      <div className="aspect-square bg-gradient-to-br from-gray-700 to-gray-800 rounded-xl mb-6 flex items-center justify-center overflow-hidden shadow-xl">
        {song.albumArt ? (
          <img src={song.albumArt} alt={song.album ?? song.title} className="w-full h-full object-cover" />
        ) : (
          <Music className="text-gray-600" size={96} strokeWidth={1.5} />
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
            <span className="text-xs">In Collection{discogs.format ? ` · ${discogs.format}` : ''}</span>
          </a>
        )}
        {discogs?.owned === false && (
          <span className="flex items-center justify-center gap-1.5 text-gray-600">
            <Disc3 size={13} />
            <span className="text-xs">Not in Collection</span>
          </span>
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
      </div>
    </div>
  )
}
