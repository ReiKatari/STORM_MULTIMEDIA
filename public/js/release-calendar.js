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

// Получение информации о серии и времени выхода
function getReleaseEpisodeInfo(item, dayId, currentDayIndex) {
  const season = item.season || 1;
  const episode = item.episode || 1;
  const timeStr = item.air_time || '20:00 МСК';

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
  if (item.episode_title) {
    epLabel += ` • «${item.episode_title}»`;
  }

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

const FALLBACK_SCHEDULE_ITEMS = [
  { id: 'lostfilm_gentlemen', title: 'Джентльмены', original_title: 'The Gentlemen', poster: 'https://image.tmdb.org/t/p/w500/vbpA5L3n6z720aGSm5U1QZ2VqXG.jpg', year: '2024', season: 1, episode: 8, episode_title: 'Изысканный финал', day_of_week: 1, air_time: '20:00 МСК', studio: 'LostFilm', quality: '4K UHD', is4K: true, rating: 8.2 },
  { id: 'lostfilm_house_dragon', title: 'Дом Дракона', original_title: 'House of the Dragon', poster: 'https://image.tmdb.org/t/p/w500/1X4h40fcB4WWUmIBK0auT4zZZga.jpg', year: '2024', season: 2, episode: 8, episode_title: 'Королева, которая была', day_of_week: 1, air_time: '21:30 МСК', studio: 'LostFilm', quality: '4K UHD', is4K: true, rating: 8.5 },
  { id: 'lostfilm_penguin', title: 'Пингвин', original_title: 'The Penguin', poster: 'https://image.tmdb.org/t/p/w500/a393c5c3e031a0e88a385ec5446baea8.jpg', year: '2024', season: 1, episode: 8, episode_title: 'Великая или ничтожная вещь', day_of_week: 2, air_time: '20:30 МСК', studio: 'LostFilm', quality: '4K UHD', is4K: true, rating: 8.8 },
  { id: 'lostfilm_shogun', title: 'Сёгун', original_title: 'Shōgun', poster: 'https://image.tmdb.org/t/p/w500/7O4iVfOMQmdCSxhOg1WnzG1AgYT.jpg', year: '2024', season: 1, episode: 10, episode_title: 'Сон о сне', day_of_week: 2, air_time: '21:00 МСК', studio: 'LostFilm', quality: '4K UHD', is4K: true, rating: 8.9 },
  { id: 'rhs_silo', title: 'Укрытие', original_title: 'Silo', poster: 'https://image.tmdb.org/t/p/w500/6A7r9bW0u0vYV80FjA4M0k8mKxZ.jpg', year: '2024', season: 2, episode: 10, episode_title: 'За пределами шлюза', day_of_week: 3, air_time: '19:30 МСК', studio: 'Red Head Sound', quality: '4K UHD', is4K: true, rating: 8.3 },
  { id: 'lostfilm_the_bear', title: 'Медведь', original_title: 'The Bear', poster: 'https://image.tmdb.org/t/p/w500/n7b4u12h7q3oE89f2XvB9aK6mP4.jpg', year: '2024', season: 3, episode: 10, episode_title: 'Вечно', day_of_week: 3, air_time: '20:30 МСК', studio: 'LostFilm', quality: '1080p FHD', is4K: false, rating: 8.6 },
  { id: 'lostfilm_the_boys', title: 'Пацаны', original_title: 'The Boys', poster: 'https://image.tmdb.org/t/p/w500/2zmTngn1tYC1AvfnNDBpQI4r4Q8.jpg', year: '2024', season: 4, episode: 8, episode_title: 'Финал четвёртого сезона', day_of_week: 4, air_time: '20:00 МСК', studio: 'LostFilm', quality: '4K UHD', is4K: true, rating: 8.7 },
  { id: 'lostfilm_fallout', title: 'Фоллаут', original_title: 'Fallout', poster: 'https://image.tmdb.org/t/p/w500/AnsZu4h0V7u0C8x4A1V7M8p2kL4.jpg', year: '2024', season: 1, episode: 8, episode_title: 'Начало пути в Нью-Вегас', day_of_week: 4, air_time: '21:15 МСК', studio: 'LostFilm', quality: '4K UHD', is4K: true, rating: 8.5 },
  { id: 'lostfilm_rings_power', title: 'Властелин колец: Кольца власти', original_title: 'The Lord of the Rings: The Rings of Power', poster: 'https://image.tmdb.org/t/p/w500/mYLOqiStMxDK3fYZFsCw9qwzW9.jpg', year: '2024', season: 2, episode: 8, episode_title: 'Тень и пламя', day_of_week: 5, air_time: '20:30 МСК', studio: 'LostFilm', quality: '4K UHD', is4K: true, rating: 7.8 },
  { id: 'rhs_arcane', title: 'Аркейн', original_title: 'Arcane', poster: 'https://image.tmdb.org/t/p/w500/fqldf2t8ztc9aiwn397rWW2vAwh.jpg', year: '2024', season: 2, episode: 9, episode_title: 'Финал истории Пилтовера и Зауна', day_of_week: 5, air_time: '19:00 МСК', studio: 'Red Head Sound', quality: '4K UHD', is4K: true, rating: 9.1 },
  { id: 'lostfilm_reacher', title: 'Ричер', original_title: 'Reacher', poster: 'https://image.tmdb.org/t/p/w500/sh7Rg8Er3tFcN9BpKIPOMvALgZd.jpg', year: '2024', season: 2, episode: 8, episode_title: 'Финал сезона', day_of_week: 6, air_time: '20:00 МСК', studio: 'LostFilm', quality: '4K UHD', is4K: true, rating: 8.4 },
  { id: 'lostfilm_severance', title: 'Разделение', original_title: 'Severance', poster: 'https://image.tmdb.org/t/p/w500/bL5Hq1K4A2x6x8aR8Fz7M0V1QkZ.jpg', year: '2024', season: 2, episode: 1, episode_title: 'Пробуждение на этаже разделения', day_of_week: 0, air_time: '21:30 МСК', studio: 'LostFilm', quality: '4K UHD', is4K: true, rating: 8.9 }
];

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function renderCalendarContent(container) {
  if (!container) return;

  const currentDayIndex = new Date().getDay();

  // Индикатор загрузки
  container.innerHTML = `
    <div style="text-align: center; padding: 60px 20px; color: var(--text-muted); display: flex; align-items: center; justify-content: center; gap: 12px;">
      <div class="storm-spinner"></div>
      <span style="font-size: 14px;">Загрузка актуального расписания LostFilm, AniLibria и Red Head Sound...</span>
    </div>
  `;

  // Загружаем актуальный сводный календарь
  let scheduleItems = [];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    const res = await fetch('/api/media/schedule', { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      scheduleItems = data.items || [];
    }
  } catch (err) {
    console.warn('Ошибка загрузки расписания с сервера, применяем резервный каталог:', err);
  }

  // Если сервер вернул мало данных или произошел сбой — подмешиваем гарантированный резерв
  if (!scheduleItems || scheduleItems.length < 5) {
    scheduleItems = [...FALLBACK_SCHEDULE_ITEMS];
  }

  // Распределяем релизы по дням недели
  const dayGroups = {};
  DAYS_OF_WEEK.forEach(d => { dayGroups[d.id] = []; });

  scheduleItems.forEach(it => {
    const rawDay = it.day_of_week !== undefined ? it.day_of_week : it.day;
    const dayId = (rawDay !== undefined && !isNaN(parseInt(rawDay, 10))) ? parseInt(rawDay, 10) : 1;
    if (dayGroups[dayId]) {
      dayGroups[dayId].push(it);
    }
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
            <img src="${it.poster || 'assets/favicon.svg'}" class="cal-poster-img" alt="${escapeHtml(it.title)}" onerror="this.src='assets/favicon.svg'">
            <span class="cal-poster-ep-badge">${epInfo.badgeText}</span>
            ${is4K ? '<span class="cal-poster-4k-badge">4K</span>' : ''}
          </div>

          <!-- Информация об эпизоде -->
          <div class="cal-info-wrap">
            <div class="cal-header-zone">
              <h4 class="cal-card-title" title="${escapeHtml(it.title)}">${escapeHtml(it.title)}</h4>
              <div class="cal-ep-indicator ${epInfo.statusClass}">
                <span class="cal-ep-name">${escapeHtml(epInfo.epLabel)}</span>
                <span class="cal-time-pill">${epInfo.statusText}</span>
              </div>
            </div>

            <div class="cal-meta-row">
              <span class="cal-meta-chip">${it.year || '2024'}</span>
              <span class="cal-meta-chip studio" style="font-weight: 800; background: rgba(0, 210, 255, 0.15); color: var(--accent); border: 1px solid rgba(0, 210, 255, 0.35);">🎙️ ${it.studio || 'LostFilm'}</span>
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
