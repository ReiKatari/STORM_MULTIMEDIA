/* ==========================================================================
   STORM MULTIMEDIA - STORM REMOTE 2.0 ХОСТ (ПРИЕМ КОМАНД С ТЕЛЕФОНА)
   Генерация QR-кода (с автоопределением LAN IP) и управление ТВ/плеером
   ========================================================================== */

import { showToast } from './auth.js?v=1.1.0';

let remoteSessionId = localStorage.getItem('storm_remote_session') || ('storm_' + Math.random().toString(36).substring(2, 8));
localStorage.setItem('storm_remote_session', remoteSessionId);

let hostWs = null;
let isRemotePhoneConnected = false;
let resolvedBaseOrigin = window.location.origin;

export function getRemoteSessionId() {
  return remoteSessionId;
}

export function initRemoteHost() {
  if (typeof window === 'undefined' || window.location.protocol === 'file:') return;
  if (hostWs && (hostWs.readyState === WebSocket.OPEN || hostWs.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    hostWs = new WebSocket(`${proto}//${window.location.host}/ws/rooms?code=${encodeURIComponent(remoteSessionId)}&role=host`);

    hostWs.onopen = () => {
      try {
        hostWs.send(JSON.stringify({
          type: 'join_remote_session',
          session: remoteSessionId,
          role: 'host'
        }));
      } catch (_) {}
    };

    hostWs.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'remote_connected') {
          isRemotePhoneConnected = true;
          updateRemoteModalStatus(true);
          showToast('📱 Смартфон подключен как пульт управления', 'success');
        } else if (data.type === 'storm_remote_action') {
          isRemotePhoneConnected = true;
          updateRemoteModalStatus(true);
          handleIncomingRemoteAction(data);
        }
      } catch (_) {}
    };

    hostWs.onclose = () => {
      const modal = document.getElementById('storm-remote-modal');
      if (isRemotePhoneConnected || (modal && modal.classList.contains('is-open'))) {
        setTimeout(initRemoteHost, 3500);
      }
    };
  } catch (_) {}
}

function updateRemoteModalStatus(connected) {
  const statusEl = document.getElementById('remote-host-status-badge');
  if (!statusEl) return;
  if (connected) {
    statusEl.innerHTML = '🟢 Смартфон подключен и готов к управлению';
    statusEl.style.background = 'rgba(0, 255, 102, 0.14)';
    statusEl.style.color = '#00ff66';
    statusEl.style.borderColor = 'rgba(0, 255, 102, 0.35)';
  } else {
    statusEl.innerHTML = '📡 Ожидание сканирования QR-кода...';
    statusEl.style.background = 'rgba(0, 210, 255, 0.12)';
    statusEl.style.color = 'var(--accent-primary, #00d2ff)';
    statusEl.style.borderColor = 'rgba(0, 210, 255, 0.3)';
  }
}

export async function openRemoteQrModal() {
  initRemoteHost();

  try {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      const r = await fetch('/api/remote/info', { signal: AbortSignal.timeout(2000) });
      if (r.ok) {
        const info = await r.json();
        if (info && info.baseUrl) {
          resolvedBaseOrigin = info.baseUrl;
        }
      }
    } else {
      resolvedBaseOrigin = window.location.origin;
    }
  } catch (_) {}

  const remoteUrl = `${resolvedBaseOrigin}/remote.html?session=${encodeURIComponent(remoteSessionId)}`;
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(remoteUrl)}&color=00d2ff&bgcolor=0e1117`;

  let modal = document.getElementById('storm-remote-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'storm-modal-backdrop';
    modal.id = 'storm-remote-modal';
    document.body.appendChild(modal);
    modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('is-open'); };
  }

  modal.innerHTML = `
    <div class="storm-modal" style="max-width: 460px; text-align: center;">
      <div class="storm-modal-header" style="justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 20px;">📱</span>
          <h3 style="margin: 0; font-size: 16px;">Мобильный пульт (STORM Remote 2.0)</h3>
        </div>
        <button type="button" class="storm-modal-close" id="remote-modal-close-btn">✕</button>
      </div>
      <div class="storm-modal-body" style="display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 20px;">
        <div id="remote-host-status-badge" style="font-size: 12px; font-weight: 700; padding: 6px 14px; border-radius: 999px; border: 1px solid rgba(0, 210, 255, 0.3); background: rgba(0, 210, 255, 0.12); color: var(--accent-primary, #00d2ff);">
          ${isRemotePhoneConnected ? '🟢 Смартфон подключен и готов к управлению' : '📡 Ожидание сканирования QR-кода...'}
        </div>
        <p style="font-size: 13px; color: var(--text-secondary); margin: 0; line-height: 1.45;">
          Отсканируйте QR-код камерой смартфона для управления ТВ-интерфейсом, переключением серий, громкостью и голосовым поиском:
        </p>
        <div style="padding: 14px; background: #0e1117; border-radius: 18px; border: 2px solid rgba(0, 210, 255, 0.45); box-shadow: 0 0 28px rgba(0, 210, 255, 0.22);">
          <img src="${qrApiUrl}" alt="QR-код пульта" style="width: 200px; height: 200px; border-radius: 8px; display: block;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
          <div style="display: none; width: 200px; height: 200px; align-items: center; justify-content: center; flex-direction: column; gap: 8px; color: #00d2ff; font-size: 12px; padding: 10px;">
            <span style="font-size: 36px;">📱</span>
            <span>Откройте ссылку на телефоне:</span>
            <b style="word-break: break-all; color: #fff;">${remoteUrl}</b>
          </div>
        </div>
        <div style="font-size: 11.5px; color: var(--text-muted); word-break: break-all; max-width: 380px; background: rgba(255,255,255,0.04); padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border-subtle);">
          Адрес пульта: <b style="color: var(--text-primary);">${remoteUrl}</b>
        </div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap; justify-content: center;">
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="copy-remote-link-btn">
            📋 Скопировать ссылку
          </button>
          <a href="${remoteUrl}" target="_blank" rel="noopener" class="storm-btn storm-btn-primary storm-btn-sm" style="text-decoration: none;">
            🚀 Открыть веб-пульт
          </a>
        </div>
      </div>
    </div>
  `;

  updateRemoteModalStatus(isRemotePhoneConnected);

  const closeBtn = modal.querySelector('#remote-modal-close-btn');
  if (closeBtn) closeBtn.onclick = () => modal.classList.remove('is-open');

  const copyBtn = modal.querySelector('#copy-remote-link-btn');
  if (copyBtn) {
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(remoteUrl);
      showToast('Ссылка на пульт скопирована', 'success');
    };
  }

  modal.classList.add('is-open');
}

export function handleIncomingRemoteAction(data) {
  if (!data || !data.action) return;

  const video = document.getElementById('storm-video-player') || document.querySelector('#cinema-player-wrapper video');
  const iframe = document.querySelector('#cinema-player-wrapper iframe');

  switch (data.action) {
    case 'up':
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', code: 'ArrowUp', bubbles: true }));
      break;
    case 'down':
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
      break;
    case 'left':
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', code: 'ArrowLeft', bubbles: true }));
      break;
    case 'right':
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }));
      break;
    case 'enter': {
      const focused = document.querySelector('.tv-focused') || document.activeElement;
      if (focused && focused !== document.body && typeof focused.click === 'function') {
        focused.click();
      } else {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      }
      break;
    }
    case 'back':
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      break;
    case 'home':
      document.getElementById('storm-remote-modal')?.classList.remove('is-open');
      document.getElementById('cinema-modal')?.classList.remove('is-open');
      document.querySelector('.storm-tab-btn[data-tab="home"]')?.click();
      showToast('🏠 Переход на главную страницу', 'info');
      break;
    case 'play_pause':
      if (video) {
        if (video.paused) video.play().catch(() => {}); else video.pause();
        showToast(video.paused ? '⏸️ Пауза' : '▶ Воспроизведение', 'info');
      } else if (iframe && iframe.contentWindow) {
        try {
          iframe.contentWindow.postMessage({ key: 'kodik_player_api', value: { method: 'play_pause' } }, '*');
          iframe.contentWindow.postMessage(JSON.stringify({ method: 'play_pause' }), '*');
        } catch (_) {}
        showToast('⏯ Переключение воспроизведения', 'info');
      }
      break;
    case 'seek_back':
      if (video) {
        video.currentTime = Math.max(0, video.currentTime - 10);
        showToast('⏪ -10 сек', 'info');
      } else {
        document.getElementById('jog-step-back10')?.click();
        showToast('⏪ -10 сек', 'info');
      }
      break;
    case 'seek_forward':
      if (video) {
        video.currentTime = Math.min(video.duration || 99999, video.currentTime + 10);
        showToast('⏩ +10 сек', 'info');
      } else {
        document.getElementById('jog-step-fwd10')?.click();
        showToast('⏩ +10 сек', 'info');
      }
      break;
    case 'next_ep':
      import('./player.js?v=1.1.0').then(m => {
        if (m.playInPlayerNextEpisode) m.playInPlayerNextEpisode();
      }).catch(() => {});
      break;
    case 'prev_ep':
      import('./player.js?v=1.1.0').then(m => {
        if (m.playInPlayerPrevEpisode) m.playInPlayerPrevEpisode();
      }).catch(() => {});
      break;
    case 'cycle_player': {
      const sourcePills = Array.from(document.querySelectorAll('#player-sources-list .player-source-pill, #player-sources-list .source-btn'));
      if (sourcePills.length > 1) {
        const curIdx = sourcePills.findIndex(p => p.classList.contains('active'));
        const nextPill = sourcePills[(curIdx + 1) % sourcePills.length];
        if (nextPill) nextPill.click();
      }
      break;
    }
    case 'toggle_tv_mode':
      import('./gamepad-tv.js?v=1.1.0').then(m => {
        if (m.toggleTvMode) m.toggleTvMode();
      }).catch(() => {});
      break;
    case 'mute':
      if (video) {
        video.muted = !video.muted;
        showToast(video.muted ? '🔇 Звук выключен' : '🔊 Звук включен', 'info');
      } else if (iframe && iframe.contentWindow) {
        try {
          iframe.contentWindow.postMessage({ key: 'kodik_player_api', value: { method: 'mute' } }, '*');
        } catch (_) {}
        showToast('🔇 Переключение звука', 'info');
      }
      break;
    case 'volume':
      if (data.level !== undefined) {
        const vol = Math.max(0, Math.min(1, parseFloat(data.level) / 100));
        if (video) {
          video.volume = vol;
          video.muted = vol === 0;
        } else if (iframe && iframe.contentWindow) {
          try {
            iframe.contentWindow.postMessage({ key: 'kodik_player_api', value: { method: 'volume', volume: vol } }, '*');
          } catch (_) {}
        }
        showToast(`🔊 Громкость: ${data.level}%`, 'info');
      }
      break;
    case 'toggle_ambilight':
      (document.getElementById('studio-tab-ambilight') || document.getElementById('toggle-ambilight-btn'))?.click();
      break;
    case 'toggle_fullscreen':
      try {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen().catch(() => {});
        }
      } catch {}
      break;
    case 'search':
      if (data.query) {
        document.getElementById('storm-remote-modal')?.classList.remove('is-open');
        const input = document.getElementById('global-search-input');
        if (input) input.value = data.query;
        if (typeof window.executeSearch === 'function') {
          window.executeSearch(data.query);
        }
        showToast(`🔍 Удаленный поиск: ${data.query}`, 'info');
      }
      break;
  }
}

// Хост пульта инициализируется по запросу при открытии QR-окна (openRemoteQrModal)
