/**
 * Сервис интеграции с официальным API AniLibria (v1)
 * https://anilibria.top/api/docs/v1
 * Прямые стримы в качестве 1080p Full HD, озвучка AniLibria, серии и постеры
 */

import { getCache, setCache } from '../db.js';

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
  let year = String(rel.year || rel.season?.year || '').trim();
  if (!year || year === '0') {
    const ym = `${title} ${originalTitle} ${rel.description || ''}`.match(/\b(19\d\d|20\d\d)\b/);
    if (ym) year = ym[1];
  }

  let poster = 'assets/favicon.svg';
  const posterPath = rel.poster?.src || rel.poster?.preview || rel.poster?.thumbnail;
  if (posterPath) {
    poster = posterPath.startsWith('http') ? posterPath : `${DOMAIN}${posterPath}`;
  }

  const isMovie = rel.type?.value === 'MOVIE';
  const genres = (rel.genres || []).map(g => g.name).join(', ');

  return {
    id: String(rel.id),
    source: 'anilibria',
    title: title.trim(),
    original_title: originalTitle.trim(),
    poster,
    year: year || '2024',
    rating: rel.shikimori?.rating || 0,
    media_type: isMovie ? 'anime-movie' : 'anime-series',
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

/**
 * Получение детальной информации о релизе и списка серий с HLS потоками
 */
export async function getAniLibriaDetails(releaseId) {
  const cacheKey = `details_${releaseId}`;
  const cached = getCache('anilibria', cacheKey);
  if (cached) return cached;

  try {
    const url = `${ANILIBRIA_BASE}/anime/releases/${releaseId}`;
    const res = await anilibriaFetch(url);
    if (!res.ok) throw new Error(`AniLibria details error: ${res.status}`);

    const rel = await res.json();
    const baseInfo = formatAniLibriaRelease(rel);

    const episodes = (rel.episodes || []).map(ep => ({
      id: ep.id,
      ordinal: ep.ordinal,
      name: ep.name || `Серия ${ep.ordinal}`,
      duration: ep.duration,
      hls_1080: ep.hls_1080 || null,
      hls_720: ep.hls_720 || null,
      hls_480: ep.hls_480 || null
    }));

    const result = {
      ...baseInfo,
      episodes
    };

    setCache('anilibria', cacheKey, result, 3600);
    return result;
  } catch (err) {
    console.warn(`Ошибка получения деталей AniLibria (${releaseId}):`, err.message);
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
