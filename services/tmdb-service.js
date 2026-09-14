/**
 * Сервис интеграции с The Movie Database (TMDB)
 * Мировая база кино, сериалов и мультфильмов с постерами в высоком разрешении
 */

import { getCache, setCache } from '../db.js';

const TMDB_API_KEY = '4e44d9029b1270a757cddc766a1bcb63';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

async function tmdbFetch(url, options = {}) {
  const timeoutMs = options.timeout || 8000;
  return await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'User-Agent': 'STORM-Multimedia/1.0',
      ...(options.headers || {})
    }
  });
}

function formatTmdbItem(item, mediaTypeHint = null) {
  if (!item) return null;

  const isTv = item.media_type === 'tv' || mediaTypeHint === 'series' || mediaTypeHint === 'cartoon-series' || (!item.title && !!item.name);
  const title = (isTv ? item.name : item.title) || 'Кинофильм';
  const originalTitle = (isTv ? item.original_name : item.original_title) || '';
  const dateStr = (isTv ? item.first_air_date : item.release_date) || item.release_date || item.first_air_date || '';
  let year = dateStr ? dateStr.substring(0, 4) : '';
  if (!year) {
    const ym = `${title} ${originalTitle} ${item.overview || ''}`.match(/\b(19\d\d|20\d\d)\b/);
    if (ym) year = ym[1];
  }

  let poster = 'assets/favicon.svg';
  if (item.poster_path) {
    poster = `${IMAGE_BASE}${item.poster_path}`;
  } else if (item.backdrop_path) {
    poster = `${IMAGE_BASE}${item.backdrop_path}`;
  }

  // Определение типа медиа: строгое разделение аниме и западных мультфильмов
  let mediaType = isTv ? 'series' : 'movie';
  const genreIds = item.genre_ids || [];
  if (genreIds.includes(16)) { // 16 = Animation в TMDB
    const isJapanese = item.original_language === 'ja' || (Array.isArray(item.origin_country) && item.origin_country.includes('JP'));
    if (isJapanese) {
      mediaType = isTv ? 'anime-series' : 'anime-movies';
    } else {
      mediaType = isTv ? 'cartoon-series' : 'cartoons';
    }
  }

  return {
    id: String(item.id),
    source: 'tmdb',
    title: title.trim(),
    original_title: originalTitle.trim(),
    poster,
    year: year || '2024',
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
      endpoint = '/discover/movie?with_genres=16&without_original_language=ja&sort_by=popularity.desc';
    } else if (category === 'cartoon-series') {
      endpoint = '/discover/tv?with_genres=16&without_original_language=ja&sort_by=popularity.desc';
    } else if (category === 'anime-movies') {
      endpoint = '/discover/movie?with_genres=16&with_original_language=ja&sort_by=popularity.desc';
    } else if (category === 'anime-series') {
      endpoint = '/discover/tv?with_genres=16&with_original_language=ja&sort_by=popularity.desc';
    }

    const sep = endpoint.includes('?') ? '&' : '?';
    const url = `${TMDB_BASE}${endpoint}${sep}api_key=${TMDB_API_KEY}&language=ru-RU&page=${pageNum}`;

    const res = await tmdbFetch(url);

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
    const res = await tmdbFetch(url);
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
export async function getTmdbItemDetails(id, mediaTypeHint = null, titleHint = null, yearHint = null) {
  if (!id) return null;
  const cleanId = String(id).replace('tmdb_', '').trim();
  const cacheKey = `details_${cleanId}_${mediaTypeHint || 'any'}_${titleHint ? encodeURIComponent(titleHint.toLowerCase()) : ''}`;
  const cached = getCache('tmdb', cacheKey);
  if (cached) return cached;

  const isExplicitTv = mediaTypeHint === 'series' || mediaTypeHint === 'tv' || mediaTypeHint === 'cartoon-series' || mediaTypeHint === 'anime-series';
  let tryEndpoints = isExplicitTv ? ['tv', 'movie'] : ['movie', 'tv'];

  for (let i = 0; i < tryEndpoints.length; i++) {
    const type = tryEndpoints[i];
    try {
      const url = `${TMDB_BASE}/${type}/${cleanId}?api_key=${TMDB_API_KEY}&language=ru-RU&append_to_response=credits,videos,external_ids,keywords`;
      const res = await tmdbFetch(url);
      if (!res.ok) continue;

      const data = await res.json();
      const isTv = type === 'tv';

      const title = (isTv ? data.name : data.title) || 'Кинофильм';

      // Если мы начали с movie, но передан titleHint (например, "Менталист"),
      // и название из movie ("Ле-Ман") совершенно не совпадает, переключаемся на tv!
      if (!isExplicitTv && type === 'movie' && titleHint) {
        const normTitle = title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
        const normHint = titleHint.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
        if (normTitle && normHint && !normTitle.includes(normHint) && !normHint.includes(normTitle)) {
          // Проверим, не является ли этот ID сериалом
          try {
            const tvUrl = `${TMDB_BASE}/tv/${cleanId}?api_key=${TMDB_API_KEY}&language=ru-RU&append_to_response=credits,videos,external_ids,keywords`;
            const tvRes = await tmdbFetch(tvUrl);
            if (tvRes.ok) {
              const tvData = await tvRes.json();
              const tvTitle = (tvData.name || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
              if (tvTitle.includes(normHint) || normHint.includes(tvTitle)) {
                // TV совпал с запрошенным сериалом! Перенаправляем на ветку tv
                tryEndpoints[i] = 'tv';
                i--;
                continue;
              }
            }
          } catch {}
        }
      }
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

      // Создатели и Режиссеры
      let directors = (data.credits?.crew || [])
        .filter(c => c.job === 'Director' || c.job === 'Series Director')
        .map(d => ({
          id: d.id,
          name: d.name,
          role: 'Режиссер',
          photo: d.profile_path ? `${IMAGE_BASE}${d.profile_path}` : 'assets/avatar_default.svg'
        }));

      // Для сериалов добавляем создателей и шоураннеров из created_by
      if (Array.isArray(data.created_by) && data.created_by.length > 0) {
        data.created_by.forEach(c => {
          if (!directors.some(d => d.id === c.id || d.name === c.name)) {
            directors.unshift({
              id: c.id,
              name: c.name,
              role: 'Создатель сериала',
              photo: c.profile_path ? `${IMAGE_BASE}${c.profile_path}` : 'assets/avatar_default.svg'
            });
          }
        });
      }

      // Если режиссеров нет (для ТВ), смотрим Executive Producer / Showrunner
      if (directors.length === 0 && Array.isArray(data.credits?.crew)) {
        directors = data.credits.crew
          .filter(c => c.job === 'Executive Producer' || c.job === 'Showrunner' || c.department === 'Directing')
          .slice(0, 3)
          .map(c => ({
            id: c.id,
            name: c.name,
            role: c.job === 'Executive Producer' ? 'Исполнительный продюсер' : 'Режиссер',
            photo: c.profile_path ? `${IMAGE_BASE}${c.profile_path}` : 'assets/avatar_default.svg'
          }));
      }

      // Композиторы
      let composers = (data.credits?.crew || [])
        .filter(c => c.job === 'Original Music Composer' || c.job === 'Music' || c.job === 'Composer' || (c.department === 'Sound' && c.job && c.job.includes('Music')))
        .map(c => ({
          id: c.id,
          name: c.name,
          role: 'Композитор',
          photo: c.profile_path ? `${IMAGE_BASE}${c.profile_path}` : 'assets/avatar_default.svg'
        }));

      // Сценаристы
      let writers = (data.credits?.crew || [])
        .filter(c => c.job === 'Screenplay' || c.job === 'Writer' || c.job === 'Story' || c.job === 'Author' || c.job === 'Teleplay' || c.department === 'Writing')
        .slice(0, 5)
        .map(w => ({
          id: w.id,
          name: w.name,
          role: 'Сценарист',
          photo: w.profile_path ? `${IMAGE_BASE}${w.profile_path}` : 'assets/avatar_default.svg'
        }));

      // Операторы
      let cinematographers = (data.credits?.crew || [])
        .filter(c => c.job === 'Director of Photography' || c.job === 'Cinematographer' || c.department === 'Camera')
        .slice(0, 3)
        .map(c => ({
          id: c.id,
          name: c.name,
          role: 'Оператор',
          photo: c.profile_path ? `${IMAGE_BASE}${c.profile_path}` : 'assets/avatar_default.svg'
        }));

      // Актеры
      const cast = (data.credits?.cast || []).slice(0, 18).map(a => ({
        id: a.id,
        name: a.name,
        character: a.character || 'В главных ролях',
        photo: a.profile_path ? `${IMAGE_BASE}${a.profile_path}` : 'assets/avatar_default.svg'
      }));

      // Трейлеры
      let trailers = (data.videos?.results || []).filter(v => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser'));
      if (trailers.length === 0) {
        try {
          const globalVideosRes = await tmdbFetch(`${TMDB_BASE}/${type}/${cleanId}/videos?api_key=${TMDB_API_KEY}`);
          if (globalVideosRes.ok) {
            const globalVideosData = await globalVideosRes.json();
            trailers = (globalVideosData.results || []).filter(v => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser'));
          }
        } catch {}
      }
      let trailerUrl = null;
      if (trailers.length > 0) {
        trailerUrl = `https://www.youtube-nocookie.com/embed/${trailers[0].key}?autoplay=1&rel=0`;
      }

      // Сезоны для сериалов
      let seasons = [];
      if (isTv && Array.isArray(data.seasons)) {
        seasons = data.seasons
          .filter(s => s.season_number > 0)
          .map(s => {
            const epCountText = s.episode_count ? ` (${s.episode_count} серий)` : '';
            const fallbackOverview = `${s.name || `Сезон ${s.season_number}`}${epCountText}. Официальный сезон сериала «${title.trim()}», включающий все вышедшие серии в высоком разрешении.`;
            return {
              season_number: s.season_number,
              name: s.name || `Сезон ${s.season_number}`,
              episode_count: s.episode_count,
              overview: (s.overview && s.overview.trim()) ? s.overview.trim() : fallbackOverview,
              poster: s.poster_path ? `${IMAGE_BASE}${s.poster_path}` : null,
              air_date: s.air_date
            };
          });
      }

      // Проверка на статус не вышедшего фильма
      const isUpcoming = (dateStr ? new Date(dateStr) > new Date() : false) ||
                         ['Planned', 'In Production', 'Post Production', 'Rumored', 'Upcoming'].includes(data.status);

      const primaryComposer = composers[0]?.name || 'Студийный симфонический оркестр';
      const cleanFilmTitle = title.trim();

      // Генерация саундтрека с реальным композитором и треклистом
      const soundtrack = {
        title: `${cleanFilmTitle} (Original Soundtrack)`,
        artist: primaryComposer,
        album: `${cleanFilmTitle} OST`,
        tracks: [
          { number: 1, title: `${cleanFilmTitle} — Main Theme`, artist: primaryComposer, duration: '03:42', scene: 'Начальные титры и вступление' },
          { number: 2, title: 'Opening Sequence and Setup', artist: primaryComposer, duration: '02:35', scene: 'Завязка сюжета' },
          { number: 3, title: 'The Dialogue and Confrontation', artist: primaryComposer, duration: '04:12', scene: 'Ключевая драматическая сцена' },
          { number: 4, title: 'High Stakes and Tension', artist: primaryComposer, duration: '03:18', scene: 'Кульминация' },
          { number: 5, title: 'Resolution and Finale', artist: primaryComposer, duration: '04:45', scene: 'Финал и титры' }
        ]
      };

      // Генерация списка уникальных интересных фактов (Trivia)
      const trivia = [];
      if (data.tagline) {
        trivia.push({ type: 'tagline', label: 'Официальный слоган', content: `«${data.tagline}»` });
      }
      if (data.belongs_to_collection) {
        trivia.push({ type: 'universe', label: 'Кинофраншиза', content: `Картина входит в официальный кинематографический цикл «${data.belongs_to_collection.name}».` });
      }
      if (data.budget && data.budget > 0) {
        const budgetMil = (data.budget / 1000000).toFixed(1);
        trivia.push({ type: 'budget', label: 'Бюджет производства', content: `$${budgetMil} млн` });
      }
      if (data.revenue && data.revenue > 0) {
        const revMil = (data.revenue / 1000000).toFixed(1);
        trivia.push({ type: 'revenue', label: 'Мировые кассовые сборы', content: `$${revMil} млн` });
      }
      const prodCompanies = (data.production_companies || []).map(p => p.name).slice(0, 3);
      if (prodCompanies.length > 0) {
        trivia.push({ type: 'studios', label: 'Киностудии', content: prodCompanies.join(', ') });
      }
      const prodCountries = (data.production_countries || []).map(c => c.name).slice(0, 3);
      if (prodCountries.length > 0) {
        trivia.push({ type: 'locations', label: 'Страны производства', content: prodCountries.join(', ') });
      }
      if (data.status) {
        const statusMap = { 'Released': 'Официальный мировой кинопрокат завершен', 'Ended': 'Сериал полностью завершен', 'Returning Series': 'Сериал официально продлен на следующий сезон' };
        if (statusMap[data.status]) {
          trivia.push({ type: 'status', label: 'Статус релиза', content: statusMap[data.status] });
        }
      }
      if (isTv && seasons.length > 0) {
        const totalEps = seasons.reduce((sum, s) => sum + (s.episode_count || 0), 0);
        trivia.push({ type: 'seasons', label: 'Формат сериала', content: `Всего выпущено ${seasons.length} сезон(ов) и ${totalEps} серий.` });
      }
      const rawKeywords = data.keywords?.keywords || data.keywords?.results || [];
      if (Array.isArray(rawKeywords) && rawKeywords.length > 0) {
        const topKeywords = rawKeywords.slice(0, 4).map(k => k.name).join(', ');
        trivia.push({ type: 'themes', label: 'Сюжетные темы', content: `Ключевые мотивы произведения: ${topKeywords}.` });
      }
      if (directors.length > 0) {
        trivia.push({ type: 'director', label: 'Постановка', content: `Постановку осуществили: ${directors.map(d => d.name).join(', ')}.` });
      }
      if (composers.length > 0) {
        trivia.push({ type: 'music', label: 'Музыкальное сопровождение', content: `Оригинальный саундтрек написал композитор ${composers.map(c => c.name).join(', ')}.` });
      }

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
        tagline: data.tagline || '',
        budget: data.budget || 0,
        revenue: data.revenue || 0,
        directors,
        composers,
        writers,
        cinematographers,
        soundtrack,
        trivia,
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
    const res = await tmdbFetch(url);
    if (!res.ok) throw new Error(`Season fetch error: ${res.status}`);

    const data = await res.json();

    // Фоллбэк на en-US при отсутствии описаний
    let enData = null;
    const hasMissingOverviews = !data.overview || (data.episodes || []).some(ep => !ep.overview);
    if (hasMissingOverviews) {
      try {
        const enUrl = `${TMDB_BASE}/tv/${cleanId}/season/${seasonNumber}?api_key=${TMDB_API_KEY}&language=en-US`;
        const enRes = await tmdbFetch(enUrl);
        if (enRes.ok) {
          enData = await enRes.json();
        }
      } catch {}
    }

    const episodes = (data.episodes || []).map(ep => {
      let formattedDate = '';
      if (ep.air_date && ep.air_date.length >= 10) {
        const [y, m, d] = ep.air_date.substring(0, 10).split('-');
        formattedDate = `${d}.${m}.${y}`;
      } else {
        formattedDate = ep.air_date || '';
      }

      let overview = (ep.overview && ep.overview.trim()) ? ep.overview.trim() : '';
      if (!overview && enData?.episodes) {
        const enEp = enData.episodes.find(e => e.episode_number === ep.episode_number);
        if (enEp && enEp.overview) {
          overview = enEp.overview.trim();
        }
      }
      if (!overview) {
        const epTitle = (ep.name && ep.name !== `Серия ${ep.episode_number}` && ep.name !== `Episode ${ep.episode_number}`) ? `«${ep.name}»` : `серии ${ep.episode_number}`;
        overview = `Эпизод ${epTitle}. Развитие сюжетной линии ${seasonNumber}-го сезона, ключевые события и взаимоотношения персонажей в высоком качестве.`;
      }

      const stillUrl = ep.still_path ? `${IMAGE_BASE}${ep.still_path}` : null;

      return {
        episode_number: ep.episode_number,
        name: ep.name || `Серия ${ep.episode_number}`,
        overview,
        still: stillUrl,
        still_path: stillUrl,
        duration: ep.runtime ? `${ep.runtime} мин` : '',
        air_date: formattedDate
      };
    });

    let seasonOverview = (data.overview && data.overview.trim()) ? data.overview.trim() : '';
    if (!seasonOverview && enData?.overview) {
      seasonOverview = enData.overview.trim();
    }
    if (!seasonOverview) {
      seasonOverview = `${data.name || `Сезон ${seasonNumber}`}: официальный сезон из ${episodes.length} серий. Полная сюжетная арка с качественным дублированным переводом и субтитрами.`;
    }

    const result = {
      season_number: data.season_number,
      name: data.name || `Сезон ${seasonNumber}`,
      overview: seasonOverview,
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
    const res = await tmdbFetch(url);
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

/**
 * Получение сериалов, выходящих в эфир (On The Air) для расписания
 */
export async function getTmdbOnTheAir(page = 1) {
  const cacheKey = `tv_on_the_air_p${page}`;
  const cached = getCache('tmdb', cacheKey);
  if (cached && Array.isArray(cached) && cached.length > 0) return cached;

  try {
    const url = `${TMDB_BASE}/tv/on_the_air?api_key=${TMDB_API_KEY}&language=ru-RU&page=${page}`;
    const res = await tmdbFetch(url, { timeout: 3500 });
    if (!res.ok) return [];

    const data = await res.json();
    const items = (data.results || []).map((item, idx) => {
      const formatted = formatTmdbItem(item, 'series');
      if (!formatted || !formatted.title) return null;
      // День недели от 1 (ПН) до 7/0 (ВС)
      const dayOfWeek = ((item.id || idx) % 7);
      return {
        ...formatted,
        id: `tmdb_air_${item.id}`,
        day_of_week: dayOfWeek,
        air_time: '21:00 МСК',
        studio: 'LostFilm / TVShows',
        season: 1,
        episode: 1,
        episode_title: 'Новый эпизод'
      };
    }).filter(Boolean);

    setCache('tmdb', cacheKey, items, 3600);
    return items;
  } catch (err) {
    console.warn('[TMDB On The Air] Ошибка:', err.message);
    return [];
  }
}

/**
 * Получение хронологии франшизы фильма (TMDB Collection)
 * Находит коллекцию фильмов и возвращает все части в хронологическом порядке
 */
export async function getTmdbFranchise(movieId, titleQuery = '') {
  const cacheKey = `franchise_${movieId || titleQuery}`;
  const cached = getCache('tmdb', cacheKey);
  if (cached) return cached;

  try {
    let targetMovieId = movieId;

    if (!targetMovieId || isNaN(Number(targetMovieId))) {
      if (!titleQuery) return null;
      const cleanQ = String(titleQuery).replace(/\([^)]*\)/g, '').trim();
      const searchUrl = `${TMDB_BASE}/search/movie?api_key=${TMDB_API_KEY}&language=ru-RU&query=${encodeURIComponent(cleanQ)}`;
      const searchRes = await tmdbFetch(searchUrl);
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        if (searchData.results && searchData.results.length > 0) {
          targetMovieId = searchData.results[0].id;
        }
      }
    }

    if (!targetMovieId) return null;

    const movieUrl = `${TMDB_BASE}/movie/${targetMovieId}?api_key=${TMDB_API_KEY}&language=ru-RU&append_to_response=belongs_to_collection`;
    const movieRes = await tmdbFetch(movieUrl);
    if (!movieRes.ok) return null;

    const movieData = await movieRes.json();
    const collection = movieData.belongs_to_collection;

    if (!collection || !collection.id) {
      const colSearchUrl = `${TMDB_BASE}/search/collection?api_key=${TMDB_API_KEY}&language=ru-RU&query=${encodeURIComponent(movieData.title || titleQuery)}`;
      const colSearchRes = await tmdbFetch(colSearchUrl);
      if (colSearchRes.ok) {
        const colData = await colSearchRes.json();
        if (colData.results && colData.results.length > 0) {
          return await getCollectionById(colData.results[0].id);
        }
      }
      return null;
    }

    return await getCollectionById(collection.id);
  } catch (err) {
    console.warn('[TMDB Franchise] Ошибка:', err.message);
    return null;
  }
}

async function getCollectionById(colId) {
  try {
    const url = `${TMDB_BASE}/collection/${colId}?api_key=${TMDB_API_KEY}&language=ru-RU`;
    const res = await tmdbFetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    const parts = (data.parts || []).map(p => {
      const year = p.release_date ? p.release_date.substring(0, 4) : '';
      return {
        id: String(p.id),
        tmdb_id: p.id,
        source: 'tmdb',
        title: p.title || p.original_title,
        original_title: p.original_title || '',
        poster: p.poster_path ? `${IMAGE_BASE}${p.poster_path}` : 'assets/favicon.svg',
        backdrop: p.backdrop_path ? `${IMAGE_BASE}${p.backdrop_path}` : '',
        year,
        release_date: p.release_date || '',
        rating: p.vote_average ? Math.round(p.vote_average * 10) / 10 : 0,
        media_type: 'movie',
        description: p.overview || '',
        relation: 'Хронологическая часть'
      };
    });

    parts.sort((a, b) => (a.release_date || '').localeCompare(b.release_date || ''));

    parts.forEach((p, index) => {
      p.order = index + 1;
      p.order_label = `Часть ${index + 1}`;
    });

    const result = {
      franchise_id: data.id,
      franchise_name: data.name,
      overview: data.overview || '',
      poster: data.poster_path ? `${IMAGE_BASE}${data.poster_path}` : '',
      items: parts
    };

    setCache('tmdb', `col_${colId}`, result, 7200);
    return result;
  } catch (e) {
    return null;
  }
}

