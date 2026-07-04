import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

const RASAYESH_GQL = 'https://api.rasayesh.com/graphql';

const EVENT_COMPANIES_QUERY = `
  query EventCompanies($search: String) {
    eventCompanies(search: $search, order: "asc", all: true) {
      id
      slug
      legal_name_fa
      legal_name_en
      brand_name_fa
      brand_name_en
      logo
      eventOptions { show_profile }
      sponsorshipLevels { icon color is_digital }
      booths { id no area hall { id title } }
    }
    eventCompaniesCount(search: $search)
  }
`;

// POST /api/admin/companies/sync — triggers a full company+booth sync from Rasayesh.
// Admin auth + 'companies' permission enforced by proxy.js.
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const search = body.search ?? null;

    const configResult = await query(
      "SELECT value FROM app_settings WHERE key = 'companies_config'"
    );
    const config = configResult.rows[0]?.value ?? {};
    const eventOrigin = config.event_origin ?? 'https://2025.iphexpo.com';
    const eventId = config.event_id ? Number(config.event_id) : null;

    const res = await fetch(RASAYESH_GQL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-rasayesh-site': 'iph',
        'origin': eventOrigin,
        'referer': `${eventOrigin}/`,
      },
      body: JSON.stringify({
        query: EVENT_COMPANIES_QUERY,
        variables: { search },
      }),
      cache: 'no-store',
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Rasayesh returned ${res.status}` },
        { status: 502 }
      );
    }

    const json = await res.json();
    if (json.errors?.length) {
      console.error('[admin/companies] GraphQL errors:', json.errors);
      return NextResponse.json({ error: json.errors[0].message }, { status: 502 });
    }

    const companies = json.data?.eventCompanies ?? [];
    const totalRemote = json.data?.eventCompaniesCount ?? companies.length;

    let synced = 0;
    for (const c of companies) {
      if (!c.slug) continue;

      const booth = c.booths?.[0] ?? null;
      const boothNo = booth?.no ?? null;
      const hallName = booth?.hall?.title ?? null;
      const isSponsor = (c.sponsorshipLevels?.length ?? 0) > 0;
      const sponsorLevel = c.sponsorshipLevels?.[0]?.color ?? null;
      const logoJson = c.logo ? JSON.stringify(c.logo) : null;

      // Try UPDATE first; INSERT only if the slug doesn't exist yet.
      // (slug has no UNIQUE index from the migration — safe upsert without ON CONFLICT)
      const updated = await query(
        `UPDATE companies SET
           brand_name_fa = $1,
           brand_name_en = $2,
           legal_name_fa = $3,
           legal_name_en = $4,
           logo          = $5,
           hall_name     = $6,
           booth_no      = $7,
           is_sponsor    = $8,
           sponsor_level = $9,
           event_id      = $10
         WHERE slug = $11`,
        [
          c.brand_name_fa, c.brand_name_en,
          c.legal_name_fa, c.legal_name_en,
          logoJson,
          hallName, boothNo,
          isSponsor, sponsorLevel,
          eventId,
          c.slug,
        ]
      );

      if (updated.rowCount === 0) {
        await query(
          `INSERT INTO companies (
             slug, brand_name_fa, brand_name_en, legal_name_fa, legal_name_en,
             logo, hall_name, booth_no, is_sponsor, sponsor_level, event_id
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            c.slug,
            c.brand_name_fa, c.brand_name_en,
            c.legal_name_fa, c.legal_name_en,
            logoJson,
            hallName, boothNo,
            isSponsor, sponsorLevel,
            eventId,
          ]
        );
      }

      synced++;
    }

    return NextResponse.json({ synced, total: totalRemote });
  } catch (err) {
    console.error('[admin/companies] sync error:', err.message);
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}

// GET /api/admin/companies — returns current DB companies list for the admin UI.
export async function GET() {
  try {
    const configResult = await query(
      "SELECT value FROM app_settings WHERE key = 'companies_config'"
    );
    const config = configResult.rows[0]?.value ?? {};

    const { rows } = await query(
      `SELECT id, slug, brand_name_fa, brand_name_en, legal_name_fa,
              logo, hall_name, booth_no, is_sponsor, sponsor_level, event_id
       FROM companies
       ORDER BY brand_name_fa ASC NULLS LAST`
    );

    return NextResponse.json({ companies: rows, config });
  } catch (err) {
    console.error('[admin/companies] GET error:', err.message);
    return NextResponse.json({ error: 'Failed to fetch companies' }, { status: 500 });
  }
}
