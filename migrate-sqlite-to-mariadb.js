import { db } from './db.js';
import mysql from 'mysql2/promise';

async function migrate() {
  const pool = mysql.createPool({
    host: '192.168.1.154',
    port: 3306,
    user: 'ReiKatari',
    password: 'SeR1eNi!2Ty9kP',
    database: 'stormmultimedia',
    waitForConnections: true,
    connectionLimit: 10
  });

  console.log('--- Начинаем синхронизацию данных в MariaDB 10 ---');

  // 1. Achievements
  const achs = db.prepare('SELECT * FROM user_achievements').all();
  console.log(`Переносим достижения: ${achs.length} шт.`);
  for (const a of achs) {
    await pool.query(
      `INSERT INTO user_achievements (user_id, achievement_id, progress, target, unlocked, unlocked_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE progress = VALUES(progress), target = VALUES(target), unlocked = VALUES(unlocked), unlocked_at = VALUES(unlocked_at)`,
      [a.user_id, a.achievement_id, a.progress, a.target, a.unlocked, a.unlocked_at]
    );
  }

  // 2. Watch rooms
  const rooms = db.prepare('SELECT * FROM watch_rooms').all();
  console.log(`Переносим комнаты просмотра: ${rooms.length} шт.`);
  for (const r of rooms) {
    await pool.query(
      `INSERT INTO watch_rooms (room_id, name, host_id, host_name, current_media_json, is_playing, current_time, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), host_id = VALUES(host_id), host_name = VALUES(host_name), current_media_json = VALUES(current_media_json), is_playing = VALUES(is_playing), current_time = VALUES(current_time), updated_at = VALUES(updated_at)`,
      [r.room_id, r.name, r.host_id, r.host_name, r.current_media_json, r.is_playing ? 1 : 0, r.current_time || 0, r.created_at, r.updated_at]
    );
  }

  // 3. Media cache (valid non-expired)
  const now = Date.now();
  const cacheItems = db.prepare('SELECT source, cache_key, data_json, expires_at FROM media_cache WHERE expires_at > ?').all(now);
  console.log(`Переносим актуальный кэш медиа: ${cacheItems.length} шт.`);
  for (const c of cacheItems) {
    await pool.query(
      `INSERT INTO media_cache (source, cache_key, data_json, expires_at)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE data_json = VALUES(data_json), expires_at = VALUES(expires_at)`,
      [c.source, c.cache_key, c.data_json, c.expires_at]
    );
  }

  const [aCnt] = await pool.query('SELECT COUNT(*) as c FROM user_achievements');
  const [rCnt] = await pool.query('SELECT COUNT(*) as c FROM watch_rooms');
  const [cCnt] = await pool.query('SELECT COUNT(*) as c FROM media_cache');
  console.log(`Итого в MariaDB: достижения: ${aCnt[0].c}, комнаты: ${rCnt[0].c}, кэш: ${cCnt[0].c}`);

  await pool.end();
}

migrate().catch(console.error);
