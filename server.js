import express from 'express';
import cors from 'cors';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import {
  registerUser,
  loginUser,
  logoutUser,
  getUserByToken,
  updateUserSettings,
  updateUserProfile,
  changeUserPassword,
  getUserStats,
  getUserBookmarks,
  getBookmark,
  setBookmark,
  removeBookmark,
  logWatchProgress,
  getContinueWatching,
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
  exportUserData,
  importUserData
} from './db.js';

import {
  getFanFilmCatalog,
  searchFanFilm,
  getFanFilmDetails
} from './services/fanfilm-service.js';

import {
  getAnixartDiscover,
  searchAnixart,
  getAnixartReleaseDetails,
  getAnixartEpisodes
} from './services/anixart-service.js';

import {
  getShikimoriCatalog,
  searchShikimori
} from './services/shikimori-service.js';

import {
  getTmdbCatalog,
  searchTmdb,
  getTmdbItemDetails,
  getTmdbSeasonEpisodes,
  getTmdbPersonMedia
} from './services/tmdb-service.js';

import {
  getAniLibriaCatalog,
  getAniLibriaDetails,
  searchAniLibria
} from './services/anilibria-service.js';

import {
  getAvailablePlayers
} from './services/kinobox-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 3000;

// Хранилище комнат совместного просмотра в памяти
const watchRooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'STORM-';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

wss.on('connection', (ws) => {
  let currentRoomCode = null;
  let currentUser = null;

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      switch (data.type) {
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

        default:
          break;
      }
    } catch (err) {
      console.error('Ошибка WebSocket сообщения:', err);
    }
  });

  ws.on('close', () => {
    if (currentRoomCode) {
      const room = watchRooms.get(currentRoomCode);
      if (room) {
        room.participants.delete(ws);
        if (room.participants.size === 0) {
          // Если комната пуста более 15 минут, она удалится
          setTimeout(() => {
            if (room.participants.size === 0) {
              watchRooms.delete(currentRoomCode);
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

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Раздача статических файлов
app.use(express.static(path.join(__dirname, 'public')));

// Middleware для извлечения пользователя
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.headers.cookie) {
    const match = req.headers.cookie.match(/storm_token=([a-zA-Z0-9_-]+)/);
    if (match) token = match[1];
  }

  if (token) {
    req.user = getUserByToken(token);
    req.token = token;
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  next();
}

app.use(authMiddleware);

// ==========================================
// 1. АУТЕНТИФИКАЦИЯ И ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ
// ==========================================

app.post('/api/auth/register', (req, res) => {
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

    const session = registerUser(username, email, password, avatar);
    res.json(session);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { login, password } = req.body;
    if (!login || !password) {
      return res.status(400).json({ error: 'Укажите логин и пароль' });
    }

    const session = loginUser(login, password);
    res.json(session);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  if (req.token) {
    logoutUser(req.token);
  }
  res.json({ success: true });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.user) {
    return res.json({ user: null });
  }
  const stats = getUserStats(req.user.id);
  res.json({
    user: req.user,
    stats
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

app.get('/api/auth/stats', requireAuth, (req, res) => {
  try {
    const stats = getUserStats(req.user.id);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 2. ПРОКСИ ИЗОБРАЖЕНИЙ (100% ГАРАНТИЯ ЗАГРУЗКИ ОБЛОЖЕК)
// ==========================================

const animeCoverCache = new Map();

async function resolveAnimePoster(title, orig) {
  const cleanTitle = (title || '').trim();
  const cleanOrig = (orig || '').trim();
  const cacheKey = `${cleanTitle}:::${cleanOrig}`;

  if (animeCoverCache.has(cacheKey)) {
    return animeCoverCache.get(cacheKey);
  }

  const searchTerms = [cleanOrig, cleanTitle].filter(t => t && t.length >= 2);

  // 1. Быстрый поиск обложки через открытый GraphQL AniList
  for (const term of searchTerms) {
    try {
      const q = `
        query ($search: String) {
          Media(search: $search, type: ANIME) {
            coverImage { large }
          }
        }
      `;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1800);
      const res = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ query: q, variables: { search: term } }),
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json();
        const img = data?.data?.Media?.coverImage?.large;
        if (img) {
          if (animeCoverCache.size > 2000) animeCoverCache.clear();
          animeCoverCache.set(cacheKey, img);
          return img;
        }
      }
    } catch {}
  }

  // 2. Поиск через Shikimori API при необходимости
  for (const term of searchTerms) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1800);
      const res = await fetch(`https://shikimori.one/api/animes?search=${encodeURIComponent(term)}&limit=1`, {
        headers: { 'User-Agent': 'STORM-MULTIMEDIA/1.0' },
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (res.ok) {
        const list = await res.json();
        if (list && list[0]?.image) {
          const imgPath = list[0].image.original || list[0].image.preview;
          if (imgPath) {
            const fullUrl = `https://shikimori.one${imgPath}`;
            if (animeCoverCache.size > 2000) animeCoverCache.clear();
            animeCoverCache.set(cacheKey, fullUrl);
            return fullUrl;
          }
        }
      }
    } catch {}
  }

  const fallback = '/assets/favicon.svg';
  animeCoverCache.set(cacheKey, fallback);
  return fallback;
}

app.get('/api/media/image-proxy', async (req, res) => {
  try {
    const imageUrl = req.query.url || '';
    const title = req.query.title || '';
    const orig = req.query.orig || '';

    // Если это ссылка на сторонний быстрый CDN (не anixmirai) — сразу 302 редирект
    if (imageUrl && !imageUrl.includes('anixmirai.com') && !imageUrl.includes('anixapi')) {
      const target = imageUrl.startsWith('//') ? `https:${imageUrl}` : imageUrl;
      res.set('Cache-Control', 'public, max-age=604800, immutable');
      return res.redirect(302, target);
    }

    // Для AniXart постеров — быстро разрешаем через AniList / Shikimori CDN без зависания сокетов
    const resolvedUrl = await resolveAnimePoster(title, orig);
    res.set('Cache-Control', 'public, max-age=604800, immutable');
    return res.redirect(302, resolvedUrl);
  } catch {
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

// ==========================================
// 3. МЕДИА КАТАЛОГ И АГРЕГАЦИЯ 12+ ИСТОЧНИКОВ
// ==========================================

app.get('/api/media/catalog', async (req, res) => {
  try {
    const category = req.query.category || 'home';
    const page = parseInt(req.query.page, 10) || 1;
    const source = req.query.source || 'all';

    let items = [];
    let totalItems = 0;

    // 1. Прямой источник: The Movie Database (TMDB)
    if (source === 'tmdb') {
      const tmdbRes = await getTmdbCatalog(category, page);
      items = tmdbRes.items;
      totalItems = tmdbRes.total_items;
    }
    // 2. Прямой источник: AniLibria
    else if (source === 'anilibria') {
      const aLibRes = await getAniLibriaCatalog(category, page);
      items = aLibRes.items;
      totalItems = aLibRes.total_items;
    }
    // 3. Стриминговые провайдеры (Kodik, HDRezka, Collaps, Alloha, Videocdn, Ashdi, Kinobox)
    else if (['kodik', 'hdrezka', 'collaps', 'alloha', 'videocdn', 'ashdi', 'kinobox'].includes(source)) {
      const tmdbRes = await getTmdbCatalog(category, page);
      items = tmdbRes.items.map(i => ({
        ...i,
        source: source,
        provider_name: source.toUpperCase()
      }));
      totalItems = tmdbRes.total_items;
    }
    // 4. Прямой источник: FanFilm4K
    else if (source === 'fanfilm4k') {
      const cat = category === 'home' ? 'popular' : category;
      const fanfilmRes = await getFanFilmCatalog(cat, page);
      items = fanfilmRes.items;
      totalItems = fanfilmRes.total_items;
    }
    // 5. Прямой источник: AniXart
    else if (source === 'anixart') {
      const cat = category === 'home' ? 'popular' : category;
      const anixRes = await getAnixartDiscover(cat, page - 1);
      items = anixRes.items;
      totalItems = anixRes.items.length;
    }
    // 6. Прямой источник: Shikimori
    else if (source === 'shikimori') {
      const cat = category === 'home' ? 'popular' : category;
      const shikiRes = await getShikimoriCatalog(cat, page);
      items = shikiRes.items;
      totalItems = shikiRes.items.length;
    }
    // 7. Сводный каталог всех источников ('all')
    else {
      if (category === 'anime-movies') {
        const [anixRes, shikiRes, libRes] = await Promise.all([
          getAnixartDiscover('anime-movies', page - 1).catch(() => ({ items: [] })),
          getShikimoriCatalog('anime-movies', page).catch(() => ({ items: [] })),
          getAniLibriaCatalog('anime-movies', page).catch(() => ({ items: [] }))
        ]);
        items = interleaveSources([anixRes?.items || [], shikiRes?.items || [], libRes?.items || []]);
        totalItems = items.length;
      } else if (category === 'anime-series') {
        const [anixRes, libRes, shikiRes] = await Promise.all([
          getAnixartDiscover('anime-series', page - 1).catch(() => ({ items: [] })),
          getAniLibriaCatalog('anime-series', page).catch(() => ({ items: [] })),
          getShikimoriCatalog('anime-series', page).catch(() => ({ items: [] }))
        ]);
        items = interleaveSources([anixRes?.items || [], libRes?.items || [], shikiRes?.items || []]);
        totalItems = items.length;
      } else if (category === 'cartoon-series' || category === 'cartoons') {
        const [fanfilmRes, tmdbRes] = await Promise.all([
          getFanFilmCatalog(category, page).catch(() => ({ items: [] })),
          getTmdbCatalog(category, page).catch(() => ({ items: [] }))
        ]);
        items = interleaveSources([fanfilmRes?.items || [], tmdbRes?.items || []]);
        totalItems = items.length;
      } else if (category === 'movies' || category === 'series') {
        const [fanfilmRes, tmdbRes] = await Promise.all([
          getFanFilmCatalog(category, page).catch(() => ({ items: [] })),
          getTmdbCatalog(category, page).catch(() => ({ items: [] }))
        ]);
        items = interleaveSources([fanfilmRes?.items || [], tmdbRes?.items || []]);
        totalItems = items.length;
      } else if (category === 'new') {
        const [fRes, tmdbRes, aRes, libRes] = await Promise.all([
          getFanFilmCatalog('new', page).catch(() => ({ items: [] })),
          getTmdbCatalog('new', page).catch(() => ({ items: [] })),
          getAnixartDiscover('new', page - 1).catch(() => ({ items: [] })),
          getAniLibriaCatalog('new', page).catch(() => ({ items: [] }))
        ]);
        items = interleaveSources([fRes?.items || [], tmdbRes?.items || [], aRes?.items || [], libRes?.items || []]);
        totalItems = items.length;
      } else {
        // Главная (home / popular)
        const [fRes, tmdbRes, aRes, libRes] = await Promise.all([
          getFanFilmCatalog('popular', page).catch(() => ({ items: [] })),
          getTmdbCatalog('popular', page).catch(() => ({ items: [] })),
          getAnixartDiscover('popular', page - 1).catch(() => ({ items: [] })),
          getAniLibriaCatalog('popular', page).catch(() => ({ items: [] }))
        ]);
        items = interleaveSources([fRes?.items || [], tmdbRes?.items || [], aRes?.items || [], libRes?.items || []]);
        totalItems = items.length;
      }
    }

    // Прикрепляем закладки и статусы для авторизованных пользователей
    if (req.user) {
      items = items.map(item => {
        const bookmark = getBookmark(req.user.id, item.id, item.source);
        return {
          ...item,
          user_status: bookmark?.status || null,
          progress_percent: bookmark?.progress_percent || 0.0,
          episodes_watched: bookmark?.episodes_watched || 0,
          total_episodes: bookmark?.total_episodes || 0
        };
      });
    }

    res.json({
      category,
      page,
      source,
      total_items: totalItems,
      items
    });
  } catch (err) {
    res.status(500).json({ error: err.message, items: [] });
  }
});

app.get('/api/media/search', async (req, res) => {
  try {
    const query = (req.query.q || '').trim();
    const source = req.query.source || 'all';

    if (!query) {
      return res.json({ query: '', total: 0, items: [] });
    }

    const tasks = [];
    const withTimeout = (promise, ms = 3500) =>
      Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))
      ]);

    if (source === 'all' || source === 'fanfilm4k') {
      tasks.push(withTimeout(searchFanFilm(query)).catch(() => []));
    }

    if (source === 'all' || source === 'tmdb' || ['kodik', 'hdrezka', 'collaps', 'alloha', 'videocdn', 'ashdi', 'kinobox'].includes(source)) {
      tasks.push(withTimeout(searchTmdb(query)).then(r => r?.items || []).catch(() => []));
    }

    if (source === 'all' || source === 'anixart') {
      tasks.push(withTimeout(searchAnixart(query, 0)).then(r => r?.items || []).catch(() => []));
    }

    if (source === 'all' || source === 'anilibria') {
      tasks.push(withTimeout(searchAniLibria(query)).then(r => r?.items || []).catch(() => []));
    }

    if (source === 'all' || source === 'shikimori') {
      tasks.push(withTimeout(searchShikimori(query)).catch(() => []));
    }

    const settled = await Promise.all(tasks);
    let items = [];
    settled.forEach(arr => {
      if (Array.isArray(arr)) items.push(...arr);
    });

    // Дедупликация
    const seen = new Set();
    items = items.filter(item => {
      const key = `${item.source}_${item.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (req.user) {
      items = items.map(item => {
        const bookmark = getBookmark(req.user.id, item.id, item.source);
        return {
          ...item,
          user_status: bookmark?.status || null,
          progress_percent: bookmark?.progress_percent || 0.0
        };
      });
    }

    res.json({
      query,
      total: items.length,
      items
    });
  } catch (err) {
    res.status(500).json({ error: err.message, items: [] });
  }
});

app.get('/api/media/item', async (req, res) => {
  try {
    const { id, source, url } = req.query;
    if (!id && !url) {
      return res.status(400).json({ error: 'Укажите id или url' });
    }

    let mediaDetails = null;

    if (source === 'anixart') {
      mediaDetails = await getAnixartReleaseDetails(id);
    } else if (source === 'anilibria') {
      mediaDetails = await getAniLibriaDetails(id);
      if (mediaDetails && mediaDetails.episodes && mediaDetails.episodes.length > 0) {
        const firstEp = mediaDetails.episodes[0];
        const streamUrl = firstEp.hls_1080 || firstEp.hls_720 || firstEp.hls_480;
        mediaDetails.players = [
          {
            id: 'anilibria_hls',
            name: 'AniLibria Full HD 1080p (Официальный поток)',
            type: 'hls',
            quality: '1080p FHD',
            badge: 'ANILIBRIA',
            url: streamUrl,
            episodes: mediaDetails.episodes
          }
        ];
      }
    } else if (source === 'tmdb' || String(id || '').startsWith('tmdb_') || ['kodik', 'hdrezka', 'collaps', 'alloha', 'videocdn', 'ashdi', 'kinobox'].includes(source)) {
      const cleanTmdbId = String(id || '').replace('tmdb_', '');
      mediaDetails = await getTmdbItemDetails(cleanTmdbId, req.query.media_type);

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
    } else {
      try {
        mediaDetails = await getFanFilmDetails(url || id);
      } catch {
        mediaDetails = null;
      }
    }

    if (!mediaDetails) {
      mediaDetails = {
        id: String(id || 'media_' + Date.now()),
        source: source || 'fanfilm4k',
        title: req.query.title || 'Видео',
        original_title: req.query.original_title || '',
        poster: req.query.poster || 'assets/favicon.svg',
        year: req.query.year || '',
        rating: 0,
        description: req.query.description || 'Просмотр фильма онлайн в высоком качестве.',
        media_type: req.query.media_type || 'movie',
        players: []
      };
    }

    // Дополнительное обогащение для FanFilm и других источников при отсутствии режиссеров/актеров
    if (!mediaDetails.directors?.length && !mediaDetails.cast?.length && mediaDetails.title) {
      try {
        const tmdbSearch = await searchTmdb(mediaDetails.title, 1);
        if (tmdbSearch.items?.length > 0) {
          const first = tmdbSearch.items[0];
          const enriched = await getTmdbItemDetails(first.id, mediaDetails.media_type);
          if (enriched) {
            mediaDetails.release_date = mediaDetails.release_date || enriched.release_date;
            mediaDetails.duration = mediaDetails.duration || enriched.duration;
            mediaDetails.rating_kp = mediaDetails.rating_kp || enriched.rating_kp;
            mediaDetails.rating_tmdb = mediaDetails.rating_tmdb || enriched.rating_tmdb;
            mediaDetails.genres = mediaDetails.genres || enriched.genres;
            mediaDetails.countries = mediaDetails.countries || enriched.countries;
            mediaDetails.directors = enriched.directors;
            mediaDetails.cast = enriched.cast;
            mediaDetails.trailer_url = mediaDetails.trailer_url || enriched.trailer_url;
            if (enriched.seasons?.length && !mediaDetails.seasons?.length) {
              mediaDetails.seasons = enriched.seasons;
            }
          }
        }
      } catch {}
    }

    // Собираем расширенный список плееров (FanFilm 4K, Kodik, Трейлер, и др.)
    const kinoboxPlayers = getAvailablePlayers({
      kp_id: mediaDetails.kp_id,
      imdb_id: mediaDetails.imdb_id,
      title: mediaDetails.title,
      year: mediaDetails.year,
      media_type: mediaDetails.media_type,
      fanfilm_4k_url: mediaDetails.players?.find(p => p.id === 'fanfilm4k_uhd')?.url,
      trailer_url: mediaDetails.trailer_url
    });

    const allPlayers = [];
    if (mediaDetails.players) {
      allPlayers.push(...mediaDetails.players);
    }
    kinoboxPlayers.forEach(p => {
      if (!allPlayers.some(ap => ap.url === p.url || ap.id === p.id)) {
        allPlayers.push(p);
      }
    });

    let userBookmark = null;
    if (req.user) {
      userBookmark = getBookmark(req.user.id, String(id || mediaDetails.id), source || 'fanfilm4k');
    }

    res.json({
      ...mediaDetails,
      players: allPlayers,
      user_bookmark: userBookmark
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Получение серий сезона сериала с русскими названиями и синопсисами
app.get('/api/media/series-episodes', async (req, res) => {
  try {
    const { tvId, season } = req.query;
    if (!tvId) {
      return res.status(400).json({ error: 'Укажите tvId' });
    }
    const data = await getTmdbSeasonEpisodes(tvId, parseInt(season, 10) || 1);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Получение всех видео актера или режиссера
app.get('/api/media/person', async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) {
      return res.status(400).json({ error: 'Укажите id персоны' });
    }
    const data = await getTmdbPersonMedia(id);
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

app.get('/api/anixart/release/:id', async (req, res) => {
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

app.delete('/api/bookmarks/remove', requireAuth, (req, res) => {
  try {
    const { media_id, source } = req.body;
    removeBookmark(req.user.id, media_id, source);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

    if (req.user) {
      trackUserAction(req.user.id, 'room_host');
    }

    res.json({ success: true, code, room: { code, hostName: newRoom.hostName, media: newRoom.media } });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

app.post('/api/reviews', requireAuth, (req, res) => {
  try {
    const { media_id, source, title, rating, content } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Текст рецензии не может быть пустым' });
    }
    const review = addReview(req.user.id, {
      media_id,
      source,
      title: title?.trim() || '',
      rating,
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
    const response = await fetch(`https://shikimori.one/api/users/${encodeURIComponent(username.trim())}/anime_rates?limit=500`, {
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
          poster_url: rate.anime.image ? `https://shikimori.one${rate.anime.image.original || rate.anime.image.preview}` : '',
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
    const { malId, episode } = req.query;
    if (!malId || !episode) {
      return res.json({ op: { start: 85, end: 175 }, ed: { start: 1320, end: 1405 } });
    }

    const response = await fetch(`https://api.aniskip.com/v2/skip-times/${encodeURIComponent(malId)}/${encodeURIComponent(episode)}?types=op&types=ed`);
    if (!response.ok) {
      return res.json({ op: { start: 85, end: 175 }, ed: { start: 1320, end: 1405 } });
    }
    const data = await response.json();
    const result = {};
    if (data.results) {
      data.results.forEach(item => {
        if (item.skipType === 'op') {
          result.op = { start: item.interval.startTime, end: item.interval.endTime };
        } else if (item.skipType === 'ed') {
          result.ed = { start: item.interval.startTime, end: item.interval.endTime };
        }
      });
    }
    res.json(result);
  } catch {
    res.json({ op: { start: 85, end: 175 }, ed: { start: 1320, end: 1405 } });
  }
});

// Фронтенд fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Запуск сервера с поддержкой WebSockets
server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 STORM MULTIMEDIA Сервер запущен на порту ${PORT}`);
  console.log(`🌐 Адрес портала: http://localhost:${PORT}`);
  console.log(`====================================================`);
});
