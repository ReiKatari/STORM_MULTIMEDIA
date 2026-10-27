/* ==========================================================================
   STORM MULTIMEDIA - SMART SKIP И ИНТЕРАКТИВНЫЕ ГЛАВЫ (CHAPTERS)
   Локальное и алгоритмическое распознавание интро/аутро + таймкоды
   ========================================================================== */

import { showToast } from './auth.js?v=1.2.5';
import { trackClientAction } from './achievements.js?v=1.2.5';

let activeVideo = null;
let currentSkipIntervals = null;
let activeSkipBanner = null;
let lastAutoSkippedSegment = '';

export function isAutoSkipIntroEnabled() {
  return localStorage.getItem('storm_autoskip_intro') !== 'false';
}

export function setAutoSkipIntroEnabled(val) {
  const enabled = Boolean(val);
  localStorage.setItem('storm_autoskip_intro', enabled ? 'true' : 'false');
  const toggleEl = document.getElementById('profile-autoskip-toggle');
  if (toggleEl && toggleEl.checked !== enabled) {
    toggleEl.checked = enabled;
  }
  if (enabled && activeVideo && currentSkipIntervals) {
    lastAutoSkippedSegment = '';
    checkSkipIntervals();
  }
}

// Стандартные интервалы для аниме и сериалов
export function getEstimatedSkipIntervals(durationSeconds, mediaType = '') {
  if (!durationSeconds || durationSeconds < 300) return null;
  if (mediaType === 'movie' || durationSeconds > 3600) return null;

  if (durationSeconds <= 1800) {
    return {
      verified: false,
      intro: { start: 75, end: 165, label: 'Опенинг (Интро)' },
      outro: { start: Math.max(durationSeconds - 120, 200), end: durationSeconds - 15, label: 'Финальные титры (Эндинг)' }
    };
  }

  return {
    verified: false,
    intro: { start: 90, end: 195, label: 'Заставка' },
    outro: { start: Math.max(durationSeconds - 240, 300), end: durationSeconds - 20, label: 'Финальные титры' }
  };
}

export function setSmartSkipIntervals(intervals) {
  currentSkipIntervals = intervals;
  lastAutoSkippedSegment = '';
  if (activeVideo && activeVideo.duration) {
    renderChaptersOnTrack(activeVideo, currentSkipIntervals);
  }
}

export function initSmartSkip(video, intervals = null) {
  activeVideo = video;
  currentSkipIntervals = intervals;
  lastAutoSkippedSegment = '';

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
  const autoSkip = isAutoSkipIntroEnabled();

  // 1. Проверка интро (опенинга / заставки)
  if (currentSkipIntervals.intro && t >= currentSkipIntervals.intro.start && t < currentSkipIntervals.intro.end) {
    const segKey = `intro_${currentSkipIntervals.intro.start}_${currentSkipIntervals.intro.end}`;
    if (autoSkip && lastAutoSkippedSegment !== segKey) {
      lastAutoSkippedSegment = segKey;
      activeVideo.currentTime = currentSkipIntervals.intro.end;
      trackClientAction('use_skip');
      showToast(`⏩ ${currentSkipIntervals.intro.label} автоматически пропущено`, 'info');
      removeSkipBanner();
      return;
    }
    showSkipBanner(currentSkipIntervals.intro.label, currentSkipIntervals.intro.end);
    return;
  }

  // 2. Проверка аутро (титров / эндинга)
  if (currentSkipIntervals.outro && t >= currentSkipIntervals.outro.start && t < currentSkipIntervals.outro.end) {
    const segKey = `outro_${currentSkipIntervals.outro.start}_${currentSkipIntervals.outro.end}`;
    if (autoSkip && currentSkipIntervals.verified && lastAutoSkippedSegment !== segKey) {
      lastAutoSkippedSegment = segKey;
      activeVideo.currentTime = currentSkipIntervals.outro.end;
      trackClientAction('use_skip');
      showToast(`⏩ ${currentSkipIntervals.outro.label} автоматически пропущено`, 'info');
      removeSkipBanner();
      return;
    }
    showSkipBanner(currentSkipIntervals.outro.label, currentSkipIntervals.outro.end);
    return;
  }

  removeSkipBanner();
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
        trackClientAction('use_skip');
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
  if (activeSkipBanner) {
    activeSkipBanner.remove();
    activeSkipBanner = null;
  }
}

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
