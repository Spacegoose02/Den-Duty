// Den Duty's service worker: only for push notifications (no offline caching, so updates are never stuck).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

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
