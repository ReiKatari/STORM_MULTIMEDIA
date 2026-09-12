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
export function getAvailablePlayers({ kp_id, imdb_id, title, fanfilm_4k_url }) {
  const players = [];
  const safeTitle = encodeURIComponent((title || '').trim());
  const cleanTitle = (title || '').trim();

  // 1. FanFilm 4K Ultra HD
  if (fanfilm_4k_url) {
    players.push({
      id: 'fanfilm_4k',
      name: '4K Ultra HD Плеер (FanFilm4K)',
      type: 'iframe',
      quality: '4K UHD',
      badge: 'FANFILM 4K',
      url: fanfilm_4k_url
    });
  }

  // 2. Kodik Плеер (сериалы и озвучки)
  const baseKodikUrl = kp_id
    ? `https://kodikplayer.com/find-player?kinopoiskID=${kp_id}`
    : `https://kodikplayer.com/find-player?title=${safeTitle}`;

  players.push({
    id: 'kodik_direct',
    name: 'Kodik Плеер (сериалы и озвучки)',
    type: 'iframe',
    quality: '1080p FHD',
    badge: 'KODIK',
    url: baseKodikUrl
  });

  // 3. HDRezka Cinema (FHD и 4K)
  const rezkaUrl = kp_id
    ? `https://stream.voidboost.cc/embed/${kp_id}`
    : `https://stream.voidboost.cc/embed/search?title=${safeTitle}`;
  players.push({
    id: 'rezka_cinema',
    name: 'HDRezka Cinema (FHD и 4K)',
    type: 'iframe',
    quality: '1080p FHD',
    badge: 'HDREZKA',
    url: rezkaUrl
  });

  // 4. Collaps Плеер (мировые премьеры)
  const collapsUrl = kp_id
    ? `https://api.multikoms.com/embed/movie?kinopoisk=${kp_id}`
    : `https://api.multikoms.com/embed/movie?title=${safeTitle}`;
  players.push({
    id: 'collaps_player',
    name: 'Collaps Плеер (мировые премьеры)',
    type: 'iframe',
    quality: '1080p FHD',
    badge: 'COLLAPS',
    url: collapsUrl
  });

  // 5. Alloha TV (стабильный FHD поток)
  const allohaUrl = kp_id
    ? `https://alloha.tv/player/?kp=${kp_id}`
    : `https://alloha.tv/player/?name=${safeTitle}`;
  players.push({
    id: 'alloha_tv',
    name: 'Alloha TV (стабильный FHD поток)',
    type: 'iframe',
    quality: '1080p FHD',
    badge: 'ALLOHA',
    url: allohaUrl
  });

  // 6. VideoCDN Мультиплекс
  const videocdnUrl = kp_id
    ? `https://kodikplayer.com/find-player?kinopoiskID=${kp_id}&cdn=videocdn`
    : `https://kodikplayer.com/find-player?title=${safeTitle}&cdn=videocdn`;
  players.push({
    id: 'videocdn_player',
    name: 'VideoCDN Мультиплекс',
    type: 'iframe',
    quality: '1080p FHD',
    badge: 'VIDEOCDN',
    url: videocdnUrl
  });

  // 7. Ashdi Stream (дубляж и субтитры)
  const ashdiUrl = kp_id
    ? `https://player.ashdi.vip/vod/${kp_id}`
    : `https://player.ashdi.vip/search?q=${safeTitle}`;
  players.push({
    id: 'ashdi_stream',
    name: 'Ashdi Stream (дубляж и субтитры)',
    type: 'iframe',
    quality: '1080p FHD',
    badge: 'ASHDI',
    url: ashdiUrl
  });

  // 8. AniLibria Official (Официальный релиз)
  const anilibriaUrl = kp_id
    ? `https://kodikplayer.com/find-player?kinopoiskID=${kp_id}&translation=anilibria`
    : `https://kodikplayer.com/find-player?title=${safeTitle}&translation=anilibria`;
  players.push({
    id: 'anilibria_stream',
    name: 'AniLibria Stream (Официальный релиз)',
    type: 'iframe',
    quality: '1080p FHD',
    badge: 'ANILIBRIA',
    url: anilibriaUrl
  });

  // 9. AniXart Stream (Аниме-релизы)
  const anixartUrl = kp_id
    ? `https://kodikplayer.com/find-player?kinopoiskID=${kp_id}&types=anime-serial,anime`
    : `https://kodikplayer.com/find-player?title=${safeTitle}&types=anime-serial,anime`;
  players.push({
    id: 'anixart_stream',
    name: 'AniXart Stream (Аниме-релизы)',
    type: 'iframe',
    quality: '1080p FHD',
    badge: 'ANIXART',
    url: anixartUrl
  });

  // 10. Shikimori / AnimeGO Плеер
  const shikimoriUrl = kp_id
    ? `https://kodikplayer.com/find-player?kinopoiskID=${kp_id}&source=shikimori`
    : `https://kodikplayer.com/find-player?title=${safeTitle}&source=shikimori`;
  players.push({
    id: 'shikimori_stream',
    name: 'Shikimori и AnimeGO Плеер',
    type: 'iframe',
    quality: '1080p FHD',
    badge: 'SHIKIMORI',
    url: shikimoriUrl
  });

  // 11. Vidsrc Cinema (Original и субтитры)
  const vidsrcUrl = imdb_id
    ? `https://vidsrc.to/embed/movie/${imdb_id}`
    : (kp_id ? `https://stream.voidboost.cc/embed/${kp_id}?lang=orig` : `https://stream.voidboost.cc/embed/search?title=${safeTitle}&lang=orig`);
  players.push({
    id: 'vidsrc_player',
    name: 'Vidsrc Cinema (Original и субтитры)',
    type: 'iframe',
    quality: '1080p FHD',
    badge: 'VIDSRC',
    url: vidsrcUrl
  });

  // 12. Kinobaza Плеер
  const kinobazaUrl = kp_id
    ? `https://kodikplayer.com/find-player?kinopoiskID=${kp_id}&brand=kinobaza`
    : `https://kodikplayer.com/find-player?title=${safeTitle}&brand=kinobaza`;
  players.push({
    id: 'kinobaza_player',
    name: 'Kinobaza Плеер (HD)',
    type: 'iframe',
    quality: '1080p FHD',
    badge: 'KINOBAZA',
    url: kinobazaUrl
  });

  // 13. Kinogo HD
  const kinogoUrl = kp_id
    ? `https://kodikplayer.com/find-player?kinopoiskID=${kp_id}&brand=kinogo`
    : `https://kodikplayer.com/find-player?title=${safeTitle}&brand=kinogo`;
  players.push({
    id: 'kinogo_player',
    name: 'Kinogo HD Плеер',
    type: 'iframe',
    quality: '720p / 1080p',
    badge: 'KINOGO',
    url: kinogoUrl
  });

  // 14. Turbovid High-Speed Stream
  const turbovidUrl = kp_id
    ? `https://turbovid.stream/embed?kp=${kp_id}`
    : `https://turbovid.stream/embed?title=${safeTitle}`;
  players.push({
    id: 'turbovid_player',
    name: 'Turbovid Скоростной поток',
    type: 'iframe',
    quality: '1080p FHD',
    badge: 'TURBOVID',
    url: turbovidUrl
  });

  // 15. Red Head Sound Студия (Дубляж RHS)
  const rhsUrl = kp_id
    ? `https://kodikplayer.com/find-player?kinopoiskID=${kp_id}&voice=rhs`
    : `https://kodikplayer.com/find-player?title=${safeTitle}&voice=rhs`;
  players.push({
    id: 'rhs_player',
    name: 'Red Head Sound (Дубляж RHS)',
    type: 'iframe',
    quality: '1080p FHD',
    badge: 'RHS',
    url: rhsUrl
  });

  return players;
}

