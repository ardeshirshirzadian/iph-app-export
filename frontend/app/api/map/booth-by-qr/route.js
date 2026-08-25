import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentEventId } from '@/lib/currentEvent';

// Resolves an IPH-BOOTH QR uuid to a company id so the client can locate
// the booth on the map — does NOT record a quest scan or require user auth.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const uuid = searchParams.get('uuid') ?? '';
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(uuid)) {
    return NextResponse.json({ error: 'invalid_uuid' }, { status: 400 });
  }
  try {
    const currentEventId = await getCurrentEventId();
    const settingsResult = await query(
      "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'companies_config'",
      [currentEventId]
    );
    const eventId = settingsResult.rows[0]?.value?.event_id;

    // company_id AS id (global company id, not companies_placement's own
    // surrogate id) -- see reader 9/15 (scan route) for why. booth_uuid is
    // shared across a company's event rows post sub-phase-1, so event_id is
    // added alongside rasayesh_event_id to disambiguate.
    const r = await query(
      'SELECT company_id AS id, brand_name_fa, brand_name_en FROM companies_placement WHERE booth_uuid = $1 AND rasayesh_event_id = $2 AND event_id = $3',
      [uuid, Number(eventId), currentEventId]
    );
    if (!r.rows.length) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ company: r.rows[0] });
  } catch (err) {
    console.error('[map/booth-by-qr]', err.message);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
