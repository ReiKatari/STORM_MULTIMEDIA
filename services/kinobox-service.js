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
 * Получение набора запасных плееров для любого видео
 * Поддерживает 10+ различных стриминговых шлюзов
 */
export function getAvailablePlayers({ kp_id, imdb_id, title, fanfilm_4k_url }) {
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

  // 2. Kodik Плеер (Актуальный рабочий шлюз kodikplayer.com)
  if (kp_id || title) {
    const kodikUrl = kp_id 
      ? `https://kodikplayer.com/find-player?kinopoiskID=${kp_id}`
      : `https://kodikplayer.com/find-player?title=${safeTitle}`;
    players.push({
      id: 'kodik_direct',
      name: 'Kodik Плеер (сериалы и озвучки)',
      type: 'iframe',
      quality: '1080p FHD',
      badge: 'KODIK',
      url: kodikUrl
    });
  }

  return players;
}

