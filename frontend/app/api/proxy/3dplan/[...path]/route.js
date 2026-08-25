import { NextResponse } from 'next/server';

// Reverse proxy for embedding https://3dplan.rasayesh.com in an <iframe> on
// /map. The upstream sends X-Frame-Options: DENY, which blocks top-level
// document framing only -- it has no effect on cross-origin subresource
// requests, so this proxy exists solely to serve the top-level plan
// document (and its same-origin static assets) from OUR origin instead.
//
// Investigated before writing this (2026-08-25): the plan page's JS
// bundles reference exactly two absolute cross-origin hosts --
// api.3dplan.rasayesh.com and api.rasayesh.com -- both fine to call
// directly from inside the iframe (subresource fetches aren't subject to
// DENY). No relative /api/... calls or websocket usage were found via
// static analysis of the bundle JS. NOT verified via a live browser network
// trace (no headless browser available in this environment) -- if the
// embedded plan is missing data or images, check the browser's Network tab
// for 404s to OUR domain (not 3dplan.rasayesh.com) first; that would mean
// something references a root-relative path this proxy doesn't rewrite.
const UPSTREAM = 'https://3dplan.rasayesh.com';
const PROXY_PREFIX = '/api/proxy/3dplan';

// Headers we deliberately do not forward from the upstream response:
// - x-frame-options / content-security-policy(-report-only): the entire
//   reason this proxy exists is to not carry these forward.
// - content-encoding / content-length / transfer-encoding: fetch() already
//   transparently decoded the body: forwarding the original encoding
//   label would mismatch what we're actually sending (and HTML responses
//   are rewritten below, changing the byte length anyway).
// - set-cookie: an upstream cookie relayed through our own Set-Cookie would
//   appear to the browser as if issued by us -- not needed for a read-only
//   plan viewer, so dropped rather than forwarded unexamined.
const STRIPPED_RESPONSE_HEADERS = new Set([
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'set-cookie',
]);

export async function GET(request, { params }) {
  const { path } = await params;
  const targetPath = (path ?? []).map(encodeURIComponent).join('/');
  const search = new URL(request.url).search;
  const targetUrl = `${UPSTREAM}/${targetPath}${search}`;

  let upstreamRes;
  try {
    upstreamRes = await fetch(targetUrl, {
      headers: { 'user-agent': request.headers.get('user-agent') || '' },
      redirect: 'follow',
    });
  } catch (err) {
    console.error('[proxy/3dplan] upstream fetch failed:', err.message);
    return NextResponse.json({ error: 'Upstream fetch failed' }, { status: 502 });
  }

  const headers = new Headers();
  for (const [key, value] of upstreamRes.headers.entries()) {
    if (STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) continue;
    headers.set(key, value);
  }
  // Re-assert framing policy rather than leave it unset: this content
  // SHOULD be embeddable (that's the point of this route), but only from
  // our own app -- not by any third party who discovers this proxy URL and
  // points their own iframe at it, which would let them bypass 3dplan's
  // original DENY via us as an unwitting relay.
  headers.set('x-frame-options', 'SAMEORIGIN');
  headers.set('content-security-policy', "frame-ancestors 'self'");

  const contentType = upstreamRes.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    let html = await upstreamRes.text();
    // The upstream HTML references its own assets with root-relative paths
    // (e.g. href="/static/styles/app....css") that have no idea they're
    // being served from a different path prefix on our domain -- rewrite
    // them to route back through this same proxy instead of resolving
    // against our domain's actual root (where they'd 404).
    html = html.replace(
      /(href|src)="\/(?!\/)([^"]*)"/g,
      (_match, attr, rest) => `${attr}="${PROXY_PREFIX}/${rest}"`
    );
    headers.set('content-type', 'text/html; charset=utf-8');
    return new NextResponse(html, { status: upstreamRes.status, headers });
  }

  // Non-HTML (JS/CSS/images/fonts/etc.): stream through unmodified.
  return new NextResponse(upstreamRes.body, { status: upstreamRes.status, headers });
}
