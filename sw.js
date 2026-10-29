// App files: network-first so pushed updates reach installed copies; the cache is the offline fallback.
// Places packs: stale-while-revalidate, so they load instantly and don't re-download on every launch.
const CACHE = 'calibr-v4';
const FILES = ['./', 'index.html', 'styles.css', 'app.js', 'logic.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));

const isPack = url => /\/packs\/[^/]+\.json$/.test(url.pathname) && !url.pathname.endsWith('/index.json');

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (isPack(url)) {
    e.respondWith(caches.open(CACHE).then(async cache => {
      const cached = await cache.match(e.request);
      const refresh = fetch(e.request).then(res => { if (res.ok) cache.put(e.request, res.clone()); return res; });
      if (cached) { refresh.catch(() => {}); return cached; } // update in the background for next time
      return refresh;
    }));
    return;
  }
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
