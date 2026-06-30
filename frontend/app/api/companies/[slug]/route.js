import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// GET /api/companies/[slug] — public, no auth required
export async function GET(request, { params }) {
  try {
    const { slug } = await params;

    const result = await query(
      `SELECT id, slug, brand_name_fa, brand_name_en, legal_name_fa, legal_name_en,
              logo, website, description_fa, description_en,
              phones, emails, address_fa, address_en, industry_id,
              hall_name, booth_no, is_sponsor, sponsor_level
       FROM companies
       WHERE slug = $1
       LIMIT 1`,
      [slug]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    const settingsResult = await query(
      "SELECT value FROM app_settings WHERE key = 'companies_config'"
    );
    const config = settingsResult.rows[0]?.value ?? {};
    const logoBaseUrl = config.logo_base_url ?? '';

    return NextResponse.json({ company: result.rows[0], logoBaseUrl });
  } catch (error) {
    console.error('Company detail GET error:', error);
    return NextResponse.json({ error: 'Failed to get company' }, { status: 500 });
  }
}
