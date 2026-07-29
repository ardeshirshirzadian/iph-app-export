// Migration: create quest_xp_grants table for non-scan XP (quiz, survey completions)
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS quest_xp_grants (
        id          SERIAL PRIMARY KEY,
        user_uuid   VARCHAR(100) NOT NULL,
        source_type VARCHAR(50)  NOT NULL,
        source_id   INT          NOT NULL,
        xp_amount   INT          NOT NULL DEFAULT 0,
        granted_at  TIMESTAMP    NOT NULL DEFAULT NOW()
      )
    `);

    // Prevent double-granting if application-level enforcement ever races
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_quest_xp_grants_unique
      ON quest_xp_grants (user_uuid, source_type, source_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_quest_xp_grants_user
      ON quest_xp_grants (user_uuid)
    `);

    console.log('✅ quest_xp_grants table and indexes created (or already existed)');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => { console.error(err); process.exit(1); });
