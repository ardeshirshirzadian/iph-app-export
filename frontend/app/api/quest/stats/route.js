import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { getCurrentEventId } from '@/lib/currentEvent';
import { getUserDisplayNames } from '@/lib/userDisplayNames';

const EMPTY = { xp: 0, total_scans: 0, today_scans: 0, today_xp: 0, name_fa: '', name_en: '', rank: null };
export const dynamic = 'force-dynamic';

function noStoreJson(body) {
  const response = NextResponse.json(body);
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  return response;
}

// Postgres session/DB timezone is UTC (confirmed via `SHOW timezone`) while the
// server OS runs Asia/Tehran (+03:30) -- scanned_at/granted_at are stored as
// naive "timestamp without time zone" columns holding UTC wall-clock values
// (written via now() under a UTC session). A plain date_trunc('day', NOW())
// boundary would therefore land 3.5h late (Tehran 00:00-03:30 would still
// count as "yesterday"). Converting NOW() to Tehran wall-clock, truncating to
// that day, then converting back recovers the correct absolute instant for
// Tehran midnight -- correct as long as this query runs under a UTC session,
// which is the DB's actual default (deliberately not changed here: this DB
// is shared with iph-apn and altering its global timezone would be a much
// larger blast radius than this one stat).
const TODAY_BOUNDARY = `(date_trunc('day', NOW() AT TIME ZONE 'Asia/Tehran') AT TIME ZONE 'Asia/Tehran')`;

export async function GET() {
  const cookieStore = await cookies();
  const userRaw = cookieStore.get('iph_user')?.value;

  let userUuid = null;
  try {
    const user = JSON.parse(decodeURIComponent(userRaw));
    userUuid = user?.uuid || null;
  } catch {
    return noStoreJson(EMPTY);
  }

  if (!userUuid) return noStoreJson(EMPTY);

  try {
    const currentEventId = await getCurrentEventId();

    const [displayNames, totalResult, todayResult, xpResult, todayXpResult] = await Promise.all([
      getUserDisplayNames(currentEventId, userUuid),
      query(
        `SELECT COUNT(*) FROM quest_scans WHERE user_uuid = $1 AND event_id = $2`,
        [userUuid, currentEventId]
      ),
      query(
        `SELECT COUNT(*) FROM quest_scans
         WHERE user_uuid = $1 AND event_id = $2 AND scanned_at >= ${TODAY_BOUNDARY}`,
        [userUuid, currentEventId]
      ),
      query(
        `SELECT
           COALESCE((SELECT SUM(xp_earned) FROM quest_scans      WHERE user_uuid = $1 AND event_id = $2), 0) +
           COALESCE((SELECT SUM(xp_amount) FROM quest_xp_grants  WHERE user_uuid = $1 AND event_id = $2), 0)
         AS xp`,
        [userUuid, currentEventId]
      ),
      // today_xp sums every XP source (booth scans, hall_scan/booth_scan/special_booth
      // mission bonuses, quiz, survey, social_share, featured-booth bonus) since
      // quest_scans.xp_earned + quest_xp_grants.xp_amount is the same pair the lifetime
      // `xp` total above uses -- every mission type ultimately writes through one of
      // these two tables (confirmed against every XP-granting route, including
      // iph-apn's social-share approval endpoint).
      query(
        `SELECT
           COALESCE((SELECT SUM(xp_earned) FROM quest_scans
                       WHERE user_uuid = $1 AND event_id = $2 AND scanned_at >= ${TODAY_BOUNDARY}), 0) +
           COALESCE((SELECT SUM(xp_amount) FROM quest_xp_grants
                       WHERE user_uuid = $1 AND event_id = $2 AND granted_at >= ${TODAY_BOUNDARY}), 0)
         AS today_xp`,
        [userUuid, currentEventId]
      ),
    ]);

    const total_scans = parseInt(totalResult.rows[0].count, 10);
    const today_scans = parseInt(todayResult.rows[0].count, 10);
    const xp = parseInt(xpResult.rows[0].xp, 10);
    const today_xp = parseInt(todayXpResult.rows[0].today_xp, 10);

    const name_fa = displayNames ? [displayNames.firstnameFa, displayNames.lastnameFa].filter(Boolean).join(' ') : '';
    const name_en = displayNames ? [displayNames.firstnameEn, displayNames.lastnameEn].filter(Boolean).join(' ') : '';
    return noStoreJson({ name_fa, name_en, total_scans, today_scans, xp, today_xp, rank: null });
  } catch (err) {
    console.error('[quest/stats]', err.message);
    return noStoreJson(EMPTY);
  }
}
