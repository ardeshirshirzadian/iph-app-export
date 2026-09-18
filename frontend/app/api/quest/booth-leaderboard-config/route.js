import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { query } from '@/lib/db';
import { getCurrentEventId } from '@/lib/currentEvent';

// Pure admin content (icon/label/color/leaderboard_limit) for the booth
// leaderboard segment/tab -- same split as
// app/api/quest/referral-leaderboard-config/route.js between "config used
// to LABEL a leaderboard tab" (here) and "live ranking data"
// (app/api/quest/leaderboard/route.js's ?segment=booths). Unlike the
// referral segment, this one has no active/inactive gate -- it's always
// shown, per Ardeshir's explicit decision (no mission-style "is this even
// on" concept applies to a company scan-count ranking).
const getCachedBoothLeaderboardConfig = unstable_cache(
  async (currentEventId) => {
    const result = await query(
      "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'booth_leaderboard_config'",
      [currentEventId]
    );
    return result.rows[0]?.value ?? {};
  },
  ['booth-leaderboard-config'],
  { tags: ['booth-leaderboard-config'], revalidate: 300 }
);

export async function GET() {
  try {
    const currentEventId = await getCurrentEventId();
    const raw = await getCachedBoothLeaderboardConfig(currentEventId);
    return NextResponse.json({
      active: true,
      config: {
        name_fa:           raw.name_fa || 'غرفه‌ها',
        name_en:           raw.name_en || 'Booths',
        icon_type:         raw.icon_type || 'emoji',
        icon_value:        raw.icon_value || '🏭',
        icon_size:         raw.icon_size ?? 14,
        color:             raw.color || '#10b981',
      },
    });
  } catch (e) {
    console.error('[quest/booth-leaderboard-config GET]', e.message);
    return NextResponse.json({ active: false, config: null });
  }
}
