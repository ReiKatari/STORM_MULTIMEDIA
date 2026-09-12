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

export function sendRoomChatMessage(text) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !currentRoom) return;
  const clean = text.trim();
  if (!clean) return;

  ws.send(JSON.stringify({
    type: 'chat_message',
    roomCode: currentRoom.code,
    text: clean
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

export function renderRoomUi(room) {
  const container = document.getElementById('watch-together-sidebar');
  if (!container) return;

  if (!room) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'flex';
  container.innerHTML = `
    <div class="watch-room-header">
      <div>
        <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--accent); font-weight: 800;">Кинокомната</div>
        <div style="font-size: 16px; font-weight: 800;">Код: <span id="room-code-display" style="color: var(--accent); cursor: pointer;" title="Нажмите, чтобы скопировать">${room.code}</span></div>
      </div>
      <div id="room-sync-badge" class="room-sync-badge synced">🟢 Синхронизировано</div>
      <button type="button" class="storm-btn storm-btn-danger storm-btn-sm" id="leave-room-btn" title="Выйти из комнаты">✕ Выйти</button>
    </div>

    <!-- Участники просмотра -->
    <div class="watch-room-participants" id="watch-room-participants">
      <!-- Заполняется динамически -->
    </div>

    <!-- Кибер-чат -->
    <div class="watch-room-chat-messages" id="watch-room-chat-messages">
      <!-- Сообщения чата -->
    </div>

    <!-- Поле ввода сообщения -->
    <form class="watch-room-chat-form" id="watch-room-chat-form">
      <input type="text" class="storm-input" id="watch-chat-input" placeholder="Написать в кинозал..." autocomplete="off">
      <button type="submit" class="storm-btn storm-btn-primary storm-btn-sm">➤</button>
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

  // Выход
  const leaveBtn = container.querySelector('#leave-room-btn');
  if (leaveBtn) {
    leaveBtn.onclick = leaveWatchRoom;
  }

  // Отправка сообщений
  const chatForm = container.querySelector('#watch-room-chat-form');
  const chatInput = container.querySelector('#watch-chat-input');
  if (chatForm && chatInput) {
    chatForm.onsubmit = (e) => {
      e.preventDefault();
      sendRoomChatMessage(chatInput.value);
      chatInput.value = '';
    };
  }

  renderParticipants(room.participants);
  renderAllChatMessages(room.messages);
}

function renderParticipants(participants) {
  const container = document.getElementById('watch-room-participants');
  if (!container) return;

  container.innerHTML = `
    <div style="font-size: 11px; font-weight: 700; color: var(--text-muted); margin-bottom: 6px;">Зрители в зале (${participants.length}):</div>
    <div class="participants-avatars-row">
      ${participants.map(p => `
        <div class="participant-badge" title="${p.username} ${p.isHost ? '(Хост)' : ''}">
          <img src="${p.avatar || 'assets/favicon.svg'}" alt="${p.username}">
          <span>${p.username}</span>
          ${p.isHost ? '<span class="host-crown">👑</span>' : ''}
        </div>
      `).join('')}
    </div>
  `;
}

function renderAllChatMessages(messages) {
  const container = document.getElementById('watch-room-chat-messages');
  if (!container) return;
  container.innerHTML = '';
  messages.forEach(appendChatMessage);
}

function appendChatMessage(msg) {
  const container = document.getElementById('watch-room-chat-messages');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'watch-chat-msg';
  row.innerHTML = `
    <span class="chat-msg-time">${msg.time}</span>
    <span class="chat-msg-author">${msg.username}:</span>
    <span class="chat-msg-text">${msg.text}</span>
  `;
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
}
