import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentEventId } from '@/lib/currentEvent';

// Found live during Phase 5, same gap class as app/login/page.js: never
// touched in Tier 3 (only app/page.js's inline getDefaultNotifications was
// fixed there), no event_id filter at all.
export async function GET() {
  try {
    const currentEventId = await getCurrentEventId();
    const { rows } = await query(
      'SELECT id, icon, title, description, is_default, image_path, link, icon_size, created_at FROM notifications WHERE event_id = $1 ORDER BY created_at DESC',
      [currentEventId]
    );
    return NextResponse.json({ notifications: rows });
  } catch (e) {
    console.error('[notifications GET]', e.message);
    return NextResponse.json({ notifications: [] });
  }
}
