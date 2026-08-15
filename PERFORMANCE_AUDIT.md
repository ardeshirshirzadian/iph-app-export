# iph-app Performance Audit

**Scope:** `frontend/` (Next.js 16.2.7 App Router, Turbopack build), plus the sibling admin app `/home/ubuntu/iph-apn` where relevant to caching triggers. Investigation only — no files were modified.

**Repo topology correction:** this audit found the admin panel is **not** solely `frontend/app/apn/*`. There are two separate Next.js apps sharing one Postgres DB:
- `frontend/` — the public app (this audit's target).
- `/home/ubuntu/iph-apn` — a separate, full admin panel app (own `package.json`/`.git`/`proxy.js`). This is where the real companies/map editing UI and `/api/admin/companies/*`, `/api/admin/map/*` routes live.
- `frontend/app/apn/*` is only a partial legacy subset (`login`, `appearance`, `map-labels`).

Any recommendation below involving "trigger revalidation from the admin save handler" means a handler in `iph-apn`, not `frontend/app/apn`.

---

## 1. Dynamic Rendering Audit

### Headline finding

**All 43 routes trace back to one shared cause:** `app/layout.js:16` — `export const dynamic = 'force-dynamic'` on the **root layout**. In the App Router, a layout's `dynamic` config cascades to every route nested under it; a child cannot opt back into static/ISR rendering once an ancestor layout forces dynamic. Since `app/layout.js` wraps every route in the app (including `/apn/*`), this one line is sufficient to force all 43 routes to render dynamically — independent of what any individual page needs.

Supporting evidence:
- **Zero** `page.js`/`layout.js` files call `cookies()`, `headers()`, `draftMode()`, or `connection()` (grepped across all 34 files — auth happens exclusively in `proxy.js` middleware, never at the page/layout level).
- Raw `pg` `query()` calls via `lib/db.js` are **not** a Next.js "dynamic API" — they don't themselves force dynamic rendering. The root layout's own DB reads (`getActiveFont`, `getActiveFontEn`, `getThemeColors`, `getThemeMode` in `app/layout.js:98-103`, `getAppIdentity` in `generateMetadata`) are all admin-settings lookups, not per-request-necessary data — it is only the explicit `force-dynamic` export that forces freshness on every request.
- Cleanest proof: `app/signup/page.js` has **no** `dynamic` export at all — it's a pure `redirect('/login')` — yet still builds `ƒ` solely via layout inheritance. `app/quest/scan/page.js` is a `"use client"` component with zero server data dependency and is still `ƒ` for the same reason.
- Most individual `page.js` files also redundantly declare their own `force-dynamic` (per the CLAUDE.md-documented convention), but that declaration is inert given the root layout already forces the outcome.

### Table 1 — page.js / layout.js audit

| Route | Reason it's dynamic | Necessary? |
|---|---|---|
| `app/layout.js` (root) | Own `force-dynamic`; DB reads for font/theme/app-identity in `generateMetadata`/`RootLayout`, no cookies/headers | **No — this is the root cause.** Admin-configurable but rarely-changed settings; ISR (`revalidate: N`) or on-demand `revalidatePath` from admin-save handlers would serve the same freshness far cheaper |
| `app/apn/layout.js` | No dynamic export; pure style wrapper | N/A — dynamic only via root layout taint |
| `app/apn/page.js` | Own force-dynamic; renders in-memory JS constant, no DB | No — 100% static content |
| `app/apn/appearance/page.js` | Own force-dynamic; `query()` for `button_styles_config` (admin) | No — convention-driven only |
| `app/apn/login/page.js` | Own force-dynamic; reads `searchParams.error` | **Yes, independently** |
| `app/apn/map-labels/page.js` | Own force-dynamic; `query()` map_labels_config | No |
| `app/badge/page.js` | Own force-dynamic; `query()` badge_page setting (admin, not per-user) | No |
| `app/book/callback/[authority]/page.js` | Own force-dynamic; `params`/`searchParams`, redirects | **Yes** — payment-gateway query string |
| `app/book/callback/page.js` | Same pattern | **Yes** |
| `app/book/cart/page.js` | Own force-dynamic; unconditional `redirect('/cart')`, no params/DB | No — static redirect would work |
| `app/book/page.js` | Own force-dynamic; `query()` book_config | No |
| `app/cart/callback/[authority]/page.js` | Own force-dynamic; `params.authority`+`searchParams.Status`, inline UI (breaks the repo's `page.js → XxxClient` convention) | **Yes** — Zarinpal payment callback |
| `app/cart/callback/page.js` | Same pattern | **Yes** |
| `app/cart/page.js` | Own force-dynamic; no DB/searchParams, passthrough to `CartClient` | No |
| `app/chat/page.js` | Own force-dynamic; `getPageTitle('chat')` (admin) | No |
| `app/companies/[slug]/page.js` | Own force-dynamic; only reads `params.slug`, no DB in page | No — could be static/ISR |
| `app/companies/page.js` | Own force-dynamic; `getPageTitle` | No |
| `app/gallery/page.js` | Own force-dynamic; `getPageTitle` | No |
| `app/login/page.js` | Own force-dynamic; `query()` login_page_settings + reads `searchParams` (verify/contact/email/quick/from) | **Yes, independently** — OTP-flow initial state |
| `app/map/page.js` | Own force-dynamic; `getPageTitle` | No |
| `app/news/[slug]/page.js` | Own force-dynamic; only `params.slug`, no DB | No — could be static/ISR |
| `app/news/page.js` | Own force-dynamic; `getPageTitle` | No |
| `app/notifications/page.js` | Own force-dynamic; `getPageTitle` only, list fetched client-side from a **global, non-per-user** feed | No |
| `app/page.js` (home `/`) | Own force-dynamic; reads `home_page_config` then re-executes one of 10 other pages' server logic inline (quest/companies/panels/badge/map/chat/notifications/gallery/news/profile) | No — heavy duplicated DB-read surface, but nothing user-specific; prime ISR + on-demand-revalidate candidate |
| `app/panels/page.js` | Own force-dynamic; `getPageTitle` | No |
| `app/profile/edit/page.js` | Own force-dynamic; no DB, no searchParams | No |
| `app/profile/page.js` | Own force-dynamic; `getPageTitle` only, data fetched client-side | No |
| `app/quest/page.js` | Own force-dynamic; admin-curated quest content blocks + appearance config + `getPageTitle` | No — not per-user |
| `app/quest/scan/page.js` | `"use client"` — not a Server Component, zero server fetch | No — cleanest illustration, `ƒ` purely from layout nesting |
| `app/register/confirm/page.js` | Own force-dynamic; thin wrapper only | No |
| `app/register/page.js` | Own force-dynamic; `query()` registration_config | No |
| `app/register/profile/page.js` | Own force-dynamic; thin wrapper only | No |
| `app/settings/page.js` | Own force-dynamic; `getPageTitle` + `getThemeMode` (admin config) | No |
| `app/signup/page.js` | **No dynamic export at all**; just `redirect('/login')` | No — second clean illustration; still `ƒ` via layout inheritance alone |

**Bottom line:** only **6 of 32 pages** (`apn/login`, `book/callback[/[authority]]`, `cart/callback[/[authority]]`, `login`) have a genuine page-local reason (`searchParams` access) to stay dynamic. The remaining 26 pages, plus the root layout itself, read only admin-configurable settings and would be capable of static generation or ISR with `revalidatePath`/`revalidateTag` triggered from admin-save routes — if the root layout's blanket `force-dynamic` were relaxed. The app already proves this pattern works elsewhere: `app/api/theme.css/route.js` decouples theme CSS into its own explicitly-cached (`Cache-Control: no-store, must-revalidate`) resource rather than forcing the whole page dynamic for it.

### Table 2 — API route.js audit (condensed)

Legend: RY = calls Rasayesh/external upstream, DB = `lib/db.js` `query()`, CK = reads cookies/headers.

Nearly all 49 `route.js` handlers are legitimately per-request (stateless POST endpoints, or read the user session cookie for quest/cart/attendance data). Two anomalies worth flagging:

| Route | Issue |
|---|---|
| `app/api/health/route.js` | GET, no `dynamic` export, no dynamic API used, returns `new Date().toISOString()`. Theoretically eligible for static optimization, which would **freeze the timestamp at build time** — worth confirming this isn't silently happening. |
| `app/api/notifications/route.js` | GET, no `dynamic` export, DB only — a **global** feed (`ORDER BY created_at DESC`, no user filter, no cookie read at all). Not actually user-scoped despite living in an authenticated app; safe to treat as cacheable/shared. |

`app/api/header/route.js`, `app/api/nav/route.js`, `app/api/quest/leaderboard/route.js`, `app/api/quest/levels/route.js`, `app/api/theme.css/route.js` explicitly declare their own `force-dynamic`.

**Recommended fix:** Decouple root-layout font/theme/app-identity reads from `force-dynamic` — e.g. give `app/layout.js` a moderate `revalidate` (ISR) and call `revalidatePath('/', 'layout')` from the `iph-apn` admin-save handlers for font/theme/app-identity settings (mirroring the `getAppPages()` 60s-cache pattern already used in `proxy.js`, and the `theme.css` decoupling pattern already used for CSS). Once the layout is no longer blanket-forcing every child dynamic, re-audit each page's own (mostly redundant) `force-dynamic` export and remove it for the 26 pages that have no independent reason to keep it, letting them fall back to static/ISR.

---

## 2. Redundant Rasayesh API Calls

### `x-rasayesh-site` header inventory

| Header | Client/file | Purpose |
|---|---|---|
| `attendee` | `lib/apolloClient.js` (browser Apollo singleton) | authenticated attendee session |
| `attendee` | `app/profile/edit/EditProfileClient.jsx:78` (raw fetch, multipart) | profile-photo upload — necessary duplicate transport, Apollo can't do file uploads |
| `iph` | `lib/publicRasayeshClient.js` (`getRasayeshEventInfo`, `fetchPublicGraphQL`) | server-side public/anonymous reads |
| `iph` | `app/api/gallery/route.js`, `app/api/map/route.js` | server-side proxy routes |
| `event` | `app/api/auth/auto-enroll/route.js` | auto-enroll-on-login |
| *(none)* | `send-otp`, `send-otp-email`, `verify-otp`, `verify-otp-email` routes | raw fetch with **no** `x-rasayesh-site` header — an inconsistency, not a redundancy |

No admin-specific Rasayesh client exists — `app/apn/*`/`iph-apn` never call `api.rasayesh.com` directly.

### Redundancy table

| Query | Called from | Frequency | Dedup candidate? |
|---|---|---|---|
| Attendee photo-check — **2 different operation names**, identical selection set | `AppHeader.js` (per-mount, deps `[]`); `ProfilePhotoGuard.jsx` (root-layout component, deps `[pathname, router]` → fires every route change until `localStorage.iph_photo_ok` is set) | AppHeader refires on every nav to any page embedding it; PhotoGuard once per nav until cached | **Yes** — two components ask the same question with two different query documents, so Apollo can't dedup in-flight requests; can race on first load |
| `getAttendee` (subset, for completion bar) | `ProfileCompletionBar.jsx`, `fetchPolicy:'network-only'`, mounted from **both** `HomeClient.js` and `ProfileClient.jsx` | once per mount of Home and once per mount of Profile, always network | **Yes, partial** — overlaps with the full `GetAttendee` fired separately on `/profile` |
| `GetAttendee` (full ~25-field record) — **byte-identical query text** in 2 places | `ProfileClient.jsx` (network-only); `EditProfileClient.jsx` (network-only, refetched again after every save) | 1 fetch/`/profile` load + 1/`/profile/edit` load + 2 more refetches per successful edit-save | **Yes** — a Profile → Edit Profile → Profile loop (common flow) refetches the identical payload 2-3x with zero caching |
| `GetAttendee` (registration-flow subset) — **3rd independent definition**, same op name | `ProfileUpdateClient.jsx`, default no-cache | 1 fetch during registration wizard | Low session-frequency overlap, but a 3rd hand-written copy of the same query |
| `FORM_OPTIONS_QUERY` (occupations/fieldOfActivities/educationLevels — **static lookup data**) — identical text, **3 separate definitions** | `LoginForm.js`, `EditProfileClient.jsx`, `ProfileUpdateClient.jsx` | once per mount of each, all default no-cache | **Yes — strongest dedup candidate.** Static reference data refetched fresh every visit, defined 3x independently |
| `getAttendeeCart` — 2 shapes: badge-check vs full cart | `AppHeader.js` (deps `[pathname, searchParams]` → **refires on every route change** on any page embedding AppHeader); `CartClient.jsx` (full query, `/cart` load) | Home→Map→Home = 3 separate calls just to render a badge dot | **Yes** — badge query re-fires on every nav despite cart contents only changing after explicit mutations |
| `EventRegistrationPlans` — identical text duplicated | `RegisterClient.jsx` and `ConfirmClient.jsx` — both also independently call `/api/registration/plans` first | once on `/register`, once again on `/register/confirm`, same wizard session, same event | **Yes** — can't change between two sequential wizard steps, yet `fetchPublicGraphQL` has zero caching (unlike `getRasayeshEventInfo`) |
| `GetRasayeshEventInfo` (event website/slug) | `lib/publicRasayeshClient.js`, called from 3 server routes | multiple routes call per-request but... | **No — already deduped.** Module-scope `Map` with 5-min TTL. Good existing pattern, not a concern |
| Content queries (blog posts, gallery, companies, panels, company detail) | `HomeClient.js`, `NewsClient.jsx`, `GalleryClient.jsx`, `CompaniesClient.jsx`, `PanelsClient.jsx`, `CompanyDetailClient.jsx` — all via `fetchPublicGraphQL` (zero caching) | once per page/interaction | **No cross-component redundancy**, but `fetchPublicGraphQL` has no caching at all, so revisiting the same content in one session always refetches — low-priority short-TTL candidate |

### Supporting evidence
- `lib/apolloClient.js` sets `fetchPolicy: 'no-cache'` for **both** `query` and `watchQuery` in `defaultOptions` — `InMemoryCache` exists but is effectively unused by default; only `AppHeader.js` and `ProfilePhotoGuard.jsx` opt into `cache-first`.
- `EditProfileClient.jsx` calls `client.cache.evict({ fieldName: "getAttendee" })` after every mutation — proof the team already knows all `getAttendee`-selecting queries normalize under the same cache field key (no `id` field to entity-normalize by) and manually evicts to force freshness. This is indirect evidence that consolidating these into one shared query/hook is both safe and already anticipated by the existing cache-eviction discipline.
- `ProfilePhotoGuard.jsx` already implements a `localStorage`-based session cache (`iph_photo_ok`) specifically to avoid re-querying on every navigation — proving the team is aware of exactly this redundancy class for one of the two duplicate photo-check queries, but `AppHeader`'s twin implementation has no equivalent guard.

**Recommended fix:** (a) Consolidate `FORM_OPTIONS_QUERY` into one shared hook with a long TTL (mirror `getRasayeshEventInfo`'s 5-minute pattern) — zero risk, static data. (b) Move cart-badge state in `AppHeader` off a per-navigation GraphQL query onto a shared/global cart-count context updated only after cart mutations. (c) Merge the two attendee-photo-check queries into one shared hook consumed by both `AppHeader` and `ProfilePhotoGuard`. (d) Give `ProfileClient`/`EditProfileClient`'s shared `GetAttendee` query a single owning hook/context instead of two independent component-level copies. (e) Cache `EventRegistrationPlans` with the same TTL pattern as `getRasayeshEventInfo` across the two wizard steps.

---

## 3. Companies List + Map Data Caching Candidacy

### `/companies` and `/companies/[slug]`
- Both `page.js` are `force-dynamic`, but only fetch the page title server-side.
- **The actual company list/detail data is not read from the local DB at all** — `CompaniesClient.jsx`/`CompanyDetailClient.jsx` call `fetchPublicGraphQL()` directly against `https://api.rasayesh.com/graphql`, live, in a `useEffect(..., [])` on every mount/navigation, with **zero caching**.
- `app/api/companies/route.js` and `/api/companies/[slug]/route.js` are DB-backed (`companies` table) but **dead code** — confirmed unused by grep; nothing in the app calls them.
- `app/api/companies/config/route.js` reads `app_settings.companies_config` via `query()`, no cache headers, no tags, no revalidate.

**Admin-editable-only confirmation:** `companies_config` (event ID, visible fields, logo base URL, sort settings) genuinely is admin-editable-only — write path: `iph-apn` `PUT /api/admin/companies/settings`. **The company records themselves are not** — they live in Rasayesh (external CRM), fetched live. An admin "sync" button exists (`iph-apn` `POST /api/admin/companies/sync`) but writes to the disconnected/dead local `companies` table, not what the UI actually renders.

### `/map`, Map3DView, `/api/map`, `/api/map/booth-by-qr`, `/api/nav`
- `app/map/page.js` is `force-dynamic`, only fetches the page title.
- `MapClient.jsx` does a single `fetch("/api/map")` in `useEffect(..., [])` — once per mount — and spreads the result into ~15 separate `useState` slots.
- `Map3DView.jsx` is imported **statically** (`import Map3DView from "./Map3DView"`, not `next/dynamic`) — it's a pure presentational component that takes all data as props and does zero fetching itself.
  - **Coupling verdict:** decoupled at the **data** layer (component doesn't fetch), but coupled at the **JS-bundle** layer (a static import means the Three.js/WebGL code always ships in the same chunk as `MapClient` regardless of whether `/api/map`'s JSON is cached). Caching the JSON speeds up data resolution but does **not** reduce shipped JS — that requires separately lazy-loading `Map3DView` itself (see Section 5).
- `app/api/map/route.js` is a **hybrid** response:
  - **Live external** (not admin-editable): `websiteEvent` (halls/booths/booth→company mapping) fetched from Rasayesh GraphQL with explicit `cache: 'no-store'`, no revalidate/tag.
  - **Admin-editable local config** (13 separate `query()` reads merged into one response): hall colors, map elements, doors, floors, zones, walls, nav camera config, nav marker icons, map appearance, gesture hints, control icons, route appearance, map labels. None have cache headers.
- `app/api/map/booth-by-qr/route.js`: DB-backed, no cache headers, but **no current caller found in the app** (the QR scanner posts to `/api/quest/scan` instead) — likely legacy/dead, flag for cleanup before investing in caching.
- `app/api/nav/route.js`: `force-dynamic`, reads `bottom_nav_items`, no cache headers. Small, cleanly admin-editable-only — trivial, strong caching candidate.

**Admin-editable-only confirmation for map config**, all gated by `iph-apn` admin auth under the `map` permission: elements, walls, doors, zones, hall-colors, hall-floors, appearance/nav-camera/nav-markers/gesture-hint/gesture-hint-images/control-icons/route-appearance/settings — all `POST`/`PUT` under `iph-apn/app/api/admin/map/*`. The `websiteEvent` (halls/booths) portion is **not** admin-editable from either app — same Rasayesh-external caveat as companies.

### Existing caching/revalidation infrastructure: none
A repo-wide grep across both `frontend` and `iph-apn` found **zero** uses of `Cache-Control`, `revalidate`, `next: {tags}`, `revalidateTag`, or `revalidatePath` anywhere. `next.config.mjs` sets no global headers. Every admin-editable-only endpoint currently hits Postgres directly on every request with no caching at any layer.

### Verdict table

| Route | Admin-editable-only? | Verdict |
|---|---|---|
| `/companies`, `/companies/[slug]` | Partial — only `companies_config` is | `/api/companies/config`: strong tag-based candidate. Company list itself: needs short-TTL cache (no local edit signal), not tag invalidation |
| `/api/companies` (route.js) | Yes in theory, but dead code | Not a caching priority — wire up or remove first |
| `/api/companies/config` | **Yes, confirmed** | **Strong candidate** — `revalidateTag` on the `iph-apn` admin PUT |
| `/api/map` | Partial — config sub-objects yes, `websiteEvent` no | **Split it**: admin-config blob = strong tag/ISR candidate; `websiteEvent` = separate short-TTL cache |
| `/api/map/booth-by-qr` | Yes via sync, but no current caller | Low priority — verify liveness first |
| `/api/nav` | Yes, standard `app_settings`-style | Trivial, strong candidate |

**Key nuance:** the premise "companies list + map data is admin-editable-only" is only *fully* true for the map's local config layer and `/api/companies/config`. The company list itself and the map's halls/booths data are sourced live from external Rasayesh, which this app's admin panel doesn't control. **Two different caching mechanisms are needed**: tag/path-based on-demand revalidation (new plumbing: `revalidateTag`/`revalidatePath` calls added to the `iph-apn` admin save routes) for genuinely admin-editable pieces, and short TTL/ISR (mirroring `getRasayeshEventInfo`'s existing 5-minute pattern) for the Rasayesh-sourced pieces since there's no edit-event signal for those.

**Recommended fix:** Split `/api/map` into two cached layers (admin-config, tag-invalidated; `websiteEvent`, short-TTL), tag-cache `/api/companies/config` and `/api/nav`, and apply a short TTL to the Rasayesh-sourced company-list/company-detail/`websiteEvent` fetches. Delete or reconnect the dead `/api/companies[/[slug]]` routes and `/api/map/booth-by-qr` before investing further caching effort in them.

---

## 4. Bundle Size

### Bundle analyzer
- `@next/bundle-analyzer` is **not installed** (absent from both `dependencies` and `devDependencies`).
- `next.config.mjs` has no `withBundleAnalyzer` wrapping, no `experimental` block, no `cacheComponents` flag — just an empty `headers()` returning `[]`.
- The build uses **Turbopack** (opaque short-hash chunk names, `turbopack-*.js` runtime file present) — `@next/bundle-analyzer` is a webpack plugin and would need extra config to attach to a Turbopack build even once installed.

### Chunk size ranking (via `build-manifest.json` + per-route `client-reference-manifest.js`, no analyzer)

**Global chunks (loaded on every page):**

| Chunk | Size | Content |
|---|---|---|
| `03rzz3nlvqf2j.js` | 224K | React/react-dom core |
| `2bqqani5kzr1u.js` | **180K** | **`@apollo/client` core** — pulled in by `ApolloClientProvider`, imported eagerly in root `app/layout.js`, present in ~30/32 route manifests |
| `2ysilxgdg1pfj.js` | 140K | RSC/flight streaming runtime |
| `0cz1d0mv5g_q7.js` | 112K | polyfills |
| `3auxfzu2sypzx.js` | 52K | secondary Apollo-related shared chunk (~19 routes) |
| `27jktro2p5rq9.js` / `0n2vn5ne6kosf.js` / `turbopack-*.js` | 44K / 32K / 12K | Next.js/Turbopack runtime |

**Route-specific / semi-shared large chunks:**

| Chunk | Size | Content | Route(s) |
|---|---|---|---|
| `204-70wh77lj3.js` | **656K — largest chunk in the entire build** | three.js + OrbitControls | **`/map` AND `/` (home)** — root cause below |
| `2dubm8enrzx_o.js` | 460K | `@zxing/browser` (QR scanner) | dynamically split, on-demand only — **not** a problem, see Section 5 |
| `3gti1qdk5epqn.js` | 196K | `html2canvas` | dynamically split, on-demand only — **not** a problem |
| `066qu1dj_3jh9.js` | 140K | `qrcode.react` + Apollo query code | `/` (home) only |
| `2wsrc_dho53g2.js` | 124K | `react-markdown` | `/` (home) **and** `/chat` |
| `1tt7bn2uo0dn4.js` | 48K | `react-easy-crop` + Apollo mutations | `/profile/edit` only |
| `33hz1v5r0af4p.js` | 44K | notifications app code | `/notifications` only |

### Root cause of home-page bloat

`app/page.js` is a server-configurable "aliasable homepage": a `switch`/`case` picks **one** of `QuestClient`, `CompaniesClient`, `PanelsClient`, `BadgeClient`, `MapClient`, `ChatClient`, `NotificationsClient`, `GalleryClient`, `NewsClient`, `ProfileClient`, or default `HomeClient` to render at request time, based on a DB-driven config value. **All eleven are statically imported at the top of the file with plain `import` statements — none use `next/dynamic`.** As a result, the `/` bundle ships three.js (656K), react-markdown (124K), and qrcode.react (140K) from every possible branch simultaneously, even though only one branch's UI actually renders per request. This is the single largest bundle-size finding in the audit.

**Recommended fix:** Convert all branch imports in `app/page.js` to `next/dynamic(() => import(...))`, keyed by the resolved config branch. This alone removes the 656K three.js chunk, the 124K react-markdown chunk, and the 140K qrcode.react chunk from the home page in the common case (whichever branch isn't selected). No behavior change — Next already supports per-branch code splitting this way.

---

## 5. Component-Level Lazy Loading

| Component | Import style | Imported from | Scope |
|---|---|---|---|
| **Map3DView** (three.js, 656K) | **Eager**, plain `import` — no `next/dynamic` anywhere | `app/map/MapClient.jsx` (also eager) | `/map` **plus** `/` via the `app/page.js` aliasing issue above |
| **Chat / react-markdown** | **Eager**, plain `import` | `app/chat/ChatClient.jsx` | `/chat` **plus** `/` via the same aliasing issue |
| **QR scanner (`@zxing/browser`)** | **Lazy — correct**: runtime `import("@zxing/browser")` inside handler functions | `app/badge/BadgeClient.jsx`, `app/quest/scan/page.js` | route-scoped, on-demand — good |
| **html2canvas** | **Lazy — correct**: `await import("html2canvas")` inside the capture handler | `app/badge/BadgeClient.jsx` | route-scoped, on-demand — good |
| **QRCodeSVG (`qrcode.react`)** | **Eager**, top-level `import` | `RasayeshBadgeCard.jsx` → `BadgeClient.jsx` | `/badge` **plus** `/` via the aliasing issue |
| **emoji-picker-react** | **Lazy — correct, the only canonical `next/dynamic` usage in the codebase**: `dynamic(() => import('emoji-picker-react'), { ssr: false })` | `app/components/EmojiPickerInput.js` | wherever used, not shared-layout — good |
| **react-easy-crop (`Cropper`)** | **Eager**, top-level `import` | `app/profile/edit/EditProfileClient.jsx` | route-scoped to `/profile/edit` only (not aliased in `page.js`) |
| **`@apollo/client` core** | **Eager**, unconditional | `app/layout.js` (`ApolloClientProvider` wraps `{children}` in the **root layout**) | loaded on **every page** (30+/32 manifests) — arguably necessary as the global data client, but flagged as the largest true "every-page" fixed cost (~230K combined across the two Apollo-related chunks) |

**Recommended fix:** Wrap `Map3DView` in `next/dynamic(..., { ssr: false })` in `MapClient.jsx` (WebGL can't render server-side anyway, so this is a pure win with no SSR tradeoff) — combined with the `app/page.js` fix in Section 4, this removes the 656K three.js chunk from every route except an actual `/map` visit. Lower-priority: convert `react-markdown` and `react-easy-crop` to `next/dynamic` too. `@zxing/browser`, `html2canvas`, and `emoji-picker-react` are already well-optimized — no action needed.

---

## 6. Middleware / Proxy Overhead

**Documentation note (not a perf bug):** CLAUDE.md describes `proxy.js` as running on the Edge Runtime — true for the old `middleware.js` convention pre-v15.5, but as of **Next.js 16.0.0** (this repo is on 16.2.7), the file convention was renamed `middleware` → `proxy` and **defaults to the Node.js runtime** (confirmed in the bundled Next.js docs). The `pg.Pool`-based DB calls in `proxy.js` are not an Edge-runtime workaround — they run in the normal Node.js process. Worth a CLAUDE.md correction, not a performance fix.

**Matcher scoping:** already correctly excludes `_next/static`, `_next/image`, favicon, manifest, `sw.js`, icons, logo, fonts, `uploads/`, and common static extensions — proxy does not run on static assets. Good baseline, no action needed.

**Per-request DB cost:**
1. `getAppPages()` — queries `app_pages`, cached in a module-scope variable for **60s**. Cheap after first hit.
2. `getCurrentTokenVersion()` — queries `app_settings.auth_token_version`. **No caching at all.** Runs a full DB round-trip on **every single authenticated page request**, and also on every client-side navigation and Next.js router prefetch (link hover/viewport-enter prefetches each trigger their own proxy invocation). The value it checks changes only when an admin explicitly forces a logout — essentially never during a normal session.
3. Admin paths (`/apn/*`, `/api/admin/*`): `verifyAdminToken()` is a synchronous HMAC-SHA256 + `timingSafeEqual` check, **no DB call** — cheap, well-designed.

**Assessment:** the proxy is otherwise well-scoped. The one real inefficiency is `getCurrentTokenVersion()` — an uncached, synchronous DB round-trip gating every authenticated page transition and prefetch, directly contributing to the reported 2-3s transition latency.

**Recommended fix:** Cache `getCurrentTokenVersion()` the same way `getAppPages()` already is — a module-scope value with a 30-60s TTL. Force-logout is an admin-initiated, rare, non-urgent action; a ~60s propagation delay matches the staleness contract the `getAppPages()` cache already accepts for the same table pattern. This removes one full DB round-trip from the critical path of every single page transition, with minimal risk.

---

## Prioritized Top 5 (ranked by estimated impact ÷ implementation risk)

| # | Fix | Impact | Risk | Why this rank |
|---|---|---|---|---|
| 1 | **`app/page.js`: convert the 11 aliased homepage branch imports to `next/dynamic`** | Very high — removes the single largest chunk in the build (three.js, 656K) plus react-markdown (124K) and qrcode.react (140K) from the home route in the common case | Very low — standard Next.js code-splitting pattern, no behavior change, home page already only renders one branch | Biggest bundle win in the whole audit for what is a mechanical, well-understood change |
| 2 | **`proxy.js`: cache `getCurrentTokenVersion()` with the same TTL pattern already used by `getAppPages()`** | Medium-high — removes one synchronous DB round-trip from *every* authenticated page transition and router prefetch, directly targeting the reported 2-3s navigation feel | Very low — copy an existing, already-proven pattern in the same file | Smallest, safest change with a direct hit on the reported symptom |
| 3 | **`app/map/MapClient.jsx`: wrap `Map3DView` in `next/dynamic(..., { ssr: false })`** | High — the 656K three.js chunk currently loads on `/map` unconditionally; combined with #1, this keeps it off every route except an actual map visit | Low — WebGL/Three.js cannot run server-side regardless, so `ssr: false` has no downside | Same-family fix as #1, standard pattern, clear win |
| 4 | **Rasayesh call dedup: consolidate `FORM_OPTIONS_QUERY` (3x) and move the `AppHeader` cart-badge/photo-check queries off per-navigation refetch onto shared context/cache** | Medium — cuts redundant upstream Rasayesh round-trips on nearly every navigation and form mount, improving both perceived speed and upstream load | Low-medium — pure client-side consolidation, no new server infra, but touches several shared components (`AppHeader`, `ProfilePhotoGuard`, form pages) so needs care not to regress the cache-eviction discipline already in place | Real latency win, contained blast radius, no new backend plumbing required |
| 5 | **Root layout: decouple `app/layout.js` font/theme/app-identity reads from `force-dynamic`, enabling static/ISR for the ~26 pages that have no independent dynamic reason** | Very high ceiling — this is the actual root cause of "all 43 routes are dynamic," and unlocking it lets most of the app be served static/ISR instead of full SSR-per-request | Higher — requires new `revalidatePath`/`revalidateTag` plumbing (none exists in the repo today), coordinated changes across several `iph-apn` admin-save routes, and careful re-auditing of each page's own now-redundant `force-dynamic` export before removing it | Highest absolute impact in the audit, but ranked last because it's the only fix here that requires new cross-repo infrastructure and touches the most surface area — should follow the lower-risk wins above, not precede them |

**Not in the top 5 but worth flagging separately:** `/api/companies/config`, `/api/map` (split into admin-config vs. `websiteEvent` layers), and `/api/nav` are strong candidates for tag-based on-demand revalidation once the `revalidateTag`/`revalidatePath` plumbing from #5 exists — they should be done as a follow-on to #5 rather than independently, since they share the same missing infrastructure. Also flagged for cleanup (not caching investment): the dead `/api/companies[/[slug]]` routes and the apparently-uncalled `/api/map/booth-by-qr` route.
