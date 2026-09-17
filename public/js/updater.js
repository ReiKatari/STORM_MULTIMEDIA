/* ==========================================================================
   STORM MULTIMEDIA - СИСТЕМА ПРОВЕРКИ И УСТАНОВКИ ОБНОВЛЕНИЙ
   Интеграция с официальными релизами GitHub:
   https://github.com/ReiKatari/STORM_MULTIMEDIA/releases
   ========================================================================== */

import { showToast } from './auth.js';

export const CURRENT_APP_VERSION = '1.0.15';
const GITHUB_REPO = 'ReiKatari/STORM_MULTIMEDIA';
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 час для пассивных проверок в браузере

/**
 * Семантическое сравнение версий (1.0.1 vs 1.0.0)
 * Возвращает:
 *  1, если v1 > v2
 * -1, если v1 < v2
 *  0, если v1 == v2
 */
export function compareVersions(v1, v2) {
  const clean = v => String(v || '').replace(/^v/i, '').trim();
  const p1 = clean(v1).split('.').map(n => parseInt(n, 10) || 0);
  const p2 = clean(v2).split('.').map(n => parseInt(n, 10) || 0);
  const maxLen = Math.max(p1.length, p2.length);

  for (let i = 0; i < maxLen; i++) {
    const num1 = p1[i] || 0;
    const num2 = p2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

/**
 * Проверка наличия свежего релиза на GitHub
 * @param {boolean} manualTrigger true, если вызов инициирован пользователем вручную
 */
export async function checkForUpdates(manualTrigger = false) {
  const isNative = typeof window !== 'undefined' && (
    /StormMultimediaApp/i.test(navigator.userAgent) ||
    window.location.protocol === 'file:' ||
    Boolean(window.StormNativeApp)
  );

  const now = Date.now();
  const lastCheck = parseInt(localStorage.getItem('storm_last_update_check') || '0', 10);

  // В нативном приложении при запуске проверяем всегда без кулдауна, в браузере — с интервалом
  if (!manualTrigger && !isNative && (now - lastCheck < CHECK_INTERVAL_MS)) {
    return null;
  }

  if (manualTrigger) {
    showToast('🔍 Проверка наличия обновлений на GitHub...', 'info');
  }

  // 1. Первичная проверка через локальный серверный прокси (обходит лимиты и блокировки WebView)
  try {
    const srvRes = await fetch('/api/updates/check', { signal: AbortSignal.timeout(5000) });
    if (srvRes.ok) {
      const data = await srvRes.json();
      if (data && data.success && data.latestVersion) {
        localStorage.setItem('storm_last_update_check', String(now));
        const hasNewer = compareVersions(data.latestVersion, CURRENT_APP_VERSION) > 0;
        if (hasNewer) {
          showUpdateModal({
            name: data.releaseName,
            tag_name: data.latestVersion,
            body: data.body,
            html_url: data.htmlUrl,
            assets: (data.assets || []).map(a => ({
              name: a.name,
              size: a.size,
              browser_download_url: a.downloadUrl
            }))
          }, data.latestVersion);
          return data;
        } else if (manualTrigger) {
          showToast(`У вас актуальная версия STORM MULTIMEDIA (${CURRENT_APP_VERSION})`, 'success');
          return null;
        }
        return null;
      }
    }
  } catch (_) {
    // В случае оффлайна или автономного file:// переходим к прямому запросу на GitHub
  }

  // 2. Fallback: прямой запрос к официальному API GitHub
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: {
        'Accept': 'application/vnd.github.v3+json'
      },
      signal: AbortSignal.timeout(7000)
    });

    localStorage.setItem('storm_last_update_check', String(now));

    if (!res.ok) {
      if (manualTrigger) {
        showToast('Не удалось связаться с сервером обновлений GitHub', 'error');
      }
      return null;
    }

    const release = await res.json();
    const latestVersion = (release.tag_name || release.name || '').replace(/^v/i, '').trim();

    if (!latestVersion) {
      if (manualTrigger) {
        showToast(`У вас установлена актуальная версия STORM MULTIMEDIA (${CURRENT_APP_VERSION})`, 'success');
      }
      return null;
    }

    const hasNewer = compareVersions(latestVersion, CURRENT_APP_VERSION) > 0;

    if (hasNewer) {
      showUpdateModal(release, latestVersion);
      return release;
    } else {
      if (manualTrigger) {
        showToast(`У вас актуальная версия STORM MULTIMEDIA (${CURRENT_APP_VERSION})`, 'success');
      }
      return null;
    }
  } catch (err) {
    if (manualTrigger) {
      showToast('Ошибка при проверке обновлений: проверьте подключение к сети', 'error');
    }
    return null;
  }
}

/**
 * Отображение фирменного модального окна обновления STORM
 */
export function showUpdateModal(release, latestVersion) {
  let modal = document.getElementById('storm-update-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'storm-update-modal';
    modal.className = 'storm-modal-backdrop is-open';
    document.body.appendChild(modal);
  } else {
    modal.classList.add('is-open');
  }

  // Поиск бинарного APK файла в ассетах
  const apkAsset = (release.assets || []).find(a => a.name && a.name.endsWith('.apk'));
  const downloadUrl = apkAsset ? apkAsset.browser_download_url : (release.html_url || `https://github.com/${GITHUB_REPO}/releases`);
  const apkSizeMb = apkAsset ? (apkAsset.size / (1024 * 1024)).toFixed(2) + ' МБ' : '';

  // Очистка и форматирование тела релиза для компактного превью
  const bodySnippet = (release.body || '')
    .split('\n')
    .filter(line => !line.startsWith('>') && !line.startsWith('<details') && !line.startsWith('</details') && !line.startsWith('<summary'))
    .slice(0, 8)
    .join('\n')
    .trim();

  modal.innerHTML = `
    <div class="storm-modal storm-update-modal-dialog" style="max-width: 540px; border: 1px solid var(--accent-glow); box-shadow: 0 0 32px var(--accent-glow);">
      <div class="storm-modal-header" style="justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.08); padding: 18px 24px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <span style="font-size: 26px;">🚀</span>
          <div>
            <h3 style="margin: 0; font-size: 18px; font-weight: 800; color: var(--text-primary);">Доступно обновление</h3>
            <div style="font-size: 12px; color: var(--accent); margin-top: 2px;">Версия ${latestVersion} (текущая: ${CURRENT_APP_VERSION})</div>
          </div>
        </div>
        <button type="button" class="storm-modal-close" id="storm-update-modal-close" style="font-size: 22px; background: none; border: none; color: var(--text-muted); cursor: pointer;">✕</button>
      </div>
      <div class="storm-modal-body" style="padding: 22px 24px;">
        <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; padding: 14px 18px; margin-bottom: 18px;">
          <div style="font-weight: 700; font-size: 13px; color: var(--text-secondary); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">Ключевые новшества:</div>
          <div style="font-size: 13.5px; line-height: 1.6; color: var(--text-primary); white-space: pre-line;">${escapeHtml(bodySnippet || 'Новые улучшения интерфейса, повышение плавности и обновление каталога.')}</div>
        </div>
        ${apkAsset ? `
        <div style="display: flex; align-items: center; justify-content: space-between; font-size: 12.5px; color: var(--text-muted); margin-bottom: 20px; padding: 0 4px;">
          <span>📦 Установочный пакет Android: <strong>${apkAsset.name}</strong></span>
          <span>${apkSizeMb}</span>
        </div>` : ''}
        <div style="display: flex; gap: 12px; justify-content: flex-end;">
          <button type="button" class="storm-btn storm-btn-secondary" id="storm-update-later-btn" style="padding: 10px 18px; border-radius: 10px; font-size: 13.5px;">Позже</button>
          <a href="${downloadUrl}" class="storm-btn storm-btn-primary" id="storm-update-download-btn" target="_blank" rel="noopener" style="padding: 10px 22px; border-radius: 10px; font-size: 13.5px; text-decoration: none; display: inline-flex; align-items: center; gap: 8px;">
            <span>📥</span> Скачать обновление
          </a>
        </div>
      </div>
    </div>
  `;

  const closeBtn = modal.querySelector('#storm-update-modal-close');
  const laterBtn = modal.querySelector('#storm-update-later-btn');
  const downloadBtn = modal.querySelector('#storm-update-download-btn');

  const closeModal = () => {
    modal.classList.remove('is-open');
  };

  if (closeBtn) closeBtn.onclick = closeModal;
  if (laterBtn) {
    laterBtn.onclick = () => {
      localStorage.setItem('storm_dismissed_update', latestVersion);
      closeModal();
    };
  }
  if (downloadBtn) {
    downloadBtn.onclick = () => {
      showToast('⏳ Загрузка установочного пакета начата...', 'info');
      setTimeout(closeModal, 1500);
    };
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
