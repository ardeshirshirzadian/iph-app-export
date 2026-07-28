#!/usr/bin/env node
// One-time migration: add featured_booth columns to quest_content and quest_badges,
// and create the quest_featured_booth_state table.
// Run: node scripts/migrate-featured-booth.js

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
    // ── Add featured_booth columns to quest_content (missions) ────────────────
    await client.query(`
      ALTER TABLE quest_content
        ADD COLUMN IF NOT EXISTS featured_booth_pool         JSONB,
        ADD COLUMN IF NOT EXISTS featured_booth_bonus_xp     INT NOT NULL DEFAULT 500,
        ADD COLUMN IF NOT EXISTS featured_booth_rotation_hours INT NOT NULL DEFAULT 1
    `);
    console.log('quest_content: featured_booth columns added (or already exist).');

    // ── Add featured_booth columns to quest_badges ────────────────────────────
    await client.query(`
      ALTER TABLE quest_badges
        ADD COLUMN IF NOT EXISTS featured_booth_pool         JSONB,
        ADD COLUMN IF NOT EXISTS featured_booth_bonus_xp     INT NOT NULL DEFAULT 500,
        ADD COLUMN IF NOT EXISTS featured_booth_rotation_hours INT NOT NULL DEFAULT 1
    `);
    console.log('quest_badges: featured_booth columns added (or already exist).');

    // ── Create quest_featured_booth_state ─────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS quest_featured_booth_state (
        id                SERIAL PRIMARY KEY,
        mission_id        INT REFERENCES quest_content(id) ON DELETE CASCADE,
        badge_id          INT REFERENCES quest_badges(id)  ON DELETE CASCADE,
        current_company_id INT NOT NULL,
        selected_at       TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT exactly_one_ref CHECK (
          (mission_id IS NOT NULL AND badge_id IS NULL) OR
          (mission_id IS NULL     AND badge_id IS NOT NULL)
        )
      )
    `);
    console.log('quest_featured_booth_state table created (or already exists).');

    // Partial unique indexes: one row per mission, one row per badge
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_featured_booth_state_mission
        ON quest_featured_booth_state (mission_id) WHERE mission_id IS NOT NULL
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_featured_booth_state_badge
        ON quest_featured_booth_state (badge_id) WHERE badge_id IS NOT NULL
    `);
    console.log('Partial unique indexes created (or already exist).');

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
