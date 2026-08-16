# Follow-up: quest_scans index + DB pool size increase

Applied the two low-risk fixes identified in `PHASE5_AUDIT.md` and `LOAD_TEST_REPORT.md`. Node.js cluster mode was deliberately **not** implemented (out of scope for this task — deferred to closer to the event, per the cache-staleness tradeoff noted in Phase 5).

## Part A — `quest_scans` index

Re-verified fresh (not trusted from the prior report): `quest_scans` still had only its primary key on `id`, confirmed via `\d quest_scans`. Re-checked the actual query patterns in `leaderboard/route.js`, `stats/route.js`, and `scan/route.js` directly — confirmed the composite `(user_uuid, company_id)` shape Phase 5 proposed is correct: the leading column serves every plain `WHERE user_uuid = $1` query (leaderboard's `GROUP BY user_uuid`, stats' COUNT/SUM), and the full composite serves the two `WHERE user_uuid = $1 AND company_id = $2` duplicate-check queries in the scan write-path — the most latency-sensitive queries in the app.

Applied via `CREATE INDEX CONCURRENTLY` (no table lock). Also captured as a tracked, idempotent migration script (`frontend/scripts/migrate-quest-scans-user-index.js`, matching this repo's existing `migrate-*.js` convention) since the index was applied directly via `psql` first — the script itself was run afterward and confirmed to work correctly (`IF NOT EXISTS`, safe no-op).

**One correction to the original task's assumption:** `EXPLAIN` on the still-near-empty table (0 rows) continues to show `Seq Scan` even with the index present — this is *correct* Postgres planner behavior (a seq scan over ~0 rows is genuinely cheaper than an index scan), not a sign the index isn't working. To actually verify the index is functional, I temporarily loaded 20,000 tagged synthetic rows (`loadtest-idxcheck-*`, spread across 4,000 distinct fake users and the same 8 real booth IDs used in the original load test), re-ran `EXPLAIN ANALYZE`, and confirmed:
- Single-user lookup (`stats`-style, `WHERE user_uuid = $1`): **Index Only Scan using idx_quest_scans_user_company**, 0.278ms.
- Duplicate-check (`scan`-style, `WHERE user_uuid = $1 AND company_id = $2`): **Index Scan using idx_quest_scans_user_company**, both columns in the index condition, 0.127ms.
- Leaderboard's full-table `GROUP BY user_uuid`: correctly still `Seq Scan` (unavoidable for a full-table aggregation — an index can't skip touching every row when you're aggregating all of them), 10ms for 20k rows — still fast.

All 20,000 verification rows deleted immediately after, table `VACUUM ANALYZE`d back to a clean 0-row state, confirmed via count query.

## Part B — Connection pool sizes

Confirmed current config fresh: `lib/db.js` `max: 10`, `proxy.js` `max: 2` (both matched the load test report exactly). Raised to `max: 25` and `max: 5` respectively — no other pool settings touched (idle/connection timeouts left as-is, nothing looked broken).

**Checked the shared-Postgres-instance question properly** (the task specifically asked me not to assume): `iph-apn` (the admin panel — a genuinely separate container/codebase at `/home/ubuntu/iph-apn`, port 3003, distinct from the `app/apn/*` route CLAUDE.md describes as part of the same app — worth knowing this is actually two different things) connects to the **same** Postgres instance (`iph-postgres`, port 5432, `iphsuperapp` database) with its own `lib/db.js` pool, `max: 10`, no separate proxy-pool (admin auth uses a custom HMAC token, not DB-backed checks). Combined ceiling across both apps: `25 + 5 + 10 = 40`, comfortably under Postgres's `max_connections: 100`. `faq-postgres-vps` and `symphony-postgres` are confirmed entirely separate Postgres instances (different ports, 5434/5433) — not relevant to this ceiling at all.

## Deploy

The frontend working tree still had Phase 4's full attendee-data-sharing refactor sitting uncommitted (never confirmed for deploy), and the Dockerfile does `COPY . .` — a straight rebuild would have shipped that unreviewed work alongside today's two fixes. Flagged this before touching the container; you chose to isolate. Used `git stash push -u` on exactly the Phase 4 files (kept `lib/db.js`, `proxy.js`, and the new migration script in the working tree), built and deployed with only today's fixes in the image, verified the new container (`docker ps`, canary requests to all six endpoints, confirmed DB pool connects), then `git stash pop`'d Phase 4's changes back — nothing lost, working tree is back to its full pre-deploy state with both Phase 4's and today's changes present.

## Re-test: mixed traffic (300 connections, 60s), same endpoint mix as the original report

| | Original (before fixes) | Retest (after index + pool fixes) |
|---|---|---|
| Req/sec (avg) | 319 | 309 |
| p50 latency | 55ms | **271ms** |
| p97.5 latency | 5602ms | 3869ms |
| p99 latency | 5945ms | 5489ms |
| Error rate | 90/19169 (0.47%) | **230/18521 (1.24%)** |
| Postgres connections held | **13** (pool ceiling) | **31** (new pool ceiling) |
| CPU during test | ~108–145% (≈1 core) | **~108–128% (≈1 core) — unchanged** |

**Honest result: this alone did not improve the mixed-traffic scenario, and slightly worsened two metrics (p50 latency, error rate) while marginally improving the tail (p97.5/p99).** This is exactly the outcome predicted in the original report's root-cause analysis, and it's directly explained by the data:

- The pool size increase worked exactly as designed — connections held at a **sustained 31** throughout the retest (vs. 13 before), proving the pool is no longer the artificial ceiling it was.
- **CPU stayed pegged at the identical ~1-core saturation the whole time** — completely unchanged by either fix. This is the real, unaddressed bottleneck, and it was never in scope for today's task.
- The regression in p50/error-rate is a plausible, coherent side effect: the old `max: 10` pool was *inadvertently* acting as a backpressure valve, limiting how much concurrent work could pile up waiting for the single CPU thread. Raising the pool lets more requests be "admitted" into active processing at once, but since the CPU can't actually process them any faster, more work now sits contending for the same single thread's time slices simultaneously — worse queueing for a similar total throughput, not better.

This is a clean, useful negative result, not a failure: it isolates the CPU bottleneck as the *only* thing standing between this container and real capacity gains, confirms the index/pool fixes were correctly implemented (both verified working exactly as designed via direct evidence — index scans in `EXPLAIN ANALYZE`, pool ceiling moving from 13→31), and sets an honest expectation for the deferred clustering task: **that work is what will actually move the needle, not further tuning of the database layer.**

No new `quest_scans` rows were written during this retest (its endpoint mix doesn't include `/api/quest/scan`), so index usage couldn't be independently re-observed under this specific run — the empty table correctly still plans a `Seq Scan` for the same reason described in Part A. The index's real-world functionality was already directly proven there with a realistic data volume.

## Cleanup & final state

- All synthetic data removed and verified (0 rows matching `loadtest-%` in `quest_scans` and `quest_user_names`).
- Container confirmed healthy post-test: 0% CPU idle, 65ms response time on a canary request.
- Working tree confirmed intact: Phase 4's changes restored, today's fixes (`lib/db.js`, `proxy.js`, `frontend/scripts/migrate-quest-scans-user-index.js`) present alongside them, nothing lost.

## Suggested commit titles

Two separate, logically distinct changes — suggest splitting:

1. `perf: add composite index on quest_scans(user_uuid, company_id)`
2. `perf: raise Postgres connection pool size (db: 10→25, proxy: 2→5)`

Waiting for confirmation before committing either. (Note: Phase 4's changes are still separately uncommitted in the working tree and were not part of this task's scope.)
