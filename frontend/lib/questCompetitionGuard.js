// Canonical "is the quest competition still open for XP/progress" guard.
// Duplicated verbatim between iph-app and iph-apn (same convention as
// lib/referralRewards.js — these are separate deployables with no shared
// import path). If this logic changes, update both copies.
//
// quest_ended_at / quest_end_scheduled_at live on `events` (timestamptz).
// "Effective end" = quest_ended_at if set, else quest_end_scheduled_at if
// that instant has already passed. This mirrors the quest_effective_end()
// SQL function used by the DB trigger backstop (migrate-quest-end-competition.js)
// — kept in sync deliberately, computed here in JS rather than calling the
// SQL function so this module has no hard dependency on the migration
// having run under that exact function name.
import { query } from '@/lib/db';

export async function getQuestEndState(eventId) {
  const { rows } = await query(
    'SELECT quest_ended_at, quest_end_scheduled_at FROM events WHERE id = $1',
    [eventId]
  );
  const row = rows[0] || {};
  const endedAt = row.quest_ended_at || null;
  const scheduledAt = row.quest_end_scheduled_at || null;
  let effectiveEnd = endedAt;
  if (!effectiveEnd && scheduledAt && new Date(scheduledAt).getTime() <= Date.now()) {
    effectiveEnd = scheduledAt;
  }
  return { endedAt, scheduledAt, effectiveEnd };
}

export async function isQuestEndedNow(eventId) {
  const { effectiveEnd } = await getQuestEndState(eventId);
  return effectiveEnd !== null;
}

// Used by approval-style paths (social-share approve, referral redeem/assign)
// that must honor "submitted/redeemed before the end still counts if
// approved later" — pass the ORIGINAL action's timestamp
// (submitted_at/created_at), never NOW().
export async function isTimestampEligible(eventId, ts) {
  if (!ts) return false;
  const { effectiveEnd } = await getQuestEndState(eventId);
  if (!effectiveEnd) return true;
  return new Date(ts).getTime() <= new Date(effectiveEnd).getTime();
}
