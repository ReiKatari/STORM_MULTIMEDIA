import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, 'storm_multimedia.db');

export const db = new DatabaseSync(dbPath);

// Настройка оптимизации SQLite (WAL режим, synchronous = NORMAL)
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    avatar TEXT,
    role TEXT DEFAULT 'user',
    created_at INTEGER NOT NULL,
    settings_json TEXT DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS bookmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    media_id TEXT NOT NULL,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    original_title TEXT,
    poster_url TEXT,
    media_type TEXT NOT NULL,
    status TEXT NOT NULL, -- 'watching', 'plan', 'completed', 'hold', 'dropped', 'favorite'
    episodes_watched INTEGER DEFAULT 0,
    total_episodes INTEGER DEFAULT 0,
    progress_percent REAL DEFAULT 0.0,
    last_time_seconds INTEGER DEFAULT 0,
    updated_at INTEGER NOT NULL,
    UNIQUE(user_id, media_id, source),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS custom_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    color TEXT DEFAULT '#00d2ff',
    is_public INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS custom_list_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id INTEGER NOT NULL,
    media_id TEXT NOT NULL,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    poster_url TEXT,
    media_type TEXT,
    year TEXT,
    rating REAL,
    added_at INTEGER NOT NULL,
    UNIQUE(list_id, media_id, source),
    FOREIGN KEY(list_id) REFERENCES custom_lists(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS watch_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    media_id TEXT NOT NULL,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    poster_url TEXT,
    media_type TEXT,
    season INTEGER DEFAULT 1,
    episode INTEGER DEFAULT 1,
    time_seconds INTEGER DEFAULT 0,
    duration_seconds INTEGER DEFAULT 0,
    progress_percent REAL DEFAULT 0.0,
    updated_at INTEGER NOT NULL,
    UNIQUE(user_id, media_id, source, season, episode),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS media_cache (
    source TEXT NOT NULL,
    cache_key TEXT NOT NULL,
    data_json TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY(source, cache_key)
  );

  CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id, status);
  CREATE INDEX IF NOT EXISTS idx_history_user ON watch_history(user_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    media_id TEXT NOT NULL,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    rating INTEGER DEFAULT 10,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS review_likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    review_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    is_like INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(review_id, user_id),
    FOREIGN KEY(review_id) REFERENCES reviews(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    achievement_id TEXT NOT NULL,
    progress INTEGER DEFAULT 0,
    target INTEGER DEFAULT 1,
    unlocked INTEGER DEFAULT 0,
    unlocked_at INTEGER,
    UNIQUE(user_id, achievement_id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_reviews_media ON reviews(media_id, source);
  CREATE INDEX IF NOT EXISTS idx_achievements_user ON user_achievements(user_id, unlocked);
`);

// Хеширование пароля через pbkdf2
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, key] = storedHash.split(':');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return key === hash;
}

// Управление пользователями
export function registerUser(username, email, password, avatar = null) {
  const existingUser = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
  if (existingUser) {
    throw new Error('Пользователь с таким именем или email уже существует');
  }

  const passwordHash = hashPassword(password);
  const now = Date.now();
  const defaultAvatar = avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(username)}`;

  const insert = db.prepare(`
    INSERT INTO users (username, email, password_hash, avatar, created_at, settings_json)
    VALUES (?, ?, ?, ?, ?, '{}')
  `);
  const result = insert.run(username, email, passwordHash, defaultAvatar, now);
  const userId = Number(result.lastInsertRowid);

  // Создание дефолтных коллекций
  const createList = db.prepare(`
    INSERT INTO custom_lists (user_id, title, description, color, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  createList.run(userId, 'Избранные шедевры', 'Коллекция лучших фильмов и сериалов', '#00d2ff', now);
  createList.run(userId, 'Аниме марафон', 'Список аниме для просмотра на выходных', '#ff007f', now);

  return createSession(userId);
}

export function loginUser(login, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(login, login);
  if (!user) {
    throw new Error('Неверное имя пользователя или пароль');
  }

  if (!verifyPassword(password, user.password_hash)) {
    throw new Error('Неверное имя пользователя или пароль');
  }

  return createSession(user.id);
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 дней

  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt);
  const user = db.prepare('SELECT id, username, email, avatar, role, created_at, settings_json FROM users WHERE id = ?').get(userId);

  return {
    token,
    user: {
      ...user,
      settings: JSON.parse(user.settings_json || '{}')
    }
  };
}

export function getOrCreateDefaultUserSession() {
  let user = db.prepare('SELECT id, username, email, avatar, role, created_at, settings_json FROM users WHERE username = ?').get('ReiKatari');
  const now = Date.now();
  if (!user) {
    const passwordHash = hashPassword('Storm2026!');
    const res = db.prepare(`
      INSERT INTO users (username, email, password_hash, avatar, role, created_at, settings_json)
      VALUES (?, ?, ?, ?, 'admin', ?, '{}')
    `).run('ReiKatari', '45316432+ReiKatari@users.noreply.github.com', passwordHash, 'assets/favicon.svg', now);
    const userId = Number(res.lastInsertRowid);
    user = db.prepare('SELECT id, username, email, avatar, role, created_at, settings_json FROM users WHERE id = ?').get(userId);

    const createList = db.prepare(`
      INSERT INTO custom_lists (user_id, title, description, color, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    createList.run(userId, 'Избранные шедевры', 'Коллекция лучших фильмов и сериалов', '#00d2ff', now);
    createList.run(userId, 'Аниме марафон', 'Список аниме для просмотра на выходных', '#ff007f', now);
  }

  // Заполняем реалистичные закладки и прогресс для демонстрации
  const bCount = db.prepare('SELECT COUNT(*) as count FROM bookmarks WHERE user_id = ?').get(user.id);
  if (!bCount || bCount.count === 0) {
    const seedBookmarks = [
      { media_id: '693134', source: 'tmdb', title: 'Дюна: Часть вторая', media_type: 'movie', status: 'watching', progress_percent: 78.5, episodes_watched: 0, total_episodes: 0 },
      { media_id: '872585', source: 'tmdb', title: 'Оппенгеймер', media_type: 'movie', status: 'completed', progress_percent: 100.0, episodes_watched: 0, total_episodes: 0 },
      { media_id: '569094', source: 'tmdb', title: 'Человек-паук: Паутина вселенных', media_type: 'cartoons', status: 'watching', progress_percent: 45.0, episodes_watched: 0, total_episodes: 0 },
      { media_id: '157336', source: 'tmdb', title: 'Интерстеллар', media_type: 'movie', status: 'favorite', progress_percent: 92.0, episodes_watched: 0, total_episodes: 0 },
      { media_id: '335984', source: 'tmdb', title: 'Бегущий по лезвию 2049', media_type: 'movie', status: 'watching', progress_percent: 64.0, episodes_watched: 0, total_episodes: 0 },
      { media_id: '94605', source: 'tmdb', title: 'Аркейн', media_type: 'series', status: 'watching', progress_percent: 50.0, episodes_watched: 5, total_episodes: 9 },
      { media_id: '1429', source: 'tmdb', title: 'Атака титанов', media_type: 'series', status: 'watching', progress_percent: 85.0, episodes_watched: 20, total_episodes: 25 },
      { media_id: '105248', source: 'tmdb', title: 'Киберпанк: Бегущие по краю', media_type: 'series', status: 'completed', progress_percent: 100.0, episodes_watched: 10, total_episodes: 10 }
    ];

    const stmt = db.prepare(`
      INSERT INTO bookmarks (user_id, media_id, source, title, original_title, poster_url, media_type, status, episodes_watched, total_episodes, progress_percent, last_time_seconds, updated_at)
      VALUES (?, ?, ?, ?, '', '', ?, ?, ?, ?, ?, 0, ?)
    `);

    seedBookmarks.forEach(b => {
      stmt.run(user.id, b.media_id, b.source, b.title, b.media_type, b.status, b.episodes_watched, b.total_episodes, b.progress_percent, now);
    });
  }

  const existingSession = db.prepare('SELECT token FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY expires_at DESC LIMIT 1').get(user.id, now);
  if (existingSession) {
    return {
      token: existingSession.token,
      user: {
        ...user,
        settings: JSON.parse(user.settings_json || '{}')
      }
    };
  }

  return createSession(user.id);
}

export function getUserByToken(token) {
  if (!token) return null;
  const session = db.prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > ?').get(token, Date.now());
  if (!session) return null;

  const user = db.prepare('SELECT id, username, email, avatar, role, created_at, settings_json FROM users WHERE id = ?').get(session.user_id);
  if (!user) return null;

  return {
    ...user,
    settings: JSON.parse(user.settings_json || '{}')
  };
}

export function logoutUser(token) {
  if (token) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
}

export function updateUserSettings(userId, settings) {
  const settingsJson = JSON.stringify(settings || {});
  db.prepare('UPDATE users SET settings_json = ? WHERE id = ?').run(settingsJson, userId);
}

export function getUserFamilyProfiles(userId) {
  const user = db.prepare('SELECT settings_json FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  const settings = JSON.parse(user.settings_json || '{}');
  return settings.familyProfiles || null;
}

export function saveUserFamilyProfiles(userId, profiles) {
  const user = db.prepare('SELECT settings_json FROM users WHERE id = ?').get(userId);
  if (!user) return false;
  const settings = JSON.parse(user.settings_json || '{}');
  settings.familyProfiles = profiles;
  updateUserSettings(userId, settings);
  return true;
}

export function updateUserProfile(userId, { username, email, avatar }) {
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('Пользователь не найден');

  if (username) {
    const existing = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, userId);
    if (existing) throw new Error('Имя пользователя уже занято');
  }

  if (email) {
    const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, userId);
    if (existing) throw new Error('Email уже используется');
  }

  let query = 'UPDATE users SET ';
  const params = [];
  const updates = [];

  if (username) { updates.push('username = ?'); params.push(username); }
  if (email) { updates.push('email = ?'); params.push(email); }
  if (avatar) { updates.push('avatar = ?'); params.push(avatar); }

  if (updates.length === 0) return user;

  query += updates.join(', ') + ' WHERE id = ?';
  params.push(userId);

  db.prepare(query).run(...params);
  return db.prepare('SELECT id, username, email, avatar, role, created_at, settings_json FROM users WHERE id = ?').get(userId);
}

export function changeUserPassword(userId, oldPassword, newPassword) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('Пользователь не найден');

  if (!verifyPassword(oldPassword, user.password_hash)) {
    throw new Error('Текущий пароль указан неверно');
  }

  if (!newPassword || newPassword.length < 6) {
    throw new Error('Новый пароль должен содержать не менее 6 символов');
  }

  const newHash = hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, userId);
}

// Статистика пользователя
export function getUserStats(userId) {
  const bookmarksCount = db.prepare('SELECT count(*) as count FROM bookmarks WHERE user_id = ?').get(userId).count;
  const completedCount = db.prepare("SELECT count(*) as count FROM bookmarks WHERE user_id = ? AND status = 'completed'").get(userId).count;
  const watchingCount = db.prepare("SELECT count(*) as count FROM bookmarks WHERE user_id = ? AND status = 'watching'").get(userId).count;
  const plannedCount = db.prepare("SELECT count(*) as count FROM bookmarks WHERE user_id = ? AND (status = 'planned' OR status = 'plan')").get(userId).count;
  const favoriteCount = db.prepare("SELECT count(*) as count FROM bookmarks WHERE user_id = ? AND status = 'favorite'").get(userId).count;
  const onHoldCount = db.prepare("SELECT count(*) as count FROM bookmarks WHERE user_id = ? AND (status = 'on_hold' OR status = 'hold')").get(userId).count;
  const droppedCount = db.prepare("SELECT count(*) as count FROM bookmarks WHERE user_id = ? AND status = 'dropped'").get(userId).count;
  const wontWatchCount = db.prepare("SELECT count(*) as count FROM bookmarks WHERE user_id = ? AND (status = 'wont_watch' OR status = 'abandoned')").get(userId).count;
  const totalWatchedSeconds = db.prepare('SELECT COALESCE(SUM(time_seconds), 0) as total FROM watch_history WHERE user_id = ?').get(userId).total;
  const customListsCount = db.prepare('SELECT count(*) as count FROM custom_lists WHERE user_id = ?').get(userId).count;

  return {
    bookmarksCount,
    completedCount,
    watchingCount,
    plannedCount,
    favoriteCount,
    onHoldCount,
    droppedCount,
    wontWatchCount,
    totalWatchedHours: Math.round((totalWatchedSeconds / 3600) * 10) / 10,
    customListsCount
  };
}

// Закладки и статусы
export function normalizeMediaKey(title, originalTitle = '') {
  if (!title && !originalTitle) return '';
  const raw = `${title || ''} ${originalTitle || ''}`.toLowerCase();
  return raw
    .replace(/\s*[\(\[]?\s*(19\d\d|20\d\d)\s*[\)\]]?/g, ' ')
    .replace(/\s*[\(\[]?\s*(постер|постер\s*4[kк]|4[kк]\s*uhd|4[kк]|uhd|fhd|1080p|720p|сериал|фильм|мультфильм|сезон\s*\d+|\d+\s*сезон)\s*[\)\]]?/gi, ' ')
    .replace(/[^a-zа-я0-9]/gi, '')
    .trim();
}

export function getUserBookmarks(userId, status = null, mediaType = null) {
  let query = 'SELECT * FROM bookmarks WHERE user_id = ?';
  const params = [userId];

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  if (mediaType) {
    query += ' AND media_type = ?';
    params.push(mediaType);
  }

  query += ` ORDER BY 
    CASE status 
      WHEN 'watching' THEN 1 
      WHEN 'favorite' THEN 2 
      WHEN 'planned' THEN 3 
      WHEN 'plan' THEN 3 
      WHEN 'completed' THEN 4 
      WHEN 'on_hold' THEN 5 
      WHEN 'hold' THEN 5 
      WHEN 'dropped' THEN 6 
      WHEN 'wont_watch' THEN 7 
      ELSE 8 
    END ASC, 
    updated_at DESC`;
  const allRows = db.prepare(query).all(...params);

  // Каноническая дедупликация на уровне базы данных
  const canonicalMap = new Map();
  for (const row of allRows) {
    const key = normalizeMediaKey(row.title, row.original_title) || `${row.source}_${row.media_id}`;
    if (!canonicalMap.has(key)) {
      canonicalMap.set(key, row);
    } else {
      const existing = canonicalMap.get(key);
      if ((row.source === 'tmdb' && existing.source !== 'tmdb') ||
          (row.progress_percent > (existing.progress_percent || 0)) ||
          (row.updated_at > existing.updated_at)) {
        canonicalMap.set(key, {
          ...existing,
          ...row,
          progress_percent: Math.max(row.progress_percent || 0, existing.progress_percent || 0)
        });
      }
    }
  }

  const statusRank = (st) => {
    switch (st) {
      case 'watching': return 1;
      case 'favorite': return 2;
      case 'plan':
      case 'planned': return 3;
      case 'completed': return 4;
      case 'hold':
      case 'on_hold': return 5;
      case 'dropped': return 6;
      case 'wont_watch': return 7;
      default: return 8;
    }
  };

  const results = Array.from(canonicalMap.values());
  results.sort((a, b) => {
    const diff = statusRank(a.status) - statusRank(b.status);
    if (diff !== 0) return diff;
    return (b.updated_at || 0) - (a.updated_at || 0);
  });

  return results;
}

export function getBookmark(userId, mediaId, source) {
  const byId = db.prepare('SELECT * FROM bookmarks WHERE user_id = ? AND media_id = ? AND source = ?').get(userId, mediaId, source);
  if (byId) return byId;

  // Поиск по очищенному идентификатору
  const cleanId = String(mediaId).replace(/^[a-z]+_/, '');
  return db.prepare('SELECT * FROM bookmarks WHERE user_id = ? AND (media_id = ? OR media_id = ?)').get(userId, String(mediaId), cleanId);
}

export function setBookmark(userId, data) {
  const {
    media_id,
    source,
    title,
    original_title = '',
    poster_url = '',
    media_type = 'movie',
    status = 'watching',
    episodes_watched = 0,
    total_episodes = 0,
    progress_percent = 0.0,
    last_time_seconds = 0
  } = data;

  if (!status || status === 'none' || status === 'null') {
    removeBookmark(userId, media_id, source, title);
    return null;
  }

  const now = Date.now();
  const targetKey = normalizeMediaKey(title, original_title);

  // Ищем существующую запись того же фильма у пользователя для предотвращения дублей между источниками
  const existingRows = db.prepare('SELECT * FROM bookmarks WHERE user_id = ?').all(userId);
  const duplicateRows = existingRows.filter(r => {
    return (String(r.media_id) === String(media_id) && r.source === source) ||
           (targetKey && normalizeMediaKey(r.title, r.original_title) === targetKey);
  });

  if (duplicateRows.length > 0) {
    const primary = duplicateRows[0];
    db.prepare(`
      UPDATE bookmarks SET
        media_id = ?,
        source = ?,
        title = ?,
        original_title = ?,
        poster_url = COALESCE(NULLIF(?, ''), poster_url),
        media_type = ?,
        status = ?,
        episodes_watched = ?,
        total_episodes = ?,
        progress_percent = ?,
        last_time_seconds = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      String(media_id),
      source,
      title,
      original_title,
      poster_url,
      media_type,
      status,
      episodes_watched,
      total_episodes,
      progress_percent,
      last_time_seconds,
      now,
      primary.id
    );

    // Удаляем любые остальные дублирующие строки этого релиза
    if (duplicateRows.length > 1) {
      const extraIds = duplicateRows.slice(1).map(r => r.id);
      db.prepare(`DELETE FROM bookmarks WHERE id IN (${extraIds.join(',')})`).run();
    }

    return db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(primary.id);
  }

  // Новая закладка
  const insert = db.prepare(`
    INSERT INTO bookmarks (
      user_id, media_id, source, title, original_title, poster_url, media_type,
      status, episodes_watched, total_episodes, progress_percent, last_time_seconds, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run(
    userId,
    String(media_id),
    source,
    title,
    original_title,
    poster_url,
    media_type,
    status,
    episodes_watched,
    total_episodes,
    progress_percent,
    last_time_seconds,
    now
  );

  return getBookmark(userId, String(media_id), source);
}

export function removeBookmark(userId, mediaId, source, title = '') {
  const strId = String(mediaId || '');
  const cleanId = strId.replace(/^[a-z]+_/, '');
  const prefixId = `${source}_${cleanId}`;
  const targetKey = normalizeMediaKey(title);

  db.prepare(`
    DELETE FROM bookmarks
    WHERE user_id = ?
      AND (media_id = ? OR media_id = ? OR media_id = ?)
  `).run(userId, strId, cleanId, prefixId);

  // Дополнительно удаляем по названию для очистки записей альтернативных плееров
  if (targetKey) {
    const userBookmarks = db.prepare('SELECT id, title, original_title FROM bookmarks WHERE user_id = ?').all(userId);
    const matchedIds = userBookmarks
      .filter(b => normalizeMediaKey(b.title, b.original_title) === targetKey)
      .map(b => b.id);

    if (matchedIds.length > 0) {
      db.prepare(`DELETE FROM bookmarks WHERE id IN (${matchedIds.join(',')})`).run();
    }
  }
}

// История и прогресс просмотра
export function logWatchProgress(userId, data) {
  const {
    media_id,
    source,
    title,
    poster_url = '',
    media_type = 'movie',
    season = 1,
    episode = 1,
    time_seconds = 0,
    duration_seconds = 0,
    total_episodes = 1
  } = data;

  let progressPercent = 0.0;
  if (duration_seconds > 0) {
    progressPercent = Math.min(100.0, Math.round((time_seconds / duration_seconds) * 1000) / 10);
  }

  const now = Date.now();

  // Сохраняем в историю
  const upsertHistory = db.prepare(`
    INSERT INTO watch_history (
      user_id, media_id, source, title, poster_url, media_type,
      season, episode, time_seconds, duration_seconds, progress_percent, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, media_id, source, season, episode) DO UPDATE SET
      time_seconds = excluded.time_seconds,
      duration_seconds = excluded.duration_seconds,
      progress_percent = excluded.progress_percent,
      updated_at = excluded.updated_at
  `);

  upsertHistory.run(
    userId,
    String(media_id),
    source,
    title,
    poster_url,
    media_type,
    season,
    episode,
    time_seconds,
    duration_seconds,
    progressPercent,
    now
  );

  // Синхронизируем прогресс с закладкой:
  // ПРАВИЛО: В «Мои списки и закладки» попадает ТОЛЬКО то, где пользователь САМ проставил статус.
  // При обычном просмотре статус 'watching' НЕ проставляется автоматически.
  // Автоматически статус проставляется/меняется ТОЛЬКО после полного просмотра (>= 95%) на 'completed' (Просмотрено).
  const existingBookmark = getBookmark(userId, String(media_id), source);
  const episodesWatched = episode;
  let overallPercent = progressPercent;

  if (total_episodes > 1) {
    overallPercent = Math.min(100.0, Math.round(((episode - 1 + (progressPercent / 100)) / total_episodes) * 1000) / 10);
  }

  const isFullyWatched = overallPercent >= 95.0 || (total_episodes > 0 && episodesWatched >= total_episodes && progressPercent >= 90.0);

  if (existingBookmark) {
    const finalStatus = isFullyWatched ? 'completed' : existingBookmark.status;
    const finalPercent = isFullyWatched ? 100.0 : overallPercent;

    setBookmark(userId, {
      media_id,
      source,
      title: title || existingBookmark.title,
      poster_url: poster_url || existingBookmark.poster_url,
      media_type: media_type || existingBookmark.media_type,
      status: finalStatus,
      episodes_watched: isFullyWatched ? (total_episodes || episodesWatched) : episodesWatched,
      total_episodes: total_episodes || existingBookmark.total_episodes || 1,
      progress_percent: finalPercent,
      last_time_seconds: time_seconds
    });
  } else if (isFullyWatched) {
    setBookmark(userId, {
      media_id,
      source,
      title,
      poster_url,
      media_type,
      status: 'completed',
      episodes_watched: total_episodes || episodesWatched,
      total_episodes: total_episodes || 1,
      progress_percent: 100.0,
      last_time_seconds: time_seconds
    });
  }

  return {
    media_id,
    season,
    episode,
    time_seconds,
    progress_percent: overallPercent,
    status: isFullyWatched ? 'completed' : (existingBookmark?.status || null)
  };
}

export function getContinueWatching(userId, limit = 12) {
  const query = `
    SELECT * FROM watch_history
    WHERE user_id = ? AND progress_percent < 95
    ORDER BY updated_at DESC
  `;
  const allRows = db.prepare(query).all(userId);

  const canonicalMap = new Map();
  for (const row of allRows) {
    const key = normalizeMediaKey(row.title) || `${row.source}_${row.media_id}`;
    if (!canonicalMap.has(key)) {
      canonicalMap.set(key, row);
    }
  }

  return Array.from(canonicalMap.values()).slice(0, limit);
}

// Кастомные списки и коллекции
export function getCustomLists(userId) {
  const lists = db.prepare('SELECT * FROM custom_lists WHERE user_id = ? ORDER BY created_at DESC').all(userId);
  const getItemsCount = db.prepare('SELECT count(*) as count FROM custom_list_items WHERE list_id = ?');

  return lists.map(list => ({
    ...list,
    items_count: getItemsCount.get(list.id).count
  }));
}

export function getCustomListDetails(listId, userId) {
  const list = db.prepare('SELECT * FROM custom_lists WHERE id = ? AND (user_id = ? OR is_public = 1)').get(listId, userId);
  if (!list) return null;

  const items = db.prepare('SELECT * FROM custom_list_items WHERE list_id = ? ORDER BY added_at DESC').all(listId);
  return {
    ...list,
    items
  };
}

export function createCustomList(userId, title, description = '', color = '#00d2ff', isPublic = 0) {
  const cleanTitle = (title || '').trim();
  const existing = db.prepare('SELECT id FROM custom_lists WHERE user_id = ? AND LOWER(TRIM(title)) = LOWER(?)').get(userId, cleanTitle);
  if (existing) {
    throw new Error('Коллекция с таким названием уже создана');
  }

  const now = Date.now();
  const insert = db.prepare(`
    INSERT INTO custom_lists (user_id, title, description, color, is_public, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = insert.run(userId, cleanTitle, description, color, isPublic ? 1 : 0, now);
  return {
    id: Number(result.lastInsertRowid),
    user_id: userId,
    title: cleanTitle,
    description,
    color,
    is_public: isPublic,
    created_at: now,
    items_count: 0
  };
}

export function deleteCustomList(listId, userId) {
  db.prepare('DELETE FROM custom_lists WHERE id = ? AND user_id = ?').run(listId, userId);
}

export function addCustomListItem(listId, userId, item) {
  const list = db.prepare('SELECT id FROM custom_lists WHERE id = ? AND user_id = ?').get(listId, userId);
  if (!list) throw new Error('Список не найден или нет доступа');

  const existingItem = db.prepare('SELECT id FROM custom_list_items WHERE list_id = ? AND media_id = ? AND source = ?').get(listId, String(item.media_id), item.source);
  if (existingItem) {
    throw new Error('Данный релиз уже добавлен в эту коллекцию');
  }

  const now = Date.now();
  const insert = db.prepare(`
    INSERT INTO custom_list_items (list_id, media_id, source, title, poster_url, media_type, year, rating, added_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run(
    listId,
    String(item.media_id),
    item.source,
    item.title,
    item.poster_url || '',
    item.media_type || 'movie',
    item.year || '',
    item.rating || 0.0,
    now
  );
}

export function removeCustomListItem(listId, userId, mediaId, source) {
  const list = db.prepare('SELECT id FROM custom_lists WHERE id = ? AND user_id = ?').get(listId, userId);
  if (!list) throw new Error('Список не найден');

  db.prepare('DELETE FROM custom_list_items WHERE list_id = ? AND media_id = ? AND source = ?').run(listId, String(mediaId), source);
}

// Кэширование сетевых запросов
export function getCache(source, cacheKey) {
  const row = db.prepare('SELECT data_json, expires_at FROM media_cache WHERE source = ? AND cache_key = ?').get(source, cacheKey);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM media_cache WHERE source = ? AND cache_key = ?').run(source, cacheKey);
    return null;
  }
  try {
    return JSON.parse(row.data_json);
  } catch {
    return null;
  }
}

export function setCache(source, cacheKey, data, ttlSeconds = 1800) {
  const expiresAt = Date.now() + (ttlSeconds * 1000);
  const dataJson = JSON.stringify(data);
  db.prepare(`
    INSERT INTO media_cache (source, cache_key, data_json, expires_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(source, cache_key) DO UPDATE SET
      data_json = excluded.data_json,
      expires_at = excluded.expires_at
  `).run(source, cacheKey, dataJson, expiresAt);
}

// ==========================================
// 7. СИСТЕМА РЕЦЕНЗИЙ И ОТЗЫВОВ
// ==========================================

export function getMediaReviews(mediaId, source, currentUserId = null) {
  const reviews = db.prepare(`
    SELECT r.*, u.username, u.avatar,
      COALESCE((SELECT COUNT(*) FROM review_likes WHERE review_id = r.id AND is_like = 1), 0) AS likes_count,
      COALESCE((SELECT COUNT(*) FROM review_likes WHERE review_id = r.id AND is_like = 0), 0) AS dislikes_count
    FROM reviews r
    JOIN users u ON r.user_id = u.id
    WHERE r.media_id = ? AND r.source = ?
    ORDER BY r.created_at DESC
  `).all(String(mediaId), source);

  return reviews.map(rev => {
    let userReaction = null;
    if (currentUserId) {
      const reaction = db.prepare('SELECT is_like FROM review_likes WHERE review_id = ? AND user_id = ?').get(rev.id, currentUserId);
      if (reaction) {
        userReaction = reaction.is_like === 1 ? 'like' : 'dislike';
      }
    }
    return {
      ...rev,
      user_reaction: userReaction
    };
  });
}

export function addReview(userId, { media_id, source, title, rating, content }) {
  const now = Date.now();
  const safeRating = Math.max(1, Math.min(10, parseInt(rating, 10) || 10));
  const insert = db.prepare(`
    INSERT INTO reviews (user_id, media_id, source, title, rating, content, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = insert.run(userId, String(media_id), source, title || '', safeRating, content, now, now);
  const reviewId = Number(result.lastInsertRowid);

  // Начисляем достижения автору рецензии
  trackUserAction(userId, 'write_review');

  const user = db.prepare('SELECT username, avatar FROM users WHERE id = ?').get(userId);
  return {
    id: reviewId,
    user_id: userId,
    media_id: String(media_id),
    source,
    title: title || '',
    rating: safeRating,
    content,
    created_at: now,
    updated_at: now,
    username: user?.username || 'Пользователь',
    avatar: user?.avatar || null,
    likes_count: 0,
    dislikes_count: 0,
    user_reaction: null
  };
}

export function deleteReview(reviewId, userId) {
  db.prepare('DELETE FROM reviews WHERE id = ? AND user_id = ?').run(reviewId, userId);
}

export function toggleReviewLike(reviewId, userId, isLike) {
  const now = Date.now();
  const targetLike = isLike ? 1 : 0;
  const existing = db.prepare('SELECT is_like FROM review_likes WHERE review_id = ? AND user_id = ?').get(reviewId, userId);

  if (existing) {
    if (existing.is_like === targetLike) {
      db.prepare('DELETE FROM review_likes WHERE review_id = ? AND user_id = ?').run(reviewId, userId);
    } else {
      db.prepare('UPDATE review_likes SET is_like = ?, created_at = ? WHERE review_id = ? AND user_id = ?').run(targetLike, now, reviewId, userId);
    }
  } else {
    db.prepare('INSERT INTO review_likes (review_id, user_id, is_like, created_at) VALUES (?, ?, ?, ?)').run(reviewId, userId, targetLike, now);

    // Если поставили лайк, проверяем достижения автора рецензии
    if (targetLike === 1) {
      const rev = db.prepare('SELECT user_id FROM reviews WHERE id = ?').get(reviewId);
      if (rev && rev.user_id !== userId) {
        trackUserAction(rev.user_id, 'receive_like');
      }
    }
  }

  const likesCount = db.prepare('SELECT COUNT(*) AS count FROM review_likes WHERE review_id = ? AND is_like = 1').get(reviewId).count;
  const dislikesCount = db.prepare('SELECT COUNT(*) AS count FROM review_likes WHERE review_id = ? AND is_like = 0').get(reviewId).count;
  const currentReaction = db.prepare('SELECT is_like FROM review_likes WHERE review_id = ? AND user_id = ?').get(reviewId, userId);

  return {
    likes_count: likesCount,
    dislikes_count: dislikesCount,
    user_reaction: currentReaction ? (currentReaction.is_like === 1 ? 'like' : 'dislike') : null
  };
}

// ==========================================
// 8. КАТАЛОГ И СИСТЕМА ДОСТИЖЕНИЙ (STORM ACHIEVEMENTS)
// ==========================================

export const ACHIEVEMENTS_CATALOG = [
  // 1. Киномарафон (Фильмы и сериалы)
  { id: 'cinema_first', title: 'Первый сеанс', desc: 'Посмотреть 1 фильм или серию', category: 'cinema', rarity: 'bronze', icon: '🎬', target: 1 },
  { id: 'cinema_novice', title: 'Кинолюбитель', desc: 'Посмотреть 5 тайтлов', category: 'cinema', rarity: 'bronze', icon: '🍿', target: 5 },
  { id: 'cinema_veteran', title: 'Киноман', desc: 'Посмотреть 15 тайтлов', category: 'cinema', rarity: 'silver', icon: '🎟️', target: 15 },
  { id: 'cinema_master', title: 'Синефил со стажем', desc: 'Посмотреть 30 тайтлов', category: 'cinema', rarity: 'gold', icon: '📽️', target: 30 },
  { id: 'cinema_legend', title: 'Архивариус кинематографа', desc: 'Посмотреть 60 тайтлов', category: 'cinema', rarity: 'platinum', icon: '🏆', target: 60 },
  { id: 'cinema_god', title: 'Владыка киноэкрана', desc: 'Посмотреть 100 тайтлов', category: 'cinema', rarity: 'cyber', icon: '👑', target: 100 },
  { id: 'series_first_ep', title: 'Сериальный старт', desc: 'Посмотреть 1 серию любого сериала', category: 'cinema', rarity: 'bronze', icon: '📺', target: 1 },
  { id: 'series_binge_5', title: 'Сериальный марафон', desc: 'Посмотреть 5 серий сериалов', category: 'cinema', rarity: 'silver', icon: '🛋️', target: 5 },
  { id: 'series_binge_25', title: 'Сериаломан', desc: 'Посмотреть 25 серий сериалов', category: 'cinema', rarity: 'gold', icon: '🍿', target: 25 },
  { id: 'series_season_done', title: 'Завершённый сезон', desc: 'Полностью посмотреть сезон сериала', category: 'cinema', rarity: 'gold', icon: '🏁', target: 1 },
  { id: 'series_three_seasons', title: 'Повелитель сезонов', desc: 'Полностью посмотреть 3 сезона сериалов', category: 'cinema', rarity: 'platinum', icon: '👑', target: 3 },

  // 2. Отаку и аниме-культура
  { id: 'anime_first', title: 'Первый кохай', desc: 'Посмотреть 1 аниме', category: 'anime', rarity: 'bronze', icon: '⛩️', target: 1 },
  { id: 'anime_genin', title: 'Путь шиноби', desc: 'Посмотреть 5 аниме-релизов', category: 'anime', rarity: 'bronze', icon: '🍙', target: 5 },
  { id: 'anime_chunin', title: 'Опытный отаку', desc: 'Посмотреть 15 аниме-релизов', category: 'anime', rarity: 'silver', icon: '🌸', target: 15 },
  { id: 'anime_jonin', title: 'Мастер ниндзюцу', desc: 'Посмотреть 30 аниме-релизов', category: 'anime', rarity: 'gold', icon: '⚡', target: 30 },
  { id: 'anime_hokage', title: 'Легендарный хокаге', desc: 'Посмотреть 50 аниме-релизов', category: 'anime', rarity: 'platinum', icon: '🔥', target: 50 },
  { id: 'anime_kami', title: 'Аниме-божество', desc: 'Посмотреть 100 аниме-релизов', category: 'anime', rarity: 'cyber', icon: '✨', target: 100 },
  { id: 'anime_anilibria', title: 'Голос Анилибрии', desc: 'Посмотреть аниме в озвучке AniLibria', category: 'anime', rarity: 'bronze', icon: '🎙️', target: 1 },
  { id: 'anime_season_pass', title: 'Онгоинг-мастер', desc: 'Посмотреть 12 серий аниме', category: 'anime', rarity: 'silver', icon: '⚡', target: 12 },

  // 3. Жанровые эксперты
  { id: 'genre_scifi', title: 'В глубинах космоса', desc: 'Посмотреть фантастику или научпоп', category: 'genres', rarity: 'bronze', icon: '🚀', target: 1 },
  { id: 'genre_action', title: 'Адреналиновый шквал', desc: 'Посмотреть боевик или остросюжетный триллер', category: 'genres', rarity: 'bronze', icon: '💥', target: 1 },
  { id: 'genre_comedy', title: 'Искренний смех', desc: 'Посмотреть комедию или ситком', category: 'genres', rarity: 'bronze', icon: '😄', target: 1 },
  { id: 'genre_horror', title: 'Стальные нервы', desc: 'Посмотреть хоррор или фильм ужасов', category: 'genres', rarity: 'silver', icon: '👻', target: 1 },
  { id: 'genre_drama', title: 'Глубокие эмоции', desc: 'Посмотреть драматическую картину', category: 'genres', rarity: 'bronze', icon: '🎭', target: 1 },
  { id: 'genre_detective', title: 'Шерлок Холмс', desc: 'Посмотреть детектив или расследование', category: 'genres', rarity: 'silver', icon: '🔍', target: 1 },

  // 4. Хранитель времени
  { id: 'time_1h', title: 'Первый час в Шторме', desc: 'Провести 1 час за просмотром', category: 'time', rarity: 'bronze', icon: '⏱️', target: 1 },
  { id: 'time_5h', title: 'Погружение в поток', desc: 'Провести 5 часов за просмотром', category: 'time', rarity: 'bronze', icon: '⌛', target: 5 },
  { id: 'time_20h', title: 'Ночной марафонец', desc: 'Провести 20 часов за просмотром', category: 'time', rarity: 'silver', icon: '🌙', target: 20 },
  { id: 'time_50h', title: 'Неутомимый зритель', desc: 'Провести 50 часов за просмотром', category: 'time', rarity: 'gold', icon: '🌟', target: 50 },
  { id: 'time_100h', title: 'Повелитель хроноса', desc: 'Провести 100 часов за просмотром', category: 'time', rarity: 'platinum', icon: '🌌', target: 100 },
  { id: 'time_250h', title: 'Вечный житель кибервселенной', desc: 'Провести 250 часов за просмотром', category: 'time', rarity: 'cyber', icon: '🪐', target: 250 },
  { id: 'time_500h', title: 'Хранитель вечности', desc: 'Провести 500 часов за просмотром', category: 'time', rarity: 'cyber', icon: '⏳', target: 500 },

  // 5. Кинокритика и сообщество
  { id: 'review_first', title: 'Первое мнение', desc: 'Оставить свой первый отзыв', category: 'social', rarity: 'bronze', icon: '✍️', target: 1 },
  { id: 'review_3', title: 'Внимательный критик', desc: 'Оставить 3 рецензии', category: 'social', rarity: 'silver', icon: '📝', target: 3 },
  { id: 'review_10', title: 'Золотое перо Шторма', desc: 'Оставить 10 развернутых рецензий', category: 'social', rarity: 'gold', icon: '✒️', target: 10 },
  { id: 'review_liked', title: 'Голос народа', desc: 'Получить первый лайк на свой отзыв', category: 'social', rarity: 'bronze', icon: '👍', target: 1 },
  { id: 'review_popular', title: 'Признание зала', desc: 'Собрать 5 лайков на рецензиях', category: 'social', rarity: 'gold', icon: '💖', target: 5 },
  { id: 'review_rating', title: 'Строгий цензор', desc: 'Поставить 5 личных оценок релизам', category: 'social', rarity: 'silver', icon: '⭐', target: 5 },
  { id: 'room_host', title: 'Капитан кинозала', desc: 'Создать комнату совместного просмотра', category: 'social', rarity: 'silver', icon: '👥', target: 1 },
  { id: 'room_guest', title: 'Кино-компания', desc: 'Присоединиться к кинокомнате', category: 'social', rarity: 'bronze', icon: '🤝', target: 1 },
  { id: 'sync_master', title: 'Синхронизатор данных', desc: 'Синхронизировать или экспортировать библиотеку', category: 'social', rarity: 'silver', icon: '🔄', target: 1 },

  // 6. Коллекционер и архивариус
  { id: 'bookmark_first', title: 'Первая закладка', desc: 'Добавить релиз в закладки', category: 'collection', rarity: 'bronze', icon: '🔖', target: 1 },
  { id: 'bookmark_20', title: 'Личная фильмотека', desc: 'Собрать 20 релизов в закладках', category: 'collection', rarity: 'silver', icon: '📁', target: 20 },
  { id: 'bookmark_50', title: 'Великая коллекция', desc: 'Собрать 50 релизов в закладках', category: 'collection', rarity: 'gold', icon: '🏛️', target: 50 },
  { id: 'bookmark_100', title: 'Золотой фонд', desc: 'Собрать 100 релизов в закладках', category: 'collection', rarity: 'platinum', icon: '💎', target: 100 },
  { id: 'status_watching', title: 'В процессе', desc: 'Добавить 3 релиза в статус «Смотрю»', category: 'collection', rarity: 'bronze', icon: '👀', target: 3 },
  { id: 'status_completed', title: 'Досмотрено до конца', desc: 'Отметить 5 релизов статусом «Просмотрено»', category: 'collection', rarity: 'silver', icon: '✅', target: 5 },
  { id: 'status_planned', title: 'Большие планы', desc: 'Добавить 5 релизов в «Запланировано»', category: 'collection', rarity: 'bronze', icon: '📅', target: 5 },
  { id: 'list_first', title: 'Куратор списков', desc: 'Создать пользовательский список', category: 'collection', rarity: 'bronze', icon: '📋', target: 1 },
  { id: 'list_pro', title: 'Архитектор коллекций', desc: 'Создать 3 тематических списка', category: 'collection', rarity: 'gold', icon: '📚', target: 3 },

  // 7. Кибер-технологии и инновации
  { id: 'tech_4k', title: 'Ценитель 4K Ultra HD', desc: 'Запустить фильм или серию в качестве 4K Ultra HD', category: 'tech', rarity: 'bronze', icon: '💎', target: 1 },
  { id: 'tech_4k_ultra', title: 'Абсолютный ультра-четкий', desc: 'Посмотреть 5 релизов в качестве 4K Ultra HD', category: 'tech', rarity: 'gold', icon: '🔮', target: 5 },
  { id: 'tech_audio_pro', title: 'Аудиофил', desc: 'Включить профессиональный эквалайзер или объемный звук', category: 'tech', rarity: 'silver', icon: '🎧', target: 1 },
  { id: 'tech_video_pro', title: 'Мастер калибровки', desc: 'Настроить профессиональное видео (HDR, резкость или контраст)', category: 'tech', rarity: 'silver', icon: '🎛️', target: 1 },
  { id: 'tech_voiceover_fan', title: 'Голосовой гурман', desc: 'Переключить 3 разные студийные озвучки', category: 'tech', rarity: 'bronze', icon: '📻', target: 3 },
  { id: 'tech_xray', title: 'Рентгеновское зрение', desc: 'Изучить актерский состав через X-Ray', category: 'tech', rarity: 'bronze', icon: '👁️', target: 1 },
  { id: 'tech_torrent', title: 'P2P-пионер', desc: 'Запустить стриминг через WebTorrent', category: 'tech', rarity: 'silver', icon: '🧲', target: 1 },
  { id: 'tech_night', title: 'Ночной охотник', desc: 'Смотреть кино ночью между 02:00 и 05:00', category: 'tech', rarity: 'silver', icon: '🦉', target: 1 },
  { id: 'tech_chameleon', title: 'Хамелеон киберпространства', desc: 'Опробовать все 8 тем оформления', category: 'tech', rarity: 'gold', icon: '🎨', target: 8 },
  { id: 'tech_polyglot', title: 'Полиглот Шторма', desc: 'Переключить 3 языка интерфейса', category: 'tech', rarity: 'silver', icon: '🌐', target: 3 },
  { id: 'tech_voice', title: 'Кибер-голос', desc: 'Использовать голосового ассистента', category: 'tech', rarity: 'bronze', icon: '🎙️', target: 1 },
  { id: 'tech_gamepad', title: 'Штурман геймпада', desc: 'Использовать геймпад или ТВ-режим', category: 'tech', rarity: 'silver', icon: '🎮', target: 1 },
  { id: 'tech_subtitles', title: 'Свои титры', desc: 'Загрузить внешние субтитры или дорожку', category: 'tech', rarity: 'bronze', icon: '💬', target: 1 },
  { id: 'tech_ambilight', title: 'Неоновая аура', desc: 'Включить динамический Ambilight эффект', category: 'tech', rarity: 'bronze', icon: '🌈', target: 1 },
  { id: 'tech_skip', title: 'Мастер таймкодов', desc: 'Пропустить интро или титры по кнопке', category: 'tech', rarity: 'bronze', icon: '⏭️', target: 1 },
  { id: 'tech_pip', title: 'Картинка в картинке', desc: 'Воспроизвести видео в режиме PiP', category: 'tech', rarity: 'bronze', icon: '🖼️', target: 1 },
  { id: 'tech_pwa', title: 'Всегда со мной', desc: 'Установить веб-приложение на устройство', category: 'tech', rarity: 'gold', icon: '📲', target: 1 }
];

export function getUserAchievements(userId) {
  const userRows = db.prepare('SELECT achievement_id, progress, target, unlocked, unlocked_at FROM user_achievements WHERE user_id = ?').all(userId);
  const map = new Map();
  userRows.forEach(row => map.set(row.achievement_id, row));

  return ACHIEVEMENTS_CATALOG.map(ach => {
    const userAch = map.get(ach.id);
    return {
      ...ach,
      progress: userAch ? userAch.progress : 0,
      unlocked: userAch ? Boolean(userAch.unlocked) : false,
      unlocked_at: userAch ? userAch.unlocked_at : null
    };
  });
}

export function updateAchievementProgress(userId, achievementId, amount = 1, isSet = false) {
  const achMeta = ACHIEVEMENTS_CATALOG.find(a => a.id === achievementId);
  if (!achMeta) return null;

  const target = achMeta.target;
  const existing = db.prepare('SELECT progress, unlocked FROM user_achievements WHERE user_id = ? AND achievement_id = ?').get(userId, achievementId);

  let newProgress = 0;
  if (existing) {
    if (existing.unlocked) return null; // Уже разблокировано
    newProgress = isSet ? amount : existing.progress + amount;
  } else {
    newProgress = amount;
  }

  const isUnlocked = newProgress >= target ? 1 : 0;
  const now = isUnlocked ? Date.now() : null;

  db.prepare(`
    INSERT INTO user_achievements (user_id, achievement_id, progress, target, unlocked, unlocked_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, achievement_id) DO UPDATE SET
      progress = excluded.progress,
      unlocked = excluded.unlocked,
      unlocked_at = excluded.unlocked_at
  `).run(userId, achievementId, Math.min(newProgress, target), target, isUnlocked, now);

  if (isUnlocked && (!existing || !existing.unlocked)) {
    return {
      unlocked: true,
      achievement: {
        ...achMeta,
        progress: target,
        unlocked: true,
        unlocked_at: now
      }
    };
  }

  return {
    unlocked: false,
    progress: newProgress,
    target
  };
}

export function trackUserAction(userId, actionType, meta = {}) {
  if (!userId) return [];
  const unlockedAchievements = [];

  const tryUnlock = (achId, amount = 1, isSet = false) => {
    const res = updateAchievementProgress(userId, achId, amount, isSet);
    if (res && res.unlocked) {
      unlockedAchievements.push(res.achievement);
    }
  };

  switch (actionType) {
    case 'watch_complete':
      tryUnlock('cinema_first', 1);
      tryUnlock('cinema_novice', 1);
      tryUnlock('cinema_veteran', 1);
      tryUnlock('cinema_master', 1);
      tryUnlock('cinema_legend', 1);
      tryUnlock('cinema_god', 1);
      if (meta.is_anime) {
        tryUnlock('anime_first', 1);
        tryUnlock('anime_genin', 1);
        tryUnlock('anime_chunin', 1);
        tryUnlock('anime_jonin', 1);
        tryUnlock('anime_hokage', 1);
        tryUnlock('anime_kami', 1);
      }
      break;

    case 'watch_time':
      const hours = meta.total_hours || 1;
      tryUnlock('time_1h', hours, true);
      tryUnlock('time_5h', hours, true);
      tryUnlock('time_20h', hours, true);
      tryUnlock('time_50h', hours, true);
      tryUnlock('time_100h', hours, true);
      tryUnlock('time_250h', hours, true);
      tryUnlock('time_500h', hours, true);
      break;

    case 'watch_series_episode':
      tryUnlock('series_first_ep', 1);
      tryUnlock('series_binge_5', 1);
      tryUnlock('series_binge_25', 1);
      break;

    case 'complete_season':
      tryUnlock('series_season_done', 1);
      tryUnlock('series_three_seasons', 1);
      break;

    case 'watch_genre':
      const genre = (meta.genre || '').toLowerCase();
      if (genre.includes('фантастик') || genre.includes('космос') || genre.includes('науч')) tryUnlock('genre_scifi', 1);
      if (genre.includes('боевик') || genre.includes('триллер') || genre.includes('экшен')) tryUnlock('genre_action', 1);
      if (genre.includes('комед')) tryUnlock('genre_comedy', 1);
      if (genre.includes('ужас') || genre.includes('хоррор')) tryUnlock('genre_horror', 1);
      if (genre.includes('драм')) tryUnlock('genre_drama', 1);
      if (genre.includes('детектив') || genre.includes('криминал')) tryUnlock('genre_detective', 1);
      break;

    case 'write_review':
      tryUnlock('review_first', 1);
      tryUnlock('review_3', 1);
      tryUnlock('review_10', 1);
      break;

    case 'rate_media':
      tryUnlock('review_rating', 1);
      break;

    case 'receive_like':
      tryUnlock('review_liked', 1);
      tryUnlock('review_popular', 1);
      break;

    case 'room_host':
      tryUnlock('room_host', 1);
      break;

    case 'room_guest':
      tryUnlock('room_guest', 1);
      break;

    case 'sync_data':
      tryUnlock('sync_master', 1);
      break;

    case 'add_bookmark':
      const totalBookmarks = db.prepare('SELECT COUNT(*) AS count FROM bookmarks WHERE user_id = ?').get(userId).count;
      tryUnlock('bookmark_first', totalBookmarks, true);
      tryUnlock('bookmark_20', totalBookmarks, true);
      tryUnlock('bookmark_50', totalBookmarks, true);
      tryUnlock('bookmark_100', totalBookmarks, true);
      break;

    case 'update_status':
      const watchingCnt = db.prepare("SELECT COUNT(*) AS count FROM bookmarks WHERE user_id = ? AND status = 'watching'").get(userId)?.count || 0;
      if (watchingCnt > 0) tryUnlock('status_watching', watchingCnt, true);
      const completedCnt = db.prepare("SELECT COUNT(*) AS count FROM bookmarks WHERE user_id = ? AND status = 'completed'").get(userId)?.count || 0;
      if (completedCnt > 0) tryUnlock('status_completed', completedCnt, true);
      const plannedCnt = db.prepare("SELECT COUNT(*) AS count FROM bookmarks WHERE user_id = ? AND status = 'planned'").get(userId)?.count || 0;
      if (plannedCnt > 0) tryUnlock('status_planned', plannedCnt, true);
      break;

    case 'create_list':
      const totalLists = db.prepare('SELECT COUNT(*) AS count FROM custom_lists WHERE user_id = ?').get(userId).count;
      tryUnlock('list_first', totalLists, true);
      tryUnlock('list_pro', totalLists, true);
      break;

    case 'use_4k':
      tryUnlock('tech_4k', 1);
      tryUnlock('tech_4k_ultra', 1);
      break;

    case 'use_pro_audio':
      tryUnlock('tech_audio_pro', 1);
      break;

    case 'use_pro_video':
      tryUnlock('tech_video_pro', 1);
      break;

    case 'switch_voiceover':
      tryUnlock('tech_voiceover_fan', 1);
      break;

    case 'use_xray':
      tryUnlock('tech_xray', 1);
      break;

    case 'use_torrent':
      tryUnlock('tech_torrent', 1);
      break;

    case 'night_watch':
      tryUnlock('tech_night', 1);
      break;

    case 'switch_theme':
      if (meta.themes_count) {
        tryUnlock('tech_chameleon', meta.themes_count, true);
      }
      break;

    case 'switch_lang':
      if (meta.langs_count) {
        tryUnlock('tech_polyglot', meta.langs_count, true);
      }
      break;

    case 'use_voice':
      tryUnlock('tech_voice', 1);
      break;

    case 'use_gamepad':
      tryUnlock('tech_gamepad', 1);
      break;

    case 'use_subtitles':
      tryUnlock('tech_subtitles', 1);
      break;

    case 'use_ambilight':
      tryUnlock('tech_ambilight', 1);
      break;

    case 'use_skip':
      tryUnlock('tech_skip', 1);
      break;

    case 'use_pip':
      tryUnlock('tech_pip', 1);
      break;

    case 'install_pwa':
      tryUnlock('tech_pwa', 1);
      break;

    default:
      break;
  }

  return unlockedAchievements;
}

export function autoSyncUserAchievements(userId, clientState = {}) {
  if (!userId) return [];
  const unlockedAchievements = [];

  const tryUnlock = (achId, amount = 1, isSet = false) => {
    const res = updateAchievementProgress(userId, achId, amount, isSet);
    if (res && res.unlocked) {
      unlockedAchievements.push(res.achievement);
    }
  };

  // 1. Закладки и коллекции
  const totalBookmarks = db.prepare('SELECT COUNT(*) AS count FROM bookmarks WHERE user_id = ?').get(userId)?.count || 0;
  if (totalBookmarks > 0) {
    tryUnlock('bookmark_first', totalBookmarks, true);
    tryUnlock('bookmark_20', totalBookmarks, true);
    tryUnlock('bookmark_50', totalBookmarks, true);
    tryUnlock('bookmark_100', totalBookmarks, true);
  }

  // 2. Статусы
  const watchingCnt = db.prepare("SELECT COUNT(*) AS count FROM bookmarks WHERE user_id = ? AND status = 'watching'").get(userId)?.count || 0;
  if (watchingCnt > 0) tryUnlock('status_watching', watchingCnt, true);
  const completedCnt = db.prepare("SELECT COUNT(*) AS count FROM bookmarks WHERE user_id = ? AND status = 'completed'").get(userId)?.count || 0;
  if (completedCnt > 0) tryUnlock('status_completed', completedCnt, true);
  const plannedCnt = db.prepare("SELECT COUNT(*) AS count FROM bookmarks WHERE user_id = ? AND status = 'planned'").get(userId)?.count || 0;
  if (plannedCnt > 0) tryUnlock('status_planned', plannedCnt, true);

  // 3. Пользовательские списки
  const totalLists = db.prepare('SELECT COUNT(*) AS count FROM custom_lists WHERE user_id = ?').get(userId)?.count || 0;
  if (totalLists > 0) {
    tryUnlock('list_first', totalLists, true);
    tryUnlock('list_pro', totalLists, true);
  }

  // 4. Рецензии и лайки
  const totalReviews = db.prepare('SELECT COUNT(*) AS count FROM reviews WHERE user_id = ?').get(userId)?.count || 0;
  if (totalReviews > 0) {
    tryUnlock('review_first', totalReviews, true);
    tryUnlock('review_3', totalReviews, true);
    tryUnlock('review_10', totalReviews, true);
  }

  const reviewLikes = db.prepare(`
    SELECT COUNT(*) AS count FROM review_likes rl
    JOIN reviews r ON rl.review_id = r.id
    WHERE r.user_id = ? AND rl.is_like = 1
  `).get(userId)?.count || 0;
  if (reviewLikes > 0) {
    tryUnlock('review_liked', reviewLikes, true);
    tryUnlock('review_popular', reviewLikes, true);
  }

  // 5. Синхронизация из клиентского хранилища
  if (clientState.watched_episodes) {
    tryUnlock('series_first_ep', clientState.watched_episodes, true);
    tryUnlock('series_binge_5', clientState.watched_episodes, true);
    tryUnlock('series_binge_25', clientState.watched_episodes, true);
  }
  if (clientState.completed_seasons) {
    tryUnlock('series_season_done', clientState.completed_seasons, true);
    tryUnlock('series_three_seasons', clientState.completed_seasons, true);
  }
  if (clientState.total_watched_hours) {
    const hours = clientState.total_watched_hours;
    tryUnlock('time_1h', hours, true);
    tryUnlock('time_5h', hours, true);
    tryUnlock('time_20h', hours, true);
    tryUnlock('time_50h', hours, true);
    tryUnlock('time_100h', hours, true);
    tryUnlock('time_250h', hours, true);
    tryUnlock('time_500h', hours, true);
  }
  if (clientState.themes_count) {
    tryUnlock('tech_chameleon', clientState.themes_count, true);
  }
  if (clientState.langs_count) {
    tryUnlock('tech_polyglot', clientState.langs_count, true);
  }
  if (clientState.used_4k_count) {
    tryUnlock('tech_4k', clientState.used_4k_count, true);
    tryUnlock('tech_4k_ultra', clientState.used_4k_count, true);
  }
  if (clientState.used_pro_audio) {
    tryUnlock('tech_audio_pro', 1);
  }
  if (clientState.used_pro_video) {
    tryUnlock('tech_video_pro', 1);
  }
  if (clientState.voiceovers_count) {
    tryUnlock('tech_voiceover_fan', clientState.voiceovers_count, true);
  }
  if (clientState.used_xray) {
    tryUnlock('tech_xray', 1);
  }

  return unlockedAchievements;
}

export function claimAchievement(userId, achievementId) {
  if (!userId || !achievementId) return null;
  const achMeta = ACHIEVEMENTS_CATALOG.find(a => a.id === achievementId);
  if (!achMeta) return null;

  const existing = db.prepare('SELECT progress, target, unlocked FROM user_achievements WHERE user_id = ? AND achievement_id = ?').get(userId, achievementId);
  const target = achMeta.target;
  const now = Date.now();

  if (existing && existing.progress >= target) {
    db.prepare('UPDATE user_achievements SET unlocked = 1, unlocked_at = COALESCE(unlocked_at, ?) WHERE user_id = ? AND achievement_id = ?').run(now, userId, achievementId);
    return {
      unlocked: true,
      achievement: {
        ...achMeta,
        progress: target,
        unlocked: true,
        unlocked_at: now
      }
    };
  }

  db.prepare(`
    INSERT INTO user_achievements (user_id, achievement_id, progress, target, unlocked, unlocked_at)
    VALUES (?, ?, ?, ?, 1, ?)
    ON CONFLICT(user_id, achievement_id) DO UPDATE SET
      progress = excluded.progress,
      unlocked = 1,
      unlocked_at = COALESCE(user_achievements.unlocked_at, excluded.unlocked_at)
  `).run(userId, achievementId, target, target, now);

  return {
    unlocked: true,
    achievement: {
      ...achMeta,
      progress: target,
      unlocked: true,
      unlocked_at: now
    }
  };
}

// ==========================================
// 9. СИНХРОНИЗАЦИЯ И РЕЗЕРВНОЕ КОПИРОВАНИЕ ДАННЫХ
// ==========================================

export function exportUserData(userId) {
  const user = db.prepare('SELECT id, username, email, avatar, created_at, settings_json FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('Пользователь не найден');

  const bookmarks = db.prepare('SELECT * FROM bookmarks WHERE user_id = ?').all(userId);
  const customLists = db.prepare('SELECT * FROM custom_lists WHERE user_id = ?').all(userId);
  const customListItems = db.prepare(`
    SELECT cli.* FROM custom_list_items cli
    JOIN custom_lists cl ON cli.list_id = cl.id
    WHERE cl.user_id = ?
  `).all(userId);
  const history = db.prepare('SELECT * FROM watch_history WHERE user_id = ?').all(userId);
  const achievements = db.prepare('SELECT * FROM user_achievements WHERE user_id = ?').all(userId);
  const reviews = db.prepare('SELECT * FROM reviews WHERE user_id = ?').all(userId);

  trackUserAction(userId, 'sync_data');

  return {
    version: '1.2',
    exported_at: Date.now(),
    system: 'STORM MULTIMEDIA',
    user,
    bookmarks,
    custom_lists: customLists.map(list => ({
      ...list,
      items: customListItems.filter(item => item.list_id === list.id)
    })),
    history,
    achievements,
    reviews
  };
}

export function importUserData(userId, data) {
  if (!data || typeof data !== 'object') throw new Error('Некорректный формат данных резервной копии');

  let importedCount = 0;
  const now = Date.now();

  // Импорт закладок
  if (Array.isArray(data.bookmarks)) {
    const stmt = db.prepare(`
      INSERT INTO bookmarks (user_id, media_id, source, title, original_title, poster_url, media_type, status, episodes_watched, total_episodes, progress_percent, last_time_seconds, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, media_id, source) DO UPDATE SET
        status = excluded.status,
        episodes_watched = excluded.episodes_watched,
        total_episodes = excluded.total_episodes,
        progress_percent = excluded.progress_percent,
        updated_at = excluded.updated_at
    `);
    data.bookmarks.forEach(b => {
      stmt.run(
        userId,
        String(b.media_id),
        b.source || 'fanfilm4k',
        b.title || 'Без названия',
        b.original_title || '',
        b.poster_url || '',
        b.media_type || 'movie',
        b.status || 'watching',
        b.episodes_watched || 0,
        b.total_episodes || 0,
        b.progress_percent || 0.0,
        b.last_time_seconds || 0,
        now
      );
      importedCount++;
    });
  }

  // Импорт кастомных списков
  if (Array.isArray(data.custom_lists)) {
    const listStmt = db.prepare(`
      INSERT INTO custom_lists (user_id, title, description, color, is_public, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const itemStmt = db.prepare(`
      INSERT INTO custom_list_items (list_id, media_id, source, title, poster_url, media_type, year, rating, added_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(list_id, media_id, source) DO NOTHING
    `);

    data.custom_lists.forEach(list => {
      const res = listStmt.run(userId, list.title, list.description || '', list.color || '#00d2ff', list.is_public ? 1 : 0, now);
      const newListId = Number(res.lastInsertRowid);
      if (Array.isArray(list.items)) {
        list.items.forEach(item => {
          itemStmt.run(newListId, String(item.media_id), item.source || 'fanfilm4k', item.title || '', item.poster_url || '', item.media_type || 'movie', item.year || '', item.rating || 0.0, now);
        });
      }
    });
  }

  trackUserAction(userId, 'sync_data');
  return { success: true, imported_count: importedCount };
}

// Автоматическая фоновая очистка дубликатов в базе данных SQLite
export function cleanupDuplicateDatabaseRecords() {
  try {
    // 1. Очистка дубликатов в таблице bookmarks
    const allBookmarks = db.prepare('SELECT id, user_id, title, original_title, updated_at, progress_percent FROM bookmarks ORDER BY updated_at DESC').all();
    const seenUserBookmarks = new Map();
    const bookmarksToDelete = [];

    for (const b of allBookmarks) {
      const key = `${b.user_id}:::${normalizeMediaKey(b.title, b.original_title)}`;
      if (seenUserBookmarks.has(key)) {
        bookmarksToDelete.push(b.id);
      } else {
        seenUserBookmarks.set(key, b.id);
      }
    }

    if (bookmarksToDelete.length > 0) {
      db.prepare(`DELETE FROM bookmarks WHERE id IN (${bookmarksToDelete.join(',')})`).run();
    }

    // 2. Очистка дубликатов в таблице watch_history
    const allHistory = db.prepare('SELECT id, user_id, title, updated_at, progress_percent FROM watch_history ORDER BY updated_at DESC').all();
    const seenUserHistory = new Map();
    const historyToDelete = [];

    for (const h of allHistory) {
      const key = `${h.user_id}:::${normalizeMediaKey(h.title)}`;
      if (seenUserHistory.has(key)) {
        historyToDelete.push(h.id);
      } else {
        seenUserHistory.set(key, h.id);
      }
    }

    if (historyToDelete.length > 0) {
      db.prepare(`DELETE FROM watch_history WHERE id IN (${historyToDelete.join(',')})`).run();
    }
  } catch (err) {
    console.warn('[STORM DB] Примечание очистки дубликатов:', err.message);
  }
}

// Запуск дедупликации при старте сервера
cleanupDuplicateDatabaseRecords();


