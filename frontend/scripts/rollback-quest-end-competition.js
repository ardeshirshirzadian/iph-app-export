// Rollback for migrate-quest-end-competition.js. Drops only the triggers and
// functions (the enforcement layer) -- it deliberately does NOT drop
// events.quest_ended_at/quest_end_scheduled_at, quest_competition_audit, or
// quest_leaderboard_snapshot, so historical data (who ended what, when, and
// the frozen standings) survives a rollback of the enforcement mechanism
// itself. Safe to run even if the migration was never applied (everything
// is IF EXISTS).
//
// Run by hand: node scripts/rollback-quest-end-competition.js
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function rollback() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Triggers first (must drop before the functions they depend on).
    await client.query('DROP TRIGGER IF EXISTS trg_quest_user_progress_block_after_end ON quest_user_progress');
    await client.query('DROP TRIGGER IF EXISTS trg_quest_xp_grants_block_after_end ON quest_xp_grants');
    await client.query('DROP TRIGGER IF EXISTS trg_quest_scans_block_xp_after_end ON quest_scans');
    await client.query('DROP TRIGGER IF EXISTS trg_quest_badge_progress_block_after_end ON quest_badge_progress');
    await client.query('DROP TRIGGER IF EXISTS trg_quest_survey_responses_block_after_end ON quest_survey_responses');
    await client.query('DROP TRIGGER IF EXISTS trg_quest_quiz_attempts_block_after_end ON quest_quiz_attempts');

    // Then the functions.
    await client.query('DROP FUNCTION IF EXISTS quest_block_badge_progress_after_end()');
    await client.query('DROP FUNCTION IF EXISTS quest_block_progress_after_end()');
    await client.query('DROP FUNCTION IF EXISTS quest_block_scan_xp_after_end()');
    await client.query('DROP FUNCTION IF EXISTS quest_block_xp_grants_after_end()');
    await client.query('DROP FUNCTION IF EXISTS quest_block_after_end()');
    await client.query('DROP FUNCTION IF EXISTS quest_effective_end(integer)');

    await client.query('COMMIT');
    console.log('[rollback-quest-end-competition] done -- triggers and functions dropped.');
    console.log('[rollback-quest-end-competition] events.quest_ended_at/quest_end_scheduled_at, quest_competition_audit, and quest_leaderboard_snapshot were left in place.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[rollback-quest-end-competition] failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

rollback().catch(() => { process.exitCode = 1; });
