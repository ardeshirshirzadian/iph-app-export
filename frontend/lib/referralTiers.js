import { query } from '@/lib/db';

// Runs after ANY of a referrer's redemptions transitions to 'confirmed' --
// called from both the synchronous redeem route and the async
// recheck-pending route, so the two trigger points can never diverge.
// Re-evaluates ALL of this referrer's active tier missions against their
// new cumulative confirmed count, not just the newest one -- this is what
// makes "jumped multiple thresholds at once" correct: every newly-
// qualifying tier gets granted in the same pass, not just the highest one.
export async function evaluateReferralTiers(referrerUuid, eventId) {
  const { rows: countRows } = await query(
    `SELECT COUNT(*) FROM quest_referral_redemptions
     WHERE referrer_user_uuid = $1 AND event_id = $2 AND status = 'confirmed'`,
    [referrerUuid, eventId]
  );
  const confirmedCount = parseInt(countRows[0].count, 10);

  // referral_is_unlimited exclusion is defense in depth, not just belt-and-
  // suspenders: referral_required_count IS NOT NULL alone let a mission
  // that was BOTH unlimited and (due to a since-fixed admin-route bug)
  // stuck with a leftover required_count get double-counted here AND by
  // grantUnlimitedReferralXp() -- see that file's own comment, which used
  // to (incorrectly) claim this filter alone already excluded unlimited
  // rows. Confirmed live 2026-09-17: exactly this double-grant paid two
  // referrers a one-time extra 250xp on top of their correct per-invite
  // unlimited reward.
  const { rows: tiers } = await query(
    `SELECT id, referral_required_count, referral_referrer_xp
     FROM quest_content
     WHERE event_id = $1 AND mission_type = 'referral_code' AND is_active = true
       AND referral_required_count IS NOT NULL
       AND (referral_is_unlimited = false OR referral_is_unlimited IS NULL)
     ORDER BY referral_required_count ASC`,
    [eventId]
  );

  for (const tier of tiers) {
    if (tier.referral_required_count > confirmedCount) continue;

    // quest_xp_grants' (user_uuid, source_type, source_id) unique index is
    // the idempotency guard -- ON CONFLICT DO NOTHING means re-running this
    // loop for an already-granted tier is always a safe no-op, the exact
    // same pattern grantProfilePhotoMissionXp() already uses elsewhere.
    const { rowCount } = await query(
      `INSERT INTO quest_xp_grants (user_uuid, source_type, source_id, xp_amount, event_id)
       VALUES ($1, 'referral_referrer_tier', $2, $3, $4)
       ON CONFLICT (user_uuid, source_type, source_id) DO NOTHING`,
      [referrerUuid, tier.id, tier.referral_referrer_xp || 0, eventId]
    );
    if (rowCount > 0) {
      await query(
        `INSERT INTO quest_user_progress (mission_id, user_uuid, completed, completed_at)
         VALUES ($1, $2, true, NOW())
         ON CONFLICT (mission_id, user_uuid) DO UPDATE SET completed = true, completed_at = NOW()`,
        [tier.id, referrerUuid]
      );
    }
  }
}
