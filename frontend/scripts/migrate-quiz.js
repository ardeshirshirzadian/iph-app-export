#!/usr/bin/env node
// One-time migration: add quiz columns to quest_content/quest_badges, create quest_quiz_attempts.
// Run: node scripts/migrate-quiz.js

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

    const missionCols = [
      `ALTER TABLE quest_content ADD COLUMN IF NOT EXISTS quiz_question_fa TEXT`,
      `ALTER TABLE quest_content ADD COLUMN IF NOT EXISTS quiz_question_en TEXT`,
      `ALTER TABLE quest_content ADD COLUMN IF NOT EXISTS quiz_options_fa JSONB`,
      `ALTER TABLE quest_content ADD COLUMN IF NOT EXISTS quiz_options_en JSONB`,
      `ALTER TABLE quest_content ADD COLUMN IF NOT EXISTS quiz_correct_index INT`,
      `ALTER TABLE quest_content ADD COLUMN IF NOT EXISTS quiz_hint_type VARCHAR(10)`,
      `ALTER TABLE quest_content ADD COLUMN IF NOT EXISTS quiz_hint_url VARCHAR(500)`,
    ];
    for (const sql of missionCols) await client.query(sql);
    console.log('quest_content: quiz columns added.');

    const badgeCols = [
      `ALTER TABLE quest_badges ADD COLUMN IF NOT EXISTS quiz_question_fa TEXT`,
      `ALTER TABLE quest_badges ADD COLUMN IF NOT EXISTS quiz_question_en TEXT`,
      `ALTER TABLE quest_badges ADD COLUMN IF NOT EXISTS quiz_options_fa JSONB`,
      `ALTER TABLE quest_badges ADD COLUMN IF NOT EXISTS quiz_options_en JSONB`,
      `ALTER TABLE quest_badges ADD COLUMN IF NOT EXISTS quiz_correct_index INT`,
      `ALTER TABLE quest_badges ADD COLUMN IF NOT EXISTS quiz_hint_type VARCHAR(10)`,
      `ALTER TABLE quest_badges ADD COLUMN IF NOT EXISTS quiz_hint_url VARCHAR(500)`,
    ];
    for (const sql of badgeCols) await client.query(sql);
    console.log('quest_badges: quiz columns added.');

    await client.query(`
      CREATE TABLE IF NOT EXISTS quest_quiz_attempts (
        id             SERIAL PRIMARY KEY,
        mission_id     INT,
        badge_id       INT,
        user_uuid      VARCHAR(100) NOT NULL,
        selected_index INT NOT NULL,
        is_correct     BOOLEAN NOT NULL,
        attempted_at   TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS quest_quiz_attempts_mission_user_idx
        ON quest_quiz_attempts (mission_id, user_uuid) WHERE mission_id IS NOT NULL
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS quest_quiz_attempts_badge_user_idx
        ON quest_quiz_attempts (badge_id, user_uuid) WHERE badge_id IS NOT NULL
    `);
    console.log('quest_quiz_attempts: table and indexes created.');

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
