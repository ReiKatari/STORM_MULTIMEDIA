/* ==========================================================================
   STORM MULTIMEDIA - СИСТЕМА ДОСТИЖЕНИЙ (STORM ACHIEVEMENTS)
   Каталог из 42 уникальных наград, кибер-тосты и трекер прогресса
   ========================================================================== */

import { getUser } from './auth.js';

let cachedAchievements = [];

// Звуковой эффект получения достижения через Web Audio API
function playAchievementSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(523.25, now); // C5
    osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.1); // E5
    osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.2); // G5
    osc.frequency.exponentialRampToValueAtTime(1046.50, now + 0.35); // C6

    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.6);
  } catch {
    // Игнорируем ограничения автовоспроизведения звука
  }
}

export const DEFAULT_ACHIEVEMENTS = [
  // 1. Киномарафон (Фильмы и сериалы)
  { id: 'cinema_first', title: 'Первый сеанс', desc: 'Посмотреть 1 фильм или серию', category: 'cinema', rarity: 'bronze', icon: '🎬', target: 1, progress: 0, unlocked: false },
  { id: 'cinema_novice', title: 'Кинолюбитель', desc: 'Посмотреть 5 тайтлов', category: 'cinema', rarity: 'bronze', icon: '🍿', target: 5, progress: 0, unlocked: false },
  { id: 'cinema_veteran', title: 'Киноман', desc: 'Посмотреть 15 тайтлов', category: 'cinema', rarity: 'silver', icon: '🎟️', target: 15, progress: 0, unlocked: false },
  { id: 'cinema_master', title: 'Синефил со стажем', desc: 'Посмотреть 30 тайтлов', category: 'cinema', rarity: 'gold', icon: '📽️', target: 30, progress: 0, unlocked: false },
  { id: 'cinema_legend', title: 'Архивариус кинематографа', desc: 'Посмотреть 60 тайтлов', category: 'cinema', rarity: 'platinum', icon: '🏆', target: 60, progress: 0, unlocked: false },
  { id: 'cinema_god', title: 'Владыка киноэкрана', desc: 'Посмотреть 100 тайтлов', category: 'cinema', rarity: 'cyber', icon: '👑', target: 100, progress: 0, unlocked: false },

  // 2. Отаку и аниме-культура
  { id: 'anime_first', title: 'Первый кохай', desc: 'Посмотреть 1 аниме', category: 'anime', rarity: 'bronze', icon: '⛩️', target: 1, progress: 0, unlocked: false },
  { id: 'anime_genin', title: 'Путь шиноби', desc: 'Посмотреть 5 аниме-релизов', category: 'anime', rarity: 'bronze', icon: '🍙', target: 5, progress: 0, unlocked: false },
  { id: 'anime_chunin', title: 'Опытный отаку', desc: 'Посмотреть 15 аниме-релизов', category: 'anime', rarity: 'silver', icon: '🌸', target: 15, progress: 0, unlocked: false },
  { id: 'anime_jonin', title: 'Мастер ниндзюцу', desc: 'Посмотреть 30 аниме-релизов', category: 'anime', rarity: 'gold', icon: '⚡', target: 30, progress: 0, unlocked: false },
  { id: 'anime_hokage', title: 'Легендарный хокаге', desc: 'Посмотреть 50 аниме-релизов', category: 'anime', rarity: 'platinum', icon: '🔥', target: 50, progress: 0, unlocked: false },
  { id: 'anime_kami', title: 'Аниме-божество', desc: 'Посмотреть 100 аниме-релизов', category: 'anime', rarity: 'cyber', icon: '✨', target: 100, progress: 0, unlocked: false },

  // 3. Хранитель времени
  { id: 'time_1h', title: 'Первый час в Шторме', desc: 'Провести 1 час за просмотром', category: 'time', rarity: 'bronze', icon: '⏱️', target: 1, progress: 0, unlocked: false },
  { id: 'time_5h', title: 'Погружение в поток', desc: 'Провести 5 часов за просмотром', category: 'time', rarity: 'bronze', icon: '⌛', target: 5, progress: 0, unlocked: false },
  { id: 'time_20h', title: 'Ночной марафонец', desc: 'Провести 20 часов за просмотром', category: 'time', rarity: 'silver', icon: '🌙', target: 20, progress: 0, unlocked: false },
  { id: 'time_50h', title: 'Неутомимый зритель', desc: 'Провести 50 часов за просмотром', category: 'time', rarity: 'gold', icon: '🌟', target: 50, progress: 0, unlocked: false },
  { id: 'time_100h', title: 'Повелитель хроноса', desc: 'Провести 100 часов за просмотром', category: 'time', rarity: 'platinum', icon: '🌌', target: 100, progress: 0, unlocked: false },
  { id: 'time_250h', title: 'Вечный житель кибервселенной', desc: 'Провести 250 часов за просмотром', category: 'time', rarity: 'cyber', icon: '🪐', target: 250, progress: 0, unlocked: false },

  // 4. Кинокритика и сообщество
  { id: 'review_first', title: 'Первое мнение', desc: 'Оставить свой первый отзыв', category: 'social', rarity: 'bronze', icon: '✍️', target: 1, progress: 0, unlocked: false },
  { id: 'review_3', title: 'Внимательный критик', desc: 'Оставить 3 рецензии', category: 'social', rarity: 'silver', icon: '📝', target: 3, progress: 0, unlocked: false },
  { id: 'review_10', title: 'Золотое перо Шторма', desc: 'Оставить 10 развернутых рецензий', category: 'social', rarity: 'gold', icon: '✒️', target: 10, progress: 0, unlocked: false },
  { id: 'review_liked', title: 'Голос народа', desc: 'Получить первый лайк на свой отзыв', category: 'social', rarity: 'bronze', icon: '👍', target: 1, progress: 0, unlocked: false },
  { id: 'review_popular', title: 'Признание зала', desc: 'Собрать 5 лайков на рецензиях', category: 'social', rarity: 'gold', icon: '💖', target: 5, progress: 0, unlocked: false },
  { id: 'room_host', title: 'Капитан кинозала', desc: 'Создать комнату совместного просмотра', category: 'social', rarity: 'silver', icon: '👥', target: 1, progress: 0, unlocked: false },
  { id: 'room_guest', title: 'Кино-компания', desc: 'Присоединиться к кинокомнате', category: 'social', rarity: 'bronze', icon: '🤝', target: 1, progress: 0, unlocked: false },
  { id: 'sync_master', title: 'Синхронизатор данных', desc: 'Синхронизировать или экспортировать библиотеку', category: 'social', rarity: 'silver', icon: '🔄', target: 1, progress: 0, unlocked: false },

  // 5. Коллекционер и архивариус
  { id: 'bookmark_first', title: 'Первая закладка', desc: 'Добавить релиз в закладки', category: 'collection', rarity: 'bronze', icon: '🔖', target: 1, progress: 0, unlocked: false },
  { id: 'bookmark_20', title: 'Личная фильмотека', desc: 'Собрать 20 релизов в закладках', category: 'collection', rarity: 'silver', icon: '📁', target: 20, progress: 0, unlocked: false },
  { id: 'bookmark_50', title: 'Великая коллекция', desc: 'Собрать 50 релизов в закладках', category: 'collection', rarity: 'gold', icon: '🏛️', target: 50, progress: 0, unlocked: false },
  { id: 'list_first', title: 'Куратор списков', desc: 'Создать пользовательский список', category: 'collection', rarity: 'bronze', icon: '📋', target: 1, progress: 0, unlocked: false },
  { id: 'list_pro', title: 'Архитектор коллекций', desc: 'Создать 3 тематических списка', category: 'collection', rarity: 'gold', icon: '📚', target: 3, progress: 0, unlocked: false },

  // 6. Кибер-технологии и секреты
  { id: 'tech_4k', title: 'Ценитель 4K Ultra HD', desc: 'Запустить фильм в оригинальном качестве 4K', category: 'tech', rarity: 'bronze', icon: '💎', target: 1, progress: 0, unlocked: false },
  { id: 'tech_torrent', title: 'P2P-пионер', desc: 'Запустить стриминг через WebTorrent', category: 'tech', rarity: 'silver', icon: '🧲', target: 1, progress: 0, unlocked: false },
  { id: 'tech_night', title: 'Ночной охотник', desc: 'Смотреть кино ночью между 02:00 и 05:00', category: 'tech', rarity: 'silver', icon: '🦉', target: 1, progress: 0, unlocked: false },
  { id: 'tech_chameleon', title: 'Хамелеон киберпространства', desc: 'Опробовать все 8 тем оформления', category: 'tech', rarity: 'gold', icon: '🎨', target: 8, progress: 0, unlocked: false },
  { id: 'tech_polyglot', title: 'Полиглот Шторма', desc: 'Переключить 3 языка интерфейса', category: 'tech', rarity: 'silver', icon: '🌐', target: 3, progress: 0, unlocked: false },
  { id: 'tech_voice', title: 'Кибер-голос', desc: 'Использовать голосового ассистента', category: 'tech', rarity: 'bronze', icon: '🎙️', target: 1, progress: 0, unlocked: false },
  { id: 'tech_gamepad', title: 'Штурман геймпада', desc: 'Использовать геймпад или ТВ-режим', category: 'tech', rarity: 'silver', icon: '🎮', target: 1, progress: 0, unlocked: false },
  { id: 'tech_subtitles', title: 'Свои титры', desc: 'Загрузить внешние субтитры или дорожку', category: 'tech', rarity: 'bronze', icon: '💬', target: 1, progress: 0, unlocked: false },
  { id: 'tech_ambilight', title: 'Неоновая аура', desc: 'Включить динамический Ambilight эффект', category: 'tech', rarity: 'bronze', icon: '🌈', target: 1, progress: 0, unlocked: false },
  { id: 'tech_skip', title: 'Мастер таймкодов', desc: 'Пропустить интро или титры по кнопке', category: 'tech', rarity: 'bronze', icon: '⏭️', target: 1, progress: 0, unlocked: false },
  { id: 'tech_pip', title: 'Картинка в картинке', desc: 'Воспроизвести видео в режиме PiP', category: 'tech', rarity: 'bronze', icon: '🖼️', target: 1, progress: 0, unlocked: false },
  { id: 'tech_pwa', title: 'Всегда со мной', desc: 'Установить веб-приложение на устройство', category: 'tech', rarity: 'gold', icon: '📲', target: 1, progress: 0, unlocked: false }
];

export async function fetchUserAchievements() {
  if (cachedAchievements && cachedAchievements.length > 0) {
    return cachedAchievements;
  }
  try {
    const token = localStorage.getItem('storm_token');
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const res = await fetch('/api/achievements', { headers, signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        cachedAchievements = data;
        return cachedAchievements;
      }
    }
  } catch (err) {
    console.warn('Сервер достижений не ответил вовремя, загружаем локальный каталог:', err);
  }

  cachedAchievements = DEFAULT_ACHIEVEMENTS;
  return cachedAchievements;
}

export async function trackClientAction(action, meta = {}) {
  if (!getUser()) return;
  try {
    const res = await fetch('/api/achievements/track', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('storm_token') || ''}`
      },
      body: JSON.stringify({ action, meta })
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.unlocked && data.unlocked.length > 0) {
      data.unlocked.forEach(ach => {
        showAchievementToast(ach);
      });
    }
  } catch (err) {
    console.error('Ошибка трекера достижений:', err);
  }
}

export function showAchievementToast(achievement) {
  playAchievementSound();

  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `storm-toast achievement-toast rarity-${achievement.rarity || 'bronze'}`;

  const rarityTitles = {
    bronze: 'Бронзовая награда',
    silver: 'Серебряная награда',
    gold: 'Золотая награда',
    platinum: 'Платиновая награда',
    cyber: 'Кибер-элита'
  };

  toast.innerHTML = `
    <div class="achievement-toast-icon">${achievement.icon || '🏆'}</div>
    <div class="achievement-toast-content">
      <div class="achievement-toast-badge">${rarityTitles[achievement.rarity] || 'Достижение'}</div>
      <h4 class="achievement-toast-title">${achievement.title}</h4>
      <p class="achievement-toast-desc">${achievement.desc}</p>
    </div>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('is-leaving');
    setTimeout(() => toast.remove(), 400);
  }, 5000);
}

export async function renderProfileAchievements(containerElement, filterCategory = 'all') {
  if (!containerElement) return;

  // Если уже в кэше — отрисовываем мгновенно без надписи ожидания
  if (!cachedAchievements || cachedAchievements.length === 0) {
    containerElement.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:24px;">Загрузка списка достижений...</div>';
  }

  const achievements = await fetchUserAchievements();
  if (!achievements || achievements.length === 0) {
    containerElement.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:24px;">Каталог достижений формируется...</div>';
    return;
  }

  const unlockedCount = achievements.filter(a => a.unlocked).length;
  const totalCount = achievements.length;
  const percentTotal = Math.round((unlockedCount / totalCount) * 100);

  const categories = [
    { id: 'all', label: 'Все' },
    { id: 'cinema', label: 'Кино' },
    { id: 'anime', label: 'Отаку' },
    { id: 'time', label: 'Время' },
    { id: 'social', label: 'Социум' },
    { id: 'collection', label: 'Коллекция' },
    { id: 'tech', label: 'Кибер-секреты' }
  ];

  const filtered = filterCategory === 'all'
    ? achievements
    : achievements.filter(a => a.category === filterCategory);

  containerElement.innerHTML = `
    <!-- Прогресс достижений -->
    <div class="achievements-summary-card">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <span style="font-weight: 800; font-size: 15px;">Прогресс достижений:</span>
        <span style="font-weight: 800; color: var(--accent); font-size: 15px;">${unlockedCount} из ${totalCount} (${percentTotal}%)</span>
      </div>
      <div class="achievements-progress-bar">
        <div class="achievements-progress-fill" style="width: ${percentTotal}%;"></div>
      </div>
    </div>

    <!-- Фильтр по категориям -->
    <div class="achievements-category-pills" id="achievements-category-pills">
      ${categories.map(c => `
        <button class="ach-category-pill ${c.id === filterCategory ? 'active' : ''}" data-cat="${c.id}">${c.label}</button>
      `).join('')}
    </div>

    <!-- Сетка карточек достижений -->
    <div class="achievements-grid">
      ${filtered.map(ach => {
        const isUnlocked = ach.unlocked;
        const progress = ach.progress || 0;
        const target = ach.target || 1;
        const percent = Math.min(100, Math.round((progress / target) * 100));

        return `
          <div class="achievement-card ${isUnlocked ? 'unlocked' : 'locked'} rarity-${ach.rarity}">
            <div class="achievement-card-icon">${ach.icon}</div>
            <div class="achievement-card-info">
              <div class="achievement-card-header">
                <span class="achievement-card-title">${ach.title}</span>
                <span class="achievement-card-status">${isUnlocked ? '✓ Открыто' : `${progress}/${target}`}</span>
              </div>
              <p class="achievement-card-desc">${ach.desc}</p>
              ${!isUnlocked ? `
                <div class="achievement-item-bar">
                  <div class="achievement-item-fill" style="width: ${percent}%;"></div>
                </div>
              ` : ''}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  // Навешиваем обработчики фильтра категорий
  containerElement.querySelectorAll('.ach-category-pill').forEach(btn => {
    btn.onclick = () => {
      renderProfileAchievements(containerElement, btn.dataset.cat);
    };
  });
}
