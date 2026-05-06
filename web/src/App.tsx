import { useState, useEffect, useRef, useCallback } from 'react'
import { Radio, Zap } from 'lucide-react'
import { CurrentlyPlaying } from './components/CurrentlyPlaying'
import { LastPlayedSongs } from './components/LastPlayedSongs'
import { GeneralStats } from './components/GeneralStats'
import { ActivityChart } from './components/ActivityChart'
import { TopArtists } from './components/TopArtists'
import { SystemStats } from './components/SystemStats'
import { ListenButton } from './components/ListenButton'
import type { StatsData, SysStats } from './types'

// played_at is stored as UTC without 'Z' — append it for correct JS parsing
export function toUTC(s: string): number {
  return new Date(s.endsWith('Z') ? s : s + 'Z').getTime()
}

export default function App() {
  const [stats, setStats] = useState<StatsData | null>(null)
  const [sysStats, setSysStats] = useState<SysStats | null>(null)
  const [triggerState, setTriggerState] = useState<'idle' | 'loading' | 'done'>('idle')
  const [ratingPatch, setRatingPatch] = useState<{ id: number; rating: number | null } | null>(null)

  const fetchStats = useCallback(async () => {
    try {
      const r = await fetch('/api/stats')
      if (!r.ok) throw new Error()
      setStats(await r.json())
    } catch { /* non-fatal */ }
  }, [])

  const fetchSystem = useCallback(async () => {
    try {
      const r = await fetch('/api/system')
      if (r.ok) setSysStats(await r.json())
    } catch { /* non-fatal */ }
  }, [])

  const triggerIdentify = useCallback(async () => {
    if (triggerState !== 'idle') return
    setTriggerState('loading')
    try {
      await fetch('/api/trigger', { method: 'POST' })
      setTriggerState('done')
      // Refresh stats after SAMPLE_DURATION + a bit to pick up any new song
      setTimeout(fetchStats, 15_000)
    } catch {
      setTriggerState('idle')
    }
    setTimeout(() => setTriggerState('idle'), 3_000)
  }, [triggerState, fetchStats])

  useEffect(() => {
    fetchStats()
    fetchSystem()
    const statsTimer = setInterval(() => { fetchStats() }, 30_000)
    const sysTimer = setInterval(fetchSystem, 10_000)
    return () => { clearInterval(statsTimer); clearInterval(sysTimer) }
  }, [fetchStats, fetchSystem])

  // Song is "now playing" if identified within the last 10 minutes
  const recent = stats?.recent[0] ?? null
  const isActive = recent ? (Date.now() - toUTC(recent.played_at)) < 10 * 60_000 : false
  const currentSong = isActive && recent
    ? { id: recent.id, artist: recent.artist, title: recent.title, album: recent.album, albumArt: recent.cover_art ?? undefined, rating: recent.rating }
    : null
  const lastSong = !isActive && recent
    ? { artist: recent.artist, title: recent.title, playedAt: recent.played_at }
    : null

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 p-4 md:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl shadow-lg shadow-blue-500/20">
              <Radio size={24} className="text-white" strokeWidth={2} />
            </div>
            <div>
              <h1 className="text-white text-2xl">Song Tracker</h1>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={triggerIdentify}
              disabled={triggerState !== 'idle'}
              className={`px-4 py-2 border rounded-xl backdrop-blur-sm flex items-center gap-2 text-sm transition-all
                ${triggerState === 'done'
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                  : 'border-gray-700/50 bg-gray-800/50 text-gray-300 hover:border-blue-500/50 hover:text-blue-400 disabled:opacity-50 disabled:cursor-default'
                }`}
            >
              <Zap size={16} className={triggerState === 'loading' ? 'animate-pulse' : ''} />
              <span>{triggerState === 'done' ? 'Scanning…' : 'Identify Now'}</span>
            </button>
            <ListenButton />
          </div>
        </div>

        {/* Currently playing + recent songs */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <div className="lg:col-span-1">
            <CurrentlyPlaying song={currentSong} lastSong={lastSong} onRate={(id, rating) => setRatingPatch({ id, rating })} />
          </div>
          <div className="lg:col-span-2">
            <LastPlayedSongs latestId={stats?.recent[0]?.id ?? null} ratingPatch={ratingPatch} />
          </div>
        </div>

        {/* General stats */}
        <div className="mb-6">
          <GeneralStats
            songsToday={stats?.today_count ?? null}
            totalSongs={stats?.total_songs ?? null}
            topArtist={stats?.top_artists[0]?.artist ?? null}
          />
        </div>

        {/* System stats */}
        <div className="mb-6">
          <SystemStats stats={sysStats} />
        </div>

        {/* Activity chart */}
        <div className="mb-6">
          <ActivityChart data={stats?.hourly_24h ?? []} />
        </div>

        {/* Top artists */}
        <TopArtists />

      </div>
    </div>
  )
}
