# Redis Migration — Phase 1 Proof of Concept

**Question:** Does Next.js 16.2.7's custom cache handler config actually intercept the existing `unstable_cache`-based caching Phase 3 built (~20+ tags), or does a full rewrite to the `'use cache'` directive come first?

**Definitive answer: YES — `unstable_cache` (completely unmodified, called exactly as Phase 3's code already calls it) routes through a custom cache handler, proven both by reading Next.js's own source code and by direct empirical testing against a real Redis instance.** But — important correction below — it's a *different* config key than the one Phase 5 flagged as uncertain.

No production files or running containers were touched. Everything below happened in a fully isolated scratch project + a throwaway Docker Redis container, both deleted after testing. `git status` on the real repo confirms zero trace, and Phase 4's uncommitted files were never touched.

---

## Step 1 — Research: source code + docs give a clean, unambiguous answer

**The correction to Phase 5's open question:** Phase 5 found `cacheHandlers` (**plural**) and correctly noted uncertainty about whether it covers `unstable_cache`. It doesn't — but that's because `cacheHandlers` (plural) is the *wrong* config for this. The relevant one is `cacheHandler` (**singular**), a completely different, older, still-actively-supported config key. This distinction is not fuzzy — it's spelled out explicitly in this version's own bundled docs:

> "The `cacheHandler` (singular) configuration is specifically used by Next.js for server cache operations such as storing and revalidating ISR, route handler responses, and optimized images. It is **not** used by `'use cache'` directives. For `'use cache'` directives, use `cacheHandlers` (plural) instead."
> — `node_modules/next/dist/docs/.../incrementalCacheHandlerPath.md`

Two independent confirmations beyond the doc text itself:

1. **Read `unstable_cache`'s actual implementation** (`node_modules/next/dist/server/web/spec-extension/unstable-cache.js`). It calls `incrementalCache.get(cacheKey, {...})` and `incrementalCache.set(cacheKey, {...}, {...})` — the classic "Incremental Cache" abstraction that predates and is separate from the new Cache Components / `'use cache'` system. This is exactly the abstraction the singular `cacheHandler` config customizes.
2. **Version history in the docs**: `cacheHandler` (singular, as `incrementalCacheHandlerPath`) has existed since v12.2, stabilized/renamed in v14.1, and even *gained new capability* in v16.2.0 (image-optimization caching) — i.e. it's not legacy or deprecated in this version, it's actively maintained and current.

The docs also include a **complete official reference implementation** (`get(key)`, `set(key, data, ctx)`, `revalidateTag(tags)`, `resetRequestCache()`) matching exactly what a Redis-backed handler needs to implement, plus a documented `cacheMaxMemorySize: 0` option to disable Next's own in-memory layer sitting in front of a custom handler — necessary for a rigorous test (and for production, to guarantee Redis is genuinely authoritative, not just a write-behind mirror of an in-memory cache).

## Step 2 — Empirical proof (isolated, fully cleaned up)

**Setup:** A scratch Next.js project (`redis-poc/`, separate `node_modules`, pinned to the exact same `next@16.2.7` + `react@19.2.4` this repo uses) with:
- `cache-handler-redis.js` — a custom handler implementing `get`/`set`/`revalidateTag`/`resetRequestCache`, backed by a throwaway `redis:7-alpine` Docker container (port 16379, not on `iph-net`, not connected to any real service).
- `next.config.js` — `{ cacheHandler: require.resolve('./cache-handler-redis.js'), cacheMaxMemorySize: 0 }`.
- One test route calling `unstable_cache(fn, ['poc-test-key'], { tags: ['poc-test-tag'], revalidate: 3600 })` — **the exact same call shape Phase 3 uses** (e.g. `lib/getActiveFont.js`), unmodified.
- One test route calling `revalidateTag('poc-test-tag', { expire: 0 })` — **the exact two-argument form Phase 3's real code already uses** (confirmed via `grep` against `app/api/internal/revalidate/route.js` and `app/api/admin/map-labels/route.js` before assuming it).

**Results, verified via `redis-cli` directly against the container (not just trusting the app's own responses), per the task's explicit ask:**

| Test | Result |
|---|---|
| First request | Fresh value generated (`realCallCount: 1`). `redis-cli KEYS` shows the entry landed in Redis, wrapped in exactly the internal `CachedRouteKind.FETCH` structure `unstable_cache`'s source code writes. |
| Repeated requests | Identical value returned every time (`realCallCount` stays 1); handler's own `GET → HIT` log fires on every request — proving no in-memory fallback is masking Redis (`cacheMaxMemorySize: 0` confirmed working). |
| **External modification test** (the task's step 4 — the real proof) | Manually overwrote the Redis value via `redis-cli SET` with a sentinel string, with **zero app-side write**. The app's very next request returned **exactly that sentinel value** — conclusive proof Redis is genuinely the live source of truth on every read, not a passive write-behind cache the app ignores after first load. |
| `revalidateTag()` | POST to the revalidate route → custom handler's `revalidateTag()` method fired, deleted the key → confirmed via `redis-cli KEYS` showing the key gone → next request regenerated a genuinely fresh value (`realCallCount: 2`, new random value) — the exact end-to-end cycle Phase 3's admin-save → `revalidateTag(tag, {expire:0})` → next-request-gets-fresh-data flow depends on. |

One harmless surprise along the way: my first `revalidateTag` implementation attempt had a bug (a redis-client `scanIterator` type mismatch) that threw an error — this was a bug in *my own throwaway test code*, not a finding about Next.js. Fixed by switching to `client.keys()`, retested, confirmed clean. Flagging it only for transparency, not because it affects the conclusion.

## Cleanup — verified zero trace

- Redis container stopped, removed, image deleted.
- All test server processes killed, port confirmed free.
- Entire scratch project directory deleted.
- `git status` on the real repo shows only Phase 4's pre-existing uncommitted files (untouched by this task) — no new files, no modified `next.config.mjs`, no reference to Redis anywhere in the tracked codebase. (Note: the real config file is now `next.config.mjs`, not `.js` — that's a pre-existing rename from outside this session, unrelated to this task; confirmed its content is unchanged and it was never touched here.)

---

## Decision point: the low-effort path applies

**A full migration to Redis is genuinely low-effort and low-risk — none of Phase 3's ~20+ `unstable_cache` call sites need to change.** The migration is additive config, not a rewrite:

1. Add a production-grade Redis-backed `cacheHandler` (the throwaway one above is a good starting skeleton, but needs: durable error handling, the `resetRequestCache()` no-op already stubbed, and — since this repo will eventually want multiple containers sharing state — the `refreshTags()`-style tag-coordination pattern isn't part of the singular `cacheHandler` interface the way it is for `cacheHandlers`/`'use cache'`; the singular interface's `revalidateTag()` is called directly against shared Redis on every `revalidateTag()` invocation, which is actually simpler and sufficient here since Redis itself is the shared, consistent store — there's no separate "sync tag state" step needed the way the newer `cacheHandlers` docs describe for its own tag architecture).
2. Set `cacheHandler: require.resolve('./cache-handler-redis.js')` and `cacheMaxMemorySize: 0` in the real `next.config.mjs`.
3. **Every existing `unstable_cache(...)` call across the app — quest, companies, map, badge, home-page-config, settings, all ~20+ of them — keeps working exactly as written.** No code changes to any of Phase 3's caching call sites.
4. `revalidateTag()` calls from `app/api/internal/revalidate/route.js` and friends keep working exactly as written too, now invalidating the shared Redis store instead of an in-process map — which is a strict improvement (works correctly across future multiple containers) not a behavior change for the current single-container deployment.

### Proposed next concrete step

1. **Production Redis setup**: add a `redis` service to `docker-compose.yml` on the existing `iph-net` network (not exposed publicly), sized modestly (this is cache data, not durable state — no persistence/AOF needed, default eviction policy is fine).
2. **Write the production cache handler**: harden the PoC skeleton — real error handling (Redis down should fail open to a fresh render, not crash the request, per the pattern already noted in the Phase 5 audit), sensible key namespacing, and a TTL/eviction strategy so Redis doesn't grow unbounded (the in-memory default has an implicit LRU ceiling; Redis needs an explicit one — e.g. `maxmemory` + `allkeys-lru` in the Redis container config, which sidesteps needing per-key TTL logic in the handler itself).
3. **Config change**: add `cacheHandler` + `cacheMaxMemorySize: 0` to `next.config.mjs`.
4. **Re-verify every one of Phase 3's existing `revalidateTag()` round-trips** end-to-end after the swap — not because the mechanism is expected to behave differently (it shouldn't, per this PoC), but because this is exactly the kind of "near-instant admin save reflection" behavior that must not regress silently, and it's cheap to re-check systematically given there are ~20+ tags: for each admin-editable setting Phase 3 wired up, save a change in iph-apn and confirm the corresponding page reflects it immediately, mirroring Phase 3's own incremental testing discipline.
5. Only after that's confirmed working on the single container today, revisit horizontal scaling (multiple containers) — which is the actual end goal this Redis work unlocks, and which still separately needs the Node clustering fix (deferred, per the load-test follow-up) to make good use of.

No code was written to any production file. Waiting for your review and go-ahead before starting any of the above.
