import express from 'express';
import {
  getUserStats,
  updateUserSettings,
  getUserBookmarks,
  getContinueWatching,
  getCustomLists,
  getUserFamilyProfiles,
  saveUserFamilyProfiles,
  getUserActiveSessions,
  revokeUserSessionByPrefix,
  logoutAllUserSessions,
  getUserTotpConfig,
  saveUserTotpConfig,
  setFamilyProfilePin,
  verifyFamilyProfilePin,
  getLatestHandoffState,
  getReleaseSubscriptions,
  getUserAchievements
} from '../db.js';
import {
  generateTotpSecret,
  generateTotpUri,
  verifyTotpCode,
  generateBackupCodes
} from '../services/totp-service.js';
import { sanitizeXSS } from '../middlewares/security.middleware.js';

export function createAuthRouter({ requireAuth }) {
  const router = express.Router();

  // Активные сессии и устройства (Пункт 3.10)
  router.get('/api/auth/sessions', requireAuth, (req, res) => {
    try {
      const currentPrefix = String(req.token || '').slice(0, 12);
      const sessions = getUserActiveSessions(req.user.id).map(s => ({
        ...s,
        isCurrent: s.token_prefix === currentPrefix
      }));
      res.json({ success: true, sessions });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/api/auth/sessions/revoke', requireAuth, (req, res) => {
    try {
      const { tokenPrefix, allOthers } = req.body || {};
      if (allOthers) {
        logoutAllUserSessions(req.user.id, req.token);
        return res.json({ success: true, message: 'Все остальные сессии завершены' });
      }
      if (!tokenPrefix) {
        return res.status(400).json({ error: 'Укажите идентификатор сессии' });
      }
      revokeUserSessionByPrefix(req.user.id, String(tokenPrefix));
      res.json({ success: true, revoked: tokenPrefix });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 2FA TOTP (Пункт 3.6)
  router.get('/api/auth/2fa/status', requireAuth, (req, res) => {
    try {
      const cfg = getUserTotpConfig(req.user.id);
      res.json({
        success: true,
        enabled: Boolean(cfg.enabled),
        backupCodesRemaining: (cfg.backupCodes || []).length
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/api/auth/2fa/setup', requireAuth, (req, res) => {
    try {
      const secret = generateTotpSecret(20);
      const otpauthUri = generateTotpUri({
        secret,
        accountName: req.user.username || req.user.email || 'user',
        issuer: 'STORM MULTIMEDIA'
      });
      const backupCodes = generateBackupCodes(8);
      saveUserTotpConfig(req.user.id, {
        enabled: false,
        secret,
        backupCodes
      });
      res.json({
        success: true,
        secret,
        otpauthUri,
        backupCodes
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/api/auth/2fa/verify', requireAuth, (req, res) => {
    try {
      const code = String(req.body?.code || '').trim();
      const cfg = getUserTotpConfig(req.user.id);
      if (!cfg.secret) {
        return res.status(400).json({ error: 'Сначала инициализируйте 2FA' });
      }
      const isValid = verifyTotpCode(cfg.secret, code, 1) || (cfg.backupCodes || []).includes(code.toUpperCase());
      if (!isValid) {
        return res.status(400).json({ error: 'Неверный код 2FA' });
      }
      const updatedCodes = (cfg.backupCodes || []).filter(c => c !== code.toUpperCase());
      saveUserTotpConfig(req.user.id, {
        enabled: true,
        secret: cfg.secret,
        backupCodes: updatedCodes
      });
      res.json({ success: true, enabled: true, message: 'Двухфакторная аутентификация (2FA TOTP) активирована' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/api/auth/2fa/disable', requireAuth, (req, res) => {
    try {
      saveUserTotpConfig(req.user.id, {
        enabled: false,
        secret: '',
        backupCodes: []
      });
      res.json({ success: true, enabled: false, message: 'Двухфакторная аутентификация отключена' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Мультипрофили, детский режим и PIN-код в БД (Пункт 2.6)
  router.post('/api/auth/family-profiles/pin', requireAuth, (req, res) => {
    try {
      const { profileId, pinCode, ageRating, kidsSafeMode, action } = req.body || {};
      if (!profileId) {
        return res.status(400).json({ error: 'Не указан ID семейного профиля' });
      }
      if (action === 'verify') {
        const result = verifyFamilyProfilePin(req.user.id, profileId, pinCode);
        if (!result.valid) {
          return res.status(403).json({ valid: false, error: 'Неверный PIN-код профиля' });
        }
        return res.json({ valid: true, profile: result.profile });
      }
      const profiles = setFamilyProfilePin(req.user.id, profileId, pinCode, ageRating, kidsSafeMode);
      res.json({ success: true, profiles });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Полное хранение всех настроек и состояния клиента строго в БД (Пункт 1.7 + Zero LocalStorage)
  router.get('/api/user/settings', (req, res) => {
    if (!req.user) {
      return res.json({ authenticated: false, settings: {}, kv: {} });
    }
    const settings = req.user.settings || {};
    res.json({
      authenticated: true,
      settings,
      kv: settings.kv_store || {}
    });
  });

  router.post('/api/user/settings', requireAuth, (req, res) => {
    try {
      const currentSettings = { ...(req.user.settings || {}) };
      const body = req.body || {};

      if (body.settings && typeof body.settings === 'object') {
        Object.assign(currentSettings, sanitizeXSS(body.settings));
      }
      if (body.kv && typeof body.kv === 'object') {
        const kvStore = { ...(currentSettings.kv_store || {}) };
        for (const [k, v] of Object.entries(body.kv)) {
          const safeKey = String(k).slice(0, 120);
          if (v === null || v === undefined) {
            delete kvStore[safeKey];
          } else {
            kvStore[safeKey] = typeof v === 'string' ? v.slice(0, 65536) : JSON.stringify(v).slice(0, 65536);
          }
        }
        currentSettings.kv_store = kvStore;
      }
      if (Array.isArray(body.homeRailsOrder)) {
        currentSettings.home_rails_order = body.homeRailsOrder.map(x => String(x).slice(0, 64)).slice(0, 30);
      }
      if (body.activeFamilyProfileId !== undefined) {
        currentSettings.active_family_profile_id = String(body.activeFamilyProfileId || 'main').slice(0, 64);
      }

      updateUserSettings(req.user.id, currentSettings);
      res.json({ success: true, settings: currentSettings });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Единый гидратор состояния из БД при старте (0 байт в localStorage)
  router.get('/api/user/bootstrap', (req, res) => {
    try {
      if (!req.user) {
        return res.json({
          authenticated: false,
          user: null,
          settings: {},
          kv: {},
          bookmarks: [],
          continueWatching: [],
          customLists: [],
          familyProfiles: [],
          handoff: null,
          subscriptions: [],
          achievements: []
        });
      }
      const userId = req.user.id;
      const settings = req.user.settings || {};
      const stats = getUserStats(userId);
      const bookmarks = getUserBookmarks(userId);
      const continueWatching = getContinueWatching(userId, 16);
      const customLists = getCustomLists(userId);
      const familyProfiles = getUserFamilyProfiles(userId);
      const handoff = getLatestHandoffState(userId, req.query.device || '');
      const subscriptions = getReleaseSubscriptions(userId);
      const sessions = getUserActiveSessions(userId);
      const achievements = getUserAchievements(userId);

      res.json({
        authenticated: true,
        user: req.user,
        stats,
        settings,
        kv: settings.kv_store || {},
        bookmarks,
        continueWatching,
        customLists,
        familyProfiles,
        handoff,
        subscriptions,
        achievements,
        activeSessionsCount: sessions.length
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
