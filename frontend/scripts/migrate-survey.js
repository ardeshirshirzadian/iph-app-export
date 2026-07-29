#!/usr/bin/env node
// One-time migration: add survey_fields column to quest_content/quest_badges,
// create quest_survey_responses table.
// Run: node scripts/migrate-survey.js

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
      `ALTER TABLE quest_content ADD COLUMN IF NOT EXISTS survey_fields JSONB`
    );
    console.log('quest_content: survey_fields column added.');

    await client.query(
      `ALTER TABLE quest_badges ADD COLUMN IF NOT EXISTS survey_fields JSONB`
    );
    console.log('quest_badges: survey_fields column added.');

    await client.query(`
      CREATE TABLE IF NOT EXISTS quest_survey_responses (
        id             SERIAL PRIMARY KEY,
        mission_id     INT,
        badge_id       INT,
        user_uuid      VARCHAR(100) NOT NULL,
        answers        JSONB NOT NULL,
        submitted_at   TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS quest_survey_responses_mission_user_idx
        ON quest_survey_responses (mission_id, user_uuid) WHERE mission_id IS NOT NULL
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS quest_survey_responses_badge_user_idx
        ON quest_survey_responses (badge_id, user_uuid) WHERE badge_id IS NOT NULL
    `);
    console.log('quest_survey_responses: table and indexes created.');

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
