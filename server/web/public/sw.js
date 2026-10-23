// Keeps the app shell available when the connection is slow or gone. The API is never cached:
// times always come from the server. Build id: __BUILD__ (changes on every build, so updates replace the cache).
const CACHE = 'gnomon-__BUILD__';
const SHELL = ['/', '/app.js', '/app.css', '/manifest.webmanifest', '/apple-touch-icon.png', '/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // The download page (/latest), the web demo (/example), the site (/about) and the setup/admin pages are separate pages, never cached as the app shell.
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/latest') || url.pathname.startsWith('/example') || url.pathname.startsWith('/about') || url.pathname.startsWith('/account') || /^\/(setup|admin)/.test(url.pathname)) return;
  // Network first, so a new deploy shows up right away; the cache is the fallback.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(url.pathname.includes('.') ? e.request : '/', copy));
        }
        return res;
      })
      .catch(() => caches.match(url.pathname.includes('.') ? e.request : '/')),
  );
});
