import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { ensureBadgeProgressTable } from '@/lib/initQuestBadges';
import { getCurrentEventId } from '@/lib/currentEvent';

export async function grantChatMissionXp() {
  try {
    const cookieStore = await cookies();
    const userRaw = cookieStore.get('iph_user')?.value;
    let userUuid;
    try {
      const user = JSON.parse(decodeURIComponent(userRaw));
      userUuid = user?.uuid || null;
    } catch {
      userUuid = null;
    }
    if (!userUuid) return;

    // Both callers (app/api/chat/route.js, app/api/chat/status/[queueId]/route.js)
    // already `await` this function mid-request rather than firing it off
    // detached, so resolving getCurrentEventId() here is safe -- and matches
    // this codebase's established convention (see chat/route.js's own
    // comment) of re-resolving event_id at every server touchpoint instead
    // of threading a single value through as a parameter.
    const currentEventId = await getCurrentEventId();

    const { rows } = await query(
      `SELECT id, xp_reward FROM quest_content
       WHERE mission_type = 'chat' AND is_active = true AND event_id = $1
       LIMIT 1`,
      [currentEventId]
    );
    if (!rows.length) return;
    const { id: missionId, xp_reward: xpReward } = rows[0];

    await query(
      `INSERT INTO quest_xp_grants (user_uuid, source_type, source_id, xp_amount, event_id)
       VALUES ($1, 'mission_chat', $2, $3, $4)
       ON CONFLICT (user_uuid, source_type, source_id) DO NOTHING`,
      [userUuid, missionId, xpReward, currentEventId]
    );
    await query(
      `INSERT INTO quest_user_progress (mission_id, user_uuid, completed, completed_at)
       VALUES ($1, $2, true, NOW())
       ON CONFLICT (mission_id, user_uuid) DO UPDATE SET completed = true, completed_at = NOW()`,
      [missionId, userUuid]
    );

    const { rows: badgeRows } = await query(
      `SELECT id FROM quest_badges
       WHERE badge_type = 'chat' AND is_active = true AND event_id = $1
       LIMIT 1`,
      [currentEventId]
    );
    if (badgeRows.length) {
      await ensureBadgeProgressTable();
      await query(
        `INSERT INTO quest_badge_progress (badge_id, user_uuid, earned, earned_at, event_id)
         VALUES ($1, $2, true, NOW(), $3)
         ON CONFLICT (badge_id, user_uuid) DO UPDATE SET earned = true, earned_at = NOW()`,
        [badgeRows[0].id, userUuid, currentEventId]
      );
    }
  } catch {
    // Never block or alter the chat response on quest errors
  }
}
