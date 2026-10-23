// Offline cache. Bump VERSION when files change.
var VERSION = 'subs-v1';
var FILES = ['./', './index.html', './styles.css', './logic.js', './app.js', './manifest.webmanifest',
  './icon-180.png', './icon-192.png', './icon-512.png'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(function (r) {
    return r || fetch(e.request).then(function (resp) {
      if (resp && resp.ok && new URL(e.request.url).origin === location.origin) {
        var copy = resp.clone(); caches.open(VERSION).then(function (c) { c.put(e.request, copy); });
      }
      return resp;
    });
  }));
});
