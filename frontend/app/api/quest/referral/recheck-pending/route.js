import { query } from '@/lib/db';
import { getRasayeshEventInfo } from '@/lib/publicRasayeshClient';
import { getCurrentEventId } from '@/lib/currentEvent';
import { evaluateReferralTiers } from '@/lib/referralTiers';
import { grantUnlimitedReferralXp } from '@/lib/referralUnlimited';

const RASAYESH_URL = 'https://api.rasayesh.com/graphql';
const MAX_RECHECK_ATTEMPTS = 3;

function rasayeshFetch(gqlQuery, variables, accessToken, eventOrigin) {
  return fetch(RASAYESH_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-rasayesh-site': 'event',
      'origin': eventOrigin,
      'referer': `${eventOrigin}/`,
      'lang': 'fa',
      'authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ query: gqlQuery, variables }),
    signal: AbortSignal.timeout(12000),
  }).then((r) => r.json());
}

const CHECK_ENROLLMENT_QUERY = `
  query ReferralRecheck($uuid: String!, $eventSlug: String!) {
    attendeeEventCard(eventSlug: $eventSlug, uuid: $uuid) {
      data {
        registrationPlan { id }
      }
    }
  }
`;

// Called fire-and-forget from AttendeeProvider on every fetchAttendee() --
// the only point a fresh, valid access token is guaranteed to be in hand,
// since tokens are never persisted server-side (no cron job calls this --
// see this feature's planning notes on why a time-based job couldn't work).
export async function POST(request) {
  let accessToken, uuid;
  try {
    ({ accessToken, uuid } = await request.json());
  } catch {
    return Response.json({ outcome: 'invalid_body' }, { status: 400 });
  }
  if (!accessToken || !uuid) {
    return Response.json({ outcome: 'missing_fields' }, { status: 400 });
  }

  try {
    const currentEventId = await getCurrentEventId();

    const pendingResult = await query(
      `SELECT id, referrer_user_uuid, recheck_attempts
       FROM quest_referral_redemptions
       WHERE event_id = $1 AND referee_user_uuid = $2 AND status = 'pending'`,
      [currentEventId, uuid]
    );
    if (pendingResult.rows.length === 0) {
      return Response.json({ outcome: 'no_pending' });
    }
    const redemption = pendingResult.rows[0];
    const nextAttempts = redemption.recheck_attempts + 1;

    const regResult = await query(
      "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'registration_config'",
      [currentEventId]
    );
    const regConfig = regResult.rows[0]?.value ?? {};
    const defaultPlanId = regConfig.auto_enroll_plan_id ? Number(regConfig.auto_enroll_plan_id) : null;
    const rasayeshEventId = regConfig.event_id ? Number(regConfig.event_id) : null;

    let checkResult = null;
    try {
      const eventInfo = await getRasayeshEventInfo(rasayeshEventId);
      checkResult = await rasayeshFetch(
        CHECK_ENROLLMENT_QUERY,
        { uuid, eventSlug: eventInfo.slug },
        accessToken,
        eventInfo.website
      );
      if (checkResult?.errors?.length) checkResult = null;
    } catch (err) {
      console.error('[referral/recheck-pending] check failed:', err.message);
      checkResult = null;
    }

    if (checkResult === null) {
      // Still inconclusive. Capped at MAX_RECHECK_ATTEMPTS -- force-resolve
      // to rejected rather than leaving it pending indefinitely.
      if (nextAttempts >= MAX_RECHECK_ATTEMPTS) {
        await query(
          `UPDATE quest_referral_redemptions
           SET status = 'rejected', reject_reason = 'recheck_exhausted', recheck_attempts = $1, resolved_at = NOW()
           WHERE id = $2`,
          [nextAttempts, redemption.id]
        );
        return Response.json({ outcome: 'rejected', reason: 'recheck_exhausted' });
      }
      await query(
        'UPDATE quest_referral_redemptions SET recheck_attempts = $1 WHERE id = $2',
        [nextAttempts, redemption.id]
      );
      return Response.json({ outcome: 'still_pending' });
    }

    const existingPlanId = checkResult?.data?.attendeeEventCard?.data?.registrationPlan?.id ?? null;
    const alreadyEnrolled = defaultPlanId ? existingPlanId === defaultPlanId : !!existingPlanId;

    if (alreadyEnrolled) {
      await query(
        `UPDATE quest_referral_redemptions
         SET status = 'rejected', reject_reason = 'already_enrolled', recheck_attempts = $1, resolved_at = NOW()
         WHERE id = $2`,
        [nextAttempts, redemption.id]
      );
      return Response.json({ outcome: 'already_enrolled' });
    }

    const lowestTier = await query(
      `SELECT referral_referee_xp FROM quest_content
       WHERE event_id = $1 AND mission_type = 'referral_code' AND is_active = true
         AND referral_required_count IS NOT NULL
       ORDER BY referral_required_count ASC LIMIT 1`,
      [currentEventId]
    );
    const refereeXp = lowestTier.rows[0]?.referral_referee_xp || 0;

    await query(
      `UPDATE quest_referral_redemptions
       SET status = 'confirmed', referee_xp_amount = $1, recheck_attempts = $2, resolved_at = NOW()
       WHERE id = $3`,
      [refereeXp, nextAttempts, redemption.id]
    );
    if (refereeXp > 0) {
      await query(
        `INSERT INTO quest_xp_grants (user_uuid, source_type, source_id, xp_amount, event_id)
         VALUES ($1, 'referral_referee', $2, $3, $4)
         ON CONFLICT (user_uuid, source_type, source_id) DO NOTHING`,
        [uuid, redemption.id, refereeXp, currentEventId]
      );
    }
    await evaluateReferralTiers(redemption.referrer_user_uuid, currentEventId);
    // Additive, independent reward path -- see lib/referralUnlimited.js.
    await grantUnlimitedReferralXp(redemption.referrer_user_uuid, currentEventId, redemption.id);

    return Response.json({ outcome: 'confirmed' });
  } catch (err) {
    console.error('[referral/recheck-pending] unexpected error:', err.message);
    return Response.json({ outcome: 'error' }, { status: 500 });
  }
}
