// Guarda la app para que abra aunque no haya conexión. Los datos de AniList y GitHub no se guardan aquí.
const CACHE = 'mis-animes-v2';
const APP = ['./', 'index.html', 'manifest.webmanifest', 'icono-192.png', 'icono-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(APP)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== CACHE + '-img').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // la app: primero la red (para tener siempre la última versión) y si no hay, la guardada
  if (url.origin === location.origin) {
    e.respondWith(fetch(e.request).then(r => {
      const copia = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copia)); return r;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
    return;
  }
  // portadas de AniList: guardadas para verlas sin conexión
  if (url.hostname.endsWith('anilist.co') && e.request.destination === 'image') {
    e.respondWith(caches.open(CACHE + '-img').then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const r = await fetch(e.request);
      if (r.ok || r.type === 'opaque') c.put(e.request, r.clone());
      return r;
    }));
  }
});
