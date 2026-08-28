import { query } from './db';

// Observability only -- never changes what a caller reads or writes.
//
// companies_placement rows carry their own literal rasayesh_event_id, set
// whenever a company was last synced by iph-apn's companies/sync route. If a
// local event's companies_config.event_id target moves (annual rollover) and
// some companies_placement rows don't get re-synced to the new target --
// either because sync hasn't run yet, or because those companies are no
// longer part of the new year's Rasayesh roster at all -- every
// rasayesh_event_id-filtered read (this file's quest/booths route) silently
// excludes them with no error, no empty-state hint, nothing. This just logs
// when that split exists so it shows up in logs instead of only being
// discoverable by manually diffing row counts, as happened investigating the
// original bug report.
export async function logRasayeshDriftIfAny(currentEventId, targetRasayeshEventId, context) {
  try {
    const { rows } = await query(
      `SELECT rasayesh_event_id, COUNT(*)::int AS cnt
       FROM companies_placement
       WHERE event_id = $1 AND hall_name IS NOT NULL AND booth_uuid IS NOT NULL
       GROUP BY rasayesh_event_id`,
      [currentEventId]
    );
    if (rows.length > 1) {
      const target = Number(targetRasayeshEventId);
      const stale = rows.filter((r) => Number(r.rasayesh_event_id) !== target);
      console.warn(
        `[rasayesh-drift] ${context}: event_id=${currentEventId} target rasayesh_event_id=${target} -- ` +
        `${rows.length} distinct rasayesh_event_id groups among quest-eligible companies_placement rows, ` +
        `stale: ${stale.map((r) => `${r.rasayesh_event_id}:${r.cnt}`).join(', ')} ` +
        `(silently excluded from every rasayesh_event_id-filtered read)`
      );
    }
  } catch (err) {
    console.error('[rasayesh-drift] check failed:', err.message);
  }
}
