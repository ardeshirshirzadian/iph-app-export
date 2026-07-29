import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyAdminToken } from '@/lib/adminAuth';
import { cookies } from 'next/headers';

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

// ── PUT /api/admin/quest-badges/[id] ──────────────────────────────────────────
export async function PUT(request, { params }) {
  if (!getAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = parseInt(params.id, 10);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const {
    name_fa, name_en, description_fa, description_en,
    icon_type, icon_value, icon_size,
    badge_type, threshold,
    target_company_id, is_active, sort_order,
    target_hall_name, hall_match_mode, hall_scan_count,
    featured_booth_pool,
    featured_booth_bonus_xp,
    featured_booth_rotation_hours,
    survey_fields,
  } = body;

  if (!name_fa) return NextResponse.json({ error: 'name_fa الزامی است' }, { status: 400 });

  if (badge_type === 'featured_booth') {
    const err = validateFeaturedBoothFields({
      featured_booth_pool, featured_booth_bonus_xp, featured_booth_rotation_hours,
    });
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  }

  try {
    const { rows } = await query(
      `UPDATE quest_badges SET
         name_fa = $1, name_en = $2, description_fa = $3, description_en = $4,
         icon_type = $5, icon_value = $6, icon_size = $7,
         badge_type = $8, threshold = $9,
         target_company_id = $10, is_active = $11, sort_order = $12,
         target_hall_name = $13, hall_match_mode = $14, hall_scan_count = $15,
         featured_booth_pool = $16,
         featured_booth_bonus_xp = $17,
         featured_booth_rotation_hours = $18,
         survey_fields = $19,
         updated_at = NOW()
       WHERE id = $20
       RETURNING *`,
      [
        name_fa, name_en ?? null, description_fa ?? null, description_en ?? null,
        icon_type ?? 'emoji', icon_value ?? '⭐', icon_size ?? 36,
        badge_type ?? 'booth_scan_count', threshold ?? 1,
        target_company_id ?? null, is_active ?? true, sort_order ?? 0,
        target_hall_name ?? null, hall_match_mode ?? 'any', hall_scan_count ?? null,
        badge_type === 'featured_booth' ? JSON.stringify(featured_booth_pool) : null,
        featured_booth_bonus_xp ?? 500,
        featured_booth_rotation_hours ?? 1,
        badge_type === 'survey' && Array.isArray(survey_fields) ? JSON.stringify(survey_fields) : null,
        id,
      ]
    );
    if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ badge: rows[0] });
  } catch (err) {
    console.error('[admin/quest-badges PUT]', err.message);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}

// ── DELETE /api/admin/quest-badges/[id] ───────────────────────────────────────
export async function DELETE(request, { params }) {
  if (!getAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = parseInt(params.id, 10);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  try {
    const { rowCount } = await query('DELETE FROM quest_badges WHERE id = $1', [id]);
    if (!rowCount) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[admin/quest-badges DELETE]', err.message);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
