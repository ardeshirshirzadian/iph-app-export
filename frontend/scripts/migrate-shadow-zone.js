/**
 * One-off migration: add blocking zone for the shadow region between wall
 * polygon id=1's right-side boundary and Zone 1 ("Executive Organizing Committee").
 *
 * Context: The area at approximately x=3772-4062, y=1100-1354 (in bare_plan SVG
 * coordinates) is physically inaccessible at the venue.  Pathfinding was routing
 * through it because it lies outside the wall polygon (pip=false) but inside its
 * visual bounding box — a concave-exterior "shadow" the PIP-only wall blocker
 * misses.  The fix is a data-level blocking zone whose inner boundary exactly
 * follows the wall polygon's right-side segments (seg1–seg5).
 *
 * Zone polygon derivation:
 *   - Top-left  : wall polygon seg0→seg1 junction (3772,1132), extended to y=1100
 *                 to also cover cells at cy=1110 that squeezed above the junction
 *   - Top-right : x=4062 (wall polygon seg5 endpoint x), y=1100
 *   - Right edge: x=4062 from y=1100 down to y=1354 (seg5 endpoint y)
 *   - Inner wall: trace wall polygon seg4→seg5 junction (4023,1342),
 *                 seg3→seg4 junction (4020,1308), seg2→seg3 junction (3911,1187),
 *                 seg1→seg2 junction (3819,1187), seg0→seg1 junction (3772,1132)
 *
 * Run once from frontend/:
 *   node scripts/migrate-shadow-zone.js
 */

const { query } = require('../lib/db.js');

const ZONE = {
  title_fa: 'منطقه مسدود (سایه دیوار)',
  title_en: 'Blocked Shadow Region (Wall Concavity)',
  hall_name: null,
  shape_type: 'polygon',
  is_blocking: true,
  is_active: true,
  points: [
    { x: 3772, y: 1100 },
    { x: 4062, y: 1100 },
    { x: 4062, y: 1354 },
    { x: 4023, y: 1342 },
    { x: 4020, y: 1308 },
    { x: 3911, y: 1187 },
    { x: 3819, y: 1187 },
    { x: 3772, y: 1132 },
  ],
};

async function main() {
  // Guard: skip if a zone with this English title already exists
  const existing = await query(
    `SELECT id FROM map_zones WHERE title_en = $1`,
    [ZONE.title_en]
  );
  if (existing.rows.length > 0) {
    console.log(`Zone already exists (id=${existing.rows[0].id}), skipping.`);
    process.exit(0);
  }

  const result = await query(
    `INSERT INTO map_zones (title_fa, title_en, hall_name, shape_type, is_blocking, is_active, points)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      ZONE.title_fa,
      ZONE.title_en,
      ZONE.hall_name,
      ZONE.shape_type,
      ZONE.is_blocking,
      ZONE.is_active,
      JSON.stringify(ZONE.points),
    ]
  );

  const newId = result.rows[0].id;
  console.log(`Created blocking zone id=${newId}: "${ZONE.title_en}"`);
  console.log(`Points: ${JSON.stringify(ZONE.points)}`);
  console.log('Done.');
  process.exit(0);
}

main().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
