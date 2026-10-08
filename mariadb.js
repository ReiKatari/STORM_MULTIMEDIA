import mysql from 'mysql2/promise';

let pool = null;
let activeHost = null;
let isConnected = false;
let syncInProgress = false;

const DB_CONFIG = {
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'ReiKatari',
  password: process.env.DB_PASS || 'SeR1eNi!2Ty9kP',
  database: process.env.DB_NAME || 'stormmultimedia',
  waitForConnections: true,
  connectionLimit: 15,
  connectTimeout: 3000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000
};

/**
 * Инициализация пула соединений MariaDB 10 с автоматическим переключением хостов
 */
export async function initMariaDb() {
  if (pool && isConnected) return pool;

  const candidateHosts = [
    process.env.DB_HOST || '127.0.0.1',
    process.env.DB_HOST_FALLBACK || '192.168.1.154'
  ];

  // Убираем дубликаты
  const uniqueHosts = Array.from(new Set(candidateHosts.filter(Boolean)));

  for (const host of uniqueHosts) {
    try {
      const candidatePool = mysql.createPool({
        ...DB_CONFIG,
        host
      });

      // Проверка пинга
      const [rows] = await candidatePool.query('SELECT 1 AS ok');
      if (rows && rows.length > 0) {
        pool = candidatePool;
        activeHost = host;
        isConnected = true;
        console.log(`[MariaDB 10] Успешное подключение к базе данных '${DB_CONFIG.database}' на ${host}:${DB_CONFIG.port}`);
        return pool;
      }
    } catch (err) {
      console.warn(`[MariaDB 10] Хост ${host}:${DB_CONFIG.port} недоступен (${err.code || err.message}). Пробуем следующий...`);
    }
  }

  console.warn('[MariaDB 10] Внимание: ни один из хостов MariaDB не ответил. Будет задействован автономный SQLite режим.');
  isConnected = false;
  return null;
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
    // Попытка ленивого подключения
    try {
      await initMariaDb();
    } catch (_) {}
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
 * Синхронизация данных из MariaDB в локальный SQLite (на старте или по расписанию)
 */
export async function syncFromMariaDbToSqlite(sqliteDb) {
  if (!pool || !isConnected || syncInProgress) return;
  syncInProgress = true;

  try {
    // 1. Синхронизация пользователей
    const [mUsers] = await pool.query('SELECT * FROM users');
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

    // 2. Синхронизация сессий
    const now = Date.now();
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

    // 3. Синхронизация закладок
    const [mBookmarks] = await pool.query('SELECT * FROM bookmarks');
    if (mBookmarks) {
      // Очищаем локальные закладки, если в MariaDB они были удалены
      const mBookmarkIds = new Set(mBookmarks.map(b => b.id));
      const localBookmarks = sqliteDb.prepare('SELECT id FROM bookmarks').all();
      for (const lb of localBookmarks) {
        if (!mBookmarkIds.has(lb.id)) {
          sqliteDb.prepare('DELETE FROM bookmarks WHERE id = ?').run(lb.id);
        }
      }

      const upsertBookmark = sqliteDb.prepare(`
        INSERT INTO bookmarks (
          id, user_id, media_id, source, title, original_title, poster_url, media_type,
          year, status, is_favorite, episodes_watched, total_episodes, progress_percent,
          last_time_seconds, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          user_id = excluded.user_id,
          media_id = excluded.media_id,
          source = excluded.source,
          title = excluded.title,
          original_title = excluded.original_title,
          poster_url = excluded.poster_url,
          media_type = excluded.media_type,
          year = excluded.year,
          status = excluded.status,
          is_favorite = excluded.is_favorite,
          episodes_watched = excluded.episodes_watched,
          total_episodes = excluded.total_episodes,
          progress_percent = excluded.progress_percent,
          last_time_seconds = excluded.last_time_seconds,
          updated_at = excluded.updated_at
      `);

      for (const b of mBookmarks) {
        upsertBookmark.run(
          b.id,
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
          Number(b.updated_at)
        );
      }
    }

    // 4. Синхронизация кастомных списков и элементов
    const [mLists] = await pool.query('SELECT * FROM custom_lists');
    if (mLists) {
      const mListIds = new Set(mLists.map(l => l.id));
      const localLists = sqliteDb.prepare('SELECT id FROM custom_lists').all();
      for (const ll of localLists) {
        if (!mListIds.has(ll.id)) {
          sqliteDb.prepare('DELETE FROM custom_lists WHERE id = ?').run(ll.id);
        }
      }

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
        const mItemIds = new Set(mItems.map(i => i.id));
        const localItems = sqliteDb.prepare('SELECT id FROM custom_list_items').all();
        for (const li of localItems) {
          if (!mItemIds.has(li.id)) {
            sqliteDb.prepare('DELETE FROM custom_list_items WHERE id = ?').run(li.id);
          }
        }

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
      const mHistIds = new Set(mHistory.map(h => h.id));
      const localHist = sqliteDb.prepare('SELECT id FROM watch_history').all();
      for (const lh of localHist) {
        if (!mHistIds.has(lh.id)) {
          sqliteDb.prepare('DELETE FROM watch_history WHERE id = ?').run(lh.id);
        }
      }

      const upsertHist = sqliteDb.prepare(`
        INSERT INTO watch_history (
          id, user_id, media_id, source, title, poster_url, media_type, year,
          season, episode, time_seconds, duration_seconds, progress_percent, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          media_type = excluded.media_type,
          year = excluded.year,
          season = excluded.season,
          episode = excluded.episode,
          time_seconds = excluded.time_seconds,
          duration_seconds = excluded.duration_seconds,
          progress_percent = excluded.progress_percent,
          updated_at = excluded.updated_at
      `);
      for (const h of mHistory) {
        upsertHist.run(
          h.id,
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
    }

    // 6. Синхронизация достижений
    const [mAchievements] = await pool.query('SELECT * FROM user_achievements');
    if (mAchievements) {
      const upsertAch = sqliteDb.prepare(`
        INSERT INTO user_achievements (id, user_id, achievement_id, progress, target, unlocked, unlocked_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, achievement_id) DO UPDATE SET
          progress = excluded.progress,
          target = excluded.target,
          unlocked = excluded.unlocked,
          unlocked_at = excluded.unlocked_at
      `);
      for (const a of mAchievements) {
        upsertAch.run(
          a.id,
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
// WRITE-THROUGH ОПЕРАЦИИ ДЛЯ MARIADB 10
// ==========================================

export function mariaSaveUser(user) {
  queryMariaDb(
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
  queryMariaDb(
    `INSERT INTO sessions (token, user_id, expires_at)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at)`,
    [token, userId, expiresAt]
  );
}

export function mariaDeleteSession(token) {
  queryMariaDb('DELETE FROM sessions WHERE token = ?', [token]);
}

export function mariaDeleteUserSessions(userId) {
  queryMariaDb('DELETE FROM sessions WHERE user_id = ?', [userId]);
}

export function mariaSaveBookmark(b) {
  queryMariaDb(
    `INSERT INTO bookmarks (
       id, user_id, media_id, source, title, original_title, poster_url, media_type,
       year, status, is_favorite, episodes_watched, total_episodes, progress_percent,
       last_time_seconds, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       title = VALUES(title),
       original_title = VALUES(original_title),
       poster_url = VALUES(poster_url),
       media_type = VALUES(media_type),
       year = VALUES(year),
       status = VALUES(status),
       is_favorite = VALUES(is_favorite),
       episodes_watched = VALUES(episodes_watched),
       total_episodes = VALUES(total_episodes),
       progress_percent = VALUES(progress_percent),
       last_time_seconds = VALUES(last_time_seconds),
       updated_at = VALUES(updated_at)`,
    [
      b.id || null,
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
      b.updated_at || Date.now()
    ]
  );
}

export function mariaDeleteBookmark(userId, mediaId, source, matchedIds = []) {
  if (matchedIds && matchedIds.length > 0) {
    const placeholders = matchedIds.map(() => '?').join(',');
    queryMariaDb(`DELETE FROM bookmarks WHERE id IN (${placeholders})`, matchedIds);
  } else {
    queryMariaDb(
      'DELETE FROM bookmarks WHERE user_id = ? AND (media_id = ? OR media_id = ?) AND source = ?',
      [userId, String(mediaId), String(mediaId).replace(/^[a-z]+_/, ''), source]
    );
  }
}

export function mariaSaveWatchHistory(h) {
  queryMariaDb(
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
  queryMariaDb('DELETE FROM bookmarks WHERE user_id = ?', [userId]);
  queryMariaDb('DELETE FROM watch_history WHERE user_id = ?', [userId]);
  queryMariaDb(
    `DELETE FROM custom_list_items WHERE list_id IN (
       SELECT id FROM custom_lists WHERE user_id = ?
     )`,
    [userId]
  );
  queryMariaDb('DELETE FROM custom_lists WHERE user_id = ?', [userId]);
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
