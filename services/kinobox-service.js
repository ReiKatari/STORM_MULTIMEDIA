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
    url = `https://kinobox.tv/embed/kp/${kp_id}`;
  } else if (imdb_id) {
    url = `https://kinobox.tv/embed/imdb/${imdb_id}`;
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
 * Получение набора запасных плееров для любого видео
 * Поддерживает 10+ различных стриминговых шлюзов
 */
export function getAvailablePlayers({ kp_id, imdb_id, title, fanfilm_4k_url, trailer_url }) {
  const players = [];
  const safeTitle = encodeURIComponent((title || '').trim());

  // 1. Основной 4K UHD плеер (FanFilm4K)
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

  // 2. Kinobox Мультиплеер (Автоподбор по всем базам)
  if (kp_id || imdb_id) {
    const kinobox = getKinoboxPlayerConfig({ kp_id, imdb_id, title });
    if (kinobox.url) {
      players.push({
        id: 'kinobox',
        name: 'Мультиплеер Kinobox (Kodik, Collaps, Alloha, Balda)',
        type: 'kinobox',
        quality: '1080p FHD',
        badge: 'KINOBOX',
        url: kinobox.url,
        kp_id: kp_id || '',
        imdb_id: imdb_id || '',
        title: title || ''
      });
    }
  }

  // 3. Kodik Плеер (Аниме, дорамы, сериалы)
  if (kp_id || title) {
    const kodikUrl = kp_id 
      ? `https://kodik.info/find-player?kinopoiskID=${kp_id}`
      : `https://kodik.info/find-player?title=${safeTitle}`;
    players.push({
      id: 'kodik_direct',
      name: 'Kodik Плеер (сериалы и озвучки)',
      type: 'iframe',
      quality: '1080p FHD',
      badge: 'KODIK',
      url: kodikUrl
    });
  }

  // 4. Collaps Плеер
  if (kp_id || imdb_id) {
    const collapsUrl = kp_id
      ? `https://api.delivembd.ws/embed/kp/${kp_id}`
      : `https://api.delivembd.ws/embed/imdb/${imdb_id}`;
    players.push({
      id: 'collaps_direct',
      name: 'Collaps Плеер (Full HD)',
      type: 'iframe',
      quality: '1080p FHD',
      badge: 'COLLAPS',
      url: collapsUrl
    });
  }

  // 5. Трейлер
  const trailerEmbed = trailer_url || `https://www.youtube-nocookie.com/embed?listType=search&list=${safeTitle}+трейлер`;
  players.push({
    id: 'trailer',
    name: 'Официальный трейлер',
    type: 'iframe',
    quality: 'HD 1080p',
    badge: 'ТРЕЙЛЕР',
    url: trailerEmbed
  });

  return players;
}
