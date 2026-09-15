/* ==========================================================================
   STORM MULTIMEDIA - TORRSERVER И ACESTREAM ИНТЕГРАЦИЯ
   Прямое воспроизведение раздач и торрентов через локальные движки
   ========================================================================== */

import { showToast } from './auth.js';

let torrentEnginesConfig = {
  torrServerUrl: 'http://127.0.0.1:8090',
  aceStreamUrl: 'http://127.0.0.1:6878',
  preferredEngine: 'torrserver'
};

try {
  const saved = localStorage.getItem('storm_torrent_engines');
  if (saved) torrentEnginesConfig = { ...torrentEnginesConfig, ...JSON.parse(saved) };
} catch {}

export function getTorrentEnginesConfig() {
  return torrentEnginesConfig;
}

export function saveTorrentEnginesConfig(cfg) {
  torrentEnginesConfig = { ...torrentEnginesConfig, ...cfg };
  localStorage.setItem('storm_torrent_engines', JSON.stringify(torrentEnginesConfig));
}

export async function checkEngineHealth(engine = 'torrserver') {
  const url = engine === 'torrserver' ? `${torrentEnginesConfig.torrServerUrl}/echo` : `${torrentEnginesConfig.aceStreamUrl}/version`;
  try {
    const res = await fetch(url, { method: 'GET', mode: 'no-cors' });
    return true;
  } catch {
    return false;
  }
}

export function getTorrServerStreamUrl(magnetOrHash, fileIndex = 1) {
  const base = torrentEnginesConfig.torrServerUrl.replace(/\/$/, '');
  const encoded = encodeURIComponent(magnetOrHash);
  return `${base}/stream?link=${encoded}&index=${fileIndex}&play`;
}

export function getAceStreamUrl(contentId) {
  const base = torrentEnginesConfig.aceStreamUrl.replace(/\/$/, '');
  return `${base}/ace/manifest.m3u8?id=${encodeURIComponent(contentId)}`;
}

export function renderTorrServerSettings(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="torrserver-panel" style="padding: 12px; background: var(--bg-tertiary); border: 1px solid var(--border-subtle); border-radius: 10px;">
      <div style="font-weight: 700; font-size: 13px; margin-bottom: 8px; color: var(--accent); display: flex; align-items: center; gap: 6px;">
        <span>🧲</span>
        <span>Локальные торрент-движки (TorrServer и AceStream)</span>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
        <div>
          <label style="font-size: 11px; color: var(--text-muted); display: block; margin-bottom: 4px;">TorrServer URL (порт 8090)</label>
          <input type="text" class="storm-input" id="torrserver-url-input" value="${torrentEnginesConfig.torrServerUrl}" style="width: 100%; font-size: 12px; padding: 6px;">
        </div>
        <div>
          <label style="font-size: 11px; color: var(--text-muted); display: block; margin-bottom: 4px;">AceStream Engine URL (порт 6878)</label>
          <input type="text" class="storm-input" id="acestream-url-input" value="${torrentEnginesConfig.aceStreamUrl}" style="width: 100%; font-size: 12px; padding: 6px;">
        </div>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 11px; color: var(--text-muted);">Позволяет смотреть 4K HDR раздачи без ожидания загрузки на диск</span>
        <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="save-torrent-engines-btn">Сохранить</button>
      </div>
    </div>
  `;

  const saveBtn = container.querySelector('#save-torrent-engines-btn');
  if (saveBtn) {
    saveBtn.onclick = () => {
      const torr = container.querySelector('#torrserver-url-input').value.trim();
      const ace = container.querySelector('#acestream-url-input').value.trim();
      saveTorrentEnginesConfig({ torrServerUrl: torr, aceStreamUrl: ace });
      showToast('Настройки торрент-движков обновлены', 'success');
    };
  }
}
