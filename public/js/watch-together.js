/* ==========================================================================
   STORM MULTIMEDIA - КИНОКОМНАТА И WATCH TOGETHER (СОВМЕСТНЫЙ ПРОСМОТР)
   WebSocket синхронизация таймкодов, воспроизведения и встроенный кибер-чат
   ========================================================================== */

import { getUser, showToast } from './auth.js';
import { trackClientAction } from './achievements.js';

let ws = null;
let currentRoom = null;
let isHost = false;
let isLocalAction = false;
let attachedVideoElement = null;

export function getActiveRoom() {
  return currentRoom;
}

export function isUserHost() {
  return isHost;
}

export async function createWatchRoom(mediaItem) {
  try {
    const user = getUser();
    const token = localStorage.getItem('storm_token');
    const res = await fetch('/api/rooms/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ media: mediaItem })
    });

    if (!res.ok) throw new Error('Не удалось создать комнату совместного просмотра');
    const data = await res.json();
    isHost = true;

    connectWebSocket(data.code, user, mediaItem);
    trackClientAction('room_host');
    return data.code;
  } catch (err) {
    showToast(err.message, 'error');
    return null;
  }
}

export function joinWatchRoom(roomCode, mediaItem = null) {
  const code = (roomCode || '').toUpperCase().trim();
  if (!code) {
    showToast('Введите код комнаты', 'warning');
    return;
  }

  isHost = false;
  const user = getUser();
  connectWebSocket(code, user, mediaItem);
  trackClientAction('room_guest');
}

export function leaveWatchRoom() {
  if (ws) {
    ws.close();
    ws = null;
  }
  currentRoom = null;
  isHost = false;
  attachedVideoElement = null;
  renderRoomUi(null);
  showToast('Вы покинули комнату совместного просмотра', 'info');
}

function connectWebSocket(roomCode, user, mediaItem) {
  if (ws) {
    ws.close();
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: 'join_room',
      roomCode,
      user: user ? { id: user.id, username: user.username, avatar: user.avatar } : { id: `guest_${Date.now()}`, username: 'Гость' }
    }));
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleSocketMessage(data);
    } catch (err) {
      console.error('Ошибка разбора WebSocket пакета:', err);
    }
  };

  ws.onclose = () => {
    updateSyncStatus('disconnected');
  };

  ws.onerror = () => {
    updateSyncStatus('error');
  };
}

function handleSocketMessage(data) {
  switch (data.type) {
    case 'room_joined':
      currentRoom = {
        code: data.roomCode,
        media: data.media,
        participants: data.participants || [],
        messages: data.messages || []
      };
      showToast(`Вы подключились к комнате ${data.roomCode}!`, 'success');
      renderRoomUi(currentRoom);
      updateSyncStatus('synced');
      break;

    case 'participant_update':
      if (currentRoom) {
        currentRoom.participants = data.participants || [];
        renderParticipants(currentRoom.participants);
      }
      if (data.joinedUser) {
        showToast(`К просмотру присоединился: ${data.joinedUser.username}`, 'info');
      }
      break;

    case 'playback_sync':
      handleIncomingPlaybackSync(data);
      break;

    case 'media_changed':
      if (currentRoom) {
        currentRoom.media = data.media;
        showToast(`Хост переключил видео: ${data.media?.title || 'Новый релиз'}`, 'info');
      }
      break;

    case 'chat_received':
      if (currentRoom) {
        currentRoom.messages.push(data.message);
        appendChatMessage(data.message);
      }
      break;

    case 'chat_deleted':
      if (currentRoom) {
        currentRoom.messages = (currentRoom.messages || []).filter(m => String(m.id) !== String(data.messageId));
        const el = document.querySelector(`.watch-chat-msg[data-msg-id="${data.messageId}"]`);
        if (el) {
          el.style.opacity = '0';
          el.style.transform = 'scale(0.85)';
          setTimeout(() => el.remove(), 200);
        }
      }
      break;

    case 'error':
      showToast(data.message || 'Ошибка комнаты', 'error');
      break;

    default:
      break;
  }
}

export function attachPlayerToRoom(videoElement) {
  attachedVideoElement = videoElement;
  if (!videoElement || !currentRoom) return;

  videoElement.onplay = () => {
    if (isLocalAction) return;
    broadcastPlaybackState(true, videoElement.currentTime);
  };

  videoElement.onpause = () => {
    if (isLocalAction) return;
    broadcastPlaybackState(false, videoElement.currentTime);
  };

  videoElement.onseeked = () => {
    if (isLocalAction) return;
    broadcastPlaybackState(!videoElement.paused, videoElement.currentTime);
  };
}

function broadcastPlaybackState(isPlaying, currentTime) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !currentRoom) return;
  ws.send(JSON.stringify({
    type: 'sync_playback',
    roomCode: currentRoom.code,
    isPlaying,
    currentTime
  }));
}

function handleIncomingPlaybackSync(data) {
  if (!attachedVideoElement) return;

  isLocalAction = true;
  const targetTime = parseFloat(data.currentTime);
  const timeDrift = Math.abs(attachedVideoElement.currentTime - targetTime);

  if (timeDrift > 1.5) {
    attachedVideoElement.currentTime = targetTime;
  }

  if (data.isPlaying && attachedVideoElement.paused) {
    attachedVideoElement.play().catch(() => {});
  } else if (!data.isPlaying && !attachedVideoElement.paused) {
    attachedVideoElement.pause();
  }

  setTimeout(() => {
    isLocalAction = false;
  }, 200);

  updateSyncStatus('synced');
}

let currentReplyTo = null;

export function sendRoomChatMessage(text, replyTo = null) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !currentRoom) return;
  const clean = text.trim();
  if (!clean) return;

  ws.send(JSON.stringify({
    type: 'chat_message',
    roomCode: currentRoom.code,
    text: clean,
    replyTo: replyTo ? {
      id: replyTo.id,
      username: replyTo.username,
      text: replyTo.text
    } : null
  }));
}

export function deleteRoomChatMessage(messageId) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !currentRoom) return;
  ws.send(JSON.stringify({
    type: 'delete_chat_message',
    roomCode: currentRoom.code,
    messageId
  }));
}

function updateSyncStatus(status) {
  const badge = document.getElementById('room-sync-badge');
  if (!badge) return;

  if (status === 'synced') {
    badge.className = 'room-sync-badge synced';
    badge.textContent = '🟢 Синхронизировано';
  } else if (status === 'syncing') {
    badge.className = 'room-sync-badge syncing';
    badge.textContent = '🟡 Синхронизация...';
  } else {
    badge.className = 'room-sync-badge offline';
    badge.textContent = '🔴 Отключено';
  }
}

// Обои для кинокомнаты
const ROOM_WALLPAPERS = [
  { id: 'room-bg-cyberpunk', name: 'Киберпанк Найт-Сити', color: '#ff007f' },
  { id: 'room-bg-oled', name: 'Глубокий OLED', color: '#00f0ff' },
  { id: 'room-bg-cosmos', name: 'Звездный космос', color: '#a855f7' },
  { id: 'room-bg-anime', name: 'Аниме закат', color: '#f59e0b' },
  { id: 'room-bg-velvet', name: 'Бархатный кинозал', color: '#ef4444' },
  { id: 'room-bg-matrix', name: 'Матричный изумруд', color: '#00ff66' },
  { id: 'room-bg-gothic', name: 'Имперская готика 40K', color: '#d4af37' },
  { id: 'room-bg-vaporwave', name: 'Неоновый Vaporwave', color: '#ec4899' }
];

let currentRoomWallpaper = localStorage.getItem('storm_room_wallpaper') || 'room-bg-cyberpunk';

// Расширенные наборы эмодзи по категориям (100+ эмодзи)
const CHAT_EMOJI_CATEGORIES = {
  top: {
    icon: '🌟',
    title: 'Популярные',
    list: ['😂', '🔥', '🍿', '❤️', '👏', '😱', '🚀', '💀', '🤩', '🎉', '🎬', '👀', '💯', '⚡', '🤖', '🎮', '🪐', '🍕', '🍷', '✨']
  },
  smiles: {
    icon: '😊',
    title: 'Смайлы',
    list: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😭', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕']
  },
  cinema: {
    icon: '🍿',
    title: 'Кино и еда',
    list: ['🍿', '🎬', '🎞️', '📽️', '🎥', '📺', '📻', '🎟️', '🎫', '🏆', '🥇', '🍕', '🍔', '🍟', '🌭', '🥪', '🌮', '🍣', '🍫', '🍦', '🍩', '🍪', '☕', '🧃', '🥤', '🍺', '🍷', '🥂', '🍾']
  },
  gestures: {
    icon: '👋',
    title: 'Жесты',
    list: ['👍', '👎', '👊', '✊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✌️', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '✋', '🤚', '🖐️', '🖖', '👋', '💪']
  },
  hearts: {
    icon: '💖',
    title: 'Сердца и магия',
    list: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '🌟', '⭐', '✨', '⚡', '🔥', '💥', '🌈', '🎉', '🎊']
  }
};

const CHAT_STICKER_PACKS = {
  pepe: [
    { icon: '🐸🍿', label: 'Пепе с попкорном' },
    { icon: '🐸🕶️', label: 'Крутой Пепе' },
    { icon: '🐸🍷', label: 'Пепе с бокалом' },
    { icon: '🐸❤️', label: 'Влюбленный Пепе' },
    { icon: '🐸👍', label: 'Одобряющий Пепе' }
  ],
  cats: [
    { icon: '🐱🍿', label: 'Кот киноман' },
    { icon: '😼✨', label: 'Довольный кот' },
    { icon: '🙀💥', label: 'Шокированный кот' },
    { icon: '😻💖', label: 'Кот в восторге' },
    { icon: '😹🔥', label: 'Ржущий кот' }
  ],
  popcorn: [
    { icon: '🍿🥤', label: 'Кино-сет' },
    { icon: '🎬🎟️', label: 'Билет в кино' },
    { icon: '🎞️📽️', label: 'Пленка' },
    { icon: '⭐🏆', label: 'Оскар' },
    { icon: '🔥🚀', label: 'Шедевр' }
  ]
};

// Форматирование Markdown текста в HTML
function formatChatMessageText(text) {
  if (!text) return '';
  let str = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // Жирный: **текст**
  str = str.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // Курсив: *текст*
  str = str.replace(/\*(.*?)\*/g, '<em>$1</em>');
  // Инлайн код: `код`
  str = str.replace(/`(.*?)`/g, '<code style="background:rgba(0,0,0,0.4);padding:1px 5px;border-radius:4px;font-family:monospace;font-size:11px;color:var(--accent);">$1</code>');
  // Зачеркнутый: ~~текст~~
  str = str.replace(/~~(.*?)~~/g, '<del>$1</del>');
  // Цитата: > цитата
  str = str.replace(/^&gt;\s?(.*)$/gm, '<blockquote style="border-left:2px solid var(--accent);padding-left:8px;margin:3px 0;color:var(--text-muted);font-style:italic;">$1</blockquote>');
  // Подсветка упоминаний: @username
  str = str.replace(/(@[a-zA-Z0-9_\u0400-\u04FF]+)/g, '<span class="chat-mention">$1</span>');

  return str;
}

export function renderRoomUi(room) {
  const container = document.getElementById('watch-together-sidebar');
  if (!container) return;

  if (!room) {
    container.style.display = 'none';
    currentReplyTo = null;
    return;
  }

  // Применяем выбранные обои
  container.className = `watch-together-sidebar ${currentRoomWallpaper}`;
  container.style.display = 'flex';

  const media = room.media || null;
  const mediaTitle = media ? (media.title || 'Фильм') : 'Медиа не выбрано';
  const mediaPoster = media ? (media.poster || 'assets/favicon.svg') : 'assets/favicon.svg';
  const mediaYear = media ? (media.year || '') : '';

  container.innerHTML = `
    <div class="watch-room-header">
      <div>
        <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--accent); font-weight: 800;">Кинозал</div>
        <div style="font-size: 15px; font-weight: 800;">Код: <span id="room-code-display" style="color: var(--accent); cursor: pointer;" title="Скопировать код">${room.code}</span></div>
      </div>
      <div style="display: flex; align-items: center; gap: 6px;">
        <button type="button" class="storm-btn storm-btn-sm" id="room-wallpaper-btn" title="Сменить обои кинокомнаты" style="padding: 4px 8px; font-size: 12px;">🖼️</button>
        <button type="button" class="storm-btn storm-btn-danger storm-btn-sm" id="leave-room-btn" title="Выйти из комнаты" style="padding: 4px 8px; font-size: 11px;">✕</button>
      </div>
    </div>

    <!-- Поповер выбора обоев (скрыт по умолчанию) -->
    <div id="room-wallpapers-popover" style="display: none; background: var(--bg-tertiary); padding: 10px; border-radius: 10px; margin-bottom: 10px; border: 1px solid var(--border-subtle);">
      <div style="font-size: 11px; font-weight: 700; color: var(--text-muted); margin-bottom: 6px;">Обои кинозала:</div>
      <div style="display: flex; gap: 6px; flex-wrap: wrap;">
        ${ROOM_WALLPAPERS.map(wp => `
          <button type="button" class="storm-btn storm-btn-sm set-wallpaper-btn ${currentRoomWallpaper === wp.id ? 'storm-btn-primary' : 'storm-btn-secondary'}" data-wp="${wp.id}" style="font-size: 11px; padding: 3px 8px;">
            ${wp.name}
          </button>
        `).join('')}
      </div>
    </div>

    <!-- Карточка текущего видео -->
    <div class="watch-room-media-card">
      <img src="${mediaPoster}" alt="${mediaTitle}" class="watch-room-media-thumb" onerror="this.src='assets/favicon.svg'">
      <div class="watch-room-media-info">
        <div class="watch-room-media-title" title="${mediaTitle}">🎬 ${mediaTitle}</div>
        <div class="watch-room-media-sub">${mediaYear ? mediaYear + ' г.' : 'Синхронный показ'} • <span id="room-sync-badge" class="room-sync-badge synced" style="display: inline-block;">🟢 В сети</span></div>
      </div>
    </div>

    <!-- Кнопки управления синхронизацией воспроизведения -->
    <div class="watch-room-controls-bar">
      <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="room-play-pause-btn" style="flex: 1; font-size: 11px;">
        ⏯️ Пауза / Плей
      </button>
      <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="room-sync-timecode-btn" style="flex: 1; font-size: 11px;" title="Синхронизировать таймкод видео">
        ⏱️ Синхронизация
      </button>
    </div>

    <!-- Участники просмотра -->
    <div class="watch-room-participants" id="watch-room-participants"></div>

    <!-- Кибер-чат -->
    <div class="watch-room-chat-messages" id="watch-room-chat-messages"></div>

    <!-- Поповер эмодзи и стикеров -->
    <div class="watch-chat-stickers-popover" id="chat-stickers-popover" style="display: none;">
      <div class="stickers-tabs-header">
        <button type="button" class="stickers-tab-btn active" data-tab="top" title="Популярные">🌟</button>
        <button type="button" class="stickers-tab-btn" data-tab="smiles" title="Смайлики">😊</button>
        <button type="button" class="stickers-tab-btn" data-tab="cinema" title="Кино и еда">🍿</button>
        <button type="button" class="stickers-tab-btn" data-tab="gestures" title="Жесты">👋</button>
        <button type="button" class="stickers-tab-btn" data-tab="hearts" title="Сердца">💖</button>
        <button type="button" class="stickers-tab-btn" data-tab="pepe" title="Пепе">🐸</button>
        <button type="button" class="stickers-tab-btn" data-tab="cats" title="Котики">🐱</button>
        <button type="button" class="stickers-tab-btn" data-tab="popcorn" title="Попкорн">🥤</button>
      </div>
      <div class="stickers-grid" id="stickers-grid-content"></div>
    </div>

    <!-- Панель ответа на сообщение -->
    <div id="chat-reply-banner" class="chat-reply-banner" style="display: none;">
      <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0;">
        <span>Ответ для <b id="reply-author-name" style="color: var(--accent);">@user</b>: </span>
        <span id="reply-text-preview" style="color: var(--text-muted);"></span>
      </div>
      <button type="button" id="cancel-reply-btn" class="storm-btn storm-btn-sm" style="padding: 1px 6px; font-size: 10px; margin-left: 6px;">✕</button>
    </div>

    <!-- Тулбар форматирования текста -->
    <div class="chat-format-toolbar">
      <button type="button" class="chat-format-btn" data-tag="bold" title="Жирный шрифт (**текст**)"><b>B</b></button>
      <button type="button" class="chat-format-btn" data-tag="italic" title="Курсив (*текст*)"><i>I</i></button>
      <button type="button" class="chat-format-btn" data-tag="code" title="Моноширинный код"><code>&lt;/&gt;</code></button>
      <button type="button" class="chat-format-btn" data-tag="strike" title="Зачеркнутый (~~текст~~)"><s>S</s></button>
      <button type="button" class="chat-format-btn" data-tag="quote" title="Цитата (&gt; цитата)">❝</button>
    </div>

    <!-- Форма отправки сообщения -->
    <form class="watch-room-chat-form" id="watch-room-chat-form">
      <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="toggle-stickers-btn" style="padding: 6px 10px;" title="Смайлики и стикеры">😊</button>
      <input type="text" class="storm-input" id="watch-chat-input" placeholder="Написать зрителям (поддерживается разметка)..." autocomplete="off" style="font-size: 12px; padding: 6px 10px;">
      <button type="submit" class="storm-btn storm-btn-primary storm-btn-sm" style="padding: 6px 12px;" title="Отправить">➤</button>
    </form>
  `;

  // Копирование кода
  const codeDisplay = container.querySelector('#room-code-display');
  if (codeDisplay) {
    codeDisplay.onclick = () => {
      navigator.clipboard.writeText(room.code);
      showToast('Код комнаты скопирован в буфер обмена!', 'success');
    };
  }

  // Обои комнаты
  const wpBtn = container.querySelector('#room-wallpaper-btn');
  const wpPopover = container.querySelector('#room-wallpapers-popover');
  if (wpBtn && wpPopover) {
    wpBtn.onclick = () => {
      wpPopover.style.display = wpPopover.style.display === 'none' ? 'block' : 'none';
    };
  }

  container.querySelectorAll('.set-wallpaper-btn').forEach(btn => {
    btn.onclick = () => {
      currentRoomWallpaper = btn.dataset.wp;
      localStorage.setItem('storm_room_wallpaper', currentRoomWallpaper);
      container.className = `watch-together-sidebar ${currentRoomWallpaper}`;
      container.querySelectorAll('.set-wallpaper-btn').forEach(b => {
        b.className = `storm-btn storm-btn-sm set-wallpaper-btn ${b.dataset.wp === currentRoomWallpaper ? 'storm-btn-primary' : 'storm-btn-secondary'}`;
      });
      wpPopover.style.display = 'none';
    };
  });

  // Выход
  const leaveBtn = container.querySelector('#leave-room-btn');
  if (leaveBtn) leaveBtn.onclick = leaveWatchRoom;

  // Управление воспроизведением
  const playPauseBtn = container.querySelector('#room-play-pause-btn');
  if (playPauseBtn) {
    playPauseBtn.onclick = () => {
      const video = attachedVideoElement || document.getElementById('storm-video-player');
      if (video) {
        const nextPlay = video.paused;
        if (nextPlay) video.play().catch(() => {});
        else video.pause();
        broadcastPlaybackState(nextPlay, video.currentTime);
        showToast(nextPlay ? 'Воспроизведение запущено для всех' : 'Пауза установлена для всех', 'info');
      } else {
        broadcastPlaybackState(true, 0);
        showToast('Сигнал воспроизведения отправлен участникам', 'info');
      }
    };
  }

  const syncTimecodeBtn = container.querySelector('#room-sync-timecode-btn');
  if (syncTimecodeBtn) {
    syncTimecodeBtn.onclick = () => {
      const video = attachedVideoElement || document.getElementById('storm-video-player');
      const time = video ? video.currentTime : 0;
      broadcastPlaybackState(video ? !video.paused : true, time);
      showToast('Таймкод синхронизирован со всеми зрителями!', 'success');
    };
  }

  // Кнопки форматирования текста
  container.querySelectorAll('.chat-format-btn').forEach(btn => {
    btn.onclick = () => {
      applyTextFormatting(btn.dataset.tag);
    };
  });

  // Отмена ответа
  const cancelReplyBtn = container.querySelector('#cancel-reply-btn');
  if (cancelReplyBtn) {
    cancelReplyBtn.onclick = () => {
      currentReplyTo = null;
      const banner = document.getElementById('chat-reply-banner');
      if (banner) banner.style.display = 'none';
    };
  }

  // Смайлики и стикеры
  const stickersBtn = container.querySelector('#toggle-stickers-btn');
  const stickersPopover = container.querySelector('#chat-stickers-popover');
  const stickersContent = container.querySelector('#stickers-grid-content');
  const chatInput = container.querySelector('#watch-chat-input');

  const renderStickersTab = (tab) => {
    stickersContent.innerHTML = '';
    if (CHAT_EMOJI_CATEGORIES[tab]) {
      const category = CHAT_EMOJI_CATEGORIES[tab];
      category.list.forEach(emoji => {
        const span = document.createElement('div');
        span.className = 'sticker-item';
        span.textContent = emoji;
        span.onclick = () => {
          chatInput.value += emoji;
          stickersPopover.style.display = 'none';
          chatInput.focus();
        };
        stickersContent.appendChild(span);
      });
    } else {
      const pack = CHAT_STICKER_PACKS[tab] || [];
      pack.forEach(st => {
        const div = document.createElement('div');
        div.className = 'sticker-item';
        div.textContent = st.icon;
        div.title = st.label;
        div.onclick = () => {
          sendRoomChatMessage(st.icon, currentReplyTo);
          currentReplyTo = null;
          const banner = document.getElementById('chat-reply-banner');
          if (banner) banner.style.display = 'none';
          stickersPopover.style.display = 'none';
        };
        stickersContent.appendChild(div);
      });
    }
  };

  if (stickersBtn && stickersPopover) {
    stickersBtn.onclick = (e) => {
      e.stopPropagation();
      const isVisible = stickersPopover.style.display === 'block';
      stickersPopover.style.display = isVisible ? 'none' : 'block';
      if (!isVisible) renderStickersTab('top');
    };

    container.querySelectorAll('.stickers-tab-btn').forEach(tabBtn => {
      tabBtn.onclick = (e) => {
        e.stopPropagation();
        container.querySelectorAll('.stickers-tab-btn').forEach(b => b.classList.remove('active'));
        tabBtn.classList.add('active');
        renderStickersTab(tabBtn.dataset.tab);
      };
    });
  }

  // Отправка сообщений
  const chatForm = container.querySelector('#watch-room-chat-form');
  if (chatForm && chatInput) {
    chatForm.onsubmit = (e) => {
      e.preventDefault();
      sendRoomChatMessage(chatInput.value, currentReplyTo);
      chatInput.value = '';
      currentReplyTo = null;
      const banner = document.getElementById('chat-reply-banner');
      if (banner) banner.style.display = 'none';
      if (stickersPopover) stickersPopover.style.display = 'none';
    };
  }

  renderParticipants(room.participants);
  renderAllChatMessages(room.messages);
}

function applyTextFormatting(tag) {
  const input = document.getElementById('watch-chat-input');
  if (!input) return;

  const start = input.selectionStart || 0;
  const end = input.selectionEnd || 0;
  const sel = input.value.substring(start, end);

  let before = '', after = '';
  switch (tag) {
    case 'bold': before = '**'; after = '**'; break;
    case 'italic': before = '*'; after = '*'; break;
    case 'code': before = '`'; after = '`'; break;
    case 'strike': before = '~~'; after = '~~'; break;
    case 'quote': before = '> '; after = ''; break;
  }

  const defaultText = tag === 'quote' ? 'Цитата' : 'текст';
  const replacement = before + (sel || defaultText) + after;
  input.value = input.value.substring(0, start) + replacement + input.value.substring(end);
  input.focus();
  const newStart = start + before.length;
  const newEnd = newStart + (sel.length || defaultText.length);
  input.setSelectionRange(newStart, newEnd);
}

function mentionParticipant(username) {
  const input = document.getElementById('watch-chat-input');
  if (!input) return;
  const mention = `@${username}, `;
  if (!input.value.includes(mention)) {
    input.value = mention + input.value;
  }
  input.focus();
}

function renderParticipants(participants) {
  const container = document.getElementById('watch-room-participants');
  if (!container) return;

  container.innerHTML = `
    <div style="font-size: 11px; font-weight: 700; color: var(--text-muted); margin-bottom: 4px;">Зрители (${participants.length}):</div>
    <div class="participants-avatars-row">
      ${participants.map(p => `
        <div class="participant-badge" data-username="${p.username}" title="${p.username} ${p.isHost ? '(Хост)' : ''} — нажмите для упоминания" style="cursor: pointer;">
          <img src="${p.avatar || 'assets/favicon.svg'}" alt="${p.username}">
          <span>${p.username}</span>
          ${p.isHost ? '<span class="host-crown">👑</span>' : ''}
        </div>
      `).join('')}
    </div>
  `;

  // Клик по участнику для упоминания
  container.querySelectorAll('.participant-badge').forEach(badge => {
    badge.onclick = () => {
      mentionParticipant(badge.dataset.username);
    };
  });
}

function renderAllChatMessages(messages) {
  const container = document.getElementById('watch-room-chat-messages');
  if (!container) return;
  container.innerHTML = '';
  (messages || []).forEach(appendChatMessage);
}

function appendChatMessage(msg) {
  const container = document.getElementById('watch-room-chat-messages');
  if (!container || !msg) return;

  const currentUser = getUser();
  const isAuthor = currentUser && (msg.userId === currentUser.id || msg.username === currentUser.username);
  const canDelete = isAuthor || isHost;

  const row = document.createElement('div');
  row.className = 'watch-chat-msg';
  row.dataset.msgId = msg.id;

  const formattedContent = formatChatMessageText(msg.text);

  row.innerHTML = `
    ${msg.replyTo ? `
      <div class="chat-msg-quote">
        ↩️ <b>@${msg.replyTo.username}:</b> ${msg.replyTo.text}
      </div>
    ` : ''}
    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
      <div>
        <span class="chat-msg-time">${msg.time}</span>
        <span class="chat-msg-author">${msg.username}:</span>
        <span class="chat-msg-text">${formattedContent}</span>
      </div>
      <div class="chat-msg-actions">
        <button type="button" class="chat-msg-action-btn reply-btn" title="Ответить / цитировать">💬</button>
        ${canDelete ? `<button type="button" class="chat-msg-action-btn delete-btn" title="Удалить сообщение">🗑️</button>` : ''}
      </div>
    </div>
  `;

  // Кнопка ответить
  const replyBtn = row.querySelector('.reply-btn');
  if (replyBtn) {
    replyBtn.onclick = () => {
      currentReplyTo = {
        id: msg.id,
        username: msg.username,
        text: msg.text
      };
      const banner = document.getElementById('chat-reply-banner');
      const authorName = document.getElementById('reply-author-name');
      const textPreview = document.getElementById('reply-text-preview');
      if (banner && authorName && textPreview) {
        authorName.textContent = `@${msg.username}`;
        textPreview.textContent = msg.text.length > 35 ? msg.text.substring(0, 35) + '...' : msg.text;
        banner.style.display = 'flex';
      }
      const chatInput = document.getElementById('watch-chat-input');
      if (chatInput) chatInput.focus();
    };
  }

  // Кнопка удалить
  const deleteBtn = row.querySelector('.delete-btn');
  if (deleteBtn) {
    deleteBtn.onclick = () => {
      deleteRoomChatMessage(msg.id);
    };
  }

  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
}
