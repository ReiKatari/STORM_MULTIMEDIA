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

export function openProfileModal() {
  if (!currentUser) return;
  const modal = document.getElementById('profile-modal');
  if (!modal) return;

  document.getElementById('profile-avatar').src = currentUser.avatar;
  document.getElementById('profile-username').textContent = currentUser.username;
  document.getElementById('profile-email').textContent = currentUser.email;
  document.getElementById('profile-date').textContent = formatDate(currentUser.created_at);

  const stats = currentUser.stats || {};
  document.getElementById('profile-stat-hours').textContent = stats.totalWatchedHours || 0;
  document.getElementById('profile-stat-bookmarks').textContent = stats.bookmarksCount || 0;
  document.getElementById('profile-stat-completed').textContent = stats.completedCount || 0;
  document.getElementById('profile-stat-watching').textContent = stats.watchingCount || 0;
  document.getElementById('profile-stat-lists').textContent = stats.customListsCount || 0;

  modal.classList.add('is-open');
}
