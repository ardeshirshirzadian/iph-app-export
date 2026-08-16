// Production Next.js cacheHandler (singular — the ISR/unstable_cache storage
// interface, NOT the 'use cache'-only `cacheHandlers` config; see
// REDIS_MIGRATION_PHASE1_POC.md for why these are two different things).
//
// Backs Phase 3's ~46 unstable_cache-based tags with Redis instead of the
// default per-process in-memory store, so cache state (and revalidateTag
// invalidations) are shared across future multiple containers/replicas.
//
// FAIL-OPEN BY DESIGN, and NEVER BLOCKS ON A CONNECTION ATTEMPT: every
// get/set/revalidateTag call checks the client's current `isReady` state
// synchronously and returns immediately (cache miss / no-op) if it isn't
// connected — it never awaits an in-flight connect/reconnect. This matters
// concretely, not just in theory: an earlier version of this file awaited
// the connection promise on every call, which caused `next build`'s static
// generation to stall for minutes when Redis was unreachable (e.g. from
// outside the `iph-cache-net` Docker network, exactly the situation during
// `docker build`) — each of the ~46 unstable_cache call sites individually
// waited out a connection attempt before failing open. Reconnection now
// happens entirely in the background via `reconnectStrategy` below.
//
// Connection string comes from REDIS_URL, matching this project's existing
// DATABASE_URL convention (lib/db.js, proxy.js) — never hardcoded here.

const { createClient } = require('redis');

const KEY_PREFIX = 'iph-app:cache:';
const REDIS_URL = process.env.REDIS_URL;

let client = null;

function getClient() {
  if (!REDIS_URL) {
    if (!getClient._warnedNoUrl) {
      console.error('[cache-handler-redis] REDIS_URL is not configured — running uncached (fail-open)');
      getClient._warnedNoUrl = true;
    }
    return null;
  }
  if (client) return client;

  client = createClient({
    url: REDIS_URL,
    socket: {
      connectTimeout: 2000,
      // Capped exponential backoff, retried indefinitely in the background —
      // bounded so a single attempt never hangs long, unbounded in count so
      // the app reconnects on its own whenever Redis comes back (Step 5).
      reconnectStrategy: (retries) => Math.min(retries * 500, 5000),
    },
  });

  client.on('error', (err) => {
    console.error('[cache-handler-redis] Redis connection error:', err.message);
  });
  client.on('connect', () => {
    console.log('[cache-handler-redis] Redis connecting...');
  });
  client.on('ready', () => {
    console.log('[cache-handler-redis] Redis connected and ready');
  });
  client.on('reconnecting', () => {
    console.warn('[cache-handler-redis] Redis reconnecting...');
  });
  client.on('end', () => {
    console.warn('[cache-handler-redis] Redis connection closed');
  });

  // Fire-and-forget: never awaited by get/set/revalidateTag below. If this
  // fails, node-redis's own reconnectStrategy keeps retrying in the
  // background; isReady simply stays false until it succeeds.
  client.connect().catch((err) => {
    console.error('[cache-handler-redis] Redis initial connect failed (fail-open, running uncached):', err.message);
  });

  return client;
}

// Synchronous, instant — never awaits a connection. This is the only check
// every get/set/revalidateTag call makes before touching Redis.
function ready() {
  const c = getClient();
  return c && c.isReady ? c : null;
}

module.exports = class RedisCacheHandler {
  constructor(options) {
    this.options = options;
  }

  async get(key) {
    const c = ready();
    if (!c) return null; // fail open: treat as cache miss
    try {
      const raw = await c.get(KEY_PREFIX + key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      console.error('[cache-handler-redis] get() failed, treating as cache miss:', err.message);
      return null;
    }
  }

  async set(key, data, ctx) {
    const c = ready();
    if (!c) return; // fail open: silently skip caching this entry
    try {
      await c.set(
        KEY_PREFIX + key,
        JSON.stringify({
          value: data,
          lastModified: Date.now(),
          tags: (ctx && ctx.tags) || [],
        })
      );
    } catch (err) {
      console.error('[cache-handler-redis] set() failed, entry will regenerate next request:', err.message);
    }
  }

  async revalidateTag(tags) {
    const c = ready();
    if (!c) return; // fail open: nothing to invalidate if we can't reach Redis
    tags = [tags].flat();
    try {
      const keys = await c.keys(KEY_PREFIX + '*');
      for (const key of keys) {
        const raw = await c.get(key);
        if (!raw) continue;
        let entry;
        try {
          entry = JSON.parse(raw);
        } catch {
          continue;
        }
        const entryTags = entry.tags || [];
        // Explicit-tag match (the normal case: this entry IS the data that
        // was tagged, e.g. an unstable_cache FETCH-kind entry).
        const explicitMatch = entryTags.some((t) => tags.includes(t));
        // Outer page-level (APP_PAGE-kind) render-cache entries always
        // arrive at set() with an EMPTY tags array — Next.js never tags
        // them with the explicit tags used by unstable_cache calls made
        // *during* that render, confirmed by direct inspection (see
        // REDIS_MIGRATION_PHASE2_REPORT.md). The documented singular
        // cacheHandler interface has no soft-tag/getExpiration mechanism
        // to otherwise catch this (that's exclusive to the separate
        // `cacheHandlers`/'use cache' config). So: treat ANY explicit-tag
        // revalidation as reason to also drop every empty-tag entry —
        // broader than strictly necessary (a save to one tag drops every
        // static page's shell, not just the affected one), but simple,
        // safe, and closes the gap without depending on Next's internal,
        // undocumented-for-this-interface tag propagation.
        const isUntaggedPageShell = entryTags.length === 0;
        if (explicitMatch || isUntaggedPageShell) {
          await c.del(key);
        }
      }
    } catch (err) {
      console.error('[cache-handler-redis] revalidateTag() failed:', err.message);
    }
  }

  // No-op is correct here, not just a stub: this handler keeps no request-
  // scoped in-process state of its own (every get/set round-trips straight
  // to Redis), so there is nothing local to reset between requests.
  resetRequestCache() {}
};
