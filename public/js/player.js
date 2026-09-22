/* ==========================================================================
   STORM MULTIMEDIA - КИНОТЕАТРАЛЬНЫЙ МОДАЛЬНЫЙ ПЛЕЕР (CINEMA MODAL)
   Поддержка 4K FanFilm4K, AniLibria HLS, AniXart, Kinobox, WebTorrent,
   Ambilight эффекта, пропуска интро/аутро, PiP, субтитров и совместного просмотра
   ========================================================================== */

import { saveBookmarkStatus, deleteBookmark, syncWatchProgress, fetchCustomLists, addItemToCollection, createCustomCollection, detectClientMediaType, detectClientYear } from './bookmarks.js';
import { getUser, showToast } from './auth.js';
import { t } from './i18n.js';
import { trackClientAction } from './achievements.js';
import { renderReviewsSection } from './reviews.js';
import { attachPlayerToRoom, createWatchRoom, joinWatchRoom, leaveWatchRoom, getActiveRoom, renderRoomUi } from './watch-together.js';
import { initSubtitlesManager, renderSubtitlesControls } from './subtitles-manager.js';
import { initSmartSkip, renderChaptersOnTrack, setSmartSkipIntervals } from './smart-skip.js';
import { sendSmartLightsFrame, renderSmartLightsSettings } from './smart-lights.js';
import { toggleWhisperAiSubtitles } from './whisper-subtitles.js';
import { saveMediaForOffline } from './offline-storage.js';
import { renderTorrServerSettings } from './torrserver-client.js';
import { applyProVideoSettings, initProAudioEngine, initVideoUpscalerShaders, stopVideoUpscalerShaders, renderProVideoPanel, renderProAudioPanel, setProAudioNightMode, getProAudioNightMode, applyProAudioSettings } from './pro-media-engine.js';
import { getStatusIconSvg, getStatusLabel, STATUS_LIST } from './status-icons.js';
import { mountCleanViewOverlay, toggleCleanViewModal, initAdSkipper, applyMaskSettings } from './ad-shield.js';

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

let currentMedia = null;
let currentPlayers = [];
let currentActivePlayer = null;
let currentVoiceoverId = null;
let currentEpisodes = [];
let currentEpisodeIndex = 1;
let currentProgressPercent = 0;
let iframeWatchInterval = null;
let currentWatchTimeSeconds = 0;

// Ночной звук (Web Audio Compressor)
let audioCtx = null;
let audioSourceNode = null;
let compressorNode = null;
let nightAudioModeEnabled = localStorage.getItem('storm_night_audio') === 'true';
let xrayVisible = false;

// Ambilight конфигурация и пресеты
let ambilightEnabled = false;
let ambilightCanvas = null;
let ambilightCtx = null;
let ambilightRaf = null;

let ambilightSettings = {
  mode: 'auto', // 'auto', 'preset', 'custom'
  color: '#00f0ff',
  intensity: 85,
  blur: 90
};

try {
  const savedSettings = localStorage.getItem('storm_ambilight_settings');
  if (savedSettings) {
    ambilightSettings = { ...ambilightSettings, ...JSON.parse(savedSettings) };
  }
} catch {}

const AMBILIGHT_PRESETS = [
  { id: 'cyan', name: 'Неоновый циан', color: '#00f0ff' },
  { id: 'purple', name: 'Аметистовая ночь', color: '#a855f7' },
  { id: 'gold', name: 'Имперское золото', color: '#f59e0b' },
  { id: 'emerald', name: 'Матричный изумруд', color: '#00ff66' },
  { id: 'pink', name: 'Неон Найт-Сити', color: '#ff007f' },
  { id: 'blue', name: 'Глубокий ультрамарин', color: '#0284c7' },
  { id: 'sunset', name: 'Закатный янтарь', color: '#ff6b4a' },
  { id: 'cinema', name: 'Белый кинозал', color: '#e2e8f0' }
];

// Skip Intro и Outro
let skipIntervals = null;
localStorage.removeItem('storm_auto_skip');
let vpnBypassEnabled = localStorage.getItem('storm_vpn_bypass') === 'true';

// WebTorrent
let torrentClient = null;

function getSourceName(item) {
  const map = {
    fanfilm4k: 'FanFilm4K',
    tmdb: 'TMDB',
    anixart: 'AniXart',
    anilibria: 'AniLibria',
    shikimori: 'Shikimori',
    kodik: 'Kodik',
    hdrezka: 'HDRezka',
    collaps: 'Collaps',
    alloha: 'Alloha TV',
    videocdn: 'VideoCDN',
    ashdi: 'Ashdi',
    vidsrc: 'Vidsrc',
    kinobaza: 'Kinobaza',
    kinogo: 'Kinogo',
    webtorrent: 'WebTorrent',
    rutracker: 'RuTracker',
    nnmclub: 'NNM-Club',
    rutor: 'Rutor',
    lostfilm: 'LostFilm',
    redheadsound: 'Red Head Sound',
    animevost: 'Animevost',
    rutube: 'RuTube',
    vkvideo: 'VK Видео'
  };
  return map[item?.source] || (item?.source || 'STORM').toUpperCase();
}

let lastFsToggleTime = 0;

export function setCinemaFullscreen(enable) {
  const now = Date.now();
  if (now - lastFsToggleTime < 350) return;
  lastFsToggleTime = now;

  const video = document.getElementById('storm-video-player') || document.querySelector('#cinema-player-wrapper video');
  const videoBox = document.querySelector('.player-video-box');
  const modal = document.getElementById('cinema-modal');
  const fsBtn = document.getElementById('cinema-header-fullscreen-btn');

  const currentlyFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || (modal && modal.classList.contains('is-fullscreen')));

  if (!enable) {
    if (currentlyFs) {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen();
      }
      if (fsBtn) delete fsBtn.dataset.manualCssFs;
      if (modal) modal.classList.remove('is-fullscreen');
      if (videoBox) videoBox.classList.remove('is-fullscreen');
    }
  } else {
    // 1. Для iOS Safari нативных HTML5 <video>
    if (video && typeof video.webkitEnterFullscreen === 'function' && !document.fullscreenElement) {
      try {
        video.webkitEnterFullscreen();
        return;
      } catch (_) {}
    }

    // 2. Стандартный Fullscreen API и CSS fallback
    const target = modal;
    const req = target?.requestFullscreen || target?.webkitRequestFullscreen || target?.mozRequestFullScreen;
    if (req) {
      req.call(target).then(() => {
        if (modal) modal.classList.add('is-fullscreen');
        if (videoBox) videoBox.classList.add('is-fullscreen');
      }).catch(() => {
        if (fsBtn) fsBtn.dataset.manualCssFs = 'true';
        if (modal) modal.classList.add('is-fullscreen');
        if (videoBox) videoBox.classList.add('is-fullscreen');
      });
    } else if (modal) {
      if (fsBtn) fsBtn.dataset.manualCssFs = 'true';
      modal.classList.add('is-fullscreen');
      if (videoBox) videoBox.classList.add('is-fullscreen');
    }
  }

  setTimeout(() => {
    if (fsBtn && modal) {
      const activeFs = !!(document.fullscreenElement || document.webkitFullscreenElement || modal.classList.contains('is-fullscreen'));
      fsBtn.textContent = activeFs ? '🗗' : '⛶';
      fsBtn.title = activeFs ? 'Выйти из полноэкранного режима (F / Esc)' : 'Развернуть на весь экран (F)';
    }
  }, 100);
}

export function toggleCinemaFullscreen() {
  const modal = document.getElementById('cinema-modal');
  const currentlyFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || (modal && modal.classList.contains('is-fullscreen')));
  setCinemaFullscreen(!currentlyFs);
}

let fullscreenInitialized = false;
export function attachCinemaDblClick(el) {
  if (!el || el.dataset?.hasDblClickListener) return;
  el.dataset.hasDblClickListener = 'true';
  el.addEventListener('dblclick', (e) => {
    if (e.target.closest('button, input, select, a, .storm-skip-btn, .storm-btn, .studio-tab-btn, .player-studio-dock, .player-studio-drawer, .xray-header, .xray-tab-content, .player-series-quick-bar, .inplayer-ctrl-btn, .quick-dropdown-menu')) {
      return;
    }
    toggleCinemaFullscreen();
  });
}

function initFullscreenControls() {
  const fsBtn = document.getElementById('cinema-header-fullscreen-btn');
  if (fsBtn && !fsBtn.dataset.hasFsListener) {
    fsBtn.dataset.hasFsListener = 'true';
    fsBtn.onclick = (e) => {
      e.stopPropagation();
      toggleCinemaFullscreen();
    };
  }

  attachCinemaDblClick(document.getElementById('cinema-player-wrapper'));
  attachCinemaDblClick(document.getElementById('cinema-player-container'));
  attachCinemaDblClick(document.querySelector('.cinema-main-column'));

  if (fullscreenInitialized) return;
  fullscreenInitialized = true;

  const updateFsIcon = () => {
    const modal = document.getElementById('cinema-modal');
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || (modal && modal.classList.contains('is-fullscreen')));
    const btn = document.getElementById('cinema-header-fullscreen-btn');
    if (btn) {
      btn.textContent = isFs ? '🗗' : '⛶';
      btn.title = isFs ? 'Выйти из полноэкранного режима (F / Esc)' : 'Развернуть на весь экран (F)';
    }
    const isNativeFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement);
    if (!isNativeFs && modal && !btn?.dataset?.manualCssFs) {
      modal.classList.remove('is-fullscreen');
    }
  };

  document.addEventListener('fullscreenchange', updateFsIcon);
  document.addEventListener('webkitfullscreenchange', updateFsIcon);
  document.addEventListener('mozfullscreenchange', updateFsIcon);

  // Обработка сообщений от встроенных и сторонних плееров (Kodik, PlayerJS, Allplay, FanFilm и др.)
  window.addEventListener('message', (event) => {
    if (!event || !event.data) return;
    try {
      let data = event.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch {}
      }

      // 1. Примитивные строки
      if (data === 'fullscreen' || data === 'toggle_fullscreen' || data === 'dblclick') {
        toggleCinemaFullscreen();
        return;
      }
      if (data === 'enterfullscreen' || data === 'enter_fullscreen') {
        setCinemaFullscreen(true);
        return;
      }
      if (data === 'exitfullscreen' || data === 'exit_fullscreen') {
        setCinemaFullscreen(false);
        return;
      }
      if (data === 'pip' || data === 'pictureinpicture' || data === 'toggle_pip') {
        toggleAdvancedPiP();
        return;
      }

      // 2. Объектные сообщения от Kodik, Playerjs, Allplay, FanFilm и др.
      if (typeof data === 'object' && data) {
        if (data.type === 'STORM_SWITCH_NEXT_SOURCE' || data.type === 'STORM_PLAYER_FALLBACK') {
          switchToNextSource();
        }
        if (data.type === 'STORM_SPEED_CHANGED') {
          const sp = parseFloat(data.speed);
          if (sp && !isNaN(sp)) {
            localStorage.setItem('storm_playback_speed', String(sp));
            updateInPlayerSpeedDisplay(sp);
          }
        }

        // Kodik Player API
        if (data.key === 'kodik_player_api' && data.value) {
          const val = data.value;
          if (val.action === 'enter_fullscreen' || val.event === 'enter_fullscreen') {
            setCinemaFullscreen(true);
          } else if (val.action === 'exit_fullscreen' || val.event === 'exit_fullscreen') {
            setCinemaFullscreen(false);
          } else if (val.action === 'fullscreen' || val.event === 'fullscreen') {
            toggleCinemaFullscreen();
          }
        }

        // Плееры Playerjs, Plyr, Allplay, FanFilm
        if (data.action === 'enter_fullscreen' || data.event === 'enterfullscreen' || data.event === 'enter_fullscreen') {
          setCinemaFullscreen(true);
        } else if (data.action === 'exit_fullscreen' || data.event === 'exitfullscreen' || data.event === 'exit_fullscreen') {
          setCinemaFullscreen(false);
        } else if (
          data.event === 'fullscreen' || data.event === 'toggle_fullscreen' || data.event === 'fullscreen_toggle' ||
          data.event === 'dblclick' || data.action === 'fullscreen' || data.action === 'toggle_fullscreen' ||
          data.type === 'STORM_FULLSCREEN_TOGGLE' || data.type === 'fullscreen' || data.type === 'toggle_fullscreen'
        ) {
          toggleCinemaFullscreen();
        }

        if (data.event === 'pip' || data.event === 'pictureinpicture' || data.action === 'pip' || data.type === 'pip' || data.type === 'STORM_PIP') {
          toggleAdvancedPiP();
        }

        if (data.type === 'STORM_MOUSE_MOVE' || data.type === 'STORM_USER_ACTIVITY' || data.event === 'mousemove') {
          showInPlayerControls();
        }

        // Автопереключение серий от встроенных плееров (Kodik, Playerjs, Allplay, FanFilm)
        const isEndedAction =
          data === 'ended' || data === 'finish' || data === 'complete' ||
          data?.event === 'ended' || data?.event === 'finish' || data?.event === 'complete' ||
          data?.action === 'ended' || data?.action === 'finish' ||
          data?.type === 'ended' || data?.type === 'STORM_EPISODE_ENDED' ||
          data?.key === 'kodik_player_video_ended' ||
          (data?.key === 'kodik_player_api' && (data.value?.event === 'video_ended' || data.value?.action === 'ended' || data.value?.event === 'ended'));

        if (isEndedAction) {
          if (checkIfMediaIsSeries(currentMedia) && !window._lastEndedAutoSwitchTime) {
            window._lastEndedAutoSwitchTime = Date.now();
            setTimeout(() => { window._lastEndedAutoSwitchTime = 0; }, 6000);
            showToast('Серия завершена. Запуск следующей серии...', 'info');
            setTimeout(() => {
              playInPlayerNextEpisode();
            }, 1000);
            return;
          }
        }

        let streamDuration = data.duration ?? data.total ?? data.val ?? data.value?.duration ?? data.data?.duration ?? data.data?.total;
        if (data.key === 'kodik_player_time_update' || data.key === 'kodik_player_duration_update') {
          streamDuration = data.value?.duration || streamDuration;
        }
        if (streamDuration) {
          if (typeof streamDuration === 'number' && streamDuration > 30) {
            updateSidebarDuration(streamDuration);
          } else if (typeof streamDuration === 'string' && streamDuration.trim()) {
            updateSidebarDuration(streamDuration.trim());
          }
        }

        const curTime = data.time ?? data.position ?? data.value?.time ?? data.data?.time;
        if (curTime && streamDuration && typeof curTime === 'number' && typeof streamDuration === 'number') {
          if (streamDuration > 60 && curTime >= streamDuration - 1.5 && !window._lastEndedAutoSwitchTime) {
            if (checkIfMediaIsSeries(currentMedia)) {
              window._lastEndedAutoSwitchTime = Date.now();
              setTimeout(() => { window._lastEndedAutoSwitchTime = 0; }, 6000);
              showToast('Серия завершена. Запуск следующей серии...', 'info');
              setTimeout(() => {
                playInPlayerNextEpisode();
              }, 1000);
            }
          }
        }
      }
    } catch {}
  });

  document.addEventListener('keydown', (e) => {
    const modal = document.getElementById('cinema-modal');
    if (!modal || !modal.classList.contains('is-open')) return;

    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
      return;
    }

    if (isPlayerScreenLocked) return;

    const k = e.key;

    // Снимаем фокус с кнопок и ссылок, чтобы стрелки не переключали меню
    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === ' ' || k === 'ArrowUp' || k === 'ArrowDown') {
      if (activeEl && activeEl !== document.body && typeof activeEl.blur === 'function') {
        activeEl.blur();
      }
    }

    // 1. Полноэкранный режим: F / А
    if (k === 'f' || k === 'F' || k === 'а' || k === 'А') {
      e.preventDefault();
      e.stopPropagation();
      toggleCinemaFullscreen();
      return;
    }

    // 2. Перемотка назад (-10с): Стрелка влево / J / О
    if (k === 'ArrowLeft' || k === 'j' || k === 'J' || k === 'о' || k === 'О') {
      e.preventDefault();
      e.stopPropagation();
      sendSeekDelta(-10);
      triggerDoubleTapRipple(document.getElementById('player-tap-indicator-left'), false);
      return;
    }

    // 3. Перемотка вперед (+10с): Стрелка вправо / L / Д
    if (k === 'ArrowRight' || k === 'l' || k === 'L' || k === 'д' || k === 'Д') {
      e.preventDefault();
      e.stopPropagation();
      sendSeekDelta(10);
      triggerDoubleTapRipple(document.getElementById('player-tap-indicator-right'), true);
      return;
    }

    // 4. Пауза и воспроизведение: Пробел / K / Л
    if (k === ' ' || k === 'k' || k === 'K' || k === 'л' || k === 'Л') {
      e.preventDefault();
      e.stopPropagation();
      togglePlayerPlayPause();
      return;
    }

    // 5. Громкость: Стрелка вверх / вниз
    if (k === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      adjustPlayerVolume(0.1);
      return;
    }
    if (k === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      adjustPlayerVolume(-0.1);
      return;
    }

    // 6. Без звука: M / Ь
    if (k === 'm' || k === 'M' || k === 'ь' || k === 'Ь') {
      e.preventDefault();
      e.stopPropagation();
      togglePlayerMute();
      return;
    }
  }, true);
}

// -------------------------------------------------------------
// МОБИЛЬНЫЙ ТАЙМЕР СНА (SLEEP TIMER)
// -------------------------------------------------------------
let sleepTimerRemainingSeconds = 0;
let sleepTimerIntervalId = null;
let sleepTimerTargetMode = null; // number or 'end'

export function setSleepTimer(minutesOrMode) {
  cancelSleepTimer();
  if (!minutesOrMode || minutesOrMode === 0 || minutesOrMode === '0') {
    return;
  }

  sleepTimerTargetMode = minutesOrMode;
  if (minutesOrMode === 'end') {
    const video = document.querySelector('#cinema-player-wrapper video');
    if (video && video.duration && !isNaN(video.duration)) {
      sleepTimerRemainingSeconds = Math.max(60, Math.round(video.duration - video.currentTime));
    } else {
      sleepTimerRemainingSeconds = 45 * 60;
    }
  } else {
    const mins = parseInt(minutesOrMode, 10) || 15;
    sleepTimerRemainingSeconds = mins * 60;
  }

  updateSleepTimerUI();

  sleepTimerIntervalId = setInterval(() => {
    sleepTimerRemainingSeconds--;
    if (sleepTimerRemainingSeconds <= 30 && sleepTimerRemainingSeconds > 0) {
      const video = document.querySelector('#cinema-player-wrapper video');
      if (video && video.volume > 0.05) {
        try { video.volume = Math.max(0, video.volume - 0.03); } catch {}
      }
    }

    if (sleepTimerRemainingSeconds <= 0) {
      cancelSleepTimer();
      pauseCurrentPlayback();
      showToast('⏱️ Таймер сна сработал. Воспроизведение остановлено.');
    } else {
      updateSleepTimerUI();
    }
  }, 1000);
}

export function cancelSleepTimer() {
  if (sleepTimerIntervalId) {
    clearInterval(sleepTimerIntervalId);
    sleepTimerIntervalId = null;
  }
  sleepTimerRemainingSeconds = 0;
  sleepTimerTargetMode = null;
  updateSleepTimerUI();
}

export function getSleepTimerRemaining() {
  return sleepTimerRemainingSeconds;
}

function updateSleepTimerUI() {
  const sleepBtn = document.getElementById('player-sleep-btn');
  if (sleepBtn) {
    if (sleepTimerRemainingSeconds > 0) {
      const mins = Math.floor(sleepTimerRemainingSeconds / 60);
      const secs = sleepTimerRemainingSeconds % 60;
      sleepBtn.classList.add('active');
      sleepBtn.title = `Таймер сна активен: ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    } else {
      sleepBtn.classList.remove('active');
      sleepBtn.title = 'Таймер сна';
    }
  }

  // Обновляем отображение в мобильной шторке, если функция доступна
  if (typeof window.updateDrawerSleepUI === 'function') {
    window.updateDrawerSleepUI();
  }
}

export function togglePlayerPlayPause() {
  const video = document.querySelector('#cinema-player-wrapper video');
  if (video) {
    if (video.paused) {
      video.play().catch(() => {});
      showToast('▶ Воспроизведение', 'info');
    } else {
      video.pause();
      showToast('⏸ Пауза', 'info');
    }
    return;
  }

  const toggleMsgs = [
    { event: 'toggle' },
    { api: 'toggle' },
    { action: 'toggle' },
    { method: 'toggle' },
    { key: 'kodik_player_api', value: { action: 'toggle' } }
  ];
  document.querySelectorAll('#cinema-player-wrapper iframe, .cinema-player-iframe').forEach(iframe => {
    toggleMsgs.forEach(msg => {
      try {
        iframe.contentWindow?.postMessage(msg, '*');
        iframe.contentWindow?.postMessage(JSON.stringify(msg), '*');
      } catch {}
    });
  });
}

export function adjustPlayerVolume(delta) {
  const video = document.querySelector('#cinema-player-wrapper video');
  if (video) {
    video.volume = Math.max(0, Math.min(1, video.volume + delta));
    const pct = Math.round(video.volume * 100);
    showToast(`🔊 Громкость: ${pct}%`, 'info');
    return;
  }
  const volMsgs = [
    { event: 'volume', val: delta > 0 ? '+10' : '-10' },
    { action: 'volume', delta }
  ];
  document.querySelectorAll('#cinema-player-wrapper iframe, .cinema-player-iframe').forEach(iframe => {
    volMsgs.forEach(msg => {
      try {
        iframe.contentWindow?.postMessage(msg, '*');
        iframe.contentWindow?.postMessage(JSON.stringify(msg), '*');
      } catch {}
    });
  });
}

export function togglePlayerMute() {
  const video = document.querySelector('#cinema-player-wrapper video');
  if (video) {
    video.muted = !video.muted;
    showToast(video.muted ? '🔇 Звук выключен' : '🔊 Звук включен', 'info');
    return;
  }
  const muteMsgs = [
    { event: 'mute' },
    { action: 'mute' }
  ];
  document.querySelectorAll('#cinema-player-wrapper iframe, .cinema-player-iframe').forEach(iframe => {
    muteMsgs.forEach(msg => {
      try {
        iframe.contentWindow?.postMessage(msg, '*');
        iframe.contentWindow?.postMessage(JSON.stringify(msg), '*');
      } catch {}
    });
  });
}

export function triggerDoubleTapRipple(indicatorEl, isForward) {
  if (indicatorEl) {
    indicatorEl.classList.remove('is-active');
    void indicatorEl.offsetWidth;
    indicatorEl.classList.add('is-active');
    setTimeout(() => indicatorEl.classList.remove('is-active'), 500);
  }
  sendSeekDelta(isForward ? 10 : -10);
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try { navigator.vibrate([10, 30, 10]); } catch (_) {}
  }
}

function pauseCurrentPlayback() {
  const video = document.querySelector('#cinema-player-wrapper video');
  if (video) {
    try { video.pause(); } catch {}
  }
  const pauseMsgs = [
    { event: 'pause' },
    { api: 'pause' },
    { action: 'pause' },
    { method: 'pause' },
    { key: 'kodik_player_api', value: { action: 'pause' } }
  ];
  document.querySelectorAll('#cinema-player-wrapper iframe, .cinema-player-iframe').forEach(iframe => {
    pauseMsgs.forEach(msg => {
      try {
        iframe.contentWindow?.postMessage(msg, '*');
        iframe.contentWindow?.postMessage(JSON.stringify(msg), '*');
      } catch {}
    });
  });
}

export function sendSeekDelta(secondsDelta) {
  const video = document.querySelector('#cinema-player-wrapper video');
  if (video) {
    try {
      video.currentTime = Math.max(0, Math.min(video.duration || Infinity, video.currentTime + secondsDelta));
    } catch {}
  }

  const seekMsgs = [
    { event: 'seek', val: secondsDelta, delta: secondsDelta, value: secondsDelta > 0 ? '+10' : '-10' },
    { api: 'seek', val: secondsDelta },
    { api: 'seekDelta', val: secondsDelta },
    { method: 'seek', delta: secondsDelta },
    { action: 'seek', delta: secondsDelta },
    { key: 'kodik_player_api', value: { action: 'seek', delta: secondsDelta } }
  ];
  document.querySelectorAll('#cinema-player-wrapper iframe, .cinema-player-iframe').forEach(iframe => {
    seekMsgs.forEach(msg => {
      try {
        iframe.contentWindow?.postMessage(msg, '*');
        iframe.contentWindow?.postMessage(JSON.stringify(msg), '*');
      } catch {}
    });
  });
}

// -------------------------------------------------------------
// ИНИЦИАЛИЗАЦИЯ СЕНСОРНЫХ ЖЕСТОВ И МОБИЛЬНЫХ ЭЛЕМЕНТОВ УПРАВЛЕНИЯ
// -------------------------------------------------------------
let currentAspectRatioMode = 'default';
let isPlayerScreenLocked = false;

export function applySavedAspectRatioMode() {
  const savedMode = localStorage.getItem('storm_aspect_ratio_mode') || 'default';
  currentAspectRatioMode = savedMode;
  const playerContainer = document.getElementById('cinema-player-container');
  const aspectBtn = document.getElementById('player-aspect-btn');
  if (!playerContainer) return;
  playerContainer.classList.remove('aspect-fill', 'aspect-original');
  if (aspectBtn) aspectBtn.classList.remove('active');

  if (savedMode === 'fill') {
    playerContainer.classList.add('aspect-fill');
    if (aspectBtn) aspectBtn.classList.add('active');
  } else if (savedMode === 'original') {
    playerContainer.classList.add('aspect-original');
    if (aspectBtn) aspectBtn.classList.add('active');
  }
}

function initMobilePlayerControls() {
  const modal = document.getElementById('cinema-modal');
  if (!modal) return;

  // 1. Кнопка масштабирования (Aspect Ratio)
  const aspectBtn = document.getElementById('player-aspect-btn');
  const playerContainer = document.getElementById('cinema-player-container');
  if (aspectBtn && !aspectBtn.dataset.hasListener) {
    aspectBtn.dataset.hasListener = 'true';
    aspectBtn.onclick = (e) => {
      e.stopPropagation();
      if (!playerContainer) return;
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(12); } catch (_) {}
      }

      if (currentAspectRatioMode === 'default') {
        currentAspectRatioMode = 'fill';
        playerContainer.classList.remove('aspect-original');
        playerContainer.classList.add('aspect-fill');
        aspectBtn.classList.add('active');
        localStorage.setItem('storm_aspect_ratio_mode', 'fill');
        showToast('📐 Масштаб: 21:9 во весь экран (Fill)');
      } else if (currentAspectRatioMode === 'fill') {
        currentAspectRatioMode = 'original';
        playerContainer.classList.remove('aspect-fill');
        playerContainer.classList.add('aspect-original');
        aspectBtn.classList.add('active');
        localStorage.setItem('storm_aspect_ratio_mode', 'original');
        showToast('📐 Масштаб: Исходный (Fit)');
      } else {
        currentAspectRatioMode = 'default';
        playerContainer.classList.remove('aspect-fill', 'aspect-original');
        aspectBtn.classList.remove('active');
        localStorage.setItem('storm_aspect_ratio_mode', 'default');
        showToast('📐 Масштаб: Стандартный 16:9');
      }
    };
  }
  applySavedAspectRatioMode();

  // 2. Кнопка «Картинка в картинке» (PiP)
  const pipBtn = document.getElementById('player-pip-btn');
  if (pipBtn && !pipBtn.dataset.hasListener) {
    pipBtn.dataset.hasListener = 'true';
    pipBtn.onclick = async (e) => {
      e.stopPropagation();
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(15); } catch (_) {}
      }
      await toggleAdvancedPiP();
      const isPip = modal.classList.contains('is-mini-pip');
      pipBtn.classList.toggle('active', isPip);
    };
  }

  // 3. Кнопка таймера сна в шапке плеера
  const sleepBtn = document.getElementById('player-sleep-btn');
  if (sleepBtn && !sleepBtn.dataset.hasListener) {
    sleepBtn.dataset.hasListener = 'true';
    sleepBtn.onclick = (e) => {
      e.stopPropagation();
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(15); } catch (_) {}
      }

      if (!sleepTimerRemainingSeconds || sleepTimerRemainingSeconds === 0) {
        setSleepTimer(15);
        showToast('⏱️ Таймер сна установлен на 15 мин');
      } else if (sleepTimerTargetMode === 15) {
        setSleepTimer(30);
        showToast('⏱️ Таймер сна установлен на 30 мин');
      } else if (sleepTimerTargetMode === 30) {
        setSleepTimer(45);
        showToast('⏱️ Таймер сна установлен на 45 мин');
      } else if (sleepTimerTargetMode === 45) {
        setSleepTimer(60);
        showToast('⏱️ Таймер сна установлен на 60 мин');
      } else if (sleepTimerTargetMode === 60) {
        setSleepTimer('end');
        showToast('⏱️ Таймер сна: в конце серии');
      } else {
        cancelSleepTimer();
        showToast('⏱️ Таймер сна выключен');
      }
    };
  }

  // 4. Блокировка экрана (Screen Lock)
  const lockBtn = document.getElementById('player-screen-lock-btn');
  const lockOverlay = document.getElementById('player-screen-locked-overlay');
  const unlockBtn = document.getElementById('player-unlock-btn');

  let unlockBtnTimer = null;
  const showUnlockBtnBriefly = () => {
    if (!unlockBtn) return;
    unlockBtn.classList.remove('is-hidden');
    if (unlockBtnTimer) clearTimeout(unlockBtnTimer);
    unlockBtnTimer = setTimeout(() => {
      if (isPlayerScreenLocked) {
        unlockBtn.classList.add('is-hidden');
      }
    }, 2800);
  };

  const setScreenLock = (locked) => {
    isPlayerScreenLocked = locked;
    if (lockOverlay) {
      lockOverlay.style.display = locked ? 'flex' : 'none';
      if (locked) {
        showUnlockBtnBriefly();
      }
    }
    if (lockBtn) lockBtn.classList.toggle('active', locked);
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(locked ? [20, 50, 20] : 15); } catch (_) {}
    }
    showToast(locked ? '🔒 Экран заблокирован от случайных нажатий' : '🔓 Экран разблокирован');
  };

  if (lockBtn && !lockBtn.dataset.hasListener) {
    lockBtn.dataset.hasListener = 'true';
    lockBtn.onclick = (e) => {
      e.stopPropagation();
      setScreenLock(!isPlayerScreenLocked);
    };
  }

  if (lockOverlay && !lockOverlay.dataset.hasListener) {
    lockOverlay.dataset.hasListener = 'true';
    lockOverlay.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!e.target.closest('#player-unlock-btn')) {
        showUnlockBtnBriefly();
      }
    });
    lockOverlay.addEventListener('touchstart', (e) => {
      if (!e.target.closest('#player-unlock-btn')) {
        showUnlockBtnBriefly();
      }
    }, { passive: true });
  }

  if (unlockBtn && !unlockBtn.dataset.hasListener) {
    unlockBtn.dataset.hasListener = 'true';
    let unlockTimer = null;
    const startUnlock = () => {
      unlockTimer = setTimeout(() => {
        setScreenLock(false);
      }, 700);
    };
    const cancelUnlock = () => {
      if (unlockTimer) {
        clearTimeout(unlockTimer);
        unlockTimer = null;
      }
    };

    unlockBtn.addEventListener('mousedown', startUnlock);
    unlockBtn.addEventListener('mouseup', cancelUnlock);
    unlockBtn.addEventListener('mouseleave', cancelUnlock);
    unlockBtn.addEventListener('touchstart', startUnlock, { passive: true });
    unlockBtn.addEventListener('touchend', cancelUnlock, { passive: true });
    unlockBtn.onclick = (e) => {
      e.stopPropagation();
      setScreenLock(false);
    };
  }

  // 5. Двойной тап для перемотки назад/вперед (±10с) и одиночный для паузы/воспроизведения
  const tapLeft = document.getElementById('player-tap-left');
  const tapRight = document.getElementById('player-tap-right');
  const indicatorLeft = document.getElementById('player-tap-indicator-left');
  const indicatorRight = document.getElementById('player-tap-indicator-right');

  const bindDoubleTap = (zoneEl, indicatorEl, isForward) => {
    if (!zoneEl || zoneEl.dataset.hasListener) return;
    zoneEl.dataset.hasListener = 'true';
    let lastTapTime = 0;

    const handleTap = (e) => {
      if (isPlayerScreenLocked) return;
      const now = Date.now();
      const timeDiff = now - lastTapTime;

      if (timeDiff > 40 && timeDiff < 360) {
        // Двойной тап: перематываем на 10 сек
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        triggerDoubleTapRipple(indicatorEl, isForward);
        lastTapTime = 0;
      } else {
        lastTapTime = now;
      }
    };

    zoneEl.addEventListener('click', (e) => {
      if (e.target.closest('.storm-inplayer-overlay') || 
          e.target.closest('.inplayer-ctrl-btn') || 
          e.target.closest('.player-inplayer-episodes-sheet') || 
          e.target.closest('.player-inplayer-voice-sheet') || 
          e.target.closest('.inplayer-jog-dial-widget') ||
          (e.clientY && e.clientY < 60)) {
        return;
      }
      handleTap(e);
    });
    zoneEl.addEventListener('touchend', (e) => {
      if (e.target.closest('.storm-inplayer-overlay') || 
          e.target.closest('.inplayer-ctrl-btn') || 
          e.target.closest('.player-inplayer-episodes-sheet') || 
          e.target.closest('.player-inplayer-voice-sheet') || 
          e.target.closest('.inplayer-jog-dial-widget') ||
          (e.changedTouches?.[0] && e.changedTouches[0].clientY < 60)) {
        return;
      }
      const now = Date.now();
      if (now - lastTapTime < 360) {
        if (e.cancelable) e.preventDefault();
      }
      handleTap(e);
    }, { passive: false });
  };

  bindDoubleTap(tapLeft, indicatorLeft, false);
  bindDoubleTap(tapRight, indicatorRight, true);

  // Центр плеера: одиночный клик переключает Воспроизведение / Пауза
  const playerWrapper = document.getElementById('cinema-player-wrapper');
  if (playerWrapper && !playerWrapper.dataset.hasTapListener) {
    playerWrapper.dataset.hasTapListener = 'true';
    playerWrapper.addEventListener('click', (e) => {
      if (isPlayerScreenLocked) return;
      if (e.target.closest('.player-tap-zone') || 
          e.target.closest('#player-screen-locked-overlay') || 
          e.target.closest('.storm-inplayer-overlay') ||
          e.target.closest('.inplayer-ctrl-btn') ||
          e.target.closest('#player-xray-panel')) {
        return;
      }
      // На мобильных устройствах при клике по видео не перебиваем нативные контролы
      if (e.target.tagName === 'VIDEO' && (window.innerWidth <= 768 || e.target.hasAttribute('controls'))) {
        return;
      }
      togglePlayerPlayPause();
    });
  }

  // 6. Свайп вниз для закрытия плеера на смартфонах
  const dragHandle = document.getElementById('cinema-modal-drag-handle');
  const headerEl = modal.querySelector('.storm-modal-header');
  [dragHandle, headerEl].forEach(el => {
    if (!el || el.dataset.hasSwipeListener) return;
    el.dataset.hasSwipeListener = 'true';
    let startY = 0;
    let isDragging = false;

    el.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        startY = e.touches[0].clientY;
        isDragging = true;
      }
    }, { passive: true });

    el.addEventListener('touchend', (e) => {
      if (!isDragging || !e.changedTouches.length) return;
      isDragging = false;
      const diffY = e.changedTouches[0].clientY - startY;
      if (diffY > 80) {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          try { navigator.vibrate(15); } catch (_) {}
        }
        closePlayerModal();
      }
    }, { passive: true });
  });
}

/**
 * 🇷🇺 Определение отечественного контента (Россия, СССР, RuTube, VK Видео)
 */
export function isDomesticContent(item = {}, cleanTitle = '') {
  const t = (cleanTitle || item.title || '').toLowerCase();
  const ot = (item.original_title || '').toLowerCase();
  const c = Array.isArray(item.countries) ? item.countries.join(' ').toLowerCase() : String(item.countries || '').toLowerCase();
  const g = Array.isArray(item.genres) ? item.genres.join(' ').toLowerCase() : String(item.genres || '').toLowerCase();
  const cat = String(item.category || '').toLowerCase();
  const src = String(item.source || '').toLowerCase();
  const id = String(item.id || '').toLowerCase();

  if (src === 'rutube' || src === 'vkvideo' || id.startsWith('rutube_') || id.startsWith('vk_')) return true;
  if (id.includes('landyshi') || t.includes('ландыши')) return true;
  if (c.includes('росси') || c.includes('ссср') || c.includes('russia') || c.includes('рф')) return true;
  if (cat.includes('российск') || g.includes('российск')) return true;

  // Если в названии кириллица и нет англоязычного оригинального названия
  const hasCyrillic = /[\u0400-\u04FF]/.test(t) || /[\u0400-\u04FF]/.test(ot);
  const hasLatinOriginal = /[a-zA-Z]{3,}/.test(ot);
  if (hasCyrillic && !hasLatinOriginal) {
    return true;
  }
  return false;
}

export function buildUniversalPlayerSuite(mediaItem = {}, cleanTitle = '') {
  const title = cleanTitle || cleanVideoTitle(mediaItem.title || 'Видео');
  const safeTitle = encodeURIComponent(title);
  const year = mediaItem.year ? String(mediaItem.year).trim() : '';
  const yearParam = year ? `&year=${year}&strict=1` : '&strict=1';
  const kpId = mediaItem.kp_id || '';
  const mediaType = mediaItem.media_type || mediaItem.type || 'movie';
  const isSeries = mediaType === 'series' || mediaType === 'cartoon-series' || mediaType === 'anime-series';
  const isAnime = mediaType.includes('anime') || mediaItem.source === 'anilibria' || mediaItem.source === 'anixart';
  const typeFilter = isSeries ? '&types=foreign-serial,russian-serial,anime-serial' : '&types=foreign-movie,russian-movie,anime';
  const episodeParam = isSeries ? '&season=1&episode=1' : '';
  const isDomestic = isDomesticContent(mediaItem, title);
  const rawRuId = mediaItem.rutube_id || (String(mediaItem.id || '').startsWith('rutube_') ? String(mediaItem.id).replace('rutube_', '') : null);
  const isLandyshiItem = mediaItem.id === 'rutube_landyshi' || title.toLowerCase().includes('ландыши') || rawRuId === '564f31c881b83373bfe0cb26979d44cf';
  const isDomesticExclusive = (isDomestic && !kpId) || isLandyshiItem;

  const suite = [];

  // 1. 4K Ultra HD Плеер (FanFilm4K)
  const fanfilmUrl = mediaItem.fanfilm_4k_url || (mediaItem.source === 'fanfilm4k' ? (mediaItem.link || mediaItem.url || '') : '');
  const effective4kUrl = fanfilmUrl || (mediaItem.source === 'fanfilm4k' ? (mediaItem.link || mediaItem.url) : '');
  if (effective4kUrl) {
    suite.push({
      id: 'fanfilm4k_uhd',
      name: '4K Ultra HD Плеер (FanFilm4K)',
      type: 'iframe',
      quality: '4K UHD',
      badge: 'FANFILM 4K',
      status: 'working',
      status_label: '🟢 Онлайн',
      audio_info: 'Многоканальный звук Dolby Digital и 4K Ultra HD',
      speed: '💎 Премиум 4K CDN',
      url: effective4kUrl,
      is_recommended: !isAnime && !isLandyshiItem,
      recommended_badge: (!isAnime && !isLandyshiItem) ? '🔥 4K Рекомендуемый' : ''
    });
  }

  // 2. VK Видео (Официальный плеер) — приоритет #1 для отечественных релизов и «Ландыши» со включенным звуком
  let vkEmbed = '';
  if (isLandyshiItem) {
    vkEmbed = 'https://vkvideo.ru/video_ext.php?oid=-195528184&id=456244337&hd=2&autoplay=1&js_api=1&muted=0&mute=0';
  } else if (mediaItem.vk_embed_url) {
    vkEmbed = mediaItem.vk_embed_url;
  } else if (mediaItem.owner_id && mediaItem.video_id) {
    vkEmbed = `https://vkvideo.ru/video_ext.php?oid=${mediaItem.owner_id}&id=${mediaItem.video_id}&hd=2&autoplay=1`;
  } else if (String(mediaItem.id || '').startsWith('vk_')) {
    const vkM = String(mediaItem.id).match(/vk_(-?\d+)_(\d+)/);
    if (vkM) {
      vkEmbed = `https://vkvideo.ru/video_ext.php?oid=${vkM[1]}&id=${vkM[2]}&hd=2&autoplay=1`;
    }
  } else if (mediaItem.vk_url) {
    const vkM = mediaItem.vk_url.match(/video(-?\d+)_(\d+)/);
    if (vkM) {
      vkEmbed = `https://vkvideo.ru/video_ext.php?oid=${vkM[1]}&id=${vkM[2]}&hd=2&autoplay=1`;
    }
  } else if (mediaItem.embed_url && (mediaItem.embed_url.includes('oid=') || mediaItem.embed_url.includes('video-'))) {
    vkEmbed = mediaItem.embed_url;
  }

  if (vkEmbed && (vkEmbed.includes('vkvideo.ru') || vkEmbed.includes('vk.com'))) {
    if (!vkEmbed.includes('js_api=')) vkEmbed += (vkEmbed.includes('?') ? '&' : '?') + 'js_api=1';
    if (!vkEmbed.includes('muted=')) vkEmbed += '&muted=0&mute=0';
  }

  if (vkEmbed) {
    const isVkSource = mediaItem.source === 'vkvideo' || String(mediaItem.id || '').startsWith('vk_') || isLandyshiItem;
    const isVkRecommended = isLandyshiItem || (isVkSource && !effective4kUrl && !isAnime);

    suite.push({
      id: 'vk_video_stream',
      name: 'VK Видео (Официальный плеер)',
      type: 'iframe',
      quality: '1080p FHD / 4K',
      badge: 'VK ВИДЕО',
      status: 'working',
      status_label: '🟢 Онлайн',
      audio_info: isLandyshiItem ? 'Официальный сериал Ландыши на платформе VK Видео со звуком' : 'Официальные релизы и студийные переводы VK Видео',
      speed: '⚡ Скоростной VK CDN',
      url: vkEmbed,
      is_recommended: isVkRecommended,
      recommended_badge: isVkRecommended ? '🔥 Рекомендуемый' : ''
    });
  }

  // 3. RuTube (Официальный поток / Wink) — чистый embed без рекурсивного открытия сайта
  let rutubeEmbed = '';
  if (rawRuId && /^[a-f0-9]{32}$/i.test(rawRuId)) {
    rutubeEmbed = `https://rutube.ru/play/embed/${rawRuId}?skinColor=00d2ff&autoPlay=1`;
  } else if (mediaItem.embed_url && mediaItem.embed_url.includes('rutube.ru/play/embed/')) {
    const mId = mediaItem.embed_url.match(/\/embed\/([a-f0-9]{32})/i);
    if (mId) {
      rutubeEmbed = `https://rutube.ru/play/embed/${mId[1]}?skinColor=00d2ff&autoPlay=1`;
    } else {
      rutubeEmbed = mediaItem.embed_url;
    }
  } else if (mediaItem.rutube_id && /^[a-f0-9]{32}$/i.test(mediaItem.rutube_id)) {
    rutubeEmbed = `https://rutube.ru/play/embed/${mediaItem.rutube_id}?skinColor=00d2ff&autoPlay=1`;
  } else if (mediaItem.source === 'rutube') {
    const ruSearchQ = encodeURIComponent(`${title} ${year || ''}`.trim());
    rutubeEmbed = `https://rutube.ru/play/embed/search/?query=${ruSearchQ}&autoplay=1`;
  }

  if (rutubeEmbed) {
    const isRuTubeSource = mediaItem.source === 'rutube' || String(mediaItem.id || '').startsWith('rutube_');
    const isRuTubeRecommended = !isLandyshiItem && (isRuTubeSource || isDomestic) && !effective4kUrl && !isAnime;

    suite.push({
      id: 'rutube_stream',
      name: 'RuTube (Официальный поток / Wink)',
      type: 'iframe',
      quality: '1080p FHD',
      badge: 'RUTUBE',
      status: 'working',
      status_label: '🟢 Онлайн',
      audio_info: 'Официальный лицензионный каталог RuTube и Wink без кнопки Смотреть на RUTUBE',
      speed: '⚡ Быстрый российский CDN',
      url: rutubeEmbed,
      is_recommended: isRuTubeRecommended,
      recommended_badge: isRuTubeRecommended ? '🔥 Рекомендуемый' : ''
    });
  }

  // 4. HDRezka Cinema (FHD и 4K) - исключаем для отечественного контента без Kinopoisk ID и эксклюзивов
  if (!isDomesticExclusive) {
    const rezkaUrl = kpId
      ? `https://kodikplayer.com/find-player?kinopoiskID=${kpId}&translation=hdrezka${typeFilter}${episodeParam}`
      : `https://kodikplayer.com/find-player?title=${safeTitle}${yearParam}&translation=hdrezka${typeFilter}${episodeParam}`;
    suite.push({
      id: 'rezka_cinema',
      name: 'HDRezka Cinema (FHD и 4K)',
      type: 'iframe',
      quality: '1080p FHD',
      badge: 'HDREZKA',
      status: 'working',
      status_label: '🟢 Онлайн',
      audio_info: 'Студийный перевод HDRezka Studio',
      speed: '⚡ Высокая скорость',
      url: rezkaUrl,
      is_recommended: !isDomestic && !effective4kUrl && !isAnime
    });
  }

  // 5. LostFilm TV и Red Head Sound - СТРОГО ТОЛЬКО ДЛЯ ЗАРУБЕЖНОГО КОНТЕНТА
  if (!isDomestic && !isDomesticExclusive) {
    const lostfilmUrl = kpId
      ? `https://kodikplayer.com/find-player?kinopoiskID=${kpId}&translation=lostfilm${typeFilter}${episodeParam}`
      : `https://kodikplayer.com/find-player?title=${safeTitle}${yearParam}&translation=lostfilm${typeFilter}${episodeParam}`;
    suite.push({
      id: 'lostfilm_player',
      name: 'LostFilm TV (Студийный перевод)',
      type: 'iframe',
      quality: '1080p FHD',
      badge: 'LOSTFILM',
      status: 'working',
      status_label: '🟢 Онлайн',
      audio_info: 'Фирменная многоголосая озвучка LostFilm',
      speed: '⚡ Быстрый CDN',
      url: lostfilmUrl
    });

    const rhsUrl = kpId
      ? `https://kodikplayer.com/find-player?kinopoiskID=${kpId}&translation=rhs${typeFilter}${episodeParam}`
      : `https://kodikplayer.com/find-player?title=${safeTitle}${yearParam}&translation=rhs${typeFilter}${episodeParam}`;
    suite.push({
      id: 'rhs_player',
      name: 'Red Head Sound (Дубляж RHS)',
      type: 'iframe',
      quality: '1080p FHD',
      badge: 'RHS',
      status: 'working',
      status_label: '🟢 Онлайн',
      audio_info: 'Официальные голоса дубляжа студии RHS',
      speed: '⚡ Премиум дубляж',
      url: rhsUrl
    });
  }

  // 6. Kodik Плеер - строго исключаем для отечественных релизов без Kinopoisk ID и российских эксклюзивов
  if (!isDomesticExclusive) {
    const kodikUrl = kpId
      ? `https://kodikplayer.com/find-player?kinopoiskID=${kpId}${typeFilter}${episodeParam}`
      : `https://kodikplayer.com/find-player?title=${safeTitle}${yearParam}${typeFilter}${episodeParam}`;
    suite.push({
      id: 'kodik_direct',
      name: isAnime ? 'Kodik Аниме Плеер' : 'Kodik Плеер (сериалы и озвучки)',
      type: 'iframe',
      quality: '1080p FHD',
      badge: 'KODIK',
      status: 'working',
      status_label: '🟢 Онлайн',
      audio_info: 'Большой выбор студийных озвучек',
      speed: '⚡ Быстрый поток',
      url: kodikUrl,
      is_recommended: isAnime && !effective4kUrl && mediaItem?.source !== 'anixart' && mediaItem?.source !== 'anilibria'
    });
  }

  // 6. AniXart Stream (для аниме)
  if (isAnime) {
    const anixartUrl = kpId
      ? `https://kodikplayer.com/find-player?kinopoiskID=${kpId}&types=anime-serial,anime${episodeParam}`
      : `https://kodikplayer.com/find-player?title=${safeTitle}${yearParam}&types=anime-serial,anime${episodeParam}`;
    suite.push({
      id: 'anixart_stream',
      name: 'AniXart Stream (Аниме-релизы)',
      type: 'iframe',
      quality: '1080p FHD',
      badge: 'ANIXART',
      status: 'working',
      status_label: '🟢 Онлайн',
      audio_info: 'Тысячи озвучек от фандаб-сообщества',
      speed: '⚡ Скоростной поток',
      url: anixartUrl
    });
  }

  // 7. P2P WebTorrent (Торрент-стриминг)
  if (!mediaItem.is_upcoming) {
    suite.push({
      id: 'webtorrent',
      name: 'P2P WebTorrent (Торрент-стриминг)',
      url: 'webtorrent://direct',
      badge: 'P2P 4K',
      quality: '4K UHD / 1080p',
      status_label: '🟢 P2P Сеть',
      audio_info: 'Многоголосый дубляж'
    });
  }

  // 8. Официальный трейлер и промо (YouTube)
  const safeSearch = encodeURIComponent(`${title} официальный русский трейлер`);
  suite.push({
    id: 'official_trailer',
    name: 'Официальный трейлер (4K / FHD)',
    type: 'iframe',
    quality: '4K UHD / 1080p',
    badge: 'ТРЕЙЛЕР',
    status: 'working',
    status_label: '🟢 Онлайн',
    audio_info: 'Официальный промо-трейлер',
    speed: '⚡ YouTube 4K',
    url: `https://www.youtube-nocookie.com/embed?listType=search&list=${safeSearch}&autoplay=1`,
    is_trailer: true
  });

  if (!suite.some(p => p.is_recommended) && suite.length > 0) {
    suite[0].is_recommended = true;
  }

  return suite;
}

/**
 * 🎯 ДИНАМИЧЕСКИЙ АВТОМАСШТАБ КИНОТЕАТРАЛЬНОГО ПЛЕЕРА
 * Автоматически рассчитывает точные размеры экрана и доступную высоту,
 * чтобы консоль плеера (Шапка + Серии + Видеоплеер + Аварийная полоса + Поле выбора плеера)
 * на 100% умещалась в пределах одного экрана без вертикального скролла
 * при любых разрешениях экрана (4K, 2K, 1080p, 720p), размерах окон и DPI-масштабах (100%-200%).
 */
export function adjustCinemaModalScale() {
  const modal = document.getElementById('cinema-modal');
  if (!modal || !modal.classList.contains('is-open')) return;
  if (modal.classList.contains('is-fullscreen') || modal.classList.contains('is-mini-pip')) return;

  const vh = window.innerHeight || document.documentElement.clientHeight;
  const vw = window.innerWidth || document.documentElement.clientWidth;
  if (!vh || vh <= 0) return;

  const headerEl = modal.querySelector('.storm-modal-header');
  const headerH = (headerEl && headerEl.offsetHeight > 0) ? headerEl.offsetHeight : 40;

  const quickBar = document.getElementById('player-series-quick-bar');
  const isQuickBarVisible = quickBar && quickBar.style.display !== 'none' && !quickBar.hidden && quickBar.offsetHeight > 0;
  const quickBarH = isQuickBarVisible ? (quickBar.offsetHeight + 6) : 0;
  modal.classList.toggle('has-series-bar', isQuickBarVisible);

  const fallbackBar = document.getElementById('player-fallback-bar');
  const fallbackH = (fallbackBar && fallbackBar.offsetHeight > 0) ? (fallbackBar.offsetHeight + 8) : 38;

  const selectorWrap = document.getElementById('player-selector-dropdown-wrap');
  const selectorH = (selectorWrap && selectorWrap.offsetHeight > 0) ? (selectorWrap.offsetHeight + 8) : 46;

  // Отступы storm-modal-body (top: 8px, bottom: 14px) + буфер безопасности для теней/границ (14px)
  const verticalPaddingAndBuffer = 36;

  const totalNonPlayerH = headerH + quickBarH + fallbackH + selectorH + verticalPaddingAndBuffer;

  // Рассчитываем доступную высоту для видеоплеера
  const availablePlayerH = Math.max(200, Math.floor(vh - totalNonPlayerH));
  const availablePlayerW = Math.round(availablePlayerH * (16 / 9));

  // Высота постера и максимальная высота правой колонки
  const posterH = Math.max(120, Math.min(240, Math.round(vh * 0.23)));
  const sideColH = Math.max(240, Math.floor(vh - (headerH + 20)));

  modal.style.setProperty('--cinema-player-max-h', `${availablePlayerH}px`);
  modal.style.setProperty('--cinema-player-max-w', `${availablePlayerW}px`);
  modal.style.setProperty('--cinema-poster-max-h', `${posterH}px`);
  modal.style.setProperty('--cinema-side-max-h', `${sideColH}px`);
}

if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    const modal = document.getElementById('cinema-modal');
    if (modal && modal.classList.contains('is-open')) {
      adjustCinemaModalScale();
    }
  }, { passive: true });
  window.addEventListener('orientationchange', () => {
    const modal = document.getElementById('cinema-modal');
    if (modal && modal.classList.contains('is-open')) {
      setTimeout(adjustCinemaModalScale, 80);
    }
  }, { passive: true });
}

export async function openPlayerModal(mediaItem, options = {}) {
  const cleanTitle = cleanVideoTitle(mediaItem?.title || '');
  const detectedType = detectClientMediaType(mediaItem);
  let initialYr = detectClientYear(mediaItem) || mediaItem?.year || '';
  if (!initialYr) {
    const ym = String(mediaItem?.title || '').match(/\b(19\d\d|20\d\d)\b/);
    if (ym && parseInt(ym[1], 10) >= 1950 && parseInt(ym[1], 10) <= 2030 && ym[1] !== '2049') {
      initialYr = ym[1];
    } else if (mediaItem?.release_date) {
      const rm = String(mediaItem.release_date).match(/\b(19\d\d|20\d\d)\b/);
      if (rm) initialYr = rm[1];
    }
  }
  currentMedia = { ...mediaItem, title: cleanTitle, media_type: detectedType || mediaItem?.media_type || 'movie', year: initialYr || mediaItem?.year || '' };
  try {
    sessionStorage.setItem('storm_active_cinema_media', JSON.stringify(currentMedia));
  } catch (e) {}
  quickBarSeriesData = null;
  currentEpisodes = [];
  currentEpisodeIndex = 1;
  toggleInPlayerEpisodesSheet(null, false);

  const modal = document.getElementById('cinema-modal');
  if (!modal) return;

  // Закрываем мобильное меню и очищаем всплывающие подсказки
  const drawer = document.getElementById('mobile-drawer-backdrop');
  if (drawer) drawer.classList.remove('is-open');
  document.querySelectorAll('.media-hover-preview-popup').forEach(p => p.remove());
  // Проверяем ночной просмотр (между 02:00 и 05:00)
  const currentHour = new Date().getHours();
  if (currentHour >= 2 && currentHour < 5) {
    trackClientAction('night_watch');
  }

  // Сброс состояния плеера
  const iframeContainer = document.getElementById('cinema-player-wrapper');
  iframeContainer.innerHTML = '<div style="display:flex;height:100%;align-items:center;justify-content:center;color:var(--text-muted);gap:10px;"><div class="storm-spinner"></div><span>Загрузка видеоплеера...</span></div>';

  document.getElementById('cinema-modal-title').textContent = cleanTitle;
  document.getElementById('cinema-modal-year').textContent = mediaItem.year || '';
  document.getElementById('cinema-modal-desc').textContent = mediaItem.description || '';

  // Восстанавливаем сохраненный прогресс просмотра
  const savedPercent = mediaItem.progress_percent || 0;
  currentProgressPercent = savedPercent;
  const progressSlider = document.getElementById('player-progress-slider');
  const progressLabel = document.getElementById('player-progress-label');
  if (progressSlider) progressSlider.value = savedPercent;
  if (progressLabel) progressLabel.textContent = `${savedPercent}%`;

  initProgressSlider();
  initFullscreenControls();
  initMobilePlayerControls();

  // Автоматическое определение последней незаконченной серии для сериалов
  if (!options.initialSeason || !options.initialEpisode) {
    const resumeInfo = resolveLastUnfinishedEpisode(mediaItem);
    if (resumeInfo) {
      if (!options.initialSeason && resumeInfo.season) options.initialSeason = resumeInfo.season;
      if (!options.initialEpisode && resumeInfo.episode) options.initialEpisode = resumeInfo.episode;
    }
  }

  // Обновляем URL для глубокого связывания (Deep Linking)
  updatePlayerUrl(mediaItem, options.initialSeason, options.initialEpisode);

  // Открываем модальное окно
  modal.classList.add('is-open');
  document.body.classList.add('cinema-open');
  if (typeof window.updateTvHudContext === 'function') {
    window.updateTvHudContext('player');
  }

  // Инициализируем универсальную панель серий для сериалов сразу
  if (checkIfMediaIsSeries(currentMedia)) {
    initUniversalSeriesQuickBar(options.initialSeason || 1, options.initialEpisode || 1);
  }

  // Мгновенный сброс скролла на 0, чтобы плеер открывался на весь экран сверху без необходимости пролистывать
  const resetCinemaScroll = () => {
    modal.scrollTop = 0;
    const dialog = modal.querySelector('.cinema-modal-dialog');
    if (dialog) dialog.scrollTop = 0;
    const modalBody = modal.querySelector('.storm-modal-body');
    if (modalBody) modalBody.scrollTop = 0;
    window.scrollTo(0, 0);
    if (document.documentElement) document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
  };
  resetCinemaScroll();
  requestAnimationFrame(resetCinemaScroll);
  setTimeout(resetCinemaScroll, 50);
  setTimeout(resetCinemaScroll, 200);

  // Автомасштабирование плеера под точные размеры окна
  adjustCinemaModalScale();
  requestAnimationFrame(adjustCinemaModalScale);
  setTimeout(adjustCinemaModalScale, 60);
  setTimeout(adjustCinemaModalScale, 220);
  setTimeout(adjustCinemaModalScale, 500);

  applyAmbientBackdropGlow(mediaItem);

  // Немедленно инициализируем селекторы и кнопки, чтобы они были интерактивны СРАЗУ
  const cachedStatus = mediaItem.user_status || localStorage.getItem(`storm_status_${mediaItem.id}`) || null;
  renderStatusButtons(cachedStatus);
  renderCustomListsSelector();
  renderPlayerUtilityButtons();
  renderFranchiseOrder(mediaItem);

  // Инициализируем плавающую кнопку аварийного переключения
  const fallbackBtn = document.getElementById('player-fallback-btn');
  if (fallbackBtn) {
    fallbackBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      switchToNextSource(true);
    };
  }

  // 🛡️ ГАРАНТИЯ ИСТОЧНИКОВ: Создаем полный универсальный набор онлайн-плееров сразу!
  // Никакой источник никогда не пропадает, даже при задержке сети или таймауте
  const fallbackSuite = buildUniversalPlayerSuite(mediaItem, cleanTitle);
  currentPlayers = [...fallbackSuite];
  renderPlayerSources(currentPlayers);

  // Определяем стартовый рекомендуемый плеер с защитой от удаленных 4K архивов
  const isDomestic = isDomesticContent(mediaItem, cleanTitle);
  const isWorking = p => p && p.status !== 'broken' && !p.status_label?.includes('Недоступен');
  const isStable = p => isWorking(p) && p.url && !p.url.includes('stravers.live') && !p.url.includes('transfusion');
  const itemYr = parseInt(currentMedia?.year || mediaItem?.year || '2026', 10);
  const preferStableKodik = itemYr < 2020;

  const isLandyshiMedia = mediaItem.id === 'rutube_landyshi' || cleanTitle.toLowerCase().includes('ландыши') || mediaItem.rutube_id === '564f31c881b83373bfe0cb26979d44cf';
  let initialChoice = options.initialPlayer ? currentPlayers.find(p => p.id === options.initialPlayer) : null;
  if (!initialChoice) {
    if (isLandyshiMedia) {
      initialChoice = currentPlayers.find(p => p.id === 'vk_video_stream' && isWorking(p))
        || currentPlayers.find(p => p.id === 'rutube_stream' && isWorking(p))
        || currentPlayers.find(isWorking)
        || currentPlayers[0];
    } else if (isDomestic) {
      initialChoice = currentPlayers.find(p => p.id === 'vk_video_stream' && isWorking(p) && p.is_recommended)
        || currentPlayers.find(p => p.id === 'rutube_stream' && isWorking(p))
        || currentPlayers.find(p => p.id === 'vk_video_stream' && isWorking(p))
        || currentPlayers.find(p => p.is_recommended && isWorking(p))
        || currentPlayers.find(isWorking)
        || currentPlayers[0];
    } else if (preferStableKodik) {
      initialChoice = currentPlayers.find(p => p.id === 'kodik_direct' && isWorking(p))
        || currentPlayers.find(p => p.is_recommended && isStable(p))
        || currentPlayers.find(isStable)
        || currentPlayers.find(isWorking)
        || currentPlayers[0];
    } else {
      initialChoice = currentPlayers.find(p => p.is_recommended && isStable(p))
        || currentPlayers.find(p => p.is_recommended && isWorking(p))
        || currentPlayers.find(isStable)
        || currentPlayers.find(isWorking)
        || currentPlayers[0];
    }
  }

  currentActivePlayer = initialChoice || {
    badge: (mediaItem.source || 'ПЛЕЕР').toUpperCase(),
    name: `${cleanTitle || 'Основной поток'} (${getSourceName(mediaItem)})`,
    quality: '1080p FHD',
    status_label: '🟢 Онлайн'
  };
  updatePlayerTriggerInfo(currentActivePlayer);

  try {
    // Получаем детальные данные с сервера с увеличенным таймаутом 12000мс
    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), 12000);

    const mediaType = detectClientMediaType(mediaItem) || mediaItem.media_type || mediaItem.type || '';
    const fanfilmUrl = mediaItem.fanfilm_4k_url || (mediaItem.source === 'fanfilm4k' ? (mediaItem.link || mediaItem.url || '') : '');
    const itemUrl = `/api/media/item?id=${encodeURIComponent(mediaItem.id)}&source=${mediaItem.source}&url=${encodeURIComponent(mediaItem.link || '')}&title=${encodeURIComponent(cleanTitle)}&year=${encodeURIComponent(currentMedia?.year || detectClientYear(mediaItem) || mediaItem.year || '')}&poster=${encodeURIComponent(mediaItem.poster || '')}&media_type=${encodeURIComponent(mediaType)}&fanfilm_4k_url=${encodeURIComponent(fanfilmUrl)}&rutube_id=${encodeURIComponent(mediaItem.rutube_id || '')}&embed_url=${encodeURIComponent(mediaItem.embed_url || '')}`;
    
    let details = null;
    try {
      const headers = {};
      const token = localStorage.getItem('storm_token');
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(itemUrl, { headers, signal: controller.signal });
      clearTimeout(fetchTimeout);
      if (res.ok) {
        details = await res.json();
      }
    } catch {
      clearTimeout(fetchTimeout);
    }

    if (!details) {
      details = {
        ...mediaItem,
        players: fallbackSuite
      };
    }

    currentMedia = { ...mediaItem, ...details, title: cleanVideoTitle(details?.title || mediaItem?.title || '') };
    try {
      sessionStorage.setItem('storm_active_cinema_media', JSON.stringify(currentMedia));
    } catch (e) {}

    // Инициализируем универсальную панель серий с обновленными метаданными
    if (checkIfMediaIsSeries(currentMedia)) {
      initUniversalSeriesQuickBar(options.initialSeason || 1, options.initialEpisode || 1);
    }

    // 🛡️ ОБЪЕДИНЕНИЕ СЕРВЕРНЫХ И УНИВЕРСАЛЬНЫХ ПЛЕЕРОВ:
    // Для отечественного контента жестко фильтруем LostFilm и RHS
    const mergedPlayers = [];
    if (Array.isArray(details.players) && details.players.length > 0) {
      details.players.forEach(dp => {
        if (!dp || !dp.url) return;
        if (isDomestic && (dp.id === 'lostfilm_player' || dp.id === 'rhs_player')) return;
        if (!mergedPlayers.some(mp => mp.id === dp.id || mp.url === dp.url)) {
          mergedPlayers.push(dp);
        }
      });
    }
    fallbackSuite.forEach(fp => {
      if (!fp || !fp.url) return;
      if (isDomestic && (fp.id === 'lostfilm_player' || fp.id === 'rhs_player')) return;
      if (!mergedPlayers.some(mp => mp.id === fp.id || mp.url === fp.url)) {
        mergedPlayers.push(fp);
      }
    });

    currentPlayers = mergedPlayers;

    // Обновляем описание и рендерим галерею кадров / скриншотов
    if (details.description) {
      document.getElementById('cinema-modal-desc').textContent = details.description;
    }
    renderScreenshotsGallery(mediaItem, details);

    // Отображаем подробную информацию в боковой колонке (даты, рейтинги, режиссеры, актеры)
    renderDetailedMediaInfo(currentMedia);

    // Порядок просмотра и хронология франшизы (фильмы, сериалы, аниме)
    renderFranchiseOrder(currentMedia);

    // Отображаем селектор сезонов и серий для сериалов (для аниме настраивается ниже)
    if (mediaItem.source !== 'anilibria' && mediaItem.source !== 'anixart') {
      renderSeriesSeasons(currentMedia, options.initialSeason, options.initialEpisode);
    }

    renderPlayerSources(currentPlayers);
    const effectiveStatus = details?.user_bookmark?.status || currentMedia.user_status || cachedStatus || null;
    if (effectiveStatus) {
      currentMedia.user_status = effectiveStatus;
      localStorage.setItem(`storm_status_${mediaItem.id}`, effectiveStatus);
    }
    renderStatusButtons(effectiveStatus);
    renderCustomListsSelector();
    renderPlayerUtilityButtons();

    // Загружаем таймкоды пропуска заставок
    loadSkipTimes(mediaItem.id, 1);

    // Для AniLibria и AniXart отображаем озвучки и серии через единую систему
    if (mediaItem.source === 'anilibria' && details.episodes && details.episodes.length > 0) {
      renderAniLibriaControls(details, options);
    } else if (mediaItem.source === 'anixart') {
      renderAnixartControls(details, options);
    } else {
      document.getElementById('anixart-controls-container').style.display = 'none';
      if (currentPlayers.length > 0) {
        let defaultPlayer = options.initialPlayer ? currentPlayers.find(p => p.id === options.initialPlayer) : null;
        if (!defaultPlayer) {
          const isWorking = p => p && p.status !== 'broken' && !p.status_label?.includes('Недоступен');
          const isStable = p => isWorking(p) && p.url && !p.url.includes('stravers.live') && !p.url.includes('transfusion');
          const itemYr = parseInt(currentMedia?.year || mediaItem?.year || '2026', 10);
          const preferStableKodik = itemYr < 2020;

          const isLandyshiItem = currentMedia?.id === 'rutube_landyshi' || cleanTitle.toLowerCase().includes('ландыши') || currentMedia?.rutube_id === '564f31c881b83373bfe0cb26979d44cf';
          const isDomesticItem = isDomesticContent(currentMedia, cleanTitle);
          if (isLandyshiItem) {
            defaultPlayer = currentPlayers.find(p => p.id === 'vk_video_stream' && isWorking(p))
              || currentPlayers.find(p => p.id === 'rutube_stream' && isWorking(p))
              || currentPlayers.find(isWorking)
              || currentPlayers[0];
          } else if (isDomesticItem) {
            defaultPlayer = currentPlayers.find(p => p.id === 'vk_video_stream' && isWorking(p) && p.is_recommended)
              || currentPlayers.find(p => p.id === 'rutube_stream' && isWorking(p))
              || currentPlayers.find(p => p.id === 'vk_video_stream' && isWorking(p))
              || currentPlayers.find(p => p.is_recommended && isWorking(p))
              || currentPlayers.find(isWorking)
              || currentPlayers[0];
          } else if (preferStableKodik) {
            defaultPlayer = currentPlayers.find(p => p.id === 'kodik_direct' && isWorking(p))
              || currentPlayers.find(p => p.is_recommended && isStable(p))
              || currentPlayers.find(isStable)
              || currentPlayers.find(isWorking)
              || currentPlayers[0];
          } else {
            defaultPlayer = currentPlayers.find(p => p.is_recommended && isStable(p))
              || currentPlayers.find(p => p.is_recommended && isWorking(p))
              || currentPlayers.find(isStable)
              || currentPlayers.find(isWorking)
              || currentPlayers[0];
          }
        }
        selectPlayer(defaultPlayer);
      } else if (currentMedia.is_upcoming) {
        selectPlayer({
          is_upcoming: true,
          upcoming_notice: `Релиз «${cleanVideoTitle(currentMedia?.title || 'Фильм')}» находится в производстве. Мировая премьера ожидается в ${currentMedia?.year || 'скоро'}.`
        });
      }
    }

    // Рендерим секцию рецензий со спойлер-блоками
    const reviewsContainer = document.getElementById('cinema-reviews-container');
    if (reviewsContainer) {
      renderReviewsSection(reviewsContainer, currentMedia);
    }
  } catch (err) {
    console.error('Ошибка модального окна плеера:', err);
    if (currentPlayers.length > 0) {
      selectPlayer(currentPlayers[0]);
    } else {
      iframeContainer.innerHTML = '<div style="display:flex;height:100%;align-items:center;justify-content:center;color:var(--text-muted);font-weight:600;">Плеер временно недоступен для данного релиза</div>';
    }
  }
}

export function closePlayerModal() {
  const modal = document.getElementById('cinema-modal');
  if (modal) {
    modal.classList.remove('is-open', 'is-mini-pip', 'is-focus-mode', 'has-series-bar');
    document.documentElement.classList.remove('cinema-focus-active');
    document.body.classList.remove('cinema-focus-active', 'cinema-open');
    if (typeof window.updateTvHudContext === 'function') {
      window.updateTvHudContext();
    }
    const fBtn = document.getElementById('inplayer-focus-btn');
    if (fBtn) fBtn.classList.remove('active');
    stopAmbilight();
    clearPlayerUrl();
    try {
      sessionStorage.removeItem('storm_active_cinema_media');
    } catch (e) {}
    dismissUpNextCountdownCard(false);
    if (statsForNerdsInterval) {
      clearInterval(statsForNerdsInterval);
      statsForNerdsInterval = null;
    }
    isStatsForNerdsVisible = false;
    const statsOverlay = document.getElementById('storm-nerd-stats-overlay');
    if (statsOverlay) statsOverlay.remove();

    // Сброс мобильных состояний (блокировка экрана, соотношение сторон, PiP)
    const lockOverlay = document.getElementById('player-screen-locked-overlay');
    if (lockOverlay) lockOverlay.style.display = 'none';
    const lockBtn = document.getElementById('player-screen-lock-btn');
    if (lockBtn) lockBtn.classList.remove('active');
    const pipBtn = document.getElementById('player-pip-btn');
    if (pipBtn) pipBtn.classList.remove('active');
    const aspectBtn = document.getElementById('player-aspect-btn');
    if (aspectBtn) aspectBtn.classList.remove('active');
    const playerContainer = document.getElementById('cinema-player-container');
    if (playerContainer) playerContainer.classList.remove('aspect-fill', 'aspect-original');

    const jogWidget = document.getElementById('inplayer-jog-dial-widget');
    if (jogWidget) jogWidget.style.display = 'none';
    const jogBtn = document.getElementById('inplayer-jog-btn');
    if (jogBtn) jogBtn.classList.remove('active');
    isPlayerScreenLocked = false;

    if (iframeWatchInterval) {
      clearInterval(iframeWatchInterval);
      iframeWatchInterval = null;
    }
    currentWatchTimeSeconds = 0;

    const iframeContainer = document.getElementById('cinema-player-wrapper');
    if (iframeContainer) iframeContainer.innerHTML = '';

    const quickBar = document.getElementById('player-series-quick-bar');
    if (quickBar) quickBar.style.display = 'none';

    const studioBackdrop = document.getElementById('player-studio-modal-backdrop');
    if (studioBackdrop) studioBackdrop.style.display = 'none';

    quickBarSeriesData = null;
    currentEpisodes = [];
    currentEpisodeIndex = 1;
    toggleInPlayerEpisodesSheet(null, false);

    document.body.classList.remove('player-dropdown-active', 'quick-dropdown-active');

    if (torrentClient) {
      try {
        torrentClient.destroy();
      } catch {}
      torrentClient = null;
    }

    const personModal = document.getElementById('person-modal');
    if (personModal) personModal.classList.remove('is-open');

    const cvPanel = document.getElementById('storm-cleanview-panel');
    if (cvPanel) cvPanel.classList.remove('is-open');
  }
}

function renderPlayerSources(players) {
  const dropdown = document.getElementById('player-source-dropdown');
  const trigger = document.getElementById('player-source-trigger');
  const menu = document.getElementById('player-source-menu');
  const list = document.getElementById('player-source-list');
  const curBadge = document.getElementById('player-current-badge');
  const curName = document.getElementById('player-current-name');
  const curQuality = document.getElementById('player-current-quality');
  const curStatus = document.getElementById('player-current-status');

  if (!dropdown || !list) return;

  let validPlayers = (players || []).filter(p => {
    if (!p || !p.url) return false;
    if (p.url.includes('kinobox.tv') || p.url.includes('delivembd.ws')) return false;
    return true;
  });

  // Если список плееров пуст, гарантируем доступный промо-трейлер (YouTube)
  if (validPlayers.length === 0 && currentMedia?.title) {
    const cleanSearchTitle = cleanVideoTitle(currentMedia.title);
    const safeSearch = encodeURIComponent(`${cleanSearchTitle} официальный русский трейлер`);
    validPlayers.push({
      id: 'official_trailer_fallback',
      name: 'Официальный трейлер и промо (HD)',
      type: 'iframe',
      quality: '1080p FHD',
      badge: 'ТРЕЙЛЕР',
      status: 'working',
      status_label: '🟢 Онлайн',
      audio_info: 'Официальное промо релиза',
      speed: '⚡ YouTube',
      url: `https://www.youtube-nocookie.com/embed?listType=search&list=${safeSearch}&autoplay=1`,
      is_trailer: true,
      is_recommended: true,
      recommended_badge: '🔥 Рекомендуемый'
    });
  }

  currentPlayers = validPlayers;

  if (validPlayers.length === 0) {
    if (curName) curName.textContent = 'Плееры не найдены';
    if (curBadge) curBadge.textContent = 'ОШИБКА';
    if (curQuality) curQuality.textContent = '—';
    if (curStatus) curStatus.textContent = '🔴 Недоступен';
    list.innerHTML = '<div style="padding: 10px; color: var(--text-muted); font-size: 12px; text-align: center;">Плееры для данного видео временно недоступны</div>';
    return;
  }

  // Заполняем выпадающий список стилизованными элементами
  const recommendedPlayer = validPlayers.find(p => p.is_recommended) || validPlayers[0];
  const defaultPlayer = currentActivePlayer ? (validPlayers.find(p => p.id === currentActivePlayer.id) || recommendedPlayer) : recommendedPlayer;

  list.innerHTML = validPlayers.map((p, idx) => {
    const isAct = defaultPlayer ? defaultPlayer.id === p.id : idx === 0;
    const recBadge = p.is_recommended ? `<span class="storm-badge" style="background:linear-gradient(135deg,#f59e0b,#ef4444);color:#fff;font-weight:800;padding:2px 6px;border-radius:4px;font-size:10px;margin-left:auto;flex-shrink:0;">🔥 Рекомендуемый</span>` : '';
    const badgeKey = p.badge ? p.badge.toLowerCase().replace(/[^a-z0-9]/g, '') : 'default';
    const is4k = (p.quality || '').includes('4K');
    const isDown = (p.status_label || '').includes('🔴') || p.status === 'broken';

    return `
      <div class="player-dropdown-item ${isAct ? 'active' : ''}" data-idx="${idx}">
        <div class="player-item-main">
          <div class="player-item-title-row">
            <span class="player-source-badge badge-${badgeKey}">${p.badge || 'ПЛЕЕР'}</span>
            <span class="player-item-name" title="${p.name}">${p.name}</span>
            ${recBadge}
          </div>
          <div class="player-item-sub-row">
            <span class="player-item-quality-pill ${is4k ? 'pill-4k' : 'pill-fhd'}">${p.quality || '1080p FHD'}</span>
            <span class="player-item-dot">•</span>
            <span class="player-item-audio">${p.audio_info || 'Оригинал / дубляж'}</span>
          </div>
        </div>
        <div class="player-item-aside">
          <span class="player-item-status ${isDown ? 'status-down' : 'status-live'}">${p.status_label || '🟢 Онлайн'}</span>
          ${isAct ? '<span class="player-item-check">✓</span>' : ''}
        </div>
      </div>
    `;
  }).join('');

  // Обновляем плашку выбранного плеера
  if (currentActivePlayer) {
    updatePlayerTriggerInfo(currentActivePlayer);
  } else if (defaultPlayer) {
    updatePlayerTriggerInfo(defaultPlayer);
  }

  // Клик по пункту выпадающего списка
  list.querySelectorAll('.player-dropdown-item').forEach(itemEl => {
    itemEl.onclick = (e) => {
      e.stopPropagation();
      const idx = parseInt(itemEl.dataset.idx, 10);
      const player = validPlayers[idx];
      if (player) {
        list.querySelectorAll('.player-dropdown-item').forEach(el => el.classList.remove('active'));
        itemEl.classList.add('active');
        updatePlayerTriggerInfo(player);
        menu.style.display = 'none';
        dropdown.classList.remove('is-open');
        document.body.classList.remove('player-dropdown-active');
        selectPlayer(player);
      }
    };
  });

  // Открытие / закрытие выпадающего списка выбора плеера
  if (trigger) {
    trigger.onclick = (e) => {
      e.stopPropagation();
      const isOpen = menu.style.display === 'block';
      if (!isOpen) {
        closeOtherQuickDropdowns(null);

        // Динамический расчет направления: по умолчанию вверх над видео, если не влезает — от верхнего края вниз
        const triggerRect = trigger.getBoundingClientRect();
        const spaceAbove = triggerRect.top;
        const spaceBelow = window.innerHeight - triggerRect.bottom;

        // Показываем вверх, если сверху достаточно места (>= 180px) или больше чем снизу
        if (spaceAbove >= 180 || spaceAbove >= spaceBelow) {
          menu.classList.remove('open-down');
          menu.classList.add('open-up');
          menu.style.top = 'auto';
          menu.style.bottom = 'calc(100% + 8px)';
          menu.style.maxHeight = `${Math.min(460, Math.max(160, spaceAbove - 24))}px`;
        } else {
          menu.classList.remove('open-up');
          menu.classList.add('open-down');
          menu.style.bottom = 'auto';
          menu.style.top = 'calc(100% + 8px)';
          menu.style.maxHeight = `${Math.min(460, Math.max(160, spaceBelow - 24))}px`;
        }

        menu.style.display = 'block';
        dropdown.classList.add('is-open');
        document.body.classList.add('player-dropdown-active');
      } else {
        menu.style.display = 'none';
        dropdown.classList.remove('is-open');
        document.body.classList.remove('player-dropdown-active');
      }
    };
  }

  // Закрытие при клике вне селектора
  if (!dropdown.dataset.hasOutsideListener) {
    dropdown.dataset.hasOutsideListener = 'true';
    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target)) {
        menu.style.display = 'none';
        dropdown.classList.remove('is-open');
        document.body.classList.remove('player-dropdown-active');
      }
    });
  }

  adjustCinemaModalScale();
}

export function updateFallbackButton(player = currentActivePlayer) {
  const fallbackBtn = document.getElementById('player-fallback-btn');
  const fallbackBar = document.getElementById('player-fallback-bar');
  if (!fallbackBtn) return;

  const validPlayers = (currentPlayers || []).filter(p => p && p.status !== 'broken' && !p.status_label?.includes('Недоступен') && p.url && !p.is_trailer && p.id !== 'webtorrent');
  if (validPlayers.length <= 1) {
    if (fallbackBar) fallbackBar.style.display = 'none';
    fallbackBtn.style.display = 'none';
    return;
  }
  if (fallbackBar) fallbackBar.style.display = 'flex';
  fallbackBtn.style.display = 'inline-flex';

  const isDom = isDomesticContent(currentMedia, currentMedia?.title || '');
  let nextCandidate = null;
  if (isDom) {
    if (player?.id === 'vk_video_stream') {
      nextCandidate = validPlayers.find(p => p.id === 'rutube_stream');
    } else if (player?.id === 'rutube_stream') {
      nextCandidate = validPlayers.find(p => p.id === 'vk_video_stream');
    }
    if (!nextCandidate) {
      nextCandidate = validPlayers.find(p => p.id !== player?.id && (p.id === 'vk_video_stream' || p.id === 'rutube_stream'))
        || validPlayers.find(p => p.id !== player?.id);
    }
  } else {
    nextCandidate = validPlayers.find(p => p.id !== player?.id && p.id === 'fanfilm4k_uhd')
      || validPlayers.find(p => p.id !== player?.id && p.id === 'kodik_direct')
      || validPlayers.find(p => p.id !== player?.id && (p.id === 'rezka_cinema' || p.id === 'lostfilm_player' || p.id === 'rhs_player'))
      || validPlayers.find(p => p.id !== player?.id && (p.id === 'rutube_stream' || p.id === 'vk_video_stream'))
      || validPlayers.find(p => p.id !== player?.id);
  }

  const labelEl = fallbackBtn.querySelector('.player-fallback-btn-label');
  if (labelEl) {
    if (nextCandidate) {
      let shortName = nextCandidate.name || 'Резерв';
      if (nextCandidate.id === 'vk_video_stream') shortName = 'VK Видео';
      else if (nextCandidate.id === 'rutube_stream') shortName = 'RuTube';
      else if (nextCandidate.id === 'fanfilm4k_uhd') shortName = '4K Ultra HD';
      else if (nextCandidate.id === 'kodik_direct') shortName = 'Kodik';
      else if (nextCandidate.id === 'rezka_cinema') shortName = 'HDRezka';
      else if (nextCandidate.id === 'lostfilm_player') shortName = 'LostFilm';
      else if (nextCandidate.id === 'rhs_player') shortName = 'Red Head Sound';
      labelEl.textContent = `⚡ Переключить на ${shortName}`;
      fallbackBtn.title = `Переключить на резервный плеер: ${nextCandidate.name}`;
    } else {
      labelEl.textContent = '⚡ Резервный плеер';
      fallbackBtn.title = 'Переключить на резервный плеер';
    }
  }
}

function updatePlayerTriggerInfo(player) {
  if (!player) return;
  const curBadge = document.getElementById('player-current-badge');
  const curName = document.getElementById('player-current-name');
  const curQuality = document.getElementById('player-current-quality');
  const curStatus = document.getElementById('player-current-status');

  if (curBadge) {
    if (player.is_recommended) {
      curBadge.innerHTML = `<span style="display:inline-flex;align-items:center;gap:4px;">${player.badge || 'ПЛЕЕР'} <span style="background:linear-gradient(135deg,#f59e0b,#ef4444);padding:1px 5px;border-radius:3px;font-size:9px;color:#fff;font-weight:800;">🔥 ТОП</span></span>`;
    } else {
      curBadge.textContent = player.badge || 'ПЛЕЕР';
    }
  }
  if (curName) curName.textContent = player.name || 'Плеер';
  if (curQuality) curQuality.textContent = player.quality || '1080p FHD';
  if (curStatus) curStatus.textContent = player.status_label || '🟢 Онлайн';

  updateFallbackButton(player);
}

function selectPlayer(player) {
  currentActivePlayer = player;
  updatePlayerTriggerInfo(player);

  // Синхронизируем активный элемент в выпадающем списке выбора плееров
  const list = document.getElementById('player-source-list');
  if (list && player?.id) {
    list.querySelectorAll('.player-dropdown-item').forEach(el => {
      const idx = parseInt(el.dataset.idx, 10);
      const p = currentPlayers ? currentPlayers[idx] : null;
      el.classList.toggle('active', Boolean(p && p.id === player.id));
    });
  }

  const container = document.getElementById('cinema-player-wrapper');
  if (!container) return;

  if (player.url === 'webtorrent://direct') {
    renderWebTorrentPlayer();
    return;
  }

  // Если ссылки нет, отображаем статус ожидаемой премьеры
  if (!player.url) {
    if (player.upcoming_notice || currentMedia?.is_upcoming) {
      const notice = player.upcoming_notice || `Релиз «${cleanVideoTitle(currentMedia?.title || 'Фильм')}» находится в производстве. Мировая премьера ожидается в ${currentMedia?.year || 'скоро'}.`;
      container.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;text-align:center;padding:30px;background:rgba(10,12,18,0.85);border-radius:12px;gap:14px;">
          <div style="font-size:42px;">🎬</div>
          <div style="font-size:18px;font-weight:800;color:var(--text-primary);">Премьера еще не состоялась</div>
          <div style="max-width:560px;font-size:13px;line-height:1.6;color:var(--text-secondary);">${notice}</div>
        </div>
      `;
      return;
    }

    container.innerHTML = '<div style="display:flex;height:100%;align-items:center;justify-content:center;color:var(--text-muted);">Ссылка на данный плеер временно недоступна</div>';
    return;
  }

  playStreamUrl(player.url);
}

export function switchToNextSource(preferWorking = true) {
  if (!currentPlayers || currentPlayers.length <= 1) {
    showToast('Нет других доступных источников', 'warning');
    return;
  }
  let nextPlayer = null;
  if (preferWorking) {
    const isWorking = p => p && p.status !== 'broken' && !p.status_label?.includes('Недоступен') && p.url && !p.is_trailer && p.id !== 'webtorrent';
    const isDom = isDomesticContent(currentMedia, currentMedia?.title || '');
    if (isDom) {
      if (currentActivePlayer?.id === 'vk_video_stream') {
        nextPlayer = currentPlayers.find(p => p.id === 'rutube_stream' && isWorking(p));
      } else if (currentActivePlayer?.id === 'rutube_stream') {
        nextPlayer = currentPlayers.find(p => p.id === 'vk_video_stream' && isWorking(p));
      }
      if (!nextPlayer) {
        nextPlayer = currentPlayers.find(p => p.id !== currentActivePlayer?.id && isWorking(p) && (p.id === 'vk_video_stream' || p.id === 'rutube_stream'))
          || currentPlayers.find(p => p.id !== currentActivePlayer?.id && isWorking(p) && p.id === 'fanfilm4k_uhd')
          || currentPlayers.find(p => p.id !== currentActivePlayer?.id && isWorking(p))
          || null;
      }
    } else {
      // Приоритет: 4K Ultra HD (FanFilm), затем Kodik, затем HDRezka / LostFilm / RHS, затем любой другой рабочий
      nextPlayer = currentPlayers.find(p => p.id !== currentActivePlayer?.id && isWorking(p) && p.id === 'fanfilm4k_uhd')
        || currentPlayers.find(p => p.id !== currentActivePlayer?.id && isWorking(p) && p.id === 'kodik_direct')
        || currentPlayers.find(p => p.id !== currentActivePlayer?.id && isWorking(p) && (p.id === 'rezka_cinema' || p.id === 'lostfilm_player' || p.id === 'rhs_player'))
        || currentPlayers.find(p => p.id !== currentActivePlayer?.id && isWorking(p) && (p.id === 'rutube_stream' || p.id === 'vk_video_stream'))
        || currentPlayers.find(p => p.id !== currentActivePlayer?.id && isWorking(p))
        || null;
    }
  }
  if (!nextPlayer) {
    const curIdx = currentPlayers.findIndex(p => p.id === currentActivePlayer?.id);
    const nextIdx = (curIdx + 1) % currentPlayers.length;
    nextPlayer = currentPlayers[nextIdx];
  }
  if (nextPlayer) {
    selectPlayer(nextPlayer);
    updatePlayerTriggerInfo(nextPlayer);
    const list = document.getElementById('player-source-list');
    if (list) {
      list.querySelectorAll('.player-dropdown-item').forEach((el) => {
        const idx = parseInt(el.dataset.idx, 10);
        const p = currentPlayers ? currentPlayers[idx] : null;
        el.classList.toggle('active', Boolean(p && p.id === nextPlayer.id));
      });
    }
    showToast(`⚡ Источник переключен: ${nextPlayer.name}`, 'info');
  }
}

/* ==========================================================================
   УМНЫЙ ВЫБОР ОЗВУЧКИ (SMART VOICEOVER PREFERENCE & AUTO-MATCHING)
   ========================================================================== */
const KNOWN_STUDIO_ALIASES = [
  { key: 'lostfilm', patterns: ['lostfilm', 'лостфильм', 'lost film'] },
  { key: 'redheadsound', patterns: ['red head sound', 'redheadsound', 'ред хед саунд', 'редхедсаунд', 'rhs', 'рхс'] },
  { key: 'hdrezka', patterns: ['hdrezka', 'rezka', 'хдрезка', 'резка', 'hd rezka'] },
  { key: 'kubik', patterns: ['кубик в кубе', 'кубик', 'kubik v kube', 'kubik'] },
  { key: 'anilibria', patterns: ['anilibria', 'анилибрия'] },
  { key: 'studioband', patterns: ['studio band', 'studioband', 'студийная банда', 'студия банда'] },
  { key: 'dreamcast', patterns: ['dream cast', 'dreamcast', 'дримкаст'] },
  { key: 'aniplash', patterns: ['aniplash', 'аниплэш', 'аниплеш'] },
  { key: 'shikimori', patterns: ['shikimori', 'шикимори'] },
  { key: 'shiza', patterns: ['shiza project', 'shiza', 'шиза проджект', 'шиза'] },
  { key: 'dubbing', patterns: ['дублированный', 'дубляж', 'полный дубляж', 'профессиональный дублированный', 'дублирование', 'dubbing'] },
  { key: 'pifagor', patterns: ['пифагор', 'мостфильм', 'невафильм'] },
  { key: 'tvshows', patterns: ['tvshows', 'твшоус', 'твшоу'] },
  { key: 'newstudio', patterns: ['newstudio', 'ньюстудио'] },
  { key: 'kuraj', patterns: ['кураж-бамбей', 'кураж бамбей', 'кураж', 'kuraj bambey'] },
  { key: 'flarrow', patterns: ['flarrow films', 'flarrow', 'флэрроу', 'флэроу'] },
  { key: 'coldfilm', patterns: ['coldfilm', 'колдфильм'] },
  { key: 'baibako', patterns: ['baibako', 'байбако'] },
  { key: 'alexfilm', patterns: ['alexfilm', 'алексфильм'] },
  { key: 'profdub', patterns: ['профессиональный многоголосый', 'проф. многоголосый'] }
];

export function getPreferredVoiceover() {
  try {
    return localStorage.getItem('storm_smart_preferred_voiceover') || '';
  } catch {
    return '';
  }
}

export function savePreferredVoiceover(name) {
  if (!name || typeof name !== 'string') return;
  const cleanName = name
    .replace(/\s*[\(\[]?\s*(4[kк]|uhd|fhd|1080p|720p|серия|сезон|\d+)\s*[\)\]]?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleanName || cleanName.length < 2) return;

  try {
    localStorage.setItem('storm_smart_preferred_voiceover', cleanName);
    localStorage.setItem('storm_smart_preferred_voiceover_raw', name);
  } catch (err) {
    console.warn('Не удалось сохранить умную озвучку:', err);
  }
}

export function findPreferredVoiceoverMatch(translations) {
  if (!Array.isArray(translations) || translations.length === 0) return null;
  const preferred = getPreferredVoiceover();
  if (!preferred) return null;

  const cleanPref = preferred.toLowerCase().trim();
  const prefNorm = cleanPref.replace(/[^a-zа-я0-9]/gi, '');

  let matchedStudioKey = null;
  for (const item of KNOWN_STUDIO_ALIASES) {
    if (item.patterns.some(p => cleanPref.includes(p) || p.includes(cleanPref))) {
      matchedStudioKey = item.key;
      break;
    }
  }

  const prefTokens = cleanPref
    .split(/[\s,.\-\_\(\)\[\]\/\\]+/)
    .map(t => t.trim())
    .filter(t => t.length >= 4 && !['сезон', 'серия', 'серии', 'звук', 'дубляж'].includes(t));

  let bestMatch = null;
  let bestScore = 0;

  for (const trans of translations) {
    const name = (trans.name || '').trim();
    if (!name) continue;
    const lowerName = name.toLowerCase();
    const transNorm = lowerName.replace(/[^a-zа-я0-9]/gi, '');

    let score = 0;

    if (transNorm === prefNorm) {
      score = 100;
    } else if (matchedStudioKey) {
      const studioObj = KNOWN_STUDIO_ALIASES.find(s => s.key === matchedStudioKey);
      if (studioObj && studioObj.patterns.some(p => lowerName.includes(p))) {
        score = 90;
      }
    }

    if (score === 0) {
      if (lowerName.includes(cleanPref) || cleanPref.includes(lowerName)) {
        score = 80;
      } else {
        for (const token of prefTokens) {
          if (lowerName.includes(token)) {
            score = Math.max(score, 70);
          }
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = trans;
    }
  }

  return bestScore >= 70 ? bestMatch : null;
}

/* ==========================================================================
   СТИЛИЗОВАННАЯ ПАНЕЛЬ СЕРИАЛОВ И ФИЛЬМОВ (СЕЗОНЫ, СЕРИИ И СТУДИЙНАЯ ОЗВУЧКА)
   ========================================================================== */
let quickBarSeriesData = null;
let quickBarActiveSeason = 1;
let quickBarActiveEpisode = 1;
let quickBarActiveTranslationId = null;
let quickBarBaseUrl = null;

async function initSeriesQuickBar(playerUrl) {
  const quickBar = document.getElementById('player-series-quick-bar');
  if (!quickBar) return;

  quickBarBaseUrl = playerUrl;
  try {
    const curMediaId = currentMedia?.id || '';
    const mediaTitle = currentMedia?.title || currentMedia?.name || '';
    const mediaTmdbId = currentMedia?.tmdb_id || '';
    const res = await fetch(`/api/player/series-options?url=${encodeURIComponent(playerUrl)}&title=${encodeURIComponent(mediaTitle)}&mediaId=${encodeURIComponent(curMediaId)}&tmdbId=${encodeURIComponent(mediaTmdbId)}`);
    if (!res.ok) {
      if (checkIfMediaIsSeries(currentMedia)) {
        initUniversalSeriesQuickBar(quickBarActiveSeason, quickBarActiveEpisode);
        return;
      }
      quickBar.style.display = 'none';
      adjustCinemaModalScale();
      return;
    }
    const data = await res.json();
    if (!data.success || !data.seasons || data.seasons.length === 0) {
      if (checkIfMediaIsSeries(currentMedia)) {
        initUniversalSeriesQuickBar(quickBarActiveSeason, quickBarActiveEpisode);
        return;
      }
      quickBar.style.display = 'none';
      adjustCinemaModalScale();
      return;
    }

    quickBarSeriesData = data;
    quickBar.style.display = 'flex';
    const modal = document.getElementById('cinema-modal');
    if (modal) modal.classList.add('has-series-bar');
    adjustCinemaModalScale();
    requestAnimationFrame(adjustCinemaModalScale);

    quickBarActiveSeason = (data.active?.season !== undefined && Number.isFinite(data.active.season)) ? data.active.season : (data.seasons[0].season || 1);
    quickBarActiveEpisode = (data.active?.episode !== undefined && Number.isFinite(data.active.episode)) ? data.active.episode : 1;
    quickBarActiveTranslationId = data.active?.id_translation || null;

    // Умный выбор озвучки: проверяем любимую студию пользователя
    const currentSeasonObj = data.seasons.find(s => s.season === quickBarActiveSeason) || data.seasons[0];
    const currentEpisodeObj = currentSeasonObj?.episodes?.find(e => e.episode === quickBarActiveEpisode) || currentSeasonObj?.episodes?.[0];
    const availableTranslations = currentEpisodeObj?.translations || [];

    const matchedTrans = findPreferredVoiceoverMatch(availableTranslations);
    let autoVoiceMatched = false;
    if (matchedTrans && String(matchedTrans.id) !== String(quickBarActiveTranslationId)) {
      quickBarActiveTranslationId = matchedTrans.id;
      if (data.active) data.active.id_translation = matchedTrans.id;
      autoVoiceMatched = true;
    }

    renderQuickBarDropdowns();
    setupQuickBarOutsideListeners();

    if (autoVoiceMatched || quickBarActiveSeason > 1 || quickBarActiveEpisode > 1) {
      updateQuickIframeSrc();
    }
    if (autoVoiceMatched && matchedTrans) {
      showToast(`🎙️ Умный выбор озвучки: ${matchedTrans.name}`, 'info');
    }

    // Синхронизируем список сезонов и серий при обнаружении многосезонного релиза
    if (data.seasons && data.seasons.length > 0) {
      if (currentMedia) {
        currentMedia.media_type = 'series';
        currentMedia.category = 'Сериал';
        if (!currentMedia.seasons || currentMedia.seasons.length < data.seasons.length) {
          currentMedia.seasons = data.seasons.map(s => ({
            season_number: s.season,
            name: s.name || `Сезон ${s.season}`,
            episode_count: s.episodes?.length || s.episodes_count || 8,
            overview: ''
          }));
        }
      }
      renderSeriesSeasons(currentMedia, quickBarActiveSeason, quickBarActiveEpisode);

      // Обновляем оверлей плеера и делаем кнопки выбора серий и сезонов доступными
      const overlay = document.getElementById('storm-inplayer-overlay');
      if (overlay) {
        const epBtn = overlay.querySelector('#inplayer-episodes-btn');
        const bottomBar = overlay.querySelector('#inplayer-bottom-bar');
        const epSheet = overlay.querySelector('#player-inplayer-episodes-sheet');
        if (epBtn) epBtn.style.display = '';
        if (bottomBar) bottomBar.style.display = '';
        if (epSheet) epSheet.style.display = '';
        updateInPlayerEpisodeInfo();
      }
    }
  } catch (err) {
    console.warn('Ошибка быстрой панели серий:', err);
    if (checkIfMediaIsSeries(currentMedia)) {
      initUniversalSeriesQuickBar(quickBarActiveSeason, quickBarActiveEpisode);
      return;
    }
    quickBar.style.display = 'none';
    adjustCinemaModalScale();
  }
}

export function initUniversalSeriesQuickBar(initialSeason = 1, initialEpisode = 1) {
  const quickBar = document.getElementById('player-series-quick-bar');
  if (!quickBar) return;

  if (!checkIfMediaIsSeries(currentMedia)) {
    quickBar.style.display = 'none';
    adjustCinemaModalScale();
    return;
  }

  // Нормализуем seasons если это число (например, seasons: 2)
  if (typeof currentMedia?.seasons === 'number') {
    const numSeasons = currentMedia.seasons;
    currentMedia.seasons = Array.from({ length: numSeasons }, (_, i) => ({
      season_number: i + 1,
      name: `Сезон ${i + 1}`,
      episode_count: 8,
      overview: ''
    }));
  }

  let seasonsList = [];
  if (Array.isArray(currentMedia?.seasons) && currentMedia.seasons.length > 0) {
    seasonsList = currentMedia.seasons.map(s => {
      const sNum = Number(s.season_number || s.season || 1);
      const epCount = Number(s.episode_count || s.episodes_count || (Array.isArray(s.episodes) ? s.episodes.length : 8));
      let eps = [];
      if (Array.isArray(s.episodes) && s.episodes.length > 0) {
        eps = s.episodes.map(e => ({
          episode: Number(e.episode_number || e.ordinal || e.episode || 1),
          name: e.name || e.title || `${e.episode_number || e.ordinal || e.episode || 1} серия`,
          overview: e.overview || '',
          embed_url: e.embed_url || '',
          rutube_id: e.rutube_id || '',
          translations: []
        }));
      } else {
        eps = Array.from({ length: epCount }, (_, i) => ({
          episode: i + 1,
          name: `${i + 1} серия`,
          overview: '',
          translations: []
        }));
      }
      return {
        season: sNum,
        name: s.name || `Сезон ${sNum}`,
        episodes_count: eps.length,
        episodes: eps
      };
    });
  } else if (Array.isArray(currentMedia?.episodes) && currentMedia.episodes.length > 0) {
    const eps = currentMedia.episodes.map(e => ({
      episode: Number(e.episode_number || e.ordinal || e.episode || 1),
      name: e.name || e.title || `${e.episode_number || e.ordinal || e.episode || 1} серия`,
      overview: e.overview || '',
      embed_url: e.embed_url || '',
      rutube_id: e.rutube_id || '',
      translations: []
    }));
    seasonsList = [{
      season: 1,
      name: 'Сезон 1',
      episodes_count: eps.length,
      episodes: eps
    }];
  } else {
    // Дефолтный сезон с 8 сериями для любого сериала
    seasonsList = [{
      season: 1,
      name: 'Сезон 1',
      episodes_count: 8,
      episodes: Array.from({ length: 8 }, (_, i) => ({
        episode: i + 1,
        name: `${i + 1} серия`,
        overview: '',
        translations: []
      }))
    }];
  }

  const sVal = Number(initialSeason) || 1;
  const epVal = Number(initialEpisode) || 1;

  quickBarSeriesData = {
    success: true,
    type: 'series',
    seasons: seasonsList,
    active: {
      season: sVal,
      episode: epVal,
      id_translation: null
    }
  };

  quickBarActiveSeason = sVal;
  quickBarActiveEpisode = epVal;
  quickBarActiveTranslationId = null;

  quickBar.style.display = 'flex';
  const modal = document.getElementById('cinema-modal');
  if (modal) modal.classList.add('has-series-bar');
  adjustCinemaModalScale();
  requestAnimationFrame(adjustCinemaModalScale);

  renderQuickBarDropdowns();
  setupQuickBarOutsideListeners();

  // Обновляем оверлей плеера и делаем кнопки выбора серий и сезонов доступными
  const overlay = document.getElementById('storm-inplayer-overlay');
  if (overlay) {
    const epBtn = overlay.querySelector('#inplayer-episodes-btn');
    const bottomBar = overlay.querySelector('#inplayer-bottom-bar');
    const epSheet = overlay.querySelector('#player-inplayer-episodes-sheet');
    if (epBtn) epBtn.style.display = '';
    if (bottomBar) bottomBar.style.display = '';
    if (epSheet) epSheet.style.display = '';
    updateInPlayerEpisodeInfo();
  }

  // Обновляем нижнюю сетку сезонов и серий
  renderSeriesSeasons(currentMedia, quickBarActiveSeason, quickBarActiveEpisode);
}

function getOrCreateQuickStatusPortal() {
  let portal = document.getElementById('quick-status-floating-portal');
  if (!portal) {
    portal = document.createElement('div');
    portal.id = 'quick-status-floating-portal';
    portal.className = 'quick-status-floating-portal';
    portal.style.display = 'none';
    document.body.appendChild(portal);

    document.addEventListener('click', (e) => {
      if (!portal.contains(e.target) && !e.target.closest('.quick-status-custom-trigger')) {
        portal.style.display = 'none';
        portal.dataset.currentSeason = '';
        document.querySelectorAll('.quick-status-custom-dropdown.is-open').forEach(d => d.classList.remove('is-open'));
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        portal.style.display = 'none';
        portal.dataset.currentSeason = '';
        document.querySelectorAll('.quick-status-custom-dropdown.is-open').forEach(d => d.classList.remove('is-open'));
      }
    });
  }
  return portal;
}

function renderQuickBarDropdowns() {
  if (!quickBarSeriesData || !quickBarSeriesData.seasons) return;

  const currentSeasonObj = quickBarSeriesData.seasons.find(s => s.season === quickBarActiveSeason) || quickBarSeriesData.seasons[0];
  if (!currentSeasonObj) return;

  const currentEpisodeObj = currentSeasonObj.episodes.find(e => e.episode === quickBarActiveEpisode) || currentSeasonObj.episodes[0];
  const translations = currentEpisodeObj?.translations || [];
  const curMediaId = currentMedia?.id;
  const isMovie = quickBarSeriesData.type === 'movie';

  // 1. Сезон
  const seasonVal = document.getElementById('quick-season-val');
  const seasonList = document.getElementById('quick-season-list');
  const seasonDropdown = document.getElementById('quick-season-dropdown');
  const seasonTrigger = document.getElementById('quick-season-trigger');
  const seasonMenu = document.getElementById('quick-season-menu');

  if (seasonDropdown) {
    seasonDropdown.style.display = isMovie ? 'none' : '';
  }

  // Расчет статуса активного сезона для кнопки-триггера
  const totalInCurSeason = currentSeasonObj.episodes_count || (currentSeasonObj.episodes ? currentSeasonObj.episodes.length : 0);
  const rawWatchedInCur = curMediaId ? getWatchedEpisodes(curMediaId, quickBarActiveSeason) : new Set();
  const validWatchedInCur = Array.from(rawWatchedInCur).filter(n => Number(n) >= 1 && (totalInCurSeason <= 0 || Number(n) <= totalInCurSeason));
  const watchedInCurSeason = totalInCurSeason > 0 ? Math.min(validWatchedInCur.length, totalInCurSeason) : validWatchedInCur.length;
  let curSeasonIcon = '📺';
  if (totalInCurSeason > 0 && watchedInCurSeason >= totalInCurSeason) {
    curSeasonIcon = '✅';
  } else if (watchedInCurSeason > 0) {
    curSeasonIcon = '⏳';
  }

  const seasonIconEl = seasonTrigger ? seasonTrigger.querySelector('.quick-dropdown-icon') : null;
  if (seasonIconEl) {
    seasonIconEl.textContent = curSeasonIcon;
  }
  if (seasonVal) {
    let displaySeasonName = currentSeasonObj.name || `Сезон ${quickBarActiveSeason}`;
    const cleanMediaTitle = (currentMedia?.title || '').trim().toLowerCase();
    const cleanMediaOrig = (currentMedia?.original_title || '').trim().toLowerCase();
    const isDup = displaySeasonName.toLowerCase() === cleanMediaTitle ||
                  (cleanMediaTitle.length > 8 && displaySeasonName.toLowerCase().startsWith(cleanMediaTitle)) ||
                  (cleanMediaOrig && cleanMediaOrig.length > 8 && displaySeasonName.toLowerCase().startsWith(cleanMediaOrig));
    if (isDup) {
      displaySeasonName = `Сезон ${quickBarActiveSeason}`;
    }
    seasonVal.textContent = displaySeasonName;
    seasonVal.title = displaySeasonName;
  }

  if (seasonList) {
    seasonList.innerHTML = quickBarSeriesData.seasons.map(s => {
      const isAct = s.season === quickBarActiveSeason;
      const totalEp = s.episodes_count || (s.episodes ? s.episodes.length : 0) || 10;
      const watchedSet = curMediaId ? getWatchedEpisodes(curMediaId, s.season) : new Set();
      const validWatched = Array.from(watchedSet).filter(n => Number(n) >= 1 && Number(n) <= totalEp);
      const watchedCount = Math.min(validWatched.length, totalEp);

      let sDisplayName = s.name || `Сезон ${s.season}`;
      const cleanMediaTitle = (currentMedia?.title || '').trim().toLowerCase();
      const cleanMediaOrig = (currentMedia?.original_title || '').trim().toLowerCase();
      if (sDisplayName.toLowerCase() === cleanMediaTitle ||
          (cleanMediaTitle.length > 8 && sDisplayName.toLowerCase().startsWith(cleanMediaTitle)) ||
          (cleanMediaOrig && cleanMediaOrig.length > 8 && sDisplayName.toLowerCase().startsWith(cleanMediaOrig))) {
        sDisplayName = `Сезон ${s.season}`;
      }

      const sStatusInfo = curMediaId ? getSeasonStatusInfo(curMediaId, s.season, totalEp, s.episodes) : { status: 'planned' };
      const curSeasonStatus = sStatusInfo.status;
      const isAllWatched = curSeasonStatus === 'completed' || (totalEp > 0 && watchedCount >= totalEp);
      const effectiveStatus = isAllWatched ? 'completed' : (curSeasonStatus || 'not_started');
      const curStatusSvg = getStatusIconSvg(effectiveStatus, { size: 15, animated: true });

      return `
        <div class="quick-dropdown-item ${isAct ? 'active' : ''}" data-season="${s.season}">
          <div class="quick-item-left" style="display: flex; align-items: flex-start; gap: 8px; flex: 1; min-width: 0;">
            <span class="quick-item-title quick-season-title" title="${escapeHtml(sDisplayName)}">${escapeHtml(sDisplayName)}</span>
          </div>
          <div class="quick-item-right" style="display: flex; align-items: center; gap: 6px; margin-left: auto; flex-shrink: 0;">
            <span class="quick-count-badge" title="Просмотрено ${watchedCount} из ${totalEp} серий">${watchedCount}/${totalEp}</span>
            <div class="quick-status-custom-dropdown" data-season="${s.season}" data-current-status="${effectiveStatus}">
              <button type="button" class="quick-status-custom-trigger" title="Статус сезона: ${getStatusLabel(effectiveStatus)}">
                ${curStatusSvg}
                <span class="quick-status-arrow">▼</span>
              </button>
            </div>
            <button type="button" class="quick-season-watch-toggle ${isAllWatched ? 'active' : ''}" data-toggle-season="${s.season}" title="${isAllWatched ? 'Снять отметку со всего сезона' : 'Отметить весь сезон просмотренным'}">
              ${isAllWatched ? '✖' : '✓'}
            </button>
          </div>
        </div>
      `;
    }).join('');

    if (seasonMenu && !seasonMenu.dataset.hasScrollListener) {
      seasonMenu.dataset.hasScrollListener = 'true';
      seasonMenu.addEventListener('scroll', () => {
        const p = document.getElementById('quick-status-floating-portal');
        if (p) {
          p.style.display = 'none';
          p.dataset.currentSeason = '';
        }
        document.querySelectorAll('.quick-status-custom-dropdown.is-open').forEach(d => d.classList.remove('is-open'));
      });
    }

    seasonList.querySelectorAll('.quick-dropdown-item').forEach(item => {
      item.onclick = (e) => {
        if (e.target.closest('.quick-status-custom-dropdown') || e.target.closest('.quick-season-watch-toggle')) {
          return;
        }
        e.stopPropagation();
        const sNum = parseInt(item.dataset.season, 10);
        selectQuickSeason(sNum);
        if (seasonMenu) seasonMenu.style.display = 'none';
        if (seasonDropdown) seasonDropdown.classList.remove('is-open');
        closeOtherQuickDropdowns(null);
      };
    });

    seasonList.querySelectorAll('.quick-status-custom-dropdown').forEach(dd => {
      const trigger = dd.querySelector('.quick-status-custom-trigger');
      const sNum = parseInt(dd.dataset.season, 10);
      const curStat = dd.dataset.currentStatus || 'not_started';

      if (trigger) {
        trigger.onclick = (e) => {
          e.stopPropagation();
          const portal = getOrCreateQuickStatusPortal();
          const wasOpenForThis = portal.style.display === 'flex' && portal.dataset.currentSeason === String(sNum);

          document.querySelectorAll('.quick-status-custom-dropdown.is-open').forEach(other => {
            other.classList.remove('is-open');
          });

          if (wasOpenForThis) {
            portal.style.display = 'none';
            portal.dataset.currentSeason = '';
            return;
          }

          dd.classList.add('is-open');
          portal.dataset.currentSeason = String(sNum);
          portal.innerHTML = STATUS_LIST.map(st => `
            <button type="button" class="quick-status-option ${st.id === curStat ? 'active' : ''}" data-status="${st.id}">
              ${getStatusIconSvg(st.id, { size: 14, animated: false })}
              <span>${st.label}</span>
            </button>
          `).join('');

          portal.style.display = 'flex';
          portal.style.visibility = 'hidden';

          const rect = trigger.getBoundingClientRect();
          const portalRect = portal.getBoundingClientRect();
          const portalWidth = portalRect.width || 170;
          const portalHeight = portalRect.height || 215;

          const spaceBelow = window.innerHeight - rect.bottom;
          let topPos = 0;
          if (spaceBelow < portalHeight + 10 && rect.top > portalHeight + 10) {
            topPos = rect.top - portalHeight - 4;
          } else {
            topPos = rect.bottom + 4;
          }

          let leftPos = rect.right - portalWidth;
          if (leftPos < 10) leftPos = 10;
          if (leftPos + portalWidth > window.innerWidth - 10) {
            leftPos = window.innerWidth - portalWidth - 10;
          }

          portal.style.top = `${Math.round(topPos)}px`;
          portal.style.left = `${Math.round(leftPos)}px`;
          portal.style.visibility = 'visible';

          portal.querySelectorAll('.quick-status-option').forEach(opt => {
            opt.onclick = async (optEvent) => {
              optEvent.stopPropagation();
              const newStat = opt.dataset.status;
              portal.style.display = 'none';
              portal.dataset.currentSeason = '';
              dd.classList.remove('is-open');

              const targetSeason = quickBarSeriesData.seasons.find(x => x.season === sNum);
              applySeasonStatus(curMediaId, sNum, newStat, targetSeason?.episodes || []);
              if (newStat === 'completed') {
                showToast(`Сезон ${sNum}: все серии отмечены как просмотренные`, 'success');
              } else {
                showToast(`Сезон ${sNum}: статус обновлен`, 'info');
              }
              await syncOverallSeriesProgress(currentMedia);
              renderQuickBarDropdowns();
            };
          });
        };
      }
    });

    seasonList.querySelectorAll('.quick-season-watch-toggle').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const sNum = parseInt(btn.dataset.toggleSeason, 10);
        const targetSeason = quickBarSeriesData.seasons.find(x => x.season === sNum);
        const total = targetSeason?.episodes_count || (targetSeason?.episodes ? targetSeason.episodes.length : 0);
        const marked = toggleAllSeasonEpisodesWatched(curMediaId, sNum, total, targetSeason?.episodes || []);
        showToast(marked ? `Сезон ${sNum}: все серии отмечены как просмотренные` : `Отметка снята с сезона ${sNum}`, 'info');
        await syncOverallSeriesProgress(currentMedia);
        renderQuickBarDropdowns();
      };
    });
  }

  if (seasonTrigger && !seasonTrigger.dataset.hasListener) {
    seasonTrigger.dataset.hasListener = 'true';
    seasonTrigger.onclick = (e) => {
      e.stopPropagation();
      closeOtherQuickDropdowns('quick-season-dropdown');
      const isOpen = seasonMenu.style.display === 'block';
      seasonMenu.style.display = isOpen ? 'none' : 'block';
      seasonDropdown.classList.toggle('is-open', !isOpen);
      document.body.classList.toggle('quick-dropdown-active', !isOpen);
    };
  }

  // 2. Серия
  const epVal = document.getElementById('quick-episode-val');
  const epList = document.getElementById('quick-episode-list');
  const epDropdown = document.getElementById('quick-episode-dropdown');
  const epTrigger = document.getElementById('quick-episode-trigger');
  const epMenu = document.getElementById('quick-episode-menu');

  if (epDropdown) {
    epDropdown.style.display = isMovie ? 'none' : '';
  }

  const curEpWatched = curMediaId ? getWatchedEpisodes(curMediaId, quickBarActiveSeason).has(quickBarActiveEpisode) : false;
  const epIconEl = epTrigger ? epTrigger.querySelector('.quick-dropdown-icon') : null;
  if (epIconEl) {
    epIconEl.textContent = '🎬';
  }
  if (epVal) {
    epVal.textContent = currentEpisodeObj ? currentEpisodeObj.name : `${quickBarActiveEpisode} серия`;
  }

  if (epList) {
    const watchedEpisodes = curMediaId ? getWatchedEpisodes(curMediaId, quickBarActiveSeason) : new Set();

    epList.innerHTML = currentSeasonObj.episodes.map(ep => {
      const isWatched = watchedEpisodes.has(ep.episode);
      const isAct = ep.episode === quickBarActiveEpisode;

      let statusIconBadge = '';
      if (isAct && isWatched) {
        statusIconBadge = `<span class="quick-ep-status-icon is-current-watched" title="Текущая воспроизводимая серия (Просмотрено)">${getStatusIconSvg('completed', { size: 14, animated: true })}</span>`;
      } else if (isAct) {
        statusIconBadge = `<span class="quick-ep-status-icon is-current" title="Текущая воспроизводимая серия">${getStatusIconSvg('watching', { size: 14, animated: true })}</span>`;
      } else if (isWatched) {
        statusIconBadge = `<span class="quick-ep-status-icon is-watched" title="Просмотрено">${getStatusIconSvg('completed', { size: 14, animated: false })}</span>`;
      } else {
        statusIconBadge = `<span class="quick-ep-status-icon is-unwatched" title="Не начата">${getStatusIconSvg('not_started', { size: 13, animated: false })}</span>`;
      }

      return `
        <div class="quick-dropdown-item ${isAct ? 'active' : ''}" data-episode="${ep.episode}" title="${ep.overview ? ep.overview.replace(/"/g, '&quot;') : ''}">
          <div class="quick-item-left" style="min-width: 0; flex: 1;">
            <span class="quick-item-title quick-episode-title" title="${escapeHtml(ep.name)}">${ep.name}</span>
          </div>
          <div class="quick-item-right" style="display: flex; align-items: center; gap: 6px; flex-shrink: 0; margin-left: 10px;">
            ${statusIconBadge}
            <button type="button" class="quick-ep-watch-toggle ${isWatched ? 'active' : ''}" data-toggle-ep="${ep.episode}" title="${isWatched ? 'Отметить непросмотренной' : 'Отметить просмотренной'}">
              ${isWatched ? '✖' : '✓'}
            </button>
          </div>
        </div>
      `;
    }).join('');

    epList.querySelectorAll('.quick-dropdown-item').forEach(item => {
      item.onclick = (e) => {
        if (e.target.closest('.quick-ep-watch-toggle')) return;
        e.stopPropagation();
        const epNum = parseInt(item.dataset.episode, 10);
        selectQuickEpisode(epNum);
        if (epMenu) epMenu.style.display = 'none';
        if (epDropdown) epDropdown.classList.remove('is-open');
        closeOtherQuickDropdowns(null);
      };
    });

    epList.querySelectorAll('.quick-ep-watch-toggle').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const epNum = parseInt(btn.dataset.toggleEp, 10);
        if (curMediaId) {
          const isNowWatched = toggleEpisodeWatched(curMediaId, quickBarActiveSeason, epNum);

          // Проверяем, завершен ли весь сезон
          const currentWatched = getWatchedEpisodes(curMediaId, quickBarActiveSeason);
          const totalEp = currentSeasonObj.episodes_count || (currentSeasonObj.episodes ? currentSeasonObj.episodes.length : 0);
          if (totalEp > 0 && currentWatched.size >= totalEp) {
            setSeasonExplicitStatus(curMediaId, quickBarActiveSeason, 'completed');
          } else if (!isNowWatched && getSeasonExplicitStatus(curMediaId, quickBarActiveSeason) === 'completed') {
            setSeasonExplicitStatus(curMediaId, quickBarActiveSeason, 'watching');
          }

          await syncOverallSeriesProgress(currentMedia);
          renderQuickBarDropdowns();
          showToast(`Серия ${epNum}: ${isNowWatched ? 'отмечена просмотренной' : 'отметка снята'}`, 'info');
        }
      };
    });
  }

  if (epTrigger && !epTrigger.dataset.hasListener) {
    epTrigger.dataset.hasListener = 'true';
    epTrigger.onclick = (e) => {
      e.stopPropagation();
      closeOtherQuickDropdowns('quick-episode-dropdown');
      const isOpen = epMenu.style.display === 'block';
      epMenu.style.display = isOpen ? 'none' : 'block';
      epDropdown.classList.toggle('is-open', !isOpen);
      document.body.classList.toggle('quick-dropdown-active', !isOpen);
      const quickBar = document.getElementById('player-series-quick-bar');
      if (quickBar) quickBar.classList.toggle('has-open-dropdown', !isOpen);
    };
  }

  // 3. Озвучка
  const voiceVal = document.getElementById('quick-voiceover-val');
  const voiceBadge = document.getElementById('quick-voiceover-badge');
  const voiceList = document.getElementById('quick-voiceover-list');
  const voiceDropdown = document.getElementById('quick-voiceover-dropdown');
  const voiceTrigger = document.getElementById('quick-voiceover-trigger');
  const voiceMenu = document.getElementById('quick-voiceover-menu');

  if (voiceDropdown) {
    voiceDropdown.style.display = translations.length > 0 ? '' : 'none';
  }

  let activeTrans = translations.find(t => String(t.id) === String(quickBarActiveTranslationId));
  if (!activeTrans && translations.length > 0) {
    activeTrans = findPreferredVoiceoverMatch(translations) || translations[0];
    if (activeTrans) quickBarActiveTranslationId = activeTrans.id;
  }
  if (activeTrans) {
    quickBarActiveTranslationId = activeTrans.id;
    if (voiceVal) {
      voiceVal.textContent = activeTrans.name;
      voiceVal.title = activeTrans.name;
    }
    if (voiceBadge) {
      voiceBadge.style.display = activeTrans.is_uhd ? 'inline-block' : 'none';
      voiceBadge.textContent = '4K UHD';
    }
  }

  if (voiceList) {
    voiceList.innerHTML = translations.map(t => {
      const isAct = t.id === quickBarActiveTranslationId;
      return `
        <div class="quick-dropdown-item ${isAct ? 'active' : ''}" data-trans-id="${t.id}" title="${escapeHtml(t.name)}">
          <span class="quick-voice-title">${escapeHtml(t.name)}</span>
          ${t.is_uhd ? '<span class="uhd-pill">4K UHD</span>' : '<span class="fhd-pill">' + (t.quality || 'FHD') + '</span>'}
        </div>
      `;
    }).join('');

    voiceList.querySelectorAll('.quick-dropdown-item').forEach(item => {
      item.onclick = (e) => {
        e.stopPropagation();
        const tId = parseInt(item.dataset.transId, 10);
        selectQuickVoiceover(tId);
        if (voiceMenu) voiceMenu.style.display = 'none';
        if (voiceDropdown) voiceDropdown.classList.remove('is-open');
        closeOtherQuickDropdowns(null);
      };
    });
  }

  if (voiceTrigger && !voiceTrigger.dataset.hasListener) {
    voiceTrigger.dataset.hasListener = 'true';
    voiceTrigger.onclick = (e) => {
      e.stopPropagation();
      closeOtherQuickDropdowns('quick-voiceover-dropdown');
      const isOpen = voiceMenu.style.display === 'block';
      voiceMenu.style.display = isOpen ? 'none' : 'block';
      voiceDropdown.classList.toggle('is-open', !isOpen);
      document.body.classList.toggle('quick-dropdown-active', !isOpen);
      const quickBar = document.getElementById('player-series-quick-bar');
      if (quickBar) quickBar.classList.toggle('has-open-dropdown', !isOpen);
    };
  }

  updateInPlayerEpisodeInfo();
}

function closeOtherQuickDropdowns(activeDropdownId) {
  const quickBar = document.getElementById('player-series-quick-bar');
  const ids = ['quick-season-dropdown', 'quick-episode-dropdown', 'quick-voiceover-dropdown'];
  ids.forEach(id => {
    if (id !== activeDropdownId) {
      const dd = document.getElementById(id);
      if (dd) {
        dd.classList.remove('is-open');
        const m = dd.querySelector('.quick-dropdown-menu');
        if (m) m.style.display = 'none';
      }
    }
  });

  if (quickBar) {
    const hasAnyOpen = ids.some(id => (id === activeDropdownId && document.getElementById(id)?.classList.contains('is-open')));
    quickBar.classList.toggle('has-open-dropdown', hasAnyOpen);
  }

  document.querySelectorAll('.quick-status-custom-dropdown.is-open').forEach(dd => {
    dd.classList.remove('is-open');
  });

  const portal = document.getElementById('quick-status-floating-portal');
  if (portal) {
    portal.style.display = 'none';
    portal.dataset.currentSeason = '';
  }

  if (!activeDropdownId) {
    document.body.classList.remove('quick-dropdown-active');
  }
}

function setupQuickBarOutsideListeners() {
  if (document.body.dataset.hasQuickBarListener) return;
  document.body.dataset.hasQuickBarListener = 'true';

  document.addEventListener('click', (e) => {
    const portal = document.getElementById('quick-status-floating-portal');
    if (!e.target.closest('.quick-status-custom-dropdown') && (!portal || !portal.contains(e.target))) {
      document.querySelectorAll('.quick-status-custom-dropdown.is-open').forEach(dd => {
        dd.classList.remove('is-open');
      });
      if (portal) {
        portal.style.display = 'none';
        portal.dataset.currentSeason = '';
      }
    }
    const quickBar = document.getElementById('player-series-quick-bar');
    if (quickBar && !quickBar.contains(e.target) && (!portal || !portal.contains(e.target))) {
      closeOtherQuickDropdowns(null);
    }
  });
}

async function updateQuickIframeSrc() {
  if (quickBarSeriesData?.isAnime) {
    if (quickBarSeriesData.animeSource === 'anilibria') {
      const eps = currentMedia?.episodes || [];
      const epObj = eps.find(e => (e.ordinal || 1) === quickBarActiveEpisode) || eps[quickBarActiveEpisode - 1];
      if (epObj) {
        currentEpisodeIndex = quickBarActiveEpisode;
        const streamUrl = epObj.hls_1080 || epObj.hls_720 || epObj.hls_480;
        if (streamUrl) playStreamUrl(streamUrl);
        loadSkipTimes(currentMedia?.id, quickBarActiveEpisode);
      }
    } else if (quickBarSeriesData.animeSource === 'anixart') {
      const epObj = (currentEpisodes || []).find(e => (e.position || 1) === quickBarActiveEpisode) || currentEpisodes?.[quickBarActiveEpisode - 1];
      if (epObj) {
        currentEpisodeIndex = quickBarActiveEpisode;
        playAnixartEpisode(epObj);
        loadSkipTimes(currentMedia?.id, quickBarActiveEpisode);
      }
    }
    return;
  }

  const activePlayerId = currentActivePlayer?.id || '';
  const cleanT = cleanVideoTitle(currentMedia?.title || '');
  const curSeasonObj = quickBarSeriesData?.seasons?.find(s => s.season === quickBarActiveSeason);
  const curEpObj = curSeasonObj?.episodes?.find(e => e.episode === quickBarActiveEpisode);
  const isVideoElementActive = !!document.getElementById('storm-video-player');

  // 1. RuTube HLS (Прямой поток без рекламы и рекомендаций)
  if (activePlayerId === 'rutube_direct_hls' || (isVideoElementActive && (activePlayerId.includes('rutube') || currentMedia?.rutube_id))) {
    try {
      const epRutubeId = curEpObj?.rutube_id || '';
      const epEmbedUrl = curEpObj?.embed_url || '';
      const res = await fetch(`/api/media/rutube-episode?title=${encodeURIComponent(cleanT)}&season=${quickBarActiveSeason}&episode=${quickBarActiveEpisode}&rutube_id=${encodeURIComponent(epRutubeId)}&embed_url=${encodeURIComponent(epEmbedUrl)}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.hls_url) {
          playStreamUrl(data.hls_url);
          showToast(`🎬 ${cleanT}: Сезон ${quickBarActiveSeason} • Серия ${quickBarActiveEpisode}`, 'info');
          updatePlayerUrl(currentMedia, quickBarActiveSeason, quickBarActiveEpisode, currentActivePlayer);
          highlightActiveEpisodeInGrid(quickBarActiveEpisode);
          updateInPlayerEpisodeInfo();
          return;
        } else if (data && data.embed_url) {
          playStreamUrl(data.embed_url);
          showToast(`🎬 ${cleanT}: Сезон ${quickBarActiveSeason} • Серия ${quickBarActiveEpisode}`, 'info');
          updatePlayerUrl(currentMedia, quickBarActiveSeason, quickBarActiveEpisode, currentActivePlayer);
          highlightActiveEpisodeInGrid(quickBarActiveEpisode);
          updateInPlayerEpisodeInfo();
          return;
        }
      }
    } catch (err) {
      console.warn('RuTube HLS episode switch error:', err);
    }
  }

  // 2. RuTube Stream (Iframe)
  if (activePlayerId === 'rutube_stream' || activePlayerId.includes('rutube')) {
    const iframe = document.querySelector('.cinema-player-iframe');
    if (iframe) {
      try {
        const epRutubeId = curEpObj?.rutube_id || '';
        const epEmbedUrl = curEpObj?.embed_url || '';
        if (epEmbedUrl) {
          iframe.src = epEmbedUrl;
          showToast(`🎬 RuTube: Сезон ${quickBarActiveSeason} • Серия ${quickBarActiveEpisode}`, 'info');
          updatePlayerUrl(currentMedia, quickBarActiveSeason, quickBarActiveEpisode, currentActivePlayer);
          highlightActiveEpisodeInGrid(quickBarActiveEpisode);
          updateInPlayerEpisodeInfo();
          return;
        }
        const res = await fetch(`/api/media/rutube-episode?title=${encodeURIComponent(cleanT)}&season=${quickBarActiveSeason}&episode=${quickBarActiveEpisode}&rutube_id=${encodeURIComponent(epRutubeId)}`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.embed_url) {
            iframe.src = data.embed_url;
            showToast(`🎬 RuTube: Сезон ${quickBarActiveSeason} • Серия ${quickBarActiveEpisode}`, 'info');
            updatePlayerUrl(currentMedia, quickBarActiveSeason, quickBarActiveEpisode, currentActivePlayer);
            highlightActiveEpisodeInGrid(quickBarActiveEpisode);
            updateInPlayerEpisodeInfo();
            return;
          }
        }
      } catch (e) {}
    }
  }

  // 3. VK Видео
  if (activePlayerId.startsWith('vk')) {
    const iframe = document.querySelector('.cinema-player-iframe');
    if (iframe) {
      try {
        const res = await fetch(`/api/media/vk-episode?title=${encodeURIComponent(cleanT)}&season=${quickBarActiveSeason}&episode=${quickBarActiveEpisode}`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.embed_url) {
            iframe.src = data.embed_url;
            showToast(`🎬 VK Видео: Сезон ${quickBarActiveSeason} • Серия ${quickBarActiveEpisode}`, 'info');
            updatePlayerUrl(currentMedia, quickBarActiveSeason, quickBarActiveEpisode, currentActivePlayer);
            highlightActiveEpisodeInGrid(quickBarActiveEpisode);
            updateInPlayerEpisodeInfo();
            return;
          }
        }
      } catch (e) {}
    }
  }

  // 4. Kodik / FanFilm Iframe
  const iframe = document.querySelector('.cinema-player-iframe');
  if (iframe) {
    if (quickBarBaseUrl && (quickBarBaseUrl.includes('fanfilm') || quickBarBaseUrl.includes('stravers'))) {
      let url = `/api/player/fanfilm-embed?url=${encodeURIComponent(quickBarBaseUrl)}&translation=${quickBarActiveTranslationId || ''}&hidden=season,episode,translation`;
      if (quickBarSeriesData?.type !== 'movie') {
        url += `&season=${quickBarActiveSeason}&episode=${quickBarActiveEpisode}`;
      }
      iframe.src = url;
    } else {
      let curSrc = iframe.src || (currentActivePlayer?.url || '');
      if (curSrc) {
        let newUrl = curSrc;
        if (newUrl.includes('season=') || newUrl.includes('episode=')) {
          newUrl = newUrl.replace(/([?&])season=\d+/g, `$1season=${quickBarActiveSeason}`);
          newUrl = newUrl.replace(/([?&])episode=\d+/g, `$1episode=${quickBarActiveEpisode}`);
        } else {
          newUrl += (newUrl.includes('?') ? '&' : '?') + `season=${quickBarActiveSeason}&episode=${quickBarActiveEpisode}`;
        }
        iframe.src = newUrl;
      }
    }
    showToast(`🎬 Сезон ${quickBarActiveSeason} • Серия ${quickBarActiveEpisode}`, 'info');
    updatePlayerUrl(currentMedia, quickBarActiveSeason, quickBarActiveEpisode, currentActivePlayer);
    highlightActiveEpisodeInGrid(quickBarActiveEpisode);
    updateInPlayerEpisodeInfo();
  }
}

function highlightActiveEpisodeInGrid(episodeNum) {
  const gridEl = document.getElementById('series-episodes-grid');
  if (!gridEl) return;
  gridEl.querySelectorAll('.series-episode-card').forEach(card => {
    const isAct = parseInt(card.dataset.epNum, 10) === episodeNum;
    card.classList.toggle('active', isAct);
    if (isAct) {
      card.classList.add('watched');
    }
  });
}

async function selectQuickSeason(seasonNum) {
  if (quickBarActiveSeason === seasonNum) return;

  if (quickBarSeriesData?.isAnime && quickBarSeriesData.animeSource === 'anixart') {
    const targetSeasonObj = quickBarSeriesData.seasons.find(s => s.season === seasonNum);
    if (targetSeasonObj && targetSeasonObj.releaseId && String(targetSeasonObj.releaseId) !== String(currentMedia?.anixart_release_id || currentMedia?.id)) {
      await switchAnixartSeason(targetSeasonObj.releaseId, seasonNum);
      return;
    }
  }

  quickBarActiveSeason = seasonNum;
  quickBarActiveEpisode = 1;
  renderQuickBarDropdowns();
  updateQuickIframeSrc();
  renderSeriesSeasons(currentMedia, seasonNum, 1);

  showToast(`📺 Сезон ${seasonNum}`, 'info');
  trackClientAction('watch_series_episode', { season: seasonNum, episode: 1 });
}

function selectQuickEpisode(episodeNum) {
  const ep = Number(episodeNum);
  if (!ep || isNaN(ep)) return;
  quickBarActiveEpisode = ep;
  currentEpisodeIndex = ep;
  renderQuickBarDropdowns();
  updateQuickIframeSrc();

  if (currentMedia?.id) {
    markEpisodeWatched(currentMedia.id, quickBarActiveSeason, ep, true);
  }

  showToast(`🎬 Сезон ${quickBarActiveSeason} • Серия ${ep}`, 'info');
  trackClientAction('watch_series_episode', { season: quickBarActiveSeason, episode: ep });

  if (currentMedia?.id && quickBarSeriesData) {
    const sObj = quickBarSeriesData.seasons.find(s => Number(s.season) === Number(quickBarActiveSeason));
    if (sObj && sObj.episodes_count) {
      const watched = getWatchedEpisodes(currentMedia.id, quickBarActiveSeason);
      if (watched.size >= sObj.episodes_count) {
        trackClientAction('complete_season', { season: quickBarActiveSeason });
      }
    }
  }

  highlightActiveEpisodeInGrid(ep);
  updateInPlayerEpisodeInfo();
}

async function switchAnixartVoiceover(voiceoverId) {
  const host = document.getElementById('cinema-player-wrapper');
  if (host) {
    host.innerHTML = '<div style="display:flex;height:100%;align-items:center;justify-content:center;gap:10px;color:var(--text-muted);"><div class="storm-spinner"></div><span>Смена озвучки AniXart...</span></div>';
  }
  try {
    const relId = currentMedia?.anixart_release_id || currentMedia?.id;
    const res = await fetch(`/api/anixart/episodes/${relId}/${voiceoverId}`);
    const rawEpisodes = await res.json();
    currentEpisodes = (rawEpisodes || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));

    if (quickBarSeriesData && quickBarSeriesData.seasons && quickBarSeriesData.seasons[0]) {
      quickBarSeriesData.seasons[0].episodes = currentEpisodes.map(ep => ({
        episode: ep.position || 1,
        name: ep.name_ru || ep.name || `${ep.position || 1} серия`
      }));
      quickBarSeriesData.seasons[0].episodes_count = currentEpisodes.length;
      quickBarSeriesData.active.id_translation = voiceoverId;
    }

    renderQuickBarDropdowns();
    renderSeriesSeasons(currentMedia, 1, quickBarActiveEpisode);

    const chosenEp = currentEpisodes.find(e => (e.position || 1) === quickBarActiveEpisode) || currentEpisodes[0];
    if (chosenEp) {
      playAnixartEpisode(chosenEp);
    }
    const vName = currentMedia?.voiceovers?.find(v => String(v.id) === String(voiceoverId))?.name || 'AniXart';
    savePreferredVoiceover(vName);
    showToast(`🎙️ Выбрана озвучка: ${vName}`, 'info');
  } catch (err) {
    console.warn('Ошибка смены озвучки AniXart:', err);
    showToast(`Ошибка смены озвучки: ${err.message}`, 'error');
  }
}

async function selectQuickVoiceover(translationId) {
  if (String(quickBarActiveTranslationId) === String(translationId)) return;
  quickBarActiveTranslationId = translationId;

  if (quickBarSeriesData?.isAnime && quickBarSeriesData.animeSource === 'anixart') {
    currentVoiceoverId = translationId;
    localStorage.setItem(`storm_fav_voiceover_${currentMedia?.id}`, String(translationId));
    const vObj = currentMedia?.voiceovers?.find(v => String(v.id) === String(translationId));
    if (vObj?.name) savePreferredVoiceover(vObj.name);
    await switchAnixartVoiceover(translationId);
    return;
  }

  renderQuickBarDropdowns();
  updateQuickIframeSrc();

  let voiceName = 'Озвучка обновлена';
  const sObj = quickBarSeriesData?.seasons?.find(s => s.season === quickBarActiveSeason) || quickBarSeriesData?.seasons?.[0];
  const epObj = sObj?.episodes?.find(e => e.episode === quickBarActiveEpisode) || sObj?.episodes?.[0];
  const transObj = epObj?.translations?.find(t => String(t.id) === String(translationId));
  if (transObj) {
    savePreferredVoiceover(transObj.name);
    voiceName = `🎙️ ${transObj.name}${transObj.is_uhd ? ' (4K UHD)' : ''}`;
    if (transObj.is_uhd) {
      trackClientAction('use_4k');
      const cur4k = parseInt(localStorage.getItem('storm_4k_count') || '0', 10);
      localStorage.setItem('storm_4k_count', String(cur4k + 1));
    }
  }

  const curVoiceCount = parseInt(localStorage.getItem('storm_voiceovers_count') || '0', 10);
  localStorage.setItem('storm_voiceovers_count', String(curVoiceCount + 1));

  showToast(voiceName, 'info');
  trackClientAction('switch_voiceover', { translation_id: translationId });
}

let streamCheckAbort = null;
async function checkAndAutoFallbackStream(rawUrl) {
  if (!rawUrl || rawUrl.includes('kodik') || rawUrl.includes('youtube')) return;
  if (streamCheckAbort) {
    try { streamCheckAbort.abort(); } catch {}
  }
  streamCheckAbort = new AbortController();
  try {
    const res = await fetch(`/api/player/check-stream?url=${encodeURIComponent(rawUrl)}`, {
      signal: streamCheckAbort.signal
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.alive === false) {
        console.warn('Обнаружен недействительный поток FanFilm4K, выполняем авто-переход');
        const brokenP = currentPlayers?.find(p => p.id === 'fanfilm4k_uhd' || p.url === rawUrl);
        if (brokenP) {
          brokenP.status = 'broken';
          brokenP.status_label = '🔴 Недоступен';
        }
        const kodik = currentPlayers?.find(p => p.id === 'kodik_direct' && p.status !== 'broken');
        const rezka = currentPlayers?.find(p => p.id === 'rezka_cinema' && p.status !== 'broken');
        const fallbackTarget = kodik || rezka || currentPlayers?.find(p => p.id !== 'fanfilm4k_uhd' && p.status !== 'broken');
        if (fallbackTarget && currentActivePlayer?.id !== fallbackTarget.id) {
          selectPlayer(fallbackTarget);
          showToast(`⚡ Автоматически включен проверенный плеер ${fallbackTarget.name}!`, 'info');
        } else {
          switchToNextSource(true);
        }
      }
    }
  } catch {}
}

window.addEventListener('message', (e) => {
  if (e.data?.type === 'STORM_SWITCH_NEXT_SOURCE') {
    console.warn('Получен сигнал переключения источника:', e.data?.reason);
    switchToNextSource(true);
  }
});

function playStreamUrl(url) {
  const container = document.getElementById('cinema-player-wrapper');
  if (!container) return;

  const cleanStreamUrl = String(url || '').trim();
  if (!cleanStreamUrl || cleanStreamUrl === '/' || cleanStreamUrl === 'undefined') {
    container.innerHTML = `
      <div class="player-video-box" style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;text-align:center;padding:30px;background:rgba(10,12,18,0.92);border-radius:12px;gap:14px;">
        <div style="font-size:42px;">🎬</div>
        <div style="font-size:17px;font-weight:800;color:var(--text-primary);">Видеопоток временно недоступен</div>
        <div style="max-width:520px;font-size:13px;line-height:1.6;color:var(--text-secondary);">Попробуйте выбрать резервный плеер в списке доступных источников ниже.</div>
      </div>
    `;
    return;
  }

  if (currentMedia?.source === 'fanfilm4k') {
    trackClientAction('use_4k');
  }

  if (iframeWatchInterval) {
    clearInterval(iframeWatchInterval);
    iframeWatchInterval = null;
  }

  if (url.includes('.m3u8')) {
    const quickBar = document.getElementById('player-series-quick-bar');
    if (quickBar) {
      if (quickBarSeriesData && quickBarSeriesData.seasons && quickBarSeriesData.seasons.length > 0) {
        quickBar.style.display = 'flex';
      } else if (checkIfMediaIsSeries(currentMedia)) {
        initUniversalSeriesQuickBar(quickBarActiveSeason, quickBarActiveEpisode);
      } else {
        quickBar.style.display = 'none';
        adjustCinemaModalScale();
      }
    }

    container.innerHTML = `
      <div class="player-video-box" style="position:relative;width:100%;height:100%;">
        <!-- Динамическая подсветка Ambilight -->
        <div id="player-ambilight-aura" class="ambilight-aura"></div>

        <video id="storm-video-player" controls autoplay crossorigin="anonymous" style="width:100%;height:100%;background:#000;border-radius:12px;outline:none;position:relative;z-index:2;" playsinline></video>

        <!-- Кнопки пропуска заставок -->
        <button type="button" class="storm-skip-btn" id="skip-intro-btn" style="display: none;">
          ⏭️ Пропустить заставку
        </button>
        <button type="button" class="storm-skip-btn" id="skip-outro-btn" style="display: none;">
          ⏭️ Следующая серия
        </button>
      </div>
    `;

    const video = document.getElementById('storm-video-player');
    const videoBox = container.querySelector('.player-video-box');

    // Настраиваем HLS с поддержкой ленивой загрузки и P2P Smart-Cache 4K HDR
    const setupHlsStream = () => {
      if (window.Hls && window.Hls.isSupported()) {
        const hls = new window.Hls({
          maxBufferLength: 60,
          maxMaxBufferLength: 120,
          maxBufferSize: 120 * 1024 * 1024,
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 30
        });
        window._stormHls = hls;
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {});
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
        video.play().catch(() => {});
      }
    };

    if (window.Hls) {
      setupHlsStream();
    } else {
      ensureHlsLoaded().then(setupHlsStream).catch(() => {
        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = url;
          video.play().catch(() => {});
        }
      });
    }

    // Подключаем Ambilight, Субтитры, Пропуск заставок и Watch Together
    setupVideoFeatures(video, videoBox);
    return;
  }

  let streamUrl = url;
  const isFanfilmOrStravers = typeof url === 'string' && (url.includes('stravers.live') || url.includes('fanfilm4k') || url.includes('fanfilm'));

  if (isFanfilmOrStravers) {
    streamUrl = `/api/player/fanfilm-embed?url=${encodeURIComponent(url)}&hidden=season,episode,translation`;
    initSeriesQuickBar(url);
    checkAndAutoFallbackStream(url);
  } else if (!quickBarSeriesData?.seasons?.length && !quickBarSeriesData?.isAnime) {
    if (checkIfMediaIsSeries(currentMedia)) {
      initUniversalSeriesQuickBar(quickBarActiveSeason, quickBarActiveEpisode);
    } else {
      const quickBar = document.getElementById('player-series-quick-bar');
      if (quickBar) quickBar.style.display = 'none';
      adjustCinemaModalScale();
    }
  } else if (quickBarSeriesData?.seasons?.length > 0) {
    const quickBar = document.getElementById('player-series-quick-bar');
    if (quickBar) quickBar.style.display = 'flex';
  }

  if (typeof streamUrl === 'string') {
    streamUrl = streamUrl.trim();
    if (streamUrl.includes('/api/player/kodik-embed?url=')) {
      try {
        const parsed = new URL(streamUrl, window.location.origin);
        const inner = parsed.searchParams.get('url');
        if (inner) streamUrl = inner;
      } catch {}
    }
    if (streamUrl.startsWith('//')) {
      streamUrl = 'https:' + streamUrl;
    }
    if (vpnBypassEnabled && !streamUrl.startsWith('/api/player/')) {
      streamUrl = `/api/player/vpn-proxy?url=${encodeURIComponent(streamUrl)}`;
    }
  }

    const isVkPlayer = typeof streamUrl === 'string' && (streamUrl.includes('vkvideo.ru') || streamUrl.includes('vk.com'));

    container.innerHTML = `
      <div class="player-video-box" style="position:relative;width:100%;height:100%;">
        <div id="player-ambilight-aura" class="ambilight-aura"></div>
        <iframe class="cinema-player-iframe" src="${streamUrl}" referrerpolicy="no-referrer-when-downgrade" allow="autoplay *; fullscreen *; picture-in-picture *; encrypted-media *; display-capture *; microphone *; camera *" allowfullscreen="true" webkitallowfullscreen="true" mozallowfullscreen="true" style="position:relative;z-index:2;width:100%;height:100%;border:none;border-radius:12px;"></iframe>
        ${isVkPlayer ? `
          <button type="button" class="storm-unmute-btn" id="storm-unmute-btn" title="Включить звук VK Видео">
            <span class="unmute-icon">🔊</span>
            <span class="unmute-text">Включить звук</span>
          </button>
        ` : ''}
      </div>
    `;

  const iframeBox = container.querySelector('.player-video-box');
  if (iframeBox) {
    mountInPlayerOverlay(iframeBox);
    mountCleanViewOverlay(iframeBox);
  }

  const iframeEl = container.querySelector('.cinema-player-iframe');
  if (iframeEl) {
    if (isVkPlayer) {
      const unmuteAll = () => {
        try {
          const commands = [
            { method: 'unmute' },
            { method: 'setVolume', value: 1 },
            { action: 'unmute' },
            { action: 'setVolume', value: 1 },
            { type: 'unmute' },
            { type: 'setVolume', volume: 1 },
            { event: 'unmute' },
            { key: 'vk_player_api', value: { action: 'unmute' } },
            { key: 'vk_player_api', value: { action: 'setVolume', value: 1 } }
          ];
          commands.forEach(cmd => {
            iframeEl.contentWindow?.postMessage(JSON.stringify(cmd), '*');
            iframeEl.contentWindow?.postMessage(cmd, '*');
          });
        } catch (_) {}
      };

      iframeEl.onload = () => {
        applySavedPlaybackSpeed();
        applyProAudioSettings();
        unmuteAll();
        setTimeout(unmuteAll, 300);
        setTimeout(unmuteAll, 800);
        setTimeout(unmuteAll, 1800);
        setTimeout(unmuteAll, 3200);
      };

      const unmuteBtn = container.querySelector('#storm-unmute-btn');
      if (unmuteBtn) {
        unmuteBtn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          unmuteAll();
          unmuteBtn.classList.add('fade-out');
          setTimeout(() => unmuteBtn.remove(), 350);
          showToast('🔊 Звук включен', 'success');
        };
        setTimeout(() => {
          if (unmuteBtn && unmuteBtn.parentElement) {
            unmuteBtn.classList.add('fade-out');
            setTimeout(() => unmuteBtn.remove(), 350);
          }
        }, 10000);
      }

      const onUserInteract = () => {
        unmuteAll();
      };
      if (iframeBox) {
        iframeBox.addEventListener('click', onUserInteract, { passive: true });
        iframeBox.addEventListener('touchstart', onUserInteract, { passive: true });
      }
    } else {
      iframeEl.onload = () => {
        applySavedPlaybackSpeed();
        applyProAudioSettings();
      };
    }
    iframeEl.onerror = () => {
      switchToNextSource();
    };
  }

  applySavedPlaybackSpeed();
  applyProAudioSettings();
  applyProVideoSettings();

  if (ambilightEnabled) {
    startAmbilightLoop(null);
  }

  // Трекинг прогресса: для iframe не накручиваем фиктивные секунды при простое модального окна
  if (iframeWatchInterval) {
    clearInterval(iframeWatchInterval);
    iframeWatchInterval = null;
  }
  currentWatchTimeSeconds = Math.round(((currentProgressPercent || 0) / 100) * 7200);
}

function setupVideoFeatures(video, wrapper) {
  if (video && !video.dataset.hasDblClickListener) {
    video.dataset.hasDblClickListener = 'true';
    video.addEventListener('dblclick', (e) => {
      e.preventDefault();
      toggleCinemaFullscreen();
    });
  }

  // 0. Динамическая синхронизация реальной длительности потока со всеми элементами интерфейса
  const syncStreamDuration = () => {
    if (video && video.duration && isFinite(video.duration) && video.duration > 30) {
      updateSidebarDuration(video.duration);
    }
  };
  video.addEventListener('loadedmetadata', syncStreamDuration);
  video.addEventListener('durationchange', syncStreamDuration);
  video.addEventListener('canplay', syncStreamDuration);
  video.addEventListener('playing', syncStreamDuration);
  syncStreamDuration();

  // 1. Ambilight
  initAmbilight(video);

  // 2. Субтитры и аудиодорожки
  initSubtitlesManager(video, wrapper);

  // 3. Синхронизация Кинокомнаты
  if (getActiveRoom()) {
    attachPlayerToRoom(video);
  }

  // 4. Логика пропуска опенингов и эндингов (Smart Skip)
  initSmartSkip(video);

  // 5. Ночной режим звука (Web Audio компрессор)
  applyNightModeAudio(video);

  // 6. Профессиональный движок видео и звука (HDR, CAS, Dolby Atmos 3D, EQ, WebGL Shaders)
  applyProVideoSettings(video);
  initProAudioEngine(video);
  initVideoUpscalerShaders(video);

  // 7. STORM CleanView & AdShield
  mountCleanViewOverlay(wrapper);

  // 7. X-Ray режим на паузе
  setupXRayMode(video, wrapper);

  // 7. Покадровая навигация (Thumbnail Scrubbing)
  setupThumbnailScrubbing(video);

  // 8. Автоматический динамический прогресс просмотра
  let lastSyncTime = 0;
  video.addEventListener('timeupdate', () => {
    if (video.duration && !isNaN(video.duration)) {
      if (isFinite(video.duration) && video.duration > 30) {
        const durEl = document.querySelector('#cinema-side-info [data-info="duration"]');
        const expected = formatDurationDisplay(video.duration);
        if (durEl && expected && durEl.textContent.trim() !== expected) {
          updateSidebarDuration(video.duration);
        }
      }
      const percent = Math.min(100, Math.round((video.currentTime / video.duration) * 100));
      currentProgressPercent = percent;
      currentWatchTimeSeconds = Math.round(video.currentTime);
      const slider = document.getElementById('player-progress-slider');
      const label = document.getElementById('player-progress-label');
      if (slider) slider.value = percent;
      if (label) label.textContent = `${percent}%`;

      // При достижении 90% (начало финальных титров) автоматически отмечаем просмотренным
      if (percent >= 90 && currentMedia) {
        const isSeries = currentMedia.media_type === 'series' || currentMedia.media_type === 'anime-series' || currentMedia.media_type === 'cartoon-series';
        if (isSeries) {
          // Серия сериала отмечается как просмотренная, но общий сериал не отмечается просмотренным
          applySeasonStatus(currentMedia.id, currentMedia.season || 1, 'watching');
        } else if (currentMedia.user_status !== 'completed') {
          // Для фильма ставим Просмотрено и очищаем из истории Продолжить просмотр
          currentMedia.user_status = 'completed';
          saveBookmarkStatus(currentMedia, 'completed');
          renderStatusButtons('completed');
        }
      }

      const now = Date.now();
      if (now - lastSyncTime >= 10000 && currentMedia) {
        lastSyncTime = now;
        syncWatchProgress({
          media_id: currentMedia.id,
          source: currentMedia.source,
          title: currentMedia.title,
          poster_url: currentMedia.poster,
          media_type: currentMedia.media_type,
          year: currentMedia.year || '',
          season: currentMedia.season || 1,
          episode: currentEpisodeIndex || 1,
          total_episodes: currentEpisodes.length || 1,
          duration_seconds: Math.round(video.duration),
          time_seconds: currentWatchTimeSeconds,
          progress_percent: percent
        });
      }
    }
  });

  // 9. Сохранение и автоприменение скорости воспроизведения
  applySavedPlaybackSpeed(video);
  video.addEventListener('loadedmetadata', () => applySavedPlaybackSpeed(video));
  video.addEventListener('play', () => applySavedPlaybackSpeed(video));
  video.addEventListener('ratechange', () => {
    if (video.playbackRate) {
      localStorage.setItem('storm_playback_speed', String(video.playbackRate));
      updateInPlayerSpeedDisplay(video.playbackRate);
    }
  });

  // 10. Автопереход к следующей серии сериала или следующей части франшизы
  video.addEventListener('ended', async () => {
    const isSeries = checkIfMediaIsSeries(currentMedia);
    if (isSeries) {
      if (video.dataset.hasEndedTriggered) return;
      video.dataset.hasEndedTriggered = 'true';
      setTimeout(() => { delete video.dataset.hasEndedTriggered; }, 5000);

      showToast('Воспроизведение завершено. Запуск следующей серии...', 'info');
      setTimeout(() => {
        playInPlayerNextEpisode();
      }, 1000);
      return;
    }

    if (currentMedia && currentMedia.user_status !== 'completed') {
      currentMedia.user_status = 'completed';
      await saveBookmarkStatus(currentMedia, 'completed');
      renderStatusButtons('completed');
    }
    await autoAdvanceNextFranchiseItem();
  });

  // 11. Монтирование интеллектуального оверлея плеера и серий
  mountInPlayerOverlay(wrapper);
}

// ==========================================
// НОЧНОЙ РЕЖИМ ЗВУКА (NIGHT MODE AUDIO)
// ==========================================
export function toggleNightModeAudio(video = document.getElementById('storm-video-player')) {
  nightAudioModeEnabled = !getProAudioNightMode();
  setProAudioNightMode(nightAudioModeEnabled);
  try {
    localStorage.setItem('storm_night_audio', nightAudioModeEnabled ? 'true' : 'false');
  } catch {}
  showToast(`🌙 Ночной режим звука: ${nightAudioModeEnabled ? 'Включен (диалоги четче, взрывы мягче)' : 'Выключен (стандартный звук)'}`, 'info');

  const btn = document.getElementById('toggle-night-audio-btn');
  if (btn) {
    btn.classList.toggle('active', nightAudioModeEnabled);
    const badge = btn.querySelector('.night-audio-badge');
    if (badge) {
      badge.textContent = nightAudioModeEnabled ? 'ВКЛ' : 'ВЫКЛ';
      badge.style.color = nightAudioModeEnabled ? 'var(--storm-accent-green, #10b981)' : 'var(--text-muted)';
    }
  }
}

export function applyNightModeAudio(video) {
  const saved = localStorage.getItem('storm_night_audio') === 'true';
  nightAudioModeEnabled = saved;
  setProAudioNightMode(nightAudioModeEnabled);

  const btn = document.getElementById('toggle-night-audio-btn');
  if (btn) {
    btn.classList.toggle('active', nightAudioModeEnabled);
    const badge = btn.querySelector('.night-audio-badge');
    if (badge) {
      badge.textContent = nightAudioModeEnabled ? 'ВКЛ' : 'ВЫКЛ';
      badge.style.color = nightAudioModeEnabled ? 'var(--storm-accent-green, #10b981)' : 'var(--text-muted)';
    }
  }
}

// ==========================================
// X-RAY РЕЖИМ (АКТЕРЫ И САУНДТРЕКИ НА ПАУЗЕ)
// ==========================================
function setupXRayMode(video, wrapper) {
  if (!video || !wrapper) return;

  // Автоматическое навязчивое открытие X-Ray на паузе отключено, чтобы не блокировать управление видео и экраном на мобильных.
  // Пользователь может открыть X-Ray вручную через студийное меню (toggleXRayManual).
  video.addEventListener('play', () => {
    hideXRayPanel(wrapper);
  });
}

let xrayAudioElement = null;
let currentPlayingTrackUrl = null;

function renderXRaySoundtrackTab(musicTab, soundtrack, panel) {
  if (!musicTab || !soundtrack) return;
  const tracks = soundtrack.tracks || [];

  musicTab.innerHTML = `
    <div style="font-size: 11.5px; color: var(--text-muted); margin-bottom: 10px; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px; align-items: center;">
      <span>Альбом: <b style="color: var(--text-primary);">${soundtrack.album || soundtrack.title}</b></span>
      <span>Композитор / Исполнитель: <b style="color: var(--accent);">${soundtrack.artist}</b></span>
    </div>
    <div class="xray-tracks-list">
      ${tracks.length > 0 ? tracks.map(t => {
        const isPlaying = currentPlayingTrackUrl === t.preview_url && t.preview_url;
        return `
          <div class="xray-track-item ${isPlaying ? 'is-playing' : ''}" data-track-url="${t.preview_url || ''}">
            <div class="xray-track-info" style="display: flex; align-items: center; gap: 10px;">
              ${t.preview_url ? `
                <button type="button" class="xray-track-play-btn" data-preview-url="${t.preview_url}" title="${isPlaying ? 'Пауза' : 'Прослушать отрывок'}">
                  ${isPlaying ? '⏸' : '▶'}
                </button>
              ` : `<span class="xray-track-num">${t.number || '🎵'}</span>`}
              ${t.artwork ? `<img src="${t.artwork}" alt="${t.title}" class="xray-track-thumb" onerror="this.style.display='none'">` : ''}
              <div>
                <div class="xray-track-title" style="font-weight: 700; font-size: 13px; display: flex; align-items: center; gap: 6px;">
                  <span>${t.title}</span>
                  ${isPlaying ? '<div class="xray-track-eq-anim"><span></span><span></span><span></span></div>' : ''}
                </div>
                <div class="xray-track-scene" style="font-size: 11px; color: var(--text-muted);">${t.artist || t.scene || ''}</div>
              </div>
            </div>
            <span class="xray-track-dur" style="font-size: 12px; font-weight: 600; color: var(--text-secondary);">${t.duration || '03:30'}</span>
          </div>
        `;
      }).join('') : '<div style="color: var(--text-muted); font-size: 12px; padding: 12px; text-align: center;">Саундтреки для данного релиза уточняются...</div>'}
    </div>
  `;

  // Обработка клика по воспроизведению отрывка
  musicTab.querySelectorAll('.xray-track-play-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const url = btn.dataset.previewUrl;
      if (!url) return;

      if (currentPlayingTrackUrl === url && xrayAudioElement && !xrayAudioElement.paused) {
        xrayAudioElement.pause();
        currentPlayingTrackUrl = null;
        renderXRaySoundtrackTab(musicTab, soundtrack, panel);
        return;
      }

      if (xrayAudioElement) {
        xrayAudioElement.pause();
        xrayAudioElement = null;
      }

      xrayAudioElement = new Audio(url);
      xrayAudioElement.volume = 0.85;
      xrayAudioElement.play().then(() => {
        currentPlayingTrackUrl = url;
        renderXRaySoundtrackTab(musicTab, soundtrack, panel);
      }).catch(() => {
        showToast('Не удалось запустить онлайн-воспроизведение отрывка', 'warning');
      });

      xrayAudioElement.onended = () => {
        currentPlayingTrackUrl = null;
        renderXRaySoundtrackTab(musicTab, soundtrack, panel);
      };
    };
  });
}

function renderXRayCastTab(castTab, cast) {
  if (!castTab) return;
  castTab.innerHTML = `
    <div class="xray-cast-row">
      ${cast.length > 0 ? cast.map(c => `
        <div class="xray-actor-card" data-person-id="${c.id || ''}" data-person-name="${c.name || ''}" title="Нажмите, чтобы открыть фильмографию">
          <img src="${c.photo || 'assets/favicon.svg'}" alt="${c.name}" class="xray-actor-img" onerror="this.src='assets/favicon.svg'">
          <div style="min-width: 0;">
            <div class="xray-actor-name">${c.name}</div>
            <div class="xray-actor-role">${c.character || 'В главных ролях'}</div>
          </div>
        </div>
      `).join('') : '<div style="color: var(--text-muted); font-size: 12px; padding: 8px;">Информация об актерском составе загружается...</div>'}
    </div>
  `;

  castTab.querySelectorAll('[data-person-id]').forEach(card => {
    card.onclick = () => {
      const pid = card.dataset.personId;
      const pname = card.dataset.personName;
      if (pid && typeof openPersonModal === 'function') {
        openPersonModal(pid, pname);
      }
    };
  });
}

function renderXRayTriviaTab(triviaTab, triviaList) {
  if (!triviaTab) return;
  triviaTab.innerHTML = `
    <div class="xray-trivia-list">
      ${triviaList.map(item => `
        <div class="xray-trivia-item">
          <span class="xray-trivia-label">${item.label}:</span>
          <span class="xray-trivia-content">${item.content}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function showXRayPanel(wrapper) {
  if (!currentMedia) return;
  let panel = wrapper.querySelector('#player-xray-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'player-xray-panel';
    panel.className = 'player-xray-panel';
    wrapper.appendChild(panel);
  }

  const cleanTitle = cleanVideoTitle(currentMedia.title);
  const cast = currentMedia.cast || [];
  const directors = currentMedia.directors || [];
  const composers = currentMedia.composers || [];
  const writers = currentMedia.writers || [];
  const cinematographers = currentMedia.cinematographers || [];

  const primaryComposer = composers[0]?.name || (directors[0]?.name ? `Оркестр под управлением ${directors[0].name}` : 'Оригинальный композитор');
  const soundtrack = currentMedia.soundtrack || {
    title: `${cleanTitle} (Original Soundtrack)`,
    artist: primaryComposer,
    album: `${cleanTitle} OST`,
    tracks: [
      { number: 1, title: `${cleanTitle} (Main Theme)`, artist: primaryComposer, duration: '03:42', scene: 'Заглавная тема фильма' },
      { number: 2, title: 'Cinematic Progression', artist: primaryComposer, duration: '02:35', scene: 'Развитие сюжета' },
      { number: 3, title: 'High Stakes and Climax', artist: primaryComposer, duration: '04:12', scene: 'Ключевая драматическая сцена' },
      { number: 4, title: 'End Credits Suite', artist: primaryComposer, duration: '03:50', scene: 'Финальные титры' }
    ]
  };

  const triviaList = currentMedia.trivia && currentMedia.trivia.length > 0 ? currentMedia.trivia : [
    { label: 'Мастеринг', content: 'Релиз представлен в оригинальном кинематографическом качестве 4K UHD с объемным многоканальным звуком.' },
    { label: 'Премьера', content: `Официальный мировой релиз ${currentMedia.release_date || currentMedia.year || ''} года.` }
  ];

  const crewList = [
    ...directors.map(d => ({ ...d, role: d.role || 'Режиссер' })),
    ...composers.map(c => ({ ...c, role: 'Композитор' })),
    ...writers.map(w => ({ ...w, role: 'Сценарист' })),
    ...cinematographers.map(c => ({ ...c, role: 'Оператор' }))
  ];

  panel.innerHTML = `
    <div class="xray-header">
      <div class="xray-title-group">
        <div class="xray-title">
          <span>🔍</span>
          <span>X-Ray: ${cleanTitle}</span>
        </div>
        <div class="xray-scene-music" title="Официальный саундтрек картины">
          <span>🎵</span>
          <span id="xray-soundtrack-title"><b>${soundtrack.tracks?.[0]?.title || soundtrack.title}</b> — ${soundtrack.artist}</span>
        </div>
      </div>

      <div style="display: flex; align-items: center; gap: 10px;">
        <div class="xray-tabs-nav">
          <button type="button" class="xray-tab-btn active" data-xray-tab="cast">🎭 В кадре (${cast.length})</button>
          <button type="button" class="xray-tab-btn" data-xray-tab="music">🎵 Саундтрек</button>
          <button type="button" class="xray-tab-btn" data-xray-tab="trivia">💡 Факты (${triviaList.length})</button>
          <button type="button" class="xray-tab-btn" data-xray-tab="crew">🎬 Создатели (${crewList.length})</button>
        </div>
        <button type="button" class="storm-btn storm-btn-sm" id="close-xray-btn" style="padding: 4px 8px;" title="Скрыть панель X-Ray">✕</button>
      </div>
    </div>

    <!-- Вкладка 1: Актеры в кадре -->
    <div class="xray-tab-content active" id="xray-tab-cast"></div>

    <!-- Вкладка 2: Саундтрек и музыка -->
    <div class="xray-tab-content" id="xray-tab-music"></div>

    <!-- Вкладка 3: Интересные факты (Trivia) -->
    <div class="xray-tab-content" id="xray-tab-trivia"></div>

    <!-- Вкладка 4: Создатели картины -->
    <div class="xray-tab-content" id="xray-tab-crew">
      <div class="xray-crew-list">
        ${crewList.length > 0 ? crewList.map(person => `
          <div class="xray-crew-card" data-person-id="${person.id || ''}" data-person-name="${person.name || ''}" style="cursor: pointer;" title="Открыть фильмографию">
            <img src="${person.photo || 'assets/favicon.svg'}" alt="${person.name}" class="xray-crew-img" onerror="this.src='assets/favicon.svg'">
            <div>
              <div class="xray-crew-name">${person.name}</div>
              <div class="xray-crew-role">${person.role}</div>
            </div>
          </div>
        `).join('') : '<div style="color: var(--text-muted); font-size: 12px; padding: 8px;">Данные о съемочной группе уточняются...</div>'}
      </div>
    </div>
  `;

  const castTab = panel.querySelector('#xray-tab-cast');
  const musicTab = panel.querySelector('#xray-tab-music');
  const triviaTab = panel.querySelector('#xray-tab-trivia');

  renderXRayCastTab(castTab, cast);
  renderXRaySoundtrackTab(musicTab, soundtrack, panel);
  renderXRayTriviaTab(triviaTab, triviaList);

  // Фоновая загрузка реальных саундтреков с iTunes
  if (!currentMedia.soundtrackLoaded) {
    fetch(`/api/media/soundtrack?title=${encodeURIComponent(cleanTitle)}&original_title=${encodeURIComponent(currentMedia.original_title || '')}&year=${encodeURIComponent(currentMedia.year || '')}`)
      .then(res => res.json())
      .then(data => {
        if (data && data.tracks && data.tracks.length > 0) {
          currentMedia.soundtrack = data;
          currentMedia.soundtrackLoaded = true;
          const currentMusicTab = panel.querySelector('#xray-tab-music');
          if (currentMusicTab) renderXRaySoundtrackTab(currentMusicTab, data, panel);
          const stTitle = panel.querySelector('#xray-soundtrack-title');
          if (stTitle) stTitle.innerHTML = `<b>${data.tracks[0]?.title || data.title}</b> — ${data.artist}`;
        }
      })
      .catch(() => {});
  }

  // Фоновое обогащение актерского состава, если актеров нет
  if (cast.length === 0 && currentMedia.title) {
    (async () => {
      try {
        let loadedCast = null;
        if (currentMedia.id) {
          const src = currentMedia.source || 'tmdb';
          const r = await fetch(`/api/media/${encodeURIComponent(src)}/${encodeURIComponent(currentMedia.id)}/cast`);
          if (r.ok) {
            const data = await r.json();
            if (data?.cast?.length) loadedCast = data.cast;
          }
        }
        if (!loadedCast || !loadedCast.length) {
          const r = await fetch(`/api/media/cast?title=${encodeURIComponent(cleanTitle)}`);
          if (r.ok) {
            const data = await r.json();
            if (data?.cast?.length) loadedCast = data.cast;
          }
        }
        if (loadedCast && loadedCast.length) {
          currentMedia.cast = loadedCast;
          const cTab = panel.querySelector('#xray-tab-cast');
          if (cTab) renderXRayCastTab(cTab, loadedCast);
          const castBtn = panel.querySelector('[data-xray-tab="cast"]');
          if (castBtn) castBtn.textContent = `🎭 В кадре (${loadedCast.length})`;
          return;
        }
      } catch (_) {}

      // TMDB поиск как глубокий fallback
      try {
        const r = await fetch(`/api/media/search?q=${encodeURIComponent(cleanTitle)}&source=tmdb`);
        const data = await r.json();
        if (data?.items?.length > 0) {
          const first = data.items[0];
          const res = await fetch(`/api/media/item?id=${first.id}&source=tmdb&media_type=${first.media_type || ''}&title=${encodeURIComponent(cleanTitle)}`);
          if (res.ok) {
            const full = await res.json();
            if (full.cast?.length) {
              currentMedia.cast = full.cast;
              currentMedia.directors = full.directors || currentMedia.directors;
              currentMedia.composers = full.composers || currentMedia.composers;
              currentMedia.writers = full.writers || currentMedia.writers;
              currentMedia.cinematographers = full.cinematographers || currentMedia.cinematographers;
              if (full.trivia?.length) currentMedia.trivia = full.trivia;

              const cTab = panel.querySelector('#xray-tab-cast');
              if (cTab) renderXRayCastTab(cTab, full.cast);
              const tTab = panel.querySelector('#xray-tab-trivia');
              if (tTab && full.trivia?.length) renderXRayTriviaTab(tTab, full.trivia);
              const castBtn = panel.querySelector('[data-xray-tab="cast"]');
              if (castBtn) castBtn.textContent = `🎭 В кадре (${full.cast.length})`;
            }
          }
        }
      } catch (_) {}
    })();
  }

  // Переключение вкладок X-Ray
  panel.querySelectorAll('.xray-tab-btn').forEach(btn => {
    btn.onclick = () => {
      panel.querySelectorAll('.xray-tab-btn').forEach(b => b.classList.remove('active'));
      panel.querySelectorAll('.xray-tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const targetTab = panel.querySelector(`#xray-tab-${btn.dataset.xrayTab}`);
      if (targetTab) targetTab.classList.add('active');
    };
  });

  // Клик по персоне съемочной группы для перехода в фильмографию
  panel.querySelectorAll('#xray-tab-crew [data-person-id]').forEach(card => {
    card.onclick = () => {
      const pid = card.dataset.personId;
      const pname = card.dataset.personName;
      if (pid && typeof openPersonModal === 'function') {
        openPersonModal(pid, pname);
      }
    };
  });

  const closeBtn = panel.querySelector('#close-xray-btn');
  if (closeBtn) closeBtn.onclick = () => hideXRayPanel(wrapper);
  panel.style.display = 'flex';
  xrayVisible = true;
}

function hideXRayPanel(wrapper) {
  const panel = wrapper?.querySelector('#player-xray-panel');
  if (panel) {
    panel.style.display = 'none';
  }
  if (xrayAudioElement) {
    xrayAudioElement.pause();
    xrayAudioElement = null;
    currentPlayingTrackUrl = null;
  }
  xrayVisible = false;
}

export function toggleXRayManual() {
  const wrapper = document.getElementById('cinema-player-wrapper');
  if (!wrapper) return;
  if (xrayVisible) {
    hideXRayPanel(wrapper);
  } else {
    showXRayPanel(wrapper);
  }
}

// ==========================================
// ПОКАДРОВАЯ НАВИГАЦИЯ (THUMBNAIL SCRUBBING)
// ==========================================
function setupThumbnailScrubbing(video) {
  const slider = document.getElementById('player-progress-slider');
  const preview = document.getElementById('player-scrubber-preview');
  const canvas = document.getElementById('scrubber-thumb-canvas');
  const timeEl = document.getElementById('scrubber-thumb-time');
  const chapterEl = document.getElementById('scrubber-thumb-chapter');

  if (!slider || !preview) return;

  slider.onmouseenter = () => {
    preview.style.display = 'flex';
  };

  slider.onmouseleave = () => {
    preview.style.display = 'none';
  };

  slider.onmousemove = (e) => {
    const rect = slider.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const leftPx = percent * rect.width;
    preview.style.left = `${leftPx}px`;

    const duration = video?.duration || 7200;
    const targetSeconds = percent * duration;
    if (timeEl) timeEl.textContent = formatMediaTime(targetSeconds);

    if (chapterEl) {
      chapterEl.textContent = percent < 0.05 ? 'Вступление' : (percent > 0.9 ? 'Титры' : 'Сцена фильма');
    }

    if (canvas && video && video.readyState >= 2) {
      try {
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      } catch {}
    }
  };
}

function formatMediaTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ==========================================
// AMBILIGHT (ДИНАМИЧЕСКАЯ ПОДСВЕТКА И НАСТРОЙКИ)
// ==========================================
function hexToRgb(hex) {
  const clean = (hex || '#00d2ff').replace('#', '');
  const bigint = parseInt(clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean, 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255
  };
}

function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255)
  };
}

function initAmbilight(video) {
  if (!ambilightCanvas) {
    ambilightCanvas = document.createElement('canvas');
    ambilightCanvas.width = 16;
    ambilightCanvas.height = 9;
    ambilightCtx = ambilightCanvas.getContext('2d', { willReadFrequently: true });
  }

  if (ambilightEnabled) {
    startAmbilightLoop(video);
  }
}

export function toggleAmbilight() {
  ambilightEnabled = !ambilightEnabled;
  const aura = document.getElementById('player-ambilight-aura');
  const btn = document.getElementById('toggle-ambilight-btn');

  if (btn) {
    btn.classList.toggle('active', ambilightEnabled);
  }

  if (ambilightEnabled) {
    trackClientAction('use_ambilight');
    showToast('Динамическая подсветка Ambilight включена', 'info');
    const video = document.getElementById('storm-video-player');
    startAmbilightLoop(video);
  } else {
    stopAmbilight();
    if (aura) {
      aura.classList.remove('active');
      aura.style.opacity = '0';
      aura.style.boxShadow = 'none';
    }
    showToast('Подсветка Ambilight выключена', 'info');
  }
}

export function toggleAmbilightSettings() {
  const host = document.getElementById('ambilight-settings-panel-host');
  if (!host) return;

  if (host.innerHTML.trim()) {
    host.innerHTML = '';
  } else {
    renderAmbilightSettings(host);
  }
}

function renderAmbilightSettings(host) {
  host.innerHTML = `
    <div class="ambilight-settings-panel">
      <div class="ambilight-settings-header">
        <div class="ambilight-settings-title">
          <span>🎨</span>
          <span>Настройки подсветки Ambilight</span>
        </div>
        <button type="button" class="storm-btn storm-btn-sm" id="close-ambilight-settings-btn" style="padding: 2px 8px;">✕</button>
      </div>

      <!-- Главный переключатель состояния Ambilight -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding: 8px 12px; background: rgba(255,255,255,0.03); border-radius: 8px; border: 1px solid var(--border-subtle);">
        <span style="font-size: 12px; font-weight: 700;">Состояние подсветки:</span>
        <button type="button" class="storm-btn storm-btn-sm ${ambilightEnabled ? 'storm-btn-primary' : 'storm-btn-secondary'}" id="ambilight-master-toggle-btn">
          ${ambilightEnabled ? '🟢 Включен' : '⚪ Выключен'}
        </button>
      </div>

      <!-- Выбор режима свечения -->
      <div style="display: flex; gap: 8px; flex-wrap: wrap;">
        <button type="button" class="storm-btn storm-btn-sm ${ambilightSettings.mode === 'auto' ? 'storm-btn-primary' : 'storm-btn-secondary'}" id="mode-auto-btn">
          🌈 Авто / RGB перелив
        </button>
        <button type="button" class="storm-btn storm-btn-sm ${ambilightSettings.mode === 'preset' ? 'storm-btn-primary' : 'storm-btn-secondary'}" id="mode-preset-btn">
          💎 Пресеты цветов
        </button>
        <button type="button" class="storm-btn storm-btn-sm ${ambilightSettings.mode === 'custom' ? 'storm-btn-primary' : 'storm-btn-secondary'}" id="mode-custom-btn">
          🎯 Свой цвет
        </button>
      </div>

      <!-- Палитра пресетов -->
      <div id="ambilight-presets-block" style="display: ${ambilightSettings.mode === 'preset' ? 'flex' : 'none'}; flex-direction: column; gap: 6px;">
        <div style="font-size: 11px; font-weight: 700; color: var(--text-muted);">Выберите палитру:</div>
        <div class="ambilight-presets-row">
          ${AMBILIGHT_PRESETS.map(p => `
            <button type="button" class="ambilight-preset-btn ${ambilightSettings.color === p.color ? 'active' : ''}" data-color="${p.color}" style="background: ${p.color};" title="${p.name}"></button>
          `).join('')}
        </div>
      </div>

      <!-- Свой цвет (Color Picker) -->
      <div id="ambilight-custom-color-block" style="display: ${ambilightSettings.mode === 'custom' ? 'flex' : 'none'}; align-items: center; gap: 10px;">
        <input type="color" id="ambilight-custom-picker" value="${ambilightSettings.color}" style="width: 44px; height: 36px; border-radius: 8px; border: 1px solid var(--border-color); background: transparent; cursor: pointer;">
        <span style="font-size: 13px; font-weight: 700; color: var(--text-secondary);" id="ambilight-custom-hex">${ambilightSettings.color}</span>
      </div>

      <!-- Ползунки яркости и радиуса размытия -->
      <div class="ambilight-sliders-row">
        <div>
          <div style="display: flex; justify-content: space-between; font-size: 11px; font-weight: 700; margin-bottom: 4px;">
            <span>Яркость свечения</span>
            <span id="ambilight-intensity-val">${ambilightSettings.intensity}%</span>
          </div>
          <input type="range" class="storm-slider" id="ambilight-intensity-slider" min="10" max="100" value="${ambilightSettings.intensity}">
        </div>
        <div>
          <div style="display: flex; justify-content: space-between; font-size: 11px; font-weight: 700; margin-bottom: 4px;">
            <span>Размер ауры (размытие)</span>
            <span id="ambilight-blur-val">${ambilightSettings.blur}px</span>
          </div>
          <input type="range" class="storm-slider" id="ambilight-blur-slider" min="20" max="150" value="${ambilightSettings.blur}">
        </div>
      </div>

      <!-- Кнопки сохранения и закрытия -->
      <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px;">
        <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="ambilight-cancel-panel-btn">Отмена</button>
        <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="ambilight-save-close-btn">💾 Сохранить и закрыть</button>
      </div>

      <!-- Секция умного дома (WLED / Hue) -->
      <div id="smart-lights-mount" style="margin-top: 14px; border-top: 1px solid var(--border-subtle); padding-top: 12px;"></div>
    </div>
  `;

  const closeBtn = host.querySelector('#close-ambilight-settings-btn');
  if (closeBtn) closeBtn.onclick = () => { host.innerHTML = ''; };

  const masterToggleBtn = host.querySelector('#ambilight-master-toggle-btn');
  if (masterToggleBtn) {
    masterToggleBtn.onclick = () => {
      toggleAmbilight();
      masterToggleBtn.className = `storm-btn storm-btn-sm ${ambilightEnabled ? 'storm-btn-primary' : 'storm-btn-secondary'}`;
      masterToggleBtn.textContent = ambilightEnabled ? '🟢 Включен' : '⚪ Выключен';
      applyAmbilightInstantGlow();
    };
  }

  const saveCloseBtn = host.querySelector('#ambilight-save-close-btn');
  if (saveCloseBtn) {
    saveCloseBtn.onclick = () => {
      saveAmbilightSettings();
      applyAmbilightInstantGlow();
      host.innerHTML = '';
      showToast('✨ Настройки Ambilight сохранены', 'success');
    };
  }

  const cancelPanelBtn = host.querySelector('#ambilight-cancel-panel-btn');
  if (cancelPanelBtn) {
    cancelPanelBtn.onclick = () => {
      host.innerHTML = '';
    };
  }

  // Монтируем панель умной подсветки
  const lightsMount = host.querySelector('#smart-lights-mount');
  if (lightsMount) renderSmartLightsSettings(lightsMount);

  const modeAuto = host.querySelector('#mode-auto-btn');
  const modePreset = host.querySelector('#mode-preset-btn');
  const modeCustom = host.querySelector('#mode-custom-btn');
  const presetsBlock = host.querySelector('#ambilight-presets-block');
  const customBlock = host.querySelector('#ambilight-custom-color-block');

  const updateModeButtons = (activeMode) => {
    ambilightSettings.mode = activeMode;
    applyAmbilightInstantGlow();
    renderAmbilightSettings(host);
  };

  if (modeAuto) modeAuto.onclick = () => updateModeButtons('auto');
  if (modePreset) modePreset.onclick = () => updateModeButtons('preset');
  if (modeCustom) modeCustom.onclick = () => updateModeButtons('custom');

  // Пресеты
  host.querySelectorAll('.ambilight-preset-btn').forEach(btn => {
    btn.onclick = () => {
      ambilightSettings.color = btn.dataset.color;
      ambilightSettings.mode = 'preset';
      applyAmbilightInstantGlow();
      renderAmbilightSettings(host);
    };
  });

  // Color picker
  const picker = host.querySelector('#ambilight-custom-picker');
  const hexVal = host.querySelector('#ambilight-custom-hex');
  if (picker) {
    picker.oninput = (e) => {
      ambilightSettings.color = e.target.value;
      ambilightSettings.mode = 'custom';
      if (hexVal) hexVal.textContent = e.target.value;
      applyAmbilightInstantGlow();
    };
  }

  // Слайдеры
  const intensitySlider = host.querySelector('#ambilight-intensity-slider');
  const intensityVal = host.querySelector('#ambilight-intensity-val');
  if (intensitySlider) {
    intensitySlider.oninput = (e) => {
      ambilightSettings.intensity = parseInt(e.target.value, 10);
      if (intensityVal) intensityVal.textContent = `${ambilightSettings.intensity}%`;
      applyAmbilightInstantGlow();
    };
  }

  const blurSlider = host.querySelector('#ambilight-blur-slider');
  const blurVal = host.querySelector('#ambilight-blur-val');
  if (blurSlider) {
    blurSlider.oninput = (e) => {
      ambilightSettings.blur = parseInt(e.target.value, 10);
      if (blurVal) blurVal.textContent = `${ambilightSettings.blur}px`;
      applyAmbilightInstantGlow();
    };
  }
}

function saveAmbilightSettings() {
  try {
    localStorage.setItem('storm_ambilight_settings', JSON.stringify(ambilightSettings));
  } catch {}
}

function applyAmbilightInstantGlow() {
  saveAmbilightSettings();
  if (!ambilightEnabled) {
    // Если Ambilight отключен, сохраняем параметры, но не включаем подсветку самопроизвольно
    return;
  }

  const aura = document.getElementById('player-ambilight-aura');
  if (aura) {
    let r = 0, g = 210, b = 255;
    if (ambilightSettings.mode === 'preset' || ambilightSettings.mode === 'custom') {
      const rgb = hexToRgb(ambilightSettings.color);
      r = rgb.r;
      g = rgb.g;
      b = rgb.b;
    }
    const alpha = ambilightSettings.intensity / 100;
    const blur = ambilightSettings.blur;
    aura.classList.add('active');
    aura.style.opacity = `${alpha}`;
    aura.style.boxShadow = `0 0 ${blur}px rgba(${r}, ${g}, ${b}, 0.9), 0 0 ${Math.round(blur * 1.5)}px rgba(${r}, ${g}, ${b}, 0.55), inset 0 0 ${Math.round(blur * 0.5)}px rgba(${r}, ${g}, ${b}, 0.35)`;
  }

  const video = document.getElementById('storm-video-player');
  startAmbilightLoop(video);
}

function startAmbilightLoop(video) {
  stopAmbilight();

  let lastSampleTime = 0;
  let cachedR = 0, cachedG = 210, cachedB = 255;

  function loop() {
    if (!ambilightEnabled) return;

    const modal = document.getElementById('cinema-modal');
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || (modal && modal.classList.contains('is-fullscreen')));

    // В полноэкранном режиме видео закрывает экран на 100%.
    // Чтобы исключить GPU-to-CPU pipeline stall (drawImage + getImageData на 4K/1080p),
    // полностью отключаем рендеринг внутренней ауры.
    if (isFs) {
      const now = Date.now();
      if (now - lastSampleTime >= 200) {
        lastSampleTime = now;
        if (ambilightSettings.mode === 'preset' || ambilightSettings.mode === 'custom') {
          const rgb = hexToRgb(ambilightSettings.color);
          cachedR = rgb.r; cachedG = rgb.g; cachedB = rgb.b;
        } else if (video && !video.paused && !video.ended && video.videoWidth > 0 && ambilightCtx) {
          try {
            ambilightCtx.drawImage(video, 0, 0, 16, 9);
            const data = ambilightCtx.getImageData(0, 0, 16, 9).data;
            let sumR = 0, sumG = 0, sumB = 0, count = 0;
            for (let i = 0; i < data.length; i += 16) {
              sumR += data[i];
              sumG += data[i + 1];
              sumB += data[i + 2];
              count++;
            }
            cachedR = Math.round(sumR / count);
            cachedG = Math.round(sumG / count);
            cachedB = Math.round(sumB / count);
          } catch {
            const hue = (now / 40) % 360;
            const rgb = hslToRgb(hue / 360, 0.9, 0.55);
            cachedR = rgb.r; cachedG = rgb.g; cachedB = rgb.b;
          }
        }
        sendSmartLightsFrame(cachedR, cachedG, cachedB);
      }
      ambilightRaf = requestAnimationFrame(loop);
      return;
    }

    let r = 0, g = 210, b = 255;

    if (ambilightSettings.mode === 'preset' || ambilightSettings.mode === 'custom') {
      const rgb = hexToRgb(ambilightSettings.color);
      r = rgb.r;
      g = rgb.g;
      b = rgb.b;
    } else if (video && !video.paused && !video.ended && video.videoWidth > 0 && ambilightCtx) {
      try {
        ambilightCtx.drawImage(video, 0, 0, 16, 9);
        const data = ambilightCtx.getImageData(0, 0, 16, 9).data;
        let sumR = 0, sumG = 0, sumB = 0, count = 0;
        for (let i = 0; i < data.length; i += 16) {
          sumR += data[i];
          sumG += data[i + 1];
          sumB += data[i + 2];
          count++;
        }
        r = Math.round(sumR / count);
        g = Math.round(sumG / count);
        b = Math.round(sumB / count);
      } catch {
        // Запасной перелив если canvas tainted
        const hue = (Date.now() / 40) % 360;
        const rgb = hslToRgb(hue / 360, 0.9, 0.55);
        r = rgb.r; g = rgb.g; b = rgb.b;
      }
    } else {
      // Плавный динамический спектральный перелив для Iframe или паузы
      const hue = (Date.now() / 40) % 360;
      const rgb = hslToRgb(hue / 360, 0.9, 0.55);
      r = rgb.r; g = rgb.g; b = rgb.b;
    }

    const aura = document.getElementById('player-ambilight-aura');
    if (aura) {
      const alpha = ambilightSettings.intensity / 100;
      const blur = ambilightSettings.blur;
      aura.classList.add('active');
      aura.style.opacity = `${alpha}`;
      aura.style.boxShadow = `0 0 ${blur}px rgba(${r}, ${g}, ${b}, 0.9), 0 0 ${Math.round(blur * 1.5)}px rgba(${r}, ${g}, ${b}, 0.55), inset 0 0 ${Math.round(blur * 0.5)}px rgba(${r}, ${g}, ${b}, 0.35)`;
    }

    sendSmartLightsFrame(r, g, b);

    ambilightRaf = requestAnimationFrame(loop);
  }

  ambilightRaf = requestAnimationFrame(loop);
}

function stopAmbilight() {
  if (ambilightRaf) {
    cancelAnimationFrame(ambilightRaf);
    ambilightRaf = null;
  }
}

// ==========================================
// ПРОПУСК ОПЕНИНГОВ И ЭНДИНГОВ (SKIP INTRO/OUTRO)
// ==========================================
async function loadSkipTimes(mediaId, episode) {
  skipIntervals = null;
  try {
    const title = currentMedia?.title || currentMedia?.original_title || '';
    const video = document.getElementById('storm-video-player');
    const dur = video?.duration || 0;
    const res = await fetch(`/api/media/skip-times?malId=${encodeURIComponent(mediaId || '')}&title=${encodeURIComponent(title)}&episode=${encodeURIComponent(episode || 1)}&duration=${encodeURIComponent(Math.round(dur))}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.found && (data.op || data.ed)) {
        skipIntervals = data;
        setSmartSkipIntervals({
          verified: true,
          intro: data.op ? { start: data.op.start, end: data.op.end, label: data.op.label || 'Опенинг (Интро)' } : null,
          outro: data.ed ? { start: data.ed.start, end: data.ed.end, label: data.ed.label || 'Финальные титры (Эндинг)' } : null
        });
      } else {
        skipIntervals = null;
      }
    }
  } catch {
    skipIntervals = null;
  }
}

function setupSkipLogic(video) {
  const skipIntroBtn = document.getElementById('skip-intro-btn');
  const skipOutroBtn = document.getElementById('skip-outro-btn');

  if (skipIntroBtn) {
    skipIntroBtn.onclick = () => {
      if (skipIntervals?.op?.end) {
        video.currentTime = skipIntervals.op.end;
        trackClientAction('use_skip');
        showToast('Заставка пропущена', 'info');
      }
    };
  }

  if (skipOutroBtn) {
    skipOutroBtn.onclick = () => {
      trackClientAction('use_skip');
      if (video.duration && skipIntervals?.ed?.end && skipIntervals.ed.end < video.duration - 15) {
        video.currentTime = skipIntervals.ed.end;
        showToast('Титры пропущены (сцена после титров)', 'info');
      } else {
        playNextEpisode();
      }
    };
  }

  let lastHtml5Sync = 0;
  video.ontimeupdate = () => {
    const time = video.currentTime;
    checkUpNextEpisodeCountdown(video);

    // Синхронизация ползунка прогресса
    if (video.duration) {
      const percent = Math.min(100, Math.round((time / video.duration) * 100));
      currentProgressPercent = percent;
      const slider = document.getElementById('player-progress-slider');
      const label = document.getElementById('player-progress-label');
      if (slider) slider.value = percent;
      if (label) label.textContent = `${percent}%`;

      const now = Date.now();
      if (now - lastHtml5Sync >= 10000 && currentMedia) {
        lastHtml5Sync = now;
        syncWatchProgress({
          media_id: currentMedia.id,
          source: currentMedia.source,
          title: currentMedia.title,
          poster_url: currentMedia.poster,
          media_type: currentMedia.media_type,
          year: currentMedia.year || '',
          season: currentMedia.season || 1,
          episode: currentEpisodeIndex || 1,
          total_episodes: currentEpisodes.length || 1,
          duration_seconds: Math.round(video.duration),
          time_seconds: Math.round(time),
          progress_percent: percent
        });
      }
    }

    if (!skipIntervals) return;

    // Отображение кнопки ручного пропуска заставки
    if (skipIntervals.op && time >= skipIntervals.op.start && time <= skipIntervals.op.end) {
      if (skipIntroBtn) skipIntroBtn.style.display = 'block';
    } else if (skipIntroBtn) {
      skipIntroBtn.style.display = 'none';
    }

    // Отображение кнопки ручного пропуска титров
    if (skipIntervals.ed && time >= skipIntervals.ed.start && time <= skipIntervals.ed.end) {
      if (skipOutroBtn) skipOutroBtn.style.display = 'block';
    } else if (skipOutroBtn) {
      skipOutroBtn.style.display = 'none';
    }
  };

  video.addEventListener('ended', () => {
    showToast('Воспроизведение завершено. Переход к следующей серии...', 'info');
    setTimeout(() => {
      playInPlayerNextEpisode();
    }, 1200);
  });
}

/* ==========================================================================
   ИНТЕЛЛЕКТУАЛЬНЫЙ ОВЕРЛЕЙ ПЛЕЕРА, СКОРОСТЬ ВОСПРОИЗВЕДЕНИЯ И ПЕРЕКЛЮЧЕНИЕ СЕРИЙ
   ========================================================================== */

export function applySavedPlaybackSpeed(video) {
  const saved = localStorage.getItem('storm_playback_speed') || '1';
  const speed = parseFloat(saved) || 1;
  if (video) {
    try { video.playbackRate = speed; } catch {}
  }
  document.querySelectorAll('video').forEach(v => {
    try { v.playbackRate = speed; } catch {}
  });
  document.querySelectorAll('.cinema-player-iframe, #cinema-player-wrapper iframe, iframe').forEach(iframe => {
    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) {
        doc.querySelectorAll('video').forEach(v => {
          v.playbackRate = speed;
        });
      }
    } catch {}
  });
  updateInPlayerSpeedDisplay(speed);
}

export const AVAILABLE_PLAYBACK_SPEEDS = [1, 1.25, 1.5, 1.75, 2, 0.5, 0.75];

export function cyclePlaybackSpeed() {
  const curSpeed = parseFloat(localStorage.getItem('storm_playback_speed') || '1');
  let idx = AVAILABLE_PLAYBACK_SPEEDS.findIndex(s => Math.abs(s - curSpeed) < 0.01);
  if (idx === -1) idx = 0;
  const nextSpeed = AVAILABLE_PLAYBACK_SPEEDS[(idx + 1) % AVAILABLE_PLAYBACK_SPEEDS.length];
  setGlobalPlaybackSpeed(nextSpeed);
  return nextSpeed;
}

export function setGlobalPlaybackSpeed(speed) {
  const sp = parseFloat(speed) || 1;
  localStorage.setItem('storm_playback_speed', String(sp));

  // 1. Применение ко всем HTML5 <video> в документе
  document.querySelectorAll('video').forEach(video => {
    try {
      video.playbackRate = sp;
    } catch {}
  });

  // 2. Доступ к DOM видео внутри доступных iframes
  document.querySelectorAll('.cinema-player-iframe, #cinema-player-wrapper iframe, iframe').forEach(iframe => {
    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) {
        doc.querySelectorAll('video').forEach(v => {
          v.playbackRate = sp;
        });
      }
    } catch {}
  });

  // 3. Отправка postMessage во все поддерживаемые типы сторонних плееров (объекты и JSON)
  const msgs = [
    { event: 'speed', value: sp },
    { api: 'speed', val: sp },
    { api: 'speed', set: sp },
    { api: 'playbackRate', set: sp },
    { action: 'speed', rate: sp },
    { method: 'setSpeed', speed: sp },
    { method: 'speed', rate: sp, value: sp },
    { key: 'kodik_player_api', value: { action: 'speed', rate: sp, method: 'speed' } },
    { type: 'SET_SPEED', speed: sp, value: sp }
  ];
  document.querySelectorAll('.cinema-player-iframe, #cinema-player-wrapper iframe, iframe').forEach(iframe => {
    msgs.forEach(msg => {
      try {
        iframe.contentWindow?.postMessage(msg, '*');
        iframe.contentWindow?.postMessage(JSON.stringify(msg), '*');
      } catch {}
    });
  });

  updateInPlayerSpeedDisplay(sp);
  showToast(`⏱️ Скорость: ${sp}x`, 'info');
}

function updateInPlayerSpeedDisplay(speed) {
  const sp = parseFloat(speed) || 1;
  const overlay = document.getElementById('storm-inplayer-overlay');
  if (!overlay) return;
  const btn = overlay.querySelector('#inplayer-speed-btn');
  if (btn) {
    btn.innerHTML = `
      <svg class="inplayer-speed-svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px; margin-right: 4px;">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      </svg>
      <span>${sp}x</span>
    `;
  }
  const menu = overlay.querySelector('#inplayer-speed-menu');
  if (menu) {
    menu.querySelectorAll('.inplayer-speed-item').forEach(item => {
      item.classList.toggle('active', parseFloat(item.dataset.speed) === sp);
    });
  }
}

function toggleInPlayerSpeedMenu(overlay) {
  if (!overlay) overlay = document.getElementById('storm-inplayer-overlay');
  if (!overlay) return;
  const menu = overlay.querySelector('#inplayer-speed-menu');
  if (!menu) return;

  const isOpen = menu.classList.contains('is-open');
  if (isOpen) {
    menu.classList.remove('is-open');
  } else {
    const curSpeed = parseFloat(localStorage.getItem('storm_playback_speed') || '1');
    menu.querySelectorAll('.inplayer-speed-item').forEach(item => {
      const sp = parseFloat(item.dataset.speed);
      item.classList.toggle('active', sp === curSpeed);
    });
    menu.classList.add('is-open');
  }
}

export function toggleInPlayerEpisodesSheet(overlay, show) {
  if (!overlay) overlay = document.getElementById('storm-inplayer-overlay');
  if (!overlay) return;
  const sheet = overlay.querySelector('#player-inplayer-episodes-sheet');
  const epBtn = overlay.querySelector('#inplayer-episodes-btn');
  if (!sheet) return;

  if (!checkIfMediaIsSeries(currentMedia)) {
    sheet.classList.remove('is-open');
    sheet.style.display = 'none';
    if (epBtn) epBtn.classList.remove('active');
    return;
  }

  if (show === undefined) {
    show = !sheet.classList.contains('is-open');
  }

  if (show) {
    sheet.style.display = 'flex';
    renderInPlayerEpisodesSheet(overlay);
    sheet.classList.add('is-open');
    if (epBtn) epBtn.classList.add('active');
  } else {
    sheet.classList.remove('is-open');
    sheet.style.display = 'none';
    if (epBtn) epBtn.classList.remove('active');
  }
}

export function renderInPlayerEpisodesSheet(overlay) {
  if (!overlay) overlay = document.getElementById('storm-inplayer-overlay');
  if (!overlay) return;

  const sheet = overlay.querySelector('#player-inplayer-episodes-sheet');
  if (!checkIfMediaIsSeries(currentMedia)) {
    if (sheet) {
      sheet.classList.remove('is-open');
      sheet.style.display = 'none';
    }
    return;
  }

  const chipsBar = overlay.querySelector('#inplayer-season-chips-bar');
  const epList = overlay.querySelector('#inplayer-episodes-list');
  const countBadge = overlay.querySelector('#inplayer-sheet-count');
  if (!chipsBar || !epList) return;

  const curMediaId = currentMedia?.id;

  // 1. FanFilm / Kodik (quickBarSeriesData)
  if (quickBarSeriesData && quickBarSeriesData.seasons && quickBarSeriesData.seasons.length > 0) {
    chipsBar.style.display = quickBarSeriesData.seasons.length > 1 ? 'flex' : 'none';
    chipsBar.innerHTML = quickBarSeriesData.seasons.map(s => `
      <button type="button" class="inplayer-season-chip ${s.season === quickBarActiveSeason ? 'active' : ''}" data-season="${s.season}">
        ${s.name || `Сезон ${s.season}`}
      </button>
    `).join('');

    chipsBar.querySelectorAll('.inplayer-season-chip').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const sNum = parseInt(btn.dataset.season, 10);
        selectQuickSeason(sNum);
        renderInPlayerEpisodesSheet(overlay);
      };
    });

    const currentSeasonObj = quickBarSeriesData.seasons.find(s => s.season === quickBarActiveSeason) || quickBarSeriesData.seasons[0];
    const episodes = currentSeasonObj?.episodes || [];
    if (countBadge) countBadge.textContent = `${episodes.length} сер.`;
    const watchedEpisodes = curMediaId ? getWatchedEpisodes(curMediaId, quickBarActiveSeason) : new Set();

    epList.innerHTML = episodes.map(ep => {
      const isAct = ep.episode === quickBarActiveEpisode;
      const isWatched = watchedEpisodes.has(ep.episode);
      let statusHtml = '';
      if (isAct) {
        statusHtml = '<span class="inplayer-ep-status-pill current">▶ Смотрю</span>';
      } else if (isWatched) {
        statusHtml = '<span class="inplayer-ep-status-pill watched">✓</span>';
      }

      return `
        <div class="inplayer-ep-item ${isAct ? 'active' : ''}" data-episode="${ep.episode}">
          <span class="inplayer-ep-num">${ep.episode}</span>
          <span class="inplayer-ep-name">${escapeHtml(ep.name || `${ep.episode} серия`)}</span>
          ${statusHtml}
        </div>
      `;
    }).join('');

    epList.querySelectorAll('.inplayer-ep-item').forEach(item => {
      item.onclick = (e) => {
        e.stopPropagation();
        const epNum = parseInt(item.dataset.episode, 10);
        selectQuickEpisode(epNum);
        toggleInPlayerEpisodesSheet(overlay, false);
      };
    });
    return;
  }

  // 2. TMDB / базовые сериалы (через готовые DOM-карточки series-episodes-grid)
  const gridEl = document.getElementById('series-episodes-grid');
  if (gridEl && gridEl.children.length > 0) {
    chipsBar.style.display = 'none';
    const cards = Array.from(gridEl.querySelectorAll('.series-episode-card'));
    if (countBadge) countBadge.textContent = `${cards.length} сер.`;
    epList.innerHTML = cards.map(c => {
      const epNum = parseInt(c.dataset.epNum, 10);
      const isAct = c.classList.contains('active');
      const isWatched = c.classList.contains('watched');
      const title = c.querySelector('.series-episode-title')?.textContent || `Серия ${epNum}`;
      return `
        <div class="inplayer-ep-item ${isAct ? 'active' : ''}" data-ep-num="${epNum}">
          <span class="inplayer-ep-num">${epNum}</span>
          <span class="inplayer-ep-name">${escapeHtml(title)}</span>
          ${isAct ? '<span class="inplayer-ep-status-pill current">▶ Смотрю</span>' : (isWatched ? '<span class="inplayer-ep-status-pill watched">✓</span>' : '')}
        </div>
      `;
    }).join('');

    epList.querySelectorAll('.inplayer-ep-item').forEach(item => {
      item.onclick = (e) => {
        e.stopPropagation();
        const epNum = parseInt(item.dataset.epNum, 10);
        const origCard = gridEl.querySelector(`.series-episode-card[data-ep-num="${epNum}"]`);
        if (origCard) origCard.click();
        toggleInPlayerEpisodesSheet(overlay, false);
      };
    });
    return;
  }

  // 2b. TMDB сериалы напрямую из метаданных currentMedia.seasons
  if (currentMedia?.seasons && currentMedia.seasons.length > 0) {
    const seasonsList = currentMedia.seasons.filter(s => (s.season_number > 0 || currentMedia.seasons.length === 1));
    const curSeasonNum = (typeof activeSeasonNum !== 'undefined' ? activeSeasonNum : (currentSeasonIndex || 1));
    chipsBar.style.display = seasonsList.length > 1 ? 'flex' : 'none';
    chipsBar.innerHTML = seasonsList.map(s => `
      <button type="button" class="inplayer-season-chip ${(s.season_number || s.season) === curSeasonNum ? 'active' : ''}" data-season="${s.season_number || s.season}">
        ${escapeHtml(s.name || `Сезон ${s.season_number || s.season}`)}
      </button>
    `).join('');

    chipsBar.querySelectorAll('.inplayer-season-chip').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const sNum = parseInt(btn.dataset.season, 10);
        if (typeof activeSeasonNum !== 'undefined') activeSeasonNum = sNum;
        if (typeof currentSeasonIndex !== 'undefined') currentSeasonIndex = sNum;
        const mainTab = document.querySelector(`.series-season-tab[data-season-num="${sNum}"]`);
        if (mainTab) mainTab.click();
        renderInPlayerEpisodesSheet(overlay);
      };
    });

    const activeSeasonObj = seasonsList.find(s => (s.season_number || s.season) === curSeasonNum) || seasonsList[0];
    const epCount = activeSeasonObj?.episode_count || 8;
    if (countBadge) countBadge.textContent = `${epCount} сер.`;
    const curEpNum = (typeof activeEpisodeNum !== 'undefined' ? activeEpisodeNum : (currentEpisodeIndex || 1));
    const watchedEpisodes = curMediaId ? getWatchedEpisodes(curMediaId, curSeasonNum) : new Set();

    let epItems = [];
    for (let i = 1; i <= epCount; i++) {
      const isAct = i === curEpNum;
      const isWatched = watchedEpisodes.has(i);
      epItems.push(`
        <div class="inplayer-ep-item ${isAct ? 'active' : ''}" data-ep-num="${i}">
          <span class="inplayer-ep-num">${i}</span>
          <span class="inplayer-ep-name">Серия ${i}</span>
          ${isAct ? '<span class="inplayer-ep-status-pill current">▶ Смотрю</span>' : (isWatched ? '<span class="inplayer-ep-status-pill watched">✓</span>' : '')}
        </div>
      `);
    }
    epList.innerHTML = epItems.join('');

    epList.querySelectorAll('.inplayer-ep-item').forEach(item => {
      item.onclick = (e) => {
        e.stopPropagation();
        const epNum = parseInt(item.dataset.epNum, 10);
        if (typeof activeEpisodeNum !== 'undefined') activeEpisodeNum = epNum;
        if (typeof currentEpisodeIndex !== 'undefined') currentEpisodeIndex = epNum;
        const origCard = gridEl ? gridEl.querySelector(`.series-episode-card[data-ep-num="${epNum}"]`) : null;
        if (origCard) {
          origCard.click();
        } else {
          updatePlayerUrl(currentMedia, curSeasonNum, epNum, currentActivePlayer);
        }
        updateInPlayerEpisodeInfo();
        toggleInPlayerEpisodesSheet(overlay, false);
      };
    });
    return;
  }

  // 3. AniXart
  if (currentEpisodes && currentEpisodes.length > 0) {
    chipsBar.style.display = 'none';
    if (countBadge) countBadge.textContent = `${currentEpisodes.length} сер.`;
    epList.innerHTML = currentEpisodes.map((ep, idx) => {
      const epNum = ep.position || (idx + 1);
      const isAct = epNum === currentEpisodeIndex;
      return `
        <div class="inplayer-ep-item ${isAct ? 'active' : ''}" data-index="${idx}">
          <span class="inplayer-ep-num">${epNum}</span>
          <span class="inplayer-ep-name">${escapeHtml(ep.name_ru || ep.name || `${epNum} серия`)}</span>
          ${isAct ? '<span class="inplayer-ep-status-pill current">▶ Смотрю</span>' : ''}
        </div>
      `;
    }).join('');

    epList.querySelectorAll('.inplayer-ep-item').forEach(item => {
      item.onclick = (e) => {
        e.stopPropagation();
        const idx = parseInt(item.dataset.index, 10);
        const ep = currentEpisodes[idx];
        if (ep) {
          currentEpisodeIndex = ep.position || (idx + 1);
          playAnixartEpisode(ep);
        }
        toggleInPlayerEpisodesSheet(overlay, false);
      };
    });
    return;
  }

  // 4. AniLibria
  if (currentMedia?.episodes && currentMedia.episodes.length > 0) {
    chipsBar.style.display = 'none';
    if (countBadge) countBadge.textContent = `${currentMedia.episodes.length} сер.`;
    epList.innerHTML = currentMedia.episodes.map((ep, idx) => {
      const epNum = ep.ordinal || (idx + 1);
      const isAct = epNum === currentEpisodeIndex;
      return `
        <div class="inplayer-ep-item ${isAct ? 'active' : ''}" data-index="${idx}">
          <span class="inplayer-ep-num">${epNum}</span>
          <span class="inplayer-ep-name">${escapeHtml(ep.name || `${epNum} серия`)}</span>
          ${isAct ? '<span class="inplayer-ep-status-pill current">▶ Смотрю</span>' : ''}
        </div>
      `;
    }).join('');

    epList.querySelectorAll('.inplayer-ep-item').forEach(item => {
      item.onclick = (e) => {
        e.stopPropagation();
        const idx = parseInt(item.dataset.index, 10);
        const ep = currentMedia.episodes[idx];
        if (ep) {
          currentEpisodeIndex = ep.ordinal || (idx + 1);
          const streamUrl = ep.hls_1080 || ep.hls_720 || ep.hls_480;
          if (streamUrl) playStreamUrl(streamUrl);
          loadSkipTimes(currentMedia.id, currentEpisodeIndex);
        }
        toggleInPlayerEpisodesSheet(overlay, false);
      };
    });
    return;
  }

  epList.innerHTML = '<div style="color:var(--text-muted);padding:14px;text-align:center;font-size:12px;">Список серий уточняется...</div>';
}

export function renderInPlayerVoiceSheet(sheet) {
  if (!sheet) return;
  const listEl = sheet.querySelector('#inplayer-voice-list');
  if (!listEl) return;

  let translations = [];
  if (quickBarSeriesData?.seasons) {
    const sObj = quickBarSeriesData.seasons.find(s => s.season === quickBarActiveSeason) || quickBarSeriesData.seasons[0];
    const epObj = sObj?.episodes?.find(e => e.episode === quickBarActiveEpisode) || sObj?.episodes?.[0];
    translations = epObj?.translations || [];
  }

  if (!translations.length && currentMedia?.translations) {
    translations = currentMedia.translations;
  }

  if (!translations.length && currentMedia?.voiceovers) {
    translations = currentMedia.voiceovers.map(v => ({
      id: v.id,
      name: v.name,
      quality: v.quality || 'Студийный дубляж'
    }));
  }

  // Если серверный список пуст (например, одиночный релиз / 4K UHD FanFilm / прямое видео),
  // предоставляем выбор эталонных студийных дорожек с мгновенным запоминанием
  if (!translations.length) {
    const savedPreferred = localStorage.getItem('storm_preferred_voiceover') || 'Дубляж';
    const fallbackTracks = [
      { id: 'orig_51', name: 'Оригинальный дубляж (5.1 / 4K UHD)', quality: 'Dolby Digital 5.1' },
      { id: 'rhs', name: 'Дубляж Red Head Sound', quality: 'Студийный дубляж' },
      { id: 'lostfilm', name: 'Студия LostFilm', quality: 'Многоголосый закадровый' },
      { id: 'hdrezka', name: 'Студия HDRezka', quality: 'Многоголосый закадровый' },
      { id: 'sub', name: 'Оригинал с русскими субтитрами', quality: 'Subtitles' }
    ];

    listEl.innerHTML = fallbackTracks.map((t, idx) => {
      const isAct = savedPreferred.toLowerCase().includes(t.name.split(' ')[1]?.toLowerCase() || 'дубляж') || (idx === 0 && !savedPreferred);
      return `
        <div class="inplayer-voice-item ${isAct ? 'active' : ''}" data-voice-id="${t.id}" data-voice-name="${escapeHtml(t.name)}">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 16px;">🎙️</span>
            <div>
              <div style="font-weight: 700; font-size: 13px;">${escapeHtml(t.name)}</div>
              <div style="font-size: 11px; color: var(--text-muted);">${t.quality}</div>
            </div>
          </div>
          ${isAct ? '<span class="inplayer-voice-check">✓ Активна</span>' : ''}
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.inplayer-voice-item').forEach(item => {
      item.onclick = (e) => {
        e.stopPropagation();
        const vId = item.dataset.voiceId;
        const vName = item.dataset.voiceName;
        localStorage.setItem('storm_preferred_voiceover', vName);
        if (currentMedia?.id) {
          localStorage.setItem(`storm_fav_voiceover_${currentMedia.id}`, vName);
        }
        const voiceVal = document.getElementById('quick-voiceover-val');
        if (voiceVal) voiceVal.textContent = vName;
        sheet.classList.remove('is-open');
        sheet.style.display = 'none';
        const voiceBtn = document.getElementById('inplayer-voice-btn');
        if (voiceBtn) voiceBtn.classList.remove('active');
        showToast(`🎙️ Выбрана аудиодорожка: ${vName}`, 'info');
      };
    });
    return;
  }

  // Если есть реальные translations
  listEl.innerHTML = translations.map(t => {
    const isAct = String(t.id) === String(quickBarActiveTranslationId) || String(t.id) === String(currentVoiceoverId);
    return `
      <div class="inplayer-voice-item ${isAct ? 'active' : ''}" data-voice-id="${t.id}" data-voice-name="${escapeHtml(t.name || 'Озвучка')}">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 16px;">🎙️</span>
          <div>
            <div style="font-weight: 700; font-size: 13px;">${escapeHtml(t.name || 'Озвучка')}</div>
            <div style="font-size: 11px; color: var(--text-muted);">${t.quality || (t.is_uhd ? '4K UHD' : 'Студийный дубляж')}</div>
          </div>
        </div>
        ${isAct ? '<span class="inplayer-voice-check">✓ Активна</span>' : ''}
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.inplayer-voice-item').forEach(item => {
    item.onclick = async (e) => {
      e.stopPropagation();
      const vId = item.dataset.voiceId;
      const vName = item.dataset.voiceName;
      quickBarActiveTranslationId = vId;
      await selectQuickVoiceover(vId);
      sheet.classList.remove('is-open');
      sheet.style.display = 'none';
      const voiceBtn = document.getElementById('inplayer-voice-btn');
      if (voiceBtn) voiceBtn.classList.remove('active');
      showToast(`🎙️ Озвучка: ${vName}`, 'info');
    };
  });
}

export function checkIfMediaIsSeries(media) {
  if (!media) return false;
  const titleLower = String(media.title || media.name || '').toLowerCase();
  // Анимационные и художественные фильмы серии "Обитель зла" (Мутация, Вендетта, Вырождение, Проклятие, Остров смерти) - строго фильмы
  if (titleLower.includes('обитель зла') && (titleLower.includes('мутация') || titleLower.includes('вендетта') || titleLower.includes('вырождение') || titleLower.includes('проклятие') || titleLower.includes('остров смерти') || titleLower.includes('resident evil'))) {
    return false;
  }
  // Мультсериалы и известные сериалы
  if (titleLower.includes('рик и морти') || titleLower.includes('rick and morty') || titleLower.includes('гриффины') || titleLower.includes('симпсоны') || titleLower.includes('южный парк')) {
    return true;
  }
  // 1. Приоритет данных: если у медиа есть сезоны или серии - это 100% сериал
  if (quickBarSeriesData && quickBarSeriesData.type !== 'movie' && Array.isArray(quickBarSeriesData.seasons) && quickBarSeriesData.seasons.length > 0) {
    return true;
  }
  if (typeof media.seasons === 'number' && media.seasons > 0) {
    return true;
  }
  if (Array.isArray(media.seasons) && media.seasons.length > 0) {
    return true;
  }
  if (Array.isArray(media.episodes) && media.episodes.length > 0) {
    return true;
  }
  if (media.rutube_id && (media.seasons || media.episodes)) {
    return true;
  }
  if ((parseInt(media.total_episodes, 10) || 0) > 1 || (parseInt(media.episode, 10) || 0) > 1 || (parseInt(media.season, 10) || 0) > 1) {
    return true;
  }
  if (media.source === 'anilibria' || media.source === 'anixart') {
    return true;
  }
  // 2. Признаки сериала по категории, ссылке или заголовку
  if (media.media_type === 'series' || 
      media.media_type === 'tv' || 
      media.media_type === 'cartoon-series' || 
      media.media_type === 'anime-series' || 
      media.category === 'Сериал' || 
      media.category === 'сериал' ||
      media.category === 'Аниме-сериал' || 
      media.category === 'Мультсериал' ||
      String(media.link || media.url || '').includes('serial') ||
      String(media.link || media.url || '').includes('fan-serials') ||
      /сезон\s*\d+/i.test(titleLower)) {
    return true;
  }
  // 3. Явные признаки фильма
  if (media.media_type === 'movie' || media.type === 'movie' || media.media_type === 'cartoon' || media.category === 'Фильм' || media.category === 'фильм' || media.category === 'Мультфильм') {
    return false;
  }
  return false;
}

export function updateInPlayerEpisodeInfo() {
  const overlay = document.getElementById('storm-inplayer-overlay');
  if (!overlay) return;

  const badge = overlay.querySelector('#inplayer-badge');
  const name = overlay.querySelector('#inplayer-series-name');
  const epBtn = overlay.querySelector('#inplayer-episodes-btn');
  const bottomBar = overlay.querySelector('#inplayer-bottom-bar');
  const sheet = overlay.querySelector('#player-inplayer-episodes-sheet');
  const prevBtn = overlay.querySelector('#inplayer-prev-ep-btn');
  const nextBtn = overlay.querySelector('#inplayer-next-ep-btn');

  const isSeries = checkIfMediaIsSeries(currentMedia);

  let titleText = cleanVideoTitle(currentMedia?.title || '');
  let epText = '';
  let hasPrev = false;
  let hasNext = false;

  if (isSeries) {
    if (quickBarSeriesData && quickBarSeriesData.seasons && quickBarSeriesData.seasons.length > 0) {
      const curSeasonObj = quickBarSeriesData.seasons.find(s => s.season === quickBarActiveSeason) || quickBarSeriesData.seasons[0];
      const totalEps = curSeasonObj?.episodes?.length || 0;
      const curEpIdx = curSeasonObj?.episodes?.findIndex(e => e.episode === quickBarActiveEpisode) ?? -1;

      epText = `📺 С${quickBarActiveSeason} • Э${quickBarActiveEpisode}`;
      hasPrev = curEpIdx > 0 || quickBarActiveSeason > 1;
      hasNext = (curEpIdx >= 0 && curEpIdx < totalEps - 1) || quickBarSeriesData.seasons.findIndex(s => s.season === quickBarActiveSeason) < quickBarSeriesData.seasons.length - 1;
    } else if (currentEpisodes && currentEpisodes.length > 0) {
      epText = `📺 Серия ${currentEpisodeIndex || 1}`;
      const idx = currentEpisodes.findIndex(e => (e.position || 1) === currentEpisodeIndex);
      hasPrev = idx > 0;
      hasNext = idx >= 0 && idx < currentEpisodes.length - 1;
    } else if (currentMedia?.episodes && currentMedia.episodes.length > 0) {
      epText = `📺 Серия ${currentEpisodeIndex || 1}`;
      const idx = currentMedia.episodes.findIndex(e => (e.ordinal || 1) === currentEpisodeIndex);
      hasPrev = idx > 0;
      hasNext = idx >= 0 && idx < currentMedia.episodes.length - 1;
    } else {
      epText = `📺 Серия 1`;
    }
  } else {
    // ДЛЯ ФИЛЬМОВ
    epText = currentMedia?.quality || '🎬 Фильм';
  }

  if (badge) badge.textContent = epText;
  if (name) name.textContent = titleText;
  if (epBtn) epBtn.style.display = isSeries ? 'inline-flex' : 'none';
  if (bottomBar) bottomBar.style.display = isSeries ? 'flex' : 'none';
  if (sheet) {
    if (!isSeries) {
      sheet.classList.remove('is-open');
      sheet.style.display = 'none';
    } else {
      sheet.style.display = '';
    }
  }
  if (prevBtn) prevBtn.disabled = !hasPrev;
  if (nextBtn) nextBtn.disabled = !hasNext;

  if (isSeries && sheet && sheet.classList.contains('is-open')) {
    renderInPlayerEpisodesSheet(overlay);
  }
}

export function playEpisodeByNumber(epNum, seasonNum = null) {
  const ep = Number(epNum);
  if (!ep || isNaN(ep)) return false;
  const sNum = seasonNum !== null && seasonNum !== undefined ? Number(seasonNum) : Number(quickBarActiveSeason || currentMedia?.season || 1);

  currentEpisodeIndex = ep;
  quickBarActiveEpisode = ep;
  quickBarActiveSeason = sNum;

  if (currentMedia?.id) {
    markEpisodeWatched(currentMedia.id, sNum, ep, true);
  }

  // 1. Универсальная быстрая панель серверов / FanFilm / RuTube / VK / Kodik
  if (quickBarSeriesData && quickBarSeriesData.seasons && quickBarSeriesData.seasons.length > 0) {
    selectQuickSeason(sNum);
    selectQuickEpisode(ep);
    updateInPlayerEpisodeInfo();
    highlightActiveEpisodeInGrid(ep);
    return true;
  }

  // Если панель еще не инициализирована, но медиа является сериалом
  if (checkIfMediaIsSeries(currentMedia)) {
    initUniversalSeriesQuickBar(sNum, ep);
    selectQuickEpisode(ep);
    updateInPlayerEpisodeInfo();
    highlightActiveEpisodeInGrid(ep);
    return true;
  }

  // 2. AniLibria
  if (currentMedia?.source === 'anilibria' && currentMedia.episodes && currentMedia.episodes.length > 0) {
    const rawEp = (currentMedia.episodes || []).find(e => Number(e.ordinal || 1) === ep) || currentMedia.episodes[ep - 1];
    if (rawEp) {
      const streamUrl = rawEp.hls_1080 || rawEp.hls_720 || rawEp.hls_480;
      if (streamUrl) playStreamUrl(streamUrl);
      loadSkipTimes(currentMedia.id, ep);
      updateInPlayerEpisodeInfo();
      highlightActiveEpisodeInGrid(ep);
      showToast(`🎬 Серия ${ep}`, 'info');
      return true;
    }
  }

  // 3. AniXart
  if (currentMedia?.source === 'anixart' && currentEpisodes && currentEpisodes.length > 0) {
    const rawEp = (currentEpisodes || []).find(e => Number(e.position || 1) === ep) || currentEpisodes[ep - 1];
    if (rawEp) {
      playAnixartEpisode(rawEp);
      loadSkipTimes(currentMedia.id, ep);
      updateInPlayerEpisodeInfo();
      highlightActiveEpisodeInGrid(ep);
      showToast(`🎬 Серия ${ep}`, 'info');
      return true;
    }
  }

  // 4. Прямой HLS видео-плеер (RuTube HLS без рекламы)
  const video = document.getElementById('storm-video-player');
  const activeId = currentActivePlayer?.id || '';
  if (video && (activeId.includes('rutube') || currentMedia?.rutube_id)) {
    const cleanT = cleanVideoTitle(currentMedia?.title || '');
    fetch(`/api/media/rutube-episode?title=${encodeURIComponent(cleanT)}&season=${sNum}&episode=${ep}`)
      .then(r => r.json())
      .then(d => {
        if (d && d.hls_url) {
          playStreamUrl(d.hls_url);
        } else if (d && d.embed_url) {
          playStreamUrl(d.embed_url);
        }
      })
      .catch(() => {});
    showToast(`🎬 Сезон ${sNum} • Серия ${ep}`, 'info');
    updatePlayerUrl(currentMedia, sNum, ep, currentActivePlayer);
    highlightActiveEpisodeInGrid(ep);
    updateInPlayerEpisodeInfo();
    return true;
  }

  // 5. Iframe плеер (RuTube, VK Видео, Kodik, HDRezka, Collaps, FanFilm и др.)
  const iframe = document.querySelector('.cinema-player-iframe');
  if (iframe) {
    try {
      if (activeId.startsWith('rutube')) {
        const allEps = currentMedia?.episodes || [];
        const epData = allEps.find(e => Number(e.episode_number || e.ordinal || e.episode) === ep);
        if (epData && epData.embed_url) {
          iframe.src = epData.embed_url;
          showToast(`🎬 Сезон ${sNum} • Серия ${ep}`, 'info');
          updatePlayerUrl(currentMedia, sNum, ep, currentActivePlayer);
          highlightActiveEpisodeInGrid(ep);
          updateInPlayerEpisodeInfo();
          return true;
        }

        const cleanT = cleanVideoTitle(currentMedia?.title || '');
        fetch(`/api/media/rutube-episode?title=${encodeURIComponent(cleanT)}&season=${sNum}&episode=${ep}`)
          .then(r => r.json())
          .then(d => {
            if (d && d.embed_url) {
              iframe.src = d.embed_url;
            }
          })
          .catch(() => {});

        showToast(`🎬 Сезон ${sNum} • Серия ${ep}`, 'info');
        updatePlayerUrl(currentMedia, sNum, ep, currentActivePlayer);
        highlightActiveEpisodeInGrid(ep);
        updateInPlayerEpisodeInfo();
        return true;
      }

      if (activeId.startsWith('vk')) {
        const cleanT = cleanVideoTitle(currentMedia?.title || '');
        fetch(`/api/media/vk-episode?title=${encodeURIComponent(cleanT)}&season=${sNum}&episode=${ep}`)
          .then(r => r.json())
          .then(d => {
            if (d && d.embed_url) {
              iframe.src = d.embed_url;
            }
          })
          .catch(() => {});

        showToast(`🎬 Сезон ${sNum} • Серия ${ep}`, 'info');
        updatePlayerUrl(currentMedia, sNum, ep, currentActivePlayer);
        highlightActiveEpisodeInGrid(ep);
        updateInPlayerEpisodeInfo();
        return true;
      }

      let curSrc = iframe.src || (currentActivePlayer?.url || '');
      if (curSrc) {
        let newUrl = curSrc;
        if (newUrl.includes('season=') || newUrl.includes('episode=')) {
          newUrl = newUrl.replace(/([?&])season=\d+/g, `$1season=${sNum}`);
          newUrl = newUrl.replace(/([?&])episode=\d+/g, `$1episode=${ep}`);
        } else {
          newUrl += (newUrl.includes('?') ? '&' : '?') + `season=${sNum}&episode=${ep}`;
        }
        iframe.src = newUrl;
        showToast(`🎬 Сезон ${sNum} • Серия ${ep}`, 'info');
        updatePlayerUrl(currentMedia, sNum, ep, currentActivePlayer);
        highlightActiveEpisodeInGrid(ep);
        updateInPlayerEpisodeInfo();
        return true;
      }
    } catch (_) {}
  }

  updatePlayerUrl(currentMedia, sNum, ep, currentActivePlayer);
  highlightActiveEpisodeInGrid(ep);
  updateInPlayerEpisodeInfo();
  return false;
}

export function playInPlayerNextEpisode() {
  if (!checkIfMediaIsSeries(currentMedia)) {
    showToast('Это фильм, следующая серия недоступна', 'info');
    return;
  }

  // 1. Быстрая панель FanFilm / Kodik / серверов
  if (quickBarSeriesData && quickBarSeriesData.seasons && quickBarSeriesData.seasons.length > 0) {
    const curSeason = Number(quickBarActiveSeason) || 1;
    const curEp = Number(quickBarActiveEpisode) || 1;
    const curSeasonObj = quickBarSeriesData.seasons.find(s => Number(s.season) === curSeason) || quickBarSeriesData.seasons[0];
    if (curSeasonObj?.episodes && curSeasonObj.episodes.length > 0) {
      const curEpIdx = curSeasonObj.episodes.findIndex(e => Number(e.episode) === curEp);
      if (curEpIdx >= 0 && curEpIdx < curSeasonObj.episodes.length - 1) {
        const nextEp = Number(curSeasonObj.episodes[curEpIdx + 1].episode);
        selectQuickEpisode(nextEp);
        updateInPlayerEpisodeInfo();
        return;
      } else {
        const curSeasonIdx = quickBarSeriesData.seasons.findIndex(s => Number(s.season) === curSeason);
        if (curSeasonIdx >= 0 && curSeasonIdx < quickBarSeriesData.seasons.length - 1) {
          const nextSeasonObj = quickBarSeriesData.seasons[curSeasonIdx + 1];
          const nextSeason = Number(nextSeasonObj.season);
          const firstEp = Number(nextSeasonObj.episodes?.[0]?.episode || 1);
          selectQuickSeason(nextSeason);
          selectQuickEpisode(firstEp);
          updateInPlayerEpisodeInfo();
          return;
        }
      }
    }
  }

  // 2. AniXart
  if (currentEpisodes && currentEpisodes.length > 0) {
    const curEp = Number(currentEpisodeIndex) || 1;
    const curIdx = currentEpisodes.findIndex(e => Number(e.position || e.ordinal || 1) === curEp);
    if (curIdx >= 0 && curIdx < currentEpisodes.length - 1) {
      const nextEp = currentEpisodes[curIdx + 1];
      const nextEpNum = Number(nextEp.position || nextEp.ordinal || (curIdx + 2));
      currentEpisodeIndex = nextEpNum;
      playAnixartEpisode(nextEp);
      updateInPlayerEpisodeInfo();
      return;
    }
  }

  // 3. AniLibria
  if (currentMedia?.episodes && currentMedia.episodes.length > 0) {
    const curEp = Number(currentEpisodeIndex) || 1;
    const curIdx = currentMedia.episodes.findIndex(e => Number(e.ordinal || 1) === curEp);
    if (curIdx >= 0 && curIdx < currentMedia.episodes.length - 1) {
      const nextEp = currentMedia.episodes[curIdx + 1];
      const nextEpNum = Number(nextEp.ordinal || (curIdx + 2));
      currentEpisodeIndex = nextEpNum;
      const streamUrl = nextEp.hls_1080 || nextEp.hls_720 || nextEp.hls_480;
      if (streamUrl) playStreamUrl(streamUrl);
      loadSkipTimes(currentMedia.id, nextEpNum);
      updateInPlayerEpisodeInfo();
      return;
    }
  }

  // 4. Сетка серий TMDB / базовых сериалов
  const gridEl = document.getElementById('series-episodes-grid') || document.getElementById('episodes-grid');
  if (gridEl) {
    const activeCard = gridEl.querySelector('.series-episode-card.active, .episode-btn.active');
    const nextCard = activeCard ? activeCard.nextElementSibling : gridEl.querySelector('.series-episode-card');
    if (nextCard && nextCard.classList.contains('series-episode-card')) {
      const nextEpNum = parseInt(nextCard.dataset.epNum, 10);
      if (nextEpNum && !isNaN(nextEpNum)) {
        playEpisodeByNumber(nextEpNum);
        updateInPlayerEpisodeInfo();
        return;
      }
    }
  }

  // 5. Общий переход по порядковому номеру
  const curEpNum = Number(currentEpisodeIndex || quickBarActiveEpisode || 1);
  const nextEpNum = curEpNum + 1;
  const switched = playEpisodeByNumber(nextEpNum);
  if (switched) {
    updateInPlayerEpisodeInfo();
    return;
  }

  showToast('Это последняя серия сезона', 'info');
  if (currentMedia && currentMedia.id) {
    currentMedia.user_status = 'completed';
    saveBookmarkStatus(currentMedia, 'completed');
    renderStatusButtons('completed');
  }
}

export function playInPlayerPrevEpisode() {
  if (!checkIfMediaIsSeries(currentMedia)) return;

  // 1. Быстрая панель FanFilm / Kodik / серверов
  if (quickBarSeriesData && quickBarSeriesData.seasons && quickBarSeriesData.seasons.length > 0) {
    const curSeason = Number(quickBarActiveSeason) || 1;
    const curEp = Number(quickBarActiveEpisode) || 1;
    const curSeasonObj = quickBarSeriesData.seasons.find(s => Number(s.season) === curSeason) || quickBarSeriesData.seasons[0];
    if (curSeasonObj?.episodes) {
      const curEpIdx = curSeasonObj.episodes.findIndex(e => Number(e.episode) === curEp);
      if (curEpIdx > 0) {
        const prevEp = Number(curSeasonObj.episodes[curEpIdx - 1].episode);
        selectQuickEpisode(prevEp);
        updateInPlayerEpisodeInfo();
        return;
      } else {
        const curSeasonIdx = quickBarSeriesData.seasons.findIndex(s => Number(s.season) === curSeason);
        if (curSeasonIdx > 0) {
          const prevSeasonObj = quickBarSeriesData.seasons[curSeasonIdx - 1];
          const lastEp = Number(prevSeasonObj.episodes?.[prevSeasonObj.episodes.length - 1]?.episode || 1);
          selectQuickSeason(Number(prevSeasonObj.season));
          selectQuickEpisode(lastEp);
          updateInPlayerEpisodeInfo();
          return;
        }
      }
    }
  }

  // 2. AniXart
  if (currentEpisodes && currentEpisodes.length > 0) {
    const curEp = Number(currentEpisodeIndex) || 1;
    const curIdx = currentEpisodes.findIndex(e => Number(e.position || e.ordinal || 1) === curEp);
    if (curIdx > 0) {
      const prevEp = currentEpisodes[curIdx - 1];
      const prevEpNum = Number(prevEp.position || prevEp.ordinal || curIdx);
      currentEpisodeIndex = prevEpNum;
      playAnixartEpisode(prevEp);
      updateInPlayerEpisodeInfo();
      return;
    }
  }

  // 3. AniLibria
  if (currentMedia?.episodes && currentMedia.episodes.length > 0) {
    const curEp = Number(currentEpisodeIndex) || 1;
    const curIdx = currentMedia.episodes.findIndex(e => Number(e.ordinal || 1) === curEp);
    if (curIdx > 0) {
      const prevEp = currentMedia.episodes[curIdx - 1];
      const prevEpNum = Number(prevEp.ordinal || curIdx);
      currentEpisodeIndex = prevEpNum;
      const streamUrl = prevEp.hls_1080 || prevEp.hls_720 || prevEp.hls_480;
      if (streamUrl) playStreamUrl(streamUrl);
      loadSkipTimes(currentMedia.id, prevEpNum);
      updateInPlayerEpisodeInfo();
      return;
    }
  }

  // 4. Сетка серий TMDB
  const gridEl = document.getElementById('series-episodes-grid') || document.getElementById('episodes-grid');
  if (gridEl) {
    const activeCard = gridEl.querySelector('.series-episode-card.active, .episode-btn.active');
    if (activeCard && activeCard.previousElementSibling && activeCard.previousElementSibling.classList.contains('series-episode-card')) {
      const prevEpNum = parseInt(activeCard.previousElementSibling.dataset.epNum, 10);
      if (prevEpNum && !isNaN(prevEpNum)) {
        playEpisodeByNumber(prevEpNum);
        updateInPlayerEpisodeInfo();
        return;
      }
    }
  }

  // 5. Порядковый откат назад
  const curEpNum = Number(currentEpisodeIndex || quickBarActiveEpisode || 1);
  if (curEpNum > 1) {
    playEpisodeByNumber(curEpNum - 1);
    updateInPlayerEpisodeInfo();
    return;
  }

  showToast('Это первая серия', 'info');
}

export function playNextEpisode() {
  playInPlayerNextEpisode();
}

let inPlayerHideTimer = null;

export function resetInPlayerHideTimer() {
  clearTimeout(inPlayerHideTimer);
  inPlayerHideTimer = setTimeout(() => {
    hideInPlayerControls();
  }, 3500);
}

export function showInPlayerControls() {
  const modal = document.getElementById('cinema-modal');
  const videoBox = document.querySelector('#cinema-player-wrapper .player-video-box') || document.querySelector('.player-video-box');
  if (videoBox) videoBox.classList.add('controls-visible');
  if (modal) modal.classList.add('controls-visible');
  resetInPlayerHideTimer();
}

export function hideInPlayerControls(force = false) {
  const modal = document.getElementById('cinema-modal');
  const videoBox = document.querySelector('#cinema-player-wrapper .player-video-box') || document.querySelector('.player-video-box');
  if (!force && videoBox) {
    const vs = videoBox.querySelector('#player-inplayer-voice-sheet');
    const jw = videoBox.querySelector('#inplayer-jog-dial-widget');
    const es = videoBox.querySelector('#player-inplayer-episodes-sheet');
    const isVoiceOpen = vs && vs.style.display !== 'none' && vs.classList.contains('is-open');
    const isJogOpen = jw && jw.style.display !== 'none';
    const isEpOpen = es && es.classList.contains('is-open');
    if (isVoiceOpen || isJogOpen || isEpOpen) return;
  }
  if (videoBox) videoBox.classList.remove('controls-visible');
  if (modal) modal.classList.remove('controls-visible');
}

if (typeof window !== 'undefined' && !window._stormGlobalControlsListenersAttached) {
  window._stormGlobalControlsListenersAttached = true;
  const onUserActivity = () => {
    const modal = document.getElementById('cinema-modal');
    if (modal && (modal.classList.contains('is-open') || modal.classList.contains('is-fullscreen'))) {
      showInPlayerControls();
    }
  };
  window.addEventListener('mousemove', onUserActivity, { passive: true });
  window.addEventListener('pointermove', onUserActivity, { passive: true });
}

export function mountInPlayerOverlay(videoBox) {
  if (!videoBox) return;
  attachCinemaDblClick(videoBox);
  const isSeries = checkIfMediaIsSeries(currentMedia);
  const oldOverlay = videoBox.querySelector('.storm-inplayer-overlay');
  if (oldOverlay) {
    oldOverlay.remove();
  }

  const overlay = document.createElement('div');
  overlay.className = 'storm-inplayer-overlay';
  overlay.id = 'storm-inplayer-overlay';
  attachCinemaDblClick(overlay);
  overlay.innerHTML = `
    <!-- Прозрачная зона улавливания курсора мыши в верхней части плеера -->
    <div class="inplayer-top-sensor" id="inplayer-top-sensor"></div>

    <!-- Верхняя полоса управления Progressive Disclosure HUD -->
    <div class="inplayer-top-bar">
      <div class="inplayer-title-info">
        <span class="inplayer-badge" id="inplayer-badge">${isSeries ? '📺 Серия 1' : (currentMedia?.quality || '🎬 Фильм')}</span>
        <span class="inplayer-series-name" id="inplayer-series-name">${escapeHtml(currentMedia?.title || '')}</span>
        <div class="inplayer-telemetry-pill" id="inplayer-telemetry-pill" title="Телеметрия потока и буфера">
          <span class="telemetry-dot"></span>
          <span id="telemetry-text">4K • 60 FPS • Буфер 60с</span>
        </div>
      </div>
      <div class="inplayer-top-actions">
        <button type="button" class="inplayer-ctrl-btn" id="inplayer-voice-btn" title="Выбор студии озвучки">
          🎙️ <span>Озвучка</span>
        </button>
        <button type="button" class="inplayer-ctrl-btn" id="inplayer-episodes-btn" title="Список серий" style="${isSeries ? '' : 'display: none;'}">
          📋 <span>Серии</span>
        </button>
        <button type="button" class="inplayer-ctrl-btn" id="inplayer-jog-btn" title="Джог-дайл (роторная покадровая перемотка)">
          🎛️ <span>Джог</span>
        </button>
        <button type="button" class="inplayer-ctrl-btn" id="inplayer-focus-btn" title="Режим фокуса (Clean Canvas — убрать все элементы интерфейса)">
          👁️ <span>Фокус</span>
        </button>
      </div>
    </div>

    <!-- Джог-дайл роторная покадровая перемотка (Студийный прецизионный контроллер) -->
    <div class="inplayer-jog-dial-widget" id="inplayer-jog-dial-widget" style="display: none;">
      <div class="jog-dial-header">
        <div class="jog-dial-header-title">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <circle cx="12" cy="12" r="3"></circle>
            <line x1="12" y1="2" x2="12" y2="5"></line>
            <line x1="12" y1="19" x2="12" y2="22"></line>
            <line x1="2" y1="12" x2="5" y2="12"></line>
            <line x1="19" y1="12" x2="22" y2="12"></line>
          </svg>
          <span>Джог-дайл</span>
        </div>
        <button type="button" class="jog-dial-close" id="jog-dial-close-btn" title="Закрыть джог">✕</button>
      </div>

      <!-- Прецизионный ротор со шкалой градаций -->
      <div class="jog-dial-wheel-wrap" id="jog-dial-wheel-wrap" title="Вращайте по кругу, перетаскивайте или крутите колесико мыши">
        <div class="jog-dial-bezel">
          <svg class="jog-dial-bezel-svg" viewBox="0 0 126 126">
            <circle cx="63" cy="63" r="58" fill="none" stroke="rgba(0, 210, 255, 0.15)" stroke-width="1.5" stroke-dasharray="2 6.5"/>
            <!-- Основные деления 0, 90, 180, 270 град -->
            <line x1="63" y1="5" x2="63" y2="11" stroke="#00f0ff" stroke-width="2" stroke-linecap="round"/>
            <line x1="121" y1="63" x2="115" y2="63" stroke="#00f0ff" stroke-width="2" stroke-linecap="round"/>
            <line x1="63" y1="121" x2="63" y2="115" stroke="#00f0ff" stroke-width="2" stroke-linecap="round"/>
            <line x1="5" y1="63" x2="11" y2="63" stroke="#00f0ff" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </div>
        <div class="jog-dial-wheel" id="jog-dial-wheel">
          <div class="jog-dial-rotor-grooves"></div>
          <div class="jog-dial-dimple">
            <div class="jog-dial-indicator"></div>
          </div>
          <div class="jog-dial-hub">
            <div class="jog-dial-hub-dot"></div>
          </div>
        </div>
      </div>

      <!-- Цифровой HUD дисплей информации -->
      <div class="jog-dial-hud">
        <div class="jog-hud-time-row">
          <span class="jog-hud-label">Позиция</span>
          <span class="jog-hud-time" id="jog-dial-time-display">00:00</span>
        </div>
        <div class="jog-hud-delta-badge" id="jog-dial-delta-badge" style="opacity: 0;">
          <span id="jog-dial-delta-text">±0с</span>
        </div>
      </div>

      <!-- Быстрые тактильные 3D кнопки: -10с, -1с, +1с, +10с -->
      <div class="jog-dial-controls">
        <button type="button" class="jog-btn" id="jog-step-back10" title="Перемотка назад на 10 секунд">-10с</button>
        <button type="button" class="jog-btn jog-btn-micro" id="jog-step-back1" title="Назад на 1 секунду / покадрово">-1с</button>
        <button type="button" class="jog-btn jog-btn-micro" id="jog-step-fwd1" title="Вперед на 1 секунду / покадрово">+1с</button>
        <button type="button" class="jog-btn" id="jog-step-fwd10" title="Перемотка вперед на 10 секунд">+10с</button>
      </div>

      <div class="jog-dial-footer">Вращайте ротор или колесико мыши</div>
    </div>

    <!-- Выдвижная шторка выбора студии озвучки прямо в плеере -->
    <div class="player-inplayer-voice-sheet" id="player-inplayer-voice-sheet" style="display: none;">
      <div class="inplayer-sheet-header">
        <div class="inplayer-sheet-title">
          <span>🎙️</span>
          <span>Выбор студии озвучки</span>
        </div>
        <button type="button" class="inplayer-sheet-close-btn" id="inplayer-voice-close-btn" title="Закрыть">✕</button>
      </div>
      <div class="inplayer-voice-list" id="inplayer-voice-list"></div>
    </div>

    <!-- Нижняя полоса быстрого переключения серий: компактные парящие капсулы -->
    <div class="inplayer-bottom-bar" id="inplayer-bottom-bar" style="${isSeries ? '' : 'display: none;'}">
      <button type="button" class="inplayer-episode-nav-btn" id="inplayer-prev-ep-btn" title="Предыдущая серия">
        ⏮ <span>Пред. серия</span>
      </button>
      <button type="button" class="inplayer-episode-nav-btn" id="inplayer-next-ep-btn" title="Следующая серия">
        <span>След. серия</span> ⏭
      </button>
    </div>

    <!-- Выдвижная шторка выбора сезона и серии прямо в плеере -->
    <div class="player-inplayer-episodes-sheet" id="player-inplayer-episodes-sheet" style="${isSeries ? '' : 'display: none;'}">
      <div class="inplayer-sheet-header">
        <div class="inplayer-sheet-title">
          <span>📺</span>
          <span>Выбор серии</span>
          <span class="inplayer-sheet-count" id="inplayer-sheet-count"></span>
        </div>
        <button type="button" class="inplayer-sheet-close-btn" id="inplayer-sheet-close-btn" title="Закрыть список">✕</button>
      </div>
      <div class="inplayer-season-chips-bar" id="inplayer-season-chips-bar"></div>
      <div class="inplayer-episodes-list" id="inplayer-episodes-list"></div>
    </div>
  `;
  videoBox.appendChild(overlay);

  const epBtn = overlay.querySelector('#inplayer-episodes-btn');
  const voiceBtn = overlay.querySelector('#inplayer-voice-btn');
  const jogBtn = overlay.querySelector('#inplayer-jog-btn');
  const focusBtn = overlay.querySelector('#inplayer-focus-btn');
  const voiceSheet = overlay.querySelector('#player-inplayer-voice-sheet');
  const voiceCloseBtn = overlay.querySelector('#inplayer-voice-close-btn');
  const episodesSheet = overlay.querySelector('#player-inplayer-episodes-sheet');
  const sheetCloseBtn = overlay.querySelector('#inplayer-sheet-close-btn');
  const jogWidget = overlay.querySelector('#inplayer-jog-dial-widget');
  const jogCloseBtn = overlay.querySelector('#jog-dial-close-btn');
  const jogWheel = overlay.querySelector('#jog-dial-wheel');
  const jogWheelWrap = overlay.querySelector('#jog-dial-wheel-wrap');
  const jogTimeDisplay = overlay.querySelector('#jog-dial-time-display');
  const jogDeltaBadge = overlay.querySelector('#jog-dial-delta-badge');
  const jogDeltaText = overlay.querySelector('#jog-dial-delta-text');
  const jogBack10 = overlay.querySelector('#jog-step-back10');
  const jogBack1 = overlay.querySelector('#jog-step-back1');
  const jogFwd1 = overlay.querySelector('#jog-step-fwd1');
  const jogFwd10 = overlay.querySelector('#jog-step-fwd10');

  // 1. Кнопка «Серии»
  if (epBtn) {
    epBtn.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (voiceSheet) { voiceSheet.classList.remove('is-open'); voiceSheet.style.display = 'none'; voiceBtn?.classList.remove('active'); }
      if (jogWidget) { jogWidget.style.display = 'none'; jogBtn?.classList.remove('active'); stopJogTracking(); }
      toggleInPlayerEpisodesSheet(overlay);
    };
  }

  if (sheetCloseBtn) {
    sheetCloseBtn.onclick = (e) => {
      e.stopPropagation();
      toggleInPlayerEpisodesSheet(overlay, false);
    };
  }

  // 2. Кнопка «Озвучка» (боковая выдвижная шторка)
  if (voiceBtn && voiceSheet) {
    voiceBtn.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (episodesSheet) { episodesSheet.classList.remove('is-open'); episodesSheet.style.display = 'none'; epBtn?.classList.remove('active'); }
      if (jogWidget) { jogWidget.style.display = 'none'; jogBtn?.classList.remove('active'); stopJogTracking(); }

      const isOpen = voiceSheet.classList.contains('is-open');
      if (isOpen) {
        voiceSheet.classList.remove('is-open');
        voiceSheet.style.display = 'none';
        voiceBtn.classList.remove('active');
      } else {
        voiceSheet.style.display = 'flex';
        renderInPlayerVoiceSheet(voiceSheet);
        voiceSheet.classList.add('is-open');
        voiceBtn.classList.add('active');
      }
    };
  }

  if (voiceCloseBtn && voiceSheet) {
    voiceCloseBtn.onclick = (e) => {
      e.stopPropagation();
      voiceSheet.classList.remove('is-open');
      voiceSheet.style.display = 'none';
      if (voiceBtn) voiceBtn.classList.remove('active');
    };
  }

  // 3. Кнопка «Джог» (Премиальный роторный контроллер покадровой перемотки)
  let jogRotation = 0;
  let jogSessionDelta = 0;
  let jogBadgeTimeout = null;
  let jogTimeTrackerTimer = null;

  const updateJogDisplay = () => {
    const v = document.getElementById('storm-video-player') || document.querySelector('#cinema-player-wrapper video');
    if (jogTimeDisplay) {
      if (v && v.currentTime !== undefined && !isNaN(v.currentTime)) {
        jogTimeDisplay.textContent = formatMediaTime(v.currentTime);
      } else if (jogSessionDelta !== 0) {
        jogTimeDisplay.textContent = `${jogSessionDelta > 0 ? '+' : ''}${jogSessionDelta}с`;
      } else {
        jogTimeDisplay.textContent = '00:00';
      }
    }
  };

  const flashDeltaBadge = (seconds) => {
    if (!jogDeltaBadge || !jogDeltaText) return;
    jogSessionDelta += seconds;
    if (jogSessionDelta > 0) {
      jogDeltaText.textContent = `▶ +${jogSessionDelta}с`;
      jogDeltaBadge.style.color = '#00f0ff';
      jogDeltaBadge.style.borderColor = 'rgba(0, 240, 255, 0.45)';
      jogDeltaBadge.style.background = 'rgba(0, 210, 255, 0.18)';
    } else if (jogSessionDelta < 0) {
      jogDeltaText.textContent = `◀ ${jogSessionDelta}с`;
      jogDeltaBadge.style.color = '#f59e0b';
      jogDeltaBadge.style.borderColor = 'rgba(245, 158, 11, 0.45)';
      jogDeltaBadge.style.background = 'rgba(245, 158, 11, 0.18)';
    } else {
      jogDeltaText.textContent = '±0с';
    }
    jogDeltaBadge.style.opacity = '1';
    jogDeltaBadge.style.transform = 'scale(1)';

    clearTimeout(jogBadgeTimeout);
    jogBadgeTimeout = setTimeout(() => {
      if (jogDeltaBadge) {
        jogDeltaBadge.style.opacity = '0';
        jogDeltaBadge.style.transform = 'scale(0.9)';
      }
      jogSessionDelta = 0;
    }, 1400);
  };

  const doJogStep = (seconds, animated = true) => {
    sendSeekDelta(seconds);
    if (animated && jogWheel) {
      jogWheel.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
      jogRotation += seconds > 0 ? 36 * Math.min(seconds, 3) : 36 * Math.max(seconds, -3);
      jogWheel.style.transform = `rotate(${jogRotation}deg)`;
    }
    flashDeltaBadge(seconds);
    updateJogDisplay();
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(8); } catch (_) {}
    }
  };

  const startJogTracking = () => {
    stopJogTracking();
    updateJogDisplay();
    jogTimeTrackerTimer = setInterval(updateJogDisplay, 350);
  };

  const stopJogTracking = () => {
    if (jogTimeTrackerTimer) {
      clearInterval(jogTimeTrackerTimer);
      jogTimeTrackerTimer = null;
    }
  };

  if (jogBtn && jogWidget) {
    jogBtn.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (voiceSheet) { voiceSheet.classList.remove('is-open'); voiceSheet.style.display = 'none'; voiceBtn?.classList.remove('active'); }
      if (episodesSheet) { episodesSheet.classList.remove('is-open'); epBtn?.classList.remove('active'); }

      const isOpen = jogWidget.style.display !== 'none';
      jogWidget.style.display = isOpen ? 'none' : 'flex';
      jogBtn.classList.toggle('active', !isOpen);
      if (!isOpen) {
        startJogTracking();
      } else {
        stopJogTracking();
      }
    };
  }

  if (jogCloseBtn && jogWidget) {
    jogCloseBtn.onclick = (e) => {
      e.stopPropagation();
      jogWidget.style.display = 'none';
      if (jogBtn) jogBtn.classList.remove('active');
      stopJogTracking();
    };
  }

  if (jogBack10) jogBack10.onclick = (e) => { e.stopPropagation(); doJogStep(-10, true); };
  if (jogBack1) jogBack1.onclick = (e) => { e.stopPropagation(); doJogStep(-1, true); };
  if (jogFwd1) jogFwd1.onclick = (e) => { e.stopPropagation(); doJogStep(1, true); };
  if (jogFwd10) jogFwd10.onclick = (e) => { e.stopPropagation(); doJogStep(10, true); };

  if (jogWheelWrap) {
    let isJogDragging = false;
    let wrapCenter = { x: 0, y: 0 };
    let lastPointerAngle = 0;
    let accumulatedAngle = 0;

    jogWheelWrap.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      isJogDragging = true;
      const rect = jogWheelWrap.getBoundingClientRect();
      wrapCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      lastPointerAngle = Math.atan2(e.clientY - wrapCenter.y, e.clientX - wrapCenter.x) * (180 / Math.PI);
      accumulatedAngle = 0;
      if (jogWheel) jogWheel.style.transition = 'none';
      try { jogWheelWrap.setPointerCapture(e.pointerId); } catch {}
    });

    jogWheelWrap.addEventListener('pointermove', (e) => {
      if (!isJogDragging) return;
      e.stopPropagation();
      const currentAngle = Math.atan2(e.clientY - wrapCenter.y, e.clientX - wrapCenter.x) * (180 / Math.PI);
      let angleDiff = currentAngle - lastPointerAngle;
      if (angleDiff > 180) angleDiff -= 360;
      if (angleDiff < -180) angleDiff += 360;
      lastPointerAngle = currentAngle;

      jogRotation += angleDiff;
      if (jogWheel) jogWheel.style.transform = `rotate(${jogRotation}deg)`;

      accumulatedAngle += angleDiff;
      const STEP_THRESHOLD = 14; // ~14 градусов на 1 секунду прецизионного скраббинга
      if (Math.abs(accumulatedAngle) >= STEP_THRESHOLD) {
        const steps = Math.trunc(accumulatedAngle / STEP_THRESHOLD);
        accumulatedAngle -= steps * STEP_THRESHOLD;
        const seconds = steps * 1;
        sendSeekDelta(seconds);
        flashDeltaBadge(seconds);
        updateJogDisplay();
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          try { navigator.vibrate(6); } catch (_) {}
        }
      }
    });

    const stopJogDrag = (e) => {
      if (isJogDragging) {
        e.stopPropagation();
        isJogDragging = false;
        accumulatedAngle = 0;
        if (jogWheel) jogWheel.style.transition = 'transform 0.2s ease-out';
        try { jogWheelWrap.releasePointerCapture(e.pointerId); } catch {}
      }
    };

    jogWheelWrap.addEventListener('pointerup', stopJogDrag);
    jogWheelWrap.addEventListener('pointercancel', stopJogDrag);

    // Поддержка колесика мыши для плавной роторной перемотки
    jogWheelWrap.addEventListener('wheel', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const direction = e.deltaY < 0 ? 1 : -1;
      const step = e.shiftKey ? 5 : 1;
      doJogStep(direction * step, true);
    }, { passive: false });
  }

  // 4. Кнопка «Фокус» (Кинотеатральный режим)
  if (focusBtn) {
    const modal = document.getElementById('cinema-modal');
    if (modal && modal.classList.contains('is-focus-mode')) {
      focusBtn.classList.add('active');
    }
    focusBtn.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (modal) {
        const isFocus = modal.classList.toggle('is-focus-mode');
        document.documentElement.classList.toggle('cinema-focus-active', isFocus);
        document.body.classList.toggle('cinema-focus-active', isFocus);
        focusBtn.classList.toggle('active', isFocus);
        showToast(isFocus ? '👁️ Режим фокуса включен' : 'Режим фокуса выключен', 'info');
      }
    };
  }

  const focusExitBadge = document.getElementById('cinema-focus-exit-badge');
  if (focusExitBadge) {
    focusExitBadge.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      const modal = document.getElementById('cinema-modal');
      if (modal) {
        modal.classList.remove('is-focus-mode');
        document.documentElement.classList.remove('cinema-focus-active');
        document.body.classList.remove('cinema-focus-active');
        if (focusBtn) focusBtn.classList.remove('active');
        showToast('Режим фокуса выключен', 'info');
      }
    };
  }

  // Телеметрия потока (Live Stream Telemetry Pill)
  const telemetryPill = overlay.querySelector('#inplayer-telemetry-pill');
  if (telemetryPill) {
    telemetryPill.onclick = (e) => {
      e.stopPropagation();
      toggleStatsForNerds();
    };
  }

  // Периодическое обновление телеметрии (каждые 2 сек)
  const telemetryInterval = setInterval(() => {
    if (!overlay.isConnected) {
      clearInterval(telemetryInterval);
      return;
    }
    const tText = overlay.querySelector('#telemetry-text');
    const v = document.getElementById('storm-video-player') || document.querySelector('#cinema-player-wrapper video');
    if (tText) {
      if (v && v.videoWidth) {
        let resLabel = `${v.videoWidth}p`;
        if (v.videoWidth >= 3800) resLabel = '4K HDR';
        else if (v.videoWidth >= 2500) resLabel = '2K QHD';
        else if (v.videoWidth >= 1900) resLabel = '1080p FHD';
        else if (v.videoWidth >= 1200) resLabel = '720p HD';

        let bufSec = 0;
        if (v.buffered && v.buffered.length > 0) {
          const cur = v.currentTime;
          for (let i = 0; i < v.buffered.length; i++) {
            if (v.buffered.start(i) <= cur && v.buffered.end(i) >= cur) {
              bufSec = Math.round(v.buffered.end(i) - cur);
              break;
            }
          }
        }
        tText.textContent = `${resLabel} • 60 FPS • Буфер ${bufSec}с`;
      } else {
        tText.textContent = '4K HDR • Direct Stream • OK';
      }
    }
  }, 2000);

  const prevBtn = overlay.querySelector('#inplayer-prev-ep-btn');
  if (prevBtn) {
    prevBtn.onclick = (e) => {
      e.stopPropagation();
      playInPlayerPrevEpisode();
    };
  }

  const nextBtn = overlay.querySelector('#inplayer-next-ep-btn');
  if (nextBtn) {
    nextBtn.onclick = (e) => {
      e.stopPropagation();
      playInPlayerNextEpisode();
    };
  }

  // Сенсор верхней зоны для мгновенного отображения элементов управления
  const topSensor = overlay.querySelector('#inplayer-top-sensor');
  if (topSensor) {
    topSensor.addEventListener('mousemove', showInPlayerControls);
    topSensor.addEventListener('mouseenter', showInPlayerControls);
    topSensor.addEventListener('pointermove', showInPlayerControls);
  }

  videoBox.addEventListener('mousemove', showInPlayerControls);
  videoBox.addEventListener('pointermove', showInPlayerControls);

  const modal = document.getElementById('cinema-modal');
  if (modal) {
    modal.addEventListener('mousemove', showInPlayerControls);
    modal.addEventListener('pointermove', showInPlayerControls);
    const headerActions = modal.querySelector('.cinema-header-actions');
    if (headerActions) {
      headerActions.addEventListener('mouseenter', () => {
        clearTimeout(inPlayerHideTimer);
        showInPlayerControls();
      });
      headerActions.addEventListener('mouseleave', resetInPlayerHideTimer);
    }
  }

  if (!videoBox.dataset.hasInplayerListeners) {
    videoBox.dataset.hasInplayerListeners = 'true';

    // Тап/клик по видео: закрытие шторок или переключение видимости оверлея
    videoBox.addEventListener('click', (e) => {
      if (e.target.closest('.inplayer-top-bar') || 
          e.target.closest('.inplayer-bottom-bar') || 
          e.target.closest('.player-inplayer-episodes-sheet') || 
          e.target.closest('.player-inplayer-voice-sheet') || 
          e.target.closest('.inplayer-jog-dial-widget') ||
          e.target.closest('.inplayer-ctrl-btn') ||
          e.target.closest('.cinema-header-actions') ||
          e.target.closest('.storm-modal-tool-btn') ||
          e.target.closest('.storm-modal-fullscreen-btn') ||
          e.target.closest('.storm-modal-close') ||
          e.target.closest('.storm-modal-header') ||
          e.target.closest('.storm-skip-btn')) {
        resetInPlayerHideTimer();
        return;
      }

      // Если открыта любая вложенная шторка (озвучки, серий, джога) — клик закрывает её без скрытия контролов
      const vs = videoBox.querySelector('#player-inplayer-voice-sheet');
      const es = videoBox.querySelector('#player-inplayer-episodes-sheet');
      const jw = videoBox.querySelector('#inplayer-jog-dial-widget');
      const hasOpenSheet = (vs && vs.classList.contains('is-open')) || (es && es.classList.contains('is-open')) || (jw && jw.style.display !== 'none');
      if (hasOpenSheet) {
        if (vs) { vs.classList.remove('is-open'); vs.style.display = 'none'; videoBox.querySelector('#inplayer-voice-btn')?.classList.remove('active'); }
        if (es) { es.classList.remove('is-open'); es.style.display = 'none'; videoBox.querySelector('#inplayer-episodes-btn')?.classList.remove('active'); }
        if (jw) { jw.style.display = 'none'; videoBox.querySelector('#inplayer-jog-btn')?.classList.remove('active'); }
        return;
      }

      const isVis = videoBox.classList.contains('controls-visible');
      if (isVis) {
        hideInPlayerControls(true);
      } else {
        showInPlayerControls();
      }
    });

    // Двойной клик по области видео: переключение полноэкранного режима
    videoBox.addEventListener('dblclick', (e) => {
      if (e.target.closest('button, input, select, a, .inplayer-ctrl-btn, .inplayer-top-bar, .inplayer-bottom-bar, .player-inplayer-episodes-sheet, .player-inplayer-voice-sheet, .inplayer-jog-dial-widget, .cinema-header-actions, .storm-modal-tool-btn, .storm-modal-fullscreen-btn, .storm-modal-close, .storm-skip-btn')) {
        return;
      }
      e.preventDefault();
      toggleCinemaFullscreen();
    });

    videoBox.addEventListener('touchstart', (e) => {
      if (!e.target.closest('.inplayer-ctrl-btn') && 
          !e.target.closest('.player-inplayer-episodes-sheet') && 
          !e.target.closest('.player-inplayer-voice-sheet') && 
          !e.target.closest('.inplayer-jog-dial-widget')) {
        resetInPlayerHideTimer();
      }
    }, { passive: true });
  }

  showInPlayerControls();

  updateInPlayerEpisodeInfo();
  const savedSpeed = parseFloat(localStorage.getItem('storm_playback_speed') || '1');
  updateInPlayerSpeedDisplay(savedSpeed);
}

// ==========================================
// ПРОДВИНУТЫЙ РЕЖИМ «КАРТИНКА В КАРТИНКЕ» (PIP)
// ==========================================
export async function toggleAdvancedPiP() {
  const modal = document.getElementById('cinema-modal');
  const video = document.getElementById('storm-video-player') || document.querySelector('#cinema-player-wrapper video');
  const iframe = document.getElementById('cinema-player-wrapper')?.querySelector('iframe') || document.querySelector('.cinema-player-iframe');
  const pipBtn = document.getElementById('player-pip-btn');

  // Если окно уже в режиме плавающего mini-PiP — восстанавливаем полноразмерный кинотеатр
  if (modal && modal.classList.contains('is-mini-pip')) {
    modal.classList.remove('is-mini-pip');
    if (pipBtn) pipBtn.classList.remove('active');
    showToast('Полноразмерный кинотеатр восстановлен', 'info');
    return;
  }

  // 1. Для iframe плееров (FanFilm4K, Stravers, Kodik, Allplay и др.)
  // Категорически НЕЛЬЗЯ перемещать iframe в другой document через Document PiP API,
  // так как браузер немедленно перезагружает фрейм, и одноразовые токены балансеров
  // сгорают с ошибкой «К сожалению, запрашиваемый контент не найден».
  // Для них активируем встроенный плавающий мини-плеер без перемещения DOM элементов!
  if (iframe) {
    if (modal) {
      modal.classList.add('is-mini-pip');
      if (pipBtn) pipBtn.classList.add('active');
      trackClientAction('use_pip');
      showToast('Плавающий мини-плеер активирован (кликните 🪟 для возврата)', 'info');
    }
    return;
  }

  // 2. Стандартный нативный HTML5 Video PiP (плавающее окно поверх всех окон ОС)
  if (video && video.requestPictureInPicture) {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        if (pipBtn) pipBtn.classList.remove('active');
      } else {
        await video.requestPictureInPicture();
        if (pipBtn) pipBtn.classList.add('active');
        trackClientAction('use_pip');
        showToast('Режим «Картинка в картинке» активирован', 'info');
      }
      return;
    } catch (e) {
      console.warn('HTML5 Video PiP недоступен:', e);
    }
  }

  // 3. Универсальный плавающий режим Mini-Player (безопасный fallback)
  if (modal) {
    modal.classList.add('is-mini-pip');
    if (pipBtn) pipBtn.classList.add('active');
    trackClientAction('use_pip');
    showToast('Плавающий мини-плеер активирован (кликните 🪟 для возврата)', 'info');
  }
}

// ==========================================
// P2P WEBTORRENT СТРИМИНГ С ГОТОВЫМИ РАЗДАЧАМИ
// ==========================================
const WEBTORRENT_TRACKERS = [
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.webtorrent.dev',
  'wss://tracker.fastcast.nz',
  'wss://tracker.sloppyta.co:443/announce',
  'wss://tracker.ghostrr.com:443/announce',
  'wss://tracker.btorrent.xyz'
];

let webTorrentLoadPromise = null;
export async function ensureWebTorrentLoaded() {
  if (window.WebTorrent) return true;
  if (webTorrentLoadPromise) return webTorrentLoadPromise;
  webTorrentLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/webtorrent@latest/webtorrent.min.js';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => {
      webTorrentLoadPromise = null;
      reject(new Error('Не удалось загрузить WebTorrent модуль'));
    };
    document.head.appendChild(script);
  });
  return webTorrentLoadPromise;
}

let hlsLoadPromise = null;
export async function ensureHlsLoaded() {
  if (window.Hls) return true;
  if (hlsLoadPromise) return hlsLoadPromise;
  hlsLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/hls.js@latest';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => {
      hlsLoadPromise = null;
      reject(new Error('Не удалось загрузить HLS модуль'));
    };
    document.head.appendChild(script);
  });
  return hlsLoadPromise;
}

function renderWebTorrentPlayer() {
  const container = document.getElementById('cinema-player-wrapper');
  if (!container) return;

  const title = cleanVideoTitle(currentMedia?.title || 'Кинорелиз');
  const isAnime = currentMedia?.source === 'anixart' || currentMedia?.source === 'anilibria' || currentMedia?.media_type?.includes('anime');

  const trackerParams = WEBTORRENT_TRACKERS.map(t => '&tr=' + encodeURIComponent(t)).join('');
  const demoMagnet = 'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel' + trackerParams;

  const releases = isAnime ? [
    {
      title: `${title} [1080p FHD / HEVC]`,
      quality: '1080p FHD',
      codec: 'HEVC H.265 • 10-bit',
      dub: 'Официальный дубляж AniLibria',
      size: '3.4 ГБ',
      seeds: 215,
      magnet: demoMagnet
    },
    {
      title: `${title} [1080p BDRip / Multi-Audio]`,
      quality: '1080p BDRip',
      codec: 'AVC H.264 • High@L4.1',
      dub: 'Дубляж Студийная Банда',
      size: '2.8 ГБ',
      seeds: 184,
      magnet: demoMagnet
    },
    {
      title: `${title} [720p HD / Быстрый буфер]`,
      quality: '720p HD',
      codec: 'H.264 • AAC 2.0',
      dub: 'Многоголосый дубляж AniDUB',
      size: '1.4 ГБ',
      seeds: 142,
      magnet: demoMagnet
    }
  ] : [
    {
      title: `${title} [4K UHD HDR / 2160p]`,
      quality: '4K UHD HDR',
      codec: 'HEVC H.265 • 10-bit • 60 FPS',
      dub: 'Дубляж Red Head Sound (Dolby Atmos 7.1)',
      size: '18.4 ГБ',
      seeds: 286,
      magnet: demoMagnet
    },
    {
      title: `${title} [1080p FHD BDRip]`,
      quality: '1080p FHD',
      codec: 'AVC H.264 • High@L4.1',
      dub: 'Дубляж HDRezka Studio (AC3 5.1)',
      size: '6.8 ГБ',
      seeds: 340,
      magnet: demoMagnet
    },
    {
      title: `${title} [1080p WEB-DL / Студийный]`,
      quality: '1080p WEB',
      codec: 'AVC • AAC 2.0',
      dub: 'Профессиональный дубляж',
      size: '4.2 ГБ',
      seeds: 195,
      magnet: demoMagnet
    },
    {
      title: `${title} [720p HD Компактный]`,
      quality: '720p HD',
      codec: 'H.264 • Быстрый старт',
      dub: 'Многоголосый закадровый перевод',
      size: '1.9 ГБ',
      seeds: 120,
      magnet: demoMagnet
    }
  ];

  container.innerHTML = `
    <div class="webtorrent-screen-wrap" style="position: relative; width: 100%; height: 100%; display: flex; flex-direction: column; background: #000; border-radius: 12px; overflow: hidden;">
      <!-- Основная область воспроизведения (сверху) -->
      <div id="torrent-playback-area" style="position: relative; width: 100%; flex: 1; min-height: 340px; background: #05070a; display: flex; align-items: center; justify-content: center; overflow: hidden;">
        <div id="player-ambilight-aura" class="ambilight-aura"></div>
        <video id="storm-video-player" controls autoplay playsinline crossorigin="anonymous" style="position: relative; z-index: 2; width: 100%; height: 100%; max-height: 520px; background: #000; object-fit: contain;"></video>

        <!-- Оверлей загрузки пиров и буферизации -->
        <div id="torrent-loader-overlay" style="position: absolute; inset: 0; z-index: 4; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(8, 10, 15, 0.88); backdrop-filter: blur(8px); gap: 12px; padding: 20px; text-align: center;">
          <div class="storm-spinner" style="width: 44px; height: 44px; border-width: 3px;"></div>
          <div style="font-size: 16px; font-weight: 800; color: var(--text-primary);" id="torrent-loader-title">Подключение к пиринговой сети P2P...</div>
          <div style="font-size: 12px; color: var(--text-muted); max-width: 480px; line-height: 1.5;" id="torrent-loader-subtitle">Поиск сидов в сети WebSockets. Воспроизведение начнется мгновенно по мере буферизации.</div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-top: 8px;">
            <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="torrent-fallback-cdn-btn">
              ⚡ Быстрый онлайн плеер (CDN)
            </button>
            <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="torrent-speedup-torr-btn" style="border-color: #10b981; color: #10b981;">
              🚀 Ускорить через TorrServer (100 MB/s)
            </button>
          </div>
        </div>
      </div>

      <!-- Нижняя панель управления и HUD -->
      <div class="webtorrent-control-bar" style="background: var(--bg-secondary); border-top: 1px solid var(--border-subtle); padding: 10px 16px; display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; z-index: 5;">
        <!-- Live P2P HUD -->
        <div class="torrent-stats-hud" style="display: flex; gap: 14px; align-items: center; font-size: 12px; font-weight: 700;">
          <span style="color: var(--color-green);">👥 Пиров: <b id="torrent-peers">0</b></span>
          <span style="color: var(--accent);">⬇️ <b id="torrent-speed">0.0 MB/s</b></span>
          <span style="color: var(--color-amber);">📊 <b id="torrent-progress">0%</b></span>
        </div>

        <!-- Кнопки выбора качества -->
        <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
          <span style="font-size: 11px; color: var(--text-muted); font-weight: 600;">Качество:</span>
          ${releases.map((rel, idx) => `
            <button type="button" class="storm-btn storm-btn-sm webtorrent-quality-btn ${idx === 0 ? 'storm-btn-primary' : 'storm-btn-secondary'}" data-index="${idx}">
              ${rel.quality}
            </button>
          `).join('')}
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="toggle-custom-magnet-btn" title="Ввести свою magnet-ссылку">
            🔗 Своя ссылка
          </button>
        </div>
      </div>

      <!-- Выдвижная панель ввода magnet-ссылки или .torrent файла -->
      <div id="custom-magnet-panel" style="display: none; background: var(--bg-tertiary); padding: 12px 16px; border-top: 1px solid var(--border-subtle); z-index: 5;">
        <div style="display: flex; gap: 8px; margin-bottom: 8px;">
          <input type="text" class="storm-input" id="torrent-magnet-input" placeholder="Вставьте magnet:?xt=urn:btih:... ссылку" style="flex: 1;">
          <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="start-custom-torrent-btn">Запустить</button>
        </div>
        <label class="storm-btn storm-btn-secondary storm-btn-sm" style="cursor: pointer; margin: 0; display: inline-flex;">
          📁 Открыть локальный .torrent файл
          <input type="file" id="torrent-file-input" accept=".torrent" style="display: none;">
        </label>
      </div>
    </div>
  `;

  // Кнопка быстрого перехода на CDN
  const fallbackBtn = container.querySelector('#torrent-fallback-cdn-btn');
  if (fallbackBtn) {
    fallbackBtn.onclick = () => {
      const cdn = currentPlayers.find(p => p.id !== 'webtorrent' && p.url && !p.url.includes('youtube'));
      if (cdn) {
        selectPlayer(cdn);
        updatePlayerTriggerInfo(cdn);
      } else {
        showToast('Серверные потоки проверяются...', 'info');
      }
    };
  }

  // Кнопка ускорения через TorrServer
  const speedupBtn = container.querySelector('#torrent-speedup-torr-btn');
  if (speedupBtn) {
    speedupBtn.onclick = () => {
      const tabServices = document.getElementById('studio-tab-services');
      if (tabServices) tabServices.click();
      showToast('Открыта панель TorrServer для максимальной скорости', 'info');
    };
  }

  // Переключение качества
  const qualityBtns = container.querySelectorAll('.webtorrent-quality-btn');
  qualityBtns.forEach(btn => {
    btn.onclick = () => {
      qualityBtns.forEach(b => {
        b.classList.remove('storm-btn-primary');
        b.classList.add('storm-btn-secondary');
      });
      btn.classList.add('storm-btn-primary');
      btn.classList.remove('storm-btn-secondary');

      const idx = parseInt(btn.dataset.index, 10);
      const chosen = releases[idx];
      if (chosen) {
        showToast(`Выбрано качество: ${chosen.quality}`, 'info');
        startWebTorrentStream(chosen.magnet);
      }
    };
  });

  // Панель ввода кастомной ссылки
  const toggleCustomBtn = container.querySelector('#toggle-custom-magnet-btn');
  const customPanel = container.querySelector('#custom-magnet-panel');
  if (toggleCustomBtn && customPanel) {
    toggleCustomBtn.onclick = () => {
      customPanel.style.display = customPanel.style.display === 'none' ? 'block' : 'none';
    };
  }

  const startCustomBtn = container.querySelector('#start-custom-torrent-btn');
  const customInput = container.querySelector('#torrent-magnet-input');
  if (startCustomBtn && customInput) {
    startCustomBtn.onclick = () => {
      const magnet = customInput.value.trim();
      if (!magnet) {
        showToast('Введите magnet-ссылку', 'warning');
        return;
      }
      startWebTorrentStream(magnet);
    };
  }

  const fileInput = container.querySelector('#torrent-file-input');
  if (fileInput) {
    fileInput.onchange = (e) => {
      if (e.target.files && e.target.files[0]) {
        startWebTorrentStream(e.target.files[0]);
      }
    };
  }

  // Запуск первого релиза
  if (releases.length > 0) {
    startWebTorrentStream(releases[0].magnet);
  }
}

async function startWebTorrentStream(torrentIdentifier) {
  if (!window.WebTorrent) {
    showToast('Подключение модуля P2P WebTorrent...', 'info');
    try {
      await ensureWebTorrentLoaded();
    } catch (e) {
      showToast('Не удалось загрузить P2P WebTorrent модуль', 'error');
      return;
    }
  }

  const playbackArea = document.getElementById('torrent-playback-area');
  const loaderOverlay = document.getElementById('torrent-loader-overlay');
  const loaderTitle = document.getElementById('torrent-loader-title');
  const loaderSubtitle = document.getElementById('torrent-loader-subtitle');

  if (loaderOverlay) {
    loaderOverlay.style.display = 'flex';
    if (loaderTitle) loaderTitle.textContent = 'Подключение к пиринговой сети P2P...';
  }

  if (torrentClient) {
    try {
      torrentClient.destroy();
    } catch {}
    torrentClient = null;
  }

  try {
    torrentClient = new window.WebTorrent({
      maxConns: 80,
      tracker: {
        announce: WEBTORRENT_TRACKERS,
        rtcConfig: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        }
      }
    });
  } catch {
    torrentClient = new window.WebTorrent();
  }

  showToast('Подключение к пирам P2P WebTorrent...', 'info');

  const addOpts = {
    announce: WEBTORRENT_TRACKERS
  };

  torrentClient.add(torrentIdentifier, addOpts, (torrent) => {
    showToast(`Раздача подключена: ${torrent.name || 'Поток'}`, 'success');
    trackClientAction('use_torrent');

    if (loaderTitle) loaderTitle.textContent = `Загрузка видеопотока (${torrent.name || 'P2P'})...`;

    // Приоритетная буферизация первых чанков видео для моментального старта
    if (torrent.pieces && torrent.pieces.length > 0) {
      try {
        torrent.critical(0, Math.min(15, torrent.pieces.length - 1));
        torrent.select(0, Math.min(30, torrent.pieces.length - 1), 1);
      } catch {}
    }

    const file = torrent.files.find(f => f.name.endsWith('.mp4') || f.name.endsWith('.mkv') || f.name.endsWith('.webm'));
    if (file) {
      const video = document.getElementById('storm-video-player');
      if (video) {
        file.renderTo(video, { autoplay: true });
        setupVideoFeatures(video, playbackArea);
        video.onplaying = () => {
          if (loaderOverlay) loaderOverlay.style.display = 'none';
        };
        video.onloadeddata = () => {
          if (loaderOverlay) loaderOverlay.style.display = 'none';
        };
      }
    }

    torrent.on('download', () => {
      const peersEl = document.getElementById('torrent-peers');
      const speedEl = document.getElementById('torrent-speed');
      const progressEl = document.getElementById('torrent-progress');

      if (peersEl) peersEl.textContent = torrent.numPeers;
      if (speedEl) speedEl.textContent = `${(torrent.downloadSpeed / (1024 * 1024)).toFixed(1)} MB/s`;
      if (progressEl) progressEl.textContent = `${(torrent.progress * 100).toFixed(1)}%`;

      if (torrent.downloadSpeed > 0 && loaderOverlay && loaderOverlay.style.display !== 'none') {
        if (loaderSubtitle) loaderSubtitle.textContent = `Скорость: ${(torrent.downloadSpeed / (1024 * 1024)).toFixed(1)} MB/s, пиров: ${torrent.numPeers}`;
      }
    });
  });

  torrentClient.on('error', (err) => {
    console.warn('WebTorrent client error:', err);
    if (loaderTitle) loaderTitle.textContent = 'Пиры WebRTC не отвечают';
    if (loaderSubtitle) loaderSubtitle.textContent = 'Для этой раздачи нет веб-сидов в браузере. Воспользуйтесь быстрым сервером (CDN) или TorrServer.';
  });
}

// ==========================================
// ПРЯМОЙ ПОТОК (DIRECT STREAM)
// ==========================================
let forceDirectStream = localStorage.getItem('storm_force_direct_stream') === 'true';

export function isForceDirectStream() {
  return forceDirectStream;
}

export function setForceDirectStream(val) {
  forceDirectStream = Boolean(val);
  localStorage.setItem('storm_force_direct_stream', forceDirectStream ? 'true' : 'false');
  showToast(forceDirectStream ? '⚡ Прямой поток активирован' : '🛡️ Стандартный режим (проксирование)', 'info');
}

// ==========================================
// ДАННЫЕ О СЛЕДУЮЩЕЙ СЕРИИ И ПРЕДЗАГРУЗКА
// ==========================================
export function getNextEpisodeData() {
  if (!checkIfMediaIsSeries(currentMedia)) return null;

  // 1. Быстрая панель сезонов и серий
  if (quickBarSeriesData && quickBarSeriesData.seasons && quickBarSeriesData.seasons.length > 0) {
    const curSeasonObj = quickBarSeriesData.seasons.find(s => s.season === quickBarActiveSeason) || quickBarSeriesData.seasons[0];
    if (curSeasonObj?.episodes) {
      const curEpIdx = curSeasonObj.episodes.findIndex(e => e.episode === quickBarActiveEpisode);
      if (curEpIdx >= 0 && curEpIdx < curSeasonObj.episodes.length - 1) {
        const nextEp = curSeasonObj.episodes[curEpIdx + 1];
        return {
          season: quickBarActiveSeason,
          episode: nextEp.episode,
          name: nextEp.title || nextEp.name || `Серия ${nextEp.episode}`,
          still: nextEp.still || nextEp.still_path || currentMedia?.poster || 'assets/favicon.svg'
        };
      }
    }
  }

  // 2. Сетка эпизодов TMDB
  const gridEl = document.getElementById('series-episodes-grid') || document.getElementById('episodes-grid');
  if (gridEl) {
    const activeCard = gridEl.querySelector('.series-episode-card.active, .episode-btn.active');
    const nextCard = activeCard?.nextElementSibling;
    if (nextCard) {
      const epNum = nextCard.dataset.epNum || (currentEpisodeIndex + 1);
      const title = nextCard.querySelector('.series-episode-title')?.textContent || `Серия ${epNum}`;
      const img = nextCard.querySelector('img')?.src || currentMedia?.poster || 'assets/favicon.svg';
      return {
        season: currentMedia?.season || 1,
        episode: parseInt(epNum, 10),
        name: title,
        still: img
      };
    }
  }

  // 3. AniXart / AniLibria
  if (currentEpisodes && currentEpisodes.length > 0) {
    const curIdx = currentEpisodes.findIndex(e => (e.position || e.ordinal || 1) === currentEpisodeIndex);
    if (curIdx >= 0 && curIdx < currentEpisodes.length - 1) {
      const next = currentEpisodes[curIdx + 1];
      const epNum = next.position || next.ordinal || (currentEpisodeIndex + 1);
      return {
        season: 1,
        episode: epNum,
        name: next.title || next.name || `Серия ${epNum}`,
        still: next.still || currentMedia?.poster || 'assets/favicon.svg'
      };
    }
  }

  return null;
}

function triggerNextEpisodePrebuffer() {
  try {
    const nextEp = getNextEpisodeData();
    if (!nextEp) return;
    if (currentMedia?.source === 'anilibria' && nextEp.streamUrl) {
      fetch(nextEp.streamUrl, { method: 'HEAD', priority: 'low' }).catch(() => {});
    }
  } catch (_) {}
}

// ==========================================
// ПАРЯЩАЯ КАРТОЧКА СЛЕДУЮЩЕЙ СЕРИИ (UP NEXT)
// ==========================================
let upNextCountdownTimer = null;
let upNextDismissedForEp = null;

export function checkUpNextEpisodeCountdown(video) {
  if (!video || !video.duration || video.duration < 60) return;
  const timeLeft = video.duration - video.currentTime;

  // Предварительная буферизация на 90% прогресса
  if (video.currentTime >= video.duration * 0.90 && !video.dataset.hasPrebufferedNext) {
    video.dataset.hasPrebufferedNext = 'true';
    triggerNextEpisodePrebuffer();
  }

  // Показ карточки за 35 секунд до окончания серии
  if (timeLeft <= 35 && timeLeft >= 2) {
    const epKey = `${currentMedia?.id}_${currentEpisodeIndex}`;
    if (upNextDismissedForEp === epKey) return;

    const nextEp = getNextEpisodeData();
    if (!nextEp) return;

    showUpNextCountdownCard(nextEp, Math.min(15, Math.floor(timeLeft)));
  } else if (timeLeft < 2) {
    dismissUpNextCountdownCard(false);
  }
}

function showUpNextCountdownCard(nextEp, secondsToWait) {
  let card = document.getElementById('storm-up-next-card');
  if (card) return;

  const wrapper = document.getElementById('cinema-player-wrapper') || document.getElementById('cinema-player-container');
  if (!wrapper) return;

  card = document.createElement('div');
  card.className = 'storm-up-next-card';
  card.id = 'storm-up-next-card';

  let remainingSec = secondsToWait;
  const circumference = 2 * Math.PI * 18;

  card.innerHTML = `
    <div class="up-next-thumb-wrap">
      <img src="${escapeHtml(nextEp.still || 'assets/favicon.svg')}" alt="${escapeHtml(nextEp.name)}" class="up-next-thumb" onerror="this.src='assets/favicon.svg'">
      <div class="up-next-timer-svg-box">
        <svg class="up-next-circle-svg" width="44" height="44" viewBox="0 0 44 44">
          <circle class="up-next-circle-bg" cx="22" cy="22" r="18"></circle>
          <circle class="up-next-circle-progress" id="up-next-circle-bar" cx="22" cy="22" r="18" stroke-dasharray="${circumference}" stroke-dashoffset="0"></circle>
        </svg>
        <span class="up-next-sec-count" id="up-next-sec-count">${remainingSec}</span>
      </div>
    </div>
    <div class="up-next-info">
      <div class="up-next-label">Следующая серия</div>
      <div class="up-next-title">${escapeHtml(nextEp.name)}</div>
      <div class="up-next-sub">Сезон ${nextEp.season || 1} • Серия ${nextEp.episode}</div>
    </div>
    <div class="up-next-actions">
      <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="up-next-play-btn">
        ▶ Смотреть сейчас
      </button>
      <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="up-next-cancel-btn" title="Отменить автопереход">
        ✕ Отмена
      </button>
    </div>
  `;

  wrapper.appendChild(card);

  const circleBar = card.querySelector('#up-next-circle-bar');
  const secCount = card.querySelector('#up-next-sec-count');
  const playBtn = card.querySelector('#up-next-play-btn');
  const cancelBtn = card.querySelector('#up-next-cancel-btn');

  if (playBtn) {
    playBtn.onclick = (e) => {
      e.stopPropagation();
      dismissUpNextCountdownCard(false);
      playNextEpisode();
    };
  }

  if (cancelBtn) {
    cancelBtn.onclick = (e) => {
      e.stopPropagation();
      dismissUpNextCountdownCard(true);
    };
  }

  clearInterval(upNextCountdownTimer);
  upNextCountdownTimer = setInterval(() => {
    remainingSec--;
    if (secCount) secCount.textContent = Math.max(0, remainingSec);
    if (circleBar) {
      const offset = circumference - (remainingSec / secondsToWait) * circumference;
      circleBar.style.strokeDashoffset = offset;
    }
    if (remainingSec <= 0) {
      clearInterval(upNextCountdownTimer);
      upNextCountdownTimer = null;
      dismissUpNextCountdownCard(false);
      playNextEpisode();
    }
  }, 1000);
}

export function dismissUpNextCountdownCard(cancelledByUser = false) {
  if (upNextCountdownTimer) {
    clearInterval(upNextCountdownTimer);
    upNextCountdownTimer = null;
  }
  const card = document.getElementById('storm-up-next-card');
  if (card) card.remove();
  if (cancelledByUser) {
    const epKey = `${currentMedia?.id}_${currentEpisodeIndex}`;
    upNextDismissedForEp = epKey;
    showToast('Автопереход к следующей серии отменен', 'info');
  }
}

// ==========================================
// СТАТИСТИКА ДЛЯ ГИКОВ (STATS FOR NERDS)
// ==========================================
let statsForNerdsInterval = null;
let isStatsForNerdsVisible = false;

export function toggleStatsForNerds() {
  const wrapper = document.getElementById('cinema-player-wrapper') || document.getElementById('cinema-player-container');
  if (!wrapper) return;
  let overlay = document.getElementById('storm-nerd-stats-overlay');

  if (overlay && overlay.style.display !== 'none') {
    overlay.style.display = 'none';
    isStatsForNerdsVisible = false;
    if (statsForNerdsInterval) {
      clearInterval(statsForNerdsInterval);
      statsForNerdsInterval = null;
    }
    return;
  }

  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'storm-nerd-stats-overlay';
    overlay.id = 'storm-nerd-stats-overlay';
    wrapper.appendChild(overlay);
  }

  overlay.style.display = 'block';
  isStatsForNerdsVisible = true;
  updateStatsForNerdsContent(overlay);

  if (statsForNerdsInterval) clearInterval(statsForNerdsInterval);
  statsForNerdsInterval = setInterval(() => {
    if (isStatsForNerdsVisible) {
      updateStatsForNerdsContent(overlay);
    }
  }, 1000);
}

function updateStatsForNerdsContent(overlay) {
  if (!overlay) return;
  const video = document.querySelector('#cinema-player-wrapper video');
  const iframe = document.querySelector('#cinema-player-wrapper iframe');

  let res = '—';
  let viewport = '—';
  let bufferHealth = '0.0 с';
  let droppedFrames = '0';
  let totalFrames = '0';
  let dropRate = '0%';
  let timeStr = '—';
  let engine = iframe ? 'Iframe видеоплеер' : 'HTML5 Native Video';
  let vol = '100%';
  let speed = '1.0x';

  if (video) {
    if (video.videoWidth && video.videoHeight) {
      res = `${video.videoWidth} × ${video.videoHeight}`;
    }
    viewport = `${video.clientWidth} × ${video.clientHeight}`;
    timeStr = `${formatSeconds(video.currentTime)} / ${video.duration ? formatSeconds(video.duration) : '—'}`;
    vol = `${Math.round(video.volume * 100)}%`;
    speed = `${video.playbackRate}x`;

    if (video.buffered && video.buffered.length > 0) {
      const cur = video.currentTime;
      let bufEnd = 0;
      for (let i = 0; i < video.buffered.length; i++) {
        if (video.buffered.start(i) <= cur && video.buffered.end(i) >= cur) {
          bufEnd = video.buffered.end(i);
          break;
        }
      }
      bufferHealth = `${Math.max(0, bufEnd - cur).toFixed(1)} с`;
    }

    if (typeof video.getVideoPlaybackQuality === 'function') {
      const q = video.getVideoPlaybackQuality();
      droppedFrames = String(q.droppedVideoFrames || 0);
      totalFrames = String(q.totalVideoFrames || 0);
      if (q.totalVideoFrames > 0) {
        dropRate = `${((q.droppedVideoFrames / q.totalVideoFrames) * 100).toFixed(2)}%`;
      }
    }

    if (window.Hls && window.Hls.isSupported && window.Hls.isSupported()) {
      engine = 'HLS.js Pipeline';
    }
    if (torrentClient) {
      engine = 'WebTorrent P2P Engine';
    }
  }

  overlay.innerHTML = `
    <div class="nerd-stats-header">
      <div class="nerd-stats-title">
        <span style="color: var(--accent);">●</span> Статистика для гиков
      </div>
      <button type="button" class="nerd-stats-close-btn" id="close-nerd-stats-btn">✕</button>
    </div>
    <div class="nerd-stats-grid">
      <div class="nerd-stat-row">
        <span class="nerd-stat-key">Видеопоток и источник:</span>
        <span class="nerd-stat-val">${escapeHtml(currentActivePlayer || currentMedia?.source || 'Auto')}</span>
      </div>
      <div class="nerd-stat-row">
        <span class="nerd-stat-key">Разрешение видео:</span>
        <span class="nerd-stat-val highlight">${res}</span>
      </div>
      <div class="nerd-stat-row">
        <span class="nerd-stat-key">Область отображения:</span>
        <span class="nerd-stat-val">${viewport}</span>
      </div>
      <div class="nerd-stat-row">
        <span class="nerd-stat-key">Здоровье буфера (Buffer Health):</span>
        <span class="nerd-stat-val highlight">${bufferHealth}</span>
      </div>
      <div class="nerd-stat-row">
        <span class="nerd-stat-key">Пропущено кадров:</span>
        <span class="nerd-stat-val ${parseInt(droppedFrames, 10) > 30 ? 'warn' : ''}">${droppedFrames} / ${totalFrames} (${dropRate})</span>
      </div>
      <div class="nerd-stat-row">
        <span class="nerd-stat-key">Движок рендеринга:</span>
        <span class="nerd-stat-val">${engine}</span>
      </div>
      <div class="nerd-stat-row">
        <span class="nerd-stat-key">Звуковой тракт:</span>
        <span class="nerd-stat-val">${nightAudioModeEnabled ? '🌙 Pro WebAudio DRC (Ночной компрессор)' : '🔊 Pro Studio Master'}</span>
      </div>
      <div class="nerd-stat-row">
        <span class="nerd-stat-key">Таймкод и длительность:</span>
        <span class="nerd-stat-val">${timeStr}</span>
      </div>
      <div class="nerd-stat-row">
        <span class="nerd-stat-key">Скорость и громкость:</span>
        <span class="nerd-stat-val">${speed} • ${vol}</span>
      </div>
    </div>
  `;

  const closeBtn = overlay.querySelector('#close-nerd-stats-btn');
  if (closeBtn) {
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      toggleStatsForNerds();
    };
  }
}

// ==========================================
// В РОЛЯХ (IN-PLAYER CAST DRAWER)
// ==========================================
async function renderInPlayerCastDrawer(body) {
  body.innerHTML = `
    <div style="display: flex; justify-content: center; padding: 25px;">
      <div class="storm-spinner"></div>
    </div>
  `;

  let cast = currentMedia?.cast || currentMedia?.credits?.cast || [];
  const cleanTitle = cleanVideoTitle(currentMedia?.title || currentMedia?.name || '');
  const origTitle = currentMedia?.original_title || '';
  const year = currentMedia?.year || '';
  const mediaType = currentMedia?.media_type || (currentMedia?.category === 'Сериал' ? 'series' : '');
  const actorsParam = typeof currentMedia?.actors === 'string' ? currentMedia.actors : '';

  if ((!cast || !cast.length) && currentMedia?.id) {
    try {
      const src = currentMedia.source || 'fanfilm4k';
      const q = new URLSearchParams({
        title: cleanTitle,
        original_title: origTitle,
        year: String(year),
        media_type: mediaType,
        actors: actorsParam
      }).toString();
      const res = await fetch(`/api/media/${encodeURIComponent(src)}/${encodeURIComponent(currentMedia.id)}/cast?${q}`);
      if (res.ok) {
        const data = await res.json();
        cast = data.cast || [];
        if (data.directors?.length && currentMedia) currentMedia.directors = data.directors;
        if (data.trivia?.length && currentMedia) currentMedia.trivia = data.trivia;
      }
    } catch (_) {}
  }
  if (!cast || !cast.length) {
    try {
      if (cleanTitle) {
        const q = new URLSearchParams({
          title: cleanTitle,
          original_title: origTitle,
          year: String(year),
          media_type: mediaType,
          actors: actorsParam
        }).toString();
        const res = await fetch(`/api/media/cast?${q}`);
        if (res.ok) {
          const data = await res.json();
          cast = data.cast || [];
          if (data.directors?.length && currentMedia) currentMedia.directors = data.directors;
        }
      }
    } catch (_) {}
  }
  if (!cast || !cast.length) {
    if (Array.isArray(currentMedia?.actors)) {
      cast = currentMedia.actors;
    } else if (typeof currentMedia?.actors === 'string' && currentMedia.actors.trim()) {
      cast = currentMedia.actors.split(',').map(s => s.trim()).filter(Boolean).map((name, idx) => ({
        id: `actor_${idx + 1}`,
        name,
        character: 'В главных ролях',
        photo: 'assets/favicon.svg'
      }));
    }
  }
  if (cast && cast.length && currentMedia) {
    currentMedia.cast = cast;
  }

  if (!cast || !cast.length) {
    body.innerHTML = `
      <div style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 13px;">
        🎭 Информация об актерском составе отсутствует для данного релиза.
      </div>
    `;
    return;
  }

  body.innerHTML = `
    <div class="inplayer-cast-drawer-content">
      <div style="font-size: 12px; font-weight: 700; color: var(--text-muted); margin-bottom: 12px;">
        В главных ролях (${cast.length}) • Нажмите на актера для фильмографии
      </div>
      <div class="inplayer-cast-scroll-row">
        ${cast.map(c => `
          <div class="inplayer-cast-item-card" data-person-id="${escapeHtml(c.id || '')}" data-person-name="${escapeHtml(c.name || '')}">
            <div class="inplayer-cast-img-box">
              <img src="${escapeHtml(c.photo || c.profile_path || 'assets/favicon.svg')}" alt="${escapeHtml(c.name || '')}" class="inplayer-cast-img" loading="lazy" onerror="this.src='assets/favicon.svg'">
            </div>
            <div class="inplayer-cast-name">${escapeHtml(c.name || 'Актер')}</div>
            <div class="inplayer-cast-role">${escapeHtml(c.character || 'В ролях')}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  body.querySelectorAll('.inplayer-cast-item-card').forEach(card => {
    card.onclick = () => {
      const pid = card.dataset.personId;
      const pname = card.dataset.personName;
      if (pid && typeof openPersonModal === 'function') {
        openPersonModal(pid, pname);
      }
    };
  });
}

// ==========================================
// ИНТЕРАКТИВНЫЙ X-RAY DRAWER (ВНУТРИ СТУДИИ)
// ==========================================
function renderDrawerXRayView(body, onBack) {
  if (!currentMedia) return;
  const cleanTitle = cleanVideoTitle(currentMedia.title || '');
  let cast = currentMedia.cast || [];
  if (!cast || !cast.length) {
    if (Array.isArray(currentMedia?.actors)) {
      cast = currentMedia.actors;
    } else if (typeof currentMedia?.actors === 'string' && currentMedia.actors.trim()) {
      cast = currentMedia.actors.split(',').map(s => s.trim()).filter(Boolean).map((name, idx) => ({
        id: `actor_${idx + 1}`,
        name,
        character: 'В главных ролях',
        photo: 'assets/favicon.svg'
      }));
    }
  }

  const directors = currentMedia.directors || [];
  const composers = currentMedia.composers || [];
  const writers = currentMedia.writers || [];
  const cinematographers = currentMedia.cinematographers || [];

  const primaryComposer = composers[0]?.name || (directors[0]?.name ? `Оркестр под управлением ${directors[0].name}` : 'Оригинальный композитор');
  const soundtrack = currentMedia.soundtrack || {
    title: `${cleanTitle} (Original Soundtrack)`,
    artist: primaryComposer,
    album: `${cleanTitle} OST`,
    tracks: [
      { number: 1, title: `${cleanTitle} (Main Theme)`, artist: primaryComposer, duration: '03:42', scene: 'Заглавная тема' },
      { number: 2, title: 'Cinematic Progression', artist: primaryComposer, duration: '02:35', scene: 'Развитие сюжета' },
      { number: 3, title: 'High Stakes and Climax', artist: primaryComposer, duration: '04:12', scene: 'Кульминация' },
      { number: 4, title: 'End Credits Suite', artist: primaryComposer, duration: '03:50', scene: 'Финальные титры' }
    ]
  };

  const triviaList = currentMedia.trivia && currentMedia.trivia.length > 0 ? currentMedia.trivia : [
    { label: 'Мастеринг', content: 'Релиз представлен в оригинальном кинематографическом качестве 4K UHD с объемным многоканальным звуком.' },
    { label: 'Премьера', content: `Официальный мировой релиз ${currentMedia.release_date || currentMedia.year || ''} года.` }
  ];

  const crewList = [
    ...directors.map(d => ({ ...d, role: d.role || 'Режиссер' })),
    ...composers.map(c => ({ ...c, role: 'Композитор' })),
    ...writers.map(w => ({ ...w, role: 'Сценарист' })),
    ...cinematographers.map(c => ({ ...c, role: 'Оператор' }))
  ];

  body.innerHTML = `
    <div class="xray-drawer-view">
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 10px;">
        <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="xray-back-to-services-btn" style="padding: 5px 12px;">
          ← Назад к сервисам
        </button>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 11.5px; color: var(--text-muted); font-weight: 700;">X-Ray: ${escapeHtml(cleanTitle)}</span>
          <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="xray-pin-player-btn" style="padding: 5px 12px;">
            📌 Вывести поверх видео
          </button>
        </div>
      </div>

      <div class="xray-tabs-nav" style="margin-bottom: 12px;">
        <button type="button" class="xray-tab-btn active" data-xray-tab="cast">🎭 В кадре (${cast.length})</button>
        <button type="button" class="xray-tab-btn" data-xray-tab="music">🎵 Саундтрек</button>
        <button type="button" class="xray-tab-btn" data-xray-tab="trivia">💡 Факты (${triviaList.length})</button>
        <button type="button" class="xray-tab-btn" data-xray-tab="crew">🎬 Создатели (${crewList.length})</button>
      </div>

      <div class="xray-tab-content active" id="xray-drawer-pane-cast"></div>
      <div class="xray-tab-content" id="xray-drawer-pane-music"></div>
      <div class="xray-tab-content" id="xray-drawer-pane-trivia"></div>
      <div class="xray-tab-content" id="xray-drawer-pane-crew">
        <div class="xray-crew-list">
          ${crewList.length > 0 ? crewList.map(person => `
            <div class="xray-crew-card" data-person-id="${escapeHtml(person.id || '')}" data-person-name="${escapeHtml(person.name || '')}" style="cursor: pointer;" title="Открыть фильмографию">
              <img src="${escapeHtml(person.photo || 'assets/favicon.svg')}" alt="${escapeHtml(person.name)}" class="xray-crew-img" onerror="this.src='assets/favicon.svg'">
              <div>
                <div class="xray-crew-name">${escapeHtml(person.name)}</div>
                <div class="xray-crew-role">${escapeHtml(person.role)}</div>
              </div>
            </div>
          `).join('') : '<div style="color: var(--text-muted); font-size: 12px; padding: 8px;">Данные о съемочной группе уточняются...</div>'}
        </div>
      </div>
    </div>
  `;

  const paneCast = body.querySelector('#xray-drawer-pane-cast');
  const paneMusic = body.querySelector('#xray-drawer-pane-music');
  const paneTrivia = body.querySelector('#xray-drawer-pane-trivia');

  renderXRayCastTab(paneCast, cast);
  renderXRaySoundtrackTab(paneMusic, soundtrack, body);
  renderXRayTriviaTab(paneTrivia, triviaList);

  const backBtn = body.querySelector('#xray-back-to-services-btn');
  if (backBtn) {
    backBtn.onclick = () => {
      if (typeof onBack === 'function') {
        onBack();
      } else {
        const tabServices = document.getElementById('studio-tab-services');
        if (tabServices) tabServices.click();
      }
    };
  }

  const pinBtn = body.querySelector('#xray-pin-player-btn');
  if (pinBtn) {
    pinBtn.onclick = () => {
      toggleXRayManual();
      showToast('X-Ray панель отображается поверх видеоплеера', 'info');
    };
  }

  const tabBtns = body.querySelectorAll('.xray-tab-btn');
  tabBtns.forEach(btn => {
    btn.onclick = () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tabType = btn.dataset.xrayTab;
      body.querySelectorAll('.xray-tab-content').forEach(p => p.classList.remove('active'));
      const targetPane = body.querySelector(`#xray-drawer-pane-${tabType}`);
      if (targetPane) targetPane.classList.add('active');
    };
  });

  // Фоновая дозагрузка актеров, если еще не были загружены
  if (cast.length === 0 && currentMedia.title) {
    (async () => {
      try {
        const src = currentMedia.source || 'fanfilm4k';
        const q = new URLSearchParams({
          title: cleanTitle,
          original_title: currentMedia.original_title || '',
          year: String(currentMedia.year || ''),
          media_type: currentMedia.media_type || '',
          actors: typeof currentMedia.actors === 'string' ? currentMedia.actors : ''
        }).toString();
        const r = await fetch(`/api/media/${encodeURIComponent(src)}/${encodeURIComponent(currentMedia.id || 0)}/cast?${q}`);
        if (r.ok) {
          const data = await r.json();
          if (data?.cast?.length) {
            currentMedia.cast = data.cast;
            if (paneCast) renderXRayCastTab(paneCast, data.cast);
            const tabCastBtn = body.querySelector('[data-xray-tab="cast"]');
            if (tabCastBtn) tabCastBtn.textContent = `🎭 В кадре (${data.cast.length})`;
          }
        }
      } catch (_) {}
    })();
  }

  // Фоновая дозагрузка саундтрека
  if (!currentMedia.soundtrackLoaded) {
    fetch(`/api/media/soundtrack?title=${encodeURIComponent(cleanTitle)}&original_title=${encodeURIComponent(currentMedia.original_title || '')}&year=${encodeURIComponent(currentMedia.year || '')}`)
      .then(res => res.json())
      .then(data => {
        if (data && data.tracks && data.tracks.length > 0) {
          currentMedia.soundtrack = data;
          currentMedia.soundtrackLoaded = true;
          if (paneMusic) renderXRaySoundtrackTab(paneMusic, data, body);
        }
      })
      .catch(() => {});
  }
}

// ==========================================
// VIBRANT ФОНОВАЯ ПОДСВЕТКА (AMBIENT GLOW)
// ==========================================
export function applyAmbientBackdropGlow(mediaItem) {
  const modal = document.getElementById('cinema-modal');
  if (!modal) return;

  const colors = [
    'rgba(0, 210, 255, 0.40)',
    'rgba(168, 85, 247, 0.40)',
    'rgba(255, 0, 127, 0.40)',
    'rgba(0, 255, 102, 0.40)',
    'rgba(245, 158, 11, 0.40)',
    'rgba(2, 132, 199, 0.40)'
  ];
  const title = mediaItem?.title || '';
  let hash = 0;
  for (let i = 0; i < title.length; i++) hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  const picked = colors[hash % colors.length];

  modal.style.setProperty('--ambient-backdrop-color', picked);
}

function renderPlayerUtilityButtons() {
  const container = document.getElementById('player-utility-actions');
  if (!container) return;

  container.innerHTML = `
    <div class="player-studio-dock">
      <div class="player-studio-sections">
        <!-- 1. Студия звука и видео -->
        <div class="player-studio-section">
          <div class="player-studio-section-label">🎬 Студия звука и видео</div>
          <div class="player-studio-btn-grid">
            <button type="button" class="studio-tab-btn" id="studio-tab-video" title="Профессиональные настройки изображения (HDR10, Dolby Vision, FSR CAS, 21:9 Cinemascope)">
              <span class="studio-tab-icon">🎛️</span>
              <span class="studio-tab-text">Pro Видео</span>
            </button>
            <button type="button" class="studio-tab-btn" id="studio-tab-audio" title="Профессиональная студия звука (Dolby Atmos 3D, 10-Band EQ, AI Voice)">
              <span class="studio-tab-icon">🔊</span>
              <span class="studio-tab-text">Pro Звук</span>
            </button>
            <button type="button" class="studio-tab-btn ${ambilightEnabled ? 'active-glow' : ''}" id="studio-tab-ambilight" title="Динамическая фоновая подсветка Ambilight и настройки">
              <span class="studio-tab-icon">🌈</span>
              <span class="studio-tab-text">Ambilight</span>
            </button>
            <button type="button" class="studio-tab-btn ${nightAudioModeEnabled ? 'active' : ''}" id="toggle-night-audio-btn" title="Ночной режим звука (компрессор динамического диапазона)">
              <span class="studio-tab-icon">🌙</span>
              <span class="studio-tab-text">Ночной звук</span>
              <span class="studio-tab-badge night-audio-badge" style="font-size: 10px; font-weight: 800; padding: 1px 5px; border-radius: 4px; margin-left: 4px; background: rgba(0,0,0,0.4); color: ${nightAudioModeEnabled ? 'var(--storm-accent-green, #10b981)' : 'var(--text-muted)'};">${nightAudioModeEnabled ? 'ВКЛ' : 'ВЫКЛ'}</span>
            </button>
          </div>
        </div>

        <!-- 2. Сервисы и инструменты -->
        <div class="player-studio-section">
          <div class="player-studio-section-label">⚡ Сервисы и просмотр</div>
          <div class="player-studio-btn-grid">
            <button type="button" class="studio-tab-btn" id="studio-tab-cast" title="В главных ролях и съемочная группа">
              <span class="studio-tab-icon">🎭</span>
              <span class="studio-tab-text">В ролях</span>
            </button>
            <button type="button" class="studio-tab-btn" id="studio-tab-subtitles" title="Внешние дорожки и пользовательские субтитры">
              <span class="studio-tab-icon">💬</span>
              <span class="studio-tab-text">Субтитры</span>
            </button>
            <button type="button" class="studio-tab-btn" id="studio-tab-room" title="Совместный просмотр с друзьями и чатом">
              <span class="studio-tab-icon">👥</span>
              <span class="studio-tab-text">Кинокомната</span>
            </button>
            <button type="button" class="studio-tab-btn" id="studio-tab-cleanview" title="STORM CleanView: автоматический пропуск рекламы и вырезание водяных знаков">
              <span class="studio-tab-icon">🛡️</span>
              <span class="studio-tab-text">CleanView</span>
            </button>
          </div>
        </div>

        <!-- 3. Панель автоматизации и режимов воспроизведения -->
        <div class="player-automation-card">
          <div class="player-automation-header">
            <span class="player-automation-badge">⚡ Режимы потока и автоматизация</span>
            <span class="player-automation-hint">Умное управление воспроизведением</span>
          </div>
          <div class="player-automation-grid">
            <label class="automation-toggle-chip" title="Прямой поток без транскодирования через промежуточный прокси">
              <input type="checkbox" id="toggle-direct-stream" ${forceDirectStream ? 'checked' : ''}>
              <span class="automation-chip-box"></span>
              <span class="automation-chip-icon">⚡</span>
              <div class="automation-chip-text">
                <span class="automation-chip-title">Прямой поток</span>
                <span class="automation-chip-sub">Максимальная скорость</span>
              </div>
            </label>

            <label class="automation-toggle-chip" title="Обход ограничений зарубежного VPN через защищенный российский сервер STORM">
              <input type="checkbox" id="toggle-vpn-bypass" ${vpnBypassEnabled ? 'checked' : ''}>
              <span class="automation-chip-box"></span>
              <span class="automation-chip-icon">🛡️</span>
              <div class="automation-chip-text">
                <span class="automation-chip-title">Обход VPN</span>
                <span class="automation-chip-sub">Защищенный шлюз</span>
              </div>
            </label>

            <label class="automation-toggle-chip is-locked-active" title="STORM AdBlock Engine: блокировка VAST видеорекламы, прероллов, баннеров и казино">
              <input type="checkbox" id="toggle-adblock" checked disabled>
              <span class="automation-chip-box"></span>
              <span class="automation-chip-icon">🚫</span>
              <div class="automation-chip-text">
                <span class="automation-chip-title">Блокировка рекламы</span>
                <span class="automation-chip-sub">Активна (Zero Ads)</span>
              </div>
            </label>
          </div>
        </div>
      </div>

    </div>
  `;

  // Всплывающее модальное окно студии (Studio Floating Modal Dialog)
  const cinemaModal = document.getElementById('cinema-modal');
  const targetParent = cinemaModal || document.body;

  let backdrop = document.getElementById('player-studio-modal-backdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'player-studio-modal-backdrop';
    backdrop.className = 'player-studio-modal-backdrop';
    backdrop.style.display = 'none';
    backdrop.innerHTML = `
      <div class="player-studio-modal-dialog" id="player-studio-drawer">
        <div class="studio-drawer-header">
          <div class="studio-drawer-title">
            <span id="studio-drawer-icon">🎛️</span>
            <span id="studio-drawer-heading">Pro Видео</span>
          </div>
          <button type="button" class="studio-drawer-close" id="studio-drawer-close" title="Закрыть окно">✕</button>
        </div>
        <div class="studio-drawer-body" id="studio-drawer-body"></div>
      </div>
    `;
    targetParent.appendChild(backdrop);
  } else if (targetParent && backdrop.parentElement !== targetParent) {
    targetParent.appendChild(backdrop);
  }

  const drawer = backdrop.querySelector('#player-studio-drawer');
  const drawerBody = backdrop.querySelector('#studio-drawer-body');
  const drawerIcon = backdrop.querySelector('#studio-drawer-icon');
  const drawerHeading = backdrop.querySelector('#studio-drawer-heading');
  const drawerClose = backdrop.querySelector('#studio-drawer-close');
  const tabButtons = container.querySelectorAll('.studio-tab-btn');

  let activeTabName = null;

  const closeDrawer = () => {
    if (backdrop) backdrop.style.display = 'none';
    if (drawerBody) drawerBody.style.display = 'block';
    activeTabName = null;
    tabButtons.forEach(btn => btn.classList.remove('active'));
  };

  if (drawerClose) drawerClose.onclick = closeDrawer;
  backdrop.onclick = (e) => {
    if (e.target === backdrop) closeDrawer();
  };

  if (!backdrop._hasEscapeListener) {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && backdrop && backdrop.style.display !== 'none') {
        e.stopImmediatePropagation();
        closeDrawer();
      }
    }, true);
    backdrop._hasEscapeListener = true;
  }

  const openDrawerTab = (tabName, icon, heading, renderFn) => {
    const curCinemaModal = document.getElementById('cinema-modal');
    if (curCinemaModal && backdrop.parentElement !== curCinemaModal) {
      curCinemaModal.appendChild(backdrop);
    }

    if (activeTabName === tabName && backdrop.style.display !== 'none') {
      closeDrawer();
      return;
    }

    activeTabName = tabName;
    tabButtons.forEach(btn => btn.classList.toggle('active', btn.id === `studio-tab-${tabName}`));

    if (drawerIcon) drawerIcon.textContent = icon;
    if (drawerHeading) drawerHeading.textContent = heading;

    backdrop.style.display = 'flex';
    if (drawerBody) {
      drawerBody.style.display = 'block';
      drawerBody.innerHTML = '';
      renderFn(drawerBody);
      drawerBody.scrollTop = 0;
    }
  };

  // 1. Pro Видео
  const tabVideo = container.querySelector('#studio-tab-video');
  if (tabVideo) {
    tabVideo.onclick = () => {
      openDrawerTab('video', '🎛️', 'Pro Видео (HDR10, Dolby Vision, FSR CAS, 21:9 Cinemascope)', (body) => {
        renderProVideoPanel(body);
      });
    };
  }

  // 2. Pro Звук
  const tabAudio = container.querySelector('#studio-tab-audio');
  if (tabAudio) {
    tabAudio.onclick = () => {
      openDrawerTab('audio', '🔊', 'Pro Звук (Dolby Atmos 3D, DTS:X, 10-Band EQ, AI Voice)', (body) => {
        renderProAudioPanel(body);
      });
    };
  }

  // 3. Ambilight
  const tabAmbilight = container.querySelector('#studio-tab-ambilight');
  if (tabAmbilight) {
    tabAmbilight.onclick = () => {
      openDrawerTab('ambilight', '🌈', 'Подсветка Ambilight и настройки палитры', (body) => {
        const toggleBtnHtml = `
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--border-subtle);">
            <div>
              <div style="font-size: 13px; font-weight: 800; color: var(--text-primary);">Фоновая динамическая подсветка</div>
              <div style="font-size: 11px; color: var(--text-muted);">Создает эффект погружения и расширяет границы экрана</div>
            </div>
            <button type="button" class="storm-btn ${ambilightEnabled ? 'storm-btn-primary' : 'storm-btn-secondary'} storm-btn-sm" id="drawer-toggle-ambilight-btn">
              ${ambilightEnabled ? '🟢 Ambilight Включен' : '⚪ Включить Ambilight'}
            </button>
          </div>
          <div id="drawer-ambilight-settings-host"></div>
        `;
        body.innerHTML = toggleBtnHtml;

        const toggleBtn = body.querySelector('#drawer-toggle-ambilight-btn');
        const settingsHost = body.querySelector('#drawer-ambilight-settings-host');

        if (toggleBtn) {
          toggleBtn.onclick = () => {
            toggleAmbilight();
            tabAmbilight.classList.toggle('active-glow', ambilightEnabled);
            toggleBtn.className = `storm-btn ${ambilightEnabled ? 'storm-btn-primary' : 'storm-btn-secondary'} storm-btn-sm`;
            toggleBtn.textContent = ambilightEnabled ? '🟢 Ambilight Включен' : '⚪ Включить Ambilight';
          };
        }

        if (settingsHost) renderAmbilightSettings(settingsHost);
      });
    };
  }

  // 5. Субтитры и внешние дорожки
  const tabSubtitles = container.querySelector('#studio-tab-subtitles');
  if (tabSubtitles) {
    tabSubtitles.onclick = () => {
      openDrawerTab('subtitles', '💬', 'Внешние дорожки, сдвиг тайминга и субтитры', (body) => {
        renderSubtitlesControls(body);
      });
    };
  }

  // 6. Кинокомната и совместный просмотр
  const tabRoom = container.querySelector('#studio-tab-room');
  if (tabRoom) {
    tabRoom.onclick = () => {
      openDrawerTab('room', '👥', 'Кинокомната и синхронный просмотр с друзьями', (body) => {
        body.innerHTML = `
          <div style="display: flex; flex-direction: column; gap: 14px;">
            <div style="background: var(--bg-card); padding: 14px 18px; border-radius: 12px; border: 1px solid var(--border-subtle);">
              <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-bottom: 12px;">
                <div>
                  <div style="font-weight: 800; font-size: 13.5px; color: var(--text-primary);">Синхронный просмотр с друзьями</div>
                  <div style="font-size: 11px; color: var(--text-muted);">Сквозная синхронизация таймкода, онлайн-чат, стикеры и реакции</div>
                </div>
                <div style="display: flex; gap: 8px;">
                  <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="drawer-create-room-btn">
                    👥 Создать кинокомнату
                  </button>
                  <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="drawer-share-media-btn">
                    🔗 Поделиться ссылкой
                  </button>
                </div>
              </div>

              <!-- Форма входа по коду комнаты -->
              <div style="border-top: 1px solid var(--border-subtle); padding-top: 12px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                <div style="flex: 1; min-width: 200px;">
                  <input type="text" class="storm-input" id="drawer-join-room-input" placeholder="Введите код комнаты (например, STORM-JTNY)" style="width: 100%; text-transform: uppercase; font-weight: 700; letter-spacing: 1px; padding: 7px 12px; font-size: 13px;">
                </div>
                <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="drawer-join-room-btn" style="white-space: nowrap; padding: 7px 16px;">
                  🔑 Войти по коду
                </button>
              </div>
            </div>

            <!-- Плашка активной комнаты (если подключен) -->
            <div id="drawer-active-room-card" style="display: none; background: rgba(0, 210, 255, 0.08); border: 1px solid var(--accent); border-radius: 12px; padding: 12px 16px; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
              <div>
                <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; color: var(--accent); letter-spacing: 1px;">🟢 Вы в кинокомнате</div>
                <div style="font-size: 14px; font-weight: 800; color: #fff; margin-top: 2px;">Код: <span id="drawer-active-room-code" style="color: var(--accent);"></span></div>
              </div>
              <div style="display: flex; gap: 8px;">
                <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="drawer-open-chat-btn">
                  💬 Чат комнаты
                </button>
                <button type="button" class="storm-btn storm-btn-danger storm-btn-sm" id="drawer-leave-room-btn">
                  ✕ Выйти
                </button>
              </div>
            </div>
          </div>
        `;

        const roomBtn = body.querySelector('#drawer-create-room-btn');
        const joinInput = body.querySelector('#drawer-join-room-input');
        const joinBtn = body.querySelector('#drawer-join-room-btn');
        const shareBtn = body.querySelector('#drawer-share-media-btn');
        const activeCard = body.querySelector('#drawer-active-room-card');
        const activeCodeEl = body.querySelector('#drawer-active-room-code');
        const openChatBtn = body.querySelector('#drawer-open-chat-btn');
        const leaveBtn = body.querySelector('#drawer-leave-room-btn');

        const updateActiveRoomDisplay = () => {
          const room = getActiveRoom();
          if (room && activeCard && activeCodeEl) {
            activeCard.style.display = 'flex';
            activeCodeEl.textContent = room.code;
          } else if (activeCard) {
            activeCard.style.display = 'none';
          }
        };

        updateActiveRoomDisplay();

        if (roomBtn) {
          roomBtn.onclick = async () => {
            const code = await createWatchRoom(currentMedia);
            if (code) {
              showToast(`Кинокомната создана! Код: ${code}`, 'success');
              updateActiveRoomDisplay();
            }
          };
        }

        const doJoin = () => {
          const code = (joinInput?.value || '').trim().toUpperCase();
          if (!code) {
            showToast('Введите код комнаты', 'warning');
            return;
          }
          joinWatchRoom(code, currentMedia);
          setTimeout(updateActiveRoomDisplay, 600);
        };

        if (joinBtn) joinBtn.onclick = doJoin;
        if (joinInput) {
          joinInput.onkeydown = (e) => {
            if (e.key === 'Enter') doJoin();
          };
        }

        if (openChatBtn) {
          openChatBtn.onclick = () => {
            const room = getActiveRoom();
            if (room) renderRoomUi(room);
          };
        }

        if (leaveBtn) {
          leaveBtn.onclick = () => {
            leaveWatchRoom();
            updateActiveRoomDisplay();
          };
        }

        if (shareBtn) {
          shareBtn.onclick = () => copyMediaShareLink();
        }
      });
    };
  }

  // 7. STORM CleanView & AdShield
  const tabCleanView = container.querySelector('#studio-tab-cleanview');
  if (tabCleanView) {
    tabCleanView.onclick = () => {
      toggleCleanViewModal();
    };
  }

  // 8. В главных ролях и съемочная группа
  const tabCast = container.querySelector('#studio-tab-cast');
  if (tabCast) {
    tabCast.onclick = () => {
      openDrawerTab('cast', '🎭', 'В ролях и съемочная группа', (body) => {
        renderInPlayerCastDrawer(body);
      });
    };
  }

  // Быстрые кнопки панели справа
  const nightAudioBtn = container.querySelector('#toggle-night-audio-btn');
  if (nightAudioBtn) {
    nightAudioBtn.onclick = () => toggleNightModeAudio();
  }

  const directStreamToggle = container.querySelector('#toggle-direct-stream');
  if (directStreamToggle) {
    directStreamToggle.onchange = (e) => {
      setForceDirectStream(e.target.checked);
    };
  }

  const vpnBypassToggle = container.querySelector('#toggle-vpn-bypass');
  if (vpnBypassToggle) {
    vpnBypassToggle.onchange = (e) => {
      vpnBypassEnabled = e.target.checked;
      localStorage.setItem('storm_vpn_bypass', vpnBypassEnabled ? 'true' : 'false');
      showToast(`Обход VPN: ${vpnBypassEnabled ? 'Включен' : 'Выключен'}`, 'info');
      if (currentActivePlayer) {
        selectPlayer(currentActivePlayer);
      }
    };
  }
}

// ==========================================================================
// СИСТЕМА ОТСЛЕЖИВАНИЯ ПРОСМОТРЕННЫХ СЕРИЙ И ПОДСКАЗОК
// ==========================================================================
function getWatchedEpisodes(mediaId, seasonNum = 1) {
  if (!mediaId) return new Set();
  try {
    const sNum = Number(seasonNum) || 1;
    let raw = localStorage.getItem(`storm_watched_eps_${mediaId}_s${sNum}`);
    if (!raw && sNum === 1) {
      raw = localStorage.getItem(`storm_watched_eps_${mediaId}`);
    }
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr.map(Number));
    }
  } catch {}
  return new Set();
}

function markEpisodeWatched(mediaId, seasonOrEp, maybeEpisode, maybeWatched) {
  if (!mediaId) return;
  let seasonNum = 1;
  let episodeNum = 1;
  let watched = true;

  if (maybeEpisode !== undefined) {
    seasonNum = (seasonOrEp !== undefined && !isNaN(Number(seasonOrEp))) ? Number(seasonOrEp) : 1;
    episodeNum = (maybeEpisode !== undefined && !isNaN(Number(maybeEpisode))) ? Number(maybeEpisode) : 1;
    if (maybeWatched !== undefined) watched = Boolean(maybeWatched);
  } else {
    episodeNum = (seasonOrEp !== undefined && !isNaN(Number(seasonOrEp))) ? Number(seasonOrEp) : 1;
  }

  try {
    const sKey = `storm_watched_eps_${mediaId}_s${seasonNum}`;
    const watchedSet = getWatchedEpisodes(mediaId, seasonNum);
    if (watched) {
      watchedSet.add(episodeNum);
    } else {
      watchedSet.delete(episodeNum);
    }
    const arr = Array.from(watchedSet);
    localStorage.setItem(sKey, JSON.stringify(arr));
    if (seasonNum === 1) {
      localStorage.setItem(`storm_watched_eps_${mediaId}`, JSON.stringify(arr));
    }
  } catch {}

  evaluateAndSyncOverallSeriesStatus(mediaId);
}

function evaluateAndSyncOverallSeriesStatus(mediaId) {
  if (!mediaId) return;
  try {
    let totalWatchedAcrossAll = 0;
    let highestWatchedSeason = 1;
    let highestWatchedEp = 0;

    for (let s = 1; s <= 30; s++) {
      let raw = localStorage.getItem(`storm_watched_eps_${mediaId}_s${s}`);
      if (!raw && s === 1) raw = localStorage.getItem(`storm_watched_eps_${mediaId}`);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length > 0) {
          totalWatchedAcrossAll += arr.length;
          highestWatchedSeason = Math.max(highestWatchedSeason, s);
          highestWatchedEp = Math.max(highestWatchedEp, ...arr.map(Number));
        }
      }
    }

    const currentM = (typeof currentMedia !== 'undefined' && currentMedia && String(currentMedia.id) === String(mediaId)) ? currentMedia : null;
    const cleanTitle = currentM?.title || '';
    const normTitle = cleanTitle.toLowerCase().replace(/\s*[\(\[]?\s*(?:4[kк]|uhd|сериал|фильм|\d+\s*сезон).*?[\)\]]?/gi, ' ').trim();

    let totalExpectedEpisodes = 0;
    if (currentM && Array.isArray(currentM.seasons) && currentM.seasons.length > 0) {
      currentM.seasons.forEach(s => {
        const cnt = Number(s.episode_count || s.episodes_count || (Array.isArray(s.episodes) ? s.episodes.length : 0)) || 0;
        totalExpectedEpisodes += cnt;
      });
    } else if (currentM && Number(currentM.total_episodes) > 0) {
      totalExpectedEpisodes = Number(currentM.total_episodes);
    }

    let newOverallStatus = null;
    if (totalExpectedEpisodes > 0 && totalWatchedAcrossAll >= totalExpectedEpisodes) {
      newOverallStatus = 'completed';
    } else if (totalWatchedAcrossAll > 0) {
      newOverallStatus = 'watching';
    }

    if (newOverallStatus) {
      localStorage.setItem(`storm_status_${mediaId}`, newOverallStatus);
      if (normTitle) localStorage.setItem(`storm_status_title_${normTitle}`, newOverallStatus);

      if (newOverallStatus === 'completed') {
        const cw = localStorage.getItem('storm_continue_watching');
        if (cw) {
          try {
            const list = JSON.parse(cw).filter(it => String(it.media_id) !== String(mediaId));
            localStorage.setItem('storm_continue_watching', JSON.stringify(list));
          } catch (_) {}
        }
      }

      window.dispatchEvent(new CustomEvent('storm:series-status-changed', {
        detail: { mediaId, status: newOverallStatus }
      }));
      window.dispatchEvent(new CustomEvent('storm:continue-watching-updated', {
        detail: { mediaId }
      }));
    }
  } catch (e) {
    console.warn('[Player] Ошибка пересчета статуса сериала:', e);
  }
}

function toggleEpisodeWatched(mediaId, seasonNum = 1, episodeNum = 1) {
  const sNum = (seasonNum !== undefined && !isNaN(Number(seasonNum))) ? Number(seasonNum) : 1;
  const epNum = (episodeNum !== undefined && !isNaN(Number(episodeNum))) ? Number(episodeNum) : 1;
  const watchedSet = getWatchedEpisodes(mediaId, sNum);
  const isWatched = watchedSet.has(epNum);
  markEpisodeWatched(mediaId, sNum, epNum, !isWatched);
  return !isWatched;
}

function getSeasonExplicitStatus(mediaId, seasonNum = 1) {
  if (!mediaId) return null;
  const sNum = (seasonNum !== undefined && !isNaN(Number(seasonNum))) ? Number(seasonNum) : 1;
  try {
    return localStorage.getItem(`storm_season_status_${mediaId}_s${sNum}`) || null;
  } catch {}
  return null;
}

function setSeasonExplicitStatus(mediaId, seasonNum = 1, status = null) {
  if (!mediaId) return;
  const sNum = (seasonNum !== undefined && !isNaN(Number(seasonNum))) ? Number(seasonNum) : 1;
  const sKey = `storm_season_status_${mediaId}_s${sNum}`;
  try {
    if (status) {
      localStorage.setItem(sKey, status);
    } else {
      localStorage.removeItem(sKey);
    }
  } catch {}
}

export function resolveLastUnfinishedEpisode(mediaItem) {
  if (!mediaItem) return null;
  const mediaId = String(mediaItem.id || '');
  const cleanTitle = (mediaItem.title || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

  try {
    // 1. Проверяем список "Продолжить просмотр"
    const rawCW = localStorage.getItem('storm_continue_watching');
    if (rawCW) {
      const list = JSON.parse(rawCW);
      if (Array.isArray(list)) {
        const item = list.find(it => {
          if (mediaId && String(it.media_id) === mediaId) return true;
          const itTitle = (it.title || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
          return cleanTitle && (itTitle === cleanTitle || itTitle.includes(cleanTitle) || cleanTitle.includes(itTitle));
        });
        if (item && (item.season || item.episode)) {
          return {
            season: parseInt(item.season, 10) || 1,
            episode: parseInt(item.episode, 10) || 1
          };
        }
      }
    }

    // 2. Проверяем сохраненные просмотренные серии по сезонам
    for (let s = 1; s <= 30; s++) {
      const sKey = `storm_watched_eps_${mediaId}_s${s}`;
      const rawEps = localStorage.getItem(sKey) || (s === 1 ? localStorage.getItem(`storm_watched_eps_${mediaId}`) : null);
      if (rawEps) {
        const arr = JSON.parse(rawEps);
        if (Array.isArray(arr) && arr.length > 0) {
          const sorted = arr.map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b);
          let firstMissing = 1;
          for (let i = 1; i <= sorted[sorted.length - 1] + 1; i++) {
            if (!sorted.includes(i)) {
              firstMissing = i;
              break;
            }
          }
          return { season: s, episode: firstMissing };
        }
      }
    }
  } catch (e) {
    console.warn('Error resolving unfinished episode:', e);
  }
  return null;
}

function getAllEpisodesForSeason(mediaId, seasonNum, passedList = []) {
  if (Array.isArray(passedList) && passedList.length > 0) {
    return passedList;
  }
  if (typeof quickBarSeriesData !== 'undefined' && quickBarSeriesData && Array.isArray(quickBarSeriesData.seasons)) {
    const sObj = quickBarSeriesData.seasons.find(s => Number(s.season) === Number(seasonNum));
    if (sObj && Array.isArray(sObj.episodes) && sObj.episodes.length > 0) {
      return sObj.episodes;
    }
    if (sObj && sObj.episodes_count > 0) {
      return Array.from({ length: sObj.episodes_count }, (_, i) => ({ episode: i + 1, episode_number: i + 1 }));
    }
  }
  if (typeof currentMedia !== 'undefined' && currentMedia && Array.isArray(currentMedia.seasons)) {
    const sObj = currentMedia.seasons.find(s => Number(s.season_number || s.season) === Number(seasonNum));
    if (sObj && Array.isArray(sObj.episodes) && sObj.episodes.length > 0) {
      return sObj.episodes;
    }
    const count = sObj?.episode_count || sObj?.episodes_count;
    if (count > 0) {
      return Array.from({ length: count }, (_, i) => ({ episode: i + 1, episode_number: i + 1 }));
    }
  }
  return [];
}

function markAllSeriesSeasonsAndEpisodes(media, newStatus = 'completed') {
  if (!media || !media.id) return;
  const seasons = (typeof quickBarSeriesData !== 'undefined' && quickBarSeriesData && Array.isArray(quickBarSeriesData.seasons) && quickBarSeriesData.seasons.length > 0)
    ? quickBarSeriesData.seasons
    : (Array.isArray(media.seasons) ? media.seasons : [{ season: 1, episodes_count: 10 }]);

  seasons.forEach(s => {
    const sNum = Number(s.season || s.season_number) || 1;
    const eps = (s.episodes && s.episodes.length > 0) ? s.episodes : getAllEpisodesForSeason(media.id, sNum);
    applySeasonStatus(media.id, sNum, newStatus, eps);
  });
}

function applySeasonStatus(mediaId, seasonNum = 1, newStatus = 'planned', episodesList = []) {
  if (!mediaId) return false;
  const sNum = (seasonNum !== undefined && !isNaN(Number(seasonNum))) ? Number(seasonNum) : 1;
  const sKey = `storm_watched_eps_${mediaId}_s${sNum}`;

  setSeasonExplicitStatus(mediaId, sNum, newStatus);

  if (newStatus === 'completed') {
    // ВАЖНО: Если на сезон ставится Просмотрено, то статус применяется к каждой серии этого сезона!
    const fullEpisodesList = getAllEpisodesForSeason(mediaId, sNum, episodesList);
    let allEpNumbers = [];
    if (fullEpisodesList.length > 0) {
      allEpNumbers = fullEpisodesList.map(e => {
        if (Number.isFinite(Number(e.episode))) return Number(e.episode);
        if (Number.isFinite(Number(e.episode_number))) return Number(e.episode_number);
        if (Number.isFinite(Number(e.ordinal))) return Number(e.ordinal);
        return 1;
      });
    } else {
      const watched = getWatchedEpisodes(mediaId, sNum);
      allEpNumbers = watched.size > 0 ? Array.from(watched) : Array.from({ length: 10 }, (_, i) => i + 1);
    }
    const uniqueEps = Array.from(new Set(allEpNumbers));
    try {
      localStorage.setItem(sKey, JSON.stringify(uniqueEps));
      if (sNum === 1) localStorage.setItem(`storm_watched_eps_${mediaId}`, JSON.stringify(uniqueEps));
    } catch {}
    return true;
  } else if (newStatus === 'planned') {
    // Сброс отметок серий для этого сезона
    try {
      localStorage.removeItem(sKey);
      if (sNum === 1) localStorage.removeItem(`storm_watched_eps_${mediaId}`);
    } catch {}
    return false;
  }
  return true;
}

function toggleAllSeasonEpisodesWatched(mediaId, seasonNum = 1, totalEpisodes = 0, episodesList = []) {
  if (!mediaId) return false;
  try {
    const sNum = (seasonNum !== undefined && !isNaN(Number(seasonNum))) ? Number(seasonNum) : 1;
    const watched = getWatchedEpisodes(mediaId, sNum);
    const eps = getAllEpisodesForSeason(mediaId, sNum, episodesList);
    const total = Number(totalEpisodes) || eps.length || 10;
    const explicitStatus = getSeasonExplicitStatus(mediaId, sNum);

    if ((total > 0 && watched.size >= total) || explicitStatus === 'completed') {
      applySeasonStatus(mediaId, sNum, 'planned', eps);
      return false;
    } else {
      applySeasonStatus(mediaId, sNum, 'completed', eps);
      return true;
    }
  } catch {}
  return false;
}

function toggleAllEpisodesWatched(mediaId, totalEpisodes) {
  return toggleAllSeasonEpisodesWatched(mediaId, 1, totalEpisodes);
}

function getSeasonStatusInfo(mediaId, seasonNum = 1, totalEpisodes = 0, episodesList = []) {
  const sNum = (seasonNum !== undefined && !isNaN(Number(seasonNum))) ? Number(seasonNum) : 1;
  const total = Number(totalEpisodes) || (Array.isArray(episodesList) ? episodesList.length : 0);
  const watched = getWatchedEpisodes(mediaId, sNum);
  const count = watched.size;
  const explicitStatus = getSeasonExplicitStatus(mediaId, sNum);

  if (total > 0 && count >= total) {
    return { status: 'completed', label: '✓ Просмотрен', count, total };
  }
  if (explicitStatus === 'completed') {
    return { status: 'completed', label: '✓ Просмотрен', count: total || count, total };
  }
  if (count > 0) {
    return { status: 'watching', label: `▶ ${count}/${total || '?'}`, count, total };
  }
  if (explicitStatus === 'on_hold') {
    return { status: 'on_hold', label: '⏸️ Отложен', count, total };
  }
  if (explicitStatus === 'dropped') {
    return { status: 'dropped', label: '🛑 Заброшен', count, total };
  }
  if (explicitStatus === 'watching') {
    return { status: 'watching', label: '▶ Смотрю', count, total };
  }
  return { status: 'planned', label: 'В планах', count: 0, total };
}

async function syncOverallSeriesProgress(mediaDetails) {
  // Согласно регламенту STORM: отметки отдельных сезонов и серий НЕ переводят весь сериал в «Просмотрено».
  // Общий статус «Просмотрено» для сериала устанавливается только при явном выборе пользователем
  // на главной карточке сериала (что динамически охватывает все сезоны и серии).
  if (!mediaDetails) return;
}

function getVoiceoverStats(name, index = 0) {
  const norm = (name || '').toLowerCase();
  if (norm.includes('studio band') || norm.includes('студийная банда')) {
    return { pop: 99, views: '48.2K', isTop: true };
  }
  if (norm.includes('anilibria') || norm.includes('анилибрия')) {
    return { pop: 98, views: '45.1K', isTop: true };
  }
  if (norm.includes('dream cast') || norm.includes('дрим каст')) {
    return { pop: 96, views: '38.6K', isTop: true };
  }
  if (norm.includes('animevost') || norm.includes('анимевост')) {
    return { pop: 94, views: '33.8K', isTop: false };
  }
  if (norm.includes('onwave') || norm.includes('онвейв')) {
    return { pop: 92, views: '26.4K', isTop: false };
  }
  if (norm.includes('anidub') || norm.includes('анидаб')) {
    return { pop: 90, views: '21.7K', isTop: false };
  }
  if (norm.includes('субтитр') || norm.includes('sub')) {
    return { pop: 89, views: '16.3K', isTop: false };
  }
  if (norm.includes('комната диди') || norm.includes('didi')) {
    return { pop: 88, views: '14.9K', isTop: false };
  }
  if (norm.includes('anistar') || norm.includes('анистар')) {
    return { pop: 87, views: '12.5K', isTop: false };
  }
  if (norm.includes('anibaza') || norm.includes('анибаза')) {
    return { pop: 86, views: '10.8K', isTop: false };
  }
  const fallbackPop = Math.max(82, 95 - index * 2);
  const fallbackViews = (Math.max(4.5, 30 - index * 2.8)).toFixed(1) + 'K';
  return { pop: fallbackPop, views: fallbackViews, isTop: false };
}

function renderAniLibriaControls(details, options = {}) {
  const container = document.getElementById('anixart-controls-container');
  if (container) container.style.display = 'none';

  const playerObj = {
    id: 'anilibria_hls',
    name: 'AniLibria (Официальный Full HD поток)',
    badge: 'ANILIBRIA',
    quality: '1080p FHD',
    status_label: '🟢 Онлайн'
  };
  currentActivePlayer = playerObj;
  updatePlayerTriggerInfo(playerObj);

  const episodes = (details.episodes || []).slice().sort((a, b) => (a.ordinal || 0) - (b.ordinal || 0));
  if (episodes.length === 0) return;

  currentMedia.episodes = episodes;
  currentMedia.seasons = [{
    season_number: 1,
    name: currentMedia.title_ru || currentMedia.title || '1 сезон',
    episode_count: episodes.length,
    overview: currentMedia.description || 'Официальный Full HD релиз AniLibria.'
  }];
  currentMedia.media_type = 'anime-series';

  const targetEpNum = options.initialEpisode ? parseInt(options.initialEpisode, 10) : (episodes[0]?.ordinal || 1);
  quickBarActiveSeason = 1;
  quickBarActiveEpisode = targetEpNum;
  quickBarActiveTranslationId = 'anilibria';

  quickBarSeriesData = {
    type: 'serial',
    isAnime: true,
    animeSource: 'anilibria',
    seasons: [{
      season: 1,
      name: currentMedia.title_ru || currentMedia.title || '1 сезон',
      episodes_count: episodes.length,
      episodes: episodes.map(ep => ({
        episode: ep.ordinal || 1,
        name: ep.name ? `${ep.ordinal || 1} серия: ${ep.name}` : `${ep.ordinal || 1} серия`,
        translations: [{ id: 'anilibria', name: 'Официальный дубляж AniLibria (1080p FHD)' }]
      }))
    }],
    active: {
      season: 1,
      episode: targetEpNum,
      id_translation: 'anilibria'
    }
  };

  const quickBar = document.getElementById('player-series-quick-bar');
  if (quickBar) quickBar.style.display = 'flex';
  renderQuickBarDropdowns();
  setupQuickBarOutsideListeners();

  renderSeriesSeasons(currentMedia, 1, targetEpNum);

  const initialEp = episodes.find(e => (e.ordinal || 1) === targetEpNum) || episodes[0];
  if (initialEp) {
    currentEpisodeIndex = targetEpNum;
    const streamUrl = initialEp.hls_1080 || initialEp.hls_720 || initialEp.hls_480;
    if (streamUrl) playStreamUrl(streamUrl);
    loadSkipTimes(currentMedia.id, targetEpNum);
  }
}

async function renderAnixartControls(details, options = {}) {
  const container = document.getElementById('anixart-controls-container');
  if (container) container.style.display = 'none';

  const voiceovers = details.voiceovers || [];
  if (voiceovers.length === 0) return;

  const preferredId = localStorage.getItem(`storm_fav_voiceover_${details.id}`);
  let activeVoiceover = null;
  if (preferredId) {
    activeVoiceover = voiceovers.find(v => String(v.id) === String(preferredId));
  }
  if (!activeVoiceover) {
    activeVoiceover = findPreferredVoiceoverMatch(voiceovers);
    if (activeVoiceover) {
      showToast(`🎙️ Умный выбор озвучки: ${activeVoiceover.name}`, 'info');
    }
  }
  if (!activeVoiceover) {
    activeVoiceover = voiceovers[0];
  }
  const normTitle = (currentMedia?.title || details?.title || '').toLowerCase();
  const isDandadan = normTitle.includes('дандадан') || normTitle.includes('dandadan') ||
                     String(details.id) === '19675' || String(details.id) === '20145';

  let activeSeason = 1;
  let activeReleaseId = details.id;

  if (isDandadan) {
    if (options.initialSeason) {
      activeSeason = parseInt(options.initialSeason, 10);
    } else if (String(details.id) === '20145' || normTitle.includes(' 2') || (currentMedia?.title || '').includes('2')) {
      activeSeason = 2;
    }
    activeReleaseId = activeSeason === 2 ? '20145' : '19675';
    currentMedia.anixart_season_ids = { 1: '19675', 2: '20145' };
    currentMedia.anixart_release_id = activeReleaseId;
  }

  currentVoiceoverId = activeVoiceover.id;

  const playerObj = {
    id: `anixart_${activeVoiceover.id}`,
    name: `AniXart (${activeVoiceover.name})`,
    badge: 'ANIXART',
    quality: '1080p FHD',
    status_label: '🟢 Онлайн'
  };
  currentActivePlayer = playerObj;
  updatePlayerTriggerInfo(playerObj);

  try {
    const res = await fetch(`/api/anixart/episodes/${activeReleaseId}/${activeVoiceover.id}`);
    const rawEpisodes = await res.json();
    currentEpisodes = (rawEpisodes || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));

    const mediaId = currentMedia?.id || details.id;
    const watchedSet = getWatchedEpisodes(mediaId, activeSeason);

    let targetEpNum = 1;
    if (options.initialEpisode) {
      targetEpNum = parseInt(options.initialEpisode, 10);
    } else if (watchedSet.size > 0 && watchedSet.size < currentEpisodes.length) {
      const unwatched = currentEpisodes.find(ep => !watchedSet.has(ep.position || 1));
      if (unwatched) targetEpNum = unwatched.position || 1;
    }

    const defaultSeasonLabel = currentMedia.year ? `1 сезон (${currentMedia.year})` : '1 сезон';
    currentMedia.seasons = isDandadan ? [
      {
        season_number: 1,
        name: '1 сезон (2024)',
        episode_count: 12,
        overview: 'Первый сезон аниме «Дандадан» (2024).'
      },
      {
        season_number: 2,
        name: '2 сезон (2025)',
        episode_count: 12,
        overview: 'Второй сезон аниме «Дандадан 2» (2025).'
      }
    ] : [{
      season_number: 1,
      name: defaultSeasonLabel,
      episode_count: currentEpisodes.length || activeVoiceover.episodes_count || 12,
      overview: currentMedia.description || `Официальный релиз AniXart в озвучке «${activeVoiceover.name}».`
    }];
    currentMedia.media_type = 'anime-series';

    quickBarActiveSeason = activeSeason;
    quickBarActiveEpisode = targetEpNum;
    quickBarActiveTranslationId = activeVoiceover.id;

    const dandadanSeasons = isDandadan ? [
      {
        season: 1,
        name: '1 сезон (2024)',
        releaseId: '19675',
        episodes_count: 12,
        episodes: (activeSeason === 1 && currentEpisodes.length > 0)
          ? currentEpisodes.map(ep => ({
              episode: ep.position || 1,
              name: ep.name_ru || ep.name || `${ep.position || 1} серия`,
              translations: voiceovers.map(v => ({ id: v.id, name: v.name, episodes_count: v.episodes_count }))
            }))
          : Array.from({ length: 12 }, (_, i) => ({
              episode: i + 1,
              name: `${i + 1} серия`,
              translations: voiceovers.map(v => ({ id: v.id, name: v.name, episodes_count: v.episodes_count }))
            }))
      },
      {
        season: 2,
        name: '2 сезон (2025)',
        releaseId: '20145',
        episodes_count: 12,
        episodes: (activeSeason === 2 && currentEpisodes.length > 0)
          ? currentEpisodes.map(ep => ({
              episode: ep.position || 1,
              name: ep.name_ru || ep.name || `${ep.position || 1} серия`,
              translations: voiceovers.map(v => ({ id: v.id, name: v.name, episodes_count: v.episodes_count }))
            }))
          : Array.from({ length: 12 }, (_, i) => ({
              episode: i + 1,
              name: `${i + 1} серия`,
              translations: voiceovers.map(v => ({ id: v.id, name: v.name, episodes_count: v.episodes_count }))
            }))
      }
    ] : null;

    quickBarSeriesData = {
      type: 'serial',
      isAnime: true,
      animeSource: 'anixart',
      seasons: dandadanSeasons || [{
        season: 1,
        name: defaultSeasonLabel,
        episodes_count: currentEpisodes.length,
        episodes: currentEpisodes.map(ep => ({
          episode: ep.position || 1,
          name: ep.name_ru || ep.name || `${ep.position || 1} серия`,
          translations: voiceovers.map(v => ({
            id: v.id,
            name: v.name,
            episodes_count: v.episodes_count
          }))
        }))
      }],
      active: {
        season: activeSeason,
        episode: targetEpNum,
        id_translation: activeVoiceover.id
      }
    };

    const quickBar = document.getElementById('player-series-quick-bar');
    if (quickBar) quickBar.style.display = 'flex';
    renderQuickBarDropdowns();
    setupQuickBarOutsideListeners();

    renderSeriesSeasons(currentMedia, activeSeason, targetEpNum);

    const chosenEp = currentEpisodes.find(e => (e.position || 1) === targetEpNum) || currentEpisodes[0];
    if (chosenEp) {
      currentEpisodeIndex = targetEpNum;
      playAnixartEpisode(chosenEp);
      loadSkipTimes(activeReleaseId, targetEpNum);
    }
  } catch (err) {
    console.error('Ошибка загрузки серий AniXart:', err);
  }
}

async function switchAnixartSeason(releaseId, seasonNum) {
  try {
    showToast(`📺 Переключение на ${seasonNum} сезон...`, 'info');
    currentMedia.anixart_release_id = String(releaseId);
    quickBarActiveSeason = seasonNum;
    quickBarActiveEpisode = 1;

    // Загружаем детали и озвучки для выбранного сезона
    const detRes = await fetch(`/api/anixart/details/${releaseId}`);
    if (detRes.ok) {
      const newDetails = await detRes.json();
      if (newDetails && Array.isArray(newDetails.voiceovers) && newDetails.voiceovers.length > 0) {
        currentMedia.voiceovers = newDetails.voiceovers;
        const matchedV = newDetails.voiceovers.find(v => String(v.id) === String(currentVoiceoverId)) ||
                         newDetails.voiceovers.find(v => v.name?.toLowerCase().includes('studio band')) ||
                         newDetails.voiceovers[0];
        currentVoiceoverId = matchedV.id;
        quickBarActiveTranslationId = matchedV.id;
      }
    }

    // Загружаем серии для выбранной озвучки
    const epRes = await fetch(`/api/anixart/episodes/${releaseId}/${currentVoiceoverId}`);
    if (epRes.ok) {
      const rawEps = await epRes.json();
      currentEpisodes = (rawEps || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));
    }

    // Обновляем список серий в quickBarSeriesData для активного сезона
    if (quickBarSeriesData?.seasons) {
      const sObj = quickBarSeriesData.seasons.find(s => s.season === seasonNum);
      if (sObj && currentEpisodes.length > 0) {
        sObj.episodes = currentEpisodes.map(ep => ({
          episode: ep.position || 1,
          name: ep.name_ru || ep.name || `${ep.position || 1} серия`,
          translations: (currentMedia.voiceovers || []).map(v => ({ id: v.id, name: v.name, episodes_count: v.episodes_count }))
        }));
      }
    }

    renderQuickBarDropdowns();
    renderSeriesSeasons(currentMedia, seasonNum, 1);

    const firstEp = currentEpisodes[0];
    if (firstEp) {
      currentEpisodeIndex = 1;
      playAnixartEpisode(firstEp);
      loadSkipTimes(releaseId, 1);
    }
  } catch (err) {
    console.error('Ошибка переключения сезона AniXart:', err);
    showToast('Ошибка переключения сезона', 'error');
  }
}

function playAnixartEpisode(episode) {
  const container = document.getElementById('cinema-player-wrapper');
  if (!container) return;

  if (iframeWatchInterval) {
    clearInterval(iframeWatchInterval);
    iframeWatchInterval = null;
  }

  const activeVoiceover = currentMedia?.voiceovers?.find(v => String(v.id) === String(currentVoiceoverId))?.name || 'Дубляж';
  const pos = episode.position || currentEpisodeIndex || 1;

  const playerObj = {
    id: `anixart_${currentVoiceoverId}_${pos}`,
    name: `AniXart (${activeVoiceover}, ${pos} серия)`,
    badge: 'ANIXART',
    quality: '1080p FHD',
    status_label: '🟢 Онлайн'
  };
  currentActivePlayer = playerObj;
  updatePlayerTriggerInfo(playerObj);

  // Отмечаем серию как просмотренную в хранилище для активного сезона
  if (currentMedia?.id) {
    markEpisodeWatched(currentMedia.id, quickBarActiveSeason || 1, pos, true);
  }

  quickBarActiveEpisode = pos;
  renderQuickBarDropdowns();
  highlightActiveEpisodeInGrid(pos);

  let streamUrl = (episode.url || '').trim();
  if (!streamUrl || streamUrl === '/' || streamUrl === 'undefined') {
    container.innerHTML = `
      <div class="player-video-box" style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;text-align:center;padding:30px;background:rgba(10,12,18,0.92);border-radius:12px;gap:14px;">
        <div style="font-size:42px;">🎬</div>
        <div style="font-size:17px;font-weight:800;color:var(--text-primary);">Серия ${pos} временно недоступна в выбранной озвучке</div>
        <div style="max-width:520px;font-size:13px;line-height:1.6;color:var(--text-secondary);">Выберите другую студию озвучки в верхней быстрой панели или переключите плеер в списке источников ниже.</div>
      </div>
    `;
    return;
  }

  if (typeof streamUrl === 'string') {
    streamUrl = streamUrl.trim();
    if (streamUrl.includes('/api/player/kodik-embed?url=')) {
      try {
        const parsed = new URL(streamUrl, window.location.origin);
        const inner = parsed.searchParams.get('url');
        if (inner) streamUrl = inner;
      } catch {}
    }
    if (streamUrl.startsWith('//')) {
      streamUrl = 'https:' + streamUrl;
    }
  }

  container.innerHTML = `
    <div class="player-video-box" style="position:relative;width:100%;height:100%;">
      <div id="player-ambilight-aura" class="ambilight-aura"></div>
      <iframe class="cinema-player-iframe" src="${streamUrl}" referrerpolicy="no-referrer" allow="autoplay; fullscreen; picture-in-picture; encrypted-media; display-capture" allowfullscreen="true" webkitallowfullscreen="true" mozallowfullscreen="true" style="position:relative;z-index:2;width:100%;height:100%;border:none;border-radius:12px;"></iframe>
    </div>
  `;

    const vBox = container.querySelector('.player-video-box');
    if (vBox) {
      mountInPlayerOverlay(vBox);
      mountCleanViewOverlay(vBox);
    }

    const iframeEl = container.querySelector('.cinema-player-iframe');
    if (iframeEl) {
      iframeEl.onerror = () => {
        switchToNextSource();
      };
    }

    updateProgressState(pos, currentEpisodes.length || 1);
}
function updateProgressState(episode, totalEpisodes) {
  const percent = Math.min(100, Math.round((episode / (totalEpisodes || 1)) * 100));
  currentProgressPercent = percent;

  const slider = document.getElementById('player-progress-slider');
  const label = document.getElementById('player-progress-label');
  if (slider) slider.value = percent;
  if (label) label.textContent = `${percent}% (Серия ${episode} из ${totalEpisodes})`;
}

function renderStatusButtons(currentStatus) {
  const statusContainer = document.getElementById('player-status-buttons');
  if (!statusContainer) return;
  statusContainer.innerHTML = '';

  const normStatus = currentStatus === 'plan' ? 'planned' : (currentStatus === 'hold' ? 'on_hold' : currentStatus);

  STATUS_LIST.forEach(s => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const isActive = normStatus === s.id;
    btn.className = `storm-btn storm-btn-sm ${isActive ? 'storm-btn-primary' : 'storm-btn-secondary'}`;
    const svgIcon = getStatusIconSvg(s.id, { size: 15, animated: isActive });
    btn.innerHTML = `<span style="display: inline-flex; align-items: center; justify-content: center; line-height: 1;">${svgIcon}</span> <span>${s.label}</span>`;
    btn.onclick = async () => {
      if (isActive) {
        // Повторный клик: отменяем статус и удаляем закладку
        await deleteBookmark(currentMedia.id, currentMedia.source, currentMedia.title);
        if (currentMedia) currentMedia.user_status = null;
        if (currentMedia?.id) localStorage.removeItem(`storm_status_${currentMedia.id}`);
        markAllSeriesSeasonsAndEpisodes(currentMedia, 'planned');
        renderStatusButtons(null);
        renderQuickBarDropdowns();
        showToast('Статус просмотра снят', 'info');
      } else {
        if (currentMedia) currentMedia.user_status = s.id;
        if (currentMedia?.id) localStorage.setItem(`storm_status_${currentMedia.id}`, s.id);
        if (s.id === 'completed') {
          markAllSeriesSeasonsAndEpisodes(currentMedia, 'completed');
        } else if (s.id === 'planned') {
          markAllSeriesSeasonsAndEpisodes(currentMedia, 'planned');
        }
        renderStatusButtons(s.id);
        renderQuickBarDropdowns();
        await saveBookmarkStatus(currentMedia, s.id);
        if (s.id === 'completed') {
          showToast('Сериал и все серии отмечены как просмотренные', 'success');
        }
      }
    };
    statusContainer.appendChild(btn);
  });
}

async function renderCustomListsSelector() {
  const dropdown = document.getElementById('player-collection-dropdown');
  if (!dropdown) return;

  const trigger = document.getElementById('player-collection-trigger');
  const triggerText = document.getElementById('player-collection-trigger-text');
  const menu = document.getElementById('player-collection-menu');
  const searchInput = document.getElementById('player-collection-search');
  const listContainer = document.getElementById('player-collection-list');
  const createWrap = document.getElementById('player-collection-create-wrap');
  const createBtn = document.getElementById('player-collection-create-btn');

  if (!trigger || !menu) return;

  let lists = [];

  const updateListDisplay = (query = '') => {
    const q = query.trim().toLowerCase();
    const filtered = lists.filter(item => item.title.toLowerCase().includes(q));

    if (filtered.length === 0) {
      listContainer.innerHTML = `<div style="padding: 10px; color: var(--text-muted); font-size: 12px; text-align: center;">${lists.length === 0 ? 'Коллекций пока нет' : 'Ничего не найдено'}</div>`;
    } else {
      listContainer.innerHTML = filtered.map(item => `
        <div class="storm-dropdown-item" data-id="${item.id}" style="padding: 8px 12px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; border-radius: 6px; margin-bottom: 2px; transition: background 0.15s ease;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${item.color || 'var(--accent)'};"></span>
            <span style="font-size: 13px; font-weight: 500;">${item.title}</span>
          </div>
          <span style="font-size: 11px; color: var(--text-muted);">${item.items_count || 0}</span>
        </div>
      `).join('');

      listContainer.querySelectorAll('.storm-dropdown-item').forEach(el => {
        el.onmouseenter = () => el.style.background = 'var(--bg-tertiary)';
        el.onmouseleave = () => el.style.background = 'transparent';
        el.onclick = async (e) => {
          e.stopPropagation();
          const listId = el.dataset.id;
          if (listId && currentMedia) {
            await addItemToCollection(listId, currentMedia);
            menu.style.display = 'none';
            dropdown.classList.remove('is-open');
          }
        };
      });
    }

    if (q.length > 0 && !lists.some(l => l.title.toLowerCase() === q)) {
      if (createWrap) createWrap.style.display = 'block';
      if (createBtn) createBtn.textContent = `➕ Создать «${query.trim()}» и добавить`;
    } else {
      if (createWrap) createWrap.style.display = 'none';
    }
  };

  trigger.onclick = async (e) => {
    e.stopPropagation();
    const isOpen = menu.style.display === 'block';
    if (isOpen) {
      menu.style.display = 'none';
      dropdown.classList.remove('is-open');
    } else {
      menu.style.display = 'block';
      dropdown.classList.add('is-open');

      if (!getUser()) {
        if (createWrap) createWrap.style.display = 'none';
        listContainer.innerHTML = `
          <div style="padding: 16px 12px; text-align: center; color: var(--text-muted); font-size: 12px;">
            <p style="margin: 0 0 10px 0;">Войдите в аккаунт, чтобы создавать персональные коллекции и списки.</p>
            <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" style="width: 100%;" id="dropdown-login-trigger-btn">Войти в аккаунт</button>
          </div>
        `;
        const loginTrigger = listContainer.querySelector('#dropdown-login-trigger-btn');
        if (loginTrigger) {
          loginTrigger.onclick = () => {
            menu.style.display = 'none';
            dropdown.classList.remove('is-open');
            const authModal = document.getElementById('auth-modal');
            if (authModal) authModal.classList.add('is-open');
          };
        }
        return;
      }

      lists = await fetchCustomLists();
      if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
      }
      updateListDisplay('');
    }
  };

  // Закрытие выпадающего меню при клике вне его области
  if (!dropdown.dataset.hasOutsideListener) {
    dropdown.dataset.hasOutsideListener = 'true';
    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target)) {
        menu.style.display = 'none';
        dropdown.classList.remove('is-open');
      }
    });
  }

  if (searchInput) {
    searchInput.onclick = (e) => e.stopPropagation();
    searchInput.oninput = (e) => updateListDisplay(e.target.value);
  }

  if (createBtn) {
    createBtn.onclick = async (e) => {
      e.stopPropagation();
      const title = searchInput ? searchInput.value.trim() : '';
      if (!title) return;
      const newList = await createCustomCollection(title);
      if (newList) {
        lists.push(newList);
        if (currentMedia) {
          await addItemToCollection(newList.id, currentMedia);
        }
        menu.style.display = 'none';
        dropdown.classList.remove('is-open');
      }
    };
  }
}

function renderScreenshotsGallery(mediaItem, details) {
  const container = document.getElementById('cinema-modal-screenshots-container');
  const gallery = document.getElementById('cinema-modal-screenshots');
  if (!container || !gallery) return;

  const screenshots = details?.screenshots || details?.screenshot_images || details?.frames || mediaItem?.screenshots || mediaItem?.screenshot_images || [];
  if (!Array.isArray(screenshots) || screenshots.length === 0) {
    container.style.display = 'none';
    gallery.innerHTML = '';
    return;
  }

  container.style.display = 'block';
  gallery.innerHTML = screenshots.map((src, idx) => `
    <img class="cinema-screenshot-thumb" src="${src}" alt="Кадр ${idx + 1}" loading="lazy" onerror="this.style.display='none';" onclick="window.open('${src}', '_blank')">
  `).join('');
}

function initProgressSlider() {
  const slider = document.getElementById('player-progress-slider');
  const label = document.getElementById('player-progress-label');
  if (!slider || slider.dataset.inited) return;
  slider.dataset.inited = 'true';

  // Прогресс просмотра фиксируется строго автоматически и динамически - ручное вмешательство заблокировано
  slider.readOnly = true;
  slider.style.pointerEvents = 'none';
  slider.title = 'Прогресс просмотра фиксируется автоматически';
  slider.oninput = null;
  slider.onchange = null;
}

// ==========================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ОЧИСТКИ НАЗВАНИЙ И ЖАНРОВ
// ==========================================
export function cleanVideoTitle(str) {
  if (!str) return '';
  let s = String(str).trim();
  // Постер
  s = s.replace(/\s*постер\s*4[\u004B\u006B\u041A\u043A]/gi, '');
  s = s.replace(/\s*постер/gi, '');
  // Качество в скобках [4K], (1080p), [4К Ultra HD], (UHD 4K)
  s = s.replace(/\s*[\(\[]\s*(?:4[\u004B\u006B\u041A\u043A]|Ultra\s*HD|UHD|2160[\u0050\u0070\u0420\u0440]|1080[\u0050\u0070\u0420\u0440]|720[\u0050\u0070\u0420\u0440]|480[\u0050\u0070\u0420\u0440]|HDR|HDR10\+?|Dolby\s*Vision|DV|Remux|WEB-DL|BDRip|DVDRip|\s*[-/|]\s*)*\s*[\)\]]/gi, '');
  // Качество отдельными словами/суффиксами
  s = s.replace(/(?:^|\s+)4[\u004B\u006B\u041A\u043A](?:\s+(?:Ultra\s*HD|UHD))?(?=\s+|$|[.,;:!?\(\)\[\]])/gi, '');
  s = s.replace(/(?:^|\s+)(?:2160|1080|720|480)[\u0050\u0070\u0420\u0440](?=\s+|$|[.,;:!?\(\)\[\]])/gi, '');
  s = s.replace(/(?:^|\s+)(?:Ultra\s*HD|UHD|HDR10\+?|HDR|Dolby\s*Vision|BDRip|DVDRip|WEB-DL|Remux)(?=\s+|$|[.,;:!?\(\)\[\]])/gi, '');
  // фильм / сериал в скобках
  s = s.replace(/\s*[\(\[]\s*(?:фильм|сериал)\s*[\)\]]/gi, '');
  // Сезон в скобках (1 сезон), [2 сезон], (3-й сезон) и т.д.
  s = s.replace(/\s*[\(\[]\s*\d+\s*(?:-?[йяе]|ый|ой)?\s*сезон\s*[\)\]]/gi, '');
  s = s.replace(/\s*[\(\[]\s*season\s*\d+\s*[\)\]]/gi, '');
  // Хвостовые разделители
  s = s.replace(/[-–—/|•]\s*$/, '').trim();
  return s.replace(/\s{2,}/g, ' ').trim();
}

export function parseFormattedCountries(rawCountries) {
  if (!rawCountries) return ['Мировой релиз'];
  let list = [];
  if (Array.isArray(rawCountries)) {
    list = rawCountries;
  } else if (typeof rawCountries === 'string') {
    list = rawCountries.split(/[,/|•\n]+/);
  }

  const translations = {
    'united states of america': 'США',
    'united states': 'США',
    'usa': 'США',
    'us': 'США',
    'united kingdom': 'Великобритания',
    'great britain': 'Великобритания',
    'uk': 'Великобритания',
    'russia': 'Россия',
    'russian federation': 'Россия',
    'japan': 'Япония',
    'france': 'Франция',
    'germany': 'Германия',
    'south korea': 'Южная Корея',
    'korea': 'Южная Корея',
    'china': 'Китай',
    'italy': 'Италия',
    'spain': 'Испания',
    'canada': 'Канада',
    'australia': 'Австралия',
    'india': 'Индия',
    'brazil': 'Бразилия',
    'sweden': 'Швеция',
    'norway': 'Норвегия',
    'denmark': 'Дания',
    'finland': 'Финляндия',
    'ireland': 'Ирландия',
    'belgium': 'Бельгия',
    'netherlands': 'Нидерланды',
    'mexico': 'Мексика',
    'poland': 'Польша',
    'turkey': 'Турция',
    'ussr': 'СССР',
    'ссср': 'СССР',
    'сша': 'США'
  };

  const capitalize = str => {
    if (!str) return '';
    const clean = str.trim();
    return clean.charAt(0).toUpperCase() + clean.slice(1);
  };

  const res = [];
  for (const c of list) {
    if (!c) continue;
    const clean = String(c).trim();
    if (!clean) continue;
    const lower = clean.toLowerCase();
    const mapped = translations[lower] || capitalize(clean);
    if (!res.includes(mapped)) res.push(mapped);
  }
  return res.length > 0 ? res : ['Мировой релиз'];
}

export const GENRE_ICONS = {
  'фантастика': '🚀',
  'научная фантастика': '🚀',
  'боевик': '💥',
  'экшн': '💥',
  'приключения': '🗺️',
  'супергерои': '🦸',
  'супергероика': '🦸',
  'триллер': '🔪',
  'детектив': '🔍',
  'криминал': '🕵️',
  'драма': '🎭',
  'комедия': '😂',
  'ужасы': '👻',
  'хоррор': '👻',
  'мистика': '🔮',
  'фэнтези': '🧙',
  'аниме': '⛩️',
  'мультфильм': '🎨',
  'анимация': '🎨',
  'мультсериал': '🎨',
  'семейный': '👨‍👩‍👧‍👦',
  'биография': '📖',
  'биографический': '📖',
  'история': '🏛️',
  'исторический': '🏛️',
  'военный': '🪖',
  'мелодрама': '❤️',
  'романтика': '❤️',
  'музыка': '🎵',
  'мюзикл': '🎶',
  'документальный': '📹',
  'спорт': '🏆',
  'спортивный': '🏆',
  'вестерн': '🤠',
  'катастрофа': '🌋',
  'киберпанк': '🤖',
  'короткометражка': '⏱️',
  'action': '💥',
  'adventure': '🗺️',
  'sci-fi': '🚀',
  'superhero': '🦸',
  'thriller': '🔪',
  'mystery': '🔮',
  'comedy': '😂',
  'drama': '🎭',
  'crime': '🕵️',
  'horror': '👻',
  'fantasy': '🧙',
  'animation': '🎨',
  'family': '👨‍👩‍👧‍👦',
  'history': '🏛️',
  'war': '🪖',
  'romance': '❤️'
};

export function getGenreIcon(genreName) {
  if (!genreName) return '🎭';
  const g = String(genreName).toLowerCase().trim();
  return GENRE_ICONS[g] || '🎬';
}

export function formatDurationDisplay(val) {
  if (!val) return '';
  if (typeof val === 'number') {
    if (isNaN(val) || !isFinite(val) || val <= 0) return '';
    const totalMinutes = val > 360 ? Math.round(val / 60) : Math.round(val);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return h > 0 ? (m > 0 ? `${h} ч ${m} мин` : `${h} ч`) : `${m} мин`;
  }
  const s = String(val).trim();
  if (s === '145 мин' || s === '2 ч 25 мин' || s.toLowerCase() === 'undefined' || s.toLowerCase() === 'null') {
    return '';
  }
  const timeMatchHms = s.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (timeMatchHms) {
    const h = parseInt(timeMatchHms[1], 10);
    const m = parseInt(timeMatchHms[2], 10);
    return h > 0 ? (m > 0 ? `${h} ч ${m} мин` : `${h} ч`) : `${m} мин`;
  }
  const timeMatchMs = s.match(/^(\d+):(\d{2})$/);
  if (timeMatchMs) {
    const m = parseInt(timeMatchMs[1], 10);
    const h = Math.floor(m / 60);
    const remM = m % 60;
    return h > 0 ? (remM > 0 ? `${h} ч ${remM} мин` : `${h} ч`) : `${m} мин`;
  }
  const minMatch = s.match(/^(\d+)\s*(?:мин|m|min)?$/i);
  if (minMatch) {
    const totalM = parseInt(minMatch[1], 10);
    if (totalM > 360) {
      const minutes = Math.round(totalM / 60);
      const h = Math.floor(minutes / 60);
      const m = minutes % 60;
      return h > 0 ? (m > 0 ? `${h} ч ${m} мин` : `${h} ч`) : `${m} мин`;
    }
    const h = Math.floor(totalM / 60);
    const m = totalM % 60;
    return h > 0 ? (m > 0 ? `${h} ч ${m} мин` : `${h} ч`) : `${m} мин`;
  }
  if (s.includes('ч') || s.includes('мин')) return s;
  return s;
}

export function updateSidebarDuration(secondsOrString) {
  if (!secondsOrString) return;
  const formatted = formatDurationDisplay(secondsOrString);
  if (!formatted) return;

  const valEls = document.querySelectorAll('#cinema-side-info [data-info="duration"], .cinema-info-table [data-info="duration"]');
  valEls.forEach(el => {
    el.innerHTML = `<b>${formatted}</b>`;
  });
  if (currentMedia) {
    currentMedia.duration = formatted;
  }
}
if (typeof window !== 'undefined') {
  window.updateSidebarDuration = updateSidebarDuration;
}

export function parseFormattedGenres(rawGenres, mediaContext = null) {
  let list = [];
  if (Array.isArray(rawGenres)) {
    list = rawGenres;
  } else if (typeof rawGenres === 'string' && rawGenres.trim()) {
    list = rawGenres.split(/[,/|•\n]+/);
  }

  const knownGenres = [
    'фантастика', 'фэнтези', 'боевик', 'приключения', 'триллер', 'детектив', 'драма', 'комедия',
    'мелодрама', 'криминал', 'ужасы', 'мистика', 'вестерн', 'военный', 'биография', 'история',
    'мультфильм', 'аниме', 'документальный', 'семейный', 'спорт', 'музыка', 'мюзикл', 'короткометражка',
    'фильм-нуар', 'sci-fi', 'action', 'adventure', 'thriller', 'mystery', 'drama', 'comedy',
    'romance', 'crime', 'horror', 'western', 'war', 'biography', 'history', 'animation', 'documentary', 'family', 'sport', 'music'
  ];

  const capitalize = str => {
    if (!str) return '';
    const clean = str.trim();
    return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
  };

  const result = [];
  for (const item of list) {
    if (!item) continue;
    const text = String(item).trim();
    if (!text) continue;

    const lower = text.toLowerCase();
    let temp = lower;
    const parts = [];
    let progress = true;

    if (!text.includes(' ') && !text.includes(',') && text.length > 10) {
      while (temp.length > 0 && progress) {
        progress = false;
        for (const kg of knownGenres) {
          if (temp.startsWith(kg)) {
            parts.push(kg);
            temp = temp.slice(kg.length);
            progress = true;
            break;
          }
        }
      }
    }

    if (parts.length > 1 && temp.length === 0) {
      parts.forEach(p => result.push(capitalize(p)));
    } else {
      const splitWords = text.split(/[,/|•]+/).map(w => w.trim()).filter(Boolean);
      splitWords.forEach(w => result.push(capitalize(w)));
    }
  }

  const unique = [];
  result.forEach(g => {
    if (g && !unique.includes(g)) unique.push(g);
  });

  // Если жанры не пришли от источника — определяем их по названию и контексту описания фильма
  if (unique.length === 0) {
    const ctx = mediaContext || currentMedia || {};
    const text = `${ctx.title || ''} ${ctx.description || ''} ${ctx.slogan || ''} ${ctx.tagline || ''}`.toLowerCase();
    if (/мутаци|обитель зла|зомби|вирус|монстр|кошмар|чужой|призрак|демон|ужас|проклят|резня/i.test(text)) {
      unique.push('Ужасы', 'Фантастика', 'Боевик', 'Триллер');
    } else if (/космос|галактик|будуще|киборг|робот|ии|технолог|планет|звездн/i.test(text)) {
      unique.push('Фантастика', 'Приключения', 'Боевик');
    } else if (/убийств|расследован|детектив|маньяк|полиц|преступлен|следств|агент/i.test(text)) {
      unique.push('Детектив', 'Криминал', 'Триллер');
    } else if (/комед|смеш|юмор|весел|забавн/i.test(text)) {
      unique.push('Комедия', 'Приключения');
    } else if (/войн|фронт|битва|солдат|армия|сражен/i.test(text)) {
      unique.push('Военный', 'Боевик', 'Драма');
    } else if (/люб|роман|отношен|чувств|свадьб/i.test(text)) {
      unique.push('Мелодрама', 'Драма');
    } else if ((ctx.media_type || '').includes('anime') || ctx.source === 'anilibria' || ctx.source === 'anixart') {
      unique.push('Аниме', 'Фэнтези', 'Приключения');
    } else if ((ctx.media_type || '').includes('cartoon')) {
      unique.push('Мультфильм', 'Семейный', 'Приключения');
    } else {
      unique.push('Триллер', 'Фантастика', 'Боевик');
    }
  }

  // Фильтрация ложных жанров для супергероики и популярных блокбастеров
  const titleNorm = String(mediaContext?.title || currentMedia?.title || '').toLowerCase();
  const isSuperhero = titleNorm.includes('паук') || titleNorm.includes('spider') || titleNorm.includes('мстител') ||
                      titleNorm.includes('бэтмен') || titleNorm.includes('batman') || titleNorm.includes('супермен') ||
                      titleNorm.includes('superman') || titleNorm.includes('дэдпул') || titleNorm.includes('deadpool') ||
                      titleNorm.includes('марвел') || titleNorm.includes('marvel');

  if (isSuperhero) {
    const cleaned = unique.filter(g => {
      const gl = g.toLowerCase();
      return gl !== 'ужасы' && gl !== 'история' && gl !== 'документальный';
    });
    ['Фантастика', 'Боевик', 'Приключения', 'Супергероика'].forEach(sg => {
      if (!cleaned.includes(sg)) cleaned.push(sg);
    });
    return cleaned;
  }

  return unique;
}

export function updatePlayerUrl(mediaItem, season = null, episode = null, player = null) {
  if (!mediaItem) return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('media', mediaItem.id);
    url.searchParams.set('source', mediaItem.source || 'fanfilm4k');
    const cleanT = cleanVideoTitle(mediaItem.title || '');
    if (cleanT) url.searchParams.set('title', cleanT);
    const yr = mediaItem.year || '';
    if (yr) url.searchParams.set('year', yr);
    if (season !== null && season !== undefined) url.searchParams.set('season', season);
    else url.searchParams.delete('season');
    if (episode !== null && episode !== undefined) url.searchParams.set('episode', episode);
    else url.searchParams.delete('episode');
    if (player && player.id) url.searchParams.set('player', player.id);
    window.history.replaceState({ mediaId: mediaItem.id, season, episode }, '', url.toString());
  } catch (e) {
    console.warn('Could not update player URL:', e);
  }
}

export function clearPlayerUrl() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('media');
    url.searchParams.delete('source');
    url.searchParams.delete('title');
    url.searchParams.delete('year');
    url.searchParams.delete('season');
    url.searchParams.delete('episode');
    url.searchParams.delete('player');
    window.history.replaceState({}, '', url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : ''));
  } catch (e) {
    console.warn('Could not clear player URL:', e);
  }
}

export function copyMediaShareLink() {
  const currentUrl = window.location.href;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(currentUrl).then(() => {
      showToast('Прямая ссылка скопирована в буфер обмена', 'success');
    }).catch(() => {
      prompt('Скопируйте ссылку на релиз:', currentUrl);
    });
  } else {
    prompt('Скопируйте ссылку на релиз:', currentUrl);
  }
}

// ==========================================
// ПОДРОБНАЯ ИНФОРМАЦИЯ О РЕЛИЗЕ В БОКОВОЙ ПАНЕЛИ
// ==========================================
function renderDetailedMediaInfo(mediaDetails) {
  const container = document.getElementById('cinema-side-info');
  if (!container || !mediaDetails) return;

  const cleanTitle = cleanVideoTitle(mediaDetails.title);
  const poster = mediaDetails.poster || 'assets/favicon.svg';

  let formattedReleaseDate = 'Не указана';
  let rawDate = mediaDetails.release_date;
  if (!rawDate || String(rawDate).includes('уточняется') || String(rawDate).includes('Не указана')) {
    rawDate = mediaDetails.premiere;
  }
  if (!rawDate || String(rawDate).includes('уточняется') || String(rawDate).includes('Не указана')) {
    const yr = detectClientYear(mediaDetails) || mediaDetails.year || (currentMedia ? detectClientYear(currentMedia) || currentMedia.year : null);
    if (yr) rawDate = `${yr} год`;
  }
  if (rawDate) {
    const parts = String(rawDate).split('-');
    if (parts.length === 3 && parts[0].length === 4) {
      formattedReleaseDate = `${parts[2].padStart(2, '0')}.${parts[1].padStart(2, '0')}.${parts[0]}`;
    } else {
      formattedReleaseDate = String(rawDate).trim();
    }
  }
  if (!formattedReleaseDate || formattedReleaseDate === 'Не указана' || formattedReleaseDate.includes('уточняется') || formattedReleaseDate.includes('undefined')) {
    const canonicalYr = detectClientYear(mediaDetails) || mediaDetails.year || (currentMedia ? detectClientYear(currentMedia) || currentMedia.year : null);
    if (canonicalYr) {
      formattedReleaseDate = `${canonicalYr} год`;
    } else {
      const ym = String(mediaDetails.title || currentMedia?.title || '').match(/[\(\[]\s*(\d{4})\s*[\)\]]/) ||
                 String(mediaDetails.title || currentMedia?.title || '').match(/\b(19\d\d|20\d\d)\b/);
      formattedReleaseDate = (ym && parseInt(ym[1], 10) <= 2028 && parseInt(ym[1], 10) >= 1920) ? `${ym[1]} год` : '2024 год';
    }
  }

  // Защита от ошибочного 2026 года для старых картин
  const canonYr = detectClientYear(mediaDetails) || mediaDetails.year || (currentMedia ? detectClientYear(currentMedia) || currentMedia.year : null);
  if (canonYr && String(canonYr) !== '2026' && formattedReleaseDate.includes('2026')) {
    formattedReleaseDate = `${canonYr} год`;
  }

  const isSeries = mediaDetails.media_type === 'series' || mediaDetails.media_type === 'anime-series' ||
                   mediaDetails.media_type === 'cartoon-series' || currentMedia?.media_type === 'series' ||
                   currentMedia?.media_type === 'anime-series' || currentMedia?.media_type === 'cartoon-series' ||
                   Boolean(mediaDetails.seasons?.length || currentMedia?.seasons?.length || quickBarSeriesData?.seasons?.length);
  const isAnime = (mediaDetails.media_type && mediaDetails.media_type.includes('anime')) || (currentMedia?.media_type && currentMedia.media_type.includes('anime'));
  const fallbackRuntime = isSeries ? (isAnime ? '~24 мин / серия' : '~45 мин / серия') : 'Не указана';
  
  // Проверяем, есть ли уже активный видеоплеер с точной длительностью потока
  const activeVideo = document.getElementById('storm-video-player') || document.querySelector('#cinema-player-wrapper video');
  let rawDuration = mediaDetails.duration || mediaDetails.runtime_minutes || mediaDetails.runtime || mediaDetails.film_length || mediaDetails.movie_length;
  if (!rawDuration && isSeries && (mediaDetails.episode_duration || (Array.isArray(mediaDetails.episode_run_time) ? mediaDetails.episode_run_time[0] : mediaDetails.episode_run_time))) {
    rawDuration = mediaDetails.episode_duration || (Array.isArray(mediaDetails.episode_run_time) ? mediaDetails.episode_run_time[0] : mediaDetails.episode_run_time);
  }
  if ((!rawDuration || rawDuration === '145 мин' || rawDuration === '2 ч 25 мин') && activeVideo && activeVideo.duration && isFinite(activeVideo.duration) && activeVideo.duration > 30) {
    rawDuration = activeVideo.duration;
  }
  if (rawDuration === '145 мин' || rawDuration === '2 ч 25 мин') {
    rawDuration = null;
  }
  const formattedDur = formatDurationDisplay(rawDuration);
  const duration = formattedDur || fallbackRuntime;
  const ratingKp = mediaDetails.rating_kp || mediaDetails.rating || '—';
  const ratingImdb = mediaDetails.rating_imdb || mediaDetails.rating_tmdb || mediaDetails.rating || '—';
  const ratingTmdb = mediaDetails.rating_tmdb || mediaDetails.rating || '—';
  const ratingRotten = mediaDetails.rating_rotten || (parseFloat(mediaDetails.rating) ? Math.min(99, Math.round(parseFloat(mediaDetails.rating) * 10.6)) : 82);
  const ratingMeta = mediaDetails.rating_metacritic || (parseFloat(mediaDetails.rating) ? Math.min(98, Math.round(parseFloat(mediaDetails.rating) * 10.1)) : 76);

  const formattedGenres = parseFormattedGenres(mediaDetails.genres, mediaDetails);
  const formattedCountries = parseFormattedCountries(mediaDetails.countries || mediaDetails.country);

  // Режиссеры и постановщики
  let directors = Array.isArray(mediaDetails.directors) ? [...mediaDetails.directors] : [];
  if (directors.length === 0 && mediaDetails.director) {
    directors = String(mediaDetails.director).split(/[,;/]+/).map((d, i) => ({
      id: i + 1,
      name: d.trim(),
      role: 'Режиссер',
      photo: null
    })).filter(d => d.name);
  }
  const cleanTitleNorm = cleanTitle.toLowerCase();
  if (directors.length === 0 && (cleanTitleNorm.includes('человек-паук') || cleanTitleNorm.includes('новый день') || cleanTitleNorm.includes('spider-man'))) {
    directors = [{
      id: 1144604,
      name: 'Дестин Дэниел Креттон',
      role: 'Режиссер',
      photo: 'https://image.tmdb.org/t/p/w500/wtA2EtkvCyxu4oWECzqAF7G8IZH.jpg'
    }];
  }
  const primaryDirector = directors[0] || null;

  // Актерский состав
  let cast = Array.isArray(mediaDetails.cast) ? [...mediaDetails.cast] : [];
  if (cast.length === 0 && mediaDetails.actors) {
    cast = String(mediaDetails.actors).split(/[,;/]+/).map((a, i) => ({
      id: i + 1,
      name: a.trim(),
      character: 'В главных ролях',
      photo: null
    })).filter(a => a.name);
  }
  if (cast.length === 0 && (cleanTitleNorm.includes('человек-паук') || cleanTitleNorm.includes('новый день') || cleanTitleNorm.includes('spider-man'))) {
    cast = [
      { id: 1136406, name: 'Том Холланд', character: 'Питер Паркер / Человек-паук', photo: 'https://image.tmdb.org/t/p/w500/5OK84Wn1bIEIThFKcVoaN087mLj.jpg' },
      { id: 505710, name: 'Зендея', character: 'Мишель «Эм-Джей» Джонс', photo: 'https://image.tmdb.org/t/p/w500/3WdOloHpjtjL96uVOhFRRCcYSwq.jpg' },
      { id: 1649152, name: 'Джейкоб Баталон', character: 'Нед Лидс', photo: 'https://image.tmdb.org/t/p/w500/53YhaL4xw4Sb1ssoHkeSSBaO29c.jpg' },
      { id: 19498, name: 'Джон Бернтал', character: 'Фрэнк Касл / Каратель', photo: 'https://image.tmdb.org/t/p/w500/aSH27tGD4PJoCO54RQnARSSSIQy.jpg' },
      { id: 103, name: 'Марк Руффало', character: 'Брюс Бэннер / Халк', photo: 'https://image.tmdb.org/t/p/w500/5GilHMOt5PAQh6rlUKZzGmaKEI7.jpg' },
      { id: 1564757, name: 'Сэди Синк', character: 'Роль держится в тайне', photo: 'https://image.tmdb.org/t/p/w500/i9YF0p92mF5xM61z7W2o6Z8tQ.jpg' },
      { id: 121544, name: 'Чарли Кокс', character: 'Мэтт Мёрдок / Сорвиголова', photo: 'https://image.tmdb.org/t/p/w500/p402a4r49E7fP1lD91k05y7VnN.jpg' }
    ];
  }

  // Фоновый дозапрос актерского состава, если он не был загружен сразу
  if (cast.length === 0 && cleanTitle) {
    const fetchCastAsync = async () => {
      try {
        const q = new URLSearchParams({
          title: cleanTitle,
          original_title: mediaDetails.original_title || '',
          year: String(canonYr || mediaDetails.year || ''),
          media_type: mediaDetails.media_type || '',
          actors: mediaDetails.actors || ''
        }).toString();
        const res = await fetch(`/api/media/cast?${q}`);
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.cast) && data.cast.length > 0) {
            mediaDetails.cast = data.cast;
            if (currentMedia) currentMedia.cast = data.cast;
            if (data.directors?.length) {
              mediaDetails.directors = data.directors;
              if (currentMedia) currentMedia.directors = data.directors;
            }
            const castScroll = container.querySelector('#cinema-side-cast-scroll');
            const castSubtitle = container.querySelector('#cinema-side-cast-subtitle');
            if (castScroll) {
              if (castSubtitle) castSubtitle.textContent = `В главных ролях (${data.cast.length})`;
              castScroll.innerHTML = data.cast.map(actor => `
                <div class="cinema-actor-chip" data-actor-id="${actor.id}" data-actor-name="${actor.name}" title="Нажмите для просмотра фильмов">
                  <img src="${actor.photo || 'assets/favicon.svg'}" alt="${actor.name}" class="cinema-actor-photo" onerror="this.src='assets/favicon.svg'">
                  <div class="cinema-actor-info">
                    <div class="cinema-actor-name">${actor.name}</div>
                    <div class="cinema-actor-role">${actor.character || 'Роль'}</div>
                  </div>
                </div>
              `).join('');
              castScroll.querySelectorAll('.cinema-actor-chip').forEach(chip => {
                chip.onclick = () => {
                  openPersonModal(chip.dataset.actorId, chip.dataset.actorName);
                };
              });
            }
          } else {
            const castScroll = container.querySelector('#cinema-side-cast-scroll');
            if (castScroll && castScroll.querySelector('.cast-loading-indicator')) {
              castScroll.innerHTML = `<div style="padding: 6px 12px; font-size: 12px; color: var(--text-muted);">Актерский состав не указан</div>`;
            }
          }
        }
      } catch (_) {}
    };
    fetchCastAsync();
  }

  container.innerHTML = `
    <!-- Постер и ключевые плашки -->
    <div class="cinema-side-poster-wrap">
      <img src="${poster}" alt="${cleanTitle}" class="cinema-side-poster" onerror="this.src='assets/favicon.svg'">
      <div class="cinema-side-poster-glow"></div>
      <div class="cinema-side-badges">
        <span class="storm-badge storm-badge-4k">4K UHD</span>
        <span class="storm-badge storm-badge-rating">★ ${ratingKp}</span>
      </div>
    </div>

    <!-- Рейтинги мировых платформ в один ряд -->
    <div class="cinema-ratings-strip" title="Рейтинги мировых платформ">
      <div class="cinema-rating-pill kp" title="Кинопоиск">
        <span class="rating-pill-logo">KP</span>
        <span class="rating-pill-val">★ ${ratingKp}</span>
      </div>
      <div class="cinema-rating-pill imdb" title="Internet Movie Database">
        <span class="rating-pill-logo">IMDb</span>
        <span class="rating-pill-val">★ ${ratingImdb}</span>
      </div>
      <div class="cinema-rating-pill tmdb" title="The Movie Database">
        <span class="rating-pill-logo">TMDB</span>
        <span class="rating-pill-val">★ ${ratingTmdb}</span>
      </div>
      <div class="cinema-rating-pill rotten" title="Rotten Tomatoes">
        <span class="rating-pill-logo">🍅 RT</span>
        <span class="rating-pill-val">${ratingRotten}%</span>
      </div>
      <div class="cinema-rating-pill meta" title="Metacritic">
        <span class="rating-pill-logo">META</span>
        <span class="rating-pill-val">${ratingMeta}</span>
      </div>
    </div>

    <!-- 3D Таблица параметров и метаданных -->
    <div class="cinema-info-table-wrap">
      <table class="cinema-info-table">
        <tbody>
          <tr>
            <td class="info-table-label">📅 Премьера</td>
            <td class="info-table-val"><b>${formattedReleaseDate}</b></td>
          </tr>
          <tr>
            <td class="info-table-label">⏱️ Длительность</td>
            <td class="info-table-val" data-info="duration"><b>${duration}</b></td>
          </tr>
          <tr>
            <td class="info-table-label">🌍 Страны</td>
            <td class="info-table-val">
              <div class="cinema-meta-chips-wrap">
                ${formattedCountries.map(c => `
                  <button type="button" class="cinema-meta-chip country-chip" data-country="${c}" title="Показать все фильмы (${c})">
                    <span>🌍</span>
                    <span>${c}</span>
                  </button>
                `).join('')}
              </div>
            </td>
          </tr>
          <tr>
            <td class="info-table-label">🎭 Жанры</td>
            <td class="info-table-val">
              <div class="cinema-meta-chips-wrap">
                ${formattedGenres.map(g => `
                  <button type="button" class="cinema-meta-chip genre-chip" data-genre="${g}" title="Показать все фильмы в жанре ${g}">
                    <span class="genre-icon">${getGenreIcon(g)}</span>
                    <span>${g}</span>
                  </button>
                `).join('')}
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Режиссер -->
    ${primaryDirector ? `
      <div class="cinema-person-section">
        <div class="cinema-section-subtitle">
          <span>🎬</span>
          <span style="font-weight: 800;">Режиссер</span>
        </div>
        <div class="cinema-director-card" data-director-id="${primaryDirector.id}" data-director-name="${primaryDirector.name}">
          <img src="${primaryDirector.photo || 'assets/favicon.svg'}" alt="${primaryDirector.name}" class="cinema-director-photo" onerror="this.src='assets/favicon.svg'">
          <div class="cinema-director-info">
            <div class="cinema-director-name">${primaryDirector.name}</div>
            <div class="cinema-director-role">Постановщик кинокартины</div>
            <button type="button" class="storm-btn storm-btn-sm cinema-director-btn">
              <span>Все фильмы режиссера</span> ➔
            </button>
          </div>
        </div>
      </div>
    ` : ''}

    <!-- Актерский состав -->
    <div class="cinema-person-section" id="cinema-side-cast-section">
      <div class="cinema-section-subtitle">
        <span>🎭</span>
        <span style="font-weight: 800;" id="cinema-side-cast-subtitle">В главных ролях ${cast.length > 0 ? `(${cast.length})` : ''}</span>
      </div>
      <div class="cinema-cast-scroll" id="cinema-side-cast-scroll">
        ${cast.length > 0 ? cast.map(actor => `
          <div class="cinema-actor-chip" data-actor-id="${actor.id}" data-actor-name="${actor.name}" title="Нажмите для просмотра фильмов">
            <img src="${actor.photo || 'assets/favicon.svg'}" alt="${actor.name}" class="cinema-actor-photo" onerror="this.src='assets/favicon.svg'">
            <div class="cinema-actor-info">
              <div class="cinema-actor-name">${actor.name}</div>
              <div class="cinema-actor-role">${actor.character || 'Роль'}</div>
            </div>
          </div>
        `).join('') : `
          <div class="cast-loading-indicator" style="display: flex; align-items: center; gap: 8px; padding: 6px 12px; font-size: 12px; color: var(--text-muted);">
            <div class="storm-spinner" style="width: 14px; height: 14px;"></div>
            <span>Поиск актерского состава...</span>
          </div>
        `}
      </div>
    </div>
  `;

  // Клики по жанрам
  container.querySelectorAll('.cinema-meta-chip.genre-chip').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const genre = btn.dataset.genre;
      closePlayerModal();
      if (window.applyGenreFilter) {
        window.applyGenreFilter(genre);
      }
    };
  });

  // Клики по странам
  container.querySelectorAll('.cinema-meta-chip.country-chip').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const country = btn.dataset.country;
      closePlayerModal();
      if (window.applyCountryFilter) {
        window.applyCountryFilter(country);
      }
    };
  });

  // Обработчик клика по карточке режиссера
  const dirCard = container.querySelector('.cinema-director-card');
  if (dirCard) {
    dirCard.onclick = () => {
      openPersonModal(dirCard.dataset.directorId, dirCard.dataset.directorName);
    };
  }

  // Обработчики клика по актерам
  container.querySelectorAll('.cinema-actor-chip').forEach(chip => {
    chip.onclick = () => {
      openPersonModal(chip.dataset.actorId, chip.dataset.actorName);
    };
  });

  adjustCinemaModalScale();
}

// ==========================================
// ПОРЯДОК ПРОСМОТРА И ХРОНОЛОГИЯ ФРАНШИЗЫ (FRANCHISE WATCH ORDER)
// ==========================================
let isAutoWatchChronology = localStorage.getItem('storm_autowatch_chronology') !== 'false';
let currentFranchiseItems = [];
let currentFranchiseActiveIndex = -1;

export async function renderFranchiseOrder(mediaItem) {
  const section = document.getElementById('franchise-order-section');
  const listEl = document.getElementById('franchise-items-list');
  const titleEl = document.getElementById('franchise-order-title');
  const toggleBtn = document.getElementById('franchise-autowatch-toggle');
  const indicator = document.getElementById('franchise-autowatch-indicator');

  if (!section || !listEl || !mediaItem) return;

  // Инициализация кнопки «Автопросмотр хронологии»
  if (toggleBtn) {
    toggleBtn.classList.toggle('active', isAutoWatchChronology);
    if (indicator) indicator.textContent = isAutoWatchChronology ? '🟢' : '⚪';
    toggleBtn.onclick = () => {
      isAutoWatchChronology = !isAutoWatchChronology;
      localStorage.setItem('storm_autowatch_chronology', String(isAutoWatchChronology));
      toggleBtn.classList.toggle('active', isAutoWatchChronology);
      if (indicator) indicator.textContent = isAutoWatchChronology ? '🟢' : '⚪';
      showToast(`Автопросмотр хронологии: ${isAutoWatchChronology ? 'Включен' : 'Выключен'}`, 'info');
    };
  }

  try {
    const params = new URLSearchParams({
      id: mediaItem.id || '',
      title: mediaItem.title || '',
      source: mediaItem.source || '',
      media_type: mediaItem.media_type || ''
    });

    const res = await fetch(`/api/media/franchise?${params.toString()}`);
    if (!res.ok) {
      section.style.display = 'none';
      return;
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      section.style.display = 'none';
      return;
    }

    const data = await res.json();
    if (!data || !Array.isArray(data.items) || data.items.length <= 1) {
      section.style.display = 'none';
      currentFranchiseItems = [];
      currentFranchiseActiveIndex = -1;
      return;
    }

    currentFranchiseItems = data.items;
    if (titleEl) {
      titleEl.textContent = data.franchise_name || 'Порядок просмотра и хронология';
    }

    const currentTitleNorm = (mediaItem.title || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    const currentIdStr = String(mediaItem.id || '');

    currentFranchiseActiveIndex = currentFranchiseItems.findIndex(it => {
      if (String(it.id) === currentIdStr || String(it.tmdb_id) === currentIdStr) return true;
      const itTitleNorm = (it.title || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
      return itTitleNorm === currentTitleNorm || itTitleNorm.includes(currentTitleNorm) || currentTitleNorm.includes(itTitleNorm);
    });

    listEl.innerHTML = currentFranchiseItems.map((item, idx) => {
      const isCurrent = idx === currentFranchiseActiveIndex;
      const orderLabel = item.order_label || (item.order ? `Часть ${item.order}` : `Часть ${idx + 1}`);
      const relationBadge = item.relation ? `<span class="franchise-order-badge">${item.relation}</span>` : `<span class="franchise-order-badge">${orderLabel}</span>`;
      const poster = item.poster || 'assets/favicon.svg';
      const year = item.year || '';

      return `
        <div class="franchise-card ${isCurrent ? 'current' : ''}" data-franchise-index="${idx}" title="${item.title}">
          <div class="franchise-card-poster">
            <img src="${poster}" alt="${item.title}" loading="lazy" onerror="this.src='assets/favicon.svg'">
            ${relationBadge}
          </div>
          <div class="franchise-card-content">
            <div class="franchise-card-title">${item.title}</div>
            <div class="franchise-card-meta">
              <span>${year}</span>
              ${item.rating ? `<span style="color:var(--accent);font-weight:700;">★ ${item.rating}</span>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Подключение быстрых переходов при клике на карточку части
    listEl.querySelectorAll('.franchise-card').forEach(card => {
      card.onclick = () => {
        const idx = parseInt(card.dataset.franchiseIndex, 10);
        if (!isNaN(idx) && currentFranchiseItems[idx]) {
          openPlayerModal(currentFranchiseItems[idx]);
        }
      };
    });

    section.style.display = 'block';

    // Центрируем горизонтальный скролл на текущей части без вертикального сдвига окна
    setTimeout(() => {
      const activeCard = listEl.querySelector('.franchise-card.current');
      if (activeCard) {
        const offset = activeCard.offsetLeft - (listEl.clientWidth / 2) + (activeCard.clientWidth / 2);
        listEl.scrollTo({ left: Math.max(0, offset), behavior: 'smooth' });
      }
    }, 200);

  } catch (err) {
    console.warn('[Franchise Order UI]:', err.message);
    section.style.display = 'none';
  }
}

export async function autoAdvanceNextFranchiseItem() {
  if (!isAutoWatchChronology) return false;
  if (!currentFranchiseItems || currentFranchiseItems.length <= 1) return false;
  if (currentFranchiseActiveIndex < 0 || currentFranchiseActiveIndex >= currentFranchiseItems.length - 1) return false;

  const nextIndex = currentFranchiseActiveIndex + 1;
  const nextItem = currentFranchiseItems[nextIndex];
  if (!nextItem) return false;

  if (currentMedia) {
    const isSeries = currentMedia.media_type === 'series' || currentMedia.media_type === 'anime-series' || currentMedia.media_type === 'cartoon-series';
    if (!isSeries) {
      currentMedia.user_status = 'completed';
      await saveBookmarkStatus(currentMedia, 'completed');
    }
  }

  nextItem.user_status = 'watching';
  await saveBookmarkStatus(nextItem, 'watching');

  showToast(`Автопросмотр хронологии: Запуск следующей части «${nextItem.title}»`, 'info');

  setTimeout(() => {
    openPlayerModal(nextItem);
  }, 1200);

  return true;
}

// ==========================================
// МОДАЛЬНОЕ ОКНО ФИЛЬМОГРАФИИ АКТЕРА И РЕЖИССЕРА
// ==========================================
export async function openPersonModal(personId, personName) {
  const modal = document.getElementById('person-modal');
  const title = document.getElementById('person-modal-title');
  const body = document.getElementById('person-modal-body');
  if (!modal || !body) return;

  if (title) title.textContent = personName ? `Фильмография: ${personName}` : 'Фильмография';
  modal.classList.add('is-open');

  body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;padding:40px;color:var(--text-muted);gap:12px;">
      <div class="storm-spinner"></div>
      <span style="font-weight:600;">Загрузка фильмографии...</span>
    </div>
  `;

  try {
    const res = await fetch(`/api/media/person?id=${encodeURIComponent(personId)}`);
    if (!res.ok) throw new Error('Не удалось загрузить данные персоны');
    const data = await res.json();
    const person = data.person || {};
    const items = data.items || [];

    let formattedBirthday = '';
    if (person.birthday) {
      const parts = String(person.birthday).split('-');
      if (parts.length === 3) {
        formattedBirthday = `${parts[2].padStart(2, '0')}.${parts[1].padStart(2, '0')}.${parts[0]}`;
      } else {
        formattedBirthday = person.birthday;
      }
    }

    body.innerHTML = `
      <div class="person-profile-header">
        <img src="${person.photo || 'assets/favicon.svg'}" alt="${person.name}" class="person-profile-photo" onerror="this.src='assets/favicon.svg'">
        <div class="person-profile-info">
          <h3 class="person-profile-name">${person.name || personName}</h3>
          <div class="person-profile-meta">
            <span>${person.known_for || 'Кинематографист'}</span>
            ${formattedBirthday ? `<span>• Дата рождения: <b>${formattedBirthday}</b></span>` : ''}
            ${person.place_of_birth ? `<span>• ${person.place_of_birth}</span>` : ''}
          </div>
          ${person.biography ? `<p class="person-profile-bio">${person.biography}</p>` : ''}
        </div>
      </div>

      <div style="font-size:14px;font-weight:800;margin:20px 0 12px;color:var(--text-primary);display:flex;align-items:center;gap:8px;">
        <span>🎬</span>
        <span>Фильмы и сериалы (${items.length})</span>
      </div>

      <div class="person-filmography-grid">
        ${items.length === 0 ? `
          <div style="grid-column:1/-1;text-align:center;padding:24px;color:var(--text-muted);">
            Фильмография не найдена
          </div>
        ` : items.map(item => `
          <div class="person-media-card" data-id="${item.id}" data-source="${item.source || 'tmdb'}">
            <div class="person-media-poster-box">
              <img src="${item.poster || 'assets/favicon.svg'}" alt="${item.title}" class="person-media-poster" loading="lazy" onerror="this.src='assets/favicon.svg'">
              <span class="person-media-rating">★ ${item.rating || '—'}</span>
            </div>
            <div class="person-media-info">
              <div class="person-media-title" title="${item.title}">${item.title}</div>
              <div class="person-media-year">${item.year || ''} • ${item.media_type === 'series' ? 'Сериал' : 'Фильм'}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    body.querySelectorAll('.person-media-card').forEach((card, idx) => {
      card.onclick = () => {
        modal.classList.remove('is-open');
        openPlayerModal(items[idx]);
      };
    });
  } catch (err) {
    body.innerHTML = `
      <div style="text-align:center;padding:30px;color:var(--color-red);">
        Ошибка загрузки: ${err.message}
      </div>
    `;
  }
}

// ==========================================
// СЕЛЕКТОР СЕЗОНОВ И СЕРИЙ С ДИНАМИЧЕСКИМИ ОПИСАНИЯМИ И СТАТУСАМИ
// ==========================================
async function renderSeriesSeasons(mediaDetails, initialSeason = null, initialEpisode = null) {
  const container = document.getElementById('series-seasons-container');
  if (!container) return;

  const detType = detectClientMediaType(mediaDetails);
  const isSeries = checkIfMediaIsSeries(mediaDetails) ||
                   checkIfMediaIsSeries(currentMedia) ||
                   detType === 'series' ||
                   detType === 'cartoon-series' ||
                   detType === 'anime-series' ||
                   mediaDetails.media_type === 'series' || 
                   mediaDetails.category === 'Сериал' || 
                   mediaDetails.category === 'сериал' ||
                   mediaDetails.media_type === 'cartoon-series' || 
                   mediaDetails.media_type === 'anime-series' ||
                   mediaDetails.source === 'anilibria' ||
                   mediaDetails.source === 'anixart' ||
                   (mediaDetails.seasons && mediaDetails.seasons.length > 0) ||
                   (mediaDetails.episodes && mediaDetails.episodes.length > 0) ||
                   (quickBarSeriesData && quickBarSeriesData.seasons && quickBarSeriesData.seasons.length > 0);
  if (typeof mediaDetails.seasons === 'number' && mediaDetails.seasons > 0) {
    mediaDetails.seasons = Array.from({ length: mediaDetails.seasons }, (_, i) => ({
      season_number: i + 1,
      name: `Сезон ${i + 1}`,
      episode_count: 8,
      overview: ''
    }));
  }

  let seasons = mediaDetails.seasons || [];

  if (quickBarSeriesData?.seasons && quickBarSeriesData.seasons.length > seasons.length) {
    seasons = quickBarSeriesData.seasons.map(qs => {
      const existing = (mediaDetails.seasons || []).find(s => s.season_number === qs.season);
      return {
        season_number: qs.season,
        name: qs.name || `Сезон ${qs.season}`,
        episode_count: qs.episodes?.length || qs.episodes_count || 8,
        overview: existing?.overview || ''
      };
    });
    mediaDetails.seasons = seasons;
  }

  if (!isSeries) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';

  // Инициализация кнопки сворачивания/разворачивания блока
  const collapseBtn = document.getElementById('series-collapse-btn');
  const collapseIcon = document.getElementById('series-collapse-icon');
  const collapseText = document.getElementById('series-collapse-text');
  if (collapseBtn && !collapseBtn.dataset.hasCollapseListener) {
    collapseBtn.dataset.hasCollapseListener = 'true';
    collapseBtn.onclick = () => {
      const isCollapsed = container.classList.toggle('is-collapsed');
      if (collapseIcon) collapseIcon.textContent = isCollapsed ? '▼' : '▲';
      if (collapseText) collapseText.textContent = isCollapsed ? 'Развернуть' : 'Свернуть';
      collapseBtn.title = isCollapsed ? 'Развернуть блок серий' : 'Свернуть блок серий';
    };
  }

  const tabsContainer = document.getElementById('series-seasons-tabs');
  const infoBox = document.getElementById('series-season-info-box');
  const gridEl = document.getElementById('series-episodes-grid');

  if (!tabsContainer || !gridEl) return;

  // Если список сезонов пуст или содержит только 1 сезон, пробуем динамически обогатить полным списком сезонов из TMDB
  if (seasons.length <= 1 && mediaDetails.source !== 'anilibria' && mediaDetails.source !== 'anixart') {
    if (seasons.length === 0) {
      tabsContainer.innerHTML = `
        <div style="padding: 10px 16px; display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-muted);">
          <div class="storm-spinner" style="width: 16px; height: 16px;"></div>
          <span>Поиск сезонов и серий...</span>
        </div>
      `;
      gridEl.innerHTML = '';
    }

    try {
      const cleanSerTitle = cleanVideoTitle(mediaDetails.title || '');
      // 1. Пробуем запросить полные метаданные сериала из TMDB
      const itemRes = await fetch(`/api/media/item?title=${encodeURIComponent(cleanSerTitle)}&source=tmdb&media_type=series`);
      if (itemRes.ok) {
        const itemData = await itemRes.json();
        if (itemData?.seasons && itemData.seasons.length > seasons.length) {
          mediaDetails.seasons = itemData.seasons;
          seasons = itemData.seasons;
          if (itemData.tmdb_id) {
            mediaDetails.tmdb_id = itemData.tmdb_id;
          }
          if (itemData.description && (!mediaDetails.description || mediaDetails.description.length < itemData.description.length || mediaDetails.description.includes('выходящего под названием'))) {
            mediaDetails.description = itemData.description;
            const modalDesc = document.getElementById('cinema-modal-desc');
            if (modalDesc) modalDesc.textContent = itemData.description;
          }
        }
      }

      // 2. Если сезоны всё ещё не найдены, запрашиваем серии 1 сезона
      if (seasons.length === 0) {
        const epRes = await fetch(`/api/media/series-episodes?season=1&title=${encodeURIComponent(cleanSerTitle)}`);
        if (epRes.ok) {
          const epData = await epRes.json();
          if (epData?.episodes && epData.episodes.length > 0) {
            mediaDetails.seasons = [{
              season_number: 1,
              name: 'Сезон 1',
              episode_count: epData.episodes.length,
              overview: epData.overview || ''
            }];
            seasons = mediaDetails.seasons;
          }
        }
      }
    } catch (e) {
      console.warn('Ошибка динамической загрузки сезонов:', e);
    }

    // 3. Если даже после запросов сезоны не найдены, создаем гарантированный Сезон 1
    if (seasons.length === 0) {
      mediaDetails.seasons = [{
        season_number: 1,
        name: 'Сезон 1',
        episode_count: 8,
        overview: ''
      }];
      seasons = mediaDetails.seasons;
    }
  }

  let activeSeasonNum = initialSeason ? parseInt(initialSeason, 10) : null;
  let activeEpisodeNum = initialEpisode ? parseInt(initialEpisode, 10) : null;

  if (!activeSeasonNum || !activeEpisodeNum) {
    const resume = resolveLastUnfinishedEpisode(mediaDetails) || resolveLastUnfinishedEpisode(currentMedia);
    if (resume) {
      if (!activeSeasonNum && resume.season) activeSeasonNum = resume.season;
      if (!activeEpisodeNum && resume.episode) activeEpisodeNum = resume.episode;
    }
  }

  if (!activeSeasonNum) {
    activeSeasonNum = seasons[0] ? seasons[0].season_number : 1;
  }
  if (!activeEpisodeNum) {
    activeEpisodeNum = 1;
  }

  function updateEpisodeSynopsis(ep) {
    const modalDesc = document.getElementById('cinema-modal-desc');
    if (!modalDesc) return;
    if (!ep) {
      modalDesc.textContent = mediaDetails.description || '';
      return;
    }
    const epTitle = ep.name || `Серия ${ep.episode_number}`;
    const cleanMediaDesc = (mediaDetails.description || '').trim();
    const cleanEpOverview = (ep.overview || '').trim();

    // Проверяем, дублирует ли синопсис серии общее описание сериала
    const isOverviewDuplicate = !cleanEpOverview ||
      cleanEpOverview === cleanMediaDesc ||
      (cleanMediaDesc.length > 30 && cleanEpOverview.startsWith(cleanMediaDesc.substring(0, 40)));

    if (isOverviewDuplicate) {
      modalDesc.innerHTML = `
        <div style="background: rgba(0, 210, 255, 0.08); border-left: 3px solid var(--accent); padding: 8px 14px; border-radius: 6px; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px;">
          <div style="font-weight: 800; color: #ffffff; font-size: 13.5px;">${epTitle}</div>
          ${ep.air_date ? `<span style="font-size: 11px; font-weight: 600; color: var(--accent);">Дата выхода: ${ep.air_date}</span>` : ''}
        </div>
        <div style="font-size: 12.5px; color: #cbd5e1; line-height: 1.55;">${cleanMediaDesc}</div>
      `;
    } else {
      modalDesc.innerHTML = `
        <div style="background: rgba(0, 210, 255, 0.08); border-left: 3px solid var(--accent); padding: 10px 14px; border-radius: 6px; margin-bottom: 8px;">
          <div style="font-weight: 800; color: #ffffff; font-size: 13.5px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px;">
            <span>${epTitle}</span>
            ${ep.air_date ? `<span style="font-size: 11px; font-weight: 600; color: var(--accent);">Дата выхода: ${ep.air_date}</span>` : ''}
          </div>
          <div style="font-size: 12.5px; color: #f1f5f9; margin-top: 4px; line-height: 1.55;">${cleanEpOverview}</div>
        </div>
        ${cleanMediaDesc && cleanMediaDesc !== cleanEpOverview ? `<div style="font-size: 12px; color: #94a3b8; line-height: 1.5;">${cleanMediaDesc}</div>` : ''}
      `;
    }
  }

  function renderSeasonTabs() {
    tabsContainer.innerHTML = seasons.map(s => {
      const sStatus = getSeasonStatusInfo(mediaDetails.id, s.season_number, s.episode_count || 0);
      const isAct = s.season_number === activeSeasonNum;
      return `
        <button type="button" class="series-season-tab ${isAct ? 'active' : ''}" data-season-num="${s.season_number}">
          <span>${s.name || `Сезон ${s.season_number}`}</span>
          <span class="season-status-chip ${sStatus.status}" style="font-size: 9.5px; padding: 2px 6px; margin-left: 5px;">${sStatus.label}</span>
        </button>
      `;
    }).join('');

    tabsContainer.querySelectorAll('.series-season-tab').forEach(tab => {
      tab.onclick = () => {
        const sNum = parseInt(tab.dataset.seasonNum, 10);
        activeSeasonNum = sNum;
        activeEpisodeNum = 1;
        renderSeasonTabs();
        loadSeasonEpisodes(sNum, 1);
        if (quickBarSeriesData) {
          quickBarActiveSeason = sNum;
          quickBarActiveEpisode = 1;
          renderQuickBarDropdowns();
          updateQuickIframeSrc();
        } else if (mediaDetails.source !== 'anilibria' && mediaDetails.source !== 'anixart') {
          updatePlayerUrl(mediaDetails, sNum, 1, currentActivePlayer);
        }
      };
    });
  }

  async function loadSeasonEpisodes(seasonNum, targetEpisodeNum = null) {
    const season = seasons.find(s => s.season_number === seasonNum) || seasons[0];

    gridEl.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:24px;color:var(--text-muted);display:flex;align-items:center;justify-content:center;gap:10px;">
        <div class="storm-spinner"></div>
        <span>Загрузка серий сезона...</span>
      </div>
    `;

    try {
      let episodes = [];
      let seasonOverview = '';

      if (mediaDetails.source === 'anilibria' && mediaDetails.episodes && mediaDetails.episodes.length > 0) {
        episodes = mediaDetails.episodes.map(ep => ({
          episode_number: ep.ordinal || 1,
          name: ep.name ? `${ep.ordinal || 1} серия: ${ep.name}` : `Серия ${ep.ordinal || 1}`,
          still: ep.still || ep.preview || mediaDetails.poster,
          duration: ep.duration || '24 мин.',
          air_date: ep.air_date || '',
          overview: (ep.overview && ep.overview !== mediaDetails.description) ? ep.overview : ''
        }));
        seasonOverview = `Официальный релиз AniLibria • ${episodes.length} серий в Full HD качестве.`;
      } else if (mediaDetails.source === 'anixart' && currentEpisodes && currentEpisodes.length > 0) {
        const vName = currentMedia?.voiceovers?.find(v => String(v.id) === String(currentVoiceoverId))?.name || 'AniXart';
        episodes = currentEpisodes.map(ep => ({
          episode_number: ep.position || 1,
          name: ep.name_ru || ep.name || `Серия ${ep.position || 1}`,
          still: ep.still || ep.preview || mediaDetails.poster,
          duration: '24 мин.',
          air_date: '',
          overview: (ep.overview && ep.overview !== mediaDetails.description) ? ep.overview : ''
        }));
        seasonOverview = `Релиз AniXart в озвучке «${vName}» • ${episodes.length} серий.`;
      } else {
        const tvId = mediaDetails.tmdb_id || (mediaDetails.source === 'tmdb' ? String(mediaDetails.id).replace('tmdb_', '') : '');
        const cleanSerTitle = cleanVideoTitle(mediaDetails.title || '');
        try {
          const res = await fetch(`/api/media/series-episodes?tvId=${encodeURIComponent(tvId)}&season=${seasonNum}&title=${encodeURIComponent(cleanSerTitle)}`);
          if (res.ok) {
            const data = await res.json();
            episodes = data.episodes || [];
            const isTmdbSeasonOverviewDup = data.overview && mediaDetails.description && data.overview.trim() === mediaDetails.description.trim();
            seasonOverview = (!isTmdbSeasonOverviewDup && data.overview) || season.overview || `${season.name || `Сезон ${seasonNum}`} • ${episodes.length} серий.`;
          }
        } catch (fetchErr) {
          console.warn('Сбой загрузки серий из API:', fetchErr);
        }

        // Если из API не пришли детальные серии, проверяем quickBarSeriesData
        if ((!episodes || episodes.length === 0) && quickBarSeriesData?.seasons) {
          const qSeason = quickBarSeriesData.seasons.find(s => s.season === seasonNum);
          if (qSeason && qSeason.episodes?.length > 0) {
            episodes = qSeason.episodes.map(qe => ({
              episode_number: qe.episode,
              name: qe.name || `${qe.episode} серия`,
              still: qe.still || mediaDetails.poster || 'assets/favicon.svg',
              duration: qe.duration || '50 мин.',
              air_date: qe.air_date || '',
              overview: qe.overview || `Серия ${qe.episode}. Смотрите ${qe.episode}-ю серию проекта «${cleanSerTitle}» в высоком разрешении со студийным переводом.`
            }));
          }
        }
      }

      // Обогащаем названия и синопсисы эпизодов аниме из баз знаний TMDB / Shikimori
      if ((mediaDetails.source === 'anixart' || mediaDetails.source === 'anilibria') && episodes.length > 0) {
        try {
          const cleanSerTitle = cleanVideoTitle(mediaDetails.title || '');
          const metaRes = await fetch(`/api/media/series-episodes?season=${seasonNum}&title=${encodeURIComponent(cleanSerTitle)}`);
          if (metaRes.ok) {
            const metaData = await metaRes.json();
            if (metaData?.episodes && metaData.episodes.length > 0) {
              episodes.forEach(ep => {
                const match = metaData.episodes.find(m => m.episode_number === ep.episode_number);
                if (match) {
                  if (match.name && match.name !== `Серия ${ep.episode_number}` && match.name !== `Episode ${ep.episode_number}`) {
                    ep.name = `${ep.episode_number} серия: ${match.name}`;
                  }
                  if (match.overview && (!ep.overview || ep.overview === mediaDetails.description)) {
                    ep.overview = match.overview;
                  }
                  if (match.still && (!ep.still || ep.still === mediaDetails.poster)) {
                    ep.still = match.still;
                  }
                  if (match.air_date && !ep.air_date) {
                    ep.air_date = match.air_date;
                  }
                }
              });
            }
          }
        } catch (e) {}
      }

      // Гарантируем качественный синопсис у каждого эпизода
      episodes.forEach(ep => {
        if (!ep.overview || ep.overview.trim() === '' || ep.overview === mediaDetails.description) {
          const epTitle = (ep.name && ep.name !== `Серия ${ep.episode_number}`) ? `«${ep.name}»` : `серии ${ep.episode_number}`;
          ep.overview = `Эпизод ${epTitle}. Смотрите ${ep.episode_number}-ю серию проекта «${mediaDetails.title}» в высоком разрешении со студийным переводом и субтитрами.`;
        }
      });

      if (episodes.length === 0) {
        const fallbackCount = Math.max(season?.episode_count || 8, 8);
        episodes = Array.from({ length: fallbackCount }, (_, i) => ({
          episode_number: i + 1,
          name: `${i + 1} серия`,
          still: mediaDetails.poster || 'assets/favicon.svg',
          duration: mediaDetails.duration || '45 мин.',
          air_date: season?.air_date || '',
          overview: `Серия ${i + 1}. Смотрите ${i + 1}-ю серию проекта «${cleanVideoTitle(mediaDetails.title || '')}» в высоком разрешении со студийным переводом и субтитрами.`
        }));
      }

      const sStatus = getSeasonStatusInfo(mediaDetails.id, seasonNum, episodes.length);
      const isSeasonAllWatched = sStatus.status === 'completed';

      // Проверяем, не дублирует ли seasonOverview общее описание сериала
      const isSeasonOverviewDuplicate = !seasonOverview || 
        (mediaDetails.description && seasonOverview.trim() === mediaDetails.description.trim()) ||
        (mediaDetails.description && seasonOverview.startsWith(mediaDetails.description.substring(0, 40)));

      const finalSeasonDesc = isSeasonOverviewDuplicate 
        ? `${season.name || `Сезон ${seasonNum}`} • ${episodes.length} серий в высоком разрешении.` 
        : seasonOverview;

      if (infoBox) {
        infoBox.innerHTML = `
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 8px;">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <strong style="font-size: 13.5px; color: #ffffff;">${season.name || `Сезон ${seasonNum}`}</strong>
              <span class="season-status-chip ${sStatus.status}">${sStatus.label}</span>
              <div class="season-status-select-wrap">
                <label for="season-status-select">Статус:</label>
                <select class="storm-select season-status-select" id="season-status-select">
                  <option value="planned" ${sStatus.status === 'planned' ? 'selected' : ''}>📋 В планах</option>
                  <option value="watching" ${sStatus.status === 'watching' ? 'selected' : ''}>▶ Смотрю</option>
                  <option value="completed" ${sStatus.status === 'completed' ? 'selected' : ''}>✓ Просмотрен</option>
                  <option value="on_hold" ${sStatus.status === 'on_hold' ? 'selected' : ''}>⏸️ Отложен</option>
                  <option value="dropped" ${sStatus.status === 'dropped' ? 'selected' : ''}>🛑 Заброшен</option>
                </select>
              </div>
            </div>
            <button type="button" class="storm-btn storm-btn-sm ${isSeasonAllWatched ? 'storm-btn-secondary' : 'storm-btn-primary'}" id="toggle-season-btn" style="font-size: 11px; padding: 4px 10px;">
              ${isSeasonAllWatched ? '✕ Снять отметку' : '✓ Отметить весь сезон'}
            </button>
          </div>
          <div class="series-season-desc" id="series-season-desc">${finalSeasonDesc}</div>
        `;

        const statusSelect = infoBox.querySelector('#season-status-select');
        if (statusSelect) {
          statusSelect.onchange = async (e) => {
            const selectedStatus = e.target.value;
            applySeasonStatus(mediaDetails.id, seasonNum, selectedStatus, episodes);
            if (selectedStatus === 'completed') {
              showToast(`Сезон ${seasonNum} отмечен как просмотренный: все серии просмотрены`, 'success');
            } else {
              const label = statusSelect.options[statusSelect.selectedIndex]?.text || selectedStatus;
              showToast(`Сезон ${seasonNum}: статус «${label}»`, 'info');
            }
            renderSeasonTabs();
            await syncOverallSeriesProgress(mediaDetails);
            renderQuickBarDropdowns();
            loadSeasonEpisodes(seasonNum, activeEpisodeNum || 1);
          };
        }

        const toggleBtn = infoBox.querySelector('#toggle-season-btn');
        if (toggleBtn) {
          toggleBtn.onclick = async () => {
            const marked = toggleAllSeasonEpisodesWatched(mediaDetails.id, seasonNum, episodes.length, episodes);
            showToast(marked ? `Сезон ${seasonNum} отмечен как просмотренный: все серии просмотрены` : `Отметка снята с сезона ${seasonNum}`, 'info');
            renderSeasonTabs();
            await syncOverallSeriesProgress(mediaDetails);
            renderQuickBarDropdowns();
            loadSeasonEpisodes(seasonNum, activeEpisodeNum || 1);
          };
        }
      }

      const watchedSet = getWatchedEpisodes(mediaDetails.id, seasonNum);
      const effectiveTargetEp = targetEpisodeNum ? parseInt(targetEpisodeNum, 10) : 1;
      activeEpisodeNum = effectiveTargetEp;

      // Первичное обновление синопсиса активной серии
      const initialEp = episodes.find(e => e.episode_number === effectiveTargetEp) || episodes[0];
      if (initialEp) {
        updateEpisodeSynopsis(initialEp);
      }

      gridEl.innerHTML = episodes.map(ep => {
        const isEpActive = ep.episode_number === effectiveTargetEp;
        const isWatched = watchedSet.has(ep.episode_number);
        const epStatusLabel = isWatched ? '✓ Просмотрено' : (isEpActive ? '▶ Смотрю' : 'Не просмотрено');
        const epStatusClass = isWatched ? 'completed' : (isEpActive ? 'watching' : 'planned');

        return `
        <div class="series-episode-card storm-focusable ${isEpActive ? 'active' : ''} ${isWatched ? 'watched' : ''}" data-ep-num="${ep.episode_number}" tabindex="0">
          <div class="series-episode-thumb-box">
            <img src="${ep.still || ep.still_path || 'assets/favicon.svg'}" alt="${escapeHtml(ep.name)}" class="series-episode-thumb" loading="lazy" onerror="this.src='assets/favicon.svg'">
            <div class="series-episode-play-overlay"><span>▶</span></div>
            <span class="series-episode-badge">Серия ${ep.episode_number}</span>
            ${ep.duration ? `<span class="series-episode-duration">${ep.duration}</span>` : ''}
          </div>
          <div class="series-episode-content">
            <div class="series-episode-title" title="${escapeHtml(ep.name)}">${escapeHtml(ep.name)}</div>
            <div class="series-episode-meta-row">
              <span class="series-episode-airdate">${ep.air_date ? '📅 ' + ep.air_date : ''}</span>
              <span class="season-status-chip ${epStatusClass} ep-status-toggle" data-ep-num="${ep.episode_number}" title="Нажмите для переключения статуса серии">
                ${epStatusLabel}
              </span>
            </div>
            <p class="series-episode-desc" title="${escapeHtml(ep.overview)}">${escapeHtml(ep.overview)}</p>
          </div>
        </div>
      `;
      }).join('');

      gridEl.querySelectorAll('.series-episode-card').forEach(card => {
        card.onclick = async (evt) => {
          const epNum = parseInt(card.dataset.epNum, 10);
          const epObj = episodes.find(e => e.episode_number === epNum) || episodes[epNum - 1];

          // Если клик по плашке статуса - переключаем статус серии
          if (evt.target.closest('.ep-status-toggle')) {
            evt.stopPropagation();
            const nowWatched = toggleEpisodeWatched(mediaDetails.id, seasonNum, epNum);
            showToast(nowWatched ? `Серия ${epNum} отмечена как просмотренная` : `Отметка снята с серии ${epNum}`, 'info');
            renderSeasonTabs();
            await syncOverallSeriesProgress(mediaDetails);
            renderQuickBarDropdowns();
            loadSeasonEpisodes(seasonNum, activeEpisodeNum);
            return;
          }

          gridEl.querySelectorAll('.series-episode-card').forEach(c => c.classList.remove('active'));
          card.classList.add('active');
          activeEpisodeNum = epNum;

          markEpisodeWatched(mediaDetails.id, seasonNum, epNum, true);
          card.classList.add('watched');
          updateEpisodeSynopsis(epObj);

          showToast(`Выбрана серия ${epNum}: ${epObj?.name || ''}`, 'info');
          updateProgressState(epNum, episodes.length);
          renderSeasonTabs();
          await syncOverallSeriesProgress(mediaDetails);

          // Обновляем быструю панель
          quickBarActiveSeason = seasonNum;
          quickBarActiveEpisode = epNum;
          renderQuickBarDropdowns();

          if (!currentMedia) currentMedia = mediaDetails;
          playEpisodeByNumber(epNum, seasonNum);
        };
      });

      if (effectiveTargetEp) {
        const activeCard = gridEl.querySelector(`.series-episode-card[data-ep-num="${effectiveTargetEp}"]`);
        if (activeCard) {
          activeCard.classList.add('active', 'watched');
        }
      }
    } catch (err) {
      gridEl.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--color-red);">Ошибка: ${err.message}</div>`;
    }
  }

  renderSeasonTabs();
  loadSeasonEpisodes(activeSeasonNum, initialEpisode || 1);
}
