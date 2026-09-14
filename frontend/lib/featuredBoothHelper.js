import { query } from './db';

// Ensure the state table exists (idempotent, cached per process).
async function ensureStateTable() {
  if (globalThis._featuredBoothStateTableReady) return;
  await query(`
    CREATE TABLE IF NOT EXISTS quest_featured_booth_state (
      id                SERIAL PRIMARY KEY,
      mission_id        INT,
      badge_id          INT,
      current_company_id INT NOT NULL,
      selected_at       TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT exactly_one_ref CHECK (
        (mission_id IS NOT NULL AND badge_id IS NULL) OR
        (mission_id IS NULL     AND badge_id IS NOT NULL)
      )
    )
  `);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_featured_booth_state_mission
      ON quest_featured_booth_state (mission_id) WHERE mission_id IS NOT NULL
  `);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_featured_booth_state_badge
      ON quest_featured_booth_state (badge_id) WHERE badge_id IS NOT NULL
  `);
  // claimed_at: set the moment the current golden booth is actually scanned
  // (scan/route.js), NULL again the instant a new rotation picks a fresh
  // golden booth below. While set, the whole mission is locked for every
  // OTHER user until the next rotation -- see 2026-09-14 spec (point 3).
  await query(`ALTER TABLE quest_featured_booth_state ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP DEFAULT NULL`);
  globalThis._featuredBoothStateTableReady = true;
}

// Real Iran-local hour-of-day, independent of the container/DB's own
// timezone. Confirmed 2026-09-14: this container runs in UTC (not Asia/
// Tehran, despite the host OS being Tehran-zoned) -- a bare
// `new Date().getHours()` would silently compare against UTC hours here,
// off by Iran's +03:30 offset. The PRE-EXISTING repeatable_start_hour/
// repeatable_end_hour mechanism (companies_placement, scan/route.js) has
// exactly this bug today -- left untouched/out of scope for this change
// (a live, already-configured feature; flagged to Ardeshir separately),
// but this NEW featured_booth window is built correctly from day one.
export function getTehranHour(at = new Date()) {
  const h = parseInt(
    at.toLocaleString('en-US', { timeZone: 'Asia/Tehran', hour: 'numeric', hour12: false }),
    10
  );
  return h % 24; // guards the rare ICU "24" midnight edge case
}

// null/undefined start or end hour = no window configured = always active
// (backward-compatible default for every featured_booth mission that
// existed before this feature).
export function isWithinDailyWindow(startHour, endHour, at = new Date()) {
  if (startHour == null || endHour == null) return true;
  const hour = getTehranHour(at);
  return hour >= startHour && hour < endHour;
}

/**
 * Lazily ensure the current golden booth for a featured_booth mission or badge.
 *
 * Called at scan time so no cron job is needed.  If no state row exists, or the
 * existing row is older than `rotation_hours`, a new company is randomly picked
 * from the pool and the state is updated (clearing claimed_at). Repeats are
 * intentionally allowed.
 *
 * When item.featured_booth_daily_start_hour/end_hour are set and the current
 * Tehran hour falls outside that window, rotation is skipped entirely --
 * state is returned as-is (frozen), even if stale, since nothing should be
 * scannable outside exhibition hours anyway (see 2026-09-14 spec, NEW
 * REQUIREMENT). Missions only today -- badges don't carry these two columns,
 * so isWithinDailyWindow's null-check keeps them always-active, unchanged.
 *
 * Returns { current_company_id, selected_at, claimed_at } or null if the
 * pool is empty, the table errors, or (mission with a window configured and
 * no prior state) it's currently outside the active window.
 */
export async function ensureFeaturedBoothState(item, type) {
  // item: { id, featured_booth_pool: int[], featured_booth_rotation_hours: int,
  //         featured_booth_daily_start_hour?: int, featured_booth_daily_end_hour?: int }
  // type: 'mission' | 'badge'
  const pool = item.featured_booth_pool;
  if (!Array.isArray(pool) || pool.length === 0) return null;

  const withinWindow = isWithinDailyWindow(
    item.featured_booth_daily_start_hour,
    item.featured_booth_daily_end_hour
  );

  try {
    await ensureStateTable();

    const col  = type === 'mission' ? 'mission_id' : 'badge_id';
    const rotationMs = Math.max(1, item.featured_booth_rotation_hours ?? 1) * 3_600_000;

    const { rows } = await query(
      `SELECT current_company_id, selected_at, claimed_at
       FROM quest_featured_booth_state WHERE ${col} = $1`,
      [item.id]
    );

    if (rows.length === 0 && !withinWindow) return null; // closed, nothing selected yet

    const now       = Date.now();
    const isStale   = rows.length === 0 ||
      now - new Date(rows[0].selected_at).getTime() >= rotationMs;

    if (!isStale || !withinWindow) {
      // Either fresh, or stale-but-outside-window (frozen: don't rotate,
      // just report the existing -- possibly stale -- state as-is). rows
      // can't be empty here: the only rows.length===0 case not already
      // handled above is rows.length===0 && withinWindow, which is stale
      // by definition (isStale is unconditionally true with no prior row).
      return {
        current_company_id: rows[0].current_company_id,
        selected_at: rows[0].selected_at,
        claimed_at: rows[0].claimed_at,
      };
    }

    // Pick a genuinely random company from the pool (repeats allowed per spec).
    const newCompanyId = pool[Math.floor(Math.random() * pool.length)];

    if (rows.length === 0) {
      // No row yet — INSERT (race-safe: ON CONFLICT DO NOTHING, then re-read)
      await query(
        `INSERT INTO quest_featured_booth_state (${col}, current_company_id, selected_at, claimed_at)
         VALUES ($1, $2, NOW(), NULL)
         ON CONFLICT DO NOTHING`,
        [item.id, newCompanyId]
      );
    } else {
      // Stale — UPDATE only if still stale (guard against race). New cycle:
      // claimed_at resets to NULL, clearing any lock from the prior cycle.
      await query(
        `UPDATE quest_featured_booth_state
         SET current_company_id = $2, selected_at = NOW(), claimed_at = NULL
         WHERE ${col} = $1
           AND selected_at <= NOW() - ($3 * INTERVAL '1 millisecond')`,
        [item.id, newCompanyId, rotationMs]
      );
    }

    // Re-read the authoritative value (another process may have written first)
    const { rows: after } = await query(
      `SELECT current_company_id, selected_at, claimed_at
       FROM quest_featured_booth_state WHERE ${col} = $1`,
      [item.id]
    );
    if (after.length === 0) return null;
    return {
      current_company_id: after[0].current_company_id,
      selected_at: after[0].selected_at,
      claimed_at: after[0].claimed_at,
    };

  } catch (err) {
    console.error('[featuredBoothHelper] ensureFeaturedBoothState error:', err.message);
    return null;
  }
}

/**
 * Marks the current cycle as claimed (the golden booth was just scanned),
 * locking the mission for every other user until the next rotation. Only
 * ever called right after ensureFeaturedBoothState() confirms the scanned
 * company IS the current golden one and claimed_at was still NULL.
 */
export async function markFeaturedBoothClaimed(itemId, type) {
  try {
    await ensureStateTable();
    const col = type === 'mission' ? 'mission_id' : 'badge_id';
    await query(
      `UPDATE quest_featured_booth_state SET claimed_at = NOW()
       WHERE ${col} = $1 AND claimed_at IS NULL`,
      [itemId]
    );
  } catch (err) {
    console.error('[featuredBoothHelper] markFeaturedBoothClaimed error:', err.message);
  }
}

/**
 * For the public API: returns { selected_at, rotation_hours } so the client can
 * compute "next rotation in N minutes" without revealing WHICH booth is current.
 */
export async function getFeaturedBoothCountdown(itemId, type) {
  try {
    await ensureStateTable();
    const col = type === 'mission' ? 'mission_id' : 'badge_id';
    const { rows } = await query(
      `SELECT selected_at FROM quest_featured_booth_state WHERE ${col} = $1`,
      [itemId]
    );
    return rows[0]?.selected_at ?? null;
  } catch {
    return null;
  }
}
