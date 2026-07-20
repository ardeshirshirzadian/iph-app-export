import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { ensureBadgeProgressTable } from '@/lib/initQuestBadges';

async function cacheUserName(userUuid, displayNameFa, displayNameEn) {
  try {
    if (!globalThis._questUserNamesReady) {
      await query(`
        CREATE TABLE IF NOT EXISTS quest_user_names (
          user_uuid       VARCHAR(100) PRIMARY KEY,
          display_name_fa VARCHAR(200),
          display_name_en VARCHAR(200),
          updated_at      TIMESTAMP DEFAULT NOW()
        )
      `);
      globalThis._questUserNamesReady = true;
    }
    await query(
      `INSERT INTO quest_user_names (user_uuid, display_name_fa, display_name_en, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_uuid) DO UPDATE
         SET display_name_fa = EXCLUDED.display_name_fa,
             display_name_en = EXCLUDED.display_name_en,
             updated_at      = NOW()`,
      [userUuid, displayNameFa || null, displayNameEn || null]
    );
  } catch (err) {
    console.error('[quest/scan] cacheUserName failed:', err.message);
  }
}

export async function POST(request) {
  const cookieStore = await cookies();
  const userRaw = cookieStore.get('iph_user')?.value;

  let userUuid, displayNameFa, displayNameEn;
  try {
    const user = JSON.parse(decodeURIComponent(userRaw));
    userUuid = user?.uuid || null;
    displayNameFa = [user?.firstname_fa, user?.lastname_fa].filter(Boolean).join(' ') || null;
    displayNameEn = [user?.firstname_en, user?.lastname_en].filter(Boolean).join(' ') || null;
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
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const { uuid } = body || {};
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid || !UUID_RE.test(uuid)) {
    return NextResponse.json({ error: 'invalid_uuid' }, { status: 400 });
  }

  try {
    // Ensure quest_scans table exists with xp_earned column
    await query(`
      CREATE TABLE IF NOT EXISTS quest_scans (
        id         SERIAL PRIMARY KEY,
        user_uuid  VARCHAR(100) NOT NULL,
        company_id INT NOT NULL,
        booth_uuid UUID NOT NULL,
        scanned_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await query(`
      ALTER TABLE quest_scans ADD COLUMN IF NOT EXISTS xp_earned INT DEFAULT 10
    `);

    const companyResult = await query(
      `SELECT id, brand_name_fa, brand_name_en, logo, hall_name, booth_no,
              is_sponsor, website, booth_uuid, booth_xp,
              is_manual, linked_mission_id, linked_badge_id
       FROM companies WHERE booth_uuid = $1`,
      [uuid]
    );

    if (companyResult.rows.length === 0) {
      return NextResponse.json({ error: 'booth_not_found' }, { status: 404 });
    }

    const company = companyResult.rows[0];

    const existingResult = await query(
      `SELECT id FROM quest_scans
       WHERE user_uuid = $1 AND company_id = $2
         AND scanned_at > NOW() - INTERVAL '24 hours'`,
      [userUuid, company.id]
    );

    if (existingResult.rows.length > 0) {
      return NextResponse.json({ already_scanned: true, company });
    }

    const xpEarned = company.booth_xp ?? 10;
    await query(
      `INSERT INTO quest_scans (user_uuid, company_id, booth_uuid, xp_earned)
       VALUES ($1, $2, $3, $4)`,
      [userUuid, company.id, uuid, xpEarned]
    );

    // Cache user display name so leaderboard doesn't need live Rasayesh calls
    cacheUserName(userUuid, displayNameFa, displayNameEn).catch(() => {});

    // Manual rewards: upsert mission progress and/or badge progress
    if (company.is_manual) {
      if (company.linked_mission_id) {
        await query(
          `INSERT INTO quest_user_progress (mission_id, user_uuid, completed, completed_at)
           VALUES ($1, $2, true, NOW())
           ON CONFLICT (mission_id, user_uuid) DO UPDATE SET completed = true, completed_at = NOW()`,
          [company.linked_mission_id, userUuid]
        ).catch(() => {});
      }
      if (company.linked_badge_id) {
        await ensureBadgeProgressTable();
        await query(
          `INSERT INTO quest_badge_progress (badge_id, user_uuid, earned, earned_at)
           VALUES ($1, $2, true, NOW())
           ON CONFLICT (badge_id, user_uuid) DO UPDATE SET earned = true, earned_at = NOW()`,
          [company.linked_badge_id, userUuid]
        ).catch(() => {});
      }
    }

    return NextResponse.json({ success: true, points: xpEarned, company });
  } catch (err) {
    console.error('[quest/scan]', err.message);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
