/* ==========================================================================
   STORM MULTIMEDIA - ГЛАВНЫЙ КОНТРОЛЛЕР ПРИЛОЖЕНИЯ
   ========================================================================== */

import { initTheme, setTheme } from './theme.js';
import { setLanguage, applyTranslations, t } from './i18n.js';
import { checkAuth, login, register, logout, openProfileModal, showToast, getUser, onAuthChanged, initProfileHandlers, openProfileSwitcherModal, getActiveProfile, isKidModeActive } from './auth.js';
import { fetchUserBookmarks, fetchContinueWatching, fetchCustomLists, createCustomCollection, saveBookmarkStatus } from './bookmarks.js';
import { openPlayerModal, closePlayerModal } from './player.js';
import { trackClientAction, renderProfileAchievements } from './achievements.js';
import { initGamepadAndTvMode, toggleTvMode } from './gamepad-tv.js';
import { initVoiceAssistant, toggleVoiceListening } from './voice-assistant.js';
import { renderSyncModalContent } from './sync-service.js';
import { joinWatchRoom, createWatchRoom } from './watch-together.js';
import { openNeuralRecommenderModal } from './neural-recommender.js';
import { openReleaseCalendarModal } from './release-calendar.js';
import { openRemoteQrModal } from './storm-remote.js';
import { renderOfflineLibrary } from './offline-storage.js';

let currentTab = 'home';
let currentViewMode = localStorage.getItem('storm_view_mode') || 'grid';
let currentSource = 'all';
let currentSort = 'popular';
let currentGenre = 'all';
let currentCountry = 'all';
let currentYear = 'all';
let currentRating = 0;
let currentStatusFilter = 'all';
let currentPage = 1;
let currentItems = [];
let rawCatalogItems = [];
let searchQuery = '';
let hoverPreviewTimer = null;
let hoverCloseTimer = null;

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  applyTranslations();

  initPwaServiceWorker();
  initViewModes();
  initTabs();
  initSearch();
  initFilterDropdowns();
  initModals();
  initProfileHandlers();
  initLanguageSwitcher();
  initNewCyberFeatures();
  updateFamilyProfileHeader();

  onAuthChanged(() => {
    updateFamilyProfileHeader();
    if (currentTab === 'bookmarks' || currentTab === 'continue') {
      loadCurrentTab();
    }
  });

  // Динамическое автоматическое обновление закладок и списков без перезагрузки
  window.addEventListener('storm:bookmarks-updated', (e) => {
    if (currentTab === 'bookmarks' || currentTab === 'continue') {
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

  await checkAuth();
  loadCurrentTab();
  initDeepLinking();
});

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

export function switchTab(tab) {
  currentTab = tab;
  currentPage = 1;

  document.querySelectorAll('.storm-tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });

  document.querySelectorAll('.storm-mobile-nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });

  loadCurrentTab();
}

const clientTabCache = new Map();

function renderSkeletonGrid() {
  const container = document.getElementById('media-render-container');
  if (!container) return;
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
  s = s.replace(/\s*постер\s*4[KkКк]/gi, '');
  s = s.replace(/\s*постер/gi, '');
  s = s.replace(/\s*[\(\[]?\s*4[KkКк]\s*(?:Ultra\s*HD|UHD)?\s*[\)\]]?/gi, '');
  s = s.replace(/\s*[\(\[]?\s*(?:Ultra\s*HD|UHD|2160p|1080p|720p|480p|HDR|HDR10\+?|Dolby\s*Vision|DV|Remux|WEB-DL|BDRip|DVDRip)\s*[\)\]]?/gi, '');
  s = s.replace(/\s*[\(\[]?\s*4[KkКк]\s*[\)\]]?/gi, '');
  s = s.replace(/\s*[\(\[]?\s*(?:фильм|сериал)\s*[\)\]]?/gi, '');
  s = s.replace(/[-–—/]\s*$/, '').trim();
  return s.replace(/\s{2,}/g, ' ').trim();
}

export function formatMediaTitle(item) {
  if (!item) return '';
  let rawTitle = cleanVideoTitle(item.title || item.original_title || '');

  const year = item.year ? String(item.year).trim() : '';
  const hasYear = year && rawTitle.includes(year);

  let seasonsText = '';
  if (item.media_type === 'series' || item.media_type === 'anime-series' || item.category === 'Сериал' || item.media_type === 'cartoon-series') {
    const seasons = item.seasons_count || item.total_seasons || item.seasons;
    if (seasons) {
      seasonsText = ` • ${seasons} сез.`;
    }
  }

  if (year && !hasYear) {
    return `${rawTitle} (${year})${seasonsText}`;
  }
  return `${rawTitle}${seasonsText}`;
}

async function loadCurrentTab() {
  const container = document.getElementById('media-render-container');
  if (!container) return;

  if (currentTab === 'offline') {
    renderOfflineLibrary(container);
    return;
  }

  if (currentTab === 'continue') {
    renderSkeletonGrid();
    const history = await fetchContinueWatching();
    const rawItems = history.map(h => ({
      id: h.media_id,
      source: h.source,
      title: h.title,
      poster: h.poster_url,
      media_type: h.media_type,
      progress_percent: h.progress_percent,
      season: h.season,
      episode: h.episode
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
  const cacheKey = `${category}_${currentPage}_${currentSource}`;

  if (clientTabCache.has(cacheKey)) {
    rawCatalogItems = clientTabCache.get(cacheKey);
    renderFilteredCatalog();
  } else {
    renderSkeletonGrid();
  }

  try {
    const headers = {};
    const token = localStorage.getItem('storm_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`/api/media/catalog?category=${category}&page=${currentPage}&source=${currentSource}`, { headers });
    const data = await res.json();
    const fetchedItems = data.items || [];
    rawCatalogItems = deduplicateMediaList(fetchedItems);
    clientTabCache.set(cacheKey, rawCatalogItems);
    renderFilteredCatalog();
  } catch (err) {
    if (!clientTabCache.has(cacheKey)) {
      container.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--color-red);">Ошибка загрузки: ${err.message}</div>`;
    }
  }
}

// Нормализация названий медиа для надежного сопоставления и исключения дублей
function normalizeMediaTitle(title, originalTitle = '') {
  if (!title && !originalTitle) return '';
  const raw = `${title || ''} ${originalTitle || ''}`.toLowerCase();
  return raw
    .replace(/\s*[\(\[]?\s*(19\d\d|20\d\d)\s*[\)\]]?/g, ' ')
    .replace(/\s*[\(\[]?\s*(постер|постер\s*4[kк]|4[kк]\s*uhd|4[kк]|uhd|fhd|1080p|720p|сериал|фильм|мультфильм|сезон\s*\d+|\d+\s*сезон)\s*[\)\]]?/gi, ' ')
    .replace(/[^a-zа-я0-9]/gi, '')
    .trim();
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
      // Предпочитаем источник TMDB, либо наличие постера/статуса, либо максимальный прогресс
      const isNewBetter =
        (item.source === 'tmdb' && existing.source !== 'tmdb') ||
        (!existing.poster && (item.poster || item.poster_url)) ||
        (!existing.user_status && item.user_status) ||
        ((item.progress_percent || 0) > (existing.progress_percent || 0));

      if (isNewBetter) {
        itemMap.set(key, {
          ...existing,
          ...item,
          poster: item.poster || item.poster_url || existing.poster || existing.poster_url,
          user_status: item.user_status || existing.user_status,
          progress_percent: Math.max(item.progress_percent || 0, existing.progress_percent || 0)
        });
      }
    }
  }

  return Array.from(itemMap.values());
}

// -------------------------------------------------------------
// РЕНДЕРИНГ ЭЛЕМЕНТОВ В 4 РЕЖИМАХ ОТОБРАЖЕНИЯ
// -------------------------------------------------------------
function renderMediaItems(items) {
  const container = document.getElementById('media-render-container');
  if (!container) return;

  hideCardHoverPreview();
  clearTimeout(hoverPreviewTimer);
  clearTimeout(hoverCloseTimer);

  items = deduplicateMediaList(items);

  if (!items || items.length === 0) {
    const isFiltered = currentGenre !== 'all' || currentCountry !== 'all' || currentYear !== 'all' || currentRating > 0 || currentSort !== 'popular';
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-muted);">
        <div style="font-size: 42px; margin-bottom: 12px;">📂</div>
        <h3>Ничего не найдено</h3>
        <p>${isFiltered ? 'Попробуйте изменить параметры фильтрации или сбросить активные фильтры' : 'Попробуйте изменить категорию или поисковый запрос'}</p>
        ${isFiltered ? '<button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="empty-reset-filters-btn" style="margin-top: 14px;">✕ Сбросить фильтры</button>' : ''}
      </div>
    `;
    const emptyResetBtn = document.getElementById('empty-reset-filters-btn');
    if (emptyResetBtn) {
      emptyResetBtn.onclick = () => resetAllFilters();
    }
    return;
  }

  // 1 и 2. Сетка и компактная сетка
  if (currentViewMode === 'grid' || currentViewMode === 'compact-grid') {
    container.innerHTML = items.map(item => {
      const poster = item.poster || 'assets/favicon.svg';
      const formattedTitle = formatMediaTitle(item);
      const isReal4K = item.is4K === true || (item.quality && item.quality.includes('4K'));

      return `
      <div class="storm-card media-card" data-id="${item.id}" data-source="${item.source}">
        <div class="media-card-poster">
          <img src="${poster}" alt="${formattedTitle}" loading="lazy" onerror="if(!this.dataset.triedProxy && this.src && !this.src.includes('/api/media/image-proxy')){ this.dataset.triedProxy='1'; this.src='/api/media/image-proxy?url='+encodeURIComponent(this.src)+'&title='+encodeURIComponent('${encodeURIComponent(item.title || '')}'); } else if(!this.dataset.retried){ this.dataset.retried='1'; setTimeout(()=>{ this.src=this.src + (this.src.includes('?') ? '&' : '?') + '_r=' + Date.now(); }, 1200); } else { this.onerror=null; this.src='assets/favicon.svg'; }">
          <div class="media-card-badges">
            ${isReal4K ? '<span class="storm-badge storm-badge-4k">4K UHD</span>' : ''}
            ${getSourceBadge(item)}
          </div>
          ${item.rating ? `<div class="media-card-rating"><span class="storm-badge storm-badge-rating">★ ${item.rating}</span></div>` : ''}
          ${item.user_status ? getStatusBadge(item.user_status) : ''}
          <div class="media-card-overlay">
            <div class="media-play-icon">▶</div>
          </div>
          ${item.progress_percent > 0 ? `
            <div class="media-card-progress storm-progress-container">
              <div class="storm-progress-bar" style="width: ${item.progress_percent}%"></div>
            </div>
          ` : ''}
        </div>
        <div class="media-card-content">
          <div class="media-card-title" title="${formattedTitle}">${formattedTitle}</div>
          <div class="media-card-meta">
            <span>${item.year || (item.source === 'anixart' || item.source === 'shikimori' || item.source === 'anilibria' ? 'Аниме' : 'Фильм')}</span>
            ${item.progress_percent > 0 ? `<span style="color:var(--accent);font-weight:700;">${item.progress_percent}%</span>` : ''}
          </div>
        </div>
      </div>
    `;
    }).join('');

    container.querySelectorAll('.media-card').forEach((card, idx) => {
      card.onclick = () => openPlayerModal(items[idx]);

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
    return;
  }

  // 3. ДЕТАЛЬНЫЙ СПИСОК
  if (currentViewMode === 'detailed-list') {
    container.innerHTML = items.map((item, idx) => {
      const poster = item.poster || 'assets/favicon.svg';
      const sourceName = getSourceName(item);
      const formattedTitle = formatMediaTitle(item);
      const isReal4K = item.is4K === true || (item.quality && item.quality.includes('4K'));
      return `
      <div class="media-detailed-card" data-idx="${idx}">
        <div class="media-detailed-poster">
          <img src="${poster}" alt="${formattedTitle}" loading="lazy" onerror="if(!this.dataset.triedProxy && this.src && !this.src.includes('/api/media/image-proxy')){ this.dataset.triedProxy='1'; this.src='/api/media/image-proxy?url='+encodeURIComponent(this.src)+'&title='+encodeURIComponent('${encodeURIComponent(item.title || '')}'); } else if(!this.dataset.retried){ this.dataset.retried='1'; setTimeout(()=>{ this.src=this.src + (this.src.includes('?') ? '&' : '?') + '_r=' + Date.now(); }, 1200); } else { this.onerror=null; this.src='assets/favicon.svg'; }">
          <div class="media-detailed-badges" style="position: absolute; top: 6px; left: 6px; display: flex; flex-direction: column; gap: 4px; pointer-events: none;">
            ${isReal4K ? '<span class="storm-badge storm-badge-4k">4K UHD</span>' : ''}
            ${getSourceBadge(item)}
          </div>
        </div>
        <div class="media-detailed-info">
          <div class="media-detailed-header">
            <div>
              <div class="media-detailed-title">${formattedTitle}</div>
              ${item.original_title ? `<div class="media-detailed-orig-title">${item.original_title}</div>` : ''}
            </div>
            <div style="display:flex;gap:6px;align-items:center;">
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
            <span style="font-size:12px;color:var(--text-muted);">${item.year || ''} • ${sourceName}</span>
            <button class="storm-btn storm-btn-primary storm-btn-sm play-btn">▶ Смотреть</button>
          </div>
        </div>
      </div>
    `;
    }).join('');

    container.querySelectorAll('.media-detailed-card').forEach((card, idx) => {
      card.onclick = () => openPlayerModal(items[idx]);
    });
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
            <tr data-idx="${idx}" style="cursor:pointer;">
              <td class="td-center"><img class="media-table-thumb" src="${poster}" onerror="if(!this.dataset.triedProxy && this.src && !this.src.includes('/api/media/image-proxy')){ this.dataset.triedProxy='1'; this.src='/api/media/image-proxy?url='+encodeURIComponent(this.src)+'&title='+encodeURIComponent('${encodeURIComponent(item.title || '')}'); } else if(!this.dataset.retried){ this.dataset.retried='1'; setTimeout(()=>{ this.src=this.src + (this.src.includes('?') ? '&' : '?') + '_r=' + Date.now(); }, 1200); } else { this.onerror=null; this.src='assets/favicon.svg'; }"></td>
              <td><strong>${formattedTitle}</strong></td>
              <td class="td-center">${getSourceBadge(item) || `<span class="storm-badge storm-badge-quality">${item.media_type || 'movie'}</span>`}</td>
              <td class="td-center">${item.year || '—'}</td>
              <td class="td-center" style="font-weight: 700; color: var(--color-amber);">${item.rating ? `★ ${item.rating}` : '—'}</td>
              <td class="td-center">${item.user_status ? `<span class="storm-badge storm-badge-${item.user_status}">${getStatusLabel(item.user_status)}</span>` : '—'}</td>
              <td class="td-center" style="min-width:110px;">
                ${item.progress_percent > 0 ? `
                  <div style="font-size:11px;font-weight:700;color:var(--accent);margin-bottom:2px;">${item.progress_percent}%</div>
                  <div class="storm-progress-container">
                    <div class="storm-progress-bar" style="width: ${item.progress_percent}%"></div>
                  </div>
                ` : '<span style="color:var(--text-muted);font-size:11px;">0%</span>'}
              </td>
              <td class="td-center"><button class="storm-btn storm-btn-primary storm-btn-sm">▶ Плеер</button></td>
            </tr>
          `;
          }).join('')}
        </tbody>
      </table>
    `;

    container.querySelectorAll('tbody tr').forEach((row, idx) => {
      row.onclick = () => openPlayerModal(items[idx]);
    });
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
  const icons = {
    watching: '👁️',
    planned: '📋',
    completed: '✅',
    favorite: '❤️',
    on_hold: '⏸️',
    dropped: '🛑',
    wont_watch: '🚫'
  };
  const icon = icons[norm] || '📌';
  const label = getStatusLabel(norm);
  return `<div class="media-card-status-badge"><span class="storm-badge storm-badge-status storm-badge-${norm}"><span>${icon}</span> <span>${label}</span></span></div>`;
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
      rawCatalogItems = deduplicateMediaList(data.items || []);
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

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(debounceTimer);
      executeSearch();
    }
  });

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
  const genres = [
    { id: 'all', name: 'Все жанры', icon: '🎭' },
    { id: 'боевик', name: 'Боевик', icon: '💥' },
    { id: 'комедия', name: 'Комедия', icon: '😄' },
    { id: 'драма', name: 'Драма', icon: '🎭' },
    { id: 'фантастика', name: 'Фантастика', icon: '🚀' },
    { id: 'триллер', name: 'Триллер', icon: '🔪' },
    { id: 'ужасы', name: 'Ужасы', icon: '👻' },
    { id: 'приключения', name: 'Приключения', icon: '🧭' },
    { id: 'фэнтези', name: 'Фэнтези', icon: '🧙' },
    { id: 'аниме', name: 'Аниме', icon: '🌸' },
    { id: 'детектив', name: 'Детектив', icon: '🕵️' },
    { id: 'мультфильм', name: 'Мультфильм', icon: '🎨' },
    { id: 'семейный', name: 'Семейный', icon: '👨‍👩‍👧' },
    { id: 'криминал', name: 'Криминал', icon: '🔫' },
    { id: 'мелодрама', name: 'Мелодрама', icon: '❤️' },
    { id: 'военный', name: 'Военный', icon: '🎖️' },
    { id: 'документальный', name: 'Документальный', icon: '📽️' },
    { id: 'мистика', name: 'Мистика', icon: '🔮' },
    { id: 'биография', name: 'Биография', icon: '📜' },
    { id: 'история', name: 'История', icon: '🏛️' },
    { id: 'спорт', name: 'Спорт', icon: '🏆' },
    { id: 'мюзикл', name: 'Мюзикл', icon: '🎵' }
  ];

  setupFilterDropdown({
    dropdownId: 'filter-genre-dropdown',
    triggerId: 'filter-genre-trigger',
    labelId: 'filter-genre-label',
    menuId: 'filter-genre-menu',
    searchId: 'filter-genre-search',
    listId: 'filter-genre-list',
    items: genres,
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
    { id: 'watching', name: 'Смотрю', icon: '👁️' },
    { id: 'favorite', name: 'Любимое', icon: '❤️' },
    { id: 'planned', name: 'В планах', icon: '📋' },
    { id: 'completed', name: 'Просмотрено', icon: '✅' },
    { id: 'on_hold', name: 'Отложено', icon: '⏸️' },
    { id: 'dropped', name: 'Заброшено', icon: '🛑' },
    { id: 'wont_watch', name: 'Не буду смотреть', icon: '🚫' }
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
    { id: 'popular', name: 'По популярности', icon: '⚡' },
    { id: 'newest', name: 'Сначала новинки', icon: '🆕' },
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
  currentGenre = 'all';
  currentCountry = 'all';
  currentYear = 'all';
  currentRating = 0;
  currentStatusFilter = 'all';
  currentSort = 'popular';

  const genreLabel = document.getElementById('filter-genre-label');
  if (genreLabel) genreLabel.textContent = 'Все жанры';

  const yearLabel = document.getElementById('filter-year-label');
  if (yearLabel) yearLabel.textContent = 'Все года';

  const ratingLabel = document.getElementById('filter-rating-label');
  if (ratingLabel) ratingLabel.textContent = 'Любой рейтинг';

  const statusLabel = document.getElementById('filter-status-label');
  if (statusLabel) statusLabel.textContent = 'Все статусы';

  const sortLabel = document.getElementById('filter-sort-label');
  if (sortLabel) sortLabel.textContent = 'По популярности';

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
    el.classList.toggle('is-active', el.dataset.value === 'popular');
  });

  renderFilteredCatalog();
}

export function renderFilteredCatalog() {
  const isFiltered = currentGenre !== 'all' || currentCountry !== 'all' || currentYear !== 'all' || currentRating > 0 || currentStatusFilter !== 'all' || currentSort !== 'popular';
  const resetBtn = document.getElementById('reset-filters-btn');
  if (resetBtn) {
    resetBtn.style.display = isFiltered ? 'inline-flex' : 'none';
  }

  let items = [...rawCatalogItems];

  // 0. Детский режим (семейный контроль и фильтрация 18+)
  if (isKidModeActive()) {
    const blockedTerms = ['18+', 'эротика', 'ужасы', 'хоррор', 'порно', 'триллер', 'криминал'];
    items = items.filter(item => {
      const text = `${item.title || ''} ${item.description || ''} ${Array.isArray(item.genres) ? item.genres.join(' ') : (item.genres || '')} ${item.age_rating || ''}`.toLowerCase();
      return !blockedTerms.some(term => text.includes(term));
    });
  }

  // 1. Фильтр по жанру
  if (currentGenre !== 'all') {
    const targetGenre = currentGenre.toLowerCase();
    items = items.filter(item => {
      if (Array.isArray(item.genres)) {
        return item.genres.some(g => String(g).toLowerCase().includes(targetGenre));
      }
      if (typeof item.genres === 'string') {
        return item.genres.toLowerCase().includes(targetGenre);
      }
      if (typeof item.category === 'string') {
        return item.category.toLowerCase().includes(targetGenre);
      }
      if (typeof item.description === 'string') {
        return item.description.toLowerCase().includes(targetGenre);
      }
      return false;
    });
  }

  // 1.5 Фильтр по стране
  if (currentCountry !== 'all') {
    const targetCountry = currentCountry.toLowerCase();
    items = items.filter(item => {
      if (Array.isArray(item.countries)) {
        return item.countries.some(c => String(c).toLowerCase().includes(targetCountry));
      }
      if (typeof item.countries === 'string') {
        return item.countries.toLowerCase().includes(targetCountry);
      }
      if (typeof item.country === 'string') {
        return item.country.toLowerCase().includes(targetCountry);
      }
      if (typeof item.description === 'string') {
        return item.description.toLowerCase().includes(targetCountry);
      }
      return false;
    });
  }

  // 2. Фильтр по году
  if (currentYear !== 'all') {
    items = items.filter(item => {
      const year = parseInt(item.year, 10);
      if (isNaN(year)) return false;
      if (currentYear === '2000_down') return year < 2000;
      if (currentYear === '2000_2009') return year >= 2000 && year <= 2009;
      if (currentYear === '2010_2014') return year >= 2010 && year <= 2014;
      if (currentYear === '2015_2019') return year >= 2015 && year <= 2019;
      return String(year) === currentYear;
    });
  }

  // 3. Фильтр по рейтингу
  if (currentRating > 0) {
    items = items.filter(item => {
      const rating = parseFloat(item.rating);
      if (isNaN(rating)) return false;
      return rating >= currentRating;
    });
  }

  // 3.5. Фильтр по статусу просмотра
  if (currentStatusFilter !== 'all') {
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

  // 4. Сортировка
  if (currentSort === 'newest') {
    items.sort((a, b) => (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0));
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
  }

  currentItems = items;
  renderMediaItems(currentItems);
}

export async function applyGenreFilter(genre) {
  if (!genre) return;
  const cleanGenre = genre.trim();
  currentGenre = cleanGenre.toLowerCase();
  currentCountry = 'all';

  const homeBtn = document.querySelector('.storm-tab-btn[data-tab="home"]');
  if (homeBtn && currentTab !== 'home') {
    currentTab = 'home';
    document.querySelectorAll('.storm-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'home'));
  }

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

  preview.innerHTML = `
    <!-- Верхняя строка плашек -->
    <div class="hover-preview-top-row">
      <div class="hover-preview-badges-left">
        ${item.is4K ? '<span class="storm-badge storm-badge-4k">4K UHD</span>' : ''}
        ${getSourceBadge(item)}
        ${item.user_status ? getStatusBadge(item.user_status) : ''}
      </div>
      <div class="hover-preview-badges-right">
        ${item.year ? `<span class="storm-badge" style="background:var(--bg-tertiary);border-color:var(--border-subtle);color:var(--text-secondary);">${item.year}</span>` : ''}
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
      ${item.media_type ? `<span>• ${item.media_type === 'series' || item.category === 'Сериал' ? 'Сериал' : 'Фильм'}</span>` : ''}
      ${genres.length > 0 ? `
        <div class="hover-preview-tags">
          ${genres.map(g => `<span class="hover-preview-tag">${g}</span>`).join('')}
        </div>
      ` : ''}
    </div>

    <!-- Синопсис / описание -->
    <p class="hover-preview-desc">${item.description || 'Просмотр фильма онлайн в высоком качестве с профессиональным русским дубляжем.'}</p>

    <!-- Кнопки действий -->
    <div class="hover-preview-actions">
      <button type="button" class="storm-btn storm-btn-primary storm-btn-sm hover-watch-btn">▶ Смотреть</button>
      <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm hover-room-btn" title="Совместный просмотр в кинозале">👥 Кинозал</button>
    </div>

    <!-- Быстрый выбор статуса просмотра -->
    <div class="hover-preview-status-row">
      <span class="hover-preview-status-label">Статус:</span>
      <div class="hover-preview-status-btns">
        <button type="button" class="hover-status-btn ${item.user_status === 'watching' ? 'active' : ''}" data-status="watching" title="Смотрю">👁️</button>
        <button type="button" class="hover-status-btn ${item.user_status === 'planned' ? 'active' : ''}" data-status="planned" title="В планах">📋</button>
        <button type="button" class="hover-status-btn ${item.user_status === 'completed' ? 'active' : ''}" data-status="completed" title="Просмотрено">✅</button>
        <button type="button" class="hover-status-btn ${item.user_status === 'favorite' ? 'active' : ''}" data-status="favorite" title="Любимое">❤️</button>
        <button type="button" class="hover-status-btn ${item.user_status === 'on_hold' ? 'active' : ''}" data-status="on_hold" title="Отложено">⏸️</button>
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

          // Мгновенное динамическое удаление карточки из DOM во вкладке закладок
          if (currentTab === 'bookmarks') {
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
}

export function updateFamilyProfileHeader() {
  const profile = getActiveProfile();
  const iconEl = document.getElementById('active-profile-avatar-icon');
  const labelEl = document.getElementById('active-profile-name-label');
  if (iconEl && profile) {
    if (profile.avatar && (profile.avatar.startsWith('http') || profile.avatar.startsWith('/') || profile.avatar.startsWith('data:'))) {
      iconEl.innerHTML = `<img src="${profile.avatar}" alt="" style="width: 16px; height: 16px; border-radius: 50%; object-fit: cover; vertical-align: middle;">`;
    } else {
      iconEl.textContent = profile.avatar || (profile.isKid ? '🦄' : '👑');
    }
  }
  if (labelEl && profile) {
    labelEl.textContent = profile.name ? profile.name.split(' ')[0] : 'Семья';
  }
}
