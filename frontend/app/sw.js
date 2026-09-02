import { CacheFirst, ExpirationPlugin, NetworkFirst, NetworkOnly, Serwist } from "serwist";

// Small inline fallback for when a NetworkFirst/NetworkOnly strategy fails
// with no cache to fall back to (SerwistError "no-response"). Without a
// handlerDidError plugin, that error propagates all the way to the
// FetchEvent's respondWith() promise -- for a navigation, a rejected
// respondWith() IS what the browser treats as a hard network error, showing
// its own offline interstitial in place of the page instead of anything
// app-controlled. Deliberately not precached: this is a rare edge case
// (bad network hitting a page that needs a live connection anyway -- OTP
// submission can't work offline regardless), not worth precache-management
// overhead for.
const CONNECTION_ERROR_HTML = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>خطای اتصال</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:#021f20;color:#fff;font-family:sans-serif;text-align:center;padding:24px}
  .box{max-width:360px}
  h1{font-size:18px;margin:0 0 8px}
  p{color:rgba(255,255,255,.6);font-size:14px;margin:0 0 20px;line-height:1.6}
  button{background:#00ffb3;color:#021f20;border:0;border-radius:12px;padding:10px 24px;
    font-weight:700;font-size:14px;cursor:pointer}
</style>
</head>
<body>
<div class="box">
  <h1>مشکل در اتصال به اینترنت</h1>
  <p>لطفاً اتصال اینترنت خود را بررسی کرده و دوباره تلاش کنید.<br>
     <span style="direction:ltr;display:inline-block">Connection problem — please check your internet and try again.</span></p>
  <button onclick="location.reload()">تلاش مجدد / Retry</button>
</div>
</body>
</html>`;

const offlineFallbackPlugin = {
  handlerDidError: async () =>
    new Response(CONNECTION_ERROR_HTML, {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }),
};

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
    // /login and /signup: force-dynamic (per-event), and every distinct
    // ?from= value is its own cache key -- there is effectively never a
    // useful cache hit to fall back to here, and caching a stale login
    // shell offline isn't useful anyway (OTP submission needs a live
    // connection regardless). Network-only, with the fallback plugin below
    // so a failure degrades to a small message instead of the browser's own
    // network-error interstitial replacing the one page that must always work.
    {
      matcher: ({ url }) =>
        url.hostname === "app.iphexpo.com" &&
        (url.pathname === "/login" || url.pathname === "/signup"),
      handler: new NetworkOnly({
        plugins: [offlineFallbackPlugin],
      }),
    },
    // All other page routes: try the network first (so ISR revalidation always
    // wins when online), fall back to cache only when offline/slow. Same
    // fallback plugin as above -- any route can in principle hit the
    // no-cache-fallback case under bad enough network conditions, just less
    // often than /login's ever-changing query string.
    {
      matcher: ({ url }) =>
        url.hostname === "app.iphexpo.com" && !url.pathname.startsWith("/api/"),
      handler: new NetworkFirst({
        cacheName: "iph-pages",
        networkTimeoutSeconds: 4,
        plugins: [new ExpirationPlugin({ maxAgeSeconds: 3600 }), offlineFallbackPlugin],
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
