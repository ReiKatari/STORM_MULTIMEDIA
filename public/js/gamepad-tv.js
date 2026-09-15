/* ==========================================================================
   STORM MULTIMEDIA - SMART TV И НАВИГАЦИЯ ГЕЙМПАДОМ (10-FOOT CONSOLE UI)
   Поддержка геймпадов Xbox, PlayStation, звуковых эффектов и управления плеером
   ========================================================================== */

import { showToast } from './auth.js';
import { trackClientAction } from './achievements.js';

let isTvModeActive = false;
let gamepadLoopId = null;
let lastButtonPressTimes = {};
let currentFocusedElement = null;

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

// ==========================================
// 2. ИНИЦИАЛИЗАЦИЯ И РЕЖИМ ТЕЛЕВИЗОРА
// ==========================================
export function initGamepadAndTvMode() {
  const savedTv = localStorage.getItem('storm_tv_mode') === 'true';
  if (savedTv) {
    toggleTvMode(true);
  }

  window.addEventListener('gamepadconnected', (e) => {
    showToast(`🎮 Подключен геймпад: ${e.gamepad.id.split('(')[0].trim()}`, 'success');
    trackClientAction('use_gamepad');
    if (!isTvModeActive) {
      toggleTvMode(true);
    }
    startGamepadPolling();
  });

  window.addEventListener('gamepaddisconnected', (e) => {
    showToast(`🎮 Контроллер отключен: ${e.gamepad.id.split('(')[0].trim()}`, 'info');
  });

  startGamepadPolling();

  // Клавиатурная навигация (Стрелки, Enter, Esc, Пробел, F11)
  window.addEventListener('keydown', handleSpatialKeyboard);
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

  if (isTvModeActive) {
    showToast('📺 Активирован режим Smart TV (10-Foot UI)', 'info');
    renderTvHudBar();
    focusInitialElement();
    trackClientAction('use_gamepad');
    playTvSelectSound();
  } else {
    showToast('Режим Smart TV выключен', 'info');
    removeTvHudBar();
    clearFocusRing();
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
// 3. ПАНЕЛЬ ПОДСКАЗОК ГЕЙМПАДА (GAMEPAD HUD DOCK)
// ==========================================
function renderTvHudBar() {
  let hud = document.getElementById('storm-tv-hud-bar');
  if (!hud) {
    hud = document.createElement('div');
    hud.id = 'storm-tv-hud-bar';
    hud.className = 'storm-tv-hud-bar';
    hud.innerHTML = `
      <div class="tv-hud-inner">
        <div class="tv-hud-item"><span class="tv-key-badge btn-a">A</span> <span class="tv-hud-label">Выбрать</span></div>
        <div class="tv-hud-item"><span class="tv-key-badge btn-b">B</span> <span class="tv-hud-label">Назад</span></div>
        <div class="tv-hud-item"><span class="tv-key-badge btn-x">X</span> <span class="tv-hud-label">Закладки</span></div>
        <div class="tv-hud-item"><span class="tv-key-badge btn-y">Y</span> <span class="tv-hud-label">Поиск</span></div>
        <div class="tv-hud-item"><span class="tv-key-badge btn-bumper">LB / RB</span> <span class="tv-hud-label">Вкладки</span></div>
        <div class="tv-hud-item" id="tv-hud-fs-btn" style="cursor: pointer;"><span class="tv-key-badge btn-menu">START</span> <span class="tv-hud-label">Экран</span></div>
      </div>
    `;
    document.body.appendChild(hud);

    hud.querySelector('#tv-hud-fs-btn')?.addEventListener('click', () => {
      toggleFullscreen();
    });
  }
}

function removeTvHudBar() {
  const hud = document.getElementById('storm-tv-hud-bar');
  if (hud) hud.remove();
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

// ==========================================
// 5. ЦИКЛ ОПРОСА ГЕЙМПАДА
// ==========================================
function startGamepadPolling() {
  if (gamepadLoopId) return;

  function poll() {
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

  const isPlayerOpen = Boolean((document.getElementById('cinema-modal') || document.getElementById('cinema-modal-backdrop'))?.classList.contains('is-open'));

  // Если открыт плеер — кнопки направлений и триггеры управляют видео
  if (isPlayerOpen) {
    if (left && canTrigger('seek_left', 320)) {
      handlePlayerTvSeek(-10);
      return;
    }
    if (right && canTrigger('seek_right', 320)) {
      handlePlayerTvSeek(10);
      return;
    }
    if (up && canTrigger('vol_up', 220)) {
      handlePlayerTvVolume(0.1);
      return;
    }
    if (down && canTrigger('vol_down', 220)) {
      handlePlayerTvVolume(-0.1);
      return;
    }
    // Кнопка A (Пауза/Плей)
    if (gp.buttons[0]?.pressed && canTrigger(0, 350)) {
      handlePlayerTvPlayPause();
      return;
    }
    // Кнопка B (Закрыть плеер)
    if (gp.buttons[1]?.pressed && canTrigger(1, 350)) {
      closeActiveModalOrBack();
      return;
    }
    // Кнопка Y (Переключить Ambilight)
    if (gp.buttons[3]?.pressed && canTrigger(3, 350)) {
      document.getElementById('toggle-ambilight-btn')?.click();
      return;
    }
  }

  // Обычная пространственная навигация по каталогу и модальным окнам
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

  // Кнопка X (Закладки)
  if (gp.buttons[2]?.pressed && canTrigger(2, 300)) {
    window.switchTab?.('bookmarks');
    playTvSelectSound();
  }

  // Кнопка Y (Голосовой поиск / Поиск)
  if (gp.buttons[3]?.pressed && canTrigger(3, 300)) {
    const micBtn = document.getElementById('voice-search-btn');
    if (micBtn) {
      micBtn.click();
    } else {
      document.getElementById('global-search-input')?.focus();
    }
    playTvSelectSound();
  }

  // LB (Предыдущая вкладка)
  if (gp.buttons[4]?.pressed && canTrigger(4, 250)) {
    switchAdjacentTab(-1);
  }

  // RB (Следующая вкладка)
  if (gp.buttons[5]?.pressed && canTrigger(5, 250)) {
    switchAdjacentTab(1);
  }

  // Start (Кнопка 9) — Полноэкранный режим
  if (gp.buttons[9]?.pressed && canTrigger(9, 450)) {
    toggleFullscreen();
  }
}

// ==========================================
// 6. КЛАВИАТУРНАЯ ПРОСТРАНСТВЕННАЯ НАВИГАЦИЯ
// ==========================================
function handleSpatialKeyboard(e) {
  if (!isTvModeActive && !document.querySelector('.storm-modal-backdrop.is-open')) return;

  if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

  const isPlayerOpen = Boolean((document.getElementById('cinema-modal') || document.getElementById('cinema-modal-backdrop'))?.classList.contains('is-open'));

  switch (e.key) {
    case 'ArrowUp':
      e.preventDefault();
      if (isPlayerOpen) handlePlayerTvVolume(0.1);
      else moveFocus('up');
      break;
    case 'ArrowDown':
      e.preventDefault();
      if (isPlayerOpen) handlePlayerTvVolume(-0.1);
      else moveFocus('down');
      break;
    case 'ArrowLeft':
      e.preventDefault();
      if (isPlayerOpen) handlePlayerTvSeek(-10);
      else moveFocus('left');
      break;
    case 'ArrowRight':
      e.preventDefault();
      if (isPlayerOpen) handlePlayerTvSeek(10);
      else moveFocus('right');
      break;
    case ' ':
      if (isPlayerOpen) {
        e.preventDefault();
        handlePlayerTvPlayPause();
      }
      break;
    case 'Enter':
      e.preventDefault();
      pressFocusedElement();
      break;
    case 'Escape':
    case 'Backspace':
      e.preventDefault();
      closeActiveModalOrBack();
      break;
    case 'f':
    case 'F':
      if (isTvModeActive) {
        e.preventDefault();
        toggleFullscreen();
      }
      break;
    default:
      break;
  }
}

function getFocusableElements() {
  const activeModal = document.querySelector('.storm-modal-backdrop.is-open');
  const root = activeModal || document;
  const selector = 'button:not([disabled]), [tabindex="0"], .media-card, .storm-tab-btn, .cal-card, .quick-dropdown-trigger, select:not([disabled]), input:not([disabled])';
  return Array.from(root.querySelectorAll(selector)).filter(el => {
    return el.offsetParent !== null && window.getComputedStyle(el).display !== 'none';
  });
}

function moveFocus(direction) {
  const focusables = getFocusableElements();
  if (focusables.length === 0) return;

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

  if (bestCandidate) {
    setFocusTo(bestCandidate);
    playTvFocusSound();
  }
}

function setFocusTo(element) {
  clearFocusRing();
  currentFocusedElement = element;
  element.classList.add('tv-focused');
  element.focus();
  element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
}

function focusInitialElement() {
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
  const openModal = document.querySelector('.storm-modal-backdrop.is-open');
  if (openModal) {
    const closeBtn = openModal.querySelector('.storm-modal-close');
    if (closeBtn) closeBtn.click();
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

