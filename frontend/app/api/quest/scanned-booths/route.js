import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { getCurrentEventId } from '@/lib/currentEvent';

// Full scan history for one featured_booth mission's pool, all rotations
// (no selected_at filter -- unlike scan/route.js's rotation-aware dedup,
// this is a "what have I earned" view, not a "can I scan again" check).
export async function GET(request) {
  const cookieStore = await cookies();
  const userRaw = cookieStore.get('iph_user')?.value;

  let userUuid;
  try {
    const user = JSON.parse(decodeURIComponent(userRaw));
    userUuid = user?.uuid || null;
  } catch {
    userUuid = null;
  }
  if (!userUuid) {
    return NextResponse.json({ error: 'session_expired' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const missionId = parseInt(searchParams.get('missionId'), 10);
  if (!Number.isInteger(missionId)) {
    return NextResponse.json({ error: 'invalid_mission' }, { status: 400 });
  }

  try {
    const currentEventId = await getCurrentEventId();

    const { rows: missionRows } = await query(
      `SELECT featured_booth_pool FROM quest_content
       WHERE id = $1 AND event_id = $2 AND mission_type = 'featured_booth'`,
      [missionId, currentEventId]
    );
    const pool = missionRows[0]?.featured_booth_pool;
    if (!Array.isArray(pool) || pool.length === 0) {
      return NextResponse.json({ scans: [], total_xp: 0 });
    }

    // featured_booth_pool holds GLOBAL companies_placement.company_id values
    // (excluded from the sub-phase 4 remap), while quest_scans.company_id
    // holds the placement row's own surrogate id -- the same distinction
    // scan/route.js's own comments call out. Filtering must go through the
    // companies_placement join (cp.company_id = ANY(pool)), never compare
    // the pool directly against qs.company_id -- that would silently match
    // nothing (see the overlooked-remap bug found in the subsidiary-
    // companies investigation, same root confusion).
    const { rows: scans } = await query(
      `SELECT qs.company_id AS placement_id, cp.brand_name_fa, cp.brand_name_en,
              cp.logo, cp.hall_name, cp.booth_no,
              qs.xp_earned, qs.is_featured_booth_bonus, qs.scanned_at
       FROM quest_scans qs
       JOIN companies_placement cp ON cp.id = qs.company_id AND cp.event_id = $3
       WHERE qs.user_uuid = $1 AND qs.event_id = $2 AND cp.company_id = ANY($4::int[])
       ORDER BY qs.scanned_at DESC`,
      [userUuid, currentEventId, currentEventId, pool]
    );

    const total_xp = scans.reduce((sum, s) => sum + (s.xp_earned || 0), 0);

    return NextResponse.json({ scans, total_xp });
  } catch (err) {
    console.error('[quest/scanned-booths]', err.message);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
