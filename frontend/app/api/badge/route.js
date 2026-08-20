import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getRasayeshEventInfo } from '@/lib/publicRasayeshClient';
import { getCurrentEventId } from '@/lib/currentEvent';

export async function GET() {
  let eventSlug = 'iph';
  let badgeEventId = 18;
  let cardTemplateId = 0;
  let eventOrigin = 'https://2025.iphexpo.com';
  try {
    const currentEventId = await getCurrentEventId();
    const [badgeRes, originRes] = await Promise.all([
      query("SELECT value FROM app_settings WHERE event_id = $1 AND key = 'badge_page'", [currentEventId]),
      query("SELECT value FROM app_settings WHERE event_id = $1 AND key = 'companies_config'", [currentEventId]),
    ]);
    const s = badgeRes.rows[0]?.value ?? {};
    badgeEventId = Number(s.badge_event_id) || 18;
    cardTemplateId = Number(s.card_template_id) || 0;
    eventOrigin = originRes.rows[0]?.value?.event_origin || 'https://2025.iphexpo.com';

    try {
      const eventInfo = await getRasayeshEventInfo(badgeEventId);
      eventSlug = eventInfo.slug || 'iph';
    } catch {
      eventSlug = 'iph';
    }
  } catch {
    // Fail-open: use defaults
  }

  return NextResponse.json({ event_slug: eventSlug, badge_event_id: badgeEventId, card_template_id: cardTemplateId, event_origin: eventOrigin });
}
