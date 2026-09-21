import { query } from '@/lib/db';
import { evaluateReferralTiers as evaluateSharedReferralTiers } from '@/lib/referralRewards';

// Runs after ANY of a referrer's redemptions transitions to 'confirmed' --
// called from both the synchronous redeem route and the async
// recheck-pending route, so the two trigger points can never diverge.
// Re-evaluates ALL of this referrer's active tier missions against their
// new cumulative confirmed count, not just the newest one -- this is what
// makes "jumped multiple thresholds at once" correct: every newly-
// qualifying tier gets granted in the same pass, not just the highest one.
export async function evaluateReferralTiers(referrerUuid, eventId) {
  return evaluateSharedReferralTiers(query, referrerUuid, eventId);
}
