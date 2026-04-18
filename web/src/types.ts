export interface RecentSong {
  played_at: string
  title: string
  artist: string
  album: string | null
  cover_art: string | null
}

export interface StatsData {
  total_songs: number
  today_count: number
  top_artists: { artist: string; plays: number }[]
  top_songs: { title: string; artist: string; plays: number }[]
  recent: RecentSong[]
  hourly_24h: { hour: string; count: number }[]
}

export interface Song {
  id: number
  played_at: string
  title: string
  artist: string
  album: string | null
  release_date: string | null
  cover_art: string | null
}

export interface SysStats {
  cpu_percent: number | null
  load_avg: number | null
  ram_used_mb: number | null
  ram_total_mb: number | null
  ram_percent: number | null
  temp_c: number | null
  disk_used_gb: number | null
  disk_total_gb: number | null
  disk_percent: number | null
}

export interface ArtistSummary {
  artist: string
  plays: number
  last_played: string
}

export interface ArtistDetail {
  top_songs: { title: string; plays: number }[]
  albums: string[]
}
