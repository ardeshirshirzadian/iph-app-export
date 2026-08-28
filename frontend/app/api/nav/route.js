import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { query } from '@/lib/db';
import { ensureBottomNavTable } from '@/lib/initBottomNav';
import { getCurrentEventId } from '@/lib/currentEvent';

// Pure admin content (bottom_nav_items) -- same pattern as
// app/api/companies/config/route.js.
const getCachedNavItems = unstable_cache(
  async (eventId) => {
    await ensureBottomNavTable(eventId);
    const result = await query(
      `SELECT id, title_fa, title_en, icon_path, href, is_coming_soon, coming_soon_badge_fa, coming_soon_badge_en, coming_soon_no_badge
       FROM bottom_nav_items
       WHERE is_active = true AND event_id = $1
       ORDER BY sort_order ASC, id ASC`,
      [eventId]
    );
    return result.rows;
  },
  ['nav-items'],
  { tags: ['nav-items'], revalidate: 300 }
);

export async function GET() {
  try {
    const eventId = await getCurrentEventId();
    const items = await getCachedNavItems(eventId);
    return NextResponse.json({ items });
  } catch (error) {
    console.error('Get nav items error:', error);
    return NextResponse.json({ error: 'Failed to get nav items' }, { status: 500 });
  }
}
