const CACHE = 'hydra-convert-v3';
const ASSETS = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

function isNavigationRequest(request) {
  if (request.mode === 'navigate') return true;
  try {
    const url = new URL(request.url);
    return url.pathname === '/' || url.pathname.endsWith('/index.html');
  } catch {
    return false;
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // Navegaciones (`/` e `/index.html`): network-first con fallback a caché offline.
  if (isNavigationRequest(event.request)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() =>
          caches
            .match(event.request)
            .then((cached) => cached || caches.match('/index.html')),
        ),
    );
    return;
  }
  // Estáticos (`/assets/*`, manifest y resto de GET): cache-first.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match('/index.html'));
    }),
  );
});
