import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { query } from '@/lib/db';
import { getCurrentEventId } from '@/lib/currentEvent';
import { getExpoScreenConfig, DEFAULT_EXPO_SCREEN_CONFIG } from '@/lib/expoScreenConfig';

// Public, unauthenticated, cached data for the exhibition kiosk screen
// (/expo) -- Phase 1 renames Phase 0's /api/expo/leaderboard to this, now
// that it also carries admin-configured display settings, not just the
// leaderboard. One combined endpoint (not two) so ExpoClient.jsx keeps a
// single poll loop: the kiosk is already polling on an interval anyway, so
// a second independent fetch loop just for occasionally-changing config
// would be pure overhead for no benefit -- the config rides along on the
// same request and simply gets applied whenever it arrives.
//
// The two halves are still cached separately under the hood (see below):
// the leaderboard needs a short, load-driven revalidate window; the config
// only changes when an admin explicitly saves, so it uses a long safety-net
// ceiling plus on-demand revalidateTag() from iph-apn's save handler.
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
//
// revalidate: 5 is a fixed floor independent of the admin's own
// poll_interval_seconds setting (which only controls how often the CLIENT
// fetches this endpoint, min 5s, enforced in iph-apn's PUT). Keeping the
// server cache's own floor fixed means the DB can never be hit more than
// once per 5s here no matter what any admin configures client-side -- two
// independent layers of protection, per the exhibition-screen investigation's
// "compute once, serve many" load section.
const getCachedTop3 = unstable_cache(
  async (currentEventId) => {
    console.log('[expo/screen] leaderboard cache miss — querying DB for event', currentEventId);
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
  { tags: ['expo-leaderboard-top3'], revalidate: 5 }
);

// revalidate: 60 is a safety-net ceiling only (same convention as
// app/layout.js's getCachedActiveFont etc.) -- the real invalidation path is
// iph-apn's PUT handler calling revalidateIphApp('expo-screen-config'),
// which hits this app's /api/internal/revalidate -> revalidateTag(...,
// {expire: 0}), so an admin's save reflects within seconds, not up to 60s.
const getCachedConfig = unstable_cache(
  (currentEventId) => getExpoScreenConfig(currentEventId),
  ['expo-screen-config'],
  { tags: ['expo-screen-config'], revalidate: 60 }
);

export async function GET() {
  try {
    const currentEventId = await getCurrentEventId();
    const [leaderboard, config] = await Promise.all([
      getCachedTop3(currentEventId),
      getCachedConfig(currentEventId),
    ]);
    return NextResponse.json({ leaderboard, config });
  } catch (err) {
    console.error('[GET /api/expo/screen]', err.message);
    return NextResponse.json({ leaderboard: [], config: DEFAULT_EXPO_SCREEN_CONFIG });
  }
}
