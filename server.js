import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  registerUser,
  loginUser,
  logoutUser,
  getUserByToken,
  updateUserSettings,
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
  removeCustomListItem
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
  getAvailablePlayers
} from './services/kinobox-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Раздача статических файлов клиентского интерфейса
app.use(express.static(path.join(__dirname, 'public')));

// Middleware для извлечения пользователя по сессионному токену
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
// 2. МЕДИА КАТАЛОГ И АГРЕГАЦИЯ ИСТОЧНИКОВ
// ==========================================

/**
 * Универсальный каталог (комбинирует FanFilm4K и AniXart)
 */
app.get('/api/media/catalog', async (req, res) => {
  try {
    const category = req.query.category || 'popular';
    const page = parseInt(req.query.page, 10) || 1;
    const source = req.query.source || 'all'; // 'all', 'fanfilm4k', 'anixart'

    let items = [];
    let totalItems = 0;

    // 1. Аниме категория -> запрос в AniXart
    if (category === 'anime' || source === 'anixart') {
      const anixartCategory = category === 'new' ? 'interesting' : 'popular';
      const anixartRes = await getAnixartDiscover(anixartCategory, page - 1);
      items = anixartRes.items;
      totalItems = anixartRes.total_count;
    }
    // 2. Только FanFilm4K (фильмы, 4K, сериалы, мультфильмы)
    else if (source === 'fanfilm4k' || ['movies', 'series', '4k', 'cartoons', 'cartoon-series'].includes(category)) {
      const fanfilmRes = await getFanFilmCatalog(category, page);
      items = fanfilmRes.items;
      totalItems = fanfilmRes.total_items;
    }
    // 3. Комбинированная подборка (Популярное / Новинки)
    else {
      const [fanfilmRes, anixartRes] = await Promise.all([
        getFanFilmCatalog(category === 'new' ? 'new' : 'popular', page),
        getAnixartDiscover(category === 'new' ? 'interesting' : 'popular', page - 1)
      ]);

      // Чередуем для разнообразия контента
      const fItems = fanfilmRes.items || [];
      const aItems = anixartRes.items || [];
      const maxLength = Math.max(fItems.length, aItems.length);

      for (let i = 0; i < maxLength; i++) {
        if (i < fItems.length) items.push(fItems[i]);
        if (i < aItems.length && items.length < 50) items.push(aItems[i]);
      }
      totalItems = fItems.length + aItems.length;
    }

    // Добавляем пользовательский статус и процент просмотра для каждого тайтла, если пользователь залогинен
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

/**
 * Полнотекстовый поиск по всем источникам
 */
app.get('/api/media/search', async (req, res) => {
  try {
    const query = req.query.q || '';
    const source = req.query.source || 'all';

    if (!query.trim()) {
      return res.json({ items: [], total: 0 });
    }

    let items = [];

    if (source === 'all' || source === 'fanfilm4k') {
      const fanfilmResults = await searchFanFilm(query);
      items.push(...fanfilmResults);
    }

    if (source === 'all' || source === 'anixart') {
      const anixartResults = await searchAnixart(query, 0);
      items.push(...(anixartResults.items || []));
    }

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

/**
 * Получение полной карточки тайтла и списка всех доступных плееров
 */
app.get('/api/media/item', async (req, res) => {
  try {
    const { id, source, url } = req.query;
    if (!id && !url) {
      return res.status(400).json({ error: 'Укажите id или url' });
    }

    let mediaDetails = null;

    if (source === 'anixart') {
      mediaDetails = await getAnixartReleaseDetails(id);
    } else {
      mediaDetails = await getFanFilmDetails(url || id);
    }

    if (!mediaDetails) {
      return res.status(404).json({ error: 'Медиа не найдено' });
    }

    // Собираем расширенный список плееров
    const kinoboxPlayers = getAvailablePlayers({
      kp_id: mediaDetails.kp_id,
      imdb_id: mediaDetails.imdb_id,
      title: mediaDetails.title,
      fanfilm_4k_url: mediaDetails.players?.find(p => p.id === 'fanfilm4k_uhd')?.url,
      trailer_url: mediaDetails.players?.find(p => p.id === 'trailer')?.url
    });

    // Объединяем плееры
    const allPlayers = [...kinoboxPlayers];
    if (mediaDetails.players) {
      mediaDetails.players.forEach(p => {
        if (!allPlayers.some(ap => ap.url === p.url || ap.id === p.id)) {
          allPlayers.push(p);
        }
      });
    }

    // Данные закладки пользователя
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

// ==========================================
// 3. ANIXART СПЕЦИФИЧНЫЕ ЭНДПОИНТЫ
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
// 4. ЗАКЛАДКИ, СТАТУСЫ И ПРОГРЕСС ПРОСМОТРА
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
// 5. КАСТОМНЫЕ СПИСКИ И КОЛЛЕКЦИИ
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

// Фронтенд fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 STORM MULTIMEDIA Сервер запущен на порту ${PORT}`);
  console.log(`🌐 Адрес портала: http://localhost:${PORT}`);
  console.log(`====================================================`);
});
