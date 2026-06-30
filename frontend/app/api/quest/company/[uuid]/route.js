import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(request, { params }) {
  const { uuid } = await params;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid || !UUID_RE.test(uuid)) {
    return NextResponse.json({ error: 'invalid_uuid' }, { status: 400 });
  }

  try {
    const result = await query(
      `SELECT id, slug, brand_name_fa, brand_name_en, logo,
              hall_name, booth_no, is_sponsor, website, booth_uuid
       FROM companies WHERE booth_uuid = $1`,
      [uuid]
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
