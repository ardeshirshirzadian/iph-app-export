import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { getCurrentEventId } from '@/lib/currentEvent';
import { isUnlimitedReferralActive } from '@/lib/referralUnlimited';
import { resolveOccupationLabels } from '@/lib/occupationResolver';

export const dynamic = 'force-dynamic';

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

// profileImage (app_users.profile_image) is refreshed on every login AND
// on every AttendeeProvider fetchAttendee resolution (see
// app/api/auth/sync-profile-photo/route.js) -- profilePhotoUrl
// (quest_user_names.profile_photo_url) is only ever a snapshot COPIED FROM
// app_users at the user's last booth scan (see cacheUserName() in
// scan/route.js, which reads app_users itself, not Rasayesh live). It can
// therefore never be fresher than profileImage, only staler or equal.
// Check the fresher source first; quest_user_names is now purely a
// fallback for the rare case a current-event app_users row doesn't exist.
function resolvePhotoUrl(profilePhotoUrl, profileImage, hideLeaderboardPhoto) {
  if (hideLeaderboardPhoto) return null;
  if (profileImage) {
    const raw = typeof profileImage === 'string' ? profileImage : null;
    if (raw && raw.startsWith('/')) return RASAYESH_BASE + raw;
    if (raw && raw.startsWith('http')) return raw;
  }
  if (profilePhotoUrl) {
    return profilePhotoUrl.startsWith('http') ? profilePhotoUrl : RASAYESH_BASE + profilePhotoUrl;
  }
  return null;
}

async function getLeaderboardLimit(eventId) {
  try {
    const result = await query(
      "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'quest_settings'",
      [eventId]
    );
    const limit = parseInt(result.rows[0]?.value?.leaderboard_limit, 10);
    return Number.isFinite(limit) && limit >= 1 ? limit : 50;
  } catch {
    return 50;
  }
}

// isUnlimitedReferralActive now lives in lib/referralUnlimited.js, shared
// with the segment-config route below so the two can never disagree about
// whether the feature is "on" -- see that file for the full comment.

// Returns the SQL fragment for the referral_count column (including its
// leading comma), or '' when no unlimited-mode mission is active -- omitted
// entirely from the SELECT in that case, not just hidden client-side, so an
// inactive event pays zero extra query cost for this.
function referralCountSelectFragment(alias, active) {
  if (!active) return '';
  return `,
            (SELECT COUNT(*)::int FROM quest_referral_redemptions rr
             WHERE rr.referrer_user_uuid = ${alias}.user_uuid AND rr.event_id = $1 AND rr.status = 'confirmed'
            ) AS referral_count`;
}

// occupation_id is used only inside this route to resolve canonical
// Rasayesh form-option labels. Never return the ID itself to leaderboard
// clients, and let a failed options lookup degrade to no job metadata.
async function addOccupationLabels(leaderboard, currentUser, isIranPharma) {
  // This enhancement belongs to IranPharma only. Other event domains retain
  // their existing participant response shape, while still stripping the
  // query-internal ID below.
  if (!isIranPharma) {
    const withoutOccupationId = ({ occupation_id, ...participant }) => participant;
    return {
      leaderboard: leaderboard.map(withoutOccupationId),
      currentUser: currentUser ? withoutOccupationId(currentUser) : null,
    };
  }
  const participants = [...leaderboard, ...(currentUser ? [currentUser] : [])];
  const labels = await resolveOccupationLabels(participants.map((participant) => participant.occupation_id));
  const decorate = ({ occupation_id, ...participant }) => {
    const label = labels.get(String(occupation_id));
    return {
      ...participant,
      occupation_label_fa: label?.fa || null,
      occupation_label_en: label?.en || null,
    };
  };
  return { leaderboard: leaderboard.map(decorate), currentUser: currentUser ? decorate(currentUser) : null };
}

// Shared CTE that computes total XP per user, scoped to one event.
// event_id must always be bound as the query's FIRST parameter ($1) by every
// caller below -- quest_scans.event_id / quest_xp_grants.event_id are what
// keep two events' XP totals (and therefore rankings) from being summed
// together. quest_xp_grants itself has no unique constraint on event_id (see
// Tier 3 audit notes), so this filter is the only thing keeping it isolated.
//
// app_users.excluded_from_leaderboard (admin-set, iph-apn Users section):
// filtered into the two TOP-N listing queries below (level + overall), AND
// into both currentUser rank computations (level + overall) -- an excluded
// user's own row is still always retrievable for display purposes (total_xp,
// name, photo), but is never counted as a competitor when computing ANYONE's
// numeric rank, including their own (which gets nulled out anyway -- see
// below). Before this fix, only the top-N queries filtered the ranking pool;
// the currentUser queries ranked over every user including excluded ones,
// which silently inflated every remaining (non-excluded) user's own reported
// rank by however many excluded users outranked them, even though the public
// top-N list itself was always correct. quest_stats is untouched entirely
// (it never reads app_users).
const XP_CTE = `
  WITH scan_agg AS (
    SELECT user_uuid,
           SUM(xp_earned)::int AS xp,
           COUNT(*)::int       AS scan_count
    FROM quest_scans
    WHERE event_id = $1
    GROUP BY user_uuid
  ),
  grant_agg AS (
    SELECT user_uuid,
           SUM(xp_amount)::int AS xp
    FROM quest_xp_grants
    WHERE event_id = $1
    GROUP BY user_uuid
  ),
  combined AS (
    SELECT
      COALESCE(s.user_uuid, g.user_uuid)      AS user_uuid,
      COALESCE(s.xp, 0) + COALESCE(g.xp, 0)  AS total_xp,
      COALESCE(s.scan_count, 0)                AS scan_count
    FROM scan_agg s
    FULL OUTER JOIN grant_agg g ON s.user_uuid = g.user_uuid
  )
`;

export async function GET(request) {
  const cookieStore = await cookies();
  const userRaw = cookieStore.get('iph_user')?.value;

  let currentUuid = null;
  try {
    const user = JSON.parse(decodeURIComponent(userRaw));
    currentUuid = user?.uuid || null;
  } catch {}

  const currentEventId = await getCurrentEventId();
  const referralLeaderboardActive = await isUnlimitedReferralActive(currentEventId);

  const { searchParams } = new URL(request.url);
  const levelParam = searchParams.get('level');
  const levelId = levelParam ? parseInt(levelParam, 10) : null;
  // Skips the top-N leaderboard query (JOINs + ORDER BY + LIMIT) when the
  // caller only needs currentUser.rank -- e.g. QuestClient's live-XP poll,
  // which refetches on every XP change purely to keep the rank stat current.
  const rankOnly = searchParams.get('rankOnly') === 'true';
  const segment = searchParams.get('segment');

  try {
    await ensureQuestUserNamesTable();

    // ── REFERRAL LEADERBOARD SEGMENT (Part 2b) ──────────────────────────────
    // Entirely gated on referralLeaderboardActive (computed above, shared
    // with the segment-config route) -- returns empty rather than erroring
    // if hit directly while inactive, defense in depth on top of the
    // frontend simply never requesting this segment when the tab is hidden.
    if (segment === 'referral') {
      if (!referralLeaderboardActive) {
        return NextResponse.json({ leaderboard: [], currentUser: null });
      }

      let leaderboard = [];
      if (!rankOnly) {
        const limitResult = await query(
          "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'referral_leaderboard_config'",
          [currentEventId]
        );
        const rawLimit = parseInt(limitResult.rows[0]?.value?.leaderboard_limit, 10);
        const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? rawLimit : 20;

        // referral_agg has no row at all for a user with zero confirmed
        // referrals -- same "not in the ranking pool" treatment a zero-XP
        // user already gets from the main XP_CTE's FULL OUTER JOIN above,
        // not a new inconsistency introduced here.
        const { rows: topRows } = await query(`
          WITH referral_agg AS (
            SELECT referrer_user_uuid AS user_uuid, COUNT(*)::int AS referral_count
            FROM quest_referral_redemptions
            WHERE event_id = $1 AND status = 'confirmed'
            GROUP BY referrer_user_uuid
          )
          SELECT
            ra.user_uuid, ra.referral_count,
            COALESCE(
              NULLIF(TRIM(COALESCE(au.firstname_fa, '') || ' ' || COALESCE(au.lastname_fa, '')), ''),
              qn.display_name_fa,
              'شرکت‌کننده'
            ) AS display_name_fa,
            COALESCE(
              NULLIF(TRIM(COALESCE(au.firstname_en, '') || ' ' || COALESCE(au.lastname_en, '')), ''),
              qn.display_name_en
            ) AS display_name_en,
            qn.profile_photo_url, au.profile_image, au.hide_leaderboard_photo, au.occupation_id,
            -- Same DENSE_RANK() convention as every other location in this file.
            DENSE_RANK() OVER (ORDER BY ra.referral_count DESC)::int AS rank
          FROM referral_agg ra
          LEFT JOIN quest_user_names qn ON ra.user_uuid = qn.user_uuid
          LEFT JOIN app_users        au ON ra.user_uuid = au.uuid AND au.event_id = $1
          WHERE (au.excluded_from_leaderboard IS NOT TRUE)
          ORDER BY ra.referral_count DESC, ra.user_uuid ASC
          LIMIT $2
        `, [currentEventId, limit]);

        leaderboard = topRows.map(row => ({
          rank:              row.rank,
          user_uuid:         row.user_uuid,
          display_name_fa:   row.display_name_fa,
          display_name_en:   row.display_name_en || null,
          referral_count:    row.referral_count,
          profile_photo_url: resolvePhotoUrl(row.profile_photo_url, row.profile_image, row.hide_leaderboard_photo),
          occupation_id:     row.occupation_id,
        }));
      }

      let currentUser = null;
      if (currentUuid) {
        const { rows: rankRows } = await query(`
          WITH referral_agg AS (
            SELECT referrer_user_uuid AS user_uuid, COUNT(*)::int AS referral_count
            FROM quest_referral_redemptions
            WHERE event_id = $1 AND status = 'confirmed'
            GROUP BY referrer_user_uuid
          )
          SELECT
            ra.referral_count,
            qn.profile_photo_url, au.profile_image, au.hide_leaderboard_photo,
            au.excluded_from_leaderboard, au.occupation_id,
            (
              SELECT COUNT(DISTINCT ra2.referral_count)::int + 1
              FROM referral_agg ra2
              LEFT JOIN app_users au2 ON ra2.user_uuid = au2.uuid AND au2.event_id = $1
              WHERE (au2.excluded_from_leaderboard IS NOT TRUE)
                AND ra2.referral_count > ra.referral_count
            ) AS rank
          FROM referral_agg ra
          LEFT JOIN quest_user_names qn ON ra.user_uuid = qn.user_uuid
          LEFT JOIN app_users        au ON ra.user_uuid = au.uuid AND au.event_id = $1
          WHERE ra.user_uuid = $2
        `, [currentEventId, currentUuid]);

        // No row = this user has zero confirmed referrals -- same as a
        // zero-XP user on the main board, currentUser simply stays null;
        // not an error case, not special-cased beyond that.
        if (rankRows.length > 0) {
          currentUser = {
            user_uuid:         currentUuid,
            rank:              rankRows[0].excluded_from_leaderboard ? null : rankRows[0].rank,
            referral_count:    rankRows[0].referral_count,
            profile_photo_url: resolvePhotoUrl(rankRows[0].profile_photo_url, rankRows[0].profile_image, rankRows[0].hide_leaderboard_photo),
            occupation_id:     rankRows[0].occupation_id,
          };
        }
      }

      return NextResponse.json(await addOccupationLabels(leaderboard, currentUser, currentEventId === 1));
    }

    // ── SCAN LEADERBOARD SEGMENT (people ranked by their own real scan count) ──
    // Same shape as the referral segment above (top-N + current-viewer rank),
    // just a different ranking metric -- COUNT(*) of a user's own
    // quest_scans rows, restricted to real physical booths (cp.is_manual =
    // false), same restriction and join the booths segment below already
    // uses to rank companies -- per Ardeshir's explicit call, a "scan" here
    // means a real booth visit, not a QR-gimmick manual mission. Always
    // available, no active/inactive gate (like the booths segment, unlike
    // referral): a personal scan count needs no "is this feature even on"
    // concept the way an unlimited-referral mission does.
    if (segment === 'scans') {
      let leaderboard = [];
      if (!rankOnly) {
        const limitResult = await query(
          "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'scan_leaderboard_config'",
          [currentEventId]
        );
        const rawLimit = parseInt(limitResult.rows[0]?.value?.leaderboard_limit, 10);
        const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? rawLimit : 20;

        // scan_agg has no row at all for a user with zero real-booth scans --
        // same "not in the ranking pool" treatment a zero-XP or zero-referral
        // user already gets elsewhere in this file, not a new inconsistency.
        const { rows: topRows } = await query(`
          WITH scan_agg AS (
            SELECT qs.user_uuid, COUNT(*)::int AS scan_count
            FROM quest_scans qs
            JOIN companies_placement cp ON cp.id = qs.company_id AND cp.event_id = qs.event_id
            WHERE qs.event_id = $1 AND cp.is_manual = false
            GROUP BY qs.user_uuid
          )
          SELECT
            sa.user_uuid, sa.scan_count,
            COALESCE(
              NULLIF(TRIM(COALESCE(au.firstname_fa, '') || ' ' || COALESCE(au.lastname_fa, '')), ''),
              qn.display_name_fa,
              'شرکت‌کننده'
            ) AS display_name_fa,
            COALESCE(
              NULLIF(TRIM(COALESCE(au.firstname_en, '') || ' ' || COALESCE(au.lastname_en, '')), ''),
              qn.display_name_en
            ) AS display_name_en,
            qn.profile_photo_url, au.profile_image, au.hide_leaderboard_photo, au.occupation_id,
            -- Same DENSE_RANK() convention as every other location in this file.
            DENSE_RANK() OVER (ORDER BY sa.scan_count DESC)::int AS rank
          FROM scan_agg sa
          LEFT JOIN quest_user_names qn ON sa.user_uuid = qn.user_uuid
          LEFT JOIN app_users        au ON sa.user_uuid = au.uuid AND au.event_id = $1
          WHERE (au.excluded_from_leaderboard IS NOT TRUE)
          ORDER BY sa.scan_count DESC, sa.user_uuid ASC
          LIMIT $2
        `, [currentEventId, limit]);

        leaderboard = topRows.map(row => ({
          rank:              row.rank,
          user_uuid:         row.user_uuid,
          display_name_fa:   row.display_name_fa,
          display_name_en:   row.display_name_en || null,
          scan_count:        row.scan_count,
          profile_photo_url: resolvePhotoUrl(row.profile_photo_url, row.profile_image, row.hide_leaderboard_photo),
          occupation_id:     row.occupation_id,
        }));
      }

      let currentUser = null;
      if (currentUuid) {
        const { rows: rankRows } = await query(`
          WITH scan_agg AS (
            SELECT qs.user_uuid, COUNT(*)::int AS scan_count
            FROM quest_scans qs
            JOIN companies_placement cp ON cp.id = qs.company_id AND cp.event_id = qs.event_id
            WHERE qs.event_id = $1 AND cp.is_manual = false
            GROUP BY qs.user_uuid
          )
          SELECT
            sa.scan_count,
            qn.profile_photo_url, au.profile_image, au.hide_leaderboard_photo,
            au.excluded_from_leaderboard, au.occupation_id,
            (
              SELECT COUNT(DISTINCT sa2.scan_count)::int + 1
              FROM scan_agg sa2
              LEFT JOIN app_users au2 ON sa2.user_uuid = au2.uuid AND au2.event_id = $1
              WHERE (au2.excluded_from_leaderboard IS NOT TRUE)
                AND sa2.scan_count > sa.scan_count
            ) AS rank
          FROM scan_agg sa
          LEFT JOIN quest_user_names qn ON sa.user_uuid = qn.user_uuid
          LEFT JOIN app_users        au ON sa.user_uuid = au.uuid AND au.event_id = $1
          WHERE sa.user_uuid = $2
        `, [currentEventId, currentUuid]);

        // No row = this user has zero real-booth scans -- same as a zero-
        // referral user on that segment, currentUser simply stays null; not
        // an error case, not special-cased beyond that.
        if (rankRows.length > 0) {
          currentUser = {
            user_uuid:         currentUuid,
            rank:              rankRows[0].excluded_from_leaderboard ? null : rankRows[0].rank,
            scan_count:        rankRows[0].scan_count,
            profile_photo_url: resolvePhotoUrl(rankRows[0].profile_photo_url, rankRows[0].profile_image, rankRows[0].hide_leaderboard_photo),
            occupation_id:     rankRows[0].occupation_id,
          };
        }
      }

      return NextResponse.json(await addOccupationLabels(leaderboard, currentUser, currentEventId === 1));
    }

    // ── BOOTH LEADERBOARD SEGMENT (companies ranked by real scan count) ────
    // Always available (no active/inactive gate, unlike the referral
    // segment above -- see booth-leaderboard-config/route.js's own comment).
    // Ranks companies_placement rows by how many quest_scans rows exist for
    // them, restricted to cp.is_manual = false: "غرفه" means a physical
    // exhibition booth specifically, so QR-gimmick "missions" like the
    // hidden-QR-on-our-website one (is_manual = true) are deliberately
    // excluded -- per Ardeshir's explicit decision, even though this means
    // the segment shows very little (often just one company) until real
    // booth-scan volume picks up over the event. No "current viewer rank"
    // query here (unlike every other segment in this file): this ranks
    // companies, not people, so there is no equivalent concept.
    if (segment === 'booths') {
      const limitResult = await query(
        "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'booth_leaderboard_config'",
        [currentEventId]
      );
      const rawLimit = parseInt(limitResult.rows[0]?.value?.leaderboard_limit, 10);
      const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? rawLimit : 20;

      let leaderboard = [];
      if (!rankOnly) {
        const { rows: topRows } = await query(`
          WITH scan_agg AS (
            SELECT qs.company_id, COUNT(*)::int AS scan_count
            FROM quest_scans qs
            JOIN companies_placement cp ON cp.id = qs.company_id AND cp.event_id = qs.event_id
            WHERE qs.event_id = $1 AND cp.is_manual = false
            GROUP BY qs.company_id
          )
          SELECT cp.id, cp.brand_name_fa, cp.brand_name_en, cp.logo, sa.scan_count,
                 DENSE_RANK() OVER (ORDER BY sa.scan_count DESC)::int AS rank
          FROM scan_agg sa
          JOIN companies_placement cp ON cp.id = sa.company_id AND cp.event_id = $1
          ORDER BY sa.scan_count DESC, cp.id ASC
          LIMIT $2
        `, [currentEventId, limit]);

        leaderboard = topRows.map(row => ({
          rank:           row.rank,
          company_id:     row.id,
          brand_name_fa:  row.brand_name_fa,
          brand_name_en:  row.brand_name_en || null,
          logo:           row.logo,
          scan_count:     row.scan_count,
        }));
      }

      return NextResponse.json({ leaderboard, currentUser: null });
    }

    // ── LEVEL SUB-LEADERBOARD ──────────────────────────────────────────────
    if (levelId && Number.isFinite(levelId)) {
      const { rows: levelRows } = await query(
        `SELECT min_xp, max_xp, leaderboard_limit FROM quest_levels WHERE id = $1 AND is_active = true AND event_id = $2`,
        [levelId, currentEventId]
      );
      if (levelRows.length === 0) {
        return NextResponse.json({ leaderboard: [], currentUser: null });
      }

      const { min_xp, max_xp, leaderboard_limit } = levelRows[0];
      const limit = (Number.isFinite(leaderboard_limit) && leaderboard_limit >= 1) ? leaderboard_limit : 20;
      const maxXpFilter = max_xp !== null && max_xp !== undefined;

      let leaderboard = [];
      if (!rankOnly) {
        // event_id is always $1 (bound by XP_CTE itself); every param below is
        // shifted +1 to make room for it.
        const { rows: topRows } = await query(`
          ${XP_CTE},
          in_level AS (
            -- app_users is joined + filtered HERE, before RANK() is computed,
            -- so an excluded user is removed from the ranking pool entirely
            -- (the remaining rows get clean, gap-free sequential ranks) rather
            -- than just hidden from the output after ranks were assigned.
            SELECT c.user_uuid, c.total_xp, c.scan_count
            FROM combined c
            LEFT JOIN app_users au ON c.user_uuid = au.uuid AND au.event_id = $1
            WHERE c.total_xp >= $2
              ${maxXpFilter ? 'AND c.total_xp < $3' : ''}
              AND (au.excluded_from_leaderboard IS NOT TRUE)
          ),
          ranked AS (
            -- DENSE_RANK(), not RANK(): a tied trio at the top gets rank 1,
            -- and the next distinct (lower) score gets rank 2, not 4. Must
            -- stay consistent with the scalar COUNT(DISTINCT ...) formula
            -- used by this level's currentUser query below, and with the
            -- overall branch's own array + currentUser queries -- mixing
            -- RANK() and DENSE_RANK() across these four locations would
            -- reintroduce exactly the kind of array-vs-chip mismatch fixed
            -- in the last two rounds.
            SELECT user_uuid, total_xp, scan_count,
                   DENSE_RANK() OVER (ORDER BY total_xp DESC)::int AS rank
            FROM in_level
          )
          SELECT
            r.user_uuid, r.total_xp, r.scan_count, r.rank,
            COALESCE(
              NULLIF(TRIM(COALESCE(au.firstname_fa, '') || ' ' || COALESCE(au.lastname_fa, '')), ''),
              qn.display_name_fa,
              'شرکت‌کننده'
            ) AS display_name_fa,
            COALESCE(
              NULLIF(TRIM(COALESCE(au.firstname_en, '') || ' ' || COALESCE(au.lastname_en, '')), ''),
              qn.display_name_en
            ) AS display_name_en,
            qn.profile_photo_url,
            au.profile_image,
            au.hide_leaderboard_photo,
            au.occupation_id${referralCountSelectFragment('r', referralLeaderboardActive)}
          FROM ranked r
          LEFT JOIN quest_user_names qn ON r.user_uuid = qn.user_uuid
          LEFT JOIN app_users        au ON r.user_uuid = au.uuid AND au.event_id = $1
          ORDER BY r.rank
          LIMIT $${maxXpFilter ? '4' : '3'}
        `, maxXpFilter ? [currentEventId, min_xp, max_xp, limit] : [currentEventId, min_xp, limit]);

        leaderboard = topRows.map(row => ({
          rank:              row.rank,
          user_uuid:         row.user_uuid,
          display_name_fa:   row.display_name_fa,
          display_name_en:   row.display_name_en || null,
          total_xp:          row.total_xp,
          scan_count:        row.scan_count,
          profile_photo_url: resolvePhotoUrl(row.profile_photo_url, row.profile_image, row.hide_leaderboard_photo),
          referral_count:    row.referral_count,
          occupation_id:     row.occupation_id,
        }));
      }

      // Current user's rank within this level
      let currentUser = null;
      if (currentUuid) {
        // `in_level` here is intentionally the RAW XP-bucket pool (no
        // exclusion filter) so the viewer's own row is always found even if
        // THEY are excluded -- rank itself is instead computed as a scalar
        // "how many non-excluded users in this level strictly outrank me"
        // subquery, which both (a) excludes excluded users from counting
        // toward anyone's rank and (b) still resolves for an excluded
        // viewer (whose numeric result gets nulled below regardless).
        const { rows: rankRows } = await query(`
          ${XP_CTE},
          in_level AS (
            SELECT user_uuid, total_xp
            FROM combined
            WHERE total_xp >= $2
              ${maxXpFilter ? 'AND total_xp < $3' : ''}
          )
          SELECT
            il.total_xp,
            COALESCE(
              NULLIF(TRIM(COALESCE(au.firstname_fa, '') || ' ' || COALESCE(au.lastname_fa, '')), ''),
              qn.display_name_fa,
              'شرکت‌کننده'
            ) AS display_name_fa,
            COALESCE(
              NULLIF(TRIM(COALESCE(au.firstname_en, '') || ' ' || COALESCE(au.lastname_en, '')), ''),
              qn.display_name_en
            ) AS display_name_en,
            qn.profile_photo_url, au.profile_image, au.hide_leaderboard_photo,
            au.excluded_from_leaderboard, au.occupation_id,
            (
              -- DENSE_RANK() equivalent: 1 + count of DISTINCT higher scores
              -- among non-excluded users (not COUNT(*), which would replicate
              -- RANK()'s skip-ahead-by-tie-size behavior instead).
              SELECT COUNT(DISTINCT il2.total_xp)::int + 1
              FROM in_level il2
              LEFT JOIN app_users au2 ON il2.user_uuid = au2.uuid AND au2.event_id = $1
              WHERE (au2.excluded_from_leaderboard IS NOT TRUE)
                AND il2.total_xp > il.total_xp
            ) AS rank${referralCountSelectFragment('il', referralLeaderboardActive)}
          FROM in_level il
          LEFT JOIN quest_user_names qn ON il.user_uuid = qn.user_uuid
          LEFT JOIN app_users        au ON il.user_uuid = au.uuid AND au.event_id = $1
          WHERE il.user_uuid = $${maxXpFilter ? '4' : '3'}
        `, maxXpFilter ? [currentEventId, min_xp, max_xp, currentUuid] : [currentEventId, min_xp, currentUuid]);

        if (rankRows.length > 0) {
          currentUser = {
            user_uuid:         currentUuid,
            // The ranking pool itself is intentionally NOT filtered here (an
            // excluded viewer must still see their own accurate score/progress
            // on their own screen) -- but the numeric rank is meaningless for
            // someone structurally outside the competition, so it's nulled
            // rather than shown. The frontend renders a null rank as "-".
            rank:              rankRows[0].excluded_from_leaderboard ? null : rankRows[0].rank,
            total_xp:          rankRows[0].total_xp,
            display_name_fa:   rankRows[0].display_name_fa,
            display_name_en:   rankRows[0].display_name_en || null,
            profile_photo_url: resolvePhotoUrl(rankRows[0].profile_photo_url, rankRows[0].profile_image, rankRows[0].hide_leaderboard_photo),
            referral_count:    rankRows[0].referral_count,
            occupation_id:     rankRows[0].occupation_id,
          };
        }
      }

      return NextResponse.json(await addOccupationLabels(leaderboard, currentUser, currentEventId === 1));
    }

    // ── OVERALL LEADERBOARD (original behavior) ────────────────────────────
    let leaderboard = [];
    if (!rankOnly) {
      const limit = await getLeaderboardLimit(currentEventId);

      // rank is a real DENSE_RANK() OVER (...), not the row's sequential
      // position (idx+1) -- tied total_xp values must produce the SAME rank
      // number, matching both the level branch's array (which also uses
      // DENSE_RANK()) and this same request's own currentUser.rank (a scalar
      // equivalent of DENSE_RANK() over the identical filtered pool, see
      // below). With no secondary ORDER BY key, Postgres has no defined
      // order among tied rows, so a previous idx+1-based rank silently
      // changed on every request for whichever tied user happened to land
      // in which array slot -- c.user_uuid is added purely to make that slot
      // ordering stable across requests; it never affects the rank NUMBER
      // itself. DENSE_RANK() (not RANK()) is used per product decision: a
      // tied trio at the top gets rank 1 and the next distinct score gets
      // rank 2, without skipping ahead by the tie's size.
      const { rows: leaderboardRows } = await query(`
        ${XP_CTE}
        SELECT
          c.user_uuid,
          COALESCE(
            NULLIF(TRIM(COALESCE(au.firstname_fa, '') || ' ' || COALESCE(au.lastname_fa, '')), ''),
            qn.display_name_fa,
            'شرکت‌کننده'
          ) AS display_name_fa,
          COALESCE(
            NULLIF(TRIM(COALESCE(au.firstname_en, '') || ' ' || COALESCE(au.lastname_en, '')), ''),
            qn.display_name_en
          ) AS display_name_en,
          qn.profile_photo_url,
          au.profile_image,
          au.hide_leaderboard_photo,
          au.occupation_id,
          c.total_xp,
          c.scan_count,
          -- DENSE_RANK(), not RANK() -- see the level branch's matching
          -- comment above for why all four rank locations in this file must
          -- agree on the same ranking scheme.
          DENSE_RANK() OVER (ORDER BY c.total_xp DESC)::int AS rank${referralCountSelectFragment('c', referralLeaderboardActive)}
        FROM combined c
        LEFT JOIN quest_user_names qn ON c.user_uuid = qn.user_uuid
        LEFT JOIN app_users        au ON c.user_uuid = au.uuid AND au.event_id = $1
        WHERE (au.excluded_from_leaderboard IS NOT TRUE)
        ORDER BY c.total_xp DESC, c.user_uuid ASC
        LIMIT $2
      `, [currentEventId, limit]);

      leaderboard = leaderboardRows.map(row => ({
        rank:              row.rank,
        user_uuid:         row.user_uuid,
        display_name_fa:   row.display_name_fa,
        display_name_en:   row.display_name_en || null,
        total_xp:          row.total_xp,
        scan_count:        row.scan_count,
        profile_photo_url: resolvePhotoUrl(row.profile_photo_url, row.profile_image, row.hide_leaderboard_photo),
        referral_count:    row.referral_count,
        occupation_id:     row.occupation_id,
      }));
    }

    // Current user's overall rank (may be outside top-N)
    let currentUser = null;
    if (currentUuid) {
      // Same approach as the level branch above: `totals` is the RAW
      // per-user pool (no exclusion filter) so the viewer's own row is
      // always found even if THEY are excluded; rank is a scalar "how many
      // non-excluded users strictly outrank me" subquery, so excluded users
      // never consume a rank position for anyone (including themselves --
      // their own numeric result is nulled below regardless).
      const { rows: rankRows } = await query(`
        WITH combined AS (
          SELECT user_uuid, xp_earned AS xp FROM quest_scans WHERE event_id = $1
          UNION ALL
          SELECT user_uuid, xp_amount AS xp FROM quest_xp_grants WHERE event_id = $1
        ),
        totals AS (
          SELECT user_uuid, SUM(xp)::int AS total_xp
          FROM combined
          GROUP BY user_uuid
        )
        SELECT
          t.total_xp, qn.profile_photo_url, au.profile_image, au.hide_leaderboard_photo,
          au.excluded_from_leaderboard, au.occupation_id,
          (
            -- DENSE_RANK() equivalent -- see the level branch's matching
            -- comment above.
            SELECT COUNT(DISTINCT t2.total_xp)::int + 1
            FROM totals t2
            LEFT JOIN app_users au2 ON t2.user_uuid = au2.uuid AND au2.event_id = $1
            WHERE (au2.excluded_from_leaderboard IS NOT TRUE)
              AND t2.total_xp > t.total_xp
          ) AS rank${referralCountSelectFragment('t', referralLeaderboardActive)}
        FROM totals t
        LEFT JOIN quest_user_names qn ON t.user_uuid = qn.user_uuid
        LEFT JOIN app_users        au ON t.user_uuid = au.uuid AND au.event_id = $1
        WHERE t.user_uuid = $2
      `, [currentEventId, currentUuid]);

      if (rankRows.length > 0) {
        currentUser = {
          user_uuid:         currentUuid,
          // See the level-leaderboard branch above for why this is nulled
          // rather than filtered out of the ranking computation itself.
          rank:              rankRows[0].excluded_from_leaderboard ? null : rankRows[0].rank,
          total_xp:          rankRows[0].total_xp,
          profile_photo_url: resolvePhotoUrl(rankRows[0].profile_photo_url, rankRows[0].profile_image, rankRows[0].hide_leaderboard_photo),
          referral_count:    rankRows[0].referral_count,
          occupation_id:     rankRows[0].occupation_id,
        };
      }
    }

    return NextResponse.json(await addOccupationLabels(leaderboard, currentUser, currentEventId === 1));
  } catch (err) {
    console.error('[quest/leaderboard]', err.message);
    return NextResponse.json({ leaderboard: [], currentUser: null });
  }
}
