/* ==========================================================================
   STORM MULTIMEDIA - SERVICE WORKER v4 (БЫСТРЫЙ КЭШ И БЕЗОПАСНЫЕ ES-МОДУЛИ)
   ========================================================================== */

const APP_VERSION = '1.2.3';
const CACHE_NAME = `storm-multimedia-v5-${APP_VERSION}`;

// Минимальная оболочка при установке (< 70 КБ), чтобы не нагружать сеть и процессор при старте
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/assets/favicon.svg',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_ASSETS).catch(() => {});
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => (key !== CACHE_NAME ? caches.delete(key) : Promise.resolve()))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (data.type === 'PURGE_ALL_CACHES') {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
    );
  }
});

function isValidCacheableAsset(response, pathname) {
  if (!response || !response.ok || response.status !== 200 || response.type === 'error') {
    return false;
  }
  const ct = (response.headers.get('content-type') || '').toLowerCase();
  if (pathname.endsWith('.js') && !ct.includes('javascript') && !ct.includes('ecmascript')) {
    return false;
  }
  if (pathname.endsWith('.css') && !ct.includes('css')) {
    return false;
  }
  return true;
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Не перехватываем сторонние кросс-доменные запросы и сам sw.js
  if (url.origin !== self.location.origin || url.pathname === '/sw.js') {
    return;
  }

  // 1. API-запросы: прямой сетевой запрос с резервом каталога для офлайн-режима
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname === '/api/media/catalog') {
      event.respondWith(
        fetch(event.request)
          .then((netRes) => {
            if (netRes && netRes.status === 200) {
              const clone = netRes.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
            }
            return netRes;
          })
          .catch(async () => {
            const cached = await caches.match(event.request);
            if (cached) return cached;
            return new Response(JSON.stringify({ items: [], total_items: 0 }), {
              status: 200,
              headers: { 'Content-Type': 'application/json; charset=utf-8' }
            });
          })
      );
    }
    return;
  }

  // 2. HTML-страницы и навигация: всегда свежий Network-First (резерв из кэша только при обрыве сети)
  if (
    event.request.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname.endsWith('.html')
  ) {
    event.respondWith(
      fetch(event.request)
        .then((netRes) => {
          if (netRes && netRes.status === 200) {
            const clone = netRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
          }
          return netRes;
        })
        .catch(async () => {
          const exact = await caches.match(event.request, { ignoreSearch: true });
          if (exact) return exact;
          const fallbackIndex = await caches.match('/index.html');
          if (fallbackIndex) return fallbackIndex;
          throw new Error('Offline');
        })
    );
    return;
  }

  // 3. Версионированные скрипты и стили (?v=1.1.2-s3): мгновенный Cache-First СТРОГО по точному URL (без ignoreSearch и без фейковых заглушек!)
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    const hasVersionTag = url.searchParams.has('v') && !url.searchParams.has('retry');
    if (!hasVersionTag) {
      // Неверсионированные или retry-запросы идут напрямую в сеть
      return;
    }

    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        try {
          const netRes = await fetch(event.request, { cache: 'no-cache' });
          if (isValidCacheableAsset(netRes, url.pathname)) {
            cache.put(event.request, netRes.clone()).catch(() => {});
            return netRes;
          }
        } catch (_) {}
        const cached = await cache.match(event.request);
        if (cached && isValidCacheableAsset(cached, url.pathname)) {
          return cached;
        }
        return fetch(event.request);
      })
    );
    return;
  }

  // 4. Иконки, шрифты, локальные обложки: Cache-First с фоновым обновлением
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname === '/manifest.json' ||
    /\.(svg|png|webp|jpg|jpeg|ico|woff2?)$/i.test(url.pathname)
  ) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        const fetchPromise = fetch(event.request)
          .then((netRes) => {
            if (netRes && netRes.status === 200) {
              cache.put(event.request, netRes.clone()).catch(() => {});
            }
            return netRes;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    );
  }
});
