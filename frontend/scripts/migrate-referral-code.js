/**
 * Migration: کد معرف (referral code) feature -- new quest_content columns
 * (referral_referrer_xp, referral_referee_xp, referral_required_count) +
 * three new tables (quest_referral_codes, quest_referral_redemptions,
 * quest_referral_attempt_limits).
 * Run once: node scripts/migrate-referral-code.js
 *
 * NOT YET RUN as of implementation -- reviewed but deliberately not executed
 * against the live database this pass.
 */

const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE quest_content
        ADD COLUMN IF NOT EXISTS referral_referrer_xp    INTEGER,
        ADD COLUMN IF NOT EXISTS referral_referee_xp     INTEGER,
        ADD COLUMN IF NOT EXISTS referral_required_count INTEGER
    `);
    console.log('✓ quest_content.referral_referrer_xp / referral_referee_xp / referral_required_count');

    await client.query(`
      CREATE TABLE IF NOT EXISTS quest_referral_codes (
        id              SERIAL PRIMARY KEY,
        event_id        INTEGER NOT NULL REFERENCES events(id),
        owner_user_uuid VARCHAR(100) NOT NULL,
        code            VARCHAR(16) NOT NULL,
        is_active       BOOLEAN NOT NULL DEFAULT true,
        max_redemptions INTEGER,
        created_at      TIMESTAMP NOT NULL DEFAULT now(),
        UNIQUE (event_id, code),
        UNIQUE (event_id, owner_user_uuid)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_quest_referral_codes_event ON quest_referral_codes(event_id)`);
    console.log('✓ quest_referral_codes');

    await client.query(`
      CREATE TABLE IF NOT EXISTS quest_referral_redemptions (
        id                 SERIAL PRIMARY KEY,
        event_id           INTEGER NOT NULL REFERENCES events(id),
        code_id            INTEGER NOT NULL REFERENCES quest_referral_codes(id) ON DELETE CASCADE,
        referrer_user_uuid VARCHAR(100) NOT NULL,
        referee_user_uuid  VARCHAR(100) NOT NULL,
        status             VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected')),
        reject_reason      VARCHAR(30),
        referrer_xp_amount INTEGER,
        referee_xp_amount  INTEGER,
        recheck_attempts   INTEGER NOT NULL DEFAULT 0,
        created_at         TIMESTAMP NOT NULL DEFAULT now(),
        resolved_at        TIMESTAMP,
        UNIQUE (event_id, referee_user_uuid)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_quest_referral_redemptions_referrer ON quest_referral_redemptions(referrer_user_uuid, status)`);
    console.log('✓ quest_referral_redemptions');

    await client.query(`
      CREATE TABLE IF NOT EXISTS quest_referral_attempt_limits (
        id            SERIAL PRIMARY KEY,
        event_id      INTEGER NOT NULL REFERENCES events(id),
        contact_key   VARCHAR(150) NOT NULL,
        fail_count    INTEGER NOT NULL DEFAULT 0,
        first_fail_at TIMESTAMP,
        blocked_until TIMESTAMP,
        UNIQUE (event_id, contact_key)
      )
    `);
    console.log('✓ quest_referral_attempt_limits');

    await client.query('COMMIT');
    console.log('Migration complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
