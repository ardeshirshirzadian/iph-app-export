import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET() {
  let eventSlug = 'iph';
  let badgeEventId = 18;
  try {
    const settingsRes = await query("SELECT value FROM app_settings WHERE key = 'badge_page'");
    const s = settingsRes.rows[0]?.value ?? {};
    badgeEventId = Number(s.badge_event_id) || 18;
    eventSlug = s.event_slug || 'iph';
  } catch {
    // Fail-open: use defaults
  }

  return NextResponse.json({ event_slug: eventSlug, badge_event_id: badgeEventId });
}
