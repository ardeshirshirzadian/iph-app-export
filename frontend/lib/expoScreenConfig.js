import { query } from '@/lib/db';

// Single JSON-blob-in-app_settings pattern, same shape as
// referral_share_template_config / plaque templates -- one row per event
// under this key. Defaults match Phase 0's original hardcoded content
// exactly, so an event with no saved config renders identically to before
// this admin editor existed (inert by default).
export const EXPO_SCREEN_CONFIG_KEY = 'expo_screen_config';

// Must match iph-apn's app/api/admin/quest-expo-screen-config/route.js
// DEFAULT_CONFIG exactly -- two repos, no shared import path, same
// manual-sync convention already used for ReferralShareCanvas.jsx.
export const DEFAULT_EXPO_SCREEN_CONFIG = {
  slogan_fa: 'اسکن کن و جایزه ببر',
  slogan_en: '',
  show_leaderboard: true,
  show_qr: true,
  show_slogan: true,
  poll_interval_seconds: 8,
  orientation: 'vertical',
};

// Shared with the client poller as a defensive floor -- the admin-side PUT
// already enforces this, this is a second, independent guard in case a
// stale/hand-edited row ever holds something lower.
export const MIN_POLL_INTERVAL_SECONDS = 5;

// Plain per-request DB read, no unstable_cache wrapper here -- callers that
// need caching (app/api/expo/screen/route.js) wrap this themselves; the one
// other caller (app/expo/page.js) is already force-dynamic per-request, so
// wrapping here too would just be a second, redundant cache layer.
export async function getExpoScreenConfig(eventId) {
  try {
    const { rows } = await query(
      "SELECT value FROM app_settings WHERE event_id = $1 AND key = $2",
      [eventId, EXPO_SCREEN_CONFIG_KEY]
    );
    return { ...DEFAULT_EXPO_SCREEN_CONFIG, ...(rows[0]?.value || {}) };
  } catch {
    return DEFAULT_EXPO_SCREEN_CONFIG;
  }
}
