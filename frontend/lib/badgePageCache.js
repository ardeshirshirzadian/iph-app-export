import { unstable_cache } from 'next/cache';
import { query } from '@/lib/db';

export const BADGE_DEFAULTS = {
  title_fa: 'کارت بازدیدکننده',
  title_en: 'Visitor Badge',
  subtitle_fa: 'اطلاعات شما در نمایشگاه',
  subtitle_en: 'Your Exhibition Information',
  event_name_fa: 'یازدهمین نمایشگاه ایران فارما ۱۴۰۵',
  event_name_en: '11th IranPharma Exhibition 2025',
  logo_icon_type: 'image',
  logo_icon_value: '/logo/logo-l.png',
  logo_icon_size: 64,
};

// Admin-editable-only (iph-apn PUT /api/admin/badge) -- tag-based on-demand
// revalidation via app/api/internal/revalidate, 300s fallback. Same pattern
// as app/settings/page.js.
//
// This is the SINGLE cached data-fetching path for badge_page config,
// consumed by BOTH app/badge/page.js (the dedicated /badge route) and
// app/page.js's "/badge" home variant, so there is exactly one cache entry
// regardless of which route triggered the read.
export const getCachedBadgePageConfig = unstable_cache(
  async (eventId) => {
    let settings = BADGE_DEFAULTS;
    try {
      const result = await query(
        "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'badge_page'",
        [eventId]
      );
      if (result.rows[0]?.value) {
        settings = { ...BADGE_DEFAULTS, ...result.rows[0].value };
      }
    } catch {
      // fall back to defaults
    }
    return settings;
  },
  ['badge-page-config'],
  { tags: ['badge-page-config'], revalidate: 300 }
);

// Separate app_settings key from badge_page above (own admin save action,
// own revalidation tag) -- same split as map_header_icons_config being
// independent of the rest of the map page's settings. icon/target_url both
// default empty, which is the "button not configured yet" state -- the
// renderer (BadgeClient) treats an empty icon or target_url as "don't show
// the button" rather than rendering a dead/blank control.
export const BADGE_HEADER_ICON_DEFAULTS = {
  icon: '',
  icon_size: 20,
  color_dark: null,
  color_light: null,
  target_url: '',
  visibility: 'both',
};

export const getCachedBadgeHeaderIconConfig = unstable_cache(
  async (eventId) => {
    let config = BADGE_HEADER_ICON_DEFAULTS;
    try {
      const result = await query(
        "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'badge_header_icon_config'",
        [eventId]
      );
      if (result.rows[0]?.value) {
        config = { ...BADGE_HEADER_ICON_DEFAULTS, ...result.rows[0].value };
      }
    } catch {
      // fall back to defaults
    }
    return config;
  },
  ['badge-header-icon-config'],
  { tags: ['badge-header-icon-config'], revalidate: 300 }
);
