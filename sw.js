/* Offline support. Bump VERSION on every release so installed copies pick up new files. */
var VERSION = 'spendlog-2026-11-01d';
var SHELL = ['./', 'index.html', 'style.css', 'app.js', 'parse.js', 'sync.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png', 'icons/icon-maskable-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL.map(function (u) { return new Request(u, { cache: 'reload' }); })); }).then(function () { return self.skipWaiting(); }));
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

  // App shell: network first so every file comes from the same release; the cache is only for offline
  // or a very slow connection. Skipping the browser's HTTP cache stops old and new files mixing.
  e.respondWith(caches.open(VERSION).then(function (c) {
    var fromCache = function () {
      return c.match(req, { ignoreSearch: true }).then(function (hit) {
        return hit || (req.mode === 'navigate' ? c.match('index.html') : undefined);
      });
    };
    var net = fetch(req, { cache: 'no-cache' }).then(function (res) {
      if (res.ok) c.put(req, res.clone());
      return res;
    });
    var slow = new Promise(function (res) { setTimeout(res, 4000); }).then(fromCache);
    return Promise.race([net, slow.then(function (hit) { return hit || net; })])
      .catch(function () { return fromCache().then(function (hit) { return hit || Response.error(); }); });
  }));
});
