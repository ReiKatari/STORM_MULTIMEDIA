/* ==========================================================================
   STORM MULTIMEDIA - СИСТЕМА РЕЦЕНЗИЙ И ОТЗЫВОВ СО СПОЙЛЕР-БЛОКАМИ
   Markdown разметка, скрытие спойлеров под блюр и рейтинг 1-10 звезд
   ========================================================================== */

import { getUser, showToast } from './auth.js';
import { trackClientAction } from './achievements.js';

// Парсер Markdown и скрытия спойлеров
export function parseReviewMarkdown(text) {
  if (!text) return '';

  let html = text
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

  // Цитаты: &gt; цитата
  html = html.replace(/^&gt;\s*(.+)$/gm, '<blockquote class="review-quote">$1</blockquote>');

  // Переносы строк
  html = html.replace(/\n/g, '<br>');

  return html;
}

export async function fetchReviews(mediaId, source) {
  try {
    const token = localStorage.getItem('storm_token');
    const res = await fetch(`/api/reviews?mediaId=${encodeURIComponent(mediaId)}&source=${encodeURIComponent(source)}`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    console.error('Ошибка получения рецензий:', err);
    return [];
  }
}

export async function submitReview(mediaItem, { title, rating, content }) {
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
  if (!user) {
    showToast('Оценивать отзывы могут только зарегистрированные пользователи', 'warning');
    const authModal = document.getElementById('auth-modal');
    if (authModal) authModal.classList.add('is-open');
    return null;
  }

  try {
    const token = localStorage.getItem('storm_token');
    const res = await fetch(`/api/reviews/${reviewId}/like`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ is_like: isLike })
    });

    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error('Ошибка голосования за рецензию:', err);
    return null;
  }
}

export async function renderReviewsSection(containerElement, mediaItem) {
  if (!containerElement) return;

  const reviews = await fetchReviews(mediaItem.id, mediaItem.source);
  const user = getUser();

  containerElement.innerHTML = `
    <div class="reviews-section">
      <div class="reviews-header">
        <h4 class="reviews-title">Рецензии и отзывы зрителей (${reviews.length})</h4>
        <button class="storm-btn storm-btn-primary storm-btn-sm" id="write-review-btn">
          ✍️ Написать рецензию
        </button>
      </div>

      <!-- Форма создания рецензии -->
      <div class="review-compose-card" id="review-compose-card" style="display: none;">
        <h5 style="margin: 0 0 12px 0; font-size: 15px; font-weight: 800;">Новая рецензия</h5>

        <!-- Выбор оценки в звездах (1-10) -->
        <div class="rating-stars-picker" style="margin-bottom: 12px;">
          <span style="font-size: 13px; font-weight: 700; margin-right: 8px;">Ваша оценка:</span>
          <div class="stars-row" id="stars-picker-row">
            ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(star => `
              <button type="button" class="star-btn ${star <= 10 ? 'selected' : ''}" data-value="${star}">★</button>
            `).join('')}
          </div>
          <span id="star-rating-label" style="font-weight: 800; color: var(--color-amber); margin-left: 8px;">10 / 10</span>
        </div>

        <input type="text" class="storm-input" id="review-title-input" placeholder="Заголовок рецензии (необязательно)" style="margin-bottom: 10px;">

        <!-- Панель быстрого форматирования Markdown и спойлеров -->
        <div class="review-compose-toolbar" style="display: flex; gap: 8px; margin-bottom: 8px; flex-wrap: wrap;">
          <button type="button" class="storm-btn storm-btn-sm storm-btn-secondary" id="btn-insert-spoiler" title="Скрыть выделенный текст под спойлер">
            ⚠️ Спойлер
          </button>
          <button type="button" class="storm-btn storm-btn-sm storm-btn-secondary" id="btn-insert-bold" title="Жирный шрифт">
            <strong>B</strong>
          </button>
          <button type="button" class="storm-btn storm-btn-sm storm-btn-secondary" id="btn-insert-italic" title="Курсив">
            <em>I</em>
          </button>
          <button type="button" class="storm-btn storm-btn-sm storm-btn-secondary" id="btn-insert-quote" title="Цитата">
            ❝ Цитата
          </button>
        </div>

        <div style="position: relative;">
          <textarea class="storm-input review-textarea" id="review-content-input" placeholder="Поделитесь впечатлениями... Для скрытия спойлеров выделите текст и нажмите «⚠️ Спойлер»" rows="4"></textarea>
          <div style="display: flex; gap: 8px; margin-top: 6px; font-size: 11px; color: var(--text-muted);">
            <span>💡 Подсказка: кнопка «⚠️ Спойлер» или <code>||спойлер||</code> скрывает сюжетные повороты под интерактивный блюр</span>
          </div>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 12px;">
          <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm" id="cancel-review-btn">Отмена</button>
          <button type="button" class="storm-btn storm-btn-primary storm-btn-sm" id="submit-review-btn">Опубликовать отзыв</button>
        </div>
      </div>

      <!-- Список опубликованных рецензий -->
      <div class="reviews-list" id="reviews-list-container">
        ${reviews.length === 0 ? `
          <div class="reviews-empty-state">
            <span>🎭</span>
            <p>Пока нет ни одного отзыва. Будьте первым, кто поделится своим мнением!</p>
          </div>
        ` : reviews.map(rev => `
          <div class="review-item-card" data-id="${rev.id}">
            <div class="review-item-header">
              <div style="display: flex; align-items: center; gap: 10px;">
                <img src="${rev.avatar || 'assets/favicon.svg'}" alt="Avatar" class="review-author-avatar">
                <div>
                  <div class="review-author-name">${rev.username}</div>
                  <div class="review-date">${new Date(rev.created_at).toLocaleDateString('ru-RU')}</div>
                </div>
              </div>
              <div class="review-rating-badge">
                ★ ${rev.rating} / 10
              </div>
            </div>

            ${rev.title ? `<h5 class="review-item-title">${rev.title}</h5>` : ''}

            <div class="review-item-content">
              ${parseReviewMarkdown(rev.content)}
            </div>

            <div class="review-item-footer">
              <div class="review-likes-group">
                <button class="review-like-btn ${rev.user_reaction === 'like' ? 'active' : ''}" data-id="${rev.id}" data-type="like">
                  👍 <span class="like-count">${rev.likes_count}</span>
                </button>
                <button class="review-like-btn ${rev.user_reaction === 'dislike' ? 'active' : ''}" data-id="${rev.id}" data-type="dislike">
                  👎 <span class="dislike-count">${rev.dislikes_count}</span>
                </button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  // Обработчики формы
  const writeBtn = containerElement.querySelector('#write-review-btn');
  const composeCard = containerElement.querySelector('#review-compose-card');
  const cancelBtn = containerElement.querySelector('#cancel-review-btn');
  const submitBtn = containerElement.querySelector('#submit-review-btn');
  let selectedRating = 10;

  if (writeBtn && composeCard) {
    writeBtn.onclick = () => {
      if (!getUser()) {
        showToast('Рецензии могут писать только зарегистрированные пользователи', 'warning');
        const authModal = document.getElementById('auth-modal');
        if (authModal) authModal.classList.add('is-open');
        return;
      }
      composeCard.style.display = composeCard.style.display === 'none' ? 'block' : 'none';
    };
  }

  if (cancelBtn && composeCard) {
    cancelBtn.onclick = () => {
      composeCard.style.display = 'none';
    };
  }

  // Вспомогательная функция для обрамления текста в поле ввода
  const contentInput = containerElement.querySelector('#review-content-input');
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
  }

  const spoilerBtn = containerElement.querySelector('#btn-insert-spoiler');
  if (spoilerBtn) {
    spoilerBtn.onclick = () => wrapTextSelection('||', '||', 'текст спойлера');
  }

  const boldBtn = containerElement.querySelector('#btn-insert-bold');
  if (boldBtn) {
    boldBtn.onclick = () => wrapTextSelection('**', '**', 'жирный текст');
  }

  const italicBtn = containerElement.querySelector('#btn-insert-italic');
  if (italicBtn) {
    italicBtn.onclick = () => wrapTextSelection('*', '*', 'курсив');
  }

  const quoteBtn = containerElement.querySelector('#btn-insert-quote');
  if (quoteBtn) {
    quoteBtn.onclick = () => wrapTextSelection('> ', '', 'цитата');
  }

  // Выбор звезд
  const starBtns = containerElement.querySelectorAll('.star-btn');
  const ratingLabel = containerElement.querySelector('#star-rating-label');
  starBtns.forEach(btn => {
    btn.onclick = () => {
      selectedRating = parseInt(btn.dataset.value, 10);
      if (ratingLabel) ratingLabel.textContent = `${selectedRating} / 10`;
      starBtns.forEach(b => {
        const val = parseInt(b.dataset.value, 10);
        b.classList.toggle('selected', val <= selectedRating);
      });
    };
  });

  if (submitBtn) {
    submitBtn.onclick = async () => {
      const titleInput = containerElement.querySelector('#review-title-input');
      const contentInput = containerElement.querySelector('#review-content-input');
      const content = contentInput.value.trim();

      if (!content) {
        showToast('Пожалуйста, напишите текст отзыва', 'warning');
        return;
      }

      submitBtn.disabled = true;
      const res = await submitReview(mediaItem, {
        title: titleInput.value.trim(),
        rating: selectedRating,
        content
      });
      submitBtn.disabled = false;

      if (res) {
        renderReviewsSection(containerElement, mediaItem);
      }
    };
  }

  // Лайки / дизлайки
  containerElement.querySelectorAll('.review-like-btn').forEach(btn => {
    btn.onclick = async () => {
      const reviewId = btn.dataset.id;
      const isLike = btn.dataset.type === 'like';
      const result = await likeReview(reviewId, isLike);
      if (result) {
        const card = btn.closest('.review-item-card');
        if (card) {
          const likeBtn = card.querySelector('[data-type="like"]');
          const dislikeBtn = card.querySelector('[data-type="dislike"]');
          if (likeBtn) {
            likeBtn.querySelector('.like-count').textContent = result.likes_count;
            likeBtn.classList.toggle('active', result.user_reaction === 'like');
          }
          if (dislikeBtn) {
            dislikeBtn.querySelector('.dislike-count').textContent = result.dislikes_count;
            dislikeBtn.classList.toggle('active', result.user_reaction === 'dislike');
          }
        }
      }
    };
  });
}
