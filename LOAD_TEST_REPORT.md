# Load Test Report — `iph-app` single-container capacity

**Date:** 2026-08-16, ~09:15–09:40 local time. **Target:** `http://localhost:3002` (the live `iph-app` Docker container, tested directly on its host VPS, isolating container capacity from CDN/network effects per the task's scope). **Tool:** `autocannon` v8 (installed locally in scratch dir; no `k6`/`wrk`/`ab` available or in apt, npm registry was reachable so autocannon was the fastest reliable path with good percentile reporting).

## Direct answer

**No — not as currently configured, for the worst-case burst scenario; likely yes for steady-state browsing.** More precisely:

- Under sustained, hammering load (connections firing back-to-back with no think-time — the standard load-test model, and a reasonable proxy for a *synchronized burst*, e.g. everyone scanning at once right after a keynote ends), this container's **practical ceiling is roughly 150–300 concurrent in-flight requests**, translating to a **hard sustained-throughput ceiling of ~300–400 requests/sec** regardless of traffic mix (cached ISR pages or live DB routes) — well short of anything that would map to "1000 concurrent users" hammering simultaneously.
- The bottleneck is **not primarily the database** — it's **single-threaded Node.js CPU** (this container only ever used ~1 of the host's 6 CPU cores, confirmed directly via `docker stats` at every concurrency level tested, including the lowest). The Postgres connection pool (`lib/db.js`, `max: 10`) **also** saturates under the realistic mixed-traffic scenario (sustained at its ceiling for the entire test), compounding the CPU limit rather than being independent of it.
- **1000 real concurrent *users*** (people with the app open, browsing/polling at human cadence, not 1000 synthetic connections hammering as fast as possible) is a much lower actual request rate — plausibly within the ~300–400 rps ceiling for steady-state traffic — **except during synchronized bursts**, which the 300-connection mixed test shows this container handles poorly (multi-second tail latencies).
- **The fix that matters most is not Redis + multi-container** — it's much cheaper: enabling Node.js cluster mode in this same container (using the 5 idle CPU cores already sitting there) plus raising the DB pool size. See recommendation below.

## Test setup

- Forged an `iph_user` session cookie (per this repo's documented local-testing pattern: proxy.js only checks the cookie is valid JSON with `tokenVersion >= app_settings.auth_token_version`, currently `2`) — verified against every route tested before load-testing began. All synthetic users tagged `loadtest-*` for safe, unambiguous cleanup.
- **Safety check before running:** confirmed via `psql` (0 rows ever in `quest_scans`, only 9 `app_users` last active 2026-08-15) and the Nginx access log (traffic dominated by bot/scanner noise, not real attendee usage) that this is a pre-event quiet period, not a live exhibition in progress. Flagged this to the user and got explicit go-ahead before running the 500/1000-connection levels.
- Resource sampling: `docker stats iph-app --no-stream` + `SELECT count(*) FROM pg_stat_activity` sampled every 3s throughout, in the background, for every scenario (one gap — noted below).
- **Container has no CPU/memory limits configured** (`NanoCpus: 0`, `Memory: 0` — unrestricted). **Host: 6 CPU cores, 15GB RAM** (3GB used at baseline), shared with several other running services on this VPS (`iph-apn` admin panel, `symphony-app`, 3 separate Postgres containers, `ollama`) — a real confounding factor for any CPU-bound finding, noted throughout.
- **`lib/db.js`'s pool: `max: 10`.** `proxy.js`'s own separate pool: `max: 2`. **Postgres `max_connections: 100`** — confirmed the app's own pool is the far more restrictive ceiling, not Postgres itself.
- **Caveat that applies to every result below:** the reachable database is near-empty (`quest_scans` had 0 rows before/after this test, `companies` has 327 rows). This test cannot demonstrate the missing-index problem Phase 5 flagged (`quest_scans.user_uuid`) — a sequential scan over 0–300 rows is instant regardless of indexing. Everything below is a **CPU/connection-pool finding, independent of the indexing question**, which will make things *worse*, not better, once real event-scale scan data accumulates.

---

## Scenario 1 — ISR page baseline (`/`, escalating concurrency)

| Connections | Duration | Req/sec (avg) | p50 | p97.5 | p99 | Errors (timeouts) |
|---|---|---|---|---|---|---|
| 50 | 45s | 360 | 125ms | 216ms | 259ms | 0 |
| 200 | 45s | 382 | 382ms | 459ms | **2220ms** | 192 (1.1%) |
| 500 | 45s | 386 | **1270ms** | 3354ms | 3931ms | 1 |
| 1000 | 45s | 405 | **2200ms** | 4828ms | 5074ms | 328 (1.8%) |

**Practical ceiling: between 50 and 200 connections** — p99 already exceeds 2s and the error rate exceeds 1% at 200.

**The critical finding:** req/sec **stays flat at ~360–405 across every concurrency level, including the lowest (50)**. This is not a scaling curve — it's a *saturated fixed-throughput ceiling*. Adding more connections doesn't add more completed work, it only adds queueing (hence latency climbing linearly with connections while throughput stays flat). `docker stats`, sampled throughout, confirms why: **CPU sat at 105–145% for the entire test, at every concurrency level, including 50** (100% ≈ one full core in Docker's accounting). Memory stayed low and healthy (67MB→423MB). Postgres connections stayed at 2–8 (this route is cached, only light touches). **This is single-threaded Node.js CPU saturation, not a database problem, and it was already maxed out at the lowest concurrency tested.**

---

## Scenario 3 — Leaderboard/stats (deliberately uncached live DB routes)

| Path | Connections | Req/sec (avg) | p50 | p97.5 | p99 | Errors |
|---|---|---|---|---|---|---|
| `/api/quest/stats` | 20 | 263 | 72ms | 108ms | 123ms | 0 |
| `/api/quest/stats` | 50 | 283 | 173ms | 205ms | 219ms | 0 |
| `/api/quest/stats` | 100 | 276 | 354ms | 419ms | 446ms | 0 |
| `/api/quest/stats` | 200 | 273 | 718ms | 798ms | **1024ms** | 0 |
| `/api/quest/leaderboard` | 20 | 285 | 69ms | 84ms | 98ms | 0 |
| `/api/quest/leaderboard` | 50 | 271 | 180ms | 231ms | 245ms | 0 |
| `/api/quest/leaderboard` | 100 | 276 | 356ms | 413ms | 423ms | 0 |
| `/api/quest/leaderboard` | 200 | 259 | 753ms | 874ms | **1033ms** | 0 |

**Practical ceiling: ~150–200 connections** — p99 crosses 1s right around 200 for both endpoints, though **zero errors even at 200** (unlike the `/` test — smaller JSON payloads vs. full page HTML likely explains why these don't hit timeouts as readily).

Same exact signature as Scenario 1: throughput flat at ~260–290 rps across all four concurrency levels for *both* endpoints, latency climbing linearly with connections. **This strongly suggests the same CPU-bound root cause** — but I don't have independent `docker stats` confirmation for this specific run (the background sampler process died partway through Scenario 3, alongside an unrelated shell issue — caught and fixed before Scenario 2, see below). Treating the CPU explanation as *highly likely but not independently re-confirmed for this scenario specifically*, based on the identical throughput-ceiling pattern.

---

## Scenario 2 — Mixed realistic traffic + scan write-path

### Mixed browsing (300 connections, 60s): `/`, `/quest`, `/companies`, `/map`, `/api/quest/stats`, `/api/quest/leaderboard`

*(Note: swapped `/api/quest/progress` for `/api/quest/leaderboard` in the mix — `progress` turned out to be a POST-only mutation endpoint requiring a real `mission_id`, not a comparable read endpoint to the rest of the traffic mix.)*

| Req/sec (avg) | p50 | p97.5 | p99 | Errors |
|---|---|---|---|---|
| 319 | 55ms | **5602ms** | **5945ms** | 90 (0.47%) |

Median latency looks fine (55ms) but the tail is severe — p97.5/p99 in the multi-second range. Error rate is technically under the 1% threshold, but the tail latency alone means a meaningful fraction of real users would see multi-second waits. **This is the realistic "everything happening at once" scenario, and it already shows real distress at 300 connections** — well short of 1000.

**Resource data during this run (sampled throughout, confirmed present for the full ~80s window):** CPU pegged at **108–145%** the entire time (same signature as Scenario 1) — **and Postgres connections held at exactly 13 for the entire run**, i.e. **the combined app pool (10) + proxy pool (2) + this test's own monitoring query (1) was maxed out and stayed maxed for the whole test.** This is the clearest evidence in this report: under realistic mixed traffic, **both the CPU ceiling and the DB connection pool ceiling are saturated at the same time.**

### Scan write-path (`/api/quest/scan`) — isolated, at increasing rates

| Target rate | Achieved rate | p50 | p97.5 | p99 | Errors |
|---|---|---|---|---|---|
| 10/sec | 10/sec | 43ms | 148ms | 179ms | 0 |
| 30/sec | 30/sec | 64ms | 164ms | 175ms | 0 |
| 80/sec | 80/sec | 68ms | 156ms | 168ms | 0 |

**The scan write-path itself is not a bottleneck at any realistic rate** — even pushed to 80/sec (well beyond the task's suggested 10–50/sec realistic range, and beyond plausible physical QR-scanning throughput for one event), it stayed completely healthy with zero errors. This makes sense given the empty-DB caveat above: the duplicate-check `SELECT` + `INSERT` is cheap when the table has near-zero rows.

### Scan write-path — concurrent with the 300-connection mixed load (realistic worst case)

| Target rate | Achieved rate | p50 | p97.5 | p99 | Errors |
|---|---|---|---|---|---|
| 30/sec | **2.6/sec** | 3534ms | 9106ms | 9492ms | 27/130 (21%) |

When run *at the same time* as the 300-connection mixed browsing load, the scan endpoint is nearly starved (achieved only ~9% of its target rate, with multi-second latency and a 21% error rate). **This is not a defect in the scan endpoint itself** (proven healthy in isolation up to 80/sec) — **it's competing with the mixed browsing load for the same single saturated CPU thread and the same maxed-out DB pool.** This is the clearest real-world illustration of the compound bottleneck: during a hypothetical simultaneous browsing+scanning burst, scan submissions (the highest-stakes, most latency-sensitive user action — someone standing at a booth waiting for their scan to register) would be among the worst-affected requests.

### Cleanup

2,020 synthetic rows were created across all scan tests (`quest_scans` + `quest_user_names`, all tagged `loadtest-*`). **All deleted after testing, verified via count query (0 remaining).** The one row left in `quest_user_names` is a pre-existing real entry (the developer's own account, untouched, confirmed by its non-`loadtest-` UUID and real Rasayesh profile data).

---

## Where the bottleneck actually is

1. **Single-threaded Node.js CPU (primary, confirmed directly).** `server.js` runs Next.js via a plain `createServer(...)` with no `cluster` module usage — one process, one thread for all JS execution. `docker stats` shows ~100–145% CPU (≈1 of 6 available cores) pegged at *every* concurrency level tested, including the lowest (50 connections) — meaning the container never had spare CPU headroom to give, regardless of how much load was added. **5 of the host's 6 CPU cores sat idle throughout every test.**
2. **Postgres connection pool (secondary, confirmed directly, compounds #1).** `lib/db.js`'s pool (`max: 10`) + `proxy.js`'s pool (`max: 2`) saturated and stayed saturated for the entire realistic mixed-traffic run. Postgres itself (`max_connections: 100`) was never close to its own ceiling — the app's own pool config is the actual constraint, not the database server.
3. **Missing `quest_scans.user_uuid` index (Phase 5's finding, not independently demonstrated here, but real).** Could not be observed in this test because the reachable DB has ~0 rows in that table. This will compound #1 and #2 once real scan volume accumulates during the actual event — each unindexed query will hold a DB pool slot (and the CPU thread awaiting it) longer, worsening both bottlenecks above under real data volume.
4. **Not network, not memory.** Memory usage stayed low and stable throughout (well under available RAM). This was tested from `localhost` specifically to exclude network/CDN effects per the task's scope — that isolation held; nothing here indicates a network-layer issue.

## Recommendation

**Try the cheap fixes first — they're likely sufficient for this event, and are far less effort than Redis + multi-container:**

1. **Enable Node.js cluster mode within this same container** (fork one worker process per CPU core in `server.js` — this VPS already has 6 cores, 5 of which are currently idle). This directly attacks the confirmed, primary bottleneck and could plausibly multiply the sustainable throughput ceiling several-fold, all within the existing single container. Trade-off: reopens the same multi-process in-memory-cache-coherency question flagged in Phase 5 (each cluster worker gets its own `unstable_cache` instance) — an acceptable trade for a short high-stakes event, where "occasionally slightly stale ISR cache across workers" is a far smaller risk than "the app falls over."
2. **Raise `lib/db.js`'s pool `max`** from 10 to something like 25–30 (with a matching bump to `proxy.js`'s if needed) — directly addresses the confirmed pool-saturation finding. Cheap, one-line change. Needs to be paired with #1, or the freed-up DB concurrency just becomes more work queued on the same single CPU thread.
3. **Add the `quest_scans` index** from the Phase 5 report (`CREATE INDEX CONCURRENTLY idx_quest_scans_user_company ON quest_scans (user_uuid, company_id);`) — cheap insurance against the compounding effect described above once real event data accumulates.
4. **Re-run this same load test after 1–3** to see how much headroom that combination actually buys before concluding whether horizontal scaling is still needed.

**Redis + multiple containers is very likely more than this event needs**, and is significantly more operational complexity (new infrastructure, a load balancer, and — per the Phase 5 report — an *unconfirmed* question of whether this Next.js version's `cacheHandlers` config even intercepts the `unstable_cache` calls this codebase's caching is built on) for a problem that a same-container clustering + pool-size change would likely solve at a fraction of the effort. I'd hold off on Redis/multi-container work until after trying 1–3 and re-testing — if this single container comfortably clears the realistic mixed-traffic scenario at that point, the multi-container effort isn't warranted for this event at all.

No code changes were made as part of this task (investigation/measurement only, per scope). No live Nginx/production config was touched. All test data was cleaned up and verified removed.
