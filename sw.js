/* Offline support. Bump VERSION on every release so installed copies pick up new files. */
var VERSION = 'spendlog-2026-11-01b';
var SHELL = ['./', 'index.html', 'style.css', 'app.js', 'parse.js', 'sync.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png', 'icons/icon-maskable-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION && k.indexOf('spendlog-') === 0; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // OCR engine and language files are large and never change: cache-first, in a cache that survives releases.
  if (url.pathname.indexOf('/vendor/') > -1) {
    e.respondWith(caches.open('spendlog-vendor').then(function (c) {
      return c.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) { if (res.ok) c.put(req, res.clone()); return res; });
      });
    }));
    return;
  }

  // App shell: answer from cache straight away, refresh it in the background.
  e.respondWith(caches.open(VERSION).then(function (c) {
    return c.match(req, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(req).then(function (res) { if (res.ok) c.put(req, res.clone()); return res; })
        .catch(function () { return hit || (req.mode === 'navigate' ? c.match('index.html') : Response.error()); });
      return hit || net;
    });
  }));
});
