import 'server-only';
import { headers } from 'next/headers';

// IranPharma -- matches proxy.js's own FALLBACK_EVENT_ID. Used when the
// x-resolved-event-id header is missing: during `next build`'s static
// generation (no real request/hostname exists yet) or if this ever runs
// outside proxy.js's reach.
const FALLBACK_EVENT_ID = 1;

// Reads the event id proxy.js already resolved from the request's hostname
// (see resolveEventIdForHost in lib/domainEventMap.js) and attached as a
// request header. Call sites are unchanged from the Tier 3 hardcoded-1 era —
// still `await getCurrentEventId()`, no arguments — only this function's
// internals changed from a constant to something request-scoped.
//
// IMPORTANT for callers: this reads next/headers, an uncached request-time
// API. Per unstable_cache's own documented restriction, it must be called
// OUTSIDE any unstable_cache-wrapped function and the resulting eventId
// passed in as an argument -- calling it from inside a cached function is
// unsupported and would silently return the wrong (or a stale-across-events)
// cached value. See lib/getCompaniesConfig.js for the reference pattern.
export async function getCurrentEventId() {
  try {
    const headersList = await headers();
    const raw = headersList.get('x-resolved-event-id');
    const id = Number(raw);
    if (Number.isInteger(id) && id > 0) return id;
  } catch {
    // headers() throws outside a request scope (e.g. next build's static
    // generation) — fall through to the default below rather than throw.
  }
  return FALLBACK_EVENT_ID;
}
