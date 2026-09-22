import assert from 'node:assert/strict';
import { getInactiveMissionState, recordMissionHistory } from '../lib/questMissionHistory.js';

const missionTypes = [
  'booth_scan', 'special_booth', 'chat', 'profile_photo', 'attendance', 'manual',
  'hall_scan', 'quiz', 'featured_booth', 'survey', 'social_share', 'referral_code',
];

// A/B/C/G: all types use the same event-scoped durable snapshot policy.
for (const mission_type of missionTypes) {
  const mission = { id: 44, mission_type, total: 3 };
  assert.deepEqual(getInactiveMissionState(mission, null), {
    visible: false, completed: false, progress: 0, status: null,
  }, `${mission_type}: no history stays hidden`);
  assert.deepEqual(getInactiveMissionState(mission, { status: 'participated' }), {
    visible: true, completed: true, progress: 0, status: 'participated',
  }, `${mission_type}: partial history belongs in Done and cannot change from later activity`);
  assert.deepEqual(getInactiveMissionState(mission, { status: 'completed' }), {
    visible: true, completed: true, progress: 3, status: 'completed',
  }, `${mission_type}: completed history stays Done`);
}

// D/E: pending and rejected social history belongs in Done while retaining status.
for (const status of ['pending', 'rejected']) {
  const result = getInactiveMissionState({ id: 8, mission_type: 'social_share', total: 1 }, { status });
  assert.equal(result.visible, true);
  assert.equal(result.completed, true);
  assert.equal(result.status, status);
}

// C: unlimited referral has no dynamic completion threshold, but durable
// participation still displays after disable.
const unlimited = getInactiveMissionState({ id: 10, mission_type: 'referral_code', total: 1 }, { status: 'participated' });
assert.equal(unlimited.visible, true);
assert.equal(unlimited.completed, true);

// G: the lookup key is event_id + mission_id + user_uuid in SQL; different
// event histories are intentionally never provided to this event's map.
assert.equal(getInactiveMissionState({ id: 44, total: 1 }, null).visible, false);

// H/I: history uses the event-scoped composite key and never writes a scan or
// grant table, so it cannot recalculate or deduct XP.
const calls = [];
await recordMissionHistory(async (sql, params) => calls.push({ sql, params }), {
  eventId: 1, missionId: 44, userUuid: 'same-uuid', status: 'completed', evidenceType: 'scan', evidenceId: 9,
});
assert.equal(calls.length, 1);
assert.match(calls[0].sql, /ON CONFLICT \(event_id, mission_id, user_uuid\)/);
assert.doesNotMatch(calls[0].sql, /quest_(?:xp_grants|scans)/);
assert.deepEqual(calls[0].params.slice(0, 3), [1, 44, 'same-uuid']);

console.log('PASS durable inactive mission-history policy tests');
