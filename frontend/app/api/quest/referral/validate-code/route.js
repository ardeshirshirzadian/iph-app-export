import { query } from '@/lib/db';
import { getCurrentEventId } from '@/lib/currentEvent';

// Local-only, pre-OTP validation for the login step-1 "کد معرف دارم" modal.
// Never calls Rasayesh -- that can only happen post-auth (see
// referral/redeem/route.js), once a uuid + accessToken actually exist.
const RATE_LIMIT_MAX_FAILURES = 3;
const RATE_LIMIT_COOLDOWN_MS = 20 * 60 * 1000;

export async function POST(request) {
  let code, contact;
  try {
    ({ code, contact } = await request.json());
  } catch {
    return Response.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }
  if (!code || typeof code !== 'string' || !contact || typeof contact !== 'string') {
    return Response.json({ ok: false, error: 'missing_fields' }, { status: 400 });
  }

  const normalizedCode = code.trim().toUpperCase();
  const contactKey = contact.trim().toLowerCase();

  try {
    const eventId = await getCurrentEventId();

    const limitResult = await query(
      'SELECT fail_count, blocked_until FROM quest_referral_attempt_limits WHERE event_id = $1 AND contact_key = $2',
      [eventId, contactKey]
    );
    const limitRow = limitResult.rows[0];
    if (limitRow?.blocked_until && new Date(limitRow.blocked_until) > new Date()) {
      return Response.json({ ok: false, error: 'rate_limited' });
    }

    // Scoped to the raw contact string typed here, not IP -- this is a
    // conference app, so many attendees plausibly share venue WiFi/carrier
    // NAT, and an IP-scoped cap risks locking out innocent strangers on the
    // same network. This scope's own weakness (typing a different fake
    // number resets it) is accepted since the real deterrent is the code
    // keyspace size, not this cap.
    async function recordFailure() {
      const failCount = (limitRow?.fail_count || 0) + 1;
      if (failCount >= RATE_LIMIT_MAX_FAILURES) {
        await query(
          `INSERT INTO quest_referral_attempt_limits (event_id, contact_key, fail_count, first_fail_at, blocked_until)
           VALUES ($1, $2, 0, NOW(), $3)
           ON CONFLICT (event_id, contact_key) DO UPDATE
             SET fail_count = 0, blocked_until = $3, first_fail_at = NOW()`,
          [eventId, contactKey, new Date(Date.now() + RATE_LIMIT_COOLDOWN_MS)]
        );
      } else {
        await query(
          `INSERT INTO quest_referral_attempt_limits (event_id, contact_key, fail_count, first_fail_at)
           VALUES ($1, $2, 1, NOW())
           ON CONFLICT (event_id, contact_key) DO UPDATE
             SET fail_count = quest_referral_attempt_limits.fail_count + 1`,
          [eventId, contactKey]
        );
      }
    }

    const codeResult = await query(
      `SELECT rc.id, rc.owner_user_uuid, rc.is_active, rc.max_redemptions,
              (SELECT COUNT(*) FROM quest_referral_redemptions rr
               WHERE rr.code_id = rc.id AND rr.status != 'rejected') AS used_count
       FROM quest_referral_codes rc
       WHERE rc.event_id = $1 AND rc.code = $2`,
      [eventId, normalizedCode]
    );
    if (codeResult.rows.length === 0 || !codeResult.rows[0].is_active) {
      await recordFailure();
      return Response.json({ ok: false, error: 'invalid_code' });
    }
    const codeRow = codeResult.rows[0];
    if (codeRow.max_redemptions != null && parseInt(codeRow.used_count, 10) >= codeRow.max_redemptions) {
      await recordFailure();
      return Response.json({ ok: false, error: 'invalid_code' });
    }

    // Two genuinely separate questions, previously conflated into one query
    // -- bug found live 2026-09-17: with only an unlimited-mode mission
    // active, MAX(referral_required_count) is NULL (that mission legitimately
    // has no required_count), which the old code treated as "no active
    // mission at all" and rejected EVERY code system-wide with invalid_code,
    // even genuinely valid, active ones. Confirmed via direct calls against
    // three unrelated real codes, all failing identically.
    //
    // #1: is there any active referral_code mission at all (tiered or
    // unlimited)? This is the genuine fail-closed case -- shouldn't normally
    // be reachable (the login page's own referralCodeAvailable gate already
    // hides the entry point otherwise), but fail closed rather than let a
    // stale code through.
    const anyActiveResult = await query(
      `SELECT EXISTS (
         SELECT 1 FROM quest_content
         WHERE event_id = $1 AND mission_type = 'referral_code' AND is_active = true
       ) AS any_active`,
      [eventId]
    );
    if (!anyActiveResult.rows[0]?.any_active) {
      return Response.json({ ok: false, error: 'invalid_code' });
    }

    // #2: a code stops being redeemable once its owner's confirmed-referral
    // count reaches the highest required_count among currently ACTIVE
    // TIERED missions specifically (referral_is_unlimited excluded --
    // same exclusion as evaluateReferralTiers() on the iph-app side, for
    // the same reason: an unlimited mission's required_count is legitimately
    // NULL, not "zero capacity"). Deliberately computed live on every call,
    // not cached/stored as a static "exhausted" flag, so it self-corrects
    // the moment an admin activates/deactivates a tier. Independent of, and
    // not a replacement for, quest_referral_codes.max_redemptions above (an
    // unrelated, optional hard cap that's unset by default). If no active
    // tiered mission exists (e.g. only an unlimited mission is active),
    // there is no capacity ceiling to check -- skip straight past this.
    const maxTierResult = await query(
      `SELECT MAX(referral_required_count) AS max_required
       FROM quest_content
       WHERE event_id = $1 AND mission_type = 'referral_code' AND is_active = true
         AND (referral_is_unlimited = false OR referral_is_unlimited IS NULL)`,
      [eventId]
    );
    const maxRequired = maxTierResult.rows[0]?.max_required;
    if (maxRequired != null) {
      const ownerConfirmedResult = await query(
        `SELECT COUNT(*) FROM quest_referral_redemptions
         WHERE referrer_user_uuid = $1 AND event_id = $2 AND status = 'confirmed'`,
        [codeRow.owner_user_uuid, eventId]
      );
      if (parseInt(ownerConfirmedResult.rows[0].count, 10) >= maxRequired) {
        // Legitimate state, not a guess -- does not count toward the fail
        // counter, same reasoning as the duplicate-redemption guard below.
        return Response.json({ ok: false, error: 'code_capacity_reached' });
      }
    }

    // Local duplicate-redemption guard -- looked up by the raw, unverified
    // contact string against our own already-synced app_users data (no
    // Rasayesh call, no OTP needed; a pre-OTP identity-verified check isn't
    // possible at all -- see this feature's planning notes). Does NOT
    // increment the fail counter: the code itself was valid, this isn't a
    // guess.
    const isEmailContact = contact.includes('@');
    const userResult = await query(
      isEmailContact
        ? 'SELECT uuid FROM app_users WHERE event_id = $1 AND LOWER(email) = $2'
        : 'SELECT uuid FROM app_users WHERE event_id = $1 AND mobile = $2',
      [eventId, isEmailContact ? contactKey : contact.trim()]
    );
    if (userResult.rows.length > 0) {
      const dup = await query(
        'SELECT id FROM quest_referral_redemptions WHERE event_id = $1 AND referee_user_uuid = $2',
        [eventId, userResult.rows[0].uuid]
      );
      if (dup.rows.length > 0) {
        return Response.json({ ok: false, error: 'already_used' });
      }
    }

    return Response.json({ ok: true });
  } catch (err) {
    console.error('[referral/validate-code] error:', err.message);
    return Response.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
}
