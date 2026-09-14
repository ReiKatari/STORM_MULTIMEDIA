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

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(options.timeout || 6000),
      ...options,
      headers
    });
    if (response.ok) {
      return await response.text();
    }
  } catch (err) {
    if (url.includes('v17.fanfilm4k.media')) {
      const mirrorUrl = url.replace('v17.fanfilm4k.media', 'v16.fanfilm4k.media');
      try {
        const mirrorRes = await fetch(mirrorUrl, {
          signal: AbortSignal.timeout(options.timeout || 6000),
          ...options,
          headers
        });
        if (mirrorRes.ok) return await mirrorRes.text();
      } catch {}
    }
    throw err;
  }

  throw new Error(`Ошибка запроса FanFilm4K: ${url}`);
}

export const KNOWN_RELEASE_YEARS = {
  // Новинки 2025-2027
  'мэйдэй': '2026',
  'mayday': '2026',
  'человек-паук: новый день': '2026',
  'человек паук новый день': '2026',
  'spider-man: brand new day': '2026',
  'spider-man 4': '2026',
  'аватар: пламя и пепел': '2025',
  'аватар 3: пламя и пепел': '2025',
  'аватар 3': '2025',
  'хитрый койот': '2026',
  'зверополис 2': '2025',
  'миньоны и монстры': '2026',
  'бэтмен: падение рыцаря': '2026',
  'бэтмен падение рыцаря': '2026',
  'аватар аанг: последний маг воздуха': '2026',
  'легенда об аанге': '2026',
  'прыгуны': '2026',
  'человек-бензопила. фильм: история резе': '2025',
  'человек-бензопила: история резе': '2025',
  'история резе': '2025',
  'робоцып. спецвыпуск adult swim': '2026',
  'goat: мечтай по-крупному': '2026',
  'история игрушек 5': '2026',
  'одиссея': '2026',
  'мандалорец и грогу': '2026',
  'мстители: судный день': '2026',
  'мстители: секретные войны': '2027',
  'бэтмен. часть 2': '2026',
  'бэтмен 2': '2026',
  'дэдпул и росомаха': '2024',
  'дюна: часть вторая': '2024',
  'гладиатор 2': '2024',
  'дикий робот': '2024',
  'головоломка 2': '2024',
  'кунг-фу панда 4': '2024',

  // Мультфильмы и классика
  'тачки 1': '2006',
  'тачки': '2006',
  'тачки 2': '2011',
  'тачки 3': '2017',
  'суперсемейка': '2004',
  'суперсемейка 2': '2018',
  'кот в сапогах': '2011',
  'кот в сапогах 2: последнее желание': '2022',
  'кот в сапогах 2': '2022',
  'angry birds в кино': '2016',
  'angry birds 2 в кино': '2019',
  'скуби-ду: шалость или сладость': '2022',
  'зверополис': '2016',
  'человек-паук: через вселенные': '2018',
  'человек-паук: паутина вселенных': '2023',
  'человек-паук: за пределами вселенных': '2026',
  'властелин колец: война рохирримов': '2024',
  'война рохирримов': '2024',
  'братья вентура: сияющая кровь сердца бабуина': '2023',
  'меч в камне': '1963',
  'турбо': '2013',
  'делай ноги': '2006',
  'делай ноги 2': '2011',
  'босс-молокосос': '2017',
  'босс-молокосос 2': '2021',
  'храбрая сердцем': '2012',
  'спящая красавица': '1959',
  'стальной гигант': '1999',
  'ледниковый период': '2002',
  'ледниковый период 2: глобальное потепление': '2006',
  'ледниковый период 3: эра динозавров': '2009',
  'ледниковый период 4: континентальный дрейф': '2012',
  'ледниковый период 5: столкновение неизбежно': '2016',
  'геркулес': '1997',
  'ральф': '2012',
  'ральф против интернета': '2018',
  'семейка крудс': '2013',
  'семейка крудс 2: новоселье': '2020',
  'холодное сердце': '2013',
  'холодное сердце 2': '2019',
  'в поисках немо': '2003',
  'в поисках дори': '2016',
  'рапунцель: запутанная история': '2010',
  'базз лайтер': '2022',
  'история игрушек': '1995',
  'история игрушек 2': '1999',
  'история игрушек 3: большой побег': '2010',
  'история игрушек 4': '2019',
  'монстры на каникулах': '2012',
  'монстры на каникулах 2': '2015',
  'монстры на каникулах 3: море зовёт': '2018',
  'монстры на каникулах 4: трансформания': '2022',
  'миньоны': '2015',
  'миньоны: грювитация': '2022',
  'гадкий я': '2010',
  'гадкий я 2': '2013',
  'гадкий я 3': '2017',
  'гадкий я 4': '2024',
  'кунг-фу панда': '2008',
  'кунг-фу панда 2': '2011',
  'кунг-фу панда 3': '2016',
  'шрек': '2001',
  'шрек 2': '2004',
  'шрек третий': '2007',
  'шрек навсегда': '2010',
  'как приручить дракона': '2010',
  'как приручить дракона 2': '2014',
  'как приручить дракона 3': '2019',
  'рататуй': '2007',
  'вверх': '2009',
  'валли': '2008',
  'король лев': '1994',
  'головоломка': '2015',
  'тайная жизнь домашних животных': '2016',
  'тайная жизнь домашних животных 2': '2019',
  'миграция': '2023',
  'моана': '2016',
  'моана 2': '2024',

  // Фильмы
  'троя': '2004',
  'начало': '2010',
  'королевство': '2007',
  'интерстеллар': '2014',
  'темный рыцарь': '2008',
  'тёмный рыцарь': '2008',
  'темный рыцарь: возрождение легенды': '2012',
  'бэтмен: начало': '2005',
  'гладиатор': '2000',
  'матрица': '1999',
  'матрица: перезагрузка': '2003',
  'матрица: революция': '2003',
  'титаник': '1997',
  'аватар': '2009',
  'аватар: путь воды': '2022',
  'человек-паук': '2002',
  'человек-паук 2': '2004',
  'человек-паук 3: враг в отражении': '2007',
  'новый человек-паук': '2012',
  'новый человек-паук: высокое напряжение': '2014',
  'человек-паук: возвращение домой': '2017',
  'человек-паук: вдали от дома': '2019',
  'человек-паук: нет пути домой': '2021',

  // Фильмы с числами и годами в названиях (строгая фиксация реального года)
  'бегущий по лезвию 2049': '2017',
  'бегущий по лезвию': '1982',
  'blade runner 2049': '2017',
  'blade runner': '1982',
  'космическая одиссея 2001': '1968',
  '2001: космическая одиссея': '1968',
  '2010: год вступления в контакт': '1984',
  '2012': '2009',
  '1917': '2019',
  '1922': '2017',
  '1941': '1979',
  '1944': '2015',
  '1984': '1984',
  '1408': '2007',
  'киберпанк 2077': '2022',
  'смертельная гонка 2000': '1975',

  // Аниме
  'сад изящных слов': '2013',
  'призрак в доспехах': '1995',
  'акира': '1988',
  'форма голоса': '2016',
  'твоё имя': '2016',
  'твое имя': '2016',
  'дитя погоды': '2019',
  'судзумэ, закрывающая двери': '2022',
  'судзумэ': '2022',
  'ходячий замок': '2004',
  'унесённые призраками': '2001',
  'унесенные призраками': '2001',
  'мой сосед тоторо': '1988',
  'принцесса мононоке': '1997',
  'ветер крепчает': '2013',
  'навсикая из долины ветров': '1984',
  'могила светлячков': '1988',
  'шепот сердца': '1995',
  'рыбка поньо на утесе': '2008'
};

export function resolveMediaYear(title = '', link = '', poster = '', tagYear = '') {
  const cleanT = String(title || '').toLowerCase().replace(/[\(\[\{].*?[\)\]\}]/g, '').trim();
  const sortedEntries = Object.entries(KNOWN_RELEASE_YEARS).sort((a, b) => b[0].length - a[0].length);
  for (const [key, yr] of sortedEntries) {
    if (cleanT === key || cleanT.startsWith(key) || String(title || '').toLowerCase().includes(key)) {
      return yr;
    }
  }

  // 1. Из ссылки FanFilm4K: -(\d{4})(?:-|\.html)
  if (link) {
    const lm = String(link).match(/-(\d{4})(?:-|\.html)/);
    if (lm && parseInt(lm[1], 10) >= 1950 && parseInt(lm[1], 10) <= 2030) {
      return lm[1];
    }
  }

  // 2. Из тега .tag.top-left
  if (tagYear) {
    const tm = String(tagYear).match(/\b(19\d\d|20\d\d)\b/);
    if (tm) return tm[1];
  }

  // 3. Из заголовка (только если год реальный: от 1920 до 2028)
  const ym = String(title || '').match(/\b(19\d\d|20\d\d)\b/);
  if (ym) {
    const yrNum = parseInt(ym[1], 10);
    if (yrNum >= 1920 && yrNum <= 2028) {
      return ym[1];
    }
  }

  // 4. Из даты загрузки постера: /uploads/posts/(20\d\d)-
  if (poster) {
    const pm = String(poster).match(/\/uploads\/posts\/(20\d\d)-/);
    if (pm && parseInt(pm[1], 10) >= 2020) return pm[1];
  }

  return '';
}

export function isAnimeLinkOrTitle(title = '', link = '', category = '') {
  const t = `${title} ${link} ${category}`.toLowerCase();
  if (t.includes('-anime.html') || t.includes('/anime/') || t.includes('аниме') || t.includes('anime')) return true;
  const animeKeywords = [
    'человек-бензопила', 'chainsaw man', 'резе', 'reze',
    'сад изящных слов', 'garden of words', 'kotonoha no niwa',
    'призрак в доспехах', 'ghost in the shell',
    'война рохирримов', 'war of the rohirrim',
    'форма голоса', 'silent voice', 'koe no katachi',
    'твоё имя', 'твое имя', 'your name', 'kimi no na wa',
    'судзумэ', 'suzume',
    'ходячий замок', 'howl\'s moving castle',
    'унесённые призраками', 'унесенные призраками', 'spirited away',
    'мой сосед тоторо', 'my neighbor totoro',
    'принцесса мононоке', 'princess mononoke',
    'ветер крепчает', 'wind rises',
    'акира', 'akira',
    'евангелион', 'evangelion',
    'клинок, рассекающий', 'клинок рассекающий', 'demon slayer',
    'магическая битва', 'jujutsu kaisen',
    'атака титанов', 'attack on titan'
  ];
  return animeKeywords.some(kw => t.includes(kw));
}

export const FANFILM_PINNED_CAROUSEL_IDS = new Set([
  '2699', '3303', '2955', '2602', '2927', '3398', '3999', '3324', '2907',
  '13962', '73057', '4165', '3319', '80233', '75166', '81746', '4066', '82029', '70512'
]);

/**
 * Парсинг списка медиа карточек из HTML FanFilm4K
 */
function parseMediaList(html, { category = 'popular', page = 1 } = {}) {
  const $ = cheerio.load(html);
  const items = [];

  // Исключаем сквозную карусель сайта (.carou, #owl-carou) для всех страниц категорий и пагинации,
  // чтобы исключить повторение 24 карточек верхнего сквозного слайдера сайта
  if (category !== 'popular' || page > 1) {
    $('.carou, #owl-carou, .top, [class*="carou"], [id*="carou"]').remove();
  }

  let selector = '#dle-content .card';
  if ($('#dle-content .card').length === 0) {
    selector = '.card';
  }
  if (category === 'popular' && page === 1) {
    selector = '.top, ' + selector;
  }

  $(selector).each((_, element) => {
    const el = $(element);
    
    // Ссылка на страницу фильма
    let link = el.attr('href') || el.find('a').first().attr('href') || '';
    if (!link) return;
    if (link.startsWith('/')) link = `${BASE_URL}${link}`;

    // ID новости FanFilm4K
    const idMatch = link.match(/\/(\d+)-/);
    const id = idMatch ? idMatch[1] : link;

    // Название
    let title = el.find('.infoca a').first().text().trim() ||
                el.find('.top__title, .card__title, .poster__title, h2, h3').first().text().trim();
    if (!title) {
      title = el.find('img').first().attr('alt') || el.find('img').first().attr('title') || '';
    }
    if (!title) return;

    // Очистка от "постер 4К", "постер", "4K", "смотреть"
    title = title
      .replace(/\s*постер\s*(?:4[kк]|hd|uhd)?/gi, '')
      .replace(/\s*[\(\[]?\s*4[KkКк]\s*(?:Ultra\s*HD|UHD)?\s*[\)\]]?/gi, '')
      .replace(/\s*\(?(?:фильм|сериал)\)?\s*$/i, '')
      .replace(/\s*смотреть(?:\s+онлайн)?/gi, '')
      .trim();

    // Картинка постера
    let poster = el.find('img').first().attr('data-src') || el.find('img').first().attr('src') || '';
    if (poster && poster.startsWith('/')) poster = `${BASE_URL}${poster}`;

    // Лейбл 4K / Качество (FanFilm4K специализирован на 4K UHD)
    const isTS = el.text().includes('TS') || title.includes('TS');
    const is4K = true;
    const quality = isTS ? 'TS / Экранка' : '4K Ultra HD';

    // Точный год выпуска
    const tagLeft = el.find('.tag.top-left, .card__year, .top__year').first().text().trim();
    const realYear = resolveMediaYear(title, link, poster, tagLeft);

    // Рейтинг (строго из правого тега, без смешивания с годом)
    let ratingText = el.find('.tag.top-right').first().text().replace(/[^\d\.]/g, '').trim();
    if (!ratingText) {
      const rm = el.text().match(/(?:⭐|★|рейтинг:?)\s*([\d\.]+)/i);
      if (rm) ratingText = rm[1];
    }

    // Классификация типа медиа с защитой от попадания аниме в мультфильмы
    let mediaType = 'movie';
    if (isAnimeLinkOrTitle(title, link, category)) {
      mediaType = link.includes('serial') || link.includes('multserialy') ? 'anime-series' : 'anime-movie';
    } else if (link.includes('serial') || link.includes('fan-serials') || title.toLowerCase().includes('сериал')) {
      mediaType = 'series';
    } else if (link.includes('mult') || title.toLowerCase().includes('мульт') || category.includes('cartoon')) {
      mediaType = 'cartoon';
    }

    // Проверяем дубликаты и исключаем сквозную карусель сайта
    if ((category !== 'popular' || page > 1) && FANFILM_PINNED_CAROUSEL_IDS.has(String(id))) {
      return;
    }
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
        year: realYear || '2025',
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
      path = page === 1 ? '/' : `/page/${page}/`;
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
    const items = parseMediaList(html, { category, page });

    const $ = cheerio.load(html);
    let totalPages = 1;
    $('.navigation a, .nav_ext a, .pages a').each((_, el) => {
      const txt = $(el).text().trim();
      const num = parseInt(txt, 10);
      if (!isNaN(num) && num > totalPages) totalPages = num;
      const href = $(el).attr('href') || '';
      const m = href.match(/\/page\/(\d+)\//);
      if (m) {
        const p = parseInt(m[1], 10);
        if (p > totalPages) totalPages = p;
      }
    });

    if (totalPages === 1) {
      if (category === 'movies') totalPages = 718;
      else if (category === 'series') totalPages = 162;
      else if (category === 'cartoons') totalPages = 35;
      else if (category === 'cartoon-series') totalPages = 20;
      else totalPages = 50;
    }

    const result = {
      page,
      category,
      total_pages: totalPages,
      total_items: totalPages * Math.max(20, items.length || 56),
      items
    };

    setCache('fanfilm4k', cacheKey, result, 1800); // 30 минут
    return result;
  } catch (err) {
    console.error(`[FanFilm4K] Ошибка получения каталога ${category}:`, err.message);
    return { page, category, total_pages: 1, total_items: 0, items: [] };
  }
}

/**
 * Поиск по названию в FanFilm4K
 */
export async function searchFanFilm(query) {
  if (!query || !query.trim()) return [];

  const cleanQuery = query.trim();

  // Поддержка поиска по прямой ссылке на новость FanFilm4K
  if (/fanfilm4k\.media\/(\d+)[^\s]*/i.test(cleanQuery)) {
    const details = await getFanFilmDetails(cleanQuery);
    if (details) {
      return [{
        id: details.id,
        source: 'fanfilm4k',
        title: details.title,
        original_title: details.original_title || '',
        link: cleanQuery,
        poster: details.poster,
        quality: details.quality || '4K Ultra HD',
        is4K: true,
        year: details.year || resolveMediaYear(details.title, cleanQuery, details.poster) || '2026',
        rating: details.rating || 8.0,
        media_type: details.media_type || 'movie',
        description: details.description || ''
      }];
    }
  }

  const cacheKey = `search_${cleanQuery.toLowerCase()}`;
  const cached = getCache('fanfilm4k', cacheKey);
  if (cached) return cached;

  try {
    const formData = new URLSearchParams();
    formData.append('do', 'search');
    formData.append('subaction', 'search');
    formData.append('story', cleanQuery);

    const html = await fetchHtml(`${BASE_URL}/index.php?do=search`, {
      method: 'POST',
      body: formData,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const items = parseMediaList(html, { category: 'search', page: 1 });
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
  let url = String(idOrUrl).trim();
  if (!url.startsWith('http')) {
    const cachedLink = getCache('fanfilm4k', `item_link_${idOrUrl}`);
    if (cachedLink) {
      url = cachedLink;
    } else if (url.includes('-')) {
      url = `${BASE_URL}/${idOrUrl.replace(/\.html$/i, '')}.html`;
    } else {
      // DLE канонический редирект по числовому ID новости: /index.php?newsid=12345
      url = `${BASE_URL}/index.php?newsid=${idOrUrl}`;
    }
  }

  const cacheKey = `details_${idOrUrl}`;
  const cached = getCache('fanfilm4k', cacheKey);
  if (cached) return cached;

  try {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    const title = $('h1').first().text().trim() || $('title').text().replace(/смотреть онлайн.*/i, '').trim();
    if (!$('h1').length || !title || title.includes('FANFILM4K') || title.includes('ФАН4К –')) {
      return null;
    }
    let poster = $('.pmovie__poster img, .poster img').first().attr('src') || $('meta[property="og:image"]').attr('content') || '';
    if (poster && poster.startsWith('/')) poster = `${BASE_URL}${poster}`;

    const originalTitle = $('meta[property="ya:original_name"]').attr('content') || '';
    const description = $('.pmovie__text, .description, meta[property="og:description"]').first().text().trim() ||
                        $('meta[property="og:description"]').attr('content') || '';

    // Метаданные из блока характеристик (.page__subcols и .info-row)
    const subcolsText = $('.page__subcols').text().replace(/\s+/g, ' ').trim();

    // Год
    let year = '';
    const knownYr = resolveMediaYear(title, url, poster);
    if (knownYr) {
      year = knownYr;
    } else {
      const ym = subcolsText.match(/\|\s*(\d{4})\b/) || subcolsText.match(/\b(19\d\d|20\d\d)\b/);
      if (ym && parseInt(ym[1], 10) <= 2030) {
        year = ym[1];
      }
      if (!year) {
        year = resolveMediaYear(title, url, poster);
      }
    }

    // Рейтинг
    let rating = 0;
    const kpRatingMatch = subcolsText.match(/Рейтинг КП\s*([\d\.]+)/i);
    const imdbRatingMatch = subcolsText.match(/Рейтинг IMDb\s*([\d\.]+)/i);
    if (kpRatingMatch) rating = parseFloat(kpRatingMatch[1]);
    else if (imdbRatingMatch) rating = parseFloat(imdbRatingMatch[1]);

    let genres = '', countries = '', director = '', actors = '', duration = '', slogan = '', premiere = '';

    $('.info-row').each((_, el) => {
      const label = $(el).find('.info-label').text().trim().toLowerCase();
      const value = $(el).text().replace($(el).find('.info-label').text(), '').replace(/\s+/g, ' ').trim();
      if (label.includes('жанр')) genres = value;
      else if (label.includes('страна')) countries = value;
      else if (label.includes('режисс')) director = value;
      else if (label.includes('актёр')) actors = value;
      else if (label.includes('длительн')) duration = value;
      else if (label.includes('слоган')) slogan = value;
      else if (label.includes('премьер')) premiere = value;
    });

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
        badge: 'FANFILM 4K',
        status: 'working',
        status_label: '🟢 Онлайн',
        audio_info: 'Многоканальный звук Dolby Digital',
        speed: '⚡ Сверхскоростной CDN',
        url: player4kIframe.startsWith('//') ? `https:${player4kIframe}` : player4kIframe,
        is_recommended: true,
        recommended_badge: '🔥 Рекомендуемый'
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
      year: year || '',
      premiere: premiere || '',
      release_date: premiere || (year ? `${year}-01-01` : ''),
      rating: rating || 8.0,
      genres,
      countries,
      director,
      actors,
      duration,
      slogan,
      is4K: true,
      quality: '4K Ultra HD',
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
