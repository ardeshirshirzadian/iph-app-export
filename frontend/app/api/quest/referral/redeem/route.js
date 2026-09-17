import { query } from '@/lib/db';
import { getRasayeshEventInfo } from '@/lib/publicRasayeshClient';
import { getCurrentEventId } from '@/lib/currentEvent';
import { evaluateReferralTiers } from '@/lib/referralTiers';
import { grantUnlimitedReferralXp } from '@/lib/referralUnlimited';

const RASAYESH_URL = 'https://api.rasayesh.com/graphql';

// Same shape as auto-enroll/route.js's rasayeshFetch -- 'event' site header
// + a real accessToken, since attendeeEventCard needs the caller to be an
// authenticated attendee.
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
  query ReferralEnrollmentCheck($uuid: String!, $eventSlug: String!) {
    attendeeEventCard(eventSlug: $eventSlug, uuid: $uuid) {
      data {
        registrationPlan { id }
      }
    }
  }
`;

// Called synchronously right after OTP verification (existing account) or
// attendeeRegister (new account) succeeds, before finalizeSession/redirect
// proceeds -- must never throw in a way that blocks login; any unexpected
// failure degrades to a 'pending' row rather than an error the caller has
// to handle specially.
export async function POST(request) {
  let code, accessToken, uuid;
  try {
    ({ code, accessToken, uuid } = await request.json());
  } catch {
    return Response.json({ outcome: 'error' }, { status: 400 });
  }
  if (!code || !accessToken || !uuid) {
    return Response.json({ outcome: 'error' }, { status: 400 });
  }

  let currentEventId, codeRow;
  try {
    currentEventId = await getCurrentEventId();

    // Authoritative, uuid-keyed duplicate-redemption guard (the step-1 modal
    // already checked this pre-auth against a self-reported contact string --
    // this is the real one).
    const existing = await query(
      'SELECT id FROM quest_referral_redemptions WHERE event_id = $1 AND referee_user_uuid = $2',
      [currentEventId, uuid]
    );
    if (existing.rows.length > 0) {
      return Response.json({ outcome: 'already_used' });
    }

    const codeResult = await query(
      `SELECT id, owner_user_uuid, is_active FROM quest_referral_codes WHERE event_id = $1 AND code = $2`,
      [currentEventId, String(code).trim().toUpperCase()]
    );
    if (codeResult.rows.length === 0 || !codeResult.rows[0].is_active) {
      return Response.json({ outcome: 'invalid_code' });
    }
    codeRow = codeResult.rows[0];
  } catch (err) {
    console.error('[referral/redeem] setup error:', err.message);
    return Response.json({ outcome: 'error' });
  }

  async function insertPending() {
    try {
      await query(
        `INSERT INTO quest_referral_redemptions
           (event_id, code_id, referrer_user_uuid, referee_user_uuid, status)
         VALUES ($1, $2, $3, $4, 'pending')`,
        [currentEventId, codeRow.id, codeRow.owner_user_uuid, uuid]
      );
    } catch (err) {
      console.error('[referral/redeem] insertPending failed:', err.message);
    }
    return Response.json({ outcome: 'pending' });
  }

  try {
    const regResult = await query(
      "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'registration_config'",
      [currentEventId]
    );
    const regConfig = regResult.rows[0]?.value ?? {};
    const defaultPlanId = regConfig.auto_enroll_plan_id ? Number(regConfig.auto_enroll_plan_id) : null;
    const rasayeshEventId = regConfig.event_id ? Number(regConfig.event_id) : null;

    let eventOrigin, eventSlug;
    try {
      const eventInfo = await getRasayeshEventInfo(rasayeshEventId);
      eventOrigin = eventInfo.website;
      eventSlug = eventInfo.slug;
    } catch (err) {
      console.error('[referral/redeem] event lookup failed:', err.message);
      return insertPending();
    }

    let checkResult;
    try {
      checkResult = await rasayeshFetch(CHECK_ENROLLMENT_QUERY, { uuid, eventSlug }, accessToken, eventOrigin);
    } catch (err) {
      console.error('[referral/redeem] attendeeEventCard call failed:', err.message);
      return insertPending();
    }
    if (checkResult?.errors?.length) {
      console.error('[referral/redeem] attendeeEventCard GraphQL error:', checkResult.errors[0]?.message);
      return insertPending();
    }

    const existingPlanId = checkResult?.data?.attendeeEventCard?.data?.registrationPlan?.id ?? null;
    // If no default plan is configured for this event, fall back to "any
    // existing plan counts as enrolled" -- the same gate auto-enroll/route.js
    // already uses for its own check (existingPlan truthy -> skip), reused
    // here rather than leaving the comparison undefined.
    const alreadyEnrolled = defaultPlanId
      ? existingPlanId === defaultPlanId
      : !!existingPlanId;

    if (alreadyEnrolled) {
      await query(
        `INSERT INTO quest_referral_redemptions
           (event_id, code_id, referrer_user_uuid, referee_user_uuid, status, reject_reason, resolved_at)
         VALUES ($1, $2, $3, $4, 'rejected', 'already_enrolled', NOW())`,
        [currentEventId, codeRow.id, codeRow.owner_user_uuid, uuid]
      );
      return Response.json({ outcome: 'already_enrolled' });
    }

    // Not enrolled -- confirm. Referee gets a flat one-time XP amount --
    // referral_referee_xp isn't mode-specific (unlike referral_per_invite_xp/
    // referral_referrer_xp), so any active referral_code mission is a valid
    // source; prefer the lowest-threshold TIERED mission when one exists
    // (NULLS LAST), otherwise fall back to an active unlimited mission's own
    // referee_xp. Previously required referral_required_count IS NOT NULL,
    // which excluded unlimited-only events entirely and silently paid
    // referees 0 XP -- found live 2026-09-17, same root cause as
    // validate-code/route.js's capacity-check bug. Referrer's reward is
    // tiered/unlimited, evaluated separately below.
    const lowestTier = await query(
      `SELECT referral_referee_xp FROM quest_content
       WHERE event_id = $1 AND mission_type = 'referral_code' AND is_active = true
       ORDER BY referral_required_count ASC NULLS LAST LIMIT 1`,
      [currentEventId]
    );
    const refereeXp = lowestTier.rows[0]?.referral_referee_xp || 0;

    const insertResult = await query(
      `INSERT INTO quest_referral_redemptions
         (event_id, code_id, referrer_user_uuid, referee_user_uuid, status, referee_xp_amount, resolved_at)
       VALUES ($1, $2, $3, $4, 'confirmed', $5, NOW())
       RETURNING id`,
      [currentEventId, codeRow.id, codeRow.owner_user_uuid, uuid, refereeXp]
    );
    const redemptionId = insertResult.rows[0].id;

    if (refereeXp > 0) {
      await query(
        `INSERT INTO quest_xp_grants (user_uuid, source_type, source_id, xp_amount, event_id)
         VALUES ($1, 'referral_referee', $2, $3, $4)
         ON CONFLICT (user_uuid, source_type, source_id) DO NOTHING`,
        [uuid, redemptionId, refereeXp, currentEventId]
      );
    }

    await evaluateReferralTiers(codeRow.owner_user_uuid, currentEventId);
    // Additive, independent reward path -- see lib/referralUnlimited.js.
    // Never blocks or interferes with the tiered grant above.
    await grantUnlimitedReferralXp(codeRow.owner_user_uuid, currentEventId, redemptionId);

    return Response.json({ outcome: 'confirmed' });
  } catch (err) {
    console.error('[referral/redeem] unexpected error:', err.message);
    return insertPending();
  }
}
