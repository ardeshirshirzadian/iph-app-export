import { NextResponse } from 'next/server';
import { STRIPPED_PROXY_RESPONSE_HEADERS, applyFramingHeaders } from '@/lib/proxy3dplanHeaders';

// Serves the embedded https://3dplan.rasayesh.com plan document at a
// root-relative path matching what its own client-side router expects. See
// app/static/[...path]/route.js for the sibling asset proxy and
// lib/proxy3dplanHeaders.js for the shared header policy both use.
//
// This exists because 3dplan's react-router route table (in
// app.<hash>.bundle.js) is hardcoded as just:
//   path:"/plan/:eventId/:startNodeId?/:endNodeId?"  (the plan page)
//   path:"*"                                          (its own Not Found page)
// with no basename configured, so react-router matches routes against the
// FULL current window.location.pathname. The original document proxy at
// app/api/proxy/3dplan/[...path]/route.js served this same content but at
// /api/proxy/3dplan/plan/<id>/<n> -- a pathname that doesn't start with
// /plan/, so it fell through to react-router's "*" route and rendered
// 3dplan's own Not Found page even though the proxy fetched and served the
// correct HTML. Serving the document at the literal /plan/<id>/<n> path (this
// route) makes window.location.pathname match the route table above.
//
// No HTML rewriting is needed here (unlike the /api/proxy/3dplan document
// proxy): every root-relative asset reference in the plan's HTML/CSS/JS is
// under /static/ (confirmed via full bundle analysis, 2026-08-25), and
// root-relative paths resolve against the domain root regardless of the
// current document's own path -- so they hit app/static/[...path]/route.js
// directly without any rewriting.
//
// Old app/api/proxy/3dplan/[...path]/route.js is left in place (not
// deleted) in case anything else still references it.
const UPSTREAM = 'https://3dplan.rasayesh.com';

export async function GET(request, { params }) {
  const { path } = await params;
  const targetPath = (path ?? []).map(encodeURIComponent).join('/');
  const search = new URL(request.url).search;
  const targetUrl = `${UPSTREAM}/plan/${targetPath}${search}`;

  let upstreamRes;
  try {
    upstreamRes = await fetch(targetUrl, {
      headers: { 'user-agent': request.headers.get('user-agent') || '' },
      redirect: 'follow',
    });
  } catch (err) {
    console.error('[proxy plan/3dplan] upstream fetch failed:', err.message);
    return NextResponse.json({ error: 'Upstream fetch failed' }, { status: 502 });
  }

  const headers = new Headers();
  for (const [key, value] of upstreamRes.headers.entries()) {
    if (STRIPPED_PROXY_RESPONSE_HEADERS.has(key.toLowerCase())) continue;
    headers.set(key, value);
  }
  applyFramingHeaders(headers);

  return new NextResponse(upstreamRes.body, { status: upstreamRes.status, headers });
}
