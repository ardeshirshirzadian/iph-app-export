import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getRasayeshEventInfo } from '@/lib/publicRasayeshClient';

export async function GET() {
  try {
    const result = await query("SELECT value FROM app_settings WHERE key = 'registration_config'");
    const defaults = { event_id: 18, is_enabled: false };
    const config = { ...defaults, ...(result.rows[0]?.value ?? {}) };

    if (!config.is_enabled) {
      return NextResponse.json({ enabled: false });
    }

    const eventId = Number(config.event_id);
    const eventInfo = await getRasayeshEventInfo(eventId);

    return NextResponse.json({
      enabled: true,
      event_id: eventId,
      eventOrigin: eventInfo.website,
    });
  } catch (err) {
    console.error('[GET /api/registration/plans] event lookup failed:', err.message);
    return NextResponse.json({ enabled: false });
  }
}
