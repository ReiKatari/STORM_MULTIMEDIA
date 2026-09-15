/* ==========================================================================
   STORM MULTIMEDIA - СИСТЕМА ДОСТИЖЕНИЙ (STORM ACHIEVEMENTS)
   Каталог из 67 уникальных наград, кибер-тосты и трекер прогресса
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
  { id: 'series_first_ep', title: 'Сериальный старт', desc: 'Посмотреть 1 серию любого сериала', category: 'cinema', rarity: 'bronze', icon: '📺', target: 1, progress: 0, unlocked: false },
  { id: 'series_binge_5', title: 'Сериальный марафон', desc: 'Посмотреть 5 серий сериалов', category: 'cinema', rarity: 'silver', icon: '🛋️', target: 5, progress: 0, unlocked: false },
  { id: 'series_binge_25', title: 'Сериаломан', desc: 'Посмотреть 25 серий сериалов', category: 'cinema', rarity: 'gold', icon: '🍿', target: 25, progress: 0, unlocked: false },
  { id: 'series_season_done', title: 'Завершённый сезон', desc: 'Полностью посмотреть сезон сериала', category: 'cinema', rarity: 'gold', icon: '🏁', target: 1, progress: 0, unlocked: false },
  { id: 'series_three_seasons', title: 'Повелитель сезонов', desc: 'Полностью посмотреть 3 сезона сериалов', category: 'cinema', rarity: 'platinum', icon: '👑', target: 3, progress: 0, unlocked: false },

  // 2. Отаку и аниме-культура
  { id: 'anime_first', title: 'Первый кохай', desc: 'Посмотреть 1 аниме', category: 'anime', rarity: 'bronze', icon: '⛩️', target: 1, progress: 0, unlocked: false },
  { id: 'anime_genin', title: 'Путь шиноби', desc: 'Посмотреть 5 аниме-релизов', category: 'anime', rarity: 'bronze', icon: '🍙', target: 5, progress: 0, unlocked: false },
  { id: 'anime_chunin', title: 'Опытный отаку', desc: 'Посмотреть 15 аниме-релизов', category: 'anime', rarity: 'silver', icon: '🌸', target: 15, progress: 0, unlocked: false },
  { id: 'anime_jonin', title: 'Мастер ниндзюцу', desc: 'Посмотреть 30 аниме-релизов', category: 'anime', rarity: 'gold', icon: '⚡', target: 30, progress: 0, unlocked: false },
  { id: 'anime_hokage', title: 'Легендарный хокаге', desc: 'Посмотреть 50 аниме-релизов', category: 'anime', rarity: 'platinum', icon: '🔥', target: 50, progress: 0, unlocked: false },
  { id: 'anime_kami', title: 'Аниме-божество', desc: 'Посмотреть 100 аниме-релизов', category: 'anime', rarity: 'cyber', icon: '✨', target: 100, progress: 0, unlocked: false },
  { id: 'anime_anilibria', title: 'Голос Анилибрии', desc: 'Посмотреть аниме в озвучке AniLibria', category: 'anime', rarity: 'bronze', icon: '🎙️', target: 1, progress: 0, unlocked: false },
  { id: 'anime_season_pass', title: 'Онгоинг-мастер', desc: 'Посмотреть 12 серий аниме', category: 'anime', rarity: 'silver', icon: '⚡', target: 12, progress: 0, unlocked: false },

  // 3. Жанровые эксперты
  { id: 'genre_scifi', title: 'В глубинах космоса', desc: 'Посмотреть фантастику или научпоп', category: 'genres', rarity: 'bronze', icon: '🚀', target: 1, progress: 0, unlocked: false },
  { id: 'genre_action', title: 'Адреналиновый шквал', desc: 'Посмотреть боевик или остросюжетный триллер', category: 'genres', rarity: 'bronze', icon: '💥', target: 1, progress: 0, unlocked: false },
  { id: 'genre_comedy', title: 'Искренний смех', desc: 'Посмотреть комедию или ситком', category: 'genres', rarity: 'bronze', icon: '😄', target: 1, progress: 0, unlocked: false },
  { id: 'genre_horror', title: 'Стальные нервы', desc: 'Посмотреть хоррор или фильм ужасов', category: 'genres', rarity: 'silver', icon: '👻', target: 1, progress: 0, unlocked: false },
  { id: 'genre_drama', title: 'Глубокие эмоции', desc: 'Посмотреть драматическую картину', category: 'genres', rarity: 'bronze', icon: '🎭', target: 1, progress: 0, unlocked: false },
  { id: 'genre_detective', title: 'Шерлок Холмс', desc: 'Посмотреть детектив или расследование', category: 'genres', rarity: 'silver', icon: '🔍', target: 1, progress: 0, unlocked: false },

  // 4. Хранитель времени
  { id: 'time_1h', title: 'Первый час в Шторме', desc: 'Провести 1 час за просмотром', category: 'time', rarity: 'bronze', icon: '⏱️', target: 1, progress: 0, unlocked: false },
  { id: 'time_5h', title: 'Погружение в поток', desc: 'Провести 5 часов за просмотром', category: 'time', rarity: 'bronze', icon: '⌛', target: 5, progress: 0, unlocked: false },
  { id: 'time_20h', title: 'Ночной марафонец', desc: 'Провести 20 часов за просмотром', category: 'time', rarity: 'silver', icon: '🌙', target: 20, progress: 0, unlocked: false },
  { id: 'time_50h', title: 'Неутомимый зритель', desc: 'Провести 50 часов за просмотром', category: 'time', rarity: 'gold', icon: '🌟', target: 50, progress: 0, unlocked: false },
  { id: 'time_100h', title: 'Повелитель хроноса', desc: 'Провести 100 часов за просмотром', category: 'time', rarity: 'platinum', icon: '🌌', target: 100, progress: 0, unlocked: false },
  { id: 'time_250h', title: 'Вечный житель кибервселенной', desc: 'Провести 250 часов за просмотром', category: 'time', rarity: 'cyber', icon: '🪐', target: 250, progress: 0, unlocked: false },
  { id: 'time_500h', title: 'Хранитель вечности', desc: 'Провести 500 часов за просмотром', category: 'time', rarity: 'cyber', icon: '⏳', target: 500, progress: 0, unlocked: false },

  // 5. Кинокритика и сообщество
  { id: 'review_first', title: 'Первое мнение', desc: 'Оставить свой первый отзыв', category: 'social', rarity: 'bronze', icon: '✍️', target: 1, progress: 0, unlocked: false },
  { id: 'review_3', title: 'Внимательный критик', desc: 'Оставить 3 рецензии', category: 'social', rarity: 'silver', icon: '📝', target: 3, progress: 0, unlocked: false },
  { id: 'review_10', title: 'Золотое перо Шторма', desc: 'Оставить 10 развернутых рецензий', category: 'social', rarity: 'gold', icon: '✒️', target: 10, progress: 0, unlocked: false },
  { id: 'review_liked', title: 'Голос народа', desc: 'Получить первый лайк на свой отзыв', category: 'social', rarity: 'bronze', icon: '👍', target: 1, progress: 0, unlocked: false },
  { id: 'review_popular', title: 'Признание зала', desc: 'Собрать 5 лайков на рецензиях', category: 'social', rarity: 'gold', icon: '💖', target: 5, progress: 0, unlocked: false },
  { id: 'review_rating', title: 'Строгий цензор', desc: 'Поставить 5 личных оценок релизам', category: 'social', rarity: 'silver', icon: '⭐', target: 5, progress: 0, unlocked: false },
  { id: 'room_host', title: 'Капитан кинозала', desc: 'Создать комнату совместного просмотра', category: 'social', rarity: 'silver', icon: '👥', target: 1, progress: 0, unlocked: false },
  { id: 'room_guest', title: 'Кино-компания', desc: 'Присоединиться к кинокомнате', category: 'social', rarity: 'bronze', icon: '🤝', target: 1, progress: 0, unlocked: false },
  { id: 'sync_master', title: 'Синхронизатор данных', desc: 'Синхронизировать или экспортировать библиотеку', category: 'social', rarity: 'silver', icon: '🔄', target: 1, progress: 0, unlocked: false },

  // 6. Коллекционер и архивариус
  { id: 'bookmark_first', title: 'Первая закладка', desc: 'Добавить релиз в закладки', category: 'collection', rarity: 'bronze', icon: '🔖', target: 1, progress: 0, unlocked: false },
  { id: 'bookmark_20', title: 'Личная фильмотека', desc: 'Собрать 20 релизов в закладках', category: 'collection', rarity: 'silver', icon: '📁', target: 20, progress: 0, unlocked: false },
  { id: 'bookmark_50', title: 'Великая коллекция', desc: 'Собрать 50 релизов в закладках', category: 'collection', rarity: 'gold', icon: '🏛️', target: 50, progress: 0, unlocked: false },
  { id: 'bookmark_100', title: 'Золотой фонд', desc: 'Собрать 100 релизов в закладках', category: 'collection', rarity: 'platinum', icon: '💎', target: 100, progress: 0, unlocked: false },
  { id: 'status_watching', title: 'В процессе', desc: 'Добавить 3 релиза в статус «Смотрю»', category: 'collection', rarity: 'bronze', icon: '👀', target: 3, progress: 0, unlocked: false },
  { id: 'status_completed', title: 'Досмотрено до конца', desc: 'Отметить 5 релизов статусом «Просмотрено»', category: 'collection', rarity: 'silver', icon: '✅', target: 5, progress: 0, unlocked: false },
  { id: 'status_planned', title: 'Большие планы', desc: 'Добавить 5 релизов в «Запланировано»', category: 'collection', rarity: 'bronze', icon: '📅', target: 5, progress: 0, unlocked: false },
  { id: 'list_first', title: 'Куратор списков', desc: 'Создать пользовательский список', category: 'collection', rarity: 'bronze', icon: '📋', target: 1, progress: 0, unlocked: false },
  { id: 'list_pro', title: 'Архитектор коллекций', desc: 'Создать 3 тематических списка', category: 'collection', rarity: 'gold', icon: '📚', target: 3, progress: 0, unlocked: false },

  // 7. Кибер-технологии и инновации
  { id: 'tech_4k', title: 'Ценитель 4K Ultra HD', desc: 'Запустить фильм или серию в качестве 4K Ultra HD', category: 'tech', rarity: 'bronze', icon: '💎', target: 1, progress: 0, unlocked: false },
  { id: 'tech_4k_ultra', title: 'Абсолютный ультра-четкий', desc: 'Посмотреть 5 релизов в качестве 4K Ultra HD', category: 'tech', rarity: 'gold', icon: '🔮', target: 5, progress: 0, unlocked: false },
  { id: 'tech_audio_pro', title: 'Аудиофил', desc: 'Включить профессиональный эквалайзер или объемный звук', category: 'tech', rarity: 'silver', icon: '🎧', target: 1, progress: 0, unlocked: false },
  { id: 'tech_video_pro', title: 'Мастер калибровки', desc: 'Настроить профессиональное видео (HDR, резкость или контраст)', category: 'tech', rarity: 'silver', icon: '🎛️', target: 1, progress: 0, unlocked: false },
  { id: 'tech_voiceover_fan', title: 'Голосовой гурман', desc: 'Переключить 3 разные студийные озвучки', category: 'tech', rarity: 'bronze', icon: '📻', target: 3, progress: 0, unlocked: false },
  { id: 'tech_xray', title: 'Рентгеновское зрение', desc: 'Изучить актерский состав через X-Ray', category: 'tech', rarity: 'bronze', icon: '👁️', target: 1, progress: 0, unlocked: false },
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

function formatAchievementDate(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${day}.${month}.${year} ${hours}:${mins}`;
}

export async function claimAchievementReward(achievementId, containerElement = null, currentCat = 'all') {
  if (!getUser() || !achievementId) return;
  try {
    const res = await fetch('/api/achievements/claim', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('storm_token') || ''}`
      },
      body: JSON.stringify({ achievement_id: achievementId })
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.success && data.achievement) {
      showAchievementToast(data.achievement);
      cachedAchievements = [];
      if (containerElement) {
        renderProfileAchievements(containerElement, currentCat);
      }
    }
  } catch (err) {
    console.error('Ошибка получения награды:', err);
  }
}

export async function autoSyncAchievementsFromState() {
  if (!getUser()) return [];
  try {
    let watchedEpisodesCount = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('storm_watched_eps_')) {
          const val = JSON.parse(localStorage.getItem(key) || '[]');
          if (Array.isArray(val)) watchedEpisodesCount += val.length;
        }
      }
    } catch {}

    const themeHistory = JSON.parse(localStorage.getItem('storm_theme_history') || '[]');
    const langHistory = JSON.parse(localStorage.getItem('storm_lang_history') || '[]');
    const used4k = parseInt(localStorage.getItem('storm_4k_count') || '0', 10);
    const usedProAudio = Boolean(localStorage.getItem('storm_pro_audio_used'));
    const usedProVideo = Boolean(localStorage.getItem('storm_pro_video_used'));
    const voiceoversCount = parseInt(localStorage.getItem('storm_voiceovers_count') || '0', 10);
    const usedXray = Boolean(localStorage.getItem('storm_xray_used'));
    const watchedHours = parseFloat(localStorage.getItem('storm_watched_hours') || '0');

    const clientState = {
      watched_episodes: watchedEpisodesCount,
      themes_count: Math.max(themeHistory.length, 1),
      langs_count: Math.max(langHistory.length, 1),
      used_4k_count: used4k,
      used_pro_audio: usedProAudio,
      used_pro_video: usedProVideo,
      voiceovers_count: voiceoversCount,
      used_xray: usedXray,
      total_watched_hours: watchedHours
    };

    const res = await fetch('/api/achievements/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('storm_token') || ''}`
      },
      body: JSON.stringify({ client_state: clientState })
    });

    if (res.ok) {
      const data = await res.json();
      if (data.achievements) {
        cachedAchievements = data.achievements;
      }
      if (data.unlocked && data.unlocked.length > 0) {
        data.unlocked.forEach(ach => showAchievementToast(ach));
      }
      return cachedAchievements;
    }
  } catch (err) {
    console.warn('Авто-синхронизация достижений завершилась ошибкой:', err);
  }
  return null;
}

export async function renderProfileAchievements(containerElement, filterCategory = 'all') {
  if (!containerElement) return;

  if (!cachedAchievements || cachedAchievements.length === 0) {
    containerElement.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:24px;">Загрузка списка достижений...</div>';
  }

  // Запускаем фоновую сверку состояния
  autoSyncAchievementsFromState().then(updated => {
    if (updated && containerElement.isConnected) {
      updateAchievementsUI(containerElement, updated, filterCategory);
    }
  });

  const achievements = await fetchUserAchievements();
  if (!achievements || achievements.length === 0) {
    containerElement.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:24px;">Каталог достижений формируется...</div>';
    return;
  }

  updateAchievementsUI(containerElement, achievements, filterCategory);
}

function updateAchievementsUI(containerElement, achievements, filterCategory = 'all') {
  const unlockedCount = achievements.filter(a => a.unlocked).length;
  const totalCount = achievements.length;
  const percentTotal = Math.round((unlockedCount / totalCount) * 100);

  // Обновляем бейдж на вкладке профиля
  const tabBtn = document.getElementById('profile-tab-achievements');
  if (tabBtn) {
    tabBtn.textContent = `Достижения (${unlockedCount}/${totalCount})`;
  }

  const categories = [
    { id: 'all', label: 'Все' },
    { id: 'unlocked', label: `Полученные (${unlockedCount})` },
    { id: 'cinema', label: 'Киномарафон' },
    { id: 'anime', label: 'Отаку' },
    { id: 'genres', label: 'Жанры' },
    { id: 'time', label: 'Время' },
    { id: 'social', label: 'Сообщество' },
    { id: 'collection', label: 'Коллекция' },
    { id: 'tech', label: 'Технологии' }
  ];

  let filtered = achievements;
  if (filterCategory === 'unlocked') {
    filtered = achievements.filter(a => a.unlocked);
  } else if (filterCategory !== 'all') {
    filtered = achievements.filter(a => a.category === filterCategory);
  }

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
        <button type="button" class="ach-category-pill ${c.id === filterCategory ? 'active' : ''}" data-cat="${c.id}">${c.label}</button>
      `).join('')}
    </div>

    <!-- Сетка карточек достижений -->
    <div class="achievements-grid">
      ${filtered.length === 0 ? `
        <div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 30px; font-size: 13px;">
          В этой категории пока нет открытых достижений
        </div>
      ` : filtered.map(ach => {
        const isUnlocked = ach.unlocked;
        const progress = ach.progress || 0;
        const target = ach.target || 1;
        const percent = Math.min(100, Math.round((progress / target) * 100));
        const canClaim = !isUnlocked && progress >= target;
        const formattedDate = ach.unlocked_at ? formatAchievementDate(ach.unlocked_at) : '';

        return `
          <div class="achievement-card ${isUnlocked ? 'unlocked' : 'locked'} rarity-${ach.rarity}">
            <div class="achievement-card-icon">${ach.icon}</div>
            <div class="achievement-card-info">
              <div class="achievement-card-header">
                <span class="achievement-card-title">${ach.title}</span>
                ${isUnlocked ? `
                  <span class="achievement-card-status unlocked">✓ Получено</span>
                ` : canClaim ? `
                  <button type="button" class="ach-claim-btn" data-claim-id="${ach.id}">Забрать</button>
                ` : `
                  <span class="achievement-card-status">${progress}/${target}</span>
                `}
              </div>
              <p class="achievement-card-desc">${ach.desc}</p>
              ${isUnlocked && formattedDate ? `
                <div class="achievement-card-date">Получено: ${formattedDate}</div>
              ` : !isUnlocked ? `
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

  // Навешиваем клики кнопки «Забрать награду»
  containerElement.querySelectorAll('.ach-claim-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const achId = btn.dataset.claimId;
      btn.disabled = true;
      btn.textContent = '...';
      claimAchievementReward(achId, containerElement, filterCategory);
    };
  });
}
