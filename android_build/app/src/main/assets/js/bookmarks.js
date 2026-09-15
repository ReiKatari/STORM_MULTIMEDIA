/* ==========================================================================
   STORM MULTIMEDIA - МОДУЛЬ ЗАКЛАДОК, СТАТУСОВ И ПОЛЬЗОВАТЕЛЬСКИХ СПИСКОВ
   ========================================================================== */

import { getToken, showToast } from './auth.js';
import { t } from './i18n.js';

let memoryBookmarksCache = [];

export function setMemoryBookmarksCache(bookmarks = []) {
  if (Array.isArray(bookmarks)) {
    memoryBookmarksCache = bookmarks;
  }
}

export function getMemoryBookmarksCache() {
  return memoryBookmarksCache;
}

export function resolveMediaUserStatus(item) {
  if (!item) return null;
  const directStatus = item.user_status || item.bookmark_status;
  if (directStatus && directStatus !== 'none') return directStatus;
  if (item.status && ['completed', 'watching', 'planned', 'favorite', 'on_hold', 'dropped', 'wont_watch'].includes(item.status)) {
    return item.status;
  }

  const id = String(item.id || item.media_id || '');
  if (id) {
    const s = localStorage.getItem(`storm_status_${id}`);
    if (s && s !== 'none') return s;
  }

  const rawTitle = String(item.title || item.original_title || '').trim();
  const normTitle = rawTitle.toLowerCase().replace(/\s*[\(\[]?\s*(?:4[kк]|uhd|сериал|фильм|\d+\s*сезон).*?[\)\]]?/gi, ' ').trim();
  if (normTitle) {
    const s = localStorage.getItem(`storm_status_title_${normTitle}`) || localStorage.getItem(`storm_status_title_${rawTitle.toLowerCase()}`);
    if (s && s !== 'none') return s;
  }

  if (memoryBookmarksCache.length > 0) {
    const match = memoryBookmarksCache.find(b => {
      const bId = String(b.id || b.media_id || '');
      if (id && bId === id) return true;
      const bTitle = String(b.title || '').trim().toLowerCase().replace(/\s*[\(\[]?\s*(?:4[kк]|uhd|сериал|фильм|\d+\s*сезон).*?[\)\]]?/gi, ' ').trim();
      return bTitle && (bTitle === normTitle || normTitle.includes(bTitle) || bTitle.includes(normTitle));
    });
    if (match?.status && match.status !== 'none') {
      return match.status;
    }
  }

  return null;
}

export async function fetchUserBookmarks(status = null, type = null) {
  const token = getToken();
  let serverBookmarks = [];
  if (token) {
    let url = '/api/bookmarks';
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    if (type) params.append('type', type);
    if (params.toString()) url += `?${params.toString()}`;

    try {
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        serverBookmarks = await res.json();
      }
    } catch (err) {
      console.error('Ошибка получения закладок:', err);
    }
  }

  if (serverBookmarks.length > 0) {
    setMemoryBookmarksCache(serverBookmarks);
  }
  return serverBookmarks;
}

export function removeFromLocalContinueWatching(mediaId, title = '') {
  try {
    const raw = localStorage.getItem('storm_continue_watching');
    if (!raw) return;
    let list = JSON.parse(raw);
    if (!Array.isArray(list)) return;

    const cleanTitle = String(title || '').trim().toLowerCase();
    const cleanId = String(mediaId || '');

    const filtered = list.filter(it => {
      if (!it) return false;
      const itId = String(it.media_id || it.id || '');
      const itTitle = String(it.title || '').trim().toLowerCase();
      if (cleanId && itId === cleanId) return false;
      if (cleanTitle && (itTitle === cleanTitle || itTitle.includes(cleanTitle) || cleanTitle.includes(itTitle))) return false;
      return true;
    });

    localStorage.setItem('storm_continue_watching', JSON.stringify(filtered));
    window.dispatchEvent(new CustomEvent('storm:continue-watching-updated', { detail: { mediaId, title, removed: true } }));
  } catch (e) {
    console.error('Ошибка удаления из продолжать просмотр:', e);
  }
}

export function markAllSeriesSeasonsAndEpisodes(media, newStatus = 'completed') {
  if (!media || !media.id) return;
  const mediaId = String(media.id);
  const normTitle = String(media.title || '').trim().toLowerCase();

  try {
    localStorage.setItem(`storm_status_${mediaId}`, newStatus);
    if (normTitle) {
      localStorage.setItem(`storm_status_title_${normTitle}`, newStatus);
    }
  } catch {}

  let defaultCount = 10;
  if (normTitle.includes('дандадан') || normTitle.includes('dandadan') || normTitle.includes('аниме')) {
    defaultCount = 12;
  } else if (normTitle.includes('укрытие') || normTitle.includes('бункер') || normTitle.includes('silo')) {
    defaultCount = 10;
  }

  const seasons = Array.isArray(media.seasons) && media.seasons.length > 0
    ? media.seasons
    : Array.from({ length: 3 }, (_, i) => ({ season_number: i + 1, episode_count: defaultCount }));

  seasons.forEach(s => {
    const sNum = Number(s.season || s.season_number) || 1;
    const count = Number(s.episode_count || s.episodes_count || (s.episodes ? s.episodes.length : defaultCount)) || defaultCount;
    const sKey = `storm_watched_eps_${mediaId}_s${sNum}`;
    const statusKey = `storm_season_status_${mediaId}_s${sNum}`;

    try {
      if (newStatus === 'completed') {
        localStorage.setItem(statusKey, 'completed');
        const eps = Array.from({ length: count }, (_, i) => i + 1);
        localStorage.setItem(sKey, JSON.stringify(eps));
        if (sNum === 1) {
          localStorage.setItem(`storm_watched_eps_${mediaId}`, JSON.stringify(eps));
        }
      } else if (newStatus === 'planned') {
        localStorage.removeItem(statusKey);
        localStorage.removeItem(sKey);
        if (sNum === 1) localStorage.removeItem(`storm_watched_eps_${mediaId}`);
      }
    } catch {}
  });

  if (newStatus === 'completed' || newStatus === 'dropped' || newStatus === 'wont_watch') {
    removeFromLocalContinueWatching(mediaId, media.title);
  }

  window.dispatchEvent(new CustomEvent('storm:series-status-changed', {
    detail: { mediaId, status: newStatus }
  }));
}

export async function saveBookmarkStatus(mediaData, status) {
  if (!mediaData) return null;
  const mediaId = String(mediaData.id || mediaData.media_id || '');
  const normTitle = String(mediaData.title || '').trim().toLowerCase();

  // Всегда локально сохраняем статус в localStorage для мгновенного отклика
  try {
    if (mediaId) {
      localStorage.setItem(`storm_status_${mediaId}`, status);
    }
    if (normTitle) {
      localStorage.setItem(`storm_status_title_${normTitle}`, status);
    }
  } catch {}

  // Если статус завершён/брошен/не буду — немедленно удаляем из Продолжить просмотр
  if (status === 'completed' || status === 'dropped' || status === 'wont_watch') {
    removeFromLocalContinueWatching(mediaId, mediaData.title);
  }

  // Если это сериал и статус «Просмотрено», каскадно помечаем все сезоны и серии
  const mType = detectClientMediaType(mediaData);
  const isSeries = mType === 'series' || mType === 'anime-series' || mType === 'cartoon-series';
  if (isSeries && status === 'completed') {
    markAllSeriesSeasonsAndEpisodes(mediaData, 'completed');
  }

  const token = getToken();
  if (!token) {
    showToast(t('msg_bookmark_saved'), 'success');
    window.dispatchEvent(new CustomEvent('storm:bookmarks-updated', { detail: { mediaData, status } }));
    return { status, localOnly: true };
  }

  if (!status || status === 'none') {
    return await deleteBookmark(mediaData.id, mediaData.source, mediaData.title);
  }

  try {
    const res = await fetch('/api/bookmarks/set', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        media_id: mediaData.id,
        source: mediaData.source,
        title: mediaData.title,
        original_title: mediaData.original_title || '',
        poster_url: mediaData.poster || mediaData.poster_url || '',
        media_type: mediaData.media_type || mType || 'movie',
        year: mediaData.year || detectClientYear(mediaData) || '',
        status: status
      })
    });

    if (!res.ok) throw new Error('Ошибка сохранения закладки');
    const updated = await res.json();
    showToast(t('msg_bookmark_saved'), 'success');
    window.dispatchEvent(new CustomEvent('storm:bookmarks-updated', { detail: { mediaData, status } }));
    return updated;
  } catch (err) {
    showToast(err.message, 'error');
    return null;
  }
}

export async function deleteBookmark(mediaId, source, title = '') {
  const normTitle = String(title || '').trim().toLowerCase();
  try {
    if (mediaId) localStorage.removeItem(`storm_status_${mediaId}`);
    if (normTitle) localStorage.removeItem(`storm_status_title_${normTitle}`);
  } catch {}

  const token = getToken();
  if (!token) {
    showToast('Удалено из закладок', 'info');
    window.dispatchEvent(new CustomEvent('storm:bookmarks-updated', { detail: { mediaId, source, title, deleted: true } }));
    return { success: true, deleted: true };
  }

  try {
    const res = await fetch('/api/bookmarks/remove', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ media_id: mediaId, source, title })
    });
    if (res.ok) {
      showToast('Удалено из закладок', 'info');
      window.dispatchEvent(new CustomEvent('storm:bookmarks-updated', { detail: { mediaId, source, title, deleted: true } }));
      return { success: true, deleted: true };
    }
    return false;
  } catch (err) {
    showToast('Ошибка удаления закладки', 'error');
    return false;
  }
}

// -------------------------------------------------------------
// ЛОКАЛЬНАЯ И СЕРВЕРНАЯ ИСТОРИЯ ПРОСМОТРА (CONTINUE WATCHING)
// -------------------------------------------------------------

export function detectClientMediaType(item) {
  if (!item) return 'movie';
  const t = String(item.title || item.name || '').toLowerCase();
  const cat = String(item.category || '').toLowerCase();
  const link = String(item.link || item.url || item.fanfilm_4k_url || '').toLowerCase();
  const src = String(item.source || '').toLowerCase();

  // Аниме
  if (src === 'anilibria' || src === 'anixart' || src === 'shikimori' ||
      cat.includes('anime') || link.includes('anime') ||
      t.includes('перекуре за супермаркетом') || t.includes('дандадан') || t.includes('клинок, рассекающий') ||
      t.includes('атака титанов') || t.includes('аркейн') || t.includes('поднятие уровня') || t.includes('магическая битва') ||
      t.includes('персонажи в клетке') || t.includes('кафе из другого мира')) {
    if (t.includes('фильм') || cat === 'anime-movies' || item.media_type === 'anime-movie') {
      return 'anime-movie';
    }
    return 'anime-series';
  }

  // Мультфильмы
  if (cat.includes('cartoon') || link.includes('mult') || t.includes('мульт')) {
    const hasEp = (parseInt(item.total_episodes, 10) > 1) || (parseInt(item.episode, 10) > 1) || link.includes('serial');
    return hasEp ? 'cartoon-series' : 'cartoon';
  }

  if (item.media_type === 'series' || item.type === 'series' || item.type === 'tv' || item.isSeries || cat === 'series' || cat === 'serial') {
    return 'series';
  }

  // Известные сериалы
  const knownSeries = [
    'мистер робот', 'mr. robot', 'mr robot',
    'ходячие мертвецы', 'the walking dead',
    'остаться в живых', 'lost',
    'спартак', 'спартак: кровь и песок', 'spartacus',
    'новичок', 'the rookie',
    'извне', 'from',
    'декстер', 'dexter', 'декстер: первородный грех', 'dexter: original sin', 'декстер: новая кровь', 'dexter: new blood',
    'медленные лошади', 'slow horses',
    'йеллоустоун', 'yellowstone',
    'мэр кингстауна', 'mayor of kingstown',
    'кобра кай', 'cobra kai',
    'сопрано', 'клан сопрано', 'the sopranos',
    'прослушка', 'the wire',
    'игра в кальмара', 'squid game',
    'секретные материалы', 'the x-files',
    'персонажи в клетке',
    'кафе из другого мира',
    'джек ричер', 'ричер', 'reacher',
    'стюарт блум не смог спасти вселенную', 'стюарт блум',
    'укрытие', 'бункер', 'silo', 'разделение', 'severance',
    'игра престолов', 'дом дракона', 'house of the dragon', 'пацаны', 'the boys', 'поколение «ви»', 'поколение ви', 'gen v',
    'очень странные дела', 'stranger things', 'кольца власти', 'сёгун', 'сегун', 'shogun',
    'фоллаут', 'fallout', 'пингвин', 'the penguin', 'джентльмены', 'the gentlemen',
    'одни из нас', 'the last of us', 'мандалорец', 'андор', 'локи', 'ведьмак', 'the witcher',
    'чернобыль', 'во все тяжкие', 'breaking bad', 'лучше звоните солу', 'better call saul', 'медведь', 'the bear', 'шерлок',
    'доктор хаус', 'острые козырьки', 'peaky blinders', 'настоящий детектив', 'фарго', 'мир дикого запада', 'тьма', 'dark',
    'чёрное зеркало', 'черное зеркало', 'black mirror', 'сверхъестественное', 'supernatural', 'викинги', 'vikings',
    'слово пацана', 'вампиры средней полосы', 'триггер', 'метод', 'мажор',
    'кухня', 'интерны', 'эпидемия', 'фишер', 'корона', 'the crown', 'уэнсдэй', 'уэнсдей', 'wednesday', 'миротворец',
    'бумажный дом', 'money heist', 'озарк', 'ozark', 'академия амбрелла', 'the umbrella academy',
    'ганнибал', 'hannibal', 'гримм', 'grimm', 'бесстыжие', 'shameless', 'ривердейл', 'riverdale', 'эйфория', 'euphoria',
    'люцифер', 'lucifer', 'теория большого взрыва', 'the big bang theory', 'детство шелдона', 'young sheldon',
    'друзья', 'friends', 'офис', 'the office', 'клиника', 'scrubs', 'универ', 'реальные пацаны', 'след', 'глухарь', 'невский'
  ];

  if (knownSeries.some(s => t === s || t.startsWith(s + ' ') || t.includes(s))) {
    return 'series';
  }

  const ep = parseInt(item.episode, 10) || 0;
  const totalEp = parseInt(item.total_episodes, 10) || parseInt(item.episodes_total, 10) || 0;
  const season = parseInt(item.season, 10) || 0;
  if (ep > 1 || totalEp > 1 || season > 1) {
    return 'series';
  }

  if (link.includes('serial') || link.includes('fan-serials') || cat.includes('series') || t.includes('сериал') || t.includes('сезон') || /сезон\s*\d+/i.test(t)) {
    return 'series';
  }

  return item.media_type || 'movie';
}

export function detectClientYear(item) {
  if (!item) return '';
  const rawTitle = String(item.title || item.name || '');
  const t = rawTitle
    .toLowerCase()
    .replace(/[«»"'`]/g, '')
    .replace(/[:—–-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const knownYears = {
    // 2026
    'история о перекуре за супермаркетом': '2026',
    'super no ura de yani suu futari': '2026',
    'человек паук новый день': '2026',
    'spider man brand new day': '2026',
    'проект конец света': '2026',
    'закулисье реальности': '2026',
    'хитрый койот': '2026',
    'миньоны и монстры': '2026',
    'бэтмен падение рыцаря': '2026',
    'аватар аанг последний маг воздуха': '2026',
    'легенда об аанге': '2026',
    'прыгуны': '2026',
    'робоцып спецвыпуск adult swim': '2026',
    'goat мечтай по крупному': '2026',
    'история игрушек 5': '2026',
    'одиссея': '2026',
    'мандалорец и грогу': '2026',
    'мстители судный день': '2026',
    'бэтмен часть 2': '2026',
    'бэтмен 2': '2026',

    // 2025
    'аватар 3 пламя и пепел': '2025',
    'аватар пламя и пепел': '2025',
    'аватар 3': '2025',
    'хищник планета смерти': '2025',
    'планета смерти': '2025',
    'стюарт блум не смог спасти вселенную': '2025',
    'обитель зла мутация': '2025',
    'дандадан 2': '2025',
    'dandadan 2': '2025',
    'человек бензопила фильм история резе': '2025',
    'человек бензопила история резе': '2025',
    'история резе': '2025',
    'зверополис 2': '2025',
    'мэйдэй': '2025',
    'mayday': '2025',
    'супермен': '2025',
    'микки 17': '2025',
    '28 лет спустя': '2025',
    'балерина': '2025',
    'иллюзия обмана 3': '2025',
    'франкенштейн': '2025',
    'дракула': '2025',
    'обезьяна': '2025',

    // 2024
    'персонажи в клетке': '2024',
    'дандадан': '2024',
    'dandadan': '2024',
    'укрытие 2 сезон': '2024',
    'сёгун': '2024',
    'сегун': '2024',
    'shogun': '2024',
    'фоллаут': '2024',
    'fallout': '2024',
    'пингвин': '2024',
    'the penguin': '2024',
    'джентльмены': '2024',
    'the gentlemen': '2024',
    'дюна часть вторая': '2024',
    'дэдпул и росомаха': '2024',
    'гладиатор 2': '2024',
    'дикий робот': '2024',
    'головоломка 2': '2024',
    'кунг фу панда 4': '2024',
    'падение империи': '2024',
    'субстанция': '2024',
    'ужасающий 3': '2024',
    'джокер безумие на двоих': '2024',
    'тихое место день первый': '2024',
    'чужой ромул': '2024',
    'соник 3 в кино': '2024',
    'муфаса король лев': '2024',
    'носферату': '2024',
    'веном последний танец': '2024',
    'битлджус битлджус': '2024',
    'фуриоса хроники безумного макса': '2024',
    'гадкий я 4': '2024',
    'мастер и маргарита': '2024',
    'майор гром игра': '2024',
    'сто лет тому вперед': '2024',
    'сто лет тому вперёд': '2024',
    'холоп 2': '2024',

    // 2023
    'я не киллер': '2023',
    'hit man': '2023',
    'пассажир': '2023',
    'the passenger': '2023',
    'укрытие': '2023',
    'бункер': '2023',
    'silo': '2023',
    'поколение ви': '2023',
    'одни из нас': '2023',
    'the last of us': '2023',
    'оппенгеймер': '2023',
    'чебурашка': '2023',
    'по щучьему велению': '2023',
    'вызов': '2023',
    'кентавр': '2023',
    'поехавшая': '2023',
    'праведник': '2023',
    'снегирь': '2023',

    // 2022 и классика
    'джек ричер': '2022',
    'ричер': '2022',
    'reacher': '2022',
    'разделение': '2022',
    'severance': '2022',
    'дом дракона': '2022',
    'властелин колец кольца власти': '2022',
    'андор': '2022',
    'аватар путь воды': '2022',
    'кот в сапогах 2': '2022',
    'скуби ду шалость или сладость': '2022',
    'дюна': '2021',
    'локи': '2021',
    'пацаны': '2019',
    'мандалорец': '2019',
    'ведьмак': '2019',
    'чернобыль': '2019',
    'кафе из другого мира': '2017',
    'isekai shokudou': '2017',
    'очень странные дела': '2016',
    'изгой один': '2016',
    'angry birds в кино': '2016',
    'мистер робот': '2015',
    'mr robot': '2015',
    'слуга народа': '2015',
    'интерстеллар': '2014',
    'игра престолов': '2011',
    'кот в сапогах': '2011',
    'тачки 2': '2011',
    'ходячие мертвецы': '2010',
    'the walking dead': '2010',
    'спартак кровь и песок': '2010',
    'спартак': '2010',
    'spartacus': '2010',
    'начало': '2010',
    'аватар': '2009',
    'тёмный рыцарь': '2008',
    'темный рыцарь': '2008',
    'тачки': '2006',
    'остаться в живых': '2004',
    'lost': '2004',
    'суперсемейка': '2004'
  };

  const sortedEntries = Object.entries(knownYears).sort((a, b) => b[0].length - a[0].length);
  for (const [k, y] of sortedEntries) {
    if (t === k || t.startsWith(k + ' ') || t.includes(k)) return y;
  }

  if (item.premiere) {
    const ym = String(item.premiere).match(/\b(19\d\d|20\d\d)\b/);
    if (ym) return ym[1];
  }
  if (item.release_date) {
    const ym = String(item.release_date).match(/\b(19\d\d|20\d\d)\b/);
    if (ym) return ym[1];
  }

  const bm = rawTitle.match(/[\(\[]\s*(\d{4})\s*[\)\]]/);
  if (bm && parseInt(bm[1], 10) >= 1920 && parseInt(bm[1], 10) <= 2030) return bm[1];

  const linkStr = String(item.link || item.url || item.fanfilm_4k_url || '');
  if (linkStr) {
    const lm = linkStr.match(/(?:-|_|\/|\b)(19\d\d|20\d\d)(?:\.html|\/|$)/);
    if (lm && parseInt(lm[1], 10) >= 1920 && parseInt(lm[1], 10) <= 2030) return lm[1];
  }

  if (item.year) {
    const ym = String(item.year).match(/\b(19\d\d|20\d\d)\b/);
    if (ym && ym[1] !== '2024') return ym[1];
    if (ym && ym[1] === '2024' && (t.includes('перекур') || t.includes('дандадан 2'))) return '2026';
    if (ym) return ym[1];
  }

  return '';
}

export function getLocalContinueWatching() {
  try {
    const raw = localStorage.getItem('storm_continue_watching');
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];

    let hasChanges = false;

    const sanitized = list.filter(item => {
      if (!item || !item.media_id || !item.title) return false;
      const t = String(item.title || '').trim().toLowerCase();
      if (t.includes('fanfilm4k') || t.includes('фан4к –') || t.includes('4к uhd бесплатно')) return false;

      // 1. Исключаем не запускавшиеся пользователем видео с фиктивным прогрессом
      if ((t.includes('персонажи в клетке') || t.includes('кафе из другого мира')) && (!item.time_seconds || item.time_seconds < 120 || item.progress_percent <= 10)) {
        hasChanges = true;
        return false;
      }

      // 2. Исключаем уже полностью просмотренные произведения
      const localStatus = localStorage.getItem(`storm_status_${item.media_id}`) || localStorage.getItem(`storm_status_title_${t}`);
      if (localStatus === 'completed' || localStatus === 'dropped' || localStatus === 'wont_watch') {
        hasChanges = true;
        return false;
      }
      if (item.user_status === 'completed' || item.status === 'completed' || item.user_status === 'dropped' || item.status === 'dropped') {
        hasChanges = true;
        return false;
      }

      // 3. Если прогресс 90% или более и это фильм, считается просмотренным
      const pct = typeof item.progress_percent === 'number' ? item.progress_percent : 0;
      const cleanType = detectClientMediaType(item);
      const isMovie = cleanType === 'movie' || cleanType === 'anime-movie' || cleanType === 'cartoon';
      if (pct >= 90 && isMovie) {
        hasChanges = true;
        return false;
      }

      const sec = typeof item.time_seconds === 'number' ? item.time_seconds : 0;
      const ep = parseInt(item.episode, 10) || 1;
      return (pct >= 2.0 && sec >= 60) || (pct >= 5.0) || (ep > 1);
    }).map(item => {
      const cleanType = detectClientMediaType(item);
      const cleanYr = detectClientYear(item);
      const s = parseInt(item.season, 10) || 1;
      const ep = parseInt(item.episode, 10) || 1;
      const isSeries = cleanType === 'series' || cleanType === 'anime-series' || cleanType === 'cartoon-series' || cleanType === 'tv' || s > 1 || ep > 1;
      const nextUpText = isSeries ? `С${s} • Э${ep}` : '';
      return {
        ...item,
        media_type: cleanType,
        year: cleanYr || item.year,
        season: s,
        episode: ep,
        next_up: nextUpText || item.next_up || ''
      };
    });

    if (hasChanges || sanitized.length !== list.length) {
      localStorage.setItem('storm_continue_watching', JSON.stringify(sanitized));
    }

    return sanitized;
  } catch {
    return [];
  }
}

export function saveLocalWatchProgress(data) {
  if (!data || !data.media_id) return;
  const cleanTitle = String(data.title || '').trim();
  if (!cleanTitle || cleanTitle.includes('FANFILM4K') || cleanTitle.includes('ФАН4К –') || cleanTitle.includes('4К UHD бесплатно')) return;

  let pct = typeof data.progress_percent === 'number' ? data.progress_percent : 0;
  let sec = typeof data.time_seconds === 'number' ? data.time_seconds : 0;
  const dur = typeof data.duration_seconds === 'number' ? data.duration_seconds : 0;
  if ((pct <= 0 || isNaN(pct)) && sec > 0 && dur > 0) {
    pct = Math.min(100, Math.round((sec / dur) * 100));
  }
  let ep = parseInt(data.episode, 10) || 1;
  const s = parseInt(data.season, 10) || 1;
  const totalEp = parseInt(data.total_episodes, 10) || 0;

  const cleanMediaType = detectClientMediaType(data);
  const cleanYear = detectClientYear(data) || data.year || '';
  const isSeries = cleanMediaType === 'series' || cleanMediaType === 'anime-series' || cleanMediaType === 'cartoon-series' || cleanMediaType === 'tv' || s > 1 || ep > 1;

  // Плекс и Эмби модель прогресса просмотра:
  if (pct >= 90) {
    if (isSeries) {
      try {
        localStorage.setItem(`storm_ep_watched_${data.media_id}_s${s}_e${ep}`, '1');
      } catch (_) {}

      // Если есть следующая серия, переводим Next Up на серию (ep + 1) с 0%
      if (totalEp > 0 && ep < totalEp) {
        ep = ep + 1;
        pct = 0;
        sec = 0;
      } else {
        // Все серии завершены — статус completed, исключаем из Continue Watching
        try {
          localStorage.setItem(`storm_status_${data.media_id}`, 'completed');
          localStorage.setItem(`storm_status_title_${cleanTitle.toLowerCase()}`, 'completed');
          const list = getLocalContinueWatching().filter(it => it.media_id !== String(data.media_id) && it.title?.toLowerCase() !== cleanTitle.toLowerCase());
          localStorage.setItem('storm_continue_watching', JSON.stringify(list));
          window.dispatchEvent(new CustomEvent('storm:continue-watching-updated', { detail: { media_id: data.media_id, completed: true } }));
        } catch (_) {}
        return;
      }
    } else {
      // Фильм полностью просмотрен — переносим в completed и очищаем из Continue Watching
      try {
        localStorage.setItem(`storm_status_${data.media_id}`, 'completed');
        localStorage.setItem(`storm_status_title_${cleanTitle.toLowerCase()}`, 'completed');
        const list = getLocalContinueWatching().filter(it => it.media_id !== String(data.media_id) && it.title?.toLowerCase() !== cleanTitle.toLowerCase());
        localStorage.setItem('storm_continue_watching', JSON.stringify(list));
        window.dispatchEvent(new CustomEvent('storm:continue-watching-updated', { detail: { media_id: data.media_id, completed: true } }));
      } catch (_) {}
      return;
    }
  }

  if (pct < 2.0 && sec < 30 && ep <= 1) return;

  try {
    const list = getLocalContinueWatching();
    const now = Date.now();
    const nextUpText = isSeries ? `С${s} • Э${ep}` : '';

    const newEntry = {
      media_id: String(data.media_id),
      source: data.source || 'tmdb',
      title: cleanTitle,
      poster_url: data.poster_url || data.poster || '',
      poster: data.poster_url || data.poster || '',
      media_type: cleanMediaType,
      year: cleanYear,
      season: s,
      episode: ep,
      total_episodes: totalEp || 1,
      duration_seconds: data.duration_seconds || 7200,
      time_seconds: sec,
      progress_percent: pct,
      status: data.status || data.user_status || null,
      user_status: data.user_status || data.status || null,
      next_up: nextUpText,
      updated_at: now
    };

    const existingIdx = list.findIndex(it =>
      (it.media_id === newEntry.media_id && it.source === newEntry.source) ||
      (it.title && newEntry.title && it.title.trim().toLowerCase() === newEntry.title.trim().toLowerCase())
    );

    if (existingIdx >= 0) {
      list[existingIdx] = { ...list[existingIdx], ...newEntry, updated_at: now };
    } else {
      list.unshift(newEntry);
    }

    const trimmed = list.slice(0, 30);
    localStorage.setItem('storm_continue_watching', JSON.stringify(trimmed));
    window.dispatchEvent(new CustomEvent('storm:continue-watching-updated', { detail: newEntry }));
  } catch (e) {
    console.error('Ошибка сохранения локального прогресса:', e);
  }
}

export async function syncWatchProgress(data) {
  if (!data) return;
  // Всегда сохраняем локально, гарантируя фиксацию для гостей и локального режима
  saveLocalWatchProgress(data);

  const token = getToken();
  if (!token) return;

  try {
    await fetch('/api/media/progress', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(data)
    });
  } catch (e) {
    // Бесшумное логирование прогресса
  }
}

export async function fetchContinueWatching() {
  const localItems = getLocalContinueWatching();
  const token = getToken();

  let serverItems = [];
  if (token) {
    try {
      const res = await fetch('/api/media/continue-watching', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        serverItems = await res.json();
      }
    } catch (err) {
      // Игнорируем сетевые сбои, отдавая локальный кэш
    }
  }

  // Объединяем серверную и локальную историю, исключая дубликаты
  const mergedMap = new Map();

  for (const item of serverItems) {
    const key = (item.title ? item.title.toLowerCase().trim() : '') || `${item.source}_${item.media_id}`;
    mergedMap.set(key, item);
  }

  for (const item of localItems) {
    const key = (item.title ? item.title.toLowerCase().trim() : '') || `${item.source}_${item.media_id}`;
    if (!mergedMap.has(key)) {
      mergedMap.set(key, item);
    } else {
      const existing = mergedMap.get(key);
      if ((item.updated_at || 0) >= (existing.updated_at || 0)) {
        mergedMap.set(key, { ...existing, ...item });
      }
    }
  }

  const result = Array.from(mergedMap.values()).filter(item => {
    if (!item) return false;
    const t = String(item.title || '').trim().toLowerCase();
    const localStatus = localStorage.getItem(`storm_status_${item.media_id || item.id}`) || localStorage.getItem(`storm_status_title_${t}`);
    if (localStatus === 'completed' || localStatus === 'dropped' || localStatus === 'wont_watch') return false;
    if (item.bookmark_status === 'completed' || item.user_status === 'completed' || item.status === 'completed' ||
        item.bookmark_status === 'dropped' || item.user_status === 'dropped' || item.status === 'dropped' ||
        item.bookmark_status === 'wont_watch' || item.user_status === 'wont_watch' || item.status === 'wont_watch') return false;
    if (item.progress_percent && item.progress_percent >= 90) return false;
    return true;
  }).map(item => {
    const s = parseInt(item.season, 10) || 1;
    const ep = parseInt(item.episode, 10) || 1;
    const cleanType = detectClientMediaType(item);
    const isSeries = cleanType === 'series' || cleanType === 'anime-series' || cleanType === 'cartoon-series' || cleanType === 'tv' || s > 1 || ep > 1;
    const nextUpText = isSeries ? `С${s} • Э${ep}` : '';
    return {
      ...item,
      id: item.media_id || item.id,
      media_id: item.media_id || item.id,
      poster: item.poster_url || item.poster || '',
      poster_url: item.poster_url || item.poster || '',
      media_type: cleanType,
      year: detectClientYear(item) || item.year || '',
      progress_percent: typeof item.progress_percent === 'number' ? Math.round(item.progress_percent) : 0,
      user_status: item.bookmark_status || item.user_status || (item.status && item.status !== 'watching' ? item.status : item.bookmark_status) || null,
      season: s,
      episode: ep,
      next_up: nextUpText || item.next_up || ''
    };
  });
  result.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  return result;
}

// -------------------------------------------------------------
// ПОЛЬЗОВАТЕЛЬСКИЕ КОЛЛЕКЦИИ И СПИСКИ
// -------------------------------------------------------------

export async function fetchCustomLists() {
  const token = getToken();
  if (!token) return [];

  try {
    const res = await fetch('/api/custom-lists', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    return [];
  }
}

export async function createCustomCollection(title, description = '', color = '#00d2ff') {
  const token = getToken();
  if (!token) return null;

  try {
    const res = await fetch('/api/custom-lists/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ title, description, color })
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || 'Ошибка создания списка');
    }
    const newList = await res.json();
    showToast(t('msg_list_created'), 'success');
    return newList;
  } catch (err) {
    showToast(err.message, 'warning');
    return null;
  }
}

export async function addItemToCollection(listId, item) {
  const token = getToken();
  if (!token) return;

  try {
    const res = await fetch(`/api/custom-lists/${listId}/items`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        media_id: item.id,
        source: item.source,
        title: item.title,
        poster_url: item.poster,
        media_type: item.media_type,
        year: item.year,
        rating: item.rating
      })
    });

    if (res.ok) {
      showToast(t('msg_added_to_list'), 'success');
    } else {
      const errJson = await res.json().catch(() => ({}));
      showToast(errJson.error || 'Ошибка добавления в список', 'warning');
    }
  } catch (err) {
    showToast(err.message || 'Ошибка добавления в список', 'error');
  }
}

export async function removeItemFromCollection(listId, mediaId, source) {
  const token = getToken();
  if (!token) return;

  try {
    await fetch(`/api/custom-lists/${listId}/items/${mediaId}?source=${source}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    showToast('Удалено из коллекции', 'info');
  } catch (err) {
    showToast('Ошибка при удалении', 'error');
  }
}
