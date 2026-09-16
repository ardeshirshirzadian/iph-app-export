/**
 * Migration: کد معرف "unlimited usage" mode -- two new quest_content columns
 * (referral_is_unlimited, referral_per_invite_xp) for the repeating
 * per-invite reward model, alongside the existing tiered model.
 * Run once: node scripts/migrate-referral-unlimited.js
 *
 * NOT YET RUN as of implementation -- reviewed but deliberately not executed
 * against the live database this pass. Confirm with Ardeshir first.
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
        ADD COLUMN IF NOT EXISTS referral_is_unlimited   BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS referral_per_invite_xp  INTEGER
    `);
    console.log('✓ quest_content.referral_is_unlimited / referral_per_invite_xp');

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
