// ============================================================
// Comfort Platform — Enhanced Service Worker v2.0
// ============================================================
// Strategies:
//   - Cache-first: static assets (HTML, CSS, JS, images, fonts)
//   - Network-first: API calls (/api/, mutations)
//   - Stale-while-revalidate: frequently updated data
//   - Background sync: offline CRUD operations queue
//   - Push notifications: enhanced with data and actions
//   - Periodic background sync (if supported)
// ============================================================

const CACHE_NAME = 'comfort-v2.0';
const STATIC_CACHE = 'comfort-static-v2.0';
const DATA_CACHE = 'comfort-data-v2.0';
const OFFLINE_CACHE = 'comfort-offline-v2.0';

// Assets to pre-cache on install
const PRECACHE_URLS = [
  '/',
  '/offline',
  '/manifest.json',
  '/manifest.webmanifest',
  '/icon.png',
  '/favicon.svg',
  '/favicon.png'
];

// Cache-first: static assets (CSS, JS, images, fonts)
const STATIC_EXTENSIONS = [
  '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp',
  '.woff', '.woff2', '.ttf', '.eot', '.ico', '.map'
];

// Network-first: API calls
const API_PREFIXES = ['/api/', '/marketplace/', '/sync'];

// Stale-while-revalidate: frequently updated data
const SWR_PREFIXES = ['/dashboard', '/students', '/fees'];

// ============================================================
// INSTALL EVENT
// ============================================================
self.addEventListener('install', event => {
  console.log('[SW] Installing service worker v2.0...');
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => {
      return cache.addAll(PRECACHE_URLS).catch(err => {
        console.warn('[SW] Pre-cache failed for some URLs:', err.message);
        // Continue even if some URLs fail
        return Promise.resolve();
      });
    }).then(() => {
      console.log('[SW] Pre-caching complete');
      return self.skipWaiting();
    })
  );
});

// ============================================================
// ACTIVATE EVENT
// ============================================================
self.addEventListener('activate', event => {
  console.log('[SW] Activating service worker v2.0...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME && name !== STATIC_CACHE && name !== DATA_CACHE && name !== OFFLINE_CACHE)
          .map(name => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      console.log('[SW] Cache cleanup complete');
      return self.clients.claim();
    })
  );
});

// ============================================================
// FETCH EVENT — Routing strategies
// ============================================================
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const method = event.request.method;

  // Skip non-GET requests (handled by background sync for offline)
  if (method !== 'GET') {
    // For mutations: if online, let through. If offline, queue for sync.
    if (!navigator.onLine) {
      event.respondWith(queueOfflineRequest(event.request));
      return;
    }
    return;
  }

  // Skip cross-origin requests (except CDN)
  if (url.origin !== self.location.origin) {
    // Allow CDN resources to be cached
    if (url.hostname.includes('cdn.jsdelivr.net') ||
        url.hostname.includes('cdnjs.cloudflare.com') ||
        url.hostname.includes('fonts.gstatic.com')) {
      event.respondWith(cacheFirst(event.request));
      return;
    }
    return;
  }

  // === Strategy 1: Cache-first for static assets ===
  const isStatic = STATIC_EXTENSIONS.some(ext => url.pathname.endsWith(ext));
  if (isStatic) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // === Strategy 2: Network-first for API calls ===
  if (API_PREFIXES.some(prefix => url.pathname.startsWith(prefix))) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // === Strategy 3: Stale-while-revalidate for dynamic pages ===
  if (SWR_PREFIXES.some(prefix => url.pathname.startsWith(prefix))) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // === Default: Network-first with offline fallback ===
  event.respondWith(networkFirstWithOfflineFallback(event.request));
});

// ============================================================
// CACHING STRATEGY FUNCTIONS
// ============================================================

/**
 * Cache-first: Serve from cache, fallback to network
 * Best for: static assets that rarely change
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    // Return a minimal response for images
    if (request.destination === 'image') {
      return new Response(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="#e2e8f0" width="100" height="100"/><text x="50" y="55" text-anchor="middle" fill="#94a3b8" font-size="12">No image</text></svg>',
        { headers: { 'Content-Type': 'image/svg+xml' } }
      );
    }
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

/**
 * Network-first: Try network, fallback to cache
 * Best for: API calls, dynamic data
 */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DATA_CACHE);
      // Cache API responses for 5 minutes
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) {
      // Add offline indicator header
      const headers = new Headers(cached.headers);
      headers.set('X-From-Cache', 'true');
      headers.set('X-Offline', 'true');
      return new Response(cached.body, {
        status: cached.status,
        statusText: cached.statusText,
        headers
      });
    }
    // Return offline fallback for API calls
    return new Response(
      JSON.stringify({ error: 'You are offline. This data is not available cached.', offline: true }),
      { headers: { 'Content-Type': 'application/json', 'X-Offline': 'true' }, status: 503 }
    );
  }
}

/**
 * Stale-while-revalidate: Serve from cache, update in background
 * Best for: frequently updated but tolerable to be slightly stale
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(DATA_CACHE);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then(response => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => {
    // Network failed, cache already served above
  });

  // Return cached immediately, or wait for network
  return cached || fetchPromise;
}

/**
 * Network-first with offline page fallback
 * Best for: HTML pages
 */
async function networkFirstWithOfflineFallback(request) {
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;

    // Try offline page
    const offlinePage = await caches.match('/offline');
    if (offlinePage) return offlinePage;

    return new Response(offlineFallbackHTML(), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 503
    });
  }
}

/**
 * Queue a request for offline sync
 */
async function queueOfflineRequest(request) {
  try {
    const body = await request.text();
    const entry = {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body: body,
      timestamp: Date.now(),
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 9)
    };

    // Store in IndexedDB
    const db = await openDB();
    const tx = db.transaction('sync-queue', 'readwrite');
    const store = tx.objectStore('sync-queue');
    store.add(entry);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });

    // Register sync if supported
    if ('sync' in registration) {
      try {
        await registration.sync.register('comfort-sync');
      } catch (e) {
        console.warn('[SW] Sync registration failed:', e.message);
      }
    }

    return new Response(
      JSON.stringify({ queued: true, message: 'Operation queued for sync when online', offline: true }),
      { headers: { 'Content-Type': 'application/json' }, status: 202 }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to queue operation', details: error.message }),
      { headers: { 'Content-Type': 'application/json' }, status: 500 }
    );
  }
}

// ============================================================
// INDEXED DB HELPER
// ============================================================
let dbPromise = null;
function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('comfort-pwa', 2);
      request.onupgradeneeded = event => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('sync-queue')) {
          const store = db.createObjectStore('sync-queue', { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp');
        }
        if (!db.objectStoreNames.contains('offline-data')) {
          db.createObjectStore('offline-data', { keyPath: 'url' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

// ============================================================
// BACKGROUND SYNC
// ============================================================
self.addEventListener('sync', event => {
  console.log('[SW] Background sync triggered:', event.tag);

  if (event.tag === 'comfort-sync') {
    event.waitUntil(processSyncQueue());
  }

  if (event.tag === 'comfort-data-sync') {
    event.waitUntil(syncOfflineData());
  }
});

async function processSyncQueue() {
  console.log('[SW] Processing sync queue...');
  let processed = 0;
  let failed = 0;

  try {
    const db = await openDB();
    const tx = db.transaction('sync-queue', 'readwrite');
    const store = tx.objectStore('sync-queue');

    const items = await new Promise((resolve, reject) => {
      const req = store.index('timestamp').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    for (const item of items) {
      try {
        const response = await fetch(item.url, {
          method: item.method || 'POST',
          headers: item.headers || { 'Content-Type': 'application/json' },
          body: item.body || undefined
        });

        if (response.ok || response.status < 500) {
          await new Promise((resolve, reject) => {
            const delReq = store.delete(item.id);
            delReq.onsuccess = resolve;
            delReq.onerror = () => reject(delReq.error);
          });
          processed++;
        } else {
          failed++;
          // Keep in queue for retry
        }
      } catch (e) {
        console.warn('[SW] Sync item failed:', item.id, e.message);
        failed++;
      }
    }
  } catch (e) {
    console.warn('[SW] Sync queue error:', e.message);
  }

  console.log('[SW] Sync complete:', processed, 'processed,', failed, 'failed');

  // Notify clients about sync status
  self.clients.matchAll({ type: 'window' }).then(clients => {
    clients.forEach(client => {
      client.postMessage({
        type: 'SYNC_COMPLETE',
        processed,
        failed,
        timestamp: Date.now()
      });
    });
  });
}

/**
 * Sync offline data — download fresh data for key endpoints
 */
async function syncOfflineData() {
  console.log('[SW] Syncing offline data...');
  const endpoints = [
    '/dashboard',
    '/api/v1/sync/status'
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint);
      if (response.ok) {
        const cache = await caches.open(DATA_CACHE);
        await cache.put(endpoint, response);
      }
    } catch (e) {
      console.warn('[SW] Data sync failed for:', endpoint);
    }
  }
}

// ============================================================
// PUSH NOTIFICATIONS (Enhanced)
// ============================================================
self.addEventListener('push', event => {
  let data = {
    title: 'Comfort',
    body: 'You have a new notification',
    icon: '/icon.png',
    badge: '/icon.png',
    url: '/',
    tag: 'comfort-notification',
    requireInteraction: false,
    vibrate: [200, 100, 200],
    data: {}
  };

  try {
    const pushData = event.data ? event.data.json() : {};
    Object.assign(data, pushData);
  } catch (e) {
    // Use default data
  }

  const options = {
    body: data.body,
    icon: data.icon || '/icon.png',
    badge: data.badge || '/icon.png',
    vibrate: data.vibrate || [200, 100, 200],
    tag: data.tag || 'comfort-' + Date.now(),
    requireInteraction: data.requireInteraction || false,
    data: {
      url: data.url || '/',
      ...data.data
    },
    actions: data.actions || [
      { action: 'view', title: 'View' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Handle notification click
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const action = event.action;
  const url = event.notification.data?.url || '/';

  if (action === 'dismiss') return;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // Focus existing window or open new one
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

// Handle notification close
self.addEventListener('notificationclose', event => {
  // Track dismissed notifications if needed
  console.log('[SW] Notification dismissed:', event.notification.tag);
});

// ============================================================
// MESSAGE HANDLER — Communication from main thread
// ============================================================
self.addEventListener('message', event => {
  const { type, payload } = event.data || {};

  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
    case 'CLEAR_CACHE':
      caches.keys().then(names => {
        names.forEach(name => caches.delete(name));
      });
      break;
    case 'CACHE_URLS':
      if (payload && Array.isArray(payload.urls)) {
        caches.open(STATIC_CACHE).then(cache => cache.addAll(payload.urls));
      }
      break;
    case 'GET_CACHE_SIZE':
      caches.keys().then(names => {
        let total = 0;
        return Promise.all(
          names.map(name => caches.open(name).then(c => c.keys()).then(keys => {
            total += keys.length;
            return keys.length;
          }))
        ).then(sizes => {
          event.ports[0].postMessage({ total, byCache: sizes });
        });
      });
      break;
  }
});

// ============================================================
// PERIODIC BACKGROUND SYNC (if supported)
// ============================================================
if ('periodicSync' in registration) {
  self.addEventListener('periodicsync', event => {
    if (event.tag === 'comfort-refresh') {
      console.log('[SW] Periodic background sync triggered');
      event.waitUntil(syncOfflineData());
    }
  });
}

// ============================================================
// OFFLINE FALLBACK HTML
// ============================================================
function offlineFallbackHTML() {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline - Comfort</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f9ff;color:#1e293b;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.card{background:white;border-radius:20px;padding:40px;max-width:420px;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.1)}
h1{font-size:24px;margin-bottom:8px}
.icon{font-size:56px;margin-bottom:16px;display:block}
.btn{display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;text-decoration:none;border-radius:12px;font-weight:700;margin-top:20px;border:none;cursor:pointer;font-size:16px}
.btn:hover{transform:translateY(-2px);box-shadow:0 8px 25px rgba(79,70,229,.4)}
.muted{color:#64748b;font-size:14px;margin-top:8px}
.indicator{display:inline-block;width:10px;height:10px;border-radius:50%;background:#f59e0b;margin-right:6px;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.info{background:#f8fafc;border-radius:12px;padding:16px;margin-top:16px;text-align:left;font-size:13px;color:#475569}
.info li{margin-bottom:6px;margin-left:18px}
</style></head>
<body>
<div class="card">
  <span class="icon">📡</span>
  <h1>You're Offline</h1>
  <p>Don't worry — your data is safe and will sync automatically when you reconnect.</p>
  <div class="info">
    <ul>
      <li><span class="indicator"></span>Any changes you make will be queued</li>
      <li><span class="indicator"></span>Cached data is still available to view</li>
      <li><span class="indicator"></span>Sync resumes when connection returns</li>
    </ul>
  </div>
  <a href="/" class="btn">Try Again</a>
  <p class="muted">Last synced: <span id="last-sync">${new Date().toLocaleTimeString()}</span></p>
</div>
<script>
// Monitor connection status
window.addEventListener('online', function() { window.location.reload(); });
navigator.connection && navigator.connection.addEventListener('change', function() {
  if (navigator.connection.type !== 'none') window.location.reload();
});
</script>
</body></html>`;
}