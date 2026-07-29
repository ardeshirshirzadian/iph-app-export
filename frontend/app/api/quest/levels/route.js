import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { rows } = await query(
      `SELECT id, name_fa, name_en, icon_type, icon_value, icon_size,
              min_xp, max_xp, color, sort_order, leaderboard_limit
       FROM quest_levels
       WHERE is_active = true
       ORDER BY sort_order ASC, min_xp ASC, id ASC`
    );
    return NextResponse.json({ levels: rows });
  } catch (e) {
    console.error('[quest/levels GET]', e.message);
    return NextResponse.json({ levels: [] });
  }
}
