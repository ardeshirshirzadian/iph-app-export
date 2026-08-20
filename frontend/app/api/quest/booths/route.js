import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { unstable_cache } from 'next/cache';
import { query } from '@/lib/db';
import { getCachedCompaniesConfig } from '@/lib/getCompaniesConfig';
import { getCurrentEventId } from '@/lib/currentEvent';

// Booth/company DEFINITIONS only (admin/Rasayesh-sourced via the local
// companies table -- brand name, hall, booth number, logo, booth_xp,
// repeatable-scan config) -- cached. scanned_ids / last_scan_map below stay
// completely live, computed fresh per request from the userUuid cookie.
const getCachedBoothDefinitions = unstable_cache(
  async (eventId) => {
    const companiesResult = await query(
      `SELECT id, brand_name_fa, brand_name_en, hall_name, booth_no,
              booth_uuid, logo, is_sponsor, booth_xp,
              repeatable_scan, repeatable_scan_hours,
              repeatable_start_hour, repeatable_end_hour
       FROM companies
       WHERE hall_name IS NOT NULL AND booth_uuid IS NOT NULL AND rasayesh_event_id = $1
       ORDER BY repeatable_scan DESC, hall_name ASC, booth_no ASC`,
      [eventId]
    );
    return companiesResult.rows.map(c => ({ ...c, xp: c.booth_xp ?? 10 }));
  },
  ['quest-booth-definitions'],
  { tags: ['quest-booth-definitions'], revalidate: 300 }
);

export async function GET() {
  const cookieStore = await cookies();
  const userRaw = cookieStore.get('iph_user')?.value;

  let userUuid = null;
  try {
    userUuid = JSON.parse(decodeURIComponent(userRaw))?.uuid || null;
  } catch {}

  try {
    const config = await getCachedCompaniesConfig(await getCurrentEventId());
    const logoBaseUrl = config.logoBaseUrl || 'https://api.rasayesh.com/';
    const eventId = config.eventId;

    const booths = await getCachedBoothDefinitions(Number(eventId));

    let scanned_ids = [];
    let last_scan_map = {};

    if (userUuid) {
      const [scansResult, lastScansResult] = await Promise.all([
        query(`SELECT DISTINCT company_id FROM quest_scans WHERE user_uuid = $1`, [userUuid]),
        query(
          `SELECT company_id, MAX(scanned_at) AS last_scan
           FROM quest_scans WHERE user_uuid = $1
           GROUP BY company_id`,
          [userUuid]
        ),
      ]);
      scanned_ids = scansResult.rows.map(r => r.company_id);
      lastScansResult.rows.forEach(r => {
        last_scan_map[r.company_id] = r.last_scan;
      });
    }

    // Attach last_scan_at only for repeatable-scan companies (minimise payload)
    const boothsWithMeta = booths.map(c => ({
      ...c,
      last_scan_at: c.repeatable_scan ? (last_scan_map[c.id] ?? null) : undefined,
    }));

    return NextResponse.json({ booths: boothsWithMeta, scanned_ids, logoBaseUrl });
  } catch (err) {
    console.error('[quest/booths]', err.message);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
