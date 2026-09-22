import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { unstable_cache } from 'next/cache';
import { query } from '@/lib/db';
import { getCachedCompaniesConfig } from '@/lib/getCompaniesConfig';
import { getCurrentEventId } from '@/lib/currentEvent';
import { logRasayeshDriftIfAny } from '@/lib/checkRasayeshDrift';

// Booth/company DEFINITIONS only (admin/Rasayesh-sourced via the local
// companies table -- brand name, hall, booth number, logo, booth_xp,
// repeatable-scan config) -- cached. scanned_ids / last_scan_map below stay
// completely live, computed fresh per request from the userUuid cookie.
const getCachedBoothDefinitions = unstable_cache(
  async (eventId) => {
    // id (surrogate placement pk) AND company_id (global Rasayesh id) are
    // BOTH needed -- quest_scans.company_id (see quest/scan/route.js) has
    // stored the placement pk since the sub-phase-4 remap (commit 1af8d3f),
    // so scanned-state matching below must key off `id`; featuredBoothPoolIds
    // (built client-side in QuestClient.js from /api/quest's
    // featured_booth_pool, which stores GLOBAL ids -- excluded from that
    // remap, see quest/route.js) must key off `company_id`. This previously
    // only selected `company_id AS id` (reader 9/15's original migration,
    // predating the sub-phase-4 remap), which left booth.id permanently
    // global-id-keyed while scanned_ids/last_scan_map (read from quest_scans)
    // became placement-pk-keyed -- the two could never match, so the scanned
    // checkmark (and the repeatable-scan cooldown timer, same lookup) never
    // lit up. Fixed 2026-09-12; see the sibling fix in quest/badges/route.js
    // and quest/route.js (commit 2cc6f46) that this file was missed from.
    // rasayesh_event_id alone still disambiguates correctly here: each
    // companies_placement row stores its own literal rasayesh_event_id, so
    // this filter is unambiguous per row without needing a separate local
    // event_id param on this cached fn.
    //
    // is_active = true excludes a company that withdrew/cancelled and is no
    // longer in Rasayesh's own current roster (see companiesSync.js's second
    // deactivation pass) -- without this, a withdrawn exhibitor stayed a
    // live, scannable "booth" in the Quest app indefinitely. Manual-reward
    // rows (سایت ایران‌فارما etc.) are unaffected either way: they're
    // is_active=true and never touched by that deactivation pass.
    const companiesResult = await query(
      `SELECT id, company_id, brand_name_fa, brand_name_en, legal_name_fa, hall_name, booth_no,
              booth_uuid, logo, is_sponsor, sponsor_level, sponsor_title_en,
              sponsor_color, sponsor_icon, booth_xp,
              repeatable_scan, repeatable_scan_hours,
              repeatable_start_hour, repeatable_end_hour
       FROM companies_placement
       WHERE hall_name IS NOT NULL AND booth_uuid IS NOT NULL AND rasayesh_event_id = $1
         AND is_active = true
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
    const currentEventId = await getCurrentEventId();
    const config = await getCachedCompaniesConfig(currentEventId);
    const logoBaseUrl = config.logoBaseUrl || 'https://api.rasayesh.com/';
    const eventId = config.eventId;

    // Fire-and-forget -- pure observability, must never add latency or
    // failure risk to the actual booths response (errors are already
    // caught inside the helper itself).
    logRasayeshDriftIfAny(currentEventId, eventId, 'quest/booths');

    const booths = await getCachedBoothDefinitions(Number(eventId));

    let scanned_ids = [];
    let last_scan_map = {};

    if (userUuid) {
      const [scansResult, lastScansResult, inheritedResult] = await Promise.all([
        query(`SELECT DISTINCT company_id FROM quest_scans WHERE user_uuid = $1 AND event_id = $2`, [userUuid, currentEventId]),
        query(
          `SELECT company_id, MAX(scanned_at) AS last_scan
           FROM quest_scans WHERE user_uuid = $1 AND event_id = $2
           GROUP BY company_id`,
          [userUuid, currentEventId]
        ),
        // Subsidiary companies (companies_placement.parent_company_id set)
        // share their parent's physical booth/QR and have no QR of their own
        // -- when the parent's booth_uuid gets scanned, every subsidiary of
        // that parent should show the same "scanned" checkmark. This is
        // derived here, read-only, every request; it deliberately never
        // writes a quest_scans row for the subsidiary, so booth_scan-type
        // mission counts (COUNT(*) FROM quest_scans) only ever reflect real
        // physical scans, never inherited ones.
        query(
          `SELECT cp.id AS placement_id
           FROM companies_placement cp
           JOIN quest_scans qs ON qs.company_id = cp.parent_company_id
           WHERE cp.parent_company_id IS NOT NULL
             AND cp.event_id = $2
             AND qs.user_uuid = $1
             AND qs.event_id = $2`,
          [userUuid, currentEventId]
        ),
      ]);
      const realScannedIds = scansResult.rows.map(r => r.company_id);
      const inheritedScannedIds = inheritedResult.rows.map(r => r.placement_id);
      scanned_ids = [...new Set([...realScannedIds, ...inheritedScannedIds])];
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
