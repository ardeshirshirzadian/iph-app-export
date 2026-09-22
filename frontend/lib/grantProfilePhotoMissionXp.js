import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { ensureBadgeProgressTable } from '@/lib/initQuestBadges';
import { getCurrentEventId } from '@/lib/currentEvent';
import { recordMissionHistory } from '@/lib/questMissionHistory';

async function getUserUuid() {
  const cookieStore = await cookies();
  const userRaw = cookieStore.get('iph_user')?.value;
  try {
    const user = JSON.parse(decodeURIComponent(userRaw));
    return user?.uuid || null;
  } catch {
    return null;
  }
}

// Awards the "profile photo uploaded" badge. Mirrors grantChatBadge(): fired
// from app/api/auth/sync-profile-photo/route.js the moment a photo is
// confirmed present on the account -- which runs on every fetchAttendee /
// refetch, so it also gives retroactive credit to users who already had a
// photo. Idempotent via quest_badge_progress's (badge_id, user_uuid) upsert,
// and re-grants naturally after an admin score reset (that DELETEs the row
// without dropping the constraint). No-op until an admin creates a
// badge_type='profile_photo' badge for the event.
export async function grantProfilePhotoBadge() {
  try {
    const userUuid = await getUserUuid();
    if (!userUuid) return;
    const currentEventId = await getCurrentEventId();

    const { rows: badgeRows } = await query(
      `SELECT id FROM quest_badges
       WHERE badge_type = 'profile_photo' AND is_active = true AND event_id = $1
       LIMIT 1`,
      [currentEventId]
    );
    if (!badgeRows.length) return;

    await ensureBadgeProgressTable();
    await query(
      `INSERT INTO quest_badge_progress (badge_id, user_uuid, earned, earned_at, event_id)
       VALUES ($1, $2, true, NOW(), $3)
       ON CONFLICT (badge_id, user_uuid) DO UPDATE SET earned = true, earned_at = NOW()`,
      [badgeRows[0].id, userUuid, currentEventId]
    );
  } catch (err) {
    console.error('[grantProfilePhotoBadge] failed to award profile-photo badge:', err.message);
  }
}

// Awards the profile-photo mission's XP. Mirrors grantChatMissionXp(): keyed
// on source_id = missionId (constant), so re-uploads are no-ops and XP is
// granted exactly once per user per event. Idempotent via quest_xp_grants'
// (user_uuid, source_type, source_id) unique index (ON CONFLICT DO NOTHING);
// re-grants naturally after an admin score reset. No-op until an admin
// creates a mission_type='profile_photo' mission for the event.
export async function grantProfilePhotoMissionXp() {
  try {
    const userUuid = await getUserUuid();
    if (!userUuid) return;
    const currentEventId = await getCurrentEventId();

    const { rows } = await query(
      `SELECT id, xp_reward FROM quest_content
       WHERE mission_type = 'profile_photo' AND is_active = true AND event_id = $1
       LIMIT 1`,
      [currentEventId]
    );
    if (!rows.length) return;
    const { id: missionId, xp_reward: xpReward } = rows[0];

    await query(
      `INSERT INTO quest_xp_grants (user_uuid, source_type, source_id, xp_amount, event_id)
       VALUES ($1, 'mission_profile_photo', $2, $3, $4)
       ON CONFLICT (user_uuid, source_type, source_id) DO NOTHING`,
      [userUuid, missionId, xpReward, currentEventId]
    );
    await query(
      `INSERT INTO quest_user_progress (mission_id, user_uuid, completed, completed_at)
       VALUES ($1, $2, true, NOW())
       ON CONFLICT (mission_id, user_uuid) DO UPDATE SET completed = true, completed_at = NOW()`,
      [missionId, userUuid]
    );
    await recordMissionHistory(query, {
      eventId: currentEventId, missionId, userUuid, status: 'completed', evidenceType: 'profile_photo',
    });
  } catch (err) {
    console.error('[grantProfilePhotoMissionXp] failed to award profile-photo mission XP:', err.message);
  }
}
