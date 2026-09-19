import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { query } from '@/lib/db';
import { getCurrentEventId } from '@/lib/currentEvent';
import { getExpoScreenDisplay, DEFAULT_EXPO_SCREEN_CONFIG } from '@/lib/expoScreenConfig';
import { isUnlimitedReferralActive } from '@/lib/referralUnlimited';

// Public, unauthenticated, cached data for the exhibition kiosk screen
// (/expo) -- one combined endpoint (not several) so ExpoClient.jsx keeps a
// single poll loop: the kiosk is already polling on an interval anyway, so
// a second independent fetch loop just for occasionally-changing
// config/colors/title would be pure overhead for no benefit -- they ride
// along on the same request and simply get applied whenever they arrive.
//
// The two halves are still cached separately under the hood (see below):
// the leaderboard needs a short, load-driven revalidate window; the
// display data (config/colors/logo/rank-icons) only changes when an admin
// explicitly saves something, so it uses a long safety-net ceiling plus
// on-demand revalidateTag() from each relevant admin save handler.
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

// Same fallback trio app/quest/QuestClient.js's FALLBACK_LEVELS uses, for
// an event with no active quest_levels rows configured yet.
const FALLBACK_LEVELS = [
  { name_fa: 'تازه‌وارد', min_xp: 0, max_xp: 200, color: '#64748b' },
  { name_fa: 'کاوشگر', min_xp: 200, max_xp: 500, color: '#22c55e' },
  { name_fa: 'کاربلد', min_xp: 500, max_xp: null, color: '#f59e0b' },
];

// Mirrors QuestClient.js's getXpProgress()'s level-lookup half (not its
// pct/next progress half, unused here): first threshold whose [min_xp,
// max_xp) contains xp, max_xp null treated as +Infinity, falling back to
// the last threshold once xp exceeds every configured max_xp.
function levelForXp(xp, levels) {
  const idx = levels.findIndex((l) => xp >= l.min_xp && (l.max_xp === null || xp < l.max_xp));
  return levels[idx !== -1 ? idx : levels.length - 1];
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

    // Same gate the in-app leaderboard's referral_count column uses (see
    // quest/leaderboard/route.js's referralCountSelectFragment): the invite
    // count is only meaningful -- and only queried -- while an unlimited-
    // mode referral mission is actually active for this event.
    const referralActive = await isUnlimitedReferralActive(currentEventId);

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
         DENSE_RANK() OVER (ORDER BY c.total_xp DESC)::int AS rank${referralActive ? `,
         (SELECT COUNT(*)::int FROM quest_referral_redemptions rr
          WHERE rr.referrer_user_uuid = c.user_uuid AND rr.event_id = $1 AND rr.status = 'confirmed'
         ) AS referral_count` : ''}
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
      referral_count: row.referral_count ?? null,
    }));
  },
  ['expo-leaderboard-top3'],
  { tags: ['expo-leaderboard-top3'], revalidate: 5 }
);

// Level name/color per user are admin content (quest_levels), same as the
// in-app leaderboard's badge -- resolved from quest_levels, not computed in
// the ranking query above. Same 60s safety-net + tag convention as
// getCachedDisplay below; QuestClient's own /api/quest/levels route uses
// the identical revalidate/tag pair.
const getCachedLevels = unstable_cache(
  async (currentEventId) => {
    const { rows } = await query(
      `SELECT name_fa, min_xp, max_xp, color
       FROM quest_levels
       WHERE is_active = true AND event_id = $1
       ORDER BY sort_order ASC, min_xp ASC, id ASC`,
      [currentEventId]
    );
    return rows;
  },
  ['expo-levels'],
  { tags: ['quest-level-config'], revalidate: 60 }
);

// revalidate: 60 is a safety-net ceiling only (same convention as
// app/layout.js's getCachedActiveFont etc.) -- the real invalidation path is
// each relevant admin save handler calling revalidateIphApp(<tag>), which
// hits this app's /api/internal/revalidate -> revalidateTag(..., {expire:
// 0}), so a save reflects within seconds, not up to 60s. Tagged with every
// admin panel this composite reads from (expo screen's own config, theme
// colors, quest content's rank icons) so ANY of those saves -- not just the
// expo-screen tab's own -- invalidates this cache. header_logo uploads have
// no revalidateTag call anywhere in the app (app/api/header/route.js is
// plain force-dynamic/uncached, not tag-based), so a logo change here rides
// on the 60s ceiling alone, same as everywhere else that reads it.
const getCachedDisplay = unstable_cache(
  (currentEventId) => getExpoScreenDisplay(currentEventId),
  ['expo-screen-display'],
  { tags: ['expo-screen-config', 'layout-theme-colors', 'quest-content-blocks'], revalidate: 60 }
);

export async function GET() {
  try {
    const currentEventId = await getCurrentEventId();
    const [leaderboardRaw, display, levels] = await Promise.all([
      getCachedTop3(currentEventId),
      getCachedDisplay(currentEventId),
      getCachedLevels(currentEventId),
    ]);
    const levelSource = levels.length > 0 ? levels : FALLBACK_LEVELS;
    const leaderboard = leaderboardRaw.map((row) => {
      const level = levelForXp(row.total_xp, levelSource);
      return { ...row, level_name: level.name_fa, level_color: level.color };
    });
    return NextResponse.json({ leaderboard, ...display });
  } catch (err) {
    console.error('[GET /api/expo/screen]', err.message);
    return NextResponse.json({
      leaderboard: [],
      config: DEFAULT_EXPO_SCREEN_CONFIG,
      colors: { bg: '#021f20', rowBg: 'rgba(255,255,255,0.1)', text: '#ffffff', textMuted: 'rgba(255,255,255,0.5)', accent: '#00ffb3', border: 'rgba(255,255,255,0.1)' },
      logo: { path: '/logo/logo-l-fa.png', width: 4500, height: 1033 },
      rankIcons: { 1: { icon: '🥇', color: '#ffffff' }, 2: { icon: '🥈', color: '#ffffff' }, 3: { icon: '🥉', color: '#ffffff' } },
    });
  }
}
