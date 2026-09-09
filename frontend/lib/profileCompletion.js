// Shared source of truth for "which 6 fields count toward profile completion".
// Consumed by ProfileCompletionBar.jsx (the percentage bar on /profile and the
// home page) and EditProfileClient.jsx (themed highlighting of the still-empty
// inputs on /profile/edit). Keep the list and the tests here so the two never
// drift apart.

export const PROFILE_FIELDS = [
  { key: 'firstname_fa',        test: (a) => !!a.firstname_fa },
  { key: 'national_code',       test: (a) => !!a.national_code },
  { key: 'occupation_id',       test: (a) => !!a.occupation_id },
  { key: 'education_level_id',  test: (a) => !!a.education_level_id },
  { key: 'field_of_activities', test: (a) => Array.isArray(a.field_of_activities) && a.field_of_activities.length > 0 },
  { key: 'profile',             test: (a) => !!a.profile },
];

// Array of keys (from PROFILE_FIELDS) whose test fails for this attendee.
// Returns [] for a null/undefined attendee so callers can treat "unknown" as
// "nothing to highlight yet" rather than "everything is missing".
export function getMissingFields(attendee) {
  if (!attendee) return [];
  return PROFILE_FIELDS.filter((f) => !f.test(attendee)).map((f) => f.key);
}
