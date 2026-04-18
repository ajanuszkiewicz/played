import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { Activity } from 'lucide-react'

interface HourlySlot {
  hour: string
  count: number
}

interface Props {
  data: HourlySlot[]
}

export function ActivityChart({ data }: Props) {
  // Fill all 24 hours, map API's `count` field to `plays` for recharts
  const filled = Array.from({ length: 24 }, (_, i) => {
    const h = String(i).padStart(2, '0')
    const found = data.find(d => d.hour === h)
    return { hour: h, plays: found?.count ?? 0 }
  })
  const total = filled.reduce((s, d) => s + d.plays, 0)

  return (
    <div className="bg-gradient-to-br from-gray-800/80 to-gray-900/80 backdrop-blur-sm border border-gray-700/50 rounded-2xl p-6">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-2">
          <Activity size={18} className="text-emerald-400" strokeWidth={2} />
          <p className="text-white">Activity — Last 24 Hours</p>
        </div>
        <p className="text-gray-500 text-xs px-3 py-1 bg-gray-800/50 rounded-full border border-gray-700/50">
          {total} plays
        </p>
      </div>
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={filled}>
          <XAxis dataKey="hour" stroke="#6b7280" fontSize={11} tickLine={false} axisLine={false} />
          <YAxis hide />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.05)' }}
            contentStyle={{
              background: 'rgba(31,41,55,0.95)',
              border: '1px solid rgba(75,85,99,0.5)',
              borderRadius: '12px',
              color: '#fff',
              backdropFilter: 'blur(8px)',
              padding: '8px 12px',
            }}
            labelStyle={{ color: '#9ca3af', fontSize: '12px' }}
          />
          <Bar dataKey="plays" fill="url(#activityGradient)" radius={[6, 6, 0, 0]} maxBarSize={40} />
          <defs>
            <linearGradient id="activityGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.8} />
              <stop offset="100%" stopColor="#059669" stopOpacity={0.6} />
            </linearGradient>
          </defs>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
