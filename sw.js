/* ═══════════════════════════════════════════════════════════════
   Service Worker — offline app shell
   • Same-origin files : network-first, fall back to cache when offline
                         (so a new deploy is picked up on the next load)
   • Pinned CDN assets : cache-first (Chart.js version, fonts)
   • Everything else   : NOT intercepted — Firebase RTDB, Firebase Auth,
                         Google Analytics always go straight to the network
   Bump CACHE_VERSION whenever the SHELL list changes.
   ═══════════════════════════════════════════════════════════════ */
const CACHE_VERSION = 'solar-v7-shell-1';

const SHELL = [
  './', './index.html', './404.html', './privacy.html', './terms.html',
  './manifest.json', './favicon.svg',
  './assets/css/style.css', './assets/css/legal.css',
  './assets/js/auth.js', './assets/js/site-manager.js', './assets/js/firebase-rest.js',
  './assets/js/charts.js', './assets/js/alarms.js', './assets/js/analytics.js',
  './assets/js/solar-physics.js', './assets/js/roi.js', './assets/js/consent.js',
  './assets/js/tracking.js', './assets/js/ux-polish.js', './assets/js/app.js',
  './assets/img/apple-touch-icon.png', './assets/img/favicon-32x32.png'
];

const CDN_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache =>
      Promise.all(SHELL.map(url => cache.add(url).catch(() => {})))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;                       // never touch POST/PUT/PATCH (Firebase, Auth)

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const cdn = CDN_HOSTS.includes(url.hostname);
  if (!sameOrigin && !cdn) return;                        // Firebase, Auth, Analytics → network only

  if (cdn) {                                              // versioned/immutable → cache-first
    event.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE_VERSION).then(c => c.put(req, copy)); }
        return res;
      }))
    );
    return;
  }

  event.respondWith(                                      // app files → network-first
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE_VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() =>
      caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
    )
  );
});
