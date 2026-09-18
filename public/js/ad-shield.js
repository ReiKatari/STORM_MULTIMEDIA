/**
 * STORM CleanView & AdShield Engine
 * Интеллектуальный модуль защиты от рекламы, авто-пропуска видеовставок
 * и маскирования/вырезания рекламных логотипов (1XBET, Winline, Мелбет и др.)
 */

// Конфигурация пресетов водяных знаков с точной калибровкой под реальные релизы
export const WATERMARK_PRESETS = {
  '1xbet_mid': {
    id: '1xbet_mid',
    name: '🎯 1XBET (Слева по центру)',
    desc: 'Точное положение логотипа на высоте 37–42% (скриншот 2)',
    coords: { top: '37%', left: '1.2%', width: '135px', height: '44px' }
  },
  '1xbet_low': {
    id: '1xbet_low',
    name: '🎯 1XBET (Слева ниже)',
    desc: 'Положение логотипа на высоте 46–52% (скриншот 1)',
    coords: { top: '46%', left: '1.2%', width: '135px', height: '44px' }
  },
  '1xbet_bottom': {
    id: '1xbet_bottom',
    name: '🎯 1XBET (Слева внизу кадра)',
    desc: 'Положение логотипа на высоте 70–75% (Обитель зла и широкоформатные релизы)',
    coords: { top: '71%', left: '1.2%', width: '145px', height: '46px' }
  },
  '1xbet_corner': {
    id: '1xbet_corner',
    name: '🎯 1XBET (Левый нижний угол)',
    desc: 'Положение логотипа в самом низу кадра на высоте 85–90%',
    coords: { top: '86%', left: '1.2%', width: '145px', height: '46px' }
  },
  '1xbet_band': {
    id: '1xbet_band',
    name: '🌊 1XBET (Адаптивная зона)',
    desc: 'Мягкая вертикальная линза 36–56%, перекрывает оба смещения',
    coords: { top: '36%', left: '1.0%', width: '140px', height: '105px' }
  },
  'top_left': {
    id: 'top_left',
    name: '📐 Вверху слева',
    desc: 'Логотипы студий и спонсоров в верхнем левом углу',
    coords: { top: '4%', left: '2%', width: '140px', height: '42px' }
  },
  'top_right': {
    id: 'top_right',
    name: '📐 Вверху справа',
    desc: 'Водяные знаки каналов в верхнем правом углу',
    coords: { top: '4%', right: '2%', width: '140px', height: '42px' }
  },
  'ticker_bottom': {
    id: 'ticker_bottom',
    name: '➖ Бегущая строка',
    desc: 'Нижняя полоса промокодов и ставок на спорт',
    coords: { bottom: '12%', left: '4%', width: '92%', height: '42px' }
  },
  'custom': {
    id: 'custom',
    name: '✋ Своя область',
    desc: 'Ручная настройка положения и размера',
    coords: { top: '42%', left: '1.2%', width: '135px', height: '44px' }
  }
};

const DEFAULT_SETTINGS = {
  adSkipperEnabled: true,
  watermarkMaskEnabled: false, // по умолчанию выключена, пользователь включает при обнаружении водяного знака
  activePreset: '1xbet_mid',
  maskStyle: 'blur', // 'blur' (бесшовное размытие) или 'blackout' (черная плашка)
  maskOpacity: 0.55, // по умолчанию 55% (оптимальное скрытие белых букв без грубых темных пятен)
  customCoords: { top: '42%', left: '1.2%', width: '135px', height: '44px' },
  isCustomizing: false,
  isAiming: false
};

let currentSettings = { ...DEFAULT_SETTINGS };
let maskElement = null;
let currentContainer = null;
let adWatchInterval = null;
let aimOverlayElement = null;

/**
 * Загрузка сохраненных настроек из localStorage
 */
export function loadCleanViewSettings() {
  try {
    const raw = localStorage.getItem('storm_cleanview_settings');
    if (raw) {
      const parsed = JSON.parse(raw);
      currentSettings = { ...DEFAULT_SETTINGS, ...parsed, isCustomizing: false, isAiming: false };
      if (typeof currentSettings.maskOpacity !== 'number') {
        currentSettings.maskOpacity = 0.55;
      }
    }
  } catch (e) {
    currentSettings = { ...DEFAULT_SETTINGS };
  }
  return currentSettings;
}

/**
 * Сохранение настроек в localStorage
 */
export function saveCleanViewSettings(settings = {}) {
  try {
    currentSettings = { ...currentSettings, ...settings };
    localStorage.setItem('storm_cleanview_settings', JSON.stringify({
      adSkipperEnabled: currentSettings.adSkipperEnabled,
      watermarkMaskEnabled: currentSettings.watermarkMaskEnabled,
      activePreset: currentSettings.activePreset,
      maskStyle: currentSettings.maskStyle,
      maskOpacity: currentSettings.maskOpacity,
      customCoords: currentSettings.customCoords
    }));
  } catch (e) {
    console.warn('Не удалось сохранить настройки CleanView:', e.message);
  }
}

/**
 * Монтирование оверлея CleanView поверх видеобокса
 */
export function mountCleanViewOverlay(videoBox) {
  if (!videoBox) return;
  currentContainer = videoBox;
  loadCleanViewSettings();

  // Удаляем старый оверлей, если он существовал
  const oldOverlay = videoBox.querySelector('#storm-cleanview-overlay');
  if (oldOverlay) oldOverlay.remove();

  // Гарантированно удаляем любые плавающие бейджи поверх видеоплеера
  const existingBadge = videoBox.querySelector('#storm-cleanview-floating-trigger');
  if (existingBadge) existingBadge.remove();
  const allBadges = document.querySelectorAll('.storm-cleanview-floating-badge, #storm-cleanview-floating-trigger');
  allBadges.forEach(b => b.remove());

  const overlay = document.createElement('div');
  overlay.id = 'storm-cleanview-overlay';
  overlay.className = 'storm-cleanview-overlay';
  videoBox.appendChild(overlay);

  // Создаем слой маски водяных знаков
  maskElement = document.createElement('div');
  maskElement.id = 'storm-watermark-mask';
  maskElement.className = 'storm-watermark-mask';
  overlay.appendChild(maskElement);

  // Добавляем маркеры изменения размера для режима интерактивной настройки
  maskElement.innerHTML = `
    <div class="storm-mask-core"></div>
    <div class="storm-mask-label">МАСКА 1XBET</div>
    <div class="storm-mask-handle handle-br" title="Потяните для изменения размера"></div>
    <div class="storm-mask-handle handle-drag" title="Перетащите область мышью">✥</div>
  `;

  setupMaskInteractions(maskElement, videoBox);
  applyMaskSettings();

  // Инициализируем перехватчик видеорекламы
  initAdSkipper(videoBox);
}

/**
 * Применение текущих настроек к элементу маски
 */
export function applyMaskSettings() {
  if (!maskElement) return;

  if (!currentSettings.watermarkMaskEnabled) {
    maskElement.style.display = 'none';
    updateBadgeState(false);
    return;
  }

  maskElement.style.display = 'flex';
  updateBadgeState(true);

  // Очищаем предыдущие позиционирования
  maskElement.style.top = '';
  maskElement.style.bottom = '';
  maskElement.style.left = '';
  maskElement.style.right = '';

  const preset = WATERMARK_PRESETS[currentSettings.activePreset] || WATERMARK_PRESETS['1xbet_mid'];
  const coords = currentSettings.activePreset === 'custom'
    ? (currentSettings.customCoords || preset.coords)
    : preset.coords;

  Object.assign(maskElement.style, {
    top: coords.top || '',
    bottom: coords.bottom || '',
    left: coords.left || '',
    right: coords.right || '',
    width: coords.width || '135px',
    height: coords.height || '44px'
  });

  // Стиль маски: Умное размытие (Smart Blur) или Черная плашка (Blackout)
  maskElement.classList.toggle('mode-blackout', currentSettings.maskStyle === 'blackout');
  maskElement.classList.toggle('mode-blur', currentSettings.maskStyle !== 'blackout');
  maskElement.classList.toggle('is-customizing', Boolean(currentSettings.isCustomizing));

  // Уровень прозрачности маски: для интерактивной настройки или blackout - 1.0, для размытия - деликатная прозрачность
  const opacityVal = typeof currentSettings.maskOpacity === 'number' ? currentSettings.maskOpacity : 0.42;
  maskElement.style.opacity = currentSettings.isCustomizing
    ? '1.0'
    : (currentSettings.maskStyle === 'blackout' ? '1.0' : String(opacityVal));

  const labelEl = maskElement.querySelector('.storm-mask-label');
  if (labelEl) {
    labelEl.textContent = currentSettings.isCustomizing
      ? 'Настройка (потяните ✥)'
      : (preset.name.replace(/[^a-zA-Z0-9а-яА-ЯёЁ\s]/g, '').trim() || 'МАСКА');
  }
}

/**
 * Обновление индикатора на бейдже и панели студии
 */
function updateBadgeState(isActive) {
  const badge = document.querySelector('#storm-cleanview-floating-trigger .badge-dot');
  if (badge) {
    badge.classList.toggle('active', isActive);
  }
  const dockTab = document.querySelector('#studio-tab-cleanview');
  if (dockTab) {
    dockTab.classList.toggle('active-glow', Boolean(isActive));
  }
}

/**
 * Режим клик-наведения на водяной знак (Click-to-Aim)
 */
export function startAimMode() {
  if (!currentContainer) return;
  currentSettings.isAiming = true;

  // Закрываем модальное окно настроек
  const modal = document.getElementById('storm-cleanview-panel');
  if (modal) modal.classList.remove('is-open');

  // Создаем слой-прицел поверх видео
  const oldAim = document.getElementById('storm-cleanview-aim-layer');
  if (oldAim) oldAim.remove();

  aimOverlayElement = document.createElement('div');
  aimOverlayElement.id = 'storm-cleanview-aim-layer';
  aimOverlayElement.className = 'storm-cleanview-aim-layer';
  aimOverlayElement.innerHTML = `
    <div class="aim-hint-banner">
      <span class="aim-hint-icon">🎯</span>
      <span class="aim-hint-text">Кликните прямо по рекламной надписи на видео для точного наведения</span>
      <button type="button" class="aim-cancel-btn" id="aim-cancel-btn">Отмена</button>
    </div>
  `;

  currentContainer.appendChild(aimOverlayElement);

  const cancelBtn = aimOverlayElement.querySelector('#aim-cancel-btn');
  const cancelAim = (e) => {
    e?.stopPropagation();
    currentSettings.isAiming = false;
    if (aimOverlayElement) aimOverlayElement.remove();
    aimOverlayElement = null;
  };

  if (cancelBtn) cancelBtn.onclick = cancelAim;

  aimOverlayElement.onclick = (e) => {
    if (e.target === cancelBtn) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = currentContainer.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const w = 135;
    const h = 44;

    const leftPx = Math.max(0, Math.min(rect.width - w, clickX - (w / 2)));
    const topPx = Math.max(0, Math.min(rect.height - h, clickY - (h / 2)));

    const leftPercent = ((leftPx / rect.width) * 100).toFixed(1) + '%';
    const topPercent = ((topPx / rect.height) * 100).toFixed(1) + '%';

    currentSettings.customCoords = {
      left: leftPercent,
      top: topPercent,
      width: `${w}px`,
      height: `${h}px`,
      right: '',
      bottom: ''
    };
    currentSettings.activePreset = 'custom';
    currentSettings.watermarkMaskEnabled = true;
    currentSettings.isAiming = false;

    saveCleanViewSettings();
    applyMaskSettings();

    if (aimOverlayElement) aimOverlayElement.remove();
    aimOverlayElement = null;

    showCleanViewFeedback('🎯 Маска точно наведена на выбранную область!');
  };
}

/**
 * Небольшое всплывающее уведомление CleanView
 */
function showCleanViewFeedback(text) {
  const oldToast = document.getElementById('storm-cleanview-toast');
  if (oldToast) oldToast.remove();

  const toast = document.createElement('div');
  toast.id = 'storm-cleanview-toast';
  toast.className = 'storm-cleanview-toast';
  toast.textContent = text;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 2400);
  }, 50);
}

/**
 * Настройка интерактивного перемещения и изменения размера маски
 */
function setupMaskInteractions(maskEl, container) {
  let isDragging = false;
  let isResizing = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  let startWidth = 0;
  let startHeight = 0;

  const dragHandle = maskEl.querySelector('.handle-drag');
  const resizeHandle = maskEl.querySelector('.handle-br');

  const onMouseDownDrag = (e) => {
    if (!currentSettings.isCustomizing) return;
    e.preventDefault();
    e.stopPropagation();
    isDragging = true;
    const rect = maskEl.getBoundingClientRect();
    const contRect = container.getBoundingClientRect();

    startX = e.clientX;
    startY = e.clientY;
    startLeft = rect.left - contRect.left;
    startTop = rect.top - contRect.top;

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  const onMouseDownResize = (e) => {
    if (!currentSettings.isCustomizing) return;
    e.preventDefault();
    e.stopPropagation();
    isResizing = true;
    startX = e.clientX;
    startY = e.clientY;
    startWidth = maskEl.offsetWidth;
    startHeight = maskEl.offsetHeight;

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  const onMouseMove = (e) => {
    if (isDragging) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const newLeft = Math.max(0, Math.min(container.clientWidth - maskEl.offsetWidth, startLeft + dx));
      const newTop = Math.max(0, Math.min(container.clientHeight - maskEl.offsetHeight, startTop + dy));

      const leftPercent = ((newLeft / container.clientWidth) * 100).toFixed(1) + '%';
      const topPercent = ((newTop / container.clientHeight) * 100).toFixed(1) + '%';

      maskEl.style.left = leftPercent;
      maskEl.style.top = topPercent;
      maskEl.style.right = '';
      maskEl.style.bottom = '';

      currentSettings.customCoords = {
        ...currentSettings.customCoords,
        left: leftPercent,
        top: topPercent,
        right: '',
        bottom: ''
      };
    } else if (isResizing) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const newWidth = Math.max(60, Math.min(container.clientWidth - 20, startWidth + dx));
      const newHeight = Math.max(25, Math.min(container.clientHeight - 20, startHeight + dy));

      maskEl.style.width = `${newWidth}px`;
      maskEl.style.height = `${newHeight}px`;

      currentSettings.customCoords = {
        ...currentSettings.customCoords,
        width: `${newWidth}px`,
        height: `${newHeight}px`
      };
    }
  };

  const onMouseUp = () => {
    if (isDragging || isResizing) {
      isDragging = false;
      isResizing = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      currentSettings.activePreset = 'custom';
      saveCleanViewSettings();
    }
  };

  if (dragHandle) dragHandle.addEventListener('mousedown', onMouseDownDrag);
  if (resizeHandle) resizeHandle.addEventListener('mousedown', onMouseDownResize);
  maskEl.addEventListener('mousedown', (e) => {
    if (currentSettings.isCustomizing && e.target === maskEl) {
      onMouseDownDrag(e);
    }
  });
}

/**
 * Интеллектуальный авто-пропуск рекламы (Smart Ad Skipper)
 */
export function initAdSkipper(container) {
  if (adWatchInterval) {
    clearInterval(adWatchInterval);
    adWatchInterval = null;
  }

  // Защита от кликандеров на уровне окна
  try {
    const origOpen = window.open;
    window.open = function(url, target, features) {
      if (typeof url === 'string' && isAdOrBettingUrl(url)) {
        console.warn('🛡️ STORM CleanView заблокировал открытие рекламной ссылки:', url);
        return null;
      }
      return origOpen.apply(this, arguments);
    };
  } catch (e) {}

  adWatchInterval = setInterval(() => {
    if (!currentSettings.adSkipperEnabled) return;
    scanAndSkipAds(container);
  }, 450);
}

/**
 * Проверка URL на признаки рекламы или букмекеров
 */
function isAdOrBettingUrl(url) {
  const adPatterns = [
    '1xbet', 'melbet', 'winline', 'fonbet', 'betwinner', 'vavada', 'pin-up',
    'adcash', 'propellerads', 'popunder', 'clickunder', 'partner', 'track',
    'mostbet', 'leon', 'joycasino', 'slot', 'cpa'
  ];
  const low = String(url || '').toLowerCase();
  return adPatterns.some(p => low.includes(p));
}

/**
 * Сканирование и нейтрализация рекламных вставок в плеере
 */
function scanAndSkipAds(container) {
  if (!container) return;

  // 1. Поиск видеоэлементов (для прямого воспроизведения HLS / HTML5)
  const videos = container.querySelectorAll('video');
  videos.forEach(v => {
    try {
      // Если воспроизводится короткий рекламный ролик (< 65 сек) перед основным фильмом
      const isShortAdVideo = v.duration && v.duration < 65 && v.duration > 2;
      const isAdClass = v.className && /ad-|vast-|preroll/i.test(v.className);

      if (isShortAdVideo || isAdClass) {
        if (!v.muted) v.muted = true;
        if (v.playbackRate < 10) v.playbackRate = 16;
        if (v.currentTime < v.duration - 0.5) {
          v.currentTime = Math.max(0, v.duration - 0.2);
        }
      }
    } catch (e) {}
  });

  // 2. Авто-клик по кнопкам пропуска рекламы в DOM плеера
  const skipSelectors = [
    '.skip-ad', '.ad-skip', '.vast-skip-button', '.playerjs-ad-skip',
    '.ad-btn-skip', '.video-ad-skip', 'button[class*="skip"]',
    'div[class*="skipAd"]', '.close-ad', '.ad-close'
  ];

  skipSelectors.forEach(selector => {
    const btns = container.querySelectorAll(selector);
    btns.forEach(btn => {
      try {
        if (btn && btn.offsetParent !== null) {
          btn.click();
        }
      } catch (e) {}
    });
  });

  // 3. Отправка сигналов внутрь iframe плееров
  const iframes = container.querySelectorAll('iframe');
  iframes.forEach(iframe => {
    try {
      iframe.contentWindow?.postMessage({ type: 'STORM_SKIP_AD', action: 'skip_ad' }, '*');
      iframe.contentWindow?.postMessage('skip_ad', '*');
    } catch (e) {}
  });
}

/**
 * Монтирование плавающей кнопки CleanView в плеере (удалена по требованию пользователя)
 */
function mountFloatingCleanViewBadge(videoBox) {
  // Скрыто: CleanView доступен только через док студии плеера
  const badge = videoBox?.querySelector('#storm-cleanview-floating-trigger');
  if (badge) badge.remove();
}

/**
 * Переключение модального окна / шторки управления CleanView
 */
export function toggleCleanViewModal() {
  const cinemaModal = document.getElementById('cinema-modal');
  const targetParent = cinemaModal || document.body;

  let modal = document.getElementById('storm-cleanview-panel');
  if (modal && modal.classList.contains('is-open')) {
    modal.classList.remove('is-open');
    if (currentSettings.isCustomizing) {
      currentSettings.isCustomizing = false;
      applyMaskSettings();
    }
    return;
  }

  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'storm-cleanview-panel';
    modal.className = 'storm-cleanview-panel';
    targetParent.appendChild(modal);
  } else if (targetParent && modal.parentElement !== targetParent) {
    targetParent.appendChild(modal);
  }

  renderCleanViewPanelContent(modal);
  modal.classList.add('is-open');
}

/**
 * Рендеринг содержимого панели управления CleanView
 */
function renderCleanViewPanelContent(panel) {
  const currentCoords = currentSettings.activePreset === 'custom'
    ? currentSettings.customCoords
    : (WATERMARK_PRESETS[currentSettings.activePreset]?.coords || currentSettings.customCoords);

  panel.innerHTML = `
    <div class="cleanview-card">
      <div class="cleanview-header">
        <div class="cleanview-title-group">
          <div class="cleanview-title">🛡️ STORM CleanView и AdShield</div>
          <div class="cleanview-subtitle">Интеллектуальная фильтрация рекламы и бесшовное маскирование логотипов</div>
        </div>
        <button type="button" class="cleanview-close-btn" id="cleanview-close-btn" title="Закрыть">✕</button>
      </div>

      <div class="cleanview-body">
        <!-- Группа 1: Автоматическая защита и фильтрация -->
        <div class="cleanview-group-card">
          <div class="cleanview-group-header">
            <span class="cleanview-group-icon">⚡</span>
            <div class="cleanview-group-title">Автоматическая защита и блокировка</div>
          </div>
          <div class="cleanview-group-content">
            <!-- Блок 1: Авто-пропуск рекламы -->
            <div class="cleanview-feature-row" id="cleanview-skipper-row" style="cursor: pointer;">
              <div class="feature-info">
                <div class="feature-title">⚡ Авто-пропуск видеорекламы</div>
                <div class="feature-desc">Ускорение в 16 раз, авто-клик «Пропустить рекламу», глушение звука и блокировка всплывающих окон</div>
              </div>
              <label class="storm-toggle-switch">
                <input type="checkbox" id="cleanview-ad-skipper-toggle" ${currentSettings.adSkipperEnabled ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
            </div>

            <!-- Блок 2: Вырезание водяных знаков -->
            <div class="cleanview-feature-row" id="cleanview-mask-row" style="cursor: pointer;">
              <div class="feature-info">
                <div class="feature-title">✂️ Скрыть рекламные надписи и логотипы</div>
                <div class="feature-desc">Бесшовное оптическое маскирование без тёмных рамок и искажения цветов видеоряда</div>
              </div>
              <label class="storm-toggle-switch">
                <input type="checkbox" id="cleanview-mask-toggle" ${currentSettings.watermarkMaskEnabled ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
            </div>
          </div>
        </div>

        <!-- Группа 2: Область маскирования логотипов -->
        <div class="cleanview-group-card">
          <div class="cleanview-group-header">
            <span class="cleanview-group-icon">🎯</span>
            <div class="cleanview-group-title">Область маскирования логотипов</div>
          </div>
          <div class="cleanview-group-content">
            <!-- Блок 3: Инструмент точного наведения кликом -->
            <div class="cleanview-aim-toolbar">
              <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="cleanview-aim-btn" style="width: 100%; justify-content: center; gap: 8px; font-weight: 700;">
                <span>🎯 Указать надпись на видео кликом</span>
              </button>
              <div class="aim-quick-desc">Если логотип сместился, нажмите кнопку и кликните прямо по нему на экране видео</div>
            </div>

            <!-- Блок 4: Выбор пресета размещения -->
            <div class="cleanview-section" id="cleanview-presets-section">
              <div class="cleanview-section-label">Готовые зоны для 1XBET и букмекеров:</div>
              <div class="cleanview-presets-grid">
                ${Object.values(WATERMARK_PRESETS).map(p => `
                  <button type="button" class="cleanview-preset-btn ${currentSettings.watermarkMaskEnabled && currentSettings.activePreset === p.id ? 'active' : ''}" data-preset="${p.id}">
                    <div class="preset-name">${p.name}</div>
                    <div class="preset-desc">${p.desc}</div>
                  </button>
                `).join('')}
              </div>
            </div>
          </div>
        </div>

        <!-- Группа 3: Оптика и точная подгонка маски -->
        <div class="cleanview-group-card">
          <div class="cleanview-group-header">
            <span class="cleanview-group-icon">⚙️</span>
            <div class="cleanview-group-title">Оптика и точная подгонка маски</div>
          </div>
          <div class="cleanview-group-content cleanview-tuning-grid">
            <!-- Левая колонка: Микро-подгонка джойстиком -->
            <div class="cleanview-nudge-box">
              <div class="cleanview-section-label">Микро-подгонка положения:</div>
              <div class="nudge-controls">
                <button type="button" class="nudge-btn" id="nudge-up-btn" title="Сдвинуть выше">▲ Вверх</button>
                <div class="nudge-row">
                  <button type="button" class="nudge-btn" id="nudge-left-btn" title="Сдвинуть влево">◀ Влево</button>
                  <button type="button" class="nudge-btn" id="nudge-right-btn" title="Сдвинуть вправо">Вправо ▶</button>
                </div>
                <button type="button" class="nudge-btn" id="nudge-down-btn" title="Сдвинуть ниже">▼ Вниз</button>
              </div>
            </div>

            <!-- Правая колонка: Стиль маски и прозрачность -->
            <div class="cleanview-style-and-opacity-box">
              <!-- Стиль маски -->
              <div class="cleanview-section" id="cleanview-style-section">
                <div class="cleanview-section-label">Стиль маскирования:</div>
                <div class="cleanview-styles-row">
                  <button type="button" class="cleanview-style-chip ${currentSettings.maskStyle === 'blur' ? 'active' : ''}" id="style-blur-btn">
                    <span>💧 Бесшовное размытие</span>
                  </button>
                  <button type="button" class="cleanview-style-chip ${currentSettings.maskStyle === 'blackout' ? 'active' : ''}" id="style-blackout-btn">
                    <span>⬛ Чёрная плашка</span>
                  </button>
                </div>
              </div>

              <!-- Прозрачность размытия -->
              <div class="cleanview-section" id="cleanview-opacity-section" style="${currentSettings.maskStyle === 'blackout' ? 'display: none;' : ''}">
                <div class="cleanview-section-header-row" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                  <div class="cleanview-section-label" style="margin-bottom: 0;">Прозрачность размытия:</div>
                  <span class="cleanview-opacity-badge" id="cleanview-opacity-val">${Math.round((currentSettings.maskOpacity !== undefined ? currentSettings.maskOpacity : 0.55) * 100)}%</span>
                </div>
                <div class="cleanview-slider-row" style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                  <input type="range" class="storm-slider" id="cleanview-opacity-slider" min="15" max="85" step="5" value="${Math.round((currentSettings.maskOpacity !== undefined ? currentSettings.maskOpacity : 0.55) * 100)}">
                </div>
                <div class="cleanview-quick-opacity-row" style="display: flex; gap: 8px;">
                  <button type="button" class="cleanview-opacity-chip ${Math.round((currentSettings.maskOpacity || 0.55) * 100) <= 40 ? 'active' : ''}" data-opacity="0.35">
                    <span>35%</span>
                  </button>
                  <button type="button" class="cleanview-opacity-chip ${Math.round((currentSettings.maskOpacity || 0.55) * 100) > 40 && Math.round((currentSettings.maskOpacity || 0.55) * 100) <= 68 ? 'active' : ''}" data-opacity="0.55">
                    <span>55%</span>
                  </button>
                  <button type="button" class="cleanview-opacity-chip ${Math.round((currentSettings.maskOpacity || 0.55) * 100) > 68 ? 'active' : ''}" data-opacity="0.80">
                    <span>80%</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="cleanview-footer">
        <span class="cleanview-status-label ${currentSettings.watermarkMaskEnabled ? 'active' : ''}">${currentSettings.watermarkMaskEnabled ? '🟢 Маска активна' : '⚪ Маска выключена'}</span>
        <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="cleanview-done-btn">Готово</button>
      </div>
    </div>
  `;

  // Навешиваем события
  const closeBtn = panel.querySelector('#cleanview-close-btn');
  const doneBtn = panel.querySelector('#cleanview-done-btn');
  const skipperRow = panel.querySelector('#cleanview-skipper-row');
  const skipperToggle = panel.querySelector('#cleanview-ad-skipper-toggle');
  const maskRow = panel.querySelector('#cleanview-mask-row');
  const maskToggle = panel.querySelector('#cleanview-mask-toggle');
  const aimBtn = panel.querySelector('#cleanview-aim-btn');
  const styleBlurBtn = panel.querySelector('#style-blur-btn');
  const styleBlackoutBtn = panel.querySelector('#style-blackout-btn');
  const opacitySlider = panel.querySelector('#cleanview-opacity-slider');
  const opacityValBadge = panel.querySelector('#cleanview-opacity-val');

  const closeHandler = () => {
    panel.classList.remove('is-open');
    if (currentSettings.isCustomizing) {
      currentSettings.isCustomizing = false;
      applyMaskSettings();
    }
  };

  if (closeBtn) closeBtn.onclick = closeHandler;
  if (doneBtn) doneBtn.onclick = closeHandler;

  // Переключение авто-пропуска по клику на строку или тумблер
  if (skipperToggle) {
    skipperToggle.onchange = (e) => {
      currentSettings.adSkipperEnabled = e.target.checked;
      saveCleanViewSettings();
    };
  }
  if (skipperRow) {
    skipperRow.onclick = (e) => {
      if (e.target === skipperToggle || e.target.closest('.storm-toggle-switch')) return;
      currentSettings.adSkipperEnabled = !currentSettings.adSkipperEnabled;
      saveCleanViewSettings();
      renderCleanViewPanelContent(panel);
    };
  }

  // Переключение маски по клику на строку или тумблер
  if (maskToggle) {
    maskToggle.onchange = (e) => {
      currentSettings.watermarkMaskEnabled = e.target.checked;
      saveCleanViewSettings();
      applyMaskSettings();
      renderCleanViewPanelContent(panel);
    };
  }
  if (maskRow) {
    maskRow.onclick = (e) => {
      if (e.target === maskToggle || e.target.closest('.storm-toggle-switch')) return;
      currentSettings.watermarkMaskEnabled = !currentSettings.watermarkMaskEnabled;
      saveCleanViewSettings();
      applyMaskSettings();
      renderCleanViewPanelContent(panel);
    };
  }

  if (aimBtn) {
    aimBtn.onclick = () => {
      currentSettings.watermarkMaskEnabled = true;
      saveCleanViewSettings();
      applyMaskSettings();
      startAimMode();
    };
  }

  // Кнопки пресетов: клик на любой пресет сразу включает маску и применяет координаты
  panel.querySelectorAll('.cleanview-preset-btn').forEach(btn => {
    btn.onclick = () => {
      const presetId = btn.dataset.preset;
      currentSettings.activePreset = presetId;
      currentSettings.watermarkMaskEnabled = true;
      currentSettings.isCustomizing = (presetId === 'custom');
      saveCleanViewSettings();
      applyMaskSettings();
      renderCleanViewPanelContent(panel);
    };
  });

  // Джойстик микро-подгонки
  const nudgeStep = (axis, delta) => {
    const coords = { ...(currentSettings.customCoords || WATERMARK_PRESETS['1xbet_mid'].coords) };
    if (axis === 'top') {
      const curTop = parseFloat(coords.top || '37');
      coords.top = `${Math.max(2, Math.min(92, curTop + delta)).toFixed(1)}%`;
      coords.bottom = '';
    } else if (axis === 'left') {
      const curLeft = parseFloat(coords.left || '1.2');
      coords.left = `${Math.max(0, Math.min(90, curLeft + delta)).toFixed(1)}%`;
      coords.right = '';
    }
    currentSettings.customCoords = coords;
    currentSettings.activePreset = 'custom';
    currentSettings.watermarkMaskEnabled = true;
    saveCleanViewSettings();
    applyMaskSettings();
    renderCleanViewPanelContent(panel);
  };

  const nudgeUp = panel.querySelector('#nudge-up-btn');
  const nudgeDown = panel.querySelector('#nudge-down-btn');
  const nudgeLeft = panel.querySelector('#nudge-left-btn');
  const nudgeRight = panel.querySelector('#nudge-right-btn');

  if (nudgeUp) nudgeUp.onclick = () => nudgeStep('top', -1.5);
  if (nudgeDown) nudgeDown.onclick = () => nudgeStep('top', 1.5);
  if (nudgeLeft) nudgeLeft.onclick = () => nudgeStep('left', -0.8);
  if (nudgeRight) nudgeRight.onclick = () => nudgeStep('left', 0.8);

  if (styleBlurBtn) {
    styleBlurBtn.onclick = () => {
      currentSettings.maskStyle = 'blur';
      currentSettings.watermarkMaskEnabled = true;
      saveCleanViewSettings();
      applyMaskSettings();
      renderCleanViewPanelContent(panel);
    };
  }

  if (styleBlackoutBtn) {
    styleBlackoutBtn.onclick = () => {
      currentSettings.maskStyle = 'blackout';
      currentSettings.watermarkMaskEnabled = true;
      saveCleanViewSettings();
      applyMaskSettings();
      renderCleanViewPanelContent(panel);
    };
  }

  // Регулировка прозрачности размытия (живой интерактивный слайдер)
  if (opacitySlider) {
    opacitySlider.oninput = (e) => {
      const val = parseInt(e.target.value, 10);
      const floatVal = val / 100;
      currentSettings.maskOpacity = floatVal;
      if (opacityValBadge) opacityValBadge.textContent = `${val}%`;
      if (maskElement && currentSettings.maskStyle !== 'blackout') {
        maskElement.style.opacity = String(floatVal);
      }
    };
    opacitySlider.onchange = (e) => {
      const val = parseInt(e.target.value, 10);
      currentSettings.maskOpacity = val / 100;
      saveCleanViewSettings();
      applyMaskSettings();
      renderCleanViewPanelContent(panel);
    };
  }

  panel.querySelectorAll('.cleanview-opacity-chip').forEach(chip => {
    chip.onclick = () => {
      const floatVal = parseFloat(chip.dataset.opacity);
      currentSettings.maskOpacity = floatVal;
      saveCleanViewSettings();
      applyMaskSettings();
      renderCleanViewPanelContent(panel);
    };
  });
}
