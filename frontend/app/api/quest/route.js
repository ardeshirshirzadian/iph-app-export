import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { ensureFeaturedBoothState, getFeaturedBoothCountdown } from '@/lib/featuredBoothHelper';

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

async function calcProgress(mission, userUuid, eventId) {
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
        const r = await query(
          `SELECT completed FROM quest_user_progress
           WHERE mission_id = $1 AND user_uuid = $2`,
          [mission.id, userUuid]
        );
        return r.rows.length > 0 && r.rows[0].completed ? 1 : 0;
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
           WHERE qs.user_uuid = $1 AND c.hall_name = $2 AND c.event_id = $3`,
          [userUuid, mission.target_hall_name, Number(eventId)]
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
      case 'survey': {
        const r = await query(
          `SELECT id FROM quest_survey_responses WHERE mission_id = $1 AND user_uuid = $2`,
          [mission.id, userUuid]
        ).catch(() => ({ rows: [] }));
        return r.rows.length > 0 ? 1 : 0;
      }
      case 'featured_booth': {
        const r = await query(
          `SELECT completed FROM quest_user_progress WHERE mission_id = $1 AND user_uuid = $2`,
          [mission.id, userUuid]
        );
        return r.rows.length > 0 && r.rows[0].completed ? 1 : 0;
      }
      case 'social_share': {
        const r = await query(
          `SELECT status FROM quest_social_share_submissions
           WHERE mission_id = $1 AND user_uuid = $2 AND status = 'approved'
           LIMIT 1`,
          [mission.id, userUuid]
        ).catch(() => ({ rows: [] }));
        return r.rows.length > 0 ? 1 : 0;
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

    const settingsResult = await query("SELECT value FROM app_settings WHERE key = 'companies_config'");
    const eventId = settingsResult.rows[0]?.value?.event_id;

    const { rows } = await query(
      `SELECT * FROM quest_content WHERE is_active = true ORDER BY sort_order ASC, id ASC`
    );

    const missions = await Promise.all(
      rows.map(async (m) => {
        const progress = await calcProgress(m, userUuid, eventId);
        let quiz_attempted = false;
        if (m.mission_type === 'quiz' && userUuid) {
          const aR = await query(
            `SELECT id FROM quest_quiz_attempts WHERE mission_id = $1 AND user_uuid = $2`,
            [m.id, userUuid]
          ).catch(() => ({ rows: [] }));
          quiz_attempted = aR.rows.length > 0;
        }
        let survey_submitted = false;
        if (m.mission_type === 'survey' && userUuid) {
          const sR = await query(
            `SELECT id FROM quest_survey_responses WHERE mission_id = $1 AND user_uuid = $2`,
            [m.id, userUuid]
          ).catch(() => ({ rows: [] }));
          survey_submitted = sR.rows.length > 0;
        }

        let social_share_status = undefined;
        let social_share_note = undefined;
        if (m.mission_type === 'social_share' && userUuid) {
          const ssR = await query(
            `SELECT status, admin_note FROM quest_social_share_submissions
             WHERE mission_id = $1 AND user_uuid = $2
             ORDER BY submitted_at DESC LIMIT 1`,
            [m.id, userUuid]
          ).catch(() => ({ rows: [] }));
          if (ssR.rows.length > 0) {
            social_share_status = ssR.rows[0].status;
            social_share_note = ssR.rows[0].admin_note || null;
          }
        }

        // Countdown for featured_booth: return next rotation timestamp (no golden
        // booth identity revealed — only WHEN the next rotation occurs).
        let featured_booth_next_rotation = undefined;
        // Pool companies for featured_booth: show all candidates so the user knows
        // which booths to visit. Does NOT reveal which is currently golden.
        let featured_booth_pool_companies = undefined;
        if (m.mission_type === 'featured_booth') {
          // Lazily ensure a state row exists so the countdown is non-null on first load.
          if (Array.isArray(m.featured_booth_pool) && m.featured_booth_pool.length >= 2) {
            await ensureFeaturedBoothState(m, 'mission').catch(() => {});
          }
          const selectedAt = await getFeaturedBoothCountdown(m.id, 'mission');
          if (selectedAt) {
            const nextMs = new Date(selectedAt).getTime() +
              Math.max(1, m.featured_booth_rotation_hours ?? 1) * 3_600_000;
            featured_booth_next_rotation = new Date(nextMs).toISOString();
          }
          // Resolve company details for every pool member (no golden booth revealed).
          const pool = m.featured_booth_pool;
          if (Array.isArray(pool) && pool.length > 0) {
            const { rows: poolRows } = await query(
              `SELECT id AS company_id, brand_name_fa, brand_name_en, logo, hall_name, booth_no
               FROM companies WHERE id = ANY($1::int[]) AND event_id = $2
               ORDER BY hall_name ASC NULLS LAST, booth_no ASC NULLS LAST`,
              [pool, Number(eventId)]
            ).catch(() => ({ rows: [] }));
            // Per-company scan status for the authenticated user.
            let scanMap = {};
            if (userUuid && poolRows.length > 0) {
              const ids = poolRows.map(r => r.company_id);
              const { rows: scanRows } = await query(
                `SELECT company_id, bool_or(is_featured_booth_bonus) AS got_bonus
                 FROM quest_scans
                 WHERE user_uuid = $1 AND company_id = ANY($2::int[])
                 GROUP BY company_id`,
                [userUuid, ids]
              ).catch(() => ({ rows: [] }));
              for (const sr of scanRows) {
                scanMap[sr.company_id] = { got_bonus: sr.got_bonus };
              }
            }
            featured_booth_pool_companies = poolRows.map(c => ({
              ...c,
              user_scanned: !!scanMap[c.company_id],
              user_got_bonus: !!(scanMap[c.company_id]?.got_bonus),
            }));
          } else {
            featured_booth_pool_companies = [];
          }
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
          featuredBoothBonusXp: m.mission_type === 'featured_booth' ? (m.featured_booth_bonus_xp ?? 500) : undefined,
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
          survey_fields: m.mission_type === 'survey' ? (m.survey_fields ?? null) : undefined,
          survey_submitted: m.mission_type === 'survey' ? survey_submitted : undefined,
          social_share_status: m.mission_type === 'social_share' ? (social_share_status ?? null) : undefined,
          social_share_note: m.mission_type === 'social_share' ? (social_share_note ?? null) : undefined,
          featured_booth_next_rotation,
          featured_booth_pool_companies,
        };
      })
    );

    return NextResponse.json({ missions });
  } catch (err) {
    console.error('[GET /api/quest]', err.message);
    return NextResponse.json({ missions: [] });
  }
}
