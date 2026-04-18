import { useState, useRef } from 'react'
import { Radio } from 'lucide-react'

type State = 'idle' | 'playing' | 'error'

export function ListenButton() {
  const [state, setState] = useState<State>('idle')
  const [errMsg, setErrMsg] = useState('')
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const toggle = async () => {
    if (state === 'playing' && audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
      audioRef.current = null
      setState('idle')
      return
    }

    const audio = new Audio('/api/stream/audio')
    audioRef.current = audio

    audio.addEventListener('error', async () => {
      setState('error')
      try {
        const r = await fetch('/api/stream/audio')
        if (!r.ok) {
          const d = await r.json()
          setErrMsg(d.error || 'Stream unavailable')
        } else {
          setErrMsg('Stream error')
        }
      } catch {
        setErrMsg('Stream error')
      }
      audioRef.current = null
      setTimeout(() => setState('idle'), 4000)
    })

    try {
      await audio.play()
      setState('playing')
    } catch {
      setState('error')
      setErrMsg('Playback blocked')
      audioRef.current = null
      setTimeout(() => setState('idle'), 3000)
    }
  }

  const label = state === 'playing' ? 'Listening…' : state === 'error' ? errMsg || 'Error' : 'Listen Live'
  const classes =
    state === 'playing'
      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
      : state === 'error'
      ? 'border-red-500/40 bg-red-500/10 text-red-400'
      : 'border-gray-700/50 bg-gray-800/50 text-gray-300 hover:bg-gray-700/50 hover:border-gray-600/50'

  return (
    <button
      onClick={toggle}
      className={`px-4 py-2 border rounded-xl backdrop-blur-sm flex items-center gap-2 text-sm transition-all ${classes}`}
    >
      <Radio size={15} className={state === 'playing' ? 'animate-pulse' : ''} />
      <span>{label}</span>
      {state === 'playing' && (
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
      )}
    </button>
  )
}
