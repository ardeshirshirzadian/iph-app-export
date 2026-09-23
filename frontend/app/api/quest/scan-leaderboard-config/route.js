import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { query } from '@/lib/db';
import { getCurrentEventId } from '@/lib/currentEvent';

// Pure admin content (icon/label/color/leaderboard_limit) for the scan
// leaderboard segment/tab -- same split as
// app/api/quest/booth-leaderboard-config/route.js between "config used to
// LABEL a leaderboard tab" (here) and "live ranking data"
// (app/api/quest/leaderboard/route.js's ?segment=scans). Like the booths
// segment (and unlike referral), this one has no active/inactive gate --
// always shown, per the same "no mission-style on/off concept applies here"
// reasoning: a personal real-booth-scan count needs no feature flag.
const getCachedScanLeaderboardConfig = unstable_cache(
  async (currentEventId) => {
    const result = await query(
      "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'scan_leaderboard_config'",
      [currentEventId]
    );
    return result.rows[0]?.value ?? {};
  },
  ['scan-leaderboard-config'],
  { tags: ['scan-leaderboard-config'], revalidate: 300 }
);

export async function GET() {
  try {
    const currentEventId = await getCurrentEventId();
    const raw = await getCachedScanLeaderboardConfig(currentEventId);
    return NextResponse.json({
      active: true,
      config: {
        name_fa:           raw.name_fa || 'بازدید غرفه‌ها',
        name_en:           raw.name_en || 'Booth Visits',
        icon_type:         raw.icon_type || 'emoji',
        icon_value:        raw.icon_value || '🚶',
        icon_size:         raw.icon_size ?? 14,
        color:             raw.color || '#8b5cf6',
      },
    });
  } catch (e) {
    console.error('[quest/scan-leaderboard-config GET]', e.message);
    return NextResponse.json({ active: false, config: null });
  }
}
