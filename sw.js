// ================= Faraidh Calculator — Service Worker =================
// Bump this on every deploy so old caches get cleaned up automatically.
const CACHE_VERSION = 'faraidh-v1';
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// Everything the app needs to fully boot with zero network access.
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Google Fonts stylesheet + font files — cached opportunistically so the
// custom font still shows up offline after the first successful visit.
const FONT_ORIGINS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_SHELL_CACHE);
    // addAll would fail the whole install if even one resource 404s —
    // add the shell items individually so a single miss can't block install.
    await Promise.all(APP_SHELL.map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res.ok) await cache.put(url, res);
      } catch (err) { /* offline during install — shell item skipped, fine */ }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith('faraidh-') && key !== APP_SHELL_CACHE && key !== RUNTIME_CACHE)
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

function isFontRequest(url) {
  return FONT_ORIGINS.some((origin) => url.startsWith(origin));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = request.url;

  // --- Navigations (opening/reloading the app): cache-first app shell,
  // so the calculator opens instantly and fully offline. ---
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const network = await fetch(request);
        const cache = await caches.open(APP_SHELL_CACHE);
        cache.put('./index.html', network.clone());
        return network;
      } catch (err) {
        const cache = await caches.open(APP_SHELL_CACHE);
        return (await cache.match('./index.html')) || (await cache.match('./'));
      }
    })());
    return;
  }

  // --- Same-origin app shell assets: cache-first, refresh in background. ---
  if (url.startsWith(self.location.origin)) {
    event.respondWith((async () => {
      const cache = await caches.open(APP_SHELL_CACHE);
      const cached = await cache.match(request);
      const networkFetch = fetch(request)
        .then((res) => { if (res && res.ok) cache.put(request, res.clone()); return res; })
        .catch(() => null);
      return cached || (await networkFetch) || new Response('Offline', { status: 503 });
    })());
    return;
  }

  // --- Google Fonts (cross-origin): network-first, fall back to cache. ---
  if (isFontRequest(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      try {
        const res = await fetch(request);
        if (res && res.ok) cache.put(request, res.clone());
        return res;
      } catch (err) {
        const cached = await cache.match(request);
        return cached || new Response('', { status: 504 });
      }
    })());
    return;
  }

  // Everything else: just let the network handle it.
});
