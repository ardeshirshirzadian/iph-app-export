import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyAdminToken } from '@/lib/adminAuth';
import { cookies } from 'next/headers';
import { ensureQuestBadgesTable } from '@/lib/initQuestBadges';

function getAdmin() {
  const cookieStore = cookies();
  const token = cookieStore.get('iph_admin_session')?.value;
  return verifyAdminToken(token, process.env.ADMIN_SECRET);
}

function validateFeaturedBoothFields(body) {
  const pool     = body.featured_booth_pool;
  const bonusXp  = body.featured_booth_bonus_xp;
  const rotHours = body.featured_booth_rotation_hours;
  if (!Array.isArray(pool) || pool.length < 2)
    return 'featured_booth_pool باید حداقل ۲ غرفه داشته باشد';
  if (!pool.every(v => Number.isInteger(v) && v > 0))
    return 'featured_booth_pool باید آرایه‌ای از شناسه‌های عددی معتبر باشد';
  if (!Number.isInteger(bonusXp) || bonusXp < 1)
    return 'featured_booth_bonus_xp باید عدد صحیح مثبت باشد';
  if (!Number.isInteger(rotHours) || rotHours < 1)
    return 'featured_booth_rotation_hours باید عدد صحیح مثبت باشد';
  return null;
}

// ── GET /api/admin/quest-badges ───────────────────────────────────────────────
export async function GET() {
  if (!getAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await ensureQuestBadgesTable();
    const { rows } = await query(
      `SELECT * FROM quest_badges ORDER BY sort_order ASC, id ASC`
    );
    return NextResponse.json({ badges: rows });
  } catch (err) {
    console.error('[admin/quest-badges GET]', err.message);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}

// ── POST /api/admin/quest-badges ──────────────────────────────────────────────
export async function POST(request) {
  if (!getAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const {
    name_fa, name_en, description_fa, description_en,
    icon_type = 'emoji', icon_value = '⭐', icon_size = 36,
    badge_type = 'booth_scan_count', threshold = 1,
    target_company_id = null, is_active = true, sort_order = 0,
    target_hall_name = null, hall_match_mode = 'any', hall_scan_count = null,
    featured_booth_pool = null,
    featured_booth_bonus_xp = 500,
    featured_booth_rotation_hours = 1,
    survey_fields = null,
  } = body;

  if (!name_fa) return NextResponse.json({ error: 'name_fa الزامی است' }, { status: 400 });

  if (badge_type === 'featured_booth') {
    const err = validateFeaturedBoothFields({
      featured_booth_pool, featured_booth_bonus_xp, featured_booth_rotation_hours,
    });
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  }

  try {
    await ensureQuestBadgesTable();
    const { rows } = await query(
      `INSERT INTO quest_badges
         (name_fa, name_en, description_fa, description_en,
          icon_type, icon_value, icon_size,
          badge_type, threshold, target_company_id,
          is_active, sort_order,
          target_hall_name, hall_match_mode, hall_scan_count,
          featured_booth_pool, featured_booth_bonus_xp, featured_booth_rotation_hours,
          survey_fields)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING *`,
      [
        name_fa, name_en || null, description_fa || null, description_en || null,
        icon_type, icon_value, icon_size,
        badge_type, threshold, target_company_id,
        is_active, sort_order,
        target_hall_name, hall_match_mode, hall_scan_count ?? null,
        badge_type === 'featured_booth' ? JSON.stringify(featured_booth_pool) : null,
        featured_booth_bonus_xp,
        featured_booth_rotation_hours,
        badge_type === 'survey' && Array.isArray(survey_fields) ? JSON.stringify(survey_fields) : null,
      ]
    );
    return NextResponse.json({ badge: rows[0] }, { status: 201 });
  } catch (err) {
    console.error('[admin/quest-badges POST]', err.message);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
