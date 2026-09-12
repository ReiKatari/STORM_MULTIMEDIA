import * as cheerio from 'cheerio';
import { getCache, setCache } from '../db.js';

const BASE_URL = 'https://v17.fanfilm4k.media';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

async function fetchHtml(url, options = {}) {
  const headers = {
    'User-Agent': USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    ...options.headers
  };

  const response = await fetch(url, {
    ...options,
    headers
  });

  if (!response.ok) {
    throw new Error(`Ошибка запроса FanFilm4K: ${response.status} ${response.statusText}`);
  }

  return await response.text();
}

/**
 * Парсинг списка медиа карточек из HTML FanFilm4K
 */
function parseMediaList(html) {
  const $ = cheerio.load(html);
  const items = [];

  // Селекторы карточек в карусели и в основном каталоге
  $('.top, .card, .pmovie__rel-item, .custom-poster').each((_, element) => {
    const el = $(element);
    
    // Ссылка на страницу фильма
    let link = el.attr('href') || el.find('a').first().attr('href') || '';
    if (!link) return;
    if (link.startsWith('/')) link = `${BASE_URL}${link}`;

    // ID новости FanFilm4K
    const idMatch = link.match(/\/(\d+)-/);
    const id = idMatch ? idMatch[1] : link;

    // Название
    let title = el.find('.top__title, .card__title, .poster__title, h2, h3').first().text().trim();
    if (!title) {
      title = el.find('img').first().attr('alt') || el.find('img').first().attr('title') || '';
    }
    if (!title) return;

    // Картинка постера
    let poster = el.find('img').first().attr('data-src') || el.find('img').first().attr('src') || '';
    if (poster && poster.startsWith('/')) poster = `${BASE_URL}${poster}`;

    // Лейбл 4K / Качество
    const is4K = el.text().includes('4K') || el.find('span').text().includes('4K');
    const quality = is4K ? '4K Ultra HD' : 'Full HD';

    // Год и рейтинг
    const yearText = el.find('.card__year, .top__year, .poster__year').text().trim();
    const ratingText = el.find('.card__rating, .rating, .top__rating').text().trim();

    // Тип медиа
    let mediaType = 'movie';
    if (link.includes('serial') || link.includes('fan-serials') || title.toLowerCase().includes('сериал')) {
      mediaType = 'series';
    } else if (link.includes('mult') || title.toLowerCase().includes('мульт')) {
      mediaType = 'cartoon';
    }

    // Проверяем дубликаты
    if (!items.some(it => it.id === id)) {
      setCache('fanfilm4k', `item_link_${id}`, link, 86400 * 7); // Кэшируем ссылку на неделю
      items.push({
        id: String(id),
        source: 'fanfilm4k',
        title,
        link,
        poster,
        quality,
        is4K,
        year: yearText || '',
        rating: parseFloat(ratingText) || 0,
        media_type: mediaType
      });
    }
  });

  return items;
}

/**
 * Получение каталога по категориям
 */
export async function getFanFilmCatalog(category = 'popular', page = 1) {
  const cacheKey = `catalog_${category}_page_${page}`;
  const cached = getCache('fanfilm4k', cacheKey);
  if (cached) return cached;

  let path = '';
  switch (category) {
    case 'new':
      path = page === 1 ? '/f/c.year=2026,2026/sort=date/order=desc/' : `/f/c.year=2026,2026/sort=date/order=desc/page/${page}/`;
      break;
    case 'movies':
      path = page === 1 ? '/4kfilmy/' : `/4kfilmy/page/${page}/`;
      break;
    case 'series':
      path = page === 1 ? '/fan-serials/' : `/fan-serials/page/${page}/`;
      break;
    case '4k':
      path = page === 1 ? '/4k-films/' : `/4k-films/page/${page}/`;
      break;
    case 'cartoons':
      path = page === 1 ? '/multfilmy-4k/' : `/multfilmy-4k/page/${page}/`;
      break;
    case 'cartoon-series':
      path = page === 1 ? '/multserialy/' : `/multserialy/page/${page}/`;
      break;
    case 'popular':
    default:
      path = page === 1 ? '/' : `/page/${page}/`;
      break;
  }

  try {
    const html = await fetchHtml(`${BASE_URL}${path}`);
    const items = parseMediaList(html);

    const result = {
      page,
      category,
      total_items: items.length,
      items
    };

    setCache('fanfilm4k', cacheKey, result, 1800); // 30 минут
    return result;
  } catch (err) {
    console.error(`[FanFilm4K] Ошибка получения каталога ${category}:`, err.message);
    return { page, category, total_items: 0, items: [] };
  }
}

/**
 * Поиск по названию в FanFilm4K
 */
export async function searchFanFilm(query) {
  if (!query || !query.trim()) return [];

  const cacheKey = `search_${query.toLowerCase().trim()}`;
  const cached = getCache('fanfilm4k', cacheKey);
  if (cached) return cached;

  try {
    const formData = new URLSearchParams();
    formData.append('do', 'search');
    formData.append('subaction', 'search');
    formData.append('story', query);

    const html = await fetchHtml(`${BASE_URL}/index.php?do=search`, {
      method: 'POST',
      body: formData,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const items = parseMediaList(html);
    setCache('fanfilm4k', cacheKey, items, 900); // 15 минут
    return items;
  } catch (err) {
    console.error(`[FanFilm4K] Ошибка поиска по запросу "${query}":`, err.message);
    return [];
  }
}

/**
 * Получение детальной страницы фильма / сериала и плееров
 */
export async function getFanFilmDetails(idOrUrl) {
  let url = String(idOrUrl);
  if (!url.startsWith('http')) {
    const cachedLink = getCache('fanfilm4k', `item_link_${idOrUrl}`);
    if (cachedLink) {
      url = cachedLink;
    } else {
      url = `${BASE_URL}/${idOrUrl}.html`;
    }
  }

  const cacheKey = `details_${idOrUrl}`;
  const cached = getCache('fanfilm4k', cacheKey);
  if (cached) return cached;

  try {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    const title = $('h1').first().text().trim() || $('title').text().replace(/смотреть онлайн.*/i, '').trim();
    let poster = $('.pmovie__poster img, .poster img').first().attr('src') || $('meta[property="og:image"]').attr('content') || '';
    if (poster && poster.startsWith('/')) poster = `${BASE_URL}${poster}`;

    const originalTitle = $('meta[property="ya:original_name"]').attr('content') || '';
    const description = $('.pmovie__text, .description, meta[property="og:description"]').first().text().trim() ||
                        $('meta[property="og:description"]').attr('content') || '';

    // Извлекаем числовой ID новости для селекторов
    const numIdMatch = String(idOrUrl).match(/(\d+)/);
    const numId = numIdMatch ? numIdMatch[1] : '';

    // Рейтинг и голоса
    const voteCount = numId ? ($('#vote-num-id-' + numId).text().trim() || '') : '';
    const likes = $('.plus').first().text().trim() || '0';
    const dislikes = $('.minus').first().text().trim() || '0';

    // Kinopoisk ID из тега ins
    const kpId = $('ins[data-type="kp"]').attr('data-id') || '';

    // Плееры
    const players = [];

    // 1. Плеер 4K (transfusion-as / stravers / fanfilm direct iframe)
    const player4kIframe = $('[data-tab-content="4kplayer"] iframe').attr('src') || '';
    if (player4kIframe) {
      players.push({
        id: 'fanfilm4k_uhd',
        name: '4K Ultra HD Плеер (FanFilm4K)',
        type: 'iframe',
        quality: '4K UHD',
        url: player4kIframe.startsWith('//') ? `https:${player4kIframe}` : player4kIframe
      });
    }

    // 2. HD Плеер / Kinopoisk ID для Kinobox
    if (kpId) {
      players.push({
        id: 'kinobox_multi',
        name: 'Kinobox Мультиплеер (Kodik, Collaps, Alloha, VCDN)',
        type: 'kinobox',
        quality: '1080p Full HD',
        kp_id: kpId,
        url: `https://kinobox.tv/embed/kp/${kpId}`
      });
    }

    // 3. Трейлер
    const trailerIframe = $('[data-tab-content="trailer"] iframe').attr('src') || '';
    if (trailerIframe) {
      players.push({
        id: 'trailer',
        name: 'Официальный трейлер',
        type: 'trailer',
        quality: 'HD',
        url: trailerIframe.startsWith('//') ? `https:${trailerIframe}` : trailerIframe
      });
    }

    // Кадры из фильма
    const frames = [];
    $('.pmovie__shots img, .screenshots img').each((_, el) => {
      let src = $(el).attr('src');
      if (src) {
        if (src.startsWith('/')) src = `${BASE_URL}${src}`;
        frames.push(src);
      }
    });

    const result = {
      id: String(idOrUrl),
      source: 'fanfilm4k',
      title,
      original_title: originalTitle,
      poster,
      description,
      kp_id: kpId,
      likes,
      dislikes,
      vote_count: voteCount,
      frames,
      players
    };

    setCache('fanfilm4k', cacheKey, result, 3600); // 1 час
    return result;
  } catch (err) {
    console.error(`[FanFilm4K] Ошибка получения деталей для ${idOrUrl}:`, err.message);
    return null;
  }
}
