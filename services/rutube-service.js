/**
 * Сервис интеграции с официальным API RuTube (rutube.ru)
 * Поддержка поиска видео, каталога, извлечения HLS (.m3u8) и официальных встраиваемых плееров
 */

import { getCache, setCache } from '../db.js';
import { resolveCanonicalYear, resolveCanonicalGenres, resolveCanonicalMediaType } from './canonical-media-intel.js';

const RUTUBE_API = 'https://rutube.ru/api';

async function rutubeFetch(url, options = {}) {
  const timeoutMs = options.timeout || 5000;
  return await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      ...(options.headers || {})
    }
  });
}

/**
 * Преобразование объекта RuTube в стандартный медиа-элемент STORM
 */
function formatRuTubeItem(item) {
  if (!item || !item.id) return null;

  const title = (item.title || 'Видео RuTube').trim();
  const rawYear = item.publication_ts ? new Date(item.publication_ts).getFullYear() : (item.created_ts ? new Date(item.created_ts).getFullYear() : '');
  const resolvedYear = resolveCanonicalYear(title, item.video_url || '', '', rawYear, String(rawYear || '')) || String(rawYear || new Date().getFullYear());

  const poster = item.thumbnail_url || 'assets/favicon.svg';
  const durationSec = parseInt(item.duration, 10) || 0;
  const durationMin = durationSec > 0 ? Math.round(durationSec / 60) : 0;
  const durationStr = durationMin > 0 ? `${durationMin} мин` : '';

  // Определение типа контента
  const lowerTitle = title.toLowerCase();
  const isSeries = lowerTitle.includes('серия') || lowerTitle.includes('сезон') || lowerTitle.includes('эпизод') || lowerTitle.includes('выпуск');
  const mediaType = isSeries ? 'series' : resolveCanonicalMediaType(title, item.video_url || '', 'movie', []);

  const genres = resolveCanonicalGenres(title, item.category?.name || 'Видео', item.description || '', [item.category?.name].filter(Boolean));

  return {
    id: `rutube_${item.id}`,
    source: 'rutube',
    source_id: item.id,
    title,
    original_title: title,
    poster,
    year: resolvedYear,
    rating: item.hits ? Math.min(10, Math.max(7.0, parseFloat((7.0 + Math.log10(Math.max(1, item.hits)) * 0.5).toFixed(1)))) : 7.5,
    media_type: mediaType,
    category: isSeries ? 'Сериал' : 'Фильм',
    quality: '1080p FHD',
    duration: durationStr,
    duration_seconds: durationSec,
    genres,
    description: (item.description || 'Официальный видеоматериал на платформе RuTube.').trim(),
    embed_url: item.embed_url || `https://rutube.ru/play/embed/${item.id}`,
    video_url: item.video_url || `https://rutube.ru/video/${item.id}/`,
    author: item.author?.name || 'RuTube',
    hits: item.hits || 0
  };
}

/**
 * Поиск по RuTube
 */
export async function searchRuTube(query, page = 1) {
  if (!query || !query.trim()) return [];

  const cleanQuery = query.trim();
  const pageNum = parseInt(page, 10) || 1;
  const cacheKey = `search_${cleanQuery}_p${pageNum}`;
  const cached = getCache('rutube', cacheKey);
  if (cached) return cached;

  try {
    const url = `${RUTUBE_API}/search/video/?query=${encodeURIComponent(cleanQuery)}&page=${pageNum}&format=json`;
    const res = await rutubeFetch(url);
    if (!res.ok) return [];

    const data = await res.json();
    const results = data.results || [];
    const formatted = results
      .filter(it => it && !it.is_deleted && !it.is_hidden && !it.is_locked)
      .map(formatRuTubeItem)
      .filter(Boolean);

    setCache('rutube', cacheKey, formatted, 60 * 60); // 1 час
    return formatted;
  } catch (err) {
    console.warn('[RuTube Service] Ошибка поиска:', err.message);
    return [];
  }
}

/**
 * Получение прямого HLS потока и плеера для конкретного видео RuTube
 */
export async function getRuTubePlayOptions(videoId) {
  if (!videoId) return null;
  const cleanId = String(videoId).replace('rutube_', '');

  try {
    const url = `${RUTUBE_API}/play/options/${cleanId}/?format=json`;
    const res = await rutubeFetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    const m3u8Url = data.video_balancer?.default || data.video_balancer?.m3u8 || null;

    return {
      id: cleanId,
      m3u8: m3u8Url,
      embed_url: `https://rutube.ru/play/embed/${cleanId}`,
      title: data.title || '',
      thumbnail: data.thumbnail_url || ''
    };
  } catch (err) {
    console.warn('[RuTube Service] Ошибка получения потоков:', err.message);
    return null;
  }
}

/**
 * Получение каталога популярных видео RuTube
 */
export async function getRuTubeCatalog(category = 'popular', page = 1) {
  const pageNum = parseInt(page, 10) || 1;
  const cacheKey = `catalog_${category}_p${pageNum}`;
  const cached = getCache('rutube', cacheKey);
  if (cached) return cached;

  try {
    // В зависимости от категории используем поиск по популярным тегам
    let queryTag = 'фильм';
    if (category === 'series' || category === 'russian-series') queryTag = 'сериал';
    else if (category === 'cartoons' || category === 'kids') queryTag = 'мультфильм';
    else if (category === 'show') queryTag = 'шоу';

    const items = await searchRuTube(queryTag, pageNum);
    setCache('rutube', cacheKey, items, 30 * 60);
    return items;
  } catch (err) {
    console.warn('[RuTube Service] Ошибка каталога:', err.message);
    return [];
  }
}
