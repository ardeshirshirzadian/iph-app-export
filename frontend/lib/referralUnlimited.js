import { query } from '@/lib/db';

// Runs after ANY of a referrer's redemptions transitions to 'confirmed' --
// called from both the synchronous redeem route and the async
// recheck-pending route, alongside (not instead of) evaluateReferralTiers().
// A referrer's code can carry both an active tiered mission and an active
// unlimited-mode mission at once (they're independent quest_content rows).
// evaluateReferralTiers() now explicitly excludes referral_is_unlimited=true
// rows (not just `referral_required_count IS NOT NULL`, which this comment
// used to (incorrectly) claim was already sufficient -- a since-fixed
// admin-route bug could leave an unlimited mission with a leftover non-NULL
// required_count, and on 2026-09-17 that let this same row double-grant:
// this function's per-invite reward AND evaluateReferralTiers()' one-time
// "tier" reward, on top of each other, for two real referrers) -- this
// grants the unlimited-mode reward for exactly this one redemption, every
// time, no threshold, no cap.
//
// Assumption: at most one active referral_is_unlimited mission exists per
// event at a time. If two were ever simultaneously active, both would
// attempt the same (user_uuid, source_type, source_id) tuple below (keyed
// by this redemption's id, not the mission's), so only the first would
// actually grant -- not a crash, but not additive either. Enforced at
// save-time in iph-apn's admin routes (see quest-missions POST/[id] PUT),
// not re-checked here.
export async function grantUnlimitedReferralXp(referrerUuid, eventId, redemptionId) {
  const { rows } = await query(
    `SELECT referral_per_invite_xp FROM quest_content
     WHERE event_id = $1 AND mission_type = 'referral_code' AND is_active = true
       AND referral_is_unlimited = true
     LIMIT 1`,
    [eventId]
  );
  if (rows.length === 0) return;
  const perInviteXp = rows[0].referral_per_invite_xp || 0;
  if (perInviteXp <= 0) return;

  // quest_xp_grants' (user_uuid, source_type, source_id) unique index is the
  // idempotency guard, same pattern evaluateReferralTiers()/
  // grantProfilePhotoMissionXp() already use -- keyed by redemptionId (not
  // missionId), since this reward repeats once per redemption rather than
  // once per mission/tier.
  await query(
    `INSERT INTO quest_xp_grants (user_uuid, source_type, source_id, xp_amount, event_id)
     VALUES ($1, 'referral_referrer_unlimited', $2, $3, $4)
     ON CONFLICT (user_uuid, source_type, source_id) DO NOTHING`,
    [referrerUuid, redemptionId, perInviteXp, eventId]
  );
}

// Shared gate: is there a currently active unlimited-mode referral_code
// mission for this event? Used by both the leaderboard route (Part 2a's
// per-row count + Part 2b's new segment/tab) and the segment's own public
// config route, so the two can never disagree about whether the feature is
// "on" -- same "invisible and inert when not applicable" principle as the
// login page's referralCodeAvailable check.
export async function isUnlimitedReferralActive(eventId) {
  try {
    const { rows } = await query(
      `SELECT EXISTS (
         SELECT 1 FROM quest_content
         WHERE event_id = $1 AND mission_type = 'referral_code'
           AND referral_is_unlimited = true AND is_active = true
       ) AS active`,
      [eventId]
    );
    return rows[0]?.active === true;
  } catch {
    return false;
  }
}
