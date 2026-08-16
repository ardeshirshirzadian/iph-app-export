# Redis Migration — Phase 2 Report

**Status: NOT complete. A real regression was found, root-caused, and the live deployment was safely rolled back to the default in-memory handler. Production is currently healthy and running the ORIGINAL (pre-migration) caching behavior — no functional change is live right now.**

This is exactly the "stop and report a specific blocker" outcome the task asked for, not a partial success dressed up as done. Steps 1–4 (service, handler, config, deploy, and 46/46 tags verified via the internal revalidate endpoint) all genuinely passed. Step 4's *broader* end-to-end sampling then surfaced a real gap that the narrower test couldn't see. Steps 5/6 were not run against the Redis-backed build, since it's not the thing currently deployed.

---

## What was built (Steps 1–3)

- **`iph-redis`** (`redis:7-alpine`), standalone `docker run` (confirmed actual convention — no compose in use, `docker inspect` shows zero compose labels on `iph-app`, `docker compose` isn't even installed). Runs on a new dedicated network (`iph-cache-net`) rather than the existing default `bridge` Postgres sits on, since Postgres is bound to `0.0.0.0` (genuinely internet-exposed) and Redis has no auth by default — didn't want to replicate that. No published port at all (more isolated than Postgres, not less). `maxmemory 256mb`, `allkeys-lru`, persistence off (`--save ""`, `--appendonly no`) — all confirmed via `redis-cli CONFIG GET`.
- **`frontend/lib/cache-handler-redis.js`** — fail-open `get`/`set`/`revalidateTag`/`resetRequestCache`, `iph-app:cache:` key prefix, `REDIS_URL` via `.env.local` (matching the `DATABASE_URL` convention). One real bug caught and fixed before deploy: the first version `await`ed the Redis connection on every call, which **stalled `next build` for minutes** when Redis was unreachable (confirmed via `ps` — genuinely hung, not just slow) — exactly the situation during `docker build`, which isn't on `iph-cache-net`. Fixed to check `client.isReady` synchronously and never block a request on a pending connection; reconnection now happens purely in the background. Retested: build completed in ~25s, same route table as always.
- **`next.config.mjs`**: `cacheHandler` (singular — confirmed via source + docs this is the correct key for `unstable_cache`/ISR, not the plural `cacheHandlers`) + `cacheMaxMemorySize: 0`.

Phase 4's uncommitted files were kept isolated via `git stash push -u` on exactly those paths for every build/deploy cycle in this task, then restored afterward — confirmed via `git status` at the end: only this task's own files remain, Phase 4 untouched throughout.

## Step 4 — verification results

### All 46 tags, via `/api/internal/revalidate` + direct `redis-cli` inspection

Built the complete tag list fresh by grepping both repos (46 distinct tags, not "~20+" — noting this since the task's illustrative list undercounted). For each: populated the real cache entry by hitting its actual route, revalidated the tag, and confirmed via `redis-cli EXISTS` (not the app's own response) that the entry was evicted.

**Result: 46/46 passed this specific test** — every tag's `revalidateTag()` call correctly reached the Redis-backed handler and evicted the right entry, latencies 18–130ms. (38 tags verified with genuine before→after eviction of real cached data; 8 — the `home-active-*`/`home-default-*`/`home-welcome-toast`/`home-push-prompt` group plus `panels-page-title`/`gallery-page-title`/`news-page-title` — currently have nothing to cache given the live site's current configuration (home variant is "quest" not "services"; those three nav sections currently 404, likely intentionally disabled — unrelated to Redis), so only the revalidation call itself was verified for those, not a real evict.)

Full per-tag table (`connections`/`latencyMs` columns) available in the verification script output if useful — omitted here since the *pattern* (46/46 pass, this specific test) is the material fact, and it turned out **not to be the whole story**.

### Real end-to-end admin-UI samples (3, across different categories)

Logged into iph-apn with real credentials, exercised real admin PUT endpoints (not the internal bridge directly), confirmed propagation, restored original values:

| Setting | Admin endpoint | Result |
|---|---|---|
| `layout-theme-colors` (dark `text-dim`) | `PUT /api/admin/theme-colors` | **PASS** — reflected in `/api/theme.css` within ~1s |
| `map-hall-colors` | `PUT /api/admin/map/hall-colors` | **PASS** — reflected in `GET /api/map` within ~1s |
| `quest-appearance-config` (`show_level_circle`) | `PUT /api/admin/quest-appearance` | **FAIL** — this is the regression, see below |

All three test values were restored to their originals immediately after testing, confirmed via direct DB query.

## The regression, root-caused

`quest-appearance-config` only feeds `/quest`'s own server-rendered HTML directly (no separate dynamic API exposes it, unlike the two tags above which happened to also be readable through dynamic routes — `/api/theme.css` and `GET /api/map` — which is *why* those two passed despite the same underlying gap). After a real admin save, `/quest`'s rendered page kept showing the **old** value indefinitely, even though:
- The DB was confirmed updated.
- `revalidateTag('quest-appearance-config')` was confirmed called and confirmed to evict the *inner* `unstable_cache` entry (proven above, and independently visible in Redis).

**Root cause, confirmed by direct A/B comparison against the unmodified default in-memory handler** (built and ran a second instance on a scratch port, same DB, same exact test): the default handler correctly reflects the change within ~1s; my Redis handler does not. Inspecting the actual Redis entry for the `/quest` page-level cache (`kind: "APP_PAGE"`) directly:

```
tags: []
```

Next.js passes an **empty tags array** to the handler's `set()` for the page's own outer render cache — it is never tagged with `quest-appearance-config` (the tag Next associates with the *inner* fetch, not the outer page). The documented singular `cacheHandler` interface (`get`, `set`, `revalidateTag`, `resetRequestCache`) has no soft-tag/`getExpiration` mechanism — that machinery is explicitly documented as belonging to the *other* (plural, `use cache`-only) config. So a custom handler following the documented interface literally, as mine does, has no tag to match the outer page entry against, and `revalidateTag()` correctly (by its own logic) leaves it alone. The **default** in-memory handler evidently does something additional/internal here beyond the four documented public methods — undocumented as far as I could find in this version's bundled docs.

**Practical scope:** roughly half of the 46 tags are affected — specifically, any tag whose *only* consumer is a static (`○`) page's own embedded SSR output, with no separate dynamic-route exposure. By my mapping: the 5 `layout-*` tags, `home-page-config`, the 5 `home-*`-variant tags, `settings-page-title`, `settings-theme-mode`, `quest-content-blocks`, `quest-appearance-config`, `quest-page-title`, and the 6 page-title tags (`companies-page-title`, `panels-page-title`, `map-page-title`, `chat-page-title`, `gallery-page-title`, `news-page-title`) plus `badge-page-config` — 23 tags. The other 23 (all `map-*` sub-tags, `badge-card-template`, the 4 `quest-*-definitions` tags, `nav-items`, `companies-config`, `companies-rasayesh-data`) are backed by genuinely dynamic (`ƒ`) API routes that always re-execute per request, so they're unaffected by this and are proven working correctly.

## Response to this — rolled back, not shipped broken

Given the task's explicit instruction ("do not mark the migration complete with a known-broken tag"), I:
1. Restored the test DB value.
2. Reverted `next.config.mjs`'s `cacheHandler` (currently commented out, not deleted).
3. Rebuilt and redeployed the live `iph-app` container on the **default in-memory handler** — confirmed via a repeat of the exact failing test that it now works correctly again (flips immediately both directions).
4. Left `iph-redis` and `iph-cache-net` running (harmless, inert, no cost to keep — avoids redoing Step 1 once a fix is found) but **nothing in the live app currently talks to them**.

Production right now is functionally identical to before this task started. No code changes are live.

## Recommended next step

The cleanest fix I can see without further research into this version's undocumented internals: since page-level (`APP_PAGE`-kind) entries are the *only* ones that ever arrive at `set()` with an empty `tags` array (every real `unstable_cache` call always has its explicit tag), the handler's `revalidateTag()` could additionally evict **all** empty-tag entries whenever *any* explicit tag is revalidated — treating any admin save as reason to also distrust every cached page shell, not just the specific inner data. This is broader than strictly necessary (a save to any one of the 46 tags would drop every static page's shell, not just the affected one) but is simple, safe, and directly closes the gap without needing to reverse-engineer Next's internal soft-tag propagation. I'd want to implement and re-run the exact same `quest-appearance-config` A/B test before trusting it, given how this version's documented interface turned out to not fully match default behavior once already.

I did not implement this without checking with you first, per the "stop and report" instruction — happy to build and verify it next if that approach sounds right, or discuss alternatives.

## No commits suggested

There's nothing ready to commit — the deployed code is the pre-migration default. `git status` shows only this task's own files (`next.config.mjs` with the change commented out, `package.json`/`lock` with the now-unused `redis` dependency, the unused `cache-handler-redis.js`), plus the two report docs. Suggest holding off on any commit until the fix above is tried and verified.
