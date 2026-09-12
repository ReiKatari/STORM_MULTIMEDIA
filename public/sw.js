/* ==========================================================================
   STORM MULTIMEDIA - SERVICE WORKER (PWA И АВТОНОМНЫЙ РЕЖИМ)
   ========================================================================== */

const CACHE_NAME = 'storm-multimedia-v1.2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles/storm-theme.css',
  '/styles/components.css',
  '/styles/main.css',
  '/styles/tv-mode.css',
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

  // Для API-запросов: Network-First с fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          return new Response(JSON.stringify({ error: 'Автономный режим: нет подключения к сети' }), {
            headers: { 'Content-Type': 'application/json' }
          });
        });
      })
    );
    return;
  }

  // Для статических файлов: Stale-While-Revalidate
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
