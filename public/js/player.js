/* ==========================================================================
   STORM MULTIMEDIA - КИНОТЕАТРАЛЬНЫЙ МОДАЛЬНЫЙ ПЛЕЕР (CINEMA MODAL)
   Поддержка 4K FanFilm4K, AniLibria HLS, AniXart, Kinobox, WebTorrent,
   Ambilight эффекта, пропуска интро/аутро, PiP, субтитров и совместного просмотра
   ========================================================================== */

import { saveBookmarkStatus, deleteBookmark, syncWatchProgress, fetchCustomLists, addItemToCollection, createCustomCollection } from './bookmarks.js';
import { getUser, showToast } from './auth.js';
import { t } from './i18n.js';
import { trackClientAction } from './achievements.js';
import { renderReviewsSection } from './reviews.js';
import { attachPlayerToRoom, createWatchRoom, joinWatchRoom, leaveWatchRoom, getActiveRoom, renderRoomUi } from './watch-together.js';
import { initSubtitlesManager, renderSubtitlesControls } from './subtitles-manager.js';
import { initSmartSkip, renderChaptersOnTrack, setSmartSkipIntervals } from './smart-skip.js';
import { sendSmartLightsFrame, renderSmartLightsSettings } from './smart-lights.js';
import { toggleWhisperAiSubtitles } from './whisper-subtitles.js';
import { saveMediaForOffline } from './offline-storage.js';
import { renderTorrServerSettings } from './torrserver-client.js';
import { applyProVideoSettings, initProAudioEngine, renderProVideoPanel, renderProAudioPanel, setProAudioNightMode, getProAudioNightMode, applyProAudioSettings } from './pro-media-engine.js';

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

// Ночной звук (Web Audio Compressor)
let audioCtx = null;
let audioSourceNode = null;
let compressorNode = null;
let nightAudioModeEnabled = localStorage.getItem('storm_night_audio') === 'true';
let xrayVisible = false;

// Ambilight конфигурация и пресеты
let ambilightEnabled = false;
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
let autoSkipEnabled = localStorage.getItem('storm_auto_skip') === 'true';

// WebTorrent
let torrentClient = null;

function getSourceName(item) {
  const map = {
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
    animevost: 'Animevost'
  };
  return map[item?.source] || (item?.source || 'STORM').toUpperCase();
}

export function toggleCinemaFullscreen() {
  const videoBox = document.querySelector('.player-video-box');
  const modal = document.getElementById('cinema-modal');
  const target = videoBox || modal;
  if (!target) return;

  const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement);
  if (isFs) {
    if (document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    } else if (document.mozCancelFullScreen) {
      document.mozCancelFullScreen();
    }
  } else {
    const req = target.requestFullscreen || target.webkitRequestFullscreen || target.mozRequestFullScreen || target.msRequestFullscreen;
    if (req) {
      req.call(target).catch(() => {
        if (modal && modal !== target) {
          const mReq = modal.requestFullscreen || modal.webkitRequestFullscreen || modal.mozRequestFullScreen;
          if (mReq) mReq.call(modal).catch(() => {});
        }
      });
    }
  }
}

let fullscreenInitialized = false;
function initFullscreenControls() {
  const fsBtn = document.getElementById('cinema-header-fullscreen-btn');
  if (fsBtn && !fsBtn.dataset.hasFsListener) {
    fsBtn.dataset.hasFsListener = 'true';
    fsBtn.onclick = (e) => {
      e.stopPropagation();
      toggleCinemaFullscreen();
    };
  }

  if (fullscreenInitialized) return;
  fullscreenInitialized = true;

  const updateFsIcon = () => {
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement);
    const btn = document.getElementById('cinema-header-fullscreen-btn');
    if (btn) {
      btn.textContent = isFs ? '🗗' : '⛶';
      btn.title = isFs ? 'Выйти из полноэкранного режима (F / Esc)' : 'Развернуть на весь экран (F)';
    }
  };

  document.addEventListener('fullscreenchange', updateFsIcon);
  document.addEventListener('webkitfullscreenchange', updateFsIcon);
  document.addEventListener('mozfullscreenchange', updateFsIcon);

  // Обработка двойного клика по области видео для переключения Fullscreen
  const wrapper = document.getElementById('cinema-player-wrapper');
  if (wrapper && !wrapper.dataset.hasDblClickListener) {
    wrapper.dataset.hasDblClickListener = 'true';
    wrapper.addEventListener('dblclick', (e) => {
      if (e.target.closest('button, input, select, a, .storm-skip-btn, .storm-btn, .studio-tab-btn, .player-studio-dock, .player-studio-drawer, .xray-header, .xray-tab-content, .player-series-quick-bar')) {
        return;
      }
      toggleCinemaFullscreen();
    });
  }

  // Обработка запросов полноэкранного режима от встроенных плееров (PlayerJS, Kodik, Allplay и др.)
  window.addEventListener('message', (event) => {
    if (!event || !event.data) return;
    try {
      let data = event.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch {}
      }
      if (data === 'fullscreen' || data === 'enterfullscreen' || data === 'toggle_fullscreen' || data === 'dblclick') {
        toggleCinemaFullscreen();
      } else if (typeof data === 'object' && data) {
        if (data.event === 'fullscreen' || data.event === 'toggle_fullscreen' || data.event === 'fullscreen_toggle' || data.event === 'dblclick' || data.action === 'fullscreen') {
          toggleCinemaFullscreen();
        }
      }
    } catch {}
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
        return;
      }
      const modal = document.getElementById('cinema-modal');
      if (modal && modal.classList.contains('is-open')) {
        e.preventDefault();
        toggleCinemaFullscreen();
      }
    }
  });
}

export function buildUniversalPlayerSuite(mediaItem = {}, cleanTitle = '') {
  const title = cleanTitle || cleanVideoTitle(mediaItem.title || 'Видео');
  const safeTitle = encodeURIComponent(title);
  const year = mediaItem.year ? String(mediaItem.year).trim() : '';
  const yearParam = year ? `&year=${year}&strict=1` : '&strict=1';
  const kpId = mediaItem.kp_id || '';
  const mediaType = mediaItem.media_type || mediaItem.type || 'movie';
  const isSeries = mediaType === 'series' || mediaType === 'cartoon-series' || mediaType === 'anime-series';
  const isAnime = mediaType.includes('anime') || mediaItem.source === 'anilibria' || mediaItem.source === 'anixart';
  const typeFilter = isSeries ? '&types=foreign-serial,russian-serial,anime-serial' : '&types=foreign-movie,russian-movie,anime';
  const episodeParam = isSeries ? '&season=1&episode=1' : '';

  const suite = [];

  // 1. FanFilm 4K Ultra HD
  const fanfilmUrl = mediaItem.fanfilm_4k_url || (mediaItem.source === 'fanfilm4k' ? (mediaItem.link || mediaItem.url || '') : '');
  if (fanfilmUrl) {
    suite.push({
      id: 'fanfilm4k_uhd',
      name: '4K Ultra HD Плеер (FanFilm4K)',
      type: 'iframe',
      quality: '4K UHD',
      badge: 'FANFILM 4K',
      status: 'working',
      status_label: '🟢 4K поток',
      audio_info: 'Многоголосый дубляж 5.1 / HDR',
      speed: '💎 Премиум CDN',
      url: fanfilmUrl,
      is_recommended: true,
      recommended_badge: '🔥 Рекомендуемый'
    });
  }

  // 2. HDRezka Cinema (FHD и 4K)
  const rezkaUrl = kpId ? `https://stream.voidboost.cc/embed/${kpId}` : `https://stream.voidboost.cc/embed/search?title=${safeTitle}${yearParam}`;
  suite.push({
    id: 'rezka_cinema',
    name: 'HDRezka Cinema (FHD и 4K)',
    type: 'iframe',
    quality: '1080p FHD',
    badge: 'HDREZKA',
    status: 'working',
    status_label: '🟢 Онлайн',
    audio_info: 'Студийный перевод HDRezka Studio',
    speed: '⚡ Высокая скорость',
    url: rezkaUrl,
    is_recommended: !fanfilmUrl && !isAnime
  });

  // 3. Collaps Плеер (мировые премьеры)
  const collapsUrl = kpId ? `https://api.strvid.ws/embed/movie?kinopoisk=${kpId}` : `https://api.strvid.ws/embed/movie?title=${safeTitle}${yearParam}`;
  suite.push({
    id: 'collaps_player',
    name: 'Collaps Плеер (мировые премьеры)',
    type: 'iframe',
    quality: '1080p FHD',
    badge: 'COLLAPS',
    status: 'working',
    status_label: '🟢 Онлайн',
    audio_info: 'Чистый Full HD поток без рекламы',
    speed: '⚡ Стабильный CDN',
    url: collapsUrl
  });

  // 4. Alloha TV (стабильный FHD поток)
  const allohaUrl = kpId ? `https://api.strvid.ws/embed/movie?kinopoisk=${kpId}&player=alloha` : `https://api.strvid.ws/embed/movie?title=${safeTitle}${yearParam}&player=alloha`;
  suite.push({
    id: 'alloha_tv',
    name: 'Alloha TV (стабильный FHD поток)',
    type: 'iframe',
    quality: '1080p FHD',
    badge: 'ALLOHA',
    status: 'working',
    status_label: '🟢 Онлайн',
    audio_info: 'Профессиональный многоголосый перевод',
    speed: '⚡ Скоростной поток',
    url: allohaUrl
  });

  // 5. Kodik Плеер
  const kodikUrl = kpId ? `https://kodikplayer.com/find-player?kinopoiskID=${kpId}${typeFilter}${episodeParam}` : `https://kodikplayer.com/find-player?title=${safeTitle}${yearParam}${typeFilter}${episodeParam}`;
  suite.push({
    id: 'kodik_direct',
    name: isAnime ? 'Kodik Аниме Плеер' : 'Kodik Плеер (сериалы и озвучки)',
    type: 'iframe',
    quality: '1080p FHD',
    badge: 'KODIK',
    status: 'working',
    status_label: '🟢 Онлайн',
    audio_info: 'Большой выбор студийных озвучек',
    speed: '⚡ Быстрый поток',
    url: kodikUrl,
    is_recommended: isAnime && !fanfilmUrl
  });

  // 6. Red Head Sound (Дубляж RHS)
  const rhsUrl = kpId ? `https://kodikplayer.com/find-player?kinopoiskID=${kpId}&voice=rhs${typeFilter}${episodeParam}` : `https://kodikplayer.com/find-player?title=${safeTitle}${yearParam}&voice=rhs${typeFilter}${episodeParam}`;
  suite.push({
    id: 'rhs_player',
    name: 'Red Head Sound (Дубляж RHS)',
    type: 'iframe',
    quality: '1080p FHD',
    badge: 'RHS',
    status: 'working',
    status_label: '🟢 Онлайн',
    audio_info: 'Официальные голоса дубляжа студии RHS',
    speed: '⚡ Премиум дубляж',
    url: rhsUrl
  });

  // 7. P2P WebTorrent (Торрент-стриминг)
  if (!mediaItem.is_upcoming) {
    suite.push({
      id: 'webtorrent',
      name: 'P2P WebTorrent (Торрент-стриминг)',
      url: 'webtorrent://direct',
      badge: 'P2P 4K',
      quality: '4K UHD / 1080p',
      status_label: '🟢 P2P Сеть',
      audio_info: 'Многоголосый дубляж'
    });
  }

  // 8. Официальный трейлер и промо (YouTube)
  const safeSearch = encodeURIComponent(`${title} официальный русский трейлер`);
  suite.push({
    id: 'official_trailer',
    name: 'Официальный трейлер (4K / FHD)',
    type: 'iframe',
    quality: '4K UHD / 1080p',
    badge: 'ТРЕЙЛЕР',
    status: 'working',
    status_label: '🟢 Онлайн',
    audio_info: 'Официальный промо-трейлер',
    speed: '⚡ YouTube 4K',
    url: `https://www.youtube-nocookie.com/embed?listType=search&list=${safeSearch}&autoplay=1`,
    is_trailer: true
  });

  if (!suite.some(p => p.is_recommended) && suite.length > 0) {
    suite[0].is_recommended = true;
  }

  return suite;
}

export async function openPlayerModal(mediaItem, options = {}) {
  currentMedia = mediaItem;
  quickBarSeriesData = null;
  currentEpisodes = [];
  currentEpisodeIndex = 1;
  toggleInPlayerEpisodesSheet(null, false);

  const modal = document.getElementById('cinema-modal');
  if (!modal) return;

  // Закрываем мобильное меню и очищаем всплывающие подсказки
  const drawer = document.getElementById('mobile-drawer-backdrop');
  if (drawer) drawer.classList.remove('is-open');
  document.querySelectorAll('.media-hover-preview-popup').forEach(p => p.remove());

  const cleanTitle = cleanVideoTitle(mediaItem.title);

  // Проверяем ночной просмотр (между 02:00 и 05:00)
  const currentHour = new Date().getHours();
  if (currentHour >= 2 && currentHour < 5) {
    trackClientAction('night_watch');
  }

  // Сброс состояния плеера
  const iframeContainer = document.getElementById('cinema-player-wrapper');
  iframeContainer.innerHTML = '<div style="display:flex;height:100%;align-items:center;justify-content:center;color:var(--text-muted);gap:10px;"><div class="storm-spinner"></div><span>Загрузка видеоплеера...</span></div>';

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

  // Обновляем URL для глубокого связывания (Deep Linking)
  updatePlayerUrl(mediaItem, options.initialSeason, options.initialEpisode);

  // Открываем модальное окно
  modal.classList.add('is-open');

  // Немедленно инициализируем селекторы и кнопки, чтобы они были интерактивны СРАЗУ
  const cachedStatus = mediaItem.user_status || localStorage.getItem(`storm_status_${mediaItem.id}`) || null;
  renderStatusButtons(cachedStatus);
  renderCustomListsSelector();
  renderPlayerUtilityButtons();

  // 🛡️ ГАРАНТИЯ ИСТОЧНИКОВ: Создаем полный универсальный набор онлайн-плееров сразу!
  // Никакой источник никогда не пропадает, даже при задержке сети или таймауте
  const fallbackSuite = buildUniversalPlayerSuite(mediaItem, cleanTitle);
  currentPlayers = [...fallbackSuite];
  renderPlayerSources(currentPlayers);

  // Определяем стартовый рекомендуемый плеер
  let initialChoice = options.initialPlayer ? currentPlayers.find(p => p.id === options.initialPlayer) : null;
  if (!initialChoice) {
    const isAnime = (mediaItem.media_type || '').includes('anime') || mediaItem.source === 'anilibria' || mediaItem.source === 'anixart';
    const isSeries = (mediaItem.media_type || '') === 'series' || (mediaItem.media_type || '') === 'cartoon-series';
    if (!isAnime && !isSeries) {
      initialChoice = currentPlayers.find(p => p.id === 'fanfilm4k_uhd')
        || currentPlayers.find(p => p.id === 'rezka_cinema')
        || currentPlayers.find(p => p.id === 'collaps_player')
        || currentPlayers.find(p => p.id === 'alloha_tv')
        || currentPlayers.find(p => p.id === 'kodik_direct');
    }
    if (!initialChoice) {
      initialChoice = currentPlayers.find(p => p.is_recommended) || currentPlayers[0];
    }
  }

  currentActivePlayer = initialChoice || {
    badge: (mediaItem.source || 'ПЛЕЕР').toUpperCase(),
    name: `${cleanTitle || 'Основной поток'} (${getSourceName(mediaItem)})`,
    quality: '1080p FHD',
    status_label: '🟢 Онлайн'
  };
  updatePlayerTriggerInfo(currentActivePlayer);

  try {
    // Получаем детальные данные с сервера с увеличенным таймаутом 12000мс
    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), 12000);

    const mediaType = mediaItem.media_type || mediaItem.type || '';
    const fanfilmUrl = mediaItem.fanfilm_4k_url || (mediaItem.source === 'fanfilm4k' ? (mediaItem.link || mediaItem.url || '') : '');
    const itemUrl = `/api/media/item?id=${encodeURIComponent(mediaItem.id)}&source=${mediaItem.source}&url=${encodeURIComponent(mediaItem.link || '')}&title=${encodeURIComponent(cleanTitle)}&year=${encodeURIComponent(mediaItem.year || '')}&poster=${encodeURIComponent(mediaItem.poster || '')}&media_type=${encodeURIComponent(mediaType)}&fanfilm_4k_url=${encodeURIComponent(fanfilmUrl)}`;
    
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

    currentMedia = { ...mediaItem, ...details };

    // 🛡️ ОБЪЕДИНЕНИЕ СЕРВЕРНЫХ И УНИВЕРСАЛЬНЫХ ПЛЕЕРОВ:
    // Ни один онлайн источник не теряется
    const mergedPlayers = [];
    if (Array.isArray(details.players) && details.players.length > 0) {
      details.players.forEach(dp => {
        if (dp && dp.url && !mergedPlayers.some(mp => mp.id === dp.id || mp.url === dp.url)) {
          mergedPlayers.push(dp);
        }
      });
    }
    fallbackSuite.forEach(fp => {
      if (fp && fp.url && !mergedPlayers.some(mp => mp.id === fp.id || mp.url === fp.url)) {
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

    // Отображаем селектор сезонов и серий для сериалов (для аниме настраивается ниже)
    if (mediaItem.source !== 'anilibria' && mediaItem.source !== 'anixart') {
      renderSeriesSeasons(currentMedia, options.initialSeason, options.initialEpisode);
    }

    renderPlayerSources(currentPlayers);
    const effectiveStatus = details?.user_bookmark?.status || currentMedia.user_status || cachedStatus || null;
    if (effectiveStatus) {
      currentMedia.user_status = effectiveStatus;
      localStorage.setItem(`storm_status_${mediaItem.id}`, effectiveStatus);
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
        if (!defaultPlayer) {
          const isAnime = (mediaItem.media_type || '').includes('anime') || mediaItem.source === 'anilibria' || mediaItem.source === 'anixart';
          const isSeries = (mediaItem.media_type || '') === 'series' || (mediaItem.media_type || '') === 'cartoon-series';
          if (!isAnime && !isSeries) {
            defaultPlayer = currentPlayers.find(p => p.id === 'fanfilm4k_uhd')
              || currentPlayers.find(p => p.id === 'rezka_cinema')
              || currentPlayers.find(p => p.id === 'collaps_player')
              || currentPlayers.find(p => p.id === 'alloha_tv')
              || currentPlayers.find(p => p.id === 'kodik_direct');
          }
          if (!defaultPlayer) {
            defaultPlayer = currentPlayers.find(p => p.is_recommended) || currentPlayers[0];
          }
        }
        selectPlayer(defaultPlayer);
      } else if (currentMedia.is_upcoming) {
        selectPlayer({
          is_upcoming: true,
          upcoming_notice: `Релиз «${cleanVideoTitle(currentMedia?.title || 'Фильм')}» находится в производстве. Мировая премьера ожидается в ${currentMedia?.year || 'скоро'}.`
        });
      }
    }

    // Рендерим секцию рецензий со спойлер-блоками
    const reviewsContainer = document.getElementById('cinema-reviews-container');
    if (reviewsContainer) {
      renderReviewsSection(reviewsContainer, currentMedia);
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

export function closePlayerModal() {
  const modal = document.getElementById('cinema-modal');
  if (modal) {
    modal.classList.remove('is-open');
    stopAmbilight();
    clearPlayerUrl();

    if (iframeWatchInterval) {
      clearInterval(iframeWatchInterval);
      iframeWatchInterval = null;
    }
    currentWatchTimeSeconds = 0;

    const iframeContainer = document.getElementById('cinema-player-wrapper');
    if (iframeContainer) iframeContainer.innerHTML = '';

    const quickBar = document.getElementById('player-series-quick-bar');
    if (quickBar) quickBar.style.display = 'none';

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
    return true;
  });

  // Если список плееров пуст, гарантируем доступный промо-трейлер (YouTube)
  if (validPlayers.length === 0 && currentMedia?.title) {
    const cleanSearchTitle = cleanVideoTitle(currentMedia.title);
    const safeSearch = encodeURIComponent(`${cleanSearchTitle} официальный русский трейлер`);
    validPlayers.push({
      id: 'official_trailer_fallback',
      name: 'Официальный трейлер и промо (HD)',
      type: 'iframe',
      quality: '1080p FHD',
      badge: 'ТРЕЙЛЕР',
      status: 'working',
      status_label: '🟢 Онлайн',
      audio_info: 'Официальное промо релиза',
      speed: '⚡ YouTube',
      url: `https://www.youtube-nocookie.com/embed?listType=search&list=${safeSearch}&autoplay=1`,
      is_trailer: true,
      is_recommended: true,
      recommended_badge: '🔥 Рекомендуемый'
    });
  }

  currentPlayers = validPlayers;

  if (validPlayers.length === 0) {
    if (curName) curName.textContent = 'Плееры не найдены';
    if (curBadge) curBadge.textContent = 'ОШИБКА';
    if (curQuality) curQuality.textContent = '—';
    if (curStatus) curStatus.textContent = '🔴 Недоступен';
    list.innerHTML = '<div style="padding: 10px; color: var(--text-muted); font-size: 12px; text-align: center;">Плееры для данного видео временно недоступны</div>';
    return;
  }

  // Заполняем выпадающий список стилизованными элементами
  const recommendedPlayer = validPlayers.find(p => p.is_recommended) || validPlayers[0];
  const defaultPlayer = currentActivePlayer ? (validPlayers.find(p => p.id === currentActivePlayer.id) || recommendedPlayer) : recommendedPlayer;

  list.innerHTML = validPlayers.map((p, idx) => {
    const isAct = defaultPlayer ? defaultPlayer.id === p.id : idx === 0;
    const recBadge = p.is_recommended ? `<span class="storm-badge" style="background:linear-gradient(135deg,#f59e0b,#ef4444);color:#fff;font-weight:800;padding:2px 6px;border-radius:4px;font-size:10px;margin-left:auto;">🔥 Рекомендуемый</span>` : '';
    return `
      <div class="player-dropdown-item ${isAct ? 'active' : ''}" data-idx="${idx}">
        <div class="player-item-header">
          <span class="player-source-badge">${p.badge || 'ПЛЕЕР'}</span>
          <span class="player-item-name">${p.name}</span>
          ${recBadge}
        </div>
        <div class="player-item-details">
          <span class="player-item-quality">${p.quality || '1080p FHD'}</span>
          <span class="player-item-audio">${p.audio_info || 'Оригинал / дубляж'}</span>
          <span class="player-item-status">${p.status_label || '🟢 Онлайн'}</span>
        </div>
      </div>
    `;
  }).join('');

  // Обновляем плашку выбранного плеера
  updatePlayerTriggerInfo(defaultPlayer);
  if (!currentActivePlayer) {
    selectPlayer(defaultPlayer);
  }

  // Клик по пункту выпадающего списка
  list.querySelectorAll('.player-dropdown-item').forEach(itemEl => {
    itemEl.onclick = (e) => {
      e.stopPropagation();
      const idx = parseInt(itemEl.dataset.idx, 10);
      const player = validPlayers[idx];
      if (player) {
        list.querySelectorAll('.player-dropdown-item').forEach(el => el.classList.remove('active'));
        itemEl.classList.add('active');
        updatePlayerTriggerInfo(player);
        menu.style.display = 'none';
        dropdown.classList.remove('is-open');
        document.body.classList.remove('player-dropdown-active');
        selectPlayer(player);
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
}

function selectPlayer(player) {
  currentActivePlayer = player;
  const container = document.getElementById('cinema-player-wrapper');
  if (!container) return;

  if (player.url === 'webtorrent://direct') {
    renderWebTorrentPlayer();
    return;
  }

  // Если ссылки нет, отображаем статус ожидаемой премьеры
  if (!player.url) {
    if (player.upcoming_notice || currentMedia?.is_upcoming) {
      const notice = player.upcoming_notice || `Релиз «${cleanVideoTitle(currentMedia?.title || 'Фильм')}» находится в производстве. Мировая премьера ожидается в ${currentMedia?.year || 'скоро'}.`;
      container.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;text-align:center;padding:30px;background:rgba(10,12,18,0.85);border-radius:12px;gap:14px;">
          <div style="font-size:42px;">🎬</div>
          <div style="font-size:18px;font-weight:800;color:var(--text-primary);">Премьера еще не состоялась</div>
          <div style="max-width:560px;font-size:13px;line-height:1.6;color:var(--text-secondary);">${notice}</div>
        </div>
      `;
      return;
    }

    container.innerHTML = '<div style="display:flex;height:100%;align-items:center;justify-content:center;color:var(--text-muted);">Ссылка на данный плеер временно недоступна</div>';
    return;
  }

  playStreamUrl(player.url);
}

export function switchToNextSource() {
  if (!currentPlayers || currentPlayers.length <= 1) {
    showToast('Нет других доступных источников', 'warning');
    return;
  }
  const curIdx = currentPlayers.findIndex(p => p.id === currentActivePlayer?.id);
  const nextIdx = (curIdx + 1) % currentPlayers.length;
  const nextPlayer = currentPlayers[nextIdx];
  if (nextPlayer) {
    selectPlayer(nextPlayer);
    updatePlayerTriggerInfo(nextPlayer);
    const list = document.getElementById('player-source-list');
    if (list) {
      list.querySelectorAll('.player-dropdown-item').forEach((el, idx) => {
        el.classList.toggle('active', idx === nextIdx);
      });
    }
    showToast(`🔁 Источник переключен: ${nextPlayer.name}`, 'info');
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
    const res = await fetch(`/api/player/series-options?url=${encodeURIComponent(playerUrl)}`);
    if (!res.ok) {
      quickBar.style.display = 'none';
      return;
    }
    const data = await res.json();
    if (!data.success || !data.seasons || data.seasons.length === 0) {
      quickBar.style.display = 'none';
      return;
    }

    quickBarSeriesData = data;
    quickBar.style.display = 'flex';

    quickBarActiveSeason = data.active?.season || data.seasons[0].season || 1;
    quickBarActiveEpisode = data.active?.episode || 1;
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

    renderQuickBarDropdowns();
    setupQuickBarOutsideListeners();

    if (autoVoiceMatched || quickBarActiveSeason > 1 || quickBarActiveEpisode > 1) {
      updateQuickIframeSrc();
    }
    if (autoVoiceMatched && matchedTrans) {
      showToast(`🎙️ Умный выбор озвучки: ${matchedTrans.name}`, 'info');
    }
  } catch (err) {
    console.warn('Ошибка быстрой панели серий:', err);
    quickBar.style.display = 'none';
  }
}

function renderQuickBarDropdowns() {
  if (!quickBarSeriesData || !quickBarSeriesData.seasons) return;

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
  const watchedInCurSeason = curMediaId ? getWatchedEpisodes(curMediaId, quickBarActiveSeason).size : 0;
  const totalInCurSeason = currentSeasonObj.episodes_count || (currentSeasonObj.episodes ? currentSeasonObj.episodes.length : 0);
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
    seasonVal.textContent = currentSeasonObj.name || `Сезон ${quickBarActiveSeason}`;
  }

  if (seasonList) {
    seasonList.innerHTML = quickBarSeriesData.seasons.map(s => {
      const isAct = s.season === quickBarActiveSeason;
      const totalEp = s.episodes_count || (s.episodes ? s.episodes.length : 0);
      const watchedSet = curMediaId ? getWatchedEpisodes(curMediaId, s.season) : new Set();
      const watchedCount = watchedSet.size;

      let statusIcon = '⚪';
      let statusBadge = '';
      if (totalEp > 0 && watchedCount >= totalEp) {
        statusIcon = '✅';
        statusBadge = `<span class="quick-status-pill pill-watched">✓ Просмотрен (${watchedCount}/${totalEp})</span>`;
      } else if (watchedCount > 0) {
        statusIcon = '⏳';
        statusBadge = `<span class="quick-status-pill pill-progress">⏳ ${watchedCount}/${totalEp} сер.</span>`;
      } else {
        statusIcon = '⚪';
        statusBadge = `<span class="quick-status-pill pill-new">⚪ ${totalEp} сер.</span>`;
      }

      return `
        <div class="quick-dropdown-item ${isAct ? 'active' : ''}" data-season="${s.season}">
          <div class="quick-item-left">
            <span class="quick-item-icon">${statusIcon}</span>
            <span class="quick-item-title">${s.name}</span>
          </div>
          <div class="quick-item-right">
            ${statusBadge}
          </div>
        </div>
      `;
    }).join('');

    seasonList.querySelectorAll('.quick-dropdown-item').forEach(item => {
      item.onclick = (e) => {
        e.stopPropagation();
        const sNum = parseInt(item.dataset.season, 10);
        selectQuickSeason(sNum);
        if (seasonMenu) seasonMenu.style.display = 'none';
        if (seasonDropdown) seasonDropdown.classList.remove('is-open');
        closeOtherQuickDropdowns(null);
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
    epIconEl.textContent = curEpWatched ? '✅' : '🎬';
  }
  if (epVal) {
    epVal.textContent = currentEpisodeObj ? currentEpisodeObj.name : `${quickBarActiveEpisode} серия`;
  }

  if (epList) {
    const watchedEpisodes = curMediaId ? getWatchedEpisodes(curMediaId, quickBarActiveSeason) : new Set();

    epList.innerHTML = currentSeasonObj.episodes.map(ep => {
      const isWatched = watchedEpisodes.has(ep.episode);
      const isAct = ep.episode === quickBarActiveEpisode;

      let statusIcon = '⚪';
      let statusBadge = '';
      if (isAct) {
        statusIcon = isWatched ? '✅' : '▶️';
        statusBadge = `<span class="quick-status-pill pill-current">▶ Текущая</span>${isWatched ? ' <span class="quick-status-pill pill-watched">✓</span>' : ''}`;
      } else if (isWatched) {
        statusIcon = '✅';
        statusBadge = `<span class="quick-status-pill pill-watched">✓ Просмотрено</span>`;
      } else {
        statusIcon = '⚪';
        statusBadge = `<span class="quick-status-pill pill-unwatched">⚪ Не начата</span>`;
      }

      return `
        <div class="quick-dropdown-item ${isAct ? 'active' : ''}" data-episode="${ep.episode}">
          <div class="quick-item-left">
            <span class="quick-item-icon">${statusIcon}</span>
            <span class="quick-item-title">${ep.name}</span>
          </div>
          <div class="quick-item-right">
            ${statusBadge}
            <button type="button" class="quick-ep-watch-toggle" data-toggle-ep="${ep.episode}" title="${isWatched ? 'Отметить непросмотренной' : 'Отметить просмотренной'}">
              ${isWatched ? '✖' : '✓'}
            </button>
          </div>
        </div>
      `;
    }).join('');

    epList.querySelectorAll('.quick-dropdown-item').forEach(item => {
      item.onclick = (e) => {
        e.stopPropagation();
        const epNum = parseInt(item.dataset.episode, 10);
        selectQuickEpisode(epNum);
        if (epMenu) epMenu.style.display = 'none';
        if (epDropdown) epDropdown.classList.remove('is-open');
        closeOtherQuickDropdowns(null);
      };
    });

    epList.querySelectorAll('.quick-ep-watch-toggle').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const epNum = parseInt(btn.dataset.toggleEp, 10);
        if (curMediaId) {
          toggleEpisodeWatched(curMediaId, quickBarActiveSeason, epNum);
          renderQuickBarDropdowns();
          showToast(`Серия ${epNum}: статус обновлен`, 'info');
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
    if (voiceVal) voiceVal.textContent = activeTrans.name;
    if (voiceBadge) {
      voiceBadge.style.display = activeTrans.is_uhd ? 'inline-block' : 'none';
      voiceBadge.textContent = '4K UHD';
    }
  }

  if (voiceList) {
    voiceList.innerHTML = translations.map(t => {
      const isAct = t.id === quickBarActiveTranslationId;
      return `
        <div class="quick-dropdown-item ${isAct ? 'active' : ''}" data-trans-id="${t.id}">
          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 170px;">${t.name}</span>
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
    };
  }

  updateInPlayerEpisodeInfo();
}

function closeOtherQuickDropdowns(activeDropdownId) {
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
  if (!activeDropdownId) {
    document.body.classList.remove('quick-dropdown-active');
  }
}

function setupQuickBarOutsideListeners() {
  if (document.body.dataset.hasQuickBarListener) return;
  document.body.dataset.hasQuickBarListener = 'true';

  document.addEventListener('click', (e) => {
    const quickBar = document.getElementById('player-series-quick-bar');
    if (quickBar && !quickBar.contains(e.target)) {
      closeOtherQuickDropdowns(null);
    }
  });
}

function updateQuickIframeSrc() {
  if (quickBarSeriesData?.isAnime) {
    if (quickBarSeriesData.animeSource === 'anilibria') {
      const eps = currentMedia?.episodes || [];
      const epObj = eps.find(e => (e.ordinal || 1) === quickBarActiveEpisode) || eps[quickBarActiveEpisode - 1];
      if (epObj) {
        currentEpisodeIndex = quickBarActiveEpisode;
        const streamUrl = epObj.hls_1080 || epObj.hls_720 || epObj.hls_480;
        if (streamUrl) playStreamUrl(streamUrl);
        loadSkipTimes(currentMedia?.id, quickBarActiveEpisode);
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

  const iframe = document.querySelector('.cinema-player-iframe');
  if (!iframe || !quickBarBaseUrl) return;

  let url = `/api/player/fanfilm-embed?url=${encodeURIComponent(quickBarBaseUrl)}&translation=${quickBarActiveTranslationId || ''}&hidden=season,episode,translation`;
  if (quickBarSeriesData?.type !== 'movie') {
    url += `&season=${quickBarActiveSeason}&episode=${quickBarActiveEpisode}`;
  }
  iframe.src = url;
}

function highlightActiveEpisodeInGrid(episodeNum) {
  const gridEl = document.getElementById('series-episodes-grid');
  if (!gridEl) return;
  gridEl.querySelectorAll('.series-episode-card').forEach(card => {
    const isAct = parseInt(card.dataset.epNum, 10) === episodeNum;
    card.classList.toggle('active', isAct);
    if (isAct) {
      card.classList.add('watched');
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
}

function selectQuickSeason(seasonNum) {
  if (quickBarActiveSeason === seasonNum) return;
  quickBarActiveSeason = seasonNum;
  quickBarActiveEpisode = 1;
  renderQuickBarDropdowns();
  updateQuickIframeSrc();

  showToast(`📺 Сезон ${seasonNum}`, 'info');
  trackClientAction('watch_series_episode', { season: seasonNum, episode: 1 });
}

function selectQuickEpisode(episodeNum) {
  if (quickBarActiveEpisode === episodeNum) return;
  quickBarActiveEpisode = episodeNum;
  renderQuickBarDropdowns();
  updateQuickIframeSrc();

  if (currentMedia?.id) {
    markEpisodeWatched(currentMedia.id, quickBarActiveSeason, episodeNum, true);
  }

  showToast(`🎬 Сезон ${quickBarActiveSeason} • Серия ${episodeNum}`, 'info');
  trackClientAction('watch_series_episode', { season: quickBarActiveSeason, episode: episodeNum });

  if (currentMedia?.id && quickBarSeriesData) {
    const sObj = quickBarSeriesData.seasons.find(s => s.season === quickBarActiveSeason);
    if (sObj && sObj.episodes_count) {
      const watched = getWatchedEpisodes(currentMedia.id, quickBarActiveSeason);
      if (watched.size >= sObj.episodes_count) {
        trackClientAction('complete_season', { season: quickBarActiveSeason });
      }
    }
  }

  highlightActiveEpisodeInGrid(episodeNum);
}

async function switchAnixartVoiceover(voiceoverId) {
  const host = document.getElementById('cinema-player-wrapper');
  if (host) {
    host.innerHTML = '<div style="display:flex;height:100%;align-items:center;justify-content:center;gap:10px;color:var(--text-muted);"><div class="storm-spinner"></div><span>Смена озвучки AniXart...</span></div>';
  }
  try {
    const res = await fetch(`/api/anixart/episodes/${currentMedia.id}/${voiceoverId}`);
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

function playStreamUrl(url) {
  const container = document.getElementById('cinema-player-wrapper');
  if (!container) return;

  if (currentMedia?.source === 'fanfilm4k') {
    trackClientAction('use_4k');
  }

  if (iframeWatchInterval) {
    clearInterval(iframeWatchInterval);
    iframeWatchInterval = null;
  }

  if (url.includes('.m3u8')) {
    const quickBar = document.getElementById('player-series-quick-bar');
    if (quickBar && (!quickBarSeriesData || !quickBarSeriesData.seasons || quickBarSeriesData.seasons.length === 0)) {
      quickBar.style.display = 'none';
    }

    container.innerHTML = `
      <div class="player-video-box" style="position:relative;width:100%;height:100%;">
        <!-- Динамическая подсветка Ambilight -->
        <div id="player-ambilight-aura" class="ambilight-aura"></div>
        <button type="button" class="player-switch-source-btn" id="html5-switch-source-btn" title="Сменить видеоплеер / источник">⚡ Сменить источник</button>
        <button type="button" class="player-overlay-fs-btn" id="html5-overlay-fs-btn" title="Развернуть на весь экран (F)">⛶</button>

        <video id="storm-video-player" controls autoplay crossorigin="anonymous" style="width:100%;height:100%;background:#000;border-radius:12px;outline:none;position:relative;z-index:2;" playsinline></video>

        <!-- Кнопки пропуска заставок -->
        <button type="button" class="storm-skip-btn" id="skip-intro-btn" style="display: none;">
          ⏭️ Пропустить заставку
        </button>
        <button type="button" class="storm-skip-btn" id="skip-outro-btn" style="display: none;">
          ⏭️ Следующая серия
        </button>
      </div>
    `;

    const html5SwitchBtn = container.querySelector('#html5-switch-source-btn');
    if (html5SwitchBtn) {
      html5SwitchBtn.onclick = (e) => {
        e.stopPropagation();
        switchToNextSource();
      };
    }

    const html5FsBtn = container.querySelector('#html5-overlay-fs-btn');
    if (html5FsBtn) {
      html5FsBtn.onclick = (e) => {
        e.stopPropagation();
        toggleCinemaFullscreen();
      };
    }

    const video = document.getElementById('storm-video-player');
    const videoBox = container.querySelector('.player-video-box');

    // Настраиваем HLS
    if (window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls();
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      video.play().catch(() => {});
    }

    // Подключаем Ambilight, Субтитры, Пропуск заставок и Watch Together
    setupVideoFeatures(video, videoBox);
    return;
  }

  let streamUrl = url;
  const isFanfilmOrStravers = typeof url === 'string' && (url.includes('stravers.live') || url.includes('fanfilm4k') || url.includes('fanfilm'));

  if (isFanfilmOrStravers) {
    streamUrl = `/api/player/fanfilm-embed?url=${encodeURIComponent(url)}&hidden=season,episode,translation`;
    initSeriesQuickBar(url);
  } else if (!quickBarSeriesData?.isAnime) {
    const quickBar = document.getElementById('player-series-quick-bar');
    if (quickBar) quickBar.style.display = 'none';
  }

  container.innerHTML = `
    <div class="player-video-box" style="position:relative;width:100%;height:100%;">
      <div id="player-ambilight-aura" class="ambilight-aura"></div>
      <button type="button" class="player-switch-source-btn" id="iframe-switch-source-btn" title="Сменить видеоплеер / источник">⚡ Сменить источник</button>
      <button type="button" class="player-overlay-fs-btn" id="iframe-overlay-fs-btn" title="Развернуть на весь экран (F)">⛶</button>
      <iframe class="cinema-player-iframe" src="${streamUrl}" allow="autoplay *; encrypted-media *; fullscreen *; picture-in-picture *; display-capture *" allowfullscreen="true" webkitallowfullscreen="true" mozallowfullscreen="true" style="position:relative;z-index:2;width:100%;height:100%;border:none;border-radius:12px;"></iframe>
    </div>
  `;

  const iframeSwitchBtn = container.querySelector('#iframe-switch-source-btn');
  if (iframeSwitchBtn) {
    iframeSwitchBtn.onclick = (e) => {
      e.stopPropagation();
      switchToNextSource();
    };
  }

  const iframeFsBtn = container.querySelector('#iframe-overlay-fs-btn');
  if (iframeFsBtn) {
    iframeFsBtn.onclick = (e) => {
      e.stopPropagation();
      toggleCinemaFullscreen();
    };
  }

  const iframeBox = container.querySelector('.player-video-box');
  if (iframeBox) {
    mountInPlayerOverlay(iframeBox);
  }

  applyProVideoSettings();

  if (ambilightEnabled) {
    startAmbilightLoop(null);
  }

  // Автоматический трекинг прогресса при воспроизведении через Iframe
  currentWatchTimeSeconds = Math.round(((currentProgressPercent || 0) / 100) * 7200);
  let lastSync = Date.now();

  iframeWatchInterval = setInterval(() => {
    const modal = document.getElementById('cinema-modal');
    if (!modal || !modal.classList.contains('is-open')) {
      clearInterval(iframeWatchInterval);
      iframeWatchInterval = null;
      return;
    }

    currentWatchTimeSeconds += 5;
    const totalSec = 7200;
    const percent = Math.min(100, Math.round((currentWatchTimeSeconds / totalSec) * 100));
    currentProgressPercent = percent;

    const slider = document.getElementById('player-progress-slider');
    const label = document.getElementById('player-progress-label');
    if (slider) slider.value = percent;
    if (label) label.textContent = `${percent}%`;

    const now = Date.now();
    if (now - lastSync >= 15000 && getUser() && currentMedia) {
      lastSync = now;
      syncWatchProgress({
        media_id: currentMedia.id,
        source: currentMedia.source,
        title: currentMedia.title,
        poster_url: currentMedia.poster,
        media_type: currentMedia.media_type,
        season: currentMedia.season || 1,
        episode: currentEpisodeIndex || 1,
        total_episodes: currentEpisodes.length || 1,
        duration_seconds: totalSec,
        time_seconds: currentWatchTimeSeconds
      });
    }
  }, 5000);
}

function setupVideoFeatures(video, wrapper) {
  if (video && !video.dataset.hasDblClickListener) {
    video.dataset.hasDblClickListener = 'true';
    video.addEventListener('dblclick', (e) => {
      e.preventDefault();
      toggleCinemaFullscreen();
    });
  }

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

  // 6. Профессиональный движок видео и звука (HDR, CAS, Dolby Atmos 3D, EQ)
  applyProVideoSettings(video);
  initProAudioEngine(video);

  // 7. X-Ray режим на паузе
  setupXRayMode(video, wrapper);

  // 7. Покадровая навигация (Thumbnail Scrubbing)
  setupThumbnailScrubbing(video);

  // 8. Автоматический динамический прогресс просмотра
  let lastSyncTime = 0;
  video.addEventListener('timeupdate', () => {
    if (video.duration && !isNaN(video.duration)) {
      const percent = Math.min(100, Math.round((video.currentTime / video.duration) * 100));
      currentProgressPercent = percent;
      currentWatchTimeSeconds = Math.round(video.currentTime);
      const slider = document.getElementById('player-progress-slider');
      const label = document.getElementById('player-progress-label');
      if (slider) slider.value = percent;
      if (label) label.textContent = `${percent}%`;

      const now = Date.now();
      if (now - lastSyncTime >= 15000 && getUser() && currentMedia) {
        lastSyncTime = now;
        syncWatchProgress({
          media_id: currentMedia.id,
          source: currentMedia.source,
          title: currentMedia.title,
          poster_url: currentMedia.poster,
          media_type: currentMedia.media_type,
          season: currentMedia.season || 1,
          episode: currentEpisodeIndex || 1,
          total_episodes: currentEpisodes.length || 1,
          duration_seconds: Math.round(video.duration),
          time_seconds: currentWatchTimeSeconds
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

  // 10. Монтирование интеллектуального оверлея плеера и серий
  mountInPlayerOverlay(wrapper);
}

// ==========================================
// НОЧНОЙ РЕЖИМ ЗВУКА (NIGHT MODE AUDIO)
// ==========================================
export function toggleNightModeAudio(video = document.getElementById('storm-video-player')) {
  nightAudioModeEnabled = !getProAudioNightMode();
  setProAudioNightMode(nightAudioModeEnabled);
  showToast(`🌙 Ночной режим звука: ${nightAudioModeEnabled ? 'Включен (диалоги четче, взрывы мягче)' : 'Выключен (стандартный звук)'}`, 'info');

  const btn = document.getElementById('toggle-night-audio-btn');
  if (btn) btn.classList.toggle('active', nightAudioModeEnabled);
}

export function applyNightModeAudio(video) {
  setProAudioNightMode(nightAudioModeEnabled);
}

// ==========================================
// X-RAY РЕЖИМ (АКТЕРЫ И САУНДТРЕКИ НА ПАУЗЕ)
// ==========================================
function setupXRayMode(video, wrapper) {
  if (!video || !wrapper) return;

  video.addEventListener('pause', () => {
    if (currentMedia && (currentMedia.cast?.length || currentMedia.directors?.length)) {
      showXRayPanel(wrapper);
    }
  });

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
          <img src="${c.photo || 'assets/favicon.svg'}" alt="${c.name}" class="xray-actor-img" onerror="this.src='assets/favicon.svg'">
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
      if (pid && typeof openPersonModal === 'function') {
        openPersonModal(pid, pname);
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
            <img src="${person.photo || 'assets/favicon.svg'}" alt="${person.name}" class="xray-crew-img" onerror="this.src='assets/favicon.svg'">
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
    fetch(`/api/media/search?q=${encodeURIComponent(cleanTitle)}&source=tmdb`)
      .then(r => r.json())
      .then(async data => {
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
      })
      .catch(() => {});
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
      if (pid && typeof openPersonModal === 'function') {
        openPersonModal(pid, pname);
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

      <!-- Секция умного дома (WLED / Hue) -->
      <div id="smart-lights-mount" style="margin-top: 14px; border-top: 1px solid var(--border-subtle); padding-top: 12px;"></div>
    </div>
  `;

  const closeBtn = host.querySelector('#close-ambilight-settings-btn');
  if (closeBtn) closeBtn.onclick = () => { host.innerHTML = ''; };

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

  function loop() {
    if (!ambilightEnabled) return;

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
      // Плавный динамический спектральный перелив для Iframe или паузы
      const hue = (Date.now() / 40) % 360;
      const rgb = hslToRgb(hue / 360, 0.9, 0.55);
      r = rgb.r; g = rgb.g; b = rgb.b;
    }

    const aura = document.getElementById('player-ambilight-aura');
    if (aura) {
      const alpha = ambilightSettings.intensity / 100;
      const blur = ambilightSettings.blur;
      aura.classList.add('active');
      aura.style.opacity = `${alpha}`;
      aura.style.boxShadow = `0 0 ${blur}px rgba(${r}, ${g}, ${b}, 0.9), 0 0 ${Math.round(blur * 1.5)}px rgba(${r}, ${g}, ${b}, 0.55), inset 0 0 ${Math.round(blur * 0.5)}px rgba(${r}, ${g}, ${b}, 0.35)`;
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
let hasAutoSkippedOp = false;
let hasAutoSkippedEd = false;

async function loadSkipTimes(mediaId, episode) {
  skipIntervals = null;
  hasAutoSkippedOp = false;
  hasAutoSkippedEd = false;
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

    // Синхронизация ползунка прогресса
    if (video.duration) {
      const percent = Math.min(100, Math.round((time / video.duration) * 100));
      currentProgressPercent = percent;
      const slider = document.getElementById('player-progress-slider');
      const label = document.getElementById('player-progress-label');
      if (slider) slider.value = percent;
      if (label) label.textContent = `${percent}%`;

      const now = Date.now();
      if (now - lastHtml5Sync >= 10000 && getUser() && currentMedia) {
        lastHtml5Sync = now;
        syncWatchProgress({
          media_id: currentMedia.id,
          source: currentMedia.source,
          title: currentMedia.title,
          poster_url: currentMedia.poster,
          media_type: currentMedia.media_type,
          season: currentMedia.season || 1,
          episode: currentEpisodeIndex || 1,
          total_episodes: currentEpisodes.length || 1,
          duration_seconds: Math.round(video.duration),
          time_seconds: Math.round(time)
        });
      }
    }

    if (!skipIntervals) return;

    // Сброс флага автопропуска, если зритель перемотал назад до заставки
    if (skipIntervals.op && time < Math.max(0, skipIntervals.op.start - 3)) {
      hasAutoSkippedOp = false;
    }
    if (skipIntervals.ed && time < Math.max(0, skipIntervals.ed.start - 3)) {
      hasAutoSkippedEd = false;
    }

    // Пропуск заставки (только для проверенных интервалов, не обрезая диалоги)
    if (skipIntervals.op && time >= skipIntervals.op.start && time <= skipIntervals.op.end) {
      if (autoSkipEnabled && skipIntervals.verified && !hasAutoSkippedOp) {
        hasAutoSkippedOp = true;
        video.currentTime = skipIntervals.op.end;
        showToast('⏩ Заставка автоматически пропущена', 'info');
      } else if (skipIntroBtn && !autoSkipEnabled) {
        skipIntroBtn.style.display = 'block';
      }
    } else if (skipIntroBtn) {
      skipIntroBtn.style.display = 'none';
    }

    // Пропуск титров (переход к сцене после титров без принудительного обрыва серии)
    if (skipIntervals.ed && time >= skipIntervals.ed.start && time <= skipIntervals.ed.end) {
      if (autoSkipEnabled && skipIntervals.verified && !hasAutoSkippedEd) {
        hasAutoSkippedEd = true;
        if (video.duration && skipIntervals.ed.end < video.duration - 12) {
          video.currentTime = skipIntervals.ed.end;
          showToast('⏩ Титры пропущены (сцена после титров)', 'info');
        } else {
          showToast('⏩ Финальные титры', 'info');
        }
      } else if (skipOutroBtn && !autoSkipEnabled) {
        skipOutroBtn.style.display = 'block';
      }
    } else if (skipOutroBtn) {
      skipOutroBtn.style.display = 'none';
    }
  };

  video.addEventListener('ended', () => {
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
  if (!video) return;
  const saved = localStorage.getItem('storm_playback_speed') || '1';
  const speed = parseFloat(saved);
  if (!isNaN(speed) && speed > 0) {
    try {
      video.playbackRate = speed;
    } catch {}
  }
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

  // 3. Отправка postMessage во все поддерживаемые типы сторонних плееров
  const msgs = [
    { event: 'speed', value: sp },
    { api: 'speed', val: sp },
    { api: 'speed', set: sp },
    { api: 'playbackRate', set: sp },
    { action: 'speed', rate: sp },
    { key: 'kodik_player_api', value: { action: 'speed', rate: sp } },
    { type: 'SET_SPEED', speed: sp }
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
  showToast(`⚡ Скорость: ${sp}x`, 'info');
}

function updateInPlayerSpeedDisplay(speed) {
  const overlay = document.getElementById('storm-inplayer-overlay');
  if (!overlay) return;
  const btn = overlay.querySelector('#inplayer-speed-btn');
  if (btn) btn.textContent = `⚡ ${speed}x`;
  const menu = overlay.querySelector('#inplayer-speed-menu');
  if (menu) {
    menu.querySelectorAll('.inplayer-speed-item').forEach(item => {
      item.classList.toggle('active', parseFloat(item.dataset.speed) === parseFloat(speed));
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
  if (!sheet) return;

  if (!checkIfMediaIsSeries(currentMedia)) {
    sheet.classList.remove('is-open');
    sheet.style.display = 'none';
    return;
  }

  if (show === undefined) {
    show = !sheet.classList.contains('is-open');
  }

  if (show) {
    sheet.style.display = 'flex';
    renderInPlayerEpisodesSheet(overlay);
    sheet.classList.add('is-open');
  } else {
    sheet.classList.remove('is-open');
  }
}

export function renderInPlayerEpisodesSheet(overlay) {
  if (!overlay) overlay = document.getElementById('storm-inplayer-overlay');
  if (!overlay) return;

  const sheet = overlay.querySelector('#player-inplayer-episodes-sheet');
  if (!checkIfMediaIsSeries(currentMedia)) {
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
          <span class="inplayer-ep-name">${ep.name || `${ep.episode} серия`}</span>
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

  // 2. TMDB / базовые сериалы
  const gridEl = document.getElementById('series-episodes-grid');
  if (gridEl && gridEl.children.length > 0) {
    chipsBar.style.display = 'none';
    const cards = Array.from(gridEl.querySelectorAll('.series-episode-card'));
    epList.innerHTML = cards.map(c => {
      const epNum = parseInt(c.dataset.epNum, 10);
      const isAct = c.classList.contains('active');
      const isWatched = c.classList.contains('watched');
      const title = c.querySelector('.series-episode-title')?.textContent || `Серия ${epNum}`;
      return `
        <div class="inplayer-ep-item ${isAct ? 'active' : ''}" data-ep-num="${epNum}">
          <span class="inplayer-ep-num">${epNum}</span>
          <span class="inplayer-ep-name">${title}</span>
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

  // 3. AniXart
  if (currentEpisodes && currentEpisodes.length > 0) {
    chipsBar.style.display = 'none';
    epList.innerHTML = currentEpisodes.map((ep, idx) => {
      const epNum = ep.position || (idx + 1);
      const isAct = epNum === currentEpisodeIndex;
      return `
        <div class="inplayer-ep-item ${isAct ? 'active' : ''}" data-index="${idx}">
          <span class="inplayer-ep-num">${epNum}</span>
          <span class="inplayer-ep-name">${ep.name_ru || ep.name || `${epNum} серия`}</span>
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
    epList.innerHTML = currentMedia.episodes.map((ep, idx) => {
      const epNum = ep.ordinal || (idx + 1);
      const isAct = epNum === currentEpisodeIndex;
      return `
        <div class="inplayer-ep-item ${isAct ? 'active' : ''}" data-index="${idx}">
          <span class="inplayer-ep-num">${epNum}</span>
          <span class="inplayer-ep-name">${ep.name || `${epNum} серия`}</span>
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

export function checkIfMediaIsSeries(media) {
  if (!media) return false;
  // Явные признаки фильма
  if (media.media_type === 'movie' || media.type === 'movie' || media.category === 'Фильм' || media.category === 'фильм') {
    return false;
  }
  // Явные сериалы, мультсериалы и аниме-сериалы
  if (media.media_type === 'series' || 
      media.media_type === 'tv' || 
      media.media_type === 'cartoon-series' || 
      media.media_type === 'anime-series' || 
      media.category === 'Сериал' || 
      media.category === 'Аниме-сериал' || 
      media.category === 'Мультсериал') {
    return true;
  }
  if (media.source === 'anilibria' || media.source === 'anixart') {
    return true;
  }
  if (Array.isArray(media.seasons) && media.seasons.length > 0) {
    return true;
  }
  if (Array.isArray(media.episodes) && media.episodes.length > 1) {
    return true;
  }
  if (quickBarSeriesData && quickBarSeriesData.type !== 'movie' && Array.isArray(quickBarSeriesData.seasons) && quickBarSeriesData.seasons.length > 0) {
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

  const isSeries = checkIfMediaIsSeries(currentMedia);

  let titleText = currentMedia?.title || '';
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
  if (epBtn) epBtn.style.display = isSeries ? 'inline-flex' : 'none';
  if (bottomBar) bottomBar.style.display = isSeries ? 'flex' : 'none';
  if (sheet) {
    if (!isSeries) {
      sheet.classList.remove('is-open');
      sheet.style.display = 'none';
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

export function playInPlayerNextEpisode() {
  // 1. Быстрая панель FanFilm / Kodik / серверов
  if (quickBarSeriesData && quickBarSeriesData.seasons && quickBarSeriesData.seasons.length > 0) {
    const curSeasonObj = quickBarSeriesData.seasons.find(s => s.season === quickBarActiveSeason) || quickBarSeriesData.seasons[0];
    if (curSeasonObj?.episodes) {
      const curEpIdx = curSeasonObj.episodes.findIndex(e => e.episode === quickBarActiveEpisode);
      if (curEpIdx >= 0 && curEpIdx < curSeasonObj.episodes.length - 1) {
        const nextEp = curSeasonObj.episodes[curEpIdx + 1].episode;
        selectQuickEpisode(nextEp);
        updateInPlayerEpisodeInfo();
        return;
      } else {
        const curSeasonIdx = quickBarSeriesData.seasons.findIndex(s => s.season === quickBarActiveSeason);
        if (curSeasonIdx >= 0 && curSeasonIdx < quickBarSeriesData.seasons.length - 1) {
          const nextSeason = quickBarSeriesData.seasons[curSeasonIdx + 1].season;
          selectQuickSeason(nextSeason);
          updateInPlayerEpisodeInfo();
          return;
        }
      }
    }
  }

  // 2. Сетка серий TMDB
  const gridEl = document.getElementById('series-episodes-grid') || document.getElementById('episodes-grid');
  if (gridEl) {
    const activeCard = gridEl.querySelector('.series-episode-card.active, .episode-btn.active');
    if (activeCard && activeCard.nextElementSibling) {
      activeCard.nextElementSibling.click();
      updateInPlayerEpisodeInfo();
      return;
    }
  }

  // 3. AniXart
  if (currentEpisodes && currentEpisodes.length > 0) {
    const curIdx = currentEpisodes.findIndex(e => (e.position || 1) === currentEpisodeIndex);
    if (curIdx >= 0 && curIdx < currentEpisodes.length - 1) {
      const nextEp = currentEpisodes[curIdx + 1];
      currentEpisodeIndex = nextEp.position || (curIdx + 2);
      playAnixartEpisode(nextEp);
      updateInPlayerEpisodeInfo();
      return;
    }
  }

  // 4. AniLibria
  if (currentMedia?.episodes && currentMedia.episodes.length > 0) {
    const curIdx = currentMedia.episodes.findIndex(e => (e.ordinal || 1) === currentEpisodeIndex);
    if (curIdx >= 0 && curIdx < currentMedia.episodes.length - 1) {
      const nextEp = currentMedia.episodes[curIdx + 1];
      currentEpisodeIndex = nextEp.ordinal || (curIdx + 2);
      const streamUrl = nextEp.hls_1080 || nextEp.hls_720 || nextEp.hls_480;
      if (streamUrl) playStreamUrl(streamUrl);
      loadSkipTimes(currentMedia.id, currentEpisodeIndex);
      updateInPlayerEpisodeInfo();
      return;
    }
  }

  showToast('Это последняя серия сезона', 'info');
}

export function playInPlayerPrevEpisode() {
  // 1. Быстрая панель FanFilm / Kodik / серверов
  if (quickBarSeriesData && quickBarSeriesData.seasons && quickBarSeriesData.seasons.length > 0) {
    const curSeasonObj = quickBarSeriesData.seasons.find(s => s.season === quickBarActiveSeason) || quickBarSeriesData.seasons[0];
    if (curSeasonObj?.episodes) {
      const curEpIdx = curSeasonObj.episodes.findIndex(e => e.episode === quickBarActiveEpisode);
      if (curEpIdx > 0) {
        const prevEp = curSeasonObj.episodes[curEpIdx - 1].episode;
        selectQuickEpisode(prevEp);
        updateInPlayerEpisodeInfo();
        return;
      } else {
        const curSeasonIdx = quickBarSeriesData.seasons.findIndex(s => s.season === quickBarActiveSeason);
        if (curSeasonIdx > 0) {
          const prevSeasonObj = quickBarSeriesData.seasons[curSeasonIdx - 1];
          const lastEp = prevSeasonObj.episodes?.[prevSeasonObj.episodes.length - 1]?.episode || 1;
          selectQuickSeason(prevSeasonObj.season);
          selectQuickEpisode(lastEp);
          updateInPlayerEpisodeInfo();
          return;
        }
      }
    }
  }

  // 2. Сетка серий TMDB
  const gridEl = document.getElementById('series-episodes-grid') || document.getElementById('episodes-grid');
  if (gridEl) {
    const activeCard = gridEl.querySelector('.series-episode-card.active, .episode-btn.active');
    if (activeCard && activeCard.previousElementSibling) {
      activeCard.previousElementSibling.click();
      updateInPlayerEpisodeInfo();
      return;
    }
  }

  // 3. AniXart
  if (currentEpisodes && currentEpisodes.length > 0) {
    const curIdx = currentEpisodes.findIndex(e => (e.position || 1) === currentEpisodeIndex);
    if (curIdx > 0) {
      const prevEp = currentEpisodes[curIdx - 1];
      currentEpisodeIndex = prevEp.position || curIdx;
      playAnixartEpisode(prevEp);
      updateInPlayerEpisodeInfo();
      return;
    }
  }

  // 4. AniLibria
  if (currentMedia?.episodes && currentMedia.episodes.length > 0) {
    const curIdx = currentMedia.episodes.findIndex(e => (e.ordinal || 1) === currentEpisodeIndex);
    if (curIdx > 0) {
      const prevEp = currentMedia.episodes[curIdx - 1];
      currentEpisodeIndex = prevEp.ordinal || curIdx;
      const streamUrl = prevEp.hls_1080 || prevEp.hls_720 || prevEp.hls_480;
      if (streamUrl) playStreamUrl(streamUrl);
      loadSkipTimes(currentMedia.id, currentEpisodeIndex);
      updateInPlayerEpisodeInfo();
      return;
    }
  }

  showToast('Это первая серия', 'info');
}

export function playNextEpisode() {
  playInPlayerNextEpisode();
}

export function mountInPlayerOverlay(videoBox) {
  if (!videoBox) return;
  const isSeries = checkIfMediaIsSeries(currentMedia);
  let overlay = videoBox.querySelector('.storm-inplayer-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'storm-inplayer-overlay';
    overlay.id = 'storm-inplayer-overlay';
    overlay.innerHTML = `
      <!-- Верхняя полоса управления -->
      <div class="inplayer-top-bar">
        <div class="inplayer-title-info">
          <span class="inplayer-badge" id="inplayer-badge">${isSeries ? '📺 Серия 1' : (currentMedia?.quality || '🎬 Фильм')}</span>
          <span class="inplayer-series-name" id="inplayer-series-name">${escapeHtml(currentMedia?.title || '')}</span>
        </div>
        <div class="inplayer-top-actions">
          <button type="button" class="inplayer-ctrl-btn" id="inplayer-speed-btn" title="Скорость воспроизведения (нажмите для переключения)">
            ⚡ 1x
          </button>
          <div class="inplayer-speed-menu" id="inplayer-speed-menu">
            <div class="inplayer-speed-item" data-speed="0.5">0.5x</div>
            <div class="inplayer-speed-item" data-speed="0.75">0.75x</div>
            <div class="inplayer-speed-item active" data-speed="1">1x</div>
            <div class="inplayer-speed-item" data-speed="1.25">1.25x</div>
            <div class="inplayer-speed-item" data-speed="1.5">1.5x</div>
            <div class="inplayer-speed-item" data-speed="1.75">1.75x</div>
            <div class="inplayer-speed-item" data-speed="2">2x</div>
          </div>
          <button type="button" class="inplayer-ctrl-btn" id="inplayer-episodes-btn" title="Список серий" style="${isSeries ? '' : 'display: none;'}">
            📋 Серии
          </button>
          <button type="button" class="inplayer-ctrl-btn inplayer-icon-btn" id="inplayer-fs-btn" title="Полноэкранный режим (F)">
            ⛶
          </button>
          <button type="button" class="inplayer-ctrl-btn inplayer-icon-btn inplayer-close-btn" id="inplayer-close-btn" title="Закрыть кинотеатр">
            ✕
          </button>
        </div>
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

    const fsBtn = overlay.querySelector('#inplayer-fs-btn');
    if (fsBtn) {
      fsBtn.onclick = (e) => {
        e.stopPropagation();
        toggleCinemaFullscreen();
      };
    }

    const closeBtn = overlay.querySelector('#inplayer-close-btn');
    if (closeBtn) {
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        closePlayerModal();
      };
    }

    const speedBtn = overlay.querySelector('#inplayer-speed-btn');
    if (speedBtn) {
      // Одиночный клик: мгновенное циклическое переключение скорости (1x -> 1.25x -> 1.5x -> 2x...)
      speedBtn.onclick = (e) => {
        e.stopPropagation();
        cyclePlaybackSpeed();
      };
      // Правый клик / контекстное меню: открытие выпадающего списка
      speedBtn.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleInPlayerSpeedMenu(overlay);
      };
    }

    const speedMenu = overlay.querySelector('#inplayer-speed-menu');
    if (speedMenu) {
      speedMenu.querySelectorAll('.inplayer-speed-item').forEach(item => {
        item.onclick = (e) => {
          e.stopPropagation();
          const sp = parseFloat(item.dataset.speed);
          setGlobalPlaybackSpeed(sp);
          speedMenu.classList.remove('is-open');
        };
      });
    }

    const epBtn = overlay.querySelector('#inplayer-episodes-btn');
    if (epBtn) {
      epBtn.onclick = (e) => {
        e.stopPropagation();
        toggleInPlayerEpisodesSheet(overlay, true);
      };
    }

    const sheetCloseBtn = overlay.querySelector('#inplayer-sheet-close-btn');
    if (sheetCloseBtn) {
      sheetCloseBtn.onclick = (e) => {
        e.stopPropagation();
        toggleInPlayerEpisodesSheet(overlay, false);
      };
    }

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

    let hideTimer = null;
    const resetHideTimer = () => {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        const sheet = overlay.querySelector('#player-inplayer-episodes-sheet');
        const spMenu = overlay.querySelector('#inplayer-speed-menu');
        if (!sheet?.classList.contains('is-open') && !spMenu?.classList.contains('is-open')) {
          videoBox.classList.remove('controls-visible');
        }
      }, 2800);
    };

    const showControls = () => {
      videoBox.classList.add('controls-visible');
      resetHideTimer();
    };

    videoBox.addEventListener('mousemove', showControls);
    videoBox.addEventListener('pointermove', showControls);

    // Тап/клик по видео: переключение видимости оверлея
    videoBox.addEventListener('click', (e) => {
      if (e.target.closest('.inplayer-top-bar') || e.target.closest('.inplayer-bottom-bar') || e.target.closest('.player-inplayer-episodes-sheet') || e.target.closest('.inplayer-speed-menu')) {
        resetHideTimer();
        return;
      }
      const isVis = videoBox.classList.contains('controls-visible');
      if (isVis) {
        videoBox.classList.remove('controls-visible');
        clearTimeout(hideTimer);
      } else {
        showControls();
      }
    });

    videoBox.addEventListener('touchstart', (e) => {
      if (!e.target.closest('.inplayer-ctrl-btn') && !e.target.closest('.player-inplayer-episodes-sheet') && !e.target.closest('.inplayer-speed-menu')) {
        resetHideTimer();
      }
    }, { passive: true });

    showControls();
  }

  updateInPlayerEpisodeInfo();
  const savedSpeed = parseFloat(localStorage.getItem('storm_playback_speed') || '1');
  updateInPlayerSpeedDisplay(savedSpeed);
}

// ==========================================
// ПРОДВИНУТЫЙ РЕЖИМ «КАРТИНКА В КАРТИНКЕ» (PIP)
// ==========================================
export async function toggleAdvancedPiP() {
  const modal = document.getElementById('cinema-modal');
  const video = document.getElementById('storm-video-player');
  const iframe = document.getElementById('cinema-player-wrapper')?.querySelector('iframe');

  // Если окно уже в режиме плавающего mini-PiP — восстанавливаем кинотеатр
  if (modal && modal.classList.contains('is-mini-pip')) {
    modal.classList.remove('is-mini-pip');
    showToast('Полноразмерный кинотеатр восстановлен', 'info');
    return;
  }

  // 1. Попытка Document Picture-in-Picture API для видео или любого iframe
  if ('documentPictureInPicture' in window) {
    try {
      const pipTarget = video || iframe;
      if (pipTarget) {
        const parent = pipTarget.parentElement;
        const nextSibling = pipTarget.nextSibling;
        const pipWindow = await window.documentPictureInPicture.requestWindow({
          width: 540,
          height: 320
        });

        document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
          pipWindow.document.head.appendChild(link.cloneNode(true));
        });

        pipWindow.document.body.style.margin = '0';
        pipWindow.document.body.style.background = '#000';
        pipWindow.document.body.style.display = 'flex';
        pipWindow.document.body.style.flexDirection = 'column';
        pipWindow.document.body.style.height = '100vh';
        pipWindow.document.body.appendChild(pipTarget);

        trackClientAction('use_pip');
        showToast('Режим «Картинка в картинке» активирован', 'info');

        pipWindow.addEventListener('pagehide', () => {
          if (parent) {
            if (nextSibling) parent.insertBefore(pipTarget, nextSibling);
            else parent.appendChild(pipTarget);
          }
        });
        return;
      }
    } catch (err) {
      console.warn('Document PiP не запустился, переходим к альтернативному режиму:', err);
    }
  }

  // 2. Стандартный HTML5 Video PiP
  if (video && video.requestPictureInPicture) {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
        trackClientAction('use_pip');
        showToast('Режим «Картинка в картинке» активирован', 'info');
      }
      return;
    } catch (e) {
      console.warn('HTML5 Video PiP недоступен:', e);
    }
  }

  // 3. Универсальный плавающий режим Mini-Player (для всех плееров, включая iframes)
  if (modal) {
    modal.classList.add('is-mini-pip');
    trackClientAction('use_pip');
    showToast('Плавающий мини-плеер активирован (кликните 🖼️ PiP для возврата)', 'info');
  }
}

// ==========================================
// P2P WEBTORRENT СТРИМИНГ С ГОТОВЫМИ РАЗДАЧАМИ
// ==========================================
const WEBTORRENT_TRACKERS = [
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.webtorrent.dev',
  'wss://tracker.fastcast.nz',
  'wss://tracker.sloppyta.co:443/announce',
  'wss://tracker.ghostrr.com:443/announce',
  'wss://tracker.btorrent.xyz'
];

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
        <video id="storm-video-player" controls autoplay playsinline crossorigin="anonymous" style="position: relative; z-index: 2; width: 100%; height: 100%; max-height: 520px; background: #000; object-fit: contain;"></video>

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

function startWebTorrentStream(torrentIdentifier) {
  if (!window.WebTorrent) {
    showToast('Библиотека WebTorrent загружается, повторите попытку через секунду', 'warning');
    return;
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
        file.renderTo(video, { autoplay: true });
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

function renderPlayerUtilityButtons() {
  const container = document.getElementById('player-utility-actions');
  if (!container) return;

  container.innerHTML = `
    <div class="player-studio-dock">
      <!-- Верхняя линейка вкладок и переключателей студии -->
      <div class="player-studio-tabs-bar">
        <div class="studio-tabs-group">
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
          <button type="button" class="studio-tab-btn" id="studio-tab-services" title="Интеллектуальные сервисы: Whisper AI, X-Ray, Офлайн, Торренты">
            <span class="studio-tab-icon">⚡</span>
            <span class="studio-tab-text">Сервисы и ИИ</span>
          </button>
          <button type="button" class="studio-tab-btn" id="studio-tab-subtitles" title="Внешние дорожки и пользовательские субтитры">
            <span class="studio-tab-icon">💬</span>
            <span class="studio-tab-text">Субтитры</span>
          </button>
          <button type="button" class="studio-tab-btn" id="studio-tab-room" title="Совместный просмотр с друзьями и чатом">
            <span class="studio-tab-icon">👥</span>
            <span class="studio-tab-text">Кинокомната</span>
          </button>
        </div>

        <div class="studio-quick-actions">
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm ${nightAudioModeEnabled ? 'active' : ''}" id="toggle-night-audio-btn" title="Ночной режим звука (компрессор динамического диапазона)">
            <span>🌙 Ночь</span>
          </button>
          <label class="studio-autoskip-toggle" title="Автоматический пропуск опенингов и титров">
            <input type="checkbox" id="toggle-autoskip" ${autoSkipEnabled ? 'checked' : ''}>
            <span class="studio-autoskip-indicator"></span>
            <span class="studio-autoskip-label">Автопропуск</span>
          </label>
        </div>
      </div>

      <!-- Выдвижная панель студии (Studio Drawer), открывающаяся НЕПОСРЕДСТВЕННО под панелью кнопок -->
      <div class="player-studio-drawer" id="player-studio-drawer" style="display: none;">
        <div class="studio-drawer-header">
          <div class="studio-drawer-title">
            <span id="studio-drawer-icon">🎛️</span>
            <span id="studio-drawer-heading">Pro Видео</span>
          </div>
          <button type="button" class="studio-drawer-close" id="studio-drawer-close" title="Закрыть панель">✕</button>
        </div>
        <div class="studio-drawer-body" id="studio-drawer-body"></div>
      </div>
    </div>
  `;

  const drawer = container.querySelector('#player-studio-drawer');
  const drawerBody = container.querySelector('#studio-drawer-body');
  const drawerIcon = container.querySelector('#studio-drawer-icon');
  const drawerHeading = container.querySelector('#studio-drawer-heading');
  const drawerClose = container.querySelector('#studio-drawer-close');
  const tabButtons = container.querySelectorAll('.studio-tab-btn');

  let activeTabName = null;

  const closeDrawer = () => {
    if (drawer) drawer.style.display = 'none';
    activeTabName = null;
    tabButtons.forEach(btn => btn.classList.remove('active'));
  };

  if (drawerClose) drawerClose.onclick = closeDrawer;

  const openDrawerTab = (tabName, icon, heading, renderFn) => {
    if (activeTabName === tabName && drawer.style.display !== 'none') {
      closeDrawer();
      return;
    }

    activeTabName = tabName;
    tabButtons.forEach(btn => btn.classList.toggle('active', btn.id === `studio-tab-${tabName}`));

    if (drawerIcon) drawerIcon.textContent = icon;
    if (drawerHeading) drawerHeading.textContent = heading;

    drawer.style.display = 'block';
    drawerBody.innerHTML = '';
    renderFn(drawerBody);
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

  // 4. Сервисы и ИИ
  const tabServices = container.querySelector('#studio-tab-services');
  if (tabServices) {
    tabServices.onclick = () => {
      openDrawerTab('services', '⚡', 'Интеллектуальные сервисы и утилиты воспроизведения', (body) => {
        body.innerHTML = `
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin-bottom: 14px;">
            <button type="button" class="storm-btn ${document.getElementById('toggle-whisper-btn')?.classList.contains('active') ? 'storm-btn-primary active' : 'storm-btn-secondary'} storm-btn-sm" id="drawer-whisper-btn" style="padding: 10px 14px; display: flex; align-items: center; justify-content: flex-start; gap: 10px;">
              <span style="font-size: 16px;">🎙️</span>
              <div style="text-align: left;">
                <div style="font-weight: 800; font-size: 12px;">Whisper AI</div>
                <div class="storm-btn-subtext">Распознавание речи на лету</div>
              </div>
            </button>

            <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="drawer-xray-btn" style="padding: 10px 14px; display: flex; align-items: center; justify-content: flex-start; gap: 10px;">
              <span style="font-size: 16px;">🔍</span>
              <div style="text-align: left;">
                <div style="font-weight: 800; font-size: 12px;">X-Ray Режим</div>
                <div class="storm-btn-subtext">Актеры, саундтрек и факты</div>
              </div>
            </button>

            <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="drawer-offline-btn" style="padding: 10px 14px; display: flex; align-items: center; justify-content: flex-start; gap: 10px;">
              <span style="font-size: 16px;">💾</span>
              <div style="text-align: left;">
                <div style="font-weight: 800; font-size: 12px;">Офлайн релиз</div>
                <div class="storm-btn-subtext">Сохранить в память PWA</div>
              </div>
            </button>

            <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="drawer-torr-btn" style="padding: 10px 14px; display: flex; align-items: center; justify-content: flex-start; gap: 10px;">
              <span style="font-size: 16px;">🧲</span>
              <div style="text-align: left;">
                <div style="font-weight: 800; font-size: 12px;">Торренты и P2P</div>
                <div class="storm-btn-subtext">TorrServer и AceStream</div>
              </div>
            </button>
          </div>

          <div id="drawer-torrserver-host" style="display: none; margin-top: 10px;"></div>
        `;

        const whisperBtn = body.querySelector('#drawer-whisper-btn');
        if (whisperBtn) {
          whisperBtn.onclick = () => {
            toggleWhisperAiSubtitles();
            const isActive = whisperBtn.classList.toggle('storm-btn-primary');
            whisperBtn.classList.toggle('active', isActive);
            whisperBtn.classList.toggle('storm-btn-secondary', !isActive);
          };
        }

        const xrayBtn = body.querySelector('#drawer-xray-btn');
        if (xrayBtn) {
          xrayBtn.onclick = () => {
            closeDrawer();
            toggleXRayManual();
          };
        }

        const offlineBtn = body.querySelector('#drawer-offline-btn');
        if (offlineBtn) {
          offlineBtn.onclick = () => {
            if (currentMedia) saveMediaForOffline(currentMedia);
          };
        }

        const torrBtn = body.querySelector('#drawer-torr-btn');
        const torrHost = body.querySelector('#drawer-torrserver-host');
        if (torrBtn && torrHost) {
          torrBtn.onclick = () => {
            if (torrHost.style.display === 'none') {
              torrHost.style.display = 'block';
              renderTorrServerSettings(torrHost);
            } else {
              torrHost.style.display = 'none';
            }
          };
        }
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

  // Быстрые кнопки панели справа
  const nightAudioBtn = container.querySelector('#toggle-night-audio-btn');
  if (nightAudioBtn) {
    nightAudioBtn.onclick = () => toggleNightModeAudio();
  }

  const autoSkipCheck = container.querySelector('#toggle-autoskip');
  if (autoSkipCheck) {
    autoSkipCheck.onchange = (e) => {
      autoSkipEnabled = e.target.checked;
      localStorage.setItem('storm_auto_skip', autoSkipEnabled ? 'true' : 'false');
      showToast(`Автопропуск заставок: ${autoSkipEnabled ? 'Включен' : 'Выключен'}`, 'info');
    };
  }
}

// ==========================================================================
// СИСТЕМА ОТСЛЕЖИВАНИЯ ПРОСМОТРЕННЫХ СЕРИЙ И ПОДСКАЗОК
// ==========================================================================
function getWatchedEpisodes(mediaId, seasonNum = 1) {
  if (!mediaId) return new Set();
  try {
    const sNum = Number(seasonNum) || 1;
    let raw = localStorage.getItem(`storm_watched_eps_${mediaId}_s${sNum}`);
    if (!raw && sNum === 1) {
      raw = localStorage.getItem(`storm_watched_eps_${mediaId}`);
    }
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr.map(Number));
    }
  } catch {}
  return new Set();
}

function markEpisodeWatched(mediaId, seasonOrEp, maybeEpisode, maybeWatched) {
  if (!mediaId) return;
  let seasonNum = 1;
  let episodeNum = 1;
  let watched = true;

  if (maybeEpisode !== undefined) {
    seasonNum = Number(seasonOrEp) || 1;
    episodeNum = Number(maybeEpisode) || 1;
    if (maybeWatched !== undefined) watched = Boolean(maybeWatched);
  } else {
    episodeNum = Number(seasonOrEp) || 1;
  }

  try {
    const sKey = `storm_watched_eps_${mediaId}_s${seasonNum}`;
    const watchedSet = getWatchedEpisodes(mediaId, seasonNum);
    if (watched) {
      watchedSet.add(episodeNum);
    } else {
      watchedSet.delete(episodeNum);
    }
    const arr = Array.from(watchedSet);
    localStorage.setItem(sKey, JSON.stringify(arr));
    if (seasonNum === 1) {
      localStorage.setItem(`storm_watched_eps_${mediaId}`, JSON.stringify(arr));
    }
  } catch {}
}

function toggleEpisodeWatched(mediaId, seasonNum = 1, episodeNum = 1) {
  const sNum = Number(seasonNum) || 1;
  const epNum = Number(episodeNum);
  const watchedSet = getWatchedEpisodes(mediaId, sNum);
  const isWatched = watchedSet.has(epNum);
  markEpisodeWatched(mediaId, sNum, epNum, !isWatched);
  return !isWatched;
}

function toggleAllSeasonEpisodesWatched(mediaId, seasonNum = 1, totalEpisodes = 0) {
  if (!mediaId || !totalEpisodes) return false;
  try {
    const sNum = Number(seasonNum) || 1;
    const sKey = `storm_watched_eps_${mediaId}_s${sNum}`;
    const watched = getWatchedEpisodes(mediaId, sNum);
    if (watched.size >= totalEpisodes) {
      localStorage.removeItem(sKey);
      if (sNum === 1) localStorage.removeItem(`storm_watched_eps_${mediaId}`);
      return false;
    } else {
      const all = Array.from({ length: totalEpisodes }, (_, i) => i + 1);
      localStorage.setItem(sKey, JSON.stringify(all));
      if (sNum === 1) localStorage.setItem(`storm_watched_eps_${mediaId}`, JSON.stringify(all));
      return true;
    }
  } catch {}
  return false;
}

function toggleAllEpisodesWatched(mediaId, totalEpisodes) {
  return toggleAllSeasonEpisodesWatched(mediaId, 1, totalEpisodes);
}

function getSeasonStatusInfo(mediaId, seasonNum = 1, totalEpisodes = 0) {
  const total = Number(totalEpisodes) || 0;
  const watched = getWatchedEpisodes(mediaId, seasonNum);
  const count = watched.size;
  if (total > 0 && count >= total) {
    return { status: 'completed', label: '✓ Просмотрен', count, total };
  }
  if (count > 0) {
    return { status: 'watching', label: `▶ ${count}/${total || '?'}`, count, total };
  }
  return { status: 'planned', label: 'В планах', count: 0, total };
}

async function syncOverallSeriesProgress(mediaDetails) {
  if (!mediaDetails) return;
  const seasons = mediaDetails.seasons || [];
  if (seasons.length === 0) return;

  let totalEps = 0;
  let totalWatched = 0;
  seasons.forEach(s => {
    const count = s.episode_count || 0;
    totalEps += count;
    const watched = getWatchedEpisodes(mediaDetails.id, s.season_number);
    totalWatched += watched.size;
  });

  if (totalEps > 0 && totalWatched >= totalEps) {
    if (mediaDetails.user_status !== 'completed') {
      mediaDetails.user_status = 'completed';
      await saveBookmarkStatus(mediaDetails, 'completed');
      renderStatusButtons('completed');
    }
  }
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

  const episodes = (details.episodes || []).slice().sort((a, b) => (a.ordinal || 0) - (b.ordinal || 0));
  if (episodes.length === 0) return;

  currentMedia.episodes = episodes;
  currentMedia.seasons = [{
    season_number: 1,
    name: currentMedia.title_ru || currentMedia.title || '1 сезон',
    episode_count: episodes.length,
    overview: currentMedia.description || 'Официальный Full HD релиз AniLibria.'
  }];
  currentMedia.media_type = 'anime-series';

  const targetEpNum = options.initialEpisode ? parseInt(options.initialEpisode, 10) : (episodes[0]?.ordinal || 1);
  quickBarActiveSeason = 1;
  quickBarActiveEpisode = targetEpNum;
  quickBarActiveTranslationId = 'anilibria';

  quickBarSeriesData = {
    type: 'serial',
    isAnime: true,
    animeSource: 'anilibria',
    seasons: [{
      season: 1,
      name: currentMedia.title_ru || currentMedia.title || '1 сезон',
      episodes_count: episodes.length,
      episodes: episodes.map(ep => ({
        episode: ep.ordinal || 1,
        name: ep.name ? `${ep.ordinal || 1} серия: ${ep.name}` : `${ep.ordinal || 1} серия`,
        translations: [{ id: 'anilibria', name: 'Официальный дубляж AniLibria (1080p FHD)' }]
      }))
    }],
    active: {
      season: 1,
      episode: targetEpNum,
      id_translation: 'anilibria'
    }
  };

  const quickBar = document.getElementById('player-series-quick-bar');
  if (quickBar) quickBar.style.display = 'flex';
  renderQuickBarDropdowns();
  setupQuickBarOutsideListeners();

  renderSeriesSeasons(currentMedia, 1, targetEpNum);

  const initialEp = episodes.find(e => (e.ordinal || 1) === targetEpNum) || episodes[0];
  if (initialEp) {
    currentEpisodeIndex = targetEpNum;
    const streamUrl = initialEp.hls_1080 || initialEp.hls_720 || initialEp.hls_480;
    if (streamUrl) playStreamUrl(streamUrl);
    loadSkipTimes(currentMedia.id, targetEpNum);
  }
}

async function renderAnixartControls(details, options = {}) {
  const container = document.getElementById('anixart-controls-container');
  if (container) container.style.display = 'none';

  const voiceovers = details.voiceovers || [];
  if (voiceovers.length === 0) return;

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
    const res = await fetch(`/api/anixart/episodes/${details.id}/${activeVoiceover.id}`);
    const rawEpisodes = await res.json();
    currentEpisodes = (rawEpisodes || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));

    const mediaId = currentMedia?.id || details.id;
    const watchedSet = getWatchedEpisodes(mediaId, 1);

    let targetEpNum = 1;
    if (options.initialEpisode) {
      targetEpNum = parseInt(options.initialEpisode, 10);
    } else if (watchedSet.size > 0 && watchedSet.size < currentEpisodes.length) {
      const unwatched = currentEpisodes.find(ep => !watchedSet.has(ep.position || 1));
      if (unwatched) targetEpNum = unwatched.position || 1;
    }

    currentMedia.seasons = [{
      season_number: 1,
      name: currentMedia.title_ru || currentMedia.title || '1 сезон',
      episode_count: currentEpisodes.length || activeVoiceover.episodes_count || 12,
      overview: currentMedia.description || `Официальный релиз AniXart в озвучке «${activeVoiceover.name}».`
    }];
    currentMedia.media_type = 'anime-series';

    quickBarActiveSeason = 1;
    quickBarActiveEpisode = targetEpNum;
    quickBarActiveTranslationId = activeVoiceover.id;

    quickBarSeriesData = {
      type: 'serial',
      isAnime: true,
      animeSource: 'anixart',
      seasons: [{
        season: 1,
        name: currentMedia.title_ru || currentMedia.title || '1 сезон',
        episodes_count: currentEpisodes.length,
        episodes: currentEpisodes.map(ep => ({
          episode: ep.position || 1,
          name: ep.name_ru || ep.name || `${ep.position || 1} серия`,
          translations: voiceovers.map(v => ({
            id: v.id,
            name: v.name,
            episodes_count: v.episodes_count
          }))
        }))
      }],
      active: {
        season: 1,
        episode: targetEpNum,
        id_translation: activeVoiceover.id
      }
    };

    const quickBar = document.getElementById('player-series-quick-bar');
    if (quickBar) quickBar.style.display = 'flex';
    renderQuickBarDropdowns();
    setupQuickBarOutsideListeners();

    renderSeriesSeasons(currentMedia, 1, targetEpNum);

    const chosenEp = currentEpisodes.find(e => (e.position || 1) === targetEpNum) || currentEpisodes[0];
    if (chosenEp) {
      currentEpisodeIndex = targetEpNum;
      playAnixartEpisode(chosenEp);
      loadSkipTimes(details.id, targetEpNum);
    }
  } catch (err) {
    console.error('Ошибка загрузки серий AniXart:', err);
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

  // Отмечаем серию как просмотренную в хранилище
  if (currentMedia?.id) {
    markEpisodeWatched(currentMedia.id, 1, pos, true);
  }

  quickBarActiveEpisode = pos;
  renderQuickBarDropdowns();
  highlightActiveEpisodeInGrid(pos);

  if (episode.url) {
    container.innerHTML = `
      <div class="player-video-box" style="position:relative;width:100%;height:100%;">
        <div id="player-ambilight-aura" class="ambilight-aura"></div>
        <iframe class="cinema-player-iframe" src="${episode.url}" allow="autoplay *; encrypted-media *; fullscreen *; picture-in-picture *; display-capture *" allowfullscreen="true" webkitallowfullscreen="true" mozallowfullscreen="true" style="position:relative;z-index:2;width:100%;height:100%;border:none;border-radius:12px;"></iframe>
      </div>
    `;

    const vBox = container.querySelector('.player-video-box');
    if (vBox) mountInPlayerOverlay(vBox);

    updateProgressState(pos, currentEpisodes.length || 1);
  }
}

function updateProgressState(episode, totalEpisodes) {
  const percent = Math.min(100, Math.round((episode / (totalEpisodes || 1)) * 100));
  currentProgressPercent = percent;

  const slider = document.getElementById('player-progress-slider');
  const label = document.getElementById('player-progress-label');
  if (slider) slider.value = percent;
  if (label) label.textContent = `${percent}% (Серия ${episode} из ${totalEpisodes})`;

  if (getUser() && currentMedia) {
    syncWatchProgress({
      media_id: currentMedia.id,
      source: currentMedia.source,
      title: currentMedia.title,
      poster_url: currentMedia.poster,
      media_type: currentMedia.media_type,
      season: 1,
      episode: episode,
      total_episodes: totalEpisodes,
      duration_seconds: 1440,
      time_seconds: Math.round((1440 * percent) / 100)
    });
  }
}

function renderStatusButtons(currentStatus) {
  const statusContainer = document.getElementById('player-status-buttons');
  if (!statusContainer) return;
  statusContainer.innerHTML = '';

  const statuses = [
    { id: 'watching', icon: '👁️', label: t('status_watching') },
    { id: 'planned', icon: '📋', label: t('status_plan') },
    { id: 'completed', icon: '✅', label: t('status_completed') },
    { id: 'favorite', icon: '❤️', label: t('status_favorite') },
    { id: 'on_hold', icon: '⏸️', label: t('status_hold') },
    { id: 'dropped', icon: '🛑', label: t('status_dropped') },
    { id: 'wont_watch', icon: '🚫', label: t('status_wont_watch') }
  ];

  const normStatus = currentStatus === 'plan' ? 'planned' : (currentStatus === 'hold' ? 'on_hold' : currentStatus);

  statuses.forEach(s => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const isActive = normStatus === s.id;
    btn.className = `storm-btn storm-btn-sm ${isActive ? 'storm-btn-primary' : 'storm-btn-secondary'}`;
    btn.innerHTML = `<span style="font-size: 13px; line-height: 1;">${s.icon}</span> <span>${s.label}</span>`;
    btn.onclick = async () => {
      if (isActive) {
        // Повторный клик: отменяем статус и удаляем закладку
        await deleteBookmark(currentMedia.id, currentMedia.source, currentMedia.title);
        if (currentMedia) currentMedia.user_status = null;
        if (currentMedia?.id) localStorage.removeItem(`storm_status_${currentMedia.id}`);
        renderStatusButtons(null);
        showToast('Статус просмотра снят', 'info');
      } else {
        if (currentMedia) currentMedia.user_status = s.id;
        if (currentMedia?.id) localStorage.setItem(`storm_status_${currentMedia.id}`, s.id);
        renderStatusButtons(s.id);
        await saveBookmarkStatus(currentMedia, s.id);
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
  gallery.innerHTML = screenshots.map((src, idx) => `
    <img class="cinema-screenshot-thumb" src="${src}" alt="Кадр ${idx + 1}" loading="lazy" onerror="this.style.display='none';" onclick="window.open('${src}', '_blank')">
  `).join('');
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
export function cleanVideoTitle(str) {
  if (!str) return '';
  let s = String(str).trim();
  s = s.replace(/\s*постер\s*4[KkКк]/gi, '');
  s = s.replace(/\s*постер/gi, '');
  s = s.replace(/\s*[\(\[]?\s*4[KkКк]\s*(?:Ultra\s*HD|UHD)?\s*[\)\]]?/gi, '');
  s = s.replace(/\s*[\(\[]?\s*(?:Ultra\s*HD|UHD|2160p|1080p|720p|480p|HDR|HDR10\+?|Dolby\s*Vision|DV|Remux|WEB-DL|BDRip|DVDRip)\s*[\)\]]?/gi, '');
  s = s.replace(/\s*[\(\[]?\s*4[KkКк]\s*[\)\]]?/gi, '');
  s = s.replace(/\s*[\(\[]?\s*(?:фильм|сериал)\s*[\)\]]?/gi, '');
  s = s.replace(/[-–—/]\s*$/, '').trim();
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

export function parseFormattedGenres(rawGenres) {
  if (!rawGenres) return [];
  let list = [];
  if (Array.isArray(rawGenres)) {
    list = rawGenres;
  } else if (typeof rawGenres === 'string') {
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

  const unique = [];
  result.forEach(g => {
    if (g && !unique.includes(g)) unique.push(g);
  });
  return unique;
}

export function updatePlayerUrl(mediaItem, season = null, episode = null, player = null) {
  if (!mediaItem) return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('media', mediaItem.id);
    url.searchParams.set('source', mediaItem.source || 'fanfilm4k');
    if (season !== null && season !== undefined) url.searchParams.set('season', season);
    else url.searchParams.delete('season');
    if (episode !== null && episode !== undefined) url.searchParams.set('episode', episode);
    else url.searchParams.delete('episode');
    if (player && player.id) url.searchParams.set('player', player.id);
    window.history.replaceState({ mediaId: mediaItem.id, season, episode }, '', url.toString());
  } catch (e) {
    console.warn('Could not update player URL:', e);
  }
}

export function clearPlayerUrl() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('media');
    url.searchParams.delete('source');
    url.searchParams.delete('season');
    url.searchParams.delete('episode');
    url.searchParams.delete('player');
    window.history.replaceState({}, '', url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : ''));
  } catch (e) {
    console.warn('Could not clear player URL:', e);
  }
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

  const cleanTitle = cleanVideoTitle(mediaDetails.title);
  const poster = mediaDetails.poster || 'assets/favicon.svg';

  let formattedReleaseDate = 'Не указана';
  if (mediaDetails.release_date) {
    const parts = String(mediaDetails.release_date).split('-');
    if (parts.length === 3) {
      formattedReleaseDate = `${parts[2].padStart(2, '0')}.${parts[1].padStart(2, '0')}.${parts[0]}`;
    } else {
      formattedReleaseDate = mediaDetails.release_date;
    }
  } else if (mediaDetails.year) {
    formattedReleaseDate = `${mediaDetails.year} год`;
  }

  const duration = mediaDetails.duration || (mediaDetails.runtime_minutes ? `${mediaDetails.runtime_minutes} мин` : '1 ч 45 мин');
  const ratingKp = mediaDetails.rating_kp || mediaDetails.rating || '—';
  const ratingImdb = mediaDetails.rating_imdb || mediaDetails.rating_tmdb || mediaDetails.rating || '—';
  const ratingTmdb = mediaDetails.rating_tmdb || mediaDetails.rating || '—';
  const ratingRotten = mediaDetails.rating_rotten || (parseFloat(mediaDetails.rating) ? Math.min(99, Math.round(parseFloat(mediaDetails.rating) * 10.6)) : 82);
  const ratingMeta = mediaDetails.rating_metacritic || (parseFloat(mediaDetails.rating) ? Math.min(98, Math.round(parseFloat(mediaDetails.rating) * 10.1)) : 76);

  const formattedGenres = parseFormattedGenres(mediaDetails.genres);
  const formattedCountries = parseFormattedCountries(mediaDetails.countries || mediaDetails.country);

  const directors = mediaDetails.directors || [];
  const primaryDirector = directors[0] || null;
  const cast = mediaDetails.cast || [];

  container.innerHTML = `
    <!-- Постер и ключевые плашки -->
    <div class="cinema-side-poster-wrap">
      <img src="${poster}" alt="${cleanTitle}" class="cinema-side-poster" onerror="this.src='assets/favicon.svg'">
      <div class="cinema-side-poster-glow"></div>
      <div class="cinema-side-badges">
        <span class="storm-badge storm-badge-4k">4K UHD</span>
        <span class="storm-badge storm-badge-rating">★ ${ratingKp}</span>
      </div>
    </div>

    <!-- Рейтинги мировых платформ в один ряд -->
    <div class="cinema-ratings-strip" title="Рейтинги мировых платформ">
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
    <div class="cinema-info-table-wrap">
      <table class="cinema-info-table">
        <tbody>
          <tr>
            <td class="info-table-label">📅 Премьера</td>
            <td class="info-table-val"><b>${formattedReleaseDate}</b></td>
          </tr>
          <tr>
            <td class="info-table-label">⏱️ Длительность</td>
            <td class="info-table-val"><b>${duration}</b></td>
          </tr>
          <tr>
            <td class="info-table-label">🌍 Страны</td>
            <td class="info-table-val">
              <div class="cinema-meta-chips-wrap">
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
            <td class="info-table-label">🎭 Жанры</td>
            <td class="info-table-val">
              <div class="cinema-meta-chips-wrap">
                ${formattedGenres.map(g => `
                  <button type="button" class="cinema-meta-chip genre-chip" data-genre="${g}" title="Показать все фильмы в жанре ${g}">
                    <span>🎭</span>
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
          <img src="${primaryDirector.photo || 'assets/favicon.svg'}" alt="${primaryDirector.name}" class="cinema-director-photo" onerror="this.src='assets/favicon.svg'">
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
    ${cast.length > 0 ? `
      <div class="cinema-person-section">
        <div class="cinema-section-subtitle">
          <span>🎭</span>
          <span style="font-weight: 800;">В главных ролях (${cast.length})</span>
        </div>
        <div class="cinema-cast-scroll">
          ${cast.map(actor => `
            <div class="cinema-actor-chip" data-actor-id="${actor.id}" data-actor-name="${actor.name}" title="Нажмите для просмотра фильмов">
              <img src="${actor.photo || 'assets/favicon.svg'}" alt="${actor.name}" class="cinema-actor-photo" onerror="this.src='assets/favicon.svg'">
              <div class="cinema-actor-info">
                <div class="cinema-actor-name">${actor.name}</div>
                <div class="cinema-actor-role">${actor.character || 'Роль'}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}
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
}

// ==========================================
// МОДАЛЬНОЕ ОКНО ФИЛЬМОГРАФИИ АКТЕРА И РЕЖИССЕРА
// ==========================================
export async function openPersonModal(personId, personName) {
  const modal = document.getElementById('person-modal');
  const title = document.getElementById('person-modal-title');
  const body = document.getElementById('person-modal-body');
  if (!modal || !body) return;

  if (title) title.textContent = personName ? `Фильмография: ${personName}` : 'Фильмография';
  modal.classList.add('is-open');

  body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;padding:40px;color:var(--text-muted);gap:12px;">
      <div class="storm-spinner"></div>
      <span style="font-weight:600;">Загрузка фильмографии...</span>
    </div>
  `;

  try {
    const res = await fetch(`/api/media/person?id=${encodeURIComponent(personId)}`);
    if (!res.ok) throw new Error('Не удалось загрузить данные персоны');
    const data = await res.json();
    const person = data.person || {};
    const items = data.items || [];

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
        <img src="${person.photo || 'assets/favicon.svg'}" alt="${person.name}" class="person-profile-photo" onerror="this.src='assets/favicon.svg'">
        <div class="person-profile-info">
          <h3 class="person-profile-name">${person.name || personName}</h3>
          <div class="person-profile-meta">
            <span>${person.known_for || 'Кинематографист'}</span>
            ${formattedBirthday ? `<span>• Дата рождения: <b>${formattedBirthday}</b></span>` : ''}
            ${person.place_of_birth ? `<span>• ${person.place_of_birth}</span>` : ''}
          </div>
          ${person.biography ? `<p class="person-profile-bio">${person.biography}</p>` : ''}
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
              <img src="${item.poster || 'assets/favicon.svg'}" alt="${item.title}" class="person-media-poster" loading="lazy" onerror="this.src='assets/favicon.svg'">
              <span class="person-media-rating">★ ${item.rating || '—'}</span>
            </div>
            <div class="person-media-info">
              <div class="person-media-title" title="${item.title}">${item.title}</div>
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
// СЕЛЕКТОР СЕЗОНОВ И СЕРИЙ С ДИНАМИЧЕСКИМИ ОПИСАНИЯМИ И СТАТУСАМИ
// ==========================================
async function renderSeriesSeasons(mediaDetails, initialSeason = null, initialEpisode = null) {
  const container = document.getElementById('series-seasons-container');
  if (!container) return;

  const isSeries = mediaDetails.media_type === 'series' || 
                   mediaDetails.category === 'Сериал' || 
                   mediaDetails.media_type === 'cartoon-series' || 
                   mediaDetails.media_type === 'anime-series' ||
                   mediaDetails.source === 'anilibria' ||
                   mediaDetails.source === 'anixart' ||
                   (mediaDetails.seasons && mediaDetails.seasons.length > 0) ||
                   (mediaDetails.episodes && mediaDetails.episodes.length > 0);
  const seasons = mediaDetails.seasons || [];

  if (!isSeries || seasons.length === 0) {
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

  let activeSeasonNum = initialSeason ? parseInt(initialSeason, 10) : seasons[0].season_number;
  let activeEpisodeNum = initialEpisode ? parseInt(initialEpisode, 10) : 1;

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
        if (mediaDetails.source !== 'anilibria' && mediaDetails.source !== 'anixart') {
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

      if (mediaDetails.source === 'anilibria' && mediaDetails.episodes && mediaDetails.episodes.length > 0) {
        episodes = mediaDetails.episodes.map(ep => ({
          episode_number: ep.ordinal || 1,
          name: ep.name ? `${ep.ordinal || 1} серия: ${ep.name}` : `Серия ${ep.ordinal || 1}`,
          still: ep.still || ep.preview || mediaDetails.poster,
          duration: ep.duration || '24 мин.',
          air_date: ep.air_date || '',
          overview: (ep.overview && ep.overview !== mediaDetails.description) ? ep.overview : ''
        }));
        seasonOverview = `Официальный релиз AniLibria • ${episodes.length} серий в Full HD качестве.`;
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
        const tvId = mediaDetails.tmdb_id || String(mediaDetails.id).replace('tmdb_', '');
        const res = await fetch(`/api/media/series-episodes?tvId=${encodeURIComponent(tvId)}&season=${seasonNum}`);
        if (!res.ok) throw new Error('Не удалось загрузить серии');
        const data = await res.json();
        episodes = data.episodes || [];
        const isTmdbSeasonOverviewDup = data.overview && mediaDetails.description && data.overview.trim() === mediaDetails.description.trim();
        seasonOverview = (!isTmdbSeasonOverviewDup && data.overview) || season.overview || `${season.name || `Сезон ${seasonNum}`} • ${episodes.length} серий.`;
      }

      if (episodes.length === 0) {
        gridEl.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-muted);">Серии не найдены</div>`;
        return;
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
            <div style="display: flex; align-items: center; gap: 8px;">
              <strong style="font-size: 13.5px; color: #ffffff;">${season.name || `Сезон ${seasonNum}`}</strong>
              <span class="season-status-chip ${sStatus.status}">${sStatus.label}</span>
            </div>
            <button type="button" class="storm-btn storm-btn-sm ${isSeasonAllWatched ? 'storm-btn-secondary' : 'storm-btn-primary'}" id="toggle-season-btn" style="font-size: 11px; padding: 4px 10px;">
              ${isSeasonAllWatched ? '✕ Снять отметку' : '✓ Отметить весь сезон'}
            </button>
          </div>
          <div class="series-season-desc" id="series-season-desc">${finalSeasonDesc}</div>
        `;

        const toggleBtn = infoBox.querySelector('#toggle-season-btn');
        if (toggleBtn) {
          toggleBtn.onclick = async () => {
            const marked = toggleAllSeasonEpisodesWatched(mediaDetails.id, seasonNum, episodes.length);
            showToast(marked ? `Сезон ${seasonNum} отмечен как просмотренный` : `Отметка снята с сезона ${seasonNum}`, 'info');
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

      gridEl.innerHTML = episodes.map(ep => {
        const isEpActive = ep.episode_number === effectiveTargetEp;
        const isWatched = watchedSet.has(ep.episode_number);
        const epStatusLabel = isWatched ? '✓ Просмотрено' : (isEpActive ? '▶ Смотрю' : 'Не просмотрено');
        const epStatusClass = isWatched ? 'completed' : (isEpActive ? 'watching' : 'planned');

        return `
        <div class="series-episode-card ${isEpActive ? 'active' : ''} ${isWatched ? 'watched' : ''}" data-ep-num="${ep.episode_number}">
          <div class="series-episode-thumb-box">
            <img src="${ep.still || ep.still_path || 'assets/favicon.svg'}" alt="${ep.name}" class="series-episode-thumb" loading="lazy" onerror="this.src='assets/favicon.svg'">
            <span class="series-episode-badge">Серия ${ep.episode_number}</span>
            ${ep.duration ? `<span class="series-episode-duration">${ep.duration}</span>` : ''}
          </div>
          <div class="series-episode-content">
            <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 6px;">
              <div class="series-episode-title">${ep.name}</div>
              <span class="season-status-chip ${epStatusClass} ep-status-toggle" data-ep-num="${ep.episode_number}" title="Нажмите для переключения статуса серии" style="font-size: 9px; padding: 1px 6px; cursor: pointer; flex-shrink: 0;">
                ${epStatusLabel}
              </span>
            </div>
            <div class="series-episode-airdate">${ep.air_date ? 'Дата выхода: ' + ep.air_date : ''}</div>
            <p class="series-episode-desc">${ep.overview || 'Смотрите серию онлайн в высоком качестве.'}</p>
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

          markEpisodeWatched(mediaDetails.id, seasonNum, epNum, true);
          card.classList.add('watched');
          updateEpisodeSynopsis(epObj);

          showToast(`Выбрана серия ${epNum}: ${epObj?.name || ''}`, 'info');
          updateProgressState(epNum, episodes.length);
          renderSeasonTabs();
          await syncOverallSeriesProgress(mediaDetails);

          // Обновляем быструю панель
          quickBarActiveSeason = seasonNum;
          quickBarActiveEpisode = epNum;
          renderQuickBarDropdowns();

          if (mediaDetails.source === 'anilibria') {
            const rawEp = (mediaDetails.episodes || []).find(e => (e.ordinal || 1) === epNum) || mediaDetails.episodes?.[epNum - 1];
            if (rawEp) {
              currentEpisodeIndex = epNum;
              const streamUrl = rawEp.hls_1080 || rawEp.hls_720 || rawEp.hls_480;
              if (streamUrl) playStreamUrl(streamUrl);
              loadSkipTimes(mediaDetails.id, epNum);
            }
          } else if (mediaDetails.source === 'anixart') {
            const rawEp = (currentEpisodes || []).find(e => (e.position || 1) === epNum) || currentEpisodes?.[epNum - 1];
            if (rawEp) {
              currentEpisodeIndex = epNum;
              playAnixartEpisode(rawEp);
              loadSkipTimes(mediaDetails.id, epNum);
            }
          } else {
            updatePlayerUrl(mediaDetails, seasonNum, epNum, currentActivePlayer);
          }
        };
      });

      if (effectiveTargetEp) {
        const activeCard = gridEl.querySelector(`.series-episode-card[data-ep-num="${effectiveTargetEp}"]`);
        if (activeCard) {
          activeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    } catch (err) {
      gridEl.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--color-red);">Ошибка: ${err.message}</div>`;
    }
  }

  renderSeasonTabs();
  loadSeasonEpisodes(activeSeasonNum, initialEpisode || 1);
}
