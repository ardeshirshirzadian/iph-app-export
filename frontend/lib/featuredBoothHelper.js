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
  globalThis._featuredBoothStateTableReady = true;
}

/**
 * Lazily ensure the current golden booth for a featured_booth mission or badge.
 *
 * Called at scan time so no cron job is needed.  If no state row exists, or the
 * existing row is older than `rotation_hours`, a new company is randomly picked
 * from the pool and the state is updated.  Repeats are intentionally allowed.
 *
 * Returns the current_company_id (integer), or null if pool is empty / table error.
 */
export async function ensureFeaturedBoothState(item, type) {
  // item: { id, featured_booth_pool: int[], featured_booth_rotation_hours: int }
  // type: 'mission' | 'badge'
  const pool = item.featured_booth_pool;
  if (!Array.isArray(pool) || pool.length === 0) return null;

  try {
    await ensureStateTable();

    const col  = type === 'mission' ? 'mission_id' : 'badge_id';
    const rotationMs = Math.max(1, item.featured_booth_rotation_hours ?? 1) * 3_600_000;

    const { rows } = await query(
      `SELECT current_company_id, selected_at
       FROM quest_featured_booth_state WHERE ${col} = $1`,
      [item.id]
    );

    const now       = Date.now();
    const isStale   = rows.length === 0 ||
      now - new Date(rows[0].selected_at).getTime() >= rotationMs;

    if (!isStale) return rows[0].current_company_id;

    // Pick a genuinely random company from the pool (repeats allowed per spec).
    const newCompanyId = pool[Math.floor(Math.random() * pool.length)];

    if (rows.length === 0) {
      // No row yet — INSERT (race-safe: ON CONFLICT DO NOTHING, then re-read)
      await query(
        `INSERT INTO quest_featured_booth_state (${col}, current_company_id, selected_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT DO NOTHING`,
        [item.id, newCompanyId]
      );
    } else {
      // Stale — UPDATE only if still stale (guard against race)
      await query(
        `UPDATE quest_featured_booth_state
         SET current_company_id = $2, selected_at = NOW()
         WHERE ${col} = $1
           AND selected_at <= NOW() - ($3 * INTERVAL '1 millisecond')`,
        [item.id, newCompanyId, rotationMs]
      );
    }

    // Re-read the authoritative value (another process may have written first)
    const { rows: after } = await query(
      `SELECT current_company_id FROM quest_featured_booth_state WHERE ${col} = $1`,
      [item.id]
    );
    return after[0]?.current_company_id ?? null;

  } catch (err) {
    console.error('[featuredBoothHelper] ensureFeaturedBoothState error:', err.message);
    return null;
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
