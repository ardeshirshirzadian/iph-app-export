import assert from 'node:assert/strict';
import { isLatestAdminCorrection } from '../lib/userDisplayNameLogic.js';

const corrected = {
  firstname_fa: 'رضا',
  lastname_fa: 'رضایی',
  firstname_en: 'Reza',
  lastname_en: 'Rezaei',
};

// An APN correction remains the local display override only while the
// current event's app_users values match the immutable latest audit values.
assert.equal(isLatestAdminCorrection({ ...corrected }, corrected), true);
assert.equal(isLatestAdminCorrection({ ...corrected, firstname_en: 'Reza A' }, corrected), false);
assert.equal(isLatestAdminCorrection({ ...corrected, lastname_fa: null }, { ...corrected, lastname_fa: '' }), true);
assert.equal(isLatestAdminCorrection(corrected, null), false);
assert.equal(isLatestAdminCorrection(null, corrected), false);

console.log('PASS user display-name correction decision tests');
