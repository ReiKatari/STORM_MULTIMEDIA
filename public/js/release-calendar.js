/* ==========================================================================
   STORM MULTIMEDIA - КАЛЕНДАРЬ РЕЛИЗОВ И РАСПИСАНИЕ СЕРИЙ
   Актуальное расписание выхода эпизодов и премьер
   с переключением недель, фильтрами, реальными обложками и студиями
   ========================================================================== */

import { showToast } from './auth.js';
import { openPlayerModal } from './player.js';

let selectedWeek = 'current'; // 'current' | 'next'
let selectedDay = new Date().getDay(); // 0=ВС, 1=ПН, 2=ВТ...
let activeCategoryFilter = 'all'; // 'all' | 'series' | 'anime' | 'movies'
let currentViewMode = 'list'; // 'list' | 'epg'

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function openLiveTvEpgModal() {
  currentViewMode = 'epg';
  openReleaseCalendarModal();
}

export function wrapPosterUrl(url, title = '') {
  if (!url) return 'assets/favicon.svg';
  if (url.startsWith('/api/media/image-proxy') || url.startsWith('assets/')) return url;
  return `/api/media/image-proxy?url=${encodeURIComponent(url)}${title ? `&title=${encodeURIComponent(title)}` : ''}`;
}

/**
 * Динамический расчет дней недели на основе текущей даты пользователя
 * @param {number} weekOffset 0 для текущей недели, 1 для следующей
 */
export function getWeekDays(weekOffset = 0) {
  const now = new Date();
  const day = now.getDay();
  // В JS 0 = Воскресенье. Пересчитываем так, чтобы понедельник был первым днем (offset 0)
  const diffToMonday = (day === 0 ? -6 : 1) - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday + (weekOffset * 7));
  monday.setHours(0, 0, 0, 0);

  const dayNames = [
    { id: 1, name: 'Понедельник', short: 'ПН' },
    { id: 2, name: 'Вторник', short: 'ВТ' },
    { id: 3, name: 'Среда', short: 'СР' },
    { id: 4, name: 'Четверг', short: 'ЧТ' },
    { id: 5, name: 'Пятница', short: 'ПТ' },
    { id: 6, name: 'Суббота', short: 'СБ' },
    { id: 0, name: 'Воскресенье', short: 'ВС' }
  ];

  return dayNames.map((d, i) => {
    const curDate = new Date(monday);
    curDate.setDate(monday.getDate() + i);
    const dateFormatted = `${String(curDate.getDate()).padStart(2, '0')}.${String(curDate.getMonth() + 1).padStart(2, '0')}`;
    const fullDate = `${String(curDate.getDate()).padStart(2, '0')}.${String(curDate.getMonth() + 1).padStart(2, '0')}.${curDate.getFullYear()}`;
    return {
      ...d,
      date: dateFormatted,
      fullDate,
      timestamp: curDate.getTime()
    };
  });
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
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">Выход новых эпизодов и премьер в оригинале и студийном дубляже</div>
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

  const currentDayIndex = new Date().getDay();
  selectedDay = currentDayIndex;

  const curWeekDays = getWeekDays(0);
  const nxtWeekDays = getWeekDays(1);

  container.innerHTML = `
    <!-- Переключатель недель и фильтры категорий -->
    <div style="display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <div class="cal-week-switcher" style="margin-bottom: 0;">
        <button type="button" class="cal-week-btn ${selectedWeek === 'current' ? 'active' : ''}" data-week="current">
          <span class="cal-week-icon">🗓️</span>
          <span>Текущая неделя (${curWeekDays[0].date} — ${curWeekDays[6].date})</span>
        </button>
        <button type="button" class="cal-week-btn ${selectedWeek === 'next' ? 'active' : ''}" data-week="next">
          <span class="cal-week-icon">⏭️</span>
          <span>Следующая неделя (${nxtWeekDays[0].date} — ${nxtWeekDays[6].date})</span>
        </button>
      </div>

      <!-- Фильтр категорий -->
      <div class="cal-category-filters" style="display: flex; gap: 6px;">
        <button type="button" class="storm-btn storm-btn-sm ${activeCategoryFilter === 'all' ? 'storm-btn-primary' : 'storm-btn-secondary'}" data-filter="all">Все</button>
        <button type="button" class="storm-btn storm-btn-sm ${activeCategoryFilter === 'series' ? 'storm-btn-primary' : 'storm-btn-secondary'}" data-filter="series">Сериалы</button>
        <button type="button" class="storm-btn storm-btn-sm ${activeCategoryFilter === 'anime' ? 'storm-btn-primary' : 'storm-btn-secondary'}" data-filter="anime">Аниме</button>
        <button type="button" class="storm-btn storm-btn-sm ${activeCategoryFilter === 'movies' ? 'storm-btn-primary' : 'storm-btn-secondary'}" data-filter="movies">Премьеры</button>
      </div>
      <!-- Режим отображения: Карточки / Сетка EPG -->
      <div class="cal-view-modes" style="display: flex; gap: 6px;">
        <button type="button" class="storm-btn storm-btn-sm ${currentViewMode === 'list' ? 'storm-btn-primary' : 'storm-btn-secondary'}" id="cal-mode-list-btn" title="Отображение в виде карточек">
          📅 Карточки
        </button>
        <button type="button" class="storm-btn storm-btn-sm ${currentViewMode === 'epg' ? 'storm-btn-primary' : 'storm-btn-secondary'}" id="cal-mode-epg-btn" title="Сетка телепередач и каналов (EPG Guide)">
          📺 Сетка эфира (EPG)
        </button>
      </div>
    </div>

    <!-- Навигационная панель дней выбранной недели -->
    <div class="cal-days-navbar" id="cal-days-navbar"></div>

    <!-- Контейнер карточек эпизодов или EPG сетки -->
    <div id="calendar-day-items-grid" class="cal-items-grid"></div>
  `;

  // Переключение режимов отображения (Карточки / Сетка EPG)
  const modeListBtn = container.querySelector('#cal-mode-list-btn');
  const modeEpgBtn = container.querySelector('#cal-mode-epg-btn');
  if (modeListBtn && modeEpgBtn) {
    modeListBtn.onclick = () => {
      currentViewMode = 'list';
      modeListBtn.className = 'storm-btn storm-btn-sm storm-btn-primary';
      modeEpgBtn.className = 'storm-btn storm-btn-sm storm-btn-secondary';
      loadAndRenderWeek(container);
    };
    modeEpgBtn.onclick = () => {
      currentViewMode = 'epg';
      modeListBtn.className = 'storm-btn storm-btn-sm storm-btn-secondary';
      modeEpgBtn.className = 'storm-btn storm-btn-sm storm-btn-primary';
      loadAndRenderWeek(container);
    };
  }

  // Переключение недель
  const weekBtns = container.querySelectorAll('.cal-week-btn');
  weekBtns.forEach(btn => {
    btn.onclick = () => {
      selectedWeek = btn.dataset.week;
      weekBtns.forEach(b => b.classList.toggle('active', b.dataset.week === selectedWeek));
      loadAndRenderWeek(container);
    };
  });

  // Фильтрация категорий
  const filterBtns = container.querySelectorAll('.cal-category-filters button');
  filterBtns.forEach(btn => {
    btn.onclick = () => {
      activeCategoryFilter = btn.dataset.filter;
      filterBtns.forEach(b => {
        b.classList.toggle('storm-btn-primary', b.dataset.filter === activeCategoryFilter);
        b.classList.toggle('storm-btn-secondary', b.dataset.filter !== activeCategoryFilter);
      });
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
      <span style="font-size: 13px;">Синхронизация живого календаря релизов...</span>
    </div>
  `;

  const daysConfig = selectedWeek === 'next' ? getWeekDays(1) : getWeekDays(0);
  let scheduleItems = [];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);

    const [calRes, schedRes] = await Promise.allSettled([
      fetch('/api/media/calendar', { signal: controller.signal }),
      fetch(`/api/media/schedule?week=${selectedWeek}`, { signal: controller.signal })
    ]);
    clearTimeout(timeout);

    const combined = [];
    const seenTitles = new Set();

    if (calRes.status === 'fulfilled' && calRes.value.ok) {
      const calData = await calRes.value.json();
      if (Array.isArray(calData.schedule)) {
        calData.schedule.forEach(it => {
          const key = (it.title || '').toLowerCase().trim();
          if (key && !seenTitles.has(key)) {
            seenTitles.add(key);
            combined.push(it);
          }
        });
      }
    }

    if (schedRes.status === 'fulfilled' && schedRes.value.ok) {
      const schedData = await schedRes.value.json();
      if (Array.isArray(schedData.items)) {
        schedData.items.forEach(it => {
          const key = (it.title || '').toLowerCase().trim();
          if (key && !seenTitles.has(key)) {
            seenTitles.add(key);
            combined.push(it);
          }
        });
      }
    }

    if (combined.length > 0) {
      scheduleItems = combined;
      try {
        localStorage.setItem(`storm_cal_${selectedWeek}`, JSON.stringify(combined));
      } catch {}
    }
  } catch (err) {
    console.warn('Ошибка сети при загрузке расписания, используем локальный кэш:', err);
  }

  // 1. Проверяем локальный кэш, если запрос не удался
  if (!scheduleItems || scheduleItems.length === 0) {
    try {
      const localCached = localStorage.getItem(`storm_cal_${selectedWeek}`);
      if (localCached) {
        const parsed = JSON.parse(localCached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          scheduleItems = parsed;
        }
      }
    } catch {}
  }

  // 2. Применяем фильтр категории
  let filteredItems = scheduleItems;
  if (activeCategoryFilter === 'series') {
    filteredItems = scheduleItems.filter(it => it.media_type === 'series' || (it.episode && it.episode > 0 && !it.genres?.includes('Аниме')));
  } else if (activeCategoryFilter === 'anime') {
    filteredItems = scheduleItems.filter(it => it.media_type?.includes('anime') || it.source === 'shikimori' || it.genres?.includes('Аниме') || it.studio?.includes('AniLibria'));
  } else if (activeCategoryFilter === 'movies') {
    filteredItems = scheduleItems.filter(it => it.media_type === 'movie' || it.episode_title?.includes('премьера') || it.genres?.includes('Кинопремьера'));
  }

  const currentDayIndex = new Date().getDay();

  // Группируем элементы по дням недели
  const dayGroups = {};
  daysConfig.forEach(d => { dayGroups[d.id] = []; });

  filteredItems.forEach(it => {
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
      renderActiveDayView(grid, dayGroups[selectedDay], selectedDay, selectedWeek);
    };
  });

  renderActiveDayView(grid, dayGroups[selectedDay], selectedDay, selectedWeek);
}

function renderActiveDayView(grid, items, dayId, week) {
  if (currentViewMode === 'epg') {
    grid.className = 'cal-epg-container';
    renderEpgMatrixGuide(grid, items, dayId, week);
  } else {
    grid.className = 'cal-items-grid';
    renderDayGrid(grid, items, dayId, week);
  }
}

function renderEpgMatrixGuide(grid, items, dayId, week) {
  if (!items || items.length === 0) {
    grid.innerHTML = `
      <div style="text-align: center; padding: 48px 20px; color: var(--text-muted);">
        <div style="font-size: 32px; margin-bottom: 8px;">📺</div>
        <div style="font-size: 14px; font-weight: 600;">В этот день трансляций не запланировано</div>
      </div>
    `;
    return;
  }

  const timeSlots = ['17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00'];
  const studios = ['AniLibria', 'LostFilm', 'Red Head Sound', 'HDRezka Studio', 'TVShows', 'Apple TV+'];

  grid.innerHTML = `
    <div class="epg-matrix-table-wrap">
      <div class="epg-matrix-timeline-header">
        <div class="epg-channel-header-cell">Канал / Студия</div>
        <div class="epg-times-ruler">
          ${timeSlots.map(t => `<div class="epg-time-tick"><span>${t}</span></div>`).join('')}
        </div>
      </div>

      <div class="epg-matrix-channels-body">
        ${studios.map(studio => {
          const studioItems = items.filter(it => (it.studio && it.studio.toLowerCase().includes(studio.toLowerCase())) || (!it.studio && studio === 'LostFilm'));
          return `
            <div class="epg-matrix-row">
              <div class="epg-matrix-channel-info">
                <span class="epg-studio-badge">${escapeHtml(studio)}</span>
              </div>
              <div class="epg-matrix-shows-track">
                ${studioItems.length > 0 ? studioItems.map(it => {
                  const posterUrl = wrapPosterUrl(it.poster, it.title);
                  return `
                    <div class="epg-show-card" data-id="${it.id}" title="${escapeHtml(it.title)}: ${it.air_time || '20:00 МСК'}">
                      <img src="${posterUrl}" class="epg-show-thumb" alt="${escapeHtml(it.title)}" onerror="this.src='assets/favicon.svg'">
                      <div class="epg-show-meta">
                        <div class="epg-show-time">${it.air_time || '20:00 МСК'}</div>
                        <div class="epg-show-title">${escapeHtml(it.title)}</div>
                        <div class="epg-show-ep">S${it.season || 1}:E${it.episode || 1}</div>
                      </div>
                    </div>
                  `;
                }).join('') : '<div class="epg-no-shows-slot">Нет эфира в этот день</div>'}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;

  grid.querySelectorAll('.epg-show-card').forEach(card => {
    card.onclick = () => {
      const itId = card.dataset.id;
      const it = items.find(x => String(x.id) === String(itId));
      if (it) {
        openPlayerModal({
          id: it.id,
          title: it.title,
          original_title: it.original_title || '',
          poster: it.poster,
          year: it.year,
          source: it.source || 'fanfilm4k',
          media_type: it.media_type || 'series'
        }, {
          initialSeason: it.season || 1,
          initialEpisode: it.episode || 1
        });
      }
    };
  });
}

function renderDayGrid(grid, items, dayId, week) {
  if (!items || items.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 48px 20px; color: var(--text-muted);">
        <div style="font-size: 32px; margin-bottom: 8px;">🎬</div>
        <div style="font-size: 14px; font-weight: 600;">В этот день релизов по выбранному фильтру не запланировано</div>
        <div style="font-size: 12px; margin-top: 4px;">Выберите другой день недели или категорию «Все»</div>
      </div>
    `;
    return;
  }

  const currentDayIndex = new Date().getDay();
  grid.innerHTML = items.map(it => {
    const season = it.season || 1;
    const episode = it.episode || 1;
    const is4K = Boolean(it.is4K || it.quality?.includes('4K'));
    const posterUrl = wrapPosterUrl(it.poster, it.title);

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

    const isMovie = it.media_type === 'movie' || it.episode_title === 'Мировая премьера';
    const epBadge = isMovie ? 'Премьера' : `S${season} • E${episode}`;
    const epLabel = isMovie ? (it.genres || 'Мировая премьера') : `Сезон ${season}, Серия ${episode}${it.episode_title ? ` • «${escapeHtml(it.episode_title)}»` : ''}`;

    return `
      <div class="cal-card storm-card" data-id="${it.id}">
        <!-- Постер с обложкой релиза -->
        <div class="cal-poster-wrap">
          <img src="${posterUrl}" class="cal-poster-img" alt="${escapeHtml(it.title)}" loading="lazy" onerror="this.src='assets/favicon.svg'">
          <span class="cal-poster-ep-badge">${epBadge}</span>
          ${is4K ? '<span class="cal-poster-4k-badge">4K UHD</span>' : ''}
        </div>

        <!-- Информация об эпизоде -->
        <div class="cal-info-wrap">
          <div class="cal-header-zone">
            <h4 class="cal-card-title" title="${escapeHtml(it.title)}">${escapeHtml(it.title)}</h4>
            <div class="cal-ep-indicator ${statusClass}">
              <span class="cal-ep-name">${epLabel}</span>
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
              ${isMovie ? '▶ Смотреть фильм' : `▶ Смотреть S${season}:E${episode}`}
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
        media_type: it.media_type || 'series'
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
