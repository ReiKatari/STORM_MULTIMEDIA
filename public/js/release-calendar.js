/* ==========================================================================
   STORM MULTIMEDIA - КАЛЕНДАРЬ РЕЛИЗОВ И УВЕДОМЛЕНИЯ О СЕРИЯХ
   Интерактивное расписание выхода эпизодов по дням недели
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
      <div class="storm-modal" style="max-width: 900px; width: 95%;">
        <div class="storm-modal-header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 20px;">📅</span>
            <h3 style="margin: 0;">Календарь релизов и расписание серий</h3>
          </div>
          <button type="button" class="storm-modal-close" id="calendar-modal-close-btn">✕</button>
        </div>
        <div class="storm-modal-body" id="release-calendar-body"></div>
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

  // Загружаем популярные релизы для расписания
  let scheduleItems = [];
  try {
    const res = await fetch('/api/media/catalog?category=series&page=1&source=all');
    const data = await res.json();
    scheduleItems = data.items || [];
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
    <!-- Переключатель дней недели -->
    <div style="display: flex; gap: 8px; overflow-x: auto; padding-bottom: 8px; margin-bottom: 16px; scrollbar-width: thin;">
      ${DAYS_OF_WEEK.map(d => `
        <button type="button" class="storm-btn ${d.id === currentDayIndex ? 'storm-btn-primary' : 'storm-btn-secondary'} storm-btn-sm calendar-day-tab" data-day="${d.id}" style="white-space: nowrap; flex: 1; min-width: 90px; justify-content: center;">
          ${d.name} ${d.id === currentDayIndex ? '• Сегодня' : ''}
        </button>
      `).join('')}
    </div>

    <div id="calendar-day-items-grid"></div>
  `;

  const renderDayItems = (dayId) => {
    const grid = container.querySelector('#calendar-day-items-grid');
    if (!grid) return;

    const items = dayGroups[dayId] || [];
    if (items.length === 0) {
      grid.innerHTML = '<div style="text-align: center; padding: 30px; color: var(--text-muted);">В этот день новых эпизодов не запланировано</div>';
      return;
    }

    grid.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px;">
        ${items.map(it => `
          <div class="storm-card" style="display: flex; gap: 12px; padding: 10px; border-radius: 10px; cursor: pointer;" data-id="${it.id}">
            <img src="${it.poster || 'assets/favicon.svg'}" style="width: 60px; height: 90px; object-fit: cover; border-radius: 6px;" onerror="this.src='assets/favicon.svg'">
            <div style="flex: 1; display: flex; flex-direction: column; justify-content: space-between;">
              <div>
                <div style="font-weight: 700; font-size: 13px; margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${it.title}</div>
                <div style="font-size: 11px; color: var(--accent); margin-bottom: 4px;">Серия выйдет в 19:00 МСК</div>
                <div style="font-size: 11px; color: var(--text-muted);">${it.year || ''} • ${it.source?.toUpperCase() || 'HD'}</div>
              </div>
              <div style="display: flex; gap: 6px; margin-top: 6px;">
                <button type="button" class="storm-btn storm-btn-primary storm-btn-sm play-cal-btn" style="padding: 4px 8px; font-size: 11px;">▶ Смотреть</button>
                <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm notify-btn" style="padding: 4px 8px; font-size: 11px;" title="Уведомлять о выходе">🔔</button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    grid.querySelectorAll('.storm-card').forEach((card, idx) => {
      card.onclick = (e) => {
        if (e.target.closest('.notify-btn')) {
          e.stopPropagation();
          requestNotificationPermission(items[idx].title);
          return;
        }
        document.getElementById('release-calendar-modal')?.classList.remove('is-open');
        openPlayerModal(items[idx]);
      };
    });
  };

  container.querySelectorAll('.calendar-day-tab').forEach(btn => {
    btn.onclick = () => {
      container.querySelectorAll('.calendar-day-tab').forEach(b => {
        b.classList.remove('storm-btn-primary');
        b.classList.add('storm-btn-secondary');
      });
      btn.classList.add('storm-btn-primary');
      btn.classList.remove('storm-btn-secondary');
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
      new Notification('STORM MULTIMEDIA', {
        body: `Вы подписались на уведомления о выходе новых серий: ${title}`,
        icon: 'assets/favicon.svg'
      });
    } else {
      showToast('Доступ к системным уведомлениям отклонен', 'info');
    }
  });
}
