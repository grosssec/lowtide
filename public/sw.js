// Service worker: shows the daily push and opens the app when it is tapped. No offline cache on purpose:
// money numbers should never come from a stale copy.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let message = { title: 'Lowtide', body: '', url: '/#month' };
  try {
    if (event.data) message = { ...message, ...event.data.json() };
  } catch {
    if (event.data) message.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // A newer daily message replaces the older one instead of stacking up.
      tag: 'daily',
      data: { url: message.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Only ever open the app itself, whatever the payload says.
  const target = new URL(event.notification.data?.url ?? '/', self.location.origin);
  const url = target.origin === self.location.origin ? target.href : self.location.origin;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) return open.navigate(url).then((client) => (client ?? open).focus());
      return self.clients.openWindow(url);
    }),
  );
});

// The browser rotated the subscription: hand the new one to the server (same-origin, so the session cookie goes along).
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const subscription =
        event.newSubscription ??
        (await self.registration.pushManager.subscribe(event.oldSubscription?.options ?? { userVisibleOnly: true }));
      await fetch('/api/push/subscribe', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'finance-dashboard' },
        body: JSON.stringify(subscription.toJSON()),
      });
    })(),
  );
});
