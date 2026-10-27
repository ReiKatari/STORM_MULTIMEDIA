import { trackClientAction } from './achievements.js?v=1.3.1';
/* ==========================================================================
   STORM MULTIMEDIA - МОДУЛЬ ЗАКЛАДОК, СТАТУСОВ И ПОЛЬЗОВАТЕЛЬСКИХ СПИСКОВ
   ========================================================================== */

import { getToken, showToast } from './auth.js?v=1.3.1';
import { t } from './i18n.js?v=1.3.1';
import { normalizeStatus } from './status-icons.js?v=1.3.1';

let memoryBookmarksCache = [];

export function setMemoryBookmarksCache(bookmarks = []) {
  if (Array.isArray(bookmarks)) {
    memoryBookmarksCache = bookmarks;
    if (typeof window !== 'undefined') {
      window.__STORM_MEMORY_BOOKMARKS__ = bookmarks;
    }
  }
}

export function getMemoryBookmarksCache() {
  return memoryBookmarksCache;
}

export function normalizeSeriesTitleStorageKey(title = '') {
  return String(title || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s*[\(\[]\s*(?:постер|4[kк]|uhd|сериал|фильм|\d+\s*сезон|сезон\s*\d+|19\d\d|20\d\d).*?[\)\]]/gi, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

export function getSeriesCompletedMeta(mediaId, title = '') {
  try {
    if (mediaId) {
      const raw = localStorage.getItem(`storm_series_completed_meta_${mediaId}`);
      if (raw) return JSON.parse(raw);
    }
    const tKey = normalizeSeriesTitleStorageKey(title);
    if (tKey) {
      const rawByTitle = localStorage.getItem(`storm_series_completed_meta_title_${tKey}`);
      if (rawByTitle) return JSON.parse(rawByTitle);
    }
  } catch {}
  return null;
}

export function saveSeriesCompletedMeta(mediaId, meta = {}, title = '') {
  try {
    const toSave = {
      maxSeason: Number(meta.maxSeason) || 1,
      maxEpisode: Number(meta.maxEpisode) || 1,
      totalEpisodes: Number(meta.totalEpisodes) || 0,
      completedAt: meta.completedAt || Date.now()
    };
    const serialized = JSON.stringify(toSave);
    if (mediaId) {
      localStorage.setItem(`storm_series_completed_meta_${mediaId}`, serialized);
    }
    const tKey = normalizeSeriesTitleStorageKey(title);
    if (tKey) {
      localStorage.setItem(`storm_series_completed_meta_title_${tKey}`, serialized);
    }
  } catch {}
}

export function getWatchedEpisodesSummary(mediaId, title = '') {
  let highestSeason = 1;
  let highestEpisode = 0;
  let totalWatchedCount = 0;
  const watchedMap = new Map();
  const tKey = normalizeSeriesTitleStorageKey(title);

  try {
    for (let s = 1; s <= 30; s++) {
      const mergedSet = new Set();
      const rawId = mediaId ? (localStorage.getItem(`storm_watched_eps_${mediaId}_s${s}`) || (s === 1 ? localStorage.getItem(`storm_watched_eps_${mediaId}`) : null)) : null;
      const rawTitle = tKey ? localStorage.getItem(`storm_watched_eps_title_${tKey}_s${s}`) : null;
      for (const raw of [rawId, rawTitle]) {
        if (!raw) continue;
        try {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) {
            arr.map(Number).filter(n => !isNaN(n) && n > 0).forEach(n => mergedSet.add(n));
          }
        } catch {}
      }
      if (mergedSet.size > 0) {
        const numArr = Array.from(mergedSet);
        highestSeason = Math.max(highestSeason, s);
        const maxEp = Math.max(...numArr);
        if (s >= highestSeason) {
          highestEpisode = Math.max(highestEpisode, maxEp);
        }
        totalWatchedCount += numArr.length;
        watchedMap.set(s, mergedSet);
      }
    }
  } catch {}

  return { highestSeason, highestEpisode, totalWatchedCount, watchedMap };
}

export function hydrateBookmarkWatchedEpisodesToLocal(bookmark) {
  if (!bookmark || typeof bookmark !== 'object') return;
  try {
    const bId = String(bookmark.media_id || bookmark.id || '').trim();
    const rawTitle = String(bookmark.title || bookmark.original_title || '').trim();
    const normTitle = rawTitle.toLowerCase().replace(/\s*[\(\[]?\s*(?:4[kк]|uhd|сериал|фильм|\d+\s*сезон).*?[\)\]]?/gi, ' ').trim();
    const tKey = normalizeSeriesTitleStorageKey(rawTitle);
    const normSt = normalizeStatus(bookmark.status || bookmark.user_status || '');

    if (normSt && normSt !== 'none') {
      if (bId) localStorage.setItem(`storm_status_${bId}`, normSt);
      if (normTitle) localStorage.setItem(`storm_status_title_${normTitle}`, normSt);
    }

    if (!bookmark.watched_episodes_json || bookmark.watched_episodes_json === '{}') return;
    const parsed = typeof bookmark.watched_episodes_json === 'string'
      ? JSON.parse(bookmark.watched_episodes_json)
      : bookmark.watched_episodes_json;
    if (!parsed || typeof parsed !== 'object') return;

    if (parsed.seasons && typeof parsed.seasons === 'object') {
      for (const [sStr, epArr] of Object.entries(parsed.seasons)) {
        const sNum = Number(sStr) || 1;
        if (!Array.isArray(epArr)) continue;
        const cleanEps = Array.from(new Set(epArr.map(Number).filter(n => Number.isFinite(n) && n > 0))).sort((a, b) => a - b);
        const jsonStr = JSON.stringify(cleanEps);
        if (bId) {
          localStorage.setItem(`storm_watched_eps_${bId}_s${sNum}`, jsonStr);
          if (sNum === 1) localStorage.setItem(`storm_watched_eps_${bId}`, jsonStr);
        }
        if (tKey) {
          localStorage.setItem(`storm_watched_eps_title_${tKey}_s${sNum}`, jsonStr);
        }
      }
    }

    if (parsed.season_statuses && typeof parsed.season_statuses === 'object') {
      for (const [sStr, stVal] of Object.entries(parsed.season_statuses)) {
        const sNum = Number(sStr) || 1;
        if (!stVal) continue;
        if (bId) localStorage.setItem(`storm_season_status_${bId}_s${sNum}`, String(stVal));
        if (tKey) localStorage.setItem(`storm_season_status_title_${tKey}_s${sNum}`, String(stVal));
      }
    }

    if (parsed.completed_meta && typeof parsed.completed_meta === 'object') {
      saveSeriesCompletedMeta(bId, parsed.completed_meta, rawTitle);
    }
  } catch {}
}

export function serializeLocalWatchedEpisodesForMedia(mediaId, title = '', seasonsHint = []) {
  const bId = String(mediaId || '').trim();
  const tKey = normalizeSeriesTitleStorageKey(title);
  const seasonsObj = {};
  const seasonStatusesObj = {};
  let totalWatched = 0;
  let totalExpected = 0;

  if (Array.isArray(seasonsHint) && seasonsHint.length > 0) {
    seasonsHint.forEach(s => {
      const cnt = Number(s.episode_count || s.episodes_count || (Array.isArray(s.episodes) ? s.episodes.length : 0)) || 0;
      totalExpected += cnt;
    });
  }

  for (let s = 1; s <= 30; s++) {
    const merged = new Set();
    const rawId = bId ? (localStorage.getItem(`storm_watched_eps_${bId}_s${s}`) || (s === 1 ? localStorage.getItem(`storm_watched_eps_${bId}`) : null)) : null;
    const rawTitle = tKey ? localStorage.getItem(`storm_watched_eps_title_${tKey}_s${s}`) : null;
    for (const raw of [rawId, rawTitle]) {
      if (!raw) continue;
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          arr.map(Number).filter(n => Number.isFinite(n) && n > 0).forEach(n => merged.add(n));
        }
      } catch {}
    }
    if (merged.size > 0) {
      const sorted = Array.from(merged).sort((a, b) => a - b);
      seasonsObj[String(s)] = sorted;
      totalWatched += sorted.length;
    }
    const stVal = (bId ? localStorage.getItem(`storm_season_status_${bId}_s${s}`) : null) ||
                  (tKey ? localStorage.getItem(`storm_season_status_title_${tKey}_s${s}`) : null);
    if (stVal) {
      seasonStatusesObj[String(s)] = stVal;
    }
  }

  const completedMeta = getSeriesCompletedMeta(bId, title);
  return {
    payload: {
      seasons: seasonsObj,
      season_statuses: seasonStatusesObj,
      completed_meta: completedMeta || null
    },
    episodes_watched: totalWatched,
    total_episodes: totalExpected || Number(completedMeta?.totalEpisodes) || 0
  };
}

let _episodeSyncTimer = null;
export function syncWatchedEpisodesToServer(mediaData, overrideStatus = null, immediate = false) {
  if (!mediaData) return;
  const activeToken = getToken();
  if (!activeToken || activeToken.startsWith('offline_') || activeToken.startsWith('guest_')) return;

  const doSync = () => {
    try {
      const mediaId = String(mediaData.id || mediaData.media_id || '').trim();
      const title = String(mediaData.title || '').trim();
      if (!mediaId && !title) return;
      const seasonsArr = Array.isArray(mediaData.seasons) ? mediaData.seasons : [];
      const serialized = serializeLocalWatchedEpisodesForMedia(mediaId, title, seasonsArr);
      const statusToSend = overrideStatus
        ? normalizeStatus(overrideStatus)
        : (mediaData.user_status ? normalizeStatus(mediaData.user_status) : null);

      fetch('/api/bookmarks/episodes', {
        method: 'POST',
        headers: buildAuthHeaders(true),
        credentials: 'same-origin',
        body: JSON.stringify({
          media_id: mediaId,
          source: mediaData.source || 'tmdb',
          title,
          original_title: mediaData.original_title || '',
          poster_url: mediaData.poster || mediaData.poster_url || '',
          media_type: mediaData.media_type || 'series',
          year: mediaData.year || '',
          status: statusToSend,
          episodes_watched: serialized.episodes_watched,
          total_episodes: serialized.total_episodes || Number(mediaData.total_episodes) || 0,
          watched_episodes_json: serialized.payload
        })
      }).catch(() => {});
    } catch {}
  };

  if (immediate) {
    if (_episodeSyncTimer) clearTimeout(_episodeSyncTimer);
    doSync();
  } else {
    if (_episodeSyncTimer) clearTimeout(_episodeSyncTimer);
    _episodeSyncTimer = setTimeout(doSync, 220);
  }
}

if (typeof window !== 'undefined') {
  window.__stormNormalizeSeriesTitleKey = normalizeSeriesTitleStorageKey;
  window.__stormHydrateBookmarkEpisodes = hydrateBookmarkWatchedEpisodesToLocal;
  window.__stormSerializeWatchedEpisodes = serializeLocalWatchedEpisodesForMedia;
  window.__stormSyncWatchedEpisodesToServer = syncWatchedEpisodesToServer;
}

export function checkSeriesHasNewEpisodes(item) {
  if (!item) return null;
  const mediaId = String(item.id || item.media_id || '');
  if (!mediaId) return null;

  const mType = (typeof detectClientMediaType === 'function' ? detectClientMediaType(item) : null) || item.media_type || '';
  const isSeries = mType === 'series' || mType === 'anime-series' || mType === 'cartoon-series' ||
                   (Array.isArray(item.seasons) && item.seasons.length > 0) ||
                   Boolean(item.season || item.episode) ||
                   (item.title && /(?:сериал|сезон|серия)/i.test(item.title));

  if (!isSeries) return null;

  const summary = getWatchedEpisodesSummary(mediaId, item.title || item.original_title || '');
  const meta = getSeriesCompletedMeta(mediaId, item.title || item.original_title || '');

  const baselineSeason = Math.max(summary.highestSeason, meta?.maxSeason || 1);
  const baselineEpisode = meta?.maxSeason && meta.maxSeason > summary.highestSeason
    ? (meta.maxEpisode || 1)
    : Math.max(summary.highestEpisode, meta?.maxEpisode || 0);

  // 1. Проверка по массиву сезонов в item.seasons
  if (Array.isArray(item.seasons) && item.seasons.length > 0) {
    for (const s of item.seasons) {
      const sNum = Number(s.season || s.season_number || 0);
      const epCount = Number(s.episode_count || s.episodes_count || (Array.isArray(s.episodes) ? s.episodes.length : 0));
      if (sNum > baselineSeason && (epCount > 0 || !s.episode_count)) {
        return {
          hasNew: true,
          nextSeason: sNum,
          nextEpisode: 1,
          reason: 'new_season'
        };
      }
      if (sNum === baselineSeason && epCount > baselineEpisode && baselineEpisode > 0) {
        return {
          hasNew: true,
          nextSeason: sNum,
          nextEpisode: baselineEpisode + 1,
          reason: 'new_episode'
        };
      }
    }
  }

  // 2. Проверка по общему количеству серий
  const totalInItem = Number(item.total_episodes || item.episodes_count || 0);
  const metaTotal = Number(meta?.totalEpisodes || 0);
  if (totalInItem > 0) {
    if (metaTotal > 0 && totalInItem > metaTotal) {
      return {
        hasNew: true,
        nextSeason: baselineSeason,
        nextEpisode: baselineEpisode + 1,
        reason: 'total_increased'
      };
    }
    if (summary.totalWatchedCount > 0 && totalInItem > summary.totalWatchedCount) {
      return {
        hasNew: true,
        nextSeason: baselineSeason,
        nextEpisode: baselineEpisode + 1,
        reason: 'total_increased'
      };
    }
  }

  // 3. Проверка по номеру последней известной серии
  const lastEp = Number(item.last_episode || 0);
  if (lastEp > 0 && baselineEpisode > 0 && lastEp > baselineEpisode) {
    return {
      hasNew: true,
      nextSeason: baselineSeason,
      nextEpisode: baselineEpisode + 1,
      reason: 'last_episode_increased'
    };
  }

  return null;
}

export function autoTransitionSeriesToWatching(item, nextSeason = 1, nextEpisode = 1) {
  if (!item) return;
  const mediaId = String(item.id || item.media_id || '');
  if (!mediaId) return;
  const rawTitle = String(item.title || item.original_title || '').trim();
  const normTitle = rawTitle.toLowerCase().replace(/\s*[\(\[]?\s*(?:4[kк]|uhd|сериал|фильм|\d+\s*сезон).*?[\)\]]?/gi, ' ').trim();

  try {
    localStorage.setItem(`storm_status_${mediaId}`, 'watching');
    if (normTitle) {
      localStorage.setItem(`storm_status_title_${normTitle}`, 'watching');
    }
    syncLocalBookmarkItem(item, 'watching');
  } catch {}

  // Добавляем или обновляем карточку в Continue Watching со следующей непросмотренной серией
  try {
    const list = getLocalContinueWatching();
    const existingIdx = list.findIndex(it =>
      (it.media_id === mediaId && it.source === (item.source || 'all')) ||
      (it.title && item.title && it.title.trim().toLowerCase() === item.title.trim().toLowerCase())
    );

    const mType = (typeof detectClientMediaType === 'function' ? detectClientMediaType(item) : null) || item.media_type || 'series';
    const entry = {
      media_id: mediaId,
      source: item.source || 'all',
      title: item.title || '',
      poster: item.poster || item.poster_url || '',
      poster_url: item.poster || item.poster_url || '',
      media_type: mType,
      year: item.year || '',
      season: nextSeason,
      episode: nextEpisode,
      total_episodes: item.total_episodes || item.episodes_count || 10,
      duration_seconds: 2700,
      time_seconds: 0,
      progress_percent: 0,
      status: 'watching',
      user_status: 'watching',
      next_up: `С${nextSeason} • Э${nextEpisode}`,
      has_new_episodes: true,
      updated_at: Date.now()
    };

    if (existingIdx >= 0) {
      list[existingIdx] = { ...list[existingIdx], ...entry };
    } else {
      list.unshift(entry);
    }
    localStorage.setItem('storm_continue_watching', JSON.stringify(list.slice(0, 30)));
  } catch {}

  const token = getToken();
  if (token) {
    fetch('/api/bookmarks/set', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        media_id: mediaId,
        source: item.source || 'all',
        title: item.title,
        original_title: item.original_title || '',
        poster_url: item.poster || item.poster_url || '',
        media_type: item.media_type || 'series',
        year: item.year || '',
        status: 'watching'
      })
    }).catch(() => {});
  }

  window.dispatchEvent(new CustomEvent('storm:series-status-changed', {
    detail: { mediaId, status: 'watching', nextSeason, nextEpisode, hasNewEpisodes: true }
  }));
  window.dispatchEvent(new CustomEvent('storm:continue-watching-updated', {
    detail: { mediaId, hasNewEpisodes: true }
  }));
}

export function normalizeCanonicalTitleMatch(str = '') {
  return String(str || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s*[\(\[]\s*(?:4[kк]|uhd|hd|1080p|сериал|фильм|\d+\s*сезон|19\d\d|20\d\d).*?[\)\]]/gi, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function resolveMediaUserStatus(item) {
  if (!item) return null;
  const directStatus = item.user_status || item.bookmark_status;
  if (directStatus && directStatus !== 'none') return normalizeStatus(directStatus);
  if (item.status && ['completed', 'watching', 'planned', 'plan', 'favorite', 'on_hold', 'hold', 'dropped', 'wont_watch'].includes(item.status)) {
    return normalizeStatus(item.status);
  }

  const id = String(item.id || item.media_id || '');
  const strippedId = id.replace(/^[a-z]+_(?:up_|movie_|tv_|series_)?/i, '');
  let resolved = null;

  if (id) {
    const s = localStorage.getItem(`storm_status_${id}`) || (strippedId ? localStorage.getItem(`storm_status_${strippedId}`) : null);
    if (s && s !== 'none') resolved = s;
  }

  const rawTitle = String(item.title || '').trim();
  const origTitle = String(item.original_title || '').trim();
  const normTitle = rawTitle.toLowerCase().replace(/ё/g, 'е').replace(/\s*[\(\[]?\s*(?:4[kк]|uhd|сериал|фильм|\d+\s*сезон).*?[\)\]]?/gi, ' ').trim();
  const canonTitle = normalizeCanonicalTitleMatch(rawTitle);
  const canonOrig = normalizeCanonicalTitleMatch(origTitle);

  if (!resolved && (normTitle || canonTitle)) {
    const s = (normTitle && localStorage.getItem(`storm_status_title_${normTitle}`)) ||
              (rawTitle && localStorage.getItem(`storm_status_title_${rawTitle.toLowerCase()}`)) ||
              (canonTitle && localStorage.getItem(`storm_status_canon_${canonTitle}`)) ||
              (canonOrig && localStorage.getItem(`storm_status_canon_${canonOrig}`));
    if (s && s !== 'none') resolved = s;
  }

  if (!resolved && memoryBookmarksCache.length > 0) {
    const match = memoryBookmarksCache.find(b => {
      const bId = String(b.id || b.media_id || '');
      const bStripped = bId.replace(/^[a-z]+_(?:up_|movie_|tv_|series_)?/i, '');
      if (id && (bId === id || (strippedId && bStripped && strippedId === bStripped))) return true;
      const bCanon = normalizeCanonicalTitleMatch(b.title || '');
      const bOrigCanon = normalizeCanonicalTitleMatch(b.original_title || '');
      if (canonTitle && (bCanon === canonTitle || (bOrigCanon && bOrigCanon === canonTitle))) return true;
      if (canonOrig && (bOrigCanon === canonOrig || (bCanon && bCanon === canonOrig))) return true;
      return false;
    });
    if (match?.status && match.status !== 'none') {
      resolved = match.status;
    }
  }

  if (resolved) {
    resolved = normalizeStatus(resolved);
  }

  // Модель Emby и Plex:
  // Если статус сериала был «Просмотрено» (completed), но у релиза обнаружен новый сезон или новая серия —
  // статус АВТОМАТИЧЕСКИ переключается на «Смотрю» (watching)
  if (resolved === 'completed') {
    const newEpInfo = checkSeriesHasNewEpisodes(item);
    if (newEpInfo && newEpInfo.hasNew) {
      autoTransitionSeriesToWatching(item, newEpInfo.nextSeason, newEpInfo.nextEpisode);
      return 'watching';
    }
  }

  return resolved;
}

export function getLocalBookmarksList() {
  try {
    const raw = localStorage.getItem('storm_local_bookmarks');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

export function saveLocalBookmarksList(list) {
  try {
    if (Array.isArray(list)) {
      localStorage.setItem('storm_local_bookmarks', JSON.stringify(list));
    }
  } catch {}
}

export function syncLocalBookmarkItem(mediaData, status) {
  if (!mediaData) return;
  const list = getLocalBookmarksList();
  const mediaId = String(mediaData.id || mediaData.media_id || '');
  const normTitle = String(mediaData.title || '').trim().toLowerCase();

  let filtered = list.filter(it => {
    const itId = String(it.id || it.media_id || '');
    const itTitle = String(it.title || '').trim().toLowerCase();
    if (mediaId && itId === mediaId) return false;
    if (normTitle && itTitle === normTitle) return false;
    return true;
  });

  if (status && status !== 'none') {
    const mType = (typeof detectClientMediaType === 'function' ? detectClientMediaType(mediaData) : null) || mediaData.media_type || 'movie';
    const mYear = mediaData.year || (typeof detectClientYear === 'function' ? detectClientYear(mediaData) : '') || '';
    filtered.unshift({
      id: mediaId,
      media_id: mediaId,
      source: mediaData.source || 'all',
      title: mediaData.title || '',
      original_title: mediaData.original_title || '',
      poster: mediaData.poster || mediaData.poster_url || '',
      poster_url: mediaData.poster || mediaData.poster_url || '',
      media_type: mType,
      year: mYear,
      status: status,
      user_status: status,
      progress_percent: mediaData.progress_percent || 0,
      episodes_watched: mediaData.episodes_watched || 0,
      total_episodes: mediaData.total_episodes || 0,
      updated_at: Date.now()
    });
  }
  saveLocalBookmarksList(filtered);
}

const DB_CLEAN_REVISION = '2026-10-25-security-isolation-v3';
export function checkAndApplyClientPurge() {
  try {
    if (localStorage.getItem('storm_purge_rev') !== DB_CLEAN_REVISION) {
      localStorage.setItem('storm_purge_rev', DB_CLEAN_REVISION);
      localStorage.removeItem('storm_local_bookmarks');
      localStorage.removeItem('storm_continue_watching');
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('storm_status_') || k.startsWith('storm_watched_') || k.startsWith('storm_season_status_'))) {
          toRemove.push(k);
        }
      }
      toRemove.forEach(k => localStorage.removeItem(k));
      saveLocalBookmarksList([]);
      setMemoryBookmarksCache([]);
    }
  } catch (_) {}
}
checkAndApplyClientPurge();

function buildAuthHeaders(json = false) {
  const headers = {};
  if (json) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export async function fetchUserBookmarks(status = null, type = null) {
  let serverBookmarks = [];
  let serverAnswered = false;
  const activeToken = getToken();

  // 1. Запрос к серверу (только для авторизованного пользователя)
  if (activeToken && !activeToken.startsWith('offline_') && !activeToken.startsWith('guest_')) {
  try {
    let url = '/api/bookmarks';
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    if (type) params.append('type', type);
    if (params.toString()) url += `?${params.toString()}`;

    const res = await fetch(url, {
      headers: buildAuthHeaders(false),
      credentials: 'same-origin',
      signal: AbortSignal.timeout(4000)
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        serverBookmarks = data;
        serverAnswered = true;
      }
    }
  } catch (err) {
    console.warn('Серверные закладки недоступны, используем локальный кэш:', err.message);
  }
  }

  const localBookmarks = getLocalBookmarksList();

  // 2. Синхронизируем серверные закладки и статусы в локальный кэш и гидрируем просмотренные серии
  const mergedMap = new Map();
  for (const b of serverBookmarks) {
    if (!b) continue;
    hydrateBookmarkWatchedEpisodesToLocal(b);
    const bId = String(b.media_id || b.id || '').trim();
    const bNormStatus = normalizeStatus(b.status || b.user_status || '');
    const bTitleLow = String(b.title || '').trim().toLowerCase().replace(/ё/g, 'е');
    const bCanon = normalizeCanonicalTitleMatch(b.title || '');
    const bOrigCanon = normalizeCanonicalTitleMatch(b.original_title || '');
    try {
      if (bNormStatus && bNormStatus !== 'none') {
        if (bId) localStorage.setItem(`storm_status_${bId}`, bNormStatus);
        if (bTitleLow) localStorage.setItem(`storm_status_title_${bTitleLow}`, bNormStatus);
        if (bCanon) localStorage.setItem(`storm_status_canon_${bCanon}`, bNormStatus);
        if (bOrigCanon) localStorage.setItem(`storm_status_canon_${bOrigCanon}`, bNormStatus);
      }
    } catch (_) {}
    const key = bCanon || bTitleLow || `${b.source || ''}_${bId}`;
    if (key) mergedMap.set(key, b);
  }

  if (!serverAnswered) {
    for (const lb of localBookmarks) {
      if (!lb) continue;
      const lbCanon = normalizeCanonicalTitleMatch(lb.title || '');
      const key = lbCanon || (lb.title ? String(lb.title).toLowerCase().trim() : '') || `${lb.source || ''}_${lb.media_id || lb.id || ''}`;
      if (key && !mergedMap.has(key)) {
        mergedMap.set(key, lb);
      }
    }
  }

  let combined = Array.from(mergedMap.values());
  if (!status && !type && serverAnswered) {
    saveLocalBookmarksList(combined);
  }

  if (status) {
    const normQuery = normalizeStatus(status);
    if (normQuery === 'favorite') {
      combined = combined.filter(b => normalizeStatus(b.status) === 'favorite' || normalizeStatus(b.user_status) === 'favorite' || b.is_favorite === 1 || b.is_favorite === true);
    } else {
      combined = combined.filter(b => normalizeStatus(b.status) === normQuery || normalizeStatus(b.user_status) === normQuery);
    }
  }
  if (type) {
    combined = combined.filter(b => b.media_type === type);
  }

  setMemoryBookmarksCache(combined);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('storm:dynamic-state-sync', { detail: { bookmarksCount: combined.length } }));
  }
  return combined;
}

export function normalizeContinueTitleKey(title = '') {
  return String(title || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s*[\(\[][^\)\]]*[\)\]]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

export function isDismissedFromContinueWatching(mediaId, title = '') {
  try {
    const raw = localStorage.getItem('storm_dismissed_continue_v1');
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return false;
    const cleanId = String(mediaId || '').trim();
    const tKey = normalizeContinueTitleKey(title);
    return parsed.some(entry => {
      if (!entry) return false;
      if (cleanId && entry.id && String(entry.id) === cleanId) return true;
      if (tKey && entry.tKey && entry.tKey === tKey) return true;
      return false;
    });
  } catch {
    return false;
  }
}

export function setDismissedFromContinueWatching(mediaId, title = '', dismissed = true) {
  try {
    const cleanId = String(mediaId || '').trim();
    const tKey = normalizeContinueTitleKey(title);
    if (!cleanId && !tKey) return;
    let list = [];
    try {
      const raw = localStorage.getItem('storm_dismissed_continue_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) list = parsed;
      }
    } catch {}
    list = list.filter(entry => {
      if (!entry) return false;
      if (cleanId && entry.id && String(entry.id) === cleanId) return false;
      if (tKey && entry.tKey && entry.tKey === tKey) return false;
      return true;
    });
    if (dismissed) {
      list.unshift({ id: cleanId, tKey, ts: Date.now() });
      list = list.slice(0, 120);
    }
    localStorage.setItem('storm_dismissed_continue_v1', JSON.stringify(list));
  } catch {}
}

export function removeFromLocalContinueWatching(mediaId, title = '', source = '') {
  try {
    const cleanTitle = String(title || '').trim().toLowerCase();
    const tKey = normalizeContinueTitleKey(title);
    const cleanId = String(mediaId || '').trim();

    setDismissedFromContinueWatching(cleanId, title, true);
    if (typeof window !== 'undefined' && typeof window.cancelStormWatchProgressQueue === 'function') {
      try { window.cancelStormWatchProgressQueue(cleanId, title); } catch {}
    }
    if (cleanId) {
      try {
        localStorage.removeItem(`storm_resume_state_${cleanId}`);
        localStorage.removeItem(`storm_real_watchtime_${cleanId}`);
      } catch {}
    }
    if (tKey) {
      try { localStorage.removeItem(`storm_resume_state_title_${tKey}`); } catch {}
    }

    const raw = localStorage.getItem('storm_continue_watching');
    if (raw) {
      let list = JSON.parse(raw);
      if (Array.isArray(list)) {
        const filtered = list.filter(it => {
          if (!it) return false;
          const itId = String(it.media_id || it.id || '').trim();
          const itTitle = String(it.title || '').trim().toLowerCase();
          const itKey = normalizeContinueTitleKey(it.title || '');
          if (cleanId && itId === cleanId) return false;
          if (tKey && itKey && itKey === tKey) return false;
          if (cleanTitle && (itTitle === cleanTitle || itTitle.includes(cleanTitle) || cleanTitle.includes(itTitle))) return false;
          return true;
        });
        localStorage.setItem('storm_continue_watching', JSON.stringify(filtered));
      }
    }

    fetch('/api/media/continue-watching/remove', {
      method: 'POST',
      headers: buildAuthHeaders(true),
      credentials: 'same-origin',
      body: JSON.stringify({ media_id: cleanId, source: source || '', title: title || '' })
    }).catch(() => {});

    window.dispatchEvent(new CustomEvent('storm:continue-watching-updated', { detail: { mediaId: cleanId, title, removed: true } }));
  } catch (e) {
    console.error('Ошибка удаления из продолжать просмотр:', e);
  }
}

export function markAllSeriesSeasonsAndEpisodes(media, newStatus = 'completed') {
  if (!media || !(media.id || media.media_id)) return;
  const mediaId = String(media.id || media.media_id);
  const rawTitle = String(media.title || '').trim();
  const normTitle = rawTitle.toLowerCase();
  const tKey = normalizeSeriesTitleStorageKey(rawTitle);

  try {
    localStorage.setItem(`storm_status_${mediaId}`, newStatus);
    if (normTitle) {
      localStorage.setItem(`storm_status_title_${normTitle}`, newStatus);
    }
  } catch {}

  let defaultCount = 10;
  if (normTitle.includes('дандадан') || normTitle.includes('dandadan') || normTitle.includes('аниме')) {
    defaultCount = 12;
  } else if (normTitle.includes('укрытие') || normTitle.includes('бункер') || normTitle.includes('silo')) {
    defaultCount = 10;
  }

  const hasExactSeasons = Array.isArray(media.seasons) && media.seasons.length > 0;
  const seasons = hasExactSeasons
    ? media.seasons
    : Array.from({ length: 3 }, (_, i) => ({ season_number: i + 1, episode_count: defaultCount }));

  let maxSeasonNum = 1;
  let maxEpisodeNum = 1;
  let totalEpCount = 0;

  const applyForSeasons = (seasonsArr) => {
    maxSeasonNum = 1;
    maxEpisodeNum = 1;
    totalEpCount = 0;
    seasonsArr.forEach(s => {
      const sNum = Number(s.season || s.season_number) || 1;
      const count = Number(s.episode_count || s.episodes_count || (s.episodes ? s.episodes.length : defaultCount)) || defaultCount;
      maxSeasonNum = Math.max(maxSeasonNum, sNum);
      maxEpisodeNum = Math.max(maxEpisodeNum, count);
      totalEpCount += count;
      const sKey = `storm_watched_eps_${mediaId}_s${sNum}`;
      const statusKey = `storm_season_status_${mediaId}_s${sNum}`;

      try {
        if (newStatus === 'completed') {
          localStorage.setItem(statusKey, 'completed');
          if (tKey) localStorage.setItem(`storm_season_status_title_${tKey}_s${sNum}`, 'completed');
          const eps = Array.from({ length: count }, (_, i) => i + 1);
          const epsJson = JSON.stringify(eps);
          localStorage.setItem(sKey, epsJson);
          if (sNum === 1) localStorage.setItem(`storm_watched_eps_${mediaId}`, epsJson);
          if (tKey) localStorage.setItem(`storm_watched_eps_title_${tKey}_s${sNum}`, epsJson);
        } else if (newStatus === 'planned') {
          localStorage.removeItem(statusKey);
          localStorage.removeItem(sKey);
          if (sNum === 1) localStorage.removeItem(`storm_watched_eps_${mediaId}`);
          if (tKey) {
            localStorage.removeItem(`storm_season_status_title_${tKey}_s${sNum}`);
            localStorage.removeItem(`storm_watched_eps_title_${tKey}_s${sNum}`);
          }
        }
      } catch {}
    });

    if (newStatus === 'completed') {
      saveSeriesCompletedMeta(mediaId, {
        maxSeason: maxSeasonNum,
        maxEpisode: maxEpisodeNum,
        totalEpisodes: totalEpCount,
        completedAt: Date.now()
      }, rawTitle);
    }
  };

  applyForSeasons(seasons);

  // Если сериал помечен с карточки каталога без загруженного списка сезонов — уточняем точные сезоны/серии на сервере
  if (!hasExactSeasons && newStatus === 'completed' && rawTitle) {
    fetch(`/api/media/item?title=${encodeURIComponent(rawTitle)}&source=tmdb&media_type=series`, {
      headers: buildAuthHeaders(false),
      credentials: 'same-origin'
    })
      .then(r => (r.ok ? r.json() : null))
      .then(itemData => {
        if (itemData && Array.isArray(itemData.seasons) && itemData.seasons.length > 0) {
          applyForSeasons(itemData.seasons);
          syncWatchedEpisodesToServer({ ...media, seasons: itemData.seasons, user_status: 'completed' }, 'completed', true);
        }
      })
      .catch(() => {});
  }

  if (newStatus === 'completed' || newStatus === 'dropped' || newStatus === 'wont_watch') {
    removeFromLocalContinueWatching(mediaId, media.title, media.source || '');
  }

  window.dispatchEvent(new CustomEvent('storm:series-status-changed', {
    detail: { mediaId, status: newStatus }
  }));
}

export async function saveBookmarkStatus(mediaData, status) {
  if (!mediaData) return null;
  const normStatus = normalizeStatus(status);
  const mediaId = String(mediaData.id || mediaData.media_id || '');
  const normTitle = String(mediaData.title || '').trim().toLowerCase();

  // Всегда локально сохраняем статус в localStorage (включая канонический ключ названия) для мгновенного отклика
  try {
    if (mediaId) {
      localStorage.setItem(`storm_status_${mediaId}`, normStatus);
    }
    if (normTitle) {
      localStorage.setItem(`storm_status_title_${normTitle}`, normStatus);
    }
    const canonT = normalizeCanonicalTitleMatch(mediaData.title || '');
    const canonO = normalizeCanonicalTitleMatch(mediaData.original_title || '');
    if (canonT) localStorage.setItem(`storm_status_canon_${canonT}`, normStatus);
    if (canonO) localStorage.setItem(`storm_status_canon_${canonO}`, normStatus);
    syncLocalBookmarkItem(mediaData, normStatus);
    if (normStatus && normStatus !== 'none' && normStatus !== 'not_started') {
      const bList = getLocalBookmarksList();
      trackClientAction('add_bookmark', { total_bookmarks: bList.length });
      trackClientAction('update_status', { status: normStatus });
    }
  } catch {}

  // Если статус завершён/брошен/не буду — немедленно удаляем из Продолжить просмотр
  if (normStatus === 'completed' || normStatus === 'dropped' || normStatus === 'wont_watch') {
    removeFromLocalContinueWatching(mediaId, mediaData.title);
  }

  // Если это сериал и статус «Просмотрено», каскадно помечаем все сезоны и серии
  const mType = detectClientMediaType(mediaData);
  const isSeries = mType === 'series' || mType === 'anime-series' || mType === 'cartoon-series';
  if (isSeries && normStatus === 'completed') {
    markAllSeriesSeasonsAndEpisodes(mediaData, 'completed');
  }

  if (!status || status === 'none' || normStatus === 'not_started') {
    return await deleteBookmark(mediaData.id, mediaData.source, mediaData.title);
  }

  try {
    const serializedEpInfo = isSeries
      ? serializeLocalWatchedEpisodesForMedia(mediaId, mediaData.title || '', Array.isArray(mediaData.seasons) ? mediaData.seasons : [])
      : null;
    const res = await fetch('/api/bookmarks/set', {
      method: 'POST',
      headers: buildAuthHeaders(true),
      credentials: 'same-origin',
      body: JSON.stringify({
        media_id: mediaData.id,
        source: mediaData.source,
        title: mediaData.title,
        original_title: mediaData.original_title || '',
        poster_url: mediaData.poster || mediaData.poster_url || '',
        media_type: mediaData.media_type || mType || 'movie',
        year: mediaData.year || detectClientYear(mediaData) || '',
        status: normStatus,
        episodes_watched: serializedEpInfo ? serializedEpInfo.episodes_watched : (mediaData.episodes_watched || 0),
        total_episodes: serializedEpInfo ? (serializedEpInfo.total_episodes || mediaData.total_episodes || 0) : (mediaData.total_episodes || 0),
        watched_episodes_json: serializedEpInfo ? serializedEpInfo.payload : undefined,
        is_favorite: (normStatus === 'favorite' || mediaData.is_favorite === 1 || mediaData.is_favorite === true) ? 1 : (mediaData.is_favorite ? 1 : 0)
      })
    });

    if (!res.ok) {
      showToast(t('msg_bookmark_saved'), 'success');
      window.dispatchEvent(new CustomEvent('storm:bookmarks-updated', { detail: { mediaData, status: normStatus } }));
      return { status: normStatus, localOnly: true };
    }
    const updated = await res.json();
    showToast(t('msg_bookmark_saved'), 'success');
    window.dispatchEvent(new CustomEvent('storm:bookmarks-updated', { detail: { mediaData, status } }));
    return updated;
  } catch (err) {
    showToast(t('msg_bookmark_saved'), 'success');
    window.dispatchEvent(new CustomEvent('storm:bookmarks-updated', { detail: { mediaData, status: normStatus } }));
    return { status: normStatus, localOnly: true };
  }
}

export async function deleteBookmark(mediaId, source, title = '') {
  const normTitle = String(title || '').trim().toLowerCase();
  const canonT = normalizeCanonicalTitleMatch(title || '');
  try {
    if (mediaId) localStorage.removeItem(`storm_status_${mediaId}`);
    if (normTitle) localStorage.removeItem(`storm_status_title_${normTitle}`);
    if (canonT) localStorage.removeItem(`storm_status_canon_${canonT}`);
    syncLocalBookmarkItem({ id: mediaId, title }, 'none');
  } catch {}

  try {
    const res = await fetch('/api/bookmarks/remove', {
      method: 'DELETE',
      headers: buildAuthHeaders(true),
      credentials: 'same-origin',
      body: JSON.stringify({ media_id: mediaId, source, title })
    });
    showToast('Удалено из закладок', 'info');
    window.dispatchEvent(new CustomEvent('storm:bookmarks-updated', { detail: { mediaId, source, title, deleted: true } }));
    return { success: true, deleted: true };
  } catch (err) {
    showToast('Удалено из закладок', 'info');
    window.dispatchEvent(new CustomEvent('storm:bookmarks-updated', { detail: { mediaId, source, title, deleted: true } }));
    return { success: true, deleted: true };
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
  const src = String(item.source || item.provider || '').toLowerCase();

  // 0. Обитель зла: Мутация - строго фильм, не анимация!
  if (t.includes('обитель зла') && (t.includes('мутация') || t.includes('мутиция'))) {
    return 'movie';
  }

  // Дюна и Уличный боец (2026) - строго художественные фильмы
  if (t === 'дюна' || t.startsWith('дюна:') || t.startsWith('дюна ') || t.includes('дюна: часть') || t.includes('дюна часть') ||
      t === 'уличный боец' || t.startsWith('уличный боец ') || t === 'street fighter' || t.startsWith('street fighter ')) {
    return 'movie';
  }

  // Кэрри (2026) - сериал от Майка Флэнагана для Prime Video
  if (t === 'кэрри' || t.startsWith('кэрри ') || t.startsWith('кэрри:') || t === 'carrie' || t.startsWith('carrie ') || t.startsWith('carrie:')) {
    return 'series';
  }

  // 1. Известные анимационные фильмы (Вырождение, Вендетта и др.)
  const knownAnimatedMovies = [
    'обитель зла: вендетта', 'обитель зла вендетта', 'resident evil: vendetta',
    'обитель зла: вырождение', 'обитель зла вырождение', 'resident evil: degeneration',
    'обитель зла: проклятие', 'обитель зла проклятие', 'resident evil: damnation',
    'обитель зла: остров смерти', 'обитель зла остров смерти', 'resident evil: death island',
    'человек-паук: через вселенные', 'spider-man: into the spider-verse',
    'человек-паук: паутина вселенных', 'spider-man: across the spider-verse',
    'кот в сапогах', 'puss in boots', 'головоломка', 'inside out',
    'дикий робот', 'the wild robot', 'зверополис', 'zootopia',
    'кунг-фу панда', 'kung fu panda', 'как приручить дракона', 'how to train your dragon',
    'шрек', 'shrek', 'ледниковый период', 'ice age', 'гадкий я', 'despicable me',
    'тайна коко', 'coco', 'валли', 'wall-e', 'вверх', 'up', 'рататуй', 'ratatouille'
  ];
  if (knownAnimatedMovies.some(m => t === m || t.startsWith(m + ' ') || t.includes(m))) {
    return 'cartoon';
  }

  // 2. Известные мультсериалы (Рик и Морти, Симпсоны, Гриффины и др.)
  const knownCartoonSeries = [
    'рик и морти', 'rick and morty',
    'гриффины', 'family guy',
    'симпсоны', 'the simpsons',
    'южный парк', 'south park',
    'футурама', 'futurama',
    'гравити фолз', 'gravity falls',
    'время приключений', 'adventure time',
    'войны клонов', 'the clone wars',
    'человек-паук 1994', 'бэтмен 1992',
    'аватар: легенда об аанге', 'легенда об аанге', 'легенда о корре',
    'неуязвимый', 'invincible',
    'любовь, смерть и роботы', 'любовь смерть и роботы', 'love, death & robots',
    'губка боб', 'spongebob', 'первобытный', 'primal',
    'смешарики', 'фиксики', 'маша и медведь', 'аркейн', 'arcane'
  ];
  if (knownCartoonSeries.some(s => t === s || t.startsWith(s + ' ') || t.includes(s))) {
    return 'cartoon-series';
  }

  // Аниме
  if (src === 'anilibria' || src === 'anixart' || src === 'shikimori' ||
      cat.includes('anime') || link.includes('anime') ||
      t.includes('перекуре за супермаркетом') || t.includes('дандадан') || t.includes('клинок, рассекающий') ||
      t.includes('атака титанов') || t.includes('аркейн') || t.includes('поднятие уровня') || t.includes('магическая битва') ||
      t.includes('персонажи в клетке') || t.includes('кафе из другого мира')) {
    if (t.includes('фильм') || t.includes('резе') || t.includes('reze') || cat === 'anime-movies' || cat === 'anime-movie' || cat === 'аниме-фильм' || item.media_type === 'anime-movie' || item.media_type === 'anime-movies' || item.kind === 'movie' || item.is_movie) {
      return 'anime-movie';
    }
    return 'anime-series';
  }

  // Мультфильмы
  if (cat.includes('cartoon') || link.includes('mult') || t.includes('мульт')) {
    const hasEp = (parseInt(item.total_episodes, 10) > 1) || (parseInt(item.episode, 10) > 1) || link.includes('serial');
    return hasEp ? 'cartoon-series' : 'cartoon';
  }

  if (item.media_type === 'series' || item.type === 'series' || item.type === 'tv' || item.isSeries || cat === 'series' || cat === 'serial') {
    return 'series';
  }

  // Известные сериалы
  const knownSeries = [
    'мистер робот', 'mr. robot', 'mr robot',
    'ходячие мертвецы', 'the walking dead',
    'остаться в живых', 'lost',
    'спартак', 'спартак: кровь и песок', 'spartacus',
    'новичок', 'the rookie',
    'извне', 'from',
    'декстер', 'dexter', 'декстер: первородный грех', 'dexter: original sin', 'декстер: новая кровь', 'dexter: new blood',
    'медленные лошади', 'slow horses',
    'йеллоустоун', 'yellowstone',
    'мэр кингстауна', 'mayor of kingstown',
    'кобра кай', 'cobra kai',
    'сопрано', 'клан сопрано', 'the sopranos',
    'прослушка', 'the wire',
    'игра в кальмара', 'squid game',
    'секретные материалы', 'the x-files',
    'персонажи в клетке',
    'кафе из другого мира',
    'джек ричер', 'ричер', 'reacher',
    'стюарт блум не смог спасти вселенную', 'стюарт блум',
    'укрытие', 'бункер', 'silo', 'разделение', 'severance',
    'игра престолов', 'дом дракона', 'house of the dragon', 'пацаны', 'the boys', 'поколение «ви»', 'поколение ви', 'gen v',
    'очень странные дела', 'stranger things', 'кольца власти', 'сёгун', 'сегун', 'shogun',
    'фоллаут', 'fallout', 'пингвин', 'the penguin', 'джентльмены', 'the gentlemen',
    'одни из нас', 'the last of us', 'мандалорец', 'андор', 'локи', 'ведьмак', 'the witcher',
    'чернобыль', 'во все тяжкие', 'breaking bad', 'лучше звоните солу', 'better call saul', 'медведь', 'the bear', 'шерлок',
    'доктор хаус', 'острые козырьки', 'peaky blinders', 'настоящий детектив', 'фарго', 'мир дикого запада', 'тьма', 'dark',
    'чёрное зеркало', 'черное зеркало', 'black mirror', 'сверхъестественное', 'supernatural', 'викинги', 'vikings',
    'слово пацана', 'вампиры средней полосы', 'триггер', 'метод', 'мажор',
    'кухня', 'интерны', 'эпидемия', 'фишер', 'корона', 'the crown', 'уэнсдэй', 'уэнсдей', 'wednesday', 'миротворец',
    'бумажный дом', 'money heist', 'озарк', 'ozark', 'академия амбрелла', 'the umbrella academy',
    'ганнибал', 'hannibal', 'гримм', 'grimm', 'бесстыжие', 'shameless', 'ривердейл', 'riverdale', 'эйфория', 'euphoria',
    'друзья', 'friends', 'офис', 'the office', 'клиника', 'scrubs', 'универ', 'реальные пацаны', 'след', 'глухарь', 'невский',
    'король талсы', 'tulsa king', 'основание', 'foundation',
    'целую, китти', 'целую китти', 'xo, kitty', 'xo kitty',
    'голяк', 'brassic',
    'рыцарь семи королевств', 'a knight of the seven kingdoms',
    'сорвиголова: рождённый заново', 'сорвиголова: рожденный заново', 'daredevil: born again',
    'гангстерленд', 'mobland',
    'белый лотос', 'the white lotus',
    'монстры', 'монстр', 'монстр: история джеффри дамера', 'монстры: история', 'монстры: история лайла и эрика менендес', 'monsters', 'monster: the jeffrey dahmer story', 'monsters: the lyle and erik menendez story',
    'менталист', 'the mentalist', 'mentalist',
    'дневники вампира', 'the vampire diaries', 'vampire diaries', 'первородные', 'the originals', 'наследие', 'legacies',
    'побег', 'побег из тюрьмы', 'prison break',
    'анатомия страсти', "grey's anatomy", 'greys anatomy',
    'форс-мажоры', 'suits', 'миллиарды', 'billions', 'наследники', 'succession',
    'черный список', 'чёрный список', 'the blacklist', 'карточный домик', 'house of cards',
    'вечность', 'forever', 'как я встретил вашу маму', 'how i met your mother',
    'американская история ужасов', 'american horror story', 'американская история преступлений', 'american crime story',
    'большая маленькая ложь', 'big little lies', 'молодой папа', 'the young pope', 'новый папа', 'the new pope',
    'сыны анархии', 'sons of anarchy', 'щит', 'the shield', 'блудливая калифорния', 'californication',
    'безумцы', 'mad men', 'родина', 'homeland', '24 часа', '24', 'герои', 'heroes', 'сотня', 'the 100',
    'стрела', 'arrow', 'флэш', 'the flash', 'готэм', 'gotham', 'тайны смолвиля', 'smallville',
    'доктор кто', 'doctor who', 'лютер', 'luther', 'мост', 'the bridge',
    'кэрри', 'carrie'
  ];

  // Защита от мультфильмов со словом монстр/монстры
  const isMonsterCartoonOrMovie = [
    'корпорация монстров', 'университет монстров', 'монстры на каникулах', 
    'монстры против пришельцев', 'миньоны и монстры', 'монстр траки', 'монстро'
  ].some(m => t === m || t.startsWith(m + ' ') || t.includes(m));

  if (!isMonsterCartoonOrMovie) {
    if (t === 'монстры' || t.startsWith('монстры ') || t.startsWith('монстры:') ||
        t === 'монстр' || t.startsWith('монстр ') || t.startsWith('монстр:') ||
        t === 'monsters' || t.startsWith('monsters ') || t === 'monster' || t.startsWith('monster ') ||
        link.includes('monstr-istorija') || link.includes('menendez') || link.includes('dahmer')) {
      return 'series';
    }
  }

  if (t.includes('менталист') || t.includes('mentalist') || link.includes('mentalist')) {
    return 'series';
  }
  if (t.includes('дневники вампира') || t.includes('vampire diaries') || link.includes('dnevniki-vampira')) {
    return 'series';
  }

  if (knownSeries.some(s => t === s || t.startsWith(s + ' ') || t.includes(s))) {
    return 'series';
  }

  // Если это явный фильм - не считаем его сериалом из-за season: 1 или episode: 1
  const isExplicitMovie = (item.media_type === 'movie' || item.type === 'movie' || cat === 'фильм' || cat === 'movie' || item.category === 'Фильм');
  if (isExplicitMovie) {
    if ((parseInt(item.total_episodes, 10) || 0) <= 1 && (parseInt(item.season, 10) || 0) <= 1 && (!Array.isArray(item.seasons) || item.seasons.length <= 1)) {
      return 'movie';
    }
  }

  const ep = parseInt(item.episode, 10) || 0;
  const totalEp = parseInt(item.total_episodes, 10) || parseInt(item.episodes_total, 10) || 0;
  const season = parseInt(item.season, 10) || 0;
  if (ep > 1 || totalEp > 1 || season > 1 || (Array.isArray(item.seasons) && item.seasons.length > 1) || (Array.isArray(item.episodes) && item.episodes.length > 1)) {
    return 'series';
  }

  if (link.includes('serial') || link.includes('fan-serials') || cat.includes('series') || cat.includes('сериал') || t.includes('сериал') || t.includes('сезон') || /сезон\s*\d+/i.test(t)) {
    return 'series';
  }

  return item.media_type || 'movie';
}

export function detectClientYear(item) {
  if (!item) return '';
  const rawTitle = String(item.title || item.name || '');
  const t = rawTitle
    .toLowerCase()
    .replace(/[«»"'`]/g, '')
    .replace(/[:—–-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const knownYears = {
    // 2026
    'уличный боец': '2026',
    'street fighter': '2026',
    'история о перекуре за супермаркетом': '2026',
    'super no ura de yani suu futari': '2026',
    'человек паук новый день': '2026',
    'spider man brand new day': '2026',
    'проект конец света': '2026',
    'закулисье реальности': '2026',
    'хитрый койот': '2026',
    'миньоны и монстры': '2026',
    'бэтмен падение рыцаря': '2026',
    'аватар аанг последний маг воздуха': '2026',
    'легенда об аанге': '2026',
    'прыгуны': '2026',
    'робоцып спецвыпуск adult swim': '2026',
    'goat мечтай по крупному': '2026',
    'история игрушек 5': '2026',
    'одиссея': '2026',
    'мандалорец и грогу': '2026',
    'мстители судный день': '2026',
    'бэтмен часть 2': '2026',
    'бэтмен 2': '2026',

    // 2025
    'аватар 3 пламя и пепел': '2025',
    'аватар пламя и пепел': '2025',
    'аватар 3': '2025',
    'хищник планета смерти': '2025',
    'планета смерти': '2025',
    'стюарт блум не смог спасти вселенную': '2025',
    'обитель зла мутация': '2025',
    'дандадан 2': '2025',
    'dandadan 2': '2025',
    'человек бензопила фильм история резе': '2025',
    'человек бензопила история резе': '2025',
    'история резе': '2025',
    'зверополис 2': '2025',
    'мэйдэй': '2025',
    'mayday': '2025',
    'супермен': '2025',
    'микки 17': '2025',
    '28 лет спустя': '2025',
    'балерина': '2025',
    'иллюзия обмана 3': '2025',
    'франкенштейн': '2025',
    'дракула': '2025',
    'обезьяна': '2025',

    // 2024
    'персонажи в клетке': '2024',
    'дандадан': '2024',
    'dandadan': '2024',
    'укрытие 2 сезон': '2024',
    'сёгун': '2024',
    'сегун': '2024',
    'shogun': '2024',
    'фоллаут': '2024',
    'fallout': '2024',
    'пингвин': '2024',
    'the penguin': '2024',
    'джентльмены': '2024',
    'the gentlemen': '2024',
    'дюна часть вторая': '2024',
    'дэдпул и росомаха': '2024',
    'гладиатор 2': '2024',
    'дикий робот': '2024',
    'головоломка 2': '2024',
    'кунг фу панда 4': '2024',
    'падение империи': '2024',
    'субстанция': '2024',
    'ужасающий 3': '2024',
    'джокер безумие на двоих': '2024',
    'тихое место день первый': '2024',
    'чужой ромул': '2024',
    'соник 3 в кино': '2024',
    'муфаса король лев': '2024',
    'носферату': '2024',
    'веном последний танец': '2024',
    'битлджус битлджус': '2024',
    'фуриоса хроники безумного макса': '2024',
    'гадкий я 4': '2024',
    'мастер и маргарита': '2024',
    'майор гром игра': '2024',
    'сто лет тому вперед': '2024',
    'сто лет тому вперёд': '2024',
    'холоп 2': '2024',

    // 2023
    'я не киллер': '2023',
    'hit man': '2023',
    'пассажир': '2023',
    'the passenger': '2023',
    'укрытие': '2023',
    'бункер': '2023',
    'silo': '2023',
    'поколение ви': '2023',
    'одни из нас': '2023',
    'the last of us': '2023',
    'оппенгеймер': '2023',
    'чебурашка': '2023',
    'по щучьему велению': '2023',
    'вызов': '2023',
    'кентавр': '2023',
    'поехавшая': '2023',
    'праведник': '2023',
    'снегирь': '2023',

    // 2022 и классика
    'джек ричер': '2022',
    'ричер': '2022',
    'reacher': '2022',
    'разделение': '2022',
    'severance': '2022',
    'дом дракона': '2022',
    'властелин колец кольца власти': '2022',
    'аватар 2 путь воды': '2022',
    'аватар 2': '2022',
    'аватар путь воды': '2022',
    'avatar the way of water': '2022',
    'avatar 2': '2022',
    'кот в сапогах 2': '2022',
    'скуби ду шалость или сладость': '2022',
    'звёздные войны видения': '2021',
    'звездные войны видения': '2021',
    'star wars visions': '2021',
    'дюна': '2021',
    'локи': '2021',
    'пацаны': '2019',
    'мандалорец': '2019',
    'ведьмак': '2019',
    'чернобыль': '2019',
    'кафе из другого мира': '2017',
    'isekai shokudou': '2017',
    'очень странные дела': '2016',
    'изгой один': '2016',
    'angry birds в кино': '2016',
    'мистер робот': '2015',
    'mr robot': '2015',
    'слуга народа': '2015',
    'интерстеллар': '2014',
    'игра престолов': '2011',
    'кот в сапогах': '2011',
    'тачки 2': '2011',
    'ходячие мертвецы': '2010',
    'the walking dead': '2010',
    'спартак кровь и песок': '2010',
    'спартак': '2010',
    'spartacus': '2010',
    'начало': '2010',
    'аватар': '2009',
    'тёмный рыцарь': '2008',
    'темный рыцарь': '2008',
    'тачки': '2006',
    'остаться в живых': '2004',
    'lost': '2004',
    'суперсемейка': '2004'
  };

  const sortedEntries = Object.entries(knownYears).sort((a, b) => b[0].length - a[0].length);
  for (const [k, y] of sortedEntries) {
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

  const bm = rawTitle.match(/[\(\[]\s*(\d{4})\s*[\)\]]/);
  if (bm && parseInt(bm[1], 10) >= 1920 && parseInt(bm[1], 10) <= 2030) return bm[1];

  const linkStr = String(item.link || item.url || item.fanfilm_4k_url || '');
  if (linkStr) {
    const lm = linkStr.match(/(?:-|_|\/|\b)(19\d\d|20\d\d)(?:\.html|\/|$)/);
    if (lm && parseInt(lm[1], 10) >= 1920 && parseInt(lm[1], 10) <= 2030) return lm[1];
  }

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

    const seenTitleKeys = new Set();
    const sanitized = list.filter(item => {
      if (!item || !item.media_id || !item.title) return false;
      if (isDismissedFromContinueWatching(item.media_id || item.id, item.title)) {
        hasChanges = true;
        return false;
      }
      const tKey = normalizeContinueTitleKey(item.title);
      if (tKey) {
        if (seenTitleKeys.has(tKey)) {
          hasChanges = true;
          return false;
        }
        seenTitleKeys.add(tKey);
      }
      const t = String(item.title || '').trim().toLowerCase();
      if (t.includes('fanfilm4k') || t.includes('фан4к –') || t.includes('4к uhd бесплатно')) return false;

      // 1. Исключаем не запускавшиеся пользователем видео с фиктивным прогрессом и нежелательные фантомы
      if (t.includes('старик из деревни') || t.includes('святым мечом') || t.includes('katainaka') ||
          ((t.includes('персонажи в клетке') || t.includes('кафе из другого мира')) && (!item.time_seconds || item.time_seconds < 120 || item.progress_percent <= 10))) {
        hasChanges = true;
        return false;
      }

      // 2. Исключаем уже полностью просмотренные произведения
      const localStatus = localStorage.getItem(`storm_status_${item.media_id}`) || localStorage.getItem(`storm_status_title_${t}`);
      if (localStatus === 'completed' || localStatus === 'dropped' || localStatus === 'wont_watch') {
        hasChanges = true;
        return false;
      }
      if (item.user_status === 'completed' || item.status === 'completed' || item.user_status === 'dropped' || item.status === 'dropped') {
        hasChanges = true;
        return false;
      }

      // 3. Если прогресс 90% или более и это фильм, считается просмотренным
      const pct = typeof item.progress_percent === 'number' ? item.progress_percent : 0;
      if (pct >= 90) {
        hasChanges = true;
        return false;
      }

      const sec = typeof item.time_seconds === 'number' ? item.time_seconds : 0;
      const realSec = typeof item.real_watched_seconds === 'number' ? item.real_watched_seconds : sec;
      if (sec < 600 || realSec < 600) {
        hasChanges = true;
        return false;
      }
      return true;
    }).map(item => {
      const cleanType = detectClientMediaType(item);
      const cleanYr = detectClientYear(item);
      const s = parseInt(item.season, 10) || 1;
      const ep = parseInt(item.episode, 10) || 1;
      const isSeries = cleanType === 'series' || cleanType === 'anime-series' || cleanType === 'cartoon-series' || cleanType === 'tv' || s > 1 || ep > 1;
      const nextUpText = isSeries ? `С${s} • Э${ep}` : '';
      return {
        ...item,
        media_type: cleanType,
        year: cleanYr || item.year,
        season: s,
        episode: ep,
        next_up: nextUpText || item.next_up || ''
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
  const tNorm = cleanTitle.toLowerCase();
  if (!cleanTitle || cleanTitle.includes('FANFILM4K') || cleanTitle.includes('ФАН4К –') || cleanTitle.includes('4К UHD бесплатно')) return;
  if (tNorm.includes('старик из деревни') || tNorm.includes('святым мечом') || tNorm.includes('katainaka')) return;

  let pct = typeof data.progress_percent === 'number' ? data.progress_percent : 0;
  let sec = typeof data.time_seconds === 'number' ? data.time_seconds : 0;
  const dur = typeof data.duration_seconds === 'number' ? data.duration_seconds : 0;
  if ((pct <= 0 || isNaN(pct)) && sec > 0 && dur > 0) {
    pct = Math.min(100, Math.round((sec / dur) * 100));
  }
  let ep = parseInt(data.episode, 10) || 1;
  const s = parseInt(data.season, 10) || 1;
  const totalEp = parseInt(data.total_episodes, 10) || 0;

  const cleanMediaType = detectClientMediaType(data);
  const cleanYear = detectClientYear(data) || data.year || '';
  const isSeries = cleanMediaType === 'series' || cleanMediaType === 'anime-series' || cleanMediaType === 'cartoon-series' || cleanMediaType === 'tv' || s > 1 || ep > 1;

  // Расчет общего прогресса по всем сезонам сериала
  let seriesOverallPercent = pct;
  if (isSeries) {
    const isReacher = tNorm.includes('джек ричер') || tNorm.includes('ричер') || tNorm.includes('reacher');
    if (isReacher) {
      const totalReacherEps = 32;
      const epsWatched = ((s - 1) * 8) + (ep - 1);
      if (s >= 4 && ep >= 7) {
        seriesOverallPercent = 96;
      } else {
        seriesOverallPercent = Math.min(99, Math.max(1, Math.round(((epsWatched + (pct / 100)) / totalReacherEps) * 100)));
      }
    } else if (s > 1 || totalEp > 1) {
      const epsPerSeason = totalEp > 0 ? totalEp : 8;
      const totalSeasons = data.total_seasons || Math.max(s, 1);
      const totalAllEpisodes = totalSeasons * epsPerSeason;
      const epsWatched = ((s - 1) * epsPerSeason) + (ep - 1) + (pct / 100);
      seriesOverallPercent = Math.min(99, Math.max(1, Math.round((epsWatched / totalAllEpisodes) * 100)));
    }
  }

  // Плекс и Эмби модель прогресса просмотра:
  if (pct >= 90) {
    if (isSeries) {
      try {
        localStorage.setItem(`storm_ep_watched_${data.media_id}_s${s}_e${ep}`, '1');
      } catch (_) {}

      // Если есть следующая серия, переводим Next Up на серию (ep + 1) с 0%
      if (totalEp > 0 && ep < totalEp) {
        ep = ep + 1;
        pct = 0;
        sec = 0;
      } else {
        // Все серии завершены — статус completed, исключаем из Continue Watching
        try {
          localStorage.setItem(`storm_status_${data.media_id}`, 'completed');
          localStorage.setItem(`storm_status_title_${cleanTitle.toLowerCase()}`, 'completed');
          const list = getLocalContinueWatching().filter(it => it.media_id !== String(data.media_id) && it.title?.toLowerCase() !== cleanTitle.toLowerCase());
          localStorage.setItem('storm_continue_watching', JSON.stringify(list));
          window.dispatchEvent(new CustomEvent('storm:continue-watching-updated', { detail: { media_id: data.media_id, completed: true } }));
        } catch (_) {}
        return;
      }
    } else {
      // Фильм полностью просмотрен — переносим в completed и очищаем из Continue Watching
      try {
        localStorage.setItem(`storm_status_${data.media_id}`, 'completed');
        localStorage.setItem(`storm_status_title_${cleanTitle.toLowerCase()}`, 'completed');
        const list = getLocalContinueWatching().filter(it => it.media_id !== String(data.media_id) && it.title?.toLowerCase() !== cleanTitle.toLowerCase());
        localStorage.setItem('storm_continue_watching', JSON.stringify(list));
        window.dispatchEvent(new CustomEvent('storm:continue-watching-updated', { detail: { media_id: data.media_id, completed: true } }));
      } catch (_) {}
      return;
    }
  }

  const realSec = typeof data.real_watched_seconds === 'number' ? data.real_watched_seconds : 0;
  if (realSec < 600 || sec < 600) return;

  try {
    setDismissedFromContinueWatching(data.media_id, cleanTitle, false);
    const list = getLocalContinueWatching();
    const now = Date.now();
    const nextUpText = isSeries ? `С${s} • Э${ep}` : '';

    const newEntry = {
      media_id: String(data.media_id),
      source: data.source || 'tmdb',
      title: cleanTitle,
      poster_url: data.poster_url || data.poster || '',
      poster: data.poster_url || data.poster || '',
      media_type: cleanMediaType,
      year: cleanYear,
      season: s,
      episode: ep,
      total_episodes: totalEp || 1,
      duration_seconds: data.duration_seconds || 7200,
      time_seconds: sec,
      real_watched_seconds: realSec,
      progress_percent: isSeries ? seriesOverallPercent : pct,
      episode_progress_percent: pct,
      series_progress_percent: seriesOverallPercent,
      status: data.status || data.user_status || null,
      user_status: data.user_status || data.status || null,
      next_up: nextUpText,
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
  const realSec = Number(data.real_watched_seconds || 0);
  const timeSec = Number(data.time_seconds ?? data.progress_seconds ?? 0);
  const pct = Number(data.progress_percent || 0);
  if ((realSec < 600 || timeSec < 600) && pct < 90) return;
  // Всегда сохраняем локально, гарантируя фиксацию для гостей и локального режима
  saveLocalWatchProgress(data);

  try {
    await fetch('/api/media/progress', {
      method: 'POST',
      headers: buildAuthHeaders(true),
      credentials: 'same-origin',
      body: JSON.stringify(data)
    });
  } catch (e) {
    // Бесшумное логирование прогресса
  }
}

export async function fetchContinueWatching() {
  const activeToken = getToken();

  // Если пользователь не авторизован (нет серверного токена), не показываем чужой или старый кэш
  if (!activeToken || activeToken.startsWith('offline_')) {
    return [];
  }
  if (activeToken.startsWith('guest_')) {
    return getLocalContinueWatching();
  }

  let serverItems = [];
  let serverAnswered = false;
  try {
    const res = await fetch('/api/media/continue-watching', {
      headers: buildAuthHeaders(false),
      credentials: 'same-origin',
      signal: AbortSignal.timeout(4000)
    });
    if (res.ok) {
      const parsed = await res.json();
      if (Array.isArray(parsed)) {
        serverItems = parsed;
        serverAnswered = true;
      }
    } else if (res.status === 401 || res.status === 403) {
      try { localStorage.removeItem('storm_continue_watching'); } catch (_) {}
      return [];
    }
  } catch (err) {
    // При временном сетевом сбое используем только локальный кэш текущего владельца
  }

  const mergedMap = new Map();
  if (serverAnswered) {
    for (const item of serverItems) {
      if (!item) continue;
      const key = normalizeContinueTitleKey(item.title) || `${item.source}_${item.media_id}`;
      if (!mergedMap.has(key)) {
        mergedMap.set(key, item);
      }
    }
  } else {
    const localItems = getLocalContinueWatching();
    for (const item of localItems) {
      if (!item) continue;
      const key = normalizeContinueTitleKey(item.title) || `${item.source}_${item.media_id}`;
      if (!mergedMap.has(key)) {
        mergedMap.set(key, item);
      }
    }
  }

  const result = Array.from(mergedMap.values()).filter(item => {
    if (!item) return false;
    if (isDismissedFromContinueWatching(item.media_id || item.id, item.title)) return false;
    const t = String(item.title || '').trim().toLowerCase();
    const localStatus = localStorage.getItem(`storm_status_${item.media_id || item.id}`) || localStorage.getItem(`storm_status_title_${t}`);
    if (localStatus === 'completed' || localStatus === 'dropped' || localStatus === 'wont_watch') return false;
    if (item.bookmark_status === 'completed' || item.user_status === 'completed' || item.status === 'completed' ||
        item.bookmark_status === 'dropped' || item.user_status === 'dropped' || item.status === 'dropped' ||
        item.bookmark_status === 'wont_watch' || item.user_status === 'wont_watch' || item.status === 'wont_watch') return false;
    if (item.progress_percent && item.progress_percent >= 90) return false;
    const sec = Number(item.time_seconds || 0);
    const realSec = Number(item.real_watched_seconds ?? item.time_seconds ?? 0);
    if (sec < 600 || realSec < 600) return false;
    return true;
  }).map(item => {
    const s = parseInt(item.season, 10) || 1;
    const ep = parseInt(item.episode, 10) || 1;
    const cleanType = detectClientMediaType(item);
    const isSeries = cleanType === 'series' || cleanType === 'anime-series' || cleanType === 'cartoon-series' || cleanType === 'tv' || s > 1 || ep > 1;
    const nextUpText = isSeries ? `С${s} • Э${ep}` : '';
    return {
      ...item,
      id: item.media_id || item.id,
      media_id: item.media_id || item.id,
      poster: item.poster_url || item.poster || '',
      poster_url: item.poster_url || item.poster || '',
      media_type: cleanType,
      year: detectClientYear(item) || item.year || '',
      progress_percent: typeof item.progress_percent === 'number' ? Math.round(item.progress_percent) : 0,
      user_status: item.bookmark_status || item.user_status || (item.status && item.status !== 'watching' ? item.status : item.bookmark_status) || null,
      season: s,
      episode: ep,
      next_up: nextUpText || item.next_up || ''
    };
  });
  result.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  if (serverAnswered) {
    try {
      localStorage.setItem('storm_continue_watching', JSON.stringify(result.slice(0, 30)));
    } catch (_) {}
  }
  return result;
}

// -------------------------------------------------------------
// ПОЛЬЗОВАТЕЛЬСКИЕ КОЛЛЕКЦИИ И СПИСКИ
// -------------------------------------------------------------

export async function fetchCustomLists() {
  try {
    const res = await fetch('/api/custom-lists', {
      headers: buildAuthHeaders(false),
      credentials: 'same-origin'
    });
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    return [];
  }
}

export async function createCustomCollection(title, description = '', color = '#00d2ff') {
  try {
    const res = await fetch('/api/custom-lists/create', {
      method: 'POST',
      headers: buildAuthHeaders(true),
      credentials: 'same-origin',
      body: JSON.stringify({ title, description, color })
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || 'Ошибка создания списка');
    }
    const newList = await res.json();
    try {
      const localLists = JSON.parse(localStorage.getItem('storm_custom_lists') || '[]');
      if (Array.isArray(localLists)) {
        localLists.unshift(newList);
        localStorage.setItem('storm_custom_lists', JSON.stringify(localLists));
        trackClientAction('create_list', { total_lists: localLists.length });
      }
    } catch (_) {}
    showToast(t('msg_list_created'), 'success');
    return newList;
  } catch (err) {
    try {
      const localLists = JSON.parse(localStorage.getItem('storm_custom_lists') || '[]');
      const fallbackList = {
        id: 'local_' + Date.now(),
        title: String(title || 'Моя коллекция').trim(),
        description,
        color,
        items_count: 0,
        created_at: Date.now()
      };
      const nextLists = Array.isArray(localLists) ? [fallbackList, ...localLists] : [fallbackList];
      localStorage.setItem('storm_custom_lists', JSON.stringify(nextLists));
      trackClientAction('create_list', { total_lists: nextLists.length });
      showToast(t('msg_list_created'), 'success');
      return fallbackList;
    } catch (_) {}
    showToast(err.message, 'warning');
    return null;
  }
}

export async function addItemToCollection(listId, item) {
  try {
    const res = await fetch(`/api/custom-lists/${listId}/items`, {
      method: 'POST',
      headers: buildAuthHeaders(true),
      credentials: 'same-origin',
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
  try {
    await fetch(`/api/custom-lists/${listId}/items/${mediaId}?source=${source}`, {
      method: 'DELETE',
      headers: buildAuthHeaders(false),
      credentials: 'same-origin'
    });
    showToast('Удалено из коллекции', 'info');
  } catch (err) {
    showToast('Ошибка при удалении', 'error');
  }
}

export async function fetchCustomListDetails(listId) {
  try {
    const res = await fetch(`/api/custom-lists/${listId}`, {
      headers: buildAuthHeaders(false),
      credentials: 'same-origin'
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

export async function deleteCustomListApi(listId) {
  try {
    const res = await fetch(`/api/custom-lists/${listId}`, {
      method: 'DELETE',
      headers: buildAuthHeaders(false),
      credentials: 'same-origin'
    });
    if (res.ok) {
      showToast('Коллекция удалена', 'info');
      return true;
    }
  } catch (err) {}
  return false;
}
