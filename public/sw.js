const CACHE = 'clipboard-bridge-v1';

self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll([
        '/',
        '/index.html',
        '/style.css',
        '/app.js',
        '/fav.png',
        '/logo.png',
        '/vendor/socket.io/client-dist/socket.io.min.js',
        '/vendor/html5-qrcode/html5-qrcode.min.js'
      ])
    )
  );
});

self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
});

self.addEventListener('fetch', (evt) => {
  evt.respondWith(
    fetch(evt.request).catch(() => caches.match(evt.request))
  );
});
