// Service Worker for Web Push notifications.
//
// iOS Safari: Web Push ONLY works when the app is added to Home Screen as a PWA (iOS 16.4+).
// Android Chrome: works in both regular browser tabs and installed PWA.
// This is a platform constraint — not a bug.

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: event.data.text(), body: '' };
  }

  const { title = 'IranPharma', body = '', icon, image, link } = payload;

  const options = {
    body,
    icon: icon || '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    image: image || undefined,
    data: { url: link },
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const link = event.notification.data?.url;
  const targetUrl = link
    ? (link.startsWith('http') ? link : self.location.origin + link)
    : self.location.origin;

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // If a window for the origin is already open, focus it and navigate
        for (const client of clientList) {
          if (client.url.startsWith(self.location.origin) && 'focus' in client) {
            client.focus();
            if ('navigate' in client) client.navigate(targetUrl);
            return;
          }
        }
        // Otherwise open a new window
        if (clients.openWindow) return clients.openWindow(targetUrl);
      })
  );
});
