const CACHE='ssewasswa-v6.0';
const urlsToCache=['/','/offline','/manifest.json','/icon-192.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(urlsToCache))));
self.addEventListener('fetch',e=>{if(e.request.method==='GET')e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).catch(()=>caches.match('/offline'))));});
self.addEventListener('sync',e=>{if(e.tag==='sync-data')e.waitUntil(syncOfflineData());});
async function syncOfflineData(){const db=await indexedDB.open('ssewasswa',1);}
