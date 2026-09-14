import { Anixart, FilterSortType, ReleaseCategory } from 'anixapi';
import { getCache, setCache } from '../db.js';

const client = new Anixart();

function withTimeout(promise, ms = 8000) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`AniXart request timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

/**
 * Преобразование объекта релиза AniXart в единый формат STORM MULTIMEDIA
 */
function formatAnimeRelease(rel) {
  if (!rel) return null;

  // Извлекаем название
  const title = rel.title_ru || rel.title_original || rel.title_alt || rel.title || 'Аниме релиз';
  const origTitle = rel.title_original || rel.title_alt || '';

  // Извлекаем постер: приоритет официальному быстрому CDN static.anixart.tv
  let rawPoster = '';
  if (rel.poster) {
    const posterCode = String(rel.poster).replace(/\.jpg$/i, '').trim();
    if (posterCode.startsWith('http')) {
      rawPoster = posterCode.replace(/https?:\/\/(?:s\.)?anix(?:mirai|sekai)\.com\/posters\//i, 'https://static.anixart.tv/posters/');
    } else {
      rawPoster = `https://static.anixart.tv/posters/${posterCode}.jpg`;
    }
  } else if (rel.image) {
    rawPoster = String(rel.image)
      .replace(/https?:\/\/(?:s\.)?anix(?:mirai|sekai)\.com\/posters\//i, 'https://static.anixart.tv/posters/')
      .trim();
  }
  if (!rawPoster && rel.screenshot_images && rel.screenshot_images.length > 0) {
    rawPoster = rel.screenshot_images[0];
  }

  const cleanTitle = title.trim();
  const cleanOrig = origTitle.trim();
  const poster = rawPoster
    ? `/api/media/image-proxy?url=${encodeURIComponent(rawPoster)}&title=${encodeURIComponent(cleanTitle)}&orig=${encodeURIComponent(cleanOrig)}`
    : 'assets/favicon.svg';

  return {
    id: String(rel.id),
    source: 'anixart',
    title: cleanTitle,
    original_title: origTitle.trim(),
    poster,
    year: String(rel.year || ''),
    rating: typeof rel.grade === 'number' ? Math.round(rel.grade * 10) / 10 : (typeof rel.rating === 'number' ? Math.round(rel.rating / 1000) / 10 : 0),
    media_type: rel.category?.name === 'Фильм' ? 'anime-movie' : 'anime-series',
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
    voiceovers_count: rel.voiceovers_count || 0,
    screenshots: rel.screenshot_images || []
  };
}

/**
 * Получение подборок аниме из AniXart
 * Категории: popular, new, anime-movies, anime-series, top-rated
 */
export async function getAnixartDiscover(category = 'popular', page = 0) {
  const pageNum = parseInt(page, 10) || 0;
  const cacheKey = `discover_${category}_page_${pageNum}`;
  const cached = getCache('anixart', cacheKey);
  if (cached) return cached;

  try {
    let res;

    switch (category) {
      case 'new':
        // Сортировка по дате обновления (Новинки)
        res = await withTimeout(client.endpoints.filter.filter(pageNum, {
          sort: FilterSortType.SortDateUpdate || 0
        }));
        break;

      case 'anime-movies':
        // Только полнометражные аниме-фильмы
        res = await withTimeout(client.endpoints.filter.filter(pageNum, {
          category_id: ReleaseCategory.Movie || 2,
          sort: FilterSortType.SortPopular || 3
        }));
        break;

      case 'anime-series':
        // Только аниме-сериалы
        res = await withTimeout(client.endpoints.filter.filter(pageNum, {
          category_id: ReleaseCategory.Series || 1,
          sort: FilterSortType.SortPopular || 3
        }));
        break;

      case 'top-rated':
        // По оценке зрителей
        res = await withTimeout(client.endpoints.filter.filter(pageNum, {
          sort: FilterSortType.SortGrade || 1
        }));
        break;

      case 'popular':
      default:
        // Популярные онгоинги и сериалы
        res = await withTimeout(client.endpoints.discover.watching(pageNum));
        if (!res?.content || res.content.length === 0) {
          res = await withTimeout(client.endpoints.filter.filter(pageNum, {
            sort: FilterSortType.SortPopular || 3
          }));
        }
        break;
    }

    const rawList = res?.content || res?.releases || [];
    const items = rawList.map(formatAnimeRelease).filter(it => it && it.title !== 'Без названия');

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
 * Полнотекстовый поиск аниме в AniXart
 */
export async function searchAnixart(query, page = 0) {
  if (!query || !query.trim()) return { items: [], total_count: 0 };

  const pageNum = parseInt(page, 10) || 0;
  const cleanQuery = query.trim();
  const cacheKey = `search_${cleanQuery.toLowerCase()}_page_${pageNum}`;
  const cached = getCache('anixart', cacheKey);
  if (cached) return cached;

  try {
    const res = await withTimeout(client.endpoints.search.releaseSearch(pageNum, { query: cleanQuery }));
    const rawList = res?.releases || res?.content || [];
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
    const releaseRes = await withTimeout(client.endpoints.release.release(numId));
    const rel = releaseRes?.release || releaseRes;
    const baseFormatted = formatAnimeRelease(rel);
    if (!baseFormatted) return null;

    // Получаем озвучки (AniLibria, AniDUB, SovetRomantica, Persona99, Студийная Банда и др.)
    let voiceovers = [];
    try {
      const typesRes = await withTimeout(client.endpoints.episode.types(numId));
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

    // Скриншоты
    const screenshots = (rel.screenshots || rel.screenshot_images || []).map(s => {
      if (typeof s === 'string') return s;
      return s.url || s.image || '';
    }).filter(Boolean);

    const result = {
      ...baseFormatted,
      screenshots,
      voiceovers,
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
 * Получение списка серий конкретной озвучки
 */
export async function getAnixartEpisodes(releaseId, typeId) {
  const numReleaseId = parseInt(releaseId, 10);
  const numTypeId = parseInt(typeId, 10);
  if (!numReleaseId || !numTypeId) return [];

  const cacheKey = `episodes_${numReleaseId}_${numTypeId}`;
  const cached = getCache('anixart', cacheKey);
  if (cached) return cached;

  try {
    const sourcesRes = await client.endpoints.episode.sources(numReleaseId, numTypeId);
    const sources = sourcesRes?.sources || [];
    if (!sources.length) return [];

    const primarySource = sources.find(s => s.name?.toLowerCase().includes('kodik')) || sources[0];
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
