import { NextResponse } from 'next/server'
import { Pool } from 'pg'
import { createClient } from 'redis'
import { verifyAdminToken } from '@/lib/adminAuth'
import { ADMIN_SECTIONS } from '@/lib/adminSections'
import { resolveEventIdForHost } from '@/lib/domainEventMap'

const APP_PUBLIC_URL = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://appapn.rasayesh.com'

// IranPharma -- used whenever a request's Host header doesn't match any
// active event's domain (unmapped/unknown host, or the DB/Redis lookup
// itself failed). Never hard-fails the request over this.
const FALLBACK_EVENT_ID = 1

// Dedicated minimal pool for proxy checks — isolated from app pool per Next.js proxy guidance
let _proxyPool
function getProxyPool() {
  if (!_proxyPool) {
    _proxyPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 60000,
      connectionTimeoutMillis: 2000,
    })
  }
  return _proxyPool
}

// Own Redis client, isolated from lib/cache-handler-redis.js's for the same
// reason the pg pool above is isolated from lib/db.js's — and its own key
// prefix so the two never collide. Same fail-open contract as that file:
// every call checks isReady synchronously and never awaits a connection
// attempt, so a down/unreachable Redis degrades to a per-request DB query
// instead of blocking or throwing (see cache-handler-redis.js for the full
// rationale). This matters more here than there: proxy.js runs on every
// authenticated request, not just cache misses.
const PROXY_KEY_PREFIX = 'iph-app:proxy:'
const REDIS_URL = process.env.REDIS_URL

let _redisClient = null
function getRedisClient() {
  if (!REDIS_URL) return null
  if (_redisClient) return _redisClient
  _redisClient = createClient({
    url: REDIS_URL,
    socket: {
      connectTimeout: 2000,
      reconnectStrategy: (retries) => Math.min(retries * 500, 5000),
    },
  })
  _redisClient.on('error', (err) => {
    console.error('[proxy] Redis connection error:', err.message)
  })
  _redisClient.connect().catch((err) => {
    console.error('[proxy] Redis initial connect failed (fail-open, querying DB directly):', err.message)
  })
  return _redisClient
}

function redisReady() {
  const c = getRedisClient()
  return c && c.isReady ? c : null
}

// auth_token_version only changes when an admin explicitly force-logs-out all
// sessions — same rarely-changes / admin-triggered-only shape as app_pages
// below — so it's cached the same way instead of hitting the DB on every
// single authenticated request/navigation/prefetch. Shared across all
// container replicas via Redis instead of a per-process variable, so a
// force-logout takes effect on every instance within the same TTL window.
const TOKEN_VERSION_CACHE_TTL_SEC = 60
const PAGES_CACHE_TTL_SEC = 60

async function getCurrentTokenVersion() {
  const c = redisReady()
  if (c) {
    try {
      const cached = await c.get(PROXY_KEY_PREFIX + 'token-version')
      if (cached !== null) return Number(cached)
    } catch (err) {
      console.error('[proxy] Redis get(token-version) failed, querying DB:', err.message)
    }
  }
  const client = await getProxyPool().connect()
  try {
    const { rows } = await client.query(
      "SELECT value FROM app_settings WHERE key = 'auth_token_version'"
    )
    const version = rows[0]?.value?.version ?? 1
    if (c) {
      c.setEx(PROXY_KEY_PREFIX + 'token-version', TOKEN_VERSION_CACHE_TTL_SEC, String(version)).catch((err) => {
        console.error('[proxy] Redis setEx(token-version) failed:', err.message)
      })
    }
    return version
  } catch {
    return 1
  } finally {
    client.release()
  }
}

// app_pages gained an event_id column in the Tier 3 migration, but this
// function (and iph-apn's /api/admin/app-pages route) was never updated to
// filter by it -- found during Phase 5 when a second event's requests
// started inheriting the first event's page enable/disable + custom_path
// settings wholesale (both events' rows queried together, no WHERE clause).
async function getAppPages(eventId) {
  const cacheKey = PROXY_KEY_PREFIX + 'app-pages:' + eventId
  const c = redisReady()
  if (c) {
    try {
      const cached = await c.get(cacheKey)
      if (cached !== null) return JSON.parse(cached)
    } catch (err) {
      console.error('[proxy] Redis get(app-pages) failed, querying DB:', err.message)
    }
  }
  const client = await getProxyPool().connect()
  try {
    const { rows } = await client.query(
      'SELECT page_key, default_path, custom_path, is_active FROM app_pages WHERE event_id = $1 ORDER BY id ASC',
      [eventId]
    )
    if (c) {
      c.setEx(cacheKey, PAGES_CACHE_TTL_SEC, JSON.stringify(rows)).catch((err) => {
        console.error('[proxy] Redis setEx(app-pages) failed:', err.message)
      })
    }
    return rows
  } catch {
    return []
  } finally {
    client.release()
  }
}

function toLocalMobile(mobile) {
  if (!mobile) return '';
  if (mobile.startsWith('+98')) return '0' + mobile.slice(3);
  if (mobile.startsWith('98') && mobile.length === 12) return '0' + mobile.slice(2);
  return mobile;
}

function clearAuthCookies(response) {
  response.cookies.set('iph_user', '', { path: '/', maxAge: 0 })
}

function getAdminSession(request) {
  const token = request.cookies.get('iph_admin_session')?.value
  return verifyAdminToken(token, process.env.ADMIN_SESSION_SECRET) // returns payload or null
}

// Derived from ADMIN_SECTIONS — add new sections there, not here
const PAGE_SECTION_MAP = Object.fromEntries(
  ADMIN_SECTIONS.map((s) => [s.path, s.key])
)

// Map /api/admin/[prefix] to permission keys (longest match wins via ordered check)
const API_SECTION_PREFIXES = [
  ['/api/admin/app-settings', 'app-settings'],
  ['/api/admin/app-pages', 'app-settings'],
  ['/api/admin/services', 'services'],
  ['/api/admin/quest-content', 'quest'],
  ['/api/admin/quest-missions', 'quest'],
  ['/api/admin/quest-badges', 'quest'],
  ['/api/admin/quest-featured-booth-status', 'quest'],
  ['/api/admin/quest-survey-responses', 'quest'],
  ['/api/admin/quest-social-shares', 'quest'],
  ['/api/admin/login-page', 'login-page'],
  ['/api/admin/users', 'users'],
  ['/api/admin/notifications', 'notifications'],
  ['/api/admin/companies', 'companies'],
  ['/api/admin/panels', 'panels'],
  ['/api/admin/badge', 'badge'],
  ['/api/admin/book', 'book'],
  ['/api/admin/cart', 'cart'],
  ['/api/admin/registration', 'registration'],
  ['/api/admin/map-labels', 'map-labels'],
]

function hasPermission(adminData, section) {
  if (adminData.isSuperAdmin === true) return true
  return Array.isArray(adminData.permissions) && adminData.permissions.includes(section)
}

function adminRedirect(request, path) {
  return NextResponse.redirect(new URL(path, APP_PUBLIC_URL))
}

function forbiddenRedirect(request) {
  const url = new URL('/?forbidden=1', APP_PUBLIC_URL)
  return NextResponse.redirect(url)
}

export async function proxy(request) {
  const { pathname } = request.nextUrl
  const host = request.headers.get('host') || ''

  // Resolve which local event this request's hostname belongs to, and make
  // it available to Server Components / Route Handlers downstream via a
  // request header (lib/currentEvent.js reads it back out with headers()).
  // Computed once here so every NextResponse.next() below carries it.
  const rawEventId = await resolveEventIdForHost(host)
  const resolvedEventId = rawEventId ?? FALLBACK_EVENT_ID
  if (rawEventId == null) {
    console.warn(`[proxy] no active event mapped for host="${host}" — falling back to event_id=${FALLBACK_EVENT_ID}`)
  }
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-resolved-event-id', String(resolvedEventId))
  const proceed = () => NextResponse.next({ request: { headers: requestHeaders } })

  // Block /apn on the main app domain — admin panel lives on its own subdomain
  if (host === 'app.iphexpo.com' && pathname.startsWith('/apn')) {
    return new NextResponse('Not Found', { status: 404 })
  }

  // ── Admin API protection (/api/admin/*) ──────────────────────────────────
  if (pathname.startsWith('/api/admin/')) {
    const adminData = getAdminSession(request)
    if (!adminData) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // /api/admin/admins/* — super-admin only
    if (pathname.startsWith('/api/admin/admins')) {
      if (adminData.isSuperAdmin !== true) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      return proceed()
    }

    // Check section-level permissions for other admin API routes
    for (const [prefix, section] of API_SECTION_PREFIXES) {
      if (pathname.startsWith(prefix)) {
        if (!hasPermission(adminData, section)) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
        return proceed()
      }
    }

    // Unknown admin API route — allow if session is valid (no specific section gate)
    return proceed()
  }

  // ── Admin panel page protection (/apn/*) ─────────────────────────────────
  if (pathname.startsWith('/apn/') || pathname === '/apn') {
    if (pathname === '/apn/login') {
      if (getAdminSession(request)) {
        return adminRedirect(request, '/apn')
      }
      return proceed()
    }

    const adminData = getAdminSession(request)
    if (!adminData) {
      return adminRedirect(request, '/apn/login')
    }

    // /apn/admins — super-admin only
    if (pathname === '/apn/admins' || pathname.startsWith('/apn/admins/')) {
      if (adminData.isSuperAdmin !== true) {
        return forbiddenRedirect(request)
      }
      return proceed()
    }

    // Check section-level permissions for /apn/[section] pages
    const section = PAGE_SECTION_MAP[pathname]
    if (section && !hasPermission(adminData, section)) {
      return forbiddenRedirect(request)
    }

    return proceed()
  }

  // ── All other API routes pass through (no user-auth check) ───────────────
  if (pathname.startsWith('/api/')) {
    return proceed()
  }

  // ── Regular user auth ─────────────────────────────────────────────────────
  const userCookieRaw = request.cookies.get('iph_user')?.value

  if (userCookieRaw && (pathname.startsWith('/login') || pathname.startsWith('/signup'))) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  if (pathname.startsWith('/login') || pathname.startsWith('/signup')) {
    return proceed()
  }

  // ZarinPal redirects here without user session — must not require auth
  if (pathname === '/book/callback' || pathname.startsWith('/book/callback/')) {
    return proceed()
  }

  if (pathname === '/cart/callback' || pathname.startsWith('/cart/callback/')) {
    return proceed()
  }

  // TWA/Android app verification (Digital Asset Links) — must be publicly accessible, no auth
  if (pathname.startsWith('/.well-known/')) {
    return proceed()
  }

  // ── App pages enforcement ─────────────────────────────────────────────────
  // Runs before auth so disabled pages 404 regardless of login state.
  // Table may not exist yet (before migration) — fail-open in that case.
  try {
    const pages = await getAppPages(resolvedEventId)
    for (const page of pages) {
      const onDefault = pathname === page.default_path || pathname.startsWith(page.default_path + '/')
      const onCustom  = !!page.custom_path && (pathname === page.custom_path || pathname.startsWith(page.custom_path + '/'))

      if (!page.is_active && (onDefault || onCustom)) {
        return new NextResponse('Not Found', { status: 404 })
      }

      if (page.is_active && page.custom_path) {
        if (onDefault) {
          // Redirect old default path → custom path
          const remainder = pathname.slice(page.default_path.length)
          return NextResponse.redirect(new URL(page.custom_path + remainder, request.url), 307)
        }
        if (onCustom) {
          // Rewrite custom path → actual Next.js route (URL stays as custom_path)
          const remainder = pathname.slice(page.custom_path.length)
          return NextResponse.rewrite(new URL(page.default_path + remainder, request.url))
        }
      }
    }
  } catch {
    // Fail-open: table missing or DB error — let request through normally
  }

  if (!userCookieRaw) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('from', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Token version check: if DB version is higher, admin triggered force-logout
  try {
    const userVersion = JSON.parse(userCookieRaw).tokenVersion ?? 1
    const currentVersion = await getCurrentTokenVersion()

    if (userVersion < currentVersion) {
      const response = NextResponse.redirect(new URL('/login', request.url))
      clearAuthCookies(response)
      return response
    }
  } catch {
    // Fail-open: if DB check errors, let the request through
  }

  return proceed()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw\\.js|icons/|logo|fonts|uploads/|.*\\.png$|.*\\.jpg$|.*\\.svg$|.*\\.ico$|.*\\.webmanifest$|.*\\.woff2?$).*)',
  ],
}
