import { unstable_cache } from 'next/cache';
import { query } from '@/lib/db';

// Admin-editable-only (iph-apn PUT /api/admin/profile-support-link) --
// tag-based on-demand revalidation via app/api/internal/revalidate, 300s
// fallback. Same {icon, icon_size, color_dark, color_light, target_url}
// shape as badge_header_icon_config (see lib/badgePageCache.js) so the
// admin-side upload/SVG-color UI (components/HeaderIconEditor) is reusable
// verbatim, plus label_fa/label_en/label_size for this button's own visible
// text -- badge's header button has no text, this one does.
//
// target_url defaults empty, which is the "not configured yet" state --
// ProfileClient treats an empty target_url as "don't render the section"
// rather than a dead button (unlike badge's header button, the icon here
// always has a real default and never gates visibility on its own).
export const PROFILE_SUPPORT_LINK_DEFAULTS = {
  icon: '💬',
  icon_size: 20,
  color_dark: null,
  color_light: null,
  target_url: '',
  label_fa: 'پشتیبانی',
  label_en: 'Support',
  label_size: 14,
};

export const getCachedProfileSupportLinkConfig = unstable_cache(
  async (eventId) => {
    let config = PROFILE_SUPPORT_LINK_DEFAULTS;
    try {
      const result = await query(
        "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'profile_support_link_config'",
        [eventId]
      );
      if (result.rows[0]?.value) {
        config = { ...PROFILE_SUPPORT_LINK_DEFAULTS, ...result.rows[0].value };
      }
    } catch {
      // fall back to defaults
    }
    return config;
  },
  ['profile-support-link-config'],
  { tags: ['profile-support-link-config'], revalidate: 300 }
);
