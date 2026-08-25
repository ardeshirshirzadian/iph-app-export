import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentEventId } from '@/lib/currentEvent';

// GET /api/companies/[slug] — public, no auth required
export async function GET(request, { params }) {
  try {
    const { slug } = await params;
    const currentEventId = await getCurrentEventId();

    const settingsResult = await query(
      "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'companies_config'",
      [currentEventId]
    );
    const config = settingsResult.rows[0]?.value ?? {};
    const logoBaseUrl = config.logo_base_url ?? '';
    const eventId = config.event_id;

    // company_id AS id -- see reader 9/15. slug is company-level (same value
    // on both a shared company's event rows), so rasayesh_event_id alone
    // still disambiguates unambiguously here, same as reader 13/15.
    const result = await query(
      `SELECT company_id AS id, slug, brand_name_fa, brand_name_en, legal_name_fa, legal_name_en,
              logo, website, description_fa, description_en,
              phones, emails, address_fa, address_en, industry_id,
              hall_name, booth_no, is_sponsor, sponsor_level
       FROM companies_placement
       WHERE slug = $1 AND rasayesh_event_id = $2
       LIMIT 1`,
      [slug, Number(eventId)]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    return NextResponse.json({ company: result.rows[0], logoBaseUrl });
  } catch (error) {
    console.error('Company detail GET error:', error);
    return NextResponse.json({ error: 'Failed to get company' }, { status: 500 });
  }
}
