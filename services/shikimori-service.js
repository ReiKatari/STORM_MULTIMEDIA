import { getCache, setCache } from '../db.js';
import { resolveCanonicalYear, resolveCanonicalGenres, resolveCanonicalMediaType, normalizeAnimeFranchiseTitle, extractSeasonNumberFromTitle } from './canonical-media-intel.js';

const SHIKIMORI_BASE = 'https://shikimori.io';
const SHIKIMORI_MIRRORS = ['https://shikimori.io', 'https://shikimori.one'];
const USER_AGENT = 'STORM-MULTIMEDIA/1.0 (+https://github.com/ReiKatari)';

async function shikiFetch(pathAndQuery, timeoutMs = 4500) {
  for (const base of SHIKIMORI_MIRRORS) {
    try {
      const res = await fetch(`${base}${pathAndQuery}`, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': USER_AGENT }
      });
      if (res.ok) return res;
    } catch (_) {}
  }
  throw new Error(`Shikimori mirror fetch failed for ${pathAndQuery}`);
}

export async function getShikimoriCatalog(category = 'popular', page = 1) {
  const cacheKey = `shikimori_v5_${category}_page_${page}`;
  const cached = getCache('shikimori', cacheKey);
  if (cached && Array.isArray(cached.items) && cached.items.length > 0) return cached;

  let order = 'popularity';
  let kind = '';
  let statusFilter = '';

  if (category === 'new') {
    order = 'aired_on';
    statusFilter = 'ongoing,released';
  }
  if (category === 'anime-movies') kind = 'movie';
  if (category === 'anime-series') kind = 'tv';

  let pathAndQuery = `/api/animes?limit=50&page=${page}&order=${order}`;
  if (kind) pathAndQuery += `&kind=${kind}`;
  if (statusFilter) pathAndQuery += `&status=${statusFilter}`;

  try {
    const res = await shikiFetch(pathAndQuery, 5000);
    if (!res.ok) throw new Error(`Shikimori error ${res.status}`);

    const data = await res.json();
    const validRaw = (Array.isArray(data) ? data : []).filter(item => {
      if (!item) return false;
      const imgOrig = String(item.image?.original || item.image?.preview || '');
      const isMissingImg = !imgOrig || imgOrig.includes('missing_');
      if (isMissingImg) return false;
      return true;
    });

    const rawMapped = validRaw.map(item => {
      const rawTitle = (item.russian || item.name || '').trim();
      const rawOrig = (item.name || '').trim();
      const isMov = item.kind === 'movie';
      const title = isMov ? rawTitle : (normalizeAnimeFranchiseTitle(rawTitle, true) || rawTitle);
      const origTitle = isMov ? rawOrig : (normalizeAnimeFranchiseTitle(rawOrig, true) || rawOrig);
      const detectedSeason = isMov ? 1 : extractSeasonNumberFromTitle(rawTitle, true, rawOrig);
      const rawYear = item.aired_on ? item.aired_on.substring(0, 4) : (item.released_on ? item.released_on.substring(0, 4) : '');
      const resolvedYear = resolveCanonicalYear(title, '', '', '', rawYear) || '2026';
      const genres = resolveCanonicalGenres(title, 'anime', '', null);
      const mediaType = isMov ? 'anime-movie' : resolveCanonicalMediaType(title, '', 'anime-series', genres);
      const imgOrig = String(item.image?.original || item.image?.preview || '');
      const hasValidImg = Boolean(imgOrig && !imgOrig.includes('missing_'));
      const posterUrl = hasValidImg
        ? (imgOrig.startsWith('http') ? imgOrig : `${SHIKIMORI_BASE}${imgOrig}`)
        : `/api/media/image-proxy?title=${encodeURIComponent(title)}&orig=${encodeURIComponent(origTitle)}`;
      const isShikiUpcoming = Boolean(
        item.status === 'anons' ||
        (parseInt(resolvedYear, 10) || 0) > new Date().getFullYear() ||
        (item.aired_on && new Date(item.aired_on) > new Date()) ||
        (item.status !== 'released' && Number(item.episodes_aired || 0) === 0 && (!item.aired_on || (parseInt(resolvedYear, 10) || 0) >= new Date().getFullYear()))
      );
      return {
        id: String(item.id),
        source: 'shikimori',
        title,
        raw_release_title: rawTitle,
        original_title: origTitle,
        detected_season: detectedSeason,
        poster: posterUrl,
        year: resolvedYear,
        rating: parseFloat(item.score) || 0,
        media_type: mediaType,
        category: mediaType === 'anime-movie' ? 'Аниме-фильм' : 'Аниме-сериал',
        genres,
        is_upcoming: isShikiUpcoming,
        quality: isShikiUpcoming ? 'Ожидается' : 'HD 1080p',
        status: isShikiUpcoming ? 'Анонс' : (item.status === 'released' ? 'Вышел' : 'Онгоинг'),
        episodes_total: item.episodes || 0,
        episodes_released: isShikiUpcoming ? 0 : (item.episodes_aired || item.episodes || 0)
      };
    });
    const dedupMap = new Map();
    for (const it of rawMapped) {
      const k = it.media_type === 'anime-movie' ? `mov_${it.id}` : it.title.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').trim();
      if (!dedupMap.has(k)) {
        dedupMap.set(k, it);
      } else {
        const prev = dedupMap.get(k);
        const maxS = Math.max(prev.detected_season || 1, it.detected_season || 1);
        dedupMap.set(k, {
          ...prev,
          rating: Math.max(prev.rating || 0, it.rating || 0),
          detected_season: maxS,
          seasons_count: maxS > 1 ? maxS : (prev.seasons_count || 1)
        });
      }
    }
    const items = Array.from(dedupMap.values());

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
  const cacheKey = `shikimori_search_v5_${query.toLowerCase().trim()}`;
  const cached = getCache('shikimori', cacheKey);
  if (Array.isArray(cached) && cached.length > 0) return cached;

  try {
    const res = await shikiFetch(`/api/animes?limit=25&search=${encodeURIComponent(query.trim())}`, 4500);
    if (!res.ok) return [];

    const data = await res.json();
    const items = data.map(item => ({
      id: String(item.id),
      shikimori_id: String(item.id),
      source: 'shikimori',
      title: item.russian || item.name,
      original_title: item.name,
      poster: (item.image?.original && !String(item.image.original).includes('missing_'))
        ? `${SHIKIMORI_BASE}${item.image.original}`
        : `/api/media/image-proxy?title=${encodeURIComponent(item.russian || item.name || '')}&orig=${encodeURIComponent(item.name || '')}`, 
      year: item.aired_on ? item.aired_on.substring(0, 4) : '',
      rating: parseFloat(item.score) || 0,
      media_type: item.kind === 'movie' ? 'anime-movie' : 'anime-series',
      is_upcoming: Boolean(item.status === 'anons' || (item.aired_on && new Date(item.aired_on) > new Date())),
      status: item.status === 'anons' ? 'Анонс' : (item.status === 'released' ? 'Вышел' : 'Онгоинг'),
      quality: (item.status === 'anons' || (item.aired_on && new Date(item.aired_on) > new Date())) ? 'Ожидается' : 'HD 1080p'
    }));

    if (items.length > 0) {
      setCache('shikimori', cacheKey, items, 900);
    }
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
  if (Array.isArray(cached) && cached.length > 0) return cached;

  try {
    const res = await shikiFetch(`/api/animes/${animeId}/related`, 5000);
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
  const cacheKey = 'shikimori_live_calendar_v5';
  const cached = getCache('shikimori', cacheKey);
  if (cached && Array.isArray(cached) && cached.length > 0) return cached;

  try {
    const res = await shikiFetch('/api/calendar', 3500);
    if (!res.ok) return [];

    const data = await res.json();
    const items = (data || []).filter(d => {
      if (!d || !d.anime) return false;
      const img = d.anime.image?.original || d.anime.image?.preview || '';
      if (!img || img.includes('missing')) return false;
      return true;
    }).map(d => {
      const airDate = d.next_episode_at ? new Date(d.next_episode_at) : null;
      const dayOfWeek = airDate ? airDate.getDay() : 1; // 0=ВС, 1=ПН...
      const hours = airDate ? String(airDate.getHours()).padStart(2, '0') : '18';
      const mins = airDate ? String(airDate.getMinutes()).padStart(2, '0') : '30';
      const posterPath = d.anime.image?.original || d.anime.image?.preview || '';
      const poster = posterPath ? (posterPath.startsWith('http') ? posterPath : `${SHIKIMORI_BASE}${posterPath}`) : '';

      const rawT = d.anime.russian || d.anime.name || '';
      const rawO = d.anime.name || '';
      const cleanT = normalizeAnimeFranchiseTitle(rawT, true) || rawT;
      const cleanO = normalizeAnimeFranchiseTitle(rawO, true) || rawO;
      const detectedS = extractSeasonNumberFromTitle(rawT, true, rawO);
      return {
        id: `shiki_${d.anime.id}`,
        shikimori_id: d.anime.id,
        title: cleanT,
        original_title: cleanO,
        poster,
        year: d.anime.aired_on ? d.anime.aired_on.substring(0, 4) : '2026',
        season: detectedS,
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
