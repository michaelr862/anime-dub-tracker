const CACHE_NAME = 'anime-dub-tracker-v1';
const ASSETS = [
  '/index.html',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Network first for API calls, cache first for app shell
  if (event.request.url.includes('animeschedule.net')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
  } else {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request))
    );
  }
});

// Listen for messages from the extension
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'EXTENSION_DATA') {
    // Broadcast to all open clients
    self.clients.matchAll().then(clients => {
      clients.forEach(client => client.postMessage(event.data));
    });
  }
});
