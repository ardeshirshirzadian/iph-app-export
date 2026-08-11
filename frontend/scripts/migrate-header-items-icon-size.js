#!/usr/bin/env node
// One-time migration: add icon_size to header_items table.
// Run: node scripts/migrate-header-items-icon-size.js

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
      `ALTER TABLE header_items ADD COLUMN IF NOT EXISTS icon_size INTEGER NOT NULL DEFAULT 28`
    );
    console.log('header_items: icon_size column added (or already existed).');
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
