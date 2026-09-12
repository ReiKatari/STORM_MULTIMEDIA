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

export async function fetchUserAchievements() {
  try {
    const token = localStorage.getItem('storm_token');
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch('/api/achievements', { headers });
    if (!res.ok) return [];
    cachedAchievements = await res.json();
    return cachedAchievements;
  } catch (err) {
    console.error('Ошибка загрузки достижений:', err);
    return [];
  }
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
  containerElement.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:24px;">Загрузка списка достижений...</div>';

  const achievements = await fetchUserAchievements();
  if (achievements.length === 0) {
    containerElement.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:24px;">Авторизуйтесь, чтобы отслеживать кибер-достижения</div>';
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
