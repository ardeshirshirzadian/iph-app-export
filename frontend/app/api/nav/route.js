import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { query } from '@/lib/db';
import { ensureBottomNavTable } from '@/lib/initBottomNav';

// Pure admin content (bottom_nav_items) -- same pattern as
// app/api/companies/config/route.js.
const getCachedNavItems = unstable_cache(
  async () => {
    await ensureBottomNavTable();
    const result = await query(
      `SELECT id, title_fa, title_en, icon_path, href
       FROM bottom_nav_items
       WHERE is_active = true
       ORDER BY sort_order ASC, id ASC`
    );
    return result.rows;
  },
  ['nav-items'],
  { tags: ['nav-items'], revalidate: 300 }
);

export async function GET() {
  try {
    const items = await getCachedNavItems();
    return NextResponse.json({ items });
  } catch (error) {
    console.error('Get nav items error:', error);
    return NextResponse.json({ error: 'Failed to get nav items' }, { status: 500 });
  }
}
