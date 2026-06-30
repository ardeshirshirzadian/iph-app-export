import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// GET /api/companies — public, no auth required
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '10', 10)));
    const offset = (page - 1) * limit;

    const settingsResult = await query(
      "SELECT value FROM app_settings WHERE key = 'companies_config'"
    );
    const config = settingsResult.rows[0]?.value ?? {};
    const visibleFields = config.visible_fields ?? {};
    const logoBaseUrl = config.logo_base_url ?? '';
    const eventName = config.event_name ?? '';
    const eventNameEn = config.event_name_en ?? '';

    const countResult = await query(
      `SELECT COUNT(*) FROM companies
       WHERE ($1 = '' OR brand_name_fa ILIKE $2 OR brand_name_en ILIKE $2)`,
      [search, `%${search}%`]
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const rows = await query(
      `SELECT id, brand_name_fa, brand_name_en, legal_name_fa, logo,
              website, description_fa
       FROM companies
       WHERE ($1 = '' OR brand_name_fa ILIKE $2 OR brand_name_en ILIKE $2)
       ORDER BY brand_name_fa ASC NULLS LAST
       LIMIT $3 OFFSET $4`,
      [search, `%${search}%`, limit, offset]
    );

    return NextResponse.json({
      companies: rows.rows,
      total,
      page,
      limit,
      visibleFields,
      logoBaseUrl,
      eventName,
      eventNameEn,
    });
  } catch (error) {
    console.error('Public companies GET error:', error);
    return NextResponse.json({ error: 'Failed to get companies' }, { status: 500 });
  }
}
