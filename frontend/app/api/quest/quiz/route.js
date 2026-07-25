import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';

export async function POST(request) {
  const cookieStore = await cookies();
  const userRaw = cookieStore.get('iph_user')?.value;
  let userUuid;
  try {
    const user = JSON.parse(decodeURIComponent(userRaw));
    userUuid = user?.uuid || null;
  } catch {
    userUuid = null;
  }
  if (!userUuid) {
    return NextResponse.json({ error: 'session_expired' }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const { missionId, badgeId, selectedIndex } = body || {};

  if (!missionId && !badgeId) {
    return NextResponse.json({ error: 'missionId or badgeId required' }, { status: 400 });
  }
  if (typeof selectedIndex !== 'number' || selectedIndex < 0 || selectedIndex > 3) {
    return NextResponse.json({ error: 'selectedIndex must be 0–3' }, { status: 400 });
  }

  try {
    // Check for existing attempt (single-attempt enforcement)
    const existingCheck = missionId
      ? await query(
          `SELECT id FROM quest_quiz_attempts WHERE mission_id = $1 AND user_uuid = $2`,
          [missionId, userUuid]
        )
      : await query(
          `SELECT id FROM quest_quiz_attempts WHERE badge_id = $1 AND user_uuid = $2`,
          [badgeId, userUuid]
        );

    if (existingCheck.rows.length > 0) {
      return NextResponse.json({ error: 'already_attempted' }, { status: 409 });
    }

    // Fetch correct answer from DB — never expose quiz_correct_index in response
    let correctIndex;
    if (missionId) {
      const r = await query(
        `SELECT quiz_correct_index FROM quest_content WHERE id = $1 AND mission_type = 'quiz'`,
        [missionId]
      );
      if (r.rows.length === 0) {
        return NextResponse.json({ error: 'mission_not_found' }, { status: 404 });
      }
      correctIndex = r.rows[0].quiz_correct_index;
    } else {
      const r = await query(
        `SELECT quiz_correct_index FROM quest_badges WHERE id = $1 AND badge_type = 'quiz'`,
        [badgeId]
      );
      if (r.rows.length === 0) {
        return NextResponse.json({ error: 'badge_not_found' }, { status: 404 });
      }
      correctIndex = r.rows[0].quiz_correct_index;
    }

    const isCorrect = selectedIndex === correctIndex;

    await query(
      `INSERT INTO quest_quiz_attempts (mission_id, badge_id, user_uuid, selected_index, is_correct)
       VALUES ($1, $2, $3, $4, $5)`,
      [missionId || null, badgeId || null, userUuid, selectedIndex, isCorrect]
    );

    if (isCorrect) {
      if (missionId) {
        await query(
          `INSERT INTO quest_user_progress (mission_id, user_uuid, completed, completed_at)
           VALUES ($1, $2, true, NOW())
           ON CONFLICT (mission_id, user_uuid) DO UPDATE SET completed = true, completed_at = NOW()`,
          [missionId, userUuid]
        ).catch(() => {});
      } else {
        await query(
          `INSERT INTO quest_badge_progress (badge_id, user_uuid, earned, earned_at)
           VALUES ($1, $2, true, NOW())
           ON CONFLICT (badge_id, user_uuid) DO UPDATE SET earned = true, earned_at = NOW()`,
          [badgeId, userUuid]
        ).catch(() => {});
      }
    }

    return NextResponse.json({ correct: isCorrect });
  } catch (err) {
    console.error('[quest/quiz POST]', err.message);
    if (err.code === '23505') {
      return NextResponse.json({ error: 'already_attempted' }, { status: 409 });
    }
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
