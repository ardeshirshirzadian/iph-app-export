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

    return Response.json({
      code,
      confirmed_count: parseInt(counts.confirmed_count, 10) || 0,
      pending_count: parseInt(counts.pending_count, 10) || 0,
      rejected_count: parseInt(counts.rejected_count, 10) || 0,
      own_redemption_status: ownRow?.status || null,
      referrer_name_fa: referrerNameFaRaw || referrerNameEnRaw,
      referrer_name_en: referrerNameEnRaw || referrerNameFaRaw,
      status_messages,
    });
  } catch (err) {
    console.error('[referral/my-code] error:', err.message);
    return Response.json({ error: 'server_error' }, { status: 500 });
  }
}
