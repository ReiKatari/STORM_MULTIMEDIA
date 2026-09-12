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
  const totalWatchedSeconds = db.prepare('SELECT COALESCE(SUM(time_seconds), 0) as total FROM watch_history WHERE user_id = ?').get(userId).total;
  const customListsCount = db.prepare('SELECT count(*) as count FROM custom_lists WHERE user_id = ?').get(userId).count;

  return {
    bookmarksCount,
    completedCount,
    watchingCount,
    totalWatchedHours: Math.round((totalWatchedSeconds / 3600) * 10) / 10,
    customListsCount
  };
}

// Закладки и статусы
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

  query += ' ORDER BY updated_at DESC';
  return db.prepare(query).all(...params);
}

export function getBookmark(userId, mediaId, source) {
  return db.prepare('SELECT * FROM bookmarks WHERE user_id = ? AND media_id = ? AND source = ?').get(userId, mediaId, source);
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

  const now = Date.now();
  const upsert = db.prepare(`
    INSERT INTO bookmarks (
      user_id, media_id, source, title, original_title, poster_url, media_type,
      status, episodes_watched, total_episodes, progress_percent, last_time_seconds, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, media_id, source) DO UPDATE SET
      status = excluded.status,
      episodes_watched = excluded.episodes_watched,
      total_episodes = excluded.total_episodes,
      progress_percent = excluded.progress_percent,
      last_time_seconds = excluded.last_time_seconds,
      updated_at = excluded.updated_at
  `);

  upsert.run(
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

export function removeBookmark(userId, mediaId, source) {
  db.prepare('DELETE FROM bookmarks WHERE user_id = ? AND media_id = ? AND source = ?').run(userId, String(mediaId), source);
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

  // Синхронизируем прогресс с закладкой
  const existingBookmark = getBookmark(userId, String(media_id), source);
  const episodesWatched = episode;
  let overallPercent = progressPercent;

  if (total_episodes > 1) {
    overallPercent = Math.min(100.0, Math.round(((episode - 1 + (progressPercent / 100)) / total_episodes) * 1000) / 10);
  }

  const status = overallPercent >= 95 ? 'completed' : (existingBookmark?.status || 'watching');

  setBookmark(userId, {
    media_id,
    source,
    title,
    poster_url: poster_url || existingBookmark?.poster_url,
    media_type,
    status,
    episodes_watched: episodesWatched,
    total_episodes: total_episodes || existingBookmark?.total_episodes || 1,
    progress_percent: overallPercent,
    last_time_seconds: time_seconds
  });

  return {
    media_id,
    season,
    episode,
    time_seconds,
    progress_percent: overallPercent,
    status
  };
}

export function getContinueWatching(userId, limit = 12) {
  const query = `
    SELECT * FROM watch_history
    WHERE user_id = ? AND progress_percent < 95
    ORDER BY updated_at DESC
    LIMIT ?
  `;
  return db.prepare(query).all(userId, limit);
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
  const now = Date.now();
  const insert = db.prepare(`
    INSERT INTO custom_lists (user_id, title, description, color, is_public, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = insert.run(userId, title, description, color, isPublic ? 1 : 0, now);
  return {
    id: Number(result.lastInsertRowid),
    user_id: userId,
    title,
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

  const now = Date.now();
  const insert = db.prepare(`
    INSERT INTO custom_list_items (list_id, media_id, source, title, poster_url, media_type, year, rating, added_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(list_id, media_id, source) DO UPDATE SET
      added_at = excluded.added_at
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
