#!/usr/bin/env node
/**
 * Adds is_featured_booth_bonus column to quest_scans.
 * Tracks whether a scan received the golden-booth bonus reward.
 * Run once: node scripts/migrate-featured-booth-bonus-scan.js
 */

const { Pool } = require('pg');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE quest_scans
        ADD COLUMN IF NOT EXISTS is_featured_booth_bonus BOOLEAN DEFAULT false
    `);
    console.log('✓ is_featured_booth_bonus column added (or already existed)');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
