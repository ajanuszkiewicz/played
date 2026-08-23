import { useState, useEffect, useCallback } from 'react'
import { Sparkles, RefreshCw } from 'lucide-react'

interface Rec {
  artist: string
  album: string
  reason: string
}

interface RecData {
  mood: string
  recommendations: Rec[]
}

export function Recommendations() {
  const [data, setData] = useState<RecData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (refresh = false) => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/recommendations' + (refresh ? '?refresh=1' : ''))
      const d = await r.json()
      if (d.error) throw new Error(d.error)
      setData(d)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'unknown')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <Sparkles size={18} className="text-amber-400" strokeWidth={2} />
          <h2 className="text-white">What to play?</h2>
          {data?.mood && !loading && (
            <span className="text-sm text-amber-400/60 italic">{data.mood}</span>
          )}
        </div>
        <button
          onClick={() => load(true)}
          disabled={loading}
          title="Refresh recommendations"
          className="p-1.5 text-gray-600 hover:text-gray-400 transition-colors disabled:opacity-30"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {Array(4).fill(null).map((_, i) => (
            <div key={i} className="bg-gray-700/20 rounded-xl p-4 animate-pulse space-y-2">
              <div className="h-3.5 bg-gray-600/40 rounded w-3/4" />
              <div className="h-3   bg-gray-600/30 rounded w-1/2 mb-3" />
              <div className="h-3   bg-gray-600/20 rounded w-full" />
              <div className="h-3   bg-gray-600/20 rounded w-4/5" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="text-center py-6 space-y-2">
          <p className="text-gray-500 text-sm">
            {error === 'not_configured'
              ? 'Add ANTHROPIC_API_KEY to the env file to enable recommendations.'
              : error === 'no_collection'
              ? 'Sync your Discogs collection first.'
              : 'Could not load recommendations.'}
          </p>
          {error !== 'not_configured' && (
            <button onClick={() => load(true)} className="text-xs text-gray-600 hover:text-gray-400 underline">
              Try again
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {data?.recommendations.map((rec, i) => (
            <div
              key={i}
              className="bg-gray-700/20 rounded-xl p-4 border border-gray-600/20 hover:border-amber-500/20 transition-colors"
            >
              <p className="text-white text-sm mb-0.5">{rec.artist}</p>
              <p className="text-amber-400/80 text-xs mb-3">{rec.album}</p>
              <p className="text-gray-500 text-xs leading-relaxed">{rec.reason}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
