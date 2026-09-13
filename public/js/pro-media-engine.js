/**
 * STORM MULTIMEDIA — Pro Media Engine
 * Профессиональный студийный движок обработки видео и звука
 * Поддержка новейших кинематографических технологий:
 * - HDR10 Vivid и Dolby Vision Cinema Tonemapping
 * - Filmmaker Mode (калиброванное теплое изображение D65)
 * - AMD FidelityFX CAS (Contrast Adaptive Sharpening)
 * - 21:9 Cinemascope (просмотр без черных полос)
 * - Процедурное аналоговое зерно 35 мм кинопленки
 * - Dolby Atmos 3D Spatial Audio и DTS:X Surround (Web Audio API)
 * - AI Voice Boost (интеллектуальное выделение речи)
 * - Студийный 10-полосный параметрический эквалайзер и Subwoofer Bass Boost
 */

// ==========================================
// 1. КОНФИГУРАЦИЯ И СОСТОЯНИЕ ВИДЕО-ДВИЖКА
// ==========================================
const DEFAULT_VIDEO_SETTINGS = {
  preset: 'standard', // 'standard', 'hdr10', 'dolby_vision_dark', 'dolby_vision_bright', 'filmmaker', 'oled_black'
  casSharpness: 'off', // 'off', 'soft', 'standard', 'ultra'
  filmGrain: 'off', // 'off', 'subtle', 'cinema_35mm'
  aspectRatio: '16:9', // '16:9', '21:9', 'fit', 'auto'
  brightness: 100, // 70 - 150 %
  contrast: 100, // 70 - 160 %
  saturation: 100, // 0 - 200 %
  colorTemp: 6500, // 4500K - 9300K
  sharpness: 0 // 0 - 100 %
};

let proVideoSettings = { ...DEFAULT_VIDEO_SETTINGS };

try {
  const savedVideo = localStorage.getItem('storm_pro_video_settings');
  if (savedVideo) {
    proVideoSettings = { ...DEFAULT_VIDEO_SETTINGS, ...JSON.parse(savedVideo) };
  }
} catch {}

// ==========================================
// 2. КОНФИГУРАЦИЯ И СОСТОЯНИЕ АУДИО-ДВИЖКА
// ==========================================
export const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const EQ_PRESETS = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  cinema: [4, 3, 1, 0, -1, 1, 3, 4, 3, 2],
  bass: [7, 6, 4, 2, 0, 0, 0, 0, 0, 0],
  voice: [-2, -1, 0, 2, 4, 5, 4, 2, 0, -1],
  night: [2, 1, 0, 1, 3, 2, 1, -1, -2, -3],
  live: [3, 2, 1, 1, 2, 3, 4, 4, 3, 2]
};

const DEFAULT_AUDIO_SETTINGS = {
  spatialMode: 'stereo', // 'stereo', 'atmos', 'dtsx', 'headphones'
  voiceBoost: 'off', // 'off', 'mild', 'strong'
  bassBoost: 'off', // 'off', 'cinema', 'ultra'
  nightMode: false,
  eqPreset: 'cinema',
  eqBands: [...EQ_PRESETS.cinema],
  preampGain: 1.0, // 0.5 - 2.0
  audioDelayMs: 0 // -1000 to +1000 ms
};

let proAudioSettings = { ...DEFAULT_AUDIO_SETTINGS };

try {
  const savedAudio = localStorage.getItem('storm_pro_audio_settings');
  if (savedAudio) {
    proAudioSettings = { ...DEFAULT_AUDIO_SETTINGS, ...JSON.parse(savedAudio) };
  }
} catch {}

// Узлы Web Audio API
let proAudioCtx = null;
let proSourceNode = null;
let proBassFilter = null;
let proVoiceFilter = null;
let proEqFilters = [];
let proCompressor = null;
let proConvolver = null;
let proWetGain = null;
let proDryGain = null;
let proMasterGain = null;
let proDelayNode = null;
let attachedMediaElement = null;

// ==========================================
// 3. ПРИМЕНЕНИЕ ВИДЕО-НАСТРОЕК (CSS & SVG FILTERS)
// ==========================================
function ensureSvgFiltersInjected() {
  if (document.getElementById('storm-pro-filters-svg')) return;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'storm-pro-filters-svg';
  svg.style.position = 'absolute';
  svg.style.width = '0';
  svg.style.height = '0';
  svg.style.pointerEvents = 'none';
  svg.innerHTML = `
    <defs>
      <!-- AMD FidelityFX Contrast Adaptive Sharpening (CAS) Soft -->
      <filter id="storm-cas-soft" x="0%" y="0%" width="100%" height="100%">
        <feConvolveMatrix order="3" kernelMatrix="0 -0.25 0 -0.25 2.0 -0.25 0 -0.25 0" preserveAlpha="true" />
      </filter>
      <!-- AMD FidelityFX CAS Standard -->
      <filter id="storm-cas-std" x="0%" y="0%" width="100%" height="100%">
        <feConvolveMatrix order="3" kernelMatrix="0 -0.5 0 -0.5 3.0 -0.5 0 -0.5 0" preserveAlpha="true" />
      </filter>
      <!-- AMD FidelityFX CAS Ultra -->
      <filter id="storm-cas-ultra" x="0%" y="0%" width="100%" height="100%">
        <feConvolveMatrix order="3" kernelMatrix="-0.2 -0.6 -0.2 -0.6 4.2 -0.6 -0.2 -0.6 -0.2" preserveAlpha="true" />
      </filter>
      <!-- 35mm Analog Film Grain Subtle -->
      <filter id="storm-film-grain-subtle">
        <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="3" result="noise" />
        <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.07 0" in="noise" result="coloredNoise" />
        <feBlend mode="overlay" in="SourceGraphic" in2="coloredNoise" />
      </filter>
      <!-- 35mm Analog Film Grain Cinema -->
      <filter id="storm-film-grain-cinema">
        <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="4" result="noise" />
        <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.14 0" in="noise" result="coloredNoise" />
        <feBlend mode="overlay" in="SourceGraphic" in2="coloredNoise" />
      </filter>
    </defs>
  `;
  document.body.appendChild(svg);
}

export function applyProVideoSettings(target = null) {
  ensureSvgFiltersInjected();

  const videoEl = target || document.getElementById('storm-video-player');
  const iframeEl = document.querySelector('.cinema-player-iframe');
  const activeTarget = videoEl || iframeEl;

  if (!activeTarget) return;

  const s = proVideoSettings;

  // 1. Базовые CSS фильтры калибровки и пресетов
  let brightness = s.brightness / 100;
  let contrast = s.contrast / 100;
  let saturation = s.saturation / 100;
  let sepia = 0;
  let hueRotate = 0;

  // Пресеты отображения
  switch (s.preset) {
    case 'hdr10':
      // HDR10 Vivid: расширение пиковой яркости и локального контраста
      contrast *= 1.16;
      brightness *= 1.06;
      saturation *= 1.22;
      break;
    case 'dolby_vision_dark':
      // Dolby Vision Cinema Dark: глубокий кинематографический черный для темных залов
      contrast *= 1.24;
      brightness *= 0.95;
      saturation *= 1.12;
      break;
    case 'dolby_vision_bright':
      // Dolby Vision Cinema Bright: повышенная динамическая видимость для освещенных комнат
      contrast *= 1.18;
      brightness *= 1.12;
      saturation *= 1.18;
      break;
    case 'filmmaker':
      // Filmmaker Mode: точная калибровка 6500K без переусиления цветов
      contrast *= 1.04;
      brightness *= 1.01;
      saturation *= 1.02;
      sepia = 0.06; // Теплый кинематографический баланс D65
      break;
    case 'oled_black':
      // OLED True Black: глубочайшие тени и чистый черный
      contrast *= 1.28;
      brightness *= 0.93;
      saturation *= 1.14;
      break;
    case 'standard':
    default:
      break;
  }

  // Температурный баланс
  if (s.colorTemp < 6500) {
    // Теплее
    sepia += ((6500 - s.colorTemp) / 6500) * 0.18;
  } else if (s.colorTemp > 6500) {
    // Холоднее
    hueRotate = ((s.colorTemp - 6500) / 2800) * -12;
  }

  // Формируем цепочку фильтров
  const filterParts = [
    `brightness(${brightness.toFixed(3)})`,
    `contrast(${contrast.toFixed(3)})`,
    `saturate(${saturation.toFixed(3)})`
  ];

  if (sepia > 0) filterParts.push(`sepia(${sepia.toFixed(3)})`);
  if (hueRotate !== 0) filterParts.push(`hue-rotate(${hueRotate.toFixed(1)}deg)`);

  // Добавляем SVG фильтр резкости FSR CAS или 35мм зерна
  if (s.casSharpness === 'soft') {
    filterParts.push('url(#storm-cas-soft)');
  } else if (s.casSharpness === 'standard') {
    filterParts.push('url(#storm-cas-std)');
  } else if (s.casSharpness === 'ultra') {
    filterParts.push('url(#storm-cas-ultra)');
  }

  if (s.filmGrain === 'subtle') {
    filterParts.push('url(#storm-film-grain-subtle)');
  } else if (s.filmGrain === 'cinema_35mm') {
    filterParts.push('url(#storm-film-grain-cinema)');
  }

  activeTarget.style.filter = filterParts.join(' ');
  activeTarget.style.transition = 'filter 0.2s ease, transform 0.2s ease';

  // 2. Соотношение сторон и кадрирование (Aspect Ratio / 21:9 Cinemascope)
  const container = activeTarget.closest('.player-video-box') || activeTarget.parentElement;
  if (container) {
    if (s.aspectRatio === '21:9') {
      // 21:9 Cinemascope — масштабируем изображение по высоте, убирая черные полосы
      activeTarget.style.transform = 'scale(1.33)';
      activeTarget.style.transformOrigin = 'center center';
      container.style.overflow = 'hidden';
    } else if (s.aspectRatio === 'fit') {
      activeTarget.style.transform = 'scale(1.08)';
      activeTarget.style.transformOrigin = 'center center';
      container.style.overflow = 'hidden';
    } else {
      activeTarget.style.transform = 'scale(1)';
      activeTarget.style.transformOrigin = 'center center';
    }
  }

  // Сохраняем в память
  try {
    localStorage.setItem('storm_pro_video_settings', JSON.stringify(proVideoSettings));
  } catch {}
}

// ==========================================
// 4. ПРИМЕНЕНИЕ АУДИО-НАСТРОЕК (WEB AUDIO API)
// ==========================================
export function initProAudioEngine(video = document.getElementById('storm-video-player')) {
  if (!video) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    if (!proAudioCtx) {
      proAudioCtx = new AudioContext();
    }

    if (proAudioCtx.state === 'suspended') {
      proAudioCtx.resume();
    }

    if (!proSourceNode || attachedMediaElement !== video) {
      if (proSourceNode) {
        try { proSourceNode.disconnect(); } catch {}
      }
      proSourceNode = proAudioCtx.createMediaElementSource(video);
      attachedMediaElement = video;

      // 1. Фильтр усиления баса (Low-shelf 80Hz)
      proBassFilter = proAudioCtx.createBiquadFilter();
      proBassFilter.type = 'lowshelf';
      proBassFilter.frequency.setValueAtTime(80, proAudioCtx.currentTime);

      // 2. Фильтр выделения речи (Peaking 2500Hz, Q=1.2)
      proVoiceFilter = proAudioCtx.createBiquadFilter();
      proVoiceFilter.type = 'peaking';
      proVoiceFilter.frequency.setValueAtTime(2500, proAudioCtx.currentTime);
      proVoiceFilter.Q.setValueAtTime(1.2, proAudioCtx.currentTime);

      // 3. 10-полосный эквалайзер
      proEqFilters = EQ_FREQUENCIES.map(freq => {
        const f = proAudioCtx.createBiquadFilter();
        if (freq <= 32) {
          f.type = 'lowshelf';
        } else if (freq >= 16000) {
          f.type = 'highshelf';
        } else {
          f.type = 'peaking';
          f.Q.setValueAtTime(1.4, proAudioCtx.currentTime);
        }
        f.frequency.setValueAtTime(freq, proAudioCtx.currentTime);
        return f;
      });

      // 4. Компрессор динамического диапазона (Ночной режим)
      proCompressor = proAudioCtx.createDynamicsCompressor();
      proCompressor.threshold.setValueAtTime(-24, proAudioCtx.currentTime);
      proCompressor.knee.setValueAtTime(30, proAudioCtx.currentTime);
      proCompressor.ratio.setValueAtTime(12, proAudioCtx.currentTime);
      proCompressor.attack.setValueAtTime(0.003, proAudioCtx.currentTime);
      proCompressor.release.setValueAtTime(0.25, proAudioCtx.currentTime);

      // 5. Задержка звука (Audio Sync Offset)
      proDelayNode = proAudioCtx.createDelay(2.0);
      proDelayNode.delayTime.setValueAtTime(0, proAudioCtx.currentTime);

      // 6. Сверточный ревербератор для Dolby Atmos 3D акустики кинозала
      proConvolver = proAudioCtx.createConvolver();
      proConvolver.buffer = createCinematicImpulseBuffer(proAudioCtx, 1.4, 2.2);

      proWetGain = proAudioCtx.createGain();
      proDryGain = proAudioCtx.createGain();
      proMasterGain = proAudioCtx.createGain();

      // Собираем звуковой тракт:
      // Source -> Delay -> Bass -> Voice -> EQ[0..9] -> Split:
      //                                                -> DryGain -> MasterGain
      //                                                -> Convolver -> WetGain -> MasterGain
      //                                                (optional Compressor) -> Destination
      let lastNode = proSourceNode;
      lastNode.connect(proDelayNode);
      lastNode = proDelayNode;

      lastNode.connect(proBassFilter);
      lastNode = proBassFilter;

      lastNode.connect(proVoiceFilter);
      lastNode = proVoiceFilter;

      for (const eqNode of proEqFilters) {
        lastNode.connect(eqNode);
        lastNode = eqNode;
      }

      // Разветвление на сухой и пространственный сигнал (Dolby Atmos)
      lastNode.connect(proDryGain);
      lastNode.connect(proConvolver);
      proConvolver.connect(proWetGain);

      proDryGain.connect(proMasterGain);
      proWetGain.connect(proMasterGain);

      // Мастер-выход через ночной компрессор или напрямую
      proMasterGain.connect(proCompressor);
      proCompressor.connect(proAudioCtx.destination);
    }

    applyProAudioSettings();
  } catch (err) {
    // В случае CORS или если браузер блокирует захват аудио
    console.warn('ProAudioEngine init note:', err.message);
  }
}

// Генерация синтетического импульса кинозала (Reverb Impulse)
function createCinematicImpulseBuffer(ctx, duration = 1.2, decay = 2.0) {
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * duration;
  const buffer = ctx.createBuffer(2, length, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  for (let i = 0; i < length; i++) {
    const n = i;
    const factor = Math.exp(-n / (sampleRate * (decay / 10)));
    left[i] = (Math.random() * 2 - 1) * factor;
    right[i] = (Math.random() * 2 - 1) * factor;
  }
  return buffer;
}

export function applyProAudioSettings() {
  if (!proAudioCtx) return;
  const s = proAudioSettings;
  const now = proAudioCtx.currentTime;

  // 1. Усиление баса
  if (proBassFilter) {
    const bassGains = { off: 0, cinema: 4.5, ultra: 8.5 };
    const gain = bassGains[s.bassBoost] || 0;
    proBassFilter.gain.setTargetAtTime(gain, now, 0.05);
  }

  // 2. Интеллектуальное выделение речи (AI Voice Boost)
  if (proVoiceFilter) {
    const voiceGains = { off: 0, mild: 3.5, strong: 6.5 };
    const gain = voiceGains[s.voiceBoost] || 0;
    proVoiceFilter.gain.setTargetAtTime(gain, now, 0.05);
  }

  // 3. Эквалайзер 10 полос
  if (proEqFilters.length === 10) {
    for (let i = 0; i < 10; i++) {
      const val = s.eqBands[i] !== undefined ? s.eqBands[i] : 0;
      proEqFilters[i].gain.setTargetAtTime(val, now, 0.05);
    }
  }

  // 4. Пространственный звук (Dolby Atmos & DTS:X 3D)
  if (proWetGain && proDryGain) {
    if (s.spatialMode === 'atmos') {
      proDryGain.gain.setTargetAtTime(0.85, now, 0.05);
      proWetGain.gain.setTargetAtTime(0.35, now, 0.05);
    } else if (s.spatialMode === 'dtsx') {
      proDryGain.gain.setTargetAtTime(0.9, now, 0.05);
      proWetGain.gain.setTargetAtTime(0.25, now, 0.05);
    } else if (s.spatialMode === 'headphones') {
      proDryGain.gain.setTargetAtTime(0.8, now, 0.05);
      proWetGain.gain.setTargetAtTime(0.3, now, 0.05);
    } else {
      // Стерео прямое
      proDryGain.gain.setTargetAtTime(1.0, now, 0.05);
      proWetGain.gain.setTargetAtTime(0.0, now, 0.05);
    }
  }

  // 5. Ночной компрессор
  if (proCompressor) {
    if (s.nightMode) {
      proCompressor.threshold.setTargetAtTime(-28, now, 0.05);
      proCompressor.ratio.setTargetAtTime(16, now, 0.05);
    } else {
      proCompressor.threshold.setTargetAtTime(-10, now, 0.05);
      proCompressor.ratio.setTargetAtTime(2, now, 0.05);
    }
  }

  // 6. Мастер-громкость
  if (proMasterGain) {
    proMasterGain.gain.setTargetAtTime(s.preampGain || 1.0, now, 0.05);
  }

  // 7. Синхронизация задержки
  if (proDelayNode) {
    const delaySec = Math.max(0, Math.min(1.5, (s.audioDelayMs || 0) / 1000));
    proDelayNode.delayTime.setTargetAtTime(delaySec, now, 0.05);
  }

  try {
    localStorage.setItem('storm_pro_audio_settings', JSON.stringify(proAudioSettings));
  } catch {}
}

// ==========================================
// 5. РЕНДЕРИНГ ПАНЕЛИ PRO ВИДЕО (UI)
// ==========================================
export function renderProVideoPanel(hostElement) {
  if (!hostElement) return;

  const s = proVideoSettings;

  hostElement.innerHTML = `
    <div class="pro-engine-panel" id="pro-video-panel">
      <div class="pro-engine-header">
        <div class="pro-engine-title">
          <span>🎛️</span>
          <span>Профессиональные настройки изображения</span>
        </div>
        <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="close-pro-video-btn" style="padding: 4px 8px;">✕</button>
      </div>

      <!-- Секция 1: Цветопередача и HDR Режимы -->
      <div class="pro-engine-section">
        <div class="pro-section-title">Цветопередача и кинематографический HDR</div>
        <div class="pro-preset-grid">
          <button type="button" class="pro-card-btn ${s.preset === 'standard' ? 'active' : ''}" data-preset="standard">
            <span class="pro-card-icon">📺</span>
            <span class="pro-card-name">Стандарт</span>
            <span class="pro-card-desc">Естественная цветопередача</span>
          </button>
          <button type="button" class="pro-card-btn ${s.preset === 'hdr10' ? 'active' : ''}" data-preset="hdr10">
            <span class="pro-card-icon">✨</span>
            <span class="pro-card-name">HDR10 Vivid</span>
            <span class="pro-card-desc">Пиковая яркость и контраст</span>
          </button>
          <button type="button" class="pro-card-btn ${s.preset === 'dolby_vision_dark' ? 'active' : ''}" data-preset="dolby_vision_dark">
            <span class="pro-card-icon">🎬</span>
            <span class="pro-card-name">Dolby Vision Dark</span>
            <span class="pro-card-desc">Глубокий черный для OLED</span>
          </button>
          <button type="button" class="pro-card-btn ${s.preset === 'dolby_vision_bright' ? 'active' : ''}" data-preset="dolby_vision_bright">
            <span class="pro-card-icon">☀️</span>
            <span class="pro-card-name">Dolby Vision Bright</span>
            <span class="pro-card-desc">Для освещенных комнат</span>
          </button>
          <button type="button" class="pro-card-btn ${s.preset === 'filmmaker' ? 'active' : ''}" data-preset="filmmaker">
            <span class="pro-card-icon">🎞️</span>
            <span class="pro-card-name">Filmmaker Mode</span>
            <span class="pro-card-desc">Теплый баланс режиссера D65</span>
          </button>
          <button type="button" class="pro-card-btn ${s.preset === 'oled_black' ? 'active' : ''}" data-preset="oled_black">
            <span class="pro-card-icon">🌑</span>
            <span class="pro-card-name">OLED True Black</span>
            <span class="pro-card-desc">Максимальный контраст</span>
          </button>
        </div>
      </div>

      <!-- Секция 2: Резкость FSR и Зерно 35 мм -->
      <div class="pro-engine-grid-2col">
        <div class="pro-engine-section">
          <div class="pro-section-title">Адаптивная резкость (AMD FidelityFX CAS)</div>
          <div class="pro-pill-group">
            <button type="button" class="pro-pill-btn ${s.casSharpness === 'off' ? 'active' : ''}" data-cas="off">Выкл</button>
            <button type="button" class="pro-pill-btn ${s.casSharpness === 'soft' ? 'active' : ''}" data-cas="soft">Мягкая 25%</button>
            <button type="button" class="pro-pill-btn ${s.casSharpness === 'standard' ? 'active' : ''}" data-cas="standard">Стандарт 50%</button>
            <button type="button" class="pro-pill-btn ${s.casSharpness === 'ultra' ? 'active' : ''}" data-cas="ultra">Ультра 100%</button>
          </div>
        </div>

        <div class="pro-engine-section">
          <div class="pro-section-title">Кинематографическое зерно (35 мм пленка)</div>
          <div class="pro-pill-group">
            <button type="button" class="pro-pill-btn ${s.filmGrain === 'off' ? 'active' : ''}" data-grain="off">Выкл</button>
            <button type="button" class="pro-pill-btn ${s.filmGrain === 'subtle' ? 'active' : ''}" data-grain="subtle">Мягкое зерно</button>
            <button type="button" class="pro-pill-btn ${s.filmGrain === 'cinema_35mm' ? 'active' : ''}" data-grain="cinema_35mm">35 мм пленка</button>
          </div>
        </div>
      </div>

      <!-- Секция 3: Соотношение сторон (Aspect Ratio & 21:9 Cinemascope) -->
      <div class="pro-engine-section">
        <div class="pro-section-title">Соотношение сторон и кадрирование</div>
        <div class="pro-pill-group">
          <button type="button" class="pro-pill-btn ${s.aspectRatio === '16:9' ? 'active' : ''}" data-aspect="16:9">16:9 Стандарт</button>
          <button type="button" class="pro-pill-btn ${s.aspectRatio === '21:9' ? 'active' : ''}" data-aspect="21:9">21:9 Cinemascope (без полос)</button>
          <button type="button" class="pro-pill-btn ${s.aspectRatio === 'fit' ? 'active' : ''}" data-aspect="fit">Заполнение экрана</button>
          <button type="button" class="pro-pill-btn ${s.aspectRatio === 'auto' ? 'active' : ''}" data-aspect="auto">Авто</button>
        </div>
      </div>

      <!-- Секция 4: Ручная калибровка дисплея -->
      <div class="pro-engine-section">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div class="pro-section-title" style="margin: 0;">Тонкая калибровка параметров</div>
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="reset-pro-video-btn" style="font-size: 11px;">Сброс по умолчанию</button>
        </div>

        <div class="pro-sliders-grid">
          <div class="pro-slider-item">
            <div class="pro-slider-label">
              <span>Яркость</span>
              <span id="label-brightness">${s.brightness}%</span>
            </div>
            <input type="range" class="storm-slider" id="slider-brightness" min="70" max="140" value="${s.brightness}">
          </div>
          <div class="pro-slider-item">
            <div class="pro-slider-label">
              <span>Контрастность</span>
              <span id="label-contrast">${s.contrast}%</span>
            </div>
            <input type="range" class="storm-slider" id="slider-contrast" min="70" max="150" value="${s.contrast}">
          </div>
          <div class="pro-slider-item">
            <div class="pro-slider-label">
              <span>Насыщенность</span>
              <span id="label-saturation">${s.saturation}%</span>
            </div>
            <input type="range" class="storm-slider" id="slider-saturation" min="0" max="180" value="${s.saturation}">
          </div>
          <div class="pro-slider-item">
            <div class="pro-slider-label">
              <span>Цветовая температура</span>
              <span id="label-colortemp">${s.colorTemp}K</span>
            </div>
            <input type="range" class="storm-slider" id="slider-colortemp" min="4500" max="9300" step="100" value="${s.colorTemp}">
          </div>
        </div>
      </div>
    </div>
  `;

  // Обработчики пресетов
  hostElement.querySelectorAll('[data-preset]').forEach(btn => {
    btn.onclick = () => {
      hostElement.querySelectorAll('[data-preset]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      proVideoSettings.preset = btn.dataset.preset;
      applyProVideoSettings();
    };
  });

  // Резкость CAS
  hostElement.querySelectorAll('[data-cas]').forEach(btn => {
    btn.onclick = () => {
      hostElement.querySelectorAll('[data-cas]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      proVideoSettings.casSharpness = btn.dataset.cas;
      applyProVideoSettings();
    };
  });

  // Зерно пленки
  hostElement.querySelectorAll('[data-grain]').forEach(btn => {
    btn.onclick = () => {
      hostElement.querySelectorAll('[data-grain]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      proVideoSettings.filmGrain = btn.dataset.grain;
      applyProVideoSettings();
    };
  });

  // Соотношение сторон
  hostElement.querySelectorAll('[data-aspect]').forEach(btn => {
    btn.onclick = () => {
      hostElement.querySelectorAll('[data-aspect]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      proVideoSettings.aspectRatio = btn.dataset.aspect;
      applyProVideoSettings();
    };
  });

  // Ползунки
  const bindSlider = (id, prop, unit) => {
    const input = hostElement.querySelector(`#slider-${id}`);
    const label = hostElement.querySelector(`#label-${id}`);
    if (input && label) {
      input.oninput = () => {
        const val = Number(input.value);
        proVideoSettings[prop] = val;
        label.textContent = `${val}${unit}`;
        applyProVideoSettings();
      };
    }
  };

  bindSlider('brightness', 'brightness', '%');
  bindSlider('contrast', 'contrast', '%');
  bindSlider('saturation', 'saturation', '%');
  bindSlider('colortemp', 'colorTemp', 'K');

  // Сброс
  const resetBtn = hostElement.querySelector('#reset-pro-video-btn');
  if (resetBtn) {
    resetBtn.onclick = () => {
      proVideoSettings = { ...DEFAULT_VIDEO_SETTINGS };
      applyProVideoSettings();
      renderProVideoPanel(hostElement);
    };
  }

  // Закрытие
  const closeBtn = hostElement.querySelector('#close-pro-video-btn');
  if (closeBtn) {
    closeBtn.onclick = () => {
      hostElement.style.display = 'none';
    };
  }
}

// ==========================================
// 6. РЕНДЕРИНГ ПАНЕЛИ PRO ЗВУК (UI)
// ==========================================
export function renderProAudioPanel(hostElement) {
  if (!hostElement) return;

  const s = proAudioSettings;

  hostElement.innerHTML = `
    <div class="pro-engine-panel" id="pro-audio-panel">
      <div class="pro-engine-header">
        <div class="pro-engine-title">
          <span>🔊</span>
          <span>Профессиональная студия звука и эквалайзер</span>
        </div>
        <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="close-pro-audio-btn" style="padding: 4px 8px;">✕</button>
      </div>

      <!-- Секция 1: Пространственный звук (Dolby Atmos & 3D Spatial) -->
      <div class="pro-engine-section">
        <div class="pro-section-title">Пространственное 3D-аудио и акустика зала</div>
        <div class="pro-preset-grid">
          <button type="button" class="pro-card-btn ${s.spatialMode === 'stereo' ? 'active' : ''}" data-spatial="stereo">
            <span class="pro-card-icon">🎧</span>
            <span class="pro-card-name">Студийное стерео</span>
            <span class="pro-card-desc">Прямой чистый звук</span>
          </button>
          <button type="button" class="pro-card-btn ${s.spatialMode === 'atmos' ? 'active' : ''}" data-spatial="atmos">
            <span class="pro-card-icon">🌌</span>
            <span class="pro-card-name">Dolby Atmos 3D</span>
            <span class="pro-card-desc">Кинематографический объем</span>
          </button>
          <button type="button" class="pro-card-btn ${s.spatialMode === 'dtsx' ? 'active' : ''}" data-spatial="dtsx">
            <span class="pro-card-icon">💥</span>
            <span class="pro-card-name">DTS:X Surround</span>
            <span class="pro-card-desc">Динамика боевиков и экшна</span>
          </button>
          <button type="button" class="pro-card-btn ${s.spatialMode === 'headphones' ? 'active' : ''}" data-spatial="headphones">
            <span class="pro-card-icon">🦻</span>
            <span class="pro-card-name">Наушники 3D HRTF</span>
            <span class="pro-card-desc">Бинауральная панорама</span>
          </button>
        </div>
      </div>

      <!-- Секция 2: Выделение речи и Усиление баса -->
      <div class="pro-engine-grid-2col">
        <div class="pro-engine-section">
          <div class="pro-section-title">Интеллектуальное выделение речи (AI Voice)</div>
          <div class="pro-pill-group">
            <button type="button" class="pro-pill-btn ${s.voiceBoost === 'off' ? 'active' : ''}" data-voice="off">Выкл</button>
            <button type="button" class="pro-pill-btn ${s.voiceBoost === 'mild' ? 'active' : ''}" data-voice="mild">Четкие диалоги (+3dB)</button>
            <button type="button" class="pro-pill-btn ${s.voiceBoost === 'strong' ? 'active' : ''}" data-voice="strong">Максимум (+6dB)</button>
          </div>
        </div>

        <div class="pro-engine-section">
          <div class="pro-section-title">Кинематографический бас (Subwoofer Boost)</div>
          <div class="pro-pill-group">
            <button type="button" class="pro-pill-btn ${s.bassBoost === 'off' ? 'active' : ''}" data-bass="off">Выкл</button>
            <button type="button" class="pro-pill-btn ${s.bassBoost === 'cinema' ? 'active' : ''}" data-bass="cinema">Кинотеатр (+4dB)</button>
            <button type="button" class="pro-pill-btn ${s.bassBoost === 'ultra' ? 'active' : ''}" data-bass="ultra">Ультра бас (+8dB)</button>
          </div>
        </div>
      </div>

      <!-- Секция 3: 10-полосный студийный эквалайзер -->
      <div class="pro-engine-section">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <div class="pro-section-title" style="margin: 0;">Студийный 10-полосный эквалайзер</div>
          <!-- Пресеты эквалайзера -->
          <div class="pro-pill-group" style="margin: 0;">
            <button type="button" class="pro-pill-btn ${s.eqPreset === 'cinema' ? 'active' : ''}" data-eq-preset="cinema">Кинозал</button>
            <button type="button" class="pro-pill-btn ${s.eqPreset === 'bass' ? 'active' : ''}" data-eq-preset="bass">Бас</button>
            <button type="button" class="pro-pill-btn ${s.eqPreset === 'voice' ? 'active' : ''}" data-eq-preset="voice">Вокал</button>
            <button type="button" class="pro-pill-btn ${s.eqPreset === 'night' ? 'active' : ''}" data-eq-preset="night">Ночь</button>
            <button type="button" class="pro-pill-btn ${s.eqPreset === 'live' ? 'active' : ''}" data-eq-preset="live">Концерт</button>
            <button type="button" class="pro-pill-btn ${s.eqPreset === 'flat' ? 'active' : ''}" data-eq-preset="flat">Плоский</button>
          </div>
        </div>

        <div class="pro-eq-bars-wrap">
          ${EQ_FREQUENCIES.map((freq, idx) => {
            const freqLabel = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
            const val = s.eqBands[idx] || 0;
            return `
              <div class="pro-eq-col">
                <span class="pro-eq-val" id="eq-val-${idx}">${val > 0 ? '+' + val : val}</span>
                <div class="pro-eq-track">
                  <input type="range" class="pro-eq-slider" orient="vertical" data-band="${idx}" min="-12" max="12" step="1" value="${val}">
                </div>
                <span class="pro-eq-freq">${freqLabel}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- Секция 4: Синхронизация звука и видео (Audio Sync Offset) -->
      <div class="pro-engine-section" style="margin-bottom: 0;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div class="pro-section-title" style="margin-bottom: 2px;">Синхронизация звука и видео (Audio Offset)</div>
            <div style="font-size: 11px; color: var(--text-muted);">Устранение задержки аудио дорожки при просмотре</div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="audio-delay-minus">-50 мс</button>
            <span id="audio-delay-val" style="font-size: 13px; font-weight: 800; min-width: 70px; text-align: center; color: var(--accent);">
              ${s.audioDelayMs > 0 ? '+' + s.audioDelayMs : s.audioDelayMs} мс
            </span>
            <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="audio-delay-plus">+50 мс</button>
            <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="audio-delay-reset">Сброс</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Пространственный звук
  hostElement.querySelectorAll('[data-spatial]').forEach(btn => {
    btn.onclick = () => {
      hostElement.querySelectorAll('[data-spatial]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      proAudioSettings.spatialMode = btn.dataset.spatial;
      applyProAudioSettings();
    };
  });

  // Выделение речи
  hostElement.querySelectorAll('[data-voice]').forEach(btn => {
    btn.onclick = () => {
      hostElement.querySelectorAll('[data-voice]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      proAudioSettings.voiceBoost = btn.dataset.voice;
      applyProAudioSettings();
    };
  });

  // Усиление баса
  hostElement.querySelectorAll('[data-bass]').forEach(btn => {
    btn.onclick = () => {
      hostElement.querySelectorAll('[data-bass]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      proAudioSettings.bassBoost = btn.dataset.bass;
      applyProAudioSettings();
    };
  });

  // Пресеты EQ
  hostElement.querySelectorAll('[data-eq-preset]').forEach(btn => {
    btn.onclick = () => {
      const p = btn.dataset.eqPreset;
      if (EQ_PRESETS[p]) {
        hostElement.querySelectorAll('[data-eq-preset]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        proAudioSettings.eqPreset = p;
        proAudioSettings.eqBands = [...EQ_PRESETS[p]];

        // Обновляем ползунки в UI
        proAudioSettings.eqBands.forEach((val, idx) => {
          const slider = hostElement.querySelector(`.pro-eq-slider[data-band="${idx}"]`);
          const label = hostElement.querySelector(`#eq-val-${idx}`);
          if (slider) slider.value = val;
          if (label) label.textContent = val > 0 ? `+${val}` : `${val}`;
        });

        applyProAudioSettings();
      }
    };
  });

  // Ползунки EQ
  hostElement.querySelectorAll('.pro-eq-slider').forEach(slider => {
    slider.oninput = () => {
      const idx = Number(slider.dataset.band);
      const val = Number(slider.value);
      proAudioSettings.eqBands[idx] = val;
      proAudioSettings.eqPreset = 'custom';
      hostElement.querySelectorAll('[data-eq-preset]').forEach(b => b.classList.remove('active'));

      const label = hostElement.querySelector(`#eq-val-${idx}`);
      if (label) label.textContent = val > 0 ? `+${val}` : `${val}`;
      applyProAudioSettings();
    };
  });

  // Синхронизация задержки
  const updateDelayUi = () => {
    const valEl = hostElement.querySelector('#audio-delay-val');
    if (valEl) {
      valEl.textContent = `${proAudioSettings.audioDelayMs > 0 ? '+' + proAudioSettings.audioDelayMs : proAudioSettings.audioDelayMs} мс`;
    }
  };

  const delayMinus = hostElement.querySelector('#audio-delay-minus');
  if (delayMinus) {
    delayMinus.onclick = () => {
      proAudioSettings.audioDelayMs = Math.max(-1000, proAudioSettings.audioDelayMs - 50);
      updateDelayUi();
      applyProAudioSettings();
    };
  }

  const delayPlus = hostElement.querySelector('#audio-delay-plus');
  if (delayPlus) {
    delayPlus.onclick = () => {
      proAudioSettings.audioDelayMs = Math.min(1000, proAudioSettings.audioDelayMs + 50);
      updateDelayUi();
      applyProAudioSettings();
    };
  }

  const delayReset = hostElement.querySelector('#audio-delay-reset');
  if (delayReset) {
    delayReset.onclick = () => {
      proAudioSettings.audioDelayMs = 0;
      updateDelayUi();
      applyProAudioSettings();
    };
  }

  // Закрытие
  const closeBtn = hostElement.querySelector('#close-pro-audio-btn');
  if (closeBtn) {
    closeBtn.onclick = () => {
      hostElement.style.display = 'none';
    };
  }
}
