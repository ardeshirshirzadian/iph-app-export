const NAME_FIELDS = [
  'firstname_fa',
  'lastname_fa',
  'firstname_en',
  'lastname_en',
];

// A correction is active only while app_users still holds exactly the values
// recorded by the latest immutable correction audit. A later attendee edit
// therefore wins without changing the audit record.
export function isLatestAdminCorrection(currentNames, latestCorrection) {
  if (!currentNames || !latestCorrection) return false;
  return NAME_FIELDS.every(
    (field) => (currentNames[field] ?? '') === (latestCorrection[field] ?? '')
  );
}
