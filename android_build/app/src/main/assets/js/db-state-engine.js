// =========================================================================
// STORM MULTIMEDIA 1.2.0 — ZERO-LOCALSTORAGE DB STATE ENGINE & UX CORE
// «Локально НИЧЕГО НЕ ДОЛЖНО ХРАНИТЬСЯ! Все только в базе!»
// Все настройки, состояние, история, закладки и сессии хранятся в БД сервера.
// =========================================================================

(function initStormDbStateEngine() {
  if (window.__STORM_DB_STATE_ENGINE_ACTIVE__) return;
  window.__STORM_DB_STATE_ENGINE_ACTIVE__ = true;

  // 1. Очистка любого локального дискового хранилища браузера и перехват в чистую RAM-память
  const ramStore = new Map();
  window.__STORM_EPHEMERAL_RAM_STORE__ = ramStore;

  try {
    const nativeLS = window.localStorage;
    if (nativeLS && nativeLS.length > 0) {
      nativeLS.clear();
    }
  } catch (_) {}

  try {
    const nativeSS = window.sessionStorage;
    if (nativeSS && nativeSS.length > 0) {
      nativeSS.clear();
    }
  } catch (_) {}

  let syncTimer = null;
  const dirtyKv = {};

  function shouldPersistKeyToDatabase(key) {
    if (!key || typeof key !== 'string') return false;
    // Временные кэши каталогов не засоряют JSON настроек пользователя, так как каталог кэшируется в L1/L2 на сервере
    if (
      key.startsWith('storm_cat_cache_') ||
      key.startsWith('storm_sw_') ||
      key.startsWith('storm_mod_healed_') ||
      key === 'storm_token' ||
      key === 'storm_user'
    ) {
      return false;
    }
    return true;
  }

  function scheduleDatabaseSettingsSync() {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      syncTimer = null;
      const keysToSync = Object.keys(dirtyKv);
      if (keysToSync.length === 0) return;
      const payloadKv = { ...dirtyKv };
      for (const k of keysToSync) delete dirtyKv[k];

      try {
        const headers = { 'Content-Type': 'application/json' };
        const token = ramStore.get('storm_token');
        if (token) headers['Authorization'] = `Bearer ${token}`;
        await fetch('/api/user/settings', {
          method: 'POST',
          headers,
          credentials: 'same-origin',
          body: JSON.stringify({ kv: payloadKv })
        });
      } catch (_) {}
    }, 350);
  }

  // Переопределение методов Storage.prototype для работы строго в оперативной памяти (0 байт на диске)
  try {
    const ephemStorage = {
      getItem(key) {
        const k = String(key);
        return ramStore.has(k) ? ramStore.get(k) : null;
      },
      setItem(key, value) {
        const k = String(key);
        const v = String(value);
        ramStore.set(k, v);
        if (shouldPersistKeyToDatabase(k)) {
          dirtyKv[k] = v;
          scheduleDatabaseSettingsSync();
        }
      },
      removeItem(key) {
        const k = String(key);
        ramStore.delete(k);
        if (shouldPersistKeyToDatabase(k)) {
          dirtyKv[k] = null;
          scheduleDatabaseSettingsSync();
        }
      },
      clear() {
        ramStore.clear();
      },
      key(index) {
        return Array.from(ramStore.keys())[index] || null;
      },
      get length() {
        return ramStore.size;
      }
    };

    Object.defineProperty(window, 'localStorage', {
      value: ephemStorage,
      configurable: true,
      writable: false
    });
  } catch (_) {}

  // Определение имени текущего устройства для кросс-девайс Handoff (Пункт 4.5)
  function detectClientDeviceName() {
    const ua = navigator.userAgent || '';
    if (/Android.*TV|BRAVIA|AFT|SmartTV|Tizen|Web0S/i.test(ua)) return 'Smart TV';
    if (/iPad|Tablet/i.test(ua)) return 'Планшет';
    if (/iPhone|Android.*Mobile/i.test(ua)) return 'Смартфон';
    if (/Windows/i.test(ua)) return 'ПК Windows';
    if (/Macintosh/i.test(ua)) return 'Mac';
    return 'Веб-клиент';
  }
  const CLIENT_DEVICE_NAME = detectClientDeviceName();
  window.__STORM_DEVICE_NAME__ = CLIENT_DEVICE_NAME;

  // 2. Пакетная отправка прогресса просмотра раз в 5 секунд (Пункт 1.8)
  const pendingProgressBatch = new Map();
  let progressBatchTimer = null;

  function flushClientProgressBatch() {
    if (pendingProgressBatch.size === 0) return;
    const items = Array.from(pendingProgressBatch.values());
    pendingProgressBatch.clear();
    const headers = {
      'Content-Type': 'application/json',
      'X-Storm-Device': CLIENT_DEVICE_NAME
    };
    const token = ramStore.get('storm_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;

    fetch('/api/media/progress/batch', {
      method: 'POST',
      headers,
      credentials: 'same-origin',
      keepalive: true,
      body: JSON.stringify({ items, device_name: CLIENT_DEVICE_NAME })
    }).catch(() => {});
  }

  window.queueStormWatchProgress = function queueStormWatchProgress(progressObj) {
    if (!progressObj || !progressObj.media_id) return;
    const key = `${progressObj.source || 'fanfilm4k'}:${progressObj.media_id}:s${progressObj.season_number || 0}:e${progressObj.episode_number || 0}`;
    pendingProgressBatch.set(key, {
      ...progressObj,
      device_name: CLIENT_DEVICE_NAME
    });
    if (!progressBatchTimer) {
      progressBatchTimer = setTimeout(() => {
        progressBatchTimer = null;
        flushClientProgressBatch();
      }, 5000);
    }
  };

  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushClientProgressBatch();
    }
    // Авто-заморозка фоновых анимаций при неактивной вкладке (Пункт 5.10)
    document.body.classList.toggle('storm-tab-hidden', document.hidden);
  });
  window.addEventListener('pagehide', flushClientProgressBatch);

  // 3. Гидратация всех данных и настроек пользователя напрямую из БД (/api/user/bootstrap)
  async function hydrateStateFromDatabase() {
    try {
      const headers = { 'X-Storm-Device': CLIENT_DEVICE_NAME };
      const token = ramStore.get('storm_token');
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/user/bootstrap?device=${encodeURIComponent(CLIENT_DEVICE_NAME)}`, {
        headers,
        credentials: 'same-origin'
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || !data.authenticated || !data.user) return null;

      window.__STORM_BOOTSTRAP_DATA__ = data;
      if (data.kv && typeof data.kv === 'object') {
        for (const [k, v] of Object.entries(data.kv)) {
          if (v !== null && v !== undefined) {
            ramStore.set(k, String(v));
          }
        }
      }

      const s = data.settings || {};
      const theme = ramStore.get('storm_theme') || s.theme;
      if (theme) document.documentElement.setAttribute('data-theme', theme);
      const accent = ramStore.get('storm_accent') || s.accent;
      if (accent && accent !== 'default') document.documentElement.setAttribute('data-accent', accent);
      const font = ramStore.get('storm_font') || s.font;
      if (font) document.documentElement.setAttribute('data-font', font);
      const scale = parseFloat(ramStore.get('storm_ui_scale') || s.ui_scale || '1');
      if (!isNaN(scale) && scale >= 0.75 && scale <= 2.0) {
        document.documentElement.style.setProperty('--storm-ui-scale', String(scale));
      }

      if (data.handoff && data.handoff.media_id && data.handoff.progress_seconds > 30) {
        renderSeamlessHandoffBanner(data.handoff);
      }

      window.dispatchEvent(new CustomEvent('storm:db-hydrated', { detail: data }));
      return data;
    } catch (_) {
      return null;
    }
  }

  window.hydrateStateFromDatabase = hydrateStateFromDatabase;

  // 4. Баннер бесшовной эстафеты просмотра между устройствами (Пункт 4.5)
  function renderSeamlessHandoffBanner(handoff) {
    if (document.getElementById('storm-handoff-banner')) return;
    const mins = Math.floor((handoff.progress_seconds || 0) / 60);
    const secs = String(Math.floor((handoff.progress_seconds || 0) % 60)).padStart(2, '0');
    const banner = document.createElement('div');
    banner.id = 'storm-handoff-banner';
    banner.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9990;background:rgba(15,23,42,0.95);border:1px solid rgba(0,210,255,0.45);border-radius:16px;padding:14px 18px;box-shadow:0 16px 40px rgba(0,0,0,0.65);backdrop-filter:blur(16px);display:flex;align-items:center;gap:14px;max-width:420px;animation:stormFadeInUp 0.35s cubic-bezier(0.22,1,0.36,1);';
    banner.innerHTML = `
      <div style="font-size:26px;">📲</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:11px;font-weight:800;color:#00d2ff;text-transform:uppercase;letter-spacing:0.8px;">Эстафета просмотра • ${handoff.device_name || 'Другое устройство'}</div>
        <div style="font-size:13px;font-weight:700;color:#f8fafc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;">${handoff.title || 'Продолжить просмотр'}</div>
        <div style="font-size:12px;color:#94a3b8;margin-top:2px;">Остановлено на ${mins}:${secs}${handoff.season_number ? ` • С${handoff.season_number}:Э${handoff.episode_number || 1}` : ''}</div>
      </div>
      <button type="button" id="storm-handoff-resume-btn" style="background:linear-gradient(135deg,#00d2ff,#3b82f6);color:#fff;border:none;border-radius:10px;padding:8px 14px;font-size:12px;font-weight:800;cursor:pointer;">▶ Смотреть</button>
      <button type="button" id="storm-handoff-close-btn" style="background:transparent;color:#94a3b8;border:none;font-size:16px;cursor:pointer;padding:4px;">✕</button>
    `;
    document.body.appendChild(banner);
    banner.querySelector('#storm-handoff-close-btn')?.addEventListener('click', () => banner.remove());
    banner.querySelector('#storm-handoff-resume-btn')?.addEventListener('click', () => {
      banner.remove();
      if (typeof window.openMediaDetailsModal === 'function') {
        window.openMediaDetailsModal(handoff.media_id, handoff.source || 'fanfilm4k', handoff.media_type || 'movie', handoff.title || '');
      }
    });
    setTimeout(() => { if (banner.parentNode) banner.remove(); }, 18000);
  }

  // 5. Плавная рамка фокуса для ТВ (Floating Focus Aura — Пункт 5.6)
  function initTvFloatingFocusAura() {
    let aura = document.querySelector('.storm-tv-focus-aura');
    if (!aura) {
      aura = document.createElement('div');
      aura.className = 'storm-tv-focus-aura';
      document.body.appendChild(aura);
    }
    document.addEventListener('focusin', (e) => {
      const target = e.target;
      if (!target || !(target instanceof HTMLElement)) return;
      if (!document.body.classList.contains('tv-mode') && document.documentElement.getAttribute('data-tv-mode') !== 'true') {
        aura.style.opacity = '0';
        return;
      }
      const rect = target.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) return;
      aura.style.opacity = '1';
      aura.style.transform = `translate3d(${Math.round(rect.left - 4)}px, ${Math.round(rect.top - 4)}px, 0)`;
      aura.style.width = `${Math.round(rect.width + 8)}px`;
      aura.style.height = `${Math.round(rect.height + 8)}px`;
    }, { passive: true });
  }

  // 6. Глобальные горячие клавиши ПК и Omnisearch по '/' (Пункт 4.2, 4.3)
  function initGlobalHotkeysAndOmnisearch() {
    document.addEventListener('keydown', (e) => {
      const activeTag = (document.activeElement?.tagName || '').toLowerCase();
      const isTyping = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select' || document.activeElement?.isContentEditable;

      // Быстрый вызов живого поиска по '/' или Ctrl+K
      if ((e.key === '/' && !isTyping) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        const searchInput = document.getElementById('global-search-input') || document.querySelector('input[type="search"], .storm-search-input');
        if (searchInput) {
          searchInput.focus();
          searchInput.select?.();
        }
        return;
      }

      if (isTyping) return;

      // Горячие клавиши видеоплеера (Space, F, M, J/L, 0-9)
      const videoEl = document.querySelector('#video-player-modal video, .storm-player-active video');
      if (!videoEl) return;

      if (e.code === 'Space' || e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (videoEl.paused) videoEl.play().catch(() => {});
        else videoEl.pause();
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        if (!document.fullscreenElement) {
          (videoEl.closest('.storm-modal-content') || videoEl).requestFullscreen?.().catch(() => {});
        } else {
          document.exitFullscreen?.().catch(() => {});
        }
      } else if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        videoEl.muted = !videoEl.muted;
      } else if (e.key.toLowerCase() === 'j') {
        e.preventDefault();
        videoEl.currentTime = Math.max(0, (videoEl.currentTime || 0) - 10);
      } else if (e.key.toLowerCase() === 'l') {
        e.preventDefault();
        videoEl.currentTime = Math.min(videoEl.duration || Infinity, (videoEl.currentTime || 0) + 10);
      } else if (/^[0-9]$/.test(e.key) && videoEl.duration > 0) {
        e.preventDefault();
        const pct = parseInt(e.key, 10) / 10;
        videoEl.currentTime = videoEl.duration * pct;
      }
    });
  }

  // 7. Асинхронное декодирование обложек img.decode() вне главного потока (Пункт 5.5)
  function initAsyncImageDecoderObserver() {
    if (!('IntersectionObserver' in window)) return;
    const decodeObserver = new IntersectionObserver((entries, obs) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const img = entry.target;
        obs.unobserve(img);
        if (img instanceof HTMLImageElement && typeof img.decode === 'function' && !img.complete) {
          img.decode().then(() => {
            img.classList.add('storm-img-decoded');
          }).catch(() => {
            img.classList.add('storm-img-decoded');
          });
        } else {
          img.classList.add('storm-img-decoded');
        }
      }
    }, { rootMargin: '240px 0px' });

    const mutObs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          const imgs = node.tagName === 'IMG' ? [node] : Array.from(node.querySelectorAll('img'));
          for (const img of imgs) {
            decodeObserver.observe(img);
          }
        }
      }
    });

    if (document.body) {
      mutObs.observe(document.body, { childList: true, subtree: true });
    } else {
      window.addEventListener('DOMContentLoaded', () => {
        mutObs.observe(document.body, { childList: true, subtree: true });
      });
    }
  }

  // 8. Панель 2FA TOTP и Активных Сессий в модальном окне профиля (Пункты 3.6, 3.10)
  async function injectSecurityPanelIntoProfileModal() {
    const profileModalBody = document.querySelector('#profile-modal .storm-modal-body, #user-profile-modal .storm-modal-body');
    if (!profileModalBody || document.getElementById('storm-security-sessions-panel')) return;

    const secBlock = document.createElement('div');
    secBlock.id = 'storm-security-sessions-panel';
    secBlock.className = 'profile-setting-block';
    secBlock.style.cssText = 'margin-top:16px;padding:16px;border-radius:14px;background:rgba(15,23,42,0.55);border:1px solid rgba(139,92,246,0.28);';
    secBlock.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px;">
        <div>
          <div style="font-size:14px;font-weight:800;color:#f8fafc;">🛡️ Центр безопасности: Активные устройства и 2FA TOTP</div>
          <div style="font-size:12px;color:#94a3b8;">Контроль активных сессий в реальном времени и двухфакторная защита аккаунта</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" id="storm-setup-2fa-btn" class="storm-btn storm-btn-secondary" style="font-size:12px;padding:6px 12px;border-radius:8px;cursor:pointer;">🔐 Настроить 2FA TOTP</button>
          <button type="button" id="storm-revoke-other-sessions-btn" class="storm-btn storm-btn-secondary" style="font-size:12px;padding:6px 12px;border-radius:8px;cursor:pointer;color:#f87171;">🚫 Завершить остальные сессии</button>
        </div>
      </div>
      <div id="storm-2fa-Interactive-box" style="display:none;margin-bottom:12px;padding:12px;border-radius:10px;background:rgba(0,210,255,0.08);border:1px solid rgba(0,210,255,0.3);"></div>
      <div id="storm-active-sessions-list" style="display:flex;flex-direction:column;gap:8px;font-size:12px;color:#cbd5e1;">Загрузка списка устройств...</div>
    `;
    profileModalBody.appendChild(secBlock);

    async function refreshSessionsList() {
      const listEl = secBlock.querySelector('#storm-active-sessions-list');
      if (!listEl) return;
      try {
        const token = ramStore.get('storm_token');
        const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
        const res = await fetch('/api/auth/sessions', { headers, credentials: 'same-origin' });
        const data = await res.json();
        const sessions = data.sessions || [];
        if (sessions.length === 0) {
          listEl.innerHTML = '<div style="color:#94a3b8;">Активные сессии не найдены (войдите в аккаунт).</div>';
          return;
        }
        listEl.innerHTML = sessions.map(s => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-radius:10px;background:rgba(30,41,59,0.65);border:1px solid rgba(255,255,255,0.08);">
            <div>
              <span style="font-weight:700;color:#f8fafc;">${s.device_name || 'Устройство'}</span>
              ${s.isCurrent ? '<span style="margin-left:8px;padding:2px 6px;border-radius:6px;background:rgba(16,185,129,0.2);color:#34d399;font-size:10px;font-weight:800;">ТЕКУЩИЙ СЕАНС</span>' : ''}
              <div style="font-size:11px;color:#94a3b8;margin-top:2px;">IP: ${s.ip_address || 'LAN'} • Активность: ${s.last_active_at || s.created_at || 'сейчас'}</div>
            </div>
            ${!s.isCurrent ? `<button type="button" data-revoke-prefix="${s.token_prefix}" style="background:rgba(239,68,68,0.18);color:#f87171;border:1px solid rgba(239,68,68,0.35);border-radius:8px;padding:5px 10px;font-size:11px;cursor:pointer;">Отключить</button>` : ''}
          </div>
        `).join('');

        listEl.querySelectorAll('[data-revoke-prefix]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const prefix = btn.getAttribute('data-revoke-prefix');
            const token = ramStore.get('storm_token');
            await fetch('/api/auth/sessions/revoke', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
              credentials: 'same-origin',
              body: JSON.stringify({ tokenPrefix: prefix })
            });
            refreshSessionsList();
          });
        });
      } catch (_) {
        listEl.innerHTML = '<div style="color:#94a3b8;">Войдите в аккаунт для просмотра активных устройств.</div>';
      }
    }

    secBlock.querySelector('#storm-revoke-other-sessions-btn')?.addEventListener('click', async () => {
      const token = ramStore.get('storm_token');
      await fetch('/api/auth/sessions/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
        credentials: 'same-origin',
        body: JSON.stringify({ allOthers: true })
      });
      refreshSessionsList();
    });

    secBlock.querySelector('#storm-setup-2fa-btn')?.addEventListener('click', async () => {
      const box = secBlock.querySelector('#storm-2fa-Interactive-box');
      if (!box) return;
      box.style.display = 'block';
      box.innerHTML = 'Генерация секретного ключа RFC 6238 TOTP...';
      try {
        const token = ramStore.get('storm_token');
        const res = await fetch('/api/auth/2fa/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
          credentials: 'same-origin'
        });
        const data = await res.json();
        if (!data.secret) {
          box.innerHTML = `<span style="color:#f87171;">${data.error || 'Требуется вход в аккаунт'}</span>`;
          return;
        }
        box.innerHTML = `
          <div style="font-size:12px;color:#f8fafc;font-weight:700;margin-bottom:6px;">Секретный ключ TOTP (Google Authenticator / Authy): <code style="color:#00d2ff;user-select:all;">${data.secret}</code></div>
          <div style="font-size:11px;color:#94a3b8;margin-bottom:8px;">Резервные коды: ${(data.backupCodes || []).join(', ')}</div>
          <div style="display:flex;gap:8px;align-items:center;">
            <input type="text" id="storm-2fa-code-input" placeholder="6-значный код" maxlength="8" style="padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:#0f172a;color:#fff;width:140px;font-size:12px;">
            <button type="button" id="storm-2fa-confirm-btn" style="background:#10b981;color:#fff;border:none;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer;">Активировать 2FA</button>
          </div>
        `;
        box.querySelector('#storm-2fa-confirm-btn')?.addEventListener('click', async () => {
          const code = box.querySelector('#storm-2fa-code-input')?.value || '';
          const vRes = await fetch('/api/auth/2fa/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
            credentials: 'same-origin',
            body: JSON.stringify({ code })
          });
          const vData = await vRes.json();
          if (vData.success) {
            box.innerHTML = `<div style="color:#34d399;font-weight:700;">✅ ${vData.message}</div>`;
          } else {
            alert(vData.error || 'Неверный код 2FA');
          }
        });
      } catch (e) {
        box.innerHTML = `<span style="color:#f87171;">Ошибка: ${e.message}</span>`;
      }
    });

    refreshSessionsList();
  }

  // 9. Внешний загрузчик локальных аудиодорожек и субтитров (.srt/.vtt/.mp3/.m4a) с ползунком синхронизации ±5000 мс (Пункт 2.10)
  // и кнопка 4K HDR Remux TorrServer (Пункт 2.1)
  function initPlayerAdvancedExtensions() {
    let customAudioEl = null;
    let subtitleOffsetMs = 0;

    window.openStormExternalTracksTool = function openStormExternalTracksTool() {
      let modal = document.getElementById('storm-external-tracks-modal');
      if (modal) {
        modal.style.display = 'flex';
        return;
      }
      modal = document.createElement('div');
      modal.id = 'storm-external-tracks-modal';
      modal.style.cssText = 'position:fixed;inset:0;z-index:10050;background:rgba(5,7,15,0.82);backdrop-filter:blur(12px);display:flex;align-items:center;justify-content:center;padding:16px;';
      modal.innerHTML = `
        <div style="background:#0f172a;border:1px solid rgba(0,210,255,0.35);border-radius:18px;max-width:520px;width:100%;padding:22px;color:#f8fafc;box-shadow:0 24px 60px rgba(0,0,0,0.8);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
            <div style="font-size:16px;font-weight:800;">📂 Внешние субтитры, аудиодорожки и 4K TorrServer</div>
            <button type="button" id="storm-ext-tracks-close" style="background:none;border:none;color:#94a3b8;font-size:18px;cursor:pointer;">✕</button>
          </div>
          <div style="display:flex;flex-direction:column;gap:14px;font-size:13px;">
            <div style="padding:12px;border-radius:12px;background:rgba(30,41,59,0.6);">
              <div style="font-weight:700;margin-bottom:6px;">💬 Подключить файл субтитров (.vtt, .srt)</div>
              <input type="file" id="storm-ext-sub-file" accept=".vtt,.srt,.ass" style="font-size:12px;color:#cbd5e1;width:100%;">
              <div style="margin-top:10px;display:flex;align-items:center;justify-content:space-between;">
                <span>Сдвиг тайминга субтитров: <b id="storm-sub-offset-val">0 мс</b></span>
                <input type="range" id="storm-sub-offset-range" min="-5000" max="5000" step="100" value="0" style="width:180px;">
              </div>
            </div>
            <div style="padding:12px;border-radius:12px;background:rgba(30,41,59,0.6);">
              <div style="font-weight:700;margin-bottom:6px;">🎙️ Подключить внешнюю аудиодорожку (.mp3, .m4a, .aac)</div>
              <input type="file" id="storm-ext-audio-file" accept=".mp3,.m4a,.aac,.ogg,.wav" style="font-size:12px;color:#cbd5e1;width:100%;">
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.querySelector('#storm-ext-tracks-close')?.addEventListener('click', () => {
        modal.style.display = 'none';
      });
      modal.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') modal.style.display = 'none';
      });

      const rangeEl = modal.querySelector('#storm-sub-offset-range');
      const valEl = modal.querySelector('#storm-sub-offset-val');
      rangeEl?.addEventListener('input', () => {
        subtitleOffsetMs = Number(rangeEl.value) || 0;
        if (valEl) valEl.textContent = `${subtitleOffsetMs > 0 ? '+' : ''}${subtitleOffsetMs} мс`;
      });

      modal.querySelector('#storm-ext-sub-file')?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        let text = await file.text();
        if (file.name.toLowerCase().endsWith('.srt')) {
          text = 'WEBVTT\n\n' + text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
        }
        const blob = new Blob([text], { type: 'text/vtt' });
        const url = URL.createObjectURL(blob);
        const videoEl = document.querySelector('video');
        if (videoEl) {
          const track = document.createElement('track');
          track.kind = 'subtitles';
          track.label = file.name;
          track.srclang = 'ru';
          track.src = url;
          track.default = true;
          videoEl.appendChild(track);
        }
      });

      modal.querySelector('#storm-ext-audio-file')?.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (customAudioEl) {
          customAudioEl.pause();
          customAudioEl.remove();
        }
        const url = URL.createObjectURL(file);
        customAudioEl = new Audio(url);
        const videoEl = document.querySelector('video');
        if (videoEl) {
          videoEl.muted = true;
          customAudioEl.currentTime = videoEl.currentTime || 0;
          if (!videoEl.paused) customAudioEl.play().catch(() => {});
          videoEl.addEventListener('play', () => customAudioEl?.play().catch(() => {}));
          videoEl.addEventListener('pause', () => customAudioEl?.pause());
          videoEl.addEventListener('seeked', () => {
            if (customAudioEl) customAudioEl.currentTime = videoEl.currentTime + (subtitleOffsetMs / 1000);
          });
        }
      });
    };
  }

  // Старт всех подсистем 1.2.0
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      hydrateStateFromDatabase();
      initTvFloatingFocusAura();
      initGlobalHotkeysAndOmnisearch();
      initAsyncImageDecoderObserver();
      initPlayerAdvancedExtensions();
      setTimeout(injectSecurityPanelIntoProfileModal, 1200);
    });
  } else {
    hydrateStateFromDatabase();
    initTvFloatingFocusAura();
    initGlobalHotkeysAndOmnisearch();
    initAsyncImageDecoderObserver();
    initPlayerAdvancedExtensions();
    setTimeout(injectSecurityPanelIntoProfileModal, 1200);
  }
})();
