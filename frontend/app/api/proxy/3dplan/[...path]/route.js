import { NextResponse } from 'next/server';
import { STRIPPED_PROXY_RESPONSE_HEADERS, applyFramingHeaders } from '@/lib/proxy3dplanHeaders';

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
//
// Update (2026-08-25): the plan's root-relative /static/* asset requests
// (JS chunks, CSS, fonts -- webpack publicPath is hardcoded to "/" upstream)
// are NOT handled by this proxy's HTML rewrite below, since they're
// runtime-computed in JS rather than literal HTML text. See
// app/static/[...path]/route.js, which mirrors 3dplan's /static/* tree at
// our own domain root to serve those.
const UPSTREAM = 'https://3dplan.rasayesh.com';
const PROXY_PREFIX = '/api/proxy/3dplan';

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
    if (STRIPPED_PROXY_RESPONSE_HEADERS.has(key.toLowerCase())) continue;
    headers.set(key, value);
  }
  applyFramingHeaders(headers);

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
