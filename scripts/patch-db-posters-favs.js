import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, '..', 'storm_multimedia.db');

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 60000;');

try { 
  db.exec('ALTER TABLE bookmarks ADD COLUMN is_favorite INTEGER DEFAULT 0;'); 
  console.log('Added is_favorite column');
} catch (e) {
  console.log('Column is_favorite already exists');
}

// 1. Постеры в bookmarks
db.prepare("UPDATE bookmarks SET poster_url = '/api/media/image-proxy?url=https%3A%2F%2Fimage.tmdb.org%2Ft%2Fp%2Fw500%2FwH0kbTvbrvtlCygso7Ye2ZfGfM1.jpg' WHERE id = 252").run();
db.prepare("UPDATE bookmarks SET poster_url = '/api/media/image-proxy?url=https%3A%2F%2Fv17.fanfilm4k.media%2Fuploads%2Fposts%2F2024-08%2Ffb3f49de1ca829a94ee2bf9cd8ec433c-min.jpg' WHERE id IN (267, 294)").run();

// 2. Избранное (is_favorite = 1) для пользователя 2
const favTitles = ['Интерстеллар', 'Аркейн', 'Джентльмены', 'Дюна: Часть вторая', 'Оппенгеймер', 'Киберпанк: Бегущие по краю'];
for (const title of favTitles) {
  const res = db.prepare("UPDATE bookmarks SET is_favorite = 1 WHERE user_id = 2 AND title LIKE ?").run(`%${title}%`);
  console.log(`Updated is_favorite for ${title}:`, res);
}

// 3. Постеры в watch_history для пользователя 2
db.prepare("UPDATE watch_history SET poster_url = 'https://v17.fanfilm4k.media/uploads/posts/2026-09/w1500_57684498.jpg' WHERE user_id = 2 AND title LIKE '%Мэйдэй%'").run();
db.prepare("UPDATE watch_history SET poster_url = '/api/media/image-proxy?url=https%3A%2F%2Fimage.tmdb.org%2Ft%2Fp%2Fw500%2F3aLghRkuJc9cs770fxo4a6YWht3.jpg' WHERE user_id = 2 AND title LIKE '%Дюна%'").run();
db.prepare("UPDATE watch_history SET poster_url = '/api/media/image-proxy?url=https%3A%2F%2Fimage.tmdb.org%2Ft%2Fp%2Fw500%2FgRkvq6FgiGRdtCwhVIozaUqhoDL.jpg' WHERE user_id = 2 AND title LIKE '%Укрытие%'").run();
db.prepare("UPDATE watch_history SET poster_url = '/api/media/image-proxy?url=https%3A%2F%2Fimage.tmdb.org%2Ft%2Fp%2Fw500%2F9whSxgqSW7dPIIMJyM4WG3BYVo7.jpg' WHERE user_id = 2 AND title LIKE '%Атака титанов%'").run();
db.prepare("UPDATE watch_history SET poster_url = '/api/media/image-proxy?url=https%3A%2F%2Fimage.tmdb.org%2Ft%2Fp%2Fw500%2FAg7gBPnh8Cpn5xvCdPPA4RJRN1L.jpg' WHERE user_id = 2 AND title LIKE '%Разделение%'").run();
db.prepare("UPDATE watch_history SET poster_url = '/api/media/image-proxy?url=https%3A%2F%2Fimage.tmdb.org%2Ft%2Fp%2Fw500%2Fw15qxusZtam6ipBGEWBcwg9WQNN.jpg' WHERE user_id = 2 AND title LIKE '%Киберпанк%'").run();
db.prepare("UPDATE watch_history SET poster_url = '/api/media/image-proxy?url=https%3A%2F%2Fimage.tmdb.org%2Ft%2Fp%2Fw500%2FwH0kbTvbrvtlCygso7Ye2ZfGfM1.jpg' WHERE user_id = 2 AND title LIKE '%Человек-паук%'").run();

// 4. Добавляем Мэйдэй в planned для пользователя 2, если его еще нет
const maydayExists = db.prepare("SELECT id FROM bookmarks WHERE user_id = 2 AND title LIKE '%Мэйдэй%'").get();
if (!maydayExists) {
  db.prepare(`
    INSERT INTO bookmarks (user_id, media_id, source, title, original_title, poster_url, media_type, year, status, is_favorite, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    2,
    'mayday_2026',
    'tmdb',
    'Мэйдэй',
    'Mayday',
    'https://v17.fanfilm4k.media/uploads/posts/2026-09/w1500_57684498.jpg',
    'movie',
    '2026',
    'planned',
    0,
    Date.now()
  );
  console.log('Added Mayday to bookmarks for user 2');
}

console.log('Database patching complete!');
