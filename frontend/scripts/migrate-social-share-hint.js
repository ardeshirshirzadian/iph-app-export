#!/usr/bin/env node
// One-time migration: add social_share_hint_fa / social_share_hint_en to
// quest_content -- admin-editable per-mission text shown in the submission
// modal (e.g. "your post must be public"), replacing the hardcoded string
// that used to live in QuestClient.js. Run: node scripts/migrate-social-share-hint.js

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
      `ALTER TABLE quest_content ADD COLUMN IF NOT EXISTS social_share_hint_fa TEXT`
    );
    await client.query(
      `ALTER TABLE quest_content ADD COLUMN IF NOT EXISTS social_share_hint_en TEXT`
    );
    console.log('quest_content: social_share_hint_fa + social_share_hint_en columns added (or already existed).');
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
