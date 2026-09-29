import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { ensureHeaderItemsTable } from '@/lib/initHeader';
import { getCurrentEventId } from '@/lib/currentEvent';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const eventId = await getCurrentEventId();
    await ensureHeaderItemsTable(eventId);
    const { rows } = await query(
      `SELECT id, item_type, title_fa, title_en, icon_path, icon_size, href, is_active, sort_order
       FROM header_items
       WHERE event_id = $1
       ORDER BY sort_order ASC, id ASC`,
      [eventId]
    );
    const logoResult = await query(
      "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'header_logo'",
      [eventId]
    );
    const headerLogo = logoResult.rows[0]?.value ?? null;
    return NextResponse.json({ items: rows, headerLogo });
  } catch (err) {
    console.error('Get header items error:', err);
    return NextResponse.json({ error: 'Failed to get header items' }, { status: 500 });
  }
}
