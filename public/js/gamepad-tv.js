/* ==========================================================================
   STORM MULTIMEDIA - SMART TV И НАВИГАЦИЯ ГЕЙМПАДОМ
   Поддержка геймпадов Xbox, PlayStation, USB-контроллеров и 10-foot UI
   ========================================================================== */

import { showToast } from './auth.js';
import { trackClientAction } from './achievements.js';

let isTvModeActive = false;
let gamepadLoopId = null;
let lastButtonPressTimes = {};
let currentFocusedElement = null;

export function initGamepadAndTvMode() {
  // Восстановление режима TV из настроек
  const savedTv = localStorage.getItem('storm_tv_mode') === 'true';
  if (savedTv) {
    toggleTvMode(true);
  }

  // Подключение событий геймпада
  window.addEventListener('gamepadconnected', (e) => {
    showToast(`🎮 Подключен контроллер: ${e.gamepad.id.split('(')[0]}`, 'success');
    trackClientAction('use_gamepad');
    if (!isTvModeActive) {
      toggleTvMode(true);
    }
    startGamepadPolling();
  });

  window.addEventListener('gamepaddisconnected', (e) => {
    showToast(`🎮 Контроллер отключен: ${e.gamepad.id.split('(')[0]}`, 'info');
  });

  // Запуск постоянного цикла опроса, если геймпад уже подключен
  startGamepadPolling();

  // Клавиатурная пространственная навигация (Стрелки, Enter, Esc)
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
    focusInitialElement();
    trackClientAction('use_gamepad');
  } else {
    showToast('Режим Smart TV выключен', 'info');
    clearFocusRing();
  }
}

function startGamepadPolling() {
  if (gamepadLoopId) return;

  function poll() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < gamepads.length; i++) {
      const gp = gamepads[i];
      if (gp && gp.connected) {
        handleGamepadInput(gp);
        break; // Управляем первым активным контроллером
      }
    }
    gamepadLoopId = requestAnimationFrame(poll);
  }

  gamepadLoopId = requestAnimationFrame(poll);
}

function handleGamepadInput(gp) {
  const now = Date.now();
  const deadzone = 0.5;

  const canTrigger = (btnIndex, cooldownMs = 200) => {
    const last = lastButtonPressTimes[btnIndex] || 0;
    if (now - last > cooldownMs) {
      lastButtonPressTimes[btnIndex] = now;
      return true;
    }
    return false;
  };

  // D-Pad и Левый стик
  const up = gp.buttons[12]?.pressed || gp.axes[1] < -deadzone;
  const down = gp.buttons[13]?.pressed || gp.axes[1] > deadzone;
  const left = gp.buttons[14]?.pressed || gp.axes[0] < -deadzone;
  const right = gp.buttons[15]?.pressed || gp.axes[0] > deadzone;

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
  }

  // Кнопка Y (Голосовой поиск / Поиск)
  if (gp.buttons[3]?.pressed && canTrigger(3, 300)) {
    const searchInput = document.getElementById('global-search-input');
    if (searchInput) {
      searchInput.focus();
    }
  }

  // LB (Предыдущая вкладка)
  if (gp.buttons[4]?.pressed && canTrigger(4, 300)) {
    switchAdjacentTab(-1);
  }

  // RB (Следующая вкладка)
  if (gp.buttons[5]?.pressed && canTrigger(5, 300)) {
    switchAdjacentTab(1);
  }
}

function handleSpatialKeyboard(e) {
  if (!isTvModeActive && !document.querySelector('.storm-modal-backdrop.is-open')) return;

  // Игнорируем ввод в текстовые поля
  if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

  switch (e.key) {
    case 'ArrowUp':
      e.preventDefault();
      moveFocus('up');
      break;
    case 'ArrowDown':
      e.preventDefault();
      moveFocus('down');
      break;
    case 'ArrowLeft':
      e.preventDefault();
      moveFocus('left');
      break;
    case 'ArrowRight':
      e.preventDefault();
      moveFocus('right');
      break;
    case 'Enter':
      e.preventDefault();
      pressFocusedElement();
      break;
    case 'Escape':
      e.preventDefault();
      closeActiveModalOrBack();
      break;
    default:
      break;
  }
}

function getFocusableElements() {
  const activeModal = document.querySelector('.storm-modal-backdrop.is-open');
  const root = activeModal || document;
  const selector = 'button:not([disabled]), [tabindex="0"], .media-card, .storm-tab-btn, select:not([disabled]), input:not([disabled])';
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
    currentFocusedElement.click();
  }
}

function closeActiveModalOrBack() {
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

  tabs[newIndex].click();
  setFocusTo(tabs[newIndex]);
}
