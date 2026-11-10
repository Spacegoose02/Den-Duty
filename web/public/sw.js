// Den Duty's service worker: push notifications, and keeping the family tablet useful when the Wi-Fi drops.
// Everything is network first, so a new version is never stuck behind the cache: the saved copy is only used
// when the server can't be reached. Answers from the cache carry x-den-duty-offline: 1 so the app can say so.
// Only GET requests are touched; a kid's taps while offline wait in the app's outbox (web/src/offline.tsx).
const CACHE = 'den-duty-v1';
// API answers worth having offline: who's signed in and the home's pages (not exports, files, read-aloud audio or the
// admin area).
const API_OFFLINE = /^\/api\/(whoami$|kiosk\/|homes\/)/;
const API_SKIP = /\/(export|ics|backups?|upload|tts)|\.(csv|pdf|ics)$/;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('message', (e) => {
  // Signing out: forget the saved pages.
  if (e.data === 'clear-cache') e.waitUntil(caches.delete(CACHE));
});

const offlineCopy = async (key) => {
  const hit = await caches.match(key, { cacheName: CACHE });
  if (!hit) return null;
  const headers = new Headers(hit.headers);
  headers.set('x-den-duty-offline', '1');
  return new Response(await hit.blob(), { status: hit.status, statusText: hit.statusText, headers });
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const page = req.mode === 'navigate';
  const asset = url.pathname.startsWith('/assets/') || /\.(png|svg|ico|webmanifest|woff2?)$/.test(url.pathname);
  const api = API_OFFLINE.test(url.pathname) && !API_SKIP.test(url.pathname);
  if (!page && !asset && !api) return;
  // Every page is the same app shell, so one copy covers them all.
  const key = page ? '/' : req;
  e.respondWith((async () => {
    if (asset) {
      // Built files have a hash in their name, so a saved one is always right.
      const hit = await caches.match(req, { cacheName: CACHE });
      if (hit) return hit;
    }
    try {
      const res = await fetch(req);
      if (res.ok) {
        const copy = res.clone();
        e.waitUntil(caches.open(CACHE).then((c) => c.put(key, copy)));
      }
      return res;
    } catch (err) {
      const saved = await offlineCopy(key);
      if (saved) return saved;
      throw err;
    }
  })());
});

self.addEventListener('push', (e) => {
  let msg = { title: 'Den Duty' };
  try { msg = e.data ? e.data.json() : msg; } catch { msg = { title: e.data ? e.data.text() : 'Den Duty' }; }
  e.waitUntil(self.registration.showNotification(msg.title || 'Den Duty', {
    body: msg.body || '', tag: msg.tag, renotify: !!msg.tag, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: msg.url || '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url.startsWith(self.location.origin));
    if (open) { open.navigate(url).catch(() => {}); return open.focus(); }
    return self.clients.openWindow(url);
  }));
});
