#!/usr/bin/env node
// Migration: add is_manual/linked_mission_id/linked_badge_id to companies;
// create quest_badge_progress table.
// Run: node scripts/migrate-manual-rewards.js

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
    await client.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_manual BOOLEAN DEFAULT false`);
    console.log('✓ companies.is_manual');

    await client.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS linked_mission_id INT`);
    console.log('✓ companies.linked_mission_id');

    await client.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS linked_badge_id INT`);
    console.log('✓ companies.linked_badge_id');

    await client.query(`
      CREATE TABLE IF NOT EXISTS quest_badge_progress (
        id SERIAL PRIMARY KEY,
        badge_id INT NOT NULL,
        user_uuid VARCHAR(100) NOT NULL,
        earned BOOLEAN DEFAULT true,
        earned_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(badge_id, user_uuid)
      )
    `);
    console.log('✓ quest_badge_progress table');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
