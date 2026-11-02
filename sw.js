// Service worker: la app funciona sin conexión (el mapa necesita red; la ruta se graba igual).
const CACHE = 'runnin-g-v1';
const ASSETS = ['./', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/util.js', 'js/store.js', 'js/plan.js', 'js/coach.js', 'js/tracker.js', 'js/export.js', 'js/ai.js', 'js/hr.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.hostname === 'api.anthropic.com') return;
  if (u.hostname.includes('basemaps.cartocdn.com')) { // teselas: red primero, caché después
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE + '-tiles').then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
    return;
  }
  // app: red primero (para recibir actualizaciones), caché si no hay conexión
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; }).catch(() => caches.match(e.request)));
});
