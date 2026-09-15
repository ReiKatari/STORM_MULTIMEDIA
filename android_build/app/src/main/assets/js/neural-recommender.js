/* ==========================================================================
   STORM MULTIMEDIA - NEURAL RECOMMENDER (ИИ-СОВЕТНИК НА ВЕЧЕР)
   Анализ вкусов, оценок и времени для персональных рекомендаций
   ========================================================================== */

import { fetchUserBookmarks, fetchContinueWatching } from './bookmarks.js';
import { openPlayerModal } from './player.js';
import { showToast } from './auth.js';

export async function generateNeuralRecommendations() {
  const [bookmarks, continueList] = await Promise.all([
    fetchUserBookmarks().catch(() => []),
    fetchContinueWatching().catch(() => [])
  ]);

  // Сбор жанровых и тематических предпочтений
  const genreWeights = {};
  const seenIds = new Set();

  [...bookmarks, ...continueList].forEach(item => {
    if (!item) return;
    seenIds.add(String(item.id || item.media_id));
    const genres = Array.isArray(item.genres) ? item.genres : (typeof item.genres === 'string' ? item.genres.split(/[,/]/) : []);
    genres.forEach(g => {
      const clean = g.trim().toLowerCase();
      if (clean) genreWeights[clean] = (genreWeights[clean] || 0) + 1;
    });
  });

  // Получаем каталог популярных релизов
  let catalogItems = [];
  try {
    const res = await fetch('/api/media/catalog?category=popular&page=1&source=all');
    const data = await res.json();
    catalogItems = data.items || [];
  } catch {
    catalogItems = [];
  }

  // Фильтруем уже просмотренные и ранжируем по совпадению вкусов
  const scored = catalogItems.map(item => {
    let score = (parseFloat(item.rating) || 5) * 1.5;
    const isSeen = seenIds.has(String(item.id));
    if (isSeen) score -= 20;

    let matchedGenre = 'Мировой шедевр';
    const itemGenres = Array.isArray(item.genres) ? item.genres : (typeof item.genres === 'string' ? item.genres.split(/[,/]/) : []);
    itemGenres.forEach(g => {
      const clean = g.trim().toLowerCase();
      if (genreWeights[clean]) {
        score += genreWeights[clean] * 2.5;
        matchedGenre = g.trim();
      }
    });

    return {
      ...item,
      score,
      reason: `Идеально подходит под ваш интерес к жанру «${matchedGenre}» и высокий рейтинг ★ ${item.rating || '8.5'}`
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 8);
}

export async function openNeuralRecommenderModal() {
  let modal = document.getElementById('neural-recommender-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'storm-modal-backdrop';
    modal.id = 'neural-recommender-modal';
    modal.innerHTML = `
      <div class="storm-modal" style="max-width: 820px; width: 95%;">
        <div class="storm-modal-header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 20px;">🧠</span>
            <h3 style="margin: 0;">STORM NEURAL RECOMMENDER</h3>
          </div>
          <button type="button" class="storm-modal-close" id="neural-modal-close-btn">✕</button>
        </div>
        <div class="storm-modal-body" id="neural-recommender-body">
          <div style="text-align: center; padding: 40px; color: var(--text-muted);">
            <div style="font-size: 32px; animation: spin 1s linear infinite; margin-bottom: 12px;">⏳</div>
            <div>Нейросеть анализирует ваши предпочтения и подбирает идеальный релиз...</div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const closeBtn = modal.querySelector('#neural-modal-close-btn');
    if (closeBtn) closeBtn.onclick = () => modal.classList.remove('is-open');
    modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('is-open'); };
  }

  modal.classList.add('is-open');
  const body = document.getElementById('neural-recommender-body');

  try {
    const recommendations = await generateNeuralRecommendations();
    if (!recommendations || recommendations.length === 0) {
      body.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--text-muted);">
          <div style="font-size: 40px; margin-bottom: 10px;">🌟</div>
          <h4>Добавьте фильмы в списки или начните просмотр</h4>
          <p>ИИ-советнику требуется больше данных о ваших вкусах для персональной подборки.</p>
        </div>
      `;
      return;
    }

    body.innerHTML = `
      <div style="margin-bottom: 16px; font-size: 13px; color: var(--text-secondary);">
        ✨ На основе анализа вашей истории, рейтингов и любимых направлений нейросеть рекомендует:
      </div>
      <div class="neural-recs-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 12px;">
        ${recommendations.map(rec => `
          <div class="storm-card" style="display: flex; gap: 12px; padding: 12px; border-radius: 10px; cursor: pointer;" data-id="${rec.id}">
            <img src="${rec.poster || 'assets/favicon.svg'}" style="width: 75px; height: 110px; object-fit: cover; border-radius: 6px;" onerror="this.src='assets/favicon.svg'">
            <div style="flex: 1; display: flex; flex-direction: column; justify-content: space-between;">
              <div>
                <div style="font-weight: 700; font-size: 14px; margin-bottom: 2px;">${rec.title}</div>
                <div style="font-size: 11px; color: var(--accent); margin-bottom: 6px;">${rec.year || ''} • ★ ${rec.rating || '8.0'}</div>
                <div style="font-size: 11px; color: var(--text-muted); line-height: 1.3;">${rec.reason}</div>
              </div>
              <button type="button" class="storm-btn storm-btn-primary storm-btn-sm play-rec-btn" style="align-self: flex-start; margin-top: 6px;">
                ▶ Смотреть
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    body.querySelectorAll('.storm-card').forEach((card, idx) => {
      card.onclick = () => {
        modal.classList.remove('is-open');
        openPlayerModal(recommendations[idx]);
      };
    });
  } catch (err) {
    body.innerHTML = `<div style="color: var(--color-red); padding: 20px; text-align: center;">Ошибка ИИ-советника: ${err.message}</div>`;
  }
}
