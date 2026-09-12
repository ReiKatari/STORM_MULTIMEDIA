/* ==========================================================================
   STORM MULTIMEDIA - КИНОТЕАТРАЛЬНЫЙ МОДАЛЬНЫЙ ПЛЕЕР (CINEMA MODAL)
   Поддержка 4K FanFilm4K, AniXart аниме (с озвучками и сериями), Kinobox
   ========================================================================== */

import { saveBookmarkStatus, syncWatchProgress, fetchCustomLists, addItemToCollection } from './bookmarks.js';
import { getUser, showToast } from './auth.js';
import { t } from './i18n.js';

let currentMedia = null;
let currentPlayers = [];
let currentActivePlayer = null;
let currentVoiceoverId = null;
let currentEpisodes = [];
let currentEpisodeIndex = 1;
let currentProgressPercent = 0;

export async function openPlayerModal(mediaItem) {
  currentMedia = mediaItem;
  const modal = document.getElementById('cinema-modal');
  if (!modal) return;

  // Сброс состояния плеера
  const iframeContainer = document.getElementById('cinema-player-wrapper');
  iframeContainer.innerHTML = '<div style="display:flex;height:100%;align-items:center;justify-content:center;color:var(--text-muted);">Загрузка видеоплеера...</div>';

  document.getElementById('cinema-modal-title').textContent = mediaItem.title;
  document.getElementById('cinema-modal-year').textContent = mediaItem.year || '';
  document.getElementById('cinema-modal-desc').textContent = mediaItem.description || '';

  // Открываем модальное окно
  modal.classList.add('is-open');

  try {
    // Получаем детальные данные с сервера
    const itemUrl = `/api/media/item?id=${encodeURIComponent(mediaItem.id)}&source=${mediaItem.source}&url=${encodeURIComponent(mediaItem.link || '')}&title=${encodeURIComponent(mediaItem.title || '')}&year=${encodeURIComponent(mediaItem.year || '')}&poster=${encodeURIComponent(mediaItem.poster || '')}`;
    const res = await fetch(itemUrl);
    if (!res.ok) throw new Error('Не удалось загрузить данные фильма');
    const details = await res.json();

    currentMedia = { ...mediaItem, ...details };
    currentPlayers = details.players || [];

    renderPlayerSources(currentPlayers);
    renderStatusButtons(details.user_bookmark?.status || mediaItem.user_status);
    renderCustomListsSelector();

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
  } catch (err) {
    iframeContainer.innerHTML = `<div style="display:flex;height:100%;align-items:center;justify-content:center;color:var(--color-red);">Ошибка загрузки: ${err.message}</div>`;
  }
}

export function closePlayerModal() {
  const modal = document.getElementById('cinema-modal');
  if (modal) {
    modal.classList.remove('is-open');
    const iframeContainer = document.getElementById('cinema-player-wrapper');
    if (iframeContainer) iframeContainer.innerHTML = '';
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

  if (!player.url) {
    container.innerHTML = '<div style="display:flex;height:100%;align-items:center;justify-content:center;color:var(--text-muted);">Ссылка на плеер не найдена</div>';
    return;
  }

  playStreamUrl(player.url);
}

function playStreamUrl(url) {
  const container = document.getElementById('cinema-player-wrapper');
  if (!container) return;

  if (url.includes('.m3u8')) {
    container.innerHTML = `
      <video id="storm-video-player" controls autoplay style="width:100%;height:100%;background:#000;border-radius:12px;outline:none;" playsinline></video>
    `;
    const video = document.getElementById('storm-video-player');
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
    return;
  }

  container.innerHTML = `
    <iframe class="cinema-player-iframe" src="${url}" allowfullscreen allow="autoplay; encrypted-media; fullscreen; picture-in-picture"></iframe>
  `;
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
      const streamUrl = ep.hls_1080 || ep.hls_720 || ep.hls_480;
      if (streamUrl) playStreamUrl(streamUrl);
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

  // Загружаем серии первой озвучки
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
      };
      grid.appendChild(epBtn);
    });

    // Автоматически запускаем первую серию
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

  if (episode.url) {
    container.innerHTML = `
      <iframe class="cinema-player-iframe" src="${episode.url}" allowfullscreen allow="autoplay; encrypted-media; fullscreen; picture-in-picture"></iframe>
    `;

    // Синхронизируем прогресс
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

  if (getUser()) {
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
    { id: 'watching', label: t('status_watching'), color: 'watching' },
    { id: 'plan', label: t('status_plan'), color: 'plan' },
    { id: 'completed', label: t('status_completed'), color: 'completed' },
    { id: 'favorite', label: t('status_favorite'), color: 'favorite' }
  ];

  statuses.forEach(s => {
    const btn = document.createElement('button');
    btn.className = `storm-btn storm-btn-sm ${currentStatus === s.id ? 'storm-btn-primary' : 'storm-btn-secondary'}`;
    btn.textContent = s.label;
    btn.onclick = async () => {
      const updated = await saveBookmarkStatus(currentMedia, s.id);
      if (updated) {
        renderStatusButtons(s.id);
      }
    };
    statusContainer.appendChild(btn);
  });
}

async function renderCustomListsSelector() {
  const select = document.getElementById('add-to-custom-list-select');
  if (!select) return;

  select.innerHTML = '<option value="">+ Добавить в коллекцию...</option>';
  if (!getUser()) return;

  const lists = await fetchCustomLists();
  lists.forEach(list => {
    const opt = document.createElement('option');
    opt.value = list.id;
    opt.textContent = list.title;
    select.appendChild(opt);
  });

  select.onchange = async () => {
    const listId = select.value;
    if (listId) {
      await addItemToCollection(listId, currentMedia);
      select.value = '';
    }
  };
}
