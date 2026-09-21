/**
 * Migration: audit history for APN manual referral assignments.
 *
 * Run once, through the normal application migration procedure:
 *   node scripts/migrate-manual-referral-assignment.js
 *
 * This file is deliberately not executed by the application or this change.
 */

const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS quest_referral_assignment_audit (
        id                    SERIAL PRIMARY KEY,
        event_id              INTEGER NOT NULL REFERENCES events(id),
        redemption_id         INTEGER NOT NULL REFERENCES quest_referral_redemptions(id),
        action                VARCHAR(32) NOT NULL CHECK (action IN ('manual_assign')),
        invited_user_uuid     VARCHAR(100) NOT NULL,
        new_referrer_user_uuid VARCHAR(100) NOT NULL,
        admin_id              INTEGER,
        admin_username_snapshot VARCHAR(150),
        reason                TEXT,
        created_at            TIMESTAMP NOT NULL DEFAULT now(),
        UNIQUE (redemption_id, action)
      )
    `);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_quest_referral_assignment_audit_event_created
       ON quest_referral_assignment_audit (event_id, created_at DESC)`
    );
    await client.query('COMMIT');
    console.log('✓ quest_referral_assignment_audit');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
