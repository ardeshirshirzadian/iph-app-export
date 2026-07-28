import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyAdminToken } from '@/lib/adminAuth';
import { cookies } from 'next/headers';

function getAdmin() {
  const cookieStore = cookies();
  const token = cookieStore.get('iph_admin_session')?.value;
  return verifyAdminToken(token, process.env.ADMIN_SECRET);
}

function formatItem(row, type) {
  const rotationMs = Math.max(1, row.featured_booth_rotation_hours ?? 1) * 3_600_000;
  const selectedAt = row.selected_at ? new Date(row.selected_at) : null;
  const nextRotationAt = selectedAt
    ? new Date(selectedAt.getTime() + rotationMs).toISOString()
    : null;
  const companyName =
    row.brand_name_fa ||
    row.brand_name_en ||
    (row.current_company_id ? `ID: ${row.current_company_id}` : null);

  return {
    id: row.id,
    title: type === 'mission' ? row.title_fa : row.name_fa,
    type,
    current_company_id: row.current_company_id ?? null,
    company_name: companyName,
    hall_name: row.hall_name ?? null,
    booth_no: row.booth_no ?? null,
    selected_at: selectedAt?.toISOString() ?? null,
    next_rotation_at: nextRotationAt,
    rotation_hours: row.featured_booth_rotation_hours ?? 1,
  };
}

// ── GET /api/admin/quest-featured-booth-status ────────────────────────────────
// Admin-only. Returns the current golden booth for every active featured_booth
// mission and badge without triggering any rotation — read-only state snapshot.
export async function GET() {
  if (!getAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { rows: missionRows } = await query(`
      SELECT
        qc.id, qc.title_fa, qc.featured_booth_rotation_hours,
        s.current_company_id, s.selected_at,
        co.brand_name_fa, co.brand_name_en, co.hall_name, co.booth_no
      FROM quest_content qc
      LEFT JOIN quest_featured_booth_state s ON s.mission_id = qc.id
      LEFT JOIN companies co ON co.id = s.current_company_id
      WHERE qc.mission_type = 'featured_booth' AND qc.is_active = true
      ORDER BY qc.sort_order ASC, qc.id ASC
    `);

    const { rows: badgeRows } = await query(`
      SELECT
        qb.id, qb.name_fa, qb.featured_booth_rotation_hours,
        s.current_company_id, s.selected_at,
        co.brand_name_fa, co.brand_name_en, co.hall_name, co.booth_no
      FROM quest_badges qb
      LEFT JOIN quest_featured_booth_state s ON s.badge_id = qb.id
      LEFT JOIN companies co ON co.id = s.current_company_id
      WHERE qb.badge_type = 'featured_booth' AND qb.is_active = true
      ORDER BY qb.sort_order ASC, qb.id ASC
    `);

    return NextResponse.json({
      missions: missionRows.map(r => formatItem(r, 'mission')),
      badges:   badgeRows.map(r => formatItem(r, 'badge')),
    });
  } catch (err) {
    console.error('[admin/quest-featured-booth-status GET]', err.message);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
