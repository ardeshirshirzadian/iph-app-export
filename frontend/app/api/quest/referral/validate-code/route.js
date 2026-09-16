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
      `SELECT rc.id, rc.is_active, rc.max_redemptions,
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
