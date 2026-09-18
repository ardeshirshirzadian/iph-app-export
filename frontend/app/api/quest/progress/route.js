import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { getCurrentEventId } from '@/lib/currentEvent';

export async function POST(request) {
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

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const { mission_id, completed = true } = body;
  if (!mission_id || typeof mission_id !== 'number') {
    return NextResponse.json({ error: 'mission_id required' }, { status: 400 });
  }

  try {
    const currentEventId = await getCurrentEventId();

    // Verify mission exists, is attendance/manual type, AND belongs to the
    // current event -- mission_id comes straight from the client, so without
    // the event_id check a request could mark another event's mission
    // complete for this user.
    //
    // A deactivated mission still passes this check for a user who already
    // has a completed row (so it doesn't retroactively break their existing
    // completion), but stays blocked for anyone trying a first-time
    // completion after deactivation -- same intent as the 2026-09-15
    // manual-mission inactive-scan fix.
    const { rows } = await query(
      `SELECT qc.id, qc.mission_type
       FROM quest_content qc
       WHERE qc.id = $1 AND qc.event_id = $2
         AND (
           qc.is_active = true
           OR EXISTS (
             SELECT 1 FROM quest_user_progress qup
             WHERE qup.mission_id = qc.id AND qup.user_uuid = $3 AND qup.completed = true
           )
         )`,
      [mission_id, currentEventId, userUuid]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Mission not found' }, { status: 404 });
    }
    if (!['attendance', 'manual'].includes(rows[0].mission_type)) {
      return NextResponse.json({ error: 'Progress for this mission type is automatic' }, { status: 400 });
    }

    await query(
      `INSERT INTO quest_user_progress (mission_id, user_uuid, completed, completed_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (mission_id, user_uuid) DO UPDATE
         SET completed = EXCLUDED.completed,
             completed_at = CASE WHEN EXCLUDED.completed THEN NOW() ELSE NULL END`,
      [mission_id, userUuid, completed, completed ? new Date() : null]
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[POST /api/quest/progress]', err.message);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
