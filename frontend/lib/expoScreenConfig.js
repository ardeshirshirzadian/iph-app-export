import { query } from '@/lib/db';
import { getThemeColors } from '@/lib/getThemeColors';
import { getCachedQuestContentBlocks, parseQuestBlocks } from '@/lib/questPageCache';
import { DEFAULT_EXPO_TITLE_FONT_WEIGHT } from '@/lib/expoTitleFontWeight';

// Single JSON-blob-in-app_settings pattern, same shape as
// referral_share_template_config / plaque templates -- one row per event
// under this key. Defaults match a plain dark kiosk screen with no
// download-box logos/link configured yet, so an event with no saved config
// still renders the full fixed layout, just with empty logo slots.
export const EXPO_SCREEN_CONFIG_KEY = 'expo_screen_config';

// Must match iph-apn's app/api/admin/quest-expo-screen-config/route.js
// DEFAULT_CONFIG exactly -- two repos, no shared import path, same
// manual-sync convention already used for ReferralShareCanvas.jsx.
//
// Phase 2 replaced Phase 0/1's free-form content toggles (slogan/show_*/
// orientation) with ONE fixed layout -- see app/expo/ExpoClient.jsx. The
// admin-configurable surface is: poll rate, the two theme-derived colors
// (with manual hex overrides), the three download-box logos, the
// web-version address, the title text (free text -- NOT derived from
// app_identity/event name, per explicit product decision: an auto-derived
// title kept showing the event's English brand name, e.g. "IranPharma",
// wrong-language for this Persian kiosk screen), and a font size per text
// element.
export const DEFAULT_EXPO_SCREEN_CONFIG = {
  poll_interval_seconds: 8,
  theme_mode: 'dark', // 'dark' | 'light' -- which of the event's own theme_colors rows (and header_logo variant) to default from
  bg_color_hex: '', // '' = use theme_mode's `bg`
  row_bg_color_hex: '', // '' = use theme_mode's `surface`
  bazaar_logo_path: null,
  myket_logo_path: null,
  web_logo_path: null,
  web_link_url: '',
  download_label_1: 'دانلود از کافه بازار',
  download_label_2: 'دانلود از مایکت',
  download_label_3: 'نسخه وب اپلیکیشن',
  bottom_web_text: '', // empty = display the domain from web_link_url
  qr_fg_color_hex: '', // empty = dark #0b1220 modules
  qr_bg_color_hex: '', // empty = light #ffffff QR matrix and quiet zone
  qr_size: 180,
  leaderboard_people_count: 3,
  // Plain placeholder, deliberately NOT event-derived -- admin fills in the
  // real per-event text (e.g. "لیدربورد ایران فارما").
  title_text: 'لیدربورد',
  slogan_text: '',
  slogan_font_size: 34,
  title_font_size: 34,
  title_font_weight: DEFAULT_EXPO_TITLE_FONT_WEIGHT,
  name_font_size: 30,
  score_font_size: 28,
  box_label_font_size: 15,
  web_address_font_size: 15,
  // Empty keeps the theme's existing muted text color; a saved override is
  // always a validated hex color from APN.
  web_address_color: '',
};

// Shared with the client poller as a defensive floor -- the admin-side PUT
// already enforces this, this is a second, independent guard in case a
// stale/hand-edited row ever holds something lower.
export const MIN_POLL_INTERVAL_SECONDS = 5;

// Same static per-variant fallback shown until an admin uploads that
// variant -- components/Logo.jsx's STATIC_FALLBACKS, duplicated here (not
// imported: that file is a 'use client' component) since this kiosk needs
// the exact same fallback assets.
const LOGO_STATIC_FALLBACKS = {
  light_fa: { path: '/logo/logo-fa.png', width: 5310, height: 2134 },
  dark_fa: { path: '/logo/logo-l-fa.png', width: 4500, height: 1033 },
};

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

// Reuses the exact header_logo app_settings row app/api/header/route.js
// already serves for the header/Logo.jsx component -- no separate
// logo-storage mechanism for this feature. `_fa`: this kiosk has no
// language switcher (always Persian), matching Logo.jsx's own
// `${theme}_${lang}` convention. `themeMode` picks which of the two
// uploaded variants to show -- this screen's own theme_mode toggle, same
// as the bg/row colors it already drives, not the viewer's browser theme
// (there's no viewer to toggle it; this is an unattended kiosk).
async function getEventLogo(eventId, themeMode) {
  const variant = themeMode === 'light' ? 'light_fa' : 'dark_fa';
  try {
    const { rows } = await query(
      "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'header_logo'",
      [eventId]
    );
    return rows[0]?.value?.[variant] || LOGO_STATIC_FALLBACKS[variant];
  } catch {
    return LOGO_STATIC_FALLBACKS[variant];
  }
}

// Resolves a rank's medal icon to the SAME admin-configured icon the quest
// hub's own leaderboard uses (app/quest/QuestClient.js's rankIcons, sourced
// from quest_content_blocks' main.icon_rank_1/2/3) -- this kiosk screen
// must never invent its own icon set. Only the on-screen size differs (the
// kiosk renders much larger than the in-app leaderboard row), and the mask
// color is resolved once here (server-side, from theme_mode) instead of
// client-side from a live light/dark class -- this page has no interactive
// theme toggle, so there's nothing to react to at runtime.
function buildRankIcon(block, fallbackEmoji, mode, fallbackColor) {
  const b = (typeof block === 'object' && block) || {};
  return {
    icon: b.icon || fallbackEmoji,
    color: (mode === 'light' ? b.color_light : b.color_dark) || fallbackColor,
  };
}

// Composite, fully-resolved display data for the /expo kiosk page: the raw
// config plus everything derived from OTHER admin panels this feature
// reuses rather than re-implements -- the event's own theme_colors AND
// header_logo (Design System / theme toggle, both keyed off this feature's
// own theme_mode) and quest_content_blocks' rank-medal icons. Doing this
// resolution once, server-side, keeps ExpoClient.jsx a pure renderer with
// no theme/light-dark logic of its own.
export async function getExpoScreenDisplay(eventId) {
  const [config, themeColors, blocks] = await Promise.all([
    getExpoScreenConfig(eventId),
    getThemeColors(eventId),
    getCachedQuestContentBlocks(eventId),
  ]);

  const mode = config.theme_mode === 'light' ? 'light' : 'dark';
  const theme = themeColors[mode];
  const logo = await getEventLogo(eventId, mode);

  const colors = {
    bg: config.bg_color_hex?.trim() || theme.bg,
    rowBg: config.row_bg_color_hex?.trim() || theme.surface,
    text: theme.text,
    textMuted: theme['text-muted'],
    accent: theme.accent,
    border: theme.border,
  };

  const { main } = parseQuestBlocks(blocks);
  const rankIcons = {
    1: buildRankIcon(main.icon_rank_1, '🥇', mode, colors.text),
    2: buildRankIcon(main.icon_rank_2, '🥈', mode, colors.text),
    3: buildRankIcon(main.icon_rank_3, '🥉', mode, colors.text),
  };

  return { config, colors, logo, rankIcons };
}
