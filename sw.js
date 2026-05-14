var CACHE = 'suivi-budget-v36';
var SHELL = ['./icon.svg', './manifest.json'];

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
  var url = e.request.url;

  // Ne pas intercepter Firebase / CDN
  if (url.indexOf('firestore') !== -1 || url.indexOf('firebase') !== -1 ||
      url.indexOf('gstatic') !== -1 || url.indexOf('gocardless') !== -1 ||
      url.indexOf('googleapis') !== -1) {
    return;
  }

  // Network-first pour index.html : toujours chercher la version fraîche
  if (e.request.mode === 'navigate' || url.indexOf('index.html') !== -1) {
    e.respondWith(
      fetch(e.request).then(function(resp) {
        var clone = resp.clone();
        caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
        return resp;
      }).catch(function() {
        return caches.match('./index.html');
      })
    );
    return;
  }

  // Cache-first pour les autres ressources statiques
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      return cached || fetch(e.request).then(function(resp) {
        if (url.indexOf(self.location.origin) === 0) {
          var clone = resp.clone();
          caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
        }
        return resp;
      });
    }).catch(function() {
      if (e.request.mode === 'navigate') return caches.match('./index.html');
    })
  );
});
