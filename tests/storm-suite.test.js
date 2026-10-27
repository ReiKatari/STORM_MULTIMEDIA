import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { StormLruCache } from '../services/lru-cache.js';
import {
  generateTotpSecret,
  generateTotpCode,
  verifyTotpCode,
  generateBackupCodes
} from '../services/totp-service.js';
import {
  validatePayload,
  sanitizeXSS,
  parseDeviceNameFromUserAgent
} from '../middlewares/security.middleware.js';
import {
  registerUser,
  loginUser,
  getUserActiveSessions,
  setBookmark,
  getUserBookmarks,
  logWatchProgressBatch,
  flushWatchProgressBatch,
  getContinueWatching,
  getLatestHandoffState,
  toggleReleaseSubscription,
  getReleaseSubscriptions,
  purgeUserData,
  deleteUserAccountById,
  closeMariaDbPool,
  db
} from '../db.js';

describe('STORM MULTIMEDIA 1.2.0 — Automated Quality & Security Suite', () => {
  after(async () => {
    try { flushWatchProgressBatch(); } catch (_) {}
    try { await closeMariaDbPool(); } catch (_) {}
  });

  it('1. 4K UHD vs Upcoming («Ожидается») strict mutual exclusion invariant', () => {
    function normalizeMediaAvailability(item, probeResult) {
      const out = { ...item };
      if (probeResult && probeResult.hasStream) {
        out.stream_verified = true;
        out.is_upcoming = false;
        const should4k = Boolean(out.source === 'tmdb' || out.source === 'fanfilm4k' || out.is4K);
        out.is4K = should4k;
        out.quality = should4k ? '4K Ultra HD' : '1080p FHD';
      } else {
        out.stream_verified = false;
        out.is_upcoming = true;
        out.is4K = false;
        out.quality = 'Ожидается';
      }
      return out;
    }

    const unverifiedFutureMovie = normalizeMediaAvailability(
      { id: 'future_1', title: 'Аватар 4', source: 'tmdb', is4K: true, quality: '4K Ultra HD' },
      { hasStream: false }
    );
    assert.equal(unverifiedFutureMovie.is_upcoming, true);
    assert.equal(unverifiedFutureMovie.is4K, false, 'Unverified movie MUST NEVER have is4K=true');
    assert.equal(unverifiedFutureMovie.quality, 'Ожидается', 'Unverified movie MUST display Ожидается');

    const verifiedMovie = normalizeMediaAvailability(
      { id: 'released_1', title: 'Дюна: Часть вторая', source: 'fanfilm4k', is4K: true },
      { hasStream: true }
    );
    assert.equal(verifiedMovie.is_upcoming, false);
    assert.equal(verifiedMovie.stream_verified, true);
    assert.equal(verifiedMovie.is4K, true);
    assert.equal(verifiedMovie.quality, '4K Ultra HD');
  });

  it('2. L1 In-Memory LRU Cache (StormLruCache) hit/miss, TTL & byte eviction', () => {
    const cache = new StormLruCache({ maxBytes: 1024 * 64, defaultTtlMs: 5000 });
    cache.set('catalog:popular:1', { items: [{ id: 1, title: 'Тест' }] });
    const hit = cache.get('catalog:popular:1');
    assert.ok(hit);
    assert.equal(hit.items[0].title, 'Тест');

    cache.invalidatePrefix('catalog:');
    assert.equal(cache.get('catalog:popular:1'), undefined);
    const stats = cache.getStats();
    assert.equal(stats.entries, 0);
  });

  it('3. RFC 6238 TOTP 2FA secret generation & code verification', () => {
    const secret = generateTotpSecret(20);
    assert.ok(secret.length >= 16);
    const now = Date.now();
    const code = generateTotpCode(secret, now);
    assert.match(code, /^\d{6}$/);
    assert.equal(verifyTotpCode(secret, code, 1, now), true);
    assert.equal(verifyTotpCode(secret, '000000', 0, now) && code !== '000000', false);
    const backup = generateBackupCodes(6);
    assert.equal(backup.length, 6);
  });

  it('4. Schema validation & XSS sanitization block malicious payloads', () => {
    const dirty = '<script>alert(1)</script><img src=x onerror="alert(2)">Привет';
    const clean = sanitizeXSS(dirty);
    assert.equal(clean.includes('<script'), false);
    assert.equal(clean.includes('onerror='), false);
    assert.ok(clean.includes('Привет'));

    const validProgress = validatePayload('progress', {
      media_id: 'movie_123',
      title: 'Интерстеллар',
      progress_seconds: 1250,
      duration_seconds: 7200
    });
    assert.equal(validProgress.valid, true);
    assert.equal(validProgress.data.progress_seconds, 1250);

    const invalidProgress = validatePayload('progress', {
      media_id: '',
      title: ''
    });
    assert.equal(invalidProgress.valid, false);
    assert.equal(parseDeviceNameFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0'), 'Windows • Chrome');
  });

  it('5. Multi-user Anti-IDOR isolation, scrypt auth, batch progress & Handoff in DB', () => {
    const suffix = Date.now();
    const u1 = registerUser(`test_u1_${suffix}`, `u1_${suffix}@storm.test`, 'StrongPass#123', null, {
      ipAddress: '127.0.0.1',
      deviceName: 'Smart TV Living Room'
    });
    const u2 = registerUser(`test_u2_${suffix}`, `u2_${suffix}@storm.test`, 'StrongPass#456', null, {
      ipAddress: '127.0.0.2',
      deviceName: 'iPhone 16 Pro'
    });

    assert.equal(u1.token.length, 128, '64-byte token must be 128 hex chars');
    assert.notEqual(u1.user.id, u2.user.id);

    const relogin1 = loginUser(`test_u1_${suffix}`, 'StrongPass#123', { deviceName: 'Windows PC' });
    assert.equal(relogin1.user.id, u1.user.id);

    const sessions1 = getUserActiveSessions(u1.user.id);
    assert.ok(sessions1.length >= 2);

    // Запись закладок и пакетного прогресса для u1
    setBookmark(u1.user.id, {
      media_id: 'test_cyber_movie_2026',
      source: 'tmdb',
      media_type: 'movie',
      title: 'Тестовый Кибер-Фильм',
      status: 'watching'
    });
    // 1) Проверка правила 10 минут: перемотка на 1840 сек при реальном просмотре 120 сек (< 600 сек) НЕ должна попадать в Continue Watching
    logWatchProgressBatch(u1.user.id, [{
      media_id: 'test_cyber_movie_2026',
      source: 'tmdb',
      media_type: 'movie',
      title: 'Тестовый Кибер-Фильм',
      progress_seconds: 1840,
      real_watched_seconds: 120,
      duration_seconds: 5400,
      device_name: 'Smart TV Living Room'
    }]);
    assert.equal(getContinueWatching(u1.user.id, 10).some(x => x.media_id === 'test_cyber_movie_2026'), false, 'Scrubbed video (< 10 min real watch time) must NOT enter Continue Watching');

    // 2) Реальный просмотр >= 600 сек (15 минут = 900 сек) попадает в Continue Watching
    logWatchProgressBatch(u1.user.id, [{
      media_id: 'test_cyber_movie_2026',
      source: 'tmdb',
      media_type: 'movie',
      title: 'Тестовый Кибер-Фильм',
      progress_seconds: 1840,
      real_watched_seconds: 900,
      duration_seconds: 5400,
      device_name: 'Smart TV Living Room'
    }]);
    flushWatchProgressBatch();

    // Проверка 100% изоляции: у u2 НЕ должно быть закладок или «Продолжить просмотр» от u1!
    const cw1 = getContinueWatching(u1.user.id, 10);
    const cw2 = getContinueWatching(u2.user.id, 10);
    assert.equal(cw1.some(x => x.media_id === 'test_cyber_movie_2026'), true);
    assert.equal(cw2.some(x => x.media_id === 'test_cyber_movie_2026'), false, 'User 2 MUST NOT see User 1 Continue Watching');

    const bm2 = getUserBookmarks(u2.user.id);
    assert.equal(bm2.length, 0, 'User 2 MUST NOT see User 1 Bookmarks');

    // Проверка кросс-девайс эстафеты (Handoff)
    const handoff = getLatestHandoffState(u1.user.id, 'Windows PC');
    assert.ok(handoff);
    assert.equal(handoff.media_id, 'test_cyber_movie_2026');
    assert.equal(handoff.device_name, 'Smart TV Living Room');

    // Проверка подписок на выход серий
    const subRes = toggleReleaseSubscription(u1.user.id, {
      media_id: 'one_piece_ep',
      source: 'anixart',
      media_type: 'anime',
      title: 'Ван-Пис',
      last_known_episode: 1122
    });
    assert.equal(subRes.subscribed, true);
    assert.equal(getReleaseSubscriptions(u1.user.id).length, 1);

    // Очистка тестовых пользователей
    deleteUserAccountById(u1.user.id);
    deleteUserAccountById(u2.user.id);
  });
});
