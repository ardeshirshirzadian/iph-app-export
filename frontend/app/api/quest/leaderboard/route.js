import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

async function ensureQuestUserNamesTable() {
  if (globalThis._questUserNamesReady) return;
  await query(`
    CREATE TABLE IF NOT EXISTS quest_user_names (
      user_uuid       VARCHAR(100) PRIMARY KEY,
      display_name_fa VARCHAR(200),
      display_name_en VARCHAR(200),
      updated_at      TIMESTAMP DEFAULT NOW()
    )
  `);
  globalThis._questUserNamesReady = true;
}

export async function GET() {
  const cookieStore = await cookies();
  const userRaw = cookieStore.get('iph_user')?.value;

  let currentUuid = null;
  try {
    const user = JSON.parse(decodeURIComponent(userRaw));
    currentUuid = user?.uuid || null;
  } catch {}

  try {
    await ensureQuestUserNamesTable();

    // Top-50 leaderboard with name resolution:
    //   1st priority: quest_user_names (populated at scan time, always fresh)
    //   2nd priority: app_users (populated at login, covers old scan data)
    //   3rd priority: generic "شرکت‌کننده" label
    const { rows: leaderboardRows } = await query(`
      SELECT
        qs.user_uuid,
        COALESCE(
          qn.display_name_fa,
          NULLIF(TRIM(COALESCE(au.firstname_fa, '') || ' ' || COALESCE(au.lastname_fa, '')), ''),
          'شرکت‌کننده'
        ) AS display_name_fa,
        COALESCE(
          qn.display_name_en,
          NULLIF(TRIM(COALESCE(au.firstname_en, '') || ' ' || COALESCE(au.lastname_en, '')), '')
        ) AS display_name_en,
        SUM(qs.xp_earned)::int AS total_xp,
        COUNT(*)::int          AS scan_count
      FROM quest_scans qs
      LEFT JOIN quest_user_names qn ON qs.user_uuid = qn.user_uuid
      LEFT JOIN app_users        au ON qs.user_uuid = au.uuid
      GROUP BY
        qs.user_uuid,
        qn.display_name_fa, qn.display_name_en,
        au.firstname_fa, au.lastname_fa, au.firstname_en, au.lastname_en
      ORDER BY total_xp DESC
      LIMIT 50
    `);

    const leaderboard = leaderboardRows.map((row, idx) => ({
      rank:            idx + 1,
      user_uuid:       row.user_uuid,
      display_name_fa: row.display_name_fa,
      display_name_en: row.display_name_en || null,
      total_xp:        row.total_xp,
      scan_count:      row.scan_count,
    }));

    // Current user's rank and XP (may be outside top 50)
    let currentUser = null;
    if (currentUuid) {
      const { rows: rankRows } = await query(`
        WITH ranked AS (
          SELECT
            user_uuid,
            SUM(xp_earned)::int                               AS total_xp,
            RANK() OVER (ORDER BY SUM(xp_earned) DESC)::int  AS rank
          FROM quest_scans
          GROUP BY user_uuid
        )
        SELECT rank, total_xp FROM ranked WHERE user_uuid = $1
      `, [currentUuid]);

      if (rankRows.length > 0) {
        currentUser = {
          user_uuid: currentUuid,
          rank:      rankRows[0].rank,
          total_xp:  rankRows[0].total_xp,
        };
      }
    }

    return NextResponse.json({ leaderboard, currentUser });
  } catch (err) {
    console.error('[quest/leaderboard]', err.message);
    return NextResponse.json({ leaderboard: [], currentUser: null });
  }
}
