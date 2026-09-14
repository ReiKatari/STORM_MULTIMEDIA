/* ==========================================================================
   STORM MULTIMEDIA - SERVICE WORKER (PWA И АВТОНОМНЫЙ РЕЖИМ)
   ========================================================================== */

const CACHE_NAME = 'storm-multimedia-v2.7';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/remote.html',
  '/styles/storm-theme.css',
  '/styles/components.css',
  '/styles/main.css',
  '/styles/tv-mode.css',
  '/js/catalog-baseline.js',
  '/js/app.js',
  '/js/auth.js',
  '/js/bookmarks.js',
  '/js/player.js',
  '/js/i18n.js',
  '/js/theme.js',
  '/js/achievements.js',
  '/js/reviews.js',
  '/js/watch-together.js',
  '/js/subtitles-manager.js',
  '/js/voice-assistant.js',
  '/js/gamepad-tv.js',
  '/js/sync-service.js',
  '/js/smart-skip.js',
  '/js/smart-lights.js',
  '/js/neural-recommender.js',
  '/js/offline-storage.js',
  '/js/torrserver-client.js',
  '/js/whisper-subtitles.js',
  '/js/release-calendar.js',
  '/js/storm-remote.js',
  '/assets/favicon.svg',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('Часть ресурсов не удалось закэшировать при установке:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Не перехватываем сторонние кросс-доменные запросы (видеостримы, внешние CDN)
  if (url.origin !== self.location.origin) {
    return;
  }

  // Для API-запросов: прямой сетевой запрос к серверу без тайм-аута с мягким кэшированием
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).then((netRes) => {
        if (netRes && netRes.status === 200 && url.pathname === '/api/media/catalog') {
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, netRes.clone())).catch(() => {});
        }
        return netRes;
      }).catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (url.pathname === '/api/media/catalog') {
          return new Response(JSON.stringify({ items: [], total_items: 0 }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return new Response(JSON.stringify({ error: 'Автономный режим: нет подключения к сети' }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // Для скриптов, стилей и HTML: Network-First для мгновенного применения обновлений без кэш-задержек
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      }).catch(() => {
        return caches.match(event.request);
      })
    );
    return;
  }

  // Для остальных статических файлов (картинки, шрифты): Stale-While-Revalidate
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      }).catch(() => {
        return cached;
      });

      return cached || fetchPromise;
    })
  );
});
