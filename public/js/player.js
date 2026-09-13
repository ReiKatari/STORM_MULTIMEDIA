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
import { initSmartSkip, renderChaptersOnTrack } from './smart-skip.js';
import { sendSmartLightsFrame, renderSmartLightsSettings } from './smart-lights.js';
import { toggleWhisperAiSubtitles } from './whisper-subtitles.js';
import { saveMediaForOffline } from './offline-storage.js';
import { renderTorrServerSettings } from './torrserver-client.js';

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
let autoSkipEnabled = false;

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
    animevost: 'Animevost'
  };
  return map[item?.source] || (item?.source || 'STORM').toUpperCase();
}

export async function openPlayerModal(mediaItem, options = {}) {
  currentMedia = mediaItem;
  const modal = document.getElementById('cinema-modal');
  if (!modal) return;

  const cleanTitle = cleanVideoTitle(mediaItem.title);

  // Проверяем ночной просмотр (между 02:00 и 05:00)
  const currentHour = new Date().getHours();
  if (currentHour >= 2 && currentHour < 5) {
    trackClientAction('night_watch');
  }

  // Сброс состояния плеера
  const iframeContainer = document.getElementById('cinema-player-wrapper');
  iframeContainer.innerHTML = '<div style="display:flex;height:100%;align-items:center;justify-content:center;color:var(--text-muted);">Загрузка видеоплеера...</div>';

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

  // Обновляем URL для глубокого связывания (Deep Linking)
  updatePlayerUrl(mediaItem, options.initialSeason, options.initialEpisode);

  // Открываем модальное окно
  modal.classList.add('is-open');

  // Немедленно инициализируем селекторы и кнопки, чтобы они были интерактивны СРАЗУ
  renderStatusButtons(mediaItem.user_status);
  renderCustomListsSelector();
  renderPlayerUtilityButtons();

  // Моментально отображаем плашку активного источника без зависания «Загрузка плееров...»
  currentActivePlayer = {
    badge: (mediaItem.source || 'ПЛЕЕР').toUpperCase(),
    name: `${cleanTitle || 'Основной поток'} (${getSourceName(mediaItem)})`,
    quality: '1080p FHD',
    status_label: '🟢 Онлайн'
  };
  updatePlayerTriggerInfo(currentActivePlayer);

  try {
    // Получаем детальные данные с сервера с таймаутом 5000мс
    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), 5000);

    const itemUrl = `/api/media/item?id=${encodeURIComponent(mediaItem.id)}&source=${mediaItem.source}&url=${encodeURIComponent(mediaItem.link || '')}&title=${encodeURIComponent(cleanTitle)}&year=${encodeURIComponent(mediaItem.year || '')}&poster=${encodeURIComponent(mediaItem.poster || '')}`;
    
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
            url: `https://kodikplayer.com/find-player?title=${encodeURIComponent(cleanTitle)}`,
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

    // Отображаем подробную информацию в боковой колонке (даты, рейтинги, режиссеры, актеры)
    renderDetailedMediaInfo(currentMedia);

    // Отображаем селектор сезонов и серий для сериалов
    renderSeriesSeasons(currentMedia, options.initialSeason, options.initialEpisode);

    // Добавляем P2P WebTorrent в список плееров (для вышедших релизов)
    if (!currentMedia.is_upcoming) {
      currentPlayers.push({
        id: 'webtorrent',
        name: 'P2P WebTorrent (Торрент-стриминг)',
        url: 'webtorrent://direct',
        badge: 'P2P 4K',
        quality: '4K UHD / 1080p',
        status_label: '🟢 P2P Сеть',
        audio_info: 'Многоголосый дубляж'
      });
    }

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
        // Для ожидаемых фильмов всегда по умолчанию выбираем официальный трейлер
        const defaultPlayer = currentMedia.is_upcoming
          ? (currentPlayers.find(p => p.is_trailer || p.id === 'official_trailer') || currentPlayers[0])
          : (options.initialPlayer ? currentPlayers.find(p => p.id === options.initialPlayer) || currentPlayers[0] : currentPlayers[0]);
        selectPlayer(defaultPlayer);
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
    clearPlayerUrl();

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

    const personModal = document.getElementById('person-modal');
    if (personModal) personModal.classList.remove('is-open');
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

  const validPlayers = (players || []).filter(p => {
    if (!p || !p.url) return false;
    const lowerName = (p.name || '').toLowerCase();
    const lowerBadge = (p.badge || '').toLowerCase();
    const lowerId = (p.id || '').toLowerCase();
    if (lowerName.includes('трейлер') || lowerName.includes('trailer') ||
        lowerBadge.includes('трейлер') || lowerBadge.includes('trailer') ||
        lowerId.includes('trailer')) {
      if (currentMedia?.is_upcoming || !players.some(op => op.id !== 'official_trailer' && op.url && !op.url.includes('youtube'))) {
        return true;
      }
      return false;
    }
    if (p.url.includes('kinobox.tv') || p.url.includes('delivembd.ws')) return false;
    return true;
  });

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
    const recBadge = p.is_recommended ? `<span class="storm-badge" style="background:linear-gradient(135deg,#f59e0b,#ef4444);color:#fff;font-weight:800;padding:2px 6px;border-radius:4px;font-size:10px;margin-left:auto;">🔥 Рекомендуемый</span>` : '';
    return `
      <div class="player-dropdown-item ${isAct ? 'active' : ''}" data-idx="${idx}">
        <div class="player-item-header">
          <span class="player-source-badge">${p.badge || 'ПЛЕЕР'}</span>
          <span class="player-item-name">${p.name}</span>
          ${recBadge}
        </div>
        <div class="player-item-details">
          <span class="player-item-quality">${p.quality || '1080p FHD'}</span>
          <span class="player-item-audio">${p.audio_info || 'Оригинал / дубляж'}</span>
          <span class="player-item-status">${p.status_label || '🟢 Онлайн'}</span>
        </div>
      </div>
    `;
  }).join('');

  // Обновляем плашку выбранного плеера
  updatePlayerTriggerInfo(defaultPlayer);
  if (!currentActivePlayer) {
    selectPlayer(defaultPlayer);
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
        selectPlayer(player);
      }
    };
  });

  // Открытие / закрытие выпадающего списка
  if (trigger) {
    trigger.onclick = (e) => {
      e.stopPropagation();
      const isOpen = menu.style.display === 'block';
      menu.style.display = isOpen ? 'none' : 'block';
      dropdown.classList.toggle('is-open', !isOpen);
    };
  }

  // Закрытие при клике вне селектора
  if (!dropdown.dataset.hasOutsideListener) {
    dropdown.dataset.hasOutsideListener = 'true';
    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target)) {
        menu.style.display = 'none';
        dropdown.classList.remove('is-open');
      }
    });
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
}

function selectPlayer(player) {
  currentActivePlayer = player;
  const container = document.getElementById('cinema-player-wrapper');
  if (!container) return;

  if (player.url === 'webtorrent://direct') {
    renderWebTorrentPlayer();
    return;
  }

  // Защита не вышедших фильмов от показа случайных чужих видео
  if (player.is_upcoming || !player.url) {
    if (player.upcoming_notice || currentMedia?.is_upcoming) {
      const notice = player.upcoming_notice || `Релиз «${cleanVideoTitle(currentMedia?.title || 'Фильм')}» находится в производстве. Мировая премьера ожидается в ${currentMedia?.year || 'скоро'}.`;
      const trailer = currentPlayers.find(p => p.is_trailer || p.id === 'official_trailer');
      container.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;text-align:center;padding:30px;background:rgba(10,12,18,0.85);border-radius:12px;gap:14px;">
          <div style="font-size:42px;">🎬</div>
          <div style="font-size:18px;font-weight:800;color:var(--text-primary);">Премьера еще не состоялась</div>
          <div style="max-width:560px;font-size:13px;line-height:1.6;color:var(--text-secondary);">${notice}</div>
          ${trailer ? `
            <button type="button" class="storm-btn storm-btn-primary" id="switch-to-trailer-btn" style="margin-top:8px;">
              ▶ Смотреть официальный 4K Трейлер
            </button>
          ` : ''}
        </div>
      `;
      const switchBtn = container.querySelector('#switch-to-trailer-btn');
      if (switchBtn && trailer) {
        switchBtn.onclick = () => {
          selectPlayer(trailer);
          updatePlayerTriggerInfo(trailer);
        };
      }
      return;
    }

    container.innerHTML = '<div style="display:flex;height:100%;align-items:center;justify-content:center;color:var(--text-muted);">Ссылка на данный плеер временно недоступна</div>';
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

  if (ambilightEnabled) {
    startAmbilightLoop(null);
  }

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

  // 4. Логика пропуска опенингов и эндингов (Smart Skip)
  initSmartSkip(video);

  // 5. Ночной режим звука (Web Audio компрессор)
  applyNightModeAudio(video);

  // 6. X-Ray режим на паузе
  setupXRayMode(video, wrapper);

  // 7. Покадровая навигация (Thumbnail Scrubbing)
  setupThumbnailScrubbing(video);

  // 8. Автоматический динамический прогресс просмотра
  let lastSyncTime = 0;
  video.addEventListener('timeupdate', () => {
    if (video.duration && !isNaN(video.duration)) {
      const percent = Math.min(100, Math.round((video.currentTime / video.duration) * 100));
      currentProgressPercent = percent;
      currentWatchTimeSeconds = Math.round(video.currentTime);
      const slider = document.getElementById('player-progress-slider');
      const label = document.getElementById('player-progress-label');
      if (slider) slider.value = percent;
      if (label) label.textContent = `${percent}%`;

      const now = Date.now();
      if (now - lastSyncTime >= 15000 && getUser() && currentMedia) {
        lastSyncTime = now;
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
          time_seconds: currentWatchTimeSeconds
        });
      }
    }
  });
}

// ==========================================
// НОЧНОЙ РЕЖИМ ЗВУКА (NIGHT MODE AUDIO)
// ==========================================
export function toggleNightModeAudio(video = document.getElementById('storm-video-player')) {
  nightAudioModeEnabled = !nightAudioModeEnabled;
  localStorage.setItem('storm_night_audio', nightAudioModeEnabled ? 'true' : 'false');
  applyNightModeAudio(video);
  showToast(`🌙 Ночной режим звука: ${nightAudioModeEnabled ? 'Включен (диалоги четче, взрывы мягче)' : 'Выключен (стандартный звук)'}`, 'info');

  const btn = document.getElementById('toggle-night-audio-btn');
  if (btn) btn.classList.toggle('active', nightAudioModeEnabled);
}

export function applyNightModeAudio(video) {
  if (!video) return;
  try {
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      audioCtx = new AudioContext();
    }
    if (!audioSourceNode && audioCtx) {
      audioSourceNode = audioCtx.createMediaElementSource(video);
    }
    if (!compressorNode && audioCtx) {
      compressorNode = audioCtx.createDynamicsCompressor();
      compressorNode.threshold.setValueAtTime(-24, audioCtx.currentTime);
      compressorNode.knee.setValueAtTime(30, audioCtx.currentTime);
      compressorNode.ratio.setValueAtTime(12, audioCtx.currentTime);
      compressorNode.attack.setValueAtTime(0.003, audioCtx.currentTime);
      compressorNode.release.setValueAtTime(0.25, audioCtx.currentTime);
    }

    if (audioSourceNode && compressorNode) {
      audioSourceNode.disconnect();
      if (nightAudioModeEnabled) {
        audioSourceNode.connect(compressorNode);
        compressorNode.connect(audioCtx.destination);
      } else {
        audioSourceNode.connect(audioCtx.destination);
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
    }
  } catch (err) {
    // В случае CORS или если источник уже подключен
  }
}

// ==========================================
// X-RAY РЕЖИМ (АКТЕРЫ И САУНДТРЕКИ НА ПАУЗЕ)
// ==========================================
function setupXRayMode(video, wrapper) {
  if (!video || !wrapper) return;

  video.addEventListener('pause', () => {
    if (currentMedia && (currentMedia.cast?.length || currentMedia.directors?.length)) {
      showXRayPanel(wrapper);
    }
  });

  video.addEventListener('play', () => {
    hideXRayPanel(wrapper);
  });
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

  const cast = (currentMedia.cast || []).slice(0, 6);
  const soundtrack = currentMedia.soundtrack || {
    title: 'STORM Main Theme',
    artist: 'Original Cinematic Soundtrack'
  };

  panel.innerHTML = `
    <div class="xray-header">
      <div class="xray-title">
        <span>🔍</span>
        <span>X-Ray: В этой сцене</span>
      </div>
      <div style="font-size: 11px; color: var(--text-muted); display: flex; align-items: center; gap: 8px;">
        <span>🎵 ${soundtrack.title} — ${soundtrack.artist}</span>
        <button type="button" class="storm-btn storm-btn-sm" id="close-xray-btn" style="padding: 2px 6px;">✕</button>
      </div>
    </div>
    <div class="xray-cast-row">
      ${cast.map(c => `
        <div class="xray-actor-card">
          <img src="${c.photo || 'assets/favicon.svg'}" alt="${c.name}" class="xray-actor-img" onerror="this.src='assets/favicon.svg'">
          <div>
            <div class="xray-actor-name">${c.name}</div>
            <div class="xray-actor-role">${c.character || 'Персонаж'}</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  const closeBtn = panel.querySelector('#close-xray-btn');
  if (closeBtn) closeBtn.onclick = () => hideXRayPanel(wrapper);
  panel.style.display = 'block';
  xrayVisible = true;
}

function hideXRayPanel(wrapper) {
  const panel = wrapper.querySelector('#player-xray-panel');
  if (panel) {
    panel.style.display = 'none';
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

      <!-- Секция умного дома (WLED / Hue) -->
      <div id="smart-lights-mount" style="margin-top: 14px; border-top: 1px solid var(--border-subtle); padding-top: 12px;"></div>
    </div>
  `;

  const closeBtn = host.querySelector('#close-ambilight-settings-btn');
  if (closeBtn) closeBtn.onclick = () => { host.innerHTML = ''; };

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
    ambilightEnabled = true;
    const btn = document.getElementById('toggle-ambilight-btn');
    if (btn) btn.classList.add('active');
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
const WEBTORRENT_TRACKERS = [
  'wss://tracker.webtorrent.dev',
  'wss://tracker.files.fm:7073/announce',
  'wss://tracker.openwebtorrent.com'
];

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
        <video id="storm-video-player" controls autoplay playsinline style="position: relative; z-index: 2; width: 100%; height: 100%; max-height: 520px; background: #000; object-fit: contain;"></video>

        <!-- Оверлей загрузки пиров и буферизации -->
        <div id="torrent-loader-overlay" style="position: absolute; inset: 0; z-index: 4; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(8, 10, 15, 0.88); backdrop-filter: blur(8px); gap: 12px; padding: 20px; text-align: center;">
          <div class="storm-spinner" style="width: 44px; height: 44px; border-width: 3px;"></div>
          <div style="font-size: 16px; font-weight: 800; color: var(--text-primary);" id="torrent-loader-title">Подключение к пиринговой сети P2P...</div>
          <div style="font-size: 12px; color: var(--text-muted); max-width: 480px; line-height: 1.5;" id="torrent-loader-subtitle">Поиск сидов в сети WebSockets. Воспроизведение начнется мгновенно по мере буферизации.</div>
          <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="torrent-fallback-cdn-btn" style="margin-top: 8px;">
            ⚡ Переключиться на быстрый онлайн плеер (CDN)
          </button>
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

function startWebTorrentStream(torrentIdentifier) {
  if (!window.WebTorrent) {
    showToast('Библиотека WebTorrent загружается, повторите попытку через секунду', 'warning');
    return;
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
      tracker: {
        announce: WEBTORRENT_TRACKERS
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

function renderPlayerUtilityButtons() {
  const container = document.getElementById('player-utility-actions');
  if (!container) return;

  container.innerHTML = `
    <div class="player-utility-row">
      <!-- Кластер 1: Видео и звук -->
      <div class="player-utility-cluster">
        <span class="player-utility-cluster-label">Видео и звук</span>
        <div class="player-utility-cluster-items">
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm ${ambilightEnabled ? 'active' : ''}" id="toggle-ambilight-btn" title="Фоновая динамическая подсветка">
            🌈 Ambilight
          </button>
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="toggle-ambilight-settings-btn" title="Настройки цвета и интенсивности Ambilight">
            🎨 Цвета
          </button>
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="toggle-pip-btn" title="Картинка в картинке">
            🖼️ PiP
          </button>
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm ${nightAudioModeEnabled ? 'active' : ''}" id="toggle-night-audio-btn" title="Компрессор звука для комфортного просмотра ночью">
            🌙 Ночной звук
          </button>
        </div>
      </div>

      <!-- Кластер 2: Сервисы и ИИ -->
      <div class="player-utility-cluster">
        <span class="player-utility-cluster-label">Сервисы и ИИ</span>
        <div class="player-utility-cluster-items">
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="toggle-whisper-btn" title="Синхронные русские субтитры в реальном времени">
            🎙️ Whisper AI
          </button>
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="toggle-xray-btn" title="Актеры в сцене и саундтрек (X-Ray)">
            🔍 X-Ray
          </button>
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="save-offline-btn" title="Сохранить релиз в память браузера (IndexedDB PWA)">
            💾 Офлайн
          </button>
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="open-torrserver-btn" title="Настройки TorrServer и AceStream">
            🧲 Торренты
          </button>
          <label class="storm-btn storm-btn-secondary storm-btn-sm" style="display: flex; align-items: center; gap: 8px; cursor: pointer; margin: 0;" title="Автоматический пропуск опенингов и титров">
            <input type="checkbox" id="toggle-autoskip" ${autoSkipEnabled ? 'checked' : ''}>
            <span>Автопропуск интро</span>
          </label>
        </div>
      </div>

      <!-- Кластер 3: Совместный просмотр и ссылка -->
      <div class="player-utility-cluster">
        <span class="player-utility-cluster-label">Связь и ссылка</span>
        <div class="player-utility-cluster-items">
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="create-room-btn" title="Синхронный просмотр с друзьями и чатом">
            👥 Кинокомната
          </button>
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="share-media-btn" title="Скопировать прямую ссылку на данный релиз или серию">
            🔗 Поделиться
          </button>
        </div>
      </div>
    </div>

    <!-- Хост панели настроек Ambilight -->
    <div id="ambilight-settings-panel-host"></div>

    <!-- Хост панели торрент-движков -->
    <div id="torrserver-panel-host" style="display: none; margin-bottom: 8px;"></div>

    <!-- Панель субтитров -->
    <div id="subtitles-controls-host"></div>
  `;

  const ambilightBtn = container.querySelector('#toggle-ambilight-btn');
  if (ambilightBtn) ambilightBtn.onclick = toggleAmbilight;

  const ambilightSettingsBtn = container.querySelector('#toggle-ambilight-settings-btn');
  if (ambilightSettingsBtn) ambilightSettingsBtn.onclick = toggleAmbilightSettings;

  const pipBtn = container.querySelector('#toggle-pip-btn');
  if (pipBtn) pipBtn.onclick = toggleAdvancedPiP;

  const nightAudioBtn = container.querySelector('#toggle-night-audio-btn');
  if (nightAudioBtn) {
    nightAudioBtn.onclick = () => toggleNightModeAudio();
  }

  const xrayBtn = container.querySelector('#toggle-xray-btn');
  if (xrayBtn) {
    xrayBtn.onclick = () => toggleXRayManual();
  }

  const whisperBtn = container.querySelector('#toggle-whisper-btn');
  if (whisperBtn) {
    whisperBtn.onclick = () => toggleWhisperAiSubtitles();
  }

  const offlineBtn = container.querySelector('#save-offline-btn');
  if (offlineBtn) {
    offlineBtn.onclick = () => {
      if (currentMedia) saveMediaForOffline(currentMedia);
    };
  }

  const torrBtn = container.querySelector('#open-torrserver-btn');
  const torrHost = container.querySelector('#torrserver-panel-host');
  if (torrBtn && torrHost) {
    torrBtn.onclick = () => {
      if (torrHost.style.display === 'none') {
        torrHost.style.display = 'block';
        renderTorrServerSettings(torrHost);
      } else {
        torrHost.style.display = 'none';
      }
    };
  }

  const roomBtn = container.querySelector('#create-room-btn');
  if (roomBtn) {
    roomBtn.onclick = async () => {
      const code = await createWatchRoom(currentMedia);
      if (code) {
        showToast(`Кинокомната создана! Код: ${code}`, 'success');
      }
    };
  }

  const shareBtn = container.querySelector('#share-media-btn');
  if (shareBtn) {
    shareBtn.onclick = () => copyMediaShareLink();
  }

  const autoSkipCheck = container.querySelector('#toggle-autoskip');
  if (autoSkipCheck) {
    autoSkipCheck.onchange = (e) => {
      autoSkipEnabled = e.target.checked;
      localStorage.setItem('storm_auto_skip', autoSkipEnabled ? 'true' : 'false');
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

  const playerObj = {
    id: 'anilibria_hls',
    name: 'AniLibria (Официальный Full HD поток)',
    badge: 'ANILIBRIA',
    quality: '1080p FHD',
    status_label: '🟢 Онлайн'
  };
  currentActivePlayer = playerObj;
  updatePlayerTriggerInfo(playerObj);

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

  const activeVoiceover = currentMedia?.voiceovers?.find(v => v.id === currentVoiceoverId)?.name || 'Дубляж';
  const playerObj = {
    id: `anixart_${currentVoiceoverId}_${episode.position || 1}`,
    name: `AniXart (${activeVoiceover}, ${episode.position || 1} серия)`,
    badge: 'ANIXART',
    quality: '1080p FHD',
    status_label: '🟢 Онлайн'
  };
  currentActivePlayer = playerObj;
  updatePlayerTriggerInfo(playerObj);

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
  s = s.replace(/\s*постер\s*4[KkКк]/gi, '');
  s = s.replace(/\s*постер/gi, '');
  s = s.replace(/\s*[\(\[]?\s*4[KkКк]\s*(?:Ultra\s*HD|UHD)?\s*[\)\]]?/gi, '');
  s = s.replace(/\s*[\(\[]?\s*(?:Ultra\s*HD|UHD|2160p|1080p|720p|480p|HDR|HDR10\+?|Dolby\s*Vision|DV|Remux|WEB-DL|BDRip|DVDRip)\s*[\)\]]?/gi, '');
  s = s.replace(/\s*[\(\[]?\s*4[KkКк]\s*[\)\]]?/gi, '');
  s = s.replace(/\s*[\(\[]?\s*(?:фильм|сериал)\s*[\)\]]?/gi, '');
  s = s.replace(/[-–—/]\s*$/, '').trim();
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

export function parseFormattedGenres(rawGenres) {
  if (!rawGenres) return [];
  let list = [];
  if (Array.isArray(rawGenres)) {
    list = rawGenres;
  } else if (typeof rawGenres === 'string') {
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
  return unique;
}

export function updatePlayerUrl(mediaItem, season = null, episode = null, player = null) {
  if (!mediaItem) return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('media', mediaItem.id);
    url.searchParams.set('source', mediaItem.source || 'fanfilm4k');
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
  if (mediaDetails.release_date) {
    const parts = String(mediaDetails.release_date).split('-');
    if (parts.length === 3) {
      formattedReleaseDate = `${parts[2].padStart(2, '0')}.${parts[1].padStart(2, '0')}.${parts[0]}`;
    } else {
      formattedReleaseDate = mediaDetails.release_date;
    }
  } else if (mediaDetails.year) {
    formattedReleaseDate = `${mediaDetails.year} год`;
  }

  const duration = mediaDetails.duration || (mediaDetails.runtime_minutes ? `${mediaDetails.runtime_minutes} мин` : '1 ч 45 мин');
  const ratingKp = mediaDetails.rating_kp || mediaDetails.rating || '—';
  const ratingImdb = mediaDetails.rating_imdb || mediaDetails.rating_tmdb || mediaDetails.rating || '—';
  const ratingTmdb = mediaDetails.rating_tmdb || mediaDetails.rating || '—';
  const ratingRotten = mediaDetails.rating_rotten || (parseFloat(mediaDetails.rating) ? Math.min(99, Math.round(parseFloat(mediaDetails.rating) * 10.6)) : 82);
  const ratingMeta = mediaDetails.rating_metacritic || (parseFloat(mediaDetails.rating) ? Math.min(98, Math.round(parseFloat(mediaDetails.rating) * 10.1)) : 76);

  const formattedGenres = parseFormattedGenres(mediaDetails.genres);
  const formattedCountries = parseFormattedCountries(mediaDetails.countries || mediaDetails.country);

  const directors = mediaDetails.directors || [];
  const primaryDirector = directors[0] || null;
  const cast = mediaDetails.cast || [];

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

    <!-- Рейтинги мировых платформ -->
    <div class="cinema-ratings-grid">
      <div class="cinema-rating-card kp">
        <span class="cinema-rating-label">Кинопоиск</span>
        <span class="cinema-rating-value">★ ${ratingKp}</span>
      </div>
      <div class="cinema-rating-card imdb">
        <span class="cinema-rating-label">IMDb</span>
        <span class="cinema-rating-value">★ ${ratingImdb}</span>
      </div>
      <div class="cinema-rating-card tmdb">
        <span class="cinema-rating-label">TMDB</span>
        <span class="cinema-rating-value">★ ${ratingTmdb}</span>
      </div>
      <div class="cinema-rating-card rotten">
        <span class="cinema-rating-label">Rotten Tomatoes</span>
        <span class="cinema-rating-value">🍅 ${ratingRotten}%</span>
      </div>
      <div class="cinema-rating-card meta">
        <span class="cinema-rating-label">Metacritic</span>
        <span class="cinema-rating-value">🟢 ${ratingMeta}/100</span>
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
            <td class="info-table-val"><b>${duration}</b></td>
          </tr>
          <tr>
            <td class="info-table-label">⭐ Рейтинги</td>
            <td class="info-table-val">
              <div class="info-table-ratings">
                <span class="info-rating-chip kp" title="Кинопоиск">★ ${ratingKp}</span>
                <span class="info-rating-chip imdb" title="IMDb">★ ${ratingImdb}</span>
                <span class="info-rating-chip tmdb" title="TMDB">★ ${ratingTmdb}</span>
              </div>
            </td>
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
                    <span>🎭</span>
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
    ${cast.length > 0 ? `
      <div class="cinema-person-section">
        <div class="cinema-section-subtitle">
          <span>🎭</span>
          <span style="font-weight: 800;">В главных ролях (${cast.length})</span>
        </div>
        <div class="cinema-cast-scroll">
          ${cast.map(actor => `
            <div class="cinema-actor-chip" data-actor-id="${actor.id}" data-actor-name="${actor.name}" title="Нажмите для просмотра фильмов">
              <img src="${actor.photo || 'assets/favicon.svg'}" alt="${actor.name}" class="cinema-actor-photo" onerror="this.src='assets/favicon.svg'">
              <div class="cinema-actor-info">
                <div class="cinema-actor-name">${actor.name}</div>
                <div class="cinema-actor-role">${actor.character || 'Роль'}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}
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
// СЕЛЕКТОР СЕЗОНОВ И СЕРИЙ С РУССКИМИ ОПИСАНИЯМИ
// ==========================================
async function renderSeriesSeasons(mediaDetails, initialSeason = null, initialEpisode = null) {
  const container = document.getElementById('series-seasons-container');
  if (!container) return;

  const isSeries = mediaDetails.media_type === 'series' || mediaDetails.category === 'Сериал' || mediaDetails.media_type === 'cartoon-series' || mediaDetails.media_type === 'anime-series';
  const seasons = mediaDetails.seasons || [];

  if (!isSeries || seasons.length === 0) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';

  const tabsContainer = document.getElementById('series-seasons-tabs');
  const descEl = document.getElementById('series-season-desc');
  const gridEl = document.getElementById('series-episodes-grid');

  if (!tabsContainer || !gridEl) return;

  const activeSeasonNum = initialSeason ? parseInt(initialSeason, 10) : seasons[0].season_number;

  // Рендерим плашки сезонов
  tabsContainer.innerHTML = seasons.map(s => `
    <button type="button" class="series-season-tab ${s.season_number === activeSeasonNum ? 'active' : ''}" data-season-num="${s.season_number}">
      ${s.name || `Сезон ${s.season_number}`} (${s.episode_count || '?'})
    </button>
  `).join('');

  async function loadSeasonEpisodes(seasonNum, targetEpisodeNum = null) {
    const season = seasons.find(s => s.season_number === seasonNum) || seasons[0];
    if (descEl) {
      descEl.textContent = season.overview || `Сезон ${season.season_number} доступен для онлайн-просмотра.`;
    }

    gridEl.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:24px;color:var(--text-muted);display:flex;align-items:center;justify-content:center;gap:10px;">
        <div class="storm-spinner"></div>
        <span>Загрузка серий сезона...</span>
      </div>
    `;

    try {
      const tvId = mediaDetails.tmdb_id || String(mediaDetails.id).replace('tmdb_', '');
      const res = await fetch(`/api/media/series-episodes?tvId=${encodeURIComponent(tvId)}&season=${seasonNum}`);
      if (!res.ok) throw new Error('Не удалось загрузить серии');
      const data = await res.json();
      const episodes = data.episodes || [];

      if (episodes.length === 0) {
        gridEl.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-muted);">Серии не найдены</div>`;
        return;
      }

      gridEl.innerHTML = episodes.map(ep => {
        const isEpActive = targetEpisodeNum ? ep.episode_number === parseInt(targetEpisodeNum, 10) : false;
        return `
        <div class="series-episode-card ${isEpActive ? 'active' : ''}" data-ep-num="${ep.episode_number}">
          <div class="series-episode-thumb-box">
            <img src="${ep.still_path || 'assets/favicon.svg'}" alt="${ep.name}" class="series-episode-thumb" loading="lazy" onerror="this.src='assets/favicon.svg'">
            <span class="series-episode-badge">Серия ${ep.episode_number}</span>
            ${ep.duration ? `<span class="series-episode-duration">${ep.duration}</span>` : ''}
          </div>
          <div class="series-episode-content">
            <div class="series-episode-title">${ep.name}</div>
            <div class="series-episode-airdate">${ep.air_date ? 'Дата выхода: ' + ep.air_date : ''}</div>
            <p class="series-episode-desc">${ep.overview || 'Смотрите серию онлайн в высоком качестве.'}</p>
          </div>
        </div>
      `;
      }).join('');

      gridEl.querySelectorAll('.series-episode-card').forEach(card => {
        card.onclick = () => {
          gridEl.querySelectorAll('.series-episode-card').forEach(c => c.classList.remove('active'));
          card.classList.add('active');
          const epNum = parseInt(card.dataset.epNum, 10);
          showToast(`Выбрана серия ${epNum}: ${episodes[epNum - 1]?.name || ''}`, 'info');
          updateProgressState(epNum, episodes.length);
          updatePlayerUrl(mediaDetails, seasonNum, epNum, currentActivePlayer);
        };
      });

      if (targetEpisodeNum) {
        const activeCard = gridEl.querySelector(`.series-episode-card[data-ep-num="${targetEpisodeNum}"]`);
        if (activeCard) {
          activeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    } catch (err) {
      gridEl.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--color-red);">Ошибка: ${err.message}</div>`;
    }
  }

  tabsContainer.querySelectorAll('.series-season-tab').forEach(tab => {
    tab.onclick = () => {
      tabsContainer.querySelectorAll('.series-season-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const sNum = parseInt(tab.dataset.seasonNum, 10);
      loadSeasonEpisodes(sNum, 1);
      updatePlayerUrl(mediaDetails, sNum, 1, currentActivePlayer);
    };
  });

  // Загружаем начальный сезон и серию
  loadSeasonEpisodes(activeSeasonNum, initialEpisode);
}
