import fs from 'node:fs';

const TMDB_API_KEY = '4e44d9029b1270a757cddc766a1bcb63';
const TMDB_BASE = 'https://api.themoviedb.org/3';

async function queryTmdb(query) {
  try {
    const url = `${TMDB_BASE}/search/multi?api_key=${TMDB_API_KEY}&language=ru-RU&query=${encodeURIComponent(query)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const data = await res.json();
    return data.results || [];
  } catch (err) {
    return null;
  }
}

async function verifyImage(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function run() {
  console.log('=== ЗАПУСК АГЕНТА СВЕРКИ С БАЗАМИ ДАННЫХ (TMDB / SHIKIMORI) ===\n');

  const testTitles = [
    'Король Талсы',
    'Основание',
    'Целую, Китти',
    'Голяк',
    'Рыцарь Семи Королевств',
    'Сорвиголова: Рожденный заново',
    'Медленные лошади',
    'Йеллоустоун',
    'Мэр Кингстауна',
    'Извне',
    'Ричер',
    'Белый лотос',
    'Разделение',
    'Одни из нас',
    'Укрытие',
    'Игра в кальмара',
    'Очень странные дела',
    'Андор',
    'Пацаны',
    'Миротворец',
    'Медведь',
    'Дом Дракона',
    'Фоллаут',
    'Уэнсдэй',
    'Чёрное зеркало',
    'Эйфория',
    'Декстер: Первородный грех',
    'Аватар',
    'Аватар: Путь воды',
    'Аватар 2: Путь воды',
    'Аватар 3: Пламя и пепел',
    'Хищник: Планета смерти',
    'Проект «Конец света»',
    'Я не киллер',
    'Обитель зла: Мутация'
  ];

  const results = [];

  for (const title of testTitles) {
    const hits = await queryTmdb(title);
    if (hits && hits.length > 0) {
      const top = hits[0];
      const isTv = top.media_type === 'tv' || (!top.title && !!top.name);
      const mediaType = isTv ? 'series' : (top.media_type || 'movie');
      const canonicalTitle = top.title || top.name || title;
      const originalTitle = top.original_title || top.original_name || '';
      const releaseDate = top.release_date || top.first_air_date || '';
      const year = releaseDate ? releaseDate.substring(0, 4) : '';
      const posterPath = top.poster_path ? `https://image.tmdb.org/t/p/w500${top.poster_path}` : '';
      const posterValid = posterPath ? await verifyImage(posterPath) : false;

      results.push({
        query: title,
        canonicalTitle,
        originalTitle,
        mediaType,
        year,
        posterPath,
        posterValid
      });

      console.log(`[TMDB MATCH] "${title}" -> ${mediaType.toUpperCase()} | ${year} | "${canonicalTitle}" | Постер: ${posterValid ? 'OK' : 'FAIL'}`);
    } else {
      console.log(`[NO MATCH] "${title}"`);
    }
  }

  fs.writeFileSync('scripts/reconciliation_results.json', JSON.stringify(results, null, 2), 'utf-8');
  console.log('\nРезультаты сохранены в scripts/reconciliation_results.json');
}

run().catch(console.error);