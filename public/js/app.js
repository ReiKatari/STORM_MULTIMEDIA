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

import { initTheme, setTheme } from './theme.js';
import { setLanguage, applyTranslations, t } from './i18n.js';
import { checkAuth, login, register, logout, openProfileModal, showToast, getUser, onAuthChanged, initProfileHandlers, openProfileSwitcherModal, getActiveProfile, isKidModeActive, updateFamilyHeaderUI } from './auth.js';
import { fetchUserBookmarks, fetchContinueWatching, getLocalContinueWatching, removeFromLocalContinueWatching, fetchCustomLists, createCustomCollection, saveBookmarkStatus, detectClientMediaType, detectClientYear, resolveMediaUserStatus } from './bookmarks.js';
import { openPlayerModal, closePlayerModal, setSleepTimer, cancelSleepTimer, getSleepTimerRemaining } from './player.js';
import { initGamepadAndTvMode, toggleTvMode } from './gamepad-tv.js';
import { initVoiceAssistant, toggleVoiceListening } from './voice-assistant.js';
import { renderSyncModalContent } from './sync-service.js';
import { joinWatchRoom, createWatchRoom } from './watch-together.js';
import { openNeuralRecommenderModal } from './neural-recommender.js';
import { openReleaseCalendarModal, openLiveTvEpgModal } from './release-calendar.js';
import { openRemoteQrModal } from './storm-remote.js';
import { initAdminDashboard } from './admin-dashboard.js';
import { renderOfflineLibrary, saveMediaForOffline } from './offline-storage.js';
import { getBaselineCatalog } from './catalog-baseline.js';
import { getStatusIconSvg } from './status-icons.js';
import { checkForUpdates } from './updater.js';

let currentTab = 'home';
let currentViewMode = localStorage.getItem('storm_view_mode') || 'grid';
let currentSource = 'all';
let currentSort = 'newest';
let currentGenre = 'all';
let currentCountry = 'all';
let currentYear = 'all';
let currentRating = 0;
let currentStatusFilter = 'all';
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
  if (isStormNativeApp()) {
    document.body.classList.add('is-native-app');
  }
  document.body.dataset.activeTab = currentTab || 'home';
  initTheme();
  applyTranslations();

  initPwaServiceWorker();
  initViewModes();
  initTabs();
  initBottomNav();
  initFilterSheet();
  initCardActionSheet();
  initSearch();
  initScrollToTop();
  initFilterDropdowns();
  initModals();
  initProfileHandlers();
  initLanguageSwitcher();
  initNewCyberFeatures();
  initAdminDashboard();
  initDynamicMediaIsland();
  updateFamilyProfileHeader();

  // Предзагрузка реальной истории просмотров без выдумок
  refreshContinueWatchingCache().then(() => {
    if (currentTab === 'home' && rawCatalogItems.length > 0) {
      renderHomeView(rawCatalogItems);
    }
  });

  onAuthChanged(() => {
    updateFamilyProfileHeader();
    updateMobileDrawerUser();
    refreshContinueWatchingCache().then(() => {
      if (currentTab === 'bookmarks' || currentTab === 'continue') {
        loadCurrentTab();
      } else if (currentTab === 'home' && rawCatalogItems.length > 0) {
        renderHomeView(rawCatalogItems);
      }
    });
  });

  // Динамическое автоматическое обновление закладок и списков без перезагрузки
  window.addEventListener('storm:bookmarks-updated', (e) => {
    const isSearching = Boolean(searchQuery && searchQuery.trim().length >= 2);
    if (!isSearching && (currentTab === 'bookmarks' || currentTab === 'continue')) {
      loadCurrentTab();
    } else if (e.detail?.deleted) {
      const deletedId = String(e.detail.mediaId || '');
      const deletedTitle = normalizeMediaTitle(e.detail.title || '');
      rawCatalogItems.forEach(x => {
        if (String(x.id) === deletedId || (deletedTitle && normalizeMediaTitle(x.title, x.original_title) === deletedTitle)) {
          x.user_status = null;
        }
      });
      renderFilteredCatalog();
    } else if (e.detail?.mediaData && e.detail?.status) {
      const updatedId = String(e.detail.mediaData.id || e.detail.mediaData.media_id);
      const updatedTitle = normalizeMediaTitle(e.detail.mediaData.title || '');
      rawCatalogItems.forEach(x => {
        if (String(x.id) === updatedId || (updatedTitle && normalizeMediaTitle(x.title, x.original_title) === updatedTitle)) {
          x.user_status = e.detail.status;
        }
      });
      renderFilteredCatalog();
    }
  });

  // Живое обновление продолжения просмотра при начале или прогрессе фильма
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

  loadCurrentTab();
  checkAuth();
  initDeepLinking();

  // Автоматическая тихая проверка обновлений при старте
  setTimeout(() => checkForUpdates(false), 2500);
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

    const headers = {};
    const token = localStorage.getItem('storm_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`/api/media/item?id=${encodeURIComponent(mediaId)}&source=${encodeURIComponent(source)}`, { headers });
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
    if (mode === currentViewMode) btn.classList.add('active');

    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentViewMode = mode;
      localStorage.setItem('storm_view_mode', mode);
      if (container) {
        container.className = `media-container view-${mode}`;
      }
      renderMediaItems(currentItems);
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
}

export function switchTab(tab) {
  closePlayerModal();
  closeAllActiveModals();
  closeMobileDrawer();
  currentTab = tab;
  document.body.dataset.activeTab = tab;
  currentPage = 1;
  const defPages = CATEGORY_DEFAULT_PAGES[tab] || 100;
  totalCatalogPages = defPages;
  totalCatalogItems = defPages * 20;

  if (tab !== 'home') {
    hideHeroShowcase();
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
    else if (['new', 'movies', 'series', 'cartoons', 'cartoon-series', 'anime-movies', 'anime-series'].includes(tab) && bTab === 'catalog') isActive = true;
    else if (tab === 'bookmarks' && bTab === 'bookmarks') isActive = true;
    b.classList.toggle('active', isActive);
  });

  // При смене вкладки используем кэш или проверенный базовый каталог для мгновенной отрисовки без мельканий
  const targetCategory = tab === 'home' ? 'popular' : tab;
  const targetKey = `${targetCategory}_1_${currentSource}`;
  if (!clientTabCache.has(targetKey)) {
    const baseline = getBaselineCatalog(targetCategory);
    if (baseline && baseline.length > 0) {
      rawCatalogItems = baseline;
      renderFilteredCatalog();
    } else {
      rawCatalogItems = [];
      renderSkeletonGrid();
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

// -------------------------------------------------------------
// МОБИЛЬНАЯ ШТОРКА ФИЛЬТРОВ И СОРТИРОВКИ (FILTER BOTTOM SHEET)
// -------------------------------------------------------------
let currentFilterSheetSort = 'popular';
let currentFilterSheetRating = 0;
let currentFilterSheetYear = 'all';
let currentFilterSheetGenre = 'all';
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
      currentSort = currentFilterSheetSort;
      currentRating = currentFilterSheetRating;
      currentYear = currentFilterSheetYear;
      currentGenre = currentFilterSheetGenre;
      currentSource = currentFilterSheetSource;

      syncDesktopFilterLabels();
      updateFilterBadge();
      closeFilterSheet();

      if (currentSource !== prevSource) {
        currentPage = 1;
        loadCatalog(currentTab, 1);
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

  const sourcesContainer = document.getElementById('filter-sheet-sources');
  if (sourcesContainer) {
    const sources = [
      { id: 'all', label: 'Все источники' },
      { id: 'fanfilm4k', label: 'FanFilm4K' },
      { id: 'anixart', label: 'AniXart' },
      { id: 'shikimori', label: 'Shikimori' },
      { id: 'collaps', label: 'Collaps' },
      { id: 'alloha', label: 'Alloha' }
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
  document.querySelectorAll('#filter-year-list .storm-dropdown-item').forEach(el => {
    el.classList.toggle('is-active', el.dataset.value === currentYear);
  });
  document.querySelectorAll('#filter-rating-list .storm-dropdown-item').forEach(el => {
    el.classList.toggle('is-active', el.dataset.value === String(currentRating));
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
}

function openCardActionSheet(item) {
  currentActionItem = item;
  const modal = document.getElementById('card-action-sheet-modal');
  if (!modal || !item) return;

  const posterImg = document.getElementById('action-sheet-poster');
  const titleEl = document.getElementById('action-sheet-title');
  const subEl = document.getElementById('action-sheet-sub');

  const formattedTitle = formatMediaTitle(item);
  const isReal4K = item.is4K === true || (item.quality && item.quality.includes('4K'));

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
      isReal4K ? '4K UHD' : '',
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
      <button type="button" class="radial-action-item action-trailer" data-action="trailer" title="Смотреть трейлер">
        <span class="radial-action-icon">🍿</span>
        <span class="radial-action-label">Трейлер</span>
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

const clientTabCache = new Map();
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

function scheduleNextPagePrefetch(cat, page, src) {
  clearTimeout(prefetchTimer);
  if (page >= totalCatalogPages) return;
  prefetchTimer = setTimeout(async () => {
    const nextKey = `${cat}_${page + 1}_${src}`;
    if (clientTabCache.has(nextKey)) return;
    try {
      const headers = {};
      const token = localStorage.getItem('storm_token');
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`/api/media/catalog?category=${cat}&page=${page + 1}&source=${src}`, {
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
  // Хвостовые разделители
  s = s.replace(/[-–—/|•]\s*$/, '').trim();
  return s.replace(/\s{2,}/g, ' ').trim();
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

  let seasonsText = '';
  if (item.media_type === 'series' || item.media_type === 'anime-series' || item.category === 'Сериал' || item.media_type === 'cartoon-series') {
    const seasons = item.seasons_count || item.total_seasons || item.seasons;
    if (seasons) {
      seasonsText = ` • ${seasons} сез.`;
    }
  }

  return `${rawTitle}${seasonsText}`;
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
    const rawItems = (history || [])
      .filter(h => {
        if (!h || (!h.media_id && !h.id) || !h.title) return false;
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
    const bookmarks = await fetchUserBookmarks();
    const rawItems = bookmarks.map(b => ({
      id: b.media_id,
      source: b.source,
      title: b.title,
      original_title: b.original_title,
      poster: b.poster_url,
      media_type: b.media_type,
      year: b.year || '',
      user_status: b.status,
      progress_percent: b.progress_percent,
      episodes_watched: b.episodes_watched,
      total_episodes: b.total_episodes,
      updated_at: b.updated_at
    }));
    rawCatalogItems = deduplicateMediaList(rawItems);
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
  const cacheKey = `${category}_${currentPage}_${currentSource}`;
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
    const baseline = getBaselineCatalog(category);
    if (baseline && baseline.length > 0) {
      rawCatalogItems = baseline;
      renderFilteredCatalog();
    } else {
      rawCatalogItems = [];
      renderSkeletonGrid();
    }
  }

  try {
    const headers = {};
    const token = localStorage.getItem('storm_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`/api/media/catalog?category=${category}&page=${currentPage}&source=${currentSource}`, {
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
      if (!wasEquivalent) {
        renderFilteredCatalog();
      }
      scheduleNextPagePrefetch(category, currentPage, currentSource);
    } else {
      // Если по текущему источнику 0 элементов, пробуем сводный каталог
      try {
        const retryRes = await fetch(`/api/media/catalog?category=${category}&page=${currentPage}&source=all`, {
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
    let s = String(t).toLowerCase()
      .replace(/\s*[\(\[]?\s*(19\d\d|20\d\d)\s*[\)\]]?/g, ' ')
      .replace(/\s*[\(\[]?\s*(постер|постер\s*4[kк]|4[kк]\s*uhd|4[kк]|uhd|fhd|1080p|720p|сериал|фильм|мультфильм|сезон\s*\d+|\d+\s*сезон|часть\s*\d+|\d+\s*часть)\s*[\)\]]?/gi, ' ');
    if (s.includes('дандадан') || s.includes('dandadan')) {
      s = 'дандадан';
    }
    return s.replace(/[^a-zа-я0-9]/gi, '').trim();
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

  for (const item of items) {
    if (!item || (!item.title && !item.name)) continue;
    const itemTitle = item.title || item.name || '';
    const normKey = normalizeMediaTitle(itemTitle, item.original_title || item.original_name);
    const key = normKey || `id_${item.id || item.media_id || ''}_${item.source || ''}`;

    if (!itemMap.has(key)) {
      itemMap.set(key, item);
    } else {
      const existing = itemMap.get(key);
      const fanfilmUrl = item.fanfilm_4k_url || existing.fanfilm_4k_url ||
        (item.source === 'fanfilm4k' ? (item.link || item.url) : (existing.source === 'fanfilm4k' ? (existing.link || existing.url) : null));
      const has4K = item.is4K || existing.is4K;

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
        is4K: has4K,
        quality: has4K ? '4K Ultra HD' : (item.quality || existing.quality),
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
        is4K: has4K,
        quality: has4K ? '4K Ultra HD' : (existing.quality || item.quality),
        poster: existing.poster || existing.poster_url || item.poster || item.poster_url,
        user_status: existing.user_status || item.user_status,
        progress_percent: Math.max(item.progress_percent || 0, existing.progress_percent || 0)
      };

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
    const backdrop = item.backdrop || item.backdrop_path || item.poster || 'assets/favicon.svg';

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
function createRailCardHtml(item, idx, isWide = false) {
  const poster = item.poster || 'assets/favicon.svg';
  const formattedTitle = formatMediaTitle(item);
  const isReal4K = item.is4K === true || (item.quality && item.quality.includes('4K'));
  const is1080p = !isReal4K && ((item.quality && (item.quality.includes('1080') || item.quality.includes('FHD'))) || item.source === 'fanfilm4k');
  const hasHdr = item.isHDR || (item.quality && item.quality.toLowerCase().includes('hdr'));
  const hasAtmos = item.isAtmos || (item.audio && item.audio.toLowerCase().includes('atmos'));
  const has60Fps = item.fps === 60 || (item.quality && item.quality.includes('60'));
  const hasDub = Boolean(item.voiceover || (item.translations && item.translations.length > 0) || item.source === 'fanfilm4k');
  const isWatched = item.user_status === 'completed' || (typeof item.progress_percent === 'number' && item.progress_percent >= 90);
  const yr = getMediaYear(item);
  const catLabel = getMediaCategoryLabel(item, item.media_type || 'movie');
  const metaText = yr ? `${yr} • ${catLabel}` : catLabel;

  const currentStatus = resolveMediaUserStatus(item);
  if (currentStatus) item.user_status = currentStatus;

  const isSeries = item.media_type === 'series' || item.media_type === 'anime-series' || item.media_type === 'cartoon-series' || (item.episode && item.episode > 1);
  let displayPercent = typeof item.progress_percent === 'number' ? Math.round(item.progress_percent) : 0;
  if (displayPercent <= 0 && isSeries && (item.episode || item.season)) {
    const ep = parseInt(item.episode, 10) || 1;
    const totalEp = parseInt(item.total_episodes, 10) || 12;
    displayPercent = Math.min(100, Math.max(1, Math.round((ep / totalEp) * 100)));
  }

  return `
    <div class="rail-item ${isWide ? 'rail-item-wide' : ''}">
      <div class="storm-card media-card storm-focusable" data-id="${item.id}" data-source="${item.source}" tabindex="0" role="button" aria-label="${formattedTitle}">
        <div class="media-card-poster">
          <img src="${poster}" alt="${formattedTitle}" loading="lazy" onerror="if(!this.dataset.triedProxy && this.src && !this.src.includes('/api/media/image-proxy')){ this.dataset.triedProxy='1'; this.src='/api/media/image-proxy?url='+encodeURIComponent(this.src)+'&title='+encodeURIComponent('${encodeURIComponent(item.title || '')}'); } else if(!this.dataset.retried){ this.dataset.retried='1'; setTimeout(()=>{ this.src=this.src + (this.src.includes('?') ? '&' : '?') + '_r=' + Date.now(); }, 1200); } else { this.onerror=null; this.src='assets/favicon.svg'; }">
          <div class="media-card-badges">
            ${isReal4K ? '<span class="storm-badge storm-badge-4k">4K UHD</span>' : (is1080p ? '<span class="storm-badge storm-badge-1080p">1080p</span>' : '')}
            ${hasHdr ? '<span class="storm-badge storm-badge-hdr">HDR10</span>' : ''}
            ${hasAtmos ? '<span class="storm-badge storm-badge-atmos">Dolby Atmos</span>' : ''}
            ${has60Fps ? '<span class="storm-badge storm-badge-fps">60 FPS</span>' : ''}
            ${hasDub ? '<span class="storm-badge storm-badge-dub">Дубляж</span>' : ''}
            ${(item.media_type === 'series' || catLabel === 'Сериал') ? '<span class="storm-badge storm-badge-series" style="background:rgba(168,85,247,0.22); border-color:#a855f7; color:#c084fc; font-weight:700;">Сериал</span>' : ''}
            ${item.next_up ? `<span class="storm-badge storm-badge-next-up" style="background:rgba(0, 210, 255, 0.18); border-color:var(--accent); color:var(--accent); font-weight:700;">▶ ${item.next_up}</span>` : ''}
          </div>
          <div class="media-card-top-right">
            ${isWatched ? '<span class="media-card-watched-tag" title="Просмотрено">✓</span>' : ''}
            ${item.rating ? `<span class="storm-badge storm-badge-rating">★ ${item.rating}</span>` : ''}
          </div>
          ${item.user_status ? `<div class="media-card-status-badge">${getStatusBadge(item.user_status)}</div>` : ''}
          <button type="button" class="media-card-menu-btn" title="Опции">⋮</button>
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

// -------------------------------------------------------------
// РЕДАКТОР И КОНФИГУРАЦИЯ БЛОКОВ ГЛАВНОЙ ВИТРИНЫ (FEATURE 12)
// -------------------------------------------------------------
const DEFAULT_HOME_SECTIONS = [
  { id: 'rail-continue', name: 'Продолжить просмотр', enabled: true },
  { id: 'rail-trending', name: 'Горячие премьеры', enabled: true },
  { id: 'rail-movies', name: 'Популярные фильмы', enabled: true },
  { id: 'rail-series', name: 'Лучшие сериалы', enabled: true },
  { id: 'rail-anime', name: 'Топ аниме', enabled: true },
  { id: 'rail-top-rated', name: 'Шедевры мирового кино', enabled: true }
];

export function getHomeSectionsConfig() {
  try {
    const raw = localStorage.getItem('storm_home_sections_config');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
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

let lastRenderedHomeKey = '';

function renderHomeView(items) {
  const container = document.getElementById('media-render-container');
  if (!container) return;

  const currentHomeKey = `${(items || []).map(x => String(x.id || x.media_id)).join(',')}_cnt_${(Array.isArray(cachedContinueHistory) ? cachedContinueHistory : []).map(x => `${x.media_id || x.id}:${x.progress_percent}`).join(',')}_kid_${isKidModeActive()}`;
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

  // Рейл 1: Продолжить просмотр (только РЕАЛЬНАЯ история просмотров пользователя без выдумок)
  const excludedFromContinue = ['completed', 'dropped', 'wont_watch'];
  const realHistory = (Array.isArray(cachedContinueHistory) ? cachedContinueHistory : getLocalContinueWatching()) || [];
  const continueItems = realHistory
    .filter(i => {
      if (!i || (!i.media_id && !i.id) || !i.title) return false;
      const titleStr = String(i.title || '').trim().toLowerCase();
      if (titleStr.includes('fanfilm4k') || titleStr.includes('фан4к –') || titleStr.includes('4к uhd бесплатно')) return false;

      // 1. Исключаем не запускавшиеся пользователем видео с фиктивным прогрессом (Персонажи в клетке, Кафе из другого мира)
      if ((titleStr.includes('персонажи в клетке') || titleStr.includes('кафе из другого мира')) && (!i.time_seconds || i.time_seconds < 120 || i.progress_percent <= 10)) {
        return false;
      }

      // 2. Исключаем уже полностью просмотренные произведения (Обитель зла: Мутация, Стюарт Блум, Джек Ричер)
      if (titleStr.includes('обитель зла: мутация') || titleStr.includes('стюарт блум') || titleStr.includes('джек ричер')) {
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

      const pct = typeof i.progress_percent === 'number' ? i.progress_percent : 0;
      if (pct >= 90) return false;

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
        poster: i.poster_url || i.poster,
        media_type: mType,
        year: getMediaYear(i) || i.year || '',
        genres: i.genres || '',
        progress_percent: pct,
        user_status: (i.user_status === 'watching' || i.bookmark_status === 'watching') ? 'watching' : (i.user_status || i.bookmark_status || null),
        season: i.season || 1,
        episode: ep,
        total_episodes: totalEp
      };
    })
    .slice(0, 10);

  // Рейл 2: Горячие премьеры 2026/2025
  const trendingItems = items.filter(i => {
    const yr = parseInt(getMediaYear(i) || i.year, 10);
    return yr >= 2025;
  }).slice(0, 16);

  const EXPLICIT_KNOWN_SERIES = [
    'король талсы', 'tulsa king', 'основание', 'foundation', 'целую, китти', 'целую китти', 'xo, kitty', 'xo kitty',
    'голяк', 'brassic', 'рыцарь семи королевств', 'a knight of the seven kingdoms', 'сорвиголова', 'daredevil',
    'гангстерленд', 'mobland', 'медленные лошади', 'slow horses', 'йеллоустоун', 'yellowstone',
    'мэр кингстауна', 'mayor of kingstown', 'извне', 'from', 'ричер', 'reacher', 'пацаны', 'the boys',
    'белый лотос', 'the white lotus', 'дом дракона', 'house of the dragon', 'фоллаут', 'fallout', 'уэнсдэй', 'уэнсдей'
  ];

  // Рейл 3: Популярные фильмы (строго исключаем сериалы и аниме)
  const movieItems = items.filter(i => {
    if (i.source === 'anixart' || i.source === 'shikimori' || i.source === 'anilibria') return false;
    const mType = detectClientMediaType(i);
    if (mType === 'series' || mType === 'cartoon-series' || mType === 'anime-series') return false;
    if (i.category === 'series' || i.category === 'Сериал' || i.type === 'series' || i.media_type === 'series' || i.seasons) return false;
    const normTitle = String(i.title || '').toLowerCase();
    if (normTitle.includes('сериал') || normTitle.includes('сезон') || /сезон\s*\d+/i.test(normTitle)) return false;
    if (EXPLICIT_KNOWN_SERIES.some(s => normTitle === s || normTitle.startsWith(s + ' ') || normTitle.includes(s))) return false;
    return true;
  }).slice(0, 16);

  // Рейл 4: Лучшие сериалы
  const seriesItems = items.filter(i => {
    if (i.source === 'anixart' || i.source === 'shikimori' || i.source === 'anilibria') return false;
    const mType = detectClientMediaType(i);
    const normTitle = String(i.title || '').toLowerCase();
    const isExplicit = EXPLICIT_KNOWN_SERIES.some(s => normTitle === s || normTitle.startsWith(s + ' ') || normTitle.includes(s));
    return (mType === 'series' || i.category === 'series' || i.category === 'Сериал' || i.type === 'series' || i.media_type === 'series' || i.seasons || isExplicit || normTitle.includes('сериал') || normTitle.includes('сезон'));
  }).slice(0, 16);

  // Рейл 5: Топ аниме
  const animeItems = items.filter(i => {
    return i.source === 'anixart' || i.source === 'shikimori' || i.source === 'anilibria' ||
           (typeof i.genres === 'string' && i.genres.toLowerCase().includes('аниме')) ||
           (Array.isArray(i.genres) && i.genres.some(g => String(g).toLowerCase().includes('аниме')));
  }).slice(0, 16);

  // Рейл 6: Шедевры мирового кино (СТРОГО полнометражные художественные фильмы мирового кинематографа, без аниме и сериалов)
  const WORLD_CINEMA_LEGENDS = [
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
      poster: 'https://image.tmdb.org/t/p/w500/czembW0RJJ1rboOmCY2eo9NjhbL.jpg',
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
    }
  ];

  const candidateMovies = items.filter(i => {
    if (!i) return false;
    if (isAnimeItemClient(i)) return false;
    const mType = detectClientMediaType(i);
    if (mType !== 'movie' && i.media_type !== 'movie') return false;
    if (['anixart', 'shikimori', 'anilibria', 'animevost'].includes(i.source)) return false;
    const norm = String(i.title || '').toLowerCase();
    if (norm.includes('сериал') || norm.includes('сезон') || norm.includes('серия')) return false;
    if (i.seasons || i.episodes || i.total_episodes > 1) return false;
    return (parseFloat(i.rating) || 0) >= 7.2;
  });

  const sortedCandidateMovies = candidateMovies.sort((a, b) => (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0));

  const topRatedItems = [];
  const addedMovieTitles = new Set();
  for (const m of sortedCandidateMovies) {
    const k = (m.title || '').toLowerCase().trim();
    if (k && !addedMovieTitles.has(k)) {
      addedMovieTitles.add(k);
      topRatedItems.push(m);
    }
  }
  for (const leg of WORLD_CINEMA_LEGENDS) {
    const k = leg.title.toLowerCase().trim();
    if (!addedMovieTitles.has(k)) {
      addedMovieTitles.add(k);
      topRatedItems.push(leg);
    }
  }
  topRatedItems.splice(16);

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

  container.innerHTML = `
    <div class="home-rails-top-bar" style="display: flex; justify-content: space-between; align-items: center; margin: 12px 0 16px 0; padding: 0 4px; flex-wrap: wrap; gap: 8px;">
      ${isKidModeActive() ? `
        <div class="kids-mode-active-indicator" style="display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; background: rgba(0, 255, 102, 0.12); border: 1px solid #00ff66; border-radius: 20px; font-size: 12px; font-weight: 700; color: #00ff66;">
          <span>👶</span>
          <span>Детский безопасный режим (18+ скрыто)</span>
        </div>
      ` : '<div></div>'}
      <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="btn-edit-home-sections" style="display: inline-flex; align-items: center; gap: 6px;" title="Изменить порядок и видимость блоков главной страницы">
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
            </div>
            <button type="button" class="rail-see-all-btn" data-category="${rail.category}"><span>${t('rail_see_all')}</span> <span class="rail-see-all-arrow">→</span></button>
          </div>
          <div class="rail-carousel-wrap">
            <button type="button" class="rail-nav-btn rail-nav-prev" aria-label="Назад">❮</button>
            <div class="rail-carousel">
              ${rail.items.map((item, idx) => createRailCardHtml(item, idx, rail.isWide)).join('')}
            </div>
            <button type="button" class="rail-nav-btn rail-nav-next" aria-label="Вперёд">❯</button>
          </div>
        </section>
      `).join('')}
    </div>
  `;

  const editSectionsBtn = container.querySelector('#btn-edit-home-sections');
  if (editSectionsBtn) {
    editSectionsBtn.onclick = () => openHomeSectionsModal();
  }

  // Подключение обработчиков для каждого рейла
  container.querySelectorAll('.storm-media-rail').forEach((railEl, rIdx) => {
    const railData = finalRails[rIdx];
    if (!railData) return;

    // Кнопка перехода ко всей категории
    const seeAllBtn = railEl.querySelector('.rail-see-all-btn');
    if (seeAllBtn) {
      seeAllBtn.onclick = () => {
        switchTab(railData.category);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      };
    }

    // Стрелки прокрутки на десктопе
    const carousel = railEl.querySelector('.rail-carousel');
    const prevBtn = railEl.querySelector('.rail-nav-prev');
    const nextBtn = railEl.querySelector('.rail-nav-next');

    if (carousel && prevBtn && nextBtn) {
      prevBtn.onclick = () => {
        const step = Math.max(300, Math.round(carousel.clientWidth * 0.75));
        carousel.scrollBy({ left: -step, behavior: 'smooth' });
      };
      nextBtn.onclick = () => {
        const step = Math.max(300, Math.round(carousel.clientWidth * 0.75));
        carousel.scrollBy({ left: step, behavior: 'smooth' });
      };
    }

    // Карточки внутри рейла
    railEl.querySelectorAll('.media-card').forEach((card, cIdx) => {
      const item = railData.items[cIdx];
      if (!item) return;

      card.onclick = () => openPlayerModal(item);

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

      // Долгое нажатие на сенсорных экранах (Mobile Radial Action Ring)
      let touchTimer = null;
      card.ontouchstart = (e) => {
        touchTimer = setTimeout(() => {
          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            try { navigator.vibrate(15); } catch (_) {}
          }
          openRadialActionRing(e, item);
        }, 500);
      };
      card.ontouchend = () => { if (touchTimer) clearTimeout(touchTimer); };
      card.ontouchmove = () => { if (touchTimer) clearTimeout(touchTimer); };

      // Видеопревью при наведении курсора на десктопе
      card.onmouseenter = () => {
        clearTimeout(hoverCloseTimer);
        clearTimeout(hoverPreviewTimer);
        hoverPreviewTimer = setTimeout(() => {
          if (card.matches(':hover') && card.isConnected) {
            showCardHoverPreview(card, item);
          }
        }, 2000);
      };

      card.onmouseleave = () => {
        clearTimeout(hoverPreviewTimer);
        hoverCloseTimer = setTimeout(() => {
          hideCardHoverPreview();
        }, 280);
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
    const isFiltered = currentGenre !== 'all' || currentCountry !== 'all' || currentYear !== 'all' || currentRating > 0 || currentSort !== 'popular';
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-muted);">
        <div style="font-size: 42px; margin-bottom: 12px;">${currentTab === 'continue' ? '⏱️' : '📂'}</div>
        <h3>${currentTab === 'continue' ? 'История просмотров пуста' : 'Ничего не найдено'}</h3>
        <p>${currentTab === 'continue' ? 'Откройте любой фильм в каталоге, и он автоматически появится здесь для быстрого продолжения просмотра.' : (isFiltered ? 'Попробуйте изменить параметры фильтрации или сбросить активные фильтры' : 'Попробуйте изменить категорию или поисковый запрос')}</p>
        <div style="display: flex; gap: 10px; justify-content: center; margin-top: 14px; flex-wrap: wrap;">
          ${isFiltered ? '<button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="empty-reset-filters-btn">✕ Сбросить фильтры</button>' : ''}
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="empty-retry-btn">🔄 Обновить каталог</button>
        </div>
      </div>
    `;
    const emptyResetBtn = document.getElementById('empty-reset-filters-btn');
    if (emptyResetBtn) {
      emptyResetBtn.onclick = () => resetAllFilters();
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
      const poster = item.poster || 'assets/favicon.svg';
      const formattedTitle = formatMediaTitle(item);
      const isReal4K = item.is4K === true || (item.quality && item.quality.includes('4K'));
      const is1080p = !isReal4K && ((item.quality && (item.quality.includes('1080') || item.quality.includes('FHD'))) || item.source === 'fanfilm4k');
      const hasHdr = item.isHDR || (item.quality && item.quality.toLowerCase().includes('hdr'));
      const hasAtmos = item.isAtmos || (item.audio && item.audio.toLowerCase().includes('atmos'));
      const has60Fps = item.fps === 60 || (item.quality && item.quality.includes('60'));
      const hasDub = Boolean(item.voiceover || (item.translations && item.translations.length > 0) || item.source === 'fanfilm4k');
      const isWatched = item.user_status === 'completed' || (typeof item.progress_percent === 'number' && item.progress_percent >= 90);
      const yr = getMediaYear(item);
      const catLabel = getMediaCategoryLabel(item, currentTab);
      const metaText = yr ? `${yr} • ${catLabel}` : catLabel;

      return `
      <div class="storm-card media-card storm-focusable" data-id="${item.id}" data-source="${item.source}" tabindex="0" role="button" aria-label="${formattedTitle}">
        <div class="media-card-poster">
          <img src="${poster}" alt="${formattedTitle}" loading="lazy" onerror="if(!this.dataset.triedProxy && this.src && !this.src.includes('/api/media/image-proxy')){ this.dataset.triedProxy='1'; this.src='/api/media/image-proxy?url='+encodeURIComponent(this.src)+'&title='+encodeURIComponent('${encodeURIComponent(item.title || '')}'); } else if(!this.dataset.retried){ this.dataset.retried='1'; setTimeout(()=>{ this.src=this.src + (this.src.includes('?') ? '&' : '?') + '_r=' + Date.now(); }, 1200); } else { this.onerror=null; this.src='assets/favicon.svg'; }">
          <div class="media-card-badges">
            ${isReal4K ? '<span class="storm-badge storm-badge-4k">4K UHD</span>' : (is1080p ? '<span class="storm-badge storm-badge-1080p">1080p</span>' : '')}
            ${hasHdr ? '<span class="storm-badge storm-badge-hdr">HDR10</span>' : ''}
            ${hasAtmos ? '<span class="storm-badge storm-badge-atmos">Dolby Atmos</span>' : ''}
            ${has60Fps ? '<span class="storm-badge storm-badge-fps">60 FPS</span>' : ''}
            ${hasDub ? '<span class="storm-badge storm-badge-dub">Дубляж</span>' : ''}
            ${(item.media_type === 'series' || catLabel === 'Сериал') ? '<span class="storm-badge storm-badge-series" style="background:rgba(168,85,247,0.22); border-color:#a855f7; color:#c084fc; font-weight:700;">Сериал</span>' : ''}
            ${item.next_up ? `<span class="storm-badge storm-badge-next-up" style="background:rgba(0, 210, 255, 0.18); border-color:var(--accent); color:var(--accent); font-weight:700;">▶ ${item.next_up}</span>` : ''}
          </div>
          <div class="media-card-top-right">
            ${isWatched ? '<span class="media-card-watched-tag" title="Просмотрено">✓</span>' : ''}
            ${item.rating ? `<span class="storm-badge storm-badge-rating">★ ${item.rating}</span>` : ''}
          </div>
          ${item.user_status ? `<div class="media-card-status-badge">${getStatusBadge(item.user_status)}</div>` : ''}
          <button type="button" class="media-card-menu-btn" title="Опции" data-idx="${idx}">⋮</button>
          <div class="media-card-overlay">
            <div class="media-play-icon">▶</div>
          </div>
          ${item.progress_percent > 0 ? (
            checkIfMediaIsSeries(item) ? renderSegmentedEpisodeBar(item.progress_percent, parseInt(item.total_episodes, 10) || 8) : `
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
    if (!isSearching && !['home', 'continue', 'bookmarks', 'offline'].includes(currentTab) && currentPage < totalCatalogPages) {
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

      // Долгое нажатие на сенсорных экранах (Mobile Radial Action Ring)
      let touchTimer = null;
      card.ontouchstart = (e) => {
        touchTimer = setTimeout(() => {
          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            try { navigator.vibrate(15); } catch (_) {}
          }
          openRadialActionRing(e, items[idx]);
        }, 500);
      };
      card.ontouchend = () => { if (touchTimer) clearTimeout(touchTimer); };
      card.ontouchmove = () => { if (touchTimer) clearTimeout(touchTimer); };

      // Видеопревью при наведении курсора (Video Hover Preview) с задержкой 2 секунды
      card.onmouseenter = () => {
        clearTimeout(hoverCloseTimer);
        clearTimeout(hoverPreviewTimer);
        hoverPreviewTimer = setTimeout(() => {
          if (card.matches(':hover') && card.isConnected) {
            showCardHoverPreview(card, items[idx]);
          }
        }, 2000);
      };

      card.onmouseleave = () => {
        clearTimeout(hoverPreviewTimer);
        hoverCloseTimer = setTimeout(() => {
          hideCardHoverPreview();
        }, 280);
      };
    });
    renderCatalogPagination(items.length);
    return;
  }

  // 3. ДЕТАЛЬНЫЙ СПИСОК
  if (currentViewMode === 'detailed-list') {
    container.innerHTML = items.map((item, idx) => {
      const poster = item.poster || 'assets/favicon.svg';
      const sourceName = getSourceName(item);
      const formattedTitle = formatMediaTitle(item);
      const isReal4K = item.is4K === true || (item.quality && item.quality.includes('4K'));
      const is1080p = !isReal4K && ((item.quality && (item.quality.includes('1080') || item.quality.includes('FHD'))) || item.source === 'fanfilm4k');
      const hasHdr = item.isHDR || (item.quality && item.quality.toLowerCase().includes('hdr'));
      const hasAtmos = item.isAtmos || (item.audio && item.audio.toLowerCase().includes('atmos'));
      const has60Fps = item.fps === 60 || (item.quality && item.quality.includes('60'));
      const hasDub = Boolean(item.voiceover || (item.translations && item.translations.length > 0) || item.source === 'fanfilm4k');
      const isWatched = item.user_status === 'completed' || (typeof item.progress_percent === 'number' && item.progress_percent >= 90);

      return `
      <div class="media-detailed-card storm-focusable" data-idx="${idx}" tabindex="0" role="button">
        <div class="media-detailed-poster">
          <img src="${poster}" alt="${formattedTitle}" loading="lazy" onerror="if(!this.dataset.triedProxy && this.src && !this.src.includes('/api/media/image-proxy')){ this.dataset.triedProxy='1'; this.src='/api/media/image-proxy?url='+encodeURIComponent(this.src)+'&title='+encodeURIComponent('${encodeURIComponent(item.title || '')}'); } else if(!this.dataset.retried){ this.dataset.retried='1'; setTimeout(()=>{ this.src=this.src + (this.src.includes('?') ? '&' : '?') + '_r=' + Date.now(); }, 1200); } else { this.onerror=null; this.src='assets/favicon.svg'; }">
          <div class="media-detailed-badges" style="position: absolute; top: 6px; left: 6px; display: flex; flex-direction: column; gap: 4px; pointer-events: none;">
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
            const poster = item.poster || 'assets/favicon.svg';
            const formattedTitle = formatMediaTitle(item);
            return `
            <tr data-idx="${idx}" class="storm-focusable" tabindex="0" role="button" style="cursor:pointer;">
              <td class="td-center"><img class="media-table-thumb" src="${poster}" onerror="if(!this.dataset.triedProxy && this.src && !this.src.includes('/api/media/image-proxy')){ this.dataset.triedProxy='1'; this.src='/api/media/image-proxy?url='+encodeURIComponent(this.src)+'&title='+encodeURIComponent('${encodeURIComponent(item.title || '')}'); } else if(!this.dataset.retried){ this.dataset.retried='1'; setTimeout(()=>{ this.src=this.src + (this.src.includes('?') ? '&' : '?') + '_r=' + Date.now(); }, 1200); } else { this.onerror=null; this.src='assets/favicon.svg'; }"></td>
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

  const maxButtons = 5;
  let startPage = Math.max(1, currentPage - 2);
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
      <div class="storm-pagination-info">
        <span>Показано: <strong>${shownCount}</strong> из <strong>${totalCount}</strong></span>
      </div>
      <div class="storm-pagination-controls">
        <button type="button" class="storm-page-btn first-page-btn" ${currentPage <= 1 ? 'disabled' : ''} title="Первая страница" data-page="1">« 1</button>
        <button type="button" class="storm-page-btn prev-page-btn" ${currentPage <= 1 ? 'disabled' : ''} title="Предыдущая страница" data-page="${Math.max(1, currentPage - 1)}">‹ Назад</button>
        ${pillsHtml}
        <button type="button" class="storm-page-btn next-page-btn" ${currentPage >= totalPages ? 'disabled' : ''} title="Следующая страница" data-page="${Math.min(totalPages, currentPage + 1)}">Вперёд ›</button>
        <button type="button" class="storm-page-btn last-page-btn" ${currentPage >= totalPages ? 'disabled' : ''} title="Последняя страница" data-page="${totalPages}">» ${totalPages}</button>
      </div>
      <div class="storm-pagination-jump">
        <span>Перейти:</span>
        <input type="number" min="1" max="${totalPages}" value="${currentPage}" class="storm-page-jump-input" id="storm-page-jump-input" />
        <button type="button" class="storm-btn storm-btn-primary storm-btn-sm storm-page-jump-btn" id="storm-page-jump-btn">Перейти</button>
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
      const res = await fetch(`/api/media/search?q=${encodeURIComponent(q)}&source=${currentSource}`);
      const data = await res.json();
      let items = data.items || [];

      // Семантический поиск по смыслу и синопсису если обычный поиск не нашел совпадений
      if (items.length === 0 && q.length >= 3) {
        try {
          const semRes = await fetch(`/api/search/semantic?q=${encodeURIComponent(q)}`);
          if (semRes.ok) {
            const semData = await semRes.json();
            if (semData?.items?.length > 0) {
              items = semData.items;
              showToast('💡 Показаны результаты семантического поиска по смыслу и сюжету', 'info');
            }
          }
        } catch (_) {}
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
    { id: '2015_2019', name: '2015 — 2019', icon: '⏳' },
    { id: '2010_2014', name: '2010 — 2014', icon: '⏳' },
    { id: '2000_2009', name: '2000 — 2009', icon: '⏳' },
    { id: '2000_down', name: 'До 2000 года', icon: '🏛️' }
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
    { id: '8', name: '★ 8.0+ Шедевры', icon: '🏆' },
    { id: '7', name: '★ 7.0+ Отличные', icon: '⭐' },
    { id: '6', name: '★ 6.0+ Хорошие', icon: '👍' },
    { id: '5', name: '★ 5.0+ Средние', icon: '👌' }
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
  currentGenre = 'all';
  currentCountry = 'all';
  currentYear = 'all';
  currentRating = 0;
  currentStatusFilter = 'all';
  currentSort = 'newest';
  currentSource = 'all';
  currentFilterSheetGenre = 'all';
  currentFilterSheetYear = 'all';
  currentFilterSheetRating = 0;
  currentFilterSheetSort = 'newest';
  currentFilterSheetSource = 'all';

  const genreLabel = document.getElementById('filter-genre-label');
  if (genreLabel) genreLabel.textContent = 'Все жанры';

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
  if (prevSource !== 'all') {
    currentPage = 1;
    loadCatalog(currentTab, 1);
  } else {
    renderFilteredCatalog();
  }
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
      const checkCountry = (val) => {
        if (!val) return false;
        if (Array.isArray(val)) {
          return val.some(c => String(c).toLowerCase().includes(targetCountry));
        }
        return String(val).toLowerCase().includes(targetCountry);
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
      if (currentYear === '2000_down') return year < 2000;
      if (currentYear === '2000-2009' || currentYear === '2000_2009') return year >= 2000 && year <= 2009;
      if (currentYear === '2010-2019' || currentYear === '2010_2019') return year >= 2010 && year <= 2019;
      if (currentYear === '2010_2014') return year >= 2010 && year <= 2014;
      if (currentYear === '2015_2019') return year >= 2015 && year <= 2019;
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

  currentItems = items;

  const heroContainer = document.getElementById('hero-showcase-container');

  // Если мы на вкладке Главная и нет фильтрации/поиска - отображаем кинематографичный вид Emby/Plex
  if (currentTab === 'home' && !isFiltered && (!searchQuery || !searchQuery.trim())) {
    renderHomeView(currentItems);
  } else {
    hideHeroShowcase();
    renderMediaItems(currentItems);
  }
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
  // Закрытие всех модалок и выпадающих списков по нажатию клавиши Escape (ESC)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.keyCode === 27) {
      // Закрываем открытые кастомные выпадающие списки
      document.querySelectorAll('.storm-custom-dropdown.is-open').forEach(dd => {
        dd.classList.remove('is-open');
      });
      // Если открыт плеер - закрываем его через специальную функцию с очисткой потока
      const cinemaModal = document.getElementById('cinema-modal');
      if (cinemaModal && cinemaModal.classList.contains('is-open')) {
        closePlayerModal();
      }
      // Закрываем любые другие открытые модальные окна
      document.querySelectorAll('.storm-modal-backdrop.is-open').forEach(backdrop => {
        backdrop.classList.remove('is-open');
      });
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

  // Закрытие при клике по бэкдропу или крестику
  document.querySelectorAll('.storm-modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        backdrop.classList.remove('is-open');
        closePlayerModal();
      }
    });
  });

  document.querySelectorAll('.storm-modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = btn.closest('.storm-modal-backdrop');
      if (modal) modal.classList.remove('is-open');
      closePlayerModal();
    });
  });

  // Закрытие всех модальных окон и поповеров через ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const openModals = document.querySelectorAll('.storm-modal-backdrop.is-open');
      if (openModals.length > 0) {
        openModals.forEach(m => m.classList.remove('is-open'));
        closePlayerModal();
      }
      hideCardHoverPreview();
      const popover = document.getElementById('chat-stickers-popover');
      if (popover) popover.style.display = 'none';
      const wpPopover = document.getElementById('room-wallpapers-popover');
      if (wpPopover) wpPopover.style.display = 'none';
      const ambHost = document.getElementById('ambilight-settings-panel-host');
      if (ambHost) ambHost.innerHTML = '';
    }
  });

  // Открытие модалки логина
  const loginModalBtn = document.getElementById('login-modal-btn');
  const authModal = document.getElementById('auth-modal');
  if (loginModalBtn && authModal) {
    loginModalBtn.onclick = () => authModal.classList.add('is-open');
  }

  // Переключение Вход / Регистрация
  const switchToRegister = document.getElementById('switch-to-register');
  const switchToLogin = document.getElementById('switch-to-login');
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const authModalTitle = document.getElementById('auth-modal-title');

  if (switchToRegister && switchToLogin) {
    switchToRegister.onclick = () => {
      loginForm.style.display = 'none';
      registerForm.style.display = 'block';
      authModalTitle.textContent = t('auth_register');
    };
    switchToLogin.onclick = () => {
      registerForm.style.display = 'none';
      loginForm.style.display = 'block';
      authModalTitle.textContent = t('auth_login');
    };
  }

  // Отправка формы логина
  if (loginForm) {
    loginForm.onsubmit = async (e) => {
      e.preventDefault();
      const loginVal = document.getElementById('login-username').value;
      const passVal = document.getElementById('login-password').value;
      try {
        await login(loginVal, passVal);
        authModal.classList.remove('is-open');
      } catch (err) {
        showToast(err.message, 'error');
      }
    };
  }

  // Отправка формы регистрации
  if (registerForm) {
    registerForm.onsubmit = async (e) => {
      e.preventDefault();
      const userVal = document.getElementById('reg-username').value;
      const emailVal = document.getElementById('reg-email').value;
      const passVal = document.getElementById('reg-password').value;
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
    langSelect.value = localStorage.getItem('storm_lang') || 'ru';
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

  preview.innerHTML = `
    <!-- Верхняя строка плашек -->
    <div class="hover-preview-top-row">
      <div class="hover-preview-badges-left">
        ${item.is4K ? '<span class="storm-badge storm-badge-4k">4K UHD</span>' : ''}
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
    <p class="hover-preview-desc">${item.description || (previewCat.toLowerCase().includes('сериал') ? 'Просмотр сериала онлайн в высоком качестве с профессиональным русским дубляжем.' : 'Просмотр фильма онлайн в высоком качестве с профессиональным русским дубляжем.')}</p>

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
            const badgeHtml = getStatusBadge(finalStatus);
            if (overlay) {
              overlay.insertAdjacentHTML('beforebegin', badgeHtml);
            } else {
              cardPoster.insertAdjacentHTML('beforeend', badgeHtml);
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
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('Регистрация Service Worker не удалась:', err);
    });
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
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
  // 1. Smart TV и геймпад
  initGamepadAndTvMode();
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
    else if (['new', 'movies', 'series', 'cartoons', 'cartoon-series', 'anime-movies', 'anime-series'].includes(currentTab) && bTab === 'catalog') isActive = true;
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
    const tName = card.dataset.themeName;
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

window.stormRefreshCatalog = () => {
  clientTabCache.clear();
  loadCurrentTab();
};

// =============================================================
// БЕЗОПАСНЫЙ СТАРТ ПРИЛОЖЕНИЯ (ПОСЛЕ ПОЛНОЙ ИНИЦИАЛИЗАЦИИ ВСЕХ МОДУЛЕЙ И ПЕРЕМЕННЫХ)
// =============================================================
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      startStormApp();
    });
  } else {
    // В Android WebView при loadDataWithBaseURL DOM уже готов — запускаем через микротаск
    setTimeout(startStormApp, 0);
  }
}
