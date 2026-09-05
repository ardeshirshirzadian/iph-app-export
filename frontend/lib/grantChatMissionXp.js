import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { ensureBadgeProgressTable } from '@/lib/initQuestBadges';
import { getCurrentEventId } from '@/lib/currentEvent';

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

// Awards the "first chat" badge. Called once, at message-send time, from
// app/api/chat/route.js -- fires unconditionally, independent of whether the
// backend ever answers (exact match, RAG, fallback, queued, or total outage).
// Idempotent via quest_badge_progress's (badge_id, user_uuid) upsert.
export async function grantChatBadge() {
  try {
    const userUuid = await getUserUuid();
    if (!userUuid) return;
    const currentEventId = await getCurrentEventId();

    const { rows: badgeRows } = await query(
      `SELECT id FROM quest_badges
       WHERE badge_type = 'chat' AND is_active = true AND event_id = $1
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
    console.error('[grantChatBadge] failed to award first-chat badge:', err.message);
  }
}

// Awards the chat mission's XP. Called once a real answer exists -- an
// immediate reply (exact/RAG/fallback), or a queued reply that later
// resolves to 'done' -- from either backend. NOT called when both backends
// are unreachable (total outage, the catch-all 502 path in route.js).
// Idempotent via quest_xp_grants' (user_uuid, source_type, source_id)
// unique index (ON CONFLICT DO NOTHING).
export async function grantChatMissionXp() {
  try {
    const userUuid = await getUserUuid();
    if (!userUuid) return;
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
  } catch (err) {
    console.error('[grantChatMissionXp] failed to award chat mission XP:', err.message);
  }
}
