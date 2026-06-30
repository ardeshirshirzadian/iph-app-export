import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// GET /api/panels — public, no auth required
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const hall = searchParams.get('hall') || '';
    const date = searchParams.get('date') || ''; // YYYY-MM-DD

    const settingsResult = await query(
      "SELECT value FROM app_settings WHERE key = 'panels_config'"
    );
    const config = settingsResult.rows[0]?.value ?? {};
    const visibleFields = config.visible_fields ?? {};
    const visibleFieldsEn = config.visible_fields_en ?? {};
    const logoBaseUrl = config.logo_base_url ?? '';
    const eventName = config.event_name ?? '';
    const eventNameEn = config.event_name_en ?? '';

    const rows = await query(
      `SELECT id, title_fa, title_en, description_fa, description_en, hall_fa, hall_en,
              starts_at, ends_at, capacity, kind, thumbnail, speakers
       FROM panels
       WHERE is_visible = true
         AND ($1 = '' OR title_fa ILIKE $2)
         AND ($3 = '' OR hall_fa = $3)
         AND ($4 = '' OR DATE(starts_at) = $4::date)
       ORDER BY starts_at ASC NULLS LAST`,
      [search, `%${search}%`, hall, date]
    );

    // Unique halls for filter UI
    const hallsResult = await query(
      `SELECT DISTINCT hall_fa FROM panels
       WHERE is_visible = true AND hall_fa IS NOT NULL
       ORDER BY hall_fa`
    );
    const halls = hallsResult.rows.map(r => r.hall_fa);

    // Unique dates (Gregorian YYYY-MM-DD) for date tab UI
    const datesResult = await query(
      `SELECT DISTINCT DATE(starts_at)::text AS date FROM panels
       WHERE is_visible = true AND starts_at IS NOT NULL
       ORDER BY date`
    );
    const dates = datesResult.rows.map(r => r.date);

    return NextResponse.json({
      panels: rows.rows,
      halls,
      dates,
      visibleFields,
      visibleFieldsEn,
      logoBaseUrl,
      eventName,
      eventNameEn,
    });
  } catch (err) {
    console.error('Public panels GET error:', err);
    return NextResponse.json({ error: 'Failed to get panels' }, { status: 500 });
  }
}
