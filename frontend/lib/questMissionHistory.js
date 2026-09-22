// Durable per-event mission state. This intentionally never touches XP tables:
// XP remains owned by quest_scans and quest_xp_grants.
export async function recordMissionHistory(dbQuery, {
  eventId, missionId, userUuid, status, evidenceType, evidenceId = null,
}) {
  if (!missionId || !userUuid) return false;
  try {
    await dbQuery(
      `INSERT INTO quest_mission_history
         (event_id, mission_id, user_uuid, status, evidence_type, evidence_id, participated_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), CASE WHEN $4 = 'completed' THEN NOW() ELSE NULL END)
       ON CONFLICT (event_id, mission_id, user_uuid) DO UPDATE
         SET status = CASE
               WHEN quest_mission_history.status = 'completed' THEN 'completed'
               WHEN EXCLUDED.status = 'completed' THEN 'completed'
               WHEN EXCLUDED.status = 'rejected' THEN 'rejected'
               WHEN EXCLUDED.status = 'pending' THEN 'pending'
               ELSE quest_mission_history.status
             END,
             evidence_type = EXCLUDED.evidence_type,
             evidence_id = COALESCE(EXCLUDED.evidence_id, quest_mission_history.evidence_id),
             completed_at = CASE WHEN EXCLUDED.status = 'completed'
               THEN COALESCE(quest_mission_history.completed_at, NOW())
               ELSE quest_mission_history.completed_at END,
             updated_at = NOW()`,
      [eventId, missionId, userUuid, status, evidenceType, evidenceId == null ? null : String(evidenceId)]
    );
    return true;
  } catch (error) {
    // The migration is deliberately separate. Do not let a missing table or
    // history-write outage alter the pre-existing activity/XP transaction.
    console.error('[questMissionHistory]', error.message);
    return false;
  }
}

// Read policy is intentionally tiny and pure so every inactive mission type
// follows the same durable rule: history controls visibility, never live
// counts. Every inactive history row belongs in the Done/history section;
// `status` preserves whether it was partial, pending, rejected, or complete.
export function getInactiveMissionState(mission, history) {
  if (!history) return { visible: false, completed: false, progress: 0, status: null };
  return {
    visible: true,
    completed: true,
    // Keep partial progress frozen rather than presenting it as completed.
    progress: history.status === 'completed' ? mission.total : 0,
    status: history.status,
  };
}
