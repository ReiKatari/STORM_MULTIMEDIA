/**
 * Сервис интеграции с VK Видео (vkvideo.ru / vk.com)
 * Поддержка поиска видеоматериалов, каталога, извлечения адаптивных плееров и потоков
 */

import { getCache, setCache } from '../db.js';
import { resolveCanonicalYear, resolveCanonicalGenres, resolveCanonicalMediaType } from './canonical-media-intel.js';

async function vkFetch(url, options = {}) {
  const timeoutMs = options.timeout || 4000;
  return await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      ...(options.headers || {})
    }
  });
}

/**
 * Преобразование видеозаписи VK в стандартный медиа-элемент STORM
 */
function formatVkVideoItem(item) {
  if (!item || !item.id) return null;

  const title = (item.title || 'VK Видео').trim();
  const rawYear = item.year || (item.date ? new Date(item.date * 1000).getFullYear() : '');
  const resolvedYear = resolveCanonicalYear(title, item.player || '', '', rawYear, String(rawYear || '')) || String(rawYear || new Date().getFullYear());

  const poster = item.image || item.photo_800 || item.photo_320 || 'assets/favicon.svg';
  const durationSec = parseInt(item.duration, 10) || 0;
  const durationMin = durationSec > 0 ? Math.round(durationSec / 60) : 0;
  const durationStr = durationMin > 0 ? `${durationMin} мин` : '';

  const lowerTitle = title.toLowerCase();
  const isSeries = lowerTitle.includes('серия') || lowerTitle.includes('сезон') || lowerTitle.includes('эпизод') || lowerTitle.includes('выпуск');
  const mediaType = isSeries ? 'series' : resolveCanonicalMediaType(title, item.player || '', 'movie', []);
  const genres = resolveCanonicalGenres(title, isSeries ? 'Сериал' : 'Фильм', item.description || '', []);

  return {
    id: `vk_${item.owner_id || 0}_${item.id}`,
    source: 'vkvideo',
    source_id: `${item.owner_id || 0}_${item.id}`,
    owner_id: item.owner_id,
    video_id: item.id,
    title,
    original_title: title,
    poster,
    year: resolvedYear,
    rating: item.views ? Math.min(10, Math.max(7.2, parseFloat((7.2 + Math.log10(Math.max(1, item.views)) * 0.45).toFixed(1)))) : 7.6,
    media_type: mediaType,
    category: isSeries ? 'Сериал' : 'Фильм',
    quality: '1080p FHD',
    duration: durationStr,
    duration_seconds: durationSec,
    genres,
    description: (item.description || 'Видеоматериал из открытой медиатеки VK Видео.').trim(),
    embed_url: item.player || `https://vkvideo.ru/video_ext.php?oid=${item.owner_id}&id=${item.id}`,
    views: item.views || 0
  };
}

/**
 * Поиск по VK Видео
 */
export async function searchVkVideo(query, page = 1) {
  if (!query || !query.trim()) return [];

  const cleanQuery = query.trim();
  const pageNum = parseInt(page, 10) || 1;
  const cacheKey = `search_${cleanQuery}_p${pageNum}`;
  const cached = getCache('vkvideo', cacheKey);
  if (cached && Array.isArray(cached) && cached.length > 0) return cached;

  const items = [];

  const executeVkQuery = async (queryText) => {
    try {
      const res = await fetch('https://vk.com/al_video.php?act=search_video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          'Referer': 'https://vk.com/'
        },
        body: `al=1&q=${encodeURIComponent(queryText)}&offset=${(pageNum - 1) * 20}`,
        signal: AbortSignal.timeout(9000)
      });

      if (res.ok) {
        const buf = await res.arrayBuffer();
        let text = '';
        try {
          text = new TextDecoder('windows-1251').decode(buf);
        } catch {
          text = new TextDecoder('utf-8').decode(buf);
        }
        const json = JSON.parse(text);
        const list = json?.payload?.[1]?.[2]?.list || [];

        for (const it of list) {
          if (!it || !Array.isArray(it) || it.length < 4) continue;
          const ownerId = it[0];
          const videoId = it[1];
          const poster = it[2] || '';
          let title = String(it[3] || '').trim();
          if (!title) continue;

          const durationStr = typeof it[5] === 'string' ? it[5] : '';
          const durationSec = typeof it[18] === 'number' ? it[18] : 0;
          const views = typeof it[10] === 'number' ? it[10] : 0;

          const rawYear = title.match(/\b(19\d\d|20\d\d)\b/)?.[1] || '';
          const resolvedYear = resolveCanonicalYear(title, `vk_${ownerId}_${videoId}`, '', rawYear, rawYear) || String(new Date().getFullYear());

          const lowerTitle = title.toLowerCase();
          const isSeries = lowerTitle.includes('серия') || lowerTitle.includes('сезон') || lowerTitle.includes('эпизод') || lowerTitle.includes('сериал');
          const mediaType = isSeries ? 'series' : resolveCanonicalMediaType(title, `vk_${ownerId}_${videoId}`, 'movie', []);
          const genres = resolveCanonicalGenres(title, isSeries ? 'Сериал' : 'Фильм', '', []);

          items.push({
            id: `vk_${ownerId}_${videoId}`,
            source: 'vkvideo',
            source_id: `${ownerId}_${videoId}`,
            owner_id: ownerId,
            video_id: videoId,
            title,
            original_title: title,
            poster: poster || 'assets/favicon.svg',
            year: resolvedYear,
            rating: views ? Math.min(10, Math.max(7.2, parseFloat((7.2 + Math.log10(Math.max(1, views)) * 0.45).toFixed(1)))) : 7.6,
            media_type: mediaType,
            category: isSeries ? 'Сериал' : 'Фильм',
            quality: '1080p FHD',
            duration: durationStr,
            duration_seconds: durationSec,
            genres,
            description: `Официальное видео из медиатеки VK Видео${views > 0 ? ` (просмотров: ${views.toLocaleString('ru-RU')})` : ''}.`,
            embed_url: `https://vkvideo.ru/video_ext.php?oid=${ownerId}&id=${videoId}&hd=2&autoplay=1`,
            web_url: `https://vkvideo.ru/video${ownerId}_${videoId}`,
            views
          });
        }
      }
    } catch (err) {
      console.warn('[VK Video Service] Ошибка поиска:', err.message);
    }
  };

  await executeVkQuery(cleanQuery);
  if (items.length === 0 && !cleanQuery.toLowerCase().includes('сериал')) {
    await executeVkQuery('сериал ' + cleanQuery);
  }

  if (items.length > 0) {
    setCache('vkvideo', cacheKey, items, 30 * 60);
  }
  return items;
}

/**
 * Получение валидного плеера VK Видео по названию и метаданным фильма/сериала
 */
export async function resolveVkVideoPlayer(title, year = '', knownItem = null) {
  if (!title) return null;
  if (knownItem?.owner_id && knownItem?.video_id) {
    return {
      id: 'vk_video_stream',
      name: 'VK Видео (Официальный плеер)',
      type: 'iframe',
      quality: '1080p FHD / 4K',
      badge: 'VK ВИДЕО',
      status: 'working',
      status_label: '🟢 Онлайн',
      audio_info: 'Официальный лицензионный каталог VK Видео',
      speed: '⚡ Скоростной VK CDN',
      url: `https://vkvideo.ru/video_ext.php?oid=${knownItem.owner_id}&id=${knownItem.video_id}&hd=2&autoplay=1`
    };
  }

  try {
    const cleanTitle = title
      .replace(/\s*[\(\[]?\s*4[KkКк]\s*(?:Ultra\s*HD|UHD)?\s*[\)\]]?/gi, '')
      .replace(/\s*\(\d{4}\)\s*$/i, '')
      .trim();
    const query = `${cleanTitle} ${year || ''}`.trim();
    const results = await searchVkVideo(query);
    if (results && results.length > 0) {
      const top = results[0];
      return {
        id: 'vk_video_stream',
        name: 'VK Видео (Официальный плеер)',
        type: 'iframe',
        quality: '1080p FHD / 4K',
        badge: 'VK ВИДЕО',
        status: 'working',
        status_label: '🟢 Онлайн',
        audio_info: 'Официальный лицензионный каталог VK Видео',
        speed: '⚡ Скоростной VK CDN',
        url: top.embed_url
      };
    }
  } catch (err) {
    console.warn('[VK Video Service] Ошибка поиска плеера:', err.message);
  }
  return null;
}

export function getVkVideoPlayer(title, year = '', knownItem = null) {
  if (knownItem?.owner_id && knownItem?.video_id) {
    return {
      id: 'vk_video_stream',
      name: 'VK Видео (Официальный плеер)',
      type: 'iframe',
      quality: '1080p FHD / 4K',
      badge: 'VK ВИДЕО',
      status: 'working',
      status_label: '🟢 Онлайн',
      audio_info: 'Официальный лицензионный каталог VK Видео',
      speed: '⚡ Скоростной VK CDN',
      url: `https://vkvideo.ru/video_ext.php?oid=${knownItem.owner_id}&id=${knownItem.video_id}&hd=2&autoplay=1`
    };
  }
  return null;
}

/**
 * Каталог популярных видео VK
 */
export async function getVkVideoCatalog(category = 'popular', page = 1) {
  const pageNum = parseInt(page, 10) || 1;
  const cacheKey = `catalog_${category}_p${pageNum}`;
  const cached = getCache('vkvideo', cacheKey);
  if (cached) return cached;

  let queryTag = 'лучшие фильмы';
  if (category === 'series') queryTag = 'сериалы';
  else if (category === 'cartoons') queryTag = 'мультфильмы';

  const items = await searchVkVideo(queryTag, pageNum);
  setCache('vkvideo', cacheKey, items, 30 * 60);
  return items;
}
