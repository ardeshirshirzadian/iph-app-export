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
  if (!userUuid) return NextResponse.json({ error: 'session_expired' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const { missionId, badgeId, answers } = body || {};
  if (!missionId && !badgeId) {
    return NextResponse.json({ error: 'missionId or badgeId required' }, { status: 400 });
  }
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return NextResponse.json({ error: 'answers must be an object' }, { status: 400 });
  }

  try {
    // Single-attempt enforcement
    const existingCheck = missionId
      ? await query(
          `SELECT id FROM quest_survey_responses WHERE mission_id = $1 AND user_uuid = $2`,
          [missionId, userUuid]
        )
      : await query(
          `SELECT id FROM quest_survey_responses WHERE badge_id = $1 AND user_uuid = $2`,
          [badgeId, userUuid]
        );

    if (existingCheck.rows.length > 0) {
      return NextResponse.json({ error: 'already_submitted' }, { status: 409 });
    }

    // Fetch survey_fields + xp_reward for server-side validation and XP grant
    let surveyFields, xpReward;
    if (missionId) {
      const r = await query(
        `SELECT survey_fields, xp_reward FROM quest_content WHERE id = $1 AND mission_type = 'survey'`,
        [missionId]
      );
      if (r.rows.length === 0) return NextResponse.json({ error: 'mission_not_found' }, { status: 404 });
      surveyFields = r.rows[0].survey_fields;
      xpReward     = r.rows[0].xp_reward ?? 0;
    } else {
      const r = await query(
        `SELECT survey_fields, xp_reward FROM quest_badges WHERE id = $1 AND badge_type = 'survey'`,
        [badgeId]
      );
      if (r.rows.length === 0) return NextResponse.json({ error: 'badge_not_found' }, { status: 404 });
      surveyFields = r.rows[0].survey_fields;
      xpReward     = r.rows[0].xp_reward ?? 0;
    }

    if (Array.isArray(surveyFields)) {
      for (const field of surveyFields) {
        if (field.type === 'description') continue;
        if (field.required) {
          const val = answers[field.id];
          if (field.type === 'checkbox') {
            if (!Array.isArray(val) || val.length === 0) {
              return NextResponse.json({ error: `required_field_missing:${field.id}` }, { status: 422 });
            }
          } else {
            if (val === undefined || val === null || (typeof val === 'string' && !val.trim())) {
              return NextResponse.json({ error: `required_field_missing:${field.id}` }, { status: 422 });
            }
          }
        }
      }
    }

    await query(
      `INSERT INTO quest_survey_responses (mission_id, badge_id, user_uuid, answers)
       VALUES ($1, $2, $3, $4)`,
      [missionId || null, badgeId || null, userUuid, JSON.stringify(answers)]
    );

    // Mark mission/badge complete (same pattern as other manual-completion types)
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

    // Award XP via quest_xp_grants so it counts in stats + leaderboard
    if (xpReward > 0) {
      const sourceType = missionId ? 'mission_survey' : 'badge_survey';
      const sourceId   = missionId || badgeId;
      await query(
        `INSERT INTO quest_xp_grants (user_uuid, source_type, source_id, xp_amount)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_uuid, source_type, source_id) DO NOTHING`,
        [userUuid, sourceType, sourceId, xpReward]
      ).catch(() => {});
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[quest/survey POST]', err.message);
    if (err.code === '23505') {
      return NextResponse.json({ error: 'already_submitted' }, { status: 409 });
    }
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
