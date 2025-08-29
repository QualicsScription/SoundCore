self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open('hyena-v1');
    await cache.addAll([
      '/',
      '/index.html',
      '/style.css',
      '/app.js',
      '/manifest.json'
    ]);
  })());
});

self.addEventListener('fetch', (e) => {
  e.respondWith((async () => {
    const r = await caches.match(e.request);
    if (r) return r;
    const resp = await fetch(e.request);
    return resp;
  })());
});