import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';

const EMPTY = { xp: 0, total_scans: 0, today_scans: 0, name_fa: '', name_en: '', rank: null };

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
    const [totalResult, todayResult, xpResult] = await Promise.all([
      query(
        `SELECT COUNT(*) FROM quest_scans WHERE user_uuid = $1`,
        [userUuid]
      ),
      query(
        `SELECT COUNT(*) FROM quest_scans
         WHERE user_uuid = $1 AND scanned_at > NOW() - INTERVAL '24 hours'`,
        [userUuid]
      ),
      query(
        `SELECT
           COALESCE((SELECT SUM(xp_earned) FROM quest_scans      WHERE user_uuid = $1), 0) +
           COALESCE((SELECT SUM(xp_amount) FROM quest_xp_grants  WHERE user_uuid = $1), 0)
         AS xp`,
        [userUuid]
      ),
    ]);

    const total_scans = parseInt(totalResult.rows[0].count, 10);
    const today_scans = parseInt(todayResult.rows[0].count, 10);
    const xp = parseInt(xpResult.rows[0].xp, 10);

    return NextResponse.json({ name_fa: nameFa, name_en: nameEn, total_scans, today_scans, xp, rank: null });
  } catch (err) {
    console.error('[quest/stats]', err.message);
    return NextResponse.json(EMPTY);
  }
}
