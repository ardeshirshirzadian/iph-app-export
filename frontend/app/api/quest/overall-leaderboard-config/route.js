import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { query } from '@/lib/db';
import { getCurrentEventId } from '@/lib/currentEvent';

// Pure admin content (icon/label/color) for the کلی (overall) leaderboard
// segment/tab -- same split as app/api/quest/referral-leaderboard-config
// and app/api/quest/booth-leaderboard-config between "config used to LABEL
// a leaderboard tab" (here) and "live ranking data" (app/api/quest/
// leaderboard/route.js's default/no-segment branch). No leaderboard_limit
// field here (unlike the other two) -- کلی's display count is the
// pre-existing quest_settings.leaderboard_limit, read directly by
// getLeaderboardLimit() in leaderboard/route.js, untouched by this route.
// Always active:true, same as booth-leaderboard-config -- کلی has no
// mission-style on/off gate, it's always the default tab.
const getCachedOverallLeaderboardConfig = unstable_cache(
  async (currentEventId) => {
    const result = await query(
      "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'overall_leaderboard_config'",
      [currentEventId]
    );
    return result.rows[0]?.value ?? {};
  },
  ['overall-leaderboard-config'],
  { tags: ['overall-leaderboard-config'], revalidate: 300 }
);

export async function GET() {
  try {
    const currentEventId = await getCurrentEventId();
    const raw = await getCachedOverallLeaderboardConfig(currentEventId);
    return NextResponse.json({
      active: true,
      config: {
        name_fa:    raw.name_fa || 'کلی',
        name_en:    raw.name_en || 'Overall',
        icon_type:  raw.icon_type || 'emoji',
        icon_value: raw.icon_value || '🏆',
        icon_size:  raw.icon_size ?? 14,
        color:      raw.color || '#f59e0b',
      },
    });
  } catch (e) {
    console.error('[quest/overall-leaderboard-config GET]', e.message);
    return NextResponse.json({ active: false, config: null });
  }
}
