import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';

export async function GET() {
  const cookieStore = await cookies();
  const userRaw = cookieStore.get('iph_user')?.value;

  let userUuid = null;
  try {
    userUuid = JSON.parse(decodeURIComponent(userRaw))?.uuid || null;
  } catch {}

  try {
    const [companiesResult, settingsResult] = await Promise.all([
      query(
        `SELECT id, brand_name_fa, brand_name_en, hall_name, booth_no,
                booth_uuid, logo, is_sponsor, booth_xp
         FROM companies
         WHERE hall_name IS NOT NULL AND booth_uuid IS NOT NULL
         ORDER BY hall_name ASC, booth_no ASC`
      ),
      query("SELECT value FROM app_settings WHERE key = 'companies_config'"),
    ]);

    const config = settingsResult.rows[0]?.value || {};
    const logoBaseUrl = config.logo_base_url || 'https://api.rasayesh.com/';

    const booths = companiesResult.rows.map(c => ({ ...c, xp: c.booth_xp ?? 10 }));

    let scanned_ids = [];
    if (userUuid) {
      const scansResult = await query(
        `SELECT DISTINCT company_id FROM quest_scans WHERE user_uuid = $1`,
        [userUuid]
      );
      scanned_ids = scansResult.rows.map(r => r.company_id);
    }

    return NextResponse.json({ booths, scanned_ids, logoBaseUrl });
  } catch (err) {
    console.error('[quest/booths]', err.message);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
