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
  async () => {
    let settings = BADGE_DEFAULTS;
    try {
      const result = await query("SELECT value FROM app_settings WHERE key = 'badge_page'");
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
