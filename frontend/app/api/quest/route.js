import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';

async function getUserUuid() {
  const cookieStore = await cookies();
  const raw = cookieStore.get('iph_user')?.value;
  if (!raw) return null;
  try {
    const user = JSON.parse(decodeURIComponent(raw));
    return user?.uuid || null;
  } catch {
    return null;
  }
}

async function calcProgress(mission, userUuid) {
  if (!userUuid) return 0;
  try {
    switch (mission.mission_type) {
      case 'booth_scan': {
        const r = await query(
          'SELECT COUNT(*) FROM quest_scans WHERE user_uuid = $1',
          [userUuid]
        );
        return parseInt(r.rows[0].count, 10);
      }
      case 'special_booth': {
        if (!mission.target_company_id) return 0;
        const r = await query(
          'SELECT COUNT(*) FROM quest_scans WHERE user_uuid = $1 AND company_id = $2',
          [userUuid, mission.target_company_id]
        );
        return parseInt(r.rows[0].count, 10) > 0 ? 1 : 0;
      }
      case 'chat': {
        // Check chatbot_logs if exists; table may not be present yet
        const tableCheck = await query(
          `SELECT 1 FROM information_schema.tables WHERE table_name = 'chatbot_logs'`
        );
        if (tableCheck.rows.length === 0) return 0;
        const r = await query(
          'SELECT COUNT(*) FROM chatbot_logs WHERE user_uuid = $1',
          [userUuid]
        );
        return parseInt(r.rows[0].count, 10) > 0 ? 1 : 0;
      }
      case 'attendance':
      case 'manual': {
        const r = await query(
          `SELECT completed FROM quest_user_progress
           WHERE mission_id = $1 AND user_uuid = $2`,
          [mission.id, userUuid]
        );
        return r.rows.length > 0 && r.rows[0].completed ? 1 : 0;
      }
      case 'hall_scan': {
        if (!mission.target_hall_name) return 0;
        const r = await query(
          `SELECT COUNT(DISTINCT qs.company_id) AS cnt
           FROM quest_scans qs
           JOIN companies c ON c.id = qs.company_id
           WHERE qs.user_uuid = $1 AND c.hall_name = $2`,
          [userUuid, mission.target_hall_name]
        );
        const scanned = parseInt(r.rows[0].cnt, 10);
        return mission.hall_match_mode === 'any' ? (scanned >= 1 ? 1 : 0) : scanned;
      }
      case 'quiz': {
        const r = await query(
          `SELECT is_correct FROM quest_quiz_attempts WHERE mission_id = $1 AND user_uuid = $2`,
          [mission.id, userUuid]
        ).catch(() => ({ rows: [] }));
        return r.rows.length > 0 && r.rows[0].is_correct ? 1 : 0;
      }
      default:
        return 0;
    }
  } catch {
    return 0;
  }
}

export async function GET() {
  try {
    const userUuid = await getUserUuid();

    const { rows } = await query(
      `SELECT * FROM quest_content WHERE is_active = true ORDER BY sort_order ASC, id ASC`
    );

    const missions = await Promise.all(
      rows.map(async (m) => {
        const progress = await calcProgress(m, userUuid);
        let quiz_attempted = false;
        if (m.mission_type === 'quiz' && userUuid) {
          const aR = await query(
            `SELECT id FROM quest_quiz_attempts WHERE mission_id = $1 AND user_uuid = $2`,
            [m.id, userUuid]
          ).catch(() => ({ rows: [] }));
          quiz_attempted = aR.rows.length > 0;
        }
        return {
          id: m.id,
          title: m.title_fa,
          title_en: m.title_en,
          description: m.description_fa,
          description_en: m.description_en,
          icon: m.icon_value,
          icon_size: m.icon_size ?? 36,
          xpReward: m.xp_reward,
          mission_type: m.mission_type,
          total: m.total,
          progress: Math.min(progress, m.total),
          target_hall_name: m.target_hall_name ?? null,
          hall_match_mode: m.hall_match_mode ?? 'any',
          hall_scan_count: m.hall_scan_count ?? null,
          quiz_question_fa: m.mission_type === 'quiz' ? (m.quiz_question_fa ?? null) : undefined,
          quiz_question_en: m.mission_type === 'quiz' ? (m.quiz_question_en ?? null) : undefined,
          quiz_options_fa: m.mission_type === 'quiz' ? (m.quiz_options_fa ?? null) : undefined,
          quiz_options_en: m.mission_type === 'quiz' ? (m.quiz_options_en ?? null) : undefined,
          quiz_hint_type: m.mission_type === 'quiz' ? (m.quiz_hint_type ?? null) : undefined,
          quiz_hint_url: m.mission_type === 'quiz' ? (m.quiz_hint_url ?? null) : undefined,
          quiz_attempted: m.mission_type === 'quiz' ? quiz_attempted : undefined,
        };
      })
    );

    return NextResponse.json({ missions });
  } catch (err) {
    console.error('[GET /api/quest]', err.message);
    return NextResponse.json({ missions: [] });
  }
}
