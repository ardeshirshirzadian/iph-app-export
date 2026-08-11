import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { ensureHeaderItemsTable } from '@/lib/initHeader';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await ensureHeaderItemsTable();
    const { rows } = await query(
      `SELECT id, item_type, title_fa, title_en, icon_path, icon_size, href, is_active, sort_order
       FROM header_items
       ORDER BY sort_order ASC, id ASC`
    );
    return NextResponse.json({ items: rows });
  } catch (err) {
    console.error('Get header items error:', err);
    return NextResponse.json({ error: 'Failed to get header items' }, { status: 500 });
  }
}
