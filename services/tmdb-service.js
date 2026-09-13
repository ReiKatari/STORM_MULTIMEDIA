/**
 * Сервис интеграции с The Movie Database (TMDB)
 * Мировая база кино, сериалов и мультфильмов с постерами в высоком разрешении
 */

import { getCache, setCache } from '../db.js';

const TMDB_API_KEY = 'REDACTED_TMDB_KEY';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

function formatTmdbItem(item, mediaTypeHint = null) {
  if (!item) return null;

  const isTv = item.media_type === 'tv' || mediaTypeHint === 'series' || mediaTypeHint === 'cartoon-series' || (!item.title && !!item.name);
  const title = (isTv ? item.name : item.title) || 'Кинофильм';
  const originalTitle = (isTv ? item.original_name : item.original_title) || '';
  const dateStr = (isTv ? item.first_air_date : item.release_date) || '';
  const year = dateStr ? dateStr.substring(0, 4) : '';

  let poster = 'assets/favicon.svg';
  if (item.poster_path) {
    poster = `${IMAGE_BASE}${item.poster_path}`;
  } else if (item.backdrop_path) {
    poster = `${IMAGE_BASE}${item.backdrop_path}`;
  }

  // Определение типа медиа
  let mediaType = isTv ? 'series' : 'movie';
  const genreIds = item.genre_ids || [];
  if (genreIds.includes(16)) { // 16 = Animation в TMDB
    mediaType = isTv ? 'cartoon-series' : 'cartoons';
  }

  return {
    id: String(item.id),
    source: 'tmdb',
    title: title.trim(),
    original_title: originalTitle.trim(),
    poster,
    year,
    rating: item.vote_average ? Math.round(item.vote_average * 10) / 10 : 0,
    media_type: mediaType,
    quality: '4K Ultra HD',
    is4K: true,
    description: item.overview || 'Мировой кинематографический релиз в сверхвысоком качестве.',
    popularity: item.popularity || 0,
    vote_count: item.vote_count || 0
  };
}

/**
 * Получение каталога TMDB по категориям
 */
export async function getTmdbCatalog(category = 'popular', page = 1) {
  const pageNum = parseInt(page, 10) || 1;
  const cacheKey = `catalog_${category}_page_${pageNum}`;
  const cached = getCache('tmdb', cacheKey);
  if (cached) return cached;

  try {
    let endpoint = '/trending/all/week';

    if (category === 'movies') {
      endpoint = '/movie/popular';
    } else if (category === 'series') {
      endpoint = '/tv/popular';
    } else if (category === 'new') {
      endpoint = '/movie/now_playing';
    } else if (category === 'cartoons') {
      endpoint = '/discover/movie?with_genres=16&sort_by=popularity.desc';
    } else if (category === 'cartoon-series') {
      endpoint = '/discover/tv?with_genres=16&sort_by=popularity.desc';
    } else if (category === 'anime-movies') {
      endpoint = '/discover/movie?with_genres=16&with_original_language=ja&sort_by=popularity.desc';
    } else if (category === 'anime-series') {
      endpoint = '/discover/tv?with_genres=16&with_original_language=ja&sort_by=popularity.desc';
    }

    const sep = endpoint.includes('?') ? '&' : '?';
    const url = `${TMDB_BASE}${endpoint}${sep}api_key=${TMDB_API_KEY}&language=ru-RU&page=${pageNum}`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'STORM-Multimedia/1.0'
      }
    });

    if (!res.ok) {
      throw new Error(`TMDB error status: ${res.status}`);
    }

    const data = await res.json();
    const items = (data.results || []).map(i => formatTmdbItem(i, category));

    const result = {
      items,
      total_items: data.total_results || items.length,
      current_page: pageNum,
      total_pages: data.total_pages || 1
    };

    setCache('tmdb', cacheKey, result, 3600); // 1 час кэша
    return result;
  } catch (err) {
    console.warn('Ошибка получения каталога TMDB:', err.message);
    return { items: [], total_items: 0, current_page: pageNum, total_pages: 1 };
  }
}

/**
 * Поиск фильмов и сериалов в TMDB
 */
export async function searchTmdb(query, page = 1) {
  if (!query || !query.trim()) return { items: [] };

  const pageNum = parseInt(page, 10) || 1;
  const cacheKey = `search_${query.trim().toLowerCase()}_page_${pageNum}`;
  const cached = getCache('tmdb', cacheKey);
  if (cached) return cached;

  try {
    const url = `${TMDB_BASE}/search/multi?api_key=${TMDB_API_KEY}&language=ru-RU&query=${encodeURIComponent(query)}&page=${pageNum}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`TMDB search error: ${res.status}`);

    const data = await res.json();
    const items = (data.results || [])
      .filter(i => i.media_type === 'movie' || i.media_type === 'tv')
      .map(i => formatTmdbItem(i));

    const result = {
      items,
      total_items: data.total_results || items.length
    };

    setCache('tmdb', cacheKey, result, 1800);
    return result;
  } catch (err) {
    console.warn('Ошибка поиска TMDB:', err.message);
    return { items: [] };
  }
}

/**
 * Получение подробной информации о релизе (актеры, режиссеры, жанры, рейтинги, сезоны)
 */
export async function getTmdbItemDetails(id, mediaTypeHint = null) {
  if (!id) return null;
  const cleanId = String(id).replace('tmdb_', '').trim();
  const cacheKey = `details_${cleanId}_${mediaTypeHint || 'any'}`;
  const cached = getCache('tmdb', cacheKey);
  if (cached) return cached;

  const isExplicitTv = mediaTypeHint === 'series' || mediaTypeHint === 'tv' || mediaTypeHint === 'cartoon-series' || mediaTypeHint === 'anime-series';
  const tryEndpoints = isExplicitTv ? ['tv', 'movie'] : ['movie', 'tv'];

  for (const type of tryEndpoints) {
    try {
      const url = `${TMDB_BASE}/${type}/${cleanId}?api_key=${TMDB_API_KEY}&language=ru-RU&append_to_response=credits,videos,external_ids`;
      const res = await fetch(url);
      if (!res.ok) continue;

      const data = await res.json();
      const isTv = type === 'tv';

      const title = (isTv ? data.name : data.title) || 'Кинофильм';
      const originalTitle = (isTv ? data.original_name : data.original_title) || '';
      const dateStr = (isTv ? data.first_air_date : data.release_date) || '';
      
      let formattedDate = '';
      if (dateStr && dateStr.length >= 10) {
        const [y, m, d] = dateStr.substring(0, 10).split('-');
        formattedDate = `${d}.${m}.${y}`;
      } else {
        formattedDate = dateStr;
      }
      const year = dateStr ? dateStr.substring(0, 4) : '';

      // Длительность
      let durationStr = '';
      if (isTv) {
        const epTime = data.episode_run_time?.[0] || (data.last_episode_to_air?.runtime) || 45;
        durationStr = `${epTime} мин / серия`;
      } else if (data.runtime) {
        const h = Math.floor(data.runtime / 60);
        const m = data.runtime % 60;
        durationStr = h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
      }

      // Режиссеры
      const directors = (data.credits?.crew || [])
        .filter(c => c.job === 'Director')
        .map(d => ({
          id: d.id,
          name: d.name,
          role: 'Режиссер',
          photo: d.profile_path ? `${IMAGE_BASE}${d.profile_path}` : 'assets/avatar_default.svg'
        }));

      // Актеры
      const cast = (data.credits?.cast || []).slice(0, 16).map(a => ({
        id: a.id,
        name: a.name,
        character: a.character || 'В главных ролях',
        photo: a.profile_path ? `${IMAGE_BASE}${a.profile_path}` : 'assets/avatar_default.svg'
      }));

      // Трейлеры
      const trailers = (data.videos?.results || []).filter(v => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser'));
      let trailerUrl = null;
      if (trailers.length > 0) {
        trailerUrl = `https://www.youtube-nocookie.com/embed/${trailers[0].key}?autoplay=1&rel=0`;
      }

      // Сезоны для сериалов
      let seasons = [];
      if (isTv && Array.isArray(data.seasons)) {
        seasons = data.seasons
          .filter(s => s.season_number > 0)
          .map(s => ({
            season_number: s.season_number,
            name: s.name || `Сезон ${s.season_number}`,
            episode_count: s.episode_count,
            overview: s.overview || 'Сезон доступен для онлайн-просмотра.',
            poster: s.poster_path ? `${IMAGE_BASE}${s.poster_path}` : null,
            air_date: s.air_date
          }));
      }

      // Проверка на статус не вышедшего фильма
      const isUpcoming = (dateStr ? new Date(dateStr) > new Date() : false) ||
                         ['Planned', 'In Production', 'Post Production', 'Rumored', 'Upcoming'].includes(data.status);

      const details = {
        id: `tmdb_${data.id}`,
        tmdb_id: data.id,
        source: 'tmdb',
        title: title.trim(),
        original_title: originalTitle.trim(),
        poster: data.poster_path ? `${IMAGE_BASE}${data.poster_path}` : (data.backdrop_path ? `${IMAGE_BASE}${data.backdrop_path}` : 'assets/favicon.svg'),
        backdrop: data.backdrop_path ? `https://image.tmdb.org/t/p/original${data.backdrop_path}` : null,
        year,
        release_date: formattedDate,
        duration: durationStr,
        runtime_minutes: data.runtime || (data.episode_run_time?.[0] || 0),
        rating: data.vote_average ? Math.round(data.vote_average * 10) / 10 : 0,
        rating_tmdb: data.vote_average ? Math.round(data.vote_average * 10) / 10 : 0,
        rating_kp: data.vote_average ? Math.round((data.vote_average * 0.95 + 0.3) * 10) / 10 : 0,
        vote_count: data.vote_count || 0,
        imdb_id: data.external_ids?.imdb_id || '',
        media_type: isTv ? 'series' : 'movie',
        is4K: true,
        genres: (data.genres || []).map(g => g.name),
        countries: (data.production_countries || []).map(c => c.name),
        description: data.overview || 'Мировой кинематографический релиз в сверхвысоком качестве.',
        directors,
        cast,
        trailer_url: trailerUrl,
        is_upcoming: isUpcoming,
        seasons,
        players: []
      };

      setCache('tmdb', cacheKey, details, 3600);
      return details;
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Получение серий сезона сериала с русскими названиями и синопсисами
 */
export async function getTmdbSeasonEpisodes(tvId, seasonNumber = 1) {
  const cleanId = String(tvId).replace('tmdb_', '').trim();
  const cacheKey = `tv_${cleanId}_season_${seasonNumber}`;
  const cached = getCache('tmdb', cacheKey);
  if (cached) return cached;

  try {
    const url = `${TMDB_BASE}/tv/${cleanId}/season/${seasonNumber}?api_key=${TMDB_API_KEY}&language=ru-RU`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Season fetch error: ${res.status}`);

    const data = await res.json();
    const episodes = (data.episodes || []).map(ep => {
      let formattedDate = '';
      if (ep.air_date && ep.air_date.length >= 10) {
        const [y, m, d] = ep.air_date.substring(0, 10).split('-');
        formattedDate = `${d}.${m}.${y}`;
      } else {
        formattedDate = ep.air_date || '';
      }

      return {
        episode_number: ep.episode_number,
        name: ep.name || `Серия ${ep.episode_number}`,
        overview: ep.overview || 'Серия доступна для онлайн-просмотра в высоком качестве.',
        still: ep.still_path ? `${IMAGE_BASE}${ep.still_path}` : null,
        duration: ep.runtime ? `${ep.runtime} мин` : '',
        air_date: formattedDate
      };
    });

    const result = {
      season_number: data.season_number,
      name: data.name,
      overview: data.overview || '',
      episodes
    };

    setCache('tmdb', cacheKey, result, 7200);
    return result;
  } catch (err) {
    console.warn('Ошибка загрузки серий сезона:', err.message);
    return { episodes: [] };
  }
}

/**
 * Получение всех видео актера или режиссера
 */
export async function getTmdbPersonMedia(personId) {
  const cleanId = String(personId).trim();
  const cacheKey = `person_${cleanId}`;
  const cached = getCache('tmdb', cacheKey);
  if (cached) return cached;

  try {
    const url = `${TMDB_BASE}/person/${cleanId}?api_key=${TMDB_API_KEY}&language=ru-RU&append_to_response=combined_credits`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Person fetch error: ${res.status}`);

    const data = await res.json();
    const credits = data.combined_credits || {};
    
    // Объединяем и дедуплицируем работы
    const rawItems = [
      ...(credits.crew || []).filter(c => c.job === 'Director'),
      ...(credits.cast || [])
    ];

    const seen = new Set();
    const items = [];

    for (const item of rawItems) {
      if (!item || !item.id || seen.has(item.id)) continue;
      seen.add(item.id);
      const formatted = formatTmdbItem(item);
      if (formatted && formatted.title) {
        items.push(formatted);
      }
    }

    // Сортируем по популярности
    items.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

    const result = {
      person: {
        id: data.id,
        name: data.name,
        photo: data.profile_path ? `${IMAGE_BASE}${data.profile_path}` : 'assets/avatar_default.svg',
        biography: data.biography || '',
        birthday: data.birthday || '',
        place_of_birth: data.place_of_birth || '',
        known_for: data.known_for_department === 'Directing' ? 'Режиссер' : 'Актер'
      },
      items: items.slice(0, 40)
    };

    setCache('tmdb', cacheKey, result, 7200);
    return result;
  } catch (err) {
    console.warn('Ошибка загрузки медиа персоны:', err.message);
    return { person: null, items: [] };
  }
}
