/* ==========================================================================
   STORM MULTIMEDIA - SERVICE WORKER (PWA И АВТОНОМНЫЙ РЕЖИМ)
   ========================================================================== */

const CACHE_NAME = 'storm-multimedia-v3.6-1.0.42';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/remote.html',
  '/styles/storm-theme.css?v=1.0.42',
  '/styles/components.css?v=1.0.42',
  '/styles/main.css?v=1.0.42',
  '/styles/tv-mode.css?v=1.0.42',
  '/js/status-icons.js?v=1.0.42',
  '/js/catalog-baseline.js?v=1.0.42',
  '/js/form-factor.js?v=1.0.42',
  '/js/app.js?v=1.0.42',
  '/js/auth.js?v=1.0.42',
  '/js/bookmarks.js?v=1.0.42',
  '/js/player.js?v=1.0.42',
  '/js/i18n.js?v=1.0.42',
  '/js/theme.js?v=1.0.42',
  '/js/achievements.js?v=1.0.42',
  '/js/reviews.js?v=1.0.42',
  '/js/watch-together.js?v=1.0.42',
  '/js/subtitles-manager.js?v=1.0.42',
  '/js/voice-assistant.js?v=1.0.42',
  '/js/gamepad-tv.js?v=1.0.42',
  '/js/sync-service.js?v=1.0.42',
  '/js/smart-skip.js?v=1.0.42',
  '/js/smart-lights.js?v=1.0.42',
  '/js/neural-recommender.js?v=1.0.42',
  '/js/offline-storage.js?v=1.0.42',
  '/js/torrserver-client.js?v=1.0.42',
  '/js/whisper-subtitles.js?v=1.0.42',
  '/js/release-calendar.js?v=1.0.42',
  '/js/storm-remote.js?v=1.0.42',
  '/js/admin-dashboard.js?v=1.0.42',
  '/js/updater.js?v=1.0.42',
  '/js/ad-shield.js?v=1.0.42',
  '/js/pro-media-engine.js?v=1.0.42',
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

  // Для API-запросов: прямой сетевой запрос к серверу с мягким кэшированием
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).then((netRes) => {
        if (netRes && netRes.status === 200 && url.pathname === '/api/media/catalog') {
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, netRes.clone())).catch(() => {});
        }
        return netRes;
      }).catch(async () => {
        const cached = await caches.match(event.request, { ignoreSearch: true });
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

  // Для скриптов, стилей и HTML: Network-First с быстрым таймаутом (2800мс) и устойчивым fallback на кэш с ignoreSearch
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(
      new Promise((resolve) => {
        let resolved = false;
        const controller = new AbortController();
        const timer = setTimeout(() => {
          controller.abort();
          caches.match(event.request, { ignoreSearch: true }).then((cached) => {
            if (cached && !resolved) {
              resolved = true;
              resolve(cached);
            }
          }).catch(() => {});
        }, 2800);

        fetch(event.request, { signal: controller.signal, cache: 'no-store' })
          .then((networkResponse) => {
            clearTimeout(timer);
            if (networkResponse && networkResponse.status === 200) {
              const responseClone = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, responseClone);
              }).catch(() => {});
            }
            if (!resolved) {
              resolved = true;
              resolve(networkResponse);
            }
          })
          .catch(async () => {
            clearTimeout(timer);
            const cached = await caches.match(event.request, { ignoreSearch: true });
            if (cached && !resolved) {
              resolved = true;
              resolve(cached);
            } else if (!resolved) {
              resolved = true;
              resolve(new Response('/* ServiceWorker Cache Fallback */', {
                status: 200,
                headers: { 'Content-Type': 'application/javascript; charset=utf-8' }
              }));
            }
          });
      })
    );
    return;
  }

  // Для остальных статических файлов (картинки, шрифты): Stale-While-Revalidate с ignoreSearch
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cached) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          }).catch(() => {});
        }
        return networkResponse;
      }).catch(() => {
        return cached;
      });

      return cached || fetchPromise;
    })
  );
});
