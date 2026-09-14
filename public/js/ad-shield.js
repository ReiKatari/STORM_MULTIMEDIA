/**
 * STORM CleanView™ & AdShield Engine
 * Интеллектуальный модуль защиты от рекламы, авто-пропуска видеовставок
 * и маскирования/вырезания рекламных логотипов (1XBET, Winline, Мелбет и др.)
 */

// Конфигурация пресетов водяных знаков
export const WATERMARK_PRESETS = {
  '1xbet_left': {
    id: '1xbet_left',
    name: '🎯 1XBET (Слева)',
    desc: 'Классическое размещение логотипа 1XBET у левого края видео',
    coords: { top: '34%', left: '2.5%', width: '145px', height: '52px' }
  },
  'top_left': {
    id: 'top_left',
    name: '📐 Вверху слева',
    desc: 'Логотипы студий и спонсоров в верхнем левом углу',
    coords: { top: '4%', left: '3%', width: '150px', height: '46px' }
  },
  'top_right': {
    id: 'top_right',
    name: '📐 Вверху справа',
    desc: 'Водяные знаки каналов и спонсоров в верхнем правом углу',
    coords: { top: '4%', right: '3%', width: '150px', height: '46px' }
  },
  'ticker_bottom': {
    id: 'ticker_bottom',
    name: '➖ Бегущая строка',
    desc: 'Нижняя полоса промокодов и ставок на спорт',
    coords: { bottom: '12%', left: '5%', width: '90%', height: '44px' }
  },
  'custom': {
    id: 'custom',
    name: '✋ Своя область',
    desc: 'Интерактивная рамка с настройкой положения и размера мышью',
    coords: { top: '34%', left: '2.5%', width: '160px', height: '60px' }
  }
};

const DEFAULT_SETTINGS = {
  adSkipperEnabled: true,
  watermarkMaskEnabled: true,
  activePreset: '1xbet_left',
  maskStyle: 'blur', // 'blur' или 'blackout'
  customCoords: { top: '34%', left: '2.5%', width: '145px', height: '52px' },
  isCustomizing: false
};

let currentSettings = { ...DEFAULT_SETTINGS };
let maskElement = null;
let currentContainer = null;
let adWatchInterval = null;

/**
 * Загрузка сохраненных настроек из localStorage
 */
export function loadCleanViewSettings() {
  try {
    const raw = localStorage.getItem('storm_cleanview_settings');
    if (raw) {
      const parsed = JSON.parse(raw);
      currentSettings = { ...DEFAULT_SETTINGS, ...parsed, isCustomizing: false };
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
    <div class="storm-mask-label">1XBET MASK</div>
    <div class="storm-mask-handle handle-br" title="Потяните для изменения размера"></div>
    <div class="storm-mask-handle handle-drag" title="Перетащите область мышью">✥</div>
  `;

  setupMaskInteractions(maskElement, videoBox);
  applyMaskSettings();

  // Инициализируем перехватчик видеорекламы
  initAdSkipper(videoBox);

  // Добавляем плавающую кнопку быстрого доступа CleanView в оверлей плеера
  mountFloatingCleanViewBadge(videoBox);
}

/**
 * Применение текущих настроек к элементу маски
 */
export function applyMaskSettings() {
  if (!maskElement) return;

  if (!currentSettings.watermarkMaskEnabled) {
    maskElement.style.display = 'none';
    return;
  }

  maskElement.style.display = 'flex';

  // Очищаем предыдущие позиционирования
  maskElement.style.top = '';
  maskElement.style.bottom = '';
  maskElement.style.left = '';
  maskElement.style.right = '';

  const preset = WATERMARK_PRESETS[currentSettings.activePreset] || WATERMARK_PRESETS['1xbet_left'];
  const coords = currentSettings.activePreset === 'custom'
    ? (currentSettings.customCoords || preset.coords)
    : preset.coords;

  Object.assign(maskElement.style, {
    top: coords.top || '',
    bottom: coords.bottom || '',
    left: coords.left || '',
    right: coords.right || '',
    width: coords.width || '150px',
    height: coords.height || '50px'
  });

  // Стиль маски: Умное размытие (Smart Blur) или Черная плашка (Blackout)
  maskElement.classList.toggle('mode-blackout', currentSettings.maskStyle === 'blackout');
  maskElement.classList.toggle('mode-blur', currentSettings.maskStyle !== 'blackout');
  maskElement.classList.toggle('is-customizing', Boolean(currentSettings.isCustomizing));

  const labelEl = maskElement.querySelector('.storm-mask-label');
  if (labelEl) {
    labelEl.textContent = currentSettings.isCustomizing
      ? 'Настройка маски (перетащите)'
      : (preset.name.replace(/[^a-zA-Z0-9]/g, '') || 'MASK');
  }
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
          console.log('🛡️ STORM CleanView автоматически нажал кнопку пропуска рекламы');
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
 * Монтирование плавающей кнопки CleanView в плеере
 */
function mountFloatingCleanViewBadge(videoBox) {
  let badge = videoBox.querySelector('#storm-cleanview-floating-trigger');
  if (!badge) {
    badge = document.createElement('button');
    badge.id = 'storm-cleanview-floating-trigger';
    badge.type = 'button';
    badge.className = 'storm-cleanview-floating-badge';
    badge.innerHTML = `
      <span class="badge-icon">🛡️</span>
      <span class="badge-text">CleanView</span>
      <span class="badge-dot active"></span>
    `;
    badge.title = 'STORM CleanView: Очистка рекламы и скрытие водяных знаков';
    badge.onclick = (e) => {
      e.stopPropagation();
      toggleCleanViewModal();
    };
    videoBox.appendChild(badge);
  }
}

/**
 * Переключение модального окна / шторки управления CleanView
 */
export function toggleCleanViewModal() {
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
    document.body.appendChild(modal);
  }

  renderCleanViewPanelContent(modal);
  modal.classList.add('is-open');
}

/**
 * Рендеринг содержимого панели управления CleanView
 */
function renderCleanViewPanelContent(panel) {
  panel.innerHTML = `
    <div class="cleanview-card">
      <div class="cleanview-header">
        <div class="cleanview-title-group">
          <div class="cleanview-title">🛡️ STORM CleanView™ и AdShield</div>
          <div class="cleanview-subtitle">Интеллектуальная фильтрация рекламы и маскирование логотипов</div>
        </div>
        <button type="button" class="cleanview-close-btn" id="cleanview-close-btn">✕</button>
      </div>

      <div class="cleanview-body">
        <!-- Блок 1: Авто-пропуск рекламы -->
        <div class="cleanview-feature-row">
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
        <div class="cleanview-feature-row">
          <div class="feature-info">
            <div class="feature-title">✂️ Скрыть рекламные надписи и логотипы</div>
            <div class="feature-desc">Накладывает адаптивную маску на вшитые в видео логотипы (1XBET, Winline, Мелбет и др.)</div>
          </div>
          <label class="storm-toggle-switch">
            <input type="checkbox" id="cleanview-mask-toggle" ${currentSettings.watermarkMaskEnabled ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>

        <!-- Блок 3: Выбор пресета размещения -->
        <div class="cleanview-section" id="cleanview-presets-section" style="${currentSettings.watermarkMaskEnabled ? '' : 'opacity: 0.5; pointer-events: none;'}">
          <div class="cleanview-section-label">Выберите зону размещения логотипа:</div>
          <div class="cleanview-presets-grid">
            ${Object.values(WATERMARK_PRESETS).map(p => `
              <button type="button" class="cleanview-preset-btn ${currentSettings.activePreset === p.id ? 'active' : ''}" data-preset="${p.id}">
                <div class="preset-name">${p.name}</div>
                <div class="preset-desc">${p.desc}</div>
              </button>
            `).join('')}
          </div>
        </div>

        <!-- Блок 4: Стиль маски (Размытие / Затемнение) -->
        <div class="cleanview-section" id="cleanview-style-section" style="${currentSettings.watermarkMaskEnabled ? '' : 'opacity: 0.5; pointer-events: none;'}">
          <div class="cleanview-section-label">Стиль маскирования:</div>
          <div class="cleanview-styles-row">
            <button type="button" class="cleanview-style-chip ${currentSettings.maskStyle === 'blur' ? 'active' : ''}" id="style-blur-btn">
              <span>💧 Умное размытие (Smart Blur)</span>
            </button>
            <button type="button" class="cleanview-style-chip ${currentSettings.maskStyle === 'blackout' ? 'active' : ''}" id="style-blackout-btn">
              <span>⬛ Черная плашка (Blackout)</span>
            </button>
          </div>
        </div>

        <!-- Блок 5: Интерактивная подгонка -->
        <div class="cleanview-customize-box" style="${currentSettings.watermarkMaskEnabled ? '' : 'display: none;'}">
          <button type="button" class="storm-btn ${currentSettings.isCustomizing ? 'storm-btn-primary' : 'storm-btn-secondary'} storm-btn-sm" id="cleanview-customize-toggle-btn">
            ${currentSettings.isCustomizing ? '✓ Зафиксировать область' : '✋ Переместить и изменить размер маски мышью'}
          </button>
          <div class="customize-hint">
            ${currentSettings.isCustomizing ? 'Потяните за значок ✥ для перемещения или за правый нижний угол для изменения размера' : 'Вы можете идеально спозиционировать маску под размер водяного знака прямо на видео'}
          </div>
        </div>
      </div>

      <div class="cleanview-footer">
        <span class="cleanview-status-label">🟢 Защита CleanView активна</span>
        <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="cleanview-done-btn">Готово</button>
      </div>
    </div>
  `;

  // Навешиваем события
  const closeBtn = panel.querySelector('#cleanview-close-btn');
  const doneBtn = panel.querySelector('#cleanview-done-btn');
  const skipperToggle = panel.querySelector('#cleanview-ad-skipper-toggle');
  const maskToggle = panel.querySelector('#cleanview-mask-toggle');
  const styleBlurBtn = panel.querySelector('#style-blur-btn');
  const styleBlackoutBtn = panel.querySelector('#style-blackout-btn');
  const customizeBtn = panel.querySelector('#cleanview-customize-toggle-btn');

  const closeHandler = () => {
    panel.classList.remove('is-open');
    if (currentSettings.isCustomizing) {
      currentSettings.isCustomizing = false;
      applyMaskSettings();
    }
  };

  if (closeBtn) closeBtn.onclick = closeHandler;
  if (doneBtn) doneBtn.onclick = closeHandler;

  if (skipperToggle) {
    skipperToggle.onchange = (e) => {
      currentSettings.adSkipperEnabled = e.target.checked;
      saveCleanViewSettings();
    };
  }

  if (maskToggle) {
    maskToggle.onchange = (e) => {
      currentSettings.watermarkMaskEnabled = e.target.checked;
      saveCleanViewSettings();
      applyMaskSettings();
      renderCleanViewPanelContent(panel);
    };
  }

  // Кнопки пресетов
  panel.querySelectorAll('.cleanview-preset-btn').forEach(btn => {
    btn.onclick = () => {
      const presetId = btn.dataset.preset;
      currentSettings.activePreset = presetId;
      if (presetId === 'custom') {
        currentSettings.isCustomizing = true;
      } else {
        currentSettings.isCustomizing = false;
      }
      saveCleanViewSettings();
      applyMaskSettings();
      renderCleanViewPanelContent(panel);
    };
  });

  if (styleBlurBtn) {
    styleBlurBtn.onclick = () => {
      currentSettings.maskStyle = 'blur';
      saveCleanViewSettings();
      applyMaskSettings();
      renderCleanViewPanelContent(panel);
    };
  }

  if (styleBlackoutBtn) {
    styleBlackoutBtn.onclick = () => {
      currentSettings.maskStyle = 'blackout';
      saveCleanViewSettings();
      applyMaskSettings();
      renderCleanViewPanelContent(panel);
    };
  }

  if (customizeBtn) {
    customizeBtn.onclick = () => {
      currentSettings.isCustomizing = !currentSettings.isCustomizing;
      if (currentSettings.isCustomizing) {
        currentSettings.activePreset = 'custom';
      }
      saveCleanViewSettings();
      applyMaskSettings();
      renderCleanViewPanelContent(panel);
    };
  }
}
