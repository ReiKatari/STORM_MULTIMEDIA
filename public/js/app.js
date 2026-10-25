/* ==========================================================================
   STORM MULTIMEDIA - ГЛАВНЫЙ КОНТРОЛЛЕР ПРИЛОЖЕНИЯ
   ========================================================================== */

// Фильтрация постороннего шума от балансеров, трекеров, прерванных промисов и служебных логов
(() => {
  const noisyPatterns = [
    'ERR_BLOCKED_BY_CLIENT',
    'AbortError',
    'play() request was interrupted',
    'safetyTimeOut',
    'close code=1006',
    'wasOpen=true',
    'PM count',
    'test ready',
    'fatal error',
    'ERR_CONTENT_LENGTH_MISMATCH',
    'ERR_CONNECTION_RESET',
    'Images loaded lazily',
    'beforeinstallprompt'
  ];

  const origWarn = console.warn;
  const origError = console.error;

  console.warn = function(...args) {
    const msg = args.map(a => String(a?.message || a)).join(' ');
    if (noisyPatterns.some(p => msg.includes(p))) return;
    origWarn.apply(console, args);
  };

  console.error = function(...args) {
    const msg = args.map(a => String(a?.message || a)).join(' ');
    if (noisyPatterns.some(p => msg.includes(p))) return;
    origError.apply(console, args);
  };

  window.addEventListener('error', (e) => {
    const msg = String(e?.message || '');
    if (noisyPatterns.some(p => msg.includes(p))) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  });

  window.addEventListener('unhandledrejection', (e) => {
    const msg = String(e?.reason?.message || e?.reason || '');
    if (noisyPatterns.some(p => msg.includes(p))) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  });
})();

import { initTheme, setTheme } from './theme.js?v=1.1.2';
import { setLanguage, applyTranslations, t } from './i18n.js?v=1.1.2';
import { checkAuth, login, register, logout, openProfileModal, showToast, getUser, onAuthChanged, initProfileHandlers, openProfileSwitcherModal, getActiveProfile, isKidModeActive, updateFamilyHeaderUI, loginAsGuest, startTvDeviceCodeSession, stopTvDeviceCodeSession } from './auth.js?v=1.1.2';
import { fetchUserBookmarks, fetchContinueWatching, getLocalContinueWatching, removeFromLocalContinueWatching, isDismissedFromContinueWatching, fetchCustomLists, fetchCustomListDetails, deleteCustomListApi, createCustomCollection, addItemToCollection, removeItemFromCollection, saveBookmarkStatus, detectClientMediaType, detectClientYear, resolveMediaUserStatus } from './bookmarks.js?v=1.1.2';
import { getBaselineCatalog, searchBaselineCatalog } from './catalog-baseline.js?v=1.1.2';
import { getStatusIconSvg } from './status-icons.js?v=1.1.2';
import { initFormFactorEngine } from './form-factor.js?v=1.1.2';

// Ленивая подгрузка тяжёлых подсистем по требованию (Code-Splitting: -75% стартового JS)
const STORM_ASSET_VER = '1.1.2';

let _playerModLoaded = null;
let _playerModPromise = null;
const loadPlayerModule = () => (_playerModPromise ||= import(`./player.js?v=${STORM_ASSET_VER}`).then(m => (_playerModLoaded = m)));

const openPlayerModal = async (...args) => {
  const m = _playerModLoaded || await loadPlayerModule();
  return m.openPlayerModal(...args);
};
const closePlayerModal = (...args) => {
  if (_playerModLoaded) return _playerModLoaded.closePlayerModal(...args);
  document.getElementById('cinema-modal')?.classList.remove('is-open');
};
const setSleepTimer = async (...args) => {
  const m = _playerModLoaded || await loadPlayerModule();
  return m.setSleepTimer(...args);
};
const cancelSleepTimer = (...args) => {
  if (_playerModLoaded) return _playerModLoaded.cancelSleepTimer(...args);
};
const getSleepTimerRemaining = () => (_playerModLoaded ? _playerModLoaded.getSleepTimerRemaining() : 0);

function checkIfMediaIsSeries(media) {
  if (_playerModLoaded && typeof _playerModLoaded.checkIfMediaIsSeries === 'function') {
    return _playerModLoaded.checkIfMediaIsSeries(media);
  }
  if (!media) return false;
  const titleLower = String(media.title || media.name || '').toLowerCase();
  if (titleLower.includes('обитель зла') && (titleLower.includes('мутация') || titleLower.includes('вендетта') || titleLower.includes('вырождение') || titleLower.includes('проклятие') || titleLower.includes('остров смерти') || titleLower.includes('resident evil'))) {
    return false;
  }
  const isMonsterCartoonOrMovie = [
    'корпорация монстров', 'университет монстров', 'монстры на каникулах',
    'монстры против пришельцев', 'миньоны и монстры', 'монстр траки', 'монстро'
  ].some(m => titleLower === m || titleLower.startsWith(m + ' ') || titleLower.includes(m));
  const isExplicitSeriesTitle = !isMonsterCartoonOrMovie && (
    titleLower === 'монстры' || titleLower.startsWith('монстры ') || titleLower.startsWith('монстры:') ||
    titleLower === 'монстр' || titleLower.startsWith('монстр ') || titleLower.startsWith('монстр:') ||
    titleLower.includes('менталист') || titleLower.includes('the mentalist') ||
    titleLower.includes('дневники вампира') || titleLower.includes('vampire diaries') ||
    titleLower.includes('рик и морти') || titleLower.includes('rick and morty') ||
    titleLower.includes('гриффины') || titleLower.includes('симпсоны') || titleLower.includes('южный парк') ||
    /сезон\s*\d+/i.test(titleLower) || /\b(s\d+|season\s*\d+)\b/i.test(titleLower)
  );
  if (isExplicitSeriesTitle) return true;
  const isExplicitMovie = media.media_type === 'movie' || media.type === 'movie' ||
                          media.media_type === 'cartoon' || media.media_type === 'anime-movie' ||
                          media.category === 'Фильм' || media.category === 'фильм' ||
                          media.category === 'Мультфильм';
  if (isExplicitMovie) return false;
  if ((typeof media.seasons === 'number' && media.seasons > 1) ||
      (Array.isArray(media.seasons) && media.seasons.length > 1) ||
      (Array.isArray(media.episodes) && media.episodes.length > 1) ||
      (media.rutube_id && (media.seasons || media.episodes)) ||
      (parseInt(media.total_episodes, 10) || 0) > 1 ||
      (parseInt(media.episode, 10) || 0) > 1 ||
      (parseInt(media.season, 10) || 0) > 1 ||
      ((media.source === 'anilibria' || media.source === 'anixart') && media.media_type !== 'anime-movie')) {
    return true;
  }
  const linkStr = String(media.link || media.url || '');
  return media.media_type === 'series' || media.media_type === 'tv' ||
         media.media_type === 'cartoon-series' || media.media_type === 'anime-series' ||
         media.category === 'Сериал' || media.category === 'сериал' ||
         media.category === 'Аниме-сериал' || media.category === 'Мультсериал' ||
         linkStr.includes('serial') || linkStr.includes('fan-serials');
}

let _gamepadModPromise = null;
const loadGamepadTvModule = () => (_gamepadModPromise ||= import(`./gamepad-tv.js?v=${STORM_ASSET_VER}`));
const initGamepadAndTvMode = (...args) => loadGamepadTvModule().then(m => m.initGamepadAndTvMode(...args)).catch(() => {});
const toggleTvMode = (...args) => loadGamepadTvModule().then(m => m.toggleTvMode(...args)).catch(() => {});

let _voiceModPromise = null;
let _voiceCallbacks = null;
let _voiceInitialized = false;
const initVoiceAssistant = (callbacks) => {
  _voiceCallbacks = callbacks;
};
const toggleVoiceListening = async (...args) => {
  const m = await (_voiceModPromise ||= import(`./voice-assistant.js?v=${STORM_ASSET_VER}`));
  if (!_voiceInitialized && _voiceCallbacks) {
    _voiceInitialized = true;
    m.initVoiceAssistant(_voiceCallbacks);
  }
  return m.toggleVoiceListening(...args);
};

let _syncModPromise = null;
const renderSyncModalContent = (...args) => (_syncModPromise ||= import(`./sync-service.js?v=${STORM_ASSET_VER}`)).then(m => m.renderSyncModalContent(...args)).catch(() => {});

let _roomsModPromise = null;
const loadWatchTogetherModule = () => (_roomsModPromise ||= import(`./watch-together.js?v=${STORM_ASSET_VER}`));
const joinWatchRoom = (...args) => loadWatchTogetherModule().then(m => m.joinWatchRoom(...args));
const createWatchRoom = (...args) => loadWatchTogetherModule().then(m => m.createWatchRoom(...args));

let _recommenderModPromise = null;
const openNeuralRecommenderModal = (...args) => (_recommenderModPromise ||= import(`./neural-recommender.js?v=${STORM_ASSET_VER}`)).then(m => m.openNeuralRecommenderModal(...args)).catch(() => {});

let _calendarModPromise = null;
const loadCalendarModule = () => (_calendarModPromise ||= import(`./release-calendar.js?v=${STORM_ASSET_VER}`));
const openReleaseCalendarModal = (...args) => loadCalendarModule().then(m => m.openReleaseCalendarModal(...args)).catch(() => {});
const openLiveTvEpgModal = (...args) => loadCalendarModule().then(m => m.openLiveTvEpgModal(...args)).catch(() => {});

let _remoteModPromise = null;
const openRemoteQrModal = (...args) => (_remoteModPromise ||= import(`./storm-remote.js?v=${STORM_ASSET_VER}`)).then(m => m.openRemoteQrModal(...args)).catch(() => {});

let _adminModPromise = null;
const initAdminDashboard = () => {
  const adminBtn = document.getElementById('admin-dashboard-btn');
  if (adminBtn) {
    adminBtn.onclick = () => (_adminModPromise ||= import(`./admin-dashboard.js?v=${STORM_ASSET_VER}`)).then(m => m.openAdminDashboardModal()).catch(() => {});
  }
};

let _offlineModPromise = null;
const loadOfflineModule = () => (_offlineModPromise ||= import(`./offline-storage.js?v=${STORM_ASSET_VER}`));
const renderOfflineLibrary = (...args) => loadOfflineModule().then(m => m.renderOfflineLibrary(...args)).catch(() => {});
const saveMediaForOffline = (...args) => loadOfflineModule().then(m => m.saveMediaForOffline(...args)).catch(() => {});

let _updaterModPromise = null;
const checkForUpdates = (...args) => (_updaterModPromise ||= import(`./updater.js?v=${STORM_ASSET_VER}`)).then(m => m.checkForUpdates(...args)).catch(() => {});

let _achModPromise = null;
const trackClientAction = (action, meta) => (_achModPromise ||= import(`./achievements.js?v=${STORM_ASSET_VER}`)).then(m => m.trackClientAction?.(action, meta)).catch(() => {});

let currentTab = 'home';
let currentViewMode = localStorage.getItem('storm_view_mode') || 'grid';
let currentCardDensity = localStorage.getItem('storm_card_density') || 'normal';
let inPageQuickQuery = '';
let only4KQuickFilter = false;
let currentSource = 'all';
let currentSort = 'newest';
let currentGenre = 'all';
let currentCountry = 'all';
let currentYear = 'all';
let currentRating = 0;
let currentStatusFilter = 'all';
let currentBookmarkSubTab = 'all';
let cachedCustomLists = [];
let activeViewingCustomList = null;
let currentPage = 1;
let totalCatalogItems = 0;
let totalCatalogPages = 1;
let currentItems = [];
let rawCatalogItems = [];
let searchQuery = '';
let hoverPreviewTimer = null;
let hoverCloseTimer = null;
let cachedContinueHistory = null;
let isBottomNavInitialized = false;

export const clientTabCache = new Map();

export function getPersistentTabCache(key) {
  try {
    const raw = localStorage.getItem(`storm_cat_cache_v5_${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.items) && parsed.items.length > 0) {
      return parsed;
    }
  } catch {}
  return null;
}

export function setPersistentTabCache(key, data) {
  try {
    if (!data || !Array.isArray(data.items) || data.items.length === 0) return;
    const toSave = {
      items: data.items.slice(0, 30),
      totalItems: data.totalItems || data.items.length,
      totalPages: data.totalPages || 1,
      timestamp: Date.now()
    };
    localStorage.setItem(`storm_cat_cache_v5_${key}`, JSON.stringify(toSave));
  } catch {}
}

export async function refreshContinueWatchingCache() {
  try {
    cachedContinueHistory = await fetchContinueWatching();
  } catch {
    cachedContinueHistory = getLocalContinueWatching();
  }
  return cachedContinueHistory;
}

export function isStormNativeApp() {
  if (typeof window === 'undefined') return false;
  return /StormMultimediaApp/i.test(navigator.userAgent) ||
         window.location.protocol === 'file:' ||
         Boolean(window.StormNativeApp);
}

async function startStormApp() {
  window.__STORM_APP_BOOTED__ = true;
  try {
    if (isStormNativeApp()) {
      document.body.classList.add('is-native-app');
    }
    document.body.dataset.activeTab = currentTab || 'home';
  } catch (_) {}

  // 1. Немедленная инициализация темы и языка
  try { initTheme(); } catch (e) { console.warn('initTheme error:', e); }
  try { applyTranslations(); } catch (e) { console.warn('applyTranslations error:', e); }

  // 2. Мгновенная отрисовка каталога (baseline кэш или сохраненный снимок) до второстепенных модулей
  try {
    loadCurrentTab();
  } catch (e) {
    console.warn('Initial loadCurrentTab error:', e);
  }

  // 3. Отказоустойчивая инициализация подсистем интерфейса в изолированных error boundary
  try {
    document.body.dataset.cardDensity = currentCardDensity || 'standard';
  } catch (_) {}
  try { initPwaServiceWorker(); } catch (e) { console.warn('initPwaServiceWorker error:', e); }
  try { initViewModes(); } catch (e) { console.warn('initViewModes error:', e); }
  try { initTabs(); } catch (e) { console.warn('initTabs error:', e); }
  try { initBottomNav(); } catch (e) { console.warn('initBottomNav error:', e); }
  try { initFilterSheet(); } catch (e) { console.warn('initFilterSheet error:', e); }
  try { initCardActionSheet(); } catch (e) { console.warn('initCardActionSheet error:', e); }
  try { initSearch(); } catch (e) { console.warn('initSearch error:', e); }
  try { initLiveSearchSuggestions(); } catch (e) { console.warn('initLiveSearchSuggestions error:', e); }
  try { initStormTooltips(); } catch (e) { console.warn('initStormTooltips error:', e); }
  try { initScrollToTop(); } catch (e) { console.warn('initScrollToTop error:', e); }
  try {
    window.addEventListener('scroll', () => {
      if (typeof hideCardHoverPreview === 'function') hideCardHoverPreview();
    }, { passive: true });
  } catch (_) {}
  try { initFilterDropdowns(); } catch (e) { console.warn('initFilterDropdowns error:', e); }
  try { initModals(); } catch (e) { console.warn('initModals error:', e); }
  try { initProfileHandlers(); } catch (e) { console.warn('initProfileHandlers error:', e); }
  try { initStormCustomSelects(); } catch (e) { console.warn('initStormCustomSelects error:', e); }
  try { initLanguageSwitcher(); } catch (e) { console.warn('initLanguageSwitcher error:', e); }
  try { initNewCyberFeatures(); } catch (e) { console.warn('initNewCyberFeatures error:', e); }
  try { initAdminDashboard(); } catch (e) { console.warn('initAdminDashboard error:', e); }
  try { initDynamicMediaIsland(); } catch (e) { console.warn('initDynamicMediaIsland error:', e); }
  try { updateFamilyProfileHeader(); } catch (e) { console.warn('updateFamilyProfileHeader error:', e); }

  // Автоматическая динамическая предзагрузка и синхронизация истории и закладок из БД на старте
  try {
    Promise.allSettled([
      refreshContinueWatchingCache(),
      fetchUserBookmarks()
    ]).then(() => {
      lastRenderedHomeKey = '';
      syncAllRenderedCardsDynamicState();
      if (currentTab === 'home' && rawCatalogItems.length > 0) {
        renderHomeView(rawCatalogItems);
      } else if (rawCatalogItems.length > 0) {
        renderFilteredCatalog();
      }
    }).catch(() => {});
  } catch (_) {}

  try {
    onAuthChanged(() => {
      try { updateFamilyProfileHeader(); } catch (_) {}
      try { updateMobileDrawerUser(); } catch (_) {}
      Promise.allSettled([
        refreshContinueWatchingCache(),
        fetchUserBookmarks()
      ]).then(() => {
        lastRenderedHomeKey = '';
        syncAllRenderedCardsDynamicState();
        if (currentTab === 'bookmarks' || currentTab === 'continue') {
          loadCurrentTab();
        } else if (currentTab === 'home' && rawCatalogItems.length > 0) {
          renderHomeView(rawCatalogItems);
        } else {
          renderFilteredCatalog();
        }
      }).catch(() => {});
    });

    window.addEventListener('storm:dynamic-state-sync', () => {
      syncAllRenderedCardsDynamicState();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        Promise.allSettled([refreshContinueWatchingCache(), fetchUserBookmarks()])
          .then(() => syncAllRenderedCardsDynamicState())
          .catch(() => {});
      }
    });
  } catch (_) {}

  // Динамическое автоматическое обновление закладок и списков без перезагрузки
  try {
    window.addEventListener('storm:bookmarks-updated', (e) => {
      lastRenderedHomeKey = '';
      const isSearching = Boolean(searchQuery && searchQuery.trim().length >= 2);
      if (e.detail?.deleted) {
        const deletedId = String(e.detail.mediaId || '');
        const deletedTitle = normalizeMediaTitle(e.detail.title || '');
        rawCatalogItems.forEach(x => {
          if (String(x.id) === deletedId || (deletedTitle && normalizeMediaTitle(x.title, x.original_title) === deletedTitle)) {
            x.user_status = null;
          }
        });
        updateCardsInDOM(deletedId, e.detail.title, null, false);
      } else if (e.detail?.mediaData && e.detail?.status) {
        const updatedId = String(e.detail.mediaData.id || e.detail.mediaData.media_id);
        const updatedTitle = normalizeMediaTitle(e.detail.mediaData.title || '');
        const st = e.detail.status;
        rawCatalogItems.forEach(x => {
          if (String(x.id) === updatedId || (updatedTitle && normalizeMediaTitle(x.title, x.original_title) === updatedTitle)) {
            x.user_status = st;
          }
        });
        updateCardsInDOM(updatedId, e.detail.mediaData.title, st, st === 'completed');
      }

      if (!isSearching && (currentTab === 'bookmarks' || currentTab === 'continue')) {
        loadCurrentTab();
      } else if (currentTab === 'home' && rawCatalogItems.length > 0) {
        renderHomeView(rawCatalogItems);
      } else {
        renderFilteredCatalog();
      }
    });

    window.addEventListener('storm:series-status-changed', (e) => {
      const { mediaId, status } = e.detail || {};
      if (!mediaId || !status) return;
      lastRenderedHomeKey = '';
      const isSearching = Boolean(searchQuery && searchQuery.trim().length >= 2);
      rawCatalogItems.forEach(x => {
        if (String(x.id) === String(mediaId)) {
          x.user_status = status;
        }
      });
      updateCardsInDOM(mediaId, '', status, status === 'completed');

      if (!isSearching && (currentTab === 'bookmarks' || currentTab === 'continue')) {
        loadCurrentTab();
      } else if (currentTab === 'home' && rawCatalogItems.length > 0) {
        renderHomeView(rawCatalogItems);
      } else {
        renderFilteredCatalog();
      }
    });

    window.addEventListener('storm:continue-watching-updated', async () => {
      await refreshContinueWatchingCache();
      const isSearching = Boolean(searchQuery && searchQuery.trim().length >= 2);
      if (!isSearching) {
        if (currentTab === 'continue') {
          loadCurrentTab();
        } else if (currentTab === 'home' && rawCatalogItems.length > 0) {
          renderHomeView(rawCatalogItems);
        }
      }
    });
  } catch (_) {}

  try { checkAuth(); } catch (_) {}
  try { initDeepLinking(); } catch (_) {}

  // Фоновый прогрев модуля плеера после отрисовки витрины (мгновенное открытие карточек 0 мс)
  try {
    const scheduleIdle = window.requestIdleCallback || ((cb) => setTimeout(cb, 500));
    setTimeout(() => {
      scheduleIdle(() => { loadPlayerModule().catch(() => {}); });
    }, 450);
  } catch (_) {}

  // Автоматическая тихая проверка обновлений при старте
  try { setTimeout(() => checkForUpdates(false), 4500); } catch (_) {}
}

async function initDeepLinking() {
  try {
    const params = new URLSearchParams(window.location.search);
    const mediaId = params.get('media');
    if (!mediaId) return;

    const source = params.get('source') || 'tmdb';
    const season = params.get('season');
    const episode = params.get('episode');
    const player = params.get('player');
    const paramTitle = params.get('title');
    const paramYear = params.get('year');

    // 1. Проверяем сохраненный снимок открытого медиа в sessionStorage
    let cachedItem = null;
    try {
      const raw = sessionStorage.getItem('storm_active_cinema_media');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && (parsed.id === mediaId || String(parsed.id).includes(mediaId) || String(mediaId).includes(parsed.id))) {
          cachedItem = parsed;
        }
      }
    } catch (_) {}

    // 2. Проверяем базовый проверенный каталог
    if (!cachedItem && window.STORM_BASELINE_CATALOG) {
      for (const catList of Object.values(window.STORM_BASELINE_CATALOG)) {
        if (Array.isArray(catList)) {
          const found = catList.find(it => it.id === mediaId || String(it.id).includes(mediaId));
          if (found) {
            cachedItem = found;
            break;
          }
        }
      }
    }

    if (cachedItem) {
      openPlayerModal(cachedItem, { initialSeason: season, initialEpisode: episode, initialPlayer: player });
      return;
    }

    const headers = {};
    const token = localStorage.getItem('storm_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;

    let itemUrl = `/api/media/item?id=${encodeURIComponent(mediaId)}&source=${encodeURIComponent(source)}`;
    if (paramTitle) itemUrl += `&title=${encodeURIComponent(paramTitle)}`;
    if (paramYear) itemUrl += `&year=${encodeURIComponent(paramYear)}`;

    const res = await fetch(itemUrl, { headers });
    if (res.ok) {
      const item = await res.json();
      if (item && item.id) {
        openPlayerModal(item, { initialSeason: season, initialEpisode: episode, initialPlayer: player });
      }
    }
  } catch (err) {
    console.warn('Deep link initialization error:', err);
  }
}

// -------------------------------------------------------------
// ИНИЦИАЛИЗАЦИЯ РЕЖИМОВ ОТОБРАЖЕНИЯ (VIEW MODES)
// -------------------------------------------------------------
function initViewModes() {
  const container = document.getElementById('media-render-container');
  if (container) {
    container.className = `media-container view-${currentViewMode}`;
  }

  document.querySelectorAll('.view-mode-btn').forEach(btn => {
    const mode = btn.dataset.view;
    btn.classList.toggle('active', mode === currentViewMode);

    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-mode-btn').forEach(b => b.classList.toggle('active', b === btn));
      currentViewMode = mode;
      localStorage.setItem('storm_view_mode', mode);
      if (container) {
        container.className = `media-container view-${mode}`;
      }
      try {
        const itemsToRender = (currentItems && currentItems.length > 0) ? currentItems : (rawCatalogItems && rawCatalogItems.length > 0 ? rawCatalogItems : []);
        renderMediaItems(itemsToRender);
      } catch (err) {
        console.error('Ошибка переключения вида каталога:', err);
      }
    });
  });
}

// -------------------------------------------------------------
// ИНИЦИАЛИЗАЦИЯ ВКЛАДОК (QUICK TABS)
// -------------------------------------------------------------
function initTabs() {
  document.querySelectorAll('.storm-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      switchTab(tab);
    });
  });

  // Мобильная навигация
  document.querySelectorAll('.storm-mobile-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      switchTab(tab);
    });
  });
}

const CATEGORY_DEFAULT_PAGES = {
  'movies': 718,
  'series': 162,
  'cartoons': 35,
  'cartoon-series': 20,
  'anime-movies': 50,
  'anime-series': 50,
  'new': 50,
  'popular': 500,
  'home': 500
};

export function closeAllActiveModals() {
  document.querySelectorAll('.storm-modal-backdrop.is-open, .modal-backdrop.is-open').forEach(m => {
    m.classList.remove('is-open');
  });
  document.body.classList.remove('modal-open');
  if (typeof closePlayerModal === 'function') {
    closePlayerModal();
  }
}

const EXIT_MODAL_I18N = {
  ru: {
    title: 'Выход из STORM MULTIMEDIA',
    text: 'Вы действительно хотите выйти из приложения?',
    cancel: 'Отмена',
    confirm: 'Выйти'
  },
  en: {
    title: 'Exit STORM MULTIMEDIA',
    text: 'Are you sure you want to exit the application?',
    cancel: 'Cancel',
    confirm: 'Exit'
  },
  de: {
    title: 'STORM MULTIMEDIA beenden',
    text: 'Möchten Sie die Anwendung wirklich beenden?',
    cancel: 'Abbrechen',
    confirm: 'Beenden'
  },
  fr: {
    title: 'Quitter STORM MULTIMEDIA',
    text: 'Voulez-vous vraiment quitter l\'application ?',
    cancel: 'Annuler',
    confirm: 'Quitter'
  },
  zh: {
    title: '退出 STORM MULTIMEDIA',
    text: '您确定要退出应用程序吗？',
    cancel: '取消',
    confirm: '退出'
  },
  ja: {
    title: 'STORM MULTIMEDIA を終了',
    text: 'アプリケーションを終了してもよろしいですか？',
    cancel: 'キャンセル',
    confirm: '終了'
  }
};

export function showExitConfirmModal() {
  let modal = document.getElementById('storm-exit-confirm-modal');
  const lang = (localStorage.getItem('storm_selected_language') || 'ru').toLowerCase();
  const t = EXIT_MODAL_I18N[lang] || EXIT_MODAL_I18N.ru;

  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'storm-exit-confirm-modal';
    modal.className = 'storm-exit-modal-backdrop';
    modal.innerHTML = `
      <div class="storm-exit-modal-card" role="dialog" aria-modal="true">
        <div class="storm-exit-modal-icon">⚡</div>
        <div class="storm-exit-modal-title" id="storm-exit-modal-title">${t.title}</div>
        <div class="storm-exit-modal-text" id="storm-exit-modal-text">${t.text}</div>
        <div class="storm-exit-modal-actions">
          <button type="button" class="storm-exit-btn-cancel" id="storm-exit-btn-cancel">${t.cancel}</button>
          <button type="button" class="storm-exit-btn-confirm" id="storm-exit-btn-confirm">${t.confirm}</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeExitConfirmModal();
    });

    const cancelBtn = modal.querySelector('#storm-exit-btn-cancel');
    if (cancelBtn) {
      cancelBtn.onclick = () => closeExitConfirmModal();
    }

    const confirmBtn = modal.querySelector('#storm-exit-btn-confirm');
    if (confirmBtn) {
      confirmBtn.onclick = () => {
        closeExitConfirmModal();
        if (window.StormAndroidBridge && typeof window.StormAndroidBridge.exitApp === 'function') {
          window.StormAndroidBridge.exitApp();
        } else {
          window.close();
        }
      };
    }
  } else {
    const titleEl = modal.querySelector('#storm-exit-modal-title');
    const textEl = modal.querySelector('#storm-exit-modal-text');
    const cancelEl = modal.querySelector('#storm-exit-btn-cancel');
    const confirmEl = modal.querySelector('#storm-exit-btn-confirm');
    if (titleEl) titleEl.textContent = t.title;
    if (textEl) textEl.textContent = t.text;
    if (cancelEl) cancelEl.textContent = t.cancel;
    if (confirmEl) confirmEl.textContent = t.confirm;
  }

  modal.classList.add('is-open');
}

export function closeExitConfirmModal() {
  const modal = document.getElementById('storm-exit-confirm-modal');
  if (modal) {
    modal.classList.remove('is-open');
  }
}

export function handleStormBackNavigation() {
  // 1. Если открыто окно видеоплеера — закрываем его и остаемся в приложении
  const cinemaModal = document.getElementById('cinema-modal');
  if (cinemaModal && (cinemaModal.classList.contains('is-open') || document.body.classList.contains('cinema-open'))) {
    if (typeof closePlayerModal === 'function') {
      closePlayerModal();
    }
    return true;
  }

  // 2. Если открыт выпадающий список выбора источников в плеере
  const playerMenu = document.getElementById('player-source-menu');
  if (playerMenu && playerMenu.style.display === 'block') {
    playerMenu.style.display = 'none';
    const playerDropdown = document.getElementById('player-source-dropdown');
    if (playerDropdown) playerDropdown.classList.remove('is-open');
    document.body.classList.remove('player-dropdown-active');
    return true;
  }

  // 3. Если уже открыто окно подтверждения выхода — закрываем его
  const exitModal = document.getElementById('storm-exit-confirm-modal');
  if (exitModal && exitModal.classList.contains('is-open')) {
    closeExitConfirmModal();
    return true;
  }

  // 4. Закрываем активную мобильную шторку
  const drawer = document.getElementById('mobile-drawer-backdrop');
  if (drawer && drawer.classList.contains('is-open')) {
    closeMobileDrawer();
    return true;
  }

  // 5. Закрываем любые другие открытые модальные окна
  const openModals = document.querySelectorAll('.storm-modal-backdrop.is-open:not(#storm-exit-confirm-modal), .modal-backdrop.is-open, .storm-custom-dropdown.is-open');
  if (openModals.length > 0) {
    openModals.forEach(m => m.classList.remove('is-open'));
    document.body.classList.remove('modal-open');
    return true;
  }

  // 6. Если находимся не на главной вкладке — возвращаемся на главную
  if (currentTab && currentTab !== 'home') {
    switchTab('home');
    return true;
  }

  // 7. Главный экран: отображаем стилизованное окно с подтверждением выхода
  showExitConfirmModal();
  return true;
}

if (typeof window !== 'undefined') {
  window.handleStormBackNavigation = handleStormBackNavigation;
  window.showExitConfirmModal = showExitConfirmModal;
  window.closeExitConfirmModal = closeExitConfirmModal;

  // Защита кнопки «Назад» в браузере и PWA для всех вторичных модальных окон и мобильной шторки
  if (!window.__STORM_MODAL_HISTORY_GUARD_BOUND__) {
    window.__STORM_MODAL_HISTORY_GUARD_BOUND__ = true;
    let hasOverlayHistoryEntry = false;
    let isClosingOverlayViaBack = false;

    const getOpenSecondaryOverlays = () => Array.from(
      document.querySelectorAll('.modal-backdrop.is-open, .storm-modal-backdrop.is-open, #mobile-drawer-backdrop.is-open')
    ).filter(el => el.id !== 'cinema-modal' && el.id !== 'storm-exit-confirm-modal');

    // Инициализируем базовую корневую запись истории при открытии сайта без параметра ?media=
    try {
      if (!window.location.search.includes('media=')) {
        window.history.replaceState({ ...(window.history.state || {}), stormRoot: true }, '', window.location.href);
      }
    } catch (_) {}

    const syncOverlayHistoryState = () => {
      const openList = getOpenSecondaryOverlays();
      const cinemaOpen = Boolean(document.getElementById('cinema-modal')?.classList.contains('is-open'));
      if (openList.length > 0 && !cinemaOpen && !hasOverlayHistoryEntry) {
        try {
          if (!window.history.state || !window.history.state.stormRoot) {
            window.history.replaceState({ ...(window.history.state || {}), stormRoot: true }, '', window.location.href);
          }
          window.history.pushState({ stormOverlay: openList[openList.length - 1].id || 'modal' }, '', window.location.href);
          hasOverlayHistoryEntry = true;
        } catch (_) {}
      } else if (openList.length === 0 && hasOverlayHistoryEntry) {
        hasOverlayHistoryEntry = false;
        if (window.history.state && window.history.state.stormOverlay) {
          isClosingOverlayViaBack = true;
          try {
            window.history.back();
          } catch (_) {
            isClosingOverlayViaBack = false;
          }
          setTimeout(() => { isClosingOverlayViaBack = false; }, 160);
        }
      }
    };

    const attachModalObserver = () => {
      if (!document.body) return;
      const obs = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'attributes' && m.attributeName === 'class') {
            const t = m.target;
            if (t && t.id !== 'cinema-modal' && (
              t.classList?.contains('modal-backdrop') ||
              t.classList?.contains('storm-modal-backdrop') ||
              t.id === 'mobile-drawer-backdrop'
            )) {
              syncOverlayHistoryState();
              break;
            }
          }
        }
      });
      obs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', attachModalObserver, { once: true });
    } else {
      attachModalObserver();
    }

    window.addEventListener('popstate', () => {
      if (isClosingOverlayViaBack) {
        isClosingOverlayViaBack = false;
        return;
      }
      const openList = getOpenSecondaryOverlays();
      if (openList.length > 0) {
        hasOverlayHistoryEntry = false;
        const topModal = openList[openList.length - 1];
        topModal.classList.remove('is-open');
        if (getOpenSecondaryOverlays().length === 0) {
          document.body.classList.remove('modal-open');
        }
      }
    });
  }
}

export function switchTab(tab, options = {}) {
  closePlayerModal();
  closeAllActiveModals();
  closeMobileDrawer();
  currentTab = tab;
  document.body.dataset.activeTab = tab;
  currentPage = 1;
  inPageQuickQuery = '';
  const defPages = CATEGORY_DEFAULT_PAGES[tab] || 100;
  totalCatalogPages = defPages;
  totalCatalogItems = defPages * 20;

  if (tab !== 'home') {
    hideHeroShowcase();
  } else {
    const qBar = document.getElementById('storm-quick-catalog-bar');
    if (qBar) {
      qBar.style.display = 'none';
      qBar.innerHTML = '';
    }
  }

  if (tab === 'bookmarks') {
    resetAllFilters();
    currentBookmarkSubTab = options.subTab || 'all';
    activeViewingCustomList = null;
  } else {
    const bSubnav = document.getElementById('bookmarks-subnav-container');
    if (bSubnav) {
      bSubnav.style.display = 'none';
      bSubnav.innerHTML = '';
    }
  }

  // Тактильный виброотклик на смартфонах
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try { navigator.vibrate(10); } catch (_) {}
  }

  // Очищаем активный поисковый запрос при переключении категорий
  const searchInput = document.getElementById('global-search-input');
  if (searchInput && searchInput.value) {
    searchInput.value = '';
    searchQuery = '';
    const clearBtn = document.getElementById('search-clear-btn');
    if (clearBtn) clearBtn.classList.remove('is-visible');
  }

  document.querySelectorAll('.storm-tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });

  document.querySelectorAll('.storm-mobile-nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });

  // Синхронизация нижней панели навигации (Emby и Plex Dock)
  document.querySelectorAll('.storm-bottom-nav-item').forEach(b => {
    const bTab = b.dataset.bottomTab;
    let isActive = false;
    if (tab === 'home' && bTab === 'home') isActive = true;
    else if (['new', 'movies', 'series', 'cartoons', 'cartoon-series', 'anime-movies', 'anime-series', 'offline'].includes(tab) && bTab === 'catalog') isActive = true;
    else if (tab === 'bookmarks' && bTab === 'bookmarks') isActive = true;
    b.classList.toggle('active', isActive);
  });

  // При смене вкладки используем память, постоянный кэш или проверенный базовый каталог
  const targetCategory = tab === 'home' ? 'popular' : tab;
  const targetKey = `${targetCategory}_1_${currentSource}`;
  if (!clientTabCache.has(targetKey)) {
    const persistent = getPersistentTabCache(targetKey);
    if (persistent && Array.isArray(persistent.items) && persistent.items.length > 0) {
      clientTabCache.set(targetKey, persistent);
      rawCatalogItems = persistent.items;
      renderFilteredCatalog();
    } else {
      const baseline = getBaselineCatalog(targetCategory);
      if (baseline && baseline.length > 0) {
        rawCatalogItems = baseline;
        renderFilteredCatalog();
      } else {
        rawCatalogItems = [];
        renderSkeletonGrid();
      }
    }
  }

  loadCurrentTab();
}

if (typeof window !== 'undefined') {
  window.switchTab = switchTab;
  window.resetAllFilters = resetAllFilters;
  window.closeAllActiveModals = closeAllActiveModals;
}

function initBottomNav() {
  if (isBottomNavInitialized) return;
  isBottomNavInitialized = true;

  const syncBottomNavActive = (activeTab) => {
    document.querySelectorAll('.storm-bottom-nav-item').forEach(b => {
      b.classList.toggle('active', b.dataset.bottomTab === activeTab);
    });
  };

  let lastNavTriggerTime = 0;

  document.querySelectorAll('.storm-bottom-nav-item').forEach(btn => {
    btn.onclick = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }

      const now = Date.now();
      if (now - lastNavTriggerTime < 180) return;
      lastNavTriggerTime = now;

      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(15); } catch (_) {}
      }

      closeAllActiveModals();
      closeMobileDrawer();

      const tab = btn.dataset.bottomTab;
      if (tab === 'home') {
        switchTab('home');
        syncBottomNavActive('home');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (tab === 'catalog') {
        if (currentTab === 'home' || currentTab === 'bookmarks') {
          switchTab('movies');
        } else {
          const filterBtn = document.getElementById('mobile-filter-sheet-trigger');
          if (filterBtn) filterBtn.click();
        }
        syncBottomNavActive('catalog');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (tab === 'search') {
        const searchInput = document.getElementById('global-search-input');
        if (searchInput) {
          searchInput.focus();
          searchInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      } else if (tab === 'bookmarks') {
        switchTab('bookmarks');
        syncBottomNavActive('bookmarks');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (tab === 'more') {
        toggleMobileDrawer();
      }
    };
  });
}

// -------------------------------------------------------------
// ВСЕ ЖАНРЫ КАТАЛОГА МЕДИА (ALL CATALOG GENRES)
// -------------------------------------------------------------
export const ALL_CATALOG_GENRES = [
  { id: 'all', name: 'Все жанры', label: 'Все жанры', icon: '🎭' },
  { id: 'боевик', name: 'Боевик', label: 'Боевик', icon: '💥' },
  { id: 'комедия', name: 'Комедия', label: 'Комедия', icon: '😄' },
  { id: 'драма', name: 'Драма', label: 'Драма', icon: '🎭' },
  { id: 'фантастика', name: 'Фантастика', label: 'Фантастика', icon: '🚀' },
  { id: 'триллер', name: 'Триллер', label: 'Триллер', icon: '🔪' },
  { id: 'ужасы', name: 'Ужасы', label: 'Ужасы', icon: '👻' },
  { id: 'приключения', name: 'Приключения', label: 'Приключения', icon: '🧭' },
  { id: 'фэнтези', name: 'Фэнтези', label: 'Фэнтези', icon: '🧙' },
  { id: 'аниме', name: 'Аниме', label: 'Аниме', icon: '🌸' },
  { id: 'детектив', name: 'Детектив', label: 'Детектив', icon: '🕵️' },
  { id: 'мультфильм', name: 'Мультфильм', label: 'Мультфильм', icon: '🎨' },
  { id: 'семейный', name: 'Семейный', label: 'Семейный', icon: '👨‍👩‍👧' },
  { id: 'криминал', name: 'Криминал', label: 'Криминал', icon: '🔫' },
  { id: 'мелодрама', name: 'Мелодрама', label: 'Мелодрама', icon: '❤️' },
  { id: 'военный', name: 'Военный', label: 'Военный', icon: '🎖️' },
  { id: 'документальный', name: 'Документальный', label: 'Документальный', icon: '📽️' },
  { id: 'мистика', name: 'Мистика', label: 'Мистика', icon: '🔮' },
  { id: 'биография', name: 'Биография', label: 'Биография', icon: '📜' },
  { id: 'история', name: 'История', label: 'История', icon: '🏛️' },
  { id: 'спорт', name: 'Спорт', label: 'Спорт', icon: '🏆' },
  { id: 'мюзикл', name: 'Мюзикл', label: 'Мюзикл', icon: '🎵' },
  { id: 'музыка', name: 'Музыка', label: 'Музыка', icon: '🎶' },
  { id: 'вестерн', name: 'Вестерн', label: 'Вестерн', icon: '🤠' },
  { id: 'короткометражка', name: 'Короткометражка', label: 'Короткометражка', icon: '⏱️' },
  { id: 'фильм-нуар', name: 'Фильм-нуар', label: 'Фильм-нуар', icon: '🕶️' },
  { id: 'сказка', name: 'Сказка', label: 'Сказка', icon: '🦄' },
  { id: 'детский', name: 'Детский', label: 'Детский', icon: '🧸' },
  { id: 'реальное тв', name: 'Реальное ТВ', label: 'Реальное ТВ', icon: '📺' },
  { id: 'ток-шоу', name: 'Ток-шоу', label: 'Ток-шоу', icon: '🎙️' },
  { id: 'игра', name: 'Игра', label: 'Игра', icon: '🎮' }
];

export const ALL_CATALOG_COUNTRIES = [
  { id: 'all', name: 'Все страны', label: 'Все страны', icon: '🌍' },
  { id: 'foreign', name: 'Только зарубежные', label: 'Зарубежные', icon: '🌎' },
  { id: 'Россия', name: 'Россия / СССР', label: 'Россия', icon: '🇷🇺' },
  { id: 'США', name: 'США', label: 'США', icon: '🇺🇸' },
  { id: 'Великобритания', name: 'Великобритания', label: 'Великобритания', icon: '🇬🇧' },
  { id: 'Франция', name: 'Франция', label: 'Франция', icon: '🇫🇷' },
  { id: 'Южная Корея', name: 'Южная Корея', label: 'Южная Корея', icon: '🇰🇷' },
  { id: 'Япония', name: 'Япония', label: 'Япония', icon: '🇯🇵' },
  { id: 'Турция', name: 'Турция', label: 'Турция', icon: '🇹🇷' },
  { id: 'Германия', name: 'Германия', label: 'Германия', icon: '🇩🇪' },
  { id: 'Италия', name: 'Италия', label: 'Италия', icon: '🇮🇹' },
  { id: 'Испания', name: 'Испания', label: 'Испания', icon: '🇪🇸' },
  { id: 'Китай', name: 'Китай', label: 'Китай', icon: '🇨🇳' },
  { id: 'Канада', name: 'Канада', label: 'Канада', icon: '🇨🇦' },
  { id: 'Индия', name: 'Индия', label: 'Индия', icon: '🇮🇳' }
];

// -------------------------------------------------------------
// МОБИЛЬНАЯ ШТОРКА ФИЛЬТРОВ И СОРТИРОВКИ (FILTER BOTTOM SHEET)
// -------------------------------------------------------------
let currentFilterSheetSort = 'popular';
let currentFilterSheetRating = 0;
let currentFilterSheetYear = 'all';
let currentFilterSheetGenre = 'all';
let currentFilterSheetCountry = 'all';
let currentFilterSheetSource = 'all';

function initFilterSheet() {
  const trigger = document.getElementById('mobile-filter-sheet-trigger');
  const modal = document.getElementById('filter-sheet-modal');
  const closeBtn = document.getElementById('filter-sheet-close-btn');
  const resetBtn = document.getElementById('filter-sheet-reset-btn');
  const applyBtn = document.getElementById('filter-sheet-apply-btn');

  if (!modal) return;

  if (trigger) {
    trigger.addEventListener('click', () => {
      openFilterSheet();
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      closeFilterSheet();
    });
  }

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeFilterSheet();
    }
  });

  // Обработка чипов сортировки
  const sortContainer = document.getElementById('filter-sheet-sorts');
  if (sortContainer) {
    sortContainer.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        sortContainer.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('is-active'));
        chip.classList.add('is-active');
        currentFilterSheetSort = chip.dataset.sort || 'popular';
      });
    });
  }

  // Обработка чипов рейтинга
  const ratingContainer = document.getElementById('filter-sheet-ratings');
  if (ratingContainer) {
    ratingContainer.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        ratingContainer.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('is-active'));
        chip.classList.add('is-active');
        currentFilterSheetRating = parseFloat(chip.dataset.rating) || 0;
      });
    });
  }

  // Обработка чипов года
  const yearContainer = document.getElementById('filter-sheet-years');
  if (yearContainer) {
    yearContainer.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        yearContainer.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('is-active'));
        chip.classList.add('is-active');
        currentFilterSheetYear = chip.dataset.year || 'all';
      });
    });
  }

  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      const prevSource = currentSource;
      const prevCountry = currentCountry;
      currentSort = currentFilterSheetSort;
      currentRating = currentFilterSheetRating;
      currentYear = currentFilterSheetYear;
      currentGenre = currentFilterSheetGenre;
      currentCountry = currentFilterSheetCountry;
      currentSource = currentFilterSheetSource;

      syncDesktopFilterLabels();
      updateFilterBadge();
      closeFilterSheet();

      if (currentSource !== prevSource || currentCountry !== prevCountry) {
        currentPage = 1;
        loadCurrentTab();
      } else {
        renderFilteredCatalog();
      }
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      resetAllFilters();
      closeFilterSheet();
    });
  }
}

function openFilterSheet() {
  const modal = document.getElementById('filter-sheet-modal');
  if (!modal) return;
  populateFilterSheet();
  modal.style.display = 'flex';
  requestAnimationFrame(() => {
    modal.classList.add('is-open');
  });
}

function closeFilterSheet() {
  const modal = document.getElementById('filter-sheet-modal');
  if (!modal) return;
  modal.classList.remove('is-open');
  modal.style.display = 'none';
}

function populateFilterSheet() {
  currentFilterSheetSort = currentSort;
  currentFilterSheetRating = currentRating;
  currentFilterSheetYear = currentYear;
  currentFilterSheetGenre = currentGenre;
  currentFilterSheetCountry = currentCountry;
  currentFilterSheetSource = currentSource;

  const sortContainer = document.getElementById('filter-sheet-sorts');
  if (sortContainer) {
    sortContainer.querySelectorAll('.filter-chip').forEach(c => {
      c.classList.toggle('is-active', (c.dataset.sort || 'newest') === currentSort);
    });
  }

  const ratingContainer = document.getElementById('filter-sheet-ratings');
  if (ratingContainer) {
    ratingContainer.querySelectorAll('.filter-chip').forEach(c => {
      const r = parseFloat(c.dataset.rating) || 0;
      c.classList.toggle('is-active', r === currentRating);
    });
  }

  const yearContainer = document.getElementById('filter-sheet-years');
  if (yearContainer) {
    yearContainer.querySelectorAll('.filter-chip').forEach(c => {
      c.classList.toggle('is-active', (c.dataset.year || 'all') === currentYear);
    });
  }

  const countriesContainer = document.getElementById('filter-sheet-countries');
  if (countriesContainer) {
    countriesContainer.innerHTML = ALL_CATALOG_COUNTRIES.map(c => `
      <button type="button" class="filter-chip ${String(currentFilterSheetCountry).toLowerCase() === String(c.id).toLowerCase() ? 'is-active' : ''}" data-country="${c.id}">
        ${c.icon ? `<span class="filter-chip-icon">${c.icon}</span> ` : ''}${c.label || c.name}
      </button>
    `).join('');
    countriesContainer.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        countriesContainer.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('is-active'));
        chip.classList.add('is-active');
        currentFilterSheetCountry = chip.dataset.country || 'all';
      });
    });
  }

  const sourcesContainer = document.getElementById('filter-sheet-sources');
  if (sourcesContainer) {
    const sources = [
      { id: 'all', label: '🌐 Все источники' },
      { id: 'lift', label: '🚀 Lift 4K (Без рекламы)' },
      { id: 'rutube', label: '🔴 RuTube' },
      { id: 'vkvideo', label: '🔵 VK Видео' },
      { id: 'fanfilm4k', label: '🎬 FanFilm4K' },
      { id: 'tmdb', label: '⭐ TMDB' },
      { id: 'anixart', label: '🌸 AniXart' },
      { id: 'anilibria', label: '⚡ AniLibria' },
      { id: 'shikimori', label: '🎌 Shikimori' },
      { id: 'kodik', label: '🎥 Kodik' },
      { id: 'hdrezka', label: '🍿 HDRezka' },
      { id: 'collaps', label: '🎞️ Collaps' },
      { id: 'alloha', label: '📺 Alloha' },
      { id: 'videocdn', label: '📽️ VideoCDN' },
      { id: 'ashdi', label: '💎 Ashdi' },
      { id: 'vidsrc', label: '🌍 VidSrc' },
      { id: 'kinobaza', label: '🔥 Kinobaza' },
      { id: 'kinogo', label: '🎪 Kinogo' },
      { id: 'lostfilm', label: '🎬 LostFilm' },
      { id: 'redheadsound', label: '🎙️ RHS' },
      { id: 'animevost', label: '🌸 AnimeVost' },
      { id: 'webtorrent', label: '🧲 WebTorrent' },
      { id: 'rutracker', label: '🏴‍☠️ RuTracker' },
      { id: 'nnmclub', label: '⚡ NNM-Club' },
      { id: 'rutor', label: '🧲 Rutor' }
    ];
    sourcesContainer.innerHTML = sources.map(s => `
      <button type="button" class="filter-chip ${currentFilterSheetSource === s.id ? 'is-active' : ''}" data-source="${s.id}">${s.label}</button>
    `).join('');
    sourcesContainer.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        sourcesContainer.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('is-active'));
        chip.classList.add('is-active');
        currentFilterSheetSource = chip.dataset.source || 'all';
      });
    });
  }

  const genresContainer = document.getElementById('filter-sheet-genres');
  if (genresContainer) {
    const genreMap = new Map();
    ALL_CATALOG_GENRES.forEach(g => {
      genreMap.set(g.id.toLowerCase(), {
        id: g.id,
        label: g.label || g.name,
        icon: g.icon || '🎬'
      });
    });

    if (Array.isArray(rawCatalogItems) && rawCatalogItems.length > 0) {
      rawCatalogItems.forEach(item => {
        const itemGenres = Array.isArray(item.genres) ? item.genres : (typeof item.genres === 'string' ? item.genres.split(/[,/]/) : []);
        itemGenres.forEach(g => {
          if (typeof g === 'string') {
            const clean = g.trim();
            const id = clean.toLowerCase();
            if (id && !genreMap.has(id)) {
              genreMap.set(id, {
                id,
                label: clean.charAt(0).toUpperCase() + clean.slice(1),
                icon: '🎬'
              });
            }
          }
        });
      });
    }

    const allGenresList = Array.from(genreMap.values());
    genresContainer.innerHTML = allGenresList.map(g => `
      <button type="button" class="filter-chip ${currentFilterSheetGenre.toLowerCase() === g.id.toLowerCase() ? 'is-active' : ''}" data-genre="${g.id}">
        ${g.icon ? `<span class="filter-chip-icon">${g.icon}</span> ` : ''}${g.label}
      </button>
    `).join('');

    genresContainer.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        genresContainer.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('is-active'));
        chip.classList.add('is-active');
        currentFilterSheetGenre = chip.dataset.genre || 'all';
      });
    });
  }
}

function syncDesktopFilterLabels() {
  const genreLabel = document.getElementById('filter-genre-label');
  if (genreLabel) {
    genreLabel.textContent = currentGenre === 'all' ? t('filter_genre_all') : currentGenre.charAt(0).toUpperCase() + currentGenre.slice(1);
  }
  const countryLabel = document.getElementById('filter-country-label');
  if (countryLabel) {
    const foundCountry = ALL_CATALOG_COUNTRIES.find(c => String(c.id).toLowerCase() === String(currentCountry).toLowerCase());
    countryLabel.textContent = currentCountry === 'all' ? 'Все страны' : (foundCountry ? foundCountry.name : currentCountry);
  }
  const yearLabel = document.getElementById('filter-year-label');
  if (yearLabel) {
    yearLabel.textContent = currentYear === 'all' ? t('filter_year_all') : currentYear;
  }
  const ratingLabel = document.getElementById('filter-rating-label');
  if (ratingLabel) {
    ratingLabel.textContent = currentRating > 0 ? `★ ${currentRating}+` : t('filter_rating_all');
  }
  const sortLabel = document.getElementById('filter-sort-label');
  if (sortLabel) {
    const sortMap = {
      newest: t('sort_date') || t('sort_newest') || 'По дате',
      popular: t('sort_popular'),
      rating: t('sort_rating'),
      title: t('sort_title')
    };
    sortLabel.textContent = sortMap[currentSort] || t('sort_date') || 'По дате';
  }

  // Обновляем визуальный активный класс в выпадающих списках десктопа
  document.querySelectorAll('#filter-genre-list .storm-dropdown-item').forEach(el => {
    el.classList.toggle('is-active', el.dataset.value === currentGenre);
  });
  document.querySelectorAll('#filter-country-list .storm-dropdown-item').forEach(el => {
    el.classList.toggle('is-active', String(el.dataset.value).toLowerCase() === String(currentCountry).toLowerCase());
  });
  document.querySelectorAll('#filter-year-list .storm-dropdown-item').forEach(el => {
    el.classList.toggle('is-active', el.dataset.value === currentYear);
  });
  document.querySelectorAll('#filter-rating-list .storm-dropdown-item').forEach(el => {
    el.classList.toggle('is-active', Math.abs((parseFloat(el.dataset.value) || 0) - currentRating) < 0.01);
  });
  document.querySelectorAll('#filter-sort-list .storm-dropdown-item').forEach(el => {
    el.classList.toggle('is-active', el.dataset.value === currentSort);
  });
}

function updateFilterBadge() {
  const badge = document.getElementById('mobile-filter-count');
  if (!badge) return;
  let count = 0;
  if (currentGenre !== 'all') count++;
  if (currentCountry !== 'all') count++;
  if (currentYear !== 'all') count++;
  if (currentRating > 0) count++;
  if (currentSort !== 'newest') count++;

  if (count > 0) {
    badge.textContent = String(count);
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }
}

// -------------------------------------------------------------
// КОНТЕКСТНОЕ МЕНЮ КАРТОЧКИ (CARD ACTION SHEET)
// -------------------------------------------------------------
let currentActionItem = null;

function initCardActionSheet() {
  const modal = document.getElementById('card-action-sheet-modal');
  const closeBtn = document.getElementById('action-sheet-close-btn');
  const playBtn = document.getElementById('action-sheet-play-btn');
  const statusBtn = document.getElementById('action-sheet-status-btn');
  const roomBtn = document.getElementById('action-sheet-room-btn');
  const offlineBtn = document.getElementById('action-sheet-offline-btn');

  if (!modal) return;

  if (closeBtn) {
    closeBtn.addEventListener('click', () => closeCardActionSheet());
  }

  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.classList.contains('action-sheet-backdrop')) closeCardActionSheet();
  });

  if (playBtn) {
    playBtn.addEventListener('click', () => {
      if (currentActionItem) {
        closeCardActionSheet();
        openPlayerModal(currentActionItem);
      }
    });
  }

  if (roomBtn) {
    roomBtn.addEventListener('click', async () => {
      if (currentActionItem) {
        closeCardActionSheet();
        await createWatchRoom(currentActionItem);
      }
    });
  }

  if (offlineBtn) {
    offlineBtn.addEventListener('click', () => {
      if (currentActionItem) {
        closeCardActionSheet();
        showActionSheetToast('Загрузка в кеш для офлайн-просмотра начата');
      }
    });
  }

  const actionsContainer = modal.querySelector('.action-sheet-actions');
  if (actionsContainer && !modal.querySelector('#action-sheet-remove-continue-btn')) {
    const rmBtn = document.createElement('button');
    rmBtn.type = 'button';
    rmBtn.className = 'action-sheet-btn';
    rmBtn.id = 'action-sheet-remove-continue-btn';
    rmBtn.innerHTML = `
      <span class="action-sheet-btn-icon" style="color:#f43f5e;">✕</span>
      <div class="action-sheet-btn-text">
        <span class="action-sheet-btn-title">Убрать из «Продолжить просмотр»</span>
        <span class="action-sheet-btn-desc">Скрыть релиз из ленты продолжения просмотра</span>
      </div>
    `;
    rmBtn.addEventListener('click', () => {
      if (currentActionItem) {
        const itemToRemove = currentActionItem;
        closeCardActionSheet();
        removeMediaFromContinueWatching(itemToRemove);
      }
    });
    actionsContainer.appendChild(rmBtn);
  }
}

function openCardActionSheet(item) {
  currentActionItem = item;
  const modal = document.getElementById('card-action-sheet-modal');
  if (!modal || !item) return;

  const posterImg = document.getElementById('action-sheet-poster');
  const titleEl = document.getElementById('action-sheet-title');
  const subEl = document.getElementById('action-sheet-sub');

  const formattedTitle = formatMediaTitle(item);
  const isUpcomingSheet = isUpcomingMediaItem(item);
  const isReal4K = !isUpcomingSheet && (item.is4K === true || (item.quality && item.quality.includes('4K')));

  if (posterImg) {
    posterImg.src = item.poster || 'assets/favicon.svg';
    posterImg.alt = formattedTitle;
  }
  if (titleEl) {
    titleEl.textContent = formattedTitle;
  }
  if (subEl) {
    const metaParts = [
      item.year || '',
      isUpcomingSheet ? 'ОЖИДАЕТСЯ' : (isReal4K ? '4K UHD' : ''),
      item.rating ? `★ ${item.rating}` : '',
      getSourceName(item)
    ].filter(Boolean);
    subEl.textContent = metaParts.join(' • ');
  }

  const chipsContainer = document.getElementById('action-sheet-status-chips');
  if (chipsContainer) {
    const statuses = [
      { id: 'watching', label: 'Смотрю' },
      { id: 'planned', label: 'В планах' },
      { id: 'completed', label: 'Просмотрено' },
      { id: 'favorite', label: 'Любимое' },
      { id: 'on_hold', label: 'На паузе' },
      { id: 'dropped', label: 'Брошено' },
      { id: 'wont_watch', label: 'Не буду' },
      { id: 'none', label: 'Убрать статус' }
    ];

    chipsContainer.innerHTML = statuses.map(s => {
      const isActive = s.id === 'none' ? !item.user_status : (item.user_status === s.id || (s.id === 'planned' && item.user_status === 'plan') || (s.id === 'on_hold' && item.user_status === 'hold'));
      const iconContent = s.id === 'none'
        ? '<span style="font-size: 13px;">🗑️</span>'
        : getStatusIconSvg(s.id, { size: 14, animated: isActive });
      return `<button type="button" class="action-sheet-status-chip ${isActive ? 'active' : ''}" data-status="${s.id}"><span style="display:inline-flex;align-items:center;">${iconContent}</span> <span>${s.label}</span></button>`;
    }).join('');

    chipsContainer.querySelectorAll('.action-sheet-status-chip').forEach(chip => {
      chip.onclick = async (e) => {
        e.stopPropagation();
        const clickedStatus = chip.dataset.status;
        const finalStatus = (item.user_status === clickedStatus || clickedStatus === 'none') ? 'none' : clickedStatus;
        item.user_status = finalStatus === 'none' ? null : finalStatus;
        await saveBookmarkStatus(item, finalStatus);
        if (finalStatus === 'completed' || finalStatus === 'dropped' || finalStatus === 'wont_watch') {
          removeFromLocalContinueWatching(item.id || item.media_id, item.title);
          await refreshContinueWatchingCache();
        }
        showActionSheetToast(finalStatus === 'none' ? 'Удалено из закладок' : `Статус: ${getStatusLabel(finalStatus)}`);
        closeCardActionSheet();
        renderFilteredCatalog();
      };
    });
  }

  modal.style.display = 'flex';
  requestAnimationFrame(() => {
    modal.classList.add('is-open');
  });
}

function closeCardActionSheet() {
  const modal = document.getElementById('card-action-sheet-modal');
  if (!modal) return;
  modal.classList.remove('is-open');
  setTimeout(() => {
    if (!modal.classList.contains('is-open')) {
      modal.style.display = 'none';
    }
  }, 250);
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeFilterSheet();
    closeCardActionSheet();
  }
});

let catalogResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(catalogResizeTimer);
  catalogResizeTimer = setTimeout(() => {
    if (currentTab !== 'home' && currentTab !== 'offline') {
      renderFilteredCatalog();
    }
  }, 200);
});

function showActionSheetToast(msg) {
  const toast = document.createElement('div');
  toast.className = 'storm-action-toast';
  toast.style.position = 'fixed';
  toast.style.bottom = '80px';
  toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%)';
  toast.style.background = 'var(--bg-secondary)';
  toast.style.color = 'var(--text-primary)';
  toast.style.border = '1px solid var(--accent)';
  toast.style.boxShadow = '0 6px 20px rgba(0,0,0,0.6)';
  toast.style.borderRadius = '10px';
  toast.style.padding = '10px 18px';
  toast.style.zIndex = '9999';
  toast.style.fontSize = '13.5px';
  toast.style.fontWeight = '600';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s ease';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 2200);
}

// ==========================================
// RADIAL QUICK ACTION RING (КОЛЬЦЕВОЕ 3D МЕНЮ)
// ==========================================
let radialPortal = null;

export function openRadialActionRing(event, item) {
  if (!item) return;

  if (!radialPortal) {
    radialPortal = document.createElement('div');
    radialPortal.id = 'storm-radial-menu-portal';
    radialPortal.className = 'storm-radial-menu-portal';
    document.body.appendChild(radialPortal);
  }

  const clientX = (event.touches && event.touches[0]) ? event.touches[0].clientX : (event.clientX || window.innerWidth / 2);
  const clientY = (event.touches && event.touches[0]) ? event.touches[0].clientY : (event.clientY || window.innerHeight / 2);

  const menuRadius = 110;
  const posX = Math.max(menuRadius + 20, Math.min(window.innerWidth - menuRadius - 20, clientX));
  const posY = Math.max(menuRadius + 20, Math.min(window.innerHeight - menuRadius - 20, clientY));

  radialPortal.style.left = `${posX}px`;
  radialPortal.style.top = `${posY}px`;

  const posterSrc = item.poster || 'assets/favicon.svg';
  const cleanTitle = cleanVideoTitle(item.title || '');

  radialPortal.innerHTML = `
    <div class="radial-ring-backdrop" id="radial-ring-backdrop"></div>
    <div class="radial-ring-center">
      <img src="${posterSrc}" alt="${escapeHtml(cleanTitle)}" class="radial-center-thumb" onerror="this.src='assets/favicon.svg'">
      <div class="radial-center-title">${escapeHtml(cleanTitle)}</div>
    </div>
    <div class="radial-actions-wheel">
      <button type="button" class="radial-action-item action-watch" data-action="watch" title="Смотреть фильм или серию">
        <span class="radial-action-icon">🎬</span>
        <span class="radial-action-label">Смотреть</span>
      </button>
      <button type="button" class="radial-action-item action-remove-continue" data-action="remove-continue" title="Убрать из «Продолжить просмотр»">
        <span class="radial-action-icon">✕</span>
        <span class="radial-action-label">Убрать</span>
      </button>
      <button type="button" class="radial-action-item action-bookmark" data-action="bookmark" title="Добавить в закладки">
        <span class="radial-action-icon">🔖</span>
        <span class="radial-action-label">Закладки</span>
      </button>
      <button type="button" class="radial-action-item action-download" data-action="download" title="Сохранить в офлайн-память">
        <span class="radial-action-icon">💾</span>
        <span class="radial-action-label">Скачать</span>
      </button>
      <button type="button" class="radial-action-item action-share" data-action="share" title="Поделиться релизом">
        <span class="radial-action-icon">🔗</span>
        <span class="radial-action-label">Ссылка</span>
      </button>
    </div>
  `;

  radialPortal.classList.add('is-open');

  const closeRadial = () => {
    radialPortal.classList.remove('is-open');
  };

  const backdrop = radialPortal.querySelector('#radial-ring-backdrop');
  if (backdrop) backdrop.onclick = closeRadial;

  radialPortal.querySelectorAll('.radial-action-item').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      closeRadial();

      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(15); } catch (_) {}
      }

      switch (action) {
        case 'watch':
          openPlayerModal(item);
          break;
        case 'remove-continue':
          removeMediaFromContinueWatching(item);
          break;
        case 'trailer':
          openPlayerModal(item, { isTrailer: true });
          break;
        case 'bookmark':
          saveBookmarkStatus(item, 'planned');
          showToast(`«${cleanTitle}» добавлен в закладки «Буду смотреть»`, 'success');
          break;
        case 'download':
          saveMediaForOffline(item);
          break;
        case 'share':
          const shareUrl = `${window.location.origin}/#${encodeURIComponent(item.id || '')}`;
          if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(shareUrl).then(() => {
              showToast('🔗 Ссылка скопирована в буфер обмена', 'info');
            }).catch(() => {
              showToast('Не удалось скопировать ссылку', 'warning');
            });
          }
          break;
      }
    };
  });
}

function formatMediaTime(sec) {
  if (!sec || isNaN(sec)) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
}

export function renderSegmentedEpisodeBar(percent, totalEp = 8) {
  const segCount = Math.min(10, Math.max(6, totalEp || 8));
  const activeCount = Math.round((percent / 100) * segCount);
  let ticks = '';
  for (let i = 0; i < segCount; i++) {
    const isDone = i < activeCount;
    const isCurrent = i === activeCount && percent > 0 && percent < 100;
    const cls = isDone ? 'seg-done' : (isCurrent ? 'seg-current' : 'seg-unwatched');
    ticks += `<span class="segmented-tick ${cls}"></span>`;
  }
  return `
    <div class="media-card-segments-bar" title="${percent}% просмотрено">
      ${ticks}
    </div>
  `;
}

// ==========================================
// DYNAMIC MEDIA ISLAND (ПЛАВАЮЩИЙ 3D MINI-HUD)
// ==========================================
let dynamicIslandEl = null;

export function initDynamicMediaIsland() {
  if (dynamicIslandEl) return;

  dynamicIslandEl = document.createElement('div');
  dynamicIslandEl.id = 'storm-dynamic-media-island';
  dynamicIslandEl.className = 'storm-dynamic-media-island';
  dynamicIslandEl.innerHTML = `
    <div class="island-content">
      <div class="island-eq-anim">
        <span></span><span></span><span></span>
      </div>
      <img class="island-poster" src="assets/favicon.svg" alt="Постер">
      <div class="island-text-group">
        <div class="island-title" id="island-media-title">Воспроизведение...</div>
        <div class="island-time" id="island-media-time">00:00</div>
      </div>
      <div class="island-controls">
        <button type="button" class="island-ctrl-btn" id="island-play-btn" title="Пауза и воспроизведение">⏯</button>
        <button type="button" class="island-ctrl-btn" id="island-expand-btn" title="Развернуть кинотеатр">⤢</button>
      </div>
    </div>
  `;
  document.body.appendChild(dynamicIslandEl);

  const expandBtn = dynamicIslandEl.querySelector('#island-expand-btn');
  if (expandBtn) {
    expandBtn.onclick = () => {
      const modal = document.getElementById('cinema-modal');
      if (modal) {
        modal.classList.remove('is-mini-pip');
        modal.classList.add('is-open');
        hideDynamicMediaIsland();
      }
    };
  }

  const playBtn = dynamicIslandEl.querySelector('#island-play-btn');
  if (playBtn) {
    playBtn.onclick = () => {
      const v = document.getElementById('storm-video-player');
      if (v) {
        if (v.paused) v.play();
        else v.pause();
      }
    };
  }

  setInterval(() => {
    const modal = document.getElementById('cinema-modal');
    const v = document.getElementById('storm-video-player');
    const isModalOpen = modal?.classList.contains('is-open');
    const isMiniPip = modal?.classList.contains('is-mini-pip');
    const isPlaying = v && !v.paused && !v.ended;

    if (isPlaying && (isMiniPip || window.scrollY > 400)) {
      showDynamicMediaIsland(v);
    } else if (!isPlaying && !isMiniPip) {
      hideDynamicMediaIsland();
    }
  }, 1000);
}

function showDynamicMediaIsland(video) {
  if (!dynamicIslandEl) return;
  dynamicIslandEl.classList.add('is-visible');

  const titleEl = dynamicIslandEl.querySelector('#island-media-title');
  const timeEl = dynamicIslandEl.querySelector('#island-media-time');
  const modalTitle = document.getElementById('cinema-modal-title');

  if (titleEl && modalTitle) {
    titleEl.textContent = modalTitle.textContent || 'Воспроизведение';
  }
  if (video && timeEl) {
    timeEl.textContent = `${formatMediaTime(video.currentTime)} / ${formatMediaTime(video.duration || 0)}`;
  }
}

function hideDynamicMediaIsland() {
  if (dynamicIslandEl) dynamicIslandEl.classList.remove('is-visible');
}

let activeTabLoadSeq = 0;
let prefetchTimer = null;

export function areMediaListsEquivalent(a, b) {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const itemA = a[i];
    const itemB = b[i];
    if (String(itemA.id || itemA.media_id) !== String(itemB.id || itemB.media_id)) return false;
    if (itemA.title !== itemB.title) return false;
    if (itemA.user_status !== itemB.user_status) return false;
    if (itemA.progress_percent !== itemB.progress_percent) return false;
  }
  return true;
}

function buildCountryCatalogQuery(countryVal = currentCountry) {
  if (!countryVal || countryVal === 'all') return '';
  if (countryVal === 'foreign') {
    return `&exceptCountry=${encodeURIComponent('Россия')}`;
  }
  return `&country=${encodeURIComponent(countryVal)}`;
}

function scheduleNextPagePrefetch(cat, page, src) {
  clearTimeout(prefetchTimer);
  if (page >= totalCatalogPages) return;
  prefetchTimer = setTimeout(async () => {
    const countrySuffix = currentCountry && currentCountry !== 'all' ? `_${currentCountry}` : '';
    const nextKey = `${cat}_${page + 1}_${src}${countrySuffix}`;
    if (clientTabCache.has(nextKey)) return;
    try {
      const headers = {};
      const token = localStorage.getItem('storm_token');
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`/api/media/catalog?category=${cat}&page=${page + 1}&source=${src}${buildCountryCatalogQuery()}`, {
        headers,
        signal: AbortSignal.timeout(8000)
      });
      if (res.ok) {
        const data = await res.json();
        if (data.items && data.items.length > 0) {
          clientTabCache.set(nextKey, {
            items: deduplicateMediaList(data.items),
            totalItems: data.total_items || (totalCatalogPages * 20),
            totalPages: data.total_pages || totalCatalogPages
          });
        }
      }
    } catch {}
  }, 1200);
}

function renderSkeletonGrid() {
  const container = document.getElementById('media-render-container');
  if (!container) return;
  if (currentTab !== 'home') {
    hideHeroShowcase();
  } else {
    const heroContainer = document.getElementById('hero-showcase-container');
    if (heroContainer) {
      heroContainer.style.display = 'block';
      if (!heroContainer.querySelector('.hero-showcase')) {
        heroContainer.innerHTML = `
          <div class="hero-showcase hero-showcase-skeleton">
            <div class="hero-showcase-overlay"></div>
          </div>
        `;
      }
    }
  }
  let html = '';
  for (let i = 0; i < 14; i++) {
    html += `
      <div class="storm-skeleton-card">
        <div class="storm-skeleton-poster"></div>
        <div class="storm-skeleton-content">
          <div class="storm-skeleton-line"></div>
          <div class="storm-skeleton-line short"></div>
        </div>
      </div>
    `;
  }
  container.innerHTML = html;
}

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
  // Каноническое объединение франшизы «Звёздные Войны: Видения» (включая спин-офф/4-й сезон «Девятый джедай»)
  if (/^зв[её]здные\s+войны\s*:\s*видени[яе]/i.test(s)) {
    return 'Звёздные Войны: Видения';
  }
  if (/^star\s+wars\s*:\s*visions/i.test(s)) {
    return 'Star Wars: Visions';
  }
  // Хвостовые разделители
  s = s.replace(/[-–—/|•:]\s*$/, '').trim();
  return s.replace(/\s{2,}/g, ' ').trim();
}

export function isPlaceholderImage(url) {
  if (!url || typeof url !== 'string') return true;
  const lower = url.toLowerCase();
  return lower.includes('missing') || lower.includes('404') || lower.includes('placeholder') || lower.includes('default') || lower.includes('favicon.svg');
}

export function unwrapRawImageUrl(url) {
  if (!url || typeof url !== 'string') return '';
  let clean = url.trim();
  while (clean.includes('/api/media/image-proxy')) {
    const m = clean.match(/[?&]url=([^&]+)/);
    if (m) {
      try { clean = decodeURIComponent(m[1]); } catch { clean = m[1]; }
    } else {
      return '';
    }
  }
  while (clean.includes('wsrv.nl/?url=') || clean.includes('images.weserv.nl/?url=')) {
    const m = clean.match(/[?&]url=([^&]+)/);
    if (m) {
      try { clean = decodeURIComponent(m[1]); } catch { clean = m[1]; }
    } else {
      break;
    }
  }
  if (clean.startsWith('//')) clean = `https:${clean}`;
  const anixMatch = clean.match(/(?:s\d*\.)?anix(?:mirai|sekai)\.com\/posters\/([^/?#]+)/i);
  if (anixMatch) {
    const code = anixMatch[1].replace(/\.jpg$/i, '');
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(code);
    return isUuid
      ? `https://s3.anixmirai.com/posters/${code}.jpg`
      : `https://static.anixart.tv/posters/${code}.jpg`;
  }
  return clean;
}

export function generateSvgPosterDataUri(title = '') {
  const safeTitle = String(title || 'STORM MULTIMEDIA')
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
    .slice(0, 60);
  const words = safeTitle.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > 18 && lines.length < 3) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = (cur + ' ' + w).trim();
    }
  }
  if (cur) lines.push(cur);
  const textNodes = lines.map((ln, idx) =>
    `<text x="300" y="${500 + idx * 44}" text-anchor="middle" fill="#f8fafc" font-family="system-ui,sans-serif" font-size="32" font-weight="800">${ln}</text>`
  ).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900" width="600" height="900"><defs><linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#0b1120"/><stop offset="50%" stop-color="#131c33"/><stop offset="100%" stop-color="#070a12"/></linearGradient></defs><rect width="600" height="900" fill="url(#bg)"/><circle cx="300" cy="280" r="170" fill="#00d2ff" opacity="0.07"/><rect x="28" y="28" width="544" height="844" rx="24" fill="none" stroke="#00d2ff" stroke-opacity="0.28" stroke-width="2"/><text x="300" y="115" text-anchor="middle" fill="#00d2ff" font-family="system-ui,sans-serif" font-size="16" font-weight="800" letter-spacing="2">4K ULTRA HD</text><circle cx="300" cy="300" r="60" fill="#00d2ff" opacity="0.14" stroke="#00d2ff" stroke-opacity="0.45" stroke-width="2"/><polygon points="284,272 284,328 332,300" fill="#00d2ff"/>${textNodes}<text x="300" y="815" text-anchor="middle" fill="#64748b" font-family="system-ui,sans-serif" font-size="15" font-weight="700" letter-spacing="3">STORM MULTIMEDIA</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function handleGlobalImageError(imgEl) {
  if (!imgEl || imgEl.dataset.stormFallbackDone === '1') return;
  const rawUrl = imgEl.dataset.rawUrl || unwrapRawImageUrl(imgEl.getAttribute('src') || '');
  const title = imgEl.dataset.title || imgEl.getAttribute('alt') || '';
  const isLiftImg = rawUrl && rawUrl.includes('img.liftw.ws');

  if (rawUrl && rawUrl.startsWith('http') && !isLiftImg && !imgEl.dataset.triedWsrv) {
    imgEl.dataset.triedWsrv = '1';
    imgEl.src = `https://wsrv.nl/?url=${encodeURIComponent(rawUrl)}&w=500&q=85&output=webp`;
    return;
  }
  if (rawUrl && rawUrl.startsWith('http') && !isLiftImg && !imgEl.dataset.triedWeserv) {
    imgEl.dataset.triedWeserv = '1';
    imgEl.src = `https://images.weserv.nl/?url=${encodeURIComponent(rawUrl)}&w=500&q=85&output=webp`;
    return;
  }
  if (title && !imgEl.dataset.triedTitleProxy && window.__STORM_BACKEND_ONLINE__ !== false) {
    imgEl.dataset.triedTitleProxy = '1';
    imgEl.src = `/api/media/image-proxy?title=${encodeURIComponent(title.trim())}`;
    return;
  }
  imgEl.dataset.stormFallbackDone = '1';
  imgEl.onerror = null;
  if (imgEl.classList.contains('user-avatar') || imgEl.id === 'user-avatar-img') {
    imgEl.src = 'assets/avatar_default.svg';
  } else {
    imgEl.src = generateSvgPosterDataUri(title);
  }
}

if (typeof window !== 'undefined') {
  window.__stormHandleImgError = handleGlobalImageError;
  window.__stormGetSafePosterUrl = getSafePosterUrl;
  window.addEventListener('error', (e) => {
    const target = e?.target;
    if (target && target.tagName === 'IMG') {
      handleGlobalImageError(target);
    }
  }, true);
}

/**
 * Получение безопасного и гарантированно доступного URL обложки/постера.
 * Поддерживает как локальный прокси /api/media/image-proxy, так и прямую
 * глобальную CDN-доставку через wsrv.nl для автономной работы на Android и без бэкенда.
 */
export function getSafePosterUrl(url, title = '') {
  const cleanTitle = typeof title === 'string' ? title.trim() : '';
  if (!url || typeof url !== 'string' || isPlaceholderImage(url)) {
    if (cleanTitle.length >= 2) {
      if (window.__STORM_BACKEND_ONLINE__ === false) {
        return generateSvgPosterDataUri(cleanTitle);
      }
      return `/api/media/image-proxy?title=${encodeURIComponent(cleanTitle)}`;
    }
    return 'assets/favicon.svg';
  }
  let clean = url.trim();
  if (clean.startsWith('data:') || clean.startsWith('blob:') || clean.startsWith('assets/') || clean.startsWith('/assets/')) {
    return clean;
  }

  const unwrapped = unwrapRawImageUrl(clean);
  if (unwrapped) {
    clean = unwrapped;
  } else if (clean.startsWith('/api/media/image-proxy') || clean.startsWith('api/media/image-proxy')) {
    let proxyUrl = clean.startsWith('/') ? clean : `/${clean}`;
    if (cleanTitle && !proxyUrl.includes('title=')) {
      proxyUrl += (proxyUrl.includes('?') ? '&' : '?') + `title=${encodeURIComponent(cleanTitle)}`;
    }
    return proxyUrl;
  }

  if (clean.startsWith('//')) clean = `https:${clean}`;
  if (clean.startsWith('http://') || clean.startsWith('https://')) {
    const isLiftHost = clean.includes('img.liftw.ws') || clean.includes('lateremb.ws');
    const useDirectCdn = (isStormNativeApp() || window.__STORM_BACKEND_ONLINE__ === false) && !isLiftHost;
    if (useDirectCdn) {
      if (clean.includes('static.anixart.tv') || clean.includes('rutube.ru') || clean.includes('userapi.com') || clean.includes('mycdn.me')) {
        return clean;
      }
      return `https://wsrv.nl/?url=${encodeURIComponent(clean)}&w=500&q=85&output=webp`;
    }
    const titleParam = cleanTitle ? `&title=${encodeURIComponent(cleanTitle)}` : '';
    return `/api/media/image-proxy?url=${encodeURIComponent(clean)}${titleParam}`;
  }
  return clean;
}

export function getPosterSrcset(posterUrl) {
  return '';
}

export function getMediaCardImgHtml(posterUrl, title = '', extraClass = '') {
  const rawClean = unwrapRawImageUrl(posterUrl || '');
  const safePoster = getSafePosterUrl(posterUrl, title);
  const cleanTitle = escapeHtml(title || '');
  const safeRawAttr = escapeHtml(rawClean || '');
  const classAttr = extraClass ? ` class="${extraClass}"` : '';
  return `<img${classAttr} src="${safePoster}" data-raw-url="${safeRawAttr}" data-title="${cleanTitle}" alt="${cleanTitle}" loading="lazy" decoding="async" onerror="window.__stormHandleImgError && window.__stormHandleImgError(this)">`;
}

/**
 * Комплексная проверка медиа-элемента на стороне клиента на принадлежность к трейлерам/тизерам.
 * Полностью исключает появление любых карточек с трейлерами в каталогах, каруселях и закладках.
 */
// 100% динамический трекер ожидаемых премьер (без жёстко заданных списков ID или названий)
const _stormUpcomingIds = new Set();
try {
  if (localStorage.getItem('storm_upcoming_ids_rev') !== 'dynamic-v3') {
    localStorage.setItem('storm_upcoming_ids_rev', 'dynamic-v3');
    localStorage.removeItem('storm_upcoming_ids');
  }
} catch (_) {}

export function markMediaIdAsUpcoming(rawId) {
  if (!rawId) return;
  const fullId = String(rawId).trim();
  const cleanId = fullId.replace(/^tmdb_(?:up_|movie_|tv_|series_)?/i, '');
  _stormUpcomingIds.add(fullId);
  if (cleanId) _stormUpcomingIds.add(cleanId);
  try {
    localStorage.setItem('storm_upcoming_ids', JSON.stringify(Array.from(_stormUpcomingIds).slice(-300)));
  } catch (_) {}
  try {
    const selectors = [
      `.media-card[data-id="${CSS.escape(fullId)}"]`,
      cleanId ? `.media-card[data-id="${CSS.escape(cleanId)}"]` : '',
      cleanId ? `.media-card[data-id="tmdb_${CSS.escape(cleanId)}"]` : ''
    ].filter(Boolean).join(', ');
    if (selectors) {
      document.querySelectorAll(selectors).forEach(card => {
        const badgeWrap = card.querySelector('.media-card-badges');
        if (badgeWrap) {
          const old4k = badgeWrap.querySelector('.storm-badge-4k, .storm-badge-1080p');
          const upHtml = '<span class="storm-badge storm-badge-upcoming" style="background:rgba(245,158,11,0.22); border-color:#f59e0b; color:#fbbf24; font-weight:800; text-transform:uppercase;">ОЖИДАЕТСЯ</span>';
          if (old4k) {
            old4k.outerHTML = upHtml;
          } else if (!badgeWrap.querySelector('.storm-badge-upcoming')) {
            badgeWrap.insertAdjacentHTML('afterbegin', upHtml);
          }
        }
      });
    }
  } catch (_) {}
}
window.markMediaIdAsUpcoming = markMediaIdAsUpcoming;

export function isUpcomingMediaItem(item) {
  if (!item || typeof item !== 'object') return false;

  // 1. Динамический приоритет пользователя: если релиз уже просмотрен или начат — он НЕ «Ожидается»
  const resolvedUserSt = String(item.user_status || resolveMediaUserStatus(item) || '').toLowerCase().trim();
  if (['completed', 'watching', 'on_hold', 'dropped'].includes(resolvedUserSt) ||
      Number(item.progress_percent || 0) > 0 ||
      isMediaCardWatched(item)) {
    return false;
  }

  const yr = parseInt(item.year || getMediaYear(item), 10) || 0;
  const now = new Date();
  const currentYear = now.getFullYear();
  if (yr > currentYear) {
    return true;
  }

  // 2. Динамическая проверка даты премьеры по календарю реального времени
  const dateStr = String(item.release_date || item.first_air_date || item.premiere || '').trim();
  let parsedDate = null;
  if (dateStr && dateStr !== `${yr}-01-01`) {
    if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
      parsedDate = new Date(`${dateStr.substring(0, 10)}T23:59:59`);
    } else if (/^\d{2}\.\d{2}\.\d{4}$/.test(dateStr)) {
      const [dd, mm, yyyy] = dateStr.split('.');
      parsedDate = new Date(`${yyyy}-${mm}-${dd}T23:59:59`);
    }
    if (parsedDate && !isNaN(parsedDate.getTime()) && parsedDate > now) {
      return true;
    }
  }

  // 3. Наличие прямого рабочего потока или вышедших серий
  const hasDirectStream = Boolean(
    (item.fanfilm_4k_url && !String(item.fanfilm_4k_url).includes('do=search')) ||
    item.fanfilm_hd_url ||
    item.lift_id ||
    item.iframe_uri ||
    item.vk_embed_url ||
    (item.rutube_id && String(item.rutube_id).length > 15) ||
    item.source === 'fanfilm4k' ||
    item.source === 'lift' ||
    item.source === 'anilibria' ||
    Number(item.episodes_released || 0) > 0
  );
  if (hasDirectStream) {
    return false;
  }

  const statusLow = String(item.status || '').toLowerCase().trim();
  const votes = parseInt(item.vote_count, 10) || 0;
  const ratingVal = parseFloat(item.rating || item.rating_tmdb || item.rating_kp || 0) || 0;

  if (statusLow && ['planned', 'in production', 'post production', 'rumored', 'upcoming', 'anons', 'анонс', 'not yet aired', 'unreleased'].includes(statusLow)) {
    if (votes < 5) return true;
  }

  // 4. Если дата релиза уже наступила (<= сегодня) и есть голоса/рейтинг — фильм УЖЕ ВЫШЕЛ (игнорируем устаревшие флаги кэша)
  if (parsedDate && !isNaN(parsedDate.getTime()) && parsedDate <= now) {
    if (votes > 0 || ratingVal > 0 || ['released', 'вышел', 'returning series', 'ended'].includes(statusLow)) {
      return false;
    }
  }

  if ((item.source === 'anixart' || item.source === 'shikimori') && Number(item.episodes_released || 0) === 0 && statusLow !== 'вышел' && statusLow !== 'released' && (yr >= currentYear || /анонс|anons/i.test(statusLow))) {
    return true;
  }

  const rawId = String(item.id || item.tmdb_id || '').trim();
  const cleanId = rawId.replace(/^tmdb_(?:up_|movie_|tv_|series_)?/i, '');
  if ((rawId && _stormUpcomingIds.has(rawId)) || (cleanId && _stormUpcomingIds.has(cleanId))) {
    return true;
  }

  if (!parsedDate && votes === 0) {
    if (item.premiere && /ожидается|скоро|анонс/i.test(String(item.premiere))) return true;
    if (item.quality && /ожидается|скоро|анонс/i.test(String(item.quality))) return true;
  }

  if ((item.source === 'tmdb' || rawId.startsWith('tmdb_')) && yr >= currentYear && !parsedDate && votes === 0 && ratingVal === 0) {
    return true;
  }

  if (rawId.startsWith('tmdb_up_') && (!parsedDate || votes === 0)) {
    return true;
  }

  return Boolean((item.is_upcoming === true || item.isUpcoming === true) && !parsedDate && votes === 0 && ratingVal === 0);
}
window.isUpcomingMediaItem = isUpcomingMediaItem;

export function isTrailerMedia(item) {
  if (!item) return false;
  if (typeof item === 'object') {
    if (item.is_trailer) return true;
    if (item.quality && /трейлер/i.test(String(item.quality))) return true;
    if (/клэйфейс|clayface/i.test(String(item.title || '') + ' ' + String(item.original_title || ''))) return true;
  }

  const title = typeof item === 'string' ? item : (item.title || item.name || '');
  const originalTitle = typeof item === 'string' ? '' : (item.original_title || item.original_name || '');
  const description = typeof item === 'string' ? '' : (item.description || item.overview || '');
  const category = typeof item === 'string' ? '' : (item.category || '');
  const genres = Array.isArray(item.genres) ? item.genres.join(' ') : String(item.genres || '');
  const durationSec = parseInt(item.duration_seconds || item.durationSec || item.duration || 0, 10);
  const source = item.source || '';

  const cleanTitle = title.trim();
  const cleanOriginalTitle = originalTitle.trim();
  const combinedText = `${cleanTitle} ${cleanOriginalTitle} ${category} ${genres}`.toLowerCase();

  // 1. Прямые маркеры трейлеров и промо в названии или категории
  const trailerWordsRegex = /\b(трейлер[а-я]*|тизер[а-я]*|тизер-трейлер[а-я]*|тизерная|trailer[s]?|teaser[s]?|промо[- ]ролик[а-я]*|отрывок|фрагмент[а-я]*|бэкстейдж|backstage|making[- ]of|создание\s+фильма|как\s+создавался|история\s+создания|фильм\s+о\s+фильме|съемки|съёмки|клип[а-я]*|музыкальный[- ]клип[а-я]*|саундтрек|sneak[- ]peek|first[- ]look|featurette|фан[- ]трейлер[а-я]*|fan[- ]trailer[s]?|концепт[- ]трейлер[а-я]*|concept[- ]trailer[s]?)\b/i;

  if (trailerWordsRegex.test(cleanTitle) || trailerWordsRegex.test(cleanOriginalTitle) || trailerWordsRegex.test(category)) {
    return true;
  }

  // Маркеры в скобках, дефисах или составных фразах
  const subPatterns = [
    'трейлер', 'тизер', 'trailer', 'teaser',
    'промо-ролик', 'промо ролик', 'официальный трейлер', 'русский трейлер',
    'дублированный трейлер', 'финальный трейлер', 'тизер-трейлер', 'концепт-трейлер',
    'concept trailer', 'fan trailer', 'фан-трейлер', 'фан трейлер',
    'создание фильма', 'как создавался', 'история создания', 'фильм о фильме', 'making of',
    'обзор сериала', 'обзор фильма', 'обзор премьеры', 'разбор сериала', 'разбор фильма',
    'разбор концовки', 'разбор сюжета', 'лекция для сна', 'для сна', 'дата выхода',
    'когда выйдет', 'что известно', 'расписание выхода', 'простыми словами'
  ];
  for (const p of subPatterns) {
    if (combinedText.includes(p)) {
      return true;
    }
  }

  // Обзоры и разборы в начале названия
  if (/^(?:создание фильма|как создавался|история создания|фильм о фильме|обзор|разбор|пересказ|рекап|сюжет|подробный разбор|честный обзор)\b/i.test(cleanTitle)) {
    return true;
  }

  // 2. Фанатские концепт-трейлеры несуществующих фильмов
  const normTitle = cleanTitle.toLowerCase().replace(/[^a-zа-яё0-9]/gi, ' ').replace(/\s+/g, ' ').trim();
  const normOriginal = cleanOriginalTitle.toLowerCase().replace(/[^a-zа-яё0-9]/gi, ' ').replace(/\s+/g, ' ').trim();
  const hasSpiderman = normTitle.includes('человек паук') || normTitle.includes('spider man') || normOriginal.includes('spider man');
  const hasNewDay = normTitle.includes('новый день') || normTitle.includes('brand new day') || normTitle.includes('a new day') || normOriginal.includes('brand new day') || normOriginal.includes('a new day');
  if (hasSpiderman && hasNewDay) {
    return true;
  }
  if (
    normTitle.includes('человек паук новый день') ||
    normTitle.includes('человек паук 4 новый день') ||
    normTitle.includes('spider man brand new day') ||
    normTitle.includes('spider man a new day') ||
    normTitle.includes('spider man 4 new day') ||
    normOriginal.includes('brand new day') ||
    normOriginal.includes('a new day')
  ) {
    return true;
  }

  // 2.5 Игрофильмы, прохождения игр и геймплей-ролики
  const author = (typeof item.author === 'string' ? item.author : '').toLowerCase();
  const gameFootagePatterns = ['игрофильм', 'игро фильм', 'геймплей', 'gameplay', 'walkthrough', 'прохождение игры', 'прохождение без комментариев', 'летсплей', 'letsplay'];
  for (const gp of gameFootagePatterns) {
    if (combinedText.includes(gp) || author.includes(gp)) {
      return true;
    }
  }
  if ((source === 'rutube' || source === 'vkvideo') && genres.toLowerCase().includes('видеоигры')) {
    return true;
  }

  // 3. Проверка длительности для RuTube и VK Видео: видео короче 10 минут (600 сек)
  if ((source === 'rutube' || source === 'vkvideo') && durationSec > 0 && durationSec < 600) {
    const isEpisode = /сери|сезон|эпизод|выпуск/i.test(cleanTitle);
    if (!isEpisode) {
      return true;
    }
  }

  // 4. Описание, указывающее на трейлер
  if (description) {
    const descLower = description.toLowerCase();
    if (
      descLower.startsWith('трейлер') ||
      descLower.startsWith('тизер') ||
      descLower.startsWith('официальный трейлер') ||
      descLower.startsWith('русский трейлер') ||
      descLower.startsWith('дублированный трейлер') ||
      /\b(смотреть трейлер|смотрите трейлер|официальный дублированный трейлер|главный трейлер|тизер-трейлер)\b/i.test(descLower)
    ) {
      if (durationSec > 0 && durationSec < 900) return true;
      if (descLower.length < 220 && (descLower.includes('трейлер') || descLower.includes('тизер'))) return true;
    }
  }

  return false;
}

export function formatMediaTitle(item) {
  if (!item) return '';
  let rawTitle = cleanVideoTitle(item.title || item.original_title || '');

  // Извлечение года с проверкой известных фильмов с числами/годами в названии
  const lowerCheck = `${item.title || ''} ${item.original_title || ''}`.toLowerCase();
  const KNOWN_TITLE_YEARS = {
    'бегущий по лезвию 2049': '2017',
    'blade runner 2049': '2017',
    'бегущий по лезвию': '1982',
    'космическая одиссея 2001': '1968',
    '2001: космическая одиссея': '1968',
    '2010: год вступления в контакт': '1984',
    '2012': '2009',
    '1917': '2019',
    '1922': '2017',
    '1941': '1979',
    '1944': '2015',
    '1984': '1984',
    '1408': '2007',
    'киберпанк 2077': '2022',
    'смертельная гонка 2000': '1975'
  };

  let itemYear = item.year ? String(item.year).trim() : '';

  for (const [k, y] of Object.entries(KNOWN_TITLE_YEARS)) {
    if (lowerCheck.includes(k)) {
      itemYear = y;
      break;
    }
  }

  const yearMatch = rawTitle.match(/\((\d{4})\)/);
  if ((!itemYear || itemYear === '0' || itemYear === '—' || itemYear === '2049') && yearMatch) {
    const pYear = parseInt(yearMatch[1], 10);
    if (pYear >= 1920 && pYear <= 2028) itemYear = yearMatch[1];
  }
  if (!itemYear || itemYear === '0' || itemYear === '—' || itemYear === '2049') {
    const ym = `${item.title || ''} ${item.original_title || ''}`.match(/\b(19\d\d|20\d\d)\b/);
    if (ym) {
      const yrNum = parseInt(ym[1], 10);
      if (yrNum >= 1920 && yrNum <= 2028) itemYear = ym[1];
    }
  }
  if (itemYear && itemYear !== '0' && itemYear !== '—') {
    item.year = itemYear;
  }

  // Очищаем скобки с годом из заголовка, так как год отображается в строке метаданных карточки
  rawTitle = rawTitle.replace(/\s*\(\d{4}\)\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();

  return rawTitle;
}

export function isAnimeItemClient(item) {
  if (!item) return false;
  if (['anixart', 'shikimori', 'anilibria', 'animevost'].includes(item.source)) return true;
  if (item.media_type === 'anime-movie' || item.media_type === 'anime-series' || item.media_type === 'anime') return true;
  if (item.original_language === 'ja') return true;
  if (Array.isArray(item.origin_country) && item.origin_country.includes('JP')) return true;
  if (typeof item.country === 'string' && /япон|japan/i.test(item.country)) return true;
  if (Array.isArray(item.countries) && item.countries.some(c => /япон|japan/i.test(String(c)))) return true;
  if (/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(item.original_title || '')) return true;

  const link = (item.link || item.url || '').toLowerCase();
  if (link.includes('-anime.html') || link.includes('/anime/') || link.includes('anime')) return true;
  if (typeof item.category === 'string' && item.category.toLowerCase().includes('аниме')) return true;

  const title = `${item.title || ''} ${item.original_title || ''}`.toLowerCase();
  const animeKeywords = [
    'аниме', 'anime',
    'человек-бензопила', 'chainsaw man', 'резе', 'reze',
    'сад изящных слов', 'garden of words', 'kotonoha no niwa',
    'призрак в доспехах', 'ghost in the shell',
    'война рохирримов', 'war of the rohirrim',
    'клинок, рассекающий', 'клинок рассекающий', 'demon slayer', 'kimetsu',
    'атака титанов', 'attack on titan', 'shingeki',
    'магическая битва', 'jujutsu kaisen',
    'форма голоса', 'silent voice', 'koe no katachi',
    'твоё имя', 'твое имя', 'your name', 'kimi no na wa',
    'дитя погоды', 'weathering with you',
    'судзумэ', 'suzume',
    'ходячий замок', 'howl\'s moving castle',
    'унесённые призраками', 'унесенные призраками', 'spirited away',
    'мой сосед тоторо', 'my neighbor totoro',
    'принцесса мононоке', 'princess mononoke',
    'ветер крепчает', 'wind rises',
    'навсикая', 'nausicaa',
    'могила светлячков', 'grave of the fireflies',
    'шепот сердца', 'шёпот сердца', 'whisper of the heart',
    'рыбка поньо', 'ponyo',
    'акира', 'akira',
    'евангелион', 'evangelion',
    'ван-пис', 'ван пис', 'one piece',
    'наруто', 'naruto', 'боруто', 'boruto',
    'блич', 'bleach',
    'тетрадь смерти', 'death note',
    'берсерк', 'berserk',
    'врата штейна', 'steins;gate',
    'ковбой бибоп', 'cowboy bebop',
    'хвост феи', 'fairy tail',
    'семья шпиона', 'spy x family',
    'дандадан', 'dandadan',
    'кайджу № 8', 'кайджу 8', 'kaiju no. 8',
    'гинтама', 'gintama',
    'хантер х хантер', 'hunter x hunter',
    'чёрный клевер', 'черный клевер', 'black clover',
    'сейлор мун', 'sailor moon',
    'токийский гуль', 'tokyo ghoul'
  ];

  if (animeKeywords.some(kw => title.includes(kw))) return true;

  const genres = Array.isArray(item.genres) ? item.genres : (typeof item.genres === 'string' ? item.genres.split(',') : []);
  if (genres.some(g => typeof g === 'string' && /аниме|anime/i.test(g))) return true;

  return false;
}

async function loadCurrentTab() {
  const container = document.getElementById('media-render-container');
  if (!container) return;

  if (currentTab !== 'home') {
    hideHeroShowcase();
  }

  if (currentTab === 'offline') {
    renderOfflineLibrary(container);
    return;
  }

  if (currentTab === 'continue') {
    renderSkeletonGrid();
    const history = await fetchContinueWatching();
    cachedContinueHistory = history;
    const excludedStatuses = ['completed', 'dropped', 'wont_watch'];
    const seenContinueTabTitles = new Set();
    const rawItems = (history || [])
      .filter(h => {
        if (!h || (!h.media_id && !h.id) || !h.title) return false;
        if (isDismissedFromContinueWatching(h.media_id || h.id, h.title)) return false;
        const normK = normalizeMediaTitle(h.title || '');
        if (normK) {
          if (seenContinueTabTitles.has(normK)) return false;
          seenContinueTabTitles.add(normK);
        }
        const titleStr = String(h.title || '');
        if (titleStr.includes('FANFILM4K') || titleStr.includes('ФАН4К –') || titleStr.includes('4К UHD бесплатно')) return false;

        const status = h.bookmark_status || h.user_status || h.status || '';
        if (excludedStatuses.includes(status)) return false;

        const pct = typeof h.progress_percent === 'number' ? h.progress_percent : 0;
        if (pct >= 95) return false;

        // Строгая фильтрация: только РЕАЛЬНЫЙ просмотр (прогресс от 2% и время от 60 секунд, либо 2+ серия)
        const sec = typeof h.time_seconds === 'number' ? h.time_seconds : (h.last_time_seconds || 0);
        const ep = parseInt(h.episode, 10) || 1;
        const hasRealProgress = (pct >= 2.0 && sec >= 60) || (pct >= 5.0) || (ep > 1);

        return hasRealProgress;
      })
      .map(h => ({
        id: h.media_id || h.id,
        source: h.source || 'tmdb',
        title: h.title,
        poster: h.poster_url || h.poster,
        media_type: h.media_type || 'movie',
        year: h.year || '',
        progress_percent: Math.round(h.progress_percent || 0),
        user_status: (h.user_status === 'watching' || h.bookmark_status === 'watching') ? 'watching' : (h.user_status || h.bookmark_status || null),
        season: h.season || 1,
        episode: h.episode || 1
      }));
    rawCatalogItems = deduplicateMediaList(rawItems);
    renderFilteredCatalog();
    return;
  }

  if (currentTab === 'bookmarks') {
    renderSkeletonGrid();
    try {
      const [bookmarks, customLists] = await Promise.all([
        fetchUserBookmarks().catch(() => []),
        fetchCustomLists().catch(() => [])
      ]);
      cachedCustomLists = Array.isArray(customLists) ? customLists : [];
      const rawItems = (bookmarks || []).map(b => ({
        id: b.media_id,
        source: b.source,
        title: b.title,
        original_title: b.original_title,
        poster: getSafePosterUrl(b.poster_url, b.title),
        media_type: b.media_type,
        year: b.year || '',
        user_status: b.status,
        is_favorite: (b.is_favorite === 1 || b.is_favorite === true || b.status === 'favorite') ? 1 : 0,
        progress_percent: b.progress_percent,
        episodes_watched: b.episodes_watched,
        total_episodes: b.total_episodes,
        updated_at: b.updated_at
      }));
      rawCatalogItems = deduplicateMediaList(rawItems);
    } catch (err) {
      console.warn('Error loading bookmarks:', err);
      rawCatalogItems = [];
      cachedCustomLists = [];
    }
    renderFilteredCatalog();
    return;
  }

  // Каталог медиа - мгновенная отдача из кэша + фоновое обновление
  let category = currentTab;
  if (currentTab === 'home') category = 'popular';
  const defPages = CATEGORY_DEFAULT_PAGES[category] || 100;
  if (currentPage > defPages) {
    currentPage = defPages;
  }
  const countrySuffix = currentCountry && currentCountry !== 'all' ? `_${currentCountry}` : '';
  const cacheKey = `${category}_${currentPage}_${currentSource}${countrySuffix}`;
  const loadSeq = ++activeTabLoadSeq;

  if (clientTabCache.has(cacheKey)) {
    const cached = clientTabCache.get(cacheKey);
    let items = Array.isArray(cached) ? cached : (cached?.items || []);
    if (currentPage > 1) {
      items = filterPageDuplicates(items, category, currentPage);
    }
    rawCatalogItems = items;
    totalCatalogPages = Math.min(defPages, cached?.totalPages || defPages);
    totalCatalogItems = cached?.totalItems || (totalCatalogPages * 20);
    renderFilteredCatalog();
    scheduleNextPagePrefetch(category, currentPage, currentSource);
  } else {
    const persistent = currentPage === 1 ? getPersistentTabCache(cacheKey) : null;
    if (persistent && Array.isArray(persistent.items) && persistent.items.length > 0) {
      clientTabCache.set(cacheKey, persistent);
      rawCatalogItems = persistent.items;
      totalCatalogPages = Math.min(defPages, persistent.totalPages || defPages);
      totalCatalogItems = persistent.totalItems || (totalCatalogPages * 20);
      renderFilteredCatalog();
      scheduleNextPagePrefetch(category, currentPage, currentSource);
    } else {
      const baseline = getBaselineCatalog(category);
      if (baseline && baseline.length > 0 && currentCountry === 'all') {
        rawCatalogItems = baseline;
        renderFilteredCatalog();
      } else {
        rawCatalogItems = [];
        renderSkeletonGrid();
      }
    }
  }

  try {
    const headers = {};
    const token = localStorage.getItem('storm_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`/api/media/catalog?category=${category}&page=${currentPage}&source=${currentSource}${buildCountryCatalogQuery()}`, {
      headers,
      signal: AbortSignal.timeout(12000)
    });
    const data = await res.json();
    if (loadSeq !== activeTabLoadSeq) return; // Устаревший запрос отменён

    const fetchedItems = data.items || [];
    totalCatalogPages = Math.min(defPages, data.total_pages || defPages);
    totalCatalogItems = data.total_items || (totalCatalogPages * 20);

    if (fetchedItems.length > 0) {
      let cleanList = deduplicateMediaList(fetchedItems);
      if (currentPage > 1) {
        cleanList = filterPageDuplicates(cleanList, category, currentPage);
      }
      const wasEquivalent = areMediaListsEquivalent(rawCatalogItems, cleanList);
      rawCatalogItems = cleanList;
      clientTabCache.set(cacheKey, { items: rawCatalogItems, totalItems: totalCatalogItems, totalPages: totalCatalogPages });
      if (currentPage === 1) {
        setPersistentTabCache(cacheKey, { items: rawCatalogItems, totalItems: totalCatalogItems, totalPages: totalCatalogPages });
      }
      if (!wasEquivalent) {
        renderFilteredCatalog();
      }
      scheduleNextPagePrefetch(category, currentPage, currentSource);
    } else {
      // Если по текущему источнику 0 элементов, пробуем сводный каталог
      try {
        const retryRes = await fetch(`/api/media/catalog?category=${category}&page=${currentPage}&source=all${buildCountryCatalogQuery()}`, {
          headers,
          signal: AbortSignal.timeout(8000)
        });
        const retryData = await retryRes.json();
        if (loadSeq !== activeTabLoadSeq) return;

        if (retryData.items && retryData.items.length > 0) {
          let retryList = deduplicateMediaList(retryData.items);
          if (currentPage > 1) {
            retryList = filterPageDuplicates(retryList, category, currentPage);
          }
          rawCatalogItems = retryList;
          totalCatalogPages = Math.min(defPages, retryData.total_pages || defPages);
          totalCatalogItems = retryData.total_items || (totalCatalogPages * 20);
          clientTabCache.set(cacheKey, { items: rawCatalogItems, totalItems: totalCatalogItems, totalPages: totalCatalogPages });
          if (currentPage === 1) {
            setPersistentTabCache(cacheKey, { items: rawCatalogItems, totalItems: totalCatalogItems, totalPages: totalCatalogPages });
          }
          renderFilteredCatalog();
          scheduleNextPagePrefetch(category, currentPage, currentSource);
          return;
        }
      } catch {}

      if (loadSeq !== activeTabLoadSeq) return;
      if (!rawCatalogItems || rawCatalogItems.length === 0) {
        if (currentPage > totalCatalogPages) {
          currentPage = totalCatalogPages;
          loadCurrentTab();
          return;
        }
        renderFilteredCatalog();
      }
    }
  } catch (err) {
    if (loadSeq !== activeTabLoadSeq) return;
    if (!rawCatalogItems || rawCatalogItems.length === 0) {
      renderFilteredCatalog();
    }
  }
}

// Нормализация названий медиа для надежного сопоставления и исключения дублей
function normalizeMediaTitle(title, originalTitle = '') {
  if (!title && !originalTitle) return '';
  const clean = (t) => {
    if (!t) return '';
    let raw = cleanVideoTitle(t);
    let s = String(raw).toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/\s*[\(\[][^\)\]]*[\)\]]/gi, ' ')
      .replace(/[«»“”"'`]/g, ' ')
      .replace(/^\s*\(?(?:сериал|фильм|серия|т\/с|д\/ф|м\/ф|м\/с)\)?\s*[:\-–—]?\s*/gi, '')
      .replace(/(?<!\p{L})(?:часть\s+первая|part\s+one|part\s+i)(?!\p{L})/giu, ' 1 ')
      .replace(/(?<!\p{L})(?:часть\s+вторая|part\s+two|part\s+ii)(?!\p{L})/giu, ' 2 ')
      .replace(/(?<!\p{L})(?:часть\s+третья|part\s+three|part\s+iii)(?!\p{L})/giu, ' 3 ')
      .replace(/(?<!\p{L})(?:часть\s+четвертая|part\s+four|part\s+iv)(?!\p{L})/giu, ' 4 ')
      .replace(/(?<!\p{L})(?:\d+\s*сезон[а-я]*|\d+\s*сери[а-я]*|сезон[а-я]*\s*\d+|сери[а-я]*\s*\d+|s\d+\s*e\d+|s\d+|e\d+)(?!\p{L})/giu, ' ')
      .replace(/(?<!\p{L})(?:19\d\d|20\d\d)(?!\p{L})/gu, ' ')
      .replace(/\s*постер\s*(?:4[kк]|hd|uhd)?/gi, '')
      .replace(/\s*[\(\[]?\s*4[KkКк]\s*(?:Ultra\s*HD|UHD)?\s*[\)\]]?/gi, '');
    if (s.includes('дандадан') || s.includes('dandadan')) {
      s = 'дандадан';
    }
    if (/^звездные\s+войны\s*[:\s]\s*видени[яе]/i.test(s) || /^star\s+wars\s*[:\s]\s*visions/i.test(s)) {
      s = 'звездныевойнывидения';
    }
    return s.replace(/[^\p{L}\p{N}]+/gu, '').trim();
  };

  const primary = clean(title);
  if (primary) return primary;
  return clean(originalTitle);
}

export function getMediaYear(item) {
  if (!item) return '';

  // 0. Канонический интеллект клиента
  const clientYr = detectClientYear(item);
  if (clientYr) return clientYr;

  // 1. Из года или даты релиза объекта
  if (item.year && String(item.year).trim()) {
    const ym = String(item.year).match(/\b(19\d\d|20\d\d)\b/);
    if (ym) return ym[1];
    return String(item.year).trim();
  }
  if (item.release_date) {
    const ym = String(item.release_date).match(/\b(19\d\d|20\d\d)\b/);
    if (ym) return ym[1];
  }
  if (item.premiere) {
    const ym = String(item.premiere).match(/\b(19\d\d|20\d\d)\b/);
    if (ym) return ym[1];
  }

  // 2. Поиск в ссылке/URL (FanFilm4K часто содержит год: -2016.html или /4026-dzhek-richer-2022.html)
  const linkStr = String(item.link || item.url || item.fanfilm_4k_url || '');
  if (linkStr) {
    const lm = linkStr.match(/(?:-|_|\/|\b)(19\d\d|20\d\d)(?:\.html|\/|$)/) || linkStr.match(/-(\d{4})(?:-|\.html)/);
    if (lm) {
      const parsedYr = parseInt(lm[1], 10);
      if (parsedYr >= 1920 && parsedYr <= 2030) return lm[1];
    }
  }

  // 3. Известные франшизы и фильмы
  const normTitle = String(item.title || item.original_title || '')
    .toLowerCase()
    .replace(/[«»"'`]/g, '')
    .replace(/[:—–-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (normTitle.includes('проект конец света') || normTitle.includes('конец света')) return '2026';
  if (normTitle.includes('закулисье реальности')) return '2026';
  if (normTitle.includes('я не киллер') || normTitle.includes('hit man')) return '2023';
  if (normTitle.includes('хищник планета смерти') || normTitle.includes('планета смерти')) return '2025';
  if (normTitle.includes('аватар 3') || normTitle.includes('аватар пламя и пепел')) return '2025';
  if (normTitle.includes('аватар путь воды')) return '2022';
  if (normTitle.includes('аватар')) return '2009';
  if (normTitle.includes('падение империи')) return '2024';
  if (normTitle.includes('изгой один') || normTitle.includes('rogue one')) return '2016';
  if (normTitle.includes('интерстеллар') || normTitle.includes('interstellar')) return '2014';
  if (normTitle.includes('начало') || normTitle.includes('inception')) return '2010';
  if (normTitle.includes('матрица перезагрузка') || normTitle.includes('матрица революция')) return '2003';
  if (normTitle.includes('матрица') || normTitle.includes('matrix')) return '1999';
  if (normTitle.includes('дюна часть вторая')) return '2024';
  if (normTitle.includes('дюна')) return '2021';
  if (normTitle.includes('оппенгеймер')) return '2023';
  if (normTitle.includes('темный рыцарь') || normTitle.includes('тёмный рыцарь')) return '2008';
  if (normTitle.includes('бойцовский клуб')) return '1999';
  if (normTitle.includes('криминальное чтиво')) return '1994';
  if (normTitle.includes('побег из шоушенка')) return '1994';
  if (normTitle.includes('зеленая миля') || normTitle.includes('зелёная миля')) return '1999';
  if (normTitle.includes('леон')) return '1994';
  if (normTitle.includes('пятый элемент')) return '1997';
  if (normTitle.includes('гарри поттер')) return '2001';
  if (normTitle.includes('властелин колец')) return '2001';

  // 4. Из заголовка в скобках или по границам слов
  if (item.title || item.original_title) {
    const ym = String(item.title || item.original_title || '').match(/[\(\[]\s*(\d{4})\s*[\)\]]/) ||
               String(item.title || item.original_title || '').match(/\b(19\d\d|20\d\d)\b/);
    if (ym) {
      const yr = parseInt(ym[1], 10);
      if (yr >= 1920 && yr <= 2028 && yr !== 2049 && yr !== 2077 && yr !== 2000 && yr !== 2001 && yr !== 2010 && yr !== 2012 && yr !== 1984 && yr !== 1917) {
        return ym[1];
      }
    }
  }

  // 5. Гарантированный возврат года для свежих каталогов (вместо пустой строки)
  if (currentTab === 'new') return '2026';
  if (item.is4K || item.source === 'fanfilm4k') return '2026';

  return '';
}

export function getMediaCategoryLabel(item, fallbackCategory = '') {
  if (!item) return 'Фильм';
  const detectedType = detectClientMediaType(item);
  const type = String(item.media_type || detectedType || '').toLowerCase();
  const cat = String(fallbackCategory || item.category || currentTab || '').toLowerCase();
  const title = String(item.title || item.name || '').toLowerCase();
  const source = String(item.source || '').toLowerCase();

  // Специальные проверки франшиз
  if (title.includes('обитель зла') && (title.includes('мутация') || title.includes('мутиция'))) {
    return 'Фильм';
  }
  if (title.includes('обитель зла') && (title.includes('вендетта') || title.includes('вырождение') || title.includes('проклятие') || title.includes('остров смерти'))) {
    return 'Анимационный фильм';
  }
  if (title.includes('рик и морти') || title.includes('rick and morty')) {
    return 'Мультсериал';
  }

  // Защита от мультфильмов со словом монстр/монстры
  const isMonsterCartoonOrMovie = [
    'корпорация монстров', 'университет монстров', 'монстры на каникулах', 
    'монстры против пришельцев', 'миньоны и монстры', 'монстр траки', 'монстро'
  ].some(m => title === m || title.startsWith(m + ' ') || title.includes(m));

  if (!isMonsterCartoonOrMovie) {
    if (title === 'монстры' || title.startsWith('монстры ') || title.startsWith('монстры:') ||
        title === 'монстр' || title.startsWith('монстр ') || title.startsWith('монстр:') ||
        title === 'monsters' || title.startsWith('monsters ') || title === 'monster' || title.startsWith('monster ')) {
      return 'Сериал';
    }
  }

  if (title.includes('менталист') || title.includes('mentalist') || title.includes('дневники вампира') || title.includes('vampire diaries')) {
    return 'Сериал';
  }

  // Кэрри (2026) - сериал от Майка Флэнагана для Prime Video
  if (title === 'кэрри' || title.startsWith('кэрри ') || title.startsWith('кэрри:') || title === 'carrie' || title.startsWith('carrie ') || title.startsWith('carrie:')) {
    return 'Сериал';
  }

  // Дюна и Дюна: Часть вторая - строго художественный фильм
  if (title.includes('дюна')) {
    return 'Фильм';
  }

  if (detectedType === 'anime-series' || type === 'anime-series' || (source.includes('anix') && type.includes('series')) || (source.includes('libria') && type.includes('series'))) {
    return 'Аниме-сериал';
  }
  if (detectedType === 'anime-movie' || type === 'anime-movie' || cat === 'anime-movies') {
    return 'Аниме-фильм';
  }
  if (type === 'anime' || source === 'anixart' || source === 'anilibria' || source === 'shikimori' || cat === 'anime' || cat === 'anime-series') {
    if (type.includes('series') || title.includes('сезон') || title.includes('сериал')) return 'Аниме-сериал';
    return 'Аниме';
  }
  if (detectedType === 'cartoon-series' || type === 'cartoon-series' || (type.includes('series') && (cat === 'cartoons' || type.includes('cartoon')))) {
    return 'Мультсериал';
  }
  if (detectedType === 'cartoon' || type === 'cartoon' || cat === 'cartoons' || title.includes('мульт')) {
    return 'Мультфильм';
  }
  if (detectedType === 'series' || type === 'tv' || type === 'series' || cat === 'series' || title.includes('сериал') || title.includes('сезон')) {
    return 'Сериал';
  }
  if (type === 'show' || cat === 'shows') {
    return 'Шоу';
  }
  return 'Фильм';
}

// Утилита дедупликации релизов (полностью исключает дубли одного фильма из разных источников и баз)
function deduplicateMediaList(items) {
  if (!Array.isArray(items)) return [];
  const itemMap = new Map();
  const aliasToKey = new Map();

  for (const item of items) {
    if (!item || (!item.title && !item.name)) continue;
    // 100% исключение трейлеров, промо и фанатских концептов
    if (isTrailerMedia(item)) continue;

    const itemTitle = item.title || item.name || '';
    const origTitle = item.original_title || item.original_name || '';
    const itemType = detectClientMediaType(item) || item.media_type || '';
    const isSeriesOrAnime = itemType === 'series' || itemType === 'anime-series' || itemType === 'cartoon-series' || ['anilibria', 'anixart', 'shikimori'].includes(item.source);
    const itemYr = getMediaYear(item) || item.year || '';
    const baseNormKey = normalizeMediaTitle(itemTitle, origTitle);
    const baseOrigKey = origTitle ? normalizeMediaTitle(origTitle, '') : '';
    const normKey = (!isSeriesOrAnime && baseNormKey && itemYr) ? `${baseNormKey}_movie_${itemYr}` : baseNormKey;
    const origKey = (!isSeriesOrAnime && baseOrigKey && itemYr) ? `${baseOrigKey}_movie_${itemYr}` : baseOrigKey;
    const tmdbKey = item.tmdb_id ? `tmdb_${item.tmdb_id}` : (String(item.id || '').startsWith('tmdb_') ? String(item.id) : '');
    const kpKey = (item.kp_id || item.kinopoisk_id) ? `kp_${item.kp_id || item.kinopoisk_id}` : '';

    const candidateKeys = [normKey, origKey, tmdbKey, kpKey].filter(Boolean);
    let key = '';
    for (const ck of candidateKeys) {
      if (itemMap.has(ck)) {
        key = ck;
        break;
      }
      if (aliasToKey.has(ck)) {
        key = aliasToKey.get(ck);
        break;
      }
    }
    if (!key) {
      key = normKey || origKey || tmdbKey || kpKey || `id_${item.id || item.media_id || ''}_${item.source || ''}`;
    }
    for (const ck of candidateKeys) {
      aliasToKey.set(ck, key);
    }

    if (!itemMap.has(key)) {
      itemMap.set(key, {
        ...item,
        poster: getSafePosterUrl(item.poster || item.poster_url, itemTitle)
      });
    } else {
      const existing = itemMap.get(key);
      const fanfilmUrl = item.fanfilm_4k_url || existing.fanfilm_4k_url ||
        (item.source === 'fanfilm4k' ? (item.link || item.url) : (existing.source === 'fanfilm4k' ? (existing.link || existing.url) : null));
      const mergedUpcoming = !fanfilmUrl && Boolean(item.is_upcoming || existing.is_upcoming || isUpcomingMediaItem(item) || isUpcomingMediaItem(existing));
      const has4K = !mergedUpcoming && Boolean(item.is4K || existing.is4K || Boolean(fanfilmUrl));

      const isNewBetter =
        (item.source === 'tmdb' && existing.source !== 'tmdb') ||
        (!existing.poster && (item.poster || item.poster_url)) ||
        (!existing.user_status && item.user_status) ||
        ((item.progress_percent || 0) > (existing.progress_percent || 0));

      const merged = isNewBetter ? {
        ...existing,
        ...item,
        year: item.year || existing.year || '',
        media_type: detectClientMediaType(item) || item.media_type || existing.media_type || '',
        category: item.category || existing.category || '',
        genres: item.genres || existing.genres || '',
        release_date: item.release_date || existing.release_date || '',
        fanfilm_4k_url: fanfilmUrl,
        is_upcoming: mergedUpcoming,
        is4K: has4K,
        quality: mergedUpcoming ? 'Ожидается' : (has4K ? '4K Ultra HD' : (item.quality || existing.quality)),
        poster: item.poster || item.poster_url || existing.poster || existing.poster_url,
        user_status: item.user_status || existing.user_status,
        progress_percent: Math.max(item.progress_percent || 0, existing.progress_percent || 0)
      } : {
        ...item,
        ...existing,
        year: existing.year || item.year || '',
        media_type: detectClientMediaType(existing) || existing.media_type || item.media_type || '',
        category: existing.category || item.category || '',
        genres: existing.genres || item.genres || '',
        release_date: existing.release_date || item.release_date || '',
        fanfilm_4k_url: fanfilmUrl,
        is_upcoming: mergedUpcoming,
        is4K: has4K,
        quality: mergedUpcoming ? 'Ожидается' : (has4K ? '4K Ultra HD' : (existing.quality || item.quality)),
        poster: existing.poster || existing.poster_url || item.poster || item.poster_url,
        user_status: existing.user_status || item.user_status,
        progress_percent: Math.max(item.progress_percent || 0, existing.progress_percent || 0)
      };

      // Объединение плееров и ссылок на источники
      const mergedPlayers = [];
      const seenP = new Set();
      for (const p of [...(existing.players || []), ...(item.players || [])]) {
        if (!p || !p.id) continue;
        const pKey = `${p.id}_${p.url || ''}`;
        if (!seenP.has(pKey)) {
          seenP.add(pKey);
          mergedPlayers.push(p);
        }
      }
      if (mergedPlayers.length > 0) {
        merged.players = mergedPlayers;
      }
      merged.vk_embed_url = item.vk_embed_url || existing.vk_embed_url || (item.source === 'vkvideo' ? (item.embed_url || item.url) : null);
      merged.rutube_id = item.rutube_id || existing.rutube_id || (item.source === 'rutube' ? item.id : null);

      if (key === 'дандадан') {
        merged.title = 'Дандадан';
        merged.media_type = 'anime-series';
        merged.category = 'Аниме-сериал';
        merged.year = '2024–2025';
        merged.total_seasons = 2;
        merged.anixart_season_ids = { 1: '19675', 2: '20145' };
      }

      itemMap.set(key, merged);
    }
  }

  return Array.from(itemMap.values());
}

// Защита от утечки сквозных каруселей сайтов-доноров при пагинации страниц
export const FANFILM_PINNED_CAROUSEL_IDS = new Set([
  '2699', '3303', '2955', '2602', '2927', '3398', '3999', '3324', '2907',
  '13962', '73057', '4165', '3319', '80233', '75166', '81746', '4066', '82029', '70512'
]);

export function filterPageDuplicates(items, category, page) {
  if (!Array.isArray(items)) return [];
  if (page <= 1) return items;

  // 1. Исключаем сквозные карточки верхней карусели сайта Fanfilm (18 зафиксированных карточек верхнего слайдера)
  let filtered = items.filter(it => {
    if (!it) return false;
    const itId = String(it.id || '');
    if (it.source === 'fanfilm4k' && FANFILM_PINNED_CAROUSEL_IDS.has(itId)) {
      return false;
    }
    return true;
  });

  // 2. Исключаем дубли тайтлов, которые уже были показаны на 1-й странице этой же категории
  const page1Cache = clientTabCache.get(`${category}_1_${currentSource}`) || clientTabCache.get(`${category}_1_all`);
  if (page1Cache) {
    const p1Items = Array.isArray(page1Cache) ? page1Cache : (page1Cache.items || []);
    if (p1Items.length > 0) {
      const page1Keys = new Set();
      p1Items.forEach(it => {
        const k = normalizeMediaTitle(it.title, it.original_title);
        if (k) page1Keys.add(k);
        if (it.id) page1Keys.add(String(it.id));
      });

      filtered = filtered.filter(it => {
        const k = normalizeMediaTitle(it.title, it.original_title);
        if (k && page1Keys.has(k)) return false;
        if (it.id && page1Keys.has(String(it.id))) return false;
        return true;
      });
    }
  }

  return filtered;
}

// -------------------------------------------------------------
// ВИТРИНА HERO SHOWCASE (EMBY & PLEX КИНЕМАТОГРАФИЧНЫЙ БАННЕР)
// -------------------------------------------------------------
let heroSliderTimer = null;
let heroSliderItems = [];
let currentHeroIndex = 0;

export function hideHeroShowcase() {
  if (heroSliderTimer) {
    clearInterval(heroSliderTimer);
    heroSliderTimer = null;
  }
  const heroContainer = document.getElementById('hero-showcase-container');
  if (heroContainer) {
    heroContainer.style.display = 'none';
    heroContainer.innerHTML = '';
  }
}

function renderHeroShowcase(items) {
  const container = document.getElementById('hero-showcase-container');
  if (!container) return;

  if (currentTab !== 'home' || (searchQuery && searchQuery.trim().length >= 2)) {
    hideHeroShowcase();
    return;
  }

  if (heroSliderTimer) {
    clearInterval(heroSliderTimer);
    heroSliderTimer = null;
  }

  let rawList = Array.isArray(items) ? items.filter(Boolean) : (items ? [items] : []);
  if (rawList.length === 0) {
    const fallback = (getBaselineCatalog('popular') || []).slice(0, 7);
    if (fallback.length > 0) {
      rawList = fallback;
    } else {
      hideHeroShowcase();
      return;
    }
  }

  const newFeaturedIds = rawList.map(x => String(x.id || x.media_id)).join(',');
  const currentFeaturedIds = (heroSliderItems || []).map(x => String(x.id || x.media_id)).join(',');
  const existingShowcase = container.querySelector('.hero-showcase');
  if (existingShowcase && newFeaturedIds === currentFeaturedIds && heroSliderItems.length > 0) {
    return;
  }

  container.style.display = 'block';
  heroSliderItems = rawList;
  if (currentHeroIndex >= heroSliderItems.length) {
    currentHeroIndex = 0;
  }

  function renderSlide(index) {
    if (currentTab !== 'home') {
      hideHeroShowcase();
      return;
    }
    const item = heroSliderItems[index];
    if (!item) return;

    const formattedTitle = formatMediaTitle(item);
    const isReal4K = item.is4K === true || (item.quality && item.quality.includes('4K'));
    const backdrop = getSafePosterUrl(item.backdrop || item.backdrop_path || item.poster || 'assets/favicon.svg', item.title);

    let genres = [];
    if (Array.isArray(item.genres)) genres = item.genres;
    else if (typeof item.genres === 'string') genres = item.genres.split(/[,/]/).map(g => g.trim()).filter(Boolean);

    const genresHtml = genres.slice(0, 3).map(g => `<span class="hero-genre-pill">${g}</span>`).join('');

    const dotsHtml = heroSliderItems.length > 1 ? `
      <div class="hero-slider-dots">
        ${heroSliderItems.map((_, dIdx) => `
          <div class="hero-slider-dot ${dIdx === index ? 'active' : ''}" data-index="${dIdx}" title="Слайд ${dIdx + 1}"></div>
        `).join('')}
      </div>
    ` : '';

    const navArrowsHtml = heroSliderItems.length > 1 ? `
      <button type="button" class="hero-slider-nav hero-slider-prev" aria-label="Предыдущий слайд" title="Предыдущий">❮</button>
      <button type="button" class="hero-slider-nav hero-slider-next" aria-label="Следующий слайд" title="Следующий">❯</button>
    ` : '';

    container.innerHTML = `
      <div class="hero-showcase" style="background-image: url('${backdrop}');">
        <div class="hero-showcase-overlay"></div>
        ${navArrowsHtml}
        ${dotsHtml}
        <div class="hero-showcase-content">
          <div class="hero-badges-row">
            ${isReal4K ? '<span class="hero-badge-tag hero-badge-4k">4K UHD</span>' : ''}
            ${item.rating ? `<span class="hero-badge-tag hero-badge-rating">★ ${item.rating}</span>` : ''}
            <span class="hero-badge-tag" style="background:var(--bg-tertiary);color:var(--text-secondary);">${getSourceName(item)}</span>
          </div>
          <h1 class="hero-title">${formattedTitle}</h1>
          <div class="hero-meta-row">
            ${getMediaYear(item) || item.year ? `<span>${getMediaYear(item) || item.year}</span><span>•</span>` : ''}
            <span>${getMediaCategoryLabel(item)}</span>
            ${genresHtml ? `<span>•</span><div class="hero-genres-chips">${genresHtml}</div>` : ''}
          </div>
          <p class="hero-desc">${item.description || 'Высочайшее качество видео и звука в формате 4K Ultra HD. Смотрите онлайн в любое удобное время на STORM MULTIMEDIA.'}</p>
          <div class="hero-actions">
            <button type="button" class="storm-btn storm-btn-primary hero-btn-play" id="hero-watch-btn">
              <span>▶</span>
              <span data-i18n="hero_watch_now">${t('hero_watch_now')}</span>
            </button>
            <button type="button" class="hero-btn-bookmark" id="hero-bookmark-btn">
              <span>🔖</span>
              <span data-i18n="hero_add_bookmark">${t('hero_add_bookmark')}</span>
            </button>
            <button type="button" class="hero-btn-trailer" id="hero-trailer-btn">
              <span>👥</span>
              <span data-i18n="card_menu_watch_together">${t('card_menu_watch_together')}</span>
            </button>
          </div>
        </div>
      </div>
    `;

    container.style.display = 'block';

    const watchBtn = document.getElementById('hero-watch-btn');
    if (watchBtn) watchBtn.onclick = () => openPlayerModal(item);

    const bookmarkBtn = document.getElementById('hero-bookmark-btn');
    if (bookmarkBtn) {
      bookmarkBtn.onclick = async () => {
        const nextStatus = item.user_status === 'favorite' ? 'plan' : 'favorite';
        item.user_status = nextStatus;
        await saveBookmarkStatus(item, nextStatus);
        showActionSheetToast(`Добавлено в закладки: ${getStatusLabel(nextStatus)}`);
      };
    }

    const trailerBtn = document.getElementById('hero-trailer-btn');
    if (trailerBtn) trailerBtn.onclick = () => createWatchRoom(item);

    const prevBtn = container.querySelector('.hero-slider-prev');
    if (prevBtn) {
      prevBtn.onclick = (e) => {
        e.stopPropagation();
        goToSlide((currentHeroIndex - 1 + heroSliderItems.length) % heroSliderItems.length);
      };
    }

    const nextBtn = container.querySelector('.hero-slider-next');
    if (nextBtn) {
      nextBtn.onclick = (e) => {
        e.stopPropagation();
        goToSlide((currentHeroIndex + 1) % heroSliderItems.length);
      };
    }

    container.querySelectorAll('.hero-slider-dot').forEach(dot => {
      dot.onclick = (e) => {
        e.stopPropagation();
        const dIdx = parseInt(dot.dataset.index, 10);
        if (!isNaN(dIdx)) goToSlide(dIdx);
      };
    });

    const showcaseEl = container.querySelector('.hero-showcase');
    if (showcaseEl) {
      let touchStartX = 0;
      let touchEndX = 0;

      showcaseEl.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
        stopAutoRotation();
      }, { passive: true });

      showcaseEl.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
        startAutoRotation();
      }, { passive: true });

      function handleSwipe() {
        const diff = touchEndX - touchStartX;
        if (Math.abs(diff) > 45) {
          if (diff < 0) {
            goToSlide((currentHeroIndex + 1) % heroSliderItems.length);
          } else {
            goToSlide((currentHeroIndex - 1 + heroSliderItems.length) % heroSliderItems.length);
          }
        }
      }

      showcaseEl.addEventListener('mouseenter', stopAutoRotation);
      showcaseEl.addEventListener('mouseleave', startAutoRotation);
    }
  }

  function goToSlide(newIdx) {
    currentHeroIndex = newIdx;
    renderSlide(currentHeroIndex);
    resetAutoRotation();
  }

  function startAutoRotation() {
    if (currentTab !== 'home' || heroSliderItems.length <= 1) return;
    if (heroSliderTimer) clearInterval(heroSliderTimer);
    heroSliderTimer = setInterval(() => {
      if (currentTab !== 'home') {
        stopAutoRotation();
        hideHeroShowcase();
        return;
      }
      currentHeroIndex = (currentHeroIndex + 1) % heroSliderItems.length;
      renderSlide(currentHeroIndex);
    }, 7000);
  }

  function stopAutoRotation() {
    if (heroSliderTimer) {
      clearInterval(heroSliderTimer);
      heroSliderTimer = null;
    }
  }

  function resetAutoRotation() {
    stopAutoRotation();
    startAutoRotation();
  }

  renderSlide(currentHeroIndex);
  startAutoRotation();
}

// -------------------------------------------------------------
// ГОРИЗОНТАЛЬНЫЕ КАРУСЕЛИ РЕЙЛОВ (EMBY & PLEX HOME VIEW)
// -------------------------------------------------------------

export function isMediaCardWatched(item) {
  if (!item) return false;
  const st = item.user_status || resolveMediaUserStatus(item) || '';
  if (st === 'completed') return true;
  if (typeof item.progress_percent === 'number' && item.progress_percent >= 90) return true;
  if (typeof item.series_progress_percent === 'number' && item.series_progress_percent >= 90) return true;

  try {
    const id = String(item.id || item.media_id || '').trim();
    const rawTitle = String(item.title || item.name || '').trim();
    const normTitle = normalizeMediaTitle(rawTitle, item.original_title || '');
    const resumeTitleKey = rawTitle
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/\s*[\(\[][^\)\]]*[\)\]]/g, ' ')
      .replace(/[^\p{L}\p{N}]+/gu, '')
      .trim();

    if (id && localStorage.getItem(`storm_status_${id}`) === 'completed') return true;
    if (normTitle && localStorage.getItem(`storm_status_title_${normTitle}`) === 'completed') return true;
    if (resumeTitleKey && localStorage.getItem(`storm_watched_title_${resumeTitleKey}`) === '1') return true;

    const candidateIds = new Set();
    if (id) candidateIds.add(id);

    if (resumeTitleKey) {
      const rawSnap = localStorage.getItem(`storm_resume_state_title_${resumeTitleKey}`);
      if (rawSnap) {
        try {
          const snap = JSON.parse(rawSnap);
          if (snap) {
            if (snap.media_id) candidateIds.add(String(snap.media_id));
            if (typeof snap.progress_percent === 'number' && snap.progress_percent >= 90) return true;
            if ((Number(snap.season) > 1 || Number(snap.episode) > 1) && Number(snap.time_seconds) >= 30) return true;
          }
        } catch {}
      }
    }

    const hist = Array.isArray(cachedContinueHistory) ? cachedContinueHistory : getLocalContinueWatching();
    if (Array.isArray(hist)) {
      for (const h of hist) {
        if (!h) continue;
        const hId = String(h.media_id || h.id || '').trim();
        const hNorm = normalizeMediaTitle(h.title || '');
        if ((id && hId === id) || (normTitle && hNorm === normTitle)) {
          if (hId) candidateIds.add(hId);
          if ((typeof h.progress_percent === 'number' && h.progress_percent >= 90) ||
              (typeof h.episode_progress_percent === 'number' && h.episode_progress_percent >= 90)) {
            return true;
          }
        }
      }
    }

    for (const cid of candidateIds) {
      if (!cid) continue;
      for (let s = 1; s <= 10; s++) {
        if (localStorage.getItem(`storm_season_status_${cid}_s${s}`) === 'completed') return true;
        const wRaw = localStorage.getItem(`storm_watched_eps_${cid}_s${s}`) || (s === 1 ? localStorage.getItem(`storm_watched_eps_${cid}`) : null);
        if (wRaw) {
          try {
            const arr = JSON.parse(wRaw);
            if (Array.isArray(arr) && arr.length > 0) return true;
          } catch {}
        }
      }
    }
  } catch {}
  return false;
}

export function removeMediaFromContinueWatching(item, cardEl = null) {
  if (!item) return;
  const mediaId = item.id || item.media_id || '';
  const title = cleanVideoTitle(item.title || '');
  const source = item.source || '';

  if (cardEl) {
    const railItem = cardEl.closest('.rail-item') || cardEl;
    railItem.style.transition = 'opacity 0.22s ease, transform 0.22s ease';
    railItem.style.opacity = '0';
    railItem.style.transform = 'scale(0.92)';
  }

  if (Array.isArray(cachedContinueHistory)) {
    const normT = normalizeMediaTitle(title);
    cachedContinueHistory = cachedContinueHistory.filter(h => {
      if (!h) return false;
      if (mediaId && String(h.media_id || h.id) === String(mediaId)) return false;
      if (normT && normalizeMediaTitle(h.title || '') === normT) return false;
      return true;
    });
  }

  lastRenderedHomeKey = '';
  removeFromLocalContinueWatching(mediaId, title, source);
  showToast(`🗑️ «${title || 'Релиз'}» убран из «Продолжить просмотр»`, 'info');
}

function createRailCardHtml(item, idx, isWide = false, railId = '') {
  const poster = getSafePosterUrl(item.poster || 'assets/favicon.svg', item.title);
  const formattedTitle = formatMediaTitle(item);
  const isUpcoming = isUpcomingMediaItem(item);
  const isReal4K = !isUpcoming && (item.is4K === true || (item.quality && item.quality.includes('4K') && !item.quality.includes('Ожидается')));
  const is1080p = !isUpcoming && !isReal4K && ((item.quality && (item.quality.includes('1080') || item.quality.includes('FHD'))) || (item.source === 'fanfilm4k' && !isUpcoming && item.is4K !== false));
  const hasHdr = !isUpcoming && (item.isHDR || (item.quality && item.quality.toLowerCase().includes('hdr')));
  const hasAtmos = !isUpcoming && (item.isAtmos || (item.audio && item.audio.toLowerCase().includes('atmos')));
  const has60Fps = !isUpcoming && (item.fps === 60 || (item.quality && item.quality.includes('60')));
  const hasDub = !isUpcoming && Boolean(item.voiceover || (item.translations && item.translations.length > 0) || (item.source === 'fanfilm4k' && !isUpcoming && item.is4K !== false && !/ожидается|скоро/i.test(item.quality || '')));
  const isWatched = isMediaCardWatched(item);
  const isContinueRail = railId === 'rail-continue' || isWide;
  const yr = getMediaYear(item);
  const catLabel = getMediaCategoryLabel(item, item.media_type || 'movie');
  const metaText = yr ? `${yr} • ${catLabel}` : catLabel;

  const currentStatus = resolveMediaUserStatus(item);
  if (currentStatus) item.user_status = currentStatus;

  const isSeries = item.media_type === 'series' || item.media_type === 'anime-series' || item.media_type === 'cartoon-series' || (item.episode && item.episode > 1) || (item.season && item.season > 1);
  let displayPercent = typeof item.series_progress_percent === 'number'
    ? Math.round(item.series_progress_percent)
    : (typeof item.progress_percent === 'number' ? Math.round(item.progress_percent) : 0);

  const tNorm = String(item.title || '').toLowerCase();
  const isReacher = isSeries && (tNorm.includes('джек ричер') || tNorm.includes('ричер') || tNorm.includes('reacher'));

  if (isReacher) {
    const s = parseInt(item.season, 10) || 1;
    const ep = parseInt(item.episode, 10) || 1;
    if (s >= 4 && ep >= 7) {
      displayPercent = 96;
    } else {
      const totalReacherEps = 32;
      const epsWatched = ((s - 1) * 8) + (ep - 1);
      displayPercent = Math.min(99, Math.max(displayPercent, Math.round((epsWatched / totalReacherEps) * 100)));
    }
  } else if (isSeries && item.season && item.season > 1) {
    const s = parseInt(item.season, 10) || 1;
    const ep = parseInt(item.episode, 10) || 1;
    const totalEp = parseInt(item.total_episodes, 10) || 8;
    const totalSeasons = item.total_seasons || Math.max(s, 1);
    const totalAll = totalSeasons * totalEp;
    const epsWatched = ((s - 1) * totalEp) + (ep - 1);
    if (totalAll > 0) {
      displayPercent = Math.min(99, Math.max(displayPercent, Math.round((epsWatched / totalAll) * 100)));
    }
  } else if (displayPercent <= 0 && isSeries && (item.episode || item.season)) {
    const ep = parseInt(item.episode, 10) || 1;
    const totalEp = parseInt(item.total_episodes, 10) || 12;
    displayPercent = Math.min(100, Math.max(1, Math.round((ep / totalEp) * 100)));
  }

  const isExplicitMovie = item.media_type === 'movie' || item.category === 'Фильм' || catLabel === 'Фильм' || tNorm.includes('дюна');
  const primaryQualityBadge = isUpcoming
    ? '<span class="storm-badge storm-badge-upcoming" style="background:rgba(245,158,11,0.22); border-color:#f59e0b; color:#fbbf24; font-weight:800; text-transform:uppercase;">ОЖИДАЕТСЯ</span>'
    : (isReal4K ? '<span class="storm-badge storm-badge-4k">4K UHD</span>' : (is1080p ? '<span class="storm-badge storm-badge-1080p">1080p</span>' : ''));
  const secondaryContextBadge = item.next_up
    ? `<span class="storm-badge storm-badge-next-up" style="background:rgba(0, 210, 255, 0.18); border-color:var(--accent); color:var(--accent); font-weight:700;">▶ ${item.next_up}</span>`
    : ((!isExplicitMovie && (item.media_type === 'series' || catLabel === 'Сериал'))
      ? '<span class="storm-badge storm-badge-series" style="background:rgba(168,85,247,0.22); border-color:#a855f7; color:#c084fc; font-weight:700;">Сериал</span>'
      : (hasDub ? '<span class="storm-badge storm-badge-dub">Дубляж</span>' : ''));

  const bmIcon = item.user_status === 'favorite' ? '❤️' : (item.user_status === 'completed' ? '✅' : (item.user_status ? '🔖' : '＋'));
  const bmTitle = item.user_status ? `В закладках (${getStatusLabel(item.user_status)}) • Нажмите для смены` : 'Быстро добавить в «В планах»';

  return `
    <div class="rail-item ${isWide ? 'rail-item-wide' : ''}">
      <div class="storm-card media-card storm-focusable" data-id="${item.id}" data-source="${item.source}" tabindex="0" role="button" aria-label="${formattedTitle}">
        <div class="media-card-poster">
          ${getMediaCardImgHtml(poster, item.title)}
          <div class="media-card-badges">
            ${primaryQualityBadge}
            ${secondaryContextBadge}
          </div>
          <div class="media-card-top-right">
            ${isWatched ? '<span class="media-card-watched-tag" title="Просмотрено">✓</span>' : ''}
            ${item.rating ? `<span class="storm-badge storm-badge-rating">★ ${item.rating}</span>` : ''}
            ${isContinueRail ? '<button type="button" class="media-card-remove-continue-btn" title="Убрать из «Продолжить просмотр»" aria-label="Убрать из «Продолжить просмотр»">✕</button>' : ''}
          </div>
          ${item.user_status ? `<div class="media-card-status-badge">${getStatusBadge(item.user_status)}</div>` : ''}
          <button type="button" class="media-card-menu-btn" title="Все действия и коллекции">⋮</button>
          <div class="media-card-overlay">
            <div class="media-play-icon">▶</div>
          </div>
          ${displayPercent > 0 ? (
            isSeries ? renderSegmentedEpisodeBar(displayPercent, parseInt(item.total_episodes, 10) || 8) : `
            <div class="media-card-progress storm-progress-container">
              <div class="storm-progress-bar" style="width: ${displayPercent}%"></div>
            </div>
            `
          ) : ''}
        </div>
        <div class="media-card-content">
          <div class="media-card-title" title="${formattedTitle}">${formattedTitle}</div>
          <div class="media-card-meta">
            <span>${metaText}</span>
            ${displayPercent > 0 ? `<span style="color:var(--accent);font-weight:700;">${displayPercent}%</span>` : ''}
          </div>
        </div>
      </div>
    </div>
  `;
}

async function handleQuickCardBookmark(item, btnEl) {
  if (!item) return;
  const current = resolveMediaUserStatus(item) || item.user_status || null;
  let nextStatus = 'plan';
  let toastMsg = `📌 «${item.title}» добавлено в список «В планах»`;

  if (!current) {
    nextStatus = 'plan';
    toastMsg = `📌 «${item.title}» добавлено в «В планах»`;
  } else if (current === 'plan' || current === 'planned') {
    nextStatus = 'favorite';
    toastMsg = `❤️ «${item.title}» отмечено как «Любимое»`;
  } else if (current === 'favorite') {
    nextStatus = 'watching';
    toastMsg = `▶️ «${item.title}» перенесено в «Смотрю»`;
  } else {
    openCardActionSheet(item);
    return;
  }

  item.user_status = nextStatus;
  if (btnEl) {
    btnEl.classList.add('is-bookmarked');
    btnEl.textContent = nextStatus === 'favorite' ? '❤️' : '🔖';
    btnEl.title = `В закладках (${getStatusLabel(nextStatus)}) • Нажмите для смены`;
  }

  try {
    await saveBookmarkStatus(item, nextStatus);
    updateCardsInDOM(item.id, item.title, nextStatus, nextStatus === 'completed');
    showToast(toastMsg, 'success');
  } catch (_) {
    updateCardsInDOM(item.id, item.title, nextStatus, false);
    showToast(toastMsg, 'success');
  }
}

// -------------------------------------------------------------
// РЕДАКТОР И КОНФИГУРАЦИЯ БЛОКОВ ГЛАВНОЙ ВИТРИНЫ (FEATURE 12)
// -------------------------------------------------------------
const DEFAULT_HOME_SECTIONS = [
  { id: 'rail-continue', name: 'Продолжить просмотр', enabled: true },
  { id: 'rail-trending', name: 'Горячие премьеры', enabled: true },
  { id: 'rail-lift-foreign-films', name: 'Популярные зарубежные фильмы', enabled: true },
  { id: 'rail-lift-foreign-series', name: 'Популярные зарубежные сериалы', enabled: true },
  { id: 'rail-lift-ru-films', name: 'Популярные российские фильмы', enabled: true },
  { id: 'rail-lift-ru-series', name: 'Популярные российские сериалы', enabled: true },
  { id: 'rail-movies', name: 'Популярные фильмы', enabled: true },
  { id: 'rail-series', name: 'Лучшие сериалы', enabled: true },
  { id: 'rail-anime', name: 'Топ аниме', enabled: true },
  { id: 'rail-top-rated', name: 'Шедевры мирового кино', enabled: true }
];

let cachedLiftHomeRails = null;
let isFetchingLiftHomeRails = false;

export async function ensureLiftHomeRailsLoaded() {
  if (cachedLiftHomeRails) return cachedLiftHomeRails;
  try {
    const raw = localStorage.getItem('storm_lift_home_rails_v1');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.rails && (Date.now() - (parsed.ts || 0) < 1000 * 60 * 30)) {
        cachedLiftHomeRails = parsed.rails;
      }
    }
  } catch (_) {}

  if (!isFetchingLiftHomeRails) {
    isFetchingLiftHomeRails = true;
    fetch('/api/lift/home-rails', { signal: AbortSignal.timeout(10000) })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        isFetchingLiftHomeRails = false;
        if (data && data.rails) {
          const hadBefore = Boolean(cachedLiftHomeRails);
          cachedLiftHomeRails = data.rails;
          try {
            localStorage.setItem('storm_lift_home_rails_v1', JSON.stringify({
              ts: Date.now(),
              rails: data.rails
            }));
          } catch (_) {}
          if (!hadBefore && currentTab === 'home') {
            lastRenderedHomeKey = '';
            renderHomeView(rawCatalogItems);
          }
        }
      })
      .catch(() => {
        isFetchingLiftHomeRails = false;
      });
  }
  return cachedLiftHomeRails;
}

export function getHomeSectionsConfig() {
  try {
    const raw = localStorage.getItem('storm_home_sections_config');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const existingIds = new Set(parsed.map(s => s.id));
        const missing = DEFAULT_HOME_SECTIONS.filter(d => !existingIds.has(d.id)).map(s => ({ ...s }));
        if (missing.length > 0) {
          const merged = [...parsed];
          const trendingIdx = merged.findIndex(s => s.id === 'rail-trending');
          if (trendingIdx >= 0) {
            merged.splice(trendingIdx + 1, 0, ...missing);
          } else {
            merged.push(...missing);
          }
          return merged;
        }
        return parsed;
      }
    }
  } catch (_) {}
  return DEFAULT_HOME_SECTIONS.map(s => ({ ...s }));
}

export function saveHomeSectionsConfig(cfg) {
  localStorage.setItem('storm_home_sections_config', JSON.stringify(cfg));
}

export function openHomeSectionsModal() {
  let modal = document.getElementById('home-sections-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'storm-modal-backdrop';
    modal.id = 'home-sections-modal';
    modal.innerHTML = `
      <div class="storm-modal" style="max-width: 480px; width: 92%;">
        <div class="storm-modal-header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 18px;">⚙️</span>
            <h4 class="storm-modal-title" style="margin: 0;">Настройка витрины</h4>
          </div>
          <button type="button" class="storm-modal-close" id="close-home-sections-btn">✕</button>
        </div>
        <div class="storm-modal-body">
          <p style="font-size: 12.5px; color: var(--text-muted); margin: 0 0 16px 0;">
            Настройте порядок и видимость горизонтальных блоков на главной странице. Используйте стрелки для изменения порядка.
          </p>
          <div class="home-sections-list" id="home-sections-list" style="display: flex; flex-direction: column; gap: 8px;"></div>
        </div>
        <div class="storm-modal-footer" style="display: flex; justify-content: flex-end; gap: 10px; padding: 14px 20px;">
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="reset-home-sections-btn">Сброс</button>
          <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="save-home-sections-btn">Применить</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const closeBtn = modal.querySelector('#close-home-sections-btn');
    if (closeBtn) closeBtn.onclick = () => modal.classList.remove('is-open');
    modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('is-open'); };
  }

  let currentConfig = getHomeSectionsConfig();
  const listEl = modal.querySelector('#home-sections-list');

  const renderSectionItems = () => {
    if (!listEl) return;
    listEl.innerHTML = currentConfig.map((sec, idx) => `
      <div class="home-section-edit-item" data-idx="${idx}" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: var(--bg-card); border-radius: 8px; border: 1px solid var(--border-subtle);">
        <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; user-select: none;">
          <input type="checkbox" class="section-enable-check" data-idx="${idx}" ${sec.enabled ? 'checked' : ''} style="width: 18px; height: 18px; accent-color: var(--accent); cursor: pointer;">
          <span style="font-size: 13.5px; font-weight: 700; color: ${sec.enabled ? 'var(--text-primary)' : 'var(--text-muted)'};">${escapeHtml(sec.name)}</span>
        </label>
        <div style="display: flex; gap: 4px;">
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-xs btn-move-section-up" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''} title="Переместить выше">▲</button>
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-xs btn-move-section-down" data-idx="${idx}" ${idx === currentConfig.length - 1 ? 'disabled' : ''} title="Переместить ниже">▼</button>
        </div>
      </div>
    `).join('');

    listEl.querySelectorAll('.section-enable-check').forEach(chk => {
      chk.onchange = (e) => {
        const i = parseInt(chk.dataset.idx, 10);
        currentConfig[i].enabled = e.target.checked;
        renderSectionItems();
      };
    });

    listEl.querySelectorAll('.btn-move-section-up').forEach(btn => {
      btn.onclick = () => {
        const i = parseInt(btn.dataset.idx, 10);
        if (i > 0) {
          const temp = currentConfig[i];
          currentConfig[i] = currentConfig[i - 1];
          currentConfig[i - 1] = temp;
          renderSectionItems();
        }
      };
    });

    listEl.querySelectorAll('.btn-move-section-down').forEach(btn => {
      btn.onclick = () => {
        const i = parseInt(btn.dataset.idx, 10);
        if (i < currentConfig.length - 1) {
          const temp = currentConfig[i];
          currentConfig[i] = currentConfig[i + 1];
          currentConfig[i + 1] = temp;
          renderSectionItems();
        }
      };
    });
  };

  renderSectionItems();

  const resetBtn = modal.querySelector('#reset-home-sections-btn');
  if (resetBtn) {
    resetBtn.onclick = () => {
      currentConfig = DEFAULT_HOME_SECTIONS.map(s => ({ ...s }));
      saveHomeSectionsConfig(currentConfig);
      renderSectionItems();
      showToast('Настройки витрины сброшены', 'info');
    };
  }

  const saveBtn = modal.querySelector('#save-home-sections-btn');
  if (saveBtn) {
    saveBtn.onclick = () => {
      saveHomeSectionsConfig(currentConfig);
      modal.classList.remove('is-open');
      showToast('Витрина обновлена', 'success');
      renderHomeView(rawCatalogItems);
    };
  }

  modal.classList.add('is-open');
}

export function updateCardsInDOM(mediaId, title = '', status = null, isWatched = false) {
  if (!mediaId && !title) return;
  const mIdStr = String(mediaId || '');
  const normTitle = normalizeMediaTitle(title || '');

  const cards = document.querySelectorAll('.media-card, .media-detailed-card');
  cards.forEach(card => {
    const cardId = String(card.dataset.id || '');
    let matches = (mIdStr && cardId === mIdStr);
    if (!matches && normTitle) {
      const cardTitleEl = card.querySelector('.media-card-title, .media-detailed-title');
      if (cardTitleEl && normalizeMediaTitle(cardTitleEl.textContent || '') === normTitle) {
        matches = true;
      }
    }
    if (!matches) return;

    // 1. Обновляем плашку статуса (В планах, Смотрю, Просмотрено и т.д.)
    const cardPoster = card.querySelector('.media-card-poster');
    if (cardPoster) {
      const oldCardBadge = cardPoster.querySelector('.media-card-status-badge');
      if (oldCardBadge) oldCardBadge.remove();
      if (status && status !== 'none') {
        const overlay = cardPoster.querySelector('.media-card-overlay');
        const badgeHtml = `<div class="media-card-status-badge">${getStatusBadge(status)}</div>`;
        if (overlay) {
          overlay.insertAdjacentHTML('beforebegin', badgeHtml);
        } else {
          cardPoster.insertAdjacentHTML('beforeend', badgeHtml);
        }
      }
    }

    const detailedHeaderDiv = card.querySelector('.media-detailed-header > div:last-child');
    if (detailedHeaderDiv) {
      const oldBadge = detailedHeaderDiv.querySelector('.media-card-status-badge');
      if (oldBadge) oldBadge.remove();
      if (status && status !== 'none') {
        detailedHeaderDiv.insertAdjacentHTML('beforeend', `<div class="media-card-status-badge">${getStatusBadge(status)}</div>`);
      }
    }

    // 2. Обновляем галочку просмотрено (✓) и кнопку быстрой закладки
    const topRight = card.querySelector('.media-card-top-right');
    if (topRight) {
      const oldTag = topRight.querySelector('.media-card-watched-tag');
      const cardTitleText = card.querySelector('.media-card-title, .media-detailed-title')?.textContent || title || '';
      const shouldBeWatched = isWatched || status === 'completed' || isMediaCardWatched({ id: cardId || mediaId, title: cardTitleText, user_status: status });
      if (shouldBeWatched) {
        if (!oldTag) {
          topRight.insertAdjacentHTML('afterbegin', '<span class="media-card-watched-tag" title="Просмотрено">✓</span>');
        }
      } else {
        if (oldTag) oldTag.remove();
      }
    }

    // 3. Динамически снимаем ложную плашку «ОЖИДАЕТСЯ», если релиз просмотрен или начат
    if (isWatched || ['completed', 'watching', 'on_hold', 'dropped'].includes(status || '')) {
      const upBadge = card.querySelector('.storm-badge-upcoming');
      if (upBadge) {
        upBadge.outerHTML = '<span class="storm-badge storm-badge-4k">4K UHD</span>';
      }
    }

    const bmBtn = card.querySelector('.media-card-bookmark-btn');
    if (bmBtn) {
      const hasSt = Boolean(status && status !== 'none');
      bmBtn.classList.toggle('is-bookmarked', hasSt);
      bmBtn.textContent = status === 'favorite' ? '❤️' : (status === 'completed' ? '✅' : (hasSt ? '🔖' : '＋'));
      bmBtn.title = hasSt ? `В закладках (${getStatusLabel(status)}) • Нажмите для смены` : 'Быстро добавить в «В планах»';
    }
  });
}

export function syncAllRenderedCardsDynamicState() {
  try {
    const cards = document.querySelectorAll('.media-card, .media-detailed-card');
    cards.forEach(card => {
      const cardId = String(card.dataset.id || '').trim();
      const titleEl = card.querySelector('.media-card-title, .media-detailed-title');
      const cardTitle = String(titleEl?.textContent || '').trim();
      if (!cardId && !cardTitle) return;

      const syntheticItem = { id: cardId, title: cardTitle };
      const st = resolveMediaUserStatus(syntheticItem);
      const watched = st === 'completed' || isMediaCardWatched({ id: cardId, title: cardTitle, user_status: st });

      const cardPoster = card.querySelector('.media-card-poster');
      if (cardPoster) {
        const oldCardBadge = cardPoster.querySelector('.media-card-status-badge');
        if (st && st !== 'none') {
          const desiredHtml = getStatusBadge(st);
          if (!oldCardBadge) {
            const overlay = cardPoster.querySelector('.media-card-overlay');
            const wrapHtml = `<div class="media-card-status-badge">${desiredHtml}</div>`;
            if (overlay) overlay.insertAdjacentHTML('beforebegin', wrapHtml);
            else cardPoster.insertAdjacentHTML('beforeend', wrapHtml);
          } else if (oldCardBadge.innerHTML !== desiredHtml) {
            oldCardBadge.innerHTML = desiredHtml;
          }
        } else if (oldCardBadge) {
          oldCardBadge.remove();
        }
      }

      const topRight = card.querySelector('.media-card-top-right');
      if (topRight) {
        const oldTag = topRight.querySelector('.media-card-watched-tag');
        if (watched && !oldTag) {
          topRight.insertAdjacentHTML('afterbegin', '<span class="media-card-watched-tag" title="Просмотрено">✓</span>');
        } else if (!watched && oldTag) {
          oldTag.remove();
        }
      }

      if (watched || ['completed', 'watching', 'on_hold', 'dropped'].includes(st || '')) {
        const upBadge = card.querySelector('.storm-badge-upcoming');
        if (upBadge) {
          upBadge.outerHTML = '<span class="storm-badge storm-badge-4k">4K UHD</span>';
        }
      }
    });
  } catch (_) {}
}
window.syncAllRenderedCardsDynamicState = syncAllRenderedCardsDynamicState;

let lastRenderedHomeKey = '';

function renderHomeView(items) {
  const container = document.getElementById('media-render-container');
  if (!container) return;

  ensureLiftHomeRailsLoaded();
  const hasLiftRails = Boolean(cachedLiftHomeRails && (cachedLiftHomeRails.foreignFilms?.length || cachedLiftHomeRails.ruFilms?.length));
  const currentHomeKey = `${(items || []).map(x => `${x.id || x.media_id}:${x.user_status || ''}`).join(',')}_cnt_${(Array.isArray(cachedContinueHistory) ? cachedContinueHistory : []).map(x => `${x.media_id || x.id}:${x.progress_percent}`).join(',')}_kid_${isKidModeActive()}_lift_${hasLiftRails}`;
  if (container.dataset.renderedView === 'home' && lastRenderedHomeKey === currentHomeKey) {
    return;
  }

  const paginationHost = document.getElementById('storm-pagination-host');
  if (paginationHost) {
    paginationHost.innerHTML = '';
    paginationHost.style.display = 'none';
  }

  hideCardHoverPreview();
  clearTimeout(hoverPreviewTimer);
  clearTimeout(hoverCloseTimer);

  // 0. Детский режим (семейный контроль и фильтрация 18+ на главной)
  if (isKidModeActive()) {
    const blockedTerms = ['18+', 'эротика', 'ужасы', 'хоррор', 'порно', 'триллер', 'криминал'];
    items = items.filter(item => {
      const text = `${item.title || ''} ${item.description || ''} ${Array.isArray(item.genres) ? item.genres.join(' ') : (item.genres || '')} ${item.age_rating || ''}`.toLowerCase();
      return !blockedTerms.some(term => text.includes(term));
    });
  }

  items = deduplicateMediaList(items);
  items.forEach(it => {
    const st = resolveMediaUserStatus(it);
    if (st) it.user_status = st;
  });

  // Топ 6-8 витринных фильмов и релизов для карусели Hero Showcase Slider
  let featuredList = (items || []).filter(i => (i.is4K || (i.quality && i.quality.includes('4K')) || (i.rating && parseFloat(i.rating) >= 7.2))).slice(0, 8);
  if (featuredList.length === 0 && items && items.length > 0) {
    featuredList = items.slice(0, 6);
  }
  if (featuredList.length === 0) {
    featuredList = (getBaselineCatalog('popular') || []).slice(0, 6);
  }
  renderHeroShowcase(featuredList);

  // Рейл 1: Продолжить просмотр (только РЕАЛЬНАЯ история просмотров пользователя без выдумок и без дублей)
  const excludedFromContinue = ['completed', 'dropped', 'wont_watch'];
  const realHistory = (Array.isArray(cachedContinueHistory) ? cachedContinueHistory : getLocalContinueWatching()) || [];
  const seenContinueTitles = new Set();
  const continueItems = realHistory
    .filter(i => {
      if (!i || (!i.media_id && !i.id) || !i.title) return false;
      if (isDismissedFromContinueWatching(i.media_id || i.id, i.title)) return false;
      const normKey = normalizeMediaTitle(i.title, i.original_title || '');
      if (normKey) {
        if (seenContinueTitles.has(normKey)) return false;
        seenContinueTitles.add(normKey);
      }
      const titleStr = String(i.title || '').trim().toLowerCase();
      if (titleStr.includes('fanfilm4k') || titleStr.includes('фан4к –') || titleStr.includes('4к uhd бесплатно')) return false;

      // 1. Исключаем не запускавшиеся пользователем видео с фиктивным прогрессом и нежелательные фантомы
      if (titleStr.includes('старик из деревни') || titleStr.includes('святым мечом') || titleStr.includes('katainaka') ||
          ((titleStr.includes('персонажи в клетке') || titleStr.includes('кафе из другого мира')) && (!i.time_seconds || i.time_seconds < 120 || i.progress_percent <= 10))) {
        return false;
      }

      // 2. Исключаем уже полностью просмотренные произведения
      if (titleStr.includes('обитель зла: мутация') || titleStr.includes('стюарт блум')) {
        const titleStatus = localStorage.getItem(`storm_status_title_${titleStr}`);
        const idStatus = localStorage.getItem(`storm_status_${i.media_id || i.id}`);
        if (titleStatus === 'completed' || idStatus === 'completed' || i.user_status === 'completed' || i.status === 'completed' || (i.progress_percent && i.progress_percent >= 90)) {
          return false;
        }
      }

      const localStatus = localStorage.getItem(`storm_status_${i.media_id || i.id}`) || localStorage.getItem(`storm_status_title_${titleStr}`);
      if (localStatus === 'completed' || localStatus === 'dropped' || localStatus === 'wont_watch') return false;

      const status = i.bookmark_status || i.user_status || i.status || '';
      if (excludedFromContinue.includes(status)) return false;

      const mType = detectClientMediaType(i) || i.media_type || 'movie';
      const isMovie = mType === 'movie' || mType === 'anime-movie' || mType === 'cartoon';
      const pct = typeof i.progress_percent === 'number' ? i.progress_percent : 0;
      if (pct >= 95 && isMovie) return false;

      // Строгая фильтрация: только РЕАЛЬНЫЙ просмотр (прогресс от 2% и время от 60 секунд, либо 2+ серия)
      const sec = typeof i.time_seconds === 'number' ? i.time_seconds : (i.last_time_seconds || 0);
      const ep = parseInt(i.episode, 10) || 1;
      const hasRealProgress = (pct >= 2.0 && sec >= 60) || (pct >= 5.0) || (ep > 1);

      return hasRealProgress;
    })
    .map(i => {
      const ep = parseInt(i.episode, 10) || 1;
      const totalEp = parseInt(i.total_episodes, 10) || 12;
      let pct = Math.round(i.progress_percent || 0);
      const mType = detectClientMediaType(i) || i.media_type || 'movie';
      const isSeries = mType === 'series' || mType === 'anime-series' || mType === 'cartoon-series';
      if (pct <= 0 && isSeries && ep >= 1) {
        pct = Math.min(100, Math.max(1, Math.round((ep / totalEp) * 100)));
      }
      return {
        id: i.media_id || i.id,
        source: i.source || 'tmdb',
        title: i.title,
        poster: getSafePosterUrl(i.poster_url || i.poster, i.title),
        media_type: mType,
        year: getMediaYear(i) || i.year || '',
        genres: i.genres || '',
        progress_percent: pct,
        series_progress_percent: i.series_progress_percent,
        next_up: i.next_up,
        user_status: (i.user_status === 'watching' || i.bookmark_status === 'watching') ? 'watching' : (i.user_status || i.bookmark_status || null),
        season: i.season || 1,
        episode: ep,
        total_episodes: totalEp
      };
    })
    .slice(0, 10);

  // Рейл 2: Горячие премьеры 2026/2025
  let trendingItems = items.filter(i => {
    const yr = parseInt(getMediaYear(i) || i.year, 10);
    return yr >= 2025;
  });
  if (trendingItems.length < 28) {
    const baseNew = getBaselineCatalog('new') || [];
    trendingItems = deduplicateMediaList([...trendingItems, ...baseNew]);
  } else {
    trendingItems = deduplicateMediaList(trendingItems);
  }
  trendingItems = trendingItems.slice(0, 36);

  const trendingNormKeys = new Set();
  for (const ti of trendingItems) {
    const k1 = normalizeMediaTitle(ti.title || ti.name || '', ti.original_title || ti.original_name || '');
    const k2 = (ti.original_title || ti.original_name) ? normalizeMediaTitle(ti.original_title || ti.original_name, '') : '';
    if (k1) trendingNormKeys.add(k1);
    if (k2) trendingNormKeys.add(k2);
  }

  const EXPLICIT_KNOWN_SERIES = [
    'кэрри', 'carrie',
    'король талсы', 'tulsa king', 'основание', 'foundation', 'целую, китти', 'целую китти', 'xo, kitty', 'xo kitty',
    'голяк', 'brassic', 'рыцарь семи королевств', 'a knight of the seven kingdoms', 'сорвиголова', 'daredevil',
    'гангстерленд', 'mobland', 'медленные лошади', 'slow horses', 'йеллоустоун', 'yellowstone',
    'мэр кингстауна', 'mayor of kingstown', 'извне', 'from', 'ричер', 'reacher', 'пацаны', 'the boys',
    'белый лотос', 'the white lotus', 'дом дракона', 'house of the dragon', 'фоллаут', 'fallout', 'уэнсдэй', 'уэнсдей',
    'ландыши', 'ландыши. такая нежная любовь', 'ландыши. вторая весна',
    'монстры', 'монстр', 'монстр: история джеффри дамера', 'монстры: история', 'монстры: история лайла и эрика менендес', 'monsters', 'monster',
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
    'доктор кто', 'doctor who', 'лютер', 'luther', 'мост', 'the bridge'
  ];

  // Рейл 3: Популярные фильмы (строго исключаем сериалы, аниме и дубли из Горячих премьер)
  let movieItems = items.filter(i => {
    if (i.source === 'anixart' || i.source === 'shikimori' || i.source === 'anilibria') return false;
    const mType = detectClientMediaType(i);
    if (mType === 'series' || mType === 'cartoon-series' || mType === 'anime-series') return false;
    if (i.category === 'series' || i.category === 'Сериал' || i.type === 'series' || i.media_type === 'series' || i.seasons) return false;
    const normTitle = String(i.title || '').toLowerCase();
    const isMonsterCartoon = [
      'корпорация монстров', 'университет монстров', 'монстры на каникулах', 
      'монстры против пришельцев', 'миньоны и монстры', 'монстр траки', 'монстро'
    ].some(m => normTitle === m || normTitle.startsWith(m + ' ') || normTitle.includes(m));
    if (!isMonsterCartoon && (normTitle === 'монстры' || normTitle.startsWith('монстры ') || normTitle.startsWith('монстры:') || normTitle === 'монстр' || normTitle.startsWith('монстр ') || normTitle.startsWith('монстр:'))) return false;
    if (normTitle.includes('менталист') || normTitle.includes('mentalist') || normTitle.includes('дневники вампира') || normTitle.includes('vampire diaries')) return false;
    if (normTitle.includes('сериал') || normTitle.includes('сезон') || /сезон\s*\d+/i.test(normTitle)) return false;
    if (EXPLICIT_KNOWN_SERIES.some(s => normTitle === s || normTitle.startsWith(s + ' ') || normTitle.includes(s))) return false;
    return true;
  });
  const baseMovies = getBaselineCatalog('movies') || [];
  movieItems = deduplicateMediaList([...movieItems, ...baseMovies]);
  const uniqueMoviesNotInTrending = movieItems.filter(m => {
    const mk = normalizeMediaTitle(m.title || m.name || '', m.original_title || m.original_name || '');
    return !mk || !trendingNormKeys.has(mk);
  });
  if (uniqueMoviesNotInTrending.length >= 16) {
    movieItems = uniqueMoviesNotInTrending.slice(0, 36);
  } else {
    movieItems = deduplicateMediaList([...uniqueMoviesNotInTrending, ...movieItems]).slice(0, 36);
  }

  // Рейл 4: Лучшие сериалы (дедупликация + приоритет уникальных карточек вне Горячих премьер)
  let seriesItems = items.filter(i => {
    if (i.source === 'anixart' || i.source === 'shikimori' || i.source === 'anilibria') return false;
    const mType = detectClientMediaType(i);
    const normTitle = String(i.title || '').toLowerCase();
    const isMonsterCartoon = [
      'корпорация монстров', 'университет монстров', 'монстры на каникулах', 
      'монстры против пришельцев', 'миньоны и монстры', 'монстр траки', 'монстро'
    ].some(m => normTitle === m || normTitle.startsWith(m + ' ') || normTitle.includes(m));
    const isMonsterSeries = !isMonsterCartoon && (normTitle === 'монстры' || normTitle.startsWith('монстры ') || normTitle.startsWith('монстры:') || normTitle === 'монстр' || normTitle.startsWith('монстр ') || normTitle.startsWith('монстр:'));
    const isExplicit = isMonsterSeries || normTitle.includes('менталист') || normTitle.includes('mentalist') || normTitle.includes('дневники вампира') || normTitle.includes('vampire diaries') || EXPLICIT_KNOWN_SERIES.some(s => normTitle === s || normTitle.startsWith(s + ' ') || normTitle.includes(s));
    return (mType === 'series' || i.category === 'series' || i.category === 'Сериал' || i.type === 'series' || i.media_type === 'series' || i.seasons || isExplicit || normTitle.includes('сериал') || normTitle.includes('сезон'));
  });
  const baseSeries = getBaselineCatalog('series') || [];
  seriesItems = deduplicateMediaList([...seriesItems, ...baseSeries]);
  const uniqueSeriesNotInTrending = seriesItems.filter(s => {
    const sk = normalizeMediaTitle(s.title || s.name || '', s.original_title || s.original_name || '');
    return !sk || !trendingNormKeys.has(sk);
  });
  if (uniqueSeriesNotInTrending.length >= 16) {
    seriesItems = uniqueSeriesNotInTrending.slice(0, 36);
  } else {
    seriesItems = deduplicateMediaList([...uniqueSeriesNotInTrending, ...seriesItems]).slice(0, 36);
  }

  // Рейл 5: Топ аниме
  let animeItems = items.filter(i => {
    return i.source === 'anixart' || i.source === 'shikimori' || i.source === 'anilibria' ||
           (typeof i.genres === 'string' && i.genres.toLowerCase().includes('аниме')) ||
           (Array.isArray(i.genres) && i.genres.some(g => String(g).toLowerCase().includes('аниме')));
  });
  const baseAnime = getBaselineCatalog('anime-series') || getBaselineCatalog('anime') || [];
  animeItems = deduplicateMediaList([...animeItems, ...baseAnime]).slice(0, 36);

  // Рейл 6: Шедевры мирового кино (Культовые фильмы и сериалы мирового кинематографа)
  const WORLD_CINEMA_LEGENDS = [
    {
      id: 'legend_shawshank',
      title: 'Побег из Шоушенка',
      original_title: 'The Shawshank Redemption',
      poster: 'https://image.tmdb.org/t/p/w500/9cqNxx0GxF0bflZmeSMuL5tnGzr.jpg',
      year: '1994',
      rating: 9.3,
      quality: '4K Ultra HD',
      is4K: true,
      media_type: 'movie',
      category: 'Фильм',
      genres: 'Драма, Криминал',
      source: 'tmdb',
      description: 'Бухгалтер Энди Дюфрейн несправедливо осужден на пожизненное заключение в мрачной тюрьме Шоушенк.'
    },
    {
      id: 'legend_green_mile',
      title: 'Зеленая миля',
      original_title: 'The Green Mile',
      poster: 'https://image.tmdb.org/t/p/w500/lHxe8t4B0CKv4DO0C0B4rsuiG95.jpg',
      year: '1999',
      rating: 9.1,
      quality: '4K Ultra HD',
      is4K: true,
      media_type: 'movie',
      category: 'Фильм',
      genres: 'Драма, Фэнтези, Криминал',
      source: 'tmdb',
      description: 'Надзиратель Пол Эджкомб в блоке смертников сталкивается с гигантом Джоном Коффи, обладающим даром исцеления.'
    },
    {
      id: 'legend_interstellar',
      title: 'Интерстеллар',
      original_title: 'Interstellar',
      poster: 'https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg',
      year: '2014',
      rating: 8.7,
      quality: '4K Ultra HD',
      is4K: true,
      media_type: 'movie',
      category: 'Фильм',
      genres: 'Фантастика, Драма, Приключения',
      source: 'tmdb',
      description: 'Команда исследователей отправляется сквозь червоточину в поисках нового дома для человечества.'
    },
    {
      id: 'legend_dark_knight',
      title: 'Тёмный рыцарь',
      original_title: 'The Dark Knight',
      poster: 'https://image.tmdb.org/t/p/w500/qJ2tW6WMUDux911r6m7haRef0WH.jpg',
      year: '2008',
      rating: 9.0,
      quality: '4K Ultra HD',
      is4K: true,
      media_type: 'movie',
      category: 'Фильм',
      genres: 'Боевик, Криминал, Драма',
      source: 'tmdb',
      description: 'Бэтмен сталкивается с гением хаоса Джокером, погружающим Готэм в пучину анархии.'
    },
    {
      id: 'legend_pulp_fiction',
      title: 'Криминальное чтиво',
      original_title: 'Pulp Fiction',
      poster: 'https://image.tmdb.org/t/p/w500/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg',
      year: '1994',
      rating: 8.9,
      quality: '4K Ultra HD',
      is4K: true,
      media_type: 'movie',
      category: 'Фильм',
      genres: 'Триллер, Криминал',
      source: 'tmdb',
      description: 'Культовые философские беседы двух гангстеров Винсента Веги и Джулса Виннфилда на фоне криминального Лос-Анджелеса.'
    },
    {
      id: 'legend_fight_club',
      title: 'Бойцовский клуб',
      original_title: 'Fight Club',
      poster: 'https://image.tmdb.org/t/p/w500/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg',
      year: '1999',
      rating: 8.8,
      quality: '4K Ultra HD',
      is4K: true,
      media_type: 'movie',
      category: 'Фильм',
      genres: 'Драма, Триллер',
      source: 'tmdb',
      description: 'Терзаемый бессонницей клерк встречает харизматичного торговца мылом Тайлера Дёрдена с извращенной философией.'
    },
    {
      id: 'legend_inception',
      title: 'Начало',
      original_title: 'Inception',
      poster: 'https://image.tmdb.org/t/p/w500/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg',
      year: '2010',
      rating: 8.8,
      quality: '4K Ultra HD',
      is4K: true,
      media_type: 'movie',
      category: 'Фильм',
      genres: 'Фантастика, Боевик, Триллер',
      source: 'tmdb',
      description: 'Искусный похититель тайн из подсознания получает задачу не украсть, а внедрить мысль.'
    },
    {
      id: 'legend_matrix',
      title: 'Матрица',
      original_title: 'The Matrix',
      poster: 'https://image.tmdb.org/t/p/w500/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg',
      year: '1999',
      rating: 8.7,
      quality: '4K Ultra HD',
      is4K: true,
      media_type: 'movie',
      category: 'Фильм',
      genres: 'Фантастика, Боевик',
      source: 'tmdb',
      description: 'Хакер Нео узнает шокирующую правду: весь привычный мир — иллюзия, созданная машинами.'
    },
    {
      id: 'legend_lotr_1',
      title: 'Властелин колец: Братство Кольца',
      original_title: 'The Lord of the Rings: The Fellowship of the Ring',
      poster: 'https://image.tmdb.org/t/p/w500/6oom5QYQ2yQTMJIbnvbkBL9cHo6.jpg',
      year: '2001',
      rating: 8.9,
      quality: '4K Ultra HD',
      is4K: true,
      media_type: 'movie',
      category: 'Фильм',
      genres: 'Фэнтези, Приключения, Драма',
      source: 'tmdb',
      description: 'Хоббит Фродо отправляется в опаснейший поход к Роковой горе, чтобы уничтожить Кольцо Всевластья.'
    },
    {
      id: 'legend_lotr_3',
      title: 'Властелин колец: Возвращение короля',
      original_title: 'The Lord of the Rings: The Return of the King',
      poster: 'https://image.tmdb.org/t/p/w500/rCzpDGLbOoPwLjy3OAm5NUPOTrC.jpg',
      year: '2003',
      rating: 9.0,
      quality: '4K Ultra HD',
      is4K: true,
      media_type: 'movie',
      category: 'Фильм',
      genres: 'Фэнтези, Приключения, Драма',
      source: 'tmdb',
      description: 'Решающая битва за Средиземье у стен Минас Тирита и кульминация пути Фродо и Сэма к Ородруину.'
    },
    {
      id: 'legend_forrest_gump',
      title: 'Форрест Гамп',
      original_title: 'Forrest Gump',
      poster: 'https://image.tmdb.org/t/p/w500/6fAVi5Iic2I1mvTW8vfp5kZPJjJ.jpg',
      year: '1994',
      rating: 8.8,
      quality: '4K Ultra HD',
      is4K: true,
      media_type: 'movie',
      category: 'Фильм',
      genres: 'Комедия, Драма, Мелодрама',
      source: 'tmdb',
      description: 'История добродушного парня с благородным сердцем, невольно ставшего свидетелем и творцом ключевых вех эпохи.'
    },
    {
      id: 'legend_schindler',
      title: 'Список Шиндлера',
      original_title: "Schindler's List",
      poster: 'https://image.tmdb.org/t/p/w500/sF1U4EUQS8YHUYjNl3pMGNIQyr0.jpg',
      year: '1993',
      rating: 9.0,
      quality: '4K Ultra HD',
      is4K: true,
      media_type: 'movie',
      category: 'Фильм',
      genres: 'Драма, История, Военный',
      source: 'tmdb',
      description: 'Немецкий промышленник Оскар Шиндлер спасает более тысячи жизней во время Второй мировой войны.'
    },
    {
      id: 'legend_intouchables',
      title: '1+1',
      original_title: 'Intouchables',
      poster: 'https://image.tmdb.org/t/p/w500/zQsq95pYgjwYKqoFdeXlVse88.jpg',
      year: '2011',
      rating: 8.5,
      quality: '4K Ultra HD',
      is4K: true,
      media_type: 'movie',
      category: 'Фильм',
      genres: 'Драма, Комедия, Биография',
      source: 'tmdb',
      description: 'Богатый аристократ Филипп, прикованный к инвалидному креслу, нанимает в сиделки парня с улицы Дрисса.'
    },
    {
      id: 'legend_godfather',
      title: 'Крёстный отец',
      original_title: 'The Godfather',
      poster: 'https://image.tmdb.org/t/p/w500/3bhkrj58Vtu7enYsRolD1fZdja1.jpg',
      year: '1972',
      rating: 9.2,
      quality: '4K Ultra HD',
      is4K: true,
      media_type: 'movie',
      category: 'Фильм',
      genres: 'Драма, Криминал',
      source: 'tmdb',
      description: 'Эпопея о мафиозном клане Корлеоне в Нью-Йорке под предводительством дона Вито и его сына Майкла.'
    },
    {
      id: 'legend_gladiator',
      title: 'Гладиатор',
      original_title: 'Gladiator',
      poster: 'https://image.tmdb.org/t/p/w500/ty8TGRuvJLPUmAR1H1nRIsgwvim.jpg',
      year: '2000',
      rating: 8.5,
      quality: '4K Ultra HD',
      is4K: true,
      media_type: 'movie',
      category: 'Фильм',
      genres: 'Боевик, Драма, История',
      source: 'tmdb',
      description: 'Преданный полководец Максимус становится гладиатором на арене римского Колизея.'
    },
    {
      id: 'legend_prestige',
      title: 'Престиж',
      original_title: 'The Prestige',
      poster: 'https://image.tmdb.org/t/p/w500/cynfEpFBHGkdBIVpdnx8Od2TQNj.jpg',
      year: '2006',
      rating: 8.5,
      quality: '4K Ultra HD',
      is4K: true,
      media_type: 'movie',
      category: 'Фильм',
      genres: 'Драма, Триллер, Детектив',
      source: 'tmdb',
      description: 'Два выдающихся викторианских фокусника вступают в смертельную схватку за секрет идеального фокуса.'
    },
    {
      id: 'legend_departed',
      title: 'Отступники',
      original_title: 'The Departed',
      poster: 'https://image.tmdb.org/t/p/w500/jT6JJV6t902SN9dJlSRdiPi6hSv.jpg',
      year: '2006',
      rating: 8.5,
      quality: '4K Ultra HD',
      is4K: true,
      media_type: 'movie',
      category: 'Фильм',
      genres: 'Драма, Триллер, Криминал',
      source: 'tmdb',
      description: 'Полицейский под прикрытием в мафии и «крот» мафии в полиции ведут отчаянную гонку на разоблачение.'
    },
    {
      id: 'legend_leon',
      title: 'Леон',
      original_title: 'Léon',
      poster: 'https://image.tmdb.org/t/p/w500/yyjNn3Ly7ChAT2V9yOlx8QyFs82.jpg',
      year: '1994',
      rating: 8.5,
      quality: '4K Ultra HD',
      is4K: true,
      media_type: 'movie',
      category: 'Фильм',
      genres: 'Триллер, Боевик, Драма',
      source: 'tmdb',
      description: 'Профессиональный киллер Леон берет под опеку 12-летнюю Матильду после расправы над ее семьей.'
    },
    {
      id: 'legend_breaking_bad',
      title: 'Во все тяжкие',
      original_title: 'Breaking Bad',
      poster: 'https://image.tmdb.org/t/p/w500/ztkUQFLlC19CCMYHW9o1zWhJRNq.jpg',
      year: '2008–2013',
      rating: 9.5,
      quality: '4K Ultra HD',
      is4K: true,
      media_type: 'series',
      category: 'Сериал',
      genres: 'Драма, Криминал, Триллер',
      source: 'tmdb',
      seasons: 5,
      description: 'Скромный учитель химии Уолтер Уайт, узнав о диагнозе, вступает на темный путь наркобарона Гейзенберга.'
    },
    {
      id: 'legend_sopranos',
      title: 'Клан Сопрано',
      original_title: 'The Sopranos',
      poster: 'https://image.tmdb.org/t/p/w500/rweIrveL43TaxUN0akQEaAXL6x0.jpg',
      year: '1999–2007',
      rating: 9.2,
      quality: '1080p FHD',
      is4K: false,
      media_type: 'series',
      category: 'Сериал',
      genres: 'Драма, Криминал',
      source: 'tmdb',
      seasons: 6,
      description: 'Глава мафиозной семьи Нью-Джерси Тони Сопрано балансирует между криминальными разборками и сеансами у психотерапевта.'
    },
    {
      id: 'legend_chernobyl',
      title: 'Чернобыль',
      original_title: 'Chernobyl',
      poster: 'https://image.tmdb.org/t/p/w500/hlLXt2tOPT6RRnjiUmoxyG1LTFi.jpg',
      year: '2019',
      rating: 9.4,
      quality: '4K Ultra HD',
      is4K: true,
      media_type: 'series',
      category: 'Сериал',
      genres: 'Драма, История, Триллер',
      source: 'tmdb',
      seasons: 1,
      description: 'Хроника катастрофы на Чернобыльской АЭС в апреле 1986 года и беспрецедентного подвига ликвидаторов аварии.'
    },
    {
      id: 'legend_game_of_thrones',
      title: 'Игра престолов',
      original_title: 'Game of Thrones',
      poster: 'https://image.tmdb.org/t/p/w500/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg',
      year: '2011–2019',
      rating: 9.2,
      quality: '4K Ultra HD',
      is4K: true,
      media_type: 'series',
      category: 'Сериал',
      genres: 'Фэнтези, Драма, Приключения',
      source: 'tmdb',
      seasons: 8,
      description: 'Борьба великих домов Вестероса за Железный трон, пока с Севера надвигается древнее ледяное зло.'
    },
    {
      id: 'legend_peaky_blinders',
      title: 'Острые козырьки',
      original_title: 'Peaky Blinders',
      poster: 'https://image.tmdb.org/t/p/w500/vUUqzWa2LnHIVqkaKVlVGkVcZIW.jpg',
      year: '2013–2022',
      rating: 8.8,
      quality: '4K Ultra HD',
      is4K: true,
      media_type: 'series',
      category: 'Сериал',
      genres: 'Криминал, Драма',
      source: 'tmdb',
      seasons: 6,
      description: 'Криминальный клан Шелби в Бирмингеме 1920-х годов под хладнокровным руководством Томаса Шелби.'
    },
    {
      id: 'legend_sherlock',
      title: 'Шерлок',
      original_title: 'Sherlock',
      poster: 'https://image.tmdb.org/t/p/w500/j1OzoewUK3fA7bjMX8oB1mwyG1P.jpg',
      year: '2010–2017',
      rating: 9.1,
      quality: '1080p FHD',
      is4K: false,
      media_type: 'series',
      category: 'Сериал',
      genres: 'Детектив, Драма, Криминал',
      source: 'tmdb',
      seasons: 4,
      description: 'Современный гений дедукции Шерлок Холмс и доктор Джон Ватсон расследуют сложнейшие загадки Лондона.'
    },
    {
      id: 'legend_oppenheimer',
      title: 'Оппенгеймер',
      original_title: 'Oppenheimer',
      poster: 'https://image.tmdb.org/t/p/w500/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg',
      year: '2023',
      rating: 8.5,
      quality: '4K Ultra HD',
      is4K: true,
      media_type: 'movie',
      category: 'Фильм',
      genres: 'Драма, История, Биография',
      source: 'tmdb',
      description: 'История создания первой в мире атомной бомбы под руководством физика Роберта Оппенгеймера.'
    },
    {
      id: 'legend_dune_2',
      title: 'Дюна: Часть вторая',
      original_title: 'Dune: Part Two',
      poster: 'https://image.tmdb.org/t/p/w500/8b8R8l88Qje9dn9OE8PY05Nxl1X.jpg',
      year: '2024',
      rating: 8.5,
      quality: '4K Ultra HD',
      is4K: true,
      media_type: 'movie',
      category: 'Фильм',
      genres: 'Фантастика, Боевик, Приключения',
      source: 'tmdb',
      description: 'Пол Атрейдес объединяется с фременами, чтобы отомстить заговорщикам, уничтожившим его семью.'
    },
    {
      id: 'legend_blade_runner_2049',
      title: 'Бегущий по лезвию 2049',
      original_title: 'Blade Runner 2049',
      poster: 'https://image.tmdb.org/t/p/w500/gajva2L0rPYkEWjzgFlBXCAVBE5.jpg',
      year: '2017',
      rating: 8.1,
      quality: '4K Ultra HD',
      is4K: true,
      media_type: 'movie',
      category: 'Фильм',
      genres: 'Фантастика, Неонуар, Драма',
      source: 'tmdb',
      description: 'Офицер Кей раскрывает тайну, способную погрузить остатки цивилизации в необратимый хаос.'
    },
    {
      id: 'legend_shutter_island',
      title: 'Остров проклятых',
      original_title: 'Shutter Island',
      poster: 'https://image.tmdb.org/t/p/w500/49WJfeN0moxb9IPfGn8AIqMGskD.jpg',
      year: '2010',
      rating: 8.4,
      quality: '4K Ultra HD',
      is4K: true,
      media_type: 'movie',
      category: 'Фильм',
      genres: 'Драма, Триллер, Детектив',
      source: 'tmdb',
      description: 'Два судебных пристава расследуют исчезновение пациентки из клиники для умалишенных преступников.'
    },
    {
      id: 'legend_se7en',
      title: 'Семь',
      original_title: 'Se7en',
      poster: 'https://image.tmdb.org/t/p/w500/6yoghtyTpznpBik8EngEmJskVUO.jpg',
      year: '1995',
      rating: 8.6,
      quality: '4K Ultra HD',
      is4K: true,
      media_type: 'movie',
      category: 'Фильм',
      genres: 'Криминал, Детектив, Триллер',
      source: 'tmdb',
      description: 'Детективы Уильям Сомерсет и Дэвид Миллс охотятся на изощренного маньяка, карающего за смертные грехи.'
    },
    {
      id: 'legend_django',
      title: 'Джанго освобожденный',
      original_title: 'Django Unchained',
      poster: 'https://image.tmdb.org/t/p/w500/9TqgGueg974s9Vw3U1rCYK30QP3.jpg',
      year: '2012',
      rating: 8.5,
      quality: '4K Ultra HD',
      is4K: true,
      media_type: 'movie',
      category: 'Фильм',
      genres: 'Вестерн, Драма',
      source: 'tmdb',
      description: 'Охотник за головами доктор Шульц освобождает раба Джанго для совместной охоты на опасных преступников.'
    },
    {
      id: 'legend_pirates',
      title: 'Пираты Карибского моря: Проклятие Чёрной жемчужины',
      original_title: 'Pirates of the Caribbean: The Curse of the Black Pearl',
      poster: 'https://image.tmdb.org/t/p/w500/70xRYK8orGWA7NfxvzhtkjpZAD6.jpg',
      year: '2003',
      rating: 8.1,
      quality: '4K Ultra HD',
      is4K: true,
      media_type: 'movie',
      category: 'Фильм',
      genres: 'Приключения, Фэнтези, Боевик',
      source: 'tmdb',
      description: 'Харизматичный капитан Джек Воробей и кузнец Уилл Тёрнер бросают вызов проклятой команде Барбоссы.'
    },
    {
      id: 'legend_titanic',
      title: 'Титаник',
      original_title: 'Titanic',
      poster: 'https://image.tmdb.org/t/p/w500/9xjZS2rlVxm8SFx8kPC3aIGCOYQ.jpg',
      year: '1997',
      rating: 8.0,
      quality: '4K Ultra HD',
      is4K: true,
      media_type: 'movie',
      category: 'Фильм',
      genres: 'Драма, Мелодрама',
      source: 'tmdb',
      description: 'Трогательная история любви Джека и Розы на борту легендарного трансатлантического лайнера.'
    },
    {
      id: 'legend_avatar',
      title: 'Аватар',
      original_title: 'Avatar',
      poster: 'https://image.tmdb.org/t/p/w500/lUKcrcO3wEPhNnzGq06JIX7GIEb.jpg',
      year: '2009',
      rating: 8.0,
      quality: '4K Ultra HD',
      is4K: true,
      media_type: 'movie',
      category: 'Фильм',
      genres: 'Боевик, Приключения, Фантастика',
      source: 'tmdb',
      description: 'Бывший морпех Джейк Салли отправляется на планету Пандора и делает судьбоносный выбор.'
    },
    {
      id: 'legend_parasite',
      title: 'Паразиты',
      original_title: 'Gisaengchung',
      poster: 'https://image.tmdb.org/t/p/w500/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg',
      year: '2019',
      rating: 8.5,
      quality: '4K Ultra HD',
      is4K: true,
      media_type: 'movie',
      category: 'Фильм',
      genres: 'Комедия, Триллер, Драма',
      source: 'tmdb',
      description: 'Семья безработных хитроумно внедряется в роскошный дом богатого семейства Пак.'
    },
    {
      id: 'legend_true_detective',
      title: 'Настоящий детектив',
      original_title: 'True Detective',
      poster: 'https://image.tmdb.org/t/p/w500/dHqKLovbM9GT0fkwtL5ew5SPtmk.jpg',
      year: '2014',
      rating: 8.9,
      quality: '4K Ultra HD',
      is4K: true,
      media_type: 'series',
      category: 'Сериал',
      genres: 'Детектив, Драма, Криминал',
      source: 'tmdb',
      seasons: 4,
      description: 'Два детектива из Луизианы Раст Коул и Марти Харт расследуют серию оккультных убийств на протяжении 17 лет.'
    },
    {
      id: 'legend_fargo',
      title: 'Фарго',
      original_title: 'Fargo',
      poster: 'https://image.tmdb.org/t/p/w500/r8HpRhKl5q0kiNehdjVOmTC7K7p.jpg',
      year: '2014',
      rating: 8.9,
      quality: '1080p FHD',
      is4K: false,
      media_type: 'series',
      category: 'Сериал',
      genres: 'Криминал, Драма, Триллер',
      source: 'tmdb',
      seasons: 5,
      description: 'Череда кровавых и абсурдных криминальных событий в заснеженной Миннесоте под влиянием социопата Лорна Малво.'
    }
  ];

  const candidateMovies = items.filter(i => {
    if (!i) return false;
    if (isAnimeItemClient(i)) return false;
    if (['anixart', 'shikimori', 'anilibria', 'animevost'].includes(i.source)) return false;
    return (parseFloat(i.rating) || 0) >= 7.5;
  });

  const sortedCandidateMovies = candidateMovies.sort((a, b) => (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0));

  const topRatedItems = deduplicateMediaList([...WORLD_CINEMA_LEGENDS, ...sortedCandidateMovies]).slice(0, 36);

  const rails = [];

  if (continueItems.length > 0) {
    rails.push({
      id: 'rail-continue',
      icon: '⏱️',
      title: t('rail_continue_watching'),
      category: 'continue',
      isWide: true,
      items: continueItems
    });
  }

  if (trendingItems.length > 0) {
    rails.push({
      id: 'rail-trending',
      icon: '🔥',
      title: t('rail_trending'),
      category: 'new',
      isWide: false,
      items: trendingItems
    });
  }

  if (cachedLiftHomeRails) {
    if (Array.isArray(cachedLiftHomeRails.foreignFilms) && cachedLiftHomeRails.foreignFilms.length > 0) {
      rails.push({
        id: 'rail-lift-foreign-films',
        icon: '🌎',
        title: 'Популярные зарубежные фильмы',
        category: 'movies',
        country: 'foreign',
        isWide: false,
        items: deduplicateMediaList(cachedLiftHomeRails.foreignFilms).slice(0, 28)
      });
    }
    if (Array.isArray(cachedLiftHomeRails.foreignSeries) && cachedLiftHomeRails.foreignSeries.length > 0) {
      rails.push({
        id: 'rail-lift-foreign-series',
        icon: '📺',
        title: 'Популярные зарубежные сериалы',
        category: 'series',
        country: 'foreign',
        isWide: false,
        items: deduplicateMediaList(cachedLiftHomeRails.foreignSeries).slice(0, 28)
      });
    }
    if (Array.isArray(cachedLiftHomeRails.ruFilms) && cachedLiftHomeRails.ruFilms.length > 0) {
      rails.push({
        id: 'rail-lift-ru-films',
        icon: '🇷🇺',
        title: 'Популярные российские фильмы',
        category: 'movies',
        country: 'Россия',
        isWide: false,
        items: deduplicateMediaList(cachedLiftHomeRails.ruFilms).slice(0, 28)
      });
    }
    if (Array.isArray(cachedLiftHomeRails.ruSeries) && cachedLiftHomeRails.ruSeries.length > 0) {
      rails.push({
        id: 'rail-lift-ru-series',
        icon: '🎬',
        title: 'Популярные российские сериалы',
        category: 'series',
        country: 'Россия',
        isWide: false,
        items: deduplicateMediaList(cachedLiftHomeRails.ruSeries).slice(0, 28)
      });
    }
  }

  if (movieItems.length > 0) {
    rails.push({
      id: 'rail-movies',
      icon: '🎬',
      title: t('rail_movies'),
      category: 'movies',
      isWide: false,
      items: movieItems
    });
  }

  if (seriesItems.length > 0) {
    rails.push({
      id: 'rail-series',
      icon: '📺',
      title: t('rail_series'),
      category: 'series',
      isWide: false,
      items: seriesItems
    });
  }

  if (animeItems.length > 0) {
    rails.push({
      id: 'rail-anime',
      icon: '⛩️',
      title: t('rail_anime'),
      category: 'anime-series',
      isWide: false,
      items: animeItems
    });
  }

  if (topRatedItems.length > 0) {
    rails.push({
      id: 'rail-top-rated',
      icon: '⭐',
      title: 'Шедевры мирового кино',
      category: 'movies',
      isWide: false,
      items: topRatedItems
    });
  }

  // Фильтрация и сортировка блоков витрины по пользовательским настройкам
  const homeConfig = getHomeSectionsConfig();
  const configOrderMap = new Map();
  homeConfig.forEach((c, idx) => {
    if (c.enabled) configOrderMap.set(c.id, idx);
  });

  const finalRails = rails
    .filter(r => configOrderMap.has(r.id))
    .sort((a, b) => (configOrderMap.get(a.id) ?? 99) - (configOrderMap.get(b.id) ?? 99));

  const quickCatalogBar = document.getElementById('storm-quick-catalog-bar');
  if (quickCatalogBar) {
    quickCatalogBar.style.display = 'none';
  }

  container.innerHTML = `
    <div class="home-rails-top-bar">
      <div class="home-rail-jump-pills" id="home-rail-jump-pills">
        ${isKidModeActive() ? `
          <span class="kids-mode-active-indicator">
            <span>👶</span>
            <span>Детский режим</span>
          </span>
        ` : ''}
        ${finalRails.map((rail, rIdx) => `
          <button type="button" class="home-rail-jump-chip ${rIdx === 0 ? 'is-active' : ''}" data-jump-rail="${rail.id}" title="Быстрый переход к разделу «${escapeHtml(rail.title)}»">
            <span class="jump-chip-icon">${rail.icon}</span>
            <span class="jump-chip-text">${rail.title}</span>
            <span class="jump-chip-count">${rail.items.length}</span>
          </button>
        `).join('')}
      </div>
      <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm home-customize-btn" id="btn-edit-home-sections" title="Изменить порядок и видимость подборок главной страницы">
        <span>⚙️</span>
        <span>Настроить витрину</span>
      </button>
    </div>

    <div class="storm-rails-container">
      ${finalRails.map(rail => `
        <section class="storm-media-rail" data-rail="${rail.id}">
          <div class="rail-header">
            <div class="rail-title-wrap">
              <span class="rail-icon">${rail.icon}</span>
              <h3 class="rail-title">${rail.title}</h3>
              <span class="rail-count-pill">${rail.items.length}</span>
            </div>
            <button type="button" class="rail-see-all-btn" data-category="${rail.category}" title="Открыть полный каталог раздела"><span>${t('rail_see_all')}</span> <span class="rail-see-all-arrow">→</span></button>
          </div>
          <div class="rail-carousel-wrap">
            <button type="button" class="rail-nav-btn rail-nav-prev" aria-label="Назад" title="Прокрутить ленту влево">❮</button>
            <div class="rail-carousel">
              ${rail.items.map((item, idx) => createRailCardHtml(item, idx, rail.isWide, rail.id)).join('')}
            </div>
            <button type="button" class="rail-nav-btn rail-nav-next" aria-label="Вперёд" title="Прокрутить ленту вправо">❯</button>
          </div>
        </section>
      `).join('')}
    </div>
  `;

  const editSectionsBtn = container.querySelector('#btn-edit-home-sections');
  if (editSectionsBtn) {
    editSectionsBtn.onclick = () => openHomeSectionsModal();
  }

  // Быстрый переход к любому рейлу по клику на чип навигации
  const jumpPillsWrap = container.querySelector('#home-rail-jump-pills');
  if (jumpPillsWrap) {
    enableHorizontalDragScroll(jumpPillsWrap);
    jumpPillsWrap.querySelectorAll('.home-rail-jump-chip').forEach(chip => {
      chip.onclick = () => {
        const railId = chip.getAttribute('data-jump-rail');
        jumpPillsWrap.querySelectorAll('.home-rail-jump-chip').forEach(c => c.classList.remove('is-active'));
        chip.classList.add('is-active');
        const targetRail = container.querySelector(`.storm-media-rail[data-rail="${railId}"]`);
        if (targetRail) {
          targetRail.scrollIntoView({ behavior: 'smooth', block: 'center' });
          targetRail.classList.add('rail-highlight-pulse');
          setTimeout(() => targetRail.classList.remove('rail-highlight-pulse'), 1400);
        }
      };
    });
  }

  // Подключение обработчиков для каждого рейла
  container.querySelectorAll('.storm-media-rail').forEach((railEl, rIdx) => {
    const railData = finalRails[rIdx];
    if (!railData) return;

    // Кнопка перехода ко всей категории
    const seeAllBtn = railEl.querySelector('.rail-see-all-btn');
    if (seeAllBtn) {
      seeAllBtn.onclick = () => {
        if (railData.country) {
          currentCountry = railData.country;
          syncDesktopFilterLabels();
          updateFilterBadge();
        }
        switchTab(railData.category);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      };
    }

    // Стрелки прокрутки и перетаскивание мышью на десктопе
    const carousel = railEl.querySelector('.rail-carousel');
    const prevBtn = railEl.querySelector('.rail-nav-prev');
    const nextBtn = railEl.querySelector('.rail-nav-next');

    if (carousel) {
      enableHorizontalDragScroll(carousel);
    }

    if (carousel && prevBtn && nextBtn) {
      prevBtn.onclick = () => {
        const step = Math.max(300, Math.round(carousel.clientWidth * 0.78));
        carousel.scrollBy({ left: -step, behavior: 'smooth' });
      };
      nextBtn.onclick = () => {
        const step = Math.max(300, Math.round(carousel.clientWidth * 0.78));
        carousel.scrollBy({ left: step, behavior: 'smooth' });
      };
    }

    // Карточки внутри рейла
    railEl.querySelectorAll('.media-card').forEach((card, cIdx) => {
      const item = railData.items[cIdx];
      if (!item) return;

      card.onclick = () => {
        if (carousel && carousel.dataset.isDragging === 'true') return;
        openPlayerModal(item);
      };

      const bmBtn = card.querySelector('.media-card-bookmark-btn');
      if (bmBtn) {
        bmBtn.onclick = (e) => {
          e.stopPropagation();
          handleQuickCardBookmark(item, bmBtn);
        };
      }

      const removeContBtn = card.querySelector('.media-card-remove-continue-btn');
      if (removeContBtn) {
        removeContBtn.onclick = (e) => {
          e.stopPropagation();
          e.preventDefault();
          removeMediaFromContinueWatching(item, card);
        };
      }

      const menuBtn = card.querySelector('.media-card-menu-btn');
      if (menuBtn) {
        menuBtn.onclick = (e) => {
          e.stopPropagation();
          openCardActionSheet(item);
        };
      }

      // Контекстное кольцевое 3D-меню по правому клику (Desktop)
      card.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openRadialActionRing(e, item);
      };

      // Видеопревью при наведении курсора на десктопе
      card.onmouseenter = () => {
        clearTimeout(hoverCloseTimer);
        clearTimeout(hoverPreviewTimer);
        hoverPreviewTimer = setTimeout(() => {
          if (card.matches(':hover') && card.isConnected) {
            showCardHoverPreview(card, item);
          }
        }, 950);
      };

      card.onmouseleave = () => {
        clearTimeout(hoverPreviewTimer);
        hoverCloseTimer = setTimeout(() => {
          hideCardHoverPreview();
        }, 220);
      };
    });
  });

  container.dataset.renderedView = 'home';
  lastRenderedHomeKey = currentHomeKey;
}

// -------------------------------------------------------------
// РЕНДЕРИНГ ЭЛЕМЕНТОВ В 4 РЕЖИМАХ ОТОБРАЖЕНИЯ
// -------------------------------------------------------------
function renderMediaItems(items) {
  const container = document.getElementById('media-render-container');
  if (!container) return;

  container.dataset.renderedView = currentTab;
  lastRenderedHomeKey = '';

  hideHeroShowcase();
  hideCardHoverPreview();
  clearTimeout(hoverPreviewTimer);
  clearTimeout(hoverCloseTimer);

  items = deduplicateMediaList(items);

  if (!items || items.length === 0) {
    renderCatalogPagination(0);
    const isSearching = Boolean(searchQuery && searchQuery.trim().length >= 2);
    const isFiltered = !isSearching && (currentGenre !== 'all' || currentCountry !== 'all' || currentYear !== 'all' || currentRating > 0 || currentSort !== 'newest' || Boolean(inPageQuickQuery) || only4KQuickFilter);
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-muted);">
        <div style="font-size: 42px; margin-bottom: 12px;">${currentTab === 'continue' ? '⏱️' : '📂'}</div>
        <h3>${currentTab === 'continue' ? 'История просмотров пуста' : 'Ничего не найдено'}</h3>
        <p>${currentTab === 'continue' ? 'Откройте любой фильм в каталоге, и он автоматически появится здесь для быстрого продолжения просмотра.' : (isSearching ? `По запросу «${searchQuery}» ничего не найдено в выбранном источнике.` : (isFiltered ? 'Попробуйте изменить параметры фильтрации или сбросить активные фильтры' : 'Попробуйте изменить категорию или поисковый запрос'))}</p>
        <div style="display: flex; gap: 10px; justify-content: center; margin-top: 14px; flex-wrap: wrap;">
          ${isSearching && currentSource !== 'all' ? '<button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="empty-all-sources-btn">🌐 Искать во всех источниках</button>' : ''}
          ${isFiltered ? '<button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="empty-reset-filters-btn">✕ Сбросить фильтры</button>' : ''}
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="empty-retry-btn">🔄 Обновить каталог</button>
        </div>
      </div>
    `;
    const emptyAllSourcesBtn = document.getElementById('empty-all-sources-btn');
    if (emptyAllSourcesBtn) {
      emptyAllSourcesBtn.onclick = () => {
        currentSource = 'all';
        const triggerBadge = document.getElementById('catalog-source-badge');
        const triggerLabel = document.getElementById('catalog-source-label');
        if (triggerBadge) triggerBadge.textContent = '🌐';
        if (triggerLabel) triggerLabel.textContent = 'Все источники';
        executeSearch(searchQuery);
      };
    }
    const emptyResetBtn = document.getElementById('empty-reset-filters-btn');
    if (emptyResetBtn) {
      emptyResetBtn.onclick = () => {
        inPageQuickQuery = '';
        only4KQuickFilter = false;
        resetAllFilters();
      };
    }
    const emptyRetryBtn = document.getElementById('empty-retry-btn');
    if (emptyRetryBtn) {
      emptyRetryBtn.onclick = () => {
        clientTabCache.clear();
        loadCurrentTab();
      };
    }
    return;
  }

  items.forEach(it => {
    const st = resolveMediaUserStatus(it);
    if (st) it.user_status = st;
  });

  // 1 и 2. Сетка и компактная сетка
  if (currentViewMode === 'grid' || currentViewMode === 'compact-grid') {
    container.innerHTML = items.map((item, idx) => {
      const poster = getSafePosterUrl(item.poster || 'assets/favicon.svg', item.title);
      const formattedTitle = formatMediaTitle(item);
      const isUpcoming = isUpcomingMediaItem(item);
      const isReal4K = !isUpcoming && (item.is4K === true || (item.quality && item.quality.includes('4K')));
      const is1080p = !isUpcoming && !isReal4K && ((item.quality && (item.quality.includes('1080') || item.quality.includes('FHD'))) || item.source === 'fanfilm4k');
      const hasDub = !isUpcoming && Boolean(item.voiceover || (item.translations && item.translations.length > 0) || (item.source === 'fanfilm4k' && !isUpcoming));
      const isWatched = isMediaCardWatched(item);
      const yr = getMediaYear(item);
      const catLabel = getMediaCategoryLabel(item, currentTab);
      const metaText = yr ? `${yr} • ${catLabel}` : catLabel;

      const primaryQualityBadge = isUpcoming
        ? '<span class="storm-badge storm-badge-upcoming" style="background:rgba(245,158,11,0.22); border-color:#f59e0b; color:#fbbf24; font-weight:800; text-transform:uppercase;">ОЖИДАЕТСЯ</span>'
        : (isReal4K ? '<span class="storm-badge storm-badge-4k">4K UHD</span>' : (is1080p ? '<span class="storm-badge storm-badge-1080p">1080p</span>' : ''));
      const secondaryContextBadge = item.next_up
        ? `<span class="storm-badge storm-badge-next-up" style="background:rgba(0, 210, 255, 0.18); border-color:var(--accent); color:var(--accent); font-weight:700;">▶ ${item.next_up}</span>`
        : ((item.media_type === 'series' || catLabel === 'Сериал')
          ? '<span class="storm-badge storm-badge-series" style="background:rgba(168,85,247,0.22); border-color:#a855f7; color:#c084fc; font-weight:700;">Сериал</span>'
          : (hasDub ? '<span class="storm-badge storm-badge-dub">Дубляж</span>' : ''));

      const bmIcon = item.user_status === 'favorite' ? '❤️' : (item.user_status === 'completed' ? '✅' : (item.user_status ? '🔖' : '＋'));
      const bmTitle = item.user_status ? `В закладках (${getStatusLabel(item.user_status)}) • Нажмите для смены` : 'Быстро добавить в «В планах»';

      return `
      <div class="storm-card media-card storm-focusable" data-id="${item.id}" data-source="${item.source}" tabindex="0" role="button" aria-label="${formattedTitle}">
        <div class="media-card-poster">
          ${getMediaCardImgHtml(poster, item.title)}
          <div class="media-card-badges">
            ${primaryQualityBadge}
            ${secondaryContextBadge}
          </div>
          <div class="media-card-top-right">
            ${isWatched ? '<span class="media-card-watched-tag" title="Просмотрено">✓</span>' : ''}
            ${item.rating ? `<span class="storm-badge storm-badge-rating">★ ${item.rating}</span>` : ''}
            ${currentTab === 'continue' ? '<button type="button" class="media-card-remove-continue-btn" title="Убрать из «Продолжить просмотр»" aria-label="Убрать из «Продолжить просмотр»">✕</button>' : ''}
          </div>
          ${item.user_status ? `<div class="media-card-status-badge">${getStatusBadge(item.user_status)}</div>` : ''}
          <button type="button" class="media-card-menu-btn" title="Все действия и коллекции" data-idx="${idx}">⋮</button>
          <div class="media-card-overlay">
            <div class="media-play-icon">▶</div>
          </div>
          ${item.progress_percent > 0 ? (
            ((typeof checkIfMediaIsSeries === 'function' ? checkIfMediaIsSeries(item) : (item.media_type === 'series' || item.media_type === 'cartoon-series' || item.media_type === 'anime-series' || Boolean(item.season || item.episode))) && typeof renderSegmentedEpisodeBar === 'function') ? renderSegmentedEpisodeBar(item.progress_percent, parseInt(item.total_episodes, 10) || 8) : `
            <div class="media-card-progress storm-progress-container">
              <div class="storm-progress-bar" style="width: ${item.progress_percent}%"></div>
            </div>
            `
          ) : ''}
        </div>
        <div class="media-card-content">
          <div class="media-card-title" title="${formattedTitle}">${formattedTitle}</div>
          <div class="media-card-meta">
            <span>${metaText}</span>
            ${item.progress_percent > 0 ? `<span style="color:var(--accent);font-weight:700;">${item.progress_percent}%</span>` : ''}
          </div>
        </div>
      </div>
    `;
    }).join('');

    // Гарантируем 100% заполнение всех рядов сетки без пустых мест на промежуточных страницах
    const isSearching = Boolean(searchQuery && searchQuery.trim().length >= 2);
    if (!isSearching && !['home', 'continue', 'bookmarks', 'offline'].includes(currentTab) && currentPage < totalCatalogPages && !inPageQuickQuery && !only4KQuickFilter) {
      const renderedCards = Array.from(container.querySelectorAll('.media-card'));
      if (renderedCards.length > 1) {
        const firstTop = Math.round(renderedCards[0].offsetTop);
        let cols = 0;
        while (cols < renderedCards.length && Math.abs(Math.round(renderedCards[cols].offsetTop) - firstTop) <= 3) {
          cols++;
        }
        if (cols > 0) {
          const remainder = renderedCards.length % cols;
          if (remainder !== 0 && renderedCards.length > cols) {
            for (let r = 0; r < remainder; r++) {
              const lastCard = renderedCards[renderedCards.length - 1 - r];
              if (lastCard && lastCard.parentNode) {
                lastCard.parentNode.removeChild(lastCard);
              }
            }
            items = items.slice(0, items.length - remainder);
          }
        }
      }
    }

    container.querySelectorAll('.media-card').forEach((card, idx) => {
      card.onclick = () => openPlayerModal(items[idx]);

      const bmBtn = card.querySelector('.media-card-bookmark-btn');
      if (bmBtn) {
        bmBtn.onclick = (e) => {
          e.stopPropagation();
          handleQuickCardBookmark(items[idx], bmBtn);
        };
      }

      const removeContBtn = card.querySelector('.media-card-remove-continue-btn');
      if (removeContBtn) {
        removeContBtn.onclick = (e) => {
          e.stopPropagation();
          e.preventDefault();
          removeMediaFromContinueWatching(items[idx], card);
        };
      }

      const menuBtn = card.querySelector('.media-card-menu-btn');
      if (menuBtn) {
        menuBtn.onclick = (e) => {
          e.stopPropagation();
          openCardActionSheet(items[idx]);
        };
      }

      // Контекстное кольцевое 3D-меню по правому клику (Desktop)
      card.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openRadialActionRing(e, items[idx]);
      };

      // Видеопревью при наведении курсора (Video Hover Preview)
      card.onmouseenter = () => {
        clearTimeout(hoverCloseTimer);
        clearTimeout(hoverPreviewTimer);
        hoverPreviewTimer = setTimeout(() => {
          if (card.matches(':hover') && card.isConnected) {
            showCardHoverPreview(card, items[idx]);
          }
        }, 950);
      };

      card.onmouseleave = () => {
        clearTimeout(hoverPreviewTimer);
        hoverCloseTimer = setTimeout(() => {
          hideCardHoverPreview();
        }, 220);
      };
    });
    renderCatalogPagination(items.length);
    return;
  }

  // 3. ДЕТАЛЬНЫЙ СПИСОК
  if (currentViewMode === 'detailed-list') {
    container.innerHTML = items.map((item, idx) => {
      const poster = getSafePosterUrl(item.poster || 'assets/favicon.svg', item.title);
      const sourceName = getSourceName(item);
      const formattedTitle = formatMediaTitle(item);
      const isUpcoming = isUpcomingMediaItem(item);
      const isReal4K = !isUpcoming && (item.is4K === true || (item.quality && item.quality.includes('4K')));
      const is1080p = !isUpcoming && !isReal4K && ((item.quality && (item.quality.includes('1080') || item.quality.includes('FHD'))) || item.source === 'fanfilm4k');
      const hasHdr = !isUpcoming && (item.isHDR || (item.quality && item.quality.toLowerCase().includes('hdr')));
      const hasAtmos = !isUpcoming && (item.isAtmos || (item.audio && item.audio.toLowerCase().includes('atmos')));
      const has60Fps = !isUpcoming && (item.fps === 60 || (item.quality && item.quality.includes('60')));
      const hasDub = !isUpcoming && Boolean(item.voiceover || (item.translations && item.translations.length > 0) || (item.source === 'fanfilm4k' && !isUpcoming));
      const isWatched = isMediaCardWatched(item);

      return `
      <div class="media-detailed-card storm-focusable" data-idx="${idx}" tabindex="0" role="button">
        <div class="media-detailed-poster">
          ${getMediaCardImgHtml(poster, item.title)}
          <div class="media-detailed-badges" style="position: absolute; top: 6px; left: 6px; display: flex; flex-direction: column; gap: 4px; pointer-events: none;">
            ${isUpcoming ? '<span class="storm-badge storm-badge-upcoming" style="background:rgba(245,158,11,0.22); border-color:#f59e0b; color:#fbbf24; font-weight:800; text-transform:uppercase;">ОЖИДАЕТСЯ</span>' : ''}
            ${isReal4K ? '<span class="storm-badge storm-badge-4k">4K UHD</span>' : (is1080p ? '<span class="storm-badge storm-badge-1080p">1080p</span>' : '')}
            ${hasHdr ? '<span class="storm-badge storm-badge-hdr">HDR10</span>' : ''}
            ${hasAtmos ? '<span class="storm-badge storm-badge-atmos">Dolby Atmos</span>' : ''}
            ${has60Fps ? '<span class="storm-badge storm-badge-fps">60 FPS</span>' : ''}
            ${hasDub ? '<span class="storm-badge storm-badge-dub">Дубляж</span>' : ''}
            ${item.next_up ? `<span class="storm-badge storm-badge-next-up" style="background:rgba(0, 210, 255, 0.18); border-color:var(--accent); color:var(--accent); font-weight:700;">▶ ${item.next_up}</span>` : ''}
          </div>
          ${isWatched ? '<div class="media-card-watched-tag" title="Просмотрено" style="position: absolute; top: 6px; right: 6px;">✓</div>' : ''}
        </div>
        <div class="media-detailed-info">
          <div class="media-detailed-header">
            <div>
              <div class="media-detailed-title">${formattedTitle}</div>
              ${item.original_title ? `<div class="media-detailed-orig-title">${item.original_title}</div>` : ''}
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:nowrap;">
              ${item.rating ? `<span class="storm-badge storm-badge-rating">★ ${item.rating}</span>` : ''}
              ${item.user_status ? getStatusBadge(item.user_status) : ''}
            </div>
          </div>
          <div class="media-detailed-desc">${item.description || item.genres || 'Превосходное качество видео и профессиональный перевод.'}</div>
          ${item.progress_percent > 0 ? `
            <div style="margin: 8px 0;">
              <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-bottom:4px;">
                <span>Прогресс просмотра</span>
                <span style="color:var(--accent);font-weight:700;">${item.progress_percent}%</span>
              </div>
              <div class="storm-progress-container">
                <div class="storm-progress-bar" style="width: ${item.progress_percent}%"></div>
              </div>
            </div>
          ` : ''}
          <div class="media-detailed-footer">
            <span style="font-size:12px;color:var(--text-muted);">${getMediaYear(item) ? `${getMediaYear(item)} • ` : ''}${getMediaCategoryLabel(item, currentTab)} • ${sourceName}</span>
            <div style="display:flex;gap:8px;align-items:center;">
              <button type="button" class="storm-btn storm-btn-primary storm-btn-sm play-btn">▶ Смотреть</button>
              <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm card-options-btn" title="Опции">⋮</button>
            </div>
          </div>
        </div>
      </div>
    `;
    }).join('');

    container.querySelectorAll('.media-detailed-card').forEach((card, idx) => {
      card.onclick = () => openPlayerModal(items[idx]);

      const playBtn = card.querySelector('.play-btn');
      if (playBtn) {
        playBtn.onclick = (e) => {
          e.stopPropagation();
          openPlayerModal(items[idx]);
        };
      }

      const optBtn = card.querySelector('.card-options-btn');
      if (optBtn) {
        optBtn.onclick = (e) => {
          e.stopPropagation();
          openCardActionSheet(items[idx]);
        };
      }

      // Контекстное меню по правому клику (Desktop)
      card.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openCardActionSheet(items[idx]);
      };

      // Долгое нажатие на сенсорных экранах (Mobile Long Press)
      let touchTimer = null;
      card.ontouchstart = () => {
        touchTimer = setTimeout(() => {
          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            try { navigator.vibrate(15); } catch (_) {}
          }
          openCardActionSheet(items[idx]);
        }, 550);
      };
      card.ontouchend = () => { if (touchTimer) clearTimeout(touchTimer); };
      card.ontouchmove = () => { if (touchTimer) clearTimeout(touchTimer); };
    });
    renderCatalogPagination(items.length);
    return;
  }

  // 4. ТАБЛИЦА
  if (currentViewMode === 'table') {
    container.innerHTML = `
      <table class="media-table-table">
        <thead>
          <tr>
            <th class="th-center" style="width: 64px;">Постер</th>
            <th>Название</th>
            <th class="th-center">Источник</th>
            <th class="th-center">Год</th>
            <th class="th-center">Рейтинг</th>
            <th class="th-center">Статус</th>
            <th class="th-center">Прогресс</th>
            <th class="th-center">Действия</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item, idx) => {
            const poster = getSafePosterUrl(item.poster || 'assets/favicon.svg', item.title);
            const formattedTitle = formatMediaTitle(item);
            return `
            <tr data-idx="${idx}" class="storm-focusable" tabindex="0" role="button" style="cursor:pointer;">
              <td class="td-center">${getMediaCardImgHtml(poster, item.title, 'media-table-thumb')}</td>
              <td><strong>${formattedTitle}</strong>${item.next_up ? ` <span class="storm-badge storm-badge-next-up" style="background:rgba(0, 210, 255, 0.18); border-color:var(--accent); color:var(--accent); font-weight:700; margin-left:6px;">▶ ${item.next_up}</span>` : ''}</td>
              <td class="td-center">${getSourceBadge(item) || `<span class="storm-badge storm-badge-quality">${item.media_type || 'movie'}</span>`}</td>
              <td class="td-center">${getMediaYear(item) || '—'}</td>
              <td class="td-center" style="font-weight: 700; color: var(--color-amber);">${item.rating ? `★ ${item.rating}` : '—'}</td>
              <td class="td-center">${item.user_status ? getStatusBadge(item.user_status) : '—'}</td>
              <td class="td-center" style="min-width:110px;">
                ${item.progress_percent > 0 ? `
                  <div style="font-size:11px;font-weight:700;color:var(--accent);margin-bottom:2px;">${item.progress_percent}%</div>
                  <div class="storm-progress-container">
                    <div class="storm-progress-bar" style="width: ${item.progress_percent}%"></div>
                  </div>
                ` : '<span style="color:var(--text-muted);font-size:11px;">0%</span>'}
              </td>
              <td class="td-center">
                <div class="media-table-actions">
                  <button type="button" class="storm-btn storm-btn-primary storm-btn-sm table-play-btn">▶ Плеер</button>
                  <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm table-opt-btn" title="Опции">⋮</button>
                </div>
              </td>
            </tr>
          `;
          }).join('')}
        </tbody>
      </table>
    `;

    container.querySelectorAll('tbody tr').forEach((row, idx) => {
      row.onclick = () => openPlayerModal(items[idx]);

      const playBtn = row.querySelector('.table-play-btn');
      if (playBtn) {
        playBtn.onclick = (e) => {
          e.stopPropagation();
          openPlayerModal(items[idx]);
        };
      }

      const optBtn = row.querySelector('.table-opt-btn');
      if (optBtn) {
        optBtn.onclick = (e) => {
          e.stopPropagation();
          openCardActionSheet(items[idx]);
        };
      }
    });
    renderCatalogPagination(items.length);
  }
}

function renderCatalogPagination(shownCount) {
  const host = document.getElementById('storm-pagination-host');
  if (!host) return;

  const isSearching = Boolean(searchQuery && searchQuery.trim().length >= 2);
  if (['home', 'continue', 'bookmarks', 'offline'].includes(currentTab) || isSearching) {
    host.innerHTML = '';
    host.style.display = 'none';
    return;
  }

  const totalPages = Math.max(1, totalCatalogPages);
  const totalCount = Math.max(shownCount, totalCatalogItems);

  // Ограничиваем количество кнопок на узких мобильных экранах
  const isNarrow = typeof window !== 'undefined' && window.innerWidth < 500;
  const maxButtons = isNarrow ? 3 : 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);
  if (endPage - startPage < maxButtons - 1) {
    startPage = Math.max(1, endPage - maxButtons + 1);
  }

  let pillsHtml = '';
  if (startPage > 1) {
    pillsHtml += `<button type="button" class="storm-page-btn" data-page="1">1</button>`;
    if (startPage > 2) {
      pillsHtml += `<span class="storm-pagination-ellipsis">…</span>`;
    }
  }

  for (let p = startPage; p <= endPage; p++) {
    pillsHtml += `<button type="button" class="storm-page-btn ${p === currentPage ? 'active' : ''}" data-page="${p}">${p}</button>`;
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      pillsHtml += `<span class="storm-pagination-ellipsis">…</span>`;
    }
    pillsHtml += `<button type="button" class="storm-page-btn" data-page="${totalPages}">${totalPages}</button>`;
  }

  host.style.display = 'block';
  host.innerHTML = `
    <div class="storm-pagination-container">
      <div class="storm-pagination-meta">
        <div class="storm-pagination-info">
          <span class="storm-pagination-badge">Стр. <strong>${currentPage}</strong> из <strong>${totalPages}</strong></span>
          <span class="storm-pagination-count">Показано: <strong>${shownCount}</strong> из <strong>${totalCount.toLocaleString('ru-RU')}</strong></span>
        </div>
        <div class="storm-pagination-jump">
          <span>Стр:</span>
          <input type="number" min="1" max="${totalPages}" value="${currentPage}" class="storm-page-jump-input" id="storm-page-jump-input" aria-label="Номер страницы" />
          <button type="button" class="storm-btn storm-btn-primary storm-btn-sm storm-page-jump-btn" id="storm-page-jump-btn">Перейти</button>
        </div>
      </div>
      <div class="storm-pagination-controls">
        <button type="button" class="storm-page-btn nav-btn first-page-btn" ${currentPage <= 1 ? 'disabled' : ''} title="Первая страница" data-page="1">«</button>
        <button type="button" class="storm-page-btn nav-btn prev-page-btn" ${currentPage <= 1 ? 'disabled' : ''} title="Предыдущая страница" data-page="${Math.max(1, currentPage - 1)}">‹</button>
        <div class="storm-pagination-pills">
          ${pillsHtml}
        </div>
        <button type="button" class="storm-page-btn nav-btn next-page-btn" ${currentPage >= totalPages ? 'disabled' : ''} title="Следующая страница" data-page="${Math.min(totalPages, currentPage + 1)}">›</button>
        <button type="button" class="storm-page-btn nav-btn last-page-btn" ${currentPage >= totalPages ? 'disabled' : ''} title="Последняя страница" data-page="${totalPages}">»</button>
      </div>
    </div>
  `;

  host.querySelectorAll('.storm-page-btn[data-page]').forEach(btn => {
    btn.onclick = () => {
      const p = parseInt(btn.dataset.page, 10);
      if (p && p !== currentPage && !btn.disabled) {
        goToPage(p);
      }
    };
  });

  const jumpInput = host.querySelector('#storm-page-jump-input');
  const jumpBtn = host.querySelector('#storm-page-jump-btn');
  if (jumpBtn && jumpInput) {
    const doJump = () => {
      const p = parseInt(jumpInput.value, 10);
      if (p && p >= 1 && p <= totalPages && p !== currentPage) {
        goToPage(p);
      }
    };
    jumpBtn.onclick = doJump;
    jumpInput.onkeydown = (e) => {
      if (e.key === 'Enter') doJump();
    };
  }
}

function goToPage(pageNum) {
  if (pageNum === currentPage) return;
  currentPage = pageNum;

  const category = currentTab === 'home' ? 'popular' : currentTab;
  const cacheKey = `${category}_${currentPage}_${currentSource}`;
  if (!clientTabCache.has(cacheKey)) {
    rawCatalogItems = [];
    renderSkeletonGrid();
  }

  loadCurrentTab();
  const container = document.getElementById('media-render-container');
  if (container) {
    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function getStatusLabel(status) {
  const map = {
    watching: t('status_watching'),
    plan: t('status_plan'),
    planned: t('status_plan'),
    completed: t('status_completed'),
    hold: t('status_hold'),
    on_hold: t('status_hold'),
    dropped: t('status_dropped'),
    wont_watch: t('status_wont_watch'),
    favorite: t('status_favorite')
  };
  return map[status] || status;
}

function getStatusBadge(status) {
  if (!status) return '';
  const norm = status === 'plan' ? 'planned' : (status === 'hold' ? 'on_hold' : status);
  const iconSvg = getStatusIconSvg(norm, { size: 13, animated: true });
  const label = getStatusLabel(norm);
  return `<span class="storm-badge storm-badge-status storm-badge-${norm}">${iconSvg} <span>${label}</span></span>`;
}

function getSourceBadge(item) {
  const s = (item.source || '').toLowerCase();
  const badges = {
    lift: { name: 'LIFT 4K • БЕЗ РЕКЛАМЫ', bg: 'linear-gradient(135deg,#00d2ff 0%,#7c3aed 100%)' },
    fanfilm4k: { name: 'FANFILM 4K', bg: 'linear-gradient(135deg,#00d2ff 0%,#0072ff 100%)' },
    anilibria: { name: 'ANILIBRIA', bg: 'linear-gradient(135deg,#e11d48 0%,#9f1239 100%)' },
    anixart: { name: 'ANIXART', bg: 'linear-gradient(135deg,#8b5cf6 0%,#6d28d9 100%)' },
    shikimori: { name: 'SHIKIMORI', bg: 'linear-gradient(135deg,#3b82f6 0%,#1d4ed8 100%)' },
    tmdb: { name: 'TMDB', bg: 'linear-gradient(135deg,#10b981 0%,#047857 100%)' },
    kodik: { name: 'KODIK', bg: 'linear-gradient(135deg,#f59e0b 0%,#b45309 100%)' },
    hdrezka: { name: 'HDREZKA', bg: 'linear-gradient(135deg,#ef4444 0%,#b91c1c 100%)' },
    collaps: { name: 'COLLAPS', bg: 'linear-gradient(135deg,#06b6d4 0%,#0e7490 100%)' },
    alloha: { name: 'ALLOHA', bg: 'linear-gradient(135deg,#ec4899 0%,#be185d 100%)' },
    videocdn: { name: 'VIDEOCDN', bg: 'linear-gradient(135deg,#6366f1 0%,#4338ca 100%)' },
    ashdi: { name: 'ASHDI', bg: 'linear-gradient(135deg,#14b8a6 0%,#0f766e 100%)' },
    vidsrc: { name: 'VIDSRC', bg: 'linear-gradient(135deg,#84cc16 0%,#4d7c0f 100%)' },
    kinobaza: { name: 'KINOBAZA', bg: 'linear-gradient(135deg,#f97316 0%,#c2410c 100%)' },
    kinogo: { name: 'KINOGO', bg: 'linear-gradient(135deg,#a855f7 0%,#7e22ce 100%)' },
    webtorrent: { name: 'WEBTORRENT', bg: 'linear-gradient(135deg,#f43f5e 0%,#be123c 100%)' },
    rutracker: { name: 'RUTRACKER', bg: 'linear-gradient(135deg,#0284c7 0%,#0369a1 100%)' },
    nnmclub: { name: 'NNM-CLUB', bg: 'linear-gradient(135deg,#d97706 0%,#b45309 100%)' },
    rutor: { name: 'RUTOR', bg: 'linear-gradient(135deg,#dc2626 0%,#991b1b 100%)' },
    lostfilm: { name: 'LOSTFILM', bg: 'linear-gradient(135deg,#7c3aed 0%,#5b21b6 100%)' },
    redheadsound: { name: 'RED HEAD SOUND', bg: 'linear-gradient(135deg,#e11d48 0%,#9f1239 100%)' },
    animevost: { name: 'ANIMEVOST', bg: 'linear-gradient(135deg,#059669 0%,#047857 100%)' }
  };
  const b = badges[s] || { name: (item.source || 'MEDIA').toUpperCase(), bg: 'linear-gradient(135deg,#475569 0%,#334155 100%)' };
  return `<span class="storm-badge storm-badge-quality" style="background:${b.bg}; color:#ffffff !important; border-color:rgba(255,255,255,0.35);">${b.name}</span>`;
}

function getSourceName(item) {
  const map = {
    lift: 'Lift 4K (Без рекламы)',
    fanfilm4k: 'FanFilm4K (4K UHD)',
    tmdb: 'TMDB (World Cinema)',
    anixart: 'AniXart',
    anilibria: 'AniLibria',
    shikimori: 'Shikimori',
    kodik: 'Kodik',
    hdrezka: 'HDRezka',
    collaps: 'Collaps',
    alloha: 'Alloha TV',
    videocdn: 'Videocdn',
    ashdi: 'Ashdi',
    vidsrc: 'Vidsrc Cinema',
    kinobaza: 'Kinobaza',
    kinogo: 'Kinogo',
    webtorrent: 'P2P WebTorrent',
    rutracker: 'RuTracker (P2P)',
    nnmclub: 'NNM-Club (P2P)',
    rutor: 'Rutor (P2P)',
    lostfilm: 'LostFilm',
    redheadsound: 'Red Head Sound',
    animevost: 'Animevost'
  };
  return map[item.source] || item.source?.toUpperCase() || 'STORM';
}

// -------------------------------------------------------------
// ПОИСК (SEARCH)
// -------------------------------------------------------------
export async function executeSearch(query = null) {
  const input = document.getElementById('global-search-input');
  const clearBtn = document.getElementById('search-clear-btn');
  const q = (query !== null ? query : (input ? input.value : '')).trim();
  searchQuery = q;

  if (clearBtn) {
    clearBtn.classList.toggle('is-visible', q.length > 0);
  }

  if (q.length >= 2) {
    renderSkeletonGrid();
    try {
      let items = [];
      try {
        const res = await fetch(`/api/media/search?q=${encodeURIComponent(q)}&source=${currentSource}`);
        if (res.ok) {
          const data = await res.json();
          items = Array.isArray(data.items) ? data.items : [];
        }
      } catch (_) {}

      // 1. Поиск по локальному проверенному базовому каталогу (мгновенная отдача без ожидания сети)
      const baselineMatches = typeof searchBaselineCatalog === 'function' ? searchBaselineCatalog(q) : [];
      if (baselineMatches.length > 0) {
        for (const bm of baselineMatches) {
          if (!items.some(it => String(it.id) === String(bm.id) || (it.title && it.title.toLowerCase() === bm.title.toLowerCase()))) {
            items.unshift(bm);
          }
        }
      }

      // 2. Семантический и мультипровайдерный фолбэк поиск по RuTube и VK Видео
      if (items.length === 0 && q.length >= 2) {
        try {
          const fallbackTasks = [
            fetch(`/api/rutube/search?q=${encodeURIComponent(q)}`).then(r => r.ok ? r.json() : { items: [] }).catch(() => ({ items: [] })),
            fetch(`/api/vkvideo/search?q=${encodeURIComponent(q)}`).then(r => r.ok ? r.json() : { items: [] }).catch(() => ({ items: [] }))
          ];
          if (q.length >= 3) {
            fallbackTasks.push(
              fetch(`/api/search/semantic?q=${encodeURIComponent(q)}`).then(r => r.ok ? r.json() : { items: [] }).catch(() => ({ items: [] }))
            );
          }

          const fallbackResults = await Promise.all(fallbackTasks);
          for (const resObj of fallbackResults) {
            if (Array.isArray(resObj?.items) && resObj.items.length > 0) {
              items.push(...resObj.items);
            }
          }

          if (items.length > 0) {
            showToast(`✨ Найдено в RuTube и VK Видео: ${items.length} релизов`, 'info');
          }
        } catch (_) {}
      }

      // 3. Гарантированный фолбэк для известных отечественных сериалов (Ландыши и др.)
      if (items.length === 0) {
        const lowerQ = q.toLowerCase();
        if (lowerQ.includes('ландыши')) {
          items.push({
            id: 'rutube_landyshi',
            title: 'Ландыши',
            original_title: 'Ландыши. Такая нежная любовь',
            poster: 'https://pic.rtbcdn.ru/video/2025-01-13/bc/9f/bc9fda6d31c72a8002c8999542e877ab.jpg',
            year: '2025–2026',
            rating: 8.5,
            quality: '1080p FHD',
            is4K: false,
            media_type: 'series',
            category: 'Сериал',
            genres: ['Мелодрама', 'Драма', 'Музыка'],
            source: 'rutube',
            rutube_id: '564f31c881b83373bfe0cb26979d44cf',
            owner_id: -195528184,
            video_id: 456244337,
            vk_url: 'https://vkvideo.ru/video-195528184_456244337',
            vk_embed_url: 'https://vk.com/video_ext.php?oid=-195528184&id=456244337&hd=2&autoplay=0&js_api=1&muted=0&mute=0',
            embed_url: 'https://rutube.ru/play/embed/564f31c881b83373bfe0cb26979d44cf?skinColor=00d2ff&autoPlay=0',
            video_url: 'https://rutube.ru/video/564f31c881b83373bfe0cb26979d44cf/',
            total_episodes: 16,
            seasons: 2,
            description: 'Популярная музыкальная мелодрама Wink о Кате Орловой и Лехе Данилине: любовь, распад группы, интриги и борьба за наследство.'
          });
        }
      }

      rawCatalogItems = deduplicateMediaList(items);
      totalCatalogItems = rawCatalogItems.length;
      totalCatalogPages = 1;
      currentPage = 1;
      renderFilteredCatalog();
    } catch (err) {
      const container = document.getElementById('media-render-container');
      if (container) {
        container.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--color-red);">Ошибка поиска: ${err.message}</div>`;
      }
    }
  } else if (q.length === 0) {
    loadCurrentTab();
  }
}

function initSearch() {
  const input = document.getElementById('global-search-input');
  const clearBtn = document.getElementById('search-clear-btn');
  let debounceTimer;

  if (!input) return;

  // Горячая клавиша Ctrl+K и / для мгновенной фокусировки поиска
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      input.focus();
      input.select();
    } else if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(debounceTimer);
      executeSearch();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      input.value = '';
      input.blur();
      if (clearBtn) clearBtn.classList.remove('is-visible');
      searchQuery = '';
      executeSearch('');
    }
  });

  // Автоматическое распознавание вставки прямой ссылки на видеопоток (Direct Stream Link)
  input.addEventListener('paste', (e) => {
    const pasted = (e.clipboardData || window.clipboardData)?.getData('text')?.trim() || '';
    if (pasted.startsWith('http://') || pasted.startsWith('https://')) {
      if (pasted.includes('.m3u8') || pasted.includes('.mp4') || pasted.includes('stravers.live') || pasted.includes('fanfilm')) {
        e.preventDefault();
        input.value = pasted;
        showToast('🚀 Обнаружена ссылка на видеопоток! Запуск в кинотеатре...', 'success');
        openPlayerModal({ streamUrl: pasted, title: 'Прямой видеопоток' });
      }
    }
  });

  // Визуальный поиск по постеру через Drag & Drop в поле поиска
  const searchBox = document.querySelector('.storm-search-box');
  if (searchBox) {
    searchBox.ondragover = (e) => {
      e.preventDefault();
      searchBox.classList.add('search-drag-over');
    };
    searchBox.ondragleave = () => {
      searchBox.classList.remove('search-drag-over');
    };
    searchBox.ondrop = async (e) => {
      e.preventDefault();
      searchBox.classList.remove('search-drag-over');
      const files = e.dataTransfer?.files;
      if (files && files.length > 0 && files[0].type.startsWith('image/')) {
        showToast('🔍 Визуальный поиск по постеру...', 'info');
        const formData = new FormData();
        formData.append('image', files[0]);
        try {
          const res = await fetch('/api/search/visual', { method: 'POST', body: formData });
          const data = await res.json();
          if (data?.matchedQuery) {
            input.value = data.matchedQuery;
            executeSearch(data.matchedQuery);
            showToast(`Найдено по постеру: ${data.matchedQuery}`, 'success');
          } else if (data?.items?.length) {
            rawCatalogItems = deduplicateMediaList(data.items);
            renderFilteredCatalog();
          }
        } catch (err) {
          showToast('Не удалось распознать постер', 'warning');
        }
      }
    };
  }

  input.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    const val = e.target.value.trim();

    if (clearBtn) {
      clearBtn.classList.toggle('is-visible', val.length > 0);
    }

    debounceTimer = setTimeout(() => {
      executeSearch(val);
    }, 350);
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      input.value = '';
      clearBtn.classList.remove('is-visible');
      searchQuery = '';
      executeSearch('');
    });
  }

  initSourceFilterDropdown();
  initFiltersCollapsible();
}

export function toggleFiltersCollapsible(forceState = null) {
  const collapsible = document.getElementById('storm-filters-collapsible');
  const toggleBtn = document.getElementById('storm-filters-toggle-btn');
  if (!collapsible) return;
  const isCollapsed = forceState !== null ? forceState : !collapsible.classList.contains('is-collapsed');
  collapsible.classList.toggle('is-collapsed', isCollapsed);
  if (toggleBtn) {
    toggleBtn.classList.toggle('is-collapsed', isCollapsed);
    const label = toggleBtn.querySelector('#storm-filters-toggle-label');
    if (label) {
      label.textContent = isCollapsed ? 'Развернуть фильтры' : 'Свернуть фильтры';
    }
  }
}

function initFiltersCollapsible() {
  const toggleBtn = document.getElementById('storm-filters-toggle-btn');
  if (toggleBtn) {
    toggleBtn.onclick = () => toggleFiltersCollapsible();
  }
}

if (typeof window !== 'undefined') {
  window.executeSearch = executeSearch;
  window.toggleFiltersCollapsible = toggleFiltersCollapsible;
}

// -------------------------------------------------------------
// ПЛАВАЮЩАЯ КНОПКА «НАВЕРХ» С КРУГОВЫМ ПРОГРЕССОМ СТРАНИЦЫ
// -------------------------------------------------------------
function initScrollToTop() {
  const fab = document.getElementById('scroll-to-top-btn');
  const progressFill = document.getElementById('scroll-progress-ring-fill');
  if (!fab) return;

  const circumference = 113.1; // 2 * pi * 18
  let isTicking = false;

  function onScroll() {
    if (!isTicking) {
      window.requestAnimationFrame(() => {
        const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
        const maxScroll = (document.documentElement.scrollHeight || document.body.scrollHeight) - window.innerHeight;

        if (scrollY > 320) {
          fab.classList.add('is-visible');
        } else {
          fab.classList.remove('is-visible');
        }

        if (progressFill && maxScroll > 0) {
          const progress = Math.min(1, Math.max(0, scrollY / maxScroll));
          const offset = circumference * (1 - progress);
          progressFill.style.strokeDashoffset = String(offset);
        }
        isTicking = false;
      });
      isTicking = true;
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });

  fab.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(12); } catch {}
    }
  });
}

// -------------------------------------------------------------
// СТИЛИЗОВАННЫЙ ВЫПАДАЮЩИЙ СПИСОК ИСТОЧНИКОВ С ПОИСКОМ (16 ИСТОЧНИКОВ)
// -------------------------------------------------------------
function initSourceFilterDropdown() {
  const dropdown = document.getElementById('catalog-source-dropdown');
  if (!dropdown) return;

  const trigger = document.getElementById('catalog-source-trigger');
  const triggerBadge = document.getElementById('catalog-source-badge');
  const triggerLabel = document.getElementById('catalog-source-label');
  const menu = document.getElementById('catalog-source-menu');
  const searchInput = document.getElementById('catalog-source-search');
  const listContainer = document.getElementById('catalog-source-list');
  const hiddenSelect = document.getElementById('source-filter-select');

  const sources = [
    { id: 'all', badge: '🌐', name: 'Все источники', desc: 'Объединенная база релизов' },
    { id: 'lift', badge: '🚀', name: 'Lift 4K (Без рекламы • Все озвучки)', desc: 'Прямой поток до 4K UHD без рекламы, все студии дубляжа и Smart Skip' },
    { id: 'rutube', badge: '🔴', name: 'RuTube (Официальный каталог)', desc: 'Лицензионные фильмы, сериалы и шоу в Full HD' },
    { id: 'vkvideo', badge: '🔵', name: 'VK Видео (Фильмы и дубляж)', desc: 'Студийные переводы, новинки и сериалы' },
    { id: 'fanfilm4k', badge: '🎬', name: 'FanFilm4K (4K Ultra HD)', desc: 'Фильмы и сериалы в 4K UHD' },
    { id: 'tmdb', badge: '⭐', name: 'TMDB (Мировое кино)', desc: 'Мировая база кинопроката' },
    { id: 'anixart', badge: '🌸', name: 'AniXart (Аниме и озвучки)', desc: 'Тысячи тайтлов с сотнями озвучек' },
    { id: 'anilibria', badge: '⚡', name: 'AniLibria (Аниме Full HD)', desc: 'Официальные студийные потоки' },
    { id: 'shikimori', badge: '🎌', name: 'Shikimori (База аниме)', desc: 'Каталог и просмотр' },
    { id: 'kodik', badge: '🎥', name: 'Kodik (Аниме и сериалы)', desc: 'Популярная база с озвучками' },
    { id: 'hdrezka', badge: '🍿', name: 'HDRezka (Кино и дубляж)', desc: 'Студийные дубляжи' },
    { id: 'collaps', badge: '🎞️', name: 'Collaps (Онлайн-плеер)', desc: 'Мировые премьеры в Full HD' },
    { id: 'alloha', badge: '📺', name: 'Alloha TV (Кинотеатр)', desc: 'Стабильные серверные потоки' },
    { id: 'videocdn', badge: '📽️', name: 'VideoCDN (Премьеры)', desc: 'Новинки кинопроката' },
    { id: 'ashdi', badge: '💎', name: 'Ashdi (Мультистриминг)', desc: 'Быстрые потоки и переводы' },
    { id: 'vidsrc', badge: '🌍', name: 'Vidsrc Cinema (Original)', desc: 'Оригинальный звук и субтитры' },
    { id: 'kinobaza', badge: '🔥', name: 'Kinobaza (HD)', desc: 'Фильмы и сериалы в HD' },
    { id: 'kinogo', badge: '🎪', name: 'Kinogo HD (Классика)', desc: 'Большая база популярного кино' },
    { id: 'webtorrent', badge: '🧲', name: 'P2P WebTorrent (Торренты)', desc: 'Прямой стриминг раздач' },
    { id: 'rutracker', badge: '🏴‍☠️', name: 'RuTracker (BDRip и 4K)', desc: 'Качественные P2P раздачи и Remux' },
    { id: 'nnmclub', badge: '⚡', name: 'NNM-Club (Торрент-клуб)', desc: 'Премьеры фильмов и сериалов' },
    { id: 'rutor', badge: '🧲', name: 'Rutor (Свободный P2P)', desc: 'Быстрый торрент-стриминг' },
    { id: 'lostfilm', badge: '🎬', name: 'LostFilm (Студийный дубляж)', desc: 'Культовые зарубежные сериалы' },
    { id: 'redheadsound', badge: '🎙️', name: 'Red Head Sound (RHS)', desc: 'Профессиональный дубляж новинок' },
    { id: 'animevost', badge: '🌸', name: 'Animevost (Аниме-релизы)', desc: 'Быстрый русский дубляж аниме' }
  ];

  const renderOptions = (query = '') => {
    const q = query.trim().toLowerCase();
    const filtered = sources.filter(s => s.name.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q));
    listContainer.innerHTML = '';

    if (filtered.length === 0) {
      listContainer.innerHTML = '<div style="padding:10px;text-align:center;font-size:12px;color:var(--text-muted);">Источник не найден</div>';
      return;
    }

    filtered.forEach(s => {
      const item = document.createElement('div');
      item.className = `storm-dropdown-item ${currentSource === s.id ? 'is-active' : ''}`;
      item.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;min-width:0;">
          <span style="font-size:14px;">${s.badge}</span>
          <div style="min-width:0;">
            <div style="font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s.name}</div>
            <div style="font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s.desc}</div>
          </div>
        </div>
      `;
      item.onclick = () => {
        currentSource = s.id;
        triggerBadge.textContent = s.badge;
        triggerLabel.textContent = s.name;
        if (hiddenSelect) hiddenSelect.value = s.id;
        dropdown.classList.remove('is-open');
        menu.style.display = 'none';

        // Автоматически сворачиваем фильтры при выборе, освобождая место на ТВ, мобильных и ПК
        if (typeof toggleFiltersCollapsible === 'function') {
          toggleFiltersCollapsible(true);
        }

        if (searchQuery && searchQuery.length >= 2) {
          executeSearch(searchQuery);
        } else {
          loadCurrentTab();
        }
      };
      listContainer.appendChild(item);
    });
  };

  trigger.onclick = (e) => {
    e.stopPropagation();
    const isOpen = dropdown.classList.contains('is-open');
    document.querySelectorAll('.storm-custom-dropdown.is-open').forEach(dd => dd.classList.remove('is-open'));
    document.querySelectorAll('.storm-dropdown-menu').forEach(m => m.style.display = 'none');

    if (!isOpen) {
      dropdown.classList.add('is-open');
      menu.style.display = 'block';
      if (searchInput) {
        searchInput.value = '';
        renderOptions('');
        setTimeout(() => searchInput.focus(), 50);
      }
    }
  };

  if (searchInput) {
    searchInput.oninput = (e) => {
      renderOptions(e.target.value);
    };
    searchInput.onclick = (e) => e.stopPropagation();
  }

  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target)) {
      dropdown.classList.remove('is-open');
      menu.style.display = 'none';
    }
  });

  renderOptions('');
}

// -------------------------------------------------------------
// КАРУСЕЛЬ И ВЫПАДАЮЩИЕ ФИЛЬТРЫ (ЖАНРЫ, ГОДА, РЕЙТИНГ, СОРТИРОВКА)
// -------------------------------------------------------------
function setupFilterDropdown({ dropdownId, triggerId, labelId, menuId, searchId, listId, items, getActiveVal, onSelect }) {
  const dropdown = document.getElementById(dropdownId);
  const trigger = document.getElementById(triggerId);
  const label = document.getElementById(labelId);
  const menu = document.getElementById(menuId);
  const search = searchId ? document.getElementById(searchId) : null;
  const list = document.getElementById(listId);

  if (!dropdown || !trigger || !menu || !list) return;

  const renderOptions = (query = '') => {
    const q = query.trim().toLowerCase();
    const filtered = items.filter(it => it.name.toLowerCase().includes(q));
    list.innerHTML = '';

    if (filtered.length === 0) {
      list.innerHTML = '<div style="padding:10px;text-align:center;font-size:12px;color:var(--text-muted);">Ничего не найдено</div>';
      return;
    }

    filtered.forEach(it => {
      const el = document.createElement('div');
      const isActive = String(getActiveVal()) === String(it.id);
      el.className = `storm-dropdown-item ${isActive ? 'is-active' : ''}`;
      el.dataset.value = it.id;
      el.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;width:100%;">
          ${it.icon ? `<span style="font-size:13px;">${it.icon}</span>` : ''}
          <span style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${it.name}</span>
        </div>
      `;
      el.onclick = (e) => {
        e.stopPropagation();
        if (label) label.textContent = it.name;
        list.querySelectorAll('.storm-dropdown-item').forEach(child => {
          child.classList.toggle('is-active', child.dataset.value === String(it.id));
        });
        dropdown.classList.remove('is-open');
        menu.style.display = 'none';
        onSelect(it.id);

        // Автоматически сворачиваем фильтры при выборе, освобождая место на ТВ, мобильных и ПК
        if (typeof toggleFiltersCollapsible === 'function') {
          toggleFiltersCollapsible(true);
        }
      };
      list.appendChild(el);
    });
  };

  trigger.onclick = (e) => {
    e.stopPropagation();
    const isOpen = dropdown.classList.contains('is-open');
    document.querySelectorAll('.storm-custom-dropdown.is-open').forEach(dd => {
      if (dd !== dropdown) dd.classList.remove('is-open');
    });
    document.querySelectorAll('.storm-dropdown-menu').forEach(m => {
      if (m !== menu) m.style.display = 'none';
    });

    if (!isOpen) {
      dropdown.classList.add('is-open');
      menu.style.display = 'block';
      if (search) {
        search.value = '';
        renderOptions('');
        setTimeout(() => search.focus(), 50);
      } else {
        renderOptions('');
      }
    } else {
      dropdown.classList.remove('is-open');
      menu.style.display = 'none';
    }
  };

  if (search) {
    search.oninput = (e) => renderOptions(e.target.value);
    search.onclick = (e) => e.stopPropagation();
  }

  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target)) {
      dropdown.classList.remove('is-open');
      menu.style.display = 'none';
    }
  });

  renderOptions('');
}

export function initFilterDropdowns() {
  // 1. Жанры
  setupFilterDropdown({
    dropdownId: 'filter-genre-dropdown',
    triggerId: 'filter-genre-trigger',
    labelId: 'filter-genre-label',
    menuId: 'filter-genre-menu',
    searchId: 'filter-genre-search',
    listId: 'filter-genre-list',
    items: ALL_CATALOG_GENRES,
    getActiveVal: () => currentGenre,
    onSelect: (id) => {
      currentGenre = id;
      renderFilteredCatalog();
    }
  });

  // 1.5. Страна производства
  setupFilterDropdown({
    dropdownId: 'filter-country-dropdown',
    triggerId: 'filter-country-trigger',
    labelId: 'filter-country-label',
    menuId: 'filter-country-menu',
    listId: 'filter-country-list',
    items: ALL_CATALOG_COUNTRIES,
    getActiveVal: () => currentCountry,
    onSelect: (id) => {
      currentCountry = id;
      currentPage = 1;
      loadCurrentTab();
    }
  });

  // 2. Года
  const years = [
    { id: 'all', name: 'Все года', icon: '📅' },
    { id: '2026', name: '2026 год', icon: '✨' },
    { id: '2025', name: '2025 год', icon: '✨' },
    { id: '2024', name: '2024 год', icon: '✨' },
    { id: '2023', name: '2023 год', icon: '🔹' },
    { id: '2022', name: '2022 год', icon: '🔹' },
    { id: '2021', name: '2021 год', icon: '🔹' },
    { id: '2020', name: '2020 год', icon: '🔹' },
    { id: '2015-2019', name: '2015 — 2019', icon: '⏳' },
    { id: '2010-2014', name: '2010 — 2014', icon: '⏳' },
    { id: '2000-2009', name: '2000 — 2009', icon: '⏳' },
    { id: '1990-1999', name: '1990 — 1999', icon: '⏳' },
    { id: '1980-1989', name: '1980 — 1989', icon: '⏳' },
    { id: '1980_down', name: 'До 1980 года', icon: '🏛️' }
  ];

  setupFilterDropdown({
    dropdownId: 'filter-year-dropdown',
    triggerId: 'filter-year-trigger',
    labelId: 'filter-year-label',
    menuId: 'filter-year-menu',
    listId: 'filter-year-list',
    items: years,
    getActiveVal: () => currentYear,
    onSelect: (id) => {
      currentYear = id;
      renderFilteredCatalog();
    }
  });

  // 3. Рейтинг
  const ratings = [
    { id: '0', name: 'Любой рейтинг', icon: '🌐' },
    { id: '9.0', name: '★ 9.0+ Шедевры', icon: '🏆' },
    { id: '8.5', name: '★ 8.5+ Выдающиеся', icon: '💎' },
    { id: '8.0', name: '★ 8.0+ Отличные', icon: '⭐' },
    { id: '7.5', name: '★ 7.5+ Очень хорошие', icon: '✨' },
    { id: '7.0', name: '★ 7.0+ Хорошие', icon: '👍' },
    { id: '6.5', name: '★ 6.5+ Достойные', icon: '👌' },
    { id: '6.0', name: '★ 6.0+ Средние', icon: '🔹' },
    { id: '5.5', name: '★ 5.5+ Приемлемые', icon: '🔸' },
    { id: '5.0', name: '★ 5.0+ На любителя', icon: '▫️' }
  ];

  setupFilterDropdown({
    dropdownId: 'filter-rating-dropdown',
    triggerId: 'filter-rating-trigger',
    labelId: 'filter-rating-label',
    menuId: 'filter-rating-menu',
    listId: 'filter-rating-list',
    items: ratings,
    getActiveVal: () => currentRating,
    onSelect: (id) => {
      currentRating = parseFloat(id) || 0;
      renderFilteredCatalog();
    }
  });

  // 3.5. Статус просмотра
  const statuses = [
    { id: 'all', name: 'Все статусы', icon: '🏷️' },
    { id: 'watching', name: 'Смотрю', icon: getStatusIconSvg('watching', { size: 14 }) },
    { id: 'favorite', name: 'Любимое', icon: getStatusIconSvg('favorite', { size: 14 }) },
    { id: 'planned', name: 'В планах', icon: getStatusIconSvg('planned', { size: 14 }) },
    { id: 'completed', name: 'Просмотрено', icon: getStatusIconSvg('completed', { size: 14 }) },
    { id: 'on_hold', name: 'Отложено', icon: getStatusIconSvg('on_hold', { size: 14 }) },
    { id: 'dropped', name: 'Заброшено', icon: getStatusIconSvg('dropped', { size: 14 }) },
    { id: 'wont_watch', name: 'Не буду смотреть', icon: getStatusIconSvg('wont_watch', { size: 14 }) }
  ];

  setupFilterDropdown({
    dropdownId: 'filter-status-dropdown',
    triggerId: 'filter-status-trigger',
    labelId: 'filter-status-label',
    menuId: 'filter-status-menu',
    listId: 'filter-status-list',
    items: statuses,
    getActiveVal: () => currentStatusFilter,
    onSelect: (id) => {
      currentStatusFilter = id;
      renderFilteredCatalog();
    }
  });

  // 4. Сортировка
  const sortOptions = [
    { id: 'newest', name: 'По дате', icon: '📅' },
    { id: 'popular', name: 'По популярности', icon: '⚡' },
    { id: 'rating', name: 'По рейтингу', icon: '⭐' },
    { id: 'title', name: 'По названию (А-Я)', icon: '🔤' }
  ];

  setupFilterDropdown({
    dropdownId: 'filter-sort-dropdown',
    triggerId: 'filter-sort-trigger',
    labelId: 'filter-sort-label',
    menuId: 'filter-sort-menu',
    listId: 'filter-sort-list',
    items: sortOptions,
    getActiveVal: () => currentSort,
    onSelect: (id) => {
      currentSort = id;
      renderFilteredCatalog();
    }
  });

  // Кнопка сброса фильтров
  const resetBtn = document.getElementById('reset-filters-btn');
  if (resetBtn) {
    resetBtn.onclick = () => resetAllFilters();
  }
}

export function resetAllFilters() {
  const prevSource = currentSource;
  const prevCountry = currentCountry;
  currentGenre = 'all';
  currentCountry = 'all';
  currentYear = 'all';
  currentRating = 0;
  currentStatusFilter = 'all';
  currentSort = 'newest';
  currentSource = 'all';
  currentFilterSheetGenre = 'all';
  currentFilterSheetCountry = 'all';
  currentFilterSheetYear = 'all';
  currentFilterSheetRating = 0;
  currentFilterSheetSort = 'newest';
  currentFilterSheetSource = 'all';

  const genreLabel = document.getElementById('filter-genre-label');
  if (genreLabel) genreLabel.textContent = 'Все жанры';

  const countryLabel = document.getElementById('filter-country-label');
  if (countryLabel) countryLabel.textContent = 'Все страны';

  const yearLabel = document.getElementById('filter-year-label');
  if (yearLabel) yearLabel.textContent = 'Все года';

  const ratingLabel = document.getElementById('filter-rating-label');
  if (ratingLabel) ratingLabel.textContent = 'Любой рейтинг';

  const statusLabel = document.getElementById('filter-status-label');
  if (statusLabel) statusLabel.textContent = 'Все статусы';

  const sortLabel = document.getElementById('filter-sort-label');
  if (sortLabel) sortLabel.textContent = 'По дате';

  const resetBtn = document.getElementById('reset-filters-btn');
  if (resetBtn) resetBtn.style.display = 'none';

  document.querySelectorAll('#filter-genre-list .storm-dropdown-item').forEach(el => {
    el.classList.toggle('is-active', el.dataset.value === 'all');
  });
  document.querySelectorAll('#filter-country-list .storm-dropdown-item').forEach(el => {
    el.classList.toggle('is-active', el.dataset.value === 'all');
  });
  document.querySelectorAll('#filter-year-list .storm-dropdown-item').forEach(el => {
    el.classList.toggle('is-active', el.dataset.value === 'all');
  });
  document.querySelectorAll('#filter-rating-list .storm-dropdown-item').forEach(el => {
    el.classList.toggle('is-active', el.dataset.value === '0');
  });
  document.querySelectorAll('#filter-status-list .storm-dropdown-item').forEach(el => {
    el.classList.toggle('is-active', el.dataset.value === 'all');
  });
  document.querySelectorAll('#filter-sort-list .storm-dropdown-item').forEach(el => {
    el.classList.toggle('is-active', el.dataset.value === 'newest');
  });

  updateFilterBadge();
  if (prevSource !== 'all' || prevCountry !== 'all') {
    currentPage = 1;
    loadCurrentTab();
  } else {
    renderFilteredCatalog();
  }
}

export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderBookmarksSubNav(counts) {
  const container = document.getElementById('bookmarks-subnav-container');
  if (!container) return;

  if (currentTab !== 'bookmarks') {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  container.style.display = 'flex';

  const subTabs = [
    { id: 'all', icon: '⭐', label: t('bookmarks_subtab_all') || 'Все', count: counts.all || 0 },
    { id: 'watching', icon: '▶', label: t('bookmarks_subtab_watching') || 'Смотрю', count: counts.watching || 0 },
    { id: 'favorite', icon: '❤️', label: t('bookmarks_subtab_favorite') || 'Любимое', count: counts.favorite || 0 },
    { id: 'plan', icon: '📅', label: t('bookmarks_subtab_plan') || 'В планах', count: counts.plan || 0 },
    { id: 'completed', icon: '✓', label: t('bookmarks_subtab_completed') || 'Просмотрено', count: counts.completed || 0 },
    { id: 'hold', icon: '⏸️', label: t('bookmarks_subtab_hold') || 'Отложено', count: counts.hold || 0 },
    { id: 'dropped', icon: '❌', label: t('bookmarks_subtab_dropped') || 'Заброшено', count: counts.dropped || 0 },
    { id: 'wont_watch', icon: '🚫', label: t('bookmarks_subtab_wont_watch') || 'Не буду смотреть', count: counts.wont_watch || 0 },
    { id: 'lists', icon: '📁', label: t('bookmarks_subtab_lists') || 'Мои коллекции', count: counts.lists || 0 }
  ];

  container.innerHTML = subTabs.map(st => `
    <button type="button" class="bookmarks-subnav-chip storm-focusable ${currentBookmarkSubTab === st.id ? 'active' : ''}" data-subtab="${st.id}">
      <span class="chip-label">${st.icon} ${st.label}</span>
      <span class="chip-count">${st.count}</span>
    </button>
  `).join('');

  container.querySelectorAll('.bookmarks-subnav-chip').forEach(btn => {
    btn.onclick = () => {
      const subtab = btn.dataset.subtab;
      if (currentBookmarkSubTab === subtab && !activeViewingCustomList) return;
      currentBookmarkSubTab = subtab;
      activeViewingCustomList = null;
      renderFilteredCatalog();
    };
  });
}

function renderCustomListsGrid(lists) {
  const container = document.getElementById('media-render-container');
  if (!container) return;

  hideHeroShowcase();
  hideCardHoverPreview();
  renderCatalogPagination(0);

  const listsHtml = (lists || []).map(list => {
    const count = list.items_count || (Array.isArray(list.items) ? list.items.length : 0);
    const previews = Array.isArray(list.previews) ? list.previews : [];

    let collageHtml = '';
    if (previews.length > 0) {
      collageHtml = `
        <div class="custom-list-collage">
          ${previews.slice(0, 4).map(p => `
            <img src="${getSafePosterUrl(p.poster_url, p.title)}" alt="${escapeHtml(p.title || '')}" loading="lazy" onerror="this.onerror=null; this.removeAttribute('srcset'); this.src='assets/favicon.svg';">
          `).join('')}
          ${Array(Math.max(0, 4 - previews.length)).fill(0).map(() => `
            <div style="background: rgba(255,255,255,0.03); display: flex; align-items: center; justify-content: center; font-size: 20px; color: var(--text-muted);">🎬</div>
          `).join('')}
        </div>
      `;
    } else {
      collageHtml = `
        <div class="custom-list-collage empty-collage">
          <div style="text-align: center;">
            <div style="font-size: 32px; margin-bottom: 4px;">📁</div>
            <span style="font-size: 12px; color: var(--text-muted);">${t('custom_list_empty') || 'Коллекция пуста'}</span>
          </div>
        </div>
      `;
    }

    return `
      <div class="custom-list-card storm-focusable" data-list-id="${list.id}" tabindex="0" role="button" aria-label="${escapeHtml(list.title)}">
        <div style="position: relative;">
          ${collageHtml}
          <div class="custom-list-badge storm-badge">
            ${count} ${t('media_items') || 'фильмов'}
          </div>
        </div>
        <div class="custom-list-content">
          <h3 class="custom-list-title">${escapeHtml(list.title)}</h3>
          ${list.description ? `<p class="custom-list-desc">${escapeHtml(list.description)}</p>` : `<p class="custom-list-desc" style="opacity: 0.5;">Персональная коллекция</p>`}
          <div class="custom-list-actions">
            <button type="button" class="storm-btn storm-btn-primary storm-btn-sm open-list-btn" data-list-id="${list.id}">
              Открыть
            </button>
            <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm delete-list-btn" data-list-id="${list.id}" title="Удалить">
              🗑️
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  const createCardHtml = `
    <div class="custom-list-card custom-list-create-card storm-focusable" id="create-new-custom-list-card" tabindex="0" role="button">
      <div style="font-size: 36px; margin-bottom: 8px; color: var(--accent);">＋</div>
      <h3 style="margin: 0 0 6px; font-size: 16px; color: var(--text-main); font-weight: 700;">${t('custom_list_create_title') || 'Создать коллекцию'}</h3>
      <p style="margin: 0; font-size: 12px; color: var(--text-muted);">Соберите свою подборку фильмов или сериалов</p>
    </div>
  `;

  container.innerHTML = `
    <div class="custom-lists-grid" style="grid-column: 1 / -1;">
      ${createCardHtml}
      ${listsHtml}
    </div>
  `;

  bindCustomListsEvents();
}

function bindCustomListsEvents() {
  const createCard = document.getElementById('create-new-custom-list-card');
  if (createCard) {
    createCard.onclick = () => openCreateCustomListModal();
  }

  document.querySelectorAll('.custom-list-card[data-list-id]').forEach(card => {
    const listId = parseInt(card.dataset.listId, 10);
    card.onclick = async (e) => {
      if (e.target.closest('.delete-list-btn')) return;
      const details = await fetchCustomListDetails(listId);
      if (details) {
        activeViewingCustomList = details;
        renderFilteredCatalog();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    };

    const delBtn = card.querySelector('.delete-list-btn');
    if (delBtn) {
      delBtn.onclick = async (e) => {
        e.stopPropagation();
        const list = cachedCustomLists.find(l => l.id === listId);
        const title = list ? list.title : 'Коллекция';
        if (confirm(`Удалить коллекцию «${title}»?`)) {
          await deleteCustomListApi(listId);
          cachedCustomLists = cachedCustomLists.filter(l => l.id !== listId);
          renderFilteredCatalog();
        }
      };
    }
  });
}

function renderCustomListDetailView(listData) {
  const container = document.getElementById('media-render-container');
  if (!container) return;

  hideHeroShowcase();
  hideCardHoverPreview();

  const items = (listData.items || []).map(it => ({
    id: it.media_id,
    source: it.source || 'all',
    title: it.title,
    poster: getSafePosterUrl(it.poster_url, it.title),
    media_type: it.media_type || 'movie',
    year: it.year || '',
    rating: it.rating || ''
  }));

  if (items.length === 0) {
    renderCatalogPagination(0);
    container.innerHTML = `
      <div class="custom-list-header-banner" style="grid-column: 1 / -1;">
        <div style="display: flex; align-items: center; gap: 14px;">
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm storm-focusable" id="back-to-custom-lists-btn">
            ← ${t('custom_list_back') || 'Ко всем коллекциям'}
          </button>
          <div>
            <h2 class="custom-list-header-title" style="margin: 0; display: flex; align-items: center; gap: 10px;">
              <span>📁 ${escapeHtml(listData.title || '')}</span>
              <span class="storm-badge" style="font-size: 13px; font-weight: 700; background: rgba(0, 210, 255, 0.15); border-color: var(--accent); color: var(--accent);">
                0 ${t('media_items') || 'фильмов'}
              </span>
            </h2>
            ${listData.description ? `<p style="margin: 4px 0 0; font-size: 13px; color: var(--text-muted);">${escapeHtml(listData.description)}</p>` : ''}
          </div>
        </div>
        <div style="display: flex; gap: 8px;">
          <button type="button" class="storm-btn storm-btn-danger storm-btn-sm storm-focusable" id="delete-current-custom-list-btn" title="Удалить коллекцию">
            🗑️
          </button>
        </div>
      </div>
      <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-muted);">
        <div style="font-size: 42px; margin-bottom: 12px;">📂</div>
        <h3>${t('custom_list_empty') || 'В этой коллекции пока нет фильмов'}</h3>
        <p>Добавляйте фильмы и сериалы в эту коллекцию через меню «⋮» на любой карточке.</p>
      </div>
    `;
    const backBtn = document.getElementById('back-to-custom-lists-btn');
    if (backBtn) backBtn.onclick = () => { activeViewingCustomList = null; renderFilteredCatalog(); };
    const delBtn = document.getElementById('delete-current-custom-list-btn');
    if (delBtn) delBtn.onclick = async () => {
      if (confirm(`Удалить коллекцию «${listData.title}»?`)) {
        await deleteCustomListApi(listData.id);
        cachedCustomLists = cachedCustomLists.filter(l => l.id !== listData.id);
        activeViewingCustomList = null;
        renderFilteredCatalog();
      }
    };
    return;
  }

  renderMediaItems(items);

  const banner = document.createElement('div');
  banner.className = 'custom-list-header-banner';
  banner.style.gridColumn = '1 / -1';
  banner.innerHTML = `
    <div style="display: flex; align-items: center; gap: 14px;">
      <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm storm-focusable" id="back-to-custom-lists-btn">
        ← ${t('custom_list_back') || 'Ко всем коллекциям'}
      </button>
      <div>
        <h2 class="custom-list-header-title" style="margin: 0; display: flex; align-items: center; gap: 10px;">
          <span>📁 ${escapeHtml(listData.title || '')}</span>
          <span class="storm-badge" style="font-size: 13px; font-weight: 700; background: rgba(0, 210, 255, 0.15); border-color: var(--accent); color: var(--accent);">
            ${items.length} ${t('media_items') || 'фильмов'}
          </span>
        </h2>
        ${listData.description ? `<p style="margin: 4px 0 0; font-size: 13px; color: var(--text-muted);">${escapeHtml(listData.description)}</p>` : ''}
      </div>
    </div>
    <div style="display: flex; gap: 8px;">
      <button type="button" class="storm-btn storm-btn-danger storm-btn-sm storm-focusable" id="delete-current-custom-list-btn" title="Удалить коллекцию">
        🗑️
      </button>
    </div>
  `;
  container.insertBefore(banner, container.firstChild);

  const backBtn = document.getElementById('back-to-custom-lists-btn');
  if (backBtn) backBtn.onclick = () => { activeViewingCustomList = null; renderFilteredCatalog(); };
  const delBtn = document.getElementById('delete-current-custom-list-btn');
  if (delBtn) delBtn.onclick = async () => {
    if (confirm(`Удалить коллекцию «${listData.title}»?`)) {
      await deleteCustomListApi(listData.id);
      cachedCustomLists = cachedCustomLists.filter(l => l.id !== listData.id);
      activeViewingCustomList = null;
      renderFilteredCatalog();
    }
  };
}

export function openCreateCustomListModal() {
  let modal = document.getElementById('storm-create-list-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'storm-create-list-modal';
    modal.className = 'storm-modal-backdrop';
    modal.innerHTML = `
      <div class="storm-exit-modal-card" style="max-width: 440px;" role="dialog" aria-modal="true">
        <div class="storm-exit-modal-icon">📁</div>
        <div class="storm-exit-modal-title">${t('custom_list_create_title') || 'Новая коллекция'}</div>
        <div style="display: flex; flex-direction: column; gap: 12px; margin: 16px 0; text-align: left;">
          <div>
            <label style="display: block; font-size: 12px; font-weight: 700; color: var(--text-muted); margin-bottom: 6px;">
              ${t('custom_list_title') || 'Название коллекции'} *
            </label>
            <input type="text" id="create-list-input-title" class="storm-input" placeholder="Например: Любимые фильмы в 4K" maxlength="100" style="width: 100%;">
          </div>
          <div>
            <label style="display: block; font-size: 12px; font-weight: 700; color: var(--text-muted); margin-bottom: 6px;">
              ${t('custom_list_desc') || 'Описание'}
            </label>
            <textarea id="create-list-input-desc" class="storm-input" placeholder="Краткое описание коллекции..." rows="2" maxlength="250" style="width: 100%; resize: none;"></textarea>
          </div>
        </div>
        <div class="storm-exit-modal-actions">
          <button type="button" class="storm-exit-btn-cancel" id="create-list-btn-cancel">${t('btn_cancel') || 'Отмена'}</button>
          <button type="button" class="storm-exit-btn-confirm" id="create-list-btn-confirm">${t('btn_create') || 'Создать'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('is-open');
    });

    const cancelBtn = modal.querySelector('#create-list-btn-cancel');
    if (cancelBtn) cancelBtn.onclick = () => modal.classList.remove('is-open');

    const confirmBtn = modal.querySelector('#create-list-btn-confirm');
    if (confirmBtn) {
      confirmBtn.onclick = async () => {
        const titleInput = modal.querySelector('#create-list-input-title');
        const descInput = modal.querySelector('#create-list-input-desc');
        const title = (titleInput?.value || '').trim();
        const desc = (descInput?.value || '').trim();
        if (!title) {
          showToast('Введите название коллекции', 'warning');
          return;
        }
        const created = await createCustomCollection(title, desc);
        if (created) {
          modal.classList.remove('is-open');
          if (titleInput) titleInput.value = '';
          if (descInput) descInput.value = '';
          const updatedLists = await fetchCustomLists().catch(() => []);
          cachedCustomLists = Array.isArray(updatedLists) ? updatedLists : [];
          currentBookmarkSubTab = 'lists';
          activeViewingCustomList = null;
          renderFilteredCatalog();
        }
      };
    }
  }

  const titleInput = modal.querySelector('#create-list-input-title');
  if (titleInput) titleInput.value = '';
  const descInput = modal.querySelector('#create-list-input-desc');
  if (descInput) descInput.value = '';
  modal.classList.add('is-open');
  setTimeout(() => titleInput?.focus(), 50);
}

if (typeof window !== 'undefined') {
  window.openCreateCustomListModal = openCreateCustomListModal;
}

export function renderFilteredCatalog() {
  const isSearching = Boolean(searchQuery && searchQuery.trim().length >= 2);
  const isFiltered = (!isSearching && (currentGenre !== 'all' || currentCountry !== 'all' || currentYear !== 'all' || currentRating > 0 || currentStatusFilter !== 'all')) || currentSort !== 'newest';
  const resetBtn = document.getElementById('reset-filters-btn');
  if (resetBtn) {
    resetBtn.style.display = isFiltered ? 'inline-flex' : 'none';
  }
  updateFilterBadge();

  if (isFiltered && document.body.classList.contains('tv-mode')) {
    toggleFiltersCollapsible(true);
  }

  let items = [...rawCatalogItems];
  items.forEach(it => {
    const st = resolveMediaUserStatus(it);
    if (st) it.user_status = st;
  });

  if (currentTab === 'bookmarks') {
    const isFav = it => it.user_status === 'favorite' || it.status === 'favorite' || it.is_favorite === 1 || it.is_favorite === true || it.isFavorite === true;
    const counts = {
      all: rawCatalogItems.length,
      watching: rawCatalogItems.filter(it => it.user_status === 'watching').length,
      favorite: rawCatalogItems.filter(isFav).length,
      plan: rawCatalogItems.filter(it => it.user_status === 'plan' || it.user_status === 'planned').length,
      completed: rawCatalogItems.filter(it => it.user_status === 'completed').length,
      hold: rawCatalogItems.filter(it => it.user_status === 'hold' || it.user_status === 'on_hold').length,
      dropped: rawCatalogItems.filter(it => it.user_status === 'dropped').length,
      wont_watch: rawCatalogItems.filter(it => it.user_status === 'wont_watch').length,
      lists: cachedCustomLists.length
    };
    renderBookmarksSubNav(counts);

    if (currentBookmarkSubTab === 'lists') {
      const qBar = document.getElementById('storm-quick-catalog-bar');
      if (qBar) {
        qBar.style.display = 'none';
        qBar.innerHTML = '';
      }
      if (activeViewingCustomList) {
        renderCustomListDetailView(activeViewingCustomList);
        return;
      } else {
        renderCustomListsGrid(cachedCustomLists);
        return;
      }
    }

    if (currentBookmarkSubTab !== 'all') {
      if (currentBookmarkSubTab === 'plan') {
        items = items.filter(it => it.user_status === 'plan' || it.user_status === 'planned');
      } else if (currentBookmarkSubTab === 'hold') {
        items = items.filter(it => it.user_status === 'hold' || it.user_status === 'on_hold');
      } else if (currentBookmarkSubTab === 'favorite') {
        items = items.filter(isFav);
      } else {
        items = items.filter(it => it.user_status === currentBookmarkSubTab);
      }
    }
  } else {
    const bSubnav = document.getElementById('bookmarks-subnav-container');
    if (bSubnav) {
      bSubnav.style.display = 'none';
      bSubnav.innerHTML = '';
    }
  }
  if (currentPage > 1) {
    items = filterPageDuplicates(items, currentTab === 'home' ? 'popular' : currentTab, currentPage);
  }

  // Исключаем аниме из Мультфильмов и Мультсериалов
  if (currentTab === 'cartoons' || currentTab === 'cartoon-series') {
    items = items.filter(item => !isAnimeItemClient(item));
  }

  // 0. Детский режим (семейный контроль и фильтрация 18+)
  if (isKidModeActive()) {
    const blockedTerms = ['18+', 'эротика', 'ужасы', 'хоррор', 'порно', 'триллер', 'криминал'];
    items = items.filter(item => {
      const text = `${item.title || ''} ${item.description || ''} ${Array.isArray(item.genres) ? item.genres.join(' ') : (item.genres || '')} ${item.age_rating || ''}`.toLowerCase();
      return !blockedTerms.some(term => text.includes(term));
    });
  }

  // 1. Фильтр по жанру (только для каталога категорий, не для результатов поиска)
  if (!isSearching && currentGenre !== 'all') {
    const targetGenre = currentGenre.toLowerCase().trim();
    items = items.filter(item => {
      if (targetGenre === 'мультфильм' && (item.media_type === 'cartoons' || item.media_type === 'cartoon-series' || item.category === 'cartoons' || item.category === 'cartoon-series')) return true;
      if (targetGenre === 'аниме' && (item.media_type === 'anime-movies' || item.media_type === 'anime-series' || item.category === 'anime-series' || item.category === 'anime-movies')) return true;
      if (targetGenre === 'сериал' && (item.media_type === 'series' || item.media_type === 'cartoon-series' || item.media_type === 'anime-series' || item.category === 'series')) return true;

      const checkGenre = (val) => {
        if (!val) return false;
        if (Array.isArray(val)) {
          return val.some(g => String(g).toLowerCase().includes(targetGenre));
        }
        return String(val).toLowerCase().includes(targetGenre);
      };

      return checkGenre(item.genres) ||
             checkGenre(item.genre) ||
             checkGenre(item.category) ||
             checkGenre(item.description);
    });
  }

  // 1.5 Фильтр по стране (только для каталога категорий)
  if (!isSearching && currentCountry !== 'all') {
    const targetCountry = currentCountry.toLowerCase().trim();
    items = items.filter(item => {
      const hasCountryMeta = Boolean(
        (Array.isArray(item.countries) && item.countries.length > 0) ||
        (typeof item.country === 'string' && item.country.trim().length > 0)
      );
      if (targetCountry === 'foreign') {
        const isRussian = (val) => {
          if (!val) return false;
          if (Array.isArray(val)) return val.some(c => /росси|ссср|russia|ussr/i.test(String(c)));
          return /росси|ссср|russia|ussr/i.test(String(val));
        };
        return !isRussian(item.countries) && !isRussian(item.country);
      }
      if (!hasCountryMeta && item.source === 'lift') {
        return true;
      }
      const checkCountry = (val) => {
        if (!val) return false;
        if (Array.isArray(val)) {
          return val.some(c => String(c).toLowerCase().includes(targetCountry) || (targetCountry === 'россия' && /росси|ссср/i.test(String(c))));
        }
        return String(val).toLowerCase().includes(targetCountry) || (targetCountry === 'россия' && /росси|ссср/i.test(String(val)));
      };
      return checkCountry(item.countries) ||
             checkCountry(item.country) ||
             checkCountry(item.description);
    });
  }

  // 2. Фильтр по году (только для каталога категорий)
  if (!isSearching && currentYear !== 'all') {
    items = items.filter(item => {
      const yrStr = getMediaYear(item) || item.year;
      const year = parseInt(yrStr, 10);
      if (isNaN(year)) return false;
      if (currentYear === '1980_down' || currentYear === 'pre_1980') return year < 1980;
      if (currentYear === '1980-1989' || currentYear === '1980_1989') return year >= 1980 && year <= 1989;
      if (currentYear === '1990-1999' || currentYear === '1990_1999') return year >= 1990 && year <= 1999;
      if (currentYear === '2000_down') return year < 2000;
      if (currentYear === '2000-2009' || currentYear === '2000_2009') return year >= 2000 && year <= 2009;
      if (currentYear === '2010-2019' || currentYear === '2010_2019') return year >= 2010 && year <= 2019;
      if (currentYear === '2010-2014' || currentYear === '2010_2014') return year >= 2010 && year <= 2014;
      if (currentYear === '2015-2019' || currentYear === '2015_2019') return year >= 2015 && year <= 2019;
      if (currentYear === '2020-2023' || currentYear === '2020_2023') return year >= 2020 && year <= 2023;
      return String(year) === currentYear;
    });
  }

  // 3. Фильтр по рейтингу (только для каталога категорий)
  if (!isSearching && currentRating > 0) {
    items = items.filter(item => {
      const rating = parseFloat(item.rating);
      if (isNaN(rating)) return false;
      return rating >= currentRating;
    });
  }

  // 3.5. Фильтр по статусу просмотра (только для каталога категорий)
  if (!isSearching && currentStatusFilter !== 'all') {
    items = items.filter(item => {
      const status = item.user_status;
      if (!status) return false;
      if (currentStatusFilter === 'plan' || currentStatusFilter === 'planned') {
        return status === 'plan' || status === 'planned';
      }
      if (currentStatusFilter === 'hold' || currentStatusFilter === 'on_hold') {
        return status === 'hold' || status === 'on_hold';
      }
      return status === currentStatusFilter;
    });
  }

  // 4. Сортировка: по умолчанию ВЕЗДЕ по дате (от новых к старым)
  if (isSearching) {
    if (currentSort === 'rating') {
      items.sort((a, b) => (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0));
    } else if (currentSort === 'title') {
      items.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ru'));
    } else if (currentSort === 'popular') {
      items.sort((a, b) => (parseFloat(b.popularity || b.rating) || 0) - (parseFloat(a.popularity || a.rating) || 0));
    } else {
      items.sort((a, b) => (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0));
    }
  } else if (isFiltered) {
    if (currentSort === 'rating') {
      items.sort((a, b) => (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0));
    } else if (currentSort === 'title') {
      items.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ru'));
    } else if (currentSort === 'popular') {
      items.sort((a, b) => (parseFloat(b.popularity || b.rating) || 0) - (parseFloat(a.popularity || a.rating) || 0));
    } else {
      items.sort((a, b) => (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0));
    }
  } else if (currentSort === 'popular') {
    items.sort((a, b) => (parseFloat(b.popularity || b.rating) || 0) - (parseFloat(a.popularity || a.rating) || 0));
  } else if (currentSort === 'rating') {
    items.sort((a, b) => (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0));
  } else if (currentSort === 'title') {
    items.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ru'));
  } else if (currentTab === 'bookmarks') {
    // По умолчанию для "Мои списки и закладки" сортировка по статусам:
    // Смотрю -> Любимое -> В планах -> Просмотрено -> Отложено -> Заброшено -> Не буду смотреть
    const statusRank = (st) => {
      switch (st) {
        case 'watching': return 1;
        case 'favorite': return 2;
        case 'plan':
        case 'planned': return 3;
        case 'completed': return 4;
        case 'hold':
        case 'on_hold': return 5;
        case 'dropped': return 6;
        case 'wont_watch': return 7;
        default: return 8;
      }
    };
    items.sort((a, b) => {
      const diff = statusRank(a.user_status) - statusRank(b.user_status);
      if (diff !== 0) return diff;
      return (b.updated_at || 0) - (a.updated_at || 0);
    });
  } else {
    // По умолчанию ВЕЗДЕ по дате (новые первыми)
    items.sort((a, b) => (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0));
  }

  // Быстрая внутристраничная фильтрация (поиск по разделу и фильтр «Только 4K»)
  if (only4KQuickFilter && (currentTab !== 'home' || isFiltered || isSearching)) {
    items = items.filter(it => it.is4K === true || (it.quality && String(it.quality).includes('4K')));
  }
  if (inPageQuickQuery && inPageQuickQuery.trim().length > 0 && (currentTab !== 'home' || isFiltered || isSearching)) {
    const qNorm = inPageQuickQuery.trim().toLowerCase();
    items = items.filter(it => {
      const hay = `${it.title || ''} ${it.original_title || ''} ${it.year || ''} ${Array.isArray(it.genres) ? it.genres.join(' ') : (it.genres || '')}`.toLowerCase();
      return hay.includes(qNorm);
    });
  }

  currentItems = items;

  const heroContainer = document.getElementById('hero-showcase-container');

  // Если мы на вкладке Главная и нет фильтрации/поиска - отображаем кинематографичный вид Emby/Plex
  if (currentTab === 'home' && !isFiltered && (!searchQuery || !searchQuery.trim())) {
    const qBar = document.getElementById('storm-quick-catalog-bar');
    if (qBar) {
      qBar.style.display = 'none';
      qBar.innerHTML = '';
    }
    renderHomeView(currentItems);
  } else {
    hideHeroShowcase();
    renderQuickCatalogBar(currentItems.length);
    renderMediaItems(currentItems);
  }
}

export function renderQuickCatalogBar(shownCount = 0) {
  const qBar = document.getElementById('storm-quick-catalog-bar');
  if (!qBar) return;

  if (currentTab === 'offline' || (currentTab === 'bookmarks' && currentBookmarkSubTab === 'lists')) {
    qBar.style.display = 'none';
    qBar.innerHTML = '';
    return;
  }

  qBar.style.display = 'flex';

  const tabTitles = {
    home: 'Результаты каталога',
    new: '✨ Новинки кинопроката',
    movies: '🎬 Фильмы',
    series: '📺 Сериалы',
    cartoons: '🎨 Мультфильмы',
    'cartoon-series': '🎠 Мультсериалы',
    'anime-movies': '🌸 Аниме-фильмы',
    'anime-series': '⛩️ Аниме-сериалы',
    continue: '⏯️ Продолжить просмотр',
    bookmarks: '🔖 Мои списки и закладки'
  };
  const sectionLabel = (searchQuery && searchQuery.trim().length >= 2)
    ? `🔍 Поиск: «${escapeHtml(searchQuery.trim())}»`
    : (tabTitles[currentTab] || 'Каталог медиа');

  // Если панель уже отрендерена для текущей вкладки и пользователь печатает в быстром фильтре — обновляем только счётчик
  const existingInput = qBar.querySelector('#quick-inpage-filter-input');
  if (existingInput && document.activeElement === existingInput) {
    const countBadge = qBar.querySelector('#quick-catalog-count-badge');
    if (countBadge) countBadge.textContent = `${shownCount} шт.`;
    return;
  }

  const quickGenres = [
    { id: 'all', label: 'Все' },
    { id: 'фантастика', label: '🚀 Фантастика' },
    { id: 'боевик', label: '💥 Боевик' },
    { id: 'триллер', label: '🔪 Триллер' },
    { id: 'комедия', label: '😄 Комедия' },
    { id: 'драма', label: '🎭 Драма' },
    { id: 'фэнтези', label: '🧙 Фэнтези' },
    { id: 'детектив', label: '🕵️ Детектив' },
    { id: 'приключения', label: '🧭 Приключения' }
  ];

  const showGenreChips = !['bookmarks', 'continue'].includes(currentTab) && !(searchQuery && searchQuery.trim().length >= 2);

  qBar.innerHTML = `
    <div class="quick-catalog-bar-top">
      <div class="quick-catalog-title-wrap">
        <span class="quick-catalog-section-title">${sectionLabel}</span>
        <span class="quick-catalog-count-badge" id="quick-catalog-count-badge">${shownCount} шт.</span>
      </div>
      <div class="quick-catalog-controls">
        <div class="quick-inpage-search-wrap">
          <span class="quick-inpage-search-icon">🔎</span>
          <input type="text" id="quick-inpage-filter-input" class="quick-inpage-search-input" placeholder="Быстрый фильтр на странице..." value="${escapeHtml(inPageQuickQuery || '')}">
          ${inPageQuickQuery ? `<button type="button" class="quick-inpage-clear-btn" id="quick-inpage-clear-btn" title="Очистить">✕</button>` : ''}
        </div>
        <button type="button" class="quick-catalog-pill-btn ${only4KQuickFilter ? 'active' : ''}" id="quick-filter-4k-toggle" title="Показать только релизы в 4K UHD">
          ✨ 4K UHD
        </button>
        <div class="quick-density-switcher" role="group" aria-label="Размер карточек">
          <button type="button" class="quick-density-btn ${currentCardDensity === 'large' ? 'active' : ''}" data-density="large" title="Крупные постеры">Крупно</button>
          <button type="button" class="quick-density-btn ${(!currentCardDensity || currentCardDensity === 'standard') ? 'active' : ''}" data-density="standard" title="Стандартная сетка">Стандарт</button>
          <button type="button" class="quick-density-btn ${currentCardDensity === 'compact' ? 'active' : ''}" data-density="compact" title="Компактная сетка (больше карточек)">Компакт</button>
        </div>
      </div>
    </div>
    ${showGenreChips ? `
      <div class="quick-catalog-genre-strip" id="quick-catalog-genre-strip">
        ${quickGenres.map(g => `
          <button type="button" class="quick-genre-pill ${String(currentGenre).toLowerCase() === g.id ? 'active' : ''}" data-qgenre="${g.id}">
            ${g.label}
          </button>
        `).join('')}
      </div>
    ` : ''}
  `;

  const inpageInput = qBar.querySelector('#quick-inpage-filter-input');
  if (inpageInput) {
    inpageInput.oninput = (e) => {
      inPageQuickQuery = e.target.value;
      renderFilteredCatalog();
    };
  }
  const clearInpageBtn = qBar.querySelector('#quick-inpage-clear-btn');
  if (clearInpageBtn) {
    clearInpageBtn.onclick = () => {
      inPageQuickQuery = '';
      renderFilteredCatalog();
    };
  }

  const toggle4kBtn = qBar.querySelector('#quick-filter-4k-toggle');
  if (toggle4kBtn) {
    toggle4kBtn.onclick = () => {
      only4KQuickFilter = !only4KQuickFilter;
      renderFilteredCatalog();
    };
  }

  qBar.querySelectorAll('.quick-density-btn').forEach(btn => {
    btn.onclick = () => {
      const d = btn.dataset.density || 'standard';
      currentCardDensity = d;
      localStorage.setItem('storm_card_density', d);
      document.body.dataset.cardDensity = d;
      qBar.querySelectorAll('.quick-density-btn').forEach(b => b.classList.toggle('active', b === btn));
    };
  });

  const gStrip = qBar.querySelector('#quick-catalog-genre-strip');
  if (gStrip) {
    enableHorizontalDragScroll(gStrip);
    gStrip.querySelectorAll('.quick-genre-pill').forEach(pill => {
      pill.onclick = () => {
        const gId = pill.dataset.qgenre || 'all';
        currentGenre = gId;
        syncDesktopFilterLabels();
        renderFilteredCatalog();
      };
    });
  }
}

export function enableHorizontalDragScroll(el) {
  if (!el || el.dataset.dragScrollBound === '1') return;
  el.dataset.dragScrollBound = '1';

  let isDown = false;
  let startX = 0;
  let scrollLeft = 0;
  let movedDistance = 0;

  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('button.media-card-options-btn, button.media-card-bookmark-btn')) return;
    isDown = true;
    movedDistance = 0;
    startX = e.pageX - el.offsetLeft;
    scrollLeft = el.scrollLeft;
    el.classList.add('is-dragging-scroll');
  });

  el.addEventListener('mouseleave', () => {
    if (!isDown) return;
    isDown = false;
    el.classList.remove('is-dragging-scroll');
  });

  el.addEventListener('mouseup', () => {
    if (!isDown) return;
    isDown = false;
    setTimeout(() => el.classList.remove('is-dragging-scroll'), 40);
  });

  el.addEventListener('mousemove', (e) => {
    if (!isDown) return;
    const x = e.pageX - el.offsetLeft;
    const walk = (x - startX) * 1.4;
    movedDistance = Math.max(movedDistance, Math.abs(x - startX));
    if (movedDistance > 6) {
      e.preventDefault();
      el.scrollLeft = scrollLeft - walk;
    }
  });

  el.addEventListener('click', (e) => {
    if (movedDistance > 12) {
      e.stopPropagation();
      e.preventDefault();
      movedDistance = 0;
    }
  }, true);
}

function initLiveSearchSuggestions() {
  const input = document.getElementById('global-search-input');
  const box = document.getElementById('storm-search-suggestions');
  if (!input || !box) return;

  const hideSuggestions = () => {
    box.style.display = 'none';
  };

  const renderSuggestions = (q) => {
    const query = (q || '').trim().toLowerCase();
    const pool = deduplicateMediaList([
      ...(rawCatalogItems || []),
      ...(getBaselineCatalog('popular') || []),
      ...(getBaselineCatalog('movies') || []),
      ...(getBaselineCatalog('series') || [])
    ]);

    if (!query) {
      let recentSearches = [];
      try {
        recentSearches = JSON.parse(localStorage.getItem('storm_recent_searches') || '[]');
      } catch (_) {}
      const topQuick = pool.slice(0, 5);

      box.innerHTML = `
        <div class="search-suggestions-section">
          <div class="search-suggestions-header">
            <span>🔥 Быстрый выбор и популярные запросы</span>
            ${recentSearches.length > 0 ? `<button type="button" class="search-clear-history-btn" id="clear-recent-searches-btn">Очистить историю</button>` : ''}
          </div>
          <div class="search-quick-tags">
            ${(recentSearches.length > 0 ? recentSearches.slice(0, 5) : ['Дюна', 'Интерстеллар', 'Джек Ричер', 'Оппенгеймер', 'Дандадан', '4K UHD']).map(tag => `
              <button type="button" class="search-quick-tag-chip" data-stag="${escapeHtml(tag)}">🔍 ${escapeHtml(tag)}</button>
            `).join('')}
          </div>
        </div>
        ${topQuick.length > 0 ? `
          <div class="search-suggestions-section">
            <div class="search-suggestions-header"><span>⚡ Рекомендуем посмотреть сейчас</span></div>
            <div class="search-suggestions-list">
              ${topQuick.map((it, idx) => `
                <div class="search-suggestion-item" data-sidx="${idx}">
                  <img src="${getSafePosterUrl(it.poster, it.title)}" alt="" class="search-suggestion-poster">
                  <div class="search-suggestion-info">
                    <div class="search-suggestion-title">${escapeHtml(formatMediaTitle(it))}</div>
                    <div class="search-suggestion-meta">${escapeHtml(getMediaYear(it) || it.year || '2025')} • ${escapeHtml(getMediaCategoryLabel(it))}${it.rating ? ` • ★ ${it.rating}` : ''}</div>
                  </div>
                  <span class="search-suggestion-play">▶ Смотреть</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      `;
      box.style.display = 'block';

      const clearHistBtn = box.querySelector('#clear-recent-searches-btn');
      if (clearHistBtn) {
        clearHistBtn.onclick = (e) => {
          e.stopPropagation();
          localStorage.removeItem('storm_recent_searches');
          renderSuggestions('');
        };
      }
      box.querySelectorAll('.search-quick-tag-chip').forEach(chip => {
        chip.onclick = (e) => {
          e.stopPropagation();
          const val = chip.dataset.stag || '';
          input.value = val;
          hideSuggestions();
          executeSearch(val);
        };
      });
      box.querySelectorAll('.search-suggestion-item').forEach(row => {
        row.onclick = (e) => {
          e.stopPropagation();
          const item = topQuick[parseInt(row.dataset.sidx, 10)];
          hideSuggestions();
          if (item) openPlayerModal(item);
        };
      });
      return;
    }

    const matched = pool.filter(it => {
      const hay = `${it.title || ''} ${it.original_title || ''} ${it.year || ''}`.toLowerCase();
      return hay.includes(query);
    }).slice(0, 6);

    if (matched.length === 0) {
      box.style.display = 'none';
      return;
    }

    box.innerHTML = `
      <div class="search-suggestions-section">
        <div class="search-suggestions-header"><span>⚡ Мгновенные совпадения (${matched.length})</span></div>
        <div class="search-suggestions-list">
          ${matched.map((it, idx) => `
            <div class="search-suggestion-item" data-sidx="${idx}">
              <img src="${getSafePosterUrl(it.poster, it.title)}" alt="" class="search-suggestion-poster">
              <div class="search-suggestion-info">
                <div class="search-suggestion-title">${escapeHtml(formatMediaTitle(it))}</div>
                <div class="search-suggestion-meta">${escapeHtml(getMediaYear(it) || it.year || '')} • ${escapeHtml(getMediaCategoryLabel(it))}${it.rating ? ` • ★ ${it.rating}` : ''}</div>
              </div>
              <span class="search-suggestion-play">▶ Открыть</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    box.style.display = 'block';

    box.querySelectorAll('.search-suggestion-item').forEach(row => {
      row.onclick = (e) => {
        e.stopPropagation();
        const item = matched[parseInt(row.dataset.sidx, 10)];
        hideSuggestions();
        if (item) {
          try {
            const recent = JSON.parse(localStorage.getItem('storm_recent_searches') || '[]');
            const cleanT = formatMediaTitle(item);
            const nextRecent = [cleanT, ...recent.filter(x => x !== cleanT)].slice(0, 8);
            localStorage.setItem('storm_recent_searches', JSON.stringify(nextRecent));
          } catch (_) {}
          openPlayerModal(item);
        }
      };
    });
  };

  input.addEventListener('focus', () => {
    renderSuggestions(input.value);
  });

  input.addEventListener('input', () => {
    renderSuggestions(input.value);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#storm-search-box')) {
      hideSuggestions();
    }
  });
}

function initStormTooltips() {
  if (typeof window === 'undefined' || window.matchMedia('(pointer: coarse)').matches) return;
  let tooltipEl = document.getElementById('storm-floating-tooltip');
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.id = 'storm-floating-tooltip';
    tooltipEl.className = 'storm-floating-tooltip';
    document.body.appendChild(tooltipEl);
  }

  let activeTarget = null;
  let showTimer = null;

  const hideTooltip = () => {
    clearTimeout(showTimer);
    if (tooltipEl) tooltipEl.classList.remove('is-visible');
    if (activeTarget && activeTarget.dataset.stormSavedTitle) {
      activeTarget.setAttribute('title', activeTarget.dataset.stormSavedTitle);
      delete activeTarget.dataset.stormSavedTitle;
    }
    activeTarget = null;
  };

  document.addEventListener('mouseover', (e) => {
    const target = e.target.closest('[data-storm-tooltip], button[title], a[title], .profile-interactive-stat-card[title]');
    if (!target || target.closest('.media-card')) return;

    const text = target.getAttribute('data-storm-tooltip') || target.getAttribute('title');
    if (!text || text.trim().length === 0) return;

    if (target.hasAttribute('title')) {
      target.dataset.stormSavedTitle = target.getAttribute('title');
      target.removeAttribute('title');
    }

    activeTarget = target;
    clearTimeout(showTimer);
    showTimer = setTimeout(() => {
      if (!activeTarget || !activeTarget.isConnected) return;
      tooltipEl.textContent = text;
      tooltipEl.classList.add('is-visible');

      const rect = activeTarget.getBoundingClientRect();
      const ttRect = tooltipEl.getBoundingClientRect();
      let top = rect.bottom + 8;
      let left = rect.left + (rect.width - ttRect.width) / 2;

      if (top + ttRect.height > window.innerHeight - 10) {
        top = rect.top - ttRect.height - 8;
      }
      left = Math.max(10, Math.min(window.innerWidth - ttRect.width - 10, left));

      tooltipEl.style.top = `${Math.round(top)}px`;
      tooltipEl.style.left = `${Math.round(left)}px`;
    }, 220);
  });

  document.addEventListener('mouseout', (e) => {
    if (activeTarget && !activeTarget.contains(e.relatedTarget)) {
      hideTooltip();
    }
  });

  window.addEventListener('scroll', hideTooltip, { passive: true });
  document.addEventListener('mousedown', hideTooltip, { passive: true });
}

export async function applyGenreFilter(genre) {
  if (!genre) return;
  const cleanGenre = genre.trim();
  currentGenre = cleanGenre.toLowerCase();
  currentCountry = 'all';

  const genreLabel = document.getElementById('filter-genre-label');
  if (genreLabel) {
    genreLabel.textContent = cleanGenre.charAt(0).toUpperCase() + cleanGenre.slice(1);
  }
  document.querySelectorAll('#filter-genre-list .storm-dropdown-item').forEach(el => {
    el.classList.toggle('is-active', el.dataset.value === currentGenre);
  });

  const resetBtn = document.getElementById('reset-filters-btn');
  if (resetBtn) resetBtn.style.display = 'inline-flex';

  renderFilteredCatalog();

  if (currentItems.length < 3) {
    try {
      const res = await fetch(`/api/media/search?q=${encodeURIComponent(cleanGenre)}&source=all`);
      if (res.ok) {
        const data = await res.json();
        if (data.items && data.items.length > 0) {
          rawCatalogItems = deduplicateMediaList([...rawCatalogItems, ...data.items]);
          renderFilteredCatalog();
        }
      }
    } catch {}
  }

  showToast(`Фильтр по жанру: ${cleanGenre.charAt(0).toUpperCase() + cleanGenre.slice(1)}`, 'info');
}
window.applyGenreFilter = applyGenreFilter;

export async function applyCountryFilter(country) {
  if (!country) return;
  const cleanCountry = country.trim();
  currentCountry = cleanCountry.toLowerCase();
  currentGenre = 'all';

  const homeBtn = document.querySelector('.storm-tab-btn[data-tab="home"]');
  if (homeBtn && currentTab !== 'home') {
    currentTab = 'home';
    document.querySelectorAll('.storm-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'home'));
  }

  const resetBtn = document.getElementById('reset-filters-btn');
  if (resetBtn) resetBtn.style.display = 'inline-flex';

  renderFilteredCatalog();

  if (currentItems.length < 3) {
    try {
      const res = await fetch(`/api/media/search?q=${encodeURIComponent(cleanCountry)}&source=all`);
      if (res.ok) {
        const data = await res.json();
        if (data.items && data.items.length > 0) {
          rawCatalogItems = deduplicateMediaList([...rawCatalogItems, ...data.items]);
          renderFilteredCatalog();
        }
      }
    } catch {}
  }

  showToast(`Фильтр по стране: ${cleanCountry.charAt(0).toUpperCase() + cleanCountry.slice(1)}`, 'info');
}
window.applyCountryFilter = applyCountryFilter;

// -------------------------------------------------------------
// МОДАЛЬНЫЕ ОКНА И ДИАЛОГИ (MODALS)
// -------------------------------------------------------------
function initModals() {
  // Иерархическое закрытие через Escape (ESC):
  // 1. Кастомные выпадающие списки -> 2. Всплывающие поповеры/стикеры -> 3. Настройки Ambilight ->
  // 4. Студийные панели (Pro Видео, Pro Звук) -> 5. Полноэкранный режим видео -> 6. Вторичные модалки -> 7. Плеер
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' && e.keyCode !== 27) return;

    // 1. Открытые кастомные выпадающие списки
    const openDropdowns = document.querySelectorAll('.storm-custom-dropdown.is-open');
    if (openDropdowns.length > 0) {
      openDropdowns.forEach(dd => dd.classList.remove('is-open'));
      e.stopPropagation();
      return;
    }

    // 2. Всплывающие поповеры (стикеры, обои, превью карточек)
    let closedPopover = false;
    const stickerPopover = document.getElementById('chat-stickers-popover');
    if (stickerPopover && stickerPopover.style.display !== 'none') {
      stickerPopover.style.display = 'none';
      closedPopover = true;
    }
    const wpPopover = document.getElementById('room-wallpapers-popover');
    if (wpPopover && wpPopover.style.display !== 'none') {
      wpPopover.style.display = 'none';
      closedPopover = true;
    }
    if (typeof hideCardHoverPreview === 'function') {
      hideCardHoverPreview();
    }
    if (closedPopover) {
      e.stopPropagation();
      return;
    }

    // 3. Панель настроек Ambilight
    const ambHost = document.getElementById('ambilight-settings-panel-host');
    if (ambHost && ambHost.children.length > 0) {
      ambHost.innerHTML = '';
      e.stopPropagation();
      return;
    }

    // 4. Внутренняя студийная шторка плеера (Pro Видео, Pro Звук, Ambilight, Субтитры)
    const studioBackdrop = document.getElementById('player-studio-modal-backdrop');
    if (studioBackdrop && studioBackdrop.style.display !== 'none') {
      studioBackdrop.style.display = 'none';
      const drawerBody = studioBackdrop.querySelector('#studio-drawer-body');
      if (drawerBody) drawerBody.style.display = 'block';
      document.querySelectorAll('.studio-tab-btn').forEach(btn => btn.classList.remove('active'));
      e.stopPropagation();
      return;
    }

    // 5. Полноэкранный режим плеера
    const cinemaModal = document.getElementById('cinema-modal');
    if (cinemaModal && cinemaModal.classList.contains('is-fullscreen')) {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      cinemaModal.classList.remove('is-fullscreen');
      e.stopPropagation();
      return;
    }

    // 6. Любые открытые вторичные модальные окна (КРОМЕ видеоплеера cinema-modal)
    const secondaryModals = Array.from(document.querySelectorAll('.storm-modal-backdrop.is-open')).filter(m => m.id !== 'cinema-modal');
    if (secondaryModals.length > 0) {
      const topModal = secondaryModals[secondaryModals.length - 1];
      topModal.classList.remove('is-open');
      e.stopPropagation();
      return;
    }

    // 7. И только если открыт исключительно видеоплеер — закрываем его
    if (cinemaModal && cinemaModal.classList.contains('is-open')) {
      closePlayerModal();
    }
  });

  // Закрытие кастомных выпадающих списков при клике вне их области
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.storm-custom-dropdown')) {
      document.querySelectorAll('.storm-custom-dropdown.is-open').forEach(dd => {
        dd.classList.remove('is-open');
      });
    }
  });

  // Закрытие при клике по затемненному бэкдропу
  document.querySelectorAll('.storm-modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        if (backdrop.id === 'cinema-modal') {
          closePlayerModal();
        } else {
          backdrop.classList.remove('is-open');
          if (backdrop.id === 'auth-modal') stopTvDeviceCodeSession();
        }
      }
    });
  });

  // Закрытие по крестику
  document.querySelectorAll('.storm-modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = btn.closest('.storm-modal-backdrop');
      if (modal) {
        if (modal.id === 'cinema-modal') {
          closePlayerModal();
        } else {
          modal.classList.remove('is-open');
          if (modal.id === 'auth-modal') stopTvDeviceCodeSession();
        }
      }
    });
  });

  // Открытие модалки логина
  const loginModalBtn = document.getElementById('login-modal-btn');
  const authModal = document.getElementById('auth-modal');
  if (loginModalBtn && authModal) {
    loginModalBtn.onclick = () => authModal.classList.add('is-open');
  }

  // Переключение Вход / Регистрация / ТВ-код
  const switchToRegister = document.getElementById('switch-to-register');
  const switchToLogin = document.getElementById('switch-to-login');
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const authModalTitle = document.getElementById('auth-modal-title');
  const openTvCodeBtn = document.getElementById('open-tv-code-btn');
  const tvCodeContainer = document.getElementById('tv-code-container');
  const tvCodeRefreshBtn = document.getElementById('tv-code-refresh-btn');
  const tvCodeBackBtn = document.getElementById('tv-code-back-btn');

  if (switchToRegister && switchToLogin) {
    switchToRegister.onclick = () => {
      stopTvDeviceCodeSession();
      if (tvCodeContainer) tvCodeContainer.style.display = 'none';
      loginForm.style.display = 'none';
      registerForm.style.display = 'block';
      authModalTitle.textContent = t('auth_register');
    };
    switchToLogin.onclick = () => {
      stopTvDeviceCodeSession();
      if (tvCodeContainer) tvCodeContainer.style.display = 'none';
      registerForm.style.display = 'none';
      loginForm.style.display = 'block';
      authModalTitle.textContent = t('auth_login');
    };
  }

  if (openTvCodeBtn && tvCodeContainer) {
    openTvCodeBtn.onclick = () => {
      if (loginForm) loginForm.style.display = 'none';
      if (registerForm) registerForm.style.display = 'none';
      tvCodeContainer.style.display = 'block';
      if (authModalTitle) authModalTitle.textContent = 'Вход по коду с ТВ';
      startTvDeviceCodeSession();
    };
  }

  if (tvCodeBackBtn && tvCodeContainer) {
    tvCodeBackBtn.onclick = () => {
      stopTvDeviceCodeSession();
      tvCodeContainer.style.display = 'none';
      if (loginForm) loginForm.style.display = 'block';
      if (authModalTitle) authModalTitle.textContent = t('auth_login');
    };
  }

  if (tvCodeRefreshBtn) {
    tvCodeRefreshBtn.onclick = () => {
      startTvDeviceCodeSession();
    };
  }

  // Отправка формы логина
  if (loginForm) {
    loginForm.onsubmit = async (e) => {
      e.preventDefault();
      const loginInput = document.getElementById('login-username');
      const passInput = document.getElementById('login-password');
      const loginVal = (loginInput?.value || '').trim() || 'ReiKatari';
      const passVal = (passInput?.value || '').trim();
      const submitBtn = loginForm.querySelector('button[type="submit"]');
      const origText = submitBtn ? submitBtn.textContent : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '⏳ Вход...';
      }
      try {
        await login(loginVal, passVal);
        authModal.classList.remove('is-open');
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = origText;
        }
      }
    };
  }

  // Гостевой вход без пароля
  const guestLoginBtn = document.getElementById('guest-login-btn');
  if (guestLoginBtn) {
    guestLoginBtn.onclick = () => {
      loginAsGuest();
      authModal.classList.remove('is-open');
    };
  }

  // Отправка формы регистрации
  if (registerForm) {
    registerForm.onsubmit = async (e) => {
      e.preventDefault();
      const userVal = (document.getElementById('reg-username')?.value || '').trim() || 'Пользователь';
      const emailVal = (document.getElementById('reg-email')?.value || '').trim();
      const passVal = (document.getElementById('reg-password')?.value || '').trim();
      try {
        await register(userVal, emailVal, passVal);
        authModal.classList.remove('is-open');
      } catch (err) {
        showToast(err.message, 'error');
      }
    };
  }

  // Кнопка профиля (для зарегистрированных пользователей и гостей)
  const profileBtn = document.getElementById('user-profile-btn');
  if (profileBtn) {
    profileBtn.onclick = () => openProfileModal();
  }

  const headerProfileBtn = document.getElementById('header-profile-btn');
  if (headerProfileBtn) {
    headerProfileBtn.onclick = () => openProfileModal();
  }

  // Кнопка выхода
  const logoutBtn = document.getElementById('profile-logout-btn');
  if (logoutBtn) {
    logoutBtn.onclick = () => {
      logout();
      const profileModal = document.getElementById('profile-modal');
      if (profileModal) profileModal.classList.remove('is-open');
    };
  }
}

// -------------------------------------------------------------
// ПЕРЕКЛЮЧАТЕЛЬ ЯЗЫКОВ
// -------------------------------------------------------------
function initLanguageSwitcher() {
  const langSelect = document.getElementById('header-lang-select');
  if (langSelect) {
    const sysLang = ((navigator.language || 'ru').split(/[-_]/)[0] || 'ru').toLowerCase();
    langSelect.value = localStorage.getItem('storm_lang') || sysLang;
    if (!langSelect.value) langSelect.value = 'ru';
    langSelect.addEventListener('change', (e) => {
      setLanguage(e.target.value);
    });
  }
}

// -------------------------------------------------------------
// ВИДЕОПРЕВЬЮ ПРИ НАВЕДЕНИИ КУРСОРА (VIDEO HOVER PREVIEW)
// -------------------------------------------------------------
let activeHoverPreviewEl = null;

function showCardHoverPreview(card, item) {
  clearTimeout(hoverCloseTimer);
  hideCardHoverPreview();

  // На мобильных устройствах и сенсорных экранах десктопное превью строго отключено
  if (window.innerWidth <= 768 || window.matchMedia('(pointer: coarse)').matches) {
    return;
  }

  if (!card || !card.isConnected || !card.matches(':hover')) {
    return;
  }

  const rect = card.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  const preview = document.createElement('div');
  preview.className = 'media-hover-preview-popup';
  preview.style.visibility = 'hidden';
  document.body.appendChild(preview);

  const popupWidth = 380;
  const margin = 14;

  // Умное позиционирование: размещаем рядом с карточкой, не выходя за пределы экрана
  let left = rect.right + margin;
  if (left + popupWidth > window.innerWidth - margin) {
    left = rect.left - popupWidth - margin;
  }
  if (left < margin) {
    left = Math.max(margin, Math.min(window.innerWidth - popupWidth - margin, rect.left + (rect.width - popupWidth) / 2));
  }

  const popupHeight = preview.offsetHeight || 380;
  let top = rect.top + window.scrollY;
  const viewportTop = window.scrollY + margin;
  const viewportBottom = window.scrollY + window.innerHeight - popupHeight - margin;

  if (top > viewportBottom) {
    top = Math.max(viewportTop, viewportBottom);
  }
  if (top < viewportTop) {
    top = viewportTop;
  }

  preview.style.top = `${top}px`;
  preview.style.left = `${left}px`;
  preview.style.width = `${popupWidth}px`;
  preview.style.visibility = 'visible';

  const formattedTitle = formatMediaTitle(item);
  const sourceName = getSourceName(item);
  const rawGenres = Array.isArray(item.genres) ? item.genres : (typeof item.genres === 'string' ? item.genres.split(/[,/]/).map(g => g.trim()) : []);
  const genres = rawGenres.slice(0, 4);

  const previewYr = getMediaYear(item) || item.year || '';
  const previewCat = getMediaCategoryLabel(item, item.media_type);

  const isUpcoming = isUpcomingMediaItem(item);

  const previewDesc = isUpcoming
    ? `Официальная премьера ожидается в ${previewYr || 'скоро'} году. Добавьте в «Буду смотреть», чтобы не пропустить цифровой релиз и 4K стримы.`
    : (item.description || (previewCat.toLowerCase().includes('сериал') ? 'Просмотр сериала онлайн в высоком качестве с профессиональным русским дубляжем.' : 'Просмотр фильма онлайн в высоком качестве с профессиональным русским дубляжем.'));

  preview.innerHTML = `
    <!-- Верхняя строка плашек -->
    <div class="hover-preview-top-row">
      <div class="hover-preview-badges-left">
        ${isUpcoming ? '<span class="storm-badge storm-badge-upcoming" style="background:rgba(245,158,11,0.22); border-color:#f59e0b; color:#fbbf24; font-weight:800; text-transform:uppercase;">ОЖИДАЕТСЯ</span>' : (item.is4K ? '<span class="storm-badge storm-badge-4k">4K UHD</span>' : '')}
        ${item.user_status ? getStatusBadge(item.user_status) : ''}
      </div>
      <div class="hover-preview-badges-right">
        ${previewYr ? `<span class="storm-badge" style="background:var(--bg-tertiary);border-color:var(--border-subtle);color:var(--text-secondary);">${previewYr}</span>` : ''}
        ${item.rating ? `<span class="storm-badge storm-badge-rating">★ ${item.rating}</span>` : ''}
      </div>
    </div>

    <!-- Название и оригинальное название -->
    <div>
      <h4 class="hover-preview-title" title="${formattedTitle}">${formattedTitle}</h4>
      ${item.original_title ? `<div class="hover-preview-orig-title">${item.original_title}</div>` : ''}
    </div>

    <!-- Метаданные и теги жанров -->
    <div class="hover-preview-meta-row">
      <span>🌐 ${sourceName}</span>
      <span>• ${previewCat}</span>
      ${genres.length > 0 ? `
        <div class="hover-preview-tags">
          ${genres.map(g => `<span class="hover-preview-tag">${g}</span>`).join('')}
        </div>
      ` : ''}
    </div>

    <!-- Синопсис / описание -->
    <p class="hover-preview-desc">${previewDesc}</p>

    <!-- Кнопки действий -->
    <div class="hover-preview-actions">
      <button type="button" class="storm-btn storm-btn-primary storm-btn-sm hover-watch-btn">▶ Смотреть</button>
      <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm hover-room-btn" title="Совместный просмотр в кинозале">👥 Кинозал</button>
    </div>

    <!-- Быстрый выбор статуса просмотра -->
    <div class="hover-preview-status-row">
      <span class="hover-preview-status-label">Статус:</span>
      <div class="hover-preview-status-btns">
        <button type="button" class="hover-status-btn ${item.user_status === 'watching' ? 'active' : ''}" data-status="watching" title="Смотрю">${getStatusIconSvg('watching', { size: 15, animated: item.user_status === 'watching' })}</button>
        <button type="button" class="hover-status-btn ${item.user_status === 'planned' ? 'active' : ''}" data-status="planned" title="В планах">${getStatusIconSvg('planned', { size: 15, animated: item.user_status === 'planned' })}</button>
        <button type="button" class="hover-status-btn ${item.user_status === 'completed' ? 'active' : ''}" data-status="completed" title="Просмотрено">${getStatusIconSvg('completed', { size: 15, animated: item.user_status === 'completed' })}</button>
        <button type="button" class="hover-status-btn ${item.user_status === 'favorite' ? 'active' : ''}" data-status="favorite" title="Любимое">${getStatusIconSvg('favorite', { size: 15, animated: item.user_status === 'favorite' })}</button>
        <button type="button" class="hover-status-btn ${item.user_status === 'on_hold' ? 'active' : ''}" data-status="on_hold" title="Отложено">${getStatusIconSvg('on_hold', { size: 15, animated: item.user_status === 'on_hold' })}</button>
      </div>
    </div>
  `;

  activeHoverPreviewEl = preview;

  // Удерживаем попап при наведении курсора на него
  preview.onmouseenter = () => {
    clearTimeout(hoverCloseTimer);
  };

  // Закрываем с задержкой при уходе курсора
  preview.onmouseleave = () => {
    clearTimeout(hoverCloseTimer);
    hoverCloseTimer = setTimeout(() => {
      hideCardHoverPreview();
    }, 280);
  };

  const watchBtn = preview.querySelector('.hover-watch-btn');
  if (watchBtn) {
    watchBtn.onclick = (e) => {
      e.stopPropagation();
      clearTimeout(hoverCloseTimer);
      hideCardHoverPreview();
      openPlayerModal(item);
    };
  }

  const roomBtn = preview.querySelector('.hover-room-btn');
  if (roomBtn) {
    roomBtn.onclick = async (e) => {
      e.stopPropagation();
      clearTimeout(hoverCloseTimer);
      hideCardHoverPreview();
      const code = await createWatchRoom(item);
      if (code) {
        showToast(`Кинокомната создана! Код: ${code}`, 'success');
      }
    };
  }

  const statusBtns = preview.querySelectorAll('.hover-status-btn');
  statusBtns.forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      clearTimeout(hoverCloseTimer);
      const clickedStatus = btn.dataset.status;
      const isCurrentlyActive = item.user_status === clickedStatus || btn.classList.contains('active');
      const finalStatus = isCurrentlyActive ? 'none' : clickedStatus;

      const res = await saveBookmarkStatus(item, finalStatus);
      if (res) {
        if (finalStatus === 'none') {
          item.user_status = null;
          statusBtns.forEach(b => b.classList.remove('active'));

          // Удаляем плашку статуса на самом попапе
          const badgesLeft = preview.querySelector('.hover-preview-badges-left');
          if (badgesLeft) {
            const oldBadge = badgesLeft.querySelector('.media-card-status-badge');
            if (oldBadge) oldBadge.remove();
          }

          // Удаляем плашку статуса на исходной карточке (сетка)
          const cardPoster = card.querySelector('.media-card-poster');
          if (cardPoster) {
            const oldCardBadge = cardPoster.querySelector('.media-card-status-badge');
            if (oldCardBadge) oldCardBadge.remove();
            const oldWatchedTag = cardPoster.querySelector('.media-card-watched-tag');
            if (oldWatchedTag) oldWatchedTag.remove();
          }

          // Удаляем плашку статуса на исходной карточке (список)
          const detailedHeaderDiv = card.querySelector('.media-detailed-header > div:last-child');
          if (detailedHeaderDiv) {
            const oldCardBadge = detailedHeaderDiv.querySelector('.media-card-status-badge');
            if (oldCardBadge) oldCardBadge.remove();
          }

          // Мгновенное динамическое удаление карточки из DOM во вкладке закладок (только если не активен поиск)
          if (currentTab === 'bookmarks' && (!searchQuery || searchQuery.trim().length < 2)) {
            hideCardHoverPreview();
            card.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
            card.style.opacity = '0';
            card.style.transform = 'scale(0.85)';
            setTimeout(() => {
              card.remove();
              const container = document.getElementById('media-render-container');
              if (container && container.querySelectorAll('.media-card, .media-detailed-card, tr[data-idx]').length === 0) {
                container.innerHTML = `
                  <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-muted);">
                    <div style="font-size: 42px; margin-bottom: 12px;">📋</div>
                    <h3>Закладок пока нет</h3>
                    <p>Добавляйте фильмы и сериалы в закладки для быстрого доступа</p>
                  </div>
                `;
              }
            }, 300);
          }
        } else {
          item.user_status = finalStatus;
          statusBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');

          // Обновляем плашку статуса на самом попапе
          const badgesLeft = preview.querySelector('.hover-preview-badges-left');
          if (badgesLeft) {
            const oldBadge = badgesLeft.querySelector('.media-card-status-badge');
            if (oldBadge) oldBadge.remove();
            badgesLeft.insertAdjacentHTML('beforeend', getStatusBadge(finalStatus));
          }

          // Обновляем плашку статуса на исходной карточке (сетка)
          const cardPoster = card.querySelector('.media-card-poster');
          if (cardPoster) {
            const oldCardBadge = cardPoster.querySelector('.media-card-status-badge');
            if (oldCardBadge) oldCardBadge.remove();
            const overlay = cardPoster.querySelector('.media-card-overlay');
            const badgeHtml = `<div class="media-card-status-badge">${getStatusBadge(finalStatus)}</div>`;
            if (overlay) {
              overlay.insertAdjacentHTML('beforebegin', badgeHtml);
            } else {
              cardPoster.insertAdjacentHTML('beforeend', badgeHtml);
            }
            const topRight = cardPoster.querySelector('.media-card-top-right');
            if (topRight) {
              const oldWatchedTag = topRight.querySelector('.media-card-watched-tag');
              if (finalStatus === 'completed') {
                if (!oldWatchedTag) {
                  topRight.insertAdjacentHTML('afterbegin', '<span class="media-card-watched-tag" title="Просмотрено">✓</span>');
                }
              } else if (oldWatchedTag) {
                oldWatchedTag.remove();
              }
            }
          }

          // Обновляем плашку статуса на исходной карточке (список)
          const detailedHeaderDiv = card.querySelector('.media-detailed-header > div:last-child');
          if (detailedHeaderDiv) {
            const oldCardBadge = detailedHeaderDiv.querySelector('.media-card-status-badge');
            if (oldCardBadge) oldCardBadge.remove();
            detailedHeaderDiv.insertAdjacentHTML('beforeend', getStatusBadge(finalStatus));
          }
        }
      }
    };
  });
}

function hideCardHoverPreview() {
  clearTimeout(hoverCloseTimer);
  if (activeHoverPreviewEl) {
    activeHoverPreviewEl.remove();
    activeHoverPreviewEl = null;
  }
}

window.addEventListener('touchstart', hideCardHoverPreview, { passive: true });

// -------------------------------------------------------------
// PWA И SERVICE WORKER
// -------------------------------------------------------------
let deferredInstallPrompt = null;

function initPwaServiceWorker() {
  if ('serviceWorker' in navigator && !window.__STORM_SW_MANAGED__ && window.location.protocol !== 'file:') {
    navigator.serviceWorker.register(`/sw.js?v=${STORM_ASSET_VER}`, { updateViaCache: 'none' }).catch(() => {});
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    deferredInstallPrompt = e;
    const pwaBtn = document.getElementById('pwa-install-btn');
    if (pwaBtn) {
      pwaBtn.style.display = 'inline-flex';
      pwaBtn.onclick = async () => {
        if (deferredInstallPrompt) {
          deferredInstallPrompt.prompt();
          const { outcome } = await deferredInstallPrompt.userChoice;
          if (outcome === 'accepted') {
            trackClientAction('install_pwa');
            showToast('Приложение STORM MULTIMEDIA установлено!', 'success');
          }
          pwaBtn.style.display = 'none';
          deferredInstallPrompt = null;
        }
      };
    }
  });
}

// -------------------------------------------------------------
// НОВЫЕ КИБЕР-ФУНКЦИИ И ИНТЕГРАЦИИ
// -------------------------------------------------------------
function initNewCyberFeatures() {
  // 1. Smart TV и геймпад (мгновенно для ТВ/APK, отложенно для браузера ПК/смартфона)
  initFormFactorEngine();
  const needsImmediateTv = isStormNativeApp() ||
    localStorage.getItem('storm_tv_mode') === 'true' ||
    /TV|AFT|BRAVIA|Web0S|Tizen|MiBOX/i.test(navigator.userAgent || '');
  if (needsImmediateTv) {
    initGamepadAndTvMode();
  } else {
    setTimeout(() => initGamepadAndTvMode(), 350);
    window.addEventListener('gamepadconnected', () => initGamepadAndTvMode(), { once: true });
  }
  const tvBtn = document.getElementById('toggle-tv-mode-btn');
  if (tvBtn) {
    tvBtn.onclick = () => toggleTvMode();
  }

  // 2. Голосовой ассистент
  initVoiceAssistant({
    onSearch: (query) => {
      const input = document.getElementById('global-search-input');
      if (input) input.value = query;
      searchQuery = query;
      currentPage = 1;
      executeSearch();
    },
    onTabSwitch: (tab) => switchTab(tab),
    onThemeSwitch: (theme) => setTheme(theme),
    onRandomMedia: () => {
      if (currentItems.length > 0) {
        const item = currentItems[Math.floor(Math.random() * currentItems.length)];
        openPlayerModal(item);
      }
    }
  });

  const micBtn = document.getElementById('voice-search-btn');
  if (micBtn) {
    micBtn.onclick = toggleVoiceListening;
  }

  // 3. Синхронизация и бэкап
  const syncBtn = document.getElementById('header-sync-btn');
  const syncModal = document.getElementById('sync-modal');
  if (syncBtn && syncModal) {
    syncBtn.onclick = () => {
      syncModal.classList.add('is-open');
      renderSyncModalContent(document.getElementById('sync-modal-body'));
    };
  }

  // 4. Кинокомнаты (Watch Together)
  const roomsBtn = document.getElementById('header-rooms-btn');
  const roomsModal = document.getElementById('rooms-modal');
  if (roomsBtn && roomsModal) {
    roomsBtn.onclick = () => {
      roomsModal.classList.add('is-open');
    };
  }

  const joinBtn = document.getElementById('join-room-submit-btn');
  const joinInput = document.getElementById('join-room-code-input');
  if (joinBtn && joinInput) {
    joinBtn.onclick = () => {
      const code = joinInput.value.trim();
      if (code) {
        joinWatchRoom(code);
        if (roomsModal) roomsModal.classList.remove('is-open');
      }
    };
  }

  const createRoomBtn = document.getElementById('create-new-room-btn');
  if (createRoomBtn) {
    createRoomBtn.onclick = async () => {
      const item = currentItems[0] || null;
      const code = await createWatchRoom(item);
      if (code) {
        showToast(`Кинокомната создана! Код: ${code}`, 'success');
        if (roomsModal) roomsModal.classList.remove('is-open');
      }
    };
  }

  // Закрытие модальных окон
  document.querySelectorAll('.storm-modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      const backdrop = btn.closest('.storm-modal-backdrop');
      if (backdrop) backdrop.classList.remove('is-open');
    });
  });

  // Трекинг тем для достижения «Хамелеон»
  const themeSelect = document.getElementById('header-theme-select');
  if (themeSelect) {
    themeSelect.addEventListener('change', () => {
      try {
        let history = JSON.parse(localStorage.getItem('storm_themes_history') || '[]');
        if (!history.includes(themeSelect.value)) {
          history.push(themeSelect.value);
          localStorage.setItem('storm_themes_history', JSON.stringify(history));
        }
        trackClientAction('switch_theme', { themes_count: history.length });
      } catch {}
    });
  }

  // Трекинг языков для достижения «Полиглот»
  const langSelect = document.getElementById('header-lang-select');
  if (langSelect) {
    langSelect.addEventListener('change', () => {
      try {
        let history = JSON.parse(localStorage.getItem('storm_langs_history') || '[]');
        if (!history.includes(langSelect.value)) {
          history.push(langSelect.value);
          localStorage.setItem('storm_langs_history', JSON.stringify(history));
        }
        trackClientAction('switch_lang', { langs_count: history.length });
      } catch {}
    });
  }

  // 5. ИИ-советник (STORM NEURAL RECOMMENDER)
  const recBtn = document.getElementById('header-recommender-btn');
  if (recBtn) {
    recBtn.onclick = () => openNeuralRecommenderModal();
  }

  // 6. Календарь релизов и расписание серий
  const calBtn = document.getElementById('header-calendar-btn');
  if (calBtn) {
    calBtn.onclick = () => openReleaseCalendarModal();
  }

  // 7. STORM REMOTE (пульт со смартфона)
  const remBtn = document.getElementById('header-remote-btn');
  if (remBtn) {
    remBtn.onclick = () => openRemoteQrModal();
  }

  // 8. Семейные профили и детский режим
  const famBtn = document.getElementById('header-family-btn');
  if (famBtn) {
    famBtn.onclick = () => openProfileSwitcherModal();
  }

  // Проверка обновлений STORM MULTIMEDIA с GitHub
  const updateBtn = document.getElementById('profile-check-update-btn');
  if (updateBtn) {
    updateBtn.onclick = () => checkForUpdates(true);
  }

  // 9. Мобильное выдвижное меню (Mobile Drawer)
  initMobileDrawer();
}

export function updateFamilyProfileHeader() {
  updateFamilyHeaderUI();
}

// -------------------------------------------------------------
// МОБИЛЬНОЕ ВЫДВИЖНОЕ МЕНЮ (MOBILE DRAWER)
// -------------------------------------------------------------
export function openMobileDrawer() {
  const drawerBackdrop = document.getElementById('mobile-drawer-backdrop');
  if (!drawerBackdrop) return;
  drawerBackdrop.classList.add('is-open');
  document.body.classList.add('drawer-open');
  document.querySelectorAll('.storm-bottom-nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.bottomTab === 'more');
  });
  updateMobileDrawerUser();
  updateDrawerSleepUI();
  updateDrawerCacheSize();
}

export function closeMobileDrawer() {
  const drawerBackdrop = document.getElementById('mobile-drawer-backdrop');
  if (!drawerBackdrop) return;
  drawerBackdrop.classList.remove('is-open');
  document.body.classList.remove('drawer-open');
  // Восстанавливаем подсветку активной вкладки
  document.querySelectorAll('.storm-bottom-nav-item').forEach(b => {
    const bTab = b.dataset.bottomTab;
    let isActive = false;
    if (currentTab === 'home' && bTab === 'home') isActive = true;
    else if (['new', 'movies', 'series', 'cartoons', 'cartoon-series', 'anime-movies', 'anime-series', 'offline'].includes(currentTab) && bTab === 'catalog') isActive = true;
    else if (currentTab === 'bookmarks' && bTab === 'bookmarks') isActive = true;
    b.classList.toggle('active', isActive);
  });
}

export function toggleMobileDrawer() {
  const drawerBackdrop = document.getElementById('mobile-drawer-backdrop');
  if (!drawerBackdrop) return;
  if (drawerBackdrop.classList.contains('is-open')) {
    closeMobileDrawer();
  } else {
    openMobileDrawer();
  }
}

if (typeof window !== 'undefined') {
  window.openMobileDrawer = openMobileDrawer;
  window.closeMobileDrawer = closeMobileDrawer;
  window.toggleMobileDrawer = toggleMobileDrawer;
}

function initMobileDrawer() {
  const drawerBackdrop = document.getElementById('mobile-drawer-backdrop');
  const drawerPanel = document.getElementById('storm-mobile-drawer');
  const openBtn = document.getElementById('mobile-menu-toggle-btn');
  const closeBtn = document.getElementById('mobile-drawer-close-btn');

  if (!drawerBackdrop) return;

  if (openBtn) {
    openBtn.onclick = () => {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(15); } catch (_) {}
      }
      toggleMobileDrawer();
    };
  }

  if (closeBtn) {
    closeBtn.onclick = () => {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(10); } catch (_) {}
      }
      closeMobileDrawer();
    };
  }

  drawerBackdrop.addEventListener('click', (e) => {
    if (e.target === drawerBackdrop) closeMobileDrawer();
  });

  // Закрытие по Escape
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawerBackdrop.classList.contains('is-open')) {
      closeMobileDrawer();
    }
  });

  // Сенсорные жесты: свайп вправо или вниз для закрытия шторки
  if (drawerPanel) {
    let startX = 0;
    let startY = 0;
    let isTracking = false;

    drawerPanel.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        isTracking = true;
      }
    }, { passive: true });

    drawerPanel.addEventListener('touchend', (e) => {
      if (!isTracking || !e.changedTouches.length) return;
      isTracking = false;
      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;
      const diffX = endX - startX;
      const diffY = endY - startY;

      // Свайп вправо на 60+ px при минимальном вертикальном смещении
      if (diffX > 65 && Math.abs(diffY) < 70) {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          try { navigator.vibrate(15); } catch (_) {}
        }
        closeMobileDrawer();
      }
    }, { passive: true });
  }

  const bindDrawerItem = (id, targetAction) => {
    const el = document.getElementById(id);
    if (el) {
      el.onclick = () => {
        closeMobileDrawer();
        closePlayerModal();
        targetAction();
      };
    }
  };

  bindDrawerItem('drawer-recommender-btn', () => openNeuralRecommenderModal());
  bindDrawerItem('drawer-calendar-btn', () => openReleaseCalendarModal());
  bindDrawerItem('drawer-remote-btn', () => openRemoteQrModal());
  bindDrawerItem('drawer-rooms-btn', () => {
    const roomsModal = document.getElementById('rooms-modal');
    if (roomsModal) roomsModal.classList.add('is-open');
  });
  bindDrawerItem('drawer-family-btn', () => openProfileSwitcherModal());
  bindDrawerItem('drawer-sync-btn', () => {
    const syncModal = document.getElementById('sync-modal');
    if (syncModal) {
      syncModal.classList.add('is-open');
      renderSyncModalContent(document.getElementById('sync-modal-body'));
    }
  });
  bindDrawerItem('drawer-tv-mode-btn', () => toggleTvMode());
  bindDrawerItem('drawer-profile-settings-btn', () => openProfileModal());

  const authBtn = document.getElementById('mobile-drawer-auth-btn');
  if (authBtn) {
    authBtn.onclick = () => {
      closeMobileDrawer();
      closePlayerModal();
      const user = getUser();
      if (user) {
        openProfileModal();
      } else {
        const authModal = document.getElementById('auth-modal');
        if (authModal) authModal.classList.add('is-open');
      }
    };
  }

  // 8 визуальных карточек тем оформления в шторке
  const currentTheme = localStorage.getItem('storm_theme') || 'STORM DARK';
  document.querySelectorAll('.drawer-theme-card').forEach(card => {
    const tName = card.dataset.themeName || card.dataset.drawerTheme;
    card.classList.toggle('active', tName === currentTheme);
    card.onclick = () => {
      document.querySelectorAll('.drawer-theme-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      setTheme(tName);
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(15); } catch (_) {}
      }
      showToast(`Тема изменена: ${tName}`);
    };
  });

  // Быстрый выбор языка
  const langSelect = document.getElementById('mobile-drawer-lang-select');
  if (langSelect) {
    langSelect.value = localStorage.getItem('storm_lang') || 'ru';
    langSelect.onchange = (e) => {
      setLanguage(e.target.value);
    };
  }

  // Полноэкранный режим
  const fsBtn = document.getElementById('mobile-drawer-fs-btn');
  if (fsBtn) {
    fsBtn.onclick = () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {});
        fsBtn.innerHTML = '<span>⛶ Выйти из экрана</span>';
      } else {
        document.exitFullscreen?.().catch(() => {});
        fsBtn.innerHTML = '<span>⛶ Во весь экран</span>';
      }
    };
  }

  // Пилюли таймера сна в шторке
  document.querySelectorAll('.drawer-sleep-pill').forEach(pill => {
    pill.onclick = () => {
      const minVal = pill.dataset.sleepMin;
      document.querySelectorAll('.drawer-sleep-pill').forEach(p => p.classList.remove('is-active'));
      pill.classList.add('is-active');

      if (minVal === '0') {
        cancelSleepTimer();
        showToast('⏱️ Таймер сна выключен');
      } else if (minVal === 'end') {
        setSleepTimer('end');
        showToast('⏱️ Таймер сна: в конце серии');
      } else {
        const m = parseInt(minVal, 10);
        setSleepTimer(m);
        showToast(`⏱️ Таймер сна установлен на ${m} мин`);
      }
      updateDrawerSleepUI();
    };
  });

  const sleepCancelBtn = document.getElementById('drawer-sleep-cancel-btn');
  if (sleepCancelBtn) {
    sleepCancelBtn.onclick = () => {
      cancelSleepTimer();
      document.querySelectorAll('.drawer-sleep-pill').forEach(p => {
        p.classList.toggle('is-active', p.dataset.sleepMin === '0');
      });
      updateDrawerSleepUI();
      showToast('⏱️ Таймер сна отменён');
    };
  }

  // Очистка локального кэша
  const clearCacheBtn = document.getElementById('mobile-drawer-clear-cache-btn');
  if (clearCacheBtn) {
    clearCacheBtn.onclick = () => {
      try {
        clientTabCache.clear();
        sessionStorage.clear();
        // Удаляем закэшированные временные ключи
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && (k.startsWith('storm_cache_') || k.startsWith('storm_tmdb_'))) {
            keysToRemove.push(k);
          }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
        const sizeEl = document.getElementById('mobile-drawer-cache-size');
        if (sizeEl) sizeEl.textContent = 'Очищен (0 КБ)';
        showToast('🧹 Кэш каталога и сессий успешно очищен');
      } catch (err) {
        showToast('⚠️ Ошибка при очистке кэша', 'error');
      }
    };
  }
}

export function updateDrawerSleepUI() {
  const statusWrap = document.getElementById('drawer-sleep-status');
  const statusText = document.getElementById('drawer-sleep-status-text');
  if (!statusWrap || !statusText) return;

  const rem = getSleepTimerRemaining();
  if (rem && rem > 0) {
    statusWrap.style.display = 'flex';
    const mins = Math.floor(rem / 60);
    const secs = rem % 60;
    statusText.textContent = `Осталось: ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  } else {
    statusWrap.style.display = 'none';
  }
}
window.updateDrawerSleepUI = updateDrawerSleepUI;

export function updateDrawerCacheSize() {
  const sizeEl = document.getElementById('mobile-drawer-cache-size');
  if (!sizeEl) return;
  try {
    let totalBytes = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) totalBytes += (localStorage.getItem(k) || '').length * 2;
    }
    const mb = (totalBytes / (1024 * 1024)).toFixed(1);
    sizeEl.textContent = `~${mb} МБ`;
  } catch (_) {
    sizeEl.textContent = 'Оптимизирован';
  }
}

export function updateMobileDrawerUser() {
  const user = getUser();
  const usernameEl = document.getElementById('mobile-drawer-username');
  const statusEl = document.getElementById('mobile-drawer-user-status');
  const authBtn = document.getElementById('mobile-drawer-auth-btn');
  const authText = document.getElementById('mobile-drawer-auth-text');
  const avatarEl = document.getElementById('mobile-drawer-avatar');

  if (usernameEl && statusEl) {
    if (user) {
      usernameEl.textContent = user.username || user.name || 'Пользователь';
      statusEl.textContent = user.email || 'Аккаунт активен';
      if (authText) {
        authText.textContent = 'Управление профилем';
      } else if (authBtn) {
        authBtn.innerHTML = '<span>⚙️</span> <span>Управление профилем</span>';
      }
      if (avatarEl && user.avatar) avatarEl.src = user.avatar;
    } else {
      usernameEl.textContent = 'Гость';
      statusEl.textContent = 'Авторизуйтесь для синхронизации';
      if (authText) {
        authText.textContent = 'Войти в профиль';
      } else if (authBtn) {
        authBtn.innerHTML = '<span>🔑</span> <span>Войти в профиль</span>';
      }
      if (avatarEl) avatarEl.src = 'assets/favicon.svg';
    }
  }
}

export { startStormApp };

window.stormRefreshCatalog = () => {
  clientTabCache.clear();
  try {
    loadCurrentTab();
  } catch (err) {
    console.warn('stormRefreshCatalog error:', err);
  }
};

// =============================================================
// БЕЗОПАСНЫЙ СТАРТ ПРИЛОЖЕНИЯ (ПОСЛЕ ПОЛНОЙ ИНИЦИАЛИЗАЦИИ ВСЕХ МОДУЛЕЙ И ПЕРЕМЕННЫХ)
// =============================================================
function safeBootstrap() {
  try {
    startStormApp();
  } catch (err) {
    console.error('STORM App bootstrap error:', err);
    try {
      loadCurrentTab();
    } catch (_) {}
  }
}

if (typeof window !== 'undefined') {
  window.startStormApp = safeBootstrap;
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(safeBootstrap, 0);
  } else {
    document.addEventListener('DOMContentLoaded', safeBootstrap);
    window.addEventListener('load', safeBootstrap);
  }
}

// ============================================================================
// УНИВЕРСАЛЬНЫЙ КАСТОМНЫЙ СЕЛЕКТОР STORM (ЗАМЕНА СИСТЕМНОГО БЕЛОГО ОКНА ANDROID)
// ============================================================================
export function openStormThemedSelectModal(selectEl) {
  if (!selectEl || !selectEl.options || selectEl.options.length === 0) return;

  let modal = document.getElementById('storm-themed-select-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'storm-themed-select-modal';
    modal.className = 'storm-modal-backdrop';
    document.body.appendChild(modal);
  }

  // Извлекаем заголовок настройки из соседнего блока или атрибута title
  let headerTitle = selectEl.getAttribute('title') || '';
  if (!headerTitle) {
    const parentRow = selectEl.closest('div[style*="justify-content: space-between"], .form-group, label');
    if (parentRow) {
      const titleCandidate = parentRow.querySelector('div[style*="font-weight: 700"], div[style*="font-weight:700"], label, strong, span');
      if (titleCandidate && titleCandidate.textContent) {
        headerTitle = titleCandidate.textContent.replace(/Без рекламы.*$/i, '').trim();
      }
    }
  }
  if (!headerTitle) headerTitle = 'Выберите вариант';

  const currentVal = selectEl.value;
  const optionsArr = Array.from(selectEl.options);

  modal.innerHTML = `
    <div class="storm-modal storm-themed-select-dialog">
      <div class="storm-modal-header" style="padding: 16px 20px;">
        <h3 class="storm-modal-title" style="font-size: 16.5px; font-weight: 800;">${escapeHtml(headerTitle)}</h3>
        <button type="button" class="storm-modal-close" id="storm-themed-select-close">✕</button>
      </div>
      <div class="storm-themed-select-list">
        ${optionsArr.map((opt, idx) => {
          const isAct = String(opt.value) === String(currentVal);
          return `
            <button type="button" class="storm-themed-select-option ${isAct ? 'active' : ''}" data-opt-idx="${idx}">
              <span style="line-height: 1.35;">${escapeHtml(opt.textContent || opt.label || opt.value)}</span>
              <span class="storm-themed-radio"></span>
            </button>
          `;
        }).join('')}
      </div>
      <div class="storm-themed-select-footer">
        <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="storm-themed-select-cancel" style="padding: 8px 18px; border-radius: 10px; font-weight: 700;">Отмена</button>
      </div>
    </div>
  `;

  const closeModal = () => {
    modal.classList.remove('is-open');
  };

  modal.querySelector('#storm-themed-select-close')?.addEventListener('click', closeModal);
  modal.querySelector('#storm-themed-select-cancel')?.addEventListener('click', closeModal);
  modal.onclick = (e) => {
    if (e.target === modal) closeModal();
  };

  modal.querySelectorAll('.storm-themed-select-option').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.optIdx, 10);
      const chosenOpt = optionsArr[idx];
      if (chosenOpt) {
        selectEl.selectedIndex = idx;
        selectEl.value = chosenOpt.value;
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        selectEl.dispatchEvent(new Event('input', { bubbles: true }));
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          try { navigator.vibrate(10); } catch (_) {}
        }
      }
      closeModal();
    });
  });

  modal.classList.add('is-open');
}

export function bindStormSelectElement(selectEl) {
  if (!selectEl || selectEl.dataset.stormCustomBound === 'true') return;
  selectEl.dataset.stormCustomBound = 'true';
  selectEl.tabIndex = -1;

  // Оборачиваем <select> в .storm-select-shell, чтобы WebView Android никогда не вызывал системный белый попап
  const parent = selectEl.parentNode;
  if (parent && (!parent.classList || !parent.classList.contains('storm-select-shell'))) {
    const shell = document.createElement('div');
    shell.className = 'storm-select-shell';
    if (selectEl.style.minWidth) shell.style.minWidth = selectEl.style.minWidth;
    if (selectEl.style.width) shell.style.width = selectEl.style.width;
    if (selectEl.style.flex) shell.style.flex = selectEl.style.flex;
    parent.insertBefore(shell, selectEl);
    shell.appendChild(selectEl);

    shell.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openStormThemedSelectModal(selectEl);
    });
  }
}

export function initStormCustomSelects() {
  document.querySelectorAll('select.storm-select, select').forEach(bindStormSelectElement);

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node && node.nodeType === 1) {
          if (node.tagName === 'SELECT') {
            bindStormSelectElement(node);
          } else if (node.querySelectorAll) {
            node.querySelectorAll('select').forEach(bindStormSelectElement);
          }
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}
