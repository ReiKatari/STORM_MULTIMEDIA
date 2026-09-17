/* ==========================================================================
   STORM MULTIMEDIA - SMART SKIP И ИНТЕРАКТИВНЫЕ ГЛАВЫ (CHAPTERS)
   Локальное и алгоритмическое распознавание интро/аутро + таймкоды
   ========================================================================== */

import { showToast } from './auth.js';

let activeVideo = null;
let currentSkipIntervals = null;
let activeSkipBanner = null;
let autoSkippedIntro = false;
let autoSkippedOutro = false;

// Стандартные интервалы для аниме и сериалов (только для ручного пропуска, НЕ для автопропуска)
export function getEstimatedSkipIntervals(durationSeconds, mediaType = '') {
  if (!durationSeconds || durationSeconds < 300) return null;
  // Для фильмов приблизительный автопропуск не применяется
  if (mediaType === 'movie' || durationSeconds > 3600) return null;

  // Обычное аниме или короткая серия
  if (durationSeconds <= 1800) {
    return {
      verified: false,
      intro: { start: 75, end: 165, label: 'Опенинг (Интро)' },
      outro: { start: Math.max(durationSeconds - 120, 200), end: durationSeconds - 15, label: 'Финальные титры (Эндинг)' }
    };
  }

  // Сериал средней длительности
  return {
    verified: false,
    intro: { start: 90, end: 195, label: 'Заставка' },
    outro: { start: Math.max(durationSeconds - 240, 300), end: durationSeconds - 20, label: 'Финальные титры' }
  };
}

export function setSmartSkipIntervals(intervals) {
  currentSkipIntervals = intervals;
  autoSkippedIntro = false;
  autoSkippedOutro = false;
  if (activeVideo && activeVideo.duration) {
    renderChaptersOnTrack(activeVideo, currentSkipIntervals);
  }
}

export function initSmartSkip(video, intervals = null) {
  activeVideo = video;
  currentSkipIntervals = intervals;
  autoSkippedIntro = false;
  autoSkippedOutro = false;

  if (!video) return;

  video.addEventListener('timeupdate', checkSkipIntervals);
  video.addEventListener('loadedmetadata', () => {
    if (!currentSkipIntervals && video.duration) {
      currentSkipIntervals = getEstimatedSkipIntervals(video.duration);
      renderChaptersOnTrack(video, currentSkipIntervals);
    }
  });

  if (video.duration) {
    currentSkipIntervals = intervals || getEstimatedSkipIntervals(video.duration);
    renderChaptersOnTrack(video, currentSkipIntervals);
  }
}

function checkSkipIntervals() {
  if (!activeVideo || !currentSkipIntervals) return;
  const t = activeVideo.currentTime;
  const isAutoSkip = localStorage.getItem('storm_auto_skip') === 'true';

  // Сброс флага, если пользователь вручную вернулся назад перед опенингом
  if (currentSkipIntervals.intro && t < Math.max(0, currentSkipIntervals.intro.start - 3)) {
    autoSkippedIntro = false;
  }
  if (currentSkipIntervals.outro && t < Math.max(0, currentSkipIntervals.outro.start - 3)) {
    autoSkippedOutro = false;
  }

  // 1. Проверка интро (опенинга / заставки)
  if (currentSkipIntervals.intro && t >= currentSkipIntervals.intro.start && t < currentSkipIntervals.intro.end) {
    if (isAutoSkip && !autoSkippedIntro) {
      showAutoSkipCountdownBanner(currentSkipIntervals.intro.label, currentSkipIntervals.intro.end, () => {
        autoSkippedIntro = true;
      });
      return;
    }
    showSkipBanner(currentSkipIntervals.intro.label, currentSkipIntervals.intro.end);
    return;
  }

  // 2. Проверка аутро (титров / эндинга)
  if (currentSkipIntervals.outro && t >= currentSkipIntervals.outro.start && t < currentSkipIntervals.outro.end) {
    if (isAutoSkip && !autoSkippedOutro) {
      showAutoSkipCountdownBanner(currentSkipIntervals.outro.label, currentSkipIntervals.outro.end, () => {
        autoSkippedOutro = true;
      });
      return;
    }
    showSkipBanner(currentSkipIntervals.outro.label, currentSkipIntervals.outro.end);
    return;
  }

  removeSkipBanner();
}

let autoSkipTimer = null;

function showAutoSkipCountdownBanner(label, targetTime, onSkipCb) {
  if (activeSkipBanner) return;

  const wrapper = activeVideo?.closest('.player-video-box') || document.getElementById('cinema-player-wrapper');
  if (!wrapper) return;

  let secondsLeft = 3;
  const banner = document.createElement('div');
  banner.className = 'smart-skip-floating-banner auto-skip-countdown';
  banner.id = 'smart-skip-floating-banner';
  banner.innerHTML = `
    <div class="smart-skip-content" style="flex-direction: column; align-items: stretch; gap: 6px; padding: 10px 14px; min-width: 240px;">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
        <span class="smart-skip-text" style="font-size: 12px;">⏩ Автопропуск: <b>${label}</b> (<span id="auto-skip-count">3</span>с)</span>
        <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm smart-skip-cancel-btn" style="padding: 2px 8px; font-size: 11px;">Отмена</button>
      </div>
      <div style="height: 3px; background: rgba(255,255,255,0.15); border-radius: 2px; overflow: hidden;">
        <div id="auto-skip-bar" style="height: 100%; width: 100%; background: var(--accent, #00f0ff); transition: width 3s linear;"></div>
      </div>
    </div>
  `;

  wrapper.appendChild(banner);
  activeSkipBanner = banner;

  const bar = banner.querySelector('#auto-skip-bar');
  const countEl = banner.querySelector('#auto-skip-count');
  requestAnimationFrame(() => {
    if (bar) bar.style.width = '0%';
  });

  const cancelBtn = banner.querySelector('.smart-skip-cancel-btn');
  if (cancelBtn) {
    cancelBtn.onclick = (e) => {
      e.stopPropagation();
      clearTimeout(autoSkipTimer);
      if (onSkipCb) onSkipCb();
      removeSkipBanner();
      showToast('Автопропуск отменен', 'info');
    };
  }

  const intervalId = setInterval(() => {
    secondsLeft--;
    if (countEl) countEl.textContent = `${Math.max(0, secondsLeft)}`;
    if (secondsLeft <= 0) clearInterval(intervalId);
  }, 1000);

  autoSkipTimer = setTimeout(() => {
    clearInterval(intervalId);
    if (activeVideo && activeSkipBanner === banner) {
      activeVideo.currentTime = targetTime;
      if (onSkipCb) onSkipCb();
      showToast(`⏩ ${label} пропущено`, 'info');
    }
    removeSkipBanner();
  }, 3000);
}

function showSkipBanner(label, targetTime) {
  if (activeSkipBanner) return;

  const wrapper = activeVideo?.closest('.player-video-box') || document.getElementById('cinema-player-wrapper');
  if (!wrapper) return;

  const banner = document.createElement('div');
  banner.className = 'smart-skip-floating-banner';
  banner.id = 'smart-skip-floating-banner';
  banner.innerHTML = `
    <div class="smart-skip-content">
      <span class="smart-skip-icon">⏩</span>
      <span class="smart-skip-text">Пропустить: <b>${label}</b></span>
      <button type="button" class="storm-btn storm-btn-primary storm-btn-sm smart-skip-action-btn">Пропустить</button>
      <button type="button" class="smart-skip-close-btn" title="Скрыть">✕</button>
    </div>
  `;

  const actionBtn = banner.querySelector('.smart-skip-action-btn');
  if (actionBtn) {
    actionBtn.onclick = (e) => {
      e.stopPropagation();
      if (activeVideo) {
        activeVideo.currentTime = targetTime;
        showToast(`⏩ ${label} пропущено`, 'info');
      }
      removeSkipBanner();
    };
  }

  const closeBtn = banner.querySelector('.smart-skip-close-btn');
  if (closeBtn) {
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      removeSkipBanner();
    };
  }

  wrapper.appendChild(banner);
  activeSkipBanner = banner;
}

function removeSkipBanner() {
  if (autoSkipTimer) {
    clearTimeout(autoSkipTimer);
    autoSkipTimer = null;
  }
  if (activeSkipBanner) {
    activeSkipBanner.remove();
    activeSkipBanner = null;
  }
}

// Рендеринг меток глав (Chapters) на полосе прогресса
export function renderChaptersOnTrack(video, intervals) {
  const track = document.getElementById('player-chapters-track');
  if (!track || !video || !video.duration || !intervals) return;

  track.innerHTML = '';
  const duration = video.duration;

  if (intervals.intro) {
    const introLeft = (intervals.intro.start / duration) * 100;
    const introWidth = ((intervals.intro.end - intervals.intro.start) / duration) * 100;
    const introEl = document.createElement('div');
    introEl.className = 'player-chapter-segment intro';
    introEl.style.left = `${introLeft}%`;
    introEl.style.width = `${introWidth}%`;
    introEl.title = `${intervals.intro.label} (${formatSeconds(intervals.intro.start)} - ${formatSeconds(intervals.intro.end)})`;
    track.appendChild(introEl);
  }

  if (intervals.outro) {
    const outroLeft = (intervals.outro.start / duration) * 100;
    const outroWidth = ((intervals.outro.end - intervals.outro.start) / duration) * 100;
    const outroEl = document.createElement('div');
    outroEl.className = 'player-chapter-segment outro';
    outroEl.style.left = `${outroLeft}%`;
    outroEl.style.width = `${outroWidth}%`;
    outroEl.title = `${intervals.outro.label} (${formatSeconds(intervals.outro.start)} - ${formatSeconds(intervals.outro.end)})`;
    track.appendChild(outroEl);
  }
}

function formatSeconds(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
