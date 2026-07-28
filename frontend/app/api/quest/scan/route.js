import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { ensureBadgeProgressTable } from '@/lib/initQuestBadges';
import { ensureFeaturedBoothState } from '@/lib/featuredBoothHelper';

const RASAYESH_BASE = 'https://api.rasayesh.com/';

async function ensureQuestUserNamesTable() {
  if (globalThis._questUserNamesReady) return;
  await query(`
    CREATE TABLE IF NOT EXISTS quest_user_names (
      user_uuid         VARCHAR(100) PRIMARY KEY,
      display_name_fa   VARCHAR(200),
      display_name_en   VARCHAR(200),
      updated_at        TIMESTAMP DEFAULT NOW()
    )
  `);
  await query(`ALTER TABLE quest_user_names ADD COLUMN IF NOT EXISTS profile_photo_url VARCHAR(500)`);
  globalThis._questUserNamesReady = true;
}

async function cacheUserName(userUuid, displayNameFa, displayNameEn) {
  try {
    await ensureQuestUserNamesTable();

    // Resolve profile photo from app_users (populated at login time)
    let profilePhotoUrl = null;
    try {
      const { rows } = await query('SELECT profile_image FROM app_users WHERE uuid = $1', [userUuid]);
      const raw = rows[0]?.profile_image;
      if (raw && typeof raw === 'string') {
        profilePhotoUrl = raw.startsWith('http') ? raw : RASAYESH_BASE + raw;
      }
    } catch {}

    await query(
      `INSERT INTO quest_user_names (user_uuid, display_name_fa, display_name_en, profile_photo_url, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_uuid) DO UPDATE
         SET display_name_fa   = EXCLUDED.display_name_fa,
             display_name_en   = EXCLUDED.display_name_en,
             profile_photo_url = COALESCE(EXCLUDED.profile_photo_url, quest_user_names.profile_photo_url),
             updated_at        = NOW()`,
      [userUuid, displayNameFa || null, displayNameEn || null, profilePhotoUrl]
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
    await query(`
      ALTER TABLE quest_scans ADD COLUMN IF NOT EXISTS is_featured_booth_bonus BOOLEAN DEFAULT false
    `);

    const companyResult = await query(
      `SELECT id, brand_name_fa, brand_name_en, logo, hall_name, booth_no,
              is_sponsor, website, booth_uuid, booth_xp,
              is_manual, linked_mission_id, linked_badge_id,
              repeatable_scan, repeatable_scan_hours,
              repeatable_start_hour, repeatable_end_hour
       FROM companies WHERE booth_uuid = $1`,
      [uuid]
    );

    if (companyResult.rows.length === 0) {
      return NextResponse.json({ error: 'booth_not_found' }, { status: 404 });
    }

    const company = companyResult.rows[0];

    if (company.repeatable_scan) {
      const startH = company.repeatable_start_hour ?? 0;
      const endH = company.repeatable_end_hour ?? 24;
      const currentHour = new Date().getHours();
      if (currentHour < startH || currentHour >= endH) {
        return NextResponse.json({
          status: 'outside_window',
          start_hour: startH,
          end_hour: endH,
          company,
        });
      }

      const lastScanResult = await query(
        `SELECT scanned_at FROM quest_scans
         WHERE user_uuid = $1 AND company_id = $2
         ORDER BY scanned_at DESC LIMIT 1`,
        [userUuid, company.id]
      );
      if (lastScanResult.rows.length > 0) {
        const elapsedMs = Date.now() - new Date(lastScanResult.rows[0].scanned_at).getTime();
        const cooldownHours = Math.max(1, company.repeatable_scan_hours || 1);
        const cooldownMs = cooldownHours * 60 * 60 * 1000;
        if (elapsedMs < cooldownMs) {
          const remainingMs = cooldownMs - elapsedMs;
          return NextResponse.json({
            status: 'cooldown',
            minutes_remaining: Math.ceil(remainingMs / 60000),
            seconds_remaining: Math.ceil(remainingMs / 1000),
            company,
          });
        }
      }
    } else {
      const existingResult = await query(
        `SELECT id FROM quest_scans
         WHERE user_uuid = $1 AND company_id = $2
           AND scanned_at > NOW() - INTERVAL '24 hours'`,
        [userUuid, company.id]
      );
      if (existingResult.rows.length > 0) {
        return NextResponse.json({ already_scanned: true, company });
      }
    }

    // ── Featured booth golden-booth check ──────────────────────────────────────
    // Look for any active featured_booth missions/badges where the scanned company
    // is in the pool.  This check is intentionally low-cost: pools are small and
    // the query is bounded to active featured_booth rows only.
    let bonusXp     = 0;
    let bonusMission = null; // { id, featured_booth_bonus_xp }
    let bonusBadge   = null;

    try {
      const { rows: fbMissions } = await query(
        `SELECT id, featured_booth_pool, featured_booth_bonus_xp, featured_booth_rotation_hours
         FROM quest_content
         WHERE is_active = true AND mission_type = 'featured_booth'
           AND featured_booth_pool IS NOT NULL`
      );
      for (const m of fbMissions) {
        const pool = Array.isArray(m.featured_booth_pool) ? m.featured_booth_pool : [];
        if (!pool.includes(company.id)) continue;
        const goldenId = await ensureFeaturedBoothState(m, 'mission');
        if (goldenId === company.id) {
          bonusXp      = Math.max(bonusXp, m.featured_booth_bonus_xp ?? 500);
          bonusMission = m;
        }
      }

      const { rows: fbBadges } = await query(
        `SELECT id, featured_booth_pool, featured_booth_bonus_xp, featured_booth_rotation_hours
         FROM quest_badges
         WHERE is_active = true AND badge_type = 'featured_booth'
           AND featured_booth_pool IS NOT NULL`
      );
      for (const b of fbBadges) {
        const pool = Array.isArray(b.featured_booth_pool) ? b.featured_booth_pool : [];
        if (!pool.includes(company.id)) continue;
        const goldenId = await ensureFeaturedBoothState(b, 'badge');
        if (goldenId === company.id) {
          bonusXp    = Math.max(bonusXp, b.featured_booth_bonus_xp ?? 500);
          bonusBadge = b;
        }
      }
    } catch (fbErr) {
      console.error('[quest/scan] featured_booth check failed:', fbErr.message);
    }

    // Total XP: regular booth XP + golden-booth bonus (if any)
    const baseXp    = company.booth_xp ?? 10;
    const xpEarned  = baseXp + bonusXp;

    await query(
      `INSERT INTO quest_scans (user_uuid, company_id, booth_uuid, xp_earned, is_featured_booth_bonus)
       VALUES ($1, $2, $3, $4, $5)`,
      [userUuid, company.id, uuid, xpEarned, bonusXp > 0]
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

    // Featured booth golden-booth mission/badge completion
    if (bonusMission) {
      await query(
        `INSERT INTO quest_user_progress (mission_id, user_uuid, completed, completed_at)
         VALUES ($1, $2, true, NOW())
         ON CONFLICT (mission_id, user_uuid) DO UPDATE SET completed = true, completed_at = NOW()`,
        [bonusMission.id, userUuid]
      ).catch(() => {});
    }
    if (bonusBadge) {
      await ensureBadgeProgressTable();
      await query(
        `INSERT INTO quest_badge_progress (badge_id, user_uuid, earned, earned_at)
         VALUES ($1, $2, true, NOW())
         ON CONFLICT (badge_id, user_uuid) DO UPDATE SET earned = true, earned_at = NOW()`,
        [bonusBadge.id, userUuid]
      ).catch(() => {});
    }

    // Build response — bonus fields only present when golden booth was hit
    const response = { success: true, points: xpEarned, company };
    if (bonusXp > 0) {
      response.bonus     = true;
      response.bonus_xp  = bonusXp;
    }
    return NextResponse.json(response);
  } catch (err) {
    console.error('[quest/scan]', err.message);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
