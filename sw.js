const CACHE = 'suivi-budget-v1';
const LOCAL_ASSETS = ['./index.html', './manifest.json'];

const BYPASS_DOMAINS = [
  'firebaseapp.com', 'googleapis.com', 'gstatic.com',
  'firebaseio.com', 'google.com', 'googletagmanager.com',
  'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'
];

function shouldBypass(url) {
  return BYPASS_DOMAINS.some(function(d) { return url.includes(d); });
}

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(cache) { return cache.addAll(LOCAL_ASSETS); })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  var url = e.request.url;
  // Ne jamais intercepter Firebase, Google, CDN externes
  if (shouldBypass(url)) return;
  // GET uniquement, fichiers locaux uniquement
  if (e.request.method !== 'GET') return;
  if (!url.startsWith(self.location.origin)) return;

  e.respondWith(
    fetch(e.request)
      .then(function(resp) {
        if (resp && resp.status === 200) {
          var clone = resp.clone();
          caches.open(CACHE).then(function(cache) { cache.put(e.request, clone); });
        }
        return resp;
      })
      .catch(function() { return caches.match(e.request); })
  );
});
