import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { ensureQuestBadgesTable, ensureAttendanceLogTable, ensureBadgeProgressTable } from '@/lib/initQuestBadges';
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

async function calcEarned(badge, userUuid) {
  if (!userUuid) return false;
  try {
    switch (badge.badge_type) {
      case 'booth_scan_count': {
        const r = await query(
          'SELECT COUNT(*) FROM quest_scans WHERE user_uuid = $1',
          [userUuid]
        );
        return parseInt(r.rows[0].count, 10) >= badge.threshold;
      }
      case 'special_booth': {
        if (!badge.target_company_id) return false;
        const r = await query(
          'SELECT COUNT(*) FROM quest_scans WHERE user_uuid = $1 AND company_id = $2',
          [userUuid, badge.target_company_id]
        );
        return parseInt(r.rows[0].count, 10) > 0;
      }
      case 'chat': {
        const tableCheck = await query(
          `SELECT 1 FROM information_schema.tables WHERE table_name = 'chatbot_logs'`
        );
        if (tableCheck.rows.length === 0) return false;
        const r = await query(
          'SELECT COUNT(*) FROM chatbot_logs WHERE user_uuid = $1',
          [userUuid]
        );
        return parseInt(r.rows[0].count, 10) > 0;
      }
      case 'booth_scan_single_day': {
        const r = await query(
          `SELECT DATE(scanned_at) AS day, COUNT(*) AS cnt
           FROM quest_scans WHERE user_uuid = $1
           GROUP BY DATE(scanned_at)`,
          [userUuid]
        );
        return r.rows.some(row => parseInt(row.cnt, 10) >= badge.threshold);
      }
      case 'consecutive_days': {
        const r = await query(
          `SELECT DISTINCT event_date FROM quest_attendance_log
           WHERE user_uuid = $1 ORDER BY event_date ASC`,
          [userUuid]
        );
        if (r.rows.length < badge.threshold) return false;
        const dates = r.rows.map(row => new Date(row.event_date).getTime());
        const DAY_MS = 86400000;
        let streak = 1;
        for (let i = 1; i < dates.length; i++) {
          if (dates[i] - dates[i - 1] === DAY_MS) {
            streak++;
            if (streak >= badge.threshold) return true;
          } else {
            streak = 1;
          }
        }
        return streak >= badge.threshold;
      }
      case 'manual': {
        const r = await query(
          'SELECT 1 FROM quest_badge_progress WHERE badge_id = $1 AND user_uuid = $2 AND earned = true',
          [badge.id, userUuid]
        );
        return r.rows.length > 0;
      }
      case 'hall_scan': {
        if (!badge.target_hall_name) return false;
        const r = await query(
          `SELECT COUNT(DISTINCT qs.company_id) AS cnt
           FROM quest_scans qs
           JOIN companies c ON c.id = qs.company_id
           WHERE qs.user_uuid = $1 AND c.hall_name = $2`,
          [userUuid, badge.target_hall_name]
        );
        const scanned = parseInt(r.rows[0].cnt, 10);
        return scanned >= badge.threshold;
      }
      case 'quiz': {
        const r = await query(
          `SELECT is_correct FROM quest_quiz_attempts WHERE badge_id = $1 AND user_uuid = $2`,
          [badge.id, userUuid]
        ).catch(() => ({ rows: [] }));
        return r.rows.length > 0 && r.rows[0].is_correct;
      }
      case 'featured_booth': {
        const r = await query(
          'SELECT 1 FROM quest_badge_progress WHERE badge_id = $1 AND user_uuid = $2 AND earned = true',
          [badge.id, userUuid]
        );
        return r.rows.length > 0;
      }
      default:
        return false;
    }
  } catch {
    return false;
  }
}

export async function GET() {
  try {
    await ensureQuestBadgesTable();
    await ensureAttendanceLogTable();
    await ensureBadgeProgressTable();

    const userUuid = await getUserUuid();

    const { rows } = await query(
      `SELECT * FROM quest_badges WHERE is_active = true ORDER BY sort_order ASC, id ASC`
    );

    const badges = await Promise.all(
      rows.map(async (b) => {
        const earned = await calcEarned(b, userUuid);
        let quiz_attempted = false;
        if (b.badge_type === 'quiz' && userUuid) {
          const aR = await query(
            `SELECT id FROM quest_quiz_attempts WHERE badge_id = $1 AND user_uuid = $2`,
            [b.id, userUuid]
          ).catch(() => ({ rows: [] }));
          quiz_attempted = aR.rows.length > 0;
        }
        // Countdown for featured_booth badges
        let featured_booth_next_rotation = undefined;
        // Pool companies: all candidates visible to user, golden selection hidden.
        let featured_booth_pool_companies = undefined;
        if (b.badge_type === 'featured_booth') {
          if (Array.isArray(b.featured_booth_pool) && b.featured_booth_pool.length >= 2) {
            await ensureFeaturedBoothState(b, 'badge').catch(() => {});
          }
          const selectedAt = await getFeaturedBoothCountdown(b.id, 'badge');
          if (selectedAt) {
            const nextMs = new Date(selectedAt).getTime() +
              Math.max(1, b.featured_booth_rotation_hours ?? 1) * 3_600_000;
            featured_booth_next_rotation = new Date(nextMs).toISOString();
          }
          const pool = b.featured_booth_pool;
          if (Array.isArray(pool) && pool.length > 0) {
            const { rows: poolRows } = await query(
              `SELECT id AS company_id, brand_name_fa, brand_name_en, logo, hall_name, booth_no
               FROM companies WHERE id = ANY($1::int[])
               ORDER BY hall_name ASC NULLS LAST, booth_no ASC NULLS LAST`,
              [pool]
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
          id: b.id,
          badge_type: b.badge_type,
          name_fa: b.name_fa,
          name_en: b.name_en,
          description_fa: b.description_fa,
          description_en: b.description_en,
          icon: b.icon_value,
          icon_size: b.icon_size ?? 36,
          earned,
          quiz_question_fa: b.badge_type === 'quiz' ? (b.quiz_question_fa ?? null) : undefined,
          quiz_question_en: b.badge_type === 'quiz' ? (b.quiz_question_en ?? null) : undefined,
          quiz_options_fa: b.badge_type === 'quiz' ? (b.quiz_options_fa ?? null) : undefined,
          quiz_options_en: b.badge_type === 'quiz' ? (b.quiz_options_en ?? null) : undefined,
          quiz_hint_type: b.badge_type === 'quiz' ? (b.quiz_hint_type ?? null) : undefined,
          quiz_hint_url: b.badge_type === 'quiz' ? (b.quiz_hint_url ?? null) : undefined,
          quiz_attempted: b.badge_type === 'quiz' ? quiz_attempted : undefined,
          featured_booth_next_rotation,
          featured_booth_pool_companies,
        };
      })
    );

    return NextResponse.json({ badges });
  } catch (err) {
    console.error('[GET /api/quest/badges]', err.message);
    return NextResponse.json({ badges: [] });
  }
}
