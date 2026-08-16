# Redis Migration — fix verification (post Phase 2 regression)

**Status: fix implemented and fully verified against an isolated test environment. Live container NOT yet touched — waiting for confirmation before deploying, per instruction.**

## The fix

`revalidateTag()` in `frontend/lib/cache-handler-redis.js` now also evicts every entry with an **empty** `tags` array whenever any explicit tag is revalidated — not just entries matching that explicit tag. Page-level (`APP_PAGE`-kind) render-cache entries always arrive at `set()` with `tags: []` (confirmed by direct inspection in the prior report), so this is the only way to close the gap without relying on Next's undocumented-for-this-interface internal tag propagation. Broader than strictly necessary (any one admin save now drops every static page's shell, not just the affected one), but simple and safe.

## Test setup (fully isolated, live container never touched)

- Throwaway `redis-fix-test` container (`127.0.0.1:16380`, not `iph-redis`), so nothing here could affect or be affected by the real deployment target.
- Phase 4's files re-isolated via the same `git stash push -u` pattern as every prior build in this migration.
- Built and ran a scratch instance on port **17003** (not 3002) with `REDIS_URL` pointed at the throwaway Redis. Confirmed connected (`docker logs`-equivalent showed clean "Redis connected and ready").

## Result 1 — the specific regression is fixed

Repeated the exact failing scenario from before: flip `quest_appearance_config.show_level_circle` in the DB, call `revalidateTag`, check `/quest`'s rendered HTML.

- **true → false → true**, both directions, both now reflected correctly (previously stuck showing the old value indefinitely).
- Restored to its original value (`false`) afterward, confirmed via DB query.

## Result 2 — full 46-tag re-verification (not just the previously-failing category)

Same methodology as before (populate real route → snapshot Redis → revalidate → confirm eviction via direct `redis-cli`, not the app's own response) plus two new checks specifically for this broader-eviction change:

- **46/46 tags pass** the direct explicit-tag eviction test — genuinely all 46 this time (41 tags now show real `keysBefore=1→0`, vs. several false-0s in the pre-fix run caused by the very staleness we just fixed; the remaining 5 `home-*`-variant tags are still only mechanism-verified since the live site's home variant is "quest" not "services" — unrelated to this fix, unchanged from before).
- **Phase D** — confirmed the broader sweep actually happened: 7 untagged page-level entries were present before Phase C, **0 remained after** (the very first tag revalidation in the loop swept all of them, as designed).
- **Phase E** — re-hit every route after the full sweep: **0 regeneration failures**. Every static page correctly rebuilt its cache from scratch with no errors. This is the check that would have caught a "broader eviction breaks something else" regression, and it didn't.

(One unrelated hiccup along the way: the verification script itself hit a transient socket-reuse error from making many rapid `docker exec` calls before its first `fetch` — a test-harness issue, not the app; added a retry and moved on.)

## Result 3 — Step 5 (failure mode), re-run against the fixed handler

- Stopped `redis-fix-test` mid-run: app kept serving normally (`GET /`, `GET /quest`, `POST /api/internal/revalidate` — all 200, all fast, since `isReady` flips to false instantly and every call fails open without waiting). Logs showed clean, bounded reconnect-attempt logging, not a crash.
- Restarted it: logs showed a clean automatic reconnect ("Redis connecting... Redis connected and ready"), and the very next request correctly resumed writing to Redis (`DBSIZE` confirmed growing again).

## Result 4 — Step 6 (regressions)

- Route table from the fix-test build: all 12 previously-static (`○`) pages — `/`, `/badge`, `/chat`, `/companies`, `/gallery`, `/map`, `/news`, `/panels`, `/quest`, `/quest/scan`, `/settings`, `/signup` — are still `○`. Unchanged.
- `/api/quest/stats` (untouched quest XP/progress path) still responds correctly.

## Current state

Live `iph-app` container is **unchanged** — still running the safe default in-memory handler from the prior rollback, confirmed via a fresh check just now. All test/scratch resources from this fix-verification round (throwaway Redis, scratch server) are torn down. `iph-redis` (the real one) and `iph-cache-net` are still up from before, ready for the actual deploy. `git status` shows exactly this task's files: the fix in `cache-handler-redis.js`, `next.config.mjs` (currently re-enabled, ready to deploy), `package.json`/`lock`, and the three report docs — Phase 4 remains untouched in the stash.

**Waiting for your go-ahead to deploy this to the live container**, same as before.
