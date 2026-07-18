import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

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
    const r = await query(
      'SELECT id, brand_name_fa, brand_name_en FROM companies WHERE booth_uuid = $1',
      [uuid]
    );
    if (!r.rows.length) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ company: r.rows[0] });
  } catch (err) {
    console.error('[map/booth-by-qr]', err.message);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
