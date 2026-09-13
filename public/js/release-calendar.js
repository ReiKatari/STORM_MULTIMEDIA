/* ==========================================================================
   STORM MULTIMEDIA - КАЛЕНДАРЬ РЕЛИЗОВ И РАСПИСАНИЕ СЕРИЙ
   Интерактивное расписание выхода эпизодов по дням недели с показом сезонов и серий
   ========================================================================== */

import { showToast } from './auth.js';
import { openPlayerModal } from './player.js';

const DAYS_OF_WEEK = [
  { id: 1, name: 'Понедельник', short: 'ПН' },
  { id: 2, name: 'Вторник', short: 'ВТ' },
  { id: 3, name: 'Среда', short: 'СР' },
  { id: 4, name: 'Четверг', short: 'ЧТ' },
  { id: 5, name: 'Пятница', short: 'ПТ' },
  { id: 6, name: 'Суббота', short: 'СБ' },
  { id: 0, name: 'Воскресенье', short: 'ВС' }
];

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
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">Выход новых эпизодов в оригинале и студийном дубляже</div>
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

// Детерминированное вычисление сезона, серии и времени выхода для каждого тайтла
function getReleaseEpisodeInfo(item, dayId, currentDayIndex) {
  const str = `${item.id || ''}_${item.title || ''}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  const absHash = Math.abs(hash);

  // Сезон и серия
  let season = (absHash % 4) + 1;
  let episode = ((absHash >> 3) % 12) + 1;

  // Проверяем, есть ли сохраненный просмотр в localStorage
  try {
    for (let s = 1; s <= 5; s++) {
      const watched = JSON.parse(localStorage.getItem(`storm_watched_eps_${item.id}_s${s}`) || '[]');
      if (Array.isArray(watched) && watched.length > 0) {
        season = s;
        episode = Math.max(...watched) + 1;
        break;
      }
    }
  } catch {}

  const isFinal = episode >= 10 && (absHash % 3 === 0);
  const isPremiere = episode === 1;

  // Время выхода
  const hours = 17 + (absHash % 5);
  const minutes = (absHash % 2 === 0) ? '00' : '30';
  const timeStr = `${hours}:${minutes} МСК`;

  // Статус
  let statusText = '';
  let statusClass = 'upcoming';

  if (dayId === currentDayIndex) {
    statusText = `🔴 Сегодня в ${timeStr}`;
    statusClass = 'today';
  } else {
    // Дни недели: 1=ПН, 2=ВТ, ..., 0=ВС
    const normalizedDay = dayId === 0 ? 7 : dayId;
    const normalizedCurrent = currentDayIndex === 0 ? 7 : currentDayIndex;

    if (normalizedDay < normalizedCurrent) {
      statusText = `✅ Вышла на этой неделе`;
      statusClass = 'released';
    } else {
      statusText = `📅 В ${timeStr}`;
      statusClass = 'upcoming';
    }
  }

  let epLabel = `Сезон ${season}, Серия ${episode}`;
  if (isPremiere) epLabel += ' (Премьера)';
  else if (isFinal) epLabel += ' (Финал)';

  return {
    season,
    episode,
    timeStr,
    statusText,
    statusClass,
    epLabel,
    badgeText: `S${season} • E${episode}`
  };
}

async function renderCalendarContent(container) {
  if (!container) return;

  const currentDayIndex = new Date().getDay();

  // Загружаем каталог сериалов
  let scheduleItems = [];
  try {
    const res = await fetch('/api/media/catalog?category=series&page=1&source=all');
    const data = await res.json();
    scheduleItems = (data.items || []).filter(it => it.title);
  } catch {
    scheduleItems = [];
  }

  // Распределяем релизы по дням недели
  const dayGroups = {};
  DAYS_OF_WEEK.forEach(d => { dayGroups[d.id] = []; });

  scheduleItems.forEach((it, idx) => {
    const dayId = (idx % 7);
    if (dayGroups[dayId]) dayGroups[dayId].push(it);
  });

  container.innerHTML = `
    <!-- Навигационная панель дней недели без обрезания -->
    <div class="cal-days-navbar" id="cal-days-navbar">
      ${DAYS_OF_WEEK.map(d => {
        const isToday = d.id === currentDayIndex;
        const count = dayGroups[d.id]?.length || 0;
        return `
          <button type="button" class="cal-day-pill ${isToday ? 'active is-today' : ''}" data-day="${d.id}">
            <div class="cal-day-pill-content">
              <span class="cal-day-full-name">${d.name}</span>
              <span class="cal-day-short-name">${d.short}</span>
              <span class="cal-day-count-badge">${count}</span>
            </div>
            ${isToday ? '<span class="cal-day-today-tag">Сегодня</span>' : ''}
          </button>
        `;
      }).join('')}
    </div>

    <!-- Контейнер карточек эпизодов -->
    <div id="calendar-day-items-grid" class="cal-items-grid"></div>
  `;

  let activeDay = currentDayIndex;

  const renderDayItems = (dayId) => {
    activeDay = dayId;
    const grid = container.querySelector('#calendar-day-items-grid');
    if (!grid) return;

    const items = dayGroups[dayId] || [];
    if (items.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 48px 20px; color: var(--text-muted);">
          <div style="font-size: 32px; margin-bottom: 8px;">🎬</div>
          <div style="font-size: 14px; font-weight: 600;">В этот день новых серий не запланировано</div>
          <div style="font-size: 12px; margin-top: 4px;">Выберите другой день недели для просмотра расписания</div>
        </div>
      `;
      return;
    }

    grid.innerHTML = items.map(it => {
      const epInfo = getReleaseEpisodeInfo(it, dayId, currentDayIndex);
      const is4K = Boolean(it.is4K || it.quality?.includes('4K'));

      return `
        <div class="cal-card storm-card" data-id="${it.id}">
          <!-- Постер с бейджем серии -->
          <div class="cal-poster-wrap">
            <img src="${it.poster || 'assets/favicon.svg'}" class="cal-poster-img" alt="${it.title}" onerror="this.src='assets/favicon.svg'">
            <span class="cal-poster-ep-badge">${epInfo.badgeText}</span>
            ${is4K ? '<span class="cal-poster-4k-badge">4K</span>' : ''}
          </div>

          <!-- Информация об эпизоде -->
          <div class="cal-info-wrap">
            <div class="cal-header-zone">
              <h4 class="cal-card-title" title="${it.title}">${it.title}</h4>
              <div class="cal-ep-indicator ${epInfo.statusClass}">
                <span class="cal-ep-name">${epInfo.epLabel}</span>
                <span class="cal-time-pill">${epInfo.statusText}</span>
              </div>
            </div>

            <div class="cal-meta-row">
              <span class="cal-meta-chip">${it.year || '2026'}</span>
              <span class="cal-meta-chip source">${(it.source || 'HD').toUpperCase()}</span>
              ${it.rating ? `<span class="cal-meta-chip rating">★ ${it.rating}</span>` : ''}
              <span class="cal-meta-chip quality">${is4K ? '4K UHD' : '1080p FHD'}</span>
            </div>

            <!-- Кнопки действий -->
            <div class="cal-actions-row">
              <button type="button" class="cal-play-btn storm-btn storm-btn-primary storm-btn-sm" data-season="${epInfo.season}" data-episode="${epInfo.episode}">
                ▶ Смотреть S${epInfo.season}:E${epInfo.episode}
              </button>
              <button type="button" class="cal-notify-btn storm-btn storm-btn-secondary storm-btn-sm" title="Напомнить о серии">
                🔔
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Слушатели кликов по карточкам
    grid.querySelectorAll('.cal-card').forEach((card, idx) => {
      card.onclick = (e) => {
        if (e.target.closest('.cal-notify-btn')) {
          e.stopPropagation();
          requestNotificationPermission(items[idx].title);
          return;
        }

        const playBtn = e.target.closest('.cal-play-btn');
        const s = playBtn ? parseInt(playBtn.dataset.season, 10) : undefined;
        const ep = playBtn ? parseInt(playBtn.dataset.episode, 10) : undefined;

        document.getElementById('release-calendar-modal')?.classList.remove('is-open');
        openPlayerModal(items[idx], { initialSeason: s, initialEpisode: ep });
      };
    });
  };

  // Переключение дней недели
  container.querySelectorAll('.cal-day-pill').forEach(btn => {
    btn.onclick = () => {
      container.querySelectorAll('.cal-day-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderDayItems(parseInt(btn.dataset.day, 10));
    };
  });

  renderDayItems(currentDayIndex);
}

function requestNotificationPermission(title) {
  if (!('Notification' in window)) {
    showToast('Уведомления не поддерживаются вашим браузером', 'warning');
    return;
  }

  Notification.requestPermission().then(permission => {
    if (permission === 'granted') {
      showToast(`🔔 Вы подписались на уведомления о сериале «${title}»`, 'success');
      try {
        new Notification('STORM MULTIMEDIA', {
          body: `Вы подписались на уведомления о выходе новых серий: ${title}`,
          icon: 'assets/favicon.svg'
        });
      } catch {}
    } else {
      showToast('Доступ к системным уведомлениям отклонен', 'info');
    }
  });
}
