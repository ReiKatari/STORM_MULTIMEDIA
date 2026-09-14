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

  let url = `${SHIKIMORI_BASE}/api/animes?limit=50&page=${page}&order=${order}`;
  if (kind) url += `&kind=${kind}`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': USER_AGENT }
    });
    if (!res.ok) throw new Error(`Shikimori error ${res.status}`);

    const data = await res.json();
    const items = data.map(item => {
      let year = item.aired_on ? item.aired_on.substring(0, 4) : (item.released_on ? item.released_on.substring(0, 4) : '');
      if (!year) {
        const ym = `${item.russian || ''} ${item.name || ''}`.match(/\b(19\d\d|20\d\d)\b/);
        if (ym) year = ym[1];
      }
      return {
        id: String(item.id),
        source: 'shikimori',
        title: item.russian || item.name,
        original_title: item.name,
        poster: item.image?.original ? `${SHIKIMORI_BASE}${item.image.original}` : 'assets/favicon.svg',
        year: year || '2024',
        rating: parseFloat(item.score) || 0,
        media_type: item.kind === 'movie' ? 'anime-movie' : 'anime-series',
        quality: 'HD 1080p',
        status: item.status === 'released' ? 'Вышел' : 'Онгоинг',
        episodes_total: item.episodes || 0,
        episodes_released: item.episodes_aired || item.episodes || 0
      };
    });

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
    const res = await fetch(`${SHIKIMORI_BASE}/api/animes?limit=25&search=${encodeURIComponent(query.trim())}`, {
      signal: AbortSignal.timeout(8000),
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

/**
 * Получение связанных произведений (порядок просмотра/хронология аниме)
 */
export async function getShikimoriRelated(animeId) {
  if (!animeId) return [];
  const cacheKey = `shikimori_related_${animeId}`;
  const cached = getCache('shikimori', cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch(`${SHIKIMORI_BASE}/api/animes/${animeId}/related`, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': USER_AGENT }
    });
    if (!res.ok) return [];

    const data = await res.json();
    const items = data
      .filter(it => it.anime)
      .map(it => ({
        id: String(it.anime.id),
        source: 'shikimori',
        title: it.anime.russian || it.anime.name,
        original_title: it.anime.name || '',
        relation: it.relation_russian || it.relation || 'Связанное',
        year: it.anime.aired_on ? it.anime.aired_on.substring(0, 4) : '',
        poster: it.anime.image?.original ? `${SHIKIMORI_BASE}${it.anime.image.original}` : 'assets/favicon.svg',
        media_type: it.anime.kind === 'movie' ? 'anime-movie' : 'anime-series',
        rating: parseFloat(it.anime.score) || 0,
        status: it.anime.status === 'released' ? 'Вышел' : 'Онгоинг'
      }));

    setCache('shikimori', cacheKey, items, 86400); // 24 часа
    return items;
  } catch (err) {
    console.error('[Shikimori Related] Ошибка:', err.message);
    return [];
  }
}

/**
 * Получение расписания онгоингов на текущую неделю из календаря Shikimori
 */
export async function getShikimoriCalendar() {
  const cacheKey = 'shikimori_live_calendar';
  const cached = getCache('shikimori', cacheKey);
  if (cached && Array.isArray(cached) && cached.length > 0) return cached;

  try {
    const res = await fetch(`${SHIKIMORI_BASE}/api/calendar`, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': USER_AGENT }
    });
    if (!res.ok) return [];

    const data = await res.json();
    const items = (data || []).filter(d => d.anime).map(d => {
      const airDate = d.next_episode_at ? new Date(d.next_episode_at) : null;
      const dayOfWeek = airDate ? airDate.getDay() : 1; // 0=ВС, 1=ПН...
      const hours = airDate ? String(airDate.getHours()).padStart(2, '0') : '18';
      const mins = airDate ? String(airDate.getMinutes()).padStart(2, '0') : '30';

      return {
        id: `shiki_${d.anime.id}`,
        shikimori_id: d.anime.id,
        title: d.anime.russian || d.anime.name,
        original_title: d.anime.name,
        poster: d.anime.image?.original ? `${SHIKIMORI_BASE}${d.anime.image.original}` : 'assets/favicon.svg',
        year: d.anime.aired_on ? d.anime.aired_on.substring(0, 4) : '2026',
        season: 1,
        episode: d.next_episode || 1,
        episode_title: `Серия ${d.next_episode || 1}`,
        day_of_week: dayOfWeek,
        air_time: `${hours}:${mins} МСК`,
        studio: 'AniLibria / Shikimori',
        quality: '1080p FHD',
        is4K: false,
        rating: parseFloat(d.anime.score) || 8.0,
        genres: 'Аниме, Онгоинг',
        source: 'shikimori',
        description: `Премьера нового эпизода аниме «${d.anime.russian || d.anime.name}».`
      };
    });

    if (items.length > 0) {
      setCache('shikimori', cacheKey, items, 1800); // 30 минут
    }
    return items;
  } catch (err) {
    console.error('[Shikimori Calendar] Ошибка:', err.message);
    return [];
  }
}
