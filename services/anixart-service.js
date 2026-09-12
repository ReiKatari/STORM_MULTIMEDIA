import { Anixart } from 'anixapi';
import { getCache, setCache } from '../db.js';

const client = new Anixart();

/**
 * Преобразование объекта релиза AniXart в единый формат STORM MULTIMEDIA
 */
function formatAnimeRelease(rel) {
  if (!rel) return null;

  return {
    id: String(rel.id),
    source: 'anixart',
    title: rel.title_ru || rel.title_original || rel.title_alt || 'Без названия',
    original_title: rel.title_original || '',
    poster: rel.image || (rel.poster ? `https://s.anixmirai.com/posters/${rel.poster}.jpg` : ''),
    year: String(rel.year || ''),
    rating: typeof rel.grade === 'number' ? Math.round(rel.grade * 10) / 10 : 0,
    media_type: 'anime',
    quality: 'HD 1080p',
    status: rel.status?.name || 'Вышел',
    category: rel.category?.name || 'Сериал',
    episodes_released: rel.episodes_released || 0,
    episodes_total: rel.episodes_total || 0,
    genres: rel.genres || '',
    studio: rel.studio || '',
    description: rel.description || '',
    country: rel.country || 'Япония',
    director: rel.director || '',
    voiceovers_count: rel.voiceovers_count || 0
  };
}

/**
 * Получение подборок аниме из AniXart
 */
export async function getAnixartDiscover(category = 'popular', page = 0) {
  const pageNum = parseInt(page, 10) || 0;
  const cacheKey = `discover_${category}_page_${pageNum}`;
  const cached = getCache('anixart', cacheKey);
  if (cached) return cached;

  try {
    let res;
    switch (category) {
      case 'recommendations':
        res = await client.endpoints.discover.recommendations(pageNum);
        break;
      case 'interesting':
        res = await client.endpoints.discover.interesting(pageNum);
        break;
      case 'popular':
      default:
        res = await client.endpoints.discover.watching(pageNum);
        break;
    }

    const rawList = res?.content || res?.releases || [];
    const items = rawList.map(formatAnimeRelease).filter(Boolean);

    const result = {
      page: pageNum,
      category,
      total_count: res?.total_count || items.length,
      total_pages: res?.total_page_count || 1,
      items
    };

    setCache('anixart', cacheKey, result, 1800); // 30 минут
    return result;
  } catch (err) {
    console.error(`[AniXart] Ошибка получения подборки ${category}:`, err.message);
    return { page: pageNum, category, total_count: 0, total_pages: 0, items: [] };
  }
}

/**
 * Поиск аниме в AniXart
 */
export async function searchAnixart(query, page = 0) {
  if (!query || !query.trim()) return { items: [], total_count: 0 };

  const pageNum = parseInt(page, 10) || 0;
  const cleanQuery = query.trim();
  const cacheKey = `search_${cleanQuery.toLowerCase()}_page_${pageNum}`;
  const cached = getCache('anixart', cacheKey);
  if (cached) return cached;

  try {
    const res = await client.endpoints.search.releaseSearch({ query: cleanQuery, page: pageNum });
    const rawList = res?.content || res?.releases || [];
    const items = rawList.map(formatAnimeRelease).filter(Boolean);

    const result = {
      page: pageNum,
      query: cleanQuery,
      total_count: res?.total_count || items.length,
      total_pages: res?.total_page_count || 1,
      items
    };

    setCache('anixart', cacheKey, result, 900); // 15 минут
    return result;
  } catch (err) {
    console.error(`[AniXart] Ошибка поиска по запросу "${cleanQuery}":`, err.message);
    return { page: pageNum, query: cleanQuery, total_count: 0, total_pages: 0, items: [] };
  }
}

/**
 * Получение детальной информации о релизе AniXart и доступных озвучек
 */
export async function getAnixartReleaseDetails(releaseId) {
  const numId = parseInt(releaseId, 10);
  if (!numId) return null;

  const cacheKey = `details_${numId}`;
  const cached = getCache('anixart', cacheKey);
  if (cached) return cached;

  try {
    const releaseRes = await client.endpoints.release.release(numId);
    const rel = releaseRes?.release || releaseRes;
    const baseFormatted = formatAnimeRelease(rel);
    if (!baseFormatted) return null;

    // Получаем озвучки (AniLibria, AniDUB, Студийная Банда и др.)
    let voiceovers = [];
    try {
      const typesRes = await client.endpoints.episode.types(numId);
      if (typesRes?.types && Array.isArray(typesRes.types)) {
        voiceovers = typesRes.types.map(t => ({
          id: t.id,
          name: t.name,
          icon: t.icon || '',
          episodes_count: t.episodes_count || 0,
          is_sub: !!t.is_sub
        }));
      }
    } catch (e) {
      console.warn(`[AniXart] Не удалось загрузить типы озвучек для ${numId}:`, e.message);
    }

    // Дополнительные скриншоты
    const screenshots = (rel.screenshots || rel.screenshot_images || []).map(s => {
      if (typeof s === 'string') return s;
      return s.url || s.image || '';
    }).filter(Boolean);

    const result = {
      ...baseFormatted,
      screenshots,
      voiceovers,
      // Резервный мультиплеер Kodik / Kinobox по названию
      kinobox_query: `${baseFormatted.title} ${baseFormatted.year}`.trim()
    };

    setCache('anixart', cacheKey, result, 3600); // 1 час
    return result;
  } catch (err) {
    console.error(`[AniXart] Ошибка получения деталей релиза ${releaseId}:`, err.message);
    return null;
  }
}

/**
 * Получение серий для конкретной озвучки релиза
 */
export async function getAnixartEpisodes(releaseId, typeId) {
  const numReleaseId = parseInt(releaseId, 10);
  const numTypeId = parseInt(typeId, 10);
  if (!numReleaseId || !numTypeId) return [];

  const cacheKey = `episodes_${numReleaseId}_${numTypeId}`;
  const cached = getCache('anixart', cacheKey);
  if (cached) return cached;

  try {
    // 1. Получаем доступные источники (Kodik, Libria, Sibnet и т.д.)
    const sourcesRes = await client.endpoints.episode.sources(numReleaseId, numTypeId);
    const sources = sourcesRes?.sources || [];
    if (!sources.length) return [];

    // Выбираем первый приоритетный источник (например, Kodik или первый доступный)
    const primarySource = sources.find(s => s.name?.toLowerCase().includes('kodik')) || sources[0];

    // 2. Получаем серии
    const episodesRes = await client.endpoints.episode.episodes(numReleaseId, numTypeId, primarySource.id);
    const rawEpisodes = episodesRes?.episodes || [];

    const episodes = rawEpisodes.map((ep, idx) => ({
      position: ep.position || (idx + 1),
      name: ep.name || `${ep.position || (idx + 1)} серия`,
      url: ep.url || '',
      is_iframe: !!ep.iframe,
      quality: ep.quality || 0,
      source_name: primarySource.name
    }));

    setCache('anixart', cacheKey, episodes, 1800); // 30 минут
    return episodes;
  } catch (err) {
    console.error(`[AniXart] Ошибка получения серий для ${releaseId} (type ${typeId}):`, err.message);
    return [];
  }
}
