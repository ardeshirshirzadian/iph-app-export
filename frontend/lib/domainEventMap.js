// Hostname -> local events.id resolution for multi-domain routing (Phase 3).
//
// Mirrors proxy.js's getCurrentTokenVersion()/getAppPages() pattern exactly:
// Redis-backed with a short TTL, shared across all container replicas (this
// app runs 3 -- 3002/3010/3011 behind Nginx), fail-open to a direct DB query
// on a cache miss or Redis outage. A plain in-process Map would NOT be safe
// here despite this data changing rarely -- with 3 replicas, each would
// independently drift and an admin's event-domain edit would only reach
// whichever single replica's process happened to handle the invalidation
// request, leaving the other two serving the stale mapping indefinitely.
// Redis is what makes the explicit invalidation hook (invalidateDomainEventMap,
// called from /api/internal/revalidate) actually reach every replica.
//
// Own isolated Redis client + pg pool, same rationale as proxy.js's isolated
// pool/client: this runs on every single request (via proxy.js), so it must
// never contend with or block on lib/db.js's or lib/cache-handler-redis.js's
// connections.

import { Pool } from 'pg';
import { createClient } from 'redis';

const KEY = 'iph-app:domain-event-map';
const TTL_SEC = 5 * 60; // mirrors getRasayeshEventInfo's 5-min in-memory TTL pattern

let _pool;
function getPool() {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      idleTimeoutMillis: 60000,
      connectionTimeoutMillis: 2000,
    });
  }
  return _pool;
}

const REDIS_URL = process.env.REDIS_URL;
let _client = null;
function getClient() {
  if (!REDIS_URL) return null;
  if (_client) return _client;
  _client = createClient({
    url: REDIS_URL,
    socket: {
      connectTimeout: 2000,
      reconnectStrategy: (retries) => Math.min(retries * 500, 5000),
    },
  });
  _client.on('error', (err) => {
    console.error('[domainEventMap] Redis connection error:', err.message);
  });
  _client.connect().catch((err) => {
    console.error('[domainEventMap] Redis initial connect failed (fail-open, querying DB directly):', err.message);
  });
  return _client;
}

function ready() {
  const c = getClient();
  return c && c.isReady ? c : null;
}

async function fetchMapFromDb() {
  const { rows } = await getPool().query(
    "SELECT id, domain FROM events WHERE status = 'active' AND domain IS NOT NULL"
  );
  const map = {};
  for (const row of rows) {
    map[row.domain.toLowerCase()] = row.id;
  }
  return map;
}

// Only used when Redis itself is unreachable (not just a cache miss) -- caps
// how often an outage forces a DB round trip on the request path.
let _localFallback = { map: null, expiresAt: 0 };

// Returns the matched event id, or null if no active event claims this host
// (caller decides the default-event fallback -- this function never guesses).
export async function resolveEventIdForHost(host) {
  const cleanHost = (host || '').split(':')[0].toLowerCase();

  const c = ready();
  if (c) {
    try {
      const cached = await c.get(KEY);
      if (cached !== null) {
        const map = JSON.parse(cached);
        return map[cleanHost] ?? null;
      }
      // Redis reachable but cold (no map cached yet, or just invalidated) --
      // fall through to the DB fetch below, which also (re)populates it.
    } catch (err) {
      console.error('[domainEventMap] Redis get failed, falling back to DB:', err.message);
    }
  } else if (_localFallback.map && _localFallback.expiresAt > Date.now()) {
    // Only trust the in-process fallback when Redis itself is unreachable.
    // Checking it BEFORE the `ready()` branch above would mean a container
    // that boots before Redis finishes connecting gets stuck serving the
    // local fallback for its full TTL even after Redis becomes ready,
    // since it would never look at Redis again until the TTL expired --
    // confirmed happening in practice: three containers cold-started here
    // never wrote to Redis in the following 5 minutes despite Redis being
    // reachable within seconds of boot.
    return _localFallback.map[cleanHost] ?? null;
  }

  try {
    const map = await fetchMapFromDb();
    _localFallback = { map, expiresAt: Date.now() + TTL_SEC * 1000 };
    if (c) {
      c.setEx(KEY, TTL_SEC, JSON.stringify(map)).catch((err) => {
        console.error('[domainEventMap] Redis setEx failed:', err.message);
      });
    }
    return map[cleanHost] ?? null;
  } catch (err) {
    console.error('[domainEventMap] DB fetch failed:', err.message);
    return null;
  }
}

// Reverse of resolveEventIdForHost: given a local events.id, returns its
// domain. Not on the hot per-request proxy path (unlike the function above),
// so a direct query is fine -- no Redis caching needed for this one. Falls
// back to app.iphexpo.com (event 1's own domain) if the event has no domain
// set, matching FALLBACK_EVENT_ID's same "IranPharma is the default" logic
// used elsewhere (proxy.js, lib/currentEvent.js).
const FALLBACK_DOMAIN = 'app.iphexpo.com';

export async function getEventDomain(eventId) {
  try {
    const { rows } = await getPool().query('SELECT domain FROM events WHERE id = $1', [eventId]);
    return rows[0]?.domain || FALLBACK_DOMAIN;
  } catch (err) {
    console.error('[domainEventMap] getEventDomain failed:', err.message);
    return FALLBACK_DOMAIN;
  }
}

// Called by /api/internal/revalidate on the 'domain-event-map' tag, itself
// triggered by iph-apn's /api/admin/events create/update routes, so an admin
// pointing a domain at an event takes effect within the same request cycle
// instead of waiting out the 5-min TTL.
export async function invalidateDomainEventMap() {
  _localFallback = { map: null, expiresAt: 0 };
  const c = ready();
  if (!c) return;
  try {
    await c.del(KEY);
  } catch (err) {
    console.error('[domainEventMap] Redis del failed:', err.message);
  }
}
