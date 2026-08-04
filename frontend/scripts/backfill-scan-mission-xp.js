// Backfill: grant missing quest_xp_grants rows for scan-triggered missions
// (booth_scan, hall_scan, special_booth) that were completed before the
// scan route was fixed to insert into quest_xp_grants.
//
// Safe to re-run: ON CONFLICT DO NOTHING prevents double-grants.
// DO NOT run this automatically — Ardeshir must confirm first.
// Preview counts are printed before any writes; pass --run to apply.

const { Pool } = require('pg');

const DRY_RUN = !process.argv.includes('--run');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  if (DRY_RUN) {
    console.log('DRY RUN — pass --run to apply grants\n');
  } else {
    console.log('APPLYING grants...\n');
  }

  // ── booth_scan missions ────────────────────────────────────────────────────
  const { rows: boothMissions } = await pool.query(`
    SELECT id, title_fa, xp_reward, total
    FROM quest_content
    WHERE is_active = true AND mission_type = 'booth_scan' AND xp_reward > 0
  `);

  for (const m of boothMissions) {
    // Users whose total scan count meets or exceeds this mission's threshold
    const { rows: eligible } = await pool.query(`
      SELECT qs.user_uuid, COUNT(*) AS total_scans
      FROM quest_scans qs
      GROUP BY qs.user_uuid
      HAVING COUNT(*) >= $1
    `, [m.total]);

    // How many already have the grant?
    const { rows: existing } = await pool.query(`
      SELECT COUNT(*) AS cnt FROM quest_xp_grants
      WHERE source_type = 'mission_booth_scan' AND source_id = $1
    `, [m.id]);

    const missing = eligible.length - parseInt(existing[0].cnt, 10);
    console.log(`booth_scan mission ${m.id} (${m.title_fa}): ${eligible.length} eligible, ${existing[0].cnt} already granted, ${missing} to backfill`);

    if (!DRY_RUN && eligible.length > 0) {
      const { rowCount } = await pool.query(`
        INSERT INTO quest_xp_grants (user_uuid, source_type, source_id, xp_amount)
        SELECT qs.user_uuid, 'mission_booth_scan', $1, $2
        FROM quest_scans qs
        GROUP BY qs.user_uuid
        HAVING COUNT(*) >= $3
        ON CONFLICT (user_uuid, source_type, source_id) DO NOTHING
      `, [m.id, m.xp_reward, m.total]);
      console.log(`  → Inserted ${rowCount} grant(s)`);
    }
  }

  // ── hall_scan missions ─────────────────────────────────────────────────────
  const { rows: hallMissions } = await pool.query(`
    SELECT id, title_fa, xp_reward, total, target_hall_name, hall_match_mode
    FROM quest_content
    WHERE is_active = true AND mission_type = 'hall_scan' AND xp_reward > 0
  `);

  for (const m of hallMissions) {
    if (!m.target_hall_name) continue;

    // Compute per-user scan count in the target hall
    const condition = m.hall_match_mode === 'any'
      ? `COUNT(DISTINCT qs.company_id) >= 1`
      : `COUNT(DISTINCT qs.company_id) >= ${m.total}`;

    const { rows: eligible } = await pool.query(`
      SELECT qs.user_uuid, COUNT(DISTINCT qs.company_id) AS hall_scans
      FROM quest_scans qs
      JOIN companies c ON c.id = qs.company_id
      WHERE c.hall_name = $1
      GROUP BY qs.user_uuid
      HAVING ${condition}
    `, [m.target_hall_name]);

    const { rows: existing } = await pool.query(`
      SELECT COUNT(*) AS cnt FROM quest_xp_grants
      WHERE source_type = 'mission_hall_scan' AND source_id = $1
    `, [m.id]);

    const missing = eligible.length - parseInt(existing[0].cnt, 10);
    console.log(`hall_scan mission ${m.id} (${m.title_fa}): ${eligible.length} eligible, ${existing[0].cnt} already granted, ${missing} to backfill`);

    if (!DRY_RUN && eligible.length > 0) {
      const { rowCount } = await pool.query(`
        INSERT INTO quest_xp_grants (user_uuid, source_type, source_id, xp_amount)
        SELECT qs.user_uuid, 'mission_hall_scan', $1, $2
        FROM quest_scans qs
        JOIN companies c ON c.id = qs.company_id
        WHERE c.hall_name = $3
        GROUP BY qs.user_uuid
        HAVING ${condition}
        ON CONFLICT (user_uuid, source_type, source_id) DO NOTHING
      `, [m.id, m.xp_reward, m.target_hall_name]);
      console.log(`  → Inserted ${rowCount} grant(s)`);
    }
  }

  // ── special_booth missions ─────────────────────────────────────────────────
  const { rows: specialMissions } = await pool.query(`
    SELECT id, title_fa, xp_reward, target_company_id
    FROM quest_content
    WHERE is_active = true AND mission_type = 'special_booth' AND xp_reward > 0
      AND target_company_id IS NOT NULL
  `);

  for (const m of specialMissions) {
    const { rows: eligible } = await pool.query(`
      SELECT DISTINCT user_uuid FROM quest_scans WHERE company_id = $1
    `, [m.target_company_id]);

    const { rows: existing } = await pool.query(`
      SELECT COUNT(*) AS cnt FROM quest_xp_grants
      WHERE source_type = 'mission_special_booth' AND source_id = $1
    `, [m.id]);

    const missing = eligible.length - parseInt(existing[0].cnt, 10);
    console.log(`special_booth mission ${m.id} (${m.title_fa}): ${eligible.length} eligible, ${existing[0].cnt} already granted, ${missing} to backfill`);

    if (!DRY_RUN && eligible.length > 0) {
      const { rowCount } = await pool.query(`
        INSERT INTO quest_xp_grants (user_uuid, source_type, source_id, xp_amount)
        SELECT DISTINCT user_uuid, 'mission_special_booth', $1, $2
        FROM quest_scans WHERE company_id = $3
        ON CONFLICT (user_uuid, source_type, source_id) DO NOTHING
      `, [m.id, m.xp_reward, m.target_company_id]);
      console.log(`  → Inserted ${rowCount} grant(s)`);
    }
  }

  await pool.end();
  console.log('\nDone.');
}

main().catch(e => { console.error(e.message); process.exit(1); });
