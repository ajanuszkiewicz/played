import { useState } from 'react'
import { Music } from 'lucide-react'
import { toUTC } from '../App'

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

interface Props {
  song: Song | null
  lastSong: LastSong | null
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - toUTC(iso)) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return new Date(iso.endsWith('Z') ? iso : iso + 'Z')
    .toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// SVG star — filled, half (left 50%), or empty
function StarShape({ fill }: { fill: 'full' | 'half' | 'empty' }) {
  const id = `half-${Math.random().toString(36).slice(2)}`
  const path = "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      {fill === 'half' && (
        <defs>
          <linearGradient id={id} x1="0" x2="1" y1="0" y2="0">
            <stop offset="50%" stopColor="#fbbf24" />
            <stop offset="50%" stopColor="transparent" />
          </linearGradient>
        </defs>
      )}
      <path
        d={path}
        fill={fill === 'full' ? '#fbbf24' : fill === 'half' ? `url(#${id})` : 'transparent'}
        stroke={fill === 'empty' ? '#4b5563' : '#fbbf24'}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function StarRating({ songId, initial }: { songId: number; initial: number | null }) {
  const [rating, setRating] = useState<number | null>(initial)
  const [hover, setHover] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  const display = hover ?? rating ?? 0

  const submit = async (value: number) => {
    // Toggle off if clicking the same value
    const next = value === rating ? null : value
    setRating(next)
    setSaving(true)
    try {
      await fetch(`/api/songs/${songId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: next }),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`flex items-center gap-1 transition-opacity ${saving ? 'opacity-50' : ''}`}>
      {[1, 2, 3, 4, 5].map(star => {
        const fullFill = display >= star ? 'full' : display >= star - 0.5 ? 'half' : 'empty'
        return (
          <div key={star} className="relative cursor-pointer select-none" onMouseLeave={() => setHover(null)}>
            <StarShape fill={fullFill} />
            {/* left half → half star */}
            <div
              className="absolute inset-y-0 left-0 w-1/2"
              onMouseEnter={() => setHover(star - 0.5)}
              onClick={() => submit(star - 0.5)}
            />
            {/* right half → full star */}
            <div
              className="absolute inset-y-0 right-0 w-1/2"
              onMouseEnter={() => setHover(star)}
              onClick={() => submit(star)}
            />
          </div>
        )
      })}
    </div>
  )
}

export function CurrentlyPlaying({ song, lastSong }: Props) {
  if (!song) {
    return (
      <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-2xl p-8 flex flex-col items-center justify-center min-h-[400px] gap-4">
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
    <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-2xl p-6 hover:border-gray-600/50 transition-colors">
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
        <div className="flex justify-center pt-1">
          <StarRating songId={song.id} initial={song.rating} />
        </div>
      </div>
    </div>
  )
}
