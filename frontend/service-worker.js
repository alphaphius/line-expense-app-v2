const CACHE_NAME = 'line-expense-v2-shell-2';
const SHELL = ['./', './index.html', './styles.css', './config.js', './api.js', './image-optimizer.js', './app.js', './pwa.js', './manifest.webmanifest', './icons/app-icon-192.png', './vendor/sweetalert2.all.min.js', './vendor/chart.umd.js'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok && ['script', 'style', 'document', 'manifest'].includes(event.request.destination)) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
    }
    return response;
  }).catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html'))));
});
