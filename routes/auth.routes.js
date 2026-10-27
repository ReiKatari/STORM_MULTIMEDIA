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
  getUserAchievements,
  getSavedAccountsByTokens,
  removeAccountFromDeviceVault,
  ensureUserRecoveryConfig,
  regenerateUserRecoveryCodes,
  saveUserRecoveryTelegram,
  createTelegramPasswordResetOtp,
  resetUserPasswordWithCode
} from '../db.js';
import {
  generateTotpSecret,
  generateTotpUri,
  verifyTotpCode,
  generateBackupCodes
} from '../services/totp-service.js';
import {
  sanitizeXSS,
  parseVaultTokensFromReq,
  setSecureSessionCookie,
  setVaultCookieOnly,
  clearSecureSessionCookie,
  parseDeviceNameFromUserAgent
} from '../middlewares/security.middleware.js';
import { dispatchTelegramNotification } from '../services/release-notifier.js';

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


  // =========================================================================
  // БЫСТРОЕ ПЕРЕКЛЮЧЕНИЕ АККАУНТОВ (ACCOUNT SWITCHER)
  // =========================================================================
  router.get('/api/auth/saved-accounts', (req, res) => {
    try {
      const { accounts, validTokens } = getSavedAccountsByTokens(
        [req.token, ...parseVaultTokensFromReq(req)],
        req.user?.id || null
      );
      res.json({
        success: true,
        currentUserId: req.user?.id || null,
        accounts,
        vaultTokens: validTokens
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/api/auth/switch-account', (req, res) => {
    try {
      const targetUserId = Number(req.body?.userId || 0);
      if (!targetUserId) {
        return res.status(400).json({ error: 'Не указан ID аккаунта для переключения' });
      }
      const extraClientTokens = Array.isArray(req.body?.vaultTokens) ? req.body.vaultTokens : [];
      const { validPairs, validTokens } = getSavedAccountsByTokens(
        [req.token, ...parseVaultTokensFromReq(req), ...extraClientTokens],
        targetUserId
      );
      const match = validPairs.find(p => Number(p.user.id) === targetUserId);
      if (!match) {
        return res.status(404).json({ error: 'Сессия этого аккаунта истекла. Пожалуйста, войдите по паролю.' });
      }
      setSecureSessionCookie(res, match.token, req, validTokens);
      const stats = getUserStats(match.user.id);
      const accounts = validPairs.map(({ user }) => ({
        id: user.id,
        username: user.username,
        email: user.email,
        avatar: user.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(user.username)}`,
        role: user.role || 'user',
        created_at: user.created_at,
        isCurrent: Number(user.id) === targetUserId
      }));
      res.json({
        success: true,
        token: match.token,
        user: match.user,
        stats,
        savedAccounts: accounts,
        vaultTokens: validTokens
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/api/auth/saved-accounts/remove', (req, res) => {
    try {
      const targetUserId = Number(req.body?.userId || 0);
      if (!targetUserId) {
        return res.status(400).json({ error: 'Не указан ID аккаунта' });
      }
      const extraClientTokens = Array.isArray(req.body?.vaultTokens) ? req.body.vaultTokens : [];
      const remainingTokens = removeAccountFromDeviceVault(
        targetUserId,
        [req.token, ...parseVaultTokensFromReq(req), ...extraClientTokens]
      );
      const isRemovingCurrent = req.user && Number(req.user.id) === targetUserId;
      if (isRemovingCurrent) {
        clearSecureSessionCookie(res, req, remainingTokens);
      } else {
        setVaultCookieOnly(res, remainingTokens, req);
      }
      const { accounts, validTokens } = getSavedAccountsByTokens(
        remainingTokens,
        isRemovingCurrent ? null : (req.user?.id || null)
      );
      res.json({
        success: true,
        removedCurrent: Boolean(isRemovingCurrent),
        accounts,
        vaultTokens: validTokens
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // =========================================================================
  // ВОССТАНОВЛЕНИЕ ПАРОЛЯ ЧЕРЕЗ РЕЗЕРВНЫЙ КОД ИЛИ TELEGRAM-БОТА
  // =========================================================================
  router.get('/api/auth/recovery/config', requireAuth, (req, res) => {
    try {
      const cfg = ensureUserRecoveryConfig(req.user.id);
      res.json({
        success: true,
        ...cfg,
        telegramBotConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN)
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/api/auth/recovery/regenerate-codes', requireAuth, (req, res) => {
    try {
      const recoveryCodes = regenerateUserRecoveryCodes(req.user.id);
      res.json({
        success: true,
        recoveryCodes,
        message: 'Новые резервные коды восстановления сгенерированы'
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/api/auth/recovery/telegram', requireAuth, async (req, res) => {
    try {
      const chatId = String(req.body?.telegramChatId || '').trim();
      const sendTest = Boolean(req.body?.sendTest);
      const savedChatId = saveUserRecoveryTelegram(req.user.id, chatId);
      let testSent = false;
      if (sendTest && savedChatId) {
        testSent = await dispatchTelegramNotification(
          savedChatId,
          `🛡️ <b>STORM MULTIMEDIA</b>\nВаш Telegram успешно привязан к аккаунту <b>${req.user.username}</b> для мгновенного восстановления пароля и уведомлений о премьерах!`
        );
      }
      res.json({
        success: true,
        telegramChatId: savedChatId,
        testSent,
        telegramBotConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
        message: savedChatId
          ? (sendTest
              ? (testSent ? 'Telegram привязан, тестовое сообщение доставлено!' : 'Telegram Chat ID сохранён в профиле (для доставки сообщений укажите TELEGRAM_BOT_TOKEN на сервере)')
              : 'Telegram Chat ID успешно сохранён в профиле')
          : 'Привязка Telegram Chat ID очищена'
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/api/auth/password/request-telegram', async (req, res) => {
    try {
      const login = String(req.body?.login || '').trim();
      const { user, telegramChatId, code } = createTelegramPasswordResetOtp(login);
      const delivered = await dispatchTelegramNotification(
        telegramChatId,
        `🔑 <b>STORM MULTIMEDIA — Восстановление пароля</b>\n\nАккаунт: <b>${user.username}</b>\nОдноразовый код сброса пароля: <code>${code}</code>\n\n⏳ Код действителен в течение 10 минут.`
      );
      if (!delivered) {
        return res.status(400).json({
          error: 'Не удалось отправить сообщение через Telegram Bot API (проверьте TELEGRAM_BOT_TOKEN или используйте один из 8 резервных кодов восстановления / 2FA TOTP).'
        });
      }
      res.json({
        success: true,
        message: `Одноразовый 6-значный код отправлен в привязанный Telegram для «${user.username}»`
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/api/auth/password/reset-confirm', (req, res) => {
    try {
      const { login, code, newPassword } = req.body || {};
      const ua = String(req.headers['user-agent'] || '');
      const { session, methodUsed } = resetUserPasswordWithCode(
        login,
        code,
        newPassword,
        verifyTotpCode,
        {
          ipAddress: req.ip || '',
          userAgent: ua,
          deviceName: parseDeviceNameFromUserAgent(ua)
        }
      );
      const vaultRes = getSavedAccountsByTokens([session.token, ...parseVaultTokensFromReq(req)], session.user.id);
      setSecureSessionCookie(res, session.token, req, vaultRes.validTokens);
      res.json({
        success: true,
        methodUsed,
        token: session.token,
        user: session.user,
        savedAccounts: vaultRes.accounts,
        vaultTokens: vaultRes.validTokens,
        message: `Пароль для «${session.user.username}» успешно обновлён!`
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
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
        const serverAchs = getUserAchievements(req.user.id);
        const serverUnlockedIds = new Set(serverAchs.filter(a => a && a.unlocked).map(a => String(a.id)));

        for (const [k, v] of Object.entries(body.kv)) {
          const safeKey = String(k).slice(0, 120);
          if (v === null || v === undefined) {
            if (safeKey === 'storm_toasted_achievements_v1' || safeKey === 'storm_local_achievements') continue;
            delete kvStore[safeKey];
          } else if (safeKey === 'storm_toasted_achievements_v1') {
            const mergedToast = new Set(serverUnlockedIds);
            try {
              const prevArr = JSON.parse(kvStore.storm_toasted_achievements_v1 || '[]');
              if (Array.isArray(prevArr)) prevArr.forEach(id => { if (id) mergedToast.add(String(id)); });
            } catch (_) {}
            try {
              const nextArr = typeof v === 'string' ? JSON.parse(v) : v;
              if (Array.isArray(nextArr)) nextArr.forEach(id => { if (id) mergedToast.add(String(id)); });
            } catch (_) {}
            kvStore.storm_toasted_achievements_v1 = JSON.stringify(Array.from(mergedToast));
          } else if (safeKey === 'storm_local_achievements') {
            let prevMap = {};
            let nextMap = {};
            try { prevMap = JSON.parse(kvStore.storm_local_achievements || '{}') || {}; } catch (_) {}
            try { nextMap = (typeof v === 'string' ? JSON.parse(v) : v) || {}; } catch (_) {}
            const mergedMap = { ...prevMap, ...nextMap };
            for (const a of serverAchs) {
              const prevEntry = prevMap[a.id];
              const nextEntry = nextMap[a.id];
              const isUnl = Boolean(a.unlocked || prevEntry?.unlocked || nextEntry?.unlocked);
              const maxProg = Math.min(a.target || 1, Math.max(a.progress || 0, prevEntry?.progress || 0, nextEntry?.progress || 0));
              mergedMap[a.id] = {
                progress: isUnl ? (a.target || 1) : maxProg,
                target: a.target || 1,
                unlocked: isUnl,
                unlocked_at: prevEntry?.unlocked_at || nextEntry?.unlocked_at || a.unlocked_at || (isUnl ? Date.now() : null)
              };
            }
            kvStore.storm_local_achievements = JSON.stringify(mergedMap);
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
      const vaultBootstrap = getSavedAccountsByTokens([req.token, ...parseVaultTokensFromReq(req)], req.user?.id || null);
      if (!req.user) {
        return res.json({
          authenticated: false,
          user: null,
          savedAccounts: vaultBootstrap.accounts,
          vaultTokens: vaultBootstrap.validTokens,
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
      const kvOut = { ...(settings.kv_store || {}) };
      try {
        const toastedSet = new Set();
        try {
          const prevT = JSON.parse(kvOut.storm_toasted_achievements_v1 || '[]');
          if (Array.isArray(prevT)) prevT.forEach(id => { if (id) toastedSet.add(String(id)); });
        } catch (_) {}
        let localAchMap = {};
        try { localAchMap = JSON.parse(kvOut.storm_local_achievements || '{}') || {}; } catch (_) {}
        for (const a of achievements) {
          if (!a || !a.id) continue;
          const isUnl = Boolean(a.unlocked || (a.target > 0 && a.progress >= a.target));
          localAchMap[a.id] = {
            progress: isUnl ? (a.target || 1) : Math.max(a.progress || 0, localAchMap[a.id]?.progress || 0),
            target: a.target || 1,
            unlocked: isUnl,
            unlocked_at: localAchMap[a.id]?.unlocked_at || a.unlocked_at || (isUnl ? Date.now() : null)
          };
          if (isUnl) toastedSet.add(String(a.id));
        }
        kvOut.storm_local_achievements = JSON.stringify(localAchMap);
        kvOut.storm_toasted_achievements_v1 = JSON.stringify(Array.from(toastedSet));
      } catch (_) {}

      res.json({
        authenticated: true,
        token: req.token || null,
        user: req.user,
        stats,
        settings,
        kv: kvOut,
        bookmarks,
        continueWatching,
        customLists,
        familyProfiles,
        handoff,
        subscriptions,
        achievements,
        activeSessionsCount: sessions.length,
        savedAccounts: vaultBootstrap.accounts,
        vaultTokens: vaultBootstrap.validTokens
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
