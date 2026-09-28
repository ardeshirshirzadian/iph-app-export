import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { ensureHeaderItemsTable } from '@/lib/initHeader';
import { getCurrentEventId } from '@/lib/currentEvent';
import { resolveIconSyncEventId } from '@/lib/iconSyncConfig';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const eventId = await getCurrentEventId();
    // Icon-sync: header items + header logo both live-follow the sync
    // source event when active. No unstable_cache on this route (already
    // force-dynamic), so no cache-key trick needed -- just query the
    // resolved event id directly.
    const iconEventId = await resolveIconSyncEventId(eventId);
    await ensureHeaderItemsTable(iconEventId);
    const { rows } = await query(
      `SELECT id, item_type, title_fa, title_en, icon_path, icon_size, href, is_active, sort_order
       FROM header_items
       WHERE event_id = $1
       ORDER BY sort_order ASC, id ASC`,
      [iconEventId]
    );
    const logoResult = await query(
      "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'header_logo'",
      [iconEventId]
    );
    const headerLogo = logoResult.rows[0]?.value ?? null;
    return NextResponse.json({ items: rows, headerLogo });
  } catch (err) {
    console.error('Get header items error:', err);
    return NextResponse.json({ error: 'Failed to get header items' }, { status: 500 });
  }
}
