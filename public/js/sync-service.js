/**
 * Модуль синхронизации, импорта/экспорта списков (Shikimori / MyAnimeList / Кинопоиск / IMDb),
 * аналитики «Кино-итоги STORM Rewind» и сканера локальной медиатеки (ПК / NAS)
 */

import { showToast, getUser, getToken } from './auth.js?v=1.2.5';

function getAuthHeaders() {
  const token = (typeof getToken === 'function' ? getToken() : '') || localStorage.getItem('storm_token') || localStorage.getItem('storm_auth_token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export async function openSyncModal() {
  const modal = document.getElementById('sync-modal');
  const body = document.getElementById('sync-modal-body');
  if (!modal || !body) return;
  modal.classList.add('is-open');
  return renderSyncModalContent(body);
}

export async function renderSyncModalContent(body = document.getElementById('sync-modal-body')) {
  if (!body) return;

  if (!getUser()) {
    body.innerHTML = `
      <div style="text-align: center; padding: 30px; color: var(--text-muted);">
        <p>Пожалуйста, войдите в аккаунт для управления синхронизацией, резервными копиями и кино-итогами.</p>
      </div>
    `;
    return;
  }

  body.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 18px;">
      <!-- Навигация по разделам центра синхронизации и медиатеки -->
      <div style="display: flex; gap: 8px; flex-wrap: wrap; border-bottom: 1px solid var(--border-subtle); padding-bottom: 10px;">
        <button type="button" class="storm-btn storm-btn-primary storm-btn-sm sync-tab-switch" data-sync-tab="backup">
          💾 Бэкап и Импорт списков
        </button>
        <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm sync-tab-switch" data-sync-tab="rewind">
          📊 Кино-итоги STORM Rewind
        </button>
        <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm sync-tab-switch" data-sync-tab="local">
          📂 Локальная медиатека (ПК и NAS)
        </button>
      </div>

      <!-- ВКЛАДКА 1: БЭКАП И ИМПОРТ/ЭКСПОРТ -->
      <div id="sync-pane-backup" style="display: flex; flex-direction: column; gap: 16px;">
        <!-- 1. Экспорт данных (JSON / CSV / MyAnimeList XML) -->
        <div style="background: var(--bg-tertiary); padding: 16px; border-radius: var(--radius-md); border: 1px solid var(--border-color);">
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
            <span style="font-size: 22px;">💾</span>
            <div>
              <h4 style="margin: 0; font-size: 15px;">Экспорт ваших списков и резервная копия</h4>
              <p style="margin: 2px 0 0; font-size: 12px; color: var(--text-muted);">
                Выгрузите все ваши закладки, прогресс просмотра, оценки и коллекции в универсальных форматах
              </p>
            </div>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button class="storm-btn storm-btn-primary storm-btn-sm" id="export-backup-btn">
              ⬇️ Полный бэкап (.json)
            </button>
            <button class="storm-btn storm-btn-secondary storm-btn-sm" id="export-csv-btn">
              📊 Таблица Кинопоиск / Excel (.csv)
            </button>
            <button class="storm-btn storm-btn-secondary storm-btn-sm" id="export-mal-xml-btn">
              ⛩️ Формат MyAnimeList / Shikimori (.xml)
            </button>
          </div>
        </div>

        <!-- 2. Импорт резервной копии STORM JSON -->
        <div style="background: var(--bg-tertiary); padding: 16px; border-radius: var(--radius-md); border: 1px solid var(--border-color);">
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
            <span style="font-size: 22px;">📂</span>
            <div>
              <h4 style="margin: 0; font-size: 15px;">Восстановление из резервной копии STORM (.json)</h4>
              <p style="margin: 2px 0 0; font-size: 12px; color: var(--text-muted);">
                Загрузите ранее сохраненный файл .json для мгновенного восстановления всей библиотеки
              </p>
            </div>
          </div>
          <label class="storm-btn storm-btn-secondary storm-btn-sm" style="cursor: pointer; display: inline-flex;">
            ⬆️ Выбрать файл резервной копии (.json)
            <input type="file" id="import-backup-file" accept=".json" style="display: none;">
          </label>
        </div>

        <!-- 3. Прямая синхронизация с Shikimori.io -->
        <div style="background: var(--bg-tertiary); padding: 16px; border-radius: var(--radius-md); border: 1px solid var(--border-color);">
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
            <span style="font-size: 22px;">⛩️</span>
            <div>
              <h4 style="margin: 0; font-size: 15px;">Прямой импорт аниме-списка из Shikimori</h4>
              <p style="margin: 2px 0 0; font-size: 12px; color: var(--text-muted);">
                Автоматический перенос ваших списков «Смотрю», «Запланировано» и «Просмотрено» по никнейму Shikimori
              </p>
            </div>
          </div>
          <div style="display: flex; gap: 8px;">
            <input type="text" class="storm-input" id="shikimori-username-input" placeholder="Ваш никнейм на Shikimori..." style="flex: 1;">
            <button class="storm-btn storm-btn-primary storm-btn-sm" id="sync-shikimori-btn">
              🔄 Синхронизировать
            </button>
          </div>
        </div>

        <!-- 4. Универсальный импорт из Кинопоиска / IMDb / MyAnimeList -->
        <div style="background: var(--bg-tertiary); padding: 16px; border-radius: var(--radius-md); border: 1px solid var(--border-color);">
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
            <span style="font-size: 22px;">🌐</span>
            <div>
              <h4 style="margin: 0; font-size: 15px;">Импорт списков из MyAnimeList (.xml), Кинопоиска и IMDb (.csv)</h4>
              <p style="margin: 2px 0 0; font-size: 12px; color: var(--text-muted);">
                Поддерживаются файлы экспорта MyAnimeList / Shikimori XML, таблицы оценок Кинопоиска, IMDb и Letterboxd CSV
              </p>
            </div>
          </div>
          <label class="storm-btn storm-btn-primary storm-btn-sm" style="cursor: pointer; display: inline-flex;">
            📥 Загрузить файл списка (.xml, .csv, .json)
            <input type="file" id="external-lists-file" accept=".xml,.json,.csv" style="display: none;">
          </label>
          <div id="external-import-result" style="margin-top: 8px; font-size: 12px; color: #10b981; display: none;"></div>
        </div>
      </div>

      <!-- ВКЛАДКА 2: КИНО-ИТОГИ STORM REWIND -->
      <div id="sync-pane-rewind" style="display: none; flex-direction: column; gap: 14px;">
        <div style="text-align: center; padding: 24px; color: var(--text-muted);">⏳ Подсчет вашей персональной кино-статистики...</div>
      </div>

      <!-- ВКЛАДКА 3: СКАНЕР ЛОКАЛЬНОЙ МЕДИАТЕКИ (ПК И NAS) -->
      <div id="sync-pane-local" style="display: none; flex-direction: column; gap: 14px;">
        <div style="background: var(--bg-tertiary); padding: 16px; border-radius: 12px; border: 1px solid var(--border-color);">
          <div style="font-weight: 800; font-size: 14px; margin-bottom: 4px;">📂 Сканер домашней видеотеки (ПК / NAS / Внешний диск)</div>
          <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">
            Укажите путь к папке с фильмами или сериалами (.mp4, .mkv, .webm, .avi). STORM автоматически распознает названия, загрузит постеры 4K и позволит смотреть их во встроенном плеере с эквалайзером и Ambilight.
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <input type="text" class="storm-input" id="local-folder-path-input" placeholder="Например: D:\Movies или оставьте пустым для папки Видео" style="flex: 1; min-width: 220px;">
            <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="scan-local-folder-btn">
              🔍 Просканировать папку
            </button>
          </div>
        </div>
        <div id="local-library-results" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px;"></div>
      </div>
    </div>
  `;

  // Переключение вкладок
  const tabBtns = body.querySelectorAll('.sync-tab-switch');
  const paneBackup = body.querySelector('#sync-pane-backup');
  const paneRewind = body.querySelector('#sync-pane-rewind');
  const paneLocal = body.querySelector('#sync-pane-local');

  tabBtns.forEach(btn => {
    btn.onclick = () => {
      const target = btn.dataset.syncTab;
      tabBtns.forEach(b => {
        b.classList.toggle('storm-btn-primary', b === btn);
        b.classList.toggle('storm-btn-secondary', b !== btn);
      });
      if (paneBackup) paneBackup.style.display = target === 'backup' ? 'flex' : 'none';
      if (paneRewind) {
        paneRewind.style.display = target === 'rewind' ? 'flex' : 'none';
        if (target === 'rewind') loadStormRewindStats(paneRewind);
      }
      if (paneLocal) {
        paneLocal.style.display = target === 'local' ? 'flex' : 'none';
        if (target === 'local') loadLocalLibraryList(body.querySelector('#local-library-results'));
      }
    };
  });

  // 1. Экспорт JSON / CSV / XML
  document.getElementById('export-backup-btn')?.addEventListener('click', () => exportUserBackup('json'));
  document.getElementById('export-csv-btn')?.addEventListener('click', () => exportUserBackup('csv'));
  document.getElementById('export-mal-xml-btn')?.addEventListener('click', () => exportUserBackup('xml'));

  // 2. Импорт резервной копии JSON
  document.getElementById('import-backup-file')?.addEventListener('change', (e) => {
    if (e.target.files[0]) importUserBackup(e.target.files[0]);
  });

  // 3. Прямая синхронизация Shikimori
  document.getElementById('sync-shikimori-btn')?.addEventListener('click', () => {
    const username = document.getElementById('shikimori-username-input')?.value.trim();
    if (username) syncWithShikimori(username);
    else showToast('Введите ваш никнейм на Shikimori', 'warning');
  });

  // 4. Импорт внешних файлов (.xml, .csv, .json)
  document.getElementById('external-lists-file')?.addEventListener('change', (e) => {
    if (e.target.files[0]) importExternalListFile(e.target.files[0]);
  });

  // 5. Сканер локальной папки
  document.getElementById('scan-local-folder-btn')?.addEventListener('click', async () => {
    const folderPath = document.getElementById('local-folder-path-input')?.value.trim() || '';
    const resContainer = document.getElementById('local-library-results');
    if (resContainer) {
      resContainer.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-muted);">⏳ Сканирование видеофайлов на диске...</div>`;
    }
    try {
      const res = await fetch('/api/local-library/scan', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ folderPath })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка сканирования');
      showToast(`Найдено локальных видеофайлов: ${data.count}`, 'success');
      renderLocalLibraryCards(resContainer, data.items || []);
    } catch (err) {
      if (resContainer) {
        resContainer.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:16px;color:#f87171;">${err.message}</div>`;
      }
    }
  });
}

async function loadStormRewindStats(container) {
  if (!container) return;
  try {
    const res = await fetch('/api/user/rewind-stats', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!data || !data.success) throw new Error('Не удалось загрузить статистику');

    const decadesHtml = Object.entries(data.decades || {}).map(([dec, cnt]) => `
      <div style="background:rgba(255,255,255,0.04);padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.07);display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:12px;color:var(--text-secondary);">${dec}</span>
        <strong style="color:var(--accent);font-size:13px;">${cnt} релизов</strong>
      </div>
    `).join('');

    container.innerHTML = `
      <div style="background: linear-gradient(135deg, rgba(0,210,255,0.14), rgba(168,85,247,0.14)); border: 1px solid var(--accent); border-radius: 14px; padding: 18px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
        <div>
          <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--accent); font-weight: 800;">🏆 Ваш персональный ранг киномана</div>
          <div style="font-size: 20px; font-weight: 900; color: #fff; margin-top: 2px;">${data.cinephileRank}</div>
          <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">Любимый формат: <b>${data.preferredQuality}</b> • Озвучка: <b>${data.favoriteVoiceover}</b></div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 28px; font-weight: 900; color: #10b981;">${data.totalHours} ч</div>
          <div style="font-size: 11px; color: var(--text-muted);">Всего проведено в кинозале</div>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(135px, 1fr)); gap: 10px;">
        <div style="background: var(--bg-tertiary); padding: 12px; border-radius: 10px; border: 1px solid var(--border-color); text-align: center;">
          <div style="font-size: 22px; font-weight: 900; color: #38bdf8;">${data.totalCompleted}</div>
          <div style="font-size: 11px; color: var(--text-muted);">Просмотрено целиком</div>
        </div>
        <div style="background: var(--bg-tertiary); padding: 12px; border-radius: 10px; border: 1px solid var(--border-color); text-align: center;">
          <div style="font-size: 22px; font-weight: 900; color: #a855f7;">${data.totalEpisodes}</div>
          <div style="font-size: 11px; color: var(--text-muted);">Серий просмотрено</div>
        </div>
        <div style="background: var(--bg-tertiary); padding: 12px; border-radius: 10px; border: 1px solid var(--border-color); text-align: center;">
          <div style="font-size: 22px; font-weight: 900; color: #10b981;">${data.totalWatching}</div>
          <div style="font-size: 11px; color: var(--text-muted);">Смотрю сейчас</div>
        </div>
        <div style="background: var(--bg-tertiary); padding: 12px; border-radius: 10px; border: 1px solid var(--border-color); text-align: center;">
          <div style="font-size: 22px; font-weight: 900; color: #f59e0b;">${data.totalPlanned}</div>
          <div style="font-size: 11px; color: var(--text-muted);">В планах</div>
        </div>
      </div>

      <div style="background: var(--bg-tertiary); padding: 14px; border-radius: 12px; border: 1px solid var(--border-color);">
        <div style="font-weight: 800; font-size: 13px; margin-bottom: 10px;">🎭 Любимые жанры</div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${(data.topGenres || []).map(g => `
            <div>
              <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 3px;">
                <span>${g.genre}</span>
                <b>${g.percent}% (${g.count})</b>
              </div>
              <div style="height: 6px; background: rgba(255,255,255,0.08); border-radius: 4px; overflow: hidden;">
                <div style="width: ${g.percent}%; height: 100%; background: linear-gradient(90deg, var(--accent), #a855f7);"></div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <div style="background: var(--bg-tertiary); padding: 14px; border-radius: 12px; border: 1px solid var(--border-color);">
        <div style="font-weight: 800; font-size: 13px; margin-bottom: 8px;">🕰️ Любимые эпохи кинематографа</div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px;">
          ${decadesHtml}
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div style="padding:20px;text-align:center;color:#f87171;">${err.message}</div>`;
  }
}

async function loadLocalLibraryList(container) {
  if (!container) return;
  try {
    const res = await fetch('/api/local-library/list', { headers: getAuthHeaders() });
    const data = await res.json();
    renderLocalLibraryCards(container, data.items || []);
  } catch (_) {}
}

function renderLocalLibraryCards(container, items) {
  if (!container) return;
  if (!items || items.length === 0) {
    container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:18px;color:var(--text-muted);font-size:12.5px;">Локальные видеофайлы еще не просканированы. Нажмите «🔍 Просканировать папку» выше.</div>`;
    return;
  }

  container.innerHTML = items.map((it, idx) => `
    <div class="storm-card local-media-card" data-idx="${idx}" style="display:flex;gap:10px;padding:10px;border-radius:10px;background:var(--bg-tertiary);border:1px solid var(--border-color);cursor:pointer;">
      <img src="${it.poster}" alt="${it.title}" style="width:52px;height:76px;object-fit:cover;border-radius:6px;flex-shrink:0;" onerror="this.src='assets/favicon.svg'">
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:space-between;">
        <div>
          <div style="font-size:13px;font-weight:800;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${it.title}">${it.title}</div>
          <div style="font-size:11px;color:var(--text-muted);">${it.year || ''} • ${it.sizeFormatted}</div>
          <div style="font-size:10.5px;color:var(--accent);margin-top:2px;">${it.quality}</div>
        </div>
        <span style="font-size:11px;font-weight:700;color:#10b981;">▶ Запустить в плеере</span>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.local-media-card').forEach(card => {
    card.onclick = () => {
      const item = items[parseInt(card.dataset.idx, 10)];
      if (!item) return;
      document.getElementById('sync-modal')?.classList.remove('is-open');
      import('./player.js?v=1.2.5').then(m => {
        if (m.openPlayerModal) {
          m.openPlayerModal({
            ...item,
            players: [{
              id: 'local_direct',
              name: `Локальный файл (${item.filename})`,
              url: item.stream_url,
              quality: item.quality || '1080p',
              is_iframe: false
            }]
          });
        }
      });
    };
  });
}

async function exportUserBackup(format = 'json') {
  try {
    const res = await fetch('/api/sync/export', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Ошибка экспорта данных');
    const data = await res.json();
    const bookmarks = Array.isArray(data.bookmarks) ? data.bookmarks : [];
    const dateStr = new Date().toISOString().slice(0, 10);

    let blob = null;
    let filename = `STORM_Backup_${dateStr}.json`;

    if (format === 'csv') {
      const rows = ['Title;Original Title;Year;Media Type;Status;Episodes Watched;Source'];
      bookmarks.forEach(b => {
        const clean = s => String(s || '').replace(/;/g, ',').replace(/\r?\n/g, ' ');
        rows.push(`${clean(b.title)};${clean(b.original_title)};${clean(b.year)};${clean(b.media_type)};${clean(b.status)};${b.episodes_watched || 0};${clean(b.source)}`);
      });
      blob = new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      filename = `STORM_Watchlist_${dateStr}.csv`;
    } else if (format === 'xml') {
      const xmlItems = bookmarks.map(b => `  <anime>
    <series_animedb_id>${String(b.media_id || '').replace(/\D+/g, '') || 1}</series_animedb_id>
    <series_title><![CDATA[${b.title || ''}]]></series_title>
    <my_watched_episodes>${b.episodes_watched || 0}</my_watched_episodes>
    <my_status>${b.status || 'Watching'}</my_status>
  </anime>`).join('\n');
      const xml = `<?xml version="1.0" encoding="UTF-8" ?>\n<myanimelist>\n${xmlItems}\n</myanimelist>`;
      blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
      filename = `STORM_MyAnimeList_${dateStr}.xml`;
    } else {
      blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    showToast(`Экспорт «${filename}» успешно сохранен`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function importUserBackup(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const content = JSON.parse(e.target.result);
      const res = await fetch('/api/sync/import', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(content)
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Ошибка импорта');

      showToast(`Импортировано записей: ${result.importedCount}`, 'success');
      document.getElementById('sync-modal')?.classList.remove('is-open');
    } catch (err) {
      showToast('Неверный формат файла резервной копии', 'error');
    }
  };
  reader.readAsText(file, 'utf-8');
}

async function importExternalListFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const rawContent = e.target.result;
      const res = await fetch('/api/sync/import-external', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ format: ext, content: rawContent })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка импорта списка');
      const resBox = document.getElementById('external-import-result');
      if (resBox) {
        resBox.style.display = 'block';
        resBox.textContent = `✅ Успешно импортировано в вашу библиотеку: ${data.count} релизов из файла «${file.name}»!`;
      }
      showToast(`Импортировано из «${file.name}»: ${data.count} тайтлов`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };
  reader.readAsText(file, 'utf-8');
}

async function syncWithShikimori(username) {
  try {
    showToast(`Синхронизация с профилем Shikimori (${username})...`, 'info');
    const res = await fetch('/api/sync/shikimori', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ username })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Пользователь Shikimori не найден');

    showToast(`Синхронизировано аниме из Shikimori: ${data.count}`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}
