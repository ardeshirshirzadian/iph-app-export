import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { getCurrentEventId } from '@/lib/currentEvent';
import { getOrCreateReferralCode } from '@/lib/referralCode';

export async function GET() {
  const cookieStore = await cookies();
  const userRaw = cookieStore.get('iph_user')?.value;
  let uuid = null;
  try {
    uuid = JSON.parse(decodeURIComponent(userRaw))?.uuid || null;
  } catch {}
  if (!uuid) {
    return Response.json({ error: 'Not logged in' }, { status: 401 });
  }

  try {
    const eventId = await getCurrentEventId();
    // Lazy create-on-first-fetch -- covers every pre-existing user who
    // predates this feature (a brand-new user already got theirs eagerly at
    // finalize-login time; for them this is just a read).
    const code = await getOrCreateReferralCode(eventId, uuid);

    const countsResult = await query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed_count,
         COUNT(*) FILTER (WHERE status = 'pending') AS pending_count,
         COUNT(*) FILTER (WHERE status = 'rejected') AS rejected_count
       FROM quest_referral_redemptions
       WHERE event_id = $1 AND referrer_user_uuid = $2`,
      [eventId, uuid]
    );
    const counts = countsResult.rows[0] || {};

    const ownRedemptionResult = await query(
      `SELECT status FROM quest_referral_redemptions WHERE event_id = $1 AND referee_user_uuid = $2`,
      [eventId, uuid]
    );

    return Response.json({
      code,
      confirmed_count: parseInt(counts.confirmed_count, 10) || 0,
      pending_count: parseInt(counts.pending_count, 10) || 0,
      rejected_count: parseInt(counts.rejected_count, 10) || 0,
      own_redemption_status: ownRedemptionResult.rows[0]?.status || null,
    });
  } catch (err) {
    console.error('[referral/my-code] error:', err.message);
    return Response.json({ error: 'server_error' }, { status: 500 });
  }
}
