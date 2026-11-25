/* ==========================================================================
   PitStop — Service Worker
   Handles push events, notification clicks, and local cache fallback.
   ========================================================================== */

const CACHE_NAME = 'pitstop-cache-v1';
const STATIC_ASSETS = [
  './',
  './index.html',
  './garage.html',
  './vehicle.html',
  './css/variables.css',
  './css/base.css',
  './css/components.css',
  './css/garage.css',
  './css/vehicle.css',
  './css/trip.css',
  './css/dealership.css',
  './js/app.js',
  './js/storage.js',
  './js/maintenance-alerts.js',
  './js/garage.js',
  './js/vehicle.js',
  './js/dealership.js',
  './assets/icon-transparent.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => null)
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request, { ignoreSearch: true }))
  );
});

self.addEventListener('push', (event) => {
  let payload = {
    title: 'PitStop Maintenance Alert',
    body: 'A tracked vehicle part is due or overdue. Tap to review all.',
    url: new URL('garage.html?show=attention', self.registration.scope).href,
    tag: 'pitstop-maintenance-alerts',
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      payload = { ...payload, ...parsed };
    } catch (_) {
      payload.body = event.data.text() || payload.body;
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: 'assets/icon-transparent.png',
      badge: 'assets/icon-transparent.png',
      tag: payload.tag || 'pitstop-maintenance-alerts',
      silent: false,
      renotify: true,
      data: {
        url: new URL(payload.url || 'garage.html?show=attention', self.registration.scope).href,
      },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(
    (event.notification.data && event.notification.data.url) || 'garage.html?show=attention',
    self.registration.scope
  ).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) {
            return client.navigate(targetUrl);
          }
          return Promise.resolve();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return Promise.resolve();
    })
  );
});