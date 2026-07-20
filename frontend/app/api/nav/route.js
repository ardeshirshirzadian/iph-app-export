import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { ensureBottomNavTable } from '@/lib/initBottomNav';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await ensureBottomNavTable();
    const result = await query(
      `SELECT id, title_fa, title_en, icon_path, href
       FROM bottom_nav_items
       WHERE is_active = true
       ORDER BY sort_order ASC, id ASC`
    );
    return NextResponse.json({ items: result.rows });
  } catch (error) {
    console.error('Get nav items error:', error);
    return NextResponse.json({ error: 'Failed to get nav items' }, { status: 500 });
  }
}
