const CACHE_NAME='ssewasswa-v6.0';
const urlsToCache=['/','/offline','/manifest.json','/icon-192.png','/icon-512.png'];

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(urlsToCache)));
});

self.addEventListener('fetch',e=>{
  if(e.request.method==='GET'){
    e.respondWith(
      caches.match(e.request).then(r=>r||fetch(e.request).then(resp=>{
        return caches.open(CACHE_NAME).then(cache=>{
          cache.put(e.request,resp.clone());
          return resp;
        });
      }).catch(()=>caches.match('/offline')))
    );
  }
});

self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>k!==CACHE_NAME?caches.delete(k):null))));
});

// Background Sync for offline data
self.addEventListener('sync',e=>{
  if(e.tag==='sync-data'){
    e.waitUntil(syncOfflineData());
  }
});

async function syncOfflineData(){
  const db=await indexedDB.open('ssewasswa',1);
  // Sync logic handled by client
}
