# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo Layout

```
iph-superapp/
  frontend/      ← Next.js 14+ App Router (main app + admin panel)
  backend/       ← FastAPI + Ollama chatbot (CPU-only inference)
  docker-compose.yml
```

All work below assumes `cd frontend` unless told otherwise.

## Development Commands

```bash
# Dev server (Socket.IO + Next.js, port 3000)
npm run dev

# Production build
npm run build

# Start production server
npm start

# Lint
npm run lint

# One-time DB migrations (run from frontend/)
node scripts/migrate-notifications.js
node scripts/migrate-admins.js
node scripts/migrate-push-subscriptions.js
```

No automated test suite exists. Verify changes by running the dev server and testing manually.

## Architecture Overview

### Request lifecycle

```
Browser → proxy.js (Next.js middleware, Edge Runtime)
             ├─ /login         → public, no auth
             ├─ /apn/*         → admin JWT check via adminAuth.js
             └─ everything else → iph_access_token cookie check
                                  + token version DB check (force-logout)
        → server.js (custom HTTP server wraps Next.js + attaches Socket.IO)
        → Next.js App Router (page.js + XxxClient.jsx)
```

**Key files:**
- `proxy.js` — this IS the Next.js middleware (not named `middleware.js`). Handles user auth, admin auth, and token version–based force-logout.
- `server.js` — replaces `next start`. Exposes `globalThis._io` so API routes can emit Socket.IO events to connected clients.
- `app/layout.js` — root Server Component with `force-dynamic`; reads DB for font, theme colors, and app identity on every request.

### Page pattern (used everywhere)

Every page follows the same Server → Client split:

```
app/[page]/page.js          ← Server Component: reads DB, passes data as props
app/[page]/XxxClient.jsx    ← Client Component: all interactivity
```

`page.js` files always export `dynamic = 'force-dynamic'` and never contain UI logic. Client components are named `XxxClient.jsx` and hold all state and event handlers.

### Path alias

`@/` resolves to the `frontend/` root. Example: `import { query } from '@/lib/db'`.

### Real-time notifications

`server.js` embeds Socket.IO at `/socket.io`. API routes emit events via `globalThis._io`. Clients subscribe via `useNotificationSocket()` in `lib/socketClient.js`. On mobile-browser tab resume, clients re-fetch the REST endpoint as a fallback (WebSocket pauses in background tabs).

### Admin panel

Lives at `app/apn/*` — same Next.js codebase, served on `appapn.iphexpo.com/apn`. Adding a new admin section requires exactly two steps:
1. Add one entry to `lib/adminSections.js` → `ADMIN_SECTIONS`.
2. Add `/api/admin/[prefix]` mapping to `API_SECTION_PREFIXES` in `proxy.js`.

Admin auth uses a custom HMAC token (`lib/adminAuth.js`), not the user auth cookies.

### DB access pattern

Use `lib/db.js` → `query(sql, params)` everywhere. Pool is held on `globalThis._pgPool` to survive hot-reloads. `proxy.js` uses its own separate 2-connection pool to avoid contention.

Admin-configurable settings follow the `app_settings` key-value JSONB table. Reference implementation: `lib/getActiveFont.js` consumed in `app/layout.js`.

## Bilingual System (fa / en)

- **Storage key:** `localStorage['iph-lang']` → `'fa'` (default) or `'en'`
- **Hook:** `lib/useLang.js` → `useLang()` returns `{ lang, switchLang, isRTL }`. Listens to `storage` events so all mounted components switch simultaneously when `switchLang()` is called.
- **Translations:** `lib/i18n.js` → `translations` object + `t(lang, key)` helper. All UI strings must go through `t()`.
- **Direction sync:** `app/components/LangSync.js` (side-effect component, like `ThemeSync.js`) updates `document.documentElement.dir/lang` and adds/removes class `lang-en` reactively. An inline script in `app/layout.js` sets the correct `dir` before hydration to prevent flash.
- **English font:** `html.lang-en body` in `globals.css` overrides the active font with `Inter, system-ui`.
- **Login page:** English mode shows email input and calls `/api/auth/send-otp-email` + `/api/auth/verify-otp-email` instead of the mobile OTP routes.
- **Persian digits:** `toPersianDigits()` from `lib/utils.js` must only be called when `lang === 'fa'`. Always check `isRTL` before applying it.
- **Dates:** Jalali (`fa-IR-u-ca-persian`) only when `lang === 'fa'`; Gregorian otherwise.
- **Relative time:** `toPersianRelativeTime()` is Persian-only. Add a parallel English path when `lang === 'en'`.

## Theme System

- **Storage key:** `localStorage['iph-theme']` → `'dark'` (default) or `'light'`
- `ThemeSync.js` applies/removes class `light` on `<html>` and syncs `theme-color` meta.
- Theme colors are DB-driven via `lib/getThemeColors.js` (injected as `:root` / `html.light` CSS vars in `app/layout.js`).
- Always use CSS variables (`var(--bg)`, `var(--accent)`, `var(--text)`, etc.) — never hardcode hex.

## Design System (STRICT — never deviate)

### Colors
- Background: #021f20
- Accent: #00ffb3
- Surface: rgba(5,64,65,0.4)
- Text: #ffffff / rgba(255,255,255,0.5) / rgba(255,255,255,0.25)
- Borders: rgba(255,255,255,0.1) or rgba(0,255,179,0.2)

### Glass Morphism (ALL cards/panels)
- bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl
- or: bg-[#054041]/40 backdrop-blur-xl border border-[#00ffb3]/20 rounded-3xl

### Background (every page)
- Fixed base: #021f20
- Top-right glow: bg-[#00ffb3]/5 rounded-full blur-3xl absolute
- Bottom-left glow: bg-[#054041]/60 rounded-full blur-3xl absolute

### Typography
- Font: Vazirmatn from Google Fonts (weights 300/400/500/700); active font is DB-configurable
- Persian pages: dir="rtl" lang="fa" (driven by `useLang()`, not hardcoded)
- Persian line-height: leading-7 or leading-8

### Buttons
- Primary: bg-[#00ffb3] text-[#021f20] font-bold rounded-xl px-5 py-2.5 hover:bg-[#00e6a0]
- Ghost: border border-[#00ffb3]/20 bg-[#00ffb3]/5 text-[#00ffb3]/70 rounded-full

### Chat Bubbles (STRICT)
- RTL context: justify-start = right side, justify-end = left side
- User: justify-start + bg-[#00ffb3] text-[#021f20] rounded-3xl rounded-tr-sm
- Bot: justify-end + bg-white/10 text-white rounded-3xl rounded-tl-sm

## Route Protection Rule (ALWAYS APPLY)
- ALL pages except /login require authentication via `proxy.js`
- Page components must NOT contain login-check/redirect logic — middleware handles it globally
- Pages should assume the user is always authenticated when rendering
- User data available client-side from `iph_user` cookie via `hooks/useAuth.js`

## Icon Color Rule (ALWAYS APPLY)
- All custom image-based icons (PNG/SVG logos used as icons) must use CSS mask-image:

  ```css
  background-color: currentColor;
  mask-image: url('/path/to/icon.png');
  mask-size: contain; mask-repeat: no-repeat; mask-position: center;
  -webkit-mask-image: ...; /* same */
  ```

- Set `color` explicitly to `var(--text)` or `var(--bg)` — never rely on silent `currentColor` inheritance.
- Source PNGs in `/public/logo/` are solid black, suitable for mask-image.

## Contrast Rule (ALWAYS APPLY)
- Icon on `var(--bg)` or dark surface → `color: "var(--text)"`
- Icon on `var(--accent)` → `color: "var(--bg)"`

## Admin Settings Rule (ALWAYS APPLY)
Any setting editable in the admin panel must be:
1. Stored in the `app_settings` JSONB table
2. Read server-side via direct `query()` call (no fetch, no cache)
3. Consumed in a Server Component with `export const dynamic = 'force-dynamic'`

Reference: `lib/getActiveFont.js` + `app/layout.js`.

## File Upload Persistence Rule (ALWAYS APPLY)
- Admin uploads → `/public/uploads/[feature]/` (volume-mounted from host, survives rebuilds)
- Files outside this path are lost on `docker build`
- Static serve via `app/uploads/[...path]/route.js` (bypasses Next.js static file cache)

```
/public/uploads/banners/        /public/uploads/notifications/
/public/uploads/logos/          /public/uploads/services/
/public/uploads/quest/
```

Docker run command (after each build):
```bash
docker run -d --name iph-superapp-frontend -p 3002:3000 \
  -v /home/ubuntu/iph-superapp-uploads:/app/public/uploads \
  --restart unless-stopped iph-superapp-frontend
```

## Icon Size Rule (ALWAYS APPLY)
Every admin-manageable icon must have a corresponding size control (px, min=12, max=120, step=4). Clamp and snap server-side: `Math.round(v / 4) * 4`. Size the icon only — never the container. Defaults: nav=24, service grid=48, notifications=32, quest=36, login logo=80.

## Admin Sections Registry (ALWAYS APPLY)
All permission-gated admin sections live in `lib/adminSections.js` → `ADMIN_SECTIONS`. Adding a new `/apn/[section]` page: add one entry there. Adding `/api/admin/[prefix]` routes: add to `API_SECTION_PREFIXES` in `proxy.js`.

## Security Rules
- Never expose `api.rasayesh.com` or any external API URL to the browser — proxy through `/api/*`
- Auth tokens in httpOnly cookies only (`iph_access_token`, `iph_refresh_token`)
- `iph_user` cookie is readable (non-httpOnly) for client-side display only
- Rate limit OTP: 3 requests / 10 min / mobile or email
- OTP verify: 5 attempts max before requiring new OTP

## Authentication Flow

**Persian (fa) — mobile OTP:**
1. `POST /api/auth/send-otp { mobile }` → proxies `attendeeLogin(mobile)` to rasayesh GraphQL
2. `POST /api/auth/verify-otp { mobile, code }` → proxies `attendeeLoginValidateOTP`, sets httpOnly cookies

**English (en) — email OTP:**
1. `POST /api/auth/send-otp-email { email }` → proxies `attendeeLogin(email)`
2. `POST /api/auth/verify-otp-email { email, code }` → same cookie flow

Both flows upsert into `app_users` table (fire-and-forget). Force-logout is triggered by incrementing `app_settings['auth_token_version']`; middleware rejects cookies with an older version.

## Database

- Engine: PostgreSQL 16 (container: `iph-postgres`)
- `DATABASE_URL` env var → `lib/db.js` (pool max 10)
- Schema migrations are one-off Node scripts in `frontend/scripts/`

## Backend (FastAPI Chatbot)

- `backend/main.py` — FastAPI server, CPU Ollama inference (model: `iranpharma-assistant`, embed: `bge-m3`)
- Knowledge base: `backend/knowledge/` — CSV chat logs + FAISS index for semantic search
- Proxied to browser via `NEXT_PUBLIC_API_URL=/api/chat`

## Navigation (Bottom Nav)

3 tabs — labels from `t(lang, key)`:
- `nav_services` → `/` (home, service grid)
- `nav_badge` → `/badge` (visitor card)
- `nav_profile` → `/profile` (user info + settings)

## Booth Quest (Gamification)

Pages: `/quest` (hub) and `/quest/scan` (QR scanner via `@zxing/browser`).
QR format: `IPH-BOOTH-{boothId}`. Quest content (missions, leaderboard, badges) is DB-driven via `quest_content_blocks` table, admin-editable at `/apn/quest`.

## Testing Rule
- NEVER attempt to access live URLs (app.iphexpo.com, appapn.iphexpo.com) 
  for testing — all routes require authentication and return 403
- NEVER use browser/curl to test the live app
- Make code changes directly to files
- The developer (Ardeshir) will test manually after each Docker rebuild

## Local Testing
- To test the app locally from the server, use:
  curl http://localhost:3002/login (bypasses CDN and auth)
- NEVER access app.iphexpo.com or appapn.iphexpo.com from the server
  (CDN blocks server's own IP)
- For page content testing: curl http://localhost:3002/[path]
