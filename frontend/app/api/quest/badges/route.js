import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { ensureQuestBadgesTable, ensureAttendanceLogTable, ensureBadgeProgressTable } from '@/lib/initQuestBadges';

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
      rows.map(async (b) => ({
        id: b.id,
        name_fa: b.name_fa,
        name_en: b.name_en,
        description_fa: b.description_fa,
        description_en: b.description_en,
        icon: b.icon_value,
        icon_size: b.icon_size ?? 36,
        earned: await calcEarned(b, userUuid),
      }))
    );

    return NextResponse.json({ badges });
  } catch (err) {
    console.error('[GET /api/quest/badges]', err.message);
    return NextResponse.json({ badges: [] });
  }
}
