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

export async function saveBookmarkStatus(mediaData, status) {
  const token = getToken();
  if (!token) {
    showToast('Войдите в систему для добавления в закладки', 'info');
    return null;
  }

  if (!status || status === 'none') {
    return await deleteBookmark(mediaData.id, mediaData.source);
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
        poster_url: mediaData.poster || '',
        media_type: mediaData.media_type || 'movie',
        year: mediaData.year || '',
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
  const token = getToken();
  if (!token) return false;

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
  const link = String(item.link || item.url || '').toLowerCase();
  const src = String(item.source || '').toLowerCase();

  // Аниме
  if (src === 'anilibria' || src === 'anixart' || src === 'shikimori' ||
      cat.includes('anime') || link.includes('anime') ||
      t.includes('перекуре за супермаркетом') || t.includes('дандадан') || t.includes('клинок, рассекающий') ||
      t.includes('атака титанов') || t.includes('аркейн') || t.includes('поднятие уровня') || t.includes('магическая битва')) {
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
    'история о перекуре за супермаркетом': '2026',
    'super no ura de yani suu futari': '2026',
    'дандадан 2': '2025',
    'dandadan 2': '2025',
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
    return list.filter(item => {
      if (!item || !item.media_id || !item.title) return false;
      const t = String(item.title || '');
      if (t.includes('FANFILM4K') || t.includes('ФАН4К –') || t.includes('4К UHD бесплатно')) return false;
      const pct = typeof item.progress_percent === 'number' ? item.progress_percent : 0;
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

  const result = Array.from(mergedMap.values()).map(item => ({
    ...item,
    id: item.media_id || item.id,
    media_id: item.media_id || item.id,
    poster: item.poster_url || item.poster || '',
    poster_url: item.poster_url || item.poster || '',
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
