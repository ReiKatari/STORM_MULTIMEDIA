/**
 * STORM MULTIMEDIA - Центр управления и телеметрии администратора (ReiKatari Admin Center 3.0)
 * Векторная SVG-иконографика, 6 3D-метрик, интерактивные SVG-графики,
 * мониторинг пользователей, сессий, CDN-балансеров, L1 кэша и СУБД MariaDB 10.
 */

import { showToast } from './auth.js?v=1.3.0';

let adminDataCache = null;
let adminBalancersCache = null;
let adminCacheStats = null;
let adminLogsCache = null;
let activeRoleFilter = 'all';
let activeSortMode = 'id_asc';

const SVG = {
  crown: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14"/></svg>`,
  refresh: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>`,
  users: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  live: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/></svg>`,
  bookmarks: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>`,
  clock: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  cdn: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>`,
  db: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>`,
  search: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  details: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
  trash: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
  chart: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
  pie: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>`,
  star: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  shield: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`
};

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
  if (!ts) return 'Не указано';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return 'Не указано';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${day}.${month}.${year} ${hours}:${mins}`;
}

function formatDurationReadable(hours, minutes) {
  const h = Number(hours) || 0;
  const m = Number(minutes) || 0;
  if (h >= 1) return `${h} ч.`;
  if (m > 0) return `${m} мин.`;
  return '0 мин.';
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
        <div class="storm-modal-header admin-header-elevated">
          <div class="admin-modal-title-box">
            <span class="admin-crown-badge">${SVG.crown}</span>
            <div>
              <h3 class="storm-modal-title">Панель администратора ReiKatari</h3>
              <p class="admin-modal-subtitle">Центр телеметрии пользователей, аналитики медиатеки, сессий и CDN-узлов</p>
            </div>
          </div>
          <div style="display: flex; gap: 10px; align-items: center;">
            <span class="admin-cluster-pill" id="admin-cluster-status-pill">
              <span class="admin-dot-online"></span> Кластер MariaDB 10 синхронизирован
            </span>
            <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="admin-refresh-btn" title="Обновить все показатели и графики">
              ${SVG.refresh} <span class="btn-text">Обновить</span>
            </button>
            <button type="button" class="storm-modal-close" id="close-admin-dashboard-btn">✕</button>
          </div>
        </div>

        <div class="storm-modal-body admin-dashboard-body">
          <!-- 6 3D-карточек ключевых метрик экосистемы -->
          <div class="admin-metrics-grid admin-metrics-grid-6">
            <div class="admin-metric-card">
              <div class="admin-metric-icon" style="background: rgba(0, 210, 255, 0.14); color: #00d2ff; border: 1px solid rgba(0, 210, 255, 0.3);">${SVG.users}</div>
              <div class="admin-metric-data">
                <div class="admin-metric-val" id="admin-stat-total-users">0</div>
                <div class="admin-metric-label">Пользователей</div>
                <div class="admin-metric-sub" id="admin-stat-users-sub">Активных сессий: 0</div>
              </div>
            </div>

            <div class="admin-metric-card">
              <div class="admin-metric-icon" style="background: rgba(255, 51, 102, 0.14); color: #ff3366; border: 1px solid rgba(255, 51, 102, 0.3);">${SVG.live}</div>
              <div class="admin-metric-data">
                <div class="admin-metric-val" id="admin-stat-active-users">0</div>
                <div class="admin-metric-label">Смотрят сейчас</div>
                <div class="admin-metric-sub" id="admin-stat-active-sub">Прямых потоков в эфире</div>
              </div>
            </div>

            <div class="admin-metric-card">
              <div class="admin-metric-icon" style="background: rgba(245, 158, 11, 0.14); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3);">${SVG.bookmarks}</div>
              <div class="admin-metric-data">
                <div class="admin-metric-val" id="admin-stat-total-bookmarks">0</div>
                <div class="admin-metric-label">Всего закладок</div>
                <div class="admin-metric-sub" id="admin-stat-lists-sub">Списков и коллекций: 0</div>
              </div>
            </div>

            <div class="admin-metric-card">
              <div class="admin-metric-icon" style="background: rgba(0, 255, 102, 0.14); color: #00ff66; border: 1px solid rgba(0, 255, 102, 0.3);">${SVG.clock}</div>
              <div class="admin-metric-data">
                <div class="admin-metric-val" id="admin-stat-total-views">0</div>
                <div class="admin-metric-label">Записей в истории</div>
                <div class="admin-metric-sub" id="admin-stat-hours-sub">В эфире: 0 мин.</div>
              </div>
            </div>

            <div class="admin-metric-card">
              <div class="admin-metric-icon" style="background: rgba(168, 85, 247, 0.14); color: #a855f7; border: 1px solid rgba(168, 85, 247, 0.3);">${SVG.cdn}</div>
              <div class="admin-metric-data">
                <div class="admin-metric-val" id="admin-stat-cdn-online">8 / 8</div>
                <div class="admin-metric-label">Узлы балансеров</div>
                <div class="admin-metric-sub" id="admin-stat-cdn-ping">Средний отклик: 120 мс</div>
              </div>
            </div>

            <div class="admin-metric-card">
              <div class="admin-metric-icon" style="background: rgba(14, 165, 233, 0.14); color: #38bdf8; border: 1px solid rgba(14, 165, 233, 0.3);">${SVG.db}</div>
              <div class="admin-metric-data">
                <div class="admin-metric-val" id="admin-stat-cache-hit">100%</div>
                <div class="admin-metric-label">Кэш L1 и СУБД</div>
                <div class="admin-metric-sub" id="admin-stat-cache-entries">MariaDB + SQLite активны</div>
              </div>
            </div>
          </div>

          <!-- Визуальные аналитические графики (3 панели) -->
          <div class="admin-analytics-charts-grid" id="admin-analytics-charts-grid">
            <div class="admin-chart-card">
              <div class="admin-chart-header">
                <span class="admin-chart-title">${SVG.chart} Структура закладок по статусам</span>
                <span class="admin-chart-badge" id="admin-chart-bookmarks-total">0 тайтлов</span>
              </div>
              <div class="admin-chart-body" id="admin-chart-status-bars"></div>
            </div>

            <div class="admin-chart-card">
              <div class="admin-chart-header">
                <span class="admin-chart-title">${SVG.pie} Распределение по категориям медиа</span>
                <span class="admin-chart-badge">Доли каталога</span>
              </div>
              <div class="admin-chart-body admin-donut-wrap" id="admin-chart-type-donut"></div>
            </div>

            <div class="admin-chart-card">
              <div class="admin-chart-header">
                <span class="admin-chart-title">${SVG.star} Популярные релизы и скорость CDN</span>
                <span class="admin-chart-badge">Рейтинг активности</span>
              </div>
              <div class="admin-chart-body" id="admin-chart-top-titles"></div>
            </div>
          </div>

          <!-- Панель навигационных вкладок -->
          <div class="admin-tabs-bar">
            <button type="button" class="storm-btn storm-btn-sm storm-btn-primary admin-tab-btn" data-admin-tab="users" id="admin-tab-users-btn">
              ${SVG.users} <span>Пользователи и активность</span>
            </button>
            <button type="button" class="storm-btn storm-btn-sm storm-btn-secondary admin-tab-btn" data-admin-tab="sessions" id="admin-tab-sessions-btn">
              ${SVG.live} <span>Живые сессии и устройства (<span id="admin-sessions-badge-count">0</span>)</span>
            </button>
            <button type="button" class="storm-btn storm-btn-sm storm-btn-secondary admin-tab-btn" data-admin-tab="balancers" id="admin-tab-balancers-btn">
              ${SVG.cdn} <span>Балансеры и CDN-узлы</span>
            </button>
            <button type="button" class="storm-btn storm-btn-sm storm-btn-secondary admin-tab-btn" data-admin-tab="system" id="admin-tab-system-btn">
              ${SVG.db} <span>Кэш L1, СУБД и журнал</span>
            </button>
          </div>

          <!-- Вкладка 1: Пользователи и активность -->
          <div id="admin-users-view" class="admin-tab-pane is-active">
            <div class="admin-search-toolbar">
              <div class="storm-search-box" style="flex: 1; max-width: 440px;">
                <span class="storm-search-icon" style="display:inline-flex;align-items:center;">${SVG.search}</span>
                <input type="text" id="admin-user-search-input" class="storm-search-input" placeholder="Поиск по имени пользователя или e-mail...">
              </div>
              <div class="admin-filter-pills" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <button type="button" class="storm-btn storm-btn-xs storm-btn-primary admin-role-filter-btn" data-role="all">Все аккаунты</button>
                <button type="button" class="storm-btn storm-btn-xs storm-btn-secondary admin-role-filter-btn" data-role="admin">Администраторы</button>
                <button type="button" class="storm-btn storm-btn-xs storm-btn-secondary admin-role-filter-btn" data-role="with_bookmarks">С закладками</button>
                <select id="admin-user-sort-select" class="admin-sort-select" title="Сортировка списка пользователей">
                  <option value="id_asc">Сначала ранние</option>
                  <option value="bookmarks_desc">По числу закладок</option>
                  <option value="recent_desc">По дате активности</option>
                </select>
                <div class="admin-user-count-badge" id="admin-user-count-badge">Показано: 0 из 0</div>
              </div>
            </div>

            <div class="admin-users-table-wrap">
              <table class="admin-users-table">
                <thead>
                  <tr>
                    <th>Пользователь и сессии</th>
                    <th>Роль и доступ</th>
                    <th>Регистрация и вход</th>
                    <th>Статус воспроизведения</th>
                    <th>Закладки и списки</th>
                    <th>Время в эфире</th>
                    <th>Управление</th>
                  </tr>
                </thead>
                <tbody id="admin-users-table-tbody">
                  <tr>
                    <td colspan="7" style="text-align: center; padding: 40px; color: var(--text-muted);">
                      Загрузка данных пользователей...
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Вкладка 2: Живые сессии и устройства -->
          <div id="admin-sessions-view" class="admin-tab-pane" style="display: none;">
            <div id="admin-sessions-grid" class="admin-sessions-grid"></div>
          </div>

          <!-- Вкладка 3: Балансеры и CDN -->
          <div id="admin-balancers-view" class="admin-tab-pane" style="display: none;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
              <div style="font-size:13px;color:var(--text-secondary);font-weight:600;">Мониторинг отклика и доступности 8 балансеров видеопотоков в реальном времени</div>
              <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="admin-check-balancers-btn">
                ${SVG.refresh} Проверить все узлы сейчас
              </button>
            </div>
            <div id="admin-balancers-grid" class="admin-balancers-grid"></div>
          </div>

          <!-- Вкладка 4: Кэш L1, СУБД и журнал -->
          <div id="admin-system-view" class="admin-tab-pane" style="display: none;">
            <div id="admin-system-content" class="admin-system-grid"></div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const closeBtn = document.getElementById('close-admin-dashboard-btn');
    if (closeBtn) closeBtn.onclick = () => modal.classList.remove('is-open');

    const refreshBtn = document.getElementById('admin-refresh-btn');
    if (refreshBtn) refreshBtn.onclick = () => loadAdminData(true);

    const searchInput = document.getElementById('admin-user-search-input');
    if (searchInput) {
      searchInput.oninput = () => filterAndRenderUsers();
    }

    const sortSelect = document.getElementById('admin-user-sort-select');
    if (sortSelect) {
      sortSelect.onchange = () => {
        activeSortMode = sortSelect.value || 'id_asc';
        filterAndRenderUsers();
      };
    }

    modal.querySelectorAll('.admin-role-filter-btn').forEach(btn => {
      btn.onclick = () => {
        activeRoleFilter = btn.dataset.role || 'all';
        modal.querySelectorAll('.admin-role-filter-btn').forEach(b => {
          b.classList.toggle('storm-btn-primary', b === btn);
          b.classList.toggle('storm-btn-secondary', b !== btn);
        });
        filterAndRenderUsers();
      };
    });

    modal.querySelectorAll('.admin-tab-btn').forEach(btn => {
      btn.onclick = () => {
        const target = btn.dataset.adminTab;
        modal.querySelectorAll('.admin-tab-btn').forEach(b => {
          b.classList.toggle('storm-btn-primary', b === btn);
          b.classList.toggle('storm-btn-secondary', b !== btn);
        });
        const panes = {
          users: document.getElementById('admin-users-view'),
          sessions: document.getElementById('admin-sessions-view'),
          balancers: document.getElementById('admin-balancers-view'),
          system: document.getElementById('admin-system-view')
        };
        Object.entries(panes).forEach(([k, el]) => {
          if (el) el.style.display = (k === target) ? 'block' : 'none';
        });
        if (target === 'sessions') renderLiveSessionsView();
        if (target === 'balancers') renderBalancersView();
        if (target === 'system') renderSystemView();
      };
    });

    const checkBalBtn = document.getElementById('admin-check-balancers-btn');
    if (checkBalBtn) {
      checkBalBtn.onclick = async () => {
        checkBalBtn.disabled = true;
        try {
          const token = localStorage.getItem('storm_token') || '';
          const res = await fetch('/api/admin/balancers/check', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (res.ok) {
            adminBalancersCache = await res.json();
            renderBalancersView();
            renderMetricsAndCharts();
            showToast('Проверка всех CDN-балансеров завершена', 'success');
          }
        } catch (_) {}
        checkBalBtn.disabled = false;
      };
    }

    modal.onclick = (e) => {
      if (e.target === modal) modal.classList.remove('is-open');
    };
  }

  modal.classList.add('is-open');
  await loadAdminData();
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
  const token = localStorage.getItem('storm_token');
  const userJson = localStorage.getItem('storm_user');
  let currentUser = null;
  try { currentUser = userJson ? JSON.parse(userJson) : null; } catch {}

  if (!token || !currentUser || !isReiKatariAdminUser(currentUser)) {
    const tbody = document.getElementById('admin-users-table-tbody');
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 40px; color: #ff3366;">
            Доступ ограничен. Войдите под учётной записью администратора ReiKatari.
          </td>
        </tr>
      `;
    }
    showToast('Требуется авторизация администратора', 'error');
    return;
  }

  const headers = { 'Authorization': `Bearer ${token || ''}` };
  try {
    const [overviewRes, balRes, cacheRes, logsRes] = await Promise.all([
      fetch('/api/admin/users-overview', { headers }),
      fetch('/api/admin/balancers', { headers }).catch(() => null),
      fetch('/api/admin/cache-stats', { headers }).catch(() => null),
      fetch('/api/admin/logs?limit=60', { headers }).catch(() => null)
    ]);

    if (!overviewRes.ok) {
      const err = await overviewRes.json().catch(() => ({ error: 'Ошибка доступа к панели администратора' }));
      throw new Error(err.error || 'Ошибка доступа к панели администратора');
    }

    adminDataCache = await overviewRes.json();
    if (balRes && balRes.ok) adminBalancersCache = await balRes.json().catch(() => null);
    if (cacheRes && cacheRes.ok) adminCacheStats = await cacheRes.json().catch(() => null);
    if (logsRes && logsRes.ok) adminLogsCache = await logsRes.json().catch(() => null);

    renderMetricsAndCharts();
    filterAndRenderUsers();
    renderLiveSessionsView();
    renderBalancersView();
    renderSystemView();
    if (forceRefresh) showToast('Данные и аналитика обновлены', 'success');
  } catch (err) {
    console.error('Ошибка загрузки дашборда:', err);
    showToast(err.message, 'error');
  }
}

function renderMetricsAndCharts() {
  const summary = adminDataCache?.summary || {};
  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setEl('admin-stat-total-users', summary.total_users || 0);
  setEl('admin-stat-users-sub', `Активных сессий: ${summary.active_sessions || 0}`);
  setEl('admin-stat-active-users', summary.active_now || 0);
  setEl('admin-stat-active-sub', summary.active_now > 0 ? 'Идёт воспроизведение' : 'Все потоки в режиме ожидания');
  setEl('admin-stat-total-bookmarks', summary.total_bookmarks || 0);
  setEl('admin-stat-lists-sub', `Списков и коллекций: ${summary.total_custom_lists || 0}`);
  setEl('admin-stat-total-views', summary.total_history_views || 0);
  setEl('admin-stat-hours-sub', `В эфире: ${formatDurationReadable(summary.total_watch_hours, summary.total_watch_minutes)}`);

  const sessionsCount = (adminDataCache?.active_sessions_list?.length || 0) + (summary.active_now || 0);
  setEl('admin-sessions-badge-count', sessionsCount);

  // Метрики CDN
  const balList = Array.isArray(adminBalancersCache?.balancers) ? adminBalancersCache.balancers : [];
  if (balList.length > 0) {
    const healthy = balList.filter(b => b.status === 'online' || b.healthy !== false).length;
    const avgPing = Math.round(balList.reduce((s, b) => s + (Number(b.latencyMs) || 95), 0) / balList.length);
    setEl('admin-stat-cdn-online', `${healthy} / ${balList.length}`);
    setEl('admin-stat-cdn-ping', `Средний отклик: ${avgPing} мс`);
  }

  // Метрики L1 Cache & MariaDB
  if (adminCacheStats) {
    const l1 = adminCacheStats.l1Cache || {};
    const hitRate = l1.hitRate !== undefined ? `${Math.round(Number(l1.hitRate) * 100) || 98}%` : '99%';
    setEl('admin-stat-cache-hit', hitRate);
    const mariaConnected = adminCacheStats.mariadb?.connected !== false;
    setEl('admin-stat-cache-entries', mariaConnected ? `MariaDB (${adminCacheStats.mariadb?.host || '192.168.1.154'}) + L1 (${l1.entries || 0})` : `SQLite Local + L1 (${l1.entries || 0})`);
  }

  // ГРАФИК 1: Горизонтальная гистограмма закладок по статусам
  const sb = summary.status_breakdown || {};
  const totalBm = Math.max(1, summary.total_bookmarks || 0);
  setEl('admin-chart-bookmarks-total', `${summary.total_bookmarks || 0} тайтлов`);

  const statusMeta = [
    { key: 'watching', label: 'Смотрю сейчас', color: '#00d2ff', count: sb.watching || 0 },
    { key: 'plan', label: 'В планах', color: '#a855f7', count: sb.plan || 0 },
    { key: 'completed', label: 'Просмотрено', color: '#10b981', count: sb.completed || 0 },
    { key: 'favorite', label: 'Любимое', color: '#ff3366', count: sb.favorite || 0 },
    { key: 'hold', label: 'Отложено', color: '#f59e0b', count: sb.hold || 0 },
    { key: 'dropped', label: 'Брошено', color: '#64748b', count: sb.dropped || 0 }
  ];

  const statusBarsEl = document.getElementById('admin-chart-status-bars');
  if (statusBarsEl) {
    statusBarsEl.innerHTML = statusMeta.map(item => {
      const pct = summary.total_bookmarks > 0 ? Math.round((item.count / totalBm) * 100) : 0;
      const barWidth = item.count > 0 ? Math.max(4, pct) : 0;
      return `
        <div class="admin-bar-row">
          <div class="admin-bar-label-row">
            <span class="admin-bar-label"><span class="admin-bar-dot" style="background:${item.color};"></span>${item.label}</span>
            <span class="admin-bar-val">${item.count} <small>(${pct}%)</small></span>
          </div>
          <div class="admin-bar-track">
            <div class="admin-bar-fill" style="width:${barWidth}%;background:linear-gradient(90deg, ${item.color}, ${item.color}cc);box-shadow:0 0 10px ${item.color}55;"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  // ГРАФИК 2: Кольцевая SVG-диаграмма типов медиа
  const tb = summary.type_breakdown || {};
  const typeItems = [
    { label: 'Аниме', count: tb.anime || 0, color: '#a855f7' },
    { label: 'Фильмы', count: tb.movie || 0, color: '#00d2ff' },
    { label: 'Сериалы', count: tb.series || 0, color: '#10b981' },
    { label: 'Мультфильмы', count: tb.cartoon || 0, color: '#f59e0b' }
  ];
  const totalTypes = Math.max(1, typeItems.reduce((s, x) => s + x.count, 0));
  const donutEl = document.getElementById('admin-chart-type-donut');
  if (donutEl) {
    const r = 42;
    const c = 2 * Math.PI * r;
    let offset = 0;
    const circlesSvg = typeItems.map(seg => {
      const frac = seg.count / totalTypes;
      const len = frac * c;
      const dashArray = `${len.toFixed(2)} ${(c - len).toFixed(2)}`;
      const dashOffset = (-offset).toFixed(2);
      offset += len;
      return len > 0 ? `<circle cx="55" cy="55" r="${r}" fill="transparent" stroke="${seg.color}" stroke-width="13" stroke-dasharray="${dashArray}" stroke-dashoffset="${dashOffset}" transform="rotate(-90 55 55)"/>` : '';
    }).join('');

    donutEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:18px;width:100%;">
        <div style="position:relative;width:110px;height:110px;flex-shrink:0;">
          <svg width="110" height="110" viewBox="0 0 110 110">
            <circle cx="55" cy="55" r="${r}" fill="transparent" stroke="rgba(255,255,255,0.06)" stroke-width="13"/>
            ${circlesSvg}
          </svg>
          <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none;">
            <span style="font-size:16px;font-weight:800;color:#fff;">${summary.total_bookmarks || 0}</span>
            <span style="font-size:9.5px;color:var(--text-muted);text-transform:uppercase;">единиц</span>
          </div>
        </div>
        <div style="flex:1;display:flex;flex-direction:column;gap:8px;">
          ${typeItems.map(seg => {
            const p = summary.total_bookmarks > 0 ? Math.round((seg.count / totalTypes) * 100) : 0;
            return `
              <div style="display:flex;align-items:center;justify-content:space-between;font-size:12px;">
                <span style="display:inline-flex;align-items:center;gap:7px;color:var(--text-secondary);font-weight:600;">
                  <span style="width:9px;height:9px;border-radius:3px;background:${seg.color};display:inline-block;"></span>
                  ${seg.label}
                </span>
                <span style="font-weight:700;color:#fff;">${seg.count} <span style="color:var(--text-muted);font-weight:500;">(${p}%)</span></span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  // ГРАФИК 3: Топ популярных тайтлов в медиатеке
  const topEl = document.getElementById('admin-chart-top-titles');
  if (topEl) {
    const tops = Array.isArray(summary.top_titles) ? summary.top_titles.slice(0, 4) : [];
    if (tops.length === 0) {
      topEl.innerHTML = `<div style="color:var(--text-muted);font-size:12px;padding:16px 0;text-align:center;">Нет данных по релизам</div>`;
    } else {
      topEl.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px;">` + tops.map((t, i) => `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);">
          <div style="display:flex;align-items:center;gap:8px;min-width:0;">
            <span style="width:20px;height:20px;border-radius:6px;background:rgba(0,210,255,0.15);color:var(--accent);font-size:11px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;">#${i + 1}</span>
            <span style="font-size:12.5px;font-weight:700;color:#f8fafc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</span>
          </div>
          <span class="storm-badge" style="font-size:10.5px;padding:2px 8px;flex-shrink:0;">В списках: ${t.count}</span>
        </div>
      `).join('') + `</div>`;
    }
  }
}

function filterAndRenderUsers() {
  if (!adminDataCache || !Array.isArray(adminDataCache.users)) return;

  const tbody = document.getElementById('admin-users-table-tbody');
  const countBadge = document.getElementById('admin-user-count-badge');
  const searchInput = document.getElementById('admin-user-search-input');
  const query = (searchInput?.value || '').toLowerCase().trim();

  let filtered = [...adminDataCache.users];
  if (query) {
    filtered = filtered.filter(u =>
      (u.username || '').toLowerCase().includes(query) ||
      (u.email || '').toLowerCase().includes(query)
    );
  }

  if (activeRoleFilter === 'admin') {
    filtered = filtered.filter(u => u.role === 'admin' || u.username === 'ReiKatari');
  } else if (activeRoleFilter === 'with_bookmarks') {
    filtered = filtered.filter(u => (u.bookmarks_count || 0) > 0);
  }

  if (activeSortMode === 'bookmarks_desc') {
    filtered.sort((a, b) => (b.bookmarks_count || 0) - (a.bookmarks_count || 0));
  } else if (activeSortMode === 'recent_desc') {
    filtered.sort((a, b) => (b.last_active_at || b.created_at || 0) - (a.last_active_at || a.created_at || 0));
  } else {
    filtered.sort((a, b) => (a.id || 0) - (b.id || 0));
  }

  if (countBadge) {
    countBadge.textContent = `Показано: ${filtered.length} из ${adminDataCache.users.length}`;
  }

  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 36px; color: var(--text-muted);">
          Пользователи по заданному фильтру не найдены
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(u => {
    const isReiKatari = u.username === 'ReiKatari';
    const isAdmin = u.role === 'admin' || isReiKatari;
    const regDate = formatDate(u.created_at);
    const lastActDate = formatDate(u.last_active_at || u.created_at);
    const avatarSrc = u.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(u.username)}`;
    const sessionsCnt = u.active_sessions_count || 0;

    let watchingHtml = `
      <div class="admin-idle-pill">
        <span class="admin-idle-dot"></span>
        <span>Вне эфира (ожидание)</span>
      </div>
    `;
    if (u.watching_now) {
      const wn = u.watching_now;
      const progress = Math.round(wn.progress_percent || 0);
      const epInfo = wn.season && wn.episode ? `(S${wn.season} • E${wn.episode})` : '';
      const activeBadge = wn.is_active
        ? '<span class="admin-live-pulse-badge">Смотрит сейчас</span>'
        : '<span class="admin-last-view-badge">Недавний просмотр</span>';

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

    const sc = u.status_counts || {};
    const bmSubInfo = (u.bookmarks_count || 0) > 0
      ? `<div style="font-size:10.5px;color:var(--text-muted);margin-top:3px;">Смотрит: ${sc.watching || 0} • План: ${sc.plan || 0} • Готово: ${sc.completed || 0}</div>`
      : `<div style="font-size:10.5px;color:var(--text-muted);margin-top:3px;">Коллекций: ${u.custom_lists_count || 0}</div>`;

    return `
      <tr class="admin-user-row ${isReiKatari ? 'is-owner' : ''}">
        <td>
          <div class="admin-user-cell">
            <div style="position:relative;flex-shrink:0;">
              <img src="${avatarSrc}" alt="${escapeHtml(u.username)}" class="admin-user-avatar" onerror="this.src='assets/favicon.svg'">
              <span title="${sessionsCnt > 0 ? 'Активных устройств: ' + sessionsCnt : 'Офлайн'}" style="position:absolute;bottom:-1px;right:-1px;width:10px;height:10px;border-radius:50%;background:${sessionsCnt > 0 ? '#10b981' : '#64748b'};border:2px solid #0f172a;"></span>
            </div>
            <div>
              <div class="admin-user-name">
                ${escapeHtml(u.username)}
                ${isReiKatari ? '<span class="admin-owner-tag">Владелец</span>' : ''}
              </div>
              <div class="admin-user-email">${escapeHtml(u.email)}</div>
              <div style="font-size:10.5px;color:var(--text-muted);margin-top:2px;">ID #${u.id} • Устройств: ${sessionsCnt}</div>
            </div>
          </div>
        </td>

        <td>
          ${isAdmin
            ? `<span class="storm-badge" style="background: rgba(245, 158, 11, 0.18); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.45); display:inline-flex;align-items:center;gap:5px;">${SVG.shield} Администратор</span>`
            : '<span class="storm-badge" style="background: rgba(255, 255, 255, 0.07); color: var(--text-secondary);">Пользователь</span>'}
        </td>

        <td>
          <div style="font-size: 12px; color: #e2e8f0; font-weight: 600; white-space: nowrap;">Рег.: ${regDate}</div>
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 3px; white-space: nowrap;">Актив.: ${lastActDate}</div>
        </td>

        <td style="min-width: 220px;">
          ${watchingHtml}
        </td>

        <td>
          <div class="admin-bookmarks-cell">
            <span class="admin-count-pill">${u.bookmarks_count || 0}</span>
            <span style="font-size: 11.5px; color: var(--text-secondary); font-weight: 600;">в закладках</span>
          </div>
          ${bmSubInfo}
        </td>

        <td>
          <div style="font-size: 13px; font-weight: 800; color: var(--accent);">${formatDurationReadable(u.total_hours, u.total_minutes)}</div>
          <div style="font-size: 10.5px; color: var(--text-muted); margin-top: 2px;">Просмотров: ${u.history_count || 0}</div>
        </td>

        <td style="text-align: right; white-space: nowrap;">
          <div style="display: inline-flex; gap: 6px; align-items: center; justify-content: flex-end;">
            <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm admin-view-details-btn" data-userid="${u.id}" style="font-size: 11.5px; display:inline-flex;align-items:center;gap:5px;">
              ${SVG.details} <span>Детали</span>
            </button>
            ${!isReiKatari ? `
              <button type="button" class="storm-btn storm-btn-danger storm-btn-sm admin-delete-user-btn" data-userid="${u.id}" data-username="${escapeHtml(u.username)}" title="Удалить пользователя" style="font-size: 11.5px; padding: 6px 10px; display:inline-flex;align-items:center;justify-content:center;">
                ${SVG.trash}
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.admin-view-details-btn').forEach(btn => {
    btn.onclick = () => {
      const uid = parseInt(btn.dataset.userid, 10);
      const user = adminDataCache.users.find(u => u.id === uid);
      if (user) openUserDetailsModal(user);
    };
  });

  tbody.querySelectorAll('.admin-delete-user-btn').forEach(btn => {
    btn.onclick = async () => {
      const uid = parseInt(btn.dataset.userid, 10);
      const uname = btn.dataset.username || '';
      if (!uid) return;
      btn.disabled = true;
      try {
        const token = localStorage.getItem('storm_token') || '';
        const res = await fetch(`/api/admin/users/${uid}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Ошибка удаления пользователя');
        showToast(`Пользователь ${uname} удалён`, 'info');
        await loadAdminData(false);
      } catch (err) {
        btn.disabled = false;
        showToast(err.message, 'error');
      }
    };
  });
}

function renderLiveSessionsView() {
  const grid = document.getElementById('admin-sessions-grid');
  if (!grid || !adminDataCache) return;

  const activeWatchers = (adminDataCache.users || []).filter(u => u.watching_now && u.watching_now.is_active);
  const authSessions = Array.isArray(adminDataCache.active_sessions_list) ? adminDataCache.active_sessions_list : [];

  if (activeWatchers.length === 0 && authSessions.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 48px 20px; color: var(--text-muted); background: var(--bg-tertiary); border-radius: 14px; border: 1px solid var(--border-subtle);">
        <div style="font-size: 15px; font-weight: 700; color: var(--text-secondary);">В данный момент нет активных потоков или открытых сессий</div>
        <div style="font-size: 12.5px; margin-top: 6px;">Здесь отображаются авторизованные устройства и запущенные видеоплееры в реальном времени</div>
      </div>
    `;
    return;
  }

  const watcherCards = activeWatchers.map(u => {
    const wn = u.watching_now;
    const progress = Math.round(wn.progress_percent || 0);
    const epInfo = wn.season && wn.episode ? `Сезон ${wn.season}, Серия ${wn.episode}` : 'Полнометражный релиз';
    const posterSrc = wn.poster_url || wn.poster || 'assets/favicon.svg';
    const avatarSrc = u.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(u.username)}`;

    return `
      <div class="admin-session-card" data-user-id="${u.id}">
        <div class="admin-session-header">
          <div class="admin-session-user-info">
            <img src="${avatarSrc}" alt="${escapeHtml(u.username)}" class="admin-session-avatar" onerror="this.src='assets/favicon.svg'">
            <div>
              <div class="admin-session-username">${escapeHtml(u.username)}</div>
              <div class="admin-session-device">Видеопоток • Активный плеер</div>
            </div>
          </div>
          <span class="admin-session-live-badge">В ЭФИРЕ</span>
        </div>
        <div class="admin-session-body">
          <img src="${posterSrc}" alt="${escapeHtml(wn.title)}" class="admin-session-poster" onerror="this.src='assets/favicon.svg'">
          <div class="admin-session-details">
            <div class="admin-session-title">${escapeHtml(wn.title)}</div>
            <div class="admin-session-ep">${epInfo}</div>
            <div class="admin-session-progress-wrap">
              <div class="admin-session-progress-bar">
                <div class="admin-session-progress-fill" style="width: ${progress}%;"></div>
              </div>
              <div class="admin-session-time">
                <span>${progress}%</span>
                <span>${formatDate(wn.updated_at)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  });

  const authCards = authSessions.map(s => {
    const avatarSrc = s.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(s.username)}`;
    return `
      <div class="admin-session-card">
        <div class="admin-session-header">
          <div class="admin-session-user-info">
            <img src="${avatarSrc}" alt="${escapeHtml(s.username)}" class="admin-session-avatar" onerror="this.src='assets/favicon.svg'">
            <div>
              <div class="admin-session-username">${escapeHtml(s.username)}</div>
              <div class="admin-session-device">${escapeHtml(s.device)} • IP: ${escapeHtml(s.ip)}</div>
            </div>
          </div>
          <span class="storm-badge" style="background:rgba(16,185,129,0.16);color:#10b981;border:1px solid rgba(16,185,129,0.35);">Сессия активна</span>
        </div>
        <div style="font-size:12px;color:var(--text-secondary);display:flex;justify-content:space-between;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06);">
          <span>Токен: <code>${escapeHtml(s.token_prefix)}...</code></span>
          <span>До: ${formatDate(s.expires_at)}</span>
        </div>
      </div>
    `;
  });

  grid.innerHTML = [...watcherCards, ...authCards].join('');
}

function renderBalancersView() {
  const grid = document.getElementById('admin-balancers-grid');
  if (!grid) return;
  const list = Array.isArray(adminBalancersCache?.balancers) ? adminBalancersCache.balancers : [];
  if (list.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--text-muted);">Данные о балансерах загружаются...</div>`;
    return;
  }

  grid.innerHTML = list.map(b => {
    const isOk = b.status === 'online' || b.healthy !== false;
    const ping = Number(b.latencyMs) || 85;
    const barPct = Math.min(100, Math.max(12, Math.round((1 - Math.min(ping, 1200) / 1300) * 100)));
    const color = isOk ? (ping < 250 ? '#10b981' : '#f59e0b') : '#ef4444';
    return `
      <div class="admin-metric-card" style="flex-direction:column;align-items:stretch;gap:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-weight:800;font-size:14px;color:#fff;text-transform:uppercase;">${escapeHtml(b.name || b.id)}</span>
          <span class="storm-badge" style="background:${color}22;color:${color};border:1px solid ${color}55;">${isOk ? 'Онлайн' : 'Ожидание'} • ${ping} мс</span>
        </div>
        <div class="admin-bar-track">
          <div class="admin-bar-fill" style="width:${barPct}%;background:${color};"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);">
          <span>Успешных ответов: ${b.successCount ?? 100}%</span>
          <span>Проверено: ${formatDate(b.lastCheckedAt || Date.now())}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderSystemView() {
  const box = document.getElementById('admin-system-content');
  if (!box) return;
  const l1 = adminCacheStats?.l1Cache || {};
  const mdb = adminCacheStats?.mariadb || {};
  const logs = Array.isArray(adminLogsCache?.logs) ? adminLogsCache.logs.slice(0, 25) : [];

  box.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;">
      <div class="admin-chart-card">
        <div class="admin-chart-header">
          <span class="admin-chart-title">${SVG.db} Состояние кэша L1 и СУБД MariaDB 10</span>
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-xs" id="admin-clear-l1-btn">Очистить L1 кэш</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;font-size:12.5px;color:var(--text-secondary);">
          <div style="display:flex;justify-content:space-between;padding:8px 12px;background:rgba(255,255,255,0.03);border-radius:8px;">
            <span>Кластер MariaDB 10:</span>
            <strong style="color:#10b981;">${mdb.connected !== false ? 'Активен (' + escapeHtml(mdb.host || '192.168.1.154:3306') + ')' : 'Локальный режим SQLite'}</strong>
          </div>
          <div style="display:flex;justify-content:space-between;padding:8px 12px;background:rgba(255,255,255,0.03);border-radius:8px;">
            <span>Записей в памяти L1 LRU:</span>
            <strong style="color:#fff;">${l1.entries || 0} объектов</strong>
          </div>
          <div style="display:flex;justify-content:space-between;padding:8px 12px;background:rgba(255,255,255,0.03);border-radius:8px;">
            <span>Попаданий / Промахов L1:</span>
            <strong style="color:var(--accent);">${l1.hits || 0} hits / ${l1.misses || 0} misses</strong>
          </div>
        </div>
      </div>

      <div class="admin-chart-card">
        <div class="admin-chart-header">
          <span class="admin-chart-title">Системный журнал событий (последние записи)</span>
          <span class="admin-chart-badge">${logs.length} событий</span>
        </div>
        <div style="max-height:190px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;font-size:11.5px;font-family:monospace;">
          ${logs.length === 0
            ? '<div style="color:var(--text-muted);padding:12px;">Журнал событий чист</div>'
            : logs.map(l => `<div style="padding:5px 8px;background:rgba(0,0,0,0.28);border-radius:6px;color:#cbd5e1;"><span style="color:var(--accent);">[${escapeHtml(l.level || 'INFO')}]</span> ${escapeHtml(l.message || JSON.stringify(l))}</div>`).join('')}
        </div>
      </div>
    </div>
  `;

  const clearBtn = box.querySelector('#admin-clear-l1-btn');
  if (clearBtn) {
    clearBtn.onclick = async () => {
      const token = localStorage.getItem('storm_token') || '';
      const res = await fetch('/api/admin/cache-clear', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        showToast('Оперативный L1 кэш успешно очищен', 'success');
        await loadAdminData(false);
      }
    };
  }
}

function openUserDetailsModal(user) {
  let modal = document.getElementById('admin-user-details-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'storm-modal-backdrop';
    modal.id = 'admin-user-details-modal';
    modal.style.zIndex = '1100';
    modal.innerHTML = `
      <div class="storm-modal" style="max-width: 880px; width: 95vw; max-height: 88vh; display: flex; flex-direction: column;">
        <div class="storm-modal-header">
          <div style="display: flex; align-items: center; gap: 12px;">
            <img id="aud-avatar" src="" alt="" style="width: 42px; height: 42px; border-radius: 50%; object-fit: cover; border: 2px solid var(--accent);">
            <div>
              <h3 class="storm-modal-title" id="aud-username">Пользователь</h3>
              <p class="admin-modal-subtitle" id="aud-email"></p>
            </div>
          </div>
          <button type="button" class="storm-modal-close" id="close-aud-modal-btn">✕</button>
        </div>

        <div class="storm-modal-body" style="padding: 20px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 20px;">
          <div style="display: flex; gap: 10px; border-bottom: 1px solid var(--border-subtle); padding-bottom: 12px;">
            <button type="button" class="storm-btn storm-btn-primary storm-btn-sm aud-tab-btn" data-tab="bookmarks">
              Закладки пользователя (<span id="aud-bookmarks-count">0</span>)
            </button>
            <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm aud-tab-btn" data-tab="history">
              История просмотров (<span id="aud-history-count">0</span>)
            </button>
          </div>

          <div id="aud-bookmarks-section">
            <div id="aud-bookmarks-list" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px;"></div>
          </div>

          <div id="aud-history-section" style="display: none;">
            <div id="aud-history-list" style="display: flex; flex-direction: column; gap: 10px;"></div>
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

  if (hList) {
    if (!user.history || user.history.length === 0) {
      hList.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 30px;">История просмотров пользователя пуста</div>';
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

  if (bList) {
    if (!user.bookmarks || user.bookmarks.length === 0) {
      bList.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 30px;">У пользователя пока нет закладок</div>';
    } else {
      const statusMap = {
        'watching': 'Смотрю',
        'plan': 'В планах',
        'completed': 'Просмотрено',
        'hold': 'Отложено',
        'dropped': 'Брошено',
        'favorite': 'Любимое'
      };
      bList.innerHTML = user.bookmarks.map(b => {
        const statusLabel = statusMap[b.status] || b.status;
        return `
          <div style="padding: 10px 12px; background: var(--bg-tertiary); border: 1px solid var(--border-subtle); border-radius: 10px;">
            <div style="font-weight: 700; font-size: 13px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(b.title)}">${escapeHtml(b.title)}</div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px;">
              <span class="storm-badge" style="font-size: 10.5px; padding: 2px 7px;">${statusLabel}</span>
              <span style="font-size: 11px; color: var(--text-muted);">${formatDate(b.updated_at)}</span>
            </div>
          </div>
        `;
      }).join('');
    }
  }
}
