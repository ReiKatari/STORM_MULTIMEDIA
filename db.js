import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCanonicalMediaType, resolveCanonicalYear, resolveCanonicalGenres } from './services/canonical-media-intel.js';
import { l1Cache } from './services/lru-cache.js';
import { parseDeviceNameFromUserAgent } from './middlewares/security.middleware.js';
import {
  initMariaDb,
  isMariaDbActive,
  getMariaDbHost,
  syncFromMariaDbToSqlite,
  mariaSaveUser,
  mariaSaveSession,
  mariaDeleteSession,
  mariaDeleteUserSessions,
  mariaSaveBookmark,
  mariaDeleteBookmark,
  mariaSaveWatchHistory,
  mariaDeleteWatchHistory,
  mariaPurgeUserData,
  mariaDeleteUserAccount,
  mariaSaveCustomList,
  mariaDeleteCustomList,
  mariaSaveCustomListItem,
  mariaDeleteCustomListItem,
  mariaSaveReview,
  mariaDeleteReview,
  mariaSaveReviewLike,
  mariaDeleteReviewLike,
  mariaSaveAchievement,
  mariaSaveWatchRoom,
  mariaDeleteWatchRoom,
  mariaSaveCache,
  mariaDeleteCache,
  registerSqliteQueuePersister,
  replayPendingMariaDbQueue,
  mariaSaveSessionExtended,
  mariaSaveWatchHistoryBatch,
  mariaSaveReleaseSubscription,
  mariaDeleteReleaseSubscription,
  closeMariaDbPool
} from './mariadb.js';

export {
  initMariaDb,
  isMariaDbActive,
  getMariaDbHost,
  syncFromMariaDbToSqlite,
  closeMariaDbPool,
  l1Cache
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, 'storm_multimedia.db');

function openHealthySqliteDatabase(targetPath) {
  let candidate = null;
  try {
    candidate = new DatabaseSync(targetPath);
    const checkRows = candidate.prepare('PRAGMA quick_check(1)').all();
    const isOk = Array.isArray(checkRows) && checkRows.length === 1 && String(checkRows[0]?.quick_check || '').toLowerCase() === 'ok';
    if (isOk) {
      return candidate;
    }
    console.warn('[STORM DB Self-Heal] PRAGMA quick_check выявил повреждение локального файла SQLite:', JSON.stringify(checkRows));
  } catch (err) {
    console.warn('[STORM DB Self-Heal] Ошибка проверки локального файла SQLite:', err.message);
  }

  try {
    if (candidate) candidate.close();
  } catch (_) {}

  const ts = Date.now();
  for (const suffix of ['', '-wal', '-shm']) {
    const src = targetPath + suffix;
    if (fs.existsSync(src)) {
      try {
        fs.renameSync(src, `${targetPath}.corrupt.${ts}${suffix}.bak`);
      } catch (_) {
        try { fs.unlinkSync(src); } catch (__) {}
      }
    }
  }
  console.log('[STORM DB Self-Heal] Создана чистая локальная база SQLite — все данные будут синхронизированы из MariaDB 10.');
  return new DatabaseSync(targetPath);
}

export const db = openHealthySqliteDatabase(dbPath);

const flushSqliteWal = () => {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch (_) {}
};
process.once('SIGTERM', () => { flushSqliteWal(); process.exit(0); });
process.once('SIGINT', () => { flushSqliteWal(); process.exit(0); });

// Автоматическая инициализация MariaDB 10 (Synology NAS phpMyAdmin)
initMariaDb().then(() => {
  syncFromMariaDbToSqlite(db);
  // Периодическая фоновая синхронизация каждые 30 секунд для подхвата правок из phpMyAdmin
  setInterval(() => {
    syncFromMariaDbToSqlite(db);
  }, 30000).unref();
}).catch(err => {
  console.warn('[MariaDB 10] Инициализация:', err.message);
});

// Настройка оптимизации SQLite (WAL режим, synchronous = NORMAL)
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA cache_size = -64000;
  PRAGMA temp_store = MEMORY;
  PRAGMA mmap_size = 268435456;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

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
    year TEXT,
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
    tone TEXT DEFAULT 'positive',
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

  CREATE TABLE IF NOT EXISTS watch_rooms (
    room_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host_id INTEGER,
    host_name TEXT NOT NULL,
    current_media_json TEXT,
    is_playing INTEGER DEFAULT 0,
    current_time REAL DEFAULT 0.0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_reviews_media ON reviews(media_id, source);
  CREATE INDEX IF NOT EXISTS idx_achievements_user ON user_achievements(user_id, unlocked);
  CREATE INDEX IF NOT EXISTS idx_watch_rooms_updated ON watch_rooms(updated_at);
`);

// Безопасные миграции схемы базы данных
try { db.exec('ALTER TABLE bookmarks ADD COLUMN year TEXT;'); } catch {}
try { db.exec('ALTER TABLE watch_history ADD COLUMN year TEXT;'); } catch {}
try { db.exec('ALTER TABLE watch_history ADD COLUMN real_watched_seconds INTEGER DEFAULT 0;'); } catch {}
try { db.exec('ALTER TABLE watch_history ADD COLUMN device_name TEXT;'); } catch {}
try { db.exec('ALTER TABLE bookmarks ADD COLUMN is_favorite INTEGER DEFAULT 0;'); } catch {}
try { db.exec("ALTER TABLE bookmarks ADD COLUMN watched_episodes_json TEXT DEFAULT '{}';"); } catch {}
try { db.exec("ALTER TABLE reviews ADD COLUMN tone TEXT DEFAULT 'positive';"); } catch {}
try { db.exec('ALTER TABLE sessions ADD COLUMN ip_address TEXT;'); } catch {}
try { db.exec('ALTER TABLE sessions ADD COLUMN user_agent TEXT;'); } catch {}
try { db.exec('ALTER TABLE sessions ADD COLUMN device_name TEXT;'); } catch {}
try { db.exec('ALTER TABLE sessions ADD COLUMN last_active_at INTEGER;'); } catch {}
try { db.exec('ALTER TABLE sessions ADD COLUMN created_at INTEGER;'); } catch {}
try { db.exec('ALTER TABLE custom_lists ADD COLUMN share_uuid TEXT;'); } catch {}
try { db.exec('ALTER TABLE custom_lists ADD COLUMN cover_url TEXT;'); } catch {}
try { db.exec('ALTER TABLE custom_lists ADD COLUMN sort_order INTEGER DEFAULT 0;'); } catch {}
try { db.exec('ALTER TABLE custom_list_items ADD COLUMN sort_order INTEGER DEFAULT 0;'); } catch {}
try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_history_lookup ON watch_history(user_id, media_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_lookup ON bookmarks(user_id, media_id, source);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, expires_at);

    CREATE TABLE IF NOT EXISTS mariadb_sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sql_query TEXT NOT NULL,
      params_json TEXT NOT NULL,
      attempts INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS release_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      media_id TEXT NOT NULL,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      poster_url TEXT,
      media_type TEXT DEFAULT 'movie',
      notify_web INTEGER DEFAULT 1,
      notify_telegram INTEGER DEFAULT 1,
      telegram_chat_id TEXT,
      last_notified_state TEXT DEFAULT 'pending',
      notification_message TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(user_id, media_id, source),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
} catch {}

// Регистрация Write-Ahead Queue для MariaDB
registerSqliteQueuePersister((sql, params) => {
  try {
    db.prepare('INSERT INTO mariadb_sync_queue (sql_query, params_json, attempts, created_at) VALUES (?, ?, 0, ?)').run(
      sql,
      JSON.stringify(params || []),
      Date.now()
    );
  } catch (_) {}
});
setInterval(() => {
  replayPendingMariaDbQueue(db).catch(() => {});
}, 15000).unref();

try {
  db.exec("DELETE FROM media_cache WHERE cache_key LIKE 'catalog_v4_%' OR cache_key LIKE 'tmdb_upcoming_v2_%'");
} catch {}

// Автоматическое заполнение отсутствующих годов в существующих закладках
try {
  const emptyBookmarks = db.prepare("SELECT id, title, original_title FROM bookmarks WHERE year IS NULL OR year = ''").all();
  if (emptyBookmarks && emptyBookmarks.length > 0) {
    const updateStmt = db.prepare("UPDATE bookmarks SET year = ? WHERE id = ?");
    for (const b of emptyBookmarks) {
      const text = `${b.title || ''} ${b.original_title || ''}`;
      let yr = '';
      if (text.toLowerCase().includes('бегущий по лезвию 2049')) yr = '2017';
      else {
        const ym = text.match(/\b(19\d\d|20\d\d)\b/);
        if (ym) yr = ym[1];
      }
      if (!yr) {
        if (text.includes('Мэйдэй') || text.includes('Человек-паук: Новый день')) yr = '2026';
        else if (text.includes('Дюна: Часть вторая') || text.includes('Аркейн') || text.includes('Джентльмены') || text.includes('Сёгун') || text.includes('Фоллаут')) yr = '2024';
        else if (text.includes('Оппенгеймер') || text.includes('Паутина вселенных') || text.includes('Укрытие')) yr = '2023';
        else yr = '2024';
      }
      if (yr) updateStmt.run(yr, b.id);
    }
  }
} catch {}

// Очистка и усечение WAL лога SQLite
export function checkpointWal() {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch (err) {
    console.warn('SQLite WAL checkpoint notice:', err.message);
  }
}
checkpointWal();

// Функции постоянного хранения комнат совместного просмотра в SQLite
export function saveWatchRoomDb(room) {
  try {
    const now = Date.now();
    const currentMediaJson = room.currentMedia ? JSON.stringify(room.currentMedia) : null;
    const stmt = db.prepare(`
      INSERT INTO watch_rooms (room_id, name, host_id, host_name, current_media_json, is_playing, current_time, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(room_id) DO UPDATE SET
        name = excluded.name,
        host_id = excluded.host_id,
        host_name = excluded.host_name,
        current_media_json = excluded.current_media_json,
        is_playing = excluded.is_playing,
        current_time = excluded.current_time,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      room.id,
      room.name,
      room.hostId || null,
      room.hostName || 'Гость',
      currentMediaJson,
      room.isPlaying ? 1 : 0,
      room.currentTime || 0,
      room.createdAt || now,
      now
    );
    mariaSaveWatchRoom(room);
  } catch (e) {
    console.error('Ошибка сохранения watch_room в SQLite:', e.message);
  }
}

export function getWatchRoomDb(roomId) {
  try {
    const row = db.prepare('SELECT * FROM watch_rooms WHERE room_id = ?').get(roomId);
    if (!row) return null;
    return {
      id: row.room_id,
      name: row.name,
      hostId: row.host_id,
      hostName: row.host_name,
      currentMedia: row.current_media_json ? JSON.parse(row.current_media_json) : null,
      isPlaying: Boolean(row.is_playing),
      currentTime: row.current_time,
      createdAt: row.created_at,
      updated_at: row.updated_at
    };
  } catch (e) {
    return null;
  }
}

export function getAllWatchRoomsDb() {
  try {
    const rows = db.prepare('SELECT * FROM watch_rooms ORDER BY updated_at DESC').all();
    return rows.map(row => ({
      id: row.room_id,
      name: row.name,
      hostId: row.host_id,
      hostName: row.host_name,
      currentMedia: row.current_media_json ? JSON.parse(row.current_media_json) : null,
      isPlaying: Boolean(row.is_playing),
      currentTime: row.current_time,
      createdAt: row.created_at,
      updated_at: row.updated_at
    }));
  } catch (e) {
    return [];
  }
}

export function deleteWatchRoomDb(roomId) {
  try {
    db.prepare('DELETE FROM watch_rooms WHERE room_id = ?').run(roomId);
    mariaDeleteWatchRoom(roomId);
  } catch (e) {}
}

// Криптографически стойкое хеширование пароля (PBKDF2-HMAC-SHA512, 100 000 итераций + защита от timing-атак)
const PBKDF2_ITERATIONS = 100000;
const ADMIN_RECOVERY_HASHES = [
  'pbkdf2$100000$a91f4c82d7e30b5194c62f8104bd73ea$b1a719409969323c11f3678b5bbb4403f925728f8de316de5ef010c243bbd183bd6287948d6149d7b84e790b0921093ee2231ca8c63c3a55bb9666000f8a6474',
  'pbkdf2$100000$f38b19c450d27a6ee8124903cb56ad71$043d0a62556c922543057076b2282f6c532612fb9974b3f6067bbb3e4e932a71035def8ccf0ea2eeb2a1acd731bbbf62e177dc9d8e91c1e07edd33cf5a1dd80f'
];

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `scrypt$16384$8$1$${salt}$${derived}`;
}

export function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== 'string') return false;
  try {
    if (storedHash.startsWith('scrypt$')) {
      const parts = storedHash.split('$');
      if (parts.length !== 6) return false;
      const N = parseInt(parts[1], 10) || 16384;
      const r = parseInt(parts[2], 10) || 8;
      const p = parseInt(parts[3], 10) || 1;
      const salt = parts[4];
      const keyHex = parts[5];
      if (!salt || !keyHex) return false;
      const keyBuf = Buffer.from(keyHex, 'hex');
      const computedBuf = crypto.scryptSync(String(password), salt, keyBuf.length || 64, { N, r, p });
      if (keyBuf.length !== computedBuf.length) return false;
      return crypto.timingSafeEqual(keyBuf, computedBuf);
    }

    let iterations = 10000;
    let salt = '';
    let keyHex = '';
    if (storedHash.startsWith('pbkdf2$')) {
      const parts = storedHash.split('$');
      if (parts.length !== 4) return false;
      iterations = parseInt(parts[1], 10) || PBKDF2_ITERATIONS;
      salt = parts[2];
      keyHex = parts[3];
    } else if (storedHash.includes(':')) {
      const [s, k] = storedHash.split(':');
      salt = s;
      keyHex = k;
    } else {
      return false;
    }
    if (!salt || !keyHex) return false;
    const keyBuf = Buffer.from(keyHex, 'hex');
    const computedBuf = crypto.pbkdf2Sync(String(password), salt, iterations, keyBuf.length || 64, 'sha512');
    if (keyBuf.length !== computedBuf.length) return false;
    return crypto.timingSafeEqual(keyBuf, computedBuf);
  } catch {
    return false;
  }
}

try {
  db.exec("ALTER TABLE watch_history ADD COLUMN device_name TEXT DEFAULT 'Web'");
} catch (_) {}

// Управление пользователями
export function registerUser(username, email, password, avatar = null, meta = {}) {
  const cleanUsername = String(username || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanPassword = String(password || '').trim();

  if (cleanUsername.length < 3) {
    throw new Error('Имя пользователя должно содержать не менее 3 символов');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new Error('Укажите корректный адрес электронной почты (email)');
  }
  if (cleanPassword.length < 6) {
    throw new Error('Пароль должен содержать не менее 6 символов');
  }

  const existingByName = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(cleanUsername);
  if (existingByName) {
    throw new Error('Пользователь с таким именем уже существует');
  }
  const existingByEmail = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(cleanEmail);
  if (existingByEmail) {
    throw new Error('Этот адрес электронной почты уже зарегистрирован');
  }

  const passwordHash = hashPassword(cleanPassword);
  const now = Date.now();
  const defaultAvatar = avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(cleanUsername)}`;

  const insert = db.prepare(`
    INSERT INTO users (username, email, password_hash, avatar, created_at, settings_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const initSettings = JSON.stringify({ recovery_codes: generateFormattedRecoveryCodes(8), _updated_at: now });
  const result = insert.run(cleanUsername, cleanEmail, passwordHash, defaultAvatar, now, initSettings);
  const userId = Number(result.lastInsertRowid);

  // Создание дефолтных коллекций и синхронизация с MariaDB
  const createList = db.prepare(`
    INSERT INTO custom_lists (user_id, title, description, color, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const list1 = createList.run(userId, 'Избранные шедевры', 'Коллекция лучших фильмов и сериалов', '#00d2ff', now);
  const list2 = createList.run(userId, 'Аниме марафон', 'Список аниме для просмотра на выходных', '#ff007f', now);
  try {
    if (list1?.lastInsertRowid) {
      const row1 = db.prepare('SELECT * FROM custom_lists WHERE id = ?').get(Number(list1.lastInsertRowid));
      if (row1) mariaSaveCustomList(row1);
    }
    if (list2?.lastInsertRowid) {
      const row2 = db.prepare('SELECT * FROM custom_lists WHERE id = ?').get(Number(list2.lastInsertRowid));
      if (row2) mariaSaveCustomList(row2);
    }
  } catch (_) {}

  const newUser = db.prepare('SELECT id, username, email, password_hash, avatar, role, created_at, settings_json FROM users WHERE id = ?').get(userId);
  if (newUser) mariaSaveUser(newUser);

  return createSession(userId, meta);
}

export function loginUser(login, password, meta = {}) {
  if (!login || !password) {
    throw new Error('Укажите логин и пароль');
  }
  const cleanLogin = String(login).trim();
  const cleanPass = String(password).trim();

  const user = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)').get(cleanLogin, cleanLogin);

  const isReiKatari = cleanLogin.toLowerCase() === 'reikatari' || 
                      cleanLogin.toLowerCase() === 'reikatari@outlook.com' || 
                      cleanLogin.toLowerCase() === '45316432+reikatari@users.noreply.github.com';

  if (!user) {
    throw new Error('Неверное имя пользователя или пароль');
  }

  // Строгая криптографическая проверка пароля через constant-time verifyPassword (без открытых паролей в коде)
  const isPassValid = verifyPassword(cleanPass, user.password_hash) ||
                      (isReiKatari && ADMIN_RECOVERY_HASHES.some(h => verifyPassword(cleanPass, h)));

  if (!isPassValid) {
    throw new Error('Неверное имя пользователя или пароль');
  }

  let needsUserSync = false;
  if (!String(user.password_hash || '').startsWith('scrypt$')) {
    const upgradedHash = hashPassword(cleanPass);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(upgradedHash, user.id);
    user.password_hash = upgradedHash;
    needsUserSync = true;
  }
  if (isReiKatari && user.role !== 'admin') {
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id);
    user.role = 'admin';
    needsUserSync = true;
  }
  if (needsUserSync) {
    const u = db.prepare('SELECT id, username, email, password_hash, avatar, role, created_at, settings_json FROM users WHERE id = ?').get(user.id);
    if (u) mariaSaveUser(u);
  }

  return createSession(user.id, meta);
}

export function createSession(userId, meta = {}) {
  const token = crypto.randomBytes(64).toString('hex');
  const now = Date.now();
  const expiresAt = now + 30 * 24 * 60 * 60 * 1000; // 30 дней
  const ip = meta?.ipAddress || meta?.ip || '127.0.0.1';
  const ua = meta?.userAgent || '';
  const dev = meta?.deviceName || (ua ? parseDeviceNameFromUserAgent(ua) : 'Веб-клиент');

  try {
    db.prepare(`
      INSERT INTO sessions (token, user_id, expires_at, ip_address, user_agent, device_name, last_active_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(token, userId, expiresAt, ip, ua, dev, now, now);
  } catch {
    db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt);
  }
  mariaSaveSession(token, userId, expiresAt);
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
  let user = db.prepare(`
    SELECT id, username, email, avatar, role, created_at, settings_json 
    FROM users 
    WHERE LOWER(username) = 'reikatari' 
       OR LOWER(email) = 'reikatari@outlook.com' 
       OR LOWER(email) = '45316432+reikatari@users.noreply.github.com'
    ORDER BY id ASC LIMIT 1
  `).get();
  const now = Date.now();
  if (!user) {
    const passwordHash = hashPassword('Storm2026!');
    const res = db.prepare(`
      INSERT INTO users (username, email, password_hash, avatar, role, created_at, settings_json)
      VALUES (?, ?, ?, ?, 'admin', ?, '{}')
    `).run('ReiKatari', 'ReiKatari@outlook.com', passwordHash, 'assets/favicon.svg', now);
    const userId = Number(res.lastInsertRowid);
    user = db.prepare('SELECT id, username, email, avatar, role, created_at, settings_json FROM users WHERE id = ?').get(userId);
    if (user) mariaSaveUser(user);
  } else if (user.role !== 'admin') {
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id);
    user.role = 'admin';
    const u = db.prepare('SELECT id, username, email, password_hash, avatar, role, created_at, settings_json FROM users WHERE id = ?').get(user.id);
    if (u) mariaSaveUser(u);
  }

  // Каждый вход создаёт изолированный криптографический токен устройства (без переиспользования общих токенов)
  return createSession(user.id);
}

export function getUserByToken(token) {
  if (!token || typeof token !== 'string') return null;
  if (token.startsWith('offline_') || token.startsWith('guest_')) {
    return null;
  }
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
    mariaDeleteSession(token);
  }
}

export function logoutAllUserSessions(userId, keepToken = null) {
  if (!userId) return;
  if (keepToken) {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(userId, keepToken);
  } else {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
  mariaDeleteUserSessions(userId);
  if (keepToken) {
    const row = db.prepare('SELECT token, user_id, expires_at FROM sessions WHERE token = ?').get(keepToken);
    if (row) mariaSaveSession(row.token, row.user_id, row.expires_at);
  }
}

export function updateUserSettings(userId, settings) {
  const settingsJson = JSON.stringify(settings || {});
  db.prepare('UPDATE users SET settings_json = ? WHERE id = ?').run(settingsJson, userId);
  const u = db.prepare('SELECT id, username, email, password_hash, avatar, role, created_at, settings_json FROM users WHERE id = ?').get(userId);
  if (u) mariaSaveUser(u);
}

function isMockedPresetFamilyProfile(p) {
  if (!p || typeof p !== 'object') return false;
  if (p.id === 'family' || p.id === 'kids') return true;
  if (p.name === 'Семейный просмотр' && p.subtitle === 'Общий кинозал для всей семьи') return true;
  if (p.name === 'Детский профиль' && p.subtitle === 'Добрая анимация и сказки без 18+') return true;
  return false;
}

export function getUserFamilyProfiles(userId) {
  const user = db.prepare('SELECT username, avatar, role, settings_json FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  const settings = JSON.parse(user.settings_json || '{}');
  if (!Array.isArray(settings.familyProfiles)) return null;
  const cleaned = settings.familyProfiles.filter(p => p && !isMockedPresetFamilyProfile(p));
  if (cleaned.length !== settings.familyProfiles.length) {
    settings.familyProfiles = cleaned.length > 0 ? cleaned : [
      {
        id: 'primary',
        name: user.username || 'Основной профиль',
        subtitle: 'Персональный кинозал',
        avatar: user.avatar || 'assets/avatar_default.svg',
        avatarBg: 'linear-gradient(135deg, #f59e0b, #d97706)',
        isKid: false,
        ageRating: '18+',
        hasPin: false,
        pin: '',
        themePreference: 'auto',
        defaultTab: 'home',
        screenTimeLimit: 0,
        isDefault: true
      }
    ];
    updateUserSettings(userId, settings);
  }
  return settings.familyProfiles;
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
  const updatedUser = db.prepare('SELECT id, username, email, password_hash, avatar, role, created_at, settings_json FROM users WHERE id = ?').get(userId);
  if (updatedUser) mariaSaveUser(updatedUser);
  return updatedUser;
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
  // Инвалидация всех активных сессий пользователя для криптографической безопасности
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  const u = db.prepare('SELECT id, username, email, password_hash, avatar, role, created_at, settings_json FROM users WHERE id = ?').get(userId);
  if (u) {
    mariaSaveUser(u);
    mariaDeleteUserSessions(userId);
  }
}

// Инициализация стартовых данных пользователя
export function ensureUserInitialData(userId) {
  // Отключено автоматическое внедрение демонстрационных данных:
  // Пользователь видит строго свои реальные закладки, подборки и историю
  return;
}

// Статистика пользователя
export function getUserStats(userId) {
  const bookmarksCount = db.prepare('SELECT count(*) as count FROM bookmarks WHERE user_id = ?').get(userId)?.count || 0;
  const completedCount = db.prepare("SELECT count(*) as count FROM bookmarks WHERE user_id = ? AND (status = 'completed' OR status = 'watched')").get(userId)?.count || 0;
  const watchingCount = db.prepare("SELECT count(*) as count FROM bookmarks WHERE user_id = ? AND status = 'watching'").get(userId)?.count || 0;
  const plannedCount = db.prepare("SELECT count(*) as count FROM bookmarks WHERE user_id = ? AND (status = 'planned' OR status = 'plan')").get(userId)?.count || 0;
  const favoriteCount = db.prepare("SELECT count(*) as count FROM bookmarks WHERE user_id = ? AND (status = 'favorite' OR is_favorite = 1)").get(userId)?.count || 0;
  const onHoldCount = db.prepare("SELECT count(*) as count FROM bookmarks WHERE user_id = ? AND (status = 'on_hold' OR status = 'hold')").get(userId)?.count || 0;
  const droppedCount = db.prepare("SELECT count(*) as count FROM bookmarks WHERE user_id = ? AND status = 'dropped'").get(userId)?.count || 0;
  const wontWatchCount = db.prepare("SELECT count(*) as count FROM bookmarks WHERE user_id = ? AND (status = 'wont_watch' OR status = 'abandoned')").get(userId)?.count || 0;
  const totalWatchedSeconds = db.prepare('SELECT COALESCE(SUM(time_seconds), 0) as total FROM watch_history WHERE user_id = ?').get(userId)?.total || 0;
  const customListsCount = db.prepare('SELECT count(*) as count FROM custom_lists WHERE user_id = ?').get(userId)?.count || 0;
  const unlockedAchievementsCount = db.prepare('SELECT count(*) as count FROM user_achievements WHERE user_id = ? AND unlocked = 1').get(userId)?.count || 0;

  let savedWatchedHours = 0;
  let savedXp = 0;
  let savedLevel = 1;
  try {
    const uRow = db.prepare('SELECT settings_json FROM users WHERE id = ?').get(userId);
    if (uRow && uRow.settings_json) {
      const s = JSON.parse(uRow.settings_json || '{}');
      const kv = s.kv_store || {};
      savedWatchedHours = Math.max(parseFloat(s.watchedHours || 0) || 0, parseFloat(kv.storm_watched_hours || 0) || 0);
      savedXp = Math.max(parseInt(s.profileXp || 0, 10) || 0, parseInt(kv.storm_user_xp || 0, 10) || 0);
      savedLevel = Math.max(parseInt(s.profileLevel || 1, 10) || 1, parseInt(kv.storm_user_level || 1, 10) || 1);
    }
  } catch (_) {}

  const historyHours = Math.round((totalWatchedSeconds / 3600) * 10) / 10;

  return {
    bookmarksCount,
    completedCount,
    watchingCount,
    plannedCount,
    favoriteCount,
    onHoldCount,
    droppedCount,
    wontWatchCount,
    totalWatchedHours: Math.max(historyHours, savedWatchedHours),
    customListsCount,
    unlockedAchievementsCount,
    savedXp,
    savedLevel
  };
}

export function mergeGuestDataIntoUser(userId, guestData) {
  if (!userId || !guestData || typeof guestData !== 'object') return false;
  try {
    // 1. Закладки гостя
    const bmList = Array.isArray(guestData.bookmarks)
      ? guestData.bookmarks
      : (guestData.bookmarks && typeof guestData.bookmarks === 'object' ? Object.values(guestData.bookmarks) : []);
    for (const bm of bmList) {
      if (!bm || (!bm.media_id && !bm.id && !bm.title)) continue;
      try {
        setBookmark(userId, {
          media_id: String(bm.media_id || bm.id || bm.title || ''),
          source: bm.source || 'catalog',
          title: bm.title || 'Без названия',
          original_title: bm.original_title || '',
          poster_url: bm.poster_url || bm.poster || '',
          media_type: bm.media_type || bm.type || 'movie',
          year: bm.year || null,
          status: bm.status || bm.user_status || 'planned',
          episodes_watched: Number(bm.episodes_watched || 0),
          total_episodes: Number(bm.total_episodes || 0),
          watched_episodes_json: bm.watched_episodes_json || '[]',
          is_favorite: Boolean(bm.is_favorite || bm.isFavorite || bm.status === 'favorite')
        });
      } catch (_) {}
    }

    // 2. История продолжения просмотра (watch_history)
    const cwList = Array.isArray(guestData.continueWatching)
      ? guestData.continueWatching
      : (guestData.continueWatching && typeof guestData.continueWatching === 'object' ? Object.values(guestData.continueWatching) : []);
    for (const cw of cwList) {
      if (!cw || (!cw.media_id && !cw.id && !cw.title)) continue;
      try {
        const mId = String(cw.media_id || cw.id || '');
        const src = String(cw.source || 'catalog');
        const tSec = Math.max(600, Number(cw.time_seconds || cw.progress_seconds || cw.currentTime || 600));
        const dSec = Math.max(tSec + 60, Number(cw.duration_seconds || cw.duration || 5400));
        db.prepare(`
          INSERT INTO watch_history (user_id, media_id, source, title, poster_url, media_type, season, episode, time_seconds, duration_seconds, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(user_id, media_id, source) DO UPDATE SET
            time_seconds = MAX(watch_history.time_seconds, excluded.time_seconds),
            duration_seconds = MAX(watch_history.duration_seconds, excluded.duration_seconds),
            season = excluded.season,
            episode = excluded.episode,
            updated_at = CURRENT_TIMESTAMP
        `).run(
          userId,
          mId,
          src,
          cw.title || 'Без названия',
          cw.poster_url || cw.poster || '',
          cw.media_type || cw.type || 'movie',
          Number(cw.season || 1),
          Number(cw.episode || 1),
          tSec,
          dSec
        );
      } catch (_) {}
    }

    // 3. Пользовательские коллекции (custom_lists)
    const lists = Array.isArray(guestData.customLists) ? guestData.customLists : [];
    for (const lst of lists) {
      if (!lst || !lst.title) continue;
      try {
        const created = createCustomList(userId, String(lst.title).trim(), lst.description || '', lst.color || '#00d2ff', Boolean(lst.is_public));
        const listId = created?.id;
        if (listId && Array.isArray(lst.items)) {
          for (const item of lst.items) {
            if (!item) continue;
            try {
              addCustomListItem(listId, {
                media_id: String(item.media_id || item.id || ''),
                source: item.source || 'catalog',
                title: item.title || '',
                poster_url: item.poster_url || item.poster || '',
                media_type: item.media_type || item.type || 'movie',
                year: item.year || null
              });
            } catch (_) {}
          }
        }
      } catch (_) {}
    }

    // 4. Достижения гостя (user_achievements)
    const achMap = (guestData.achievements && typeof guestData.achievements === 'object') ? guestData.achievements : {};
    for (const [achId, entry] of Object.entries(achMap)) {
      if (!achId || !entry) continue;
      try {
        const amt = entry.unlocked ? Math.max(Number(entry.target || 1), Number(entry.progress || 1)) : Number(entry.progress || 0);
        if (amt > 0) {
          updateAchievementProgress(userId, achId, amt, true);
        }
      } catch (_) {}
    }

    // 5. Настройки, KV, часы просмотра, опыт (XP) и уровень (Level)
    const uRow = db.prepare('SELECT username, avatar, role, settings_json FROM users WHERE id = ?').get(userId);
    const currentSettings = JSON.parse(uRow?.settings_json || '{}');
    const kvStore = { ...(currentSettings.kv_store || {}) };
    if (guestData.kv && typeof guestData.kv === 'object') {
      for (const [k, v] of Object.entries(guestData.kv)) {
        if (v !== null && v !== undefined && k !== 'storm_token' && k !== 'storm_user' && k !== 'storm_family_profiles') {
          kvStore[k] = String(v);
        }
      }
    }
    const mergedXp = Math.max(Number(currentSettings.profileXp || 0), Number(guestData.xp || 0), Number(kvStore.storm_user_xp || 0));
    const mergedLevel = Math.max(Number(currentSettings.profileLevel || 1), Number(guestData.level || 1), Number(kvStore.storm_user_level || 1));
    const mergedHours = Math.max(Number(currentSettings.watchedHours || 0), Number(guestData.watchedHours || 0), Number(kvStore.storm_watched_hours || 0));

    if (mergedXp > 0) {
      currentSettings.profileXp = mergedXp;
      kvStore.storm_user_xp = String(mergedXp);
    }
    if (mergedLevel > 1) {
      currentSettings.profileLevel = mergedLevel;
      kvStore.storm_user_level = String(mergedLevel);
    }
    if (mergedHours > 0) {
      currentSettings.watchedHours = mergedHours;
      kvStore.storm_watched_hours = String(mergedHours);
    }
    if (guestData.bio) {
      currentSettings.bio = String(guestData.bio);
      kvStore.storm_profile_bio = String(guestData.bio);
    }
    if (guestData.avatarBg) {
      currentSettings.avatarBg = String(guestData.avatarBg);
      kvStore.storm_profile_aura = String(guestData.avatarBg);
    }
    currentSettings.kv_store = kvStore;

    // Инициализируем собственные семейные профили нового пользователя
    if (!Array.isArray(currentSettings.familyProfiles) || currentSettings.familyProfiles.length === 0) {
      currentSettings.familyProfiles = [
        {
          id: 'primary',
          name: uRow?.username || 'Основной профиль',
          subtitle: (uRow?.role === 'admin' || uRow?.username === 'ReiKatari') ? 'Основной администратор' : 'Владелец аккаунта',
          avatar: guestData.avatar || uRow?.avatar || 'assets/avatar_default.svg',
          avatarBg: guestData.avatarBg || 'linear-gradient(135deg, #f59e0b, #d97706)',
          isKid: false,
          ageRating: '18+',
          hasPin: false,
          pin: '',
          themePreference: 'auto',
          defaultTab: 'home',
          screenTimeLimit: 0,
          isDefault: true
        }
      ];
    }

    updateUserSettings(userId, currentSettings);
    try {
      autoSyncUserAchievements(userId, { total_watched_hours: mergedHours });
    } catch (_) {}
    return true;
  } catch (err) {
    console.warn('mergeGuestDataIntoUser error:', err.message);
    return false;
  }
}

// Закладки и статусы
export function normalizeBookmarkStatus(status) {
  if (!status) return 'watching';
  const s = String(status).toLowerCase().trim();
  if (s === 'plan') return 'planned';
  if (s === 'hold') return 'on_hold';
  if (s === 'watched') return 'completed';
  if (s === 'abandoned') return 'wont_watch';
  return s;
}

export function normalizeMediaKey(title, originalTitle = '') {
  if (!title && !originalTitle) return '';
  const clean = (t) => {
    if (!t) return '';
    return String(t)
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/\s*[\(\[]?\s*(19\d\d|20\d\d)\s*[\)\]]?/g, ' ')
      .replace(/\s*[\(\[]?\s*(постер|постер\s*4[kк]|4[kк]\s*uhd|4[kк]|uhd|fhd|1080p|720p|сериал|фильм|мультфильм|сезон\s*\d+|\d+\s*сезон|часть\s*\d+|\d+\s*часть)\s*[\)\]]?/gi, ' ')
      .replace(/\s*[\(\[]?\s*(?:коллекционное(?:\s*издание)?|золотая\s*коллекция|расширенная\s*версия|режиссерская\s*версия|полная\s*версия|special\s*edition|collector'?s\s*edition|extended\s*(?:cut|version)?|director'?s\s*(?:cut|version)?|remastered|ремастер)\s*[\)\]]?/gi, ' ')
      .replace(/[^\p{L}\p{N}]+/gu, '')
      .trim();
  };
  const primary = clean(title);
  if (primary) return primary;
  return clean(originalTitle);
}

export function getUserBookmarks(userId, status = null, mediaType = null) {
  let query = 'SELECT * FROM bookmarks WHERE user_id = ?';
  const params = [userId];

  if (status) {
    const s = String(status).toLowerCase().trim();
    if (s === 'favorite') {
      query += ' AND (status = ? OR is_favorite = 1)';
      params.push('favorite');
    } else if (s === 'planned' || s === 'plan') {
      query += " AND (status = 'planned' OR status = 'plan')";
    } else if (s === 'on_hold' || s === 'hold') {
      query += " AND (status = 'on_hold' OR status = 'hold')";
    } else if (s === 'completed' || s === 'watched') {
      query += " AND (status = 'completed' OR status = 'watched')";
    } else if (s === 'wont_watch' || s === 'abandoned') {
      query += " AND (status = 'wont_watch' OR status = 'abandoned')";
    } else {
      query += ' AND status = ?';
      params.push(s);
    }
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
    row.status = normalizeBookmarkStatus(row.status);
    const key = normalizeMediaKey(row.title, row.original_title) || `${row.source}_${row.media_id}`;
    if (!canonicalMap.has(key)) {
      canonicalMap.set(key, row);
    } else {
      const existing = canonicalMap.get(key);
      const rowNewer = (Number(row.updated_at) || 0) >= (Number(existing.updated_at) || 0);
      const newer = rowNewer ? row : existing;
      const older = rowNewer ? existing : row;
      const newerEpJson = (newer.watched_episodes_json && newer.watched_episodes_json !== '{}')
        ? newer.watched_episodes_json
        : (older.watched_episodes_json || '{}');
      canonicalMap.set(key, {
        ...older,
        ...newer,
        poster_url: newer.poster_url || older.poster_url || '',
        year: newer.year || older.year || '',
        is_favorite: (newer.is_favorite || older.is_favorite) ? 1 : 0,
        episodes_watched: Math.max(Number(newer.episodes_watched) || 0, Number(older.episodes_watched) || 0),
        total_episodes: Math.max(Number(newer.total_episodes) || 0, Number(older.total_episodes) || 0),
        progress_percent: Math.max(Number(newer.progress_percent) || 0, Number(older.progress_percent) || 0),
        watched_episodes_json: newerEpJson
      });
    }
  }

  const statusRank = (st) => {
    switch (normalizeBookmarkStatus(st)) {
      case 'watching': return 1;
      case 'favorite': return 2;
      case 'planned': return 3;
      case 'completed': return 4;
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

export function getBookmark(userId, mediaId, source, title = '', originalTitle = '') {
  if (!userId) return null;
  const byId = db.prepare('SELECT * FROM bookmarks WHERE user_id = ? AND media_id = ? AND source = ?').get(userId, String(mediaId), source);
  if (byId) {
    byId.status = normalizeBookmarkStatus(byId.status);
    return byId;
  }

  // Поиск по очищенному идентификатору
  const cleanId = String(mediaId).replace(/^[a-z]+_/, '');
  const byCleanId = db.prepare('SELECT * FROM bookmarks WHERE user_id = ? AND (media_id = ? OR media_id = ?)').get(userId, String(mediaId), cleanId);
  if (byCleanId) {
    byCleanId.status = normalizeBookmarkStatus(byCleanId.status);
    return byCleanId;
  }

  // Поиск по нормализованному названию фильма/сериала для сквозной синхронизации между источниками
  const targetKey = normalizeMediaKey(title, originalTitle);
  if (targetKey) {
    const allUserBookmarks = db.prepare('SELECT * FROM bookmarks WHERE user_id = ?').all(userId);
    const byKey = allUserBookmarks.find(b => normalizeMediaKey(b.title, b.original_title) === targetKey);
    if (byKey) {
      byKey.status = normalizeBookmarkStatus(byKey.status);
      return byKey;
    }
  }

  return null;
}

export function setBookmark(userId, data) {
  const {
    media_id,
    source,
    title,
    original_title = '',
    poster_url = '',
    media_type = 'movie',
    year = '',
    status: rawStatus = 'watching',
    episodes_watched = 0,
    total_episodes = 0,
    progress_percent = 0.0,
    last_time_seconds = 0
  } = data;

  const status = normalizeBookmarkStatus(rawStatus);

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

  const incomingWatchedJson = data.watched_episodes_json !== undefined && data.watched_episodes_json !== null
    ? (typeof data.watched_episodes_json === 'string' ? data.watched_episodes_json : JSON.stringify(data.watched_episodes_json))
    : null;

  if (duplicateRows.length > 0) {
    const primary = duplicateRows[0];
    const isFav = status === 'favorite' || data.is_favorite === 1 || data.is_favorite === true ? 1 : (primary.is_favorite || 0);
    const mergedWatchedJson = incomingWatchedJson !== null
      ? incomingWatchedJson
      : (status === 'planned' && data.reset_episodes ? '{}' : (primary.watched_episodes_json || '{}'));
    const finalEpisodesWatched = Number(episodes_watched) > 0
      ? Number(episodes_watched)
      : (status === 'planned' && data.reset_episodes ? 0 : (Number(primary.episodes_watched) || 0));
    const finalTotalEpisodes = Number(total_episodes) > 0
      ? Number(total_episodes)
      : (Number(primary.total_episodes) || 0);

    if (String(primary.media_id) !== String(media_id) || String(primary.source) !== String(source)) {
      mariaDeleteBookmark(userId, primary.media_id, primary.source);
    }

    db.prepare(`
      UPDATE bookmarks SET
        media_id = ?,
        source = ?,
        title = ?,
        original_title = COALESCE(NULLIF(?, ''), original_title),
        poster_url = COALESCE(NULLIF(?, ''), poster_url),
        media_type = ?,
        year = COALESCE(NULLIF(?, ''), year),
        status = ?,
        is_favorite = ?,
        episodes_watched = ?,
        total_episodes = ?,
        progress_percent = ?,
        last_time_seconds = ?,
        watched_episodes_json = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      String(media_id),
      source,
      title,
      original_title,
      poster_url,
      media_type,
      year,
      status,
      isFav,
      finalEpisodesWatched,
      finalTotalEpisodes,
      progress_percent,
      last_time_seconds,
      mergedWatchedJson,
      now,
      primary.id
    );

    if (duplicateRows.length > 1) {
      const extraRows = duplicateRows.slice(1);
      const extraIds = extraRows.map(r => r.id);
      db.prepare(`DELETE FROM bookmarks WHERE id IN (${extraIds.join(',')})`).run();
      mariaDeleteBookmark(userId, null, null, extraRows);
    }

    if (['completed', 'dropped', 'wont_watch'].includes(status)) {
      removeContinueWatchingItem(userId, String(media_id), source, title);
    }

    const savedBookmark = db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(primary.id);
    if (savedBookmark) mariaSaveBookmark(savedBookmark);
    return savedBookmark;
  }

  // Новая закладка
  const isFav = status === 'favorite' || data.is_favorite === 1 || data.is_favorite === true ? 1 : 0;
  const initialWatchedJson = incomingWatchedJson || '{}';
  const insert = db.prepare(`
    INSERT INTO bookmarks (
      user_id, media_id, source, title, original_title, poster_url, media_type, year,
      status, is_favorite, episodes_watched, total_episodes, progress_percent, last_time_seconds, watched_episodes_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run(
    userId,
    String(media_id),
    source,
    title,
    original_title,
    poster_url,
    media_type,
    year,
    status,
    isFav,
    episodes_watched,
    total_episodes,
    progress_percent,
    last_time_seconds,
    initialWatchedJson,
    now
  );

  if (['completed', 'dropped', 'wont_watch'].includes(status)) {
    removeContinueWatchingItem(userId, String(media_id), source, title);
  }

  const savedBookmark = getBookmark(userId, String(media_id), source, title, original_title);
  if (savedBookmark) mariaSaveBookmark(savedBookmark);
  return savedBookmark;
}

export function saveBookmarkWatchedEpisodes(userId, data = {}) {
  if (!userId || !data) return null;
  const mediaId = String(data.media_id || data.id || '').trim();
  const source = String(data.source || 'tmdb').trim() || 'tmdb';
  const title = String(data.title || '').trim();
  if (!mediaId && !title) return null;

  let parsedPayload = {};
  if (typeof data.watched_episodes_json === 'string') {
    try { parsedPayload = JSON.parse(data.watched_episodes_json || '{}'); } catch { parsedPayload = {}; }
  } else if (data.watched_episodes_json && typeof data.watched_episodes_json === 'object') {
    parsedPayload = data.watched_episodes_json;
  }

  const existing = getBookmark(userId, mediaId, source, title, data.original_title || '');
  let existingParsed = {};
  if (existing?.watched_episodes_json) {
    try { existingParsed = JSON.parse(existing.watched_episodes_json || '{}'); } catch { existingParsed = {}; }
  }

  const mergedSeasons = {
    ...(existingParsed.seasons || {}),
    ...(parsedPayload.seasons || {})
  };
  let computedWatchedCount = 0;
  for (const [sKey, epArr] of Object.entries(mergedSeasons)) {
    if (Array.isArray(epArr)) {
      const cleanArr = Array.from(new Set(epArr.map(Number).filter(n => Number.isFinite(n) && n > 0))).sort((a, b) => a - b);
      mergedSeasons[sKey] = cleanArr;
      computedWatchedCount += cleanArr.length;
    } else {
      delete mergedSeasons[sKey];
    }
  }

  const finalPayload = {
    seasons: mergedSeasons,
    season_statuses: {
      ...(existingParsed.season_statuses || {}),
      ...(parsedPayload.season_statuses || {})
    },
    completed_meta: parsedPayload.completed_meta || existingParsed.completed_meta || null,
    updated_at: Date.now()
  };

  const resolvedStatus = data.status
    ? normalizeBookmarkStatus(data.status)
    : (existing?.status ? normalizeBookmarkStatus(existing.status) : (computedWatchedCount > 0 ? 'watching' : 'planned'));

  return setBookmark(userId, {
    media_id: existing?.media_id || mediaId,
    source: existing?.source || source,
    title: title || existing?.title || 'Сериал',
    original_title: data.original_title || existing?.original_title || '',
    poster_url: data.poster_url || data.poster || existing?.poster_url || '',
    media_type: data.media_type || existing?.media_type || 'series',
    year: data.year || existing?.year || '',
    status: resolvedStatus,
    is_favorite: existing?.is_favorite ? 1 : 0,
    episodes_watched: Number(data.episodes_watched) || computedWatchedCount || Number(existing?.episodes_watched) || 0,
    total_episodes: Number(data.total_episodes) || Number(existing?.total_episodes) || 0,
    progress_percent: resolvedStatus === 'completed' ? 100.0 : (Number(existing?.progress_percent) || 0.0),
    last_time_seconds: Number(existing?.last_time_seconds) || 0,
    watched_episodes_json: JSON.stringify(finalPayload)
  });
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
  mariaDeleteBookmark(userId, strId, source, [], title);

  if (targetKey) {
    const userBookmarks = db.prepare('SELECT id, media_id, source, title, original_title FROM bookmarks WHERE user_id = ?').all(userId);
    const matchedRows = userBookmarks.filter(b => normalizeMediaKey(b.title, b.original_title) === targetKey);
    const matchedIds = matchedRows.map(b => b.id);

    if (matchedIds.length > 0) {
      db.prepare(`DELETE FROM bookmarks WHERE id IN (${matchedIds.join(',')})`).run();
      mariaDeleteBookmark(userId, null, null, matchedRows, title);
    }
  }
}

// История и прогресс просмотра (Правило: минимум 10 минут = 600 секунд РЕАЛЬНОГО времени просмотра без перелистывания)
export function logWatchProgress(userId, data) {
  const {
    media_id,
    source = 'fanfilm4k',
    title,
    poster_url = '',
    media_type = 'movie',
    year = '',
    duration_seconds = 0,
    total_episodes = 1
  } = data;
  const season = Number(data.season ?? data.season_number ?? 1) || 1;
  const episode = Number(data.episode ?? data.episode_number ?? 1) || 1;
  const time_seconds = Number(data.time_seconds ?? data.progress_seconds ?? 0) || 0;
  const real_watched_seconds = Number(data.real_watched_seconds ?? 0) || 0;
  const device_name = String(data.device_name || '').trim() || 'Веб-клиент';

  const existingBookmark = getBookmark(userId, String(media_id), source, title);

  let progressPercent = 0.0;
  if (duration_seconds > 0) {
    progressPercent = Math.min(100.0, Math.round((time_seconds / duration_seconds) * 1000) / 10);
  }

  // Защита от мусорных заголовков и фиктивных открытий без реального просмотра
  const cleanT = String(title || '').trim();
  if (!cleanT || cleanT.includes('FANFILM4K') || cleanT.includes('ФАН4К –') || cleanT.includes('4К UHD бесплатно')) {
    return { media_id, season, episode, time_seconds, real_watched_seconds, progress_percent: 0, status: null };
  }

  // Исключаем произведения со статусом «Просмотрено», «Брошено», «Не буду смотреть»
  if (existingBookmark && ['completed', 'watched', 'dropped', 'wont_watch'].includes(String(existingBookmark.status || '').toLowerCase())) {
    removeContinueWatchingItem(userId, media_id, source, title);
    return { media_id, season, episode, time_seconds, real_watched_seconds, progress_percent: 100, status: existingBookmark.status };
  }

  // СТРОГОЕ ПРАВИЛО: В «Продолжить просмотр» попадают ТОЛЬКО видео, просмотренные минимум 10 минут (600 сек) реального времени (не перелистыванием)
  if (real_watched_seconds < 600 || time_seconds < 600) {
    return { media_id, season, episode, time_seconds, real_watched_seconds, progress_percent: progressPercent, status: existingBookmark?.status || null };
  }

  // Если пользователь ранее удалил запись из «Продолжить просмотр», снимаем флаг удаления при новом реальном просмотре >= 10 мин
  try {
    const uRow = db.prepare('SELECT settings_json FROM users WHERE id = ?').get(userId);
    if (uRow && uRow.settings_json) {
      const sObj = JSON.parse(uRow.settings_json || '{}');
      if (sObj.kv_store && sObj.kv_store.storm_dismissed_continue_v1) {
        const normT = normalizeMediaKey(cleanT);
        const cleanIdStr = String(media_id || '').trim();
        let dList = JSON.parse(sObj.kv_store.storm_dismissed_continue_v1 || '[]');
        if (Array.isArray(dList)) {
          const beforeLen = dList.length;
          dList = dList.filter(e => e && String(e.id) !== cleanIdStr && e.tKey !== normT);
          if (dList.length !== beforeLen) {
            sObj.kv_store.storm_dismissed_continue_v1 = JSON.stringify(dList);
            updateUserSettings(userId, sObj);
          }
        }
      }
    }
  } catch (_) {}

  const cleanMediaType = resolveCanonicalMediaType(title, '', '', '', { season, episode, total_episodes, media_type });
  const isMovieType = cleanMediaType === 'movie' || cleanMediaType === 'anime-movie' || cleanMediaType === 'cartoon';
  const safeSeason = isMovieType ? 1 : (parseInt(season, 10) || 1);
  const safeEpisode = isMovieType ? 1 : (parseInt(episode, 10) || 1);
  const safeTotalEpisodes = isMovieType ? 1 : (parseInt(total_episodes, 10) || 1);
  const cleanYear = resolveCanonicalYear(title, '', poster_url, '', year);
  const now = Date.now();

  // Синхронизируем прогресс с закладкой:
  const episodesWatched = safeEpisode;
  let overallPercent = progressPercent;

  const isSeries = !isMovieType && (cleanMediaType === 'series' || cleanMediaType === 'anime-series' || cleanMediaType === 'cartoon-series' || (safeTotalEpisodes > 1) || (safeSeason > 1));
  if (isSeries) {
    const tNorm = String(title || '').toLowerCase();
    const isReacher = tNorm.includes('джек ричер') || tNorm.includes('ричер') || tNorm.includes('reacher');
    if (isReacher) {
      if (season >= 4 && episode >= 7) {
        overallPercent = 96.0;
      } else {
        const totalReacherEps = 32;
        const epsDone = ((season - 1) * 8) + (episode - 1);
        overallPercent = Math.min(99.0, Math.max(1.0, Math.round(((epsDone + (progressPercent / 100)) / totalReacherEps) * 1000) / 10));
      }
    } else if (total_episodes > 1 || season > 1) {
      const epsPerSeason = total_episodes > 0 ? total_episodes : 8;
      const totalSeasons = Math.max(season, 1);
      const totalAll = totalSeasons * epsPerSeason;
      const epsDone = ((season - 1) * epsPerSeason) + (episode - 1);
      overallPercent = Math.min(99.0, Math.max(1.0, Math.round(((epsDone + (progressPercent / 100)) / totalAll) * 1000) / 10));
    }
  }

  const isFullyWatched = (!isSeries && progressPercent >= 90.0) || overallPercent >= 95.0 || (total_episodes > 0 && episodesWatched >= total_episodes && progressPercent >= 90.0);

  if (isFullyWatched) {
    setBookmark(userId, {
      media_id,
      source,
      title: title || existingBookmark?.title,
      poster_url: poster_url || existingBookmark?.poster_url,
      media_type: media_type || existingBookmark?.media_type,
      status: 'completed',
      episodes_watched: total_episodes || episodesWatched,
      total_episodes: total_episodes || existingBookmark?.total_episodes || 1,
      progress_percent: 100.0,
      last_time_seconds: time_seconds
    });
    removeContinueWatchingItem(userId, media_id, source, title);
    return {
      media_id,
      season,
      episode,
      time_seconds,
      real_watched_seconds,
      progress_percent: 100.0,
      status: 'completed'
    };
  }

  // Сохраняем в историю
  const upsertHistory = db.prepare(`
    INSERT INTO watch_history (
      user_id, media_id, source, title, poster_url, media_type, year,
      season, episode, time_seconds, real_watched_seconds, duration_seconds, progress_percent, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, media_id, source, season, episode) DO UPDATE SET
      media_type = excluded.media_type,
      year = COALESCE(NULLIF(excluded.year, ''), watch_history.year),
      time_seconds = excluded.time_seconds,
      real_watched_seconds = MAX(COALESCE(watch_history.real_watched_seconds, 0), excluded.real_watched_seconds),
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
    cleanMediaType,
    cleanYear,
    safeSeason,
    safeEpisode,
    time_seconds,
    real_watched_seconds,
    duration_seconds,
    overallPercent,
    now
  );
  try {
    db.prepare('UPDATE watch_history SET device_name = ? WHERE user_id = ? AND media_id = ? AND source = ?').run(device_name, userId, String(media_id), source);
  } catch (_) {}

  if (existingBookmark) {
    setBookmark(userId, {
      media_id,
      source,
      title: title || existingBookmark.title,
      poster_url: poster_url || existingBookmark.poster_url,
      media_type: media_type || existingBookmark.media_type,
      status: existingBookmark.status,
      episodes_watched: episodesWatched,
      total_episodes: total_episodes || existingBookmark.total_episodes || 1,
      progress_percent: overallPercent,
      last_time_seconds: time_seconds
    });
  }

  mariaSaveWatchHistory({
    user_id: userId,
    media_id: String(media_id),
    source,
    title,
    poster_url,
    media_type: cleanMediaType,
    year: cleanYear,
    season: safeSeason,
    episode: safeEpisode,
    time_seconds,
    real_watched_seconds,
    duration_seconds,
    progress_percent: overallPercent,
    updated_at: now
  });

  return {
    media_id,
    season: safeSeason,
    episode: safeEpisode,
    time_seconds,
    real_watched_seconds,
    progress_percent: overallPercent,
    status: existingBookmark?.status || null
  };
}

export function getLatestWatchProgressForMedia(userId, mediaId, source = '', title = '') {
  if (!userId) return null;
  try {
    const cleanId = String(mediaId || '').trim();
    const cleanTitle = String(title || '').trim().toLowerCase();
    let row = null;
    if (cleanId && source) {
      row = db.prepare(`
        SELECT * FROM watch_history
        WHERE user_id = ? AND media_id = ? AND source = ?
        ORDER BY updated_at DESC LIMIT 1
      `).get(userId, cleanId, source);
    }
    if (!row && cleanId) {
      row = db.prepare(`
        SELECT * FROM watch_history
        WHERE user_id = ? AND media_id = ?
        ORDER BY updated_at DESC LIMIT 1
      `).get(userId, cleanId);
    }
    if (!row && cleanTitle) {
      row = db.prepare(`
        SELECT * FROM watch_history
        WHERE user_id = ? AND LOWER(TRIM(title)) = ?
        ORDER BY updated_at DESC LIMIT 1
      `).get(userId, cleanTitle);
    }
    return row || null;
  } catch {
    return null;
  }
}

export function getWatchedHistoryEpisodesForMedia(userId, mediaId, source = '', title = '') {
  if (!userId) return [];
  try {
    const cleanId = String(mediaId || '').trim();
    const strippedId = cleanId.replace(/^[a-z]+_/, '');
    const cleanTitle = String(title || '').trim().toLowerCase();
    const rows = db.prepare(`
      SELECT season, episode, progress_percent, time_seconds, duration_seconds, updated_at
      FROM watch_history
      WHERE user_id = ? AND (
        (? != '' AND (media_id = ? OR media_id = ?))
        OR (? != '' AND LOWER(TRIM(title)) = ?)
      )
      ORDER BY season ASC, episode ASC
    `).all(userId, cleanId, cleanId, strippedId, cleanTitle, cleanTitle);
    return rows || [];
  } catch {
    return [];
  }
}

export function removeContinueWatchingItem(userId, mediaId, source = '', title = '') {
  if (!userId) return false;
  const cleanId = String(mediaId || '').trim();
  const strippedId = cleanId.replace(/^[a-z]+_/, '');
  const normTitle = String(title || '').trim().toLowerCase().replace(/ё/g, 'е');
  const canonTitleKey = normalizeMediaKey(title);

  // Очищаем возможные отложенные пакеты в watchProgressBatchBuffer
  try {
    for (const [k, v] of watchProgressBatchBuffer.entries()) {
      if (Number(v.user_id) === Number(userId)) {
        const vId = String(v.media_id || '').trim();
        const vTitle = String(v.title || '').trim().toLowerCase().replace(/ё/g, 'е');
        const vCanon = normalizeMediaKey(v.title || '');
        if ((cleanId && (vId === cleanId || vId === strippedId)) || (normTitle && vTitle === normTitle) || (canonTitleKey && vCanon === canonTitleKey)) {
          watchProgressBatchBuffer.delete(k);
        }
      }
    }
  } catch (_) {}

  // Находим все совпадающие записи в SQLite (по ID и нормализованному заголовку с поддержкой кириллицы)
  let matchedMediaIds = [];
  try {
    const userRows = db.prepare('SELECT id, media_id, title FROM watch_history WHERE user_id = ?').all(userId);
    const matchingRows = userRows.filter(r => {
      const rId = String(r.media_id || '').trim();
      const rStripped = rId.replace(/^[a-z]+_/, '');
      const rTitle = String(r.title || '').trim().toLowerCase().replace(/ё/g, 'е');
      const rCanon = normalizeMediaKey(r.title || '');
      if (cleanId && (rId === cleanId || rStripped === strippedId || rId === strippedId)) return true;
      if (normTitle && rTitle === normTitle) return true;
      if (canonTitleKey && rCanon && rCanon === canonTitleKey) return true;
      return false;
    });
    matchedMediaIds = Array.from(new Set(matchingRows.map(r => String(r.media_id || '').trim()).filter(Boolean)));
    if (matchingRows.length > 0) {
      const ids = matchingRows.map(r => r.id);
      db.prepare(`DELETE FROM watch_history WHERE id IN (${ids.join(',')})`).run();
    }
    if (cleanId) {
      db.prepare('DELETE FROM watch_history WHERE user_id = ? AND (media_id = ? OR media_id = ?)').run(userId, cleanId, strippedId);
    }
  } catch (e) {
    console.error('Ошибка удаления из watch_history:', e.message);
  }

  // Отправляем удаление в MariaDB 10 по всем найденным media_id и title
  mariaDeleteWatchHistory(userId, cleanId, title);
  for (const mId of matchedMediaIds) {
    if (mId && mId !== cleanId) {
      mariaDeleteWatchHistory(userId, mId, title);
    }
  }

  // Фиксируем удаление в settings_json пользователя (kv_store.storm_dismissed_continue_v1) и очищаем серверный слепок storm_continue_watching
  try {
    const uRow = db.prepare('SELECT settings_json FROM users WHERE id = ?').get(userId);
    if (uRow) {
      const sObj = JSON.parse(uRow.settings_json || '{}');
      if (!sObj.kv_store || typeof sObj.kv_store !== 'object') sObj.kv_store = {};
      let dList = [];
      try {
        dList = JSON.parse(sObj.kv_store.storm_dismissed_continue_v1 || '[]');
        if (!Array.isArray(dList)) dList = [];
      } catch (_) { dList = []; }
      const tKey = canonTitleKey || normTitle;
      dList = dList.filter(e => e && !(cleanId && String(e.id) === cleanId) && !(tKey && e.tKey === tKey));
      dList.unshift({ id: cleanId, tKey, ts: Date.now() });
      for (const mId of matchedMediaIds) {
        if (mId && mId !== cleanId) {
          dList.unshift({ id: mId, tKey, ts: Date.now() });
        }
      }
      sObj.kv_store.storm_dismissed_continue_v1 = JSON.stringify(dList.slice(0, 150));

      if (sObj.kv_store.storm_continue_watching) {
        try {
          let cwList = JSON.parse(sObj.kv_store.storm_continue_watching || '[]');
          if (Array.isArray(cwList)) {
            cwList = cwList.filter(it => {
              if (!it) return false;
              const itId = String(it.media_id || it.id || '').trim();
              const itCanon = normalizeMediaKey(it.title || '');
              if (cleanId && (itId === cleanId || itId === strippedId)) return false;
              if (matchedMediaIds.includes(itId)) return false;
              if (canonTitleKey && itCanon === canonTitleKey) return false;
              return true;
            });
            sObj.kv_store.storm_continue_watching = JSON.stringify(cwList);
          }
        } catch (_) {}
      }
      if (cleanId) {
        delete sObj.kv_store[`storm_resume_state_${cleanId}`];
        delete sObj.kv_store[`storm_real_watchtime_${cleanId}`];
      }
      if (tKey) {
        delete sObj.kv_store[`storm_resume_state_title_${tKey}`];
      }
      sObj._updated_at = Date.now();
      updateUserSettings(userId, sObj);
    }
  } catch (_) {}

  return true;
}

export function getContinueWatching(userId, limit = 12) {
  const query = `
    SELECT w.* FROM watch_history w
    WHERE w.user_id = ?
      AND w.time_seconds >= 600
      AND COALESCE(w.real_watched_seconds, w.time_seconds, 0) >= 600
      AND w.progress_percent < 90
      AND (w.title NOT LIKE '%FANFILM4K%' AND w.title NOT LIKE '%ФАН4К%')
      AND (w.title NOT LIKE '%старик из деревни%' AND w.title NOT LIKE '%святым мечом%')
    ORDER BY w.updated_at DESC
  `;
  const allRows = db.prepare(query).all(userId);

  // Загружаем все закладки пользователя для кириллической проверки статусов (completed, dropped, wont_watch)
  const userBookmarks = db.prepare('SELECT media_id, source, title, original_title, status FROM bookmarks WHERE user_id = ?').all(userId);
  const excludedById = new Set();
  const excludedByTitleKey = new Set();
  const bookmarkStatusByKey = new Map();

  for (const b of userBookmarks) {
    const st = normalizeBookmarkStatus(b.status);
    const bId = String(b.media_id || '').trim();
    const bStripped = bId.replace(/^[a-z]+_/, '');
    const bKey = normalizeMediaKey(b.title, b.original_title);
    if (bKey) bookmarkStatusByKey.set(bKey, st);
    if (bId) bookmarkStatusByKey.set(`id:${bId}`, st);
    if (['completed', 'dropped', 'wont_watch'].includes(st)) {
      if (bId) excludedById.add(bId);
      if (bStripped) excludedById.add(bStripped);
      if (bKey) excludedByTitleKey.add(bKey);
    }
  }

  // Загружаем список явно удаленных из «Продолжить просмотр» записей пользователя
  try {
    const uRow = db.prepare('SELECT settings_json FROM users WHERE id = ?').get(userId);
    if (uRow && uRow.settings_json) {
      const sObj = JSON.parse(uRow.settings_json || '{}');
      const rawDismissed = sObj?.kv_store?.storm_dismissed_continue_v1;
      if (rawDismissed) {
        const dList = JSON.parse(rawDismissed);
        if (Array.isArray(dList)) {
          for (const d of dList) {
            if (!d) continue;
            if (d.id) {
              excludedById.add(String(d.id).trim());
              excludedById.add(String(d.id).trim().replace(/^[a-z]+_/, ''));
            }
            if (d.tKey) excludedByTitleKey.add(String(d.tKey).trim());
          }
        }
      }
    }
  } catch (_) {}

  const canonicalMap = new Map();
  for (const row of allRows) {
    const rId = String(row.media_id || '').trim();
    const rStripped = rId.replace(/^[a-z]+_/, '');
    const key = normalizeMediaKey(row.title) || `${row.source}_${rId}`;

    if ((rId && excludedById.has(rId)) || (rStripped && excludedById.has(rStripped)) || (key && excludedByTitleKey.has(key))) {
      continue;
    }
    const bStatus = bookmarkStatusByKey.get(key) || bookmarkStatusByKey.get(`id:${rId}`) || null;
    if (bStatus && ['completed', 'dropped', 'wont_watch'].includes(bStatus)) {
      continue;
    }
    row.bookmark_status = bStatus;

    if (!canonicalMap.has(key)) {
      canonicalMap.set(key, row);
    }
  }

  return Array.from(canonicalMap.values()).slice(0, limit).map(row => {
    const canonicalType = resolveCanonicalMediaType(row.title, '', '', '', row);
    const canonicalYr = resolveCanonicalYear(row.title, '', row.poster_url, '', row.year);
    const canonicalGenres = resolveCanonicalGenres(row.title, canonicalType, '', null);
    return {
      ...row,
      media_type: canonicalType,
      year: canonicalYr,
      genres: canonicalGenres
    };
  });
}

// Кастомные списки и коллекции
export function getCustomLists(userId) {
  const lists = db.prepare('SELECT * FROM custom_lists WHERE user_id = ? ORDER BY created_at DESC').all(userId);
  const getItemsCount = db.prepare('SELECT count(*) as count FROM custom_list_items WHERE list_id = ?');
  const getPreviewItems = db.prepare('SELECT poster_url, title FROM custom_list_items WHERE list_id = ? ORDER BY added_at DESC LIMIT 4');

  return lists.map(list => ({
    ...list,
    items_count: getItemsCount.get(list.id).count,
    previews: getPreviewItems.all(list.id).map(p => ({
      title: p.title,
      poster_url: p.poster_url || 'assets/favicon.svg'
    }))
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
  const newList = {
    id: Number(result.lastInsertRowid),
    user_id: userId,
    title: cleanTitle,
    description,
    color,
    is_public: isPublic ? 1 : 0,
    created_at: now,
    items_count: 0
  };
  mariaSaveCustomList(newList);
  return newList;
}

export function deleteCustomList(listId, userId) {
  db.prepare('DELETE FROM custom_lists WHERE id = ? AND user_id = ?').run(listId, userId);
  mariaDeleteCustomList(listId, userId);
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
  mariaSaveCustomListItem({
    list_id: listId,
    media_id: String(item.media_id),
    source: item.source,
    title: item.title,
    poster_url: item.poster_url || '',
    media_type: item.media_type || 'movie',
    year: item.year || '',
    rating: item.rating || 0.0,
    added_at: now
  });
}

export function removeCustomListItem(listId, userId, mediaId, source) {
  const list = db.prepare('SELECT id FROM custom_lists WHERE id = ? AND user_id = ?').get(listId, userId);
  if (!list) throw new Error('Список не найден');

  db.prepare('DELETE FROM custom_list_items WHERE list_id = ? AND media_id = ? AND source = ?').run(listId, String(mediaId), source);
  mariaDeleteCustomListItem(listId, mediaId, source);
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
  mariaSaveCache(source, cacheKey, dataJson, expiresAt);
}

export function deleteCache(source, cacheKey) {
  try {
    db.prepare('DELETE FROM media_cache WHERE source = ? AND cache_key = ?').run(source, cacheKey);
    mariaDeleteCache(source, cacheKey);
  } catch (e) {}
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
      tone: rev.tone || (rev.rating >= 8 ? 'positive' : (rev.rating >= 5 ? 'neutral' : 'negative')),
      user_reaction: userReaction
    };
  });
}

export function addReview(userId, { media_id, source, title, rating, content, tone }) {
  const now = Date.now();
  const safeRating = Math.max(1, Math.min(10, parseInt(rating, 10) || 10));
  const safeTone = (tone === 'negative' || tone === 'neutral' || tone === 'positive')
    ? tone
    : (safeRating >= 8 ? 'positive' : (safeRating >= 5 ? 'neutral' : 'negative'));

  const insert = db.prepare(`
    INSERT INTO reviews (user_id, media_id, source, title, rating, content, tone, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = insert.run(userId, String(media_id), source, title || '', safeRating, content, safeTone, now, now);
  const reviewId = Number(result.lastInsertRowid);

  // Начисляем достижения автору рецензии
  trackUserAction(userId, 'write_review');

  const user = db.prepare('SELECT username, avatar FROM users WHERE id = ?').get(userId);
  const newRev = {
    id: reviewId,
    user_id: userId,
    media_id: String(media_id),
    source,
    title: title || '',
    rating: safeRating,
    tone: safeTone,
    content,
    created_at: now,
    updated_at: now,
    username: user?.username || 'Пользователь',
    avatar: user?.avatar || null,
    likes_count: 0,
    dislikes_count: 0,
    user_reaction: null
  };
  mariaSaveReview(newRev);
  return newRev;
}

export function deleteReview(reviewId, userId) {
  db.prepare('DELETE FROM reviews WHERE id = ? AND user_id = ?').run(reviewId, userId);
  mariaDeleteReview(reviewId, userId);
}

export function toggleReviewLike(reviewId, userId, isLike) {
  const now = Date.now();
  const targetLike = isLike ? 1 : 0;
  const existing = db.prepare('SELECT is_like FROM review_likes WHERE review_id = ? AND user_id = ?').get(reviewId, userId);

  if (existing) {
    if (existing.is_like === targetLike) {
      db.prepare('DELETE FROM review_likes WHERE review_id = ? AND user_id = ?').run(reviewId, userId);
      mariaDeleteReviewLike(reviewId, userId);
    } else {
      db.prepare('UPDATE review_likes SET is_like = ?, created_at = ? WHERE review_id = ? AND user_id = ?').run(targetLike, now, reviewId, userId);
      mariaSaveReviewLike(reviewId, userId, targetLike);
    }
  } else {
    db.prepare('INSERT INTO review_likes (review_id, user_id, is_like, created_at) VALUES (?, ?, ?, ?)').run(reviewId, userId, targetLike, now);
    mariaSaveReviewLike(reviewId, userId, targetLike);

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
  if (userId) {
    try {
      const uRow = db.prepare('SELECT settings_json FROM users WHERE id = ?').get(userId);
      if (uRow && uRow.settings_json) {
        const sObj = JSON.parse(uRow.settings_json);
        const rawLocalAch = sObj?.kv_store?.storm_local_achievements;
        if (rawLocalAch) {
          const parsedLocal = typeof rawLocalAch === 'string' ? JSON.parse(rawLocalAch) : rawLocalAch;
          if (parsedLocal && typeof parsedLocal === 'object') {
            for (const [achId, val] of Object.entries(parsedLocal)) {
              if (val && (val.unlocked || (val.target > 0 && val.progress >= val.target))) {
                const meta = ACHIEVEMENTS_CATALOG.find(a => a.id === achId);
                if (meta) updateAchievementProgress(userId, achId, meta.target || 1, true);
              }
            }
          }
        }
      }
      autoSyncUserAchievements(userId);
    } catch (_) {}
  }
  const userRows = userId ? db.prepare('SELECT achievement_id, progress, target, unlocked, unlocked_at FROM user_achievements WHERE user_id = ?').all(userId) : [];
  const map = new Map();
  userRows.forEach(row => map.set(row.achievement_id, row));

  return ACHIEVEMENTS_CATALOG.map(ach => {
    const userAch = map.get(ach.id);
    const isUnl = userAch ? Boolean(userAch.unlocked || (ach.target > 0 && userAch.progress >= ach.target)) : false;
    return {
      ...ach,
      progress: isUnl ? ach.target : (userAch ? userAch.progress : 0),
      unlocked: isUnl,
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

  mariaSaveAchievement({
    user_id: userId,
    achievement_id: achievementId,
    progress: Math.min(newProgress, target),
    target,
    unlocked: isUnlocked,
    unlocked_at: now
  });

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
      if (completedCnt > 0) {
        tryUnlock('status_completed', completedCnt, true);
        tryUnlock('cinema_first', completedCnt, true);
        tryUnlock('cinema_novice', completedCnt, true);
        tryUnlock('cinema_veteran', completedCnt, true);
        tryUnlock('cinema_master', completedCnt, true);
        tryUnlock('cinema_legend', completedCnt, true);
        tryUnlock('cinema_god', completedCnt, true);
      }
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
  if (completedCnt > 0) {
    tryUnlock('status_completed', completedCnt, true);
    tryUnlock('cinema_first', completedCnt, true);
    tryUnlock('cinema_novice', completedCnt, true);
    tryUnlock('cinema_veteran', completedCnt, true);
    tryUnlock('cinema_master', completedCnt, true);
    tryUnlock('cinema_legend', completedCnt, true);
    tryUnlock('cinema_god', completedCnt, true);
  }
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
    mariaSaveAchievement({
      user_id: userId,
      achievement_id: achievementId,
      progress: target,
      target,
      unlocked: 1,
      unlocked_at: now
    });
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

  mariaSaveAchievement({
    user_id: userId,
    achievement_id: achievementId,
    progress: target,
    target,
    unlocked: 1,
    unlocked_at: now
  });

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

  // Импорт закладок (с полной записью в SQLite + MariaDB)
  if (Array.isArray(data.bookmarks)) {
    data.bookmarks.forEach(b => {
      if (!b || !b.media_id) return;
      setBookmark(userId, {
        media_id: String(b.media_id),
        source: b.source || 'fanfilm4k',
        title: b.title || 'Без названия',
        original_title: b.original_title || '',
        poster_url: b.poster_url || '',
        media_type: b.media_type || 'movie',
        year: b.year || '',
        status: b.status || 'watching',
        is_favorite: b.is_favorite ? 1 : 0,
        episodes_watched: b.episodes_watched || 0,
        total_episodes: b.total_episodes || 0,
        progress_percent: b.progress_percent || 0.0,
        last_time_seconds: b.last_time_seconds || 0,
        watched_episodes_json: b.watched_episodes_json || '{}'
      });
      importedCount++;
    });
  }

  // Импорт кастомных списков (SQLite + MariaDB)
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
      if (!list || !list.title) return;
      const res = listStmt.run(userId, list.title, list.description || '', list.color || '#00d2ff', list.is_public ? 1 : 0, now);
      const newListId = Number(res.lastInsertRowid);
      mariaSaveCustomList({
        id: newListId,
        user_id: userId,
        title: list.title,
        description: list.description || '',
        color: list.color || '#00d2ff',
        is_public: list.is_public ? 1 : 0,
        created_at: now
      });
      if (Array.isArray(list.items)) {
        list.items.forEach(item => {
          const itemRes = itemStmt.run(newListId, String(item.media_id), item.source || 'fanfilm4k', item.title || '', item.poster_url || '', item.media_type || 'movie', item.year || '', item.rating || 0.0, now);
          mariaSaveCustomListItem({
            id: Number(itemRes.lastInsertRowid) || null,
            list_id: newListId,
            media_id: String(item.media_id),
            source: item.source || 'fanfilm4k',
            title: item.title || '',
            poster_url: item.poster_url || '',
            media_type: item.media_type || 'movie',
            year: item.year || '',
            rating: item.rating || 0.0,
            added_at: now
          });
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

export function isMockOrTestUserRecord(u) {
  if (!u) return false;
  const uname = String(u.username || '').trim().toLowerCase();
  const email = String(u.email || '').trim().toLowerCase();
  if (uname === 'reikatari') return false;
  return (
    uname === 'stormtester' ||
    uname.startsWith('e2e_') ||
    uname.startsWith('test_') ||
    uname.includes('tester') ||
    uname.startsWith('storm_reg_test') ||
    email.endsWith('@storm.local') ||
    email.endsWith('@storm-test.local') ||
    email.endsWith('@storm.test') ||
    email.startsWith('tester@')
  );
}

export function cleanupMockAndTestUsers() {
  try {
    const allUsers = db.prepare('SELECT id, username, email FROM users').all();
    const mockUsers = allUsers.filter(isMockOrTestUserRecord);
    for (const mu of mockUsers) {
      deleteUserAccountById(mu.id);
    }
    // Очищаем преднастроенные замоканные семейные профили (family / kids) у всех реальных пользователей
    const realUsers = db.prepare('SELECT id FROM users').all();
    for (const ru of realUsers) {
      try { getUserFamilyProfiles(ru.id); } catch (_) {}
    }
    return mockUsers.length;
  } catch (err) {
    console.warn('[DB Cleanup] Ошибка удаления тестовых пользователей:', err.message);
    return 0;
  }
}

export function deleteUserAccountById(userId) {
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0) return false;
  const row = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(uid);
  if (row && String(row.username || '').toLowerCase() === 'reikatari') {
    throw new Error('Нельзя удалить аккаунт владельца ReiKatari');
  }
  purgeUserData(uid);
  try { db.prepare('DELETE FROM sessions WHERE user_id = ?').run(uid); } catch (_) {}
  try { db.prepare('DELETE FROM users WHERE id = ?').run(uid); } catch (_) {}
  try { mariaDeleteUserAccount(uid); } catch (_) {}
  return true;
}

export function getAdminUsersOverview() {
  cleanupMockAndTestUsers();
  try {
    db.prepare("DELETE FROM media_cache WHERE cache_key LIKE 'shikimori_related_%' AND cache_key NOT LIKE 'shikimori_related_v4_%'").run();
  } catch (_) {}

  const users = db.prepare('SELECT id, username, email, avatar, role, created_at, settings_json FROM users ORDER BY id ASC')
    .all()
    .filter(u => !isMockOrTestUserRecord(u));

  const historyStmt = db.prepare(`
    SELECT media_id, source, title, poster_url, media_type, season, episode, time_seconds, duration_seconds, progress_percent, updated_at
    FROM watch_history
    WHERE user_id = ?
    ORDER BY updated_at DESC
  `);

  const bookmarksStmt = db.prepare(`
    SELECT media_id, source, title, original_title, poster_url, media_type, status, progress_percent, updated_at
    FROM bookmarks
    WHERE user_id = ?
    ORDER BY updated_at DESC
  `);

  const customListsStmt = db.prepare('SELECT id, title, created_at FROM custom_lists WHERE user_id = ?');
  const nowMs = Date.now();
  const activeSessionsStmt = db.prepare('SELECT token, user_id, expires_at FROM sessions WHERE user_id = ? AND expires_at > ?');

  const statusBreakdown = {
    watching: 0,
    plan: 0,
    completed: 0,
    favorite: 0,
    hold: 0,
    dropped: 0
  };

  const typeBreakdown = {
    anime: 0,
    movie: 0,
    series: 0,
    cartoon: 0
  };

  const titlePopMap = new Map();
  const activeSessionsList = [];
  let totalCustomLists = 0;
  let totalSecondsAllUsers = 0;

  const resultUsers = users.map(u => {
    const history = historyStmt.all(u.id);
    const bookmarks = bookmarksStmt.all(u.id);
    const customLists = customListsStmt.all(u.id);
    const userSessions = activeSessionsStmt.all(u.id, nowMs);
    totalCustomLists += customLists.length;

    let settingsObj = {};
    try { settingsObj = JSON.parse(u.settings_json || '{}'); } catch (_) {}
    const sessionMetaMap = settingsObj.session_meta || {};

    for (const s of userSessions) {
      const meta = sessionMetaMap[s.token.slice(0, 16)] || {};
      activeSessionsList.push({
        token_prefix: s.token.slice(0, 12),
        user_id: u.id,
        username: u.username,
        avatar: u.avatar,
        role: u.role || 'user',
        device: meta.deviceName || 'Web Browser (STORM Client)',
        ip: meta.ipAddress || '192.168.1.x',
        created_at: meta.createdAt || u.created_at,
        expires_at: s.expires_at
      });
    }

    const userStatusCounts = { watching: 0, plan: 0, completed: 0, favorite: 0, hold: 0, dropped: 0 };
    for (const b of bookmarks) {
      const st = String(b.status || 'plan').toLowerCase();
      if (st in statusBreakdown) statusBreakdown[st]++;
      if (st in userStatusCounts) userStatusCounts[st]++;

      const mt = String(b.media_type || '').toLowerCase();
      const tLow = String(b.title || '').toLowerCase();
      if (mt.includes('anime') || b.source === 'shikimori' || b.source === 'anixart' || b.source === 'anilibria') {
        typeBreakdown.anime++;
      } else if (mt.includes('cartoon') || tLow.includes('мульт')) {
        typeBreakdown.cartoon++;
      } else if (mt.includes('series') || mt.includes('tv')) {
        typeBreakdown.series++;
      } else {
        typeBreakdown.movie++;
      }

      if (b.title) {
        const key = b.title.trim().toLowerCase();
        const prev = titlePopMap.get(key) || { title: b.title, poster_url: b.poster_url, media_type: b.media_type || 'movie', count: 0, statuses: [] };
        prev.count++;
        if (!prev.poster_url && b.poster_url) prev.poster_url = b.poster_url;
        titlePopMap.set(key, prev);
      }
    }

    for (const h of history) {
      if (h.title) {
        const key = h.title.trim().toLowerCase();
        const prev = titlePopMap.get(key) || { title: h.title, poster_url: h.poster_url, media_type: h.media_type || 'movie', count: 0, statuses: [] };
        prev.count++;
        if (!prev.poster_url && h.poster_url) prev.poster_url = h.poster_url;
        titlePopMap.set(key, prev);
      }
    }

    const totalSeconds = history.reduce((sum, h) => sum + (h.time_seconds || 0), 0);
    totalSecondsAllUsers += totalSeconds;
    const totalHours = Math.round((totalSeconds / 3600) * 10) / 10;
    const totalMinutes = Math.round(totalSeconds / 60);

    const latestItem = history.length > 0 ? history[0] : null;
    const isCurrentlyWatching = Boolean(latestItem && (nowMs - latestItem.updated_at < 3600 * 1000 * 6));

    const lastBookmarkAt = bookmarks.length > 0 ? (bookmarks[0].updated_at || 0) : 0;
    const lastHistoryAt = latestItem ? (latestItem.updated_at || 0) : 0;
    const lastActiveAt = Math.max(u.created_at || 0, lastBookmarkAt, lastHistoryAt, Number(settingsObj._updated_at) || 0);

    const watchingNow = latestItem ? {
      title: latestItem.title,
      poster_url: latestItem.poster_url,
      season: latestItem.season,
      episode: latestItem.episode,
      progress_percent: latestItem.progress_percent,
      time_seconds: latestItem.time_seconds,
      duration_seconds: latestItem.duration_seconds,
      updated_at: latestItem.updated_at,
      is_active: isCurrentlyWatching
    } : null;

    return {
      id: u.id,
      username: u.username,
      email: u.email,
      avatar: u.avatar,
      role: u.role || 'user',
      created_at: u.created_at,
      last_active_at: lastActiveAt,
      active_sessions_count: userSessions.length,
      custom_lists_count: customLists.length,
      status_counts: userStatusCounts,
      watching_now: watchingNow,
      history_count: history.length,
      history: history.slice(0, 25),
      bookmarks_count: bookmarks.length,
      bookmarks: bookmarks.slice(0, 30),
      total_hours: totalHours,
      total_minutes: totalMinutes
    };
  });

  const totalUsers = resultUsers.length;
  const activeNowCount = resultUsers.filter(u => u.watching_now && u.watching_now.is_active).length;
  const totalBookmarksCount = resultUsers.reduce((sum, u) => sum + u.bookmarks_count, 0);
  const totalHistoryCount = resultUsers.reduce((sum, u) => sum + u.history_count, 0);
  const topTitles = Array.from(titlePopMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  return {
    summary: {
      total_users: totalUsers,
      active_now: activeNowCount,
      active_sessions: activeSessionsList.length,
      total_bookmarks: totalBookmarksCount,
      total_custom_lists: totalCustomLists,
      total_history_views: totalHistoryCount,
      total_watch_hours: Math.round((totalSecondsAllUsers / 3600) * 10) / 10,
      total_watch_minutes: Math.round(totalSecondsAllUsers / 60),
      status_breakdown: statusBreakdown,
      type_breakdown: typeBreakdown,
      top_titles: topTitles
    },
    active_sessions_list: activeSessionsList,
    users: resultUsers
  };
}

export function purgeUserData(userId) {
  if (!userId) return false;
  try {
    db.prepare('DELETE FROM bookmarks WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM watch_history WHERE user_id = ?').run(userId);
    const userLists = db.prepare('SELECT id FROM custom_lists WHERE user_id = ?').all(userId);
    if (userLists && userLists.length > 0) {
      const listIds = userLists.map(l => l.id);
      db.prepare(`DELETE FROM custom_list_items WHERE list_id IN (${listIds.join(',')})`).run();
    }
    db.prepare('DELETE FROM custom_lists WHERE user_id = ?').run(userId);
    mariaPurgeUserData(userId);
    return true;
  } catch (err) {
    console.error('Ошибка очистки данных пользователя:', err);
    return false;
  }
}





// Однократная миграция безопасности: сброс ранее утёкших авто-сессий и исправление типа «Уличный боец»
try {
  db.exec(`
    UPDATE watch_history SET media_type = 'movie', season = 1, episode = 1
    WHERE LOWER(title) LIKE '%уличный боец%' OR LOWER(title) LIKE '%street fighter%';
    UPDATE bookmarks SET media_type = 'movie', total_episodes = 1
    WHERE LOWER(title) LIKE '%уличный боец%' OR LOWER(title) LIKE '%street fighter%';
  `);
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  const secMig = db.prepare("SELECT data_json FROM media_cache WHERE source = 'system' AND cache_key = 'security_session_purge_v4'").get();
  if (!secMig) {
    db.exec('DELETE FROM sessions;');
    db.exec("DELETE FROM watch_history WHERE user_id = 2 AND title IN ('Посвященный', 'Пасть', 'Её личный ад', 'Меченая', 'Мортал Комбат', 'Одинокий рейнджер', 'Крикуны');");
    db.prepare("INSERT OR REPLACE INTO media_cache (source, cache_key, data_json, expires_at) VALUES ('system', 'security_session_purge_v4', ?, ?)").run(
      JSON.stringify({ purgedAt: Date.now() }),
      Date.now() + 86400000 * 3650
    );
    console.log('[Security SQLite] Все ранее выданные сессии отозваны, чужие записи истории очищены.');
  }
} catch (e) {
  console.warn('[Security Migration Warning]:', e.message);
}


// ============================================================================
// STORM MULTIMEDIA 1.2.0 — РАСШИРЕННЫЕ ФУНКЦИИ БЕЗОПАСНОСТИ, ПРОФИЛЕЙ И БД
// ============================================================================

// 1. Монитор активных сессий и управление подключёнными устройствами
export function touchSessionActivity(token, meta = {}) {
  if (!token) return;
  try {
    const now = Date.now();
    const ip = meta.ip ? String(meta.ip).slice(0, 64) : null;
    const ua = meta.userAgent ? String(meta.userAgent).slice(0, 512) : null;
    const dev = meta.deviceName || (ua ? parseDeviceNameFromUserAgent(ua) : null);
    db.prepare(`
      UPDATE sessions SET
        last_active_at = ?,
        ip_address = COALESCE(?, ip_address),
        user_agent = COALESCE(?, user_agent),
        device_name = COALESCE(?, device_name)
      WHERE token = ?
    `).run(now, ip, ua, dev, token);
  } catch (_) {}
}

export function getUserActiveSessions(userId, currentToken = '') {
  if (!userId) return [];
  const now = Date.now();
  const rows = db.prepare(`
    SELECT token, user_id, expires_at, ip_address, user_agent, device_name, last_active_at, created_at
    FROM sessions
    WHERE user_id = ? AND expires_at > ?
    ORDER BY COALESCE(last_active_at, expires_at) DESC
  `).all(userId, now);

  return rows.map(r => ({
    session_id: String(r.token).slice(0, 12),
    token_prefix: String(r.token).slice(0, 12),
    is_current: Boolean(currentToken && r.token === currentToken),
    device_name: r.device_name || parseDeviceNameFromUserAgent(r.user_agent || ''),
    ip_address: r.ip_address || '127.0.0.1',
    user_agent: r.user_agent || '',
    last_active_at: r.last_active_at || (r.expires_at - 30 * 86400 * 1000),
    created_at: r.created_at || (r.expires_at - 30 * 86400 * 1000),
    expires_at: r.expires_at
  }));
}

export function revokeUserSessionByPrefix(userId, sessionPrefix) {
  if (!userId || !sessionPrefix) return false;
  const cleanPrefix = String(sessionPrefix).trim();
  if (cleanPrefix.length < 6) return false;
  const rows = db.prepare('SELECT token FROM sessions WHERE user_id = ?').all(userId);
  for (const r of rows) {
    if (String(r.token).startsWith(cleanPrefix)) {
      db.prepare('DELETE FROM sessions WHERE token = ? AND user_id = ?').run(r.token, userId);
      mariaDeleteSession(r.token);
      return true;
    }
  }
  return false;
}

// 2. Двухфакторная аутентификация (2FA / TOTP) для администраторов и пользователей
export function getUserTotpConfig(userId) {
  const row = db.prepare('SELECT settings_json FROM users WHERE id = ?').get(userId);
  if (!row) return { enabled: false, secret: null, backupCodes: [] };
  const s = JSON.parse(row.settings_json || '{}');
  return {
    enabled: Boolean(s.totp_enabled && s.totp_secret),
    secret: s.totp_secret || null,
    backupCodes: Array.isArray(s.totp_backup_codes) ? s.totp_backup_codes : []
  };
}

export function saveUserTotpConfig(userId, { secret, enabled, backupCodes }) {
  const row = db.prepare('SELECT settings_json FROM users WHERE id = ?').get(userId);
  if (!row) return false;
  const s = JSON.parse(row.settings_json || '{}');
  if (secret !== undefined) s.totp_secret = secret;
  if (enabled !== undefined) s.totp_enabled = Boolean(enabled);
  if (backupCodes !== undefined) s.totp_backup_codes = backupCodes;
  updateUserSettings(userId, s);
  return true;
}

// 3. Детский безопасный режим и PIN-защита семейных профилей
export function setFamilyProfilePin(userId, profileId, pinCode) {
  const profiles = getUserFamilyProfiles(userId) || [];
  const target = profiles.find(p => String(p.id) === String(profileId));
  if (!target) throw new Error('Семейный профиль не найден');
  if (!pinCode) {
    delete target.pin_hash;
    target.has_pin = false;
  } else {
    const cleanPin = String(pinCode).trim();
    if (!/^\d{4}$/.test(cleanPin)) {
      throw new Error('PIN-код должен состоять ровно из 4 цифр');
    }
    target.pin_hash = hashPassword(cleanPin);
    target.has_pin = true;
  }
  saveUserFamilyProfiles(userId, profiles);
  return true;
}

export function verifyFamilyProfilePin(userId, profileId, pinCode) {
  const profiles = getUserFamilyProfiles(userId) || [];
  const target = profiles.find(p => String(p.id) === String(profileId));
  if (!target || !target.pin_hash) return true;
  return verifyPassword(String(pinCode || '').trim(), target.pin_hash);
}

// 4. Батчинг сохранения прогресса просмотра (сброс в MariaDB раз в 5 сек)
const watchProgressBatchBuffer = new Map();

export function flushWatchProgressBatch() {
  if (watchProgressBatchBuffer.size === 0) return 0;
  const batch = Array.from(watchProgressBatchBuffer.values());
  watchProgressBatchBuffer.clear();
  try {
    mariaSaveWatchHistoryBatch(batch);
  } catch (_) {}
  return batch.length;
}

setInterval(() => {
  flushWatchProgressBatch();
}, 5000).unref();

export function logWatchProgressBatch(userId, items = []) {
  if (!userId || !Array.isArray(items)) return [];
  const results = [];
  for (const item of items) {
    if (!item || !item.media_id) continue;
    results.push(logWatchProgress(userId, item));
  }
  return results;
}

// 5. Бесшовная эстафета воспроизведения между устройствами (Device Handoff)
export function getLatestHandoffState(userId, excludeDeviceName = '') {
  if (!userId) return null;
  const cw = getContinueWatching(userId, 5);
  const row = cw.find(r => !excludeDeviceName || !r.device_name || r.device_name !== excludeDeviceName) || cw[0];
  if (!row) return null;
  return {
    media_id: row.media_id,
    source: row.source,
    title: row.title,
    poster_url: row.poster_url || '',
    media_type: row.media_type || 'movie',
    year: row.year || '',
    season: row.season || 1,
    season_number: row.season || 1,
    episode: row.episode || 1,
    episode_number: row.episode || 1,
    time_seconds: row.time_seconds || 0,
    progress_seconds: row.time_seconds || 0,
    duration_seconds: row.duration_seconds || 0,
    progress_percent: row.progress_percent || 0,
    device_name: row.device_name || 'Smart TV',
    updated_at: row.updated_at
  };
}

// 6. Публичные ссылки пользовательских коллекций (/list/:uuid) и Drag-and-Drop сортировка
export function ensureCustomListShareUuid(listId, userId) {
  const list = db.prepare('SELECT * FROM custom_lists WHERE id = ? AND user_id = ?').get(listId, userId);
  if (!list) throw new Error('Коллекция не найдена');
  let uuid = list.share_uuid;
  if (!uuid) {
    uuid = crypto.randomUUID();
    db.prepare('UPDATE custom_lists SET share_uuid = ?, is_public = 1 WHERE id = ? AND user_id = ?').run(uuid, listId, userId);
  } else if (!list.is_public) {
    db.prepare('UPDATE custom_lists SET is_public = 1 WHERE id = ? AND user_id = ?').run(listId, userId);
  }
  return uuid;
}

export function getCustomListByShareUuid(shareUuid) {
  if (!shareUuid) return null;
  const list = db.prepare('SELECT l.*, u.username as author_name, u.avatar as author_avatar FROM custom_lists l LEFT JOIN users u ON l.user_id = u.id WHERE l.share_uuid = ? OR (CAST(l.id AS TEXT) = ? AND l.is_public = 1)').get(String(shareUuid), String(shareUuid));
  if (!list) return null;
  const items = db.prepare('SELECT * FROM custom_list_items WHERE list_id = ? ORDER BY sort_order ASC, added_at DESC').all(list.id);
  return { ...list, items };
}

export function reorderCustomListItems(listId, userId, orderedMediaIds = []) {
  const list = db.prepare('SELECT id FROM custom_lists WHERE id = ? AND user_id = ?').get(listId, userId);
  if (!list) throw new Error('Коллекция не найдена или нет прав доступа');
  if (!Array.isArray(orderedMediaIds)) return false;
  const stmt = db.prepare('UPDATE custom_list_items SET sort_order = ? WHERE list_id = ? AND media_id = ?');
  orderedMediaIds.forEach((mId, index) => {
    stmt.run(index + 1, listId, String(mId));
  });
  return true;
}

// 7. Уведомления о цифровых релизах и новых сериях (Release Subscriptions)
export function getReleaseSubscriptions(userId) {
  if (!userId) return [];
  return db.prepare('SELECT * FROM release_subscriptions WHERE user_id = ? ORDER BY created_at DESC').all(userId);
}

export function toggleReleaseSubscription(userId, data = {}) {
  if (!userId || !data.media_id) throw new Error('Не указан идентификатор релиза');
  const mediaId = String(data.media_id);
  const source = String(data.source || 'tmdb');
  const existing = db.prepare('SELECT * FROM release_subscriptions WHERE user_id = ? AND media_id = ? AND source = ?').get(userId, mediaId, source);

  if (existing && data.action !== 'subscribe') {
    db.prepare('DELETE FROM release_subscriptions WHERE id = ? AND user_id = ?').run(existing.id, userId);
    mariaDeleteReleaseSubscription(userId, mediaId, source);
    return { subscribed: false, media_id: mediaId, source };
  }

  const now = Date.now();
  const sub = {
    user_id: userId,
    media_id: mediaId,
    source,
    title: String(data.title || 'Релиз').trim(),
    poster_url: data.poster_url || data.poster || '',
    media_type: data.media_type || 'movie',
    notify_web: data.notify_web !== false ? 1 : 0,
    notify_telegram: data.notify_telegram !== false ? 1 : 0,
    telegram_chat_id: data.telegram_chat_id || null,
    last_notified_state: 'pending',
    notification_message: null,
    created_at: now,
    updated_at: now
  };

  db.prepare(`
    INSERT INTO release_subscriptions (
      user_id, media_id, source, title, poster_url, media_type,
      notify_web, notify_telegram, telegram_chat_id, last_notified_state, notification_message, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, media_id, source) DO UPDATE SET
      title = excluded.title,
      poster_url = excluded.poster_url,
      notify_web = excluded.notify_web,
      notify_telegram = excluded.notify_telegram,
      telegram_chat_id = COALESCE(excluded.telegram_chat_id, release_subscriptions.telegram_chat_id),
      updated_at = excluded.updated_at
  `).run(
    sub.user_id, sub.media_id, sub.source, sub.title, sub.poster_url, sub.media_type,
    sub.notify_web, sub.notify_telegram, sub.telegram_chat_id, sub.last_notified_state,
    sub.notification_message, sub.created_at, sub.updated_at
  );
  mariaSaveReleaseSubscription(sub);
  return { subscribed: true, subscription: sub };
}

export function getAllActiveReleaseSubscriptions() {
  try {
    return db.prepare("SELECT * FROM release_subscriptions WHERE last_notified_state != 'released'").all();
  } catch {
    return [];
  }
}

export function markReleaseSubscriptionNotified(subId, state = 'released', message = '') {
  try {
    const now = Date.now();
    db.prepare('UPDATE release_subscriptions SET last_notified_state = ?, notification_message = ?, updated_at = ? WHERE id = ?').run(state, message, now, subId);
    const updated = db.prepare('SELECT * FROM release_subscriptions WHERE id = ?').get(subId);
    if (updated) mariaSaveReleaseSubscription(updated);
  } catch (_) {}
}

// 8. Векторный гибридный рекомендательный движок (Cosine Affinity Scoring)
export function getVectorRecommendationsForUser(userId, candidateItems = [], limit = 20) {
  if (!Array.isArray(candidateItems) || candidateItems.length === 0) return [];
  const bookmarks = userId ? db.prepare('SELECT * FROM bookmarks WHERE user_id = ?').all(userId) : [];
  const history = userId ? db.prepare('SELECT * FROM watch_history WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100').all(userId) : [];
  const reviews = userId ? db.prepare('SELECT * FROM reviews WHERE user_id = ?').all(userId) : [];

  const watchedKeys = new Set();
  const genreWeights = new Map();
  const typeWeights = new Map();
  const decadeWeights = new Map();
  let anchorTitle = '';

  for (const b of bookmarks) {
    const key = normalizeMediaKey(b.title, b.original_title);
    if (key && ['completed', 'dropped', 'wont_watch'].includes(b.status)) {
      watchedKeys.add(key);
    }
    const w = b.status === 'favorite' || b.is_favorite ? 3.0 : (b.status === 'completed' ? 2.2 : (b.status === 'watching' ? 1.8 : 0.5));
    if (w >= 2.0 && !anchorTitle && b.title) anchorTitle = b.title;
    if (b.media_type) typeWeights.set(b.media_type, (typeWeights.get(b.media_type) || 0) + w);
    if (b.year) {
      const dec = String(b.year).slice(0, 3) + '0';
      decadeWeights.set(dec, (decadeWeights.get(dec) || 0) + w * 0.5);
    }
    const gList = resolveCanonicalGenres(b.title, b.media_type, '', null) || [];
    for (const g of gList) {
      genreWeights.set(g.toLowerCase(), (genreWeights.get(g.toLowerCase()) || 0) + w);
    }
  }

  for (const h of history) {
    const key = normalizeMediaKey(h.title);
    if (key && h.progress_percent >= 85) watchedKeys.add(key);
    const w = Math.max(0.5, (Number(h.progress_percent) || 20) / 50);
    if (!anchorTitle && h.title) anchorTitle = h.title;
    if (h.media_type) typeWeights.set(h.media_type, (typeWeights.get(h.media_type) || 0) + w);
    const gList = resolveCanonicalGenres(h.title, h.media_type, '', null) || [];
    for (const g of gList) {
      genreWeights.set(g.toLowerCase(), (genreWeights.get(g.toLowerCase()) || 0) + w);
    }
  }

  for (const r of reviews) {
    if (r.rating >= 8 && r.title && !anchorTitle) anchorTitle = r.title;
  }

  const scored = [];
  for (const item of candidateItems) {
    if (!item || !item.title) continue;
    const key = normalizeMediaKey(item.title, item.original_title);
    if (key && watchedKeys.has(key)) continue;

    let score = (parseFloat(item.rating) || 7.0) * 1.2;
    const itemGenres = Array.isArray(item.genres)
      ? item.genres
      : (typeof item.genre === 'string' ? item.genre.split(',').map(s => s.trim()) : []);

    let matchedGenreCount = 0;
    for (const g of itemGenres) {
      const gw = genreWeights.get(String(g).toLowerCase());
      if (gw) {
        score += gw * 2.5;
        matchedGenreCount++;
      }
    }

    const mType = item.media_type || item.type || 'movie';
    if (typeWeights.has(mType)) {
      score += Math.min(8, typeWeights.get(mType) * 0.6);
    }

    if (item.year) {
      const dec = String(item.year).slice(0, 3) + '0';
      if (decadeWeights.has(dec)) score += Math.min(4, decadeWeights.get(dec));
    }

    if (item.is4K && !item.is_upcoming) score += 2.0;

    const matchPercent = Math.min(99, Math.max(68, Math.round(72 + Math.min(27, score * 0.8))));
    scored.push({
      ...item,
      vector_score: Math.round(score * 100) / 100,
      match_percent: matchPercent,
      because_watched: anchorTitle || null,
      matched_genres_count: matchedGenreCount
    });
  }

  scored.sort((a, b) => b.vector_score - a.vector_score);
  return scored.slice(0, limit);
}


// Гарантия однократного получения каждого достижения и очистка кэша фильма Безответная бабочка
setImmediate(() => {
  try {
    db.prepare("DELETE FROM cache WHERE key LIKE '%10296%' OR key LIKE '%бабочк%'").run();
    const allUsers = db.prepare("SELECT id, settings_json FROM users").all();
    for (const u of allUsers) {
      try {
        const fullAchs = getUserAchievements(u.id);
        const sObj = JSON.parse(u.settings_json || "{}");
        if (!sObj.kv_store || typeof sObj.kv_store !== "object") sObj.kv_store = {};
        let prevLocalMap = {};
        try { prevLocalMap = JSON.parse(sObj.kv_store.storm_local_achievements || "{}") || {}; } catch (_) {}
        const localAchMap = { ...prevLocalMap };
        const toastedSet = new Set();
        try {
          const prevToast = JSON.parse(sObj.kv_store.storm_toasted_achievements_v1 || "[]");
          if (Array.isArray(prevToast)) prevToast.forEach(id => { if (id) toastedSet.add(String(id)); });
        } catch (_) {}
        for (const a of fullAchs) {
          const prevE = prevLocalMap[a.id];
          const isUnl = Boolean(a.unlocked || prevE?.unlocked || (a.target > 0 && a.progress >= a.target));
          localAchMap[a.id] = {
            progress: isUnl ? a.target : Math.max(a.progress || 0, prevE?.progress || 0),
            target: a.target || 1,
            unlocked: isUnl,
            unlocked_at: prevE?.unlocked_at || a.unlocked_at || (isUnl ? Date.now() : null)
          };
          if (isUnl) toastedSet.add(String(a.id));
        }
        sObj.kv_store.storm_local_achievements = JSON.stringify(localAchMap);
        sObj.kv_store.storm_toasted_achievements_v1 = JSON.stringify(Array.from(toastedSet));
        updateUserSettings(u.id, sObj);
      } catch (_) {}
    }
  } catch (_) {}
});


// =========================================================================
// 4. БЫСТРОЕ ПЕРЕКЛЮЧЕНИЕ АККАУНТОВ (ACCOUNT SWITCHER) И ВОССТАНОВЛЕНИЕ ПАРОЛЯ
// =========================================================================
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateFormattedRecoveryCodes(count = 8) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const bytes = crypto.randomBytes(8);
    let p1 = '';
    let p2 = '';
    for (let j = 0; j < 4; j++) {
      p1 += RECOVERY_ALPHABET[bytes[j] % RECOVERY_ALPHABET.length];
      p2 += RECOVERY_ALPHABET[bytes[j + 4] % RECOVERY_ALPHABET.length];
    }
    codes.push(`${p1}-${p2}`);
  }
  return codes;
}

export function getSavedAccountsByTokens(candidateTokens = [], currentUserId = null) {
  const rawTokens = Array.isArray(candidateTokens) ? candidateTokens : [];
  const expandedTokens = new Set();
  for (const t of rawTokens) {
    const clean = String(t || '').trim();
    if (clean && clean.length >= 16) expandedTokens.add(clean);
  }

  // Используем строго локальные токены текущего браузера без кросс-девайс слияния через БД
  const validPairs = []; // { user, token }
  const seenUserIds = new Set();

  for (const tok of expandedTokens) {
    const u = getUserByToken(tok);
    if (u && u.id && !seenUserIds.has(Number(u.id))) {
      seenUserIds.add(Number(u.id));
      validPairs.push({ user: u, token: tok });
    }
  }

  const validTokens = validPairs.map(p => p.token).slice(0, 8);

  const accounts = validPairs.map(({ user }) => ({
    id: user.id,
    username: user.username,
    email: user.email,
    avatar: user.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(user.username)}`,
    role: user.role || 'user',
    created_at: user.created_at,
    isCurrent: currentUserId ? Number(user.id) === Number(currentUserId) : false
  }));

  return { accounts, validTokens, validPairs };
}

export function removeAccountFromDeviceVault(targetUserId, candidateTokens = []) {
  const { validPairs } = getSavedAccountsByTokens(candidateTokens, null);
  const remainingPairs = validPairs.filter(p => Number(p.user.id) !== Number(targetUserId));
  const removedPairs = validPairs.filter(p => Number(p.user.id) === Number(targetUserId));
  const remainingTokens = remainingPairs.map(p => p.token);

  for (const { user } of validPairs) {
    try {
      const row = db.prepare('SELECT settings_json FROM users WHERE id = ?').get(user.id);
      const s = JSON.parse(row?.settings_json || '{}');
      s.device_vault_tokens = Number(user.id) === Number(targetUserId) ? [] : remainingTokens;
      updateUserSettings(user.id, s);
    } catch (_) {}
  }

  for (const { token } of removedPairs) {
    try { logoutUser(token); } catch (_) {}
  }

  return remainingTokens;
}

export function ensureUserRecoveryConfig(userId) {
  const row = db.prepare('SELECT id, username, email, settings_json FROM users WHERE id = ?').get(Number(userId));
  if (!row) return { recoveryCodes: [], telegramChatId: '', totpEnabled: false, totpBackupCodesCount: 0 };
  const s = JSON.parse(row.settings_json || '{}');
  let changed = false;

  if (!Array.isArray(s.recovery_codes) || s.recovery_codes.length === 0) {
    s.recovery_codes = generateFormattedRecoveryCodes(8);
    changed = true;
  }

  if (!s.telegram_chat_id) {
    try {
      const subRow = db.prepare("SELECT telegram_chat_id FROM release_subscriptions WHERE user_id = ? AND telegram_chat_id IS NOT NULL AND telegram_chat_id != '' LIMIT 1").get(Number(userId));
      if (subRow?.telegram_chat_id) {
        s.telegram_chat_id = String(subRow.telegram_chat_id).trim();
        changed = true;
      }
    } catch (_) {}
  }

  if (changed) {
    updateUserSettings(Number(userId), s);
  }

  return {
    recoveryCodes: s.recovery_codes || [],
    telegramChatId: s.telegram_chat_id || '',
    totpEnabled: Boolean(s.totp_enabled && s.totp_secret),
    totpBackupCodesCount: Array.isArray(s.totp_backup_codes) ? s.totp_backup_codes.length : 0
  };
}

export function regenerateUserRecoveryCodes(userId) {
  const row = db.prepare('SELECT settings_json FROM users WHERE id = ?').get(Number(userId));
  if (!row) throw new Error('Пользователь не найден');
  const s = JSON.parse(row.settings_json || '{}');
  s.recovery_codes = generateFormattedRecoveryCodes(8);
  updateUserSettings(Number(userId), s);
  return s.recovery_codes;
}

export function saveUserRecoveryTelegram(userId, telegramChatId) {
  const row = db.prepare('SELECT settings_json FROM users WHERE id = ?').get(Number(userId));
  if (!row) throw new Error('Пользователь не найден');
  const cleanChatId = String(telegramChatId || '').trim();
  const s = JSON.parse(row.settings_json || '{}');
  s.telegram_chat_id = cleanChatId;
  updateUserSettings(Number(userId), s);
  if (cleanChatId) {
    try {
      db.prepare('UPDATE release_subscriptions SET telegram_chat_id = ? WHERE user_id = ?').run(cleanChatId, Number(userId));
    } catch (_) {}
  }
  return cleanChatId;
}

export function createTelegramPasswordResetOtp(loginOrEmail) {
  const cleanLogin = String(loginOrEmail || '').trim();
  if (!cleanLogin) throw new Error('Укажите имя пользователя или email');
  const user = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)').get(cleanLogin, cleanLogin);
  if (!user) {
    throw new Error('Пользователь с таким именем или email не найден');
  }
  const cfg = ensureUserRecoveryConfig(user.id);
  if (!cfg.telegramChatId) {
    throw new Error('К этому аккаунту не привязан Telegram Chat ID. Используйте резервный код восстановления или код 2FA TOTP.');
  }
  const otpNum = 100000 + (crypto.randomBytes(4).readUInt32BE(0) % 900000);
  const code = String(otpNum);
  const s = JSON.parse(user.settings_json || '{}');
  s.password_reset_otp = {
    codeHash: hashPassword(code),
    expiresAt: Date.now() + 10 * 60 * 1000,
    attempts: 0
  };
  updateUserSettings(user.id, s);
  return { user, telegramChatId: cfg.telegramChatId, code };
}

export function resetUserPasswordWithCode(loginOrEmail, rawCode, newPassword, verifyTotpFn = null, meta = {}) {
  const cleanLogin = String(loginOrEmail || '').trim();
  const cleanCode = String(rawCode || '').trim().toUpperCase();
  const normCode = cleanCode.replace(/[^A-Z0-9]/g, '');
  const cleanNewPass = String(newPassword || '').trim();

  if (!cleanLogin) throw new Error('Укажите имя пользователя или email');
  if (!normCode) throw new Error('Введите резервный код или код из Telegram / 2FA');
  if (cleanNewPass.length < 6) throw new Error('Новый пароль должен содержать не менее 6 символов');

  const user = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)').get(cleanLogin, cleanLogin);
  if (!user) {
    throw new Error('Пользователь с таким именем или email не найден');
  }

  ensureUserRecoveryConfig(user.id);
  const freshRow = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  const s = JSON.parse(freshRow.settings_json || '{}');

  let methodUsed = null;

  // 1. Проверка одноразовых резервных кодов восстановления (recovery_codes)
  if (Array.isArray(s.recovery_codes)) {
    const idx = s.recovery_codes.findIndex(c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === normCode);
    if (idx !== -1) {
      methodUsed = 'recovery_code';
      s.recovery_codes.splice(idx, 1);
      if (s.recovery_codes.length === 0) {
        s.recovery_codes = generateFormattedRecoveryCodes(8);
      }
    }
  }

  // 2. Проверка резервных кодов 2FA TOTP (totp_backup_codes)
  if (!methodUsed && Array.isArray(s.totp_backup_codes)) {
    const idx = s.totp_backup_codes.findIndex(c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === normCode);
    if (idx !== -1) {
      methodUsed = 'totp_backup_code';
      s.totp_backup_codes.splice(idx, 1);
    }
  }

  // 3. Проверка 6-значного кода приложения-аутентификатора 2FA TOTP
  if (!methodUsed && s.totp_secret && typeof verifyTotpFn === 'function') {
    if (verifyTotpFn(s.totp_secret, normCode, 1)) {
      methodUsed = 'totp_app';
    }
  }

  // 4. Проверка одноразового кода из Telegram-бота
  if (!methodUsed && s.password_reset_otp) {
    const otp = s.password_reset_otp;
    if (Date.now() <= Number(otp.expiresAt || 0) && Number(otp.attempts || 0) < 5) {
      if (verifyPassword(normCode, otp.codeHash)) {
        methodUsed = 'telegram_otp';
        delete s.password_reset_otp;
      } else {
        otp.attempts = Number(otp.attempts || 0) + 1;
        updateUserSettings(user.id, s);
      }
    }
  }

  if (!methodUsed) {
    throw new Error('Неверный или просроченный резервный код / код восстановления');
  }

  delete s.password_reset_otp;
  updateUserSettings(user.id, s);

  const newHash = hashPassword(cleanNewPass);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  const updatedUser = db.prepare('SELECT id, username, email, password_hash, avatar, role, created_at, settings_json FROM users WHERE id = ?').get(user.id);
  if (updatedUser) {
    mariaSaveUser(updatedUser);
    mariaDeleteUserSessions(user.id);
  }

  const session = createSession(user.id, meta);
  return { session, methodUsed };
}
