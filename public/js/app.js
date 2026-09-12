/* ==========================================================================
   STORM MULTIMEDIA - ГЛАВНЫЙ КОНТРОЛЛЕР ПРИЛОЖЕНИЯ
   ========================================================================== */

import { initTheme, setTheme } from './theme.js';
import { setLanguage, applyTranslations, t } from './i18n.js';
import { checkAuth, login, register, logout, openProfileModal, showToast, getUser, onAuthChanged, initProfileHandlers } from './auth.js';
import { fetchUserBookmarks, fetchContinueWatching, fetchCustomLists, createCustomCollection } from './bookmarks.js';
import { openPlayerModal, closePlayerModal } from './player.js';
import { trackClientAction, renderProfileAchievements } from './achievements.js';
import { initGamepadAndTvMode, toggleTvMode } from './gamepad-tv.js';
import { initVoiceAssistant, toggleVoiceListening } from './voice-assistant.js';
import { renderSyncModalContent } from './sync-service.js';
import { joinWatchRoom, createWatchRoom } from './watch-together.js';

let currentTab = 'home';
let currentViewMode = localStorage.getItem('storm_view_mode') || 'grid';
let currentSource = 'all';
let currentSort = 'popular';
let currentPage = 1;
let currentItems = [];
let searchQuery = '';
let hoverPreviewTimer = null;

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  applyTranslations();

  initPwaServiceWorker();
  initViewModes();
  initTabs();
  initSearch();
  initModals();
  initProfileHandlers();
  initLanguageSwitcher();
  initNewCyberFeatures();

  onAuthChanged(() => {
    if (currentTab === 'bookmarks' || currentTab === 'continue') {
      loadCurrentTab();
    }
  });

  await checkAuth();
  loadCurrentTab();
});

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

async function loadCurrentTab() {
  const container = document.getElementById('media-render-container');
  if (!container) return;

  container.innerHTML = `
    <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-muted);">
      <div style="font-size: 32px; margin-bottom: 12px; animation: spin 1s linear infinite;">⏳</div>
      <p>Загрузка каталога...</p>
    </div>
  `;

  if (currentTab === 'continue') {
    const history = await fetchContinueWatching();
    currentItems = history.map(h => ({
      id: h.media_id,
      source: h.source,
      title: h.title,
      poster: h.poster_url,
      media_type: h.media_type,
      progress_percent: h.progress_percent,
      season: h.season,
      episode: h.episode
    }));
    renderMediaItems(currentItems);
    return;
  }

  if (currentTab === 'bookmarks') {
    const bookmarks = await fetchUserBookmarks();
    currentItems = bookmarks.map(b => ({
      id: b.media_id,
      source: b.source,
      title: b.title,
      original_title: b.original_title,
      poster: b.poster_url,
      media_type: b.media_type,
      user_status: b.status,
      progress_percent: b.progress_percent,
      episodes_watched: b.episodes_watched,
      total_episodes: b.total_episodes
    }));
    renderMediaItems(currentItems);
    return;
  }

  // Каталог медиа - полная поддержка всех 10 вкладок портала
  let category = currentTab;
  if (currentTab === 'home') category = 'popular';

  try {
    const res = await fetch(`/api/media/catalog?category=${category}&page=${currentPage}&source=${currentSource}`);
    const data = await res.json();
    currentItems = data.items || [];
    renderMediaItems(currentItems);
  } catch (err) {
    container.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--color-red);">Ошибка загрузки: ${err.message}</div>`;
  }
}

// -------------------------------------------------------------
// РЕНДЕРИНГ ЭЛЕМЕНТОВ В 4 РЕЖИМАХ ОТОБРАЖЕНИЯ
// -------------------------------------------------------------
function renderMediaItems(items) {
  const container = document.getElementById('media-render-container');
  if (!container) return;

  if (!items || items.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-muted);">
        <div style="font-size: 42px; margin-bottom: 12px;">📂</div>
        <h3>Ничего не найдено</h3>
        <p>Попробуйте изменить категорию или поисковый запрос</p>
      </div>
    `;
    return;
  }

  // 1 и 2. Сетка и компактная сетка
  if (currentViewMode === 'grid' || currentViewMode === 'compact-grid') {
    container.innerHTML = items.map(item => {
      const poster = item.poster || 'assets/favicon.svg';
      return `
      <div class="storm-card media-card" data-id="${item.id}" data-source="${item.source}">
        <div class="media-card-poster">
          <img src="${poster}" alt="${item.title}" loading="lazy" onerror="if(!this.dataset.triedProxy && this.src && !this.src.includes('/api/media/image-proxy')){ this.dataset.triedProxy='1'; this.src='/api/media/image-proxy?url='+encodeURIComponent(this.src); } else { this.onerror=null; this.src='assets/favicon.svg'; }">
          <div class="media-card-badges">
            ${item.is4K ? '<span class="storm-badge storm-badge-4k">4K UHD</span>' : ''}
            ${getSourceBadge(item)}
            ${item.user_status ? `<span class="storm-badge storm-badge-${item.user_status}">${getStatusLabel(item.user_status)}</span>` : ''}
          </div>
          ${item.rating ? `<div class="media-card-rating"><span class="storm-badge storm-badge-rating">★ ${item.rating}</span></div>` : ''}
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
          <div class="media-card-title" title="${item.title}">${item.title}</div>
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

      // Видеопревью при наведении курсора (Video Hover Preview)
      card.onmouseenter = () => {
        clearTimeout(hoverPreviewTimer);
        hoverPreviewTimer = setTimeout(() => {
          showCardHoverPreview(card, items[idx]);
        }, 350);
      };

      card.onmouseleave = () => {
        clearTimeout(hoverPreviewTimer);
        hideCardHoverPreview();
      };
    });
    return;
  }

  // 3. ДЕТАЛЬНЫЙ СПИСОК
  if (currentViewMode === 'detailed-list') {
    container.innerHTML = items.map((item, idx) => {
      const poster = item.poster || 'assets/favicon.svg';
      const sourceName = getSourceName(item);
      return `
      <div class="media-detailed-card" data-idx="${idx}">
        <div class="media-detailed-poster">
          <img src="${poster}" alt="${item.title}" loading="lazy" onerror="if(!this.dataset.triedProxy && this.src && !this.src.includes('/api/media/image-proxy')){ this.dataset.triedProxy='1'; this.src='/api/media/image-proxy?url='+encodeURIComponent(this.src); } else { this.onerror=null; this.src='assets/favicon.svg'; }">
          ${item.is4K ? '<span class="storm-badge storm-badge-4k" style="position:absolute;top:6px;left:6px;">4K UHD</span>' : ''}
          <div style="position:absolute;top:6px;right:6px;">
            ${getSourceBadge(item)}
          </div>
        </div>
        <div class="media-detailed-info">
          <div class="media-detailed-header">
            <div>
              <div class="media-detailed-title">${item.title}</div>
              ${item.original_title ? `<div class="media-detailed-orig-title">${item.original_title}</div>` : ''}
            </div>
            <div style="display:flex;gap:6px;align-items:center;">
              ${item.rating ? `<span class="storm-badge storm-badge-rating">★ ${item.rating}</span>` : ''}
              ${item.user_status ? `<span class="storm-badge storm-badge-${item.user_status}">${getStatusLabel(item.user_status)}</span>` : ''}
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
            <th>Постер</th>
            <th>Название</th>
            <th>Источник</th>
            <th>Год</th>
            <th>Рейтинг</th>
            <th>Статус</th>
            <th>Прогресс</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item, idx) => {
            const poster = item.poster || 'assets/favicon.svg';
            return `
            <tr data-idx="${idx}" style="cursor:pointer;">
              <td><img class="media-table-thumb" src="${poster}" onerror="if(!this.dataset.triedProxy && this.src && !this.src.includes('/api/media/image-proxy')){ this.dataset.triedProxy='1'; this.src='/api/media/image-proxy?url='+encodeURIComponent(this.src); } else { this.onerror=null; this.src='assets/favicon.svg'; }"></td>
              <td><strong>${item.title}</strong></td>
              <td>${getSourceBadge(item) || `<span class="storm-badge storm-badge-quality">${item.media_type || 'movie'}</span>`}</td>
              <td>${item.year || '—'}</td>
              <td>${item.rating ? `★ ${item.rating}` : '—'}</td>
              <td>${item.user_status ? `<span class="storm-badge storm-badge-${item.user_status}">${getStatusLabel(item.user_status)}</span>` : '—'}</td>
              <td style="min-width:100px;">
                ${item.progress_percent > 0 ? `
                  <div style="font-size:11px;margin-bottom:2px;">${item.progress_percent}%</div>
                  <div class="storm-progress-container">
                    <div class="storm-progress-bar" style="width: ${item.progress_percent}%"></div>
                  </div>
                ` : '0%'}
              </td>
              <td><button class="storm-btn storm-btn-primary storm-btn-sm">▶ Плеер</button></td>
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
    completed: t('status_completed'),
    hold: t('status_hold'),
    dropped: t('status_dropped'),
    favorite: t('status_favorite')
  };
  return map[status] || status;
}

function getSourceBadge(item) {
  const s = (item.source || '').toLowerCase();
  if (s === 'fanfilm4k') return '<span class="storm-badge storm-badge-4k">4K UHD</span>';
  if (s === 'anilibria') return '<span class="storm-badge storm-badge-quality" style="background:linear-gradient(135deg,#e11d48,#9f1239);">ANILIBRIA</span>';
  if (s === 'anixart') return '<span class="storm-badge storm-badge-quality" style="background:linear-gradient(135deg,#8b5cf6,#6d28d9);">ANIXART</span>';
  if (s === 'shikimori') return '<span class="storm-badge storm-badge-quality" style="background:linear-gradient(135deg,#3b82f6,#1d4ed8);">SHIKIMORI</span>';
  if (s === 'tmdb') return '<span class="storm-badge storm-badge-quality" style="background:linear-gradient(135deg,#10b981,#047857);">TMDB</span>';
  if (s === 'kodik') return '<span class="storm-badge storm-badge-quality" style="background:linear-gradient(135deg,#f59e0b,#b45309);">KODIK</span>';
  if (s === 'hdrezka') return '<span class="storm-badge storm-badge-quality" style="background:linear-gradient(135deg,#ef4444,#b91c1c);">HDREZKA</span>';
  if (s === 'collaps') return '<span class="storm-badge storm-badge-quality" style="background:linear-gradient(135deg,#06b6d4,#0e7490);">COLLAPS</span>';
  if (s === 'alloha') return '<span class="storm-badge storm-badge-quality" style="background:linear-gradient(135deg,#ec4899,#be185d);">ALLOHA</span>';
  if (s === 'videocdn') return '<span class="storm-badge storm-badge-quality" style="background:linear-gradient(135deg,#6366f1,#4338ca);">VIDEOCDN</span>';
  if (s === 'ashdi') return '<span class="storm-badge storm-badge-quality" style="background:linear-gradient(135deg,#14b8a6,#0f766e);">ASHDI</span>';
  if (s === 'kinobox') return '<span class="storm-badge storm-badge-quality" style="background:linear-gradient(135deg,#f97316,#c2410c);">KINOBOX</span>';
  return '';
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
    kinobox: 'Kinobox'
  };
  return map[item.source] || item.source?.toUpperCase() || 'STORM';
}

// -------------------------------------------------------------
// ПОИСК (SEARCH)
// -------------------------------------------------------------
function initSearch() {
  const input = document.getElementById('global-search-input');
  const clearBtn = document.getElementById('search-clear-btn');
  let debounceTimer;

  if (!input) return;

  input.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    searchQuery = e.target.value.trim();

    if (clearBtn) {
      clearBtn.classList.toggle('is-visible', searchQuery.length > 0);
    }

    debounceTimer = setTimeout(async () => {
      if (searchQuery.length >= 2) {
        const res = await fetch(`/api/media/search?q=${encodeURIComponent(searchQuery)}&source=${currentSource}`);
        const data = await res.json();
        currentItems = data.items || [];
        renderMediaItems(currentItems);
      } else if (searchQuery.length === 0) {
        loadCurrentTab();
      }
    }, 350);
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      input.value = '';
      clearBtn.classList.remove('is-visible');
      searchQuery = '';
      loadCurrentTab();
    });
  }

  // Фильтр источников
  const sourceSelect = document.getElementById('source-filter-select');
  if (sourceSelect) {
    sourceSelect.addEventListener('change', (e) => {
      currentSource = e.target.value;
      loadCurrentTab();
    });
  }
}

// -------------------------------------------------------------
// МОДАЛЬНЫЕ ОКНА И ДИАЛОГИ (MODALS)
// -------------------------------------------------------------
function initModals() {
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

  // Кнопка профиля
  const profileBtn = document.getElementById('user-profile-btn');
  if (profileBtn) {
    profileBtn.onclick = () => openProfileModal();
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
  hideCardHoverPreview();

  const rect = card.getBoundingClientRect();
  const preview = document.createElement('div');
  preview.className = 'media-hover-preview-popup';
  preview.style.top = `${rect.top + window.scrollY - 10}px`;
  preview.style.left = `${rect.left + window.scrollX - 10}px`;
  preview.style.width = `${rect.width + 20}px`;

  const poster = item.poster || 'assets/favicon.svg';

  preview.innerHTML = `
    <div class="hover-preview-media">
      <img src="${poster}" alt="${item.title}">
      <div class="hover-preview-overlay">
        <span class="hover-play-icon">▶</span>
      </div>
    </div>
    <div class="hover-preview-body">
      <h4 class="hover-preview-title">${item.title}</h4>
      <div class="hover-preview-meta">
        <span>${item.year || ''}</span>
        ${item.rating ? `<span style="color:var(--color-amber);">★ ${item.rating}</span>` : ''}
        ${item.is4K ? '<span class="storm-badge storm-badge-4k">4K</span>' : ''}
      </div>
      <p class="hover-preview-desc">${item.description || item.genres || 'Превосходное качество видео и профессиональный перевод.'}</p>
      <div class="hover-preview-actions">
        <button class="storm-btn storm-btn-primary storm-btn-sm hover-watch-btn">▶ Смотреть</button>
        <button class="storm-btn storm-btn-secondary storm-btn-sm hover-room-btn" title="Совместный просмотр">👥</button>
      </div>
    </div>
  `;

  document.body.appendChild(preview);
  activeHoverPreviewEl = preview;

  preview.onmouseleave = hideCardHoverPreview;

  const watchBtn = preview.querySelector('.hover-watch-btn');
  if (watchBtn) {
    watchBtn.onclick = (e) => {
      e.stopPropagation();
      hideCardHoverPreview();
      openPlayerModal(item);
    };
  }

  const roomBtn = preview.querySelector('.hover-room-btn');
  if (roomBtn) {
    roomBtn.onclick = async (e) => {
      e.stopPropagation();
      hideCardHoverPreview();
      const code = await createWatchRoom(item);
      if (code) {
        showToast(`Комната создана! Код: ${code}`, 'success');
      }
    };
  }
}

function hideCardHoverPreview() {
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
}
