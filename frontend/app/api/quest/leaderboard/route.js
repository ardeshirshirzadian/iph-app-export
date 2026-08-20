import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { getCurrentEventId } from '@/lib/currentEvent';

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

function resolvePhotoUrl(profilePhotoUrl, profileImage, hideLeaderboardPhoto) {
  if (hideLeaderboardPhoto) return null;
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

async function getLeaderboardLimit(eventId) {
  try {
    const result = await query(
      "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'quest_settings'",
      [eventId]
    );
    const limit = parseInt(result.rows[0]?.value?.leaderboard_limit, 10);
    return Number.isFinite(limit) && limit >= 1 ? limit : 50;
  } catch {
    return 50;
  }
}

// Shared CTE that computes total XP per user, scoped to one event.
// event_id must always be bound as the query's FIRST parameter ($1) by every
// caller below -- quest_scans.event_id / quest_xp_grants.event_id are what
// keep two events' XP totals (and therefore rankings) from being summed
// together. quest_xp_grants itself has no unique constraint on event_id (see
// Tier 3 audit notes), so this filter is the only thing keeping it isolated.
const XP_CTE = `
  WITH scan_agg AS (
    SELECT user_uuid,
           SUM(xp_earned)::int AS xp,
           COUNT(*)::int       AS scan_count
    FROM quest_scans
    WHERE event_id = $1
    GROUP BY user_uuid
  ),
  grant_agg AS (
    SELECT user_uuid,
           SUM(xp_amount)::int AS xp
    FROM quest_xp_grants
    WHERE event_id = $1
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
`;

export async function GET(request) {
  const cookieStore = await cookies();
  const userRaw = cookieStore.get('iph_user')?.value;

  let currentUuid = null;
  try {
    const user = JSON.parse(decodeURIComponent(userRaw));
    currentUuid = user?.uuid || null;
  } catch {}

  const currentEventId = await getCurrentEventId();

  const { searchParams } = new URL(request.url);
  const levelParam = searchParams.get('level');
  const levelId = levelParam ? parseInt(levelParam, 10) : null;

  try {
    await ensureQuestUserNamesTable();

    // ── LEVEL SUB-LEADERBOARD ──────────────────────────────────────────────
    if (levelId && Number.isFinite(levelId)) {
      const { rows: levelRows } = await query(
        `SELECT min_xp, max_xp, leaderboard_limit FROM quest_levels WHERE id = $1 AND is_active = true AND event_id = $2`,
        [levelId, currentEventId]
      );
      if (levelRows.length === 0) {
        return NextResponse.json({ leaderboard: [], currentUser: null });
      }

      const { min_xp, max_xp, leaderboard_limit } = levelRows[0];
      const limit = (Number.isFinite(leaderboard_limit) && leaderboard_limit >= 1) ? leaderboard_limit : 20;
      const maxXpFilter = max_xp !== null && max_xp !== undefined;

      // event_id is always $1 (bound by XP_CTE itself); every param below is
      // shifted +1 to make room for it.
      const { rows: topRows } = await query(`
        ${XP_CTE},
        in_level AS (
          SELECT user_uuid, total_xp, scan_count
          FROM combined
          WHERE total_xp >= $2
            ${maxXpFilter ? 'AND total_xp < $3' : ''}
        ),
        ranked AS (
          SELECT user_uuid, total_xp, scan_count,
                 RANK() OVER (ORDER BY total_xp DESC)::int AS rank
          FROM in_level
        )
        SELECT
          r.user_uuid, r.total_xp, r.scan_count, r.rank,
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
          au.hide_leaderboard_photo
        FROM ranked r
        LEFT JOIN quest_user_names qn ON r.user_uuid = qn.user_uuid
        LEFT JOIN app_users        au ON r.user_uuid = au.uuid AND au.event_id = $1
        ORDER BY r.rank
        LIMIT $${maxXpFilter ? '4' : '3'}
      `, maxXpFilter ? [currentEventId, min_xp, max_xp, limit] : [currentEventId, min_xp, limit]);

      const leaderboard = topRows.map(row => ({
        rank:              row.rank,
        user_uuid:         row.user_uuid,
        display_name_fa:   row.display_name_fa,
        display_name_en:   row.display_name_en || null,
        total_xp:          row.total_xp,
        scan_count:        row.scan_count,
        profile_photo_url: resolvePhotoUrl(row.profile_photo_url, row.profile_image, row.hide_leaderboard_photo),
      }));

      // Current user's rank within this level
      let currentUser = null;
      if (currentUuid) {
        const { rows: rankRows } = await query(`
          ${XP_CTE},
          in_level AS (
            SELECT user_uuid, total_xp
            FROM combined
            WHERE total_xp >= $2
              ${maxXpFilter ? 'AND total_xp < $3' : ''}
          ),
          ranked AS (
            SELECT user_uuid, total_xp,
                   RANK() OVER (ORDER BY total_xp DESC)::int AS rank
            FROM in_level
          )
          SELECT r.rank, r.total_xp,
                 COALESCE(
                   qn.display_name_fa,
                   NULLIF(TRIM(COALESCE(au.firstname_fa, '') || ' ' || COALESCE(au.lastname_fa, '')), ''),
                   'شرکت‌کننده'
                 ) AS display_name_fa,
                 COALESCE(
                   qn.display_name_en,
                   NULLIF(TRIM(COALESCE(au.firstname_en, '') || ' ' || COALESCE(au.lastname_en, '')), '')
                 ) AS display_name_en,
                 qn.profile_photo_url, au.profile_image, au.hide_leaderboard_photo
          FROM ranked r
          LEFT JOIN quest_user_names qn ON r.user_uuid = qn.user_uuid
          LEFT JOIN app_users        au ON r.user_uuid = au.uuid AND au.event_id = $1
          WHERE r.user_uuid = $${maxXpFilter ? '4' : '3'}
        `, maxXpFilter ? [currentEventId, min_xp, max_xp, currentUuid] : [currentEventId, min_xp, currentUuid]);

        if (rankRows.length > 0) {
          currentUser = {
            user_uuid:         currentUuid,
            rank:              rankRows[0].rank,
            total_xp:          rankRows[0].total_xp,
            display_name_fa:   rankRows[0].display_name_fa,
            display_name_en:   rankRows[0].display_name_en || null,
            profile_photo_url: resolvePhotoUrl(rankRows[0].profile_photo_url, rankRows[0].profile_image, rankRows[0].hide_leaderboard_photo),
          };
        }
      }

      return NextResponse.json({ leaderboard, currentUser });
    }

    // ── OVERALL LEADERBOARD (original behavior) ────────────────────────────
    const limit = await getLeaderboardLimit(currentEventId);

    const { rows: leaderboardRows } = await query(`
      ${XP_CTE}
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
        au.hide_leaderboard_photo,
        c.total_xp,
        c.scan_count
      FROM combined c
      LEFT JOIN quest_user_names qn ON c.user_uuid = qn.user_uuid
      LEFT JOIN app_users        au ON c.user_uuid = au.uuid AND au.event_id = $1
      ORDER BY c.total_xp DESC
      LIMIT $2
    `, [currentEventId, limit]);

    const leaderboard = leaderboardRows.map((row, idx) => ({
      rank:              idx + 1,
      user_uuid:         row.user_uuid,
      display_name_fa:   row.display_name_fa,
      display_name_en:   row.display_name_en || null,
      total_xp:          row.total_xp,
      scan_count:        row.scan_count,
      profile_photo_url: resolvePhotoUrl(row.profile_photo_url, row.profile_image, row.hide_leaderboard_photo),
    }));

    // Current user's overall rank (may be outside top-N)
    let currentUser = null;
    if (currentUuid) {
      const { rows: rankRows } = await query(`
        WITH combined AS (
          SELECT user_uuid, xp_earned AS xp FROM quest_scans WHERE event_id = $1
          UNION ALL
          SELECT user_uuid, xp_amount AS xp FROM quest_xp_grants WHERE event_id = $1
        ),
        ranked AS (
          SELECT
            user_uuid,
            SUM(xp)::int                               AS total_xp,
            RANK() OVER (ORDER BY SUM(xp) DESC)::int   AS rank
          FROM combined
          GROUP BY user_uuid
        )
        SELECT r.rank, r.total_xp, qn.profile_photo_url, au.profile_image, au.hide_leaderboard_photo
        FROM ranked r
        LEFT JOIN quest_user_names qn ON r.user_uuid = qn.user_uuid
        LEFT JOIN app_users        au ON r.user_uuid = au.uuid AND au.event_id = $1
        WHERE r.user_uuid = $2
      `, [currentEventId, currentUuid]);

      if (rankRows.length > 0) {
        currentUser = {
          user_uuid:         currentUuid,
          rank:              rankRows[0].rank,
          total_xp:          rankRows[0].total_xp,
          profile_photo_url: resolvePhotoUrl(rankRows[0].profile_photo_url, rankRows[0].profile_image, rankRows[0].hide_leaderboard_photo),
        };
      }
    }

    return NextResponse.json({ leaderboard, currentUser });
  } catch (err) {
    console.error('[quest/leaderboard]', err.message);
    return NextResponse.json({ leaderboard: [], currentUser: null });
  }
}
