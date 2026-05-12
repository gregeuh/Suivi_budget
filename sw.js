var CACHE = 'suivi-budget-v9';
var SHELL = ['./index.html', './icon.svg', './manifest.json'];

self.addEventListener('install', function(e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function(c) { return c.addAll(SHELL); })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  // Ne pas intercepter les requêtes Firebase / GoCardless / CDN
  var url = e.request.url;
  if (url.indexOf('firestore') !== -1 || url.indexOf('firebase') !== -1 ||
      url.indexOf('gstatic') !== -1 || url.indexOf('gocardless') !== -1 ||
      url.indexOf('googleapis') !== -1) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      return cached || fetch(e.request).then(function(resp) {
        // Mettre en cache uniquement les ressources locales
        if (e.request.url.indexOf(self.location.origin) === 0) {
          var clone = resp.clone();
          caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
        }
        return resp;
      });
    }).catch(function() {
      // Offline : servir index.html pour les navigations
      if (e.request.mode === 'navigate') return caches.match('./index.html');
    })
  );
});
