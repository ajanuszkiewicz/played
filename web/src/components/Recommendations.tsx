import { useState, useCallback, useRef } from 'react'
import { Sparkles, RefreshCw, ArrowRight } from 'lucide-react'

interface Rec {
  artist: string
  album: string
  reason: string
}

interface RecData {
  mood: string
  recommendations: Rec[]
}

interface Props {
  currentSong?: { artist: string; album: string | null } | null
}

export function Recommendations({ currentSong }: Props) {
  const [data, setData] = useState<RecData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [customPrompt, setCustomPrompt] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async (refresh = false, prompt = '') => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (refresh) params.set('refresh', '1')
      if (currentSong?.album) {
        params.set('current_artist', currentSong.artist)
        params.set('current_album', currentSong.album)
      }
      if (prompt.trim()) params.set('custom_prompt', prompt.trim())
      const r = await fetch('/api/recommendations?' + params)
      const d = await r.json()
      if (d.error) throw new Error(d.error)
      setData(d)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'unknown')
    } finally {
      setLoading(false)
    }
  }, [currentSong?.artist, currentSong?.album])

  const handleAsk = useCallback(() => {
    load(true, customPrompt)
  }, [load, customPrompt])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAsk()
  }

  const promptInput = (placeholder: string) => (
    <div className="flex gap-2">
      <input
        ref={inputRef}
        type="text"
        value={customPrompt}
        onChange={e => setCustomPrompt(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="flex-1 bg-gray-700/30 border border-gray-600/30 rounded-lg px-3 py-1.5 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-amber-500/40 focus:ring-1 focus:ring-amber-500/20 transition-colors"
      />
      <button
        onClick={handleAsk}
        disabled={loading}
        className="px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-40 disabled:cursor-default flex items-center gap-1.5 text-sm shrink-0"
      >
        <ArrowRight size={14} />
      </button>
    </div>
  )

  const promptLabel = currentSong?.album ? 'What should I play next?' : 'Suggest something to play'

  if (!data && !loading && !error) {
    return (
      <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-2xl p-6 flex flex-col gap-3 min-h-[80px] justify-center">
        {promptInput('Ask for a recommendation…')}
        <div className="flex justify-center">
          <button
            onClick={() => load()}
            className="flex items-center gap-2 text-gray-500 hover:text-amber-400 transition-colors"
          >
            <Sparkles size={14} strokeWidth={2} />
            <span className="text-sm">{promptLabel}</span>
          </button>
        </div>
      </div>
    )
  }

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
          onClick={() => load(true, customPrompt)}
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

      <div className="mt-4 pt-4 border-t border-gray-700/30">
        {promptInput('Ask for something different…')}
      </div>
    </div>
  )
}
