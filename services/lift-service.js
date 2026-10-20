import https from 'node:https';
import http from 'node:http';

/**
 * Сервис прямой интеграции с базой и мультитрековым Ad-Free балансером Lift (liftw.ws / liftapp.ink)
 * Обеспечивает:
 * - Встроенный обход DNS-блокировок (DoH Cloudflare + закрепленный IP 89.42.231.205 для *.liftw.ws / lateremb.ws)
 * - Доступ к каталогу 88 000+ фильмов, сериалов, мультфильмов и аниме
 * - Извлечение чистых потоков HLS (H.264/AAC), DASH (VP9/Opus) и DASHA (AV1/Opus) вплоть до 4K UHD без рекламы
 * - Полный список студий озвучки (audio.names), субтитров (.vtt), таймкодов пропуска (sections) и превью (preview)
 */

const LIFT_PRIMARY_IP = '89.42.231.205';
let cachedLiftIp = LIFT_PRIMARY_IP;
let lastDnsCheckAt = 0;

const LIFT_DOMAINS = new Set([
  'liftw.ws',
  'api.liftw.ws',
  'embed.liftw.ws',
  'img.liftw.ws',
  'lateremb.ws',
  'liftapp.ink'
]);

const LIFT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Кастомный DNS-lookup для мгновенного соединения с серверами Lift без зависимости от провайдерского DNS
 */
function liftCustomLookup(hostname, options, callback) {
  if ( typeof options === 'function' ) {
    callback = options;
    options = {};
  }
  const cleanHost = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (LIFT_DOMAINS.has(cleanHost) || cleanHost.endsWith('.liftw.ws')) {
    const ip = cachedLiftIp || LIFT_PRIMARY_IP;
    if (options && options.all) {
      return callback(null, [{ address: ip, family: 4 }]);
    }
    return callback(null, ip, 4);
  }
  // Для CDN видеопотоков (*.interkh.com и др.) используем системный DNS или DoH
  import('node:dns').then(dns => {
    dns.lookup(hostname, options || {}, callback);
  }).catch(err => callback(err));
}

const liftHttpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 32,
  timeout: 10000,
  lookup: liftCustomLookup
});

/**
 * Фоновое обновление IP через Cloudflare DoH при необходимости
 */
export async function refreshLiftDnsIfNeeded(force = false) {
  const now = Date.now();
  if (!force && now - lastDnsCheckAt < 15 * 60 * 1000) {
    return cachedLiftIp;
  }
  lastDnsCheckAt = now;
  try {
    const res = await fetch('https://1.1.1.1/dns-query?name=liftw.ws&type=A', {
      headers: { Accept: 'application/dns-json' },
      signal: AbortSignal.timeout(3000)
    });
    if (res.ok) {
      const data = await res.json();
      const aRecord = Array.isArray(data.Answer)
        ? data.Answer.find(a => a.type === 1 && a.data && !a.data.startsWith('185.151.'))
        : null;
      if (aRecord && aRecord.data) {
        cachedLiftIp = aRecord.data.trim();
      }
    }
  } catch (_) {}
  return cachedLiftIp;
}

/**
 * Низкоуровневый HTTP/HTTPS запрос с поддержкой закрепленного IP для *.liftw.ws
 */
export function liftRequestRaw(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(urlStr);
    } catch (e) {
      return reject(e);
    }

    const isHttps = parsedUrl.protocol === 'https:';
    const isLiftHost = LIFT_DOMAINS.has(parsedUrl.hostname) || parsedUrl.hostname.endsWith('.liftw.ws');
    const timeoutMs = options.timeout || 8000;
    const method = (options.method || 'GET').toUpperCase();
    const bodyBuffer = options.body
      ? (Buffer.isBuffer(options.body) ? options.body : Buffer.from(typeof options.body === 'string' ? options.body : JSON.stringify(options.body)))
      : null;

    const headers = {
      'User-Agent': LIFT_USER_AGENT,
      'Accept': options.accept || 'application/json, text/html, */*',
      'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      'Origin': options.origin || 'https://liftw.ws',
      'Referer': options.referer || 'https://liftw.ws/',
      ...(options.headers || {})
    };

    if (bodyBuffer) {
      headers['Content-Length'] = bodyBuffer.length;
      if (!headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }
    }

    const reqOptions = {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers,
      agent: (isHttps && isLiftHost) ? liftHttpsAgent : undefined,
      timeout: timeoutMs
    };

    const transport = isHttps ? https : http;
    const req = transport.request(reqOptions, (res) => {
      // Обработка редиректов (301, 302, 307, 308)
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && (options._redirects || 0) < 4) {
        res.resume();
        const nextUrl = new URL(res.headers.location, urlStr).toString();
        return resolve(liftRequestRaw(nextUrl, { ...options, _redirects: (options._redirects || 0) + 1 }));
      }

      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          headers: res.headers,
          buffer,
          text: () => buffer.toString('utf8'),
          json: () => JSON.parse(buffer.toString('utf8'))
        });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`LIFT_TIMEOUT (${timeoutMs}ms): ${urlStr}`));
    });
    req.on('error', err => reject(err));

    if (bodyBuffer) {
      req.write(bodyBuffer);
    }
    req.end();
  });
}

export async function liftFetchText(urlStr, timeoutMs = 8000, extraHeaders = {}) {
  const res = await liftRequestRaw(urlStr, { timeout: timeoutMs, headers: extraHeaders });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${urlStr}`);
  return res.text();
}

export async function liftFetchJson(urlStr, timeoutMs = 8000, options = {}) {
  const res = await liftRequestRaw(urlStr, { ...options, timeout: timeoutMs });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${urlStr}`);
  return res.json();
}

// Простой in-memory кэш с TTL
const liftCache = new Map();
function getCached(key) {
  const entry = liftCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    liftCache.delete(key);
    return null;
  }
  return entry.value;
}
function setCached(key, value, ttlMs = 10 * 60 * 1000) {
  if (liftCache.size > 1500) {
    const firstKey = liftCache.keys().next().value;
    if (firstKey) liftCache.delete(firstKey);
  }
  liftCache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

/**
 * Преобразование URL постера/аватара Lift в наш прокси, чтобы изображения
 * гарантированно открывались даже если у клиента не резолвится img.liftw.ws
 */
export function normalizeLiftImageUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (trimmed.includes('img.liftw.ws')) {
    return `/api/media/image-proxy?url=${encodeURIComponent(trimmed)}`;
  }
  return trimmed;
}

/**
 * Определение типа медиа STORM по числовому типу Lift (1..7)
 */
export function mapLiftTypeToStormType(liftType, serialStatus = '') {
  const t = Number(liftType || 0);
  if (t === 2) return 'cartoons';
  if (t === 3) return 'series';
  if (t === 4) return 'series';
  if (t === 5) return 'cartoon-series';
  if (t === 6) return 'anime-movies';
  if (t === 7) return 'anime-series';
  if (serialStatus && String(serialStatus).trim()) return 'series';
  return 'movies';
}

/**
 * Нормализация элемента каталога Lift в единый формат карточки STORM MULTIMEDIA
 */
export function normalizeLiftMediaItem(raw = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const info = raw.info || {};
  const liftId = String(raw.id || info.id || '').trim();
  if (!liftId) return null;

  const title = String(raw.name || info.name || raw.title || 'Без названия').trim();
  const originalTitle = String(raw.origin_name || info.name_eng || '').trim();
  const year = String(raw.year || info.year || '').trim();
  const kpRating = Number(raw.kp_rating || raw.kp || info.kp_rating || info.kp || 0);
  const imdbRating = Number(raw.imdb_rating || raw.imdb || info.imdb_rating || info.imdb || 0);
  const bestRating = kpRating > 0 ? kpRating : imdbRating;
  const rawQuality = String(raw.quality || 'FHD').toUpperCase();
  const qualityBadge = rawQuality.includes('4K') || rawQuality.includes('UHD') ? '4K UHD' : '1080p FHD';
  const mediaType = mapLiftTypeToStormType(raw.type, raw.serial_status);
  const isSeries = ['series', 'cartoon-series', 'anime-series'].includes(mediaType);

  const rawPoster = info.poster_big || info.poster || raw.poster || '';
  const poster = normalizeLiftImageUrl(rawPoster);

  const genres = Array.isArray(info.genre)
    ? info.genre
    : (typeof info.genre === 'string' ? info.genre.split(',').map(s => s.trim()).filter(Boolean) : []);

  const countries = Array.isArray(info.country)
    ? info.country
    : (typeof info.country === 'string' ? info.country.split(',').map(s => s.trim()).filter(Boolean) : []);

  return {
    id: `lift_${liftId}`,
    lift_id: liftId,
    source: 'lift',
    source_badge: 'LIFT • БЕЗ РЕКЛАМЫ',
    title,
    original_title: originalTitle,
    year: year || '2026',
    poster,
    backdrop: poster,
    rating: bestRating > 0 ? Number(bestRating.toFixed(1)) : 0,
    kp_rating: kpRating > 0 ? Number(kpRating.toFixed(1)) : 0,
    imdb_rating: imdbRating > 0 ? Number(imdbRating.toFixed(1)) : 0,
    rating_kp: kpRating > 0 ? Number(kpRating.toFixed(1)) : 0,
    rating_imdb: imdbRating > 0 ? Number(imdbRating.toFixed(1)) : 0,
    quality: qualityBadge,
    is_4k: qualityBadge === '4K UHD',
    media_type: mediaType,
    is_series: isSeries,
    serial_status: String(raw.serial_status || '').trim(),
    views: Number(raw.views || 0),
    genres,
    countries,
    country: countries.join(', '),
    description: String(info.description || raw.description || '').trim(),
    duration: String(info.time || '').trim(),
    parts: Array.isArray(raw.parts) ? raw.parts : [],
    iframe_uri: raw.iframe_uri || `https://embed.liftw.ws/embed/movie/${liftId}?host=liftw.ws`,
    ad_free: true
  };
}

/**
 * Поиск по базе Lift (88 000+ фильмов и сериалов)
 */
export async function searchLift(query, limit = 24) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) return [];

  const cacheKey = `search:${cleanQuery.toLowerCase()}:${limit}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const res = await liftRequestRaw(`https://api.liftw.ws/search?q=${encodeURIComponent(cleanQuery)}`, { timeout: 6000 });
    if (!res.ok) return [];
    const data = res.json();
    const arr = Array.isArray(data) ? data : (data.items || data.results || data.data || []);
    const normalized = arr.map(normalizeLiftMediaItem).filter(Boolean).slice(0, limit);
    return setCached(cacheKey, normalized, 10 * 60 * 1000);
  } catch (err) {
    console.warn('[Lift Search Error]:', err.message);
    return [];
  }
}

/**
 * Получение 4 фирменных подборок с главной страницы Lift:
 * - Популярные зарубежные фильмы (exceptCountry=Россия)
 * - Популярные зарубежные сериалы (exceptCountry=Россия)
 * - Популярные российские фильмы (country=Россия)
 * - Популярные российские сериалы (country=Россия)
 */
export async function getLiftHomeRails(limit = 14) {
  const cacheKey = `home_rails:${limit}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const endpoints = {
    foreignFilms: `/list?type=film&last=true&limit=${limit}&exceptCountry=${encodeURIComponent('Россия')}`,
    foreignSeries: `/list?type=serial&last=true&limit=${limit}&exceptCountry=${encodeURIComponent('Россия')}`,
    ruFilms: `/list?type=film&last=true&limit=${limit}&country=${encodeURIComponent('Россия')}`,
    ruSeries: `/list?type=serial&last=true&limit=${limit}&country=${encodeURIComponent('Россия')}`
  };

  const fetchList = async (path) => {
    try {
      const res = await liftRequestRaw(`https://api.liftw.ws${path}`, { timeout: 6500 });
      if (!res.ok) return [];
      const raw = res.json();
      const arr = Array.isArray(raw) ? raw : (raw.items || raw.data || []);
      return arr.map(normalizeLiftMediaItem).filter(Boolean);
    } catch (_) {
      return [];
    }
  };

  const [foreignFilms, foreignSeries, ruFilms, ruSeries] = await Promise.all([
    fetchList(endpoints.foreignFilms),
    fetchList(endpoints.foreignSeries),
    fetchList(endpoints.ruFilms),
    fetchList(endpoints.ruSeries)
  ]);

  const result = { foreignFilms, foreignSeries, ruFilms, ruSeries };
  if (foreignFilms.length || foreignSeries.length || ruFilms.length || ruSeries.length) {
    setCached(cacheKey, result, 15 * 60 * 1000);
  }
  return result;
}

/**
 * Запрос каталога Lift с поддержкой расширенных фильтров (/list/categories)
 */
export async function getLiftCatalog(options = {}) {
  const {
    tab = 'all',
    page = 1,
    limit = 24,
    sort = 'popular',
    genre = '',
    country = '',
    exceptCountry = '',
    kpMin = 0,
    kpMax = 10,
    imdbMin = 0,
    imdbMax = 10,
    yearFrom = 1895,
    yearTo = new Date().getFullYear() + 1,
    popular = false
  } = options;

  const tabToCategoryMap = {
    'home': 'all',
    'new': 'all',
    'all': 'all',
    'movies': '1',
    'cartoons': '2',
    'series': '3',
    'tvshows': '4',
    'cartoon-series': '5',
    'anime-movies': '6',
    'anime-series': '7'
  };

  const categoryParam = tabToCategoryMap[tab] || 'all';
  const sortMap = {
    'newest': 'year',
    'popular': 'popular',
    'rating': 'kp',
    'imdb': 'imdb',
    'year': 'year'
  };
  const liftSort = sortMap[sort] || 'popular';

  const params = new URLSearchParams();
  params.set('category', categoryParam);
  params.set('page', String(Math.max(1, Number(page) || 1)));
  params.set('limit', String(Math.min(50, Math.max(1, Number(limit) || 24))));
  params.set('sort', liftSort);

  if (popular || tab === 'new') {
    params.set('last', 'true');
  }
  if (genre && genre !== 'all') {
    params.set('genre', String(genre));
  }
  if (country && country !== 'all') {
    if (country === 'foreign') {
      params.set('exceptCountry', 'Россия');
    } else {
      params.set('country', String(country));
    }
  }
  if (exceptCountry) {
    params.set('exceptCountry', String(exceptCountry));
  }
  if (Number(kpMin) > 0) params.set('kpMin', String(kpMin));
  if (Number(kpMax) > 0 && Number(kpMax) < 10) params.set('kpMax', String(kpMax));
  if (Number(imdbMin) > 0) params.set('imdbMin', String(imdbMin));
  if (Number(imdbMax) > 0 && Number(imdbMax) < 10) params.set('imdbMax', String(imdbMax));
  if (Number(yearFrom) > 1895) params.set('yearFrom', String(yearFrom));
  if (Number(yearTo) < new Date().getFullYear() + 1) params.set('yearTo', String(yearTo));

  const queryStr = params.toString();
  const cacheKey = `catalog:${queryStr}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const res = await liftRequestRaw(`https://api.liftw.ws/list/categories?${queryStr}`, { timeout: 7000 });
    if (!res.ok) return [];
    const data = res.json();
    const arr = Array.isArray(data) ? data : (data.items || data.results || data.data || []);
    const items = arr.map(normalizeLiftMediaItem).filter(Boolean);
    return setCached(cacheKey, items, 10 * 60 * 1000);
  } catch (err) {
    console.warn('[Lift Catalog Error]:', err.message);
    return [];
  }
}

/**
 * Детальная информация о фильме/сериале из базы Lift (/info/<id>) + части франшизы (/info/batch)
 */
export async function getLiftDetails(rawId) {
  const liftId = String(rawId || '').replace(/^lift_/, '').trim();
  if (!/^\d+$/.test(liftId)) return null;

  const cacheKey = `info:${liftId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const res = await liftRequestRaw(`https://api.liftw.ws/info/${liftId}`, { timeout: 7000 });
    if (!res.ok) return null;
    const raw = res.json();
    const base = normalizeLiftMediaItem(raw);
    if (!base) return null;

    const info = raw.info || {};
    const people = raw.people || {};

    const cast = Array.isArray(people.actors)
      ? people.actors.map(a => ({
          id: `lift_person_${a.id}`,
          name: a.name || '',
          character: Array.isArray(a.characters) ? a.characters.join(', ') : '',
          profile_path: normalizeLiftImageUrl(a.avatar_url || ''),
          order: Number(a.order || 0)
        }))
      : [];

    const directors = Array.isArray(people.directors)
      ? people.directors.map(d => ({
          id: `lift_person_${d.id}`,
          name: d.name || '',
          job: 'Режиссёр',
          profile_path: normalizeLiftImageUrl(d.avatar_url || '')
        }))
      : [];

    // Сезоны и серии из карты episodes: { "1": [1, 2, 3], "2": [1, 2] }
    const episodesMap = raw.episodes || info.episodes || null;
    const seasons = [];
    if (episodesMap && typeof episodesMap === 'object') {
      const sortedSeasonKeys = Object.keys(episodesMap).sort((a, b) => Number(a) - Number(b));
      for (const sKey of sortedSeasonKeys) {
        const epArr = Array.isArray(episodesMap[sKey]) ? episodesMap[sKey] : [];
        if (epArr.length > 0) {
          seasons.push({
            season_number: Number(sKey),
            season: Number(sKey),
            name: `Сезон ${sKey}`,
            episode_count: epArr.length,
            episodes: epArr.map(eNum => ({
              episode_number: Number(eNum) || eNum,
              episode: String(eNum),
              name: `${eNum} серия`
            }))
          });
        }
      }
    }

    // Если есть части франшизы (parts), подгружаем их через /info/batch
    let franchiseParts = [];
    if (Array.isArray(raw.parts) && raw.parts.length > 1) {
      franchiseParts = await getLiftBatchInfo(raw.parts);
    }

    const detailed = {
      ...base,
      slogan: String(info.slogan || '').trim(),
      age_rating: info.age ? `${info.age}+` : (info.rate_mpaa || ''),
      director: Array.isArray(info.director) ? info.director.join(', ') : String(info.director || ''),
      actors_list: Array.isArray(info.actors) ? info.actors : [],
      actors_dubl: Array.isArray(info.actors_dubl) ? info.actors_dubl : [],
      premier: info.premier_rus || info.premier || '',
      budget: info.budget || '',
      fees_world: info.fees_world || '',
      trivia: Array.isArray(info.trivia) ? info.trivia : [],
      cast,
      directors,
      seasons,
      seasons_count: seasons.length,
      franchise_parts: franchiseParts
    };

    return setCached(cacheKey, detailed, 15 * 60 * 1000);
  } catch (err) {
    console.warn('[Lift Info Error]:', err.message);
    return null;
  }
}

/**
 * Пакетное получение информации о нескольких ID (например, все части франшизы)
 */
export async function getLiftBatchInfo(ids = []) {
  const cleanIds = Array.from(new Set(
    (Array.isArray(ids) ? ids : []).map(id => String(id || '').replace(/^lift_/, '').trim()).filter(id => /^\d+$/.test(id))
  )).slice(0, 50);

  if (!cleanIds.length) return [];

  const cacheKey = `batch:${cleanIds.join(',')}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const res = await liftRequestRaw('https://api.liftw.ws/info/batch', {
      method: 'POST',
      body: { ids: cleanIds },
      timeout: 6500
    });
    if (!res.ok) return [];
    const data = res.json();
    const arr = Array.isArray(data) ? data : (data.items || data.results || []);
    const normalized = arr.map(normalizeLiftMediaItem).filter(Boolean);
    return setCached(cacheKey, normalized, 20 * 60 * 1000);
  } catch (_) {
    return [];
  }
}

/**
 * Интеллектуальный поиск соответствующего ID в базе Lift для любого фильма/сериала
 */
export async function resolveLiftMatch({ lift_id, title, original_title, year, is_series }) {
  if (lift_id) {
    const cleanId = String(lift_id).replace(/^lift_/, '').trim();
    if (/^\d+$/.test(cleanId)) return cleanId;
  }

  const rawTitle = String(title || '').replace(/\s*[\(\[]?\s*4[KkКк]\s*(?:Ultra\s*HD|UHD)?\s*[\)\]]?/gi, '').replace(/\s*\(\d{4}\)\s*$/i, '').trim();
  const rawOrig = String(original_title || '').trim();
  if (!rawTitle && !rawOrig) return null;

  const cacheKey = `match:${rawTitle.toLowerCase()}:${rawOrig.toLowerCase()}:${year || ''}:${Boolean(is_series)}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').trim();
  const targetTitle = norm(rawTitle);
  const targetOrig = norm(rawOrig);
  const targetYear = parseInt(year, 10) || 0;

  let candidates = await searchLift(rawTitle || rawOrig, 15);
  if (!candidates.length && rawOrig && rawOrig !== rawTitle) {
    candidates = await searchLift(rawOrig, 15);
  }
  if (!candidates.length) return null;

  let bestItem = null;
  let bestScore = -999;

  for (const item of candidates) {
    let score = 0;
    const cTitle = norm(item.title);
    const cOrig = norm(item.original_title);
    const cYear = parseInt(item.year, 10) || 0;

    if (targetTitle && cTitle === targetTitle) score += 120;
    else if (targetTitle && (cTitle.startsWith(targetTitle) || targetTitle.startsWith(cTitle))) score += 65;

    if (targetOrig && cOrig && cOrig === targetOrig) score += 130;
    else if (targetOrig && cOrig && (cOrig.includes(targetOrig) || targetOrig.includes(cOrig))) score += 70;

    if (targetYear && cYear) {
      const diff = Math.abs(targetYear - cYear);
      if (diff === 0) score += 60;
      else if (diff === 1) score += 30;
      else if (diff > 3) score -= 50;
    }

    if (is_series !== undefined && Boolean(item.is_series) === Boolean(is_series)) {
      score += 25;
    }

    if (score > bestScore) {
      bestScore = score;
      bestItem = item;
    }
  }

  if (bestItem && bestScore >= 60) {
    return setCached(cacheKey, bestItem.lift_id, 30 * 60 * 1000);
  }
  return null;
}

/**
 * Алгоритм обфускации URL /x-en-x/ из cdn.js балансера Lift
 */
const CIPHER_FROM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const CIPHER_TO   = 'DlChEXitLONYRkFjAsnBbymWzSHMqKPgQZpvwerofJTVdIuUcxaG';

export function buildLiftCdnCipherUrl(rawStreamUrl, unixTime) {
  try {
    const u = new URL(rawStreamUrl);
    const ts = Number(unixTime) || Math.floor(Date.now() / 1000);
    const n = Math.round(ts / 3600);
    const b64 = Buffer.from(`${n}/${u.pathname}${u.search}`).toString('base64');
    let ciphered = '';
    for (let i = 0; i < b64.length; i++) {
      const idx = CIPHER_FROM.indexOf(b64[i]);
      ciphered += idx > -1 ? CIPHER_TO[idx] : b64[i];
    }
    return `${u.origin}/x-en-x/${ciphered}`;
  } catch (_) {
    return rawStreamUrl;
  }
}

/**
 * Извлечение полной конфигурации потоков (HLS, DASH VP9, DASHA AV1, озвучки, субтитры,
 * таймкоды пропуска интро/титров и превью) со страницы embed.liftw.ws/embed/movie/<id>
 */
export async function extractLiftStreamData(liftId, { season = '', episode = '' } = {}) {
  const cleanId = String(liftId || '').replace(/^lift_/, '').trim();
  if (!/^\d+$/.test(cleanId)) return null;

  const epParams = season
    ? `&season=${encodeURIComponent(season)}&episode=${encodeURIComponent(episode || '1')}`
    : '';
  const embedUrl = `https://embed.liftw.ws/embed/movie/${cleanId}?host=liftw.ws${epParams}`;

  try {
    const res = await liftRequestRaw(embedUrl, {
      referer: 'https://liftw.ws/',
      headers: {
        'Sec-Fetch-Dest': 'iframe',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-site'
      },
      timeout: 8000
    });

    if (!res.ok) return null;
    const html = res.text();
    if (!html || html.includes('К сожалению, видео недоступно') || !html.includes('makePlayer(')) {
      return null;
    }

    // 1. Извлекаем unixTime и динамический hex-токен подписи потока
    const unixMatch = html.match(/unixTime\s*=\s*(\d+)/);
    const unixTime = unixMatch ? Number(unixMatch[1]) : Math.floor(Date.now() / 1000);

    const tokenAfterLol = html.match(/lol\s*=\s*['"][^'"]*['"]\s*,\s*[a-zA-Z0-9_]+\s*=\s*["']([a-f0-9]{6,})["']/);
    const varMatches = [...html.matchAll(/\b([a-f0-9]{6,})\s*=\s*["']([a-f0-9]{6,})["']/g)];
    const streamToken = tokenAfterLol ? tokenAfterLol[1] : (varMatches.length ? varMatches[varMatches.length - 1][2] : '');

    // 2. Извлекаем глобальный preview (WebP раскадровку на таймлайне)
    const previewMatch = html.match(/preview:\s*(\{[^}]+\})/);
    let defaultPreview = null;
    if (previewMatch) {
      try {
        // Приводим JS-объект к валидному JSON
        const jsonLike = previewMatch[1]
          .replace(/([,{]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');
        defaultPreview = JSON.parse(jsonLike);
      } catch (_) {}
    }

    // 3. Извлекаем блок <script data-name="mk"> с вызовом makePlayer({...})
    const mkStart = html.indexOf('<script data-name="mk">');
    const mkSegment = mkStart > -1 ? html.slice(mkStart) : html;

    const appendToken = (u) => {
      if (!u || typeof u !== 'string') return '';
      return streamToken ? `${u}&${streamToken}` : u;
    };

    // Проверяем, сериал ли это (наличие playlist: { ... seasons: [...] })
    const seasonsIdx = mkSegment.indexOf('seasons:');
    if (seasonsIdx > -1) {
      const bracketStart = mkSegment.indexOf('[', seasonsIdx);
      if (bracketStart > -1) {
        let depth = 0;
        let inStr = false;
        let escape = false;
        let bracketEnd = -1;
        for (let i = bracketStart; i < mkSegment.length; i++) {
          const ch = mkSegment[i];
          if (escape) {
            escape = false;
            continue;
          }
          if (ch === '\\') {
            escape = true;
            continue;
          }
          if (ch === '"') {
            inStr = !inStr;
            continue;
          }
          if (!inStr) {
            if (ch === '[') depth++;
            else if (ch === ']') {
              depth--;
              if (depth === 0) {
                bracketEnd = i;
                break;
              }
            }
          }
        }

        if (bracketEnd > bracketStart) {
          const rawSeasonsJson = mkSegment.slice(bracketStart, bracketEnd + 1);
          const parsedSeasons = JSON.parse(rawSeasonsJson);

          const normalizedSeasons = parsedSeasons.map(s => ({
            season: Number(s.season),
            blocked: Boolean(s.blocked),
            episodes: (Array.isArray(s.episodes) ? s.episodes : []).map(ep => {
              const epAudio = ep.audio || { names: ['Русская озвучка'], order: [0] };
              return {
                episode: String(ep.episode),
                id: ep.id,
                videoKey: ep.videoKey,
                title: ep.title || `Серия ${ep.episode}`,
                duration: Number(ep.duration || 0),
                hls: appendToken(ep.hls),
                dash: appendToken(ep.dash),
                dasha: appendToken(ep.dasha),
                audio: epAudio,
                audioNames: Array.isArray(epAudio.names) ? epAudio.names : ['Русская озвучка'],
                cc: Array.isArray(ep.cc) ? ep.cc : [],
                sections: Array.isArray(ep.sections) ? ep.sections : [],
                preview: ep.preview || defaultPreview
              };
            })
          }));

          const targetSeasonNum = Number(season) || (normalizedSeasons[0] && normalizedSeasons[0].season) || 1;
          const activeSeasonObj = normalizedSeasons.find(s => s.season === targetSeasonNum) || normalizedSeasons[0];
          const targetEpStr = String(episode || '1');
          const activeEpObj = (activeSeasonObj && activeSeasonObj.episodes.find(e => e.episode === targetEpStr)) ||
                              (activeSeasonObj && activeSeasonObj.episodes[0]) || null;

          return {
            lift_id: cleanId,
            kind: 'series',
            isSeries: true,
            unixTime,
            streamToken,
            embedUrl,
            rawHtml: html,
            activeSeason: activeSeasonObj ? activeSeasonObj.season : 1,
            activeEpisode: activeEpObj ? activeEpObj.episode : '1',
            source: activeEpObj || null,
            hlsStreamUrl: activeEpObj?.hls || '',
            dashStreamUrl: activeEpObj?.dash || activeEpObj?.dasha || '',
            audioTracks: activeEpObj?.audioNames || ['Русская озвучка'],
            subtitles: activeEpObj?.cc || [],
            sections: activeEpObj?.sections || [],
            seasons: normalizedSeasons
          };
        }
      }
    }

    // Одиночный фильм: извлекаем hls, dash, dasha, audio, cc, sections
    const hlsMatch = mkSegment.match(/hls:\s*"([^"]+)"/);
    const dashMatch = mkSegment.match(/dash:\s*"([^"]+)"/);
    const dashaMatch = mkSegment.match(/dasha:\s*"([^"]+)"/);
    const audioMatch = mkSegment.match(/audio:\s*(\{[^\n\r]+\})/);
    const ccMatch = mkSegment.match(/cc:\s*(\[[^\n\r]*\])/);
    const sectionsMatch = mkSegment.match(/sections:\s*(\[[^\n\r]*\])/);
    const titleMatch = mkSegment.match(/title:\s*"([^"]+)"/);
    const videoKeyMatch = mkSegment.match(/var\s+videoKey\s*=\s*(\d+)/);

    let audio = { names: ['Дубляж'], order: [0] };
    if (audioMatch) {
      try { audio = JSON.parse(audioMatch[1]); } catch (_) {}
    }
    let cc = [];
    if (ccMatch) {
      try { cc = JSON.parse(ccMatch[1]); } catch (_) {}
    }
    let sections = [];
    if (sectionsMatch) {
      try { sections = JSON.parse(sectionsMatch[1]); } catch (_) {}
    }

    const movieSource = {
      title: titleMatch ? titleMatch[1] : '',
      videoKey: videoKeyMatch ? Number(videoKeyMatch[1]) : 0,
      hls: hlsMatch ? appendToken(hlsMatch[1]) : '',
      dash: dashMatch ? appendToken(dashMatch[1]) : '',
      dasha: dashaMatch ? appendToken(dashaMatch[1]) : '',
      audio,
      cc,
      sections,
      preview: defaultPreview
    };

    return {
      lift_id: cleanId,
      kind: 'movie',
      isSeries: false,
      unixTime,
      streamToken,
      embedUrl,
      rawHtml: html,
      source: movieSource,
      hlsStreamUrl: movieSource.hls || '',
      dashStreamUrl: movieSource.dash || movieSource.dasha || '',
      audioTracks: Array.isArray(audio.names) ? audio.names : ['Дубляж'],
      subtitles: cc,
      sections,
      seasons: []
    };
  } catch (err) {
    console.warn('[Lift Stream Extract Error]:', err.message);
    return null;
  }
}

/**
 * Парсинг реальных видео-качеств (360p..4K) и аудиодорожек из HLS (master.m3u8) и DASH (.mpd)
 * для модального окна выбора качества и озвучки перед скачиванием или просмотром
 */
export async function getLiftDownloadAndStreamOptions(liftId, { season = '', episode = '' } = {}) {
  const data = await extractLiftStreamData(liftId, { season, episode });
  if (!data || !data.source) return null;

  const src = data.source;
  const audioNames = (src.audio && Array.isArray(src.audio.names)) ? src.audio.names : ['Русская озвучка'];

  const qualitiesMap = new Map();
  const audioTracks = audioNames.map((name, idx) => ({
    id: idx + 1,
    track: idx,
    name,
    title: name,
    language: /eng|orig|kor|jap|jpn/i.test(name) ? 'en' : 'ru',
    hlsUri: '',
    selected: idx === 0
  }));

  const cipheredHls = src.hls ? buildLiftCdnCipherUrl(src.hls, data.unixTime) : '';
  const cipheredDash = (src.dash || src.dasha) ? buildLiftCdnCipherUrl(src.dash || src.dasha, data.unixTime) : '';
  const cipheredDasha = src.dasha ? buildLiftCdnCipherUrl(src.dasha, data.unixTime) : '';

  // Парсим HLS master.m3u8 и DASH .mpd параллельно через шифрованный /x-en-x/ шлюз CDN
  await Promise.all([
    (async () => {
      if (!cipheredHls) return;
      try {
        const hlsRes = await liftRequestRaw(cipheredHls, {
          origin: 'https://embed.liftw.ws',
          referer: 'https://embed.liftw.ws/',
          timeout: 4500
        });
        if (hlsRes.ok) {
          const m3u8 = hlsRes.text();
          if (m3u8.includes('#EXTM3U')) {
            const lines = m3u8.split(/\r?\n/);

            // Предпочитаем стабильный узел x-bc.interkh.com (failover-audio-0) для прямого воспроизведения в VLC / IINA / PotPlayer
            let audioPrimaryIdx = 0;
            let audioFailoverIdx = 0;
            for (const line of lines) {
              if (line.startsWith('#EXT-X-MEDIA:TYPE=AUDIO')) {
                const uriMatch = line.match(/URI="([^"]+)"/);
                if (!uriMatch) continue;
                const resolvedAudioUri = uriMatch[1].startsWith('http') ? uriMatch[1] : new URL(uriMatch[1], cipheredHls).toString();
                if (line.includes('GROUP-ID="failover-audio-0"') && audioTracks[audioFailoverIdx]) {
                  audioTracks[audioFailoverIdx].hlsUri = resolvedAudioUri;
                  audioFailoverIdx++;
                } else if (line.includes('GROUP-ID="audio0"') && audioTracks[audioPrimaryIdx]) {
                  if (!audioTracks[audioPrimaryIdx].hlsUri) {
                    audioTracks[audioPrimaryIdx].hlsUri = resolvedAudioUri;
                  }
                  audioPrimaryIdx++;
                }
              }
            }

            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              if (line.startsWith('#EXT-X-STREAM-INF:')) {
                const resMatch = line.match(/RESOLUTION=(\d+)x(\d+)/);
                const bwMatch = line.match(/BANDWIDTH=(\d+)/);
                const rawNext = (lines[i + 1] || '').trim();
                const streamUrl = rawNext.startsWith('http') ? rawNext : (rawNext ? new URL(rawNext, cipheredHls).toString() : '');
                if (resMatch && streamUrl) {
                  const width = Number(resMatch[1]);
                  const height = Number(resMatch[2]);
                  const stdHeight = normalizeStandardHeight(width, height);
                  const isFastEdge = streamUrl.includes('x-bc.interkh.com');
                  if (!qualitiesMap.has(stdHeight)) {
                    qualitiesMap.set(stdHeight, {
                      height: stdHeight,
                      resolution: `${width}x${height}`,
                      rawResolution: `${width}x${height}`,
                      label: qualityTitleByHeight(stdHeight),
                      codec: 'H.264 (HLS)',
                      bandwidth: bwMatch ? Number(bwMatch[1]) : 0,
                      protocol: 'hls',
                      is_4k: stdHeight >= 2160,
                      url: streamUrl,
                      hlsUrl: streamUrl,
                      dashUrl: cipheredDash || ''
                    });
                  } else if (isFastEdge) {
                    const existing = qualitiesMap.get(stdHeight);
                    existing.hlsUrl = streamUrl;
                    if (existing.protocol === 'hls') {
                      existing.url = streamUrl;
                    }
                  }
                }
              }
            }
          }
        }
      } catch (_) {}
    })(),
    (async () => {
      if (!cipheredDash) return;
      try {
        const mpdRes = await liftRequestRaw(cipheredDash, {
          origin: 'https://embed.liftw.ws',
          referer: 'https://embed.liftw.ws/',
          timeout: 4500
        });
        if (mpdRes.ok) {
          const mpd = mpdRes.text();
          if (mpd.includes('<Representation')) {
            const repRegex = /<Representation[^>]+>/g;
            let m;
            while ((m = repRegex.exec(mpd)) !== null) {
              const tag = m[0];
              const wMatch = tag.match(/\bwidth="(\d+)"/);
              const hMatch = tag.match(/\bheight="(\d+)"/);
              const bwMatch = tag.match(/\bbandwidth="(\d+)"/);
              const codecMatch = tag.match(/codecs="([^"]+)"/);
              if (wMatch && hMatch) {
                const width = Number(wMatch[1]);
                const height = Number(hMatch[1]);
                const stdHeight = normalizeStandardHeight(width, height);
                const isAv1 = codecMatch && codecMatch[1].startsWith('av01');
                if (!qualitiesMap.has(stdHeight)) {
                  qualitiesMap.set(stdHeight, {
                    height: stdHeight,
                    resolution: `${width}x${height}`,
                    rawResolution: `${width}x${height}`,
                    label: qualityTitleByHeight(stdHeight),
                    codec: isAv1 ? 'AV1 (DASH)' : 'VP9 (DASH)',
                    bandwidth: bwMatch ? Number(bwMatch[1]) : 0,
                    protocol: 'dash',
                    is_4k: stdHeight >= 2160,
                    url: cipheredDash,
                    hlsUrl: cipheredHls || '',
                    dashUrl: cipheredDash
                  });
                } else {
                  const existing = qualitiesMap.get(stdHeight);
                  existing.codec = `H.264 (HLS) + ${isAv1 ? 'AV1' : 'VP9'} (DASH)`;
                  existing.dashUrl = cipheredDash;
                  if (bwMatch && Number(bwMatch[1]) > (existing.bandwidth || 0)) {
                    existing.bandwidth = Number(bwMatch[1]);
                  }
                }
              }
            }
          }
        }
      } catch (_) {}
    })()
  ]);

  if (qualitiesMap.size === 0 && (cipheredHls || cipheredDash)) {
    const baseStream = cipheredHls || cipheredDash;
    qualitiesMap.set(1080, {
      height: 1080,
      resolution: '1920x1080',
      rawResolution: '1920x1080',
      label: 'Full HD (1080p)',
      codec: 'H.264 / AV1',
      bandwidth: 6800000,
      protocol: 'hls',
      is_4k: false,
      url: baseStream,
      hlsUrl: cipheredHls || baseStream,
      dashUrl: cipheredDash || ''
    });
    qualitiesMap.set(720, {
      height: 720,
      resolution: '1280x720',
      rawResolution: '1280x720',
      label: 'HD (720p)',
      codec: 'H.264 (HLS)',
      bandwidth: 3400000,
      protocol: 'hls',
      is_4k: false,
      url: baseStream,
      hlsUrl: cipheredHls || baseStream,
      dashUrl: cipheredDash || ''
    });
  }

  const videoQualities = Array.from(qualitiesMap.values()).sort((a, b) => b.height - a.height);
  if (videoQualities.length > 0) {
    videoQualities[0].selected = true;
  }

  // Нормализуем субтитры (.vtt), чтобы всегда были и name/label, и url/src
  const normalizedSubtitles = (Array.isArray(src.cc) ? src.cc : []).map((sub, idx) => {
    const rawUrl = String(sub.url || sub.src || '').trim();
    const fullUrl = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl;
    const label = String(sub.name || sub.label || `Субтитры #${idx + 1}`).trim();
    const lang = /рус|rus|ru/i.test(label) ? 'ru' : (/укр|ukr|uk/i.test(label) ? 'uk' : 'en');
    return {
      id: idx + 1,
      name: label,
      label,
      url: fullUrl,
      src: fullUrl,
      lang
    };
  }).filter(s => Boolean(s.url));

  return {
    ok: true,
    lift_id: data.lift_id,
    kind: data.kind,
    activeSeason: data.activeSeason || null,
    activeEpisode: data.activeEpisode || null,
    hlsUrl: cipheredHls || src.hls,
    dashUrl: cipheredDash || src.dash || src.dasha,
    hlsMasterUrl: cipheredHls || src.hls,
    dashManifestUrl: cipheredDash || src.dash,
    dashaManifestUrl: cipheredDasha || src.dasha,
    qualities: videoQualities,
    videoQualities,
    voiceovers: audioTracks,
    audioTracks,
    subtitles: normalizedSubtitles,
    sections: Array.isArray(src.seasons) ? [] : (src.sections || []),
    preview: src.preview || null,
    thumbnailsVtt: src.preview?.src || '',
    seasons: (data.seasons || []).map(s => ({
      season: s.season,
      episodes: s.episodes.map(e => e.episode)
    }))
  };
}

function normalizeStandardHeight(width, height) {
  const maxDim = Math.max(Number(width) || 0, Number(height) || 0);
  if (maxDim >= 3200 || height >= 1800) return 2160;
  if (maxDim >= 2400 || height >= 1300) return 1440;
  if (maxDim >= 1750 || height >= 950) return 1080;
  if (maxDim >= 1150 || height >= 640) return 720;
  if (maxDim >= 800 || height >= 440) return 480;
  return 360;
}

function qualityTitleByHeight(height) {
  const h = Number(height || 0);
  if (h >= 2160) return '4K Ultra HD (2160p)';
  if (h >= 1440) return 'QHD 2K (1440p)';
  if (h >= 1080) return 'Full HD (1080p)';
  if (h >= 720) return 'HD (720p)';
  if (h >= 480) return 'SD (480p)';
  return `${h}p`;
}
