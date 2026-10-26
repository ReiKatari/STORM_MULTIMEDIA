// ==========================================
// WATCH TOGETHER 2.0 & GRACEFUL WS HANDLER (????? 2.2, 6.1, 6.10)
// ==========================================

export function handleWatchTogether2SocketEvent({ ws, data, currentRoomCode, currentUser, watchRooms }) {
  if (!currentRoomCode || !data) return false;
  const room = watchRooms.get(currentRoomCode);
  if (!room) return false;

  switch (data.type) {
    case 'buffer_status': {
      if (currentUser) {
        currentUser.isBuffering = Boolean(data.isBuffering);
        currentUser.bufferPercent = Number(data.bufferPercent) || 0;
      }
      const anyBuffering = Array.from(room.participants.values()).some(p => p.isBuffering);
      const statusMsg = JSON.stringify({
        type: 'room_buffer_sync',
        userId: currentUser?.id,
        username: currentUser?.username || '???????',
        isBuffering: Boolean(data.isBuffering),
        anyBuffering,
        participants: Array.from(room.participants.values())
      });
      for (const [client] of room.participants) {
        if (client.readyState === 1) {
          client.send(statusMsg);
        }
      }
      return true;
    }

    case 'floating_reaction': {
      const reactMsg = JSON.stringify({
        type: 'floating_reaction',
        emoji: String(data.emoji || '??').slice(0, 8),
        x: Math.min(Math.max(Number(data.x) || 50, 5), 95),
        user: currentUser?.username || data.user || '???????',
        timestamp: Date.now()
      });
      for (const [client] of room.participants) {
        if (client.readyState === 1) {
          client.send(reactMsg);
        }
      }
      return true;
    }

    case 'overlay_chat': {
      const text = String(data.text || '').trim().slice(0, 500);
      if (!text) return true;
      const chatObj = {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        userId: currentUser?.id || 'guest',
        username: currentUser?.username || '???????',
        avatar: currentUser?.avatar || null,
        text,
        time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
        overlay: true
      };
      room.messages.push(chatObj);
      if (room.messages.length > 100) room.messages.shift();
      const payload = JSON.stringify({
        type: 'chat_message',
        message: chatObj,
        overlay: true
      });
      for (const [client] of room.participants) {
        if (client.readyState === 1) {
          client.send(payload);
        }
      }
      return true;
    }

    default:
      return false;
  }
}

export function notifyAllSocketsServerRestarting(wss) {
  if (!wss || !wss.clients) return;
  const msg = JSON.stringify({
    type: 'server_restarting',
    message: '?????? ???????????, ??????????????? ????? 2 ???????...',
    timestamp: Date.now()
  });
  for (const client of wss.clients) {
    try {
      if (client.readyState === 1) {
        client.send(msg);
      }
      client.close(1012, 'Server Restarting');
    } catch (_) {}
  }
}
