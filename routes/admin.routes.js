import express from 'express';
import { l1Cache } from '../services/lru-cache.js';
import { getBalancerHealthSnapshot, checkAllBalancersHealth, getPreferredBalancerOrder } from '../services/balancer-health.js';
import { getRecentLogs } from '../services/logger.js';
import { isMariaDbActive, getMariaDbHost } from '../mariadb.js';

export function createAdminRouter({ requireAdmin }) {
  const router = express.Router();

  router.get('/api/admin/balancers', requireAdmin, (req, res) => {
    res.json({
      success: true,
      preferredOrder: getPreferredBalancerOrder(),
      balancers: getBalancerHealthSnapshot()
    });
  });

  router.post('/api/admin/balancers/check', requireAdmin, async (req, res) => {
    try {
      const snapshot = await checkAllBalancersHealth();
      res.json({
        success: true,
        preferredOrder: getPreferredBalancerOrder(),
        balancers: snapshot
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/api/admin/cache-stats', requireAdmin, (req, res) => {
    res.json({
      success: true,
      l1Cache: l1Cache.getStats(),
      mariadb: {
        connected: isMariaDbActive(),
        host: getMariaDbHost()
      }
    });
  });

  router.post('/api/admin/cache-clear', requireAdmin, (req, res) => {
    l1Cache.clear();
    res.json({
      success: true,
      message: 'In-Memory L1 LRU ??? ??????? ??????',
      l1Cache: l1Cache.getStats()
    });
  });

  router.get('/api/admin/logs', requireAdmin, (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 200);
    res.json({
      success: true,
      logs: getRecentLogs(limit)
    });
  });

  return router;
}
