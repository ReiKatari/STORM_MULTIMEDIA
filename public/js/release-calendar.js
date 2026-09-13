/* ==========================================================================
   STORM MULTIMEDIA - КАЛЕНДАРЬ РЕЛИЗОВ И РАСПИСАНИЕ СЕРИЙ
   Интерактивное расписание выхода эпизодов 2026 года на 2 недели
   с переключением, реальными обложками и студиями озвучки
   ========================================================================== */

import { showToast } from './auth.js';
import { openPlayerModal } from './player.js';

const CURRENT_WEEK_DAYS = [
  { id: 1, name: 'Понедельник', short: 'ПН', date: '14.09' },
  { id: 2, name: 'Вторник', short: 'ВТ', date: '15.09' },
  { id: 3, name: 'Среда', short: 'СР', date: '16.09' },
  { id: 4, name: 'Четверг', short: 'ЧТ', date: '17.09' },
  { id: 5, name: 'Пятница', short: 'ПТ', date: '18.09' },
  { id: 6, name: 'Суббота', short: 'СБ', date: '19.09' },
  { id: 0, name: 'Воскресенье', short: 'ВС', date: '20.09' }
];

const NEXT_WEEK_DAYS = [
  { id: 1, name: 'Понедельник', short: 'ПН', date: '21.09' },
  { id: 2, name: 'Вторник', short: 'ВТ', date: '22.09' },
  { id: 3, name: 'Среда', short: 'СР', date: '23.09' },
  { id: 4, name: 'Четверг', short: 'ЧТ', date: '24.09' },
  { id: 5, name: 'Пятница', short: 'ПТ', date: '25.09' },
  { id: 6, name: 'Суббота', short: 'СБ', date: '26.09' },
  { id: 0, name: 'Воскресенье', short: 'ВС', date: '27.09' }
];

let selectedWeek = 'current'; // 'current' | 'next'
let selectedDay = 1; // 1=ПН, 2=ВТ, ..., 0=ВС

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function wrapPosterUrl(url) {
  if (!url) return 'assets/favicon.svg';
  if (url.startsWith('/api/media/image-proxy') || url.startsWith('assets/')) return url;
  return `/api/media/image-proxy?url=${encodeURIComponent(url)}`;
}

export async function openReleaseCalendarModal() {
  let modal = document.getElementById('release-calendar-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'storm-modal-backdrop';
    modal.id = 'release-calendar-modal';
    modal.innerHTML = `
      <div class="storm-modal release-calendar-modal-dialog">
        <div class="storm-modal-header" style="justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 24px;">📅</span>
            <div>
              <h3 style="margin: 0; font-size: 17px;">Календарь релизов и расписание серий</h3>
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">Выход новых эпизодов 2026 года в оригинале и студийном дубляже</div>
            </div>
          </div>
          <button type="button" class="storm-modal-close" id="calendar-modal-close-btn" title="Закрыть">✕</button>
        </div>
        <div class="storm-modal-body" id="release-calendar-body" style="padding: 16px 20px 24px;"></div>
      </div>
    `;
    document.body.appendChild(modal);

    const closeBtn = modal.querySelector('#calendar-modal-close-btn');
    if (closeBtn) closeBtn.onclick = () => modal.classList.remove('is-open');
    modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('is-open'); };
  }

  modal.classList.add('is-open');
  renderCalendarContent(document.getElementById('release-calendar-body'));
}

async function renderCalendarContent(container) {
  if (!container) return;

  const currentDayIndex = new Date().getDay(); // 0=ВС, 1=ПН...
  selectedDay = currentDayIndex;

  container.innerHTML = `
    <!-- Переключатель недель: Текущая и Следующая -->
    <div class="cal-week-switcher">
      <button type="button" class="cal-week-btn ${selectedWeek === 'current' ? 'active' : ''}" data-week="current">
        <span class="cal-week-icon">🗓️</span>
        <span>Текущая неделя (14.09 — 20.09.2026)</span>
      </button>
      <button type="button" class="cal-week-btn ${selectedWeek === 'next' ? 'active' : ''}" data-week="next">
        <span class="cal-week-icon">⏭️</span>
        <span>Следующая неделя (21.09 — 27.09.2026)</span>
      </button>
    </div>

    <!-- Навигационная панель дней выбранной недели -->
    <div class="cal-days-navbar" id="cal-days-navbar"></div>

    <!-- Контейнер карточек эпизодов -->
    <div id="calendar-day-items-grid" class="cal-items-grid"></div>
  `;

  // Обработчик переключения недель
  const weekBtns = container.querySelectorAll('.cal-week-btn');
  weekBtns.forEach(btn => {
    btn.onclick = () => {
      selectedWeek = btn.dataset.week;
      weekBtns.forEach(b => b.classList.toggle('active', b.dataset.week === selectedWeek));
      loadAndRenderWeek(container);
    };
  });

  await loadAndRenderWeek(container);
}

async function loadAndRenderWeek(container) {
  const daysNav = container.querySelector('#cal-days-navbar');
  const grid = container.querySelector('#calendar-day-items-grid');
  if (!daysNav || !grid) return;

  grid.innerHTML = `
    <div style="grid-column: 1 / -1; text-align: center; padding: 40px 20px; color: var(--text-muted); display: flex; align-items: center; justify-content: center; gap: 10px;">
      <div class="storm-spinner"></div>
      <span style="font-size: 13px;">Синхронизация расписания релизов 2026...</span>
    </div>
  `;

  let scheduleItems = [];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`/api/media/schedule?week=${selectedWeek}`, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      scheduleItems = data.items || [];
    }
  } catch (err) {
    console.warn('Ошибка сети при загрузке расписания, используем автономный каталог 2026:', err);
  }

  scheduleItems = scheduleItems || [];

  const daysConfig = selectedWeek === 'next' ? NEXT_WEEK_DAYS : CURRENT_WEEK_DAYS;
  const currentDayIndex = new Date().getDay();

  // Группируем элементы по дням недели
  const dayGroups = {};
  daysConfig.forEach(d => { dayGroups[d.id] = []; });

  scheduleItems.forEach(it => {
    const rawDay = it.day_of_week !== undefined ? it.day_of_week : it.day;
    const dayId = (rawDay !== undefined && !isNaN(parseInt(rawDay, 10))) ? parseInt(rawDay, 10) : 1;
    if (dayGroups[dayId]) {
      dayGroups[dayId].push(it);
    }
  });

  // Рендерим панель дней с датами
  daysNav.innerHTML = daysConfig.map(d => {
    const isToday = selectedWeek === 'current' && d.id === currentDayIndex;
    const isAct = d.id === selectedDay;
    const count = dayGroups[d.id]?.length || 0;
    return `
      <button type="button" class="cal-day-pill ${isAct ? 'active' : ''} ${isToday ? 'is-today' : ''}" data-day="${d.id}">
        <div class="cal-day-pill-content">
          <span class="cal-day-full-name">${d.name} (${d.date})</span>
          <span class="cal-day-short-name">${d.short} ${d.date}</span>
          <span class="cal-day-count-badge">${count}</span>
        </div>
        ${isToday ? '<span class="cal-day-today-tag">Сегодня</span>' : ''}
      </button>
    `;
  }).join('');

  // Обработчики кликов по дням
  daysNav.querySelectorAll('.cal-day-pill').forEach(btn => {
    btn.onclick = () => {
      selectedDay = parseInt(btn.dataset.day, 10);
      daysNav.querySelectorAll('.cal-day-pill').forEach(b => b.classList.toggle('active', parseInt(b.dataset.day, 10) === selectedDay));
      renderDayGrid(grid, dayGroups[selectedDay], selectedDay, selectedWeek);
    };
  });

  renderDayGrid(grid, dayGroups[selectedDay], selectedDay, selectedWeek);
}

function renderDayGrid(grid, items, dayId, week) {
  if (!items || items.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 48px 20px; color: var(--text-muted);">
        <div style="font-size: 32px; margin-bottom: 8px;">🎬</div>
        <div style="font-size: 14px; font-weight: 600;">В этот день новых серий не запланировано</div>
        <div style="font-size: 12px; margin-top: 4px;">Выберите другой день недели для просмотра расписания</div>
      </div>
    `;
    return;
  }

  const currentDayIndex = new Date().getDay();
  grid.innerHTML = items.map(it => {
    const season = it.season || 1;
    const episode = it.episode || 1;
    const is4K = Boolean(it.is4K || it.quality?.includes('4K'));
    const posterUrl = wrapPosterUrl(it.poster);

    let statusText = `📅 ${it.release_date || ''} в ${it.air_time || '20:00 МСК'}`;
    let statusClass = 'upcoming';

    if (week === 'current') {
      if (dayId === currentDayIndex) {
        statusText = `🔴 Сегодня в ${it.air_time || '20:00 МСК'}`;
        statusClass = 'today';
      } else {
        const normDay = dayId === 0 ? 7 : dayId;
        const normCur = currentDayIndex === 0 ? 7 : currentDayIndex;
        if (normDay < normCur) {
          statusText = `✅ Вышла на этой неделе`;
          statusClass = 'released';
        }
      }
    }

    return `
      <div class="cal-card storm-card" data-id="${it.id}">
        <!-- Постер с обложкой релиза -->
        <div class="cal-poster-wrap">
          <img src="${posterUrl}" class="cal-poster-img" alt="${escapeHtml(it.title)}" loading="lazy" onerror="this.src='assets/favicon.svg'">
          <span class="cal-poster-ep-badge">S${season} • E${episode}</span>
          ${is4K ? '<span class="cal-poster-4k-badge">4K</span>' : ''}
        </div>

        <!-- Информация об эпизоде -->
        <div class="cal-info-wrap">
          <div class="cal-header-zone">
            <h4 class="cal-card-title" title="${escapeHtml(it.title)}">${escapeHtml(it.title)}</h4>
            <div class="cal-ep-indicator ${statusClass}">
              <span class="cal-ep-name">Сезон ${season}, Серия ${episode}${it.episode_title ? ` • «${escapeHtml(it.episode_title)}»` : ''}</span>
              <span class="cal-time-pill">${statusText}</span>
            </div>
          </div>

          <!-- Метаданные: Студия, Качество, Рейтинг -->
          <div class="cal-meta-badges">
            <span class="cal-meta-badge cal-badge-year">${it.year || '2026'}</span>
            ${it.studio ? `<span class="cal-meta-badge cal-badge-studio">🎙️ ${escapeHtml(it.studio)}</span>` : ''}
            ${it.rating ? `<span class="cal-meta-badge cal-badge-rating">★ ${it.rating}</span>` : ''}
            ${it.quality ? `<span class="cal-meta-badge cal-badge-quality">${it.quality}</span>` : ''}
          </div>

          <!-- Кнопка запуска -->
          <div class="cal-actions-row">
            <button type="button" class="storm-btn storm-btn-primary cal-watch-btn" data-id="${it.id}" style="flex: 1; padding: 6px 12px; font-size: 12px;">
              ▶ Смотреть S${season}:E${episode}
            </button>
            <button type="button" class="storm-btn storm-btn-secondary cal-notify-btn" title="Напомнить о выходе" style="padding: 6px 10px;">
              🔔
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Привязка кликов по карточкам и кнопкам
  grid.querySelectorAll('.cal-card').forEach(card => {
    const itId = card.dataset.id;
    const it = items.find(x => String(x.id) === String(itId));
    if (!it) return;

    const playBtn = card.querySelector('.cal-watch-btn');
    const notifyBtn = card.querySelector('.cal-notify-btn');

    const startWatching = () => {
      openPlayerModal({
        id: it.id,
        title: it.title,
        original_title: it.original_title || '',
        poster: it.poster,
        year: it.year,
        source: it.source || 'fanfilm4k',
        media_type: 'series'
      }, {
        initialSeason: it.season || 1,
        initialEpisode: it.episode || 1
      });
    };

    if (playBtn) playBtn.onclick = (e) => { e.stopPropagation(); startWatching(); };
    if (notifyBtn) notifyBtn.onclick = (e) => {
      e.stopPropagation();
      showToast(`Напоминание для «${it.title}» добавлено`, 'success');
    };
    card.onclick = () => startWatching();
  });
}
