import { useState, useEffect, useId } from 'react'

function StarShape({ fill, size = 20, monochrome = false }: { fill: 'full' | 'half' | 'empty'; size?: number; monochrome?: boolean }) {
  const id = useId()
  const path = "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
  const activeColor = monochrome ? '#e5e7eb' : '#fbbf24'
  const emptyStroke = monochrome ? '#374151' : '#4b5563'
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {fill === 'half' && (
        <defs>
          <linearGradient id={id} x1="0" x2="1" y1="0" y2="0">
            <stop offset="50%" stopColor={activeColor} />
            <stop offset="50%" stopColor="transparent" />
          </linearGradient>
        </defs>
      )}
      <path
        d={path}
        fill={fill === 'full' ? activeColor : fill === 'half' ? `url(#${id})` : 'transparent'}
        stroke={fill === 'empty' ? emptyStroke : activeColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

interface StarRatingProps {
  songId: number
  initial: number | null
  size?: number
  monochrome?: boolean
  onRate?: (rating: number | null) => void
}

export function StarRating({ songId, initial, size = 20, monochrome = false, onRate }: StarRatingProps) {
  const [rating, setRating] = useState<number | null>(initial)
  const [hover, setHover] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  // Sync when parent changes the value externally (e.g. trash clear, Now Playing update)
  useEffect(() => { setRating(initial) }, [initial])

  const display = hover ?? rating ?? 0

  const submit = async (value: number) => {
    const next = value === rating ? null : value
    setRating(next)
    onRate?.(next)
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
    <div className={`flex items-center gap-0.5 transition-opacity ${saving ? 'opacity-50' : ''}`}>
      {[1, 2, 3, 4, 5].map(star => {
        const fill = display >= star ? 'full' : display >= star - 0.5 ? 'half' : 'empty'
        return (
          <div key={star} className="relative cursor-pointer select-none" onMouseLeave={() => setHover(null)}>
            <StarShape fill={fill} size={size} monochrome={monochrome} />
            <div className="absolute inset-y-0 left-0 w-1/2" onMouseEnter={() => setHover(star - 0.5)} onClick={() => submit(star - 0.5)} />
            <div className="absolute inset-y-0 right-0 w-1/2" onMouseEnter={() => setHover(star)} onClick={() => submit(star)} />
          </div>
        )
      })}
    </div>
  )
}

// Read-only display for averages
export function StarDisplay({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(star => (
        <StarShape
          key={star}
          fill={rating >= star ? 'full' : rating >= star - 0.5 ? 'half' : 'empty'}
          size={size}
        />
      ))}
    </div>
  )
}
