import './env-loader.js';
import mysql from 'mysql2/promise';

let pool = null;
let activeHost = null;
let isConnected = false;
let syncInProgress = false;
let initInFlightPromise = null;
let mariaWriteQueue = Promise.resolve();
let lastFailedInitAt = 0;
const INIT_RETRY_COOLDOWN_MS = 60 * 1000;

const DB_CONFIG = {
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'stormmultimedia',
  waitForConnections: true,
  connectionLimit: 15,
  connectTimeout: 2500,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000
};

/**
 * Инициализация пула соединений MariaDB 10 с автоматическим переключением хостов,
 * защитой от параллельного шторма подключений (single-flight) и кулдауном 60 сек.
 */
export async function initMariaDb(force = false) {
  if (pool && isConnected) return pool;
  if (initInFlightPromise) return initInFlightPromise;
  if (!force && lastFailedInitAt > 0 && (Date.now() - lastFailedInitAt) < INIT_RETRY_COOLDOWN_MS) {
    return null;
  }

  if (!DB_CONFIG.password && !process.env.DB_ALLOW_EMPTY_PASS) {
    return null;
  }

  initInFlightPromise = (async () => {
    const candidateHosts = [
      process.env.DB_HOST || '127.0.0.1',
      process.env.DB_HOST_FALLBACK || ''
    ];

    const uniqueHosts = Array.from(new Set(candidateHosts.filter(Boolean)));

    for (const host of uniqueHosts) {
      let candidatePool = null;
      try {
        candidatePool = mysql.createPool({
          ...DB_CONFIG,
          host
        });

        const [rows] = await candidatePool.query('SELECT 1 AS ok');
        if (rows && rows.length > 0) {
          pool = candidatePool;
          activeHost = host;
          isConnected = true;
          lastFailedInitAt = 0;
          try {
            const [cols] = await candidatePool.query("SHOW COLUMNS FROM bookmarks LIKE 'watched_episodes_json'");
            if (!cols || cols.length === 0) {
              await candidatePool.query("ALTER TABLE bookmarks ADD COLUMN watched_episodes_json LONGTEXT NULL");
              console.log('[MariaDB 10] Добавлена колонка bookmarks.watched_episodes_json');
            }
          } catch (migErr) {
            console.warn('[MariaDB 10] Проверка миграции watched_episodes_json:', migErr.message);
          }
          try {
            await candidatePool.query("DELETE FROM media_cache WHERE cache_key LIKE 'catalog_v4_%' OR cache_key LIKE 'tmdb_upcoming_v2_%'");
          } catch (_) {}
          console.log(`[MariaDB 10] Успешное подключение к базе данных '${DB_CONFIG.database}' на ${host}:${DB_CONFIG.port}`);
          return pool;
        }
        await candidatePool.end().catch(() => {});
      } catch (err) {
        if (candidatePool) {
          await candidatePool.end().catch(() => {});
        }
        if (lastFailedInitAt === 0) {
          console.warn(`[MariaDB 10] Хост ${host}:${DB_CONFIG.port} недоступен (${err.code || err.message}). Пробуем следующий...`);
        }
      }
    }

    if (lastFailedInitAt === 0) {
      console.warn('[MariaDB 10] Внимание: ни один из хостов MariaDB не ответил. Задействован автономный SQLite режим.');
    }
    lastFailedInitAt = Date.now();
    isConnected = false;
    return null;
  })();

  try {
    return await initInFlightPromise;
  } finally {
    initInFlightPromise = null;
  }
}

export function getMariaDbPool() {
  return pool;
}

export function isMariaDbActive() {
  return isConnected && pool !== null;
}

export function getMariaDbHost() {
  return activeHost;
}

/**
 * Безопасное выполнение запроса к MariaDB с логированием и перехватом ошибок
 */
export async function queryMariaDb(sql, params = []) {
  if (!pool || !isConnected) {
    if (lastFailedInitAt === 0 || (Date.now() - lastFailedInitAt) >= INIT_RETRY_COOLDOWN_MS) {
      try {
        await initMariaDb();
      } catch (_) {}
    }
  }
  if (!pool || !isConnected) return null;

  try {
    const cleanParams = params.map(p => (p === undefined ? null : p));
    const [result] = await pool.query(sql, cleanParams);
    return result;
  } catch (err) {
    console.error(`[MariaDB Error] Ошибка запроса (${err.code || err.message}):`, err.sqlMessage || err.message);
    // При потере соединения пробуем восстановить флаг
    if (err.code === 'ECONNREFUSED' || err.code === 'PROTOCOL_CONNECTION_LOST') {
      isConnected = false;
      setTimeout(() => initMariaDb().catch(() => {}), 5000);
    }
    return null;
  }
}

/**
 * Строго упорядоченная FIFO-очередь записи/удаления в MariaDB 10,
 * исключающая гонки параллельных TCP-соединений пула (например INSERT -> мгновенный DELETE)
 */
export function enqueueMariaDbWrite(sql, params = []) {
  mariaWriteQueue = mariaWriteQueue
    .then(() => queryMariaDb(sql, params))
    .catch(() => null);
  return mariaWriteQueue;
}

/**
 * Синхронизация данных из MariaDB в локальный SQLite (на старте или по расписанию)
 */
export async function syncFromMariaDbToSqlite(sqliteDb) {
  if (!pool || !isConnected || syncInProgress) return;
  syncInProgress = true;

  try {
    // 1. Синхронизация пользователей
    const [mUsers] = await pool.query('SELECT * FROM users');
    const validUserIds = new Set((mUsers || []).map(u => Number(u.id)));
    if (mUsers && mUsers.length > 0) {
      const upsertUser = sqliteDb.prepare(`
        INSERT INTO users (id, username, email, password_hash, avatar, role, created_at, settings_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          username = excluded.username,
          email = excluded.email,
          password_hash = excluded.password_hash,
          avatar = excluded.avatar,
          role = excluded.role,
          settings_json = excluded.settings_json
      `);
      for (const u of mUsers) {
        upsertUser.run(
          u.id,
          u.username,
          u.email,
          u.password_hash,
          u.avatar,
          u.role || 'user',
          Number(u.created_at),
          u.settings_json || '{}'
        );
      }
    }

    // 2. Синхронизация сессий (с очисткой истёкших и ранее утёкших сессий)
    const now = Date.now();
    try {
      await pool.query('DELETE FROM sessions WHERE expires_at <= ?', [now]);
      sqliteDb.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
      const [secCheck] = await pool.query("SELECT data_json FROM media_cache WHERE source = 'system' AND cache_key = 'security_session_purge_v4'");
      if (!secCheck || secCheck.length === 0) {
        await pool.query("DELETE FROM sessions");
        await pool.query(
          "DELETE FROM watch_history WHERE user_id = 2 AND (id IN (597, 625, 628, 630, 631, 634, 709) OR title IN ('Посвященный', 'Пасть', 'Её личный ад', 'Меченая', 'Мортал Комбат', 'Одинокий рейнджер', 'Крикуны'))"
        );
        await pool.query("UPDATE watch_history SET media_type = 'movie', season = 1, episode = 1 WHERE LOWER(title) LIKE '%уличный боец%' OR LOWER(title) LIKE '%street fighter%'");
        await pool.query("UPDATE bookmarks SET media_type = 'movie', total_episodes = 1 WHERE LOWER(title) LIKE '%уличный боец%' OR LOWER(title) LIKE '%street fighter%'");
        await pool.query(
          "INSERT INTO media_cache (source, cache_key, data_json, expires_at) VALUES ('system', 'security_session_purge_v4', ?, ?) ON DUPLICATE KEY UPDATE data_json = VALUES(data_json)",
          [JSON.stringify({ purgedAt: now }), now + 86400000 * 3650]
        );
        console.log('[Security MariaDB] Все старые сессии отозваны, чужие записи из watch_history удалены.');
      }
      if (validUserIds.size > 0) {
        const idList = Array.from(validUserIds).join(',');
        sqliteDb.prepare(`DELETE FROM bookmarks WHERE user_id NOT IN (${idList})`).run();
        sqliteDb.prepare(`DELETE FROM watch_history WHERE user_id NOT IN (${idList})`).run();
      }
      const [upCacheCheck] = await pool.query("SELECT data_json FROM media_cache WHERE source = 'system' AND cache_key = 'upcoming_stream_probe_v7'");
      if (!upCacheCheck || upCacheCheck.length === 0) {
        await pool.query("DELETE FROM media_cache WHERE source = 'stream_probe' OR cache_key LIKE 'catalog_v5_%' OR cache_key LIKE 'search_v3_%' OR cache_key LIKE 'details_v3_%'");
        sqliteDb.prepare("DELETE FROM media_cache WHERE source = 'stream_probe' OR cache_key LIKE 'catalog_v5_%' OR cache_key LIKE 'search_v3_%' OR cache_key LIKE 'details_v3_%'").run();
        await pool.query(
          "INSERT INTO media_cache (source, cache_key, data_json, expires_at) VALUES ('system', 'upcoming_stream_probe_v7', ?, ?) ON DUPLICATE KEY UPDATE data_json = VALUES(data_json)",
          [JSON.stringify({ purgedAt: now }), now + 86400000 * 3650]
        );
      }
    } catch (_) {}
    const [mSessions] = await pool.query('SELECT * FROM sessions WHERE expires_at > ?', [now]);
    if (mSessions && mSessions.length > 0) {
      const upsertSession = sqliteDb.prepare(`
        INSERT INTO sessions (token, user_id, expires_at)
        VALUES (?, ?, ?)
        ON CONFLICT(token) DO UPDATE SET
          expires_at = excluded.expires_at
      `);
      for (const s of mSessions) {
        upsertSession.run(s.token, s.user_id, Number(s.expires_at));
      }
    }

    // 3. Синхронизация закладок (с пометками просмотренных серий и защитой от перезаписи более свежих данных)
    const [mBookmarks] = await pool.query('SELECT * FROM bookmarks');
    if (mBookmarks) {
      const upsertBookmark = sqliteDb.prepare(`
        INSERT INTO bookmarks (
          user_id, media_id, source, title, original_title, poster_url, media_type,
          year, status, is_favorite, episodes_watched, total_episodes, progress_percent,
          last_time_seconds, watched_episodes_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, media_id, source) DO UPDATE SET
          title = excluded.title,
          original_title = excluded.original_title,
          poster_url = COALESCE(NULLIF(excluded.poster_url, ''), bookmarks.poster_url),
          media_type = excluded.media_type,
          year = COALESCE(NULLIF(excluded.year, ''), bookmarks.year),
          status = excluded.status,
          is_favorite = excluded.is_favorite,
          episodes_watched = excluded.episodes_watched,
          total_episodes = excluded.total_episodes,
          progress_percent = excluded.progress_percent,
          last_time_seconds = excluded.last_time_seconds,
          watched_episodes_json = CASE
            WHEN excluded.watched_episodes_json IS NOT NULL AND excluded.watched_episodes_json != '' AND excluded.watched_episodes_json != '{}'
              THEN excluded.watched_episodes_json
            ELSE COALESCE(bookmarks.watched_episodes_json, '{}')
          END,
          updated_at = excluded.updated_at
        WHERE excluded.updated_at >= bookmarks.updated_at
      `);

      const mBookmarkMap = new Map();
      for (const b of mBookmarks) {
        const key = `${b.user_id}_${String(b.media_id)}_${b.source}`;
        mBookmarkMap.set(key, Number(b.updated_at) || 0);
        upsertBookmark.run(
          b.user_id,
          String(b.media_id),
          b.source,
          b.title,
          b.original_title || '',
          b.poster_url || '',
          b.media_type || 'movie',
          b.year || '',
          b.status,
          b.is_favorite ? 1 : 0,
          b.episodes_watched || 0,
          b.total_episodes || 0,
          b.progress_percent || 0.0,
          b.last_time_seconds || 0,
          b.watched_episodes_json || '{}',
          Number(b.updated_at) || 0
        );
      }

      // Передаем локальные закладки в MariaDB, если их там ещё нет или они свежее
      const localBookmarks = sqliteDb.prepare('SELECT * FROM bookmarks').all();
      for (const lb of localBookmarks) {
        if (validUserIds.size > 0 && !validUserIds.has(Number(lb.user_id))) continue;
        const key = `${lb.user_id}_${String(lb.media_id)}_${lb.source}`;
        const mUpdated = mBookmarkMap.get(key);
        if (mUpdated === undefined || (Number(lb.updated_at) || 0) > mUpdated) {
          mariaSaveBookmark(lb);
        }
      }
    }

    // 4. Синхронизация кастомных списков и элементов
    const [mLists] = await pool.query('SELECT * FROM custom_lists');
    if (mLists) {
      const upsertList = sqliteDb.prepare(`
        INSERT INTO custom_lists (id, user_id, title, description, color, is_public, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          description = excluded.description,
          color = excluded.color,
          is_public = excluded.is_public
      `);
      for (const l of mLists) {
        upsertList.run(l.id, l.user_id, l.title, l.description || '', l.color || '#00d2ff', l.is_public ? 1 : 0, Number(l.created_at));
      }

      const [mItems] = await pool.query('SELECT * FROM custom_list_items');
      if (mItems) {
        const upsertItem = sqliteDb.prepare(`
          INSERT INTO custom_list_items (id, list_id, media_id, source, title, poster_url, media_type, year, rating, added_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            poster_url = excluded.poster_url,
            media_type = excluded.media_type,
            year = excluded.year,
            rating = excluded.rating
        `);
        for (const i of mItems) {
          upsertItem.run(i.id, i.list_id, String(i.media_id), i.source, i.title, i.poster_url || '', i.media_type || 'movie', i.year || '', i.rating || 0.0, Number(i.added_at));
        }
      }
    }

    // 5. Синхронизация истории просмотров
    const [mHistory] = await pool.query('SELECT * FROM watch_history');
    if (mHistory) {
      const upsertHist = sqliteDb.prepare(`
        INSERT INTO watch_history (
          user_id, media_id, source, title, poster_url, media_type, year,
          season, episode, time_seconds, duration_seconds, progress_percent, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, media_id, source, season, episode) DO UPDATE SET
          title = excluded.title,
          poster_url = COALESCE(NULLIF(excluded.poster_url, ''), watch_history.poster_url),
          media_type = excluded.media_type,
          year = COALESCE(NULLIF(excluded.year, ''), watch_history.year),
          time_seconds = excluded.time_seconds,
          duration_seconds = excluded.duration_seconds,
          progress_percent = excluded.progress_percent,
          updated_at = excluded.updated_at
        WHERE excluded.updated_at >= watch_history.updated_at
      `);

      const mHistMap = new Map();
      for (const h of mHistory) {
        const key = `${h.user_id}_${String(h.media_id)}_${h.source}_${h.season || 1}_${h.episode || 1}`;
        mHistMap.set(key, Number(h.updated_at) || 0);
        upsertHist.run(
          h.user_id,
          String(h.media_id),
          h.source,
          h.title,
          h.poster_url || '',
          h.media_type || 'movie',
          h.year || '',
          h.season || 1,
          h.episode || 1,
          h.time_seconds || 0,
          h.duration_seconds || 0,
          h.progress_percent || 0.0,
          Number(h.updated_at)
        );
      }

      // Передаем локальную историю в MariaDB, если её там ещё нет или она свежее
      const localHist = sqliteDb.prepare('SELECT * FROM watch_history').all();
      for (const lh of localHist) {
        if (validUserIds.size > 0 && !validUserIds.has(Number(lh.user_id))) continue;
        const key = `${lh.user_id}_${String(lh.media_id)}_${lh.source}_${lh.season || 1}_${lh.episode || 1}`;
        const mUpdated = mHistMap.get(key);
        if (mUpdated === undefined || (Number(lh.updated_at) || 0) > mUpdated) {
          mariaSaveWatchHistory(lh);
        }
      }
    }

    // 6. Синхронизация достижений
    const [mAchievements] = await pool.query('SELECT * FROM user_achievements');
    if (mAchievements) {
      const upsertAch = sqliteDb.prepare(`
        INSERT INTO user_achievements (user_id, achievement_id, progress, target, unlocked, unlocked_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, achievement_id) DO UPDATE SET
          progress = excluded.progress,
          target = excluded.target,
          unlocked = excluded.unlocked,
          unlocked_at = excluded.unlocked_at
      `);
      for (const a of mAchievements) {
        upsertAch.run(
          a.user_id,
          a.achievement_id,
          a.progress || 0,
          a.target || 1,
          a.unlocked ? 1 : 0,
          a.unlocked_at ? Number(a.unlocked_at) : null
        );
      }
    }

    // 7. Синхронизация комнат совместного просмотра
    const [mRooms] = await pool.query('SELECT * FROM watch_rooms');
    if (mRooms) {
      const upsertRoom = sqliteDb.prepare(`
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
      for (const r of mRooms) {
        upsertRoom.run(
          r.room_id,
          r.name,
          r.host_id || null,
          r.host_name,
          r.current_media_json || null,
          r.is_playing ? 1 : 0,
          r.current_time || 0.0,
          Number(r.created_at),
          Number(r.updated_at)
        );
      }
    }

    // 8. Синхронизация рецензий и лайков
    const [mReviews] = await pool.query('SELECT * FROM reviews');
    if (mReviews) {
      const upsertReview = sqliteDb.prepare(`
        INSERT INTO reviews (id, user_id, media_id, source, title, rating, content, tone, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          rating = excluded.rating,
          content = excluded.content,
          tone = excluded.tone,
          updated_at = excluded.updated_at
      `);
      for (const rev of mReviews) {
        upsertReview.run(
          rev.id,
          rev.user_id,
          String(rev.media_id),
          rev.source,
          rev.title || '',
          rev.rating || 10,
          rev.content,
          rev.tone || 'positive',
          Number(rev.created_at),
          Number(rev.updated_at)
        );
      }

      const [mLikes] = await pool.query('SELECT * FROM review_likes');
      if (mLikes) {
        const upsertLike = sqliteDb.prepare(`
          INSERT INTO review_likes (id, review_id, user_id, is_like, created_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(review_id, user_id) DO UPDATE SET
            is_like = excluded.is_like
        `);
        for (const l of mLikes) {
          upsertLike.run(l.id, l.review_id, l.user_id, l.is_like ? 1 : 0, Number(l.created_at));
        }
      }
    }

    console.log('[MariaDB 10] Двусторонняя синхронизация завершена успешно.');
  } catch (err) {
    console.error('[MariaDB 10] Ошибка фоновой синхронизации данных:', err.message);
  } finally {
    syncInProgress = false;
  }
}

// ==========================================
// WRITE-THROUGH ОПЕРАЦИИ ДЛЯ MARIADB 10 (FIFO)
// ==========================================

export function mariaSaveUser(user) {
  return enqueueMariaDbWrite(
    `INSERT INTO users (id, username, email, password_hash, avatar, role, settings_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       username = VALUES(username),
       email = VALUES(email),
       password_hash = VALUES(password_hash),
       avatar = VALUES(avatar),
       role = VALUES(role),
       settings_json = VALUES(settings_json)`,
    [
      user.id,
      user.username,
      user.email,
      user.password_hash,
      user.avatar || null,
      user.role || 'user',
      user.settings_json || '{}',
      user.created_at || Date.now()
    ]
  );
}

export function mariaSaveSession(token, userId, expiresAt) {
  return enqueueMariaDbWrite(
    `INSERT INTO sessions (token, user_id, expires_at)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at)`,
    [token, userId, expiresAt]
  );
}

export function mariaDeleteSession(token) {
  return enqueueMariaDbWrite('DELETE FROM sessions WHERE token = ?', [token]);
}

export function mariaDeleteUserSessions(userId) {
  return enqueueMariaDbWrite('DELETE FROM sessions WHERE user_id = ?', [userId]);
}

export function mariaSaveBookmark(b) {
  const watchedJson = typeof b.watched_episodes_json === 'string'
    ? b.watched_episodes_json
    : (b.watched_episodes_json ? JSON.stringify(b.watched_episodes_json) : '{}');
  return enqueueMariaDbWrite(
    `INSERT INTO bookmarks (
       user_id, media_id, source, title, original_title, poster_url, media_type,
       year, status, is_favorite, episodes_watched, total_episodes, progress_percent,
       last_time_seconds, watched_episodes_json, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       title = VALUES(title),
       original_title = VALUES(original_title),
       poster_url = COALESCE(NULLIF(VALUES(poster_url), ''), bookmarks.poster_url),
       media_type = VALUES(media_type),
       year = COALESCE(NULLIF(VALUES(year), ''), bookmarks.year),
       status = VALUES(status),
       is_favorite = VALUES(is_favorite),
       episodes_watched = VALUES(episodes_watched),
       total_episodes = VALUES(total_episodes),
       progress_percent = VALUES(progress_percent),
       last_time_seconds = VALUES(last_time_seconds),
       watched_episodes_json = VALUES(watched_episodes_json),
       updated_at = VALUES(updated_at)`,
    [
      b.user_id,
      String(b.media_id),
      b.source,
      b.title,
      b.original_title || '',
      b.poster_url || '',
      b.media_type || 'movie',
      b.year || '',
      b.status,
      b.is_favorite ? 1 : 0,
      b.episodes_watched || 0,
      b.total_episodes || 0,
      b.progress_percent || 0.0,
      b.last_time_seconds || 0,
      watchedJson,
      b.updated_at || Date.now()
    ]
  );
}

export function mariaDeleteBookmark(userId, mediaId, source, matchedRows = [], title = '') {
  if (!userId) return;
  if (mediaId && source) {
    const cleanId = String(mediaId).replace(/^[a-z]+_/, '');
    enqueueMariaDbWrite(
      'DELETE FROM bookmarks WHERE user_id = ? AND (media_id = ? OR media_id = ? OR media_id = ?)',
      [userId, String(mediaId), cleanId, `${source}_${cleanId}`]
    );
  } else if (mediaId) {
    const cleanId = String(mediaId).replace(/^[a-z]+_/, '');
    enqueueMariaDbWrite(
      'DELETE FROM bookmarks WHERE user_id = ? AND (media_id = ? OR media_id = ?)',
      [userId, String(mediaId), cleanId]
    );
  }
  if (Array.isArray(matchedRows) && matchedRows.length > 0) {
    for (const row of matchedRows) {
      if (row && typeof row === 'object' && row.media_id) {
        enqueueMariaDbWrite(
          'DELETE FROM bookmarks WHERE user_id = ? AND media_id = ? AND source = ?',
          [userId, String(row.media_id), String(row.source || '')]
        );
      }
    }
  }
  if (title && String(title).trim()) {
    enqueueMariaDbWrite(
      'DELETE FROM bookmarks WHERE user_id = ? AND LOWER(TRIM(title)) = LOWER(TRIM(?))',
      [userId, String(title).trim()]
    );
  }
}

export function mariaDeleteWatchHistory(userId, mediaId = '', title = '') {
  if (!userId) return;
  const cleanId = String(mediaId || '').trim();
  const cleanTitle = String(title || '').trim();
  if (cleanId) {
    const strippedId = cleanId.replace(/^[a-z]+_/, '');
    enqueueMariaDbWrite(
      'DELETE FROM watch_history WHERE user_id = ? AND (media_id = ? OR media_id = ?)',
      [userId, cleanId, strippedId]
    );
  }
  if (cleanTitle) {
    enqueueMariaDbWrite(
      'DELETE FROM watch_history WHERE user_id = ? AND LOWER(TRIM(title)) = LOWER(TRIM(?))',
      [userId, cleanTitle]
    );
  }
}

export function mariaSaveWatchHistory(h) {
  return enqueueMariaDbWrite(
    `INSERT INTO watch_history (
       user_id, media_id, source, title, poster_url, media_type, year,
       season, episode, time_seconds, duration_seconds, progress_percent, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       media_type = VALUES(media_type),
       year = COALESCE(NULLIF(VALUES(year), ''), watch_history.year),
       time_seconds = VALUES(time_seconds),
       duration_seconds = VALUES(duration_seconds),
       progress_percent = VALUES(progress_percent),
       updated_at = VALUES(updated_at)`,
    [
      h.user_id,
      String(h.media_id),
      h.source,
      h.title,
      h.poster_url || '',
      h.media_type || 'movie',
      h.year || '',
      h.season || 1,
      h.episode || 1,
      h.time_seconds || 0,
      h.duration_seconds || 0,
      h.progress_percent || 0.0,
      h.updated_at || Date.now()
    ]
  );
}

export function mariaPurgeUserData(userId) {
  enqueueMariaDbWrite('DELETE FROM bookmarks WHERE user_id = ?', [userId]);
  enqueueMariaDbWrite('DELETE FROM watch_history WHERE user_id = ?', [userId]);
  enqueueMariaDbWrite(
    `DELETE FROM custom_list_items WHERE list_id IN (
       SELECT id FROM custom_lists WHERE user_id = ?
     )`,
    [userId]
  );
  return enqueueMariaDbWrite('DELETE FROM custom_lists WHERE user_id = ?', [userId]);
}

export function mariaSaveCustomList(list) {
  queryMariaDb(
    `INSERT INTO custom_lists (id, user_id, title, description, color, is_public, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       title = VALUES(title),
       description = VALUES(description),
       color = VALUES(color),
       is_public = VALUES(is_public)`,
    [
      list.id,
      list.user_id,
      list.title,
      list.description || '',
      list.color || '#00d2ff',
      list.is_public ? 1 : 0,
      list.created_at || Date.now()
    ]
  );
}

export function mariaDeleteCustomList(listId, userId) {
  queryMariaDb('DELETE FROM custom_lists WHERE id = ? AND user_id = ?', [listId, userId]);
}

export function mariaSaveCustomListItem(item) {
  queryMariaDb(
    `INSERT INTO custom_list_items (id, list_id, media_id, source, title, poster_url, media_type, year, rating, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       title = VALUES(title),
       poster_url = VALUES(poster_url),
       media_type = VALUES(media_type),
       year = VALUES(year),
       rating = VALUES(rating)`,
    [
      item.id || null,
      item.list_id,
      String(item.media_id),
      item.source,
      item.title,
      item.poster_url || '',
      item.media_type || 'movie',
      item.year || '',
      item.rating || 0.0,
      item.added_at || Date.now()
    ]
  );
}

export function mariaDeleteCustomListItem(listId, mediaId, source) {
  queryMariaDb(
    'DELETE FROM custom_list_items WHERE list_id = ? AND media_id = ? AND source = ?',
    [listId, String(mediaId), source]
  );
}

export function mariaSaveReview(rev) {
  queryMariaDb(
    `INSERT INTO reviews (id, user_id, media_id, source, title, rating, content, tone, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       rating = VALUES(rating),
       content = VALUES(content),
       tone = VALUES(tone),
       updated_at = VALUES(updated_at)`,
    [
      rev.id || null,
      rev.user_id,
      String(rev.media_id),
      rev.source,
      rev.title || '',
      rev.rating || 10,
      rev.content,
      rev.tone || 'positive',
      rev.created_at || Date.now(),
      rev.updated_at || Date.now()
    ]
  );
}

export function mariaDeleteReview(reviewId, userId) {
  queryMariaDb('DELETE FROM reviews WHERE id = ? AND user_id = ?', [reviewId, userId]);
}

export function mariaSaveReviewLike(reviewId, userId, isLike) {
  queryMariaDb(
    `INSERT INTO review_likes (review_id, user_id, is_like, created_at)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       is_like = VALUES(is_like)`,
    [reviewId, userId, isLike ? 1 : 0, Date.now()]
  );
}

export function mariaDeleteReviewLike(reviewId, userId) {
  queryMariaDb('DELETE FROM review_likes WHERE review_id = ? AND user_id = ?', [reviewId, userId]);
}

export function mariaSaveAchievement(ach) {
  queryMariaDb(
    `INSERT INTO user_achievements (user_id, achievement_id, progress, target, unlocked, unlocked_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       progress = VALUES(progress),
       target = VALUES(target),
       unlocked = VALUES(unlocked),
       unlocked_at = VALUES(unlocked_at)`,
    [
      ach.user_id,
      ach.achievement_id,
      ach.progress || 0,
      ach.target || 1,
      ach.unlocked ? 1 : 0,
      ach.unlocked_at || null
    ]
  );
}

export function mariaSaveWatchRoom(room) {
  queryMariaDb(
    `INSERT INTO watch_rooms (room_id, name, host_id, host_name, current_media_json, is_playing, \`current_time\`, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       host_id = VALUES(host_id),
       host_name = VALUES(host_name),
       current_media_json = VALUES(current_media_json),
       is_playing = VALUES(is_playing),
       \`current_time\` = VALUES(\`current_time\`),
       updated_at = VALUES(updated_at)`,
    [
      room.id,
      room.name,
      room.hostId || null,
      room.hostName || 'Гость',
      room.currentMedia ? JSON.stringify(room.currentMedia) : null,
      room.isPlaying ? 1 : 0,
      room.currentTime || 0.0,
      room.createdAt || Date.now(),
      Date.now()
    ]
  );
}

export function mariaDeleteWatchRoom(roomId) {
  queryMariaDb('DELETE FROM watch_rooms WHERE room_id = ?', [roomId]);
}

export function mariaSaveCache(source, cacheKey, dataJson, expiresAt) {
  queryMariaDb(
    `INSERT INTO media_cache (source, cache_key, data_json, expires_at)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       data_json = VALUES(data_json),
       expires_at = VALUES(expires_at)`,
    [source, cacheKey, dataJson, expiresAt]
  );
}

export function mariaDeleteCache(source, cacheKey) {
  queryMariaDb('DELETE FROM media_cache WHERE source = ? AND cache_key = ?', [source, cacheKey]);
}
