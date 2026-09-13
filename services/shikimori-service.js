import { getCache, setCache } from '../db.js';

const SHIKIMORI_BASE = 'https://shikimori.one';
const USER_AGENT = 'STORM-MULTIMEDIA/1.0 (+https://github.com/ReiKatari)';

export async function getShikimoriCatalog(category = 'popular', page = 1) {
  const cacheKey = `shikimori_${category}_page_${page}`;
  const cached = getCache('shikimori', cacheKey);
  if (cached) return cached;

  let order = 'popularity';
  let kind = '';

  if (category === 'new') order = 'aired_on';
  if (category === 'anime-movies') kind = 'movie';
  if (category === 'anime-series') kind = 'tv';

  let url = `${SHIKIMORI_BASE}/api/animes?limit=30&page=${page}&order=${order}`;
  if (kind) url += `&kind=${kind}`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(2500),
      headers: { 'User-Agent': USER_AGENT }
    });
    if (!res.ok) throw new Error(`Shikimori error ${res.status}`);

    const data = await res.json();
    const items = data.map(item => ({
      id: String(item.id),
      source: 'shikimori',
      title: item.russian || item.name,
      original_title: item.name,
      poster: item.image?.original ? `${SHIKIMORI_BASE}${item.image.original}` : 'assets/favicon.svg',
      year: item.aired_on ? item.aired_on.substring(0, 4) : '',
      rating: parseFloat(item.score) || 0,
      media_type: item.kind === 'movie' ? 'anime-movie' : 'anime-series',
      quality: 'HD 1080p',
      status: item.status === 'released' ? 'Вышел' : 'Онгоинг',
      episodes_total: item.episodes || 0,
      episodes_released: item.episodes_aired || item.episodes || 0
    }));

    const result = { page, category, items, total_items: items.length };
    setCache('shikimori', cacheKey, result, 1800);
    return result;
  } catch (err) {
    console.error('[Shikimori] Ошибка:', err.message);
    return { page, category, items: [], total_items: 0 };
  }
}

export async function searchShikimori(query) {
  if (!query || !query.trim()) return [];
  const cacheKey = `shikimori_search_${query.toLowerCase().trim()}`;
  const cached = getCache('shikimori', cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch(`${SHIKIMORI_BASE}/api/animes?limit=20&search=${encodeURIComponent(query.trim())}`, {
      signal: AbortSignal.timeout(2500),
      headers: { 'User-Agent': USER_AGENT }
    });
    if (!res.ok) return [];

    const data = await res.json();
    const items = data.map(item => ({
      id: String(item.id),
      source: 'shikimori',
      title: item.russian || item.name,
      original_title: item.name,
      poster: item.image?.original ? `${SHIKIMORI_BASE}${item.image.original}` : 'assets/favicon.svg',
      year: item.aired_on ? item.aired_on.substring(0, 4) : '',
      rating: parseFloat(item.score) || 0,
      media_type: item.kind === 'movie' ? 'anime-movie' : 'anime-series',
      quality: 'HD 1080p'
    }));

    setCache('shikimori', cacheKey, items, 900);
    return items;
  } catch (err) {
    return [];
  }
}
