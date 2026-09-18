import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { query } from '@/lib/db';
import { getCurrentEventId } from '@/lib/currentEvent';

// Public, unauthenticated, cached top-3 leaderboard for the exhibition kiosk
// screen (/expo). Unlike quest/leaderboard/route.js, this has no per-user
// concept at all -- every physical screen shows the same top 3, so the
// result is wrapped in unstable_cache keyed by event_id with a short
// revalidate window. This is the "compute once, serve many" fix the
// investigation called for: an unbounded number of always-on kiosk screens
// polling this endpoint must not turn into that many DENSE_RANK() aggregate
// queries against quest_scans/quest_xp_grants -- with revalidate below, the
// query runs at most once per window per container process (3 containers ->
// worst case 3 real executions per window, regardless of screen count).
export const dynamic = 'force-dynamic';

const RASAYESH_BASE = 'https://api.rasayesh.com/';

// Same resolution rule as quest/leaderboard/route.js's resolvePhotoUrl --
// duplicated here (not imported) so this public/cached endpoint never risks
// touching that already-tested authenticated route. Keep in sync if that
// logic ever changes, same manual-sync convention already used between
// ReferralShareCanvas.jsx's two repo copies.
function resolvePhotoUrl(profilePhotoUrl, profileImage, hideLeaderboardPhoto) {
  if (hideLeaderboardPhoto) return null;
  if (profileImage) {
    const raw = typeof profileImage === 'string' ? profileImage : null;
    if (raw && raw.startsWith('/')) return RASAYESH_BASE + raw;
    if (raw && raw.startsWith('http')) return raw;
  }
  if (profilePhotoUrl) {
    return profilePhotoUrl.startsWith('http') ? profilePhotoUrl : RASAYESH_BASE + profilePhotoUrl;
  }
  return null;
}

// Mirrors quest/leaderboard/route.js's "OVERALL LEADERBOARD" branch: same
// XP_CTE shape, same DENSE_RANK() (not RANK()) tie-breaking convention, same
// exclusion filter (au.excluded_from_leaderboard). Copied rather than
// imported for the same isolation reason as resolvePhotoUrl above. If the
// ranking rules there ever change, mirror the change here too.
const getCachedTop3 = unstable_cache(
  async (currentEventId) => {
    console.log('[expo/leaderboard] cache miss — querying DB for event', currentEventId);
    const { rows } = await query(
      `WITH scan_agg AS (
         SELECT user_uuid, SUM(xp_earned)::int AS xp, COUNT(*)::int AS scan_count
         FROM quest_scans WHERE event_id = $1 GROUP BY user_uuid
       ),
       grant_agg AS (
         SELECT user_uuid, SUM(xp_amount)::int AS xp
         FROM quest_xp_grants WHERE event_id = $1 GROUP BY user_uuid
       ),
       combined AS (
         SELECT COALESCE(s.user_uuid, g.user_uuid)      AS user_uuid,
                COALESCE(s.xp, 0) + COALESCE(g.xp, 0)    AS total_xp,
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
         qn.profile_photo_url, au.profile_image, au.hide_leaderboard_photo,
         c.total_xp, c.scan_count,
         DENSE_RANK() OVER (ORDER BY c.total_xp DESC)::int AS rank
       FROM combined c
       LEFT JOIN quest_user_names qn ON c.user_uuid = qn.user_uuid
       LEFT JOIN app_users        au ON c.user_uuid = au.uuid AND au.event_id = $1
       WHERE (au.excluded_from_leaderboard IS NOT TRUE)
       ORDER BY c.total_xp DESC, c.user_uuid ASC
       LIMIT 3`,
      [currentEventId]
    );

    return rows.map((row) => ({
      rank: row.rank,
      user_uuid: row.user_uuid,
      display_name_fa: row.display_name_fa,
      display_name_en: row.display_name_en || null,
      total_xp: row.total_xp,
      profile_photo_url: resolvePhotoUrl(row.profile_photo_url, row.profile_image, row.hide_leaderboard_photo),
    }));
  },
  ['expo-leaderboard-top3'],
  { tags: ['expo-leaderboard-top3'], revalidate: 8 }
);

export async function GET() {
  try {
    const currentEventId = await getCurrentEventId();
    const leaderboard = await getCachedTop3(currentEventId);
    return NextResponse.json({ leaderboard });
  } catch (err) {
    console.error('[GET /api/expo/leaderboard]', err.message);
    return NextResponse.json({ leaderboard: [] });
  }
}
