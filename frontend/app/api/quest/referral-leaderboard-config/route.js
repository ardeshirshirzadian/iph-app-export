import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { query } from '@/lib/db';
import { getCurrentEventId } from '@/lib/currentEvent';
import { isUnlimitedReferralActive } from '@/lib/referralUnlimited';

// Pure admin content (icon/label/color/leaderboard_limit) for the referral
// leaderboard segment/tab -- mirrors app/api/quest/levels/route.js's split
// between "config used to LABEL a leaderboard tab" (here) and "live ranking
// data" (app/api/quest/leaderboard/route.js's ?segment=referral). Cached the
// same way levels are, since this rarely changes.
const getCachedReferralLeaderboardConfig = unstable_cache(
  async (currentEventId) => {
    const result = await query(
      "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'referral_leaderboard_config'",
      [currentEventId]
    );
    return result.rows[0]?.value ?? {};
  },
  ['referral-leaderboard-config'],
  { tags: ['referral-leaderboard-config'], revalidate: 300 }
);

export async function GET() {
  try {
    const currentEventId = await getCurrentEventId();
    // Checked live (not cached) -- this is the one thing that must never be
    // stale, since it's what makes the whole segment appear/disappear.
    const active = await isUnlimitedReferralActive(currentEventId);
    if (!active) {
      return NextResponse.json({ active: false, config: null });
    }

    const raw = await getCachedReferralLeaderboardConfig(currentEventId);
    return NextResponse.json({
      active: true,
      config: {
        name_fa:           raw.name_fa || 'دعوت',
        name_en:           raw.name_en || 'Referrals',
        icon_type:         raw.icon_type || 'emoji',
        icon_value:        raw.icon_value || '🔗',
        icon_size:         raw.icon_size ?? 14,
        color:             raw.color || '#3b82f6',
      },
    });
  } catch (e) {
    console.error('[quest/referral-leaderboard-config GET]', e.message);
    return NextResponse.json({ active: false, config: null });
  }
}
