// Migration: add leaderboard_limit column to quest_levels table.
// Run once: node scripts/migrate-quest-levels-leaderboard-limit.js
const { Pool } = require('pg');
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE quest_levels
      ADD COLUMN IF NOT EXISTS leaderboard_limit INT NOT NULL DEFAULT 20
    `);
    console.log('✓ Column leaderboard_limit added to quest_levels (or already existed)');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(e => { console.error(e); process.exit(1); });
