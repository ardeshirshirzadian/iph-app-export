import { NextResponse } from 'next/server';
import { STRIPPED_PROXY_RESPONSE_HEADERS, applyFramingHeaders } from '@/lib/proxy3dplanHeaders';

// Mirrors the embedded https://3dplan.rasayesh.com asset tree at our own
// domain root. See app/api/proxy/3dplan/[...path]/route.js for the primary
// proxy (which serves the plan's top-level document and rewrites its HTML
// href/src attributes to route back through that proxy).
//
// This route exists because 3dplan's webpack bundle hardcodes its
// publicPath as "/" (`s.p="/"` in app.<hash>.bundle.js) -- its runtime chunk
// loader and CSS url() font references build asset URLs as root-relative,
// so the browser resolves them against the PARENT document's origin (this
// domain) no matter what path the parent HTML was itself served from. The
// HTML-rewriting proxy above can't reach these: they're computed at runtime
// in JS, not present as literal text in the proxied HTML. We don't control
// 3dplan's webpack config to fix the publicPath at the source, so mirroring
// its /static/* tree at our own root is the only fix available to us.
//
// Confirmed safe to claim this path (2026-08-25): iph-app has no
// public/static directory, no other app route under /static, and the nginx
// site in front of this app has no /static location block -- everything
// under /static falls through to Next.js, so this route is the only claimant.
//
// Verified via static analysis of the live 3dplan bundle (index.html + all
// JS + all CSS) that every root-relative asset reference it makes falls
// under /static/ -- static/scripts/*.bundle.js, static/styles/*.bundle.css,
// static/images/logo.svg, static/manifest.json, and
// static/assets/fonts/*.woff(2). No /fonts/, /assets/, /api/, or other
// top-level root-relative path was found, so this single prefix covers it.
const UPSTREAM = 'https://3dplan.rasayesh.com';

export async function GET(request, { params }) {
  const { path } = await params;
  const targetPath = (path ?? []).map(encodeURIComponent).join('/');
  const search = new URL(request.url).search;
  const targetUrl = `${UPSTREAM}/static/${targetPath}${search}`;

  let upstreamRes;
  try {
    upstreamRes = await fetch(targetUrl, {
      headers: { 'user-agent': request.headers.get('user-agent') || '' },
      redirect: 'follow',
    });
  } catch (err) {
    console.error('[proxy static/3dplan] upstream fetch failed:', err.message);
    return NextResponse.json({ error: 'Upstream fetch failed' }, { status: 502 });
  }

  const headers = new Headers();
  for (const [key, value] of upstreamRes.headers.entries()) {
    if (STRIPPED_PROXY_RESPONSE_HEADERS.has(key.toLowerCase())) continue;
    headers.set(key, value);
  }
  applyFramingHeaders(headers);

  // Assets only (JS/CSS/fonts/images) -- unlike the plan-document proxy,
  // there's no HTML here to rewrite; stream the body through unmodified.
  return new NextResponse(upstreamRes.body, { status: upstreamRes.status, headers });
}
