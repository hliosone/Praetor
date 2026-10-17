// Service worker (spec 07): an offline shell for the app's static files, and Web Push notifications. The api is
// never cached: balances and decisions always come from the chain.
const SHELL = 'praetor-shell-v1';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon.svg'])));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request).then((r) => r || caches.match('/'))));
});
self.addEventListener('push', (e) => {
  const d = e.data ? e.data.json() : { title: 'Praetor', body: '' };
  e.waitUntil(self.registration.showNotification(d.title || 'Praetor', { body: d.body, icon: '/icon.svg', data: { url: d.url || '/home' } }));
});
// A notification opens a page of this app only: its link comes from the notifier's callers, never another site.
const appPage = (url) => {
  try {
    const u = new URL(url || '/home', self.location.origin);
    if (u.origin === self.location.origin) return u.href;
  } catch {
    // not a URL: the home page
  }
  return new URL('/home', self.location.origin).href;
};
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.openWindow(appPage(e.notification.data && e.notification.data.url)));
});
