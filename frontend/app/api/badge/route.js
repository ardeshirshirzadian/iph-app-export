import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET() {
  let eventSlug = 'iph';
  let badgeEventId = 18;
  let cardTemplateId = 0;
  let eventOrigin = 'https://2025.iphexpo.com';
  try {
    const [badgeRes, originRes] = await Promise.all([
      query("SELECT value FROM app_settings WHERE key = 'badge_page'"),
      query("SELECT value FROM app_settings WHERE key = 'companies_config'"),
    ]);
    const s = badgeRes.rows[0]?.value ?? {};
    badgeEventId = Number(s.badge_event_id) || 18;
    eventSlug = s.event_slug || 'iph';
    cardTemplateId = Number(s.card_template_id) || 0;
    eventOrigin = originRes.rows[0]?.value?.event_origin || 'https://2025.iphexpo.com';
  } catch {
    // Fail-open: use defaults
  }

  return NextResponse.json({ event_slug: eventSlug, badge_event_id: badgeEventId, card_template_id: cardTemplateId, event_origin: eventOrigin });
}
