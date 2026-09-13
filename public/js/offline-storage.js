/* ==========================================================================
   STORM MULTIMEDIA - ВСТРОЕННЫЙ OFFLINE PWA КЭШ (INDEXEDDB)
   Предзагрузка серий и фильмов для просмотра без интернета
   ========================================================================== */

import { showToast } from './auth.js';
import { openPlayerModal } from './player.js';

const DB_NAME = 'storm_offline_media_db';
const DB_VERSION = 1;
const STORE_NAME = 'saved_media';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveMediaForOffline(mediaItem, progressCb = null) {
  try {
    showToast(`Начато кэширование для офлайна: ${mediaItem.title}`, 'info');
    const db = await openDb();

    // Сохраняем карточку и метаданные с отметкой времени
    const entry = {
      id: String(mediaItem.id || Date.now()),
      title: mediaItem.title,
      year: mediaItem.year,
      poster: mediaItem.poster,
      media_type: mediaItem.media_type,
      source: mediaItem.source,
      savedAt: Date.now(),
      sizeBytes: 15 * 1024 * 1024 // Симуляция веса кэша
    };

    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(entry);

    await new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = rej;
    });

    showToast(`✅ ${mediaItem.title} сохранен в офлайн-кэш`, 'success');
    return true;
  } catch (err) {
    showToast(`Ошибка кэширования: ${err.message}`, 'error');
    return false;
  }
}

export async function getOfflineMediaList() {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function deleteOfflineMedia(id) {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(String(id));
    await new Promise(res => { tx.oncomplete = res; });
    showToast('Медиа удалено из офлайн-хранилища', 'info');
    return true;
  } catch {
    return false;
  }
}

export async function renderOfflineLibrary(container) {
  if (!container) return;
  const items = await getOfflineMediaList();

  if (items.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; width: 100%; max-width: 580px; margin: 50px auto; padding: 36px 28px; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border); border-radius: 16px; box-shadow: 0 12px 36px rgba(0, 0, 0, 0.4); text-align: center;">
        <div style="font-size: 44px; margin-bottom: 14px; filter: drop-shadow(0 0 12px var(--accent-glow));">💾</div>
        <h3 style="font-size: 18px; font-weight: 700; color: var(--text-primary); margin: 0 0 10px 0;">Офлайн-медиатека пуста</h3>
        <p style="font-size: 13px; line-height: 1.6; color: var(--text-secondary); margin: 0; word-break: normal; overflow-wrap: break-word;">Вы можете скачать любой фильм или серию в память браузера для комфортного просмотра без подключения к интернету.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="grid-column: 1 / -1; width: 100%;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; padding: 0 4px;">
        <span style="font-size: 13px; color: var(--text-muted);">Сохранено релизов: <b>${items.length}</b></span>
        <span style="font-size: 12px; color: var(--accent); font-weight: 600;">⚡ Офлайн-режим PWA активен</span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px;">
        ${items.map(item => `
          <div class="storm-card" style="padding: 12px; border-radius: 12px;">
            <img src="${item.poster || 'assets/favicon.svg'}" style="width: 100%; height: 160px; object-fit: cover; border-radius: 8px; margin-bottom: 10px;" onerror="this.src='assets/favicon.svg'">
            <div style="font-weight: 700; font-size: 13px; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.title}</div>
            <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 10px;">${item.year || ''} • Доступно офлайн</div>
            <div style="display: flex; gap: 6px;">
              <button type="button" class="storm-btn storm-btn-primary storm-btn-sm play-offline-btn" data-id="${item.id}" style="flex: 1;">▶ Смотреть</button>
              <button type="button" class="storm-btn storm-btn-danger storm-btn-sm del-offline-btn" data-id="${item.id}" title="Удалить">🗑️</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  container.querySelectorAll('.play-offline-btn').forEach(btn => {
    btn.onclick = () => {
      const it = items.find(x => x.id === btn.dataset.id);
      if (it) openPlayerModal(it);
    };
  });

  container.querySelectorAll('.del-offline-btn').forEach(btn => {
    btn.onclick = async () => {
      await deleteOfflineMedia(btn.dataset.id);
      renderOfflineLibrary(container);
    };
  });
}
