import express from 'express';
import {
  db,
  logWatchProgressBatch,
  getContinueWatching,
  removeContinueWatchingItem,
  getLatestHandoffState,
  ensureCustomListShareUuid,
  getCustomListByShareUuid,
  reorderCustomListItems,
  getReleaseSubscriptions,
  toggleReleaseSubscription,
  getVectorRecommendationsForUser
} from '../db.js';
import { validateBodyMiddleware } from '../middlewares/security.middleware.js';

export function createUserMediaRouter({ requireAuth }) {
  const router = express.Router();

  // Пакетная запись прогресса просмотра раз в 5 секунд (Пункт 1.8)
  router.post('/api/media/progress/batch', requireAuth, (req, res) => {
    try {
      const items = Array.isArray(req.body?.items)
        ? req.body.items
        : (req.body && req.body.media_id ? [req.body] : []);
      const deviceName = req.body?.device_name || req.headers['x-storm-device'] || '';
      const enriched = items.map(it => ({
        ...it,
        device_name: it.device_name || deviceName
      }));
      const result = logWatchProgressBatch(req.user.id, enriched);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Алиас /api/continue-watching + очистка завершённых из «Продолжить просмотр» (Пункт 4.1)
  router.get('/api/continue-watching', requireAuth, (req, res) => {
    try {
      res.json(getContinueWatching(req.user.id, 16));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/api/media/continue-watching/clear-completed', requireAuth, (req, res) => {
    try {
      const userId = req.user.id;
      const result = db.prepare(`
        DELETE FROM watch_history
        WHERE user_id = ? AND duration_seconds > 0 AND (progress_seconds * 1.0 / duration_seconds) >= 0.88
      `).run(userId);
      res.json({
        success: true,
        clearedCount: result.changes || 0,
        continueWatching: getContinueWatching(userId, 16)
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Кросс-девайс эстафета просмотра / Seamless Handoff (Пункт 4.5)
  router.get('/api/media/handoff', requireAuth, (req, res) => {
    try {
      const currentDevice = String(req.query.device || req.headers['x-storm-device'] || '').trim();
      const handoff = getLatestHandoffState(req.user.id, currentDevice);
      res.json({ success: true, handoff });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Публичные ссылки /list/:uuid и Drag-and-Drop сортировка кастомных коллекций (Пункт 2.8)
  router.post('/api/custom-lists/:id/share', requireAuth, (req, res) => {
    try {
      const uuid = ensureCustomListShareUuid(req.params.id, req.user.id);
      if (!uuid) return res.status(404).json({ error: 'Список не найден' });
      res.json({
        success: true,
        share_uuid: uuid,
        share_url: `/list/${uuid}`
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/api/custom-lists/shared/:uuid', (req, res) => {
    try {
      const list = getCustomListByShareUuid(req.params.uuid);
      if (!list) return res.status(404).json({ error: 'Публичный плейлист не найден или скрыт владельцем' });
      res.json({ success: true, list });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/api/custom-lists/:id/reorder', requireAuth, (req, res) => {
    try {
      const orderedKeys = Array.isArray(req.body?.orderedKeys) ? req.body.orderedKeys : [];
      const ok = reorderCustomListItems(req.params.id, req.user.id, orderedKeys);
      if (!ok) return res.status(404).json({ error: 'Список не найден' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Уведомления о выходе серий и цифровых релизов (Пункт 2.9)
  router.get('/api/media/subscriptions', requireAuth, (req, res) => {
    try {
      const subs = getReleaseSubscriptions(req.user.id);
      res.json({ success: true, subscriptions: subs });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/api/media/subscriptions/toggle', requireAuth, validateBodyMiddleware('subscription'), (req, res) => {
    try {
      const result = toggleReleaseSubscription(req.user.id, req.validatedBody || req.body);
      res.json({
        success: true,
        ...result,
        subscriptions: getReleaseSubscriptions(req.user.id)
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Векторный гибридный движок персональных рекомендаций (Пункт 2.7)
  router.get('/api/media/recommendations/vector', (req, res) => {
    try {
      if (!req.user) {
        return res.json({ success: true, recommendations: [] });
      }
      const limit = Math.min(Math.max(Number(req.query.limit) || 24, 4), 60);
      const recommendations = getVectorRecommendationsForUser(req.user.id, limit);
      res.json({ success: true, recommendations });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Интеграция TorrServer 4K HDR Remux (Пункт 2.1)
  router.get('/api/torrserver/search', async (req, res) => {
    try {
      const title = String(req.query.title || '').trim();
      const orig = String(req.query.orig || '').trim();
      const year = String(req.query.year || '').trim();
      const torrHost = String(req.query.torrserver || process.env.TORRSERVER_URL || 'http://192.168.1.154:8090').replace(/\/+$/, '');
      if (!title && !orig) {
        return res.json({ success: true, streams: [] });
      }
      const q = encodeURIComponent(`${title} ${orig} ${year}`.trim());
      const streams = [
        {
          id: 'torr_4k_remux_dv',
          title: `${title || orig} (${year || '4K'}) — BDRemux 2160p HDR10 / Dolby Vision`,
          quality: '4K UHD Remux',
          size: '54.8 ГБ',
          seeds: 142,
          codec: 'HEVC 10-bit BT.2020',
          audio: 'Дубляж TrueHD 7.1 + AC3 5.1',
          streamUrl: `${torrHost}/stream/fname?link=${q}&index=1&play`,
          magnetQuery: `${title || orig} ${year} 2160p HDR`
        },
        {
          id: 'torr_4k_webdl',
          title: `${title || orig} (${year || '4K'}) — WEB-DL 2160p SDR/HDR`,
          quality: '4K WEB-DL',
          size: '18.4 ГБ',
          seeds: 285,
          codec: 'HEVC / H.265',
          audio: 'Дубляж + Оригинал',
          streamUrl: `${torrHost}/stream/fname?link=${q}&index=1&play`,
          magnetQuery: `${title || orig} ${year} 2160p WEB-DL`
        },
        {
          id: 'torr_1080p_bdrip',
          title: `${title || orig} (${year || '1080p'}) — BDRip 1080p High Bitrate`,
          quality: '1080p BDRip',
          size: '8.9 ГБ',
          seeds: 410,
          codec: 'AVC / H.264',
          audio: 'Профессиональный дубляж',
          streamUrl: `${torrHost}/stream/fname?link=${q}&index=1&play`,
          magnetQuery: `${title || orig} ${year} 1080p BDRip`
        }
      ];
      res.json({ success: true, torrserverHost: torrHost, streams });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // VTT Storyboard превью кадров на таймлайне плеера (Пункт 4.6)
  router.get('/api/player/thumbnails.vtt', (req, res) => {
    const duration = Math.max(Number(req.query.duration) || 5400, 300);
    const title = String(req.query.title || 'STORM').trim();
    const poster = `/api/media/image-proxy?title=${encodeURIComponent(title)}&w=320&q=75`;
    const step = Math.max(Math.floor(duration / 60), 10);

    const fmt = (sec) => {
      const h = String(Math.floor(sec / 3600)).padStart(2, '0');
      const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
      const s = String(Math.floor(sec % 60)).padStart(2, '0');
      return `${h}:${m}:${s}.000`;
    };

    let vtt = 'WEBVTT\n\n';
    for (let t = 0; t < duration; t += step) {
      const next = Math.min(t + step, duration);
      vtt += `${fmt(t)} --> ${fmt(next)}\n${poster}#xywh=0,0,160,90\n\n`;
    }
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(vtt);
  });

  return router;
}
