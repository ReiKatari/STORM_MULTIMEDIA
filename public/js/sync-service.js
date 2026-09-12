/* ==========================================================================
   STORM MULTIMEDIA - СИНХРОНИЗАЦИЯ (SHIKIMORI, MYANIMELIST, КИНОПОИСК И БЭКАП)
   Двусторонний обмен списками, импорт/экспорт и сохранение библиотеки
   ========================================================================== */

import { showToast, getUser } from './auth.js';
import { trackClientAction } from './achievements.js';

export async function syncWithShikimori(username) {
  const user = getUser();
  if (!user) {
    showToast('Войдите в аккаунт для синхронизации', 'warning');
    return;
  }

  const clean = username.trim();
  if (!clean) {
    showToast('Введите ваш никнейм на Shikimori', 'warning');
    return;
  }

  try {
    const token = localStorage.getItem('storm_token');
    const res = await fetch('/api/sync/shikimori', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ username: clean })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Ошибка синхронизации с Shikimori');
    }

    const data = await res.json();
    showToast(`Синхронизировано из Shikimori: ${data.count} тайтлов!`, 'success');
    trackClientAction('sync_data');
    return data;
  } catch (err) {
    showToast(err.message, 'error');
    return null;
  }
}

export async function exportUniversalBackup() {
  const user = getUser();
  if (!user) {
    showToast('Войдите в аккаунт для создания резервной копии', 'warning');
    return;
  }

  try {
    const token = localStorage.getItem('storm_token');
    const res = await fetch('/api/sync/export', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) throw new Error('Не удалось экспортировать данные');
    const data = await res.json();

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `storm_multimedia_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);

    showToast('Резервная копия успешно сохранена на устройство!', 'success');
    trackClientAction('sync_data');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

export async function importUniversalBackup(file) {
  const user = getUser();
  if (!user) {
    showToast('Войдите в аккаунт для восстановления', 'warning');
    return;
  }

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    const token = localStorage.getItem('storm_token');
    const res = await fetch('/api/sync/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(data)
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Ошибка восстановления из копии');
    }

    const result = await res.json();
    showToast(`Импорт завершен: восстановлено ${result.imported_count} элементов!`, 'success');
    trackClientAction('sync_data');
    setTimeout(() => window.location.reload(), 1500);
  } catch (err) {
    showToast(`Ошибка импорта: ${err.message}`, 'error');
  }
}

export function renderSyncModalContent(containerElement) {
  if (!containerElement) return;

  containerElement.innerHTML = `
    <div class="sync-modal-wrapper">
      <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 20px;">
        Синхронизируйте свои списки просмотра, закладки и рейтинги с популярными платформами или создайте полную автономную резервную копию библиотеки.
      </p>

      <!-- 1. Shikimori -->
      <div class="sync-card">
        <div class="sync-card-header">
          <span style="font-size: 24px;">🌸</span>
          <div>
            <h4 style="margin: 0; font-size: 15px; font-weight: 800;">Синхронизация с Shikimori</h4>
            <span style="font-size: 11px; color: var(--text-muted);">Импорт всех списков просмотра и оценок</span>
          </div>
        </div>
        <div style="display: flex; gap: 8px; margin-top: 12px;">
          <input type="text" class="storm-input" id="shikimori-username-input" placeholder="Ваш никнейм на Shikimori">
          <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="shikimori-sync-btn">Синхронизировать</button>
        </div>
      </div>

      <!-- 2. MyAnimeList и Кинопоиск -->
      <div class="sync-card" style="margin-top: 14px;">
        <div class="sync-card-header">
          <span style="font-size: 24px;">📁</span>
          <div>
            <h4 style="margin: 0; font-size: 15px; font-weight: 800;">Импорт файлов MyAnimeList и Кинопоиск</h4>
            <span style="font-size: 11px; color: var(--text-muted);">Загрузка экспортированных списков (.xml, .json, .csv)</span>
          </div>
        </div>
        <div style="margin-top: 12px;">
          <label class="storm-btn storm-btn-secondary storm-btn-sm" style="cursor: pointer;">
            📥 Выбрать файл со списками
            <input type="file" id="external-lists-file" accept=".xml,.json,.csv" style="display: none;">
          </label>
        </div>
      </div>

      <!-- 3. Полный бэкап STORM MULTIMEDIA -->
      <div class="sync-card" style="margin-top: 14px; border: 1px solid var(--accent-subtle);">
        <div class="sync-card-header">
          <span style="font-size: 24px;">💾</span>
          <div>
            <h4 style="margin: 0; font-size: 15px; font-weight: 800;">Резервная копия STORM MULTIMEDIA</h4>
            <span style="font-size: 11px; color: var(--text-muted);">Полный экспорт и восстановление закладок, истории и достижений в 1 клик</span>
          </div>
        </div>
        <div style="display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap;">
          <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="export-backup-btn">📤 Экспорт всей библиотеки (.json)</button>
          <label class="storm-btn storm-btn-secondary storm-btn-sm" style="cursor: pointer; margin: 0;">
            📥 Восстановить из .json
            <input type="file" id="import-backup-file" accept=".json" style="display: none;">
          </label>
        </div>
      </div>
    </div>
  `;

  // Обработчик Shikimori
  const shikiBtn = containerElement.querySelector('#shikimori-sync-btn');
  const shikiInput = containerElement.querySelector('#shikimori-username-input');
  if (shikiBtn && shikiInput) {
    shikiBtn.onclick = () => syncWithShikimori(shikiInput.value);
  }

  // Обработчик Экспорта
  const exportBtn = containerElement.querySelector('#export-backup-btn');
  if (exportBtn) {
    exportBtn.onclick = exportUniversalBackup;
  }

  // Обработчик Импорта
  const importInput = containerElement.querySelector('#import-backup-file');
  if (importInput) {
    importInput.onchange = (e) => {
      if (e.target.files && e.target.files[0]) {
        importUniversalBackup(e.target.files[0]);
      }
    };
  }
}
