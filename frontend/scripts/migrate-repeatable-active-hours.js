#!/usr/bin/env node
// One-time migration: add repeatable_start_hour / repeatable_end_hour to companies table.
// Run: node scripts/migrate-repeatable-active-hours.js
//
// Defaults preserve "always active" behaviour (0–24 = full day).

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
    await client.query('BEGIN');
    await client.query(
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS repeatable_start_hour INT NOT NULL DEFAULT 0`
    );
    await client.query(
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS repeatable_end_hour INT NOT NULL DEFAULT 24`
    );
    console.log('companies: repeatable_start_hour + repeatable_end_hour columns added (or already existed).');
    await client.query('COMMIT');
    console.log('Migration complete.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
