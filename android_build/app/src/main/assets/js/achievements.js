/* ==========================================================================
   STORM MULTIMEDIA - СИСТЕМА ДОСТИЖЕНИЙ И УВЕДОМЛЕНИЙ (STORM ACHIEVEMENTS)
   Гибридный движок: 100% поддержка Гостевого (локального) и Облачного режимов
   ========================================================================== */

import { getUser } from './auth.js?v=1.1.2';

export const ACHIEVEMENTS_CATALOG = [
  // 1. Киномарафон (Фильмы и сериалы)
  { id: 'cinema_first', title: 'Первый сеанс', desc: 'Посмотреть 1 фильм или серию', category: 'cinema', rarity: 'bronze', icon: '🎬', target: 1 },
  { id: 'cinema_novice', title: 'Кинолюбитель', desc: 'Посмотреть 5 тайтлов', category: 'cinema', rarity: 'bronze', icon: '🍿', target: 5 },
  { id: 'cinema_veteran', title: 'Киноман', desc: 'Посмотреть 15 тайтлов', category: 'cinema', rarity: 'silver', icon: '🎟️', target: 15 },
  { id: 'cinema_master', title: 'Синефил со стажем', desc: 'Посмотреть 30 тайтлов', category: 'cinema', rarity: 'gold', icon: '📽️', target: 30 },
  { id: 'cinema_legend', title: 'Архивариус кинематографа', desc: 'Посмотреть 60 тайтлов', category: 'cinema', rarity: 'platinum', icon: '🏆', target: 60 },
  { id: 'cinema_god', title: 'Владыка киноэкрана', desc: 'Посмотреть 100 тайтлов', category: 'cinema', rarity: 'cyber', icon: '👑', target: 100 },
  { id: 'series_first_ep', title: 'Сериальный старт', desc: 'Посмотреть 1 серию любого сериала', category: 'cinema', rarity: 'bronze', icon: '📺', target: 1 },
  { id: 'series_binge_5', title: 'Сериальный марафон', desc: 'Посмотреть 5 серий сериалов', category: 'cinema', rarity: 'silver', icon: '🛋️', target: 5 },
  { id: 'series_binge_25', title: 'Сериаломан', desc: 'Посмотреть 25 серий сериалов', category: 'cinema', rarity: 'gold', icon: '🍿', target: 25 },
  { id: 'series_season_done', title: 'Завершённый сезон', desc: 'Полностью посмотреть сезон сериала', category: 'cinema', rarity: 'gold', icon: '🏁', target: 1 },
  { id: 'series_three_seasons', title: 'Повелитель сезонов', desc: 'Полностью посмотреть 3 сезона сериалов', category: 'cinema', rarity: 'platinum', icon: '👑', target: 3 },

  // 2. Отаку и аниме-культура
  { id: 'anime_first', title: 'Первый кохай', desc: 'Посмотреть 1 аниме', category: 'anime', rarity: 'bronze', icon: '⛩️', target: 1 },
  { id: 'anime_genin', title: 'Путь шиноби', desc: 'Посмотреть 5 аниме-релизов', category: 'anime', rarity: 'bronze', icon: '🍙', target: 5 },
  { id: 'anime_chunin', title: 'Опытный отаку', desc: 'Посмотреть 15 аниме-релизов', category: 'anime', rarity: 'silver', icon: '🌸', target: 15 },
  { id: 'anime_jonin', title: 'Мастер ниндзюцу', desc: 'Посмотреть 30 аниме-релизов', category: 'anime', rarity: 'gold', icon: '⚡', target: 30 },
  { id: 'anime_hokage', title: 'Легендарный хокаге', desc: 'Посмотреть 50 аниме-релизов', category: 'anime', rarity: 'platinum', icon: '🔥', target: 50 },
  { id: 'anime_kami', title: 'Аниме-божество', desc: 'Посмотреть 100 аниме-релизов', category: 'anime', rarity: 'cyber', icon: '✨', target: 100 },
  { id: 'anime_anilibria', title: 'Голос Анилибрии', desc: 'Посмотреть аниме в озвучке AniLibria', category: 'anime', rarity: 'bronze', icon: '🎙️', target: 1 },
  { id: 'anime_season_pass', title: 'Онгоинг-мастер', desc: 'Посмотреть 12 серий аниме', category: 'anime', rarity: 'silver', icon: '⚡', target: 12 },

  // 3. Жанровые эксперты
  { id: 'genre_scifi', title: 'В глубинах космоса', desc: 'Посмотреть фантастику или научпоп', category: 'genres', rarity: 'bronze', icon: '🚀', target: 1 },
  { id: 'genre_action', title: 'Адреналиновый шквал', desc: 'Посмотреть боевик или остросюжетный триллер', category: 'genres', rarity: 'bronze', icon: '💥', target: 1 },
  { id: 'genre_comedy', title: 'Искренний смех', desc: 'Посмотреть комедию или ситком', category: 'genres', rarity: 'bronze', icon: '😄', target: 1 },
  { id: 'genre_horror', title: 'Стальные нервы', desc: 'Посмотреть хоррор или фильм ужасов', category: 'genres', rarity: 'silver', icon: '👻', target: 1 },
  { id: 'genre_drama', title: 'Глубокие эмоции', desc: 'Посмотреть драматическую картину', category: 'genres', rarity: 'bronze', icon: '🎭', target: 1 },
  { id: 'genre_detective', title: 'Шерлок Холмс', desc: 'Посмотреть детектив или расследование', category: 'genres', rarity: 'silver', icon: '🔍', target: 1 },

  // 4. Хранитель времени
  { id: 'time_1h', title: 'Первый час в Шторме', desc: 'Провести 1 час за просмотром', category: 'time', rarity: 'bronze', icon: '⏱️', target: 1 },
  { id: 'time_5h', title: 'Погружение в поток', desc: 'Провести 5 часов за просмотром', category: 'time', rarity: 'bronze', icon: '⌛', target: 5 },
  { id: 'time_20h', title: 'Ночной марафонец', desc: 'Провести 20 часов за просмотром', category: 'time', rarity: 'silver', icon: '🌙', target: 20 },
  { id: 'time_50h', title: 'Неутомимый зритель', desc: 'Провести 50 часов за просмотром', category: 'time', rarity: 'gold', icon: '🌟', target: 50 },
  { id: 'time_100h', title: 'Повелитель хроноса', desc: 'Провести 100 часов за просмотром', category: 'time', rarity: 'platinum', icon: '🌌', target: 100 },
  { id: 'time_250h', title: 'Вечный житель кибервселенной', desc: 'Провести 250 часов за просмотром', category: 'time', rarity: 'cyber', icon: '🪐', target: 250 },
  { id: 'time_500h', title: 'Хранитель вечности', desc: 'Провести 500 часов за просмотром', category: 'time', rarity: 'cyber', icon: '⏳', target: 500 },

  // 5. Кинокритика и сообщество
  { id: 'review_first', title: 'Первое мнение', desc: 'Оставить свой первый отзыв', category: 'social', rarity: 'bronze', icon: '✍️', target: 1 },
  { id: 'review_3', title: 'Внимательный критик', desc: 'Оставить 3 рецензии', category: 'social', rarity: 'silver', icon: '📝', target: 3 },
  { id: 'review_10', title: 'Золотое перо Шторма', desc: 'Оставить 10 развернутых рецензий', category: 'social', rarity: 'gold', icon: '✒️', target: 10 },
  { id: 'review_liked', title: 'Голос народа', desc: 'Получить первый лайк на свой отзыв', category: 'social', rarity: 'bronze', icon: '👍', target: 1 },
  { id: 'review_popular', title: 'Признание зала', desc: 'Собрать 5 лайков на рецензиях', category: 'social', rarity: 'gold', icon: '💖', target: 5 },
  { id: 'review_rating', title: 'Строгий цензор', desc: 'Поставить 5 личных оценок релизам', category: 'social', rarity: 'silver', icon: '⭐', target: 5 },
  { id: 'room_host', title: 'Капитан кинозала', desc: 'Создать комнату совместного просмотра', category: 'social', rarity: 'silver', icon: '👥', target: 1 },
  { id: 'room_guest', title: 'Кино-компания', desc: 'Присоединиться к кинокомнате', category: 'social', rarity: 'bronze', icon: '🤝', target: 1 },
  { id: 'sync_master', title: 'Синхронизатор данных', desc: 'Синхронизировать или экспортировать библиотеку', category: 'social', rarity: 'silver', icon: '🔄', target: 1 },

  // 6. Коллекционер и архивариус
  { id: 'bookmark_first', title: 'Первая закладка', desc: 'Добавить релиз в закладки', category: 'collection', rarity: 'bronze', icon: '🔖', target: 1 },
  { id: 'bookmark_20', title: 'Личная фильмотека', desc: 'Собрать 20 релизов в закладках', category: 'collection', rarity: 'silver', icon: '📁', target: 20 },
  { id: 'bookmark_50', title: 'Великая коллекция', desc: 'Собрать 50 релизов в закладках', category: 'collection', rarity: 'gold', icon: '🏛️', target: 50 },
  { id: 'bookmark_100', title: 'Золотой фонд', desc: 'Собрать 100 релизов в закладках', category: 'collection', rarity: 'platinum', icon: '💎', target: 100 },
  { id: 'status_watching', title: 'В процессе', desc: 'Добавить 3 релиза в статус «Смотрю»', category: 'collection', rarity: 'bronze', icon: '👀', target: 3 },
  { id: 'status_completed', title: 'Досмотрено до конца', desc: 'Отметить 5 релизов статусом «Просмотрено»', category: 'collection', rarity: 'silver', icon: '✅', target: 5 },
  { id: 'status_planned', title: 'Большие планы', desc: 'Добавить 5 релизов в «Запланировано»', category: 'collection', rarity: 'bronze', icon: '📅', target: 5 },
  { id: 'list_first', title: 'Куратор списков', desc: 'Создать пользовательский список', category: 'collection', rarity: 'bronze', icon: '📋', target: 1 },
  { id: 'list_pro', title: 'Архитектор коллекций', desc: 'Создать 3 тематических списка', category: 'collection', rarity: 'gold', icon: '📚', target: 3 },

  // 7. Кибер-технологии и инновации
  { id: 'tech_4k', title: 'Ценитель 4K Ultra HD', desc: 'Запустить фильм или серию в качестве 4K Ultra HD', category: 'tech', rarity: 'bronze', icon: '💎', target: 1 },
  { id: 'tech_4k_ultra', title: 'Абсолютный ультра-четкий', desc: 'Посмотреть 5 релизов в качестве 4K Ultra HD', category: 'tech', rarity: 'gold', icon: '🔮', target: 5 },
  { id: 'tech_audio_pro', title: 'Аудиофил', desc: 'Включить профессиональный эквалайзер или объемный звук', category: 'tech', rarity: 'silver', icon: '🎧', target: 1 },
  { id: 'tech_video_pro', title: 'Мастер калибровки', desc: 'Настроить профессиональное видео (HDR, резкость или контраст)', category: 'tech', rarity: 'silver', icon: '🎛️', target: 1 },
  { id: 'tech_voiceover_fan', title: 'Голосовой гурман', desc: 'Переключить 3 разные студийные озвучки', category: 'tech', rarity: 'bronze', icon: '📻', target: 3 },
  { id: 'tech_xray', title: 'Рентгеновское зрение', desc: 'Изучить актерский состав через X-Ray', category: 'tech', rarity: 'bronze', icon: '👁️', target: 1 },
  { id: 'tech_torrent', title: 'P2P-пионер', desc: 'Запустить стриминг через WebTorrent', category: 'tech', rarity: 'silver', icon: '🧲', target: 1 },
  { id: 'tech_night', title: 'Ночной охотник', desc: 'Смотреть кино ночью между 02:00 и 05:00', category: 'tech', rarity: 'silver', icon: '🦉', target: 1 },
  { id: 'tech_chameleon', title: 'Хамелеон киберпространства', desc: 'Опробовать все 8 тем оформления', category: 'tech', rarity: 'gold', icon: '🎨', target: 8 },
  { id: 'tech_polyglot', title: 'Полиглот Шторма', desc: 'Переключить 3 языка интерфейса', category: 'tech', rarity: 'silver', icon: '🌐', target: 3 },
  { id: 'tech_voice', title: 'Кибер-голос', desc: 'Использовать голосового ассистента', category: 'tech', rarity: 'bronze', icon: '🎙️', target: 1 },
  { id: 'tech_gamepad', title: 'Штурман геймпада', desc: 'Использовать геймпад или ТВ-режим', category: 'tech', rarity: 'silver', icon: '🎮', target: 1 },
  { id: 'tech_subtitles', title: 'Свои титры', desc: 'Загрузить внешние субтитры или дорожку', category: 'tech', rarity: 'bronze', icon: '💬', target: 1 },
  { id: 'tech_ambilight', title: 'Неоновая аура', desc: 'Включить динамический Ambilight эффект', category: 'tech', rarity: 'bronze', icon: '🌈', target: 1 },
  { id: 'tech_skip', title: 'Мастер таймкодов', desc: 'Пропустить интро или титры по кнопке', category: 'tech', rarity: 'bronze', icon: '⏭️', target: 1 },
  { id: 'tech_pip', title: 'Картинка в картинке', desc: 'Воспроизвести видео в режиме PiP', category: 'tech', rarity: 'bronze', icon: '🖼️', target: 1 },
  { id: 'tech_pwa', title: 'Всегда со мной', desc: 'Установить веб-приложение на устройство', category: 'tech', rarity: 'gold', icon: '📲', target: 1 }
];

let cachedAchievements = [];
const toastedIdsSession = new Set();

function loadLocalAchievementsState() {
  try {
    const raw = localStorage.getItem('storm_local_achievements');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch (_) {}
  return {};
}

function saveLocalAchievementsState(stateObj) {
  try {
    localStorage.setItem('storm_local_achievements', JSON.stringify(stateObj || {}));
  } catch (_) {}
}

function updateLocalAchievementProgress(stateObj, achievementId, amount = 1, isSet = false) {
  const achMeta = ACHIEVEMENTS_CATALOG.find(a => a.id === achievementId);
  if (!achMeta) return null;

  const target = achMeta.target || 1;
  const existing = stateObj[achievementId] || { progress: 0, unlocked: false, unlocked_at: null };
  const wasUnlocked = Boolean(existing.unlocked);

  let newProgress = isSet ? Math.max(existing.progress || 0, amount) : (existing.progress || 0) + amount;
  newProgress = Math.min(Math.max(0, newProgress), target);
  const nowUnlocked = wasUnlocked || newProgress >= target;
  const unlockedAt = existing.unlocked_at || (nowUnlocked ? Date.now() : null);

  stateObj[achievementId] = {
    progress: nowUnlocked ? target : newProgress,
    target,
    unlocked: nowUnlocked,
    unlocked_at: unlockedAt
  };

  if (nowUnlocked && !wasUnlocked) {
    return {
      ...achMeta,
      progress: target,
      unlocked: true,
      unlocked_at: unlockedAt
    };
  }
  return null;
}

function buildMergedCatalog(serverList = null) {
  const localMap = loadLocalAchievementsState();
  const serverMap = new Map();
  if (Array.isArray(serverList)) {
    serverList.forEach(item => {
      if (item && item.id) serverMap.set(item.id, item);
    });
  }

  let localChanged = false;
  const merged = ACHIEVEMENTS_CATALOG.map(ach => {
    const sItem = serverMap.get(ach.id);
    const lItem = localMap[ach.id];
    const target = ach.target || 1;
    const progress = Math.min(target, Math.max(sItem?.progress || 0, lItem?.progress || 0));
    const unlocked = Boolean(sItem?.unlocked || lItem?.unlocked || progress >= target);
    const unlocked_at = lItem?.unlocked_at || sItem?.unlocked_at || (unlocked ? Date.now() : null);

    if (!lItem || lItem.progress !== progress || Boolean(lItem.unlocked) !== unlocked) {
      localMap[ach.id] = { progress: unlocked ? target : progress, target, unlocked, unlocked_at };
      localChanged = true;
    }

    return {
      ...ach,
      progress: unlocked ? target : progress,
      unlocked,
      unlocked_at
    };
  });

  if (localChanged) {
    saveLocalAchievementsState(localMap);
  }
  cachedAchievements = merged;
  updateProfileAchievementBadge(merged);
  return merged;
}

export function updateProfileAchievementBadge(list = cachedAchievements) {
  if (!Array.isArray(list) || list.length === 0) return;
  const unlockedCount = list.filter(a => a.unlocked).length;
  const totalCount = list.length;
  const tabBtn = document.getElementById('profile-tab-achievements');
  if (tabBtn) {
    tabBtn.textContent = `🏆 Достижения (${unlockedCount}/${totalCount})`;
  }
}

// Звуковой сигнал разблокировки достижения (Web Audio API — мягкий кибер-аккорд)
function playAchievementSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.08);
      gain.gain.setValueAtTime(0.08, ctx.currentTime + i * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.08 + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.08);
      osc.stop(ctx.currentTime + i * 0.08 + 0.45);
    });
  } catch (_) {}
}

function formatAchievementDate(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${day}.${month}.${year} в ${hours}:${mins}`;
}

// 1. Показ красивого уведомления о полученном достижении (поверх всех модальных окон)
export function showAchievementToast(achievement) {
  if (!achievement || !achievement.id) return;
  if (toastedIdsSession.has(achievement.id)) return;
  toastedIdsSession.add(achievement.id);

  playAchievementSound();

  const hostParent = document.fullscreenElement || document.webkitFullscreenElement || document.body;
  let container = document.getElementById('storm-achievement-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'storm-achievement-toast-container';
  }
  container.style.cssText = 'position:fixed !important;bottom:24px !important;right:24px !important;z-index:2147483645 !important;display:flex !important;flex-direction:column !important;gap:12px !important;pointer-events:none !important;max-width:min(420px, calc(100vw - 32px)) !important;';
  if (container.parentElement !== hostParent) {
    hostParent.appendChild(container);
  }

  const rarityColors = {
    bronze: '#f59e0b',
    silver: '#38bdf8',
    gold: '#fbbf24',
    platinum: '#00f0ff',
    cyber: '#ff007f'
  };

  const rarityNames = {
    bronze: 'БРОНЗОВЫЙ ТРОФЕЙ',
    silver: 'СЕРЕБРЯНЫЙ ТРОФЕЙ',
    gold: 'ЗОЛОТОЙ ТРОФЕЙ',
    platinum: 'ПЛАТИНОВЫЙ ТРОФЕЙ',
    cyber: 'КИБЕР-ЛЕГЕНДА'
  };

  const borderColor = rarityColors[achievement.rarity] || '#a855f7';
  const rarityLabel = rarityNames[achievement.rarity] || 'ДОСТИЖЕНИЕ ОТКРЫТО!';

  const toast = document.createElement('div');
  toast.className = `achievement-toast achievement-unlock-toast rarity-${achievement.rarity || 'bronze'}`;
  toast.style.cssText = `
    pointer-events: auto !important;
    background: linear-gradient(145deg, rgba(16, 14, 34, 0.985) 0%, rgba(8, 7, 18, 0.995) 100%) !important;
    border: 2px solid ${borderColor} !important;
    border-radius: 16px !important;
    padding: 14px 18px !important;
    display: flex !important;
    align-items: center !important;
    gap: 14px !important;
    min-width: 310px !important;
    max-width: min(400px, calc(100vw - 32px)) !important;
    color: #ffffff !important;
    backdrop-filter: blur(24px) !important;
    -webkit-backdrop-filter: blur(24px) !important;
    box-shadow: 0 22px 50px rgba(0, 0, 0, 0.96), 0 0 32px ${borderColor}88, inset 0 1px 0 rgba(255, 255, 255, 0.22) !important;
    cursor: pointer !important;
    transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1) !important;
  `;

  toast.innerHTML = `
    <div class="achievement-toast-icon" style="width:48px;height:48px;min-width:48px;border-radius:12px;background:rgba(255,255,255,0.09);border:1.5px solid ${borderColor};box-shadow:0 0 18px ${borderColor}66;display:flex;align-items:center;justify-content:center;font-size:26px;flex-shrink:0;">
      ${achievement.icon || '🏆'}
    </div>
    <div class="achievement-toast-body" style="display:flex;flex-direction:column;gap:3px;min-width:0;flex:1;">
      <div class="achievement-toast-label" style="color:${borderColor};font-size:10.5px;font-weight:900;text-transform:uppercase;letter-spacing:0.9px;text-shadow:0 1px 6px rgba(0,0,0,0.9);">🏆 ${rarityLabel}</div>
      <div class="achievement-toast-title" style="color:#ffffff;font-size:15px;font-weight:800;line-height:1.25;text-shadow:0 2px 6px rgba(0,0,0,0.9);">${achievement.title}</div>
      <div class="achievement-toast-desc" style="color:#e2e8f0;font-size:12px;font-weight:600;line-height:1.35;text-shadow:0 1px 4px rgba(0,0,0,0.9);">${achievement.desc}</div>
    </div>
    <button type="button" class="ach-toast-close" style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.16);color:#cbd5e1;width:26px;height:26px;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0;" title="Закрыть">✕</button>
  `;

  toast.onclick = (e) => {
    if (e.target.closest('.ach-toast-close')) {
      e.stopPropagation();
      toast.remove();
      return;
    }
    toast.remove();
    const profBtn = document.getElementById('user-profile-btn') || document.getElementById('open-auth-btn');
    if (profBtn) profBtn.click();
    setTimeout(() => {
      const achTab = document.querySelector('.profile-tab-btn[data-tab="achievements"]');
      if (achTab) achTab.click();
    }, 120);
  };

  container.appendChild(toast);

  setTimeout(() => {
    if (!toast.isConnected) return;
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px) scale(0.95)';
    setTimeout(() => toast.remove(), 350);
  }, 6000);
}

function evaluateLocalAction(actionType, meta = {}) {
  const stateObj = loadLocalAchievementsState();
  const newlyUnlocked = [];

  const tryUnlock = (achId, amount = 1, isSet = false) => {
    const unlockedAch = updateLocalAchievementProgress(stateObj, achId, amount, isSet);
    if (unlockedAch) newlyUnlocked.push(unlockedAch);
  };

  switch (actionType) {
    case 'watch_complete':
      tryUnlock('cinema_first', 1);
      tryUnlock('cinema_novice', 1);
      tryUnlock('cinema_veteran', 1);
      tryUnlock('cinema_master', 1);
      tryUnlock('cinema_legend', 1);
      tryUnlock('cinema_god', 1);
      if (meta.is_anime) {
        tryUnlock('anime_first', 1);
        tryUnlock('anime_genin', 1);
        tryUnlock('anime_chunin', 1);
        tryUnlock('anime_jonin', 1);
        tryUnlock('anime_hokage', 1);
        tryUnlock('anime_kami', 1);
      }
      break;

    case 'anime_anilibria':
      tryUnlock('anime_anilibria', 1);
      tryUnlock('anime_first', 1);
      break;

    case 'watch_time': {
      const hours = Math.max(1, Math.round(Number(meta.total_hours) || 1));
      tryUnlock('time_1h', hours, true);
      tryUnlock('time_5h', hours, true);
      tryUnlock('time_20h', hours, true);
      tryUnlock('time_50h', hours, true);
      tryUnlock('time_100h', hours, true);
      tryUnlock('time_250h', hours, true);
      tryUnlock('time_500h', hours, true);
      break;
    }

    case 'watch_series_episode':
      tryUnlock('series_first_ep', 1);
      tryUnlock('series_binge_5', 1);
      tryUnlock('series_binge_25', 1);
      if (meta.is_anime) {
        tryUnlock('anime_season_pass', 1);
      }
      break;

    case 'complete_season':
      tryUnlock('series_season_done', 1);
      tryUnlock('series_three_seasons', 1);
      break;

    case 'watch_genre': {
      const genre = String(meta.genre || '').toLowerCase();
      if (genre.includes('фантастик') || genre.includes('космос') || genre.includes('науч') || genre.includes('sci-fi')) tryUnlock('genre_scifi', 1);
      if (genre.includes('боевик') || genre.includes('триллер') || genre.includes('экшен') || genre.includes('action')) tryUnlock('genre_action', 1);
      if (genre.includes('комед') || genre.includes('ситком') || genre.includes('comedy')) tryUnlock('genre_comedy', 1);
      if (genre.includes('ужас') || genre.includes('хоррор') || genre.includes('horror')) tryUnlock('genre_horror', 1);
      if (genre.includes('драм') || genre.includes('drama')) tryUnlock('genre_drama', 1);
      if (genre.includes('детектив') || genre.includes('криминал') || genre.includes('crime')) tryUnlock('genre_detective', 1);
      break;
    }

    case 'write_review':
      tryUnlock('review_first', 1);
      tryUnlock('review_3', 1);
      tryUnlock('review_10', 1);
      break;

    case 'rate_media':
      tryUnlock('review_rating', 1);
      break;

    case 'receive_like':
      tryUnlock('review_liked', 1);
      tryUnlock('review_popular', 1);
      break;

    case 'room_host':
      tryUnlock('room_host', 1);
      break;

    case 'room_guest':
      tryUnlock('room_guest', 1);
      break;

    case 'sync_data':
      tryUnlock('sync_master', 1);
      break;

    case 'add_bookmark': {
      let totalBookmarks = Number(meta.total_bookmarks) || 0;
      if (!totalBookmarks) {
        try {
          const bList = JSON.parse(localStorage.getItem('storm_local_bookmarks') || '[]');
          totalBookmarks = Array.isArray(bList) ? bList.length : 1;
        } catch (_) {
          totalBookmarks = 1;
        }
      }
      tryUnlock('bookmark_first', Math.max(1, totalBookmarks), true);
      tryUnlock('bookmark_20', totalBookmarks, true);
      tryUnlock('bookmark_50', totalBookmarks, true);
      tryUnlock('bookmark_100', totalBookmarks, true);
      break;
    }

    case 'update_status': {
      try {
        const bList = JSON.parse(localStorage.getItem('storm_local_bookmarks') || '[]');
        if (Array.isArray(bList)) {
          const watchingCnt = bList.filter(b => b.status === 'watching' || b.user_status === 'watching').length;
          const completedCnt = bList.filter(b => b.status === 'completed' || b.user_status === 'completed').length;
          const plannedCnt = bList.filter(b => b.status === 'planned' || b.status === 'plan' || b.user_status === 'planned').length;
          if (watchingCnt > 0) tryUnlock('status_watching', watchingCnt, true);
          if (completedCnt > 0) {
            tryUnlock('status_completed', completedCnt, true);
            tryUnlock('cinema_first', completedCnt, true);
            tryUnlock('cinema_novice', completedCnt, true);
            tryUnlock('cinema_veteran', completedCnt, true);
          }
          if (plannedCnt > 0) tryUnlock('status_planned', plannedCnt, true);
        }
      } catch (_) {}
      break;
    }

    case 'create_list': {
      let totalLists = Number(meta.total_lists) || 0;
      if (!totalLists) {
        try {
          const lList = JSON.parse(localStorage.getItem('storm_custom_lists') || '[]');
          totalLists = Array.isArray(lList) ? lList.length : 1;
        } catch (_) {
          totalLists = 1;
        }
      }
      tryUnlock('list_first', Math.max(1, totalLists), true);
      tryUnlock('list_pro', totalLists, true);
      break;
    }

    case 'use_4k': {
      try {
        const cur4k = (parseInt(localStorage.getItem('storm_4k_count') || '0', 10) || 0) + 1;
        localStorage.setItem('storm_4k_count', String(cur4k));
        tryUnlock('tech_4k', cur4k, true);
        tryUnlock('tech_4k_ultra', cur4k, true);
      } catch (_) {
        tryUnlock('tech_4k', 1);
        tryUnlock('tech_4k_ultra', 1);
      }
      break;
    }

    case 'use_pro_audio':
      try { localStorage.setItem('storm_pro_audio_used', '1'); } catch (_) {}
      tryUnlock('tech_audio_pro', 1);
      break;

    case 'use_pro_video':
      try { localStorage.setItem('storm_pro_video_used', '1'); } catch (_) {}
      tryUnlock('tech_video_pro', 1);
      break;

    case 'switch_voiceover': {
      try {
        const curVo = (parseInt(localStorage.getItem('storm_voiceovers_count') || '0', 10) || 0) + 1;
        localStorage.setItem('storm_voiceovers_count', String(curVo));
        tryUnlock('tech_voiceover_fan', curVo, true);
      } catch (_) {
        tryUnlock('tech_voiceover_fan', 1);
      }
      break;
    }

    case 'use_xray':
      try { localStorage.setItem('storm_xray_used', '1'); } catch (_) {}
      tryUnlock('tech_xray', 1);
      break;

    case 'use_torrent':
      tryUnlock('tech_torrent', 1);
      break;

    case 'night_watch':
      tryUnlock('tech_night', 1);
      break;

    case 'switch_theme':
      if (meta.themes_count) {
        tryUnlock('tech_chameleon', Number(meta.themes_count), true);
      } else {
        tryUnlock('tech_chameleon', 1);
      }
      break;

    case 'switch_lang':
      if (meta.langs_count) {
        tryUnlock('tech_polyglot', Number(meta.langs_count), true);
      } else {
        tryUnlock('tech_polyglot', 1);
      }
      break;

    case 'use_voice':
      tryUnlock('tech_voice', 1);
      break;

    case 'use_gamepad':
      tryUnlock('tech_gamepad', 1);
      break;

    case 'use_subtitles':
      tryUnlock('tech_subtitles', 1);
      break;

    case 'use_ambilight':
      tryUnlock('tech_ambilight', 1);
      break;

    case 'use_skip':
      tryUnlock('tech_skip', 1);
      break;

    case 'use_pip':
      tryUnlock('tech_pip', 1);
      break;

    case 'install_pwa':
      tryUnlock('tech_pwa', 1);
      break;

    default:
      break;
  }

  saveLocalAchievementsState(stateObj);
  buildMergedCatalog(cachedAchievements);
  return newlyUnlocked;
}

// 2. Получение всех достижений пользователя (с кэшем и слиянием локального + серверного прогресса)
export async function fetchUserAchievements(forceRefresh = false) {
  if (!forceRefresh && cachedAchievements && cachedAchievements.length > 0) {
    return buildMergedCatalog(cachedAchievements);
  }

  try {
    const token = localStorage.getItem('storm_token');
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    const res = await fetch('/api/achievements', { headers });
    if (res.ok) {
      const serverData = await res.json();
      return buildMergedCatalog(serverData);
    }
  } catch (err) {
    console.warn('Используется локальный каталог достижений:', err?.message);
  }
  return buildMergedCatalog(null);
}

function hasValidServerSession() {
  const user = getUser();
  const token = localStorage.getItem('storm_token') || '';
  return Boolean(user && token && !token.startsWith('guest_') && !token.startsWith('offline_'));
}

// 3. Отправка события прогресса (работает и для Гостя, и для Авторизованного профиля!)
export async function trackClientAction(action, meta = {}) {
  const localUnlocked = evaluateLocalAction(action, meta);
  if (localUnlocked.length > 0) {
    localUnlocked.forEach(ach => showAchievementToast(ach));
    notifyAchievementsUpdated();
  }

  if (!hasValidServerSession()) {
    return localUnlocked;
  }

  try {
    const res = await fetch('/api/achievements/track', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('storm_token') || ''}`
      },
      body: JSON.stringify({ action, meta })
    });

    if (res.ok) {
      const data = await res.json();
      if (data.unlocked && data.unlocked.length > 0) {
        const stateObj = loadLocalAchievementsState();
        data.unlocked.forEach(ach => {
          stateObj[ach.id] = {
            progress: ach.target || 1,
            target: ach.target || 1,
            unlocked: true,
            unlocked_at: ach.unlocked_at || Date.now()
          };
          showAchievementToast(ach);
        });
        saveLocalAchievementsState(stateObj);
        buildMergedCatalog(cachedAchievements);
        notifyAchievementsUpdated();
      }
    }
  } catch (_) {}

  return localUnlocked;
}

function notifyAchievementsUpdated() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('storm:achievements-updated', { detail: { achievements: cachedAchievements } }));
  }
  const container = document.getElementById('ptab-content-achievements');
  if (container && container.style.display !== 'none' && container.innerHTML.trim()) {
    const activePill = container.querySelector('.ach-category-pill.active');
    const cat = activePill?.dataset?.cat || 'all';
    updateAchievementsUI(container, cachedAchievements, cat);
  }
}

// 4. Ручное получение награды за выполненное достижение
export async function claimAchievementReward(achievementId, containerElement, currentCategory = 'all') {
  const stateObj = loadLocalAchievementsState();
  const achMeta = ACHIEVEMENTS_CATALOG.find(a => a.id === achievementId);
  if (achMeta) {
    const now = Date.now();
    stateObj[achievementId] = {
      progress: achMeta.target || 1,
      target: achMeta.target || 1,
      unlocked: true,
      unlocked_at: stateObj[achievementId]?.unlocked_at || now
    };
    saveLocalAchievementsState(stateObj);
    showAchievementToast({
      ...achMeta,
      progress: achMeta.target || 1,
      unlocked: true,
      unlocked_at: now
    });
  }

  if (hasValidServerSession()) {
    try {
      await fetch('/api/achievements/claim', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('storm_token') || ''}`
        },
        body: JSON.stringify({ achievement_id: achievementId })
      });
    } catch (_) {}
  }

  const fresh = await fetchUserAchievements(true);
  if (containerElement) {
    updateAchievementsUI(containerElement, fresh, currentCategory);
  }
  notifyAchievementsUpdated();
}

// 5. Автоматическая синхронизация всех достижений из текущего состояния пользователя
export async function autoSyncAchievementsFromState() {
  try {
    let watchedEpisodesCount = 0;
    let completedSeasonsCount = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (key.startsWith('storm_watched_eps_')) {
          const val = JSON.parse(localStorage.getItem(key) || '[]');
          if (Array.isArray(val)) watchedEpisodesCount += val.length;
        } else if (key.startsWith('storm_season_status_') && localStorage.getItem(key) === 'completed') {
          completedSeasonsCount += 1;
        }
      }
    } catch (_) {}

    const themeHistA = JSON.parse(localStorage.getItem('storm_theme_history') || '[]');
    const themeHistB = JSON.parse(localStorage.getItem('storm_themes_history') || '[]');
    const mergedThemes = Array.from(new Set([
      ...(Array.isArray(themeHistA) ? themeHistA : []),
      ...(Array.isArray(themeHistB) ? themeHistB : []),
      localStorage.getItem('storm_theme') || 'STORM MIDNIGHT'
    ])).filter(Boolean);

    const langHistA = JSON.parse(localStorage.getItem('storm_lang_history') || '[]');
    const langHistB = JSON.parse(localStorage.getItem('storm_langs_history') || '[]');
    const mergedLangs = Array.from(new Set([
      ...(Array.isArray(langHistA) ? langHistA : []),
      ...(Array.isArray(langHistB) ? langHistB : []),
      localStorage.getItem('storm_lang') || 'ru'
    ])).filter(Boolean);

    const used4k = parseInt(localStorage.getItem('storm_4k_count') || '0', 10) || 0;
    const usedProAudio = Boolean(localStorage.getItem('storm_pro_audio_used'));
    const usedProVideo = Boolean(localStorage.getItem('storm_pro_video_used'));
    const voiceoversCount = parseInt(localStorage.getItem('storm_voiceovers_count') || '0', 10) || 0;
    const usedXray = Boolean(localStorage.getItem('storm_xray_used'));
    const watchedHours = parseFloat(localStorage.getItem('storm_watched_hours') || '0') || 0;

    let localBookmarks = [];
    try {
      localBookmarks = JSON.parse(localStorage.getItem('storm_local_bookmarks') || '[]');
      if (!Array.isArray(localBookmarks)) localBookmarks = [];
    } catch (_) {
      localBookmarks = [];
    }

    let customLists = [];
    try {
      customLists = JSON.parse(localStorage.getItem('storm_custom_lists') || '[]');
      if (!Array.isArray(customLists)) customLists = [];
    } catch (_) {
      customLists = [];
    }

    const stateObj = loadLocalAchievementsState();
    const newlyUnlocked = [];
    const syncProgress = (achId, amount, isSet = true) => {
      if (!amount || amount <= 0) return;
      const u = updateLocalAchievementProgress(stateObj, achId, amount, isSet);
      if (u) newlyUnlocked.push(u);
    };

    if (localBookmarks.length > 0) {
      syncProgress('bookmark_first', localBookmarks.length, true);
      syncProgress('bookmark_20', localBookmarks.length, true);
      syncProgress('bookmark_50', localBookmarks.length, true);
      syncProgress('bookmark_100', localBookmarks.length, true);

      const watchingCnt = localBookmarks.filter(b => b.status === 'watching' || b.user_status === 'watching').length;
      const completedCnt = localBookmarks.filter(b => b.status === 'completed' || b.user_status === 'completed').length;
      const plannedCnt = localBookmarks.filter(b => b.status === 'planned' || b.status === 'plan' || b.user_status === 'planned').length;

      syncProgress('status_watching', watchingCnt, true);
      syncProgress('status_completed', completedCnt, true);
      syncProgress('status_planned', plannedCnt, true);
      syncProgress('cinema_first', completedCnt, true);
      syncProgress('cinema_novice', completedCnt, true);
      syncProgress('cinema_veteran', completedCnt, true);
      syncProgress('cinema_master', completedCnt, true);
    }

    if (customLists.length > 0) {
      syncProgress('list_first', customLists.length, true);
      syncProgress('list_pro', customLists.length, true);
    }

    if (watchedEpisodesCount > 0) {
      syncProgress('series_first_ep', watchedEpisodesCount, true);
      syncProgress('series_binge_5', watchedEpisodesCount, true);
      syncProgress('series_binge_25', watchedEpisodesCount, true);
    }

    if (completedSeasonsCount > 0) {
      syncProgress('series_season_done', completedSeasonsCount, true);
      syncProgress('series_three_seasons', completedSeasonsCount, true);
    }

    if (watchedHours >= 1) {
      const h = Math.floor(watchedHours);
      syncProgress('time_1h', h, true);
      syncProgress('time_5h', h, true);
      syncProgress('time_20h', h, true);
      syncProgress('time_50h', h, true);
      syncProgress('time_100h', h, true);
      syncProgress('time_250h', h, true);
      syncProgress('time_500h', h, true);
    }

    syncProgress('tech_chameleon', mergedThemes.length, true);
    syncProgress('tech_polyglot', mergedLangs.length, true);
    syncProgress('tech_4k', used4k, true);
    syncProgress('tech_4k_ultra', used4k, true);
    if (usedProAudio) syncProgress('tech_audio_pro', 1, true);
    if (usedProVideo) syncProgress('tech_video_pro', 1, true);
    syncProgress('tech_voiceover_fan', voiceoversCount, true);
    if (usedXray) syncProgress('tech_xray', 1, true);
    if (localStorage.getItem('storm_tv_mode') === 'true') syncProgress('tech_gamepad', 1, true);

    saveLocalAchievementsState(stateObj);
    if (newlyUnlocked.length > 0) {
      newlyUnlocked.forEach(ach => showAchievementToast(ach));
    }

    if (hasValidServerSession()) {
      const clientState = {
        watched_episodes: watchedEpisodesCount,
        completed_seasons: completedSeasonsCount,
        themes_count: Math.max(mergedThemes.length, 1),
        langs_count: Math.max(mergedLangs.length, 1),
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
        if (data.unlocked && data.unlocked.length > 0) {
          data.unlocked.forEach(ach => showAchievementToast(ach));
        }
        if (data.achievements) {
          return buildMergedCatalog(data.achievements);
        }
      }
    }

    return buildMergedCatalog(cachedAchievements);
  } catch (err) {
    console.warn('Авто-синхронизация достижений:', err?.message);
    return buildMergedCatalog(cachedAchievements);
  }
}

export async function renderProfileAchievements(containerElement, filterCategory = 'all') {
  if (!containerElement) return;

  const currentList = buildMergedCatalog(cachedAchievements);
  updateAchievementsUI(containerElement, currentList, filterCategory);

  autoSyncAchievementsFromState().then(updated => {
    if (updated && containerElement.isConnected) {
      updateAchievementsUI(containerElement, updated, filterCategory);
    }
  });
}

function updateAchievementsUI(containerElement, achievements, filterCategory = 'all') {
  const unlockedCount = achievements.filter(a => a.unlocked).length;
  const totalCount = achievements.length;
  const percentTotal = totalCount > 0 ? Math.round((unlockedCount / totalCount) * 100) : 0;

  updateProfileAchievementBadge(achievements);

  const categories = [
    { id: 'all', label: `Все (${totalCount})` },
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

  containerElement.querySelectorAll('.ach-category-pill').forEach(btn => {
    btn.onclick = () => {
      updateAchievementsUI(containerElement, cachedAchievements, btn.dataset.cat);
    };
  });

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
