import { TrendingUp, Music2, Trophy } from 'lucide-react'

interface Props {
  songsToday: number | null
  totalSongs: number | null
  topArtist: string | null
}

export function GeneralStats({ songsToday, totalSongs, topArtist }: Props) {
  return (
    <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-2xl p-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 rounded-xl p-5 border border-blue-500/20">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <TrendingUp size={20} className="text-blue-400" strokeWidth={2} />
            </div>
            <p className="text-gray-400 text-sm">Songs Today</p>
          </div>
          <p className="text-3xl text-white">{songsToday ?? '—'}</p>
        </div>
        <div className="bg-gradient-to-br from-purple-500/10 to-purple-600/5 rounded-xl p-5 border border-purple-500/20">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-purple-500/10 rounded-lg">
              <Music2 size={20} className="text-purple-400" strokeWidth={2} />
            </div>
            <p className="text-gray-400 text-sm">Total Songs</p>
          </div>
          <p className="text-3xl text-white">{totalSongs?.toLocaleString() ?? '—'}</p>
        </div>
        <div className="bg-gradient-to-br from-amber-500/10 to-amber-600/5 rounded-xl p-5 border border-amber-500/20">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-amber-500/10 rounded-lg">
              <Trophy size={20} className="text-amber-400" strokeWidth={2} />
            </div>
            <p className="text-gray-400 text-sm">Top Artist</p>
          </div>
          <p className="text-lg text-white truncate">{topArtist ?? '—'}</p>
        </div>
      </div>
    </div>
  )
}
