import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

const RASAYESH_BASE = 'https://api.rasayesh.com/';

async function ensureQuestUserNamesTable() {
  if (globalThis._questUserNamesReady) return;
  await query(`
    CREATE TABLE IF NOT EXISTS quest_user_names (
      user_uuid         VARCHAR(100) PRIMARY KEY,
      display_name_fa   VARCHAR(200),
      display_name_en   VARCHAR(200),
      updated_at        TIMESTAMP DEFAULT NOW()
    )
  `);
  await query(`ALTER TABLE quest_user_names ADD COLUMN IF NOT EXISTS profile_photo_url VARCHAR(500)`);
  globalThis._questUserNamesReady = true;
}

function resolvePhotoUrl(profilePhotoUrl, profileImage) {
  if (profilePhotoUrl) {
    return profilePhotoUrl.startsWith('http') ? profilePhotoUrl : RASAYESH_BASE + profilePhotoUrl;
  }
  if (profileImage) {
    const raw = typeof profileImage === 'string' ? profileImage : null;
    if (raw && raw.startsWith('/')) return RASAYESH_BASE + raw;
    if (raw && raw.startsWith('http')) return raw;
  }
  return null;
}

async function getLeaderboardLimit() {
  try {
    const result = await query("SELECT value FROM app_settings WHERE key = 'quest_settings'");
    const limit = parseInt(result.rows[0]?.value?.leaderboard_limit, 10);
    return Number.isFinite(limit) && limit >= 1 ? limit : 50;
  } catch {
    return 50;
  }
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
    const limit = await getLeaderboardLimit();

    // Top-N leaderboard with name + photo resolution.
    // XP = quest_scans.xp_earned (scan-based) + quest_xp_grants.xp_amount (quiz/survey).
    // Users who only earned XP via grants (no scans) still appear via FULL OUTER JOIN.
    const { rows: leaderboardRows } = await query(`
      WITH scan_agg AS (
        SELECT user_uuid,
               SUM(xp_earned)::int AS xp,
               COUNT(*)::int       AS scan_count
        FROM quest_scans
        GROUP BY user_uuid
      ),
      grant_agg AS (
        SELECT user_uuid,
               SUM(xp_amount)::int AS xp
        FROM quest_xp_grants
        GROUP BY user_uuid
      ),
      combined AS (
        SELECT
          COALESCE(s.user_uuid, g.user_uuid)      AS user_uuid,
          COALESCE(s.xp, 0) + COALESCE(g.xp, 0)  AS total_xp,
          COALESCE(s.scan_count, 0)                AS scan_count
        FROM scan_agg s
        FULL OUTER JOIN grant_agg g ON s.user_uuid = g.user_uuid
      )
      SELECT
        c.user_uuid,
        COALESCE(
          qn.display_name_fa,
          NULLIF(TRIM(COALESCE(au.firstname_fa, '') || ' ' || COALESCE(au.lastname_fa, '')), ''),
          'شرکت‌کننده'
        ) AS display_name_fa,
        COALESCE(
          qn.display_name_en,
          NULLIF(TRIM(COALESCE(au.firstname_en, '') || ' ' || COALESCE(au.lastname_en, '')), '')
        ) AS display_name_en,
        qn.profile_photo_url,
        au.profile_image,
        c.total_xp,
        c.scan_count
      FROM combined c
      LEFT JOIN quest_user_names qn ON c.user_uuid = qn.user_uuid
      LEFT JOIN app_users        au ON c.user_uuid = au.uuid
      ORDER BY c.total_xp DESC
      LIMIT $1
    `, [limit]);

    const leaderboard = leaderboardRows.map((row, idx) => ({
      rank:              idx + 1,
      user_uuid:         row.user_uuid,
      display_name_fa:   row.display_name_fa,
      display_name_en:   row.display_name_en || null,
      total_xp:          row.total_xp,
      scan_count:        row.scan_count,
      profile_photo_url: resolvePhotoUrl(row.profile_photo_url, row.profile_image),
    }));

    // Current user's rank, XP, and photo (may be outside top-N)
    let currentUser = null;
    if (currentUuid) {
      const { rows: rankRows } = await query(`
        WITH combined AS (
          SELECT user_uuid, xp_earned AS xp FROM quest_scans
          UNION ALL
          SELECT user_uuid, xp_amount AS xp FROM quest_xp_grants
        ),
        ranked AS (
          SELECT
            user_uuid,
            SUM(xp)::int                               AS total_xp,
            RANK() OVER (ORDER BY SUM(xp) DESC)::int   AS rank
          FROM combined
          GROUP BY user_uuid
        )
        SELECT r.rank, r.total_xp, qn.profile_photo_url, au.profile_image
        FROM ranked r
        LEFT JOIN quest_user_names qn ON r.user_uuid = qn.user_uuid
        LEFT JOIN app_users        au ON r.user_uuid = au.uuid
        WHERE r.user_uuid = $1
      `, [currentUuid]);

      if (rankRows.length > 0) {
        currentUser = {
          user_uuid:         currentUuid,
          rank:              rankRows[0].rank,
          total_xp:          rankRows[0].total_xp,
          profile_photo_url: resolvePhotoUrl(rankRows[0].profile_photo_url, rankRows[0].profile_image),
        };
      }
    }

    return NextResponse.json({ leaderboard, currentUser });
  } catch (err) {
    console.error('[quest/leaderboard]', err.message);
    return NextResponse.json({ leaderboard: [], currentUser: null });
  }
}
