// Version: bump this number any time you deploy new files
// This forces the old cache to be deleted and new files fetched
const CACHE_NAME = 'anime-dub-tracker-v3';

self.addEventListener('install', event => {
  // Skip waiting so this new SW activates immediately
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  // Delete ALL old caches regardless of name
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // Always go to network first for everything
  // Fall back to cache only if network fails
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache a copy of successful responses
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
