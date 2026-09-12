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

  let embedUrl = 'https://kinobox.tv/embed/';
  if (kp_id) {
    embedUrl += `kp/${kp_id}`;
  } else if (imdb_id) {
    embedUrl += `imdb/${imdb_id}`;
  } else if (title || query) {
    const searchQuery = encodeURIComponent(title || query);
    embedUrl += `search?query=${searchQuery}`;
  }

  return {
    id: 'kinobox_universal',
    name: 'Kinobox Мультиплеер (Kodik, Collaps, Alloha, VCDN, HDRezka)',
    type: 'kinobox',
    url: embedUrl,
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
 * Получение набора запасных плееров для любого видео
 */
export function getAvailablePlayers({ kp_id, imdb_id, title, fanfilm_4k_url, trailer_url }) {
  const players = [];

  // 1. Основной 4K UHD плеер (если доступен с FanFilm4K)
  if (fanfilm_4k_url) {
    players.push({
      id: 'fanfilm_4k',
      name: '4K Ultra HD Плеер (FanFilm4K)',
      type: 'iframe',
      quality: '4K UHD',
      badge: '4K ULTRA HD',
      url: fanfilm_4k_url
    });
  }

  // 2. Kinobox Мультиплеер (Kodik, Collaps, Alloha, VCDN, HDRezka)
  if (kp_id || imdb_id || title) {
    const kinobox = getKinoboxPlayerConfig({ kp_id, imdb_id, title });
    players.push({
      id: 'kinobox',
      name: 'Мультиплеер Kinobox (Kodik, Collaps, Alloha)',
      type: 'kinobox',
      quality: '1080p FHD',
      badge: 'МУЛЬТИПЛЕЕР',
      url: kinobox.url,
      kp_id: kp_id || '',
      imdb_id: imdb_id || ''
    });
  }

  // 3. Прямой Kodik плеер
  if (kp_id || title) {
    const kodikUrl = kp_id 
      ? `https://kodik.info/find-player?kinopoiskID=${kp_id}`
      : `https://kodik.info/find-player?title=${encodeURIComponent(title)}`;
    players.push({
      id: 'kodik_direct',
      name: 'Kodik Плеер (озвучки и сериалы)',
      type: 'iframe',
      quality: '1080p FHD',
      badge: 'KODIK',
      url: kodikUrl
    });
  }

  // 4. Трейлер
  if (trailer_url) {
    players.push({
      id: 'trailer',
      name: 'Официальный трейлер',
      type: 'trailer',
      quality: 'HD',
      badge: 'ТРЕЙЛЕР',
      url: trailer_url
    });
  }

  return players;
}
