// Canonical referral-reward service shared by the attendee app and APN.
// `dbQuery` accepts lib/db's query function or a transaction client's query
// method, so APN can keep a manual assignment atomic without duplicating XP
// rules.

async function recordReferralHistory(dbQuery, eventId, missionId, userUuid, status, redemptionId) {
  if (!missionId || !userUuid) return;
  await dbQuery(
    `INSERT INTO quest_mission_history
       (event_id, mission_id, user_uuid, status, evidence_type, evidence_id, participated_at, completed_at)
     VALUES ($1, $2, $3, $4, 'referral_redemption', $5, NOW(), CASE WHEN $4 = 'completed' THEN NOW() ELSE NULL END)
     ON CONFLICT (event_id, mission_id, user_uuid) DO UPDATE
       SET status = CASE WHEN EXCLUDED.status = 'completed' THEN 'completed' ELSE quest_mission_history.status END,
           evidence_id = COALESCE(EXCLUDED.evidence_id, quest_mission_history.evidence_id),
           completed_at = CASE WHEN EXCLUDED.status = 'completed' THEN COALESCE(quest_mission_history.completed_at, NOW()) ELSE quest_mission_history.completed_at END,
           updated_at = NOW()`,
    [eventId, missionId, userUuid, status, redemptionId == null ? null : String(redemptionId)]
  ).catch((error) => console.error('[referral history]', error.message));
}

// Used when an active referral starts but its enrollment check is deferred.
// All active referral cards get the same durable pending snapshot; no XP is
// created here, and later disable cannot create a new pending history row.
export async function recordPendingReferralHistory(dbQuery, referrerUuid, eventId, redemptionId) {
  const { rows } = await dbQuery(
    `SELECT id FROM quest_content
     WHERE event_id = $1 AND mission_type = 'referral_code' AND is_active = true`,
    [eventId]
  );
  for (const mission of rows) {
    await recordReferralHistory(dbQuery, eventId, mission.id, referrerUuid, 'pending', redemptionId);
  }
}

export async function getReferralRefereeXp(dbQuery, eventId) {
  const { rows } = await dbQuery(
    `SELECT referral_referee_xp FROM quest_content
     WHERE event_id = $1 AND mission_type = 'referral_code' AND is_active = true
     ORDER BY referral_required_count ASC NULLS LAST LIMIT 1`,
    [eventId]
  );
  return rows[0]?.referral_referee_xp || 0;
}

export async function grantReferralRefereeXp(dbQuery, refereeUuid, eventId, redemptionId, refereeXp) {
  if (refereeXp <= 0) return;
  await dbQuery(
    `INSERT INTO quest_xp_grants (user_uuid, source_type, source_id, xp_amount, event_id)
     VALUES ($1, 'referral_referee', $2, $3, $4)
     ON CONFLICT (user_uuid, source_type, source_id) DO NOTHING`,
    [refereeUuid, redemptionId, refereeXp, eventId]
  );
}

export async function evaluateReferralTiers(dbQuery, referrerUuid, eventId) {
  const { rows: countRows } = await dbQuery(
    `SELECT COUNT(*) FROM quest_referral_redemptions
     WHERE referrer_user_uuid = $1 AND event_id = $2 AND status = 'confirmed'`,
    [referrerUuid, eventId]
  );
  const confirmedCount = parseInt(countRows[0].count, 10);
  const { rows: tiers } = await dbQuery(
    `SELECT id, referral_required_count, referral_referrer_xp
     FROM quest_content
     WHERE event_id = $1 AND mission_type = 'referral_code' AND is_active = true
       AND referral_required_count IS NOT NULL
       AND (referral_is_unlimited = false OR referral_is_unlimited IS NULL)
     ORDER BY referral_required_count ASC`,
    [eventId]
  );
  for (const tier of tiers) {
    if (tier.referral_required_count > confirmedCount) continue;
    const { rowCount } = await dbQuery(
      `INSERT INTO quest_xp_grants (user_uuid, source_type, source_id, xp_amount, event_id)
       VALUES ($1, 'referral_referrer_tier', $2, $3, $4)
       ON CONFLICT (user_uuid, source_type, source_id) DO NOTHING`,
      [referrerUuid, tier.id, tier.referral_referrer_xp || 0, eventId]
    );
    if (rowCount > 0) {
      await dbQuery(
        `INSERT INTO quest_user_progress (mission_id, user_uuid, completed, completed_at)
         VALUES ($1, $2, true, NOW())
         ON CONFLICT (mission_id, user_uuid) DO UPDATE SET completed = true, completed_at = NOW()`,
        [tier.id, referrerUuid]
      );
    }
    await recordReferralHistory(dbQuery, eventId, tier.id, referrerUuid, 'completed', null);
  }
}

export async function grantUnlimitedReferralXp(dbQuery, referrerUuid, eventId, redemptionId) {
  const { rows } = await dbQuery(
    `SELECT id, referral_per_invite_xp FROM quest_content
     WHERE event_id = $1 AND mission_type = 'referral_code' AND is_active = true
       AND referral_is_unlimited = true
     LIMIT 1`,
    [eventId]
  );
  if (rows.length === 0) return;
  const missionId = rows[0].id;
  const perInviteXp = rows[0].referral_per_invite_xp || 0;
  if (perInviteXp > 0) await dbQuery(
    `INSERT INTO quest_xp_grants (user_uuid, source_type, source_id, xp_amount, event_id)
     VALUES ($1, 'referral_referrer_unlimited', $2, $3, $4)
     ON CONFLICT (user_uuid, source_type, source_id) DO NOTHING`,
    [referrerUuid, redemptionId, perInviteXp, eventId]
  );
  await recordReferralHistory(dbQuery, eventId, missionId, referrerUuid, 'participated', redemptionId);
}

// Call this after a redemption becomes confirmed. Its redemption-id grant
// keys make retries safe and prevent duplicate referee/unlimited XP.
export async function awardConfirmedReferralXp(
  dbQuery,
  { refereeUuid, referrerUuid, eventId, redemptionId, refereeXp }
) {
  await grantReferralRefereeXp(dbQuery, refereeUuid, eventId, redemptionId, refereeXp);
  await evaluateReferralTiers(dbQuery, referrerUuid, eventId);
  await grantUnlimitedReferralXp(dbQuery, referrerUuid, eventId, redemptionId);
}
