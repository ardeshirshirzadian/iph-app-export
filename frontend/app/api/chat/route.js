import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { ensureBadgeProgressTable } from '@/lib/initQuestBadges';

async function grantChatMissionXp() {
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

export async function POST(request) {
  const body = await request.json();

  const PRIMARY_URL = 'http://93.118.140.186:18085/chat';   // سرور GPU شرکت
  const FALLBACK_URL = 'http://172.17.0.1:8000/chat';        // بک‌اند لوکال VPS (CPU)

  async function tryFetch(url, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`status ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  try {
    const data = await tryFetch(PRIMARY_URL, 15_000);
    await grantChatMissionXp();
    return Response.json(data);
  } catch (primaryErr) {
    console.warn('Primary chatbot backend (GPU server) failed, falling back to VPS:', primaryErr.message);
    try {
      const data = await tryFetch(FALLBACK_URL, 90_000);
      await grantChatMissionXp();
      return Response.json(data);
    } catch (fallbackErr) {
      console.error('Fallback chatbot backend (VPS) also failed:', fallbackErr.message);
      return Response.json(
        { answer: 'خطا در ارتباط با سرور. لطفاً دوباره تلاش کنید.' },
        { status: 502 }
      );
    }
  }
}
