import { NextResponse } from 'next/server'
import { Pool } from 'pg'
import { verifyAdminToken } from '@/lib/adminAuth'
import { ADMIN_SECTIONS } from '@/lib/adminSections'

const APP_PUBLIC_URL = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://appapn.iphexpo.com'

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

let _pagesCache = null
let _pagesCacheTime = 0
const PAGES_CACHE_TTL = 60_000

// auth_token_version only changes when an admin explicitly force-logs-out all
// sessions — same rarely-changes / admin-triggered-only shape as app_pages
// above — so it's cached the same way instead of hitting the DB on every
// single authenticated request/navigation/prefetch.
let _tokenVersionCache = null
let _tokenVersionCacheTime = 0
const TOKEN_VERSION_CACHE_TTL = 60_000

async function getCurrentTokenVersion() {
  const now = Date.now()
  if (_tokenVersionCache !== null && now - _tokenVersionCacheTime < TOKEN_VERSION_CACHE_TTL) {
    return _tokenVersionCache
  }
  const client = await getProxyPool().connect()
  try {
    const { rows } = await client.query(
      "SELECT value FROM app_settings WHERE key = 'auth_token_version'"
    )
    const version = rows[0]?.value?.version ?? 1
    _tokenVersionCache = version
    _tokenVersionCacheTime = now
    return version
  } catch {
    return _tokenVersionCache ?? 1
  } finally {
    client.release()
  }
}

async function getAppPages() {
  const now = Date.now()
  if (_pagesCache && now - _pagesCacheTime < PAGES_CACHE_TTL) return _pagesCache
  const client = await getProxyPool().connect()
  try {
    const { rows } = await client.query(
      'SELECT page_key, default_path, custom_path, is_active FROM app_pages ORDER BY id ASC'
    )
    _pagesCache = rows
    _pagesCacheTime = now
    return rows
  } catch {
    return _pagesCache || []
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
  ['/api/admin/button-styles', 'appearance'],
  ['/api/admin/banners', 'appearance'],
  ['/api/admin/fonts', 'appearance'],
  ['/api/admin/theme-colors', 'appearance'],
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

  // Block /apn on the main app domain — admin panel lives on its own subdomain
  const host = request.headers.get('host') || ''
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
      return NextResponse.next()
    }

    // Check section-level permissions for other admin API routes
    for (const [prefix, section] of API_SECTION_PREFIXES) {
      if (pathname.startsWith(prefix)) {
        if (!hasPermission(adminData, section)) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
        return NextResponse.next()
      }
    }

    // Unknown admin API route — allow if session is valid (no specific section gate)
    return NextResponse.next()
  }

  // ── Admin panel page protection (/apn/*) ─────────────────────────────────
  if (pathname.startsWith('/apn/') || pathname === '/apn') {
    if (pathname === '/apn/login') {
      if (getAdminSession(request)) {
        return adminRedirect(request, '/apn')
      }
      return NextResponse.next()
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
      return NextResponse.next()
    }

    // Check section-level permissions for /apn/[section] pages
    const section = PAGE_SECTION_MAP[pathname]
    if (section && !hasPermission(adminData, section)) {
      return forbiddenRedirect(request)
    }

    return NextResponse.next()
  }

  // ── All other API routes pass through (no user-auth check) ───────────────
  if (pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  // ── Regular user auth ─────────────────────────────────────────────────────
  const userCookieRaw = request.cookies.get('iph_user')?.value

  if (userCookieRaw && (pathname.startsWith('/login') || pathname.startsWith('/signup'))) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  if (pathname.startsWith('/login') || pathname.startsWith('/signup')) {
    return NextResponse.next()
  }

  // ZarinPal redirects here without user session — must not require auth
  if (pathname === '/book/callback' || pathname.startsWith('/book/callback/')) {
    return NextResponse.next()
  }

  if (pathname === '/cart/callback' || pathname.startsWith('/cart/callback/')) {
    return NextResponse.next()
  }

  // TWA/Android app verification (Digital Asset Links) — must be publicly accessible, no auth
  if (pathname.startsWith('/.well-known/')) {
    return NextResponse.next()
  }

  // ── App pages enforcement ─────────────────────────────────────────────────
  // Runs before auth so disabled pages 404 regardless of login state.
  // Table may not exist yet (before migration) — fail-open in that case.
  try {
    const pages = await getAppPages()
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

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw\\.js|icons/|logo|fonts|uploads/|.*\\.png$|.*\\.jpg$|.*\\.svg$|.*\\.ico$|.*\\.webmanifest$|.*\\.woff2?$).*)',
  ],
}
