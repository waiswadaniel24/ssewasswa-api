const CACHE = 'ssewasswa-v9.0';
const urlsToCache = ['/', '/offline', '/manifest.json'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(urlsToCache))));
self.addEventListener('fetch', e => {
  if (e.request.method === 'GET') e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).catch(() => caches.match('/offline'))));
});
