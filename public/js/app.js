/* ==========================================================================
   STORM MULTIMEDIA - ГЛАВНЫЙ КОНТРОЛЛЕР ПРИЛОЖЕНИЯ
   ========================================================================== */

import { initTheme, setTheme } from './theme.js';
import { setLanguage, applyTranslations, t } from './i18n.js';
import { checkAuth, login, register, logout, openProfileModal, showToast, getUser, onAuthChanged, initProfileHandlers } from './auth.js';
import { fetchUserBookmarks, fetchContinueWatching, fetchCustomLists, createCustomCollection } from './bookmarks.js';
import { openPlayerModal, closePlayerModal } from './player.js';

let currentTab = 'home';
let currentViewMode = localStorage.getItem('storm_view_mode') || 'grid';
let currentSource = 'all';
let currentSort = 'popular';
let currentPage = 1;
let currentItems = [];
let searchQuery = '';

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  applyTranslations();

  initViewModes();
  initTabs();
  initSearch();
  initModals();
  initProfileHandlers();
  initLanguageSwitcher();

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
            ${item.source === 'anixart' ? '<span class="storm-badge storm-badge-quality">ANIXART</span>' : ''}
            ${item.source === 'shikimori' ? '<span class="storm-badge storm-badge-quality" style="background:linear-gradient(135deg,#3b82f6,#1d4ed8);">SHIKIMORI</span>' : ''}
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
            <span>${item.year || (item.source === 'anixart' || item.source === 'shikimori' ? 'Аниме' : 'Фильм')}</span>
            ${item.progress_percent > 0 ? `<span style="color:var(--accent);font-weight:700;">${item.progress_percent}%</span>` : ''}
          </div>
        </div>
      </div>
    `;
    }).join('');

    container.querySelectorAll('.media-card').forEach((card, idx) => {
      card.onclick = () => openPlayerModal(items[idx]);
    });
    return;
  }

  // 3. ДЕТАЛЬНЫЙ СПИСОК
  if (currentViewMode === 'detailed-list') {
    container.innerHTML = items.map((item, idx) => {
      const poster = item.poster || 'assets/favicon.svg';
      const sourceName = item.source === 'anixart' ? 'AniXart' : item.source === 'shikimori' ? 'Shikimori' : 'FanFilm4K';
      return `
      <div class="media-detailed-card" data-idx="${idx}">
        <div class="media-detailed-poster">
          <img src="${poster}" alt="${item.title}" loading="lazy" onerror="if(!this.dataset.triedProxy && this.src && !this.src.includes('/api/media/image-proxy')){ this.dataset.triedProxy='1'; this.src='/api/media/image-proxy?url='+encodeURIComponent(this.src); } else { this.onerror=null; this.src='assets/favicon.svg'; }">
          ${item.is4K ? '<span class="storm-badge storm-badge-4k" style="position:absolute;top:6px;left:6px;">4K UHD</span>' : ''}
          ${item.source === 'anixart' ? '<span class="storm-badge storm-badge-quality" style="position:absolute;top:6px;right:6px;">ANIXART</span>' : ''}
          ${item.source === 'shikimori' ? '<span class="storm-badge storm-badge-quality" style="position:absolute;top:6px;right:6px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);">SHIKIMORI</span>' : ''}
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
            <th>Тип</th>
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
              <td><span class="storm-badge storm-badge-quality">${item.media_type || 'movie'}</span></td>
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
