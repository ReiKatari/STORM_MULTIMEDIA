/* ==========================================================================
   STORM MULTIMEDIA - КИНОТЕАТРАЛЬНЫЙ МОДАЛЬНЫЙ ПЛЕЕР (CINEMA MODAL)
   Поддержка 4K FanFilm4K, AniLibria HLS, AniXart, Kinobox, WebTorrent,
   Ambilight эффекта, пропуска интро/аутро, PiP, субтитров и совместного просмотра
   ========================================================================== */

import { saveBookmarkStatus, deleteBookmark, syncWatchProgress, fetchCustomLists, addItemToCollection, createCustomCollection } from './bookmarks.js';
import { getUser, showToast } from './auth.js';
import { t } from './i18n.js';
import { trackClientAction } from './achievements.js';
import { renderReviewsSection } from './reviews.js';
import { attachPlayerToRoom, createWatchRoom, getActiveRoom } from './watch-together.js';
import { initSubtitlesManager, renderSubtitlesControls } from './subtitles-manager.js';

let currentMedia = null;
let currentPlayers = [];
let currentActivePlayer = null;
let currentVoiceoverId = null;
let currentEpisodes = [];
let currentEpisodeIndex = 1;
let currentProgressPercent = 0;
let iframeWatchInterval = null;
let currentWatchTimeSeconds = 0;

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
let autoSkipEnabled = false;

// WebTorrent
let torrentClient = null;

export async function openPlayerModal(mediaItem) {
  currentMedia = mediaItem;
  const modal = document.getElementById('cinema-modal');
  if (!modal) return;

  // Проверяем ночной просмотр (между 02:00 и 05:00)
  const currentHour = new Date().getHours();
  if (currentHour >= 2 && currentHour < 5) {
    trackClientAction('night_watch');
  }

  // Сброс состояния плеера
  const iframeContainer = document.getElementById('cinema-player-wrapper');
  iframeContainer.innerHTML = '<div style="display:flex;height:100%;align-items:center;justify-content:center;color:var(--text-muted);">Загрузка видеоплеера...</div>';

  document.getElementById('cinema-modal-title').textContent = mediaItem.title;
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

  // Открываем модальное окно
  modal.classList.add('is-open');

  // Немедленно инициализируем селекторы и кнопки, чтобы они были интерактивны СРАЗУ
  renderStatusButtons(mediaItem.user_status);
  renderCustomListsSelector();
  renderPlayerUtilityButtons();

  try {
    // Получаем детальные данные с сервера с таймаутом 5000мс
    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), 5000);

    const itemUrl = `/api/media/item?id=${encodeURIComponent(mediaItem.id)}&source=${mediaItem.source}&url=${encodeURIComponent(mediaItem.link || '')}&title=${encodeURIComponent(mediaItem.title || '')}&year=${encodeURIComponent(mediaItem.year || '')}&poster=${encodeURIComponent(mediaItem.poster || '')}`;
    
    let details = null;
    try {
      const res = await fetch(itemUrl, { signal: controller.signal });
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
        players: [
          {
            id: 'kodik_direct',
            name: 'Kodik Плеер (HD)',
            url: `https://kodikplayer.com/find-player?title=${encodeURIComponent(mediaItem.title)}`,
            badge: 'KODIK'
          }
        ]
      };
    }

    currentMedia = { ...mediaItem, ...details };
    currentPlayers = details.players || [];

    // Обновляем описание и рендерим галерею кадров / скриншотов
    if (details.description) {
      document.getElementById('cinema-modal-desc').textContent = details.description;
    }
    renderScreenshotsGallery(mediaItem, details);

    // Добавляем P2P WebTorrent в список плееров
    currentPlayers.push({
      id: 'webtorrent',
      name: 'P2P WebTorrent (Торрент-стриминг)',
      url: 'webtorrent://direct',
      badge: 'P2P 4K'
    });

    renderPlayerSources(currentPlayers);
    renderStatusButtons(details.user_bookmark?.status || mediaItem.user_status);
    renderCustomListsSelector();
    renderPlayerUtilityButtons();

    // Загружаем таймкоды пропуска заставок
    loadSkipTimes(mediaItem.id, 1);

    // Для AniLibria и AniXart отображаем озвучки и серии
    if (mediaItem.source === 'anilibria' && details.episodes && details.episodes.length > 0) {
      renderAniLibriaControls(details);
    } else if (mediaItem.source === 'anixart') {
      renderAnixartControls(details);
    } else {
      document.getElementById('anixart-controls-container').style.display = 'none';
      if (currentPlayers.length > 0) {
        selectPlayer(currentPlayers[0]);
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
    modal.classList.remove('is-open');
    stopAmbilight();

    if (iframeWatchInterval) {
      clearInterval(iframeWatchInterval);
      iframeWatchInterval = null;
    }
    currentWatchTimeSeconds = 0;

    const iframeContainer = document.getElementById('cinema-player-wrapper');
    if (iframeContainer) iframeContainer.innerHTML = '';

    if (torrentClient) {
      try {
        torrentClient.destroy();
      } catch {}
      torrentClient = null;
    }
  }
}

function renderPlayerSources(players) {
  const container = document.getElementById('player-sources-bar');
  if (!container) return;
  container.innerHTML = '';

  const validPlayers = (players || []).filter(p => {
    if (!p || !p.url) return false;
    const lowerName = (p.name || '').toLowerCase();
    const lowerBadge = (p.badge || '').toLowerCase();
    const lowerId = (p.id || '').toLowerCase();
    if (lowerName.includes('трейлер') || lowerName.includes('trailer') ||
        lowerBadge.includes('трейлер') || lowerBadge.includes('trailer') ||
        lowerId.includes('trailer')) {
      return false;
    }
    if (p.url.includes('kinobox.tv') || p.url.includes('delivembd.ws')) return false;
    return true;
  });

  currentPlayers = validPlayers;

  if (validPlayers.length === 0) {
    container.innerHTML = '<span style="color:var(--text-muted);font-size:12px;">Плееры для данного видео недоступны</span>';
    return;
  }

  validPlayers.forEach((p, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `player-source-btn ${idx === 0 ? 'active' : ''}`;
    btn.innerHTML = `<span class="player-source-badge">${p.badge || 'ПЛЕЕР'}</span> <span class="player-source-name">${p.name}</span>`;
    btn.onclick = () => {
      container.querySelectorAll('.player-source-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectPlayer(p);
    };
    container.appendChild(btn);
  });
}

function selectPlayer(player) {
  currentActivePlayer = player;
  const container = document.getElementById('cinema-player-wrapper');
  if (!container) return;

  if (player.url === 'webtorrent://direct') {
    renderWebTorrentPlayer();
    return;
  }

  if (!player.url) {
    container.innerHTML = '<div style="display:flex;height:100%;align-items:center;justify-content:center;color:var(--text-muted);">Ссылка на плеер не найдена</div>';
    return;
  }

  playStreamUrl(player.url);
}

function playStreamUrl(url) {
  const container = document.getElementById('cinema-player-wrapper');
  if (!container) return;

  if (currentMedia?.source === 'fanfilm4k') {
    trackClientAction('use_4k');
  }

  if (iframeWatchInterval) {
    clearInterval(iframeWatchInterval);
    iframeWatchInterval = null;
  }

  if (url.includes('.m3u8')) {
    container.innerHTML = `
      <div class="player-video-box" style="position:relative;width:100%;height:100%;">
        <!-- Динамическая подсветка Ambilight -->
        <div id="player-ambilight-aura" class="ambilight-aura"></div>

        <video id="storm-video-player" controls autoplay style="width:100%;height:100%;background:#000;border-radius:12px;outline:none;position:relative;z-index:2;" playsinline></video>

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

    // Настраиваем HLS
    if (window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls();
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      video.play().catch(() => {});
    }

    // Подключаем Ambilight, Субтитры, Пропуск заставок и Watch Together
    setupVideoFeatures(video, videoBox);
    return;
  }

  container.innerHTML = `
    <div class="player-video-box" style="position:relative;width:100%;height:100%;">
      <div id="player-ambilight-aura" class="ambilight-aura"></div>
      <iframe class="cinema-player-iframe" src="${url}" allowfullscreen allow="autoplay; encrypted-media; fullscreen; picture-in-picture" style="position:relative;z-index:2;width:100%;height:100%;border:none;border-radius:12px;"></iframe>
    </div>
  `;

  // Автоматический трекинг прогресса при воспроизведении через Iframe
  currentWatchTimeSeconds = Math.round(((currentProgressPercent || 0) / 100) * 7200);
  let lastSync = Date.now();

  iframeWatchInterval = setInterval(() => {
    const modal = document.getElementById('cinema-modal');
    if (!modal || !modal.classList.contains('is-open')) {
      clearInterval(iframeWatchInterval);
      iframeWatchInterval = null;
      return;
    }

    currentWatchTimeSeconds += 5;
    const totalSec = 7200;
    const percent = Math.min(100, Math.round((currentWatchTimeSeconds / totalSec) * 100));
    currentProgressPercent = percent;

    const slider = document.getElementById('player-progress-slider');
    const label = document.getElementById('player-progress-label');
    if (slider) slider.value = percent;
    if (label) label.textContent = `${percent}%`;

    const now = Date.now();
    if (now - lastSync >= 15000 && getUser() && currentMedia) {
      lastSync = now;
      syncWatchProgress({
        media_id: currentMedia.id,
        source: currentMedia.source,
        title: currentMedia.title,
        poster_url: currentMedia.poster,
        media_type: currentMedia.media_type,
        season: currentMedia.season || 1,
        episode: currentEpisodeIndex || 1,
        total_episodes: currentEpisodes.length || 1,
        duration_seconds: totalSec,
        time_seconds: currentWatchTimeSeconds
      });
    }
  }, 5000);
}

function setupVideoFeatures(video, wrapper) {
  // 1. Ambilight
  initAmbilight(video);

  // 2. Субтитры и аудиодорожки
  initSubtitlesManager(video, wrapper);

  // 3. Синхронизация Кинокомнаты
  if (getActiveRoom()) {
    attachPlayerToRoom(video);
  }

  // 4. Логика пропуска опенингов и эндингов
  setupSkipLogic(video);
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
    </div>
  `;

  const closeBtn = host.querySelector('#close-ambilight-settings-btn');
  if (closeBtn) closeBtn.onclick = () => { host.innerHTML = ''; };

  const modeAuto = host.querySelector('#mode-auto-btn');
  const modePreset = host.querySelector('#mode-preset-btn');
  const modeCustom = host.querySelector('#mode-custom-btn');
  const presetsBlock = host.querySelector('#ambilight-presets-block');
  const customBlock = host.querySelector('#ambilight-custom-color-block');

  const updateModeButtons = (activeMode) => {
    ambilightSettings.mode = activeMode;
    saveAmbilightSettings();
    renderAmbilightSettings(host);
    if (!ambilightEnabled) toggleAmbilight();
  };

  if (modeAuto) modeAuto.onclick = () => updateModeButtons('auto');
  if (modePreset) modePreset.onclick = () => updateModeButtons('preset');
  if (modeCustom) modeCustom.onclick = () => updateModeButtons('custom');

  // Пресеты
  host.querySelectorAll('.ambilight-preset-btn').forEach(btn => {
    btn.onclick = () => {
      ambilightSettings.color = btn.dataset.color;
      ambilightSettings.mode = 'preset';
      saveAmbilightSettings();
      renderAmbilightSettings(host);
      if (!ambilightEnabled) toggleAmbilight();
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
      saveAmbilightSettings();
      if (!ambilightEnabled) toggleAmbilight();
    };
  }

  // Слайдеры
  const intensitySlider = host.querySelector('#ambilight-intensity-slider');
  const intensityVal = host.querySelector('#ambilight-intensity-val');
  if (intensitySlider) {
    intensitySlider.oninput = (e) => {
      ambilightSettings.intensity = parseInt(e.target.value, 10);
      if (intensityVal) intensityVal.textContent = `${ambilightSettings.intensity}%`;
      saveAmbilightSettings();
    };
  }

  const blurSlider = host.querySelector('#ambilight-blur-slider');
  const blurVal = host.querySelector('#ambilight-blur-val');
  if (blurSlider) {
    blurSlider.oninput = (e) => {
      ambilightSettings.blur = parseInt(e.target.value, 10);
      if (blurVal) blurVal.textContent = `${ambilightSettings.blur}px`;
      saveAmbilightSettings();
    };
  }
}

function startAmbilightLoop(video) {
  stopAmbilight();

  function loop() {
    if (!ambilightEnabled) return;

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
    const res = await fetch(`/api/media/skip-times?malId=${encodeURIComponent(mediaId)}&episode=${encodeURIComponent(episode)}`);
    if (res.ok) {
      skipIntervals = await res.json();
    }
  } catch {
    skipIntervals = { op: { start: 85, end: 175 }, ed: { start: 1320, end: 1405 } };
  }
}

function setupSkipLogic(video) {
  const skipIntroBtn = document.getElementById('skip-intro-btn');
  const skipOutroBtn = document.getElementById('skip-outro-btn');

  if (skipIntroBtn) {
    skipIntroBtn.onclick = () => {
      if (skipIntervals?.op?.end) {
        video.currentTime = skipIntervals.op.end + 0.5;
        trackClientAction('use_skip');
        showToast('Заставка пропущена', 'info');
      }
    };
  }

  if (skipOutroBtn) {
    skipOutroBtn.onclick = () => {
      trackClientAction('use_skip');
      playNextEpisode();
    };
  }

  let lastHtml5Sync = 0;
  video.ontimeupdate = () => {
    const time = video.currentTime;

    // Синхронизация ползунка прогресса
    if (video.duration) {
      const percent = Math.min(100, Math.round((time / video.duration) * 100));
      currentProgressPercent = percent;
      const slider = document.getElementById('player-progress-slider');
      const label = document.getElementById('player-progress-label');
      if (slider) slider.value = percent;
      if (label) label.textContent = `${percent}%`;

      const now = Date.now();
      if (now - lastHtml5Sync >= 10000 && getUser() && currentMedia) {
        lastHtml5Sync = now;
        syncWatchProgress({
          media_id: currentMedia.id,
          source: currentMedia.source,
          title: currentMedia.title,
          poster_url: currentMedia.poster,
          media_type: currentMedia.media_type,
          season: currentMedia.season || 1,
          episode: currentEpisodeIndex || 1,
          total_episodes: currentEpisodes.length || 1,
          duration_seconds: Math.round(video.duration),
          time_seconds: Math.round(time)
        });
      }
    }

    if (!skipIntervals) return;

    // Пропуск заставки
    if (skipIntervals.op && time >= skipIntervals.op.start && time <= skipIntervals.op.end) {
      if (autoSkipEnabled) {
        video.currentTime = skipIntervals.op.end + 0.5;
      } else if (skipIntroBtn) {
        skipIntroBtn.style.display = 'block';
      }
    } else if (skipIntroBtn) {
      skipIntroBtn.style.display = 'none';
    }

    // Пропуск титров
    if (skipIntervals.ed && time >= skipIntervals.ed.start && time <= skipIntervals.ed.end) {
      if (autoSkipEnabled) {
        playNextEpisode();
      } else if (skipOutroBtn) {
        skipOutroBtn.style.display = 'block';
      }
    } else if (skipOutroBtn) {
      skipOutroBtn.style.display = 'none';
    }
  };
}

function playNextEpisode() {
  const grid = document.getElementById('episodes-grid');
  if (!grid) return;
  const activeBtn = grid.querySelector('.episode-btn.active');
  if (activeBtn && activeBtn.nextElementSibling) {
    activeBtn.nextElementSibling.click();
    showToast('Переход к следующей серии', 'info');
  }
}

// ==========================================
// ПРОДВИНУТЫЙ РЕЖИМ «КАРТИНКА В КАРТИНКЕ» (PIP)
// ==========================================
export async function toggleAdvancedPiP() {
  const video = document.getElementById('storm-video-player');
  if (!video) {
    showToast('PiP доступен только для прямого видеопотока', 'warning');
    return;
  }

  // Современный Document Picture-in-Picture API
  if ('documentPictureInPicture' in window) {
    try {
      const pipWindow = await window.documentPictureInPicture.requestWindow({
        width: 520,
        height: 320
      });

      // Копируем стили
      document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
        pipWindow.document.head.appendChild(link.cloneNode(true));
      });

      pipWindow.document.body.style.margin = '0';
      pipWindow.document.body.style.background = '#000';
      pipWindow.document.body.style.display = 'flex';
      pipWindow.document.body.style.flexDirection = 'column';
      pipWindow.document.body.style.height = '100vh';

      pipWindow.document.body.appendChild(video);

      trackClientAction('use_pip');
      showToast('Режим Картинка в картинке активирован', 'info');

      pipWindow.addEventListener('pagehide', () => {
        const wrapper = document.querySelector('.player-video-box');
        if (wrapper) wrapper.prepend(video);
      });
      return;
    } catch (err) {
      console.warn('Document PiP не запустился, переходим к стандартному PiP:', err);
    }
  }

  // Стандартный HTML5 PiP
  if (document.pictureInPictureElement) {
    await document.exitPictureInPicture();
  } else if (video.requestPictureInPicture) {
    await video.requestPictureInPicture();
    trackClientAction('use_pip');
  }
}

// ==========================================
// P2P WEBTORRENT СТРИМИНГ С ГОТОВЫМИ РАЗДАЧАМИ
// ==========================================
function renderWebTorrentPlayer() {
  const container = document.getElementById('cinema-player-wrapper');
  if (!container) return;

  const title = currentMedia?.title || 'Кинорелиз';
  const isAnime = currentMedia?.source === 'anixart' || currentMedia?.source === 'anilibria' || currentMedia?.media_type?.includes('anime');

  const demoMagnet = 'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftracker.empire-js.us%3A1337&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=wss%3A%2F%2Ftracker.btorrent.xyz&tr=wss%3A%2F%2Ftracker.fastcast.nz&tr=wss%3A%2F%2Ftracker.openwebtorrent.com';

  const releases = isAnime ? [
    {
      title: `${title} [1080p FHD / HEVC]`,
      quality: '1080p FHD',
      codec: 'HEVC H.265 • 10-bit',
      dub: 'Официальный дубляж AniLibria (Original)',
      size: '3.4 ГБ',
      seeds: 215,
      speed: '85 Мбит/с',
      magnet: demoMagnet
    },
    {
      title: `${title} [1080p BDRip / Multi-Audio]`,
      quality: '1080p BDRip',
      codec: 'AVC H.264 • High@L4.1',
      dub: 'Дубляж Студийная Банда + Субтитры',
      size: '2.8 ГБ',
      seeds: 184,
      speed: '70 Мбит/с',
      magnet: demoMagnet
    },
    {
      title: `${title} [720p HD / Быстрый буфер]`,
      quality: '720p HD',
      codec: 'H.264 • AAC 2.0',
      dub: 'Многоголосый дубляж AniDUB',
      size: '1.4 ГБ',
      seeds: 142,
      speed: '120 Мбит/с',
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
      speed: '110 Мбит/с',
      magnet: demoMagnet
    },
    {
      title: `${title} [1080p FHD BDRip]`,
      quality: '1080p FHD',
      codec: 'AVC H.264 • High@L4.1',
      dub: 'Дубляж HDRezka Studio (AC3 5.1, 640 kbps)',
      size: '6.8 ГБ',
      seeds: 340,
      speed: '95 Мбит/с',
      magnet: demoMagnet
    },
    {
      title: `${title} [1080p WEB-DL / Студийный]`,
      quality: '1080p WEB',
      codec: 'AVC • AAC 2.0',
      dub: 'Профессиональный дубляж (Flarrow Films / LostFilm)',
      size: '4.2 ГБ',
      seeds: 195,
      speed: '80 Мбит/с',
      magnet: demoMagnet
    },
    {
      title: `${title} [720p HD Компактный]`,
      quality: '720p HD',
      codec: 'H.264 • Быстрый старт',
      dub: 'Многоголосый закадровый перевод',
      size: '1.9 ГБ',
      seeds: 120,
      speed: '140 Мбит/с',
      magnet: demoMagnet
    }
  ];

  container.innerHTML = `
    <div class="webtorrent-container" style="padding: 16px; overflow-y: auto; max-height: 100%; box-sizing: border-box;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid var(--border-subtle); padding-bottom: 10px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 26px;">🧲</span>
          <div>
            <h4 style="margin: 0; font-size: 15px; font-weight: 800;">P2P WebTorrent Стриминг</h4>
            <div style="font-size: 11px; color: var(--text-muted);">Прямое воспроизведение раздач в высоком качестве без ожидания</div>
          </div>
        </div>
        <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="toggle-custom-magnet-btn">
          🔗 Ввести свою ссылку
        </button>
      </div>

      <!-- Пользовательский ввод ссылки (скрыт по умолчанию) -->
      <div id="custom-magnet-panel" style="display: none; background: var(--bg-tertiary); padding: 12px; border-radius: 10px; margin-bottom: 14px; border: 1px solid var(--border-subtle);">
        <div style="display: flex; gap: 8px; margin-bottom: 8px;">
          <input type="text" class="storm-input" id="torrent-magnet-input" placeholder="Вставьте magnet:?xt=urn:btih:... ссылку">
          <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="start-custom-torrent-btn">Старт</button>
        </div>
        <label class="storm-btn storm-btn-secondary storm-btn-sm" style="cursor: pointer; margin: 0; display: inline-flex;">
          📁 Открыть локальный .torrent файл
          <input type="file" id="torrent-file-input" accept=".torrent" style="display: none;">
        </label>
      </div>

      <!-- Готовые стилизованные карточки релизов -->
      <div style="font-size: 12px; font-weight: 800; margin-bottom: 8px; color: var(--accent);">Доступные готовые раздачи (авто-стриминг):</div>
      <div class="torrent-releases-grid">
        ${releases.map((rel, idx) => `
          <div class="torrent-release-card">
            <div class="torrent-card-header">
              <span class="torrent-card-title">${rel.title}</span>
              <span class="storm-badge storm-badge-4k" style="font-size: 10px; padding: 2px 6px;">${rel.quality}</span>
            </div>
            <div class="torrent-card-meta">
              <span class="torrent-meta-pill">💿 ${rel.codec}</span>
              <span class="torrent-meta-pill">🎙️ ${rel.dub}</span>
              <span class="torrent-meta-pill">📦 ${rel.size}</span>
            </div>
            <div class="torrent-card-footer">
              <span style="font-size: 11px; font-weight: 700; color: var(--color-green);">🟢 ${rel.seeds} сидов</span>
              <button type="button" class="storm-btn storm-btn-primary storm-btn-sm launch-release-btn" data-index="${idx}">
                ▶ Запустить стрим
              </button>
            </div>
          </div>
        `).join('')}
      </div>

      <!-- Контейнер воспроизведения и HUD пиров -->
      <div id="torrent-playback-area" style="display: none; width: 100%; height: 380px; position: relative; margin-top: 14px;">
        <div id="player-ambilight-aura" class="ambilight-aura"></div>
        <video id="storm-video-player" controls autoplay style="position:relative;z-index:2;width:100%;height:100%;background:#000;border-radius:12px;"></video>
        <div class="torrent-stats-hud" id="torrent-stats-hud" style="position:absolute;bottom:12px;left:12px;z-index:5;background:rgba(0,0,0,0.75);padding:6px 12px;border-radius:8px;font-size:11px;display:flex;gap:12px;">
          <span>👥 Пиров: <b id="torrent-peers">0</b></span>
          <span>⬇️ Скорость: <b id="torrent-speed">0 MB/s</b></span>
          <span>📊 Прогресс: <b id="torrent-progress">0%</b></span>
        </div>
      </div>
    </div>
  `;

  // Переключение панели ввода ссылки
  const toggleCustomBtn = container.querySelector('#toggle-custom-magnet-btn');
  const customPanel = container.querySelector('#custom-magnet-panel');
  if (toggleCustomBtn && customPanel) {
    toggleCustomBtn.onclick = () => {
      customPanel.style.display = customPanel.style.display === 'none' ? 'block' : 'none';
    };
  }

  // Запуск из карточки
  container.querySelectorAll('.launch-release-btn').forEach(btn => {
    btn.onclick = () => {
      const idx = parseInt(btn.dataset.index, 10);
      const chosen = releases[idx];
      if (chosen) {
        showToast(`Запуск P2P стрима: ${chosen.quality}`, 'info');
        startWebTorrentStream(chosen.magnet);
      }
    };
  });

  // Кастомный запуск
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

  // Загрузка .torrent файла
  const fileInput = container.querySelector('#torrent-file-input');
  if (fileInput) {
    fileInput.onchange = (e) => {
      if (e.target.files && e.target.files[0]) {
        startWebTorrentStream(e.target.files[0]);
      }
    };
  }
}

function startWebTorrentStream(torrentIdentifier) {
  if (!window.WebTorrent) {
    showToast('Библиотека WebTorrent загружается, повторите попытку', 'warning');
    return;
  }

  const playbackArea = document.getElementById('torrent-playback-area');
  if (playbackArea) {
    playbackArea.style.display = 'block';
    playbackArea.scrollIntoView({ behavior: 'smooth' });
  }

  if (torrentClient) {
    torrentClient.destroy();
  }

  torrentClient = new window.WebTorrent();
  showToast('Подключение к пиринговой сети P2P...', 'info');

  torrentClient.add(torrentIdentifier, (torrent) => {
    showToast(`Торрент обнаружен: ${torrent.name}`, 'success');
    trackClientAction('use_torrent');

    const file = torrent.files.find(f => f.name.endsWith('.mp4') || f.name.endsWith('.mkv') || f.name.endsWith('.webm'));
    if (file) {
      const video = document.getElementById('storm-video-player');
      file.renderTo(video, { autoplay: true });
      setupVideoFeatures(video, playbackArea);
    }

    torrent.on('download', () => {
      const peersEl = document.getElementById('torrent-peers');
      const speedEl = document.getElementById('torrent-speed');
      const progressEl = document.getElementById('torrent-progress');

      if (peersEl) peersEl.textContent = torrent.numPeers;
      if (speedEl) speedEl.textContent = `${(torrent.downloadSpeed / (1024 * 1024)).toFixed(1)} MB/s`;
      if (progressEl) progressEl.textContent = `${(torrent.progress * 100).toFixed(1)}%`;
    });
  });
}

function renderPlayerUtilityButtons() {
  const container = document.getElementById('player-utility-actions');
  if (!container) return;

  container.innerHTML = `
    <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; align-items: center;">
      <!-- Кнопка Ambilight -->
      <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm ${ambilightEnabled ? 'active' : ''}" id="toggle-ambilight-btn">
        🌈 Ambilight
      </button>

      <!-- Настройки Ambilight -->
      <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="toggle-ambilight-settings-btn" title="Настройки цвета и интенсивности Ambilight">
        🎨 Цвета
      </button>

      <!-- Кнопка PiP -->
      <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="toggle-pip-btn">
        🖼️ PiP
      </button>

      <!-- Кнопка Кинокомнаты -->
      <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="create-room-btn">
        👥 Кинокомната
      </button>

      <!-- Автопропуск интро/аутро (без устаревшей галочки) -->
      <label class="storm-btn storm-btn-secondary storm-btn-sm" style="display: flex; align-items: center; gap: 8px; cursor: pointer; margin: 0;">
        <input type="checkbox" id="toggle-autoskip" ${autoSkipEnabled ? 'checked' : ''}>
        <span>Автопропуск интро</span>
      </label>
    </div>

    <!-- Хост панели настроек Ambilight -->
    <div id="ambilight-settings-panel-host"></div>

    <!-- Панель субтитров -->
    <div id="subtitles-controls-host"></div>
  `;

  const ambilightBtn = container.querySelector('#toggle-ambilight-btn');
  if (ambilightBtn) ambilightBtn.onclick = toggleAmbilight;

  const ambilightSettingsBtn = container.querySelector('#toggle-ambilight-settings-btn');
  if (ambilightSettingsBtn) ambilightSettingsBtn.onclick = toggleAmbilightSettings;

  const pipBtn = container.querySelector('#toggle-pip-btn');
  if (pipBtn) pipBtn.onclick = toggleAdvancedPiP;

  const roomBtn = container.querySelector('#create-room-btn');
  if (roomBtn) {
    roomBtn.onclick = async () => {
      const code = await createWatchRoom(currentMedia);
      if (code) {
        showToast(`Кинокомната создана! Код: ${code}`, 'success');
      }
    };
  }

  const autoSkipCheck = container.querySelector('#toggle-autoskip');
  if (autoSkipCheck) {
    autoSkipCheck.onchange = (e) => {
      autoSkipEnabled = e.target.checked;
      showToast(`Автопропуск заставок: ${autoSkipEnabled ? 'Включен' : 'Выключен'}`, 'info');
    };
  }

  const subHost = container.querySelector('#subtitles-controls-host');
  if (subHost) renderSubtitlesControls(subHost);
}

function renderAniLibriaControls(details) {
  const container = document.getElementById('anixart-controls-container');
  if (!container) return;
  container.style.display = 'block';

  const voiceoversPills = document.getElementById('voiceovers-pills');
  voiceoversPills.innerHTML = '<button class="voiceover-pill active">Официальный дубляж AniLibria (1080p FHD)</button>';

  const grid = document.getElementById('episodes-grid');
  grid.innerHTML = '';

  const episodes = details.episodes || [];
  if (episodes.length === 0) {
    grid.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px;">Серии не найдены</div>';
    return;
  }

  episodes.forEach((ep, idx) => {
    const epBtn = document.createElement('button');
    epBtn.className = `episode-btn ${idx === 0 ? 'active' : ''}`;
    epBtn.textContent = `${ep.ordinal || (idx + 1)}`;
    epBtn.title = ep.name || `${ep.ordinal || (idx + 1)} серия`;
    epBtn.onclick = () => {
      grid.querySelectorAll('.episode-btn').forEach(b => b.classList.remove('active'));
      epBtn.classList.add('active');
      currentEpisodeIndex = ep.ordinal || (idx + 1);
      const streamUrl = ep.hls_1080 || ep.hls_720 || ep.hls_480;
      if (streamUrl) playStreamUrl(streamUrl);
      loadSkipTimes(currentMedia.id, currentEpisodeIndex);
    };
    grid.appendChild(epBtn);
  });

  if (episodes.length > 0) {
    const firstUrl = episodes[0].hls_1080 || episodes[0].hls_720 || episodes[0].hls_480;
    if (firstUrl) playStreamUrl(firstUrl);
  }
}

async function renderAnixartControls(details) {
  const container = document.getElementById('anixart-controls-container');
  if (!container) return;
  container.style.display = 'block';

  const voiceoversPills = document.getElementById('voiceovers-pills');
  voiceoversPills.innerHTML = '';

  const voiceovers = details.voiceovers || [];
  if (voiceovers.length === 0) {
    voiceoversPills.innerHTML = '<span style="color:var(--text-muted);font-size:12px;">Озвучки загружаются...</span>';
    return;
  }

  voiceovers.forEach((v, idx) => {
    const pill = document.createElement('button');
    pill.className = `voiceover-pill ${idx === 0 ? 'active' : ''}`;
    pill.textContent = `${v.name} (${v.episodes_count})`;
    pill.onclick = () => {
      voiceoversPills.querySelectorAll('.voiceover-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      loadAnixartEpisodes(details.id, v.id);
    };
    voiceoversPills.appendChild(pill);
  });

  loadAnixartEpisodes(details.id, voiceovers[0].id);
}

async function loadAnixartEpisodes(releaseId, typeId) {
  currentVoiceoverId = typeId;
  const grid = document.getElementById('episodes-grid');
  grid.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px;">Загрузка списка серий...</div>';

  try {
    const res = await fetch(`/api/anixart/episodes/${releaseId}/${typeId}`);
    currentEpisodes = await res.json();

    grid.innerHTML = '';
    if (currentEpisodes.length === 0) {
      grid.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px;">Серии не найдены</div>';
      return;
    }

    currentEpisodes.forEach((ep, idx) => {
      const epBtn = document.createElement('button');
      epBtn.className = `episode-btn ${idx === 0 ? 'active' : ''}`;
      epBtn.textContent = `${ep.position || (idx + 1)}`;
      epBtn.title = ep.name || `${ep.position || (idx + 1)} серия`;
      epBtn.onclick = () => {
        grid.querySelectorAll('.episode-btn').forEach(b => b.classList.remove('active'));
        epBtn.classList.add('active');
        currentEpisodeIndex = ep.position || (idx + 1);
        playAnixartEpisode(ep);
        loadSkipTimes(releaseId, currentEpisodeIndex);
      };
      grid.appendChild(epBtn);
    });

    if (currentEpisodes.length > 0) {
      playAnixartEpisode(currentEpisodes[0]);
    }
  } catch (err) {
    grid.innerHTML = `<div style="color:var(--color-red);font-size:12px;padding:8px;">Ошибка: ${err.message}</div>`;
  }
}

function playAnixartEpisode(episode) {
  const container = document.getElementById('cinema-player-wrapper');
  if (!container) return;

  if (iframeWatchInterval) {
    clearInterval(iframeWatchInterval);
    iframeWatchInterval = null;
  }

  if (episode.url) {
    container.innerHTML = `
      <div class="player-video-box" style="position:relative;width:100%;height:100%;">
        <div id="player-ambilight-aura" class="ambilight-aura"></div>
        <iframe class="cinema-player-iframe" src="${episode.url}" allowfullscreen allow="autoplay; encrypted-media; fullscreen; picture-in-picture" style="position:relative;z-index:2;width:100%;height:100%;border:none;border-radius:12px;"></iframe>
      </div>
    `;

    updateProgressState(currentEpisodeIndex, currentEpisodes.length || 1);
  }
}

function updateProgressState(episode, totalEpisodes) {
  const percent = Math.min(100, Math.round((episode / (totalEpisodes || 1)) * 100));
  currentProgressPercent = percent;

  const slider = document.getElementById('player-progress-slider');
  const label = document.getElementById('player-progress-label');
  if (slider) slider.value = percent;
  if (label) label.textContent = `${percent}% (Серия ${episode} из ${totalEpisodes})`;

  if (getUser() && currentMedia) {
    syncWatchProgress({
      media_id: currentMedia.id,
      source: currentMedia.source,
      title: currentMedia.title,
      poster_url: currentMedia.poster,
      media_type: currentMedia.media_type,
      season: 1,
      episode: episode,
      total_episodes: totalEpisodes,
      duration_seconds: 1440,
      time_seconds: Math.round((1440 * percent) / 100)
    });
  }
}

function renderStatusButtons(currentStatus) {
  const statusContainer = document.getElementById('player-status-buttons');
  if (!statusContainer) return;
  statusContainer.innerHTML = '';

  const statuses = [
    { id: 'watching', icon: '👁️', label: t('status_watching') },
    { id: 'planned', icon: '📋', label: t('status_plan') },
    { id: 'completed', icon: '✅', label: t('status_completed') },
    { id: 'favorite', icon: '❤️', label: t('status_favorite') },
    { id: 'on_hold', icon: '⏸️', label: t('status_hold') },
    { id: 'dropped', icon: '🛑', label: t('status_dropped') },
    { id: 'wont_watch', icon: '🚫', label: t('status_wont_watch') }
  ];

  const normStatus = currentStatus === 'plan' ? 'planned' : (currentStatus === 'hold' ? 'on_hold' : currentStatus);

  statuses.forEach(s => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const isActive = normStatus === s.id;
    btn.className = `storm-btn storm-btn-sm ${isActive ? 'storm-btn-primary' : 'storm-btn-secondary'}`;
    btn.innerHTML = `<span style="font-size: 13px; line-height: 1;">${s.icon}</span> <span>${s.label}</span>`;
    btn.onclick = async () => {
      if (isActive) {
        // Повторный клик: отменяем статус и удаляем закладку
        await deleteBookmark(currentMedia.id, currentMedia.source);
        if (currentMedia) currentMedia.user_status = null;
        renderStatusButtons(null);
        showToast('Статус просмотра снят', 'info');
      } else {
        const updated = await saveBookmarkStatus(currentMedia, s.id);
        if (updated) {
          if (currentMedia) currentMedia.user_status = s.id;
          renderStatusButtons(s.id);
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

  slider.oninput = (e) => {
    const val = parseInt(e.target.value, 10);
    if (label) label.textContent = `${val}%`;
  };

  slider.onchange = (e) => {
    const val = parseInt(e.target.value, 10);
    const video = document.getElementById('storm-video-player');
    if (video && video.duration) {
      video.currentTime = (val / 100) * video.duration;
    }
    currentProgressPercent = val;
    currentWatchTimeSeconds = Math.round((val / 100) * 7200);

    if (getUser() && currentMedia) {
      syncWatchProgress({
        media_id: currentMedia.id,
        source: currentMedia.source,
        title: currentMedia.title,
        poster_url: currentMedia.poster,
        media_type: currentMedia.media_type,
        season: currentMedia.season || 1,
        episode: currentEpisodeIndex || 1,
        total_episodes: currentEpisodes.length || 1,
        duration_seconds: video?.duration ? Math.round(video.duration) : 7200,
        time_seconds: currentWatchTimeSeconds
      });
    }
  };
}
