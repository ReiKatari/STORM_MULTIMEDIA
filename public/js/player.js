/* ==========================================================================
   STORM MULTIMEDIA - КИНОТЕАТРАЛЬНЫЙ МОДАЛЬНЫЙ ПЛЕЕР (CINEMA MODAL)
   Поддержка 4K FanFilm4K, AniLibria HLS, AniXart, Kinobox, WebTorrent,
   Ambilight эффекта, пропуска интро/аутро, PiP, субтитров и совместного просмотра
   ========================================================================== */

import { saveBookmarkStatus, syncWatchProgress, fetchCustomLists, addItemToCollection, createCustomCollection } from './bookmarks.js';
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

// Ambilight
let ambilightEnabled = false;
let ambilightCanvas = null;
let ambilightCtx = null;
let ambilightRaf = null;

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
            name: 'Kodik Онлайн (HD)',
            url: `https://kodik.info/search?title=${encodeURIComponent(mediaItem.title)}`,
            badge: 'KODIK'
          },
          {
            name: 'Трейлер и превью (HD)',
            url: `https://www.youtube.com/embed?listType=search&list=${encodeURIComponent(mediaItem.title + ' трейлер')}`,
            badge: 'PREVIEW'
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
      playStreamUrl(`https://www.youtube.com/embed?listType=search&list=${encodeURIComponent(mediaItem.title + ' трейлер')}`);
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

  if (players.length === 0) {
    container.innerHTML = '<span style="color:var(--text-muted);font-size:12px;">Плееры для данного видео недоступны</span>';
    return;
  }

  players.forEach((p, idx) => {
    const btn = document.createElement('button');
    btn.className = `player-source-btn ${idx === 0 ? 'active' : ''}`;
    btn.innerHTML = `<span>${p.badge || 'ПЛЕЕР'}</span> ${p.name}`;
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
// AMBILIGHT (ДИНАМИЧЕСКАЯ ПОДСВЕТКА)
// ==========================================
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
    if (video) startAmbilightLoop(video);
  } else {
    stopAmbilight();
    if (aura) aura.style.opacity = '0';
    showToast('Подсветка Ambilight выключена', 'info');
  }
}

function startAmbilightLoop(video) {
  stopAmbilight();

  function loop() {
    if (!ambilightEnabled || !video || video.paused || video.ended) {
      ambilightRaf = requestAnimationFrame(loop);
      return;
    }

    try {
      if (video.videoWidth > 0) {
        ambilightCtx.drawImage(video, 0, 0, 16, 9);
        const data = ambilightCtx.getImageData(0, 0, 16, 9).data;

        // Средний цвет
        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 16) {
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          count++;
        }
        r = Math.round(r / count);
        g = Math.round(g / count);
        b = Math.round(b / count);

        const aura = document.getElementById('player-ambilight-aura');
        if (aura) {
          aura.style.opacity = '0.75';
          aura.style.boxShadow = `0 0 90px rgba(${r}, ${g}, ${b}, 0.85), inset 0 0 60px rgba(${r}, ${g}, ${b}, 0.5)`;
        }
      }
    } catch {}

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
// P2P WEBTORRENT СТРИМИНГ
// ==========================================
function renderWebTorrentPlayer() {
  const container = document.getElementById('cinema-player-wrapper');
  if (!container) return;

  container.innerHTML = `
    <div class="webtorrent-container">
      <div style="text-align: center; margin-bottom: 16px;">
        <span style="font-size: 36px;">🧲</span>
        <h4 style="margin: 6px 0; font-weight: 800;">P2P WebTorrent Стриминг</h4>
        <p style="font-size: 12px; color: var(--text-muted); max-width: 480px; margin: 0 auto;">
          Прямое воспроизведение magnet-ссылок и торрент-файлов в браузере через пиринговую сеть WebTorrent без ожидания загрузки.
        </p>
      </div>

      <div style="display: flex; gap: 8px; max-width: 600px; margin: 0 auto 16px auto; width: 100%;">
        <input type="text" class="storm-input" id="torrent-magnet-input" placeholder="Вставьте magnet:?xt=urn:btih:... ссылку">
        <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="start-torrent-btn">Запустить</button>
      </div>

      <div style="display: flex; justify-content: center; gap: 10px; margin-bottom: 20px;">
        <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="preset-torrent-btn">▶️ Запустить демо (4K Tears of Steel)</button>
        <label class="storm-btn storm-btn-secondary storm-btn-sm" style="cursor: pointer; margin: 0;">
          📁 Открыть .torrent файл
          <input type="file" id="torrent-file-input" accept=".torrent" style="display: none;">
        </label>
      </div>

      <!-- Контейнер плеера и HUD пиров -->
      <div id="torrent-playback-area" style="display: none; width: 100%; height: 380px; position: relative;">
        <video id="storm-video-player" controls autoplay style="width:100%;height:100%;background:#000;border-radius:12px;"></video>
        <div class="torrent-stats-hud" id="torrent-stats-hud">
          <span>👥 Пиров: <b id="torrent-peers">0</b></span>
          <span>⬇️ Скорость: <b id="torrent-speed">0 MB/s</b></span>
          <span>📊 Прогресс: <b id="torrent-progress">0%</b></span>
        </div>
      </div>
    </div>
  `;

  const startBtn = container.querySelector('#start-torrent-btn');
  const magnetInput = container.querySelector('#torrent-magnet-input');
  const presetBtn = container.querySelector('#preset-torrent-btn');
  const fileInput = container.querySelector('#torrent-file-input');

  if (startBtn && magnetInput) {
    startBtn.onclick = () => {
      const magnet = magnetInput.value.trim();
      if (!magnet) {
        showToast('Введите magnet-ссылку', 'warning');
        return;
      }
      startWebTorrentStream(magnet);
    };
  }

  if (presetBtn) {
    presetBtn.onclick = () => {
      // Официальный открытый торрент Tears of Steel (WebTorrent)
      const demoMagnet = 'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftracker.empire-js.us%3A1337&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=wss%3A%2F%2Ftracker.btorrent.xyz&tr=wss%3A%2F%2Ftracker.fastcast.nz&tr=wss%3A%2F%2Ftracker.openwebtorrent.com';
      startWebTorrentStream(demoMagnet);
    };
  }

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
  if (playbackArea) playbackArea.style.display = 'block';

  if (torrentClient) {
    torrentClient.destroy();
  }

  torrentClient = new window.WebTorrent();
  showToast('Подключение к пиринговой сети P2P...', 'info');

  torrentClient.add(torrentIdentifier, (torrent) => {
    showToast(`Торрент обнаружен: ${torrent.name}`, 'success');
    trackClientAction('use_torrent');

    // Находим видеофайл
    const file = torrent.files.find(f => f.name.endsWith('.mp4') || f.name.endsWith('.mkv') || f.name.endsWith('.webm'));
    if (file) {
      const video = document.getElementById('storm-video-player');
      file.renderTo(video, { autoplay: true });
      setupVideoFeatures(video, playbackArea);
    }

    // Обновляем статистику скорости и пиров
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
    <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px;">
      <!-- Кнопка Ambilight -->
      <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm ${ambilightEnabled ? 'active' : ''}" id="toggle-ambilight-btn">
        🌈 Ambilight
      </button>

      <!-- Кнопка PiP -->
      <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="toggle-pip-btn">
        🖼️ PiP
      </button>

      <!-- Кнопка Кинокомнаты -->
      <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="create-room-btn">
        👥 Кинокомната
      </button>

      <!-- Автопропуск интро/аутро -->
      <label class="storm-btn storm-btn-secondary storm-btn-sm" style="display: flex; align-items: center; gap: 6px; cursor: pointer; margin: 0;">
        <input type="checkbox" id="toggle-autoskip" ${autoSkipEnabled ? 'checked' : ''}>
        Автопропуск интро
      </label>
    </div>

    <!-- Панель субтитров -->
    <div id="subtitles-controls-host"></div>
  `;

  const ambilightBtn = container.querySelector('#toggle-ambilight-btn');
  if (ambilightBtn) ambilightBtn.onclick = toggleAmbilight;

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
    { id: 'watching', label: t('status_watching') },
    { id: 'planned', label: t('status_plan') },
    { id: 'completed', label: t('status_completed') },
    { id: 'favorite', label: t('status_favorite') },
    { id: 'on_hold', label: t('status_hold') },
    { id: 'dropped', label: t('status_dropped') },
    { id: 'wont_watch', label: t('status_wont_watch') }
  ];

  const normStatus = currentStatus === 'plan' ? 'planned' : (currentStatus === 'hold' ? 'on_hold' : currentStatus);

  statuses.forEach(s => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const isActive = normStatus === s.id;
    btn.className = `storm-btn storm-btn-sm ${isActive ? 'storm-btn-primary' : 'storm-btn-secondary'}`;
    btn.textContent = s.label;
    btn.onclick = async () => {
      const updated = await saveBookmarkStatus(currentMedia, s.id);
      if (updated) {
        if (currentMedia) currentMedia.user_status = s.id;
        renderStatusButtons(s.id);
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
