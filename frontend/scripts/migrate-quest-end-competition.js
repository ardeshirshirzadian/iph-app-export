// One-off migration: adds the "End competition" schema.
// House pattern: standalone pg script, BEGIN/COMMIT, IF NOT EXISTS everywhere.
// Run once by hand: node scripts/migrate-quest-end-competition.js
//
// Adds:
//   - events.quest_ended_at / events.quest_end_scheduled_at (timestamptz)
//   - quest_competition_audit (who ended/reopened/scheduled/exported, when)
//   - quest_leaderboard_snapshot (frozen final standings, rebuildable)
//   - quest_effective_end(event_id) SQL helper
//   - DB trigger backstop on quest_xp_grants, quest_scans, quest_user_progress,
//     quest_badge_progress, quest_quiz_attempts, quest_survey_responses
//
// Deliberately NOT touched: quest_attendance_log (no trigger — attendance
// presence rows must keep recording after the end, same as quest_scans'
// zero-XP rows), quest_social_share_submissions, quest_referral_redemptions
// (pending-record creation isn't an XP grant; the actual payout goes through
// quest_xp_grants, which IS guarded).
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE events
        ADD COLUMN IF NOT EXISTS quest_ended_at timestamptz,
        ADD COLUMN IF NOT EXISTS quest_end_scheduled_at timestamptz
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS quest_competition_audit (
        id serial PRIMARY KEY,
        event_id integer NOT NULL REFERENCES events(id),
        action varchar(20) NOT NULL CHECK (action IN ('end','reopen','schedule','unschedule','export')),
        admin_id integer REFERENCES admins(id) ON DELETE SET NULL,
        admin_username_snapshot varchar(100),
        note varchar(500),
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_quest_competition_audit_event
        ON quest_competition_audit (event_id, created_at DESC)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS quest_leaderboard_snapshot (
        id serial PRIMARY KEY,
        event_id integer NOT NULL REFERENCES events(id),
        rank integer NOT NULL,
        user_uuid varchar(100) NOT NULL,
        display_name_fa varchar(200),
        display_name_en varchar(200),
        total_xp integer NOT NULL,
        scan_count integer NOT NULL DEFAULT 0,
        breakdown jsonb,
        snapshot_taken_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (event_id, user_uuid)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_quest_leaderboard_snapshot_event
        ON quest_leaderboard_snapshot (event_id, rank)
    `);

    // Effective end instant for an event: the manual end if set, else a
    // scheduled end once that instant has passed. NULL means still open.
    await client.query(`
      CREATE OR REPLACE FUNCTION quest_effective_end(p_event_id integer)
      RETURNS timestamptz LANGUAGE sql STABLE AS $$
        SELECT COALESCE(
          quest_ended_at,
          CASE WHEN quest_end_scheduled_at IS NOT NULL AND quest_end_scheduled_at <= now()
               THEN quest_end_scheduled_at END
        )
        FROM events WHERE id = p_event_id;
      $$
    `);

    // Strict guard: blocks the row entirely once ended. For tables with no
    // pending/approval concept and no "keep recording" exception.
    await client.query(`
      CREATE OR REPLACE FUNCTION quest_block_after_end() RETURNS trigger AS $$
      BEGIN
        IF quest_effective_end(NEW.event_id) IS NOT NULL THEN
          RAISE EXCEPTION 'quest_ended: competition already ended for event %', NEW.event_id;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    // Backdating-aware guard for quest_xp_grants only: a grant backdated to
    // a pre-end submission/redemption timestamp (approved later) is allowed;
    // anything with granted_at after the effective end is rejected. This is
    // what lets "pending items submitted before the end still count if
    // approved later" work, while still rejecting a bug that forgets to
    // backdate correctly.
    await client.query(`
      CREATE OR REPLACE FUNCTION quest_block_xp_grants_after_end() RETURNS trigger AS $$
      DECLARE v_end timestamptz;
      BEGIN
        v_end := quest_effective_end(NEW.event_id);
        IF v_end IS NOT NULL AND NEW.granted_at > v_end THEN
          RAISE EXCEPTION 'quest_ended: cannot grant XP for event % at %', NEW.event_id, NEW.granted_at;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    // quest_scans special case: the visit row itself must always be
    // insertable (exhibitors need booth-visit data for the rest of the
    // exhibition even after the competition ends) — only a nonzero reward
    // on it is blocked.
    await client.query(`
      CREATE OR REPLACE FUNCTION quest_block_scan_xp_after_end() RETURNS trigger AS $$
      BEGIN
        IF (NEW.xp_earned > 0 OR NEW.is_featured_booth_bonus IS TRUE)
           AND quest_effective_end(NEW.event_id) IS NOT NULL THEN
          RAISE EXCEPTION 'quest_ended: cannot grant scan XP for event % after competition end', NEW.event_id;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    // quest_user_progress has no event_id column directly (scoped via
    // mission_id -> quest_content.event_id). Timestamp-based like
    // quest_xp_grants' guard (not a blanket strict block) -- a late approval
    // of a pre-end pending item (social-share) backdates completed_at to the
    // original submission time, so it must pass here too, the same way a
    // backdated granted_at passes the XP grants guard. Only a genuinely NEW
    // completion is checked: INSERT with completed=true, or an UPDATE whose
    // OLD row was not yet completed. An UPDATE to an already-completed row
    // (e.g. a harmless re-touch/re-grant) is never blocked, regardless of
    // timestamp -- that's not a new completion.
    await client.query(`
      CREATE OR REPLACE FUNCTION quest_block_progress_after_end() RETURNS trigger AS $$
      DECLARE
        v_event_id integer;
        v_end timestamptz;
        v_is_new_completion boolean;
      BEGIN
        v_is_new_completion :=
          (TG_OP = 'INSERT' AND NEW.completed IS TRUE)
          OR (TG_OP = 'UPDATE' AND NEW.completed IS TRUE AND OLD.completed IS DISTINCT FROM TRUE);

        IF v_is_new_completion THEN
          SELECT event_id INTO v_event_id FROM quest_content WHERE id = NEW.mission_id;
          IF v_event_id IS NOT NULL THEN
            v_end := quest_effective_end(v_event_id);
            IF v_end IS NOT NULL AND NEW.completed_at > v_end THEN
              RAISE EXCEPTION 'quest_ended: cannot complete mission % for event % at %', NEW.mission_id, v_event_id, NEW.completed_at;
            END IF;
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    // quest_badge_progress: same backdating-aware shape as quest_xp_grants,
    // keyed on earned_at instead of granted_at -- the social-share approval
    // route backdates earned_at to the submission's own timestamp for a
    // late-approved pre-end item, same reasoning as quest_user_progress
    // above. This table's trigger is BEFORE INSERT only (matching
    // quest_xp_grants, not quest_user_progress) -- its own ON CONFLICT DO
    // UPDATE re-grant path has no registered BEFORE UPDATE trigger, so a
    // re-touch of an already-earned badge is never evaluated here at all,
    // which already satisfies "don't block updates to existing rows"
    // without needing the OLD-comparison quest_user_progress needs.
    await client.query(`
      CREATE OR REPLACE FUNCTION quest_block_badge_progress_after_end() RETURNS trigger AS $$
      DECLARE v_end timestamptz;
      BEGIN
        v_end := quest_effective_end(NEW.event_id);
        IF v_end IS NOT NULL AND NEW.earned_at > v_end THEN
          RAISE EXCEPTION 'quest_ended: cannot earn badge % for event % at %', NEW.badge_id, NEW.event_id, NEW.earned_at;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    const strictTables = [
      'quest_quiz_attempts',
      'quest_survey_responses',
    ];
    for (const table of strictTables) {
      await client.query(`DROP TRIGGER IF EXISTS trg_${table}_block_after_end ON ${table}`);
      await client.query(`
        CREATE TRIGGER trg_${table}_block_after_end
          BEFORE INSERT ON ${table}
          FOR EACH ROW EXECUTE FUNCTION quest_block_after_end()
      `);
    }

    await client.query(`DROP TRIGGER IF EXISTS trg_quest_badge_progress_block_after_end ON quest_badge_progress`);
    await client.query(`
      CREATE TRIGGER trg_quest_badge_progress_block_after_end
        BEFORE INSERT ON quest_badge_progress
        FOR EACH ROW EXECUTE FUNCTION quest_block_badge_progress_after_end()
    `);

    await client.query(`DROP TRIGGER IF EXISTS trg_quest_scans_block_xp_after_end ON quest_scans`);
    await client.query(`
      CREATE TRIGGER trg_quest_scans_block_xp_after_end
        BEFORE INSERT ON quest_scans
        FOR EACH ROW EXECUTE FUNCTION quest_block_scan_xp_after_end()
    `);

    await client.query(`DROP TRIGGER IF EXISTS trg_quest_xp_grants_block_after_end ON quest_xp_grants`);
    await client.query(`
      CREATE TRIGGER trg_quest_xp_grants_block_after_end
        BEFORE INSERT ON quest_xp_grants
        FOR EACH ROW EXECUTE FUNCTION quest_block_xp_grants_after_end()
    `);

    await client.query(`DROP TRIGGER IF EXISTS trg_quest_user_progress_block_after_end ON quest_user_progress`);
    await client.query(`
      CREATE TRIGGER trg_quest_user_progress_block_after_end
        BEFORE INSERT OR UPDATE ON quest_user_progress
        FOR EACH ROW EXECUTE FUNCTION quest_block_progress_after_end()
    `);

    await client.query('COMMIT');
    console.log('[migrate-quest-end-competition] done.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate-quest-end-competition] failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(() => { process.exitCode = 1; });
