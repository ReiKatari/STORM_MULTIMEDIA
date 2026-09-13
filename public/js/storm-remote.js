/* ==========================================================================
   STORM MULTIMEDIA - STORM REMOTE ХОСТ (ПРИЕМ КОМАНД С ТЕЛЕФОНА)
   Генерация QR-кода и удаленное управление воспроизведением и поиском
   ========================================================================== */

import { showToast } from './auth.js';
import { executeSearch } from './app.js';

let remoteSessionId = localStorage.getItem('storm_remote_session') || ('storm_' + Math.random().toString(36).substring(2, 8));
localStorage.setItem('storm_remote_session', remoteSessionId);

export function getRemoteSessionId() {
  return remoteSessionId;
}

export function openRemoteQrModal() {
  let modal = document.getElementById('storm-remote-modal');
  const remoteUrl = `${window.location.origin}/remote.html?session=${encodeURIComponent(remoteSessionId)}`;
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(remoteUrl)}&color=00d2ff&bgcolor=0e1117`;

  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'storm-modal-backdrop';
    modal.id = 'storm-remote-modal';
    modal.innerHTML = `
      <div class="storm-modal" style="max-width: 440px; text-align: center;">
        <div class="storm-modal-header" style="justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 20px;">📱</span>
            <h3 style="margin: 0;">STORM REMOTE (Пульт со смартфона)</h3>
          </div>
          <button type="button" class="storm-modal-close" id="remote-modal-close-btn">✕</button>
        </div>
        <div class="storm-modal-body" style="display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 20px;">
          <p style="font-size: 13px; color: var(--text-secondary); margin: 0;">
            Отсканируйте QR-код камерой смартфона для управления плеером, навигацией и голосовым вводом:
          </p>
          <div style="padding: 12px; background: #0e1117; border-radius: 16px; border: 2px solid rgba(0, 210, 255, 0.4); box-shadow: 0 0 25px rgba(0, 210, 255, 0.2);">
            <img src="${qrApiUrl}" alt="QR-код пульта" style="width: 200px; height: 200px; border-radius: 8px; display: block;">
          </div>
          <div style="font-size: 11px; color: var(--text-muted); word-break: break-all; max-width: 320px;">
            Сессия: <b style="color: var(--accent);">${remoteSessionId}</b>
          </div>
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="copy-remote-link-btn">
            📋 Скопировать ссылку
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const closeBtn = modal.querySelector('#remote-modal-close-btn');
    if (closeBtn) closeBtn.onclick = () => modal.classList.remove('is-open');
    modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('is-open'); };

    const copyBtn = modal.querySelector('#copy-remote-link-btn');
    if (copyBtn) {
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(remoteUrl);
        showToast('Ссылка на пульт скопирована', 'success');
      };
    }
  }

  modal.classList.add('is-open');
}

export function handleIncomingRemoteAction(data) {
  if (!data || !data.action) return;

  const video = document.getElementById('storm-video-player');

  switch (data.action) {
    case 'up':
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      break;
    case 'down':
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      break;
    case 'left':
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      break;
    case 'right':
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      break;
    case 'enter':
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      break;
    case 'back':
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      break;
    case 'home':
      document.querySelector('.storm-tab-btn[data-tab="home"]')?.click();
      break;
    case 'play_pause':
      if (video) {
        if (video.paused) video.play(); else video.pause();
        showToast(video.paused ? '⏸️ Пауза' : '▶ Воспроизведение', 'info');
      }
      break;
    case 'seek_back':
      if (video) {
        video.currentTime = Math.max(0, video.currentTime - 10);
        showToast('⏪ -10 сек', 'info');
      }
      break;
    case 'seek_forward':
      if (video) {
        video.currentTime = Math.min(video.duration || 99999, video.currentTime + 10);
        showToast('⏩ +10 сек', 'info');
      }
      break;
    case 'mute':
      if (video) {
        video.muted = !video.muted;
        showToast(video.muted ? '🔇 Звук выключен' : '🔊 Звук включен', 'info');
      }
      break;
    case 'search':
      if (data.query) {
        const input = document.getElementById('global-search-input');
        if (input) input.value = data.query;
        executeSearch(data.query);
        showToast(`🔍 Удаленный поиск: ${data.query}`, 'info');
      }
      break;
  }
}
