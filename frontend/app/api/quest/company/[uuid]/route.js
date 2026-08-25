import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentEventId } from '@/lib/currentEvent';

export async function GET(request, { params }) {
  const { uuid } = await params;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid || !UUID_RE.test(uuid)) {
    return NextResponse.json({ error: 'invalid_uuid' }, { status: 400 });
  }

  try {
    const currentEventId = await getCurrentEventId();
    const settingsResult = await query(
      "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'companies_config'",
      [currentEventId]
    );
    const eventId = settingsResult.rows[0]?.value?.event_id;

    // company_id AS id, event_id added -- same reasoning as reader 9/15 (scan
    // route) and reader 11/15 (booth-by-qr).
    const result = await query(
      `SELECT company_id AS id, slug, brand_name_fa, brand_name_en, logo,
              hall_name, booth_no, is_sponsor, website, booth_uuid
       FROM companies_placement WHERE booth_uuid = $1 AND rasayesh_event_id = $2 AND event_id = $3`,
      [uuid, Number(eventId), currentEventId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    return NextResponse.json({ company: result.rows[0] });
  } catch (err) {
    console.error('[quest/company]', err.message);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
