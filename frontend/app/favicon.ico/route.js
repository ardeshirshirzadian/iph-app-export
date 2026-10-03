import { NextResponse } from 'next/server';
import { resolveEventIdForHost } from '@/lib/domainEventMap';
import { getPwaIcons } from '@/lib/getPwaIcons';

// IranPharma -- proxy.js's matcher excludes favicon.ico (see its
// config.matcher comment), so x-resolved-event-id is never set for this
// request. Resolve the event straight from the Host header instead of
// getCurrentEventId(), mirroring proxy.js's own FALLBACK_EVENT_ID.
const FALLBACK_EVENT_ID = 1;

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const host = request.headers.get('host') || '';
  const eventId = (await resolveEventIdForHost(host)) ?? FALLBACK_EVENT_ID;
  const { favicon } = await getPwaIcons(eventId);

  // server.js runs Next with a hardcoded hostname:'0.0.0.0' (see its own
  // comment) -- request.url inside a Route Handler reflects THAT, not the
  // real incoming Host, so new URL(favicon, request.url) would redirect
  // browsers to the unreachable http://0.0.0.0:3000/... Build the origin
  // from the Host header itself instead (same header already used above).
  const response = NextResponse.redirect(new URL(favicon, `https://${host}`), 302);
  // Short-lived: a re-upload must take effect quickly, and the redirect
  // target itself is already cache-busted per-upload (see getPwaIcons.js) --
  // this cap is just for the /favicon.ico -> target mapping, not the image.
  response.headers.set('Cache-Control', 'public, max-age=60');
  return response;
}
