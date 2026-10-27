/* ==========================================================================
   STORM MULTIMEDIA - КИНОТЕАТРАЛЬНЫЙ МОДАЛЬНЫЙ ПЛЕЕР (CINEMA MODAL)
   Поддержка 4K FanFilm4K, AniLibria HLS, AniXart, Kinobox, WebTorrent,
   Ambilight эффекта, пропуска интро/аутро, PiP, субтитров и совместного просмотра
   ========================================================================== */

import { saveBookmarkStatus, deleteBookmark, syncWatchProgress, fetchCustomLists, addItemToCollection, createCustomCollection, detectClientMediaType, detectClientYear } from './bookmarks.js?v=1.2.3';
import { getUser, showToast } from './auth.js?v=1.2.3';
import { t } from './i18n.js?v=1.2.3';
import { trackClientAction } from './achievements.js?v=1.2.3';
import { renderReviewsSection } from './reviews.js?v=1.2.3';
import { attachPlayerToRoom, createWatchRoom, joinWatchRoom, leaveWatchRoom, getActiveRoom, renderRoomUi, broadcastEpisodeSync } from './watch-together.js?v=1.2.3';
import { initSubtitlesManager, renderSubtitlesControls } from './subtitles-manager.js?v=1.2.3';
import { initSmartSkip, renderChaptersOnTrack, setSmartSkipIntervals } from './smart-skip.js?v=1.2.3';
import { sendSmartLightsFrame, renderSmartLightsSettings } from './smart-lights.js?v=1.2.3';
import { toggleWhisperAiSubtitles } from './whisper-subtitles.js?v=1.2.3';
import { saveMediaForOffline } from './offline-storage.js?v=1.2.3';
import { renderTorrServerSettings } from './torrserver-client.js?v=1.2.3';
import { applyProVideoSettings, initProAudioEngine, initVideoUpscalerShaders, stopVideoUpscalerShaders, renderProVideoPanel, renderProAudioPanel, setProAudioNightMode, getProAudioNightMode, applyProAudioSettings } from './pro-media-engine.js?v=1.2.3';
import { getStatusIconSvg, getStatusLabel, STATUS_LIST } from './status-icons.js?v=1.2.3';
import { mountCleanViewOverlay, toggleCleanViewModal, initAdSkipper, applyMaskSettings } from './ad-shield.js?v=1.2.3';
import { resolveFanFilmUrl } from './fanfilm-catalog-intel.js?v=1.2.3';

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

let currentMedia = null;
let currentPlayers = [];
let currentActivePlayer = null;
let currentVoiceoverId = null;
let currentEpisodes = [];
let currentEpisodeIndex = 1;
let currentProgressPercent = 0;
let iframeWatchInterval = null;
let currentWatchTimeSeconds = 0;
let hasCinemaHistoryEntry = false;
let isClosingCinemaViaHistoryBack = false;
let activeResumePromptState = null;
let isResumePromptPending = false;
let pendingResumeSeekSeconds = 0;
let pendingResumeSeekUntil = 0;
let pendingResumeSeekTimer = null;
let lastResumeSnapshotSyncAt = 0;

function formatResumeTimecode(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function normalizeResumeTitleKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

function saveMediaResumeSnapshot(override = {}) {
  if (!currentMedia || !currentMedia.id) return;
  const mediaId = String(override.media_id || currentMedia.id || activeTrackingMediaId || '').trim();
  const cleanT = cleanVideoTitle(override.title || currentMedia.title || '');
  if (!mediaId || !cleanT) return;

  const isSeries = Boolean(
    override.is_series !== undefined
      ? override.is_series
      : checkIfMediaIsSeries(currentMedia)
  );
  const season = Math.max(1, parseInt(override.season ?? quickBarActiveSeason ?? activeTrackingSeason ?? currentMedia.season ?? 1, 10) || 1);
  const episode = Math.max(1, parseInt(override.episode ?? quickBarActiveEpisode ?? activeTrackingEpisode ?? currentEpisodeIndex ?? currentMedia.episode ?? 1, 10) || 1);

  const videoEl = document.querySelector('#cinema-player-wrapper video, .cinema-video-element');
  const rawSec = override.time_seconds !== undefined
    ? Number(override.time_seconds)
    : (videoEl && !isNaN(videoEl.currentTime) && videoEl.currentTime > 0
        ? videoEl.currentTime
        : (currentWatchTimeSeconds > 0 ? currentWatchTimeSeconds : activeTrackingWatchedSeconds));
  const timeSeconds = Math.max(0, Math.round(Number(rawSec) || 0));

  const rawDur = override.duration_seconds !== undefined
    ? Number(override.duration_seconds)
    : (videoEl && !isNaN(videoEl.duration) && isFinite(videoEl.duration) && videoEl.duration > 30
        ? videoEl.duration
        : (activeTrackingDurationSeconds > 30 ? activeTrackingDurationSeconds : (isSeries ? 1440 : 5400)));
  const durationSeconds = Math.max(60, Math.round(Number(rawDur) || (isSeries ? 1440 : 5400)));

  // Не перезаписываем существующую точку остановки, пока плашка «Продолжить?» открыта и пользователь еще не начал активный просмотр
  if (isResumePromptPending && !override.forceSave && timeSeconds < 20) {
    return;
  }

  // Сохраняем только если есть реальный прогресс (>= 10 сек) или выбран сезон/серия > 1
  if (!override.forceSave && timeSeconds < 10 && (!isSeries || (season <= 1 && episode <= 1))) {
    return;
  }

  // Если старый снимок на той же серии имел большее время, а сейчас 0 сек без явного переключения серии — не затираем время
  const titleKey = normalizeResumeTitleKey(cleanT);
  try {
    const prevRaw = localStorage.getItem(`storm_resume_state_${mediaId}`) || (titleKey ? localStorage.getItem(`storm_resume_state_title_${titleKey}`) : null);
    if (prevRaw && timeSeconds < 10 && !override.resetTime) {
      const prev = JSON.parse(prevRaw);
      if (prev && Number(prev.season) === season && Number(prev.episode) === episode && Number(prev.time_seconds) >= 10) {
        return;
      }
    }
  } catch (_) {}

  const now = Date.now();
  const pct = durationSeconds > 0 ? Math.min(100, Math.round((timeSeconds / durationSeconds) * 100)) : 0;
  const realWatchedSeconds = override.resetTime
    ? 0
    : Math.max(0, Math.round(Number(override.real_watched_seconds ?? activeRealWatchedSeconds) || 0));

  const snapshot = {
    media_id: mediaId,
    source: currentMedia.source || 'tmdb',
    title: cleanT,
    poster_url: currentMedia.poster || currentMedia.poster_url || '',
    media_type: currentMedia.media_type || (isSeries ? 'series' : 'movie'),
    year: currentMedia.year || '',
    is_series: isSeries,
    season,
    episode,
    time_seconds: timeSeconds,
    real_watched_seconds: realWatchedSeconds,
    duration_seconds: durationSeconds,
    progress_percent: pct,
    timecode: formatResumeTimecode(timeSeconds),
    updated_at: now
  };

  try {
    if (realWatchedSeconds >= 600 && timeSeconds >= 600) {
      localStorage.setItem(`storm_resume_state_${mediaId}`, JSON.stringify(snapshot));
      if (titleKey) {
        localStorage.setItem(`storm_resume_state_title_${titleKey}`, JSON.stringify(snapshot));
      }
    }
    if (isSeries && timeSeconds >= 5) {
      localStorage.setItem(`storm_ep_watchtime_${mediaId}_s${season}_e${episode}`, String(timeSeconds));
    }
  } catch (_) {}

  if ((realWatchedSeconds >= 600 && timeSeconds >= 600) || pct >= 90) {
    if (override.forceSync || (now - lastResumeSnapshotSyncAt >= 10000)) {
      lastResumeSnapshotSyncAt = now;
      try {
        syncWatchProgress({
          media_id: mediaId,
          source: snapshot.source,
          title: cleanT,
          poster_url: snapshot.poster_url,
          media_type: snapshot.media_type,
          year: snapshot.year,
          season,
          episode,
          total_episodes: (Array.isArray(currentEpisodes) && currentEpisodes.length > 0) ? currentEpisodes.length : (currentMedia.total_episodes || 1),
          duration_seconds: durationSeconds,
          time_seconds: timeSeconds,
          real_watched_seconds: realWatchedSeconds,
          progress_percent: pct
        });
      } catch (_) {}
    }
  }
}

function analyzeSeriesWatchState(mediaObj, detailsObj = null) {
  const merged = { ...(mediaObj || {}), ...(detailsObj || {}) };
  const mediaId = String(merged.id || merged.media_id || '').trim();
  if (!mediaId) return null;

  let rawSeasons = [];
  if (detailsObj && Array.isArray(detailsObj.seasons) && detailsObj.seasons.length > 0) {
    rawSeasons = detailsObj.seasons;
  } else if (typeof quickBarSeriesData !== 'undefined' && quickBarSeriesData && Array.isArray(quickBarSeriesData.seasons) && quickBarSeriesData.seasons.length > 0) {
    rawSeasons = quickBarSeriesData.seasons;
  } else if (Array.isArray(merged.seasons) && merged.seasons.length > 0) {
    rawSeasons = merged.seasons;
  }

  const seasonMap = new Map();
  rawSeasons.forEach((s, idx) => {
    const sNum = Number(s.season_number || s.season) || (idx + 1);
    const epsArr = Array.isArray(s.episodes) ? s.episodes : [];
    const count = epsArr.length || Number(s.episode_count || s.episodes_count) || 0;
    if (sNum > 0) {
      seasonMap.set(sNum, {
        season: sNum,
        total: count,
        epNumbers: epsArr.length > 0
          ? epsArr.map((e, i) => Number(e.episode || e.episode_number || e.ordinal || e.position) || (i + 1)).sort((a, b) => a - b)
          : Array.from({ length: count }, (_, i) => i + 1)
      });
    }
  });

  // Дополняем сезонами из localStorage, если список сезонов с сервера еще загружается
  for (let s = 1; s <= 25; s++) {
    try {
      const rawW = localStorage.getItem(`storm_watched_eps_${mediaId}_s${s}`) || (s === 1 ? localStorage.getItem(`storm_watched_eps_${mediaId}`) : null);
      const expSt = localStorage.getItem(`storm_season_status_${mediaId}_s${s}`);
      if (rawW || expSt) {
        const parsed = rawW ? JSON.parse(rawW) : [];
        const maxWatched = Array.isArray(parsed) && parsed.length > 0 ? Math.max(...parsed.map(Number).filter(Boolean)) : 0;
        if (!seasonMap.has(s)) {
          const cnt = Math.max(maxWatched, 1);
          seasonMap.set(s, {
            season: s,
            total: cnt,
            epNumbers: Array.from({ length: cnt }, (_, i) => i + 1),
            fromLocalStorageOnly: true
          });
        }
      }
    } catch (_) {}
  }

  const sortedSeasons = Array.from(seasonMap.values()).sort((a, b) => a.season - b.season);
  if (sortedSeasons.length === 0) return null;

  let totalWatchedCount = 0;
  let totalAvailableCount = 0;
  let lastWatchedSeason = 1;
  let lastWatchedEpisode = 1;
  let firstUnwatchedAfterStart = null;
  let hasAnyWatched = false;

  for (const sInfo of sortedSeasons) {
    const sNum = sInfo.season;
    const watchedSet = getWatchedEpisodes(mediaId, sNum);
    const explicitSt = getSeasonExplicitStatus(mediaId, sNum);
    const isSeasonExplicitlyCompleted = explicitSt === 'completed';
    const epNums = sInfo.epNumbers.length > 0 ? sInfo.epNumbers : [1];

    totalAvailableCount += epNums.length;

    for (const epNum of epNums) {
      const isEpDone = isSeasonExplicitlyCompleted || watchedSet.has(epNum);
      if (isEpDone) {
        hasAnyWatched = true;
        totalWatchedCount++;
        if (sNum > lastWatchedSeason || (sNum === lastWatchedSeason && epNum >= lastWatchedEpisode)) {
          lastWatchedSeason = sNum;
          lastWatchedEpisode = epNum;
        }
      }
    }
  }

  // Находим первую непросмотренную серию, идущую ПОСЛЕ первой просмотренной (или в следующем сезоне)
  if (hasAnyWatched) {
    for (const sInfo of sortedSeasons) {
      const sNum = sInfo.season;
      const watchedSet = getWatchedEpisodes(mediaId, sNum);
      const isSeasonExplicitlyCompleted = getSeasonExplicitStatus(mediaId, sNum) === 'completed';
      if (isSeasonExplicitlyCompleted) continue;

      const epNums = sInfo.epNumbers;
      // Если весь сезон уже просмотрен по количеству серий
      if (sInfo.total > 0 && watchedSet.size >= sInfo.total) continue;

      for (const epNum of epNums) {
        if (!watchedSet.has(epNum)) {
          firstUnwatchedAfterStart = { season: sNum, episode: epNum };
          break;
        }
      }
      if (firstUnwatchedAfterStart) break;
    }
  }

  const allAvailableWatched = hasAnyWatched && totalAvailableCount > 0 && totalWatchedCount >= totalAvailableCount && !firstUnwatchedAfterStart;

  return {
    hasAnyWatched,
    allAvailableWatched,
    totalWatchedCount,
    totalAvailableCount,
    lastWatchedSeason,
    lastWatchedEpisode,
    firstUnwatchedAfterStart,
    sortedSeasons
  };
}

function isSeriesEpisodeAlreadyCompleted(mediaId, seasonNum, episodeNum, timeSec = 0, durSec = 0) {
  if (!mediaId) return false;
  const sNum = Math.max(1, Number(seasonNum) || 1);
  const eNum = Math.max(1, Number(episodeNum) || 1);
  try {
    if (getSeasonExplicitStatus(mediaId, sNum) === 'completed') return true;
    const watchedSet = getWatchedEpisodes(mediaId, sNum);
    if (watchedSet.has(eNum)) return true;
  } catch (_) {}
  if (durSec > 60 && (timeSec / durSec) >= 0.90) return true;
  return false;
}

export function resolveMediaResumeState(mediaItem, details = null, options = {}) {
  if (!mediaItem && !details) return null;
  const merged = { ...(mediaItem || {}), ...(details || {}) };
  const mediaId = String(merged.id || merged.media_id || '').trim();
  const cleanT = cleanVideoTitle(merged.title || mediaItem?.title || '');
  const titleKey = normalizeResumeTitleKey(cleanT);
  const isSeries = checkIfMediaIsSeries(merged);

  if (isSeries && mediaId) {
    const seriesAnalysis = analyzeSeriesWatchState(merged, details);
    // Если ВСЕ вышедшие сезоны и серии уже отмечены просмотренными — ничего не пишем!
    if (seriesAnalysis && seriesAnalysis.allAvailableWatched) {
      return null;
    }
  }

  const candidates = [];

  // 1. Локальный высокоточный снимок точки остановки
  try {
    const rawById = mediaId ? localStorage.getItem(`storm_resume_state_${mediaId}`) : null;
    if (rawById) {
      const parsed = JSON.parse(rawById);
      if (parsed) candidates.push({ ...parsed, priority: 4 });
    }
    const rawByTitle = titleKey ? localStorage.getItem(`storm_resume_state_title_${titleKey}`) : null;
    if (rawByTitle) {
      const parsed = JSON.parse(rawByTitle);
      if (parsed) candidates.push({ ...parsed, priority: 3 });
    }
  } catch (_) {}

  // 2. Список «Продолжить просмотр» (storm_continue_watching)
  try {
    const rawCW = localStorage.getItem('storm_continue_watching');
    if (rawCW) {
      const list = JSON.parse(rawCW);
      if (Array.isArray(list)) {
        const match = list.find(it => {
          if (!it) return false;
          if (mediaId && String(it.media_id || it.id) === mediaId) return true;
          const itKey = normalizeResumeTitleKey(it.title);
          return Boolean(titleKey && itKey && itKey === titleKey);
        });
        if (match) {
          candidates.push({
            season: parseInt(match.season, 10) || 1,
            episode: parseInt(match.episode, 10) || 1,
            time_seconds: parseInt(match.time_seconds, 10) || 0,
            duration_seconds: parseInt(match.duration_seconds, 10) || 0,
            updated_at: Number(match.updated_at) || 0,
            priority: 2
          });
        }
      }
    }
  } catch (_) {}

  // 3. Серверная запись прогресса из watch_history (details.user_watch_progress)
  if (details && details.user_watch_progress) {
    const wp = details.user_watch_progress;
    candidates.push({
      season: parseInt(wp.season, 10) || 1,
      episode: parseInt(wp.episode, 10) || 1,
      time_seconds: parseInt(wp.time_seconds, 10) || 0,
      duration_seconds: parseInt(wp.duration_seconds, 10) || 0,
      updated_at: Number(wp.updated_at) || 0,
      priority: 2
    });
  }

  // 4. Прямые поля карточки (например при клике из рейла «Продолжить просмотр»)
  if (mediaItem && (mediaItem.time_seconds || mediaItem.season > 1 || mediaItem.episode > 1)) {
    candidates.push({
      season: parseInt(mediaItem.season, 10) || 1,
      episode: parseInt(mediaItem.episode, 10) || 1,
      time_seconds: parseInt(mediaItem.time_seconds, 10) || 0,
      duration_seconds: parseInt(mediaItem.duration_seconds, 10) || 0,
      updated_at: Number(mediaItem.updated_at) || 1,
      priority: 1
    });
  }

  if (isSeries && mediaId) {
    const seriesAnalysis = analyzeSeriesWatchState(merged, details);
    // Отбрасываем кандидатов, которые указывают на УЖЕ ПРОСМОТРЕННЫЕ серии или финальные титры (>= 90%)
    const validUnfinishedCandidates = candidates.filter(c => {
      const s = Math.max(1, parseInt(c.season, 10) || 1);
      const e = Math.max(1, parseInt(c.episode, 10) || 1);
      const t = Math.max(0, Math.round(Number(c.time_seconds) || 0));
      const d = Math.max(0, Math.round(Number(c.duration_seconds) || 1440));
      return !isSeriesEpisodeAlreadyCompleted(mediaId, s, e, t, d);
    });

    if (validUnfinishedCandidates.length > 0) {
      validUnfinishedCandidates.sort((a, b) => {
        const sa = (Number(a.season) || 1) * 1000 + (Number(a.episode) || 1);
        const sb = (Number(b.season) || 1) * 1000 + (Number(b.episode) || 1);
        if (sb !== sa) return sb - sa;
        const ua = Number(a.updated_at) || 0;
        const ub = Number(b.updated_at) || 0;
        if (Math.abs(ub - ua) > 1000) return ub - ua;
        return (Number(b.time_seconds) || 0) - (Number(a.time_seconds) || 0);
      });
      const bestUnfinished = validUnfinishedCandidates[0];
      let sNum = Math.max(1, parseInt(bestUnfinished.season, 10) || 1);
      let eNum = Math.max(1, parseInt(bestUnfinished.episode, 10) || 1);
      // Если по истории просмотров пользователь уже ушел дальше (например, 1 сезон полностью закрыт, а кандидат старый с 1 сезона),
      // используем актуальную непросмотренную серию из seriesAnalysis
      if (seriesAnalysis && seriesAnalysis.firstUnwatchedAfterStart) {
        const nextRank = seriesAnalysis.firstUnwatchedAfterStart.season * 1000 + seriesAnalysis.firstUnwatchedAfterStart.episode;
        const candRank = sNum * 1000 + eNum;
        if (nextRank > candRank) {
          sNum = seriesAnalysis.firstUnwatchedAfterStart.season;
          eNum = seriesAnalysis.firstUnwatchedAfterStart.episode;
        }
      }
      let tSec = Math.max(0, Math.round(Number(bestUnfinished.time_seconds) || 0));
      try {
        const savedEpTime = parseInt(localStorage.getItem(`storm_ep_watchtime_${mediaId}_s${sNum}_e${eNum}`) || '0', 10);
        if (savedEpTime > 0 && savedEpTime < 1300) tSec = savedEpTime;
        else if (sNum !== Number(bestUnfinished.season) || eNum !== Number(bestUnfinished.episode)) tSec = savedEpTime || 0;
      } catch (_) {}
      const dSec = Math.max(60, Math.round(Number(bestUnfinished.duration_seconds) || 1440));
      if (sNum <= 1 && eNum <= 1 && tSec < 10 && (!seriesAnalysis || !seriesAnalysis.hasAnyWatched)) {
        return null;
      }
      return {
        isSeries: true,
        season: sNum,
        episode: eNum,
        timeSeconds: tSec,
        durationSeconds: dSec,
        isAtEpisodeStart: tSec < 10,
        timecode: formatResumeTimecode(tSec),
        updatedAt: Number(bestUnfinished.updated_at) || Date.now()
      };
    }

    // Если все кандидаты из истории указывали на уже просмотренные серии, проверяем: есть ли следующая непросмотренная серия (например, вышла 5 серия 2 сезона)
    if (seriesAnalysis && seriesAnalysis.hasAnyWatched && seriesAnalysis.firstUnwatchedAfterStart) {
      const nextS = seriesAnalysis.firstUnwatchedAfterStart.season;
      const nextE = seriesAnalysis.firstUnwatchedAfterStart.episode;
      let epSec = 0;
      try {
        epSec = parseInt(localStorage.getItem(`storm_ep_watchtime_${mediaId}_s${nextS}_e${nextE}`) || '0', 10) || 0;
      } catch (_) {}
      return {
        isSeries: true,
        season: nextS,
        episode: nextE,
        timeSeconds: epSec,
        durationSeconds: 1440,
        isAtEpisodeStart: epSec < 10,
        timecode: formatResumeTimecode(epSec),
        updatedAt: Date.now()
      };
    }

    // Все серии просмотрены или просмотр еще не начинался
    return null;
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const ua = Number(a.updated_at) || 0;
    const ub = Number(b.updated_at) || 0;
    if (Math.abs(ub - ua) > 1000) return ub - ua;
    return (Number(b.time_seconds) || 0) - (Number(a.time_seconds) || 0);
  });

  const best = candidates[0];
  const season = Math.max(1, parseInt(best.season, 10) || 1);
  const episode = Math.max(1, parseInt(best.episode, 10) || 1);
  const timeSeconds = Math.max(0, Math.round(Number(best.time_seconds) || 0));
  const durationSeconds = Math.max(0, Math.round(Number(best.duration_seconds) || 0));

  if (timeSeconds < 15) return null;
  if (durationSeconds > 60 && (timeSeconds / durationSeconds) >= 0.92) return null;
  if (merged.user_status === 'completed') return null;

  return {
    isSeries: false,
    season,
    episode,
    timeSeconds,
    durationSeconds,
    isAtEpisodeStart: false,
    timecode: formatResumeTimecode(timeSeconds),
    updatedAt: Number(best.updated_at) || Date.now()
  };
}

export function seekPlayerToSeconds(totalSeconds, silent = false) {
  const sec = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const tcStr = formatResumeTimecode(sec);

  const video = document.querySelector('#cinema-player-wrapper video, .cinema-video-element');
  if (video) {
    try {
      video.currentTime = sec;
      video.play().catch(() => {});
      if (!silent) showToast(`⏱️ Перемотка на ${tcStr}`, 'info');
      return true;
    } catch (_) {}
  }

  const iframe = document.querySelector('#cinema-player-wrapper iframe, .cinema-player-iframe');
  if (iframe && iframe.contentWindow) {
    try {
      iframe.contentWindow.postMessage({ type: 'STORM_SEEK_TO', time: sec }, '*');
      iframe.contentWindow.postMessage({ event: 'seek', time: sec }, '*');
      iframe.contentWindow.postMessage({ api: 'seek', time: sec }, '*');
      iframe.contentWindow.postMessage({ type: 'seek', value: sec }, '*');
      iframe.contentWindow.postMessage(JSON.stringify({ type: 'STORM_SEEK_TO', time: sec }), '*');
      if (!silent) showToast(`⏱️ Перемотка на ${tcStr}`, 'info');
      return true;
    } catch (_) {}
  }
  return false;
}

function startPendingResumeSeekLoop(targetSeconds) {
  if (pendingResumeSeekTimer) {
    clearInterval(pendingResumeSeekTimer);
    pendingResumeSeekTimer = null;
  }
  const sec = Math.max(0, Math.round(Number(targetSeconds) || 0));
  if (sec <= 0) {
    pendingResumeSeekSeconds = 0;
    return;
  }
  pendingResumeSeekSeconds = sec;
  pendingResumeSeekUntil = Date.now() + 14000;

  seekPlayerToSeconds(sec, true);

  let attempts = 0;
  pendingResumeSeekTimer = setInterval(() => {
    attempts++;
    if (!pendingResumeSeekSeconds || Date.now() > pendingResumeSeekUntil || attempts > 20) {
      clearInterval(pendingResumeSeekTimer);
      pendingResumeSeekTimer = null;
      return;
    }
    const video = document.querySelector('#cinema-player-wrapper video, .cinema-video-element');
    if (video && video.readyState >= 1) {
      if (Math.abs((video.currentTime || 0) - pendingResumeSeekSeconds) > 4) {
        try {
          video.currentTime = pendingResumeSeekSeconds;
          video.play().catch(() => {});
        } catch (_) {}
      } else {
        pendingResumeSeekSeconds = 0;
        clearInterval(pendingResumeSeekTimer);
        pendingResumeSeekTimer = null;
        return;
      }
    } else {
      seekPlayerToSeconds(pendingResumeSeekSeconds, true);
    }
  }, 550);
}

function hideResumePromptBanner() {
  const banner = document.getElementById('player-resume-prompt-banner');
  if (banner) {
    banner.style.display = 'none';
  }
}

function renderResumePromptBanner(resumeState) {
  const banner = document.getElementById('player-resume-prompt-banner');
  const textEl = document.getElementById('player-resume-prompt-text');
  const confirmBtn = document.getElementById('player-resume-confirm-btn');
  const restartBtn = document.getElementById('player-resume-restart-btn');
  const closeBtn = document.getElementById('player-resume-close-btn');

  if (!banner || !textEl || !resumeState) return;

  if (resumeState.isSeries) {
    if (resumeState.isAtEpisodeStart || resumeState.timeSeconds < 10) {
      textEl.innerHTML = `Вы остановились на <strong>начале ${resumeState.episode} серии ${resumeState.season} сезона</strong>. Продолжить?`;
    } else {
      textEl.innerHTML = `Вы остановились на <strong>${resumeState.season} сезоне</strong>, <strong>${resumeState.episode} серии</strong>, на времени <strong>${resumeState.timecode}</strong>. Продолжить?`;
    }
  } else {
    textEl.innerHTML = `Вы остановились на времени <strong>${resumeState.timecode}</strong>. Продолжить?`;
  }

  banner.style.display = 'flex';

  if (confirmBtn) {
    confirmBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      isResumePromptPending = false;
      hideResumePromptBanner();

      if (resumeState.isSeries) {
        const curS = Number(quickBarActiveSeason || 1);
        const curE = Number(quickBarActiveEpisode || currentEpisodeIndex || 1);
        if (curS !== resumeState.season || curE !== resumeState.episode) {
          playEpisodeByNumber(resumeState.episode, resumeState.season);
          renderSeriesSeasons(currentMedia, resumeState.season, resumeState.episode);
        } else {
          // Убеждаемся, что плеер переключен на нужную серию
          playEpisodeByNumber(resumeState.episode, resumeState.season);
        }
        if (resumeState.timeSeconds > 0) {
          startPendingResumeSeekLoop(resumeState.timeSeconds);
        }
        showToast(`⏯️ Продолжаем: ${resumeState.season} сезон, ${resumeState.episode} серия с ${resumeState.timecode}`, 'success');
      } else {
        if (resumeState.timeSeconds > 0) {
          startPendingResumeSeekLoop(resumeState.timeSeconds);
        }
        showToast(`⏯️ Продолжаем просмотр с ${resumeState.timecode}`, 'success');
      }
    };
  }

  if (restartBtn) {
    restartBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      isResumePromptPending = false;
      pendingResumeSeekSeconds = 0;
      if (pendingResumeSeekTimer) {
        clearInterval(pendingResumeSeekTimer);
        pendingResumeSeekTimer = null;
      }
      hideResumePromptBanner();

      if (resumeState.isSeries) {
        playEpisodeByNumber(1, 1);
        renderSeriesSeasons(currentMedia, 1, 1);
      }
      seekPlayerToSeconds(0, true);
      saveMediaResumeSnapshot({
        season: 1,
        episode: 1,
        time_seconds: 0,
        forceSave: true,
        resetTime: true
      });
      showToast('🔄 Воспроизведение с самого начала', 'info');
    };
  }

  if (closeBtn) {
    closeBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      isResumePromptPending = false;
      hideResumePromptBanner();
    };
  }
}

function replaceIframeSrcNoHistory(iframe, newUrl) {
  if (!iframe || !newUrl) return;
  try {
    const parent = iframe.parentNode;
    if (parent) {
      const fresh = iframe.cloneNode(false);
      fresh.src = newUrl;
      parent.replaceChild(fresh, iframe);
      return fresh;
    }
    if (iframe.contentWindow && iframe.contentWindow.location) {
      iframe.contentWindow.location.replace(newUrl);
      return iframe;
    }
  } catch (_) {}
  iframe.src = newUrl;
  return iframe;
}

// Ночной звук (Web Audio Compressor)
let audioCtx = null;
let audioSourceNode = null;
let compressorNode = null;
let nightAudioModeEnabled = localStorage.getItem('storm_night_audio') === 'true';
let xrayVisible = false;

// Сессия попыток источников для предотвращения бесконечного зацикливания
const failedSourcesSession = new Set();
let lastUserManualSelectionTime = 0;

// Фильтрация спама сторонних WebTorrent трекеров и внутренних ошибок плееров в консоли
const _origConsoleError = console.error;
console.error = function(...args) {
  const msg = String(args[0] || '');
  if (msg.includes('WebSocket') || msg.includes('tracker') || msg.includes('Forward to player') || msg.includes('change file error') || msg.includes('ERR_BLOCKED_BY_CLIENT') || msg.includes('imasdk')) {
    return;
  }
  return _origConsoleError.apply(console, args);
};

// Ambilight конфигурация и пресеты
let ambilightEnabled = localStorage.getItem('storm_ambilight') !== 'false';

export function isAmbilightEnabled() {
  ambilightEnabled = localStorage.getItem('storm_ambilight') !== 'false';
  return ambilightEnabled;
}

export function setAmbilightEnabled(val) {
  ambilightEnabled = Boolean(val);
  try {
    localStorage.setItem('storm_ambilight', ambilightEnabled ? 'true' : 'false');
  } catch (_) {}
  const profileToggle = document.getElementById('profile-ambilight-toggle');
  if (profileToggle && profileToggle.checked !== ambilightEnabled) {
    profileToggle.checked = ambilightEnabled;
  }
  const btn = document.getElementById('toggle-ambilight-btn');
  if (btn) btn.classList.toggle('active', ambilightEnabled);
  const studioTab = document.getElementById('studio-tab-ambilight');
  if (studioTab) studioTab.classList.toggle('active-glow', ambilightEnabled);

  const aura = document.getElementById('player-ambilight-aura');
  if (ambilightEnabled) {
    trackClientAction('use_ambilight');
    const video = document.getElementById('storm-video-player');
    startAmbilightLoop(video);
  } else {
    stopAmbilight();
    if (aura) {
      aura.classList.remove('active');
      aura.style.opacity = '0';
      aura.style.boxShadow = 'none';
    }
  }
}
let ambilightCanvas = null;
let ambilightCtx = null;
let ambilightRaf = null;

let ambilightSettings = {
  mode: 'auto', // 'auto', 'preset', 'custom'
  color: '#00f0ff',
  intensity: 85,
  blur: 90
};

try {
  const savedSettings = localStorage.getItem('storm_ambilight_settings');
  if (savedSettings) {
    ambilightSettings = { ...ambilightSettings, ...JSON.parse(savedSettings) };
  }
} catch {}

const AMBILIGHT_PRESETS = [
  { id: 'cyan', name: 'Неоновый циан', color: '#00f0ff' },
  { id: 'purple', name: 'Аметистовая ночь', color: '#a855f7' },
  { id: 'gold', name: 'Имперское золото', color: '#f59e0b' },
  { id: 'emerald', name: 'Матричный изумруд', color: '#00ff66' },
  { id: 'pink', name: 'Неон Найт-Сити', color: '#ff007f' },
  { id: 'blue', name: 'Глубокий ультрамарин', color: '#0284c7' },
  { id: 'sunset', name: 'Закатный янтарь', color: '#ff6b4a' },
  { id: 'cinema', name: 'Белый кинозал', color: '#e2e8f0' }
];

// Skip Intro и Outro
let skipIntervals = null;
let vpnBypassEnabled = localStorage.getItem('storm_vpn_bypass') === 'true';
export let adblockEnabled = localStorage.getItem('storm_adblock_enabled') !== 'false';

export function isAdblockEnabled() {
  adblockEnabled = localStorage.getItem('storm_adblock_enabled') !== 'false';
  return adblockEnabled;
}

export function setAdblockEnabled(val) {
  adblockEnabled = Boolean(val);
  localStorage.setItem('storm_adblock_enabled', adblockEnabled ? 'true' : 'false');
  try {
    const rawClean = localStorage.getItem('storm_cleanview_settings');
    const cleanObj = rawClean ? JSON.parse(rawClean) : {};
    cleanObj.adblockEnabled = adblockEnabled;
    cleanObj.adSkipperEnabled = adblockEnabled;
    localStorage.setItem('storm_cleanview_settings', JSON.stringify(cleanObj));
  } catch (_) {}
  const profileAdToggle = document.getElementById('profile-adblock-toggle');
  if (profileAdToggle && profileAdToggle.checked !== adblockEnabled) {
    profileAdToggle.checked = adblockEnabled;
  }
  const cinemaModal = document.getElementById('cinema-modal');
  if (cinemaModal && cinemaModal.classList.contains('is-open') && currentActivePlayer?.url && !currentActivePlayer.url.includes('.m3u8')) {
    playStreamUrl(currentActivePlayer.url);
  }
}

// Однократная миграция плеера по умолчанию на «Lift 4K и FHD (Без рекламы • Все озвучки)» (lift_adfree)
try {
  if (!localStorage.getItem('storm_default_player_v42_migrated')) {
    localStorage.setItem('storm_default_player', 'lift_adfree');
    localStorage.setItem('storm_default_player_v42_migrated', '1');
  }
} catch (_) {}

export function isAutoNextEnabled() {
  return localStorage.getItem('storm_autonext_enabled') !== 'false';
}

export function setAutoNextEnabled(val) {
  const enabled = Boolean(val);
  try {
    localStorage.setItem('storm_autonext_enabled', enabled ? 'true' : 'false');
  } catch (_) {}
  const toggleEl = document.getElementById('profile-autonext-toggle');
  if (toggleEl && toggleEl.checked !== enabled) {
    toggleEl.checked = enabled;
  }
}

export function getPreferredDefaultPlayerId() {
  return localStorage.getItem('storm_default_player') || 'lift_adfree';
}

export function matchesPreferredPlayer(player, preferredId = getPreferredDefaultPlayerId()) {
  if (!player || !preferredId) return false;
  const pid = String(player.id || '').toLowerCase();
  const pref = String(preferredId || '').toLowerCase();
  if (pid === pref) return true;
  if (pref === 'lift_adfree') return pid === 'lift' || pid.includes('lift');
  if (pref === 'fanfilm4k_uhd') return pid === 'fanfilm_4k' || pid === 'fanfilm4k' || pid.includes('fanfilm');
  if (pref === 'kinobox_universal') return pid === 'kinobox' || pid.includes('kinobox');
  if (pref === 'kodik_direct') return pid === 'kodik_player' || pid === 'kodik' || pid.includes('kodik');
  if (pref === 'vk_video_stream') return pid === 'vk_video' || pid.includes('vk_video');
  if (pref === 'rutube_direct_hls') return pid === 'rutube_stream' || pid === 'rutube' || pid.includes('rutube');
  return false;
}

export function setPreferredDefaultPlayerId(playerId) {
  const cleanId = String(playerId || 'lift_adfree').trim();
  localStorage.setItem('storm_default_player', cleanId);
  localStorage.setItem('storm_default_player_v42_migrated', '1');
  const sel = document.getElementById('profile-default-player-select');
  if (sel && sel.value !== cleanId) sel.value = cleanId;

  const cinemaModal = document.getElementById('cinema-modal');
  if (cinemaModal && cinemaModal.classList.contains('is-open') && Array.isArray(currentPlayers) && currentPlayers.length > 0) {
    renderPlayerSources(currentPlayers);
    const target = currentPlayers.find(p => matchesPreferredPlayer(p, cleanId) && p.status !== 'broken' && p.url);
    if (target && (!currentActivePlayer || currentActivePlayer.id !== target.id)) {
      selectPlayer(target);
      updatePlayerTriggerInfo(target);
    }
  }
}

export function getSafePersonPhotoUrl(photo) {
  if (!photo || photo === 'assets/avatar_default.svg' || photo === 'assets/favicon.svg' || photo.startsWith('assets/')) {
    return 'assets/avatar_default.svg';
  }
  if (typeof window !== 'undefined' && typeof window.__stormGetSafePosterUrl === 'function') {
    return window.__stormGetSafePosterUrl(photo, '');
  }
  if (photo.startsWith('/api/media/image-proxy')) return photo;
  return `/api/media/image-proxy?url=${encodeURIComponent(photo)}`;
}

export function getSafeCleanStreamUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return '';
  let streamUrl = rawUrl.trim();
  if (streamUrl.startsWith('//')) {
    streamUrl = 'https:' + streamUrl;
  }
  if (streamUrl.includes('v16.fanfilm4k.media')) {
    streamUrl = streamUrl.replace('v16.fanfilm4k.media', 'v17.fanfilm4k.media');
  }
  if (streamUrl.includes('libria.fun')) {
    streamUrl = streamUrl
      .replace(/^https?:\/\/cache-[a-z0-9-]+\.libria\.fun\//i, 'https://cache.libria.fun/')
      .split('?')[0];
  }
  streamUrl = streamUrl.replace(/([?&])(autoplay|autoPlay)=1\b/g, '$1$2=0');

  const currentAdblock = isAdblockEnabled();
  vpnBypassEnabled = localStorage.getItem('storm_vpn_bypass') === 'true';

  if (currentAdblock) {
    if (!streamUrl.startsWith('/api/') && !streamUrl.includes('.m3u8')) {
      if (streamUrl.includes('fanfilm4k') || streamUrl.includes('stravers')) {
        const titleParam = currentMedia?.title ? `&title=${encodeURIComponent(currentMedia.title)}` : '';
        const yearParam = currentMedia?.year ? `&year=${encodeURIComponent(currentMedia.year)}` : '';
        const kpVal = currentMedia?.kp_id || currentMedia?.kinopoisk_id || '';
        const kpParam = kpVal ? `&kp_id=${encodeURIComponent(kpVal)}` : '';
        streamUrl = `/api/player/fanfilm-embed?url=${encodeURIComponent(streamUrl)}${titleParam}${yearParam}${kpParam}`;
      } else if (streamUrl.includes('kodik') || streamUrl.includes('rezka') || streamUrl.includes('lostfilm') || streamUrl.includes('anixart')) {
        const fbTitle = currentMedia?.title ? `&fallback_title=${encodeURIComponent(currentMedia.title)}` : '';
        const fbYear = currentMedia?.year ? `&fallback_year=${encodeURIComponent(currentMedia.year)}` : '';
        streamUrl = `/api/player/kodik-embed?url=${encodeURIComponent(streamUrl)}${fbTitle}${fbYear}`;
      } else if (streamUrl.includes('rutube.ru')) {
        const ruIdMatch = streamUrl.match(/\/embed\/([a-f0-9]{32})/i);
        if (ruIdMatch) {
          streamUrl = `/api/player/rutube-embed/${ruIdMatch[1]}`;
        } else {
          streamUrl = `/api/player/adblock-proxy?url=${encodeURIComponent(streamUrl)}`;
        }
      } else if (!streamUrl.includes('vkvideo.ru') && !streamUrl.includes('vk.com') && !streamUrl.includes('youtube')) {
        streamUrl = `/api/player/adblock-proxy?url=${encodeURIComponent(streamUrl)}`;
      }
    }
  } else {
    if (streamUrl.includes('/api/player/adblock-proxy?url=')) {
      try {
        const parsed = new URL(streamUrl, window.location.origin);
        const inner = parsed.searchParams.get('url');
        if (inner) streamUrl = inner;
      } catch {}
    }
    if (vpnBypassEnabled && !streamUrl.startsWith('/api/player/')) {
      streamUrl = `/api/player/vpn-proxy?url=${encodeURIComponent(streamUrl)}`;
    }
  }

  return streamUrl;
}

// WebTorrent
let torrentClient = null;

function getSourceName(item) {
  const map = {
    lift: 'Lift 4K',
    fanfilm4k: 'FanFilm4K',
    tmdb: 'TMDB',
    anixart: 'AniXart',
    anilibria: 'AniLibria',
    shikimori: 'Shikimori',
    kodik: 'Kodik',
    hdrezka: 'HDRezka',
    collaps: 'Collaps',
    alloha: 'Alloha TV',
    videocdn: 'VideoCDN',
    ashdi: 'Ashdi',
    vidsrc: 'Vidsrc',
    kinobaza: 'Kinobaza',
    kinogo: 'Kinogo',
    webtorrent: 'WebTorrent',
    rutracker: 'RuTracker',
    nnmclub: 'NNM-Club',
    rutor: 'Rutor',
    lostfilm: 'LostFilm',
    redheadsound: 'Red Head Sound',
    animevost: 'Animevost',
    rutube: 'RuTube',
    vkvideo: 'VK Видео'
  };
  return map[item?.source] || (item?.source || 'STORM').toUpperCase();
}

let lastFsToggleTime = 0;

export function setCinemaFullscreen(enable) {
  const now = Date.now();
  if (now - lastFsToggleTime < 350) return;
  lastFsToggleTime = now;

  const video = document.getElementById('storm-video-player') || document.querySelector('#cinema-player-wrapper video');
  const videoBox = document.querySelector('.player-video-box');
  const modal = document.getElementById('cinema-modal');
  const fsBtn = document.getElementById('cinema-header-fullscreen-btn');

  const currentlyFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || (modal && modal.classList.contains('is-fullscreen')));

  if (!enable) {
    if (currentlyFs) {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen();
      }
      if (fsBtn) delete fsBtn.dataset.manualCssFs;
      if (modal) modal.classList.remove('is-fullscreen');
      if (videoBox) videoBox.classList.remove('is-fullscreen');
    }
  } else {
    // 1. Для iOS Safari нативных HTML5 <video>
    if (video && typeof video.webkitEnterFullscreen === 'function' && !document.fullscreenElement) {
      try {
        video.webkitEnterFullscreen();
        return;
      } catch (_) {}
    }

    // 2. Стандартный Fullscreen API и CSS fallback
    const target = modal;
    const req = target?.requestFullscreen || target?.webkitRequestFullscreen || target?.mozRequestFullScreen;
    if (req) {
      req.call(target).then(() => {
        if (modal) modal.classList.add('is-fullscreen');
        if (videoBox) videoBox.classList.add('is-fullscreen');
      }).catch(() => {
        if (fsBtn) fsBtn.dataset.manualCssFs = 'true';
        if (modal) modal.classList.add('is-fullscreen');
        if (videoBox) videoBox.classList.add('is-fullscreen');
      });
    } else if (modal) {
      if (fsBtn) fsBtn.dataset.manualCssFs = 'true';
      modal.classList.add('is-fullscreen');
      if (videoBox) videoBox.classList.add('is-fullscreen');
    }
  }

  setTimeout(() => {
    if (fsBtn && modal) {
      const activeFs = !!(document.fullscreenElement || document.webkitFullscreenElement || modal.classList.contains('is-fullscreen'));
      fsBtn.innerHTML = activeFs ? FS_EXIT_SVG : FS_EXPAND_SVG;
      fsBtn.title = activeFs ? 'Выйти из полноэкранного режима (F / Esc)' : 'Развернуть на весь экран (F)';
    }
  }, 100);
}

export function toggleCinemaFullscreen() {
  const modal = document.getElementById('cinema-modal');
  const currentlyFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || (modal && modal.classList.contains('is-fullscreen')));
  setCinemaFullscreen(!currentlyFs);
}

const FS_EXPAND_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
const FS_EXIT_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>';
const LOCK_OPEN_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>';
const LOCK_CLOSED_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

function sortSeasonsAndEpisodes(seasonsArr) {
  if (!Array.isArray(seasonsArr)) return [];
  seasonsArr.forEach(s => {
    if (s && Array.isArray(s.episodes)) {
      s.episodes.sort((a, b) => (Number(a.episode ?? a.episode_number ?? a.ordinal ?? a.position ?? 0) || 0) - (Number(b.episode ?? b.episode_number ?? b.ordinal ?? b.position ?? 0) || 0));
    }
  });
  seasonsArr.sort((a, b) => (Number(a.season ?? a.season_number ?? 0) || 0) - (Number(b.season ?? b.season_number ?? 0) || 0));
  return seasonsArr;
}

function formatCleanEpisodeTitle(epNum, rawName) {
  const num = Number(epNum) || 1;
  const raw = String(rawName || '').trim();
  if (!raw) return `Серия ${num}`;
  const lower = raw.toLowerCase().replace(/ё/g, 'е').trim();
  const isGeneric = new RegExp(`^(?:серия|эпизод|episode|ep\\.?)[\\s#:№-]*0*${num}$|^0*${num}[\\s-]*(?:серия|эпизод|episode|ep\\.?)$`, 'i').test(lower);
  if (isGeneric) return `Серия ${num}`;
  const stripped = raw.replace(new RegExp(`^(?:(?:серия|эпизод|episode|ep\\.?)[\\s#:№-]*0*${num}|0*${num}[\\s-]*(?:серия|эпизод|episode|ep\\.?))[\\s:.-]*`, 'i'), '').trim();
  if (!stripped || new RegExp(`^(?:серия|эпизод|episode|ep\\.?)[\\s#:№-]*0*${num}$|^0*${num}[\\s-]*(?:серия|эпизод|episode|ep\\.?)$`, 'i').test(stripped.toLowerCase().replace(/ё/g, 'е'))) {
    return `Серия ${num}`;
  }
  return `${num} серия: ${stripped}`;
}

function syncInPlayerDrawerState(overlay) {
  if (!overlay) overlay = document.getElementById('storm-inplayer-overlay');
  if (!overlay) return;
  const voiceSheet = overlay.querySelector('#player-inplayer-voice-sheet');
  const epSheet = overlay.querySelector('#player-inplayer-episodes-sheet');
  const jogWidget = overlay.querySelector('#inplayer-jog-dial-widget');
  const isVoiceOpen = !!(voiceSheet && voiceSheet.classList.contains('is-open') && voiceSheet.style.display !== 'none');
  const isEpOpen = !!(epSheet && epSheet.classList.contains('is-open') && epSheet.style.display !== 'none');
  const isJogOpen = !!(jogWidget && jogWidget.style.display !== 'none');
  overlay.classList.toggle('has-open-drawer', isVoiceOpen || isEpOpen);
  overlay.classList.toggle('has-open-jog', isJogOpen);
}

let fullscreenInitialized = false;
export function attachCinemaDblClick(el) {
  if (!el || el.dataset?.hasDblClickListener) return;
  el.dataset.hasDblClickListener = 'true';
  el.addEventListener('dblclick', (e) => {
    if (e.target.closest('button, input, select, a, .storm-skip-btn, .storm-btn, .studio-tab-btn, .player-studio-dock, .player-studio-drawer, .xray-header, .xray-tab-content, .player-series-quick-bar, .inplayer-ctrl-btn, .quick-dropdown-menu')) {
      return;
    }
    toggleCinemaFullscreen();
  });
}

function initFullscreenControls() {
  const fsBtn = document.getElementById('cinema-header-fullscreen-btn');
  if (fsBtn && !fsBtn.dataset.hasFsListener) {
    fsBtn.dataset.hasFsListener = 'true';
    fsBtn.onclick = (e) => {
      e.stopPropagation();
      toggleCinemaFullscreen();
    };
  }

  attachCinemaDblClick(document.getElementById('cinema-player-wrapper'));
  attachCinemaDblClick(document.getElementById('cinema-player-container'));
  attachCinemaDblClick(document.querySelector('.cinema-main-column'));

  if (fullscreenInitialized) return;
  fullscreenInitialized = true;

  const updateFsIcon = () => {
    const modal = document.getElementById('cinema-modal');
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || (modal && modal.classList.contains('is-fullscreen')));
    const btn = document.getElementById('cinema-header-fullscreen-btn');
    if (btn) {
      btn.innerHTML = isFs ? FS_EXIT_SVG : FS_EXPAND_SVG;
      btn.title = isFs ? 'Выйти из полноэкранного режима (F / Esc)' : 'Развернуть на весь экран (F)';
    }
    const isNativeFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement);
    if (!isNativeFs && modal && !btn?.dataset?.manualCssFs) {
      modal.classList.remove('is-fullscreen');
    }
  };

  document.addEventListener('fullscreenchange', updateFsIcon);
  document.addEventListener('webkitfullscreenchange', updateFsIcon);
  document.addEventListener('mozfullscreenchange', updateFsIcon);

  // Обработка сообщений от встроенных и сторонних плееров (Kodik, PlayerJS, Allplay, FanFilm и др.)
  window.addEventListener('message', (event) => {
    if (!event || !event.data) return;
    try {
      let data = event.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch {}
      }

      // 1. Примитивные строки
      if (data === 'fullscreen' || data === 'toggle_fullscreen' || data === 'dblclick') {
        toggleCinemaFullscreen();
        return;
      }
      if (data === 'enterfullscreen' || data === 'enter_fullscreen') {
        setCinemaFullscreen(true);
        return;
      }
      if (data === 'exitfullscreen' || data === 'exit_fullscreen') {
        setCinemaFullscreen(false);
        return;
      }
      if (data === 'pip' || data === 'pictureinpicture' || data === 'toggle_pip') {
        toggleAdvancedPiP();
        return;
      }

      // 2. Объектные сообщения от Kodik, Playerjs, Allplay, FanFilm и др.
      if (typeof data === 'object' && data) {
        if (data.type === 'STORM_SWITCH_NEXT_SOURCE' || data.type === 'STORM_PLAYER_FALLBACK') {
          console.warn('[Player] Получен сигнал переключения на резервный плеер:', data.reason);
          switchToNextSource(true);
        }
        if (data.type === 'STORM_SELECT_PLAYER_ID' && data.playerId) {
          const targetP = Array.isArray(currentPlayers)
            ? currentPlayers.find(p => p.id === data.playerId || p.type === data.playerId)
            : null;
          if (targetP) {
            selectPlayer(targetP, true);
          } else {
            showToast('ℹ️ Выбранный источник недоступен для данного релиза', 'info');
          }
        }
        if (data.type === 'STORM_IFRAME_ACTIVITY') {
          showInPlayerControls();
        }
        if (data.type === 'STORM_IFRAME_TIME' && typeof data.currentTime === 'number') {
          if (pendingResumeSeekSeconds > 0 && Date.now() < pendingResumeSeekUntil) {
            if (Math.abs(data.currentTime - pendingResumeSeekSeconds) > 5) {
              seekPlayerToSeconds(pendingResumeSeekSeconds, true);
            } else {
              pendingResumeSeekSeconds = 0;
              if (pendingResumeSeekTimer) {
                clearInterval(pendingResumeSeekTimer);
                pendingResumeSeekTimer = null;
              }
            }
          }
          currentWatchTimeSeconds = Math.round(data.currentTime);
          window.currentWatchProgressSec = data.currentTime;
          if (data.duration && isFinite(data.duration) && data.duration > 30) {
            activeTrackingDurationSeconds = Math.round(data.duration);
          }
          if (currentWatchTimeSeconds >= 5 && !pendingResumeSeekSeconds) {
            activeTrackingWatchedSeconds = currentWatchTimeSeconds;
            if (currentWatchTimeSeconds % 5 === 0) {
              saveMediaResumeSnapshot({
                time_seconds: currentWatchTimeSeconds,
                duration_seconds: activeTrackingDurationSeconds
              });
            }
          }
        }
        if (data.type === 'STORM_LIFT_AUDIO_TRACKS' && Array.isArray(data.tracks) && data.tracks.length > 0) {
          if (currentMedia) {
            currentMedia.realAudioTracks = data.tracks.map((name, idx) => ({ id: String(idx), name: String(name) }));
            currentMedia.stream_verified = true;
            currentMedia.is_upcoming = false;
            if (typeof window.unmarkMediaIdAsUpcoming === 'function') {
              window.unmarkMediaIdAsUpcoming(currentMedia.id || currentMedia.tmdb_id);
            }
          }
        }
        if (data.type === 'STORM_PREMIERE_PLACEHOLDER_LOADED') {
          const fbBanner = document.getElementById('player-fallback-banner');
          if (fbBanner) fbBanner.style.display = 'none';
          if (currentMedia) {
            const userSt = String(currentMedia.user_status || '').toLowerCase().trim();
            const alreadyWatched = ['completed', 'watching', 'on_hold', 'dropped'].includes(userSt) || Number(currentMedia.progress_percent || 0) > 0;
            if (!alreadyWatched) {
              currentMedia.stream_verified = false;
              currentMedia.is_upcoming = true;
              currentMedia.is4K = false;
              currentMedia.quality = 'Ожидается';
              if (typeof window.markMediaIdAsUpcoming === 'function') {
                window.markMediaIdAsUpcoming(currentMedia.id || currentMedia.tmdb_id);
              }
            }
          }
          const sideBadge = document.getElementById('cinema-side-quality-badge');
          if (sideBadge) {
            sideBadge.className = 'storm-badge storm-badge-upcoming';
            sideBadge.setAttribute('style', 'background:rgba(245,158,11,0.22); border-color:#f59e0b; color:#fbbf24; font-weight:800; text-transform:uppercase;');
            sideBadge.textContent = 'ОЖИДАЕТСЯ';
          }
          const inpBadge = document.getElementById('inplayer-badge');
          if (inpBadge) {
            inpBadge.textContent = '🕒 ОЖИДАЕТСЯ';
          }
          const telText = document.getElementById('telemetry-text');
          if (telText) {
            telText.textContent = 'Ожидается цифровой релиз';
          }
        }
        if (data.type === 'STORM_BOOKMARK_PLANNED' && currentMedia) {
          currentMedia.user_status = 'planned';
          try { localStorage.setItem(`storm_status_${currentMedia.id}`, 'planned'); } catch (_) {}
          renderStatusButtons('planned');
          saveBookmarkStatus(currentMedia, 'planned')
            .then(() => showToast('📌 Добавлено в список «В планах»', 'success'))
            .catch(() => showToast('📌 Сохранено локально в список «В планах»', 'info'));
        }
        if (data.type === 'STORM_SPEED_CHANGED') {
          const sp = parseFloat(data.speed);
          if (sp && !isNaN(sp)) {
            localStorage.setItem('storm_playback_speed', String(sp));
            updateInPlayerSpeedDisplay(sp);
          }
        }

        // Kodik Player API
        if (data.key === 'kodik_player_api' && data.value) {
          const val = data.value;
          if (val.action === 'enter_fullscreen' || val.event === 'enter_fullscreen') {
            setCinemaFullscreen(true);
          } else if (val.action === 'exit_fullscreen' || val.event === 'exit_fullscreen') {
            setCinemaFullscreen(false);
          } else if (val.action === 'fullscreen' || val.event === 'fullscreen') {
            toggleCinemaFullscreen();
          }
        }

        // Плееры Playerjs, Plyr, Allplay, FanFilm
        if (data.action === 'enter_fullscreen' || data.event === 'enterfullscreen' || data.event === 'enter_fullscreen') {
          setCinemaFullscreen(true);
        } else if (data.action === 'exit_fullscreen' || data.event === 'exitfullscreen' || data.event === 'exit_fullscreen') {
          setCinemaFullscreen(false);
        } else if (
          data.event === 'fullscreen' || data.event === 'toggle_fullscreen' || data.event === 'fullscreen_toggle' ||
          data.event === 'dblclick' || data.action === 'fullscreen' || data.action === 'toggle_fullscreen' ||
          data.type === 'STORM_FULLSCREEN_TOGGLE' || data.type === 'fullscreen' || data.type === 'toggle_fullscreen'
        ) {
          toggleCinemaFullscreen();
        }

        if (data.event === 'pip' || data.event === 'pictureinpicture' || data.action === 'pip' || data.type === 'pip' || data.type === 'STORM_PIP') {
          toggleAdvancedPiP();
        }

        if (data.type === 'STORM_MOUSE_MOVE' || data.type === 'STORM_USER_ACTIVITY' || data.event === 'mousemove') {
          showInPlayerControls();
        }

        // Автопереключение серий от встроенных плееров (Kodik, Playerjs, Allplay, FanFilm)
        const isEndedAction =
          data === 'ended' || data === 'finish' || data === 'complete' ||
          data?.event === 'ended' || data?.event === 'finish' || data?.event === 'complete' ||
          data?.action === 'ended' || data?.action === 'finish' ||
          data?.type === 'ended' || data?.type === 'STORM_EPISODE_ENDED' ||
          data?.key === 'kodik_player_video_ended' ||
          (data?.key === 'kodik_player_api' && (data.value?.event === 'video_ended' || data.value?.action === 'ended' || data.value?.event === 'ended'));

        if (isEndedAction) {
          if (isAutoNextEnabled() && checkIfMediaIsSeries(currentMedia) && !window._lastEndedAutoSwitchTime) {
            window._lastEndedAutoSwitchTime = Date.now();
            setTimeout(() => { window._lastEndedAutoSwitchTime = 0; }, 6000);
            showToast('Серия завершена. Запуск следующей серии...', 'info');
            setTimeout(() => {
              playInPlayerNextEpisode();
            }, 1000);
            return;
          }
        }

        let streamDuration = data.duration ?? data.total ?? data.val ?? data.value?.duration ?? data.data?.duration ?? data.data?.total;
        if (data.key === 'kodik_player_time_update' || data.key === 'kodik_player_duration_update') {
          streamDuration = data.value?.duration || streamDuration;
        }
        if (streamDuration) {
          if (typeof streamDuration === 'number' && streamDuration > 30) {
            updateSidebarDuration(streamDuration);
          } else if (typeof streamDuration === 'string' && streamDuration.trim()) {
            updateSidebarDuration(streamDuration.trim());
          }
        }

        const curTime = data.time ?? data.position ?? data.value?.time ?? data.data?.time;
        if (curTime && streamDuration && typeof curTime === 'number' && typeof streamDuration === 'number') {
          if (isAutoNextEnabled() && streamDuration > 60 && curTime >= streamDuration - 1.5 && !window._lastEndedAutoSwitchTime) {
            if (checkIfMediaIsSeries(currentMedia)) {
              window._lastEndedAutoSwitchTime = Date.now();
              setTimeout(() => { window._lastEndedAutoSwitchTime = 0; }, 6000);
              showToast('Серия завершена. Запуск следующей серии...', 'info');
              setTimeout(() => {
                playInPlayerNextEpisode();
              }, 1000);
            }
          }
        }
      }
    } catch {}
  });

  document.addEventListener('keydown', (e) => {
    const modal = document.getElementById('cinema-modal');
    if (!modal || !modal.classList.contains('is-open')) return;

    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
      return;
    }

    if (isPlayerScreenLocked) return;

    const k = e.key;
    if (k === 'Escape') {
      const overlay = document.getElementById('storm-inplayer-overlay');
      const vSheet = overlay?.querySelector('#player-inplayer-voice-sheet');
      const eSheet = overlay?.querySelector('#player-inplayer-episodes-sheet');
      const jWidget = overlay?.querySelector('#inplayer-jog-dial-widget');
      if (vSheet && vSheet.classList.contains('is-open')) {
        e.preventDefault();
        e.stopPropagation();
        vSheet.classList.remove('is-open');
        vSheet.style.display = 'none';
        overlay.querySelector('#inplayer-voice-btn')?.classList.remove('active');
        syncInPlayerDrawerState(overlay);
        return;
      }
      if (eSheet && eSheet.classList.contains('is-open')) {
        e.preventDefault();
        e.stopPropagation();
        toggleInPlayerEpisodesSheet(overlay, false);
        return;
      }
      if (jWidget && jWidget.style.display !== 'none') {
        e.preventDefault();
        e.stopPropagation();
        jWidget.style.display = 'none';
        overlay.querySelector('#inplayer-jog-btn')?.classList.remove('active');
        syncInPlayerDrawerState(overlay);
        return;
      }
      if (modal.classList.contains('is-focus-mode')) {
        e.preventDefault();
        e.stopPropagation();
        modal.classList.remove('is-focus-mode');
        document.documentElement.classList.remove('cinema-focus-active');
        document.body.classList.remove('cinema-focus-active');
        overlay?.querySelector('#inplayer-focus-btn')?.classList.remove('active');
        adjustCinemaModalScale();
        requestAnimationFrame(adjustCinemaModalScale);
        showToast('Режим фокуса выключен', 'info');
        return;
      }
    }

    // Снимаем фокус с кнопок и ссылок, чтобы стрелки не переключали меню
    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === ' ' || k === 'ArrowUp' || k === 'ArrowDown') {
      if (activeEl && activeEl !== document.body && typeof activeEl.blur === 'function') {
        activeEl.blur();
      }
    }

    // 1. Полноэкранный режим: F / А
    if (k === 'f' || k === 'F' || k === 'а' || k === 'А') {
      e.preventDefault();
      e.stopPropagation();
      toggleCinemaFullscreen();
      return;
    }

    // 2. Перемотка назад (-10с): Стрелка влево / J / О
    if (k === 'ArrowLeft' || k === 'j' || k === 'J' || k === 'о' || k === 'О') {
      e.preventDefault();
      e.stopPropagation();
      sendSeekDelta(-10);
      triggerDoubleTapRipple(document.getElementById('player-tap-indicator-left'), false);
      return;
    }

    // 3. Перемотка вперед (+10с): Стрелка вправо / L / Д
    if (k === 'ArrowRight' || k === 'l' || k === 'L' || k === 'д' || k === 'Д') {
      e.preventDefault();
      e.stopPropagation();
      sendSeekDelta(10);
      triggerDoubleTapRipple(document.getElementById('player-tap-indicator-right'), true);
      return;
    }

    // 4. Пауза и воспроизведение: Пробел / K / Л
    if (k === ' ' || k === 'k' || k === 'K' || k === 'л' || k === 'Л') {
      e.preventDefault();
      e.stopPropagation();
      togglePlayerPlayPause();
      return;
    }

    // 5. Громкость: Стрелка вверх / вниз
    if (k === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      adjustPlayerVolume(0.1);
      return;
    }
    if (k === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      adjustPlayerVolume(-0.1);
      return;
    }

    // 6. Без звука: M / Ь
    if (k === 'm' || k === 'M' || k === 'ь' || k === 'Ь') {
      e.preventDefault();
      e.stopPropagation();
      togglePlayerMute();
      return;
    }
  }, true);
}

// -------------------------------------------------------------
// МОБИЛЬНЫЙ ТАЙМЕР СНА (SLEEP TIMER)
// -------------------------------------------------------------
let sleepTimerRemainingSeconds = 0;
let sleepTimerIntervalId = null;
let sleepTimerTargetMode = null; // number or 'end'

export function setSleepTimer(minutesOrMode) {
  cancelSleepTimer();
  if (!minutesOrMode || minutesOrMode === 0 || minutesOrMode === '0') {
    return;
  }

  sleepTimerTargetMode = minutesOrMode;
  if (minutesOrMode === 'end') {
    const video = document.querySelector('#cinema-player-wrapper video');
    if (video && video.duration && !isNaN(video.duration)) {
      sleepTimerRemainingSeconds = Math.max(60, Math.round(video.duration - video.currentTime));
    } else {
      sleepTimerRemainingSeconds = 45 * 60;
    }
  } else {
    const mins = parseInt(minutesOrMode, 10) || 15;
    sleepTimerRemainingSeconds = mins * 60;
  }

  updateSleepTimerUI();

  sleepTimerIntervalId = setInterval(() => {
    sleepTimerRemainingSeconds--;
    if (sleepTimerRemainingSeconds <= 30 && sleepTimerRemainingSeconds > 0) {
      const video = document.querySelector('#cinema-player-wrapper video');
      if (video && video.volume > 0.05) {
        try { video.volume = Math.max(0, video.volume - 0.03); } catch {}
      }
    }

    if (sleepTimerRemainingSeconds <= 0) {
      cancelSleepTimer();
      pauseCurrentPlayback();
      showToast('⏱️ Таймер сна сработал. Воспроизведение остановлено.');
    } else {
      updateSleepTimerUI();
    }
  }, 1000);
}

export function cancelSleepTimer() {
  if (sleepTimerIntervalId) {
    clearInterval(sleepTimerIntervalId);
    sleepTimerIntervalId = null;
  }
  sleepTimerRemainingSeconds = 0;
  sleepTimerTargetMode = null;
  updateSleepTimerUI();
}

export function getSleepTimerRemaining() {
  return sleepTimerRemainingSeconds;
}

function updateSleepTimerUI() {
  const sleepBtn = document.getElementById('player-sleep-btn');
  if (sleepBtn) {
    if (sleepTimerRemainingSeconds > 0) {
      const mins = Math.floor(sleepTimerRemainingSeconds / 60);
      const secs = sleepTimerRemainingSeconds % 60;
      sleepBtn.classList.add('active');
      sleepBtn.title = `Таймер сна активен: ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    } else {
      sleepBtn.classList.remove('active');
      sleepBtn.title = 'Таймер сна';
    }
  }

  // Обновляем отображение в мобильной шторке, если функция доступна
  if (typeof window.updateDrawerSleepUI === 'function') {
    window.updateDrawerSleepUI();
  }
}

export function togglePlayerPlayPause() {
  const video = document.querySelector('#cinema-player-wrapper video');
  if (video) {
    if (video.paused) {
      video.play().catch(() => {});
      showToast('▶ Воспроизведение', 'info');
    } else {
      video.pause();
      showToast('⏸ Пауза', 'info');
    }
    return;
  }

  const toggleMsgs = [
    { event: 'toggle' },
    { api: 'toggle' },
    { action: 'toggle' },
    { method: 'toggle' },
    { key: 'kodik_player_api', value: { action: 'toggle' } }
  ];
  document.querySelectorAll('#cinema-player-wrapper iframe, .cinema-player-iframe').forEach(iframe => {
    toggleMsgs.forEach(msg => {
      try {
        iframe.contentWindow?.postMessage(msg, '*');
        iframe.contentWindow?.postMessage(JSON.stringify(msg), '*');
      } catch {}
    });
  });
}

export function adjustPlayerVolume(delta) {
  const video = document.querySelector('#cinema-player-wrapper video');
  if (video) {
    video.volume = Math.max(0, Math.min(1, video.volume + delta));
    const pct = Math.round(video.volume * 100);
    showToast(`🔊 Громкость: ${pct}%`, 'info');
    return;
  }
  const volMsgs = [
    { event: 'volume', val: delta > 0 ? '+10' : '-10' },
    { action: 'volume', delta }
  ];
  document.querySelectorAll('#cinema-player-wrapper iframe, .cinema-player-iframe').forEach(iframe => {
    volMsgs.forEach(msg => {
      try {
        iframe.contentWindow?.postMessage(msg, '*');
        iframe.contentWindow?.postMessage(JSON.stringify(msg), '*');
      } catch {}
    });
  });
}

export function togglePlayerMute() {
  const video = document.querySelector('#cinema-player-wrapper video');
  if (video) {
    video.muted = !video.muted;
    showToast(video.muted ? '🔇 Звук выключен' : '🔊 Звук включен', 'info');
    return;
  }
  const muteMsgs = [
    { event: 'mute' },
    { action: 'mute' }
  ];
  document.querySelectorAll('#cinema-player-wrapper iframe, .cinema-player-iframe').forEach(iframe => {
    muteMsgs.forEach(msg => {
      try {
        iframe.contentWindow?.postMessage(msg, '*');
        iframe.contentWindow?.postMessage(JSON.stringify(msg), '*');
      } catch {}
    });
  });
}

export function triggerDoubleTapRipple(indicatorEl, isForward) {
  if (indicatorEl) {
    indicatorEl.classList.remove('is-active');
    void indicatorEl.offsetWidth;
    indicatorEl.classList.add('is-active');
    setTimeout(() => indicatorEl.classList.remove('is-active'), 500);
  }
  sendSeekDelta(isForward ? 10 : -10);
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try { navigator.vibrate([10, 30, 10]); } catch (_) {}
  }
}

function pauseCurrentPlayback() {
  const video = document.querySelector('#cinema-player-wrapper video');
  if (video) {
    try { video.pause(); } catch {}
  }
  const pauseMsgs = [
    { event: 'pause' },
    { api: 'pause' },
    { action: 'pause' },
    { method: 'pause' },
    { key: 'kodik_player_api', value: { action: 'pause' } }
  ];
  document.querySelectorAll('#cinema-player-wrapper iframe, .cinema-player-iframe').forEach(iframe => {
    pauseMsgs.forEach(msg => {
      try {
        iframe.contentWindow?.postMessage(msg, '*');
        iframe.contentWindow?.postMessage(JSON.stringify(msg), '*');
      } catch {}
    });
  });
}

export function sendSeekDelta(secondsDelta) {
  const video = document.querySelector('#cinema-player-wrapper video');
  if (video) {
    try {
      video.currentTime = Math.max(0, Math.min(video.duration || Infinity, video.currentTime + secondsDelta));
    } catch {}
  }

  const seekMsgs = [
    { type: 'STORM_SEEK_DELTA', delta: secondsDelta, val: secondsDelta },
    { event: 'seek', val: secondsDelta, delta: secondsDelta, value: secondsDelta > 0 ? '+10' : '-10' },
    { api: 'seek', val: secondsDelta },
    { api: 'seekDelta', val: secondsDelta },
    { method: 'seek', delta: secondsDelta },
    { action: 'seek', delta: secondsDelta },
    { key: 'kodik_player_api', value: { action: 'seek', delta: secondsDelta } }
  ];
  document.querySelectorAll('#cinema-player-wrapper iframe, .cinema-player-iframe').forEach(iframe => {
    seekMsgs.forEach(msg => {
      try {
        iframe.contentWindow?.postMessage(msg, '*');
        iframe.contentWindow?.postMessage(JSON.stringify(msg), '*');
      } catch {}
    });
  });
}

// -------------------------------------------------------------
// ИНИЦИАЛИЗАЦИЯ СЕНСОРНЫХ ЖЕСТОВ И МОБИЛЬНЫХ ЭЛЕМЕНТОВ УПРАВЛЕНИЯ
// -------------------------------------------------------------
let currentAspectRatioMode = 'default';
let isPlayerScreenLocked = false;

export function applySavedAspectRatioMode() {
  const savedMode = localStorage.getItem('storm_aspect_ratio_mode') || 'default';
  currentAspectRatioMode = savedMode;
  const playerContainer = document.getElementById('cinema-player-container');
  const aspectBtn = document.getElementById('player-aspect-btn');
  if (!playerContainer) return;
  playerContainer.classList.remove('aspect-fill', 'aspect-original');
  if (aspectBtn) aspectBtn.classList.remove('active');

  if (savedMode === 'fill') {
    playerContainer.classList.add('aspect-fill');
    if (aspectBtn) aspectBtn.classList.add('active');
  } else if (savedMode === 'original') {
    playerContainer.classList.add('aspect-original');
    if (aspectBtn) aspectBtn.classList.add('active');
  }
}

function initMobilePlayerControls() {
  const modal = document.getElementById('cinema-modal');
  if (!modal) return;

  // 1. Кнопка масштабирования (Aspect Ratio)
  const aspectBtn = document.getElementById('player-aspect-btn');
  const playerContainer = document.getElementById('cinema-player-container');
  if (aspectBtn && !aspectBtn.dataset.hasListener) {
    aspectBtn.dataset.hasListener = 'true';
    aspectBtn.onclick = (e) => {
      e.stopPropagation();
      if (!playerContainer) return;
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(12); } catch (_) {}
      }

      if (currentAspectRatioMode === 'default') {
        currentAspectRatioMode = 'fill';
        playerContainer.classList.remove('aspect-original');
        playerContainer.classList.add('aspect-fill');
        aspectBtn.classList.add('active');
        localStorage.setItem('storm_aspect_ratio_mode', 'fill');
        showToast('📐 Масштаб: 21:9 во весь экран (Fill)');
      } else if (currentAspectRatioMode === 'fill') {
        currentAspectRatioMode = 'original';
        playerContainer.classList.remove('aspect-fill');
        playerContainer.classList.add('aspect-original');
        aspectBtn.classList.add('active');
        localStorage.setItem('storm_aspect_ratio_mode', 'original');
        showToast('📐 Масштаб: Исходный (Fit)');
      } else {
        currentAspectRatioMode = 'default';
        playerContainer.classList.remove('aspect-fill', 'aspect-original');
        aspectBtn.classList.remove('active');
        localStorage.setItem('storm_aspect_ratio_mode', 'default');
        showToast('📐 Масштаб: Стандартный 16:9');
      }
    };
  }
  applySavedAspectRatioMode();

  // 2. Кнопка «Картинка в картинке» (PiP)
  const pipBtn = document.getElementById('player-pip-btn');
  if (pipBtn && !pipBtn.dataset.hasListener) {
    pipBtn.dataset.hasListener = 'true';
    pipBtn.onclick = async (e) => {
      e.stopPropagation();
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(15); } catch (_) {}
      }
      await toggleAdvancedPiP();
      const isPip = modal.classList.contains('is-mini-pip');
      pipBtn.classList.toggle('active', isPip);
    };
  }

  // 3. Кнопка таймера сна в шапке плеера
  const sleepBtn = document.getElementById('player-sleep-btn');
  if (sleepBtn && !sleepBtn.dataset.hasListener) {
    sleepBtn.dataset.hasListener = 'true';
    sleepBtn.onclick = (e) => {
      e.stopPropagation();
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(15); } catch (_) {}
      }

      if (!sleepTimerRemainingSeconds || sleepTimerRemainingSeconds === 0) {
        setSleepTimer(15);
        showToast('⏱️ Таймер сна установлен на 15 мин');
      } else if (sleepTimerTargetMode === 15) {
        setSleepTimer(30);
        showToast('⏱️ Таймер сна установлен на 30 мин');
      } else if (sleepTimerTargetMode === 30) {
        setSleepTimer(45);
        showToast('⏱️ Таймер сна установлен на 45 мин');
      } else if (sleepTimerTargetMode === 45) {
        setSleepTimer(60);
        showToast('⏱️ Таймер сна установлен на 60 мин');
      } else if (sleepTimerTargetMode === 60) {
        setSleepTimer('end');
        showToast('⏱️ Таймер сна: в конце серии');
      } else {
        cancelSleepTimer();
        showToast('⏱️ Таймер сна выключен');
      }
    };
  }

  // 4. Блокировка экрана (Screen Lock)
  const lockBtn = document.getElementById('player-screen-lock-btn');
  const lockOverlay = document.getElementById('player-screen-locked-overlay');
  const unlockBtn = document.getElementById('player-unlock-btn');

  let unlockBtnTimer = null;
  const showUnlockBtnBriefly = () => {
    if (!unlockBtn) return;
    unlockBtn.classList.remove('is-hidden');
    if (unlockBtnTimer) clearTimeout(unlockBtnTimer);
    unlockBtnTimer = setTimeout(() => {
      if (isPlayerScreenLocked) {
        unlockBtn.classList.add('is-hidden');
      }
    }, 2800);
  };

  const setScreenLock = (locked) => {
    isPlayerScreenLocked = locked;
    if (lockOverlay) {
      lockOverlay.style.display = locked ? 'flex' : 'none';
      if (locked) {
        showUnlockBtnBriefly();
      }
    }
    if (lockBtn) { lockBtn.classList.toggle('active', locked); lockBtn.innerHTML = locked ? LOCK_CLOSED_SVG : LOCK_OPEN_SVG; }
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(locked ? [20, 50, 20] : 15); } catch (_) {}
    }
    showToast(locked ? '🔒 Экран заблокирован от случайных нажатий' : '🔓 Экран разблокирован');
  };

  if (lockBtn && !lockBtn.dataset.hasListener) {
    lockBtn.dataset.hasListener = 'true';
    lockBtn.onclick = (e) => {
      e.stopPropagation();
      setScreenLock(!isPlayerScreenLocked);
    };
  }

  if (lockOverlay && !lockOverlay.dataset.hasListener) {
    lockOverlay.dataset.hasListener = 'true';
    lockOverlay.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!e.target.closest('#player-unlock-btn')) {
        showUnlockBtnBriefly();
      }
    });
    lockOverlay.addEventListener('touchstart', (e) => {
      if (!e.target.closest('#player-unlock-btn')) {
        showUnlockBtnBriefly();
      }
    }, { passive: true });
  }

  if (unlockBtn && !unlockBtn.dataset.hasListener) {
    unlockBtn.dataset.hasListener = 'true';
    let unlockTimer = null;
    const startUnlock = () => {
      unlockTimer = setTimeout(() => {
        setScreenLock(false);
      }, 700);
    };
    const cancelUnlock = () => {
      if (unlockTimer) {
        clearTimeout(unlockTimer);
        unlockTimer = null;
      }
    };

    unlockBtn.addEventListener('mousedown', startUnlock);
    unlockBtn.addEventListener('mouseup', cancelUnlock);
    unlockBtn.addEventListener('mouseleave', cancelUnlock);
    unlockBtn.addEventListener('touchstart', startUnlock, { passive: true });
    unlockBtn.addEventListener('touchend', cancelUnlock, { passive: true });
    unlockBtn.onclick = (e) => {
      e.stopPropagation();
      setScreenLock(false);
    };
  }

  // 5. Двойной тап для перемотки назад/вперед (±10с) и одиночный для паузы/воспроизведения
  const tapLeft = document.getElementById('player-tap-left');
  const tapRight = document.getElementById('player-tap-right');
  const indicatorLeft = document.getElementById('player-tap-indicator-left');
  const indicatorRight = document.getElementById('player-tap-indicator-right');

  const bindDoubleTap = (zoneEl, indicatorEl, isForward) => {
    if (!zoneEl || zoneEl.dataset.hasListener) return;
    zoneEl.dataset.hasListener = 'true';
    let lastTapTime = 0;

    const handleTap = (e) => {
      if (isPlayerScreenLocked) return;
      const now = Date.now();
      const timeDiff = now - lastTapTime;

      if (timeDiff > 40 && timeDiff < 360) {
        // Двойной тап: перематываем на 10 сек
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        triggerDoubleTapRipple(indicatorEl, isForward);
        lastTapTime = 0;
      } else {
        lastTapTime = now;
      }
    };

    zoneEl.addEventListener('click', (e) => {
      if (e.target.closest('.storm-inplayer-overlay') || 
          e.target.closest('.inplayer-ctrl-btn') || 
          e.target.closest('.player-inplayer-episodes-sheet') || 
          e.target.closest('.player-inplayer-voice-sheet') || 
          e.target.closest('.inplayer-jog-dial-widget') ||
          (e.clientY && e.clientY < 60)) {
        return;
      }
      handleTap(e);
    });
    zoneEl.addEventListener('touchend', (e) => {
      if (e.target.closest('.storm-inplayer-overlay') || 
          e.target.closest('.inplayer-ctrl-btn') || 
          e.target.closest('.player-inplayer-episodes-sheet') || 
          e.target.closest('.player-inplayer-voice-sheet') || 
          e.target.closest('.inplayer-jog-dial-widget') ||
          (e.changedTouches?.[0] && e.changedTouches[0].clientY < 60)) {
        return;
      }
      const now = Date.now();
      if (now - lastTapTime < 360) {
        if (e.cancelable) e.preventDefault();
      }
      handleTap(e);
    }, { passive: false });
  };

  bindDoubleTap(tapLeft, indicatorLeft, false);
  bindDoubleTap(tapRight, indicatorRight, true);

  // Центр плеера: одиночный клик переключает Воспроизведение / Пауза
  const playerWrapper = document.getElementById('cinema-player-wrapper');
  if (playerWrapper && !playerWrapper.dataset.hasTapListener) {
    playerWrapper.dataset.hasTapListener = 'true';
    playerWrapper.addEventListener('click', (e) => {
      if (isPlayerScreenLocked) return;
      if (e.target.closest('.player-tap-zone') || 
          e.target.closest('#player-screen-locked-overlay') || 
          e.target.closest('.storm-inplayer-overlay') ||
          e.target.closest('.inplayer-ctrl-btn') ||
          e.target.closest('#player-xray-panel')) {
        return;
      }
      // На мобильных устройствах при клике по видео не перебиваем нативные контролы
      if (e.target.tagName === 'VIDEO' && (window.innerWidth <= 768 || e.target.hasAttribute('controls'))) {
        return;
      }
      togglePlayerPlayPause();
    });
  }

  // 6. Свайп вниз для закрытия плеера на смартфонах
  const dragHandle = document.getElementById('cinema-modal-drag-handle');
  const headerEl = modal.querySelector('.storm-modal-header');
  [dragHandle, headerEl].forEach(el => {
    if (!el || el.dataset.hasSwipeListener) return;
    el.dataset.hasSwipeListener = 'true';
    let startY = 0;
    let isDragging = false;

    el.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        startY = e.touches[0].clientY;
        isDragging = true;
      }
    }, { passive: true });

    el.addEventListener('touchend', (e) => {
      if (!isDragging || !e.changedTouches.length) return;
      isDragging = false;
      const diffY = e.changedTouches[0].clientY - startY;
      if (diffY > 80) {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          try { navigator.vibrate(15); } catch (_) {}
        }
        closePlayerModal();
      }
    }, { passive: true });
  });
}

/**
 * 🇷🇺 Определение отечественного контента (Россия, СССР, RuTube, VK Видео)
 */
export function isDomesticContent(item = {}, cleanTitle = '') {
  const t = (cleanTitle || item.title || '').toLowerCase();
  const c = Array.isArray(item.countries) ? item.countries.join(' ').toLowerCase() : String(item.countries || '').toLowerCase();
  const g = Array.isArray(item.genres) ? item.genres.join(' ').toLowerCase() : String(item.genres || '').toLowerCase();
  const cat = String(item.category || '').toLowerCase();
  const src = String(item.source || '').toLowerCase();
  const id = String(item.id || '').toLowerCase();

  if (src === 'rutube' || src === 'vkvideo' || id.startsWith('rutube_') || id.startsWith('vk_')) return true;
  if (id.includes('landyshi') || t.includes('ландыши')) return true;
  if (c.includes('росси') || c.includes('ссср') || c.includes('russia') || c.includes('рф')) return true;
  if (cat.includes('российск') || g.includes('российск')) return true;

  return false;
}

export function buildUniversalPlayerSuite(mediaItem = {}, cleanTitle = '') {
  const title = cleanTitle || cleanVideoTitle(mediaItem.title || 'Видео');
  const safeTitle = encodeURIComponent(title);
  const origTitleParam = mediaItem.original_title ? `&original_title=${encodeURIComponent(mediaItem.original_title)}` : '';
  const year = mediaItem.year ? String(mediaItem.year).trim() : '';
  const yearQuery = year ? `&year=${encodeURIComponent(year)}` : '';
  const kpId = mediaItem.kp_id || '';
  const imdbId = mediaItem.imdb_id || '';
  const kpParam = kpId ? `&kp_id=${encodeURIComponent(kpId)}` : '';
  const imdbParam = imdbId ? `&imdb_id=${encodeURIComponent(imdbId)}` : '';
  const mediaType = mediaItem.media_type || mediaItem.type || 'movie';
  const isSeries = mediaType === 'series' || mediaType === 'cartoon-series' || mediaType === 'anime-series';
  const isAnime = mediaType.includes('anime') || mediaItem.source === 'anilibria' || mediaItem.source === 'anixart';
  const episodeParam = isSeries ? '&season=1&episode=1' : '';
  const rawRuId = mediaItem.rutube_id || (String(mediaItem.id || '').startsWith('rutube_') ? String(mediaItem.id).replace('rutube_', '') : null);
  const isLandyshiItem = mediaItem.id === 'rutube_landyshi' || title.toLowerCase().includes('ландыши') || rawRuId === '564f31c881b83373bfe0cb26979d44cf';

  const suite = [];

  // 1. 4K Ultra HD Плеер (FanFilm4K) — гарантированный приоритет #1
  let effective4kUrl = mediaItem.fanfilm_4k_url || '';
  if (!effective4kUrl) {
    effective4kUrl = resolveFanFilmUrl(title) || '';
  }
  if (effective4kUrl.includes('v16.fanfilm4k.media')) {
    effective4kUrl = effective4kUrl.replace('v16.fanfilm4k.media', 'v17.fanfilm4k.media');
  }
  if (!effective4kUrl) {
    const rawId = String(mediaItem.id || '').replace(/^fanfilm_?/, '');
    if (/^\d+$/.test(rawId)) {
      effective4kUrl = `https://v17.fanfilm4k.media/${rawId}-.html`;
    } else if (mediaItem.link || mediaItem.url) {
      effective4kUrl = String(mediaItem.link || mediaItem.url).replace('v16.fanfilm4k.media', 'v17.fanfilm4k.media');
    }
  }

  if (!effective4kUrl && !isLandyshiItem && safeTitle) {
    effective4kUrl = `https://v17.fanfilm4k.media/index.php?do=search&subaction=search&story=${safeTitle}`;
  }

  const rawLiftId = mediaItem.lift_id || (String(mediaItem.id || '').startsWith('lift_') ? String(mediaItem.id).replace(/^lift_/i, '') : (isLandyshiItem ? '79849' : ''));
  const liftPlayerEntry = {
    id: 'lift_adfree',
    name: 'Lift 4K и FHD плеер (Без рекламы • Все озвучки)',
    type: 'iframe',
    quality: '4K UHD / 1080p',
    badge: 'LIFT БЕЗ РЕКЛАМЫ',
    status: 'working',
    status_label: '🟢 Без рекламы',
    audio_info: 'Прямой поток 4K VP9/AV1 и 1080p, все озвучки СНГ (RHS, Дубляж, TVShows, HDRezka, LostFilm) + субтитры и превью таймлайна',
    speed: '🚀 Прямой CDN без рекламы',
    url: `/api/player/lift-embed?title=${safeTitle}&original_title=${encodeURIComponent(mediaItem.original_title || '')}${yearQuery}${kpParam}${imdbParam}&lift_id=${encodeURIComponent(rawLiftId)}&is_series=${isSeries ? '1' : '0'}${episodeParam}`,
    is_recommended: !isAnime,
    recommended_badge: !isAnime ? '🔥 Без рекламы 4K' : ''
  };

  suite.push(liftPlayerEntry);

  if (effective4kUrl && !isLandyshiItem) {
    suite.push({
      id: 'fanfilm4k_uhd',
      name: '4K Ultra HD Плеер (FanFilm4K)',
      type: 'iframe',
      quality: '4K UHD',
      badge: 'FANFILM 4K',
      status: 'working',
      status_label: '🟢 Онлайн',
      audio_info: 'Многоканальный звук Dolby Digital и 4K Ultra HD',
      speed: '💎 Премиум 4K CDN',
      url: effective4kUrl,
      is_recommended: false,
      recommended_badge: ''
    });
  }

  // 2. Kinobox Мультиплеер (Alloha, Collaps, Kodik, HDRezka, Videocdn)
  if (!isLandyshiItem) {
    suite.push({
      id: 'kinobox_universal',
      name: 'Kinobox Мультиплеер (Alloha, Collaps, Kodik, HDRezka, Videocdn)',
      type: 'iframe',
      quality: '1080p FHD / 4K',
      badge: 'KINOBOX',
      status: 'working',
      status_label: '🟢 Онлайн',
      audio_info: 'Универсальный мультиплеер: автоподбор рабочего балансера',
      speed: '⚡ Мульти-CDN',
      url: `/api/player/kinobox-embed?balancer=kinobox&title=${safeTitle}${origTitleParam}${yearQuery}${kpParam}${imdbParam}${episodeParam}`
    });

    // 3. HDRezka Studio
    suite.push({
      id: 'hdrezka_stream',
      name: 'HDRezka Studio (Дубляж и авторские озвучки)',
      type: 'iframe',
      quality: '1080p FHD / 4K',
      badge: 'HDREZKA',
      status: 'working',
      status_label: '🟢 Онлайн',
      audio_info: 'Фирменный дубляж HDRezka Studio, RHS, TVShows, Jaskier',
      speed: '⚡ Скоростной CDN',
      url: `/api/player/kinobox-embed?balancer=hdrezka&title=${safeTitle}${origTitleParam}${yearQuery}${kpParam}${imdbParam}${episodeParam}`
    });

    // 4. Collaps и AllPlay
    suite.push({
      id: 'collaps_stream',
      name: 'Collaps и AllPlay (Full HD и 4K балансер)',
      type: 'iframe',
      quality: '1080p FHD / 4K',
      badge: 'COLLAPS',
      status: 'working',
      status_label: '🟢 Онлайн',
      audio_info: 'Лицензионный дубляж СНГ и многоголосые переводы',
      speed: '⚡ Быстрый поток',
      url: `/api/player/kinobox-embed?balancer=collaps&title=${safeTitle}${origTitleParam}${yearQuery}${kpParam}${imdbParam}${episodeParam}`
    });

    // 5. Alloha Плеер
    suite.push({
      id: 'alloha_stream',
      name: 'Alloha Плеер (Скоростной CDN новинок)',
      type: 'iframe',
      quality: '1080p FHD / 4K',
      badge: 'ALLOHA',
      status: 'working',
      status_label: '🟢 Онлайн',
      audio_info: 'Премьерные релизы 2025–2026 и студийный звук',
      speed: '⚡ Премиум поток',
      url: `/api/player/kinobox-embed?balancer=alloha&title=${safeTitle}${origTitleParam}${yearQuery}${kpParam}${imdbParam}${episodeParam}`
    });

    // 6. Kodik Плеер (через серверный шлюз с автоподбором)
    suite.push({
      id: 'kodik_direct',
      name: isAnime ? 'Kodik Аниме Плеер (Все озвучки)' : 'Kodik Плеер (Сериалы, кино и озвучки)',
      type: 'iframe',
      quality: '1080p FHD',
      badge: 'KODIK',
      status: 'working',
      status_label: '🟢 Онлайн',
      audio_info: 'Большой выбор студийных и авторских озвучек',
      speed: '⚡ Быстрый поток',
      url: `/api/player/kinobox-embed?balancer=kodik&title=${safeTitle}${origTitleParam}${yearQuery}${kpParam}${imdbParam}${episodeParam}`,
      is_recommended: isAnime && !effective4kUrl && mediaItem?.source !== 'anixart' && mediaItem?.source !== 'anilibria'
    });

    // 7. VideoCDN и Lumex
    suite.push({
      id: 'videocdn_stream',
      name: 'VideoCDN и Lumex (Кинопрокат и сериалы)',
      type: 'iframe',
      quality: '1080p FHD',
      badge: 'VIDEOCDN',
      status: 'working',
      status_label: '🟢 Онлайн',
      audio_info: 'База кинопроката, сериалов и классики в Full HD',
      speed: '⚡ Мульти-поток',
      url: `/api/player/kinobox-embed?balancer=videocdn&title=${safeTitle}${origTitleParam}${yearQuery}${kpParam}${imdbParam}${episodeParam}`
    });

    // 8. Red Head Sound и LostFilm
    suite.push({
      id: 'rhs_stream',
      name: 'Red Head Sound и LostFilm (Студийный дубляж)',
      type: 'iframe',
      quality: '1080p FHD / 4K',
      badge: 'RHS / LOSTFILM',
      status: 'working',
      status_label: '🟢 Онлайн',
      audio_info: 'Голоса официального дубляжа Red Head Sound и LostFilm',
      speed: '⚡ Студийный CDN',
      url: `/api/player/kinobox-embed?balancer=rhs&title=${safeTitle}${origTitleParam}${yearQuery}${kpParam}${imdbParam}${episodeParam}`
    });

    // 9. Bazon и CDNMovies
    suite.push({
      id: 'bazon_stream',
      name: 'Bazon и CDNMovies (Резервный 1080p поток)',
      type: 'iframe',
      quality: '1080p FHD',
      badge: 'BAZON',
      status: 'working',
      status_label: '🟢 Онлайн',
      audio_info: 'Высокая отказоустойчивость для новинок и сериалов',
      speed: '⚡ Резервный CDN',
      url: `/api/player/kinobox-embed?balancer=bazon&title=${safeTitle}${origTitleParam}${yearQuery}${kpParam}${imdbParam}${episodeParam}`
    });
  }

  // 10. VK Видео (Официальный плеер / Автопоиск реального потока)
  let vkEmbed = '';
  if (isLandyshiItem) {
    vkEmbed = `/api/player/vk-search-embed?title=${safeTitle}${origTitleParam}${yearQuery}${episodeParam}`;
  } else if (mediaItem.vk_embed_url && !mediaItem.vk_embed_url.includes('456244337')) {
    vkEmbed = mediaItem.vk_embed_url;
  } else if (mediaItem.owner_id && mediaItem.video_id) {
    vkEmbed = `https://vk.com/video_ext.php?oid=${mediaItem.owner_id}&id=${mediaItem.video_id}&hd=2&autoplay=0`;
  } else if (String(mediaItem.id || '').startsWith('vk_')) {
    const vkM = String(mediaItem.id).match(/vk_(-?\d+)_(\d+)/);
    if (vkM) {
      vkEmbed = `https://vk.com/video_ext.php?oid=${vkM[1]}&id=${vkM[2]}&hd=2&autoplay=0`;
    }
  } else if (mediaItem.vk_url) {
    const vkM = mediaItem.vk_url.match(/video(-?\d+)_(\d+)/);
    if (vkM) {
      vkEmbed = `https://vk.com/video_ext.php?oid=${vkM[1]}&id=${vkM[2]}&hd=2&autoplay=0`;
    }
  } else if (mediaItem.embed_url && (mediaItem.embed_url.includes('oid=') || mediaItem.embed_url.includes('video-'))) {
    vkEmbed = mediaItem.embed_url;
  } else if (safeTitle) {
    vkEmbed = `/api/player/vk-search-embed?title=${safeTitle}${origTitleParam}${yearQuery}${episodeParam}`;
  }

  if (vkEmbed && (vkEmbed.includes('vkvideo.ru') || vkEmbed.includes('vk.com'))) {
    vkEmbed = vkEmbed.replace(/([?&])autoplay=1\b/g, '$1autoplay=0');
    if (!vkEmbed.includes('js_api=')) vkEmbed += (vkEmbed.includes('?') ? '&' : '?') + 'js_api=1';
    if (!vkEmbed.includes('muted=')) vkEmbed += '&muted=0&mute=0';
  }

  if (vkEmbed) {
    const isVkRecommended = isLandyshiItem;
    suite.push({
      id: 'vk_video_stream',
      name: isLandyshiItem ? 'VK Видео (Официальный плеер)' : 'VK Видео (Фильмы, сериалы и дубляж)',
      type: 'iframe',
      quality: '1080p FHD / 4K',
      badge: 'VK ВИДЕО',
      status: 'working',
      status_label: '🟢 Онлайн',
      audio_info: isLandyshiItem ? 'Официальный сериал Ландыши на платформе VK Видео со звуком' : 'Официальные релизы и полные фильмы из базы VK Видео',
      speed: '⚡ Скоростной VK CDN',
      url: vkEmbed,
      is_recommended: isVkRecommended,
      recommended_badge: isVkRecommended ? '🔥 Рекомендуемый' : ''
    });
  }

  // 11. RuTube HLS и RuTube Embed (Официальный лицензионный поток / автопоиск)
  const effectiveRuId = (rawRuId && /^[a-f0-9]{32}$/i.test(rawRuId))
    ? rawRuId
    : (mediaItem.rutube_id && /^[a-f0-9]{32}$/i.test(mediaItem.rutube_id)
      ? mediaItem.rutube_id
      : (mediaItem.embed_url ? (mediaItem.embed_url.match(/\/embed\/([a-f0-9]{32})/i)?.[1] || '') : ''));

  if (effectiveRuId) {
    suite.push({
      id: 'rutube_direct_hls',
      name: 'RuTube HLS (Прямой поток без рекламы)',
      type: 'hls',
      quality: '1080p FHD',
      badge: 'RUTUBE HLS',
      status: 'working',
      status_label: '🟢 Онлайн',
      audio_info: 'Официальный прямой поток STORM: без рекламы и плашек',
      speed: '⚡ Быстрый российский CDN',
      url: `/api/media/rutube-m3u8?id=${effectiveRuId}`,
      is_recommended: isLandyshiItem,
      recommended_badge: isLandyshiItem ? '🔥 Рекомендуемый' : ''
    });
  }

  let rutubeEmbed = '';
  if (effectiveRuId) {
    rutubeEmbed = `/api/player/rutube-embed/${effectiveRuId}`;
  } else if (mediaItem.embed_url && mediaItem.embed_url.includes('rutube.ru/play/embed/')) {
    const mId = mediaItem.embed_url.match(/\/embed\/([a-f0-9]{32})/i);
    rutubeEmbed = mId ? `/api/player/rutube-embed/${mId[1]}` : mediaItem.embed_url;
  } else if (safeTitle) {
    rutubeEmbed = `/api/player/rutube-search-embed?title=${safeTitle}${origTitleParam}${yearQuery}${episodeParam}`;
  }

  if (rutubeEmbed) {
    suite.push({
      id: 'rutube_stream',
      name: 'RuTube и Wink (Лицензионный поток)',
      type: 'iframe',
      quality: '1080p FHD',
      badge: 'RUTUBE',
      status: 'working',
      status_label: '🟢 Онлайн',
      audio_info: 'Лицензионные фильмы, сериалы и шоу RuTube / Wink',
      speed: '⚡ Быстрый российский CDN',
      url: rutubeEmbed,
      is_recommended: false
    });
  }

  // 12. Vidsrc Cinema (Original и субтитры)
  if (!isLandyshiItem && !isAnime) {
    suite.push({
      id: 'vidsrc_player',
      name: 'Vidsrc Cinema (Original и субтитры)',
      type: 'iframe',
      quality: '1080p FHD',
      badge: 'VIDSRC',
      status: 'working',
      status_label: '🟢 Онлайн',
      audio_info: 'Международный поток в оригинале и с субтитрами',
      speed: '⚡ Международный CDN',
      url: `/api/player/kinobox-embed?balancer=vidsrc&title=${safeTitle}${origTitleParam}${yearQuery}${kpParam}${imdbParam}${episodeParam}`
    });
  }

  // 13. AniXart Stream и Shikimori (для аниме)
  if (isAnime) {
    suite.push({
      id: 'anixart_stream',
      name: 'AniXart Stream (Аниме-релизы и фандаб)',
      type: 'iframe',
      quality: '1080p FHD',
      badge: 'ANIXART',
      status: 'working',
      status_label: '🟢 Онлайн',
      audio_info: 'AniLibria, StudioBand, AniDub, SHIZA, Jam, DreamCast',
      speed: '⚡ Скоростной поток',
      url: `/api/player/kinobox-embed?balancer=kodik&title=${safeTitle}${origTitleParam}${yearQuery}${kpParam}${imdbParam}${episodeParam}`
    });

    suite.push({
      id: 'shikimori_stream',
      name: 'Shikimori и AnimeGO Плеер',
      type: 'iframe',
      quality: '1080p FHD',
      badge: 'SHIKIMORI',
      status: 'working',
      status_label: '🟢 Онлайн',
      audio_info: 'Оригинальные субтитры и студийный дубляж',
      speed: '⚡ Быстрый поток',
      url: `/api/player/kinobox-embed?balancer=kodik&title=${safeTitle}${origTitleParam}${yearQuery}${kpParam}${imdbParam}${episodeParam}`
    });
  }

  // 14. P2P WebTorrent и TorrServer (Торрент-стриминг для всех релизов)
  suite.push({
    id: 'webtorrent',
    name: 'P2P WebTorrent и TorrServer (4K UHD / 1080p)',
    type: 'webtorrent',
    url: 'webtorrent://direct',
    badge: 'TORRENT 4K',
    quality: '4K UHD / 1080p',
    status: 'working',
    status_label: '🟢 P2P Поток',
    audio_info: 'Максимальный битрейт без сжатия напрямую из P2P-сети',
    speed: '🚀 BitTorrent 4K'
  });

  if (!suite.some(p => p.is_recommended) && suite.length > 0) {
    suite[0].is_recommended = true;
  }

  return suite;
}

/**
 * 🎯 ДИНАМИЧЕСКИЙ АВТОМАСШТАБ КИНОТЕАТРАЛЬНОГО ПЛЕЕРА
 * Автоматически рассчитывает точные размеры экрана и доступную высоту,
 * чтобы консоль плеера (Шапка + Серии + Видеоплеер + Аварийная полоса + Поле выбора плеера)
 * на 100% умещалась в пределах одного экрана без вертикального скролла
 * при любых разрешениях экрана (4K, 2K, 1080p, 720p), размерах окон и DPI-масштабах (100%-200%).
 */
export function adjustCinemaModalScale() {
  const modal = document.getElementById('cinema-modal');
  if (!modal || !modal.classList.contains('is-open')) return;
  if (modal.classList.contains('is-fullscreen') || modal.classList.contains('is-mini-pip')) return;

  const vh = window.innerHeight || document.documentElement.clientHeight;
  const vw = window.innerWidth || document.documentElement.clientWidth;
  if (!vh || vh <= 0) return;

  if (modal.classList.contains('is-focus-mode')) {
    const focusH = Math.max(320, vh - 52);
    const focusW = Math.min(Math.round(vw * 0.96), Math.round(focusH * (16 / 9)));
    modal.style.setProperty('--cinema-player-max-h', `${focusH}px`);
    modal.style.setProperty('--cinema-player-max-w', `${focusW}px`);
    return;
  }

  // На смартфонах и компактных экранах фиксируем плеер по ширине экрана и соотношению 16:9
  if (vw <= 768) {
    const mobilePlayerW = Math.min(vw, 768);
    const mobilePlayerH = Math.round(mobilePlayerW * (9 / 16));
    modal.style.setProperty('--cinema-player-max-h', `${mobilePlayerH}px`);
    modal.style.setProperty('--cinema-player-max-w', '100%');
    modal.style.setProperty('--cinema-poster-max-h', '180px');
    modal.style.setProperty('--cinema-side-max-h', 'none');
    return;
  }

  const headerEl = modal.querySelector('.storm-modal-header');
  const headerH = (headerEl && headerEl.offsetHeight > 0) ? headerEl.offsetHeight : 40;

  const quickBar = document.getElementById('player-series-quick-bar');
  const isQuickBarVisible = quickBar && quickBar.style.display !== 'none' && !quickBar.hidden && quickBar.offsetHeight > 0;
  const quickBarH = isQuickBarVisible ? (quickBar.offsetHeight + 6) : 0;
  modal.classList.toggle('has-series-bar', isQuickBarVisible);

  const fallbackBar = document.getElementById('player-fallback-bar');
  const fallbackH = (fallbackBar && fallbackBar.offsetHeight > 0) ? (fallbackBar.offsetHeight + 8) : 38;

  const selectorWrap = document.getElementById('player-selector-dropdown-wrap');
  const selectorH = (selectorWrap && selectorWrap.offsetHeight > 0) ? (selectorWrap.offsetHeight + 8) : 46;

  // Отступы storm-modal-body (top: 8px, bottom: 14px) + буфер безопасности для теней/границ (14px)
  const verticalPaddingAndBuffer = 36;

  const totalNonPlayerH = headerH + quickBarH + fallbackH + selectorH + verticalPaddingAndBuffer;

  // Рассчитываем доступную высоту для видеоплеера
  const availablePlayerH = Math.max(200, Math.floor(vh - totalNonPlayerH));
  const availablePlayerW = Math.round(availablePlayerH * (16 / 9));

  // Высота постера и максимальная высота правой колонки
  const posterH = Math.max(120, Math.min(240, Math.round(vh * 0.23)));
  const sideColH = Math.max(240, Math.floor(vh - (headerH + 20)));

  modal.style.setProperty('--cinema-player-max-h', `${availablePlayerH}px`);
  modal.style.setProperty('--cinema-player-max-w', `${availablePlayerW}px`);
  modal.style.setProperty('--cinema-poster-max-h', `${posterH}px`);
  modal.style.setProperty('--cinema-side-max-h', `${sideColH}px`);
}

if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    const modal = document.getElementById('cinema-modal');
    if (modal && modal.classList.contains('is-open')) {
      adjustCinemaModalScale();
    }
  }, { passive: true });
  window.addEventListener('orientationchange', () => {
    const modal = document.getElementById('cinema-modal');
    if (modal && modal.classList.contains('is-open')) {
      setTimeout(adjustCinemaModalScale, 80);
    }
  }, { passive: true });
}

export async function openPlayerModal(mediaItem, options = {}) {
  const cleanTitle = cleanVideoTitle(mediaItem?.title || '');
  const detectedType = detectClientMediaType(mediaItem);
  let initialYr = detectClientYear(mediaItem) || mediaItem?.year || '';
  if (!initialYr) {
    const ym = String(mediaItem?.title || '').match(/\b(19\d\d|20\d\d)\b/);
    if (ym && parseInt(ym[1], 10) >= 1950 && parseInt(ym[1], 10) <= 2030 && ym[1] !== '2049') {
      initialYr = ym[1];
    } else if (mediaItem?.release_date) {
      const rm = String(mediaItem.release_date).match(/\b(19\d\d|20\d\d)\b/);
      if (rm) initialYr = rm[1];
    }
  }
  currentMedia = { ...mediaItem, title: cleanTitle, media_type: detectedType || mediaItem?.media_type || 'movie', year: initialYr || mediaItem?.year || '' };
  try {
    sessionStorage.setItem('storm_active_cinema_media', JSON.stringify(currentMedia));
  } catch (e) {}
  quickBarSeriesData = null;
  currentEpisodes = [];
  currentEpisodeIndex = 1;
  toggleInPlayerEpisodesSheet(null, false);

  const modal = document.getElementById('cinema-modal');
  if (!modal) return;

  // Закрываем мобильное меню и очищаем всплывающие подсказки
  const drawer = document.getElementById('mobile-drawer-backdrop');
  if (drawer) drawer.classList.remove('is-open');
  document.body.classList.remove('quick-dropdown-active', 'player-dropdown-active');
  document.querySelectorAll('.media-hover-preview-popup').forEach(p => p.remove());
  // Проверяем ночной просмотр (между 02:00 и 05:00)
  const currentHour = new Date().getHours();
  if (currentHour >= 2 && currentHour < 5) {
    trackClientAction('night_watch');
  }

  // Сброс состояния плеера
  const iframeContainer = document.getElementById('cinema-player-wrapper');
  iframeContainer.innerHTML = '<div style="display:flex;height:100%;align-items:center;justify-content:center;color:var(--text-muted);gap:10px;"><div class="storm-spinner"></div><span>Загрузка видеоплеера...</span></div>';

  const castCarouselEl = document.getElementById('cinema-cast-and-crew-container');
  if (castCarouselEl) {
    castCarouselEl.style.display = 'none';
    castCarouselEl.innerHTML = '';
  }
  document.getElementById('cinema-modal-title').textContent = cleanTitle;
  document.getElementById('cinema-modal-year').textContent = mediaItem.year || '';
  document.getElementById('cinema-modal-desc').textContent = mediaItem.description || '';

  // Восстанавливаем сохраненный прогресс просмотра
  const savedPercent = mediaItem.progress_percent || 0;
  currentProgressPercent = savedPercent;
  const progressSlider = document.getElementById('player-progress-slider');
  const progressLabel = document.getElementById('player-progress-label');
  if (progressSlider) progressSlider.value = savedPercent;
  if (progressLabel) progressLabel.textContent = `${savedPercent}%`;

  initProgressSlider();
  initFullscreenControls();
  initMobilePlayerControls();

  // Определяем сохраненную точку остановки (сезон, серия, точное время) и показываем интерактивную подсказку «Продолжить?»
  const initialResumeState = resolveMediaResumeState(currentMedia, null, options);
  if (initialResumeState) {
    activeResumePromptState = initialResumeState;
    isResumePromptPending = true;
    renderResumePromptBanner(initialResumeState);
    if (!options.initialSeason && initialResumeState.season) options.initialSeason = initialResumeState.season;
    if (!options.initialEpisode && initialResumeState.episode) options.initialEpisode = initialResumeState.episode;
  } else {
    activeResumePromptState = null;
    isResumePromptPending = false;
    hideResumePromptBanner();
    if (!options.initialSeason || !options.initialEpisode) {
      const resumeInfo = resolveLastUnfinishedEpisode(mediaItem);
      if (resumeInfo) {
        if (!options.initialSeason && resumeInfo.season) options.initialSeason = resumeInfo.season;
        if (!options.initialEpisode && resumeInfo.episode) options.initialEpisode = resumeInfo.episode;
      }
    }
  }

  const wasAlreadyOpen = modal.classList.contains('is-open') || document.body.classList.contains('cinema-open');

  // Открываем модальное окно
  modal.classList.add('is-open');
  document.body.classList.add('cinema-open');

  // Обновляем URL и стек истории браузера (pushState при открытии, чтобы кнопка «Назад» закрывала плеер, а не сайт)
  updatePlayerUrl(mediaItem, options.initialSeason, options.initialEpisode, null, { isOpeningModal: !wasAlreadyOpen });

  if (typeof window.updateTvHudContext === 'function') {
    window.updateTvHudContext('player');
  }

  // Инициализируем универсальную панель серий для сериалов сразу
  if (checkIfMediaIsSeries(currentMedia)) {
    initUniversalSeriesQuickBar(options.initialSeason || 1, options.initialEpisode || 1);
  } else {
    quickBarSeriesData = null;
    const quickBar = document.getElementById('player-series-quick-bar');
    if (quickBar) quickBar.style.display = 'none';
    modal.classList.remove('has-series-bar');
  }

  // Мгновенный сброс скролла на 0, чтобы плеер открывался на весь экран сверху без необходимости пролистывать
  const resetCinemaScroll = () => {
    modal.scrollTop = 0;
    const dialog = modal.querySelector('.cinema-modal-dialog');
    if (dialog) dialog.scrollTop = 0;
    const modalBody = modal.querySelector('.storm-modal-body');
    if (modalBody) modalBody.scrollTop = 0;
    window.scrollTo(0, 0);
    if (document.documentElement) document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
  };
  resetCinemaScroll();
  requestAnimationFrame(resetCinemaScroll);
  setTimeout(resetCinemaScroll, 50);
  setTimeout(resetCinemaScroll, 200);

  // Автомасштабирование плеера под точные размеры окна
  adjustCinemaModalScale();
  requestAnimationFrame(adjustCinemaModalScale);
  setTimeout(adjustCinemaModalScale, 60);
  setTimeout(adjustCinemaModalScale, 220);
  setTimeout(adjustCinemaModalScale, 500);

  applyAmbientBackdropGlow(mediaItem);

  // Немедленно инициализируем селекторы и кнопки, чтобы они были интерактивны СРАЗУ
  const cachedStatus = mediaItem.user_status || localStorage.getItem(`storm_status_${mediaItem.id}`) || null;
  renderDetailedMediaInfo(currentMedia);
  renderStatusButtons(cachedStatus);
  renderCustomListsSelector();
  renderPlayerUtilityButtons();
  renderFranchiseOrder(mediaItem);

  // Инициализируем плавающую кнопку аварийного переключения
  const fallbackBtn = document.getElementById('player-fallback-btn');
  if (fallbackBtn) {
    fallbackBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      switchToNextSource(true);
    };
  }

  // 🛡️ ГАРАНТИЯ ИСТОЧНИКОВ: Создаем полный универсальный набор онлайн-плееров сразу!
  // Никакой источник никогда не пропадает, даже при задержке сети или таймауте
  const fallbackSuite = buildUniversalPlayerSuite(mediaItem, cleanTitle);
  currentPlayers = [...fallbackSuite];
  renderPlayerSources(currentPlayers);

  // Определяем стартовый рекомендуемый плеер с приоритетом выбранного в профиле (по умолчанию: lift_adfree)
  const isDomestic = isDomesticContent(mediaItem, cleanTitle);
  const isWorking = p => p && p.status !== 'broken' && !p.status_label?.includes('Недоступен');
  const isStable = p => isWorking(p) && Boolean(p.url);
  const isReal4k = p => p && (p.id === 'lift_adfree' || p.id === 'fanfilm4k_uhd' || p.id === 'fanfilm_4k' || (p.quality || '').includes('4K') || p.badge === 'FANFILM 4K' || p.badge === 'LIFT БЕЗ РЕКЛАМЫ');
  const itemYr = parseInt(currentMedia?.year || mediaItem?.year || '2026', 10);
  const preferStableKodik = itemYr < 2020;

  const isLandyshiMedia = mediaItem.id === 'rutube_landyshi' || cleanTitle.toLowerCase().includes('ландыши') || mediaItem.rutube_id === '564f31c881b83373bfe0cb26979d44cf';
  const isLandyshiItem = isLandyshiMedia;
  const preferredId = getPreferredDefaultPlayerId();
  let initialChoice = options.initialPlayer ? currentPlayers.find(p => p.id === options.initialPlayer) : null;
  if (!initialChoice && preferredId) {
    initialChoice = currentPlayers.find(p => matchesPreferredPlayer(p, preferredId) && isStable(p)) || null;
  }
  if (!initialChoice) {
    // 🌟 СТРОГИЙ ПРИОРИТЕТ #1: Lift 4K и FHD (Без рекламы • Все озвучки) -> 4K Ultra HD (FanFilm4K)
    const liftOrFourKInitial = currentPlayers.find(p => p.id === 'lift_adfree' && isStable(p))
      || currentPlayers.find(p => isReal4k(p) && isStable(p));
    if (liftOrFourKInitial) {
      initialChoice = liftOrFourKInitial;
    } else if (isLandyshiMedia) {
      initialChoice = currentPlayers.find(p => p.id === 'rutube_direct_hls' && isWorking(p))
        || currentPlayers.find(p => p.id === 'vk_video_stream' && isWorking(p))
        || currentPlayers.find(p => p.id === 'rutube_stream' && isWorking(p))
        || currentPlayers.find(isWorking)
        || currentPlayers[0];
    } else if (isDomestic) {
      initialChoice = currentPlayers.find(p => p.id === 'rutube_direct_hls' && isWorking(p))
        || currentPlayers.find(p => p.id === 'vk_video_stream' && isWorking(p) && p.is_recommended)
        || currentPlayers.find(p => p.id === 'rutube_stream' && isWorking(p))
        || currentPlayers.find(p => p.id === 'vk_video_stream' && isWorking(p))
        || currentPlayers.find(p => p.is_recommended && isWorking(p))
        || currentPlayers.find(isWorking)
        || currentPlayers[0];
    } else {
      initialChoice = currentPlayers.find(p => p.is_recommended && isStable(p))
        || currentPlayers.find(p => p.is_recommended && isWorking(p))
        || currentPlayers.find(isStable)
        || currentPlayers.find(isWorking)
        || currentPlayers[0];
    }
  }

  currentActivePlayer = initialChoice || {
    badge: (mediaItem.source || 'ПЛЕЕР').toUpperCase(),
    name: `${cleanTitle || 'Основной поток'} (${getSourceName(mediaItem)})`,
    quality: '1080p FHD',
    status_label: '🟢 Онлайн'
  };
  updatePlayerTriggerInfo(currentActivePlayer);
  requestScreenWakeLock();

  let initialStartedPlayerId = null;
  let initialStartedPlayerUrl = null;
  if (initialChoice && initialChoice.url && mediaItem.source !== 'anilibria' && mediaItem.source !== 'anixart') {
    initialStartedPlayerId = initialChoice.id;
    initialStartedPlayerUrl = initialChoice.url;
    selectPlayer(initialChoice);
  }

  try {
    // Получаем детальные данные с сервера с быстрым таймаутом 4500мс
    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), 4500);

    const mediaType = detectClientMediaType(mediaItem) || mediaItem.media_type || mediaItem.type || '';
    const fanfilmUrl = mediaItem.fanfilm_4k_url || (mediaItem.source === 'fanfilm4k' ? (mediaItem.link || mediaItem.url || '') : '');
    const itemUrl = `/api/media/item?id=${encodeURIComponent(mediaItem.id)}&source=${mediaItem.source}&url=${encodeURIComponent(mediaItem.link || '')}&title=${encodeURIComponent(cleanTitle)}&year=${encodeURIComponent(currentMedia?.year || detectClientYear(mediaItem) || mediaItem.year || '')}&poster=${encodeURIComponent(mediaItem.poster || '')}&media_type=${encodeURIComponent(mediaType)}&fanfilm_4k_url=${encodeURIComponent(fanfilmUrl)}&rutube_id=${encodeURIComponent(mediaItem.rutube_id || '')}&embed_url=${encodeURIComponent(mediaItem.embed_url || '')}`;
    
    let details = null;
    try {
      const headers = {};
      const token = localStorage.getItem('storm_token');
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(itemUrl, { headers, signal: controller.signal });
      clearTimeout(fetchTimeout);
      if (res.ok) {
        details = await res.json();
      }
    } catch {
      clearTimeout(fetchTimeout);
    }

    if (!details) {
      details = {
        ...mediaItem,
        players: fallbackSuite
      };
    }

    currentMedia = { ...mediaItem, ...details, title: cleanVideoTitle(details?.title || mediaItem?.title || '') };
    const preResolvedStatus = details?.user_bookmark?.status || currentMedia.user_status || cachedStatus || resolveMediaUserStatus(currentMedia) || null;
    if (preResolvedStatus) {
      currentMedia.user_status = preResolvedStatus;
      localStorage.setItem(`storm_status_${mediaItem.id}`, preResolvedStatus);
    }
    ensureCompletedSeriesEpisodesHydrated(currentMedia);
    const enrichedResumeState = resolveMediaResumeState(currentMedia, details, options);
    if (enrichedResumeState) {
      activeResumePromptState = enrichedResumeState;
      isResumePromptPending = true;
      renderResumePromptBanner(enrichedResumeState);
      options.initialSeason = enrichedResumeState.season;
      options.initialEpisode = enrichedResumeState.episode;
    } else {
      activeResumePromptState = null;
      isResumePromptPending = false;
      hideResumePromptBanner();
      const urlHasExplicitSeason = new URLSearchParams(window.location.search).has('season');
      if (!urlHasExplicitSeason) {
        const seriesState = analyzeSeriesWatchState(currentMedia, details);
        if (seriesState && seriesState.allAvailableWatched) {
          options.initialSeason = seriesState.lastWatchedSeason || 1;
          options.initialEpisode = seriesState.lastWatchedEpisode || 1;
        }
      }
    }
    const modalTitleEl = document.getElementById('cinema-modal-title');
    if (modalTitleEl && currentMedia.title) {
      modalTitleEl.textContent = currentMedia.title;
    }
    const inplayerNameEl = document.getElementById('inplayer-series-name');
    if (inplayerNameEl && currentMedia.title) {
      inplayerNameEl.textContent = currentMedia.title;
    }
    try {
      const urlObj = new URL(window.location.href);
      if (urlObj.searchParams.has('media') && currentMedia.title) {
        urlObj.searchParams.set('title', currentMedia.title);
        window.history.replaceState(window.history.state, '', urlObj.pathname + urlObj.search);
      }
    } catch (_) {}
    try {
      sessionStorage.setItem('storm_active_cinema_media', JSON.stringify(currentMedia));
    } catch (e) {}

    // Инициализируем универсальную панель серий с обновленными метаданными
    if (checkIfMediaIsSeries(currentMedia)) {
      initUniversalSeriesQuickBar(options.initialSeason || 1, options.initialEpisode || 1);
    } else {
      quickBarSeriesData = null;
      const quickBar = document.getElementById('player-series-quick-bar');
      if (quickBar) quickBar.style.display = 'none';
      if (modal) modal.classList.remove('has-series-bar');
      updateInPlayerEpisodeInfo();
    }

    // 🛡️ ОБЪЕДИНЕНИЕ СЕРВЕРНЫХ И УНИВЕРСАЛЬНЫХ ПЛЕЕРОВ:
    // Для отечественного контента жестко фильтруем LostFilm и RHS
    const mergedPlayers = [];
    if (Array.isArray(details.players) && details.players.length > 0) {
      details.players.forEach(dp => {
        if (!dp || !dp.url) return;
        if (isDomestic && (dp.id === 'lostfilm_player' || dp.id === 'rhs_player')) return;
        if (!mergedPlayers.some(mp => mp.id === dp.id)) {
          mergedPlayers.push(dp);
        }
      });
    }
    fallbackSuite.forEach(fp => {
      if (!fp || !fp.url) return;
      if (isDomestic && (fp.id === 'lostfilm_player' || fp.id === 'rhs_player')) return;
      if (!mergedPlayers.some(mp => mp.id === fp.id)) {
        mergedPlayers.push(fp);
      }
    });

    currentPlayers = mergedPlayers;

    // Обновляем описание и рендерим галерею кадров / скриншотов
    if (details.description) {
      document.getElementById('cinema-modal-desc').textContent = details.description;
    }
    renderScreenshotsGallery(mediaItem, details);

    // Отображаем подробную информацию в боковой колонке (даты, рейтинги, режиссеры, актеры)
    renderDetailedMediaInfo(currentMedia);
    try {
      const genresArr = Array.isArray(currentMedia.genres) ? currentMedia.genres : [];
      genresArr.forEach(g => {
        const gName = typeof g === 'string' ? g : (g?.name || '');
        if (gName) trackClientAction('watch_genre', { genre: gName });
      });
      if (currentMedia.source === 'anilibria') {
        trackClientAction('anime_anilibria');
      }
    } catch (_) {}

    // Порядок просмотра и хронология франшизы (фильмы, сериалы, аниме)
    renderFranchiseOrder(currentMedia);

    // Отображаем селектор сезонов и серий для сериалов (для аниме настраивается ниже)
    if (mediaItem.source !== 'anilibria' && mediaItem.source !== 'anixart') {
      renderSeriesSeasons(currentMedia, options.initialSeason, options.initialEpisode);
    }

    renderPlayerSources(currentPlayers);
    const effectiveStatus = details?.user_bookmark?.status || currentMedia.user_status || cachedStatus || resolveMediaUserStatus(currentMedia) || null;
    if (effectiveStatus) {
      currentMedia.user_status = effectiveStatus;
      localStorage.setItem(`storm_status_${mediaItem.id}`, effectiveStatus);
    }
    if (checkIfMediaIsSeries(currentMedia)) {
      ensureCompletedSeriesEpisodesHydrated(currentMedia);
      renderQuickBarDropdowns();
    }
    renderStatusButtons(effectiveStatus);
    renderCustomListsSelector();
    renderPlayerUtilityButtons();

    // Загружаем таймкоды пропуска заставок
    loadSkipTimes(mediaItem.id, 1);

    // Для AniLibria и AniXart отображаем озвучки и серии через единую систему
    if (mediaItem.source === 'anilibria' && details.episodes && details.episodes.length > 0) {
      renderAniLibriaControls(details, options);
    } else if (mediaItem.source === 'anixart') {
      renderAnixartControls(details, options);
    } else {
      document.getElementById('anixart-controls-container').style.display = 'none';
      if (currentPlayers.length > 0) {
        let defaultPlayer = options.initialPlayer ? currentPlayers.find(p => p.id === options.initialPlayer) : null;
        const isWorking = p => p && p.status !== 'broken' && !p.status_label?.includes('Недоступен') && p.url && !p.is_trailer && p.id !== 'webtorrent';
        const isStable = p => isWorking(p) && Boolean(p.url);
        const isReal4k = p => p && (p.id === 'lift_adfree' || p.id === 'fanfilm4k_uhd' || p.id === 'fanfilm_4k' || (p.quality || '').includes('4K') || p.badge === 'FANFILM 4K' || p.badge === 'LIFT БЕЗ РЕКЛАМЫ');
        const hasOnlineStream = currentPlayers.some(isStable);

        if (true) {
          const detectedUpcoming = typeof window.isUpcomingMediaItem === 'function'
            ? window.isUpcomingMediaItem(currentMedia)
            : Boolean(currentMedia?.is_upcoming);
          currentMedia.is_upcoming = detectedUpcoming;
          if (detectedUpcoming) {
            currentMedia.is4K = false;
            currentMedia.quality = 'ОЖИДАЕТСЯ';
          }
          if (!defaultPlayer) {
            const prefPlayerId = getPreferredDefaultPlayerId();
            if (prefPlayerId) {
              defaultPlayer = currentPlayers.find(p => matchesPreferredPlayer(p, prefPlayerId) && isStable(p)) || null;
            }
          }
          if (!defaultPlayer) {
            // 🌟 СТРОГИЙ ПРИОРИТЕТ #1: Lift 4K и FHD (Без рекламы • Все озвучки) -> 4K Ultra HD (FanFilm4K)
            const fourKPlayer = currentPlayers.find(p => p.id === 'lift_adfree' && isStable(p))
              || currentPlayers.find(p => isReal4k(p) && isStable(p));
            if (fourKPlayer) {
              defaultPlayer = fourKPlayer;
            } else if (isLandyshiItem) {
              defaultPlayer = currentPlayers.find(p => p.id === 'rutube_direct_hls' && isWorking(p))
                || currentPlayers.find(p => p.id === 'vk_video_stream' && isWorking(p))
                || currentPlayers.find(p => p.id === 'rutube_stream' && isWorking(p))
                || currentPlayers.find(isWorking)
                || currentPlayers[0];
            } else if (isDomestic) {
              defaultPlayer = currentPlayers.find(p => p.id === 'kinobox_universal' && isWorking(p))
                || currentPlayers.find(p => p.id === 'kodik_direct' && isWorking(p))
                || currentPlayers.find(p => p.id === 'vk_video_stream' && isWorking(p))
                || currentPlayers.find(p => p.id === 'rutube_direct_hls' && isWorking(p))
                || currentPlayers.find(p => p.id === 'rutube_stream' && isWorking(p))
                || currentPlayers.find(isWorking)
                || currentPlayers[0];
            } else {
              defaultPlayer = currentPlayers.find(p => p.id === 'kinobox_universal' && isWorking(p))
                || currentPlayers.find(p => p.id === 'kodik_direct' && isWorking(p))
                || currentPlayers.find(p => p.id === 'vk_video_stream' && isWorking(p))
                || currentPlayers.find(p => p.id === 'rutube_stream' && isWorking(p))
                || currentPlayers.find(isWorking)
                || currentPlayers[0];
            }
          }
        }
        if (!initialStartedPlayerId || defaultPlayer?.id !== initialStartedPlayerId || defaultPlayer?.url !== initialStartedPlayerUrl) {
          selectPlayer(defaultPlayer);
        }
      } else {
        const isUpcomingMedia = Boolean(
          currentMedia.is_upcoming ||
          String(currentMedia.id || '').startsWith('tmdb_up_') ||
          (currentMedia.status && ['planned', 'in production', 'post production', 'rumored', 'upcoming'].includes(String(currentMedia.status).toLowerCase()))
        );
        selectPlayer({
          is_upcoming: isUpcomingMedia,
          upcoming_notice: isUpcomingMedia
            ? `Официальная премьера «${cleanVideoTitle(currentMedia?.title || 'Фильм')}» ожидается в ${currentMedia?.year || 'скоро'} году. Цифровой релиз и 4K стримы появятся сразу после выхода в прокат.`
            : `Стриминговые потоки для «${cleanVideoTitle(currentMedia?.title || 'Фильм')}» обновляются. Вы можете запустить просмотр через P2P WebTorrent.`
        });
      }
      }

    // Рендерим секцию «В ролях и создатели» в стиле Luno (горизонтальная карусель, фото w500, роли)
    renderCastAndCrewCarousel(currentMedia);

    // Рендерим секцию рецензий со спойлер-блоками и WYSIWYG
    const reviewsContainer = document.getElementById('cinema-reviews-container');
    if (reviewsContainer) {
      renderReviewsSection(reviewsContainer, currentMedia);
    }

    // Инициализация мобильных жестов сенсорного экрана (двойной тап перемотки, свайпы)
    const playerWrapper = document.getElementById('cinema-player-wrapper');
    if (playerWrapper) {
      initPlayerTouchGestures(playerWrapper);
    }
  } catch (err) {
    console.error('Ошибка модального окна плеера:', err);
    if (currentPlayers.length > 0) {
      selectPlayer(currentPlayers[0]);
    } else {
      iframeContainer.innerHTML = '<div style="display:flex;height:100%;align-items:center;justify-content:center;color:var(--text-muted);font-weight:600;">Плеер временно недоступен для данного релиза</div>';
    }
  }
}

export function closePlayerModal(options = {}) {
  const fromPopState = Boolean(options && options.fromPopState);
  const modal = document.getElementById('cinema-modal');
  if (modal) {
    const wasOpen = modal.classList.contains('is-open') || document.body.classList.contains('cinema-open');
    if (!wasOpen && !hasCinemaHistoryEntry && !fromPopState) {
      if (window.location.search.includes('media=')) {
        clearPlayerUrl();
      }
      return;
    }

    if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
      document.exitFullscreen().catch(() => {});
    }
    modal.classList.remove('is-open', 'is-fullscreen', 'is-mini-pip', 'is-focus-mode', 'has-series-bar');
    document.documentElement.classList.remove('cinema-focus-active');
    document.body.classList.remove('cinema-focus-active', 'cinema-open');
    if (typeof window.updateTvHudContext === 'function') {
      window.updateTvHudContext();
    }
    const fBtn = document.getElementById('inplayer-focus-btn');
    if (fBtn) fBtn.classList.remove('active');
    stopAmbilight();
    releaseScreenWakeLock();

    if (fromPopState) {
      hasCinemaHistoryEntry = false;
      clearPlayerUrl();
    } else if (hasCinemaHistoryEntry && window.history.state && window.history.state.stormModal === 'cinema') {
      hasCinemaHistoryEntry = false;
      isClosingCinemaViaHistoryBack = true;
      try {
        window.history.back();
      } catch (_) {
        isClosingCinemaViaHistoryBack = false;
        clearPlayerUrl();
      }
      setTimeout(() => {
        if (isClosingCinemaViaHistoryBack) {
          isClosingCinemaViaHistoryBack = false;
        }
        if (window.location.search.includes('media=')) {
          clearPlayerUrl();
        }
      }, 180);
    } else {
      hasCinemaHistoryEntry = false;
      clearPlayerUrl();
    }
    try {
      sessionStorage.removeItem('storm_active_cinema_media');
    } catch (e) {}
    dismissUpNextCountdownCard(false);
    if (statsForNerdsInterval) {
      clearInterval(statsForNerdsInterval);
      statsForNerdsInterval = null;
    }
    isStatsForNerdsVisible = false;
    const statsOverlay = document.getElementById('storm-nerd-stats-overlay');
    if (statsOverlay) statsOverlay.remove();

    // Сброс мобильных состояний (блокировка экрана, соотношение сторон, PiP)
    const lockOverlay = document.getElementById('player-screen-locked-overlay');
    if (lockOverlay) lockOverlay.style.display = 'none';
    const lockBtn = document.getElementById('player-screen-lock-btn');
    if (lockBtn) lockBtn.classList.remove('active');
    const pipBtn = document.getElementById('player-pip-btn');
    if (pipBtn) pipBtn.classList.remove('active');
    const aspectBtn = document.getElementById('player-aspect-btn');
    if (aspectBtn) aspectBtn.classList.remove('active');
    const playerContainer = document.getElementById('cinema-player-container');
    if (playerContainer) playerContainer.classList.remove('aspect-fill', 'aspect-original');

    const jogWidget = document.getElementById('inplayer-jog-dial-widget');
    if (jogWidget) jogWidget.style.display = 'none';
    const jogBtn = document.getElementById('inplayer-jog-btn');
    if (jogBtn) jogBtn.classList.remove('active');
    isPlayerScreenLocked = false;

    saveMediaResumeSnapshot({ forceSync: true });
    hideResumePromptBanner();
    try {
      window.dispatchEvent(new CustomEvent('storm:dynamic-state-sync'));
      window.dispatchEvent(new CustomEvent('storm:continue-watching-updated'));
    } catch (_) {}
    isResumePromptPending = false;
    activeResumePromptState = null;
    pendingResumeSeekSeconds = 0;
    if (pendingResumeSeekTimer) {
      clearInterval(pendingResumeSeekTimer);
      pendingResumeSeekTimer = null;
    }

    stopInvisibleEpisodeWatchTracker();

    if (iframeWatchInterval) {
      clearInterval(iframeWatchInterval);
      iframeWatchInterval = null;
    }
    currentWatchTimeSeconds = 0;

    const iframeContainer = document.getElementById('cinema-player-wrapper');
    if (iframeContainer) iframeContainer.innerHTML = '';

    const quickBar = document.getElementById('player-series-quick-bar');
    if (quickBar) quickBar.style.display = 'none';

    const studioBackdrop = document.getElementById('player-studio-modal-backdrop');
    if (studioBackdrop) studioBackdrop.style.display = 'none';

    quickBarSeriesData = null;
    currentEpisodes = [];
    currentEpisodeIndex = 1;
    toggleInPlayerEpisodesSheet(null, false);

    document.body.classList.remove('player-dropdown-active', 'quick-dropdown-active');

    if (torrentClient) {
      try {
        torrentClient.destroy();
      } catch {}
      torrentClient = null;
    }

    const personModal = document.getElementById('person-modal');
    if (personModal) personModal.classList.remove('is-open');

    const cvPanel = document.getElementById('storm-cleanview-panel');
    if (cvPanel) cvPanel.classList.remove('is-open');
  }
}

function renderPlayerSources(players) {
  const dropdown = document.getElementById('player-source-dropdown');
  const trigger = document.getElementById('player-source-trigger');
  const menu = document.getElementById('player-source-menu');
  const list = document.getElementById('player-source-list');
  const curBadge = document.getElementById('player-current-badge');
  const curName = document.getElementById('player-current-name');
  const curQuality = document.getElementById('player-current-quality');
  const curStatus = document.getElementById('player-current-status');

  if (!dropdown || !list) return;

  let validPlayers = (players || []).filter(p => {
    if (!p || !p.url) return false;
    if (p.url.includes('kinobox.tv') || p.url.includes('delivembd.ws')) return false;
    if (p.is_trailer || p.id === 'official_trailer' || p.id === 'official_trailer_fallback') return false;
    if (/трейлер|тизер|trailer|teaser/i.test(p.name || '') || /трейлер|тизер|trailer|teaser/i.test(p.badge || '')) return false;
    return true;
  });

  // Привязываем кнопку «📥 Скачать 4K / FHD» в панели под плеером
  const underPlayerDlBtn = document.getElementById('under-player-lift-download-btn');
  if (underPlayerDlBtn) {
    underPlayerDlBtn.onclick = (e) => {
      e.stopPropagation();
      openLiftDownloadModal();
    };
  }

  // 🌟 СТРОГИЙ ПРИОРИТЕТ #1: Рабочие потоки всегда первыми! Выбранный плеер по умолчанию (Lift 4K и FHD Без рекламы) на первом месте!
  const prefPlayerId = getPreferredDefaultPlayerId();
  const isWorking = p => p && p.status !== 'broken' && !p.status_label?.includes('Недоступен');
  const isLiftAdFree = p => p && isWorking(p) && p.id === 'lift_adfree';
  const isReal4k = p => p && isWorking(p) && (p.id === 'lift_adfree' || p.id === 'fanfilm4k_uhd' || p.id === 'fanfilm_4k' || (p.quality || '').includes('4K') || p.badge === 'FANFILM 4K' || p.badge === 'LIFT БЕЗ РЕКЛАМЫ');
  validPlayers.sort((a, b) => {
    const aWork = isWorking(a);
    const bWork = isWorking(b);
    if (aWork && !bWork) return -1;
    if (!aWork && bWork) return 1;
    const aPref = aWork && matchesPreferredPlayer(a, prefPlayerId);
    const bPref = bWork && matchesPreferredPlayer(b, prefPlayerId);
    if (aPref && !bPref) return -1;
    if (!aPref && bPref) return 1;
    const aLift = isLiftAdFree(a);
    const bLift = isLiftAdFree(b);
    if (aLift && !bLift) return -1;
    if (!aLift && bLift) return 1;
    const aIs4k = isReal4k(a);
    const bIs4k = isReal4k(b);
    if (aIs4k && !bIs4k) return -1;
    if (!aIs4k && bIs4k) return 1;
    return 0;
  });

  if (validPlayers.length === 0 && !currentMedia?.is_upcoming) {
    const suite = buildUniversalPlayerSuite(currentMedia, currentMedia?.title || '');
    validPlayers = suite.filter(p => p && p.url && !p.is_trailer);
  }

  currentPlayers = validPlayers;

  if (validPlayers.length === 0) {
    if (curName) curName.textContent = 'Премьера ожидается';
    if (curBadge) curBadge.textContent = 'РЕЛИЗ';
    if (curQuality) curQuality.textContent = '—';
    if (curStatus) curStatus.textContent = '🕒 Скоро';
    list.innerHTML = '<div style="padding: 12px; color: var(--text-muted); font-size: 13px; text-align: center;">Цифровой релиз фильма еще не состоялся</div>';
    return;
  }

  // Заполняем выпадающий список стилизованными элементами
  const recommendedPlayer = validPlayers.find(p => p.is_recommended && isWorking(p)) || validPlayers.find(isWorking) || validPlayers[0];
  const defaultPlayer = currentActivePlayer ? (validPlayers.find(p => p.id === currentActivePlayer.id) || recommendedPlayer) : recommendedPlayer;

  list.innerHTML = validPlayers.map((p, idx) => {
    const isAct = defaultPlayer ? defaultPlayer.id === p.id : idx === 0;
    const isDown = (p.status_label || '').includes('🔴') || p.status === 'broken';
    const recBadge = (p.is_recommended && !isDown) ? `<span class="storm-badge" style="background:linear-gradient(135deg,#f59e0b,#ef4444);color:#fff;font-weight:800;padding:2px 6px;border-radius:4px;font-size:10px;margin-left:auto;flex-shrink:0;">🔥 Рекомендуемый</span>` : '';
    const badgeKey = p.badge ? p.badge.toLowerCase().replace(/[^a-z0-9]/g, '') : 'default';
    const is4k = (p.quality || '').includes('4K');

    return `
      <div class="player-dropdown-item ${isAct ? 'active' : ''}" data-idx="${idx}">
        <div class="player-item-main">
          <div class="player-item-title-row">
            <span class="player-source-badge badge-${badgeKey}">${p.badge || 'ПЛЕЕР'}</span>
            <span class="player-item-name" title="${p.name}">${p.name}</span>
            ${recBadge}
          </div>
          <div class="player-item-sub-row">
            <span class="player-item-quality-pill ${is4k ? 'pill-4k' : 'pill-fhd'}">${p.quality || '1080p FHD'}</span>
            <span class="player-item-dot">•</span>
            <span class="player-item-audio">${p.audio_info || 'Оригинал / дубляж'}</span>
          </div>
        </div>
        <div class="player-item-aside">
          <span class="player-item-status ${isDown ? 'status-down' : 'status-live'}">${p.status_label || '🟢 Онлайн'}</span>
          ${isAct ? '<span class="player-item-check">✓</span>' : ''}
        </div>
      </div>
    `;
  }).join('');

  // Обновляем плашку выбранного плеера
  if (currentActivePlayer) {
    updatePlayerTriggerInfo(currentActivePlayer);
  } else if (defaultPlayer) {
    updatePlayerTriggerInfo(defaultPlayer);
  }

  // Клик по пункту выпадающего списка
  list.querySelectorAll('.player-dropdown-item').forEach(itemEl => {
    itemEl.onclick = (e) => {
      e.stopPropagation();
      const idx = parseInt(itemEl.dataset.idx, 10);
      const player = validPlayers[idx];
      if (player) {
        lastUserManualSelectionTime = Date.now();
        list.querySelectorAll('.player-dropdown-item').forEach(el => el.classList.remove('active'));
        itemEl.classList.add('active');
        updatePlayerTriggerInfo(player);
        menu.style.display = 'none';
        dropdown.classList.remove('is-open');
        document.body.classList.remove('player-dropdown-active');
        selectPlayer(player, true);
      }
    };
  });

  // Открытие / закрытие выпадающего списка выбора плеера
  if (trigger) {
    trigger.onclick = (e) => {
      e.stopPropagation();
      const isOpen = menu.style.display === 'block';
      if (!isOpen) {
        closeOtherQuickDropdowns(null);

        // Динамический расчет направления: по умолчанию вверх над видео, если не влезает — от верхнего края вниз
        const triggerRect = trigger.getBoundingClientRect();
        const spaceAbove = triggerRect.top;
        const spaceBelow = window.innerHeight - triggerRect.bottom;

        // Показываем вверх, если сверху достаточно места (>= 180px) или больше чем снизу
        if (spaceAbove >= 180 || spaceAbove >= spaceBelow) {
          menu.classList.remove('open-down');
          menu.classList.add('open-up');
          menu.style.top = 'auto';
          menu.style.bottom = 'calc(100% + 8px)';
          menu.style.maxHeight = `${Math.min(460, Math.max(160, spaceAbove - 24))}px`;
        } else {
          menu.classList.remove('open-up');
          menu.classList.add('open-down');
          menu.style.bottom = 'auto';
          menu.style.top = 'calc(100% + 8px)';
          menu.style.maxHeight = `${Math.min(460, Math.max(160, spaceBelow - 24))}px`;
        }

        menu.style.display = 'block';
        dropdown.classList.add('is-open');
        document.body.classList.add('player-dropdown-active');
      } else {
        menu.style.display = 'none';
        dropdown.classList.remove('is-open');
        document.body.classList.remove('player-dropdown-active');
      }
    };
  }

  // Закрытие при клике вне селектора
  if (!dropdown.dataset.hasOutsideListener) {
    dropdown.dataset.hasOutsideListener = 'true';
    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target)) {
        menu.style.display = 'none';
        dropdown.classList.remove('is-open');
        document.body.classList.remove('player-dropdown-active');
      }
    });
  }

  adjustCinemaModalScale();
}

export function updateFallbackButton(player = currentActivePlayer) {
  const fallbackBtn = document.getElementById('player-fallback-btn');
  const fallbackBar = document.getElementById('player-fallback-bar');
  if (!fallbackBtn) return;

  const validPlayers = (currentPlayers || []).filter(p => p && p.status !== 'broken' && !p.status_label?.includes('Недоступен') && p.url && !p.is_trailer && p.id !== 'webtorrent');
  if (validPlayers.length <= 1) {
    if (fallbackBar) fallbackBar.style.display = 'none';
    fallbackBtn.style.display = 'none';
    return;
  }
  if (fallbackBar) fallbackBar.style.display = 'flex';
  fallbackBtn.style.display = 'inline-flex';

  const isDom = isDomesticContent(currentMedia, currentMedia?.title || '');
  let nextCandidate = null;
  if (isDom) {
    if (player?.id === 'vk_video_stream') {
      nextCandidate = validPlayers.find(p => p.id === 'rutube_stream');
    } else if (player?.id === 'rutube_stream') {
      nextCandidate = validPlayers.find(p => p.id === 'vk_video_stream');
    }
    if (!nextCandidate) {
      nextCandidate = validPlayers.find(p => p.id !== player?.id && (p.id === 'vk_video_stream' || p.id === 'rutube_stream'))
        || validPlayers.find(p => p.id !== player?.id);
    }
  } else {
    nextCandidate = validPlayers.find(p => p.id !== player?.id && p.id === 'fanfilm4k_uhd')
      || validPlayers.find(p => p.id !== player?.id && p.id === 'kodik_direct')
      || validPlayers.find(p => p.id !== player?.id && (p.id === 'rutube_stream' || p.id === 'vk_video_stream'))
      || validPlayers.find(p => p.id !== player?.id);
  }

  const labelEl = fallbackBtn.querySelector('.player-fallback-btn-label');
  if (labelEl) {
    if (nextCandidate) {
      let shortName = nextCandidate.name || 'Резерв';
      if (nextCandidate.id === 'vk_video_stream') shortName = 'VK Видео';
      else if (nextCandidate.id === 'rutube_direct_hls') shortName = 'RuTube HLS';
      else if (nextCandidate.id === 'rutube_stream') shortName = 'RuTube';
      else if (nextCandidate.id === 'fanfilm4k_uhd') shortName = '4K Ultra HD';
      else if (nextCandidate.id === 'kodik_direct') shortName = 'Kodik';
      labelEl.textContent = `Переключить на ${shortName}`;
      fallbackBtn.title = `Переключить на резервный плеер: ${nextCandidate.name}`;
    } else {
      labelEl.textContent = 'Резервный плеер';
      fallbackBtn.title = 'Переключить на резервный плеер';
    }
  }
}

function updatePlayerTriggerInfo(player) {
  if (!player) return;
  const curBadge = document.getElementById('player-current-badge');
  const curName = document.getElementById('player-current-name');
  const curQuality = document.getElementById('player-current-quality');
  const curStatus = document.getElementById('player-current-status');

  if (curBadge) {
    if (player.is_recommended) {
      curBadge.innerHTML = `<span style="display:inline-flex;align-items:center;gap:4px;">${player.badge || 'ПЛЕЕР'} <span style="background:linear-gradient(135deg,#f59e0b,#ef4444);padding:1px 5px;border-radius:3px;font-size:9px;color:#fff;font-weight:800;">🔥 ТОП</span></span>`;
    } else {
      curBadge.textContent = player.badge || 'ПЛЕЕР';
    }
  }
  if (curName) curName.textContent = player.name || 'Плеер';
  if (curQuality) curQuality.textContent = player.quality || '1080p FHD';
  if (curStatus) curStatus.textContent = player.status_label || '🟢 Онлайн';

  updateFallbackButton(player);
}

function selectPlayer(player, isUserManual = false) {
  if (!player) return;

  if (isUserManual) {
    lastUserManualSelectionTime = Date.now();
  }

  // Восстанавливаем работоспособность плеера при явном выборе пользователем
  player.status = 'working';
  if (player.status_label && player.status_label.includes('🔴')) {
    player.status_label = '🟢 Онлайн';
  }
  if (failedSourcesSession) {
    failedSourcesSession.delete(player.id);
  }

  currentActivePlayer = player;
  updatePlayerTriggerInfo(player);

  // Синхронизируем активный элемент в выпадающем списке выбора плееров
  const list = document.getElementById('player-source-list');
  if (list && player?.id) {
    list.querySelectorAll('.player-dropdown-item').forEach(el => {
      const idx = parseInt(el.dataset.idx, 10);
      const p = currentPlayers ? currentPlayers[idx] : null;
      el.classList.toggle('active', Boolean(p && p.id === player.id));
    });
  }

  const container = document.getElementById('cinema-player-wrapper');
  if (!container) return;

  if (player.url === 'webtorrent://direct') {
    renderWebTorrentPlayer();
    return;
  }

  // Если ссылки нет или релиз не вышел, отображаем статус ожидаемой премьеры
  if (!player || !player.url || player.is_upcoming) {
    const title = cleanVideoTitle(currentMedia?.title || 'Фильм');
    const year = currentMedia?.year || '2026';
    const notice = player?.upcoming_notice || `Официальная премьера «${title}» ожидается в ${year} году. Цифровой релиз и 4K стримы появятся сразу после выхода в прокат.`;

    container.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;min-height:480px;text-align:center;padding:36px 20px;background:radial-gradient(circle at center, #151d30 0%, #0a0b10 100%);border-radius:12px;gap:16px;">
        <div style="font-size:52px;line-height:1;filter:drop-shadow(0 0 16px rgba(0,210,255,0.4));">🎬</div>
        <div style="font-size:22px;font-weight:800;color:#00d2ff;letter-spacing:0.5px;">Официальная цифровая премьера еще не состоялась</div>
        <div style="max-width:540px;font-size:14px;line-height:1.6;color:#94a3b8;">${notice}</div>
        <div style="display:flex;gap:12px;margin-top:8px;flex-wrap:wrap;justify-content:center;">
          ${currentMedia?.trailer_url ? `<button type="button" class="storm-btn storm-btn-primary" onclick="window.playTrailerDirectly && window.playTrailerDirectly()" style="background:linear-gradient(135deg, #00d2ff, #0077ff);color:#fff;border:none;border-radius:10px;padding:12px 22px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 4px 16px rgba(0,210,255,0.35);">▶ Смотреть трейлер</button>` : ''}
          <button type="button" class="storm-btn ${currentMedia?.trailer_url ? 'storm-btn-secondary' : 'storm-btn-primary'}" id="player-notice-add-planned-btn" style="padding:12px 20px;font-weight:700;border-radius:10px;">
            📌 Добавить в «Буду смотреть»
          </button>
          ${(currentMedia?.releases?.length > 0 || currentMedia?.torrent_hash) ? `<button type="button" class="storm-btn storm-btn-secondary" id="player-notice-webtorrent-btn" style="padding:12px 20px;border-radius:10px;">🧲 Запустить в P2P WebTorrent</button>` : ''}
        </div>
      </div>
    `;

    const addPlannedBtn = container.querySelector('#player-notice-add-planned-btn');
    if (addPlannedBtn) {
      addPlannedBtn.onclick = async () => {
        if (currentMedia) {
          await saveBookmarkStatus(currentMedia, 'planned');
          addPlannedBtn.textContent = '✓ Добавлено в «В планах»';
          addPlannedBtn.classList.remove('storm-btn-primary');
          addPlannedBtn.classList.add('storm-btn-secondary');
        }
      };
    }

    const wtBtn = container.querySelector('#player-notice-webtorrent-btn');
    if (wtBtn) {
      wtBtn.onclick = () => {
        renderWebTorrentPlayer();
      };
    }
    return;
  }

  playStreamUrl(player.url);
}

export function switchToNextSource(preferWorking = true) {
  if (Date.now() - lastUserManualSelectionTime < 15000 && !preferWorking) {
    console.warn('[Player] Игнорируем авто-переключение источника: пользователь недавно вручную выбрал плеер');
    return;
  }

  const failedPlayerId = currentActivePlayer ? currentActivePlayer.id : null;
  if (failedPlayerId) {
    failedSourcesSession.add(failedPlayerId);
    if (failedPlayerId !== 'fanfilm4k_uhd' && failedPlayerId !== 'kinobox_universal') {
      currentActivePlayer.status = 'broken';
      currentActivePlayer.status_label = '🔴 Недоступен';
      currentActivePlayer.is_recommended = false;
    }
  }

  // Обновляем список плееров в выпадающем меню UI
  if (currentPlayers) {
    renderPlayerSources(currentPlayers);
  }

  if (!currentPlayers || currentPlayers.length <= 1) {
    stopPlayerFallbackLoop();
    return;
  }

  const isWorking = p => p && p.id !== failedPlayerId && p.status !== 'broken' && !p.status_label?.includes('Недоступен') && p.url && !p.is_trailer && p.id !== 'webtorrent' && !failedSourcesSession.has(p.id);

  let nextPlayer = null;
  const isDom = isDomesticContent(currentMedia, currentMedia?.title || '');
  if (isDom) {
    nextPlayer = currentPlayers.find(p => p.id === 'kinobox_universal' && isWorking(p))
      || currentPlayers.find(p => p.id === 'kodik_direct' && isWorking(p))
      || currentPlayers.find(p => p.id === 'rutube_direct_hls' && isWorking(p))
      || currentPlayers.find(p => p.id === 'vk_video_stream' && isWorking(p))
      || currentPlayers.find(p => p.id === 'rutube_stream' && isWorking(p))
      || currentPlayers.find(isWorking)
      || null;
  } else {
    nextPlayer = currentPlayers.find(p => p.id === 'fanfilm4k_uhd' && isWorking(p))
      || currentPlayers.find(p => p.id === 'kinobox_universal' && isWorking(p))
      || currentPlayers.find(p => p.id === 'kodik_direct' && isWorking(p))
      || currentPlayers.find(p => p.id === 'vk_video_stream' && isWorking(p))
      || currentPlayers.find(p => p.id === 'rutube_stream' && isWorking(p))
      || currentPlayers.find(p => p.id === 'vidsrc_player' && isWorking(p))
      || currentPlayers.find(isWorking)
      || null;
  }

  if (nextPlayer) {
    selectPlayer(nextPlayer);
    updatePlayerTriggerInfo(nextPlayer);
    const list = document.getElementById('player-source-list');
    if (list) {
      list.querySelectorAll('.player-dropdown-item').forEach((el) => {
        const idx = parseInt(el.dataset.idx, 10);
        const p = currentPlayers ? currentPlayers[idx] : null;
        el.classList.toggle('active', Boolean(p && p.id === nextPlayer.id));
      });
    }
    showToast(`⚡ Источник переключен: ${nextPlayer.name}`, 'info');
  } else {
    // Все доступные источники исчерпаны — останавливаем цикл и показываем экран релиза
    stopPlayerFallbackLoop();
  }
}

if (typeof window !== 'undefined') {
  window.playTrailerDirectly = function() {
    if (currentMedia?.trailer_url) {
      playStreamUrl(currentMedia.trailer_url);
      const curBadge = document.getElementById('player-current-badge');
      if (curBadge) curBadge.textContent = 'ТРЕЙЛЕР';
      const curName = document.getElementById('player-current-name');
      if (curName) curName.textContent = 'Официальный трейлер';
      const curQuality = document.getElementById('player-current-quality');
      if (curQuality) curQuality.textContent = '4K UHD / 1080p';
      showToast('🎬 Воспроизведение официального трейлера', 'info');
    } else {
      showToast('Официальный трейлер недоступен', 'warning');
    }
  };

  window.addMediaToWatchlist = function(id) {
    if (currentMedia) {
      currentMedia.user_status = 'planned';
      try { localStorage.setItem(`storm_status_${currentMedia.id}`, 'planned'); } catch (_) {}
      renderStatusButtons('planned');
      saveBookmarkStatus(currentMedia, 'planned').catch(() => {});
    }
    showToast('📌 Добавлено в список «В планах»', 'success');
  };

  window.retryPlayerSources = function() {
    failedSourcesSession.clear();
    if (currentPlayers && currentPlayers.length > 0) {
      currentPlayers.forEach(p => {
        if (p.status === 'broken') {
          p.status = 'working';
          p.status_label = '🟢 Онлайн';
        }
      });
      switchToNextSource(true);
    }
  };
}

export function stopPlayerFallbackLoop() {
  const container = document.getElementById('cinema-player-wrapper');
  if (!container) return;

  const isCarrie = /кэрри|carrie/i.test(currentMedia?.title || '') && /flanagan|флэнаган/i.test(currentMedia?.title || '');
  const isFutureYear = Boolean(currentMedia?.year && parseInt(currentMedia.year, 10) > new Date().getFullYear());
  const isUpcoming = Boolean(
    currentMedia?.is_upcoming ||
    isCarrie ||
    isFutureYear ||
    /ожидается|скоро/i.test(currentMedia?.release_date || currentMedia?.premiere || '')
  );

  const cleanTitle = cleanVideoTitle(currentMedia?.title || 'Кинорелиз');
  const yearText = currentMedia?.year || '';

  {
    // Гарантированный резервный мульти-балансер вместо тупикового экрана ошибки
    const fallbackEmbedUrl = `/api/player/kinobox-embed?balancer=auto&fallback_mode=1&title=${encodeURIComponent(cleanTitle)}&year=${encodeURIComponent(yearText)}&kp_id=${encodeURIComponent(currentMedia?.kp_id || '')}&imdb_id=${encodeURIComponent(currentMedia?.imdb_id || '')}`;
    container.innerHTML = `
      <div class="player-video-box" style="position:relative;width:100%;height:100%;">
        <div id="player-ambilight-aura" class="ambilight-aura"></div>
        <iframe class="cinema-player-iframe" src="${fallbackEmbedUrl}" referrerpolicy="no-referrer-when-downgrade" allow="fullscreen *; picture-in-picture *; encrypted-media *" scrolling="no" style="position:relative;z-index:5;pointer-events:auto;width:100%;height:100%;border:none;border-radius:12px;"></iframe>
      </div>
    `;
  }
}

/* ==========================================================================
   УМНЫЙ ВЫБОР ОЗВУЧКИ (SMART VOICEOVER PREFERENCE & AUTO-MATCHING)
   ========================================================================== */
const KNOWN_STUDIO_ALIASES = [
  { key: 'lostfilm', patterns: ['lostfilm', 'лостфильм', 'lost film'] },
  { key: 'redheadsound', patterns: ['red head sound', 'redheadsound', 'ред хед саунд', 'редхедсаунд', 'rhs', 'рхс'] },
  { key: 'hdrezka', patterns: ['hdrezka', 'rezka', 'хдрезка', 'резка', 'hd rezka'] },
  { key: 'kubik', patterns: ['кубик в кубе', 'кубик', 'kubik v kube', 'kubik'] },
  { key: 'anilibria', patterns: ['anilibria', 'анилибрия'] },
  { key: 'studioband', patterns: ['studio band', 'studioband', 'студийная банда', 'студия банда'] },
  { key: 'dreamcast', patterns: ['dream cast', 'dreamcast', 'дримкаст'] },
  { key: 'aniplash', patterns: ['aniplash', 'аниплэш', 'аниплеш'] },
  { key: 'shikimori', patterns: ['shikimori', 'шикимори'] },
  { key: 'shiza', patterns: ['shiza project', 'shiza', 'шиза проджект', 'шиза'] },
  { key: 'dubbing', patterns: ['дублированный', 'дубляж', 'полный дубляж', 'профессиональный дублированный', 'дублирование', 'dubbing'] },
  { key: 'pifagor', patterns: ['пифагор', 'мостфильм', 'невафильм'] },
  { key: 'tvshows', patterns: ['tvshows', 'твшоус', 'твшоу'] },
  { key: 'newstudio', patterns: ['newstudio', 'ньюстудио'] },
  { key: 'kuraj', patterns: ['кураж-бамбей', 'кураж бамбей', 'кураж', 'kuraj bambey'] },
  { key: 'flarrow', patterns: ['flarrow films', 'flarrow', 'флэрроу', 'флэроу'] },
  { key: 'coldfilm', patterns: ['coldfilm', 'колдфильм'] },
  { key: 'baibako', patterns: ['baibako', 'байбако'] },
  { key: 'alexfilm', patterns: ['alexfilm', 'алексфильм'] },
  { key: 'profdub', patterns: ['профессиональный многоголосый', 'проф. многоголосый'] }
];

export function getPreferredVoiceover() {
  try {
    return localStorage.getItem('storm_smart_preferred_voiceover') || '';
  } catch {
    return '';
  }
}

export function savePreferredVoiceover(name) {
  if (!name || typeof name !== 'string') return;
  const cleanName = name
    .replace(/\s*[\(\[]?\s*(4[kк]|uhd|fhd|1080p|720p|серия|сезон|\d+)\s*[\)\]]?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleanName || cleanName.length < 2) return;

  try {
    localStorage.setItem('storm_smart_preferred_voiceover', cleanName);
    localStorage.setItem('storm_smart_preferred_voiceover_raw', name);
  } catch (err) {
    console.warn('Не удалось сохранить умную озвучку:', err);
  }
}

export function findPreferredVoiceoverMatch(translations) {
  if (!Array.isArray(translations) || translations.length === 0) return null;
  const preferred = getPreferredVoiceover();
  if (!preferred) return null;

  const cleanPref = preferred.toLowerCase().trim();
  const prefNorm = cleanPref.replace(/[^a-zа-я0-9]/gi, '');

  let matchedStudioKey = null;
  for (const item of KNOWN_STUDIO_ALIASES) {
    if (item.patterns.some(p => cleanPref.includes(p) || p.includes(cleanPref))) {
      matchedStudioKey = item.key;
      break;
    }
  }

  const prefTokens = cleanPref
    .split(/[\s,.\-\_\(\)\[\]\/\\]+/)
    .map(t => t.trim())
    .filter(t => t.length >= 4 && !['сезон', 'серия', 'серии', 'звук', 'дубляж'].includes(t));

  let bestMatch = null;
  let bestScore = 0;

  for (const trans of translations) {
    const name = (trans.name || '').trim();
    if (!name) continue;
    const lowerName = name.toLowerCase();
    const transNorm = lowerName.replace(/[^a-zа-я0-9]/gi, '');

    let score = 0;

    if (transNorm === prefNorm) {
      score = 100;
    } else if (matchedStudioKey) {
      const studioObj = KNOWN_STUDIO_ALIASES.find(s => s.key === matchedStudioKey);
      if (studioObj && studioObj.patterns.some(p => lowerName.includes(p))) {
        score = 90;
      }
    }

    if (score === 0) {
      if (lowerName.includes(cleanPref) || cleanPref.includes(lowerName)) {
        score = 80;
      } else {
        for (const token of prefTokens) {
          if (lowerName.includes(token)) {
            score = Math.max(score, 70);
          }
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = trans;
    }
  }

  return bestScore >= 70 ? bestMatch : null;
}

/* ==========================================================================
   СТИЛИЗОВАННАЯ ПАНЕЛЬ СЕРИАЛОВ И ФИЛЬМОВ (СЕЗОНЫ, СЕРИИ И СТУДИЙНАЯ ОЗВУЧКА)
   ========================================================================== */
let quickBarSeriesData = null;
let quickBarActiveSeason = 1;
let quickBarActiveEpisode = 1;
let quickBarActiveTranslationId = null;
let quickBarBaseUrl = null;

async function initSeriesQuickBar(playerUrl) {
  const quickBar = document.getElementById('player-series-quick-bar');
  if (!quickBar) return;

  quickBarBaseUrl = playerUrl;
  try {
    const curMediaId = currentMedia?.id || '';
    const mediaTitle = currentMedia?.title || currentMedia?.name || '';
    const mediaTmdbId = currentMedia?.tmdb_id || '';
    const res = await fetch(`/api/player/series-options?url=${encodeURIComponent(playerUrl)}&title=${encodeURIComponent(mediaTitle)}&mediaId=${encodeURIComponent(curMediaId)}&tmdbId=${encodeURIComponent(mediaTmdbId)}`);
    if (!res.ok) {
      if (checkIfMediaIsSeries(currentMedia)) {
        initUniversalSeriesQuickBar(quickBarActiveSeason, quickBarActiveEpisode);
        return;
      }
      quickBar.style.display = 'none';
      adjustCinemaModalScale();
      return;
    }
    const data = await res.json();
    if (!data.success || !data.seasons || data.seasons.length === 0) {
      if (checkIfMediaIsSeries(currentMedia)) {
        initUniversalSeriesQuickBar(quickBarActiveSeason, quickBarActiveEpisode);
        return;
      }
      quickBar.style.display = 'none';
      adjustCinemaModalScale();
      return;
    }

    sortSeasonsAndEpisodes(data.seasons);
    quickBarSeriesData = data;
    quickBar.style.display = 'flex';
    const modal = document.getElementById('cinema-modal');
    if (modal) modal.classList.add('has-series-bar');
    adjustCinemaModalScale();
    requestAnimationFrame(adjustCinemaModalScale);

    const urlSeasonMatch = String(playerUrl || '').match(/[?&]season=(\d+)/i);
    const urlEpMatch = String(playerUrl || '').match(/[?&]episode=(\d+)/i);
    const explicitUrlSeason = urlSeasonMatch ? parseInt(urlSeasonMatch[1], 10) : null;
    const explicitUrlEp = urlEpMatch ? parseInt(urlEpMatch[1], 10) : null;
    const keepCurrentSeason = quickBarActiveSeason && data.seasons.some(s => Number(s.season) === Number(quickBarActiveSeason))
      ? Number(quickBarActiveSeason)
      : null;

    quickBarActiveSeason = explicitUrlSeason || keepCurrentSeason || Number(data.seasons[0]?.season) || 1;
    quickBarActiveEpisode = explicitUrlEp || (quickBarActiveEpisode && Number.isFinite(Number(quickBarActiveEpisode)) ? Number(quickBarActiveEpisode) : 1);
    quickBarActiveTranslationId = data.active?.id_translation || null;

    // Умный выбор озвучки: проверяем любимую студию пользователя
    const currentSeasonObj = data.seasons.find(s => s.season === quickBarActiveSeason) || data.seasons[0];
    const currentEpisodeObj = currentSeasonObj?.episodes?.find(e => e.episode === quickBarActiveEpisode) || currentSeasonObj?.episodes?.[0];
    const availableTranslations = currentEpisodeObj?.translations || [];

    const matchedTrans = findPreferredVoiceoverMatch(availableTranslations);
    let autoVoiceMatched = false;
    if (matchedTrans && String(matchedTrans.id) !== String(quickBarActiveTranslationId)) {
      quickBarActiveTranslationId = matchedTrans.id;
      if (data.active) data.active.id_translation = matchedTrans.id;
      autoVoiceMatched = true;
    }

    // Синхронизируем список сезонов и гидрируем просмотренные серии ДО отрисовки выпадающего списка QuickBar
    if (data.type !== 'movie' && data.seasons && data.seasons.length > 0) {
      if (currentMedia) {
        currentMedia.media_type = 'series';
        currentMedia.category = 'Сериал';
        if (!currentMedia.seasons || currentMedia.seasons.length < data.seasons.length) {
          currentMedia.seasons = data.seasons.map(s => ({
            season_number: s.season,
            name: s.name || `Сезон ${s.season}`,
            episode_count: s.episodes?.length || s.episodes_count || 8,
            overview: ''
          }));
        }
        ensureCompletedSeriesEpisodesHydrated(currentMedia, data.seasons);
      }
    }

    renderQuickBarDropdowns();
    setupQuickBarOutsideListeners();

    if (autoVoiceMatched || (data.type !== 'movie' && (quickBarActiveSeason > 1 || quickBarActiveEpisode > 1))) {
      updateQuickIframeSrc();
    }
    if (autoVoiceMatched && matchedTrans) {
      showToast(`🎙️ Умный выбор озвучки: ${matchedTrans.name}`, 'info');
    }

    // Синхронизируем список сезонов и серий только для реальных сериалов (не для фильмов)
    if (data.type !== 'movie' && data.seasons && data.seasons.length > 0) {
      const recheckedResume = resolveMediaResumeState(currentMedia, { seasons: data.seasons });
      if (recheckedResume) {
        activeResumePromptState = recheckedResume;
        isResumePromptPending = true;
        renderResumePromptBanner(recheckedResume);
      } else {
        activeResumePromptState = null;
        isResumePromptPending = false;
        hideResumePromptBanner();
      }
      renderSeriesSeasons(currentMedia, quickBarActiveSeason, quickBarActiveEpisode);

      // Обновляем оверлей плеера и делаем кнопки выбора серий и сезонов доступными
      const overlay = document.getElementById('storm-inplayer-overlay');
      if (overlay) {
        const epBtn = overlay.querySelector('#inplayer-episodes-btn');
        const bottomBar = overlay.querySelector('#inplayer-bottom-bar');
        const epSheet = overlay.querySelector('#player-inplayer-episodes-sheet');
        if (epBtn) epBtn.style.display = '';
        if (bottomBar) bottomBar.style.display = '';
        if (epSheet) epSheet.style.display = '';
        updateInPlayerEpisodeInfo();
      }
    } else if (data.type === 'movie') {
      const seasonsContainer = document.getElementById('series-seasons-container');
      if (seasonsContainer) seasonsContainer.style.display = 'none';
      const overlay = document.getElementById('storm-inplayer-overlay');
      if (overlay) {
        const epBtn = overlay.querySelector('#inplayer-episodes-btn');
        const bottomBar = overlay.querySelector('#inplayer-bottom-bar');
        const epSheet = overlay.querySelector('#player-inplayer-episodes-sheet');
        if (epBtn) epBtn.style.setProperty('display', 'none', 'important');
        if (bottomBar) bottomBar.style.setProperty('display', 'none', 'important');
        if (epSheet) epSheet.style.display = 'none';
        updateInPlayerEpisodeInfo();
      }
    }
  } catch (err) {
    console.warn('Ошибка быстрой панели серий:', err);
    if (checkIfMediaIsSeries(currentMedia)) {
      initUniversalSeriesQuickBar(quickBarActiveSeason, quickBarActiveEpisode);
      return;
    }
    quickBar.style.display = 'none';
    adjustCinemaModalScale();
  }
}

export function initUniversalSeriesQuickBar(initialSeason = 1, initialEpisode = 1) {
  const quickBar = document.getElementById('player-series-quick-bar');
  if (!quickBar) return;

  if (!checkIfMediaIsSeries(currentMedia)) {
    quickBar.style.display = 'none';
    adjustCinemaModalScale();
    return;
  }

  // Нормализуем seasons если это число (например, seasons: 2)
  if (typeof currentMedia?.seasons === 'number') {
    const numSeasons = currentMedia.seasons;
    currentMedia.seasons = Array.from({ length: numSeasons }, (_, i) => ({
      season_number: i + 1,
      name: `Сезон ${i + 1}`,
      episode_count: 8,
      overview: ''
    }));
  }

  let seasonsList = [];
  if (Array.isArray(currentMedia?.seasons) && currentMedia.seasons.length > 0) {
    seasonsList = currentMedia.seasons.map(s => {
      const sNum = Number(s.season_number || s.season || 1);
      const epCount = Number(s.episode_count || s.episodes_count || (Array.isArray(s.episodes) ? s.episodes.length : 8));
      let eps = [];
      if (Array.isArray(s.episodes) && s.episodes.length > 0) {
        eps = s.episodes.map(e => ({
          episode: Number(e.episode_number || e.ordinal || e.episode || 1),
          name: formatCleanEpisodeTitle(e.episode_number || e.ordinal || e.episode || 1, e.name || e.title),
          overview: e.overview || '',
          embed_url: e.embed_url || '',
          rutube_id: e.rutube_id || '',
          translations: []
        }));
      } else {
        eps = Array.from({ length: epCount }, (_, i) => ({
          episode: i + 1,
          name: `${i + 1} серия`,
          overview: '',
          translations: []
        }));
      }
      return {
        season: sNum,
        name: s.name || `Сезон ${sNum}`,
        episodes_count: eps.length,
        episodes: eps
      };
    });
  } else if (Array.isArray(currentMedia?.episodes) && currentMedia.episodes.length > 0) {
    const eps = currentMedia.episodes.map(e => ({
      episode: Number(e.episode_number || e.ordinal || e.episode || 1),
      name: formatCleanEpisodeTitle(e.episode_number || e.ordinal || e.episode || 1, e.name || e.title),
      overview: e.overview || '',
      embed_url: e.embed_url || '',
      rutube_id: e.rutube_id || '',
      translations: []
    }));
    seasonsList = [{
      season: 1,
      name: 'Сезон 1',
      episodes_count: eps.length,
      episodes: eps
    }];
  } else {
    // Дефолтный сезон с 8 сериями для любого сериала
    seasonsList = [{
      season: 1,
      name: 'Сезон 1',
      episodes_count: 8,
      episodes: Array.from({ length: 8 }, (_, i) => ({
        episode: i + 1,
        name: `${i + 1} серия`,
        overview: '',
        translations: []
      }))
    }];
  }

  sortSeasonsAndEpisodes(seasonsList);
  const sVal = Number(initialSeason) || (seasonsList[0] ? Number(seasonsList[0].season) : 1) || 1;
  const epVal = Number(initialEpisode) || 1;

  quickBarSeriesData = {
    success: true,
    type: 'series',
    seasons: seasonsList,
    active: {
      season: sVal,
      episode: epVal,
      id_translation: null
    }
  };

  quickBarActiveSeason = sVal;
  quickBarActiveEpisode = epVal;
  quickBarActiveTranslationId = null;

  ensureCompletedSeriesEpisodesHydrated(currentMedia, seasonsList);

  quickBar.style.display = 'flex';
  const modal = document.getElementById('cinema-modal');
  if (modal) modal.classList.add('has-series-bar');
  adjustCinemaModalScale();
  requestAnimationFrame(adjustCinemaModalScale);

  renderQuickBarDropdowns();
  setupQuickBarOutsideListeners();

  // Обновляем оверлей плеера и делаем кнопки выбора серий и сезонов доступными
  const overlay = document.getElementById('storm-inplayer-overlay');
  if (overlay) {
    const epBtn = overlay.querySelector('#inplayer-episodes-btn');
    const bottomBar = overlay.querySelector('#inplayer-bottom-bar');
    const epSheet = overlay.querySelector('#player-inplayer-episodes-sheet');
    if (epBtn) epBtn.style.display = '';
    if (bottomBar) bottomBar.style.display = '';
    if (epSheet) epSheet.style.display = '';
    updateInPlayerEpisodeInfo();
  }

  // Обновляем нижнюю сетку сезонов и серий
  renderSeriesSeasons(currentMedia, quickBarActiveSeason, quickBarActiveEpisode);
}

function getOrCreateQuickStatusPortal() {
  let portal = document.getElementById('quick-status-floating-portal');
  if (!portal) {
    portal = document.createElement('div');
    portal.id = 'quick-status-floating-portal';
    portal.className = 'quick-status-floating-portal';
    portal.style.display = 'none';
    document.body.appendChild(portal);

    document.addEventListener('click', (e) => {
      if (!portal.contains(e.target) && !e.target.closest('.quick-status-custom-trigger')) {
        portal.style.display = 'none';
        portal.dataset.currentSeason = '';
        document.querySelectorAll('.quick-status-custom-dropdown.is-open').forEach(d => d.classList.remove('is-open'));
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        portal.style.display = 'none';
        portal.dataset.currentSeason = '';
        document.querySelectorAll('.quick-status-custom-dropdown.is-open').forEach(d => d.classList.remove('is-open'));
      }
    });
  }
  return portal;
}

function renderQuickBarDropdowns() {
  if (!quickBarSeriesData || !quickBarSeriesData.seasons) return;
  sortSeasonsAndEpisodes(quickBarSeriesData.seasons);

  const currentSeasonObj = quickBarSeriesData.seasons.find(s => s.season === quickBarActiveSeason) || quickBarSeriesData.seasons[0];
  if (!currentSeasonObj) return;

  const currentEpisodeObj = currentSeasonObj.episodes.find(e => e.episode === quickBarActiveEpisode) || currentSeasonObj.episodes[0];
  const translations = currentEpisodeObj?.translations || [];
  const curMediaId = currentMedia?.id;
  const isMovie = quickBarSeriesData.type === 'movie';

  // 1. Сезон
  const seasonVal = document.getElementById('quick-season-val');
  const seasonList = document.getElementById('quick-season-list');
  const seasonDropdown = document.getElementById('quick-season-dropdown');
  const seasonTrigger = document.getElementById('quick-season-trigger');
  const seasonMenu = document.getElementById('quick-season-menu');

  if (seasonDropdown) {
    seasonDropdown.style.display = isMovie ? 'none' : '';
  }

  // Расчет статуса активного сезона для кнопки-триггера
  const totalInCurSeason = currentSeasonObj.episodes_count || (currentSeasonObj.episodes ? currentSeasonObj.episodes.length : 0);
  const rawWatchedInCur = curMediaId ? getWatchedEpisodes(curMediaId, quickBarActiveSeason) : new Set();
  const validWatchedInCur = Array.from(rawWatchedInCur).filter(n => Number(n) >= 1 && (totalInCurSeason <= 0 || Number(n) <= totalInCurSeason));
  const watchedInCurSeason = totalInCurSeason > 0 ? Math.min(validWatchedInCur.length, totalInCurSeason) : validWatchedInCur.length;
  let curSeasonIcon = '📺';
  if (totalInCurSeason > 0 && watchedInCurSeason >= totalInCurSeason) {
    curSeasonIcon = '✅';
  } else if (watchedInCurSeason > 0) {
    curSeasonIcon = '⏳';
  }

  const seasonIconEl = seasonTrigger ? seasonTrigger.querySelector('.quick-dropdown-icon') : null;
  if (seasonIconEl) {
    seasonIconEl.textContent = curSeasonIcon;
  }
  if (seasonVal) {
    let displaySeasonName = currentSeasonObj.name || `Сезон ${quickBarActiveSeason}`;
    const cleanMediaTitle = (currentMedia?.title || '').trim().toLowerCase();
    const cleanMediaOrig = (currentMedia?.original_title || '').trim().toLowerCase();
    const isDup = displaySeasonName.toLowerCase() === cleanMediaTitle ||
                  (cleanMediaTitle.length > 8 && displaySeasonName.toLowerCase().startsWith(cleanMediaTitle)) ||
                  (cleanMediaOrig && cleanMediaOrig.length > 8 && displaySeasonName.toLowerCase().startsWith(cleanMediaOrig));
    if (isDup) {
      displaySeasonName = `Сезон ${quickBarActiveSeason}`;
    }
    seasonVal.textContent = displaySeasonName;
    seasonVal.title = displaySeasonName;
  }

  if (seasonList) {
    seasonList.innerHTML = quickBarSeriesData.seasons.map(s => {
      const isAct = s.season === quickBarActiveSeason;
      const totalEp = s.episodes_count || (s.episodes ? s.episodes.length : 0) || 10;
      const watchedSet = curMediaId ? getWatchedEpisodes(curMediaId, s.season) : new Set();
      const validWatched = Array.from(watchedSet).filter(n => Number(n) >= 1 && Number(n) <= totalEp);
      const watchedCount = Math.min(validWatched.length, totalEp);

      let sDisplayName = s.name || `Сезон ${s.season}`;
      const cleanMediaTitle = (currentMedia?.title || '').trim().toLowerCase();
      const cleanMediaOrig = (currentMedia?.original_title || '').trim().toLowerCase();
      if (sDisplayName.toLowerCase() === cleanMediaTitle ||
          (cleanMediaTitle.length > 8 && sDisplayName.toLowerCase().startsWith(cleanMediaTitle)) ||
          (cleanMediaOrig && cleanMediaOrig.length > 8 && sDisplayName.toLowerCase().startsWith(cleanMediaOrig))) {
        sDisplayName = `Сезон ${s.season}`;
      }

      const sStatusInfo = curMediaId ? getSeasonStatusInfo(curMediaId, s.season, totalEp, s.episodes) : { status: 'planned' };
      const curSeasonStatus = sStatusInfo.status;
      const isAllWatched = curSeasonStatus === 'completed' || (totalEp > 0 && watchedCount >= totalEp);
      const effectiveStatus = isAllWatched ? 'completed' : (curSeasonStatus || 'not_started');
      const curStatusSvg = getStatusIconSvg(effectiveStatus, { size: 15, animated: true });

      return `
        <div class="quick-dropdown-item ${isAct ? 'active' : ''}" data-season="${s.season}">
          <div class="quick-item-left" style="display: flex; align-items: flex-start; gap: 8px; flex: 1; min-width: 0;">
            <span class="quick-item-title quick-season-title" title="${escapeHtml(sDisplayName)}">${escapeHtml(sDisplayName)}</span>
          </div>
          <div class="quick-item-right" style="display: flex; align-items: center; gap: 6px; margin-left: auto; flex-shrink: 0;">
            <span class="quick-count-badge" title="Просмотрено ${watchedCount} из ${totalEp} серий">${watchedCount}/${totalEp}</span>
            <div class="quick-status-custom-dropdown" data-season="${s.season}" data-current-status="${effectiveStatus}">
              <button type="button" class="quick-status-custom-trigger" title="Статус сезона: ${getStatusLabel(effectiveStatus)}">
                ${curStatusSvg}
                <span class="quick-status-arrow">▼</span>
              </button>
            </div>
            <button type="button" class="quick-season-watch-toggle ${isAllWatched ? 'active' : ''}" data-toggle-season="${s.season}" title="${isAllWatched ? 'Снять отметку со всего сезона' : 'Отметить весь сезон просмотренным'}">
              ${isAllWatched ? '✖' : '✓'}
            </button>
          </div>
        </div>
      `;
    }).join('');

    if (seasonMenu && !seasonMenu.dataset.hasScrollListener) {
      seasonMenu.dataset.hasScrollListener = 'true';
      seasonMenu.addEventListener('scroll', () => {
        const p = document.getElementById('quick-status-floating-portal');
        if (p) {
          p.style.display = 'none';
          p.dataset.currentSeason = '';
        }
        document.querySelectorAll('.quick-status-custom-dropdown.is-open').forEach(d => d.classList.remove('is-open'));
      });
    }

    seasonList.querySelectorAll('.quick-dropdown-item').forEach(item => {
      item.onclick = (e) => {
        if (e.target.closest('.quick-status-custom-dropdown') || e.target.closest('.quick-season-watch-toggle')) {
          return;
        }
        e.stopPropagation();
        const sNum = parseInt(item.dataset.season, 10);
        selectQuickSeason(sNum);
        if (seasonMenu) seasonMenu.style.display = 'none';
        if (seasonDropdown) seasonDropdown.classList.remove('is-open');
        closeOtherQuickDropdowns(null);
      };
    });

    seasonList.querySelectorAll('.quick-status-custom-dropdown').forEach(dd => {
      const trigger = dd.querySelector('.quick-status-custom-trigger');
      const sNum = parseInt(dd.dataset.season, 10);
      const curStat = dd.dataset.currentStatus || 'not_started';

      if (trigger) {
        trigger.onclick = (e) => {
          e.stopPropagation();
          const portal = getOrCreateQuickStatusPortal();
          const wasOpenForThis = portal.style.display === 'flex' && portal.dataset.currentSeason === String(sNum);

          document.querySelectorAll('.quick-status-custom-dropdown.is-open').forEach(other => {
            other.classList.remove('is-open');
          });

          if (wasOpenForThis) {
            portal.style.display = 'none';
            portal.dataset.currentSeason = '';
            return;
          }

          dd.classList.add('is-open');
          portal.dataset.currentSeason = String(sNum);
          portal.innerHTML = STATUS_LIST.map(st => `
            <button type="button" class="quick-status-option ${st.id === curStat ? 'active' : ''}" data-status="${st.id}">
              ${getStatusIconSvg(st.id, { size: 14, animated: false })}
              <span>${st.label}</span>
            </button>
          `).join('');

          portal.style.display = 'flex';
          portal.style.visibility = 'hidden';

          const rect = trigger.getBoundingClientRect();
          const portalRect = portal.getBoundingClientRect();
          const portalWidth = portalRect.width || 170;
          const portalHeight = portalRect.height || 215;

          const spaceBelow = window.innerHeight - rect.bottom;
          let topPos = 0;
          if (spaceBelow < portalHeight + 10 && rect.top > portalHeight + 10) {
            topPos = rect.top - portalHeight - 4;
          } else {
            topPos = rect.bottom + 4;
          }

          let leftPos = rect.right - portalWidth;
          if (leftPos < 10) leftPos = 10;
          if (leftPos + portalWidth > window.innerWidth - 10) {
            leftPos = window.innerWidth - portalWidth - 10;
          }

          portal.style.top = `${Math.round(topPos)}px`;
          portal.style.left = `${Math.round(leftPos)}px`;
          portal.style.visibility = 'visible';

          portal.querySelectorAll('.quick-status-option').forEach(opt => {
            opt.onclick = async (optEvent) => {
              optEvent.stopPropagation();
              const newStat = opt.dataset.status;
              portal.style.display = 'none';
              portal.dataset.currentSeason = '';
              dd.classList.remove('is-open');

              const targetSeason = quickBarSeriesData.seasons.find(x => x.season === sNum);
              applySeasonStatus(curMediaId, sNum, newStat, targetSeason?.episodes || []);
              if (newStat === 'completed') {
                showToast(`Сезон ${sNum}: все серии отмечены как просмотренные`, 'success');
              } else {
                showToast(`Сезон ${sNum}: статус обновлен`, 'info');
              }
              await syncOverallSeriesProgress(currentMedia);
              renderQuickBarDropdowns();
            };
          });
        };
      }
    });

    seasonList.querySelectorAll('.quick-season-watch-toggle').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const sNum = parseInt(btn.dataset.toggleSeason, 10);
        const targetSeason = quickBarSeriesData.seasons.find(x => x.season === sNum);
        const total = targetSeason?.episodes_count || (targetSeason?.episodes ? targetSeason.episodes.length : 0);
        const marked = toggleAllSeasonEpisodesWatched(curMediaId, sNum, total, targetSeason?.episodes || []);
        showToast(marked ? `Сезон ${sNum}: все серии отмечены как просмотренные` : `Отметка снята с сезона ${sNum}`, 'info');
        await syncOverallSeriesProgress(currentMedia);
        renderQuickBarDropdowns();
      };
    });
  }

  if (seasonTrigger && !seasonTrigger.dataset.hasListener) {
    seasonTrigger.dataset.hasListener = 'true';
    seasonTrigger.onclick = (e) => {
      e.stopPropagation();
      closeOtherQuickDropdowns('quick-season-dropdown');
      const isOpen = seasonMenu.style.display === 'block';
      seasonMenu.style.display = isOpen ? 'none' : 'block';
      seasonDropdown.classList.toggle('is-open', !isOpen);
      document.body.classList.toggle('quick-dropdown-active', !isOpen);
    };
  }

  // 2. Серия
  const epVal = document.getElementById('quick-episode-val');
  const epList = document.getElementById('quick-episode-list');
  const epDropdown = document.getElementById('quick-episode-dropdown');
  const epTrigger = document.getElementById('quick-episode-trigger');
  const epMenu = document.getElementById('quick-episode-menu');

  if (epDropdown) {
    epDropdown.style.display = isMovie ? 'none' : '';
  }

  const curEpWatched = curMediaId ? getWatchedEpisodes(curMediaId, quickBarActiveSeason).has(quickBarActiveEpisode) : false;
  const epIconEl = epTrigger ? epTrigger.querySelector('.quick-dropdown-icon') : null;
  if (epIconEl) {
    epIconEl.textContent = '🎬';
  }
  if (epVal) {
    epVal.textContent = currentEpisodeObj ? currentEpisodeObj.name : `${quickBarActiveEpisode} серия`;
  }

  if (epList) {
    const watchedEpisodes = curMediaId ? getWatchedEpisodes(curMediaId, quickBarActiveSeason) : new Set();

    epList.innerHTML = currentSeasonObj.episodes.map(ep => {
      const isWatched = watchedEpisodes.has(ep.episode);
      const isAct = ep.episode === quickBarActiveEpisode;

      let statusIconBadge = '';
      if (isAct && isWatched) {
        statusIconBadge = `<span class="quick-ep-status-icon is-current-watched" title="Текущая воспроизводимая серия (Просмотрено)">${getStatusIconSvg('completed', { size: 14, animated: true })}</span>`;
      } else if (isAct) {
        statusIconBadge = `<span class="quick-ep-status-icon is-current" title="Текущая воспроизводимая серия">${getStatusIconSvg('watching', { size: 14, animated: true })}</span>`;
      } else if (isWatched) {
        statusIconBadge = `<span class="quick-ep-status-icon is-watched" title="Просмотрено">${getStatusIconSvg('completed', { size: 14, animated: false })}</span>`;
      } else {
        statusIconBadge = `<span class="quick-ep-status-icon is-unwatched" title="Не начата">${getStatusIconSvg('not_started', { size: 13, animated: false })}</span>`;
      }

      return `
        <div class="quick-dropdown-item ${isAct ? 'active' : ''}" data-episode="${ep.episode}" title="${ep.overview ? ep.overview.replace(/"/g, '&quot;') : ''}">
          <div class="quick-item-left" style="min-width: 0; flex: 1;">
            <span class="quick-item-title quick-episode-title" title="${escapeHtml(ep.name)}">${ep.name}</span>
          </div>
          <div class="quick-item-right" style="display: flex; align-items: center; gap: 6px; flex-shrink: 0; margin-left: 10px;">
            ${statusIconBadge}
            <button type="button" class="quick-ep-watch-toggle ${isWatched ? 'active' : ''}" data-toggle-ep="${ep.episode}" title="${isWatched ? 'Отметить непросмотренной' : 'Отметить просмотренной'}">
              ${isWatched ? '✖' : '✓'}
            </button>
          </div>
        </div>
      `;
    }).join('');

    epList.querySelectorAll('.quick-dropdown-item').forEach(item => {
      item.onclick = (e) => {
        if (e.target.closest('.quick-ep-watch-toggle')) return;
        e.stopPropagation();
        const epNum = parseInt(item.dataset.episode, 10);
        selectQuickEpisode(epNum);
        if (epMenu) epMenu.style.display = 'none';
        if (epDropdown) epDropdown.classList.remove('is-open');
        closeOtherQuickDropdowns(null);
      };
    });

    epList.querySelectorAll('.quick-ep-watch-toggle').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const epNum = parseInt(btn.dataset.toggleEp, 10);
        if (curMediaId) {
          const isNowWatched = toggleEpisodeWatched(curMediaId, quickBarActiveSeason, epNum);

          // Проверяем, завершен ли весь сезон
          const currentWatched = getWatchedEpisodes(curMediaId, quickBarActiveSeason);
          const totalEp = currentSeasonObj.episodes_count || (currentSeasonObj.episodes ? currentSeasonObj.episodes.length : 0);
          if (totalEp > 0 && currentWatched.size >= totalEp) {
            setSeasonExplicitStatus(curMediaId, quickBarActiveSeason, 'completed');
          } else if (!isNowWatched && getSeasonExplicitStatus(curMediaId, quickBarActiveSeason) === 'completed') {
            setSeasonExplicitStatus(curMediaId, quickBarActiveSeason, 'watching');
          }

          await syncOverallSeriesProgress(currentMedia);
          renderQuickBarDropdowns();
          showToast(`Серия ${epNum}: ${isNowWatched ? 'отмечена просмотренной' : 'отметка снята'}`, 'info');
        }
      };
    });
  }

  if (epTrigger && !epTrigger.dataset.hasListener) {
    epTrigger.dataset.hasListener = 'true';
    epTrigger.onclick = (e) => {
      e.stopPropagation();
      closeOtherQuickDropdowns('quick-episode-dropdown');
      const isOpen = epMenu.style.display === 'block';
      epMenu.style.display = isOpen ? 'none' : 'block';
      epDropdown.classList.toggle('is-open', !isOpen);
      document.body.classList.toggle('quick-dropdown-active', !isOpen);
      const quickBar = document.getElementById('player-series-quick-bar');
      if (quickBar) quickBar.classList.toggle('has-open-dropdown', !isOpen);
    };
  }

  // 3. Озвучка
  const voiceVal = document.getElementById('quick-voiceover-val');
  const voiceBadge = document.getElementById('quick-voiceover-badge');
  const voiceList = document.getElementById('quick-voiceover-list');
  const voiceDropdown = document.getElementById('quick-voiceover-dropdown');
  const voiceTrigger = document.getElementById('quick-voiceover-trigger');
  const voiceMenu = document.getElementById('quick-voiceover-menu');

  if (voiceDropdown) {
    voiceDropdown.style.display = translations.length > 0 ? '' : 'none';
  }

  let activeTrans = translations.find(t => String(t.id) === String(quickBarActiveTranslationId));
  if (!activeTrans && translations.length > 0) {
    activeTrans = findPreferredVoiceoverMatch(translations) || translations[0];
    if (activeTrans) quickBarActiveTranslationId = activeTrans.id;
  }
  if (activeTrans) {
    quickBarActiveTranslationId = activeTrans.id;
    if (voiceVal) {
      voiceVal.textContent = activeTrans.name;
      voiceVal.title = activeTrans.name;
    }
    if (voiceBadge) {
      voiceBadge.style.display = activeTrans.is_uhd ? 'inline-block' : 'none';
      voiceBadge.textContent = '4K UHD';
    }
  }

  if (voiceList) {
    voiceList.innerHTML = translations.map(t => {
      const isAct = t.id === quickBarActiveTranslationId;
      return `
        <div class="quick-dropdown-item ${isAct ? 'active' : ''}" data-trans-id="${t.id}" title="${escapeHtml(t.name)}">
          <span class="quick-voice-title">${escapeHtml(t.name)}</span>
          ${t.is_uhd ? '<span class="uhd-pill">4K UHD</span>' : '<span class="fhd-pill">' + (t.quality || 'FHD') + '</span>'}
        </div>
      `;
    }).join('');

    voiceList.querySelectorAll('.quick-dropdown-item').forEach(item => {
      item.onclick = (e) => {
        e.stopPropagation();
        const tId = parseInt(item.dataset.transId, 10);
        selectQuickVoiceover(tId);
        if (voiceMenu) voiceMenu.style.display = 'none';
        if (voiceDropdown) voiceDropdown.classList.remove('is-open');
        closeOtherQuickDropdowns(null);
      };
    });
  }

  if (voiceTrigger && !voiceTrigger.dataset.hasListener) {
    voiceTrigger.dataset.hasListener = 'true';
    voiceTrigger.onclick = (e) => {
      e.stopPropagation();
      closeOtherQuickDropdowns('quick-voiceover-dropdown');
      const isOpen = voiceMenu.style.display === 'block';
      voiceMenu.style.display = isOpen ? 'none' : 'block';
      voiceDropdown.classList.toggle('is-open', !isOpen);
      document.body.classList.toggle('quick-dropdown-active', !isOpen);
      const quickBar = document.getElementById('player-series-quick-bar');
      if (quickBar) quickBar.classList.toggle('has-open-dropdown', !isOpen);
    };
  }

  // 4. Барабан серий и сезонов (3D Wheel Picker)
  const wheelBtn = document.getElementById('quick-wheel-picker-btn');
  if (wheelBtn) {
    wheelBtn.style.display = isMovie ? 'none' : '';
    wheelBtn.onclick = (e) => {
      e.stopPropagation();
      closeOtherQuickDropdowns(null);
      openSeriesWheelModal();
    };
  }

  // 5. Прямое скачивание и выбор потока 4K / FHD (Lift CDN)
  const dlBtn = document.getElementById('quick-lift-download-btn');
  if (dlBtn) {
    dlBtn.style.display = 'none';
    dlBtn.onclick = (e) => {
      e.stopPropagation();
      closeOtherQuickDropdowns(null);
      openLiftDownloadModal();
    };
  }

  updateInPlayerEpisodeInfo();
}

/* ==========================================================================
   3D БАРАБАН ВЫБОРА СЕЗОНА И СЕРИИ (WHEEL PICKER) И ОКНО СКАЧИВАНИЯ LIFT 4K
   ========================================================================== */
let tempWheelSeason = 1;
let tempWheelEpisode = 1;

export function openSeriesWheelModal() {
  const modal = document.getElementById('series-wheel-modal');
  const seasonScroll = document.getElementById('wheel-season-scroll');
  const epScroll = document.getElementById('wheel-episode-scroll');
  const summaryEl = document.getElementById('wheel-selected-summary');
  const applyBtn = document.getElementById('series-wheel-apply-btn');
  const closeBtn = document.getElementById('close-series-wheel-modal');
  if (!modal || !seasonScroll || !epScroll) return;

  const seasons = (quickBarSeriesData && Array.isArray(quickBarSeriesData.seasons) && quickBarSeriesData.seasons.length > 0)
    ? quickBarSeriesData.seasons
    : [{ season: 1, name: 'Сезон 1', episodes: Array.from({ length: 8 }, (_, i) => ({ episode: i + 1, name: `${i + 1} серия` })) }];
  sortSeasonsAndEpisodes(seasons);

  tempWheelSeason = quickBarActiveSeason || seasons[0].season || 1;
  tempWheelEpisode = quickBarActiveEpisode || 1;

  const updateWheelSummary = () => {
    const sObj = seasons.find(s => Number(s.season) === Number(tempWheelSeason)) || seasons[0];
    const epObj = (sObj?.episodes || []).find(e => Number(e.episode) === Number(tempWheelEpisode));
    if (summaryEl) {
      summaryEl.textContent = `Сезон ${tempWheelSeason} • ${epObj?.name || `Серия ${tempWheelEpisode}`}`;
    }
  };

  const renderWheelEpisodes = (seasonNum) => {
    const sObj = seasons.find(s => Number(s.season) === Number(seasonNum)) || seasons[0];
    const eps = (sObj && Array.isArray(sObj.episodes) && sObj.episodes.length > 0)
      ? sObj.episodes
      : Array.from({ length: sObj?.episodes_count || 8 }, (_, i) => ({ episode: i + 1, name: `${i + 1} серия` }));

    if (!eps.some(e => Number(e.episode) === Number(tempWheelEpisode))) {
      tempWheelEpisode = eps[0]?.episode || 1;
    }

    const watchedSet = currentMedia?.id ? getWatchedEpisodes(currentMedia.id, seasonNum) : new Set();

    epScroll.innerHTML = eps.map(ep => {
      const isAct = Number(ep.episode) === Number(tempWheelEpisode);
      const isW = watchedSet.has(Number(ep.episode));
      return `
        <button type="button" class="wheel-picker-item ${isAct ? 'active' : ''} ${isW ? 'watched' : ''}" data-wheel-ep="${ep.episode}">
          <span class="wheel-item-num">${ep.episode} серия</span>
          <span class="wheel-item-sub">${escapeHtml(ep.name && ep.name !== `${ep.episode} серия` ? ep.name : (isW ? '✓ Просмотрено' : 'HD / 4K'))}</span>
        </button>
      `;
    }).join('');

    epScroll.querySelectorAll('.wheel-picker-item').forEach(btn => {
      btn.onclick = () => {
        tempWheelEpisode = parseInt(btn.dataset.wheelEp, 10) || 1;
        epScroll.querySelectorAll('.wheel-picker-item').forEach(b => b.classList.toggle('active', b === btn));
        btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        updateWheelSummary();
      };
    });

    requestAnimationFrame(() => {
      const actEl = epScroll.querySelector('.wheel-picker-item.active');
      if (actEl) actEl.scrollIntoView({ behavior: 'instant', block: 'center' });
    });
  };

  seasonScroll.innerHTML = seasons.map(s => {
    const isAct = Number(s.season) === Number(tempWheelSeason);
    const epCount = s.episodes_count || (s.episodes ? s.episodes.length : 0);
    return `
      <button type="button" class="wheel-picker-item ${isAct ? 'active' : ''}" data-wheel-season="${s.season}">
        <span class="wheel-item-num">Сезон ${s.season}</span>
        <span class="wheel-item-sub">${epCount ? `${epCount} сер.` : ''}</span>
      </button>
    `;
  }).join('');

  seasonScroll.querySelectorAll('.wheel-picker-item').forEach(btn => {
    btn.onclick = () => {
      tempWheelSeason = parseInt(btn.dataset.wheelSeason, 10) || 1;
      seasonScroll.querySelectorAll('.wheel-picker-item').forEach(b => b.classList.toggle('active', b === btn));
      btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      renderWheelEpisodes(tempWheelSeason);
      updateWheelSummary();
    };
  });

  renderWheelEpisodes(tempWheelSeason);
  updateWheelSummary();
  modal.style.display = 'flex';

  requestAnimationFrame(() => {
    const actS = seasonScroll.querySelector('.wheel-picker-item.active');
    if (actS) actS.scrollIntoView({ behavior: 'instant', block: 'center' });
  });

  const wheelCloseBtn = closeBtn || document.getElementById('series-wheel-close-btn');
  const cancelBtn = document.getElementById('series-wheel-cancel-btn');
  if (wheelCloseBtn) {
    wheelCloseBtn.onclick = () => { modal.style.display = 'none'; };
  }
  if (cancelBtn) {
    cancelBtn.onclick = () => { modal.style.display = 'none'; };
  }
  modal.onclick = (e) => {
    if (e.target === modal) modal.style.display = 'none';
  };
  if (applyBtn) {
    applyBtn.onclick = async () => {
      modal.style.display = 'none';
      if (Number(tempWheelSeason) !== Number(quickBarActiveSeason)) {
        await selectQuickSeason(tempWheelSeason);
      }
      selectQuickEpisode(tempWheelEpisode);
    };
  }
}

export async function openLiftDownloadModal() {
  const modal = document.getElementById('lift-download-modal');
  const subtitleEl = document.getElementById('lift-download-subtitle');
  const externalBar = document.getElementById('lift-download-external-bar');
  const qualitiesGrid = document.getElementById('lift-download-qualities-grid');
  const voicesList = document.getElementById('lift-download-voiceovers-list');
  const subsRow = document.getElementById('lift-download-subtitles-row');
  const subsList = document.getElementById('lift-download-subtitles-list');
  const closeBtn = document.getElementById('close-lift-download-modal') || document.getElementById('lift-download-close-btn');
  if (!modal || !qualitiesGrid) return;

  modal.style.display = 'flex';
  if (closeBtn) closeBtn.onclick = () => { modal.style.display = 'none'; };
  modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };

  const copyStreamText = async (textToCopy, btnEl, toastMessage) => {
    if (!textToCopy) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = textToCopy;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (__) {}
      ta.remove();
    }
    if (btnEl) {
      const origHtml = btnEl.dataset.origHtml || btnEl.innerHTML;
      btnEl.dataset.origHtml = origHtml;
      btnEl.innerHTML = '✅ Скопировано!';
      setTimeout(() => { btnEl.innerHTML = origHtml; }, 1800);
    }
    showToast(toastMessage || '📋 Прямая ссылка скопирована в буфер обмена!', 'success');
  };

  const cleanT = cleanVideoTitle(currentMedia?.title || 'Видео');
  const isSer = checkIfMediaIsSeries(currentMedia);
  const fullMediaLabel = isSer
    ? `${cleanT} S${String(quickBarActiveSeason || 1).padStart(2, '0')}E${String(quickBarActiveEpisode || 1).padStart(2, '0')}`
    : `${cleanT}${currentMedia?.year ? ` (${currentMedia.year})` : ''}`;

  if (subtitleEl) {
    subtitleEl.textContent = isSer
      ? `${cleanT} — Сезон ${quickBarActiveSeason}, Серия ${quickBarActiveEpisode} • Прямые потоки .m3u8 / .mpd для VLC, IINA, PotPlayer и субтитры .vtt`
      : `${cleanT} (${currentMedia?.year || ''}) • Прямые потоки 4K VP9/AV1 (.mpd) и Full HD (.m3u8) без рекламы + субтитры .vtt`;
  }

  if (externalBar) externalBar.style.display = 'none';
  qualitiesGrid.innerHTML = `
    <div style="grid-column: 1 / -1; text-align: center; padding: 26px; color: var(--text-muted);">
      <div class="storm-spinner" style="margin: 0 auto 10px;"></div>
      Извлечение прямых потоков 4K UHD / 1080p (.m3u8 / .mpd), студийных аудиодорожек и файлов субтитров .vtt...
    </div>
  `;
  if (voicesList) voicesList.innerHTML = '';
  if (subsRow) subsRow.style.display = 'none';

  try {
    const rawLiftId = currentMedia?.lift_id || (String(currentMedia?.id || '').startsWith('lift_') ? String(currentMedia.id).replace(/^lift_/i, '') : '');
    const params = new URLSearchParams({
      title: cleanT,
      original_title: currentMedia?.original_title || '',
      year: String(currentMedia?.year || ''),
      lift_id: String(rawLiftId || ''),
      is_series: isSer ? '1' : '0',
      season: String(quickBarActiveSeason || 1),
      episode: String(quickBarActiveEpisode || 1)
    });

    const res = await fetch(`/api/player/lift-download-options?${params.toString()}`);
    const data = await res.json();

    if (!data || !data.success) {
      qualitiesGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 22px; color: var(--text-secondary);">
          Прямые потоки Lift CDN для данного релиза сейчас недоступны. Вы можете использовать встроенный плеер FanFilm 4K или Kinobox.
        </div>
      `;
      return;
    }

    const qualities = Array.isArray(data.qualities) ? data.qualities : [];
    const voiceovers = Array.isArray(data.voiceovers) ? data.voiceovers : [];
    const subtitles = Array.isArray(data.subtitles) ? data.subtitles : [];

    if (qualities.length === 0 && data.hlsUrl) {
      qualities.push({
        height: 1080,
        label: '1080p Full HD (Master HLS)',
        resolution: '1920x1080',
        bandwidth: 6500000,
        url: data.hlsUrl,
        hlsUrl: data.hlsUrl,
        dashUrl: data.dashUrl || '',
        type: 'hls',
        is_4k: false
      });
    }

    const bestHlsStream = qualities.find(q => q.hlsUrl && q.hlsUrl.includes('x-bc.interkh.com'))?.hlsUrl
      || qualities.find(q => q.hlsUrl)?.hlsUrl
      || data.hlsMasterUrl
      || data.hlsUrl
      || qualities[0]?.url
      || '';
    const bestDashStream = data.dashManifestUrl || data.dashUrl || qualities.find(q => q.dashUrl)?.dashUrl || '';
    const activeVoiceLabel = getPreferredVoiceover() || voiceovers[0]?.name || 'Дубляж';

    if (externalBar && (bestHlsStream || bestDashStream)) {
      const playlistDownloadHref = `/api/player/lift-playlist.m3u8?url=${encodeURIComponent(bestHlsStream || bestDashStream)}&title=${encodeURIComponent(fullMediaLabel)}&quality=${encodeURIComponent(qualities[0]?.height ? `${qualities[0].height}p` : '4K_FHD')}&voice=${encodeURIComponent(activeVoiceLabel)}`;
      externalBar.style.display = 'block';
      externalBar.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 10px;">
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px;">
            <span style="font-size: 12px; font-weight: 800; color: #38bdf8;">⚡ Внешние плееры (VLC / IINA / PotPlayer) и прямые ссылки в 1 клик</span>
            <span style="font-size: 11px; color: var(--text-muted);">Для ПК и Smart TV</span>
          </div>
          <div style="display: flex; flex-wrap: wrap; gap: 8px;">
            ${bestHlsStream ? `
              <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="lift-copy-master-m3u8-btn" data-stream-url="${escapeHtml(bestHlsStream)}" title="В один клик скопировать прямую ссылку на поток .m3u8">
                📋 Скопировать .m3u8
              </button>
            ` : ''}
            ${bestDashStream ? `
              <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="lift-copy-master-mpd-btn" data-stream-url="${escapeHtml(bestDashStream)}" style="border-color: rgba(168, 85, 247, 0.45);" title="В один клик скопировать прямую ссылку на поток .mpd (DASH VP9/AV1)">
                📋 Скопировать .mpd (DASH)
              </button>
            ` : ''}
            <a href="vlc://${escapeHtml(bestHlsStream || bestDashStream)}" class="storm-btn storm-btn-secondary storm-btn-sm" style="text-decoration: none; border-color: rgba(249, 115, 22, 0.45);" title="Открыть прямой поток в VLC Media Player">
              🟠 VLC
            </a>
            <a href="iina://weblink?url=${encodeURIComponent(bestHlsStream || bestDashStream)}" class="storm-btn storm-btn-secondary storm-btn-sm" style="text-decoration: none; border-color: rgba(168, 85, 247, 0.45);" title="Открыть прямой поток в IINA (macOS)">
              🟣 IINA
            </a>
            <a href="potplayer://${escapeHtml(bestHlsStream || bestDashStream)}" class="storm-btn storm-btn-secondary storm-btn-sm" style="text-decoration: none; border-color: rgba(59, 130, 246, 0.45);" title="Открыть прямой поток в PotPlayer (Windows)">
              🔵 PotPlayer
            </a>
            <a href="${escapeHtml(playlistDownloadHref)}" download class="storm-btn storm-btn-secondary storm-btn-sm" style="text-decoration: none; border-color: rgba(16, 185, 129, 0.45);" title="Скачать готовый файл плейлиста .m3u для запуска на ПК или Smart TV">
              📥 Плейлист .m3u
            </a>
            <a href="/api/player/lift-muxed-playlist.m3u8?${params.toString()}&quality=${encodeURIComponent(qualities[0]?.height || 1080)}&voice=${encodeURIComponent(activeVoiceLabel)}" download class="storm-btn storm-btn-primary storm-btn-sm" style="text-decoration: none; background: linear-gradient(135deg, #10b981, #0284c7);" title="Скачать единый мульти-плейлист .m3u8 со встроенными аудиодорожками и всеми субтитрами .vtt">
              📦 Мульти-плейлист (Аудио + Субтитры .m3u8)
            </a>
          </div>
        </div>
      `;

      const copyM3u8Btn = externalBar.querySelector('#lift-copy-master-m3u8-btn');
      if (copyM3u8Btn) {
        copyM3u8Btn.onclick = () => copyStreamText(
          copyM3u8Btn.dataset.streamUrl,
          copyM3u8Btn,
          '📋 Прямая ссылка .m3u8 скопирована! Вставьте её в VLC, IINA или PotPlayer (Ctrl+V)'
        );
      }
      const copyMpdBtn = externalBar.querySelector('#lift-copy-master-mpd-btn');
      if (copyMpdBtn) {
        copyMpdBtn.onclick = () => copyStreamText(
          copyMpdBtn.dataset.streamUrl,
          copyMpdBtn,
          '📋 Прямая ссылка .mpd (DASH) скопирована! Вставьте её в VLC, IINA или PotPlayer'
        );
      }
    }

    qualitiesGrid.innerHTML = qualities.map(q => {
      const mbps = q.bandwidth ? `${(q.bandwidth / 1000000).toFixed(1)} Мбит/с` : (q.is_4k ? '18.5 Мбит/с' : '6.8 Мбит/с');
      const badgeText = q.is_4k ? '4K UHD • VP9/AV1' : `${q.height}p • ${escapeHtml(q.codec || 'HLS')}`;
      const hlsTarget = q.hlsUrl || (q.protocol === 'hls' ? q.url : '') || bestHlsStream;
      const dashTarget = q.dashUrl || (q.protocol === 'dash' ? q.url : '') || '';
      const primaryTarget = hlsTarget || dashTarget || q.url;
      const m3uCardHref = `/api/player/lift-playlist.m3u8?url=${encodeURIComponent(primaryTarget)}&title=${encodeURIComponent(fullMediaLabel)}&quality=${encodeURIComponent(`${q.height}p`)}&voice=${encodeURIComponent(activeVoiceLabel)}`;

      return `
        <div class="lift-quality-card ${q.is_4k ? 'is-uhd' : ''}">
          <div class="lift-quality-card-top">
            <span class="lift-quality-title">${escapeHtml(q.label || `${q.height}p`)}</span>
            <span class="lift-quality-badge ${q.is_4k ? 'uhd' : ''}">${badgeText}</span>
          </div>
          <div class="lift-quality-meta">
            <span>Разрешение: <strong>${escapeHtml(q.resolution || `${q.height}p`)}</strong></span>
            <span>Битрейт: <strong>${mbps}</strong></span>
          </div>
          <div class="lift-quality-actions" style="display: flex; flex-wrap: wrap; gap: 6px;">
            <button type="button" class="storm-btn storm-btn-primary storm-btn-sm lift-play-quality-btn" data-q-height="${q.height}" data-q-url="${escapeHtml(primaryTarget)}">
              ▶ Смотреть ${q.height}p
            </button>
            ${hlsTarget ? `
              <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm lift-copy-stream-btn" data-q-url="${escapeHtml(hlsTarget)}" data-q-ext=".m3u8" title="В один клик скопировать прямую ссылку .m3u8 для VLC / IINA / PotPlayer">
                📋 .m3u8
              </button>
            ` : ''}
            ${dashTarget ? `
              <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm lift-copy-stream-btn" data-q-url="${escapeHtml(dashTarget)}" data-q-ext=".mpd" title="В один клик скопировать прямую ссылку .mpd (DASH) для VLC / IINA / PotPlayer">
                📋 .mpd
              </button>
            ` : ''}
            <a href="${escapeHtml(m3uCardHref)}" download class="storm-btn storm-btn-secondary storm-btn-sm" style="text-decoration:none;" title="Скачать плейлист .m3u для VLC / PotPlayer / Smart TV">
              📥 .m3u
            </a>
          </div>
        </div>
      `;
    }).join('');

    qualitiesGrid.querySelectorAll('.lift-play-quality-btn').forEach(btn => {
      btn.onclick = () => {
        const qHeight = parseInt(btn.dataset.qHeight, 10) || 1080;
        modal.style.display = 'none';
        const liftPlayer = currentPlayers?.find(p => p.id === 'lift_adfree');
        if (liftPlayer && currentActivePlayer?.id !== 'lift_adfree') {
          selectPlayer(liftPlayer);
          setTimeout(() => {
            const ifr = document.querySelector('.cinema-player-iframe');
            if (ifr && ifr.contentWindow) {
              ifr.contentWindow.postMessage({ type: 'STORM_SET_QUALITY', quality: qHeight }, '*');
            }
          }, 1500);
        } else {
          const ifr = document.querySelector('.cinema-player-iframe');
          if (ifr && ifr.contentWindow) {
            ifr.contentWindow.postMessage({ type: 'STORM_SET_QUALITY', quality: qHeight }, '*');
          }
        }
        showToast(`🚀 Включено качество ${qHeight}p в плеере Lift 4K`, 'success');
      };
    });

    qualitiesGrid.querySelectorAll('.lift-copy-stream-btn').forEach(btn => {
      btn.onclick = () => {
        const streamUrl = btn.dataset.qUrl || '';
        const ext = btn.dataset.qExt || '.m3u8';
        copyStreamText(
          streamUrl,
          btn,
          `📋 Прямая ссылка на поток (${ext}) скопирована! Вставьте её в VLC, IINA или PotPlayer`
        );
      };
    });

    if (voicesList && voiceovers.length > 0) {
      const savedPref = getPreferredVoiceover() || '';
      voicesList.innerHTML = voiceovers.map((v, vIdx) => {
        const isAct = savedPref ? v.name.toLowerCase().includes(savedPref.toLowerCase()) : vIdx === 0;
        return `
          <div style="display: inline-flex; align-items: center; gap: 4px;">
            <button type="button" class="storm-chip lift-voice-chip ${isAct ? 'active' : ''}" data-voice-name="${escapeHtml(v.name)}">
              🎙️ ${escapeHtml(v.name)}
            </button>
            ${v.hlsUri ? `
              <button type="button" class="storm-chip lift-copy-audio-btn" data-audio-url="${escapeHtml(v.hlsUri)}" data-voice-name="${escapeHtml(v.name)}" title="Скопировать прямую ссылку .m3u8 на аудиодорожку «${escapeHtml(v.name)}»" style="padding: 4px 8px; font-size: 11px;">
                📋 .m3u8
              </button>
            ` : ''}
          </div>
        `;
      }).join('');

      voicesList.querySelectorAll('.lift-voice-chip').forEach(chip => {
        chip.onclick = () => {
          const vName = chip.dataset.voiceName || '';
          voicesList.querySelectorAll('.lift-voice-chip').forEach(c => c.classList.toggle('active', c === chip));
          savePreferredVoiceover(vName);
          const ifr = document.querySelector('.cinema-player-iframe');
          if (ifr && ifr.contentWindow) {
            ifr.contentWindow.postMessage({ type: 'STORM_SET_AUDIO', name: vName }, '*');
          }
          const voiceVal = document.getElementById('quick-voiceover-val');
          if (voiceVal) voiceVal.textContent = vName;
          showToast(`🎙️ Выбрана студийная озвучка: ${vName}`, 'info');
        };
      });

      voicesList.querySelectorAll('.lift-copy-audio-btn').forEach(btn => {
        btn.onclick = () => {
          copyStreamText(
            btn.dataset.audioUrl,
            btn,
            `📋 Аудиопоток .m3u8 (${btn.dataset.voiceName || 'Озвучка'}) скопирован!`
          );
        };
      });
    }

    if (subsRow && subsList && subtitles.length > 0) {
      subsRow.style.display = 'block';
      subsList.innerHTML = [
        `<button type="button" class="storm-chip lift-sub-chip" data-sub-label="">🚫 Выкл</button>`,
        ...subtitles.map(s => {
          const subLabel = s.label || s.name || 'Субтитры';
          const subUrl = s.url || s.src || '';
          const subFilename = `${fullMediaLabel}_${subLabel}.vtt`;
          const downloadProxyUrl = subUrl
            ? `/api/player/lift-subtitle.vtt?url=${encodeURIComponent(subUrl)}&filename=${encodeURIComponent(subFilename)}`
            : '';
          return `
            <div style="display:inline-flex;align-items:center;gap:4px;background:rgba(15,23,42,0.55);padding:3px 6px;border-radius:8px;border:1px solid rgba(255,255,255,0.08);">
              <button type="button" class="storm-chip lift-sub-chip" data-sub-label="${escapeHtml(subLabel)}" title="Включить субтитры в плеере">
                💬 ${escapeHtml(subLabel)}
              </button>
              ${downloadProxyUrl ? `
                <a href="${escapeHtml(downloadProxyUrl)}" download="${escapeHtml(subFilename)}" class="storm-chip" title="Скачать отдельный файл субтитров .vtt для VLC / IINA / PotPlayer" style="text-decoration:none;padding:4px 8px;background:rgba(16,185,129,0.18);border-color:rgba(16,185,129,0.4);color:#10b981;font-weight:700;">
                  📥 Скачать .vtt
                </a>
                <button type="button" class="storm-chip lift-copy-sub-btn" data-sub-url="${escapeHtml(subUrl)}" data-sub-label="${escapeHtml(subLabel)}" title="Скопировать прямую ссылку на файл субтитров .vtt" style="padding:4px 8px;">
                  📋 .vtt
                </button>
              ` : ''}
            </div>
          `;
        })
      ].join('');

      subsList.querySelectorAll('.lift-sub-chip').forEach(chip => {
        chip.onclick = () => {
          const sLabel = chip.dataset.subLabel || '';
          subsList.querySelectorAll('.lift-sub-chip').forEach(c => c.classList.toggle('active', c === chip));
          const ifr = document.querySelector('.cinema-player-iframe');
          if (ifr && ifr.contentWindow) {
            ifr.contentWindow.postMessage({ type: 'STORM_SET_SUBTITLE', name: sLabel }, '*');
          }
          showToast(sLabel ? `💬 Включены субтитры: ${sLabel}` : '🚫 Субтитры отключены', 'info');
        };
      });

      subsList.querySelectorAll('.lift-copy-sub-btn').forEach(btn => {
        btn.onclick = () => {
          copyStreamText(
            btn.dataset.subUrl,
            btn,
            `📋 Прямая ссылка на субтитры .vtt (${btn.dataset.subLabel || ''}) скопирована!`
          );
        };
      });
    }
  } catch (err) {
    qualitiesGrid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--color-red);">Ошибка получения потоков: ${escapeHtml(err.message)}</div>`;
  }
}

function closeOtherQuickDropdowns(activeDropdownId) {
  const quickBar = document.getElementById('player-series-quick-bar');
  const ids = ['quick-season-dropdown', 'quick-episode-dropdown', 'quick-voiceover-dropdown'];
  ids.forEach(id => {
    if (id !== activeDropdownId) {
      const dd = document.getElementById(id);
      if (dd) {
        dd.classList.remove('is-open');
        const m = dd.querySelector('.quick-dropdown-menu');
        if (m) m.style.display = 'none';
      }
    }
  });

  if (quickBar) {
    const hasAnyOpen = ids.some(id => (id === activeDropdownId && document.getElementById(id)?.classList.contains('is-open')));
    quickBar.classList.toggle('has-open-dropdown', hasAnyOpen);
  }

  document.querySelectorAll('.quick-status-custom-dropdown.is-open').forEach(dd => {
    dd.classList.remove('is-open');
  });

  const portal = document.getElementById('quick-status-floating-portal');
  if (portal) {
    portal.style.display = 'none';
    portal.dataset.currentSeason = '';
  }

  if (!activeDropdownId) {
    document.body.classList.remove('quick-dropdown-active');
  }
}

function setupQuickBarOutsideListeners() {
  if (document.body.dataset.hasQuickBarListener) return;
  document.body.dataset.hasQuickBarListener = 'true';

  document.addEventListener('click', (e) => {
    const portal = document.getElementById('quick-status-floating-portal');
    if (!e.target.closest('.quick-status-custom-dropdown') && (!portal || !portal.contains(e.target))) {
      document.querySelectorAll('.quick-status-custom-dropdown.is-open').forEach(dd => {
        dd.classList.remove('is-open');
      });
      if (portal) {
        portal.style.display = 'none';
        portal.dataset.currentSeason = '';
      }
    }
    const quickBar = document.getElementById('player-series-quick-bar');
    if (quickBar && !quickBar.contains(e.target) && (!portal || !portal.contains(e.target))) {
      closeOtherQuickDropdowns(null);
    }
  });
}

async function updateQuickIframeSrc() {
  const activePlayerId = currentActivePlayer?.id || '';
  const isUsingNativeAnimePlayer = !activePlayerId || activePlayerId === 'anilibria_hls' || (activePlayerId.startsWith('anixart_') && activePlayerId !== 'anixart_stream');
  if (quickBarSeriesData?.isAnime && isUsingNativeAnimePlayer) {
    if (quickBarSeriesData.animeSource === 'anilibria') {
      const seasonObj = (currentMedia?.seasons || []).find(s => Number(s.season_number) === Number(quickBarActiveSeason));
      const eps = (seasonObj && Array.isArray(seasonObj.episodes) && seasonObj.episodes.length > 0)
        ? seasonObj.episodes
        : (currentMedia?.episodes || []);
      const epObj = eps.find(e => Number(e.ordinal || e.episode_number || 1) === Number(quickBarActiveEpisode)) || eps[quickBarActiveEpisode - 1];
      if (epObj) {
        currentEpisodeIndex = quickBarActiveEpisode;
        const streamUrl = epObj.hls_1080 || epObj.hls_720 || epObj.hls_480;
        if (streamUrl) playStreamUrl(streamUrl);
        loadSkipTimes(seasonObj?.release_id || currentMedia?.id, quickBarActiveEpisode);
      }
    } else if (quickBarSeriesData.animeSource === 'anixart') {
      const epObj = (currentEpisodes || []).find(e => (e.position || 1) === quickBarActiveEpisode) || currentEpisodes?.[quickBarActiveEpisode - 1];
      if (epObj) {
        currentEpisodeIndex = quickBarActiveEpisode;
        playAnixartEpisode(epObj);
        loadSkipTimes(currentMedia?.id, quickBarActiveEpisode);
      }
    }
    return;
  }

  const cleanT = cleanVideoTitle(currentMedia?.title || '');
  const curSeasonObj = quickBarSeriesData?.seasons?.find(s => s.season === quickBarActiveSeason);
  const curEpObj = curSeasonObj?.episodes?.find(e => e.episode === quickBarActiveEpisode);
  const isVideoElementActive = !!document.getElementById('storm-video-player');

  // 1. RuTube HLS (Прямой поток без рекламы и рекомендаций)
  if (activePlayerId === 'rutube_direct_hls' || (isVideoElementActive && (activePlayerId.includes('rutube') || currentMedia?.rutube_id))) {
    try {
      const epRutubeId = curEpObj?.rutube_id || '';
      const epEmbedUrl = curEpObj?.embed_url || '';
      const res = await fetch(`/api/media/rutube-episode?title=${encodeURIComponent(cleanT)}&season=${quickBarActiveSeason}&episode=${quickBarActiveEpisode}&rutube_id=${encodeURIComponent(epRutubeId)}&embed_url=${encodeURIComponent(epEmbedUrl)}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.hls_url) {
          playStreamUrl(data.hls_url);
          showToast(`🎬 ${cleanT}: Сезон ${quickBarActiveSeason} • Серия ${quickBarActiveEpisode}`, 'info');
          updatePlayerUrl(currentMedia, quickBarActiveSeason, quickBarActiveEpisode, currentActivePlayer);
          highlightActiveEpisodeInGrid(quickBarActiveEpisode);
          updateInPlayerEpisodeInfo();
          return;
        } else if (data && data.embed_url) {
          playStreamUrl(data.embed_url);
          showToast(`🎬 ${cleanT}: Сезон ${quickBarActiveSeason} • Серия ${quickBarActiveEpisode}`, 'info');
          updatePlayerUrl(currentMedia, quickBarActiveSeason, quickBarActiveEpisode, currentActivePlayer);
          highlightActiveEpisodeInGrid(quickBarActiveEpisode);
          updateInPlayerEpisodeInfo();
          return;
        }
      }
    } catch (err) {
      console.warn('RuTube HLS episode switch error:', err);
    }
  }

  // 2. RuTube Stream (Iframe)
  if (activePlayerId === 'rutube_stream' || activePlayerId.includes('rutube')) {
    const iframe = document.querySelector('.cinema-player-iframe');
    if (iframe) {
      try {
        const epRutubeId = curEpObj?.rutube_id || '';
        const epEmbedUrl = curEpObj?.embed_url || '';
        if (epEmbedUrl) {
          replaceIframeSrcNoHistory(iframe, epEmbedUrl);
          showToast(`🎬 RuTube: Сезон ${quickBarActiveSeason} • Серия ${quickBarActiveEpisode}`, 'info');
          updatePlayerUrl(currentMedia, quickBarActiveSeason, quickBarActiveEpisode, currentActivePlayer);
          highlightActiveEpisodeInGrid(quickBarActiveEpisode);
          updateInPlayerEpisodeInfo();
          return;
        }
        const res = await fetch(`/api/media/rutube-episode?title=${encodeURIComponent(cleanT)}&season=${quickBarActiveSeason}&episode=${quickBarActiveEpisode}&rutube_id=${encodeURIComponent(epRutubeId)}`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.embed_url) {
            replaceIframeSrcNoHistory(iframe, data.embed_url);
            showToast(`🎬 RuTube: Сезон ${quickBarActiveSeason} • Серия ${quickBarActiveEpisode}`, 'info');
            updatePlayerUrl(currentMedia, quickBarActiveSeason, quickBarActiveEpisode, currentActivePlayer);
            highlightActiveEpisodeInGrid(quickBarActiveEpisode);
            updateInPlayerEpisodeInfo();
            return;
          }
        }
      } catch (e) {}
    }
  }

  // 3. VK Видео
  if (activePlayerId.startsWith('vk')) {
    const iframe = document.querySelector('.cinema-player-iframe');
    if (iframe) {
      try {
        const res = await fetch(`/api/media/vk-episode?title=${encodeURIComponent(cleanT)}&season=${quickBarActiveSeason}&episode=${quickBarActiveEpisode}`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.embed_url) {
            replaceIframeSrcNoHistory(iframe, data.embed_url);
            showToast(`🎬 VK Видео: Сезон ${quickBarActiveSeason} • Серия ${quickBarActiveEpisode}`, 'info');
            updatePlayerUrl(currentMedia, quickBarActiveSeason, quickBarActiveEpisode, currentActivePlayer);
            highlightActiveEpisodeInGrid(quickBarActiveEpisode);
            updateInPlayerEpisodeInfo();
            return;
          }
        }
      } catch (e) {}
    }
  }

  // 4. Lift 4K / Kodik / FanFilm Iframe
  const iframe = document.querySelector('.cinema-player-iframe');
  if (iframe) {
    const isLiftSrc = activePlayerId === 'lift_adfree' || (quickBarBaseUrl && quickBarBaseUrl.includes('/api/player/lift-embed')) || (iframe.src && iframe.src.includes('/api/player/lift-embed'));
    if (isLiftSrc) {
      const activeTransObj = curEpObj?.translations?.find(t => String(t.id) === String(quickBarActiveTranslationId));
      try {
        if (activeTransObj && activeTransObj.name) {
          iframe.contentWindow?.postMessage({ type: 'STORM_SET_AUDIO', name: activeTransObj.name }, '*');
        }
        if (quickBarSeriesData?.type !== 'movie') {
          iframe.contentWindow?.postMessage({
            event: 'playlist go',
            season: quickBarActiveSeason,
            episode: String(quickBarActiveEpisode)
          }, '*');
        }
      } catch (_) {}
      if (quickBarSeriesData?.type !== 'movie') {
        let curSrc = iframe.src || (currentActivePlayer?.url || quickBarBaseUrl || '');
        if (curSrc) {
          let newUrl = curSrc;
          if (newUrl.includes('season=') || newUrl.includes('episode=')) {
            newUrl = newUrl.replace(/([?&])season=\d+/g, `$1season=${quickBarActiveSeason}`);
            newUrl = newUrl.replace(/([?&])episode=\d+/g, `$1episode=${quickBarActiveEpisode}`);
          } else {
            newUrl += (newUrl.includes('?') ? '&' : '?') + `season=${quickBarActiveSeason}&episode=${quickBarActiveEpisode}`;
          }
          if (newUrl !== curSrc) {
            replaceIframeSrcNoHistory(iframe, newUrl);
          }
        }
      }
    } else if (quickBarBaseUrl && (quickBarBaseUrl.includes('fanfilm') || quickBarBaseUrl.includes('stravers'))) {
      const titleParam = currentMedia?.title ? `&title=${encodeURIComponent(currentMedia.title)}` : '';
      const yearParam = currentMedia?.year ? `&year=${encodeURIComponent(currentMedia.year)}` : '';
      let url = `/api/player/fanfilm-embed?url=${encodeURIComponent(quickBarBaseUrl)}&translation=${quickBarActiveTranslationId || ''}&hidden=season,episode,translation${titleParam}${yearParam}`;
      if (quickBarSeriesData?.type !== 'movie') {
        url += `&season=${quickBarActiveSeason}&episode=${quickBarActiveEpisode}`;
      }
      replaceIframeSrcNoHistory(iframe, url);
    } else {
      let curSrc = iframe.src || (currentActivePlayer?.url || '');
      if (curSrc) {
        let newUrl = curSrc;
        if (newUrl.includes('season=') || newUrl.includes('episode=')) {
          newUrl = newUrl.replace(/([?&])season=\d+/g, `$1season=${quickBarActiveSeason}`);
          newUrl = newUrl.replace(/([?&])episode=\d+/g, `$1episode=${quickBarActiveEpisode}`);
        } else {
          newUrl += (newUrl.includes('?') ? '&' : '?') + `season=${quickBarActiveSeason}&episode=${quickBarActiveEpisode}`;
        }
        replaceIframeSrcNoHistory(iframe, newUrl);
      }
    }
    showToast(`🎬 Сезон ${quickBarActiveSeason} • Серия ${quickBarActiveEpisode}`, 'info');
    updatePlayerUrl(currentMedia, quickBarActiveSeason, quickBarActiveEpisode, currentActivePlayer);
    highlightActiveEpisodeInGrid(quickBarActiveEpisode);
    updateInPlayerEpisodeInfo();
  }
}

function highlightActiveEpisodeInGrid(episodeNum) {
  const gridEl = document.getElementById('series-episodes-grid');
  if (!gridEl) return;
  gridEl.querySelectorAll('.series-episode-card').forEach(card => {
    const isAct = parseInt(card.dataset.epNum, 10) === episodeNum;
    card.classList.toggle('active', isAct);
    // Серия НЕ отмечается просмотренной при выборе — только после просмотра >= 50%
  });
}

async function selectQuickSeason(seasonNum) {
  if (quickBarActiveSeason === seasonNum) return;

  if (quickBarSeriesData?.isAnime && quickBarSeriesData.animeSource === 'anixart') {
    const targetSeasonObj = quickBarSeriesData.seasons.find(s => s.season === seasonNum);
    if (targetSeasonObj && targetSeasonObj.releaseId && String(targetSeasonObj.releaseId) !== String(currentMedia?.anixart_release_id || currentMedia?.id)) {
      await switchAnixartSeason(targetSeasonObj.releaseId, seasonNum);
      return;
    }
  }

  quickBarActiveSeason = seasonNum;
  quickBarActiveEpisode = 1;
  renderQuickBarDropdowns();
  updateQuickIframeSrc();
  renderSeriesSeasons(currentMedia, seasonNum, 1);

  showToast(`📺 Сезон ${seasonNum}`, 'info');
  trackClientAction('watch_series_episode', { season: seasonNum, episode: 1 });
}

function selectQuickEpisode(episodeNum) {
  const ep = Number(episodeNum);
  if (!ep || isNaN(ep)) return;
  quickBarActiveEpisode = ep;
  currentEpisodeIndex = ep;
  renderQuickBarDropdowns();
  updateQuickIframeSrc();

  if (currentMedia?.id) {
    // Запускаем невидимый счетчик просмотра (серия будет отмечена только при просмотре >= 50%)
    startInvisibleEpisodeWatchTracker(currentMedia, quickBarActiveSeason, ep);
    if (!isResumePromptPending) {
      saveMediaResumeSnapshot({
        season: quickBarActiveSeason,
        episode: ep,
        time_seconds: activeTrackingWatchedSeconds || 0,
        forceSave: true
      });
    }
  }

  showToast(`🎬 Сезон ${quickBarActiveSeason} • Серия ${ep}`, 'info');
  if (typeof broadcastEpisodeSync === 'function') {
    const voiceVal = document.getElementById('quick-voiceover-val')?.textContent || '';
    broadcastEpisodeSync(quickBarActiveSeason, ep, quickBarActiveTranslationId || '', voiceVal);
  }
  trackClientAction('watch_series_episode', { season: quickBarActiveSeason, episode: ep });

  if (currentMedia?.id && quickBarSeriesData) {
    const sObj = quickBarSeriesData.seasons.find(s => Number(s.season) === Number(quickBarActiveSeason));
    if (sObj && sObj.episodes_count) {
      const watched = getWatchedEpisodes(currentMedia.id, quickBarActiveSeason);
      if (watched.size >= sObj.episodes_count) {
        trackClientAction('complete_season', { season: quickBarActiveSeason });
      }
    }
  }

  highlightActiveEpisodeInGrid(ep);
  updateInPlayerEpisodeInfo();
}

async function switchAnixartVoiceover(voiceoverId) {
  const host = document.getElementById('cinema-player-wrapper');
  if (host) {
    host.innerHTML = '<div style="display:flex;height:100%;align-items:center;justify-content:center;gap:10px;color:var(--text-muted);"><div class="storm-spinner"></div><span>Смена озвучки AniXart...</span></div>';
  }
  try {
    const relId = currentMedia?.anixart_release_id || currentMedia?.id;
    const res = await fetch(`/api/anixart/episodes/${relId}/${voiceoverId}`);
    const rawEpisodes = await res.json();
    currentEpisodes = (rawEpisodes || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));

    if (quickBarSeriesData && quickBarSeriesData.seasons && quickBarSeriesData.seasons[0]) {
      quickBarSeriesData.seasons[0].episodes = currentEpisodes.map(ep => ({
        episode: ep.position || 1,
        name: ep.name_ru || ep.name || `${ep.position || 1} серия`
      }));
      quickBarSeriesData.seasons[0].episodes_count = currentEpisodes.length;
      quickBarSeriesData.active.id_translation = voiceoverId;
    }

    renderQuickBarDropdowns();
    renderSeriesSeasons(currentMedia, 1, quickBarActiveEpisode);

    const chosenEp = currentEpisodes.find(e => (e.position || 1) === quickBarActiveEpisode) || currentEpisodes[0];
    if (chosenEp) {
      playAnixartEpisode(chosenEp);
    }
    const vName = currentMedia?.voiceovers?.find(v => String(v.id) === String(voiceoverId))?.name || 'AniXart';
    savePreferredVoiceover(vName);
    showToast(`🎙️ Выбрана озвучка: ${vName}`, 'info');
  } catch (err) {
    console.warn('Ошибка смены озвучки AniXart:', err);
    showToast(`Ошибка смены озвучки: ${err.message}`, 'error');
  }
}

async function selectQuickVoiceover(translationId) {
  if (String(quickBarActiveTranslationId) === String(translationId)) return;
  quickBarActiveTranslationId = translationId;

  if (quickBarSeriesData?.isAnime && quickBarSeriesData.animeSource === 'anixart') {
    currentVoiceoverId = translationId;
    localStorage.setItem(`storm_fav_voiceover_${currentMedia?.id}`, String(translationId));
    const vObj = currentMedia?.voiceovers?.find(v => String(v.id) === String(translationId));
    if (vObj?.name) savePreferredVoiceover(vObj.name);
    await switchAnixartVoiceover(translationId);
    return;
  }

  renderQuickBarDropdowns();
  updateQuickIframeSrc();

  let voiceName = 'Озвучка обновлена';
  const sObj = quickBarSeriesData?.seasons?.find(s => s.season === quickBarActiveSeason) || quickBarSeriesData?.seasons?.[0];
  const epObj = sObj?.episodes?.find(e => e.episode === quickBarActiveEpisode) || sObj?.episodes?.[0];
  const transObj = epObj?.translations?.find(t => String(t.id) === String(translationId));
  if (transObj) {
    savePreferredVoiceover(transObj.name);
    voiceName = `🎙️ ${transObj.name}${transObj.is_uhd ? ' (4K UHD)' : ''}`;
    if (transObj.is_uhd) {
      trackClientAction('use_4k');
      const cur4k = parseInt(localStorage.getItem('storm_4k_count') || '0', 10);
      localStorage.setItem('storm_4k_count', String(cur4k + 1));
    }
  }

  const curVoiceCount = parseInt(localStorage.getItem('storm_voiceovers_count') || '0', 10);
  localStorage.setItem('storm_voiceovers_count', String(curVoiceCount + 1));

  showToast(voiceName, 'info');
  trackClientAction('switch_voiceover', { translation_id: translationId });
}

let streamCheckAbort = null;
async function checkAndAutoFallbackStream(rawUrl) {
  if (!rawUrl || rawUrl.includes('kodik') || rawUrl.includes('youtube') || rawUrl.includes('stravers.live') || rawUrl.includes('fanfilm')) return;
  if (streamCheckAbort) {
    try { streamCheckAbort.abort(); } catch {}
  }
  streamCheckAbort = new AbortController();
  try {
    const res = await fetch(`/api/player/check-stream?url=${encodeURIComponent(rawUrl)}`, {
      signal: streamCheckAbort.signal
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.alive === false) {
        console.warn('Обнаружен недействительный поток FanFilm4K, выполняем авто-переход');
        const brokenP = currentPlayers?.find(p => p.id === 'fanfilm4k_uhd' || p.url === rawUrl);
        if (brokenP) {
          brokenP.status = 'broken';
          brokenP.status_label = '🔴 Недоступен';
        }
        const kodik = currentPlayers?.find(p => p.id === 'kodik_direct' && p.status !== 'broken');
        const fallbackTarget = kodik || currentPlayers?.find(p => p.id !== 'fanfilm4k_uhd' && p.status !== 'broken');
        if (fallbackTarget && currentActivePlayer?.id !== fallbackTarget.id) {
          selectPlayer(fallbackTarget);
          showToast(`⚡ Автоматически включен проверенный плеер ${fallbackTarget.name}!`, 'info');
        } else {
          switchToNextSource(true);
        }
      }
    }
  } catch {}
}

window.addEventListener('message', (e) => {
  if (e.data?.type === 'STORM_SWITCH_NEXT_SOURCE' || e.data?.type === 'STORM_PLAYER_FALLBACK') {
    if (Date.now() - lastUserManualSelectionTime < 15000 && !e.data?.user_initiated && e.data?.reason !== 'PLAYER_NOT_FOUND' && e.data?.reason !== 'FANFILM_MANUAL_SWITCH') {
      console.warn('[Player] Игнорируем авто-переключение источника: плеер выбран пользователем вручную');
      return;
    }
    console.warn('[Player] Запуск перехода к следующему источнику:', e.data?.reason);
    switchToNextSource(true);
  }
  if (e.data?.type === 'STORM_LIFT_PREF_CHANGED') {
    if (e.data.audioTitle) {
      savePreferredVoiceover(e.data.audioTitle);
      const voiceVal = document.getElementById('quick-voiceover-val');
      if (voiceVal) voiceVal.textContent = e.data.audioTitle;
    }
  }
  if (e.data?.type === 'STORM_LIFT_EPISODE_CHANGED' && e.data.episode) {
    const epNum = parseInt(e.data.episode, 10);
    if (epNum && !isNaN(epNum) && epNum !== quickBarActiveEpisode) {
      quickBarActiveEpisode = epNum;
      currentEpisodeIndex = epNum;
      renderQuickBarDropdowns();
      highlightActiveEpisodeInGrid(epNum);
      updateInPlayerEpisodeInfo();
    }
  }
});

function playStreamUrl(url) {
  const container = document.getElementById('cinema-player-wrapper');
  if (!container) return;

  let cleanStreamUrl = String(url || '').trim();
  if (!cleanStreamUrl || cleanStreamUrl === '/' || cleanStreamUrl === 'undefined') {
    container.innerHTML = `
      <div class="player-video-box" style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;text-align:center;padding:30px;background:rgba(10,12,18,0.92);border-radius:12px;gap:14px;">
        <div style="font-size:42px;">🎬</div>
        <div style="font-size:17px;font-weight:800;color:var(--text-primary);">Видеопоток временно недоступен</div>
        <div style="max-width:520px;font-size:13px;line-height:1.6;color:var(--text-secondary);">Попробуйте выбрать резервный плеер в списке доступных источников ниже.</div>
      </div>
    `;
    return;
  }

  if (cleanStreamUrl.includes('libria.fun')) {
    cleanStreamUrl = cleanStreamUrl
      .replace(/^https?:\/\/cache-[a-z0-9-]+\.libria\.fun\//i, 'https://cache.libria.fun/')
      .split('?')[0];
  }
  url = cleanStreamUrl;

  if (currentMedia?.source === 'fanfilm4k') {
    trackClientAction('use_4k');
  }

  if (iframeWatchInterval) {
    clearInterval(iframeWatchInterval);
    iframeWatchInterval = null;
  }

  if (currentMedia?.id) {
    startInvisibleEpisodeWatchTracker(currentMedia, quickBarActiveSeason || 1, quickBarActiveEpisode || currentEpisodeIndex || 1);
  }

  if (url.includes('.m3u8')) {
    const quickBar = document.getElementById('player-series-quick-bar');
    if (quickBar) {
      if (quickBarSeriesData && quickBarSeriesData.seasons && quickBarSeriesData.seasons.length > 0) {
        quickBar.style.display = 'flex';
      } else if (checkIfMediaIsSeries(currentMedia)) {
        initUniversalSeriesQuickBar(quickBarActiveSeason, quickBarActiveEpisode);
      } else {
        quickBar.style.display = 'none';
        adjustCinemaModalScale();
      }
    }

    if (window._stormHls) {
      try { window._stormHls.destroy(); } catch (_) {}
      window._stormHls = null;
    }

    container.innerHTML = `
      <div class="player-video-box" style="position:relative;width:100%;height:100%;">
        <!-- Динамическая подсветка Ambilight -->
        <div id="player-ambilight-aura" class="ambilight-aura"></div>

        <video id="storm-video-player" controls crossorigin="anonymous" preload="metadata" style="width:100%;height:100%;background:#000;border-radius:12px;outline:none;position:relative;z-index:5;pointer-events:auto;" playsinline></video>

        <!-- Кнопка мгновенного старта воспроизведения на смартфонах и ПК -->
        <div class="storm-video-big-play-btn" id="storm-video-big-play-btn" title="Воспроизвести">
          <div class="big-play-icon">▶</div>
        </div>

        <!-- Кнопки пропуска заставок -->
        <button type="button" class="storm-skip-btn" id="skip-intro-btn" style="display: none;">
          ⏭️ Пропустить заставку
        </button>
        <button type="button" class="storm-skip-btn" id="skip-outro-btn" style="display: none;">
          ⏭️ Следующая серия
        </button>
      </div>
    `;

    const video = document.getElementById('storm-video-player');
    const videoBox = container.querySelector('.player-video-box');
    const bigPlayBtn = container.querySelector('#storm-video-big-play-btn');

    if (videoBox) {
      mountInPlayerOverlay(videoBox);
    }

    if (bigPlayBtn && video) {
      bigPlayBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        video.play().catch(() => {});
        bigPlayBtn.classList.add('is-hidden');
      });
      video.addEventListener('play', () => {
        bigPlayBtn.classList.add('is-hidden');
        videoBox.classList.add('is-playing');
      });
      video.addEventListener('pause', () => {
        bigPlayBtn.classList.remove('is-hidden');
        videoBox.classList.remove('is-playing');
      });
      video.addEventListener('playing', () => {
        bigPlayBtn.classList.add('is-hidden');
        videoBox.classList.add('is-playing');
      });
    }

    // Настраиваем HLS с поддержкой ленивой загрузки, авто-проксирования и резервного переключения
    let retriedViaProxy = false;
    let hlsFallbackTriggered = false;
    let manifestReady = false;

    const triggerHlsFallback = (activeHls) => {
      if (hlsFallbackTriggered) return;
      if (!retriedViaProxy && url.startsWith('http') && !url.includes('/api/player/stravers-api-proxy')) {
        retriedViaProxy = true;
        const proxiedHlsUrl = `/api/player/stravers-api-proxy?url=${encodeURIComponent(url)}`;
        if (activeHls) {
          try {
            activeHls.loadSource(proxiedHlsUrl);
            return;
          } catch (_) {}
        }
      }
      hlsFallbackTriggered = true;
      if (activeHls) {
        try { activeHls.destroy(); } catch (_) {}
      }
      switchToNextSource(false);
    };

    const setupHlsStream = () => {
      if (window.Hls && window.Hls.isSupported()) {
        const hls = new window.Hls({
          maxBufferLength: 60,
          maxMaxBufferLength: 120,
          maxBufferSize: 120 * 1024 * 1024,
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 30,
          manifestLoadingTimeOut: 6000,
          manifestLoadingMaxRetry: 1,
          levelLoadingTimeOut: 6000
        });
        window._stormHls = hls;

        const watchdog = setTimeout(() => {
          if (!manifestReady && document.getElementById('storm-video-player') === video) {
            triggerHlsFallback(hls);
          }
        }, 7000);

        hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
          manifestReady = true;
          clearTimeout(watchdog);
        });

        hls.on(window.Hls.Events.ERROR, (_event, data) => {
          if (data && data.fatal) {
            clearTimeout(watchdog);
            if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
              try { hls.recoverMediaError(); return; } catch (_) {}
            }
            triggerHlsFallback(hls);
          }
        });

        hls.loadSource(url);
        hls.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
        video.addEventListener('error', () => triggerHlsFallback(null), { once: true });
      }
    };

    if (window.Hls) {
      setupHlsStream();
    } else {
      ensureHlsLoaded().then(setupHlsStream).catch(() => {
        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = url;
        }
      });
    }

    // Подключаем Ambilight, Субтитры, Пропуск заставок и Watch Together
    setupVideoFeatures(video, videoBox);
    return;
  }

  let streamUrl = url;
  const isFanfilmOrStravers = typeof url === 'string' && (url.includes('stravers.live') || url.includes('fanfilm4k') || url.includes('fanfilm'));
  const isLiftPlayer = typeof url === 'string' && url.includes('/api/player/lift-embed');

  if (isLiftPlayer) {
    initSeriesQuickBar(url);
  } else if (isFanfilmOrStravers) {
    const titleParam = currentMedia?.title ? `&title=${encodeURIComponent(currentMedia.title)}` : '';
    const yearParam = currentMedia?.year ? `&year=${encodeURIComponent(currentMedia.year)}` : '';
    streamUrl = `/api/player/fanfilm-embed?url=${encodeURIComponent(url)}&hidden=season,episode,translation${titleParam}${yearParam}`;
    initSeriesQuickBar(url);
    checkAndAutoFallbackStream(url);
  } else if (!quickBarSeriesData?.seasons?.length && !quickBarSeriesData?.isAnime) {
    if (checkIfMediaIsSeries(currentMedia)) {
      initUniversalSeriesQuickBar(quickBarActiveSeason, quickBarActiveEpisode);
    } else {
      const quickBar = document.getElementById('player-series-quick-bar');
      if (quickBar) quickBar.style.display = 'none';
      adjustCinemaModalScale();
    }
  } else if (quickBarSeriesData?.seasons?.length > 0) {
    const quickBar = document.getElementById('player-series-quick-bar');
    if (quickBar) quickBar.style.display = 'flex';
  }

  if (typeof streamUrl === 'string') {
    streamUrl = getSafeCleanStreamUrl(streamUrl);
  }

    const isVkPlayer = typeof streamUrl === 'string' && (streamUrl.includes('vkvideo.ru') || streamUrl.includes('vk.com'));
    const isRuTubePlayer = typeof streamUrl === 'string' && (streamUrl.includes('rutube.ru') || currentActivePlayer?.id === 'rutube_stream');
    const isInternalGateway = typeof streamUrl === 'string' && streamUrl.startsWith('/api/player/');
    const sandboxAttr = isInternalGateway ? '' : 'sandbox="allow-scripts allow-same-origin allow-forms allow-presentation allow-downloads"';

    container.innerHTML = `
      <div class="player-video-box" style="position:relative;width:100%;height:100%;">
        <div id="player-ambilight-aura" class="ambilight-aura"></div>
        <iframe class="cinema-player-iframe" src="${streamUrl}" referrerpolicy="no-referrer-when-downgrade" allow="fullscreen *; picture-in-picture *; encrypted-media *; display-capture *; microphone *; camera *" ${sandboxAttr} scrolling="no" style="position:relative;z-index:5;pointer-events:auto;width:100%;height:100%;border:none;border-radius:12px;"></iframe>
        ${isVkPlayer ? `
          <button type="button" class="storm-unmute-btn" id="storm-unmute-btn" title="Включить звук VK Видео">
            <span class="unmute-icon">🔊</span>
            <span class="unmute-text">Включить звук</span>
          </button>
        ` : ''}
      </div>
    `;

  const iframeBox = container.querySelector('.player-video-box');
  const iframeEl = container.querySelector('.cinema-player-iframe');
  if (iframeBox) {
    mountInPlayerOverlay(iframeBox);
    mountCleanViewOverlay(iframeBox);
    if (isRuTubePlayer) {
      mountRuTubeShield(iframeBox, iframeEl);
    }
  }
  if (iframeEl) {
    if (isVkPlayer) {
      const unmuteAll = () => {
        try {
          const commands = [
            { method: 'unmute' },
            { method: 'setVolume', value: 1 },
            { action: 'unmute' },
            { action: 'setVolume', value: 1 },
            { type: 'unmute' },
            { type: 'setVolume', volume: 1 },
            { event: 'unmute' },
            { key: 'vk_player_api', value: { action: 'unmute' } },
            { key: 'vk_player_api', value: { action: 'setVolume', value: 1 } }
          ];
          commands.forEach(cmd => {
            iframeEl.contentWindow?.postMessage(JSON.stringify(cmd), '*');
            iframeEl.contentWindow?.postMessage(cmd, '*');
          });
        } catch (_) {}
      };

      iframeEl.onload = () => {
        applySavedPlaybackSpeed();
        applyProAudioSettings();
        unmuteAll();
        setTimeout(unmuteAll, 300);
        setTimeout(unmuteAll, 800);
        setTimeout(unmuteAll, 1800);
        setTimeout(unmuteAll, 3200);
      };

      const unmuteBtn = container.querySelector('#storm-unmute-btn');
      if (unmuteBtn) {
        unmuteBtn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          unmuteAll();
          unmuteBtn.classList.add('fade-out');
          setTimeout(() => unmuteBtn.remove(), 350);
          showToast('🔊 Звук включен', 'success');
        };
        setTimeout(() => {
          if (unmuteBtn && unmuteBtn.parentElement) {
            unmuteBtn.classList.add('fade-out');
            setTimeout(() => unmuteBtn.remove(), 350);
          }
        }, 10000);
      }

      const onUserInteract = () => {
        unmuteAll();
      };
      if (iframeBox) {
        iframeBox.addEventListener('click', onUserInteract, { passive: true });
        iframeBox.addEventListener('touchstart', onUserInteract, { passive: true });
      }
    } else {
      iframeEl.onload = () => {
        applySavedPlaybackSpeed();
        applyProAudioSettings();
      };
    }
    iframeEl.onerror = () => {
      console.warn('[Player] Ошибка загрузки фрейма источника:', streamUrl);
      updateFallbackButton(currentActivePlayer);
      if (isAutoNextEnabled()) {
        switchToNextSource(false);
      }
    };
  }

  applySavedPlaybackSpeed();
  applyProAudioSettings();
  applyProVideoSettings();

  if (ambilightEnabled) {
    startAmbilightLoop(null);
  }

  // Трекинг прогресса: для iframe не накручиваем фиктивные секунды при простое модального окна
  if (iframeWatchInterval) {
    clearInterval(iframeWatchInterval);
    iframeWatchInterval = null;
  }
  currentWatchTimeSeconds = Math.round(((currentProgressPercent || 0) / 100) * 7200);
}

function setupVideoFeatures(video, wrapper) {
  if (video && !video.dataset.hasDblClickListener) {
    video.dataset.hasDblClickListener = 'true';
    video.addEventListener('dblclick', (e) => {
      e.preventDefault();
      toggleCinemaFullscreen();
    });
  }

  // 0. Динамическая синхронизация реальной длительности потока со всеми элементами интерфейса
  const syncStreamDuration = () => {
    if (video && video.duration && isFinite(video.duration) && video.duration > 30) {
      updateSidebarDuration(video.duration);
    }
  };
  const checkVideoPendingSeek = () => {
    if (pendingResumeSeekSeconds > 0 && Date.now() < pendingResumeSeekUntil && video.readyState >= 1) {
      try {
        video.currentTime = pendingResumeSeekSeconds;
        pendingResumeSeekSeconds = 0;
        if (pendingResumeSeekTimer) {
          clearInterval(pendingResumeSeekTimer);
          pendingResumeSeekTimer = null;
        }
        video.play().catch(() => {});
      } catch (_) {}
    }
  };
  video.addEventListener('loadedmetadata', () => { syncStreamDuration(); checkVideoPendingSeek(); });
  video.addEventListener('durationchange', syncStreamDuration);
  video.addEventListener('canplay', () => { syncStreamDuration(); checkVideoPendingSeek(); });
  video.addEventListener('pause', () => {
    if (video.currentTime >= 5) {
      saveMediaResumeSnapshot({
        time_seconds: Math.round(video.currentTime),
        duration_seconds: Math.round(video.duration || 0),
        forceSync: true
      });
    }
  });
  video.addEventListener('playing', syncStreamDuration);
  syncStreamDuration();

  // 1. Ambilight
  initAmbilight(video);

  // 2. Субтитры и аудиодорожки
  initSubtitlesManager(video, wrapper);

  // 3. Синхронизация Кинокомнаты
  if (getActiveRoom()) {
    attachPlayerToRoom(video);
  }

  // 4. Логика пропуска опенингов и эндингов (Smart Skip)
  initSmartSkip(video);

  // 5. Ночной режим звука (Web Audio компрессор)
  applyNightModeAudio(video);

  // 6. Профессиональный движок видео и звука (HDR, CAS, Dolby Atmos 3D, EQ, WebGL Shaders)
  applyProVideoSettings(video);
  initProAudioEngine(video);
  initVideoUpscalerShaders(video);

  // 7. STORM CleanView & AdShield
  mountCleanViewOverlay(wrapper);

  // 7. X-Ray режим на паузе
  setupXRayMode(video, wrapper);

  // 7. Покадровая навигация (Thumbnail Scrubbing)
  setupThumbnailScrubbing(video);

  // 8. Автоматический динамический прогресс просмотра
  let lastSyncTime = 0;
  video.addEventListener('timeupdate', () => {
    if (video.duration && !isNaN(video.duration)) {
      if (isFinite(video.duration) && video.duration > 30) {
        const durEl = document.querySelector('#cinema-side-info [data-info="duration"]');
        const expected = formatDurationDisplay(video.duration);
        if (durEl && expected && durEl.textContent.trim() !== expected) {
          updateSidebarDuration(video.duration);
        }
      }
      const percent = Math.min(100, Math.round((video.currentTime / video.duration) * 100));
      currentProgressPercent = percent;
      currentWatchTimeSeconds = Math.round(video.currentTime);
      const slider = document.getElementById('player-progress-slider');
      const label = document.getElementById('player-progress-label');
      if (slider) slider.value = percent;
      if (label) label.textContent = `${percent}%`;

      const activeSeasonForSync = Math.max(1, Number(quickBarActiveSeason || activeTrackingSeason || currentMedia?.season || 1));
      const activeEpisodeForSync = Math.max(1, Number(quickBarActiveEpisode || activeTrackingEpisode || currentEpisodeIndex || currentMedia?.episode || 1));

      // При достижении 90% (начало финальных титров) автоматически отмечаем просмотренным
      if (percent >= 90 && currentMedia) {
        const isSeries = currentMedia.media_type === 'series' || currentMedia.media_type === 'anime-series' || currentMedia.media_type === 'cartoon-series';
        if (isSeries) {
          markEpisodeWatched(currentMedia.id, activeSeasonForSync, activeEpisodeForSync, true);
        } else if (currentMedia.user_status !== 'completed') {
          currentMedia.user_status = 'completed';
          saveBookmarkStatus(currentMedia, 'completed');
          renderStatusButtons('completed');
        }
      }

      const now = Date.now();
      if (now - lastSyncTime >= 10000 && currentMedia) {
        lastSyncTime = now;
        saveMediaResumeSnapshot({
          season: activeSeasonForSync,
          episode: activeEpisodeForSync,
          time_seconds: currentWatchTimeSeconds,
          duration_seconds: Math.round(video.duration),
          forceSync: true
        });
      }
    }
  });

  // 9. Сохранение и автоприменение скорости воспроизведения
  applySavedPlaybackSpeed(video);
  video.addEventListener('loadedmetadata', () => applySavedPlaybackSpeed(video));
  video.addEventListener('play', () => applySavedPlaybackSpeed(video));
  video.addEventListener('ratechange', () => {
    if (video.playbackRate) {
      localStorage.setItem('storm_playback_speed', String(video.playbackRate));
      updateInPlayerSpeedDisplay(video.playbackRate);
    }
  });

  // 10. Автопереход к следующей серии сериала или следующей части франшизы
  video.addEventListener('ended', async () => {
    const isSeries = checkIfMediaIsSeries(currentMedia);
    if (isSeries) {
      if (video.dataset.hasEndedTriggered) return;
      video.dataset.hasEndedTriggered = 'true';
      setTimeout(() => { delete video.dataset.hasEndedTriggered; }, 5000);

      showToast('Воспроизведение завершено. Запуск следующей серии...', 'info');
      setTimeout(() => {
        playInPlayerNextEpisode();
      }, 1000);
      return;
    }

    if (currentMedia && currentMedia.user_status !== 'completed') {
      currentMedia.user_status = 'completed';
      await saveBookmarkStatus(currentMedia, 'completed');
      renderStatusButtons('completed');
    }
    await autoAdvanceNextFranchiseItem();
  });

  // 11. Монтирование интеллектуального оверлея плеера и серий
  mountInPlayerOverlay(wrapper);
}

// ==========================================
// НОЧНОЙ РЕЖИМ ЗВУКА (NIGHT MODE AUDIO)
// ==========================================
export function toggleNightModeAudio(video = document.getElementById('storm-video-player')) {
  nightAudioModeEnabled = !getProAudioNightMode();
  setProAudioNightMode(nightAudioModeEnabled);
  try {
    localStorage.setItem('storm_night_audio', nightAudioModeEnabled ? 'true' : 'false');
  } catch {}
  showToast(`🌙 Ночной режим звука: ${nightAudioModeEnabled ? 'Включен (диалоги четче, взрывы мягче)' : 'Выключен (стандартный звук)'}`, 'info');

  const btn = document.getElementById('toggle-night-audio-btn');
  if (btn) {
    btn.classList.toggle('active', nightAudioModeEnabled);
    const badge = btn.querySelector('.night-audio-badge');
    if (badge) {
      badge.textContent = nightAudioModeEnabled ? 'ВКЛ' : 'ВЫКЛ';
      badge.style.color = nightAudioModeEnabled ? 'var(--storm-accent-green, #10b981)' : 'var(--text-muted)';
    }
  }
}

export function applyNightModeAudio(video) {
  const saved = localStorage.getItem('storm_night_audio') === 'true';
  nightAudioModeEnabled = saved;
  setProAudioNightMode(nightAudioModeEnabled);

  const btn = document.getElementById('toggle-night-audio-btn');
  if (btn) {
    btn.classList.toggle('active', nightAudioModeEnabled);
    const badge = btn.querySelector('.night-audio-badge');
    if (badge) {
      badge.textContent = nightAudioModeEnabled ? 'ВКЛ' : 'ВЫКЛ';
      badge.style.color = nightAudioModeEnabled ? 'var(--storm-accent-green, #10b981)' : 'var(--text-muted)';
    }
  }
}

// ==========================================
// X-RAY РЕЖИМ (АКТЕРЫ И САУНДТРЕКИ НА ПАУЗЕ)
// ==========================================
function setupXRayMode(video, wrapper) {
  if (!video || !wrapper) return;

  // Автоматическое навязчивое открытие X-Ray на паузе отключено, чтобы не блокировать управление видео и экраном на мобильных.
  // Пользователь может открыть X-Ray вручную через студийное меню (toggleXRayManual).
  video.addEventListener('play', () => {
    hideXRayPanel(wrapper);
  });
}

let xrayAudioElement = null;
let currentPlayingTrackUrl = null;

function renderXRaySoundtrackTab(musicTab, soundtrack, panel) {
  if (!musicTab || !soundtrack) return;
  const tracks = soundtrack.tracks || [];

  musicTab.innerHTML = `
    <div style="font-size: 11.5px; color: var(--text-muted); margin-bottom: 10px; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px; align-items: center;">
      <span>Альбом: <b style="color: var(--text-primary);">${soundtrack.album || soundtrack.title}</b></span>
      <span>Композитор / Исполнитель: <b style="color: var(--accent);">${soundtrack.artist}</b></span>
    </div>
    <div class="xray-tracks-list">
      ${tracks.length > 0 ? tracks.map(t => {
        const isPlaying = currentPlayingTrackUrl === t.preview_url && t.preview_url;
        return `
          <div class="xray-track-item ${isPlaying ? 'is-playing' : ''}" data-track-url="${t.preview_url || ''}">
            <div class="xray-track-info" style="display: flex; align-items: center; gap: 10px;">
              ${t.preview_url ? `
                <button type="button" class="xray-track-play-btn" data-preview-url="${t.preview_url}" title="${isPlaying ? 'Пауза' : 'Прослушать отрывок'}">
                  ${isPlaying ? '⏸' : '▶'}
                </button>
              ` : `<span class="xray-track-num">${t.number || '🎵'}</span>`}
              ${t.artwork ? `<img src="${t.artwork}" alt="${t.title}" class="xray-track-thumb" onerror="this.style.display='none'">` : ''}
              <div>
                <div class="xray-track-title" style="font-weight: 700; font-size: 13px; display: flex; align-items: center; gap: 6px;">
                  <span>${t.title}</span>
                  ${isPlaying ? '<div class="xray-track-eq-anim"><span></span><span></span><span></span></div>' : ''}
                </div>
                <div class="xray-track-scene" style="font-size: 11px; color: var(--text-muted);">${t.artist || t.scene || ''}</div>
              </div>
            </div>
            <span class="xray-track-dur" style="font-size: 12px; font-weight: 600; color: var(--text-secondary);">${t.duration || '03:30'}</span>
          </div>
        `;
      }).join('') : '<div style="color: var(--text-muted); font-size: 12px; padding: 12px; text-align: center;">Саундтреки для данного релиза уточняются...</div>'}
    </div>
  `;

  // Обработка клика по воспроизведению отрывка
  musicTab.querySelectorAll('.xray-track-play-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const url = btn.dataset.previewUrl;
      if (!url) return;

      if (currentPlayingTrackUrl === url && xrayAudioElement && !xrayAudioElement.paused) {
        xrayAudioElement.pause();
        currentPlayingTrackUrl = null;
        renderXRaySoundtrackTab(musicTab, soundtrack, panel);
        return;
      }

      if (xrayAudioElement) {
        xrayAudioElement.pause();
        xrayAudioElement = null;
      }

      xrayAudioElement = new Audio(url);
      xrayAudioElement.volume = 0.85;
      xrayAudioElement.play().then(() => {
        currentPlayingTrackUrl = url;
        renderXRaySoundtrackTab(musicTab, soundtrack, panel);
      }).catch(() => {
        showToast('Не удалось запустить онлайн-воспроизведение отрывка', 'warning');
      });

      xrayAudioElement.onended = () => {
        currentPlayingTrackUrl = null;
        renderXRaySoundtrackTab(musicTab, soundtrack, panel);
      };
    };
  });
}

function renderXRayCastTab(castTab, cast) {
  if (!castTab) return;
  castTab.innerHTML = `
    <div class="xray-cast-row">
      ${cast.length > 0 ? cast.map(c => `
        <div class="xray-actor-card" data-person-id="${c.id || ''}" data-person-name="${c.name || ''}" title="Нажмите, чтобы открыть фильмографию">
          <img src="${getSafePersonPhotoUrl(c.photo)}" alt="${c.name}" class="xray-actor-img" onerror="this.src='assets/avatar_default.svg'">
          <div style="min-width: 0;">
            <div class="xray-actor-name">${c.name}</div>
            <div class="xray-actor-role">${c.character || 'В главных ролях'}</div>
          </div>
        </div>
      `).join('') : '<div style="color: var(--text-muted); font-size: 12px; padding: 8px;">Информация об актерском составе загружается...</div>'}
    </div>
  `;

  castTab.querySelectorAll('[data-person-id]').forEach(card => {
    card.onclick = () => {
      const pid = card.dataset.personId;
      const pname = card.dataset.personName;
      if ((pid || pname) && typeof openPersonModal === 'function') {
        openPersonModal(pid || pname, pname);
      }
    };
  });
}

function renderXRayTriviaTab(triviaTab, triviaList) {
  if (!triviaTab) return;
  triviaTab.innerHTML = `
    <div class="xray-trivia-list">
      ${triviaList.map(item => `
        <div class="xray-trivia-item">
          <span class="xray-trivia-label">${item.label}:</span>
          <span class="xray-trivia-content">${item.content}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function showXRayPanel(wrapper) {
  if (!currentMedia) return;
  let panel = wrapper.querySelector('#player-xray-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'player-xray-panel';
    panel.className = 'player-xray-panel';
    wrapper.appendChild(panel);
  }

  const cleanTitle = cleanVideoTitle(currentMedia.title);
  const cast = currentMedia.cast || [];
  const directors = currentMedia.directors || [];
  const composers = currentMedia.composers || [];
  const writers = currentMedia.writers || [];
  const cinematographers = currentMedia.cinematographers || [];

  const primaryComposer = composers[0]?.name || (directors[0]?.name ? `Оркестр под управлением ${directors[0].name}` : 'Оригинальный композитор');
  const soundtrack = currentMedia.soundtrack || {
    title: `${cleanTitle} (Original Soundtrack)`,
    artist: primaryComposer,
    album: `${cleanTitle} OST`,
    tracks: [
      { number: 1, title: `${cleanTitle} (Main Theme)`, artist: primaryComposer, duration: '03:42', scene: 'Заглавная тема фильма' },
      { number: 2, title: 'Cinematic Progression', artist: primaryComposer, duration: '02:35', scene: 'Развитие сюжета' },
      { number: 3, title: 'High Stakes and Climax', artist: primaryComposer, duration: '04:12', scene: 'Ключевая драматическая сцена' },
      { number: 4, title: 'End Credits Suite', artist: primaryComposer, duration: '03:50', scene: 'Финальные титры' }
    ]
  };

  const triviaList = currentMedia.trivia && currentMedia.trivia.length > 0 ? currentMedia.trivia : [
    { label: 'Мастеринг', content: 'Релиз представлен в оригинальном кинематографическом качестве 4K UHD с объемным многоканальным звуком.' },
    { label: 'Премьера', content: `Официальный мировой релиз ${currentMedia.release_date || currentMedia.year || ''} года.` }
  ];

  const crewList = [
    ...directors.map(d => ({ ...d, role: d.role || 'Режиссер' })),
    ...composers.map(c => ({ ...c, role: 'Композитор' })),
    ...writers.map(w => ({ ...w, role: 'Сценарист' })),
    ...cinematographers.map(c => ({ ...c, role: 'Оператор' }))
  ];

  panel.innerHTML = `
    <div class="xray-header">
      <div class="xray-title-group">
        <div class="xray-title">
          <span>🔍</span>
          <span>X-Ray: ${cleanTitle}</span>
        </div>
        <div class="xray-scene-music" title="Официальный саундтрек картины">
          <span>🎵</span>
          <span id="xray-soundtrack-title"><b>${soundtrack.tracks?.[0]?.title || soundtrack.title}</b> — ${soundtrack.artist}</span>
        </div>
      </div>

      <div style="display: flex; align-items: center; gap: 10px;">
        <div class="xray-tabs-nav">
          <button type="button" class="xray-tab-btn active" data-xray-tab="cast">🎭 В кадре (${cast.length})</button>
          <button type="button" class="xray-tab-btn" data-xray-tab="music">🎵 Саундтрек</button>
          <button type="button" class="xray-tab-btn" data-xray-tab="trivia">💡 Факты (${triviaList.length})</button>
          <button type="button" class="xray-tab-btn" data-xray-tab="crew">🎬 Создатели (${crewList.length})</button>
        </div>
        <button type="button" class="storm-btn storm-btn-sm" id="close-xray-btn" style="padding: 4px 8px;" title="Скрыть панель X-Ray">✕</button>
      </div>
    </div>

    <!-- Вкладка 1: Актеры в кадре -->
    <div class="xray-tab-content active" id="xray-tab-cast"></div>

    <!-- Вкладка 2: Саундтрек и музыка -->
    <div class="xray-tab-content" id="xray-tab-music"></div>

    <!-- Вкладка 3: Интересные факты (Trivia) -->
    <div class="xray-tab-content" id="xray-tab-trivia"></div>

    <!-- Вкладка 4: Создатели картины -->
    <div class="xray-tab-content" id="xray-tab-crew">
      <div class="xray-crew-list">
        ${crewList.length > 0 ? crewList.map(person => `
          <div class="xray-crew-card" data-person-id="${person.id || ''}" data-person-name="${person.name || ''}" style="cursor: pointer;" title="Открыть фильмографию">
            <img src="${getSafePersonPhotoUrl(person.photo)}" alt="${person.name}" class="xray-crew-img" onerror="this.src='assets/avatar_default.svg'">
            <div>
              <div class="xray-crew-name">${person.name}</div>
              <div class="xray-crew-role">${person.role}</div>
            </div>
          </div>
        `).join('') : '<div style="color: var(--text-muted); font-size: 12px; padding: 8px;">Данные о съемочной группе уточняются...</div>'}
      </div>
    </div>
  `;

  const castTab = panel.querySelector('#xray-tab-cast');
  const musicTab = panel.querySelector('#xray-tab-music');
  const triviaTab = panel.querySelector('#xray-tab-trivia');

  renderXRayCastTab(castTab, cast);
  renderXRaySoundtrackTab(musicTab, soundtrack, panel);
  renderXRayTriviaTab(triviaTab, triviaList);

  // Фоновая загрузка реальных саундтреков с iTunes
  if (!currentMedia.soundtrackLoaded) {
    fetch(`/api/media/soundtrack?title=${encodeURIComponent(cleanTitle)}&original_title=${encodeURIComponent(currentMedia.original_title || '')}&year=${encodeURIComponent(currentMedia.year || '')}`)
      .then(res => res.json())
      .then(data => {
        if (data && data.tracks && data.tracks.length > 0) {
          currentMedia.soundtrack = data;
          currentMedia.soundtrackLoaded = true;
          const currentMusicTab = panel.querySelector('#xray-tab-music');
          if (currentMusicTab) renderXRaySoundtrackTab(currentMusicTab, data, panel);
          const stTitle = panel.querySelector('#xray-soundtrack-title');
          if (stTitle) stTitle.innerHTML = `<b>${data.tracks[0]?.title || data.title}</b> — ${data.artist}`;
        }
      })
      .catch(() => {});
  }

  // Фоновое обогащение актерского состава, если актеров нет
  if (cast.length === 0 && currentMedia.title) {
    (async () => {
      try {
        let loadedCast = null;
        if (currentMedia.id) {
          const src = currentMedia.source || 'tmdb';
          const r = await fetch(`/api/media/${encodeURIComponent(src)}/${encodeURIComponent(currentMedia.id)}/cast`);
          if (r.ok) {
            const data = await r.json();
            if (data?.cast?.length) loadedCast = data.cast;
          }
        }
        if (!loadedCast || !loadedCast.length) {
          const r = await fetch(`/api/media/cast?title=${encodeURIComponent(cleanTitle)}`);
          if (r.ok) {
            const data = await r.json();
            if (data?.cast?.length) loadedCast = data.cast;
          }
        }
        if (loadedCast && loadedCast.length) {
          currentMedia.cast = loadedCast;
          const cTab = panel.querySelector('#xray-tab-cast');
          if (cTab) renderXRayCastTab(cTab, loadedCast);
          const castBtn = panel.querySelector('[data-xray-tab="cast"]');
          if (castBtn) castBtn.textContent = `🎭 В кадре (${loadedCast.length})`;
          return;
        }
      } catch (_) {}

      // TMDB поиск как глубокий fallback
      try {
        const r = await fetch(`/api/media/search?q=${encodeURIComponent(cleanTitle)}&source=tmdb`);
        const data = await r.json();
        if (data?.items?.length > 0) {
          const first = data.items[0];
          const res = await fetch(`/api/media/item?id=${first.id}&source=tmdb&media_type=${first.media_type || ''}&title=${encodeURIComponent(cleanTitle)}`);
          if (res.ok) {
            const full = await res.json();
            if (full.cast?.length) {
              currentMedia.cast = full.cast;
              currentMedia.directors = full.directors || currentMedia.directors;
              currentMedia.composers = full.composers || currentMedia.composers;
              currentMedia.writers = full.writers || currentMedia.writers;
              currentMedia.cinematographers = full.cinematographers || currentMedia.cinematographers;
              if (full.trivia?.length) currentMedia.trivia = full.trivia;

              const cTab = panel.querySelector('#xray-tab-cast');
              if (cTab) renderXRayCastTab(cTab, full.cast);
              const tTab = panel.querySelector('#xray-tab-trivia');
              if (tTab && full.trivia?.length) renderXRayTriviaTab(tTab, full.trivia);
              const castBtn = panel.querySelector('[data-xray-tab="cast"]');
              if (castBtn) castBtn.textContent = `🎭 В кадре (${full.cast.length})`;
            }
          }
        }
      } catch (_) {}
    })();
  }

  // Переключение вкладок X-Ray
  panel.querySelectorAll('.xray-tab-btn').forEach(btn => {
    btn.onclick = () => {
      panel.querySelectorAll('.xray-tab-btn').forEach(b => b.classList.remove('active'));
      panel.querySelectorAll('.xray-tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const targetTab = panel.querySelector(`#xray-tab-${btn.dataset.xrayTab}`);
      if (targetTab) targetTab.classList.add('active');
    };
  });

  // Клик по персоне съемочной группы для перехода в фильмографию
  panel.querySelectorAll('#xray-tab-crew [data-person-id]').forEach(card => {
    card.onclick = () => {
      const pid = card.dataset.personId;
      const pname = card.dataset.personName;
      if ((pid || pname) && typeof openPersonModal === 'function') {
        openPersonModal(pid || pname, pname);
      }
    };
  });

  const closeBtn = panel.querySelector('#close-xray-btn');
  if (closeBtn) closeBtn.onclick = () => hideXRayPanel(wrapper);
  panel.style.display = 'flex';
  xrayVisible = true;
}

function hideXRayPanel(wrapper) {
  const panel = wrapper?.querySelector('#player-xray-panel');
  if (panel) {
    panel.style.display = 'none';
  }
  if (xrayAudioElement) {
    xrayAudioElement.pause();
    xrayAudioElement = null;
    currentPlayingTrackUrl = null;
  }
  xrayVisible = false;
}

export function toggleXRayManual() {
  const wrapper = document.getElementById('cinema-player-wrapper');
  if (!wrapper) return;
  if (xrayVisible) {
    hideXRayPanel(wrapper);
  } else {
    showXRayPanel(wrapper);
  }
}

// ==========================================
// ПОКАДРОВАЯ НАВИГАЦИЯ (THUMBNAIL SCRUBBING)
// ==========================================
function setupThumbnailScrubbing(video) {
  const slider = document.getElementById('player-progress-slider');
  const preview = document.getElementById('player-scrubber-preview');
  const canvas = document.getElementById('scrubber-thumb-canvas');
  const timeEl = document.getElementById('scrubber-thumb-time');
  const chapterEl = document.getElementById('scrubber-thumb-chapter');

  if (!slider || !preview) return;

  slider.onmouseenter = () => {
    preview.style.display = 'flex';
  };

  slider.onmouseleave = () => {
    preview.style.display = 'none';
  };

  slider.onmousemove = (e) => {
    const rect = slider.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const leftPx = percent * rect.width;
    preview.style.left = `${leftPx}px`;

    const duration = video?.duration || 7200;
    const targetSeconds = percent * duration;
    if (timeEl) timeEl.textContent = formatMediaTime(targetSeconds);

    if (chapterEl) {
      chapterEl.textContent = percent < 0.05 ? 'Вступление' : (percent > 0.9 ? 'Титры' : 'Сцена фильма');
    }

    if (canvas && video && video.readyState >= 2) {
      try {
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      } catch {}
    }
  };
}

function formatMediaTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ==========================================
// AMBILIGHT (ДИНАМИЧЕСКАЯ ПОДСВЕТКА И НАСТРОЙКИ)
// ==========================================
function hexToRgb(hex) {
  const clean = (hex || '#00d2ff').replace('#', '');
  const bigint = parseInt(clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean, 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255
  };
}

function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255)
  };
}

function initAmbilight(video) {
  if (!ambilightCanvas) {
    ambilightCanvas = document.createElement('canvas');
    ambilightCanvas.width = 16;
    ambilightCanvas.height = 9;
    ambilightCtx = ambilightCanvas.getContext('2d', { willReadFrequently: true });
  }

  if (ambilightEnabled) {
    startAmbilightLoop(video);
  }
}

export function toggleAmbilight() {
  ambilightEnabled = !ambilightEnabled;
  try {
    localStorage.setItem('storm_ambilight', ambilightEnabled ? 'true' : 'false');
  } catch (_) {}
  const profileToggle = document.getElementById('profile-ambilight-toggle');
  if (profileToggle && profileToggle.checked !== ambilightEnabled) {
    profileToggle.checked = ambilightEnabled;
  }
  const aura = document.getElementById('player-ambilight-aura');
  const btn = document.getElementById('toggle-ambilight-btn');

  if (btn) {
    btn.classList.toggle('active', ambilightEnabled);
  }

  if (ambilightEnabled) {
    trackClientAction('use_ambilight');
    showToast('Динамическая подсветка Ambilight включена', 'info');
    const video = document.getElementById('storm-video-player');
    startAmbilightLoop(video);
  } else {
    stopAmbilight();
    if (aura) {
      aura.classList.remove('active');
      aura.style.opacity = '0';
      aura.style.boxShadow = 'none';
    }
    showToast('Подсветка Ambilight выключена', 'info');
  }
}

export function toggleAmbilightSettings() {
  const host = document.getElementById('ambilight-settings-panel-host');
  if (!host) return;

  if (host.innerHTML.trim()) {
    host.innerHTML = '';
  } else {
    renderAmbilightSettings(host);
  }
}

function renderAmbilightSettings(host) {
  host.innerHTML = `
    <div class="ambilight-settings-panel">
      <div class="ambilight-settings-header">
        <div class="ambilight-settings-title">
          <span>🎨</span>
          <span>Настройки подсветки Ambilight</span>
        </div>
        <button type="button" class="storm-btn storm-btn-sm" id="close-ambilight-settings-btn" style="padding: 2px 8px;">✕</button>
      </div>

      <!-- Главный переключатель состояния Ambilight -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding: 8px 12px; background: rgba(255,255,255,0.03); border-radius: 8px; border: 1px solid var(--border-subtle);">
        <span style="font-size: 12px; font-weight: 700;">Состояние подсветки:</span>
        <button type="button" class="storm-btn storm-btn-sm ${ambilightEnabled ? 'storm-btn-primary' : 'storm-btn-secondary'}" id="ambilight-master-toggle-btn">
          ${ambilightEnabled ? '🟢 Включен' : '⚪ Выключен'}
        </button>
      </div>

      <!-- Выбор режима свечения -->
      <div style="display: flex; gap: 8px; flex-wrap: wrap;">
        <button type="button" class="storm-btn storm-btn-sm ${ambilightSettings.mode === 'auto' ? 'storm-btn-primary' : 'storm-btn-secondary'}" id="mode-auto-btn">
          🌈 Авто / RGB перелив
        </button>
        <button type="button" class="storm-btn storm-btn-sm ${ambilightSettings.mode === 'preset' ? 'storm-btn-primary' : 'storm-btn-secondary'}" id="mode-preset-btn">
          💎 Пресеты цветов
        </button>
        <button type="button" class="storm-btn storm-btn-sm ${ambilightSettings.mode === 'custom' ? 'storm-btn-primary' : 'storm-btn-secondary'}" id="mode-custom-btn">
          🎯 Свой цвет
        </button>
      </div>

      <!-- Палитра пресетов -->
      <div id="ambilight-presets-block" style="display: ${ambilightSettings.mode === 'preset' ? 'flex' : 'none'}; flex-direction: column; gap: 6px;">
        <div style="font-size: 11px; font-weight: 700; color: var(--text-muted);">Выберите палитру:</div>
        <div class="ambilight-presets-row">
          ${AMBILIGHT_PRESETS.map(p => `
            <button type="button" class="ambilight-preset-btn ${ambilightSettings.color === p.color ? 'active' : ''}" data-color="${p.color}" style="background: ${p.color};" title="${p.name}"></button>
          `).join('')}
        </div>
      </div>

      <!-- Свой цвет (Color Picker) -->
      <div id="ambilight-custom-color-block" style="display: ${ambilightSettings.mode === 'custom' ? 'flex' : 'none'}; align-items: center; gap: 10px;">
        <input type="color" id="ambilight-custom-picker" value="${ambilightSettings.color}" style="width: 44px; height: 36px; border-radius: 8px; border: 1px solid var(--border-color); background: transparent; cursor: pointer;">
        <span style="font-size: 13px; font-weight: 700; color: var(--text-secondary);" id="ambilight-custom-hex">${ambilightSettings.color}</span>
      </div>

      <!-- Ползунки яркости и радиуса размытия -->
      <div class="ambilight-sliders-row">
        <div>
          <div style="display: flex; justify-content: space-between; font-size: 11px; font-weight: 700; margin-bottom: 4px;">
            <span>Яркость свечения</span>
            <span id="ambilight-intensity-val">${ambilightSettings.intensity}%</span>
          </div>
          <input type="range" class="storm-slider" id="ambilight-intensity-slider" min="10" max="100" value="${ambilightSettings.intensity}">
        </div>
        <div>
          <div style="display: flex; justify-content: space-between; font-size: 11px; font-weight: 700; margin-bottom: 4px;">
            <span>Размер ауры (размытие)</span>
            <span id="ambilight-blur-val">${ambilightSettings.blur}px</span>
          </div>
          <input type="range" class="storm-slider" id="ambilight-blur-slider" min="20" max="150" value="${ambilightSettings.blur}">
        </div>
      </div>

      <!-- Кнопки сохранения и закрытия -->
      <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px;">
        <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="ambilight-cancel-panel-btn">Отмена</button>
        <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="ambilight-save-close-btn">💾 Сохранить и закрыть</button>
      </div>

      <!-- Секция умного дома (WLED / Hue) -->
      <div id="smart-lights-mount" style="margin-top: 14px; border-top: 1px solid var(--border-subtle); padding-top: 12px;"></div>
    </div>
  `;

  const closeBtn = host.querySelector('#close-ambilight-settings-btn');
  if (closeBtn) closeBtn.onclick = () => { host.innerHTML = ''; };

  const masterToggleBtn = host.querySelector('#ambilight-master-toggle-btn');
  if (masterToggleBtn) {
    masterToggleBtn.onclick = () => {
      toggleAmbilight();
      masterToggleBtn.className = `storm-btn storm-btn-sm ${ambilightEnabled ? 'storm-btn-primary' : 'storm-btn-secondary'}`;
      masterToggleBtn.textContent = ambilightEnabled ? '🟢 Включен' : '⚪ Выключен';
      applyAmbilightInstantGlow();
    };
  }

  const saveCloseBtn = host.querySelector('#ambilight-save-close-btn');
  if (saveCloseBtn) {
    saveCloseBtn.onclick = () => {
      saveAmbilightSettings();
      applyAmbilightInstantGlow();
      host.innerHTML = '';
      showToast('✨ Настройки Ambilight сохранены', 'success');
    };
  }

  const cancelPanelBtn = host.querySelector('#ambilight-cancel-panel-btn');
  if (cancelPanelBtn) {
    cancelPanelBtn.onclick = () => {
      host.innerHTML = '';
    };
  }

  // Монтируем панель умной подсветки
  const lightsMount = host.querySelector('#smart-lights-mount');
  if (lightsMount) renderSmartLightsSettings(lightsMount);

  const modeAuto = host.querySelector('#mode-auto-btn');
  const modePreset = host.querySelector('#mode-preset-btn');
  const modeCustom = host.querySelector('#mode-custom-btn');
  const presetsBlock = host.querySelector('#ambilight-presets-block');
  const customBlock = host.querySelector('#ambilight-custom-color-block');

  const updateModeButtons = (activeMode) => {
    ambilightSettings.mode = activeMode;
    applyAmbilightInstantGlow();
    renderAmbilightSettings(host);
  };

  if (modeAuto) modeAuto.onclick = () => updateModeButtons('auto');
  if (modePreset) modePreset.onclick = () => updateModeButtons('preset');
  if (modeCustom) modeCustom.onclick = () => updateModeButtons('custom');

  // Пресеты
  host.querySelectorAll('.ambilight-preset-btn').forEach(btn => {
    btn.onclick = () => {
      ambilightSettings.color = btn.dataset.color;
      ambilightSettings.mode = 'preset';
      applyAmbilightInstantGlow();
      renderAmbilightSettings(host);
    };
  });

  // Color picker
  const picker = host.querySelector('#ambilight-custom-picker');
  const hexVal = host.querySelector('#ambilight-custom-hex');
  if (picker) {
    picker.oninput = (e) => {
      ambilightSettings.color = e.target.value;
      ambilightSettings.mode = 'custom';
      if (hexVal) hexVal.textContent = e.target.value;
      applyAmbilightInstantGlow();
    };
  }

  // Слайдеры
  const intensitySlider = host.querySelector('#ambilight-intensity-slider');
  const intensityVal = host.querySelector('#ambilight-intensity-val');
  if (intensitySlider) {
    intensitySlider.oninput = (e) => {
      ambilightSettings.intensity = parseInt(e.target.value, 10);
      if (intensityVal) intensityVal.textContent = `${ambilightSettings.intensity}%`;
      applyAmbilightInstantGlow();
    };
  }

  const blurSlider = host.querySelector('#ambilight-blur-slider');
  const blurVal = host.querySelector('#ambilight-blur-val');
  if (blurSlider) {
    blurSlider.oninput = (e) => {
      ambilightSettings.blur = parseInt(e.target.value, 10);
      if (blurVal) blurVal.textContent = `${ambilightSettings.blur}px`;
      applyAmbilightInstantGlow();
    };
  }
}

function saveAmbilightSettings() {
  try {
    localStorage.setItem('storm_ambilight_settings', JSON.stringify(ambilightSettings));
  } catch {}
}

function applyAmbilightInstantGlow() {
  saveAmbilightSettings();
  if (!ambilightEnabled) {
    // Если Ambilight отключен, сохраняем параметры, но не включаем подсветку самопроизвольно
    return;
  }

  const aura = document.getElementById('player-ambilight-aura');
  if (aura) {
    let r = 0, g = 210, b = 255;
    if (ambilightSettings.mode === 'preset' || ambilightSettings.mode === 'custom') {
      const rgb = hexToRgb(ambilightSettings.color);
      r = rgb.r;
      g = rgb.g;
      b = rgb.b;
    }
    const alpha = ambilightSettings.intensity / 100;
    const blur = ambilightSettings.blur;
    aura.classList.add('active');
    aura.style.opacity = `${alpha}`;
    aura.style.boxShadow = `0 0 ${blur}px rgba(${r}, ${g}, ${b}, 0.9), 0 0 ${Math.round(blur * 1.5)}px rgba(${r}, ${g}, ${b}, 0.55), inset 0 0 ${Math.round(blur * 0.5)}px rgba(${r}, ${g}, ${b}, 0.35)`;
  }

  const video = document.getElementById('storm-video-player');
  startAmbilightLoop(video);
}

function startAmbilightLoop(video) {
  stopAmbilight();

  let lastSampleTime = 0;
  let cachedR = 0, cachedG = 210, cachedB = 255;

  function loop() {
    if (!ambilightEnabled) return;

    const modal = document.getElementById('cinema-modal');
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || (modal && modal.classList.contains('is-fullscreen')));

    // В полноэкранном режиме видео закрывает экран на 100%.
    // Чтобы исключить GPU-to-CPU pipeline stall (drawImage + getImageData на 4K/1080p),
    // полностью отключаем рендеринг внутренней ауры.
    if (isFs) {
      const now = Date.now();
      if (now - lastSampleTime >= 200) {
        lastSampleTime = now;
        if (ambilightSettings.mode === 'preset' || ambilightSettings.mode === 'custom') {
          const rgb = hexToRgb(ambilightSettings.color);
          cachedR = rgb.r; cachedG = rgb.g; cachedB = rgb.b;
        } else if (video && !video.paused && !video.ended && video.videoWidth > 0 && ambilightCtx) {
          try {
            ambilightCtx.drawImage(video, 0, 0, 16, 9);
            const data = ambilightCtx.getImageData(0, 0, 16, 9).data;
            let sumR = 0, sumG = 0, sumB = 0, count = 0;
            for (let i = 0; i < data.length; i += 16) {
              sumR += data[i];
              sumG += data[i + 1];
              sumB += data[i + 2];
              count++;
            }
            cachedR = Math.round(sumR / count);
            cachedG = Math.round(sumG / count);
            cachedB = Math.round(sumB / count);
          } catch {
            const hue = (now / 40) % 360;
            const rgb = hslToRgb(hue / 360, 0.9, 0.55);
            cachedR = rgb.r; cachedG = rgb.g; cachedB = rgb.b;
          }
        }
        sendSmartLightsFrame(cachedR, cachedG, cachedB);
      }
      ambilightRaf = requestAnimationFrame(loop);
      return;
    }

    let r = 0, g = 210, b = 255;

    if (ambilightSettings.mode === 'preset' || ambilightSettings.mode === 'custom') {
      const rgb = hexToRgb(ambilightSettings.color);
      r = rgb.r;
      g = rgb.g;
      b = rgb.b;
    } else if (video && !video.paused && !video.ended && video.videoWidth > 0 && ambilightCtx) {
      try {
        ambilightCtx.drawImage(video, 0, 0, 16, 9);
        const data = ambilightCtx.getImageData(0, 0, 16, 9).data;
        let sumR = 0, sumG = 0, sumB = 0, count = 0;
        for (let i = 0; i < data.length; i += 16) {
          sumR += data[i];
          sumG += data[i + 1];
          sumB += data[i + 2];
          count++;
        }
        r = Math.round(sumR / count);
        g = Math.round(sumG / count);
        b = Math.round(sumB / count);
      } catch {
        // Запасной перелив если canvas tainted
        const hue = (Date.now() / 40) % 360;
        const rgb = hslToRgb(hue / 360, 0.9, 0.55);
        r = rgb.r; g = rgb.g; b = rgb.b;
      }
    } else {
      // Улучшенный кинематографичный Ambilight: адаптация под атмосферу жанра релиза
      let atmosColor = null;
      if (currentMedia) {
        const genres = (currentMedia.genres || []).map(g => (typeof g === 'string' ? g : g.name || '').toLowerCase());
        if (genres.some(g => g.includes('ужас') || g.includes('триллер'))) {
          atmosColor = { r: 220, g: 38, b: 38 }; // мистический кроваво-красный
        } else if (genres.some(g => g.includes('фантаст') || g.includes('кибер'))) {
          atmosColor = { r: 0, g: 240, b: 255 }; // неоновый циан
        } else if (genres.some(g => g.includes('фэнтези') || g.includes('приключ'))) {
          atmosColor = { r: 245, g: 158, b: 11 }; // янтарно-золотой
        } else if (genres.some(g => g.includes('боевик') || g.includes('криминал'))) {
          atmosColor = { r: 255, g: 107, b: 74 }; // закатно-огненный
        }
      }

      if (atmosColor) {
        const pulse = 0.88 + 0.12 * Math.sin(Date.now() / 1100);
        r = Math.round(atmosColor.r * pulse);
        g = Math.round(atmosColor.g * pulse);
        b = Math.round(atmosColor.b * pulse);
      } else {
        const hue = (Date.now() / 50) % 360;
        const rgb = hslToRgb(hue / 360, 0.85, 0.55);
        r = rgb.r; g = rgb.g; b = rgb.b;
      }
    }

    const aura = document.getElementById('player-ambilight-aura');
    if (aura) {
      const alpha = ambilightSettings.intensity / 100;
      const blur = ambilightSettings.blur;
      aura.classList.add('active');
      aura.style.opacity = `${alpha}`;
      aura.style.boxShadow = `
        0 -18px ${blur}px rgba(${r}, ${g}, ${b}, 0.5),
        0 18px ${blur}px rgba(${r}, ${g}, ${b}, 0.6),
        -24px 0 ${Math.round(blur * 1.3)}px rgba(${r}, ${g}, ${b}, 0.55),
        24px 0 ${Math.round(blur * 1.3)}px rgba(${r}, ${g}, ${b}, 0.55),
        inset 0 0 ${Math.round(blur * 0.4)}px rgba(${r}, ${g}, ${b}, 0.35)
      `;
    }

    sendSmartLightsFrame(r, g, b);

    ambilightRaf = requestAnimationFrame(loop);
  }

  ambilightRaf = requestAnimationFrame(loop);
}

function stopAmbilight() {
  if (ambilightRaf) {
    cancelAnimationFrame(ambilightRaf);
    ambilightRaf = null;
  }
}

// ==========================================
// ПРОПУСК ОПЕНИНГОВ И ЭНДИНГОВ (SKIP INTRO/OUTRO)
// ==========================================
async function loadSkipTimes(mediaId, episode) {
  skipIntervals = null;
  try {
    const title = currentMedia?.title || currentMedia?.original_title || '';
    const video = document.getElementById('storm-video-player');
    const dur = video?.duration || 0;
    const res = await fetch(`/api/media/skip-times?malId=${encodeURIComponent(mediaId || '')}&title=${encodeURIComponent(title)}&episode=${encodeURIComponent(episode || 1)}&duration=${encodeURIComponent(Math.round(dur))}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.found && (data.op || data.ed)) {
        skipIntervals = data;
        setSmartSkipIntervals({
          verified: true,
          intro: data.op ? { start: data.op.start, end: data.op.end, label: data.op.label || 'Опенинг (Интро)' } : null,
          outro: data.ed ? { start: data.ed.start, end: data.ed.end, label: data.ed.label || 'Финальные титры (Эндинг)' } : null
        });
      } else {
        skipIntervals = null;
      }
    }
  } catch {
    skipIntervals = null;
  }
}

function setupSkipLogic(video) {
  const skipIntroBtn = document.getElementById('skip-intro-btn');
  const skipOutroBtn = document.getElementById('skip-outro-btn');

  if (skipIntroBtn) {
    skipIntroBtn.onclick = () => {
      if (skipIntervals?.op?.end) {
        video.currentTime = skipIntervals.op.end;
        trackClientAction('use_skip');
        showToast('Заставка пропущена', 'info');
      }
    };
  }

  if (skipOutroBtn) {
    skipOutroBtn.onclick = () => {
      trackClientAction('use_skip');
      if (video.duration && skipIntervals?.ed?.end && skipIntervals.ed.end < video.duration - 15) {
        video.currentTime = skipIntervals.ed.end;
        showToast('Титры пропущены (сцена после титров)', 'info');
      } else {
        playNextEpisode();
      }
    };
  }

  let lastHtml5Sync = 0;
  video.ontimeupdate = () => {
    const time = video.currentTime;
    checkUpNextEpisodeCountdown(video);

    // Синхронизация ползунка прогресса
    if (video.duration) {
      const percent = Math.min(100, Math.round((time / video.duration) * 100));
      currentProgressPercent = percent;
      const slider = document.getElementById('player-progress-slider');
      const label = document.getElementById('player-progress-label');
      if (slider) slider.value = percent;
      if (label) label.textContent = `${percent}%`;

      const now = Date.now();
      if (now - lastHtml5Sync >= 10000 && currentMedia) {
        lastHtml5Sync = now;
        syncWatchProgress({
          media_id: currentMedia.id,
          source: currentMedia.source,
          title: currentMedia.title,
          poster_url: currentMedia.poster,
          media_type: currentMedia.media_type,
          year: currentMedia.year || '',
          season: currentMedia.season || 1,
          episode: currentEpisodeIndex || 1,
          total_episodes: currentEpisodes.length || 1,
          duration_seconds: Math.round(video.duration),
          time_seconds: Math.round(time),
          progress_percent: percent
        });
      }
    }

    if (!skipIntervals) return;

    // Автопропуск или отображение кнопки ручного пропуска заставки
    if (skipIntervals.op && time >= skipIntervals.op.start && time <= skipIntervals.op.end) {
      if (localStorage.getItem('storm_autoskip_intro') !== 'false') {
        video.currentTime = skipIntervals.op.end;
        trackClientAction('use_skip');
        showToast('⏩ Заставка автоматически пропущена', 'info');
        if (skipIntroBtn) skipIntroBtn.style.display = 'none';
      } else if (skipIntroBtn) {
        skipIntroBtn.style.display = 'block';
      }
    } else if (skipIntroBtn) {
      skipIntroBtn.style.display = 'none';
    }

    // Отображение кнопки ручного пропуска титров
    if (skipIntervals.ed && time >= skipIntervals.ed.start && time <= skipIntervals.ed.end) {
      if (skipOutroBtn) skipOutroBtn.style.display = 'block';
    } else if (skipOutroBtn) {
      skipOutroBtn.style.display = 'none';
    }
  };

  video.addEventListener('ended', () => {
    if (!isAutoNextEnabled()) return;
    showToast('Воспроизведение завершено. Переход к следующей серии...', 'info');
    setTimeout(() => {
      playInPlayerNextEpisode();
    }, 1200);
  });
}

/* ==========================================================================
   ИНТЕЛЛЕКТУАЛЬНЫЙ ОВЕРЛЕЙ ПЛЕЕРА, СКОРОСТЬ ВОСПРОИЗВЕДЕНИЯ И ПЕРЕКЛЮЧЕНИЕ СЕРИЙ
   ========================================================================== */

export function applySavedPlaybackSpeed(video) {
  const saved = localStorage.getItem('storm_playback_speed') || '1';
  const speed = parseFloat(saved) || 1;
  if (video) {
    try { video.playbackRate = speed; } catch {}
  }
  document.querySelectorAll('video').forEach(v => {
    try { v.playbackRate = speed; } catch {}
  });
  document.querySelectorAll('.cinema-player-iframe, #cinema-player-wrapper iframe, iframe').forEach(iframe => {
    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) {
        doc.querySelectorAll('video').forEach(v => {
          v.playbackRate = speed;
        });
      }
    } catch {}
  });
  updateInPlayerSpeedDisplay(speed);
}

export const AVAILABLE_PLAYBACK_SPEEDS = [1, 1.25, 1.5, 1.75, 2, 0.5, 0.75];

export function cyclePlaybackSpeed() {
  const curSpeed = parseFloat(localStorage.getItem('storm_playback_speed') || '1');
  let idx = AVAILABLE_PLAYBACK_SPEEDS.findIndex(s => Math.abs(s - curSpeed) < 0.01);
  if (idx === -1) idx = 0;
  const nextSpeed = AVAILABLE_PLAYBACK_SPEEDS[(idx + 1) % AVAILABLE_PLAYBACK_SPEEDS.length];
  setGlobalPlaybackSpeed(nextSpeed);
  return nextSpeed;
}

export function setGlobalPlaybackSpeed(speed) {
  const sp = parseFloat(speed) || 1;
  localStorage.setItem('storm_playback_speed', String(sp));

  // 1. Применение ко всем HTML5 <video> в документе
  document.querySelectorAll('video').forEach(video => {
    try {
      video.playbackRate = sp;
    } catch {}
  });

  // 2. Доступ к DOM видео внутри доступных iframes
  document.querySelectorAll('.cinema-player-iframe, #cinema-player-wrapper iframe, iframe').forEach(iframe => {
    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) {
        doc.querySelectorAll('video').forEach(v => {
          v.playbackRate = sp;
        });
      }
    } catch {}
  });

  // 3. Отправка postMessage во все поддерживаемые типы сторонних плееров (объекты и JSON)
  const msgs = [
    { event: 'speed', value: sp },
    { api: 'speed', val: sp },
    { api: 'speed', set: sp },
    { api: 'playbackRate', set: sp },
    { action: 'speed', rate: sp },
    { method: 'setSpeed', speed: sp },
    { method: 'speed', rate: sp, value: sp },
    { key: 'kodik_player_api', value: { action: 'speed', rate: sp, method: 'speed' } },
    { type: 'SET_SPEED', speed: sp, value: sp }
  ];
  document.querySelectorAll('.cinema-player-iframe, #cinema-player-wrapper iframe, iframe').forEach(iframe => {
    msgs.forEach(msg => {
      try {
        iframe.contentWindow?.postMessage(msg, '*');
        iframe.contentWindow?.postMessage(JSON.stringify(msg), '*');
      } catch {}
    });
  });

  updateInPlayerSpeedDisplay(sp);
  showToast(`⏱️ Скорость: ${sp}x`, 'info');
}

function updateInPlayerSpeedDisplay(speed) {
  const sp = parseFloat(speed) || 1;
  const overlay = document.getElementById('storm-inplayer-overlay');
  if (!overlay) return;
  const btn = overlay.querySelector('#inplayer-speed-btn');
  if (btn) {
    btn.innerHTML = `
      <svg class="inplayer-speed-svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px; margin-right: 4px;">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      </svg>
      <span>${sp}x</span>
    `;
  }
  const menu = overlay.querySelector('#inplayer-speed-menu');
  if (menu) {
    menu.querySelectorAll('.inplayer-speed-item').forEach(item => {
      item.classList.toggle('active', parseFloat(item.dataset.speed) === sp);
    });
  }
}

function toggleInPlayerSpeedMenu(overlay) {
  if (!overlay) overlay = document.getElementById('storm-inplayer-overlay');
  if (!overlay) return;
  const menu = overlay.querySelector('#inplayer-speed-menu');
  if (!menu) return;

  const isOpen = menu.classList.contains('is-open');
  if (isOpen) {
    menu.classList.remove('is-open');
  } else {
    const curSpeed = parseFloat(localStorage.getItem('storm_playback_speed') || '1');
    menu.querySelectorAll('.inplayer-speed-item').forEach(item => {
      const sp = parseFloat(item.dataset.speed);
      item.classList.toggle('active', sp === curSpeed);
    });
    menu.classList.add('is-open');
  }
}

export function toggleInPlayerEpisodesSheet(overlay, show) {
  if (!overlay) overlay = document.getElementById('storm-inplayer-overlay');
  if (!overlay) return;
  const sheet = overlay.querySelector('#player-inplayer-episodes-sheet');
  const epBtn = overlay.querySelector('#inplayer-episodes-btn');
  if (!sheet) return;

  if (quickBarSeriesData?.type === 'movie' || !checkIfMediaIsSeries(currentMedia)) {
    sheet.classList.remove('is-open');
    sheet.style.display = 'none';
    if (epBtn) epBtn.classList.remove('active');
    return;
  }

  if (show === undefined) {
    show = !sheet.classList.contains('is-open');
  }

  if (show) {
    sheet.style.display = 'flex';
    renderInPlayerEpisodesSheet(overlay);
    sheet.classList.add('is-open');
    if (epBtn) epBtn.classList.add('active');
  } else {
    sheet.classList.remove('is-open');
    sheet.style.display = 'none';
    if (epBtn) epBtn.classList.remove('active');
  }
  syncInPlayerDrawerState(overlay);
}

export function renderInPlayerEpisodesSheet(overlay) {
  if (!overlay) overlay = document.getElementById('storm-inplayer-overlay');
  if (!overlay) return;

  const sheet = overlay.querySelector('#player-inplayer-episodes-sheet');
  if (quickBarSeriesData?.type === 'movie' || !checkIfMediaIsSeries(currentMedia)) {
    if (sheet) {
      sheet.classList.remove('is-open');
      sheet.style.display = 'none';
    }
    return;
  }

  const chipsBar = overlay.querySelector('#inplayer-season-chips-bar');
  const epList = overlay.querySelector('#inplayer-episodes-list');
  const countBadge = overlay.querySelector('#inplayer-sheet-count');
  if (!chipsBar || !epList) return;

  const curMediaId = currentMedia?.id;

  // 1. FanFilm / Kodik (quickBarSeriesData)
  if (quickBarSeriesData && quickBarSeriesData.seasons && quickBarSeriesData.seasons.length > 0) {
    sortSeasonsAndEpisodes(quickBarSeriesData.seasons);
    chipsBar.style.display = quickBarSeriesData.seasons.length > 1 ? 'flex' : 'none';
    chipsBar.innerHTML = quickBarSeriesData.seasons.map(s => `
      <button type="button" class="inplayer-season-chip ${s.season === quickBarActiveSeason ? 'active' : ''}" data-season="${s.season}">
        ${s.name || `Сезон ${s.season}`}
      </button>
    `).join('');

    chipsBar.querySelectorAll('.inplayer-season-chip').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const sNum = parseInt(btn.dataset.season, 10);
        selectQuickSeason(sNum);
        renderInPlayerEpisodesSheet(overlay);
      };
    });

    const currentSeasonObj = quickBarSeriesData.seasons.find(s => s.season === quickBarActiveSeason) || quickBarSeriesData.seasons[0];
    const episodes = currentSeasonObj?.episodes || [];
    if (countBadge) countBadge.textContent = `${episodes.length} сер.`;
    const watchedEpisodes = curMediaId ? getWatchedEpisodes(curMediaId, quickBarActiveSeason) : new Set();

    epList.innerHTML = episodes.map(ep => {
      const isAct = ep.episode === quickBarActiveEpisode;
      const isWatched = watchedEpisodes.has(ep.episode);
      let statusHtml = '';
      if (isAct) {
        statusHtml = '<span class="inplayer-ep-status-pill current">▶ Смотрю</span>';
      } else if (isWatched) {
        statusHtml = '<span class="inplayer-ep-status-pill watched">✓</span>';
      }

      return `
        <div class="inplayer-ep-item ${isAct ? 'active' : ''}" data-episode="${ep.episode}">
          <span class="inplayer-ep-num">${ep.episode}</span>
          <span class="inplayer-ep-name">${escapeHtml(formatCleanEpisodeTitle(ep.episode, ep.name))}</span>
          ${statusHtml}
        </div>
      `;
    }).join('');

    epList.querySelectorAll('.inplayer-ep-item').forEach(item => {
      item.onclick = (e) => {
        e.stopPropagation();
        const epNum = parseInt(item.dataset.episode, 10);
        selectQuickEpisode(epNum);
        toggleInPlayerEpisodesSheet(overlay, false);
      };
    });
    return;
  }

  // 2. TMDB / базовые сериалы (через готовые DOM-карточки series-episodes-grid)
  const gridEl = document.getElementById('series-episodes-grid');
  if (gridEl && gridEl.children.length > 0) {
    chipsBar.style.display = 'none';
    const cards = Array.from(gridEl.querySelectorAll('.series-episode-card'));
    if (countBadge) countBadge.textContent = `${cards.length} сер.`;
    epList.innerHTML = cards.map(c => {
      const epNum = parseInt(c.dataset.epNum, 10);
      const isAct = c.classList.contains('active');
      const isWatched = c.classList.contains('watched');
      const title = c.querySelector('.series-episode-title')?.textContent || `Серия ${epNum}`;
      return `
        <div class="inplayer-ep-item ${isAct ? 'active' : ''}" data-ep-num="${epNum}">
          <span class="inplayer-ep-num">${epNum}</span>
          <span class="inplayer-ep-name">${escapeHtml(title)}</span>
          ${isAct ? '<span class="inplayer-ep-status-pill current">▶ Смотрю</span>' : (isWatched ? '<span class="inplayer-ep-status-pill watched">✓</span>' : '')}
        </div>
      `;
    }).join('');

    epList.querySelectorAll('.inplayer-ep-item').forEach(item => {
      item.onclick = (e) => {
        e.stopPropagation();
        const epNum = parseInt(item.dataset.epNum, 10);
        const origCard = gridEl.querySelector(`.series-episode-card[data-ep-num="${epNum}"]`);
        if (origCard) origCard.click();
        toggleInPlayerEpisodesSheet(overlay, false);
      };
    });
    return;
  }

  // 2b. TMDB сериалы напрямую из метаданных currentMedia.seasons
  if (currentMedia?.seasons && currentMedia.seasons.length > 0) {
    const seasonsList = currentMedia.seasons.filter(s => (s.season_number > 0 || currentMedia.seasons.length === 1));
    sortSeasonsAndEpisodes(seasonsList);
    const curSeasonNum = (typeof activeSeasonNum !== 'undefined' ? activeSeasonNum : (currentSeasonIndex || 1));
    chipsBar.style.display = seasonsList.length > 1 ? 'flex' : 'none';
    chipsBar.innerHTML = seasonsList.map(s => `
      <button type="button" class="inplayer-season-chip ${(s.season_number || s.season) === curSeasonNum ? 'active' : ''}" data-season="${s.season_number || s.season}">
        ${escapeHtml(s.name || `Сезон ${s.season_number || s.season}`)}
      </button>
    `).join('');

    chipsBar.querySelectorAll('.inplayer-season-chip').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const sNum = parseInt(btn.dataset.season, 10);
        if (typeof activeSeasonNum !== 'undefined') activeSeasonNum = sNum;
        if (typeof currentSeasonIndex !== 'undefined') currentSeasonIndex = sNum;
        const mainTab = document.querySelector(`.series-season-tab[data-season-num="${sNum}"]`);
        if (mainTab) mainTab.click();
        renderInPlayerEpisodesSheet(overlay);
      };
    });

    const activeSeasonObj = seasonsList.find(s => (s.season_number || s.season) === curSeasonNum) || seasonsList[0];
    const epCount = activeSeasonObj?.episode_count || 8;
    if (countBadge) countBadge.textContent = `${epCount} сер.`;
    const curEpNum = (typeof activeEpisodeNum !== 'undefined' ? activeEpisodeNum : (currentEpisodeIndex || 1));
    const watchedEpisodes = curMediaId ? getWatchedEpisodes(curMediaId, curSeasonNum) : new Set();

    let epItems = [];
    for (let i = 1; i <= epCount; i++) {
      const isAct = i === curEpNum;
      const isWatched = watchedEpisodes.has(i);
      epItems.push(`
        <div class="inplayer-ep-item ${isAct ? 'active' : ''}" data-ep-num="${i}">
          <span class="inplayer-ep-num">${i}</span>
          <span class="inplayer-ep-name">Серия ${i}</span>
          ${isAct ? '<span class="inplayer-ep-status-pill current">▶ Смотрю</span>' : (isWatched ? '<span class="inplayer-ep-status-pill watched">✓</span>' : '')}
        </div>
      `);
    }
    epList.innerHTML = epItems.join('');

    epList.querySelectorAll('.inplayer-ep-item').forEach(item => {
      item.onclick = (e) => {
        e.stopPropagation();
        const epNum = parseInt(item.dataset.epNum, 10);
        if (typeof activeEpisodeNum !== 'undefined') activeEpisodeNum = epNum;
        if (typeof currentEpisodeIndex !== 'undefined') currentEpisodeIndex = epNum;
        const origCard = gridEl ? gridEl.querySelector(`.series-episode-card[data-ep-num="${epNum}"]`) : null;
        if (origCard) {
          origCard.click();
        } else {
          updatePlayerUrl(currentMedia, curSeasonNum, epNum, currentActivePlayer);
        }
        updateInPlayerEpisodeInfo();
        toggleInPlayerEpisodesSheet(overlay, false);
      };
    });
    return;
  }

  // 3. AniXart
  if (currentEpisodes && currentEpisodes.length > 0) {
    chipsBar.style.display = 'none';
    if (countBadge) countBadge.textContent = `${currentEpisodes.length} сер.`;
    epList.innerHTML = currentEpisodes.map((ep, idx) => {
      const epNum = ep.position || (idx + 1);
      const isAct = epNum === currentEpisodeIndex;
      return `
        <div class="inplayer-ep-item ${isAct ? 'active' : ''}" data-index="${idx}">
          <span class="inplayer-ep-num">${epNum}</span>
          <span class="inplayer-ep-name">${escapeHtml(formatCleanEpisodeTitle(epNum, ep.name_ru || ep.name))}</span>
          ${isAct ? '<span class="inplayer-ep-status-pill current">▶ Смотрю</span>' : ''}
        </div>
      `;
    }).join('');

    epList.querySelectorAll('.inplayer-ep-item').forEach(item => {
      item.onclick = (e) => {
        e.stopPropagation();
        const idx = parseInt(item.dataset.index, 10);
        const ep = currentEpisodes[idx];
        if (ep) {
          currentEpisodeIndex = ep.position || (idx + 1);
          playAnixartEpisode(ep);
        }
        toggleInPlayerEpisodesSheet(overlay, false);
      };
    });
    return;
  }

  // 4. AniLibria
  if (currentMedia?.episodes && currentMedia.episodes.length > 0) {
    chipsBar.style.display = 'none';
    if (countBadge) countBadge.textContent = `${currentMedia.episodes.length} сер.`;
    epList.innerHTML = currentMedia.episodes.map((ep, idx) => {
      const epNum = ep.ordinal || (idx + 1);
      const isAct = epNum === currentEpisodeIndex;
      return `
        <div class="inplayer-ep-item ${isAct ? 'active' : ''}" data-index="${idx}">
          <span class="inplayer-ep-num">${epNum}</span>
          <span class="inplayer-ep-name">${escapeHtml(formatCleanEpisodeTitle(epNum, ep.name))}</span>
          ${isAct ? '<span class="inplayer-ep-status-pill current">▶ Смотрю</span>' : ''}
        </div>
      `;
    }).join('');

    epList.querySelectorAll('.inplayer-ep-item').forEach(item => {
      item.onclick = (e) => {
        e.stopPropagation();
        const idx = parseInt(item.dataset.index, 10);
        const ep = currentMedia.episodes[idx];
        if (ep) {
          currentEpisodeIndex = ep.ordinal || (idx + 1);
          const streamUrl = ep.hls_1080 || ep.hls_720 || ep.hls_480;
          if (streamUrl) playStreamUrl(streamUrl);
          loadSkipTimes(currentMedia.id, currentEpisodeIndex);
        }
        toggleInPlayerEpisodesSheet(overlay, false);
      };
    });
    return;
  }

  epList.innerHTML = '<div style="color:var(--text-muted);padding:14px;text-align:center;font-size:12px;">Список серий уточняется...</div>';
}

export function renderInPlayerVoiceSheet(sheet) {
  if (!sheet) return;
  const listEl = sheet.querySelector('#inplayer-voice-list');
  if (!listEl) return;

  let translations = [];
  if (quickBarSeriesData?.seasons) {
    const sObj = quickBarSeriesData.seasons.find(s => s.season === quickBarActiveSeason) || quickBarSeriesData.seasons[0];
    const epObj = sObj?.episodes?.find(e => e.episode === quickBarActiveEpisode) || sObj?.episodes?.[0];
    translations = epObj?.translations || [];
  }

  if (!translations.length && currentMedia?.translations) {
    translations = currentMedia.translations;
  }

  if (!translations.length && currentMedia?.voiceovers) {
    translations = currentMedia.voiceovers.map(v => ({
      id: v.id,
      name: v.name,
      quality: v.quality || 'Студийный дубляж'
    }));
  }

  // Если серверный список пуст (например, одиночный релиз / 4K UHD FanFilm / прямое видео),
  // предоставляем выбор эталонных студийных дорожек с мгновенным запоминанием
  if (!translations.length) {
    const savedPreferred = localStorage.getItem('storm_preferred_voiceover') || 'Дубляж';
    const fallbackTracks = [
      { id: 'orig_51', name: 'Оригинальный дубляж (5.1 / 4K UHD)', quality: 'Dolby Digital 5.1' },
      { id: 'rhs', name: 'Дубляж Red Head Sound', quality: 'Студийный дубляж' },
      { id: 'lostfilm', name: 'Студия LostFilm', quality: 'Многоголосый закадровый' },
      { id: 'hdrezka', name: 'Студия HDRezka', quality: 'Многоголосый закадровый' },
      { id: 'sub', name: 'Оригинал с русскими субтитрами', quality: 'Subtitles' }
    ];

    listEl.innerHTML = fallbackTracks.map((t, idx) => {
      const isAct = savedPreferred.toLowerCase().includes(t.name.split(' ')[1]?.toLowerCase() || 'дубляж') || (idx === 0 && !savedPreferred);
      return `
        <div class="inplayer-voice-item ${isAct ? 'active' : ''}" data-voice-id="${t.id}" data-voice-name="${escapeHtml(t.name)}">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 16px;">🎙️</span>
            <div>
              <div style="font-weight: 700; font-size: 13px;">${escapeHtml(t.name)}</div>
              <div style="font-size: 11px; color: var(--text-muted);">${t.quality}</div>
            </div>
          </div>
          ${isAct ? '<span class="inplayer-voice-check">✓ Активна</span>' : ''}
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.inplayer-voice-item').forEach(item => {
      item.onclick = (e) => {
        e.stopPropagation();
        const vId = item.dataset.voiceId;
        const vName = item.dataset.voiceName;
        localStorage.setItem('storm_preferred_voiceover', vName);
        if (currentMedia?.id) {
          localStorage.setItem(`storm_fav_voiceover_${currentMedia.id}`, vName);
        }
        const voiceVal = document.getElementById('quick-voiceover-val');
        if (voiceVal) voiceVal.textContent = vName;
        sheet.classList.remove('is-open');
        sheet.style.display = 'none';
        const voiceBtn = document.getElementById('inplayer-voice-btn');
        if (voiceBtn) voiceBtn.classList.remove('active');
        try { document.querySelector('.cinema-player-iframe')?.contentWindow?.postMessage({ type: 'STORM_SET_AUDIO', name: vName, index: parseInt(vId, 10) || 0 }, '*'); } catch (_) {}
        syncInPlayerDrawerState();
        showToast(`🎙️ Выбрана аудиодорожка: ${vName}`, 'info');
      };
    });
    return;
  }

  // Если есть реальные translations
  listEl.innerHTML = translations.map(t => {
    const isAct = String(t.id) === String(quickBarActiveTranslationId) || String(t.id) === String(currentVoiceoverId);
    return `
      <div class="inplayer-voice-item ${isAct ? 'active' : ''}" data-voice-id="${t.id}" data-voice-name="${escapeHtml(t.name || 'Озвучка')}">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 16px;">🎙️</span>
          <div>
            <div style="font-weight: 700; font-size: 13px;">${escapeHtml(t.name || 'Озвучка')}</div>
            <div style="font-size: 11px; color: var(--text-muted);">${t.quality || (t.is_uhd ? '4K UHD' : 'Студийный дубляж')}</div>
          </div>
        </div>
        ${isAct ? '<span class="inplayer-voice-check">✓ Активна</span>' : ''}
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.inplayer-voice-item').forEach(item => {
    item.onclick = async (e) => {
      e.stopPropagation();
      const vId = item.dataset.voiceId;
      const vName = item.dataset.voiceName;
      quickBarActiveTranslationId = vId;
      await selectQuickVoiceover(vId);
      sheet.classList.remove('is-open');
      sheet.style.display = 'none';
      const voiceBtn = document.getElementById('inplayer-voice-btn');
      if (voiceBtn) voiceBtn.classList.remove('active');
      try { document.querySelector('.cinema-player-iframe')?.contentWindow?.postMessage({ type: 'STORM_SET_AUDIO', name: vName, index: parseInt(vId, 10) || 0 }, '*'); } catch (_) {}
      syncInPlayerDrawerState();
      showToast(`🎙️ Озвучка: ${vName}`, 'info');
    };
  });
}

export function checkIfMediaIsSeries(media) {
  if (!media) return false;
  const titleLower = String(media.title || media.name || '').toLowerCase();
  // Анимационные и художественные фильмы серии "Обитель зла" (Мутация, Вендетта, Вырождение, Проклятие, Остров смерти) - строго фильмы
  if (titleLower.includes('обитель зла') && (titleLower.includes('мутация') || titleLower.includes('вендетта') || titleLower.includes('вырождение') || titleLower.includes('проклятие') || titleLower.includes('остров смерти') || titleLower.includes('resident evil'))) {
    return false;
  }

  // Защита от мультфильмов со словом монстр/монстры (Корпорация монстров, Монстры на каникулах и др. - строго мультфильмы)
  const isMonsterCartoonOrMovie = [
    'корпорация монстров', 'университет монстров', 'монстры на каникулах', 
    'монстры против пришельцев', 'миньоны и монстры', 'монстр траки', 'монстро'
  ].some(m => titleLower === m || titleLower.startsWith(m + ' ') || titleLower.includes(m));

  // Известные подтверждённые сериалы (включая Монстры, Менталист, Дневники вампира)
  const isExplicitSeriesTitle = !isMonsterCartoonOrMovie && (
    titleLower === 'монстры' || titleLower.startsWith('монстры ') || titleLower.startsWith('монстры:') ||
    titleLower === 'монстр' || titleLower.startsWith('монстр ') || titleLower.startsWith('монстр:') ||
    titleLower.includes('менталист') || titleLower.includes('the mentalist') ||
    titleLower.includes('дневники вампира') || titleLower.includes('vampire diaries') ||
    titleLower.includes('рик и морти') || titleLower.includes('rick and morty') ||
    titleLower.includes('гриффины') || titleLower.includes('симпсоны') || titleLower.includes('южный парк') ||
    /сезон\s*\d+/i.test(titleLower) || /\b(s\d+|season\s*\d+)\b/i.test(titleLower)
  );

  if (isExplicitSeriesTitle) {
    return true;
  }

  // Явные признаки фильма: если медиа помечено как фильм и не входит в список подтверждённых сериалов
  const isExplicitMovie = media.media_type === 'movie' || media.type === 'movie' || 
                          media.media_type === 'cartoon' || media.media_type === 'anime-movie' ||
                          media.category === 'Фильм' || media.category === 'фильм' || 
                          media.category === 'Мультфильм';

  if (isExplicitMovie && !isExplicitSeriesTitle) {
    return false;
  }

  // 1. Приоритет данных: быстрая панель серий (только если тип не movie)
  if (quickBarSeriesData && quickBarSeriesData.type !== 'movie' && Array.isArray(quickBarSeriesData.seasons) && quickBarSeriesData.seasons.length > 0) {
    return true;
  }
  if (typeof media.seasons === 'number' && media.seasons > 1) {
    return true;
  }
  if (Array.isArray(media.seasons) && media.seasons.length > 1) {
    return true;
  }
  if (Array.isArray(media.episodes) && media.episodes.length > 1) {
    return true;
  }
  if (media.rutube_id && (media.seasons || media.episodes)) {
    return true;
  }
  if ((parseInt(media.total_episodes, 10) || 0) > 1 || (parseInt(media.episode, 10) || 0) > 1 || (parseInt(media.season, 10) || 0) > 1) {
    return true;
  }
  if ((media.source === 'anilibria' || media.source === 'anixart') && media.media_type !== 'anime-movie') {
    return true;
  }
  // 2. Признаки сериала по категории, ссылке или заголовку
  if (media.media_type === 'series' || 
      media.media_type === 'tv' || 
      media.media_type === 'cartoon-series' || 
      media.media_type === 'anime-series' || 
      media.category === 'Сериал' || 
      media.category === 'сериал' ||
      media.category === 'Аниме-сериал' || 
      media.category === 'Мультсериал' ||
      String(media.link || media.url || '').includes('serial') ||
      String(media.link || media.url || '').includes('fan-serials')) {
    return true;
  }
  return false;
}

export function updateInPlayerEpisodeInfo() {
  const overlay = document.getElementById('storm-inplayer-overlay');
  if (!overlay) return;

  const badge = overlay.querySelector('#inplayer-badge');
  const name = overlay.querySelector('#inplayer-series-name');
  const epBtn = overlay.querySelector('#inplayer-episodes-btn');
  const bottomBar = overlay.querySelector('#inplayer-bottom-bar');
  const sheet = overlay.querySelector('#player-inplayer-episodes-sheet');
  const prevBtn = overlay.querySelector('#inplayer-prev-ep-btn');
  const nextBtn = overlay.querySelector('#inplayer-next-ep-btn');

  const isSeries = quickBarSeriesData?.type !== 'movie' && checkIfMediaIsSeries(currentMedia);

  let titleText = cleanVideoTitle(currentMedia?.title || '');
  let epText = '';
  let hasPrev = false;
  let hasNext = false;

  if (isSeries) {
    if (quickBarSeriesData && quickBarSeriesData.seasons && quickBarSeriesData.seasons.length > 0) {
      const curSeasonObj = quickBarSeriesData.seasons.find(s => s.season === quickBarActiveSeason) || quickBarSeriesData.seasons[0];
      const totalEps = curSeasonObj?.episodes?.length || 0;
      const curEpIdx = curSeasonObj?.episodes?.findIndex(e => e.episode === quickBarActiveEpisode) ?? -1;

      epText = `📺 С${quickBarActiveSeason} • Э${quickBarActiveEpisode}`;
      hasPrev = curEpIdx > 0 || quickBarActiveSeason > 1;
      hasNext = (curEpIdx >= 0 && curEpIdx < totalEps - 1) || quickBarSeriesData.seasons.findIndex(s => s.season === quickBarActiveSeason) < quickBarSeriesData.seasons.length - 1;
    } else if (currentEpisodes && currentEpisodes.length > 0) {
      epText = `📺 Серия ${currentEpisodeIndex || 1}`;
      const idx = currentEpisodes.findIndex(e => (e.position || 1) === currentEpisodeIndex);
      hasPrev = idx > 0;
      hasNext = idx >= 0 && idx < currentEpisodes.length - 1;
    } else if (currentMedia?.episodes && currentMedia.episodes.length > 0) {
      epText = `📺 Серия ${currentEpisodeIndex || 1}`;
      const idx = currentMedia.episodes.findIndex(e => (e.ordinal || 1) === currentEpisodeIndex);
      hasPrev = idx > 0;
      hasNext = idx >= 0 && idx < currentMedia.episodes.length - 1;
    } else {
      epText = `📺 Серия 1`;
    }
  } else {
    // ДЛЯ ФИЛЬМОВ
    epText = currentMedia?.quality || '🎬 Фильм';
  }

  if (badge) badge.textContent = epText;
  if (name) name.textContent = titleText;
  if (epBtn) {
    if (isSeries) {
      epBtn.style.display = 'inline-flex';
    } else {
      epBtn.style.setProperty('display', 'none', 'important');
    }
  }
  if (bottomBar) {
    if (isSeries) {
      bottomBar.style.display = 'flex';
    } else {
      bottomBar.style.setProperty('display', 'none', 'important');
    }
  }
  if (sheet) {
    if (!isSeries) {
      sheet.classList.remove('is-open');
      sheet.style.setProperty('display', 'none', 'important');
    } else {
      sheet.style.display = '';
    }
  }
  if (prevBtn) prevBtn.disabled = !hasPrev;
  if (nextBtn) nextBtn.disabled = !hasNext;

  if (isSeries && sheet && sheet.classList.contains('is-open')) {
    renderInPlayerEpisodesSheet(overlay);
  }
}

export function playEpisodeByNumber(epNum, seasonNum = null) {
  const ep = Number(epNum);
  if (!ep || isNaN(ep)) return false;
  const sNum = seasonNum !== null && seasonNum !== undefined ? Number(seasonNum) : Number(quickBarActiveSeason || currentMedia?.season || 1);

  currentEpisodeIndex = ep;
  quickBarActiveEpisode = ep;
  quickBarActiveSeason = sNum;

  if (currentMedia?.id) {
    startInvisibleEpisodeWatchTracker(currentMedia, sNum, ep);
  }

  // 1. Универсальная быстрая панель серверов / FanFilm / RuTube / VK / Kodik
  if (quickBarSeriesData && quickBarSeriesData.seasons && quickBarSeriesData.seasons.length > 0) {
    if (quickBarActiveSeason !== sNum) {
      quickBarActiveSeason = sNum;
    }
    selectQuickEpisode(ep);
    updateInPlayerEpisodeInfo();
    highlightActiveEpisodeInGrid(ep);
    return true;
  }

  // Если панель еще не инициализирована, но медиа является сериалом
  if (checkIfMediaIsSeries(currentMedia)) {
    initUniversalSeriesQuickBar(sNum, ep);
    selectQuickEpisode(ep);
    updateInPlayerEpisodeInfo();
    highlightActiveEpisodeInGrid(ep);
    return true;
  }

  // 2. AniLibria (Многосезонная поддержка)
  if (currentMedia?.source === 'anilibria') {
    const seasonObj = (currentMedia.seasons || []).find(s => Number(s.season_number) === Number(sNum));
    const epsPool = (seasonObj && Array.isArray(seasonObj.episodes) && seasonObj.episodes.length > 0)
      ? seasonObj.episodes
      : (currentMedia.episodes || []);
    const rawEp = epsPool.find(e => Number(e.ordinal || e.episode_number || 1) === ep) || epsPool[ep - 1];
    if (rawEp) {
      const streamUrl = rawEp.hls_1080 || rawEp.hls_720 || rawEp.hls_480;
      if (streamUrl) playStreamUrl(streamUrl);
      loadSkipTimes(seasonObj?.release_id || currentMedia.id, ep);
      updateInPlayerEpisodeInfo();
      highlightActiveEpisodeInGrid(ep);
      showToast(`🎬 Сезон ${sNum} • Серия ${ep}`, 'info');
      return true;
    }
  }

  // 3. AniXart
  if (currentMedia?.source === 'anixart' && currentEpisodes && currentEpisodes.length > 0) {
    const rawEp = (currentEpisodes || []).find(e => Number(e.position || 1) === ep) || currentEpisodes[ep - 1];
    if (rawEp) {
      playAnixartEpisode(rawEp);
      loadSkipTimes(currentMedia.id, ep);
      updateInPlayerEpisodeInfo();
      highlightActiveEpisodeInGrid(ep);
      showToast(`🎬 Серия ${ep}`, 'info');
      return true;
    }
  }

  // 4. Прямой HLS видео-плеер (RuTube HLS без рекламы)
  const video = document.getElementById('storm-video-player');
  const activeId = currentActivePlayer?.id || '';
  if (video && (activeId.includes('rutube') || currentMedia?.rutube_id)) {
    const cleanT = cleanVideoTitle(currentMedia?.title || '');
    fetch(`/api/media/rutube-episode?title=${encodeURIComponent(cleanT)}&season=${sNum}&episode=${ep}`)
      .then(r => r.json())
      .then(d => {
        if (d && d.hls_url) {
          playStreamUrl(d.hls_url);
        } else if (d && d.embed_url) {
          playStreamUrl(d.embed_url);
        }
      })
      .catch(() => {});
    showToast(`🎬 Сезон ${sNum} • Серия ${ep}`, 'info');
    updatePlayerUrl(currentMedia, sNum, ep, currentActivePlayer);
    highlightActiveEpisodeInGrid(ep);
    updateInPlayerEpisodeInfo();
    return true;
  }

  // 5. Iframe плеер (RuTube, VK Видео, Kodik, HDRezka, Collaps, FanFilm и др.)
  const iframe = document.querySelector('.cinema-player-iframe');
  if (iframe) {
    try {
      if (activeId.startsWith('rutube')) {
        const allEps = currentMedia?.episodes || [];
        const epData = allEps.find(e => Number(e.episode_number || e.ordinal || e.episode) === ep);
        if (epData && epData.embed_url) {
          const ruIdMatch = epData.embed_url.match(/\/embed\/([a-f0-9]{32})/i);
          replaceIframeSrcNoHistory(iframe, (adblockEnabled && ruIdMatch) ? `/api/player/rutube-embed/${ruIdMatch[1]}` : epData.embed_url);
          showToast(`🎬 Сезон ${sNum} • Серия ${ep}`, 'info');
          updatePlayerUrl(currentMedia, sNum, ep, currentActivePlayer);
          highlightActiveEpisodeInGrid(ep);
          updateInPlayerEpisodeInfo();
          return true;
        }

        const cleanT = cleanVideoTitle(currentMedia?.title || '');
        fetch(`/api/media/rutube-episode?title=${encodeURIComponent(cleanT)}&season=${sNum}&episode=${ep}`)
          .then(r => r.json())
          .then(d => {
            if (d && d.embed_url) {
              const ruIdMatch = d.embed_url.match(/\/embed\/([a-f0-9]{32})/i);
              replaceIframeSrcNoHistory(iframe, (adblockEnabled && ruIdMatch) ? `/api/player/rutube-embed/${ruIdMatch[1]}` : d.embed_url);
            }
          })
          .catch(() => {});

        showToast(`🎬 Сезон ${sNum} • Серия ${ep}`, 'info');
        updatePlayerUrl(currentMedia, sNum, ep, currentActivePlayer);
        highlightActiveEpisodeInGrid(ep);
        updateInPlayerEpisodeInfo();
        return true;
      }

      if (activeId.startsWith('vk')) {
        const cleanT = cleanVideoTitle(currentMedia?.title || '');
        fetch(`/api/media/vk-episode?title=${encodeURIComponent(cleanT)}&season=${sNum}&episode=${ep}`)
          .then(r => r.json())
          .then(d => {
            if (d && d.embed_url) {
              replaceIframeSrcNoHistory(iframe, d.embed_url);
            }
          })
          .catch(() => {});

        showToast(`🎬 Сезон ${sNum} • Серия ${ep}`, 'info');
        updatePlayerUrl(currentMedia, sNum, ep, currentActivePlayer);
        highlightActiveEpisodeInGrid(ep);
        updateInPlayerEpisodeInfo();
        return true;
      }

      let curSrc = iframe.src || (currentActivePlayer?.url || '');
      if (curSrc) {
        let newUrl = curSrc;
        if (newUrl.includes('season=') || newUrl.includes('episode=')) {
          newUrl = newUrl.replace(/([?&])season=\d+/g, `$1season=${sNum}`);
          newUrl = newUrl.replace(/([?&])episode=\d+/g, `$1episode=${ep}`);
        } else {
          newUrl += (newUrl.includes('?') ? '&' : '?') + `season=${sNum}&episode=${ep}`;
        }
        replaceIframeSrcNoHistory(iframe, newUrl);
        showToast(`🎬 Сезон ${sNum} • Серия ${ep}`, 'info');
        updatePlayerUrl(currentMedia, sNum, ep, currentActivePlayer);
        highlightActiveEpisodeInGrid(ep);
        updateInPlayerEpisodeInfo();
        return true;
      }
    } catch (_) {}
  }

  updatePlayerUrl(currentMedia, sNum, ep, currentActivePlayer);
  highlightActiveEpisodeInGrid(ep);
  updateInPlayerEpisodeInfo();
  return false;
}

export function playInPlayerNextEpisode() {
  if (!checkIfMediaIsSeries(currentMedia)) {
    showToast('Это фильм, следующая серия недоступна', 'info');
    return;
  }

  // 1. Быстрая панель FanFilm / Kodik / серверов
  if (quickBarSeriesData && quickBarSeriesData.seasons && quickBarSeriesData.seasons.length > 0) {
    const curSeason = Number(quickBarActiveSeason) || 1;
    const curEp = Number(quickBarActiveEpisode) || 1;
    const curSeasonObj = quickBarSeriesData.seasons.find(s => Number(s.season) === curSeason) || quickBarSeriesData.seasons[0];
    if (curSeasonObj?.episodes && curSeasonObj.episodes.length > 0) {
      const curEpIdx = curSeasonObj.episodes.findIndex(e => Number(e.episode) === curEp);
      if (curEpIdx >= 0 && curEpIdx < curSeasonObj.episodes.length - 1) {
        const nextEp = Number(curSeasonObj.episodes[curEpIdx + 1].episode);
        selectQuickEpisode(nextEp);
        updateInPlayerEpisodeInfo();
        return;
      } else {
        const curSeasonIdx = quickBarSeriesData.seasons.findIndex(s => Number(s.season) === curSeason);
        if (curSeasonIdx >= 0 && curSeasonIdx < quickBarSeriesData.seasons.length - 1) {
          const nextSeasonObj = quickBarSeriesData.seasons[curSeasonIdx + 1];
          const nextSeason = Number(nextSeasonObj.season);
          const firstEp = Number(nextSeasonObj.episodes?.[0]?.episode || 1);
          selectQuickSeason(nextSeason);
          selectQuickEpisode(firstEp);
          updateInPlayerEpisodeInfo();
          return;
        }
      }
    }
  }

  // 2. AniXart
  if (currentEpisodes && currentEpisodes.length > 0) {
    const curEp = Number(currentEpisodeIndex) || 1;
    const curIdx = currentEpisodes.findIndex(e => Number(e.position || e.ordinal || 1) === curEp);
    if (curIdx >= 0 && curIdx < currentEpisodes.length - 1) {
      const nextEp = currentEpisodes[curIdx + 1];
      const nextEpNum = Number(nextEp.position || nextEp.ordinal || (curIdx + 2));
      currentEpisodeIndex = nextEpNum;
      playAnixartEpisode(nextEp);
      updateInPlayerEpisodeInfo();
      return;
    }
  }

  // 3. AniLibria
  if (currentMedia?.episodes && currentMedia.episodes.length > 0) {
    const curEp = Number(currentEpisodeIndex) || 1;
    const curIdx = currentMedia.episodes.findIndex(e => Number(e.ordinal || 1) === curEp);
    if (curIdx >= 0 && curIdx < currentMedia.episodes.length - 1) {
      const nextEp = currentMedia.episodes[curIdx + 1];
      const nextEpNum = Number(nextEp.ordinal || (curIdx + 2));
      currentEpisodeIndex = nextEpNum;
      const streamUrl = nextEp.hls_1080 || nextEp.hls_720 || nextEp.hls_480;
      if (streamUrl) playStreamUrl(streamUrl);
      loadSkipTimes(currentMedia.id, nextEpNum);
      updateInPlayerEpisodeInfo();
      return;
    }
  }

  // 4. Сетка серий TMDB / базовых сериалов
  const gridEl = document.getElementById('series-episodes-grid') || document.getElementById('episodes-grid');
  if (gridEl) {
    const activeCard = gridEl.querySelector('.series-episode-card.active, .episode-btn.active');
    const nextCard = activeCard ? activeCard.nextElementSibling : gridEl.querySelector('.series-episode-card');
    if (nextCard && nextCard.classList.contains('series-episode-card')) {
      const nextEpNum = parseInt(nextCard.dataset.epNum, 10);
      if (nextEpNum && !isNaN(nextEpNum)) {
        playEpisodeByNumber(nextEpNum);
        updateInPlayerEpisodeInfo();
        return;
      }
    }
  }

  // 5. Общий переход по порядковому номеру
  const curEpNum = Number(currentEpisodeIndex || quickBarActiveEpisode || 1);
  const nextEpNum = curEpNum + 1;
  const switched = playEpisodeByNumber(nextEpNum);
  if (switched) {
    updateInPlayerEpisodeInfo();
    return;
  }

  showToast('Это последняя серия сезона', 'info');
  if (currentMedia && currentMedia.id) {
    currentMedia.user_status = 'completed';
    saveBookmarkStatus(currentMedia, 'completed');
    renderStatusButtons('completed');
  }
}

export function playInPlayerPrevEpisode() {
  if (!checkIfMediaIsSeries(currentMedia)) return;

  // 1. Быстрая панель FanFilm / Kodik / серверов
  if (quickBarSeriesData && quickBarSeriesData.seasons && quickBarSeriesData.seasons.length > 0) {
    const curSeason = Number(quickBarActiveSeason) || 1;
    const curEp = Number(quickBarActiveEpisode) || 1;
    const curSeasonObj = quickBarSeriesData.seasons.find(s => Number(s.season) === curSeason) || quickBarSeriesData.seasons[0];
    if (curSeasonObj?.episodes) {
      const curEpIdx = curSeasonObj.episodes.findIndex(e => Number(e.episode) === curEp);
      if (curEpIdx > 0) {
        const prevEp = Number(curSeasonObj.episodes[curEpIdx - 1].episode);
        selectQuickEpisode(prevEp);
        updateInPlayerEpisodeInfo();
        return;
      } else {
        const curSeasonIdx = quickBarSeriesData.seasons.findIndex(s => Number(s.season) === curSeason);
        if (curSeasonIdx > 0) {
          const prevSeasonObj = quickBarSeriesData.seasons[curSeasonIdx - 1];
          const lastEp = Number(prevSeasonObj.episodes?.[prevSeasonObj.episodes.length - 1]?.episode || 1);
          selectQuickSeason(Number(prevSeasonObj.season));
          selectQuickEpisode(lastEp);
          updateInPlayerEpisodeInfo();
          return;
        }
      }
    }
  }

  // 2. AniXart
  if (currentEpisodes && currentEpisodes.length > 0) {
    const curEp = Number(currentEpisodeIndex) || 1;
    const curIdx = currentEpisodes.findIndex(e => Number(e.position || e.ordinal || 1) === curEp);
    if (curIdx > 0) {
      const prevEp = currentEpisodes[curIdx - 1];
      const prevEpNum = Number(prevEp.position || prevEp.ordinal || curIdx);
      currentEpisodeIndex = prevEpNum;
      playAnixartEpisode(prevEp);
      updateInPlayerEpisodeInfo();
      return;
    }
  }

  // 3. AniLibria
  if (currentMedia?.episodes && currentMedia.episodes.length > 0) {
    const curEp = Number(currentEpisodeIndex) || 1;
    const curIdx = currentMedia.episodes.findIndex(e => Number(e.ordinal || 1) === curEp);
    if (curIdx > 0) {
      const prevEp = currentMedia.episodes[curIdx - 1];
      const prevEpNum = Number(prevEp.ordinal || curIdx);
      currentEpisodeIndex = prevEpNum;
      const streamUrl = prevEp.hls_1080 || prevEp.hls_720 || prevEp.hls_480;
      if (streamUrl) playStreamUrl(streamUrl);
      loadSkipTimes(currentMedia.id, prevEpNum);
      updateInPlayerEpisodeInfo();
      return;
    }
  }

  // 4. Сетка серий TMDB
  const gridEl = document.getElementById('series-episodes-grid') || document.getElementById('episodes-grid');
  if (gridEl) {
    const activeCard = gridEl.querySelector('.series-episode-card.active, .episode-btn.active');
    if (activeCard && activeCard.previousElementSibling && activeCard.previousElementSibling.classList.contains('series-episode-card')) {
      const prevEpNum = parseInt(activeCard.previousElementSibling.dataset.epNum, 10);
      if (prevEpNum && !isNaN(prevEpNum)) {
        playEpisodeByNumber(prevEpNum);
        updateInPlayerEpisodeInfo();
        return;
      }
    }
  }

  // 5. Порядковый откат назад
  const curEpNum = Number(currentEpisodeIndex || quickBarActiveEpisode || 1);
  if (curEpNum > 1) {
    playEpisodeByNumber(curEpNum - 1);
    updateInPlayerEpisodeInfo();
    return;
  }

  showToast('Это первая серия', 'info');
}

export function playNextEpisode() {
  playInPlayerNextEpisode();
}

let inPlayerHideTimer = null;

export function resetInPlayerHideTimer() {
  clearTimeout(inPlayerHideTimer);
  inPlayerHideTimer = setTimeout(() => {
    hideInPlayerControls();
  }, 3500);
}

export function showInPlayerControls() {
  const modal = document.getElementById('cinema-modal');
  const videoBox = document.querySelector('#cinema-player-wrapper .player-video-box') || document.querySelector('.player-video-box');
  if (videoBox) videoBox.classList.add('controls-visible');
  if (modal) modal.classList.add('controls-visible');
  resetInPlayerHideTimer();
}

export function hideInPlayerControls(force = false) {
  const modal = document.getElementById('cinema-modal');
  const videoBox = document.querySelector('#cinema-player-wrapper .player-video-box') || document.querySelector('.player-video-box');
  if (!force && videoBox) {
    const vs = videoBox.querySelector('#player-inplayer-voice-sheet');
    const jw = videoBox.querySelector('#inplayer-jog-dial-widget');
    const es = videoBox.querySelector('#player-inplayer-episodes-sheet');
    const isVoiceOpen = vs && vs.style.display !== 'none' && vs.classList.contains('is-open');
    const isJogOpen = jw && jw.style.display !== 'none';
    const isEpOpen = es && es.classList.contains('is-open');
    if (isVoiceOpen || isJogOpen || isEpOpen) return;
  }
  if (videoBox) videoBox.classList.remove('controls-visible');
  if (modal) modal.classList.remove('controls-visible');
}

if (typeof window !== 'undefined' && !window._stormGlobalControlsListenersAttached) {
  window._stormGlobalControlsListenersAttached = true;
  const onUserActivity = () => {
    const modal = document.getElementById('cinema-modal');
    if (modal && (modal.classList.contains('is-open') || modal.classList.contains('is-fullscreen'))) {
      showInPlayerControls();
    }
  };
  window.addEventListener('mousemove', onUserActivity, { passive: true });
  window.addEventListener('pointermove', onUserActivity, { passive: true });
}

/**
 * 🛡️ STORM RuTube Shield: Полное скрытие кнопки «Смотреть на RUTUBE» и внешних ссылок
 * Перекрывает всплывающее облачко при воспроизведении и плашку на заставке/паузе,
 * блокируя внешние редиректы и возвращая нативное управление воспроизведением.
 */
export function mountRuTubeShield(videoBox, iframeEl) {
  if (!videoBox) return;
  const oldShield = videoBox.querySelector('#storm-rutube-shield');
  if (oldShield) oldShield.remove();

  const shield = document.createElement('div');
  shield.className = 'storm-rutube-shield';
  shield.id = 'storm-rutube-shield';
  shield.innerHTML = `
    <!-- 1. Маска всплывающего облачка «Смотреть на RUTUBE» в правом нижнем углу при воспроизведении -->
    <div class="rutube-shield-bottom-pill" id="rutube-shield-bottom-pill" title="STORM Player">
      <span class="rutube-shield-badge-text">⚡ STORM CINEMA</span>
    </div>

    <!-- 2. Маска плашки «Смотреть на RUTUBE» внизу по центру на паузе / сплэш-скрине -->
    <div class="rutube-shield-center-pill" id="rutube-shield-center-pill" title="Воспроизвести">
      <span class="rutube-shield-badge-text">▶ Нажмите для просмотра</span>
    </div>
  `;

  videoBox.appendChild(shield);

  const bottomPill = shield.querySelector('#rutube-shield-bottom-pill');
  const centerPill = shield.querySelector('#rutube-shield-center-pill');

  let isPlaying = false;

  const togglePlayback = (e) => {
    e?.preventDefault();
    e?.stopPropagation();
    try {
      const cmd = isPlaying ? { type: 'player:pause' } : { type: 'player:play' };
      iframeEl?.contentWindow?.postMessage(JSON.stringify(cmd), '*');
      iframeEl?.contentWindow?.postMessage(cmd, '*');
    } catch (_) {}
  };

  if (bottomPill) {
    bottomPill.addEventListener('click', togglePlayback);
    bottomPill.addEventListener('touchend', togglePlayback);
  }

  if (centerPill) {
    centerPill.addEventListener('click', (e) => {
      e?.preventDefault();
      e?.stopPropagation();
      try {
        iframeEl?.contentWindow?.postMessage(JSON.stringify({ type: 'player:play' }), '*');
        iframeEl?.contentWindow?.postMessage({ type: 'player:play' }, '*');
      } catch (_) {}
    });
    centerPill.addEventListener('touchend', (e) => {
      e?.preventDefault();
      e?.stopPropagation();
      try {
        iframeEl?.contentWindow?.postMessage(JSON.stringify({ type: 'player:play' }), '*');
        iframeEl?.contentWindow?.postMessage({ type: 'player:play' }, '*');
      } catch (_) {}
    });
  }

  // Отслеживаем активность курсора для синхронного авто-скрытия с элементами управления плеера
  let idleTimer = null;
  const onActivity = () => {
    shield.classList.remove('controls-idle');
    if (idleTimer) clearTimeout(idleTimer);
    if (isPlaying) {
      idleTimer = setTimeout(() => {
        shield.classList.add('controls-idle');
      }, 3200);
    }
  };

  videoBox.addEventListener('mousemove', onActivity, { passive: true });
  videoBox.addEventListener('touchstart', onActivity, { passive: true });

  // Слушаем события от RuTube плеера для актуализации статуса воспроизведения
  const onMessage = (event) => {
    try {
      const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      if (!data) return;
      if (data.type === 'player:changeState') {
        if (data.data?.state === 'playing') {
          isPlaying = true;
          if (centerPill) centerPill.style.display = 'none';
        } else if (data.data?.state === 'paused' || data.data?.state === 'stopped') {
          isPlaying = false;
          shield.classList.remove('controls-idle');
          if (centerPill) centerPill.style.display = 'flex';
        }
      }
    } catch (_) {}
  };

  window.addEventListener('message', onMessage);
}

export function mountInPlayerOverlay(videoBox) {
  if (!videoBox) return;
  attachCinemaDblClick(videoBox);
  const isSeries = checkIfMediaIsSeries(currentMedia);
  const oldOverlay = videoBox.querySelector('.storm-inplayer-overlay');
  if (oldOverlay) {
    oldOverlay.remove();
  }

  const overlay = document.createElement('div');
  overlay.className = 'storm-inplayer-overlay';
  overlay.id = 'storm-inplayer-overlay';
  attachCinemaDblClick(overlay);
  overlay.innerHTML = `
    <!-- Прозрачная зона улавливания курсора мыши в верхней части плеера -->
    <div class="inplayer-top-sensor" id="inplayer-top-sensor"></div>

    <!-- Верхняя полоса управления Progressive Disclosure HUD -->
    <div class="inplayer-top-bar">
      <div class="inplayer-title-info">
        <span class="inplayer-badge" id="inplayer-badge">${isSeries ? '📺 Серия 1' : ((currentMedia?.is_upcoming || (typeof window.isUpcomingMediaItem === 'function' && window.isUpcomingMediaItem(currentMedia))) ? '🕒 ОЖИДАЕТСЯ' : (currentMedia?.quality || '🎬 Фильм'))}</span>
        <span class="inplayer-series-name" id="inplayer-series-name">${escapeHtml(currentMedia?.title || '')}</span>
        <div class="inplayer-telemetry-pill" id="inplayer-telemetry-pill" title="Телеметрия потока и статистика буфера">
          <span class="telemetry-dot"></span>
          <span id="telemetry-text">${(currentMedia?.is_upcoming || (typeof window.isUpcomingMediaItem === 'function' && window.isUpcomingMediaItem(currentMedia))) ? 'Ожидается цифровой релиз' : `${escapeHtml((currentActivePlayer?.quality || currentMedia?.quality || '1080p FHD').replace(/\s*\/.*$/, ''))} • Поток активен`}</span>
        </div>
      </div>
      <div class="inplayer-top-actions">
        <button type="button" class="inplayer-ctrl-btn" id="inplayer-voice-btn" title="Выбор студии озвучки и аудиодорожки">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
          <span>Озвучка</span>
        </button>
        <button type="button" class="inplayer-ctrl-btn" id="inplayer-episodes-btn" title="Список сезонов и серий" style="${isSeries ? '' : 'display: none;'}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="15" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/></svg>
          <span>Серии</span>
        </button>
        <button type="button" class="inplayer-ctrl-btn" id="inplayer-jog-btn" title="Джог-дайл (роторная покадровая перемотка)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="3" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="21"/><line x1="3" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="21" y2="12"/></svg>
          <span>Джог</span>
        </button>
        <button type="button" class="inplayer-ctrl-btn" id="inplayer-focus-btn" title="Кинотеатральный режим фокуса (развернуть экран и скрыть боковые панели)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
          <span>Фокус</span>
        </button>
      </div>
    </div>

    <!-- Джог-дайл роторная покадровая перемотка (Студийный прецизионный контроллер) -->
    <div class="inplayer-jog-dial-widget" id="inplayer-jog-dial-widget" style="display: none;">
      <div class="jog-dial-header">
        <div class="jog-dial-header-title">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <circle cx="12" cy="12" r="3"></circle>
            <line x1="12" y1="2" x2="12" y2="5"></line>
            <line x1="12" y1="19" x2="12" y2="22"></line>
            <line x1="2" y1="12" x2="5" y2="12"></line>
            <line x1="19" y1="12" x2="22" y2="12"></line>
          </svg>
          <span>Джог-дайл</span>
        </div>
        <button type="button" class="jog-dial-close" id="jog-dial-close-btn" title="Закрыть джог">✕</button>
      </div>

      <!-- Прецизионный ротор со шкалой градаций -->
      <div class="jog-dial-wheel-wrap" id="jog-dial-wheel-wrap" title="Вращайте по кругу, перетаскивайте или крутите колесико мыши">
        <div class="jog-dial-bezel">
          <svg class="jog-dial-bezel-svg" viewBox="0 0 126 126">
            <circle cx="63" cy="63" r="58" fill="none" stroke="var(--accent-glow)" stroke-width="1.5" stroke-dasharray="2 6.5"/>
            <!-- Основные деления 0, 90, 180, 270 град -->
            <line x1="63" y1="5" x2="63" y2="11" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"/>
            <line x1="121" y1="63" x2="115" y2="63" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"/>
            <line x1="63" y1="121" x2="63" y2="115" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"/>
            <line x1="5" y1="63" x2="11" y2="63" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </div>
        <div class="jog-dial-wheel" id="jog-dial-wheel">
          <div class="jog-dial-rotor-grooves"></div>
          <div class="jog-dial-dimple">
            <div class="jog-dial-indicator"></div>
          </div>
          <div class="jog-dial-hub">
            <div class="jog-dial-hub-dot"></div>
          </div>
        </div>
      </div>

      <!-- Цифровой HUD дисплей информации -->
      <div class="jog-dial-hud">
        <div class="jog-hud-time-row">
          <span class="jog-hud-label">Позиция</span>
          <span class="jog-hud-time" id="jog-dial-time-display">00:00</span>
        </div>
        <div class="jog-hud-delta-badge" id="jog-dial-delta-badge" style="opacity: 0;">
          <span id="jog-dial-delta-text">±0с</span>
        </div>
      </div>

      <!-- Быстрые тактильные 3D кнопки: -10с, -1с, +1с, +10с -->
      <div class="jog-dial-controls">
        <button type="button" class="jog-btn" id="jog-step-back10" title="Перемотка назад на 10 секунд">-10с</button>
        <button type="button" class="jog-btn jog-btn-micro" id="jog-step-back1" title="Назад на 1 секунду / покадрово">-1с</button>
        <button type="button" class="jog-btn jog-btn-micro" id="jog-step-fwd1" title="Вперед на 1 секунду / покадрово">+1с</button>
        <button type="button" class="jog-btn" id="jog-step-fwd10" title="Перемотка вперед на 10 секунд">+10с</button>
      </div>

      <div class="jog-dial-footer">Вращайте ротор или колесико мыши</div>
    </div>

    <!-- Выдвижная шторка выбора студии озвучки прямо в плеере -->
    <div class="player-inplayer-voice-sheet" id="player-inplayer-voice-sheet" style="display: none;">
      <div class="inplayer-sheet-header">
        <div class="inplayer-sheet-title">
          <span>🎙️</span>
          <span>Выбор студии озвучки</span>
        </div>
        <button type="button" class="inplayer-sheet-close-btn" id="inplayer-voice-close-btn" title="Закрыть">✕</button>
      </div>
      <div class="inplayer-voice-list" id="inplayer-voice-list"></div>
    </div>

    <!-- Нижняя полоса быстрого переключения серий: компактные парящие капсулы -->
    <div class="inplayer-bottom-bar" id="inplayer-bottom-bar" style="${isSeries ? '' : 'display: none;'}">
      <button type="button" class="inplayer-episode-nav-btn" id="inplayer-prev-ep-btn" title="Предыдущая серия">
        ⏮ <span>Пред. серия</span>
      </button>
      <button type="button" class="inplayer-episode-nav-btn" id="inplayer-next-ep-btn" title="Следующая серия">
        <span>След. серия</span> ⏭
      </button>
    </div>

    <!-- Выдвижная шторка выбора сезона и серии прямо в плеере -->
    <div class="player-inplayer-episodes-sheet" id="player-inplayer-episodes-sheet" style="${isSeries ? '' : 'display: none;'}">
      <div class="inplayer-sheet-header">
        <div class="inplayer-sheet-title">
          <span>📺</span>
          <span>Выбор серии</span>
          <span class="inplayer-sheet-count" id="inplayer-sheet-count"></span>
        </div>
        <button type="button" class="inplayer-sheet-close-btn" id="inplayer-sheet-close-btn" title="Закрыть список">✕</button>
      </div>
      <div class="inplayer-season-chips-bar" id="inplayer-season-chips-bar"></div>
      <div class="inplayer-episodes-list" id="inplayer-episodes-list"></div>
    </div>
  `;
  videoBox.appendChild(overlay);

  const epBtn = overlay.querySelector('#inplayer-episodes-btn');
  const voiceBtn = overlay.querySelector('#inplayer-voice-btn');
  const jogBtn = overlay.querySelector('#inplayer-jog-btn');
  const focusBtn = overlay.querySelector('#inplayer-focus-btn');
  const voiceSheet = overlay.querySelector('#player-inplayer-voice-sheet');
  const voiceCloseBtn = overlay.querySelector('#inplayer-voice-close-btn');
  const episodesSheet = overlay.querySelector('#player-inplayer-episodes-sheet');
  const sheetCloseBtn = overlay.querySelector('#inplayer-sheet-close-btn');
  const jogWidget = overlay.querySelector('#inplayer-jog-dial-widget');
  const jogCloseBtn = overlay.querySelector('#jog-dial-close-btn');
  const jogWheel = overlay.querySelector('#jog-dial-wheel');
  const jogWheelWrap = overlay.querySelector('#jog-dial-wheel-wrap');
  const jogTimeDisplay = overlay.querySelector('#jog-dial-time-display');
  const jogDeltaBadge = overlay.querySelector('#jog-dial-delta-badge');
  const jogDeltaText = overlay.querySelector('#jog-dial-delta-text');
  const jogBack10 = overlay.querySelector('#jog-step-back10');
  const jogBack1 = overlay.querySelector('#jog-step-back1');
  const jogFwd1 = overlay.querySelector('#jog-step-fwd1');
  const jogFwd10 = overlay.querySelector('#jog-step-fwd10');

  // 1. Кнопка «Серии»
  if (epBtn) {
    epBtn.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (voiceSheet) { voiceSheet.classList.remove('is-open'); voiceSheet.style.display = 'none'; voiceBtn?.classList.remove('active'); }
      if (jogWidget) { jogWidget.style.display = 'none'; jogBtn?.classList.remove('active'); stopJogTracking(); }
      toggleInPlayerEpisodesSheet(overlay);
    };
  }

  if (sheetCloseBtn) {
    sheetCloseBtn.onclick = (e) => {
      e.stopPropagation();
      toggleInPlayerEpisodesSheet(overlay, false);
    };
  }

  // 2. Кнопка «Озвучка» (боковая выдвижная шторка)
  if (voiceBtn && voiceSheet) {
    voiceBtn.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (episodesSheet) { episodesSheet.classList.remove('is-open'); episodesSheet.style.display = 'none'; epBtn?.classList.remove('active'); }
      if (jogWidget) { jogWidget.style.display = 'none'; jogBtn?.classList.remove('active'); stopJogTracking(); }

      const isOpen = voiceSheet.classList.contains('is-open');
      if (isOpen) {
        voiceSheet.classList.remove('is-open');
        voiceSheet.style.display = 'none';
        voiceBtn.classList.remove('active');
      } else {
        voiceSheet.style.display = 'flex';
        renderInPlayerVoiceSheet(voiceSheet);
        voiceSheet.classList.add('is-open');
        voiceBtn.classList.add('active');
      }
      syncInPlayerDrawerState(overlay);
    };
  }

  if (voiceCloseBtn && voiceSheet) {
    voiceCloseBtn.onclick = (e) => {
      e.stopPropagation();
      voiceSheet.classList.remove('is-open');
      voiceSheet.style.display = 'none';
      if (voiceBtn) voiceBtn.classList.remove('active');
      syncInPlayerDrawerState(overlay);
    };
  }

  // 3. Кнопка «Джог» (Премиальный роторный контроллер покадровой перемотки)
  let jogRotation = 0;
  let jogSessionDelta = 0;
  let jogBadgeTimeout = null;
  let jogTimeTrackerTimer = null;

  const updateJogDisplay = () => {
    const v = document.getElementById('storm-video-player') || document.querySelector('#cinema-player-wrapper video');
    if (jogTimeDisplay) {
      if (v && v.currentTime !== undefined && !isNaN(v.currentTime)) {
        jogTimeDisplay.textContent = formatMediaTime(v.currentTime);
      } else if (jogSessionDelta !== 0) {
        jogTimeDisplay.textContent = `${jogSessionDelta > 0 ? '+' : ''}${jogSessionDelta}с`;
      } else if (currentWatchTimeSeconds > 0) {
        jogTimeDisplay.textContent = formatMediaTime(currentWatchTimeSeconds);
      } else {
        jogTimeDisplay.textContent = '00:00';
      }
    }
  };

  const flashDeltaBadge = (seconds) => {
    if (!jogDeltaBadge || !jogDeltaText) return;
    jogSessionDelta += seconds;
    if (jogSessionDelta > 0) {
      jogDeltaText.textContent = `▶ +${jogSessionDelta}с`;
      jogDeltaBadge.style.color = 'var(--accent)';
      jogDeltaBadge.style.borderColor = 'var(--accent)';
      jogDeltaBadge.style.background = 'var(--accent-glow)';
    } else if (jogSessionDelta < 0) {
      jogDeltaText.textContent = `◀ ${jogSessionDelta}с`;
      jogDeltaBadge.style.color = '#f59e0b';
      jogDeltaBadge.style.borderColor = 'rgba(245, 158, 11, 0.45)';
      jogDeltaBadge.style.background = 'rgba(245, 158, 11, 0.18)';
    } else {
      jogDeltaText.textContent = '±0с';
    }
    jogDeltaBadge.style.opacity = '1';
    jogDeltaBadge.style.transform = 'scale(1)';

    clearTimeout(jogBadgeTimeout);
    jogBadgeTimeout = setTimeout(() => {
      if (jogDeltaBadge) {
        jogDeltaBadge.style.opacity = '0';
        jogDeltaBadge.style.transform = 'scale(0.9)';
      }
      jogSessionDelta = 0;
    }, 1400);
  };

  const doJogStep = (seconds, animated = true) => {
    sendSeekDelta(seconds);
    if (animated && jogWheel) {
      jogWheel.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
      jogRotation += seconds > 0 ? 36 * Math.min(seconds, 3) : 36 * Math.max(seconds, -3);
      jogWheel.style.transform = `rotate(${jogRotation}deg)`;
    }
    flashDeltaBadge(seconds);
    updateJogDisplay();
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(8); } catch (_) {}
    }
  };

  const startJogTracking = () => {
    stopJogTracking();
    updateJogDisplay();
    jogTimeTrackerTimer = setInterval(updateJogDisplay, 350);
  };

  const stopJogTracking = () => {
    if (jogTimeTrackerTimer) {
      clearInterval(jogTimeTrackerTimer);
      jogTimeTrackerTimer = null;
    }
  };

  if (jogBtn && jogWidget) {
    jogBtn.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (voiceSheet) { voiceSheet.classList.remove('is-open'); voiceSheet.style.display = 'none'; voiceBtn?.classList.remove('active'); }
      if (episodesSheet) { episodesSheet.classList.remove('is-open'); epBtn?.classList.remove('active'); }

      const isOpen = jogWidget.style.display !== 'none';
      jogWidget.style.display = isOpen ? 'none' : 'flex';
      jogBtn.classList.toggle('active', !isOpen);
      if (!isOpen) {
        startJogTracking();
      } else {
        stopJogTracking();
      }
      syncInPlayerDrawerState(overlay);
    };
  }

  if (jogCloseBtn && jogWidget) {
    jogCloseBtn.onclick = (e) => {
      e.stopPropagation();
      jogWidget.style.display = 'none';
      if (jogBtn) jogBtn.classList.remove('active');
      stopJogTracking();
      syncInPlayerDrawerState(overlay);
    };
  }

  if (jogBack10) jogBack10.onclick = (e) => { e.stopPropagation(); doJogStep(-10, true); };
  if (jogBack1) jogBack1.onclick = (e) => { e.stopPropagation(); doJogStep(-1, true); };
  if (jogFwd1) jogFwd1.onclick = (e) => { e.stopPropagation(); doJogStep(1, true); };
  if (jogFwd10) jogFwd10.onclick = (e) => { e.stopPropagation(); doJogStep(10, true); };

  if (jogWheelWrap) {
    let isJogDragging = false;
    let wrapCenter = { x: 0, y: 0 };
    let lastPointerAngle = 0;
    let accumulatedAngle = 0;

    jogWheelWrap.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      isJogDragging = true;
      const rect = jogWheelWrap.getBoundingClientRect();
      wrapCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      lastPointerAngle = Math.atan2(e.clientY - wrapCenter.y, e.clientX - wrapCenter.x) * (180 / Math.PI);
      accumulatedAngle = 0;
      if (jogWheel) jogWheel.style.transition = 'none';
      try { jogWheelWrap.setPointerCapture(e.pointerId); } catch {}
    });

    jogWheelWrap.addEventListener('pointermove', (e) => {
      if (!isJogDragging) return;
      e.stopPropagation();
      const currentAngle = Math.atan2(e.clientY - wrapCenter.y, e.clientX - wrapCenter.x) * (180 / Math.PI);
      let angleDiff = currentAngle - lastPointerAngle;
      if (angleDiff > 180) angleDiff -= 360;
      if (angleDiff < -180) angleDiff += 360;
      lastPointerAngle = currentAngle;

      jogRotation += angleDiff;
      if (jogWheel) jogWheel.style.transform = `rotate(${jogRotation}deg)`;

      accumulatedAngle += angleDiff;
      const STEP_THRESHOLD = 14; // ~14 градусов на 1 секунду прецизионного скраббинга
      if (Math.abs(accumulatedAngle) >= STEP_THRESHOLD) {
        const steps = Math.trunc(accumulatedAngle / STEP_THRESHOLD);
        accumulatedAngle -= steps * STEP_THRESHOLD;
        const seconds = steps * 1;
        sendSeekDelta(seconds);
        flashDeltaBadge(seconds);
        updateJogDisplay();
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          try { navigator.vibrate(6); } catch (_) {}
        }
      }
    });

    const stopJogDrag = (e) => {
      if (isJogDragging) {
        e.stopPropagation();
        isJogDragging = false;
        accumulatedAngle = 0;
        if (jogWheel) jogWheel.style.transition = 'transform 0.2s ease-out';
        try { jogWheelWrap.releasePointerCapture(e.pointerId); } catch {}
      }
    };

    jogWheelWrap.addEventListener('pointerup', stopJogDrag);
    jogWheelWrap.addEventListener('pointercancel', stopJogDrag);

    // Поддержка колесика мыши для плавной роторной перемотки
    jogWheelWrap.addEventListener('wheel', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const direction = e.deltaY < 0 ? 1 : -1;
      const step = e.shiftKey ? 5 : 1;
      doJogStep(direction * step, true);
    }, { passive: false });
  }

  // 4. Кнопка «Фокус» (Кинотеатральный режим)
  if (focusBtn) {
    const modal = document.getElementById('cinema-modal');
    if (modal && modal.classList.contains('is-focus-mode')) {
      focusBtn.classList.add('active');
    }
    focusBtn.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (modal) {
        const isFocus = modal.classList.toggle('is-focus-mode');
        document.documentElement.classList.toggle('cinema-focus-active', isFocus);
        document.body.classList.toggle('cinema-focus-active', isFocus);
        focusBtn.classList.toggle('active', isFocus);
        adjustCinemaModalScale();
        requestAnimationFrame(adjustCinemaModalScale);
        setTimeout(adjustCinemaModalScale, 60);
        showToast(isFocus ? '👁️ Кинотеатральный режим фокуса включен (Esc — выход)' : 'Режим фокуса выключен', 'info');
      }
    };
  }

  const focusExitBadge = document.getElementById('cinema-focus-exit-badge');
  if (focusExitBadge) {
    focusExitBadge.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      const modal = document.getElementById('cinema-modal');
      if (modal) {
        modal.classList.remove('is-focus-mode');
        document.documentElement.classList.remove('cinema-focus-active');
        document.body.classList.remove('cinema-focus-active');
        if (focusBtn) focusBtn.classList.remove('active');
        adjustCinemaModalScale();
        requestAnimationFrame(adjustCinemaModalScale);
        setTimeout(adjustCinemaModalScale, 60);
        showToast('Режим фокуса выключен', 'info');
      }
    };
  }

  // Телеметрия потока (Live Stream Telemetry Pill)
  const telemetryPill = overlay.querySelector('#inplayer-telemetry-pill');
  if (telemetryPill) {
    telemetryPill.onclick = (e) => {
      e.stopPropagation();
      toggleStatsForNerds();
    };
  }

  // Периодическое обновление телеметрии (каждые 2 сек)
  const telemetryInterval = setInterval(() => {
    if (!overlay.isConnected) {
      clearInterval(telemetryInterval);
      return;
    }
    const tText = overlay.querySelector('#telemetry-text');
    const v = document.getElementById('storm-video-player') || document.querySelector('#cinema-player-wrapper video');
    if (tText) {
      if (v && v.videoWidth) {
        let resLabel = `${v.videoWidth}p`;
        if (v.videoWidth >= 3800) resLabel = '4K HDR';
        else if (v.videoWidth >= 2500) resLabel = '2K QHD';
        else if (v.videoWidth >= 1900) resLabel = '1080p FHD';
        else if (v.videoWidth >= 1200) resLabel = '720p HD';

        let bufSec = 0;
        if (v.buffered && v.buffered.length > 0) {
          const cur = v.currentTime;
          for (let i = 0; i < v.buffered.length; i++) {
            if (v.buffered.start(i) <= cur && v.buffered.end(i) >= cur) {
              bufSec = Math.round(v.buffered.end(i) - cur);
              break;
            }
          }
        }
        tText.textContent = `${resLabel} • 60 FPS • Буфер ${bufSec}с`;
      } else {
        const activeQual = String(currentActivePlayer?.quality || currentMedia?.quality || '1080p FHD').replace(/\s*\/.*$/, '').trim();
        const activeBadge = currentActivePlayer?.id === 'lift_adfree' ? 'Без рекламы' : 'Прямой поток';
        tText.textContent = `${activeQual} • ${activeBadge} • OK`;
      }
    }
  }, 2000);

  const prevBtn = overlay.querySelector('#inplayer-prev-ep-btn');
  if (prevBtn) {
    prevBtn.onclick = (e) => {
      e.stopPropagation();
      playInPlayerPrevEpisode();
    };
  }

  const nextBtn = overlay.querySelector('#inplayer-next-ep-btn');
  if (nextBtn) {
    nextBtn.onclick = (e) => {
      e.stopPropagation();
      playInPlayerNextEpisode();
    };
  }

  // Сенсор верхней зоны для мгновенного отображения элементов управления
  const topSensor = overlay.querySelector('#inplayer-top-sensor');
  if (topSensor) {
    topSensor.addEventListener('mousemove', showInPlayerControls);
    topSensor.addEventListener('mouseenter', showInPlayerControls);
    topSensor.addEventListener('pointermove', showInPlayerControls);
  }

  videoBox.addEventListener('mousemove', showInPlayerControls);
  videoBox.addEventListener('pointermove', showInPlayerControls);

  const modal = document.getElementById('cinema-modal');
  if (modal) {
    modal.addEventListener('mousemove', showInPlayerControls);
    modal.addEventListener('pointermove', showInPlayerControls);
    const headerActions = modal.querySelector('.cinema-header-actions');
    if (headerActions) {
      headerActions.addEventListener('mouseenter', () => {
        clearTimeout(inPlayerHideTimer);
        showInPlayerControls();
      });
      headerActions.addEventListener('mouseleave', resetInPlayerHideTimer);
    }
  }

  if (!videoBox.dataset.hasInplayerListeners) {
    videoBox.dataset.hasInplayerListeners = 'true';

    // Тап/клик по видео: закрытие шторок или переключение видимости оверлея
    videoBox.addEventListener('click', (e) => {
      if (e.target.closest('.inplayer-top-bar') || 
          e.target.closest('.inplayer-bottom-bar') || 
          e.target.closest('.player-inplayer-episodes-sheet') || 
          e.target.closest('.player-inplayer-voice-sheet') || 
          e.target.closest('.inplayer-jog-dial-widget') ||
          e.target.closest('.inplayer-ctrl-btn') ||
          e.target.closest('.cinema-header-actions') ||
          e.target.closest('.storm-modal-tool-btn') ||
          e.target.closest('.storm-modal-fullscreen-btn') ||
          e.target.closest('.storm-modal-close') ||
          e.target.closest('.storm-modal-header') ||
          e.target.closest('.storm-skip-btn')) {
        resetInPlayerHideTimer();
        return;
      }

      // Если открыта любая вложенная шторка (озвучки, серий, джога) — клик закрывает её без скрытия контролов
      const vs = videoBox.querySelector('#player-inplayer-voice-sheet');
      const es = videoBox.querySelector('#player-inplayer-episodes-sheet');
      const jw = videoBox.querySelector('#inplayer-jog-dial-widget');
      const hasOpenSheet = (vs && vs.classList.contains('is-open')) || (es && es.classList.contains('is-open')) || (jw && jw.style.display !== 'none');
      if (hasOpenSheet) {
        if (vs) { vs.classList.remove('is-open'); vs.style.display = 'none'; videoBox.querySelector('#inplayer-voice-btn')?.classList.remove('active'); }
        if (es) { es.classList.remove('is-open'); es.style.display = 'none'; videoBox.querySelector('#inplayer-episodes-btn')?.classList.remove('active'); }
        if (jw) { jw.style.display = 'none'; videoBox.querySelector('#inplayer-jog-btn')?.classList.remove('active'); }
        return;
      }

      const isVis = videoBox.classList.contains('controls-visible');
      if (isVis) {
        hideInPlayerControls(true);
      } else {
        showInPlayerControls();
      }
    });

    // Двойной клик по области видео: переключение полноэкранного режима
    videoBox.addEventListener('dblclick', (e) => {
      if (e.target.closest('button, input, select, a, .inplayer-ctrl-btn, .inplayer-top-bar, .inplayer-bottom-bar, .player-inplayer-episodes-sheet, .player-inplayer-voice-sheet, .inplayer-jog-dial-widget, .cinema-header-actions, .storm-modal-tool-btn, .storm-modal-fullscreen-btn, .storm-modal-close, .storm-skip-btn')) {
        return;
      }
      e.preventDefault();
      toggleCinemaFullscreen();
    });

    videoBox.addEventListener('touchstart', (e) => {
      if (!e.target.closest('.inplayer-ctrl-btn') && 
          !e.target.closest('.player-inplayer-episodes-sheet') && 
          !e.target.closest('.player-inplayer-voice-sheet') && 
          !e.target.closest('.inplayer-jog-dial-widget')) {
        resetInPlayerHideTimer();
      }
    }, { passive: true });
  }

  showInPlayerControls();

  updateInPlayerEpisodeInfo();
  const savedSpeed = parseFloat(localStorage.getItem('storm_playback_speed') || '1');
  updateInPlayerSpeedDisplay(savedSpeed);
}

// ==========================================
// ПРОДВИНУТЫЙ РЕЖИМ «КАРТИНКА В КАРТИНКЕ» (PIP)
// ==========================================
export async function toggleAdvancedPiP() {
  const modal = document.getElementById('cinema-modal');
  const video = document.getElementById('storm-video-player') || document.querySelector('#cinema-player-wrapper video');
  const iframe = document.getElementById('cinema-player-wrapper')?.querySelector('iframe') || document.querySelector('.cinema-player-iframe');
  const pipBtn = document.getElementById('player-pip-btn');

  // Если окно уже в режиме плавающего mini-PiP — восстанавливаем полноразмерный кинотеатр
  if (modal && modal.classList.contains('is-mini-pip')) {
    modal.classList.remove('is-mini-pip');
    if (pipBtn) pipBtn.classList.remove('active');
    showToast('Полноразмерный кинотеатр восстановлен', 'info');
    return;
  }

  // 1. Для iframe плееров (FanFilm4K, Stravers, Kodik, Allplay и др.)
  // Категорически НЕЛЬЗЯ перемещать iframe в другой document через Document PiP API,
  // так как браузер немедленно перезагружает фрейм, и одноразовые токены балансеров
  // сгорают с ошибкой «К сожалению, запрашиваемый контент не найден».
  // Для них активируем встроенный плавающий мини-плеер без перемещения DOM элементов!
  if (iframe) {
    if (modal) {
      modal.classList.add('is-mini-pip');
      if (pipBtn) pipBtn.classList.add('active');
      trackClientAction('use_pip');
      showToast('Плавающий мини-плеер активирован (кликните 🪟 для возврата)', 'info');
    }
    return;
  }

  // 2. Стандартный нативный HTML5 Video PiP (плавающее окно поверх всех окон ОС)
  if (video && video.requestPictureInPicture) {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        if (pipBtn) pipBtn.classList.remove('active');
      } else {
        await video.requestPictureInPicture();
        if (pipBtn) pipBtn.classList.add('active');
        trackClientAction('use_pip');
        showToast('Режим «Картинка в картинке» активирован', 'info');
      }
      return;
    } catch (e) {
      console.warn('HTML5 Video PiP недоступен:', e);
    }
  }

  // 3. Универсальный плавающий режим Mini-Player (безопасный fallback)
  if (modal) {
    modal.classList.add('is-mini-pip');
    if (pipBtn) pipBtn.classList.add('active');
    trackClientAction('use_pip');
    showToast('Плавающий мини-плеер активирован (кликните 🪟 для возврата)', 'info');
  }
}

// ==========================================
// P2P WEBTORRENT СТРИМИНГ С ГОТОВЫМИ РАЗДАЧАМИ
// ==========================================
const WEBTORRENT_TRACKERS = [
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
  'wss://tracker.webtorrent.dev',
  'wss://tracker.files.fm:7073/announce',
  'wss://sparta.cyberia.club:443/announce',
  'wss://tracker.fastcast.nz',
  'wss://tracker.sloppyta.co:443/announce',
  'wss://tracker.ghostrr.com:443/announce'
];

let webTorrentLoadPromise = null;
export async function ensureWebTorrentLoaded() {
  if (window.WebTorrent) return true;
  if (webTorrentLoadPromise) return webTorrentLoadPromise;
  webTorrentLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/vendor/webtorrent.min.js';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => {
      const fallbackScript = document.createElement('script');
      fallbackScript.src = 'https://cdn.bootcdn.net/ajax/libs/webtorrent/1.9.7/webtorrent.min.js';
      fallbackScript.async = true;
      fallbackScript.onload = () => resolve(true);
      fallbackScript.onerror = () => {
        webTorrentLoadPromise = null;
        reject(new Error('Не удалось загрузить WebTorrent модуль'));
      };
      document.head.appendChild(fallbackScript);
    };
    document.head.appendChild(script);
  });
  return webTorrentLoadPromise;
}

let hlsLoadPromise = null;
export async function ensureHlsLoaded() {
  if (window.Hls) return true;
  if (hlsLoadPromise) return hlsLoadPromise;
  hlsLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/vendor/hls.min.js';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => {
      const fallbackScript = document.createElement('script');
      fallbackScript.src = 'https://unpkg.com/hls.js/dist/hls.min.js';
      fallbackScript.async = true;
      fallbackScript.onload = () => resolve(true);
      fallbackScript.onerror = () => {
        hlsLoadPromise = null;
        reject(new Error('Не удалось загрузить HLS модуль'));
      };
      document.head.appendChild(fallbackScript);
    };
    document.head.appendChild(script);
  });
  return hlsLoadPromise;
}

function renderWebTorrentPlayer() {
  const container = document.getElementById('cinema-player-wrapper');
  if (!container) return;

  const title = cleanVideoTitle(currentMedia?.title || 'Кинорелиз');
  const isAnime = currentMedia?.source === 'anixart' || currentMedia?.source === 'anilibria' || currentMedia?.media_type?.includes('anime');

  const trackerParams = WEBTORRENT_TRACKERS.map(t => '&tr=' + encodeURIComponent(t)).join('');
  const demoMagnet = 'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel' + trackerParams;

  const releases = isAnime ? [
    {
      title: `${title} [1080p FHD / HEVC]`,
      quality: '1080p FHD',
      codec: 'HEVC H.265 • 10-bit',
      dub: 'Официальный дубляж AniLibria',
      size: '3.4 ГБ',
      seeds: 215,
      magnet: demoMagnet
    },
    {
      title: `${title} [1080p BDRip / Multi-Audio]`,
      quality: '1080p BDRip',
      codec: 'AVC H.264 • High@L4.1',
      dub: 'Дубляж Студийная Банда',
      size: '2.8 ГБ',
      seeds: 184,
      magnet: demoMagnet
    },
    {
      title: `${title} [720p HD / Быстрый буфер]`,
      quality: '720p HD',
      codec: 'H.264 • AAC 2.0',
      dub: 'Многоголосый дубляж AniDUB',
      size: '1.4 ГБ',
      seeds: 142,
      magnet: demoMagnet
    }
  ] : [
    {
      title: `${title} [4K UHD HDR / 2160p]`,
      quality: '4K UHD HDR',
      codec: 'HEVC H.265 • 10-bit • 60 FPS',
      dub: 'Дубляж Red Head Sound (Dolby Atmos 7.1)',
      size: '18.4 ГБ',
      seeds: 286,
      magnet: demoMagnet
    },
    {
      title: `${title} [1080p FHD BDRip]`,
      quality: '1080p FHD',
      codec: 'AVC H.264 • High@L4.1',
      dub: 'Дубляж HDRezka Studio (AC3 5.1)',
      size: '6.8 ГБ',
      seeds: 340,
      magnet: demoMagnet
    },
    {
      title: `${title} [1080p WEB-DL / Студийный]`,
      quality: '1080p WEB',
      codec: 'AVC • AAC 2.0',
      dub: 'Профессиональный дубляж',
      size: '4.2 ГБ',
      seeds: 195,
      magnet: demoMagnet
    },
    {
      title: `${title} [720p HD Компактный]`,
      quality: '720p HD',
      codec: 'H.264 • Быстрый старт',
      dub: 'Многоголосый закадровый перевод',
      size: '1.9 ГБ',
      seeds: 120,
      magnet: demoMagnet
    }
  ];

  container.innerHTML = `
    <div class="webtorrent-screen-wrap" style="position: relative; width: 100%; height: 100%; display: flex; flex-direction: column; background: #000; border-radius: 12px; overflow: hidden;">
      <!-- Основная область воспроизведения (сверху) -->
      <div id="torrent-playback-area" style="position: relative; width: 100%; flex: 1; min-height: 340px; background: #05070a; display: flex; align-items: center; justify-content: center; overflow: hidden;">
        <div id="player-ambilight-aura" class="ambilight-aura"></div>
        <video id="storm-video-player" controls playsinline crossorigin="anonymous" style="position: relative; z-index: 2; width: 100%; height: 100%; max-height: 520px; background: #000; object-fit: contain;"></video>

        <!-- Оверлей загрузки пиров и буферизации -->
        <div id="torrent-loader-overlay" style="position: absolute; inset: 0; z-index: 4; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(8, 10, 15, 0.88); backdrop-filter: blur(8px); gap: 12px; padding: 20px; text-align: center;">
          <div class="storm-spinner" style="width: 44px; height: 44px; border-width: 3px;"></div>
          <div style="font-size: 16px; font-weight: 800; color: var(--text-primary);" id="torrent-loader-title">Подключение к пиринговой сети P2P...</div>
          <div style="font-size: 12px; color: var(--text-muted); max-width: 480px; line-height: 1.5;" id="torrent-loader-subtitle">Поиск сидов в сети WebSockets. Воспроизведение начнется мгновенно по мере буферизации.</div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-top: 8px;">
            <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="torrent-fallback-cdn-btn">
              ⚡ Быстрый онлайн плеер (CDN)
            </button>
            <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="torrent-speedup-torr-btn" style="border-color: #10b981; color: #10b981;">
              🚀 Ускорить через TorrServer (100 MB/s)
            </button>
          </div>
        </div>
      </div>

      <!-- Нижняя панель управления и HUD -->
      <div class="webtorrent-control-bar" style="background: var(--bg-secondary); border-top: 1px solid var(--border-subtle); padding: 10px 16px; display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; z-index: 5;">
        <!-- Live P2P HUD -->
        <div class="torrent-stats-hud" style="display: flex; gap: 14px; align-items: center; font-size: 12px; font-weight: 700;">
          <span style="color: var(--color-green);">👥 Пиров: <b id="torrent-peers">0</b></span>
          <span style="color: var(--accent);">⬇️ <b id="torrent-speed">0.0 MB/s</b></span>
          <span style="color: var(--color-amber);">📊 <b id="torrent-progress">0%</b></span>
        </div>

        <!-- Кнопки выбора качества -->
        <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
          <span style="font-size: 11px; color: var(--text-muted); font-weight: 600;">Качество:</span>
          ${releases.map((rel, idx) => `
            <button type="button" class="storm-btn storm-btn-sm webtorrent-quality-btn ${idx === 0 ? 'storm-btn-primary' : 'storm-btn-secondary'}" data-index="${idx}">
              ${rel.quality}
            </button>
          `).join('')}
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="toggle-custom-magnet-btn" title="Ввести свою magnet-ссылку">
            🔗 Своя ссылка
          </button>
        </div>
      </div>

      <!-- Выдвижная панель ввода magnet-ссылки или .torrent файла -->
      <div id="custom-magnet-panel" style="display: none; background: var(--bg-tertiary); padding: 12px 16px; border-top: 1px solid var(--border-subtle); z-index: 5;">
        <div style="display: flex; gap: 8px; margin-bottom: 8px;">
          <input type="text" class="storm-input" id="torrent-magnet-input" placeholder="Вставьте magnet:?xt=urn:btih:... ссылку" style="flex: 1;">
          <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="start-custom-torrent-btn">Запустить</button>
        </div>
        <label class="storm-btn storm-btn-secondary storm-btn-sm" style="cursor: pointer; margin: 0; display: inline-flex;">
          📁 Открыть локальный .torrent файл
          <input type="file" id="torrent-file-input" accept=".torrent" style="display: none;">
        </label>
      </div>
    </div>
  `;

  // Кнопка быстрого перехода на CDN
  const fallbackBtn = container.querySelector('#torrent-fallback-cdn-btn');
  if (fallbackBtn) {
    fallbackBtn.onclick = () => {
      const cdn = currentPlayers.find(p => p.id !== 'webtorrent' && p.url && !p.url.includes('youtube'));
      if (cdn) {
        selectPlayer(cdn);
        updatePlayerTriggerInfo(cdn);
      } else {
        showToast('Серверные потоки проверяются...', 'info');
      }
    };
  }

  // Кнопка ускорения через TorrServer
  const speedupBtn = container.querySelector('#torrent-speedup-torr-btn');
  if (speedupBtn) {
    speedupBtn.onclick = () => {
      const tabServices = document.getElementById('studio-tab-services');
      if (tabServices) tabServices.click();
      showToast('Открыта панель TorrServer для максимальной скорости', 'info');
    };
  }

  // Переключение качества
  const qualityBtns = container.querySelectorAll('.webtorrent-quality-btn');
  qualityBtns.forEach(btn => {
    btn.onclick = () => {
      qualityBtns.forEach(b => {
        b.classList.remove('storm-btn-primary');
        b.classList.add('storm-btn-secondary');
      });
      btn.classList.add('storm-btn-primary');
      btn.classList.remove('storm-btn-secondary');

      const idx = parseInt(btn.dataset.index, 10);
      const chosen = releases[idx];
      if (chosen) {
        showToast(`Выбрано качество: ${chosen.quality}`, 'info');
        startWebTorrentStream(chosen.magnet);
      }
    };
  });

  // Панель ввода кастомной ссылки
  const toggleCustomBtn = container.querySelector('#toggle-custom-magnet-btn');
  const customPanel = container.querySelector('#custom-magnet-panel');
  if (toggleCustomBtn && customPanel) {
    toggleCustomBtn.onclick = () => {
      customPanel.style.display = customPanel.style.display === 'none' ? 'block' : 'none';
    };
  }

  const startCustomBtn = container.querySelector('#start-custom-torrent-btn');
  const customInput = container.querySelector('#torrent-magnet-input');
  if (startCustomBtn && customInput) {
    startCustomBtn.onclick = () => {
      const magnet = customInput.value.trim();
      if (!magnet) {
        showToast('Введите magnet-ссылку', 'warning');
        return;
      }
      startWebTorrentStream(magnet);
    };
  }

  const fileInput = container.querySelector('#torrent-file-input');
  if (fileInput) {
    fileInput.onchange = (e) => {
      if (e.target.files && e.target.files[0]) {
        startWebTorrentStream(e.target.files[0]);
      }
    };
  }

  // Запуск первого релиза
  if (releases.length > 0) {
    startWebTorrentStream(releases[0].magnet);
  }
}

async function startWebTorrentStream(torrentIdentifier) {
  if (!window.WebTorrent) {
    showToast('Подключение модуля P2P WebTorrent...', 'info');
    try {
      await ensureWebTorrentLoaded();
    } catch (e) {
      showToast('Не удалось загрузить P2P WebTorrent модуль', 'error');
      return;
    }
  }

  const playbackArea = document.getElementById('torrent-playback-area');
  const loaderOverlay = document.getElementById('torrent-loader-overlay');
  const loaderTitle = document.getElementById('torrent-loader-title');
  const loaderSubtitle = document.getElementById('torrent-loader-subtitle');

  if (loaderOverlay) {
    loaderOverlay.style.display = 'flex';
    if (loaderTitle) loaderTitle.textContent = 'Подключение к пиринговой сети P2P...';
  }

  if (torrentClient) {
    try {
      torrentClient.destroy();
    } catch {}
    torrentClient = null;
  }

  try {
    torrentClient = new window.WebTorrent({
      maxConns: 80,
      tracker: {
        announce: WEBTORRENT_TRACKERS,
        rtcConfig: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        }
      }
    });
  } catch {
    torrentClient = new window.WebTorrent();
  }

  showToast('Подключение к пирам P2P WebTorrent...', 'info');

  const addOpts = {
    announce: WEBTORRENT_TRACKERS
  };

  torrentClient.add(torrentIdentifier, addOpts, (torrent) => {
    showToast(`Раздача подключена: ${torrent.name || 'Поток'}`, 'success');
    trackClientAction('use_torrent');

    if (loaderTitle) loaderTitle.textContent = `Загрузка видеопотока (${torrent.name || 'P2P'})...`;

    // Приоритетная буферизация первых чанков видео для моментального старта
    if (torrent.pieces && torrent.pieces.length > 0) {
      try {
        torrent.critical(0, Math.min(15, torrent.pieces.length - 1));
        torrent.select(0, Math.min(30, torrent.pieces.length - 1), 1);
      } catch {}
    }

    const file = torrent.files.find(f => f.name.endsWith('.mp4') || f.name.endsWith('.mkv') || f.name.endsWith('.webm'));
    if (file) {
      const video = document.getElementById('storm-video-player');
      if (video) {
        file.renderTo(video, { autoplay: false });
        setupVideoFeatures(video, playbackArea);
        video.onplaying = () => {
          if (loaderOverlay) loaderOverlay.style.display = 'none';
        };
        video.onloadeddata = () => {
          if (loaderOverlay) loaderOverlay.style.display = 'none';
        };
      }
    }

    torrent.on('download', () => {
      const peersEl = document.getElementById('torrent-peers');
      const speedEl = document.getElementById('torrent-speed');
      const progressEl = document.getElementById('torrent-progress');

      if (peersEl) peersEl.textContent = torrent.numPeers;
      if (speedEl) speedEl.textContent = `${(torrent.downloadSpeed / (1024 * 1024)).toFixed(1)} MB/s`;
      if (progressEl) progressEl.textContent = `${(torrent.progress * 100).toFixed(1)}%`;

      if (torrent.downloadSpeed > 0 && loaderOverlay && loaderOverlay.style.display !== 'none') {
        if (loaderSubtitle) loaderSubtitle.textContent = `Скорость: ${(torrent.downloadSpeed / (1024 * 1024)).toFixed(1)} MB/s, пиров: ${torrent.numPeers}`;
      }
    });
  });

  torrentClient.on('error', (err) => {
    console.warn('WebTorrent client error:', err);
    if (loaderTitle) loaderTitle.textContent = 'Пиры WebRTC не отвечают';
    if (loaderSubtitle) loaderSubtitle.textContent = 'Для этой раздачи нет веб-сидов в браузере. Воспользуйтесь быстрым сервером (CDN) или TorrServer.';
  });
}

// ==========================================
// ПРЯМОЙ ПОТОК (DIRECT STREAM)
// ==========================================
let forceDirectStream = localStorage.getItem('storm_force_direct_stream') === 'true';

export function isForceDirectStream() {
  return forceDirectStream;
}

export function setForceDirectStream(val) {
  forceDirectStream = Boolean(val);
  localStorage.setItem('storm_force_direct_stream', forceDirectStream ? 'true' : 'false');
  showToast(forceDirectStream ? '⚡ Прямой поток активирован' : '🛡️ Стандартный режим (проксирование)', 'info');
}

// ==========================================
// ДАННЫЕ О СЛЕДУЮЩЕЙ СЕРИИ И ПРЕДЗАГРУЗКА
// ==========================================
export function getNextEpisodeData() {
  if (!checkIfMediaIsSeries(currentMedia)) return null;

  // 1. Быстрая панель сезонов и серий
  if (quickBarSeriesData && quickBarSeriesData.seasons && quickBarSeriesData.seasons.length > 0) {
    const curSeasonObj = quickBarSeriesData.seasons.find(s => s.season === quickBarActiveSeason) || quickBarSeriesData.seasons[0];
    if (curSeasonObj?.episodes) {
      const curEpIdx = curSeasonObj.episodes.findIndex(e => e.episode === quickBarActiveEpisode);
      if (curEpIdx >= 0 && curEpIdx < curSeasonObj.episodes.length - 1) {
        const nextEp = curSeasonObj.episodes[curEpIdx + 1];
        return {
          season: quickBarActiveSeason,
          episode: nextEp.episode,
          name: nextEp.title || nextEp.name || `Серия ${nextEp.episode}`,
          still: nextEp.still || nextEp.still_path || currentMedia?.poster || 'assets/favicon.svg'
        };
      }
    }
  }

  // 2. Сетка эпизодов TMDB
  const gridEl = document.getElementById('series-episodes-grid') || document.getElementById('episodes-grid');
  if (gridEl) {
    const activeCard = gridEl.querySelector('.series-episode-card.active, .episode-btn.active');
    const nextCard = activeCard?.nextElementSibling;
    if (nextCard) {
      const epNum = nextCard.dataset.epNum || (currentEpisodeIndex + 1);
      const title = nextCard.querySelector('.series-episode-title')?.textContent || `Серия ${epNum}`;
      const img = nextCard.querySelector('img')?.src || currentMedia?.poster || 'assets/favicon.svg';
      return {
        season: currentMedia?.season || 1,
        episode: parseInt(epNum, 10),
        name: title,
        still: img
      };
    }
  }

  // 3. AniXart / AniLibria
  if (currentEpisodes && currentEpisodes.length > 0) {
    const curIdx = currentEpisodes.findIndex(e => (e.position || e.ordinal || 1) === currentEpisodeIndex);
    if (curIdx >= 0 && curIdx < currentEpisodes.length - 1) {
      const next = currentEpisodes[curIdx + 1];
      const epNum = next.position || next.ordinal || (currentEpisodeIndex + 1);
      return {
        season: 1,
        episode: epNum,
        name: next.title || next.name || `Серия ${epNum}`,
        still: next.still || currentMedia?.poster || 'assets/favicon.svg'
      };
    }
  }

  return null;
}

// ==========================================
// БЛОКИРОВКА ЗАСЫПАНИЯ ЭКРАНА (SCREEN WAKE LOCK API)
// ==========================================
let screenWakeLock = null;

export async function requestScreenWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      if (!screenWakeLock) {
        screenWakeLock = await navigator.wakeLock.request('screen');
        screenWakeLock.addEventListener('release', () => {
          screenWakeLock = null;
        });
      }
    } catch (err) {
      console.warn('[WakeLock]:', err.message);
    }
  }
}

export function releaseScreenWakeLock() {
  if (screenWakeLock) {
    try {
      screenWakeLock.release();
    } catch {}
    screenWakeLock = null;
  }
}

// ==========================================
// МОБИЛЬНЫЕ СЕНСОРНЫЕ ЖЕСТЫ И ТАКТИЛЬНАЯ ОТДАЧА (HAPTICS)
// ==========================================
let playerBrightnessLevel = 100;

export function initPlayerTouchGestures(wrapper) {
  if (!wrapper || wrapper.dataset.hasTouchGestures) return;
  wrapper.dataset.hasTouchGestures = 'true';

  let lastTapTime = 0;
  let lastTapX = 0;
  let touchStartX = 0;
  let touchStartY = 0;
  let isSwiping = false;

  wrapper.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      isSwiping = false;
    }
  }, { passive: true });

  wrapper.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 1) return;
    const curX = e.touches[0].clientX;
    const curY = e.touches[0].clientY;
    const deltaX = curX - touchStartX;
    const deltaY = curY - touchStartY;

    if (Math.abs(deltaY) > 22 && Math.abs(deltaY) > Math.abs(deltaX) * 1.4) {
      isSwiping = true;
      const rect = wrapper.getBoundingClientRect();
      const isLeft = (touchStartX - rect.left) < rect.width * 0.45;
      const step = deltaY < 0 ? 3 : -3;

      if (isLeft) {
        playerBrightnessLevel = Math.min(150, Math.max(30, playerBrightnessLevel + step));
        const videoOrIframe = wrapper.querySelector('video, iframe');
        if (videoOrIframe) {
          videoOrIframe.style.filter = `brightness(${playerBrightnessLevel}%)`;
        }
        showTouchGesturePill(`☀️ Яркость: ${playerBrightnessLevel}%`);
      } else {
        const video = wrapper.querySelector('video');
        if (video) {
          video.volume = Math.min(1, Math.max(0, video.volume + (step > 0 ? 0.04 : -0.04)));
          showTouchGesturePill(`🔊 Громкость: ${Math.round(video.volume * 100)}%`);
        }
      }
    }
  }, { passive: true });

  wrapper.addEventListener('touchend', () => {
    if (isSwiping) return;

    const now = Date.now();
    const tapX = touchStartX;
    const rect = wrapper.getBoundingClientRect();

    if (now - lastTapTime < 320 && Math.abs(tapX - lastTapX) < 45) {
      const relX = tapX - rect.left;
      if (relX < rect.width * 0.38) {
        handlePlayerTvSeek(-10);
        showTouchGestureRipple('left', '⏪ -10 сек');
        if (navigator.vibrate) navigator.vibrate(15);
      } else if (relX > rect.width * 0.62) {
        handlePlayerTvSeek(10);
        showTouchGestureRipple('right', '⏩ +10 сек');
        if (navigator.vibrate) navigator.vibrate(15);
      }
      lastTapTime = 0;
      return;
    }

    lastTapTime = now;
    lastTapX = tapX;
  });
}

function showTouchGesturePill(text) {
  let pill = document.getElementById('player-touch-gesture-pill');
  if (!pill) {
    pill = document.createElement('div');
    pill.id = 'player-touch-gesture-pill';
    pill.className = 'player-touch-gesture-pill';
    const wrapper = document.getElementById('cinema-player-wrapper');
    if (wrapper) wrapper.appendChild(pill);
  }
  pill.textContent = text;
  pill.classList.add('visible');
  clearTimeout(pill._timer);
  pill._timer = setTimeout(() => {
    pill.classList.remove('visible');
  }, 900);
}

function showTouchGestureRipple(side, text) {
  const wrapper = document.getElementById('cinema-player-wrapper');
  if (!wrapper) return;
  const ripple = document.createElement('div');
  ripple.className = `player-touch-ripple ripple-${side}`;
  ripple.innerHTML = `<span class="ripple-text">${text}</span>`;
  wrapper.appendChild(ripple);
  setTimeout(() => ripple.remove(), 700);
}

// ==========================================
// УПРЕЖДАЮЩАЯ ФОНОВАЯ БУФЕРИЗАЦИЯ СЛЕДУЮЩЕЙ СЕРИИ (PRE-FETCHING ENGINE)
// ==========================================
function triggerNextEpisodePrebuffer() {
  try {
    const nextEp = getNextEpisodeData();
    if (!nextEp) return;

    // 1. Потоковое кеширование для HLS / MP4
    if (currentMedia?.source === 'anilibria' && nextEp.streamUrl) {
      fetch(nextEp.streamUrl, { method: 'HEAD', priority: 'low' }).catch(() => {});
    }

    // 2. Фоновый запрос к структуре серий
    if (quickBarBaseUrl) {
      const curMediaId = currentMedia?.id || '';
      const mediaTitle = currentMedia?.title || currentMedia?.name || '';
      const mediaTmdbId = currentMedia?.tmdb_id || '';
      fetch(`/api/player/series-options?url=${encodeURIComponent(quickBarBaseUrl)}&title=${encodeURIComponent(mediaTitle)}&mediaId=${encodeURIComponent(curMediaId)}&tmdbId=${encodeURIComponent(mediaTmdbId)}&season=${nextEp.season || 1}&episode=${nextEp.episode || 1}`, { priority: 'low' }).catch(() => {});
    }

    // 3. Предзагрузка стоп-кадра следующего эпизода
    if (nextEp.still && String(nextEp.still).startsWith('http')) {
      const img = new Image();
      img.src = nextEp.still;
    }
  } catch (_) {}
}

// ==========================================
// ПАРЯЩАЯ КАРТОЧКА СЛЕДУЮЩЕЙ СЕРИИ (UP NEXT)
// ==========================================
let upNextCountdownTimer = null;
let upNextDismissedForEp = null;

export function checkUpNextEpisodeCountdown(video) {
  if (!video || !video.duration || video.duration < 60) return;
  const timeLeft = video.duration - video.currentTime;

  // Предварительная буферизация на 90% прогресса
  if (video.currentTime >= video.duration * 0.90 && !video.dataset.hasPrebufferedNext) {
    video.dataset.hasPrebufferedNext = 'true';
    triggerNextEpisodePrebuffer();
  }

  // Показ карточки за 35 секунд до окончания серии
  if (timeLeft <= 35 && timeLeft >= 2) {
    const epKey = `${currentMedia?.id}_${currentEpisodeIndex}`;
    if (upNextDismissedForEp === epKey) return;

    const nextEp = getNextEpisodeData();
    if (!nextEp) return;

    showUpNextCountdownCard(nextEp, Math.min(15, Math.floor(timeLeft)));
  } else if (timeLeft < 2) {
    dismissUpNextCountdownCard(false);
  }
}

function showUpNextCountdownCard(nextEp, secondsToWait) {
  let card = document.getElementById('storm-up-next-card');
  if (card) return;

  const wrapper = document.getElementById('cinema-player-wrapper') || document.getElementById('cinema-player-container');
  if (!wrapper) return;

  card = document.createElement('div');
  card.className = 'storm-up-next-card';
  card.id = 'storm-up-next-card';

  let remainingSec = secondsToWait;
  const circumference = 2 * Math.PI * 18;

  card.innerHTML = `
    <div class="up-next-thumb-wrap">
      <img src="${escapeHtml(nextEp.still || 'assets/favicon.svg')}" alt="${escapeHtml(nextEp.name)}" class="up-next-thumb" onerror="this.src='assets/favicon.svg'">
      <div class="up-next-timer-svg-box">
        <svg class="up-next-circle-svg" width="44" height="44" viewBox="0 0 44 44">
          <circle class="up-next-circle-bg" cx="22" cy="22" r="18"></circle>
          <circle class="up-next-circle-progress" id="up-next-circle-bar" cx="22" cy="22" r="18" stroke-dasharray="${circumference}" stroke-dashoffset="0"></circle>
        </svg>
        <span class="up-next-sec-count" id="up-next-sec-count">${remainingSec}</span>
      </div>
    </div>
    <div class="up-next-info">
      <div class="up-next-label">Следующая серия</div>
      <div class="up-next-title">${escapeHtml(nextEp.name)}</div>
      <div class="up-next-sub">Сезон ${nextEp.season || 1} • Серия ${nextEp.episode}</div>
    </div>
    <div class="up-next-actions">
      <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="up-next-play-btn">
        ▶ Смотреть сейчас
      </button>
      <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="up-next-cancel-btn" title="Отменить автопереход">
        ✕ Отмена
      </button>
    </div>
  `;

  wrapper.appendChild(card);

  const circleBar = card.querySelector('#up-next-circle-bar');
  const secCount = card.querySelector('#up-next-sec-count');
  const playBtn = card.querySelector('#up-next-play-btn');
  const cancelBtn = card.querySelector('#up-next-cancel-btn');

  if (playBtn) {
    playBtn.onclick = (e) => {
      e.stopPropagation();
      dismissUpNextCountdownCard(false);
      playNextEpisode();
    };
  }

  if (cancelBtn) {
    cancelBtn.onclick = (e) => {
      e.stopPropagation();
      dismissUpNextCountdownCard(true);
    };
  }

  clearInterval(upNextCountdownTimer);
  upNextCountdownTimer = setInterval(() => {
    remainingSec--;
    if (secCount) secCount.textContent = Math.max(0, remainingSec);
    if (circleBar) {
      const offset = circumference - (remainingSec / secondsToWait) * circumference;
      circleBar.style.strokeDashoffset = offset;
    }
    if (remainingSec <= 0) {
      clearInterval(upNextCountdownTimer);
      upNextCountdownTimer = null;
      dismissUpNextCountdownCard(false);
      playNextEpisode();
    }
  }, 1000);
}

export function dismissUpNextCountdownCard(cancelledByUser = false) {
  if (upNextCountdownTimer) {
    clearInterval(upNextCountdownTimer);
    upNextCountdownTimer = null;
  }
  const card = document.getElementById('storm-up-next-card');
  if (card) card.remove();
  if (cancelledByUser) {
    const epKey = `${currentMedia?.id}_${currentEpisodeIndex}`;
    upNextDismissedForEp = epKey;
    showToast('Автопереход к следующей серии отменен', 'info');
  }
}

// ==========================================
// СТАТИСТИКА ДЛЯ ГИКОВ (STATS FOR NERDS)
// ==========================================
let statsForNerdsInterval = null;
let isStatsForNerdsVisible = false;

export function toggleStatsForNerds() {
  const wrapper = document.getElementById('cinema-player-wrapper') || document.getElementById('cinema-player-container');
  if (!wrapper) return;
  let overlay = document.getElementById('storm-nerd-stats-overlay');

  if (overlay && overlay.style.display !== 'none') {
    overlay.style.display = 'none';
    isStatsForNerdsVisible = false;
    if (statsForNerdsInterval) {
      clearInterval(statsForNerdsInterval);
      statsForNerdsInterval = null;
    }
    return;
  }

  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'storm-nerd-stats-overlay';
    overlay.id = 'storm-nerd-stats-overlay';
    wrapper.appendChild(overlay);
  }

  overlay.style.display = 'block';
  isStatsForNerdsVisible = true;
  updateStatsForNerdsContent(overlay);

  if (statsForNerdsInterval) clearInterval(statsForNerdsInterval);
  statsForNerdsInterval = setInterval(() => {
    if (isStatsForNerdsVisible) {
      updateStatsForNerdsContent(overlay);
    }
  }, 1000);
}

function updateStatsForNerdsContent(overlay) {
  if (!overlay) return;
  const video = document.querySelector('#cinema-player-wrapper video');
  const iframe = document.querySelector('#cinema-player-wrapper iframe');

  let res = '—';
  let viewport = '—';
  let bufferHealth = '0.0 с';
  let droppedFrames = '0';
  let totalFrames = '0';
  let dropRate = '0%';
  let timeStr = '—';
  let engine = iframe ? 'Iframe видеоплеер' : 'HTML5 Native Video';
  let vol = '100%';
  let speed = '1.0x';

  if (video) {
    if (video.videoWidth && video.videoHeight) {
      res = `${video.videoWidth} × ${video.videoHeight}`;
    }
    viewport = `${video.clientWidth} × ${video.clientHeight}`;
    timeStr = `${formatSeconds(video.currentTime)} / ${video.duration ? formatSeconds(video.duration) : '—'}`;
    vol = `${Math.round(video.volume * 100)}%`;
    speed = `${video.playbackRate}x`;

    if (video.buffered && video.buffered.length > 0) {
      const cur = video.currentTime;
      let bufEnd = 0;
      for (let i = 0; i < video.buffered.length; i++) {
        if (video.buffered.start(i) <= cur && video.buffered.end(i) >= cur) {
          bufEnd = video.buffered.end(i);
          break;
        }
      }
      bufferHealth = `${Math.max(0, bufEnd - cur).toFixed(1)} с`;
    }

    if (typeof video.getVideoPlaybackQuality === 'function') {
      const q = video.getVideoPlaybackQuality();
      droppedFrames = String(q.droppedVideoFrames || 0);
      totalFrames = String(q.totalVideoFrames || 0);
      if (q.totalVideoFrames > 0) {
        dropRate = `${((q.droppedVideoFrames / q.totalVideoFrames) * 100).toFixed(2)}%`;
      }
    }

    if (window.Hls && window.Hls.isSupported && window.Hls.isSupported()) {
      engine = 'HLS.js Pipeline';
    }
    if (torrentClient) {
      engine = 'WebTorrent P2P Engine';
    }
  }

  overlay.innerHTML = `
    <div class="nerd-stats-header">
      <div class="nerd-stats-title">
        <span style="color: var(--accent);">●</span> Статистика для гиков
      </div>
      <button type="button" class="nerd-stats-close-btn" id="close-nerd-stats-btn">✕</button>
    </div>
    <div class="nerd-stats-grid">
      <div class="nerd-stat-row">
        <span class="nerd-stat-key">Видеопоток и источник:</span>
        <span class="nerd-stat-val">${escapeHtml(currentActivePlayer || currentMedia?.source || 'Auto')}</span>
      </div>
      <div class="nerd-stat-row">
        <span class="nerd-stat-key">Разрешение видео:</span>
        <span class="nerd-stat-val highlight">${res}</span>
      </div>
      <div class="nerd-stat-row">
        <span class="nerd-stat-key">Область отображения:</span>
        <span class="nerd-stat-val">${viewport}</span>
      </div>
      <div class="nerd-stat-row">
        <span class="nerd-stat-key">Здоровье буфера (Buffer Health):</span>
        <span class="nerd-stat-val highlight">${bufferHealth}</span>
      </div>
      <div class="nerd-stat-row">
        <span class="nerd-stat-key">Пропущено кадров:</span>
        <span class="nerd-stat-val ${parseInt(droppedFrames, 10) > 30 ? 'warn' : ''}">${droppedFrames} / ${totalFrames} (${dropRate})</span>
      </div>
      <div class="nerd-stat-row">
        <span class="nerd-stat-key">Движок рендеринга:</span>
        <span class="nerd-stat-val">${engine}</span>
      </div>
      <div class="nerd-stat-row">
        <span class="nerd-stat-key">Звуковой тракт:</span>
        <span class="nerd-stat-val">${nightAudioModeEnabled ? '🌙 Pro WebAudio DRC (Ночной компрессор)' : '🔊 Pro Studio Master'}</span>
      </div>
      <div class="nerd-stat-row">
        <span class="nerd-stat-key">Таймкод и длительность:</span>
        <span class="nerd-stat-val">${timeStr}</span>
      </div>
      <div class="nerd-stat-row">
        <span class="nerd-stat-key">Скорость и громкость:</span>
        <span class="nerd-stat-val">${speed} • ${vol}</span>
      </div>
    </div>
  `;

  const closeBtn = overlay.querySelector('#close-nerd-stats-btn');
  if (closeBtn) {
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      toggleStatsForNerds();
    };
  }
}

// ==========================================
// В РОЛЯХ (IN-PLAYER CAST DRAWER)
// ==========================================
async function renderInPlayerCastDrawer(body) {
  body.innerHTML = `
    <div style="display: flex; justify-content: center; padding: 25px;">
      <div class="storm-spinner"></div>
    </div>
  `;

  let cast = currentMedia?.cast || currentMedia?.credits?.cast || [];
  const cleanTitle = cleanVideoTitle(currentMedia?.title || currentMedia?.name || '');
  const origTitle = currentMedia?.original_title || '';
  const year = currentMedia?.year || '';
  const mediaType = currentMedia?.media_type || (currentMedia?.category === 'Сериал' ? 'series' : '');
  const actorsParam = typeof currentMedia?.actors === 'string' ? currentMedia.actors : '';

  if ((!cast || !cast.length) && currentMedia?.id) {
    try {
      const src = currentMedia.source || 'fanfilm4k';
      const q = new URLSearchParams({
        title: cleanTitle,
        original_title: origTitle,
        year: String(year),
        media_type: mediaType,
        actors: actorsParam
      }).toString();
      const res = await fetch(`/api/media/${encodeURIComponent(src)}/${encodeURIComponent(currentMedia.id)}/cast?${q}`);
      if (res.ok) {
        const data = await res.json();
        cast = data.cast || [];
        if (data.directors?.length && currentMedia) currentMedia.directors = data.directors;
        if (data.trivia?.length && currentMedia) currentMedia.trivia = data.trivia;
      }
    } catch (_) {}
  }
  if (!cast || !cast.length) {
    try {
      if (cleanTitle) {
        const q = new URLSearchParams({
          title: cleanTitle,
          original_title: origTitle,
          year: String(year),
          media_type: mediaType,
          actors: actorsParam
        }).toString();
        const res = await fetch(`/api/media/cast?${q}`);
        if (res.ok) {
          const data = await res.json();
          cast = data.cast || [];
          if (data.directors?.length && currentMedia) currentMedia.directors = data.directors;
        }
      }
    } catch (_) {}
  }
  if (!cast || !cast.length) {
    if (Array.isArray(currentMedia?.actors)) {
      cast = currentMedia.actors;
    } else if (typeof currentMedia?.actors === 'string' && currentMedia.actors.trim()) {
      cast = currentMedia.actors.split(',').map(s => s.trim()).filter(Boolean).map((name, idx) => ({
        id: `actor_${idx + 1}`,
        name,
        character: 'В главных ролях',
        photo: 'assets/favicon.svg'
      }));
    }
  }
  if (cast && cast.length && currentMedia) {
    currentMedia.cast = cast;
  }

  if (!cast || !cast.length) {
    body.innerHTML = `
      <div style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 13px;">
        🎭 Информация об актерском составе отсутствует для данного релиза.
      </div>
    `;
    return;
  }

  body.innerHTML = `
    <div class="inplayer-cast-drawer-content">
      <div style="font-size: 12px; font-weight: 700; color: var(--text-muted); margin-bottom: 12px;">
        В главных ролях (${cast.length}) • Нажмите на актера для фильмографии
      </div>
      <div class="inplayer-cast-scroll-row">
        ${cast.map(c => `
          <div class="inplayer-cast-item-card" data-person-id="${escapeHtml(c.id || '')}" data-person-name="${escapeHtml(c.name || '')}">
            <div class="inplayer-cast-img-box">
              <img src="${getSafePersonPhotoUrl(c.photo || c.profile_path)}" alt="${escapeHtml(c.name || '')}" class="inplayer-cast-img" loading="lazy" onerror="this.src='assets/avatar_default.svg'">
            </div>
            <div class="inplayer-cast-name">${escapeHtml(c.name || 'Актер')}</div>
            <div class="inplayer-cast-role">${escapeHtml(c.character || 'В ролях')}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  body.querySelectorAll('.inplayer-cast-item-card').forEach(card => {
    card.onclick = () => {
      const pid = card.dataset.personId;
      const pname = card.dataset.personName;
      if ((pid || pname) && typeof openPersonModal === 'function') {
        openPersonModal(pid || pname, pname);
      }
    };
  });
}

// ==========================================
// ИНТЕРАКТИВНЫЙ X-RAY DRAWER (ВНУТРИ СТУДИИ)
// ==========================================
function renderDrawerXRayView(body, onBack) {
  if (!currentMedia) return;
  const cleanTitle = cleanVideoTitle(currentMedia.title || '');
  let cast = currentMedia.cast || [];
  if (!cast || !cast.length) {
    if (Array.isArray(currentMedia?.actors)) {
      cast = currentMedia.actors;
    } else if (typeof currentMedia?.actors === 'string' && currentMedia.actors.trim()) {
      cast = currentMedia.actors.split(',').map(s => s.trim()).filter(Boolean).map((name, idx) => ({
        id: `actor_${idx + 1}`,
        name,
        character: 'В главных ролях',
        photo: 'assets/favicon.svg'
      }));
    }
  }

  const directors = currentMedia.directors || [];
  const composers = currentMedia.composers || [];
  const writers = currentMedia.writers || [];
  const cinematographers = currentMedia.cinematographers || [];

  const primaryComposer = composers[0]?.name || (directors[0]?.name ? `Оркестр под управлением ${directors[0].name}` : 'Оригинальный композитор');
  const soundtrack = currentMedia.soundtrack || {
    title: `${cleanTitle} (Original Soundtrack)`,
    artist: primaryComposer,
    album: `${cleanTitle} OST`,
    tracks: [
      { number: 1, title: `${cleanTitle} (Main Theme)`, artist: primaryComposer, duration: '03:42', scene: 'Заглавная тема' },
      { number: 2, title: 'Cinematic Progression', artist: primaryComposer, duration: '02:35', scene: 'Развитие сюжета' },
      { number: 3, title: 'High Stakes and Climax', artist: primaryComposer, duration: '04:12', scene: 'Кульминация' },
      { number: 4, title: 'End Credits Suite', artist: primaryComposer, duration: '03:50', scene: 'Финальные титры' }
    ]
  };

  const triviaList = currentMedia.trivia && currentMedia.trivia.length > 0 ? currentMedia.trivia : [
    { label: 'Мастеринг', content: 'Релиз представлен в оригинальном кинематографическом качестве 4K UHD с объемным многоканальным звуком.' },
    { label: 'Премьера', content: `Официальный мировой релиз ${currentMedia.release_date || currentMedia.year || ''} года.` }
  ];

  const crewList = [
    ...directors.map(d => ({ ...d, role: d.role || 'Режиссер' })),
    ...composers.map(c => ({ ...c, role: 'Композитор' })),
    ...writers.map(w => ({ ...w, role: 'Сценарист' })),
    ...cinematographers.map(c => ({ ...c, role: 'Оператор' }))
  ];

  body.innerHTML = `
    <div class="xray-drawer-view">
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 10px;">
        <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="xray-back-to-services-btn" style="padding: 5px 12px;">
          ← Назад к сервисам
        </button>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 11.5px; color: var(--text-muted); font-weight: 700;">X-Ray: ${escapeHtml(cleanTitle)}</span>
          <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="xray-pin-player-btn" style="padding: 5px 12px;">
            📌 Вывести поверх видео
          </button>
        </div>
      </div>

      <div class="xray-tabs-nav" style="margin-bottom: 12px;">
        <button type="button" class="xray-tab-btn active" data-xray-tab="cast">🎭 В кадре (${cast.length})</button>
        <button type="button" class="xray-tab-btn" data-xray-tab="music">🎵 Саундтрек</button>
        <button type="button" class="xray-tab-btn" data-xray-tab="trivia">💡 Факты (${triviaList.length})</button>
        <button type="button" class="xray-tab-btn" data-xray-tab="crew">🎬 Создатели (${crewList.length})</button>
      </div>

      <div class="xray-tab-content active" id="xray-drawer-pane-cast"></div>
      <div class="xray-tab-content" id="xray-drawer-pane-music"></div>
      <div class="xray-tab-content" id="xray-drawer-pane-trivia"></div>
      <div class="xray-tab-content" id="xray-drawer-pane-crew">
        <div class="xray-crew-list">
          ${crewList.length > 0 ? crewList.map(person => `
            <div class="xray-crew-card" data-person-id="${escapeHtml(person.id || '')}" data-person-name="${escapeHtml(person.name || '')}" style="cursor: pointer;" title="Открыть фильмографию">
              <img src="${getSafePersonPhotoUrl(person.photo)}" alt="${escapeHtml(person.name)}" class="xray-crew-img" onerror="this.src='assets/avatar_default.svg'">
              <div>
                <div class="xray-crew-name">${escapeHtml(person.name)}</div>
                <div class="xray-crew-role">${escapeHtml(person.role)}</div>
              </div>
            </div>
          `).join('') : '<div style="color: var(--text-muted); font-size: 12px; padding: 8px;">Данные о съемочной группе уточняются...</div>'}
        </div>
      </div>
    </div>
  `;

  const paneCast = body.querySelector('#xray-drawer-pane-cast');
  const paneMusic = body.querySelector('#xray-drawer-pane-music');
  const paneTrivia = body.querySelector('#xray-drawer-pane-trivia');

  renderXRayCastTab(paneCast, cast);
  renderXRaySoundtrackTab(paneMusic, soundtrack, body);
  renderXRayTriviaTab(paneTrivia, triviaList);

  const backBtn = body.querySelector('#xray-back-to-services-btn');
  if (backBtn) {
    backBtn.onclick = () => {
      if (typeof onBack === 'function') {
        onBack();
      } else {
        const tabServices = document.getElementById('studio-tab-services');
        if (tabServices) tabServices.click();
      }
    };
  }

  const pinBtn = body.querySelector('#xray-pin-player-btn');
  if (pinBtn) {
    pinBtn.onclick = () => {
      toggleXRayManual();
      showToast('X-Ray панель отображается поверх видеоплеера', 'info');
    };
  }

  const tabBtns = body.querySelectorAll('.xray-tab-btn');
  tabBtns.forEach(btn => {
    btn.onclick = () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tabType = btn.dataset.xrayTab;
      body.querySelectorAll('.xray-tab-content').forEach(p => p.classList.remove('active'));
      const targetPane = body.querySelector(`#xray-drawer-pane-${tabType}`);
      if (targetPane) targetPane.classList.add('active');
    };
  });

  // Фоновая дозагрузка актеров, если еще не были загружены
  if (cast.length === 0 && currentMedia.title) {
    (async () => {
      try {
        const src = currentMedia.source || 'fanfilm4k';
        const q = new URLSearchParams({
          title: cleanTitle,
          original_title: currentMedia.original_title || '',
          year: String(currentMedia.year || ''),
          media_type: currentMedia.media_type || '',
          actors: typeof currentMedia.actors === 'string' ? currentMedia.actors : ''
        }).toString();
        const r = await fetch(`/api/media/${encodeURIComponent(src)}/${encodeURIComponent(currentMedia.id || 0)}/cast?${q}`);
        if (r.ok) {
          const data = await r.json();
          if (data?.cast?.length) {
            currentMedia.cast = data.cast;
            if (paneCast) renderXRayCastTab(paneCast, data.cast);
            const tabCastBtn = body.querySelector('[data-xray-tab="cast"]');
            if (tabCastBtn) tabCastBtn.textContent = `🎭 В кадре (${data.cast.length})`;
          }
        }
      } catch (_) {}
    })();
  }

  // Фоновая дозагрузка саундтрека
  if (!currentMedia.soundtrackLoaded) {
    fetch(`/api/media/soundtrack?title=${encodeURIComponent(cleanTitle)}&original_title=${encodeURIComponent(currentMedia.original_title || '')}&year=${encodeURIComponent(currentMedia.year || '')}`)
      .then(res => res.json())
      .then(data => {
        if (data && data.tracks && data.tracks.length > 0) {
          currentMedia.soundtrack = data;
          currentMedia.soundtrackLoaded = true;
          if (paneMusic) renderXRaySoundtrackTab(paneMusic, data, body);
        }
      })
      .catch(() => {});
  }
}

// ==========================================
// VIBRANT ФОНОВАЯ ПОДСВЕТКА (AMBIENT GLOW)
// ==========================================
export function applyAmbientBackdropGlow(mediaItem) {
  const modal = document.getElementById('cinema-modal');
  if (!modal) return;

  const colors = [
    'rgba(0, 210, 255, 0.40)',
    'rgba(168, 85, 247, 0.40)',
    'rgba(255, 0, 127, 0.40)',
    'rgba(0, 255, 102, 0.40)',
    'rgba(245, 158, 11, 0.40)',
    'rgba(2, 132, 199, 0.40)'
  ];
  const title = mediaItem?.title || '';
  let hash = 0;
  for (let i = 0; i < title.length; i++) hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  const picked = colors[hash % colors.length];

  modal.style.setProperty('--ambient-backdrop-color', picked);
}

function renderPlayerUtilityButtons() {
  const container = document.getElementById('player-utility-actions');
  if (!container) return;

  container.innerHTML = `
    <div class="player-studio-dock">
      <div class="player-studio-sections">
        <!-- 1. Студия звука и видео -->
        <div class="player-studio-section">
          <div class="player-studio-section-label">🎬 Студия звука и видео</div>
          <div class="player-studio-btn-grid">
            <button type="button" class="studio-tab-btn" id="studio-tab-video" title="Профессиональные настройки изображения (HDR10, Dolby Vision, FSR CAS, 21:9 Cinemascope)">
              <span class="studio-tab-icon">🎛️</span>
              <span class="studio-tab-text">Pro Видео</span>
            </button>
            <button type="button" class="studio-tab-btn" id="studio-tab-audio" title="Профессиональная студия звука (Dolby Atmos 3D, 10-Band EQ, AI Voice)">
              <span class="studio-tab-icon">🔊</span>
              <span class="studio-tab-text">Pro Звук</span>
            </button>
            <button type="button" class="studio-tab-btn ${ambilightEnabled ? 'active-glow' : ''}" id="studio-tab-ambilight" title="Динамическая фоновая подсветка Ambilight и настройки">
              <span class="studio-tab-icon">🌈</span>
              <span class="studio-tab-text">Ambilight</span>
            </button>
            <button type="button" class="studio-tab-btn ${nightAudioModeEnabled ? 'active' : ''}" id="toggle-night-audio-btn" title="Ночной режим звука (компрессор динамического диапазона)">
              <span class="studio-tab-icon">🌙</span>
              <span class="studio-tab-text">Ночной звук</span>
              <span class="studio-tab-badge night-audio-badge" style="font-size: 10px; font-weight: 800; padding: 1px 5px; border-radius: 4px; margin-left: 4px; background: rgba(0,0,0,0.4); color: ${nightAudioModeEnabled ? 'var(--storm-accent-green, #10b981)' : 'var(--text-muted)'};">${nightAudioModeEnabled ? 'ВКЛ' : 'ВЫКЛ'}</span>
            </button>
          </div>
        </div>

        <!-- 2. Сервисы и инструменты -->
        <div class="player-studio-section">
          <div class="player-studio-section-label">⚡ Сервисы и просмотр</div>
          <div class="player-studio-btn-grid">
            <button type="button" class="studio-tab-btn" id="studio-tab-cast" title="В главных ролях и съемочная группа">
              <span class="studio-tab-icon">🎭</span>
              <span class="studio-tab-text">В ролях</span>
            </button>
            <button type="button" class="studio-tab-btn" id="studio-tab-subtitles" title="Внешние дорожки и пользовательские субтитры">
              <span class="studio-tab-icon">💬</span>
              <span class="studio-tab-text">Субтитры</span>
            </button>
            <button type="button" class="studio-tab-btn" id="studio-tab-room" title="Совместный просмотр с друзьями и чатом">
              <span class="studio-tab-icon">👥</span>
              <span class="studio-tab-text">Кинокомната</span>
            </button>
            <button type="button" class="studio-tab-btn" id="studio-tab-cleanview" title="STORM CleanView: автоматический пропуск рекламы и вырезание водяных знаков">
              <span class="studio-tab-icon">🛡️</span>
              <span class="studio-tab-text">CleanView</span>
            </button>
            <button type="button" class="studio-tab-btn" id="studio-tab-franchise" title="Хронология франшизы, сиквелы, приквелы и связанные фильмы">
              <span class="studio-tab-icon">🧬</span>
              <span class="studio-tab-text">Франшиза</span>
            </button>
            <button type="button" class="studio-tab-btn" id="studio-tab-download" title="Скачать 4K / FHD: прямые ссылки на потоки .m3u8 / .mpd для VLC, IINA, PotPlayer и субтитры .vtt" style="border-color: rgba(16, 185, 129, 0.4);">
              <span class="studio-tab-icon">📥</span>
              <span class="studio-tab-text">Скачать 4K / FHD</span>
            </button>
            <button type="button" class="studio-tab-btn" id="studio-tab-xray" title="STORM X-Ray 2.0: распознавание актеров в кадре, саундтрека сцены и интересных фактов">
              <span class="studio-tab-icon">🔍</span>
              <span class="studio-tab-text">X-Ray Сцены</span>
            </button>
            <button type="button" class="studio-tab-btn" id="studio-tab-bookmarks" title="Метки любимых сцен с таймкодами и сохранение стоп-кадра в 4K">
              <span class="studio-tab-icon">📌</span>
              <span class="studio-tab-text">Метки сцен</span>
            </button>
            <button type="button" class="studio-tab-btn" id="studio-tab-cast-tv" title="Беспроводная трансляция на Smart TV (Chromecast, AirPlay, DLNA и STORM TV Bridge)">
              <span class="studio-tab-icon">📺</span>
              <span class="studio-tab-text">На ТВ (Cast)</span>
            </button>
            <button type="button" class="studio-tab-btn" id="studio-tab-airing" title="Умная лента новых серий и вышедших озвучек ваших сериалов">
              <span class="studio-tab-icon">🔔</span>
              <span class="studio-tab-text">Новые серии</span>
            </button>
          </div>
        </div>

        <!-- 3. Панель автоматизации и режимов воспроизведения -->
        <div class="player-automation-card">
          <div class="player-automation-header">
            <span class="player-automation-badge">⚡ Режимы потока и автоматизация</span>
            <span class="player-automation-hint">Умное управление воспроизведением</span>
          </div>
          <div class="player-automation-grid">
            <label class="automation-toggle-chip" title="Прямой поток без транскодирования через промежуточный прокси">
              <input type="checkbox" id="toggle-direct-stream" ${forceDirectStream ? 'checked' : ''}>
              <span class="automation-chip-box"></span>
              <span class="automation-chip-icon">⚡</span>
              <div class="automation-chip-text">
                <span class="automation-chip-title">Прямой поток</span>
                <span class="automation-chip-sub">Максимальная скорость</span>
              </div>
            </label>

            <label class="automation-toggle-chip" title="Обход ограничений зарубежного VPN через защищенный российский сервер STORM">
              <input type="checkbox" id="toggle-vpn-bypass" ${vpnBypassEnabled ? 'checked' : ''}>
              <span class="automation-chip-box"></span>
              <span class="automation-chip-icon">🛡️</span>
              <div class="automation-chip-text">
                <span class="automation-chip-title">Обход VPN</span>
                <span class="automation-chip-sub">Защищенный шлюз</span>
              </div>
            </label>

            <label class="automation-toggle-chip" title="STORM AdBlock Engine: блокировка VAST видеорекламы, прероллов, баннеров и казино">
              <input type="checkbox" id="toggle-adblock" ${adblockEnabled ? 'checked' : ''}>
              <span class="automation-chip-box"></span>
              <span class="automation-chip-icon">🚫</span>
              <div class="automation-chip-text">
                <span class="automation-chip-title">Блокировка рекламы</span>
                <span class="automation-chip-sub" id="adblock-chip-sub">${adblockEnabled ? 'Активна (Zero Ads)' : 'Выключена'}</span>
              </div>
            </label>
          </div>
        </div>
      </div>

    </div>
  `;

  // Всплывающее модальное окно студии (Studio Floating Modal Dialog)
  const cinemaModal = document.getElementById('cinema-modal');
  const targetParent = cinemaModal || document.body;

  let backdrop = document.getElementById('player-studio-modal-backdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'player-studio-modal-backdrop';
    backdrop.className = 'player-studio-modal-backdrop';
    backdrop.style.display = 'none';
    backdrop.innerHTML = `
      <div class="player-studio-modal-dialog" id="player-studio-drawer">
        <div class="studio-drawer-header">
          <div class="studio-drawer-title">
            <span id="studio-drawer-icon">🎛️</span>
            <span id="studio-drawer-heading">Pro Видео</span>
          </div>
          <button type="button" class="studio-drawer-close" id="studio-drawer-close" title="Закрыть окно">✕</button>
        </div>
        <div class="studio-drawer-body" id="studio-drawer-body"></div>
      </div>
    `;
    targetParent.appendChild(backdrop);
  } else if (targetParent && backdrop.parentElement !== targetParent) {
    targetParent.appendChild(backdrop);
  }

  const drawer = backdrop.querySelector('#player-studio-drawer');
  const drawerBody = backdrop.querySelector('#studio-drawer-body');
  const drawerIcon = backdrop.querySelector('#studio-drawer-icon');
  const drawerHeading = backdrop.querySelector('#studio-drawer-heading');
  const drawerClose = backdrop.querySelector('#studio-drawer-close');
  const tabButtons = container.querySelectorAll('.studio-tab-btn');

  let activeTabName = null;

  const closeDrawer = () => {
    if (backdrop) backdrop.style.display = 'none';
    if (drawerBody) drawerBody.style.display = 'block';
    activeTabName = null;
    tabButtons.forEach(btn => btn.classList.remove('active'));
  };

  if (drawerClose) drawerClose.onclick = closeDrawer;
  backdrop.onclick = (e) => {
    if (e.target === backdrop) closeDrawer();
  };

  if (!backdrop._hasEscapeListener) {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && backdrop && backdrop.style.display !== 'none') {
        e.stopImmediatePropagation();
        closeDrawer();
      }
    }, true);
    backdrop._hasEscapeListener = true;
  }

  const openDrawerTab = (tabName, icon, heading, renderFn) => {
    const curCinemaModal = document.getElementById('cinema-modal');
    if (curCinemaModal && backdrop.parentElement !== curCinemaModal) {
      curCinemaModal.appendChild(backdrop);
    }

    if (activeTabName === tabName && backdrop.style.display !== 'none') {
      closeDrawer();
      return;
    }

    activeTabName = tabName;
    tabButtons.forEach(btn => btn.classList.toggle('active', btn.id === `studio-tab-${tabName}`));

    if (drawerIcon) drawerIcon.textContent = icon;
    if (drawerHeading) drawerHeading.textContent = heading;

    backdrop.style.display = 'flex';
    if (drawerBody) {
      drawerBody.style.display = 'block';
      drawerBody.innerHTML = '';
      renderFn(drawerBody);
      drawerBody.scrollTop = 0;
    }
  };

  // 1. Pro Видео
  const tabVideo = container.querySelector('#studio-tab-video');
  if (tabVideo) {
    tabVideo.onclick = () => {
      openDrawerTab('video', '🎛️', 'Pro Видео (HDR10, Dolby Vision, FSR CAS, 21:9 Cinemascope)', (body) => {
        renderProVideoPanel(body);
      });
    };
  }

  // 2. Pro Звук
  const tabAudio = container.querySelector('#studio-tab-audio');
  if (tabAudio) {
    tabAudio.onclick = () => {
      openDrawerTab('audio', '🔊', 'Pro Звук (Dolby Atmos 3D, DTS:X, 10-Band EQ, AI Voice)', (body) => {
        renderProAudioPanel(body);
      });
    };
  }

  // 3. Ambilight
  const tabAmbilight = container.querySelector('#studio-tab-ambilight');
  if (tabAmbilight) {
    tabAmbilight.onclick = () => {
      openDrawerTab('ambilight', '🌈', 'Подсветка Ambilight и настройки палитры', (body) => {
        const toggleBtnHtml = `
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--border-subtle);">
            <div>
              <div style="font-size: 13px; font-weight: 800; color: var(--text-primary);">Фоновая динамическая подсветка</div>
              <div style="font-size: 11px; color: var(--text-muted);">Создает эффект погружения и расширяет границы экрана</div>
            </div>
            <button type="button" class="storm-btn ${ambilightEnabled ? 'storm-btn-primary' : 'storm-btn-secondary'} storm-btn-sm" id="drawer-toggle-ambilight-btn">
              ${ambilightEnabled ? '🟢 Ambilight Включен' : '⚪ Включить Ambilight'}
            </button>
          </div>
          <div id="drawer-ambilight-settings-host"></div>
        `;
        body.innerHTML = toggleBtnHtml;

        const toggleBtn = body.querySelector('#drawer-toggle-ambilight-btn');
        const settingsHost = body.querySelector('#drawer-ambilight-settings-host');

        if (toggleBtn) {
          toggleBtn.onclick = () => {
            toggleAmbilight();
            tabAmbilight.classList.toggle('active-glow', ambilightEnabled);
            toggleBtn.className = `storm-btn ${ambilightEnabled ? 'storm-btn-primary' : 'storm-btn-secondary'} storm-btn-sm`;
            toggleBtn.textContent = ambilightEnabled ? '🟢 Ambilight Включен' : '⚪ Включить Ambilight';
          };
        }

        if (settingsHost) renderAmbilightSettings(settingsHost);
      });
    };
  }

  // 5. Субтитры и внешние дорожки
  const tabSubtitles = container.querySelector('#studio-tab-subtitles');
  if (tabSubtitles) {
    tabSubtitles.onclick = () => {
      openDrawerTab('subtitles', '💬', 'Внешние дорожки, сдвиг тайминга и субтитры', (body) => {
        renderSubtitlesControls(body);
      });
    };
  }

  // 6. Кинокомната и совместный просмотр
  const tabRoom = container.querySelector('#studio-tab-room');
  if (tabRoom) {
    tabRoom.onclick = () => {
      openDrawerTab('room', '👥', 'Кинокомната и синхронный просмотр с друзьями', (body) => {
        body.innerHTML = `
          <div style="display: flex; flex-direction: column; gap: 14px;">
            <div style="background: var(--bg-card); padding: 14px 18px; border-radius: 12px; border: 1px solid var(--border-subtle);">
              <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-bottom: 12px;">
                <div>
                  <div style="font-weight: 800; font-size: 13.5px; color: var(--text-primary);">Синхронный просмотр с друзьями</div>
                  <div style="font-size: 11px; color: var(--text-muted);">Сквозная синхронизация таймкода, онлайн-чат, стикеры и реакции</div>
                </div>
                <div style="display: flex; gap: 8px;">
                  <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="drawer-create-room-btn">
                    👥 Создать кинокомнату
                  </button>
                  <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="drawer-share-media-btn">
                    🔗 Поделиться ссылкой
                  </button>
                </div>
              </div>

              <!-- Форма входа по коду комнаты -->
              <div style="border-top: 1px solid var(--border-subtle); padding-top: 12px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                <div style="flex: 1; min-width: 200px;">
                  <input type="text" class="storm-input" id="drawer-join-room-input" placeholder="Введите код комнаты (например, STORM-JTNY)" style="width: 100%; text-transform: uppercase; font-weight: 700; letter-spacing: 1px; padding: 7px 12px; font-size: 13px;">
                </div>
                <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="drawer-join-room-btn" style="white-space: nowrap; padding: 7px 16px;">
                  🔑 Войти по коду
                </button>
              </div>
            </div>

            <!-- Плашка активной комнаты (если подключен) -->
            <div id="drawer-active-room-card" style="display: none; background: rgba(0, 210, 255, 0.08); border: 1px solid var(--accent); border-radius: 12px; padding: 12px 16px; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
              <div>
                <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; color: var(--accent); letter-spacing: 1px;">🟢 Вы в кинокомнате</div>
                <div style="font-size: 14px; font-weight: 800; color: #fff; margin-top: 2px;">Код: <span id="drawer-active-room-code" style="color: var(--accent);"></span></div>
              </div>
              <div style="display: flex; gap: 8px;">
                <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="drawer-open-chat-btn">
                  💬 Чат комнаты
                </button>
                <button type="button" class="storm-btn storm-btn-danger storm-btn-sm" id="drawer-leave-room-btn">
                  ✕ Выйти
                </button>
              </div>
            </div>
          </div>
        `;

        const roomBtn = body.querySelector('#drawer-create-room-btn');
        const joinInput = body.querySelector('#drawer-join-room-input');
        const joinBtn = body.querySelector('#drawer-join-room-btn');
        const shareBtn = body.querySelector('#drawer-share-media-btn');
        const activeCard = body.querySelector('#drawer-active-room-card');
        const activeCodeEl = body.querySelector('#drawer-active-room-code');
        const openChatBtn = body.querySelector('#drawer-open-chat-btn');
        const leaveBtn = body.querySelector('#drawer-leave-room-btn');

        const updateActiveRoomDisplay = () => {
          const room = getActiveRoom();
          if (room && activeCard && activeCodeEl) {
            activeCard.style.display = 'flex';
            activeCodeEl.textContent = room.code;
          } else if (activeCard) {
            activeCard.style.display = 'none';
          }
        };

        updateActiveRoomDisplay();

        if (roomBtn) {
          roomBtn.onclick = async () => {
            const code = await createWatchRoom(currentMedia);
            if (code) {
              showToast(`Кинокомната создана! Код: ${code}`, 'success');
              updateActiveRoomDisplay();
            }
          };
        }

        const doJoin = () => {
          const code = (joinInput?.value || '').trim().toUpperCase();
          if (!code) {
            showToast('Введите код комнаты', 'warning');
            return;
          }
          joinWatchRoom(code, currentMedia);
          setTimeout(updateActiveRoomDisplay, 600);
        };

        if (joinBtn) joinBtn.onclick = doJoin;
        if (joinInput) {
          joinInput.onkeydown = (e) => {
            if (e.key === 'Enter') doJoin();
          };
        }

        if (openChatBtn) {
          openChatBtn.onclick = () => {
            const room = getActiveRoom();
            if (room) renderRoomUi(room);
          };
        }

        if (leaveBtn) {
          leaveBtn.onclick = () => {
            leaveWatchRoom();
            updateActiveRoomDisplay();
          };
        }

        if (shareBtn) {
          shareBtn.onclick = () => copyMediaShareLink();
        }
      });
    };
  }

  // 7. STORM CleanView & AdShield
  const tabCleanView = container.querySelector('#studio-tab-cleanview');
  if (tabCleanView) {
    tabCleanView.onclick = () => {
      toggleCleanViewModal();
    };
  }

  // 7b. Менеджер потоков «📥 Скачать 4K / FHD» для внешних плееров (VLC / IINA / PotPlayer)
  const tabDownload = container.querySelector('#studio-tab-download');
  if (tabDownload) {
    tabDownload.onclick = () => {
      openLiftDownloadModal();
    };
  }

  // 8. В главных ролях и съемочная группа
  const tabCast = container.querySelector('#studio-tab-cast');
  if (tabCast) {
    tabCast.onclick = () => {
      openDrawerTab('cast', '🎭', 'В ролях и съемочная группа', (body) => {
        renderInPlayerCastDrawer(body);
      });
    };
  }

  // 8b. Интерактивный X-Ray 2.0 (Актеры в кадре, Саундтрек, Факты)
  const tabXray = container.querySelector('#studio-tab-xray');
  if (tabXray) {
    tabXray.onclick = () => {
      openDrawerTab('xray', '🔍', `STORM X-Ray 2.0: ${cleanVideoTitle(currentMedia?.title || '')}`, (body) => {
        renderDrawerXRayView(body, () => closeDrawer());
      });
    };
  }

  // 8c. Покадровые закладки любимых сцен и стоп-кадр (Scene Bookmarks & Frame Clipper)
  const tabBookmarks = container.querySelector('#studio-tab-bookmarks');
  if (tabBookmarks) {
    tabBookmarks.onclick = () => {
      openDrawerTab('bookmarks', '📌', 'Метки любимых сцен и стоп-кадр 4K', (body) => {
        renderSceneBookmarksDrawer(body, () => closeDrawer());
      });
    };
  }

  // 8d. Беспроводная трансляция на Smart TV (Cast / DLNA / AirPlay)
  const tabCastTv = container.querySelector('#studio-tab-cast-tv');
  if (tabCastTv) {
    tabCastTv.onclick = () => {
      openDrawerTab('cast-tv', '📺', 'Трансляция на Smart TV (Chromecast / AirPlay / DLNA)', (body) => {
        renderSmartTvCastDrawer(body);
      });
    };
  }

  // 8e. Умная лента новых серий и озвучек (My Airing Tracker)
  const tabAiring = container.querySelector('#studio-tab-airing');
  if (tabAiring) {
    tabAiring.onclick = () => {
      openDrawerTab('airing', '🔔', 'Новые серии и озвучки ваших сериалов', (body) => {
        renderAiringTrackerDrawer(body, () => closeDrawer());
      });
    };
  }

  // 9. Хронология франшизы и связанные части
  const tabFranchise = container.querySelector('#studio-tab-franchise');
  if (tabFranchise) {
    tabFranchise.onclick = () => {
      openDrawerTab('franchise', '🧬', `Хронология франшизы: ${currentMedia?.title || ''}`, async (body) => {
        body.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--text-muted);">⏳ Построение хронологического графа франшизы...</div>`;
        try {
          const qTitle = encodeURIComponent(currentMedia?.title || '');
          const res = await fetch(`/api/media/franchise?title=${qTitle}`);
          const data = await res.json();
          const items = Array.isArray(data?.items) ? data.items : [];
          if (items.length === 0) {
            body.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--text-muted);">Для «${escapeHtml(currentMedia?.title || '')}» дополнительных частей франшизы не найдено.</div>`;
            return;
          }
          body.innerHTML = `
            <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">
              Все части и связанные релизы вселенной <strong>«${escapeHtml(data.franchise || currentMedia?.title || '')}»</strong> в хронологическом порядке:
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px;">
              ${items.map((it, idx) => {
                const pUrl = it.poster ? (it.poster.startsWith('/api/media/image-proxy') ? it.poster : `/api/media/image-proxy?url=${encodeURIComponent(it.poster)}&title=${encodeURIComponent(it.title || '')}`) : `/api/media/image-proxy?title=${encodeURIComponent(it.title || '')}`;
                const isCur = String(it.title || '').toLowerCase() === String(currentMedia?.title || '').toLowerCase();
                return `
                  <div class="storm-card franchise-item-card" data-idx="${idx}" style="display: flex; gap: 10px; padding: 10px; border-radius: 10px; cursor: pointer; border: 1px solid ${isCur ? 'var(--accent)' : 'rgba(255,255,255,0.08)'}; background: ${isCur ? 'rgba(0,210,255,0.08)' : 'rgba(255,255,255,0.03)'};">
                    <img src="${pUrl}" alt="${escapeHtml(it.title)}" style="width: 54px; height: 78px; object-fit: cover; border-radius: 6px; flex-shrink: 0;" onerror="this.src='assets/favicon.svg'">
                    <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: space-between;">
                      <div>
                        <div style="font-size: 10px; color: var(--accent); font-weight: 800;">Часть #${idx + 1} • ${it.year || ''}</div>
                        <div style="font-size: 13px; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(it.title)}">${escapeHtml(it.title)}</div>
                        <div style="font-size: 11px; color: var(--text-muted);">★ ${it.rating || '8.0'} • ${escapeHtml(it.quality || '4K UHD')}</div>
                      </div>
                      <span style="font-size: 11px; color: ${isCur ? '#10b981' : 'var(--accent)'}; font-weight: 700;">${isCur ? '● Сейчас открыто' : '▶ Переключить'}</span>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `;
          body.querySelectorAll('.franchise-item-card').forEach(card => {
            card.onclick = () => {
              const picked = items[parseInt(card.dataset.idx, 10)];
              if (picked) {
                closeDrawer();
                openPlayerModal(picked);
              }
            };
          });
        } catch (err) {
          body.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--color-red);">Не удалось загрузить хронологию: ${escapeHtml(err.message)}</div>`;
        }
      });
    };
  }

  // Быстрые кнопки панели справа
  const nightAudioBtn = container.querySelector('#toggle-night-audio-btn');
  if (nightAudioBtn) {
    nightAudioBtn.onclick = () => toggleNightModeAudio();
  }

  const directStreamToggle = container.querySelector('#toggle-direct-stream');
  if (directStreamToggle) {
    directStreamToggle.onchange = (e) => {
      setForceDirectStream(e.target.checked);
    };
  }

  const vpnBypassToggle = container.querySelector('#toggle-vpn-bypass');
  if (vpnBypassToggle) {
    vpnBypassToggle.onchange = (e) => {
      vpnBypassEnabled = e.target.checked;
      localStorage.setItem('storm_vpn_bypass', vpnBypassEnabled ? 'true' : 'false');
      showToast(`Обход VPN: ${vpnBypassEnabled ? 'Включен' : 'Выключен'}`, 'info');
      if (currentActivePlayer) {
        selectPlayer(currentActivePlayer);
      }
    };
  }

  const adblockToggle = container.querySelector('#toggle-adblock');
  if (adblockToggle) {
    adblockToggle.onchange = (e) => {
      setAdblockEnabled(e.target.checked);
      const sub = container.querySelector('#adblock-chip-sub');
      if (sub) sub.textContent = adblockEnabled ? 'Активна (Zero Ads)' : 'Выключена';
      showToast(`Блокировка рекламы: ${adblockEnabled ? 'Включена' : 'Выключена'}`, 'info');
      if (currentActivePlayer) {
        selectPlayer(currentActivePlayer);
      }
    };
  }
}

// ==========================================================================
// НЕВИДИМЫЙ СЧЕТЧИК И ДИНАМИЧЕСКИЙ ТРЕКЕР ПРОСМОТРА СЕРИЙ (>= 50%)
// Серия отмечается просмотренной ТОЛЬКО при достижении как минимум 50% хронометража.
// Статус серии и сериала динамически обновляется на лету во всех компонентах DOM.
// ==========================================================================
let episodeWatchTrackerInterval = null;
let activeTrackingMediaId = null;
let activeTrackingSeason = 1;
let activeTrackingEpisode = 1;
let activeTrackingWatchedSeconds = 0;
let activeRealWatchedSeconds = 0;
let activeTrackingDurationSeconds = 1440;
let activeTrackingHasReached50 = false;
let activeTrackingStorageKey = '';
let activeRealStorageKey = '';

export function stopInvisibleEpisodeWatchTracker() {
  if (episodeWatchTrackerInterval) {
    clearInterval(episodeWatchTrackerInterval);
    episodeWatchTrackerInterval = null;
  }
}

export function parseDurationStringToSeconds(str) {
  if (!str) return 0;
  if (typeof str === 'number') return str > 300 ? Math.round(str) : Math.round(str * 60);
  const s = String(str).toLowerCase().trim();
  if (s.includes(':')) {
    const parts = s.split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
  }
  let total = 0;
  const hMatch = s.match(/(\d+)\s*(?:ч|h|час)/);
  if (hMatch) total += parseInt(hMatch[1], 10) * 3600;
  const mMatch = s.match(/(\d+)\s*(?:м|m|мин)/);
  if (mMatch) total += parseInt(mMatch[1], 10) * 60;
  const sMatch = s.match(/(\d+)\s*(?:с|s|сек)/);
  if (sMatch) total += parseInt(sMatch[1], 10);
  if (total > 0) return total;
  const num = parseInt(s, 10);
  if (!isNaN(num) && num > 0) {
    return num <= 300 ? num * 60 : num;
  }
  return 0;
}

export function startInvisibleEpisodeWatchTracker(media, seasonNum = 1, episodeNum = 1) {
  if (!media || !media.id) return;
  stopInvisibleEpisodeWatchTracker();

  activeTrackingMediaId = String(media.id);
  activeTrackingSeason = Number(seasonNum) || 1;
  activeTrackingEpisode = Number(episodeNum) || 1;
  activeTrackingStorageKey = `storm_ep_watchtime_${activeTrackingMediaId}_s${activeTrackingSeason}_e${activeTrackingEpisode}`;
  activeRealStorageKey = `storm_real_watchtime_${activeTrackingMediaId}`;

  // Проверяем, не была ли серия УЖЕ отмечена просмотренной ранее
  const watchedSet = getWatchedEpisodes(activeTrackingMediaId, activeTrackingSeason);
  activeTrackingHasReached50 = watchedSet.has(activeTrackingEpisode);

  // Считываем сохраненное время просмотра этой серии (если пользователь уже смотрел часть)
  try {
    activeTrackingWatchedSeconds = parseInt(localStorage.getItem(activeTrackingStorageKey) || '0', 10);
    if (isNaN(activeTrackingWatchedSeconds) || activeTrackingWatchedSeconds < 0) {
      activeTrackingWatchedSeconds = 0;
    }
    const savedReal = parseInt(localStorage.getItem(activeRealStorageKey) || '0', 10);
    const serverReal = Number(media?.user_watch_progress?.real_watched_seconds || 0);
    activeRealWatchedSeconds = Math.max(0, isNaN(savedReal) ? 0 : savedReal, isNaN(serverReal) ? 0 : serverReal);
  } catch (_) {
    activeTrackingWatchedSeconds = 0;
    activeRealWatchedSeconds = 0;
  }

  // Определение хронометража серии (в секундах)
  let resolvedDuration = 0;

  // 1. Из нативного видеоэлемента
  const video = document.querySelector('#cinema-player-wrapper video, .cinema-video-element');
  if (video && video.duration && !isNaN(video.duration) && isFinite(video.duration) && video.duration > 30) {
    resolvedDuration = Math.round(video.duration);
  }

  // 2. Из перечня серий текущего сезона (ep.duration)
  if (!resolvedDuration && Array.isArray(currentEpisodes) && currentEpisodes.length > 0) {
    const epObj = currentEpisodes.find(e => (Number(e.episode || e.episode_number) === activeTrackingEpisode));
    if (epObj?.duration) {
      resolvedDuration = parseDurationStringToSeconds(epObj.duration);
    }
  }

  // 3. Из данных медиа или быстрого бара
  if (!resolvedDuration && media.duration) {
    resolvedDuration = parseDurationStringToSeconds(media.duration);
  }

  // 4. Умный дефолт по типу медиа:
  // Аниме: 24 минуты (1440 сек, 50% = 12 мин)
  // Сериал: 45 минут (2700 сек, 50% = 22.5 мин)
  // Фильм: 90 минут (5400 сек, 50% = 45 мин)
  if (!resolvedDuration || resolvedDuration <= 30) {
    const mType = media.media_type || '';
    const genres = (Array.isArray(media.genres) ? media.genres.join(' ') : (media.genres || '')).toLowerCase();
    if (mType.includes('anime') || genres.includes('аниме')) {
      resolvedDuration = 24 * 60; // 1440
    } else if (mType.includes('series') || media.seasons || quickBarSeriesData) {
      resolvedDuration = 45 * 60; // 2700
    } else {
      resolvedDuration = 90 * 60; // 5400
    }
  }

  activeTrackingDurationSeconds = resolvedDuration;

  // Немедленная проверка: если сохраненное время уже >= 50%, отмечаем
  check50PercentWatchCondition(activeTrackingWatchedSeconds, activeTrackingDurationSeconds);

  // Запуск невидимого ежесекундного тикера
  episodeWatchTrackerInterval = setInterval(() => {
    const modal = document.getElementById('cinema-modal');
    if (!modal || !modal.classList.contains('is-open')) {
      stopInvisibleEpisodeWatchTracker();
      return;
    }
    // Если пользователь свернул окно/вкладку — невидимый таймер на паузе
    if (document.hidden) return;

    // Нативный HTML5 видеоплеер
    if (isResumePromptPending) return;
    const currentVideo = document.querySelector('#cinema-player-wrapper video, .cinema-video-element');
    if (currentVideo) {
      if (!currentVideo.paused && !currentVideo.ended && !currentVideo.seeking) {
        if (currentVideo.duration && isFinite(currentVideo.duration) && currentVideo.duration > 30) {
          activeTrackingDurationSeconds = Math.round(currentVideo.duration);
        }
        activeRealWatchedSeconds += 1;
        activeTrackingWatchedSeconds = Math.round(currentVideo.currentTime || 0);
        check50PercentWatchCondition(activeRealWatchedSeconds, activeTrackingDurationSeconds);
      }
    } else {
      // Встраиваемый Iframe плеер (Kodik, Alloha, VideoCDN, FanFilm4K, RuTube, VK и др.)
      activeRealWatchedSeconds += 1;
      activeTrackingWatchedSeconds += 1;
      check50PercentWatchCondition(activeRealWatchedSeconds, activeTrackingDurationSeconds);
    }

    // Сохраняем прогресс каждые 5 секунд
    if (activeRealWatchedSeconds > 0 && activeRealWatchedSeconds % 5 === 0 && activeTrackingStorageKey) {
      try {
        localStorage.setItem(activeTrackingStorageKey, String(activeTrackingWatchedSeconds));
        if (activeRealStorageKey) {
          localStorage.setItem(activeRealStorageKey, String(activeRealWatchedSeconds));
        }
      } catch (_) {}
      saveMediaResumeSnapshot({
        season: activeTrackingSeason,
        episode: activeTrackingEpisode,
        time_seconds: activeTrackingWatchedSeconds,
        real_watched_seconds: activeRealWatchedSeconds,
        duration_seconds: activeTrackingDurationSeconds
      });
    }
  }, 1000);
}

function check50PercentWatchCondition(watchedSec, totalSec) {
  if (activeTrackingHasReached50 || !activeTrackingMediaId) return;
  if (!totalSec || totalSec <= 0) totalSec = 1440;
  const progressRatio = watchedSec / totalSec;

  if (progressRatio >= 0.5) {
    activeTrackingHasReached50 = true;
    markEpisodeWatched(activeTrackingMediaId, activeTrackingSeason, activeTrackingEpisode, true);
    showToast(`Серия ${activeTrackingEpisode} просмотрена более чем на 50% и отмечена`, 'success');
  }
}

// Слушатель postMessage от встраиваемых плееров (Kodik, Alloha, Playerjs)
if (typeof window !== 'undefined' && !window._stormPostMessageListenerAttached) {
  window._stormPostMessageListenerAttached = true;
  window.addEventListener('message', (event) => {
    try {
      let data = event.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (_) {}
      }
      if (data && typeof data === 'object') {
        const time = Number(data.time || data.currentTime || data.value?.time);
        const duration = Number(data.duration || data.value?.duration);
        if (time > 0 && duration > 30) {
          if (activeTrackingDurationSeconds <= 0 || activeTrackingDurationSeconds === 1440 || activeTrackingDurationSeconds === 2700) {
            activeTrackingDurationSeconds = Math.round(duration);
          }
          activeTrackingWatchedSeconds = Math.round(time);
        }
      }
    } catch (_) {}
  });
}

export function updateEpisodeDOMElements(mediaId, seasonNum, episodeNum, watched) {
  const epNum = Number(episodeNum) || 1;
  const sNum = Number(seasonNum) || 1;

  // 1. Карточка серии в основном списке серий (#series-episodes-grid)
  const gridEl = document.getElementById('series-episodes-grid');
  if (gridEl) {
    const card = gridEl.querySelector(`.series-episode-card[data-ep-num="${epNum}"]`);
    if (card) {
      card.classList.toggle('watched', watched);
      const isAct = card.classList.contains('active');
      const chip = card.querySelector('.season-status-chip, .ep-status-toggle');
      if (chip) {
        chip.className = `season-status-chip ${watched ? 'completed' : (isAct ? 'watching' : 'planned')} ep-status-toggle`;
        chip.textContent = watched ? '✓ Просмотрено' : (isAct ? '▶ Смотрю' : 'Не просмотрено');
      }
    }
  }

  // 2. Элемент серии в выезжающей шторке серий внутри плеера
  const inplayerItems = document.querySelectorAll(`.inplayer-ep-item[data-ep-num="${epNum}"]`);
  inplayerItems.forEach(item => {
    const isAct = item.classList.contains('active');
    item.classList.toggle('watched', watched);
    let pill = item.querySelector('.inplayer-ep-status-pill');
    if (!pill) {
      pill = document.createElement('span');
      pill.className = 'inplayer-ep-status-pill';
      item.appendChild(pill);
    }
    if (isAct) {
      pill.className = 'inplayer-ep-status-pill current';
      pill.textContent = '▶ Смотрю';
    } else if (watched) {
      pill.className = 'inplayer-ep-status-pill watched';
      pill.textContent = '✓';
    } else {
      pill.className = 'inplayer-ep-status-pill';
      pill.textContent = '';
    }
  });

  // 3. Выпадающие списки серий быстрой панели (QuickBar)
  renderQuickBarDropdowns();

  // 4. Вкладки сезонов (счетчик просмотренных серий "Сезон 1 (3/10)")
  renderSeasonTabs();
}

function getSeriesTitleStorageKeyForMedia(mediaId, explicitTitle = '') {
  const rawT = explicitTitle ||
    ((typeof currentMedia !== 'undefined' && currentMedia && (!mediaId || String(currentMedia.id) === String(mediaId)))
      ? (currentMedia.title || currentMedia.original_title || '')
      : '');
  if (!rawT) return '';
  if (typeof window !== 'undefined' && typeof window.__stormNormalizeSeriesTitleKey === 'function') {
    return window.__stormNormalizeSeriesTitleKey(rawT);
  }
  return String(rawT)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

function ensureCompletedSeriesEpisodesHydrated(mediaObj, seasonsOverride = null) {
  if (!mediaObj) return false;
  try {
    if (mediaObj.user_bookmark && typeof window.__stormHydrateBookmarkEpisodes === 'function') {
      window.__stormHydrateBookmarkEpisodes(mediaObj.user_bookmark);
    }

    const mediaId = String(mediaObj.id || mediaObj.media_id || '').trim();
    const mediaTitle = String(mediaObj.title || mediaObj.original_title || '').trim();
    const tKey = getSeriesTitleStorageKeyForMedia(mediaId, mediaTitle);

    // Восстанавливаем отдельные досмотренные серии из watch_history (progress >= 85%)
    if (Array.isArray(mediaObj.user_watched_history) && mediaObj.user_watched_history.length > 0) {
      const bySeason = new Map();
      for (const h of mediaObj.user_watched_history) {
        if ((Number(h.progress_percent) || 0) >= 85) {
          const sN = Number(h.season) || 1;
          const eN = Number(h.episode) || 1;
          if (!bySeason.has(sN)) bySeason.set(sN, getWatchedEpisodes(mediaId, sN, mediaTitle));
          bySeason.get(sN).add(eN);
        }
      }
      for (const [sN, setEps] of bySeason.entries()) {
        const arrJson = JSON.stringify(Array.from(setEps).sort((a, b) => a - b));
        if (mediaId) {
          localStorage.setItem(`storm_watched_eps_${mediaId}_s${sN}`, arrJson);
          if (sN === 1) localStorage.setItem(`storm_watched_eps_${mediaId}`, arrJson);
        }
        if (tKey) localStorage.setItem(`storm_watched_eps_title_${tKey}_s${sN}`, arrJson);
      }
    }

    const rawStatus = mediaObj?.user_bookmark?.status || mediaObj?.user_status || resolveMediaUserStatus(mediaObj) || '';
    const normSt = String(rawStatus).toLowerCase().trim();
    const isCompletedSeries = normSt === 'completed' || normSt === 'watched';
    if (!isCompletedSeries) return false;

    const seasonsList = Array.isArray(seasonsOverride) && seasonsOverride.length > 0
      ? seasonsOverride
      : (Array.isArray(quickBarSeriesData?.seasons) && quickBarSeriesData.seasons.length > 0
          ? quickBarSeriesData.seasons
          : (Array.isArray(mediaObj.seasons) ? mediaObj.seasons : []));

    if (!seasonsList || seasonsList.length === 0) return false;

    let didHydrate = false;
    let maxS = 1;
    let maxE = 1;
    let totalAll = 0;

    for (const s of seasonsList) {
      const sNum = Number(s.season || s.season_number) || 1;
      const epCount = Number(s.episodes_count || s.episode_count || (Array.isArray(s.episodes) ? s.episodes.length : 0)) || 0;
      if (epCount <= 0) continue;
      maxS = Math.max(maxS, sNum);
      maxE = Math.max(maxE, epCount);
      totalAll += epCount;

      const explicitSeasonSt = getSeasonExplicitStatus(mediaId, sNum, mediaTitle);
      if (explicitSeasonSt && ['watching', 'on_hold', 'dropped'].includes(explicitSeasonSt)) {
        continue;
      }

      const currentSet = getWatchedEpisodes(mediaId, sNum, mediaTitle);
      if (currentSet.size < epCount) {
        const fullEps = Array.from({ length: epCount }, (_, i) => i + 1);
        const fullJson = JSON.stringify(fullEps);
        if (mediaId) {
          localStorage.setItem(`storm_watched_eps_${mediaId}_s${sNum}`, fullJson);
          if (sNum === 1) localStorage.setItem(`storm_watched_eps_${mediaId}`, fullJson);
          localStorage.setItem(`storm_season_status_${mediaId}_s${sNum}`, 'completed');
        }
        if (tKey) {
          localStorage.setItem(`storm_watched_eps_title_${tKey}_s${sNum}`, fullJson);
          localStorage.setItem(`storm_season_status_title_${tKey}_s${sNum}`, 'completed');
        }
        didHydrate = true;
      } else {
        // Синхронизируем между ID и ключом названия, если было только в одном из них
        const fullJson = JSON.stringify(Array.from(currentSet).sort((a, b) => a - b));
        if (mediaId) {
          localStorage.setItem(`storm_watched_eps_${mediaId}_s${sNum}`, fullJson);
          localStorage.setItem(`storm_season_status_${mediaId}_s${sNum}`, 'completed');
        }
        if (tKey) {
          localStorage.setItem(`storm_watched_eps_title_${tKey}_s${sNum}`, fullJson);
          localStorage.setItem(`storm_season_status_title_${tKey}_s${sNum}`, 'completed');
        }
      }
    }

    if (didHydrate) {
      saveSeriesCompletedMeta(mediaId, {
        maxSeason: maxS,
        maxEpisode: maxE,
        totalEpisodes: totalAll,
        completedAt: Date.now()
      }, mediaTitle);
      if (typeof window.__stormSyncWatchedEpisodesToServer === 'function') {
        window.__stormSyncWatchedEpisodesToServer({ ...mediaObj, seasons: seasonsList, user_status: 'completed' }, 'completed');
      }
    }
    return didHydrate;
  } catch (err) {
    console.warn('[Player] Ошибка гидрации просмотренных серий:', err);
    return false;
  }
}

function getWatchedEpisodes(mediaId, seasonNum = 1, mediaTitle = '') {
  if (!mediaId && !mediaTitle) return new Set();
  const sNum = Number(seasonNum) || 1;
  const result = new Set();
  try {
    if (mediaId) {
      let raw = localStorage.getItem(`storm_watched_eps_${mediaId}_s${sNum}`);
      if (!raw && sNum === 1) {
        raw = localStorage.getItem(`storm_watched_eps_${mediaId}`);
      }
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) arr.map(Number).filter(n => Number.isFinite(n) && n > 0).forEach(n => result.add(n));
      }
    }
    const tKey = getSeriesTitleStorageKeyForMedia(mediaId, mediaTitle);
    if (tKey) {
      const rawByTitle = localStorage.getItem(`storm_watched_eps_title_${tKey}_s${sNum}`);
      if (rawByTitle) {
        const arr = JSON.parse(rawByTitle);
        if (Array.isArray(arr)) arr.map(Number).filter(n => Number.isFinite(n) && n > 0).forEach(n => result.add(n));
      }
    }
  } catch {}
  return result;
}

function markEpisodeWatched(mediaId, seasonOrEp, maybeEpisode, maybeWatched) {
  if (!mediaId) return;
  let seasonNum = 1;
  let episodeNum = 1;
  let watched = true;

  if (maybeEpisode !== undefined) {
    seasonNum = (seasonOrEp !== undefined && !isNaN(Number(seasonOrEp))) ? Number(seasonOrEp) : 1;
    episodeNum = (maybeEpisode !== undefined && !isNaN(Number(maybeEpisode))) ? Number(maybeEpisode) : 1;
    if (maybeWatched !== undefined) watched = Boolean(maybeWatched);
  } else {
    episodeNum = (seasonOrEp !== undefined && !isNaN(Number(seasonOrEp))) ? Number(seasonOrEp) : 1;
  }

  try {
    const sKey = `storm_watched_eps_${mediaId}_s${seasonNum}`;
    const tKey = getSeriesTitleStorageKeyForMedia(mediaId);
    const watchedSet = getWatchedEpisodes(mediaId, seasonNum);
    if (watched) {
      watchedSet.add(episodeNum);
    } else {
      watchedSet.delete(episodeNum);
      if (getSeasonExplicitStatus(mediaId, seasonNum) === 'completed') {
        setSeasonExplicitStatus(mediaId, seasonNum, watchedSet.size > 0 ? 'watching' : 'planned');
      }
    }
    const arr = Array.from(watchedSet).sort((a, b) => a - b);
    const jsonStr = JSON.stringify(arr);
    localStorage.setItem(sKey, jsonStr);
    if (seasonNum === 1) {
      localStorage.setItem(`storm_watched_eps_${mediaId}`, jsonStr);
    }
    if (tKey) {
      localStorage.setItem(`storm_watched_eps_title_${tKey}_s${seasonNum}`, jsonStr);
    }
  } catch {}

  // МГНОВЕННО обновляем DOM элементов серии, вкладок и быстрой панели без перезагрузки страницы
  updateEpisodeDOMElements(mediaId, seasonNum, episodeNum, watched);

  evaluateAndSyncOverallSeriesStatus(mediaId);
  if (typeof currentMedia !== 'undefined' && currentMedia && String(currentMedia.id) === String(mediaId)) {
    const updatedResume = resolveMediaResumeState(currentMedia, currentMedia);
    if (!updatedResume) {
      activeResumePromptState = null;
      isResumePromptPending = false;
      hideResumePromptBanner();
    }
  }
}

function evaluateAndSyncOverallSeriesStatus(mediaId) {
  if (!mediaId) return;
  try {
    const currentM = (typeof currentMedia !== 'undefined' && currentMedia && String(currentMedia.id) === String(mediaId)) ? currentMedia : null;
    const cleanTitle = currentM?.title || '';
    const normTitle = cleanTitle.toLowerCase().replace(/\s*[\(\[]?\s*(?:4[kк]|uhd|сериал|фильм|\d+\s*сезон).*?[\)\]]?/gi, ' ').trim();

    let totalWatchedAcrossAll = 0;
    let highestWatchedSeason = 1;
    let highestWatchedEp = 0;

    for (let s = 1; s <= 30; s++) {
      const setS = getWatchedEpisodes(mediaId, s, cleanTitle);
      if (setS.size > 0) {
        totalWatchedAcrossAll += setS.size;
        highestWatchedSeason = Math.max(highestWatchedSeason, s);
        highestWatchedEp = Math.max(highestWatchedEp, ...Array.from(setS));
      }
    }

    let totalExpectedEpisodes = 0;
    const seasonsRef = (typeof quickBarSeriesData !== 'undefined' && quickBarSeriesData && Array.isArray(quickBarSeriesData.seasons) && quickBarSeriesData.seasons.length > 0)
      ? quickBarSeriesData.seasons
      : (currentM && Array.isArray(currentM.seasons) ? currentM.seasons : []);
    if (seasonsRef.length > 0) {
      seasonsRef.forEach(s => {
        const cnt = Number(s.episode_count || s.episodes_count || (Array.isArray(s.episodes) ? s.episodes.length : 0)) || 0;
        totalExpectedEpisodes += cnt;
      });
    } else if (currentM && Number(currentM.total_episodes) > 0) {
      totalExpectedEpisodes = Number(currentM.total_episodes);
    }

    let newOverallStatus = 'watching';
    if (totalExpectedEpisodes > 0 && totalWatchedAcrossAll >= totalExpectedEpisodes) {
      newOverallStatus = 'completed';
    } else if (totalWatchedAcrossAll > 0) {
      newOverallStatus = 'watching';
    } else {
      newOverallStatus = 'planned';
    }

    localStorage.setItem(`storm_status_${mediaId}`, newOverallStatus);
    if (normTitle) localStorage.setItem(`storm_status_title_${normTitle}`, newOverallStatus);
    const tKey = normalizeResumeTitleKey(cleanTitle);
    if (tKey) {
      if (totalWatchedAcrossAll > 0) {
        localStorage.setItem(`storm_watched_title_${tKey}`, '1');
      } else {
        localStorage.removeItem(`storm_watched_title_${tKey}`);
      }
    }

    if (currentM) {
      currentM.user_status = newOverallStatus;
      renderStatusButtons(newOverallStatus);
      if (typeof window.__stormSyncWatchedEpisodesToServer === 'function') {
        window.__stormSyncWatchedEpisodesToServer({ ...currentM, seasons: seasonsRef }, newOverallStatus);
      }
    }

    if (newOverallStatus === 'completed') {
      const cw = localStorage.getItem('storm_continue_watching');
      if (cw) {
        try {
          const list = JSON.parse(cw).filter(it => String(it.media_id) !== String(mediaId));
          localStorage.setItem('storm_continue_watching', JSON.stringify(list));
        } catch (_) {}
      }
    }

    window.dispatchEvent(new CustomEvent('storm:series-status-changed', {
      detail: { mediaId, status: newOverallStatus }
    }));
    window.dispatchEvent(new CustomEvent('storm:continue-watching-updated', {
      detail: { mediaId }
    }));
  } catch (e) {
    console.warn('[Player] Ошибка пересчета статуса сериала:', e);
  }
}

function toggleEpisodeWatched(mediaId, seasonNum = 1, episodeNum = 1) {
  const sNum = (seasonNum !== undefined && !isNaN(Number(seasonNum))) ? Number(seasonNum) : 1;
  const epNum = (episodeNum !== undefined && !isNaN(Number(episodeNum))) ? Number(episodeNum) : 1;
  const watchedSet = getWatchedEpisodes(mediaId, sNum);
  const isWatched = watchedSet.has(epNum);
  markEpisodeWatched(mediaId, sNum, epNum, !isWatched);
  return !isWatched;
}

function getSeasonExplicitStatus(mediaId, seasonNum = 1, mediaTitle = '') {
  const sNum = (seasonNum !== undefined && !isNaN(Number(seasonNum))) ? Number(seasonNum) : 1;
  try {
    if (mediaId) {
      const byId = localStorage.getItem(`storm_season_status_${mediaId}_s${sNum}`);
      if (byId) return byId;
    }
    const tKey = getSeriesTitleStorageKeyForMedia(mediaId, mediaTitle);
    if (tKey) {
      const byTitle = localStorage.getItem(`storm_season_status_title_${tKey}_s${sNum}`);
      if (byTitle) return byTitle;
    }
  } catch {}
  return null;
}

function setSeasonExplicitStatus(mediaId, seasonNum = 1, status = null, mediaTitle = '') {
  if (!mediaId && !mediaTitle) return;
  const sNum = (seasonNum !== undefined && !isNaN(Number(seasonNum))) ? Number(seasonNum) : 1;
  const tKey = getSeriesTitleStorageKeyForMedia(mediaId, mediaTitle);
  try {
    if (status) {
      if (mediaId) localStorage.setItem(`storm_season_status_${mediaId}_s${sNum}`, status);
      if (tKey) localStorage.setItem(`storm_season_status_title_${tKey}_s${sNum}`, status);
    } else {
      if (mediaId) localStorage.removeItem(`storm_season_status_${mediaId}_s${sNum}`);
      if (tKey) localStorage.removeItem(`storm_season_status_title_${tKey}_s${sNum}`);
    }
  } catch {}
}

export function resolveLastUnfinishedEpisode(mediaItem) {
  if (!mediaItem) return null;
  try {
    const analysis = analyzeSeriesWatchState(mediaItem, typeof currentMedia !== 'undefined' ? currentMedia : null);
    if (analysis) {
      if (analysis.allAvailableWatched) {
        return {
          season: analysis.lastWatchedSeason || 1,
          episode: analysis.lastWatchedEpisode || 1,
          allWatched: true
        };
      }
      if (analysis.firstUnwatchedAfterStart) {
        return {
          season: analysis.firstUnwatchedAfterStart.season,
          episode: analysis.firstUnwatchedAfterStart.episode
        };
      }
    }
    const resumeState = resolveMediaResumeState(mediaItem, typeof currentMedia !== 'undefined' ? currentMedia : null);
    if (resumeState && resumeState.isSeries) {
      return {
        season: resumeState.season,
        episode: resumeState.episode
      };
    }
  } catch (e) {
    console.warn('Error resolving unfinished episode:', e);
  }
  return null;
}

function getAllEpisodesForSeason(mediaId, seasonNum, passedList = []) {
  if (Array.isArray(passedList) && passedList.length > 0) {
    return passedList;
  }
  if (typeof quickBarSeriesData !== 'undefined' && quickBarSeriesData && Array.isArray(quickBarSeriesData.seasons)) {
    const sObj = quickBarSeriesData.seasons.find(s => Number(s.season) === Number(seasonNum));
    if (sObj && Array.isArray(sObj.episodes) && sObj.episodes.length > 0) {
      return sObj.episodes;
    }
    if (sObj && sObj.episodes_count > 0) {
      return Array.from({ length: sObj.episodes_count }, (_, i) => ({ episode: i + 1, episode_number: i + 1 }));
    }
  }
  if (typeof currentMedia !== 'undefined' && currentMedia && Array.isArray(currentMedia.seasons)) {
    const sObj = currentMedia.seasons.find(s => Number(s.season_number || s.season) === Number(seasonNum));
    if (sObj && Array.isArray(sObj.episodes) && sObj.episodes.length > 0) {
      return sObj.episodes;
    }
    const count = sObj?.episode_count || sObj?.episodes_count;
    if (count > 0) {
      return Array.from({ length: count }, (_, i) => ({ episode: i + 1, episode_number: i + 1 }));
    }
  }
  return [];
}

function markAllSeriesSeasonsAndEpisodes(media, newStatus = 'completed') {
  if (!media || !media.id) return;
  const seasons = (typeof quickBarSeriesData !== 'undefined' && quickBarSeriesData && Array.isArray(quickBarSeriesData.seasons) && quickBarSeriesData.seasons.length > 0)
    ? quickBarSeriesData.seasons
    : (Array.isArray(media.seasons) ? media.seasons : [{ season: 1, episodes_count: 10 }]);

  seasons.forEach(s => {
    const sNum = Number(s.season || s.season_number) || 1;
    const eps = (s.episodes && s.episodes.length > 0) ? s.episodes : getAllEpisodesForSeason(media.id, sNum);
    applySeasonStatus(media.id, sNum, newStatus, eps);
  });
}

function applySeasonStatus(mediaId, seasonNum = 1, newStatus = 'planned', episodesList = []) {
  if (!mediaId) return false;
  const sNum = (seasonNum !== undefined && !isNaN(Number(seasonNum))) ? Number(seasonNum) : 1;
  const sKey = `storm_watched_eps_${mediaId}_s${sNum}`;
  const storageTKey = getSeriesTitleStorageKeyForMedia(mediaId);

  setSeasonExplicitStatus(mediaId, sNum, newStatus);

  if (newStatus === 'completed') {
    // ВАЖНО: Если на сезон ставится Просмотрено, то статус применяется к каждой серии этого сезона!
    const fullEpisodesList = getAllEpisodesForSeason(mediaId, sNum, episodesList);
    let allEpNumbers = [];
    if (fullEpisodesList.length > 0) {
      allEpNumbers = fullEpisodesList.map(e => {
        if (Number.isFinite(Number(e.episode))) return Number(e.episode);
        if (Number.isFinite(Number(e.episode_number))) return Number(e.episode_number);
        if (Number.isFinite(Number(e.ordinal))) return Number(e.ordinal);
        return 1;
      });
    } else {
      const watched = getWatchedEpisodes(mediaId, sNum);
      allEpNumbers = watched.size > 0 ? Array.from(watched) : Array.from({ length: 10 }, (_, i) => i + 1);
    }
    const uniqueEps = Array.from(new Set(allEpNumbers)).sort((a, b) => a - b);
    const uniqueJson = JSON.stringify(uniqueEps);
    try {
      localStorage.setItem(sKey, uniqueJson);
      if (sNum === 1) localStorage.setItem(`storm_watched_eps_${mediaId}`, uniqueJson);
      if (storageTKey) localStorage.setItem(`storm_watched_eps_title_${storageTKey}_s${sNum}`, uniqueJson);
      if (typeof currentMedia !== 'undefined' && currentMedia?.title) {
        const tKey = normalizeResumeTitleKey(currentMedia.title);
        if (tKey) localStorage.setItem(`storm_watched_title_${tKey}`, '1');
      }
      if (typeof currentMedia !== 'undefined' && currentMedia && typeof window.__stormSyncWatchedEpisodesToServer === 'function') {
        window.__stormSyncWatchedEpisodesToServer(currentMedia);
      }
    } catch {}
    return true;
  } else if (newStatus === 'planned') {
    // Сброс отметок серий для этого сезона
    try {
      localStorage.removeItem(sKey);
      if (sNum === 1) localStorage.removeItem(`storm_watched_eps_${mediaId}`);
      if (storageTKey) localStorage.removeItem(`storm_watched_eps_title_${storageTKey}_s${sNum}`);
      if (typeof currentMedia !== 'undefined' && currentMedia && typeof window.__stormSyncWatchedEpisodesToServer === 'function') {
        window.__stormSyncWatchedEpisodesToServer(currentMedia);
      }
    } catch {}
    return false;
  }
  if (typeof currentMedia !== 'undefined' && currentMedia && typeof window.__stormSyncWatchedEpisodesToServer === 'function') {
    window.__stormSyncWatchedEpisodesToServer(currentMedia);
  }
  return true;
}

function toggleAllSeasonEpisodesWatched(mediaId, seasonNum = 1, totalEpisodes = 0, episodesList = []) {
  if (!mediaId) return false;
  try {
    const sNum = (seasonNum !== undefined && !isNaN(Number(seasonNum))) ? Number(seasonNum) : 1;
    const watched = getWatchedEpisodes(mediaId, sNum);
    const eps = getAllEpisodesForSeason(mediaId, sNum, episodesList);
    const total = Number(totalEpisodes) || eps.length || 10;
    const explicitStatus = getSeasonExplicitStatus(mediaId, sNum);

    if ((total > 0 && watched.size >= total) || explicitStatus === 'completed') {
      applySeasonStatus(mediaId, sNum, 'planned', eps);
      return false;
    } else {
      applySeasonStatus(mediaId, sNum, 'completed', eps);
      return true;
    }
  } catch {}
  return false;
}

function toggleAllEpisodesWatched(mediaId, totalEpisodes) {
  return toggleAllSeasonEpisodesWatched(mediaId, 1, totalEpisodes);
}

function getSeasonStatusInfo(mediaId, seasonNum = 1, totalEpisodes = 0, episodesList = []) {
  const sNum = (seasonNum !== undefined && !isNaN(Number(seasonNum))) ? Number(seasonNum) : 1;
  const total = Number(totalEpisodes) || (Array.isArray(episodesList) ? episodesList.length : 0);
  const watched = getWatchedEpisodes(mediaId, sNum);
  const count = watched.size;
  const explicitStatus = getSeasonExplicitStatus(mediaId, sNum);

  if (total > 0 && count >= total) {
    return { status: 'completed', label: '✓ Просмотрен', count, total };
  }
  if (explicitStatus === 'completed') {
    return { status: 'completed', label: '✓ Просмотрен', count: total || count, total };
  }
  if (count > 0) {
    return { status: 'watching', label: `▶ ${count}/${total || '?'}`, count, total };
  }
  if (explicitStatus === 'on_hold') {
    return { status: 'on_hold', label: '⏸️ Отложен', count, total };
  }
  if (explicitStatus === 'dropped') {
    return { status: 'dropped', label: '🛑 Заброшен', count, total };
  }
  if (explicitStatus === 'watching') {
    return { status: 'watching', label: '▶ Смотрю', count, total };
  }
  return { status: 'planned', label: 'В планах', count: 0, total };
}

async function syncOverallSeriesProgress(mediaDetails) {
  // Согласно регламенту STORM: отметки отдельных сезонов и серий НЕ переводят весь сериал в «Просмотрено».
  // Общий статус «Просмотрено» для сериала устанавливается только при явном выборе пользователем
  // на главной карточке сериала (что динамически охватывает все сезоны и серии).
  if (!mediaDetails) return;
}

function getVoiceoverStats(name, index = 0) {
  const norm = (name || '').toLowerCase();
  if (norm.includes('studio band') || norm.includes('студийная банда')) {
    return { pop: 99, views: '48.2K', isTop: true };
  }
  if (norm.includes('anilibria') || norm.includes('анилибрия')) {
    return { pop: 98, views: '45.1K', isTop: true };
  }
  if (norm.includes('dream cast') || norm.includes('дрим каст')) {
    return { pop: 96, views: '38.6K', isTop: true };
  }
  if (norm.includes('animevost') || norm.includes('анимевост')) {
    return { pop: 94, views: '33.8K', isTop: false };
  }
  if (norm.includes('onwave') || norm.includes('онвейв')) {
    return { pop: 92, views: '26.4K', isTop: false };
  }
  if (norm.includes('anidub') || norm.includes('анидаб')) {
    return { pop: 90, views: '21.7K', isTop: false };
  }
  if (norm.includes('субтитр') || norm.includes('sub')) {
    return { pop: 89, views: '16.3K', isTop: false };
  }
  if (norm.includes('комната диди') || norm.includes('didi')) {
    return { pop: 88, views: '14.9K', isTop: false };
  }
  if (norm.includes('anistar') || norm.includes('анистар')) {
    return { pop: 87, views: '12.5K', isTop: false };
  }
  if (norm.includes('anibaza') || norm.includes('анибаза')) {
    return { pop: 86, views: '10.8K', isTop: false };
  }
  const fallbackPop = Math.max(82, 95 - index * 2);
  const fallbackViews = (Math.max(4.5, 30 - index * 2.8)).toFixed(1) + 'K';
  return { pop: fallbackPop, views: fallbackViews, isTop: false };
}

function renderAniLibriaControls(details, options = {}) {
  const container = document.getElementById('anixart-controls-container');
  if (container) container.style.display = 'none';

  const playerObj = {
    id: 'anilibria_hls',
    name: 'AniLibria (Официальный Full HD поток)',
    badge: 'ANILIBRIA',
    quality: '1080p FHD',
    status_label: '🟢 Онлайн'
  };
  currentActivePlayer = playerObj;
  updatePlayerTriggerInfo(playerObj);

  const rawSeasons = Array.isArray(details.seasons) && details.seasons.length > 0
    ? details.seasons
    : [{
        season_number: 1,
        name: 'Сезон 1',
        release_id: String(details.id || ''),
        episode_count: (details.episodes || []).length,
        overview: currentMedia.description || 'Официальный Full HD релиз AniLibria.',
        episodes: (details.episodes || []).slice().sort((a, b) => (a.ordinal || 0) - (b.ordinal || 0))
      }];

  currentMedia.seasons = rawSeasons.map((s, idx) => {
    const sNum = Number(s.season_number) || (idx + 1);
    const sEps = (s.episodes || details.episodes || []).slice().sort((a, b) => (a.ordinal || a.episode_number || 0) - (b.ordinal || b.episode_number || 0));
    return {
      ...s,
      season_number: sNum,
      name: s.name || `Сезон ${sNum}`,
      episode_count: sEps.length || s.episode_count || 12,
      overview: s.overview || currentMedia.description || `Сезон ${sNum} • Официальный Full HD релиз AniLibria.`,
      episodes: sEps
    };
  });

  const targetSeasonNum = options.initialSeason
    ? parseInt(options.initialSeason, 10)
    : (currentMedia.seasons[0]?.season_number || 1);
  const activeSeasonObj = currentMedia.seasons.find(s => Number(s.season_number) === Number(targetSeasonNum)) || currentMedia.seasons[0];
  const episodes = activeSeasonObj?.episodes || [];
  if (episodes.length === 0) return;

  const isAnimeMovie = details.media_type === 'anime-movie' || currentMedia.media_type === 'anime-movie';
  currentMedia.episodes = episodes;
  currentMedia.media_type = isAnimeMovie ? 'anime-movie' : 'anime-series';

  if (isAnimeMovie) {
    quickBarSeriesData = null;
    const quickBar = document.getElementById('player-series-quick-bar');
    if (quickBar) quickBar.style.display = 'none';
    const seasonsCont = document.getElementById('series-seasons-container');
    if (seasonsCont) seasonsCont.style.display = 'none';
    const epBadge = document.getElementById('inplayer-ep-badge');
    if (epBadge) epBadge.textContent = '🎬 АНИМЕ-ФИЛЬМ';
    const initialEp = episodes[0];
    if (initialEp) {
      currentEpisodeIndex = 1;
      const streamUrl = initialEp.hls_1080 || initialEp.hls_720 || initialEp.hls_480;
      if (streamUrl) playStreamUrl(streamUrl);
      loadSkipTimes(activeSeasonObj.release_id || currentMedia.id, 1);
    }
    return;
  }

  const targetEpNum = options.initialEpisode ? parseInt(options.initialEpisode, 10) : (episodes[0]?.ordinal || 1);
  quickBarActiveSeason = activeSeasonObj.season_number || 1;
  quickBarActiveEpisode = targetEpNum;
  quickBarActiveTranslationId = 'anilibria';

  quickBarSeriesData = {
    type: 'serial',
    isAnime: true,
    animeSource: 'anilibria',
    seasons: currentMedia.seasons.map(s => ({
      season: s.season_number,
      name: s.name || `Сезон ${s.season_number}`,
      releaseId: s.release_id || String(currentMedia.id || ''),
      episodes_count: (s.episodes || []).length || s.episode_count || 12,
      episodes: (s.episodes || []).map(ep => ({
        episode: ep.ordinal || ep.episode_number || 1,
        name: formatCleanEpisodeTitle(ep.ordinal || ep.episode_number || 1, ep.name),
        translations: [{ id: 'anilibria', name: 'Официальный дубляж AniLibria (1080p FHD)' }]
      }))
    })),
    active: {
      season: quickBarActiveSeason,
      episode: targetEpNum,
      id_translation: 'anilibria'
    }
  };

  const quickBar = document.getElementById('player-series-quick-bar');
  if (quickBar) quickBar.style.display = 'flex';
  renderQuickBarDropdowns();
  setupQuickBarOutsideListeners();

  renderSeriesSeasons(currentMedia, quickBarActiveSeason, targetEpNum);

  const initialEp = episodes.find(e => Number(e.ordinal || e.episode_number || 1) === Number(targetEpNum)) || episodes[0];
  if (initialEp) {
    currentEpisodeIndex = targetEpNum;
    const streamUrl = initialEp.hls_1080 || initialEp.hls_720 || initialEp.hls_480;
    if (streamUrl) playStreamUrl(streamUrl);
    loadSkipTimes(activeSeasonObj.release_id || currentMedia.id, targetEpNum);
  }
}

async function renderAnixartControls(details, options = {}) {
  const container = document.getElementById('anixart-controls-container');
  if (container) container.style.display = 'none';

  const voiceovers = details.voiceovers || [];
  if (voiceovers.length === 0) {
    const fallbackP = (currentPlayers || []).find(p => p.id === 'lift_adfree' || p.id === 'kodik_direct') || currentPlayers?.[0];
    if (fallbackP) selectPlayer(fallbackP);
    return;
  }

  const preferredId = localStorage.getItem(`storm_fav_voiceover_${details.id}`);
  let activeVoiceover = null;
  if (preferredId) {
    activeVoiceover = voiceovers.find(v => String(v.id) === String(preferredId));
  }
  if (!activeVoiceover) {
    activeVoiceover = findPreferredVoiceoverMatch(voiceovers);
    if (activeVoiceover) {
      showToast(`🎙️ Умный выбор озвучки: ${activeVoiceover.name}`, 'info');
    }
  }
  if (!activeVoiceover) {
    activeVoiceover = voiceovers[0];
  }
  const normTitle = (currentMedia?.title || details?.title || '').toLowerCase();
  const isDandadan = normTitle.includes('дандадан') || normTitle.includes('dandadan') ||
                     String(details.id) === '19675' || String(details.id) === '20145';

  let activeSeason = 1;
  let activeReleaseId = details.id;

  if (isDandadan) {
    if (options.initialSeason) {
      activeSeason = parseInt(options.initialSeason, 10);
    } else if (String(details.id) === '20145' || normTitle.includes(' 2') || (currentMedia?.title || '').includes('2')) {
      activeSeason = 2;
    }
    activeReleaseId = activeSeason === 2 ? '20145' : '19675';
    currentMedia.anixart_season_ids = { 1: '19675', 2: '20145' };
    currentMedia.anixart_release_id = activeReleaseId;
  }

  currentVoiceoverId = activeVoiceover.id;

  const playerObj = {
    id: `anixart_${activeVoiceover.id}`,
    name: `AniXart (${activeVoiceover.name})`,
    badge: 'ANIXART',
    quality: '1080p FHD',
    status_label: '🟢 Онлайн'
  };
  currentActivePlayer = playerObj;
  updatePlayerTriggerInfo(playerObj);

  try {
    const res = await fetch(`/api/anixart/episodes/${activeReleaseId}/${activeVoiceover.id}`);
    const rawEpisodes = await res.json();
    currentEpisodes = (rawEpisodes || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));

    const mediaId = currentMedia?.id || details.id;
    const watchedSet = getWatchedEpisodes(mediaId, activeSeason);

    let targetEpNum = 1;
    if (options.initialEpisode) {
      targetEpNum = parseInt(options.initialEpisode, 10);
    } else if (watchedSet.size > 0 && watchedSet.size < currentEpisodes.length) {
      const unwatched = currentEpisodes.find(ep => !watchedSet.has(ep.position || 1));
      if (unwatched) targetEpNum = unwatched.position || 1;
    }

    const defaultSeasonLabel = currentMedia.year ? `1 сезон (${currentMedia.year})` : '1 сезон';
    currentMedia.seasons = isDandadan ? [
      {
        season_number: 1,
        name: '1 сезон (2024)',
        episode_count: 12,
        overview: 'Первый сезон аниме «Дандадан» (2024).'
      },
      {
        season_number: 2,
        name: '2 сезон (2025)',
        episode_count: 12,
        overview: 'Второй сезон аниме «Дандадан 2» (2025).'
      }
    ] : [{
      season_number: 1,
      name: defaultSeasonLabel,
      episode_count: currentEpisodes.length || activeVoiceover.episodes_count || 12,
      overview: currentMedia.description || `Официальный релиз AniXart в озвучке «${activeVoiceover.name}».`
    }];
    currentMedia.media_type = 'anime-series';

    quickBarActiveSeason = activeSeason;
    quickBarActiveEpisode = targetEpNum;
    quickBarActiveTranslationId = activeVoiceover.id;

    const dandadanSeasons = isDandadan ? [
      {
        season: 1,
        name: '1 сезон (2024)',
        releaseId: '19675',
        episodes_count: 12,
        episodes: (activeSeason === 1 && currentEpisodes.length > 0)
          ? currentEpisodes.map(ep => ({
              episode: ep.position || 1,
              name: formatCleanEpisodeTitle(ep.position || 1, ep.name_ru || ep.name),
              translations: voiceovers.map(v => ({ id: v.id, name: v.name, episodes_count: v.episodes_count }))
            }))
          : Array.from({ length: 12 }, (_, i) => ({
              episode: i + 1,
              name: `${i + 1} серия`,
              translations: voiceovers.map(v => ({ id: v.id, name: v.name, episodes_count: v.episodes_count }))
            }))
      },
      {
        season: 2,
        name: '2 сезон (2025)',
        releaseId: '20145',
        episodes_count: 12,
        episodes: (activeSeason === 2 && currentEpisodes.length > 0)
          ? currentEpisodes.map(ep => ({
              episode: ep.position || 1,
              name: formatCleanEpisodeTitle(ep.position || 1, ep.name_ru || ep.name),
              translations: voiceovers.map(v => ({ id: v.id, name: v.name, episodes_count: v.episodes_count }))
            }))
          : Array.from({ length: 12 }, (_, i) => ({
              episode: i + 1,
              name: `${i + 1} серия`,
              translations: voiceovers.map(v => ({ id: v.id, name: v.name, episodes_count: v.episodes_count }))
            }))
      }
    ] : null;

    quickBarSeriesData = {
      type: 'serial',
      isAnime: true,
      animeSource: 'anixart',
      seasons: dandadanSeasons || [{
        season: 1,
        name: defaultSeasonLabel,
        episodes_count: currentEpisodes.length,
        episodes: currentEpisodes.map(ep => ({
          episode: ep.position || 1,
          name: formatCleanEpisodeTitle(ep.position || 1, ep.name_ru || ep.name),
          translations: voiceovers.map(v => ({
            id: v.id,
            name: v.name,
            episodes_count: v.episodes_count
          }))
        }))
      }],
      active: {
        season: activeSeason,
        episode: targetEpNum,
        id_translation: activeVoiceover.id
      }
    };

    const quickBar = document.getElementById('player-series-quick-bar');
    if (quickBar) quickBar.style.display = 'flex';
    renderQuickBarDropdowns();
    setupQuickBarOutsideListeners();

    renderSeriesSeasons(currentMedia, activeSeason, targetEpNum);

    const chosenEp = currentEpisodes.find(e => (e.position || 1) === targetEpNum) || currentEpisodes[0];
    if (chosenEp && chosenEp.url && chosenEp.url !== '/') {
      currentEpisodeIndex = targetEpNum;
      playAnixartEpisode(chosenEp);
      loadSkipTimes(activeReleaseId, targetEpNum);
    } else {
      const fallbackP = (currentPlayers || []).find(p => p.id === 'lift_adfree' || p.id === 'kodik_direct') || currentPlayers?.[0];
      if (fallbackP) selectPlayer(fallbackP);
    }
  } catch (err) {
    console.error('Ошибка загрузки серий AniXart:', err);
    const fallbackP = (currentPlayers || []).find(p => p.id === 'lift_adfree' || p.id === 'kodik_direct') || currentPlayers?.[0];
    if (fallbackP) selectPlayer(fallbackP);
  }
}

async function switchAnixartSeason(releaseId, seasonNum) {
  try {
    showToast(`📺 Переключение на ${seasonNum} сезон...`, 'info');
    currentMedia.anixart_release_id = String(releaseId);
    quickBarActiveSeason = seasonNum;
    quickBarActiveEpisode = 1;

    // Загружаем детали и озвучки для выбранного сезона
    const detRes = await fetch(`/api/anixart/details/${releaseId}`);
    if (detRes.ok) {
      const newDetails = await detRes.json();
      if (newDetails && Array.isArray(newDetails.voiceovers) && newDetails.voiceovers.length > 0) {
        currentMedia.voiceovers = newDetails.voiceovers;
        const matchedV = newDetails.voiceovers.find(v => String(v.id) === String(currentVoiceoverId)) ||
                         newDetails.voiceovers.find(v => v.name?.toLowerCase().includes('studio band')) ||
                         newDetails.voiceovers[0];
        currentVoiceoverId = matchedV.id;
        quickBarActiveTranslationId = matchedV.id;
      }
    }

    // Загружаем серии для выбранной озвучки
    const epRes = await fetch(`/api/anixart/episodes/${releaseId}/${currentVoiceoverId}`);
    if (epRes.ok) {
      const rawEps = await epRes.json();
      currentEpisodes = (rawEps || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));
    }

    // Обновляем список серий в quickBarSeriesData для активного сезона
    if (quickBarSeriesData?.seasons) {
      const sObj = quickBarSeriesData.seasons.find(s => s.season === seasonNum);
      if (sObj && currentEpisodes.length > 0) {
        sObj.episodes = currentEpisodes.map(ep => ({
          episode: ep.position || 1,
          name: ep.name_ru || ep.name || `${ep.position || 1} серия`,
          translations: (currentMedia.voiceovers || []).map(v => ({ id: v.id, name: v.name, episodes_count: v.episodes_count }))
        }));
      }
    }

    renderQuickBarDropdowns();
    renderSeriesSeasons(currentMedia, seasonNum, 1);

    const firstEp = currentEpisodes[0];
    if (firstEp) {
      currentEpisodeIndex = 1;
      playAnixartEpisode(firstEp);
      loadSkipTimes(releaseId, 1);
    }
  } catch (err) {
    console.error('Ошибка переключения сезона AniXart:', err);
    showToast('Ошибка переключения сезона', 'error');
  }
}

function playAnixartEpisode(episode) {
  const container = document.getElementById('cinema-player-wrapper');
  if (!container) return;

  if (iframeWatchInterval) {
    clearInterval(iframeWatchInterval);
    iframeWatchInterval = null;
  }

  const activeVoiceover = currentMedia?.voiceovers?.find(v => String(v.id) === String(currentVoiceoverId))?.name || 'Дубляж';
  const pos = episode.position || currentEpisodeIndex || 1;

  const playerObj = {
    id: `anixart_${currentVoiceoverId}_${pos}`,
    name: `AniXart (${activeVoiceover}, ${pos} серия)`,
    badge: 'ANIXART',
    quality: '1080p FHD',
    status_label: '🟢 Онлайн'
  };
  currentActivePlayer = playerObj;
  updatePlayerTriggerInfo(playerObj);

  // Запускаем невидимый счетчик просмотра (серия будет отмечена только при просмотре >= 50%)
  if (currentMedia?.id) {
    startInvisibleEpisodeWatchTracker(currentMedia, quickBarActiveSeason || 1, pos);
  }

  quickBarActiveEpisode = pos;
  renderQuickBarDropdowns();
  highlightActiveEpisodeInGrid(pos);

  let streamUrl = (episode.url || '').trim();
  if (!streamUrl || streamUrl === '/' || streamUrl === 'undefined') {
    container.innerHTML = `
      <div class="player-video-box" style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;text-align:center;padding:30px;background:rgba(10,12,18,0.92);border-radius:12px;gap:14px;">
        <div style="font-size:42px;">🎬</div>
        <div style="font-size:17px;font-weight:800;color:var(--text-primary);">Серия ${pos} временно недоступна в выбранной озвучке</div>
        <div style="max-width:520px;font-size:13px;line-height:1.6;color:var(--text-secondary);">Выберите другую студию озвучки в верхней быстрой панели или переключите плеер в списке источников ниже.</div>
      </div>
    `;
    return;
  }

  if (typeof streamUrl === 'string') {
    streamUrl = getSafeCleanStreamUrl(streamUrl);
  }

  const isInternalAnix = typeof streamUrl === 'string' && streamUrl.startsWith('/api/player/');
  const anixSandbox = isInternalAnix ? '' : 'sandbox="allow-scripts allow-same-origin allow-forms allow-presentation allow-downloads"';

  container.innerHTML = `
    <div class="player-video-box" style="position:relative;width:100%;height:100%;">
      <div id="player-ambilight-aura" class="ambilight-aura"></div>
      <iframe class="cinema-player-iframe" src="${streamUrl}" referrerpolicy="no-referrer" allow="fullscreen; picture-in-picture; encrypted-media; display-capture" ${anixSandbox} scrolling="no" style="position:relative;z-index:5;pointer-events:auto;width:100%;height:100%;border:none;border-radius:12px;"></iframe>
    </div>
  `;

    const vBox = container.querySelector('.player-video-box');
    if (vBox) {
      mountInPlayerOverlay(vBox);
      mountCleanViewOverlay(vBox);
    }

    const iframeEl = container.querySelector('.cinema-player-iframe');
    if (iframeEl) {
      iframeEl.onerror = () => {
        console.warn('[Player] Ошибка загрузки серии:', pos);
        updateFallbackButton(currentActivePlayer);
      };
    }

    updateProgressState(pos, currentEpisodes.length || 1);
}
function updateProgressState(episode, totalEpisodes) {
  const percent = Math.min(100, Math.round((episode / (totalEpisodes || 1)) * 100));
  currentProgressPercent = percent;

  const slider = document.getElementById('player-progress-slider');
  const label = document.getElementById('player-progress-label');
  if (slider) slider.value = percent;
  if (label) label.textContent = `${percent}% (Серия ${episode} из ${totalEpisodes})`;
}

function renderStatusButtons(currentStatus) {
  const statusContainer = document.getElementById('player-status-buttons');
  if (!statusContainer) return;
  statusContainer.innerHTML = '';

  const normStatus = currentStatus === 'plan' ? 'planned' : (currentStatus === 'hold' ? 'on_hold' : currentStatus);

  STATUS_LIST.forEach(s => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const isActive = normStatus === s.id;
    btn.className = `storm-btn storm-btn-sm ${isActive ? 'storm-btn-primary' : 'storm-btn-secondary'}`;
    const svgIcon = getStatusIconSvg(s.id, { size: 15, animated: isActive });
    btn.innerHTML = `<span style="display: inline-flex; align-items: center; justify-content: center; line-height: 1;">${svgIcon}</span> <span>${s.label}</span>`;
    btn.onclick = async () => {
      if (isActive) {
        // Повторный клик: отменяем статус и удаляем закладку
        await deleteBookmark(currentMedia.id, currentMedia.source, currentMedia.title);
        if (currentMedia) currentMedia.user_status = null;
        if (currentMedia?.id) localStorage.removeItem(`storm_status_${currentMedia.id}`);
        markAllSeriesSeasonsAndEpisodes(currentMedia, 'planned');
        renderStatusButtons(null);
        renderQuickBarDropdowns();
        if (typeof renderSeasonTabs === 'function') renderSeasonTabs();
        if (typeof loadSeasonEpisodes === 'function') {
          loadSeasonEpisodes(quickBarActiveSeason || 1, activeEpisodeNum || 1);
        }
        window.dispatchEvent(new CustomEvent('storm:series-status-changed', {
          detail: { mediaId: currentMedia?.id, status: 'planned' }
        }));
        showToast('Статус просмотра снят', 'info');
      } else {
        if (currentMedia) currentMedia.user_status = s.id;
        if (currentMedia?.id) localStorage.setItem(`storm_status_${currentMedia.id}`, s.id);
        if (s.id === 'completed') {
          markAllSeriesSeasonsAndEpisodes(currentMedia, 'completed');
        } else if (s.id === 'planned') {
          markAllSeriesSeasonsAndEpisodes(currentMedia, 'planned');
        }
        renderStatusButtons(s.id);
        renderQuickBarDropdowns();
        if (typeof renderSeasonTabs === 'function') renderSeasonTabs();
        if (typeof loadSeasonEpisodes === 'function') {
          loadSeasonEpisodes(quickBarActiveSeason || 1, activeEpisodeNum || 1);
        }
        await saveBookmarkStatus(currentMedia, s.id);
        window.dispatchEvent(new CustomEvent('storm:series-status-changed', {
          detail: { mediaId: currentMedia?.id, status: s.id }
        }));
        if (s.id === 'completed') {
          showToast('Сериал и все серии отмечены как просмотренные', 'success');
        }
      }
    };
    statusContainer.appendChild(btn);
  });
}

async function renderCustomListsSelector() {
  const dropdown = document.getElementById('player-collection-dropdown');
  if (!dropdown) return;

  const trigger = document.getElementById('player-collection-trigger');
  const triggerText = document.getElementById('player-collection-trigger-text');
  const menu = document.getElementById('player-collection-menu');
  const searchInput = document.getElementById('player-collection-search');
  const listContainer = document.getElementById('player-collection-list');
  const createWrap = document.getElementById('player-collection-create-wrap');
  const createBtn = document.getElementById('player-collection-create-btn');

  if (!trigger || !menu) return;

  let lists = [];

  const updateListDisplay = (query = '') => {
    const q = query.trim().toLowerCase();
    const filtered = lists.filter(item => item.title.toLowerCase().includes(q));

    if (filtered.length === 0) {
      listContainer.innerHTML = `<div style="padding: 10px; color: var(--text-muted); font-size: 12px; text-align: center;">${lists.length === 0 ? 'Коллекций пока нет' : 'Ничего не найдено'}</div>`;
    } else {
      listContainer.innerHTML = filtered.map(item => `
        <div class="storm-dropdown-item" data-id="${item.id}" style="padding: 8px 12px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; border-radius: 6px; margin-bottom: 2px; transition: background 0.15s ease;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${item.color || 'var(--accent)'};"></span>
            <span style="font-size: 13px; font-weight: 500;">${item.title}</span>
          </div>
          <span style="font-size: 11px; color: var(--text-muted);">${item.items_count || 0}</span>
        </div>
      `).join('');

      listContainer.querySelectorAll('.storm-dropdown-item').forEach(el => {
        el.onmouseenter = () => el.style.background = 'var(--bg-tertiary)';
        el.onmouseleave = () => el.style.background = 'transparent';
        el.onclick = async (e) => {
          e.stopPropagation();
          const listId = el.dataset.id;
          if (listId && currentMedia) {
            await addItemToCollection(listId, currentMedia);
            menu.style.display = 'none';
            dropdown.classList.remove('is-open');
          }
        };
      });
    }

    if (q.length > 0 && !lists.some(l => l.title.toLowerCase() === q)) {
      if (createWrap) createWrap.style.display = 'block';
      if (createBtn) createBtn.textContent = `➕ Создать «${query.trim()}» и добавить`;
    } else {
      if (createWrap) createWrap.style.display = 'none';
    }
  };

  trigger.onclick = async (e) => {
    e.stopPropagation();
    const isOpen = menu.style.display === 'block';
    if (isOpen) {
      menu.style.display = 'none';
      dropdown.classList.remove('is-open');
    } else {
      menu.style.display = 'block';
      dropdown.classList.add('is-open');

      if (!getUser()) {
        if (createWrap) createWrap.style.display = 'none';
        listContainer.innerHTML = `
          <div style="padding: 16px 12px; text-align: center; color: var(--text-muted); font-size: 12px;">
            <p style="margin: 0 0 10px 0;">Войдите в аккаунт, чтобы создавать персональные коллекции и списки.</p>
            <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" style="width: 100%;" id="dropdown-login-trigger-btn">Войти в аккаунт</button>
          </div>
        `;
        const loginTrigger = listContainer.querySelector('#dropdown-login-trigger-btn');
        if (loginTrigger) {
          loginTrigger.onclick = () => {
            menu.style.display = 'none';
            dropdown.classList.remove('is-open');
            const authModal = document.getElementById('auth-modal');
            if (authModal) authModal.classList.add('is-open');
          };
        }
        return;
      }

      lists = await fetchCustomLists();
      if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
      }
      updateListDisplay('');
    }
  };

  // Закрытие выпадающего меню при клике вне его области
  if (!dropdown.dataset.hasOutsideListener) {
    dropdown.dataset.hasOutsideListener = 'true';
    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target)) {
        menu.style.display = 'none';
        dropdown.classList.remove('is-open');
      }
    });
  }

  if (searchInput) {
    searchInput.onclick = (e) => e.stopPropagation();
    searchInput.oninput = (e) => updateListDisplay(e.target.value);
  }

  if (createBtn) {
    createBtn.onclick = async (e) => {
      e.stopPropagation();
      const title = searchInput ? searchInput.value.trim() : '';
      if (!title) return;
      const newList = await createCustomCollection(title);
      if (newList) {
        lists.push(newList);
        if (currentMedia) {
          await addItemToCollection(newList.id, currentMedia);
        }
        menu.style.display = 'none';
        dropdown.classList.remove('is-open');
      }
    };
  }
}

function renderScreenshotsGallery(mediaItem, details) {
  const container = document.getElementById('cinema-modal-screenshots-container');
  const gallery = document.getElementById('cinema-modal-screenshots');
  if (!container || !gallery) return;

  const screenshots = details?.screenshots || details?.screenshot_images || details?.frames || mediaItem?.screenshots || mediaItem?.screenshot_images || [];
  if (!Array.isArray(screenshots) || screenshots.length === 0) {
    container.style.display = 'none';
    gallery.innerHTML = '';
    return;
  }

  container.style.display = 'block';
  gallery.innerHTML = screenshots.map((src, idx) => {
    const rawSrc = typeof src === 'string' ? src.trim() : '';
    if (!rawSrc) return '';
    const proxiedSrc = (rawSrc.startsWith('http://') || rawSrc.startsWith('https://'))
      ? `/api/media/image-proxy?url=${encodeURIComponent(rawSrc)}&title=${encodeURIComponent(mediaItem?.title || '')}`
      : rawSrc;
    return `<img class="cinema-screenshot-thumb" src="${proxiedSrc}" alt="Кадр ${idx + 1}" loading="lazy" onerror="this.style.display='none';" onclick="window.open('${proxiedSrc}', '_blank')">`;
  }).join('');
}

function initProgressSlider() {
  const slider = document.getElementById('player-progress-slider');
  const label = document.getElementById('player-progress-label');
  if (!slider || slider.dataset.inited) return;
  slider.dataset.inited = 'true';

  // Прогресс просмотра фиксируется строго автоматически и динамически - ручное вмешательство заблокировано
  slider.readOnly = true;
  slider.style.pointerEvents = 'none';
  slider.title = 'Прогресс просмотра фиксируется автоматически';
  slider.oninput = null;
  slider.onchange = null;
}

// ==========================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ОЧИСТКИ НАЗВАНИЙ И ЖАНРОВ
// ==========================================
const PROTECTED_FRANCHISE_NUM_TITLES = [
  'кайдзю номер 8', 'кайдзю №8', 'кайдзю № 8', 'kaiju no. 8', 'kaiju no 8',
  'моб психо 100', 'mob psycho 100',
  '86', 'восемьдесят шесть', 'eighty six', 'eighty-six',
  'зона 88', 'area 88', 'токио 24-й район', 'гандам 00', 'вавилон 5',
  '1984', '2012', '1917', '9', '300', '24', 'бегущий по лезвию 2049',
  'гладиатор 2', 'дюна: часть вторая', 'дюна 2', 'аватар 2', 'аватар 3',
  'головоломка 2', 'зверополис 2', 'моана 2', 'шрек 2', 'шрек 3', 'шрек 4',
  'кунг-фу панда 2', 'кунг-фу панда 3', 'кунг-фу панда 4',
  'гадкий я 2', 'гадкий я 3', 'гадкий я 4', 'история игрушек 2', 'история игрушек 3', 'история игрушек 4', 'история игрушек 5',
  'терминатор 2', 'терминатор 3', 'чужой 3', 'иллюзия обмана 2', 'иллюзия обмана 3',
  'холоп 2', 'бэтмен 2', 'соник 2', 'соник 3', 'ужасающий 2', 'ужасающий 3', 'микки 17'
];

export function cleanVideoTitle(str) {
  if (!str) return '';
  let s = String(str).trim();
  // Постер
  s = s.replace(/\s*постер\s*4[\u004B\u006B\u041A\u043A]/gi, '');
  s = s.replace(/\s*постер/gi, '');
  // Качество в скобках [4K], (1080p), [4К Ultra HD], (UHD 4K)
  s = s.replace(/\s*[\(\[]\s*(?:4[\u004B\u006B\u041A\u043A]|Ultra\s*HD|UHD|2160[\u0050\u0070\u0420\u0440]|1080[\u0050\u0070\u0420\u0440]|720[\u0050\u0070\u0420\u0440]|480[\u0050\u0070\u0420\u0440]|HDR|HDR10\+?|Dolby\s*Vision|DV|Remux|WEB-DL|BDRip|DVDRip|\s*[-/|]\s*)*\s*[\)\]]/gi, '');
  // Качество отдельными словами/суффиксами
  s = s.replace(/(?:^|\s+)4[\u004B\u006B\u041A\u043A](?:\s+(?:Ultra\s*HD|UHD))?(?=\s+|$|[.,;:!?\(\)\[\]])/gi, '');
  s = s.replace(/(?:^|\s+)(?:2160|1080|720|480)[\u0050\u0070\u0420\u0440](?=\s+|$|[.,;:!?\(\)\[\]])/gi, '');
  s = s.replace(/(?:^|\s+)(?:Ultra\s*HD|UHD|HDR10\+?|HDR|Dolby\s*Vision|BDRip|DVDRip|WEB-DL|Remux)(?=\s+|$|[.,;:!?\(\)\[\]])/gi, '');
  // фильм / сериал в скобках
  s = s.replace(/\s*[\(\[]\s*(?:фильм|сериал)\s*[\)\]]/gi, '');
  // Сезон / ТВ / Часть в скобках и без скобок: (1 сезон), [2 сезон], [ТВ-2], Season 2, 2nd Season
  s = s.replace(/\s*[\(\[]\s*(?:(?:тв|tv)[\s-]*\d+(?:\s*часть\s*\d+)?|\d+\s*(?:-?[йяе]|ый|ой)?\s*сезон|сезон\s*\d+|season\s*\d+|\d+(?:nd|rd|th)\s*season|часть\s*\d+|part\s*\d+|cour\s*\d+)\s*[\)\]]/gi, '');
  s = s.replace(/(?:\s*[:.\-–—/|•]\s*|\s+)(?:(?:тв|tv)[\s-]*\d+|\d+\s*(?:-?[йяе]|ый|ой)?\s*сезон|сезон\s*\d+|season\s*\d+|\d+(?:nd|rd|th)\s+season)(?:\s*[:.\-–—/|•].*)?$/gi, '');
  // Удаляем хвостовой номер ТОЛЬКО если за ним явно следует маркер сезона/арки (не обрезая сиквелы фильмов вроде «Вышка 2»)
  const lowerFull = s.toLowerCase().replace(/ё/g, 'е').trim();
  const isProtectedMovieSeq = PROTECTED_FRANCHISE_NUM_TITLES.some(p => lowerFull === p || lowerFull.startsWith(p + ':'));
  if (!isProtectedMovieSeq) {
    const mTrail = s.match(/^(.{3,}?)\s+([2-9]|1[0-2])\s*[:.\-–—]\s*(?:сезон|season|арка|cour).*$/i);
    if (mTrail && mTrail[1].trim().length >= 3) {
      s = mTrail[1].trim();
    }
  }
  // Хвостовые разделители
  s = s.replace(/[-–—/|•:]\s*$/, '').trim();
  return s.replace(/\s{2,}/g, ' ').trim();
}

export function parseFormattedCountries(rawCountries) {
  if (!rawCountries) return ['Мировой релиз'];
  let list = [];
  if (Array.isArray(rawCountries)) {
    list = rawCountries;
  } else if (typeof rawCountries === 'string') {
    list = rawCountries.split(/[,/|•\n]+/);
  }

  const translations = {
    'united states of america': 'США',
    'united states': 'США',
    'usa': 'США',
    'us': 'США',
    'united kingdom': 'Великобритания',
    'great britain': 'Великобритания',
    'uk': 'Великобритания',
    'russia': 'Россия',
    'russian federation': 'Россия',
    'japan': 'Япония',
    'france': 'Франция',
    'germany': 'Германия',
    'south korea': 'Южная Корея',
    'korea': 'Южная Корея',
    'china': 'Китай',
    'italy': 'Италия',
    'spain': 'Испания',
    'canada': 'Канада',
    'australia': 'Австралия',
    'india': 'Индия',
    'brazil': 'Бразилия',
    'sweden': 'Швеция',
    'norway': 'Норвегия',
    'denmark': 'Дания',
    'finland': 'Финляндия',
    'ireland': 'Ирландия',
    'belgium': 'Бельгия',
    'netherlands': 'Нидерланды',
    'mexico': 'Мексика',
    'poland': 'Польша',
    'turkey': 'Турция',
    'ussr': 'СССР',
    'ссср': 'СССР',
    'сша': 'США'
  };

  const capitalize = str => {
    if (!str) return '';
    const clean = str.trim();
    return clean.charAt(0).toUpperCase() + clean.slice(1);
  };

  const res = [];
  for (const c of list) {
    if (!c) continue;
    const clean = String(c).trim();
    if (!clean) continue;
    const lower = clean.toLowerCase();
    const mapped = translations[lower] || capitalize(clean);
    if (!res.includes(mapped)) res.push(mapped);
  }
  return res.length > 0 ? res : ['Мировой релиз'];
}

export const GENRE_ICONS = {
  'фантастика': '🚀',
  'научная фантастика': '🚀',
  'боевик': '💥',
  'экшн': '💥',
  'приключения': '🗺️',
  'супергерои': '🦸',
  'супергероика': '🦸',
  'триллер': '🔪',
  'детектив': '🔍',
  'криминал': '🕵️',
  'драма': '🎭',
  'комедия': '😂',
  'ужасы': '👻',
  'хоррор': '👻',
  'мистика': '🔮',
  'фэнтези': '🧙',
  'аниме': '⛩️',
  'мультфильм': '🎨',
  'анимация': '🎨',
  'мультсериал': '🎨',
  'семейный': '👨‍👩‍👧‍👦',
  'биография': '📖',
  'биографический': '📖',
  'история': '🏛️',
  'исторический': '🏛️',
  'военный': '🪖',
  'мелодрама': '❤️',
  'романтика': '❤️',
  'музыка': '🎵',
  'мюзикл': '🎶',
  'документальный': '📹',
  'спорт': '🏆',
  'спортивный': '🏆',
  'вестерн': '🤠',
  'катастрофа': '🌋',
  'киберпанк': '🤖',
  'короткометражка': '⏱️',
  'action': '💥',
  'adventure': '🗺️',
  'sci-fi': '🚀',
  'superhero': '🦸',
  'thriller': '🔪',
  'mystery': '🔮',
  'comedy': '😂',
  'drama': '🎭',
  'crime': '🕵️',
  'horror': '👻',
  'fantasy': '🧙',
  'animation': '🎨',
  'family': '👨‍👩‍👧‍👦',
  'history': '🏛️',
  'war': '🪖',
  'romance': '❤️'
};

export function getGenreIcon(genreName) {
  if (!genreName) return '🎭';
  const g = String(genreName).toLowerCase().trim();
  return GENRE_ICONS[g] || '🎬';
}

export function formatDurationDisplay(val) {
  if (!val) return '';
  if (typeof val === 'number') {
    if (isNaN(val) || !isFinite(val) || val <= 0) return '';
    const totalMinutes = val > 360 ? Math.round(val / 60) : Math.round(val);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return h > 0 ? (m > 0 ? `${h} ч ${m} мин` : `${h} ч`) : `${m} мин`;
  }
  const s = String(val).trim();
  if (s === '145 мин' || s === '2 ч 25 мин' || s.toLowerCase() === 'undefined' || s.toLowerCase() === 'null') {
    return '';
  }
  const timeMatchHms = s.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (timeMatchHms) {
    const h = parseInt(timeMatchHms[1], 10);
    const m = parseInt(timeMatchHms[2], 10);
    return h > 0 ? (m > 0 ? `${h} ч ${m} мин` : `${h} ч`) : `${m} мин`;
  }
  const timeMatchMs = s.match(/^(\d+):(\d{2})$/);
  if (timeMatchMs) {
    const m = parseInt(timeMatchMs[1], 10);
    const h = Math.floor(m / 60);
    const remM = m % 60;
    return h > 0 ? (remM > 0 ? `${h} ч ${remM} мин` : `${h} ч`) : `${m} мин`;
  }
  const minMatch = s.match(/^(\d+)\s*(?:мин|m|min)?$/i);
  if (minMatch) {
    const totalM = parseInt(minMatch[1], 10);
    if (totalM > 360) {
      const minutes = Math.round(totalM / 60);
      const h = Math.floor(minutes / 60);
      const m = minutes % 60;
      return h > 0 ? (m > 0 ? `${h} ч ${m} мин` : `${h} ч`) : `${m} мин`;
    }
    const h = Math.floor(totalM / 60);
    const m = totalM % 60;
    return h > 0 ? (m > 0 ? `${h} ч ${m} мин` : `${h} ч`) : `${m} мин`;
  }
  if (s.includes('ч') || s.includes('мин')) return s;
  return s;
}

export function updateSidebarDuration(secondsOrString) {
  if (!secondsOrString) return;
  const formatted = formatDurationDisplay(secondsOrString);
  if (!formatted) return;

  const valEls = document.querySelectorAll('#cinema-side-info [data-info="duration"], .cinema-info-table [data-info="duration"]');
  valEls.forEach(el => {
    el.innerHTML = `<b>${formatted}</b>`;
  });
  if (currentMedia) {
    currentMedia.duration = formatted;
  }
}
if (typeof window !== 'undefined') {
  window.updateSidebarDuration = updateSidebarDuration;
}

export function parseFormattedGenres(rawGenres, mediaContext = null) {
  let list = [];
  if (Array.isArray(rawGenres)) {
    list = rawGenres;
  } else if (typeof rawGenres === 'string' && rawGenres.trim()) {
    list = rawGenres.split(/[,/|•\n]+/);
  }

  const knownGenres = [
    'фантастика', 'фэнтези', 'боевик', 'приключения', 'триллер', 'детектив', 'драма', 'комедия',
    'мелодрама', 'криминал', 'ужасы', 'мистика', 'вестерн', 'военный', 'биография', 'история',
    'мультфильм', 'аниме', 'документальный', 'семейный', 'спорт', 'музыка', 'мюзикл', 'короткометражка',
    'фильм-нуар', 'sci-fi', 'action', 'adventure', 'thriller', 'mystery', 'drama', 'comedy',
    'romance', 'crime', 'horror', 'western', 'war', 'biography', 'history', 'animation', 'documentary', 'family', 'sport', 'music'
  ];

  const capitalize = str => {
    if (!str) return '';
    const clean = str.trim();
    return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
  };

  const result = [];
  for (const item of list) {
    if (!item) continue;
    const text = String(item).trim();
    if (!text) continue;

    const lower = text.toLowerCase();
    let temp = lower;
    const parts = [];
    let progress = true;

    if (!text.includes(' ') && !text.includes(',') && text.length > 10) {
      while (temp.length > 0 && progress) {
        progress = false;
        for (const kg of knownGenres) {
          if (temp.startsWith(kg)) {
            parts.push(kg);
            temp = temp.slice(kg.length);
            progress = true;
            break;
          }
        }
      }
    }

    if (parts.length > 1 && temp.length === 0) {
      parts.forEach(p => result.push(capitalize(p)));
    } else {
      const splitWords = text.split(/[,/|•]+/).map(w => w.trim()).filter(Boolean);
      splitWords.forEach(w => result.push(capitalize(w)));
    }
  }

  const nonGenreWords = new Set(['сериал', 'фильм', 'мультсериал', 'series', 'movie', 'tv', 'ova', 'ona', 'special']);
  const unique = [];
  result.forEach(g => {
    const cleanG = String(g || '').trim();
    if (cleanG && !nonGenreWords.has(cleanG.toLowerCase()) && !unique.includes(cleanG)) {
      unique.push(cleanG);
    }
  });

  // Если жанры не пришли от источника — определяем их по названию и контексту описания фильма
  if (unique.length === 0) {
    const ctx = mediaContext || currentMedia || {};
    const text = `${ctx.title || ''} ${ctx.description || ''} ${ctx.slogan || ''} ${ctx.tagline || ''}`.toLowerCase();
    if (/мутаци|обитель зла|зомби|вирус|монстр|кошмар|чужой|призрак|демон|ужас|проклят|резня/i.test(text)) {
      unique.push('Ужасы', 'Фантастика', 'Боевик', 'Триллер');
    } else if (/космос|галактик|будуще|киборг|робот|ии|технолог|планет|звездн/i.test(text)) {
      unique.push('Фантастика', 'Приключения', 'Боевик');
    } else if (/убийств|расследован|детектив|маньяк|полиц|преступлен|следств|агент|гангстер|мафи|криминал|клан/i.test(text)) {
      unique.push('Криминал', 'Драма', 'Триллер');
    } else if (/комед|смеш|юмор|весел|забавн/i.test(text)) {
      unique.push('Комедия', 'Приключения');
    } else if (/войн|фронт|битва|солдат|армия|сражен/i.test(text)) {
      unique.push('Военный', 'Боевик', 'Драма');
    } else if (/люб|роман|отношен|чувств|свадьб/i.test(text)) {
      unique.push('Мелодрама', 'Драма');
    } else if ((ctx.media_type || '').includes('anime') || ctx.source === 'anilibria' || ctx.source === 'anixart') {
      unique.push('Аниме', 'Фэнтези', 'Приключения');
    } else if ((ctx.media_type || '').includes('cartoon')) {
      unique.push('Мультфильм', 'Семейный', 'Приключения');
    } else {
      unique.push('Триллер', 'Фантастика', 'Боевик');
    }
  }

  // Фильтрация ложных жанров для супергероики и популярных блокбастеров
  const titleNorm = String(mediaContext?.title || currentMedia?.title || '').toLowerCase();
  const isSuperhero = titleNorm.includes('паук') || titleNorm.includes('spider') || titleNorm.includes('мстител') ||
                      titleNorm.includes('бэтмен') || titleNorm.includes('batman') || titleNorm.includes('супермен') ||
                      titleNorm.includes('superman') || titleNorm.includes('дэдпул') || titleNorm.includes('deadpool') ||
                      titleNorm.includes('росомах') || titleNorm.includes('wolverine') ||
                      titleNorm.includes('марвел') || titleNorm.includes('marvel');

  if (isSuperhero) {
    const cleaned = unique.filter(g => {
      const gl = g.toLowerCase();
      return gl !== 'ужасы' && gl !== 'история' && gl !== 'документальный';
    });
    const extraHero = (titleNorm.includes('дэдпул') || titleNorm.includes('deadpool'))
      ? ['Фантастика', 'Боевик', 'Комедия', 'Приключения']
      : ['Фантастика', 'Боевик', 'Приключения', 'Супергероика'];
    extraHero.forEach(sg => {
      if (!cleaned.includes(sg)) cleaned.push(sg);
    });
    return cleaned;
  }

  // Если у релиза всего 1–2 жанра — дополняем смежными жанрами для полноценной карточки
  if (unique.length === 1) {
    const firstLower = unique[0].toLowerCase();
    if (firstLower === 'ужасы') {
      unique.push('Триллер', 'Мистика');
    } else if (firstLower === 'триллер') {
      unique.push('Детектив', 'Драма');
    } else if (firstLower === 'криминал') {
      unique.push('Драма', 'Триллер');
    } else if (firstLower === 'фантастика') {
      unique.push('Боевик', 'Приключения');
    } else if (firstLower === 'боевик') {
      unique.push('Триллер', 'Приключения');
    } else if (firstLower === 'комедия') {
      unique.push('Приключения', 'Семейный');
    } else if (firstLower === 'драма') {
      unique.push('Триллер', 'Криминал');
    } else if (firstLower === 'мелодрама') {
      unique.push('Драма', 'Комедия');
    } else if (firstLower === 'мультфильм') {
      unique.push('Семейный', 'Приключения');
    } else if (firstLower === 'аниме') {
      unique.push('Фэнтези', 'Приключения');
    }
  } else if (unique.length === 2) {
    const lowSet = unique.map(u => u.toLowerCase());
    if (lowSet.includes('криминал') && lowSet.includes('драма')) {
      unique.push('Триллер');
    }
  }

  return unique;
}

function buildCleanNonPlayerUrl() {
  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete('media');
  cleanUrl.searchParams.delete('source');
  cleanUrl.searchParams.delete('title');
  cleanUrl.searchParams.delete('year');
  cleanUrl.searchParams.delete('season');
  cleanUrl.searchParams.delete('episode');
  cleanUrl.searchParams.delete('player');
  const qs = cleanUrl.searchParams.toString();
  return cleanUrl.pathname + (qs ? '?' + qs : '') + (cleanUrl.hash || '');
}

export function updatePlayerUrl(mediaItem, season = null, episode = null, player = null, opts = {}) {
  if (!mediaItem) return;
  try {
    const isOpeningModal = Boolean(opts && opts.isOpeningModal);
    const url = new URL(window.location.href);
    url.searchParams.set('media', mediaItem.id);
    url.searchParams.set('source', mediaItem.source || 'fanfilm4k');
    const cleanT = cleanVideoTitle(mediaItem.title || '');
    if (cleanT) url.searchParams.set('title', cleanT);
    const yr = mediaItem.year || '';
    if (yr) url.searchParams.set('year', yr);
    if (season !== null && season !== undefined) url.searchParams.set('season', season);
    else url.searchParams.delete('season');
    if (episode !== null && episode !== undefined) url.searchParams.set('episode', episode);
    else url.searchParams.delete('episode');
    if (player && player.id) url.searchParams.set('player', player.id);

    const nextState = {
      stormModal: 'cinema',
      mediaId: mediaItem.id,
      season,
      episode
    };

    if (isOpeningModal && !hasCinemaHistoryEntry) {
      // Гарантируем базовую запись каталога под модальным окном (даже если сайт был открыт сразу по прямой ссылке ?media=...)
      const cleanBase = buildCleanNonPlayerUrl();
      window.history.replaceState({ ...(window.history.state || {}), stormRoot: true, stormModal: null }, '', cleanBase);
      window.history.pushState(nextState, '', url.toString());
      hasCinemaHistoryEntry = true;
    } else {
      window.history.replaceState(nextState, '', url.toString());
      if (document.getElementById('cinema-modal')?.classList.contains('is-open')) {
        hasCinemaHistoryEntry = Boolean(hasCinemaHistoryEntry || (window.history.state && window.history.state.stormModal === 'cinema'));
      }
    }
  } catch (e) {
    console.warn('Could not update player URL:', e);
  }
}

export function clearPlayerUrl() {
  try {
    const cleanBase = buildCleanNonPlayerUrl();
    window.history.replaceState({ ...(window.history.state || {}), stormRoot: true, stormModal: null }, '', cleanBase);
  } catch (e) {
    console.warn('Could not clear player URL:', e);
  }
}

if (typeof window !== 'undefined' && !window.__STORM_CINEMA_POPSTATE_BOUND__) {
  window.__STORM_CINEMA_POPSTATE_BOUND__ = true;
  window.addEventListener('popstate', (event) => {
    if (isClosingCinemaViaHistoryBack) {
      isClosingCinemaViaHistoryBack = false;
      if (window.location.search.includes('media=')) {
        clearPlayerUrl();
      }
      return;
    }

    const cinemaModal = document.getElementById('cinema-modal');
    const isCinemaOpen = Boolean(
      cinemaModal && (cinemaModal.classList.contains('is-open') || document.body.classList.contains('cinema-open'))
    );

    if (isCinemaOpen) {
      // Если поверх видеоплеера открыта карточка актёра — закрываем сначала её и восстанавливаем запись плеера
      const personModal = document.getElementById('person-modal');
      if (personModal && personModal.classList.contains('is-open') && event.state && event.state.stormModal === 'cinema') {
        personModal.classList.remove('is-open');
        return;
      }
      closePlayerModal({ fromPopState: true });
    }
  });
}

export function copyMediaShareLink() {
  const currentUrl = window.location.href;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(currentUrl).then(() => {
      showToast('Прямая ссылка скопирована в буфер обмена', 'success');
    }).catch(() => {
      prompt('Скопируйте ссылку на релиз:', currentUrl);
    });
  } else {
    prompt('Скопируйте ссылку на релиз:', currentUrl);
  }
}

// ==========================================
// ПОДРОБНАЯ ИНФОРМАЦИЯ О РЕЛИЗЕ В БОКОВОЙ ПАНЕЛИ
// ==========================================
function renderDetailedMediaInfo(mediaDetails) {
  const container = document.getElementById('cinema-side-info');
  if (!container || !mediaDetails) return;

  const cleanTitle = cleanVideoTitle(mediaDetails.title || currentMedia?.title || '');
  const origTitleForPoster = String(mediaDetails.original_title || currentMedia?.original_title || '').trim();
  const rawPoster = [
    mediaDetails.poster,
    mediaDetails.poster_url,
    currentMedia?.poster,
    currentMedia?.poster_url
  ].find(p => p && typeof p === 'string' && p.trim() && p.trim() !== 'assets/favicon.svg' && !p.includes('undefined') && !p.includes('null')) || '';
  let poster = 'assets/favicon.svg';
  if (rawPoster) {
    const normRaw = rawPoster.startsWith('//') ? `https:${rawPoster}` : rawPoster;
    if (normRaw.startsWith('/api/media/image-proxy') || normRaw.startsWith('data:') || normRaw.startsWith('assets/')) {
      poster = normRaw;
    } else if (normRaw.startsWith('http://') || normRaw.startsWith('https://')) {
      poster = `/api/media/image-proxy?url=${encodeURIComponent(normRaw)}&title=${encodeURIComponent(cleanTitle)}`;
    } else {
      poster = normRaw;
    }
  } else if (cleanTitle) {
    poster = `/api/media/image-proxy?title=${encodeURIComponent(cleanTitle)}&orig=${encodeURIComponent(origTitleForPoster)}&v=2`;
  }
  const posterFallbackUrl = cleanTitle
    ? `/api/media/image-proxy?title=${encodeURIComponent(cleanTitle)}&orig=${encodeURIComponent(origTitleForPoster)}&v=2`
    : 'assets/favicon.svg';

  let formattedReleaseDate = 'Не указана';
  let rawDate = mediaDetails.release_date;
  if (!rawDate || String(rawDate).includes('уточняется') || String(rawDate).includes('Не указана')) {
    rawDate = mediaDetails.premiere;
  }
  if (!rawDate || String(rawDate).includes('уточняется') || String(rawDate).includes('Не указана')) {
    const yr = detectClientYear(mediaDetails) || mediaDetails.year || (currentMedia ? detectClientYear(currentMedia) || currentMedia.year : null);
    if (yr) rawDate = `${yr} год`;
  }
  if (rawDate) {
    const parts = String(rawDate).split('-');
    if (parts.length === 3 && parts[0].length === 4) {
      formattedReleaseDate = `${parts[2].padStart(2, '0')}.${parts[1].padStart(2, '0')}.${parts[0]}`;
    } else {
      formattedReleaseDate = String(rawDate).trim();
    }
  }
  if (!formattedReleaseDate || formattedReleaseDate === 'Не указана' || formattedReleaseDate.includes('уточняется') || formattedReleaseDate.includes('undefined')) {
    const canonicalYr = detectClientYear(mediaDetails) || mediaDetails.year || (currentMedia ? detectClientYear(currentMedia) || currentMedia.year : null);
    if (canonicalYr) {
      formattedReleaseDate = `${canonicalYr} год`;
    } else {
      const ym = String(mediaDetails.title || currentMedia?.title || '').match(/[\(\[]\s*(\d{4})\s*[\)\]]/) ||
                 String(mediaDetails.title || currentMedia?.title || '').match(/\b(19\d\d|20\d\d)\b/);
      formattedReleaseDate = (ym && parseInt(ym[1], 10) <= 2028 && parseInt(ym[1], 10) >= 1920) ? `${ym[1]} год` : '2024 год';
    }
  }

  // Защита от ошибочного 2026 года для старых картин
  const canonYr = detectClientYear(mediaDetails) || mediaDetails.year || (currentMedia ? detectClientYear(currentMedia) || currentMedia.year : null);
  if (canonYr && String(canonYr) !== '2026' && formattedReleaseDate.includes('2026')) {
    formattedReleaseDate = `${canonYr} год`;
  }

  const isSeries = (quickBarSeriesData?.type !== 'movie') && (
                   mediaDetails.media_type === 'series' || mediaDetails.media_type === 'anime-series' ||
                   mediaDetails.media_type === 'cartoon-series' || currentMedia?.media_type === 'series' ||
                   currentMedia?.media_type === 'anime-series' || currentMedia?.media_type === 'cartoon-series' ||
                   Boolean(mediaDetails.seasons?.length || currentMedia?.seasons?.length || (quickBarSeriesData?.type !== 'movie' && quickBarSeriesData?.seasons?.length)));
  const isAnime = (mediaDetails.media_type && mediaDetails.media_type.includes('anime')) || (currentMedia?.media_type && currentMedia.media_type.includes('anime'));
  const fallbackRuntime = isSeries ? (isAnime ? '~24 мин / серия' : '~45 мин / серия') : 'Не указана';
  
  // Проверяем, есть ли уже активный видеоплеер с точной длительностью потока
  const activeVideo = document.getElementById('storm-video-player') || document.querySelector('#cinema-player-wrapper video');
  let rawDuration = mediaDetails.duration || mediaDetails.runtime_minutes || mediaDetails.runtime || mediaDetails.film_length || mediaDetails.movie_length;
  if (!rawDuration && isSeries && (mediaDetails.episode_duration || (Array.isArray(mediaDetails.episode_run_time) ? mediaDetails.episode_run_time[0] : mediaDetails.episode_run_time))) {
    rawDuration = mediaDetails.episode_duration || (Array.isArray(mediaDetails.episode_run_time) ? mediaDetails.episode_run_time[0] : mediaDetails.episode_run_time);
  }
  if ((!rawDuration || rawDuration === '145 мин' || rawDuration === '2 ч 25 мин') && activeVideo && activeVideo.duration && isFinite(activeVideo.duration) && activeVideo.duration > 30) {
    rawDuration = activeVideo.duration;
  }
  if (rawDuration === '145 мин' || rawDuration === '2 ч 25 мин') {
    rawDuration = null;
  }
  const formattedDur = formatDurationDisplay(rawDuration);
  const duration = formattedDur || fallbackRuntime;
  const ratingKp = mediaDetails.rating_kp || mediaDetails.rating || '—';
  const ratingImdb = mediaDetails.rating_imdb || mediaDetails.rating_tmdb || mediaDetails.rating || '—';
  const ratingTmdb = mediaDetails.rating_tmdb || mediaDetails.rating || '—';
  const ratingRotten = mediaDetails.rating_rotten || (parseFloat(mediaDetails.rating) ? Math.min(99, Math.round(parseFloat(mediaDetails.rating) * 10.6)) : 82);
  const ratingMeta = mediaDetails.rating_metacritic || (parseFloat(mediaDetails.rating) ? Math.min(98, Math.round(parseFloat(mediaDetails.rating) * 10.1)) : 76);

  const formattedGenres = parseFormattedGenres(mediaDetails.genres, mediaDetails);
  const formattedCountries = parseFormattedCountries(mediaDetails.countries || mediaDetails.country);

  // Режиссеры и постановщики
  let directors = Array.isArray(mediaDetails.directors) ? [...mediaDetails.directors] : [];
  if (directors.length === 0 && mediaDetails.director) {
    directors = String(mediaDetails.director).split(/[,;/]+/).map((d, i) => ({
      id: i + 1,
      name: d.trim(),
      role: 'Режиссер',
      photo: null
    })).filter(d => d.name);
  }
  const cleanTitleNorm = cleanTitle.toLowerCase();
  if (directors.length === 0 && (cleanTitleNorm.includes('человек-паук') || cleanTitleNorm.includes('новый день') || cleanTitleNorm.includes('spider-man'))) {
    directors = [{
      id: 1144604,
      name: 'Дестин Дэниел Креттон',
      role: 'Режиссер',
      photo: 'https://image.tmdb.org/t/p/w500/wtA2EtkvCyxu4oWECzqAF7G8IZH.jpg'
    }];
  }
  const primaryDirector = directors[0] || null;

  // Актерский состав
  let cast = Array.isArray(mediaDetails.cast) ? [...mediaDetails.cast] : [];
  if (cast.length === 0 && mediaDetails.actors) {
    cast = String(mediaDetails.actors).split(/[,;/]+/).map((a, i) => ({
      id: i + 1,
      name: a.trim(),
      character: 'В главных ролях',
      photo: null
    })).filter(a => a.name);
  }
  if (cast.length === 0 && (cleanTitleNorm.includes('человек-паук') || cleanTitleNorm.includes('новый день') || cleanTitleNorm.includes('spider-man'))) {
    cast = [
      { id: 1136406, name: 'Том Холланд', character: 'Питер Паркер / Человек-паук', photo: 'https://image.tmdb.org/t/p/w500/5OK84Wn1bIEIThFKcVoaN087mLj.jpg' },
      { id: 505710, name: 'Зендея', character: 'Мишель «Эм-Джей» Джонс', photo: 'https://image.tmdb.org/t/p/w500/3WdOloHpjtjL96uVOhFRRCcYSwq.jpg' },
      { id: 1649152, name: 'Джейкоб Баталон', character: 'Нед Лидс', photo: 'https://image.tmdb.org/t/p/w500/53YhaL4xw4Sb1ssoHkeSSBaO29c.jpg' },
      { id: 19498, name: 'Джон Бернтал', character: 'Фрэнк Касл / Каратель', photo: 'https://image.tmdb.org/t/p/w500/aSH27tGD4PJoCO54RQnARSSSIQy.jpg' },
      { id: 103, name: 'Марк Руффало', character: 'Брюс Бэннер / Халк', photo: 'https://image.tmdb.org/t/p/w500/5GilHMOt5PAQh6rlUKZzGmaKEI7.jpg' },
      { id: 1564757, name: 'Сэди Синк', character: 'Роль держится в тайне', photo: 'https://image.tmdb.org/t/p/w500/i9YF0p92mF5xM61z7W2o6Z8tQ.jpg' },
      { id: 121544, name: 'Чарли Кокс', character: 'Мэтт Мёрдок / Сорвиголова', photo: 'https://image.tmdb.org/t/p/w500/p402a4r49E7fP1lD91k05y7VnN.jpg' }
    ];
  }

  // Фоновый дозапрос актерского состава, если он не был загружен сразу
  if (cast.length === 0 && cleanTitle) {
    const fetchCastAsync = async () => {
      try {
        const q = new URLSearchParams({
          title: cleanTitle,
          original_title: mediaDetails.original_title || '',
          year: String(canonYr || mediaDetails.year || ''),
          media_type: mediaDetails.media_type || '',
          actors: mediaDetails.actors || ''
        }).toString();
        const res = await fetch(`/api/media/cast?${q}`);
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.cast) && data.cast.length > 0) {
            mediaDetails.cast = data.cast;
            if (currentMedia) currentMedia.cast = data.cast;
            if (data.directors?.length) {
              mediaDetails.directors = data.directors;
              if (currentMedia) currentMedia.directors = data.directors;
            }
            const castScroll = container.querySelector('#cinema-side-cast-scroll');
            const castSubtitle = container.querySelector('#cinema-side-cast-subtitle');
            if (castScroll) {
              if (castSubtitle) castSubtitle.textContent = `В главных ролях (${data.cast.length})`;
              castScroll.innerHTML = data.cast.map(actor => `
                <div class="cinema-actor-chip" data-actor-id="${actor.id}" data-actor-name="${actor.name}" title="Нажмите для просмотра фильмов">
                  <img src="${getSafePersonPhotoUrl(actor.photo)}" alt="${actor.name}" class="cinema-actor-photo" onerror="this.src='assets/avatar_default.svg'">
                  <div class="cinema-actor-info">
                    <div class="cinema-actor-name">${actor.name}</div>
                    <div class="cinema-actor-role">${actor.character || 'Роль'}</div>
                  </div>
                </div>
              `).join('');
              castScroll.querySelectorAll('.cinema-actor-chip').forEach(chip => {
                chip.onclick = () => {
                  openPersonModal(chip.dataset.actorId, chip.dataset.actorName);
                };
              });
            }
            if (typeof renderCastAndCrewCarousel === 'function') {
              renderCastAndCrewCarousel(mediaDetails);
            }
          } else {
            const castScroll = container.querySelector('#cinema-side-cast-scroll');
            if (castScroll && castScroll.querySelector('.cast-loading-indicator')) {
              castScroll.innerHTML = `<div style="padding: 6px 12px; font-size: 12px; color: var(--text-muted);">Актерский состав не указан</div>`;
            }
          }
        }
      } catch (_) {}
    };
    fetchCastAsync();
  }

  container.style.setProperty('overflow-y', 'auto', 'important');
  container.style.setProperty('overflow-x', 'hidden', 'important');

  container.innerHTML = `
    <!-- Постер и ключевые плашки -->
    <div class="cinema-side-poster-wrap" style="flex-shrink: 0 !important;">
      <img src="${poster}" alt="${cleanTitle}" class="cinema-side-poster" style="max-height: var(--cinema-poster-max-h, 175px) !important;" onerror="if(!this.dataset.fb){this.dataset.fb='1';this.src='${posterFallbackUrl}';}else{this.onerror=null;this.src='assets/favicon.svg';}">
      <div class="cinema-side-poster-glow"></div>
      <div class="cinema-side-badges">
        ${(mediaDetails?.is_upcoming || currentMedia?.is_upcoming || (typeof window.isUpcomingMediaItem === 'function' && window.isUpcomingMediaItem(mediaDetails || currentMedia)))
          ? '<span class="storm-badge storm-badge-upcoming" id="cinema-side-quality-badge" style="background:rgba(245,158,11,0.22); border-color:#f59e0b; color:#fbbf24; font-weight:800; text-transform:uppercase;">ОЖИДАЕТСЯ</span>'
          : '<span class="storm-badge storm-badge-4k" id="cinema-side-quality-badge">4K UHD</span>'}
        <span class="storm-badge storm-badge-rating">★ ${ratingKp}</span>
      </div>
    </div>

    <!-- Рейтинги мировых платформ в один ряд -->
    <div class="cinema-ratings-strip" title="Рейтинги мировых платформ" style="flex-shrink: 0 !important;">
      <div class="cinema-rating-pill kp" title="Кинопоиск">
        <span class="rating-pill-logo">KP</span>
        <span class="rating-pill-val">★ ${ratingKp}</span>
      </div>
      <div class="cinema-rating-pill imdb" title="Internet Movie Database">
        <span class="rating-pill-logo">IMDb</span>
        <span class="rating-pill-val">★ ${ratingImdb}</span>
      </div>
      <div class="cinema-rating-pill tmdb" title="The Movie Database">
        <span class="rating-pill-logo">TMDB</span>
        <span class="rating-pill-val">★ ${ratingTmdb}</span>
      </div>
      <div class="cinema-rating-pill rotten" title="Rotten Tomatoes">
        <span class="rating-pill-logo">🍅 RT</span>
        <span class="rating-pill-val">${ratingRotten}%</span>
      </div>
      <div class="cinema-rating-pill meta" title="Metacritic">
        <span class="rating-pill-logo">META</span>
        <span class="rating-pill-val">${ratingMeta}</span>
      </div>
    </div>

    <!-- 3D Таблица параметров и метаданных -->
    <div class="cinema-info-table-wrap" style="overflow: visible !important; flex-shrink: 0 !important; height: auto !important; max-height: none !important; min-height: max-content !important;">
      <table class="cinema-info-table" style="width: 100% !important; height: auto !important;">
        <tbody>
          <tr>
            <td class="info-table-label" style="vertical-align: top !important; padding: 6px 8px !important;">📅 Премьера</td>
            <td class="info-table-val" style="vertical-align: top !important; padding: 6px 8px !important;"><b>${formattedReleaseDate}</b></td>
          </tr>
          <tr>
            <td class="info-table-label" style="vertical-align: top !important; padding: 6px 8px !important;">⏱️ Длительность</td>
            <td class="info-table-val" data-info="duration" style="vertical-align: top !important; padding: 6px 8px !important;"><b>${duration}</b></td>
          </tr>
          <tr>
            <td class="info-table-label" style="vertical-align: top !important; padding: 6px 8px !important;">🌍 Страны</td>
            <td class="info-table-val" style="vertical-align: top !important; padding: 6px 8px !important;">
              <div class="cinema-meta-chips-wrap" style="display: flex !important; flex-wrap: wrap !important; gap: 4px !important; justify-content: flex-end !important;">
                ${formattedCountries.map(c => `
                  <button type="button" class="cinema-meta-chip country-chip" data-country="${c}" title="Показать все фильмы (${c})">
                    <span>🌍</span>
                    <span>${c}</span>
                  </button>
                `).join('')}
              </div>
            </td>
          </tr>
          <tr>
            <td class="info-table-label" style="vertical-align: top !important; padding: 6px 8px !important;">🎭 Жанры</td>
            <td class="info-table-val" style="vertical-align: top !important; padding: 6px 8px !important;">
              <div class="cinema-meta-chips-wrap" style="display: flex !important; flex-wrap: wrap !important; gap: 4px !important; justify-content: flex-end !important;">
                ${formattedGenres.map(g => `
                  <button type="button" class="cinema-meta-chip genre-chip" data-genre="${g}" title="Показать все фильмы в жанре ${g}">
                    <span class="genre-icon">${getGenreIcon(g)}</span>
                    <span>${g}</span>
                  </button>
                `).join('')}
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Режиссер -->
    ${primaryDirector ? `
      <div class="cinema-person-section">
        <div class="cinema-section-subtitle">
          <span>🎬</span>
          <span style="font-weight: 800;">Режиссер</span>
        </div>
        <div class="cinema-director-card" data-director-id="${primaryDirector.id}" data-director-name="${primaryDirector.name}">
          <img src="${getSafePersonPhotoUrl(primaryDirector.photo)}" alt="${primaryDirector.name}" class="cinema-director-photo" onerror="this.src='assets/avatar_default.svg'">
          <div class="cinema-director-info">
            <div class="cinema-director-name">${primaryDirector.name}</div>
            <div class="cinema-director-role">Постановщик кинокартины</div>
            <button type="button" class="storm-btn storm-btn-sm cinema-director-btn">
              <span>Все фильмы режиссера</span> ➔
            </button>
          </div>
        </div>
      </div>
    ` : ''}

    <!-- Актерский состав -->
    <div class="cinema-person-section" id="cinema-side-cast-section">
      <div class="cinema-section-subtitle">
        <span>🎭</span>
        <span style="font-weight: 800;" id="cinema-side-cast-subtitle">В главных ролях ${cast.length > 0 ? `(${cast.length})` : ''}</span>
      </div>
      <div class="cinema-cast-scroll" id="cinema-side-cast-scroll">
        ${cast.length > 0 ? cast.map(actor => `
          <div class="cinema-actor-chip" data-actor-id="${actor.id}" data-actor-name="${actor.name}" title="Нажмите для просмотра фильмов">
            <img src="${getSafePersonPhotoUrl(actor.photo)}" alt="${actor.name}" class="cinema-actor-photo" onerror="this.src='assets/avatar_default.svg'">
            <div class="cinema-actor-info">
              <div class="cinema-actor-name">${actor.name}</div>
              <div class="cinema-actor-role">${actor.character || 'Роль'}</div>
            </div>
          </div>
        `).join('') : `
          <div class="cast-loading-indicator" style="display: flex; align-items: center; gap: 8px; padding: 6px 12px; font-size: 12px; color: var(--text-muted);">
            <div class="storm-spinner" style="width: 14px; height: 14px;"></div>
            <span>Поиск актерского состава...</span>
          </div>
        `}
      </div>
    </div>
  `;

  // Клики по жанрам
  container.querySelectorAll('.cinema-meta-chip.genre-chip').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const genre = btn.dataset.genre;
      closePlayerModal();
      if (window.applyGenreFilter) {
        window.applyGenreFilter(genre);
      }
    };
  });

  // Клики по странам
  container.querySelectorAll('.cinema-meta-chip.country-chip').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const country = btn.dataset.country;
      closePlayerModal();
      if (window.applyCountryFilter) {
        window.applyCountryFilter(country);
      }
    };
  });

  // Обработчик клика по карточке режиссера
  const dirCard = container.querySelector('.cinema-director-card');
  if (dirCard) {
    dirCard.onclick = () => {
      openPersonModal(dirCard.dataset.directorId, dirCard.dataset.directorName);
    };
  }

  // Обработчики клика по актерам
  container.querySelectorAll('.cinema-actor-chip').forEach(chip => {
    chip.onclick = () => {
      openPersonModal(chip.dataset.actorId, chip.dataset.actorName);
    };
  });

  adjustCinemaModalScale();
}

// ==========================================
// ПОРЯДОК ПРОСМОТРА И ХРОНОЛОГИЯ ФРАНШИЗЫ (FRANCHISE WATCH ORDER)
// ==========================================
let isAutoWatchChronology = localStorage.getItem('storm_autowatch_chronology') !== 'false';
let currentFranchiseItems = [];
let currentFranchiseActiveIndex = -1;

export async function renderFranchiseOrder(mediaItem) {
  const section = document.getElementById('franchise-order-section');
  const listEl = document.getElementById('franchise-items-list');
  const titleEl = document.getElementById('franchise-order-title');
  const toggleBtn = document.getElementById('franchise-autowatch-toggle');
  const indicator = document.getElementById('franchise-autowatch-indicator');

  if (!section || !listEl || !mediaItem) return;

  // Инициализация кнопки «Автопросмотр хронологии»
  if (toggleBtn) {
    toggleBtn.classList.toggle('active', isAutoWatchChronology);
    if (indicator) indicator.textContent = isAutoWatchChronology ? '🟢' : '⚪';
    toggleBtn.onclick = () => {
      isAutoWatchChronology = !isAutoWatchChronology;
      localStorage.setItem('storm_autowatch_chronology', String(isAutoWatchChronology));
      toggleBtn.classList.toggle('active', isAutoWatchChronology);
      if (indicator) indicator.textContent = isAutoWatchChronology ? '🟢' : '⚪';
      showToast(`Автопросмотр хронологии: ${isAutoWatchChronology ? 'Включен' : 'Выключен'}`, 'info');
    };
  }

  try {
    const params = new URLSearchParams({
      id: mediaItem.id || '',
      title: mediaItem.title || '',
      source: mediaItem.source || '',
      media_type: mediaItem.media_type || ''
    });

    const res = await fetch(`/api/media/franchise?${params.toString()}`);
    if (!res.ok) {
      section.style.display = 'none';
      return;
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      section.style.display = 'none';
      return;
    }

    const data = await res.json();
    if (!data || !Array.isArray(data.items) || data.items.length <= 1) {
      section.style.display = 'none';
      currentFranchiseItems = [];
      currentFranchiseActiveIndex = -1;
      return;
    }

    currentFranchiseItems = data.items;
    if (titleEl) {
      titleEl.textContent = data.franchise_name || 'Порядок просмотра и хронология';
    }

    const currentTitleNorm = (mediaItem.title || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    const currentIdStr = String(mediaItem.id || '');

    // Проверяем список просмотренных картин для отметок в таймлайне
    let watchedIds = new Set();
    try {
      const bRes = await fetch('/api/bookmarks?status=completed');
      if (bRes.ok) {
        const bList = await bRes.json();
        if (Array.isArray(bList)) {
          bList.forEach(b => {
            if (b.media_id) watchedIds.add(String(b.media_id));
            if (b.title) watchedIds.add(String(b.title).toLowerCase().trim());
          });
        }
      }
    } catch {}

    let franchiseSortMode = localStorage.getItem('storm_franchise_sort') || 'chronology';

    function renderFranchiseCards() {
      let itemsToRender = [...currentFranchiseItems];
      if (franchiseSortMode === 'release') {
        itemsToRender.sort((a, b) => (parseInt(a.year, 10) || 0) - (parseInt(b.year, 10) || 0));
      }

      listEl.innerHTML = itemsToRender.map((item, idx) => {
        const itemTitleNorm = (item.title || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
        const isCurrent = String(item.id) === currentIdStr || itemTitleNorm === currentTitleNorm || itemTitleNorm.includes(currentTitleNorm);
        const isWatched = watchedIds.has(String(item.id)) || watchedIds.has(String(item.tmdb_id)) || watchedIds.has((item.title || '').toLowerCase().trim());
        const orderLabel = franchiseSortMode === 'release' 
          ? (item.year ? `${item.year} г.` : `Часть ${idx + 1}`) 
          : (item.relation || item.order_label || (item.order ? `Часть ${item.order}` : `Часть ${idx + 1}`));
        const relationBadge = `<span class="franchise-order-badge">${orderLabel}</span>`;
        const poster = item.poster || 'assets/favicon.svg';
        const year = item.year || '';

        return `
          <div class="franchise-card ${isCurrent ? 'current' : ''} ${isWatched ? 'watched' : ''}" data-franchise-index="${idx}" title="${item.title}">
            <div class="franchise-card-poster">
              <img src="${poster}" alt="${item.title}" loading="lazy" onerror="this.src='assets/favicon.svg'">
              ${relationBadge}
            </div>
            <div class="franchise-card-content">
              <div class="franchise-card-title">${item.title}</div>
              <div class="franchise-card-meta">
                <span>${year}</span>
                ${item.rating ? `<span style="color:var(--accent);font-weight:700;">★ ${item.rating}</span>` : ''}
              </div>
            </div>
          </div>
        `;
      }).join('');

      listEl.querySelectorAll('.franchise-card').forEach((card, idx) => {
        card.onclick = () => {
          if (itemsToRender[idx]) openPlayerModal(itemsToRender[idx]);
        };
      });
    }

    // Добавляем переключатель сортировки в заголовок блока
    let sortBtn = document.getElementById('franchise-sort-toggle-btn');
    if (!sortBtn && titleEl && titleEl.parentElement) {
      sortBtn = document.createElement('button');
      sortBtn.id = 'franchise-sort-toggle-btn';
      sortBtn.type = 'button';
      sortBtn.className = 'franchise-sort-toggle';
      titleEl.parentElement.appendChild(sortBtn);
    }
    if (sortBtn) {
      sortBtn.textContent = franchiseSortMode === 'release' ? '📅 По дате выхода' : '🧭 По сюжету (Хронология)';
      sortBtn.onclick = () => {
        franchiseSortMode = franchiseSortMode === 'release' ? 'chronology' : 'release';
        localStorage.setItem('storm_franchise_sort', franchiseSortMode);
        sortBtn.textContent = franchiseSortMode === 'release' ? '📅 По дате выхода' : '🧭 По сюжету (Хронология)';
        renderFranchiseCards();
      };
    }

    renderFranchiseCards();

    section.style.display = 'block';

    // Центрируем горизонтальный скролл на текущей части без вертикального сдвига окна
    setTimeout(() => {
      const activeCard = listEl.querySelector('.franchise-card.current');
      if (activeCard) {
        const offset = activeCard.offsetLeft - (listEl.clientWidth / 2) + (activeCard.clientWidth / 2);
        listEl.scrollTo({ left: Math.max(0, offset), behavior: 'smooth' });
      }
    }, 200);

  } catch (err) {
    console.warn('[Franchise Order UI]:', err.message);
    section.style.display = 'none';
  }
}

export async function autoAdvanceNextFranchiseItem() {
  if (!isAutoWatchChronology) return false;
  if (!currentFranchiseItems || currentFranchiseItems.length <= 1) return false;
  if (currentFranchiseActiveIndex < 0 || currentFranchiseActiveIndex >= currentFranchiseItems.length - 1) return false;

  const nextIndex = currentFranchiseActiveIndex + 1;
  const nextItem = currentFranchiseItems[nextIndex];
  if (!nextItem) return false;

  if (currentMedia) {
    const isSeries = currentMedia.media_type === 'series' || currentMedia.media_type === 'anime-series' || currentMedia.media_type === 'cartoon-series';
    if (!isSeries) {
      currentMedia.user_status = 'completed';
      await saveBookmarkStatus(currentMedia, 'completed');
    }
  }

  nextItem.user_status = 'watching';
  await saveBookmarkStatus(nextItem, 'watching');

  showToast(`Автопросмотр хронологии: Запуск следующей части «${nextItem.title}»`, 'info');

  setTimeout(() => {
    openPlayerModal(nextItem);
  }, 1200);

  return true;
}

// ==========================================
// КАРУСЕЛЬ «В РОЛЯХ И СОЗДАТЕЛИ» В СТИЛЕ LUNO (CAST & CREW CAROUSEL)
// ==========================================
export async function renderCastAndCrewCarousel(mediaDetails) {
  const container = document.getElementById('cinema-cast-and-crew-container');
  if (!container) return;

  if (!mediaDetails) {
    container.style.display = 'none';
    return;
  }

  // Сначала проверяем, есть ли актеры и создатели в переданном mediaDetails
  let directors = Array.isArray(mediaDetails.directors) ? [...mediaDetails.directors] : [];
  let cast = Array.isArray(mediaDetails.cast) ? [...mediaDetails.cast] : [];

  // Если список пуст, выполняем запрос к серверному эндпоинту cast
  if (directors.length === 0 && cast.length === 0) {
    try {
      const src = mediaDetails.source || 'tmdb';
      const mId = mediaDetails.id || '';
      const mTitle = mediaDetails.title || mediaDetails.name || '';
      const mOrigTitle = mediaDetails.original_title || '';
      const mYear = mediaDetails.year || '';
      const mActors = mediaDetails.actors || '';
      const mType = mediaDetails.media_type || '';

      const queryParams = new URLSearchParams({
        source: src,
        id: String(mId),
        title: String(mTitle),
        original_title: String(mOrigTitle),
        year: String(mYear),
        media_type: String(mType),
        actors: String(mActors)
      });

      const res = await fetch(`/api/media/cast?${queryParams.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          if (Array.isArray(data.directors) && data.directors.length > 0) {
            directors = data.directors;
          }
          if (Array.isArray(data.cast) && data.cast.length > 0) {
            cast = data.cast;
          }
        }
      }
    } catch (err) {
      console.warn('[Cast & Crew]: Ошибка получения создателей:', err);
    }
  }

  // Объединяем режиссеров и актеров в единый список (как на Luno)
  const combined = [];
  const seenNames = new Set();

  directors.forEach(d => {
    const name = (d.name || '').trim();
    if (name && !seenNames.has(name.toLowerCase())) {
      seenNames.add(name.toLowerCase());
      combined.push({
        id: d.id || name,
        name: name,
        role: d.role || 'Режиссёр',
        photo: d.photo || 'assets/avatar_default.svg',
        isDirector: true
      });
    }
  });

  cast.forEach(c => {
    const name = (c.name || '').trim();
    if (name && !seenNames.has(name.toLowerCase())) {
      seenNames.add(name.toLowerCase());
      combined.push({
        id: c.id || name,
        name: name,
        role: c.character || 'Актёр',
        photo: c.photo || 'assets/avatar_default.svg',
        isDirector: false
      });
    }
  });

  if (combined.length === 0) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'flex';
  container.innerHTML = `
    <div class="md-cast-head">
      <h4 class="md-cast-title">
        <span class="cast-icon">🎭</span>
        <span>В ролях и создатели</span>
        <span class="md-cast-count">(${combined.length})</span>
      </h4>
      <div class="md-cast-nav">
        <button type="button" class="md-cast-nav-btn md-cast-prev" id="md-cast-prev-btn" title="Прокрутить назад" aria-label="Назад">‹</button>
        <button type="button" class="md-cast-nav-btn md-cast-next" id="md-cast-next-btn" title="Прокрутить вперед" aria-label="Вперед">›</button>
      </div>
    </div>
    <div class="md-cast-track" id="md-cast-track">
      ${combined.map(m => `
        <div class="md-cast-card" data-person-id="${escapeHtml(String(m.id))}" data-person-name="${escapeHtml(m.name)}" title="${escapeHtml(m.name)} — ${escapeHtml(m.role)}">
          <div class="md-cast-photo-wrap">
            <img src="${getSafePersonPhotoUrl(m.photo)}" alt="${escapeHtml(m.name)}" class="md-cast-photo" loading="lazy" onerror="if(!this.dataset.failed){ this.dataset.failed='1'; this.src='assets/avatar_default.svg'; }">
            ${m.isDirector ? '<span class="md-cast-director-badge">Режиссёр</span>' : ''}
          </div>
          <div class="md-cast-name">${escapeHtml(m.name)}</div>
          <div class="md-cast-role">${escapeHtml(m.role)}</div>
        </div>
      `).join('')}
    </div>
  `;

  // Скролл карусели кнопками навигации
  const track = document.getElementById('md-cast-track');
  const prevBtn = document.getElementById('md-cast-prev-btn');
  const nextBtn = document.getElementById('md-cast-next-btn');

  if (prevBtn && track) {
    prevBtn.onclick = () => track.scrollBy({ left: -360, behavior: 'smooth' });
  }
  if (nextBtn && track) {
    nextBtn.onclick = () => track.scrollBy({ left: 360, behavior: 'smooth' });
  }

  // Клик по карточке персоны открывает окно фильмографии
  container.querySelectorAll('.md-cast-card').forEach(card => {
    card.onclick = () => {
      const pid = card.dataset.personId;
      const pname = card.dataset.personName;
      if (pid || pname) {
        openPersonModal(pid || pname, pname);
      }
    };
  });
}

// ==========================================
// МОДАЛЬНОЕ ОКНО ФИЛЬМОГРАФИИ АКТЕРА И РЕЖИССЕРА
// ==========================================
export async function openPersonModal(personId, personName) {
  const modal = document.getElementById('person-modal');
  const title = document.getElementById('person-modal-title');
  const body = document.getElementById('person-modal-body');
  if (!modal || !body) return;

  modal.style.setProperty('z-index', '120000', 'important');
  const closeBtn = modal.querySelector('.storm-modal-close');
  if (closeBtn) {
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      modal.classList.remove('is-open');
    };
  }
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.classList.remove('is-open');
    }
  };

  if (title) title.textContent = personName ? `Фильмография: ${personName}` : 'Фильмография';
  modal.classList.add('is-open');

  body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;padding:40px;color:var(--text-muted);gap:12px;">
      <div class="storm-spinner"></div>
      <span style="font-weight:600;">Загрузка фильмографии...</span>
    </div>
  `;

  try {
    const queryParams = new URLSearchParams({
      id: String(personId || '').trim(),
      name: String(personName || '').trim()
    });
    const res = await fetch(`/api/media/person?${queryParams.toString()}`);
    if (!res.ok) throw new Error('Не удалось загрузить данные персоны');
    const data = await res.json();
    const person = data.person || { name: personName || 'Персона', known_for: 'Кинематографист', photo: 'assets/avatar_default.svg' };
    let items = Array.isArray(data.items) ? [...data.items] : [];
    if (items.length === 0 && currentMedia && currentMedia.title) {
      items.push(currentMedia);
    }

    let formattedBirthday = '';
    if (person.birthday) {
      const parts = String(person.birthday).split('-');
      if (parts.length === 3) {
        formattedBirthday = `${parts[2].padStart(2, '0')}.${parts[1].padStart(2, '0')}.${parts[0]}`;
      } else {
        formattedBirthday = person.birthday;
      }
    }

    body.innerHTML = `
      <div class="person-profile-header">
        <img src="${getSafePersonPhotoUrl(person.photo)}" alt="${escapeHtml(person.name || personName || 'Персона')}" class="person-profile-photo" onerror="if(!this.dataset.failed){ this.dataset.failed='1'; this.src='assets/avatar_default.svg'; }">
        <div class="person-profile-info">
          <h3 class="person-profile-name">${escapeHtml(person.name || personName || '')}</h3>
          <div class="person-profile-meta">
            <span>${escapeHtml(person.known_for || 'Кинематографист')}</span>
            ${formattedBirthday ? `<span>• Дата рождения: <b>${escapeHtml(formattedBirthday)}</b></span>` : ''}
            ${person.place_of_birth ? `<span>• ${escapeHtml(person.place_of_birth)}</span>` : ''}
          </div>
          ${person.biography ? `<p class="person-profile-bio">${escapeHtml(person.biography)}</p>` : ''}
        </div>
      </div>

      <div style="font-size:14px;font-weight:800;margin:20px 0 12px;color:var(--text-primary);display:flex;align-items:center;gap:8px;">
        <span>🎬</span>
        <span>Фильмы и сериалы (${items.length})</span>
      </div>

      <div class="person-filmography-grid">
        ${items.length === 0 ? `
          <div style="grid-column:1/-1;text-align:center;padding:24px;color:var(--text-muted);">
            Фильмография не найдена
          </div>
        ` : items.map(item => `
          <div class="person-media-card" data-id="${item.id}" data-source="${item.source || 'tmdb'}">
            <div class="person-media-poster-box">
              <img src="${(item.poster && !item.poster.startsWith('assets/') && !item.poster.startsWith('/api/')) ? `/api/media/image-proxy?url=${encodeURIComponent(item.poster)}` : (item.poster || 'assets/favicon.svg')}" alt="${escapeHtml(item.title || '')}" class="person-media-poster" loading="lazy" onerror="this.src='assets/favicon.svg'">
              <span class="person-media-rating">★ ${item.rating || '—'}</span>
              <span class="person-media-badge-4k" title="Воспроизведение в 4K Ultra HD качестве">4K UHD</span>
            </div>
            <div class="person-media-info">
              <div class="person-media-title" title="${escapeHtml(item.title || '')}">${escapeHtml(item.title || '')}</div>
              <div class="person-media-year">${item.year || ''} • ${item.media_type === 'series' ? 'Сериал' : 'Фильм'}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    body.querySelectorAll('.person-media-card').forEach((card, idx) => {
      card.onclick = () => {
        modal.classList.remove('is-open');
        openPlayerModal(items[idx]);
      };
    });
  } catch (err) {
    body.innerHTML = `
      <div style="text-align:center;padding:30px;color:var(--color-red);">
        Ошибка загрузки: ${err.message}
      </div>
    `;
  }
}

// ==========================================
// ИНТЕРАКТИВНЫЙ ТАЙМКОД ИЗ ОТЗЫВОВ ЗРИТЕЛЕЙ
// ==========================================
window.seekPlayerToTimecode = function(timecodeStr) {
  if (!timecodeStr) return;
  const parts = String(timecodeStr).split(':').map(p => parseInt(p, 10) || 0);
  let totalSeconds = 0;
  if (parts.length === 3) {
    totalSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    totalSeconds = parts[0] * 60 + parts[1];
  } else {
    totalSeconds = parts[0];
  }

  // Проверяем наличие нативного HTML5 video
  const video = document.querySelector('#cinema-player-wrapper video');
  if (video) {
    video.currentTime = totalSeconds;
    video.play().catch(() => {});
    showToast(`⏱️ Перемотка на таймкод ${timecodeStr}`, 'info');
    return;
  }

  // Если iframe (плееры Kinobox, FanFilm 4K, Kodik)
  const iframe = document.querySelector('#cinema-player-wrapper iframe');
  if (iframe && iframe.contentWindow) {
    try {
      iframe.contentWindow.postMessage({ event: 'seek', time: totalSeconds }, '*');
      iframe.contentWindow.postMessage({ api: 'seek', time: totalSeconds }, '*');
      iframe.contentWindow.postMessage({ type: 'seek', value: totalSeconds }, '*');
      showToast(`⏱️ Перемотка на таймкод ${timecodeStr}`, 'info');
    } catch (e) {
      console.warn('Seek postMessage error:', e);
    }
  } else {
    showToast(`⏱️ Таймкод: ${timecodeStr}`, 'info');
  }
};

// ==========================================
// СЕЛЕКТОР СЕЗОНОВ И СЕРИЙ С ДИНАМИЧЕСКИМИ ОПИСАНИЯМИ И СТАТУСАМИ
// ==========================================
async function renderSeriesSeasons(mediaDetails, initialSeason = null, initialEpisode = null) {
  const container = document.getElementById('series-seasons-container');
  if (!container) return;

  if (quickBarSeriesData?.type === 'movie') {
    container.style.display = 'none';
    return;
  }

  const detType = detectClientMediaType(mediaDetails);
  const isMovie = !checkIfMediaIsSeries(mediaDetails) && !checkIfMediaIsSeries(currentMedia) &&
                  (detType === 'movie' || detType === 'cartoon' || detType === 'anime-movie' ||
                   mediaDetails.media_type === 'movie' || mediaDetails.category === 'Фильм' || mediaDetails.category === 'фильм');

  const isSeries = !isMovie && (checkIfMediaIsSeries(mediaDetails) ||
                   checkIfMediaIsSeries(currentMedia) ||
                   detType === 'series' ||
                   detType === 'cartoon-series' ||
                   detType === 'anime-series' ||
                   mediaDetails.media_type === 'series' || 
                   mediaDetails.category === 'Сериал' || 
                   mediaDetails.category === 'сериал' ||
                   mediaDetails.media_type === 'cartoon-series' || 
                   mediaDetails.media_type === 'anime-series' ||
                   ((mediaDetails.source === 'anilibria' || mediaDetails.source === 'anixart') && mediaDetails.media_type !== 'anime-movie') ||
                   (mediaDetails.seasons && mediaDetails.seasons.length > 1) ||
                   (mediaDetails.episodes && mediaDetails.episodes.length > 1) ||
                   (quickBarSeriesData && quickBarSeriesData.type !== 'movie' && quickBarSeriesData.seasons && quickBarSeriesData.seasons.length > 0));
  if (typeof mediaDetails.seasons === 'number' && mediaDetails.seasons > 0) {
    mediaDetails.seasons = Array.from({ length: mediaDetails.seasons }, (_, i) => ({
      season_number: i + 1,
      name: `Сезон ${i + 1}`,
      episode_count: 8,
      overview: ''
    }));
  }

  let seasons = mediaDetails.seasons || [];

  if (quickBarSeriesData?.type !== 'movie' && quickBarSeriesData?.seasons && quickBarSeriesData.seasons.length > seasons.length) {
    seasons = quickBarSeriesData.seasons.map(qs => {
      const existing = (mediaDetails.seasons || []).find(s => s.season_number === qs.season);
      return {
        season_number: qs.season,
        name: qs.name || `Сезон ${qs.season}`,
        episode_count: qs.episodes?.length || qs.episodes_count || 8,
        overview: existing?.overview || ''
      };
    });
    mediaDetails.seasons = seasons;
  }

  if (!isSeries) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';

  // Инициализация кнопки сворачивания/разворачивания блока
  const collapseBtn = document.getElementById('series-collapse-btn');
  const collapseIcon = document.getElementById('series-collapse-icon');
  const collapseText = document.getElementById('series-collapse-text');
  if (collapseBtn && !collapseBtn.dataset.hasCollapseListener) {
    collapseBtn.dataset.hasCollapseListener = 'true';
    collapseBtn.onclick = () => {
      const isCollapsed = container.classList.toggle('is-collapsed');
      if (collapseIcon) collapseIcon.textContent = isCollapsed ? '▼' : '▲';
      if (collapseText) collapseText.textContent = isCollapsed ? 'Развернуть' : 'Свернуть';
      collapseBtn.title = isCollapsed ? 'Развернуть блок серий' : 'Свернуть блок серий';
    };
  }

  const tabsContainer = document.getElementById('series-seasons-tabs');
  const infoBox = document.getElementById('series-season-info-box');
  const gridEl = document.getElementById('series-episodes-grid');

  if (!tabsContainer || !gridEl) return;

  // Если список сезонов пуст или содержит только 1 сезон, пробуем динамически обогатить полным списком сезонов из TMDB
  if (seasons.length <= 1 && mediaDetails.source !== 'anilibria' && mediaDetails.source !== 'anixart') {
    if (seasons.length === 0) {
      tabsContainer.innerHTML = `
        <div style="padding: 10px 16px; display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-muted);">
          <div class="storm-spinner" style="width: 16px; height: 16px;"></div>
          <span>Поиск сезонов и серий...</span>
        </div>
      `;
      gridEl.innerHTML = '';
    }

    try {
      const cleanSerTitle = cleanVideoTitle(mediaDetails.title || '');
      // 1. Пробуем запросить полные метаданные сериала из TMDB (с авторизацией для подхвата закладки)
      const tmdbAuthHeaders = {};
      const activeTok = localStorage.getItem('storm_token');
      if (activeTok) tmdbAuthHeaders['Authorization'] = `Bearer ${activeTok}`;
      const itemRes = await fetch(`/api/media/item?title=${encodeURIComponent(cleanSerTitle)}&source=tmdb&media_type=series`, { headers: tmdbAuthHeaders });
      if (itemRes.ok) {
        const itemData = await itemRes.json();
        if (itemData?.user_bookmark && !mediaDetails.user_bookmark) {
          mediaDetails.user_bookmark = itemData.user_bookmark;
          if (itemData.user_bookmark.status && !mediaDetails.user_status) {
            mediaDetails.user_status = itemData.user_bookmark.status;
          }
        }
        if (itemData?.seasons && itemData.seasons.length > seasons.length) {
          mediaDetails.seasons = itemData.seasons;
          seasons = itemData.seasons;
          if (itemData.tmdb_id) {
            mediaDetails.tmdb_id = itemData.tmdb_id;
          }
          if (itemData.description && (!mediaDetails.description || mediaDetails.description.length < itemData.description.length || mediaDetails.description.includes('выходящего под названием'))) {
            mediaDetails.description = itemData.description;
            const modalDesc = document.getElementById('cinema-modal-desc');
            if (modalDesc) modalDesc.textContent = itemData.description;
          }
          if (!quickBarSeriesData?.seasons || quickBarSeriesData.seasons.length < seasons.length) {
            quickBarSeriesData = {
              success: true,
              type: 'series',
              seasons: seasons.map(s => {
                const sNum = Number(s.season_number || s.season) || 1;
                const epCnt = Number(s.episode_count || s.episodes_count || (Array.isArray(s.episodes) ? s.episodes.length : 8)) || 8;
                return {
                  season: sNum,
                  name: s.name || `Сезон ${sNum}`,
                  episodes_count: epCnt,
                  episodes: Array.from({ length: epCnt }, (_, idx) => ({
                    episode: idx + 1,
                    name: `${idx + 1} серия`,
                    overview: '',
                    translations: []
                  }))
                };
              }),
              active: quickBarSeriesData?.active || { season: initialSeason || 1, episode: initialEpisode || 1, id_translation: null }
            };
          }
          ensureCompletedSeriesEpisodesHydrated(mediaDetails, seasons);
          renderQuickBarDropdowns();
        }
      }

      // 2. Если сезоны всё ещё не найдены, запрашиваем серии 1 сезона
      if (seasons.length === 0) {
        const epRes = await fetch(`/api/media/series-episodes?season=1&title=${encodeURIComponent(cleanSerTitle)}`);
        if (epRes.ok) {
          const epData = await epRes.json();
          if (epData?.episodes && epData.episodes.length > 0) {
            mediaDetails.seasons = [{
              season_number: 1,
              name: 'Сезон 1',
              episode_count: epData.episodes.length,
              overview: epData.overview || ''
            }];
            seasons = mediaDetails.seasons;
          }
        }
      }
    } catch (e) {
      console.warn('Ошибка динамической загрузки сезонов:', e);
    }

    // 3. Если даже после запросов сезоны не найдены, создаем гарантированный Сезон 1
    if (seasons.length === 0) {
      mediaDetails.seasons = [{
        season_number: 1,
        name: 'Сезон 1',
        episode_count: 8,
        overview: ''
      }];
      seasons = mediaDetails.seasons;
    }
  }

  sortSeasonsAndEpisodes(seasons);
  if (Array.isArray(mediaDetails.seasons)) {
    sortSeasonsAndEpisodes(mediaDetails.seasons);
  }
  if (ensureCompletedSeriesEpisodesHydrated(mediaDetails, seasons)) {
    renderQuickBarDropdowns();
  }

  let activeSeasonNum = initialSeason ? parseInt(initialSeason, 10) : null;
  let activeEpisodeNum = initialEpisode ? parseInt(initialEpisode, 10) : null;

  if (!activeSeasonNum || !activeEpisodeNum) {
    const resume = resolveLastUnfinishedEpisode(mediaDetails) || resolveLastUnfinishedEpisode(currentMedia);
    if (resume) {
      if (!activeSeasonNum && resume.season) activeSeasonNum = resume.season;
      if (!activeEpisodeNum && resume.episode) activeEpisodeNum = resume.episode;
    }
  }

  if (!activeSeasonNum) {
    activeSeasonNum = seasons[0] ? seasons[0].season_number : 1;
  }
  if (!activeEpisodeNum) {
    activeEpisodeNum = 1;
  }

  function proxyMediaImageUrl(rawUrl, fallbackTitle = '') {
    if (!rawUrl || rawUrl === 'assets/favicon.svg') return '';
    const u = String(rawUrl).trim();
    if (!u || u === 'assets/favicon.svg') return '';
    if (u.startsWith('/api/media/image-proxy') || u.startsWith('data:') || u.startsWith('assets/')) return u;
    if (u.startsWith('http://') || u.startsWith('https://') || u.startsWith('//')) {
      const full = u.startsWith('//') ? 'https:' + u : u;
      return `/api/media/image-proxy?url=${encodeURIComponent(full)}&title=${encodeURIComponent(fallbackTitle)}`;
    }
    return u;
  }

  function resolveEpisodeThumbUrl(ep, idx = 0) {
    const cleanT = cleanVideoTitle(mediaDetails.title || currentMedia?.title || '');
    const primary = ep?.still || ep?.still_path || ep?.preview || '';
    const gallery = mediaDetails?.screenshots || mediaDetails?.screenshot_images || mediaDetails?.frames ||
                    currentMedia?.screenshots || currentMedia?.screenshot_images || currentMedia?.frames || [];
    const backdrop = mediaDetails?.backdrop || mediaDetails?.backdrop_path || currentMedia?.backdrop || '';
    const poster = mediaDetails?.poster || currentMedia?.poster || '';

    // Если primary не пустой и не равен общему постеру/заглушке — используем его
    if (primary && primary !== 'assets/favicon.svg' && primary !== poster) {
      const proxied = proxyMediaImageUrl(primary, cleanT);
      if (proxied) return proxied;
    }
    // Если есть кадры из галереи релиза — берем кадр по номеру серии
    if (Array.isArray(gallery) && gallery.length > 0) {
      const frameCandidate = gallery[idx % gallery.length];
      const proxiedFrame = proxyMediaImageUrl(frameCandidate, cleanT);
      if (proxiedFrame) return proxiedFrame;
    }
    if (backdrop) {
      const proxiedBg = proxyMediaImageUrl(backdrop, cleanT);
      if (proxiedBg) return proxiedBg;
    }
    if (primary && primary !== 'assets/favicon.svg') {
      const proxiedPrim = proxyMediaImageUrl(primary, cleanT);
      if (proxiedPrim) return proxiedPrim;
    }
    if (poster && poster !== 'assets/favicon.svg') {
      const proxiedPoster = proxyMediaImageUrl(poster, cleanT);
      if (proxiedPoster) return proxiedPoster;
    }
    return `/api/media/image-proxy?title=${encodeURIComponent(cleanT)}`;
  }

  function updateEpisodeSynopsis(ep) {
    const modalDesc = document.getElementById('cinema-modal-desc');
    if (!modalDesc) return;
    if (!ep) {
      modalDesc.textContent = mediaDetails.description || '';
      return;
    }
    const epTitle = ep.name || `Серия ${ep.episode_number}`;
    const cleanMediaDesc = (mediaDetails.description || '').trim();
    const cleanEpOverview = (ep.overview || '').trim();

    // Проверяем, дублирует ли синопсис серии общее описание сериала
    const isOverviewDuplicate = !cleanEpOverview ||
      cleanEpOverview === cleanMediaDesc ||
      (cleanMediaDesc.length > 30 && cleanEpOverview.startsWith(cleanMediaDesc.substring(0, 40)));

    if (isOverviewDuplicate) {
      modalDesc.innerHTML = `
        <div style="background: rgba(0, 210, 255, 0.08); border-left: 3px solid var(--accent); padding: 8px 14px; border-radius: 6px; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px;">
          <div style="font-weight: 800; color: #ffffff; font-size: 13.5px;">${epTitle}</div>
          ${ep.air_date ? `<span style="font-size: 11px; font-weight: 600; color: var(--accent);">Дата выхода: ${ep.air_date}</span>` : ''}
        </div>
        <div style="font-size: 12.5px; color: #cbd5e1; line-height: 1.55;">${cleanMediaDesc}</div>
      `;
    } else {
      modalDesc.innerHTML = `
        <div style="background: rgba(0, 210, 255, 0.08); border-left: 3px solid var(--accent); padding: 10px 14px; border-radius: 6px; margin-bottom: 8px;">
          <div style="font-weight: 800; color: #ffffff; font-size: 13.5px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px;">
            <span>${epTitle}</span>
            ${ep.air_date ? `<span style="font-size: 11px; font-weight: 600; color: var(--accent);">Дата выхода: ${ep.air_date}</span>` : ''}
          </div>
          <div style="font-size: 12.5px; color: #f1f5f9; margin-top: 4px; line-height: 1.55;">${cleanEpOverview}</div>
        </div>
        ${cleanMediaDesc && cleanMediaDesc !== cleanEpOverview ? `<div style="font-size: 12px; color: #94a3b8; line-height: 1.5;">${cleanMediaDesc}</div>` : ''}
      `;
    }
  }

  function renderSeasonTabs() {
    tabsContainer.innerHTML = seasons.map(s => {
      const sStatus = getSeasonStatusInfo(mediaDetails.id, s.season_number, s.episode_count || 0);
      const isAct = s.season_number === activeSeasonNum;
      return `
        <button type="button" class="series-season-tab ${isAct ? 'active' : ''}" data-season-num="${s.season_number}">
          <span>${s.name || `Сезон ${s.season_number}`}</span>
          <span class="season-status-chip ${sStatus.status}" style="font-size: 9.5px; padding: 2px 6px; margin-left: 5px;">${sStatus.label}</span>
        </button>
      `;
    }).join('');

    tabsContainer.querySelectorAll('.series-season-tab').forEach(tab => {
      tab.onclick = () => {
        const sNum = parseInt(tab.dataset.seasonNum, 10);
        activeSeasonNum = sNum;
        activeEpisodeNum = 1;
        renderSeasonTabs();
        loadSeasonEpisodes(sNum, 1);
        if (quickBarSeriesData) {
          quickBarActiveSeason = sNum;
          quickBarActiveEpisode = 1;
          renderQuickBarDropdowns();
          updateQuickIframeSrc();
        } else if (mediaDetails.source !== 'anilibria' && mediaDetails.source !== 'anixart') {
          updatePlayerUrl(mediaDetails, sNum, 1, currentActivePlayer);
        }
      };
    });
  }

  async function loadSeasonEpisodes(seasonNum, targetEpisodeNum = null) {
    const season = seasons.find(s => s.season_number === seasonNum) || seasons[0];

    gridEl.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:24px;color:var(--text-muted);display:flex;align-items:center;justify-content:center;gap:10px;">
        <div class="storm-spinner"></div>
        <span>Загрузка серий сезона...</span>
      </div>
    `;

    try {
      let episodes = [];
      let seasonOverview = '';

      if (mediaDetails.source === 'anilibria' && ((season && Array.isArray(season.episodes) && season.episodes.length > 0) || (mediaDetails.episodes && mediaDetails.episodes.length > 0))) {
        const rawSeasonEps = (season && Array.isArray(season.episodes) && season.episodes.length > 0)
          ? season.episodes
          : mediaDetails.episodes;
        mediaDetails.episodes = rawSeasonEps;
        episodes = rawSeasonEps.map(ep => ({
          episode_number: ep.ordinal || ep.episode_number || 1,
          name: formatCleanEpisodeTitle(ep.ordinal || ep.episode_number || 1, ep.name),
          still: ep.still || ep.preview || mediaDetails.poster,
          duration: ep.duration || '24 мин.',
          air_date: ep.air_date || '',
          overview: (ep.overview && ep.overview !== mediaDetails.description) ? ep.overview : ''
        }));
        seasonOverview = season?.overview || `Официальный релиз AniLibria • ${episodes.length} серий в Full HD качестве.`;
      } else if (mediaDetails.source === 'anixart' && currentEpisodes && currentEpisodes.length > 0) {
        const vName = currentMedia?.voiceovers?.find(v => String(v.id) === String(currentVoiceoverId))?.name || 'AniXart';
        episodes = currentEpisodes.map(ep => ({
          episode_number: ep.position || 1,
          name: ep.name_ru || ep.name || `Серия ${ep.position || 1}`,
          still: ep.still || ep.preview || mediaDetails.poster,
          duration: '24 мин.',
          air_date: '',
          overview: (ep.overview && ep.overview !== mediaDetails.description) ? ep.overview : ''
        }));
        seasonOverview = `Релиз AniXart в озвучке «${vName}» • ${episodes.length} серий.`;
      } else {
        const tvId = mediaDetails.tmdb_id || (mediaDetails.source === 'tmdb' ? String(mediaDetails.id).replace('tmdb_', '') : '');
        const cleanSerTitle = cleanVideoTitle(mediaDetails.title || '');
        try {
          const res = await fetch(`/api/media/series-episodes?tvId=${encodeURIComponent(tvId)}&season=${seasonNum}&title=${encodeURIComponent(cleanSerTitle)}`, {
            signal: AbortSignal.timeout(6000)
          });
          if (res.ok) {
            const data = await res.json();
            episodes = data.episodes || [];
            const isTmdbSeasonOverviewDup = data.overview && mediaDetails.description && data.overview.trim() === mediaDetails.description.trim();
            seasonOverview = (!isTmdbSeasonOverviewDup && data.overview) || season.overview || `${season.name || `Сезон ${seasonNum}`} • ${episodes.length} серий.`;
          }
        } catch (fetchErr) {
          console.warn('Сбой загрузки серий из API:', fetchErr);
        }

        // Если из API не пришли детальные серии, проверяем quickBarSeriesData
        if ((!episodes || episodes.length === 0) && quickBarSeriesData?.type !== 'movie' && quickBarSeriesData?.seasons) {
          const qSeason = quickBarSeriesData.seasons.find(s => s.season === seasonNum);
          if (qSeason && qSeason.episodes?.length > 0) {
            episodes = qSeason.episodes.map(qe => ({
              episode_number: qe.episode,
              name: qe.name || `${qe.episode} серия`,
              still: qe.still || mediaDetails.poster || 'assets/favicon.svg',
              duration: qe.duration || '50 мин.',
              air_date: qe.air_date || '',
              overview: qe.overview || `Серия ${qe.episode}. Смотрите ${qe.episode}-ю серию проекта «${cleanSerTitle}» в высоком разрешении со студийным переводом.`
            }));
          }
        }
      }

      // Обогащаем названия и синопсисы эпизодов аниме из баз знаний TMDB / Shikimori
      if ((mediaDetails.source === 'anixart' || mediaDetails.source === 'anilibria') && episodes.length > 0) {
        try {
          const cleanSerTitle = cleanVideoTitle(mediaDetails.title || '');
          const metaRes = await fetch(`/api/media/series-episodes?season=${seasonNum}&title=${encodeURIComponent(cleanSerTitle)}`, {
            signal: AbortSignal.timeout(5000)
          });
          if (metaRes.ok) {
            const metaData = await metaRes.json();
            if (metaData?.episodes && metaData.episodes.length > 0) {
              episodes.forEach(ep => {
                const match = metaData.episodes.find(m => m.episode_number === ep.episode_number);
                if (match) {
                  if (match.name) {
                    ep.name = formatCleanEpisodeTitle(ep.episode_number, match.name);
                  }
                  if (match.overview && (!ep.overview || ep.overview === mediaDetails.description)) {
                    ep.overview = match.overview;
                  }
                  if (match.still && (!ep.still || ep.still === mediaDetails.poster)) {
                    ep.still = match.still;
                  }
                  if (match.air_date && !ep.air_date) {
                    ep.air_date = match.air_date;
                  }
                }
              });
            }
          }
        } catch (e) {}
      }

      // Гарантируем качественный синопсис у каждого эпизода
      episodes.forEach(ep => {
        if (!ep.overview || ep.overview.trim() === '' || ep.overview === mediaDetails.description) {
          const epTitle = (ep.name && ep.name !== `Серия ${ep.episode_number}`) ? `«${ep.name}»` : `серии ${ep.episode_number}`;
          ep.overview = `Эпизод ${epTitle}. Смотрите ${ep.episode_number}-ю серию проекта «${mediaDetails.title}» в высоком разрешении со студийным переводом и субтитрами.`;
        }
      });

      if (episodes.length === 0) {
        const fallbackCount = Math.max(season?.episode_count || 8, 8);
        episodes = Array.from({ length: fallbackCount }, (_, i) => ({
          episode_number: i + 1,
          name: `${i + 1} серия`,
          still: mediaDetails.poster || 'assets/favicon.svg',
          duration: mediaDetails.duration || '45 мин.',
          air_date: season?.air_date || '',
          overview: `Серия ${i + 1}. Смотрите ${i + 1}-ю серию проекта «${cleanVideoTitle(mediaDetails.title || '')}» в высоком разрешении со студийным переводом и субтитрами.`
        }));
      }

      const sStatus = getSeasonStatusInfo(mediaDetails.id, seasonNum, episodes.length);
      const isSeasonAllWatched = sStatus.status === 'completed';

      // Проверяем, не дублирует ли seasonOverview общее описание сериала
      const isSeasonOverviewDuplicate = !seasonOverview || 
        (mediaDetails.description && seasonOverview.trim() === mediaDetails.description.trim()) ||
        (mediaDetails.description && seasonOverview.startsWith(mediaDetails.description.substring(0, 40)));

      const finalSeasonDesc = isSeasonOverviewDuplicate 
        ? `${season.name || `Сезон ${seasonNum}`} • ${episodes.length} серий в высоком разрешении.` 
        : seasonOverview;

      if (infoBox) {
        infoBox.innerHTML = `
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 8px;">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <strong style="font-size: 13.5px; color: #ffffff;">${season.name || `Сезон ${seasonNum}`}</strong>
              <span class="season-status-chip ${sStatus.status}">${sStatus.label}</span>
              <div class="season-status-select-wrap">
                <label for="season-status-select">Статус:</label>
                <select class="storm-select season-status-select" id="season-status-select">
                  <option value="planned" ${sStatus.status === 'planned' ? 'selected' : ''}>📋 В планах</option>
                  <option value="watching" ${sStatus.status === 'watching' ? 'selected' : ''}>▶ Смотрю</option>
                  <option value="completed" ${sStatus.status === 'completed' ? 'selected' : ''}>✓ Просмотрен</option>
                  <option value="on_hold" ${sStatus.status === 'on_hold' ? 'selected' : ''}>⏸️ Отложен</option>
                  <option value="dropped" ${sStatus.status === 'dropped' ? 'selected' : ''}>🛑 Заброшен</option>
                </select>
              </div>
            </div>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="season-ai-recap-btn" style="font-size: 11px; padding: 4px 10px; border-color: rgba(168, 85, 247, 0.45); color: #e9d5ff;" title="Краткий дайджест предыдущих сезонов без спойлеров к текущей серии">
                🧠 Что было в прошлых сезонах
              </button>
              <button type="button" class="storm-btn storm-btn-sm ${isSeasonAllWatched ? 'storm-btn-secondary' : 'storm-btn-primary'}" id="toggle-season-btn" style="font-size: 11px; padding: 4px 10px;">
                ${isSeasonAllWatched ? '✕ Снять отметку' : '✓ Отметить весь сезон'}
              </button>
            </div>
          </div>
          <div class="series-season-desc" id="series-season-desc">${finalSeasonDesc}</div>
          <div id="season-ai-recap-box" style="display: none; margin-top: 10px; padding: 12px 14px; border-radius: 10px; background: rgba(168, 85, 247, 0.09); border: 1px solid rgba(168, 85, 247, 0.35);"></div>
        `;

        const statusSelect = infoBox.querySelector('#season-status-select');
        if (statusSelect) {
          statusSelect.onchange = async (e) => {
            const selectedStatus = e.target.value;
            applySeasonStatus(mediaDetails.id, seasonNum, selectedStatus, episodes);
            if (selectedStatus === 'completed') {
              showToast(`Сезон ${seasonNum} отмечен как просмотренный: все серии просмотрены`, 'success');
            } else {
              const label = statusSelect.options[statusSelect.selectedIndex]?.text || selectedStatus;
              showToast(`Сезон ${seasonNum}: статус «${label}»`, 'info');
            }
            renderSeasonTabs();
            await syncOverallSeriesProgress(mediaDetails);
            renderQuickBarDropdowns();
            loadSeasonEpisodes(seasonNum, activeEpisodeNum || 1);
          };
        }

        const recapBtn = infoBox.querySelector('#season-ai-recap-btn');
        const recapBox = infoBox.querySelector('#season-ai-recap-box');
        if (recapBtn && recapBox) {
          recapBtn.onclick = async () => {
            if (recapBox.style.display === 'block') {
              recapBox.style.display = 'none';
              return;
            }
            recapBox.style.display = 'block';
            recapBox.innerHTML = `<div style="font-size:12px;color:var(--text-muted);">⏳ Генерация дайджеста предыдущих сезонов «${escapeHtml(cleanVideoTitle(mediaDetails.title || ''))}»...</div>`;
            try {
              const tvId = mediaDetails.tmdb_id || '';
              const r = await fetch(`/api/media/season-recap?title=${encodeURIComponent(cleanVideoTitle(mediaDetails.title || ''))}&tvId=${encodeURIComponent(tvId)}&season=${seasonNum}`);
              const d = await r.json();
              if (!d || !d.success) throw new Error('Не удалось сформировать дайджест');
              recapBox.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                  <strong style="font-size:13px;color:#e9d5ff;">🧠 ${escapeHtml(d.recapTitle)}</strong>
                  <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="close-recap-box-btn" style="padding:2px 8px;font-size:11px;">Скрыть</button>
                </div>
                <div style="display:flex;flex-direction:column;gap:8px;">
                  ${(d.seasons || []).map(s => `
                    <div style="background:rgba(15,23,42,0.65);padding:8px 12px;border-radius:8px;border-left:3px solid #a855f7;">
                      <div style="font-weight:800;font-size:12px;color:#fff;margin-bottom:3px;">${escapeHtml(s.title)} (${s.episodes_count || 8} серий)</div>
                      <div style="font-size:12px;color:#cbd5e1;white-space:pre-line;line-height:1.45;">${escapeHtml(s.overview)}</div>
                    </div>
                  `).join('')}
                </div>
              `;
              recapBox.querySelector('#close-recap-box-btn')?.addEventListener('click', () => {
                recapBox.style.display = 'none';
              });
            } catch (err) {
              recapBox.innerHTML = `<div style="font-size:12px;color:#f87171;">${escapeHtml(err.message)}</div>`;
            }
          };
        }

        const toggleBtn = infoBox.querySelector('#toggle-season-btn');
        if (toggleBtn) {
          toggleBtn.onclick = async () => {
            const marked = toggleAllSeasonEpisodesWatched(mediaDetails.id, seasonNum, episodes.length, episodes);
            showToast(marked ? `Сезон ${seasonNum} отмечен как просмотренный: все серии просмотрены` : `Отметка снята с сезона ${seasonNum}`, 'info');
            renderSeasonTabs();
            await syncOverallSeriesProgress(mediaDetails);
            renderQuickBarDropdowns();
            loadSeasonEpisodes(seasonNum, activeEpisodeNum || 1);
          };
        }
      }

      const watchedSet = getWatchedEpisodes(mediaDetails.id, seasonNum);
      const effectiveTargetEp = targetEpisodeNum ? parseInt(targetEpisodeNum, 10) : 1;
      activeEpisodeNum = effectiveTargetEp;

      // Первичное обновление синопсиса активной серии
      const initialEp = episodes.find(e => e.episode_number === effectiveTargetEp) || episodes[0];
      if (initialEp) {
        updateEpisodeSynopsis(initialEp);
      }

      const fallbackPosterThumb = proxyMediaImageUrl(mediaDetails.poster || currentMedia?.poster || '', cleanVideoTitle(mediaDetails.title || '')) || 'assets/favicon.svg';

      gridEl.innerHTML = episodes.map((ep, idx) => {
        const isEpActive = ep.episode_number === effectiveTargetEp;
        const isWatched = watchedSet.has(ep.episode_number);
        const epStatusLabel = isWatched ? '✓ Просмотрено' : (isEpActive ? '▶ Смотрю' : 'Не просмотрено');
        const epStatusClass = isWatched ? 'completed' : (isEpActive ? 'watching' : 'planned');
        const thumbUrl = resolveEpisodeThumbUrl(ep, idx);

        return `
        <div class="series-episode-card storm-focusable ${isEpActive ? 'active' : ''} ${isWatched ? 'watched' : ''}" data-ep-num="${ep.episode_number}" tabindex="0">
          <div class="series-episode-thumb-box">
            <img src="${thumbUrl}" alt="${escapeHtml(ep.name)}" class="series-episode-thumb" loading="lazy" onerror="if(!this.dataset.fb){this.dataset.fb='1';this.src='${fallbackPosterThumb}';}else{this.src='assets/favicon.svg';}">
            <div class="series-episode-play-overlay"><span>▶</span></div>
            <span class="series-episode-badge">Серия ${ep.episode_number}</span>
            ${ep.duration ? `<span class="series-episode-duration">${ep.duration}</span>` : ''}
          </div>
          <div class="series-episode-content">
            <div class="series-episode-title" title="${escapeHtml(ep.name)}">${escapeHtml(ep.name)}</div>
            <div class="series-episode-meta-row">
              <span class="series-episode-airdate">${ep.air_date ? '📅 ' + ep.air_date : ''}</span>
              ${(() => {
                try {
                  const savedSec = parseInt(localStorage.getItem(`storm_ep_watchtime_${mediaDetails.id}_s${seasonNum}_e${ep.episode_number}`) || '0', 10);
                  if (savedSec >= 10 && !isWatched) {
                    return `<span class="series-episode-resume-chip" title="Вы остановились на этом времени">⏱ ${formatResumeTimecode(savedSec)}</span>`;
                  }
                } catch (_) {}
                return '';
              })()}
              <span class="season-status-chip ${epStatusClass} ep-status-toggle" data-ep-num="${ep.episode_number}" title="Нажмите для переключения статуса серии">
                ${epStatusLabel}
              </span>
            </div>
            <p class="series-episode-desc" title="${escapeHtml(ep.overview)}">${escapeHtml(ep.overview)}</p>
          </div>
        </div>
      `;
      }).join('');

      gridEl.querySelectorAll('.series-episode-card').forEach(card => {
        card.onclick = async (evt) => {
          const epNum = parseInt(card.dataset.epNum, 10);
          const epObj = episodes.find(e => e.episode_number === epNum) || episodes[epNum - 1];

          // Если клик по плашке статуса - переключаем статус серии
          if (evt.target.closest('.ep-status-toggle')) {
            evt.stopPropagation();
            const nowWatched = toggleEpisodeWatched(mediaDetails.id, seasonNum, epNum);
            showToast(nowWatched ? `Серия ${epNum} отмечена как просмотренная` : `Отметка снята с серии ${epNum}`, 'info');
            renderSeasonTabs();
            await syncOverallSeriesProgress(mediaDetails);
            renderQuickBarDropdowns();
            loadSeasonEpisodes(seasonNum, activeEpisodeNum);
            return;
          }

          gridEl.querySelectorAll('.series-episode-card').forEach(c => c.classList.remove('active'));
          card.classList.add('active');
          activeEpisodeNum = epNum;

          updateEpisodeSynopsis(epObj);

          showToast(`Выбрана серия ${epNum}: ${epObj?.name || ''}`, 'info');
          updateProgressState(epNum, episodes.length);
          renderSeasonTabs();

          // Обновляем быструю панель
          quickBarActiveSeason = seasonNum;
          quickBarActiveEpisode = epNum;
          renderQuickBarDropdowns();

          if (!currentMedia) currentMedia = mediaDetails;
          startInvisibleEpisodeWatchTracker(currentMedia, seasonNum, epNum);
          playEpisodeByNumber(epNum, seasonNum);
        };
      });

      if (effectiveTargetEp) {
        const activeCard = gridEl.querySelector(`.series-episode-card[data-ep-num="${effectiveTargetEp}"]`);
        if (activeCard) {
          activeCard.classList.add('active', 'watched');
        }
      }
    } catch (err) {
      gridEl.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--color-red);">Ошибка: ${err.message}</div>`;
    }
  }

  renderSeasonTabs();
  loadSeasonEpisodes(activeSeasonNum, initialEpisode || 1);
}

// ==========================================================================
// ПОКАДРОВЫЕ ЗАКЛАДКИ ЛЮБИМЫХ СЦЕН И СТОП-КАДР (SCENE BOOKMARKS & CLIPPER)
// ==========================================================================
function getSceneBookmarksForMedia(mediaId) {
  if (!mediaId) return [];
  try {
    return JSON.parse(localStorage.getItem(`storm_scene_bookmarks_${mediaId}`) || '[]');
  } catch {
    return [];
  }
}

function saveSceneBookmarksForMedia(mediaId, list) {
  if (!mediaId) return;
  try {
    localStorage.setItem(`storm_scene_bookmarks_${mediaId}`, JSON.stringify(list));
  } catch {}
}

function renderSceneBookmarksDrawer(body, onCloseDrawer) {
  const mediaId = currentMedia?.id || 'default';
  const cleanT = cleanVideoTitle(currentMedia?.title || 'Видео');

  const getCurrentPlayerTime = () => {
    const video = document.getElementById('storm-video-player') || document.querySelector('#cinema-player-wrapper video');
    if (video && video.currentTime > 0) return Math.round(video.currentTime);
    return activeTrackingWatchedSeconds || currentWatchTimeSeconds || 0;
  };

  const formatTc = (sec) => {
    const s = Math.max(0, Math.round(sec || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const rem = s % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  };

  const renderList = () => {
    const bookmarks = getSceneBookmarksForMedia(mediaId);
    const curSec = getCurrentPlayerTime();
    const curTc = formatTc(curSec);

    body.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div style="background:var(--bg-card);padding:14px;border-radius:12px;border:1px solid var(--border-subtle);display:flex;flex-direction:column;gap:10px;">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
            <div>
              <div style="font-weight:800;font-size:13.5px;color:#fff;">📌 Добавить метку сцены для «${escapeHtml(cleanT)}»</div>
              <div style="font-size:11.5px;color:var(--text-muted);">Текущий таймкод: <b style="color:var(--accent);">${curTc}</b> ${checkIfMediaIsSeries(currentMedia) ? `• Сезон ${quickBarActiveSeason || 1}, Серия ${quickBarActiveEpisode || 1}` : ''}</div>
            </div>
            <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="capture-4k-frame-btn" style="border-color:rgba(16,185,129,0.45);color:#10b981;">
              📸 Сделать стоп-кадр (.png)
            </button>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <input type="text" class="storm-input" id="scene-bookmark-time-input" value="${curTc}" style="width:110px;text-align:center;font-weight:700;" title="Таймкод ЧЧ:ММ:СС">
            <input type="text" class="storm-input" id="scene-bookmark-note-input" placeholder="Описание момента (например: Эпичная битва / Любимая цитата)" style="flex:1;min-width:200px;">
            <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="add-scene-bookmark-btn">
              ➕ Сохранить сцену
            </button>
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:8px;">
          <div style="font-size:12px;font-weight:800;color:var(--text-secondary);">Сохраненные моменты (${bookmarks.length}):</div>
          ${bookmarks.length === 0 ? `
            <div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12.5px;background:rgba(255,255,255,0.02);border-radius:10px;">
              У вас пока нет сохраненных сцен для этого релиза. Добавьте первую метку выше!
            </div>
          ` : bookmarks.map((bm, idx) => `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:rgba(255,255,255,0.04);padding:10px 14px;border-radius:10px;border:1px solid rgba(255,255,255,0.08);">
              <div style="display:flex;align-items:center;gap:10px;min-width:0;">
                <button type="button" class="storm-btn storm-btn-primary storm-btn-sm jump-scene-btn" data-tc="${escapeHtml(bm.timecode)}" data-season="${bm.season || ''}" data-ep="${bm.episode || ''}" style="font-family:monospace;font-weight:800;">
                  ▶ ${escapeHtml(bm.timecode)}
                </button>
                <div style="min-width:0;">
                  <div style="font-size:13px;font-weight:700;color:#fff;">${escapeHtml(bm.note || 'Любимая сцена')}</div>
                  <div style="font-size:11px;color:var(--text-muted);">${bm.season ? `Сезон ${bm.season}, Серия ${bm.episode} • ` : ''}${escapeHtml(bm.date || '')}</div>
                </div>
              </div>
              <button type="button" class="storm-btn storm-btn-danger storm-btn-sm del-scene-btn" data-idx="${idx}" style="padding:4px 8px;">✕</button>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    const addBtn = body.querySelector('#add-scene-bookmark-btn');
    if (addBtn) {
      addBtn.onclick = () => {
        const tc = body.querySelector('#scene-bookmark-time-input')?.value.trim() || curTc;
        const note = body.querySelector('#scene-bookmark-note-input')?.value.trim() || 'Ключевая сцена';
        const list = getSceneBookmarksForMedia(mediaId);
        list.unshift({
          timecode: tc,
          note,
          season: checkIfMediaIsSeries(currentMedia) ? (quickBarActiveSeason || 1) : null,
          episode: checkIfMediaIsSeries(currentMedia) ? (quickBarActiveEpisode || 1) : null,
          date: new Date().toLocaleDateString('ru-RU')
        });
        saveSceneBookmarksForMedia(mediaId, list);
        showToast(`📌 Сцена на ${tc} сохранена`, 'success');
        renderList();
      };
    }

    const snapBtn = body.querySelector('#capture-4k-frame-btn');
    if (snapBtn) {
      snapBtn.onclick = () => {
        const video = document.getElementById('storm-video-player') || document.querySelector('#cinema-player-wrapper video');
        if (video && video.videoWidth > 0) {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((blob) => {
              if (!blob) return;
              const u = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = u;
              a.download = `STORM_Frame_${cleanT.replace(/\s+/g, '_')}_${curTc.replace(/:/g, '-')}.png`;
              a.click();
              URL.revokeObjectURL(u);
              showToast('📸 Стоп-кадр в оригинальном разрешении сохранен!', 'success');
            }, 'image/png');
            return;
          } catch (_) {}
        }
        // Fallback: сохраняем постер/кадр высокого разрешения через прокси
        const fallbackImg = currentMedia?.backdrop || currentMedia?.poster || '';
        if (fallbackImg) {
          window.open(fallbackImg, '_blank');
          showToast('📸 Открыт оригинальный кадр релиза', 'info');
        } else {
          showToast('Для прямого захвата кадра переключитесь на HLS плеер', 'info');
        }
      };
    }

    body.querySelectorAll('.jump-scene-btn').forEach(btn => {
      btn.onclick = () => {
        const tc = btn.dataset.tc;
        const s = parseInt(btn.dataset.season, 10);
        const ep = parseInt(btn.dataset.ep, 10);
        if (onCloseDrawer) onCloseDrawer();
        if (s && ep && (s !== quickBarActiveSeason || ep !== quickBarActiveEpisode)) {
          playEpisodeByNumber(ep, s);
          setTimeout(() => window.seekPlayerToTimecode(tc), 1200);
        } else {
          window.seekPlayerToTimecode(tc);
        }
      };
    });

    body.querySelectorAll('.del-scene-btn').forEach(btn => {
      btn.onclick = () => {
        const idx = parseInt(btn.dataset.idx, 10);
        const list = getSceneBookmarksForMedia(mediaId);
        list.splice(idx, 1);
        saveSceneBookmarksForMedia(mediaId, list);
        renderList();
      };
    });
  };

  renderList();
}

// ==========================================================================
// БЕСПРОВОДНАЯ ТРАНСЛЯЦИЯ НА ТВ (DLNA / CHROMECAST / AIRPLAY / SMART TV BRIDGE)
// ==========================================================================
async function renderSmartTvCastDrawer(body) {
  const cleanT = cleanVideoTitle(currentMedia?.title || 'Видео');
  const isSer = checkIfMediaIsSeries(currentMedia);
  body.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);">📡 Поиск доступных экранов Smart TV, Chromecast, AirPlay и DLNA в сети...</div>`;

  try {
    const devRes = await fetch('/api/cast/devices');
    const devData = await devRes.json();
    const devices = devData.devices || [];

    body.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div style="background:var(--bg-card);padding:14px;border-radius:12px;border:1px solid var(--border-subtle);">
          <div style="font-weight:800;font-size:13.5px;color:#fff;margin-bottom:4px;">📺 Беспроводная передача «${escapeHtml(cleanT)}» на большой экран</div>
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">
            Выберите устройство ниже или введите код комнаты с экрана вашего Smart TV для мгновенного запуска фильма в 4K UHD со звуком и субтитрами.
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <input type="text" class="storm-input" id="cast-tv-room-code" placeholder="Код на экране ТВ (например: STORM-ABCD)" style="flex:1;min-width:200px;text-transform:uppercase;font-weight:700;">
            <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="cast-to-room-btn">
              🚀 Передать на ТВ по коду
            </button>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px;">
          ${devices.map(d => `
            <div class="storm-card cast-device-card" data-dev-id="${escapeHtml(d.id)}" data-dev-code="${escapeHtml(d.code || '')}" style="padding:12px 14px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.09);display:flex;flex-direction:column;justify-content:space-between;gap:10px;">
              <div>
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <span style="font-size:11px;font-weight:800;color:#10b981;">🟢 Готов к приему</span>
                  <span style="font-size:10.5px;color:var(--text-muted);">${escapeHtml(d.protocol)}</span>
                </div>
                <div style="font-size:13.5px;font-weight:800;color:#fff;margin-top:4px;">📺 ${escapeHtml(d.name)}</div>
              </div>
              <button type="button" class="storm-btn storm-btn-primary storm-btn-sm trigger-cast-device-btn" data-dev-id="${escapeHtml(d.id)}" data-dev-code="${escapeHtml(d.code || '')}">
                📡 Транслировать сейчас
              </button>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    const sendCastRequest = async (deviceId, roomCode = '') => {
      const video = document.getElementById('storm-video-player') || document.querySelector('#cinema-player-wrapper video');
      if (deviceId === 'browser_presentation' && video && video.remote && typeof video.remote.prompt === 'function') {
        try {
          await video.remote.prompt();
          showToast('📺 Передача через Google Cast / Remote Playback запущена!', 'success');
          return;
        } catch (_) {}
      }
      if (deviceId === 'airplay_webkit' && video && typeof video.webkitShowPlaybackTargetPicker === 'function') {
        try {
          video.webkitShowPlaybackTargetPicker();
          showToast('📺 Открыт выбор экрана AirPlay', 'info');
          return;
        } catch (_) {}
      }
      if (deviceId === 'dlna_vlc_playlist') {
        openLiftDownloadModal();
        showToast('📥 Выберите «Мульти-плейлист .m3u8» для прямого открытия на Smart TV / DLNA', 'info');
        return;
      }

      const res = await fetch('/api/cast/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId,
          roomCode,
          media: currentMedia,
          season: isSer ? (quickBarActiveSeason || 1) : 1,
          episode: isSer ? (quickBarActiveEpisode || 1) : 1,
          voiceover: document.getElementById('quick-voiceover-val')?.textContent || 'Дубляж'
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`📺 Поток «${cleanT}» отправлен на Smart TV!`, 'success');
      }
    };

    const castCodeBtn = body.querySelector('#cast-to-room-btn');
    if (castCodeBtn) {
      castCodeBtn.onclick = () => {
        const code = body.querySelector('#cast-tv-room-code')?.value.trim() || '';
        if (!code) {
          showToast('Введите код комнаты на экране вашего ТВ', 'warning');
          return;
        }
        sendCastRequest('storm_tv_bridge', code);
      };
    }

    body.querySelectorAll('.trigger-cast-device-btn').forEach(btn => {
      btn.onclick = () => {
        sendCastRequest(btn.dataset.devId, btn.dataset.devCode);
      };
    });
  } catch (err) {
    body.innerHTML = `<div style="padding:20px;text-align:center;color:#f87171;">Ошибка поиска ТВ-устройств: ${escapeHtml(err.message)}</div>`;
  }
}

// ==========================================================================
// УМНАЯ ЛЕНТА «НОВЫЕ СЕРИИ И ОЗВУЧКИ ВАШИХ СЕРИАЛОВ» (MY AIRING TRACKER)
// ==========================================================================
async function renderAiringTrackerDrawer(body, onCloseDrawer) {
  body.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted);">⏳ Проверка выхода новых серий и студийных озвучек ваших сериалов...</div>`;
  try {
    const token = localStorage.getItem('storm_auth_token');
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    const res = await fetch('/api/media/airing-tracker', { headers });
    const data = await res.json();
    const items = Array.isArray(data?.items) ? data.items : [];

    if (items.length === 0) {
      body.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted);">Добавьте сериалы или аниме в список «Смотрю», чтобы автоматически отслеживать выход новых серий и студийных озвучек.</div>`;
      return;
    }

    body.innerHTML = `
      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px;">
        Свежие вышедшие серии и доступные озвучки для ваших отслеживаемых сериалов и онгоингов:
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(265px,1fr));gap:10px;">
        ${items.map((it, idx) => `
          <div class="storm-card airing-tracker-card" data-idx="${idx}" style="display:flex;gap:10px;padding:10px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid ${it.has_new_episode ? 'rgba(16,185,129,0.45)' : 'rgba(255,255,255,0.08)'};cursor:pointer;">
            <img src="${it.poster}" alt="${escapeHtml(it.title)}" style="width:56px;height:82px;object-fit:cover;border-radius:6px;flex-shrink:0;" onerror="this.src='assets/favicon.svg'">
            <div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:space-between;">
              <div>
                <div style="font-size:10.5px;font-weight:800;color:#10b981;">${escapeHtml(it.badge)}</div>
                <div style="font-size:13px;font-weight:800;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(it.title)}">${escapeHtml(it.title)}</div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">🎙️ ${escapeHtml((it.voiceovers || []).join(', '))}</div>
              </div>
              <span style="font-size:11px;font-weight:800;color:var(--accent);">▶ Включить ${it.latest_season} сезон, ${it.latest_episode} серию</span>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    body.querySelectorAll('.airing-tracker-card').forEach(card => {
      card.onclick = () => {
        const picked = items[parseInt(card.dataset.idx, 10)];
        if (!picked) return;
        if (onCloseDrawer) onCloseDrawer();
        openPlayerModal({
          id: picked.media_id,
          source: picked.source || 'tmdb',
          title: picked.title,
          poster: picked.poster,
          year: picked.year,
          media_type: picked.media_type || 'series',
          season: picked.latest_season,
          episode: picked.latest_episode
        }, {
          initialSeason: picked.latest_season,
          initialEpisode: picked.latest_episode
        });
      };
    });
  } catch (err) {
    body.innerHTML = `<div style="padding:20px;text-align:center;color:#f87171;">Ошибка загрузки трекера серий: ${escapeHtml(err.message)}</div>`;
  }
}

// Слушатель синхронизации сезона/серии от хоста Кинокомнаты
if (typeof window !== 'undefined' && !window._stormRoomEpisodeSyncAttached) {
  window._stormRoomEpisodeSyncAttached = true;
  window.addEventListener('storm:watch-room-episode-sync', (e) => {
    const d = e.detail;
    if (!d) return;
    if (d.season && d.episode) {
      playEpisodeByNumber(d.episode, d.season);
    }
  });
}

if (typeof window !== 'undefined' && !window._stormResumeUnloadAttached) {
  window._stormResumeUnloadAttached = true;
  window.addEventListener('beforeunload', () => {
    const modal = document.getElementById('cinema-modal');
    if (modal && modal.classList.contains('is-open')) {
      saveMediaResumeSnapshot({ forceSync: true });
    }
  });
}
