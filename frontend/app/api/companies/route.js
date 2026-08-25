import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentEventId } from '@/lib/currentEvent';

// GET /api/companies — public, no auth required
export async function GET(request) {
  try {
    const currentEventId = await getCurrentEventId();
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const lang = searchParams.get('lang') || 'fa';
    const hall = searchParams.get('hall') || '';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '10', 10)));
    const offset = (page - 1) * limit;

    const settingsResult = await query(
      "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'companies_config'",
      [currentEventId]
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

    // Distinct halls for filter bar (from all companies in this event).
    // Uses the local event_id FK, not config.event_id (the Rasayesh id) --
    // always set correctly by the sync process, unlike the config value
    // which could be unset/stale.
    const hallsResult = await query(
      `SELECT DISTINCT hall_name FROM companies_placement
       WHERE hall_name IS NOT NULL AND event_id = $1
       ORDER BY hall_name ASC`,
      [currentEventId]
    );
    const halls = hallsResult.rows.map(r => r.hall_name);

    // Found live during Phase 5: neither of these two queries filtered by
    // event at all -- with only one event in the DB this was dormant (see
    // Phase 3 notes), but with a second real event now live it meant BOTH
    // domains' company lists silently merged into one combined list/count.
    const countResult = await query(
      `SELECT COUNT(*) FROM companies_placement
       WHERE event_id = $1
         AND ($2 = '' OR brand_name_fa ILIKE $3 OR brand_name_en ILIKE $3)
         AND ($4 = '' OR hall_name = $4)`,
      [currentEventId, search, `%${search}%`, hall]
    );
    const total = parseInt(countResult.rows[0].count, 10);

    // company_id AS id -- see reader 9/15. orderClause may reference "id"
    // (ALLOWED_SORT above), which resolves fine against this output alias.
    const rows = await query(
      `SELECT company_id AS id, slug, brand_name_fa, brand_name_en, legal_name_fa, logo,
              website, description_fa, description_en, hall_name, booth_no,
              is_sponsor, sponsor_level
       FROM companies_placement
       WHERE event_id = $1
         AND ($2 = '' OR brand_name_fa ILIKE $3 OR brand_name_en ILIKE $3)
         AND ($4 = '' OR hall_name = $4)
       ${orderClause}
       LIMIT $5 OFFSET $6`,
      [currentEventId, search, `%${search}%`, hall, limit, offset]
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
