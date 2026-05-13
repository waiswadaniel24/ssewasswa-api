const CACHE = 'comfort-v2.0';
const urlsToCache = ['/offline', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(urlsToCache)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Network-first for HTML pages (always get fresh content)
  const url = new URL(e.request.url);
  if (url.pathname === '/' || url.pathname.endsWith('.html') || url.pathname.startsWith('/blog') || url.pathname.startsWith('/p/')) {
    e.respondWith(
      fetch(e.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return response;
      }).catch(() => caches.match('/offline'))
    );
    return;
  }
  // Cache-first for static assets (images, CSS, JS, fonts)
  e.respondWith(
    caches.match(e.request).then(r => {
      if (r) return r;
      return fetch(e.request).then(response => {
        if (response.ok && e.request.url.startsWith(self.location.origin)) {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return response;
      }).catch(() => caches.match('/offline'));
    })
  );
});

self.addEventListener('sync', e => {
  if (e.tag === 'sync-data') {
    e.waitUntil(syncOfflineData());
  }
});

async function syncOfflineData() {
  try {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('ssewasswa', 1);
      request.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('pending')) {
          db.createObjectStore('pending', { keyPath: 'id', autoIncrement: true });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const tx = db.transaction('pending', 'readwrite');
    const store = tx.objectStore('pending');
    const items = await new Promise((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
    });

    for (const item of items) {
      try {
        const res = await fetch(item.url, {
          method: item.method || 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item.data)
        });
        if (res.ok) {
          store.delete(item.id);
        }
      } catch (e) {
        console.warn('Sync failed for item', item.id, e.message);
      }
    }
  } catch (e) {
    console.warn('Sync error:', e.message);
  }
}
