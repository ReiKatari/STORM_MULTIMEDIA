/**
 * Сервис интеграции с The Movie Database (TMDB)
 * Мировая база кино, сериалов и мультфильмов с постерами в высоком разрешении
 */

import { getCache, setCache } from '../db.js';

const TMDB_API_KEY = '4e44d9029b1270a757cddc766a1bcb63';
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
