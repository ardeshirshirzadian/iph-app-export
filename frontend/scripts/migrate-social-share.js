// Migration: create quest_social_share_submissions table
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS quest_social_share_submissions (
        id            SERIAL PRIMARY KEY,
        mission_id    INT,
        badge_id      INT,
        user_uuid     VARCHAR(100) NOT NULL,
        link_url      VARCHAR(1000) NOT NULL,
        platform      VARCHAR(50),
        status        VARCHAR(20)  NOT NULL DEFAULT 'pending',
        admin_note    TEXT,
        submitted_at  TIMESTAMP    NOT NULL DEFAULT NOW(),
        reviewed_at   TIMESTAMP,
        reviewed_by   VARCHAR(100)
      )
    `);

    // Prevent duplicate PENDING submissions per user per mission
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_social_share_pending_mission
      ON quest_social_share_submissions (mission_id, user_uuid)
      WHERE status = 'pending' AND mission_id IS NOT NULL
    `);

    // Prevent duplicate PENDING submissions per user per badge
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_social_share_pending_badge
      ON quest_social_share_submissions (badge_id, user_uuid)
      WHERE status = 'pending' AND badge_id IS NOT NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_social_share_user
      ON quest_social_share_submissions (user_uuid)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_social_share_status
      ON quest_social_share_submissions (status)
    `);

    console.log('✅ quest_social_share_submissions table and indexes created (or already existed)');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => { console.error(err); process.exit(1); });
