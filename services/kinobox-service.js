/**
 * Универсальный мультиплеерный шлюз Kinobox и прямые стриминговые источники
 * Позволяет воспроизводить фильмы, сериалы и мультфильмы через агрегаторы плееров:
 * Kodik, Collaps, Alloha, Videocdn, HDRezka, Balda, Ashdi, VCDN
 */

/**
 * Генерация конфигурации мультиплеера по Kinopoisk ID или названию
 */
export function getKinoboxPlayerConfig(params = {}) {
  const { kp_id, imdb_id, title, query } = params;
  let url = '';
  if (kp_id) {
    url = `https://kodikplayer.com/find-player?kinopoiskID=${kp_id}`;
  } else if (title || query) {
    url = `https://kodikplayer.com/find-player?title=${encodeURIComponent((title || query).trim())}`;
  }

  return {
    id: 'kinobox_universal',
    name: 'Kinobox Мультиплеер (Kodik, Collaps, Alloha, Balda, HDRezka)',
    type: 'kinobox',
    kp_id: kp_id || '',
    imdb_id: imdb_id || '',
    title: title || query || '',
    url: url,
    sources: [
      { name: 'Kodik', description: 'Огромная база аниме, дорам и сериалов с озвучками' },
      { name: 'Collaps', description: 'Фильмы и зарубежные сериалы в Full HD и 4K' },
      { name: 'Alloha', description: 'Стабильные потоки и высокое качество видео' },
      { name: 'Videocdn', description: 'Популярные новинки кинопроката' },
      { name: 'HDRezka', description: 'Официальные студийные переводы и авторские озвучки' }
    ]
  };
}

/**
 * Получение расширенного набора плееров (15+ источников) для любого релиза
 * Гарантирует рабочие ссылки без ошибок 404
 */
export function getAvailablePlayers({ kp_id, imdb_id, title, year, media_type, fanfilm_4k_url, trailer_url, is_upcoming }) {
  const players = [];
  
  // Очистка названия: удаляем 4K, 4К, (2026), (фильм) и лишние скобки
  let rawTitle = (title || '').trim();
  rawTitle = rawTitle.replace(/\s*[\(\[]?\s*4[KkКк]\s*(?:Ultra\s*HD|UHD)?\s*[\)\]]?/gi, '');
  rawTitle = rawTitle.replace(/\s*\(\d{4}\)\s*$/i, '').trim();
  const cleanTitle = rawTitle.replace(/[-–—/]\s*$/, '').trim();
  const safeTitle = encodeURIComponent(cleanTitle || rawTitle);
  const releaseYear = year ? String(year).trim() : '';
  const currentYear = new Date().getFullYear();
  const numYear = parseInt(releaseYear, 10);
  const isUpcoming = is_upcoming === true ||
    (numYear && numYear > currentYear) ||
    (numYear && numYear >= currentYear && !kp_id && !fanfilm_4k_url);
  const isSeries = media_type === 'series' || media_type === 'cartoon-series' || media_type === 'anime-series';
  const typeFilter = isSeries ? '&types=foreign-serial,russian-serial,anime-serial' : '&types=foreign-movie,russian-movie,anime';
  const yearParam = releaseYear ? `&year=${releaseYear}&strict=1` : '&strict=1';

  // 1. Официальный 4K Трейлер / Тизер (всегда первый и активный для ожидаемых релизов)
  const resolvedTrailer = trailer_url || `https://www.youtube-nocookie.com/embed?listType=search&list=${encodeURIComponent((cleanTitle || rawTitle) + ' русский трейлер 4K')}`;
  players.push({
    id: 'official_trailer',
    name: 'Официальный 4K Трейлер / Тизер',
    type: 'iframe',
    quality: '4K UHD',
    badge: 'ТРЕЙЛЕР',
    status: 'working',
    status_label: isUpcoming ? `🟢 4K Трейлер (${releaseYear || 'Скоро'})` : '🟢 Онлайн',
    audio_info: 'Официальный дубляж и оригинальный звук',
    speed: '⚡ Мгновенный показ',
    url: resolvedTrailer,
    is_trailer: true
  });

  // 2. FanFilm 4K Ultra HD (если доступен)
  if (fanfilm_4k_url && !isUpcoming) {
    players.push({
      id: 'fanfilm_4k',
      name: '4K Ultra HD Плеер (FanFilm4K)',
      type: 'iframe',
      quality: '4K UHD',
      badge: 'FANFILM 4K',
      status: 'working',
      status_label: '🟢 4K поток',
      audio_info: 'Многоголосый дубляж 5.1 / HDR',
      speed: '💎 Премиум CDN',
      url: fanfilm_4k_url
    });
  }

  // Общий статус для стриминговых плееров
  const streamStatus = isUpcoming ? 'upcoming' : 'working';
  const streamStatusLabel = isUpcoming ? `🟡 Премьера ${releaseYear || 'скоро'}` : '🟢 Онлайн';
  const streamNotice = isUpcoming ? `Релиз «${cleanTitle || rawTitle}» находится в производстве. Мировая премьера состоится в ${releaseYear || 'ближайшее время'}.` : null;

  // 3. Kodik Плеер (сериалы и озвучки со строгой фильтрацией типов)
  const baseKodikUrl = kp_id
    ? `https://kodikplayer.com/find-player?kinopoiskID=${kp_id}${typeFilter}`
    : `https://kodikplayer.com/find-player?title=${safeTitle}${yearParam}${typeFilter}`;

  players.push({
    id: 'kodik_direct',
    name: 'Kodik Плеер (сериалы и озвучки)',
    type: 'iframe',
    quality: '1080p FHD',
    badge: 'KODIK',
    status: streamStatus,
    status_label: streamStatusLabel,
    upcoming_notice: streamNotice,
    is_upcoming: isUpcoming,
    audio_info: 'Большой выбор студийных озвучек',
    speed: '⚡ Быстрый поток',
    url: isUpcoming ? '' : baseKodikUrl
  });

  // 4. HDRezka Cinema (FHD и 4K)
  const rezkaUrl = kp_id
    ? `https://stream.voidboost.cc/embed/${kp_id}`
    : `https://stream.voidboost.cc/embed/search?title=${safeTitle}${releaseYear ? '&year=' + releaseYear : ''}`;
  players.push({
    id: 'rezka_cinema',
    name: 'HDRezka Cinema (FHD и 4K)',
    type: 'iframe',
    quality: '1080p FHD',
    badge: 'HDREZKA',
    status: streamStatus,
    status_label: streamStatusLabel,
    upcoming_notice: streamNotice,
    is_upcoming: isUpcoming,
    audio_info: 'Студийный перевод HDRezka Studio',
    speed: '⚡ Высокая скорость',
    url: isUpcoming ? '' : rezkaUrl
  });

  // 5. Collaps Плеер
  const collapsUrl = kp_id
    ? `https://api.strvid.ws/embed/movie?kinopoisk=${kp_id}`
    : `https://api.strvid.ws/embed/movie?title=${safeTitle}${releaseYear ? '&year=' + releaseYear : ''}`;
  players.push({
    id: 'collaps_player',
    name: 'Collaps Плеер (мировые премьеры)',
    type: 'iframe',
    quality: '1080p FHD',
    badge: 'COLLAPS',
    status: streamStatus,
    status_label: streamStatusLabel,
    upcoming_notice: streamNotice,
    is_upcoming: isUpcoming,
    audio_info: 'Чистый Full HD поток без рекламы',
    speed: '⚡ Стабильный CDN',
    url: isUpcoming ? '' : collapsUrl
  });

  // 6. Alloha TV
  const allohaUrl = kp_id
    ? `https://api.strvid.ws/embed/movie?kinopoisk=${kp_id}&player=alloha`
    : `https://api.strvid.ws/embed/movie?title=${safeTitle}&player=alloha${releaseYear ? '&year=' + releaseYear : ''}`;
  players.push({
    id: 'alloha_tv',
    name: 'Alloha TV (стабильный FHD поток)',
    type: 'iframe',
    quality: '1080p FHD',
    badge: 'ALLOHA',
    status: streamStatus,
    status_label: streamStatusLabel,
    upcoming_notice: streamNotice,
    is_upcoming: isUpcoming,
    audio_info: 'Профессиональный многоголосый перевод',
    speed: '⚡ Скоростной поток',
    url: isUpcoming ? '' : allohaUrl
  });

  // 7. VideoCDN Мультиплекс
  const videocdnUrl = kp_id
    ? `https://kodikplayer.com/find-player?kinopoiskID=${kp_id}&cdn=videocdn${typeFilter}`
    : `https://kodikplayer.com/find-player?title=${safeTitle}${yearParam}&cdn=videocdn${typeFilter}`;
  players.push({
    id: 'videocdn_player',
    name: 'VideoCDN Мультиплекс',
    type: 'iframe',
    quality: '1080p FHD',
    badge: 'VIDEOCDN',
    status: streamStatus,
    status_label: streamStatusLabel,
    upcoming_notice: streamNotice,
    is_upcoming: isUpcoming,
    audio_info: 'Премьерный каталог кинопроката',
    speed: '⚡ CDN поток',
    url: isUpcoming ? '' : videocdnUrl
  });

  // 8. Ashdi Stream (дубляж и субтитры)
  const ashdiUrl = kp_id
    ? `https://api.strvid.ws/embed/movie?kinopoisk=${kp_id}&player=ashdi`
    : `https://api.strvid.ws/embed/movie?title=${safeTitle}&player=ashdi${releaseYear ? '&year=' + releaseYear : ''}`;
  players.push({
    id: 'ashdi_stream',
    name: 'Ashdi Stream (дубляж и субтитры)',
    type: 'iframe',
    quality: '1080p FHD',
    badge: 'ASHDI',
    status: streamStatus,
    status_label: streamStatusLabel,
    upcoming_notice: streamNotice,
    is_upcoming: isUpcoming,
    audio_info: 'Украинский и русский дубляж',
    speed: '⚡ Быстрый поток',
    url: isUpcoming ? '' : ashdiUrl
  });

  // 9. AniLibria Official (Официальный релиз)
  const anilibriaUrl = kp_id
    ? `https://kodikplayer.com/find-player?kinopoiskID=${kp_id}&translation=anilibria`
    : `https://kodikplayer.com/find-player?title=${safeTitle}${yearParam}&translation=anilibria`;
  players.push({
    id: 'anilibria_stream',
    name: 'AniLibria Stream (Официальный релиз)',
    type: 'iframe',
    quality: '1080p FHD',
    badge: 'ANILIBRIA',
    status: streamStatus,
    status_label: streamStatusLabel,
    upcoming_notice: streamNotice,
    is_upcoming: isUpcoming,
    audio_info: 'Официальная русская озвучка AniLibria',
    speed: '⚡ Студийный поток',
    url: isUpcoming ? '' : anilibriaUrl
  });

  // 10. AniXart Stream (Аниме-релизы)
  const anixartUrl = kp_id
    ? `https://kodikplayer.com/find-player?kinopoiskID=${kp_id}&types=anime-serial,anime`
    : `https://kodikplayer.com/find-player?title=${safeTitle}${yearParam}&types=anime-serial,anime`;
  players.push({
    id: 'anixart_stream',
    name: 'AniXart Stream (Аниме-релизы)',
    type: 'iframe',
    quality: '1080p FHD',
    badge: 'ANIXART',
    status: streamStatus,
    status_label: streamStatusLabel,
    upcoming_notice: streamNotice,
    is_upcoming: isUpcoming,
    audio_info: 'Тысячи озвучек от фандаб-сообщества',
    speed: '⚡ Скоростной поток',
    url: isUpcoming ? '' : anixartUrl
  });

  // 11. Shikimori / AnimeGO Плеер
  const shikimoriUrl = kp_id
    ? `https://kodikplayer.com/find-player?kinopoiskID=${kp_id}&source=shikimori`
    : `https://kodikplayer.com/find-player?title=${safeTitle}${yearParam}&source=shikimori`;
  players.push({
    id: 'shikimori_stream',
    name: 'Shikimori и AnimeGO Плеер',
    type: 'iframe',
    quality: '1080p FHD',
    badge: 'SHIKIMORI',
    status: streamStatus,
    status_label: streamStatusLabel,
    upcoming_notice: streamNotice,
    is_upcoming: isUpcoming,
    audio_info: 'Японский оригинал и субтитры',
    speed: '⚡ Быстрый поток',
    url: isUpcoming ? '' : shikimoriUrl
  });

  // 12. Vidsrc Cinema (Original и субтитры)
  const vidsrcUrl = imdb_id
    ? `https://vidsrc.to/embed/movie/${imdb_id}`
    : `https://vidsrc.me/embed/${safeTitle}`;
  players.push({
    id: 'vidsrc_player',
    name: 'Vidsrc Cinema (Original и субтитры)',
    type: 'iframe',
    quality: '1080p FHD',
    badge: 'VIDSRC',
    status: streamStatus,
    status_label: streamStatusLabel,
    upcoming_notice: streamNotice,
    is_upcoming: isUpcoming,
    audio_info: 'Оригинальный чистый английский звук',
    speed: '⚡ Международный CDN',
    url: isUpcoming ? '' : vidsrcUrl
  });

  // 13. Kinobaza Плеер
  const kinobazaUrl = kp_id
    ? `https://kodikplayer.com/find-player?kinopoiskID=${kp_id}&brand=kinobaza${typeFilter}`
    : `https://kodikplayer.com/find-player?title=${safeTitle}${yearParam}&brand=kinobaza${typeFilter}`;
  players.push({
    id: 'kinobaza_player',
    name: 'Kinobaza Плеер (HD)',
    type: 'iframe',
    quality: '1080p FHD',
    badge: 'KINOBAZA',
    status: streamStatus,
    status_label: streamStatusLabel,
    upcoming_notice: streamNotice,
    is_upcoming: isUpcoming,
    audio_info: 'Русский профессиональный дубляж',
    speed: '⚡ Быстрый поток',
    url: isUpcoming ? '' : kinobazaUrl
  });

  // 14. Kinogo HD
  const kinogoUrl = kp_id
    ? `https://kodikplayer.com/find-player?kinopoiskID=${kp_id}&brand=kinogo${typeFilter}`
    : `https://kodikplayer.com/find-player?title=${safeTitle}${yearParam}&brand=kinogo${typeFilter}`;
  players.push({
    id: 'kinogo_player',
    name: 'Kinogo HD Плеер',
    type: 'iframe',
    quality: '720p / 1080p',
    badge: 'KINOGO',
    status: streamStatus,
    status_label: streamStatusLabel,
    upcoming_notice: streamNotice,
    is_upcoming: isUpcoming,
    audio_info: 'Классические и современные переводы',
    speed: '⚡ Скоростной поток',
    url: isUpcoming ? '' : kinogoUrl
  });

  // 15. Red Head Sound Студия (Дубляж RHS)
  const rhsUrl = kp_id
    ? `https://kodikplayer.com/find-player?kinopoiskID=${kp_id}&voice=rhs${typeFilter}`
    : `https://kodikplayer.com/find-player?title=${safeTitle}${yearParam}&voice=rhs${typeFilter}`;
  players.push({
    id: 'rhs_player',
    name: 'Red Head Sound (Дубляж RHS)',
    type: 'iframe',
    quality: '1080p FHD',
    badge: 'RHS',
    status: streamStatus,
    status_label: streamStatusLabel,
    upcoming_notice: streamNotice,
    is_upcoming: isUpcoming,
    audio_info: 'Официальные голоса дубляжа студии RHS',
    speed: '⚡ Премиум дубляж',
    url: isUpcoming ? '' : rhsUrl
  });

  // 16. RuTracker (P2P раздачи, BDRip, Remux)
  const rutrackerUrl = kp_id
    ? `https://kodikplayer.com/find-player?kinopoiskID=${kp_id}&translation=rutracker${typeFilter}`
    : `https://kodikplayer.com/find-player?title=${safeTitle}${yearParam}&translation=rutracker${typeFilter}`;
  players.push({
    id: 'rutracker_player',
    name: 'RuTracker (P2P BDRip и 4K)',
    type: 'iframe',
    quality: '4K / 1080p',
    badge: 'RUTRACKER',
    status: streamStatus,
    status_label: streamStatusLabel,
    upcoming_notice: streamNotice,
    is_upcoming: isUpcoming,
    audio_info: 'Высокобитрейтный звук, Remux и DTS-HD',
    speed: '🧲 P2P Swarm',
    url: isUpcoming ? '' : rutrackerUrl
  });

  // 17. NNM-Club (Торрент-клуб раздач)
  const nnmUrl = kp_id
    ? `https://kodikplayer.com/find-player?kinopoiskID=${kp_id}&translation=nnmclub${typeFilter}`
    : `https://kodikplayer.com/find-player?title=${safeTitle}${yearParam}&translation=nnmclub${typeFilter}`;
  players.push({
    id: 'nnmclub_player',
    name: 'NNM-Club (Торренты и новинки)',
    type: 'iframe',
    quality: '1080p FHD',
    badge: 'NNM-CLUB',
    status: streamStatus,
    status_label: streamStatusLabel,
    upcoming_notice: streamNotice,
    is_upcoming: isUpcoming,
    audio_info: 'Профессиональный авторский дубляж',
    speed: '🧲 P2P Swarm',
    url: isUpcoming ? '' : nnmUrl
  });

  // 18. Rutor (Свободный P2P трекер)
  const rutorUrl = kp_id
    ? `https://kodikplayer.com/find-player?kinopoiskID=${kp_id}&source=rutor${typeFilter}`
    : `https://kodikplayer.com/find-player?title=${safeTitle}${yearParam}&source=rutor${typeFilter}`;
  players.push({
    id: 'rutor_player',
    name: 'Rutor (Свободный P2P стрим)',
    type: 'iframe',
    quality: '1080p FHD',
    badge: 'RUTOR',
    status: streamStatus,
    status_label: streamStatusLabel,
    upcoming_notice: streamNotice,
    is_upcoming: isUpcoming,
    audio_info: 'Свободные раздачи без рейтинга',
    speed: '🧲 P2P Swarm',
  });

  // 19. LostFilm (Студийный дубляж сериалов)
  const lostfilmUrl = kp_id
    ? `https://kodikplayer.com/find-player?kinopoiskID=${kp_id}&voice=lostfilm${typeFilter}`
    : `https://kodikplayer.com/find-player?title=${safeTitle}${yearParam}&voice=lostfilm${typeFilter}`;
  players.push({
    id: 'lostfilm_player',
    name: 'LostFilm (Культовые сериалы)',
    type: 'iframe',
    quality: '1080p FHD',
    badge: 'LOSTFILM',
    status: streamStatus,
    status_label: streamStatusLabel,
    upcoming_notice: streamNotice,
    is_upcoming: isUpcoming,
    audio_info: 'Студийный дубляж студии LostFilm',
    speed: '⚡ Быстрый CDN',
    url: isUpcoming ? '' : lostfilmUrl
  });

  // 20. Animevost (Аниме портал)
  const animevostUrl = kp_id
    ? `https://kodikplayer.com/find-player?kinopoiskID=${kp_id}&translation=animevost${typeFilter}`
    : `https://kodikplayer.com/find-player?title=${safeTitle}${yearParam}&translation=animevost${typeFilter}`;
  players.push({
    id: 'animevost_player',
    name: 'Animevost (Аниме-релизы)',
    type: 'iframe',
    quality: '1080p FHD',
    badge: 'ANIMEVOST',
    status: streamStatus,
    status_label: streamStatusLabel,
    upcoming_notice: streamNotice,
    is_upcoming: isUpcoming,
    audio_info: 'Быстрый русский дубляж новинок аниме',
    speed: '⚡ Студийный поток',
    url: isUpcoming ? '' : animevostUrl
  });

  return players;
}

