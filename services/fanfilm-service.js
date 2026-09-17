import * as cheerio from 'cheerio';
import { getCache, setCache } from '../db.js';
import { ensureValidDescription } from './canonical-descriptions.js';
import {
  resolveCanonicalMediaType,
  resolveCanonicalYear,
  resolveCanonicalGenres,
  KNOWN_RELEASE_YEARS as INTEL_RELEASE_YEARS
} from './canonical-media-intel.js';

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
  'проект конец света': '2026',
  'проект «конец света»': '2026',
  'закулисье реальности': '2026',
  'я не киллер': '2023',
  'hit man': '2023',
  'хищник: планета смерти': '2025',
  'хищник планета смерти': '2025',
  'планета смерти': '2025',
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

  // Звёздные войны
  'изгой-один: звёздные войны. истории': '2016',
  'изгой-один': '2016',
  'изгой один': '2016',
  'rogue one: a star wars story': '2016',
  'rogue one': '2016',
  'звёздные войны: эпизод 1 — скрытая угроза': '1999',
  'звёздные войны: эпизод 2 — атака клонов': '2002',
  'звёздные войны: эпизод 3 — месть ситхов': '2005',
  'звёздные войны: эпизод 4 — новая надежда': '1977',
  'звёздные войны: эпизод 5 — империя наносит ответный удар': '1980',
  'звёздные войны: эпизод 6 — возвращение джедая': '1983',
  'звёздные войны: эпизод 7 — пробуждение силы': '2015',
  'звёздные войны: эпизод 8 — последние джедаи': '2017',
  'звёздные войны: эпизод 9 — скайуокер. восход': '2019',
  'хан соло: звёздные войны. истории': '2018',
  'звёздные войны: скрытая угроза': '1999',
  'звёздные войны: новая надежда': '1977',
  'звёздные войны': '1977',
  'star wars': '1977',

  // Гарри Поттер
  'гарри поттер и философский камень': '2001',
  'гарри поттер и тайная комната': '2002',
  'гарри поттер и узник азкабана': '2004',
  'гарри поттер и кубок огня': '2005',
  'гарри поттер и орден феникса': '2007',
  'гарри поттер и принц-полукровка': '2009',
  'гарри поттер и дары смерти: часть 1': '2010',
  'гарри поттер и дары смерти: часть 2': '2011',
  'гарри поттер': '2001',
  'harry potter': '2001',

  // Властелин Колец и Хоббит
  'властелин колец: братство кольца': '2001',
  'властелин колец: две крепости': '2002',
  'властелин колец: возвращение короля': '2003',
  'властелин колец': '2001',
  'хоббит: нежданное путешествие': '2012',
  'хоббит: пустошь смауга': '2013',
  'хоббит: битва пяти воинств': '2014',

  // Пираты Карибского моря
  'пираты карибского моря: проклятие черной жемчужины': '2003',
  'пираты карибского моря: проклятие чёрной жемчужины': '2003',
  'пираты карибского моря: сундук мертвеца': '2006',
  'пираты карибского моря: на краю света': '2007',
  'пираты карибского моря: на странных берегах': '2011',
  'пираты карибского моря: мертвецы не рассказывают сказки': '2017',
  'пираты карибского моря': '2003',

  // Marvel & DC
  'мстители': '2012',
  'мстители: эра альтрона': '2015',
  'мстители: война бесконечности': '2018',
  'мстители: финал': '2019',
  'железный человек': '2008',
  'железный человек 2': '2010',
  'железный человек 3': '2013',
  'тор': '2011',
  'тор 2: царство тьмы': '2013',
  'тор: рагнарёк': '2017',
  'тор: любовь и гром': '2022',
  'первый мститель': '2011',
  'первый мститель: другая война': '2014',
  'первый мститель: противостояние': '2016',
  'доктор стрэндж': '2016',
  'доктор стрэндж: в мультивселенной безумия': '2022',
  'стражи галактики': '2014',
  'стражи галактики. часть 2': '2017',
  'стражи галактики. часть 3': '2023',
  'дюна': '2021',

  // Терминатор, Чужой, Хищник
  'терминатор': '1984',
  'терминатор 2: судный день': '1991',
  'терминатор 2': '1991',
  'терминатор 3: восстание машин': '2003',
  'терминатор: да придет спаситель': '2009',
  'терминатор: генезис': '2015',
  'терминатор: темные судьбы': '2019',
  'чужой': '1979',
  'чужие': '1986',
  'чужой 3': '1992',
  'чужой: воскрешение': '1997',
  'прометей': '2012',
  'чужой: завет': '2017',
  'чужой: ромул': '2024',
  'хищник': '1987',
  'хищник 2': '1990',
  'хищники': '2010',
  'хищник: добыча': '2022',
  'парк юрского периода': '1993',
  'мир юрского периода': '2015',
  'мир юрского периода 2': '2018',
  'мир юрского периода: господство': '2022',

  // Культовое кино
  'назад в будущее': '1985',
  'назад в будущее 2': '1989',
  'назад в будущее 3': '1990',
  'один дома': '1990',
  'один дома 2: затерянный в нью-йорке': '1992',
  'криминальное чтиво': '1994',
  'бойцовский клуб': '1999',
  'побег из шоушенка': '1994',
  'зеленая миля': '1999',
  'зелёная миля': '1999',
  'форрест гамп': '1994',
  'леон': '1994',
  'пятый элемент': '1997',
  'эйс вентура: розыск домашних животных': '1994',
  'эйс вентура 2: когда зовет природа': '1995',
  'эйс вентура': '1994',
  'маска': '1994',
  'шоу трумана': '1998',
  'тупой и еще тупее': '1994',
  'вечное сияние чистого разума': '2004',
  'брюс всемогущий': '2003',
  'лжец, лжец': '1997',
  'остров проклятых': '2010',
  'волк с уолл-стрит': '2013',
  'отступники': '2006',
  'поймай меня, если сможешь': '2002',
  'омерзительная восьмерка': '2015',
  'джанго освобожденный': '2012',
  'бесславные ублюдки': '2009',
  'убить билла': '2003',
  'убить билла 2': '2004',
  'бешеные псы': '1992',

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

  // 1. Из ссылки FanFilm4K: e.g. -(\d{4})\.html или -(\d{4})-
  if (link) {
    const lm = String(link).match(/(?:-|_|\/|\b)(19\d\d|20\d\d)(?:\.html|\/|$)/) ||
               String(link).match(/-(\d{4})(?:-|\.html)/);
    if (lm) {
      const parsedYr = parseInt(lm[1], 10);
      if (parsedYr >= 1920 && parsedYr <= 2030) {
        return lm[1];
      }
    }
  }

  // 2. Из тега .tag.top-left
  if (tagYear) {
    const tm = String(tagYear).match(/\b(19\d\d|20\d\d)\b/);
    if (tm) return tm[1];
  }

  // 3. Из заголовка (только если год реальный: от 1920 до 2028)
  const ym = String(title || '').match(/[\(\[]\s*(\d{4})\s*[\)\]]/) ||
             String(title || '').match(/\b(19\d\d|20\d\d)\b/);
  if (ym) {
    const yrNum = parseInt(ym[1], 10);
    if (yrNum >= 1920 && yrNum <= 2028 && yrNum !== 2049 && yrNum !== 2077 && yrNum !== 2000 && yrNum !== 2001 && yrNum !== 2010 && yrNum !== 2012 && yrNum !== 1984 && yrNum !== 1917) {
      return ym[1];
    }
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
    let rawTitle = el.find('.infoca a').first().text().trim() ||
                el.find('.top__title, .card__title, .poster__title, h2, h3').first().text().trim();
    if (!rawTitle) {
      rawTitle = el.find('img').first().attr('alt') || el.find('img').first().attr('title') || '';
    }
    if (!rawTitle) return;

    const isExplicitSeries = /\(?(?:сериал|дорама|все сезоны|сезон)\)?/i.test(rawTitle) || /\/(?:serials?|dorama)\//i.test(link);

    // Очистка от "постер 4К", "постер", "4K", "смотреть"
    let title = rawTitle
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
    const realYear = resolveCanonicalYear(title, link, poster, tagLeft);

    // Рейтинг (строго из правого тега, без смешивания с годом)
    let ratingText = el.find('.tag.top-right').first().text().replace(/[^\d\.]/g, '').trim();
    if (!ratingText) {
      const rm = el.text().match(/(?:⭐|★|рейтинг:?)\s*([\d\.]+)/i);
      if (rm) ratingText = rm[1];
    }

    // Жанры из карточки HTML или канонической базы
    const rawCardGenres = el.find('.card__genre, .card__cat, .cat, .category, .tags a, a[href*="genre"], a[href*="xfsearch"]').text().trim();
    const genres = resolveCanonicalGenres(title, isExplicitSeries ? 'series' : category, '', rawCardGenres);
    if (isExplicitSeries && !genres.includes('Сериал')) {
      genres.push('Сериал');
    }

    // Классификация типа медиа с защитой от ошибок
    const mediaType = resolveCanonicalMediaType(title, link, isExplicitSeries ? 'series' : category, genres, { isSeries: isExplicitSeries });

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
        year: realYear || '2026',
        rating: parseFloat(ratingText) || 0,
        genres,
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
  const queryWithoutSeason = cleanQuery
    .replace(/\s*[\(\[]?\s*\d+\s*(?:-?[йяе]|ый|ой)?\s*сезон\s*[\)\]]?/gi, '')
    .replace(/\s*[\(\[]?\s*season\s*\d+\s*[\)\]]?/gi, '')
    .replace(/\s*[\(\[]?\s*4[KkКк]\s*[\)\]]?/gi, '')
    .trim();

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
        year: details.year || resolveMediaYear(details.title, cleanQuery, details.poster) || '',
        rating: details.rating || 8.0,
        media_type: details.media_type || 'movie',
        description: details.description || ensureValidDescription(details) || ''
      }];
    }
  }

  const cacheKey = `search_${cleanQuery.toLowerCase()}`;
  const cached = getCache('fanfilm4k', cacheKey);
  if (cached) return cached;

  try {
    const performSearch = async (term) => {
      const formData = new URLSearchParams();
      formData.append('do', 'search');
      formData.append('subaction', 'search');
      formData.append('story', term);

      const html = await fetchHtml(`${BASE_URL}/index.php?do=search`, {
        method: 'POST',
        body: formData,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });
      return parseMediaList(html, { category: 'search', page: 1 });
    };

    let items = await performSearch(cleanQuery);
    if ((!items || items.length === 0) && queryWithoutSeason && queryWithoutSeason !== cleanQuery) {
      items = await performSearch(queryWithoutSeason);
    }

    setCache('fanfilm4k', cacheKey, items || [], 900); // 15 минут
    return items || [];
  } catch (err) {
    console.error(`[FanFilm4K] Ошибка поиска по запросу "${query}":`, err.message);
    if (queryWithoutSeason && queryWithoutSeason !== cleanQuery) {
      try {
        const fallbackItems = await performSearch(queryWithoutSeason);
        return fallbackItems || [];
      } catch {}
    }
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

    // 1. Kinopoisk ID из тегов ins, постера, ссылок
    let kpId = $('ins[data-type="kp"]').attr('data-id') ||
               $('[data-tab-content="hdplayer"] ins').attr('data-id') ||
               $('ins[data-id]').attr('data-id') || '';
    if (!kpId) {
      const posterSrc = $('meta[property="og:image"]').attr('content') || $('.pmovie__poster img').attr('src') || '';
      const mKp = posterSrc.match(/\/(\d{3,8})_\d+\./);
      if (mKp) kpId = mKp[1];
    }
    if (!kpId) {
      const kpLink = $('a[href*="kinopoisk.ru/film/"], a[href*="kinopoisk.ru/series/"]').attr('href') || '';
      const mLink = kpLink.match(/film\/(\d+)|series\/(\d+)/);
      if (mLink) kpId = mLink[1] || mLink[2];
    }

    // 2. Определение активной вкладки на сайте FanFilm4K
    const isHdActive = $('.tab-btn[data-tab="hdplayer"]').hasClass('is-active') ||
                       $('[data-tab="hdplayer"]').hasClass('is-active') ||
                       (html && (html.includes('class="tab-btn is-active" data-tab="hdplayer"') || html.includes('data-tab="hdplayer" class="tab-btn is-active"')));
    const is4kActive = $('.tab-btn[data-tab="4kplayer"]').hasClass('is-active') ||
                       $('[data-tab="4kplayer"]').hasClass('is-active') ||
                       (html && (html.includes('class="tab-btn is-active" data-tab="4kplayer"') || html.includes('data-tab="4kplayer" class="tab-btn is-active"')));

    // 3. Плеер 4K Ultra HD (transfusion-as / stravers / fanfilm direct iframe)
    const player4kIframe = $('[data-tab-content="4kplayer"] iframe').attr('src') || '';
    let is4kStreamHealthy = true;
    let final4kUrl = '';
    if (player4kIframe) {
      final4kUrl = player4kIframe.startsWith('//') ? `https:${player4kIframe}` : player4kIframe;
      if (final4kUrl.includes('stravers.live') || final4kUrl.includes('transfusion')) {
        try {
          const chkRes = await fetch(final4kUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
              'Referer': url
            },
            signal: AbortSignal.timeout(3000)
          });
          if (chkRes.ok) {
            const chkText = await chkRes.text();
            const hasFileList = chkText.includes('const fileList =') || chkText.includes('fileList');
            const hasConfig = chkText.includes('const config =') || chkText.includes('mediaMetadata');
            if (hasFileList || hasConfig) {
              is4kStreamHealthy = true;
            } else if (chkText.toLowerCase().includes('404 not found') || chkText.toLowerCase().includes('видео удалено')) {
              is4kStreamHealthy = false;
            }
          } else if (chkRes.status === 404) {
            is4kStreamHealthy = false;
          }
        } catch {
          is4kStreamHealthy = true;
        }
      }
    }

    // Плееры
    const players = [];

    // 1. 4K Ultra HD Плеер FanFilm (основной рекомендованный источник FanFilm4K)
    if (player4kIframe) {
      players.push({
        id: 'fanfilm4k_uhd',
        name: '4K Ultra HD Плеер (FanFilm4K)',
        type: 'iframe',
        quality: '4K UHD',
        badge: 'FANFILM 4K',
        status: 'working',
        status_label: '🟢 Онлайн',
        audio_info: 'Многоканальный звук Dolby Digital и 4K Ultra HD',
        speed: '💎 Премиум 4K CDN',
        url: final4kUrl,
        is_recommended: true,
        recommended_badge: '🔥 4K Рекомендуемый'
      });
    }

    // 2. Дополнительные проверенные студии при наличии Kinopoisk ID
    if (kpId) {
      // Kodik Multi-balancer
      players.push({
        id: 'kodik_direct',
        name: 'Kodik Плеер (сериалы и озвучки)',
        type: 'iframe',
        quality: '1080p FHD',
        badge: 'KODIK',
        status: 'working',
        status_label: '🟢 Онлайн',
        audio_info: 'Большой выбор студийных озвучек',
        speed: '⚡ Быстрый поток',
        url: `https://kodikplayer.com/find-player?kinopoiskID=${kpId}`,
        is_recommended: !player4kIframe,
        recommended_badge: !player4kIframe ? '🔥 Рекомендуемый' : ''
      });

      // HDRezka Studio
      players.push({
        id: 'rezka_cinema',
        name: 'HDRezka Cinema (FHD и 4K)',
        type: 'iframe',
        quality: '1080p FHD',
        badge: 'HDREZKA',
        status: 'working',
        status_label: '🟢 Онлайн',
        audio_info: 'Студийный перевод HDRezka Studio',
        speed: '⚡ Высокая скорость',
        url: `https://kodikplayer.com/find-player?kinopoiskID=${kpId}&translation=hdrezka`,
        is_recommended: false
      });

      // LostFilm Series
      players.push({
        id: 'lostfilm_player',
        name: 'LostFilm Series (дубляж)',
        type: 'iframe',
        quality: '1080p FHD',
        badge: 'LOSTFILM',
        status: 'working',
        status_label: '🟢 Онлайн',
        audio_info: 'Официальный дубляж LostFilm',
        speed: '⚡ Студийный поток',
        url: `https://kodikplayer.com/find-player?kinopoiskID=${kpId}&translation=lostfilm`,
        is_recommended: false
      });

      // Red Head Sound
      players.push({
        id: 'rhs_player',
        name: 'Red Head Sound (RHS дубляж)',
        type: 'iframe',
        quality: '1080p FHD',
        badge: 'RHS',
        status: 'working',
        status_label: '🟢 Онлайн',
        audio_info: 'Профессиональный дубляж Red Head Sound',
        speed: '⚡ Студийный поток',
        url: `https://kodikplayer.com/find-player?kinopoiskID=${kpId}&translation=rhs`,
        is_recommended: false
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

    const detectedType = resolveCanonicalMediaType(title, url, '', genres, { total_episodes: players.length, season: 1 });
    const canonicalGenres = resolveCanonicalGenres(title, '', description, genres);
    const resolvedYear = year || resolveCanonicalYear(title, url, poster, premiere) || '2026';

    let formattedDuration = duration;
    if (duration) {
      const durNum = parseInt(duration, 10);
      if (durNum && !duration.includes('ч')) {
        const h = Math.floor(durNum / 60);
        const m = durNum % 60;
        formattedDuration = h > 0 ? (m > 0 ? `${h} ч ${m} мин` : `${h} ч`) : `${m} мин`;
      }
    }

    const directorsList = director ? director.split(/[,;/]+/).map((d, i) => ({
      id: i + 1,
      name: d.trim(),
      role: 'Режиссер',
      photo: null
    })).filter(d => d.name) : [];

    const castList = actors ? actors.split(/[,;/]+/).map((a, i) => ({
      id: i + 1,
      name: a.trim(),
      character: 'В главных ролях',
      photo: null
    })).filter(a => a.name) : [];

    const result = {
      id: String(idOrUrl),
      source: 'fanfilm4k',
      title,
      original_title: originalTitle,
      poster,
      description,
      year: resolvedYear,
      premiere: premiere || (resolvedYear ? `${resolvedYear} год` : ''),
      release_date: premiere || (resolvedYear ? `${resolvedYear}-01-01` : ''),
      rating: rating || 8.0,
      genres: canonicalGenres,
      media_type: detectedType,
      category: detectedType === 'series' ? 'Сериал' : (detectedType.includes('anime') ? 'Аниме' : (detectedType.includes('cartoon') ? 'Мультфильм' : 'Фильм')),
      countries,
      director,
      directors: directorsList,
      actors,
      cast: castList,
      duration: formattedDuration,
      slogan,
      is4K: Boolean(player4kIframe),
      quality: player4kIframe ? '4K Ultra HD' : '1080p Full HD',
      kp_id: kpId,
      fanfilm_hd_url: '',
      likes,
      dislikes,
      vote_count: voteCount,
      frames,
      players
    };

    result.description = ensureValidDescription(result);

    setCache('fanfilm4k', cacheKey, result, 3600); // 1 час
    return result;
  } catch (err) {
    console.error(`[FanFilm4K] Ошибка получения деталей для ${idOrUrl}:`, err.message);
    return null;
  }
}
