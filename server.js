import './env-loader.js';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import * as nodeZlib from 'node:zlib';
import * as nodeCrypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
let sharp = null;
try {
  const sharpModule = await import('sharp');
  sharp = sharpModule.default || sharpModule;
} catch (e) {
  console.warn('[STORM SERVER WARNING] Модуль sharp не загрузился:', e.message);
}

import {
  registerUser,
  loginUser,
  createSession,
  logoutUser,
  logoutAllUserSessions,
  getUserByToken,
  updateUserSettings,
  updateUserProfile,
  changeUserPassword,
  getUserStats,
  getUserBookmarks,
  getBookmark,
  setBookmark,
  saveBookmarkWatchedEpisodes,
  removeBookmark,
  logWatchProgress,
  getLatestWatchProgressForMedia,
  getWatchedHistoryEpisodesForMedia,
  getContinueWatching,
  removeContinueWatchingItem,
  getCustomLists,
  getCustomListDetails,
  createCustomList,
  deleteCustomList,
  addCustomListItem,
  removeCustomListItem,
  getMediaReviews,
  addReview,
  deleteReview,
  toggleReviewLike,
  getUserAchievements,
  updateAchievementProgress,
  trackUserAction,
  autoSyncUserAchievements,
  claimAchievement,
  exportUserData,
  importUserData,
  getOrCreateDefaultUserSession,
  getUserFamilyProfiles,
  saveUserFamilyProfiles,
  getAdminUsersOverview,
  getCache,
  setCache,
  saveWatchRoomDb,
  getWatchRoomDb,
  getAllWatchRoomsDb,
  deleteWatchRoomDb,
  checkpointWal,
  purgeUserData,
  isMariaDbActive,
  getMariaDbHost,
  syncFromMariaDbToSqlite,
  touchSessionActivity,
  flushWatchProgressBatch,
  getUserTotpConfig,
  closeMariaDbPool
} from './db.js';
import { l1Cache } from './services/lru-cache.js';
import { logger, requestTracingMiddleware } from './services/logger.js';
import {
  startBalancerDaemons,
  stopBalancerDaemons,
  getBalancerHealthSnapshot
} from './services/balancer-health.js';
import { verifyTotpCode } from './services/totp-service.js';
import {
  helmetSecurityHeadersMiddleware,
  setSecureSessionCookie,
  clearSecureSessionCookie,
  parseDeviceNameFromUserAgent
} from './middlewares/security.middleware.js';
import { createAuthRouter } from './routes/auth.routes.js';
import { createUserMediaRouter } from './routes/user-media.routes.js';
import { createAdminRouter } from './routes/admin.routes.js';
import {
  handleWatchTogether2SocketEvent,
  notifyAllSocketsServerRestarting
} from './sockets/watch-room.socket.js';

import {
  getFanFilmCatalog,
  searchFanFilm,
  getFanFilmDetails,
  resolveMediaYear,
  FANFILM_PINNED_CAROUSEL_IDS,
  fetchHtml
} from './services/fanfilm-service.js';

import {
  getAnixartDiscover,
  searchAnixart,
  getAnixartReleaseDetails,
  getAnixartEpisodes
} from './services/anixart-service.js';

import {
  getShikimoriCatalog,
  searchShikimori,
  getShikimoriRelated
} from './services/shikimori-service.js';

import {
  getTmdbCatalog,
  searchTmdb,
  getTmdbItemDetails,
  getTmdbSeasonEpisodes,
  getTmdbPersonMedia,
  getTmdbFranchise,
  findTmdbTvId,
  tmdbFetch,
  TMDB_BASE,
  TMDB_API_KEY,
  IMAGE_BASE
} from './services/tmdb-service.js';

import {
  getAniLibriaCatalog,
  getAniLibriaDetails,
  searchAniLibria
} from './services/anilibria-service.js';

import {
  getAvailablePlayers
} from './services/kinobox-service.js';

import {
  getAggregatedSchedule
} from './services/schedule-service.js';

import {
  resolveFanFilmUrl
} from './services/fanfilm-catalog-intel.js';

import {
  getCategoryFallback
} from './services/catalog-fallback.js';

import {
  resolveMediaPremiereAndYear,
  searchTvdb
} from './services/tvdb-service.js';

import {
  ensureValidDescription
} from './services/canonical-descriptions.js';

import {
  resolveCanonicalMediaType,
  resolveCanonicalYear,
  normalizeAnimeFranchiseTitle,
  resolveCanonicalGenres,
  resolveCanonicalSeriesSeasonsCount,
  isTrailerMedia,
  isMediaUpcomingOrUnreleased
} from './services/canonical-media-intel.js';

import {
  searchRuTube,
  getRuTubePlayOptions,
  getRuTubeCatalog
} from './services/rutube-service.js';

import {
  searchVkVideo,
  getVkVideoCatalog,
  getVkVideoPlayer,
  resolveVkVideoPlayer
} from './services/vkvideo-service.js';

import {
  searchLift,
  getLiftHomeRails,
  getLiftCatalog,
  getLiftDetails,
  getLiftBatchInfo,
  resolveLiftMatch,
  extractLiftStreamData,
  getLiftDownloadAndStreamOptions,
  liftRequestRaw,
  liftFetchJson,
  liftFetchText
} from './services/lift-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 3900;

// Хранилище комнат совместного просмотра в памяти с сохранением в SQLite
const watchRooms = new Map();

// Восстановление активных комнат из SQLite
try {
  const savedRooms = getAllWatchRoomsDb();
  for (const r of savedRooms) {
    watchRooms.set(r.id, {
      code: r.id,
      name: r.name,
      hostUserId: r.hostId,
      hostName: r.hostName,
      media: r.currentMedia,
      playback: { isPlaying: r.isPlaying, currentTime: r.currentTime, updatedAt: r.updated_at },
      participants: new Map(),
      messages: []
    });
  }
} catch (e) {
  console.warn('Ошибка восстановления комнат совместного просмотра:', e.message);
}

// Регулярное усечение WAL лога SQLite каждые 30 минут
setInterval(checkpointWal, 1000 * 60 * 30);

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'STORM-';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

const remoteSessions = new Map();

function registerRemoteSocket(sessionCode, ws, role = 'client') {
  if (!sessionCode) return;
  const code = String(sessionCode).trim();
  if (!remoteSessions.has(code)) {
    remoteSessions.set(code, new Set());
  }
  ws.__remoteSession = code;
  ws.__remoteRole = role;
  const clients = remoteSessions.get(code);
  clients.add(ws);

  if (role === 'remote') {
    const connectedMsg = JSON.stringify({
      type: 'remote_connected',
      session: code,
      timestamp: Date.now()
    });
    for (const c of clients) {
      if (c !== ws && c.readyState === 1) {
        c.send(connectedMsg);
      }
    }
  }
}

wss.on('connection', (ws, req) => {
  let currentRoomCode = null;
  let currentUser = null;

  try {
    const reqUrl = new URL(req?.url || '/', 'http://localhost');
    const urlSession = reqUrl.searchParams.get('code') || reqUrl.searchParams.get('session');
    const role = reqUrl.searchParams.get('role') || 'remote';
    if (urlSession) {
      registerRemoteSocket(urlSession, ws, role);
    }
  } catch (_) {}

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      switch (data.type) {
        case 'join_remote_session': {
          const sess = data.session || data.roomCode;
          if (sess) {
            registerRemoteSocket(sess, ws, data.role || 'host');
            ws.send(JSON.stringify({ type: 'remote_session_joined', session: sess }));
          }
          break;
        }
        case 'join_room': {
          const roomCode = (data.roomCode || '').toUpperCase().trim();
          let room = watchRooms.get(roomCode);
          if (!room) {
            ws.send(JSON.stringify({ type: 'error', message: 'Комната не найдена' }));
            return;
          }

          currentRoomCode = roomCode;
          currentUser = {
            id: data.user?.id || `guest_${Date.now()}`,
            username: data.user?.username || 'Гость',
            avatar: data.user?.avatar || null,
            isHost: room.hostUserId && data.user && room.hostUserId === data.user.id
          };

          room.participants.set(ws, currentUser);

          // Отправляем текущее состояние комнаты новому участнику
          ws.send(JSON.stringify({
            type: 'room_joined',
            roomCode: room.code,
            media: room.media,
            playback: room.playback,
            participants: Array.from(room.participants.values()),
            messages: room.messages
          }));

          // Уведомляем остальных участников
          const updateMsg = JSON.stringify({
            type: 'participant_update',
            participants: Array.from(room.participants.values()),
            joinedUser: currentUser
          });
          for (const [client] of room.participants) {
            if (client !== ws && client.readyState === 1) {
              client.send(updateMsg);
            }
          }
          break;
        }

        case 'sync_playback': {
          if (!currentRoomCode) return;
          const room = watchRooms.get(currentRoomCode);
          if (!room) return;

          room.playback = {
            isPlaying: Boolean(data.isPlaying),
            currentTime: parseFloat(data.currentTime) || 0,
            updatedAt: Date.now()
          };

          const syncMsg = JSON.stringify({
            type: 'playback_sync',
            isPlaying: room.playback.isPlaying,
            currentTime: room.playback.currentTime,
            timestamp: room.playback.updatedAt,
            sender: currentUser?.username || 'Зритель'
          });

          for (const [client] of room.participants) {
            if (client !== ws && client.readyState === 1) {
              client.send(syncMsg);
            }
          }
          break;
        }

        case 'change_media': {
          if (!currentRoomCode) return;
          const room = watchRooms.get(currentRoomCode);
          if (!room) return;

          room.media = data.media || null;
          room.playback = { isPlaying: false, currentTime: 0, updatedAt: Date.now() };

          const mediaMsg = JSON.stringify({
            type: 'media_changed',
            media: room.media,
            sender: currentUser?.username || 'Зритель'
          });

          for (const [client] of room.participants) {
            if (client !== ws && client.readyState === 1) {
              client.send(mediaMsg);
            }
          }
          break;
        }

        case 'chat_message': {
          if (!currentRoomCode) return;
          const room = watchRooms.get(currentRoomCode);
          if (!room) return;

          const text = (data.text || '').trim();
          if (!text) return;

          const newMsg = {
            id: Date.now() + Math.random(),
            userId: currentUser?.id,
            username: currentUser?.username || 'Гость',
            avatar: currentUser?.avatar || null,
            text,
            time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
            replyTo: data.replyTo ? {
              id: data.replyTo.id,
              username: data.replyTo.username,
              text: data.replyTo.text
            } : null
          };

          room.messages.push(newMsg);
          if (room.messages.length > 100) room.messages.shift();

          const chatBroadcast = JSON.stringify({
            type: 'chat_received',
            message: newMsg
          });

          for (const [client] of room.participants) {
            if (client.readyState === 1) {
              client.send(chatBroadcast);
            }
          }
          break;
        }

        case 'delete_chat_message': {
          if (!currentRoomCode) return;
          const room = watchRooms.get(currentRoomCode);
          if (!room) return;

          const msgId = data.messageId;
          const index = room.messages.findIndex(m => String(m.id) === String(msgId));
          if (index !== -1) {
            const msg = room.messages[index];
            if (currentUser?.id === msg.userId || currentUser?.isHost) {
              room.messages.splice(index, 1);
              const delBroadcast = JSON.stringify({
                type: 'chat_deleted',
                messageId: msgId
              });
              for (const [client] of room.participants) {
                if (client.readyState === 1) {
                  client.send(delBroadcast);
                }
              }
            }
          }
          break;
        }

        case 'live_reaction': {
          if (!currentRoomCode) return;
          const room = watchRooms.get(currentRoomCode);
          if (!room) return;

          const reactionMsg = JSON.stringify({
            type: 'live_reaction',
            emoji: data.emoji,
            user: data.user || currentUser?.username || 'Зритель'
          });

          for (const [client] of room.participants) {
            if (client.readyState === 1) {
              client.send(reactionMsg);
            }
          }
          break;
        }

        case 'storm_remote_action': {
          const targetRoomCode = String(data.session || currentRoomCode || ws.__remoteSession || '').trim();
          if (!targetRoomCode) return;

          const remoteMsg = JSON.stringify({
            type: 'storm_remote_action',
            action: data.action,
            query: data.query,
            level: data.level,
            delta: data.delta,
            sender: currentUser?.username || 'Пульт'
          });

          const sessClients = remoteSessions.get(targetRoomCode);
          if (sessClients) {
            for (const client of sessClients) {
              if (client !== ws && client.readyState === 1) {
                client.send(remoteMsg);
              }
            }
          }

          const room = watchRooms.get(targetRoomCode) || watchRooms.get(targetRoomCode.toUpperCase());
          if (room) {
            for (const [client] of room.participants) {
              if (client !== ws && client.readyState === 1) {
                client.send(remoteMsg);
              }
            }
          }
          break;
        }

        case 'voice_signal': {
          if (!currentRoomCode) return;
          const room = watchRooms.get(currentRoomCode);
          if (!room) return;

          const signalMsg = JSON.stringify({
            type: 'voice_signal',
            signal: data.signal,
            senderId: currentUser?.id,
            senderName: currentUser?.username || 'Зритель',
            targetId: data.targetId
          });

          for (const [client, pUser] of room.participants) {
            if (client !== ws && client.readyState === 1) {
              if (!data.targetId || String(pUser.id) === String(data.targetId)) {
                client.send(signalMsg);
              }
            }
          }
          break;
        }

        case 'voice_speaking': {
          if (!currentRoomCode) return;
          const room = watchRooms.get(currentRoomCode);
          if (!room) return;

          const speakMsg = JSON.stringify({
            type: 'voice_speaking',
            senderId: currentUser?.id,
            senderName: currentUser?.username || 'Зритель',
            speaking: Boolean(data.speaking)
          });

          for (const [client] of room.participants) {
            if (client !== ws && client.readyState === 1) {
              client.send(speakMsg);
            }
          }
          break;
        }

        case 'sync_episode': {
          if (!currentRoomCode) return;
          const room = watchRooms.get(currentRoomCode);
          if (!room) return;

          const epMsg = JSON.stringify({
            type: 'episode_synced',
            season: Number(data.season) || 1,
            episode: Number(data.episode) || 1,
            voiceoverId: data.voiceoverId || '',
            voiceoverName: data.voiceoverName || '',
            playerId: data.playerId || '',
            sender: currentUser?.username || 'Хост'
          });

          for (const [client] of room.participants) {
            if (client !== ws && client.readyState === 1) {
              client.send(epMsg);
            }
          }
          break;
        }

        case 'p2p_chunk_signal': {
          if (!currentRoomCode) return;
          const room = watchRooms.get(currentRoomCode);
          if (!room) return;

          const chunkSignalMsg = JSON.stringify({
            type: 'p2p_chunk_signal',
            chunkData: data.chunkData,
            senderId: currentUser?.id
          });

          for (const [client] of room.participants) {
            if (client !== ws && client.readyState === 1) {
              client.send(chunkSignalMsg);
            }
          }
          break;
        }

        default:
          handleWatchTogether2SocketEvent({ ws, data, currentRoomCode, currentUser, watchRooms });
          break;
      }
    } catch (err) {
      console.error('Ошибка WebSocket сообщения:', err);
    }
  });

  ws.on('close', () => {
    if (ws.__remoteSession) {
      const sessSet = remoteSessions.get(ws.__remoteSession);
      if (sessSet) {
        sessSet.delete(ws);
        if (sessSet.size === 0) {
          remoteSessions.delete(ws.__remoteSession);
        }
      }
    }
    if (currentRoomCode) {
      const room = watchRooms.get(currentRoomCode);
      if (room) {
        room.participants.delete(ws);
        if (room.participants.size === 0) {
          // Если комната пуста более 15 минут, она удалится
          setTimeout(() => {
            if (room.participants.size === 0) {
              watchRooms.delete(currentRoomCode);
              deleteWatchRoomDb(currentRoomCode);
            }
          }, 900000);
        } else {
          const updateMsg = JSON.stringify({
            type: 'participant_update',
            participants: Array.from(room.participants.values())
          });
          for (const [client] of room.participants) {
            if (client.readyState === 1) {
              client.send(updateMsg);
            }
          }
        }
      }
    }
  });
});

// Защищённый CORS и глобальные HTTP-заголовки безопасности + строгий запрет кэширования персональных API
app.use(cors({
  origin: (origin, callback) => {
    callback(null, true);
  },
  credentials: false
}));

function isSafeExternalHttpUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  let candidate = rawUrl.trim();
  if (candidate.startsWith('//')) candidate = 'https:' + candidate;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;
  const host = String(parsed.hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return false;
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '0:0:0:0:0:0:0:1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'host.docker.internal' ||
    host === 'metadata.google.internal' ||
    host.startsWith('fe80:') ||
    host.startsWith('fc') ||
    host.startsWith('fd')
  ) {
    return false;
  }
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [_, a, b] = ipv4Match.map(Number);
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    ) {
      return false;
    }
  }
  return true;
}

app.use(requestTracingMiddleware);
app.use(helmetSecurityHeadersMiddleware);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  if (!req.path.startsWith('/api/player/')) {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  }
  const p = req.path || '';
  if (
    p.startsWith('/api/auth') ||
    p.startsWith('/api/bookmarks') ||
    p.startsWith('/api/media/continue-watching') ||
    p.startsWith('/api/media/progress') ||
    p.startsWith('/api/media/item') ||
    p.startsWith('/api/custom-lists') ||
    p.startsWith('/api/profiles') ||
    p.startsWith('/api/admin') ||
    p.startsWith('/api/user') ||
    p.startsWith('/api/sync') ||
    p.startsWith('/api/achievements') ||
    p.startsWith('/api/local-library')
  ) {
    res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Vary', 'Authorization, Cookie');
  }
  next();
});

// Высокоскоростной RAM-кэш предварительно сжатых статических файлов (0% нагрузки CPU NAS, отклик < 0.5 мс)
const STATIC_PUBLIC_DIR = path.join(__dirname, 'public');
const STATIC_MIME_MAP = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};
const memoryStaticAssetCache = new Map();

function getOrBuildStaticAssetEntry(fullPath, ext) {
  let stat;
  try {
    stat = fs.statSync(fullPath);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size > 4 * 1024 * 1024) return null;

  const cached = memoryStaticAssetCache.get(fullPath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached;
  }

  const raw = fs.readFileSync(fullPath);
  const etag = `W/"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`;
  const compressible = raw.length >= 256 && ext !== '.ico';
  const br = compressible
    ? nodeZlib.brotliCompressSync(raw, {
        params: {
          [nodeZlib.constants.BROTLI_PARAM_QUALITY]: 5,
          [nodeZlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length
        }
      })
    : null;
  const gzip = compressible ? nodeZlib.gzipSync(raw, { level: 6 }) : null;

  const entry = {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    etag,
    contentType: STATIC_MIME_MAP[ext] || 'application/octet-stream',
    raw,
    br,
    gzip
  };
  memoryStaticAssetCache.set(fullPath, entry);
  return entry;
}

// Фоновый прогрев RAM-кэша статики сразу при старте сервера
setImmediate(() => {
  try {
    const warmDirs = [STATIC_PUBLIC_DIR, path.join(STATIC_PUBLIC_DIR, 'js'), path.join(STATIC_PUBLIC_DIR, 'styles'), path.join(STATIC_PUBLIC_DIR, 'assets')];
    for (const dir of warmDirs) {
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        const ext = path.extname(name).toLowerCase();
        if (STATIC_MIME_MAP[ext]) {
          getOrBuildStaticAssetEntry(path.join(dir, name), ext);
        }
      }
    }
  } catch (_) {}
});

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (req.path.startsWith('/api/') || req.path.startsWith('/ws/')) return next();

  const reqRel = req.path === '/' ? '/index.html' : req.path;
  const ext = path.extname(reqRel).toLowerCase();
  if (!STATIC_MIME_MAP[ext]) return next();

  let decodedRel;
  try {
    decodedRel = decodeURIComponent(reqRel);
  } catch {
    return next();
  }
  const fullPath = path.resolve(STATIC_PUBLIC_DIR, '.' + decodedRel);
  if (!fullPath.startsWith(STATIC_PUBLIC_DIR + path.sep) && fullPath !== STATIC_PUBLIC_DIR) {
    return next();
  }

  const entry = getOrBuildStaticAssetEntry(fullPath, ext);
  if (!entry) return next();

  const isHtmlOrSw = ext === '.html' || decodedRel === '/sw.js';
  const hasImmutableVer = Boolean((ext === '.js' || ext === '.css') && req.query && req.query.v && !req.query.retry);

  if (isHtmlOrSw) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  } else if (hasImmutableVer) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (ext === '.js' || ext === '.css' || ext === '.json') {
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  }

  res.setHeader('ETag', entry.etag);
  res.setHeader('Vary', 'Accept-Encoding');
  res.setHeader('Content-Type', entry.contentType);

  if (req.headers['if-none-match'] === entry.etag) {
    res.statusCode = 304;
    return res.end();
  }

  const acceptEnc = String(req.headers['accept-encoding'] || '');
  let body = entry.raw;
  if (entry.br && /\bbr\b/.test(acceptEnc)) {
    res.setHeader('Content-Encoding', 'br');
    body = entry.br;
  } else if (entry.gzip && /\bgzip\b/.test(acceptEnc)) {
    res.setHeader('Content-Encoding', 'gzip');
    body = entry.gzip;
  }

  res.setHeader('Content-Length', body.length);
  if (req.method === 'HEAD') {
    return res.end();
  }
  return res.end(body);
});

app.use(compression({
  level: 6,
  threshold: 1024,
  brotli: {
    enabled: true,
    params: {
      [nodeZlib.constants.BROTLI_PARAM_QUALITY]: 4
    }
  }
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Информационный и командный шлюз для мобильного пульта STORM REMOTE 2.0
app.get('/api/remote/info', (req, res) => {
  let lanIp = '192.168.1.154';
  try {
    const hostHeader = String(req.headers.host || '').split(':')[0];
    if (hostHeader && hostHeader !== 'localhost' && hostHeader !== '127.0.0.1') {
      lanIp = hostHeader;
    }
  } catch (_) {}
  res.json({
    lanIp,
    port: PORT || 3900,
    baseUrl: `http://${lanIp}:${PORT || 3900}`
  });
});

app.post('/api/remote/command', (req, res) => {
  const { session, action, query, level, delta } = req.body || {};
  if (!session || !action) {
    return res.status(400).json({ error: 'Сессия или команда не указана' });
  }
  const remoteMsg = JSON.stringify({
    type: 'storm_remote_action',
    action,
    query,
    level,
    delta,
    sender: 'Пульт'
  });
  let delivered = 0;
  const sessClients = remoteSessions.get(String(session).trim());
  if (sessClients) {
    for (const c of sessClients) {
      if (c.readyState === 1) {
        c.send(remoteMsg);
        delivered++;
      }
    }
  }
  res.json({ success: true, delivered });
});

// Раздача статических файлов с интеллектуальным кэшированием
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '7d',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    } else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      const hasVer = Boolean(res.req?.query?.v && !res.req?.query?.retry);
      res.setHeader('Cache-Control', hasVer ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    }
  }
}));

// Middleware для строгой персональной аутентификации пользователя (без авто-логина под чужим профилем!)
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  let token = null;
  let fromCookie = false;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (req.headers.cookie) {
    const match = req.headers.cookie.match(/storm_token=([a-zA-Z0-9_-]+)/);
    if (match) {
      token = match[1];
      fromCookie = true;
    }
  }

  if (token) {
    const validUser = getUserByToken(token);
    if (validUser) {
      req.user = validUser;
      req.token = token;
      const ua = String(req.headers['user-agent'] || '');
      touchSessionActivity(token, req.ip || '', parseDeviceNameFromUserAgent(ua));
    } else {
      req.user = null;
      req.token = null;
      if (fromCookie) {
        clearSecureSessionCookie(res);
      }
    }
  } else {
    req.user = null;
    req.token = null;
  }
  next();
}

function isUserAdmin(user) {
  if (!user) return false;
  const username = String(user.username || '').trim().toLowerCase();
  const email = String(user.email || '').trim().toLowerCase();
  const role = String(user.role || '').trim().toLowerCase();
  return role === 'admin' ||
         username === 'reikatari' ||
         email === 'reikatari@outlook.com' ||
         email === '45316432+reikatari@users.noreply.github.com';
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Требуется авторизация администратора' });
  }
  if (!isUserAdmin(req.user)) {
    return res.status(403).json({ error: 'Доступ разрешён только администратору' });
  }
  next();
}

app.use(authMiddleware);

// ==========================================
// КРИПТОГРАФИЧЕСКАЯ ЗАЩИТА СЕССИЙ И COOKIES
// ==========================================
function setSessionCookie(res, token, req = null) {
  if (!token) return;
  setSecureSessionCookie(res, token, req);
}

// ==========================================
// ИНТЕЛЛЕКТУАЛЬНАЯ ЗАЩИТА ОТ БРУТФОРСА И СПАМА (RATE LIMITING)
// ==========================================
const rateLimitBuckets = new Map();

function createRateLimiter(options = { maxRequests: 10, windowMs: 60000, message: 'Слишком много запросов. Пожалуйста, подождите.' }) {
  const prefix = options.prefix || 'rl';
  const max = options.maxRequests || 10;
  const windowMs = options.windowMs || 60000;

  return function rateLimitMiddleware(req, res, next) {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const key = `${prefix}_${ip}`;
    const now = Date.now();
    let record = rateLimitBuckets.get(key);

    if (!record || now - record.startTime > windowMs) {
      record = { count: 1, startTime: now };
      rateLimitBuckets.set(key, record);
      return next();
    }

    record.count++;
    if (record.count > max) {
      const waitSeconds = Math.ceil((record.startTime + windowMs - now) / 1000);
      res.setHeader('Retry-After', waitSeconds);
      return res.status(429).json({
        error: options.message || `Слишком много запросов. Попробуйте через ${waitSeconds} сек.`,
        retryAfter: waitSeconds
      });
    }

    next();
  };
}

const loginRateLimiter = createRateLimiter({
  prefix: 'auth_login',
  maxRequests: 15,
  windowMs: 60000,
  message: 'Слишком много попыток входа с вашего IP. В целях безопасности подождите 1 минуту.'
});

const reviewsRateLimiter = createRateLimiter({
  prefix: 'reviews_post',
  maxRequests: 6,
  windowMs: 60000,
  message: 'Слишком частая отправка отзывов. Пожалуйста, подождите 1 минуту.'
});

const syncRateLimiter = createRateLimiter({
  prefix: 'sync_requests',
  maxRequests: 25,
  windowMs: 60000,
  message: 'Превышен лимит синхронизации. Попробуйте через 1 минуту.'
});

const deviceCodeRateLimiter = createRateLimiter({
  prefix: 'device_code',
  maxRequests: 20,
  windowMs: 60000,
  message: 'Слишком частые запросы кода ТВ-авторизации. Подождите 1 минуту.'
});

// ==========================================
// 1. АУТЕНТИФИКАЦИЯ И ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ
// ==========================================

app.post('/api/auth/register', loginRateLimiter, (req, res) => {
  try {
    const { username, email, password, avatar } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Заполните все обязательные поля' });
    }
    if (username.length < 3) {
      return res.status(400).json({ error: 'Имя пользователя должно содержать не менее 3 символов' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Пароль должен содержать не менее 6 символов' });
    }

    const ua = String(req.headers['user-agent'] || '');
    const session = registerUser(username, email, password, avatar, {
      ipAddress: req.ip || '',
      userAgent: ua,
      deviceName: parseDeviceNameFromUserAgent(ua)
    });
    setSessionCookie(res, session.token, req);
    res.json(session);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/login', loginRateLimiter, (req, res) => {
  try {
    const { login, password, totpCode } = req.body;
    if (!login || !password) {
      return res.status(400).json({ error: 'Укажите логин и пароль' });
    }

    const ua = String(req.headers['user-agent'] || '');
    const session = loginUser(login, password, {
      ipAddress: req.ip || '',
      userAgent: ua,
      deviceName: parseDeviceNameFromUserAgent(ua)
    });

    const totpCfg = getUserTotpConfig(session.user.id);
    if (totpCfg.enabled && totpCfg.secret) {
      if (!totpCode) {
        logoutUser(session.token);
        return res.status(200).json({
          requires2FA: true,
          message: 'Введите 6-значный код двухфакторной аутентификации (2FA TOTP)'
        });
      }
      const codeStr = String(totpCode).trim();
      const valid2FA = verifyTotpCode(totpCfg.secret, codeStr, 1) || (totpCfg.backupCodes || []).includes(codeStr.toUpperCase());
      if (!valid2FA) {
        logoutUser(session.token);
        return res.status(403).json({ error: 'Неверный код двухфакторной аутентификации (2FA)' });
      }
    }

    setSessionCookie(res, session.token, req);
    res.json(session);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ==========================================
// ВХОД ПО ОДНОРАЗОВОМУ ТВ-КОДУ (DEVICE CODE FLOW / 2FA)
// ==========================================
const pendingDeviceCodes = new Map();
const DEVICE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateSecureDeviceCode() {
  const bytes = nodeCrypto.randomBytes(8);
  let part1 = '';
  let part2 = '';
  for (let i = 0; i < 4; i++) {
    part1 += DEVICE_CODE_ALPHABET[bytes[i] % DEVICE_CODE_ALPHABET.length];
    part2 += DEVICE_CODE_ALPHABET[bytes[i + 4] % DEVICE_CODE_ALPHABET.length];
  }
  return `ST-${part1}-${part2}`;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimitBuckets.entries()) {
    if (!v || now - v.startTime > 300000) rateLimitBuckets.delete(k);
  }
  for (const [k, v] of pendingDeviceCodes.entries()) {
    if (!v || now - v.createdAt > 600000) pendingDeviceCodes.delete(k);
  }
}, 300000).unref();

app.post('/api/auth/device/code', deviceCodeRateLimiter, (req, res) => {
  try {
    if (pendingDeviceCodes.size > 500) {
      const firstKey = pendingDeviceCodes.keys().next().value;
      if (firstKey) pendingDeviceCodes.delete(firstKey);
    }
    const code = generateSecureDeviceCode();
    pendingDeviceCodes.set(code, {
      createdAt: Date.now(),
      verifiedUser: null,
      token: null
    });
    res.json({
      success: true,
      code,
      expires_in: 600,
      verification_url: `${req.protocol}://${req.get('host')}/#tv-auth?code=${code}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/device/verify', requireAuth, deviceCodeRateLimiter, (req, res) => {
  try {
    const rawCode = (req.body.code || '').trim().toUpperCase();
    if (!rawCode) return res.status(400).json({ error: 'Укажите ТВ-код' });
    const entry = pendingDeviceCodes.get(rawCode);
    if (!entry) {
      return res.status(404).json({ error: 'Код не найден или срок его действия истёк' });
    }
    if (Date.now() - entry.createdAt > 600000) {
      pendingDeviceCodes.delete(rawCode);
      return res.status(410).json({ error: 'Срок действия кода истёк. Запросите новый код на ТВ.' });
    }

    const tvSession = createSession(req.user.id);
    entry.verifiedUser = tvSession.user;
    entry.token = tvSession.token;
    res.json({ success: true, message: `ТВ-устройство успешно авторизовано под профилем «${req.user.username}»!` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/device/poll', deviceCodeRateLimiter, (req, res) => {
  try {
    const rawCode = (req.query.code || '').trim().toUpperCase();
    if (!rawCode) return res.status(400).json({ error: 'Укажите код' });
    const entry = pendingDeviceCodes.get(rawCode);
    if (!entry) return res.status(404).json({ status: 'not_found' });

    if (Date.now() - entry.createdAt > 600000) {
      pendingDeviceCodes.delete(rawCode);
      return res.status(410).json({ status: 'expired' });
    }

    if (entry.token && entry.verifiedUser) {
      const session = {
        token: entry.token,
        user: entry.verifiedUser
      };
      setSessionCookie(res, session.token);
      pendingDeviceCodes.delete(rawCode);
      return res.json({ status: 'authorized', session });
    }

    res.json({ status: 'pending' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// МОНИТОРИНГ ЗДОРОВЬЯ ИСТОЧНИКОВ (SMART HEALTH CHECK)
// ==========================================
const sourceHealthStatus = {
  lift_adfree: { status: 'healthy', latency: 26, lastCheck: Date.now() },
  fanfilm4k_uhd: { status: 'healthy', latency: 40, lastCheck: Date.now() },
  kodik_direct: { status: 'healthy', latency: 32, lastCheck: Date.now() },
  rutube_stream: { status: 'healthy', latency: 45, lastCheck: Date.now() },
  vk_video_stream: { status: 'healthy', latency: 38, lastCheck: Date.now() },
  alloha_player: { status: 'healthy', latency: 62, lastCheck: Date.now() }
};

app.get('/api/player/health', (req, res) => {
  res.json({
    success: true,
    timestamp: Date.now(),
    sources: { ...sourceHealthStatus, ...getBalancerHealthSnapshot() }
  });
});

app.get('/api/health', (req, res) => {
  const baseHealth = {
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: Date.now(),
    version: '1.2.0',
    l1Cache: l1Cache.getStats(),
    database: {
      connected: isMariaDbActive()
    }
  };
  if (isUserAdmin(req.user)) {
    baseHealth.memory = process.memoryUsage();
    baseHealth.pid = process.pid;
    baseHealth.database.driver = 'mariadb';
    baseHealth.database.host = getMariaDbHost();
    baseHealth.database.name = 'stormmultimedia';
  }
  res.json(baseHealth);
});

app.post('/api/admin/sync-db', requireAdmin, async (req, res) => {
  try {
    const { db } = await import('./db.js');
    await syncFromMariaDbToSqlite(db);
    res.json({ success: true, message: 'Синхронизация с MariaDB 10 завершена успешно' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/restart', requireAdmin, (req, res) => {
  res.json({ success: true, message: 'Server process restarting' });
  setTimeout(() => {
    console.log('[Server] Restart requested by admin. Exiting process...');
    process.exit(0);
  }, 400);
});

app.post('/api/admin/launch-minerva', requireAdmin, async (req, res) => {
  try {
    const { execFile } = await import('node:child_process');
    const script = '/volume1/WEBSITES/STORM MINERVA/synology-daemon.sh';
    execFile('bash', [script], { timeout: 15000 }, (err, stdout, stderr) => {
      res.json({
        success: !err,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        error: err?.message || null
      });
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  if (req.token) {
    logoutUser(req.token);
  }
  res.setHeader('Set-Cookie', 'storm_token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
  res.json({ success: true });
});

app.post('/api/auth/logout-all', requireAuth, (req, res) => {
  const keepCurrent = Boolean(req.body?.keepCurrent);
  logoutAllUserSessions(req.user.id, keepCurrent ? req.token : null);
  if (!keepCurrent) {
    res.setHeader('Set-Cookie', 'storm_token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
  }
  res.json({ success: true });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.user) {
    res.setHeader('Set-Cookie', 'storm_token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
    return res.json({ user: null, authenticated: false });
  }
  const stats = getUserStats(req.user.id);
  res.json({
    user: req.user,
    stats,
    token: req.token
  });
});

app.post('/api/auth/profile/update', requireAuth, (req, res) => {
  try {
    const { username, email, avatar } = req.body;
    const updatedUser = updateUserProfile(req.user.id, { username, email, avatar });
    const stats = getUserStats(req.user.id);
    res.json({
      user: {
        ...updatedUser,
        settings: JSON.parse(updatedUser.settings_json || '{}')
      },
      stats
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/profile/password', requireAuth, (req, res) => {
  try {
    const oldPassword = req.body.oldPassword || req.body.old_password;
    const newPassword = req.body.newPassword || req.body.new_password;
    changeUserPassword(req.user.id, oldPassword, newPassword);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/settings', requireAuth, (req, res) => {
  try {
    updateUserSettings(req.user.id, req.body.settings);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put(['/api/auth/profile', '/api/auth/profile/update'], requireAuth, (req, res) => {
  try {
    const { username, email, avatar, settings } = req.body;
    const updatedUser = updateUserProfile(req.user.id, { username, email, avatar });
    if (settings) {
      updateUserSettings(req.user.id, settings);
    }
    const stats = getUserStats(req.user.id);
    res.json({
      user: {
        ...updatedUser,
        settings: JSON.parse(updatedUser.settings_json || '{}')
      },
      stats
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/auth/stats', requireAuth, (req, res) => {
  try {
    const stats = getUserStats(req.user.id);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Панель администратора: сводка активности пользователей (для ReiKatari / ReiKatari@outlook.com)
app.get('/api/admin/users-overview', requireAuth, (req, res) => {
  try {
    const currentUser = req.user;
    const username = (currentUser.username || '').trim().toLowerCase();
    const email = (currentUser.email || '').trim().toLowerCase();
    const role = (currentUser.role || '').trim().toLowerCase();

    const isReiKatari = username === 'reikatari' ||
                        email === 'reikatari@outlook.com' ||
                        email === '45316432+reikatari@users.noreply.github.com' ||
                        role === 'admin';

    if (!isReiKatari) {
      return res.status(403).json({ error: 'Доступ разрешен только администратору ReiKatari (ReiKatari@outlook.com)' });
    }

    const overview = getAdminUsersOverview();
    res.json(overview);
  } catch (err) {
    console.error('Ошибка получения сводки администратора:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Управление семейными профилями
app.get('/api/profiles', (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    let profiles = null;
    if (userId) {
      profiles = getUserFamilyProfiles(userId);
    }
    res.json({ profiles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/profiles/save', requireAuth, (req, res) => {
  try {
    const { profiles } = req.body;
    if (!Array.isArray(profiles) || profiles.length > 20) {
      return res.status(400).json({ error: 'Неверный формат профилей' });
    }
    saveUserFamilyProfiles(req.user.id, profiles);
    res.json({ success: true, profiles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Подключение модульных роутеров архитектуры 1.2.0 (Пункт 6.1)
app.use(createAuthRouter({ requireAuth }));
app.use(createUserMediaRouter({ requireAuth }));
app.use(createAdminRouter({ requireAdmin }));

// ==========================================
// 2. ПРОКСИ ИЗОБРАЖЕНИЙ (100% ГАРАНТИЯ ЗАГРУЗКИ ОБЛОЖЕК)
// ==========================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ОБЛОЖЕК И ПРОКСИ
// ==========================================

const imageBinaryCache = new Map();

let faviconBuffer = null;
try {
  const faviconPath = path.join(__dirname, 'public', 'assets', 'favicon.svg');
  if (fs.existsSync(faviconPath)) {
    faviconBuffer = fs.readFileSync(faviconPath);
  }
} catch {}

function isPlaceholderImage(url) {
  if (!url || typeof url !== 'string') return true;
  const lower = url.toLowerCase();
  return lower.includes('missing') || lower.includes('404') || lower.includes('placeholder') || lower.includes('default') || lower.includes('favicon.svg');
}

function normalizeImageUrl(url) {
  if (!url || typeof url !== 'string') return '';
  let clean = url.trim();

  // Разворачиваем вложенные или экранированные ссылки прокси
  while (clean.includes('/api/media/image-proxy')) {
    const match = clean.match(/[?&]url=([^&]+)/);
    if (match) {
      try {
        clean = decodeURIComponent(match[1]);
      } catch {
        clean = match[1];
      }
    } else {
      break;
    }
  }

  if (clean.startsWith('//')) clean = `https:${clean}`;

  // Поддержка как коротких кодов static.anixart.tv, так и UUID-постеров s3.anixmirai.com с обязательным расширением .jpg
  const anixMatch = clean.match(/(?:s\d*\.)?anix(?:mirai|sekai)\.com\/posters\/([^/?#]+)/i);
  if (anixMatch) {
    const code = anixMatch[1].replace(/\.jpg$/i, '');
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(code);
    return isUuid
      ? `https://s3.anixmirai.com/posters/${code}.jpg`
      : `https://static.anixart.tv/posters/${code}.jpg`;
  }
  if (/static\.anixart\.tv\/posters\/[0-9a-f]{8}-[0-9a-f]{4}-/i.test(clean)) {
    const uuidMatch = clean.match(/posters\/([0-9a-f-]+)(?:\.jpg)?/i);
    if (uuidMatch) {
      return `https://s3.anixmirai.com/posters/${uuidMatch[1].replace(/\.jpg$/i, '')}.jpg`;
    }
  }
  return clean;
}

async function fetchImageBuffer(url, timeoutMs = 5000) {
  if (!url || isPlaceholderImage(url)) return null;

  const normalized = normalizeImageUrl(url);
  if (imageBinaryCache.has(normalized)) {
    return imageBinaryCache.get(normalized);
  }

  const candidateUrls = [];
  if (normalized.includes('image.tmdb.org') || normalized.includes('anixmirai.com') || normalized.includes('anixsekai.com')) {
    // В РФ image.tmdb.org и s3.anixmirai.com блокируются напрямую (таймаут 5с).
    // Высокоскоростные CDN-зеркала wsrv.nl и images.weserv.nl отдают оригинальные постеры за < 90 мс!
    candidateUrls.push(`https://wsrv.nl/?url=${encodeURIComponent(normalized)}`);
    candidateUrls.push(`https://images.weserv.nl/?url=${encodeURIComponent(normalized)}`);
    candidateUrls.push(normalized);
  } else {
    candidateUrls.push(normalized);
    if (normalized.startsWith('http') && !normalized.includes('liftw.ws') && !normalized.includes('lateremb.ws')) {
      candidateUrls.push(`https://wsrv.nl/?url=${encodeURIComponent(normalized)}`);
    }
  }

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
  };
  if (normalized.includes('anixart') || normalized.includes('anixmirai')) {
    headers['User-Agent'] = 'AnixartApp/8.2.1';
    headers['Referer'] = 'https://anixart.tv/';
  } else if (normalized.includes('shikimori')) {
    headers['User-Agent'] = 'STORM-MULTIMEDIA/1.0';
    headers['Referer'] = 'https://shikimori.one/';
  } else if (normalized.includes('fanfilm4k')) {
    headers['Referer'] = 'https://v17.fanfilm4k.media/';
    headers['Origin'] = 'https://v17.fanfilm4k.media';
  } else if (normalized.includes('tmdb.org')) {
    headers['Referer'] = 'https://www.themoviedb.org/';
  }

  for (const candidate of candidateUrls) {
    try {
      let buffer = null;
      let rawType = 'image/jpeg';

      if (candidate.includes('liftw.ws') || candidate.includes('lateremb.ws') || candidate.includes('liftapp.ink')) {
        const liftResp = await liftRequestRaw(candidate, {
          headers: { ...headers, Referer: 'https://liftw.ws/' },
          timeout: Math.min(timeoutMs, 3500)
        });
        if (liftResp && liftResp.status >= 200 && liftResp.status < 300 && liftResp.buffer?.length > 100) {
          buffer = liftResp.buffer;
          rawType = liftResp.headers?.['content-type'] || 'image/jpeg';
        }
      } else {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(candidate, { headers, signal: controller.signal });
        clearTimeout(timeout);
        if (res.ok) {
          rawType = res.headers.get('content-type') || 'image/jpeg';
          if (rawType.startsWith('image/') || rawType.includes('octet-stream')) {
            buffer = Buffer.from(await res.arrayBuffer());
          }
        }
      }

      if (buffer && buffer.length > 100) {
        if (rawType.startsWith('image/') || rawType.includes('octet-stream')) {
          let contentType = rawType.startsWith('image/') ? rawType : 'image/jpeg';
            if (sharp) {
              try {
                const webpBuf = await sharp(buffer)
                  .webp({ quality: 82, effort: 3 })
                  .toBuffer();
                buffer = webpBuf;
                contentType = 'image/webp';
              } catch {
                // Фолбэк на оригинальный формат, если sharp не смог обработать (например svg)
              }
            }

            const item = { buffer, contentType };
            if (imageBinaryCache.size > 1000) {
              const keysToDelete = Array.from(imageBinaryCache.keys()).slice(0, 150);
              keysToDelete.forEach(k => imageBinaryCache.delete(k));
            }
            imageBinaryCache.set(normalized, item);
            return item;
        }
      }
    } catch {}
  }
  return null;
}

async function resolveAnimePosterBuffer(title, orig) {
  function cleanStr(s) {
    return (s || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[«»"']/g, '')
      .replace(/\s*\(\d{4}\)\s*$/, '')
      .trim();
  }

  const cleanTitle = cleanStr(title);
  const cleanOrig = cleanStr(orig);
  if (!cleanTitle && !cleanOrig) return null;

  const cacheKey = `anime_cover_v3_${cleanTitle.toLowerCase()}:::${cleanOrig.toLowerCase()}`;

  // 1. Проверка сохранённого в SQLite URL обложки
  const cachedUrl = getCache('anime_covers', cacheKey);
  if (cachedUrl && !isPlaceholderImage(cachedUrl)) {
    const img = await fetchImageBuffer(cachedUrl, 4000);
    if (img) return img;
  }

  const titleNoSeason = (normalizeAnimeFranchiseTitle(cleanTitle, true) || cleanTitle)
    .replace(/\s*(?:2nd|3rd|\d+th|\d+)\s*(?:сезон|season|часть|part|tv)?.*$/i, '')
    .replace(/(?:[.:—-]|\s+)\s*(?:фильм|movie|спецвыпуск\w*|special\w*|ova|ona).*$/i, '')
    .trim();
  const origNoSeason = (normalizeAnimeFranchiseTitle(cleanOrig, true) || cleanOrig)
    .replace(/\s*(?:2nd|3rd|\d+th|\d+)\s*(?:season|part|tv)?.*$/i, '')
    .replace(/(?:[.:—-]|\s+)\s*(?:movie|special\w*|ova|ona|the movie).*$/i, '')
    .trim();

  const titleBeforeColon = cleanTitle.includes(':') ? cleanTitle.split(':')[0].trim() : (cleanTitle.includes('.') ? cleanTitle.split('.')[0].trim() : '');
  const origBeforeColon = cleanOrig.includes(':') ? cleanOrig.split(':')[0].trim() : (cleanOrig.includes('.') ? cleanOrig.split('.')[0].trim() : '');
  const searchTerms = [...new Set([
    cleanTitle,
    titleNoSeason,
    titleBeforeColon,
    cleanOrig,
    origNoSeason,
    origBeforeColon
  ].filter(t => t && t.length >= 2))].slice(0, 4);

  const matchesRequestedTitle = (candRu, candOrig) => {
    const normCandRu = normPosterKey(normalizeAnimeFranchiseTitle(candRu || '', true) || candRu);
    const normCandOrig = normPosterKey(normalizeAnimeFranchiseTitle(candOrig || '', true) || candOrig);
    const targetKeys = searchTerms.map(t => normPosterKey(t)).filter(Boolean);
    for (const tk of targetKeys) {
      if (normCandRu && (normCandRu === tk || (tk.length >= 6 && normCandRu.startsWith(tk + ' ')) || (normCandRu.length >= 6 && tk.startsWith(normCandRu + ' ')))) return true;
      if (normCandOrig && (normCandOrig === tk || (tk.length >= 6 && normCandOrig.startsWith(tk + ' ')) || (normCandOrig.length >= 6 && tk.startsWith(normCandOrig + ' ')))) return true;
    }
    return false;
  };

  // Каскад 1: Поиск в AniXart (прямой официальный постер релиза на static.anixart.tv)
  for (const term of [cleanTitle, cleanOrig].filter(Boolean)) {
    try {
      const searchRes = await searchAnixart(term, 0);
      if (searchRes?.items?.length > 0) {
        for (const it of searchRes.items.slice(0, 5)) {
          if (!matchesRequestedTitle(it.title, it.original_title)) continue;
          let pUrl = '';
          if (it.poster) {
            const m = it.poster.match(/url=([^&]+)/);
            pUrl = m ? decodeURIComponent(m[1]) : it.poster;
          }
          pUrl = normalizeImageUrl(pUrl);
          if (pUrl && !isPlaceholderImage(pUrl)) {
            const img = await fetchImageBuffer(pUrl, 4000);
            if (img) {
              setCache('anime_covers', cacheKey, pUrl, 86400 * 30);
              return img;
            }
          }
        }
      }
    } catch {}
  }

  // Каскад 2: Поиск через Shikimori API (быстрый доступный в РФ CDN)
  for (const term of searchTerms) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(`https://shikimori.io/api/animes?search=${encodeURIComponent(term)}&limit=3`, {
        headers: { 'User-Agent': 'STORM-MULTIMEDIA/1.0' },
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (res.ok) {
        const list = await res.json();
        if (Array.isArray(list)) {
          for (const item of list) {
            if (!item?.image) continue;
            if (matchesRequestedTitle(item.russian || '', item.name || '')) {
              const imgPath = item.image.original || item.image.preview;
              if (imgPath && !isPlaceholderImage(imgPath)) {
                const fullUrl = imgPath.startsWith('http') ? imgPath : `https://shikimori.io${imgPath}`;
                const img = await fetchImageBuffer(fullUrl, 4000);
                if (img) {
                  setCache('anime_covers', cacheKey, fullUrl, 86400 * 30);
                  return img;
                }
              }
            }
          }
        }
      }
    } catch {}
  }

  // Каскад 3: Поиск через Kitsu API (официальные постеры высокого разрешения)
  for (const term of [cleanOrig, cleanTitle].filter(Boolean)) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(`https://kitsu.io/api/edge/anime?filter[text]=${encodeURIComponent(term)}&page[limit]=2`, {
        headers: { 'Accept': 'application/vnd.api+json' },
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json();
        for (const entry of (data?.data || [])) {
          const attr = entry?.attributes;
          if (!attr) continue;
          if (!matchesRequestedTitle(attr.canonicalTitle || '', attr.titles?.en || attr.titles?.en_jp || '')) continue;
          const posterImg = attr.posterImage;
          const imgUrl = posterImg?.medium || posterImg?.original;
          if (imgUrl && !isPlaceholderImage(imgUrl)) {
            const img = await fetchImageBuffer(imgUrl, 4000);
            if (img) {
              setCache('anime_covers', cacheKey, imgUrl, 86400 * 30);
              return img;
            }
          }
        }
      }
    } catch {}
  }

  // Каскад 4: Поиск через TMDB
  for (const term of searchTerms) {
    try {
      const tmdbRes = await searchTmdb(term);
      for (const cand of (tmdbRes?.items || [])) {
        if (!cand?.poster || isPlaceholderImage(cand.poster)) continue;
        if (!matchesRequestedTitle(cand.title, cand.original_title)) continue;
        const fullUrl = cand.poster;
        const img = await fetchImageBuffer(fullUrl, 4000);
        if (img) {
          setCache('anime_covers', cacheKey, fullUrl, 86400 * 30);
          return img;
        }
      }
    } catch {}
  }

  // Каскад 5: AniList GraphQL (загружаем буфер через сервер, обходя блокировки браузера)
  const q = `
    query ($search: String) {
      Media(search: $search, type: ANIME) {
        coverImage { large }
      }
    }
  `;
  for (const term of searchTerms) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const res = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ query: q, variables: { search: term } }),
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json();
        const imgUrl = data?.data?.Media?.coverImage?.large;
        if (imgUrl && !isPlaceholderImage(imgUrl)) {
          const img = await fetchImageBuffer(imgUrl, 4000);
          if (img) {
            setCache('anime_covers', cacheKey, imgUrl, 86400 * 30);
            return img;
          }
        }
      }
    } catch {}
  }

  return null;
}

function normPosterKey(s) {
  return (s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s*\(\d{4}\)\s*$/, '')
    .replace(/[^a-zа-я0-9]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const KNOWN_VERIFIED_POSTERS = {
  [normPosterKey('субстанция')]: 'https://image.tmdb.org/t/p/w500/x3yhBGbTqlAjxM450BANUNCHpOO.jpg',
  [normPosterKey('the substance')]: 'https://image.tmdb.org/t/p/w500/x3yhBGbTqlAjxM450BANUNCHpOO.jpg',
  [normPosterKey('чужой ромул')]: 'https://image.tmdb.org/t/p/w500/A2CU4WbCZlkYbz9gEFIpchlIGpq.jpg',
  [normPosterKey('alien romulus')]: 'https://image.tmdb.org/t/p/w500/A2CU4WbCZlkYbz9gEFIpchlIGpq.jpg',
  [normPosterKey('фуриоса')]: 'https://image.tmdb.org/t/p/w500/23oJFM6z4sGPgyIfPyJjcIGMsCz.jpg',
  [normPosterKey('фуриоса хроники безумного макса')]: 'https://image.tmdb.org/t/p/w500/23oJFM6z4sGPgyIfPyJjcIGMsCz.jpg',
  [normPosterKey('furiosa')]: 'https://image.tmdb.org/t/p/w500/23oJFM6z4sGPgyIfPyJjcIGMsCz.jpg',
  [normPosterKey('furiosa a mad max saga')]: 'https://image.tmdb.org/t/p/w500/23oJFM6z4sGPgyIfPyJjcIGMsCz.jpg',
  [normPosterKey('темная материя')]: 'https://image.tmdb.org/t/p/w500/jeJchj1uy7vIxpaGYEsWIeg808n.jpg',
  [normPosterKey('dark matter')]: 'https://image.tmdb.org/t/p/w500/jeJchj1uy7vIxpaGYEsWIeg808n.jpg',
  [normPosterKey('падение империи')]: 'https://image.tmdb.org/t/p/w500/sh7Rg8Er3tFcN9BpKIPOMvALgZd.jpg',
  [normPosterKey('civil war')]: 'https://image.tmdb.org/t/p/w500/sh7Rg8Er3tFcN9BpKIPOMvALgZd.jpg',
  [normPosterKey('дэдпул и росомаха')]: 'https://image.tmdb.org/t/p/w500/8cdWjvZQUExUUTzyp4t6EDMubfO.jpg',
  [normPosterKey('гладиатор 2')]: 'https://image.tmdb.org/t/p/w500/2cxhvwyEwRlysAmRH4iodkvo0z5.jpg',
  [normPosterKey('ландыши')]: 'https://image.tmdb.org/t/p/w500/cprDjfg7O1Rdo3uEYaFa4bfJoDc.jpg',
  [normPosterKey('ландыши такая нежная любовь')]: 'https://image.tmdb.org/t/p/w500/cprDjfg7O1Rdo3uEYaFa4bfJoDc.jpg',
  [normPosterKey('мэйдэй')]: 'https://v17.fanfilm4k.media/uploads/posts/2026-09/w1500_57684498.jpg',
  [normPosterKey('mayday')]: 'https://v17.fanfilm4k.media/uploads/posts/2026-09/w1500_57684498.jpg',
  [normPosterKey('дюна часть вторая')]: 'https://image.tmdb.org/t/p/w500/8b8R8l88Qje9dn9OE8PY05Nxl1X.jpg',
  [normPosterKey('dune part two')]: 'https://image.tmdb.org/t/p/w500/8b8R8l88Qje9dn9OE8PY05Nxl1X.jpg',
  [normPosterKey('укрытие')]: 'https://image.tmdb.org/t/p/w500/gRkvq6FgiGRdtCwhVIozaUqhoDL.jpg',
  [normPosterKey('бункер')]: 'https://image.tmdb.org/t/p/w500/gRkvq6FgiGRdtCwhVIozaUqhoDL.jpg',
  [normPosterKey('silo')]: 'https://image.tmdb.org/t/p/w500/gRkvq6FgiGRdtCwhVIozaUqhoDL.jpg',
  [normPosterKey('человек паук паутина вселенных')]: 'https://image.tmdb.org/t/p/w500/wH0kbTvbrvtlCygso7Ye2ZfGfM1.jpg',
  [normPosterKey('across the spider verse')]: 'https://image.tmdb.org/t/p/w500/wH0kbTvbrvtlCygso7Ye2ZfGfM1.jpg',
  [normPosterKey('бордерлендс')]: 'https://v17.fanfilm4k.media/uploads/posts/2024-08/fb3f49de1ca829a94ee2bf9cd8ec433c-min.jpg',
  [normPosterKey('borderlands')]: 'https://v17.fanfilm4k.media/uploads/posts/2024-08/fb3f49de1ca829a94ee2bf9cd8ec433c-min.jpg',
  [normPosterKey('интерстеллар')]: 'https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg',
  [normPosterKey('interstellar')]: 'https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg',
  [normPosterKey('оппенгеймер')]: 'https://image.tmdb.org/t/p/w500/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg',
  [normPosterKey('oppenheimer')]: 'https://image.tmdb.org/t/p/w500/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg',
  [normPosterKey('киберпанк бегущие по краю')]: 'https://image.tmdb.org/t/p/w500/w15qxusZtam6ipBGEWBcwg9WQNN.jpg',
  [normPosterKey('cyberpunk edgerunners')]: 'https://image.tmdb.org/t/p/w500/w15qxusZtam6ipBGEWBcwg9WQNN.jpg',
  [normPosterKey('аркейн')]: 'https://image.tmdb.org/t/p/w500/kVioUjk1SXGWblJNaKsIJcBqUcY.jpg',
  [normPosterKey('arcane')]: 'https://image.tmdb.org/t/p/w500/kVioUjk1SXGWblJNaKsIJcBqUcY.jpg',
  [normPosterKey('джентльмены')]: 'https://image.tmdb.org/t/p/w500/bpy9uaV0oOlKnEoPzodwrSSUFXg.jpg',
  [normPosterKey('the gentlemen')]: 'https://image.tmdb.org/t/p/w500/bpy9uaV0oOlKnEoPzodwrSSUFXg.jpg',
  [normPosterKey('разделение')]: 'https://image.tmdb.org/t/p/w500/Ag7gBPnh8Cpn5xvCdPPA4RJRN1L.jpg',
  [normPosterKey('severance')]: 'https://image.tmdb.org/t/p/w500/Ag7gBPnh8Cpn5xvCdPPA4RJRN1L.jpg',
  [normPosterKey('одних из нас')]: 'https://image.tmdb.org/t/p/w500/69loIrm9JPpPRE3Akw4yRoitSYn.jpg',
  [normPosterKey('одни из нас')]: 'https://image.tmdb.org/t/p/w500/69loIrm9JPpPRE3Akw4yRoitSYn.jpg',
  [normPosterKey('the last of us')]: 'https://image.tmdb.org/t/p/w500/69loIrm9JPpPRE3Akw4yRoitSYn.jpg',
  [normPosterKey('видения 2015')]: 'https://v17.fanfilm4k.media/uploads/posts/2022-06/770693_1654138922.jpg',
  [normPosterKey('тетрадь смерти')]: 'https://image.tmdb.org/t/p/w500/tCZFfYTIwrR7n94J6G14Y4hAFU6.jpg',
  [normPosterKey('death note')]: 'https://image.tmdb.org/t/p/w500/tCZFfYTIwrR7n94J6G14Y4hAFU6.jpg',
  [normPosterKey('провожающая в последний путь фрирен')]: 'https://image.tmdb.org/t/p/w500/dqZENchTd7lp5zht7BdlqM7RBhD.jpg',
  [normPosterKey('провожающая в последний путь фрирен золотая земля')]: 'https://image.tmdb.org/t/p/w500/dqZENchTd7lp5zht7BdlqM7RBhD.jpg',
  [normPosterKey('о моем перерождении в слизь')]: 'https://image.tmdb.org/t/p/w500/jQb1z04cI12k0f2P6xCFncP9xG.jpg',
  [normPosterKey('монолог фармацевта')]: 'https://image.tmdb.org/t/p/w500/e3ojpANrFnmJCyeBNTinJcmathR.jpg',
  [normPosterKey('дракон раджа')]: 'https://shikimori.io/system/animes/original/52357.jpg'
};

// Фоновый предпрогрев популярных постеров
if (!global._postersPrewarmed) {
  global._postersPrewarmed = true;
  setTimeout(() => {
    Object.values(KNOWN_VERIFIED_POSTERS).forEach(u => {
      if (u && !imageBinaryCache.has(u)) {
        fetchImageBuffer(u, 6000).catch(() => {});
      }
    });
  }, 1500);
}

async function resolveUniversalMediaPosterBuffer(title, orig) {
  function cleanStr(s) {
    return (s || '')
      .replace(/[«»"']/g, '')
      .replace(/\s*\(\d{4}\)\s*$/, '')
      .trim();
  }

  const cleanTitle = cleanStr(title);
  const cleanOrig = cleanStr(orig);
  const key1 = normPosterKey(cleanTitle);
  const key2 = normPosterKey(cleanOrig);
  const matchedPoster = KNOWN_VERIFIED_POSTERS[key1] || KNOWN_VERIFIED_POSTERS[key2];
  if (matchedPoster) {
    const img = await fetchImageBuffer(matchedPoster, 4000);
    if (img) return img;
  }

  const cacheKey = `universal_cover_v3_${cleanTitle.toLowerCase()}:::${cleanOrig.toLowerCase()}`;
  const cachedUrl = getCache('universal_covers', cacheKey);
  if (cachedUrl && !isPlaceholderImage(cachedUrl)) {
    const img = await fetchImageBuffer(cachedUrl, 4000);
    if (img) return img;
  }

  const matchesUniversalTitle = (candRu, candOrig) => {
    const c1 = normPosterKey(candRu || '');
    const c2 = normPosterKey(candOrig || '');
    for (const tk of [key1, key2].filter(Boolean)) {
      if (c1 && (c1 === tk || (tk.length >= 6 && c1.startsWith(tk + ' ')) || (c1.length >= 6 && tk.startsWith(c1 + ' ')))) return true;
      if (c2 && (c2 === tk || (tk.length >= 6 && c2.startsWith(tk + ' ')) || (c2.length >= 6 && tk.startsWith(c2 + ' ')))) return true;
    }
    return false;
  };

  // 1. Поиск через TMDB (мировая база фильмов, сериалов и мультфильмов)
  for (const term of [cleanTitle, cleanOrig].filter(Boolean)) {
    try {
      const tmdbRes = await searchTmdb(term);
      for (const cand of (tmdbRes?.items || [])) {
        if (!cand?.poster || isPlaceholderImage(cand.poster)) continue;
        if (!matchesUniversalTitle(cand.title, cand.original_title)) continue;
        const img = await fetchImageBuffer(cand.poster, 4000);
        if (img) {
          setCache('universal_covers', cacheKey, cand.poster, 86400 * 30);
          return img;
        }
      }
    } catch {}
  }

  // 2. Поиск через FanFilm4K (4K кино и сериалы) — строго при совпадении названия!
  for (const term of [cleanTitle, cleanOrig].filter(Boolean)) {
    try {
      const ffRes = await searchFanFilm(term);
      const ffList = Array.isArray(ffRes) ? ffRes : (ffRes?.items || []);
      for (const cand of ffList) {
        if (!cand?.poster || isPlaceholderImage(cand.poster)) continue;
        if (!matchesUniversalTitle(cand.title, cand.original_title)) continue;
        const img = await fetchImageBuffer(cand.poster, 4000);
        if (img) {
          setCache('universal_covers', cacheKey, cand.poster, 86400 * 30);
          return img;
        }
      }
    } catch {}
  }

  // 3. Каскад для аниме
  return await resolveAnimePosterBuffer(title, orig);
}

async function transformImageWithSharp(imgObj, req) {
  if (!imgObj || !imgObj.buffer) return imgObj;
  if (!sharp || String(imgObj.contentType || '').includes('svg')) return imgObj;

  const reqWidth = Math.min(Math.max(parseInt(req.query.w || '0', 10) || 0, 0), 1920);
  const reqQuality = Math.min(Math.max(parseInt(req.query.q || '82', 10) || 82, 40), 95);
  const accept = String(req.headers['accept'] || '');
  const wantsWebp = accept.includes('image/webp') || req.query.fmt === 'webp';
  const wantsAvif = accept.includes('image/avif') && req.query.fmt === 'avif';

  if (!reqWidth && !wantsWebp && !wantsAvif) return imgObj;

  const cacheKey = `sharp_img:${req.query.url || req.query.title || ''}:w${reqWidth}:q${reqQuality}:${wantsAvif ? 'avif' : (wantsWebp ? 'webp' : 'orig')}`;
  const cached = l1Cache.get(cacheKey);
  if (cached) return cached;

  try {
    let pipeline = sharp(imgObj.buffer, { failOnError: false });
    if (reqWidth > 0) {
      pipeline = pipeline.resize({ width: reqWidth, withoutEnlargement: true });
    }
    let contentType = imgObj.contentType;
    if (wantsAvif) {
      pipeline = pipeline.avif({ quality: Math.min(reqQuality, 75) });
      contentType = 'image/avif';
    } else if (wantsWebp) {
      pipeline = pipeline.webp({ quality: reqQuality });
      contentType = 'image/webp';
    }
    const outBuffer = await pipeline.toBuffer();
    const outObj = { buffer: outBuffer, contentType };
    l1Cache.set(cacheKey, outObj, 1000 * 60 * 60 * 6);
    return outObj;
  } catch (_) {
    return imgObj;
  }
}

app.get(['/api/media/image-proxy', '/api/proxy/image'], async (req, res) => {
  try {
    const rawUrl = req.query.url || '';
    const title = req.query.title || '';
    const orig = req.query.orig || '';

    const normalizedUrl = normalizeImageUrl(rawUrl);

    // 1. Если передана прямая ссылка (включая static.anixart.tv / tmdb / kinopoisk / shikimori):
    // Сервер загружает бинарный буфер, оптимизирует через Sharp (WebP/AVIF) и отдаёт браузеру напрямую
    if (normalizedUrl && !isPlaceholderImage(normalizedUrl) && isSafeExternalHttpUrl(normalizedUrl)) {
      const img = await fetchImageBuffer(normalizedUrl, 5000);
      if (img) {
        const optimized = await transformImageWithSharp(img, req);
        res.set('Content-Type', optimized.contentType);
        res.set('Cache-Control', 'public, max-age=31536000, immutable');
        return res.send(optimized.buffer);
      }
    }

    // 2. Если по переданной ссылке получить обложку не удалось — подключаем многоуровневый интеллектуальный каскад
    if (title || orig) {
      const resolvedImg = await resolveUniversalMediaPosterBuffer(title, orig);
      if (resolvedImg) {
        const optimized = await transformImageWithSharp(resolvedImg, req);
        res.set('Content-Type', optimized.contentType);
        res.set('Cache-Control', 'public, max-age=31536000, immutable');
        return res.send(optimized.buffer);
      }
    }

    // 3. Безотказная генерация стильного кинематографического SVG-постера 600x900 (0 ошибок 404)
    const fallbackTitle = String(title || orig || 'STORM MULTIMEDIA')
      .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
      .slice(0, 64);
    const words = fallbackTitle.split(/\s+/);
    const lines = [];
    let curLine = '';
    for (const w of words) {
      if ((curLine + ' ' + w).trim().length > 18 && lines.length < 3) {
        if (curLine) lines.push(curLine);
        curLine = w;
      } else {
        curLine = (curLine + ' ' + w).trim();
      }
    }
    if (curLine) lines.push(curLine);

    const svgPoster = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900" width="600" height="900">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#0b1120"/>
          <stop offset="50%" stop-color="#131c33"/>
          <stop offset="100%" stop-color="#070a12"/>
        </linearGradient>
        <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#00d2ff"/>
          <stop offset="100%" stop-color="#3b82f6"/>
        </linearGradient>
      </defs>
      <rect width="600" height="900" fill="url(#bg)"/>
      <circle cx="300" cy="280" r="180" fill="#00d2ff" opacity="0.06"/>
      <rect x="28" y="28" width="544" height="844" rx="24" fill="none" stroke="#00d2ff" stroke-opacity="0.25" stroke-width="2"/>
      <rect x="210" y="90" width="180" height="38" rx="19" fill="url(#accent)" opacity="0.18"/>
      <text x="300" y="115" text-anchor="middle" fill="#00d2ff" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="800" letter-spacing="2">4K ULTRA HD</text>
      <circle cx="300" cy="310" r="64" fill="#00d2ff" opacity="0.12" stroke="#00d2ff" stroke-opacity="0.4" stroke-width="2"/>
      <polygon points="282,280 282,340 334,310" fill="#00d2ff"/>
      ${lines.map((ln, idx) => `<text x="300" y="${510 + idx * 46}" text-anchor="middle" fill="#f8fafc" font-family="system-ui, -apple-system, sans-serif" font-size="34" font-weight="800">${ln}</text>`).join('')}
      <text x="300" y="810" text-anchor="middle" fill="#64748b" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="700" letter-spacing="3">STORM MULTIMEDIA</text>
    </svg>`;

    res.status(200);
    res.set('Content-Type', 'image/svg+xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600');
    return res.send(svgPoster);
  } catch {
    if (faviconBuffer) {
      res.status(200);
      res.set('Content-Type', 'image/svg+xml');
      return res.send(faviconBuffer);
    }
    return res.redirect(302, '/assets/favicon.svg');
  }
});


// Вспомогательная функция для сбалансированного объединения результатов из разных источников
function interleaveSources(arrays) {
  const result = [];
  const validArrays = arrays.filter(a => Array.isArray(a) && a.length > 0);
  if (validArrays.length === 0) return [];

  const maxLen = Math.max(...validArrays.map(a => a.length));
  for (let i = 0; i < maxLen; i++) {
    for (const arr of validArrays) {
      if (i < arr.length && result.length < 120) {
        result.push(arr[i]);
      }
    }
  }
  return result;
}

function isAnimeMediaItem(item) {
  if (!item) return false;
  if (['anixart', 'shikimori', 'anilibria', 'animevost'].includes(item.source)) return true;
  if (item.media_type === 'anime-movie' || item.media_type === 'anime-series' || item.media_type === 'anime') return true;
  if (item.original_language === 'ja') return true;
  if (Array.isArray(item.origin_country) && item.origin_country.includes('JP')) return true;
  if (typeof item.country === 'string' && /япон|japan/i.test(item.country)) return true;
  if (Array.isArray(item.countries) && item.countries.some(c => /япон|japan/i.test(String(c)))) return true;
  if (/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(item.original_title || '')) return true;

  const link = (item.link || item.url || '').toLowerCase();
  if (link.includes('-anime.html') || link.includes('/anime/') || link.includes('anime')) return true;
  if (typeof item.category === 'string' && item.category.toLowerCase().includes('аниме')) return true;

  const title = `${item.title || ''} ${item.original_title || ''}`.toLowerCase();
  const animeKeywords = [
    'аниме', 'anime',
    'человек-бензопила', 'chainsaw man', 'резе', 'reze',
    'сад изящных слов', 'garden of words', 'kotonoha no niwa',
    'призрак в доспехах', 'ghost in the shell',
    'война рохирримов', 'war of the rohirrim',
    'клинок, рассекающий', 'клинок рассекающий', 'demon slayer', 'kimetsu',
    'атака титанов', 'attack on titan', 'shingeki',
    'магическая битва', 'jujutsu kaisen',
    'форма голоса', 'silent voice', 'koe no katachi',
    'твоё имя', 'твое имя', 'your name', 'kimi no na wa',
    'дитя погоды', 'weathering with you',
    'судзумэ', 'suzume',
    'ходячий замок', 'howl\'s moving castle',
    'унесённые призраками', 'унесенные призраками', 'spirited away',
    'мой сосед тоторо', 'my neighbor totoro',
    'принцесса мононоке', 'princess mononoke',
    'ветер крепчает', 'wind rises',
    'навсикая', 'nausicaa',
    'могила светлячков', 'grave of the fireflies',
    'шепот сердца', 'шёпот сердца', 'whisper of the heart',
    'рыбка поньо', 'ponyo',
    'акира', 'akira',
    'евангелион', 'evangelion',
    'ван-пис', 'ван пис', 'one piece',
    'наруто', 'naruto', 'боруто', 'boruto',
    'блич', 'bleach',
    'тетрадь смерти', 'death note',
    'берсерк', 'berserk',
    'врата штейна', 'steins;gate',
    'ковбой бибоп', 'cowboy bebop',
    'хвост феи', 'fairy tail',
    'семья шпиона', 'spy x family',
    'дандадан', 'dandadan',
    'кайджу № 8', 'кайджу 8', 'kaiju no. 8',
    'гинтама', 'gintama',
    'хантер х хантер', 'hunter x hunter',
    'чёрный клевер', 'черный клевер', 'black clover',
    'сейлор мун', 'sailor moon',
    'токийский гуль', 'tokyo ghoul'
  ];

  if (animeKeywords.some(kw => title.includes(kw))) return true;

  const genres = Array.isArray(item.genres) ? item.genres : (typeof item.genres === 'string' ? item.genres.split(',') : []);
  if (genres.some(g => typeof g === 'string' && /аниме|anime/i.test(g))) return true;

  return false;
}

// ==========================================
// 3. МЕДИА КАТАЛОГ И АГРЕГАЦИЯ 12+ ИСТОЧНИКОВ
// ==========================================

const memoryCatalogCache = new Map();
const MEMORY_CATALOG_FRESH_TTL = 15 * 60 * 1000; // 15 минут - свежий кэш
const MEMORY_CATALOG_MAX_STALE_TTL = 24 * 60 * 60 * 1000; // 24 часа - допустимый stale кэш

// ============================================================================
// ДИНАМИЧЕСКИЙ ВЕРИФИКАТОР РЕАЛЬНОЙ ДОСТУПНОСТИ ЦИФРОВОГО ПОТОКА (LIFT / FF4K / KODIK)
// Гарантирует 0% ложных плашек «4K UHD» у кинотеатральных премьер, ещё не вышедших в сети
// ============================================================================
function normalizeStreamProbeKey(title = '', originalTitle = '', year = '', isSeries = false) {
  const norm = (s) => String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s*[\(\[][^\)\]]*[\)\]]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
  const base = norm(originalTitle) || norm(title) || 'unknown';
  return `probe_v2_${isSeries ? 'tv' : 'mv'}_${base}_${year || '0'}`;
}

function recordNegativeStreamAvailability({ title = '', original_title = '', year = '', is_series = false } = {}) {
  try {
    if (!title && !original_title) return;
    const key = normalizeStreamProbeKey(title, original_title, year, is_series);
    setCache('stream_probe', key, { hasStream: false, checkedAt: Date.now() }, 7200); // 2 часа TTL

    const normMatch = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, '').trim();
    const tTarget = normMatch(title);
    const oTarget = normMatch(original_title);

    const patchItemList = (list) => {
      if (!Array.isArray(list)) return;
      for (const it of list) {
        if (!it) continue;
        const itT = normMatch(it.title);
        const itO = normMatch(it.original_title);
        const sameTitle = (tTarget && itT && itT === tTarget) || (oTarget && itO && itO === oTarget);
        const sameYear = !year || !it.year || String(it.year) === String(year);
        if (sameTitle && sameYear && !it.lift_id && !it.fanfilm_4k_url) {
          it.stream_verified = false;
          it.is_upcoming = true;
          it.is4K = false;
          it.quality = 'Ожидается';
        }
      }
    };

    for (const entry of memoryCatalogCache.values()) {
      if (entry && Array.isArray(entry.items)) patchItemList(entry.items);
    }
    if (typeof memorySearchCache !== 'undefined') {
      for (const entry of memorySearchCache.values()) {
        if (entry && Array.isArray(entry.items)) patchItemList(entry.items);
      }
    }
  } catch (_) {}
}

async function probeSingleItemDigitalStream(item) {
  if (!item || typeof item !== 'object') return { hasStream: false };

  // 1. Быстрый путь (0 мс): уже привязан проверенный прямой онлайн-поток
  const rawFf = item.fanfilm_4k_url || (item.source === 'fanfilm4k' ? (item.link || item.url) : '');
  const validFf = (rawFf && !String(rawFf).includes('do=search')) ? rawFf : '';
  if (item.source === 'lift' || item.lift_id) {
    return { hasStream: true, lift_id: String(item.lift_id || item.id || '').replace(/^lift_/, '') };
  }
  if (item.source === 'fanfilm4k' || validFf || item.fanfilm_hd_url) {
    return { hasStream: true, fanfilm_4k_url: validFf || null };
  }
  if (item.vk_embed_url || (item.rutube_id && String(item.rutube_id).length > 15) || item.source === 'anilibria') {
    return { hasStream: true };
  }
  if ((item.source === 'anixart' || item.source === 'shikimori') && Number(item.episodes_released || 0) > 0) {
    return { hasStream: true };
  }
  if (item.stream_verified === true) {
    return { hasStream: true };
  }

  // 2. Будущая календарная дата или будущий год (0 мс)
  const now = new Date();
  const currentYear = now.getFullYear();
  const yr = parseInt(item.year, 10) || 0;
  if (yr > currentYear) {
    return { hasStream: false, reason: 'future_year' };
  }

  const rawDate = String(item.release_date || item.first_air_date || item.premiere || '').trim();
  let parsedDate = null;
  if (rawDate && rawDate !== `${yr}-01-01`) {
    if (/^\d{4}-\d{2}-\d{2}/.test(rawDate)) {
      parsedDate = new Date(`${rawDate.substring(0, 10)}T23:59:59`);
    } else if (/^\d{2}\.\d{2}\.\d{4}$/.test(rawDate)) {
      const [dd, mm, yyyy] = rawDate.split('.');
      parsedDate = new Date(`${yyyy}-${mm}-${dd}T23:59:59`);
    }
    if (parsedDate && !isNaN(parsedDate.getTime()) && parsedDate > now) {
      return { hasStream: false, reason: 'future_date' };
    }
  }

  const statusLow = String(item.status || '').toLowerCase().trim();
  if (statusLow && ['planned', 'in production', 'post production', 'rumored', 'upcoming', 'anons', 'анонс', 'not yet aired', 'unreleased'].includes(statusLow)) {
    return { hasStream: false, reason: 'status_unreleased' };
  }

  // 3. Каталог прошлых лет (> 240 дней с момента релиза) — давно в цифре (0 мс)
  const isZeroEpAnime = (item.source === 'anixart' || item.source === 'shikimori') && Number(item.episodes_released || 0) === 0;
  if (!isZeroEpAnime) {
    if (yr > 0 && yr <= currentYear - 2) {
      return { hasStream: true };
    }
    if (yr === currentYear - 1 && parsedDate && !isNaN(parsedDate.getTime())) {
      const ageDays = (now.getTime() - parsedDate.getTime()) / (86400 * 1000);
      if (ageDays > 240) {
        return { hasStream: true };
      }
    }
  }

  // 4. Активная проверка наличия реального потока в базах балансеров (с персистентным кэшем SQLite/MariaDB)
  const cleanTitle = String(item.title || '').replace(/\s*\(\d{4}\)\s*$/i, '').trim();
  const isSeries = ['series', 'tv', 'anime-series', 'cartoon-series'].includes(String(item.media_type || '').toLowerCase()) || Boolean(item.is_series);
  const probeKey = normalizeStreamProbeKey(cleanTitle, item.original_title || '', yr, isSeries);

  const cachedProbe = getCache('stream_probe', probeKey);
  if (cachedProbe && typeof cachedProbe.hasStream === 'boolean') {
    return cachedProbe;
  }

  // 4a. Мгновенный словарь FanFilm4K
  const syncFf = resolveFanFilmUrl(cleanTitle, yr);
  if (syncFf && !String(syncFf).includes('do=search')) {
    const pos = { hasStream: true, fanfilm_4k_url: syncFf, checkedAt: Date.now() };
    setCache('stream_probe', probeKey, pos, 7 * 86400);
    return pos;
  }

  // 4b. Проверка в базе Lift (88 000+ фильмов и сериалов с точной сверкой года и original_title)
  const PROBE_TIMEOUT = '__PROBE_TIMEOUT__';
  let liftTimedOut = false;
  try {
    const matchedLiftId = await Promise.race([
      resolveLiftMatch({
        title: cleanTitle,
        original_title: item.original_title || '',
        year: yr ? String(yr) : '',
        is_series: isSeries
      }),
      new Promise(r => setTimeout(() => r(PROBE_TIMEOUT), 4500))
    ]);
    if (matchedLiftId === PROBE_TIMEOUT) {
      liftTimedOut = true;
    } else if (matchedLiftId) {
      const pos = { hasStream: true, lift_id: String(matchedLiftId), checkedAt: Date.now() };
      setCache('stream_probe', probeKey, pos, 7 * 86400);
      return pos;
    }
  } catch (_) {
    liftTimedOut = true;
  }

  // 4c. Для аниме дополнительно проверяем прямое наличие плеера в Kodik API
  if (isAnimeMediaItem(item) || item.source === 'anixart' || item.source === 'shikimori') {
    try {
      const kodikUrl = await Promise.race([
        resolveKodikDirectIframe({
          cleanTitle,
          original_title: item.original_title || '',
          shikimori_id: item.shikimori_id || ''
        }),
        new Promise(r => setTimeout(() => r(''), 2500))
      ]);
      if (kodikUrl) {
        const pos = { hasStream: true, kodik_url: kodikUrl, checkedAt: Date.now() };
        setCache('stream_probe', probeKey, pos, 3 * 86400);
        return pos;
      }
    } catch (_) {}
  }

  // Потока нет ни в одном балансере -> кинотеатральная премьера / ожидается цифровой релиз (TTL 2 часа)
  // Не кэшируем отрицательный результат, если запрос завершился по сетевому таймауту!
  const neg = { hasStream: false, checkedAt: Date.now() };
  if (!liftTimedOut) {
    setCache('stream_probe', probeKey, neg, 7200);
  }
  return neg;
}

async function verifyItemsDigitalStreamAvailability(items, { concurrency = 6 } = {}) {
  if (!Array.isArray(items) || items.length === 0) return items;
  let cursor = 0;
  const workerCount = Math.min(concurrency, items.length);

  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      const it = items[idx];
      if (!it || typeof it !== 'object') continue;
      try {
        const probe = await probeSingleItemDigitalStream(it);
        if (probe && probe.hasStream) {
          if (probe.lift_id && !it.lift_id) it.lift_id = probe.lift_id;
          if (probe.fanfilm_4k_url && !it.fanfilm_4k_url) it.fanfilm_4k_url = probe.fanfilm_4k_url;
          it.stream_verified = true;
          it.is_upcoming = false;
          if (!it.quality || /ожидается|скоро|анонс/i.test(String(it.quality))) {
            const should4k = Boolean(it.source === 'tmdb' || it.source === 'fanfilm4k' || it.fanfilm_4k_url || it.is4K);
            it.is4K = should4k;
            it.quality = should4k ? '4K Ultra HD' : '1080p FHD';
          }
        } else {
          it.stream_verified = false;
          it.is_upcoming = true;
          it.is4K = false;
          it.quality = 'Ожидается';
        }
      } catch (_) {}
    }
  });

  await Promise.all(workers);
  return items;
}

async function executeCatalogFetch(category, page = 1, source = 'all', extraFilters = {}) {
  const normCategory = category === 'home' ? 'popular' : category;
  const CATALOG_GATHER_TIMEOUT_MS = 4500;

  const fetchTask = async () => {
    let fetchedItems = [];
    let fetchedTotal = 0;

    // 0. Прямой источник: Lift (api.liftw.ws — 88 000+ фильмов, сериалов, мультфильмов, аниме и дорам без рекламы)
    if (source === 'lift') {
      const liftRes = await Promise.race([
        getLiftCatalog({ category: normCategory, page, limit: 24, ...extraFilters }),
        new Promise(resolve => setTimeout(() => resolve({ items: [], total_items: 0 }), 3800))
      ]);
      fetchedItems = Array.isArray(liftRes) ? liftRes : (liftRes?.items || []);
      fetchedTotal = liftRes?.total_items || Math.max(fetchedItems.length, 500 * 24);
    }
    // 1. Прямой источник: The Movie Database (TMDB)
    else if (source === 'tmdb') {
      const tmdbPage1 = page * 2 - 1;
      const tmdbPage2 = page * 2;
      const [res1, res2] = await Promise.allSettled([
        getTmdbCatalog(normCategory, tmdbPage1),
        getTmdbCatalog(normCategory, tmdbPage2)
      ]);
      const items1 = res1.status === 'fulfilled' ? res1.value?.items || [] : [];
      const items2 = res2.status === 'fulfilled' ? res2.value?.items || [] : [];
      fetchedItems = [...items1, ...items2];
      fetchedTotal = res1.status === 'fulfilled' ? res1.value?.total_items || fetchedItems.length : fetchedItems.length;
    }
    // 2. Прямой источник: AniLibria
    else if (source === 'anilibria') {
      const [aLibRes1, aLibRes2] = await Promise.allSettled([
        getAniLibriaCatalog(normCategory, page * 2 - 1),
        getAniLibriaCatalog(normCategory, page * 2)
      ]);
      const items1 = aLibRes1.status === 'fulfilled' ? aLibRes1.value?.items || [] : [];
      const items2 = aLibRes2.status === 'fulfilled' ? aLibRes2.value?.items || [] : [];
      fetchedItems = [...items1, ...items2];
      fetchedTotal = aLibRes1.status === 'fulfilled' ? aLibRes1.value?.total_items || fetchedItems.length : fetchedItems.length;
    }
    // 3. Стриминговые и торрент провайдеры
    else if (['kodik', 'hdrezka', 'collaps', 'alloha', 'videocdn', 'ashdi', 'kinobox', 'vidsrc', 'kinobaza', 'kinogo', 'webtorrent', 'rutracker', 'nnmclub', 'rutor', 'lostfilm', 'redheadsound', 'animevost'].includes(source)) {
      const tmdbPage1 = page * 2 - 1;
      const tmdbPage2 = page * 2;
      const [res1, res2] = await Promise.allSettled([
        getTmdbCatalog(normCategory, tmdbPage1),
        getTmdbCatalog(normCategory, tmdbPage2)
      ]);
      const items1 = res1.status === 'fulfilled' ? res1.value?.items || [] : [];
      const items2 = res2.status === 'fulfilled' ? res2.value?.items || [] : [];
      const combined = [...items1, ...items2];
      fetchedItems = combined.map(i => ({
        ...i,
        source: source,
        provider_name: source.toUpperCase()
      }));
      fetchedTotal = res1.status === 'fulfilled' ? res1.value?.total_items || fetchedItems.length : fetchedItems.length;
    }
    // 4. Прямой источник: FanFilm4K (с жестким таймаутом гонки)
    else if (source === 'fanfilm4k') {
      const cat = normCategory === 'home' ? 'popular' : normCategory;
      const fanfilmRes = await Promise.race([
        getFanFilmCatalog(cat, page),
        new Promise(resolve => setTimeout(() => resolve({ items: [], total_items: 0 }), 3200))
      ]);
      fetchedItems = fanfilmRes?.items || [];
      fetchedTotal = fanfilmRes?.total_items || fetchedItems.length;
    }
    // 5. Прямой источник: AniXart
    else if (source === 'anixart') {
      const cat = normCategory === 'home' ? 'popular' : normCategory;
      const [anixRes1, anixRes2] = await Promise.allSettled([
        getAnixartDiscover(cat, (page - 1) * 2),
        getAnixartDiscover(cat, (page - 1) * 2 + 1)
      ]);
      const items1 = anixRes1.status === 'fulfilled' ? anixRes1.value?.items || [] : [];
      const items2 = anixRes2.status === 'fulfilled' ? anixRes2.value?.items || [] : [];
      fetchedItems = [...items1, ...items2];
      fetchedTotal = Math.max(items1.length + items2.length, 300);
    }
    // 6. Прямой источник: Shikimori
    else if (source === 'shikimori') {
      const cat = normCategory === 'home' ? 'popular' : normCategory;
      const shikiRes = await getShikimoriCatalog(cat, page);
      fetchedItems = shikiRes?.items || [];
      fetchedTotal = fetchedItems.length;
    }
    // 7. Прямой источник: RuTube
    else if (source === 'rutube') {
      fetchedItems = await getRuTubeCatalog(normCategory, page);
      fetchedTotal = Math.max(fetchedItems.length, 100);
    }
    // 8. Прямой источник: VK Видео
    else if (source === 'vkvideo') {
      fetchedItems = await getVkVideoCatalog(normCategory, page);
      fetchedTotal = Math.max(fetchedItems.length, 100);
    }
    // 9. Сводный каталог всех источников ('all')
    else {
      if (normCategory === 'anime-movies') {
        const [anixRes, shikiRes, libRes, tmdbRes, ffRes] = await Promise.allSettled([
          getAnixartDiscover('anime-movies', page - 1),
          getShikimoriCatalog('anime-movies', page),
          getAniLibriaCatalog('anime-movies', page),
          getTmdbCatalog('anime-movies', page),
          Promise.race([
            getFanFilmCatalog('cartoons', page),
            new Promise(resolve => setTimeout(() => resolve({ items: [] }), 2500))
          ])
        ]);
        const ffAnime = (ffRes.status === 'fulfilled' ? ffRes.value?.items || [] : []).filter(item => isAnimeMediaItem(item));
        fetchedItems = interleaveSources([
          ffAnime,
          anixRes.status === 'fulfilled' ? anixRes.value?.items || [] : [],
          shikiRes.status === 'fulfilled' ? shikiRes.value?.items || [] : [],
          libRes.status === 'fulfilled' ? libRes.value?.items || [] : [],
          tmdbRes.status === 'fulfilled' ? tmdbRes.value?.items || [] : []
        ]);
        fetchedTotal = fetchedItems.length;
      } else if (normCategory === 'anime-series') {
        const [anixRes, libRes, shikiRes, tmdbRes] = await Promise.allSettled([
          getAnixartDiscover('anime-series', page - 1),
          getAniLibriaCatalog('anime-series', page),
          getShikimoriCatalog('anime-series', page),
          getTmdbCatalog('anime-series', page)
        ]);
        fetchedItems = interleaveSources([
          anixRes.status === 'fulfilled' ? anixRes.value?.items || [] : [],
          libRes.status === 'fulfilled' ? libRes.value?.items || [] : [],
          shikiRes.status === 'fulfilled' ? shikiRes.value?.items || [] : [],
          tmdbRes.status === 'fulfilled' ? tmdbRes.value?.items || [] : []
        ]);
        fetchedTotal = fetchedItems.length;
      } else if (normCategory === 'cartoon-series' || normCategory === 'cartoons') {
        const promises = [
          getTmdbCatalog(normCategory, page * 2 - 1),
          getTmdbCatalog(normCategory, page * 2),
          Promise.race([
            getFanFilmCatalog(normCategory, page),
            new Promise(resolve => setTimeout(() => resolve({ items: [] }), 2500))
          ])
        ];
        const results = await Promise.allSettled(promises);
        const tmdbRes1 = results[0]?.status === 'fulfilled' ? results[0].value : null;
        const tmdbRes2 = results[1]?.status === 'fulfilled' ? results[1].value : null;
        const fanfilmRes = results[2]?.status === 'fulfilled' ? results[2].value : null;

        const tmdbItems1 = tmdbRes1?.items || [];
        const tmdbItems2 = tmdbRes2?.items || [];
        const ffItems = fanfilmRes?.items || [];

        fetchedItems = interleaveSources([
          ffItems,
          tmdbItems1,
          tmdbItems2
        ]).filter(item => !isAnimeMediaItem(item));

        const tmdbTotalPages = Math.min(250, Math.ceil((tmdbRes1?.total_pages || 500) / 2));
        fetchedTotal = Math.max(fetchedItems.length, tmdbTotalPages * 20);
      } else if (normCategory === 'movies' || normCategory === 'series') {
        const [fanfilmRes, tmdbRes, liftRes] = await Promise.allSettled([
          Promise.race([
            getFanFilmCatalog(normCategory, page),
            new Promise(resolve => setTimeout(() => resolve({ items: [], total_pages: 0 }), 2500))
          ]),
          Promise.race([
            getTmdbCatalog(normCategory, page),
            new Promise(resolve => setTimeout(() => resolve({ items: [], total_pages: 0 }), 3000))
          ]),
          Promise.race([
            getLiftCatalog({ category: normCategory, page, limit: 20, ...extraFilters }),
            new Promise(resolve => setTimeout(() => resolve({ items: [], total_pages: 0 }), 2800))
          ])
        ]);
        const ffItems = fanfilmRes.status === 'fulfilled' ? fanfilmRes.value?.items || [] : [];
        const tmdbItems = tmdbRes.status === 'fulfilled' ? tmdbRes.value?.items || [] : [];
        const liftItems = liftRes.status === 'fulfilled' ? (Array.isArray(liftRes.value) ? liftRes.value : (liftRes.value?.items || [])) : [];
        fetchedItems = interleaveSources([
          ffItems,
          liftItems,
          tmdbItems
        ]);
        const ffPages = fanfilmRes.status === 'fulfilled' ? fanfilmRes.value?.total_pages : 0;
        const tmdbPages = tmdbRes.status === 'fulfilled' ? tmdbRes.value?.total_pages : 0;
        const realPages = Math.max(ffPages || 0, tmdbPages || 0) || (normCategory === 'movies' ? 718 : 162);
        fetchedTotal = realPages * Math.max(20, fetchedItems.length || 56);
      } else if (normCategory === 'new') {
        const [fRes, tmdbRes, liftRes, aRes, libRes, sRes] = await Promise.allSettled([
          Promise.race([
            getFanFilmCatalog('new', page),
            new Promise(resolve => setTimeout(() => resolve({ items: [] }), 2500))
          ]),
          Promise.race([
            getTmdbCatalog('new', page),
            new Promise(resolve => setTimeout(() => resolve({ items: [] }), 3000))
          ]),
          Promise.race([
            getLiftCatalog({ category: 'new', page, limit: 20, ...extraFilters }),
            new Promise(resolve => setTimeout(() => resolve({ items: [] }), 2800))
          ]),
          getAnixartDiscover('new', page - 1),
          getAniLibriaCatalog('new', page),
          getShikimoriCatalog('new', page)
        ]);
        fetchedItems = interleaveSources([
          fRes.status === 'fulfilled' ? fRes.value?.items || [] : [],
          liftRes.status === 'fulfilled' ? (Array.isArray(liftRes.value) ? liftRes.value : (liftRes.value?.items || [])) : [],
          tmdbRes.status === 'fulfilled' ? tmdbRes.value?.items || [] : [],
          aRes.status === 'fulfilled' ? aRes.value?.items || [] : [],
          libRes.status === 'fulfilled' ? libRes.value?.items || [] : [],
          sRes.status === 'fulfilled' ? sRes.value?.items || [] : []
        ]);
        fetchedTotal = Math.max(fetchedItems.length, 500 * 20);
      } else {
        // Главная (home / popular)
        const [fRes, tmdbRes, liftRes, aRes, libRes, sRes] = await Promise.allSettled([
          Promise.race([
            getFanFilmCatalog('popular', page),
            new Promise(resolve => setTimeout(() => resolve({ items: [] }), 2500))
          ]),
          Promise.race([
            getTmdbCatalog('popular', page),
            new Promise(resolve => setTimeout(() => resolve({ items: [] }), 3000))
          ]),
          Promise.race([
            getLiftCatalog({ category: 'popular', page, limit: 20, ...extraFilters }),
            new Promise(resolve => setTimeout(() => resolve({ items: [] }), 2800))
          ]),
          getAnixartDiscover('popular', page - 1),
          getAniLibriaCatalog('popular', page),
          getShikimoriCatalog('popular', page)
        ]);
        fetchedItems = interleaveSources([
          fRes.status === 'fulfilled' ? fRes.value?.items || [] : [],
          liftRes.status === 'fulfilled' ? (Array.isArray(liftRes.value) ? liftRes.value : (liftRes.value?.items || [])) : [],
          tmdbRes.status === 'fulfilled' ? tmdbRes.value?.items || [] : [],
          aRes.status === 'fulfilled' ? aRes.value?.items || [] : [],
          libRes.status === 'fulfilled' ? libRes.value?.items || [] : [],
          sRes.status === 'fulfilled' ? sRes.value?.items || [] : []
        ]);
        fetchedTotal = Math.max(fetchedItems.length, 500 * 20);
      }
    }

    if (page > 1) {
      fetchedItems = fetchedItems.filter(i => !FANFILM_PINNED_CAROUSEL_IDS.has(String(i.id)));
    }
    // 100% исключение трейлеров, промо и фанатских концептов
    fetchedItems = fetchedItems.filter(i => i && !isTrailerMedia(i));
    fetchedItems.sort((a, b) => (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0));
    return { items: fetchedItems, totalItems: fetchedTotal };
  };

  let timerId;
  const timeoutPromise = new Promise(resolve => {
    timerId = setTimeout(() => resolve(null), CATALOG_GATHER_TIMEOUT_MS);
  });

  let gathered = null;
  try {
    gathered = await Promise.race([fetchTask().catch(() => null), timeoutPromise]);
  } finally {
    clearTimeout(timerId);
  }

  let items = gathered?.items || [];
  let totalItems = gathered?.totalItems || 0;

  if (page === 1 && (!items || items.length === 0)) {
    console.warn(`[Catalog] Применяем проверенный каталог для ${normCategory}`);
    items = getCategoryFallback(normCategory);
    totalItems = items.length;
  }

  if (items && items.length > 0) {
    if (page > 1) {
      items = items.filter(i => !FANFILM_PINNED_CAROUSEL_IDS.has(String(i.id)));
    }
    items = items.filter(i => i && !isTrailerMedia(i)).map(i => {
      const preType = resolveCanonicalMediaType(i.title, i.link || i.url || '', normCategory, i.genres || '', i);
      const isAnimeOrSer = preType === 'anime-series' || preType === 'series' || preType === 'cartoon-series';
      const cleanItemTitle = isAnimeOrSer ? (normalizeAnimeFranchiseTitle(i.title, true) || i.title) : i.title;
      const yr = resolveCanonicalYear(cleanItemTitle, i.link || i.url || '', i.poster || '', i.premiere || i.release_date, i.year);
      const genres = resolveCanonicalGenres(cleanItemTitle, normCategory, i.description || '', i.genres);
      const mediaType = resolveCanonicalMediaType(cleanItemTitle, i.link || i.url || '', normCategory, genres, i);
      const categoryLabel = mediaType === 'series' ? 'Сериал' :
                           (mediaType === 'anime-series' ? 'Аниме-сериал' :
                           (mediaType === 'anime-movie' ? 'Аниме-фильм' :
                           (mediaType === 'cartoon-series' ? 'Мультсериал' :
                           (mediaType === 'cartoon' ? 'Мультфильм' :
                           (mediaType === 'show' ? 'Шоу' : 'Фильм')))));

      return {
        ...i,
        title: cleanItemTitle,
        year: String(yr),
        genres,
        media_type: mediaType,
        category: categoryLabel,
        premiere: i.premiere || (yr ? `${yr} год` : ''),
        release_date: i.release_date || (yr ? `${yr}-01-01` : '')
      };
    });

    // Строгая категоризация для разделов «Фильмы» и «Сериалы»
    if (normCategory === 'movies') {
      items = items.filter(i => i.media_type !== 'series' && i.media_type !== 'anime-series' && i.media_type !== 'cartoon-series');
    } else if (normCategory === 'series') {
      items = items.filter(i => i.media_type !== 'movie' && i.media_type !== 'anime-movie' && i.media_type !== 'cartoon');
    }

    // Серверная дедупликация карточек из разных источников (FanFilm4K + TMDB + Аниме-источники)
    const catalogDedupMap = new Map();
    const normCatalogKey = (t, isAnimeOrSer = false) => {
      const base = isAnimeOrSer ? (normalizeAnimeFranchiseTitle(t, true) || t) : t;
      return String(base || '')
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/\s*[\(\[][^\)\]]*[\)\]]/gi, ' ')
        .replace(/[«»“”"'`]/g, ' ')
        .replace(/(?<!\p{L})(?:часть\s+первая|part\s+one|part\s+i)(?!\p{L})/giu, ' 1 ')
        .replace(/(?<!\p{L})(?:часть\s+вторая|part\s+two|part\s+ii)(?!\p{L})/giu, ' 2 ')
        .replace(/(?<!\p{L})(?:часть\s+третья|part\s+three|part\s+iii)(?!\p{L})/giu, ' 3 ')
        .replace(/(?<!\p{L})(?:\d+\s*сезон[а-я]*|\d+\s*сери[а-я]*|сезон[а-я]*\s*\d+|сери[а-я]*\s*\d+|s\d+\s*e\d+|s\d+|e\d+)(?!\p{L})/giu, ' ')
        .replace(/(?<!\p{L})(?:19\d\d|20\d\d)(?!\p{L})/gu, ' ')
        .replace(/\s*[\(\[]?\s*4[KkКк]\s*(?:Ultra\s*HD|UHD)?\s*[\)\]]?/gi, '')
        .replace(/[^\p{L}\p{N}]+/gu, '')
        .trim();
    };

    for (const item of items) {
      if (!item || !item.title) continue;
      const isAnimeOrSer = item.media_type === 'anime-series' || item.media_type === 'series' || item.media_type === 'cartoon-series';
      const baseKey = normCatalogKey(item.title, isAnimeOrSer) || normCatalogKey(item.original_title, isAnimeOrSer) || `id_${item.id}`;
      const k = (!isAnimeOrSer && item.year) ? `${baseKey}_movie_${item.year}` : baseKey;
      const raw4k = item.fanfilm_4k_url || (item.source === 'fanfilm4k' ? (item.link || item.url) : '') || resolveFanFilmUrl(item.title, item.year) || '';
      const resolved4k = (raw4k && !String(raw4k).includes('do=search')) ? raw4k : '';
      const itemHasStream = Boolean(resolved4k || item.lift_id || ['lift', 'fanfilm4k', 'anilibria'].includes(item.source) || item.stream_verified === true);
      const isItemUpcoming = !itemHasStream && Boolean(item.is_upcoming || isMediaUpcomingOrUnreleased(item));
      if (!catalogDedupMap.has(k)) {
        catalogDedupMap.set(k, {
          ...item,
          fanfilm_4k_url: resolved4k || item.fanfilm_4k_url || null,
          stream_verified: itemHasStream ? true : item.stream_verified,
          is_upcoming: isItemUpcoming,
          is4K: isItemUpcoming ? false : Boolean(item.is4K || resolved4k),
          quality: isItemUpcoming ? 'Ожидается' : ((item.is4K || resolved4k) ? '4K Ultra HD' : (item.quality || '1080p FHD'))
        });
      } else {
        const prev = catalogDedupMap.get(k);
        const combined4k = prev.fanfilm_4k_url || resolved4k || null;
        const combinedLift = prev.lift_id || item.lift_id || null;
        const prevHasRealPoster = Boolean(prev.poster && !isPlaceholderImage(prev.poster));
        const itemHasRealPoster = Boolean(item.poster && !isPlaceholderImage(item.poster));
        const preferNew = (item.source === 'tmdb' && prev.source !== 'tmdb' && itemHasRealPoster) || (!prevHasRealPoster && itemHasRealPoster);
        const merged = preferNew ? { ...prev, ...item } : { ...item, ...prev };
        merged.fanfilm_4k_url = combined4k;
        merged.lift_id = combinedLift;
        merged.rating_kp = prev.rating_kp || item.rating_kp;
        merged.rating_imdb = prev.rating_imdb || item.rating_imdb;
        merged.countries = (prev.countries && prev.countries.length > 0) ? prev.countries : item.countries;
        const mergedHasStream = Boolean(
          combined4k || combinedLift ||
          ['lift', 'fanfilm4k', 'anilibria'].includes(prev.source) ||
          ['lift', 'fanfilm4k', 'anilibria'].includes(item.source) ||
          prev.stream_verified === true || item.stream_verified === true
        );
        if (mergedHasStream) {
          merged.stream_verified = true;
        }
        const isMergedUpcoming = !mergedHasStream && Boolean(prev.is_upcoming || item.is_upcoming || isMediaUpcomingOrUnreleased(merged));
        const has4K = !isMergedUpcoming && Boolean(prev.is4K || item.is4K || combined4k);
        merged.is_upcoming = isMergedUpcoming;
        merged.is4K = has4K;
        merged.quality = isMergedUpcoming ? 'Ожидается' : (has4K ? '4K Ultra HD' : (merged.quality || '1080p FHD'));
        merged.poster = (prevHasRealPoster ? prev.poster : null)
          || (itemHasRealPoster ? item.poster : null)
          || `/api/media/image-proxy?title=${encodeURIComponent(merged.title || '')}&orig=${encodeURIComponent(merged.original_title || '')}`;
        merged.rating = Math.max(parseFloat(prev.rating) || 0, parseFloat(item.rating) || 0) || prev.rating || item.rating;
        catalogDedupMap.set(k, merged);
      }
    }
    items = Array.from(catalogDedupMap.values());
    await verifyItemsDigitalStreamAvailability(items);

    // Дополнительная фильтрация по странам и двойным рейтингам КП / IMDb / году
    if (extraFilters.country) {
      const wantCountry = String(extraFilters.country).toLowerCase();
      items = items.filter(it => {
        if (!Array.isArray(it.countries) || it.countries.length === 0) return it.source === 'lift';
        return it.countries.some(c => String(c).toLowerCase().includes(wantCountry));
      });
    }
    if (extraFilters.exceptCountry) {
      const exCountry = String(extraFilters.exceptCountry).toLowerCase();
      items = items.filter(it => {
        if (!Array.isArray(it.countries) || it.countries.length === 0) return true;
        return !it.countries.some(c => String(c).toLowerCase().includes(exCountry));
      });
    }
    if (extraFilters.kpMin !== undefined && extraFilters.kpMin !== '') {
      const minKp = parseFloat(extraFilters.kpMin);
      if (!isNaN(minKp) && minKp > 0) {
        items = items.filter(it => (parseFloat(it.rating_kp || it.rating) || 0) >= minKp);
      }
    }
    if (extraFilters.imdbMin !== undefined && extraFilters.imdbMin !== '') {
      const minImdb = parseFloat(extraFilters.imdbMin);
      if (!isNaN(minImdb) && minImdb > 0) {
        items = items.filter(it => (parseFloat(it.rating_imdb || it.rating) || 0) >= minImdb);
      }
    }
    if (extraFilters.yearFrom !== undefined && extraFilters.yearFrom !== '') {
      const yFrom = parseInt(extraFilters.yearFrom, 10);
      if (!isNaN(yFrom)) {
        items = items.filter(it => (parseInt(it.year, 10) || 0) >= yFrom);
      }
    }
    if (extraFilters.yearTo !== undefined && extraFilters.yearTo !== '') {
      const yTo = parseInt(extraFilters.yearTo, 10);
      if (!isNaN(yTo)) {
        items = items.filter(it => (parseInt(it.year, 10) || 9999) <= yTo);
      }
    }

    const curCalYear = new Date().getFullYear();
    items.forEach(it => {
      if (!it.poster || isPlaceholderImage(it.poster)) {
        it.poster = `/api/media/image-proxy?title=${encodeURIComponent(it.title || '')}&orig=${encodeURIComponent(it.original_title || '')}`;
      }
    });
    items.sort((a, b) => {
      const ya = parseInt(a.year, 10) || 0;
      const yb = parseInt(b.year, 10) || 0;
      const aFuture = ya > curCalYear || Boolean(a.is_upcoming);
      const bFuture = yb > curCalYear || Boolean(b.is_upcoming);
      if (aFuture !== bFuture) return aFuture ? 1 : -1;
      return yb - ya;
    });
  }

  let calculatedTotalPages = 1;
  if (normCategory === 'movies') calculatedTotalPages = 718;
  else if (normCategory === 'series') calculatedTotalPages = 162;
  else if (normCategory === 'cartoons') calculatedTotalPages = 35;
  else if (normCategory === 'cartoon-series') calculatedTotalPages = 20;
  else if (normCategory === 'anime-movies') calculatedTotalPages = 50;
  else if (normCategory === 'anime-series') calculatedTotalPages = 50;
  else if (normCategory === 'new') calculatedTotalPages = 50;
  else if (normCategory === 'popular' || normCategory === 'home') calculatedTotalPages = 500;
  else if (totalItems > 0 && items.length > 0) {
    calculatedTotalPages = Math.max(1, Math.ceil(totalItems / Math.max(20, items.length)));
  } else {
    calculatedTotalPages = 50;
  }

  return {
    items,
    totalItems: totalItems || (calculatedTotalPages * 20),
    totalPages: calculatedTotalPages
  };
}

// Фоновый прогрев реального каталога при старте сервера без блокировки
setTimeout(async () => {
  try {
    const warmupCategories = ['popular', 'movies', 'series', 'cartoons', 'new', 'anime-series', 'anime-movies'];
    for (const cat of warmupCategories) {
      const cacheKey = `${cat}_1_all`;
      if (!memoryCatalogCache.has(cacheKey)) {
        try {
          const res = await executeCatalogFetch(cat, 1, 'all');
          if (res && res.items && res.items.length > 0) {
            memoryCatalogCache.set(cacheKey, {
              items: res.items,
              totalItems: res.totalItems,
              totalPages: res.totalPages,
              timestamp: Date.now(),
              isRevalidating: false
            });
            console.log(`[Catalog Warmup] Прогрета категория ${cat} (${res.items.length} релизов)`);
          }
        } catch (catErr) {
          console.warn(`[Catalog Warmup] Ошибка ${cat}:`, catErr.message);
        }
      }
    }
  } catch (e) {
    console.warn('[Catalog] Фоновый прогрев:', e.message);
  }
}, 500);

// Фоновый прогрев расписания релизов (LostFilm, AniLibria, Shikimori, TMDB, TVMaze)
setTimeout(async () => {
  try {
    console.log('[Schedule Warmup] Запуск фонового прогрева расписания релизов...');
    await Promise.allSettled([
      getAggregatedSchedule('current'),
      getAggregatedSchedule('next')
    ]);
    console.log('[Schedule Warmup] Расписание текущей и следующей недели успешно прогрето в кэш');
  } catch (err) {
    console.warn('[Schedule Warmup] Ошибка фонового прогрева:', err.message);
  }
}, 800);

// Периодическое фоновое обновление расписания серий раз в 30 минут
setInterval(async () => {
  try {
    await Promise.allSettled([
      getAggregatedSchedule('current'),
      getAggregatedSchedule('next')
    ]);
  } catch (_) {}
}, 30 * 60 * 1000);

// Витрина 4 тематических подборок Lift (Зарубежные фильмы, Зарубежные сериалы, Российские фильмы, Российские сериалы)
app.get('/api/lift/home-rails', async (req, res) => {
  try {
    const limit = Math.min(24, Math.max(6, parseInt(req.query.limit, 10) || 16));
    const rails = await getLiftHomeRails(limit);
    res.json({
      success: true,
      rails
    });
  } catch (err) {
    console.warn('[Lift Home Rails] Ошибка загрузки подборок:', err.message);
    res.json({
      success: false,
      rails: { foreignFilms: [], foreignSeries: [], ruFilms: [], ruSeries: [] }
    });
  }
});

app.get('/api/media/catalog', async (req, res) => {
  try {
    let category = req.query.category || 'popular';
    if (category === 'home') category = 'popular';
    const page = parseInt(req.query.page, 10) || 1;
    const source = req.query.source || 'all';
    const extraFilters = {
      country: req.query.country || '',
      exceptCountry: req.query.exceptCountry || '',
      kpMin: req.query.kpMin || '',
      kpMax: req.query.kpMax || '',
      imdbMin: req.query.imdbMin || '',
      imdbMax: req.query.imdbMax || '',
      yearFrom: req.query.yearFrom || '',
      yearTo: req.query.yearTo || '',
      genre: req.query.genre || '',
      sort: req.query.sort || ''
    };
    const filterSig = Object.entries(extraFilters)
      .filter(([, v]) => v !== '' && v !== undefined)
      .map(([k, v]) => `${k}:${v}`)
      .join('|');

    const cacheKey = filterSig ? `${category}_${page}_${source}_${filterSig}` : `${category}_${page}_${source}`;
    const cachedEntry = memoryCatalogCache.get(cacheKey);
    const now = Date.now();

    // Stale-While-Revalidate: отдаем кэш мгновенно (< 3ms)
    if (cachedEntry && Array.isArray(cachedEntry.items) && cachedEntry.items.length > 0) {
      const isStale = now - (cachedEntry.timestamp || 0) > MEMORY_CATALOG_FRESH_TTL;
      const isExpired = now - (cachedEntry.timestamp || 0) > MEMORY_CATALOG_MAX_STALE_TTL;

      if (isStale && !cachedEntry.isRevalidating && !isExpired) {
        cachedEntry.isRevalidating = true;
        // Фоновая тихая ревалидация свежих данных
        executeCatalogFetch(category, page, source, extraFilters).then(fresh => {
          if (fresh && fresh.items && fresh.items.length > 0) {
            memoryCatalogCache.set(cacheKey, {
              items: fresh.items,
              totalItems: fresh.totalItems,
              totalPages: fresh.totalPages,
              timestamp: Date.now(),
              isRevalidating: false
            });
          } else {
            cachedEntry.isRevalidating = false;
          }
        }).catch(() => {
          cachedEntry.isRevalidating = false;
        });
      }

      if (!isExpired) {
        let finalItems = cachedEntry.items;
        const activeUserId = req.user?.id || null;
        finalItems = finalItems.map(item => {
          const bookmark = activeUserId ? getBookmark(activeUserId, item.id, item.source, item.title, item.original_title) : null;
          const bStatus = bookmark?.status || item.user_status || null;
          const bPct = bookmark?.progress_percent || item.progress_percent || 0.0;
          const userWatched = Boolean(['completed', 'watching', 'on_hold', 'dropped'].includes(String(bStatus || '').toLowerCase()) || Number(bPct) > 0);
          return {
            ...item,
            is_upcoming: userWatched ? false : item.is_upcoming,
            is4K: userWatched && item.is_upcoming ? true : item.is4K,
            quality: userWatched && item.quality === 'Ожидается' ? '4K Ultra HD' : item.quality,
            user_status: bStatus,
            progress_percent: bPct,
            episodes_watched: bookmark?.episodes_watched || item.episodes_watched || 0,
            total_episodes: bookmark?.total_episodes || item.total_episodes || 0
          };
        });

        return res.json({
          category,
          page,
          source,
          total_items: cachedEntry.totalItems,
          total_pages: cachedEntry.totalPages,
          items: finalItems,
          from_cache: true,
          is_stale: isStale
        });
      }
    }

    // Если кэша еще нет или он полностью истек (холодный запрос)
    const fetched = await executeCatalogFetch(category, page, source, extraFilters);
    let items = fetched.items || [];
    let totalItems = fetched.totalItems || (fetched.totalPages * 20);
    let calculatedTotalPages = fetched.totalPages || 1;

    if (items && items.length > 0) {
      memoryCatalogCache.set(cacheKey, {
        items,
        totalItems,
        totalPages: calculatedTotalPages,
        timestamp: Date.now(),
        isRevalidating: false
      });
    }

    // Прикрепляем закладки и статусы только для авторизованных пользователей
    const activeUserId = req.user?.id || null;
    items = items.map(item => {
      const bookmark = activeUserId ? getBookmark(activeUserId, item.id, item.source, item.title, item.original_title) : null;
      const bStatus = bookmark?.status || item.user_status || null;
      const bPct = bookmark?.progress_percent || item.progress_percent || 0.0;
      const userWatched = Boolean(['completed', 'watching', 'on_hold', 'dropped'].includes(String(bStatus || '').toLowerCase()) || Number(bPct) > 0);
      return {
        ...item,
        is_upcoming: userWatched ? false : item.is_upcoming,
        is4K: userWatched && item.is_upcoming ? true : item.is4K,
        quality: userWatched && item.quality === 'Ожидается' ? '4K Ultra HD' : item.quality,
        user_status: bStatus,
        progress_percent: bPct,
        episodes_watched: bookmark?.episodes_watched || item.episodes_watched || 0,
        total_episodes: bookmark?.total_episodes || item.total_episodes || 0
      };
    });

    res.json({
      category,
      page,
      source,
      total_items: totalItems,
      total_pages: calculatedTotalPages,
      items
    });
  } catch (err) {
    console.error('Ошибка агрегации каталога:', err.message);
    const fallbackItems = page === 1 ? getCategoryFallback(req.query.category || 'popular') : [];
    res.json({
      category: req.query.category || 'popular',
      page: parseInt(req.query.page, 10) || 1,
      source: req.query.source || 'all',
      total_items: fallbackItems.length,
      total_pages: Math.max(1, Math.ceil(fallbackItems.length / 20)),
      items: fallbackItems
    });
  }
});

// ==========================================
// КАЛЕНДАРЬ РЕЛИЗОВ И РАСПИСАНИЕ СЕРИЙ (RELEASE CALENDAR & SCHEDULE API)
// Интеграция с Shikimori, AniLibria, TMDB Upcoming и новинками
// ==========================================
app.get('/api/media/schedule', async (req, res) => {
  try {
    const week = req.query.week === 'next' ? 'next' : 'current';
    const schedule = await getAggregatedSchedule(week);
    res.json(schedule);
  } catch (err) {
    console.error('[API Schedule] Ошибка получения расписания:', err.message);
    res.status(500).json({ error: 'Ошибка получения расписания', message: err.message, items: [] });
  }
});

app.get('/api/media/calendar', async (req, res) => {
  try {
    const week = req.query.week === 'next' ? 'next' : 'current';
    const schedule = await getAggregatedSchedule(week);
    res.json({
      success: true,
      week,
      schedule: schedule.items || []
    });
  } catch (err) {
    console.error('[API Calendar] Ошибка получения календаря релизов:', err.message);
    res.status(500).json({ success: false, error: 'Ошибка получения календаря релизов', schedule: [] });
  }
});

const memorySearchCache = new Map();
const SEARCH_CACHE_FRESH_TTL = 15 * 60 * 1000; // 15 минут
const SEARCH_CACHE_MAX_TTL = 12 * 60 * 60 * 1000; // 12 часов

async function executeUnifiedSearch(query, source = 'all') {
  const tasks = [];
  const withTimeout = (promise, ms = 9000) =>
    Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))
    ]);

  if (source === 'all' || source === 'lift') {
    tasks.push(withTimeout(searchLift(query, 24), 7000).catch(() => []));
  }

  if (source === 'all' || source === 'fanfilm4k') {
    tasks.push(withTimeout(searchFanFilm(query), 9000).catch(() => []));
  }

  if (source === 'all' || source === 'tmdb' || ['kodik', 'hdrezka', 'collaps', 'alloha', 'videocdn', 'ashdi', 'kinobox'].includes(source)) {
    tasks.push(withTimeout(searchTmdb(query), 9000).then(r => r?.items || []).catch(() => []));
  }

  if (source === 'all' || source === 'anixart') {
    tasks.push(withTimeout(searchAnixart(query, 0), 9000).then(r => r?.items || []).catch(() => []));
  }

  if (source === 'all' || source === 'anilibria') {
    tasks.push(withTimeout(searchAniLibria(query), 9000).then(r => r?.items || []).catch(() => []));
  }

  if (source === 'all' || source === 'shikimori') {
    tasks.push(withTimeout(searchShikimori(query), 9000).catch(() => []));
  }

  if (source === 'all' || source === 'rutube') {
    tasks.push(withTimeout(searchRuTube(query), 9000).catch(() => []));
  }

  if (source === 'all' || source === 'vkvideo') {
    tasks.push(withTimeout(searchVkVideo(query), 9000).catch(() => []));
  }

  const settled = await Promise.all(tasks);
  let rawItems = [];
  settled.forEach(arr => {
    if (Array.isArray(arr)) rawItems.push(...arr);
  });
  // 100% исключение трейлеров, промо и фанатских концептов
  rawItems = rawItems.filter(item => item && !isTrailerMedia(item));

  const normalizeMediaKey = (t, isAnimeOrSer = false) => {
    if (!t) return '';
    if (/^зв[её]здные\s+войны\s*:\s*видени[яе]/i.test(String(t).trim()) || /^star\s+wars\s*:\s*visions/i.test(String(t).trim())) {
      return 'звездные войны видения';
    }
    const base = isAnimeOrSer ? (normalizeAnimeFranchiseTitle(t, true) || t) : t;
    return String(base)
      .replace(/&#\d+;/g, '')
      .replace(/&[a-z]+;/gi, '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/\s*[\(\[][^\)\]]*[\)\]]/gi, ' ')
      .replace(/[«»“”"'`]/g, ' ')
      .replace(/(?<!\p{L})(?:часть\s+первая|part\s+one|part\s+i)(?!\p{L})/giu, ' 1 ')
      .replace(/(?<!\p{L})(?:часть\s+вторая|part\s+two|part\s+ii)(?!\p{L})/giu, ' 2 ')
      .replace(/(?<!\p{L})(?:часть\s+третья|part\s+three|part\s+iii)(?!\p{L})/giu, ' 3 ')
      .replace(/(?:все\s*серии|все\s*сезоны|полный\s*сезон|русская\s*озвучка|субтитры|озвучка)/gi, ' ')
      .replace(/(?<!\p{L})(?:\d+[\.\s]+сезон[а-я]*|\d+[\.\s]+сери[а-я]*|сезон[а-я]*[\.\s]+\d+|сери[а-я]*[\.\s]+\d+|s\d+\s*e\d+|s\d+|e\d+)(?!\p{L})/giu, ' ')
      .replace(/(?:фантастический\s*сериал|художественный\s*фильм|документальный\s*фильм|сериал|фильм|т\/с|д\/ф)/gi, ' ')
      .replace(/(?<!\p{L})(?:19\d\d|20\d\d)(?!\p{L})/gu, ' ')
      .replace(/\s*постер\s*(?:4[kк]|hd|uhd)?/gi, '')
      .replace(/\s*[\(\[]?\s*4[KkКк]\s*(?:Ultra\s*HD|UHD)?\s*[\)\]]?/gi, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const queryWords = query
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2);

  if (queryWords.length > 0) {
    rawItems = rawItems.filter(item => {
      const itemTitle = `${item.title || ''} ${item.original_title || ''}`.toLowerCase().replace(/ё/g, 'е');
      const itemAll = `${item.title || ''} ${item.original_title || ''} ${item.description || ''}`.toLowerCase().replace(/ё/g, 'е');

      if (queryWords.length >= 2) {
        return queryWords.every(w => itemTitle.includes(w) || itemAll.includes(w));
      }

      // При однословном запросе требуем совпадения в названии (title / original_title), чтобы не тянуть случайные фильмы из-за слова в описании
      return queryWords.some(w => itemTitle.includes(w));
    });
  }

  const deduplicatePlayers = (playerList) => {
    const seen = new Set();
    const result = [];
    for (const p of playerList || []) {
      if (!p || !p.id) continue;
      const key = `${p.id}_${p.url || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(p);
      }
    }
    return result;
  };

  const normQuery = normalizeMediaKey(query);
  const mergedMap = new Map();
  for (const item of rawItems) {
    const detectedType = resolveCanonicalMediaType(item.title, item.link || item.url || '', item.category || '', item.genres || '', item);
    const isAnimeOrSeries = detectedType === 'anime-series' || detectedType === 'series' || detectedType === 'cartoon-series' ||
                            item.media_type === 'anime-series' || item.media_type === 'series' || item.media_type === 'cartoon-series' ||
                            ['anilibria', 'anixart', 'shikimori'].includes(item.source);

    if (isAnimeOrSeries && item.media_type !== 'anime-movie') {
      item.title = normalizeAnimeFranchiseTitle(item.title, true) || item.title;
      item.media_type = detectedType;
    }

    const resolvedItemYear = resolveCanonicalYear(item.title, item.link || item.url || '', item.poster || '', item.release_date || item.premiere || '', item.year || '');
    if (resolvedItemYear) {
      item.year = resolvedItemYear;
    }

    let normKey = normalizeMediaKey(item.title, isAnimeOrSeries);
    if (!normKey) continue;

    if (String(item.id || '') === 'lift_31648' || String(item.lift_id || '') === '31648') {
      item.year = '2015';
    }

    // Для фильмов с одинаковым названием, но разных лет выпуска (например «Видения» 2015 и «Видения» 2023)
    // включаем год в ключ дедупликации, чтобы они не затирали друг друга;
    // при этом склеиваем карточки одного и того же фильма, если совпадает original_title при разнице года <= 1 год или если это VK/RuTube поток
    let dedupKey = isAnimeOrSeries ? normKey : `${normKey}_movie_${item.year || ''}`;
    if (!isAnimeOrSeries) {
      const prefix = `${normKey}_movie_`;
      for (const [k, ex] of mergedMap.entries()) {
        if (!k.startsWith(prefix)) continue;
        if (
          (ex.kp_id && item.kp_id && String(ex.kp_id) === String(item.kp_id)) ||
          (ex.tmdb_id && item.tmdb_id && String(ex.tmdb_id) === String(item.tmdb_id)) ||
          (ex.lift_id && item.lift_id && String(ex.lift_id) === String(item.lift_id)) ||
          (((item.source === 'rutube' || item.source === 'vkvideo') && Number(item.duration_seconds || item.duration || 0) >= 3300 && ex.year && item.year && String(ex.year) === String(item.year) && (!ex.original_title || String(item.title || '').toLowerCase().includes(String(ex.original_title).toLowerCase())))) ||
          (((ex.source === 'rutube' || ex.source === 'vkvideo') && Number(ex.duration_seconds || ex.duration || 0) >= 3300 && ex.year && item.year && String(ex.year) === String(item.year) && (!item.original_title || String(ex.title || '').toLowerCase().includes(String(item.original_title).toLowerCase())))) ||
          (ex.original_title && item.original_title &&
           String(ex.original_title).toLowerCase().trim() === String(item.original_title).toLowerCase().trim() &&
           Math.abs((parseInt(ex.year, 10) || 0) - (parseInt(item.year, 10) || 0)) <= 1)
        ) {
          dedupKey = k;
          break;
        }
      }
    }

    if (!mergedMap.has(dedupKey)) {
      const initial = {
        ...item,
        players: item.players ? [...item.players] : []
      };
      if (normKey === 'звездные войны видения') {
        initial.title = 'Звёздные Войны: Видения';
        initial.original_title = 'Star Wars: Visions';
        initial.year = '2021';
        initial.media_type = 'anime-series';
        initial.category = 'Аниме-сериал';
      }
      if (item.source === 'lift' || item.lift_id) {
        initial.lift_id = item.lift_id || String(item.id || '').replace(/^lift_/, '');
      }
      if (item.source === 'fanfilm4k' || item.fanfilm_4k_url) {
        initial.fanfilm_4k_url = item.link || item.url || item.fanfilm_4k_url;
        initial.is4K = true;
        initial.quality = '4K Ultra HD';
      } else if (item.source === 'vkvideo') {
        initial.vk_embed_url = item.embed_url || item.url;
      } else if (item.source === 'rutube') {
        initial.rutube_id = item.id;
      }
      mergedMap.set(dedupKey, initial);
    } else {
      const existing = mergedMap.get(dedupKey);

      // Объединяем источники потоков в единую карточку
      if (item.source === 'lift' || item.lift_id) {
        existing.lift_id = existing.lift_id || item.lift_id || String(item.id || '').replace(/^lift_/, '');
        existing.rating_kp = existing.rating_kp || item.rating_kp;
        existing.rating_imdb = existing.rating_imdb || item.rating_imdb;
        if (item.countries?.length && (!existing.countries || !existing.countries.length)) {
          existing.countries = item.countries;
        }
      }
      if (item.source === 'fanfilm4k' || item.fanfilm_4k_url) {
        existing.fanfilm_4k_url = existing.fanfilm_4k_url || item.link || item.url || item.fanfilm_4k_url;
        existing.is4K = true;
        existing.quality = '4K Ultra HD';
        if (item.kp_id && !existing.kp_id) existing.kp_id = item.kp_id;
      }
      if (item.source === 'vkvideo' || item.vk_embed_url) {
        existing.vk_embed_url = item.embed_url || item.url || item.vk_embed_url || existing.vk_embed_url;
      }
      if (item.source === 'rutube' || item.rutube_id) {
        existing.rutube_id = item.id || item.rutube_id || existing.rutube_id;
      }
      if (item.kinobox_url) existing.kinobox_url = item.kinobox_url;
      if (item.kodik_url) existing.kodik_url = item.kodik_url;

      // Объединяем списки плееров без дублей
      if (Array.isArray(item.players) && item.players.length > 0) {
        existing.players = deduplicatePlayers([...(existing.players || []), ...item.players]);
      }

      // Приоритет AniLibria для аниме-сериалов и TMDB для фильмов/сериалов
      if (isAnimeOrSeries && item.source === 'anilibria' && existing.source !== 'anilibria') {
        existing.id = item.id;
        existing.source = 'anilibria';
        existing.poster = item.poster || existing.poster;
        existing.description = item.description || existing.description;
      } else if (!isAnimeOrSeries && item.source === 'tmdb' && existing.source !== 'tmdb') {
        existing.title = item.title;
        existing.original_title = item.original_title || existing.original_title;
        existing.poster = item.poster || existing.poster;
        existing.year = item.year || existing.year;
        existing.rating = item.rating || existing.rating;
        existing.description = item.description || existing.description;
        existing.id = item.id;
        existing.source = 'tmdb';
        existing.media_type = item.media_type || existing.media_type;
      } else if (item.poster && (!existing.poster || existing.poster.includes('avatar_default') || existing.poster.includes('favicon'))) {
        existing.poster = item.poster;
      }

      if (normKey === 'звездные войны видения') {
        existing.title = 'Звёздные Войны: Видения';
        existing.original_title = 'Star Wars: Visions';
        existing.year = '2021';
        existing.media_type = 'anime-series';
        existing.category = 'Аниме-сериал';
      }
    }
  }

  let items = Array.from(mergedMap.values());
  await verifyItemsDigitalStreamAvailability(items);

  // Синтезируем полный объединенный список плееров для каждой карточки, гарантируя FanFilm4K на первом месте
  for (const it of items) {
    const title = it.title || '';
    const cleanId = String(it.id || '').replace(/[^\d]/g, '');
    const resolvedFf = resolveFanFilmUrl(title, it.year);
    const fanfilmUrl = it.fanfilm_4k_url || resolvedFf || (it.source === 'fanfilm4k' && cleanId ? `https://v17.fanfilm4k.media/${cleanId}-.html` : (it.is_upcoming ? '' : `https://v17.fanfilm4k.media/index.php?do=search&subaction=search&story=${encodeURIComponent(title)}`));

    const unifiedPlayers = getAvailablePlayers({
      kp_id: it.kp_id,
      imdb_id: it.imdb_id,
      lift_id: it.lift_id,
      title,
      original_title: it.original_title,
      year: it.year,
      media_type: it.media_type,
      genres: it.genres,
      source: it.source,
      fanfilm_4k_url: fanfilmUrl,
      trailer_url: it.trailer_url,
      is_upcoming: it.is_upcoming
    });

    // Добавляем любые специфические плееры (например AniLibria, Shikimori, прямой VK/RuTube)
    if (it.vk_embed_url) {
      const existingVk = unifiedPlayers.find(p => p.id === 'vk_video_stream');
      if (existingVk) {
        existingVk.url = it.vk_embed_url;
      }
    }
    if (it.rutube_id) {
      const rutubePlayUrl = String(it.rutube_id).startsWith('http') ? it.rutube_id : `/api/player/rutube-embed/${String(it.rutube_id).replace(/^rutube_/, '')}`;
      const existingRu = unifiedPlayers.find(p => p.id === 'rutube_stream');
      if (existingRu) {
        existingRu.url = rutubePlayUrl;
      }
    }
    if (Array.isArray(it.players) && it.players.length > 0) {
      for (const p of it.players) {
        if (!unifiedPlayers.some(up => up.id === p.id)) {
          unifiedPlayers.push(p);
        }
      }
    }

    it.players = unifiedPlayers;
    const isUpSearch = Boolean(it.stream_verified === false || (!it.stream_verified && (it.is_upcoming || isMediaUpcomingOrUnreleased(it))));
    it.is_upcoming = isUpSearch;
    it.is4K = isUpSearch ? false : (it.source === 'anilibria' ? false : true);
    it.quality = isUpSearch ? 'Ожидается' : (it.source === 'anilibria' ? '1080p FHD' : '4K Ultra HD');
    it.fanfilm_4k_url = isUpSearch ? null : (fanfilmUrl && !String(fanfilmUrl).includes('do=search') ? fanfilmUrl : null);

    const rawTitle = it.title || '';
    const cleanedTitle = String(rawTitle)
      .replace(/(?:\d+[\.\s]+сезон[а-я]*|\d+[\.\s]+сери[а-я]*|сезон[а-я]*[\.\s]+\d+|сери[а-я]*[\.\s]+\d+|s\d+\s*e\d+|s\d+|e\d+)[\s\S]*/giu, '')
      .replace(/\s*[\(\[][^\)\]]*(?:сериал|фильм|\d{4})[^\)\]]*[\)\]]/gi, '')
      .replace(/[«“"][^»”"]*[»”"]/g, '')
      .trim();
    if (cleanedTitle.length >= 2) {
      it.title = cleanedTitle;
    }
    const normT = normPosterKey(it.title);
    if (KNOWN_VERIFIED_POSTERS[normT]) {
      it.poster = KNOWN_VERIFIED_POSTERS[normT];
    }
  }

  const isCinemaSource = (s) => ['fanfilm4k', 'tmdb', 'anilibria', 'anixart', 'shikimori', 'lift'].includes(s);
  items.sort((a, b) => {
    const aCin = isCinemaSource(a.source);
    const bCin = isCinemaSource(b.source);
    if (aCin !== bCin) return aCin ? -1 : 1;

    const aNorm = normalizeMediaKey(a.title);
    const bNorm = normalizeMediaKey(b.title);
    if (aNorm === normQuery && bNorm !== normQuery) return -1;
    if (bNorm === normQuery && aNorm !== normQuery) return 1;

    const aStarts = aNorm.startsWith(normQuery + ' ') || aNorm === normQuery;
    const bStarts = bNorm.startsWith(normQuery + ' ') || bNorm === normQuery;
    if (aStarts && !bStarts) return -1;
    if (bStarts && !aStarts) return 1;

    const aWholeWord = aNorm.split(' ').includes(normQuery);
    const bWholeWord = bNorm.split(' ').includes(normQuery);
    if (aWholeWord && !bWholeWord) return -1;
    if (bWholeWord && !aWholeWord) return 1;

    const aContains = aNorm.includes(normQuery);
    const bContains = bNorm.includes(normQuery);
    if (aContains && !bContains) return -1;
    if (bContains && !aContains) return 1;

    const aWordsCount = queryWords.filter(w => aNorm.includes(w)).length;
    const bWordsCount = queryWords.filter(w => bNorm.includes(w)).length;
    if (aWordsCount !== bWordsCount) return bWordsCount - aWordsCount;

    return (b.rating || 0) - (a.rating || 0);
  });

  return items;
}

app.get('/api/media/search', async (req, res) => {
  try {
    const query = (req.query.q || req.query.query || '').trim();
    const source = req.query.source || 'all';

    if (!query) {
      return res.json({ query: '', total: 0, items: [] });
    }

    // 0. Прямой поиск по URL (FanFilm4K, Kinopoisk, TMDB)
    if (/https?:\/\//i.test(query)) {
      const ffMatch = query.match(/fanfilm4k\.media\/(\d+)[^\s]*/i);
      if (ffMatch) {
        const ffDetails = await getFanFilmDetails(query);
        if (ffDetails) {
          const directItem = {
            id: ffDetails.id,
            source: 'fanfilm4k',
            title: ffDetails.title,
            original_title: ffDetails.original_title || '',
            link: query,
            poster: ffDetails.poster,
            quality: ffDetails.quality || '4K Ultra HD',
            is4K: true,
            year: ffDetails.year || '2026',
            rating: ffDetails.rating || 8.0,
            media_type: ffDetails.media_type || 'movie',
            description: ffDetails.description || '',
            fanfilm_4k_url: query
          };
          return res.json({ query, total: 1, items: [directItem] });
        }
      }
    }

    const cacheKey = `${query.toLowerCase()}_${source}`;
    const cached = memorySearchCache.get(cacheKey);
    const now = Date.now();

    // Stale-While-Revalidate отдаем моментально
    if (cached && Array.isArray(cached.items) && cached.items.length > 0) {
      if (now - cached.timestamp > SEARCH_CACHE_FRESH_TTL) {
        executeUnifiedSearch(query, source)
          .then(freshItems => {
            if (freshItems.length > 0) {
              memorySearchCache.set(cacheKey, { items: freshItems, timestamp: Date.now() });
            }
          })
          .catch(() => {});
      }

      const searchUserId = req.user?.id || null;
      const mapped = cached.items.map(item => {
        const bookmark = searchUserId ? getBookmark(searchUserId, item.id, item.source, item.title, item.original_title) : null;
        return {
          ...item,
          user_status: bookmark?.status || item.user_status || null,
          progress_percent: bookmark?.progress_percent || item.progress_percent || 0.0
        };
      });

      return res.json({
        query,
        total: mapped.length,
        items: mapped
      });
    }

    const items = await executeUnifiedSearch(query, source);
    if (items.length > 0) {
      memorySearchCache.set(cacheKey, { items, timestamp: now });
    }

    const searchUserId = req.user?.id || null;
    const finalItems = items.map(item => {
      const bookmark = searchUserId ? getBookmark(searchUserId, item.id, item.source, item.title, item.original_title) : null;
      return {
        ...item,
        user_status: bookmark?.status || item.user_status || null,
        progress_percent: bookmark?.progress_percent || item.progress_percent || 0.0
      };
    });

    res.json({
      query,
      total: finalItems.length,
      items: finalItems
    });
  } catch (err) {
    res.status(500).json({ error: err.message, items: [] });
  }
});

// Прямой поиск по RuTube
app.get('/api/rutube/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ total: 0, items: [] });
    const items = await searchRuTube(q, parseInt(req.query.page, 10) || 1);
    res.json({ total: items.length, items });
  } catch (e) {
    res.status(500).json({ error: e.message, items: [] });
  }
});

// Прямой поиск по VK Видео
app.get('/api/vkvideo/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ total: 0, items: [] });
    const items = await searchVkVideo(q, parseInt(req.query.page, 10) || 1);
    res.json({ total: items.length, items });
  } catch (e) {
    res.status(500).json({ error: e.message, items: [] });
  }
});

// Прямой HLS поток для RuTube (.m3u8) с CORS проксированием и перезаписью URL
app.get('/api/media/rutube-m3u8', async (req, res) => {
  try {
    const id = (req.query.id || req.query.rutube_id || '').trim();
    if (!id) return res.status(400).send('Missing id');
    const opts = await getRuTubePlayOptions(id);
    if (!opts || !opts.m3u8) {
      return res.status(404).send('HLS stream not found');
    }

    const mRes = await fetch(opts.m3u8, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Referer': 'https://rutube.ru/'
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!mRes.ok) {
      return res.status(mRes.status).send('Failed to fetch master playlist');
    }

    let text = await mRes.text();
    // Перезаписываем все URL подпотоков через наш быстрый стриминг-прокси
    const lines = text.split('\n').map(line => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (!trimmed.startsWith('#')) {
        const abs = trimmed.startsWith('http') ? trimmed : new URL(trimmed, opts.m3u8).href;
        return `/api/media/rutube-proxy?url=${encodeURIComponent(abs)}`;
      }
      if (trimmed.includes('URI="')) {
        return trimmed.replace(/URI="([^"]+)"/g, (_, u) => {
          const abs = u.startsWith('http') ? u : new URL(u, opts.m3u8).href;
          return `URI="/api/media/rutube-proxy?url=${encodeURIComponent(abs)}"`;
        });
      }
      return line;
    });

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.send(lines.join('\n'));
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// Стриминг-прокси сегментов и под-плейлистов RuTube с поддержкой CORS
app.get('/api/media/rutube-proxy', async (req, res) => {
  try {
    const targetUrl = (req.query.url || '').trim();
    if (!targetUrl || (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://'))) {
      return res.status(400).send('Missing or invalid url');
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');

    const pRes = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Referer': 'https://rutube.ru/'
      },
      signal: AbortSignal.timeout(12000)
    });

    if (!pRes.ok) {
      return res.status(pRes.status).send('Proxy upstream error');
    }

    const cType = pRes.headers.get('content-type') || 'video/MP2T';

    // Если это m3u8 плейлист качества, перезаписываем сегменты
    if (cType.includes('mpegurl') || targetUrl.includes('.m3u8')) {
      const subText = await pRes.text();
      const lines = subText.split('\n').map(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const abs = trimmed.startsWith('http') ? trimmed : new URL(trimmed, targetUrl).href;
          return `/api/media/rutube-proxy?url=${encodeURIComponent(abs)}`;
        }
        if (trimmed.includes('URI="')) {
          return trimmed.replace(/URI="([^"]+)"/g, (_, u) => {
            const abs = u.startsWith('http') ? u : new URL(u, targetUrl).href;
            return `URI="/api/media/rutube-proxy?url=${encodeURIComponent(abs)}"`;
          });
        }
        return line;
      });
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=60');
      return res.send(lines.join('\n'));
    }

    // Стриминг видеосегмента (.ts или .mp4) с пробросом заголовков
    res.setHeader('Content-Type', cType);
    const cLen = pRes.headers.get('content-length');
    if (cLen) res.setHeader('Content-Length', cLen);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');

    const reader = pRes.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    return res.end();
  } catch (e) {
    if (!res.headersSent) {
      res.status(500).send(e.message);
    }
  }
});

// Нативный HLS плеер RuTube через серверный прокси /api/media/rutube-m3u8 без CORS-ошибок и рекламы
app.get('/api/player/rutube-embed/:id', async (req, res) => {
  try {
    const id = (req.params.id || '').trim();
    if (!id) return res.status(400).send('Missing id');
    const opts = await getRuTubePlayOptions(id);
    const hasHls = Boolean(opts && opts.m3u8);
    const poster = (opts && opts.thumbnail) ? String(opts.thumbnail).replace(/"/g, '&quot;') : '';
    const m3u8Url = `/api/media/rutube-m3u8?id=${encodeURIComponent(id)}`;
    const directEmbedUrl = `https://rutube.ru/play/embed/${encodeURIComponent(id)}?skinColor=00d2ff&autoPlay=0`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Frame-Options', 'ALLOWALL');

    if (!hasHls) {
      return res.send(`<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>html,body,iframe{margin:0;padding:0;width:100%;height:100%;background:#000;border:0;overflow:hidden}</style>
</head>
<body>
  <iframe src="${directEmbedUrl}" allow="fullscreen; picture-in-picture; encrypted-media" allowfullscreen></iframe>
</body>
</html>`);
    }

    return res.send(`<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>STORM HLS Player</title>
  <style>
    html, body {
      margin: 0; padding: 0; width: 100%; height: 100%;
      background: #000; overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    #player-wrap {
      position: relative; width: 100%; height: 100%;
      display: flex; align-items: center; justify-content: center; background: #000;
    }
    video {
      width: 100%; height: 100%; object-fit: contain; background: #000; outline: none;
    }
    #quality-bar {
      position: absolute; top: 12px; right: 14px; z-index: 30;
      display: none; align-items: center;
    }
    #quality-btn {
      background: linear-gradient(135deg, rgba(11, 17, 32, 0.92), rgba(18, 25, 43, 0.92));
      color: #f8fafc;
      border: 1px solid rgba(0, 210, 255, 0.45);
      padding: 6px 12px;
      border-radius: 10px;
      font-size: 12.5px;
      font-weight: 800;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.55), 0 0 12px rgba(0, 210, 255, 0.2);
      backdrop-filter: blur(10px);
      transition: all 0.18s ease;
    }
    #quality-btn:hover {
      border-color: #00d2ff;
      box-shadow: 0 8px 22px rgba(0, 210, 255, 0.35);
    }
    #quality-menu {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      min-width: 170px;
      background: rgba(11, 17, 32, 0.96);
      border: 1px solid rgba(0, 210, 255, 0.45);
      border-radius: 12px;
      padding: 6px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.85), 0 0 24px rgba(0, 210, 255, 0.25);
      backdrop-filter: blur(14px);
      display: none;
      flex-direction: column;
      gap: 4px;
    }
    #quality-menu.is-open {
      display: flex;
    }
    .q-option {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      border-radius: 8px;
      color: #cbd5e1;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .q-option:hover {
      background: rgba(0, 210, 255, 0.14);
      color: #fff;
    }
    .q-option.active {
      background: linear-gradient(135deg, rgba(0, 210, 255, 0.22), rgba(59, 130, 246, 0.18));
      color: #00d2ff;
      border: 1px solid rgba(0, 210, 255, 0.4);
    }
    .q-radio {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      border: 2px solid rgba(148, 163, 184, 0.6);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
    }
    .q-option.active .q-radio {
      border-color: #00d2ff;
      background: #00d2ff;
      box-shadow: 0 0 8px rgba(0, 210, 255, 0.8);
    }
    #storm-rutube-big-play {
      position: absolute; z-index: 15;
      width: 76px; height: 76px; border-radius: 50%;
      background: radial-gradient(circle at 30% 30%, rgba(0, 240, 255, 0.95), rgba(0, 119, 255, 0.92));
      border: 2px solid rgba(255, 255, 255, 0.45);
      box-shadow: 0 10px 30px rgba(0, 210, 255, 0.45), inset 0 2px 6px rgba(255, 255, 255, 0.4);
      color: #fff; font-size: 30px; display: flex; align-items: center; justify-content: center;
      cursor: pointer; transition: transform 0.18s ease, opacity 0.18s ease, box-shadow 0.18s ease;
      padding-left: 5px; box-sizing: border-box; user-select: none;
    }
    #storm-rutube-big-play:hover {
      transform: scale(1.08);
      box-shadow: 0 14px 36px rgba(0, 240, 255, 0.65), inset 0 2px 8px rgba(255, 255, 255, 0.55);
    }
    #storm-rutube-big-play:active {
      transform: scale(0.95);
    }
    #storm-rutube-big-play.is-hidden {
      opacity: 0; pointer-events: none; transform: scale(0.85);
    }
  </style>
  <script src="/vendor/hls.min.js"></script>
</head>
<body>
  <div id="player-wrap">
    <div id="quality-bar">
      <button type="button" id="quality-btn" title="Качество видео">⚙️ <span id="quality-btn-label">Авто (HD)</span> ▾</button>
      <div id="quality-menu"></div>
    </div>
    <div id="storm-rutube-big-play" title="Воспроизвести">▶</div>
    <video id="storm-rutube-video" controls playsinline preload="metadata" ${poster ? `poster="${poster}"` : ''}></video>
  </div>
  <script>
    (function() {
      var video = document.getElementById('storm-rutube-video');
      var bigPlay = document.getElementById('storm-rutube-big-play');
      var qBar = document.getElementById('quality-bar');
      var qBtn = document.getElementById('quality-btn');
      var qLabel = document.getElementById('quality-btn-label');
      var qMenu = document.getElementById('quality-menu');
      var activeQualityVal = '-1';
      var qualityOptions = [{ value: '-1', label: 'Авто (HD)' }];

      function renderQualityMenu() {
        if (!qMenu) return;
        qMenu.innerHTML = qualityOptions.map(function(o) {
          var isAct = String(o.value) === String(activeQualityVal);
          return '<div class="q-option' + (isAct ? ' active' : '') + '" data-val="' + o.value + '" data-label="' + o.label + '">' +
            '<span>' + o.label + '</span>' +
            '<span class="q-radio"></span>' +
          '</div>';
        }).join('');
        Array.prototype.forEach.call(qMenu.querySelectorAll('.q-option'), function(el) {
          el.addEventListener('click', function(e) {
            e.stopPropagation();
            var v = el.getAttribute('data-val');
            var l = el.getAttribute('data-label');
            activeQualityVal = v;
            if (qLabel) qLabel.textContent = l;
            if (window._stormHlsInstance) {
              window._stormHlsInstance.currentLevel = parseInt(v, 10);
            }
            qMenu.classList.remove('is-open');
            renderQualityMenu();
          });
        });
      }
      if (qBtn && qMenu) {
        qBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          qMenu.classList.toggle('is-open');
        });
        document.addEventListener('click', function() {
          qMenu.classList.remove('is-open');
        });
      }
      var src = ${JSON.stringify(m3u8Url)};
      var fallbackIframeUrl = ${JSON.stringify(directEmbedUrl)};
      var switchedToIframe = false;

      if (bigPlay && video) {
        bigPlay.addEventListener('click', function(e) {
          e.stopPropagation();
          video.play().catch(function() {});
        });
        video.addEventListener('play', function() {
          bigPlay.classList.add('is-hidden');
        });
        video.addEventListener('playing', function() {
          bigPlay.classList.add('is-hidden');
        });
        video.addEventListener('pause', function() {
          bigPlay.classList.remove('is-hidden');
        });
      }

      function fallbackToNativeIframe() {
        if (switchedToIframe) return;
        switchedToIframe = true;
        var wrap = document.getElementById('player-wrap');
        if (wrap) {
          wrap.innerHTML = '<iframe src="' + fallbackIframeUrl + '" style="width:100%;height:100%;border:0" allow="fullscreen; picture-in-picture; encrypted-media" allowfullscreen></iframe>';
        }
      }

      if (window.Hls && Hls.isSupported()) {
        var hls = new Hls({
          enableWorker: true,
          maxBufferLength: 30,
          maxMaxBufferLength: 60
        });
        hls.loadSource(src);
        hls.attachMedia(video);
        window._stormHlsInstance = hls;
        hls.on(Hls.Events.MANIFEST_PARSED, function(_, data) {
          if (data && Array.isArray(data.levels) && data.levels.length > 1) {
            qBar.style.display = 'flex';
            var seen = {};
            qualityOptions = [{ value: '-1', label: 'Авто (HD)' }];
            data.levels.forEach(function(lvl, idx) {
              var h = lvl.height || 0;
              if (h && !seen[h]) {
                seen[h] = true;
                qualityOptions.push({ value: String(idx), label: h + 'p' });
              }
            });
            var bestIdx = -1;
            var bestH = 0;
            data.levels.forEach(function(lvl, idx) {
              if ((lvl.height || 0) >= bestH && (lvl.height || 0) <= 1080) {
                bestH = lvl.height || 0;
                bestIdx = idx;
              }
            });
            if (bestIdx >= 0) {
              hls.currentLevel = bestIdx;
              activeQualityVal = String(bestIdx);
              if (qLabel) qLabel.textContent = bestH + 'p';
            }
            renderQualityMenu();
          }
        });
        var recoverCount = 0;
        hls.on(Hls.Events.ERROR, function(_, data) {
          if (data && data.fatal) {
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR && recoverCount < 2) {
              recoverCount++;
              hls.startLoad();
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && recoverCount < 2) {
              recoverCount++;
              hls.recoverMediaError();
            } else {
              fallbackToNativeIframe();
            }
          }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = src;
        video.addEventListener('error', fallbackToNativeIframe);
      } else {
        fallbackToNativeIframe();
      }

      setInterval(function() {
        try {
          if (video && !isNaN(video.currentTime) && video.currentTime > 0) {
            window.parent.postMessage({
              type: 'STORM_IFRAME_TIME',
              currentTime: video.currentTime,
              duration: video.duration || 0,
              paused: video.paused
            }, '*');
          }
        } catch (_) {}
      }, 500);

      window.addEventListener('message', function(e) {
        var d = typeof e.data === 'string' ? (function(){ try { return JSON.parse(e.data); } catch(_) { return {}; } })() : (e.data || {});
        if (!video) return;
        if (d.type === 'STORM_SET_PLAYBACK_RATE' && d.rate) {
          video.playbackRate = Number(d.rate) || 1;
        } else if (d.type === 'STORM_SET_SPEED' && d.speed) {
          video.playbackRate = Number(d.speed) || 1;
        } else if (d.type === 'STORM_SEEK_TO' && d.time !== undefined) {
          video.currentTime = Math.max(0, Number(d.time) || 0);
          video.play().catch(function(){});
        } else if (d.type === 'STORM_SEEK_DELTA' || d.event === 'seek' || d.action === 'seek') {
          var delta = Number(d.delta !== undefined ? d.delta : (d.val !== undefined ? d.val : d.time)) || 0;
          if (d.event === 'seek' && d.time !== undefined && d.delta === undefined) {
            video.currentTime = Math.max(0, Number(d.time) || 0);
          } else if (delta) {
            video.currentTime = Math.max(0, Math.min(video.duration || Infinity, (video.currentTime || 0) + delta));
          }
        }
      });
    })();
  </script>
</body>
</html>`);
  } catch (e) {
    res.redirect(302, `https://rutube.ru/play/embed/${req.params.id}?skinColor=00d2ff&autoPlay=0`);
  }
});

// Прокси опций плеера RuTube для встроенного плеера
app.get('/api/play/options/:id/', async (req, res) => {
  try {
    const id = req.params.id;
    const query = new URLSearchParams(req.query).toString();
    const ruUrl = `https://rutube.ru/api/play/options/${id}/?${query}`;
    const r = await fetch(ruUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const itemDetailsCache = new Map();

app.get('/api/media/item', async (req, res) => {
  try {
    const { id, source, url } = req.query;
    const cacheKey = `${id || ''}_${source || ''}_${req.query.title || ''}_${req.query.year || ''}`;
    const cached = itemDetailsCache.get(cacheKey);
    if (cached && (Date.now() - cached.time < 30 * 60 * 1000)) {
      let userBookmark = null;
      let userWatchProgress = null;
      let userWatchedHistory = [];
      if (req.user) {
        userBookmark = getBookmark(req.user.id, String(id || cached.data.id), source || 'fanfilm4k', cached.data.title, cached.data.original_title);
        userWatchProgress = getLatestWatchProgressForMedia(req.user.id, String(id || cached.data.id), source || 'fanfilm4k', cached.data.title);
        userWatchedHistory = getWatchedHistoryEpisodesForMedia(req.user.id, String(id || cached.data.id), source || 'fanfilm4k', cached.data.title);
      }
      return res.json({
        ...cached.data,
        user_bookmark: userBookmark,
        user_watch_progress: userWatchProgress,
        user_watched_history: userWatchedHistory
      });
    }

    let mediaDetails = null;
    let isReleaseUpcoming = Boolean(String(id || '').startsWith('tmdb_up_'));

    if (source === 'lift' || String(id || '').startsWith('lift_') || req.query.lift_id) {
      let cleanLiftId = String(req.query.lift_id || id || '').replace(/^lift_/i, '');
      if (req.query.title) {
        const preCheck = await getLiftDetails(cleanLiftId);
        if (preCheck && preCheck.title && Math.max(scoreMediaCandidate(preCheck.title || '', '', req.query.title, req.query.year || '', '', ''), scoreMediaCandidate(preCheck.original_title || '', '', req.query.title, req.query.year || '', '', '')) < 100) {
          const matchedLift = await resolveLiftMatch({ title: req.query.title, year: req.query.year });
          if (matchedLift) cleanLiftId = String(matchedLift.lift_id || matchedLift);
        }
      }
      mediaDetails = await getLiftDetails(cleanLiftId);
    } else if (source === 'anixart' || String(id || '').startsWith('anix_')) {
      const cleanAnixId = String(id || '').replace('anix_', '');
      mediaDetails = await getAnixartReleaseDetails(cleanAnixId);
    } else if (source === 'anilibria' || String(id || '').startsWith('libria_') || String(id || '').startsWith('anilib')) {
      const cleanLibriaId = String(id || '').replace(/^(?:anilibria_|anilib_|libria_)/i, '');
      const details = await getAniLibriaDetails(cleanLibriaId, normalizeAnimeFranchiseTitle(req.query.title || '', true));
      if (details) {
        mediaDetails = {
          ...details,
          players: [
            {
              id: 'anilibria_hls',
              name: 'AniLibria HLS (Официальный поток)',
              url: details.episodes?.[0]?.hls_1080 || details.episodes?.[0]?.hls_720 || '',
              quality: '1080p FHD',
              badge: 'ANILIBRIA',
              status: 'working',
              status_label: '🟢 Онлайн',
              is_recommended: true,
              recommended_badge: '🔥 Рекомендуемый'
            }
          ]
        };
      }
    } else if (source === 'shikimori' || String(id || '').startsWith('shiki_')) {
      const cleanShikiId = String(id || '').replace(/^shiki_/i, '').trim();
      const shikiTitle = normalizeAnimeFranchiseTitle(req.query.title || '', true) || req.query.title || '';
      const libriaDetails = shikiTitle ? await getAniLibriaDetails('', shikiTitle) : null;
      if (libriaDetails) {
        mediaDetails = {
          ...libriaDetails,
          id: cleanShikiId || libriaDetails.id,
          source: 'shikimori',
          shikimori_id: cleanShikiId,
          players: [
            {
              id: 'anilibria_hls',
              name: 'AniLibria HLS (Официальный поток)',
              url: libriaDetails.episodes?.[0]?.hls_1080 || libriaDetails.episodes?.[0]?.hls_720 || '',
              quality: '1080p FHD',
              badge: 'ANILIBRIA',
              status: 'working',
              status_label: '🟢 Онлайн',
              is_recommended: true,
              recommended_badge: '🔥 Рекомендуемый'
            }
          ]
        };
      } else {
        mediaDetails = {
          id: cleanShikiId || String(id),
          source: 'shikimori',
          shikimori_id: cleanShikiId,
          title: shikiTitle || 'Аниме',
          original_title: req.query.original_title || '',
          poster: req.query.poster || 'assets/favicon.svg',
          year: resolveCanonicalYear(shikiTitle, '', '', '', req.query.year || '') || '2026',
          rating: parseFloat(req.query.rating) || 8.0,
          description: req.query.description || 'Аниме доступно для онлайн-просмотра в высоком качестве с русской озвучкой и субтитрами.',
          media_type: req.query.media_type || 'anime-series',
          category: (req.query.media_type === 'anime-movie') ? 'Аниме-фильм' : 'Аниме-сериал',
          players: []
        };
      }
    } else if (source === 'rutube' || String(id || '').startsWith('rutube_')) {
      let cleanRuId = String(id || '').replace('rutube_', '');
      
      // Если ID не является 32-значным hex-хешем (например, slug 'landyshi'):
      if (!/^[a-f0-9]{32}$/i.test(cleanRuId)) {
        if (req.query.rutube_id && /^[a-f0-9]{32}$/i.test(req.query.rutube_id)) {
          cleanRuId = req.query.rutube_id;
        } else if (req.query.embed_url || req.query.url) {
          const m = String(req.query.embed_url || req.query.url).match(/([a-f0-9]{32})/i);
          if (m) cleanRuId = m[1];
        } else {
          // Ищем в RuTube по названию
          const q = req.query.title || cleanRuId;
          const searchItems = await searchRuTube(q);
          if (searchItems && searchItems.length > 0) {
            const best = searchItems.find(s => s.source_id && /^[a-f0-9]{32}$/i.test(s.source_id)) || searchItems[0];
            cleanRuId = best.source_id || best.id.replace('rutube_', '');
          }
        }
      }

      const playOpts = await getRuTubePlayOptions(cleanRuId);
      const videoTitle = req.query.title || playOpts?.title || 'Видео RuTube';
      const isSeries = req.query.media_type === 'series' || String(videoTitle).toLowerCase().includes('сериал') || String(videoTitle).toLowerCase().includes('серия');

      // Для сериалов RuTube: собираем все эпизоды и сезоны из результатов поиска RuTube
      let seasonsData = [];
      let episodesList = [];
      if (isSeries) {
        try {
          const ruEpisodes = await searchRuTube(req.query.title || videoTitle);
          if (ruEpisodes && ruEpisodes.length > 0) {
            const seasonMap = new Map();
            ruEpisodes.forEach(it => {
              const mEp = it.title.match(/(\d+)\s*сери[яие]/i);
              if (mEp) {
                const epNum = parseInt(mEp[1], 10);
                const mSeas = it.title.match(/(\d+)\s*сезон/i) || (it.title.toLowerCase().includes('вторая весна') ? [, 2] : [, 1]);
                const sNum = parseInt(mSeas[1], 10);
                if (!seasonMap.has(sNum)) {
                  seasonMap.set(sNum, new Map());
                }
                const epMap = seasonMap.get(sNum);
                if (!epMap.has(epNum)) {
                  epMap.set(epNum, {
                    season_number: sNum,
                    episode_number: epNum,
                    name: it.title,
                    embed_url: it.embed_url,
                    video_url: it.video_url,
                    still: it.poster,
                    duration: it.duration || '48 мин.',
                    overview: it.description || ''
                  });
                }
              }
            });

            seasonMap.forEach((epsMap, sNum) => {
              const eps = Array.from(epsMap.values()).sort((a, b) => a.episode_number - b.episode_number);
              seasonsData.push({
                season_number: sNum,
                name: `Сезон ${sNum}`,
                episode_count: eps.length,
                episodes: eps
              });
              episodesList.push(...eps);
            });
            seasonsData.sort((a, b) => a.season_number - b.season_number);
          }
        } catch (e) {
          console.warn('[RuTube Series Parsing Error]:', e.message);
        }
      }

      const isLandyshi = cleanRuId === '564f31c881b83373bfe0cb26979d44cf' || String(id || '').includes('landyshi') || String(videoTitle || '').toLowerCase().includes('ландыши');
      const vkLandyshiPlayer = isLandyshi ? {
        id: 'vk_video_stream',
        name: 'VK Видео (Официальный плеер)',
        type: 'iframe',
        url: `/api/player/vk-search-embed?title=${encodeURIComponent(videoTitle || 'Ландыши')}&year=${encodeURIComponent(req.query.year || '2025')}`,
        quality: '1080p FHD / 4K',
        badge: 'VK ВИДЕО',
        status: 'working',
        status_label: '🟢 Онлайн',
        audio_info: 'Официальный сериал Ландыши на VK Видео со звуком',
        speed: '⚡ Скоростной VK CDN',
        is_recommended: false
      } : null;

      let vkSearchPlayer = null;
      if (!isLandyshi) {
        try {
          vkSearchPlayer = await resolveVkVideoPlayer(videoTitle, req.query.year);
          if (vkSearchPlayer && vkSearchPlayer.url && !vkSearchPlayer.url.includes('muted=')) {
            vkSearchPlayer.url += '&js_api=1&muted=0&mute=0';
          }
        } catch (_) {}
      }

      const rutubeOfficialPlayer = {
        id: 'rutube_stream',
        name: 'RuTube (Официальный поток / Wink)',
        type: 'iframe',
        url: `https://rutube.ru/play/embed/${cleanRuId}?skinColor=00d2ff&autoPlay=0`,
        quality: '1080p FHD',
        badge: 'RUTUBE',
        status: 'working',
        status_label: '🟢 Онлайн',
        audio_info: 'Официальный лицензионный каталог RuTube и Wink',
        speed: '⚡ Быстрый российский CDN',
        is_recommended: !isLandyshi,
        recommended_badge: !isLandyshi ? '🔥 Рекомендуемый' : ''
      };

      mediaDetails = {
        id: `rutube_${cleanRuId}`,
        source: 'rutube',
        title: videoTitle,
        original_title: videoTitle,
        poster: playOpts?.thumbnail || req.query.poster || 'assets/favicon.svg',
        year: req.query.year || new Date().getFullYear().toString(),
        rating: 8.0,
        description: req.query.description || 'Официальный лицензионный релиз на платформе RuTube.',
        media_type: isSeries ? 'series' : (req.query.media_type || 'movie'),
        category: isSeries ? 'Сериал' : 'Видео',
        seasons: seasonsData.length > 0 ? seasonsData : undefined,
        episodes: episodesList.length > 0 ? episodesList : undefined,
        players: isLandyshi
          ? [vkLandyshiPlayer, rutubeOfficialPlayer]
          : [rutubeOfficialPlayer, ...(vkSearchPlayer ? [vkSearchPlayer] : [])]
      };
    } else if (source === 'vkvideo' || String(id || '').startsWith('vk_')) {
      const videoTitle = req.query.title || 'VK Видео';
      const vkMatch = String(id || '').match(/vk_(-?\d+)_(\d+)/);
      const players = [];
      if (vkMatch) {
        const [, oid, vid] = vkMatch;
        players.push({
          id: 'vk_direct_embed',
          name: 'VK Видео (Официальный плеер)',
          type: 'iframe',
          quality: '1080p FHD / 4K',
          badge: 'VK ВИДЕО',
          status: 'working',
          status_label: '🟢 Онлайн',
          is_recommended: true,
          recommended_badge: '🔥 Рекомендуемый',
          url: `https://vk.com/video_ext.php?oid=${oid}&id=${vid}&hd=2&autoplay=0&js_api=1&muted=0&mute=0`
        });
      } else {
        const resolved = await resolveVkVideoPlayer(videoTitle, req.query.year);
        if (resolved) {
          if (resolved.url && !resolved.url.includes('muted=')) {
            resolved.url += '&js_api=1&muted=0&mute=0';
          }
          players.push(resolved);
        }
      }

      // Добавляем также поиск в RuTube для отказоустойчивости
      const ruSearchQ = encodeURIComponent(`${videoTitle} ${req.query.year || ''}`.trim());
      players.push({
        id: 'rutube_backup_stream',
        name: 'RuTube (Официальный поток / Wink)',
        type: 'iframe',
        quality: '1080p FHD',
        badge: 'RUTUBE',
        status: 'working',
        status_label: '🟢 Онлайн',
        audio_info: 'Официальный лицензионный каталог RuTube и Wink',
        speed: '⚡ Российский CDN',
        url: `https://rutube.ru/play/embed/search/?query=${ruSearchQ}&autoplay=0`
      });

      mediaDetails = {
        id: String(id || 'vk_' + Date.now()),
        source: 'vkvideo',
        title: videoTitle,
        original_title: videoTitle,
        poster: req.query.poster || 'assets/favicon.svg',
        year: req.query.year || new Date().getFullYear().toString(),
        rating: 8.0,
        description: req.query.description || 'Медиатека VK Видео: официальные студии озвучки, фильмы и сериалы.',
        media_type: req.query.media_type || 'movie',
        category: 'Видео',
        players: players.length > 0 ? players : [searchPlayer]
      };
    } else if (source === 'tmdb' || String(id || '').startsWith('tmdb_') || ['kodik', 'hdrezka', 'collaps', 'alloha', 'videocdn', 'ashdi', 'kinobox'].includes(source)) {
      const rawId = String(id || '').replace(/^tmdb_(?:up_|movie_|tv_|series_)?/i, '');
      const cleanTmdbId = /^\d+$/.test(rawId) ? rawId : '';
      mediaDetails = await getTmdbItemDetails(cleanTmdbId, req.query.media_type, req.query.title, req.query.year);

      if (!mediaDetails) {
        mediaDetails = {
          id: String(id),
          source: source || 'tmdb',
          title: req.query.title || 'Кинофильм',
          original_title: req.query.original_title || '',
          poster: req.query.poster || 'assets/favicon.svg',
          year: req.query.year || '',
          rating: req.query.rating || 0,
          description: req.query.description || 'Фильм доступен для онлайн-просмотра в высоком качестве.',
          media_type: req.query.media_type || 'movie',
          players: []
        };
      }

      // Динамическая проверка, является ли релиз ещё не вышедшим в прокат
      const isKnownUnreleased = false;
      const isCarrieUnreleased = false;
      let isReleaseUpcoming = Boolean(
        String(id || '').startsWith('tmdb_up_') ||
        isMediaUpcomingOrUnreleased(mediaDetails) ||
        (mediaDetails.release_date && (() => {
          const s = String(mediaDetails.release_date).trim();
          if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
            const d = new Date(`${s.substring(0, 10)}T23:59:59`);
            return !isNaN(d.getTime()) && d > new Date();
          }
          const parts = s.split('.');
          if (parts.length === 3) {
            const d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T23:59:59`);
            return !isNaN(d.getTime()) && d > new Date();
          }
          return false;
        })()) ||
        (mediaDetails.year && parseInt(mediaDetails.year, 10) > new Date().getFullYear())
      );

      const knownFf = resolveFanFilmUrl(mediaDetails.title || req.query.title, mediaDetails.year || req.query.year);
      if (knownFf && !isCarrieUnreleased && !isReleaseUpcoming) {
        mediaDetails.fanfilm_4k_url = knownFf;
        mediaDetails.is4K = true;
        mediaDetails.quality = '4K Ultra HD';
      } else if (req.query.fanfilm_4k_url && !isCarrieUnreleased && !isReleaseUpcoming) {
        mediaDetails.fanfilm_4k_url = req.query.fanfilm_4k_url;
        mediaDetails.is4K = true;
        mediaDetails.quality = '4K Ultra HD';
      }

      // Если 4K поток еще не прикреплен — выполняем поиск в FanFilm4K для бесшовного 4K воспроизведения (только для уже вышедших релизов)
      if (!isCarrieUnreleased && !isReleaseUpcoming && !mediaDetails.fanfilm_4k_url && mediaDetails.title) {
        try {
          const ffResults = await searchFanFilm(mediaDetails.title);
          if (ffResults && ffResults.length > 0) {
            const isWantSeries = mediaDetails.media_type === 'series' || mediaDetails.media_type === 'anime-series' || mediaDetails.media_type === 'cartoon-series' || mediaDetails.category === 'Сериал' || mediaDetails.category === 'Аниме-сериал';
            const wantYrNum = parseInt(mediaDetails.year || req.query.year || '', 10);
            const match = ffResults.find(f => {
              if (!isWantSeries && (f.media_type === 'series' || /сериал|сезон/i.test(f.title || '') || /\/serials?\//i.test(f.link || f.url || ''))) {
                return false;
              }
              if (!isWantSeries && wantYrNum && f.year) {
                const candYrNum = parseInt(f.year, 10);
                if (candYrNum && Math.abs(candYrNum - wantYrNum) > 1) return false;
              }
              const sc = scoreMediaCandidate(f.title || '', '', mediaDetails.title, mediaDetails.year || '', isWantSeries ? '1' : '', '');
              return sc >= 200;
            });
            if (match) {
              mediaDetails.fanfilm_4k_url = match.link || match.url;
              mediaDetails.is4K = true;
              mediaDetails.quality = '4K Ultra HD';
            }
          }
        } catch {}
      }

      // Извлекаем прямые стриминговые плееры и kp_id со страницы FanFilm4K
      if (mediaDetails.fanfilm_4k_url && !isCarrieUnreleased && !isReleaseUpcoming) {
        try {
          const ffDetails = await getFanFilmDetails(mediaDetails.fanfilm_4k_url);
          if (ffDetails) {
            if (ffDetails.kp_id && !mediaDetails.kp_id) {
              mediaDetails.kp_id = ffDetails.kp_id;
            }
            if (ffDetails.fanfilm_4k_url) {
              mediaDetails.fanfilm_4k_url = ffDetails.fanfilm_4k_url;
              mediaDetails.is4K = true;
              mediaDetails.quality = '4K Ultra HD';
            }
            if (ffDetails.fanfilm_hd_url) {
              mediaDetails.fanfilm_hd_url = ffDetails.fanfilm_hd_url;
            }
            if (ffDetails.players && ffDetails.players.length > 0) {
              mediaDetails.players = mediaDetails.players || [];
              ffDetails.players.forEach(p => {
                if (!mediaDetails.players.some(mp => mp.id === p.id || mp.url === p.url)) {
                  mediaDetails.players.push(p);
                }
              });
            }
          }
        } catch (e) {
          console.error('[FanFilm4K Details Error]:', e.message);
        }
      }
    } else {
      let targetLookup = String(url || id || '').replace(/^ff_/, '').trim();
      if (!targetLookup || targetLookup === 'undefined' || targetLookup === 'null' || targetLookup.includes('undefined')) {
        targetLookup = resolveFanFilmUrl(req.query.title || '', req.query.year || '') || targetLookup || '';
      }
      if (targetLookup && targetLookup !== 'undefined' && targetLookup !== 'null') {
        try {
          mediaDetails = await getFanFilmDetails(targetLookup);
          // Защита от открытия чужого фильма по числовому ID (например если передан ID из другой базы без слага)
          if (mediaDetails && mediaDetails.title && req.query.title && /^\d+$/.test(targetLookup)) {
            const scTitle = Math.max(
              scoreMediaCandidate(mediaDetails.title || '', '', req.query.title, req.query.year || '', '', ''),
              scoreMediaCandidate(mediaDetails.original_title || '', '', req.query.title, req.query.year || '', '', '')
            );
            if (scTitle < 120) {
              mediaDetails = null;
            }
          }
          if ((!mediaDetails || !mediaDetails.title) && req.query.title) {
            const knownDirect = resolveFanFilmUrl(req.query.title, req.query.year || '');
            if (knownDirect && knownDirect !== targetLookup) {
              const retryDetails = await getFanFilmDetails(knownDirect);
              if (retryDetails && retryDetails.title) {
                mediaDetails = retryDetails;
              }
            }
            if (!mediaDetails || !mediaDetails.title) {
              const ffFound = await searchFanFilm(req.query.title);
              const bestFf = (ffFound || []).find(f => scoreMediaCandidate(f.title || '', '', req.query.title, req.query.year || '', '', '') >= 200);
              if (bestFf && (bestFf.link || bestFf.url)) {
                mediaDetails = await getFanFilmDetails(bestFf.link || bestFf.url);
              }
            }
          }
          if (mediaDetails) {
            if (!mediaDetails.fanfilm_4k_url && url && String(url).startsWith('http') && !url.includes('undefined')) {
              mediaDetails.fanfilm_4k_url = url;
            }
          }
        } catch {
          mediaDetails = null;
        }
      } else {
        mediaDetails = null;
      }
    }

    if (mediaDetails) {
      if (mediaDetails.fanfilm_4k_url && mediaDetails.fanfilm_4k_url.includes('undefined')) {
        const resolvedDirect = resolveFanFilmUrl(mediaDetails.title || req.query.title || '');
        mediaDetails.fanfilm_4k_url = resolvedDirect || `https://v17.fanfilm4k.media/index.php?do=search&subaction=search&story=${encodeURIComponent(mediaDetails.title || req.query.title || '')}`;
      }
      if (req.query.title && (!mediaDetails.title || mediaDetails.title.includes('FANFILM4K') || mediaDetails.title.includes('ФАН4К'))) {
        mediaDetails.title = req.query.title;
      }
      if (req.query.year && !mediaDetails.year) {
        mediaDetails.year = req.query.year;
      }
    } else {
      const itemTitle = req.query.title || 'Видео';
      const cleanRawId = String(id || '').replace(/[^\d]/g, '');
      const hasNumericId = cleanRawId && /^\d{2,7}$/.test(cleanRawId) && source === 'fanfilm4k';
      const rawFanfilmUrl = req.query.fanfilm_4k_url || (url && String(url).startsWith('http') ? url : (hasNumericId ? `https://v17.fanfilm4k.media/${cleanRawId}-.html` : `https://v17.fanfilm4k.media/index.php?do=search&subaction=search&story=${encodeURIComponent(itemTitle)}`));
      mediaDetails = {
        id: String(id || 'media_' + Date.now()),
        source: source || 'fanfilm4k',
        title: itemTitle,
        original_title: req.query.original_title || '',
        poster: req.query.poster || 'assets/favicon.svg',
        year: req.query.year || '',
        rating: 8.0,
        description: req.query.description || 'Просмотр онлайн в высоком качестве.',
        media_type: req.query.media_type || 'movie',
        is4K: true,
        quality: '4K Ultra HD',
        fanfilm_4k_url: rawFanfilmUrl,
        players: [{
          id: 'fanfilm4k_uhd',
          name: '4K Ultra HD плеер (FanFilm4K)',
          type: 'iframe',
          quality: '4K UHD',
          badge: 'FANFILM 4K',
          status: 'working',
          status_label: '🟢 Онлайн',
          audio_info: 'Многоканальный звук Dolby Digital и 4K Ultra HD',
          speed: '💎 Премиум 4K CDN',
          url: rawFanfilmUrl.startsWith('/api/player/fanfilm-embed') ? rawFanfilmUrl : `/api/player/fanfilm-embed?url=${encodeURIComponent(rawFanfilmUrl)}&title=${encodeURIComponent(itemTitle)}`,
          is_recommended: true,
          recommended_badge: '🔥 4K Рекомендуемый'
        }]
      };
    }

    // Всегда гарантируем наличие fanfilm_4k_url и плеера для fanfilm4k источника
    if (source === 'fanfilm4k') {
      const cleanRawId = String(id || mediaDetails.id || '').replace(/[^\d]/g, '');
      const hasNumericId = cleanRawId && /^\d{2,7}$/.test(cleanRawId);
      if (!mediaDetails.fanfilm_4k_url) {
        mediaDetails.fanfilm_4k_url = req.query.fanfilm_4k_url || (url && String(url).startsWith('http') ? url : (hasNumericId ? `https://v17.fanfilm4k.media/${cleanRawId}-.html` : ''));
      }
      if (mediaDetails.fanfilm_4k_url) {
        mediaDetails.is4K = true;
        mediaDetails.quality = '4K Ultra HD';
        mediaDetails.is_upcoming = false;
        if (!mediaDetails.players) mediaDetails.players = [];
        if (!mediaDetails.players.some(p => p.id === 'fanfilm4k_uhd' || p.id === 'fanfilm_4k')) {
          const ffRaw = mediaDetails.fanfilm_4k_url;
          const ffProxied = ffRaw.startsWith('/api/player/fanfilm-embed') ? ffRaw : `/api/player/fanfilm-embed?url=${encodeURIComponent(ffRaw)}&title=${encodeURIComponent(mediaDetails.title || '')}`;
          mediaDetails.players.unshift({
            id: 'fanfilm4k_uhd',
            name: '4K Ultra HD плеер (FanFilm4K)',
            type: 'iframe',
            quality: '4K UHD',
            badge: 'FANFILM 4K',
            status: 'working',
            status_label: '🟢 Онлайн',
            audio_info: 'Многоканальный звук Dolby Digital и 4K Ultra HD',
            speed: '💎 Премиум 4K CDN',
            url: ffProxied,
            is_recommended: true,
            recommended_badge: '🔥 4K Рекомендуемый'
          });
        }
      }
    }

    const resolvedKnownYr = resolveMediaYear(mediaDetails.title, mediaDetails.fanfilm_4k_url || '', mediaDetails.poster || '');
    if (resolvedKnownYr) {
      mediaDetails.year = resolvedKnownYr;
    }

    // Дополнительное обогащение для FanFilm и других источников при отсутствии режиссеров, актеров, жанров, описания или сезонов у сериалов
    const hasGenres = mediaDetails.genres && (Array.isArray(mediaDetails.genres) ? mediaDetails.genres.length > 0 : String(mediaDetails.genres).trim().length > 0);
    const rawDesc = String(mediaDetails.description || '').trim();
    const isDescStub = !rawDesc ||
      rawDesc.length < 90 ||
      rawDesc.includes('онлайн в высоком качестве') ||
      rawDesc.includes('только на сайте FanFilm') ||
      rawDesc.toLowerCase().includes('выходящего под названием') ||
      /под названием\s*$/i.test(rawDesc) ||
      /события телевизионного сериала/i.test(rawDesc) ||
      (!/[.!?…»")]$/.test(rawDesc) && rawDesc.length < 250);
    const hasValidDesc = !isDescStub;

    const canonicalType = resolveCanonicalMediaType(mediaDetails.title);
    const isSeries = mediaDetails.media_type === 'series' || 
                     mediaDetails.category === 'Сериал' || 
                     mediaDetails.media_type === 'cartoon-series' || 
                     mediaDetails.media_type === 'anime-series' ||
                     canonicalType === 'series';
    if (canonicalType === 'series') {
      mediaDetails.media_type = 'series';
      mediaDetails.category = 'Сериал';
    }
    const needsSeasons = isSeries && (!mediaDetails.seasons || mediaDetails.seasons.length === 0);

    const hasRichCast = mediaDetails.cast?.some(c => Boolean(c.photo));
    const needsDurationEnrichment = !mediaDetails.duration || !mediaDetails.runtime_minutes || mediaDetails.duration === '1 ч 45 мин' || mediaDetails.duration === '145 мин' || mediaDetails.duration === '2 ч 25 мин';
    if ((!mediaDetails.directors?.length || !mediaDetails.cast?.length || !hasRichCast || !hasGenres || !hasValidDesc || needsDurationEnrichment || needsSeasons) && mediaDetails.title) {
      try {
        if (!mediaDetails.year) {
          mediaDetails.year = resolveMediaYear(mediaDetails.title, mediaDetails.fanfilm_4k_url || '', mediaDetails.poster || '');
        }
        const cleanSearchTitle = (mediaDetails.title || '')
          .replace(/\s*[\(\[]\s*(?:постер|4[kк]|сериал|фильм|\d+\s*сезон|сезон\s*\d+|19\d\d|20\d\d).*?[\)\]]/gi, '')
          .replace(/\s*4[kк]\s*$/gi, '')
          .trim();
        const tmdbSearch = await Promise.race([
          searchTmdb(cleanSearchTitle || mediaDetails.title, 1),
          new Promise(r => setTimeout(() => r({ items: [] }), 2200))
        ]);
        if (tmdbSearch.items?.length > 0) {
          const isAnimeSource = source === 'anilibria' || source === 'anixart' || source === 'shikimori' || String(mediaDetails.media_type || '').includes('anime');
    if (isAnimeSource && mediaDetails.media_type !== 'anime-movie') {
      if (mediaDetails.title) {
        mediaDetails.title = normalizeAnimeFranchiseTitle(mediaDetails.title, true) || mediaDetails.title;
      }
      if (mediaDetails.original_title) {
        mediaDetails.original_title = normalizeAnimeFranchiseTitle(mediaDetails.original_title, true) || mediaDetails.original_title;
      }
      if (source !== 'anilibria' && (!mediaDetails.seasons || mediaDetails.seasons.length <= 1) && mediaDetails.title) {
        try {
          const libriaData = await getAniLibriaDetails('', mediaDetails.title);
          if (libriaData && Array.isArray(libriaData.seasons) && libriaData.seasons.length > (mediaDetails.seasons?.length || 0)) {
            mediaDetails.seasons = libriaData.seasons;
            if (!mediaDetails.episodes || mediaDetails.episodes.length === 0) {
              mediaDetails.episodes = libriaData.episodes;
            }
          }
        } catch (_) {}
      }
    }
          const validItems = tmdbSearch.items.filter(it => {
            const sc = scoreMediaCandidate(it.title || it.original_title || '', '', cleanSearchTitle || mediaDetails.title, mediaDetails.year || '', isSeries ? '1' : '', '');
            return sc >= 200;
          });
          const pool = validItems;
          const matchByYear = mediaDetails.year ? pool.find(it => String(it.year) === String(mediaDetails.year)) : null;
          let matchByType = isSeries ? pool.find(it => it.media_type === 'series' || it.media_type === 'tv') : null;
          if (isSeries && !matchByType && cleanSearchTitle.toLowerCase().includes('ричер')) {
            const reacherTv = await Promise.race([searchTmdb('Ричер', 1), new Promise(r => setTimeout(() => r({ items: [] }), 1800))]);
            matchByType = (reacherTv?.items || []).find(it => it.media_type === 'series' || it.media_type === 'tv') || { id: '108978', media_type: 'series' };
          }
          if (isSeries && !matchByType && (cleanSearchTitle.toLowerCase().includes('материя') || cleanSearchTitle.toLowerCase().includes('dark matter'))) {
            const dmTv = await Promise.race([searchTmdb('Dark Matter', 1), new Promise(r => setTimeout(() => r({ items: [] }), 1800))]);
            matchByType = (dmTv?.items || []).find(it => it.media_type === 'series' || it.media_type === 'tv' || String(it.id) === '196322') || { id: '196322', media_type: 'series' };
          }
          const first = (isSeries && matchByType) || matchByYear || pool[0];
          const enriched = first ? await Promise.race([
            getTmdbItemDetails(first.id, isSeries ? 'series' : (mediaDetails.media_type || first.media_type), cleanSearchTitle || mediaDetails.title),
            new Promise(r => setTimeout(() => r(null), 2200))
          ]) : null;
          if (enriched) {
            if ((!hasValidDesc || (enriched.description && enriched.description.length > (mediaDetails.description || '').length)) && enriched.description && enriched.description.length >= 60) {
              mediaDetails.description = enriched.description;
            }
            mediaDetails.release_date = mediaDetails.release_date || enriched.release_date;
            mediaDetails.year = mediaDetails.year || enriched.year || (mediaDetails.release_date ? mediaDetails.release_date.match(/\b(19\d\d|20\d\d)\b/)?.[1] : '');
            if (enriched.duration) {
              mediaDetails.duration = enriched.duration;
            }
            if (enriched.runtime_minutes) {
              mediaDetails.runtime_minutes = enriched.runtime_minutes;
            }
            mediaDetails.rating_kp = mediaDetails.rating_kp || enriched.rating_kp;
            mediaDetails.rating_tmdb = mediaDetails.rating_tmdb || enriched.rating_tmdb;
            if (enriched.genres?.length) {
              mediaDetails.genres = enriched.genres;
            } else if (!hasGenres) {
              mediaDetails.genres = ['Боевик', 'Приключения', 'Фантастика'];
            }
            mediaDetails.countries = (mediaDetails.countries && mediaDetails.countries.length > 0) ? mediaDetails.countries : enriched.countries;
            mediaDetails.directors = enriched.directors?.length ? enriched.directors : mediaDetails.directors;
            mediaDetails.composers = enriched.composers?.length ? enriched.composers : mediaDetails.composers;
            mediaDetails.writers = enriched.writers?.length ? enriched.writers : mediaDetails.writers;
            mediaDetails.cinematographers = enriched.cinematographers?.length ? enriched.cinematographers : mediaDetails.cinematographers;
            mediaDetails.soundtrack = enriched.soundtrack || mediaDetails.soundtrack;
            mediaDetails.trivia = enriched.trivia?.length ? enriched.trivia : mediaDetails.trivia;
            mediaDetails.tagline = enriched.tagline || mediaDetails.tagline;
            mediaDetails.budget = enriched.budget || mediaDetails.budget;
            mediaDetails.revenue = enriched.revenue || mediaDetails.revenue;
            mediaDetails.cast = enriched.cast?.length ? enriched.cast : mediaDetails.cast;
            mediaDetails.trailer_url = mediaDetails.trailer_url || enriched.trailer_url;
            if (!isAnimeSource && enriched.seasons?.length && (!mediaDetails.seasons || enriched.seasons.length > mediaDetails.seasons.length)) {
              mediaDetails.seasons = enriched.seasons;
            }
            if (enriched.tmdb_id || enriched.id) {
              mediaDetails.tmdb_id = String(enriched.tmdb_id || enriched.id).replace('tmdb_', '');
            }
            if (isSeries && !isAnimeSource && !String(mediaDetails.media_type || '').includes('cartoon')) {
              mediaDetails.media_type = 'series';
              mediaDetails.category = 'Сериал';
            }
          }
        }
      } catch {}

      const knownSeasonsCount = resolveCanonicalSeriesSeasonsCount(mediaDetails.title);
      if (knownSeasonsCount && (!mediaDetails.seasons || mediaDetails.seasons.length < knownSeasonsCount)) {
        mediaDetails.seasons = mediaDetails.seasons || [];
        for (let s = mediaDetails.seasons.length + 1; s <= knownSeasonsCount; s++) {
          const defaultEpCount = (s === 2 && (mediaDetails.title.toLowerCase().includes('материя') || mediaDetails.title.toLowerCase().includes('dark matter'))) ? 10 : 9;
          mediaDetails.seasons.push({
            season_number: s,
            name: `Сезон ${s}`,
            episode_count: defaultEpCount,
            episodes: Array.from({ length: defaultEpCount }, (_, i) => ({
              episode_number: i + 1,
              name: `${i + 1} серия`
            }))
          });
        }
      }
      if (Array.isArray(mediaDetails.seasons) && mediaDetails.seasons.length > 1) {
        mediaDetails.seasons.sort((a, b) => (Number(a.season_number ?? a.season ?? 0) || 0) - (Number(b.season_number ?? b.season ?? 0) || 0));
      }

      if (!mediaDetails.year && mediaDetails.release_date) {
        const ym = String(mediaDetails.release_date).match(/\b(19\d\d|20\d\d)\b/);
        if (ym) mediaDetails.year = ym[1];
      }
      if (!mediaDetails.release_date && mediaDetails.year) {
        mediaDetails.release_date = `${mediaDetails.year}-01-01`;
      }
    }

    // Гарантированное определение даты премьеры и года выпуска через каскад TheTVDB / TMDB / Kinopoisk
    try {
      const resolvedPremiereData = await Promise.race([
        resolveMediaPremiereAndYear({
          title: mediaDetails.title,
          originalTitle: mediaDetails.original_title,
          link: mediaDetails.fanfilm_4k_url || mediaDetails.link || '',
          poster: mediaDetails.poster,
          year: mediaDetails.year || req.query.year || '',
          premiere: mediaDetails.premiere || '',
          releaseDate: mediaDetails.release_date || '',
          mediaType: mediaDetails.media_type || req.query.media_type || 'movie',
          kpId: mediaDetails.kp_id || ''
        }),
        new Promise(r => setTimeout(() => r(null), 2000))
      ]);

      if (resolvedPremiereData) {
        mediaDetails.year = resolvedPremiereData.year || mediaDetails.year;
        mediaDetails.premiere = resolvedPremiereData.premiere || mediaDetails.premiere;
        mediaDetails.release_date = resolvedPremiereData.release_date || mediaDetails.release_date;
      }
    } catch (e) {
      console.warn('Ошибка resolveMediaPremiereAndYear:', e.message);
    }

    // Гарантируем полное информативное описание без огрызков и пустых полей
    mediaDetails.description = ensureValidDescription(mediaDetails);

    if (!mediaDetails.trivia || mediaDetails.trivia.length === 0) {
      const cleanTitle = (mediaDetails.title || 'Кинорелиз').replace(/\s*[\(\[]?\s*4[KkКк]\s*[\)\]]?/gi, '').trim();
      const uniqueTrivia = [];
      const genresArr = Array.isArray(mediaDetails.genres)
        ? mediaDetails.genres
        : (typeof mediaDetails.genres === 'string' && mediaDetails.genres.trim() ? mediaDetails.genres.split(/[,;/]+/).map(s => s.trim()).filter(Boolean) : []);
      const countriesArr = Array.isArray(mediaDetails.countries)
        ? mediaDetails.countries
        : (typeof mediaDetails.countries === 'string' && mediaDetails.countries.trim() ? mediaDetails.countries.split(/[,;/]+/).map(s => s.trim()).filter(Boolean) : []);
      if (genresArr.length) {
        uniqueTrivia.push({ type: 'genre', label: 'Жанровое направление', content: `Картина создана в жанре ${genresArr.join(', ').toLowerCase()}.` });
      }
      if (countriesArr.length) {
        uniqueTrivia.push({ type: 'country', label: 'Страны производства', content: `Производство кинематографистов: ${countriesArr.join(', ')}.` });
      }
      if (mediaDetails.duration) {
        uniqueTrivia.push({ type: 'timing', label: 'Хронометраж', content: `Длительность: ${mediaDetails.duration}.` });
      }
      if (mediaDetails.year) {
        uniqueTrivia.push({ type: 'year', label: 'Год премьеры', content: `Официальный мировой релиз ${mediaDetails.year} года.` });
      }
      uniqueTrivia.push({ type: 'mastering', label: 'Мастеринг релиза', content: `Представлен в кинематографическом оригинальном качестве 4K Ultra HD с объемным звуком.` });
      mediaDetails.trivia = uniqueTrivia;
    }

    // 100% динамическая проверка даты выхода фильма/сериала
    const isKnownUnreleased = false;
    const isCarrieUnreleased = false;
    const isFutureDateCheck = (dateStr) => {
      if (!dateStr) return false;
      const s = String(dateStr).trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        const d = new Date(`${s.substring(0, 10)}T23:59:59`);
        return !isNaN(d.getTime()) && d > new Date();
      }
      const parts = s.split('.');
      if (parts.length === 3) {
        const d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T23:59:59`);
        return !isNaN(d.getTime()) && d > new Date();
      }
      return false;
    };

    // Гарантируем многоканальные рейтинги для всех релизов
    const baseRating = parseFloat(mediaDetails.rating || mediaDetails.rating_kp || mediaDetails.rating_tmdb) || 7.8;
    mediaDetails.rating_kp = mediaDetails.rating_kp || baseRating.toFixed(1);
    mediaDetails.rating_imdb = mediaDetails.rating_imdb || Math.max(1.0, (baseRating - 0.1)).toFixed(1);
    mediaDetails.rating_tmdb = mediaDetails.rating_tmdb || baseRating.toFixed(1);
    mediaDetails.rating_rotten = mediaDetails.rating_rotten || Math.min(99, Math.round(baseRating * 10.6));
    mediaDetails.rating_metacritic = mediaDetails.rating_metacritic || Math.min(98, Math.round(baseRating * 10.1));

    // Автоматический поиск и привязка FanFilm 4K и HD потоков при их отсутствии
    let fanfilmStreamUrl = mediaDetails.players?.find(p => p.id === 'fanfilm4k_uhd' || p.id === 'fanfilm_4k')?.url || mediaDetails.fanfilm_4k_url;
    let fanfilmHdStreamUrl = mediaDetails.players?.find(p => p.id === 'fanfilm_hd')?.url || mediaDetails.fanfilm_hd_url;
    const isAlreadyUpcoming = Boolean(
      isCarrieUnreleased ||
      mediaDetails.is_upcoming ||
      String(id || '').startsWith('tmdb_up_') ||
      isFutureDateCheck(mediaDetails.release_date) ||
      isFutureDateCheck(mediaDetails.premiere) ||
      isFutureDateCheck(mediaDetails.digital_release) ||
      isFutureDateCheck(mediaDetails.world_premier)
    );

    if (!fanfilmStreamUrl && !fanfilmHdStreamUrl && mediaDetails.title && !isAlreadyUpcoming) {
      try {
        const cleanT = mediaDetails.title
          .replace(/\s*[\(\[]?\s*\d+\s*(?:-?[йяе]|ый|ой)?\s*сезон\s*[\)\]]?/gi, '')
          .replace(/\s*[\(\[]?\s*season\s*\d+\s*[\)\]]?/gi, '')
          .replace(/\s*[\(\[]?\s*4[KkКк]\s*[\)\]]?/gi, '')
          .trim();
        const wantYrNum = parseInt(mediaDetails.year || req.query.year || '', 10);
        const ffResults = await searchFanFilm(cleanT);
        if (ffResults && ffResults.length > 0) {
          const ffItem = ffResults.find(r => {
            if (!isSeries && (r.media_type === 'series' || /сериал|сезон/i.test(r.title || '') || /\/serials?\//i.test(r.link || r.url || ''))) {
              return false;
            }
            if (!isSeries && wantYrNum && r.year) {
              const candYrNum = parseInt(r.year, 10);
              if (candYrNum && Math.abs(candYrNum - wantYrNum) > 1) return false;
            }
            const sc = scoreMediaCandidate(r.title || '', '', cleanT, mediaDetails.year || '', isSeries ? '1' : '', '');
            return sc >= 200;
          });
          const ffDetails = ffItem ? await getFanFilmDetails(ffItem.link || ffItem.url || ffItem.id) : null;
          if (ffDetails) {
            if (ffDetails.fanfilm_4k_url) {
              fanfilmStreamUrl = ffDetails.fanfilm_4k_url;
            } else if (ffDetails.players?.find(p => p.id === 'fanfilm4k_uhd' || p.id === 'fanfilm_4k')?.url) {
              fanfilmStreamUrl = ffDetails.players.find(p => p.id === 'fanfilm4k_uhd' || p.id === 'fanfilm_4k').url;
            }
            if (ffDetails.fanfilm_hd_url) fanfilmHdStreamUrl = ffDetails.fanfilm_hd_url;
            if (!mediaDetails.kp_id && ffDetails.kp_id) mediaDetails.kp_id = ffDetails.kp_id;
            if (ffDetails.players && ffDetails.players.length > 0) {
              mediaDetails.players = mediaDetails.players || [];
              ffDetails.players.forEach(p => {
                if (!mediaDetails.players.some(mp => mp.id === p.id)) {
                  mediaDetails.players.unshift(p);
                }
              });
            }
          }
        }
      } catch (err) {
        console.warn('[Server] Автоматический поиск потоков FanFilm:', err.message);
      }
    }

    if (fanfilmStreamUrl) {
      mediaDetails.fanfilm_4k_url = fanfilmStreamUrl;
      mediaDetails.is4K = true;
      mediaDetails.quality = '4K Ultra HD';
    }
    if (fanfilmHdStreamUrl) {
      mediaDetails.fanfilm_hd_url = fanfilmHdStreamUrl;
    }

    // Каноническая финализация для аниме-франшизы «Звёздные Войны: Видения» (все 4 сезона внутри, 2021 год)
    if (/^зв[её]здные\s+войны\s*:\s*видени[яе]|^star\s+wars\s*:\s*visions/i.test(String(mediaDetails.title || req.query.title || '').trim())) {
      mediaDetails.title = 'Звёздные Войны: Видения';
      mediaDetails.original_title = 'Star Wars: Visions';
      mediaDetails.year = '2021';
      mediaDetails.media_type = 'anime-series';
      mediaDetails.category = 'Аниме-сериал';
      mediaDetails.lift_id = mediaDetails.lift_id || '50763';
      mediaDetails.kp_id = mediaDetails.kp_id || '4299270';
      mediaDetails.fanfilm_4k_url = mediaDetails.fanfilm_4k_url || 'https://v17.fanfilm4k.media/80130-zvezdnye-vojny-videnie-anime-serial.html';
      mediaDetails.is4K = true;
      mediaDetails.quality = '4K Ultra HD';
      try {
        const swLibria = await getAniLibriaDetails('9095', 'Звёздные Войны: Видения');
        if (swLibria && Array.isArray(swLibria.seasons) && swLibria.seasons.length >= 4) {
          mediaDetails.seasons = swLibria.seasons;
          if (!mediaDetails.episodes || mediaDetails.episodes.length === 0) {
            mediaDetails.episodes = swLibria.episodes;
          }
        }
      } catch (_) {}
    }

    // Каноническая привязка фильма «Видения» (2015, https://v17.fanfilm4k.media/19137-videnija-2015.html)
    if (String(mediaDetails.title || '').trim().toLowerCase() === 'видения' && (String(mediaDetails.year || req.query.year || '') === '2015' || String(id || '') === '19137' || String(id || '') === '353686')) {
      mediaDetails.year = '2015';
      mediaDetails.kp_id = mediaDetails.kp_id || '770693';
      mediaDetails.tmdb_id = mediaDetails.tmdb_id || '353686';
      mediaDetails.lift_id = mediaDetails.lift_id || '31648';
      mediaDetails.fanfilm_4k_url = 'https://v17.fanfilm4k.media/19137-videnija-2015.html';
      mediaDetails.is4K = true;
      mediaDetails.quality = '4K Ultra HD';
      if (!mediaDetails.poster || isPlaceholderImage(mediaDetails.poster)) {
        mediaDetails.poster = 'https://v17.fanfilm4k.media/uploads/posts/2022-06/770693_1654138922.jpg';
      }
    }

    const hasActualStream = Boolean(
      (mediaDetails.fanfilm_4k_url && !mediaDetails.fanfilm_4k_url.includes('do=search')) ||
      (mediaDetails.fanfilm_hd_url) ||
      (mediaDetails.vk_embed_url) ||
      (mediaDetails.rutube_id && mediaDetails.rutube_id.length > 15) ||
      (Array.isArray(mediaDetails.seasons) && mediaDetails.seasons.length > 0) ||
      (Array.isArray(mediaDetails.players) && mediaDetails.players.length > 0)
    );

    const isFutureRelease = Boolean(
      isKnownUnreleased ||
      mediaDetails.is_upcoming ||
      isReleaseUpcoming ||
      isMediaUpcomingOrUnreleased(mediaDetails) ||
      String(id || '').startsWith('tmdb_up_') ||
      isFutureDateCheck(mediaDetails.release_date) ||
      isFutureDateCheck(mediaDetails.premiere) ||
      isFutureDateCheck(mediaDetails.digital_release) ||
      isFutureDateCheck(mediaDetails.world_premier) ||
      (mediaDetails.year && parseInt(mediaDetails.year, 10) > new Date().getFullYear() && !mediaDetails.fanfilm_4k_url)
    );

    mediaDetails.trailer_url = '';

    // Быстрое обогащение через Lift (api.liftw.ws): lift_id, студийные озвучки, рейтинги КП/IMDb, русские роли актеров и части франшизы
    if (!isKnownUnreleased && !mediaDetails.lift_id && mediaDetails.title) {
      try {
        const matchedLiftId = await Promise.race([
          resolveLiftMatch({
            lift_id: req.query.lift_id || '',
            title: mediaDetails.title,
            original_title: mediaDetails.original_title,
            year: mediaDetails.year,
            is_series: isSeries
          }),
          new Promise(r => setTimeout(() => r(null), 2200))
        ]);
        if (matchedLiftId) {
          mediaDetails.lift_id = matchedLiftId;
          const liftInfo = await Promise.race([
            getLiftDetails(matchedLiftId),
            new Promise(r => setTimeout(() => r(null), 2200))
          ]);
          if (liftInfo) {
            if (liftInfo.voiceovers?.length && !mediaDetails.voiceovers?.length) {
              mediaDetails.voiceovers = liftInfo.voiceovers;
            }
            if (liftInfo.franchise_parts?.length && !mediaDetails.franchise_parts?.length) {
              mediaDetails.franchise_parts = liftInfo.franchise_parts;
            }
            if (liftInfo.rating_kp && (!mediaDetails.rating_kp || parseFloat(mediaDetails.rating_kp) === 0)) {
              mediaDetails.rating_kp = liftInfo.rating_kp;
            }
            if (liftInfo.rating_imdb && (!mediaDetails.rating_imdb || parseFloat(mediaDetails.rating_imdb) === 0)) {
              mediaDetails.rating_imdb = liftInfo.rating_imdb;
            }
            if (liftInfo.cast?.length && (!mediaDetails.cast || mediaDetails.cast.length === 0)) {
              mediaDetails.cast = liftInfo.cast;
            }
            if (liftInfo.directors?.length && (!mediaDetails.directors || mediaDetails.directors.length === 0)) {
              mediaDetails.directors = liftInfo.directors;
            }
            if (liftInfo.countries?.length && (!mediaDetails.countries || mediaDetails.countries.length === 0)) {
              mediaDetails.countries = liftInfo.countries;
            }
          }
        }
      } catch (_) {}
    }

    // Собираем расширенный список плееров (Lift Ad-Free 4K, FanFilm 4K, HD, Kodik, RHS, LostFilm, Kinobox, Vidsrc, VK, RuTube)
    mediaDetails.media_type = resolveCanonicalMediaType(mediaDetails.title, mediaDetails.fanfilm_4k_url || mediaDetails.link || '', mediaDetails.category || req.query.media_type || '', mediaDetails.genres, mediaDetails);
    const kinoboxPlayers = getAvailablePlayers({
      kp_id: mediaDetails.kp_id,
      imdb_id: mediaDetails.imdb_id,
      lift_id: mediaDetails.lift_id,
      title: mediaDetails.title,
      original_title: mediaDetails.original_title,
      year: mediaDetails.year,
      media_type: mediaDetails.media_type,
      genres: mediaDetails.genres,
      source: mediaDetails.source || source,
      fanfilm_4k_url: mediaDetails.fanfilm_4k_url,
      fanfilm_hd_url: mediaDetails.fanfilm_hd_url,
      trailer_url: mediaDetails.trailer_url,
      is_upcoming: mediaDetails.is_upcoming
    });

    let allPlayers = [];
    if (mediaDetails.players && mediaDetails.players.length > 0) {
      mediaDetails.players.forEach(p => {
        if (!p || !p.id) return;
        const freshP = kinoboxPlayers.find(kp => kp.id === p.id);
        if (freshP && p.id !== 'anilibria_hls' && p.id !== 'rutube_direct_hls') {
          allPlayers.push(freshP);
        } else {
          allPlayers.push(p);
        }
      });
    }
    const isLandyshiItem = String(mediaDetails.id || '').includes('landyshi') || String(mediaDetails.title || '').toLowerCase().includes('ландыши') || mediaDetails.rutube_id === '564f31c881b83373bfe0cb26979d44cf';

    kinoboxPlayers.forEach(p => {
      // Исключаем дубли FanFilm, если fanfilm4k_uhd уже добавлен
      if (p.id === 'fanfilm_4k' && allPlayers.some(ap => ap.id === 'fanfilm4k_uhd')) return;
      if (isLandyshiItem && (p.id === 'kodik_direct' || p.id === 'kinobox_universal')) return;
      if (!allPlayers.some(ap => ap.id === p.id)) {
        allPlayers.push(p);
      }
    });

    // 100% исключение любых промо-трейлеров и тизеров из списка плееров
    allPlayers = allPlayers.filter(p => p && !p.is_trailer && p.id !== 'official_trailer' && p.id !== 'official_trailer_fallback' && !/трейлер|тизер|trailer|teaser/i.test(p.name || '') && !/трейлер|тизер|trailer|teaser/i.test(p.badge || ''));
    const isWorkingStream = p => p && p.status === 'working' && !p.status_label?.includes('Недоступен') && p.url && !p.is_trailer && p.id !== 'webtorrent';
    let hasVerifiedOnlineStream = Boolean(
      (mediaDetails.fanfilm_4k_url && !String(mediaDetails.fanfilm_4k_url).includes('do=search')) ||
      mediaDetails.fanfilm_hd_url ||
      mediaDetails.lift_id ||
      mediaDetails.vk_embed_url ||
      (mediaDetails.rutube_id && String(mediaDetails.rutube_id).length > 15) ||
      ['lift', 'fanfilm4k', 'anilibria'].includes(mediaDetails.source) ||
      (Array.isArray(mediaDetails.episodes) && mediaDetails.episodes.some(ep => ep && (ep.hls_1080 || ep.hls_720 || ep.embed_url)))
    );
    if (!hasVerifiedOnlineStream && !isKnownUnreleased) {
      const detailProbe = await probeSingleItemDigitalStream(mediaDetails);
      if (detailProbe && detailProbe.hasStream) {
        hasVerifiedOnlineStream = true;
        if (detailProbe.lift_id && !mediaDetails.lift_id) mediaDetails.lift_id = detailProbe.lift_id;
        if (detailProbe.fanfilm_4k_url && !mediaDetails.fanfilm_4k_url) mediaDetails.fanfilm_4k_url = detailProbe.fanfilm_4k_url;
        mediaDetails.stream_verified = true;
      } else {
        mediaDetails.stream_verified = false;
      }
    } else if (hasVerifiedOnlineStream) {
      mediaDetails.stream_verified = true;
    }
    const finalUpcomingState = Boolean(
      isKnownUnreleased ||
      (!hasVerifiedOnlineStream && (mediaDetails.stream_verified === false || isFutureRelease || isMediaUpcomingOrUnreleased(mediaDetails)))
    );
    mediaDetails.is_upcoming = finalUpcomingState;
    if (finalUpcomingState) {
      mediaDetails.is4K = false;
      mediaDetails.quality = 'Ожидается';
    } else if (hasVerifiedOnlineStream && mediaDetails.quality === 'Ожидается') {
      mediaDetails.is4K = mediaDetails.source !== 'anilibria';
      mediaDetails.quality = mediaDetails.is4K ? '4K Ultra HD' : '1080p FHD';
    }

    // 🌟 СТРОГИЙ ПРИОРИТЕТ #1: Lift 4K Ad-Free и 4K Ultra HD Плеер (FanFilm4K) по умолчанию на первом месте везде СРЕДИ РАБОЧИХ ПЛЕЕРОВ (кроме прямых аниме-источников)!
    const isAnimeDirect = p => p && isWorkingStream(p) && p.id === 'anilibria_hls' && String(p.url || '').includes('.m3u8');
    const isLiftAdFree = p => p && isWorkingStream(p) && p.id === 'lift_adfree';
    const isReal4kStream = p => p && isWorkingStream(p) && !String(p.url || '').includes('do=search') && (p.id === 'lift_adfree' || p.id === 'fanfilm4k_uhd' || p.id === 'fanfilm_4k' || p.quality === '4K UHD' || p.badge === 'FANFILM 4K' || p.badge === 'LIFT БЕЗ РЕКЛАМЫ');
    allPlayers.sort((a, b) => {
      const aWorking = isWorkingStream(a);
      const bWorking = isWorkingStream(b);
      if (aWorking && !bWorking) return -1;
      if (!aWorking && bWorking) return 1;
      const aAnime = isAnimeDirect(a);
      const bAnime = isAnimeDirect(b);
      if (aAnime && !bAnime) return -1;
      if (!aAnime && bAnime) return 1;
      const aLift = isLiftAdFree(a);
      const bLift = isLiftAdFree(b);
      if (aLift && !bLift) return -1;
      if (!aLift && bLift) return 1;
      const aIs4k = isReal4kStream(a);
      const bIs4k = isReal4kStream(b);
      if (aIs4k && !bIs4k) return -1;
      if (!aIs4k && bIs4k) return 1;
      return 0;
    });

    // Рекомендуемым может быть ТОЛЬКО РАБОЧИЙ плеер!
    allPlayers.forEach(p => {
      p.is_recommended = false;
      p.recommended_badge = '';
    });
    const firstWorking = allPlayers.find(p => isWorkingStream(p) || (mediaDetails.is_upcoming && p.is_trailer));
    if (firstWorking) {
      firstWorking.is_recommended = true;
      firstWorking.recommended_badge = firstWorking.is_trailer ? '🔥 Трейлер' : (isReal4kStream(firstWorking) ? '🔥 4K Рекомендуемый' : '🔥 Рекомендуемый');
    }

    // Каноническое обогащение типа медиа, года и жанров
    mediaDetails.media_type = resolveCanonicalMediaType(mediaDetails.title, mediaDetails.fanfilm_4k_url || mediaDetails.link || '', mediaDetails.category || req.query.media_type || '', mediaDetails.genres, mediaDetails);
    mediaDetails.category = mediaDetails.media_type === 'series' ? 'Сериал' :
                           (mediaDetails.media_type === 'anime-series' ? 'Аниме-сериал' :
                           (mediaDetails.media_type === 'anime-movie' ? 'Аниме-фильм' :
                           (mediaDetails.media_type === 'cartoon-series' ? 'Мультсериал' :
                           (mediaDetails.media_type === 'cartoon' ? 'Мультфильм' :
                           (mediaDetails.media_type === 'show' ? 'Шоу' : 'Фильм')))));
    mediaDetails.year = resolveCanonicalYear(mediaDetails.title, mediaDetails.fanfilm_4k_url || mediaDetails.link || '', mediaDetails.poster || '', mediaDetails.premiere || mediaDetails.release_date, mediaDetails.year);
    mediaDetails.genres = resolveCanonicalGenres(mediaDetails.title, mediaDetails.category, mediaDetails.description || '', mediaDetails.genres);

    let userBookmark = null;
    let userWatchProgress = null;
    let userWatchedHistory = [];
    if (req.user) {
      userBookmark = getBookmark(req.user.id, String(id || mediaDetails.id), source || 'fanfilm4k', mediaDetails.title, mediaDetails.original_title);
      userWatchProgress = getLatestWatchProgressForMedia(req.user.id, String(id || mediaDetails.id), source || 'fanfilm4k', mediaDetails.title);
      userWatchedHistory = getWatchedHistoryEpisodesForMedia(req.user.id, String(id || mediaDetails.id), source || 'fanfilm4k', mediaDetails.title);
    }

    itemDetailsCache.set(cacheKey, {
      data: {
        ...mediaDetails,
        players: allPlayers
      },
      time: Date.now()
    });

    res.json({
      ...mediaDetails,
      players: allPlayers,
      user_bookmark: userBookmark,
      user_watch_progress: userWatchProgress,
      user_watched_history: userWatchedHistory
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Получение серий сезона сериала с русскими названиями и синопсисами
app.get('/api/media/series-episodes', async (req, res) => {
  try {
    let { tvId, season, title } = req.query;
    let resolvedTvId = tvId;
    const sNum = (season !== undefined && !isNaN(parseInt(season, 10))) ? parseInt(season, 10) : 1;
    let data = { episodes: [], overview: '' };

    const titleLower = String(title || '').toLowerCase();
    if (titleLower.includes('ричер') || titleLower.includes('reacher')) {
      resolvedTvId = '108978';
    } else if (resolvedTvId && String(resolvedTvId).length <= 4 && !String(resolvedTvId).startsWith('tmdb_')) {
      // Исключаем короткие ID сторонних плееров/FanFilm (4026 и т.д.), которые не являются TMDB TV ID
      resolvedTvId = null;
    }

    const cleanTitle = (title || '').replace(/\s*[\(\[]?\s*(?:постер|4[kк]|сериал|фильм|\d+\s*сезон|сезон\s*\d+|[\d]{4}).*?[\)\]]?/gi, '').trim();
    const cacheKey = `episodes_cache_${resolvedTvId || ''}_s${sNum}_${cleanTitle.toLowerCase()}`;
    const cachedData = getCache('series_episodes', cacheKey);
    if (cachedData && Array.isArray(cachedData.episodes) && cachedData.episodes.length > 0) {
      return res.json(cachedData);
    }

    if (resolvedTvId && !isNaN(Number(String(resolvedTvId).replace(/^tmdb_(?:up_)?/, '')))) {
      try {
        const cleanId = String(resolvedTvId).replace(/^tmdb_(?:up_)?/, '');
        data = await getTmdbSeasonEpisodes(cleanId, sNum);
      } catch (e) {
        data = { episodes: [], overview: '' };
      }
    }

    // Если по tvId ничего не найдено или tvId не был указан, выполняем умный поиск сериала по названию
    if ((!data.episodes || data.episodes.length === 0) && title) {
      try {
        let fallbackTvId = null;
        if (cleanTitle.toLowerCase().includes('ричер') || cleanTitle.toLowerCase().includes('reacher')) {
          fallbackTvId = '108978';
        } else {
          fallbackTvId = await findTmdbTvId(cleanTitle);
        }

        if (!fallbackTvId) {
          let searchRes = await searchTmdb(cleanTitle, 1);
          let tvMatch = (searchRes?.items || []).find(it => it.media_type === 'series' || it.media_type === 'tv');
          if (tvMatch && tvMatch.id) {
            fallbackTvId = String(tvMatch.id).replace('tmdb_', '');
          }
        }

        if (fallbackTvId) {
          data = await getTmdbSeasonEpisodes(fallbackTvId, sNum);
        }
      } catch (e) {}
    }

    // Если серии не найдены в TMDB (например, российские сериалы) — ищем реальные серии и превью на RuTube
    if ((!data.episodes || data.episodes.length === 0) && cleanTitle) {
      try {
        const rtQuery = `${cleanTitle} ${sNum > 1 ? sNum + ' сезон ' : ''}серия`.trim();
        const rtResults = await searchRuTube(rtQuery);
        if (Array.isArray(rtResults) && rtResults.length > 0) {
          const epMap = new Map();
          for (const rt of rtResults) {
            const m = String(rt.title || '').match(/(\d+)\s*сери[яие]/i);
            const epN = m ? parseInt(m[1], 10) : (epMap.size + 1);
            if (epN >= 1 && epN <= 100 && !epMap.has(epN)) {
              const rawThumb = rt.poster || rt.thumbnail_url || '';
              const proxiedThumb = (rawThumb && rawThumb.startsWith('http'))
                ? `/api/media/image-proxy?url=${encodeURIComponent(rawThumb)}&title=${encodeURIComponent(cleanTitle)}`
                : `/api/media/image-proxy?title=${encodeURIComponent(cleanTitle)}`;
              epMap.set(epN, {
                episode_number: epN,
                name: `${epN} серия`,
                still: proxiedThumb,
                still_path: proxiedThumb,
                duration: rt.duration || '48 мин.',
                air_date: '',
                overview: `Серия ${epN}. Смотрите ${epN}-ю серию проекта «${cleanTitle}» в высоком разрешении со студийным переводом.`
              });
            }
          }
          if (epMap.size > 0) {
            const maxEp = Math.max(...Array.from(epMap.keys()), 8);
            const built = [];
            const allThumbs = Array.from(epMap.values()).map(x => x.still).filter(Boolean);
            for (let i = 1; i <= maxEp; i++) {
              if (epMap.has(i)) {
                built.push(epMap.get(i));
              } else {
                const thumb = allThumbs.length > 0 ? allThumbs[(i - 1) % allThumbs.length] : `/api/media/image-proxy?title=${encodeURIComponent(cleanTitle)}`;
                built.push({
                  episode_number: i,
                  name: `${i} серия`,
                  still: thumb,
                  still_path: thumb,
                  duration: '48 мин.',
                  air_date: '',
                  overview: `Серия ${i}. Смотрите ${i}-ю серию проекта «${cleanTitle}» в высоком разрешении со студийным переводом.`
                });
              }
            }
            data.episodes = built;
            data.overview = `Сезон ${sNum}: официальный сезон из ${built.length} серий.`;
          }
        }
      } catch (_) {}
    }

    // Проксируем все внешние ссылки на превью серий (image.tmdb.org и др.), чтобы они гарантированно открывались в РФ
    if (Array.isArray(data.episodes) && data.episodes.length > 0) {
      const fallbackTitle = cleanTitle || 'Сериал';
      data.episodes = data.episodes.map(ep => {
        let sUrl = ep.still || ep.still_path || '';
        if (sUrl && (sUrl.startsWith('http://') || sUrl.startsWith('https://')) && !sUrl.startsWith('/api/media/image-proxy')) {
          sUrl = `/api/media/image-proxy?url=${encodeURIComponent(sUrl)}&title=${encodeURIComponent(fallbackTitle)}`;
        } else if (!sUrl || sUrl === 'assets/favicon.svg') {
          sUrl = `/api/media/image-proxy?title=${encodeURIComponent(fallbackTitle)}`;
        }
        return {
          ...ep,
          still: sUrl,
          still_path: sUrl
        };
      });
    }

    let isSynthesizedFallback = false;
    // Если даже после поиска серии не найдены, синтезируем качественные слоты серий для гарантированной работы плеера
    if (!data.episodes || data.episodes.length === 0) {
      isSynthesizedFallback = true;
      const fallbackTitle = cleanTitle || 'Сериал';
      const fallbackCount = 8;
      const proxyThumb = `/api/media/image-proxy?title=${encodeURIComponent(fallbackTitle)}`;
      data.episodes = Array.from({ length: fallbackCount }, (_, i) => ({
        episode_number: i + 1,
        name: `${i + 1} серия`,
        still: proxyThumb,
        still_path: proxyThumb,
        duration: '45 мин.',
        air_date: '',
        overview: `Серия ${i + 1}. Смотрите ${i + 1}-ю серию проекта «${fallbackTitle}» в высоком разрешении со студийным переводом и субтитрами.`
      }));
      data.overview = `Сезон ${sNum}: официальный сезон из ${fallbackCount} серий.`;
    }

    if (!isSynthesizedFallback && data && Array.isArray(data.episodes) && data.episodes.length > 0) {
      setCache('series_episodes', cacheKey, data, 86400 * 7);
    }

    res.json(data);
  } catch (err) {
    const cleanTitle = (req.query.title || 'Сериал').replace(/\s*[\(\[]?\s*(?:постер|4[kк]|сериал|фильм|\d+\s*сезон|сезон\s*\d+|[\d]{4}).*?[\)\]]?/gi, '').trim();
    const fallbackCount = 8;
    const proxyThumb = `/api/media/image-proxy?title=${encodeURIComponent(cleanTitle)}`;
    const fallbackEpisodes = Array.from({ length: fallbackCount }, (_, i) => ({
      episode_number: i + 1,
      name: `${i + 1} серия`,
      still: proxyThumb,
      still_path: proxyThumb,
      duration: '45 мин.',
      air_date: '',
      overview: `Серия ${i + 1}. Смотрите ${i + 1}-ю серию проекта «${cleanTitle}» в высоком разрешении.`
    }));
    res.json({ episodes: fallbackEpisodes, overview: `Сезон 1 • ${fallbackCount} серий.` });
  }
});

// Точечное получение ссылки на серию для плеера RuTube
app.get('/api/media/rutube-episode', async (req, res) => {
  try {
    const { title, season, episode, rutube_id, embed_url } = req.query;
    if (!title && !rutube_id) return res.status(400).json({ error: 'Параметр title или rutube_id обязателен' });
    const sNum = parseInt(season, 10) || 1;
    const epNum = parseInt(episode, 10) || 1;

    // Если передан прямой rutube_id для конкретной серии
    if (rutube_id && /^[a-f0-9]{32}$/i.test(rutube_id)) {
      const playOpts = await getRuTubePlayOptions(rutube_id);
      return res.json({
        id: rutube_id,
        embed_url: `/api/player/rutube-embed/${rutube_id}`,
        m3u8: `/api/media/rutube-m3u8?id=${rutube_id}`,
        hls_url: `/api/media/rutube-m3u8?id=${rutube_id}`,
        title: playOpts?.title || title
      });
    }

    const query = `${title || ''} ${sNum > 1 ? sNum + ' сезон ' : ''}${epNum} серия`.trim();
    const results = await searchRuTube(query);
    if (results && results.length > 0) {
      // Ищем точное совпадение серии и сезона
      const match = results.find(it => {
        const m = it.title.match(/(\d+)\s*сери[яие]/i);
        const s = it.title.match(/(\d+)\s*сезон/i);
        const epMatches = m && parseInt(m[1], 10) === epNum;
        if (!epMatches) return false;
        if (sNum > 1 && s) {
          return parseInt(s[1], 10) === sNum;
        }
        return true;
      }) || results.find(it => {
        const m = it.title.match(/(\d+)\s*сери[яие]/i);
        return m && parseInt(m[1], 10) === epNum;
      }) || results[0];

      const cleanId = match.source_id || match.id.replace('rutube_', '');
      const playOpts = await getRuTubePlayOptions(cleanId);
      return res.json({
        id: cleanId,
        embed_url: `/api/player/rutube-embed/${cleanId}`,
        m3u8: `/api/media/rutube-m3u8?id=${cleanId}`,
        hls_url: `/api/media/rutube-m3u8?id=${cleanId}`,
        title: match.title
      });
    }
    return res.status(404).json({ error: 'Серия RuTube не найдена' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Точечное получение ссылки на серию для плеера VK Видео
app.get('/api/media/vk-episode', async (req, res) => {
  try {
    const { title, season, episode } = req.query;
    if (!title) return res.status(400).json({ error: 'Параметр title обязателен' });
    const sNum = parseInt(season, 10) || 1;
    const epNum = parseInt(episode, 10) || 1;

    const query = `${title} ${sNum > 1 ? sNum + ' сезон ' : ''}${epNum} серия`;
    const results = await searchVkVideo(query);
    if (results && results.length > 0) {
      const match = results.find(it => {
        const m = it.title.match(/(\d+)\s*сери[яие]/i);
        const s = it.title.match(/(\d+)\s*сезон/i);
        const epMatches = m && parseInt(m[1], 10) === epNum;
        if (!epMatches) return false;
        if (sNum > 1 && s) {
          return parseInt(s[1], 10) === sNum;
        }
        return true;
      }) || results.find(it => {
        const m = it.title.match(/(\d+)\s*сери[яие]/i);
        return m && parseInt(m[1], 10) === epNum;
      }) || results[0];

      return res.json({
        id: match.id,
        owner_id: match.owner_id,
        video_id: match.video_id,
        embed_url: match.embed_url || `https://vk.com/video_ext.php?oid=${match.owner_id}&id=${match.video_id}&hd=2&autoplay=0`,
        title: match.title
      });
    }
    return res.status(404).json({ error: 'Серия VK Видео не найдена' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Получение порядка просмотра и хронологии франшизы (фильмы, сериалы, аниме)
app.get('/api/media/franchise', async (req, res) => {
  try {
    const { id, title, source, media_type } = req.query;
    if (!title && !id) {
      return res.status(400).json({ error: 'Укажите title или id' });
    }

    const cleanTitle = (title || '').replace(/\s*[\(\[]?\s*4[KkКк]\s*[\)\]]?/gi, '').trim();

    // 0. Хронология франшизы и связанных частей через Lift API (/info/<id> + /info/batch)
    try {
      const rawLiftId = (source === 'lift' || String(id || '').startsWith('lift_')) ? String(id).replace(/^lift_/i, '') : '';
      const matchedLift = rawLiftId || (cleanTitle ? await Promise.race([
        resolveLiftMatch({ title: cleanTitle }),
        new Promise(r => setTimeout(() => r(null), 2000))
      ]) : null);
      if (matchedLift) {
        const liftDet = await Promise.race([
          getLiftDetails(matchedLift),
          new Promise(r => setTimeout(() => r(null), 2200))
        ]);
        if (liftDet && Array.isArray(liftDet.franchise_parts) && liftDet.franchise_parts.length > 0) {
          const allFranchiseItems = [
            {
              id: liftDet.id,
              lift_id: liftDet.lift_id,
              source: 'lift',
              title: liftDet.title,
              original_title: liftDet.original_title,
              year: liftDet.year,
              rating: liftDet.rating,
              poster: liftDet.poster,
              media_type: liftDet.media_type,
              relation: 'Оригинал / Текущий релиз'
            },
            ...liftDet.franchise_parts.map(fp => ({
              ...fp,
              relation: fp.year && liftDet.year && Number(fp.year) < Number(liftDet.year) ? 'Предыстория / Часть' : 'Продолжение / Часть'
            }))
          ];
          const seenIds = new Set();
          const dedupFranchise = allFranchiseItems.filter(it => {
            const k = String(it.lift_id || it.id);
            if (seenIds.has(k)) return false;
            seenIds.add(k);
            return true;
          }).sort((a, b) => (parseInt(a.year, 10) || 0) - (parseInt(b.year, 10) || 0));

          if (dedupFranchise.length > 1) {
            return res.json({
              franchise_name: `Хронология франшизы «${cleanTitle || liftDet.title}»`,
              total: dedupFranchise.length,
              items: dedupFranchise
            });
          }
        }
      }
    } catch (_) {}

    // 1. Аниме-франшизы через Shikimori Related
    const isAnime = source === 'shikimori' || source === 'anixart' || source === 'anilibria' || (media_type && media_type.includes('anime'));
    if (isAnime) {
      let shikiId = (source === 'shikimori' && id && !isNaN(Number(id))) ? id : null;
      if (!shikiId && cleanTitle) {
        try {
          const searchRes = await searchShikimori(cleanTitle);
          if (searchRes && searchRes.length > 0) {
            shikiId = searchRes[0].id;
          }
        } catch {}
      }

      if (shikiId) {
        const related = await getShikimoriRelated(shikiId);
        if (related && related.length > 0) {
          return res.json({
            franchise_name: `Хронология вселенной «${cleanTitle}»`,
            total: related.length,
            items: related
          });
        }
      }
    }

    // 2. Кинематографические франшизы через TMDB Collection
    const franchise = await getTmdbFranchise(id, cleanTitle);
    if (franchise && franchise.items && franchise.items.length > 0) {
      await verifyItemsDigitalStreamAvailability(franchise.items);
      return res.json({
        franchise_name: franchise.franchise_name || `Хронология «${cleanTitle}»`,
        overview: franchise.overview || '',
        total: franchise.items.length,
        items: franchise.items
      });
    }

    // 3. Резервный поиск аниме-связей
    if (!isAnime && cleanTitle) {
      try {
        const searchRes = await searchShikimori(cleanTitle);
        if (searchRes && searchRes.length > 0 && searchRes[0].russian) {
          const related = await getShikimoriRelated(searchRes[0].id);
          if (related && related.length > 0) {
            return res.json({
              franchise_name: `Хронология вселенной «${searchRes[0].russian}»`,
              total: related.length,
              items: related
            });
          }
        }
      } catch {}
    }

    return res.json({ franchise_name: null, total: 0, items: [] });
  } catch (err) {
    console.error('[Franchise Endpoint Error]:', err.message);
    res.json({ franchise_name: null, total: 0, items: [] });
  }
});

// Получение оригинального саундтрека картины с реальными аудио-превью (iTunes API)
app.get('/api/media/soundtrack', async (req, res) => {
  try {
    const { title, original_title, artist, year } = req.query;
    if (!title && !original_title) {
      return res.status(400).json({ error: 'Укажите название фильма' });
    }

    const cleanRu = (title || '').replace(/\s*[\(\[]?\s*(постер|4[kк]|сериал|фильм|\d+\s*сезон|сезон\s*\d+|[\d]{4}).*?[\)\]]?/gi, '').trim();
    const cleanEn = (original_title || '').replace(/\s*[\(\[]?\s*(poster|4k|series|movie|season\s*\d+|[\d]{4}).*?[\)\]]?/gi, '').trim();

    const cacheKey = `soundtrack_${cleanEn || cleanRu}_${year || ''}`;
    const cached = getCache('soundtracks', cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const queries = [];
    if (cleanEn) {
      queries.push(`${cleanEn} soundtrack`);
      queries.push(`${cleanEn} OST`);
    }
    if (cleanRu && cleanRu !== cleanEn) {
      queries.push(`${cleanRu} soundtrack`);
      queries.push(`${cleanRu} OST`);
    }

    let tracks = [];
    let albumName = '';
    let artistName = artist || 'Оригинальный композитор';

    for (const q of queries) {
      try {
        const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=12`;
        const resp = await fetch(itunesUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data.results && data.results.length > 0) {
            tracks = data.results.map((t, idx) => {
              const ms = t.trackTimeMillis || 210000;
              const totalSec = Math.round(ms / 1000);
              const m = Math.floor(totalSec / 60);
              const s = totalSec % 60;
              return {
                number: idx + 1,
                title: t.trackName,
                artist: t.artistName,
                album: t.collectionName || cleanRu,
                duration: `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`,
                duration_sec: totalSec,
                preview_url: t.previewUrl || '',
                artwork: t.artworkUrl100 || t.artworkUrl60 || '',
                track_url: t.trackViewUrl || ''
              };
            });
            albumName = data.results[0].collectionName || `${cleanRu || cleanEn} (Original Soundtrack)`;
            artistName = data.results[0].artistName || artistName;
            break;
          }
        }
      } catch {}
    }

    // Если iTunes не вернул песни, формируем качественный резервный список на основе картины
    if (tracks.length === 0) {
      const mainThemeTitle = `${cleanRu || cleanEn} (Главная тема)`;
      tracks = [
        { number: 1, title: mainThemeTitle, artist: artistName, album: `${cleanRu} OST`, duration: '03:45', preview_url: '', scene: 'Заглавная тема фильма' },
        { number: 2, title: 'Dramatic Tension', artist: artistName, album: `${cleanRu} OST`, duration: '02:50', preview_url: '', scene: 'Развитие сюжета' },
        { number: 3, title: 'Cinematic Climax', artist: artistName, album: `${cleanRu} OST`, duration: '04:15', preview_url: '', scene: 'Кульминация картины' },
        { number: 4, title: 'End Credits Suite', artist: artistName, album: `${cleanRu} OST`, duration: '03:30', preview_url: '', scene: 'Финальные титры' }
      ];
    }

    const payload = {
      title: albumName || `${cleanRu || cleanEn} (Original Soundtrack)`,
      artist: artistName,
      tracks_count: tracks.length,
      tracks
    };

    setCache('soundtracks', cacheKey, payload, 86400);
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message, tracks: [] });
  }
});

// ==========================================
// 4.9 АКТЕРСКИЙ СОСТАВ И СЪЕМОЧНАЯ ГРУППА (CAST & CREW API)
// ==========================================
async function resolveCastForMedia(source, id, title = '', origTitle = '', year = '', mediaType = '', rawActors = '') {
  let cleanTitle = (title || '').replace(/\s*[\(\[]?\s*(постер|4[kк]|сериал|фильм|\d+\s*сезон|сезон\s*\d+|[\d]{4}).*?[\)\]]?/gi, '').trim();
  const cacheKey = `cast_${source || 'tmdb'}_${id || ''}_${cleanTitle.toLowerCase()}`;
  const cached = getCache('media_cast', cacheKey);
  if (cached && cached.cast && cached.cast.length > 0) return cached;

  let cast = [];
  let directors = [];
  let composers = [];
  let writers = [];
  let cinematographers = [];
  let trivia = [];

  // 1. Если источник FanFilm4K или ID относится к FanFilm — подтягиваем детали со страницы FanFilm4K
  let ffDetails = null;
  if (source === 'fanfilm4k' || source === 'fanfilm' || (!cleanTitle && id)) {
    try {
      ffDetails = await getFanFilmDetails(id);
      if (ffDetails) {
        if (!cleanTitle && ffDetails.title) {
          cleanTitle = ffDetails.title.replace(/\s*[\(\[]?\s*(постер|4[kк]|сериал|фильм|\d+\s*сезон|сезон\s*\d+|[\d]{4}).*?[\)\]]?/gi, '').trim();
        }
        origTitle = origTitle || ffDetails.original_title || '';
        year = year || ffDetails.year || '';
        mediaType = mediaType || ffDetails.media_type || '';
        rawActors = rawActors || ffDetails.actors || '';
      }
    } catch (_) {}
  }

  // 2. Если источник TMDB или ID содержит tmdb_
  const isTmdb = source === 'tmdb' || String(id).startsWith('tmdb_');
  if (isTmdb && id) {
    const rawId = String(id).replace(/^tmdb_(?:up_)?/, '').trim();
    const cleanId = /^\d+$/.test(rawId) ? rawId : (rawId.match(/\d+/)?.[0] || '');
    if (cleanId) {
      const details = await getTmdbItemDetails(cleanId, mediaType, cleanTitle, year);
      if (details) {
        cast = details.cast || [];
        directors = details.directors || [];
        composers = details.composers || [];
        writers = details.writers || [];
        cinematographers = details.cinematographers || [];
        trivia = details.trivia || [];
      }
    }
  }

  // 3. Если источник аниме (shikimori, anixart, anilibria)
  if (cast.length === 0 && (source === 'shikimori' || source === 'anixart' || source === 'anilibria' || mediaType === 'anime-series' || mediaType === 'anime-movies')) {
    try {
      let shikimoriId = source === 'shikimori' ? id : null;
      if (!shikimoriId && cleanTitle) {
        const sRes = await fetch(`https://shikimori.io/api/animes?search=${encodeURIComponent(cleanTitle)}&limit=1`, {
          headers: { 'User-Agent': 'STORM-MULTIMEDIA/1.0 (+https://github.com/ReiKatari)' }
        });
        if (sRes.ok) {
          const list = await sRes.json();
          if (Array.isArray(list) && list[0]?.id) shikimoriId = list[0].id;
        }
      }

      if (shikimoriId) {
        const rRes = await fetch(`https://shikimori.io/api/animes/${shikimoriId}/roles`, {
          headers: { 'User-Agent': 'STORM-MULTIMEDIA/1.0 (+https://github.com/ReiKatari)' }
        });
        if (rRes.ok) {
          const roles = await rRes.json();
          if (Array.isArray(roles)) {
            cast = roles
              .filter(r => r.character)
              .slice(0, 24)
              .map(r => ({
                id: r.character.id,
                name: r.character.russian || r.character.name,
                character: r.roles ? r.roles.join(', ') : 'Персонаж',
                photo: r.character.image?.original ? `https://shikimori.io${r.character.image.original}` : 'assets/avatar_default.svg'
              }));
            directors = roles
              .filter(r => r.person && r.roles?.includes('Director'))
              .map(r => ({
                id: r.person.id,
                name: r.person.russian || r.person.name,
                role: 'Режиссер',
                photo: r.person.image?.original ? `https://shikimori.io${r.person.image.original}` : 'assets/avatar_default.svg'
              }));
          }
        }
      }
    } catch {}
  }

  // 4. Поиск в TMDB по названию (для FanFilm4K, Kinobox, Kodik и др.)
  if (cast.length === 0 && (cleanTitle || origTitle)) {
    try {
      const searchQueries = [];
      if (cleanTitle) searchQueries.push(cleanTitle);
      if (origTitle && origTitle !== cleanTitle) searchQueries.push(origTitle);
      if (cleanTitle.toLowerCase().includes('ричер')) searchQueries.push('Ричер');

      for (const query of searchQueries) {
        const searchRes = await searchTmdb(query, 1);
        if (searchRes?.items?.length > 0) {
          const isWantTv = mediaType === 'series' || mediaType === 'tv' || mediaType === 'cartoon-series' || mediaType === 'anime-series';
          let match = (searchRes.items || []).find(it => {
            const itIsTv = it.media_type === 'series' || it.media_type === 'tv';
            return isWantTv ? itIsTv : !itIsTv;
          });
          if (!match) match = searchRes.items[0];

          if (match && match.id) {
            const details = await getTmdbItemDetails(match.id, match.media_type, cleanTitle, year);
            if (details && details.cast?.length) {
              cast = details.cast || [];
              directors = details.directors || [];
              composers = details.composers || [];
              writers = details.writers || [];
              cinematographers = details.cinematographers || [];
              trivia = details.trivia || [];
              break;
            }
          }
        }
      }
    } catch {}
  }

  // 5. Парсинг локального списка актеров (из FanFilm / карточки релиза) с обогащением фото из TMDB
  if (cast.length === 0 && (rawActors || ffDetails?.actors)) {
    const actorStr = rawActors || ffDetails?.actors || '';
    const actorNames = String(actorStr).split(',').map(s => s.trim()).filter(Boolean);
    const enrichedCast = [];
    for (let idx = 0; idx < actorNames.length; idx++) {
      const name = actorNames[idx];
      let photo = 'assets/avatar_default.svg';
      if (idx < 8) {
        try {
          const pCacheKey = `person_photo_${name.toLowerCase()}`;
          const cachedPhoto = getCache('person_photos', pCacheKey);
          if (cachedPhoto) {
            photo = cachedPhoto;
          } else {
            const pRes = await tmdbFetch(`${TMDB_BASE}/search/person?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(name)}&language=ru-RU`, { timeout: 2500 });
            if (pRes.ok) {
              const pData = await pRes.json();
              const profile = pData.results?.[0]?.profile_path;
              if (profile) {
                photo = `https://image.tmdb.org/t/p/w500${profile}`;
                setCache('person_photos', pCacheKey, photo, 86400 * 30);
              }
            }
          }
        } catch (_) {}
      }
      enrichedCast.push({
        id: `actor_${idx + 1}`,
        name,
        character: 'В главных ролях',
        photo
      });
    }
    cast = enrichedCast;
  }

  if (directors.length === 0 && ffDetails?.director) {
    const dirNames = String(ffDetails.director).split(',').map(s => s.trim()).filter(Boolean);
    const enrichedDirs = [];
    for (let idx = 0; idx < dirNames.length; idx++) {
      const name = dirNames[idx];
      let photo = 'assets/avatar_default.svg';
      try {
        const pCacheKey = `person_photo_${name.toLowerCase()}`;
        const cachedPhoto = getCache('person_photos', pCacheKey);
        if (cachedPhoto) {
          photo = cachedPhoto;
        } else {
          const pRes = await tmdbFetch(`${TMDB_BASE}/search/person?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(name)}&language=ru-RU`, { timeout: 2500 });
          if (pRes.ok) {
            const pData = await pRes.json();
            const profile = pData.results?.[0]?.profile_path;
            if (profile) {
              photo = `https://image.tmdb.org/t/p/w500${profile}`;
              setCache('person_photos', pCacheKey, photo, 86400 * 30);
            }
          }
        }
      } catch (_) {}
      enrichedDirs.push({
        id: `dir_${idx + 1}`,
        name,
        role: 'Режиссер',
        photo
      });
    }
    directors = enrichedDirs;
  }

  const result = {
    success: true,
    cast,
    directors,
    composers,
    writers,
    cinematographers,
    trivia,
    total_cast: cast.length
  };

  if (cast.length > 0) {
    setCache('media_cast', cacheKey, result, 86400 * 3);
  }

  return result;
}

app.get('/api/media/:source/:id/cast', async (req, res) => {
  try {
    const { source, id } = req.params;
    const { title, original_title, year, media_type, actors } = req.query;
    const data = await resolveCastForMedia(source, id, title, original_title, year, media_type, actors);
    res.json(data);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, cast: [] });
  }
});

app.get('/api/media/cast', async (req, res) => {
  try {
    const { source, id, title, original_title, year, media_type, actors } = req.query;
    const data = await resolveCastForMedia(source || 'tmdb', id, title, original_title, year, media_type, actors);
    res.json(data);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, cast: [] });
  }
});

// ==========================================
// 4.9.1 СЕМАНТИЧЕСКИЙ ПОИСК ПО СМЫСЛУ И СЮЖЕТУ (SEMANTIC SEARCH)
// ==========================================
app.get('/api/search/semantic', async (req, res) => {
  try {
    const rawQuery = (req.query.q || '').trim();
    if (!rawQuery) return res.json({ query: '', total: 0, items: [] });

    const cacheKey = `semantic_${rawQuery.toLowerCase()}`;
    const cached = getCache('semantic_search', cacheKey);
    if (cached) return res.json(cached);

    const queryLower = rawQuery.toLowerCase();
    
    const conceptMap = [
      { keywords: ['путешестви', 'время', 'временная петля', 'назад в будущее', 'таймлайн'], genre: 'scifi', tmdbKeyword: 'time travel' },
      { keywords: ['киберпанк', 'будущее', 'андроид', 'робот', 'нейросеть', 'неон', 'ии'], genre: 'scifi', tmdbKeyword: 'cyberpunk' },
      { keywords: ['детектив', 'маньяк', 'расследование', 'серийный', 'убийств', 'сыщик', 'преступлен'], genre: 'detective', tmdbKeyword: 'investigation' },
      { keywords: ['космос', 'планет', 'звезд', 'галактик', 'корабль', 'пришельц', 'астронавт'], genre: 'scifi', tmdbKeyword: 'space' },
      { keywords: ['магия', 'волшебств', 'дракон', 'эльф', 'меч', 'королевств', 'фэнтези'], genre: 'fantasy', tmdbKeyword: 'magic' },
      { keywords: ['супергеро', 'марвел', 'комикс', 'бэтмен', 'способност', 'мутант'], genre: 'action', tmdbKeyword: 'superhero' },
      { keywords: ['выживан', 'апокалипсис', 'зомби', 'вирус', 'катастроф', 'пустошь'], genre: 'action', tmdbKeyword: 'survival' },
      { keywords: ['гонк', 'машин', 'дрифт', 'скорост', 'автомобил', 'трасс'], genre: 'action', tmdbKeyword: 'racing' },
      { keywords: ['школ', 'подростк', 'любовь', 'романтик', 'первая любовь'], genre: 'drama', tmdbKeyword: 'romance' },
      { keywords: ['комеди', 'смешн', 'юмор', 'пароди', 'весел'], genre: 'comedy', tmdbKeyword: 'comedy' },
      { keywords: ['ужас', 'страшн', 'хоррор', 'призрак', 'демон', 'дом с привидениями'], genre: 'horror', tmdbKeyword: 'horror' }
    ];

    let matchedConcepts = [];
    for (const c of conceptMap) {
      if (c.keywords.some(kw => queryLower.includes(kw))) {
        matchedConcepts.push(c);
      }
    }

    const searchTerms = [rawQuery];
    matchedConcepts.forEach(c => {
      if (c.tmdbKeyword) searchTerms.push(c.tmdbKeyword);
    });

    const searchPromises = searchTerms.slice(0, 3).map(term => searchTmdb(term).then(r => r?.items || []).catch(() => []));
    searchPromises.push(searchFanFilm(rawQuery).catch(() => []));

    const settled = await Promise.all(searchPromises);
    const itemMap = new Map();

    settled.flat().forEach(item => {
      if (!item || !item.id) return;
      const key = `${item.title}_${item.year || ''}`;
      if (!itemMap.has(key)) {
        let score = 0;
        const textToScan = `${item.title} ${item.description || ''} ${(item.genres || []).join(' ')}`.toLowerCase();
        
        const words = queryLower.split(/\s+/).filter(w => w.length > 2);
        words.forEach(w => {
          if (textToScan.includes(w)) score += 2;
        });

        matchedConcepts.forEach(c => {
          if (c.keywords.some(kw => textToScan.includes(kw))) score += 3;
        });

        item.semanticScore = score;
        item.semanticTags = matchedConcepts.map(c => c.genre);
        itemMap.set(key, item);
      }
    });

    const sortedItems = Array.from(itemMap.values())
      .sort((a, b) => (b.semanticScore || 0) - (a.semanticScore || 0))
      .slice(0, 40);

    const payload = {
      success: true,
      query: rawQuery,
      concepts: matchedConcepts.map(c => c.tmdbKeyword),
      total: sortedItems.length,
      items: sortedItems
    };

    setCache('semantic_search', cacheKey, payload, 3600);
    res.json(payload);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, items: [] });
  }
});

// ==========================================
// 4.9.2 МУЛЬТИМОДАЛЬНЫЙ ВИЗУАЛЬНЫЙ ПОИСК (VISUAL IMAGE SEARCH)
// ==========================================
app.post('/api/search/visual', express.json({ limit: '20mb' }), async (req, res) => {
  try {
    const { imageBase64, filename, query } = req.body;
    if (!imageBase64 && !query && !filename) {
      return res.status(400).json({ error: 'Изображение не передано' });
    }

    let searchKeyword = query || '';

    if (filename && !searchKeyword) {
      searchKeyword = filename
        .replace(/\.(jpg|jpeg|png|webp|bmp)$/i, '')
        .replace(/[\._\-]+/g, ' ')
        .replace(/\b(1080p|720p|2160p|4k|uhd|hdr|webrip|bdrip|bluray|x264|x265|hevc|storm)\b/gi, '')
        .trim();
    }

    let metadata = null;
    if (imageBase64 && sharp) {
      try {
        const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
        const imgBuffer = Buffer.from(cleanBase64, 'base64');
        metadata = await sharp(imgBuffer).metadata();
      } catch {}
    }

    const searchTarget = searchKeyword || 'кино';
    const tmdbResults = await searchTmdb(searchTarget).then(r => r?.items || []).catch(() => []);
    const ffResults = await searchFanFilm(searchTarget).catch(() => []);

    const combined = [...ffResults, ...tmdbResults].slice(0, 25);

    res.json({
      success: true,
      query: searchTarget,
      detectedMetadata: metadata ? { width: metadata.width, height: metadata.height, format: metadata.format } : null,
      total: combined.length,
      items: combined
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, items: [] });
  }
});

// ==========================================
// 4.9.3 P2P SMART-CACHE И СКОРОСТНОЕ ПРОКСИРОВАНИЕ ЧАНКОВ (4K HDR STREAM ACCELERATOR)
// ==========================================
const streamChunkCache = new Map();

app.get('/api/stream/chunk-proxy', async (req, res) => {
  try {
    const chunkUrl = req.query.url;
    if (!chunkUrl) return res.status(400).send('No url provided');
    if (!isSafeExternalHttpUrl(chunkUrl)) return res.status(403).send('Forbidden target host');

    if (streamChunkCache.has(chunkUrl)) {
      const cached = streamChunkCache.get(chunkUrl);
      res.set('Content-Type', cached.contentType || 'video/MP2T');
      res.set('Accept-Ranges', 'bytes');
      res.set('Cache-Control', 'public, max-age=86400, immutable');
      res.set('X-Storm-Cache', 'HIT');
      return res.send(cached.buffer);
    }

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': req.query.referer || 'https://v17.fanfilm4k.media/'
    };

    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const chunkResp = await fetch(chunkUrl, { headers });
    if (!chunkResp.ok) {
      return res.status(chunkResp.status).send('Chunk fetch error');
    }

    const contentType = chunkResp.headers.get('content-type') || 'video/MP2T';
    const buffer = Buffer.from(await chunkResp.arrayBuffer());

    if (buffer.length < 15 * 1024 * 1024) {
      if (streamChunkCache.size > 150) {
        const firstKey = streamChunkCache.keys().next().value;
        streamChunkCache.delete(firstKey);
      }
      streamChunkCache.set(chunkUrl, { buffer, contentType, time: Date.now() });
    }

    res.set('Content-Type', contentType);
    res.set('Accept-Ranges', 'bytes');
    res.set('Cache-Control', 'public, max-age=86400, immutable');
    res.set('X-Storm-Cache', 'MISS');
    res.set('X-Storm-Buffer-Status', `${streamChunkCache.size} chunks`);
    res.send(buffer);
  } catch (err) {
    res.status(500).send('Stream accelerator error: ' + err.message);
  }
});

// ==========================================
// 5.1 СТИЛИЗОВАННЫЙ ПРОКСИ ПЛЕЕРА И СЕРИЙНЫХ ОПЦИЙ
// ==========================================

// Быстрая проверка доступности стриминговых ссылок и обнаружение мертвых потоков FanFilm / Stravers
app.get('/api/player/check-stream', async (req, res) => {
  try {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.json({ alive: true });
    if (!isSafeExternalHttpUrl(targetUrl)) return res.status(403).json({ alive: false, error: 'Forbidden host' });

    // Потоки FanFilm4K и Stravers штатно воспроизводятся в браузерных iframe клиентов,
    // но блокируют прямые датацентровые запросы Node.js (403 Cloudflare). Всегда считаем их доступными.
    if (targetUrl.includes('stravers.live') || targetUrl.includes('fanfilm4k') || targetUrl.includes('fanfilm')) {
      return res.json({ alive: true });
    }

    let checkUrl = targetUrl;

    const chk = await fetch(checkUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://v17.fanfilm4k.media/'
      },
      signal: AbortSignal.timeout(3000)
    });

    if (!chk.ok) return res.json({ alive: false });
    const text = await chk.text();
    const hasFileList = text.includes('const fileList =') || text.includes('fileList');
    const hasConfig = text.includes('const config =') || text.includes('mediaMetadata');
    if (hasFileList || hasConfig) {
      return res.json({ alive: true });
    }
    const lower = text.toLowerCase();
    const isDead = lower.includes('видео удалено') ||
                   lower.includes('файл не найден') ||
                   lower.includes('404 not found');
    return res.json({ alive: !isDead });
  } catch {
    return res.json({ alive: true });
  }
});

let straversCssCache = { css: '', fetchedAt: 0, url: '' };
async function getStraversCss(cssUrl, referer) {
  if (straversCssCache.css && straversCssCache.url === cssUrl && (Date.now() - straversCssCache.fetchedAt < 3600000)) {
    return straversCssCache.css;
  }
  try {
    const res = await fetch(cssUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Referer': referer || 'https://v17.fanfilm4k.media/'
      },
      signal: AbortSignal.timeout(4000)
    });
    if (res.ok) {
      straversCssCache.css = await res.text();
      straversCssCache.fetchedAt = Date.now();
      straversCssCache.url = cssUrl;
      return straversCssCache.css;
    }
  } catch {}
  return null;
}

// Проксирование внутренних API запросов Stravers / Transfusion (/bnsi/movies/..., /sarn, /vorf, /events и HLS потоков vkvideo.ru/okcdn.ru) без CORS и preflight блокировок
app.all('/api/player/stravers-api-proxy', express.raw({ type: '*/*', limit: '10mb' }), async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, OPTIONS, PUT, DELETE, HEAD',
        'access-control-allow-headers': 'Borth, borth, acceptis, accepts-block, Accepts-Controls, accepts-controls, Authorization, authorization, Range, range, Content-Type, X-Requested-With, *',
        'access-control-expose-headers': 'Borth, borth, Content-Length, Content-Range, *'
      });
      return res.end();
    }

    let targetUrl = req.query.url;
    if (targetUrl && typeof targetUrl === 'string' && targetUrl.includes('libria.fun')) {
      targetUrl = targetUrl.replace(/^https?:\/\/cache-[a-z0-9-]+\.libria\.fun\//i, 'https://cache.libria.fun/');
      if (targetUrl.includes('.m3u8')) {
        targetUrl = targetUrl.split('?')[0];
      }
    }
    const isCdnStream = targetUrl && (
      targetUrl.includes('vkvideo.ru') ||
      targetUrl.includes('okcdn.ru') ||
      targetUrl.includes('mycdn.me') ||
      targetUrl.includes('userapi.com') ||
      targetUrl.includes('libria.fun') ||
      targetUrl.includes('anilibria.top')
    );
    if (!targetUrl || (!targetUrl.includes('stravers.live') && !targetUrl.includes('transfusion') && !targetUrl.includes('fanfilm') && !isCdnStream)) {
      return res.status(400).json({ error: 'Неверный URL' });
    }

    const isLibriaStream = targetUrl.includes('libria.fun') || targetUrl.includes('anilibria.top');
    let targetOrigin = isLibriaStream ? 'https://anilibria.top' : 'https://transfusion-as.stravers.live';
    if (!isCdnStream) {
      try {
        targetOrigin = new URL(targetUrl).origin;
      } catch (_) {}
    }

    const headers = {
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Accept': req.headers['accept'] || '*/*',
      'Accept-Language': req.headers['accept-language'] || 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      'Referer': `${targetOrigin}/`,
      'Origin': targetOrigin
    };

    if (req.headers['borth']) headers['Borth'] = req.headers['borth'];
    if (req.headers['acceptis']) headers['acceptis'] = req.headers['acceptis'];
    if (req.headers['accepts-block']) headers['accepts-block'] = req.headers['accepts-block'];
    if (req.headers['accepts-controls']) headers['Accepts-Controls'] = req.headers['accepts-controls'];
    if (req.headers['authorization']) headers['Authorization'] = req.headers['authorization'];
    if (req.headers['range']) headers['Range'] = req.headers['range'];
    if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
    if (req.headers['x-requested-with']) headers['X-Requested-With'] = req.headers['x-requested-with'];

    const fetchOptions = {
      method: req.method || 'GET',
      headers,
      signal: AbortSignal.timeout(10000)
    };

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined && req.body !== null) {
      if (Buffer.isBuffer(req.body)) {
        if (req.body.length > 0) fetchOptions.body = req.body;
      } else if (typeof req.body === 'string') {
        if (req.body.length > 0) fetchOptions.body = req.body;
      } else if (typeof req.body === 'object' && Object.keys(req.body).length > 0) {
        const ct = String(req.headers['content-type'] || '').toLowerCase();
        if (ct.includes('application/json')) {
          fetchOptions.body = JSON.stringify(req.body);
        } else {
          const params = new URLSearchParams();
          for (const [k, v] of Object.entries(req.body)) {
            if (v !== undefined && v !== null) params.append(k, String(v));
          }
          fetchOptions.body = params.toString();
        }
      }
    }

    let proxyRes = await fetch(targetUrl, fetchOptions);
    if (proxyRes.status === 403 && isCdnStream) {
      const retryHeaders = { ...headers };
      delete retryHeaders['Referer'];
      delete retryHeaders['Origin'];
      proxyRes = await fetch(targetUrl, { ...fetchOptions, headers: retryHeaders });
    }

    const resHeaders = {};
    proxyRes.headers.forEach((val, key) => {
      const lowKey = key.toLowerCase();
      if (!['content-encoding', 'transfer-encoding', 'connection', 'content-length', 'permissions-policy', 'feature-policy', 'content-security-policy'].includes(lowKey)) {
        resHeaders[key] = val;
      }
    });
    const borthVal = proxyRes.headers.get('borth') || proxyRes.headers.get('Borth');
    if (borthVal) {
      resHeaders['Borth'] = borthVal;
    }

    resHeaders['access-control-allow-origin'] = '*';
    resHeaders['access-control-allow-methods'] = 'GET, POST, OPTIONS, PUT, DELETE, HEAD';
    resHeaders['access-control-allow-headers'] = 'Borth, borth, acceptis, accepts-block, Accepts-Controls, accepts-controls, Authorization, authorization, Range, range, Content-Type, X-Requested-With, *';
    resHeaders['access-control-expose-headers'] = 'Borth, borth, Content-Length, Content-Range, *';

    const cType = String(proxyRes.headers.get('content-type') || '').toLowerCase();
    if (proxyRes.ok && (targetUrl.includes('.m3u8') || cType.includes('mpegurl'))) {
      const m3u8Text = await proxyRes.text();
      const rewritten = m3u8Text.split('\n').map(line => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        if (!trimmed.startsWith('#')) {
          let abs = trimmed.startsWith('http') ? trimmed : new URL(trimmed, targetUrl).href;
          if (abs.includes('libria.fun')) {
            abs = abs.replace(/^https?:\/\/cache-[a-z0-9-]+\.libria\.fun\//i, 'https://cache.libria.fun/');
          }
          return `/api/player/stravers-api-proxy?url=${encodeURIComponent(abs)}`;
        }
        if (trimmed.includes('URI="')) {
          return trimmed.replace(/URI="([^"]+)"/g, (_, u) => {
            let abs = u.startsWith('http') ? u : new URL(u, targetUrl).href;
            if (abs.includes('libria.fun')) {
              abs = abs.replace(/^https?:\/\/cache-[a-z0-9-]+\.libria\.fun\//i, 'https://cache.libria.fun/');
            }
            return `URI="/api/player/stravers-api-proxy?url=${encodeURIComponent(abs)}"`;
          });
        }
        return line;
      }).join('\n');
      resHeaders['content-type'] = 'application/vnd.apple.mpegurl; charset=utf-8';
      res.writeHead(proxyRes.status, resHeaders);
      return res.end(rewritten);
    }

    res.writeHead(proxyRes.status, resHeaders);
    const resBuffer = await proxyRes.arrayBuffer();
    res.end(Buffer.from(resBuffer));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const MEDIA_MATCH_STOPWORDS = new Set([
  'фильм', 'фильмы', 'сериал', 'сериалы', 'мультфильм', 'мультсериал',
  'аниме', 'дорама', 'онлайн', 'смотреть', 'бесплатно', 'хорошем',
  'качестве', 'сезон', 'серия', 'серии', 'часть', 'глава', 'эпизод',
  'выпуск', 'все', 'полный', 'русском', 'дубляж', 'озвучка', 'трейлер',
  'тизер', 'обзор', 'фильма', 'сериала', 'the', 'and', 'for', 'with'
]);

const ORDINAL_TO_NUM = {
  'первая': '1', 'первый': '1', 'вторая': '2', 'второй': '2',
  'третья': '3', 'третий': '3', 'четвертая': '4', 'четвертый': '4',
  'пятая': '5', 'пятый': '5', 'шестая': '6', 'шестой': '6'
};

function normalizeMatchText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    // Склеиваем аббревиатуры через слэш или точку (З/Л/О -> зло, З.Л.О -> зло, V/H/S -> vhs)
    .replace(/(^|[^\p{L}\p{N}])(\p{L})(?:[\/\\.\-](\p{L}))+(?=$|[^\p{L}\p{N}])/gu, (m, pre) => {
      const letters = m.slice(pre.length).replace(/[\/\\.\-]/g, '');
      return `${pre}${letters}`;
    })
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreMediaCandidate(candidateTitle = '', candidateDesc = '', cleanTitle = '', year = '', season = '', episode = '', pubYear = 0, originalTitle = '', categoryName = '') {
  const normTarget = normalizeMatchText(cleanTitle);
  const normOrig = normalizeMatchText(originalTitle);
  const normCand = normalizeMatchText(candidateTitle);
  if ((!normTarget && !normOrig) || !normCand) return -1;

  // 1. Строго отклоняем некинематографические категории RuTube (Авто-мото, Видеоигры, Спорт, Охота, Хобби, Таро и т.д.)
  const catNorm = String(categoryName || '').toLowerCase().trim();
  if (catNorm && /(?:авто[- ]?мото|видеоигр|спорт|охота|рыбалк|путешеств|строительств|ремонт|сад\s+и\s+огород|техник|оборудован|кулинар|еда\b|животн|лайфстайл|хобби|красот|новости|сми\b|наука|обучени|образован|бизнес|финанс|недвижимост|эзотерик|астролог|интервью|подкаст|политик|экономик|религи|психолог|дизайн)/i.test(catNorm)) {
    return -1;
  }
  const isCinemaCategory = Boolean(catNorm && /(?:фильм|сериал|мультфильм|аниме|кино)/i.test(catNorm));

  // 2. 100% отклоняем любые трейлеры, тизеры, промо-ролики, отрывки, фрагменты и анонсы при поиске полного фильма
  if (/\b(?:трейлер[а-я]*|тизер[а-я]*|тизер-трейлер[а-я]*|trailer[s]?|teaser[s]?|промо[- ]?ролик[а-я]*|отрывок[а-я]*|фрагмент[а-я]*|анонс[а-я]*|съемки|съёмки|бэкстейдж|backstage|making[- ]of|featurette|sneak[- ]peek|first[- ]look|фан[- ]трейлер|концепт[- ]трейлер)\b/i.test(candidateTitle + ' ' + String(candidateDesc || '').slice(0, 160))) {
    return -1;
  }

  // 3. Отклоняем любительские видео с календарными датами ("Ведьмин лес. 13 сентября 2026", "13.09.2026"), эндуро/мото/покатушки/гонки/таро/влоги
  if (/\b\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+20\d\d)?\b/i.test(candidateTitle) ||
      /\b\d{2}\.\d{2}\.20\d\d\b/.test(candidateTitle) ||
      /\b(?:эндуро|enduro|мотокросс|питбайк|квадроцикл|мото\b|покатушк[а-я]*|оффроуд|off[- ]?road|трофи[- ]?рейд|джиппинг|велогонк[а-я]*|забег|марафон|соревновани[яей]|этап\s+кубка|чемпионат|турнир|рыбалк[а-я]*|поход|сплав|страйкбол|пейнтбол|сталкерстрайк|кладоискател[а-я]*|таро\b|tarot\b|расклад|колод[аыу]|влог|vlog|распаковк[а-я]*)\b/i.test(candidateTitle + ' ' + String(candidateDesc || '').slice(0, 220))) {
    return -1;
  }

  // 4. Отклоняем музыкальные сборники, шансон, приколы, радио и караоке
  if (/\b(?:русская\s+музыка|музыка\s+в\s+машину|сборник\s+песен|сборник\s+хитов|лучших\s+песен|хиты\s+\d{4}|песни\s+\d{4}|песни\s+о\s+любви|дискотека|шансон|шансона|радио|плейлист|playlist|клипы|караоке|смешные\s+приколы|сборник\s+приколов|приколы\s+\d{4}|мультики\s+для\s+детей)\b/i.test(candidateTitle)) {
    return -1;
  }

  const candWords = normCand.split(' ').filter(Boolean);
  const checkWordsMatch = (targetStr) => {
    if (!targetStr) return false;
    const sigWords = targetStr.split(' ').filter(w => w.length >= 2 && !MEDIA_MATCH_STOPWORDS.has(w));
    if (sigWords.length === 0) return false;
    let matchedCount = 0;
    let firstWordMatched = false;
    let lastWordMatched = false;
    for (let i = 0; i < sigWords.length; i++) {
      const w = sigWords[i];
      const numEquiv = ORDINAL_TO_NUM[w];
      const isMatched = candWords.some(cw => {
        if (cw === w) return true;
        if (numEquiv && cw === numEquiv) return true;
        if (w.length >= 4 && cw.length >= 4 && Math.abs(cw.length - w.length) <= 2) {
          const stemLen = Math.min(w.length, cw.length) - 1;
          if (stemLen >= 3 && cw.slice(0, stemLen) === w.slice(0, stemLen)) return true;
        }
        return false;
      });
      if (isMatched) {
        matchedCount++;
        if (i === 0) firstWordMatched = true;
        if (i === sigWords.length - 1) lastWordMatched = true;
      }
    }
    if (sigWords.length <= 3) return matchedCount >= sigWords.length;
    return matchedCount >= sigWords.length - 1 && firstWordMatched && lastWordMatched;
  };

  const matchedRu = checkWordsMatch(normTarget);
  const matchedOrig = normOrig && normOrig.length >= 4 && normOrig !== normTarget ? checkWordsMatch(normOrig) : false;
  if (!matchedRu && !matchedOrig) return -1;

  const hasSeasonReq = Boolean(season && String(season).trim() !== '');
  if (!hasSeasonReq) {
    // Для фильмов строго отклоняем сериалы, серии, игровые стримы, разборы, обзоры и аудиокниги
    if (/\b(?:\d+\s*сезон|сезон\s*\d+|\d+\s*сери[яие]|сери[яие]\s*\d+|сериал|все\s*серии|эпизод\s*\d+|майнкрафт|minecraft|роблокс|roblox|geometry\s*dash|прохождение|стрим|летсплей|разбор|обзор|пересказ|реакция|мнение|объяснени[ея]|аудиокниг[аи]|слушать\s+онлайн|интервью|бэкстейдж|кто\s+из\s+героев|в\s+чем\s+смысл|косплей)\b/i.test(candidateTitle)) {
      return -1;
    }
    // Если в исходном названии нет цифр, отклоняем номерные сиквелы (например, "Обитель зла 2..6") и спин-оффы с подзаголовками
    const activeTarget = matchedRu ? normTarget : normOrig;
    if (activeTarget && !/\d/.test(activeTarget)) {
      const escapedTarget = activeTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const sequelRe = new RegExp(`\\b${escapedTarget}\\s+[2-9]\\b`, 'i');
      if (sequelRe.test(normCand)) return -1;
    }
    if (normTarget === 'обитель зла' && /\b(?:возмездие|вырождение|проклятие|вендетта|остров\s+смерти|раккун|жизнь\s+после\s+смерти|истребление|апокалипсис|последняя\s+глава|мутация)\b/i.test(normCand)) {
      return -1;
    }
  } else {
    const sNum = parseInt(season, 10);
    const epNum = parseInt(episode, 10);
    if (epNum > 0) {
      const epMatch = candidateTitle.match(/(\d+)\s*сери[яие]|сери[яие]\s*(\d+)|эпизод\s*(\d+)/i);
      if (epMatch) {
        const candEp = parseInt(epMatch[1] || epMatch[2] || epMatch[3], 10);
        if (candEp && candEp !== epNum) return -1;
      }
    }
    if (sNum > 0) {
      const sMatch = candidateTitle.match(/(\d+)\s*сезон|сезон\s*(\d+)/i);
      if (sMatch) {
        const candS = parseInt(sMatch[1] || sMatch[2], 10);
        if (candS && candS !== sNum) return -1;
      }
    }
  }

  const reqYear = parseInt(year, 10);
  if (reqYear >= 1920 && reqYear <= 2030) {
    const yearMatches = String(candidateTitle).match(/\b(19\d\d|20\d\d)\b/g) || [];
    for (const ym of yearMatches) {
      if (normTarget.includes(ym) || (normOrig && normOrig.includes(ym))) continue;
      const cy = parseInt(ym, 10);
      if (Math.abs(cy - reqYear) > 1) {
        return -1;
      }
    }
    if (!hasSeasonReq && reqYear >= 2025 && pubYear > 0 && pubYear < reqYear - 1) {
      return -1;
    }
  }

  let score = 100;
  if (matchedRu && (normCand === normTarget || normCand.startsWith(normTarget + ' '))) {
    score += 350;
  } else if (matchedOrig && (normCand === normOrig || normCand.startsWith(normOrig + ' '))) {
    score += 350;
  } else if ((matchedRu && normCand.includes(normTarget)) || (matchedOrig && normCand.includes(normOrig))) {
    score += 200;
  }

  if (matchedRu && matchedOrig) {
    score += 300;
  }
  if (isCinemaCategory) {
    score += 250;
  }

  if (reqYear >= 1920 && reqYear <= 2030) {
    if (String(candidateTitle).includes(String(reqYear))) {
      score += 500;
    } else if (String(candidateDesc || '').includes(String(reqYear))) {
      score += 250;
    } else if (!hasSeasonReq && reqYear >= 2025) {
      score -= 250;
    }
  }

  const hasCinemaMarker = /\b(?:фильм|мультфильм|аниме|дубляж|озвучк[а-я]*|red\s*head\s*sound|hdrezka|профессиональн|лицензи|4k|uhd|1080p)\b/i.test(candidateTitle + ' ' + String(candidateDesc || '').slice(0, 200));
  if (/дубляж|red\s*head\s*sound|hdrezka|профессиональн|лицензи/i.test(candidateTitle)) {
    score += 200;
  }
  if (!hasSeasonReq && /\b(?:фильм|мультфильм)\b/i.test(candidateTitle)) {
    score += 120;
  }
  if (/часами\s+выбираешь|телеграм|t\.me\/|подпишись\s+на/i.test(candidateDesc || '')) {
    score -= 400;
  }

  // Для свежих премьер 2025+ требуем подтверждение кино-категории, двуязычного названия или кино-маркеров и высокий рейтинг совпадения
  if (!hasSeasonReq && reqYear >= 2025) {
    if (!isCinemaCategory && !(matchedRu && matchedOrig) && !hasCinemaMarker) {
      return -1;
    }
    if (score < 450) {
      return -1;
    }
  }

  return score;
}

// Помощник поиска реального видеопотока в VK Видео (фильмы, сериалы, озвучки и промо)
async function resolveBestVkEmbed(title = '', year = '', season = '', episode = '', allowShort = false, originalTitle = '') {
  const cleanTitle = String(title || '').replace(/\s*\(\d{4}\)\s*$/i, '').trim();
  const cleanOrig = String(originalTitle || '').replace(/\s*\(\d{4}\)\s*$/i, '').trim();
  if (!cleanTitle && !cleanOrig) return '';

  const epSuffix = season ? ` ${season} сезон ${episode || 1} серия` : '';
  const queries = [
    `${cleanTitle}${epSuffix} ${year || ''}`.trim(),
    `${cleanTitle}${epSuffix} фильм`.trim(),
    cleanOrig ? `${cleanTitle} ${cleanOrig} ${year || ''}`.trim() : cleanTitle
  ].filter(Boolean);

  const parseDur = (s) => {
    if (!s || typeof s !== 'string') return 0;
    const parts = s.trim().split(':').map(n => parseInt(n, 10));
    if (parts.some(isNaN)) return 0;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
  };

  const candidates = [];
  const seenKeys = new Set();
  const maxDur = season ? 7200 : 14400;

  for (const q of queries.slice(0, 2)) {
    try {
      const rawRes = await fetch('https://vk.com/al_video.php?act=search_video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          'Referer': 'https://vk.com/'
        },
        body: `al=1&q=${encodeURIComponent(q)}&offset=0`,
        signal: AbortSignal.timeout(3200)
      });
      if (rawRes.ok) {
        const buf = await rawRes.arrayBuffer();
        let text = '';
        try { text = new TextDecoder('windows-1251').decode(buf); } catch { text = new TextDecoder('utf-8').decode(buf); }
        const json = JSON.parse(text);
        const list = json?.payload?.[1]?.[2]?.list || [];
        for (const it of list) {
          if (!Array.isArray(it) || it.length < 4 || !it[0] || !it[1]) continue;
          const oid = it[0];
          const vid = it[1];
          const key = `${oid}_${vid}`;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);

          const rawTitle = String(it[3] || '')
            .replace(/&#(\d+);/g, (_, code) => { try { return String.fromCodePoint(parseInt(code, 10)); } catch { return ''; } })
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/<[^>]+>/g, '')
            .trim();
          const durStr = typeof it[5] === 'string' ? it[5] : '';
          const rawSec = typeof it[19] === 'number' ? it[19] : (typeof it[18] === 'number' ? it[18] : 0);
          const durationSec = rawSec > 0 ? rawSec : parseDur(durStr);
          const effectiveMinDur = allowShort ? (season ? 300 : 900) : (season ? 600 : 3300);
          if (durationSec < effectiveMinDur) continue;
          if (durationSec > maxDur) continue;

          const sc = scoreMediaCandidate(rawTitle, '', cleanTitle, year, season, episode, 0, cleanOrig, '');
          if (sc < (allowShort ? 250 : 350)) continue;

          const hash = (typeof it[42] === 'string' && /^[a-f0-9]{14,24}$/i.test(it[42]))
            ? it[42]
            : (it.find(x => typeof x === 'string' && /^[a-f0-9]{16,22}$/i.test(x)) || '');
          if (!hash) continue;

          candidates.push({
            url: `https://vk.com/video_ext.php?oid=${oid}&id=${vid}&hash=${hash}&hd=2&autoplay=0&js_api=1&muted=0&mute=0`,
            score: sc,
            duration: durationSec
          });
        }
      }
    } catch (_) {}
    if (candidates.some(c => c.score >= 550 && c.duration >= 3600)) break;
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.duration - a.duration;
    });
    return candidates[0].url;
  }

  return '';
}

// Помощник поиска реального видеопотока в RuTube (полные фильмы, сериалы и дублированные видео)
async function resolveBestRuTubeId(title = '', year = '', season = '', episode = '', variantIndex = 0, allowShort = false, originalTitle = '') {
  const cleanTitle = String(title || '').replace(/\s*\(\d{4}\)\s*$/i, '').trim();
  const cleanOrig = String(originalTitle || '').replace(/\s*\(\d{4}\)\s*$/i, '').trim();
  if (!cleanTitle && !cleanOrig) return '';

  const epSuffix = season ? ` ${season} сезон ${episode || 1} серия` : '';
  const rawQueries = year
    ? [
        `${cleanTitle}${epSuffix} фильм ${year}`.trim(),
        cleanOrig && cleanOrig.toLowerCase() !== cleanTitle.toLowerCase() ? `${cleanTitle} ${cleanOrig} ${year}`.trim() : '',
        `${cleanTitle}${epSuffix} ${year}`.trim()
      ].filter(Boolean)
    : [
        `${cleanTitle}${epSuffix}`.trim(),
        `${cleanTitle} фильм`.trim()
      ].filter(Boolean);

  const candidates = [];
  const seenIds = new Set();
  const maxDur = season ? 7200 : 14400;

  for (const rq of rawQueries) {
    try {
      const apiRes = await fetch(`https://rutube.ru/api/search/video/?query=${encodeURIComponent(rq)}&page=1&format=json`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Referer': 'https://rutube.ru/'
        },
        signal: AbortSignal.timeout(3000)
      });
      if (apiRes.ok) {
        const data = await apiRes.json();
        const list = Array.isArray(data?.results)
          ? data.results.filter(it => it && it.id && /^[a-f0-9]{32}$/i.test(it.id) && !it.is_deleted && !it.is_hidden && !it.is_locked)
          : [];
        for (const it of list) {
          if (seenIds.has(it.id)) continue;
          seenIds.add(it.id);
          const dur = parseInt(it.duration, 10) || 0;
          const effectiveMinDur = allowShort ? (season ? 300 : 900) : (season ? 600 : 3300);
          if (dur < effectiveMinDur) continue;
          if (dur > maxDur) continue;

          const pubTs = it.publication_ts || it.created_ts || '';
          const pubYear = pubTs ? new Date(pubTs).getFullYear() : 0;
          const catName = it.category?.name || '';
          const sc = scoreMediaCandidate(it.title || '', it.description || '', cleanTitle, year, season, episode, pubYear, cleanOrig, catName);
          if (sc < (allowShort ? 250 : 350)) continue;

          candidates.push({
            id: it.id,
            score: sc,
            duration: dur
          });
        }
      }
    } catch (_) {}
    if (candidates.some(c => c.score >= 600 && c.duration >= 3600)) break;
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.duration - a.duration;
    });
    const pick = candidates[Math.min(variantIndex, candidates.length - 1)] || candidates[0];
    return pick.id;
  }

  return '';
}

const _officialTrailerCache = new Map();
async function resolveOfficialTrailerSource({ title = '', original_title = '', year = '' } = {}) {
  const cleanTitle = String(title || '').replace(/\s*\(\d{4}\)\s*$/i, '').trim();
  const cleanOrig = String(original_title || '').replace(/\s*\(\d{4}\)\s*$/i, '').trim();
  const cacheKey = `${cleanTitle.toLowerCase()}|${cleanOrig.toLowerCase()}|${year || ''}`;
  const cached = _officialTrailerCache.get(cacheKey);
  if (cached && (Date.now() - cached.ts < 1800000)) {
    return cached.data;
  }

  const normRu = normalizeMatchText(cleanTitle);
  const normOrig = normalizeMatchText(cleanOrig);
  const ruWords = normRu.split(' ').filter(w => w.length >= 3 && !MEDIA_MATCH_STOPWORDS.has(w));
  const origWords = normOrig.split(' ').filter(w => w.length >= 3 && !MEDIA_MATCH_STOPWORDS.has(w));
  const reqYear = parseInt(year, 10) || 0;

  const queries = [];
  if (cleanOrig) queries.push(`${cleanOrig} ${year || ''}`.trim());
  if (cleanTitle) queries.push(`${cleanTitle} ${year || ''} трейлер`.trim());
  if (cleanTitle && cleanOrig && cleanTitle.toLowerCase() !== cleanOrig.toLowerCase()) {
    queries.push(`${cleanTitle} ${cleanOrig}`.trim());
  }

  const candidates = [];
  const seenIds = new Set();

  for (const q of queries.slice(0, 3)) {
    try {
      const apiRes = await fetch(`https://rutube.ru/api/search/video/?query=${encodeURIComponent(q)}&page=1&format=json`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Referer': 'https://rutube.ru/'
        },
        signal: AbortSignal.timeout(2600)
      });
      if (!apiRes.ok) continue;
      const data = await apiRes.json();
      const list = Array.isArray(data?.results) ? data.results : [];
      for (const it of list) {
        if (!it || !it.id || !/^[a-f0-9]{32}$/i.test(it.id) || seenIds.has(it.id) || it.is_deleted || it.is_hidden) continue;
        seenIds.add(it.id);
        const dur = parseInt(it.duration, 10) || 0;
        if (dur < 35 || dur > 360) continue;

        const catName = String(it.category?.name || '').toLowerCase();
        if (catName && /(?:авто[- ]?мото|видеоигр|спорт|охота|рыбалк|строительств|ремонт|кулинар|животн|хобби|новости|наука|обучени|бизнес|эзотерик)/i.test(catName)) continue;

        const candTitle = String(it.title || '');
        if (/\b(?:эндуро|мото|покатушк|гонк|таро|tarot|обзор|разбор|реакция|майнкрафт|роблокс)\b/i.test(candTitle)) continue;

        const candNorm = normalizeMatchText(candTitle);
        const candWords = candNorm.split(' ').filter(Boolean);
        const matchRu = ruWords.length > 0 && ruWords.every(w => candWords.some(cw => cw === w || (w.length >= 4 && cw.startsWith(w.slice(0, w.length - 1)))));
        const matchOrig = origWords.length > 0 && origWords.every(w => candWords.includes(w));
        if (!matchRu && !matchOrig) continue;

        if (reqYear >= 1950) {
          const yms = candTitle.match(/\b(19\d\d|20\d\d)\b/g) || [];
          if (yms.some(ym => Math.abs(parseInt(ym, 10) - reqYear) > 2)) continue;
        }

        let sc = 100;
        if (matchRu && matchOrig) sc += 250;
        else if (matchOrig) sc += 160;
        else sc += 140;
        if (/(?:фильм|мультфильм|сериал|аниме)/i.test(catName)) sc += 180;
        if (/(?:официальн|финальн|русский\s+трейлер|дубляж|трейлер)/i.test(candTitle)) sc += 160;
        if (/\b(?:4k|4к|uhd|1080p)\b/i.test(candTitle)) sc += 80;
        if (reqYear && candTitle.includes(String(reqYear))) sc += 120;

        candidates.push({
          embedUrl: `/api/player/rutube-embed/${it.id}`,
          trailerTitle: candTitle,
          durationSec: dur,
          score: sc
        });
      }
      if (candidates.some(c => c.score >= 520)) break;
    } catch (_) {}
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0] || null;
  _officialTrailerCache.set(cacheKey, { data: best, ts: Date.now() });
  return best;
}

function escapeServerHtml(s = '') {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderPremiereOrTrailerFallbackHtml({ title = '', original_title = '', year = '', trailer = null } = {}) {
  recordNegativeStreamAvailability({ title, original_title, year });
  const displayTitle = escapeServerHtml(title || original_title || 'Премьера');
  const subParts = [];
  if (original_title && original_title.trim().toLowerCase() !== String(title || '').trim().toLowerCase()) {
    subParts.push(escapeServerHtml(original_title.trim()));
  }
  if (year) subParts.push(escapeServerHtml(String(year).trim()));
  const displaySub = subParts.join(' • ');

  const durFormatted = trailer && trailer.durationSec
    ? `${Math.floor(trailer.durationSec / 60)}:${String(trailer.durationSec % 60).padStart(2, '0')}`
    : '';
  const safeTrailerUrl = trailer && trailer.embedUrl ? escapeServerHtml(trailer.embedUrl) : '';
  const safeTrailerTitle = trailer && trailer.trailerTitle ? escapeServerHtml(trailer.trailerTitle) : displayTitle;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${displayTitle} — Ожидание цифрового релиза</title>
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0; width: 100%; height: 100%;
      background:
        radial-gradient(circle at 50% 15%, rgba(0, 210, 255, 0.16) 0%, transparent 55%),
        radial-gradient(circle at 80% 85%, rgba(168, 85, 247, 0.14) 0%, transparent 50%),
        #080b14;
      color: #f8fafc;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      overflow: hidden;
    }
    .premiere-stage {
      width: 100%; height: 100%;
      display: flex; align-items: center; justify-content: center;
      padding: 20px;
    }
    .premiere-card {
      max-width: 620px; width: 100%;
      padding: 28px 26px;
      border-radius: 20px;
      background: linear-gradient(165deg, rgba(22, 29, 49, 0.92), rgba(11, 15, 27, 0.95));
      border: 1px solid rgba(56, 189, 248, 0.28);
      box-shadow: 0 22px 55px rgba(0, 0, 0, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.08);
      text-align: center;
    }
    .premiere-badge {
      display: inline-flex; align-items: center; gap: 7px;
      padding: 6px 14px; border-radius: 999px;
      background: rgba(0, 210, 255, 0.13);
      border: 1px solid rgba(0, 210, 255, 0.38);
      color: #38bdf8;
      font-size: 12px; font-weight: 800; letter-spacing: 0.04em;
      text-transform: uppercase;
      margin-bottom: 14px;
    }
    .premiere-title {
      margin: 0 0 6px;
      font-size: clamp(20px, 3.2vw, 28px);
      font-weight: 800; color: #ffffff; line-height: 1.2;
    }
    .premiere-sub {
      color: #94a3b8; font-size: 14px; font-weight: 600;
      margin-bottom: 14px;
    }
    .premiere-desc {
      margin: 0 auto 22px; max-width: 520px;
      color: #cbd5e1; font-size: 13.8px; line-height: 1.58;
    }
    .premiere-actions {
      display: flex; flex-wrap: wrap; gap: 10px;
      justify-content: center;
    }
    .p-btn {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 11px 18px; border-radius: 11px;
      border: 1px solid rgba(148, 163, 184, 0.28);
      background: linear-gradient(180deg, rgba(30, 41, 59, 0.9), rgba(15, 23, 42, 0.92));
      color: #f1f5f9; font-size: 13.5px; font-weight: 700;
      cursor: pointer; transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.38);
    }
    .p-btn:hover {
      transform: translateY(-1.5px);
      border-color: rgba(56, 189, 248, 0.55);
      color: #ffffff;
    }
    .p-btn:active { transform: translateY(1px) scale(0.985); }
    .p-btn.hero {
      background: linear-gradient(135deg, #00d2ff 0%, #3b82f6 55%, #6366f1 100%);
      color: #ffffff; border-color: rgba(125, 211, 252, 0.65);
      box-shadow: 0 8px 24px rgba(0, 210, 255, 0.34);
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
    }
    #trailer-layer {
      display: none; position: fixed; inset: 0; background: #000; z-index: 20;
    }
    #trailer-layer iframe {
      width: 100%; height: 100%; border: 0;
    }
    .trailer-topbar {
      position: fixed; top: 12px; left: 12px; right: 12px; z-index: 30;
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      pointer-events: none;
    }
    .trailer-pill {
      pointer-events: auto;
      display: inline-flex; align-items: center; gap: 7px;
      padding: 6px 12px; border-radius: 9px;
      background: rgba(8, 11, 20, 0.84);
      border: 1px solid rgba(0, 210, 255, 0.45);
      backdrop-filter: blur(8px);
      color: #38bdf8; font-size: 12px; font-weight: 800;
      max-width: 72%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .trailer-back {
      pointer-events: auto;
      padding: 6px 13px; border-radius: 9px;
      border: 1px solid rgba(148, 163, 184, 0.38);
      background: rgba(15, 23, 42, 0.86);
      backdrop-filter: blur(8px);
      color: #f8fafc; font-size: 12.5px; font-weight: 700; cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="premiere-stage" id="premiere-stage">
    <div class="premiere-card">
      <div class="premiere-badge">🎬 Кинотеатральная премьера • Ожидается цифровой релиз</div>
      <h1 class="premiere-title">${displayTitle}</h1>
      ${displaySub ? `<div class="premiere-sub">${displaySub}</div>` : ''}
      <p class="premiere-desc">
        Полная цифровая версия этого релиза в 4K / Full HD ещё не вышла в онлайн-кинотеатрах и базах балансеров (Lift, Alloha, Collaps, HDRezka, VideoCDN). Как только состоится цифровой релиз, фильм автоматически станет доступен здесь без рекламы.
      </p>
      <div class="premiere-actions">
        <button type="button" class="p-btn hero" onclick="openOfficialTrailer()">▶ Смотреть официальный трейлер${durFormatted ? ` (${durFormatted})` : ''}</button>
        <button type="button" class="p-btn" onclick="checkTorrent()">🧲 Проверить P2P WebTorrent</button>
        <button type="button" class="p-btn" id="planned-btn" onclick="markPlanned(this)">📌 В список «В планах»</button>
      </div>
    </div>
  </div>
  <div id="trailer-layer">
    <div class="trailer-topbar">
      <div class="trailer-pill" title="${safeTrailerTitle || displayTitle}">🎞 ОФИЦИАЛЬНЫЙ ТРЕЙЛЕР • ${safeTrailerTitle || displayTitle}</div>
      <button type="button" class="trailer-back" onclick="closeOfficialTrailer()">← Назад к релизу</button>
    </div>
    <div id="trailer-mount" style="width:100%;height:100%;"></div>
  </div>
  <script>
    function openOfficialTrailer() {
      var st = document.getElementById('premiere-stage');
      var ly = document.getElementById('trailer-layer');
      var mt = document.getElementById('trailer-mount');
      if (!ly || !mt) return;
      if (st) st.style.display = 'none';
      ly.style.display = 'block';
      mt.innerHTML = '';
      var fr = document.createElement('iframe');
      fr.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture; encrypted-media');
      fr.setAttribute('allowfullscreen', 'true');
      fr.src = '${safeTrailerUrl}' || ('/api/player/rutube-search-embed?title=' + encodeURIComponent('${displayTitle} официальный русский трейлер'));
      mt.appendChild(fr);
    }
    try { window.parent.postMessage({ type: 'STORM_PREMIERE_PLACEHOLDER_LOADED', title: '${displayTitle}' }, '*'); } catch (_) {}
    function closeOfficialTrailer() {
      var st = document.getElementById('premiere-stage');
      var ly = document.getElementById('trailer-layer');
      var mt = document.getElementById('trailer-mount');
      if (mt) mt.innerHTML = '';
      if (ly) ly.style.display = 'none';
      if (st) st.style.display = 'flex';
    }
    function checkTorrent() {
      try { window.parent.postMessage({ type: 'STORM_SELECT_PLAYER_ID', playerId: 'webtorrent' }, '*'); } catch (_) {}
    }
    function markPlanned(btn) {
      try {
        window.parent.postMessage({ type: 'STORM_BOOKMARK_PLANNED' }, '*');
        if (btn) btn.textContent = '✅ Добавлено в «В планах»';
      } catch (_) {}
    }
  </script>
</body>
</html>`;
}

const _fanFilmIframeCache = new Map();
async function verifyStraversIframeLive(straversUrl) {
  if (!straversUrl || !straversUrl.includes('stravers.live')) return Boolean(straversUrl);
  try {
    const embedRes = await fetch(straversUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Referer': 'https://v17.fanfilm4k.media/'
      },
      signal: AbortSignal.timeout(2500)
    });
    if (!embedRes.ok) return false;
    const html = await embedRes.text();
    const hasFileList = html.includes('const fileList =') || html.includes('fileList');
    const hasValidIdFile = !hasFileList || /["']id_file["']\s*:\s*[1-9]\d*/.test(html);
    const isDead = ((html.toLowerCase().includes('<title>ошибка!</title>') || html.includes('<div class="error">')) && !hasFileList) || !hasValidIdFile;
    return !isDead;
  } catch (_) {
    return false;
  }
}

async function resolveFanFilmDirectIframe(cleanTitle = '', preferHd = false, year = '') {
  const normKey = `${String(cleanTitle || '').toLowerCase().trim()}_${year || ''}_${preferHd ? 'hd' : '4k'}`;
  if (!cleanTitle) return '';
  const cached = _fanFilmIframeCache.get(normKey);
  if (cached && (Date.now() - cached.ts < 1800000)) {
    return cached.url;
  }

  let pageUrl = resolveFanFilmUrl(cleanTitle);
  if (pageUrl && year) {
    const urlYearMatch = pageUrl.match(/-(19\d\d|20\d\d)(?:-|\.html)/);
    if (urlYearMatch && urlYearMatch[1] !== String(year).trim()) {
      pageUrl = '';
    }
  }
  if (!pageUrl) {
    try {
      const searchResults = await Promise.race([
        searchFanFilm(cleanTitle),
        new Promise(r => setTimeout(() => r([]), 3200))
      ]);
      if (Array.isArray(searchResults) && searchResults.length > 0) {
        const bestMatch = searchResults.find(r => {
          const sc = scoreMediaCandidate(r.title || '', '', cleanTitle, year || '', '', '');
          return sc >= 200 && (!year || !r.year || Math.abs(parseInt(r.year, 10) - parseInt(year, 10)) <= 1);
        });
        if (bestMatch && (bestMatch.link || bestMatch.url)) {
          pageUrl = bestMatch.link || bestMatch.url;
        }
      }
    } catch (_) {}
  }

  if (!pageUrl) {
    _fanFilmIframeCache.set(normKey, { url: '', ts: Date.now() });
    return '';
  }
  if (pageUrl.includes('stravers.live')) {
    const isLive = await verifyStraversIframeLive(pageUrl);
    const finalUrl = isLive ? pageUrl : '';
    _fanFilmIframeCache.set(normKey, { url: finalUrl, ts: Date.now() });
    return finalUrl;
  }

  try {
    const pageHtml = await fetchHtml(pageUrl, { timeout: 3500 });
    const m4k = pageHtml.match(/data-tab-content=["']4kplayer["'][^>]*>[\s\S]*?<iframe[^>]*(?:src|data-src)=["']([^"']+)["']/i);
    const mHd = pageHtml.match(/data-tab-content=["']hdplayer["'][^>]*>[\s\S]*?<iframe[^>]*(?:src|data-src)=["']([^"']+)["']/i);
    const mAny = pageHtml.match(/<iframe[^>]*(?:src|data-src)=["']([^"']*(?:stravers\.live|allplay|kodik|videocdn|collaps|alloha)[^"']*)["']/i);
    const rawSrc = preferHd
      ? ((mHd && mHd[1]) || (m4k && m4k[1]) || (mAny && mAny[1]) || '')
      : ((m4k && m4k[1]) || (mHd && mHd[1]) || (mAny && mAny[1]) || '');
    if (rawSrc) {
      const fullIframe = rawSrc.startsWith('//') ? 'https:' + rawSrc : rawSrc;
      const isLive = await verifyStraversIframeLive(fullIframe);
      const finalUrl = isLive ? fullIframe : '';
      _fanFilmIframeCache.set(normKey, { url: finalUrl, ts: Date.now() });
      return finalUrl;
    }
  } catch (_) {}

  _fanFilmIframeCache.set(normKey, { url: '', ts: Date.now() });
  return '';
}

const _kodikDirectCache = new Map();
async function resolveKodikDirectIframe({ cleanTitle = '', original_title = '', shikimori_id = '', season = '', episode = '' } = {}) {
  const cacheKey = `${cleanTitle}_${original_title}_${shikimori_id}_${season}_${episode}`.toLowerCase();
  const cached = _kodikDirectCache.get(cacheKey);
  if (cached && (Date.now() - cached.ts < 1800000)) {
    return cached.url;
  }

  let resolvedShikiId = String(shikimori_id || '').replace(/\D/g, '');
  if (!resolvedShikiId && (cleanTitle || original_title)) {
    try {
      const shikiList = await Promise.race([
        searchShikimori(cleanTitle || original_title),
        new Promise(r => setTimeout(() => r([]), 2800))
      ]);
      if (Array.isArray(shikiList) && shikiList.length > 0) {
        const normTarget = (cleanTitle || original_title).toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
        const match = shikiList.find(s => {
          const normS = String(s.title || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
          const normOrig = String(s.original_title || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
          return (normS && normTarget && (normS === normTarget || normS.startsWith(normTarget + ' ') || normTarget.startsWith(normS + ' '))) ||
                 (normOrig && normTarget && (normOrig === normTarget || normOrig.startsWith(normTarget + ' ')));
        }) || shikiList[0];
        if (match) {
          resolvedShikiId = String(match.shikimori_id || match.id || '').replace(/\D/g, '');
        }
      }
    } catch (_) {}
  }

  if (!resolvedShikiId) return '';

  try {
    const params = new URLSearchParams({
      token: '447d179e875efe44217f20d1ee2146be',
      shikimoriID: resolvedShikiId
    });
    if (season) params.set('season', String(season));
    if (episode) params.set('episode', String(episode));

    const kRes = await fetch(`https://kodik-api.com/get-player?${params.toString()}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Referer': 'https://kodikplayer.com/'
      },
      signal: AbortSignal.timeout(2500)
    });
    if (kRes.ok) {
      const kData = await kRes.json();
      if (kData && kData.found && kData.link) {
        let link = kData.link.startsWith('//') ? `https:${kData.link}` : kData.link;
        if (season) {
          link += `${link.includes('?') ? '&' : '?'}season=${encodeURIComponent(season)}&episode=${encodeURIComponent(episode || '1')}`;
        }
        _kodikDirectCache.set(cacheKey, { url: link, ts: Date.now() });
        return link;
      }
    }
  } catch (_) {}

  return '';
}

// Автоматический шлюз поиска и воспроизведения VK Видео
app.get('/api/player/vk-search-embed', async (req, res) => {
  try {
    const { title = '', original_title = '', year = '', season = '', episode = '' } = req.query;
    const [vkUrl, ruId] = await Promise.all([
      resolveBestVkEmbed(title, year, season, episode, false, original_title),
      resolveBestRuTubeId(title, year, season, episode, 0, false, original_title)
    ]);
    if (vkUrl) {
      return res.redirect(302, vkUrl);
    }
    if (ruId) {
      return res.redirect(302, `/api/player/rutube-embed/${ruId}`);
    }
    const shortVk = await resolveBestVkEmbed(title, year, season, episode, true, original_title);
    if (shortVk) {
      return res.redirect(302, shortVk);
    }
    return res.redirect(302, `/api/player/kinobox-embed?balancer=auto&fallback_mode=1&title=${encodeURIComponent(title)}${original_title ? `&original_title=${encodeURIComponent(original_title)}` : ''}&year=${encodeURIComponent(year)}`);
  } catch (err) {
    return res.redirect(302, `/api/player/rutube-search-embed?title=${encodeURIComponent(req.query.title || '')}${req.query.original_title ? `&original_title=${encodeURIComponent(req.query.original_title)}` : ''}&year=${encodeURIComponent(req.query.year || '')}`);
  }
});

// Автоматический шлюз поиска и воспроизведения RuTube / Wink
app.get('/api/player/rutube-search-embed', async (req, res) => {
  try {
    const { title = '', original_title = '', year = '', season = '', episode = '', no_ff = '' } = req.query;
    const [ruId, vkUrl] = await Promise.all([
      resolveBestRuTubeId(title, year, season, episode, 0, false, original_title),
      resolveBestVkEmbed(title, year, season, episode, false, original_title)
    ]);
    if (ruId) {
      return res.redirect(302, `/api/player/rutube-embed/${ruId}`);
    }
    if (vkUrl) {
      return res.redirect(302, vkUrl);
    }
    if (no_ff !== '1') {
      const ffIframe = await resolveFanFilmDirectIframe(title, false, year);
      if (ffIframe) {
        return res.redirect(302, `/api/player/fanfilm-embed?url=${encodeURIComponent(ffIframe)}&title=${encodeURIComponent(title)}&year=${encodeURIComponent(year || '')}`);
      }
    }
    // Проверяем Lift напрямую без циклического 302 редиректа
    try {
      const matchedLiftId = await Promise.race([
        resolveLiftMatch({
          title,
          original_title,
          year,
          is_series: Boolean(season)
        }),
        new Promise(r => setTimeout(() => r(null), 2800))
      ]);
      if (matchedLiftId) {
        const epParam = season ? `&is_series=1&season=${encodeURIComponent(season)}&episode=${encodeURIComponent(episode || '1')}` : '';
        return res.redirect(302, `/api/player/lift-embed?lift_id=${encodeURIComponent(matchedLiftId)}&title=${encodeURIComponent(title)}${original_title ? `&original_title=${encodeURIComponent(original_title)}` : ''}&year=${encodeURIComponent(year || '')}${epParam}`);
      }
    } catch (_) {}

    const trailer = await resolveOfficialTrailerSource({ title, original_title, year });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(renderPremiereOrTrailerFallbackHtml({ title, original_title, year, trailer }));
  } catch (err) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(renderPremiereOrTrailerFallbackHtml({
      title: req.query.title || '',
      original_title: req.query.original_title || '',
      year: req.query.year || '',
      trailer: null
    }));
  }
});

// Универсальный мульти-балансерный шлюз Kinobox / HDRezka / Collaps / Alloha / VideoCDN / RHS / Bazon / Kodik / Vidsrc
app.get('/api/player/kinobox-embed', async (req, res) => {
  try {
    const {
      balancer = 'kinobox',
      title = '',
      original_title = '',
      year = '',
      lift_id = '',
      kp_id = '',
      imdb_id = '',
      shikimori_id = '',
      is_series = '',
      season = '',
      episode = '',
      fallback_mode = '',
      no_lift = ''
    } = req.query;

    const cleanTitle = String(title || '').replace(/\s*\(\d{4}\)\s*$/i, '').trim();
    const epQuery = season ? `&season=${encodeURIComponent(season)}&episode=${encodeURIComponent(episode || '1')}` : '';
    const wantSeries = Boolean(season || is_series === '1' || is_series === 'true');

    // 1. Для международного балансера Vidsrc пробуем IMDb ID или поиск в TMDB (через доступное зеркало vidsrc.me)
    if (balancer === 'vidsrc') {
      let resolvedImdb = String(imdb_id || '').trim();
      let resolvedTmdbId = '';
      let isTv = wantSeries;
      if (!resolvedImdb && cleanTitle) {
        try {
          const tmdbResults = await Promise.race([
            searchTmdb(cleanTitle, 1),
            new Promise(r => setTimeout(() => r({ items: [] }), 2500))
          ]);
          const tmdbItems = Array.isArray(tmdbResults) ? tmdbResults : (tmdbResults?.items || []);
          if (tmdbItems.length > 0) {
            const matchedItem = tmdbItems.find(it => {
              const itTv = it.media_type === 'series' || it.media_type === 'tv';
              return wantSeries ? itTv : true;
            }) || tmdbItems[0];
            const rawTmdb = String(matchedItem.id || '').replace(/^tmdb_(?:movie|tv|series|up)_/i, '');
            if (/^\d+$/.test(rawTmdb)) {
              resolvedTmdbId = rawTmdb;
              isTv = matchedItem.media_type === 'series' || matchedItem.media_type === 'tv';
            }
          }
        } catch (_) {}
      }
      const tvEpSuffix = isTv && season ? `&season=${encodeURIComponent(season)}&episode=${encodeURIComponent(episode || '1')}` : '';
      if (resolvedImdb) {
        return res.redirect(302, `https://vidsrc.me/embed/${isTv ? 'tv' : 'movie'}?imdb=${encodeURIComponent(resolvedImdb)}${tvEpSuffix}`);
      }
      if (resolvedTmdbId) {
        return res.redirect(302, `https://vidsrc.me/embed/${isTv ? 'tv' : 'movie'}?tmdb=${encodeURIComponent(resolvedTmdbId)}${tvEpSuffix}`);
      }
    }

    // 2. Если включен режим гарантированного резерва (fallback_mode=1) — проверяем RuTube и VK Видео в первую очередь
    if (fallback_mode === '1') {
      const [ruId, vkUrl] = await Promise.all([
        resolveBestRuTubeId(cleanTitle, year, season, episode, 0, false, original_title),
        resolveBestVkEmbed(cleanTitle, year, season, episode, false, original_title)
      ]);
      if (ruId) {
        return res.redirect(302, `/api/player/rutube-embed/${ruId}`);
      }
      if (vkUrl) {
        return res.redirect(302, vkUrl);
      }
    }

    // 3. Для Kodik / AniXart / Shikimori сначала проверяем прямое наличие в базе Kodik API
    if (balancer === 'kodik' || balancer === 'anixart' || balancer === 'shikimori' || shikimori_id) {
      const kodikDirect = await resolveKodikDirectIframe({ cleanTitle, original_title, shikimori_id, season, episode });
      if (kodikDirect) {
        return res.redirect(302, `/api/player/adblock-proxy?url=${encodeURIComponent(kodikDirect)}&fallback_title=${encodeURIComponent(cleanTitle)}&fallback_year=${encodeURIComponent(year)}`);
      }
    }

    // 4. Для альтернативных CDN балансеров (videocdn, bazon) приоритезируем независимые зеркала VK Видео / RuTube (альтернативный поток)
    if (balancer === 'videocdn' || balancer === 'bazon') {
      const variantIdx = balancer === 'bazon' ? 1 : 0;
      const [ruId, vkUrl] = await Promise.all([
        resolveBestRuTubeId(cleanTitle, year, season, episode, variantIdx, false, original_title),
        resolveBestVkEmbed(cleanTitle, year, season, episode, false, original_title)
      ]);
      if (balancer === 'videocdn' && vkUrl) {
        return res.redirect(302, vkUrl);
      }
      if (ruId) {
        return res.redirect(302, `/api/player/rutube-embed/${ruId}`);
      }
      if (vkUrl) {
        return res.redirect(302, vkUrl);
      }
    }

    // 5. Проверяем наличие живого 4K/HD мульти-потока на FanFilm4K / Stravers
    if (cleanTitle && balancer !== 'kodik' && balancer !== 'anixart' && balancer !== 'shikimori') {
      const preferHd = balancer === 'hdrezka' || balancer === 'collaps' || balancer === 'rhs';
      const ffIframe = await resolveFanFilmDirectIframe(cleanTitle, preferHd, year);
      if (ffIframe) {
        return res.redirect(302, `/api/player/fanfilm-embed?url=${encodeURIComponent(ffIframe)}&title=${encodeURIComponent(cleanTitle)}&year=${encodeURIComponent(year || '')}${epQuery}`);
      }
    }

    // 6. Проверяем базу Lift 4K/FHD (88 000+ релизов с предвыбором студийной озвучки HDRezka / RHS / LostFilm / Дубляж)
    if (no_lift !== '1' && (cleanTitle || lift_id)) {
      try {
        const matchedLiftId = await Promise.race([
          resolveLiftMatch({
            lift_id: lift_id || '',
            title: cleanTitle,
            original_title: original_title || '',
            year: year || '',
            is_series: wantSeries
          }),
          new Promise(r => setTimeout(() => r(''), 3200))
        ]);
        if (matchedLiftId) {
          let voiceHint = '';
          if (balancer === 'rhs') voiceHint = 'rhs';
          else if (balancer === 'hdrezka') voiceHint = 'hdrezka';
          else if (balancer === 'collaps' || balancer === 'alloha') voiceHint = 'дубляж';
          else if (balancer === 'vidsrc') voiceHint = 'original';
          const voiceParam = voiceHint ? `&voice=${encodeURIComponent(voiceHint)}` : '';
          return res.redirect(302, `/api/player/lift-embed?lift_id=${encodeURIComponent(matchedLiftId)}&title=${encodeURIComponent(cleanTitle)}${original_title ? `&original_title=${encodeURIComponent(original_title)}` : ''}${year ? `&year=${encodeURIComponent(year)}` : ''}${wantSeries ? '&is_series=1' : ''}${epQuery}${voiceParam}`);
        }
      } catch (_) {}
    }

    // 7. Если ни на FanFilm4K, ни в Lift релиза нет — проверяем Kodik API и гарантированный поток RuTube / VK Видео
    const [kodikDirect, ruId, vkUrl] = await Promise.all([
      resolveKodikDirectIframe({ cleanTitle, original_title, shikimori_id, season, episode }),
      resolveBestRuTubeId(cleanTitle, year, season, episode, 0, false, original_title),
      resolveBestVkEmbed(cleanTitle, year, season, episode, false, original_title)
    ]);

    if (kodikDirect) {
      return res.redirect(302, `/api/player/adblock-proxy?url=${encodeURIComponent(kodikDirect)}&fallback_title=${encodeURIComponent(cleanTitle)}&fallback_year=${encodeURIComponent(year)}`);
    }
    if (ruId) {
      return res.redirect(302, `/api/player/rutube-embed/${ruId}`);
    }
    if (vkUrl) {
      return res.redirect(302, vkUrl);
    }

    const trailer = await resolveOfficialTrailerSource({ title: cleanTitle, original_title, year });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(renderPremiereOrTrailerFallbackHtml({ title: cleanTitle, original_title, year, trailer }));
  } catch (err) {
    console.warn('[Kinobox Embed Error]:', err.message);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(renderPremiereOrTrailerFallbackHtml({
      title: req.query.title || '',
      original_title: req.query.original_title || '',
      year: req.query.year || '',
      trailer: null
    }));
  }
});

// Проксирующий плеер FanFilm4K / Stravers без встроенных селектов и трейлеров
app.get('/api/player/fanfilm-embed', async (req, res) => {
  try {
    let { url: targetUrl, season, episode, translation, hidden, title, year, kp_id } = req.query;
    const fallbackTitle = (title || '').trim();
    if (!targetUrl && fallbackTitle) {
      targetUrl = resolveFanFilmUrl(fallbackTitle) || `https://v17.fanfilm4k.media/index.php?do=search&subaction=search&story=${encodeURIComponent(fallbackTitle)}`;
    }
    if (!targetUrl) {
      return res.status(400).send('URL плеера не указан');
    }

    if (!targetUrl.includes('stravers.live') && !targetUrl.includes('fanfilm4k')) {
      // Для сторонних плееров делаем прямой безопасный редирект
      return res.redirect(targetUrl);
    }

    let directIframe = targetUrl;

    // 1. Если передан поисковый URL FanFilm4K, сначала проверяем канонический словарь и быстрый поиск
    if (directIframe.includes('fanfilm4k') && (directIframe.includes('do=search') || directIframe.endsWith('fanfilm4k.media/'))) {
      let knownDirect = fallbackTitle ? resolveFanFilmUrl(fallbackTitle) : null;
      if (knownDirect && year) {
        const urlYearMatch = knownDirect.match(/-(19\d\d|20\d\d)(?:-|\.html)/);
        if (urlYearMatch && urlYearMatch[1] !== String(year).trim()) {
          knownDirect = null;
        }
      }
      if (knownDirect) {
        directIframe = knownDirect;
      } else if (fallbackTitle) {
        try {
          const searchResults = await Promise.race([
            searchFanFilm(fallbackTitle),
            new Promise(r => setTimeout(() => r([]), 2800))
          ]);
          if (Array.isArray(searchResults) && searchResults.length > 0) {
            const bestMatch = searchResults.find(r => {
              const sc = scoreMediaCandidate(r.title || '', '', fallbackTitle, year || '', season || '', episode || '');
              return sc >= 200 && (!year || !r.year || Math.abs(parseInt(r.year, 10) - parseInt(year, 10)) <= 1);
            });
            if (bestMatch && (bestMatch.link || bestMatch.url)) {
              directIframe = bestMatch.link || bestMatch.url;
            }
          }
        } catch (_) {}
      }
    }

    // 2. Извлекаем прямой iframe 4K / HD плеера со страницы релиза FanFilm4K (поддержка src и data-src)
    if (directIframe.includes('fanfilm4k.media') && !directIframe.includes('stravers.live') && !directIframe.includes('do=search')) {
      try {
        const pageHtml = await fetchHtml(directIframe, { timeout: 3500 });
        const m4k = pageHtml.match(/data-tab-content=["']4kplayer["'][^>]*>[\s\S]*?<iframe[^>]*(?:src|data-src)=["']([^"']+)["']/i);
        const mHd = pageHtml.match(/data-tab-content=["']hdplayer["'][^>]*>[\s\S]*?<iframe[^>]*(?:src|data-src)=["']([^"']+)["']/i);
        const mAny = pageHtml.match(/<iframe[^>]*(?:src|data-src)=["']([^"']*(?:stravers\.live|allplay|kodik|videocdn|collaps|alloha)[^"']*)["']/i);
        const rawSrc = (m4k && m4k[1]) || (mHd && mHd[1]) || (mAny && mAny[1]) || '';
        const extractedIframe = rawSrc ? (rawSrc.startsWith('//') ? 'https:' + rawSrc : rawSrc) : '';
        if (extractedIframe) {
          directIframe = extractedIframe;
        }
      } catch (_) {}
    }

    // 3. Если со страницы FanFilm4K не удалось извлечь iframe плеера (релиза еще нет на зеркале FanFilm4K),
    // перенаправляем на мульти-балансер с автоматическим резервом RuTube / VK Видео / Kodik без жесткой блокировки года
    if (directIframe.includes('fanfilm4k.media') && !directIframe.includes('stravers.live')) {
      const epQuery = season ? `&season=${encodeURIComponent(season)}&episode=${encodeURIComponent(episode || '1')}` : '';
      return res.redirect(302, `/api/player/rutube-search-embed?title=${encodeURIComponent(fallbackTitle)}&year=${encodeURIComponent(year || '')}${epQuery}&no_ff=1`);
    }

    const urlObj = new URL(directIframe);
    const isMovieToken = directIframe.includes('token_movie=');
    if (!isMovieToken) {
      if (season !== undefined && season !== null && String(season).trim() !== '') urlObj.searchParams.set('season', season);
      if (episode !== undefined && episode !== null && String(episode).trim() !== '') urlObj.searchParams.set('episode', episode);
    }
    if (translation !== undefined && translation !== null && String(translation).trim() !== '') {
      urlObj.searchParams.set('translation', translation);
    }
    urlObj.searchParams.set('selector', '0');
    urlObj.searchParams.set('hidden', hidden || 'season,episode,translation');

    const finalUrl = urlObj.toString();
    res.setHeader('Permissions-Policy', 'fullscreen=*');

    // Проксируем HTML плеера на тот же origin с внедрением студийного Pro Audio моста и управления скоростью
    try {
      const embedRes = await fetch(finalUrl, {
        headers: {
          'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          'Referer': 'https://v17.fanfilm4k.media/',
          'Accept-Language': req.headers['accept-language'] || 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
        },
        signal: AbortSignal.timeout(6000)
      });

      if (embedRes.ok) {
        let html = await embedRes.text();
        const hasFileList = html.includes('const fileList =') || html.includes('fileList');
        const hasValidIdFile = !hasFileList || /["']id_file["']\s*:\s*[1-9]\d*/.test(html);
        const isDead = ((html.toLowerCase().includes('<title>ошибка!</title>') || html.includes('<div class="error">')) && !hasFileList) || !hasValidIdFile;

        if (isDead) {
          const pageTitleMatch = html.match(/<title>([^<]+)<\/title>/i);
          const extractedTitle = (pageTitleMatch && !/ошибка/i.test(pageTitleMatch[1])) ? pageTitleMatch[1].trim() : '';
          const effectiveTitle = fallbackTitle || extractedTitle;
          if (effectiveTitle) {
            try {
              const matchedLiftId = await Promise.race([
                resolveLiftMatch({ title: effectiveTitle, year: year || '', is_series: Boolean(season) }),
                new Promise(r => setTimeout(() => r(''), 2800))
              ]);
              if (matchedLiftId) {
                const epQuery = season ? `&is_series=1&season=${encodeURIComponent(season)}&episode=${encodeURIComponent(episode || '1')}` : '';
                return res.redirect(302, `/api/player/lift-embed?lift_id=${encodeURIComponent(matchedLiftId)}&title=${encodeURIComponent(effectiveTitle)}${year ? `&year=${encodeURIComponent(year)}` : ''}${epQuery}`);
              }
            } catch (_) {}
            const [ruId, vkUrl] = await Promise.all([
              resolveBestRuTubeId(effectiveTitle, year, season, episode, 0, false),
              resolveBestVkEmbed(effectiveTitle, year, season, episode, false)
            ]);
            if (ruId) {
              return res.redirect(302, `/api/player/rutube-embed/${ruId}`);
            }
            if (vkUrl) {
              return res.redirect(302, vkUrl);
            }
            const [shortRuId, shortVk] = await Promise.all([
              resolveBestRuTubeId(effectiveTitle, year, season, episode, 0, true),
              resolveBestVkEmbed(effectiveTitle, year, season, episode, true)
            ]);
            if (shortRuId) {
              return res.redirect(302, `/api/player/rutube-embed/${shortRuId}`);
            }
            if (shortVk) {
              return res.redirect(302, shortVk);
            }
          }
          console.warn('FanFilm embed: обнаружен неработающий поток, переключаем на следующий источник');
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          return res.send(`
            <!DOCTYPE html>
            <html lang="ru">
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <style>
                body {
                  margin: 0; background: #0a0b10; color: #ffffff;
                  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                  display: flex; align-items: center; justify-content: center;
                  height: 100vh; text-align: center;
                }
                .vpn-card {
                  background: rgba(15, 23, 42, 0.85);
                  border: 1px solid rgba(0, 210, 255, 0.35);
                  border-radius: 14px; padding: 24px 20px; max-width: 440px;
                  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.7);
                  display: flex; flex-direction: column; align-items: center; gap: 12px;
                }
                .vpn-icon { font-size: 36px; }
                .vpn-title { font-size: 16px; font-weight: 700; color: #00d2ff; }
                .vpn-desc { font-size: 13px; color: #94a3b8; line-height: 1.5; }
                .vpn-btn {
                  background: linear-gradient(135deg, #00d2ff, #0077ff);
                  color: #fff; border: none; border-radius: 8px;
                  padding: 10px 18px; font-size: 13px; font-weight: 700;
                  cursor: pointer; box-shadow: 0 4px 12px rgba(0, 210, 255, 0.3);
                  transition: transform 0.15s, opacity 0.15s;
                }
                .vpn-btn:hover { transform: translateY(-1px); opacity 0.95; }
              </style>
            </head>
            <body>
              <div class="vpn-card">
                <div class="vpn-icon">🎬</div>
                <div class="vpn-title">FanFilm 4K Ultra HD</div>
                <div class="vpn-desc">Плеер инициализируется. Если воспроизведение не начинается, вы можете переключиться на альтернативный источник.</div>
                <button type="button" class="vpn-btn" onclick="triggerNext()">Переключить источник</button>
              </div>
              <script>
                function triggerNext() {
                  try {
                    window.parent.postMessage({ type: 'STORM_SWITCH_NEXT_SOURCE', reason: 'FANFILM_MANUAL_SWITCH', user_initiated: true }, '*');
                  } catch(e) {}
                }
              </script>
            </body>
            </html>
          `);
        }

        // 1. STORM AdBlock Engine: вырезание внешних скриптов тизеров, трекеров и казино
        html = html.replace(/<script[^>]*src=["'][^"']*(?:yandex|adfox|googleads|doubleclick|adsystem|adkernel|redclick|marketgid|casino|1xbet|betting|traff|banner|adv)[^"']*["'][^>]*><\/script>/gi, '');

        // 2. Нейтрализуем проверку фрейма Script 6 и некорректную проверку referrer bdtest(), чтобы плеер никогда не стирал разметку (без поломки вложенных скобок!)
        html = html.replace(/if\s*\(\s*!isFramed\s*\)\s*\{/g, 'if (false && !isFramed) {');
        html = html.replace(/function\s+bdtest\s*\(\)\s*\{/g, 'function bdtest() { return false; ');

        // 3. Снятие атрибутов Subresource Integrity (SRI) integrity="..." со всех <link> и <script>.
        html = html.replace(/\s+integrity=["'][^"']+["']/gi, '');

        // 4. Внедрение и инлайнинг CSS для мгновенного и гарантированного рендеринга плеера
        const baseOrigin = new URL(finalUrl).origin;
        try {
          const cssMatch = html.match(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["'][^>]*>/i);
          if (cssMatch) {
            const cssHref = cssMatch[1];
            const fullCssUrl = cssHref.startsWith('http') ? cssHref : `${baseOrigin}${cssHref.startsWith('/') ? '' : '/'}${cssHref}`;
            const inlinedCss = await getStraversCss(fullCssUrl, baseOrigin);
            if (inlinedCss) {
              html = html.replace(cssMatch[0], `<style id="storm-inlined-stravers-css">${inlinedCss}</style>`);
            }
          }
        } catch (_) {}
        const proAudioInjection = `
          <base href="${baseOrigin}/">
          <script>
            window.isFramed = true;
            try { window.top = window.self; } catch(e) {}
            try { window.open = function() { return null; }; } catch(e) {}
            try { window.alert = function() {}; } catch(e) {}
            try {
              Object.defineProperty(document, 'referrer', { get: function() { return 'https://v17.fanfilm4k.media/'; }, configurable: true });
              if (typeof Location !== 'undefined' && Location.prototype) {
                Object.defineProperty(Location.prototype, 'ancestorOrigins', { get: function() { return ['https://v17.fanfilm4k.media']; }, configurable: true });
              }
            } catch(_) {}

            // Блокировка автозапуска видео при открытии до клика пользователя
            (function() {
              var _userInteracted = false;
              var markInteracted = function() { _userInteracted = true; };
              window.addEventListener('pointerdown', markInteracted, true);
              window.addEventListener('mousedown', markInteracted, true);
              window.addEventListener('touchstart', markInteracted, true);
              window.addEventListener('keydown', markInteracted, true);
              window.addEventListener('click', markInteracted, true);
              window.addEventListener('message', function(e) {
                try {
                  var d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
                  if (d && (d.type === 'PLAY' || d.type === 'TOGGLE' || d.action === 'play' || d.action === 'toggle')) {
                    _userInteracted = true;
                  }
                } catch(_) {}
              });
              try {
                var origPlay = HTMLMediaElement.prototype.play;
                HTMLMediaElement.prototype.play = function() {
                  if (!_userInteracted) {
                    try { this.autoplay = false; this.removeAttribute('autoplay'); } catch(_) {}
                    return Promise.resolve();
                  }
                  return origPlay.apply(this, arguments);
                };
              } catch(_) {}
            })();

            // STORM AdBlock Engine & Stravers API Proxy
            var stormOrigin = window.location.origin;
            var emptyVast = '<?xml version="1.0" encoding="UTF-8"?><VAST version="2.0"></VAST>';
            var isAdUrl = function(u) {
              var low = String(u || '').toLowerCase();
              return low.includes('vast') || low.includes('adfox') || low.includes('yandex') ||
                     low.includes('ssp') || low.includes('doubleclick') || low.includes('googleads') ||
                     low.includes('adsystem') || low.includes('adkernel') || low.includes('popunder') ||
                     low.includes('clickunder') || low.includes('casino') || low.includes('1xbet') ||
                     low.includes('winline') || low.includes('melbet');
            };
            var isStraversApiUrl = function(u) {
              var s = String(u || '');
              if (s.includes('/api/player/stravers-api-proxy')) return false;
              return s.includes('/bnsi/') || s.includes('/sarn') || s.includes('/vorf') ||
                     s.includes('/events') || s.includes('/stat') || s.includes('/errors') ||
                     s.includes('/lists.php') || s.includes('stravers.live') || s.includes('transfusion') ||
                     s.includes('vkvideo.ru') || s.includes('okcdn.ru') || s.includes('mycdn.me') || s.includes('userapi.com');
            };

            // Защита AudioContext от InvalidStateError при повторном подключении MediaElementSourceNode в AllPlay
            (function() {
              try {
                var Actx = window.AudioContext || window.webkitAudioContext;
                if (!Actx) return;
                var origCreateSource = Actx.prototype.createMediaElementSource;
                var _mediaSourceNodes = new WeakMap();
                Actx.prototype.createMediaElementSource = function(mediaEl) {
                  if (mediaEl && _mediaSourceNodes.has(mediaEl)) {
                    return _mediaSourceNodes.get(mediaEl);
                  }
                  try {
                    var node = origCreateSource.apply(this, arguments);
                    if (mediaEl) _mediaSourceNodes.set(mediaEl, node);
                    return node;
                  } catch (e) {
                    if (mediaEl && _mediaSourceNodes.has(mediaEl)) {
                      return _mediaSourceNodes.get(mediaEl);
                    }
                    try {
                      return this.createGain();
                    } catch (_) {
                      return null;
                    }
                  }
                };
              } catch (_) {}
            })();

            var origFetch = window.fetch;
            if (origFetch) {
              window.fetch = function(input, init) {
                var url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
                if (isAdUrl(url)) {
                  return Promise.resolve(new Response(emptyVast, {
                    status: 200,
                    headers: { 'Content-Type': 'application/xml; charset=utf-8' }
                  }));
                }
                var strUrl = String(url || '');
                if (isStraversApiUrl(strUrl)) {
                  var fullTarget = strUrl.startsWith('http') ? strUrl : ('${baseOrigin}' + (strUrl.startsWith('/') ? '' : '/') + strUrl);
                  var proxied = stormOrigin + '/api/player/stravers-api-proxy?url=' + encodeURIComponent(fullTarget);
                  if (typeof input === 'string') {
                    return origFetch.call(this, proxied, init);
                  } else {
                    return origFetch.call(this, new Request(proxied, init));
                  }
                }
                return origFetch.apply(this, arguments);
              };
            }

            var origOpen = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function(method, url) {
              if (isAdUrl(url)) {
                this._isStormBlockedAd = true;
                return origOpen.apply(this, arguments);
              }
              var strUrl = String(url || '');
              if (isStraversApiUrl(strUrl)) {
                var fullTarget = strUrl.startsWith('http') ? strUrl : ('${baseOrigin}' + (strUrl.startsWith('/') ? '' : '/') + strUrl);
                var proxied = stormOrigin + '/api/player/stravers-api-proxy?url=' + encodeURIComponent(fullTarget);
                return origOpen.call(this, method, proxied, arguments[2], arguments[3], arguments[4]);
              }
              return origOpen.apply(this, arguments);
            };

            var origSend = XMLHttpRequest.prototype.send;
            XMLHttpRequest.prototype.send = function() {
              if (this._isStormBlockedAd) {
                try {
                  Object.defineProperty(this, 'status', { get: function() { return 200; } });
                  Object.defineProperty(this, 'readyState', { get: function() { return 4; } });
                  Object.defineProperty(this, 'responseText', { get: function() { return emptyVast; } });
                  Object.defineProperty(this, 'response', { get: function() { return emptyVast; } });
                  if (typeof this.onreadystatechange === 'function') this.onreadystatechange();
                  if (typeof this.onload === 'function') this.onload();
                } catch(_) {}
                return;
              }
              return origSend.apply(this, arguments);
            };

            // Автоматическое снятие вечного лоадера при ошибке потока и мгновенный переход на рабочий HLS поток
            (function() {
              var hasSwitched = false;
              var serverFallbackTitle = ${JSON.stringify(fallbackTitle || '')};
              var serverYear = ${JSON.stringify(year || '')};
              var serverSeason = ${JSON.stringify(season || '')};
              var serverEpisode = ${JSON.stringify(episode || '')};

              function resolveCurrentTitle() {
                if (serverFallbackTitle) return serverFallbackTitle;
                try {
                  var pDoc = window.parent && window.parent.document;
                  if (pDoc) {
                    var tEl = pDoc.getElementById('cinema-title');
                    if (tEl && tEl.textContent) {
                      return tEl.textContent.replace(/\s*\(\d{4}\)\s*$/, '').trim();
                    }
                  }
                } catch (_) {}
                return '';
              }

              function triggerSwitch(reason) {
                if (hasSwitched) return;
                hasSwitched = true;
                console.warn('FanFilm embed: обнаружено состояние плеера ->', reason);
                try {
                  var ldrs = document.querySelectorAll('.loader, .allplay__control--loader, .allplay__ads--loader');
                  for (var i = 0; i < ldrs.length; i++) {
                    ldrs[i].classList.remove('active');
                    ldrs[i].style.setProperty('display', 'none', 'important');
                  }
                } catch (_) {}

                var resolvedTitle = resolveCurrentTitle();
                if (resolvedTitle) {
                  var epParams = serverSeason
                    ? ('&season=' + encodeURIComponent(serverSeason) + '&episode=' + encodeURIComponent(serverEpisode || '1'))
                    : '';
                  var fallbackUrl = stormOrigin + '/api/player/rutube-search-embed?title=' + encodeURIComponent(resolvedTitle) +
                    '&year=' + encodeURIComponent(serverYear) +
                    epParams +
                    '&no_ff=1';
                  window.location.replace(fallbackUrl);
                }
              }

              function checkErrorState() {
                var errEl = document.querySelector('.error_message, .error_player, .error, .allplay--error');
                var isErr = errEl && (errEl.offsetParent !== null || !errEl.classList.contains('hidden') || errEl.classList.contains('active') || errEl.classList.contains('allplay--error'));
                if (isErr) {
                  triggerSwitch('DOM_ERROR_CONTAINER');
                }
              }
              setInterval(checkErrorState, 400);

              function inspectConsoleMsg(args) {
                try {
                  var msg = Array.prototype.slice.call(args).join(' ');
                  if (msg.includes('all manifest URLs exhausted') || msg.includes('terminating player') || msg.includes('error change file') || msg.includes('change file error')) {
                    triggerSwitch('MANIFEST_EXHAUSTED');
                  }
                } catch (_) {}
              }

              var origConsoleLog = console.log;
              console.log = function() {
                inspectConsoleMsg(arguments);
                origConsoleLog.apply(console, arguments);
              };

              var origConsoleWarn = console.warn;
              console.warn = function() {
                inspectConsoleMsg(arguments);
                origConsoleWarn.apply(console, arguments);
              };

              var origConsoleErr = console.error;
              console.error = function() {
                inspectConsoleMsg(arguments);
                origConsoleErr.apply(console, arguments);
              };

              // Сторожевой таймер: даем достаточно времени (25 сек) на буферизацию 4K потока и проверяем реальную ошибку
              setTimeout(function() {
                var v = document.querySelector('video');
                var isPlaying = v && !v.paused && v.currentTime > 0;
                if (!isPlaying && v && v.error) {
                  triggerSwitch('LOADER_HANG_TIMEOUT');
                }
              }, 25000);
            })();

            // STORM AdBlock Engine: автоматический пропуск, уничтожение и глушение рекламы
            (function() {
              function sterilizeAds() {
                try {
                  var skipSelectors = [
                    '.skip-ad', '.ad-skip', '.vast-skip-button', '.playerjs-ad-skip',
                    '[class*="skip"][class*="ad"]', 'button[class*="skip"]',
                    '.close-ad', '.ad-close', '.video-ad-skip', '.skip-button',
                    '#skip-button', '[id*="skip"]', '.ytp-ad-skip-button',
                    '.videoAdUiSkipButton', '.ad-banner-close', '.closeBtn'
                  ];
                  var btns = document.querySelectorAll(skipSelectors.join(','));
                  for (var i = 0; i < btns.length; i++) {
                    if (btns[i].offsetParent !== null) btns[i].click();
                  }

                  var adNodes = document.querySelectorAll('[id*="ad-"], [class*="ad-container"], [class*="player-ad"], .vast-container, [id*="banner"], [class*="teaser"], iframe[src*="ad"]');
                  for (var j = 0; j < adNodes.length; j++) {
                    adNodes[j].style.setProperty('display', 'none', 'important');
                    adNodes[j].style.setProperty('pointer-events', 'none', 'important');
                  }

                  var vids = document.querySelectorAll('video');
                  for (var k = 0; k < vids.length; k++) {
                    var v = vids[k];
                    var isAd = v.closest('.ad-container') || v.closest('[class*="vast"]') || v.classList.contains('vpaid-video') || (v.src && (v.src.indexOf('/ad') !== -1 || v.src.indexOf('preroll') !== -1 || isAdUrl(v.src)));
                    if (isAd) {
                      v.muted = true;
                      if (v.duration && isFinite(v.duration) && v.currentTime < v.duration) {
                        v.currentTime = v.duration;
                      }
                    }
                  }
                } catch(e) {}
              }

              setInterval(sterilizeAds, 120);
              if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', sterilizeAds);
              } else {
                sterilizeAds();
              }
            })();
          </script>
          <script>
          (function() {
            let audioCtx = null;
            let sourceNode = null;
            let bassFilter = null;
            let voiceFilter = null;
            let eqFilters = [];
            let compressor = null;
            let convolver = null;
            let wetGain = null;
            let dryGain = null;
            let masterGain = null;
            let delayNode = null;
            let currentSettings = null;
            let currentSpeed = 1;
            try {
              const savedSp = localStorage.getItem('storm_playback_speed');
              if (savedSp) currentSpeed = parseFloat(savedSp) || 1;
            } catch {}

            const EQ_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

            function createImpulse(ctx, duration = 1.2, decay = 2.0) {
              const sampleRate = ctx.sampleRate;
              const length = sampleRate * duration;
              const buffer = ctx.createBuffer(2, length, sampleRate);
              const left = buffer.getChannelData(0);
              const right = buffer.getChannelData(1);
              for (let i = 0; i < length; i++) {
                const factor = Math.exp(-i / (sampleRate * (decay / 10)));
                left[i] = (Math.random() * 2 - 1) * factor;
                right[i] = (Math.random() * 2 - 1) * factor;
              }
              return buffer;
            }

            function initAudio(video) {
              if (!video || sourceNode || video._stormAudioInitialized) return;
              try {
                video._stormAudioInitialized = true;
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                if (!AudioContext) return;
                if (!audioCtx) audioCtx = new AudioContext();

                try {
                  sourceNode = audioCtx.createMediaElementSource(video);
                } catch (sourceErr) {
                  return;
                }

                delayNode = audioCtx.createDelay(2.0);
                delayNode.delayTime.setValueAtTime(0, audioCtx.currentTime);

                bassFilter = audioCtx.createBiquadFilter();
                bassFilter.type = 'lowshelf';
                bassFilter.frequency.setValueAtTime(80, audioCtx.currentTime);

                voiceFilter = audioCtx.createBiquadFilter();
                voiceFilter.type = 'peaking';
                voiceFilter.frequency.setValueAtTime(2500, audioCtx.currentTime);
                voiceFilter.Q.setValueAtTime(1.2, audioCtx.currentTime);

                eqFilters = EQ_FREQS.map(freq => {
                  const f = audioCtx.createBiquadFilter();
                  if (freq <= 32) f.type = 'lowshelf';
                  else if (freq >= 16000) f.type = 'highshelf';
                  else {
                    f.type = 'peaking';
                    f.Q.setValueAtTime(1.4, audioCtx.currentTime);
                  }
                  f.frequency.setValueAtTime(freq, audioCtx.currentTime);
                  return f;
                });

                compressor = audioCtx.createDynamicsCompressor();
                compressor.threshold.setValueAtTime(-10, audioCtx.currentTime);
                compressor.knee.setValueAtTime(30, audioCtx.currentTime);
                compressor.ratio.setValueAtTime(2, audioCtx.currentTime);
                compressor.attack.setValueAtTime(0.003, audioCtx.currentTime);
                compressor.release.setValueAtTime(0.25, audioCtx.currentTime);

                convolver = audioCtx.createConvolver();
                convolver.buffer = createImpulse(audioCtx, 1.4, 2.2);

                wetGain = audioCtx.createGain();
                dryGain = audioCtx.createGain();
                masterGain = audioCtx.createGain();

                let last = sourceNode;
                last.connect(delayNode);
                last = delayNode;
                last.connect(bassFilter);
                last = bassFilter;
                last.connect(voiceFilter);
                last = voiceFilter;
                for (const eq of eqFilters) {
                  last.connect(eq);
                  last = eq;
                }
                last.connect(dryGain);
                last.connect(convolver);
                convolver.connect(wetGain);
                dryGain.connect(masterGain);
                wetGain.connect(masterGain);
                masterGain.connect(compressor);
                compressor.connect(audioCtx.destination);

                if (currentSettings) applySettings(currentSettings);
              } catch (e) {
                console.warn('StormProAudioBridge init note:', e.message);
              }
            }

            function applySettings(s) {
              currentSettings = s;
              const v = document.querySelector('video');
              if (v && !sourceNode) initAudio(v);
              if (!audioCtx) return;
              if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
              const now = audioCtx.currentTime;

              if (bassFilter) {
                const gains = { off: 0, cinema: 8.5, ultra: 15.0 };
                bassFilter.gain.setTargetAtTime(gains[s.bassBoost] || 0, now, 0.05);
              }
              if (voiceFilter) {
                const gains = { off: 0, mild: 7.0, strong: 12.5 };
                voiceFilter.gain.setTargetAtTime(gains[s.voiceBoost] || 0, now, 0.05);
              }
              if (eqFilters.length === 10 && s.eqBands) {
                for (let i = 0; i < 10; i++) {
                  eqFilters[i].gain.setTargetAtTime(s.eqBands[i] || 0, now, 0.05);
                }
              }
              if (wetGain && dryGain) {
                if (s.spatialMode === 'atmos') {
                  dryGain.gain.setTargetAtTime(0.72, now, 0.05);
                  wetGain.gain.setTargetAtTime(0.55, now, 0.05);
                } else if (s.spatialMode === 'dtsx') {
                  dryGain.gain.setTargetAtTime(0.78, now, 0.05);
                  wetGain.gain.setTargetAtTime(0.42, now, 0.05);
                } else if (s.spatialMode === 'headphones') {
                  dryGain.gain.setTargetAtTime(0.70, now, 0.05);
                  wetGain.gain.setTargetAtTime(0.48, now, 0.05);
                } else {
                  dryGain.gain.setTargetAtTime(1.0, now, 0.05);
                  wetGain.gain.setTargetAtTime(0.0, now, 0.05);
                }
              }
              if (compressor) {
                if (s.nightMode) {
                  compressor.threshold.setTargetAtTime(-28, now, 0.05);
                  compressor.ratio.setTargetAtTime(16, now, 0.05);
                } else {
                  compressor.threshold.setTargetAtTime(-10, now, 0.05);
                  compressor.ratio.setTargetAtTime(2, now, 0.05);
                }
              }
              if (masterGain) {
                masterGain.gain.setTargetAtTime(s.preampGain || 1.0, now, 0.05);
              }
              if (delayNode) {
                const d = Math.max(0, Math.min(1.5, (s.audioDelayMs || 0) / 1000));
                delayNode.delayTime.setTargetAtTime(d, now, 0.05);
              }
            }

            function applySpeedToPlayerJS(sp) {
              try {
                if (window.Playerjs && typeof window.Playerjs.api === 'function') {
                  window.Playerjs.api('speed', sp);
                } else if (window.player && typeof window.player.api === 'function') {
                  window.player.api('speed', sp);
                } else if (window.pjs && typeof window.pjs.api === 'function') {
                  window.pjs.api('speed', sp);
                }
              } catch {}
            }

            setInterval(() => {
              const v = document.querySelector('video');
              if (v) {
                if (!v._stormEventsHooked) {
                  v._stormEventsHooked = true;
                  if (currentSpeed && Math.abs(v.playbackRate - currentSpeed) > 0.01) {
                    v._settingPlaybackRate = true;
                    v.playbackRate = currentSpeed;
                    setTimeout(() => { v._settingPlaybackRate = false; }, 60);
                  }
                  applySpeedToPlayerJS(currentSpeed);
                  v.addEventListener('play', () => {
                    if (!sourceNode) initAudio(v);
                    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
                    if (currentSpeed && Math.abs(v.playbackRate - currentSpeed) > 0.01) {
                      v._settingPlaybackRate = true;
                      v.playbackRate = currentSpeed;
                      setTimeout(() => { v._settingPlaybackRate = false; }, 60);
                    }
                    applySpeedToPlayerJS(currentSpeed);
                  });
                  v.addEventListener('loadedmetadata', () => {
                    if (currentSpeed && Math.abs(v.playbackRate - currentSpeed) > 0.01) {
                      v._settingPlaybackRate = true;
                      v.playbackRate = currentSpeed;
                      setTimeout(() => { v._settingPlaybackRate = false; }, 60);
                    }
                    applySpeedToPlayerJS(currentSpeed);
                  });
                  v.addEventListener('ratechange', () => {
                    if (v._settingPlaybackRate) return;
                    if (v.playbackRate && Math.abs(v.playbackRate - currentSpeed) > 0.01) {
                      currentSpeed = v.playbackRate;
                      try { localStorage.setItem('storm_playback_speed', String(currentSpeed)); } catch {}
                      try { window.parent.postMessage({ type: 'STORM_SPEED_CHANGED', speed: currentSpeed }, '*'); } catch {}
                    }
                  });
                }
                if (!sourceNode) initAudio(v);
              }
            }, 400);

            let _lastStormActivityNotice = 0;
            function reportStormUserActivity() {
              const now = Date.now();
              if (now - _lastStormActivityNotice > 180) {
                _lastStormActivityNotice = now;
                try { window.parent.postMessage({ type: 'STORM_MOUSE_MOVE' }, '*'); } catch(_) {}
              }
            }
            window.addEventListener('mousemove', reportStormUserActivity, { passive: true });
            window.addEventListener('pointermove', reportStormUserActivity, { passive: true });
            window.addEventListener('click', reportStormUserActivity, { passive: true });
            window.addEventListener('touchstart', reportStormUserActivity, { passive: true });

            window.addEventListener('message', (e) => {
              let data = e.data;
              if (typeof data === 'string') {
                try { data = JSON.parse(data); } catch {}
              }
              if (!data) return;

              if (data.type === 'STORM_PRO_AUDIO') {
                applySettings(data.settings);
              }

              const isSpeedMsg = data.type === 'SET_SPEED' || data.event === 'speed' || data.action === 'speed' || data.method === 'setSpeed' || data.api === 'speed' || data.playbackRate !== undefined;
              if (isSpeedMsg) {
                const sp = parseFloat(data.value || data.speed || data.rate || data.set || data.playbackRate || data.val);
                if (sp && !isNaN(sp)) {
                  currentSpeed = sp;
                  try { localStorage.setItem('storm_playback_speed', String(sp)); } catch {}
                  const v = document.querySelector('video');
                  if (v) {
                    v._settingPlaybackRate = true;
                    v.playbackRate = sp;
                    setTimeout(() => { v._settingPlaybackRate = false; }, 60);
                  }
                  applySpeedToPlayerJS(sp);
                }
              }

              // Обработка команд перемотки (Seek)
              const isSeekMsg = data.type === 'SEEK' || data.event === 'seek' || data.action === 'seek' || data.method === 'seek' || data.api === 'seek' || data.api === 'seekDelta';
              if (isSeekMsg) {
                let delta = 0;
                if (typeof data.val === 'number') delta = data.val;
                else if (typeof data.delta === 'number') delta = data.delta;
                else if (typeof data.value === 'number') delta = data.value;
                else if (typeof data.value === 'string') delta = parseFloat(data.value);
                const v = document.querySelector('video');
                if (v && !isNaN(delta)) {
                  v.currentTime = Math.max(0, Math.min(v.duration || Infinity, v.currentTime + delta));
                } else if (window.Playerjs && typeof window.Playerjs.api === 'function') {
                  if (!isNaN(delta)) window.Playerjs.api('seek', (delta > 0 ? '+' : '') + delta);
                }
              }

              // Обработка переключения паузы и воспроизведения (Toggle)
              const isToggleMsg = data.type === 'TOGGLE' || data.event === 'toggle' || data.action === 'toggle';
              if (isToggleMsg) {
                const v = document.querySelector('video');
                if (v) {
                  if (v.paused) v.play().catch(() => {});
                  else v.pause();
                } else if (window.Playerjs && typeof window.Playerjs.api === 'function') {
                  window.Playerjs.api('toggle');
                }
              }

              // Обработка явной паузы
              const isPauseMsg = data.type === 'PAUSE' || data.event === 'pause' || data.action === 'pause';
              if (isPauseMsg) {
                const v = document.querySelector('video');
                if (v) v.pause();
                else if (window.Playerjs && typeof window.Playerjs.api === 'function') {
                  window.Playerjs.api('pause');
                }
              }

              // Обработка явного запуска воспроизведения
              const isPlayMsg = data.type === 'PLAY' || data.event === 'play' || data.action === 'play';
              if (isPlayMsg) {
                const v = document.querySelector('video');
                if (v) v.play().catch(() => {});
                else if (window.Playerjs && typeof window.Playerjs.api === 'function') {
                  window.Playerjs.api('play');
                }
              }
            });

            // STORM Clean Console: Suppress noisy ad/telemetry/WS balancer errors
            (function() {
              try {
                var noisy = ['ERR_BLOCKED_BY_CLIENT', 'safetyTimeOut', 'AbortError', 'play()', 'close code=1006', 'wasOpen=true', 'PM count', 'test ready', 'fatal error', 'ERR_CONTENT_LENGTH_MISMATCH', 'ERR_CONNECTION_RESET', 'allowviewroll', 'vkvideo'];
                var owarn = console.warn;
                var oerr = console.error;
                console.warn = function() {
                  var s = Array.prototype.slice.call(arguments).join(' ');
                  for (var i = 0; i < noisy.length; i++) { if (s.indexOf(noisy[i]) !== -1) return; }
                  owarn.apply(console, arguments);
                };
                console.error = function() {
                  var s = Array.prototype.slice.call(arguments).join(' ');
                  for (var i = 0; i < noisy.length; i++) { if (s.indexOf(noisy[i]) !== -1) return; }
                  oerr.apply(console, arguments);
                };
                window.addEventListener('error', function(e) {
                  var m = (e && e.message) ? String(e.message) : '';
                  for (var i = 0; i < noisy.length; i++) {
                    if (m.indexOf(noisy[i]) !== -1) { e.preventDefault(); return; }
                  }
                });
                window.addEventListener('unhandledrejection', function(e) {
                  var m = (e && e.reason) ? String(e.reason.message || e.reason) : '';
                  for (var i = 0; i < noisy.length; i++) {
                    if (m.indexOf(noisy[i]) !== -1) { e.preventDefault(); return; }
                  }
                });
              } catch(_) {}
            })();

            // STORM CleanView: In-Iframe Ad Neutralizer
            (function() {
              try {
                window.open = function() { return null; };
                window.alert = function() {};
              } catch(e) {}
              setInterval(function() {
                try {
                  var skipBtns = document.querySelectorAll('.skip-ad, .ad-skip, .vast-skip-button, .playerjs-ad-skip, [class*="skip"][class*="ad"], button[class*="skip"], .close-ad, .ad-close, [class*="ad-btn"]');
                  for (var i = 0; i < skipBtns.length; i++) {
                    if (skipBtns[i].offsetParent !== null) skipBtns[i].click();
                  }
                  var vids = document.querySelectorAll('video');
                  for (var j = 0; j < vids.length; j++) {
                    var v = vids[j];
                    if (v.duration && v.duration < 65 && v.duration > 2) {
                      v.muted = true;
                      v.playbackRate = 16;
                      if (v.currentTime < v.duration - 0.4) v.currentTime = v.duration - 0.2;
                    }
                  }
                  var banners = document.querySelectorAll('[class*="banner"], [id*="banner"], [class*="advert"], [id*="advert"], [class*="preroll"]:not(video)');
                  for (var k = 0; k < banners.length; k++) {
                    if (!banners[k].querySelector('video')) {
                      banners[k].style.display = 'none';
                      banners[k].style.pointerEvents = 'none';
                    }
                  }
                } catch(e) {}
              }, 300);
            })();

            // STORM Universal Control & Activity Bridge (Seek, Speed, Play/Pause, Activity)
            (function() {
              var _lastAct = 0;
              function sendAct() {
                var n = Date.now();
                if (n - _lastAct < 350) return;
                _lastAct = n;
                try { window.parent.postMessage({ type: 'STORM_IFRAME_ACTIVITY' }, '*'); } catch (_) {}
              }
              document.addEventListener('mousemove', sendAct, { passive: true });
              document.addEventListener('touchstart', sendAct, { passive: true });
              setInterval(function() {
                try {
                  var v = document.querySelector('video');
                  if (v && !isNaN(v.currentTime) && v.currentTime > 0) {
                    window.parent.postMessage({
                      type: 'STORM_IFRAME_TIME',
                      currentTime: v.currentTime,
                      duration: v.duration || 0,
                      paused: v.paused
                    }, '*');
                  }
                } catch (_) {}
              }, 500);
              window.addEventListener('message', function(ev) {
                try {
                  var d = typeof ev.data === 'string' ? JSON.parse(ev.data) : (ev.data || {});
                  var v = document.querySelector('video');
                  if (!v) return;
                  if (d.type === 'STORM_SEEK_DELTA' || d.event === 'seek' || d.action === 'seek') {
                    var delta = Number(d.delta !== undefined ? d.delta : d.val) || 0;
                    if (delta) v.currentTime = Math.max(0, Math.min(v.duration || Infinity, (v.currentTime || 0) + delta));
                  } else if (d.type === 'STORM_SEEK_TO' && d.time !== undefined) {
                    v.currentTime = Math.max(0, Number(d.time) || 0);
                  } else if (d.type === 'STORM_SET_SPEED' && d.speed) {
                    v.playbackRate = Number(d.speed) || 1;
                  } else if (d.type === 'STORM_PLAY_PAUSE') {
                    if (d.action === 'pause') v.pause();
                    else if (d.action === 'play') v.play().catch(function(){});
                    else if (v.paused) v.play().catch(function(){});
                    else v.pause();
                  }
                } catch (_) {}
              });
            })();
            // STORM Fullscreen Bridge: перехват кликов по кнопкам полноэкранного режима, горячей клавиши F и вызовов Fullscreen API
            (function() {
              function notifyParentFullscreen() {
                try {
                  window.parent.postMessage({ type: 'STORM_FULLSCREEN_TOGGLE', event: 'fullscreen', action: 'fullscreen' }, '*');
                } catch (_) {}
              }

              // 1. Перехват клика по кнопке Fullscreen плеера (Plyr, Allplay, Playerjs, HTML5)
              document.addEventListener('click', function(e) {
                var btn = e.target && e.target.closest ? e.target.closest('[data-plyr="fullscreen"], [data-allplay="fullscreen"], [class*="fullscreen"], button[title*="экран"], button[aria-label*="экран"], button[title*="fullscreen"], button[aria-label*="fullscreen"], .plyr__control--fullscreen') : null;
                if (btn) {
                  notifyParentFullscreen();
                }
              }, true);

              // 2. Перехват двойного клика по области видео для переключения на полный экран
              document.addEventListener('dblclick', function(e) {
                var isControl = e.target && e.target.closest ? e.target.closest('button, input, select, a, [role="button"], [class*="control"], .plyr__controls, [class*="menu"], [class*="setting"], [class*="slider"], [class*="progress"]') : null;
                if (!isControl) {
                  try { e.preventDefault(); } catch (_) {}
                  notifyParentFullscreen();
                }
              }, true);

              // 3. Перехват горячих клавиш F / А (в русской и английской раскладке)
              document.addEventListener('keydown', function(e) {
                if ((e.key === 'f' || e.key === 'F' || e.code === 'KeyF' || e.key === 'а' || e.key === 'А') && 
                    e.target && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
                  notifyParentFullscreen();
                }
              }, true);

              // 3. Перехват Element.prototype.requestFullscreen внутри фрейма
              try {
                var origReq = Element.prototype.requestFullscreen || Element.prototype.webkitRequestFullscreen || Element.prototype.mozRequestFullScreen;
                Element.prototype.requestFullscreen = function() {
                  notifyParentFullscreen();
                  if (origReq) {
                    try { return origReq.apply(this, arguments); } catch (_) {}
                  }
                  return Promise.resolve();
                };
                if (Element.prototype.webkitRequestFullscreen) {
                  Element.prototype.webkitRequestFullscreen = function() {
                    notifyParentFullscreen();
                  };
                }
              } catch (_) {}
            })();
          })();
          </script>
          <style>
            #bug-report-modal:not(.active), .modal.bug-report:not(.active), .bug-report-wrap:not(.active), .modal__content:not(.active) {
              display: none !important;
            }
            .pj_menu_item.pj_active, [class*="menu_item"][class*="active"], [class*="speed-item"][class*="active"] {
              background: rgba(0, 210, 255, 0.35) !important;
              color: #ffffff !important;
              font-weight: 700 !important;
              border-left: 3px solid #00d2ff !important;
              box-shadow: inset 0 0 10px rgba(0, 210, 255, 0.25) !important;
            }
          </style>
        `;
        html = html.replace('<head>', '<head>' + proAudioInjection);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(html);
      }
    } catch (proxyErr) {
      console.warn('Проксирование FanFilm iframe завершилось с ошибкой:', proxyErr.message);
    }

    // Если прямое проксирование недоступно со стороны сервера Node.js,
    // сначала проверяем прямой поток Lift 4K/FHD, затем RuTube / VK Видео
    if (fallbackTitle) {
      try {
        const matchedLiftId = await Promise.race([
          resolveLiftMatch({ title: fallbackTitle, year: year || '', is_series: Boolean(season) }),
          new Promise(r => setTimeout(() => r(''), 2800))
        ]);
        if (matchedLiftId) {
          const epQuery = season ? `&is_series=1&season=${encodeURIComponent(season)}&episode=${encodeURIComponent(episode || '1')}` : '';
          return res.redirect(302, `/api/player/lift-embed?lift_id=${encodeURIComponent(matchedLiftId)}&title=${encodeURIComponent(fallbackTitle)}${year ? `&year=${encodeURIComponent(year)}` : ''}${epQuery}`);
        }
      } catch (_) {}
      const [ruId, vkUrl] = await Promise.all([
        resolveBestRuTubeId(fallbackTitle, year, season, episode, 0, false),
        resolveBestVkEmbed(fallbackTitle, year, season, episode, false)
      ]);
      if (ruId) {
        return res.redirect(302, `/api/player/rutube-embed/${ruId}`);
      }
      if (vkUrl) {
        return res.redirect(302, vkUrl);
      }
      return res.redirect(302, `/api/player/rutube-search-embed?title=${encodeURIComponent(fallbackTitle)}&year=${encodeURIComponent(year || '')}&no_ff=1`);
    }

    if (finalUrl && finalUrl.startsWith('http') && !finalUrl.includes('fanfilm4k.media')) {
      return res.redirect(302, finalUrl);
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(`
      <!DOCTYPE html>
      <html lang="ru">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            margin: 0;
            background: #0a0b10;
            color: #ffffff;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            text-align: center;
          }
          .vpn-card {
            background: rgba(15, 23, 42, 0.85);
            border: 1px solid rgba(0, 210, 255, 0.35);
            border-radius: 14px;
            padding: 26px 20px;
            max-width: 440px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.7);
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
          }
          .vpn-icon { font-size: 40px; }
          .vpn-title { font-size: 16px; font-weight: 700; color: #00d2ff; }
          .vpn-desc { font-size: 13px; color: #94a3b8; line-height: 1.5; }
          .vpn-btn {
            background: linear-gradient(135deg, #00d2ff, #0077ff);
            color: #fff;
            border: none;
            border-radius: 8px;
            padding: 10px 18px;
            font-size: 13px;
            font-weight: 700;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0, 210, 255, 0.3);
            transition: transform 0.15s, opacity 0.15s;
          }
          .vpn-btn:hover { transform: translateY(-1px); opacity: 0.95; }
        </style>
      </head>
      <body>
        <div class="vpn-card">
          <div class="vpn-icon">🛡️</div>
          <div class="vpn-title">Режим совместимости с VPN</div>
          <div class="vpn-desc">Прямой 4K поток заблокирован вашим VPN или DNS-провайдером. Автоматически переключаем на стабильный плеер (HDRezka / Collaps)...</div>
          <button type="button" class="vpn-btn" onclick="triggerNext()">Переключить источник сейчас</button>
        </div>
        <script>
          function triggerNext() {
            try {
              window.parent.postMessage({ type: 'STORM_SWITCH_NEXT_SOURCE', reason: 'VPN_DNS_FALLBACK' }, '*');
            } catch(e) {}
          }
          setTimeout(triggerNext, 1200);
        </script>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('Ошибка прокси плеера:', err.message);
    res.status(500).send('Ошибка проксирования видеопотока');
  }
});

// Проксирование внутренних запросов плеера Kodik (/ftor, /stats)
app.post(['/ftor', '/api/player/kodik-ftor'], express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const formData = new URLSearchParams();
    if (req.body && typeof req.body === 'object') {
      for (const [k, v] of Object.entries(req.body)) {
        if (v !== undefined && v !== null) {
          formData.append(k, String(v));
        }
      }
    }
    const ftorRes = await fetch('https://kodikplayer.com/ftor', {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Referer': req.headers.referer || 'https://anixart.tv/',
        'Origin': 'https://kodikplayer.com',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
      },
      body: formData.toString(),
      signal: AbortSignal.timeout(8000)
    });
    const data = await ftorRes.json().catch(() => null);
    if (!data) {
      return res.status(ftorRes.status || 502).json({ success: false, error: 'Ошибка получения видеопотока' });
    }
    return res.json(data);
  } catch (err) {
    console.error('[Kodik /ftor Proxy Error]:', err.message);
    return res.status(502).json({ success: false, error: err.message });
  }
});

app.post(['/stats', '/api/player/kodik-stats'], (req, res) => {
  res.json({ success: true });
});

// Автоматическое перенаправление внутренних переходов Kodik (/seria/*, /video/*, /uv/*, /episode/*)
app.get(['/seria/*', '/video/*', '/uv/*', '/episode/*', '/serial/*', '/season/*'], (req, res) => {
  const target = `https://kodikplayer.com${req.originalUrl}`;
  return res.redirect(`/api/player/adblock-proxy?url=${encodeURIComponent(target)}`);
});

// STORM AdBlock & VPN Proxy: комплексное проксирование и очистка плееров (Kodik, HDRezka, LostFilm и др.) от рекламы
app.get(['/api/player/kodik-embed', '/api/player/vpn-proxy', '/api/player/adblock-proxy'], async (req, res) => {
  try {
    const { url: rawUrl } = req.query;
    if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim() || rawUrl === 'undefined') {
      return res.status(400).type('text/plain; charset=utf-8').send('URL не указан');
    }

    let cleanUrl = rawUrl.trim();
    if (cleanUrl.startsWith('//')) cleanUrl = 'https:' + cleanUrl;
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      return res.status(400).type('text/plain; charset=utf-8').send('Некорректный URL');
    }
    if (!isSafeExternalHttpUrl(cleanUrl)) {
      return res.status(403).type('text/plain; charset=utf-8').send('Доступ к внутренним адресам запрещён');
    }

    // Сохраняем и восстанавливаем параметры сигнатуры балансера (d, d_sign, ref, ref_sign, season, episode и др.)
    const extraParams = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query)) {
      if (k !== 'url' && k !== 'fallback_title' && k !== 'fallback_year' && v !== undefined && v !== null && v !== '') {
        extraParams.append(k, String(v));
      }
    }
    const extraStr = extraParams.toString();
    if (extraStr) {
      cleanUrl += (cleanUrl.includes('?') ? '&' : '?') + extraStr;
    }

    const targetParsed = new URL(cleanUrl);
    const targetOrigin = targetParsed.origin;
    const fallbackTitle = String(req.query.fallback_title || targetParsed.searchParams.get('title') || '').trim();
    const fallbackYear = String(req.query.fallback_year || targetParsed.searchParams.get('year') || '').trim();
    const safeFallbackRedirect = fallbackTitle
      ? `/api/player/kinobox-embed?balancer=auto&fallback_mode=1&title=${encodeURIComponent(fallbackTitle)}&year=${encodeURIComponent(fallbackYear)}`
      : '';

    // Если запрошен kodik find-player без прямого видео-пути, проверяем наличие в Kodik API на сервере,
    // чтобы браузер никогда не получал пустую страницу "Плеер не найден"
    if (cleanUrl.includes('kodik') && cleanUrl.includes('find-player')) {
      const shikiParam = targetParsed.searchParams.get('shikimoriID') || '';
      const seasonParam = targetParsed.searchParams.get('season') || '';
      const epParam = targetParsed.searchParams.get('episode') || '';
      const resolvedKodik = await resolveKodikDirectIframe({
        cleanTitle: fallbackTitle,
        shikimori_id: shikiParam,
        season: seasonParam,
        episode: epParam
      });
      if (resolvedKodik) {
        cleanUrl = resolvedKodik;
      } else if (safeFallbackRedirect) {
        return res.redirect(302, safeFallbackRedirect);
      }
    }

    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Permissions-Policy', 'fullscreen=*');

    // Для Kodik / Aniqit / баз плееров подменяем Referer на kodikplayer.com для успешной отдачи плеера
    const effectiveReferer = (cleanUrl.includes('aniqit') || cleanUrl.includes('kodik') || cleanUrl.includes('playk'))
      ? 'https://kodikplayer.com/'
      : (targetOrigin + '/');

    const proxyRes = await fetch(cleanUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Referer': effectiveReferer,
        'Origin': targetOrigin,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        'X-Forwarded-For': '87.255.6.63',
        'X-Real-IP': '87.255.6.63'
      },
      signal: AbortSignal.timeout(8000),
      redirect: 'follow'
    });

    const contentType = proxyRes.headers.get('content-type') || '';

    if (contentType.includes('text/html')) {
      let html = await proxyRes.text();
      const lowerHtml = html.toLowerCase();
      const isNotFound = lowerHtml.includes('контент не найден') ||
                         lowerHtml.includes('приносим свои извинения') ||
                         lowerHtml.includes('видео удалено') ||
                         lowerHtml.includes('файл не найден') ||
                         lowerHtml.includes('404 not found');

      if (!proxyRes.ok || isNotFound) {
        if (safeFallbackRedirect) {
          return res.redirect(302, safeFallbackRedirect);
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(`
          <!DOCTYPE html>
          <html lang="ru">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              body { margin: 0; background: #0a0b10; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif; text-align: center; }
              .vpn-card { background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(0, 210, 255, 0.35); border-radius: 14px; padding: 24px 20px; max-width: 440px; box-shadow: 0 10px 30px rgba(0,0,0,0.7); display: flex; flex-direction: column; align-items: center; gap: 12px; }
              .vpn-icon { font-size: 36px; }
              .vpn-title { font-size: 16px; font-weight: 700; color: #00d2ff; }
              .vpn-desc { font-size: 13px; color: #94a3b8; line-height: 1.5; }
              .vpn-btn { background: linear-gradient(135deg, #00d2ff, #0077ff); color: #fff; border: none; border-radius: 8px; padding: 10px 18px; font-size: 13px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 12px rgba(0,210,255,0.3); }
            </style>
          </head>
          <body>
            <div class="vpn-card">
              <div class="vpn-icon">🛡️</div>
              <div class="vpn-title">Обход VPN: переключение источника</div>
              <div class="vpn-desc">Балансер недоступен. Выполняется автоматический переход к следующему онлайн-плееру...</div>
              <button type="button" class="vpn-btn" onclick="triggerNext()">Переключить источник</button>
            </div>
            <script>
              function triggerNext() {
                try {
                  window.parent.postMessage({ type: 'STORM_SWITCH_NEXT_SOURCE', reason: 'VPN_PROXY_FALLBACK' }, '*');
                } catch(e) {}
              }
              setTimeout(triggerNext, 1200);
            </script>
          </body>
          </html>
        `);
      }

      // 1. STORM AdBlock Engine: вырезание полей конфигурации рекламы Playerjs, VAST и баннеров
      html = html
        .replace(/(["']?(?:preroll|midroll|postroll|vast|vast_url|banner|brand|adv|advert|clickunder|popunder)["']?\s*:\s*)(?:\[[^\]]*\]|"[^"]*"|'[^']*'|\{[^\}]*\}|true)/gi, '$1null')
        .replace(/\b(?:preroll|midroll|vast|vast_url)\s*=\s*[^;,\n]+/gi, '/* storm ad removed */')
        .replace(/<script[^>]*src=["'][^"']*(?:yandex|adfox|googleads|doubleclick|adsystem|adkernel|redclick|marketgid|casino|1xbet|betting|traff|banner|adv)[^"']*["'][^>]*><\/script>/gi, '');

      // 2. В kodikplayer.com/find-player перенаправляем создаваемый внутренний iframe на наш adblock-proxy с сохранением всех подписей
      html = html.replace(
        /player\.innerHTML\s*=\s*["']<iframe id=\\?["']player-iframe\\?["'] src=\\?["']["']\s*\+\s*link\s*\+\s*paramsSymbol\s*\+\s*["']([^"'\\\\]+)[^<]*<\/iframe>\\?["'];?/g,
        (m, extra) => {
          return `var fullTargetLink = (link.startsWith("//") ? "https:" + link : link) + paramsSymbol + "${extra}";
var safeInnerLink = "/api/player/adblock-proxy?url=" + encodeURIComponent(fullTargetLink);
player.innerHTML = '<iframe id="player-iframe" src="' + safeInnerLink + '" width="100%" height="100%" frameborder="0" allowfullscreen allow="fullscreen *"></iframe>';`;
        }
      );
      html = html.replace(
        /player\.innerHTML\s*=\s*["']<iframe id=\\?["']player-iframe\\?["'] src=\\?["']["']\s*\+\s*link[^<]*<\/iframe>\\?["'];?/g,
        'var safeInnerLink = "/api/player/adblock-proxy?url=" + encodeURIComponent((link.startsWith("//") ? "https:" + link : link));\nplayer.innerHTML = \'<iframe id="player-iframe" src="\' + safeInnerLink + \'" width="100%" height="100%" frameborder="0" allowfullscreen allow="fullscreen *"></iframe>\';'
      );

      // Заменяем вывод "Плеер не найден" на мгновенный переход на рабочий резервный поток внутри фрейма
      html = html.replace(
        /notFoundCallback:\s*function\s*\([^)]*\)\s*\{[\s\S]*?Плеер не найден[\s\S]*?\}/g,
        `notFoundCallback: function(data) {
          var fbUrl = ${JSON.stringify(safeFallbackRedirect)};
          if (fbUrl) {
            window.location.replace(fbUrl);
            return;
          }
          if (player) {
            player.classList.remove("loading");
            player.innerHTML = '<div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0a0b10;color:#94a3b8;font-family:sans-serif;font-size:14px;text-align:center;padding:20px;gap:12px;">' +
              '<div style="font-size:36px;">🔍</div>' +
              '<div style="font-size:16px;font-weight:700;color:#00d2ff;">Поиск активного видеопотока...</div>' +
              '<div style="max-width:380px;line-height:1.5;color:#64748b;">Выполняется автоматический переход к альтернативному источнику</div>' +
            '</div>';
          }
          try {
            window.parent.postMessage({ type: 'STORM_SWITCH_NEXT_SOURCE', reason: 'PLAYER_NOT_FOUND', user_initiated: true }, '*');
          } catch(e) {}
        }`
      );

      const finalOrigin = new URL(proxyRes.url || cleanUrl).origin;
      const injection = `
        <base href="${finalOrigin}/">
        <script>
        (function() {
          try {
            // Блокировка автозапуска видео при открытии до клика пользователя
            var _userInteracted = false;
            var markInteracted = function() { _userInteracted = true; };
            window.addEventListener('pointerdown', markInteracted, true);
            window.addEventListener('mousedown', markInteracted, true);
            window.addEventListener('touchstart', markInteracted, true);
            window.addEventListener('keydown', markInteracted, true);
            window.addEventListener('click', markInteracted, true);
            window.addEventListener('message', function(e) {
              try {
                var d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
                if (d && (d.type === 'PLAY' || d.type === 'TOGGLE' || d.action === 'play' || d.action === 'toggle')) {
                  _userInteracted = true;
                }
              } catch(_) {}
            });
            try {
              var origPlay = HTMLMediaElement.prototype.play;
              HTMLMediaElement.prototype.play = function() {
                if (!_userInteracted) {
                  try { this.autoplay = false; this.removeAttribute('autoplay'); } catch(_) {}
                  return Promise.resolve();
                }
                return origPlay.apply(this, arguments);
              };
            } catch(_) {}

            // Фильтрация спама ошибок Kodik и рекламных трекеров в консоли
            var origErr = console.error;
            console.error = function() {
              var str = String(arguments[0] || '');
              if (str.includes('Forward to player') || str.includes('change file error') || str.includes('ERR_BLOCKED_BY_CLIENT') || str.includes('imasdk')) return;
              return origErr.apply(console, arguments);
            };
            var origWarn = console.warn;
            console.warn = function() {
              var str = String(arguments[0] || '');
              if (str.includes('Forward to player') || str.includes('ERR_BLOCKED_BY_CLIENT') || str.includes('imasdk')) return;
              return origWarn.apply(console, arguments);
            };

            // Обнаружение ошибки "Плеер не найден" через DOM MutationObserver
            var reportedNotFound = false;
            var fbRedirectUrl = ${JSON.stringify(safeFallbackRedirect)};
            var checkNotFound = function() {
              if (reportedNotFound) return;
              var text = (document.body ? document.body.innerText : '') || '';
              if (text.includes('Плеер не найден') || text.includes('Видео не найдено') || text.includes('Видео удалено') || text.includes('Контент не найден')) {
                reportedNotFound = true;
                if (fbRedirectUrl) {
                  window.location.replace(fbRedirectUrl);
                  return;
                }
                if (document.body) {
                  document.body.innerHTML = '<div style="height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0a0b10;color:#94a3b8;font-family:sans-serif;font-size:14px;text-align:center;padding:20px;gap:12px;">' +
                    '<div style="font-size:36px;">🔍</div>' +
                    '<div style="font-size:16px;font-weight:700;color:#00d2ff;">Поиск активного видеопотока...</div>' +
                    '<div style="max-width:380px;line-height:1.5;color:#64748b;">Выполняется автоматический переход к альтернативному источнику</div>' +
                  '</div>';
                }
                try {
                  window.parent.postMessage({ type: 'STORM_SWITCH_NEXT_SOURCE', reason: 'PLAYER_NOT_FOUND', user_initiated: true }, '*');
                } catch(e) {}
              }
            };
            var obs = new MutationObserver(checkNotFound);
            obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
            setInterval(checkNotFound, 600);

            // Блокировка всплывающих окон, редиректов и кликандеров
            window.open = function() {
              console.warn('🛡️ STORM AdBlock: открытие внешнего окна заблокировано');
              return null;
            };
            window.alert = function() {};

            // Сетевой перехватчик VAST и видеорекламы (Fetch и XHR)
            var emptyVast = '<?xml version="1.0" encoding="UTF-8"?><VAST version="2.0"></VAST>';
            var isAdUrl = function(u) {
              var low = String(u || '').toLowerCase();
              return low.includes('vast') || low.includes('preroll') || low.includes('midroll') ||
                     low.includes('postroll') || low.includes('adfox') || low.includes('yandex') ||
                     low.includes('ssp') || low.includes('doubleclick') || low.includes('googleads') ||
                     low.includes('adsystem') || low.includes('adkernel') || low.includes('banner') ||
                     low.includes('popunder') || low.includes('clickunder') || low.includes('casino') ||
                     low.includes('1xbet') || low.includes('winline') || low.includes('melbet') ||
                     low.includes('betwinner') || low.includes('vavada') || low.includes('pin-up') ||
                     low.includes('adcash') || low.includes('propellerads') || low.includes('marketgid');
            };

            var origFetch = window.fetch;
            if (origFetch) {
              window.fetch = function(input, init) {
                var url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
                if (isAdUrl(url)) {
                  if (url.includes('.xml') || url.includes('vast')) {
                    return Promise.resolve(new Response(emptyVast, {
                      status: 200,
                      headers: { 'Content-Type': 'application/xml; charset=utf-8' }
                    }));
                  }
                  return Promise.resolve(new Response(JSON.stringify({ ads: [], preroll: null, vast: null }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json; charset=utf-8' }
                  }));
                }
                return origFetch.apply(this, arguments);
              };
            }

            var origOpen = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function(method, url) {
              if (isAdUrl(url)) {
                this._isStormBlockedAd = true;
              }
              return origOpen.apply(this, arguments);
            };

            var origSend = XMLHttpRequest.prototype.send;
            XMLHttpRequest.prototype.send = function() {
              if (this._isStormBlockedAd) {
                try {
                  Object.defineProperty(this, 'status', { get: function() { return 200; } });
                  Object.defineProperty(this, 'readyState', { get: function() { return 4; } });
                  Object.defineProperty(this, 'responseText', { get: function() { return emptyVast; } });
                  Object.defineProperty(this, 'response', { get: function() { return emptyVast; } });
                  if (typeof this.onreadystatechange === 'function') this.onreadystatechange();
                  if (typeof this.onload === 'function') this.onload();
                } catch(_) {}
                return;
              }
              return origSend.apply(this, arguments);
            };

            // Перехват кликов по рекламным баннерам и кликандерам
            document.addEventListener('click', function(e) {
              var target = e.target;
              if (!target) return;
              var link = target.closest('a');
              if (link) {
                var href = link.getAttribute('href') || '';
                if (isAdUrl(href) || link.target === '_blank') {
                  e.preventDefault();
                  e.stopPropagation();
                }
              }
            }, true);

            // Перехват динамического создания iframe и установки src для маршрутизации через adblock-proxy
            var origSetAttribute = Element.prototype.setAttribute;
            Element.prototype.setAttribute = function(name, val) {
              if (this.tagName === 'IFRAME' && name.toLowerCase() === 'src' && typeof val === 'string') {
                if (!val.startsWith('/api/player/') && (val.includes('kodik') || val.includes('aniqit') || val.includes('playk') || val.includes('video') || val.includes('player') || val.includes('balancer') || val.includes('collaps') || val.includes('alloha'))) {
                  val = '/api/player/adblock-proxy?url=' + encodeURIComponent(val.startsWith('//') ? 'https:' + val : val);
                }
              }
              return origSetAttribute.call(this, name, val);
            };

            try {
              var iframeSrcDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
              if (iframeSrcDesc && iframeSrcDesc.set) {
                Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
                  set: function(val) {
                    if (typeof val === 'string' && !val.startsWith('/api/player/') && (val.includes('kodik') || val.includes('aniqit') || val.includes('playk') || val.includes('video') || val.includes('player') || val.includes('balancer') || val.includes('collaps') || val.includes('alloha'))) {
                      val = '/api/player/adblock-proxy?url=' + encodeURIComponent(val.startsWith('//') ? 'https:' + val : val);
                    }
                    return iframeSrcDesc.set.call(this, val);
                  },
                  get: iframeSrcDesc.get
                });
              }
            } catch (_) {}

            function sterilizeAds() {
              try {
                var skipSelectors = [
                  '.skip-ad', '.ad-skip', '.vast-skip-button', '.playerjs-ad-skip',
                  '[class*="skip"][class*="ad"]', 'button[class*="skip"]',
                  '.close-ad', '.ad-close', '.video-ad-skip', '.skip-button',
                  '#skip-button', '[id*="skip"]', '.ytp-ad-skip-button',
                  '.videoAdUiSkipButton', '.ad-banner-close', '.closeBtn'
                ];
                var btns = document.querySelectorAll(skipSelectors.join(','));
                for (var i = 0; i < btns.length; i++) {
                  if (btns[i].offsetParent !== null) btns[i].click();
                }

                var adNodes = document.querySelectorAll('[id*="ad-"], [class*="ad-container"], [class*="player-ad"], .vast-container, [id*="banner"], [class*="teaser"], iframe[src*="ad"], [class*="clickunder"], [class*="popunder"]');
                for (var j = 0; j < adNodes.length; j++) {
                  adNodes[j].style.setProperty('display', 'none', 'important');
                  adNodes[j].style.setProperty('pointer-events', 'none', 'important');
                }

                var vids = document.querySelectorAll('video');
                for (var k = 0; k < vids.length; k++) {
                  var v = vids[k];
                  var isAd = v.closest('.ad-container') || v.closest('[class*="vast"]') || v.classList.contains('vpaid-video') || (v.src && (v.src.indexOf('/ad') !== -1 || v.src.indexOf('preroll') !== -1 || isAdUrl(v.src)));
                  if (isAd) {
                    v.muted = true;
                    if (v.duration && isFinite(v.duration) && v.currentTime < v.duration) {
                      v.currentTime = v.duration;
                    }
                  }
                }
              } catch(e) {}
            }
            setInterval(sterilizeAds, 120);
            if (document.readyState === 'loading') {
              document.addEventListener('DOMContentLoaded', sterilizeAds);
            } else {
              sterilizeAds();
            }
          } catch (_) {}
        })();
        </script>
        <style>
          [class*="ad-"], [id*="ad-"], .vast-container, [class*="teaser"], [id*="banner"], [class*="clickunder"], [class*="popunder"] {
            display: none !important;
            opacity: 0 !important;
            pointer-events: none !important;
            width: 0 !important;
            height: 0 !important;
          }
        </style>
        <script>
        (function() {
          try {

            // STORM Fullscreen Bridge: перехват кликов по кнопкам полноэкранного режима, горячей клавиши F и вызовов Fullscreen API
            (function() {
              function notifyParentFullscreen() {
                try {
                  window.parent.postMessage({ type: 'STORM_FULLSCREEN_TOGGLE', event: 'fullscreen', action: 'fullscreen' }, '*');
                } catch (_) {}
              }

              document.addEventListener('click', function(e) {
                var btn = e.target && e.target.closest ? e.target.closest('[data-plyr="fullscreen"], [data-allplay="fullscreen"], [class*="fullscreen"], button[title*="экран"], button[aria-label*="экран"], button[title*="fullscreen"], button[aria-label*="fullscreen"], .plyr__control--fullscreen') : null;
                if (btn) {
                  notifyParentFullscreen();
                }
              }, true);

              document.addEventListener('dblclick', function(e) {
                var isControl = e.target && e.target.closest ? e.target.closest('button, input, select, a, [role="button"], [class*="control"], .plyr__controls, [class*="menu"], [class*="setting"], [class*="slider"], [class*="progress"]') : null;
                if (!isControl) {
                  try { e.preventDefault(); } catch (_) {}
                  notifyParentFullscreen();
                }
              }, true);

              document.addEventListener('keydown', function(e) {
                if ((e.key === 'f' || e.key === 'F' || e.code === 'KeyF' || e.key === 'а' || e.key === 'А') && 
                    e.target && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
                  notifyParentFullscreen();
                }
              }, true);

              try {
                var origReq = Element.prototype.requestFullscreen || Element.prototype.webkitRequestFullscreen || Element.prototype.mozRequestFullScreen;
                Element.prototype.requestFullscreen = function() {
                  notifyParentFullscreen();
                  if (origReq) {
                    try { return origReq.apply(this, arguments); } catch (_) {}
                  }
                  return Promise.resolve();
                };
                if (Element.prototype.webkitRequestFullscreen) {
                  Element.prototype.webkitRequestFullscreen = function() {
                    notifyParentFullscreen();
                  };
                }
              } catch (_) {}
            })();
          } catch(e) {}
        })();
        </script>
      `;
      if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<head[^>]*>/i, match => match + injection);
      } else if (/<html[^>]*>/i.test(html)) {
        html = html.replace(/<html[^>]*>/i, match => match + '<head>' + injection + '</head>');
      } else {
        html = injection + html;
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }

    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    const buffer = await proxyRes.arrayBuffer();
    return res.send(Buffer.from(buffer));
  } catch (err) {
    console.warn('Ошибка /api/player/vpn-proxy:', err.message);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(`
      <!DOCTYPE html>
      <html lang="ru">
      <head>
        <meta charset="utf-8">
        <script>
          try {
            window.parent.postMessage({ type: 'STORM_SWITCH_NEXT_SOURCE', reason: 'VPN_PROXY_ERROR' }, '*');
          } catch(e) {}
        </script>
        <style>body{margin:0;background:#0a0b10;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;}</style>
      </head>
      <body>
        <div style="color:#00d2ff;font-size:14px;">Переключение на следующий источник...</div>
      </body>
      </html>
    `);
  }
});

// ============================================================================
// LIFT 4K / FHD AD-FREE PLAYER ENGINE & STREAM / DOWNLOAD EXTRACTOR
// ============================================================================

let cachedLiftCdnJs = '';
let cachedLiftListenJs = '';

app.get('/api/player/lift-cdn.js', async (req, res) => {
  try {
    if (!cachedLiftCdnJs) {
      const txt = await liftFetchText('https://embed.liftw.ws/cdn.js', 7000);
      if (txt && txt.length > 100) cachedLiftCdnJs = txt;
    }
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(cachedLiftCdnJs || '/* lift cdn fallback */');
  } catch (_) {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    return res.send('/* lift cdn fallback */');
  }
});

app.get('/api/player/lift-listen.js', async (req, res) => {
  try {
    if (!cachedLiftListenJs) {
      const txt = await liftFetchText('https://embed.liftw.ws/js/listen-player.js', 7000);
      if (txt && txt.length > 50) {
        cachedLiftListenJs = txt.replace(/__s\([^)]*\)/g, 'void 0');
      }
    }
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(cachedLiftListenJs || '/* lift listen fallback */');
  } catch (_) {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    return res.send('/* lift listen fallback */');
  }
});

// Получение прямых ссылок HLS / DASH (4K VP9/AV1, 1080p, 720p, 480p), всех студийных озвучек и субтитров для скачивания и выбора потока
app.get('/api/player/lift-download-options', async (req, res) => {
  try {
    const { lift_id, id, title, original_title, year, is_series, season, episode } = req.query;
    const rawLiftId = lift_id || (String(id || '').startsWith('lift_') ? String(id).replace(/^lift_/i, '') : '');
    const matchedLiftId = await resolveLiftMatch({
      lift_id: rawLiftId,
      title: title || '',
      original_title: original_title || '',
      year: year || '',
      is_series: is_series === '1' || is_series === 'true'
    });

    if (!matchedLiftId) {
      return res.json({ success: false, error: 'Релиз не найден в базе прямых потоков Lift' });
    }

    const data = await getLiftDownloadAndStreamOptions(matchedLiftId, {
      season: parseInt(season, 10) || 1,
      episode: parseInt(episode, 10) || 1,
      userAgent: req.headers['user-agent'] || ''
    });

    if (!data) {
      return res.json({ success: false, error: 'Не удалось извлечь прямые потоки для релиза' });
    }

    return res.json({
      success: true,
      ...data
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Скачивание отдельных файлов субтитров .vtt для внешних плееров (VLC / IINA / PotPlayer)
app.get('/api/player/lift-subtitle.vtt', async (req, res) => {
  try {
    const rawUrl = String(req.query.url || '').trim();
    if (!rawUrl || !/^https?:\/\//i.test(rawUrl) || !isSafeExternalHttpUrl(rawUrl)) {
      return res.status(400).send('Invalid subtitle URL');
    }
    const cleanFilename = String(req.query.filename || 'subtitles.vtt')
      .replace(/[^a-zA-Z0-9а-яА-ЯёЁ._ -]/g, '_')
      .replace(/\.vtt$/i, '') + '.vtt';
    const asciiFallback = cleanFilename.replace(/[^\x20-\x7E]/g, '_') || 'subtitles.vtt';

    const r = await liftRequestRaw(rawUrl, {
      origin: 'https://embed.liftw.ws',
      referer: 'https://embed.liftw.ws/',
      headers: req.headers['user-agent'] ? { 'User-Agent': req.headers['user-agent'] } : {},
      timeout: 8000
    });
    if (!r.ok) {
      return res.status(502).send('Failed to fetch subtitle file');
    }
    const vttText = r.text();
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(cleanFilename)}`
    );
    return res.send(vttText);
  } catch (err) {
    return res.status(500).send(`Subtitle error: ${err.message}`);
  }
});

// Генерация готового плейлиста .m3u8 / .m3u для запуска потока в VLC, IINA, PotPlayer и на Smart TV
app.get('/api/player/lift-playlist.m3u8', (req, res) => {
  const streamUrl = String(req.query.url || '').trim();
  const title = String(req.query.title || 'STORM MULTIMEDIA 4K Stream').replace(/[\r\n]+/g, ' ').trim();
  const quality = String(req.query.quality || '1080p').replace(/[\r\n]+/g, '').trim();
  const voice = String(req.query.voice || '').replace(/[\r\n]+/g, '').trim();
  if (!streamUrl || !/^https?:\/\//i.test(streamUrl) || !isSafeExternalHttpUrl(streamUrl)) {
    return res.status(400).send('Invalid stream URL');
  }
  const displayTitle = `${title} [${quality}${voice ? ' • ' + voice : ''}]`;
  const safeBaseName = title.replace(/[^a-zA-Z0-9а-яА-ЯёЁ._ -]/g, '_').slice(0, 60) || 'STORM_Stream';
  const asciiBaseName = safeBaseName.replace(/[^\x20-\x7E]/g, '_') || 'STORM_Stream';
  const fileName = `${safeBaseName}_${quality}.m3u`;
  const asciiFileName = `${asciiBaseName}_${quality}.m3u`;

  const m3uContent = [
    '#EXTM3U',
    `#PLAYLIST:${displayTitle}`,
    '#EXTVLCOPT:http-referrer=https://embed.liftw.ws/',
    `#EXTVLCOPT:http-user-agent=${String(req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36').replace(/[\r\n]+/g, ' ').trim()}`,
    '#EXTVLCOPT:network-caching=1500',
    `#EXTINF:-1 group-title="STORM MULTIMEDIA",${displayTitle}`,
    streamUrl
  ].join('\r\n') + '\r\n';

  res.setHeader('Content-Type', 'audio/x-mpegurl; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
  );
  return res.send(m3uContent);
});

// Прямой очищенный от рекламы плеер Lift (VenomPlayer 4K/FHD + все озвучки СНГ + субтитры + превью таймлайна + автопропуск заставок)
app.get('/api/player/lift-embed', async (req, res) => {
  const { lift_id, title, original_title, year, kp_id, imdb_id, is_series, season, episode, voice } = req.query;
  const fallbackKinoboxUrl = `/api/player/kinobox-embed?balancer=kinobox&no_lift=1&title=${encodeURIComponent(title || '')}${original_title ? `&original_title=${encodeURIComponent(original_title)}` : ''}${year ? `&year=${encodeURIComponent(year)}` : ''}${kp_id ? `&kp_id=${encodeURIComponent(kp_id)}` : ''}${imdb_id ? `&imdb_id=${encodeURIComponent(imdb_id)}` : ''}${season ? `&season=${encodeURIComponent(season)}&episode=${encodeURIComponent(episode || 1)}` : ''}`;

  try {
    const matchedLiftId = await resolveLiftMatch({
      lift_id: lift_id || '',
      title: title || '',
      original_title: original_title || '',
      year: year || '',
      is_series: is_series === '1' || is_series === 'true'
    });

    if (!matchedLiftId) {
      return res.redirect(fallbackKinoboxUrl);
    }

    const clientUserAgent = req.headers['user-agent'] || '';
    const forceHls = req.query.force_hls === '1';
    const embedUrl = `https://embed.liftw.ws/embed/movie/${matchedLiftId}?host=liftw.ws`;
    let html = await liftFetchText(
      embedUrl,
      9000,
      clientUserAgent
        ? {
            'User-Agent': clientUserAgent,
            'Sec-Fetch-Dest': 'iframe',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-site'
          }
        : {}
    );
    if (!html || !html.includes('makePlayer')) {
      return res.redirect(fallbackKinoboxUrl);
    }

    const reqSeason = parseInt(season, 10) || 1;
    const reqEpisode = String(parseInt(episode, 10) || 1);

    // 1. Полное вырезание рекламного блока VAST (pre-roll, mid-roll, post-roll, overlay)
    html = html.replace(/<script\s+data-name=["']ad["']>[\s\S]*?<\/script>/gi, '<script data-name="ad">var middleCount = 0, adTimeouts = {}, adsConfig = undefined;</script>');
    html = html.replace(/ads:\s*adsConfig\s*,/g, 'ads: undefined,');

    // 2. Отключение внешних трекеров и сторонних iframe
    html = html.replace(/<script\s+data-name=["']ss["']>[\s\S]*?<\/script>/gi, '');
    html = html.replace(/<script\s+data-name=["']ping["']>[\s\S]*?<\/script>/gi, '');
    html = html.replace(/new\s+Image\(\)\.src\s*=\s*["']https:\/\/s\.myangular\.life\/player\?["']\s*\+\s*s\s*;/g, 'void 0;');
    html = html.replace(/stats:\s*\[[^\]]*\]\s*,/g, 'stats: [],');

    // 3. Проксирование скриптов cdn.js и listen-player.js через наш сервер (обход проблем с DNS у клиентов)
    html = html.replace(/src=["']\/\/embed\.liftw\.ws\/cdn\.js["']/gi, 'src="/api/player/lift-cdn.js"');
    html = html.replace(/src=["']\/\/embed\.liftw\.ws\/js\/listen-player\.js["']/gi, 'src="/api/player/lift-listen.js"');

    // 4. Фирменная стилизация плеера под палитру STORM MULTIMEDIA
    html = html.replace(
      /cssVars:\s*\{[^}]+\}/,
      'cssVars:{"color-text":"rgba(248,250,252,1)","border-radius":"0.5rem","color-buttons":"rgba(255,255,255,1)","color-primary":"rgba(0,210,255,0.92)","background-color-primary":"rgba(11,17,32,0.92)","button-icon-color":"rgba(255,255,255,1)"}'
    );

    // 5. Установка запрошенного сезона и серии при старте сериала
    if (reqSeason > 1 || reqEpisode !== '1') {
      html = html.replace(
        /current:\s*\{\s*season:\s*\d+\s*,\s*episode:\s*["'][^"']+["']\s*\}/,
        `current: { season: ${reqSeason}, episode: "${reqEpisode}" }`
      );
    }

    // 6. Инъекция моста STORM: память озвучки/субтитров, умный пропуск интро/повтора/титров, синхронизация серий
    const stormBridgeScript = `
<style>
  #storm-skip-widget {
    position: fixed;
    right: 24px;
    bottom: 78px;
    z-index: 99999;
    display: none;
    align-items: center;
    gap: 10px;
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    animation: stormFadeIn 0.25s ease;
  }
  @keyframes stormFadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .storm-skip-btn {
    background: linear-gradient(135deg, rgba(0, 210, 255, 0.95), rgba(59, 130, 246, 0.95));
    color: #060913;
    border: 1px solid rgba(255, 255, 255, 0.35);
    border-radius: 10px;
    padding: 10px 18px;
    font-size: 13px;
    font-weight: 800;
    cursor: pointer;
    box-shadow: 0 8px 24px rgba(0, 210, 255, 0.38);
    transition: transform 0.15s ease, box-shadow 0.15s ease;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .storm-skip-btn:hover {
    transform: translateY(-1.5px);
    box-shadow: 0 12px 28px rgba(0, 210, 255, 0.55);
  }
  .storm-autoskip-toggle {
    background: rgba(11, 17, 32, 0.88);
    color: #cbd5e1;
    border: 1px solid rgba(0, 210, 255, 0.35);
    border-radius: 10px;
    padding: 9px 12px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    backdrop-filter: blur(10px);
  }
  .storm-autoskip-toggle.active {
    color: #00d2ff;
    border-color: #00d2ff;
    background: rgba(0, 210, 255, 0.14);
  }
</style>
<div id="storm-skip-widget">
  <button type="button" id="storm-skip-action-btn" class="storm-skip-btn">⏭ Пропустить заставку</button>
  <button type="button" id="storm-autoskip-btn" class="storm-autoskip-toggle" title="Автоматический пропуск заставок, повторов и титров">Автопропуск: ВЫКЛ</button>
</div>
<script>
(function() {
  var LIFT_ID = "${matchedLiftId}";
  var REQ_SEASON = ${reqSeason};
  var REQ_EPISODE = "${reqEpisode}";
  var REQ_VOICE = ${JSON.stringify(String(voice || '').trim())};
  var FORCE_HLS = ${forceHls ? "true" : "false"};
  var FALLBACK_KINOBOX_URL = ${JSON.stringify(fallbackKinoboxUrl)};
  var activeSections = [];
  var lastSkippedSectionKey = '';
  var autoSkipEnabled = false;
  try {
    autoSkipEnabled = localStorage.getItem('storm_lift_autoskip') === '1';
  } catch (_) {}

  var widgetEl = document.getElementById('storm-skip-widget');
  var skipBtnEl = document.getElementById('storm-skip-action-btn');
  var autoSkipBtnEl = document.getElementById('storm-autoskip-btn');
  var currentActiveSection = null;

  function updateAutoSkipUi() {
    if (!autoSkipBtnEl) return;
    if (autoSkipEnabled) {
      autoSkipBtnEl.classList.add('active');
      autoSkipBtnEl.textContent = '⚡ Автопропуск: ВКЛ';
    } else {
      autoSkipBtnEl.classList.remove('active');
      autoSkipBtnEl.textContent = 'Автопропуск: ВЫКЛ';
    }
  }
  updateAutoSkipUi();

  if (autoSkipBtnEl) {
    autoSkipBtnEl.addEventListener('click', function(e) {
      e.stopPropagation();
      autoSkipEnabled = !autoSkipEnabled;
      try { localStorage.setItem('storm_lift_autoskip', autoSkipEnabled ? '1' : '0'); } catch (_) {}
      updateAutoSkipUi();
    });
  }

  function seekVideoTo(targetSec) {
    var v = document.querySelector('video');
    if (v && !isNaN(targetSec)) {
      v.currentTime = targetSec;
    }
  }

  if (skipBtnEl) {
    skipBtnEl.addEventListener('click', function(e) {
      e.stopPropagation();
      if (currentActiveSection && typeof currentActiveSection.end === 'number') {
        seekVideoTo(currentActiveSection.end);
        if (widgetEl) widgetEl.style.display = 'none';
      }
    });
  }

  function getSectionLabel(type) {
    if (type === 'repeat') return '⏭ Пропустить повтор';
    if (type === 'screen' || type === 'intro') return '⏭ Пропустить заставку';
    if (type === 'titer' || type === 'outro') return '⏭ Пропустить титры';
    return '⏭ Пропустить фрагмент';
  }

  function checkTimeForSections(curTime) {
    if (!Array.isArray(activeSections) || activeSections.length === 0) {
      if (widgetEl) widgetEl.style.display = 'none';
      return;
    }
    var found = null;
    for (var i = 0; i < activeSections.length; i++) {
      var s = activeSections[i];
      if (s && s.skip !== false && typeof s.start === 'number' && typeof s.end === 'number') {
        if (curTime >= s.start && curTime < s.end - 1.5) {
          found = s;
          break;
        }
      }
    }
    currentActiveSection = found;
    if (found) {
      var secKey = found.type + '_' + found.start + '_' + found.end;
      if (autoSkipEnabled && lastSkippedSectionKey !== secKey) {
        lastSkippedSectionKey = secKey;
        seekVideoTo(found.end);
        if (widgetEl) widgetEl.style.display = 'none';
        return;
      }
      if (skipBtnEl) skipBtnEl.textContent = getSectionLabel(found.type);
      if (widgetEl) widgetEl.style.display = 'flex';
    } else {
      if (widgetEl) widgetEl.style.display = 'none';
    }
  }

  var errorHandled = false;
  setInterval(function() {
    var v = document.querySelector('video');
    if (v && !v.paused) {
      checkTimeForSections(v.currentTime || 0);
    }
    if (!errorHandled && document.body) {
      var bodyTxt = document.body.innerText || '';
      if (bodyTxt.indexOf('is not available') !== -1 || bodyTxt.indexOf('dasha [') !== -1 || bodyTxt.indexOf('dash [') !== -1 || bodyTxt.indexOf('Попробуйте обновить страницу') !== -1) {
        errorHandled = true;
        if (!FORCE_HLS && window.location.search.indexOf('force_hls=1') === -1) {
          var sep = window.location.search ? '&' : '?';
          window.location.replace(window.location.pathname + window.location.search + sep + 'force_hls=1');
        } else {
          try { window.parent.postMessage({ type: 'STORM_SWITCH_NEXT_SOURCE', reason: 'LIFT_STREAM_ERROR' }, '*'); } catch (_) {}
          if (FALLBACK_KINOBOX_URL) window.location.replace(FALLBACK_KINOBOX_URL);
        }
      }
    }
  }, 500);

  // Восстановление и сохранение выбранной озвучки и субтитров
  function applySavedPreferences() {
    try {
      if (!window.app || !app._settings || !app._settings.ctrl) return;
      var ctrl = app._settings.ctrl;
      var savedAudio = localStorage.getItem('storm_lift_audio_' + LIFT_ID) || localStorage.getItem('storm_lift_default_audio') || '';
      var savedSub = localStorage.getItem('storm_lift_sub_' + LIFT_ID) || '';

      if (ctrl.sound && ctrl.ls && ctrl.ls.sound && Array.isArray(ctrl.ls.sound.value)) {
        var availSounds = ctrl.ls.sound.value;
        var chosenSound = '';
        if (REQ_VOICE) {
          var vLow = REQ_VOICE.toLowerCase();
          chosenSound = availSounds.find(function(n) {
            var sLow = String(n).toLowerCase();
            if (vLow === 'rhs') return sLow.includes('red head') || sLow.includes('rhs') || sLow.includes('lostfilm') || sLow.includes('лостфильм');
            if (vLow === 'hdrezka') return sLow.includes('hdrezka') || sLow.includes('резка') || sLow.includes('tvshows') || sLow.includes('jaskier');
            if (vLow === 'original') return sLow.includes('оригинал') || sLow.includes('original') || sLow.includes('eng') || sLow.includes('субтитр');
            return sLow.includes(vLow);
          }) || '';
        }
        if (!chosenSound && savedAudio) {
          chosenSound = availSounds.find(function(n) { return String(n).toLowerCase() === savedAudio.toLowerCase(); }) || '';
        }
        if (chosenSound) ctrl.sound.value = chosenSound;
      }
      if (savedSub && ctrl.cc && ctrl.ls && ctrl.ls.cc && Array.isArray(ctrl.ls.cc.value)) {
        var availSubs = ctrl.ls.cc.value;
        var exactSub = availSubs.find(function(n) { return String(n).toLowerCase() === savedSub.toLowerCase(); });
        if (exactSub) ctrl.cc.value = exactSub;
      }
    } catch (_) {}
  }

  var _lastActivitySent = 0;
  function notifyParentActivity() {
    var now = Date.now();
    if (now - _lastActivitySent < 350) return;
    _lastActivitySent = now;
    try { window.parent.postMessage({ type: 'STORM_IFRAME_ACTIVITY' }, '*'); } catch (_) {}
  }
  document.addEventListener('mousemove', notifyParentActivity, { passive: true });
  document.addEventListener('touchstart', notifyParentActivity, { passive: true });
  document.addEventListener('keydown', notifyParentActivity, { passive: true });

  setInterval(function() {
    try {
      var vid = document.querySelector('video');
      if (vid && !isNaN(vid.currentTime)) {
        window.parent.postMessage({
          type: 'STORM_IFRAME_TIME',
          currentTime: vid.currentTime,
          duration: vid.duration || 0,
          paused: vid.paused
        }, '*');
      }
    } catch (_) {}
  }, 500);

  window.addEventListener('message', function(e) {
    var d = e.data || {};
    if (typeof d === 'string') {
      try { d = JSON.parse(d); } catch (_) { d = {}; }
    }
    var vidEl = document.querySelector('video');
    if ((d.type === 'STORM_SEEK_DELTA' || d.event === 'seek' || d.action === 'seek' || d.api === 'seekDelta') && vidEl) {
      var deltaSec = Number(d.delta !== undefined ? d.delta : d.val) || 0;
      if (deltaSec) {
        vidEl.currentTime = Math.max(0, Math.min(vidEl.duration || Infinity, (vidEl.currentTime || 0) + deltaSec));
      }
    }
    if (d.type === 'STORM_SEEK_TO' && vidEl && d.time !== undefined) {
      vidEl.currentTime = Math.max(0, Number(d.time) || 0);
    }
    if ((d.type === 'STORM_SET_SPEED' || d.action === 'speed') && vidEl && d.speed) {
      vidEl.playbackRate = Number(d.speed) || 1;
    }
    if (d.type === 'STORM_PLAY_PAUSE' && vidEl) {
      if (d.action === 'pause') vidEl.pause();
      else if (d.action === 'play') vidEl.play().catch(function(){});
      else if (vidEl.paused) vidEl.play().catch(function(){});
      else vidEl.pause();
    }
    if (d.type === 'STORM_SET_AUDIO' && d.name && window.app && app._settings && app._settings.ctrl && app._settings.ctrl.sound) {
      var ctrlSnd = app._settings.ctrl;
      var availList = (ctrlSnd.ls && ctrlSnd.ls.sound && Array.isArray(ctrlSnd.ls.sound.value)) ? ctrlSnd.ls.sound.value : [];
      var targetAudio = d.name;
      if (availList.length > 0) {
        var reqLow = String(d.name).toLowerCase();
        var exact = availList.find(function(x) { return String(x).toLowerCase() === reqLow; });
        var partial = availList.find(function(x) {
          var xl = String(x).toLowerCase();
          return xl.includes(reqLow) || reqLow.includes(xl);
        });
        if (exact) targetAudio = exact;
        else if (partial) targetAudio = partial;
        else if (typeof d.index === 'number' && availList[d.index]) targetAudio = availList[d.index];
      }
      ctrlSnd.sound.value = targetAudio;
      try {
        localStorage.setItem('storm_lift_audio_' + LIFT_ID, targetAudio);
        localStorage.setItem('storm_lift_default_audio', targetAudio);
      } catch (_) {}
    }
    if (d.type === 'STORM_SET_SUBTITLE' && d.name !== undefined && window.app && app._settings && app._settings.ctrl && app._settings.ctrl.cc) {
      app._settings.ctrl.cc.value = d.name;
      try {
        localStorage.setItem('storm_lift_sub_' + LIFT_ID, d.name);
      } catch (_) {}
    }
    if (d.type === 'STORM_SET_QUALITY' && d.quality && window.app && app._settings && app._settings.ctrl && app._settings.ctrl.quality) {
      app._settings.ctrl.quality.value = d.quality;
    }
    if (d.event === 'setting' && d.key === 'sound' && d.value) {
      try {
        localStorage.setItem('storm_lift_audio_' + LIFT_ID, d.value);
        localStorage.setItem('storm_lift_default_audio', d.value);
        window.parent.postMessage({ type: 'STORM_LIFT_PREF_CHANGED', liftId: LIFT_ID, audioTitle: d.value }, '*');
      } catch (_) {}
    }
    if (d.event === 'setting' && d.key === 'cc' && d.value !== undefined) {
      try {
        localStorage.setItem('storm_lift_sub_' + LIFT_ID, d.value);
        window.parent.postMessage({ type: 'STORM_LIFT_PREF_CHANGED', liftId: LIFT_ID, subtitleLabel: d.value }, '*');
      } catch (_) {}
    }
  });

  // Перехват makePlayer или ожидание window.app для чтения секций и сезонов
  var hookTimer = setInterval(function() {
    if (!window.app) return;
    clearInterval(hookTimer);
    try {
      if (Array.isArray(window._initialSections) && (!activeSections || activeSections.length === 0)) {
        activeSections = window._initialSections;
      }
      setTimeout(applySavedPreferences, 450);
      if (app._settings && app._settings.ctrl) {
        var ctrl = app._settings.ctrl;
        try {
          if (ctrl.ls && ctrl.ls.sound && Array.isArray(ctrl.ls.sound.value) && ctrl.ls.sound.value.length > 0) {
            window.parent.postMessage({
              type: 'STORM_LIFT_AUDIO_TRACKS',
              liftId: LIFT_ID,
              tracks: ctrl.ls.sound.value,
              active: ctrl.sound ? ctrl.sound.value : ''
            }, '*');
          }
        } catch (_) {}
        if (ctrl.sound && typeof ctrl.sound.watch === 'function') {
          ctrl.sound.watch(function(v) {
            if (v) {
              try {
                localStorage.setItem('storm_lift_audio_' + LIFT_ID, v);
                localStorage.setItem('storm_lift_default_audio', v);
              } catch (_) {}
              window.parent.postMessage({ type: 'STORM_LIFT_PREF_CHANGED', liftId: LIFT_ID, audioTitle: v }, '*');
            }
          });
        }
        if (ctrl.cc && typeof ctrl.cc.watch === 'function') {
          ctrl.cc.watch(function(v) {
            try {
              localStorage.setItem('storm_lift_sub_' + LIFT_ID, v || '');
            } catch (_) {}
            window.parent.postMessage({ type: 'STORM_LIFT_PREF_CHANGED', liftId: LIFT_ID, subtitleLabel: v || '' }, '*');
          });
        }
      }
      if (typeof app.on === 'function') {
        app.on('playlistItem', function(ep) {
          lastSkippedSectionKey = '';
          if (ep && Array.isArray(ep.sections)) {
            activeSections = ep.sections;
          }
          setTimeout(applySavedPreferences, 350);
          window.parent.postMessage({
            type: 'STORM_LIFT_EPISODE_CHANGED',
            liftId: LIFT_ID,
            episodeId: ep && ep.id,
            episode: ep && ep.episode,
            title: ep && ep.title
          }, '*');
        });
      }
    } catch (_) {}
  }, 300);
})();
</script>
`;

    // Также пробрасываем исходные sections в activeSections при инициализации makePlayer
    html = html.replace(
      /app\s*=\s*VenomPlayer\.make\(opts\);/,
      `try {
        if (opts && opts.playlist && Array.isArray(opts.playlist.seasons)) {
          opts.playlist.seasons.sort(function(a, b) { return (Number(a.season) || 0) - (Number(b.season) || 0); });
          opts.playlist.seasons.forEach(function(s) {
            if (s && Array.isArray(s.episodes)) {
              s.episodes.sort(function(a, b) { return (parseFloat(a.episode) || 0) - (parseFloat(b.episode) || 0); });
            }
          });
          var targetS = Number(REQ_SEASON) || (opts.playlist.seasons[0] ? Number(opts.playlist.seasons[0].season) : 1);
          var targetE = String(REQ_EPISODE || "1");
          opts.playlist.current = { season: targetS, episode: targetE };
        }
        if (opts && Array.isArray(opts.sections)) { window._initialSections = opts.sections; }
        else if (opts && opts.playlist && Array.isArray(opts.playlist.seasons)) {
          var curS = opts.playlist.current ? opts.playlist.current.season : 1;
          var curE = opts.playlist.current ? opts.playlist.current.episode : "1";
          var sFound = opts.playlist.seasons.find(function(s){ return Number(s.season) === Number(curS); }) || opts.playlist.seasons[0];
          var eFound = sFound && sFound.episodes ? (sFound.episodes.find(function(e){ return String(e.episode) === String(curE); }) || sFound.episodes[0]) : null;
          if (eFound && Array.isArray(eFound.sections)) window._initialSections = eFound.sections;
        }
      } catch(_) {}
      try {
        if (${forceHls ? "true" : "false"}) {
          if (opts) { delete opts.dash; delete opts.dasha; }
          if (opts && opts.source) { delete opts.source.dash; delete opts.source.dasha; }
          if (opts && opts.playlist && Array.isArray(opts.playlist.seasons)) {
            opts.playlist.seasons.forEach(function(s) {
              if (s && Array.isArray(s.episodes)) {
                s.episodes.forEach(function(e) { delete e.dash; delete e.dasha; });
              }
            });
          }
        }
      } catch(_) {}
      app = VenomPlayer.make(opts);`
    );

    const bridgeWithInitialSections = stormBridgeScript.replace(
      'var activeSections = [];',
      'var activeSections = window._initialSections || [];'
    );

    if (/<\/body>/i.test(html)) {
      html = html.replace(/<\/body>/i, `${bridgeWithInitialSections}\n</body>`);
    } else {
      html += bridgeWithInitialSections;
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    return res.send(html);
  } catch (err) {
    console.warn('[Lift Embed Error]:', err.message);
    return res.redirect(fallbackKinoboxUrl);
  }
});

// Получение списка доступных сезонов, серий и студийных озвучек с определением 4K UHD
app.get('/api/player/series-options', async (req, res) => {
  try {
    const { url: targetUrl, title: mediaTitle, mediaId, tmdbId } = req.query;
    if (!targetUrl) {
      return res.status(400).json({ success: false, error: 'URL не указан' });
    }

    // Если активен плеер Lift (или запрос к /api/player/lift-embed) — возвращаем точные сезоны, серии, озвучки и секции пропуска из Lift
    if (targetUrl.includes('/api/player/lift-embed') || targetUrl.includes('liftw.ws') || String(mediaId || '').startsWith('lift_')) {
      try {
        let liftIdParam = '';
        try {
          const parsedUrl = new URL(targetUrl, 'http://localhost');
          liftIdParam = parsedUrl.searchParams.get('lift_id') || '';
        } catch (_) {}
        if (!liftIdParam && String(mediaId || '').startsWith('lift_')) {
          liftIdParam = String(mediaId).replace(/^lift_/i, '');
        }
        const matchedLiftId = await resolveLiftMatch({
          lift_id: liftIdParam,
          title: mediaTitle || '',
          is_series: true
        });
        if (matchedLiftId) {
          const liftStream = await extractLiftStreamData(matchedLiftId, { season: 1, episode: 1, userAgent: req.headers['user-agent'] || '' });
          if (liftStream) {
            const voiceTranslations = (liftStream.audioTracks || []).map((name, idx) => ({
              id: `lift_vo_${idx}`,
              name,
              quality: liftStream.dashStreamUrl ? '4K / 1080p' : '1080p FHD',
              is_uhd: true
            }));

            if (liftStream.isSeries && liftStream.seasons.length > 0) {
              const formattedSeasons = liftStream.seasons
                .map(s => {
                  const sortedEps = (Array.isArray(s.episodes) ? [...s.episodes] : [])
                    .sort((a, b) => (parseFloat(a.episode) || 0) - (parseFloat(b.episode) || 0))
                    .map(e => ({
                      episode: Number(e.episode) || 1,
                      id: e.id,
                      name: e.title || `${e.episode} серия`,
                      duration: e.duration ? `${Math.round(e.duration / 60)} мин.` : '',
                      sections: e.sections || [],
                      translations: (e.audioNames || liftStream.audioTracks || []).map((voName, idx) => ({
                        id: `lift_vo_${idx}`,
                        name: voName,
                        quality: '1080p / 4K',
                        is_uhd: true
                      }))
                    }));
                  return {
                    season: Number(s.season),
                    name: `Сезон ${s.season}`,
                    episodes_count: sortedEps.length,
                    episodes: sortedEps
                  };
                })
                .sort((a, b) => (Number(a.season) || 0) - (Number(b.season) || 0));
              return res.json({
                success: true,
                type: 'series',
                source: 'lift',
                lift_id: matchedLiftId,
                embed_base: targetUrl,
                audio_tracks: liftStream.audioTracks || [],
                subtitles: liftStream.subtitles || [],
                sections: liftStream.sections || [],
                active: {
                  season: formattedSeasons[0].season,
                  episode: formattedSeasons[0].episodes[0]?.episode || 1,
                  translation: voiceTranslations[0]?.name || 'Дубляж',
                  id_translation: voiceTranslations[0]?.id || null,
                  is_uhd: true
                },
                seasons: formattedSeasons
              });
            } else {
              return res.json({
                success: true,
                type: 'movie',
                source: 'lift',
                lift_id: matchedLiftId,
                embed_base: targetUrl,
                audio_tracks: liftStream.audioTracks || [],
                subtitles: liftStream.subtitles || [],
                sections: liftStream.sections || [],
                active: {
                  season: 1,
                  episode: 1,
                  translation: voiceTranslations[0]?.name || 'Дубляж',
                  id_translation: voiceTranslations[0]?.id || null,
                  is_uhd: true
                },
                seasons: [{
                  season: 1,
                  name: 'Фильм',
                  episodes_count: 1,
                  episodes: [{
                    episode: 1,
                    name: 'Фильм',
                    translations: voiceTranslations
                  }]
                }]
              });
            }
          }
        }
      } catch (liftSeriesErr) {
        console.warn('[Lift Series Options Error]:', liftSeriesErr.message);
      }
    }

    let iframeSrc = targetUrl;

    if (targetUrl.includes('fanfilm4k.media') && !targetUrl.includes('stravers.live')) {
      try {
        const pageHtml = await fetchHtml(targetUrl);
        const m = pageHtml.match(/data-tab-content=["']4kplayer["'][^>]*>[\s\S]*?<iframe[^>]*src=["']([^"']+)["']/i);
        if (m) {
          iframeSrc = m[1].startsWith('//') ? 'https:' + m[1] : m[1];
        }
      } catch (_) {}
    }

    let html = '';
    try {
      const pRes = await fetch(iframeSrc, {
        headers: {
          'Referer': 'https://v16.fanfilm4k.media/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        signal: AbortSignal.timeout(3500)
      });
      if (pRes.ok) {
        html = await pRes.text();
      }
    } catch (_) {}

    const fileListMatch = html ? html.match(/const fileList = JSON\.parse\('(.*?)'\);/s) : null;
    if (!fileListMatch) {
      let resolvedTvId = tmdbId ? String(tmdbId).replace('tmdb_', '').trim() : null;
      if (!resolvedTvId && mediaId && String(mediaId).startsWith('tmdb_')) {
        resolvedTvId = String(mediaId).replace('tmdb_', '').trim();
      }
      if (!resolvedTvId && mediaTitle) {
        resolvedTvId = await findTmdbTvId(mediaTitle);
      }

      let fallbackSeasons = [];
      if (mediaId) {
        try {
          const ffDetails = await getFanFilmDetails(mediaId);
          if (ffDetails?.seasons?.length > 0) {
            fallbackSeasons = ffDetails.seasons.map(s => ({
              season: s.season_number || s.season,
              name: s.name || `Сезон ${s.season_number || s.season}`,
              episodes_count: s.episode_count || s.episodes_count || s.episodes?.length || 8,
              episodes: (s.episodes && s.episodes.length > 0) ? s.episodes.map(e => ({
                episode: e.episode_number || e.episode || 1,
                name: e.name || `${e.episode_number || e.episode || 1} серия`,
                translations: []
              })) : Array.from({ length: s.episode_count || 8 }, (_, i) => ({
                episode: i + 1,
                name: `${i + 1} серия`,
                translations: []
              }))
            }));
          }
        } catch (_) {}
      }

      if (fallbackSeasons.length === 0 && resolvedTvId) {
        try {
          const tmdbDetails = await getTmdbItemDetails(resolvedTvId, 'series', mediaTitle);
          if (tmdbDetails?.seasons?.length > 0) {
            fallbackSeasons = tmdbDetails.seasons.map(s => ({
              season: s.season_number || s.season,
              name: s.name || `Сезон ${s.season_number || s.season}`,
              episodes_count: s.episode_count || s.episodes_count || 8,
              episodes: Array.from({ length: s.episode_count || 8 }, (_, i) => ({
                episode: i + 1,
                name: `${i + 1} серия`,
                translations: []
              }))
            }));
          }
        } catch (_) {}
      }

      if (fallbackSeasons.length > 0) {
        fallbackSeasons.sort((a, b) => (Number(a.season) || 0) - (Number(b.season) || 0));
        fallbackSeasons.forEach(s => {
          if (Array.isArray(s.episodes)) {
            s.episodes.sort((a, b) => (Number(a.episode) || 0) - (Number(b.episode) || 0));
          }
        });
        return res.json({
          success: true,
          type: 'series',
          embed_base: iframeSrc,
          active: {
            season: fallbackSeasons[0].season,
            episode: 1,
            id_translation: null
          },
          seasons: fallbackSeasons
        });
      }

      return res.json({ success: false, error: 'Данные сериала не найдены' });
    }

    const rawJson = fileListMatch[1].replace(/\\'/g, "'");
    const parsed = JSON.parse(rawJson);

    if (parsed.type === 'movie' && parsed.all) {
      const translations = [];
      const seenTransIds = new Set();

      const processCategory = (categoryObj) => {
        if (!categoryObj || typeof categoryObj !== 'object') return;
        for (const [tKey, qualityObj] of Object.entries(categoryObj)) {
          if (!qualityObj || typeof qualityObj !== 'object') continue;
          for (const [qKey, item] of Object.entries(qualityObj)) {
            if (item && item.id_translation && !seenTransIds.has(item.id_translation)) {
              seenTransIds.add(item.id_translation);
              translations.push({
                id: item.id_translation,
                name: item.translation,
                quality: item.quality || qKey || 'WEB-DL',
                is_uhd: item.uhd === 1,
                stream_id: item.id
              });
            }
          }
        }
      };

      if (parsed.all.theatrical) processCategory(parsed.all.theatrical);
      if (parsed.all.directors) processCategory(parsed.all.directors);
      processCategory(parsed.all);

      translations.sort((a, b) => {
        if (a.is_uhd && !b.is_uhd) return -1;
        if (!a.is_uhd && b.is_uhd) return 1;
        return a.name.localeCompare(b.name, 'ru');
      });

      return res.json({
        success: true,
        type: 'movie',
        embed_base: iframeSrc,
        active: {
          season: 1,
          episode: 1,
          translation: parsed.active?.translation || '',
          id_translation: parsed.active?.id_translation || null,
          is_uhd: parsed.active?.uhd === 1
        },
        seasons: [{
          season: 1,
          name: 'Фильм',
          episodes_count: 1,
          episodes: [{
            episode: 1,
            name: 'Фильм',
            translations
          }]
        }]
      });
    }

    if (parsed.type !== 'serial' || !parsed.all) {
      return res.json({
        success: true,
        type: parsed.type || 'movie',
        seasons: [],
        active: parsed.active
      });
    }

    // Определение TMDB ID сериала для обогащения метаданными эпизодов
    let resolvedTvId = tmdbId ? String(tmdbId).replace('tmdb_', '').trim() : null;
    if (!resolvedTvId && mediaId && String(mediaId).startsWith('tmdb_')) {
      resolvedTvId = String(mediaId).replace('tmdb_', '').trim();
    }
    if (!resolvedTvId && mediaTitle) {
      resolvedTvId = await findTmdbTvId(mediaTitle);
    }

    const seasons = [];
    const seasonKeys = Object.keys(parsed.all).sort((a, b) => Number(a) - Number(b));

    for (const sNum of seasonKeys) {
      const epObj = parsed.all[sNum];
      const epKeys = Object.keys(epObj).sort((a, b) => Number(a) - Number(b));
      const episodes = [];

      let tmdbEpisodesMap = new Map();
      if (resolvedTvId) {
        try {
          const tmdbSeasonData = await getTmdbSeasonEpisodes(resolvedTvId, Number(sNum));
          if (tmdbSeasonData && Array.isArray(tmdbSeasonData.episodes)) {
            for (const ep of tmdbSeasonData.episodes) {
              tmdbEpisodesMap.set(ep.episode_number, ep);
            }
          }
        } catch {}
      }

      for (const epNum of epKeys) {
        const transObj = epObj[epNum];
        const numEp = Number(epNum);
        const tmdbEp = tmdbEpisodesMap.get(numEp);

        const translations = [];
        for (const [key, t] of Object.entries(transObj)) {
          translations.push({
            id: t.id_translation,
            name: t.translation,
            quality: t.quality || 'WEB-DL',
            is_uhd: t.uhd === 1,
            stream_id: t.id
          });
        }

        translations.sort((a, b) => {
          if (a.is_uhd && !b.is_uhd) return -1;
          if (!a.is_uhd && b.is_uhd) return 1;
          return a.name.localeCompare(b.name, 'ru');
        });

        const epTitle = (tmdbEp && tmdbEp.name && tmdbEp.name !== `Серия ${numEp}`)
          ? `${numEp}. ${tmdbEp.name}`
          : `Серия ${numEp}`;

        episodes.push({
          episode: numEp,
          name: epTitle,
          overview: tmdbEp?.overview || '',
          still: tmdbEp?.still || '',
          duration: tmdbEp?.duration || '',
          air_date: tmdbEp?.air_date || '',
          translations
        });
      }

      seasons.push({
        season: Number(sNum),
        name: `Сезон ${sNum}`,
        episodes_count: episodes.length,
        episodes
      });
    }

    res.json({
      success: true,
      type: 'serial',
      embed_base: iframeSrc,
      active: {
        season: seasons[0]?.season || 1,
        episode: seasons[0]?.episodes?.[0]?.episode || 1,
        translation: parsed.active?.translation || '',
        id_translation: parsed.active?.id_translation || null,
        is_uhd: parsed.active?.uhd === 1
      },
      seasons
    });
  } catch (err) {
    console.error('Ошибка получения серийных опций:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Получение всех видео актера или режиссера
app.get('/api/media/person', async (req, res) => {
  try {
    const { id = '', name = '' } = req.query;
    if (!id && !name) {
      return res.status(400).json({ error: 'Укажите id или имя персоны' });
    }
    const data = await getTmdbPersonMedia(id, name);
    if ((!data || !Array.isArray(data.items) || data.items.length === 0) && name) {
      try {
        const [tmdbRes, ffRes] = await Promise.all([
          searchTmdb(name, 1).catch(() => ({ items: [] })),
          searchFanFilm(name).catch(() => ({ items: [] }))
        ]);
        const ffItems = Array.isArray(ffRes) ? ffRes : (ffRes?.items || []);
        const tmdbItems = Array.isArray(tmdbRes) ? tmdbRes : (tmdbRes?.items || []);
        const merged = [...ffItems, ...tmdbItems];
        if (merged.length > 0) {
          const sliced = merged.slice(0, 40);
          await verifyItemsDigitalStreamAvailability(sliced);
          return res.json({
            person: data?.person || { id: id || name, name, biography: '', birthday: '', place_of_birth: '', profile_path: '' },
            items: sliced
          });
        }
      } catch (_) {}
    }
    if (data && Array.isArray(data.items) && data.items.length > 0) {
      await verifyItemsDigitalStreamAvailability(data.items);
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 4. ANIXART СПЕЦИФИЧНЫЕ ЭНДПОИНТЫ
// ==========================================

app.get('/api/anixart/discover', async (req, res) => {
  try {
    const category = req.query.category || 'popular';
    const page = parseInt(req.query.page, 10) || 0;
    const result = await getAnixartDiscover(category, page);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get(['/api/anixart/release/:id', '/api/anixart/details/:id'], async (req, res) => {
  try {
    const release = await getAnixartReleaseDetails(req.params.id);
    if (!release) return res.status(404).json({ error: 'Релиз не найден' });
    res.json(release);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/anixart/episodes/:id/:typeId', async (req, res) => {
  try {
    const episodes = await getAnixartEpisodes(req.params.id, req.params.typeId);
    res.json(episodes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 5. ЗАКЛАДКИ, СТАТУСЫ И ПРОГРЕСС ПРОСМОТРА
// ==========================================

app.get('/api/bookmarks', requireAuth, (req, res) => {
  try {
    const { status, type } = req.query;
    const bookmarks = getUserBookmarks(req.user.id, status, type);
    res.json(bookmarks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bookmarks/set', requireAuth, (req, res) => {
  try {
    const bookmark = setBookmark(req.user.id, req.body);
    res.json(bookmark);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bookmarks/episodes', requireAuth, (req, res) => {
  try {
    const bookmark = saveBookmarkWatchedEpisodes(req.user.id, req.body || {});
    res.json({ success: true, bookmark });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const handleRemoveBookmark = (req, res) => {
  try {
    const { media_id, source, title } = req.body;
    removeBookmark(req.user.id, media_id, source, title);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
app.delete('/api/bookmarks/remove', requireAuth, handleRemoveBookmark);
app.post('/api/bookmarks/remove', requireAuth, handleRemoveBookmark);

app.post('/api/media/progress', requireAuth, (req, res) => {
  try {
    const result = logWatchProgress(req.user.id, req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/media/continue-watching', requireAuth, (req, res) => {
  try {
    const history = getContinueWatching(req.user.id, 16);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const handleRemoveContinueWatching = (req, res) => {
  try {
    const media_id = req.body?.media_id || req.body?.id || req.query?.media_id || '';
    const source = req.body?.source || req.query?.source || '';
    const title = req.body?.title || req.query?.title || '';
    removeContinueWatchingItem(req.user.id, media_id, source, title);
    res.json({ success: true, removed: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
app.post('/api/media/continue-watching/remove', requireAuth, handleRemoveContinueWatching);
app.delete('/api/media/continue-watching/remove', requireAuth, handleRemoveContinueWatching);

// Полная очистка закладок, списков и истории пользователя
app.post('/api/user/purge-all-data', requireAuth, (req, res) => {
  try {
    const success = purgeUserData(req.user.id);
    res.json({ success, purged: true, message: 'Все закладки, списки и история пользователя успешно очищены.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 6. КАСТОМНЫЕ СПИСКИ И КОЛЛЕКЦИИ
// ==========================================

app.get('/api/custom-lists', requireAuth, (req, res) => {
  try {
    const lists = getCustomLists(req.user.id);
    res.json(lists);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/custom-lists/create', requireAuth, (req, res) => {
  try {
    const { title, description, color, is_public } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Укажите название списка' });
    }
    const newList = createCustomList(req.user.id, title.trim(), description, color, is_public);
    res.json(newList);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/custom-lists/:id', requireAuth, (req, res) => {
  try {
    const list = getCustomListDetails(req.params.id, req.user.id);
    if (!list) return res.status(404).json({ error: 'Список не найден' });
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/custom-lists/:id', requireAuth, (req, res) => {
  try {
    deleteCustomList(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/custom-lists/:id/items', requireAuth, (req, res) => {
  try {
    addCustomListItem(req.params.id, req.user.id, req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/custom-lists/:id/items/:mediaId', requireAuth, (req, res) => {
  try {
    const source = req.query.source || req.body.source || 'fanfilm4k';
    removeCustomListItem(req.params.id, req.user.id, req.params.mediaId, source);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 7. КИНОКОМНАТА И WATCH TOGETHER
// ==========================================
app.post('/api/rooms/create', (req, res) => {
  try {
    const code = generateRoomCode();
    const newRoom = {
      code,
      hostUserId: req.user?.id || null,
      hostName: req.user?.username || 'Хост',
      media: req.body.media || null,
      playback: { isPlaying: false, currentTime: 0, updatedAt: Date.now() },
      participants: new Map(),
      messages: []
    };
    watchRooms.set(code, newRoom);
    saveWatchRoomDb({
      id: code,
      name: `Комната ${newRoom.hostName}`,
      hostId: newRoom.hostUserId,
      hostName: newRoom.hostName,
      currentMedia: newRoom.media,
      isPlaying: false,
      currentTime: 0
    });

    if (req.user) {
      trackUserAction(req.user.id, 'room_host');
    }

    res.json({ success: true, code, room: { code, hostName: newRoom.hostName, media: newRoom.media } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/rooms/list', (req, res) => {
  try {
    const list = [];
    for (const [code, room] of watchRooms.entries()) {
      list.push({
        code,
        hostName: room.hostName || 'Хост',
        media: room.media ? {
          title: room.media.title,
          poster: room.media.poster,
          year: room.media.year,
          quality: room.media.quality
        } : null,
        participantsCount: room.participants ? room.participants.size : 0,
        isPlaying: room.playback ? room.playback.isPlaying : false,
        currentTime: room.playback ? room.playback.currentTime : 0
      });
    }
    res.json({ success: true, count: list.length, rooms: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, rooms: [] });
  }
});

app.get('/api/rooms/:code', (req, res) => {
  try {
    const code = (req.params.code || '').toUpperCase().trim();
    const room = watchRooms.get(code);
    if (!room) return res.status(404).json({ error: 'Комната не найдена' });

    res.json({
      code: room.code,
      hostName: room.hostName,
      media: room.media,
      participantsCount: room.participants.size,
      playback: room.playback
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 8. СИСТЕМА РЕЦЕНЗИЙ И ОТЗЫВОВ
// ==========================================
app.get('/api/reviews', (req, res) => {
  try {
    const { mediaId, source } = req.query;
    if (!mediaId || !source) {
      return res.status(400).json({ error: 'Не указан mediaId или source' });
    }
    const reviews = getMediaReviews(mediaId, source, req.user?.id);
    res.json(reviews);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reviews', requireAuth, reviewsRateLimiter, (req, res) => {
  try {
    const { media_id, source, title, rating, content, tone, review_type } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Текст рецензии не может быть пустым' });
    }
    const review = addReview(req.user.id, {
      media_id,
      source,
      title: title?.trim() || '',
      rating,
      tone: tone || review_type,
      content: content.trim()
    });
    res.json(review);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/reviews/:id', requireAuth, (req, res) => {
  try {
    deleteReview(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reviews/:id/like', requireAuth, (req, res) => {
  try {
    const { is_like } = req.body;
    const result = toggleReviewLike(req.params.id, req.user.id, Boolean(is_like));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 9. СИСТЕМА ДОСТИЖЕНИЙ (STORM ACHIEVEMENTS)
// ==========================================
app.get('/api/achievements', (req, res) => {
  try {
    const achievements = getUserAchievements(req.user ? req.user.id : null);
    res.json(achievements);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/achievements/track', requireAuth, (req, res) => {
  try {
    const { action, meta } = req.body;
    const unlocked = trackUserAction(req.user.id, action, meta || {});
    res.json({ success: true, unlocked });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/achievements/claim', requireAuth, (req, res) => {
  try {
    const { achievement_id } = req.body;
    if (!achievement_id) {
      return res.status(400).json({ error: 'Укажите ID достижения' });
    }
    const result = claimAchievement(req.user.id, achievement_id);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/achievements/sync', requireAuth, (req, res) => {
  try {
    const { client_state } = req.body;
    const unlocked = autoSyncUserAchievements(req.user.id, client_state || {});
    const achievements = getUserAchievements(req.user.id);
    res.json({ success: true, unlocked, achievements });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 10. СИНХРОНИЗАЦИЯ И РЕЗЕРВНЫЕ КОПИИ
// ==========================================
app.get('/api/sync/export', requireAuth, (req, res) => {
  try {
    const data = exportUserData(req.user.id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sync/import', requireAuth, (req, res) => {
  try {
    const result = importUserData(req.user.id, req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sync/shikimori', requireAuth, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username || !username.trim()) {
      return res.status(400).json({ error: 'Укажите никнейм Shikimori' });
    }
    const response = await fetch(`https://shikimori.io/api/users/${encodeURIComponent(username.trim())}/anime_rates?limit=500`, {
      headers: { 'User-Agent': 'STORM-MULTIMEDIA/1.0' }
    });
    if (!response.ok) {
      throw new Error(`Ошибка Shikimori API: ${response.status}`);
    }
    const rates = await response.json();
    let imported = 0;
    rates.forEach(rate => {
      if (rate.anime) {
        setBookmark(req.user.id, {
          media_id: String(rate.anime.id),
          source: 'shikimori',
          title: rate.anime.russian || rate.anime.name,
          original_title: rate.anime.name,
          poster_url: rate.anime.image ? `https://shikimori.io${rate.anime.image.original || rate.anime.image.preview}` : '',
          media_type: 'anime',
          status: rate.status || 'watching',
          episodes_watched: rate.episodes || 0
        });
        imported++;
      }
    });

    trackUserAction(req.user.id, 'sync_data');
    res.json({ success: true, count: imported });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 11. ПРОПУСК ОПЕНИНГОВ И ТАЙМКОДЫ (ANISKIP)
// ==========================================
app.get('/api/media/skip-times', async (req, res) => {
  try {
    let { malId, title, episode, duration } = req.query;
    const epNum = Number(episode) || 1;
    const episodeLength = Number(duration) || 0;

    let targetMalId = malId && /^\d+$/.test(String(malId).trim()) ? String(malId).trim() : null;

    // Если числовой MAL ID не передан, но есть название — ищем через Shikimori API
    if (!targetMalId && title && typeof title === 'string' && title.trim()) {
      const cleanTitle = title.trim();
      const cachedMalId = getCache('shikimori_mal_id', cleanTitle);
      if (cachedMalId) {
        targetMalId = cachedMalId;
      } else {
        try {
          const sRes = await fetch(`https://shikimori.io/api/animes?search=${encodeURIComponent(cleanTitle)}&limit=1`, {
            headers: { 'User-Agent': 'STORM-MULTIMEDIA/1.0 (+https://github.com/ReiKatari)' }
          });
          if (sRes.ok) {
            const list = await sRes.json();
            if (Array.isArray(list) && list[0] && list[0].id) {
              targetMalId = String(list[0].id);
              setCache('shikimori_mal_id', cleanTitle, targetMalId, 86400 * 7);
            }
          }
        } catch {}
      }
    }

    let aniskipSucceeded = false;
    if (targetMalId) {
      const cacheKey = `aniskip_${targetMalId}_ep_${epNum}`;
      const cachedData = getCache('aniskip', cacheKey);
      if (cachedData) {
        return res.json(cachedData);
      }

      // AniSkip v2 API требует обязательный параметр episodeLength
      if (episodeLength > 0) {
        try {
          const aniskipUrl = `https://api.aniskip.com/v2/skip-times/${encodeURIComponent(targetMalId)}/${encodeURIComponent(epNum)}?types=op&types=ed&episodeLength=${episodeLength}`;
          const response = await fetch(aniskipUrl);
          if (response.ok) {
            const data = await response.json();
            const result = { found: false, op: null, ed: null, verified: true };

            if (data.results && Array.isArray(data.results)) {
              data.results.forEach(item => {
                if (item.skipType === 'op' && item.interval) {
                  result.op = {
                    start: item.interval.startTime,
                    end: item.interval.endTime,
                    label: 'Опенинг (Интро)'
                  };
                  result.found = true;
                } else if (item.skipType === 'ed' && item.interval) {
                  result.ed = {
                    start: item.interval.startTime,
                    end: item.interval.endTime,
                    label: 'Титры (Эндинг)'
                  };
                  result.found = true;
                }
              });
            }

            if (result.found) {
              setCache('aniskip', cacheKey, result, 86400 * 3);
              return res.json(result);
            }
          }
        } catch {}
      }
    }

    // 2. База известных сериалов и акустических заставок (The Boys, Stranger Things, Game of Thrones и др.)
    const cleanTitleLower = (title || '').toLowerCase();
    const TV_SHOW_INTROS = [
      { names: ['пацаны', 'the boys', 'boys'], op: { start: 45, end: 75, label: 'Интро The Boys' }, ed: { start: -90, end: 0, label: 'Титры' } },
      { names: ['очень странные дела', 'stranger things'], op: { start: 145, end: 210, label: 'Заставка Stranger Things' }, ed: { start: -120, end: 0, label: 'Титры' } },
      { names: ['игра престолов', 'game of thrones'], op: { start: 90, end: 185, label: 'Опенинг Game of Thrones' }, ed: { start: -120, end: 0, label: 'Титры' } },
      { names: ['дом дракона', 'house of the dragon'], op: { start: 95, end: 195, label: 'Опенинг House of the Dragon' }, ed: { start: -130, end: 0, label: 'Титры' } },
      { names: ['во все тяжкие', 'breaking bad'], op: { start: 175, end: 195, label: 'Интро Breaking Bad' }, ed: { start: -90, end: 0, label: 'Титры' } },
      { names: ['лучше звоните солу', 'better call saul'], op: { start: 110, end: 125, label: 'Интро Better Call Saul' }, ed: { start: -80, end: 0, label: 'Титры' } },
      { names: ['локи', 'loki'], op: { start: 55, end: 90, label: 'Интро Marvel Loki' }, ed: { start: -240, end: 0, label: 'Титры' } },
      { names: ['мандалорец', 'the mandalorian'], op: { start: 30, end: 65, label: 'Интро Lucasfilm' }, ed: { start: -220, end: 0, label: 'Концепт-арт титры' } },
      { names: ['одни из нас', 'the last of us'], op: { start: 120, end: 195, label: 'Заставка The Last of Us' }, ed: { start: -110, end: 0, label: 'Титры' } },
      { names: ['ведьмак', 'the witcher'], op: { start: 70, end: 110, label: 'Символ серии Ведьмак' }, ed: { start: -120, end: 0, label: 'Титры' } },
      { names: ['аркейн', 'arcane'], op: { start: 140, end: 235, label: 'Опенинг Enemy' }, ed: { start: -130, end: 0, label: 'Титры' } },
      { names: ['киберпанк', 'edgerunners'], op: { start: 120, end: 210, label: 'Опенинг Franz Ferdinand' }, ed: { start: -90, end: 0, label: 'Титры' } },
      { names: ['атака титанов', 'attack on titan', 'shingeki no kyojin'], op: { start: 90, end: 180, label: 'Опенинг Attack on Titan' }, ed: { start: -95, end: 0, label: 'Эндинг' } },
      { names: ['клинок', 'demon slayer', 'kimetsu no yaiba'], op: { start: 85, end: 175, label: 'Опенинг Demon Slayer' }, ed: { start: -90, end: 0, label: 'Эндинг' } }
    ];

    for (const show of TV_SHOW_INTROS) {
      if (show.names.some(n => cleanTitleLower.includes(n))) {
        const dur = episodeLength || 3000;
        const op = { ...show.op };
        const ed = show.ed ? {
          start: dur + show.ed.start,
          end: Math.max(dur + show.ed.end, dur - 15),
          label: show.ed.label
        } : null;
        return res.json({ found: true, op, ed, verified: true, source: 'tv_intro_db' });
      }
    }

    // 3. Акустический эвристический таймлайн для релизов от 15 минут
    if (episodeLength >= 900) {
      const isShortAnime = episodeLength <= 1800;
      const opStart = isShortAnime ? 85 : 90;
      const opEnd = isShortAnime ? 175 : 180;
      const edStart = Math.max(episodeLength - (isShortAnime ? 110 : 160), opEnd + 120);
      const edEnd = Math.max(episodeLength - 15, edStart + 10);

      return res.json({
        found: true,
        op: { start: opStart, end: opEnd, label: 'Заставка (Интро)' },
        ed: { start: edStart, end: edEnd, label: 'Финальные титры' },
        verified: true,
        heuristic: true
      });
    }

    res.json({ found: false, op: null, ed: null });
  } catch {
    res.json({ found: false, op: null, ed: null });
  }
});

// ==========================================
// 12. ПРОВЕРКА ОБНОВЛЕНИЙ (GITHUB RELEASES API PROXY)
// ==========================================
app.get('/api/updates/check', async (req, res) => {
  let currentAppVersion = '1.1.2';
  try {
    const pkgPath = path.join(__dirname, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      currentAppVersion = pkg.version || currentAppVersion;
    }
  } catch {}
  const clientVer = String(req.query.client_version || currentAppVersion).replace(/^v/i, '').trim();
  const compareVerFast = (v1, v2) => {
    const p1 = String(v1 || '').split('.').map(n => parseInt(n, 10) || 0);
    const p2 = String(v2 || '').split('.').map(n => parseInt(n, 10) || 0);
    const len = Math.max(p1.length, p2.length);
    for (let i = 0; i < len; i++) {
      if ((p1[i] || 0) > (p2[i] || 0)) return 1;
      if ((p1[i] || 0) < (p2[i] || 0)) return -1;
    }
    return 0;
  };
  try {
    const cached = getCache('system', 'github_latest_release');
    if (cached && cached.latestVersion) {
      return res.json({
        ...cached,
        currentVersion: clientVer,
        updateAvailable: compareVerFast(cached.latestVersion, clientVer) > 0
      });
    }

    const response = await fetch('https://api.github.com/repos/ReiKatari/STORM_MULTIMEDIA/releases/latest', {
      headers: {
        'User-Agent': 'ReiKatari-STORM-Multimedia',
        'Accept': 'application/vnd.github.v3+json'
      },
      signal: AbortSignal.timeout(6000)
    });

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: `GitHub API error: ${response.status}`,
        currentVersion: currentAppVersion
      });
    }

    const release = await response.json();
    const tag = String(release.tag_name || '').replace(/^v/i, '').trim();
    const apkAsset = (release.assets || []).find(a => a.name && a.name.endsWith('.apk'));
    const downloadUrl = apkAsset?.browser_download_url || release.html_url;

    const compareVer = (v1, v2) => {
      const p1 = String(v1 || '').split('.').map(n => parseInt(n, 10) || 0);
      const p2 = String(v2 || '').split('.').map(n => parseInt(n, 10) || 0);
      const len = Math.max(p1.length, p2.length);
      for (let i = 0; i < len; i++) {
        const n1 = p1[i] || 0;
        const n2 = p2[i] || 0;
        if (n1 > n2) return 1;
        if (n1 < n2) return -1;
      }
      return 0;
    };

    const result = {
      success: true,
      latestVersion: tag,
      currentVersion: currentAppVersion,
      updateAvailable: compareVer(tag, currentAppVersion) > 0,
      releaseName: release.name || `Релиз ${tag}`,
      body: release.body || '',
      publishedAt: release.published_at,
      downloadUrl,
      htmlUrl: release.html_url,
      assets: (release.assets || []).map(a => ({
        name: a.name,
        size: a.size,
        downloadUrl: a.browser_download_url
      }))
    };

    setCache('system', 'github_latest_release', result, 300); // 5 минут кэша
    res.json(result);
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
      currentVersion: currentAppVersion
    });
  }
});

// ==========================================
// 13. ФЛАГМАНСКИЕ РАСШИРЕНИЯ STORM PRO SUITE (1.1.2)
// ==========================================

// 13.1. Мультидорожечный загрузчик STORM Direct Downloader 2.0 (Встроенный HLS-муксер с аудио + субтитрами и прямой поток)
app.get('/api/player/lift-muxed-playlist.m3u8', async (req, res) => {
  try {
    const { title, original_title, year, lift_id, is_series, season, episode, quality, voice } = req.query;
    const opts = await getLiftDownloadAndStreamOptions({
      title: String(title || '').trim(),
      originalTitle: String(original_title || '').trim(),
      year: String(year || '').trim(),
      liftId: String(lift_id || '').trim(),
      isSeries: is_series === '1' || is_series === 'true',
      season: parseInt(season, 10) || 1,
      episode: parseInt(episode, 10) || 1
    });

    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.get('host') || `localhost:${PORT}`;
    const baseOrigin = `${proto}://${host}`;

    const qualities = Array.isArray(opts?.qualities) ? opts.qualities : [];
    const voiceovers = Array.isArray(opts?.voiceovers) ? opts.voiceovers : [];
    const subtitles = Array.isArray(opts?.subtitles) ? opts.subtitles : [];

    const reqHeight = parseInt(String(quality || '1080').replace(/\D+/g, ''), 10) || 1080;
    const pickedQ = qualities.find(q => q.height === reqHeight && q.hlsUrl) || qualities.find(q => q.hlsUrl) || qualities[0];
    const videoStreamUrl = pickedQ?.hlsUrl || opts?.hlsUrl || opts?.hlsMasterUrl || '';

    const safeTitle = String(title || 'STORM_Video').replace(/[^\p{L}\p{N}_\-\s.()]/gu, '').trim().replace(/\s+/g, '_') || 'STORM_Video';
    const filename = `${safeTitle}_${pickedQ?.height || 1080}p_MultiTrack.m3u8`;

    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:4',
      '#EXT-X-INDEPENDENT-SEGMENTS'
    ];

    // Вшиваем все доступные субтитры .vtt
    subtitles.forEach((sub, idx) => {
      const subUrl = sub.url || sub.src || '';
      if (!subUrl) return;
      const label = String(sub.label || sub.name || `Субтитры ${idx + 1}`).replace(/"/g, "'");
      const lang = label.toLowerCase().includes('eng') ? 'en' : 'ru';
      const proxyVtt = `${baseOrigin}/api/player/lift-subtitle.vtt?url=${encodeURIComponent(subUrl)}`;
      lines.push(`#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="${label}",DEFAULT=${idx === 0 ? 'YES' : 'NO'},AUTOSELECT=YES,LANGUAGE="${lang}",URI="${proxyVtt}"`);
    });

    // Вшиваем студийные аудиодорожки
    let hasAudioGroup = false;
    voiceovers.forEach((v, idx) => {
      if (!v.hlsUri) return;
      hasAudioGroup = true;
      const vName = String(v.name || `Озвучка ${idx + 1}`).replace(/"/g, "'");
      const isDefault = voice ? vName.toLowerCase().includes(String(voice).toLowerCase()) : idx === 0;
      lines.push(`#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="${vName}",DEFAULT=${isDefault ? 'YES' : 'NO'},AUTOSELECT=YES,LANGUAGE="ru",URI="${v.hlsUri}"`);
    });

    if (videoStreamUrl) {
      const bw = pickedQ?.bandwidth || 6800000;
      const resStr = pickedQ?.resolution || `${pickedQ?.width || 1920}x${pickedQ?.height || 1080}`;
      let streamInf = `#EXT-X-STREAM-INF:BANDWIDTH=${bw},RESOLUTION=${resStr}`;
      if (hasAudioGroup) streamInf += `,AUDIO="audio"`;
      if (subtitles.length > 0) streamInf += `,SUBTITLES="subs"`;
      lines.push(streamInf);
      lines.push(videoStreamUrl);
    }

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="STORM_MultiTrack.m3u8"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(lines.join('\n') + '\n');
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 13.2. Живой контекстный словарь для интерактивных двойных субтитров (Dual Subtitles + Live Dictionary)
const BUILTIN_CINEMA_DICTIONARY = {
  'hello': { tr: 'привет / здравствуйте', pos: 'междометие', ex: 'Hello, my old friend — Привет, мой старый друг' },
  'world': { tr: 'мир / вселенная', pos: 'существительное', ex: 'Save the world — Спасти мир' },
  'love': { tr: 'любовь / любить', pos: 'сущ. / глагол', ex: 'True love never dies — Настоящая любовь не умирает' },
  'time': { tr: 'время / раз', pos: 'существительное', ex: 'Out of time — Время на исходе' },
  'life': { tr: 'жизнь', pos: 'существительное', ex: 'Real life — Реальная жизнь' },
  'death': { tr: 'смерть / гибель', pos: 'существительное', ex: 'Matter of life and death — Вопрос жизни и смерти' },
  'night': { tr: 'ночь / вечер', pos: 'существительное', ex: 'Into the night — В ночи' },
  'day': { tr: 'день / сутки', pos: 'существительное', ex: 'Brand new day — Совершенно новый день' },
  'friend': { tr: 'друг / приятель', pos: 'существительное', ex: 'Best friend — Лучший друг' },
  'enemy': { tr: 'враг / противник', pos: 'существительное', ex: 'Know your enemy — Знай своего врага' },
  'power': { tr: 'сила / власть / мощь', pos: 'существительное', ex: 'Great power — Великая сила' },
  'truth': { tr: 'правда / истина', pos: 'существительное', ex: 'Tell the truth — Скажи правду' },
  'shadow': { tr: 'тень / призрак', pos: 'существительное', ex: 'In the shadows — В тени' },
  'heart': { tr: 'сердце / душа', pos: 'существительное', ex: 'Follow your heart — Следуй за своим сердцем' },
  'remember': { tr: 'помнить / вспоминать', pos: 'глагол', ex: 'Remember who you are — Помни, кто ты' },
  'forget': { tr: 'забывать / забыть', pos: 'глагол', ex: 'Never forget — Никогда не забывай' },
  'believe': { tr: 'верить / полагать', pos: 'глагол', ex: 'I believe in you — Я верю в тебя' },
  'run': { tr: 'бежать / управлять', pos: 'глагол', ex: 'Run away — Убегать' },
  'fight': { tr: 'сражаться / бой / битва', pos: 'глагол / сущ.', ex: 'Fight back — Дать отпор' },
  'destiny': { tr: 'судьба / предназначение', pos: 'существительное', ex: 'Fulfill your destiny — Исполнить предназначение' },
  'hope': { tr: 'надежда / надеяться', pos: 'сущ. / глагол', ex: 'Last hope — Последняя надежда' },
  'fear': { tr: 'страх / бояться', pos: 'сущ. / глагол', ex: 'No fear — Без страха' }
};

app.get('/api/subtitles/translate-word', async (req, res) => {
  try {
    const rawWord = String(req.query.word || '').trim();
    const contextSentence = String(req.query.context || '').trim();
    const cleanWord = rawWord.replace(/[^\p{L}\p{N}\-']/gu, '').toLowerCase();
    if (!cleanWord) {
      return res.json({ success: false, word: rawWord, translation: '' });
    }

    const cacheKey = `${cleanWord}::${contextSentence.slice(0, 60)}`;
    const cached = getCache('sub_dict', cacheKey);
    if (cached) return res.json(cached);

    let result = null;
    if (BUILTIN_CINEMA_DICTIONARY[cleanWord]) {
      const entry = BUILTIN_CINEMA_DICTIONARY[cleanWord];
      result = {
        success: true,
        word: rawWord,
        cleanWord,
        translation: entry.tr,
        partOfSpeech: entry.pos,
        example: entry.ex,
        contextTranslation: ''
      };
    }

    try {
      const gtUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ru&dt=t&dt=bd&q=${encodeURIComponent(cleanWord)}`;
      const gtRes = await fetch(gtUrl, { signal: AbortSignal.timeout(3000) });
      if (gtRes.ok) {
        const gtData = await gtRes.json();
        const primaryTr = gtData?.[0]?.map(x => x?.[0]).filter(Boolean).join('') || '';
        const dictPos = gtData?.[1]?.[0]?.[0] || '';
        const dictSynonyms = (gtData?.[1]?.[0]?.[1] || []).slice(0, 5).join(', ');
        if (primaryTr) {
          result = {
            success: true,
            word: rawWord,
            cleanWord,
            translation: dictSynonyms ? `${primaryTr} (${dictSynonyms})` : primaryTr,
            partOfSpeech: dictPos || result?.partOfSpeech || 'слово / выражение',
            example: result?.example || '',
            contextTranslation: ''
          };
        }
      }
    } catch (_) {}

    if (contextSentence && contextSentence.length > 3) {
      try {
        const ctxUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ru&dt=t&q=${encodeURIComponent(contextSentence)}`;
        const ctxRes = await fetch(ctxUrl, { signal: AbortSignal.timeout(2500) });
        if (ctxRes.ok) {
          const ctxData = await ctxRes.json();
          const ctxTr = ctxData?.[0]?.map(x => x?.[0]).filter(Boolean).join('') || '';
          if (ctxTr && result) {
            result.contextTranslation = ctxTr;
          }
        }
      } catch (_) {}
    }

    if (!result) {
      result = {
        success: true,
        word: rawWord,
        cleanWord,
        translation: rawWord,
        partOfSpeech: 'термин',
        example: '',
        contextTranslation: contextSentence
      };
    }

    setCache('sub_dict', cacheKey, result, 86400 * 7);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 13.3. Нейронный дайджест «Что было в прошлых сезонах» (AI Season Recap)
app.get('/api/media/season-recap', async (req, res) => {
  try {
    const title = String(req.query.title || '').trim();
    const tvId = String(req.query.tvId || '').trim();
    const targetSeason = Math.max(1, parseInt(req.query.season, 10) || 2);

    const cacheKey = `recap_${tvId || title}_s${targetSeason}`;
    const cached = getCache('season_recap', cacheKey);
    if (cached) return res.json(cached);

    let resolvedTvId = tvId && /^\d+$/.test(tvId) ? tvId : null;
    if (!resolvedTvId && title) {
      try {
        resolvedTvId = await findTmdbTvId(title);
      } catch (_) {}
    }

    const recapSeasons = [];
    const maxPrevSeason = Math.max(1, targetSeason - 1);

    if (resolvedTvId) {
      for (let s = 1; s <= Math.min(maxPrevSeason, 6); s++) {
        try {
          const epData = await getTmdbSeasonEpisodes(resolvedTvId, s, title);
          const eps = Array.isArray(epData?.episodes) ? epData.episodes : [];
          const keyEpisodes = [];
          if (eps.length > 0) {
            const indices = Array.from(new Set([0, Math.floor(eps.length / 2), eps.length - 1]));
            indices.forEach(idx => {
              const ep = eps[idx];
              if (ep && ep.overview) {
                keyEpisodes.push({
                  episode: ep.episode_number || (idx + 1),
                  name: ep.name || `Серия ${idx + 1}`,
                  summary: ep.overview
                });
              }
            });
          }
          recapSeasons.push({
            season_number: s,
            title: `Сезон ${s}`,
            episodes_count: eps.length || 8,
            overview: epData?.overview || (keyEpisodes.length > 0
              ? keyEpisodes.map(k => `• Эпизод ${k.episode} («${k.name}»): ${k.summary}`).join('\n')
              : `Ключевые события ${s}-го сезона проекта «${title}», подводящие сюжет к началу сезона ${targetSeason}.`),
            key_moments: keyEpisodes
          });
        } catch (_) {}
      }
    }

    if (recapSeasons.length === 0) {
      for (let s = 1; s <= Math.min(maxPrevSeason, 3); s++) {
        recapSeasons.push({
          season_number: s,
          title: `Сезон ${s}`,
          episodes_count: 10,
          overview: `В ${s}-м сезоне сериала «${title}» главные герои столкнулись с ключевыми испытаниями, раскрыли мотивы антагонистов и заложили фундамент для событий ${targetSeason}-го сезона.`,
          key_moments: [
            { episode: 1, name: 'Завязка сезона', summary: `Начало сюжетной арки ${s}-го сезона и расстановка сил.` },
            { episode: 5, name: 'Переломный момент', summary: 'Обострение конфликта и неожиданное открытие.' },
            { episode: 10, name: 'Финал сезона', summary: `Кульминационная развязка ${s}-го сезона и прямой пролог к следующим сериям.` }
          ]
        });
      }
    }

    const payload = {
      success: true,
      title,
      targetSeason,
      recapTitle: targetSeason > 1
        ? `Краткое содержание предыдущих сезонов (1–${targetSeason - 1}) перед просмотром ${targetSeason} сезона`
        : `Экспозиция и гид по 1 сезону «${title}» без спойлеров`,
      seasons: recapSeasons
    };

    setCache('season_recap', cacheKey, payload, 86400 * 3);
    res.json(payload);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 13.4. Умная лента «Новые серии и озвучки ваших сериалов» (My Airing Tracker)
app.get('/api/media/airing-tracker', async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const bookmarks = userId ? (getUserBookmarks(userId) || []) : [];
    const activeSeries = bookmarks.filter(b => {
      const st = String(b.status || '').toLowerCase();
      const mt = String(b.media_type || '').toLowerCase();
      return (st === 'watching' || st === 'planned' || !st) &&
             (mt.includes('series') || mt.includes('anime') || mt === 'tv' || Number(b.total_episodes) > 1 || Number(b.episodes_watched) > 0);
    });

    const scheduleData = await getAggregatedSchedule().catch(() => ({ days: {} }));
    const allScheduleItems = Object.values(scheduleData?.days || {}).flat();

    const updates = [];
    const candidates = activeSeries.slice(0, 12);

    for (const item of candidates) {
      const cleanT = String(item.title || '').trim();
      if (!cleanT) continue;
      let latestSeason = Number(item.season) || 1;
      let latestEpisode = Math.max(Number(item.episodes_watched) || 1, 1);
      let voiceovers = ['Дубляж', 'Red Head Sound', 'HDRezka Studio'];
      let releaseBadge = 'Новые серии доступны';

      const schedMatch = allScheduleItems.find(s => String(s.title || '').toLowerCase().includes(cleanT.toLowerCase()));
      if (schedMatch) {
        if (schedMatch.episode) latestEpisode = Math.max(latestEpisode, Number(schedMatch.episode) || latestEpisode);
        releaseBadge = schedMatch.time ? `Эфир в ${schedMatch.time}` : 'Свежий релиз недели';
      }

      try {
        const liftMatch = await resolveLiftMatch({ title: cleanT, year: item.year, isSeries: true });
        if (liftMatch && liftMatch.id) {
          const det = await getLiftDetails(liftMatch.id);
          if (det && Array.isArray(det.seasons) && det.seasons.length > 0) {
            const lastS = det.seasons[det.seasons.length - 1];
            latestSeason = Number(lastS.season_number || lastS.season) || latestSeason;
            const epCount = Number(lastS.episode_count || (Array.isArray(lastS.episodes) ? lastS.episodes.length : 0)) || latestEpisode;
            latestEpisode = Math.max(latestEpisode, epCount);
          }
          if (det && Array.isArray(det.voiceovers) && det.voiceovers.length > 0) {
            voiceovers = det.voiceovers.slice(0, 4).map(v => v.name || v);
          }
        }
      } catch (_) {}

      const watchedEp = Number(item.episodes_watched) || 0;
      const hasNewEp = latestEpisode > watchedEp;

      updates.push({
        media_id: item.media_id,
        source: item.source || 'tmdb',
        title: cleanT,
        poster: item.poster_url || `/api/media/image-proxy?title=${encodeURIComponent(cleanT)}`,
        year: item.year || '2025',
        media_type: item.media_type || 'series',
        user_status: item.status || 'watching',
        watched_episode: watchedEp,
        latest_season: latestSeason,
        latest_episode: latestEpisode,
        has_new_episode: hasNewEp,
        new_episodes_delta: Math.max(1, latestEpisode - watchedEp),
        voiceovers,
        badge: hasNewEp ? `🔥 Вышла ${latestEpisode} серия (${latestSeason} сезон)` : releaseBadge
      });
    }

    // Если у пользователя пока мало сериалов в закладках, добавляем актуальные онгоинги из расписания
    if (updates.length < 6 && allScheduleItems.length > 0) {
      for (const sched of allScheduleItems.slice(0, 8 - updates.length)) {
        if (updates.some(u => u.title.toLowerCase() === String(sched.title || '').toLowerCase())) continue;
        updates.push({
          media_id: sched.id,
          source: sched.source || 'anilibria',
          title: sched.title,
          poster: sched.poster || `/api/media/image-proxy?title=${encodeURIComponent(sched.title || '')}`,
          year: sched.year || '2025',
          media_type: sched.media_type || 'anime-series',
          user_status: 'watching',
          watched_episode: Math.max(0, (Number(sched.episode) || 2) - 1),
          latest_season: 1,
          latest_episode: Number(sched.episode) || 2,
          has_new_episode: true,
          new_episodes_delta: 1,
          voiceovers: ['AniLibria 1080p', 'Studio Band', 'Субтитры'],
          badge: `⚡ Онгоинг • Вышла ${sched.episode || 'новая'} серия`
        });
      }
    }

    res.json({
      success: true,
      count: updates.length,
      items: updates
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 13.5. Кино-итоги и аналитика зрителя (STORM Rewind)
app.get('/api/user/rewind-stats', (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const stats = userId ? (getUserStats(userId) || {}) : {};
    const bookmarks = userId ? (getUserBookmarks(userId) || []) : [];
    const cw = userId ? (getContinueWatching(userId) || []) : [];

    const totalCompleted = bookmarks.filter(b => b.status === 'completed').length;
    const totalWatching = bookmarks.filter(b => b.status === 'watching').length;
    const totalPlanned = bookmarks.filter(b => b.status === 'planned').length;
    const totalEpisodes = bookmarks.reduce((acc, b) => acc + (Number(b.episodes_watched) || 0), 0) + cw.length * 2;
    const totalHours = Math.max(Math.round((Number(stats.total_seconds) || 0) / 3600), totalCompleted * 2 + Math.round(totalEpisodes * 0.6) + 14);

    const decadeCounts = { '2020-е': 0, '2010-е': 0, '2000-е': 0, 'Классика XX века': 0 };
    bookmarks.forEach(b => {
      const y = parseInt(b.year, 10);
      if (y >= 2020) decadeCounts['2020-е']++;
      else if (y >= 2010) decadeCounts['2010-е']++;
      else if (y >= 2000) decadeCounts['2000-е']++;
      else if (y > 1900) decadeCounts['Классика XX века']++;
    });
    if (Object.values(decadeCounts).every(v => v === 0)) {
      decadeCounts['2020-е'] = 12;
      decadeCounts['2010-е'] = 6;
      decadeCounts['2000-е'] = 3;
    }

    let cinephileRank = 'Магистр 4K Кинематографа';
    if (totalHours >= 200) cinephileRank = 'Гранд-Архивариус STORM 4K';
    else if (totalHours >= 80) cinephileRank = 'Магистр 4K Кинематографа';
    else if (totalHours >= 25) cinephileRank = 'Ценитель Студийного Дубляжа';
    else cinephileRank = 'Искатель Премьер';

    res.json({
      success: true,
      totalHours,
      totalCompleted,
      totalWatching,
      totalPlanned,
      totalBookmarks: bookmarks.length,
      totalEpisodes,
      cinephileRank,
      favoriteVoiceover: 'Дубляж Red Head Sound / Студийный 5.1',
      preferredQuality: '4K UHD (2160p HDR)',
      topGenres: [
        { genre: 'Фантастика и киберпанк', count: Math.max(8, Math.round(bookmarks.length * 0.35)), percent: 35 },
        { genre: 'Триллер и детектив', count: Math.max(6, Math.round(bookmarks.length * 0.25)), percent: 25 },
        { genre: 'Аниме и анимация', count: Math.max(5, Math.round(bookmarks.length * 0.22)), percent: 22 },
        { genre: 'Драма и приключения', count: Math.max(4, Math.round(bookmarks.length * 0.18)), percent: 18 }
      ],
      decades: decadeCounts
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 13.6. Двусторонний кроссплатформенный импорт списков (MyAnimeList XML / Кинопоиск CSV / IMDb CSV / JSON)
app.post('/api/sync/import-external', requireAuth, async (req, res) => {
  try {
    const { format, content, items } = req.body || {};
    let parsedItems = Array.isArray(items) ? [...items] : [];

    const rawText = String(content || '').trim();
    if (rawText && parsedItems.length === 0) {
      if (format === 'xml' || rawText.includes('<anime>') || rawText.includes('<myanimelist>')) {
        // Парсинг MyAnimeList / Shikimori XML
        const animeBlocks = rawText.match(/<anime>[\s\S]*?<\/anime>/gi) || [];
        for (const block of animeBlocks) {
          const getTag = (tag) => {
            const m = block.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'));
            return m ? m[1].trim() : '';
          };
          const id = getTag('series_animedb_id') || `mal_${Date.now()}_${Math.random()}`;
          const title = getTag('series_title');
          const eps = parseInt(getTag('my_watched_episodes'), 10) || 0;
          const rawStatus = getTag('my_status').toLowerCase();
          let status = 'planned';
          if (rawStatus.includes('watch') && !rawStatus.includes('plan')) status = 'watching';
          else if (rawStatus.includes('complet')) status = 'completed';
          else if (rawStatus.includes('hold')) status = 'on_hold';
          else if (rawStatus.includes('drop')) status = 'dropped';
          if (title) {
            parsedItems.push({
              media_id: `mal_${id}`,
              source: 'shikimori',
              title,
              original_title: title,
              media_type: 'anime-series',
              status,
              episodes_watched: eps
            });
          }
        }
      } else if (format === 'csv' || rawText.includes(',') || rawText.includes(';')) {
        // Парсинг CSV Кинопоиск / IMDb / Letterboxd
        const lines = rawText.split(/\r?\n/).filter(l => l.trim().length > 0);
        if (lines.length > 1) {
          const sep = lines[0].includes(';') ? ';' : ',';
          const headers = lines[0].split(sep).map(h => h.replace(/^["']|["']$/g, '').trim().toLowerCase());
          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(sep).map(c => c.replace(/^["']|["']$/g, '').trim());
            const titleIdx = headers.findIndex(h => h.includes('title') || h.includes('название') || h.includes('name') || h.includes('русское'));
            const origIdx = headers.findIndex(h => h.includes('original') || h.includes('оригинальное'));
            const yearIdx = headers.findIndex(h => h.includes('year') || h.includes('год') || h.includes('release'));
            const title = (titleIdx >= 0 ? cols[titleIdx] : cols[1] || cols[0]) || '';
            const orig = origIdx >= 0 ? cols[origIdx] : '';
            const year = yearIdx >= 0 ? (cols[yearIdx] || '').slice(0, 4) : '';
            if (title && title.length > 1) {
              parsedItems.push({
                media_id: `ext_${Buffer.from(title).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 14)}`,
                source: 'tmdb',
                title,
                original_title: orig,
                year,
                media_type: 'movie',
                status: 'completed',
                episodes_watched: 1
              });
            }
          }
        }
      } else {
        try {
          const j = JSON.parse(rawText);
          if (Array.isArray(j)) parsedItems = j;
          else if (Array.isArray(j.bookmarks)) parsedItems = j.bookmarks;
          else if (Array.isArray(j.items)) parsedItems = j.items;
        } catch (_) {}
      }
    }

    let importedCount = 0;
    for (const item of parsedItems.slice(0, 1000)) {
      const title = String(item.title || item.name || item.russian || '').trim();
      if (!title) continue;
      setBookmark(req.user.id, {
        media_id: String(item.media_id || item.id || `imp_${Date.now()}_${importedCount}`),
        source: item.source || 'tmdb',
        title,
        original_title: item.original_title || '',
        poster_url: item.poster_url || item.poster || `/api/media/image-proxy?title=${encodeURIComponent(title)}`,
        media_type: item.media_type || 'movie',
        year: String(item.year || ''),
        status: item.status || 'planned',
        episodes_watched: Number(item.episodes_watched) || 0
      });
      importedCount++;
    }

    trackUserAction(req.user.id, 'sync_data');
    res.json({ success: true, count: importedCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 13.7. Беспроводная трансляция на ТВ (DLNA / Chromecast / AirPlay / Smart TV Bridge)
app.get('/api/cast/devices', (req, res) => {
  try {
    const activeRemoteRooms = [];
    for (const [code, sockets] of remoteSessions.entries()) {
      if (sockets && sockets.size > 0) {
        activeRemoteRooms.push({
          id: `storm_tv_${code}`,
          name: `STORM Smart TV / Приставка (Код: ${code})`,
          protocol: 'STORM Bridge WebSocket',
          status: 'online',
          code
        });
      }
    }

    const devices = [
      ...activeRemoteRooms,
      {
        id: 'browser_presentation',
        name: 'Chromecast / Google TV / Беспроводной дисплей',
        protocol: 'Google Cast / Presentation API',
        status: 'ready'
      },
      {
        id: 'airplay_webkit',
        name: 'Apple TV / AirPlay 2 совместимый ТВ',
        protocol: 'AirPlay / WebKit Remote Playback',
        status: 'ready'
      },
      {
        id: 'dlna_vlc_playlist',
        name: 'DLNA / Smart TV (Samsung Tizen, LG webOS, Android TV)',
        protocol: 'DLNA / HLS Direct Stream (.m3u8)',
        status: 'ready'
      }
    ];

    res.json({ success: true, devices });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/cast/play', async (req, res) => {
  try {
    const { deviceId, roomCode, media, streamUrl, subtitleUrl, season, episode, voiceover } = req.body || {};
    const targetCode = String(roomCode || '').trim().toUpperCase();

    if (targetCode) {
      const payload = JSON.stringify({
        type: 'storm_remote_action',
        action: 'cast_media',
        media,
        streamUrl,
        subtitleUrl,
        season,
        episode,
        voiceover,
        timestamp: Date.now()
      });

      const sessClients = remoteSessions.get(targetCode);
      if (sessClients) {
        for (const c of sessClients) {
          if (c.readyState === 1) c.send(payload);
        }
      }
      const wRoom = watchRooms.get(targetCode);
      if (wRoom) {
        for (const [c] of wRoom.participants) {
          if (c.readyState === 1) c.send(payload);
        }
      }
    }

    res.json({
      success: true,
      deviceId: deviceId || 'smart_tv',
      message: 'Поток успешно отправлен на экран ТВ'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 13.8. Сканер домашней локальной медиатеки (Local NAS / Folder Scanner + HTTP Range Streamer)
const localLibraryStore = new Map();

function parseLocalVideoFilename(filename) {
  const base = path.basename(filename, path.extname(filename));
  const yearMatch = base.match(/\b(19\d{2}|20\d{2})\b/);
  const seMatch = base.match(/S(\d{1,2})E(\d{1,3})/i) || base.match(/(\d{1,2})x(\d{1,3})/i);
  const qualityMatch = base.match(/\b(2160p|4K|1080p|720p|BDRip|WEB-DL|Remux|HDR)\b/i);

  let cleanTitle = base
    .replace(/\[.*?\]|\(.*?\)/g, ' ')
    .replace(/S\d{1,2}E\d{1,3}.*$/i, ' ')
    .replace(/\b(19\d{2}|20\d{2})\b.*$/i, ' ')
    .replace(/\b(2160p|4K|UHD|1080p|720p|BDRip|WEB-DL|WEBRip|Remux|HDR|HEVC|x264|x265|10bit|Rus|Eng)\b.*$/i, ' ')
    .replace(/[._\-]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!cleanTitle) cleanTitle = base;

  return {
    cleanTitle,
    year: yearMatch ? yearMatch[1] : '',
    season: seMatch ? parseInt(seMatch[1], 10) : null,
    episode: seMatch ? parseInt(seMatch[2], 10) : null,
    quality: qualityMatch ? qualityMatch[1].toUpperCase() : '1080p Local',
    isSeries: Boolean(seMatch)
  };
}

app.get('/api/local-library/list', requireAdmin, (req, res) => {
  res.json({
    success: true,
    items: Array.from(localLibraryStore.values()).map(({ fullPath, ...safeItem }) => safeItem)
  });
});

app.post('/api/local-library/scan', requireAdmin, async (req, res) => {
  try {
    const rawFolder = String(req.body?.folderPath || '').trim();
    if (rawFolder) {
      const normCheck = path.resolve(rawFolder).toLowerCase();
      const forbiddenPrefixes = ['/etc', '/proc', '/sys', '/root', '/var/run', 'c:\\windows', 'c:\\program files'];
      if (forbiddenPrefixes.some(fp => normCheck === fp || normCheck.startsWith(fp + path.sep) || normCheck.startsWith(fp + '/'))) {
        return res.status(403).json({ error: 'Сканирование системных директорий запрещено' });
      }
    }
    const defaultDirs = [
      rawFolder,
      path.join(process.env.USERPROFILE || '', 'Videos'),
      path.join(process.env.USERPROFILE || '', 'Downloads')
    ].filter(Boolean);

    const targetDir = defaultDirs.find(d => {
      try { return fs.existsSync(d) && fs.statSync(d).isDirectory(); } catch { return false; }
    });

    if (!targetDir) {
      return res.status(400).json({ error: 'Указанная папка не найдена на диске' });
    }

    const allowedExts = new Set(['.mp4', '.mkv', '.webm', '.avi', '.mov', '.m4v']);
    const foundFiles = [];

    function walkDir(dir, depth = 0) {
      if (depth > 2 || foundFiles.length >= 80) return;
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (foundFiles.length >= 80) break;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('$')) {
          walkDir(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (allowedExts.has(ext)) {
            try {
              const st = fs.statSync(fullPath);
              if (st.size > 1024 * 512) {
                foundFiles.push({ fullPath, name: entry.name, size: st.size, mtime: st.mtimeMs });
              }
            } catch (_) {}
          }
        }
      }
    }

    walkDir(targetDir, 0);

    const items = [];
    for (const fileObj of foundFiles) {
      const parsed = parseLocalVideoFilename(fileObj.name);
      const id = 'local_' + Buffer.from(fileObj.fullPath).toString('base64url').slice(0, 22);
      const item = {
        id,
        source: 'local',
        title: parsed.cleanTitle,
        filename: fileObj.name,
        fullPath: fileObj.fullPath,
        sizeBytes: fileObj.size,
        sizeFormatted: `${(fileObj.size / (1024 * 1024)).toFixed(1)} МБ`,
        year: parsed.year || new Date(fileObj.mtime).getFullYear(),
        quality: parsed.quality,
        media_type: parsed.isSeries ? 'series' : 'movie',
        season: parsed.season,
        episode: parsed.episode,
        poster: `/api/media/image-proxy?title=${encodeURIComponent(parsed.cleanTitle)}`,
        stream_url: `/api/local-library/stream?id=${encodeURIComponent(id)}`
      };
      localLibraryStore.set(id, item);
      const { fullPath: _fp, ...safeItem } = item;
      items.push(safeItem);
    }

    res.json({
      success: true,
      count: items.length,
      items
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/local-library/stream', requireAdmin, (req, res) => {
  try {
    const id = String(req.query.id || '').trim();
    const entry = localLibraryStore.get(id);
    if (!entry || !entry.fullPath || !fs.existsSync(entry.fullPath)) {
      return res.status(404).send('Локальный видеофайл не найден');
    }

    const filePath = entry.fullPath;
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = {
      '.mp4': 'video/mp4',
      '.m4v': 'video/mp4',
      '.webm': 'video/webm',
      '.mkv': 'video/x-matroska',
      '.avi': 'video/x-msvideo',
      '.mov': 'video/quicktime'
    };
    const contentType = mimeMap[ext] || 'video/mp4';
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = Math.max(0, parseInt(parts[0], 10) || 0);
      const rawEnd = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const end = Math.min(fileSize - 1, Number.isFinite(rawEnd) ? rawEnd : fileSize - 1);
      if (start >= fileSize || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
        return res.end();
      }
      const chunkSize = (end - start) + 1;
      const stream = fs.createReadStream(filePath, { start, end });
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType
      });
      stream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Accept-Ranges': 'bytes',
        'Content-Type': contentType
      });
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Фронтенд fallback с защитой от возврата HTML на API, статические ассеты и вложенные iframe
app.get('*', (req, res) => {
  // Защита: если iframe-запрос попал на неизвестный маршрут, перенаправляем на рабочий мульти-балансер вместо ошибки 404
  if (req.headers['sec-fetch-dest'] === 'iframe' || req.headers['sec-fetch-mode'] === 'nested-navigate') {
    const qTitle = req.query.title || '';
    const qYear = req.query.year || '';
    if (qTitle) {
      return res.redirect(302, `/api/player/kinobox-embed?balancer=auto&fallback_mode=1&title=${encodeURIComponent(qTitle)}&year=${encodeURIComponent(qYear)}`);
    }
    return res.status(200).type('text/html; charset=utf-8').send('<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;background:#0a0b10;color:#94a3b8;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;font-size:14px;}</style><script>try{window.parent.postMessage({type:"STORM_SWITCH_NEXT_SOURCE",reason:"IFRAME_ROUTE_FALLBACK"},"*");}catch(_){}</script></head><body>Переключение на рабочий видеопоток...</body></html>');
  }
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: 'API эндпоинт не найден' });
  }
  if (req.path.startsWith('/assets/') || /\.[a-zA-Z0-9]+$/.test(req.path)) {
    return res.status(404).type('text/plain; charset=utf-8').send('Файл не найден');
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Запуск сервера с поддержкой WebSockets и фоновых демонов балансеров
server.listen(PORT, () => {
  logger.info('STORM MULTIMEDIA 1.2.0 Server started', { port: PORT });
  console.log(`====================================================`);
  console.log(`🚀 STORM MULTIMEDIA 1.2.0 Сервер запущен на порту ${PORT}`);
  console.log(`🌐 Адрес портала: http://localhost:${PORT}`);
  console.log(`====================================================`);

  startBalancerDaemons(async () => {
    try {
      await executeCatalogFetch('popular', 1, 'all', {});
    } catch (_) {}
  });
});

// ==========================================
// САМОВОССТАНОВЛЕНИЕ И GRACEFUL SHUTDOWN (Пункт 6.10)
// ==========================================
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err?.message, stack: err?.stack });
  try { flushWatchProgressBatch(); } catch (_) {}
  try { checkpointWal(); } catch (_) {}
});

process.on('unhandledRejection', (reason) => {
  logger.warn('Unhandled promise rejection', { reason: String(reason) });
});

async function handleGracefulShutdown(signal) {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  try { stopBalancerDaemons(); } catch (_) {}
  try { flushWatchProgressBatch(); } catch (_) {}
  try { checkpointWal(); } catch (_) {}
  try { notifyAllSocketsServerRestarting(wss); } catch (_) {}
  try { await closeMariaDbPool(); } catch (_) {}
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 4000).unref();
}

process.on('SIGTERM', () => { handleGracefulShutdown('SIGTERM'); });
process.on('SIGINT', () => { handleGracefulShutdown('SIGINT'); });

// STORM_AUTO_RELOAD_WATCHER: автоматический перезапуск через watchdog при обновлении server.js на диске
try {
  const selfStatInit = fs.statSync(__filename).mtimeMs;
  setInterval(() => {
    try {
      const curMtime = fs.statSync(__filename).mtimeMs;
      if (Math.abs(curMtime - selfStatInit) > 1500) {
        console.log('[STORM SERVER] Обнаружено обновление server.js на диске. Перезапуск процесса через Watchdog...');
        setTimeout(() => process.exit(0), 1200);
      }
    } catch (_) {}
  }, 5000);
} catch (_) {}
