/**
 * Сервис интеграции с официальным API AniLibria (v1)
 * https://anilibria.top/api/docs/v1
 * Прямые стримы в качестве 1080p Full HD, озвучка AniLibria, серии и постеры
 */

import { getCache, setCache } from '../db.js';
import { resolveCanonicalYear, resolveCanonicalGenres, resolveCanonicalMediaType } from './canonical-media-intel.js';

const ANILIBRIA_BASE = 'https://anilibria.top/api/v1';
const DOMAIN = 'https://anilibria.top';

async function anilibriaFetch(url, options = {}) {
  const timeoutMs = options.timeout || 2500;
  return await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'User-Agent': 'STORM-Multimedia/1.0',
      ...(options.headers || {})
    }
  });
}

function formatAniLibriaRelease(rel) {
  if (!rel) return null;

  const title = rel.name?.main || rel.name?.english || rel.name?.alternative || 'Аниме релиз';
  const originalTitle = rel.name?.english || rel.name?.alternative || '';
  let rawYear = String(rel.year || rel.season?.year || '').trim();
  if (rawYear === '0') rawYear = '';
  const resolvedYear = resolveCanonicalYear(title, '', '', rel.season?.year, rawYear) || '2026';

  let poster = 'assets/favicon.svg';
  const posterPath = rel.poster?.src || rel.poster?.preview || rel.poster?.thumbnail;
  if (posterPath) {
    poster = posterPath.startsWith('http') ? posterPath : `${DOMAIN}${posterPath}`;
  }

  const rawGenres = (rel.genres || []).map(g => g.name);
  const genres = resolveCanonicalGenres(title, 'anime', rel.description || '', rawGenres);
  const mediaType = rel.type?.value === 'MOVIE' ? 'anime-movie' : resolveCanonicalMediaType(title, '', 'anime-series', genres);

  return {
    id: String(rel.id),
    source: 'anilibria',
    title: title.trim(),
    original_title: originalTitle.trim(),
    poster,
    year: resolvedYear,
    rating: rel.shikimori?.rating || 0,
    media_type: mediaType,
    category: mediaType === 'anime-movie' ? 'Аниме-фильм' : 'Аниме-сериал',
    quality: '1080p FHD',
    episodes_released: rel.latest_episode?.ordinal || rel.episodes_total || 0,
    episodes_total: rel.episodes_total || 0,
    genres,
    description: rel.description || 'Официальный релиз творческого объединения AniLibria с профессиональной озвучкой.',
    alias: rel.alias || '',
    is_ongoing: !!rel.is_ongoing
  };
}

/**
 * Получение каталога AniLibria
 */
export async function getAniLibriaCatalog(category = 'popular', page = 1) {
  const pageNum = parseInt(page, 10) || 1;
  const cacheKey = `catalog_${category}_page_${pageNum}`;
  const cached = getCache('anilibria', cacheKey);
  if (cached) return cached;

  try {
    let url = `${ANILIBRIA_BASE}/anime/catalog/releases?page=${pageNum}&limit=30`;

    if (category === 'new') {
      url = `${ANILIBRIA_BASE}/anime/catalog/releases?page=${pageNum}&limit=30`;
    } else if (category === 'anime-movies') {
      url = `${ANILIBRIA_BASE}/anime/catalog/releases?types=MOVIE&page=${pageNum}&limit=30`;
    } else if (category === 'anime-series') {
      url = `${ANILIBRIA_BASE}/anime/catalog/releases?types=TV&page=${pageNum}&limit=30`;
    }

    const res = await anilibriaFetch(url);

    if (!res.ok) {
      throw new Error(`AniLibria API returned status: ${res.status}`);
    }

    const data = await res.json();
    const rawList = Array.isArray(data) ? data : (data.data || []);
    const items = rawList.map(formatAniLibriaRelease).filter(Boolean);

    const result = {
      items,
      total_items: data.meta?.total || items.length,
      current_page: pageNum,
      total_pages: data.meta?.last_page || 1
    };

    setCache('anilibria', cacheKey, result, 1800); // 30 минут кэша
    return result;
  } catch (err) {
    console.warn('Ошибка получения каталога AniLibria:', err.message);
    return { items: [], total_items: 0, current_page: pageNum, total_pages: 1 };
  }
}

export function sanitizeAniLibriaHlsUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  return rawUrl
    .replace(/^https?:\/\/cache-[a-z0-9-]+\.libria\.fun\//i, 'https://cache.libria.fun/')
    .split('?')[0];
}

/**
 * Получение детальной информации о релизе и списка серий с HLS потоками
 */
export async function getAniLibriaDetails(releaseId, fallbackTitle = '') {
  let cleanId = String(releaseId || '').replace(/^(?:anilibria_|anilib_|libria_)/i, '').trim();
  if (!/^\d+$/.test(cleanId) && (fallbackTitle || cleanId)) {
    try {
      const searchQ = fallbackTitle || cleanId.replace(/_/g, ' ');
      const searchRes = await searchAniLibria(searchQ);
      if (searchRes?.items?.length > 0) {
        cleanId = String(searchRes.items[0].id);
      }
    } catch (_) {}
  }
  if (!cleanId) return null;

  const cacheKey = `details_v2_${cleanId}`;
  const cached = getCache('anilibria', cacheKey);
  if (cached) return cached;

  try {
    const url = `${ANILIBRIA_BASE}/anime/releases/${cleanId}`;
    const res = await anilibriaFetch(url, { timeout: 4500 });
    if (!res.ok) throw new Error(`AniLibria details error: ${res.status}`);

    const rel = await res.json();
    const baseInfo = formatAniLibriaRelease(rel);

    const episodes = (rel.episodes || []).map(ep => {
      const rawPreview = ep.preview?.optimized?.src || ep.preview?.src || ep.preview?.preview || '';
      const previewUrl = rawPreview ? (rawPreview.startsWith('http') ? rawPreview : `${DOMAIN}${rawPreview}`) : '';
      return {
        id: ep.id,
        ordinal: ep.ordinal,
        episode_number: ep.ordinal,
        name: ep.name || `Серия ${ep.ordinal}`,
        duration: ep.duration ? `${Math.max(1, Math.round(ep.duration / 60))} мин.` : '24 мин.',
        still: previewUrl || baseInfo.poster,
        preview: previewUrl || baseInfo.poster,
        hls_1080: sanitizeAniLibriaHlsUrl(ep.hls_1080),
        hls_720: sanitizeAniLibriaHlsUrl(ep.hls_720),
        hls_480: sanitizeAniLibriaHlsUrl(ep.hls_480)
      };
    });

    const seasons = episodes.length > 0 ? [{
      season_number: 1,
      name: 'Сезон 1',
      episode_count: episodes.length,
      overview: baseInfo.description || `Официальный релиз AniLibria • ${episodes.length} серий в Full HD качестве.`,
      episodes
    }] : [];

    const result = {
      ...baseInfo,
      episodes,
      seasons
    };

    setCache('anilibria', cacheKey, result, 3600);
    return result;
  } catch (err) {
    console.warn(`Ошибка получения деталей AniLibria (${cleanId}):`, err.message);
    return null;
  }
}

/**
 * Поиск аниме в AniLibria
 */
export async function searchAniLibria(query) {
  if (!query || !query.trim()) return { items: [] };

  const cacheKey = `search_${query.trim().toLowerCase()}`;
  const cached = getCache('anilibria', cacheKey);
  if (cached) return cached;

  try {
    const url = `${ANILIBRIA_BASE}/anime/catalog/releases?f[search]=${encodeURIComponent(query)}&limit=25`;
    const res = await anilibriaFetch(url);
    if (!res.ok) throw new Error(`AniLibria search error: ${res.status}`);

    const data = await res.json();
    const rawList = Array.isArray(data) ? data : (data.data || []);
    const items = rawList.map(formatAniLibriaRelease).filter(Boolean);

    const result = { items, total_items: items.length };
    setCache('anilibria', cacheKey, result, 1800);
    return result;
  } catch (err) {
    console.warn('Ошибка поиска AniLibria:', err.message);
    return { items: [] };
  }
}
