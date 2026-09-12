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
  const avatarImg = document.getElementById('user-avatar-img');
  const userNameSpan = document.getElementById('user-name-label');

  if (currentUser) {
    if (loginBtn) loginBtn.style.display = 'none';
    if (profileBtn) profileBtn.style.display = 'flex';
    if (avatarImg) avatarImg.src = currentUser.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(currentUser.username)}`;
    if (userNameSpan) userNameSpan.textContent = currentUser.username;
  } else {
    if (loginBtn) loginBtn.style.display = 'inline-flex';
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
  if (!currentToken) throw new Error('Требуется авторизация');

  const res = await fetch('/api/auth/profile/update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${currentToken}`
    },
    body: JSON.stringify({ username, email, avatar })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка при обновлении профиля');
  }

  currentUser = { ...currentUser, ...data.user };
  updateAuthUI();
  notifyAuthChanged();
  showToast('Профиль успешно обновлен!', 'success');
  return currentUser;
}

export async function changePassword(oldPassword, newPassword) {
  if (!currentToken) throw new Error('Требуется авторизация');

  const res = await fetch('/api/auth/profile/password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${currentToken}`
    },
    body: JSON.stringify({ oldPassword, newPassword })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка при смене пароля');
  }

  showToast('Пароль успешно изменен!', 'success');
  return true;
}

export function openProfileModal() {
  if (!currentUser) return;
  const modal = document.getElementById('profile-modal');
  if (!modal) return;

  const currentAvatar = currentUser.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(currentUser.username)}`;
  const avatarEl = document.getElementById('profile-avatar');
  if (avatarEl) avatarEl.src = currentAvatar;

  const userEl = document.getElementById('profile-username');
  if (userEl) userEl.textContent = currentUser.username;

  const emailEl = document.getElementById('profile-email');
  if (emailEl) emailEl.textContent = currentUser.email;

  const dateEl = document.getElementById('profile-date');
  if (dateEl) dateEl.textContent = formatDate(currentUser.created_at);

  const stats = currentUser.stats || {};
  const elHours = document.getElementById('profile-stat-hours');
  if (elHours) elHours.textContent = stats.totalWatchedHours || 0;

  const elBook = document.getElementById('profile-stat-bookmarks');
  if (elBook) elBook.textContent = stats.bookmarksCount || 0;

  const elComp = document.getElementById('profile-stat-completed');
  if (elComp) elComp.textContent = stats.completedCount || 0;

  const elWatch = document.getElementById('profile-stat-watching');
  if (elWatch) elWatch.textContent = stats.watchingCount || 0;

  const elLists = document.getElementById('profile-stat-lists');
  if (elLists) elLists.textContent = stats.customListsCount || 0;

  const elFav = document.getElementById('profile-stat-favorites');
  if (elFav) elFav.textContent = stats.favoritesCount || 0;

  // Заполняем форму редактирования профиля
  const inputUser = document.getElementById('edit-profile-username');
  if (inputUser) inputUser.value = currentUser.username;

  const inputEmail = document.getElementById('edit-profile-email');
  if (inputEmail) inputEmail.value = currentUser.email;

  const inputAvatar = document.getElementById('edit-avatar-url');
  if (inputAvatar) inputAvatar.value = currentUser.avatar || '';

  // Рендерим пресеты аватарок
  renderAvatarPresets(currentUser.avatar);

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
