import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { query } from '@/lib/db';

// Pure admin content -- level name/icon/color/min_xp/max_xp/sort_order/
// leaderboard_limit are used to LABEL the leaderboard, not to compute
// rankings (that's app/api/quest/leaderboard/route.js, untouched by this
// task -- 100% live ranking data, no admin-content mixed in).
const getCachedQuestLevels = unstable_cache(
  async () => {
    const { rows } = await query(
      `SELECT id, name_fa, name_en, icon_type, icon_value, icon_size,
              min_xp, max_xp, color, sort_order, leaderboard_limit
       FROM quest_levels
       WHERE is_active = true
       ORDER BY sort_order ASC, min_xp ASC, id ASC`
    );
    return rows;
  },
  ['quest-level-config'],
  { tags: ['quest-level-config'], revalidate: 300 }
);

export async function GET() {
  try {
    const rows = await getCachedQuestLevels();
    return NextResponse.json({ levels: rows });
  } catch (e) {
    console.error('[quest/levels GET]', e.message);
    return NextResponse.json({ levels: [] });
  }
}
