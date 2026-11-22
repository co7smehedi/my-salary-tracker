/* My Salary Tracker - service worker. Network-first (so updates arrive quickly), cached copy when offline. It does not read or write any saved records. */
const VERSION = '9.4.1';
const CACHE = 'mst-v' + VERSION.replace(/\./g, '-');
const CORE = ['./', './index.html', './style.css', './i18n.js', './calc.js', './backup-rules.js', './app.js', './recover.js', './manifest.json', './recover.html',
  './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE.map((u) => new Request(u, { cache: 'reload' })));   // if any file is missing, install fails and the old version keeps working
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('mst-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
      return res;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') { const page = await caches.match('./index.html'); if (page) return page; }
      return Response.error();
    }
  })());
});
