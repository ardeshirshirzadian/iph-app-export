import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { ensureAttendanceLogTable } from '@/lib/initQuestBadges';
import { getCurrentEventId } from '@/lib/currentEvent';

export async function POST() {
  const cookieStore = await cookies();
  const raw = cookieStore.get('iph_user')?.value;
  let userUuid = null;
  try {
    const user = JSON.parse(decodeURIComponent(raw));
    userUuid = user?.uuid || null;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!userUuid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    await ensureAttendanceLogTable();
    const currentEventId = await getCurrentEventId();
    await query(
      `INSERT INTO quest_attendance_log (user_uuid, event_date, event_id)
       VALUES ($1, CURRENT_DATE, $2)
       ON CONFLICT (user_uuid, event_date, event_id) DO NOTHING`,
      [userUuid, currentEventId]
    );

    // One-time "attendance" mission XP -- awarded on first-ever logged
    // presence. Fires on every daily log call, but stays one-time via
    // quest_xp_grants' (user_uuid, source_type, source_id) unique index:
    // the fixed source_id (the mission's id) makes every call after the
    // first a no-op regardless of how many days get logged afterward.
    // Isolated in its own try/catch so a failure here can't turn an
    // otherwise-successful attendance log into a 500.
    try {
      const { rows: missionRows } = await query(
        `SELECT id, xp_reward FROM quest_content
         WHERE mission_type = 'attendance' AND is_active = true AND event_id = $1
         LIMIT 1`,
        [currentEventId]
      );
      if (missionRows.length) {
        const { id: missionId, xp_reward: xpReward } = missionRows[0];
        await query(
          `INSERT INTO quest_xp_grants (user_uuid, source_type, source_id, xp_amount, event_id)
           VALUES ($1, 'mission_attendance', $2, $3, $4)
           ON CONFLICT (user_uuid, source_type, source_id) DO NOTHING`,
          [userUuid, missionId, xpReward, currentEventId]
        );
        await query(
          `INSERT INTO quest_user_progress (mission_id, user_uuid, completed, completed_at)
           VALUES ($1, $2, true, NOW())
           ON CONFLICT (mission_id, user_uuid) DO UPDATE SET completed = true, completed_at = NOW()`,
          [missionId, userUuid]
        );
      }
    } catch (xpErr) {
      console.error('[attendance/log] mission XP grant failed:', xpErr.message);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[POST /api/attendance/log]', err.message);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
