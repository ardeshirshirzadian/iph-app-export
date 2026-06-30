import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// GET /api/companies — public, no auth required
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const lang = searchParams.get('lang') || 'fa';
    const hall = searchParams.get('hall') || '';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '10', 10)));
    const offset = (page - 1) * limit;

    const settingsResult = await query(
      "SELECT value FROM app_settings WHERE key = 'companies_config'"
    );
    const config = settingsResult.rows[0]?.value ?? {};
    const visibleFields = config.visible_fields ?? {};
    const visibleFieldsEn = config.visible_fields_en ?? {};
    const logoBaseUrl = config.logo_base_url ?? '';
    const eventName = config.event_name ?? '';
    const eventNameEn = config.event_name_en ?? '';

    // Sort — URL param takes precedence over admin config
    const sortParam = searchParams.get('sort') || '';
    const SORT_CLAUSES = {
      name_fa: 'brand_name_fa ASC NULLS LAST',
      name_en: 'brand_name_en ASC NULLS LAST',
      booth:   'booth_no ASC NULLS LAST',
      hall:    'hall_name ASC NULLS LAST, brand_name_fa ASC NULLS LAST',
    };
    let orderClause;
    if (SORT_CLAUSES[sortParam]) {
      orderClause = `ORDER BY ${SORT_CLAUSES[sortParam]}`;
    } else {
      const ALLOWED_SORT = ['brand_name_fa', 'brand_name_en', 'id'];
      const sortEnabled = config.sort_enabled !== false;
      const sortByFa = ALLOWED_SORT.includes(config.sort_by_fa) ? config.sort_by_fa : 'brand_name_fa';
      const sortByEn = ALLOWED_SORT.includes(config.sort_by_en) ? config.sort_by_en : 'brand_name_en';
      const sortField = sortEnabled ? (lang === 'en' ? sortByEn : sortByFa) : 'id';
      orderClause = `ORDER BY ${sortField} ASC NULLS LAST`;
    }

    const eventId = config.event_id;

    // Distinct halls for filter bar (from all companies in this event)
    const hallsResult = eventId
      ? await query(
          `SELECT DISTINCT hall_name FROM companies
           WHERE hall_name IS NOT NULL AND event_id = $1
           ORDER BY hall_name ASC`,
          [Number(eventId)]
        )
      : { rows: [] };
    const halls = hallsResult.rows.map(r => r.hall_name);

    const countResult = await query(
      `SELECT COUNT(*) FROM companies
       WHERE ($1 = '' OR brand_name_fa ILIKE $2 OR brand_name_en ILIKE $2)
         AND ($3 = '' OR hall_name = $3)`,
      [search, `%${search}%`, hall]
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const rows = await query(
      `SELECT id, slug, brand_name_fa, brand_name_en, legal_name_fa, logo,
              website, description_fa, description_en, hall_name, booth_no,
              is_sponsor, sponsor_level
       FROM companies
       WHERE ($1 = '' OR brand_name_fa ILIKE $2 OR brand_name_en ILIKE $2)
         AND ($3 = '' OR hall_name = $3)
       ${orderClause}
       LIMIT $4 OFFSET $5`,
      [search, `%${search}%`, hall, limit, offset]
    );

    return NextResponse.json({
      companies: rows.rows,
      total,
      page,
      limit,
      halls,
      visibleFields,
      visibleFieldsEn,
      logoBaseUrl,
      eventName,
      eventNameEn,
    });
  } catch (error) {
    console.error('Public companies GET error:', error);
    return NextResponse.json({ error: 'Failed to get companies' }, { status: 500 });
  }
}
