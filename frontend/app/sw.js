import { CacheFirst, ExpirationPlugin, NetworkFirst, NetworkOnly, Serwist } from "serwist";

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  runtimeCaching: [
    // Rasayesh API - GraphQL with PII/tokens, entire domain must never be cached.
    {
      matcher: ({ url }) => url.hostname === "api.rasayesh.com",
      handler: new NetworkOnly(),
    },
    // Live XP/quest/stats polling - explicit belt-and-suspenders on top of the
    // general internal-API rule below, in case that rule is ever narrowed.
    {
      matcher: ({ url }) =>
        url.hostname === "app.iphexpo.com" &&
        /^\/api\/(quest|xp|stats)\//.test(url.pathname),
      handler: new NetworkOnly(),
    },
    // All other internal API routes - never cache.
    {
      matcher: ({ url }) =>
        url.hostname === "app.iphexpo.com" && url.pathname.startsWith("/api/"),
      handler: new NetworkOnly(),
    },
    // Next.js build assets are content-hashed - safe to cache aggressively.
    {
      matcher: ({ url }) =>
        url.hostname === "app.iphexpo.com" &&
        url.pathname.startsWith("/_next/static/"),
      handler: new CacheFirst({
        cacheName: "iph-next-static",
        plugins: [
          new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 }),
        ],
      }),
    },
    // Images
    {
      matcher: /\.(?:png|jpe?g|webp|svg|gif|ico)$/i,
      handler: new CacheFirst({
        cacheName: "iph-images",
        plugins: [
          new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 14 * 24 * 60 * 60 }),
        ],
      }),
    },
    // Fonts
    {
      matcher: /\.(?:woff2?|ttf|otf)$/i,
      handler: new CacheFirst({
        cacheName: "iph-fonts",
        plugins: [
          new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 * 24 * 60 * 60 }),
        ],
      }),
    },
    // All other page routes: try the network first (so ISR revalidation always
    // wins when online), fall back to cache only when offline/slow.
    {
      matcher: ({ url }) =>
        url.hostname === "app.iphexpo.com" && !url.pathname.startsWith("/api/"),
      handler: new NetworkFirst({
        cacheName: "iph-pages",
        networkTimeoutSeconds: 4,
        plugins: [new ExpirationPlugin({ maxAgeSeconds: 3600 })],
      }),
    },
  ],
});

serwist.addEventListeners();

// --- Web Push notifications ---
// Ported verbatim from the pre-Serwist public/sw.js.
//
// iOS Safari: Web Push ONLY works when the app is added to Home Screen as a PWA (iOS 16.4+).
// Android Chrome: works in both regular browser tabs and installed PWA.
// This is a platform constraint — not a bug.

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: event.data.text(), body: "" };
  }

  const { title = "IranPharma", body = "", icon, image, link } = payload;

  const options = {
    body,
    icon: icon || "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    image: image || undefined,
    data: { url: link },
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const link = event.notification.data?.url;
  const targetUrl = link
    ? link.startsWith("http")
      ? link
      : self.location.origin + link
    : self.location.origin;

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // If a window for the origin is already open, focus it and navigate
        for (const client of clientList) {
          if (client.url.startsWith(self.location.origin) && "focus" in client) {
            client.focus();
            if ("navigate" in client) client.navigate(targetUrl);
            return;
          }
        }
        // Otherwise open a new window
        if (clients.openWindow) return clients.openWindow(targetUrl);
      })
  );
});
