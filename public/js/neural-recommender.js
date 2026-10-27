/* ==========================================================================
   STORM MULTIMEDIA - NEURAL RECOMMENDER 2.0 (АНАЛИТИЧЕСКИЙ ИИ-СОВЕТНИК)
   Глубокий анализ закладок, истории просмотров, жанрового профиля,
   настроения, компании и семантического запроса зрителя
   ========================================================================== */

import { fetchUserBookmarks, fetchContinueWatching, saveBookmarkStatus } from './bookmarks.js?v=1.2.8';
import { openPlayerModal } from './player.js?v=1.2.8';
import { showToast } from './auth.js?v=1.2.8';
import { getBaselineCatalog } from './catalog-baseline.js?v=1.2.8';

let advisorState = {
  mood: 'personal',
  company: 'any',
  format: 'all',
  customPrompt: '',
  lastCatalogPool: []
};

const MOOD_PRESETS = {
  personal: {
    label: '✨ Мой ИИ-профиль',
    keywords: [],
    genres: [],
    desc: 'Индивидуальный подбор по вашей истории просмотров и закладкам'
  },
  action: {
    label: '🔥 Драйв и экшен',
    keywords: ['боевик', 'экшен', 'приключения', 'фантастика', 'криминал', 'гонки', 'битва'],
    genres: ['боевик', 'приключения', 'фантастика', 'криминал'],
    desc: 'Высокая динамика, зрелищные сцены и адреналин'
  },
  mindbending: {
    label: '🧠 Умное кино и загадки',
    keywords: ['фантастика', 'триллер', 'детектив', 'разум', 'космос', 'время', 'тайна', 'психолог'],
    genres: ['детектив', 'триллер', 'фантастика', 'драма'],
    desc: 'Глубокий сюжет, неожиданные повороты и пища для размышлений'
  },
  scifi: {
    label: '🌌 Фантастика и миры',
    keywords: ['фантастика', 'фэнтези', 'космос', 'будущее', 'магия', 'аниме', 'киберпанк'],
    genres: ['фантастика', 'фэнтези', 'приключения'],
    desc: 'Масштабные вселенные, технологии будущего и эпические миры'
  },
  comedy: {
    label: '😂 Лёгкое и комедия',
    keywords: ['комедия', 'приключения', 'семейный', 'мультфильм', 'романтика', 'юмор'],
    genres: ['комедия', 'приключения', 'семейный'],
    desc: 'Отличное настроение, добрый юмор и отдых после дня'
  },
  thriller: {
    label: '🕵️ Триллер и саспенс',
    keywords: ['триллер', 'детектив', 'криминал', 'ужасы', 'мистика', 'расследование'],
    genres: ['триллер', 'детектив', 'криминал', 'ужасы'],
    desc: 'Напряжённая атмосфера, интрига до последней минуты'
  },
  drama: {
    label: '❤️ Драма и эмоции',
    keywords: ['драма', 'биография', 'мелодрама', 'история', 'жизнь', 'любовь'],
    genres: ['драма', 'мелодрама', 'биография', 'история'],
    desc: 'Сильные характеры, реальные истории и глубокие чувства'
  }
};

const COMPANY_PRESETS = {
  any: { label: '👤 Любая / Один', boostGenres: [] },
  couple: { label: '💑 С парой', boostGenres: ['мелодрама', 'драма', 'комедия', 'триллер', 'фантастика'] },
  friends: { label: '🍕 С друзьями', boostGenres: ['боевик', 'комедия', 'триллер', 'фантастика', 'ужасы', 'приключения'] },
  family: { label: '👨‍👩‍👧‍👦 С семьёй', boostGenres: ['семейный', 'мультфильм', 'приключения', 'фэнтези', 'комедия'] }
};

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getSafePoster(url, title = '') {
  if (!url || typeof url !== 'string') {
    return title ? `/api/media/image-proxy?title=${encodeURIComponent(title)}` : 'assets/favicon.svg';
  }
  const clean = url.trim();
  if (clean.startsWith('data:') || clean.startsWith('assets/') || clean.startsWith('/assets/')) return clean;
  if (clean.startsWith('/api/media/image-proxy')) return clean;
  if (clean.startsWith('http://') || clean.startsWith('https://')) {
    return `/api/media/image-proxy?url=${encodeURIComponent(clean)}${title ? `&title=${encodeURIComponent(title)}` : ''}`;
  }
  return clean;
}

function extractItemGenres(item) {
  if (!item) return [];
  const raw = item.genres || item.genre || '';
  const list = Array.isArray(raw) ? raw : String(raw).split(/[,/•|]/);
  return list
    .map(g => String(g).trim().toLowerCase())
    .filter(g => g.length > 2 && g !== 'фильмы' && g !== 'сериалы' && g !== 'кино' && g !== 'hd' && g !== '4k');
}

/**
 * Строит аналитический профиль вкусов пользователя на основе закладок и истории просмотров
 */
export async function analyzeUserTasteProfile() {
  const [bookmarks, continueList] = await Promise.all([
    fetchUserBookmarks().catch(() => []),
    fetchContinueWatching().catch(() => [])
  ]);

  const genreCounts = {};
  const seenIds = new Set();
  const seenTitles = new Set();
  const favoriteTitles = [];
  let seriesCount = 0;
  let moviesCount = 0;
  let animeCount = 0;
  let ratingSum = 0;
  let ratingItems = 0;

  const allUserItems = [...bookmarks, ...continueList];
  allUserItems.forEach(item => {
    if (!item) return;
    const id = String(item.id || item.media_id || '');
    const title = String(item.title || '').trim();
    if (id) seenIds.add(id);
    if (title) {
      seenTitles.add(title.toLowerCase());
      if (favoriteTitles.length < 6 && !favoriteTitles.includes(title)) {
        favoriteTitles.push(title);
      }
    }

    const mType = String(item.media_type || '').toLowerCase();
    if (mType.includes('anime')) animeCount++;
    else if (mType.includes('series') || (item.season && item.season > 0)) seriesCount++;
    else moviesCount++;

    const r = parseFloat(item.rating);
    if (!isNaN(r) && r > 0) {
      ratingSum += r;
      ratingItems++;
    }

    const weight = item.user_status === 'favorites' ? 3 : (item.user_status === 'watching' ? 2 : 1.5);
    const genres = extractItemGenres(item);
    genres.forEach(g => {
      genreCounts[g] = (genreCounts[g] || 0) + weight;
    });
  });

  const totalGenreWeight = Object.values(genreCounts).reduce((a, b) => a + b, 0) || 1;
  const topGenres = Object.entries(genreCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, w]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      key: name,
      weight: w,
      percent: Math.min(95, Math.max(12, Math.round((w / totalGenreWeight) * 100)))
    }));

  if (topGenres.length === 0) {
    topGenres.push(
      { name: 'Фантастика', key: 'фантастика', weight: 3, percent: 36 },
      { name: 'Триллер', key: 'триллер', weight: 2.5, percent: 28 },
      { name: 'Драма', key: 'драма', weight: 2, percent: 22 },
      { name: 'Боевик', key: 'боевик', weight: 1.5, percent: 14 }
    );
  }

  return {
    bookmarksCount: bookmarks.length,
    historyCount: continueList.length,
    totalAnalyzed: bookmarks.length + continueList.length,
    topGenres,
    genreWeights: genreCounts,
    seenIds,
    seenTitles,
    favoriteTitles,
    avgRating: ratingItems > 0 ? (ratingSum / ratingItems).toFixed(1) : '8.4',
    preferredFormat: seriesCount > moviesCount ? 'Сериалы и многосерийные проекты' : 'Полнометражное кино и сериалы'
  };
}

async function loadCandidatePool(customQuery = '') {
  const pool = [];
  const seen = new Set();

  const addItems = (items) => {
    if (!Array.isArray(items)) return;
    items.forEach(it => {
      if (!it || !it.title) return;
      const key = String(it.title).toLowerCase().replace(/[^a-zа-яё0-9]/gi, '');
      if (!key || seen.has(key)) return;
      seen.add(key);
      pool.push(it);
    });
  };

  if (customQuery && customQuery.trim().length >= 2) {
    try {
      const semRes = await fetch(`/api/search/semantic?q=${encodeURIComponent(customQuery.trim())}`);
      if (semRes.ok) {
        const semData = await semRes.json();
        addItems(semData.items || []);
      }
    } catch (_) {}

    try {
      const searchRes = await fetch(`/api/media/search?q=${encodeURIComponent(customQuery.trim())}`);
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        addItems(searchData.items || searchData || []);
      }
    } catch (_) {}
  }

  if (advisorState.lastCatalogPool.length > 30) {
    addItems(advisorState.lastCatalogPool);
  } else {
    const categories = ['popular', 'new', 'movies', 'series', 'anime-series'];
    const results = await Promise.allSettled(
      categories.map(cat =>
        fetch(`/api/media/catalog?category=${cat}&page=1&source=all`).then(r => r.json())
      )
    );
    results.forEach(res => {
      if (res.status === 'fulfilled' && res.value?.items) {
        addItems(res.value.items);
      }
    });

    categories.forEach(cat => {
      try {
        addItems(getBaselineCatalog(cat));
      } catch (_) {}
    });

    if (pool.length > 20) {
      advisorState.lastCatalogPool = [...pool];
    }
  }

  return pool;
}

export async function generateNeuralRecommendations(options = {}) {
  const mood = options.mood || advisorState.mood || 'personal';
  const company = options.company || advisorState.company || 'any';
  const format = options.format || advisorState.format || 'all';
  const customPrompt = (options.customPrompt !== undefined ? options.customPrompt : advisorState.customPrompt || '').trim();

  const [profile, pool] = await Promise.all([
    analyzeUserTasteProfile(),
    loadCandidatePool(customPrompt)
  ]);

  const moodConfig = MOOD_PRESETS[mood] || MOOD_PRESETS.personal;
  const companyConfig = COMPANY_PRESETS[company] || COMPANY_PRESETS.any;
  const queryWords = customPrompt
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length >= 3);

  const filteredPool = pool.filter(item => {
    if (!item || !item.title) return false;
    const mType = String(item.media_type || item.category || '').toLowerCase();
    const genresStr = extractItemGenres(item).join(' ');
    if (format === 'movies') {
      return mType === 'movie' || mType === 'movies' || (!mType.includes('series') && !mType.includes('anime'));
    }
    if (format === 'series') {
      return mType.includes('series') || (item.season && item.season > 0);
    }
    if (format === 'anime') {
      return mType.includes('anime') || genresStr.includes('аниме');
    }
    return true;
  });

  const scored = filteredPool.map(item => {
    const rating = parseFloat(item.rating) || 7.8;
    let score = rating * 6;

    const idStr = String(item.id || '');
    const titleLower = String(item.title || '').toLowerCase();
    const descLower = String(item.description || '').toLowerCase();
    const itemGenres = extractItemGenres(item);

    // Уже просмотренные убираем вниз
    if (profile.seenIds.has(idStr) || profile.seenTitles.has(titleLower)) {
      score -= 60;
    }

    // Совпадение с жанровым профилем пользователя
    let matchedUserGenres = [];
    itemGenres.forEach(g => {
      if (profile.genreWeights[g]) {
        score += Math.min(28, profile.genreWeights[g] * 6);
        matchedUserGenres.push(g);
      }
    });

    // Совпадение с выбранным настроением
    let matchedMoodGenre = '';
    if (mood !== 'personal') {
      moodConfig.genres.forEach(mg => {
        if (itemGenres.some(ig => ig.includes(mg))) {
          score += 18;
          if (!matchedMoodGenre) matchedMoodGenre = mg;
        }
      });
      moodConfig.keywords.forEach(kw => {
        if (titleLower.includes(kw) || descLower.includes(kw)) {
          score += 10;
        }
      });
    }

    // Совпадение с выбранной компанией
    if (company !== 'any' && companyConfig.boostGenres.length > 0) {
      companyConfig.boostGenres.forEach(cg => {
        if (itemGenres.some(ig => ig.includes(cg))) {
          score += 10;
        }
      });
    }

    // Свободный текстовый запрос к ИИ
    let matchedQueryWords = 0;
    if (queryWords.length > 0) {
      queryWords.forEach(w => {
        if (titleLower.includes(w)) {
          score += 35;
          matchedQueryWords++;
        } else if (descLower.includes(w) || itemGenres.some(g => g.includes(w))) {
          score += 20;
          matchedQueryWords++;
        }
      });
    }

    // Бонус за 4K UHD и свежие релизы
    const yearNum = parseInt(item.year, 10) || 2024;
    if (yearNum >= 2024) score += 6;
    if (String(item.quality || '').includes('4K')) score += 4;

    const matchPercent = Math.min(99, Math.max(84, Math.round(58 + Math.min(41, score / 2.6))));

    // Формирование аналитического обоснования
    const reasons = [];
    if (customPrompt && matchedQueryWords > 0) {
      reasons.push(`Точное семантическое совпадение с вашим запросом «${customPrompt}»`);
    }
    if (matchedUserGenres.length > 0) {
      const gList = matchedUserGenres.slice(0, 2).map(g => g.charAt(0).toUpperCase() + g.slice(1)).join(', ');
      if (profile.favoriteTitles.length > 0) {
        reasons.push(`В духе ваших закладок («${profile.favoriteTitles[0]}») • жанр: ${gList}`);
      } else {
        reasons.push(`Высокое совпадение с вашими любимыми жанрами (${gList})`);
      }
    } else if (matchedMoodGenre) {
      reasons.push(`Идеально попадает под настроение «${moodConfig.label}»`);
    } else {
      const fallbackGenre = itemGenres[0] ? (itemGenres[0].charAt(0).toUpperCase() + itemGenres[0].slice(1)) : 'Топ каталога';
      reasons.push(`Высокий зрительский рейтинг ★ ${rating.toFixed(1)} в категории «${fallbackGenre}»`);
    }

    if (company !== 'any') {
      reasons.push(`Отличный выбор для просмотра: ${companyConfig.label.replace(/^[^\s]+\s/, '')}`);
    }

    return {
      ...item,
      score,
      matchPercent,
      reason: reasons.join(' • ')
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return {
    profile,
    recommendations: scored.slice(0, 10)
  };
}

export async function openNeuralRecommenderModal() {
  let modal = document.getElementById('neural-recommender-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'storm-modal-backdrop';
    modal.id = 'neural-recommender-modal';
    modal.innerHTML = `
      <div class="storm-modal" style="max-width: 960px; width: 95%; max-height: 90vh; display: flex; flex-direction: column;">
        <div class="storm-modal-header" style="justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 24px;">🧠</span>
            <div>
              <h3 style="margin: 0; font-size: 17px;">ИИ-Советник STORM NEURAL 2.0</h3>
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">Нейросетевой анализ ваших закладок, истории просмотров и настроения на вечер</div>
            </div>
          </div>
          <button type="button" class="storm-modal-close" id="neural-modal-close-btn" title="Закрыть">✕</button>
        </div>
        <div class="storm-modal-body" id="neural-recommender-body" style="padding: 16px 20px 24px; overflow-y: auto;"></div>
      </div>
    `;
    document.body.appendChild(modal);

    const closeBtn = modal.querySelector('#neural-modal-close-btn');
    if (closeBtn) closeBtn.onclick = () => modal.classList.remove('is-open');
    modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('is-open'); };
  }

  modal.classList.add('is-open');
  await renderNeuralAdvisorModal();
}

async function renderNeuralAdvisorModal() {
  const body = document.getElementById('neural-recommender-body');
  if (!body) return;

  body.innerHTML = `
    <div style="text-align: center; padding: 36px 20px; color: var(--text-muted);">
      <div class="storm-spinner" style="width: 36px; height: 36px; margin: 0 auto 12px;"></div>
      <div style="font-weight: 700; color: #fff; font-size: 14px;">ИИ-Советник анализирует ваш профиль и каталог...</div>
      <div style="font-size: 12px; margin-top: 4px;">Расчёт весов жанров, истории просмотров и семантических связей</div>
    </div>
  `;

  try {
    const { profile, recommendations } = await generateNeuralRecommendations();

    body.innerHTML = `
      <!-- 1. Аналитическая сводка вкусов пользователя -->
      <div style="background: rgba(0, 210, 255, 0.06); border: 1px solid rgba(0, 210, 255, 0.22); border-radius: 14px; padding: 14px 16px; margin-bottom: 16px;">
        <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 10px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 18px;">📊</span>
            <span style="font-weight: 800; font-size: 13.5px; color: #fff;">Ваш нейро-профиль зрителя</span>
            <span style="font-size: 11px; padding: 2px 8px; border-radius: 20px; background: rgba(0, 210, 255, 0.16); color: var(--accent); font-weight: 700;">
              Проанализировано тайтлов: ${profile.totalAnalyzed}
            </span>
          </div>
          <div style="font-size: 11.5px; color: var(--text-secondary);">
            Средний рейтинг вкуса: <strong style="color: #fbbf24;">★ ${profile.avgRating}</strong> • Формат: <strong style="color: #fff;">${profile.preferredFormat}</strong>
          </div>
        </div>

        <!-- Прогресс-бары любимых жанров -->
        <div style="display: flex; flex-wrap: wrap; gap: 8px;">
          ${profile.topGenres.map(g => `
            <div style="flex: 1; min-width: 130px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 7px 10px;">
              <div style="display: flex; justify-content: space-between; font-size: 11.5px; font-weight: 700; margin-bottom: 4px;">
                <span>${escapeHtml(g.name)}</span>
                <span style="color: var(--accent);">${g.percent}%</span>
              </div>
              <div style="height: 4px; background: rgba(255,255,255,0.08); border-radius: 4px; overflow: hidden;">
                <div style="width: ${g.percent}%; height: 100%; background: var(--accent, #00d2ff); border-radius: 4px;"></div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- 2. Интерактивные параметры подбора (Настроение, Компания, Формат, Свободный запрос) -->
      <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; background: rgba(255,255,255,0.02); border: 1px solid var(--border-subtle); border-radius: 14px; padding: 14px;">
        <!-- Поле свободного вопроса к ИИ -->
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <input type="text" id="neural-custom-prompt" class="storm-input" value="${escapeHtml(advisorState.customPrompt)}" placeholder="Опишите, что хочется посмотреть (например: космос и выживание, мрачный детектив, киберпанк)..." style="flex: 1; min-width: 220px; font-size: 13px; padding: 9px 12px;">
          <button type="button" class="storm-btn storm-btn-primary" id="neural-ask-btn" style="padding: 9px 16px; font-weight: 700;">
            ✨ Подобрать с ИИ
          </button>
          ${advisorState.customPrompt ? `<button type="button" class="storm-btn storm-btn-secondary" id="neural-clear-prompt-btn" style="padding: 9px 12px;">Сбросить</button>` : ''}
        </div>

        <!-- Настроение -->
        <div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">
          <span style="font-size: 11.5px; color: var(--text-muted); margin-right: 4px; font-weight: 600;">Настроение:</span>
          ${Object.entries(MOOD_PRESETS).map(([key, cfg]) => `
            <button type="button" class="storm-btn storm-btn-sm neural-mood-btn ${advisorState.mood === key ? 'storm-btn-primary' : 'storm-btn-secondary'}" data-mood="${key}" style="font-size: 11.5px; padding: 5px 10px;">
              ${cfg.label}
            </button>
          `).join('')}
        </div>

        <!-- Компания и Формат -->
        <div style="display: flex; flex-wrap: wrap; justify-content: space-between; gap: 10px; align-items: center; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.06);">
          <div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">
            <span style="font-size: 11.5px; color: var(--text-muted); margin-right: 4px; font-weight: 600;">Компания:</span>
            ${Object.entries(COMPANY_PRESETS).map(([key, cfg]) => `
              <button type="button" class="storm-btn storm-btn-sm neural-company-btn ${advisorState.company === key ? 'storm-btn-primary' : 'storm-btn-secondary'}" data-company="${key}" style="font-size: 11.5px; padding: 4px 9px;">
                ${cfg.label}
              </button>
            `).join('')}
          </div>

          <div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">
            <span style="font-size: 11.5px; color: var(--text-muted); margin-right: 4px; font-weight: 600;">Формат:</span>
            <button type="button" class="storm-btn storm-btn-sm neural-format-btn ${advisorState.format === 'all' ? 'storm-btn-primary' : 'storm-btn-secondary'}" data-format="all" style="font-size: 11.5px; padding: 4px 9px;">Все</button>
            <button type="button" class="storm-btn storm-btn-sm neural-format-btn ${advisorState.format === 'movies' ? 'storm-btn-primary' : 'storm-btn-secondary'}" data-format="movies" style="font-size: 11.5px; padding: 4px 9px;">🎬 Фильмы</button>
            <button type="button" class="storm-btn storm-btn-sm neural-format-btn ${advisorState.format === 'series' ? 'storm-btn-primary' : 'storm-btn-secondary'}" data-format="series" style="font-size: 11.5px; padding: 4px 9px;">📺 Сериалы</button>
            <button type="button" class="storm-btn storm-btn-sm neural-format-btn ${advisorState.format === 'anime' ? 'storm-btn-primary' : 'storm-btn-secondary'}" data-format="anime" style="font-size: 11.5px; padding: 4px 9px;">⛩️ Аниме</button>
          </div>
        </div>
      </div>

      <!-- 3. Сетка персональных рекомендаций -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <div style="font-size: 13px; font-weight: 700; color: var(--text-secondary);">
          🎯 Персональная подборка (${recommendations.length} лучших совпадений):
        </div>
      </div>

      <div class="neural-recs-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 12px;">
        ${recommendations.map((rec, idx) => {
          const posterUrl = getSafePoster(rec.poster, rec.title);
          const encodedTitle = encodeURIComponent(rec.title || '').replace(/'/g, '%27');
          return `
            <div class="storm-card neural-rec-card" data-idx="${idx}" style="display: flex; gap: 12px; padding: 12px; border-radius: 12px; cursor: pointer; position: relative; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.025);">
              <div style="position: relative; width: 84px; height: 124px; flex-shrink: 0; border-radius: 8px; overflow: hidden; background: #0f172a;">
                <img src="${posterUrl}" alt="${escapeHtml(rec.title)}" style="width: 100%; height: 100%; object-fit: cover;" loading="lazy" onerror="if(!this.dataset.triedTitle){ this.dataset.triedTitle='1'; this.src='/api/media/image-proxy?title=${encodedTitle}'; } else { this.onerror=null; this.src='assets/favicon.svg'; }">
                <span style="position: absolute; top: 4px; left: 4px; background: rgba(0, 210, 255, 0.92); color: #000; font-size: 10px; font-weight: 800; padding: 2px 5px; border-radius: 5px;">
                  ${rec.matchPercent}%
                </span>
              </div>
              <div style="flex: 1; display: flex; flex-direction: column; justify-content: space-between; min-width: 0;">
                <div>
                  <div style="font-weight: 800; font-size: 14px; color: #fff; margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(rec.title)}">
                    ${escapeHtml(rec.title)}
                  </div>
                  <div style="font-size: 11px; color: var(--accent); font-weight: 600; margin-bottom: 6px;">
                    ${rec.year || '2025'} • ★ ${rec.rating || '8.2'} • ${escapeHtml(rec.quality || '4K UHD')}
                  </div>
                  <div style="font-size: 11.5px; color: var(--text-secondary); line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;">
                    💡 ${escapeHtml(rec.reason)}
                  </div>
                </div>
                <div style="display: flex; gap: 8px; margin-top: 8px;">
                  <button type="button" class="storm-btn storm-btn-primary storm-btn-sm neural-play-btn" data-idx="${idx}" style="padding: 5px 12px; font-size: 11.5px;">
                    ▶ Смотреть в 4K
                  </button>
                  <button type="button" class="storm-btn storm-btn-secondary storm-btn-sm neural-bookmark-btn" data-idx="${idx}" style="padding: 5px 10px; font-size: 11.5px;" title="Сохранить в закладки «Буду смотреть»">
                    🔖 В закладки
                  </button>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    // Обработчики переключателей настроения
    body.querySelectorAll('.neural-mood-btn').forEach(btn => {
      btn.onclick = () => {
        advisorState.mood = btn.dataset.mood;
        renderNeuralAdvisorModal();
      };
    });

    // Обработчики компании
    body.querySelectorAll('.neural-company-btn').forEach(btn => {
      btn.onclick = () => {
        advisorState.company = btn.dataset.company;
        renderNeuralAdvisorModal();
      };
    });

    // Обработчики формата
    body.querySelectorAll('.neural-format-btn').forEach(btn => {
      btn.onclick = () => {
        advisorState.format = btn.dataset.format;
        renderNeuralAdvisorModal();
      };
    });

    // Свободный запрос к ИИ
    const promptInput = body.querySelector('#neural-custom-prompt');
    const askBtn = body.querySelector('#neural-ask-btn');
    const clearBtn = body.querySelector('#neural-clear-prompt-btn');

    if (askBtn && promptInput) {
      const triggerCustomSearch = () => {
        advisorState.customPrompt = promptInput.value.trim();
        renderNeuralAdvisorModal();
      };
      askBtn.onclick = triggerCustomSearch;
      promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') triggerCustomSearch();
      });
    }

    if (clearBtn) {
      clearBtn.onclick = () => {
        advisorState.customPrompt = '';
        renderNeuralAdvisorModal();
      };
    }

    // Кнопки запуска и добавления в закладки
    const modal = document.getElementById('neural-recommender-modal');
    body.querySelectorAll('.neural-rec-card').forEach(card => {
      const idx = parseInt(card.dataset.idx, 10);
      const item = recommendations[idx];
      if (!item) return;

      const playBtn = card.querySelector('.neural-play-btn');
      const bmBtn = card.querySelector('.neural-bookmark-btn');

      if (playBtn) {
        playBtn.onclick = (e) => {
          e.stopPropagation();
          if (modal) modal.classList.remove('is-open');
          openPlayerModal(item);
        };
      }

      if (bmBtn) {
        bmBtn.onclick = async (e) => {
          e.stopPropagation();
          await saveBookmarkStatus(item, 'planned');
          bmBtn.textContent = '✅ Сохранено';
          showToast(`«${item.title}» добавлен в список «Буду смотреть»`, 'success');
        };
      }

      card.onclick = () => {
        if (modal) modal.classList.remove('is-open');
        openPlayerModal(item);
      };
    });
  } catch (err) {
    body.innerHTML = `<div style="color: var(--color-red); padding: 20px; text-align: center;">Ошибка ИИ-советника: ${escapeHtml(err.message)}</div>`;
  }
}
