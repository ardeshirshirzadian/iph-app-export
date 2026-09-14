#!/usr/bin/env node
// One-time migration: add the daily active-hours window columns to
// quest_content for featured_booth missions (missions only -- badges are
// out of scope for this feature, see 2026-09-14 spec).
// Run: node scripts/migrate-featured-booth-window.js

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
    await client.query(`
      ALTER TABLE quest_content
        ADD COLUMN IF NOT EXISTS featured_booth_daily_start_hour INT,
        ADD COLUMN IF NOT EXISTS featured_booth_daily_end_hour   INT,
        ADD COLUMN IF NOT EXISTS featured_booth_message_fa       TEXT,
        ADD COLUMN IF NOT EXISTS featured_booth_message_en       TEXT,
        ADD COLUMN IF NOT EXISTS featured_booth_closed_message_fa  TEXT,
        ADD COLUMN IF NOT EXISTS featured_booth_closed_message_en  TEXT,
        ADD COLUMN IF NOT EXISTS featured_booth_claimed_message_fa TEXT,
        ADD COLUMN IF NOT EXISTS featured_booth_claimed_message_en TEXT
    `);
    console.log('quest_content: featured_booth daily-window + message columns added (or already exist).');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
