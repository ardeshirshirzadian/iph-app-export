import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { ensureBadgeProgressTable } from '@/lib/initQuestBadges';

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

    const { rows } = await query(
      `SELECT id, xp_reward FROM quest_content
       WHERE mission_type = 'chat' AND is_active = true
       LIMIT 1`
    );
    if (!rows.length) return;
    const { id: missionId, xp_reward: xpReward } = rows[0];

    await query(
      `INSERT INTO quest_xp_grants (user_uuid, source_type, source_id, xp_amount)
       VALUES ($1, 'mission_chat', $2, $3)
       ON CONFLICT (user_uuid, source_type, source_id) DO NOTHING`,
      [userUuid, missionId, xpReward]
    );
    await query(
      `INSERT INTO quest_user_progress (mission_id, user_uuid, completed, completed_at)
       VALUES ($1, $2, true, NOW())
       ON CONFLICT (mission_id, user_uuid) DO UPDATE SET completed = true, completed_at = NOW()`,
      [missionId, userUuid]
    );

    const { rows: badgeRows } = await query(
      `SELECT id FROM quest_badges
       WHERE badge_type = 'chat' AND is_active = true
       LIMIT 1`
    );
    if (badgeRows.length) {
      await ensureBadgeProgressTable();
      await query(
        `INSERT INTO quest_badge_progress (badge_id, user_uuid, earned, earned_at)
         VALUES ($1, $2, true, NOW())
         ON CONFLICT (badge_id, user_uuid) DO UPDATE SET earned = true, earned_at = NOW()`,
        [badgeRows[0].id, userUuid]
      );
    }
  } catch {
    // Never block or alter the chat response on quest errors
  }
}
