#!/usr/bin/env node
// One-time migration: add hall_scan columns to quest_content and quest_badges.
// Run: node scripts/migrate-hall-scan.js

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

    // quest_content columns
    await client.query(`ALTER TABLE quest_content ADD COLUMN IF NOT EXISTS target_hall_name VARCHAR(50)`);
    await client.query(`ALTER TABLE quest_content ADD COLUMN IF NOT EXISTS hall_match_mode VARCHAR(10) NOT NULL DEFAULT 'any'`);
    await client.query(`ALTER TABLE quest_content ADD COLUMN IF NOT EXISTS hall_scan_count INT`);
    console.log('quest_content: hall_scan columns added (or already existed).');

    // quest_badges columns
    await client.query(`ALTER TABLE quest_badges ADD COLUMN IF NOT EXISTS target_hall_name VARCHAR(50)`);
    await client.query(`ALTER TABLE quest_badges ADD COLUMN IF NOT EXISTS hall_match_mode VARCHAR(10) NOT NULL DEFAULT 'any'`);
    await client.query(`ALTER TABLE quest_badges ADD COLUMN IF NOT EXISTS hall_scan_count INT`);
    console.log('quest_badges: hall_scan columns added (or already existed).');

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
