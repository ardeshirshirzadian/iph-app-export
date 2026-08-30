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
      `SELECT id, title_fa, title_en, icon_type, icon_path, icon_size, href, is_coming_soon, coming_soon_badge_fa, coming_soon_badge_en, coming_soon_no_badge
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

// scan_glow_color lives in the same quest_appearance_config blob the /quest
// page's appearance settings use (frontend/lib/questPageCache.js) -- the
// scan button reads the exact same admin-set color, only the render
// location moved (QuestClient.js -> BottomNav.js), see project notes on
// why this must never get a hardcoded fallback.
const getCachedScanGlow = unstable_cache(
  async (eventId) => {
    const result = await query(
      "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'quest_appearance_config'",
      [eventId]
    );
    const config = result.rows[0]?.value ?? {};
    return {
      dark: config.dark?.scan_glow_color || null,
      light: config.light?.scan_glow_color || null,
    };
  },
  ['nav-scan-glow'],
  { tags: ['quest-appearance-config'], revalidate: 300 }
);

export async function GET() {
  try {
    const eventId = await getCurrentEventId();
    const [items, scanGlow] = await Promise.all([
      getCachedNavItems(eventId),
      getCachedScanGlow(eventId),
    ]);
    return NextResponse.json({ items, scanGlow });
  } catch (error) {
    console.error('Get nav items error:', error);
    return NextResponse.json({ error: 'Failed to get nav items' }, { status: 500 });
  }
}
