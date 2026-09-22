import 'server-only';

import { revalidateTag } from 'next/cache';
import { query } from '@/lib/db';
import { isLatestAdminCorrection } from '@/lib/userDisplayNameLogic';

// app_users is event-scoped, unlike quest_user_names.  This is the one
// canonical lookup for names shown to the currently signed-in attendee.
// `isAdminCorrection` is true only while the stored names still equal the
// latest immutable correction audit entry. A later self-edit naturally
// makes it false without mutating the audit trail.
export async function getUserDisplayNames(eventId, userUuid) {
  const { rows } = await query(
    `SELECT id, firstname_fa, lastname_fa, firstname_en, lastname_en
       FROM app_users
      WHERE event_id = $1 AND uuid = $2
      LIMIT 1`,
    [eventId, userUuid]
  );
  const user = rows[0];
  if (!user) return null;

  let latestCorrection = null;
  try {
    const auditResult = await query(
      `SELECT new_values
         FROM user_name_correction_audit
        WHERE event_id = $1 AND user_id = $2
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [eventId, user.id]
    );
    latestCorrection = auditResult.rows[0]?.new_values ?? null;
  } catch (error) {
    // Older installations can still serve the current event-scoped names if
    // the optional correction-audit table has not been installed yet.
    if (error?.code !== '42P01') throw error;
  }

  const isAdminCorrection = isLatestAdminCorrection(user, latestCorrection);

  return {
    firstnameFa: user.firstname_fa ?? '',
    lastnameFa: user.lastname_fa ?? '',
    firstnameEn: user.firstname_en ?? '',
    lastnameEn: user.lastname_en ?? '',
    isAdminCorrection,
  };
}

// Profile, Badge, Quest stats, and Quest leaderboard read their name data
// per request. The Expo kiosk is the sole remaining cached display consumer;
// invalidate its existing shared tag after a committed name write so it does
// not retain the old name for its five-second safety-net window.
export function revalidateUserDisplayNames() {
  revalidateTag('expo-leaderboard', { expire: 0 });
}
