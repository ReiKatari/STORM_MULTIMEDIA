/* ==========================================================================
   STORM MULTIMEDIA - ПРЕМИАЛЬНАЯ СИСТЕМА РЕЦЕНЗИЙ И ОТЗЫВОВ
   3D Elevated дизайн, интерактивная гистограмма оценок, фильтрация по тональности,
   сортировка, спойлер-блоки и верифицированные рецензии кинокритиков
   ========================================================================== */

import { getUser, showToast } from './auth.js';
import { trackClientAction } from './achievements.js';

// Форматирование даты строго по стандарту dd.MM.yyyy (Правило 5.2)
function formatStormDate(timestamp) {
  const d = new Date(timestamp || Date.now());
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}.${month}.${year}`;
}

// Получение инициалов для стилизованного аватара при отсутствии фото
function getInitials(name = '') {
  const parts = String(name).trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return (name[0] || 'ST').toUpperCase();
}

// Парсер Markdown, форматирования, списков, спойлеров и таймкодов
export function parseReviewMarkdown(text) {
  if (!text) return '';

  let html = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Спойлеры: ||текст|| или &lt;spoiler&gt;текст&lt;/spoiler&gt;
  html = html.replace(/\|\|([\s\S]+?)\|\|/g, '<span class="spoiler-blur" onclick="this.classList.toggle(\'unblurred\')" title="Нажмите, чтобы показать спойлер">$1</span>');
  html = html.replace(/&lt;spoiler&gt;([\s\S]+?)&lt;\/spoiler&gt;/g, '<span class="spoiler-blur" onclick="this.classList.toggle(\'unblurred\')" title="Нажмите, чтобы показать спойлер">$1</span>');

  // Жирный шрифт: **текст**
  html = html.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');

  // Курсив: *текст*
  html = html.replace(/\*([\s\S]+?)\*/g, '<em>$1</em>');

  // Подчеркнутый: <u>текст</u> или __текст__
  html = html.replace(/&lt;u&gt;([\s\S]+?)&lt;\/u&gt;/gi, '<u>$1</u>');
  html = html.replace(/__([\s\S]+?)__/g, '<u>$1</u>');

  // Зачеркнутый: ~~текст~~
  html = html.replace(/~~([\s\S]+?)~~/g, '<s>$1</s>');

  // Ссылки: [название](url)
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:var(--accent);text-decoration:underline;font-weight:600;">$1</a>');

  // Цитаты: &gt; цитата
  html = html.replace(/^&gt;\s*(.+)$/gm, '<blockquote class="review-quote">$1</blockquote>');

  // Интерактивные таймкоды: [hh:mm:ss] или [mm:ss]
  html = html.replace(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g, '<span class="review-timecode-link" data-timecode="$1" title="Перемотать на $1">⏱️ $1</span>');

  // Маркированные списки: - пункт
  html = html.replace(/^[ \t]*[-*]\s+(.+)$/gm, '<li style="margin-left: 18px; margin-bottom: 3px;">$1</li>');

  // Нумерованные списки: 1. пункт
  html = html.replace(/^[ \t]*(\d+)\.\s+(.+)$/gm, '<li style="margin-left: 18px; margin-bottom: 3px;" value="$1">$2</li>');

  // Переносы строк
  html = html.replace(/\n/g, '<br>');

  return html;
}

// Реальные рецензии пользователей (без генерации вымышленных данных)
function getCuratedSeedReviews(mediaItem) {
  return [];
}

export async function fetchReviews(mediaId, source, mediaItem = null) {
  let serverReviews = [];
  try {
    const token = localStorage.getItem('storm_token');
    const res = await fetch(`/api/reviews?mediaId=${encodeURIComponent(mediaId)}&source=${encodeURIComponent(source)}`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
    if (res.ok) {
      serverReviews = await res.json();
    }
  } catch (err) {
    console.warn('[STORM Reviews] Ошибка обращения к API рецензий:', err.message);
  }

  // Подмешиваем проверенные рецензии, если в базе еще мало отзывов
  const curated = getCuratedSeedReviews(mediaItem || { id: mediaId, source });
  const localVotes = JSON.parse(localStorage.getItem('storm_review_votes') || '{}');

  // Обогащаем локальными голосами
  const applyVotes = (r) => {
    const v = localVotes[r.id];
    if (v) {
      return {
        ...r,
        user_reaction: v.reaction,
        likes_count: r.likes_count + (v.likeDelta || 0),
        dislikes_count: r.dislikes_count + (v.dislikeDelta || 0)
      };
    }
    return r;
  };

  const combined = [
    ...serverReviews.map(applyVotes),
    ...curated.filter(c => !serverReviews.some(s => s.id === c.id)).map(applyVotes)
  ];

  return combined;
}

export async function submitReview(mediaItem, { title, rating, content, tone }) {
  const user = getUser();
  if (!user) {
    showToast('Рецензии могут писать только зарегистрированные пользователи', 'warning');
    const authModal = document.getElementById('auth-modal');
    if (authModal) authModal.classList.add('is-open');
    return null;
  }

  try {
    const token = localStorage.getItem('storm_token');
    const res = await fetch('/api/reviews', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        media_id: mediaItem.id,
        source: mediaItem.source,
        title,
        rating,
        tone: tone || (rating >= 8 ? 'positive' : (rating >= 5 ? 'neutral' : 'negative')),
        content
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Не удалось опубликовать рецензию');
    }

    const review = await res.json();
    showToast('Рецензия успешно опубликована!', 'success');
    trackClientAction('write_review');
    return review;
  } catch (err) {
    showToast(err.message, 'error');
    return null;
  }
}

export async function likeReview(reviewId, isLike) {
  const user = getUser();
  const token = localStorage.getItem('storm_token');

  // Локальное мгновенное сохранение реакции (работает даже для гостей и оффлайн)
  const localVotes = JSON.parse(localStorage.getItem('storm_review_votes') || '{}');
  const prev = localVotes[reviewId];

  let reaction = isLike ? 'like' : 'dislike';
  let likeDelta = 0;
  let dislikeDelta = 0;

  if (prev && prev.reaction === reaction) {
    // Отмена реакции
    delete localVotes[reviewId];
    if (isLike) likeDelta = -1;
    else dislikeDelta = -1;
    reaction = null;
  } else {
    if (prev?.reaction === 'like') likeDelta = -1;
    if (prev?.reaction === 'dislike') dislikeDelta = -1;
    if (isLike) likeDelta += 1;
    else dislikeDelta += 1;
    localVotes[reviewId] = { reaction, likeDelta, dislikeDelta };
  }
  localStorage.setItem('storm_review_votes', JSON.stringify(localVotes));

  if (token && user) {
    try {
      fetch(`/api/reviews/${reviewId}/like`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ is_like: isLike })
      }).catch(() => {});
    } catch (_) {}
  }

  return {
    success: true,
    user_reaction: reaction,
    likeDelta,
    dislikeDelta
  };
}

// Рендеринг основного блока рецензий и аналитики
export async function renderReviewsSection(containerElement, mediaItem) {
  if (!containerElement) return;

  const rawReviews = await fetchReviews(mediaItem.id, mediaItem.source, mediaItem);
  let allReviews = [...rawReviews];
  let activeFilter = 'all';
  let activeSort = 'useful';

  // Расчет аналитических показателей
  const calculateMetrics = (reviews) => {
    const total = reviews.length;
    if (total === 0) {
      return {
        avg: '—',
        recPercent: 0,
        total: 0,
        dist: { excellent: 0, good: 0, average: 0, poor: 0 },
        distPerc: { excellent: 0, good: 0, average: 0, poor: 0 }
      };
    }

    const sum = reviews.reduce((acc, r) => acc + (Number(r.rating) || 8), 0);
    const avg = (sum / total).toFixed(1);
    const positiveCount = reviews.filter(r => (Number(r.rating) || 0) >= 7).length;
    const recPercent = Math.round((positiveCount / total) * 100);

    const dist = {
      excellent: reviews.filter(r => Number(r.rating) >= 9).length,
      good: reviews.filter(r => Number(r.rating) >= 7 && Number(r.rating) < 9).length,
      average: reviews.filter(r => Number(r.rating) >= 5 && Number(r.rating) < 7).length,
      poor: reviews.filter(r => Number(r.rating) < 5).length
    };

    const distPerc = {
      excellent: Math.round((dist.excellent / total) * 100),
      good: Math.round((dist.good / total) * 100),
      average: Math.round((dist.average / total) * 100),
      poor: Math.round((dist.poor / total) * 100)
    };

    return { avg, recPercent, total, dist, distPerc };
  };

  const metrics = calculateMetrics(allReviews);

  // Склонение слова "рецензия / отзыв"
  const getReviewWord = (n) => {
    const num = Math.abs(n) % 100;
    const n1 = num % 10;
    if (num > 10 && num < 20) return 'рецензий';
    if (n1 > 1 && n1 < 5) return 'рецензии';
    if (n1 === 1) return 'рецензия';
    return 'рецензий';
  };

  containerElement.innerHTML = `
    <div class="reviews-section">
      <div class="reviews-header">
        <h4 class="reviews-title">
          <span>💬</span> Рецензии зрителей (${metrics.total})
        </h4>
        <button class="storm-btn storm-btn-primary storm-btn-sm" id="write-review-btn">
          ✍️ Написать рецензию
        </button>
      </div>

      ${metrics.total > 0 ? `
      <!-- Сводная карточка аналитики оценок и гистограммы -->
      <div class="reviews-summary-card">
        <div class="reviews-score-box">
          <div class="reviews-big-score">
            ★ ${metrics.avg} <span>/ 10</span>
          </div>
          <div class="reviews-rec-badge">
            👍 ${metrics.recPercent}% рекомендуют
          </div>
          <div class="reviews-total-counter">
            На основе ${metrics.total} ${getReviewWord(metrics.total)}
          </div>
        </div>

        <div class="reviews-histogram">
          <div class="reviews-hist-row">
            <span class="reviews-hist-label">9-10 ★ Шедевр</span>
            <div class="reviews-hist-track">
              <div class="reviews-hist-bar grade-excellent" style="width: ${metrics.distPerc.excellent}%;"></div>
            </div>
            <span class="reviews-hist-count">${metrics.dist.excellent}</span>
          </div>
          <div class="reviews-hist-row">
            <span class="reviews-hist-label">7-8 ★ Хорошо</span>
            <div class="reviews-hist-track">
              <div class="reviews-hist-bar grade-good" style="width: ${metrics.distPerc.good}%;"></div>
            </div>
            <span class="reviews-hist-count">${metrics.dist.good}</span>
          </div>
          <div class="reviews-hist-row">
            <span class="reviews-hist-label">5-6 ★ Средне</span>
            <div class="reviews-hist-track">
              <div class="reviews-hist-bar grade-average" style="width: ${metrics.distPerc.average}%;"></div>
            </div>
            <span class="reviews-hist-count">${metrics.dist.average}</span>
          </div>
          <div class="reviews-hist-row">
            <span class="reviews-hist-label">1-4 ★ Слабо</span>
            <div class="reviews-hist-track">
              <div class="reviews-hist-bar grade-poor" style="width: ${metrics.distPerc.poor}%;"></div>
            </div>
            <span class="reviews-hist-count">${metrics.dist.poor}</span>
          </div>
        </div>
      </div>
      ` : `
      <!-- Информационный блок при отсутствии рецензий -->
      <div class="reviews-empty-callout" style="padding: 24px 20px; text-align: center; background: var(--bg-tertiary); border: 1px dashed var(--border-subtle); border-radius: 14px; margin-bottom: 20px;">
        <div style="font-size: 34px; margin-bottom: 8px;">🎭</div>
        <h5 style="margin: 0 0 6px 0; font-size: 15px; font-weight: 800; color: var(--text-primary);">Пока нет отзывов зрителей</h5>
        <p style="margin: 0 0 16px 0; font-size: 13px; color: var(--text-secondary); line-height: 1.5;">Поделитесь своими впечатлениями о картине первым! Нажмите кнопку ниже, чтобы опубликовать рецензию.</p>
        <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="empty-callout-write-btn">
          ✍️ Написать рецензию
        </button>
      </div>
      `}

      <!-- Панель фильтров по тональности и сортировки -->
      <div class="reviews-toolbar">
        <div class="reviews-filter-chips">
          <button type="button" class="reviews-chip active" data-filter="all">
            Все (${allReviews.length})
          </button>
          <button type="button" class="reviews-chip" data-filter="positive">
            Положительные 👍 (${allReviews.filter(r => Number(r.rating) >= 8).length})
          </button>
          <button type="button" class="reviews-chip" data-filter="neutral">
            Нейтральные ⚖️ (${allReviews.filter(r => Number(r.rating) >= 5 && Number(r.rating) <= 7).length})
          </button>
          <button type="button" class="reviews-chip" data-filter="critics">
            Критики 🏆 (${allReviews.filter(r => r.role === 'critic').length})
          </button>
        </div>

        <div class="reviews-sort-wrap">
          <span>Сортировка:</span>
          <select class="reviews-sort-select" id="reviews-sort-select">
            <option value="useful">По полезности</option>
            <option value="date">Сначала новые</option>
            <option value="rating_desc">Высокая оценка</option>
            <option value="rating_asc">Низкая оценка</option>
          </select>
        </div>
      </div>

      <!-- Форма создания рецензии в стиле Luno с расширенным WYSIWYG -->
      <div class="review-compose-card" id="review-compose-card" style="display: none;">
        <h5 style="margin: 0 0 14px 0; font-size: 16px; font-weight: 800; color: #00f0ff; display: flex; align-items: center; gap: 8px;">
          <span>✍️</span> Ваша рецензия на «${mediaItem.title || 'релиз'}»
        </h5>

        <!-- Выбор тональности отзыва (Luno Tone Selector) -->
        <div class="review-tone-selector" role="radiogroup" aria-label="Тон отзыва">
          <button type="button" class="review-tone-btn positive active" data-tone="positive" title="Рекомендую к просмотру">
            🟢 Рекомендует
          </button>
          <button type="button" class="review-tone-btn neutral" data-tone="neutral" title="Нейтральное впечатление">
            ⚖️ Нейтрально
          </button>
          <button type="button" class="review-tone-btn negative" data-tone="negative" title="Не рекомендую к просмотру">
            🔴 Не рекомендует
          </button>
        </div>

        <div class="rating-stars-picker" style="margin-bottom: 14px; display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 13px; font-weight: 700;">Ваша оценка:</span>
          <div class="stars-row" id="stars-picker-row">
            ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(star => `
              <button type="button" class="star-btn ${star <= 10 ? 'selected' : ''}" data-value="${star}">★</button>
            `).join('')}
          </div>
          <span id="star-rating-label" style="font-weight: 900; color: #ffb703; font-size: 16px;">10 / 10</span>
        </div>

        <input type="text" class="storm-input" id="review-title-input" placeholder="Заголовок рецензии (например: Впечатляющая актерская игра и режиссура)" style="margin-bottom: 12px;">

        <!-- Контейнер расширенного WYSIWYG-редактора -->
        <div class="wysiwyg-container">
          <div class="wysiwyg-toolbar">
            <button type="button" class="wysiwyg-btn" id="btn-insert-bold" title="Жирный шрифт (Ctrl+B)"><strong>B</strong></button>
            <button type="button" class="wysiwyg-btn" id="btn-insert-italic" title="Курсив (Ctrl+I)"><em>I</em></button>
            <button type="button" class="wysiwyg-btn" id="btn-insert-underline" title="Подчеркнутый"><u>U</u></button>
            <button type="button" class="wysiwyg-btn" id="btn-insert-strike" title="Зачеркнутый"><s>S</s></button>
            <button type="button" class="wysiwyg-btn" id="btn-insert-quote" title="Цитата">❝ Цитата</button>
            <button type="button" class="wysiwyg-btn" id="btn-insert-spoiler" title="Скрыть сюжет под спойлер">⚠️ Спойлер</button>
            <button type="button" class="wysiwyg-btn" id="btn-insert-link" title="Вставить ссылку">🔗 Ссылка</button>
            <button type="button" class="wysiwyg-btn" id="btn-insert-list" title="Маркированный список">📋 Список</button>
            <button type="button" class="wysiwyg-btn" id="btn-insert-numlist" title="Нумерованный список">🔢 1.2.3</button>
            <button type="button" class="wysiwyg-btn" id="btn-insert-timecode" title="Вставить таймкод видео">⏱️ Таймкод</button>
            
            <div class="wysiwyg-tabs">
              <button type="button" class="wysiwyg-tab-btn active" id="tab-editor-btn">Редактор</button>
              <button type="button" class="wysiwyg-tab-btn" id="tab-preview-btn">Предпросмотр</button>
            </div>
          </div>
          <textarea class="storm-input wysiwyg-editor-area" id="review-content-input" placeholder="Поделитесь впечатлениями о сюжете, режиссуре, актерской игре и визуале... Для скрытия ключевых сюжетных поворотов выделите текст и нажмите «⚠️ Спойлер»" rows="5" maxlength="3000"></textarea>
          <div class="wysiwyg-preview-area" id="review-preview-area"></div>
        </div>

        <div class="review-compose-foot">
          <span class="review-char-counter" id="review-char-counter">0 / 3000</span>
          <div style="display: flex; gap: 10px;">
            <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="cancel-review-btn">Отмена</button>
            <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="submit-review-btn">Опубликовать отзыв</button>
          </div>
        </div>
      </div>

      <!-- Список опубликованных рецензий -->
      <div class="reviews-list" id="reviews-list-container"></div>
    </div>
  `;

  const listContainer = containerElement.querySelector('#reviews-list-container');

  // Функция фильтрации и отрисовки карточек
  const renderList = () => {
    if (!listContainer) return;

    let filtered = [...allReviews];

    // Фильтрация
    if (activeFilter === 'positive') {
      filtered = filtered.filter(r => (r.tone === 'positive') || (!r.tone && Number(r.rating) >= 8));
    } else if (activeFilter === 'neutral') {
      filtered = filtered.filter(r => (r.tone === 'neutral') || (!r.tone && Number(r.rating) >= 5 && Number(r.rating) <= 7));
    } else if (activeFilter === 'negative') {
      filtered = filtered.filter(r => (r.tone === 'negative') || (!r.tone && Number(r.rating) < 5));
    } else if (activeFilter === 'critics') {
      filtered = filtered.filter(r => r.role === 'critic');
    }

    // Сортировка
    if (activeSort === 'useful') {
      filtered.sort((a, b) => (b.likes_count || 0) - (a.likes_count || 0));
    } else if (activeSort === 'date') {
      filtered.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    } else if (activeSort === 'rating_desc') {
      filtered.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    } else if (activeSort === 'rating_asc') {
      filtered.sort((a, b) => (a.rating || 0) - (b.rating || 0));
    }

    if (filtered.length === 0) {
      listContainer.innerHTML = `
        <div class="reviews-empty-state">
          <span>🎭</span>
          <p>В этой категории пока нет отзывов. Станьте первым, кто поделится своим взглядом!</p>
        </div>
      `;
      return;
    }

    listContainer.innerHTML = filtered.map(rev => {
      const rating = Number(rev.rating) || 8;
      const effectiveTone = rev.tone || (rating >= 8 ? 'positive' : (rating >= 5 ? 'neutral' : 'negative'));
      const sentimentLabel = effectiveTone === 'positive' ? '🟢 Рекомендует' : (effectiveTone === 'neutral' ? '⚖️ Нейтрально' : '🔴 Не рекомендует');
      const roleBadgeClass = rev.role === 'critic' ? 'critic' : (rev.role === 'editorial' ? 'editorial' : 'viewer');
      const roleLabel = rev.role_label || (rev.role === 'critic' ? '🏆 Кинокритик' : '⭐ Зритель');
      const dateFormatted = formatStormDate(rev.created_at);

      return `
        <div class="review-item-card" data-id="${rev.id}">
          <div class="review-item-header">
            <div class="review-author-wrap">
              ${rev.avatar ? `
                <img src="${rev.avatar}" alt="Avatar" class="review-author-avatar" onerror="this.outerHTML='<div class=\\'review-avatar-initials\\'>${getInitials(rev.username)}</div>'">
              ` : `
                <div class="review-avatar-initials">${getInitials(rev.username)}</div>
              `}
              <div class="review-author-meta">
                <div class="review-author-name-row">
                  <span class="review-author-name">${rev.username || 'Пользователь'}</span>
                  <span class="review-role-badge ${roleBadgeClass}">${roleLabel}</span>
                </div>
                <div class="review-date">${dateFormatted}</div>
              </div>
            </div>

            <div class="review-badges-row">
              <span class="review-tone-badge ${effectiveTone}">${sentimentLabel}</span>
              <div class="review-rating-badge">★ ${rating} / 10</div>
            </div>
          </div>

          ${rev.title ? `<h5 class="review-item-title">${rev.title}</h5>` : ''}

          <div class="review-item-content">
            ${parseReviewMarkdown(rev.content)}
          </div>

          <div class="review-item-footer">
            <span class="review-helpful-label">Отзыв был полезен?</span>
            <div class="review-likes-group">
              <button class="review-like-btn ${rev.user_reaction === 'like' ? 'active' : ''}" data-id="${rev.id}" data-type="like">
                👍 <span class="like-count">${rev.likes_count || 0}</span>
              </button>
              <button class="review-like-btn ${rev.user_reaction === 'dislike' ? 'active' : ''}" data-id="${rev.id}" data-type="dislike">
                👎 <span class="dislike-count">${rev.dislikes_count || 0}</span>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Навешиваем обработчики лайков
    listContainer.querySelectorAll('.review-like-btn').forEach(btn => {
      btn.onclick = async () => {
        const reviewId = btn.dataset.id;
        const isLike = btn.dataset.type === 'like';
        const res = await likeReview(reviewId, isLike);
        if (res && res.success) {
          const targetReview = allReviews.find(r => String(r.id) === String(reviewId));
          if (targetReview) {
            targetReview.user_reaction = res.user_reaction;
            targetReview.likes_count = (targetReview.likes_count || 0) + res.likeDelta;
            targetReview.dislikes_count = (targetReview.dislikes_count || 0) + res.dislikeDelta;
          }
          renderList();
        }
      };
    });

    // Навешиваем обработчики кликов по таймкодам
    listContainer.querySelectorAll('.review-timecode-link').forEach(tc => {
      tc.onclick = (e) => {
        e.stopPropagation();
        const timecode = tc.dataset.timecode;
        if (timecode && window.seekPlayerToTimecode) {
          window.seekPlayerToTimecode(timecode);
        } else if (timecode) {
          showToast(`Таймкод: ${timecode}`, 'info');
        }
      };
    });
  };

  // Первичная отрисовка списка
  renderList();

  // Обработчики фильтров
  containerElement.querySelectorAll('.reviews-chip').forEach(chip => {
    chip.onclick = () => {
      containerElement.querySelectorAll('.reviews-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeFilter = chip.dataset.filter;
      renderList();
    };
  });

  // Обработчик сортировки
  const sortSelect = containerElement.querySelector('#reviews-sort-select');
  if (sortSelect) {
    sortSelect.onchange = () => {
      activeSort = sortSelect.value;
      renderList();
    };
  }

  // Обработчики формы создания
  const writeBtn = containerElement.querySelector('#write-review-btn');
  const composeCard = containerElement.querySelector('#review-compose-card');
  const emptyCalloutWriteBtn = containerElement.querySelector('#empty-callout-write-btn');
  const cancelBtn = containerElement.querySelector('#cancel-review-btn');
  const submitBtn = containerElement.querySelector('#submit-review-btn');
  let selectedRating = 10;
  let selectedTone = 'positive';

  const openCompose = () => {
    if (!getUser()) {
      showToast('Рецензии могут писать только зарегистрированные пользователи', 'warning');
      const authModal = document.getElementById('auth-modal');
      if (authModal) authModal.classList.add('is-open');
      return;
    }
    composeCard.style.display = composeCard.style.display === 'none' ? 'block' : 'none';
    if (composeCard.style.display === 'block') {
      composeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  if (writeBtn && composeCard) {
    writeBtn.onclick = openCompose;
  }
  if (emptyCalloutWriteBtn && composeCard) {
    emptyCalloutWriteBtn.onclick = openCompose;
  }

  if (cancelBtn && composeCard) {
    cancelBtn.onclick = () => {
      composeCard.style.display = 'none';
    };
  }

  // Выбор тональности отзыва (Luno style)
  const toneBtns = containerElement.querySelectorAll('.review-tone-btn');
  toneBtns.forEach(btn => {
    btn.onclick = () => {
      toneBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedTone = btn.dataset.tone;

      // Автоматическая подсказка оценки по тональности
      if (selectedTone === 'positive' && selectedRating < 8) {
        updateRating(10);
      } else if (selectedTone === 'neutral' && (selectedRating < 5 || selectedRating > 7)) {
        updateRating(6);
      } else if (selectedTone === 'negative' && selectedRating >= 5) {
        updateRating(3);
      }
    };
  });

  // Вспомогательная функция для вставки тегов
  const contentInput = containerElement.querySelector('#review-content-input');
  const previewArea = containerElement.querySelector('#review-preview-area');
  const charCounter = containerElement.querySelector('#review-char-counter');

  function updateCharCount() {
    if (!contentInput || !charCounter) return;
    const len = contentInput.value.length;
    charCounter.textContent = `${len} / 3000`;
    charCounter.classList.toggle('near-limit', len >= 2800);
  }

  if (contentInput) {
    contentInput.oninput = updateCharCount;
    contentInput.onkeydown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        wrapTextSelection('**', '**', 'жирный текст');
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
        e.preventDefault();
        wrapTextSelection('*', '*', 'курсив');
      }
    };
  }

  function wrapTextSelection(prefix, suffix, placeholder) {
    if (!contentInput) return;
    const start = contentInput.selectionStart;
    const end = contentInput.selectionEnd;
    const val = contentInput.value;
    const selected = val.substring(start, end) || placeholder;
    const replacement = prefix + selected + suffix;
    contentInput.value = val.substring(0, start) + replacement + val.substring(end);
    contentInput.focus();
    const selStart = start + prefix.length;
    const selEnd = selStart + selected.length;
    contentInput.setSelectionRange(selStart, selEnd);
    updateCharCount();
  }

  // Тулбар WYSIWYG
  const bindClick = (id, fn) => {
    const el = containerElement.querySelector(id);
    if (el) el.onclick = fn;
  };

  bindClick('#btn-insert-bold', () => wrapTextSelection('**', '**', 'жирный текст'));
  bindClick('#btn-insert-italic', () => wrapTextSelection('*', '*', 'курсив'));
  bindClick('#btn-insert-underline', () => wrapTextSelection('<u>', '</u>', 'подчеркнутый текст'));
  bindClick('#btn-insert-strike', () => wrapTextSelection('~~', '~~', 'зачеркнутый текст'));
  bindClick('#btn-insert-quote', () => wrapTextSelection('> ', '', 'цитата из фильма'));
  bindClick('#btn-insert-spoiler', () => wrapTextSelection('||', '||', 'текст спойлера'));
  bindClick('#btn-insert-link', () => wrapTextSelection('[', '](https://...)', 'текст ссылки'));
  bindClick('#btn-insert-list', () => wrapTextSelection('\n- ', '', 'пункт списка'));
  bindClick('#btn-insert-numlist', () => wrapTextSelection('\n1. ', '', 'нумерованный пункт'));
  bindClick('#btn-insert-timecode', () => wrapTextSelection('[', ']', '01:24:00'));

  // Переключение вкладок Редактор / Предпросмотр
  const tabEditor = containerElement.querySelector('#tab-editor-btn');
  const tabPreview = containerElement.querySelector('#tab-preview-btn');

  if (tabEditor && tabPreview && contentInput && previewArea) {
    tabEditor.onclick = () => {
      tabEditor.classList.add('active');
      tabPreview.classList.remove('active');
      contentInput.style.display = 'block';
      previewArea.style.display = 'none';
      contentInput.focus();
    };

    tabPreview.onclick = () => {
      tabPreview.classList.add('active');
      tabEditor.classList.remove('active');
      contentInput.style.display = 'none';
      previewArea.style.display = 'block';
      const text = contentInput.value.trim();
      previewArea.innerHTML = text ? parseReviewMarkdown(text) : '<span style="color:var(--text-muted);font-style:italic;">Начните писать в редакторе, чтобы увидеть форматирование...</span>';
    };
  }

  // Выбор звезд
  const starBtns = containerElement.querySelectorAll('.star-btn');
  const ratingLabel = containerElement.querySelector('#star-rating-label');

  function updateRating(rating) {
    selectedRating = rating;
    if (ratingLabel) ratingLabel.textContent = `${selectedRating} / 10`;
    starBtns.forEach(b => {
      const val = parseInt(b.dataset.value, 10);
      b.classList.toggle('selected', val <= selectedRating);
    });
  }

  starBtns.forEach(btn => {
    btn.onclick = () => {
      const val = parseInt(btn.dataset.value, 10);
      updateRating(val);

      // Синхронизация с тональностью
      if (val >= 8 && selectedTone !== 'positive') {
        toneBtns.forEach(b => b.classList.toggle('active', b.dataset.tone === 'positive'));
        selectedTone = 'positive';
      } else if (val >= 5 && val <= 7 && selectedTone !== 'neutral') {
        toneBtns.forEach(b => b.classList.toggle('active', b.dataset.tone === 'neutral'));
        selectedTone = 'neutral';
      } else if (val < 5 && selectedTone !== 'negative') {
        toneBtns.forEach(b => b.classList.toggle('active', b.dataset.tone === 'negative'));
        selectedTone = 'negative';
      }
    };
  });

  if (submitBtn) {
    submitBtn.onclick = async () => {
      const titleInput = containerElement.querySelector('#review-title-input');
      const content = contentInput ? contentInput.value.trim() : '';

      if (!content) {
        showToast('Пожалуйста, напишите текст отзыва', 'warning');
        return;
      }

      submitBtn.disabled = true;
      const res = await submitReview(mediaItem, {
        title: titleInput ? titleInput.value.trim() : '',
        rating: selectedRating,
        tone: selectedTone,
        content
      });
      submitBtn.disabled = false;

      if (res) {
        renderReviewsSection(containerElement, mediaItem);
      }
    };
  }
}
