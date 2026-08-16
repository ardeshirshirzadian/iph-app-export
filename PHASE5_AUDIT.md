# Phase 5 Performance Audit

Investigation-first pass across images, fonts, service worker, caching architecture, DB indexes, polling scope, Nginx, and real-world Core Web Vitals. Only Item 1a (safe static-asset image conversion) was implemented; everything else is report-only per the task scope.

---

## Item 1a — Images

### Survey: every raw `<img>` tag, categorized

Grepped `app/` and `components/` (excluding `node_modules`/`.next`) for `<img`. ~35 usages found. Categorized by actual source:

| Category | Count | Examples |
|---|---|---|
| (a) Fixed local static asset | **1 component** (`components/Logo.jsx`) | App logo, 6 files in `public/logo/` |
| (b) Dynamic admin/user-uploaded via `/uploads/` (same-origin) | ~20 | News/gallery/panel images, quest mission/level/badge icons, banner/notification images, login/cart/badge admin logo uploads |
| (c) Inside a capture/canvas flow | 1 | `components/RasayeshBadgeCard.jsx` |
| (d) External Rasayesh-hosted | ~6 | Company logos (`CompaniesClient.jsx`, `CompanyDetailClient.jsx`, `MapClient.jsx`), attendee profile photos (`AppHeader.js`, `ProfileClient.jsx`, `EditProfileClient.jsx`) |

**Notable finding:** the team has already made these calls deliberately in several places — many category (b)/(d) usages carry `// eslint-disable-next-line @next/next/no-img-element` comments, and **two files already use `next/image` with the `fill` pattern for dynamic `/uploads/` images**: `app/notifications/NotificationsClient.jsx` (`notif.image_path`) and `app/components/HomeClient.js` (`banner.image_path`, with `priority` on the first banner). This is exactly the pattern to extend for category (b) — not a new pattern to invent.

**`next.config.js` currently has no `images` config at all** (no `remotePatterns`/`domains`). The two existing `next/image` usages work only because they're same-origin relative paths (`/uploads/...`). Any conversion of category (d) — external `api.rasayesh.com`-hosted images — would require adding `remotePatterns` first.

### (a) Implemented: `components/Logo.jsx` → `next/image`

This was the only genuinely fixed, build-time-known local asset among all `<img>` usages (only used in `AppHeader.js`, both call sites `className="h-8 w-auto object-contain"`, no other import sites). Checked actual PNG dimensions in `public/logo/`:

```
logo.png:      2134×2134   logo-l.png:    2142×2200
logo-fa.png:   5310×2134   logo-l-fa.png: 4500×1033
logo-en.png:   5310×2134   logo-l-en.png: 4500×1033
```

These are being shipped at **full multi-megapixel resolution to render at ~32px tall** — a genuine, concrete win. Converted to `next/image` with a dimensions lookup table (intrinsic width/height per resolved file, matching the existing `isLight`/`variant` selection logic 1:1) so Next.js generates appropriately downsized, modern-format (webp/avif) variants instead of serving the raw PNGs.

**Tested:** `npm run build` — clean, 0 errors/warnings, all previously-static ISR routes unchanged (still `○`).

### (b) Dynamic admin/user-uploaded — recommendation per actual use case (not implemented)

All same-origin (`/uploads/...`), so no `remotePatterns` needed — just the `fill` + sized-container pattern already proven in this codebase.

| Use case | File(s) | Recommendation |
|---|---|---|
| News list/detail cover images | `NewsClient.jsx`, `PostClient.jsx` | **Convert.** Already wrapped in a fixed `aspectRatio: "16/9"` div — literally the same shape as the existing `HomeClient.js` banner conversion. Lowest-risk, highest-confidence win in this category. |
| Gallery images | `GalleryClient.jsx` (grid thumbnails + lightbox) | **Convert the grid thumbnails** (fixed `1/1` aspect container already present). **Leave the lightbox `<img>` as-is** — it renders at full viewport size from a user tap, `next/image` adds little there and the simplicity of a direct `<img src>` for a modal viewer is reasonable. |
| Panel thumbnails | `PanelsClient.jsx` | **Convert.** Fixed `aspectRatio: "16/7"` container already present, same shape as banners. |
| Login screen logo | `LoginForm.js` (`logoSrc`, admin-uploaded via `settings.logo_path`/`logo_path_light_theme`) | **Convert, with `priority`.** This is likely the LCP element on `/login` (large, above-the-fold, first thing rendered) — exactly the case `next/image`'s priority-loading exists for, even though it's admin-uploaded. Container is already a fixed `{width: sz, height: sz}` square (`settings.logo_size`), so `fill` fits directly. |
| Mission hint image | `QuestClient.js` (`hintUrl`, `max-h-64 w-full object-contain`) | **Worth converting** — this is a real content image (not a small icon), shown inside a bounded max-height container. Use `fill` + `object-contain` sizing. |
| Small admin icon uploads (service icons, cart/badge logo icons, quest level/mission/badge/tab icons, map control icons) | `HomeClient.js` (icon_value), `CartClient.jsx`, `BadgeClient.jsx`, `QuestClient.js` (level/mission/badge/tab icons), `MapClient.jsx` (control icons, map element list icons) | **Not worth converting.** These render at 14–48px, are frequently emoji-or-image toggles (`icon_type === 'image'`), and the admin already controls `icon_size` per the codebase's "Icon Size Rule." The bytes saved per icon are small and the added container/fill complexity isn't proportionate — matches the task's own carve-out for "rarely-large images." |
| Book cover | `BookClient.jsx` (`coverUrl`) | **Leave as-is for now.** Unlike the others, book cover aspect ratio isn't guaranteed fixed at upload time (no evidence of enforced crop-to-ratio on this upload path) — using `fill` inside an assumed aspect-ratio container risks visible cropping/distortion for covers that don't match. Would need to confirm the upload/admin flow enforces a ratio before converting safely. |
| Map floor-plan background | `MapClient.jsx` (`planUrl`) | **Investigate further before touching, don't convert yet.** It's `draggable={false}` and sits inside the map's custom pan/zoom transform layer — similar caution to the html2canvas case below; unclear whether `next/image`'s wrapper/loading behavior interacts cleanly with that transform logic without live-testing the map's drag/zoom interaction. |

### (c) Capture/canvas flow — do NOT convert

`components/RasayeshBadgeCard.jsx`: the `<img>` there is a deliberate, load-bearing hack — an invisible (`opacity: 0`, 1×1px), `crossOrigin="anonymous"` preload of the badge template background (`https://api.rasayesh.com/${editor.background}`), whose only purpose is to force the browser to fetch-and-cache the image with CORS headers *before* `html2canvas` captures the DOM (which renders the same URL as a CSS `background-image`). `next/image` doesn't guarantee this exact synchronous-preload-before-capture timing, and a badge-download regression would be a genuinely bad outcome (this is the attendee's physical/digital badge). **Recommendation: leave untouched.**

### (d) External Rasayesh-hosted — report only, do not convert without more discussion

Company logos (`CompaniesClient.jsx`, `CompanyDetailClient.jsx`, `MapClient.jsx`) and attendee profile photos (`AppHeader.js`, `ProfileClient.jsx`, `EditProfileClient.jsx`) are served from `api.rasayesh.com`, an external domain **not currently whitelisted** in `next.config.js` (no `images.remotePatterns` exists at all). Two open questions before this is safe to pursue:
1. **Domain whitelisting is a real config change**, not just a code change — `remotePatterns` would need to be added, and Rasayesh's image paths would need to be confirmed stable (not signed/expiring URLs) for `next/image`'s optimization pipeline to cache them reliably.
2. Company logos in particular are small/frequent (list views with many logos) — the `next/image` optimization pipeline adds a proxy round-trip through the Next.js server for each unique remote image on first request, which could shift load rather than reduce it if Rasayesh's own images aren't already well-optimized. Worth confirming actual Rasayesh image file sizes before assuming this is a win.

**Recommendation: revisit as a separate, scoped follow-up** — start with attendee profile photos only (single image per page, not a list of many), confirm URL stability with Rasayesh, add `remotePatterns` scoped to just `api.rasayesh.com`, test.

---

## Item 1b — Fonts (investigation only)

### How font loading currently works

`app/layout.js` calls `getActiveFont()`/`getActiveFontEn()` (from `lib/getActiveFont.js`, wrapped in `unstable_cache` with tags `layout-font`/`layout-font-en`, revalidate 300s — Phase 3 work, untouched). Each returns either:
- **`source: 'google'`** — a hardcoded `googleUrl` (e.g. `fonts.googleapis.com/css2?family=Vazirmatn...`), default fallback.
- **`source: 'local'`** — a `family` name + `allFiles` array (path/format/weight), resolved by `lib/fontScanner.js` scanning `public/fonts/**` recursively at request time and matching against the DB-stored family name.

Injection in `<head>` (three mechanisms, all server-computed):
1. **Google source:** `<link rel="preconnect">` ×2 + `<link rel="stylesheet" href={googleUrl}>` — a blocking external stylesheet fetch, no self-hosting, no `next/font` involvement.
2. **Local source:** inline `<style>` with one `@font-face` rule per file in `allFiles` (`font-display: swap` already set) + a `:root { --active-font-family: "..." }` CSS variable. **No `<link rel="preload" as="font">` hint for the font file** — the browser only discovers it after parsing the CSSOM, adding a full request-waterfall step (HTML → inline CSS → font file) that a preload hint would eliminate.
3. Both paths set the same `--active-font-family`/`--active-font-en-family` CSS variables that the rest of the app presumably consumes via `font-family: var(--active-font-family)`.

### Is the font set actually bounded? (this determines whether `next/font/local` is viable)

Investigated thoroughly since this is the crux of the question:

- **`scanFonts()` scans `public/fonts/` recursively** for `.woff2/.woff/.ttf/.otf` — currently 3 families present (`vazir`, `inter`, `abar`).
- **`public/fonts/` is inside the Next.js `public/` directory, baked into the Docker image at build time** — unlike `public/uploads/`, it is **not** one of the volume-mounted, persists-across-rebuilds upload directories documented in this repo's own "File Upload Persistence Rule." Adding a new font family currently requires a developer to commit files + rebuild + redeploy.
- **I could not find any font-upload API route or admin UI anywhere in the codebase.** Searched `app/apn/`, `app/api/admin/`, and grepped the whole tree for any file-write targeting `public/fonts` or any UI referencing `scanFonts`/`active_font` — nothing. `app/apn/appearance/AppearanceClient.jsx` (the only appearance-related admin page) only handles button color/fontSize styling, saved to `/api/admin/button-styles` — no font-family selector.
- **However, the DB values are actively non-default right now** (queried live): `active_font` = `AbarLow` (local), `active_font_en` = `Inter` (local) — someone set these to something other than the Google-Fonts defaults, presumably via direct DB access rather than through a UI, since none was found.
- `app/layout.js` even has a comment claiming *"Changing the font in /apn/appearance takes effect on next page load"* — this UI does not currently exist as far as I can find. Likely either stale documentation from planned-but-unbuilt work, or a feature that exists somewhere I didn't locate.

**Bottom line: the font *file* set is bounded and known at each deploy** (whatever's committed to `public/fonts/` — currently 3 families) — it is **not** the "admin uploads arbitrary fonts at runtime" scenario. Only the *selection* among that fixed set is DB-driven/dynamic. This is a meaningfully different (and more tractable) situation than the task's cautionary framing assumed, **but it rests on an absence-of-evidence finding** (no upload UI found) rather than positive confirmation that one will never exist — flagging this clearly since the task's own context note asserts the admin *can* change fonts "at any time," which today appears to mean "can change the *selection*," not "can add new *files*."

### Three options (no implementation — your decision)

**Option 1 — Keep current approach, add `font-display: swap` (already present) + preload hint.** Server-side, compute the currently-active local font's primary file path (already known — it's `activeFont.allFiles[0]?.path` or similar) and add `<link rel="preload" as="font" type="font/woff2" href={...} crossOrigin="anonymous">` next to the existing `<style>` injection. Zero architectural change, closes the one concrete gap (missing preload → request waterfall) in the current mechanism. For the Google-source fallback, this doesn't help (external font, can't preload cross-origin the same way without knowing Google's resolved URL) — but could add `rel="preload" as="style"` for the Google CSS link itself as a minor supplement. **Lowest risk, smallest gain, always safe regardless of how the font set evolves.**

**Option 2 — Restructure to `next/font/local`, gated on the bounded-set finding above.** Since the file set is fixed per-deploy, you could statically import all currently-known local families via `next/font/local` (self-hosted at build time, automatic `font-display`, zero layout shift via automatic fallback metrics) and switch between their generated CSS variables server-side based on the DB selection — same DB-driven *selection* behavior preserved, but the *file serving* becomes build-time-optimized instead of a hand-rolled `@font-face`. **Real gain** (next/font's fallback-metrics + self-hosting are genuinely better than the current hand-written `@font-face`), but requires: (a) accepting that adding a new font family becomes a code change (regenerating the `next/font/local` import list), which — per the finding above — is *already true today* (no upload path exists), so this isn't actually a new constraint; (b) reworking `getActiveFont`'s consumers to switch between pre-generated variables rather than injecting arbitrary CSS. **Moderate effort, real gain, but only correct if you confirm there's genuinely no hidden/planned runtime font-upload path** — worth explicitly asking whoever built the DB-driven scaffolding whether font upload was intended before committing to this.

**Option 3 — No safe optimization without bounding the font set first, if you intend to build the missing upload UI.** If the plan is to eventually let admins upload arbitrary font files (the DB/scanner architecture reads like it was built expecting this), building `next/font/local` support now would just have to be ripped out later. In that case, Option 1 (preload hint only) is the only future-proof choice until that product decision is made explicitly.

**My read:** given the evidence (no upload UI exists, `public/fonts/` isn't on the persistent-upload path), Option 2 is more viable than the task's framing initially suggested — but this is exactly the kind of call that needs your product-intent decision, not mine, so I'm not implementing any of it.

---

## Item 2 — Service Worker / PWA precaching (investigation only)

`public/sw.js` — read in full. It is **entirely** a Web Push notification handler:
- `push` event listener → shows a notification from the payload.
- `notificationclick` event listener → focuses/opens the relevant window.
- **No `install`, `activate`, or `fetch` event listeners at all.** No `caches.open`/`cache.addAll` anywhere in the file. No Workbox — hand-written, minimal, single-purpose.

**Currently precached: nothing.** **Current runtime caching strategy: none — the SW never intercepts `fetch`, so every request goes straight to the network** (subject only to the browser's normal HTTP cache and whatever `Cache-Control` headers Next.js/Nginx set). `ServiceWorkerRegistrar.js` registers it unconditionally in the root layout on every page (`navigator.serviceWorker.register('/sw.js')`, no route scoping) — appropriate, since push notifications need to work app-wide, and there's no fetch-interception to scope anyway.

### Honest assessment: is SW precaching worth adding now?

**My assessment: low priority, marginal value, real downside risk — I would not prioritize this.**

- Phase 3 already moved the "fast repeat page load" win to the server: ISR pages (`/`, `/quest`, `/companies`, `/map`, `/badge`, etc.) serve from cache in low tens-of-milliseconds server-side, which captures most of what SW precaching would otherwise be for. The marginal gain from *also* precaching the app shell client-side is smaller post-Phase-3 than it would have been before it.
- This app's actual value proposition for offline support is weak: it's a conference-companion app used at a physical venue with WiFi/cellular, not something people expect to browse mid-flight. The "instant repeat navigation with zero network dependency" benefit of a precaching SW matters most for apps with a real offline use case — this isn't clearly one.
- **Real risk, not just complexity:** a cache-first or stale-while-revalidate SW strategy risks serving stale admin-configured content (banners, quest missions, theme colors, button styles) *even after* an admin explicitly calls `revalidateTag()` server-side — actively fighting Phase 3's carefully-built on-demand revalidation system unless the SW cache's invalidation is kept in lockstep with it (extra complexity, extra failure mode, for a benefit that's already mostly captured server-side).
- **If pursued at all**, the only version I'd consider safe: precache *only* the genuinely immutable, hashed-filename `_next/static/*` chunks (JS/CSS) with a `CacheFirst` strategy — never HTML, never API responses, leaving all of Phase 3's server-driven freshness guarantees untouched. Even this is a "maybe, low priority" rather than a clear win given where the app already is.

---

## Item 3 — Redis vs in-memory cache (investigation only, future-scaling question)

### Re-confirmed: `unstable_cache` storage is per-container in-memory

`next.config.js` has no cache storage config of any kind. Per this Next.js version's own bundled docs (`node_modules/next/dist/docs/.../cacheHandlers.md`): *"The default in-memory cache is isolated to each Next.js process... lost on restart."* Confirmed still true — nothing in this codebase overrides it.

### Important correction — this Next.js version's actual config API differs from the commonly-known one

This repo runs **`next@16.2.7`**, and per `AGENTS.md`'s explicit warning, its APIs diverge from typical training-data knowledge — confirmed here concretely:

- The custom-cache-storage config key in this version is **`cacheHandlers`** (plural, an *object* — `{ default: ..., remote: ..., <customName>: ... }`), introduced in **v16.0.0**. This is a different, newer API from the singular `cacheHandler` (string path) config from Next 14/15 that's more commonly referenced.
- **`unstable_cache` — the API this codebase's entire Phase 3 caching layer is built on — is explicitly flagged deprecated in this version's docs**, "replaced by `use cache` in Next.js 16." The `cacheHandlers` config docs describe it as being for `'use cache'`/`'use cache: remote'` *directives* specifically.
- **I could not confirm from the docs whether configuring `cacheHandlers.default` actually intercepts legacy `unstable_cache()` storage**, or only applies to the newer `'use cache'` directive family. This matters a lot: if it's the latter, adding a Redis `cacheHandlers` config would do *nothing* for Phase 3's existing `unstable_cache(...)`-based caching (quest content, theme colors, font settings, etc.) — it would only affect new code written with the `'use cache'` directive.

**Recommendation if this is ever pursued: verify compatibility first**, before writing any real Redis integration — e.g. configure a trivial custom `cacheHandlers.default` that just logs `get`/`set` calls, then confirm whether Phase 3's existing `unstable_cache` calls actually trigger it. If they don't, the choice becomes either (a) migrate the caching layer to `'use cache'` first (a larger, separate migration), or (b) accept that `unstable_cache` calls stay in-memory regardless of `cacheHandlers` config.

### At what point does this become a real problem?

- **Current deployment is a single container** (`docker-compose.yml`'s `superapp-frontend` service — one instance, no `deploy.replicas`/scaling config). In-memory cache incoherency across replicas is **not a current problem** — there's only one process.
- It becomes relevant only if/when you horizontally scale to multiple frontend replicas (e.g. behind a load balancer for the live expo's peak traffic) — at that point, `revalidateTag()` called on one instance wouldn't invalidate the others' in-memory caches, and each instance would independently re-warm its cache after restart.

### Redis integration effort estimate (if/when needed)

1. **Provision Redis** — not currently present anywhere in this stack (checked `docker-compose.yml`, systemd, running containers — none found). This is new infrastructure, not just a config file.
2. **Write a custom cache handler** implementing the 5-method interface (`get`/`set`/`refreshTags`/`getExpiration`/`updateTags`) — the docs include a complete, working Redis reference implementation to start from, including the distributed-tag-coordination pattern needed for `revalidateTag()` to work correctly across instances.
3. **First verify the `unstable_cache` compatibility question above** — potentially a larger migration than the Redis wiring itself if it turns out `cacheHandlers` doesn't cover legacy `unstable_cache`.
4. **Decide failure-mode behavior** — Redis down should probably fail open to a fresh render rather than fail the request.

**Overall: moderate effort, not urgent.** This is a scaling concern for a future multi-replica deployment, not a current-traffic problem. Framing it as "revisit if/when you add replicas" rather than something to schedule now.

---

## Item 4 — Database indexes on heavy live queries (investigation only)

Confirmed via `psql` (re-verified schema directly, not from any prior document) that this DB is Postgres, checked actual indexes with `\d`.

### The finding: `quest_scans.user_uuid` has **no index at all**

`quest_scans` has only a primary key on `id`. Every other query against this table filters or groups by `user_uuid`, and there is no supporting index anywhere:

| Query | File | Pattern |
|---|---|---|
| Leaderboard XP aggregation (overall + per-level) | `app/api/quest/leaderboard/route.js` | `GROUP BY user_uuid` inside a CTE, run on every leaderboard view |
| Per-user stats (3 separate queries) | `app/api/quest/stats/route.js` | `WHERE user_uuid = $1` ×2 (total count, 24h count) + `WHERE user_uuid = $1` (SUM) — **this is the endpoint polled every 45s per Item 5** |
| Mission/badge eligibility checks (multiple) | `app/api/quest/route.js`, `app/api/quest/badges/route.js` | `WHERE user_uuid = $1`, `WHERE user_uuid = $1 AND company_id = $2`, `GROUP BY company_id`/`DATE(scanned_at)` |
| Scanned-booths lookup | `app/api/quest/booths/route.js` | `WHERE user_uuid = $1` ×2 (distinct companies + last-scan-per-company) |
| **Duplicate-scan prevention — every single QR scan submission** | `app/api/quest/scan/route.js` | `WHERE user_uuid = $1 AND company_id = $2` (×2: last-scan lookup + 24h duplicate check) |

This is not a one-off — `user_uuid` (often combined with `company_id`) is the filter/group column for essentially every query this table serves, across the leaderboard, the 45s poll, and the scan-submission write path itself (the most latency-sensitive one — a user is actively waiting after scanning a QR code).

**For comparison, the sibling table `quest_xp_grants` already has exactly this kind of index** (`idx_quest_xp_grants_user` on `user_uuid`, plus a unique composite on `(user_uuid, source_type, source_id)`) — `quest_scans` is the outlier, not the norm, in this schema.

**Recommendation:**
```sql
CREATE INDEX CONCURRENTLY idx_quest_scans_user_company ON quest_scans (user_uuid, company_id);
```
A composite `(user_uuid, company_id)` index rather than a plain `(user_uuid)` one — it fully covers the `WHERE user_uuid = $1 AND company_id = $2` duplicate-scan-check pattern (the hottest, write-path query) while its leading column (`user_uuid`) still fully serves every query that only filters on `user_uuid` alone (leaderboard aggregation, stats, booth/badge checks). `CREATE INDEX CONCURRENTLY` avoids locking the table during creation (safe on a live table, though it can't run inside a transaction block).

**Caveat on current evidence:** the DB reachable from this environment (`172.17.0.1`, presumably a dev/staging instance — 9 `app_users`, 0 rows in `quest_scans`, 3 in `quest_xp_grants`) is far too small for `EXPLAIN` to show a real problem right now (`HashAggregate` over a 0-row `Seq Scan` is obviously instant). This recommendation is based on the **schema gap + confirmed query pattern**, not on an observed slow query — it's a preventive fix for event-scale traffic (potentially thousands of scan rows across many attendees during the live expo), not a fix for an already-measured production slowdown. I'd treat this as cheap insurance rather than an emergency.

**Everything else checked is fine:** `quest_xp_grants` (already indexed), `app_users.uuid` (unique index exists, serves the `LEFT JOIN app_users au ON r.user_uuid = au.uuid` pattern well), `quest_user_names` (PK on `user_uuid`, serves its join well), `quest_levels` (only ever looked up by PK `id`), `companies` (327 rows — trivially small, no index needed for the `hall_name`/`event_id` filter used in a couple of quest queries).

No index was created — this is a report only, per the task's instruction that schema changes need your review first.

---

## Item 5 — Polling scope (investigation only)

Found the mechanism in `app/quest/QuestClient.js` (lines ~2207–2263): exactly as described — a chained `setTimeout` at 45s intervals, paused via `document.addEventListener('visibilitychange', ...)` when the tab is hidden (clears the pending timeout) and immediately re-fetches + reschedules on resume.

**Confirmed: this is scoped to `/quest`, not global.** The polling `useEffect` lives directly inside the `QuestClient` component function body — it is not in `app/layout.js`, not in any provider, not in any component mounted outside the quest page. `QuestClient` is only rendered by `app/quest/page.js` (confirmed — it's the sole import site). When the user navigates away, `QuestClient` unmounts, the effect's cleanup function runs (`mounted = false`, `clearTimeout(timerId)`, listener removed) — polling fully stops. There is no needless polling on pages with no quest UI.

**No issue found, no recommendation needed.** This is exactly how it should work already.

---

## Item 6 — Nginx HTTP/2 and compression (investigation only)

Read the live Nginx config on this VPS directly (`nginx -V`, `/etc/nginx/nginx.conf`, `/etc/nginx/sites-available/iph-superapp` — the `app.iphexpo.com` site — and `/etc/nginx/sites-available/appapn` — the `appapn.iphexpo.com` admin site).

### HTTP/2: not enabled on either site

Both site configs use `listen 443 ssl;` with **no `http2` parameter**. On this nginx version (1.24.0), the syntax would be `listen 443 ssl http2;`. This is a real, currently-missing capability — every client connection to both the attendee app and the admin panel is HTTP/1.1 only, meaning no request multiplexing/HPACK header compression over a single connection.

**Recommendation:** add `http2` to the `listen 443 ssl` line on both `iph-superapp` and `appapn` site configs, then `nginx -t && systemctl reload nginx`. Low-risk, backward compatible (falls back to HTTP/1.1 automatically for old clients), one-line change per site.

*Caveat:* I don't have visibility into whatever CDN sits in front of `app.iphexpo.com` (this repo's `CLAUDE.md` mentions the CDN blocks the server's own IP, confirming one exists) — if the CDN already terminates HTTP/2 with end-user browsers and only speaks HTTP/1.1 to this origin regardless of what's configured here, this change would matter for CDN→origin fetches but not directly for the end-user's browser connection. Still worth doing (safe, and helps if the CDN does support origin HTTP/2, or for any direct-to-origin traffic), just flagging the uncertainty honestly.

### Compression: gzip is active, but not the way it looks from `nginx.conf` alone

`nginx.conf` has `gzip on;` but `gzip_types` is commented out (falls back to nginx's compiled-in default of `text/html` only) — read in isolation, this looks like a real gap (CSS/JS/JSON not gzipped by Nginx). **But:** this app runs a **custom Node server** (`server.js`, wrapping `next()` manually rather than using `next start` directly), and per this Next.js version's own docs: *"Next.js uses gzip to compress rendered content and static files when using `next start` or a custom server"* by default, unless `compress: false` is set. `next.config.js` does not set `compress: false` — confirmed by grep. **So the upstream (Node/Next) is already gzip-compressing responses before Nginx sees them**, and Nginx's gzip module doesn't recompress an already-`Content-Encoding: gzip` response by default. The Nginx-level `gzip_types` gap is therefore largely moot for this app's own responses — not a live bug.

**Real remaining opportunity: Brotli, not gzip.** Next.js's built-in compression is gzip-only. Checked `nginx -V` and `/etc/nginx/modules-enabled/` — **the Brotli module is not installed**. Switching to Brotli (typically 15–25% smaller than gzip for text content) would require: (a) installing `libnginx-mod-http-brotli-filter` (or building from source), (b) setting `compress: false` in `next.config.js` so Nginx handles compression instead of Next (per the docs' own explicit guidance for this exact scenario), (c) configuring `brotli on; brotli_types ...;`. This is real infrastructure work (new module), not a config tweak — worth doing eventually, not urgent given gzip is already working.

### Keep-alive between Nginx and the Docker container: not configured

Both sites use a plain `proxy_pass http://127.0.0.1:PORT` with no `upstream {}` block — no `keepalive` directive, meaning Nginx opens a new TCP connection to the backend for every request (no connection reuse). Since the backend is `127.0.0.1` (loopback, not a real network hop — Docker's port-mapping puts it on localhost), the actual latency cost per connection is very low, but it's still a real, easy, safe fix:
```nginx
upstream superapp_frontend {
    server 127.0.0.1:3002;
    keepalive 16;
}
# then: proxy_pass http://superapp_frontend; proxy_set_header Connection "";
```
Note the WebSocket-upgrade headers (`Connection: upgrade`, needed for Socket.IO per this repo's real-time notifications) would need care here — an `upstream` block with keepalive and the `Upgrade`/`Connection: upgrade` headers can coexist, but it needs testing since keepalive pooling and per-request `Connection: upgrade` overrides interact. **Lowest-impact of the three Nginx findings** (localhost hop is already cheap) — I'd deprioritize this relative to the other two.

### Bonus finding: `/uploads/` isn't served directly by Nginx on the attendee-facing site — but it is on the admin site

`appapn`'s site config already has:
```nginx
location /uploads/ {
    alias /home/ubuntu/iph-superapp-uploads/;
    expires 30d;
    add_header Cache-Control "public, immutable";
}
```
...bypassing the Node process entirely for uploaded-file requests, with aggressive long-term caching. **The `iph-superapp` site (`app.iphexpo.com` — the actual attendee-facing app) has no equivalent block** — every `/uploads/*` request (company logos, banners, gallery images, badge templates — everything Item 1a's category (b)/(d) images depend on) is proxied through to the Next.js app on port 3002 and served via the custom `app/uploads/[...path]/route.js` route instead of directly by Nginx.

**Recommendation:** add the same `location /uploads/` alias block (pointing at the same `/home/ubuntu/iph-superapp-uploads/` volume) to the `iph-superapp` site config. This is a proven pattern already running in production on the sibling site — low risk, and likely the single highest-impact Nginx change here, since it removes an entire category of requests (every uploaded image on the attendee-facing app) from the Node.js process and gives them 30-day immutable caching directly at the edge.

---

## Item 7 — Real Core Web Vitals measurement

**Could not measure — blocked by this environment's own testing constraints, not a missing tool.** Chrome/Chromium is actually available here (`/usr/bin/chromium-browser`, plus Playwright/Puppeteer Chrome installs), and `npx lighthouse` could be fetched — but this repo's `CLAUDE.md` explicitly states: *"NEVER attempt to access live URLs (app.iphexpo.com, appapn.iphexpo.com) for testing... NEVER access app.iphexpo.com or appapn.iphexpo.com from the server (CDN blocks server's own IP)."* Both the policy and the technical reality (CDN returns 403 to this server's own IP) rule this out.

Running Lighthouse against `localhost:3002` instead (which `CLAUDE.md` does permit for basic page-serving checks) wouldn't produce meaningful **real** Core Web Vitals numbers even if I did it: LCP/TTFB are network-dependent metrics, and a loopback request has none of the real latency, CDN, or mobile-network characteristics the task is asking about. It would also require a working authenticated session for most routes (per the app's route-protection rule), which is a separate complication for an automated headless run.

**Recommended way for you to get real numbers:**
1. **PageSpeed Insights** (`pagespeed.web.dev`) against `https://app.iphexpo.com/`, `/quest`, `/map`, `/companies` — this is actually *better* than an ad-hoc Lighthouse run for "real" data, since it pulls actual field data from the Chrome UX Report (CrUX) when the site has enough real-user traffic, in addition to a fresh lab run. Free, no setup.
2. **Chrome DevTools → Lighthouse panel**, run directly against the live URLs from your own machine (not this server) — gives you the full trace/waterfall alongside the scores, useful for correlating any LCP/CLS findings back to specific requests (e.g. the image/font findings above).
3. If you want it automated/repeatable going forward, `npx lighthouse <url> --output=json` from your own machine (or a CI runner that isn't behind this server's CDN block) against the real domain.

Once you have numbers, the image (1a) and font (1b) findings above are the most likely LCP-affecting culprits worth cross-referencing first, and the Nginx HTTP/2 + `/uploads/` findings (Item 6) are the most likely TTFB/resource-loading culprits.

---

## Prioritized list (impact ÷ risk/effort)

1. **DB index: `CREATE INDEX CONCURRENTLY idx_quest_scans_user_company ON quest_scans (user_uuid, company_id);`** (Item 4) — highest confidence in this list: fixes a confirmed, zero-index gap hit by the leaderboard, the 45s stats poll, and every QR scan submission. Near-zero risk (additive, concurrent, mirrors an existing index pattern on the sibling table), trivial effort. Report only per your instruction — needs your go-ahead to run.
2. **Nginx: add `/uploads/` direct-serve `location` block to the `iph-superapp` (app.iphexpo.com) site**, mirroring the block that already exists on `appapn` (Item 6) — removes an entire class of requests (every uploaded company logo/banner/gallery/badge image) from the Node process, adds 30-day immutable caching, proven pattern already running elsewhere in this same infra. Low risk, low effort, needs your approval before editing the live Nginx config.
3. **Nginx: enable HTTP/2** (`listen 443 ssl http2;`) on both sites (Item 6) — one-line, backward-compatible, safe change; real-world impact depends partly on the CDN's origin-fetch behavior which I can't see from here, but there's no downside to enabling it.
4. **Item 1a static-asset conversion — done.** `components/Logo.jsx` → `next/image`, tested, clean build. Smallest scope in this list but already shipped.
5. **Item 1a category (b) follow-up** — extend the already-proven `fill`-in-sized-container pattern (used today for banners/notifications) to news/gallery/panel images and the login-screen logo. Moderate effort (several call sites), low risk per-site since the pattern is already validated in this codebase; good candidate for a small follow-up PR, not urgent.
6. **Nginx upstream keepalive** (Item 6) — real but lowest-impact of the three Nginx findings, since the backend hop is already localhost.
7. **Font loading (Item 1b)** — not effort-ranked here; it's a "needs your product decision" item (Option 1/2/3 above), not a ready-to-schedule task. Option 1 (preload hint) alone would be safe to schedule any time if you want a quick partial win without committing to the bigger `next/font/local` question.
8. **Redis / distributed cache (Item 3)** and **SW precaching (Item 2)** — both assessed as low priority right now: Redis is a future-scaling concern with no current multi-replica deployment to justify it, and SW precaching's marginal value is smaller post-Phase-3 with real staleness risk against the admin-revalidation system. Revisit Redis if/when you add replicas; I would not prioritize SW precaching at all under the current architecture.
