// Ported (copied, not imported -- iph-app and iph-apn are separate repos
// with no shared import path) from iph-apn's lib/referralShareFields.js.
// Only the STATIC_FIELD sentinel is actually needed here: the real
// end-user resolver (see QuestClient.js's ReferralModal) is a plain object
// literal keyed by the same field names iph-apn's editor writes into each
// element's `field` -- there's no admin-facing label/sample text to carry
// over on this side.
export const STATIC_FIELD = '__static__';
