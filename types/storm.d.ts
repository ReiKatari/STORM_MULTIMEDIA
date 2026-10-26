// =========================================================================
// STORM MULTIMEDIA 1.2.0 — ГЛОБАЛЬНЫЕ КОНТРАКТЫ ДАННЫХ И ТИПЫ (Пункт 6.2)
// =========================================================================

export interface MediaItem {
  id: string;
  media_id?: string;
  source: 'lift' | 'fanfilm4k' | 'tmdb' | 'anixart' | 'shikimori' | 'kodik' | string;
  media_type: 'movie' | 'series' | 'anime' | 'cartoon';
  title: string;
  original_title?: string;
  year?: number | string;
  poster?: string;
  poster_url?: string;
  rating?: number;
  quality?: '4K Ultra HD' | '1080p FHD' | 'Ожидается' | string;
  is4K?: boolean;
  is_upcoming?: boolean;
  stream_verified?: boolean;
  lift_id?: string | number | null;
  fanfilm_4k_url?: string | null;
}

export interface UserSession {
  token_prefix: string;
  created_at: string;
  expires_at: string;
  ip_address: string;
  user_agent: string;
  device_name: string;
  last_active_at: string;
  isCurrent?: boolean;
}

export interface WatchProgressPayload {
  media_id: string;
  source?: string;
  media_type?: 'movie' | 'series' | 'anime';
  title: string;
  poster_url?: string;
  season_number?: number;
  episode_number?: number;
  progress_seconds: number;
  duration_seconds: number;
  voiceover?: string;
  device_name?: string;
}

export interface TotpConfig {
  enabled: boolean;
  secret: string;
  backupCodes: string[];
}
