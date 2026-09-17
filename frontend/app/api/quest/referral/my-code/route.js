import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { getCurrentEventId } from '@/lib/currentEvent';
import { getOrCreateReferralCode } from '@/lib/referralCode';

// Admin-editable via iph-apn's Quest -> ظاهر tab (referral_status_messages_
// config, /api/admin/quest-referral-status-messages). These are also the
// literal strings QuestClient.js hardcoded before this became configurable,
// so any field an admin hasn't touched (or has cleared) falls back to
// byte-identical text -- the merge below never lets a missing/blank stored
// field surface as an empty message.
const STATUS_MESSAGE_DEFAULTS = {
  confirmed_fa: 'شما هم با یک کد معرف ثبت‌نام کرده‌اید ✓',
  confirmed_en: 'You also signed up with a referral code ✓',
  pending_fa: 'کد معرفی که وارد کرده‌اید در حال بررسی است',
  pending_en: 'The referral code you entered is still being checked',
  rejected_fa: 'کد معرفی که وارد کرده بودید تأیید نشد',
  rejected_en: 'The referral code you entered was not confirmed',
};

// Admin-editable (same Quest -> ظاهر tab, referral_reward_labels_config,
// /api/admin/quest-referral-reward-labels) captions for the two reward-
// amount stat boxes ReferralModal shows. Only the caption text is
// configurable here -- the XP numbers themselves are always computed live
// from quest_content below, never admin-typed.
const REWARD_LABEL_DEFAULTS = {
  referrer_fa: 'امتیاز به ازای هر دعوت',
  referrer_en: 'per invite',
  referee_fa: 'امتیاز دعوت‌شده',
  referee_en: 'for your friend',
};

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

    // LEFT JOIN so a referrer whose app_users row is somehow gone (event
    // switch, data cleanup) still returns the redemption's own status --
    // only the name fields go blank, same graceful-degradation posture as
    // everything else in this route.
    const ownRedemptionResult = await query(
      `SELECT r.status, u.firstname_fa, u.lastname_fa, u.firstname_en, u.lastname_en
       FROM quest_referral_redemptions r
       LEFT JOIN app_users u ON u.uuid = r.referrer_user_uuid AND u.event_id = r.event_id
       WHERE r.event_id = $1 AND r.referee_user_uuid = $2`,
      [eventId, uuid]
    );
    const ownRow = ownRedemptionResult.rows[0] || null;
    // Same either-language-fills-in-for-the-other fallback as the sponsor
    // name resolution elsewhere in this feature (brand_name_en || brand_name_fa
    // and vice versa) -- a referrer with only one language on file still gets
    // named instead of the message rendering blank.
    const referrerNameFaRaw = ownRow ? `${ownRow.firstname_fa || ''} ${ownRow.lastname_fa || ''}`.trim() : '';
    const referrerNameEnRaw = ownRow ? `${ownRow.firstname_en || ''} ${ownRow.lastname_en || ''}`.trim() : '';

    const messagesResult = await query(
      `SELECT value FROM app_settings WHERE event_id = $1 AND key = 'referral_status_messages_config'`,
      [eventId]
    );
    const storedMessages = messagesResult.rows[0]?.value || {};
    const status_messages = {};
    for (const key of Object.keys(STATUS_MESSAGE_DEFAULTS)) {
      status_messages[key] = storedMessages[key] || STATUS_MESSAGE_DEFAULTS[key];
    }

    const labelsResult = await query(
      `SELECT value FROM app_settings WHERE event_id = $1 AND key = 'referral_reward_labels_config'`,
      [eventId]
    );
    const storedLabels = labelsResult.rows[0]?.value || {};
    const reward_labels = {};
    for (const key of Object.keys(REWARD_LABEL_DEFAULTS)) {
      reward_labels[key] = storedLabels[key] || REWARD_LABEL_DEFAULTS[key];
    }

    // Every currently-active referral_code mission for this event, in one
    // query. Unlimited-mode row (referral_is_unlimited) is checked first and
    // takes priority for the referrer stat when present -- same precedence
    // grantUnlimitedReferralXp() gives it over evaluateReferralTiers() at
    // grant time (see that file's own comment on the "at most one active
    // unlimited mission" assumption). referee_xp reuses the exact same
    // "lowest active required_count row" the redeem route itself pays out
    // from (referral/redeem/route.js's `lowestTier` query), just read off
    // this one shared fetch instead of a second query, so the displayed
    // number can never drift from what a real redemption actually grants.
    const rewardRows = await query(
      `SELECT referral_is_unlimited, referral_required_count, referral_referrer_xp, referral_referee_xp, referral_per_invite_xp
       FROM quest_content
       WHERE event_id = $1 AND mission_type = 'referral_code' AND is_active = true
       ORDER BY referral_required_count ASC NULLS LAST`,
      [eventId]
    );
    const unlimitedRow = rewardRows.rows.find((r) => r.referral_is_unlimited === true) || null;
    const tierRows = rewardRows.rows.filter((r) => !r.referral_is_unlimited && r.referral_required_count != null);
    // referral_referee_xp isn't mode-specific (unlike referral_per_invite_xp/
    // referral_referrer_xp) -- it's a flat one-time reward that exists on
    // every active referral_code row regardless of tiered vs unlimited, so
    // the source row is just "the first row" of this already-correctly-
    // ordered (ASC NULLS LAST) result: lowest tier if any tiered mission is
    // active, or the (only) unlimited row as a valid fallback otherwise.
    // Previously filtered to `referral_required_count != null`, which
    // excluded unlimited-only events entirely -- found live 2026-09-17 (same
    // root cause as redeem/route.js's identical bug): with only an unlimited
    // mission active, this returned null, silently showing referee_xp: 0.
    const refereeSourceRow = rewardRows.rows[0] || null;

    const referrerReward = unlimitedRow
      ? { mode: 'unlimited', per_invite_xp: unlimitedRow.referral_per_invite_xp || 0 }
      : tierRows.length > 0
        ? { mode: 'tiers', tiers: tierRows.map((r) => ({ required_count: r.referral_required_count, xp: r.referral_referrer_xp || 0 })) }
        : null;

    const referral_rewards = {
      referrer: referrerReward,
      referee_xp: refereeSourceRow?.referral_referee_xp || 0,
    };

    return Response.json({
      code,
      confirmed_count: parseInt(counts.confirmed_count, 10) || 0,
      pending_count: parseInt(counts.pending_count, 10) || 0,
      rejected_count: parseInt(counts.rejected_count, 10) || 0,
      own_redemption_status: ownRow?.status || null,
      referrer_name_fa: referrerNameFaRaw || referrerNameEnRaw,
      referrer_name_en: referrerNameEnRaw || referrerNameFaRaw,
      status_messages,
      referral_rewards,
      reward_labels,
    });
  } catch (err) {
    console.error('[referral/my-code] error:', err.message);
    return Response.json({ error: 'server_error' }, { status: 500 });
  }
}
