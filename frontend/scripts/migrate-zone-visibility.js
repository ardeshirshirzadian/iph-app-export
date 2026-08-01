/**
 * One-off migration: add is_visible column to map_zones and mark the
 * "Blocked Shadow Region (Wall Concavity)" zone as invisible on the public map.
 *
 * Context: is_visible=false zones still block pathfinding (is_blocking is
 * unchanged) but are not drawn on the public 2D/3D map and do not appear in
 * search results.  This lets structural blocking zones exist as pure
 * pathfinding corrections without confusing end-users.
 *
 * Run once from frontend/:
 *   node scripts/migrate-zone-visibility.js
 */

const { query } = require('../lib/db.js');

async function main() {
  // Step 1: add column (idempotent)
  await query(`
    ALTER TABLE map_zones
    ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT true
  `);
  console.log('Column is_visible ensured (default true — existing zones unchanged).');

  // Step 2: mark the shadow zone as invisible
  const result = await query(
    `UPDATE map_zones SET is_visible = false
     WHERE title_en = $1
     RETURNING id, title_en, is_visible`,
    ['Blocked Shadow Region (Wall Concavity)']
  );

  if (result.rows.length === 0) {
    console.log('Shadow zone not found — nothing updated (already missing or different title_en).');
  } else {
    const { id, is_visible } = result.rows[0];
    console.log(`Shadow zone id=${id} updated: is_visible=${is_visible}`);
  }

  // Step 3: verify all other zones still have is_visible = true (or NULL, which defaults to true)
  const others = await query(
    `SELECT id, title_en, is_visible FROM map_zones
     WHERE title_en != $1 AND is_visible IS DISTINCT FROM true`,
    ['Blocked Shadow Region (Wall Concavity)']
  );
  if (others.rows.length > 0) {
    console.warn('Warning: some other zones have is_visible != true:', others.rows);
  } else {
    console.log('All other zones confirmed is_visible = true (or NULL / default).');
  }

  console.log('Done.');
  process.exit(0);
}

main().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
