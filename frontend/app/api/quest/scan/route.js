import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { ensureBadgeProgressTable } from '@/lib/initQuestBadges';
import { ensureFeaturedBoothState, markFeaturedBoothClaimed, isWithinDailyWindow } from '@/lib/featuredBoothHelper';
import { getCurrentEventId } from '@/lib/currentEvent';

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

async function cacheUserName(userUuid, displayNameFa, displayNameEn, eventId) {
  try {
    await ensureQuestUserNamesTable();

    // Resolve profile photo from app_users (populated at login time).
    // event_id-scoped: since app_users now has one row per (event_id, uuid)
    // instead of a single cross-event row, an unscoped lookup here could
    // match the wrong event's row (or, with no ORDER BY, an arbitrary one)
    // once a user has logged into more than one event.
    let profilePhotoUrl = null;
    try {
      const { rows } = await query(
        'SELECT profile_image FROM app_users WHERE uuid = $1 AND event_id = $2',
        [userUuid, eventId]
      );
      const raw = rows[0]?.profile_image;
      if (raw && typeof raw === 'string') {
        profilePhotoUrl = raw.startsWith('http') ? raw : RASAYESH_BASE + raw;
      }
    } catch {}

    // quest_user_names is intentionally NOT event-scoped in its reads (PK is
    // user_uuid alone; leaderboard joins it without an event_id filter) --
    // display name/photo are person-level attributes, not event-level, so a
    // single global cache row per user is correct. event_id is still stamped
    // here for data accuracy (which event's login last refreshed the cache)
    // even though nothing currently filters on it.
    await query(
      `INSERT INTO quest_user_names (user_uuid, display_name_fa, display_name_en, profile_photo_url, updated_at, event_id)
       VALUES ($1, $2, $3, $4, NOW(), $5)
       ON CONFLICT (user_uuid) DO UPDATE
         SET display_name_fa   = EXCLUDED.display_name_fa,
             display_name_en   = EXCLUDED.display_name_en,
             profile_photo_url = COALESCE(EXCLUDED.profile_photo_url, quest_user_names.profile_photo_url),
             updated_at        = NOW(),
             event_id          = EXCLUDED.event_id`,
      [userUuid, displayNameFa || null, displayNameEn || null, profilePhotoUrl, eventId]
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

    const currentEventId = await getCurrentEventId();
    const settingsResult = await query(
      "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'companies_config'",
      [currentEventId]
    );
    const eventId = settingsResult.rows[0]?.value?.event_id;

    // company_id AS id -- the response body, target_company_id comparisons,
    // and featured_booth_pool/current_company_id checks all key off the
    // global Rasayesh company id permanently (pool and current_company_id
    // are excluded from the sub-phase 4 remap, see featuredBoothHelper.js).
    // id AS placement_id -- quest_scans.company_id and quest_content/quest_badges
    // .target_company_id key off companies_placement's own surrogate id as of
    // the sub-phase 4 remap; this is the value to use for both.
    // booth_uuid is shared across a company's event rows (see sub-phase 1), so
    // rasayesh_event_id alone already disambiguates which row this scan
    // belongs to; event_id is added too for defense-in-depth, matching the
    // rest of this codebase's pattern of filtering by both.
    // cp.is_active + the linked-mission LEFT JOIN feed the manual-reward gate
    // just below -- fetched here in the same round-trip rather than a
    // separate query.
    const companyResult = await query(
      `SELECT cp.company_id AS id, cp.id AS placement_id, cp.brand_name_fa, cp.brand_name_en, cp.logo, cp.hall_name, cp.booth_no,
              cp.is_sponsor, cp.website, cp.booth_uuid, cp.booth_xp,
              cp.is_manual, cp.linked_mission_id, cp.linked_badge_id,
              cp.repeatable_scan, cp.repeatable_scan_hours,
              cp.repeatable_start_hour, cp.repeatable_end_hour,
              cp.is_active,
              qc.is_active AS linked_mission_is_active
       FROM companies_placement cp
       LEFT JOIN quest_content qc ON qc.id = cp.linked_mission_id AND qc.event_id = cp.event_id
       WHERE cp.booth_uuid = $1 AND cp.rasayesh_event_id = $2 AND cp.event_id = $3`,
      [uuid, Number(eventId), currentEventId]
    );

    if (companyResult.rows.length === 0) {
      return NextResponse.json({ error: 'booth_not_found' }, { status: 404 });
    }

    const company = companyResult.rows[0];

    // Manual-reward gate: once an admin deactivates either the placement row
    // itself (cp.is_active) or the mission it's linked to (quest_content.
    // is_active) -- whatever that mission's mission_type is, e.g. 'manual' or
    // 'attendance' -- this booth must stop paying out. Checked immediately,
    // before featured-booth gating / dedup / any XP crediting below, so a
    // rejected scan never reaches the quest_scans insert or the
    // quest_user_progress/quest_badge_progress upserts further down.
    // NULL-safe by design: a mission row that's gone missing (dangling
    // linked_mission_id) reads as "no info" and does not block the scan --
    // only an explicit is_active = false does.
    if (company.is_manual) {
      const placementInactive = company.is_active === false;
      const missionInactive = !!company.linked_mission_id && company.linked_mission_is_active === false;
      if (placementInactive || missionInactive) {
        return NextResponse.json({ error: 'mission_inactive', company }, { status: 410 });
      }
    }

    // ── Featured-booth pool gating (window / claim-lock / rotation-aware
    // re-scan) -- runs BEFORE the generic dedup/cooldown checks below, since
    // a pool booth's scan eligibility is governed entirely by its
    // featured_booth mission's own state, not the generic per-booth rules.
    // Missions only (badges keep their pre-existing, unchanged behavior --
    // no window/claim-lock/rotation-aware re-scan for them, out of scope).
    // See 2026-09-14 spec (points 3 and 4, plus the daily-window addition).
    let bonusXp             = 0;
    let bonusMission        = null; // { id, featured_booth_bonus_xp }
    let bonusBadge          = null;
    let fbSkipGenericDedup  = false; // true once rotation-aware dedup already resolved this scan

    try {
      const { rows: fbMissions } = await query(
        `SELECT id, featured_booth_pool, featured_booth_bonus_xp, featured_booth_rotation_hours,
                featured_booth_daily_start_hour, featured_booth_daily_end_hour
         FROM quest_content
         WHERE is_active = true AND mission_type = 'featured_booth'
           AND featured_booth_pool IS NOT NULL AND event_id = $1`,
        [currentEventId]
      );
      for (const m of fbMissions) {
        const pool = Array.isArray(m.featured_booth_pool) ? m.featured_booth_pool : [];
        if (!pool.includes(company.id)) continue;

        if (!isWithinDailyWindow(m.featured_booth_daily_start_hour, m.featured_booth_daily_end_hour)) {
          return NextResponse.json({
            status: 'featured_booth_closed',
            start_hour: m.featured_booth_daily_start_hour,
            end_hour: m.featured_booth_daily_end_hour,
            company,
          });
        }

        const state = await ensureFeaturedBoothState(m, 'mission');
        if (!state) continue; // misconfigured/empty pool -- fall through to normal handling

        if (state.claimed_at) {
          const nextMs = new Date(state.selected_at).getTime() +
            Math.max(1, m.featured_booth_rotation_hours ?? 1) * 3_600_000;
          const remainingMs = Math.max(0, nextMs - Date.now());
          return NextResponse.json({
            status: 'cooldown',
            minutes_remaining: Math.max(1, Math.ceil(remainingMs / 60000)),
            seconds_remaining: Math.max(1, Math.ceil(remainingMs / 1000)),
            company,
          });
        }

        // Rotation-aware re-scan: a prior scan of this exact booth from
        // BEFORE the current cycle started doesn't count against the
        // generic dedup rule below -- it's a fresh opportunity in a new
        // pool/cycle, not a repeat within the same one.
        const { rows: lastScanRows } = await query(
          `SELECT scanned_at FROM quest_scans
           WHERE user_uuid = $1 AND company_id = $2 AND event_id = $3
           ORDER BY scanned_at DESC LIMIT 1`,
          [userUuid, company.placement_id, currentEventId]
        );
        if (
          lastScanRows.length > 0 &&
          new Date(lastScanRows[0].scanned_at).getTime() >= new Date(state.selected_at).getTime()
        ) {
          // Already scanned THIS booth THIS cycle -- same outcome the
          // generic rule would give, surfaced the same way.
          return NextResponse.json({ already_scanned: true, company });
        }
        fbSkipGenericDedup = true;

        if (state.current_company_id === company.id) {
          bonusXp      = Math.max(bonusXp, m.featured_booth_bonus_xp ?? 500);
          bonusMission = m;
          await markFeaturedBoothClaimed(m.id, 'mission');
        }
      }

      const { rows: fbBadges } = await query(
        `SELECT id, featured_booth_pool, featured_booth_rotation_hours
         FROM quest_badges
         WHERE is_active = true AND badge_type = 'featured_booth'
           AND featured_booth_pool IS NOT NULL AND event_id = $1`,
        [currentEventId]
      );
      for (const b of fbBadges) {
        const pool = Array.isArray(b.featured_booth_pool) ? b.featured_booth_pool : [];
        if (!pool.includes(company.id)) continue;
        const state = await ensureFeaturedBoothState(b, 'badge');
        if (state?.current_company_id === company.id) {
          bonusBadge = b;
          // Badges don't award XP; bonusXp is not updated here
        }
      }
    } catch (fbErr) {
      console.error('[quest/scan] featured_booth check failed:', fbErr.message);
    }

    // ── Generic dedup / cooldown (repeatable-scan window, or plain 24h) ──────
    // Skipped entirely when the rotation-aware re-scan check above already
    // resolved dedup for a featured_booth pool booth.
    if (!fbSkipGenericDedup) {
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
           WHERE user_uuid = $1 AND company_id = $2 AND event_id = $3
           ORDER BY scanned_at DESC LIMIT 1`,
          [userUuid, company.placement_id, currentEventId]
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
           WHERE user_uuid = $1 AND company_id = $2 AND event_id = $3
             AND scanned_at > NOW() - INTERVAL '24 hours'`,
          [userUuid, company.placement_id, currentEventId]
        );
        if (existingResult.rows.length > 0) {
          return NextResponse.json({ already_scanned: true, company });
        }
      }
    }

    // Total XP: regular booth XP + golden-booth bonus (if any)
    const baseXp    = company.booth_xp ?? 10;
    const xpEarned  = baseXp + bonusXp;

    // sub-phase 4: quest_scans.company_id now stores companies_placement.id
    // (placement_id), not the global company id, matching quest_badges/
    // quest_content.target_company_id post-remap. Deployed together with
    // that remap and the paired reader-JOIN flips (quest-dashboard, this
    // file's own hall_scan JOIN below).
    await query(
      `INSERT INTO quest_scans (user_uuid, company_id, booth_uuid, xp_earned, is_featured_booth_bonus, event_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userUuid, company.placement_id, uuid, xpEarned, bonusXp > 0, currentEventId]
    );

    // Cache user display name so leaderboard doesn't need live Rasayesh calls
    cacheUserName(userUuid, displayNameFa, displayNameEn, currentEventId).catch(() => {});

    // ── Mission completion XP grants (booth_scan, hall_scan, special_booth) ──
    // Every other mission type (quiz, survey, social_share) already inserts into
    // quest_xp_grants on completion.  Scan-triggered missions were missing this step:
    // the scan was recorded in quest_scans (per-booth XP), but the one-time mission
    // completion bonus from quest_content.xp_reward was never written.
    // ON CONFLICT DO NOTHING makes every check idempotent — safe to run on every scan.
    try {
      const { rows: scanMissions } = await query(
        `SELECT id, mission_type, xp_reward, total, target_hall_name, hall_match_mode, target_company_id
         FROM quest_content
         WHERE is_active = true AND xp_reward > 0 AND event_id = $1
           AND mission_type IN ('booth_scan', 'hall_scan', 'special_booth')`,
        [currentEventId]
      );

      for (const m of scanMissions) {
        let completed = false;

        if (m.mission_type === 'booth_scan') {
          const { rows } = await query(
            `SELECT COUNT(*) AS cnt FROM quest_scans WHERE user_uuid = $1 AND event_id = $2`,
            [userUuid, currentEventId]
          );
          completed = parseInt(rows[0].cnt, 10) >= m.total;

        } else if (m.mission_type === 'hall_scan') {
          if (!m.target_hall_name) continue;
          // sub-phase 4: qs.company_id now holds companies_placement.id --
          // join on id, not company_id. c.event_id scope still required
          // (companies_placement has one row per event per company).
          const { rows } = await query(
            `SELECT COUNT(DISTINCT qs.company_id) AS cnt
             FROM quest_scans qs
             JOIN companies_placement c ON c.id = qs.company_id AND c.event_id = $4
             WHERE qs.user_uuid = $1 AND c.hall_name = $2 AND c.rasayesh_event_id = $3`,
            [userUuid, m.target_hall_name, Number(eventId), currentEventId]
          );
          const scanned = parseInt(rows[0].cnt, 10);
          completed = m.hall_match_mode === 'any' ? scanned >= 1 : scanned >= m.total;

        } else if (m.mission_type === 'special_booth') {
          // sub-phase 4: target_company_id is companies_placement.id;
          // compare against company.placement_id, not the global company.id.
          if (!m.target_company_id || company.placement_id !== m.target_company_id) continue;
          completed = true;
        }

        if (completed) {
          await query(
            `INSERT INTO quest_xp_grants (user_uuid, source_type, source_id, xp_amount, event_id)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (user_uuid, source_type, source_id) DO NOTHING`,
            [userUuid, `mission_${m.mission_type}`, m.id, m.xp_reward, currentEventId]
          ).catch(() => {});
        }
      }
    } catch (missionXpErr) {
      console.error('[quest/scan] mission XP grant failed:', missionXpErr.message);
    }

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
          `INSERT INTO quest_badge_progress (badge_id, user_uuid, earned, earned_at, event_id)
           VALUES ($1, $2, true, NOW(), $3)
           ON CONFLICT (badge_id, user_uuid) DO UPDATE SET earned = true, earned_at = NOW()`,
          [company.linked_badge_id, userUuid, currentEventId]
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
        `INSERT INTO quest_badge_progress (badge_id, user_uuid, earned, earned_at, event_id)
         VALUES ($1, $2, true, NOW(), $3)
         ON CONFLICT (badge_id, user_uuid) DO UPDATE SET earned = true, earned_at = NOW()`,
        [bonusBadge.id, userUuid, currentEventId]
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
