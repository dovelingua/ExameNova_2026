// ============================================================
// service-worker.js
// ExameNova — Service Worker
// ============================================================
//
// STRATEGY:
//   Navigation requests    → Network first → offline.html fallback
//   Panel JS screen files  → Network first → cache fallback
//   Core assets            → Cache first   → network fallback
//   Firebase / Workers     → Network only  → never cached
//
// TO UPDATE THE APP:
//   Change CACHE_VERSION below to any new string.
//   Old cache is deleted automatically on next visit.
//   Students get new code immediately.
//
// NOTE:
//   ExameNova requires an active internet connection.
//   PWA is used for installability and native feel only.
//   Offline fallback shows a friendly screen — no offline use.
//
// ============================================================

const CACHE_VERSION = 'en-v1';
const CACHE_STATIC  = `${CACHE_VERSION}-static`;
const CACHE_SCREENS = `${CACHE_VERSION}-screens`;

// ── Files cached at install time ─────────────────────────────
// These load fast on slow connections.
// Update CACHE_VERSION whenever any of these files change.
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/panel/index.html',

  // PWA icons
  '/assets/icons/icon-192x192.png',
  '/assets/icons/icon-512x512.png',
  '/assets/icons/icon-96x96.png',

  // App images
  '/assets/images/favicon.png',
  '/assets/images/logo.png',
  '/assets/images/logo-dark.png',

  // Font Awesome — cached so icons never break on slow connections
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/webfonts/fa-solid-900.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/webfonts/fa-brands-400.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/webfonts/fa-regular-400.woff2',

  // Google Fonts — Inter
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap',
];

// ── URLs never cached — always live ──────────────────────────
const NEVER_CACHE = [
  'firestore.googleapis.com',
  'firebase.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'oauth2.googleapis.com',
  'examenova-platforma.examenova78.workers.dev',
  'emailing.examenova78.workers.dev',
  'api-text-inteligence.dovelingua.com',
  'cloudinary.com',
  'resend.com',
];

// ============================================================
// INSTALL — cache all static assets
// skipWaiting() means new SW takes over immediately on deploy
// ============================================================
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then(cache => {
        // Add one by one so one failure does not block the rest
        return Promise.allSettled(
          STATIC_ASSETS.map(url =>
            cache.add(url).catch(err => {
              console.warn('[SW] Failed to cache:', url, err);
            })
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

// ============================================================
// ACTIVATE — delete all old caches
// ============================================================
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => !key.startsWith(CACHE_VERSION))
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      ))
      .then(() => self.clients.claim())
  );
});

// ============================================================
// FETCH — main traffic controller
// ============================================================
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Ignore non-GET requests
  if (request.method !== 'GET') return;

  // 2. Never cache Firebase, Workers, AI, or email calls
  if (NEVER_CACHE.some(domain => url.hostname.includes(domain))) return;

  // 3. Navigation requests
  //    Network first → panel/index.html (SPA) → offline.html
  if (request.mode === 'navigate') {
    event.respondWith(_handleNavigation(request, url));
    return;
  }

  // 4. Panel JS screen files — network first so students
  //    always get fresh code after a deploy
  if (url.pathname.startsWith('/panel/js/')) {
    event.respondWith(_networkFirst(request, CACHE_SCREENS));
    return;
  }

  // 5. Static assets — cache first for speed
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname === '/manifest.json' ||
    url.hostname === 'cdnjs.cloudflare.com' ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  ) {
    event.respondWith(_cacheFirst(request, CACHE_STATIC));
    return;
  }

  // 6. Everything else — network only
});

// ============================================================
// NAVIGATION HANDLER
// Panel routes → serve panel/index.html (SPA shell)
// Public routes → serve fresh from network
// Fallback → offline.html
// ============================================================
async function _handleNavigation(request, url) {
  // Panel routes are always served by panel/index.html
  if (url.pathname.startsWith('/panel')) {
    try {
      const network = await fetch('/panel/index.html');
      const cache   = await caches.open(CACHE_STATIC);
      cache.put('/panel/index.html', network.clone());
      return network;
    } catch {
      const cached = await caches.match('/panel/index.html');
      if (cached) return cached;
      return _offlinePage();
    }
  }

  // Public routes — network first
  try {
    const networkResponse = await fetch(request);
    const cache           = await caches.open(CACHE_STATIC);
    cache.put('/index.html', networkResponse.clone());
    return networkResponse;
  } catch {
    const cachedIndex = await caches.match('/index.html');
    if (cachedIndex) return cachedIndex;
    return _offlinePage();
  }
}

// ============================================================
// NETWORK FIRST
// Tries network, falls back to cache if offline
// Used for JS screen files
// ============================================================
async function _networkFirst(request, cacheName) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return _offlinePage();
  }
}

// ============================================================
// CACHE FIRST
// Serves from cache immediately, updates cache in background
// Used for static assets — fonts, icons
// ============================================================
async function _cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) {
    // Update in background — stale-while-revalidate
    fetch(request).then(response => {
      if (response.ok) {
        caches.open(cacheName).then(cache => cache.put(request, response));
      }
    }).catch(() => {});
    return cached;
  }
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    return _offlinePage();
  }
}

// ============================================================
// OFFLINE PAGE FALLBACK
// ============================================================
async function _offlinePage() {
  const offline = await caches.match('/offline.html');
  if (offline) return offline;
  return new Response(
    `<html lang="pt"><body style="font-family:sans-serif;text-align:center;padding:60px 24px;">
      <h1>Sem ligação à internet</h1>
      <p>O ExameNova precisa de uma ligação activa para funcionar.</p>
      <button onclick="location.reload()">Tentar novamente</button>
    </body></html>`,
    { headers: { 'Content-Type': 'text/html' } }
  );
}

// ============================================================
// UPDATE CHECK
// router.js sends { type: 'CHECK_UPDATE' }
// SW replies { type: 'SW_UPDATED' } if new version is waiting
// Router shows the update toast to the student
// ============================================================
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'CHECK_UPDATE') {
    self.registration.update().then(() => {
      if (self.registration.waiting) {
        event.source.postMessage({ type: 'SW_UPDATED' });
      }
    }).catch(() => {});
  }
});
