// AquaNim service worker — app shell offline, API sempre da rede.
const SW_VERSION = 'aquanim-v3';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/css/style.css',
  '/css/event-crush.css',
  '/css/tutorial.css',
  '/js/i18n.js',
  '/js/data.js',
  '/js/api.js',
  '/js/audio.js',
  '/js/tank.js',
  '/js/ui.js',
  '/js/event-crush.js',
  '/js/tutorial.js',
  '/js/grab.js',
  '/js/app.js',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SW_VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SW_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Nunca cachear API: estado do jogo sempre vem da rede.
  if (url.pathname.startsWith('/api/')) return;
  // Só GET.
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request).then((res) => {
        if (res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(SW_VERSION).then((cache) => cache.put(event.request, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
