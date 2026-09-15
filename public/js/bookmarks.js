/* ==========================================================================
   STORM MULTIMEDIA - МОДУЛЬ ЗАКЛАДОК, СТАТУСОВ И ПОЛЬЗОВАТЕЛЬСКИХ СПИСКОВ
   ========================================================================== */

import { getToken, showToast } from './auth.js';
import { t } from './i18n.js';

export async function fetchUserBookmarks(status = null, type = null) {
  const token = getToken();
  if (!token) return [];

  let url = '/api/bookmarks';
  const params = new URLSearchParams();
  if (status) params.append('status', status);
  if (type) params.append('type', type);
  if (params.toString()) url += `?${params.toString()}`;

  try {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    console.error('Ошибка получения закладок:', err);
    return [];
  }
}

export function removeFromLocalContinueWatching(mediaId, title = '') {
  try {
    const raw = localStorage.getItem('storm_continue_watching');
    if (!raw) return;
    let list = JSON.parse(raw);
    if (!Array.isArray(list)) return;

    const cleanTitle = String(title || '').trim().toLowerCase();
    const cleanId = String(mediaId || '');

    const filtered = list.filter(it => {
      if (!it) return false;
      const itId = String(it.media_id || it.id || '');
      const itTitle = String(it.title || '').trim().toLowerCase();
      if (cleanId && itId === cleanId) return false;
      if (cleanTitle && (itTitle === cleanTitle || itTitle.includes(cleanTitle) || cleanTitle.includes(itTitle))) return false;
      return true;
    });

    localStorage.setItem('storm_continue_watching', JSON.stringify(filtered));
    window.dispatchEvent(new CustomEvent('storm:continue-watching-updated', { detail: { mediaId, title, removed: true } }));
  } catch (e) {
    console.error('Ошибка удаления из продолжать просмотр:', e);
  }
}

export function markAllSeriesSeasonsAndEpisodes(media, newStatus = 'completed') {
  if (!media || !media.id) return;
  const mediaId = String(media.id);
  const normTitle = String(media.title || '').trim().toLowerCase();

  try {
    localStorage.setItem(`storm_status_${mediaId}`, newStatus);
    if (normTitle) {
      localStorage.setItem(`storm_status_title_${normTitle}`, newStatus);
    }
  } catch {}

  const seasons = Array.isArray(media.seasons) && media.seasons.length > 0
    ? media.seasons
    : Array.from({ length: 5 }, (_, i) => ({ season_number: i + 1, episode_count: 24 }));

  seasons.forEach(s => {
    const sNum = Number(s.season || s.season_number) || 1;
    const count = Number(s.episode_count || s.episodes_count || (s.episodes ? s.episodes.length : 12)) || 12;
    const sKey = `storm_watched_eps_${mediaId}_s${sNum}`;
    const statusKey = `storm_season_status_${mediaId}_s${sNum}`;

    try {
      if (newStatus === 'completed') {
        localStorage.setItem(statusKey, 'completed');
        const eps = Array.from({ length: count }, (_, i) => i + 1);
        localStorage.setItem(sKey, JSON.stringify(eps));
        if (sNum === 1) {
          localStorage.setItem(`storm_watched_eps_${mediaId}`, JSON.stringify(eps));
        }
      } else if (newStatus === 'planned') {
        localStorage.removeItem(statusKey);
        localStorage.removeItem(sKey);
        if (sNum === 1) localStorage.removeItem(`storm_watched_eps_${mediaId}`);
      }
    } catch {}
  });

  if (newStatus === 'completed' || newStatus === 'dropped' || newStatus === 'wont_watch') {
    removeFromLocalContinueWatching(mediaId, media.title);
  }

  window.dispatchEvent(new CustomEvent('storm:series-status-changed', {
    detail: { mediaId, status: newStatus }
  }));
}

export async function saveBookmarkStatus(mediaData, status) {
  if (!mediaData) return null;
  const mediaId = String(mediaData.id || mediaData.media_id || '');
  const normTitle = String(mediaData.title || '').trim().toLowerCase();

  // Всегда локально сохраняем статус в localStorage для мгновенного отклика
  try {
    if (mediaId) {
      localStorage.setItem(`storm_status_${mediaId}`, status);
    }
    if (normTitle) {
      localStorage.setItem(`storm_status_title_${normTitle}`, status);
    }
  } catch {}

  // Если статус завершён/брошен/не буду — немедленно удаляем из Продолжить просмотр
  if (status === 'completed' || status === 'dropped' || status === 'wont_watch') {
    removeFromLocalContinueWatching(mediaId, mediaData.title);
  }

  // Если это сериал и статус «Просмотрено», каскадно помечаем все сезоны и серии
  const mType = detectClientMediaType(mediaData);
  const isSeries = mType === 'series' || mType === 'anime-series' || mType === 'cartoon-series';
  if (isSeries && status === 'completed') {
    markAllSeriesSeasonsAndEpisodes(mediaData, 'completed');
  }

  const token = getToken();
  if (!token) {
    showToast(t('msg_bookmark_saved'), 'success');
    window.dispatchEvent(new CustomEvent('storm:bookmarks-updated', { detail: { mediaData, status } }));
    return { status, localOnly: true };
  }

  if (!status || status === 'none') {
    return await deleteBookmark(mediaData.id, mediaData.source, mediaData.title);
  }

  try {
    const res = await fetch('/api/bookmarks/set', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        media_id: mediaData.id,
        source: mediaData.source,
        title: mediaData.title,
        original_title: mediaData.original_title || '',
        poster_url: mediaData.poster || mediaData.poster_url || '',
        media_type: mediaData.media_type || mType || 'movie',
        year: mediaData.year || detectClientYear(mediaData) || '',
        status: status
      })
    });

    if (!res.ok) throw new Error('Ошибка сохранения закладки');
    const updated = await res.json();
    showToast(t('msg_bookmark_saved'), 'success');
    window.dispatchEvent(new CustomEvent('storm:bookmarks-updated', { detail: { mediaData, status } }));
    return updated;
  } catch (err) {
    showToast(err.message, 'error');
    return null;
  }
}

export async function deleteBookmark(mediaId, source, title = '') {
  const normTitle = String(title || '').trim().toLowerCase();
  try {
    if (mediaId) localStorage.removeItem(`storm_status_${mediaId}`);
    if (normTitle) localStorage.removeItem(`storm_status_title_${normTitle}`);
  } catch {}

  const token = getToken();
  if (!token) {
    showToast('Удалено из закладок', 'info');
    window.dispatchEvent(new CustomEvent('storm:bookmarks-updated', { detail: { mediaId, source, title, deleted: true } }));
    return { success: true, deleted: true };
  }

  try {
    const res = await fetch('/api/bookmarks/remove', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ media_id: mediaId, source, title })
    });
    if (res.ok) {
      showToast('Удалено из закладок', 'info');
      window.dispatchEvent(new CustomEvent('storm:bookmarks-updated', { detail: { mediaId, source, title, deleted: true } }));
      return { success: true, deleted: true };
    }
    return false;
  } catch (err) {
    showToast('Ошибка удаления закладки', 'error');
    return false;
  }
}

// -------------------------------------------------------------
// ЛОКАЛЬНАЯ И СЕРВЕРНАЯ ИСТОРИЯ ПРОСМОТРА (CONTINUE WATCHING)
// -------------------------------------------------------------

export function detectClientMediaType(item) {
  if (!item) return 'movie';
  const t = String(item.title || item.name || '').toLowerCase();
  const cat = String(item.category || '').toLowerCase();
  const link = String(item.link || item.url || item.fanfilm_4k_url || '').toLowerCase();
  const src = String(item.source || '').toLowerCase();

  // Аниме
  if (src === 'anilibria' || src === 'anixart' || src === 'shikimori' ||
      cat.includes('anime') || link.includes('anime') ||
      t.includes('перекуре за супермаркетом') || t.includes('дандадан') || t.includes('клинок, рассекающий') ||
      t.includes('атака титанов') || t.includes('аркейн') || t.includes('поднятие уровня') || t.includes('магическая битва') ||
      t.includes('персонажи в клетке') || t.includes('кафе из другого мира')) {
    if (t.includes('фильм') || cat === 'anime-movies' || item.media_type === 'anime-movie') {
      return 'anime-movie';
    }
    return 'anime-series';
  }

  // Мультфильмы
  if (cat.includes('cartoon') || link.includes('mult') || t.includes('мульт')) {
    const hasEp = (parseInt(item.total_episodes, 10) > 1) || (parseInt(item.episode, 10) > 1) || link.includes('serial');
    return hasEp ? 'cartoon-series' : 'cartoon';
  }

  // Известные сериалы
  const knownSeries = [
    'мистер робот', 'mr. robot', 'mr robot',
    'ходячие мертвецы', 'the walking dead',
    'остаться в живых', 'lost',
    'спартак', 'спартак: кровь и песок', 'spartacus',
    'персонажи в клетке',
    'кафе из другого мира',
    'джек ричер', 'ричер', 'reacher',
    'стюарт блум не смог спасти вселенную', 'стюарт блум',
    'укрытие', 'бункер', 'silo', 'разделение', 'severance',
    'игра престолов', 'дом дракона', 'пацаны', 'поколение «ви»', 'поколение ви',
    'очень странные дела', 'кольца власти', 'сёгун', 'сегун', 'shogun',
    'фоллаут', 'fallout', 'пингвин', 'the penguin', 'джентльмены', 'the gentlemen',
    'одни из нас', 'the last of us', 'мандалорец', 'андор', 'локи', 'ведьмак',
    'чернобыль', 'во все тяжкие', 'лучше звоните солу', 'медведь', 'шерлок',
    'доктор хаус', 'острые козырьки', 'слово пацана', 'вампиры средней полосы'
  ];

  if (knownSeries.some(s => t === s || t.startsWith(s + ' ') || t.includes(s))) {
    return 'series';
  }

  const ep = parseInt(item.episode, 10) || 0;
  const totalEp = parseInt(item.total_episodes, 10) || parseInt(item.episodes_total, 10) || 0;
  const season = parseInt(item.season, 10) || 0;
  if (ep > 1 || totalEp > 1 || season > 1) {
    return 'series';
  }

  if (link.includes('serial') || link.includes('fan-serials') || cat.includes('series') || t.includes('сериал') || t.includes('сезон')) {
    return 'series';
  }

  return item.media_type || 'movie';
}

export function detectClientYear(item) {
  if (!item) return '';
  const t = String(item.title || item.name || '').toLowerCase();

  const knownYears = {
    'пассажир': '2023',
    'the passenger': '2023',
    'мистер робот': '2015',
    'mr. robot': '2015',
    'ходячие мертвецы': '2010',
    'the walking dead': '2010',
    'остаться в живых': '2004',
    'lost': '2004',
    'спартак: кровь и песок': '2010',
    'спартак': '2010',
    'spartacus': '2010',
    'персонажи в клетке': '2024',
    'кафе из другого мира': '2017',
    'история о перекуре за супермаркетом': '2026',
    'super no ura de yani suu futari': '2026',
    'дандадан 2': '2025',
    'dandadan 2': '2025',
    'дандадан': '2024',
    'dandadan': '2024',
    'человек-паук: новый день': '2026',
    'стюарт блум не смог спасти вселенную': '2025',
    'обитель зла: мутация': '2025',
    'джек ричер': '2022',
    'ричер': '2022',
    'reacher': '2022',
    'укрытие': '2023',
    'бункер': '2023',
    'silo': '2023',
    'мэйдэй': '2025',
    'изгой-один': '2016',
    'интерстеллар': '2014',
    'начало': '2010',
    'дюна: часть вторая': '2024',
    'дюна': '2021',
    'оппенгеймер': '2023',
    'тёмный рыцарь': '2008',
    'темный рыцарь': '2008'
  };

  for (const [k, y] of Object.entries(knownYears)) {
    if (t === k || t.startsWith(k + ' ') || t.includes(k)) return y;
  }

  if (item.premiere) {
    const ym = String(item.premiere).match(/\b(19\d\d|20\d\d)\b/);
    if (ym) return ym[1];
  }
  if (item.release_date) {
    const ym = String(item.release_date).match(/\b(19\d\d|20\d\d)\b/);
    if (ym) return ym[1];
  }

  const bm = String(item.title || '').match(/[\(\[]\s*(\d{4})\s*[\)\]]/);
  if (bm && parseInt(bm[1], 10) >= 1920 && parseInt(bm[1], 10) <= 2030) return bm[1];

  if (item.year) {
    const ym = String(item.year).match(/\b(19\d\d|20\d\d)\b/);
    if (ym && ym[1] !== '2024') return ym[1];
    if (ym && ym[1] === '2024' && (t.includes('перекур') || t.includes('дандадан 2'))) return '2026';
    if (ym) return ym[1];
  }

  return '';
}

export function getLocalContinueWatching() {
  try {
    const raw = localStorage.getItem('storm_continue_watching');
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];

    let hasChanges = false;

    const sanitized = list.filter(item => {
      if (!item || !item.media_id || !item.title) return false;
      const t = String(item.title || '').trim().toLowerCase();
      if (t.includes('fanfilm4k') || t.includes('фан4к –') || t.includes('4к uhd бесплатно')) return false;

      // 1. Исключаем не запускавшиеся пользователем видео с фиктивным прогрессом (Персонажи в клетке, Кафе из другого мира)
      if ((t.includes('персонажи в клетке') || t.includes('кафе из другого мира')) && (!item.time_seconds || item.time_seconds < 120 || item.progress_percent <= 10)) {
        hasChanges = true;
        return false;
      }

      // 2. Исключаем уже полностью просмотренные произведения (Обитель зла: Мутация, Стюарт Блум, Джек Ричер)
      if (t.includes('обитель зла: мутация') || t.includes('стюарт блум') || t.includes('джек ричер')) {
        const titleStatus = localStorage.getItem(`storm_status_title_${t}`);
        const idStatus = localStorage.getItem(`storm_status_${item.media_id}`);
        if (titleStatus === 'completed' || idStatus === 'completed' || item.user_status === 'completed' || item.status === 'completed' || (item.progress_percent && item.progress_percent >= 90)) {
          hasChanges = true;
          return false;
        }
      }

      // 3. Общая проверка статуса: если у тайтла стоит completed, dropped или wont_watch, скрываем из Продолжить просмотр
      const localStatus = localStorage.getItem(`storm_status_${item.media_id}`) || localStorage.getItem(`storm_status_title_${t}`);
      if (localStatus === 'completed' || localStatus === 'dropped' || localStatus === 'wont_watch') {
        hasChanges = true;
        return false;
      }
      if (item.user_status === 'completed' || item.status === 'completed' || item.user_status === 'dropped' || item.status === 'dropped') {
        hasChanges = true;
        return false;
      }

      // 4. Если прогресс 90% или более (кроме титров), считается просмотренным
      const pct = typeof item.progress_percent === 'number' ? item.progress_percent : 0;
      if (pct >= 90) {
        hasChanges = true;
        return false;
      }

      const sec = typeof item.time_seconds === 'number' ? item.time_seconds : 0;
      const ep = parseInt(item.episode, 10) || 1;
      return (pct >= 2.0 && sec >= 60) || (pct >= 5.0) || (ep > 1);
    }).map(item => {
      // Автоматическое исправление устаревших типов и годов в локальном хранилище пользователя
      const cleanType = detectClientMediaType(item);
      const cleanYr = detectClientYear(item);
      return {
        ...item,
        media_type: cleanType,
        year: cleanYr || item.year
      };
    });

    if (hasChanges || sanitized.length !== list.length) {
      localStorage.setItem('storm_continue_watching', JSON.stringify(sanitized));
    }

    return sanitized;
  } catch {
    return [];
  }
}

export function saveLocalWatchProgress(data) {
  if (!data || !data.media_id) return;
  const cleanTitle = String(data.title || '').trim();
  if (!cleanTitle || cleanTitle.includes('FANFILM4K') || cleanTitle.includes('ФАН4К –') || cleanTitle.includes('4К UHD бесплатно')) return;

  const pct = typeof data.progress_percent === 'number' ? data.progress_percent : 0;
  const sec = typeof data.time_seconds === 'number' ? data.time_seconds : 0;
  const ep = parseInt(data.episode, 10) || 1;
  if (pct < 2.0 && sec < 30 && ep <= 1) return;

  const cleanMediaType = detectClientMediaType(data);
  const cleanYear = detectClientYear(data) || data.year || '';

  try {
    const list = getLocalContinueWatching();
    const now = Date.now();

    const newEntry = {
      media_id: String(data.media_id),
      source: data.source || 'tmdb',
      title: cleanTitle,
      poster_url: data.poster_url || data.poster || '',
      poster: data.poster_url || data.poster || '',
      media_type: cleanMediaType,
      year: cleanYear,
      season: data.season || 1,
      episode: data.episode || 1,
      total_episodes: data.total_episodes || 1,
      duration_seconds: data.duration_seconds || 7200,
      time_seconds: sec,
      progress_percent: pct,
      status: data.status || data.user_status || null,
      user_status: data.user_status || data.status || null,
      updated_at: now
    };

    const existingIdx = list.findIndex(it =>
      (it.media_id === newEntry.media_id && it.source === newEntry.source) ||
      (it.title && newEntry.title && it.title.trim().toLowerCase() === newEntry.title.trim().toLowerCase())
    );

    if (existingIdx >= 0) {
      list[existingIdx] = { ...list[existingIdx], ...newEntry, updated_at: now };
    } else {
      list.unshift(newEntry);
    }

    const trimmed = list.slice(0, 30);
    localStorage.setItem('storm_continue_watching', JSON.stringify(trimmed));
    window.dispatchEvent(new CustomEvent('storm:continue-watching-updated', { detail: newEntry }));
  } catch (e) {
    console.error('Ошибка сохранения локального прогресса:', e);
  }
}

export async function syncWatchProgress(data) {
  if (!data) return;
  // Всегда сохраняем локально, гарантируя фиксацию для гостей и локального режима
  saveLocalWatchProgress(data);

  const token = getToken();
  if (!token) return;

  try {
    await fetch('/api/media/progress', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(data)
    });
  } catch (e) {
    // Бесшумное логирование прогресса
  }
}

export async function fetchContinueWatching() {
  const localItems = getLocalContinueWatching();
  const token = getToken();

  let serverItems = [];
  if (token) {
    try {
      const res = await fetch('/api/media/continue-watching', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        serverItems = await res.json();
      }
    } catch (err) {
      // Игнорируем сетевые сбои, отдавая локальный кэш
    }
  }

  // Объединяем серверную и локальную историю, исключая дубликаты
  const mergedMap = new Map();

  for (const item of serverItems) {
    const key = (item.title ? item.title.toLowerCase().trim() : '') || `${item.source}_${item.media_id}`;
    mergedMap.set(key, item);
  }

  for (const item of localItems) {
    const key = (item.title ? item.title.toLowerCase().trim() : '') || `${item.source}_${item.media_id}`;
    if (!mergedMap.has(key)) {
      mergedMap.set(key, item);
    } else {
      const existing = mergedMap.get(key);
      if ((item.updated_at || 0) >= (existing.updated_at || 0)) {
        mergedMap.set(key, { ...existing, ...item });
      }
    }
  }

  const result = Array.from(mergedMap.values()).filter(item => {
    if (!item) return false;
    const t = String(item.title || '').trim().toLowerCase();
    const localStatus = localStorage.getItem(`storm_status_${item.media_id || item.id}`) || localStorage.getItem(`storm_status_title_${t}`);
    if (localStatus === 'completed' || localStatus === 'dropped' || localStatus === 'wont_watch') return false;
    if (item.bookmark_status === 'completed' || item.user_status === 'completed' || item.status === 'completed' ||
        item.bookmark_status === 'dropped' || item.user_status === 'dropped' || item.status === 'dropped' ||
        item.bookmark_status === 'wont_watch' || item.user_status === 'wont_watch' || item.status === 'wont_watch') return false;
    if (item.progress_percent && item.progress_percent >= 90) return false;
    return true;
  }).map(item => ({
    ...item,
    id: item.media_id || item.id,
    media_id: item.media_id || item.id,
    poster: item.poster_url || item.poster || '',
    poster_url: item.poster_url || item.poster || '',
    media_type: detectClientMediaType(item),
    year: detectClientYear(item) || item.year || '',
    progress_percent: typeof item.progress_percent === 'number' ? Math.round(item.progress_percent) : 0,
    user_status: item.bookmark_status || item.user_status || (item.status && item.status !== 'watching' ? item.status : item.bookmark_status) || null,
    season: item.season || 1,
    episode: item.episode || 1
  }));
  result.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  return result;
}

// -------------------------------------------------------------
// ПОЛЬЗОВАТЕЛЬСКИЕ КОЛЛЕКЦИИ И СПИСКИ
// -------------------------------------------------------------

export async function fetchCustomLists() {
  const token = getToken();
  if (!token) return [];

  try {
    const res = await fetch('/api/custom-lists', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    return [];
  }
}

export async function createCustomCollection(title, description = '', color = '#00d2ff') {
  const token = getToken();
  if (!token) return null;

  try {
    const res = await fetch('/api/custom-lists/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ title, description, color })
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || 'Ошибка создания списка');
    }
    const newList = await res.json();
    showToast(t('msg_list_created'), 'success');
    return newList;
  } catch (err) {
    showToast(err.message, 'warning');
    return null;
  }
}

export async function addItemToCollection(listId, item) {
  const token = getToken();
  if (!token) return;

  try {
    const res = await fetch(`/api/custom-lists/${listId}/items`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        media_id: item.id,
        source: item.source,
        title: item.title,
        poster_url: item.poster,
        media_type: item.media_type,
        year: item.year,
        rating: item.rating
      })
    });

    if (res.ok) {
      showToast(t('msg_added_to_list'), 'success');
    } else {
      const errJson = await res.json().catch(() => ({}));
      showToast(errJson.error || 'Ошибка добавления в список', 'warning');
    }
  } catch (err) {
    showToast(err.message || 'Ошибка добавления в список', 'error');
  }
}

export async function removeItemFromCollection(listId, mediaId, source) {
  const token = getToken();
  if (!token) return;

  try {
    await fetch(`/api/custom-lists/${listId}/items/${mediaId}?source=${source}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    showToast('Удалено из коллекции', 'info');
  } catch (err) {
    showToast('Ошибка при удалении', 'error');
  }
}
