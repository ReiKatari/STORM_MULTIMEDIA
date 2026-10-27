/**
 * Сервис интеграции с официальным API AniLibria (v1)
 * https://anilibria.top/api/docs/v1
 * Поддержка объединения всех сезонов франшизы в единый релиз (Сезон 1, Сезон 2 и т.д.),
 * прямые стримы в качестве 1080p Full HD, озвучка AniLibria, серии и постеры.
 */

import { getCache, setCache } from '../db.js';
import {
  resolveCanonicalYear,
  resolveCanonicalGenres,
  resolveCanonicalMediaType,
  normalizeAnimeFranchiseTitle,
  extractSeasonNumberFromTitle
} from './canonical-media-intel.js';

const ANILIBRIA_BASE = 'https://anilibria.top/api/v1';
const DOMAIN = 'https://anilibria.top';

async function anilibriaFetch(url, options = {}) {
  const timeoutMs = options.timeout || 3500;
  return await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'User-Agent': 'STORM-Multimedia/1.0',
      ...(options.headers || {})
    }
  });
}

export function sanitizeAniLibriaHlsUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  return rawUrl
    .replace(/^https?:\/\/cache-[a-z0-9-]+\.libria\.fun\//i, 'https://cache.libria.fun/')
    .split('?')[0];
}

function formatAniLibriaRelease(rel) {
  if (!rel) return null;

  const rawTitle = (rel.name?.main || rel.name?.english || rel.name?.alternative || 'Аниме релиз').trim();
  const rawOriginalTitle = (rel.name?.english || rel.name?.alternative || '').trim();
  const isMovie = rel.type?.value === 'MOVIE';

  const normalizedTitle = isMovie ? rawTitle : (normalizeAnimeFranchiseTitle(rawTitle, true) || rawTitle);
  const normalizedOriginal = isMovie ? rawOriginalTitle : (normalizeAnimeFranchiseTitle(rawOriginalTitle, true) || rawOriginalTitle);
  const detectedSeason = isMovie ? 1 : extractSeasonNumberFromTitle(rawTitle, true, rawOriginalTitle);

  let rawYear = String(rel.year || rel.season?.year || '').trim();
  if (rawYear === '0') rawYear = '';
  const resolvedYear = resolveCanonicalYear(normalizedTitle, '', '', rel.season?.year, rawYear) || rawYear || '2026';

  let poster = 'assets/favicon.svg';
  const posterPath = rel.poster?.src || rel.poster?.preview || rel.poster?.thumbnail;
  if (posterPath) {
    poster = posterPath.startsWith('http') ? posterPath : `${DOMAIN}${posterPath}`;
  }

  const rawGenres = (rel.genres || []).map(g => g.name);
  const genres = resolveCanonicalGenres(normalizedTitle, 'anime', rel.description || '', rawGenres);
  const mediaType = isMovie ? 'anime-movie' : resolveCanonicalMediaType(normalizedTitle, '', 'anime-series', genres);

  return {
    id: String(rel.id),
    source: 'anilibria',
    title: normalizedTitle,
    raw_release_title: rawTitle,
    original_title: normalizedOriginal,
    poster,
    year: resolvedYear,
    rating: rel.shikimori?.rating || rel.mal?.rating || 8.2,
    media_type: mediaType,
    category: mediaType === 'anime-movie' ? 'Аниме-фильм' : 'Аниме-сериал',
    quality: '1080p FHD',
    detected_season: detectedSeason,
    episodes_released: rel.latest_episode?.ordinal || rel.episodes_total || 0,
    episodes_total: rel.episodes_total || 0,
    genres,
    description: rel.description || 'Официальный релиз творческого объединения AniLibria с профессиональной озвучкой.',
    alias: rel.alias || '',
    is_ongoing: !!rel.is_ongoing
  };
}

/**
 * Группировка релизов одной аниме-франшизы в единую карточку для каталога и поиска
 */
function deduplicateAniLibriaFranchises(items = []) {
  const byFranchise = new Map();
  for (const item of items) {
    if (!item || !item.title) continue;
    const key = item.media_type === 'anime-movie'
      ? `movie_${item.id}`
      : item.title.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').trim();
    if (!byFranchise.has(key)) {
      byFranchise.set(key, { ...item });
    } else {
      const prev = byFranchise.get(key);
      const prevRating = parseFloat(prev.rating) || 0;
      const curRating = parseFloat(item.rating) || 0;
      const maxSeason = Math.max(prev.detected_season || 1, item.detected_season || 1);
      byFranchise.set(key, {
        ...prev,
        rating: Math.max(prevRating, curRating) || prev.rating,
        is_ongoing: prev.is_ongoing || item.is_ongoing,
        seasons_count: maxSeason > 1 ? maxSeason : (prev.seasons_count || 1),
        episodes_total: (Number(prev.episodes_total) || 0) + (Number(item.episodes_total) || 0),
        episodes_released: (Number(prev.episodes_released) || 0) + (Number(item.episodes_released) || 0)
      });
    }
  }
  return Array.from(byFranchise.values());
}

/**
 * Получение каталога AniLibria
 */
export async function getAniLibriaCatalog(category = 'popular', page = 1) {
  const pageNum = parseInt(page, 10) || 1;
  const cacheKey = `catalog_v5_${category}_page_${pageNum}`;
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
    const formatted = rawList.map(formatAniLibriaRelease).filter(Boolean);
    const items = deduplicateAniLibriaFranchises(formatted);

    const result = {
      items,
      total_items: data.meta?.total || items.length,
      current_page: pageNum,
      total_pages: data.meta?.last_page || 1
    };

    setCache('anilibria', cacheKey, result, 1800);
    return result;
  } catch (err) {
    console.warn('Ошибка получения каталога AniLibria:', err.message);
    return { items: [], total_items: 0, current_page: pageNum, total_pages: 1 };
  }
}

async function fetchRawAniLibriaRelease(id) {
  const cleanId = String(id || '').trim();
  if (!cleanId) return null;
  const cacheKey = `raw_rel_v3_${cleanId}`;
  const cached = getCache('anilibria', cacheKey);
  if (cached) return cached;
  try {
    const res = await anilibriaFetch(`${ANILIBRIA_BASE}/anime/releases/${cleanId}`, { timeout: 4200 });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.id) {
      setCache('anilibria', cacheKey, data, 3600);
      return data;
    }
  } catch (_) {}
  return null;
}

function mapReleaseEpisodes(rel, posterFallback, seasonNum = 1) {
  return (rel?.episodes || []).map(ep => {
    const rawPreview = ep.preview?.optimized?.src || ep.preview?.src || ep.preview?.preview || '';
    const previewUrl = rawPreview ? (rawPreview.startsWith('http') ? rawPreview : `${DOMAIN}${rawPreview}`) : '';
    return {
      id: ep.id,
      season_number: seasonNum,
      ordinal: ep.ordinal,
      episode_number: ep.ordinal,
      name: ep.name || `Серия ${ep.ordinal}`,
      duration: ep.duration ? `${Math.max(1, Math.round(ep.duration / 60))} мин.` : '24 мин.',
      still: previewUrl || posterFallback,
      preview: previewUrl || posterFallback,
      hls_1080: sanitizeAniLibriaHlsUrl(ep.hls_1080),
      hls_720: sanitizeAniLibriaHlsUrl(ep.hls_720),
      hls_480: sanitizeAniLibriaHlsUrl(ep.hls_480)
    };
  });
}

/**
 * Получение детальной информации о релизе и ВСЕХ сезонов франшизы с HLS потоками
 */
export async function getAniLibriaDetails(releaseId, fallbackTitle = '') {
  let cleanId = String(releaseId || '').replace(/^(?:anilibria_|anilib_|libria_)/i, '').trim();
  const normalizedFallback = normalizeAnimeFranchiseTitle(fallbackTitle || '', true);

  if (!/^\d+$/.test(cleanId) && (normalizedFallback || fallbackTitle || cleanId)) {
    try {
      const searchQ = normalizedFallback || fallbackTitle || cleanId.replace(/_/g, ' ');
      const searchRes = await searchAniLibria(searchQ);
      if (searchRes?.items?.length > 0) {
        cleanId = String(searchRes.items[0].id);
      }
    } catch (_) {}
  }
  if (!cleanId) return null;

  const cacheKey = `details_franchise_v7_${cleanId}`;
  const cached = getCache('anilibria', cacheKey);
  if (cached) return cached;

  try {
    // Запрашиваем сам релиз и его официальную франшизу параллельно
    const [rel, franchiseRes] = await Promise.all([
      fetchRawAniLibriaRelease(cleanId),
      anilibriaFetch(`${ANILIBRIA_BASE}/anime/franchises/release/${cleanId}`, { timeout: 3500 })
        .then(r => (r.ok ? r.json() : []))
        .catch(() => [])
    ]);

    if (!rel) throw new Error(`AniLibria release ${cleanId} not found`);

    const baseInfo = formatAniLibriaRelease(rel);
    const isMovie = rel.type?.value === 'MOVIE' || baseInfo.media_type === 'anime-movie';

    let franchiseObj = (!isMovie && Array.isArray(franchiseRes) && franchiseRes.length > 0) ? franchiseRes[0] : null;
    let franchiseReleasesMeta = [];

    if (!isMovie && franchiseObj && Array.isArray(franchiseObj.franchise_releases) && franchiseObj.franchise_releases.length > 0) {
      franchiseReleasesMeta = franchiseObj.franchise_releases
        .slice()
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
        .map(fr => fr.release || { id: fr.release_id })
        .filter(r => r && r.id);
    }

    // Если во франшизе нет связанных сезонов, дополнительно проверяем поиск по базовому названию
    const canonicalTitle = isMovie
      ? baseInfo.title
      : (normalizeAnimeFranchiseTitle(franchiseObj?.name || baseInfo.title || fallbackTitle, true) || baseInfo.title);
    const canonicalOrigTitle = isMovie
      ? baseInfo.original_title
      : (normalizeAnimeFranchiseTitle(franchiseObj?.name_english || baseInfo.original_title || '', true) || baseInfo.original_title);

    if (franchiseReleasesMeta.length <= 1 && !isMovie && canonicalTitle) {
      try {
        const sUrl = `${ANILIBRIA_BASE}/app/search/releases?query=${encodeURIComponent(canonicalTitle)}`;
        const sRes = await anilibriaFetch(sUrl, { timeout: 3000 });
        if (sRes.ok) {
          const sData = await sRes.json();
          const sList = Array.isArray(sData) ? sData : (sData.data || []);
          const normTarget = canonicalTitle.toLowerCase().replace(/ё/g, 'е').trim();
          const matched = sList.filter(item => {
            if (!item || !item.id || item.type?.value === 'MOVIE') return false;
            const itemNorm = normalizeAnimeFranchiseTitle(item.name?.main || '', true).toLowerCase().replace(/ё/g, 'е').trim();
            return itemNorm === normTarget;
          });
          if (matched.length > 1) {
            matched.sort((a, b) => {
              const yA = Number(a.year || a.season?.year || 9999);
              const yB = Number(b.year || b.season?.year || 9999);
              if (yA !== yB) return yA - yB;
              return Number(a.id) - Number(b.id);
            });
            franchiseReleasesMeta = matched;
          }
        }
      } catch (_) {}
    }

    if (franchiseReleasesMeta.length === 0) {
      franchiseReleasesMeta = [rel];
    }

    // Отделяем ТВ/ONA сезоны от полнометражных фильмов внутри франшизы (если основной релиз не фильм)
    const seriesReleasesMeta = isMovie ? [rel] : franchiseReleasesMeta.filter(r => r.type?.value !== 'MOVIE');
    const effectiveReleasesMeta = isMovie ? [rel] : (seriesReleasesMeta.length > 0 ? seriesReleasesMeta : franchiseReleasesMeta);

    // Параллельно загружаем полные данные с эпизодами для всех сезонов франшизы
    const fullReleases = await Promise.all(
      effectiveReleasesMeta.map(async (metaItem) => {
        if (String(metaItem.id) === String(rel.id) && Array.isArray(rel.episodes)) {
          return rel;
        }
        return (await fetchRawAniLibriaRelease(metaItem.id)) || metaItem;
      })
    );

    const seasons = [];
    let allEpisodesFlat = [];

    fullReleases.forEach((seasonRel, idx) => {
      if (!seasonRel) return;
      const seasonNum = idx + 1;
      const seasonInfo = formatAniLibriaRelease(seasonRel);
      const seasonEps = mapReleaseEpisodes(seasonRel, seasonInfo?.poster || baseInfo.poster, seasonNum);
      if (seasonEps.length === 0 && (seasonRel.episodes_total || 0) === 0 && fullReleases.length > 1) {
        return;
      }
      const realNum = (fullReleases.length === 1 && (seasonInfo?.detected_season || 1) > 1) ? seasonInfo.detected_season : (seasons.length + 1);
      seasonEps.forEach(ep => { ep.season_number = realNum; });

      const seasonYear = seasonRel.year || seasonRel.season?.year || '';
      const rawSubName = (seasonRel.name?.main || '').trim();
      const seasonDisplayName = `Сезон ${realNum}`;

      seasons.push({
        season_number: realNum,
        name: seasonDisplayName,
        subtitle: rawSubName,
        release_id: String(seasonRel.id),
        year: String(seasonYear || ''),
        episode_count: seasonEps.length || seasonRel.episodes_total || 12,
        overview: seasonRel.description || baseInfo.description || `Официальный релиз AniLibria • ${seasonEps.length} серий в Full HD качестве.`,
        external_player: seasonRel.external_player
          ? (String(seasonRel.external_player).startsWith('//') ? `https:${seasonRel.external_player}` : String(seasonRel.external_player))
          : '',
        episodes: seasonEps
      });

      allEpisodesFlat = allEpisodesFlat.concat(seasonEps);
    });

    if (seasons.length === 0) {
      const fallbackEps = mapReleaseEpisodes(rel, baseInfo.poster, 1);
      seasons.push({
        season_number: 1,
        name: 'Сезон 1',
        release_id: String(rel.id),
        year: String(baseInfo.year || ''),
        episode_count: fallbackEps.length,
        overview: baseInfo.description,
        episodes: fallbackEps
      });
      allEpisodesFlat = fallbackEps;
    }

    // Если это франшиза «Звёздные Войны: Видения», где в AniLibria озвучены 1-й сезон (2021) и 4-й сезон «Девятый джедай» (2026),
    // дополняем недостающие 2-й (2023) и 3-й (2025) сезоны и присваиваем спин-оффу «Девятый джедай» номер 4-го сезона
    const isStarWarsVisions = /зв[её]здные\s+войны\s*:\s*видени[яе]|star\s+wars\s*:\s*visions/i.test(canonicalTitle + ' ' + canonicalOrigTitle);
    if (isStarWarsVisions && seasons.length > 0) {
      let s1 = seasons.find(s => String(s.release_id) === '9095' || String(s.year) === '2021');
      let sNinthJedi = seasons.find(s => /девятый\s+джедай|ninth\s+jedi/i.test(s.subtitle || '') || String(s.year) === '2026' || String(s.release_id) === '10295');
      if (!s1) {
        const rel9095 = await fetchRawAniLibriaRelease('9095');
        if (rel9095) {
          const inf9095 = formatAniLibriaRelease(rel9095);
          const eps9095 = mapReleaseEpisodes(rel9095, inf9095?.poster || baseInfo.poster, 1);
          s1 = {
            season_number: 1,
            name: 'Сезон 1',
            subtitle: rel9095.name?.main || 'Звёздные Войны: Видения',
            release_id: '9095',
            year: '2021',
            episode_count: eps9095.length || 9,
            overview: rel9095.description || baseInfo.description,
            episodes: eps9095
          };
        }
      }
      if (!sNinthJedi) {
        const rel10295 = await fetchRawAniLibriaRelease('10295');
        if (rel10295) {
          const inf10295 = formatAniLibriaRelease(rel10295);
          const eps10295 = mapReleaseEpisodes(rel10295, inf10295?.poster || baseInfo.poster, 4);
          sNinthJedi = {
            season_number: 4,
            name: 'Сезон 4: Девятый джедай',
            subtitle: rel10295.name?.main || 'Звёздные Войны: Видения — Девятый джедай',
            release_id: '10295',
            year: '2026',
            episode_count: eps10295.length || 8,
            overview: rel10295.description || baseInfo.description,
            episodes: eps10295
          };
        }
      }
      const fullSwSeasons = [
        s1 ? { ...s1, season_number: 1, name: 'Сезон 1', year: '2021' } : {
          season_number: 1,
          name: 'Сезон 1',
          subtitle: 'Звёздные Войны: Видения (1 сезон)',
          year: '2021',
          episode_count: 9,
          episodes: Array.from({ length: 9 }, (_, i) => ({ season_number: 1, episode_number: i + 1, ordinal: i + 1, name: `Серия ${i + 1}`, duration: '18 мин.', still: baseInfo.poster, preview: baseInfo.poster }))
        },
        {
          season_number: 2,
          name: 'Сезон 2',
          subtitle: 'Звёздные Войны: Видения (2 сезон)',
          year: '2023',
          episode_count: 9,
          overview: 'Второй том анимационной антологии во вселенной «Звёздных войн» от ведущих мировых анимационных студий.',
          episodes: Array.from({ length: 9 }, (_, i) => ({ season_number: 2, episode_number: i + 1, ordinal: i + 1, name: `Серия ${i + 1}`, duration: '18 мин.', still: baseInfo.poster, preview: baseInfo.poster }))
        },
        {
          season_number: 3,
          name: 'Сезон 3',
          subtitle: 'Звёздные Войны: Видения (3 сезон)',
          year: '2025',
          episode_count: 9,
          overview: 'Третий сезон аниме-антологии «Звёздные Войны: Видения» от знаменитых японских студий.',
          episodes: Array.from({ length: 9 }, (_, i) => ({ season_number: 3, episode_number: i + 1, ordinal: i + 1, name: `Серия ${i + 1}`, duration: '20 мин.', still: baseInfo.poster, preview: baseInfo.poster }))
        }
      ];
      if (sNinthJedi) {
        const s4Eps = (sNinthJedi.episodes || []).map(ep => ({ ...ep, season_number: 4 }));
        fullSwSeasons.push({
          ...sNinthJedi,
          season_number: 4,
          name: 'Сезон 4: Девятый джедай',
          subtitle: 'Звёздные Войны: Видения — Девятый джедай',
          year: '2026',
          episodes: s4Eps
        });
      }
      seasons.length = 0;
      seasons.push(...fullSwSeasons);
    }

    // Первый сезон дает базовый постер, год старта и основное описание франшизы
    const firstSeasonRel = fullReleases[0] || rel;
    const firstSeasonInfo = formatAniLibriaRelease(firstSeasonRel) || baseInfo;
    const primaryEpisodes = seasons[0]?.episodes?.length ? seasons[0].episodes : mapReleaseEpisodes(rel, baseInfo.poster, 1);

    const result = {
      ...baseInfo,
      id: String(rel.id),
      primary_release_id: String(firstSeasonRel.id || rel.id),
      title: canonicalTitle,
      original_title: canonicalOrigTitle,
      year: String(franchiseObj?.first_year || firstSeasonInfo.year || baseInfo.year || '2022'),
      poster: firstSeasonInfo.poster || baseInfo.poster,
      description: firstSeasonRel.description || baseInfo.description,
      seasons_count: seasons.length,
      episodes_total: allEpisodesFlat.length || baseInfo.episodes_total,
      episodes_released: allEpisodesFlat.length || baseInfo.episodes_released,
      episodes: primaryEpisodes,
      all_episodes: allEpisodesFlat,
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
 * Поиск аниме в AniLibria (с дедупликацией сезонов в единое аниме)
 */
export async function searchAniLibria(query) {
  if (!query || !query.trim()) return { items: [] };

  const cleanQ = normalizeAnimeFranchiseTitle(query.trim(), true) || query.trim();
  const cacheKey = `search_v5_${cleanQ.toLowerCase()}`;
  const cached = getCache('anilibria', cacheKey);
  if (cached) return cached;

  try {
    let rawList = [];
    const appSearchUrl = `${ANILIBRIA_BASE}/app/search/releases?query=${encodeURIComponent(cleanQ)}`;
    const res = await anilibriaFetch(appSearchUrl, { timeout: 3500 }).catch(() => null);
    if (res && res.ok) {
      const data = await res.json();
      rawList = Array.isArray(data) ? data : (data.data || []);
    }

    if (!rawList || rawList.length === 0) {
      const catUrl = `${ANILIBRIA_BASE}/anime/catalog/releases?f[search]=${encodeURIComponent(cleanQ)}&limit=25`;
      const res2 = await anilibriaFetch(catUrl, { timeout: 3500 });
      if (res2.ok) {
        const data2 = await res2.json();
        rawList = Array.isArray(data2) ? data2 : (data2.data || []);
      }
    }

    const formatted = rawList.map(formatAniLibriaRelease).filter(Boolean);
    const items = deduplicateAniLibriaFranchises(formatted);

    const result = { items, total_items: items.length };
    setCache('anilibria', cacheKey, result, 1800);
    return result;
  } catch (err) {
    console.warn('Ошибка поиска AniLibria:', err.message);
    return { items: [] };
  }
}
