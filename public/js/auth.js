/* ==========================================================================
   STORM MULTIMEDIA - МОДУЛЬ АУТЕНТИФИКАЦИИ И ПРОФИЛЯ ПОЛЬЗОВАТЕЛЯ
   ========================================================================== */

import { t, formatDate } from './i18n.js?v=1.3.1';

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let currentUser = null;
try {
  const cachedUser = localStorage.getItem('storm_user');
  if (cachedUser) currentUser = JSON.parse(cachedUser);
} catch {}

let currentToken = localStorage.getItem('storm_token') || null;
let onAuthChangedCallbacks = [];

export function getToken() {
  if (currentToken) return currentToken;
  if (typeof window !== 'undefined' && window.__STORM_CURRENT_TOKEN__) {
    currentToken = window.__STORM_CURRENT_TOKEN__;
    return currentToken;
  }
  const stored = localStorage.getItem('storm_token');
  if (stored) {
    currentToken = stored;
    return currentToken;
  }
  return null;
}

export function getUser() {
  if (currentUser) return currentUser;
  if (typeof window !== 'undefined' && window.__STORM_CURRENT_USER__) {
    currentUser = window.__STORM_CURRENT_USER__;
    return currentUser;
  }
  try {
    const raw = localStorage.getItem('storm_user');
    if (raw) {
      currentUser = JSON.parse(raw);
      return currentUser;
    }
  } catch (_) {}
  return null;
}

export function onAuthChanged(cb) {
  onAuthChangedCallbacks.push(cb);
}

function notifyAuthChanged() {
  if (typeof window !== 'undefined') {
    window.__STORM_CURRENT_USER__ = currentUser || null;
    window.__STORM_CURRENT_TOKEN__ = currentToken || null;
  }
  if (currentUser && typeof window !== 'undefined' && typeof window.hydrateStateFromDatabase === 'function') {
    window.hydrateStateFromDatabase().catch(() => {});
  }
  onAuthChangedCallbacks.forEach(cb => cb(currentUser));
}

export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const hostParent = document.fullscreenElement || document.webkitFullscreenElement || document.body;
  if (container.parentElement !== hostParent) {
    hostParent.appendChild(container);
  }
  container.style.zIndex = '2147483645';

  const toast = document.createElement('div');
  toast.className = 'storm-toast';
  
  const rawMsg = String(message || '').trim();
  // Проверка: начинается ли сообщение уже с эмодзи или пиктограммы (⚡, ✅, ⚠️, ⏱️, 🎬 и т.д.)
  const alreadyHasIcon = /^(\p{Emoji}|\uD83C[\uDF00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDD00-\uDFFF]|⚡|✅|⚠️|❌|ℹ️|⏱️|⏩|🎧|🎙️|🔊|🎬)/u.test(rawMsg);
  const defaultIcon = type === 'success' ? '✅' : type === 'error' ? '⚠️' : '⚡';
  const iconHtml = alreadyHasIcon ? '' : `<span>${defaultIcon}</span>`;

  toast.innerHTML = `${iconHtml}<span>${rawMsg}</span>`;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

export function isRealAuthenticatedAccount(user = currentUser, token = currentToken) {
  const tok = String(token || localStorage.getItem('storm_token') || '').trim();
  if (!user || !user.id || Number(user.id) === 9999 || user.isGuest) return false;
  if (!tok || tok.startsWith('guest_') || tok.startsWith('offline_')) return false;
  return true;
}

export function clearUserSessionLocalCache(options = {}) {
  const { restoreGuestVault = true } = options || {};
  if (typeof window !== 'undefined') {
    window.__STORM_SUPPRESS_DB_SYNC__ = true;
    window.__STORM_SUPPRESS_GUEST_VAULT_WRITE__ = true;
    window.__STORM_CURRENT_USER__ = null;
    window.__STORM_CURRENT_TOKEN__ = null;
    if (typeof window.resetStormDirtySettingsQueue === 'function') {
      window.resetStormDirtySettingsQueue();
    }
  }
  try {
    localStorage.removeItem('storm_token');
    localStorage.removeItem('storm_user');
    localStorage.removeItem('storm_active_user_id');
    localStorage.removeItem('storm_continue_watching');
    localStorage.removeItem('storm_local_bookmarks');
    localStorage.removeItem('storm_custom_lists');
    localStorage.removeItem('storm_family_profiles');
    localStorage.removeItem('storm_watched_hours');
    localStorage.removeItem('storm_user_xp');
    localStorage.removeItem('storm_user_level');
    localStorage.removeItem('storm_dismissed_continue_v1');
    localStorage.removeItem('storm_achievements_cache');
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (
        k.startsWith('storm_status_') ||
        k.startsWith('storm_watched_') ||
        k.startsWith('storm_season_status_') ||
        k.startsWith('storm_series_completed_meta_') ||
        k.startsWith('storm_resume_state_') ||
        k.startsWith('storm_ep_watched_') ||
        k.startsWith('storm_family_profiles_u_')
      )) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
    try {
      if (typeof DEFAULT_PROFILES !== 'undefined') {
        familyProfiles = DEFAULT_PROFILES.map(p => ({ ...p }));
        activeProfileId = 'primary';
      }
    } catch (_) {}
    if (typeof window !== 'undefined') {
      window.__STORM_MEMORY_BOOKMARKS__ = [];
      if (restoreGuestVault && typeof window.restoreStormGuestVaultToRam === 'function') {
        window.restoreStormGuestVaultToRam();
      }
      window.dispatchEvent(new CustomEvent('storm:continue-watching-updated', { detail: { cleared: !restoreGuestVault } }));
      window.dispatchEvent(new CustomEvent('storm:bookmarks-updated', { detail: { cleared: !restoreGuestVault } }));
    }
  } catch (_) {
  } finally {
    if (typeof window !== 'undefined') {
      window.__STORM_SUPPRESS_DB_SYNC__ = false;
      window.__STORM_SUPPRESS_GUEST_VAULT_WRITE__ = false;
    }
  }
}

export async function checkAuth() {
  try {
    const headers = {};
    if (currentToken) {
      headers['Authorization'] = `Bearer ${currentToken}`;
    }

    const res = await fetch('/api/auth/me', {
      headers,
      signal: AbortSignal.timeout(2500)
    });
    if (typeof window !== 'undefined') window.__STORM_BACKEND_ONLINE__ = true;

    if (res.ok) {
      const data = await res.json();
      if (data && data.user && data.user.id) {
        const prevUserId = localStorage.getItem('storm_active_user_id');
        if (prevUserId && String(prevUserId) !== String(data.user.id)) {
          clearUserSessionLocalCache();
        }
        currentUser = data.user;
        currentUser.stats = data.stats;
        if (data.token) {
          currentToken = data.token;
          localStorage.setItem('storm_token', currentToken);
        }
        localStorage.setItem('storm_active_user_id', String(data.user.id));
        localStorage.setItem('storm_user', JSON.stringify(currentUser));
        if (Array.isArray(data.vaultTokens)) saveLocalVaultTokens(data.vaultTokens);
        if (Array.isArray(data.savedAccounts)) cachedSavedAccounts = data.savedAccounts;
        updateAuthUI();
        notifyAuthChanged();
        return currentUser;
      } else {
        const hadTokenOrUser = Boolean(currentToken || currentUser || localStorage.getItem('storm_active_user_id') || !localStorage.getItem('storm_guest_isolated_v3'));
        currentToken = null;
        currentUser = null;
        if (hadTokenOrUser) {
          clearUserSessionLocalCache();
          localStorage.setItem('storm_guest_isolated_v3', '1');
        }
      }
    } else if (res.status === 401 || res.status === 403) {
      currentUser = null;
      currentToken = null;
      clearUserSessionLocalCache();
    }
  } catch (err) {
    if (typeof window !== 'undefined') window.__STORM_BACKEND_ONLINE__ = false;
    console.warn('Автономный режим или сервер недоступен:', err.message);
    if (!currentUser) {
      try {
        const cached = localStorage.getItem('storm_user');
        if (cached) currentUser = JSON.parse(cached);
      } catch {}
    }
  }

  updateAuthUI();
  notifyAuthChanged();
  return currentUser;
}

function collectGuestProgressForRegistration() {
  const vaultSnap = (typeof window !== 'undefined' && typeof window.getStormGuestVaultSnapshot === 'function')
    ? window.getStormGuestVaultSnapshot()
    : {};
  const st = computeLocalAndMergedProfileStats({});
  let bookmarks = [];
  let continueWatching = [];
  let customLists = [];
  let achievements = {};
  try {
    const rawBm = localStorage.getItem('storm_local_bookmarks') || vaultSnap.storm_local_bookmarks;
    if (rawBm) {
      const parsed = JSON.parse(rawBm);
      bookmarks = Array.isArray(parsed) ? parsed : Object.values(parsed || {});
    }
  } catch (_) {}
  try {
    if (typeof window !== 'undefined' && Array.isArray(window.__STORM_MEMORY_BOOKMARKS__)) {
      const seen = new Set(bookmarks.map(b => String(b.media_id || b.id || b.title || '')));
      for (const mb of window.__STORM_MEMORY_BOOKMARKS__) {
        const k = String(mb.media_id || mb.id || mb.title || '');
        if (k && !seen.has(k)) {
          seen.add(k);
          bookmarks.push(mb);
        }
      }
    }
  } catch (_) {}
  try {
    const rawCw = localStorage.getItem('storm_continue_watching') || vaultSnap.storm_continue_watching;
    if (rawCw) {
      const parsed = JSON.parse(rawCw);
      continueWatching = Array.isArray(parsed) ? parsed : Object.values(parsed || {});
    }
  } catch (_) {}
  try {
    const rawLists = localStorage.getItem('storm_custom_lists') || vaultSnap.storm_custom_lists;
    if (rawLists) {
      const parsed = JSON.parse(rawLists);
      if (Array.isArray(parsed)) customLists = parsed;
    }
  } catch (_) {}
  try {
    const rawAch = localStorage.getItem('storm_local_achievements') || vaultSnap.storm_local_achievements;
    if (rawAch) {
      achievements = JSON.parse(rawAch) || {};
    }
  } catch (_) {}

  const kv = {};
  for (const [k, v] of Object.entries(vaultSnap)) {
    if (v !== null && v !== undefined && k !== 'storm_family_profiles') {
      kv[k] = String(v);
    }
  }
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k !== 'storm_token' && k !== 'storm_user' && k !== 'storm_family_profiles') {
      const val = localStorage.getItem(k);
      if (val !== null) kv[k] = val;
    }
  }

  const rankInfo = computeRankAndLevelFromStats(st);
  kv.storm_user_xp = String(rankInfo.xp);
  kv.storm_user_level = String(rankInfo.level);
  if (st.totalWatchedHours > 0) {
    kv.storm_watched_hours = String(st.totalWatchedHours);
  }

  return {
    bookmarks,
    continueWatching,
    customLists,
    achievements,
    watchedHours: st.totalWatchedHours || 0,
    xp: rankInfo.xp,
    level: rankInfo.level,
    bio: localStorage.getItem('storm_profile_bio') || vaultSnap.storm_profile_bio || '',
    avatar: localStorage.getItem('storm_guest_avatar') || (currentUser?.isGuest ? currentUser.avatar : '') || '',
    avatarBg: localStorage.getItem('storm_profile_aura') || vaultSnap.storm_profile_aura || '',
    kv
  };
}

export async function register(username, email, password) {
  const uStr = String(username || '').trim();
  const eStr = String(email || '').trim().toLowerCase();
  const pStr = String(password || '').trim();

  if (!uStr || !eStr || !pStr) {
    throw new Error('Заполните имя пользователя, email и пароль');
  }
  if (uStr.length < 3) {
    throw new Error('Имя пользователя должно содержать не менее 3 символов');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(eStr)) {
    throw new Error('Укажите корректный адрес электронной почты (email)');
  }
  if (pStr.length < 6) {
    throw new Error('Пароль должен содержать не менее 6 символов');
  }

  const guestPayload = (!isRealAuthenticatedAccount()) ? collectGuestProgressForRegistration() : null;

  let res;
  try {
    res = await fetch('/api/auth/register', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: uStr,
        email: eStr,
        password: pStr,
        avatar: guestPayload?.avatar || undefined,
        guestData: guestPayload
      }),
      signal: AbortSignal.timeout(12000)
    });
    if (typeof window !== 'undefined') window.__STORM_BACKEND_ONLINE__ = true;
  } catch (netErr) {
    if (typeof window !== 'undefined') window.__STORM_BACKEND_ONLINE__ = false;
    throw new Error('Сервер регистрации временно недоступен. Проверьте подключение к сети.');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data || !data.user) {
    throw new Error(data?.error || 'Ошибка регистрации');
  }

  if (typeof window !== 'undefined' && typeof window.clearStormGuestVaultSnapshot === 'function') {
    window.clearStormGuestVaultSnapshot();
  }
  clearUserSessionLocalCache({ restoreGuestVault: false });
  localStorage.removeItem('storm_explicit_guest_mode');

  currentToken = data.token;
  currentUser = data.user;
  if (data.stats) currentUser.stats = data.stats;
  if (typeof window !== 'undefined') {
    window.__STORM_CURRENT_USER__ = currentUser;
    window.__STORM_CURRENT_TOKEN__ = currentToken;
  }
  localStorage.setItem('storm_active_user_id', String(data.user.id));
  localStorage.setItem('storm_token', currentToken);
  localStorage.setItem('storm_user', JSON.stringify(currentUser));

  if (guestPayload && guestPayload.kv) {
    for (const [k, v] of Object.entries(guestPayload.kv)) {
      if (v !== null && v !== undefined && k !== 'storm_token' && k !== 'storm_user' && k !== 'storm_family_profiles') {
        localStorage.setItem(k, String(v));
      }
    }
  }

  familyProfiles = DEFAULT_PROFILES.map((p, idx) => enrichProfileDefaults({
    ...p,
    name: idx === 0 ? currentUser.username : p.name,
    avatar: idx === 0 && currentUser.avatar ? currentUser.avatar : p.avatar
  }, idx));
  saveFamilyProfiles(familyProfiles);

  if (Array.isArray(data.vaultTokens)) saveLocalVaultTokens(data.vaultTokens);
  if (Array.isArray(data.savedAccounts)) cachedSavedAccounts = data.savedAccounts;
  if (typeof window !== 'undefined' && typeof window.hydrateStateFromDatabase === 'function') {
    window.hydrateStateFromDatabase().catch(() => {});
  }
  updateAuthUI();
  notifyAuthChanged();
  renderSavedAccountsLists();

  const hadGuestProgress = guestPayload && (guestPayload.level > 1 || guestPayload.xp > 50 || (guestPayload.bookmarks && guestPayload.bookmarks.length > 0));
  if (hadGuestProgress) {
    showToast(`✅ Аккаунт «${currentUser.username}» создан! Прогресс гостя (Уровень ${guestPayload.level}, ${guestPayload.xp} XP) перенесён в профиль.`, 'success');
  } else {
    showToast(`✅ Аккаунт «${currentUser.username}» успешно создан!`, 'success');
  }
  return currentUser;
}

export async function login(loginStr, password) {
  const lStr = String(loginStr || '').trim();
  const pStr = String(password || '').trim();

  if (!lStr || !pStr) {
    throw new Error('Пожалуйста, введите логин и пароль');
  }

  let res;
  try {
    res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: lStr, password: pStr }),
      signal: AbortSignal.timeout(4000)
    });
    if (typeof window !== 'undefined') window.__STORM_BACKEND_ONLINE__ = true;
  } catch (netErr) {
    if (typeof window !== 'undefined') window.__STORM_BACKEND_ONLINE__ = false;
    throw new Error('Сервер авторизации временно недоступен. Проверьте подключение к сети.');
  }

  let data = await res.json().catch(() => ({}));
  if (res.ok && data && data.requires2FA) {
    const totpCode = window.prompt(data.message || 'Введите 6-значный код двухфакторной аутентификации (2FA TOTP):');
    if (!totpCode) {
      throw new Error('Вход отменён: требуется код 2FA');
    }
    res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: lStr, password: pStr, totpCode: String(totpCode).trim() }),
      signal: AbortSignal.timeout(4000)
    });
    data = await res.json().catch(() => ({}));
  }
  if (!res.ok || !data || !data.user) {
    throw new Error(data?.error || 'Неверное имя пользователя или пароль');
  }

  const prevUserId = localStorage.getItem('storm_active_user_id');
  if (prevUserId && String(prevUserId) !== String(data.user.id)) {
    clearUserSessionLocalCache();
  }

  currentToken = data.token;
  currentUser = data.user;
  localStorage.setItem('storm_active_user_id', String(data.user.id));
  localStorage.setItem('storm_token', currentToken);
  localStorage.setItem('storm_user', JSON.stringify(currentUser));

  if (Array.isArray(data.vaultTokens)) saveLocalVaultTokens(data.vaultTokens);
  if (Array.isArray(data.savedAccounts)) cachedSavedAccounts = data.savedAccounts;
  updateAuthUI();
  notifyAuthChanged();
  renderSavedAccountsLists();
  showToast(t('msg_login_success'), 'success');
  return currentUser;
}

export function loginOfflineUser(username = 'Пользователь', customEmail = '') {
  clearUserSessionLocalCache();
  currentUser = {
    id: Math.floor(Math.random() * 10000) + 100,
    username: username,
    email: customEmail || (username.includes('@') ? username : `${username.toLowerCase()}@storm.local`),
    role: 'user',
    avatar: 'assets/avatar_default.svg',
    created_at: new Date().toISOString(),
    stats: { bookmarks_count: 0, history_count: 0 }
  };
  currentToken = 'offline_user_token_' + Date.now();
  localStorage.setItem('storm_token', currentToken);
  localStorage.setItem('storm_user', JSON.stringify(currentUser));
  updateAuthUI();
  notifyAuthChanged();
  showToast(`Вход выполнен (${currentUser.username})`, 'success');
  return currentUser;
}

export function loginAsGuest() {
  fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  currentToken = null;
  currentUser = null;
  clearUserSessionLocalCache({ restoreGuestVault: true });
  localStorage.setItem('storm_explicit_guest_mode', '1');
  updateAuthUI();
  notifyAuthChanged();
  showToast('Включён локальный гостевой профиль (все данные сохраняются на устройстве)', 'info');
  return null;
}

export async function logout() {
  const tokenToRevoke = currentToken || localStorage.getItem('storm_token') || null;
  try {
    const headers = {};
    if (tokenToRevoke) headers['Authorization'] = `Bearer ${tokenToRevoke}`;
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers
    });
  } catch (e) {
    // Игнорируем сетевые ошибки при выходе
  }

  currentToken = null;
  currentUser = null;
  clearUserSessionLocalCache({ restoreGuestVault: true });
  localStorage.setItem('storm_explicit_guest_mode', '1');

  updateAuthUI();
  notifyAuthChanged();
  showToast(t('msg_logout_success'), 'info');
}

// ==========================================
// ВХОД ПО ОДНОРАЗОВОМУ ТВ-КОДУ (DEVICE CODE FLOW)
// ==========================================
let tvCodePollInterval = null;

export async function startTvDeviceCodeSession() {
  const displayEl = document.getElementById('tv-code-display');
  const statusEl = document.getElementById('tv-code-status-text');
  if (displayEl) displayEl.textContent = '------';
  if (statusEl) statusEl.textContent = 'Генерация одноразового кода...';

  stopTvDeviceCodeSession();

  try {
    const res = await fetch('/api/auth/device/code', { method: 'POST' });
    const data = await res.json();
    if (!res.ok || !data.code) throw new Error(data.error || 'Ошибка запроса кода');

    const code = data.code;
    if (displayEl) displayEl.textContent = code;
    if (statusEl) statusEl.textContent = 'Ожидание подтверждения на устройстве...';

    tvCodePollInterval = setInterval(async () => {
      try {
        const pollRes = await fetch(`/api/auth/device/poll?code=${encodeURIComponent(code)}`);
        const pollData = await pollRes.json();

        if (pollData.status === 'authorized' && pollData.session) {
          stopTvDeviceCodeSession();
          currentToken = pollData.session.token;
          currentUser = pollData.session.user;
          localStorage.setItem('storm_token', currentToken);
          localStorage.setItem('storm_user', JSON.stringify(currentUser));
          updateAuthUI();
          notifyAuthChanged();
          showToast(`✅ Успешный вход на ТВ (${currentUser.username})!`, 'success');
          const authModal = document.getElementById('auth-modal');
          if (authModal) authModal.classList.remove('is-open');
        } else if (pollData.status === 'expired') {
          stopTvDeviceCodeSession();
          if (statusEl) statusEl.textContent = '⚠️ Срок действия кода истёк. Запросите новый код.';
        }
      } catch (err) {
        console.warn('Ошибка проверки статуса ТВ-кода:', err);
      }
    }, 2500);
  } catch (err) {
    if (statusEl) statusEl.textContent = `⚠️ ${err.message}`;
  }
}

export function stopTvDeviceCodeSession() {
  if (tvCodePollInterval) {
    clearInterval(tvCodePollInterval);
    tvCodePollInterval = null;
  }
}

export function updateFamilyHeaderUI() {
  const headerFamilyBtn = document.getElementById('header-family-btn');
  if (!isRealAuthenticatedAccount()) {
    if (headerFamilyBtn) headerFamilyBtn.style.display = 'none';
    ['family-profiles-modal', 'family-profiles-manage-modal', 'family-profile-editor-modal', 'family-pin-prompt-modal'].forEach(id => {
      document.getElementById(id)?.classList.remove('is-open');
    });
    return;
  }
  if (headerFamilyBtn) headerFamilyBtn.style.display = 'inline-flex';

  const profile = getActiveProfile();
  const iconEl = document.getElementById('active-profile-avatar-icon');
  const labelEl = document.getElementById('active-profile-name-label');
  if (iconEl && profile) {
    if (profile.avatar && (profile.avatar.startsWith('http') || profile.avatar.startsWith('/') || profile.avatar.startsWith('data:'))) {
      iconEl.innerHTML = `<img src="${profile.avatar}" alt="" style="width: 18px; height: 18px; border-radius: 50%; object-fit: cover; vertical-align: middle;">`;
    } else {
      iconEl.textContent = profile.avatar || (profile.isKid ? '🦄' : '👑');
    }
  }
  if (labelEl && profile) {
    labelEl.textContent = profile.name ? profile.name.split(' ')[0] : 'Профиль';
  }
}

export function updateAuthUI() {
  const profileBtn = document.getElementById('user-profile-btn');
  const loginBtn = document.getElementById('login-modal-btn');
  const headerProfileBtn = document.getElementById('header-profile-btn');
  const avatarImg = document.getElementById('user-avatar-img');
  const userNameSpan = document.getElementById('user-name-label');
  const adminDashboardBtn = document.getElementById('admin-dashboard-btn');

  if (isRealAuthenticatedAccount()) {
    if (loginBtn) loginBtn.style.display = 'none';
    if (headerProfileBtn) headerProfileBtn.style.display = 'none';
    if (profileBtn) profileBtn.style.display = 'flex';
    if (avatarImg) {
      avatarImg.src = currentUser.avatar || 'assets/avatar_default.svg';
      avatarImg.onerror = () => {
        if (!avatarImg.src.endsWith('assets/avatar_default.svg')) {
          avatarImg.src = 'assets/avatar_default.svg';
        }
      };
    }
    if (userNameSpan) userNameSpan.textContent = currentUser.username;

    if (adminDashboardBtn) {
      if (currentUser.username === 'ReiKatari' || currentUser.role === 'admin') {
        adminDashboardBtn.style.display = 'inline-flex';
      } else {
        adminDashboardBtn.style.display = 'none';
      }
    }
  } else {
    if (loginBtn) loginBtn.style.display = 'inline-flex';
    if (headerProfileBtn) headerProfileBtn.style.display = 'inline-flex';
    if (profileBtn) profileBtn.style.display = 'none';
    if (adminDashboardBtn) adminDashboardBtn.style.display = 'none';
  }

  updateFamilyHeaderUI();
}

function buildStylizedAvatarSvgUri({ c1, c2, accent, kind, visor, glyph }) {
  const id = (kind + c1 + c2).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
  let art = '';
  if (kind === 'mecha') {
    art = `
      <polygon points="50,12 82,28 78,70 50,88 22,70 18,28" fill="url(#g_${id})" stroke="${accent}" stroke-width="2.5"/>
      <polygon points="32,10 42,24 24,28" fill="${accent}" opacity="0.85"/>
      <polygon points="68,10 58,24 76,28" fill="${accent}" opacity="0.85"/>
      <rect x="26" y="38" width="48" height="14" rx="7" fill="#090d16" stroke="${visor}" stroke-width="2"/>
      <rect x="31" y="42" width="14" height="6" rx="3" fill="${visor}"/>
      <rect x="55" y="42" width="14" height="6" rx="3" fill="${visor}"/>
      <path d="M36 66 L50 73 L64 66" stroke="${accent}" stroke-width="3" fill="none" stroke-linecap="round"/>
    `;
  } else if (kind === 'kitsune') {
    art = `
      <polygon points="20,14 42,32 24,52" fill="${c1}" stroke="${accent}" stroke-width="2"/>
      <polygon points="80,14 58,32 76,52" fill="${c1}" stroke="${accent}" stroke-width="2"/>
      <path d="M22,42 C22,24 78,24 78,42 C78,66 58,84 50,88 C42,84 22,66 22,42 Z" fill="url(#g_${id})" stroke="${accent}" stroke-width="2.5"/>
      <path d="M30,46 Q40,39 46,47" stroke="${visor}" stroke-width="3.5" fill="none" stroke-linecap="round"/>
      <path d="M70,46 Q60,39 54,47" stroke="${visor}" stroke-width="3.5" fill="none" stroke-linecap="round"/>
      <polygon points="46,62 54,62 50,69" fill="${visor}"/>
      <circle cx="50" cy="30" r="4.5" fill="${visor}"/>
    `;
  } else if (kind === 'astro') {
    art = `
      <circle cx="50" cy="50" r="34" fill="url(#g_${id})" stroke="${accent}" stroke-width="2.8"/>
      <rect x="25" y="32" width="50" height="30" rx="15" fill="#070b14" stroke="${visor}" stroke-width="2.2"/>
      <path d="M32,40 Q50,33 66,42" stroke="${visor}" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.9"/>
      <circle cx="38" cy="49" r="3.5" fill="${accent}"/>
      <circle cx="62" cy="49" r="3.5" fill="${accent}"/>
      <rect x="42" y="70" width="16" height="6" rx="3" fill="${visor}" opacity="0.85"/>
    `;
  } else if (kind === 'samurai') {
    art = `
      <path d="M16,38 L50,14 L84,38 L74,44 L26,44 Z" fill="${c2}" stroke="${accent}" stroke-width="2.2"/>
      <circle cx="50" cy="24" r="6" fill="${visor}"/>
      <path d="M26,42 L74,42 L68,78 L50,88 L32,78 Z" fill="url(#g_${id})" stroke="${accent}" stroke-width="2.2"/>
      <rect x="31" y="48" width="38" height="11" rx="5.5" fill="#090d16" stroke="${visor}" stroke-width="1.8"/>
      <circle cx="41" cy="53.5" r="3" fill="${visor}"/>
      <circle cx="59" cy="53.5" r="3" fill="${visor}"/>
      <path d="M37,70 L50,65 L63,70" stroke="${visor}" stroke-width="2.8" fill="none" stroke-linecap="round"/>
    `;
  } else if (kind === 'royal') {
    art = `
      <circle cx="50" cy="54" r="30" fill="url(#g_${id})" stroke="${accent}" stroke-width="2.5"/>
      <polygon points="22,38 32,16 44,30 50,12 56,30 68,16 78,38" fill="${visor}" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>
      <circle cx="39" cy="53" r="4" fill="#ffffff"/>
      <circle cx="61" cy="53" r="4" fill="#ffffff"/>
      <path d="M40,67 Q50,74 60,67" stroke="${visor}" stroke-width="3" fill="none" stroke-linecap="round"/>
    `;
  } else {
    art = `
      <rect x="20" y="20" width="60" height="60" rx="22" fill="url(#g_${id})" stroke="${accent}" stroke-width="2.5"/>
      <circle cx="38" cy="46" r="5" fill="#090d16"/><circle cx="39.5" cy="44.5" r="2" fill="${visor}"/>
      <circle cx="62" cy="46" r="5" fill="#090d16"/><circle cx="63.5" cy="44.5" r="2" fill="${visor}"/>
      <path d="M39,63 Q50,71 61,63" stroke="${visor}" stroke-width="3.2" fill="none" stroke-linecap="round"/>
    `;
  }
  const badge = glyph ? `<text x="50" y="83" text-anchor="middle" font-size="14" font-family="Segoe UI Emoji, Apple Color Emoji, sans-serif">${glyph}</text>` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <defs>
      <linearGradient id="bg_${id}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${c1}"/>
        <stop offset="100%" stop-color="${c2}"/>
      </linearGradient>
      <linearGradient id="g_${id}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#1e293b"/>
        <stop offset="100%" stop-color="#0f172a"/>
      </linearGradient>
    </defs>
    <rect width="100" height="100" rx="26" fill="url(#bg_${id})"/>
    <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="1.5"/>
    ${art}
    ${badge}
  </svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg.trim().replace(/\s+/g, ' '));
}

const RAW_STYLIZED_AVATARS = [
  // 1. Киберпанк и Неон (10)
  { id: 'cyber-titan', label: 'Кибер-Титан', cat: 'Киберпанк', kind: 'mecha', c1: '#00d2ff', c2: '#0051ff', accent: '#38bdf8', visor: '#00f0ff', glyph: '⚡', bg: 'linear-gradient(135deg, #00d2ff, #0051ff)' },
  { id: 'neon-samurai', label: 'Неоновый Самурай', cat: 'Киберпанк', kind: 'samurai', c1: '#ff007f', c2: '#7928ca', accent: '#f472b6', visor: '#00f0ff', glyph: '⚔️', bg: 'linear-gradient(135deg, #ff007f, #7928ca)' },
  { id: 'netrunner-zero', label: 'Нетраннер Зеро', cat: 'Киберпанк', kind: 'mecha', c1: '#00ff66', c2: '#059669', accent: '#34d399', visor: '#a7f3d0', glyph: '🕶️', bg: 'linear-gradient(135deg, #00ff66, #059669)' },
  { id: 'synth-valkyrie', label: 'Синт-Валькирия', cat: 'Киберпанк', kind: 'royal', c1: '#a855f7', c2: '#4338ca', accent: '#e879f9', visor: '#fde047', glyph: '✨', bg: 'linear-gradient(135deg, #a855f7, #4338ca)' },
  { id: 'chrome-ronin', label: 'Хромовый Ронин', cat: 'Киберпанк', kind: 'samurai', c1: '#475569', c2: '#0f172a', accent: '#94a3b8', visor: '#ef4444', glyph: '🗡️', bg: 'linear-gradient(135deg, #475569, #0f172a)' },
  { id: 'quantum-ghost', label: 'Квантовый Призрак', cat: 'Киберпанк', kind: 'astro', c1: '#06b6d4', c2: '#3b82f6', accent: '#67e8f9', visor: '#ffffff', glyph: '💠', bg: 'linear-gradient(135deg, #06b6d4, #3b82f6)' },
  { id: 'night-city-v', label: 'Агент Найт-Сити', cat: 'Киберпанк', kind: 'mecha', c1: '#facc15', c2: '#ea580c', accent: '#fde047', visor: '#00f0ff', glyph: '🔥', bg: 'linear-gradient(135deg, #facc15, #ea580c)' },
  { id: 'matrix-architect', label: 'Архитектор Матрицы', cat: 'Киберпанк', kind: 'astro', c1: '#10b981', c2: '#064e3b', accent: '#6ee7b7', visor: '#00ff66', glyph: '💻', bg: 'linear-gradient(135deg, #10b981, #064e3b)' },
  { id: 'pulse-hacker', label: 'Пульс-Хакер', cat: 'Киберпанк', kind: 'kitsune', c1: '#ec4899', c2: '#6366f1', accent: '#f9a8d4', visor: '#38bdf8', glyph: '🎧', bg: 'linear-gradient(135deg, #ec4899, #6366f1)' },
  { id: 'aegis-droid', label: 'Дроид Эгида', cat: 'Киберпанк', kind: 'mecha', c1: '#38bdf8', c2: '#1d4ed8', accent: '#bae6fd', visor: '#facc15', glyph: '🛡️', bg: 'linear-gradient(135deg, #38bdf8, #1d4ed8)' },

  // 2. Аниме и Фэнтези (10)
  { id: 'kitsune-spirit', label: 'Дух Кицунэ', cat: 'Аниме и Фэнтези', kind: 'kitsune', c1: '#f97316', c2: '#dc2626', accent: '#fdba74', visor: '#fef08a', glyph: '🦊', bg: 'linear-gradient(135deg, #f97316, #dc2626)' },
  { id: 'shadow-shinobi', label: 'Шиноби Тени', cat: 'Аниме и Фэнтези', kind: 'samurai', c1: '#312e81', c2: '#1e1b4b', accent: '#818cf8', visor: '#c084fc', glyph: '🥷', bg: 'linear-gradient(135deg, #312e81, #1e1b4b)' },
  { id: 'arcane-archmage', label: 'Архимаг Эфира', cat: 'Аниме и Фэнтези', kind: 'royal', c1: '#8b5cf6', c2: '#3b0764', accent: '#d8b4fe', visor: '#38bdf8', glyph: '🔮', bg: 'linear-gradient(135deg, #8b5cf6, #3b0764)' },
  { id: 'crimson-alchemist', label: 'Алый Алхимик', cat: 'Аниме и Фэнтези', kind: 'samurai', c1: '#ef4444', c2: '#7f1d1d', accent: '#fca5a5', visor: '#fbbf24', glyph: '⚗️', bg: 'linear-gradient(135deg, #ef4444, #7f1d1d)' },
  { id: 'sakura-empress', label: 'Императрица Сакуры', cat: 'Аниме и Фэнтези', kind: 'royal', c1: '#f472b6', c2: '#be185d', accent: '#fbcfe8', visor: '#fef08a', glyph: '🌸', bg: 'linear-gradient(135deg, #f472b6, #be185d)' },
  { id: 'dragon-lord', label: 'Повелитель Драконов', cat: 'Аниме и Фэнтези', kind: 'mecha', c1: '#dc2626', c2: '#991b1b', accent: '#f59e0b', visor: '#fde047', glyph: '🐉', bg: 'linear-gradient(135deg, #dc2626, #991b1b)' },
  { id: 'moonlight-neko', label: 'Лунная Нэко', cat: 'Аниме и Фэнтези', kind: 'kitsune', c1: '#c084fc', c2: '#6b21a8', accent: '#f3e8ff', visor: '#fde047', glyph: '🌙', bg: 'linear-gradient(135deg, #c084fc, #6b21a8)' },
  { id: 'celestial-paladin', label: 'Небесный Паладин', cat: 'Аниме и Фэнтези', kind: 'royal', c1: '#fbbf24', c2: '#b45309', accent: '#fef3c7', visor: '#38bdf8', glyph: '👑', bg: 'linear-gradient(135deg, #fbbf24, #b45309)' },
  { id: 'abyssal-reaper', label: 'Жнец Бездны', cat: 'Аниме и Фэнтези', kind: 'samurai', c1: '#4c1d95', c2: '#090d16', accent: '#a78bfa', visor: '#f43f5e', glyph: '💀', bg: 'linear-gradient(135deg, #4c1d95, #090d16)' },
  { id: 'storm-shonen', label: 'Герой Бури', cat: 'Аниме и Фэнтези', kind: 'kitsune', c1: '#0284c7', c2: '#0369a1', accent: '#7dd3fc', visor: '#facc15', glyph: '⚡', bg: 'linear-gradient(135deg, #0284c7, #0369a1)' },

  // 3. Космос и Sci-Fi (10)
  { id: 'star-commander', label: 'Звёздный Командор', cat: 'Космос', kind: 'astro', c1: '#2563eb', c2: '#1e3a8a', accent: '#93c5fd', visor: '#38bdf8', glyph: '🚀', bg: 'linear-gradient(135deg, #2563eb, #1e3a8a)' },
  { id: 'nova-voyager', label: 'Странник Сверхновой', cat: 'Космос', kind: 'astro', c1: '#7c3aed', c2: '#ec4899', accent: '#f9a8d4', visor: '#fde047', glyph: '🪐', bg: 'linear-gradient(135deg, #7c3aed, #ec4899)' },
  { id: 'galactic-corsair', label: 'Галактический Корсар', cat: 'Космос', kind: 'samurai', c1: '#0ea5e9', c2: '#312e81', accent: '#67e8f9', visor: '#f43f5e', glyph: '☄️', bg: 'linear-gradient(135deg, #0ea5e9, #312e81)' },
  { id: 'nebula-oracle', label: 'Оракул Туманности', cat: 'Космос', kind: 'royal', c1: '#d946ef', c2: '#4f46e5', accent: '#f5d0fe', visor: '#00f0ff', glyph: '🌌', bg: 'linear-gradient(135deg, #d946ef, #4f46e5)' },
  { id: 'orbital-guardian', label: 'Орбитальный Страж', cat: 'Космос', kind: 'mecha', c1: '#14b8a6', c2: '#0f766e', accent: '#99f6e4', visor: '#fef08a', glyph: '🛰️', bg: 'linear-gradient(135deg, #14b8a6, #0f766e)' },
  { id: 'chrono-pilot', label: 'Хроно-Пилот', cat: 'Космос', kind: 'astro', c1: '#f59e0b', c2: '#7c2d12', accent: '#fde68a', visor: '#38bdf8', glyph: '⏱️', bg: 'linear-gradient(135deg, #f59e0b, #7c2d12)' },
  { id: 'eclipse-templar', label: 'Тамплиер Затмения', cat: 'Космос', kind: 'samurai', c1: '#1e293b', c2: '#020617', accent: '#f59e0b', visor: '#fbbf24', glyph: '🌑', bg: 'linear-gradient(135deg, #1e293b, #020617)' },
  { id: 'plasma-valkyrie', label: 'Плазменная Валькирия', cat: 'Космос', kind: 'kitsune', c1: '#06b6d4', c2: '#7e22ce', accent: '#a5f3fc', visor: '#f472b6', glyph: '💫', bg: 'linear-gradient(135deg, #06b6d4, #7e22ce)' },
  { id: 'void-navigator', label: 'Навигатор Пустоты', cat: 'Космос', kind: 'astro', c1: '#4338ca', c2: '#0f172a', accent: '#a5b4fc', visor: '#2dd4bf', glyph: '🧭', bg: 'linear-gradient(135deg, #4338ca, #0f172a)' },
  { id: 'hyperion-prime', label: 'Гиперион Прайм', cat: 'Космос', kind: 'mecha', c1: '#eab308', c2: '#a16207', accent: '#fef08a', visor: '#00f0ff', glyph: '☀️', bg: 'linear-gradient(135deg, #eab308, #a16207)' },

  // 4. Кино, Игры и Поп-культура (10)
  { id: 'cinema-maestro', label: 'Маэстро Кино', cat: 'Кино и Игры', kind: 'royal', c1: '#e11d48', c2: '#881337', accent: '#fda4af', visor: '#fde047', glyph: '🎬', bg: 'linear-gradient(135deg, #e11d48, #881337)' },
  { id: 'imax-vip', label: 'Властелин 4K UHD', cat: 'Кино и Игры', kind: 'astro', c1: '#d97706', c2: '#78350f', accent: '#fcd34d', visor: '#ffffff', glyph: '🍿', bg: 'linear-gradient(135deg, #d97706, #78350f)' },
  { id: 'pro-esports', label: 'Киберспортсмен', cat: 'Кино и Игры', kind: 'mecha', c1: '#8b5cf6', c2: '#ec4899', accent: '#ddd6fe', visor: '#00ff66', glyph: '🎮', bg: 'linear-gradient(135deg, #8b5cf6, #ec4899)' },
  { id: 'arcade-legend', label: 'Легенда Аркад', cat: 'Кино и Игры', kind: 'cute', c1: '#22c55e', c2: '#15803d', accent: '#bbf7d0', visor: '#fde047', glyph: '👾', bg: 'linear-gradient(135deg, #22c55e, #15803d)' },
  { id: 'noir-detective', label: 'Нуар-Детектив', cat: 'Кино и Игры', kind: 'samurai', c1: '#52525b', c2: '#18181b', accent: '#d4d4d8', visor: '#f59e0b', glyph: '🕵️', bg: 'linear-gradient(135deg, #52525b, #18181b)' },
  { id: 'phantom-opera', label: 'Призрак Театра', cat: 'Кино и Игры', kind: 'royal', c1: '#b45309', c2: '#451a03', accent: '#fcd34d', visor: '#f8fafc', glyph: '🎭', bg: 'linear-gradient(135deg, #b45309, #451a03)' },
  { id: 'synthwave-dj', label: 'Синтвейв Диджей', cat: 'Кино и Игры', kind: 'astro', c1: '#f43f5e', c2: '#6366f1', accent: '#fda4af', visor: '#38bdf8', glyph: '🎵', bg: 'linear-gradient(135deg, #f43f5e, #6366f1)' },
  { id: 'oscar-sovereign', label: 'Золотой Триумфатор', cat: 'Кино и Игры', kind: 'royal', c1: '#eab308', c2: '#ca8a04', accent: '#fef9c3', visor: '#ffffff', glyph: '🏆', bg: 'linear-gradient(135deg, #eab308, #ca8a04)' },
  { id: 'vr-champion', label: 'Чемпион Метавселенной', cat: 'Кино и Игры', kind: 'astro', c1: '#00d2ff', c2: '#9333ea', accent: '#a5f3fc', visor: '#00ff66', glyph: '🥽', bg: 'linear-gradient(135deg, #00d2ff, #9333ea)' },
  { id: 'diamond-critic', label: 'Бриллиантовый Критик', cat: 'Кино и Игры', kind: 'royal', c1: '#38bdf8', c2: '#0369a1', accent: '#e0f2fe', visor: '#fde047', glyph: '💎', bg: 'linear-gradient(135deg, #38bdf8, #0369a1)' },

  // 5. Звери-хранители и Тотемы (10)
  { id: 'arctic-wolf', label: 'Полярный Волк', cat: 'Тотемы', kind: 'kitsune', c1: '#38bdf8', c2: '#1e3a8a', accent: '#bae6fd', visor: '#00f0ff', glyph: '🐺', bg: 'linear-gradient(135deg, #38bdf8, #1e3a8a)' },
  { id: 'golden-lion', label: 'Имперский Лев', cat: 'Тотемы', kind: 'royal', c1: '#f59e0b', c2: '#b45309', accent: '#fde68a', visor: '#fef08a', glyph: '🦁', bg: 'linear-gradient(135deg, #f59e0b, #b45309)' },
  { id: 'black-panther', label: 'Ночная Пантера', cat: 'Тотемы', kind: 'kitsune', c1: '#581c87', c2: '#090d16', accent: '#c084fc', visor: '#e879f9', glyph: '🐆', bg: 'linear-gradient(135deg, #581c87, #090d16)' },
  { id: 'flame-phoenix', label: 'Огненный Феникс', cat: 'Тотемы', kind: 'royal', c1: '#ef4444', c2: '#ea580c', accent: '#fed7aa', visor: '#fef08a', glyph: '🦅', bg: 'linear-gradient(135deg, #ef4444, #ea580c)' },
  { id: 'emerald-tiger', label: 'Изумрудный Тигр', cat: 'Тотемы', kind: 'kitsune', c1: '#10b981', c2: '#047857', accent: '#a7f3d0', visor: '#fde047', glyph: '🐯', bg: 'linear-gradient(135deg, #10b981, #047857)' },
  { id: 'snow-owl', label: 'Полярная Сова', cat: 'Тотемы', kind: 'cute', c1: '#64748b', c2: '#334155', accent: '#e2e8f0', visor: '#38bdf8', glyph: '🦉', bg: 'linear-gradient(135deg, #64748b, #334155)' },
  { id: 'cyber-shark', label: 'Неоновая Акула', cat: 'Тотемы', kind: 'mecha', c1: '#0284c7', c2: '#1e1b4b', accent: '#7dd3fc', visor: '#f43f5e', glyph: '🦈', bg: 'linear-gradient(135deg, #0284c7, #1e1b4b)' },
  { id: 'mystic-raven', label: 'Мистический Ворон', cat: 'Тотемы', kind: 'samurai', c1: '#4c1d95', c2: '#1e1b4b', accent: '#c4b5fd', visor: '#a855f7', glyph: '🐦‍⬛', bg: 'linear-gradient(135deg, #4c1d95, #1e1b4b)' },
  { id: 'jade-panda', label: 'Нефритовая Панда', cat: 'Тотемы', kind: 'cute', c1: '#059669', c2: '#064e3b', accent: '#6ee7b7', visor: '#ffffff', glyph: '🐼', bg: 'linear-gradient(135deg, #059669, #064e3b)' },
  { id: 'thunder-lynx', label: 'Грозовая Рысь', cat: 'Тотемы', kind: 'kitsune', c1: '#eab308', c2: '#713f12', accent: '#fef08a', visor: '#38bdf8', glyph: '⚡', bg: 'linear-gradient(135deg, #eab308, #713f12)' },

  // 6. Семья, Дети и Уют (10)
  { id: 'family-cinema', label: 'Семейный Кинозал', cat: 'Семья и Уют', kind: 'cute', c1: '#10b981', c2: '#059669', accent: '#a7f3d0', visor: '#fef08a', glyph: '👨‍👩‍👧', bg: 'linear-gradient(135deg, #10b981, #059669)' },
  { id: 'star-unicorn', label: 'Звёздный Единорог', cat: 'Семья и Уют', kind: 'kitsune', c1: '#ec4899', c2: '#8b5cf6', accent: '#fbcfe8', visor: '#fef08a', glyph: '🦄', bg: 'linear-gradient(135deg, #ec4899, #8b5cf6)' },
  { id: 'plush-teddy', label: 'Плюшевый Хранитель', cat: 'Семья и Уют', kind: 'cute', c1: '#f59e0b', c2: '#b45309', accent: '#fde68a', visor: '#ffffff', glyph: '🧸', bg: 'linear-gradient(135deg, #f59e0b, #b45309)' },
  { id: 'sunny-kitty', label: 'Солнечный Котик', cat: 'Семья и Уют', kind: 'kitsune', c1: '#fb7185', c2: '#e11d48', accent: '#ffe4e6', visor: '#fef08a', glyph: '🐱', bg: 'linear-gradient(135deg, #fb7185, #e11d48)' },
  { id: 'happy-corgi', label: 'Весёлый Корги', cat: 'Семья и Уют', kind: 'cute', c1: '#f97316', c2: '#c2410c', accent: '#ffedd5', visor: '#ffffff', glyph: '🐶', bg: 'linear-gradient(135deg, #f97316, #c2410c)' },
  { id: 'magic-bunny', label: 'Волшебный Зайка', cat: 'Семья и Уют', kind: 'kitsune', c1: '#a855f7', c2: '#ec4899', accent: '#f3e8ff', visor: '#fde047', glyph: '🐰', bg: 'linear-gradient(135deg, #a855f7, #ec4899)' },
  { id: 'little-astronaut', label: 'Юный Космонавт', cat: 'Семья и Уют', kind: 'astro', c1: '#38bdf8', c2: '#2563eb', accent: '#e0f2fe', visor: '#fde047', glyph: '🌟', bg: 'linear-gradient(135deg, #38bdf8, #2563eb)' },
  { id: 'dino-explorer', label: 'Дино-Искатель', cat: 'Семья и Уют', kind: 'cute', c1: '#22c55e', c2: '#0d9488', accent: '#dcfce7', visor: '#fef08a', glyph: '🦖', bg: 'linear-gradient(135deg, #22c55e, #0d9488)' },
  { id: 'fairy-butterfly', label: 'Фея Сказки', cat: 'Семья и Уют', kind: 'royal', c1: '#f472b6', c2: '#9333ea', accent: '#fce7f3', visor: '#67e8f9', glyph: '🦋', bg: 'linear-gradient(135deg, #f472b6, #9333ea)' },
  { id: 'cozy-penguin', label: 'Уютный Пингвинёнок', cat: 'Семья и Уют', kind: 'cute', c1: '#0ea5e9', c2: '#0369a1', accent: '#e0f2fe', visor: '#fde047', glyph: '🐧', bg: 'linear-gradient(135deg, #0ea5e9, #0369a1)' }
];

export const FAMILY_AVATAR_PRESETS = RAW_STYLIZED_AVATARS.map(item => ({
  id: item.id,
  icon: buildStylizedAvatarSvgUri(item),
  label: item.label,
  cat: item.cat,
  bg: item.bg
}));

export const AVATAR_PRESETS = FAMILY_AVATAR_PRESETS.map(item => ({
  id: item.id,
  name: item.label,
  cat: item.cat,
  bg: item.bg,
  url: item.icon
}));

export async function updateProfile(username, email, avatar, bio = '') {
  const cleanUser = String(username || '').trim() || 'Пользователь';
  const cleanEmail = String(email || '').trim() || 'user@storm.local';
  const cleanAvatar = String(avatar || '').trim() || 'assets/avatar_default.svg';
  const cleanBio = String(bio || '').trim();

  if (cleanBio) {
    localStorage.setItem('storm_profile_bio', cleanBio);
  } else {
    localStorage.removeItem('storm_profile_bio');
  }

  // Если гость или офлайн-пользователь — создаём/обновляем локальную учётную запись
  if (!currentUser) {
    loginOfflineUser(cleanUser);
  }

  try {
    const token = localStorage.getItem('storm_token') || '';
    if (token && !token.startsWith('offline_') && !token.startsWith('guest_')) {
      const res = await fetch('/api/auth/profile/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ username: cleanUser, email: cleanEmail, avatar: cleanAvatar })
      });

      if (res.ok) {
        const data = await res.json();
        currentUser = { ...currentUser, ...(data.user || data), bio: cleanBio };
      } else {
        currentUser = { ...currentUser, username: cleanUser, email: cleanEmail, avatar: cleanAvatar, bio: cleanBio };
      }
    } else {
      currentUser = { ...currentUser, username: cleanUser, email: cleanEmail, avatar: cleanAvatar, bio: cleanBio };
    }
  } catch (_) {
    currentUser = { ...currentUser, username: cleanUser, email: cleanEmail, avatar: cleanAvatar, bio: cleanBio };
  }

  localStorage.setItem('storm_user', JSON.stringify(currentUser));

  // Синхронизируем также основной профиль в семейных профилях
  const primary = familyProfiles.find(p => p.id === 'primary' || p.isDefault);
  if (primary) {
    primary.name = currentUser.username;
    if (currentUser.avatar) primary.avatar = currentUser.avatar;
    saveFamilyProfiles([...familyProfiles]);
  }

  updateAuthUI();
  notifyAuthChanged();
  showToast('✅ Профиль успешно обновлён!', 'success');
  return true;
}

export async function changePassword(oldPassword, newPassword) {
  if (!currentUser) return false;
  try {
    const res = await fetch('/api/auth/profile/password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('storm_token')}`
      },
      body: JSON.stringify({ oldPassword, newPassword })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Ошибка смены пароля');
    }

    showToast('Пароль успешно изменен!', 'success');
    return true;
  } catch (err) {
    showToast(err.message, 'error');
    return false;
  }
}

function computeLocalAndMergedProfileStats(serverStats = {}) {
  let localBookmarks = [];
  let localContinue = [];
  let localLists = [];
  let watchedEpisodesTotal = 0;
  try {
    const rawBm = localStorage.getItem('storm_local_bookmarks');
    if (rawBm) {
      const parsed = JSON.parse(rawBm);
      localBookmarks = Array.isArray(parsed) ? parsed : Object.values(parsed || {});
    }
  } catch (_) {}
  try {
    if (typeof window !== 'undefined' && Array.isArray(window.__STORM_MEMORY_BOOKMARKS__) && window.__STORM_MEMORY_BOOKMARKS__.length > 0) {
      const seenKeys = new Set(localBookmarks.map(b => String(b.media_id || b.id || b.title || '')));
      for (const mb of window.__STORM_MEMORY_BOOKMARKS__) {
        const k = String(mb.media_id || mb.id || mb.title || '');
        if (k && !seenKeys.has(k)) {
          seenKeys.add(k);
          localBookmarks.push(mb);
        }
      }
    }
  } catch (_) {}
  try {
    const rawCw = localStorage.getItem('storm_continue_watching');
    if (rawCw) {
      const parsed = JSON.parse(rawCw);
      localContinue = Array.isArray(parsed) ? parsed : Object.values(parsed || {});
    }
  } catch (_) {}
  try {
    const rawLists = localStorage.getItem('storm_custom_lists');
    if (rawLists) {
      const parsed = JSON.parse(rawLists);
      localLists = Array.isArray(parsed) ? parsed : [];
    }
  } catch (_) {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('storm_watched_eps_')) {
        const arr = JSON.parse(localStorage.getItem(k) || '[]');
        if (Array.isArray(arr)) watchedEpisodesTotal += arr.length;
      }
    }
  } catch (_) {}

  const countStatus = (statuses) => localBookmarks.filter(b => statuses.includes(b.status || b.user_status)).length;
  const localWatching = countStatus(['watching']);
  const localPlanned = countStatus(['plan', 'planned']);
  const localCompleted = countStatus(['completed', 'watched']);
  const localFavorites = localBookmarks.filter(b => b.status === 'favorite' || b.user_status === 'favorite' || b.isFavorite || b.is_favorite === 1 || b.is_favorite === true).length;
  const localHold = countStatus(['hold', 'on_hold']);
  const localDropped = countStatus(['dropped']);
  const localWont = countStatus(['wont_watch', 'abandoned']);
  const localTotalBm = localBookmarks.length;
  const localTotalLists = localLists.length;

  // Оценка часов просмотра по завершённым, просматриваемым, эпизодам и истории continue_watching
  const estimatedMinutes = (localCompleted * 110) + (localWatching * 45) + (localContinue.length * 35) + (watchedEpisodesTotal * 28);
  const savedHours = parseFloat(localStorage.getItem('storm_watched_hours') || '0') || 0;
  const localHours = Math.max(savedHours, Math.round((estimatedMinutes / 60) * 10) / 10);

  let localUnlockedAch = 0;
  try {
    const rawAch = localStorage.getItem('storm_local_achievements');
    if (rawAch) {
      const parsedAch = JSON.parse(rawAch);
      localUnlockedAch = Object.values(parsedAch || {}).filter(a => a && a.unlocked).length;
    }
  } catch (_) {}

  const savedXpLocal = parseInt(localStorage.getItem('storm_user_xp') || '0', 10) || 0;
  const savedLevelLocal = parseInt(localStorage.getItem('storm_user_level') || '1', 10) || 1;
  const savedXpServer = parseInt(serverStats.savedXp || currentUser?.settings?.profileXp || 0, 10) || 0;
  const savedLevelServer = parseInt(serverStats.savedLevel || currentUser?.settings?.profileLevel || 1, 10) || 1;

  return {
    totalWatchedHours: Math.max(Number(serverStats.totalWatchedHours || 0), localHours),
    watchingCount: Math.max(Number(serverStats.watchingCount || 0), localWatching, localContinue.length),
    plannedCount: Math.max(Number(serverStats.plannedCount || 0), localPlanned),
    completedCount: Math.max(Number(serverStats.completedCount || 0), localCompleted),
    favoritesCount: Math.max(Number(serverStats.favoritesCount || serverStats.favoriteCount || 0), localFavorites),
    onHoldCount: Math.max(Number(serverStats.onHoldCount || 0), localHold),
    droppedCount: Math.max(Number(serverStats.droppedCount || 0), localDropped),
    wontWatchCount: Math.max(Number(serverStats.wontWatchCount || 0), localWont),
    bookmarksCount: Math.max(Number(serverStats.bookmarksCount || serverStats.bookmarks_count || 0), localTotalBm),
    customListsCount: Math.max(Number(serverStats.customListsCount || 0), localTotalLists),
    unlockedAchievementsCount: Math.max(Number(serverStats.unlockedAchievementsCount || 0), localUnlockedAch),
    savedXp: Math.max(savedXpLocal, savedXpServer),
    savedLevel: Math.max(savedLevelLocal, savedLevelServer)
  };
}

const STORM_PROFILE_RANKS = [
  { minXp: 0,    level: 1, icon: '🎬', name: 'Зритель-исследователь', sub: 'Начало путешествия по кинозалу STORM' },
  { minXp: 150,  level: 2, icon: '🍿', name: 'Ценитель премьер', sub: 'Активный поиск лучших фильмов и сериалов' },
  { minXp: 350,  level: 3, icon: '⚡', name: 'Адепт 4K UHD', sub: 'Высокий вкус и коллекционирование шедевров' },
  { minXp: 700,  level: 4, icon: '💎', name: 'Хранитель коллекций', sub: 'Эксперт по редким релизам и озвучкам' },
  { minXp: 1300, level: 5, icon: '🌌', name: 'Архитектор кинозала', sub: 'Мастер персональных подборок и марафонов' },
  { minXp: 2200, level: 6, icon: '👑', name: 'Магистр STORM MULTIMEDIA', sub: 'Легендарный статус в экосистеме STORM SOFT' }
];

function computeRankAndLevelFromStats(st = {}) {
  const formulaXp = Math.round(
    (Number(st.totalWatchedHours || 0) * 25) +
    (Number(st.completedCount || 0) * 40) +
    (Number(st.watchingCount || 0) * 20) +
    (Number(st.bookmarksCount || 0) * 15) +
    (Number(st.favoritesCount || 0) * 20) +
    (Number(st.customListsCount || 0) * 50) +
    (Number(st.unlockedAchievementsCount || 0) * 35) +
    50
  );
  const minXpForSavedLevel = STORM_PROFILE_RANKS.find(r => r.level === Number(st.savedLevel || 1))?.minXp || 0;
  const xp = Math.max(formulaXp, Number(st.savedXp || 0), minXpForSavedLevel);

  let currentRank = STORM_PROFILE_RANKS[0];
  let nextRank = STORM_PROFILE_RANKS[1];
  for (let i = 0; i < STORM_PROFILE_RANKS.length; i++) {
    if (xp >= STORM_PROFILE_RANKS[i].minXp) {
      currentRank = STORM_PROFILE_RANKS[i];
      nextRank = STORM_PROFILE_RANKS[i + 1] || null;
    }
  }
  try {
    const prevXp = parseInt(localStorage.getItem('storm_user_xp') || '0', 10) || 0;
    const prevLvl = parseInt(localStorage.getItem('storm_user_level') || '1', 10) || 1;
    if (xp > prevXp) localStorage.setItem('storm_user_xp', String(xp));
    if (currentRank.level > prevLvl) localStorage.setItem('storm_user_level', String(currentRank.level));
  } catch (_) {}

  return { xp, level: currentRank.level, currentRank, nextRank };
}

function updateProfileRankUI(st = {}) {
  const { xp, currentRank, nextRank } = computeRankAndLevelFromStats(st);

  const iconEl = document.getElementById('profile-rank-icon');
  const nameEl = document.getElementById('profile-rank-name');
  const subEl = document.getElementById('profile-rank-sub');
  const levelEl = document.getElementById('profile-level-pill');
  const xpEl = document.getElementById('profile-xp-pill');
  const fillEl = document.getElementById('profile-xp-bar-fill');
  const hintEl = document.getElementById('profile-xp-hint');

  if (iconEl) iconEl.textContent = currentRank.icon;
  if (nameEl) nameEl.textContent = currentRank.name;
  if (subEl) subEl.textContent = currentRank.sub;
  if (levelEl) levelEl.textContent = `Уровень ${currentRank.level}`;
  if (xpEl) xpEl.textContent = `${xp} XP`;

  if (nextRank) {
    const span = nextRank.minXp - currentRank.minXp;
    const progress = Math.min(100, Math.max(8, Math.round(((xp - currentRank.minXp) / span) * 100)));
    if (fillEl) fillEl.style.width = `${progress}%`;
    if (hintEl) hintEl.textContent = `До ранга «${nextRank.name}»: ещё ${Math.max(0, nextRank.minXp - xp)} XP`;
  } else {
    if (fillEl) fillEl.style.width = '100%';
    if (hintEl) hintEl.textContent = 'Достигнут максимальный легендарный ранг экосистемы!';
  }
}

export function openProfileModal() {
  const modal = document.getElementById('profile-modal');
  if (!modal) return;

  const savedGuestAvatar = localStorage.getItem('storm_guest_avatar') || '';
  const currentAvatar = (currentUser && currentUser.avatar)
    ? currentUser.avatar
    : (savedGuestAvatar || FAMILY_AVATAR_PRESETS[0]?.icon || 'assets/avatar_default.svg');
  const currentAura = localStorage.getItem('storm_profile_avatar_bg') || FAMILY_BG_GRADIENTS[0].bg;
  const avatarEl = document.getElementById('profile-avatar');
  if (avatarEl) {
    avatarEl.src = currentAvatar;
    avatarEl.style.background = currentAura;
    avatarEl.style.padding = '3px';
    avatarEl.style.boxShadow = '0 0 18px rgba(0, 210, 255, 0.35)';
    avatarEl.onerror = () => {
      if (!avatarEl.src.endsWith('assets/avatar_default.svg')) {
        avatarEl.src = 'assets/avatar_default.svg';
      }
    };
  }
  const livePreviewEl = document.getElementById('edit-avatar-live-preview');
  if (livePreviewEl) {
    livePreviewEl.src = currentAvatar;
    livePreviewEl.onerror = () => {
      if (!livePreviewEl.src.endsWith('assets/avatar_default.svg')) {
        livePreviewEl.src = 'assets/avatar_default.svg';
      }
    };
  }

  const userEl = document.getElementById('profile-username');
  if (userEl) userEl.textContent = currentUser ? currentUser.username : 'Гость (Локальный профиль)';

  const emailEl = document.getElementById('profile-email');
  if (emailEl) emailEl.textContent = currentUser ? currentUser.email : 'Все закладки и история сохраняются на устройстве';

  const savedBio = currentUser?.bio || localStorage.getItem('storm_profile_bio') || 'Ценитель качественного кино и 4K UHD релизов';
  const bioDisplay = document.getElementById('profile-bio-display');
  if (bioDisplay) bioDisplay.textContent = savedBio;

  const dateEl = document.getElementById('profile-date');
  if (dateEl) dateEl.textContent = currentUser ? formatDate(currentUser.created_at) : formatDate(Date.now());

  const setStat = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val !== undefined && val !== null ? val : 0;
  };

  const updateStatsUI = (rawServerStats = {}) => {
    const st = computeLocalAndMergedProfileStats(rawServerStats);
    setStat('profile-stat-hours', st.totalWatchedHours);
    setStat('profile-stat-watching', st.watchingCount);
    setStat('profile-stat-planned', st.plannedCount);
    setStat('profile-stat-completed', st.completedCount);
    setStat('profile-stat-favorites', st.favoritesCount);
    setStat('profile-stat-onhold', st.onHoldCount);
    setStat('profile-stat-dropped', st.droppedCount);
    setStat('profile-stat-wontwatch', st.wontWatchCount);
    setStat('profile-stat-bookmarks', st.bookmarksCount);
    setStat('profile-stat-lists', st.customListsCount);
    updateProfileRankUI(st);
  };

  updateStatsUI(currentUser?.stats || {});

  // Всегда синхронизируем свежую статистику с сервера при открытии профиля
  if (currentToken && !currentToken.startsWith('offline_') && !currentToken.startsWith('guest_')) {
    fetch('/api/auth/me', { headers: { 'Authorization': `Bearer ${currentToken}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d && d.stats) {
          if (currentUser) {
            currentUser.stats = d.stats;
          }
          updateStatsUI(d.stats);
        }
      })
      .catch(e => console.warn('Ошибка обновления статистики профиля:', e.message));
  }

  // Язык интерфейса в настройках профиля
  const profileLangSelect = document.getElementById('profile-lang-select');
  if (profileLangSelect) {
    profileLangSelect.value = localStorage.getItem('storm_lang') || 'ru';
    profileLangSelect.onchange = (e) => {
      import('./i18n.js?v=1.3.1').then(m => m.setLanguage(e.target.value));
      showToast('🌐 Язык интерфейса обновлён', 'info');
    };
  }

  // Синхронизируем счётчик достижений на вкладке сразу при открытии профиля
  import('./achievements.js?v=1.3.1').then(achMod => {
    achMod.autoSyncAchievementsFromState?.();
  }).catch(() => {});

  // Тема оформления, акцент, шрифт и масштаб в настройках профиля
  import('./theme.js?v=1.3.1').then(themeMod => {
    const currentTheme = themeMod.getTheme ? themeMod.getTheme() : (localStorage.getItem('storm_theme') || 'STORM MIDNIGHT');
    const currentAccent = themeMod.getAccent ? themeMod.getAccent() : (localStorage.getItem('storm_accent') || 'default');
    const currentFont = themeMod.getFont ? themeMod.getFont() : (localStorage.getItem('storm_font') || 'Inter');
    const currentScale = themeMod.getUiScale ? themeMod.getUiScale() : (localStorage.getItem('storm_ui_scale') || '1');

    themeMod.syncThemeControlsUI?.(currentTheme);
    themeMod.syncAccentControlsUI?.(currentAccent);

    const profileThemeSelect = document.getElementById('profile-theme-select');
    if (profileThemeSelect) {
      profileThemeSelect.value = currentTheme;
      profileThemeSelect.onchange = (e) => {
        const val = e.target.value;
        themeMod.setTheme(val, { fromUser: true });
        showToast(`🎨 Тема оформления: ${val}`, 'info');
      };
    }

    const profileAccentSelect = document.getElementById('profile-accent-select');
    if (profileAccentSelect) {
      profileAccentSelect.value = currentAccent;
      profileAccentSelect.onchange = (e) => {
        const val = e.target.value;
        themeMod.setAccent(val, { fromUser: true });
        showToast('✨ Акцентный цвет обновлён', 'info');
      };
    }

    const profileFontSelect = document.getElementById('profile-font-select');
    if (profileFontSelect) {
      profileFontSelect.value = currentFont;
      profileFontSelect.onchange = (e) => {
        themeMod.setFont(e.target.value);
        showToast(`🔤 Шрифт интерфейса: ${e.target.value}`, 'info');
      };
    }

    const profileScaleSelect = document.getElementById('profile-scale-select');
    if (profileScaleSelect) {
      profileScaleSelect.value = String(currentScale);
      profileScaleSelect.onchange = (e) => {
        themeMod.setUiScale(e.target.value);
        showToast(`🔍 Масштаб интерфейса: ${Math.round(Number(e.target.value) * 100)}%`, 'info');
      };
    }
  }).catch(() => {});

  // Настройки плеера по умолчанию, AdShield, CleanView, Smart Skip и Ambilight
  try {
    if (!localStorage.getItem('storm_default_player_v42_migrated')) {
      localStorage.setItem('storm_default_player', 'lift_adfree');
      localStorage.setItem('storm_default_player_v42_migrated', '1');
    }
  } catch (_) {}

  const defaultPlayerSelect = document.getElementById('profile-default-player-select');
  if (defaultPlayerSelect) {
    const savedDefaultPlayer = localStorage.getItem('storm_default_player') || 'lift_adfree';
    defaultPlayerSelect.value = savedDefaultPlayer;
    defaultPlayerSelect.onchange = (e) => {
      const val = e.target.value || 'lift_adfree';
      localStorage.setItem('storm_default_player', val);
      localStorage.setItem('storm_default_player_v42_migrated', '1');
      import('./player.js?v=1.3.1').then(m => {
        if (m.setPreferredDefaultPlayerId) m.setPreferredDefaultPlayerId(val);
      }).catch(() => {});
      const selectedOptionText = defaultPlayerSelect.options[defaultPlayerSelect.selectedIndex]?.text || val;
      showToast(`🎬 Плеер по умолчанию: ${selectedOptionText}`, 'success');
    };
  }

  const adblockToggle = document.getElementById('profile-adblock-toggle');
  if (adblockToggle) {
    adblockToggle.checked = localStorage.getItem('storm_adblock_enabled') !== 'false';
    adblockToggle.onchange = (e) => {
      const enabled = e.target.checked;
      localStorage.setItem('storm_adblock_enabled', enabled ? 'true' : 'false');
      import('./player.js?v=1.3.1').then(m => {
        if (m.setAdblockEnabled) m.setAdblockEnabled(enabled);
      }).catch(() => {});
      import('./ad-shield.js?v=1.3.1').then(m => {
        if (m.setAdShieldEnabled) m.setAdShieldEnabled(enabled);
      }).catch(() => {});
      showToast(enabled ? '🛡️ Защита от рекламы AdShield включена' : '⚪ Блокировка рекламы отключена', 'info');
    };
  }

  const cleanviewToggle = document.getElementById('profile-cleanview-toggle');
  if (cleanviewToggle) {
    try {
      const rawClean = localStorage.getItem('storm_cleanview_settings');
      const parsedClean = rawClean ? JSON.parse(rawClean) : {};
      cleanviewToggle.checked = Boolean(parsedClean.watermarkMaskEnabled);
    } catch (_) {
      cleanviewToggle.checked = false;
    }
    cleanviewToggle.onchange = (e) => {
      const enabled = e.target.checked;
      try {
        const raw = localStorage.getItem('storm_cleanview_settings');
        const parsed = raw ? JSON.parse(raw) : {};
        parsed.watermarkMaskEnabled = enabled;
        localStorage.setItem('storm_cleanview_settings', JSON.stringify(parsed));
      } catch (_) {}
      import('./ad-shield.js?v=1.3.1').then(m => {
        if (m.setCleanViewMaskEnabled) m.setCleanViewMaskEnabled(enabled);
      }).catch(() => {});
      showToast(enabled ? '✂️ Маскирование водяных знаков CleanView включено' : '⚪ Маска водяных знаков выключена', 'info');
    };
  }

  const autoskipToggle = document.getElementById('profile-autoskip-toggle');
  if (autoskipToggle) {
    autoskipToggle.checked = localStorage.getItem('storm_autoskip_intro') !== 'false';
    autoskipToggle.onchange = (e) => {
      const enabled = e.target.checked;
      localStorage.setItem('storm_autoskip_intro', enabled ? 'true' : 'false');
      import('./smart-skip.js?v=1.3.1').then(m => {
        if (m.setAutoSkipIntroEnabled) m.setAutoSkipIntroEnabled(enabled);
      }).catch(() => {});
      showToast(enabled ? '⏩ Автопропуск заставок и титров включен' : '⚪ Автопропуск заставок выключен', 'info');
    };
  }

  const autonextToggle = document.getElementById('profile-autonext-toggle');
  if (autonextToggle) {
    autonextToggle.checked = localStorage.getItem('storm_autonext_enabled') !== 'false';
    autonextToggle.onchange = (e) => {
      const enabled = e.target.checked;
      localStorage.setItem('storm_autonext_enabled', enabled ? 'true' : 'false');
      import('./player.js?v=1.3.1').then(m => {
        if (m.setAutoNextEnabled) m.setAutoNextEnabled(enabled);
      }).catch(() => {});
      showToast(enabled ? '⏭ Автопереключение серий и резервный плеер включены' : '⚪ Автопереключение серий выключено', 'info');
    };
  }

  const ambilightToggle = document.getElementById('profile-ambilight-toggle');
  if (ambilightToggle) {
    ambilightToggle.checked = localStorage.getItem('storm_ambilight') !== 'false';
    ambilightToggle.onchange = (e) => {
      const enabled = e.target.checked;
      localStorage.setItem('storm_ambilight', enabled ? 'true' : 'false');
      const ambiAura = document.getElementById('player-ambilight-aura');
      if (ambiAura) {
        ambiAura.classList.toggle('active', enabled);
        ambiAura.style.opacity = enabled ? '0.85' : '0';
      }
      import('./player.js?v=1.3.1').then(m => {
        if (m.setAmbilightEnabled) m.setAmbilightEnabled(enabled);
      }).catch(() => {});
      if (enabled) {
        import('./achievements.js?v=1.3.1').then(m => m.trackClientAction?.('use_ambilight')).catch(() => {});
      }
      showToast(enabled ? '✨ Подсветка Ambilight включена' : '⚪ Подсветка Ambilight выключена', 'info');
    };
  }

  // Настройки безопасности: Детский безопасный режим и история
  const kidModeToggle = document.getElementById('profile-security-kid-toggle');
  if (kidModeToggle) {
    const activeFam = getActiveProfile();
    kidModeToggle.checked = Boolean(activeFam?.isKid || localStorage.getItem('storm_kid_safe_mode') === 'true');
    kidModeToggle.onchange = (e) => {
      const isKid = e.target.checked;
      localStorage.setItem('storm_kid_safe_mode', isKid ? 'true' : 'false');
      const prof = getActiveProfile();
      if (prof) {
        prof.isKid = isKid;
        saveFamilyProfiles([...familyProfiles]);
      }
      updateFamilyHeaderUI();
      if (typeof window.stormRefreshCatalog === 'function') window.stormRefreshCatalog();
      showToast(isKid ? '🛡️ Детский безопасный режим (Фильтр 18+) включён' : '⚪ Детский режим отключён', 'info');
    };
  }

  const historyToggle = document.getElementById('profile-security-history-toggle');
  if (historyToggle) {
    historyToggle.checked = localStorage.getItem('storm_save_history') !== 'false';
    historyToggle.onchange = (e) => {
      localStorage.setItem('storm_save_history', e.target.checked ? 'true' : 'false');
      showToast(e.target.checked ? '⏱️ Сохранение истории просмотров включено' : '⚪ История просмотров приостановлена', 'info');
    };
  }

  // Заполняем форму редактирования профиля
  const inputUser = document.getElementById('edit-profile-username');
  if (inputUser) inputUser.value = currentUser ? currentUser.username : '';

  const inputEmail = document.getElementById('edit-profile-email');
  if (inputEmail) inputEmail.value = currentUser ? currentUser.email : '';

  const inputAvatar = document.getElementById('edit-avatar-url');
  if (inputAvatar) inputAvatar.value = currentUser?.avatar || '';

  const inputBio = document.getElementById('edit-profile-bio');
  if (inputBio) inputBio.value = savedBio;

  // Рендерим пресеты аватарок
  renderAvatarPresets(currentUser?.avatar || '');

  // Кнопка выхода / входа и быстрой регистрации внизу модалки
  const logoutBtn = document.getElementById('profile-logout-btn');
  const regSwitchBtn = document.getElementById('profile-register-switch-btn');
  if (regSwitchBtn) {
    regSwitchBtn.textContent = currentUser ? '✨ Новый аккаунт / Сменить профиль' : '✨ Создать аккаунт (Регистрация)';
    regSwitchBtn.onclick = () => {
      modal.classList.remove('is-open');
      if (typeof window.openStormAuthModal === 'function') {
        window.openStormAuthModal('register');
      } else {
        const authModal = document.getElementById('auth-modal');
        if (authModal) authModal.classList.add('is-open');
        document.getElementById('switch-to-register')?.click();
      }
    };
  }
  if (logoutBtn) {
    if (currentUser) {
      logoutBtn.textContent = t('auth_logout') || 'Выйти из аккаунта';
      logoutBtn.className = 'storm-btn storm-btn-danger';
      logoutBtn.onclick = async () => {
        await logout();
        modal.classList.remove('is-open');
      };
    } else {
      logoutBtn.textContent = 'Войти в аккаунт';
      logoutBtn.className = 'storm-btn storm-btn-primary';
      logoutBtn.onclick = () => {
        modal.classList.remove('is-open');
        if (typeof window.openStormAuthModal === 'function') {
          window.openStormAuthModal('login');
        } else {
          const authModal = document.getElementById('auth-modal');
          if (authModal) authModal.classList.add('is-open');
        }
      };
    }
  }

  const addAccBtn = document.getElementById('profile-add-account-btn');
  if (addAccBtn) {
    addAccBtn.onclick = () => {
      modal.classList.remove('is-open');
      if (typeof window.openStormAuthModal === 'function') {
        window.openStormAuthModal('login');
      } else {
        document.getElementById('auth-modal')?.classList.add('is-open');
      }
    };
  }
  const switcherCard = document.getElementById('profile-account-switcher-card');
  if (!isRealAuthenticatedAccount()) {
    if (switcherCard) switcherCard.style.display = 'none';
  } else {
    if (switcherCard) switcherCard.style.display = 'block';
    fetchSavedAccounts().catch(() => {});
    loadProfileRecoveryConfigUI().catch(() => {});
  }

  // Сбрасываем активную вкладку на 'overview'
  switchProfileTab('overview');

  modal.classList.add('is-open');
}

function renderAvatarPresets(selectedUrl) {
  const container = document.getElementById('avatar-presets-container');
  if (!container) return;

  let catBar = document.getElementById('profile-avatar-cat-bar');
  if (!catBar && container.parentElement) {
    catBar = document.createElement('div');
    catBar.id = 'profile-avatar-cat-bar';
    catBar.style.cssText = 'display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px;';
    container.parentElement.insertBefore(catBar, container);
  }
  if (catBar) {
    const cats = ['Все', 'Киберпанк', 'Аниме и Фэнтези', 'Космос', 'Кино и Игры', 'Тотемы', 'Семья и Уют'];
    catBar.innerHTML = cats.map((cat, idx) => `
      <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm profile-avatar-cat-pill ${idx === 0 ? 'active' : ''}" data-cat="${cat}" style="font-size: 11px; padding: 4px 10px; border-radius: 999px; ${idx === 0 ? 'background: var(--accent); color: #090d16; font-weight: 800;' : ''}">${cat === 'Все' ? 'Все (60)' : cat}</button>
    `).join('');
    catBar.querySelectorAll('.profile-avatar-cat-pill').forEach(btn => {
      btn.onclick = () => {
        catBar.querySelectorAll('.profile-avatar-cat-pill').forEach(b => {
          b.classList.remove('active');
          b.style.background = '';
          b.style.color = '';
          b.style.fontWeight = '';
        });
        btn.classList.add('active');
        btn.style.background = 'var(--accent)';
        btn.style.color = '#090d16';
        btn.style.fontWeight = '800';
        const c = btn.dataset.cat;
        container.querySelectorAll('.avatar-preset-item').forEach(el => {
          el.style.display = (c === 'Все' || el.dataset.cat === c) ? 'flex' : 'none';
        });
      };
    });
  }

  container.innerHTML = AVATAR_PRESETS.map(preset => `
    <div class="avatar-preset-item ${selectedUrl === preset.url ? 'selected' : ''}" data-cat="${preset.cat || ''}" data-bg="${preset.bg || ''}" data-url="${preset.url}" title="${preset.name} (${preset.cat || ''})" style="background: ${preset.bg || 'var(--bg-secondary)'}; padding: 2px; border-radius: 14px;">
      <img src="${preset.url}" alt="${preset.name}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 12px;">
    </div>
  `).join('');

  container.querySelectorAll('.avatar-preset-item').forEach(item => {
    item.addEventListener('click', () => {
      container.querySelectorAll('.avatar-preset-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
      const url = item.dataset.url;
      if (!isRealAuthenticatedAccount()) {
        localStorage.setItem('storm_guest_avatar', url);
      }
      const input = document.getElementById('edit-avatar-url');
      if (input) input.value = url;
      const profileAvatar = document.getElementById('profile-avatar');
      if (profileAvatar) profileAvatar.src = url;
      const livePreview = document.getElementById('edit-avatar-live-preview');
      if (livePreview) livePreview.src = url;
    });
  });

  const auraContainer = document.getElementById('profile-aura-presets-container');
  if (auraContainer) {
    const currentAura = localStorage.getItem('storm_profile_avatar_bg') || FAMILY_BG_GRADIENTS[0].bg;
    auraContainer.innerHTML = FAMILY_BG_GRADIENTS.map(g => `
      <button type="button" class="family-bg-swatch ${g.bg === currentAura ? 'selected' : ''}" data-bg="${g.bg}" title="${g.label}" style="background: ${g.bg}; width: 34px; height: 34px; border-radius: 10px; border: 2px solid ${g.bg === currentAura ? '#ffffff' : 'rgba(255,255,255,0.18)'}; cursor: pointer;"></button>
    `).join('');
    auraContainer.querySelectorAll('.family-bg-swatch').forEach(sw => {
      sw.onclick = () => {
        const bg = sw.dataset.bg;
        localStorage.setItem('storm_profile_avatar_bg', bg);
        auraContainer.querySelectorAll('.family-bg-swatch').forEach(s => {
          s.classList.remove('selected');
          s.style.borderColor = 'rgba(255,255,255,0.18)';
        });
        sw.classList.add('selected');
        sw.style.borderColor = '#ffffff';
        const profileAvatar = document.getElementById('profile-avatar');
        if (profileAvatar) {
          profileAvatar.style.background = bg;
          profileAvatar.style.padding = '3px';
        }
        const livePreview = document.getElementById('edit-avatar-live-preview');
        if (livePreview) {
          livePreview.style.background = bg;
          livePreview.style.padding = '3px';
        }
        showToast('✨ Цветовая аура аватара обновлена', 'info');
      };
    });
  }
}

export function switchProfileTab(tabName) {
  document.querySelectorAll('.profile-tab-link').forEach(link => {
    link.classList.toggle('active', link.dataset.ptab === tabName);
  });

  const overview = document.getElementById('ptab-content-overview');
  const achievements = document.getElementById('ptab-content-achievements');
  const edit = document.getElementById('ptab-content-edit');
  const security = document.getElementById('ptab-content-security');

  if (overview) overview.style.display = tabName === 'overview' ? 'block' : 'none';
  if (edit) edit.style.display = tabName === 'edit' ? 'block' : 'none';
  if (security) security.style.display = tabName === 'security' ? 'block' : 'none';

  if (achievements) {
    achievements.style.display = tabName === 'achievements' ? 'block' : 'none';
    if (tabName === 'achievements') {
      import('./achievements.js?v=1.3.1').then(m => m.renderProfileAchievements(achievements));
    }
  }
}

export function initProfileHandlers() {
  // Переключение вкладок модалки профиля
  document.querySelectorAll('.profile-tab-link').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.ptab;
      switchProfileTab(tab);
    });
  });

  // Быстрые переходы внутри карточки героя профиля
  const avatarQuickEdit = document.getElementById('profile-avatar-quick-edit');
  if (avatarQuickEdit) avatarQuickEdit.addEventListener('click', () => switchProfileTab('edit'));

  const jumpEditBtn = document.getElementById('profile-jump-edit-btn');
  if (jumpEditBtn) jumpEditBtn.addEventListener('click', () => switchProfileTab('edit'));

  const jumpAchBtn = document.getElementById('profile-jump-achievements-btn');
  if (jumpAchBtn) jumpAchBtn.addEventListener('click', () => switchProfileTab('achievements'));

  // Интерактивные 3D-карточки статистики -> переход сразу к списку
  document.querySelectorAll('.profile-interactive-stat-card[data-stat-target]').forEach(card => {
    card.addEventListener('click', () => {
      const target = card.getAttribute('data-stat-target');
      const modal = document.getElementById('profile-modal');
      if (modal) modal.classList.remove('is-open');

      if (target === 'continue') {
        if (typeof window.switchTab === 'function') window.switchTab('continue');
      } else if (target === 'lists') {
        if (typeof window.switchTab === 'function') window.switchTab('bookmarks', { subTab: 'lists' });
        showToast('📁 Открыты ваши коллекции', 'info');
      } else if (target) {
        if (typeof window.switchTab === 'function') window.switchTab('bookmarks', { subTab: target });
      }
    });
  });

  // Быстрый центр сервисов в профиле
  const bindProfileHub = (btnId, headerBtnId) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener('click', () => {
      const modal = document.getElementById('profile-modal');
      if (modal) modal.classList.remove('is-open');
      const targetBtn = document.getElementById(headerBtnId);
      if (targetBtn) targetBtn.click();
    });
  };
  bindProfileHub('profile-hub-recommender', 'header-recommender-btn');
  bindProfileHub('profile-hub-calendar', 'header-calendar-btn');
  bindProfileHub('profile-hub-rooms', 'header-rooms-btn');
  bindProfileHub('profile-hub-sync', 'header-sync-btn');

  // Экспорт и импорт базы JSON во вкладке Безопасность
  const exportJsonBtn = document.getElementById('profile-export-json-btn');
  if (exportJsonBtn) {
    exportJsonBtn.addEventListener('click', () => {
      try {
        const payload = {
          app: 'STORM MULTIMEDIA',
          version: '1.1.2',
          exportedAt: new Date().toISOString(),
          bookmarks: JSON.parse(localStorage.getItem('storm_local_bookmarks') || '{}'),
          customLists: JSON.parse(localStorage.getItem('storm_custom_lists') || '[]'),
          continueWatching: JSON.parse(localStorage.getItem('storm_continue_watching') || '[]'),
          theme: localStorage.getItem('storm_theme') || 'STORM MIDNIGHT',
          accent: localStorage.getItem('storm_accent') || 'default',
          defaultPlayer: localStorage.getItem('storm_default_player') || 'lift_adfree',
          bio: localStorage.getItem('storm_profile_bio') || ''
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const dateStr = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = `STORM_MULTIMEDIA_Backup_${dateStr}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        import('./achievements.js?v=1.3.1').then(m => m.trackClientAction?.('sync_data')).catch(() => {});
        showToast('📥 Резервная копия базы успешно сохранена!', 'success');
      } catch (err) {
        showToast('Ошибка экспорта базы: ' + err.message, 'error');
      }
    });
  }

  const importJsonInput = document.getElementById('profile-import-json-input');
  if (importJsonInput) {
    importJsonInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const data = JSON.parse(String(evt.target?.result || '{}'));
          if (data.bookmarks && typeof data.bookmarks === 'object') {
            localStorage.setItem('storm_local_bookmarks', JSON.stringify(data.bookmarks));
          }
          if (Array.isArray(data.customLists)) {
            localStorage.setItem('storm_custom_lists', JSON.stringify(data.customLists));
          }
          if (Array.isArray(data.continueWatching)) {
            localStorage.setItem('storm_continue_watching', JSON.stringify(data.continueWatching));
          }
          if (data.bio) localStorage.setItem('storm_profile_bio', data.bio);
          showToast('✅ Резервная копия успешно импортирована!', 'success');
          openProfileModal();
          if (typeof window.stormRefreshCatalog === 'function') window.stormRefreshCatalog();
        } catch (err) {
          showToast('Некорректный файл резервной копии JSON', 'error');
        }
      };
      reader.readAsText(file);
      importJsonInput.value = '';
    });
  }

  const clearCacheBtn = document.getElementById('profile-clear-cache-btn');
  if (clearCacheBtn) {
    clearCacheBtn.addEventListener('click', () => {
      const drawerClearBtn = document.getElementById('mobile-drawer-clear-cache-btn');
      if (drawerClearBtn) {
        drawerClearBtn.click();
      } else {
        showToast('🧹 Кэш метаданных и постеров очищен!', 'success');
      }
    });
  }

  // Генерация случайного аватара
  const randomBtn = document.getElementById('random-avatar-btn');
  if (randomBtn) {
    randomBtn.addEventListener('click', () => {
      const randomSeed = 'Storm-' + Math.random().toString(36).substring(2, 9);
      const url = `https://api.dicebear.com/7.x/bottts/svg?seed=${randomSeed}`;
      const input = document.getElementById('edit-avatar-url');
      if (input) input.value = url;
      const profileAvatar = document.getElementById('profile-avatar');
      if (profileAvatar) profileAvatar.src = url;
      const livePreview = document.getElementById('edit-avatar-live-preview');
      if (livePreview) livePreview.src = url;
      document.querySelectorAll('.avatar-preset-item').forEach(el => el.classList.remove('selected'));
      showToast('🎲 Сгенерирован новый уникальный аватар!', 'info');
    });
  }

  // Загрузка аватарки из локального файла
  const fileInput = document.getElementById('avatar-file-input');
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      if (!file.type.startsWith('image/')) {
        showToast('Пожалуйста, выберите файл изображения', 'error');
        return;
      }

      if (file.size > 2 * 1024 * 1024) {
        showToast('Размер файла не должен превышать 2 МБ', 'error');
        return;
      }

      const reader = new FileReader();
      reader.onload = (evt) => {
        const dataUrl = evt.target.result;
        const input = document.getElementById('edit-avatar-url');
        if (input) input.value = dataUrl;
        const profileAvatar = document.getElementById('profile-avatar');
        if (profileAvatar) profileAvatar.src = dataUrl;
        const livePreview = document.getElementById('edit-avatar-live-preview');
        if (livePreview) livePreview.src = dataUrl;
        document.querySelectorAll('.avatar-preset-item').forEach(el => el.classList.remove('selected'));
        showToast('📁 Изображение загружено!', 'success');
      };
      reader.readAsDataURL(file);
    });
  }

  // Превью при вводе прямой ссылки
  const avatarUrlInput = document.getElementById('edit-avatar-url');
  if (avatarUrlInput) {
    avatarUrlInput.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      if (val) {
        const profileAvatar = document.getElementById('profile-avatar');
        if (profileAvatar) profileAvatar.src = val;
        const livePreview = document.getElementById('edit-avatar-live-preview');
        if (livePreview) livePreview.src = val;
      }
    });
  }

  // Форма сохранения профиля
  const editProfileForm = document.getElementById('edit-profile-form');
  if (editProfileForm) {
    editProfileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('edit-profile-username').value.trim();
      const email = document.getElementById('edit-profile-email').value.trim();
      const avatar = document.getElementById('edit-avatar-url').value.trim();
      const bio = document.getElementById('edit-profile-bio')?.value.trim() || '';

      if (!username || !email) {
        showToast('Имя пользователя и email обязательны', 'error');
        return;
      }

      try {
        await updateProfile(username, email, avatar, bio);
        const bioDisplay = document.getElementById('profile-bio-display');
        if (bioDisplay && bio) bioDisplay.textContent = bio;
        const userEl = document.getElementById('profile-username');
        if (userEl) userEl.textContent = username;
        const emailEl = document.getElementById('profile-email');
        if (emailEl) emailEl.textContent = email;
        switchProfileTab('overview');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // Форма смены пароля
  const changePasswordForm = document.getElementById('change-password-form');
  if (changePasswordForm) {
    changePasswordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const oldPass = document.getElementById('old-password').value;
      const newPass = document.getElementById('new-password').value;
      const confirmPass = document.getElementById('confirm-password').value;

      if (!oldPass || !newPass) {
        showToast('Заполните все поля паролей', 'error');
        return;
      }

      if (newPass.length < 6) {
        showToast('Новый пароль должен содержать минимум 6 символов', 'error');
        return;
      }

      if (newPass !== confirmPass) {
        showToast('Новые пароли не совпадают', 'error');
        return;
      }

      try {
        await changePassword(oldPass, newPass);
        changePasswordForm.reset();
        switchProfileTab('overview');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // Привязка ТВ-устройства по коду (Device Code Verification)
  const verifyTvForm = document.getElementById('verify-tv-device-form');
  if (verifyTvForm) {
    verifyTvForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const codeInput = document.getElementById('tv-device-code-input');
      const rawCode = (codeInput?.value || '').trim().toUpperCase();
      if (!rawCode) {
        showToast('Пожалуйста, введите 6-значный ТВ-код', 'error');
        return;
      }
      try {
        const token = getToken();
        const res = await fetch('/api/auth/device/verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ code: rawCode })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Не удалось привязать ТВ-устройство');
        showToast('✅ ТВ-устройство успешно авторизовано!', 'success');
        if (codeInput) codeInput.value = '';
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }
}

// ==========================================
// МНОГОПРОФИЛЬНОСТЬ И СЕМЕЙНЫЙ АККАУНТ
// ==========================================

export const FAMILY_BG_GRADIENTS = [
  { id: 'gold', label: 'Золото короны', bg: 'linear-gradient(135deg, #f59e0b, #d97706)' },
  { id: 'cyan', label: 'Кибер-циан', bg: 'linear-gradient(135deg, #00d2ff, #0072ff)' },
  { id: 'emerald', label: 'Изумрудный лес', bg: 'linear-gradient(135deg, #10b981, #059669)' },
  { id: 'neon', label: 'Неон Найт-Сити', bg: 'linear-gradient(135deg, #ff007f, #a855f7)' },
  { id: 'amethyst', label: 'Аметистовая ночь', bg: 'linear-gradient(135deg, #8b5cf6, #4c1d95)' },
  { id: 'ruby', label: 'Огненный рубин', bg: 'linear-gradient(135deg, #ef4444, #991b1b)' },
  { id: 'matrix', label: 'Матричный код', bg: 'linear-gradient(135deg, #00ff66, #065f46)' },
  { id: 'slate', label: 'Имперский титан', bg: 'linear-gradient(135deg, #475569, #0f172a)' },
  // +12 новых цветовых аур (всего 20)
  { id: 'cyber_ice', label: 'Арктический неон', bg: 'linear-gradient(135deg, #00f0ff, #3b82f6, #1d4ed8)' },
  { id: 'sunset_blaze', label: 'Пламя заката', bg: 'linear-gradient(135deg, #ff4e50, #f9d423)' },
  { id: 'aurora_borealis', label: 'Северное сияние', bg: 'linear-gradient(135deg, #00c6ff, #0072ff, #00ff87)' },
  { id: 'sakura_bloom', label: 'Цветение сакуры', bg: 'linear-gradient(135deg, #ff758c, #ff7eb3)' },
  { id: 'quantum_violet', label: 'Квантовый ультрафиолет', bg: 'linear-gradient(135deg, #7f00ff, #e100ff)' },
  { id: 'solar_flare', label: 'Солнечная корона', bg: 'linear-gradient(135deg, #f12711, #f5af19)' },
  { id: 'deep_ocean', label: 'Бездна океана', bg: 'linear-gradient(135deg, #0f2027, #203a43, #2c5364)' },
  { id: 'crimson_velvet', label: 'Кровавый бархат', bg: 'linear-gradient(135deg, #870000, #190a05)' },
  { id: 'toxic_lime', label: 'Кислотный импульс', bg: 'linear-gradient(135deg, #a8ff78, #78ffd6)' },
  { id: 'imperial_gold', label: 'Имперское золото', bg: 'linear-gradient(135deg, #d4af37, #aa7c11, #593e06)' },
  { id: 'cosmic_nebula', label: 'Туманность Андромеды', bg: 'linear-gradient(135deg, #ff0844, #ffb199, #6a11cb)' },
  { id: 'obsidian_rose', label: 'Обсидиановая роза', bg: 'linear-gradient(135deg, #1f1c2c, #928dab, #e94057)' }
];

const THEME_LABELS_MAP = {
  auto: 'Авто (системная)',
  dark: 'Тёмный кибер',
  night: 'Чёрный OLED',
  day: 'Светлая тема',
  midnight: 'Аметистовая ночь',
  matrix: 'Матричный зелёный',
  cyberpunk: 'Неон Найт-Сити',
  fantasy: 'Королевское золото',
  warhammer: 'Имперская готика'
};

const TAB_LABELS_MAP = {
  home: '🎬 Главная',
  movies: '🍿 Фильмы',
  series: '📺 Сериалы',
  cartoons: '🧸 Мультфильмы',
  'anime-series': '⛩️ Аниме'
};

const DEFAULT_PROFILES = [
  {
    id: 'primary',
    name: 'Основной профиль',
    subtitle: 'Персональный кинозал',
    avatar: FAMILY_AVATAR_PRESETS[0]?.icon || '👑',
    avatarBg: 'linear-gradient(135deg, #f59e0b, #d97706)',
    isKid: false,
    ageRating: '18+',
    hasPin: false,
    pin: '',
    themePreference: 'auto',
    defaultTab: 'home',
    screenTimeLimit: 0,
    isDefault: true
  }
];

function isMockedPresetProfile(p) {
  if (!p || typeof p !== 'object') return false;
  if (p.id === 'family' || p.id === 'kids') return true;
  if (p.name === 'Семейный просмотр' && p.subtitle === 'Общий кинозал для всей семьи') return true;
  if (p.name === 'Детский профиль' && p.subtitle === 'Добрая анимация и сказки без 18+') return true;
  return false;
}

const LEGACY_EMOJI_TO_SVG_MAP = {
  '👑': FAMILY_AVATAR_PRESETS[17]?.icon || FAMILY_AVATAR_PRESETS[0]?.icon,
  '🦸': FAMILY_AVATAR_PRESETS[0]?.icon,
  '🥷': FAMILY_AVATAR_PRESETS[11]?.icon,
  '🧙': FAMILY_AVATAR_PRESETS[12]?.icon,
  '🕵️': FAMILY_AVATAR_PRESETS[34]?.icon,
  '🤖': FAMILY_AVATAR_PRESETS[9]?.icon,
  '👨‍👩‍👧': FAMILY_AVATAR_PRESETS[50]?.icon,
  '🦄': FAMILY_AVATAR_PRESETS[51]?.icon,
  '🧸': FAMILY_AVATAR_PRESETS[52]?.icon,
  '🐱': FAMILY_AVATAR_PRESETS[53]?.icon,
  '🦁': FAMILY_AVATAR_PRESETS[41]?.icon,
  '🚀': FAMILY_AVATAR_PRESETS[20]?.icon,
  '⚡': FAMILY_AVATAR_PRESETS[19]?.icon,
  '🎮': FAMILY_AVATAR_PRESETS[32]?.icon,
  '🐉': FAMILY_AVATAR_PRESETS[15]?.icon,
  '🦊': FAMILY_AVATAR_PRESETS[10]?.icon,
  '🌸': FAMILY_AVATAR_PRESETS[14]?.icon,
  '👾': FAMILY_AVATAR_PRESETS[33]?.icon,
  '🍿': FAMILY_AVATAR_PRESETS[31]?.icon,
  '🎬': FAMILY_AVATAR_PRESETS[30]?.icon,
  '🎭': FAMILY_AVATAR_PRESETS[35]?.icon,
  '🌟': FAMILY_AVATAR_PRESETS[37]?.icon,
  '🕶️': FAMILY_AVATAR_PRESETS[2]?.icon,
  '💎': FAMILY_AVATAR_PRESETS[39]?.icon
};

function enrichProfileDefaults(p, idx = 0) {
  if (!p || typeof p !== 'object') return DEFAULT_PROFILES[0];
  const isPrim = p.id === 'primary' || p.isDefault || idx === 0;
  const isKid = Boolean(p.isKid);
  const fallbackSub = isPrim
    ? 'Персональный кинозал'
    : (isKid ? 'Безопасный детский режим' : 'Персональный кинопрофиль');
  const resolvedName = (isPrim && (p.name === 'Основной профиль' || !p.name) && isRealAuthenticatedAccount() && currentUser?.username)
    ? currentUser.username
    : (p.name || 'Основной профиль');
  const rawAvatar = p.avatar || DEFAULT_PROFILES[0].avatar;
  const upgradedAvatar = LEGACY_EMOJI_TO_SVG_MAP[rawAvatar] || rawAvatar;
  return {
    ...p,
    name: resolvedName,
    avatar: upgradedAvatar,
    subtitle: p.subtitle || fallbackSub,
    ageRating: p.ageRating || (isKid ? '6+' : '18+'),
    themePreference: p.themePreference || 'auto',
    defaultTab: p.defaultTab || (isKid ? 'cartoons' : 'home'),
    screenTimeLimit: typeof p.screenTimeLimit === 'number' ? p.screenTimeLimit : (parseInt(p.screenTimeLimit, 10) || 0)
  };
}

let familyProfiles = DEFAULT_PROFILES.map(enrichProfileDefaults);
let activeProfileId = localStorage.getItem('storm_active_profile_id') || 'primary';
if (activeProfileId === 'family' || activeProfileId === 'kids') {
  activeProfileId = 'primary';
  try { localStorage.setItem('storm_active_profile_id', 'primary'); } catch (_) {}
}

function sanitizeFamilyProfilesList(list) {
  const filtered = Array.isArray(list) ? list.filter(p => p && !isMockedPresetProfile(p)) : [];
  const base = filtered.length > 0 ? filtered : DEFAULT_PROFILES;
  const mapped = base.map(enrichProfileDefaults);
  if (!mapped.some(p => p.id === activeProfileId)) {
    activeProfileId = mapped[0]?.id || 'primary';
    try { localStorage.setItem('storm_active_profile_id', activeProfileId); } catch (_) {}
  }
  return mapped;
}

function getUserFamilyStorageKey() {
  if (isRealAuthenticatedAccount() && currentUser?.id) {
    return `storm_family_profiles_u_${currentUser.id}`;
  }
  return null;
}

// Фоновая синхронизация профилей ТОЛЬКО для авторизованного пользователя
async function syncProfilesWithServer() {
  try {
    if (!isRealAuthenticatedAccount()) {
      familyProfiles = DEFAULT_PROFILES.map(enrichProfileDefaults);
      updateFamilyHeaderUI();
      return;
    }
    const userKey = getUserFamilyStorageKey();
    if (userKey) {
      try {
        const cached = JSON.parse(localStorage.getItem(userKey) || 'null');
        if (Array.isArray(cached) && cached.length > 0) {
          familyProfiles = sanitizeFamilyProfilesList(cached);
          localStorage.setItem(userKey, JSON.stringify(familyProfiles));
        }
      } catch (_) {}
    }
    const token = getToken();
    if (!token || token === 'local_token') return;
    const res = await fetch('/api/profiles', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.profiles) && data.profiles.length > 0) {
        familyProfiles = sanitizeFamilyProfilesList(data.profiles);
        if (userKey) {
          localStorage.setItem(userKey, JSON.stringify(familyProfiles));
        }
        updateAuthUI();
      }
    }
  } catch {}
}

export function getFamilyProfiles() {
  if (!isRealAuthenticatedAccount()) return [];
  familyProfiles = sanitizeFamilyProfilesList(familyProfiles);
  return familyProfiles;
}

export function saveFamilyProfiles(profiles) {
  if (!isRealAuthenticatedAccount()) return;
  if (!Array.isArray(profiles) || profiles.length === 0) return;
  familyProfiles = sanitizeFamilyProfilesList(profiles);
  const userKey = getUserFamilyStorageKey();
  if (userKey) {
    localStorage.setItem(userKey, JSON.stringify(familyProfiles));
  }

  // Фоновая отправка на сервер только при реальном токене
  try {
    const token = getToken();
    if (!token || token === 'local_token') return;
    fetch('/api/profiles/save', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ profiles: familyProfiles })
    }).catch(() => {});
  } catch {}
}

export function getActiveProfile() {
  const found = familyProfiles.find(p => p.id === activeProfileId) || familyProfiles[0] || DEFAULT_PROFILES[0];
  return enrichProfileDefaults(found);
}

export function isKidModeActive() {
  const p = getActiveProfile();
  return Boolean(p && p.isKid);
}

export function createFamilyProfile({
  name,
  subtitle = '',
  avatar,
  avatarBg,
  isKid = false,
  ageRating = '18+',
  hasPin = false,
  pin = '',
  themePreference = 'auto',
  defaultTab = 'home',
  screenTimeLimit = 0
}) {
  if (!name || !name.trim()) {
    showToast('Введите имя профиля', 'error');
    return null;
  }
  const cleanName = name.trim();
  const newProfile = enrichProfileDefaults({
    id: `p_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    name: cleanName,
    subtitle: subtitle ? subtitle.trim() : (isKid ? 'Безопасный детский режим' : 'Персональный кинопрофиль'),
    avatar: avatar || '🍿',
    avatarBg: avatarBg || 'linear-gradient(135deg, #00d2ff, #0072ff)',
    isKid: Boolean(isKid),
    ageRating: ageRating || (isKid ? '6+' : '18+'),
    hasPin: Boolean(hasPin && pin && pin.length >= 4),
    pin: hasPin ? String(pin).trim() : '',
    themePreference: themePreference || 'auto',
    defaultTab: defaultTab || (isKid ? 'cartoons' : 'home'),
    screenTimeLimit: parseInt(screenTimeLimit, 10) || 0,
    isDefault: false
  });

  const updated = [...familyProfiles, newProfile];
  saveFamilyProfiles(updated);
  showToast(`Профиль «${newProfile.name}» создан`, 'success');
  return newProfile;
}

export function updateFamilyProfile(id, data) {
  const idx = familyProfiles.findIndex(p => p.id === id);
  if (idx === -1) return null;

  const current = familyProfiles[idx];
  const updatedProfile = enrichProfileDefaults({
    ...current,
    name: data.name ? data.name.trim() : current.name,
    subtitle: data.subtitle !== undefined ? String(data.subtitle).trim() : current.subtitle,
    avatar: data.avatar || current.avatar,
    avatarBg: data.avatarBg || current.avatarBg,
    isKid: data.isKid !== undefined ? Boolean(data.isKid) : current.isKid,
    ageRating: data.ageRating || (data.isKid ? '6+' : current.ageRating || '18+'),
    hasPin: data.hasPin !== undefined ? Boolean(data.hasPin) : current.hasPin,
    pin: data.pin !== undefined ? String(data.pin).trim() : current.pin,
    themePreference: data.themePreference !== undefined ? data.themePreference : (current.themePreference || 'auto'),
    defaultTab: data.defaultTab !== undefined ? data.defaultTab : (current.defaultTab || 'home'),
    screenTimeLimit: data.screenTimeLimit !== undefined ? (parseInt(data.screenTimeLimit, 10) || 0) : (current.screenTimeLimit || 0)
  }, idx);

  const updated = [...familyProfiles];
  updated[idx] = updatedProfile;
  saveFamilyProfiles(updated);

  // Немедленно обновляем отображение в шапке
  updateFamilyHeaderUI();

  // Если отредактирован активный профиль, применяем тему при необходимости
  if (id === activeProfileId && updatedProfile.themePreference && updatedProfile.themePreference !== 'auto') {
    try {
      localStorage.setItem('storm_theme', updatedProfile.themePreference);
      document.documentElement.setAttribute('data-theme', updatedProfile.themePreference);
    } catch (_) {}
  }

  // Если отредактирован активный профиль или основной профиль
  if (id === activeProfileId || id === 'primary' || current.isDefault) {
    if (currentUser) {
      currentUser.username = updatedProfile.name;
      if (updatedProfile.avatar && (updatedProfile.avatar.startsWith('http') || updatedProfile.avatar.startsWith('data:') || updatedProfile.avatar.startsWith('/'))) {
        currentUser.avatar = updatedProfile.avatar;
      }
      localStorage.setItem('storm_user', JSON.stringify(currentUser));
      updateAuthUI();
    }
  }

  showToast(`Профиль «${updatedProfile.name}» обновлён`, 'success');
  return updatedProfile;
}

export function deleteFamilyProfile(id) {
  const target = familyProfiles.find(p => p.id === id);
  if (!target) return false;

  if (target.isDefault || target.id === 'primary') {
    showToast('Нельзя удалить основной профиль системы', 'error');
    return false;
  }

  const updated = familyProfiles.filter(p => p.id !== id);
  saveFamilyProfiles(updated);

  if (activeProfileId === id) {
    activeProfileId = 'primary';
    localStorage.setItem('storm_active_profile_id', 'primary');
  }

  showToast(`Профиль «${target.name}» удалён`, 'info');
  return true;
}

export function switchFamilyProfile(profileId, bypassPin = false) {
  const current = getActiveProfile();
  const targetRaw = familyProfiles.find(p => p.id === profileId);
  if (!targetRaw) return false;
  const target = enrichProfileDefaults(targetRaw);

  // Если уже на этом профиле
  if (current.id === target.id) {
    showToast(`Профиль «${target.name}» уже активен`, 'info');
    return true;
  }

  // Проверка необходимости ввода PIN-кода:
  // 1. Выход из детского профиля с PIN-кодом
  // 2. Вход в профиль, защищенный собственным PIN-кодом
  if (!bypassPin) {
    if (current.isKid && current.hasPin && current.pin) {
      openPinPromptModal(current, () => {
        switchFamilyProfile(profileId, true);
      }, 'Выход из детского режима');
      return false;
    }

    if (target.hasPin && target.pin) {
      openPinPromptModal(target, () => {
        switchFamilyProfile(profileId, true);
      }, `Вход в профиль «${target.name}»`);
      return false;
    }
  }

  activeProfileId = target.id;
  localStorage.setItem('storm_active_profile_id', activeProfileId);

  // Персональная тема оформления профиля
  if (target.themePreference && target.themePreference !== 'auto') {
    try {
      localStorage.setItem('storm_theme', target.themePreference);
      document.documentElement.setAttribute('data-theme', target.themePreference);
    } catch (_) {}
  }

  // Персональный стартовый раздел профиля
  if (target.defaultTab) {
    try {
      localStorage.setItem('storm_profile_start_tab', target.defaultTab);
    } catch (_) {}
  }

  showToast(`Переключён профиль: ${target.name}`, 'success');
  updateAuthUI();
  notifyAuthChanged();

  // Плавная перезагрузка для обновления интерфейса и фильтрации каталога
  setTimeout(() => {
    window.location.reload();
  }, 280);
  return true;
}

function renderAvatarElement(p) {
  if (p.avatar && (p.avatar.startsWith('http') || p.avatar.startsWith('/') || p.avatar.startsWith('data:'))) {
    return `<img src="${p.avatar}" alt="${escapeHtml(p.name || '')}" class="family-profile-avatar-img">`;
  }
  return `<span>${p.avatar || '👑'}</span>`;
}

function getProfileQuickStats(p) {
  const isPrim = p.id === 'primary' || p.isDefault;
  if (isPrim) {
    const st = computeLocalAndMergedProfileStats(currentUser?.stats || {});
    const watchedCount = (Number(st.completedCount) || 0) + (Number(st.watchingCount) || 0);
    const favCount = Number(st.favoritesCount) || 0;
    return { watchedCount, favCount };
  }
  return {
    watchedCount: Number(p.watchedCount) || 0,
    favCount: Number(p.favCount) || 0
  };
}

// -------------------------------------------------------------
// 1. МОДАЛЬНОЕ ОКНО «КТО СМОТРИТ?» (ВЫБОР И ЦЕНТР ПРОФИЛЕЙ)
// -------------------------------------------------------------
export function openProfileSwitcherModal() {
  if (!isRealAuthenticatedAccount()) {
    showToast('Войдите в аккаунт или зарегистрируйтесь для настройки семейных профилей', 'info');
    return;
  }
  let modal = document.getElementById('family-profiles-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'storm-modal-backdrop';
    modal.id = 'family-profiles-modal';
    modal.innerHTML = `
      <div class="storm-modal family-profiles-modal-box" style="max-width: 880px; width: 95vw; text-align: center;">
        <div class="storm-modal-header" style="justify-content: space-between; padding: 18px 24px;">
          <div style="display: flex; align-items: center; gap: 12px; text-align: left;">
            <div style="width: 40px; height: 40px; border-radius: 12px; background: rgba(0, 210, 255, 0.14); border: 1px solid rgba(0, 210, 255, 0.35); display: flex; align-items: center; justify-content: center; font-size: 21px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);">👥</div>
            <div>
              <h3 class="storm-modal-title" style="margin: 0; font-size: 18px;">Кто смотрит?</h3>
              <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">Выберите персональный профиль для синхронизации рекомендаций, темы и возрастного ценза</div>
            </div>
          </div>
          <button type="button" class="storm-modal-close" id="close-profiles-modal-btn" title="Закрыть">✕</button>
        </div>
        <div class="storm-modal-body" id="family-profiles-modal-body" style="padding: 20px 24px 22px; max-height: 76vh; overflow-y: auto;"></div>
        <div class="storm-modal-footer" style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px; padding: 14px 24px; border-top: 1px solid var(--border-subtle); background: var(--bg-tertiary);">
          <div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center;">
            <button type="button" class="storm-btn storm-btn-secondary" id="manage-profiles-mode-btn" style="font-size: 13px;">
              <span>⚙️</span> Управление профилями
            </button>
            <button type="button" class="storm-btn storm-btn-secondary" id="open-personal-cabinet-from-switcher-btn" style="font-size: 13px;">
              <span>👤</span> Личный кабинет и достижения
            </button>
          </div>
          <button type="button" class="storm-btn storm-btn-primary" id="add-new-profile-btn" style="font-size: 13px; font-weight: 800;">
            <span>＋</span> Добавить профиль
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const closeBtn = modal.querySelector('#close-profiles-modal-btn');
    if (closeBtn) closeBtn.onclick = () => modal.classList.remove('is-open');
    modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('is-open'); };
  }

  modal.classList.add('is-open');
  const body = document.getElementById('family-profiles-modal-body');
  const active = getActiveProfile();
  const profilesList = getFamilyProfiles();

  body.innerHTML = `
    <!-- Сводная панель текущего сеанса и семейной защиты -->
    <div class="family-profiles-summary-bar">
      <div class="family-summary-left">
        <div class="family-summary-avatar" style="background: ${active.avatarBg || 'linear-gradient(135deg, #f59e0b, #d97706)'};">
          ${renderAvatarElement(active)}
        </div>
        <div style="text-align: left;">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span style="font-size: 14px; font-weight: 800; color: #ffffff;">Активен: ${escapeHtml(active.name)}</span>
            <span class="family-profile-badge ${active.isKid ? 'kid-badge' : 'age-badge'}" style="margin: 0;">${active.isKid ? `🧸 Детский ${active.ageRating || '6+'}` : `🎬 Ценз ${active.ageRating || '18+'}`}</span>
          </div>
          <div style="font-size: 11.5px; color: var(--text-secondary); margin-top: 2px;">
            ${escapeHtml(active.subtitle || 'Персональное пространство')} • Профилей: ${profilesList.length} из 8
          </div>
        </div>
      </div>
      <div class="family-summary-actions">
        <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="quick-edit-active-profile-btn" style="font-size: 12px; padding: 6px 12px;">
          <span>✏️</span> Настроить текущий
        </button>
      </div>
    </div>

    <!-- Адаптивная 3D-сетка карточек профилей (без обрезки имён) -->
    <div class="family-profiles-grid">
      ${profilesList.map(p => {
        const isAct = p.id === active.id;
        const stats = getProfileQuickStats(p);
        const ageLabel = p.ageRating || (p.isKid ? '6+' : '18+');
        const themeLabel = THEME_LABELS_MAP[p.themePreference || 'auto'] || 'Авто';
        const tabLabel = TAB_LABELS_MAP[p.defaultTab || (p.isKid ? 'cartoons' : 'home')] || '🎬 Главная';

        return `
        <div class="family-profile-card ${isAct ? 'is-active' : ''}" data-id="${p.id}">
          <div class="family-profile-top-bar">
            <div style="display: flex; align-items: center; gap: 5px;">
              <span class="family-profile-badge ${p.isKid ? 'kid-badge' : 'age-badge'}" style="margin: 0;">${p.isKid ? `👶 ${ageLabel}` : ageLabel}</span>
              ${p.hasPin ? '<span class="family-profile-badge pin-badge" style="margin: 0;" title="Защищён PIN-кодом">🔒 PIN</span>' : ''}
            </div>
            <button type="button" class="family-profile-quick-edit-btn" data-quick-edit="${p.id}" title="Быстро настроить профиль «${escapeHtml(p.name)}»">✏️</button>
          </div>

          <div class="family-profile-avatar-box" style="background: ${p.avatarBg || 'linear-gradient(135deg, #00d2ff, #0072ff)'};">
            ${renderAvatarElement(p)}
            ${isAct ? '<span class="family-avatar-active-dot" title="Профиль активен"></span>' : ''}
          </div>

          <div class="family-profile-name">${escapeHtml(p.name)}</div>
          <div class="family-profile-subtitle">${escapeHtml(p.subtitle || (p.isKid ? 'Безопасный детский режим' : 'Полный доступ к каталогу'))}</div>

          <div class="family-profile-chips">
            <span class="family-profile-chip" title="Стартовый раздел каталога">${tabLabel}</span>
            <span class="family-profile-chip" title="Привязанная тема оформления">🎨 ${escapeHtml(themeLabel.replace(/\s*\(.*\)/, ''))}</span>
            ${p.screenTimeLimit > 0 ? `<span class="family-profile-chip" title="Лимит экранного времени">⏱️ ${p.screenTimeLimit} мин</span>` : ''}
          </div>

          <div class="family-profile-stats-row">
            <span title="История просмотров">📺 ${stats.watchedCount} просм.</span>
            <span>•</span>
            <span title="В избранном и закладках">⭐ ${stats.favCount} избр.</span>
          </div>

          <div class="family-profile-meta" style="margin-top: 8px; width: 100%; justify-content: center;">
            ${isAct
              ? '<span class="family-profile-badge active-badge" style="width: 100%; justify-content: center; padding: 5px 10px;">✓ Активный профиль</span>'
              : '<span class="family-profile-enter-pill">Войти в профиль →</span>'}
          </div>
        </div>
        `;
      }).join('')}

      ${profilesList.length < 8 ? `
        <div class="family-profile-card family-profile-add-card" id="grid-add-profile-card" role="button" tabindex="0">
          <div class="family-profile-add-circle">＋</div>
          <div class="family-profile-name" style="margin-top: 4px;">Новый профиль</div>
          <div class="family-profile-subtitle">Создать личный или детский профиль с собственными рекомендациями и PIN</div>
          <div class="family-profile-meta" style="margin-top: auto; pt: 8px;">
            <span class="family-profile-enter-pill">Создать профиль ✨</span>
          </div>
        </div>
      ` : ''}
    </div>
  `;

  // Быстрое редактирование профиля по кнопке ✏️ на карточке
  body.querySelectorAll('.family-profile-quick-edit-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const pid = btn.dataset.quickEdit;
      modal.classList.remove('is-open');
      openProfileEditorModal(pid);
    };
  });

  // Клик по карточке профиля (вход/переключение)
  body.querySelectorAll('.family-profile-card:not(.family-profile-add-card)').forEach(card => {
    card.onclick = (e) => {
      if (e.target.closest('.family-profile-quick-edit-btn')) return;
      const pid = card.dataset.id;
      modal.classList.remove('is-open');
      switchFamilyProfile(pid);
    };
  });

  // Карточка «+ Новый профиль» в сетке
  const gridAddCard = body.querySelector('#grid-add-profile-card');
  if (gridAddCard) {
    gridAddCard.onclick = () => {
      modal.classList.remove('is-open');
      openProfileEditorModal(null);
    };
  }

  // Настроить текущий профиль из верхней панели
  const quickEditActiveBtn = body.querySelector('#quick-edit-active-profile-btn');
  if (quickEditActiveBtn) {
    quickEditActiveBtn.onclick = () => {
      modal.classList.remove('is-open');
      openProfileEditorModal(active.id);
    };
  }

  // Кнопка перехода в режим управления
  const manageBtn = modal.querySelector('#manage-profiles-mode-btn');
  if (manageBtn) {
    manageBtn.onclick = () => {
      modal.classList.remove('is-open');
      openProfileManagementModal();
    };
  }

  // Кнопка перехода в Личный кабинет и достижения
  const cabinetBtn = modal.querySelector('#open-personal-cabinet-from-switcher-btn');
  if (cabinetBtn) {
    cabinetBtn.onclick = () => {
      modal.classList.remove('is-open');
      openProfileModal();
    };
  }

  // Кнопка добавления профиля
  const addBtn = modal.querySelector('#add-new-profile-btn');
  if (addBtn) {
    addBtn.onclick = () => {
      modal.classList.remove('is-open');
      openProfileEditorModal(null);
    };
  }
}

// -------------------------------------------------------------
// 2. МОДАЛЬНОЕ ОКНО «УПРАВЛЕНИЕ ПРОФИЛЯМИ»
// -------------------------------------------------------------
export function openProfileManagementModal() {
  if (!isRealAuthenticatedAccount()) return;
  let modal = document.getElementById('family-profiles-manage-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'storm-modal-backdrop';
    modal.id = 'family-profiles-manage-modal';
    modal.innerHTML = `
      <div class="storm-modal family-profiles-modal-box" style="max-width: 880px; width: 95vw; text-align: center;">
        <div class="storm-modal-header" style="justify-content: space-between; padding: 18px 24px;">
          <div style="display: flex; align-items: center; gap: 12px; text-align: left;">
            <span style="font-size: 22px;">⚙️</span>
            <div>
              <h3 class="storm-modal-title" style="margin: 0;">Управление семейными профилями</h3>
              <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">Настройка аватаров, тем оформления, родительского контроля и PIN-кодов</div>
            </div>
          </div>
          <button type="button" class="storm-modal-close" id="close-manage-profiles-btn">✕</button>
        </div>
        <div class="storm-modal-body" id="manage-profiles-modal-body" style="padding: 20px 24px; max-height: 74vh; overflow-y: auto;"></div>
        <div class="storm-modal-footer" style="display: flex; justify-content: space-between; align-items: center; padding: 14px 24px; border-top: 1px solid var(--border-subtle); background: var(--bg-tertiary);">
          <button type="button" class="storm-btn storm-btn-secondary" id="back-to-switcher-btn" style="font-size: 13px;">
            <span>←</span> Назад к выбору профиля
          </button>
          <button type="button" class="storm-btn storm-btn-primary" id="manage-add-profile-btn" style="font-size: 13px; font-weight: 800;">
            <span>＋</span> Добавить профиль
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const closeBtn = modal.querySelector('#close-manage-profiles-btn');
    if (closeBtn) closeBtn.onclick = () => modal.classList.remove('is-open');
    modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('is-open'); };
  }

  modal.classList.add('is-open');
  const body = document.getElementById('manage-profiles-modal-body');
  const active = getActiveProfile();
  const profilesList = getFamilyProfiles();

  body.innerHTML = `
    <div class="family-profiles-grid">
      ${profilesList.map(p => {
        const ageLabel = p.ageRating || (p.isKid ? '6+' : '18+');
        const themeLabel = THEME_LABELS_MAP[p.themePreference || 'auto'] || 'Авто';
        const tabLabel = TAB_LABELS_MAP[p.defaultTab || (p.isKid ? 'cartoons' : 'home')] || '🎬 Главная';
        return `
        <div class="family-profile-card ${p.id === active.id ? 'is-active' : ''}" data-id="${p.id}">
          <div class="family-profile-top-bar">
            <span class="family-profile-badge ${p.isKid ? 'kid-badge' : 'age-badge'}" style="margin: 0;">${p.isKid ? `👶 Детский ${ageLabel}` : `Ценз ${ageLabel}`}</span>
            ${p.hasPin ? '<span class="family-profile-badge pin-badge" style="margin: 0;">🔒 PIN</span>' : ''}
          </div>
          <div class="family-profile-avatar-box" style="background: ${p.avatarBg || 'linear-gradient(135deg, #00d2ff, #0072ff)'};">
            ${renderAvatarElement(p)}
          </div>
          <div class="family-profile-name">${escapeHtml(p.name)}</div>
          <div class="family-profile-subtitle">${escapeHtml(p.subtitle || '')}</div>
          <div class="family-profile-chips">
            <span class="family-profile-chip">${tabLabel}</span>
            <span class="family-profile-chip">🎨 ${escapeHtml(themeLabel.replace(/\s*\(.*\)/, ''))}</span>
          </div>
          <div style="display: flex; gap: 6px; width: 100%; margin-top: 10px;">
            <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" data-edit-profile="${p.id}" style="flex: 1; font-size: 12px; padding: 7px 10px; justify-content: center;">
              ✏️ Изменить
            </button>
            ${!p.isDefault && p.id !== 'primary' ? `
              <button type="button" class="storm-btn storm-btn-danger storm-btn-sm" data-delete-profile="${p.id}" title="Удалить профиль" style="font-size: 12px; padding: 7px 10px;">
                🗑️
              </button>
            ` : ''}
          </div>
        </div>
        `;
      }).join('')}
    </div>
  `;

  body.querySelectorAll('[data-edit-profile]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const pid = btn.dataset.editProfile;
      modal.classList.remove('is-open');
      openProfileEditorModal(pid);
    };
  });

  body.querySelectorAll('[data-delete-profile]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const pid = btn.dataset.deleteProfile;
      const target = familyProfiles.find(x => x.id === pid);
      if (target && confirm(`Вы действительно хотите удалить профиль «${target.name}»?`)) {
        deleteFamilyProfile(pid);
        openProfileManagementModal();
      }
    };
  });

  body.querySelectorAll('.family-profile-card').forEach(card => {
    card.onclick = (e) => {
      if (e.target.closest('button')) return;
      const pid = card.dataset.id;
      modal.classList.remove('is-open');
      openProfileEditorModal(pid);
    };
  });

  const backBtn = modal.querySelector('#back-to-switcher-btn');
  if (backBtn) {
    backBtn.onclick = () => {
      modal.classList.remove('is-open');
      openProfileSwitcherModal();
    };
  }

  const addBtn = modal.querySelector('#manage-add-profile-btn');
  if (addBtn) {
    addBtn.onclick = () => {
      modal.classList.remove('is-open');
      openProfileEditorModal(null);
    };
  }
}

// -------------------------------------------------------------
// 3. МОДАЛЬНОЕ ОКНО РЕДАКТИРОВАНИЯ И СОЗДАНИЯ ПРОФИЛЯ
// -------------------------------------------------------------
export function openProfileEditorModal(profileId = null) {
  const isEditing = Boolean(profileId);
  const rawProfile = isEditing ? familyProfiles.find(p => p.id === profileId) : null;
  const profile = rawProfile ? enrichProfileDefaults(rawProfile) : null;

  let selectedAvatar = profile ? profile.avatar : '👑';
  let selectedBg = profile ? profile.avatarBg : 'linear-gradient(135deg, #f59e0b, #d97706)';
  let isKidMode = profile ? Boolean(profile.isKid) : false;
  let ageRatingVal = profile ? (profile.ageRating || '18+') : '18+';
  let hasPinLock = profile ? Boolean(profile.hasPin) : false;
  let pinVal = profile ? (profile.pin || '') : '';
  let themePrefVal = profile ? (profile.themePreference || 'auto') : 'auto';
  let defaultTabVal = profile ? (profile.defaultTab || 'home') : 'home';
  let screenTimeVal = profile ? (profile.screenTimeLimit || 0) : 0;

  let modal = document.getElementById('family-profile-editor-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'storm-modal-backdrop';
    modal.id = 'family-profile-editor-modal';
    modal.innerHTML = `
      <div class="storm-modal" style="max-width: 660px; width: 95vw;">
        <div class="storm-modal-header" style="justify-content: space-between; padding: 18px 24px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 22px;" id="editor-title-icon">✏️</span>
            <h3 class="storm-modal-title" id="editor-title-text" style="margin: 0;">Редактирование профиля</h3>
          </div>
          <button type="button" class="storm-modal-close" id="close-profile-editor-btn">✕</button>
        </div>
        <div class="storm-modal-body" id="profile-editor-body" style="padding: 20px 24px; max-height: 74vh; overflow-y: auto;"></div>
        <div class="storm-modal-footer" id="profile-editor-footer" style="display: flex; justify-content: space-between; align-items: center; padding: 14px 24px; border-top: 1px solid var(--border-subtle); background: var(--bg-tertiary);"></div>
      </div>
    `;
    document.body.appendChild(modal);

    const closeBtn = modal.querySelector('#close-profile-editor-btn');
    if (closeBtn) {
      closeBtn.onclick = () => {
        modal.classList.remove('is-open');
        openProfileSwitcherModal();
      };
    }
    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.classList.remove('is-open');
        openProfileSwitcherModal();
      }
    };
  }

  modal.classList.add('is-open');
  const titleIcon = modal.querySelector('#editor-title-icon');
  const titleText = modal.querySelector('#editor-title-text');
  const body = modal.querySelector('#profile-editor-body');
  const footer = modal.querySelector('#profile-editor-footer');

  if (titleIcon) titleIcon.textContent = isEditing ? '✏️' : '✨';
  if (titleText) titleText.textContent = isEditing ? `Настройка профиля: ${profile.name}` : 'Создание нового профиля';

  body.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 18px;">
      <!-- Шапка аватара, имени и роли -->
      <div style="display: flex; align-items: center; gap: 18px; padding-bottom: 16px; border-bottom: 1px solid var(--border-subtle); flex-wrap: wrap;">
        <div id="editor-avatar-preview" class="family-profile-avatar-box" style="width: 84px; height: 84px; font-size: 38px; margin: 0; background: ${selectedBg}; overflow: hidden; flex-shrink: 0;">
          ${renderAvatarElement({ avatar: selectedAvatar, name: '' })}
        </div>
        <div style="flex: 1; min-width: 220px; display: flex; flex-direction: column; gap: 10px;">
          <div>
            <label style="display: block; font-size: 12px; font-weight: 700; color: #ffffff; margin-bottom: 4px;">Имя профиля</label>
            <input type="text" id="editor-profile-name-input" class="storm-input" value="${profile ? escapeHtml(profile.name) : ''}" placeholder="Например: Семейный просмотр, Детский профиль" maxlength="34" style="width: 100%; font-size: 14px; font-weight: 700; padding: 9px 13px; border-radius: 8px;">
          </div>
          <div>
            <label style="display: block; font-size: 12px; font-weight: 700; color: var(--text-secondary); margin-bottom: 4px;">Подпись или роль в семье</label>
            <input type="text" id="editor-profile-subtitle-input" class="storm-input" value="${profile ? escapeHtml(profile.subtitle || '') : ''}" placeholder="Например: Общий кинозал, Добрая анимация без 18+" maxlength="48" style="width: 100%; font-size: 12.5px; padding: 8px 12px; border-radius: 8px;">
          </div>
        </div>
      </div>

      <!-- Выбор аватарки и цветовой ауры -->
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-wrap: wrap; gap: 6px;">
          <label style="font-size: 12.5px; font-weight: 700; color: #ffffff;">Выбор аватарки (60 стильных образов)</label>
          <div style="display: flex; gap: 6px;">
            <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="editor-random-avatar-btn" style="font-size: 11px; padding: 4px 10px;">
              🎲 Случайный образ
            </button>
            <label class="storm-btn storm-btn-secondary storm-btn-sm" style="font-size: 11px; padding: 4px 10px; margin: 0; cursor: pointer;">
              📁 Загрузить фото
              <input type="file" id="editor-avatar-file-input" accept="image/*" style="display: none;">
            </label>
          </div>
        </div>
        <div id="family-avatar-category-tabs" style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px;">
          ${['Все', 'Киберпанк', 'Аниме и Фэнтези', 'Космос', 'Кино и Игры', 'Тотемы', 'Семья и Уют'].map((cat, idx) => `
            <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm family-avatar-cat-btn ${idx === 0 ? 'active' : ''}" data-cat="${cat}" style="font-size: 11px; padding: 3px 9px; border-radius: 999px; ${idx === 0 ? 'background: var(--accent); color: #090d16; font-weight: 800;' : ''}">${cat === 'Все' ? 'Все (60)' : cat}</button>
          `).join('')}
        </div>
        <div class="family-avatar-picker-grid" id="family-avatar-presets-container" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(52px, 1fr)); gap: 8px; max-height: 220px; overflow-y: auto; padding: 6px; background: rgba(0,0,0,0.22); border-radius: 12px; border: 1px solid var(--border-subtle);">
          ${FAMILY_AVATAR_PRESETS.map(preset => `
            <button type="button" class="avatar-preset-btn ${preset.icon === selectedAvatar ? 'selected' : ''}" data-cat="${preset.cat}" data-icon="${preset.icon}" data-bg="${preset.bg}" title="${preset.label} (${preset.cat})" style="background: ${preset.bg}; padding: 0; overflow: hidden; width: 52px; height: 52px; border-radius: 14px; display: flex; align-items: center; justify-content: center;">
              <img src="${preset.icon}" alt="${preset.label}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 12px; pointer-events: none;">
            </button>
          `).join('')}
        </div>

        <!-- Палитра градиентов кольца аватара (20 цветовых аур) -->
        <div style="margin-top: 12px;">
          <div style="font-size: 11.5px; font-weight: 700; color: var(--text-secondary); margin-bottom: 6px;">Цветовая аура аватара (20 стилей):</div>
          <div class="family-bg-gradient-picker" id="family-bg-gradient-container" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(34px, 1fr)); gap: 8px;">
            ${FAMILY_BG_GRADIENTS.map(g => `
              <button type="button" class="family-bg-swatch ${g.bg === selectedBg ? 'selected' : ''}" data-bg="${g.bg}" title="${g.label}" style="background: ${g.bg}; width: 34px; height: 34px; border-radius: 10px;"></button>
            `).join('')}
          </div>
        </div>

        <div style="margin-top: 10px; display: flex; gap: 8px; align-items: center;">
          <input type="text" id="editor-custom-avatar-input" class="storm-input" placeholder="Или введите свой эмодзи или URL картинки" value="${selectedAvatar && (selectedAvatar.startsWith('http') || selectedAvatar.startsWith('data:')) ? selectedAvatar : ''}" style="flex: 1; font-size: 12px; padding: 7px 10px; border-radius: 8px;">
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="apply-custom-avatar-btn">Применить</button>
        </div>
      </div>

      <!-- Персональная тема оформления и стартовый раздел -->
      <div style="background: var(--bg-card); padding: 14px; border-radius: 12px; border: 1px solid var(--border-subtle); display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px;">
        <div>
          <label style="display: block; font-size: 12px; font-weight: 700; color: #ffffff; margin-bottom: 5px;">🎨 Тема оформления профиля</label>
          <select id="editor-theme-pref-select" class="storm-select" style="width: 100%; font-size: 12.5px; padding: 7px 10px; border-radius: 8px;">
            <option value="auto" ${themePrefVal === 'auto' ? 'selected' : ''}>Синхронно с системой (Авто)</option>
            <option value="dark" ${themePrefVal === 'dark' ? 'selected' : ''}>STORM DARK (Тёмный кибер)</option>
            <option value="night" ${themePrefVal === 'night' ? 'selected' : ''}>STORM NIGHT (Чёрный OLED)</option>
            <option value="day" ${themePrefVal === 'day' ? 'selected' : ''}>STORM DAY (Светлая тема)</option>
            <option value="midnight" ${themePrefVal === 'midnight' ? 'selected' : ''}>STORM MIDNIGHT (Аметистовая ночь)</option>
            <option value="matrix" ${themePrefVal === 'matrix' ? 'selected' : ''}>STORM MATRIX (Матричный зелёный)</option>
            <option value="cyberpunk" ${themePrefVal === 'cyberpunk' ? 'selected' : ''}>STORM CYBERPUNK (Неон Найт-Сити)</option>
            <option value="fantasy" ${themePrefVal === 'fantasy' ? 'selected' : ''}>STORM FANTASY (Королевское золото)</option>
            <option value="warhammer" ${themePrefVal === 'warhammer' ? 'selected' : ''}>STORM WARHAMMER 40K (Имперская готика)</option>
          </select>
        </div>
        <div>
          <label style="display: block; font-size: 12px; font-weight: 700; color: #ffffff; margin-bottom: 5px;">🧭 Стартовый раздел при входе</label>
          <select id="editor-default-tab-select" class="storm-select" style="width: 100%; font-size: 12.5px; padding: 7px 10px; border-radius: 8px;">
            <option value="home" ${defaultTabVal === 'home' ? 'selected' : ''}>🎬 Главная витрина</option>
            <option value="movies" ${defaultTabVal === 'movies' ? 'selected' : ''}>🍿 Фильмы в 4K UHD</option>
            <option value="series" ${defaultTabVal === 'series' ? 'selected' : ''}>📺 Сериалы</option>
            <option value="cartoons" ${defaultTabVal === 'cartoons' ? 'selected' : ''}>🧸 Мультфильмы и анимация</option>
            <option value="anime-series" ${defaultTabVal === 'anime-series' ? 'selected' : ''}>⛩️ Аниме</option>
          </select>
        </div>
      </div>

      <!-- Детский режим, возрастной ценз и таймер экранного времени -->
      <div style="background: var(--bg-card); padding: 14px; border-radius: 12px; border: 1px solid var(--border-subtle);">
        <div class="storm-checkbox-3d-wrap ${isKidMode ? 'checked' : ''}" id="editor-kid-toggle">
          <div class="storm-checkbox-3d-box">
            <div class="storm-checkbox-3d-inner"></div>
          </div>
          <div>
            <div style="font-weight: 700; font-size: 13px; color: #ffffff;">Детский профиль и родительский контроль</div>
            <div style="font-size: 11.5px; color: var(--text-muted); margin-top: 2px;">
              Автоматически скрывает фильмы и аниме с ограничением 18+, эротику, жестокость и ужасы.
            </div>
          </div>
        </div>

        <div style="margin-top: 12px; display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; padding-left: 34px;">
          <div>
            <label style="display: block; font-size: 11.5px; font-weight: 700; color: var(--accent); margin-bottom: 4px;">Возрастной ценз контента:</label>
            <select id="editor-age-rating-select" class="storm-select" style="width: 100%; font-size: 12px; padding: 6px 10px; border-radius: 6px;">
              <option value="0+" ${ageRatingVal === '0+' ? 'selected' : ''}>0+ (Только для малышей и сказки)</option>
              <option value="6+" ${ageRatingVal === '6+' ? 'selected' : ''}>6+ (Семейные и детские мультфильмы)</option>
              <option value="12+" ${ageRatingVal === '12+' ? 'selected' : ''}>12+ (Подростковый безопасный контент)</option>
              <option value="16+" ${ageRatingVal === '16+' ? 'selected' : ''}>16+ (Без взрослого контента 18+)</option>
              <option value="18+" ${ageRatingVal === '18+' ? 'selected' : ''}>18+ (Полный каталог без ограничений)</option>
            </select>
          </div>
          <div>
            <label style="display: block; font-size: 11.5px; font-weight: 700; color: var(--text-secondary); margin-bottom: 4px;">⏱️ Лимит экранного времени:</label>
            <select id="editor-screentime-select" class="storm-select" style="width: 100%; font-size: 12px; padding: 6px 10px; border-radius: 6px;">
              <option value="0" ${screenTimeVal === 0 ? 'selected' : ''}>Без ограничений по времени</option>
              <option value="30" ${screenTimeVal === 30 ? 'selected' : ''}>30 минут за сеанс</option>
              <option value="60" ${screenTimeVal === 60 ? 'selected' : ''}>1 час в день</option>
              <option value="90" ${screenTimeVal === 90 ? 'selected' : ''}>1,5 часа в день</option>
              <option value="120" ${screenTimeVal === 120 ? 'selected' : ''}>2 часа в день</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Защита паролем и PIN-кодом -->
      <div style="background: var(--bg-card); padding: 14px; border-radius: 12px; border: 1px solid var(--border-subtle);">
        <div class="storm-checkbox-3d-wrap ${hasPinLock ? 'checked' : ''}" id="editor-pin-toggle">
          <div class="storm-checkbox-3d-box">
            <div class="storm-checkbox-3d-inner"></div>
          </div>
          <div>
            <div style="font-weight: 700; font-size: 13px; color: #ffffff;">Защита профиля PIN-кодом (4 цифры)</div>
            <div style="font-size: 11.5px; color: var(--text-muted); margin-top: 2px;">
              Защищает профиль от входа другими членами семьи и блокирует самостоятельный выход из детского режима.
            </div>
          </div>
        </div>

        <div id="editor-pin-input-box" style="margin-top: 12px; display: ${hasPinLock ? 'flex' : 'none'}; align-items: center; gap: 10px; padding-left: 34px; flex-wrap: wrap;">
          <input type="password" id="editor-pin-code-input" class="storm-input" value="${pinVal}" placeholder="4 цифры" maxlength="4" style="width: 110px; font-size: 16px; font-weight: 800; letter-spacing: 4px; text-align: center; padding: 8px 10px; border-radius: 8px;">
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="toggle-pin-visibility-btn" style="font-size: 11px;">Показать</button>
          <span style="font-size: 11px; color: var(--text-muted);">(например: 1234, 0000)</span>
        </div>
      </div>
    </div>
  `;

  footer.innerHTML = `
    <div>
      ${isEditing && !profile.isDefault && profile.id !== 'primary' ? `
        <button type="button" class="storm-btn storm-btn-danger" id="delete-current-profile-btn" style="font-size: 12.5px;">
          <span>🗑️</span> Удалить профиль
        </button>
      ` : '<div></div>'}
    </div>
    <div style="display: flex; gap: 10px;">
      <button type="button" class="storm-btn storm-btn-secondary" id="cancel-profile-editor-btn" style="font-size: 13px;">Отмена</button>
      <button type="button" class="storm-btn storm-btn-primary" id="save-profile-editor-btn" style="font-size: 13px; font-weight: 800;">
        <span>💾</span> Сохранить профиль
      </button>
    </div>
  `;

  const nameInput = modal.querySelector('#editor-profile-name-input');
  const subtitleInput = modal.querySelector('#editor-profile-subtitle-input');
  const avatarPreview = modal.querySelector('#editor-avatar-preview');
  const presetsContainer = modal.querySelector('#family-avatar-presets-container');
  const bgGradientContainer = modal.querySelector('#family-bg-gradient-container');
  const customAvatarInput = modal.querySelector('#editor-custom-avatar-input');
  const applyCustomBtn = modal.querySelector('#apply-custom-avatar-btn');
  const fileInput = modal.querySelector('#editor-avatar-file-input');
  const randomAvatarBtn = modal.querySelector('#editor-random-avatar-btn');
  const themePrefSelect = modal.querySelector('#editor-theme-pref-select');
  const defaultTabSelect = modal.querySelector('#editor-default-tab-select');
  const kidToggle = modal.querySelector('#editor-kid-toggle');
  const ageRatingSelect = modal.querySelector('#editor-age-rating-select');
  const screenTimeSelect = modal.querySelector('#editor-screentime-select');
  const pinToggle = modal.querySelector('#editor-pin-toggle');
  const pinInputBox = modal.querySelector('#editor-pin-input-box');
  const pinCodeInput = modal.querySelector('#editor-pin-code-input');
  const pinVisBtn = modal.querySelector('#toggle-pin-visibility-btn');
  const cancelBtn = modal.querySelector('#cancel-profile-editor-btn');
  const saveBtn = modal.querySelector('#save-profile-editor-btn');
  const deleteBtn = modal.querySelector('#delete-current-profile-btn');

  const updatePreview = () => {
    if (avatarPreview) {
      avatarPreview.style.background = selectedBg;
      avatarPreview.innerHTML = renderAvatarElement({ avatar: selectedAvatar, name: '' });
    }
  };

  const catTabs = modal.querySelector('#family-avatar-category-tabs');
  if (catTabs && presetsContainer) {
    catTabs.querySelectorAll('.family-avatar-cat-btn').forEach(cBtn => {
      cBtn.onclick = () => {
        catTabs.querySelectorAll('.family-avatar-cat-btn').forEach(b => {
          b.classList.remove('active');
          b.style.background = '';
          b.style.color = '';
          b.style.fontWeight = '';
        });
        cBtn.classList.add('active');
        cBtn.style.background = 'var(--accent)';
        cBtn.style.color = '#090d16';
        cBtn.style.fontWeight = '800';
        const targetCat = cBtn.dataset.cat;
        presetsContainer.querySelectorAll('.avatar-preset-btn').forEach(item => {
          item.style.display = (targetCat === 'Все' || item.dataset.cat === targetCat) ? 'flex' : 'none';
        });
      };
    });
  }

  if (presetsContainer) {
    presetsContainer.querySelectorAll('.avatar-preset-btn').forEach(btn => {
      btn.onclick = () => {
        presetsContainer.querySelectorAll('.avatar-preset-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedAvatar = btn.dataset.icon;
        selectedBg = btn.dataset.bg;
        if (customAvatarInput) customAvatarInput.value = '';
        if (bgGradientContainer) {
          bgGradientContainer.querySelectorAll('.family-bg-swatch').forEach(s => {
            s.classList.toggle('selected', s.dataset.bg === selectedBg);
          });
        }
        updatePreview();
      };
    });
  }

  if (bgGradientContainer) {
    bgGradientContainer.querySelectorAll('.family-bg-swatch').forEach(sw => {
      sw.onclick = () => {
        bgGradientContainer.querySelectorAll('.family-bg-swatch').forEach(s => s.classList.remove('selected'));
        sw.classList.add('selected');
        selectedBg = sw.dataset.bg;
        updatePreview();
      };
    });
  }

  if (applyCustomBtn && customAvatarInput) {
    applyCustomBtn.onclick = () => {
      const val = customAvatarInput.value.trim();
      if (val) {
        selectedAvatar = val;
        if (presetsContainer) {
          presetsContainer.querySelectorAll('.avatar-preset-btn').forEach(b => b.classList.remove('selected'));
        }
        updatePreview();
        showToast('Аватар обновлён', 'info');
      }
    };
  }

  if (fileInput) {
    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        showToast('Пожалуйста, выберите файл изображения', 'error');
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        showToast('Размер файла не должен превышать 2 МБ', 'error');
        return;
      }
      const reader = new FileReader();
      reader.onload = (evt) => {
        selectedAvatar = evt.target.result;
        if (customAvatarInput) customAvatarInput.value = '';
        if (presetsContainer) {
          presetsContainer.querySelectorAll('.avatar-preset-btn').forEach(b => b.classList.remove('selected'));
        }
        updatePreview();
        showToast('Изображение загружено', 'success');
      };
      reader.readAsDataURL(file);
    };
  }

  if (randomAvatarBtn) {
    randomAvatarBtn.onclick = () => {
      const randomSeed = 'Storm-' + Math.random().toString(36).substring(2, 9);
      selectedAvatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${randomSeed}`;
      if (customAvatarInput) customAvatarInput.value = selectedAvatar;
      if (presetsContainer) {
        presetsContainer.querySelectorAll('.avatar-preset-btn').forEach(b => b.classList.remove('selected'));
      }
      updatePreview();
      showToast('Сгенерирован уникальный аватар', 'info');
    };
  }

  if (kidToggle) {
    kidToggle.onclick = () => {
      isKidMode = !isKidMode;
      kidToggle.classList.toggle('checked', isKidMode);
      if (isKidMode && ageRatingSelect && ageRatingSelect.value === '18+') {
        ageRatingSelect.value = '6+';
      }
      if (isKidMode && defaultTabSelect && defaultTabSelect.value === 'home') {
        defaultTabSelect.value = 'cartoons';
      }
    };
  }

  if (pinToggle && pinInputBox && pinCodeInput) {
    pinToggle.onclick = () => {
      hasPinLock = !hasPinLock;
      pinToggle.classList.toggle('checked', hasPinLock);
      pinInputBox.style.display = hasPinLock ? 'flex' : 'none';
      if (hasPinLock && (!pinCodeInput.value || pinCodeInput.value.length < 4)) {
        pinCodeInput.value = '0000';
      }
    };
  }

  if (pinVisBtn && pinCodeInput) {
    pinVisBtn.onclick = () => {
      const isPass = pinCodeInput.type === 'password';
      pinCodeInput.type = isPass ? 'text' : 'password';
      pinVisBtn.textContent = isPass ? 'Скрыть' : 'Показать';
    };
  }

  if (cancelBtn) {
    cancelBtn.onclick = () => {
      modal.classList.remove('is-open');
      openProfileSwitcherModal();
    };
  }

  if (deleteBtn) {
    deleteBtn.onclick = () => {
      if (confirm(`Вы действительно хотите удалить профиль «${profile.name}»?`)) {
        deleteFamilyProfile(profile.id);
        modal.classList.remove('is-open');
        openProfileSwitcherModal();
      }
    };
  }

  if (saveBtn && nameInput) {
    saveBtn.onclick = () => {
      const name = nameInput.value.trim();
      if (!name) {
        showToast('Пожалуйста, укажите имя профиля', 'error');
        nameInput.focus();
        return;
      }

      if (customAvatarInput && customAvatarInput.value.trim()) {
        selectedAvatar = customAvatarInput.value.trim();
      }

      if (hasPinLock) {
        const pin = pinCodeInput.value.trim();
        if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
          showToast('PIN-код должен состоять ровно из 4 цифр', 'error');
          pinCodeInput.focus();
          return;
        }
      }

      const payload = {
        name,
        subtitle: subtitleInput ? subtitleInput.value.trim() : '',
        avatar: selectedAvatar,
        avatarBg: selectedBg,
        isKid: isKidMode,
        ageRating: ageRatingSelect ? ageRatingSelect.value : (isKidMode ? '6+' : '18+'),
        hasPin: hasPinLock,
        pin: hasPinLock ? pinCodeInput.value.trim() : '',
        themePreference: themePrefSelect ? themePrefSelect.value : 'auto',
        defaultTab: defaultTabSelect ? defaultTabSelect.value : 'home',
        screenTimeLimit: screenTimeSelect ? (parseInt(screenTimeSelect.value, 10) || 0) : 0
      };

      if (isEditing) {
        updateFamilyProfile(profile.id, payload);
      } else {
        createFamilyProfile(payload);
      }

      modal.classList.remove('is-open');
      openProfileSwitcherModal();
    };
  }
}

// -------------------------------------------------------------
// 4. ИНТЕРАКТИВНЫЙ ЭКРАН ВВОДА PIN-КОДА (PIN PAD MODAL)
// -------------------------------------------------------------
// -------------------------------------------------------------
// 4. ИНТЕРАКТИВНЫЙ ЭКРАН ВВОДА PIN-КОДА (PIN PAD MODAL)
// -------------------------------------------------------------
export function openPinPromptModal(targetProfile, onSuccess, customTitle = null) {
  let modal = document.getElementById('family-pin-prompt-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'storm-modal-backdrop';
    modal.id = 'family-pin-prompt-modal';
    modal.innerHTML = `
      <div class="storm-modal" style="max-width: 420px; text-align: center;">
        <div class="storm-modal-header" style="justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 20px;">🔒</span>
            <h3 class="storm-modal-title" id="pin-prompt-header-title" style="margin: 0;">Вход в защищенный профиль</h3>
          </div>
          <button type="button" class="storm-modal-close" id="close-pin-prompt-btn">✕</button>
        </div>
        <div class="storm-modal-body" id="pin-prompt-body" style="padding: 24px 20px;"></div>
      </div>
    `;
    document.body.appendChild(modal);

    const closeBtn = modal.querySelector('#close-pin-prompt-btn');
    if (closeBtn) closeBtn.onclick = () => modal.classList.remove('is-open');
    modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('is-open'); };
  }

  modal.classList.add('is-open');
  const headerTitle = document.getElementById('pin-prompt-header-title');
  const body = document.getElementById('pin-prompt-body');

  headerTitle.textContent = customTitle || `Вход: ${targetProfile.name}`;

  let enteredPin = '';
  const requiredPin = targetProfile.pin || '0000';

  body.innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: center;">
      <div class="family-profile-avatar-box" style="width: 64px; height: 64px; font-size: 30px; margin-bottom: 10px; background: ${targetProfile.avatarBg || 'linear-gradient(135deg, #f59e0b, #d97706)'};">
        ${renderAvatarElement(targetProfile)}
      </div>
      <div style="font-size: 15px; font-weight: 800; color: #ffffff; margin-bottom: 4px;">${targetProfile.name}</div>
      <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 16px;">Введите 4-значный PIN-код профиля:</div>

      <div class="family-pin-display" id="family-pin-slots">
        <div class="family-pin-slot" id="pin-slot-0"></div>
        <div class="family-pin-slot" id="pin-slot-1"></div>
        <div class="family-pin-slot" id="pin-slot-2"></div>
        <div class="family-pin-slot" id="pin-slot-3"></div>
      </div>

      <div class="family-pin-keypad">
        <button type="button" class="family-pin-key" data-digit="1">1</button>
        <button type="button" class="family-pin-key" data-digit="2">2</button>
        <button type="button" class="family-pin-key" data-digit="3">3</button>
        <button type="button" class="family-pin-key" data-digit="4">4</button>
        <button type="button" class="family-pin-key" data-digit="5">5</button>
        <button type="button" class="family-pin-key" data-digit="6">6</button>
        <button type="button" class="family-pin-key" data-digit="7">7</button>
        <button type="button" class="family-pin-key" data-digit="8">8</button>
        <button type="button" class="family-pin-key" data-digit="9">9</button>
        <button type="button" class="family-pin-key key-action" id="pin-cancel-btn">✕</button>
        <button type="button" class="family-pin-key" data-digit="0">0</button>
        <button type="button" class="family-pin-key key-action" id="pin-backspace-btn">⌫</button>
      </div>
    </div>
  `;

  function updateSlots() {
    for (let i = 0; i < 4; i++) {
      const slot = document.getElementById(`pin-slot-${i}`);
      if (!slot) continue;
      if (i < enteredPin.length) {
        slot.textContent = '●';
        slot.classList.add('filled');
      } else {
        slot.textContent = '';
        slot.classList.remove('filled', 'error');
      }
    }
  }

  function handleDigit(d) {
    if (enteredPin.length >= 4) return;
    enteredPin += d;
    updateSlots();

    if (enteredPin.length === 4) {
      if (enteredPin === requiredPin) {
        // Успех!
        for (let i = 0; i < 4; i++) {
          const slot = document.getElementById(`pin-slot-${i}`);
          if (slot) slot.style.borderColor = '#10b981';
        }
        setTimeout(() => {
          modal.classList.remove('is-open');
          cleanup();
          if (typeof onSuccess === 'function') onSuccess();
        }, 200);
      } else {
        // Ошибка PIN
        const slotsWrap = document.getElementById('family-pin-slots');
        if (slotsWrap) {
          slotsWrap.classList.add('shake-anim');
          for (let i = 0; i < 4; i++) {
            const slot = document.getElementById(`pin-slot-${i}`);
            if (slot) slot.classList.add('error');
          }
        }
        showToast('Неверный PIN-код доступа', 'error');
        setTimeout(() => {
          enteredPin = '';
          if (slotsWrap) slotsWrap.classList.remove('shake-anim');
          updateSlots();
        }, 600);
      }
    }
  }

  function handleBackspace() {
    if (enteredPin.length > 0) {
      enteredPin = enteredPin.slice(0, -1);
      updateSlots();
    }
  }

  // Клик по цифровым клавишам
  body.querySelectorAll('.family-pin-key[data-digit]').forEach(key => {
    key.onclick = () => handleDigit(key.dataset.digit);
  });

  const backspaceBtn = document.getElementById('pin-backspace-btn');
  if (backspaceBtn) backspaceBtn.onclick = handleBackspace;

  const cancelPinBtn = document.getElementById('pin-cancel-btn');
  if (cancelPinBtn) {
    cancelPinBtn.onclick = () => {
      modal.classList.remove('is-open');
      cleanup();
    };
  }

  // Обработка физической клавиатуры
  function onKeyDown(e) {
    if (!modal.classList.contains('is-open')) return;
    if (e.key >= '0' && e.key <= '9') {
      handleDigit(e.key);
    } else if (e.key === 'Backspace') {
      handleBackspace();
    } else if (e.key === 'Escape') {
      modal.classList.remove('is-open');
      cleanup();
    }
  }

  function cleanup() {
    window.removeEventListener('keydown', onKeyDown);
  }

  window.addEventListener('keydown', onKeyDown);
}


// =========================================================================
// БЫСТРОЕ ПЕРЕКЛЮЧЕНИЕ АККАУНТОВ (ACCOUNT SWITCHER) И ВОССТАНОВЛЕНИЕ ПАРОЛЯ
// =========================================================================
let cachedSavedAccounts = [];

function getLocalVaultTokens() {
  try {
    const raw = localStorage.getItem('storm_vault_tokens');
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.filter(Boolean);
    }
  } catch (_) {}
  return currentToken ? [currentToken] : [];
}

function saveLocalVaultTokens(tokens = []) {
  try {
    const merged = Array.from(new Set([...(Array.isArray(tokens) ? tokens : []), ...(currentToken ? [currentToken] : [])].filter(t => t && !String(t).startsWith('guest_') && !String(t).startsWith('offline_')))).slice(0, 8);
    if (typeof window !== 'undefined') window.__STORM_SUPPRESS_DB_SYNC__ = true;
    localStorage.setItem('storm_vault_tokens', JSON.stringify(merged));
  } catch (_) {
  } finally {
    if (typeof window !== 'undefined') window.__STORM_SUPPRESS_DB_SYNC__ = false;
  }
}

export async function fetchSavedAccounts() {
  try {
    const vaultTokens = getLocalVaultTokens();
    const headers = {};
    if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;
    if (vaultTokens.length > 0) headers['X-Storm-Vault'] = vaultTokens.join('.');
    const res = await fetch('/api/auth/saved-accounts', {
      headers,
      credentials: 'same-origin'
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.vaultTokens)) saveLocalVaultTokens(data.vaultTokens);
      if (Array.isArray(data.accounts)) {
        cachedSavedAccounts = data.accounts;
      }
    }
  } catch (_) {}
  renderSavedAccountsLists();
  return cachedSavedAccounts;
}

export async function switchSavedAccount(targetUserId) {
  const uid = Number(targetUserId || 0);
  if (!uid) return null;
  const vaultTokens = getLocalVaultTokens();
  const headers = { 'Content-Type': 'application/json' };
  if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;
  if (vaultTokens.length > 0) headers['X-Storm-Vault'] = vaultTokens.join('.');

  const res = await fetch('/api/auth/switch-account', {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: JSON.stringify({ userId: uid, vaultTokens })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data || !data.user) {
    throw new Error(data?.error || 'Не удалось переключить аккаунт');
  }

  const keepVault = Array.isArray(data.vaultTokens) ? data.vaultTokens : vaultTokens;
  clearUserSessionLocalCache();
  currentToken = data.token;
  currentUser = data.user;
  if (data.stats) currentUser.stats = data.stats;
  if (typeof window !== 'undefined') {
    window.__STORM_CURRENT_USER__ = currentUser;
    window.__STORM_CURRENT_TOKEN__ = currentToken;
  }
  localStorage.setItem('storm_active_user_id', String(data.user.id));
  localStorage.setItem('storm_token', currentToken);
  localStorage.setItem('storm_user', JSON.stringify(currentUser));
  saveLocalVaultTokens(keepVault);
  if (Array.isArray(data.savedAccounts)) {
    cachedSavedAccounts = data.savedAccounts;
  }

  updateAuthUI();
  notifyAuthChanged();
  renderSavedAccountsLists();
  showToast(`⚡ Вы переключились на аккаунт «${currentUser.username}»!`, 'success');
  return currentUser;
}

export async function removeSavedAccount(targetUserId) {
  const uid = Number(targetUserId || 0);
  if (!uid) return;
  const vaultTokens = getLocalVaultTokens();
  const headers = { 'Content-Type': 'application/json' };
  if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;
  if (vaultTokens.length > 0) headers['X-Storm-Vault'] = vaultTokens.join('.');

  const res = await fetch('/api/auth/saved-accounts/remove', {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: JSON.stringify({ userId: uid, vaultTokens })
  });
  const data = await res.json().catch(() => ({}));
  if (Array.isArray(data.vaultTokens)) {
    saveLocalVaultTokens(data.vaultTokens);
  }
  if (Array.isArray(data.accounts)) {
    cachedSavedAccounts = data.accounts;
  }
  if (data.removedCurrent) {
    currentToken = null;
    currentUser = null;
    clearUserSessionLocalCache();
    if (Array.isArray(data.vaultTokens)) saveLocalVaultTokens(data.vaultTokens);
    updateAuthUI();
    notifyAuthChanged();
  }
  renderSavedAccountsLists();
  showToast('Аккаунт удалён из списка быстрого доступа на устройстве', 'info');
}

export function renderSavedAccountsLists() {
  const profileListEl = document.getElementById('profile-saved-accounts-list');
  const authBoxEl = document.getElementById('auth-saved-accounts-box');
  const authListEl = document.getElementById('auth-saved-accounts-list');

  const accounts = Array.isArray(cachedSavedAccounts) ? cachedSavedAccounts : [];

  if (profileListEl) {
    if (accounts.length === 0) {
      profileListEl.innerHTML = `<div style="font-size: 12px; color: var(--text-muted); padding: 8px 10px; border-radius: 8px; background: rgba(15, 23, 42, 0.45);">Нет сохранённых сессий. Войдите в аккаунт или нажмите «➕ Добавить аккаунт».</div>`;
    } else {
      profileListEl.innerHTML = accounts.map(acc => {
        const isCurr = Boolean(currentUser && Number(currentUser.id) === Number(acc.id));
        const roleBadge = (acc.role === 'admin' || String(acc.username || '').toLowerCase() === 'reikatari')
          ? `<span style="padding: 2px 6px; border-radius: 5px; background: rgba(245, 158, 11, 0.2); color: #f59e0b; font-size: 10px; font-weight: 800; margin-left: 6px;">ADMIN</span>`
          : '';
        return `
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 12px; border-radius: 11px; background: ${isCurr ? 'rgba(0, 210, 255, 0.12)' : 'rgba(30, 41, 59, 0.65)'}; border: 1px solid ${isCurr ? 'rgba(0, 210, 255, 0.45)' : 'rgba(255, 255, 255, 0.08)'};">
            <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
              <img src="${escapeHtml(acc.avatar || 'assets/avatar_default.svg')}" alt="" style="width: 34px; height: 34px; border-radius: 50%; object-fit: cover; border: 1px solid rgba(255,255,255,0.15);" onerror="this.src='assets/avatar_default.svg'">
              <div style="min-width: 0;">
                <div style="font-size: 13px; font-weight: 700; color: var(--text-primary, #f8fafc); display: flex; align-items: center; flex-wrap: wrap;">
                  <span>${escapeHtml(acc.username)}</span>
                  ${roleBadge}
                  ${isCurr ? `<span style="padding: 2px 6px; border-radius: 5px; background: rgba(16, 185, 129, 0.2); color: #34d399; font-size: 10px; font-weight: 800; margin-left: 6px;">АКТИВЕН</span>` : ''}
                </div>
                <div style="font-size: 11px; color: var(--text-muted, #94a3b8); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(acc.email || '')}</div>
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
              ${!isCurr ? `<button type="button" class="storm-btn storm-btn-primary storm-btn-sm" data-switch-uid="${acc.id}" style="font-size: 11px; padding: 5px 10px;">⚡ Переключить</button>` : ''}
              <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" data-remove-uid="${acc.id}" title="Удалить аккаунт из быстрого переключения" style="font-size: 11px; padding: 5px 8px; color: #f87171;">✕</button>
            </div>
          </div>
        `;
      }).join('');

      profileListEl.querySelectorAll('[data-switch-uid]').forEach(btn => {
        btn.onclick = async () => {
          const uid = Number(btn.getAttribute('data-switch-uid'));
          btn.disabled = true;
          btn.textContent = '⏳...';
          try {
            await switchSavedAccount(uid);
            openProfileModal();
          } catch (err) {
            showToast(err.message, 'error');
            btn.disabled = false;
            btn.textContent = '⚡ Переключить';
          }
        };
      });

      profileListEl.querySelectorAll('[data-remove-uid]').forEach(btn => {
        btn.onclick = async () => {
          const uid = Number(btn.getAttribute('data-remove-uid'));
          await removeSavedAccount(uid);
          if (currentUser) openProfileModal();
        };
      });
    }
  }

  if (authBoxEl && authListEl) {
    if (accounts.length === 0) {
      authBoxEl.style.display = 'none';
    } else {
      authBoxEl.style.display = 'block';
      authListEl.innerHTML = accounts.map(acc => {
        const isCurr = Boolean(currentUser && Number(currentUser.id) === Number(acc.id));
        return `
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 10px; border-radius: 9px; background: rgba(30, 41, 59, 0.75); border: 1px solid rgba(255,255,255,0.08);">
            <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
              <img src="${escapeHtml(acc.avatar || 'assets/avatar_default.svg')}" alt="" style="width: 28px; height: 28px; border-radius: 50%; object-fit: cover;" onerror="this.src='assets/avatar_default.svg'">
              <div style="min-width: 0;">
                <div style="font-size: 12px; font-weight: 700; color: #f8fafc;">${escapeHtml(acc.username)} ${isCurr ? '<span style="color:#34d399;font-size:10px;">(активен)</span>' : ''}</div>
                <div style="font-size: 10px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(acc.email || '')}</div>
              </div>
            </div>
            <div style="display: flex; gap: 5px;">
              <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" data-auth-switch-uid="${acc.id}" style="font-size: 11px; padding: 4px 10px;">⚡ Войти</button>
              <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" data-auth-remove-uid="${acc.id}" title="Забыть аккаунт" style="font-size: 11px; padding: 4px 7px; color: #f87171;">✕</button>
            </div>
          </div>
        `;
      }).join('');

      authListEl.querySelectorAll('[data-auth-switch-uid]').forEach(btn => {
        btn.onclick = async () => {
          const uid = Number(btn.getAttribute('data-auth-switch-uid'));
          btn.disabled = true;
          btn.textContent = '⏳...';
          try {
            await switchSavedAccount(uid);
            document.getElementById('auth-modal')?.classList.remove('is-open');
          } catch (err) {
            showToast(err.message, 'error');
            btn.disabled = false;
            btn.textContent = '⚡ Войти';
          }
        };
      });

      authListEl.querySelectorAll('[data-auth-remove-uid]').forEach(btn => {
        btn.onclick = async () => {
          const uid = Number(btn.getAttribute('data-auth-remove-uid'));
          await removeSavedAccount(uid);
        };
      });
    }
  }
}

export async function requestTelegramPasswordReset(loginStr) {
  const cleanLogin = String(loginStr || '').trim();
  if (!cleanLogin) {
    throw new Error('Введите имя пользователя или email, чтобы получить код в Telegram');
  }
  const res = await fetch('/api/auth/password/request-telegram', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: cleanLogin })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(data?.error || 'Ошибка отправки кода в Telegram');
  }
  showToast(`✈️ ${data.message}`, 'success');
  return data;
}

export async function confirmPasswordReset(loginStr, codeStr, newPasswordStr) {
  const cleanLogin = String(loginStr || '').trim();
  const cleanCode = String(codeStr || '').trim();
  const cleanPass = String(newPasswordStr || '').trim();
  if (!cleanLogin || !cleanCode || !cleanPass) {
    throw new Error('Заполните логин/email, резервный код (или код из Telegram) и новый пароль');
  }
  if (cleanPass.length < 6) {
    throw new Error('Новый пароль должен содержать не менее 6 символов');
  }

  const vaultTokens = getLocalVaultTokens();
  const headers = { 'Content-Type': 'application/json' };
  if (vaultTokens.length > 0) headers['X-Storm-Vault'] = vaultTokens.join('.');

  const res = await fetch('/api/auth/password/reset-confirm', {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: JSON.stringify({ login: cleanLogin, code: cleanCode, newPassword: cleanPass })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data || !data.user) {
    throw new Error(data?.error || 'Не удалось сбросить пароль');
  }

  const keepVault = Array.isArray(data.vaultTokens) ? data.vaultTokens : vaultTokens;
  clearUserSessionLocalCache();
  currentToken = data.token;
  currentUser = data.user;
  if (typeof window !== 'undefined') {
    window.__STORM_CURRENT_USER__ = currentUser;
    window.__STORM_CURRENT_TOKEN__ = currentToken;
  }
  localStorage.setItem('storm_active_user_id', String(data.user.id));
  localStorage.setItem('storm_token', currentToken);
  localStorage.setItem('storm_user', JSON.stringify(currentUser));
  saveLocalVaultTokens(keepVault);
  if (Array.isArray(data.savedAccounts)) {
    cachedSavedAccounts = data.savedAccounts;
  }

  updateAuthUI();
  notifyAuthChanged();
  renderSavedAccountsLists();
  showToast(`✅ ${data.message || 'Пароль успешно обновлён, вход выполнен!'}`, 'success');
  return currentUser;
}

export async function loadProfileRecoveryConfigUI() {
  const gridEl = document.getElementById('profile-recovery-codes-grid');
  const tgInput = document.getElementById('profile-recovery-tg-input');
  const copyBtn = document.getElementById('profile-copy-recovery-codes-btn');
  const regenBtn = document.getElementById('profile-regen-recovery-codes-btn');
  const saveTgBtn = document.getElementById('profile-save-recovery-tg-btn');
  const testTgBtn = document.getElementById('profile-test-recovery-tg-btn');
  if (!gridEl) return;

  const token = getToken();
  if (!token || token.startsWith('guest_') || token.startsWith('offline_')) {
    gridEl.innerHTML = `<div style="grid-column: 1 / -1; color: var(--text-muted); font-size: 12px;">Войдите в аккаунт, чтобы просматривать резервные коды восстановления и привязать Telegram.</div>`;
    return;
  }

  let currentCodes = [];
  const renderCodes = (codes = []) => {
    currentCodes = codes;
    if (!codes || codes.length === 0) {
      gridEl.innerHTML = `<div style="grid-column: 1 / -1; color: var(--text-muted);">Нет кодов</div>`;
      return;
    }
    gridEl.innerHTML = codes.map(c => `<div style="padding: 6px 8px; border-radius: 7px; background: rgba(30, 41, 59, 0.85); border: 1px solid rgba(255,255,255,0.08); user-select: all;">${escapeHtml(c)}</div>`).join('');
  };

  try {
    const res = await fetch('/api/auth/recovery/config', {
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'same-origin'
    });
    if (res.ok) {
      const data = await res.json();
      renderCodes(data.recoveryCodes || []);
      if (tgInput) tgInput.value = data.telegramChatId || '';
    }
  } catch (_) {}

  if (copyBtn) {
    copyBtn.onclick = async () => {
      if (!currentCodes.length) return;
      const text = `STORM MULTIMEDIA — Резервные коды восстановления (${currentUser?.username || 'User'}):\n` + currentCodes.join('\n');
      try {
        await navigator.clipboard.writeText(text);
        showToast('📋 Резервные коды скопированы в буфер обмена!', 'success');
      } catch (_) {
        showToast('Коды: ' + currentCodes.join(', '), 'info');
      }
    };
  }

  if (regenBtn) {
    regenBtn.onclick = async () => {
      try {
        const res = await fetch('/api/auth/recovery/regenerate-codes', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${getToken()}` },
          credentials: 'same-origin'
        });
        const data = await res.json();
        if (res.ok && data.recoveryCodes) {
          renderCodes(data.recoveryCodes);
          showToast('🔄 Сгенерированы новые одноразовые резервные коды!', 'success');
        }
      } catch (err) {
        showToast(err.message, 'error');
      }
    };
  }

  const saveTgHandler = async (sendTest = false) => {
    const chatId = (tgInput?.value || '').trim();
    try {
      const res = await fetch('/api/auth/recovery/telegram', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        },
        credentials: 'same-origin',
        body: JSON.stringify({ telegramChatId: chatId, sendTest })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка сохранения Telegram');
      showToast(`✅ ${data.message}`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  if (saveTgBtn) saveTgBtn.onclick = () => saveTgHandler(false);
  if (testTgBtn) testTgBtn.onclick = () => saveTgHandler(true);
}
