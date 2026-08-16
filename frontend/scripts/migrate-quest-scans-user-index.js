#!/usr/bin/env node
// One-time migration: add a composite index on quest_scans(user_uuid, company_id).
// Every hot path on this table filters on user_uuid alone (leaderboard's
// GROUP BY, quest/stats' per-user COUNT/SUM) or user_uuid + company_id together
// (the duplicate-scan check in quest/scan — the write path's most latency-
// sensitive query) — this table previously had no index beyond its primary
// key on id. See PHASE5_AUDIT.md and LOAD_TEST_REPORT.md for the investigation.
//
// Uses CREATE INDEX CONCURRENTLY so it never locks the table — safe to run
// against a live production database. CONCURRENTLY cannot run inside a
// transaction block, so (unlike this repo's other migrate-*.js scripts) this
// one deliberately does NOT wrap the statement in BEGIN/COMMIT.
//
// Run: node scripts/migrate-quest-scans-user-index.js

const fs = require('fs');
const envPath = require('path').join(__dirname, '..', '.env.local');
fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
});

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    await client.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quest_scans_user_company
       ON quest_scans (user_uuid, company_id)`
    );
    console.log('quest_scans: idx_quest_scans_user_company created (or already existed).');
    console.log('Migration complete.');
  } catch (e) {
    console.error('Migration failed:', e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
