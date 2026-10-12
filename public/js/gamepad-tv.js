/* ==========================================================================
   STORM MULTIMEDIA - SMART TV И НАВИГАЦИЯ ГЕЙМПАДОМ (10-FOOT CONSOLE UI 2.0)
   Поддержка пультов Android TV / Smart TV, геймпадов Xbox / PlayStation,
   Leanback HUD 2.0 с динамическим авто-затуханием и полной навигацией во всех меню
   ========================================================================== */

import { showToast } from './auth.js';
import { trackClientAction } from './achievements.js';

let isTvModeActive = false;
let gamepadLoopId = null;
let lastButtonPressTimes = {};
let currentFocusedElement = null;
let currentHudContext = 'catalog';
let hudHideTimer = null;
let modalObserver = null;

// ==========================================
// 1. АУДИО-ЭФФЕКТЫ КОНСОЛИ (WEB AUDIO SYNTHESIZER)
// ==========================================
function getAudioContext() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!window._tvAudioCtx) {
    window._tvAudioCtx = new AudioCtx();
  }
  if (window._tvAudioCtx.state === 'suspended') {
    window._tvAudioCtx.resume().catch(() => {});
  }
  return window._tvAudioCtx;
}

function playTvFocusSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(460, now);
    osc.frequency.exponentialRampToValueAtTime(320, now + 0.04);

    gain.gain.setValueAtTime(0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.04);
  } catch {}
}

function playTvSelectSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(523.25, now); // C5
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.08); // A5

    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.09);
  } catch {}
}

function playTvBackSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.06);

    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.06);
  } catch {}
}

let airMouseTimer = null;
let lastMouseX = 0;
let lastMouseY = 0;

function handleAirMouseMove(e) {
  pokeTvHud();

  // Отсекаем естественный микро-дрейф гироскопа неподвижной аэромышки
  const dx = Math.abs(e.clientX - lastMouseX);
  const dy = Math.abs(e.clientY - lastMouseY);
  if (dx < 3 && dy < 3) return;
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;

  // Включаем активный режим аэромышки (показываем видимый курсор)
  if (!document.body.classList.contains('air-mouse-active')) {
    document.body.classList.add('air-mouse-active');
  }

  // При активном перемещении курсора аэромышки снимаем неоновый фокус D-Pad
  clearFocusRing();

  if (airMouseTimer) clearTimeout(airMouseTimer);
  airMouseTimer = setTimeout(() => {
    document.body.classList.remove('air-mouse-active');
  }, 5000);
}

// ==========================================
// 2. ИНИЦИАЛИЗАЦИЯ И РЕЖИМ ТЕЛЕВИЗОРА
// ==========================================
export function initGamepadAndTvMode() {
  const formFactor = localStorage.getItem('storm_form_factor') || 'auto';
  const savedTv = localStorage.getItem('storm_tv_mode') === 'true';
  const isExplicitTv = formFactor === 'tv';
  if (savedTv && isExplicitTv) {
    toggleTvMode(true);
  } else if (savedTv && formFactor !== 'tv') {
    // Сбрасываем ошибочно записанный ТВ-режим на ПК
    localStorage.removeItem('storm_tv_mode');
  }

  window.addEventListener('gamepadconnected', (e) => {
    const padName = (e.gamepad?.id || 'Геймпад').split('(')[0].trim();
    trackClientAction('use_gamepad');
    if (isTvModeActive) {
      showToast(`🎮 Подключен контроллер: ${padName}`, 'success');
      startGamepadPolling();
    } else {
      showToast(`🎮 Подключен контроллер: ${padName}. Управление активируется при включении ТВ-режима`, 'info');
    }
  });

  window.addEventListener('gamepaddisconnected', (e) => {
    const padName = (e.gamepad?.id || 'Геймпад').split('(')[0].trim();
    showToast(`🎮 Контроллер отключен: ${padName}`, 'info');
  });

  // Запускаем опрос только если ТВ-режим уже был активен из настроек
  if (isTvModeActive) {
    startGamepadPolling();
  }

  // Клавиатурная навигация и клавиши ТВ-пульта (Стрелки, Enter, Esc, MediaKeys, Цвета)
  window.addEventListener('keydown', handleSpatialKeyboard);

  // Глобальное пробуждение панели HUD и отслеживание курсора аэромышки
  window.addEventListener('mousemove', handleAirMouseMove, { passive: true });
  window.addEventListener('pointermove', handleAirMouseMove, { passive: true });
  window.addEventListener('touchstart', pokeTvHud, { passive: true });

  // Автоматический трекер модальных окон для HUD и фокуса
  setupModalFocusWatcher();
}

export function toggleTvMode(forceState = null) {
  isTvModeActive = forceState !== null ? forceState : !isTvModeActive;
  document.body.classList.toggle('tv-mode', isTvModeActive);
  localStorage.setItem('storm_tv_mode', isTvModeActive ? 'true' : 'false');

  const tvBtn = document.getElementById('toggle-tv-mode-btn');
  if (tvBtn) {
    tvBtn.classList.toggle('active', isTvModeActive);
    tvBtn.innerHTML = isTvModeActive ? '<span>📺</span> ТВ-режим: Вкл' : '<span>📺</span> ТВ-режим';
  }

  const drawerTvBtn = document.getElementById('drawer-tv-mode-btn');
  if (drawerTvBtn) {
    drawerTvBtn.classList.toggle('active', isTvModeActive);
    const titleEl = drawerTvBtn.querySelector('.mobile-nav-title');
    if (titleEl) {
      titleEl.textContent = isTvModeActive ? 'ТВ-режим (Включен)' : 'ТВ-режим';
    }
  }

  if (isTvModeActive) {
    showToast('📺 Активирован режим Smart TV (Leanback HUD 2.0)', 'info');
    renderTvHudBar();
    focusInitialElement();
    startGamepadPolling();
    trackClientAction('use_gamepad');
    playTvSelectSound();
  } else {
    showToast('Режим Smart TV выключен', 'info');
    removeTvHudBar();
    clearFocusRing();
    if (gamepadLoopId) {
      cancelAnimationFrame(gamepadLoopId);
      gamepadLoopId = null;
    }
    playTvBackSound();
  }
}

export function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      showToast('🖥️ Полноэкранный режим включен', 'info');
    } else {
      document.exitFullscreen().catch(() => {});
      showToast('Полноэкранный режим выключен', 'info');
    }
    playTvSelectSound();
  } catch {}
}

// ==========================================
// 3. ПАНЕЛЬ ПОДСКАЗОК LEANBACK HUD 2.0
// ==========================================
export function pokeTvHud() {
  const hud = document.getElementById('storm-tv-hud-bar');
  if (!hud) return;
  hud.classList.remove('is-dimmed');

  if (hudHideTimer) clearTimeout(hudHideTimer);
  hudHideTimer = setTimeout(() => {
    if (document.body.classList.contains('tv-mode')) {
      hud.classList.add('is-dimmed');
    }
  }, 4000);
}

function detectTvHudContext() {
  const cinemaModal = document.getElementById('cinema-modal');
  if (cinemaModal && (cinemaModal.classList.contains('is-open') || document.body.classList.contains('cinema-open'))) {
    return 'player';
  }
  const profileModal = document.getElementById('profile-modal');
  if (profileModal && profileModal.classList.contains('is-open')) {
    return 'profile';
  }
  const filterSheet = document.getElementById('filter-sheet-modal');
  if (filterSheet && filterSheet.classList.contains('is-open')) {
    return 'filter';
  }
  const actionSheet = document.getElementById('card-action-sheet-modal');
  if (actionSheet && actionSheet.classList.contains('is-open')) {
    return 'modal';
  }
  const anyModal = document.querySelector('.storm-modal-backdrop.is-open');
  if (anyModal) {
    return 'modal';
  }
  return 'catalog';
}

export function updateTvHudContext(forceContext = null) {
  if (!isTvModeActive && !document.body.classList.contains('tv-mode')) return;

  const context = forceContext || detectTvHudContext();
  currentHudContext = context;

  const hud = document.getElementById('storm-tv-hud-bar');
  if (!hud) return;

  let html = '';

  if (context === 'player') {
    html = `
      <div class="tv-hud-inner">
        <div class="tv-hud-item" id="tv-hud-btn-play"><span class="tv-key-badge btn-a">A / OK</span> <span class="tv-hud-label">Пауза / Плей</span></div>
        <div class="tv-hud-item" id="tv-hud-btn-seek"><span class="tv-key-badge btn-dpad">◄ ►</span> <span class="tv-hud-label">Перемотка</span></div>
        <div class="tv-hud-item" id="tv-hud-btn-vol"><span class="tv-key-badge btn-dpad">▲ ▼</span> <span class="tv-hud-label">Громкость</span></div>
        <div class="tv-hud-item" id="tv-hud-btn-episodes"><span class="tv-key-badge btn-x">X</span> <span class="tv-hud-label">Серии</span></div>
        <div class="tv-hud-item" id="tv-hud-btn-ambilight"><span class="tv-key-badge btn-y">Y</span> <span class="tv-hud-label">Ambilight</span></div>
        <div class="tv-hud-item" id="tv-hud-btn-back"><span class="tv-key-badge btn-b">B</span> <span class="tv-hud-label">Закрыть</span></div>
        <div class="tv-hud-item" id="tv-hud-fs-btn"><span class="tv-key-badge btn-menu">START</span> <span class="tv-hud-label">Экран</span></div>
      </div>
    `;
  } else if (context === 'profile') {
    html = `
      <div class="tv-hud-inner">
        <div class="tv-hud-item" id="tv-hud-btn-select"><span class="tv-key-badge btn-a">A / OK</span> <span class="tv-hud-label">Выбрать</span></div>
        <div class="tv-hud-item" id="tv-hud-btn-ptabs"><span class="tv-key-badge btn-bumper">LB / RB</span> <span class="tv-hud-label">Вкладки профиля</span></div>
        <div class="tv-hud-item"><span class="tv-key-badge btn-dpad">▲ ▼ ◄ ►</span> <span class="tv-hud-label">Навигация</span></div>
        <div class="tv-hud-item" id="tv-hud-btn-back"><span class="tv-key-badge btn-b">B</span> <span class="tv-hud-label">Закрыть</span></div>
      </div>
    `;
  } else if (context === 'filter') {
    html = `
      <div class="tv-hud-inner">
        <div class="tv-hud-item" id="tv-hud-btn-select"><span class="tv-key-badge btn-a">A / OK</span> <span class="tv-hud-label">Применить</span></div>
        <div class="tv-hud-item"><span class="tv-key-badge btn-dpad">▲ ▼ ◄ ►</span> <span class="tv-hud-label">Выбор фильтра</span></div>
        <div class="tv-hud-item" id="tv-hud-btn-back"><span class="tv-key-badge btn-b">B</span> <span class="tv-hud-label">Закрыть</span></div>
      </div>
    `;
  } else if (context === 'modal') {
    html = `
      <div class="tv-hud-inner">
        <div class="tv-hud-item" id="tv-hud-btn-select"><span class="tv-key-badge btn-a">A / OK</span> <span class="tv-hud-label">Выбрать</span></div>
        <div class="tv-hud-item"><span class="tv-key-badge btn-dpad">▲ ▼ ◄ ►</span> <span class="tv-hud-label">Навигация</span></div>
        <div class="tv-hud-item" id="tv-hud-btn-back"><span class="tv-key-badge btn-b">B</span> <span class="tv-hud-label">Закрыть</span></div>
      </div>
    `;
  } else {
    // Каталог
    html = `
      <div class="tv-hud-inner">
        <div class="tv-hud-item" id="tv-hud-btn-select"><span class="tv-key-badge btn-a">A / OK</span> <span class="tv-hud-label">Смотреть</span></div>
        <div class="tv-hud-item" id="tv-hud-btn-back"><span class="tv-key-badge btn-b">B</span> <span class="tv-hud-label">Назад</span></div>
        <div class="tv-hud-item" id="tv-hud-btn-bookmarks"><span class="tv-key-badge btn-x">X</span> <span class="tv-hud-label">Закладки</span></div>
        <div class="tv-hud-item" id="tv-hud-btn-search"><span class="tv-key-badge btn-y">Y</span> <span class="tv-hud-label">Поиск</span></div>
        <div class="tv-hud-item" id="tv-hud-btn-tabs"><span class="tv-key-badge btn-bumper">LB / RB</span> <span class="tv-hud-label">Вкладки</span></div>
        <div class="tv-hud-item" id="tv-hud-fs-btn"><span class="tv-key-badge btn-menu">START</span> <span class="tv-hud-label">Экран</span></div>
      </div>
    `;
  }

  hud.innerHTML = html;
  attachTvHudListeners(hud);
  pokeTvHud();
}

function attachTvHudListeners(hud) {
  hud.querySelector('#tv-hud-fs-btn')?.addEventListener('click', () => toggleFullscreen());
  hud.querySelector('#tv-hud-btn-select')?.addEventListener('click', () => pressFocusedElement());
  hud.querySelector('#tv-hud-btn-back')?.addEventListener('click', () => closeActiveModalOrBack());
  hud.querySelector('#tv-hud-btn-bookmarks')?.addEventListener('click', () => {
    window.switchTab?.('bookmarks');
    playTvSelectSound();
  });
  hud.querySelector('#tv-hud-btn-search')?.addEventListener('click', () => {
    const micBtn = document.getElementById('voice-search-btn');
    if (micBtn) micBtn.click();
    else document.getElementById('global-search-input')?.focus();
    playTvSelectSound();
  });
  hud.querySelector('#tv-hud-btn-tabs')?.addEventListener('click', () => switchAdjacentTab(1));
  hud.querySelector('#tv-hud-btn-ptabs')?.addEventListener('click', () => switchAdjacentProfileTab(1));
  hud.querySelector('#tv-hud-btn-play')?.addEventListener('click', () => handlePlayerTvPlayPause());
  hud.querySelector('#tv-hud-btn-episodes')?.addEventListener('click', () => focusPlayerEpisodes());
  hud.querySelector('#tv-hud-btn-ambilight')?.addEventListener('click', () => {
    document.getElementById('toggle-ambilight-btn')?.click();
  });
}

function renderTvHudBar() {
  let hud = document.getElementById('storm-tv-hud-bar');
  if (!hud) {
    hud = document.createElement('div');
    hud.id = 'storm-tv-hud-bar';
    hud.className = 'storm-tv-hud-bar';
    document.body.appendChild(hud);
  }
  updateTvHudContext();
  pokeTvHud();
}

function removeTvHudBar() {
  const hud = document.getElementById('storm-tv-hud-bar');
  if (hud) hud.remove();
  if (hudHideTimer) clearTimeout(hudHideTimer);
}

function setupModalFocusWatcher() {
  if (modalObserver) return;
  let lastState = '';

  modalObserver = new MutationObserver(() => {
    const openModal = document.querySelector('.storm-modal-backdrop.is-open');
    const playerOpen = document.body.classList.contains('cinema-open') || Boolean(document.getElementById('cinema-modal')?.classList.contains('is-open'));
    const currentState = (openModal ? openModal.id : '') + ':' + (playerOpen ? 'cinema' : '');

    if (currentState !== lastState) {
      lastState = currentState;
      updateTvHudContext();

      if (isTvModeActive) {
        if (openModal) {
          focusInitialElementInContainer(openModal);
        } else if (!currentFocusedElement || !document.body.contains(currentFocusedElement)) {
          focusInitialElement();
        }
      }
    }
  });

  modalObserver.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class', 'style'] });
}

function focusInitialElementInContainer(container) {
  if (!container) return;

  // Если это окно профиля — фокусируем активную вкладку
  if (container.id === 'profile-modal') {
    const activeTab = container.querySelector('.profile-tab-link.active') || container.querySelector('.profile-tab-link');
    if (activeTab) {
      setFocusTo(activeTab);
      return;
    }
  }

  // Если это шторка фильтров — фокусируем активный чип или кнопку применить
  if (container.id === 'filter-sheet-modal') {
    const activeChip = container.querySelector('.filter-chip.is-active') || container.querySelector('.filter-chip') || document.getElementById('filter-sheet-apply-btn');
    if (activeChip) {
      setFocusTo(activeChip);
      return;
    }
  }

  // Если это карточка быстрых действий — фокусируем кнопку «Смотреть»
  if (container.id === 'card-action-sheet-modal') {
    const playBtn = container.querySelector('.action-sheet-btn') || container.querySelector('button');
    if (playBtn) {
      setFocusTo(playBtn);
      return;
    }
  }

  // Если это кинотеатр — фокусируем селектор плеера или контейнер видео
  if (container.id === 'cinema-modal') {
    const trigger = document.getElementById('player-source-trigger');
    if (trigger) {
      setFocusTo(trigger);
      return;
    }
  }

  const focusables = getFocusableElements();
  const inside = focusables.filter(el => container.contains(el));
  if (inside.length > 0) {
    setFocusTo(inside[0]);
  }
}

// ==========================================
// 4. УПРАВЛЕНИЕ ВИДЕОПЛЕЕРОМ В ТВ-РЕЖИМЕ
// ==========================================
function handlePlayerTvSeek(deltaSeconds) {
  const video = document.querySelector('.cinema-player-wrapper video');
  if (video) {
    video.currentTime = Math.max(0, Math.min(video.duration || 999999, video.currentTime + deltaSeconds));
    showToast(deltaSeconds > 0 ? `⏩ +${deltaSeconds} сек` : `⏪ ${deltaSeconds} сек`, 'info');
    playTvFocusSound();
    return;
  }
  const iframe = document.querySelector('.cinema-player-iframe');
  if (iframe && iframe.contentWindow) {
    iframe.contentWindow.postMessage({ event: 'seek', val: deltaSeconds }, '*');
    showToast(deltaSeconds > 0 ? `⏩ +${deltaSeconds} сек` : `⏪ ${deltaSeconds} сек`, 'info');
    playTvFocusSound();
  }
}

function handlePlayerTvVolume(deltaVolume) {
  const video = document.querySelector('.cinema-player-wrapper video');
  if (video) {
    video.volume = Math.max(0, Math.min(1, video.volume + deltaVolume));
    const percent = Math.round(video.volume * 100);
    showToast(`🔊 Громкость: ${percent}%`, 'info');
    playTvFocusSound();
  }
}

function handlePlayerTvPlayPause() {
  const video = document.querySelector('.cinema-player-wrapper video');
  if (video) {
    if (video.paused) {
      video.play().catch(() => {});
      showToast('▶ Воспроизведение', 'info');
    } else {
      video.pause();
      showToast('⏸ Пауза', 'info');
    }
    playTvSelectSound();
    return;
  }
  const iframe = document.querySelector('.cinema-player-iframe');
  if (iframe && iframe.contentWindow) {
    iframe.contentWindow.postMessage({ event: 'toggle' }, '*');
    playTvSelectSound();
  }
}

function focusPlayerEpisodes() {
  const episode = document.querySelector('.series-episode-card.active') ||
                  document.querySelector('.series-episode-card') ||
                  document.querySelector('.episode-pill.active') ||
                  document.querySelector('.episode-pill');
  if (episode) {
    setFocusTo(episode);
    playTvFocusSound();
    return;
  }
  // Если блок свернут — разворачиваем его
  const collapseBtn = document.getElementById('series-collapse-btn');
  if (collapseBtn) {
    collapseBtn.click();
    setTimeout(() => {
      const ep = document.querySelector('.series-episode-card');
      if (ep) setFocusTo(ep);
    }, 200);
  }
}

function switchAdjacentPlayerEpisode(direction) {
  const episodes = Array.from(document.querySelectorAll('.series-episode-card, .episode-pill'));
  if (episodes.length === 0) return;

  const activeIndex = episodes.findIndex(ep => ep.classList.contains('active') || ep.classList.contains('current'));
  let newIndex = activeIndex >= 0 ? activeIndex + direction : 0;
  if (newIndex < 0) newIndex = 0;
  if (newIndex >= episodes.length) newIndex = episodes.length - 1;

  episodes[newIndex].click();
  setFocusTo(episodes[newIndex]);
  playTvSelectSound();
}

function switchAdjacentProfileTab(direction) {
  const tabs = Array.from(document.querySelectorAll('.profile-tab-link'));
  if (tabs.length === 0) return;

  const activeIndex = tabs.findIndex(t => t.classList.contains('active'));
  let newIndex = activeIndex >= 0 ? activeIndex + direction : 0;
  if (newIndex < 0) newIndex = tabs.length - 1;
  if (newIndex >= tabs.length) newIndex = 0;

  tabs[newIndex].click();
  setFocusTo(tabs[newIndex]);
  playTvSelectSound();
}

// ==========================================
// 5. ЦИКЛ ОПРОСА ГЕЙМПАДА
// ==========================================
function startGamepadPolling() {
  if (!isTvModeActive) {
    if (gamepadLoopId) {
      cancelAnimationFrame(gamepadLoopId);
      gamepadLoopId = null;
    }
    return;
  }
  if (gamepadLoopId) return;

  function poll() {
    if (!isTvModeActive) {
      gamepadLoopId = null;
      return;
    }
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < gamepads.length; i++) {
      const gp = gamepads[i];
      if (gp && gp.connected) {
        handleGamepadInput(gp);
        break;
      }
    }
    gamepadLoopId = requestAnimationFrame(poll);
  }

  gamepadLoopId = requestAnimationFrame(poll);
}

function handleGamepadInput(gp) {
  if (!isTvModeActive) return;
  const now = Date.now();
  const deadzone = 0.45;

  const canTrigger = (btnIndex, cooldownMs = 220) => {
    const last = lastButtonPressTimes[btnIndex] || 0;
    if (now - last > cooldownMs) {
      lastButtonPressTimes[btnIndex] = now;
      return true;
    }
    return false;
  };

  const up = gp.buttons[12]?.pressed || gp.axes[1] < -deadzone;
  const down = gp.buttons[13]?.pressed || gp.axes[1] > deadzone;
  const left = gp.buttons[14]?.pressed || gp.axes[0] < -deadzone;
  const right = gp.buttons[15]?.pressed || gp.axes[0] > deadzone;

  if (up || down || left || right || gp.buttons.some(b => b?.pressed)) {
    pokeTvHud();
  }

  const isPlayerOpen = Boolean(document.body.classList.contains('cinema-open') || (document.getElementById('cinema-modal') || document.getElementById('cinema-modal-backdrop'))?.classList.contains('is-open'));

  // Проверяем, находится ли фокус прямо на видео или контейнере плеера
  const isDirectVideoFocus = currentFocusedElement && (
    currentFocusedElement.tagName === 'VIDEO' ||
    currentFocusedElement.classList.contains('cinema-player-iframe') ||
    currentFocusedElement.classList.contains('cinema-player-container') ||
    currentFocusedElement.classList.contains('cinema-player-wrapper') ||
    currentFocusedElement.classList.contains('player-video-box') ||
    currentFocusedElement.id === 'cinema-modal'
  );

  // 1. Управление в открытом плеере
  if (isPlayerOpen) {
    // Аппаратные триггеры LT / RT (buttons 6 и 7) всегда перематывают видео
    if (gp.buttons[6]?.pressed && canTrigger('lt_seek', 300)) {
      handlePlayerTvSeek(-10);
      return;
    }
    if (gp.buttons[7]?.pressed && canTrigger('rt_seek', 300)) {
      handlePlayerTvSeek(10);
      return;
    }

    // Кнопка X (Серии)
    if (gp.buttons[2]?.pressed && canTrigger(2, 350)) {
      focusPlayerEpisodes();
      return;
    }

    // Кнопка Y (Ambilight)
    if (gp.buttons[3]?.pressed && canTrigger(3, 350)) {
      document.getElementById('toggle-ambilight-btn')?.click();
      return;
    }

    // LB / RB: Переключение серий
    if (gp.buttons[4]?.pressed && canTrigger(4, 280)) {
      switchAdjacentPlayerEpisode(-1);
      return;
    }
    if (gp.buttons[5]?.pressed && canTrigger(5, 280)) {
      switchAdjacentPlayerEpisode(1);
      return;
    }

    // Кнопка B: Закрыть плеер
    if (gp.buttons[1]?.pressed && canTrigger(1, 350)) {
      closeActiveModalOrBack();
      return;
    }

    // Если фокус на видео: стрелки управляют перемоткой и громкостью
    if (isDirectVideoFocus) {
      if (left && canTrigger('seek_left', 300)) {
        handlePlayerTvSeek(-10);
        return;
      }
      if (right && canTrigger('seek_right', 300)) {
        handlePlayerTvSeek(10);
        return;
      }
      if (up && canTrigger('vol_up', 200)) {
        handlePlayerTvVolume(0.1);
        return;
      }
      if (down && canTrigger('dpad_down', 250)) {
        // Смещение фокуса с видео на кнопки управления ниже
        moveFocus('down');
        return;
      }
      // Кнопка A на видео — Плей/Пауза
      if (gp.buttons[0]?.pressed && canTrigger(0, 350)) {
        handlePlayerTvPlayPause();
        return;
      }
    } else {
      // Фокус на органах управления плеера (серии, озвучка, селектор плеера, закладки)
      if (up && canTrigger('dpad_up')) moveFocus('up');
      if (down && canTrigger('dpad_down')) moveFocus('down');
      if (left && canTrigger('dpad_left')) moveFocus('left');
      if (right && canTrigger('dpad_right')) moveFocus('right');

      if (gp.buttons[0]?.pressed && canTrigger(0, 300)) {
        pressFocusedElement();
        return;
      }
    }
  }

  // 2. Управление в окне профиля пользователя
  const isProfileOpen = Boolean(document.getElementById('profile-modal')?.classList.contains('is-open'));
  if (isProfileOpen) {
    if (gp.buttons[4]?.pressed && canTrigger(4, 250)) {
      switchAdjacentProfileTab(-1);
      return;
    }
    if (gp.buttons[5]?.pressed && canTrigger(5, 250)) {
      switchAdjacentProfileTab(1);
      return;
    }
  }

  // 3. Стандартная пространственная навигация
  if (up && canTrigger('dpad_up')) moveFocus('up');
  if (down && canTrigger('dpad_down')) moveFocus('down');
  if (left && canTrigger('dpad_left')) moveFocus('left');
  if (right && canTrigger('dpad_right')) moveFocus('right');

  // Кнопка A (Клик)
  if (gp.buttons[0]?.pressed && canTrigger(0, 300)) {
    pressFocusedElement();
  }

  // Кнопка B (Назад / Закрыть)
  if (gp.buttons[1]?.pressed && canTrigger(1, 300)) {
    closeActiveModalOrBack();
  }

  // Кнопка X (Закладки) — только если нет открытого модального окна
  if (gp.buttons[2]?.pressed && canTrigger(2, 300) && !document.querySelector('.storm-modal-backdrop.is-open')) {
    window.switchTab?.('bookmarks');
    playTvSelectSound();
  }

  // Кнопка Y (Поиск) — только если нет открытого модального окна
  if (gp.buttons[3]?.pressed && canTrigger(3, 300) && !document.querySelector('.storm-modal-backdrop.is-open')) {
    const micBtn = document.getElementById('voice-search-btn');
    if (micBtn) {
      micBtn.click();
    } else {
      document.getElementById('global-search-input')?.focus();
    }
    playTvSelectSound();
  }

  // LB (Предыдущая вкладка) — только в каталоге
  if (gp.buttons[4]?.pressed && canTrigger(4, 250) && !document.querySelector('.storm-modal-backdrop.is-open')) {
    switchAdjacentTab(-1);
  }

  // RB (Следующая вкладка) — только в каталоге
  if (gp.buttons[5]?.pressed && canTrigger(5, 250) && !document.querySelector('.storm-modal-backdrop.is-open')) {
    switchAdjacentTab(1);
  }

  // Start (Кнопка 9) — Полноэкранный режим
  if (gp.buttons[9]?.pressed && canTrigger(9, 450)) {
    toggleFullscreen();
  }
}

// ==========================================
// 6. КЛАВИАТУРНАЯ И ДИСТАНЦИОННАЯ НАВИГАЦИЯ (SMART TV ПУЛЬТ)
// ==========================================
function handleSpatialKeyboard(e) {
  pokeTvHud();

  // При нажатии любых клавиш пульта/клавиатуры сбрасываем режим парения аэромышки
  if (document.body.classList.contains('air-mouse-active')) {
    document.body.classList.remove('air-mouse-active');
  }
  if (airMouseTimer) {
    clearTimeout(airMouseTimer);
    airMouseTimer = null;
  }

  const isPlayerOpen = Boolean(document.body.classList.contains('cinema-open') || (document.getElementById('cinema-modal') || document.getElementById('cinema-modal-backdrop'))?.classList.contains('is-open'));
  const isProfileOpen = Boolean(document.getElementById('profile-modal')?.classList.contains('is-open'));

  // Проверяем, находится ли фокус прямо на текстовом поле ввода
  if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
    // Разрешаем закрытие по Escape/Back
    if (e.key === 'Escape' || e.keyCode === 4 || e.keyCode === 27) {
      e.target.blur();
      closeActiveModalOrBack();
    }
    return;
  }

  const k = e.key;
  const c = e.keyCode;

  // Определение клавиш пульта ТВ / D-Pad
  const isDpadOrRemoteKey = [
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Up', 'Down', 'Left', 'Right',
    'Select', 'GoBack', 'Back', 'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
    'ChannelUp', 'ChannelDown', 'MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop',
    'MediaFastForward', 'MediaRewind', 'MediaTrackNext', 'MediaTrackPrevious'
  ].includes(k) || [
    19, 20, 21, 22, 23, 66, 4, 13, 27, 8, 85, 126, 127, 86, 87, 88, 89, 90,
    166, 167, 176, 177, 178, 179, 227, 228, 403, 404, 405, 406, 10009, 461
  ].includes(c);

  // Если ТВ-режим не активен — обычная работа браузера на ПК (стрелки прокручивают страницу, Escape закрывает модалки)
  if (!isTvModeActive) {
    if (e.key === 'Escape' || e.keyCode === 27) {
      if (document.querySelector('.storm-modal-backdrop.is-open')) {
        e.preventDefault();
        closeActiveModalOrBack();
      }
    }
    return;
  }

  const isDirectVideoFocus = currentFocusedElement && (
    currentFocusedElement.tagName === 'VIDEO' ||
    currentFocusedElement.classList.contains('cinema-player-iframe') ||
    currentFocusedElement.classList.contains('cinema-player-container') ||
    currentFocusedElement.classList.contains('cinema-player-wrapper') ||
    currentFocusedElement.classList.contains('player-video-box') ||
    currentFocusedElement.id === 'cinema-modal'
  );

  // 1. Выделенные аппаратные мультимедийные клавиши ТВ-пультов и громкость
  if (k === 'AudioVolumeUp' || c === 24) {
    e.preventDefault();
    handlePlayerTvVolume(0.1);
    return;
  }
  if (k === 'AudioVolumeDown' || c === 25) {
    e.preventDefault();
    handlePlayerTvVolume(-0.1);
    return;
  }
  if (k === 'MediaPlayPause' || k === 'MediaPlay' || k === 'MediaPause' || c === 85 || c === 179 || c === 126 || c === 127) {
    e.preventDefault();
    handlePlayerTvPlayPause();
    return;
  }
  if (k === 'MediaFastForward' || k === 'MediaTrackNext' || c === 228 || c === 176 || c === 90 || c === 87) {
    e.preventDefault();
    if (isPlayerOpen) handlePlayerTvSeek(10);
    return;
  }
  if (k === 'MediaRewind' || k === 'MediaTrackPrevious' || c === 227 || c === 177 || c === 89 || c === 88) {
    e.preventDefault();
    if (isPlayerOpen) handlePlayerTvSeek(-10);
    return;
  }

  // 2. Цветные функциональные кнопки пульта Smart TV
  // Красная кнопка (Red, 403): Закладки
  if (k === 'ColorF0Red' || c === 403) {
    e.preventDefault();
    window.switchTab?.('bookmarks');
    playTvSelectSound();
    return;
  }
  // Зеленая кнопка (Green, 404): Шторка фильтров
  if (k === 'ColorF1Green' || c === 404) {
    e.preventDefault();
    const filterTrigger = document.getElementById('mobile-filter-sheet-trigger');
    if (filterTrigger) filterTrigger.click();
    else if (typeof window.toggleFiltersCollapsible === 'function') window.toggleFiltersCollapsible();
    playTvSelectSound();
    return;
  }
  // Желтая кнопка (Yellow, 405): Озвучка / Плеер / Ambilight
  if (k === 'ColorF2Yellow' || c === 405) {
    e.preventDefault();
    if (isPlayerOpen) {
      document.getElementById('toggle-ambilight-btn')?.click();
    } else {
      const micBtn = document.getElementById('voice-search-btn');
      if (micBtn) micBtn.click();
    }
    playTvSelectSound();
    return;
  }
  // Синяя кнопка (Blue, 406): Поиск
  if (k === 'ColorF3Blue' || c === 406) {
    e.preventDefault();
    document.getElementById('global-search-input')?.focus();
    playTvSelectSound();
    return;
  }

  // 3. Клавиши каналов (ChannelUp / ChannelDown) и PageUp / PageDown
  if (k === 'ChannelUp' || k === 'PageUp' || c === 33 || c === 166) {
    e.preventDefault();
    if (isProfileOpen) switchAdjacentProfileTab(1);
    else if (isPlayerOpen) switchAdjacentPlayerEpisode(1);
    else switchAdjacentTab(1);
    return;
  }
  if (k === 'ChannelDown' || k === 'PageDown' || c === 34 || c === 167) {
    e.preventDefault();
    if (isProfileOpen) switchAdjacentProfileTab(-1);
    else if (isPlayerOpen) switchAdjacentPlayerEpisode(-1);
    else switchAdjacentTab(-1);
    return;
  }

  // 4. Кнопка меню ТВ-пульта (Menu / ContextMenu / KEYCODE_MENU 82)
  if (k === 'ContextMenu' || k === 'Menu' || c === 93 || c === 82 || c === 18) {
    e.preventDefault();
    if (isPlayerOpen) {
      document.getElementById('player-source-trigger')?.click();
    } else {
      document.getElementById('mobile-filter-sheet-trigger')?.click();
    }
    playTvSelectSound();
    return;
  }

  // 5. Навигационные стрелки пульта и D-Pad (Вверх, Вниз, Влево, Вправо)
  if (k === 'ArrowUp' || k === 'Up' || c === 19 || c === 38) {
    e.preventDefault();
    if (isPlayerOpen && isDirectVideoFocus) handlePlayerTvVolume(0.1);
    else moveFocus('up');
    return;
  }
  if (k === 'ArrowDown' || k === 'Down' || c === 20 || c === 40) {
    e.preventDefault();
    if (isPlayerOpen && isDirectVideoFocus) handlePlayerTvVolume(-0.1);
    else moveFocus('down');
    return;
  }
  if (k === 'ArrowLeft' || k === 'Left' || c === 21 || c === 37) {
    e.preventDefault();
    if (isPlayerOpen && isDirectVideoFocus) handlePlayerTvSeek(-10);
    else moveFocus('left');
    return;
  }
  if (k === 'ArrowRight' || k === 'Right' || c === 22 || c === 39) {
    e.preventDefault();
    if (isPlayerOpen && isDirectVideoFocus) handlePlayerTvSeek(10);
    else moveFocus('right');
    return;
  }

  // 6. Пробел (Пауза в плеере)
  if (k === ' ' || c === 32) {
    if (isPlayerOpen) {
      e.preventDefault();
      handlePlayerTvPlayPause();
      return;
    }
  }

  // 7. Подтверждение / Клик (Enter, Select, DPAD_CENTER / KEYCODE_ENTER 66, KEYCODE_DPAD_CENTER 23)
  if (k === 'Enter' || k === 'Select' || c === 13 || c === 23 || c === 66) {
    e.preventDefault();
    pressFocusedElement();
    return;
  }

  // 8. Назад (Escape, Backspace, GoBack, Back, Android KeyCode 4, Tizen 10009, WebOS 461)
  if (k === 'Escape' || k === 'Backspace' || k === 'GoBack' || k === 'Back' || c === 27 || c === 8 || c === 4 || c === 10009 || c === 461) {
    e.preventDefault();
    closeActiveModalOrBack();
    return;
  }

  // 9. Полноэкранный режим (Клавиша F)
  if (k === 'f' || k === 'F' || k === 'а' || k === 'А') {
    if (isTvModeActive) {
      e.preventDefault();
      toggleFullscreen();
      return;
    }
  }
}

// ==========================================
// 7. ДВИЖОК ПРОСТРАНСТВЕННОГО ФОКУСА (SPATIAL ENGINE)
// ==========================================
function getFocusableElements() {
  const activeModal = document.querySelector('.storm-modal-backdrop.is-open');
  const root = activeModal || document;

  // Если открыто выпадающее меню выбора плеера — ограничиваем фокус его элементами
  const playerMenu = document.getElementById('player-source-menu');
  if (playerMenu && playerMenu.style.display === 'block') {
    const menuItems = Array.from(playerMenu.querySelectorAll('.player-dropdown-item'));
    if (menuItems.length > 0) return menuItems;
  }

  const selector = `
    button:not([disabled]),
    [tabindex="0"],
    .media-card,
    .media-detailed-card,
    .media-table-table tbody tr,
    .series-episode-card,
    .series-season-tab,
    .episode-pill,
    .voiceover-pill,
    .filter-chip,
    .profile-tab-link,
    .profile-avatar-preset-item,
    .action-sheet-btn,
    .cal-card,
    .rail-card,
    .hero-slide,
    .storm-tab-btn,
    .storm-filters-toggle-btn,
    .quick-dropdown-trigger,
    .player-dropdown-trigger,
    .player-dropdown-item,
    .player-fallback-btn,
    .storm-modal-tool-btn,
    .storm-modal-fullscreen-btn,
    .storm-modal-close,
    .storm-focusable,
    select:not([disabled]),
    input:not([disabled])
  `;

  return Array.from(root.querySelectorAll(selector)).filter(el => {
    if (el.classList.contains('media-card-menu-btn')) return false;
    return el.offsetParent !== null && window.getComputedStyle(el).display !== 'none' && window.getComputedStyle(el).visibility !== 'hidden';
  });
}

function moveFocus(direction) {
  const focusables = getFocusableElements();
  if (focusables.length === 0) return;

  const isPlayerOpen = Boolean(document.body.classList.contains('cinema-open') || (document.getElementById('cinema-modal') || document.getElementById('cinema-modal-backdrop'))?.classList.contains('is-open'));

  if (!currentFocusedElement || !document.body.contains(currentFocusedElement)) {
    focusInitialElement();
    return;
  }

  const currentRect = currentFocusedElement.getBoundingClientRect();
  let bestCandidate = null;
  let bestDistance = Infinity;

  focusables.forEach(el => {
    if (el === currentFocusedElement) return;
    const rect = el.getBoundingClientRect();

    let isMatch = false;
    let dist = Infinity;

    if (direction === 'up' && rect.bottom <= currentRect.top + 10) {
      isMatch = true;
      dist = Math.hypot(currentRect.left - rect.left, (currentRect.top - rect.bottom) * 2);
    } else if (direction === 'down' && rect.top >= currentRect.bottom - 10) {
      isMatch = true;
      dist = Math.hypot(currentRect.left - rect.left, (rect.top - currentRect.bottom) * 2);
    } else if (direction === 'left' && rect.right <= currentRect.left + 10) {
      isMatch = true;
      dist = Math.hypot((currentRect.top - rect.top) * 2, currentRect.left - rect.right);
    } else if (direction === 'right' && rect.left >= currentRect.right - 10) {
      isMatch = true;
      dist = Math.hypot((currentRect.top - rect.top) * 2, rect.left - currentRect.right);
    }

    if (isMatch && dist < bestDistance) {
      bestDistance = dist;
      bestCandidate = el;
    }
  });

  // Запасная последовательная навигация по горизонтальным лентам (табы, сезоны, серии, карусели)
  if (!bestCandidate && (direction === 'left' || direction === 'right')) {
    const parentRail = currentFocusedElement.closest('.storm-tabs-inner, .storm-tabs-bar, .bookmarks-subnav-container, .rail-carousel, .rail-carousel-wrap, .media-rail-slider, .series-seasons-tabs, .player-series-quick-bar, .storm-quick-genres-container, .inplayer-season-chips-bar, .profile-tab-links');
    if (parentRail) {
      const items = focusables.filter(el => parentRail.contains(el));
      const currIdx = items.indexOf(currentFocusedElement);
      if (currIdx !== -1) {
        const nextIdx = direction === 'right' ? currIdx + 1 : currIdx - 1;
        if (nextIdx >= 0 && nextIdx < items.length) {
          bestCandidate = items[nextIdx];
        }
      }
    }
  }

  // Умный переход между зонами экрана (Шапка/Тулбар/Подменю закладок <-> Основной контент)
  if (!bestCandidate && direction === 'down') {
    const mainArea = document.querySelector('.storm-main-container') || document.getElementById('media-render-container');
    const isTopArea = currentFocusedElement.closest('.storm-navbar, .storm-sticky-header-container, .storm-header, .storm-tabs-bar, .storm-toolbar, .storm-filters-collapsible, .storm-quick-genres-container, .bookmarks-subnav-container, #bookmarks-subnav-container');

    // Если фокус в тулбаре или вкладках, а ниже открыто подменю закладок - переходим в него
    const bSubnav = document.getElementById('bookmarks-subnav-container');
    const isInsideSubnav = currentFocusedElement.closest('.bookmarks-subnav-container, #bookmarks-subnav-container');
    if (!isInsideSubnav && bSubnav && bSubnav.style.display !== 'none' && bSubnav.offsetHeight > 0) {
      const subnavChips = focusables.filter(el => bSubnav.contains(el));
      if (subnavChips.length > 0) {
        const activeChip = subnavChips.find(c => c.classList.contains('active')) || subnavChips[0];
        bestCandidate = activeChip;
      }
    }

    if (!bestCandidate && mainArea && isTopArea) {
      const candidates = focusables.filter(el => mainArea.contains(el));
      if (candidates.length > 0) {
        // Находим верхний видимый ряд контента (minTop + 60px)
        let minTop = Infinity;
        candidates.forEach(c => {
          const t = c.getBoundingClientRect().top;
          if (t < minTop) minTop = t;
        });
        const topRowCandidates = candidates.filter(c => c.getBoundingClientRect().top <= minTop + 60);
        topRowCandidates.sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          const aCenter = ra.left + ra.width / 2;
          const bCenter = rb.left + rb.width / 2;
          const currCenter = currentRect.left + currentRect.width / 2;
          return Math.abs(aCenter - currCenter) - Math.abs(bCenter - currCenter);
        });
        bestCandidate = topRowCandidates[0];
        if (typeof window.toggleFiltersCollapsible === 'function' && document.body.classList.contains('tv-mode')) {
          window.toggleFiltersCollapsible(true);
        }
      }
    } else if (mainArea && mainArea.contains(currentFocusedElement)) {
      const belowCandidates = focusables.filter(el => mainArea.contains(el) && el.getBoundingClientRect().top > currentRect.top + 15);
      if (belowCandidates.length > 0) {
        belowCandidates.sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return Math.hypot(ra.left - currentRect.left, ra.top - currentRect.top) - Math.hypot(rb.left - currentRect.left, rb.top - currentRect.top);
        });
        bestCandidate = belowCandidates[0];
      } else {
        window.scrollBy({ top: 320, behavior: 'smooth' });
      }
    } else if (isPlayerOpen) {
      const modalBody = document.querySelector('#cinema-modal .storm-modal-body') || document.querySelector('#cinema-modal .cinema-modal-dialog');
      if (modalBody) {
        const modalBelow = focusables.filter(el => modalBody.contains(el) && el.getBoundingClientRect().top > currentRect.top + 15);
        if (modalBelow.length > 0) {
          bestCandidate = modalBelow[0];
        } else {
          modalBody.scrollBy({ top: 240, behavior: 'smooth' });
        }
      }
    }
  }

  if (!bestCandidate && direction === 'up') {
    const mainArea = document.querySelector('.storm-main-container') || document.getElementById('media-render-container');
    if (mainArea && mainArea.contains(currentFocusedElement)) {
      const aboveCandidates = focusables.filter(el => mainArea.contains(el) && el.getBoundingClientRect().bottom < currentRect.bottom - 15);
      if (aboveCandidates.length > 0) {
        aboveCandidates.sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return Math.hypot(ra.left - currentRect.left, currentRect.bottom - ra.bottom) - Math.hypot(rb.left - currentRect.left, currentRect.bottom - ra.bottom);
        });
        bestCandidate = aboveCandidates[0];
      } else {
        // Мы в верхнем ряду контента: если активно подменю закладок, переходим в него
        const bSubnav = document.getElementById('bookmarks-subnav-container');
        if (bSubnav && bSubnav.style.display !== 'none' && bSubnav.offsetHeight > 0) {
          const subnavChips = focusables.filter(el => bSubnav.contains(el));
          if (subnavChips.length > 0) {
            subnavChips.sort((a, b) => {
              const ra = a.getBoundingClientRect();
              const rb = b.getBoundingClientRect();
              const aCenter = ra.left + ra.width / 2;
              const bCenter = rb.left + rb.width / 2;
              const currCenter = currentRect.left + currentRect.width / 2;
              return Math.abs(aCenter - currCenter) - Math.abs(bCenter - currCenter);
            });
            bestCandidate = subnavChips[0];
          }
        }

        // Если подменю нет, бесшовный переход в тулбар или панель вкладок
        if (!bestCandidate) {
          const topArea = document.querySelector('.storm-toolbar') || document.querySelector('.storm-tabs-bar') || document.querySelector('.storm-navbar');
          if (topArea) {
            const candidates = focusables.filter(el => topArea.contains(el));
            if (candidates.length > 0) {
              candidates.sort((a, b) => {
                const ra = a.getBoundingClientRect();
                const rb = b.getBoundingClientRect();
                const aCenter = ra.left + ra.width / 2;
                const bCenter = rb.left + rb.width / 2;
                const currCenter = currentRect.left + currentRect.width / 2;
                return Math.abs(aCenter - currCenter) - Math.abs(bCenter - currCenter);
              });
              bestCandidate = candidates[0];
            }
          }
        }
      }
    } else if (isPlayerOpen) {
      const modalBody = document.querySelector('#cinema-modal .storm-modal-body') || document.querySelector('#cinema-modal .cinema-modal-dialog');
      if (modalBody) {
        const modalAbove = focusables.filter(el => modalBody.contains(el) && el.getBoundingClientRect().bottom < currentRect.bottom - 15);
        if (modalAbove.length > 0) {
          bestCandidate = modalAbove[modalAbove.length - 1];
        } else {
          modalBody.scrollBy({ top: -240, behavior: 'smooth' });
        }
      }
    }
  }

  if (bestCandidate) {
    setFocusTo(bestCandidate);
    playTvFocusSound();
  }
}

function setFocusTo(element) {
  if (!element) return;
  clearFocusRing();
  currentFocusedElement = element;
  element.classList.add('tv-focused');
  if (!element.getAttribute('tabindex') && !['BUTTON', 'SELECT', 'INPUT', 'A'].includes(element.tagName)) {
    element.setAttribute('tabindex', '0');
  }
  element.focus();

  // 1. Плавный горизонтальный скролл внутри каруселей и списков без рывков всего окна
  const railContainer = element.closest('.rail-carousel, .storm-tabs-inner, .bookmarks-subnav-container, .series-seasons-tabs, .player-series-quick-bar, .inplayer-season-chips-bar, .profile-tab-links');
  if (railContainer) {
    const pRect = railContainer.getBoundingClientRect();
    const eRect = element.getBoundingClientRect();
    if (eRect.left < pRect.left + 40 || eRect.right > pRect.right - 40) {
      const scrollTarget = railContainer.scrollLeft + (eRect.left - pRect.left) - (pRect.width / 2) + (eRect.width / 2);
      railContainer.scrollTo({ left: scrollTarget, behavior: 'smooth' });
    }
  }

  // 2. Интеллектуальный вертикальный скролл экрана ТВ с защитой от обрезания обложек
  const isPlayerOpen = Boolean(document.body.classList.contains('cinema-open') || document.querySelector('.storm-modal-backdrop.is-open'));
  if (isPlayerOpen) {
    const modalBody = element.closest('.storm-modal-body, .cinema-modal-dialog, .profile-modal-dialog');
    if (modalBody) {
      const mbRect = modalBody.getBoundingClientRect();
      const elRect = element.getBoundingClientRect();
      if (elRect.top < mbRect.top + 20) {
        modalBody.scrollBy({ top: elRect.top - mbRect.top - 24, behavior: 'smooth' });
      } else if (elRect.bottom > mbRect.bottom - 20) {
        modalBody.scrollBy({ top: elRect.bottom - mbRect.bottom + 24, behavior: 'smooth' });
      }
    }
  } else {
    // В основном интерфейсе: динамический расчет высоты шапки и защищенной зоны
    const stickyHeader = document.querySelector('.storm-sticky-header-container');
    const bSubnav = document.getElementById('bookmarks-subnav-container');
    let headerHeight = stickyHeader ? stickyHeader.getBoundingClientRect().height : 180;
    if (bSubnav && bSubnav.style.display !== 'none' && bSubnav.offsetHeight > 0) {
      const bRect = bSubnav.getBoundingClientRect();
      if (bRect.bottom > headerHeight && bRect.bottom < 400) {
        headerHeight = bRect.bottom;
      }
    }

    const bottomSafe = 90;
    const pad = 24;
    const effectiveTop = headerHeight + pad;
    const vh = window.innerHeight;
    const effectiveBottom = vh - bottomSafe - pad;
    const elRect = element.getBoundingClientRect();

    if (elRect.top < effectiveTop) {
      window.scrollBy({ top: elRect.top - effectiveTop, behavior: 'smooth' });
    } else if (elRect.bottom > effectiveBottom) {
      window.scrollBy({ top: elRect.bottom - effectiveBottom, behavior: 'smooth' });
    }
  }
}

function focusInitialElement() {
  const openModal = document.querySelector('.storm-modal-backdrop.is-open');
  if (openModal) {
    focusInitialElementInContainer(openModal);
    return;
  }
  const focusables = getFocusableElements();
  if (focusables.length > 0) {
    setFocusTo(focusables[0]);
  }
}

function clearFocusRing() {
  document.querySelectorAll('.tv-focused').forEach(el => el.classList.remove('tv-focused'));
}

function pressFocusedElement() {
  if (currentFocusedElement) {
    playTvSelectSound();
    currentFocusedElement.click();
  }
}

function closeActiveModalOrBack() {
  playTvBackSound();

  // Используем единый обработчик навигации назад приложения
  if (typeof window.handleStormBackNavigation === 'function') {
    const handled = window.handleStormBackNavigation();
    if (handled) return;
  }

  const openModal = document.querySelector('.storm-modal-backdrop.is-open');
  if (openModal) {
    const closeBtn = openModal.querySelector('.storm-modal-close, #filter-sheet-close-btn');
    if (closeBtn) {
      closeBtn.click();
      return;
    }
    openModal.classList.remove('is-open');
    return;
  }

  window.history.back();
}

function switchAdjacentTab(direction) {
  const tabs = Array.from(document.querySelectorAll('.storm-tab-btn'));
  const activeIndex = tabs.findIndex(t => t.classList.contains('active'));
  if (activeIndex === -1) return;

  let newIndex = activeIndex + direction;
  if (newIndex < 0) newIndex = tabs.length - 1;
  if (newIndex >= tabs.length) newIndex = 0;

  playTvFocusSound();
  tabs[newIndex].click();
  setFocusTo(tabs[newIndex]);
}

if (typeof window !== 'undefined') {
  window.toggleTvMode = toggleTvMode;
  window.updateTvHudContext = updateTvHudContext;
  window.pokeTvHud = pokeTvHud;
}
