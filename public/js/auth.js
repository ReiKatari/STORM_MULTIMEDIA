/* ==========================================================================
   STORM MULTIMEDIA - МОДУЛЬ АУТЕНТИФИКАЦИИ И ПРОФИЛЯ ПОЛЬЗОВАТЕЛЯ
   ========================================================================== */

import { t, formatDate } from './i18n.js';

let currentUser = null;
let currentToken = localStorage.getItem('storm_token') || null;
let onAuthChangedCallbacks = [];

export function getToken() {
  return currentToken;
}

export function getUser() {
  return currentUser;
}

export function onAuthChanged(cb) {
  onAuthChangedCallbacks.push(cb);
}

function notifyAuthChanged() {
  onAuthChangedCallbacks.forEach(cb => cb(currentUser));
}

export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'storm-toast';
  
  const icon = type === 'success' ? '✅' : type === 'error' ? '⚠️' : '⚡';
  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

export async function checkAuth() {
  if (!currentToken) {
    try {
      const autoRes = await fetch('/api/auth/auto-login', { method: 'POST' });
      if (autoRes.ok) {
        const autoData = await autoRes.json();
        if (autoData?.token && autoData?.user) {
          currentToken = autoData.token;
          currentUser = autoData.user;
          localStorage.setItem('storm_token', currentToken);
          updateAuthUI();
          notifyAuthChanged();
          return currentUser;
        }
      }
    } catch {}
    currentUser = null;
    updateAuthUI();
    notifyAuthChanged();
    return null;
  }

  try {
    const res = await fetch('/api/auth/me', {
      headers: {
        'Authorization': `Bearer ${currentToken}`
      }
    });

    if (res.ok) {
      const data = await res.json();
      currentUser = data.user;
      if (currentUser) {
        currentUser.stats = data.stats;
      } else {
        currentToken = null;
        localStorage.removeItem('storm_token');
      }
    } else {
      currentUser = null;
      currentToken = null;
      localStorage.removeItem('storm_token');
    }
  } catch (err) {
    console.warn('Ошибка проверки авторизации:', err.message);
  }

  updateAuthUI();
  notifyAuthChanged();
  return currentUser;
}

export async function register(username, email, password) {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка при регистрации');
  }

  currentToken = data.token;
  currentUser = data.user;
  localStorage.setItem('storm_token', currentToken);
  
  updateAuthUI();
  notifyAuthChanged();
  showToast(t('msg_login_success'), 'success');
  return currentUser;
}

export async function login(loginStr, password) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: loginStr, password })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка авторизации');
  }

  currentToken = data.token;
  currentUser = data.user;
  localStorage.setItem('storm_token', currentToken);

  updateAuthUI();
  notifyAuthChanged();
  showToast(t('msg_login_success'), 'success');
  return currentUser;
}

export async function logout() {
  if (currentToken) {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${currentToken}` }
      });
    } catch (e) {
      // Игнорируем сетевые ошибки при выходе
    }
  }

  currentToken = null;
  currentUser = null;
  localStorage.removeItem('storm_token');

  updateAuthUI();
  notifyAuthChanged();
  showToast(t('msg_logout_success'), 'info');
}

export function updateAuthUI() {
  const profileBtn = document.getElementById('user-profile-btn');
  const loginBtn = document.getElementById('login-modal-btn');
  const headerProfileBtn = document.getElementById('header-profile-btn');
  const avatarImg = document.getElementById('user-avatar-img');
  const userNameSpan = document.getElementById('user-name-label');

  if (currentUser) {
    if (loginBtn) loginBtn.style.display = 'none';
    if (headerProfileBtn) headerProfileBtn.style.display = 'none';
    if (profileBtn) profileBtn.style.display = 'flex';
    if (avatarImg) avatarImg.src = currentUser.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(currentUser.username)}`;
    if (userNameSpan) userNameSpan.textContent = currentUser.username;
  } else {
    if (loginBtn) loginBtn.style.display = 'inline-flex';
    if (headerProfileBtn) headerProfileBtn.style.display = 'inline-flex';
    if (profileBtn) profileBtn.style.display = 'none';
  }
}

export const AVATAR_PRESETS = [
  { id: 'bot-1', name: 'Cyber Titan', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=STORM-1' },
  { id: 'bot-2', name: 'Neon Scout', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=CyberRei' },
  { id: 'bot-3', name: 'Matrix Unit', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=NeonMatrix' },
  { id: 'adv-1', name: 'Shadow Hunter', url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=ShadowHunter' },
  { id: 'adv-2', name: 'Cyber Hero', url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=CyberHero' },
  { id: 'adv-3', name: 'Valeria Prime', url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Valeria' },
  { id: 'mic-1', name: 'Imperium Gold', url: 'https://api.dicebear.com/7.x/micah/svg?seed=WarhammerGoth' },
  { id: 'mic-2', name: 'Star Voyager', url: 'https://api.dicebear.com/7.x/micah/svg?seed=SpaceCommander' },
  { id: 'lor-1', name: 'Anime Star', url: 'https://api.dicebear.com/7.x/lorelei/svg?seed=AnimeStar' },
  { id: 'lor-2', name: 'Cyber Kitsune', url: 'https://api.dicebear.com/7.x/lorelei/svg?seed=CyberKitsune' },
  { id: 'ava-1', name: 'Cinema Master', url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=CinemaFan' },
  { id: 'ide-1', name: 'Quantum Core', url: 'https://api.dicebear.com/7.x/identicon/svg?seed=StormMaster' }
];

export async function updateProfile(username, email, avatar) {
  if (!currentUser) return false;
  try {
    const res = await fetch('/api/auth/profile/update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('storm_token')}`
      },
      body: JSON.stringify({ username, email, avatar })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Ошибка обновления профиля');
    }

    const data = await res.json();
    currentUser = { ...currentUser, ...(data.user || data) };
    updateAuthUI();
    showToast('Профиль успешно обновлен!', 'success');
    return true;
  } catch (err) {
    showToast(err.message, 'error');
    return false;
  }
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

export function openProfileModal() {
  const modal = document.getElementById('profile-modal');
  if (!modal) return;

  const currentAvatar = currentUser
    ? (currentUser.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(currentUser.username)}`)
    : 'assets/favicon.svg';
  const avatarEl = document.getElementById('profile-avatar');
  if (avatarEl) avatarEl.src = currentAvatar;

  const userEl = document.getElementById('profile-username');
  if (userEl) userEl.textContent = currentUser ? currentUser.username : 'Гость (Без авторизации)';

  const emailEl = document.getElementById('profile-email');
  if (emailEl) emailEl.textContent = currentUser ? currentUser.email : 'Войдите для синхронизации и сохранения';

  const dateEl = document.getElementById('profile-date');
  if (dateEl) dateEl.textContent = currentUser ? formatDate(currentUser.created_at) : '—';

  const stats = currentUser?.stats || {};
  const setStat = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val || 0;
  };
  setStat('profile-stat-hours', stats.totalWatchedHours);
  setStat('profile-stat-watching', stats.watchingCount);
  setStat('profile-stat-planned', stats.plannedCount);
  setStat('profile-stat-completed', stats.completedCount);
  setStat('profile-stat-favorites', stats.favoritesCount || stats.favoriteCount);
  setStat('profile-stat-onhold', stats.onHoldCount);
  setStat('profile-stat-dropped', stats.droppedCount);
  setStat('profile-stat-wontwatch', stats.wontWatchCount);
  setStat('profile-stat-bookmarks', stats.bookmarksCount);
  setStat('profile-stat-lists', stats.customListsCount);

  // Язык интерфейса в настройках профиля
  const profileLangSelect = document.getElementById('profile-lang-select');
  if (profileLangSelect) {
    profileLangSelect.value = localStorage.getItem('storm_lang') || 'ru';
    profileLangSelect.onchange = (e) => {
      import('./i18n.js').then(m => m.setLanguage(e.target.value));
    };
  }

  // Тема оформления в настройках профиля
  const profileThemeSelect = document.getElementById('profile-theme-select');
  if (profileThemeSelect) {
    profileThemeSelect.value = localStorage.getItem('storm_theme') || 'STORM DARK';
    profileThemeSelect.onchange = (e) => {
      import('./theme.js').then(m => m.setTheme(e.target.value));
    };
  }

  // Заполняем форму редактирования профиля
  const inputUser = document.getElementById('edit-profile-username');
  if (inputUser) inputUser.value = currentUser ? currentUser.username : '';

  const inputEmail = document.getElementById('edit-profile-email');
  if (inputEmail) inputEmail.value = currentUser ? currentUser.email : '';

  const inputAvatar = document.getElementById('edit-avatar-url');
  if (inputAvatar) inputAvatar.value = currentUser?.avatar || '';

  // Рендерим пресеты аватарок
  renderAvatarPresets(currentUser?.avatar || '');

  // Кнопка выхода / входа внизу модалки
  const logoutBtn = document.getElementById('profile-logout-btn');
  if (logoutBtn) {
    if (currentUser) {
      logoutBtn.textContent = t('auth_logout') || 'Выйти из аккаунта';
      logoutBtn.className = 'storm-btn storm-btn-danger';
      logoutBtn.onclick = () => {
        logout();
        modal.classList.remove('is-open');
      };
    } else {
      logoutBtn.textContent = 'Войти в аккаунт';
      logoutBtn.className = 'storm-btn storm-btn-primary';
      logoutBtn.onclick = () => {
        modal.classList.remove('is-open');
        const authModal = document.getElementById('auth-modal');
        if (authModal) authModal.classList.add('is-open');
      };
    }
  }

  // Сбрасываем активную вкладку на 'overview'
  switchProfileTab('overview');

  modal.classList.add('is-open');
}

function renderAvatarPresets(selectedUrl) {
  const container = document.getElementById('avatar-presets-container');
  if (!container) return;

  container.innerHTML = AVATAR_PRESETS.map(preset => `
    <div class="avatar-preset-item ${selectedUrl === preset.url ? 'selected' : ''}" data-url="${preset.url}" title="${preset.name}">
      <img src="${preset.url}" alt="${preset.name}">
    </div>
  `).join('');

  container.querySelectorAll('.avatar-preset-item').forEach(item => {
    item.addEventListener('click', () => {
      container.querySelectorAll('.avatar-preset-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
      const url = item.dataset.url;
      const input = document.getElementById('edit-avatar-url');
      if (input) input.value = url;
      const profileAvatar = document.getElementById('profile-avatar');
      if (profileAvatar) profileAvatar.src = url;
    });
  });
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
      import('./achievements.js').then(m => m.renderProfileAchievements(achievements));
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
      document.querySelectorAll('.avatar-preset-item').forEach(el => el.classList.remove('selected'));
      showToast('Сгенерирован новый уникальный аватар!', 'info');
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
        document.querySelectorAll('.avatar-preset-item').forEach(el => el.classList.remove('selected'));
        showToast('Изображение загружено!', 'success');
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

      if (!username || !email) {
        showToast('Имя пользователя и email обязательны', 'error');
        return;
      }

      try {
        await updateProfile(username, email, avatar);
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
}

// ==========================================
// МНОГОПРОФИЛЬНОСТЬ И СЕМЕЙНЫЙ АККАУНТ
// ==========================================

export const FAMILY_AVATAR_PRESETS = [
  // Герои и статус
  { id: 'crown', icon: '👑', label: 'Корона', bg: 'linear-gradient(135deg, #f59e0b, #d97706)' },
  { id: 'hero', icon: '🦸', label: 'Герой', bg: 'linear-gradient(135deg, #00d2ff, #0072ff)' },
  { id: 'ninja', icon: '🥷', label: 'Ниндзя', bg: 'linear-gradient(135deg, #64748b, #1e293b)' },
  { id: 'wizard', icon: '🧙', label: 'Маг', bg: 'linear-gradient(135deg, #a855f7, #6366f1)' },
  { id: 'detective', icon: '🕵️', label: 'Детектив', bg: 'linear-gradient(135deg, #d97706, #78350f)' },
  { id: 'cyborg', icon: '🤖', label: 'Киборг', bg: 'linear-gradient(135deg, #00f0ff, #0066cc)' },

  // Семья и дети
  { id: 'family', icon: '👨‍👩‍👧', label: 'Семья', bg: 'linear-gradient(135deg, #10b981, #059669)' },
  { id: 'unicorn', icon: '🦄', label: 'Единорог', bg: 'linear-gradient(135deg, #ff007f, #a855f7)' },
  { id: 'bear', icon: '🧸', label: 'Мишка', bg: 'linear-gradient(135deg, #f59e0b, #b45309)' },
  { id: 'cat', icon: '🐱', label: 'Котик', bg: 'linear-gradient(135deg, #fb7185, #e11d48)' },
  { id: 'lion', icon: '🦁', label: 'Лев', bg: 'linear-gradient(135deg, #f59e0b, #ea580c)' },
  { id: 'astronaut', icon: '🚀', label: 'Космонавт', bg: 'linear-gradient(135deg, #38bdf8, #1d4ed8)' },

  // Аниме и игры
  { id: 'lightning', icon: '⚡', label: 'Молния', bg: 'linear-gradient(135deg, #facc15, #ca8a04)' },
  { id: 'gamepad', icon: '🎮', label: 'Геймер', bg: 'linear-gradient(135deg, #8b5cf6, #4c1d95)' },
  { id: 'dragon', icon: '🐉', label: 'Дракон', bg: 'linear-gradient(135deg, #ef4444, #991b1b)' },
  { id: 'fox', icon: '🦊', label: 'Лис', bg: 'linear-gradient(135deg, #f97316, #c2410c)' },
  { id: 'sakura', icon: '🌸', label: 'Сакура', bg: 'linear-gradient(135deg, #f472b6, #db2777)' },
  { id: 'pixel', icon: '👾', label: 'Пиксель', bg: 'linear-gradient(135deg, #39ff14, #15803d)' },

  // Кино и классика
  { id: 'popcorn', icon: '🍿', label: 'Попкорн', bg: 'linear-gradient(135deg, #ef4444, #f59e0b)' },
  { id: 'clapper', icon: '🎬', label: 'Хлопушка', bg: 'linear-gradient(135deg, #334155, #0f172a)' },
  { id: 'theatre', icon: '🎭', label: 'Театр', bg: 'linear-gradient(135deg, #d4af37, #997b1e)' },
  { id: 'star', icon: '🌟', label: 'Звезда', bg: 'linear-gradient(135deg, #fbbf24, #d97706)' },
  { id: 'glasses', icon: '🕶️', label: 'Нео', bg: 'linear-gradient(135deg, #00ff66, #065f46)' },
  { id: 'diamond', icon: '💎', label: 'Алмаз', bg: 'linear-gradient(135deg, #38bdf8, #0284c7)' }
];

const DEFAULT_PROFILES = [
  {
    id: 'primary',
    name: 'Основной профиль',
    avatar: '👑',
    avatarBg: 'linear-gradient(135deg, #f59e0b, #d97706)',
    isKid: false,
    ageRating: '18+',
    hasPin: false,
    pin: '',
    isDefault: true
  },
  {
    id: 'family',
    name: 'Семейный просмотр',
    avatar: '👨‍👩‍👧',
    avatarBg: 'linear-gradient(135deg, #10b981, #059669)',
    isKid: false,
    ageRating: '18+',
    hasPin: false,
    pin: '',
    isDefault: false
  },
  {
    id: 'kids',
    name: 'Детский профиль',
    avatar: '🦄',
    avatarBg: 'linear-gradient(135deg, #ff007f, #a855f7)',
    isKid: true,
    ageRating: '0+',
    hasPin: true,
    pin: '0000',
    isDefault: false
  }
];

let familyProfiles = DEFAULT_PROFILES;
try {
  const saved = localStorage.getItem('storm_family_profiles');
  if (saved) {
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed) && parsed.length > 0) {
      familyProfiles = parsed;
    }
  }
} catch {}

let activeProfileId = localStorage.getItem('storm_active_profile_id') || 'primary';

// Фоновая синхронизация с сервером при наличии сети
async function syncProfilesWithServer() {
  try {
    const token = getToken();
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    const res = await fetch('/api/profiles', { headers });
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.profiles) && data.profiles.length > 0) {
        familyProfiles = data.profiles;
        localStorage.setItem('storm_family_profiles', JSON.stringify(familyProfiles));
        updateAuthUI();
      }
    }
  } catch {}
}
syncProfilesWithServer();

export function getFamilyProfiles() {
  return [...familyProfiles];
}

export function saveFamilyProfiles(profiles) {
  if (!Array.isArray(profiles) || profiles.length === 0) return;
  familyProfiles = profiles;
  localStorage.setItem('storm_family_profiles', JSON.stringify(familyProfiles));

  // Фоновая отправка на сервер
  try {
    const token = getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
    fetch('/api/profiles/save', {
      method: 'POST',
      headers,
      body: JSON.stringify({ profiles: familyProfiles })
    }).catch(() => {});
  } catch {}
}

export function getActiveProfile() {
  return familyProfiles.find(p => p.id === activeProfileId) || familyProfiles[0] || DEFAULT_PROFILES[0];
}

export function isKidModeActive() {
  const p = getActiveProfile();
  return Boolean(p && p.isKid);
}

export function createFamilyProfile({ name, avatar, avatarBg, isKid = false, ageRating = '18+', hasPin = false, pin = '' }) {
  if (!name || !name.trim()) {
    showToast('Введите имя профиля', 'error');
    return null;
  }
  const newProfile = {
    id: `p_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    name: name.trim(),
    avatar: avatar || '🍿',
    avatarBg: avatarBg || 'linear-gradient(135deg, #00d2ff, #0072ff)',
    isKid: Boolean(isKid),
    ageRating: isKid ? (ageRating || '0+') : '18+',
    hasPin: Boolean(hasPin && pin && pin.length >= 4),
    pin: hasPin ? String(pin).trim() : '',
    isDefault: false
  };

  const updated = [...familyProfiles, newProfile];
  saveFamilyProfiles(updated);
  showToast(`Профиль «${newProfile.name}» создан`, 'success');
  return newProfile;
}

export function updateFamilyProfile(id, data) {
  const idx = familyProfiles.findIndex(p => p.id === id);
  if (idx === -1) return null;

  const current = familyProfiles[idx];
  const updatedProfile = {
    ...current,
    name: data.name ? data.name.trim() : current.name,
    avatar: data.avatar || current.avatar,
    avatarBg: data.avatarBg || current.avatarBg,
    isKid: data.isKid !== undefined ? Boolean(data.isKid) : current.isKid,
    ageRating: data.isKid ? (data.ageRating || '0+') : '18+',
    hasPin: data.hasPin !== undefined ? Boolean(data.hasPin) : current.hasPin,
    pin: data.pin !== undefined ? String(data.pin).trim() : current.pin
  };

  const updated = [...familyProfiles];
  updated[idx] = updatedProfile;
  saveFamilyProfiles(updated);
  showToast(`Профиль «${updatedProfile.name}» обновлен`, 'success');
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

  showToast(`Профиль «${target.name}» удален`, 'info');
  return true;
}

export function switchFamilyProfile(profileId, bypassPin = false) {
  const current = getActiveProfile();
  const target = familyProfiles.find(p => p.id === profileId);
  if (!target) return false;

  // Если уже на этом профиле
  if (current.id === target.id) {
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
  showToast(`Переключен профиль: ${target.name}`, 'success');
  updateAuthUI();
  notifyAuthChanged();

  // Плавная перезагрузка для обновления интерфейса и фильтрации каталога
  setTimeout(() => {
    window.location.reload();
  }, 300);
  return true;
}

function renderAvatarElement(p) {
  if (p.avatar && (p.avatar.startsWith('http') || p.avatar.startsWith('/') || p.avatar.startsWith('data:'))) {
    return `<img src="${p.avatar}" alt="${p.name}" class="family-profile-avatar-img">`;
  }
  return `<span>${p.avatar || '👑'}</span>`;
}

// -------------------------------------------------------------
// 1. МОДАЛЬНОЕ ОКНО «КТО СМОТРИТ?» (ВЫБОР ПРОФИЛЯ)
// -------------------------------------------------------------
export function openProfileSwitcherModal() {
  let modal = document.getElementById('family-profiles-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'storm-modal-backdrop';
    modal.id = 'family-profiles-modal';
    modal.innerHTML = `
      <div class="storm-modal" style="max-width: 680px; text-align: center;">
        <div class="storm-modal-header" style="justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 22px;">👥</span>
            <h3 class="storm-modal-title" style="margin: 0;">Кто смотрит?</h3>
          </div>
          <button type="button" class="storm-modal-close" id="close-profiles-modal-btn">✕</button>
        </div>
        <div class="storm-modal-body" id="family-profiles-modal-body" style="padding: 20px 24px;"></div>
        <div class="storm-modal-footer" style="display: flex; justify-content: space-between; align-items: center; padding: 14px 24px; border-top: 1px solid var(--border-subtle); background: var(--bg-tertiary);">
          <button type="button" class="storm-btn storm-btn-secondary" id="manage-profiles-mode-btn" style="font-size: 13px;">
            <span>⚙️</span> Управление профилями
          </button>
          <button type="button" class="storm-btn storm-btn-primary" id="add-new-profile-btn" style="font-size: 13px;">
            <span>+</span> Добавить профиль
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

  body.innerHTML = `
    <div class="family-profiles-grid">
      ${familyProfiles.map(p => `
        <div class="family-profile-card ${p.id === active.id ? 'is-active' : ''}" data-id="${p.id}">
          <div class="family-profile-avatar-box" style="background: ${p.avatarBg || 'linear-gradient(135deg, #00d2ff, #0072ff)'};">
            ${renderAvatarElement(p)}
          </div>
          <div class="family-profile-name" title="${p.name}">${p.name}</div>
          <div class="family-profile-meta">
            ${p.id === active.id ? '<span class="family-profile-badge active-badge">Активен</span>' : (p.isKid ? '<span class="family-profile-badge kid-badge">👶 Детский</span>' : (p.hasPin ? '<span class="family-profile-badge pin-badge">🔒 PIN</span>' : '<span>Полный доступ</span>'))}
          </div>
        </div>
      `).join('')}
    </div>
  `;

  // Клик по карточке профиля
  body.querySelectorAll('.family-profile-card').forEach(card => {
    card.onclick = () => {
      const pid = card.dataset.id;
      modal.classList.remove('is-open');
      switchFamilyProfile(pid);
    };
  });

  // Кнопка перехода в режим управления
  const manageBtn = modal.querySelector('#manage-profiles-mode-btn');
  if (manageBtn) {
    manageBtn.onclick = () => {
      modal.classList.remove('is-open');
      openProfileManagementModal();
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
  let modal = document.getElementById('family-profiles-manage-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'storm-modal-backdrop';
    modal.id = 'family-profiles-manage-modal';
    modal.innerHTML = `
      <div class="storm-modal" style="max-width: 680px; text-align: center;">
        <div class="storm-modal-header" style="justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 22px;">⚙️</span>
            <h3 class="storm-modal-title" style="margin: 0;">Управление семейными профилями</h3>
          </div>
          <button type="button" class="storm-modal-close" id="close-manage-profiles-btn">✕</button>
        </div>
        <div class="storm-modal-body" id="manage-profiles-modal-body" style="padding: 20px 24px;"></div>
        <div class="storm-modal-footer" style="display: flex; justify-content: space-between; align-items: center; padding: 14px 24px; border-top: 1px solid var(--border-subtle); background: var(--bg-tertiary);">
          <button type="button" class="storm-btn storm-btn-secondary" id="back-to-switcher-btn" style="font-size: 13px;">
            <span>←</span> Назад к выбору
          </button>
          <button type="button" class="storm-btn storm-btn-primary" id="manage-add-profile-btn" style="font-size: 13px;">
            <span>+</span> Добавить профиль
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

  body.innerHTML = `
    <p style="font-size: 13px; color: var(--text-secondary); margin-top: 0; margin-bottom: 16px;">
      Нажмите на карандаш ✏️ на карточке профиля, чтобы изменить имя, аватарку, пароль или родительский контроль.
    </p>
    <div class="family-profiles-grid">
      ${familyProfiles.map(p => `
        <div class="family-profile-card" data-id="${p.id}">
          <button type="button" class="family-profile-edit-btn" data-edit-id="${p.id}" title="Редактировать профиль">✏️</button>
          <div class="family-profile-avatar-box" style="background: ${p.avatarBg || 'linear-gradient(135deg, #00d2ff, #0072ff)'};">
            ${renderAvatarElement(p)}
          </div>
          <div class="family-profile-name" title="${p.name}">${p.name}</div>
          <div class="family-profile-meta">
            ${p.isKid ? '<span class="family-profile-badge kid-badge">👶 Детский</span>' : (p.hasPin ? '<span class="family-profile-badge pin-badge">🔒 PIN</span>' : '<span style="font-size:11px; color:var(--text-muted);">Нажмите ✏️</span>')}
          </div>
        </div>
      `).join('')}
    </div>
  `;

  // Клик по карточке или кнопке редактирования открывает редактор
  body.querySelectorAll('.family-profile-card').forEach(card => {
    card.onclick = (e) => {
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
  const profile = isEditing ? familyProfiles.find(p => p.id === profileId) : null;

  let selectedAvatar = profile ? profile.avatar : '👑';
  let selectedBg = profile ? profile.avatarBg : 'linear-gradient(135deg, #f59e0b, #d97706)';
  let isKidMode = profile ? Boolean(profile.isKid) : false;
  let ageRatingVal = profile ? (profile.ageRating || '18+') : '18+';
  let hasPinLock = profile ? Boolean(profile.hasPin) : false;
  let pinVal = profile ? (profile.pin || '') : '';

  let modal = document.getElementById('family-profile-editor-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'storm-modal-backdrop';
    modal.id = 'family-profile-editor-modal';
    modal.innerHTML = `
      <div class="storm-modal" style="max-width: 580px;">
        <div class="storm-modal-header" style="justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 22px;" id="editor-title-icon">✏️</span>
            <h3 class="storm-modal-title" id="editor-title-text">Редактирование профиля</h3>
          </div>
          <button type="button" class="storm-modal-close" id="close-profile-editor-btn">✕</button>
        </div>
        <div class="storm-modal-body" id="profile-editor-body" style="padding: 20px 24px; max-height: 72vh; overflow-y: auto;"></div>
        <div class="storm-modal-footer" id="profile-editor-footer" style="display: flex; justify-content: space-between; align-items: center; padding: 14px 24px; border-top: 1px solid var(--border-subtle); background: var(--bg-tertiary);"></div>
      </div>
    `;
    document.body.appendChild(modal);

    const closeBtn = modal.querySelector('#close-profile-editor-btn');
    if (closeBtn) {
      closeBtn.onclick = () => {
        modal.classList.remove('is-open');
        openProfileManagementModal();
      };
    }
    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.classList.remove('is-open');
        openProfileManagementModal();
      }
    };
  }

  modal.classList.add('is-open');
  const titleIcon = document.getElementById('editor-title-icon');
  const titleText = document.getElementById('editor-title-text');
  const body = document.getElementById('profile-editor-body');
  const footer = document.getElementById('profile-editor-footer');

  titleIcon.textContent = isEditing ? '✏️' : '✨';
  titleText.textContent = isEditing ? `Редактирование: ${profile.name}` : 'Создание нового профиля';

  body.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 20px;">
      <!-- Шапка аватара и имени -->
      <div style="display: flex; align-items: center; gap: 18px; padding-bottom: 16px; border-bottom: 1px solid var(--border-subtle);">
        <div id="editor-avatar-preview" class="family-profile-avatar-box" style="width: 80px; height: 80px; font-size: 38px; margin: 0; background: ${selectedBg};">
          ${renderAvatarElement({ avatar: selectedAvatar, name: '' })}
        </div>
        <div style="flex: 1;">
          <label style="display: block; font-size: 12px; font-weight: 700; color: #ffffff; margin-bottom: 6px;">Имя профиля</label>
          <input type="text" id="editor-profile-name-input" class="storm-input" value="${profile ? profile.name : ''}" placeholder="Например: Папа, Дети, Киноманы" maxlength="28" style="width: 100%; font-size: 14px; font-weight: 600; padding: 10px 14px; border-radius: 8px;">
        </div>
      </div>

      <!-- Выбор аватарки -->
      <div>
        <label style="display: block; font-size: 12.5px; font-weight: 700; color: #ffffff; margin-bottom: 4px;">Выбор аватарки (24 стиля экосистемы)</label>
        <div style="font-size: 11.5px; color: var(--text-muted); margin-bottom: 8px;">Нажмите на любую иконку для мгновенной смены аватара:</div>
        <div class="family-avatar-picker-grid" id="avatar-presets-container">
          ${FAMILY_AVATAR_PRESETS.map(preset => `
            <button type="button" class="avatar-preset-btn ${preset.icon === selectedAvatar ? 'selected' : ''}" data-icon="${preset.icon}" data-bg="${preset.bg}" title="${preset.label}" style="background: ${preset.bg};">
              ${preset.icon}
            </button>
          `).join('')}
        </div>
        <div style="margin-top: 10px; display: flex; gap: 8px; align-items: center;">
          <input type="text" id="editor-custom-avatar-input" class="storm-input" placeholder="Или введите свой эмодзи или URL картинки" style="flex: 1; font-size: 12px; padding: 7px 10px; border-radius: 8px;">
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="apply-custom-avatar-btn">Применить</button>
        </div>
      </div>

      <!-- Детский режим и родительский контроль -->
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

        <div id="editor-age-rating-box" style="margin-top: 12px; display: ${isKidMode ? 'block' : 'none'}; padding-left: 34px;">
          <label style="font-size: 12px; font-weight: 700; color: var(--accent); margin-right: 8px;">Возрастной ценз:</label>
          <select id="editor-age-rating-select" class="storm-select" style="font-size: 12px; padding: 4px 10px; border-radius: 6px;">
            <option value="0+" ${ageRatingVal === '0+' ? 'selected' : ''}>0+ (Только для малышей и сказки)</option>
            <option value="6+" ${ageRatingVal === '6+' ? 'selected' : ''}>6+ (Для всей семьи и детские мультфильмы)</option>
            <option value="12+" ${ageRatingVal === '12+' ? 'selected' : ''}>12+ (Подростковый безопасный контент)</option>
            <option value="16+" ${ageRatingVal === '16+' ? 'selected' : ''}>16+ (Без взрослого контента 18+)</option>
          </select>
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
              Защищает профиль от входа другими членами семьи без ввода кода.
            </div>
          </div>
        </div>

        <div id="editor-pin-input-box" style="margin-top: 12px; display: ${hasPinLock ? 'flex' : 'none'}; align-items: center; gap: 10px; padding-left: 34px;">
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

  const nameInput = document.getElementById('editor-profile-name-input');
  const avatarPreview = document.getElementById('editor-avatar-preview');
  const presetsContainer = document.getElementById('avatar-presets-container');
  const customAvatarInput = document.getElementById('editor-custom-avatar-input');
  const applyCustomBtn = document.getElementById('apply-custom-avatar-btn');
  const kidToggle = document.getElementById('editor-kid-toggle');
  const ageRatingBox = document.getElementById('editor-age-rating-box');
  const ageRatingSelect = document.getElementById('editor-age-rating-select');
  const pinToggle = document.getElementById('editor-pin-toggle');
  const pinInputBox = document.getElementById('editor-pin-input-box');
  const pinCodeInput = document.getElementById('editor-pin-code-input');
  const pinVisBtn = document.getElementById('toggle-pin-visibility-btn');
  const cancelBtn = document.getElementById('cancel-profile-editor-btn');
  const saveBtn = document.getElementById('save-profile-editor-btn');
  const deleteBtn = document.getElementById('delete-current-profile-btn');

  // Выбор пресета аватара
  presetsContainer.querySelectorAll('.avatar-preset-btn').forEach(btn => {
    btn.onclick = () => {
      presetsContainer.querySelectorAll('.avatar-preset-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedAvatar = btn.dataset.icon;
      selectedBg = btn.dataset.bg;
      avatarPreview.style.background = selectedBg;
      avatarPreview.innerHTML = renderAvatarElement({ avatar: selectedAvatar, name: '' });
    };
  });

  // Пользовательский аватар (эмодзи или URL)
  applyCustomBtn.onclick = () => {
    const val = customAvatarInput.value.trim();
    if (val) {
      selectedAvatar = val;
      avatarPreview.innerHTML = renderAvatarElement({ avatar: selectedAvatar, name: '' });
      showToast('Аватар обновлен', 'info');
    }
  };

  // Переключение детского режима
  kidToggle.onclick = () => {
    isKidMode = !isKidMode;
    kidToggle.classList.toggle('checked', isKidMode);
    ageRatingBox.style.display = isKidMode ? 'block' : 'none';
  };

  // Переключение защиты PIN
  pinToggle.onclick = () => {
    hasPinLock = !hasPinLock;
    pinToggle.classList.toggle('checked', hasPinLock);
    pinInputBox.style.display = hasPinLock ? 'flex' : 'none';
    if (hasPinLock && (!pinCodeInput.value || pinCodeInput.value.length < 4)) {
      pinCodeInput.value = '0000';
    }
  };

  // Показать/скрыть PIN
  pinVisBtn.onclick = () => {
    const isPass = pinCodeInput.type === 'password';
    pinCodeInput.type = isPass ? 'text' : 'password';
    pinVisBtn.textContent = isPass ? 'Скрыть' : 'Показать';
  };

  // Отмена
  cancelBtn.onclick = () => {
    modal.classList.remove('is-open');
    openProfileManagementModal();
  };

  // Удаление профиля
  if (deleteBtn) {
    deleteBtn.onclick = () => {
      if (confirm(`Вы действительно хотите удалить профиль «${profile.name}»?`)) {
        deleteFamilyProfile(profile.id);
        modal.classList.remove('is-open');
        openProfileManagementModal();
      }
    };
  }

  // Сохранение
  saveBtn.onclick = () => {
    const name = nameInput.value.trim();
    if (!name) {
      showToast('Пожалуйста, укажите имя профиля', 'error');
      nameInput.focus();
      return;
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
      avatar: selectedAvatar,
      avatarBg: selectedBg,
      isKid: isKidMode,
      ageRating: isKidMode ? ageRatingSelect.value : '18+',
      hasPin: hasPinLock,
      pin: hasPinLock ? pinCodeInput.value.trim() : ''
    };

    if (isEditing) {
      updateFamilyProfile(profile.id, payload);
    } else {
      createFamilyProfile(payload);
    }

    modal.classList.remove('is-open');
    openProfileManagementModal();
  };
}

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
