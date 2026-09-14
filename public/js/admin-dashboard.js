/**
 * STORM MULTIMEDIA — Дашборд администратора (ReiKatari Admin Dashboard)
 * Эксклюзивная панель управления для пользователя ReiKatari:
 * - Мониторинг всех зарегистрированных пользователей
 * - Статус текущего просмотра («Смотрит прямо сейчас») в реальном времени
 * - Полная история просмотров каждого пользователя
 * - Закладки и списки
 * - Статистика и аналитика экосистемы
 */

import { showToast } from './auth.js';

let adminDataCache = null;

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '—';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${day}.${month}.${year} ${hours}:${mins}`;
}

export function initAdminDashboard() {
  const adminBtn = document.getElementById('admin-dashboard-btn');
  if (adminBtn) {
    adminBtn.onclick = () => openAdminDashboardModal();
  }
}

export async function openAdminDashboardModal() {
  let modal = document.getElementById('admin-dashboard-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'storm-modal-backdrop';
    modal.id = 'admin-dashboard-modal';
    modal.innerHTML = `
      <div class="storm-modal admin-dashboard-dialog">
        <div class="storm-modal-header">
          <div class="admin-modal-title-box">
            <span class="admin-crown-badge">👑</span>
            <div>
              <h3 class="storm-modal-title">Панель администратора ReiKatari</h3>
              <p class="admin-modal-subtitle">Мониторинг пользователей, активности просмотра и закладок</p>
            </div>
          </div>
          <div style="display: flex; gap: 10px; align-items: center;">
            <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="admin-refresh-btn" title="Обновить данные">
              <span>🔄</span> <span class="btn-text">Обновить</span>
            </button>
            <button type="button" class="storm-modal-close" id="close-admin-dashboard-btn">✕</button>
          </div>
        </div>

        <div class="storm-modal-body admin-dashboard-body">
          <!-- 4 3D-карточки статистики экосистемы -->
          <div class="admin-metrics-grid">
            <div class="admin-metric-card">
              <div class="admin-metric-icon" style="background: rgba(0, 210, 255, 0.15); color: #00d2ff;">👥</div>
              <div class="admin-metric-data">
                <div class="admin-metric-val" id="admin-stat-total-users">0</div>
                <div class="admin-metric-label">Всего пользователей</div>
              </div>
            </div>
            <div class="admin-metric-card">
              <div class="admin-metric-icon" style="background: rgba(255, 51, 102, 0.15); color: #ff3366;">🔴</div>
              <div class="admin-metric-data">
                <div class="admin-metric-val" id="admin-stat-active-users">0</div>
                <div class="admin-metric-label">Смотрят прямо сейчас</div>
              </div>
            </div>
            <div class="admin-metric-card">
              <div class="admin-metric-icon" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b;">📑</div>
              <div class="admin-metric-data">
                <div class="admin-metric-val" id="admin-stat-total-bookmarks">0</div>
                <div class="admin-metric-label">Всего закладок</div>
              </div>
            </div>
            <div class="admin-metric-card">
              <div class="admin-metric-icon" style="background: rgba(0, 255, 102, 0.15); color: #00ff66;">⏱️</div>
              <div class="admin-metric-data">
                <div class="admin-metric-val" id="admin-stat-total-views">0</div>
                <div class="admin-metric-label">Просмотров в истории</div>
              </div>
            </div>
          </div>

          <!-- Поисковая панель -->
          <div class="admin-search-toolbar">
            <div class="storm-search-box" style="flex: 1; max-width: 420px;">
              <span class="storm-search-icon">🔍</span>
              <input type="text" id="admin-user-search-input" class="storm-search-input" placeholder="Поиск по никнейму или email...">
            </div>
            <div class="admin-user-count-badge" id="admin-user-count-badge">Всего: 0</div>
          </div>

          <!-- Контейнер таблицы пользователей -->
          <div class="admin-users-table-wrap">
            <table class="admin-users-table">
              <thead>
                <tr>
                  <th>Пользователь</th>
                  <th>Роль</th>
                  <th>Регистрация</th>
                  <th>Что сейчас смотрит</th>
                  <th>Закладки</th>
                  <th>Время</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody id="admin-users-table-tbody">
                <tr>
                  <td colspan="7" style="text-align: center; padding: 40px; color: var(--text-muted);">
                    <div class="storm-spinner" style="margin: 0 auto 10px auto;"></div>
                    Загрузка данных пользователей...
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const closeBtn = modal.querySelector('#close-admin-dashboard-btn');
    if (closeBtn) closeBtn.onclick = () => modal.classList.remove('is-open');
    modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('is-open'); };

    const refreshBtn = modal.querySelector('#admin-refresh-btn');
    if (refreshBtn) refreshBtn.onclick = () => loadAdminData(true);

    const searchInput = modal.querySelector('#admin-user-search-input');
    if (searchInput) {
      searchInput.oninput = () => filterAndRenderUsers();
    }
  }

  modal.classList.add('is-open');
  await loadAdminData(false);
}

function isReiKatariAdminUser(user) {
  if (!user) return false;
  const username = (user.username || '').trim().toLowerCase();
  const email = (user.email || '').trim().toLowerCase();
  const role = (user.role || '').trim().toLowerCase();
  return username === 'reikatari' ||
         email === 'reikatari@outlook.com' ||
         email === '45316432+reikatari@users.noreply.github.com' ||
         email.includes('reikatari') ||
         role === 'admin';
}

async function loadAdminData(forceRefresh = false) {
  let token = localStorage.getItem('storm_token');
  const userJson = localStorage.getItem('storm_user');
  let currentUser = null;
  try { currentUser = userJson ? JSON.parse(userJson) : null; } catch {}

  // Автоматическая авторизация для ReiKatari / ReiKatari@outlook.com
  if (!token || !currentUser || !isReiKatariAdminUser(currentUser)) {
    try {
      const autoRes = await fetch('/api/auth/auto-login', { method: 'POST' });
      if (autoRes.ok) {
        const autoData = await autoRes.json();
        if (autoData.token) {
          token = autoData.token;
          localStorage.setItem('storm_token', token);
          localStorage.setItem('storm_user', JSON.stringify(autoData.user));
          currentUser = autoData.user;
        }
      }
    } catch {}
  }

  const tbody = document.getElementById('admin-users-table-tbody');
  if (tbody && forceRefresh) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 40px; color: var(--text-muted);">
          <div class="storm-spinner" style="margin: 0 auto 10px auto;"></div>
          Обновление данных пользователей...
        </td>
      </tr>
    `;
  }

  try {
    let res = await fetch('/api/admin/users-overview', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    // При 401/403 или ошибке доступа выполняем переавторизацию ReiKatari и повторяем
    if (res.status === 401 || res.status === 403) {
      try {
        const autoRes = await fetch('/api/auth/auto-login', { method: 'POST' });
        if (autoRes.ok) {
          const autoData = await autoRes.json();
          if (autoData.token) {
            token = autoData.token;
            localStorage.setItem('storm_token', token);
            localStorage.setItem('storm_user', JSON.stringify(autoData.user));
            res = await fetch('/api/admin/users-overview', {
              headers: { 'Authorization': `Bearer ${token}` }
            });
          }
        }
      } catch {}
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Ошибка доступа к панели администратора' }));
      throw new Error(err.error || 'Ошибка доступа к панели администратора');
    }

    adminDataCache = await res.json();
    renderMetrics(adminDataCache.summary);
    filterAndRenderUsers();
    if (forceRefresh) showToast('Данные пользователей обновлены', 'success');
  } catch (err) {
    console.error('Ошибка загрузки дашборда:', err);
    showToast(err.message, 'error');
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 40px; color: #ff3366;">
            ❌ ${escapeHtml(err.message)}
          </td>
        </tr>
      `;
    }
  }
}

function renderMetrics(summary) {
  if (!summary) return;
  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  setEl('admin-stat-total-users', summary.total_users || 0);
  setEl('admin-stat-active-users', summary.active_now || 0);
  setEl('admin-stat-total-bookmarks', summary.total_bookmarks || 0);
  setEl('admin-stat-total-views', summary.total_history_views || 0);
}

function filterAndRenderUsers() {
  if (!adminDataCache || !Array.isArray(adminDataCache.users)) return;

  const tbody = document.getElementById('admin-users-table-tbody');
  const countBadge = document.getElementById('admin-user-count-badge');
  const searchInput = document.getElementById('admin-user-search-input');
  const query = (searchInput?.value || '').toLowerCase().trim();

  let filtered = adminDataCache.users;
  if (query) {
    filtered = filtered.filter(u =>
      (u.username || '').toLowerCase().includes(query) ||
      (u.email || '').toLowerCase().includes(query)
    );
  }

  if (countBadge) {
    countBadge.textContent = `Показано: ${filtered.length} из ${adminDataCache.users.length}`;
  }

  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 36px; color: var(--text-muted);">
          🔍 Пользователи не найдены
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(u => {
    const isReiKatari = u.username === 'ReiKatari';
    const isAdmin = u.role === 'admin' || isReiKatari;
    const regDate = formatDate(u.created_at);
    const avatarSrc = u.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(u.username)}`;

    // Что сейчас смотрит
    let watchingHtml = '<span class="admin-status-idle">— Нет активности</span>';
    if (u.watching_now) {
      const wn = u.watching_now;
      const progress = Math.round(wn.progress_percent || 0);
      const epInfo = wn.season && wn.episode ? `(S${wn.season} • E${wn.episode})` : '';
      const activeBadge = wn.is_active
        ? '<span class="admin-live-pulse-badge">🔴 Смотрит сейчас</span>'
        : '<span class="admin-last-view-badge">⚪ Был просмотр</span>';

      watchingHtml = `
        <div class="admin-watching-box">
          ${activeBadge}
          <div class="admin-watching-title" title="${escapeHtml(wn.title)}">
            ${escapeHtml(wn.title)} ${epInfo}
          </div>
          <div class="admin-progress-mini-bar">
            <div class="admin-progress-mini-fill" style="width: ${progress}%;"></div>
          </div>
          <div class="admin-watching-meta">
            <span>${progress}%</span>
            <span>${formatDate(wn.updated_at)}</span>
          </div>
        </div>
      `;
    }

    return `
      <tr class="admin-user-row ${isReiKatari ? 'is-owner' : ''}">
        <!-- Пользователь -->
        <td>
          <div class="admin-user-cell">
            <img src="${avatarSrc}" alt="${escapeHtml(u.username)}" class="admin-user-avatar" onerror="this.src='assets/favicon.svg'">
            <div>
              <div class="admin-user-name">
                ${escapeHtml(u.username)}
                ${isReiKatari ? '<span class="admin-owner-tag">Владелец</span>' : ''}
              </div>
              <div class="admin-user-email">${escapeHtml(u.email)}</div>
            </div>
          </div>
        </td>

        <!-- Роль -->
        <td>
          ${isAdmin
            ? '<span class="storm-badge" style="background: rgba(245, 158, 11, 0.2); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.4);">Администратор</span>'
            : '<span class="storm-badge" style="background: rgba(255, 255, 255, 0.08); color: var(--text-secondary);">Пользователь</span>'}
        </td>

        <!-- Регистрация -->
        <td>
          <span style="font-size: 12px; color: var(--text-secondary); white-space: nowrap;">${regDate}</span>
        </td>

        <!-- Что сейчас смотрит -->
        <td style="min-width: 210px;">
          ${watchingHtml}
        </td>

        <!-- Закладки -->
        <td>
          <div class="admin-bookmarks-cell">
            <span class="admin-count-pill">${u.bookmarks_count || 0}</span>
            <span style="font-size: 11.5px; color: var(--text-muted);">в списках</span>
          </div>
        </td>

        <!-- Время просмотра -->
        <td>
          <span style="font-size: 12.5px; font-weight: 700; color: var(--accent);">${u.total_hours || 0} ч.</span>
        </td>

        <!-- Действия -->
        <td style="text-align: right;">
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm admin-view-details-btn" data-userid="${u.id}" style="font-size: 11.5px;">
            <span>📋</span> Детали
          </button>
        </td>
      </tr>
    `;
  }).join('');

  // Обработчики кнопок детального просмотра
  tbody.querySelectorAll('.admin-view-details-btn').forEach(btn => {
    btn.onclick = () => {
      const uid = parseInt(btn.dataset.userid, 10);
      const user = adminDataCache.users.find(u => u.id === uid);
      if (user) openUserDetailsModal(user);
    };
  });
}

function openUserDetailsModal(user) {
  let modal = document.getElementById('admin-user-details-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'storm-modal-backdrop';
    modal.id = 'admin-user-details-modal';
    modal.style.zIndex = '1100';
    modal.innerHTML = `
      <div class="storm-modal" style="max-width: 820px; width: 95vw; max-height: 88vh; display: flex; flex-direction: column;">
        <div class="storm-modal-header" style="justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <img id="aud-avatar" src="" style="width: 42px; height: 42px; border-radius: 50%; object-fit: cover; border: 2px solid var(--accent);">
            <div>
              <h3 class="storm-modal-title" id="aud-username" style="margin: 0;">Пользователь</h3>
              <div id="aud-email" style="font-size: 12px; color: var(--text-muted);"></div>
            </div>
          </div>
          <button type="button" class="storm-modal-close" id="close-aud-modal-btn">✕</button>
        </div>

        <div class="storm-modal-body" style="padding: 20px; flex: 1; overflow-y: auto;">
          <!-- Вкладки деталей: История и Закладки -->
          <div style="display: flex; gap: 10px; margin-bottom: 16px; border-bottom: 1px solid var(--border-subtle); padding-bottom: 10px;">
            <button type="button" class="storm-btn storm-btn-primary storm-btn-sm aud-tab-btn active" data-tab="history">
              <span>🕒</span> История просмотров (<span id="aud-history-count">0</span>)
            </button>
            <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm aud-tab-btn" data-tab="bookmarks">
              <span>📑</span> Закладки пользователя (<span id="aud-bookmarks-count">0</span>)
            </button>
          </div>

          <!-- Секция истории -->
          <div id="aud-history-section">
            <div id="aud-history-list" style="display: flex; flex-direction: column; gap: 10px;"></div>
          </div>

          <!-- Секция закладок -->
          <div id="aud-bookmarks-section" style="display: none;">
            <div id="aud-bookmarks-list" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px;"></div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const closeBtn = modal.querySelector('#close-aud-modal-btn');
    if (closeBtn) closeBtn.onclick = () => modal.classList.remove('is-open');
    modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('is-open'); };

    modal.querySelectorAll('.aud-tab-btn').forEach(btn => {
      btn.onclick = () => {
        modal.querySelectorAll('.aud-tab-btn').forEach(b => {
          b.classList.toggle('storm-btn-primary', b === btn);
          b.classList.toggle('storm-btn-secondary', b !== btn);
        });
        const tab = btn.dataset.tab;
        const histSec = modal.querySelector('#aud-history-section');
        const bookSec = modal.querySelector('#aud-bookmarks-section');
        if (histSec) histSec.style.display = tab === 'history' ? 'block' : 'none';
        if (bookSec) bookSec.style.display = tab === 'bookmarks' ? 'block' : 'none';
      };
    });
  }

  modal.classList.add('is-open');

  const avatar = modal.querySelector('#aud-avatar');
  const uname = modal.querySelector('#aud-username');
  const uemail = modal.querySelector('#aud-email');
  const hCount = modal.querySelector('#aud-history-count');
  const bCount = modal.querySelector('#aud-bookmarks-count');
  const hList = modal.querySelector('#aud-history-list');
  const bList = modal.querySelector('#aud-bookmarks-list');

  if (avatar) avatar.src = user.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(user.username)}`;
  if (uname) uname.textContent = user.username;
  if (uemail) uemail.textContent = `${user.email} • Зарегистрирован: ${formatDate(user.created_at)}`;
  if (hCount) hCount.textContent = user.history?.length || 0;
  if (bCount) bCount.textContent = user.bookmarks?.length || 0;

  // Рендерим историю
  if (hList) {
    if (!user.history || user.history.length === 0) {
      hList.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 30px;">История просмотров пуста</div>';
    } else {
      hList.innerHTML = user.history.map(h => {
        const progress = Math.round(h.progress_percent || 0);
        const ep = h.season && h.episode ? `Сезон ${h.season}, Серия ${h.episode}` : '';
        return `
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: var(--bg-tertiary); border: 1px solid var(--border-subtle); border-radius: 8px;">
            <div>
              <div style="font-weight: 700; font-size: 13.5px; color: var(--text-primary);">${escapeHtml(h.title)}</div>
              <div style="font-size: 11.5px; color: var(--text-muted); margin-top: 2px;">
                ${ep ? `${ep} • ` : ''}Прогресс: ${progress}% • Источник: ${escapeHtml(h.source)}
              </div>
            </div>
            <div style="text-align: right; font-size: 11.5px; color: var(--text-secondary);">
              ${formatDate(h.updated_at)}
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // Рендерим закладки
  if (bList) {
    if (!user.bookmarks || user.bookmarks.length === 0) {
      bList.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 30px;">У пользователя нет закладок</div>';
    } else {
      bList.innerHTML = user.bookmarks.map(b => {
        const statusMap = {
          'watching': 'Смотрю',
          'plan': 'В планах',
          'completed': 'Просмотрено',
          'hold': 'Отложено',
          'dropped': 'Брошено',
          'favorite': 'Любимое'
        };
        const statusLabel = statusMap[b.status] || b.status;
        return `
          <div style="padding: 10px; background: var(--bg-tertiary); border: 1px solid var(--border-subtle); border-radius: 8px;">
            <div style="font-weight: 700; font-size: 13px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(b.title)}">${escapeHtml(b.title)}</div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px;">
              <span class="storm-badge" style="font-size: 10.5px; padding: 2px 6px;">${statusLabel}</span>
              <span style="font-size: 11px; color: var(--text-muted);">${formatDate(b.updated_at)}</span>
            </div>
          </div>
        `;
      }).join('');
    }
  }
}
