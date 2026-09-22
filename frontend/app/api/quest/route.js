import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { unstable_cache } from 'next/cache';
import { query } from '@/lib/db';
import { ensureFeaturedBoothState, isWithinDailyWindow } from '@/lib/featuredBoothHelper';
import { getCurrentEventId } from '@/lib/currentEvent';
import { getInactiveMissionState } from '@/lib/questMissionHistory';

// Mission DEFINITIONS only (admin-curated: title/description/xp/icon/quiz
// question/survey fields/etc, quest_content table) — cached. Every per-user
// field (progress, quiz_attempted, survey_submitted, social_share_status,
// featured-booth pool scan status) is computed below via calcProgress() and
// friends, per request, per user, completely untouched by this change.
//
// Deliberately NOT filtered on is_active here: this cache is keyed only by
// event_id and shared across every user (unstable_cache, 300s TTL) -- it
// cannot know per-user completion, so per-user "still show if I already
// completed it" logic can't live in this query without a cache entry per
// user. Inactive missions are fetched too; GET below decides visibility per
// request/per user via isMissionCompletedForUser().
const getCachedMissionDefinitions = unstable_cache(
  async (currentEventId) => {
    // LEFT JOIN: sponsor_company_id is optional (nullable) -- resolves the
    // sponsor's display fields here so callers don't need a second lookup.
    const { rows } = await query(
      `SELECT qc.*,
              cp.brand_name_fa AS sponsor_brand_name_fa,
              cp.brand_name_en AS sponsor_brand_name_en,
              cp.logo AS sponsor_logo
       FROM quest_content qc
       LEFT JOIN companies_placement cp ON cp.id = qc.sponsor_company_id
       WHERE qc.event_id = $1 ORDER BY qc.sort_order ASC, qc.id ASC`,
      [currentEventId]
    );
    return rows;
  },
  ['quest-mission-definitions'],
  { tags: ['quest-mission-definitions'], revalidate: 300 }
);

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

async function calcProgress(mission, userUuid, eventId, currentEventId) {
  if (!userUuid) return 0;
  try {
    switch (mission.mission_type) {
      case 'booth_scan': {
        const r = await query(
          'SELECT COUNT(*) FROM quest_scans WHERE user_uuid = $1 AND event_id = $2',
          [userUuid, currentEventId]
        );
        return parseInt(r.rows[0].count, 10);
      }
      case 'special_booth': {
        if (!mission.target_company_id) return 0;
        const r = await query(
          'SELECT COUNT(*) FROM quest_scans WHERE user_uuid = $1 AND company_id = $2 AND event_id = $3',
          [userUuid, mission.target_company_id, currentEventId]
        );
        return parseInt(r.rows[0].count, 10) > 0 ? 1 : 0;
      }
      case 'chat': {
        const r = await query(
          `SELECT qup.completed FROM quest_user_progress qup
           JOIN quest_content qc ON qc.id = qup.mission_id
           WHERE qup.mission_id = $1 AND qup.user_uuid = $2 AND qc.event_id = $3`,
          [mission.id, userUuid, currentEventId]
        );
        return r.rows.length > 0 && r.rows[0].completed ? 1 : 0;
      }
      case 'profile_photo': {
        const r = await query(
          `SELECT qup.completed FROM quest_user_progress qup
           JOIN quest_content qc ON qc.id = qup.mission_id
           WHERE qup.mission_id = $1 AND qup.user_uuid = $2 AND qc.event_id = $3`,
          [mission.id, userUuid, currentEventId]
        );
        return r.rows.length > 0 && r.rows[0].completed ? 1 : 0;
      }
      case 'attendance':
      case 'manual': {
        const r = await query(
          `SELECT qup.completed FROM quest_user_progress qup
           JOIN quest_content qc ON qc.id = qup.mission_id
           WHERE qup.mission_id = $1 AND qup.user_uuid = $2 AND qc.event_id = $3`,
          [mission.id, userUuid, currentEventId]
        );
        return r.rows.length > 0 && r.rows[0].completed ? 1 : 0;
      }
      case 'hall_scan': {
        if (!mission.target_hall_name) return 0;
        // sub-phase 4: qs.company_id now holds companies_placement.id --
        // join on id, not company_id.
        const r = await query(
          `SELECT COUNT(DISTINCT qs.company_id) AS cnt
           FROM quest_scans qs
           JOIN companies_placement c ON c.id = qs.company_id
           WHERE qs.user_uuid = $1 AND c.hall_name = $2 AND c.rasayesh_event_id = $3
             AND qs.event_id = $4 AND c.event_id = $4`,
          [userUuid, mission.target_hall_name, Number(eventId), currentEventId]
        );
        const scanned = parseInt(r.rows[0].cnt, 10);
        return mission.hall_match_mode === 'any' ? (scanned >= 1 ? 1 : 0) : scanned;
      }
      case 'quiz': {
        const r = await query(
          `SELECT is_correct FROM quest_quiz_attempts WHERE mission_id = $1 AND user_uuid = $2 AND event_id = $3`,
          [mission.id, userUuid, currentEventId]
        ).catch(() => ({ rows: [] }));
        return r.rows.length > 0 && r.rows[0].is_correct ? 1 : 0;
      }
      case 'survey': {
        const r = await query(
          `SELECT id FROM quest_survey_responses WHERE mission_id = $1 AND user_uuid = $2 AND event_id = $3`,
          [mission.id, userUuid, currentEventId]
        ).catch(() => ({ rows: [] }));
        return r.rows.length > 0 ? 1 : 0;
      }
      case 'featured_booth': {
        const r = await query(
          `SELECT qup.completed FROM quest_user_progress qup
           JOIN quest_content qc ON qc.id = qup.mission_id
           WHERE qup.mission_id = $1 AND qup.user_uuid = $2 AND qc.event_id = $3`,
          [mission.id, userUuid, currentEventId]
        );
        return r.rows.length > 0 && r.rows[0].completed ? 1 : 0;
      }
      case 'referral_code': {
        // Cumulative confirmed-referral count for this user as REFERRER,
        // compared against this tier's own referral_required_count (total,
        // already generic below) -- same live-computed-count shape as
        // hall_scan/booth_scan above, not a stored/incremented counter.
        const r = await query(
          `SELECT COUNT(*) FROM quest_referral_redemptions
           WHERE referrer_user_uuid = $1 AND event_id = $2 AND status = 'confirmed'`,
          [userUuid, currentEventId]
        );
        return parseInt(r.rows[0].count, 10);
      }
      case 'social_share': {
        const r = await query(
          `SELECT status FROM quest_social_share_submissions
           WHERE mission_id = $1 AND user_uuid = $2 AND status = 'approved' AND event_id = $3
           LIMIT 1`,
          [mission.id, userUuid, currentEventId]
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

// Mirrors QuestClient.js's isMissionCompleted() (client-side "done" check) so
// a deactivated mission is hidden/shown by the exact same completion rule
// the UI already uses to render the checkmark -- keeps the two in sync
// instead of inventing a second definition of "completed".
function isMissionCompletedForUser(m, progress, quiz_attempted, social_share_status) {
  if (m.mission_type === 'referral_code' && m.referral_is_unlimited) return false;
  if (progress >= m.total) return true;
  if (m.mission_type === 'quiz' && quiz_attempted) return true;
  if (m.mission_type === 'social_share' && social_share_status === 'pending') return true;
  return false;
}

export async function GET() {
  try {
    const currentEventId = await getCurrentEventId();
    const userUuid = await getUserUuid();

    const settingsResult = await query(
      "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'companies_config'",
      [currentEventId]
    );
    const eventId = settingsResult.rows[0]?.value?.event_id;

    const rows = await getCachedMissionDefinitions(currentEventId);
    // Inactive mission visibility is durable, event-scoped history only. A
    // missing table during the separately scheduled migration is treated as
    // no history, never as a reason to fall back to live dynamic counts.
    const historyByMission = new Map();
    if (userUuid) {
      const historyResult = await query(
        `SELECT mission_id, status, evidence_type, evidence_id, participated_at, completed_at
         FROM quest_mission_history
         WHERE event_id = $1 AND user_uuid = $2`,
        [currentEventId, userUuid]
      ).catch(() => ({ rows: [] }));
      for (const history of historyResult.rows) historyByMission.set(history.mission_id, history);
    }

    const missions = (await Promise.all(
      rows.map(async (m) => {
        const history = historyByMission.get(m.id) || null;
        const inactiveState = getInactiveMissionState(m, history);
        if (!m.is_active && !inactiveState.visible) return null;
        // Freeze disabled state at the last valid active transition. In
        // particular, do not re-count scans or referrals after disable.
        const progress = !m.is_active
          ? inactiveState.progress
          : await calcProgress(m, userUuid, eventId, currentEventId);
        let quiz_attempted = false;
        if (m.mission_type === 'quiz' && userUuid && m.is_active) {
          const aR = await query(
            `SELECT id FROM quest_quiz_attempts WHERE mission_id = $1 AND user_uuid = $2 AND event_id = $3`,
            [m.id, userUuid, currentEventId]
          ).catch(() => ({ rows: [] }));
          quiz_attempted = aR.rows.length > 0;
        }
        let survey_submitted = false;
        if (m.mission_type === 'survey' && userUuid && m.is_active) {
          const sR = await query(
            `SELECT id FROM quest_survey_responses WHERE mission_id = $1 AND user_uuid = $2 AND event_id = $3`,
            [m.id, userUuid, currentEventId]
          ).catch(() => ({ rows: [] }));
          survey_submitted = sR.rows.length > 0;
        }

        let social_share_status = undefined;
        let social_share_note = undefined;
        if (m.mission_type === 'social_share' && userUuid && m.is_active) {
          const ssR = await query(
            `SELECT status, admin_note FROM quest_social_share_submissions
             WHERE mission_id = $1 AND user_uuid = $2 AND event_id = $3
             ORDER BY submitted_at DESC LIMIT 1`,
            [m.id, userUuid, currentEventId]
          ).catch(() => ({ rows: [] }));
          if (ssR.rows.length > 0) {
            social_share_status = ssR.rows[0].status;
            social_share_note = ssR.rows[0].admin_note || null;
          }
        }

        if (!m.is_active && history) {
          if (m.mission_type === 'quiz') quiz_attempted = history.status !== 'participated' || history.evidence_type === 'quiz_attempt';
          if (m.mission_type === 'survey') survey_submitted = history.status === 'completed';
          if (m.mission_type === 'social_share') social_share_status = history.status;
        }

        // Countdown for featured_booth: return next rotation timestamp (no golden
        // booth identity revealed — only WHEN the next rotation occurs).
        let featured_booth_next_rotation = undefined;
        // True while the current cycle's golden booth has already been
        // scanned by someone -- the mission is locked for everyone else
        // until featured_booth_next_rotation passes (see 2026-09-14 spec,
        // point 3). Reuses ensureFeaturedBoothState's own return value
        // instead of a second separate lookup.
        let featured_booth_claimed = undefined;
        // Pool companies for featured_booth: show all candidates so the user knows
        // which booths to visit. Does NOT reveal which is currently golden.
        let featured_booth_pool_companies = undefined;
        if (m.mission_type === 'featured_booth') {
          // Lazily ensure a state row exists so the countdown is non-null on first load.
          let fbState = null;
          if (Array.isArray(m.featured_booth_pool) && m.featured_booth_pool.length >= 2) {
            fbState = await ensureFeaturedBoothState(m, 'mission').catch(() => null);
          }
          if (fbState?.selected_at) {
            const nextMs = new Date(fbState.selected_at).getTime() +
              Math.max(1, m.featured_booth_rotation_hours ?? 1) * 3_600_000;
            featured_booth_next_rotation = new Date(nextMs).toISOString();
          }
          featured_booth_claimed = !!fbState?.claimed_at;
          // Resolve company details for every pool member (no golden booth revealed).
          const pool = m.featured_booth_pool;
          if (Array.isArray(pool) && pool.length > 0) {
            // pool holds global Rasayesh company ids (admin-picked); company_id
            // is kept in the response for external callers (unchanged
            // contract), but sub-phase 4 also needs each row's own id
            // (placement id) to match against quest_scans.company_id below.
            const { rows: poolRows } = await query(
              `SELECT id, company_id, brand_name_fa, brand_name_en, logo, hall_name, booth_no
               FROM companies_placement WHERE company_id = ANY($1::int[]) AND rasayesh_event_id = $2 AND event_id = $3
               ORDER BY hall_name ASC NULLS LAST, booth_no ASC NULLS LAST`,
              [pool, Number(eventId), currentEventId]
            ).catch(() => ({ rows: [] }));
            // Per-company scan status for the authenticated user.
            let scanMap = {};
            if (userUuid && poolRows.length > 0) {
              // sub-phase 4: quest_scans.company_id now holds companies_placement.id
              // (the surrogate id), not the global company id -- match on
              // each pool row's own id, not its company_id.
              const ids = poolRows.map(r => r.id);
              // Rotation-aware, same threshold scan/route.js's own dedup check
              // uses (scanned_at >= state.selected_at) -- a scan from BEFORE
              // the current cycle started must not still show as checked/
              // claimed here, since the user IS allowed to re-scan it (2026-
              // 09-14 live bug report: this query was the one spot that never
              // got updated when the scan-time dedup became rotation-aware --
              // it used to check "has this user EVER scanned this company",
              // unbounded, which is a different, stale answer from what the
              // scan endpoint itself would actually allow). fbState can be
              // null (misconfigured/empty pool) -- the IS NULL branch then
              // falls back to the old unconditional (ever-scanned) behavior,
              // matching this endpoint's own pre-existing null-state handling
              // elsewhere in this block.
              const { rows: scanRows } = await query(
                `SELECT company_id, bool_or(is_featured_booth_bonus) AS got_bonus
                 FROM quest_scans
                 WHERE user_uuid = $1 AND company_id = ANY($2::int[]) AND event_id = $3
                   AND ($4::timestamp IS NULL OR scanned_at >= $4::timestamp)
                 GROUP BY company_id`,
                [userUuid, ids, currentEventId, fbState?.selected_at ?? null]
              ).catch(() => ({ rows: [] }));
              for (const sr of scanRows) {
                // sr.company_id is quest_scans' column, which now holds a
                // placement id (see comment above) -- keying scanMap by it
                // directly, so the lookup below must use c.id, not c.company_id.
                scanMap[sr.company_id] = { got_bonus: sr.got_bonus };
              }
            }
            featured_booth_pool_companies = poolRows.map(c => ({
              ...c,
              user_scanned: !!scanMap[c.id],
              user_got_bonus: !!(scanMap[c.id]?.got_bonus),
            }));
          } else {
            featured_booth_pool_companies = [];
          }
        }

        // Real local variable (not just an object-literal key) so
        // featured_booth_lock_reason below can actually reference it --
        // object-literal properties aren't visible to sibling properties
        // within the same literal.
        const featuredBoothClosed = m.mission_type === 'featured_booth'
          ? !isWithinDailyWindow(m.featured_booth_daily_start_hour, m.featured_booth_daily_end_hour)
          : false;

        return {
          id: m.id,
          title: m.title_fa,
          title_en: m.title_en,
          description: m.description_fa,
          description_en: m.description_en,
          icon: m.icon_value,
          icon_size: m.icon_size ?? 36,
          is_icon_color_unique: m.is_icon_color_unique === true,
          icon_color_dark_active: m.icon_color_dark_active ?? null,
          icon_color_dark_completed: m.icon_color_dark_completed ?? null,
          icon_color_light_active: m.icon_color_light_active ?? null,
          icon_color_light_completed: m.icon_color_light_completed ?? null,
          xpReward: m.xp_reward,
          featuredBoothBonusXp: m.mission_type === 'featured_booth' ? (m.featured_booth_bonus_xp ?? 500) : undefined,
          mission_type: m.mission_type,
          is_active: m.is_active,
          historical_status: !m.is_active ? history?.status ?? null : null,
          // Unlimited-mode referral_code missions repeat per-invite XP with
          // no tier/threshold (see lib/referralUnlimited.js) -- the client
          // needs this to know xp_reward/progress/total are symbolic for
          // this specific mission and must not drive the XP badge, progress
          // bar, or completion state the way they do for every other
          // mission type (including tiered referral_code missions, which
          // keep their existing behavior untouched).
          referral_is_unlimited: m.mission_type === 'referral_code' ? (m.referral_is_unlimited === true) : undefined,
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
          // Admin-editable "your post must be public" hint (quest_content),
          // shown in SocialShareModal -- iph-app falls back to its own
          // hardcoded default text when the admin has left this blank.
          social_share_hint_fa: m.mission_type === 'social_share' ? (m.social_share_hint_fa ?? null) : undefined,
          social_share_hint_en: m.mission_type === 'social_share' ? (m.social_share_hint_en ?? null) : undefined,
          featured_booth_next_rotation,
          featured_booth_claimed,
          featured_booth_pool_companies,
          featured_booth_daily_start_hour: m.mission_type === 'featured_booth' ? (m.featured_booth_daily_start_hour ?? null) : undefined,
          featured_booth_daily_end_hour: m.mission_type === 'featured_booth' ? (m.featured_booth_daily_end_hour ?? null) : undefined,
          featured_booth_closed: m.mission_type === 'featured_booth' ? featuredBoothClosed : undefined,
          featured_booth_message_fa: m.mission_type === 'featured_booth' ? (m.featured_booth_message_fa ?? null) : undefined,
          featured_booth_message_en: m.mission_type === 'featured_booth' ? (m.featured_booth_message_en ?? null) : undefined,
          // Distinct reason enum ('closed' | 'claimed' | null) rather than
          // just the two raw booleans -- see 2026-09-14 follow-up. 'closed'
          // takes precedence: a mission that's both outside its window AND
          // still shows a stale claimed_at from before the freeze should
          // read as closed, not claimed.
          featured_booth_lock_reason: m.mission_type === 'featured_booth'
            ? (featuredBoothClosed ? 'closed' : (featured_booth_claimed ? 'claimed' : null))
            : undefined,
          featured_booth_closed_message_fa: m.mission_type === 'featured_booth' ? (m.featured_booth_closed_message_fa ?? null) : undefined,
          featured_booth_closed_message_en: m.mission_type === 'featured_booth' ? (m.featured_booth_closed_message_en ?? null) : undefined,
          featured_booth_claimed_message_fa: m.mission_type === 'featured_booth' ? (m.featured_booth_claimed_message_fa ?? null) : undefined,
          featured_booth_claimed_message_en: m.mission_type === 'featured_booth' ? (m.featured_booth_claimed_message_en ?? null) : undefined,
          sponsor: m.sponsor_company_id ? {
            brand_name_fa: m.sponsor_brand_name_fa,
            brand_name_en: m.sponsor_brand_name_en,
            logo: m.sponsor_logo,
          } : null,
        };
      })
    )).filter(Boolean);

    return NextResponse.json({ missions });
  } catch (err) {
    console.error('[GET /api/quest]', err.message);
    return NextResponse.json({ missions: [] });
  }
}
