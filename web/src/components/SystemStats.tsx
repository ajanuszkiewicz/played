import { Cpu, MemoryStick, Thermometer, HardDrive } from 'lucide-react'
import type { SysStats } from '../types'

interface Props {
  stats: SysStats | null
}

interface CardProps {
  label: string
  value: string | null
  sub: string | null
  percent: number | null
  icon: React.ReactNode
  color: string
}

function StatCard({ label, value, sub, percent, icon, color }: CardProps) {
  const pct = percent ?? 0
  const barColor = pct > 85 ? 'bg-red-500' : pct > 65 ? 'bg-amber-500' : color
  return (
    <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-2xl p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="p-2 bg-gray-700/50 rounded-lg">{icon}</div>
        <p className="text-gray-400 text-sm">{label}</p>
      </div>
      <p className="text-2xl text-white mb-1">{value ?? '—'}</p>
      {sub && <p className="text-xs text-gray-500 mb-3">{sub}</p>}
      {percent != null && (
        <div className="h-1 bg-gray-700/50 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-700 ${barColor}`} style={{ width: `${Math.min(percent, 100)}%` }} />
        </div>
      )}
    </div>
  )
}

export function SystemStats({ stats: s }: Props) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <StatCard
        label="CPU"
        value={s?.cpu_percent != null ? `${s.cpu_percent}%` : null}
        sub={s?.load_avg != null ? `load ${s.load_avg}` : null}
        percent={s?.cpu_percent ?? null}
        icon={<Cpu size={18} className="text-blue-400" />}
        color="bg-blue-500"
      />
      <StatCard
        label="Memory"
        value={s?.ram_percent != null ? `${s.ram_percent}%` : null}
        sub={s?.ram_used_mb != null ? `${s.ram_used_mb} / ${s.ram_total_mb} MB` : null}
        percent={s?.ram_percent ?? null}
        icon={<MemoryStick size={18} className="text-purple-400" />}
        color="bg-purple-500"
      />
      <StatCard
        label="Temperature"
        value={s?.temp_c != null ? `${s.temp_c}°C` : null}
        sub="CPU core"
        percent={s?.temp_c != null ? Math.min(s.temp_c / 85 * 100, 100) : null}
        icon={<Thermometer size={18} className="text-rose-400" />}
        color="bg-rose-500"
      />
      <StatCard
        label="Storage"
        value={s?.disk_percent != null ? `${s.disk_percent}%` : null}
        sub={s?.disk_used_gb != null ? `${s.disk_used_gb} / ${s.disk_total_gb} GB` : null}
        percent={s?.disk_percent ?? null}
        icon={<HardDrive size={18} className="text-emerald-400" />}
        color="bg-emerald-500"
      />
    </div>
  )
}
