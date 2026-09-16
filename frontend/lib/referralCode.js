import { query } from '@/lib/db';

// Charset excludes visually-ambiguous characters -- digits 0/1 and letters
// I/L/O are never used, so a human reading a code aloud or typing it back
// in never has to guess which character was meant. 6 chars from this
// 31-character alphabet is ~887M combinations.
const CODE_CHARSET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 6;
const MAX_GENERATION_ATTEMPTS = 5;

function randomCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARSET[Math.floor(Math.random() * CODE_CHARSET.length)];
  }
  return code;
}

// Idempotent: returns the caller's existing code if one already exists for
// this event, otherwise generates and inserts a new one. Shared by both the
// eager trigger (finalize-login's upsertAppUser, for brand-new users) and
// the lazy trigger (referral/my-code/route.js, for every pre-existing user
// who predates this feature) -- kept as one function so those two paths can
// never diverge in behavior.
export async function getOrCreateReferralCode(eventId, uuid) {
  const existing = await query(
    'SELECT code FROM quest_referral_codes WHERE event_id = $1 AND owner_user_uuid = $2',
    [eventId, uuid]
  );
  if (existing.rows.length > 0) return existing.rows[0].code;

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const candidate = randomCode();
    try {
      const { rows } = await query(
        `INSERT INTO quest_referral_codes (event_id, owner_user_uuid, code)
         VALUES ($1, $2, $3)
         ON CONFLICT (event_id, owner_user_uuid) DO NOTHING
         RETURNING code`,
        [eventId, uuid, candidate]
      );
      if (rows.length > 0) return rows[0].code;
      // Conflict was on (event_id, owner_user_uuid) -- a concurrent call
      // already created this user's code, not a code collision. Read it back.
      const nowExisting = await query(
        'SELECT code FROM quest_referral_codes WHERE event_id = $1 AND owner_user_uuid = $2',
        [eventId, uuid]
      );
      if (nowExisting.rows.length > 0) return nowExisting.rows[0].code;
    } catch (err) {
      // Unique violation (23505) on (event_id, code) specifically -- the
      // random code itself collided with someone else's, retry with a new
      // one. Any other error propagates.
      if (err.code !== '23505') throw err;
    }
  }
  throw new Error(`[getOrCreateReferralCode] failed to generate a unique code after ${MAX_GENERATION_ATTEMPTS} attempts`);
}
