import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { getCurrentEventId } from '@/lib/currentEvent';

const EMPTY = { xp: 0, total_scans: 0, today_scans: 0, today_xp: 0, name_fa: '', name_en: '', rank: null };

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
  let nameFa = '';
  let nameEn = '';

  try {
    const user = JSON.parse(decodeURIComponent(userRaw));
    userUuid = user?.uuid || null;
    nameFa = [user?.firstname_fa, user?.lastname_fa].filter(Boolean).join(' ');
    nameEn = [user?.firstname_en, user?.lastname_en].filter(Boolean).join(' ');
  } catch {
    return NextResponse.json(EMPTY);
  }

  if (!userUuid) return NextResponse.json(EMPTY);

  try {
    const currentEventId = await getCurrentEventId();

    const [totalResult, todayResult, xpResult, todayXpResult] = await Promise.all([
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

    return NextResponse.json({ name_fa: nameFa, name_en: nameEn, total_scans, today_scans, xp, today_xp, rank: null });
  } catch (err) {
    console.error('[quest/stats]', err.message);
    return NextResponse.json(EMPTY);
  }
}
