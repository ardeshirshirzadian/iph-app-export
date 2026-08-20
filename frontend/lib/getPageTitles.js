import 'server-only';
import { query } from './db';
import { getCurrentEventId } from './currentEvent';

const DEFAULTS = {
  settings:      { title: 'تنظیمات',              subtitle: '' },
  quest:         { title: 'Booth Quest',            subtitle: 'امتیاز جمع کن و جوایز ببر' },
  notifications: { title: 'اعلان‌ها',              subtitle: '' },
  badge:         { title: 'کارت بازدیدکننده',      subtitle: '' },
  profile:       { title: 'پروفایل من',            subtitle: '' },
  chat:          { title: 'دستیار هوش مصنوعی',     subtitle: 'چطور می‌تونم کمکتون کنم؟' },
  companies:     { title: 'شرکت‌های نمایشگاه',     subtitle: 'دهمین نمایشگاه ایران فارما ۱۴۰۴' },
  panels:        { title: 'پنل‌ها و کارگاه‌ها',    subtitle: 'دهمین نمایشگاه ایران فارما ۱۴۰۴' },
  news:          { title: 'اخبار',                  subtitle: 'آخرین اخبار نمایشگاه ایران‌فارما', title_en: 'News', subtitle_en: 'Latest IranPharma Exhibition News' },
  gallery:       { title: 'گالری تصاویر',           subtitle: 'عکس‌های نمایشگاه‌های برگزار شده', title_en: 'Photo Gallery', subtitle_en: 'IranPharma Exhibition Photos' },
  map:           { title: 'نقشه نمایشگاه',          subtitle: 'مکان‌یابی غرفه‌ها و سالن‌ها', title_en: 'Exhibition Map', subtitle_en: 'Locate halls and booths' },
};

// eventId: pass explicitly from inside an unstable_cache-wrapped call site
// (see lib/questPageCache.js, lib/pageTitleCache.js) -- see
// lib/getActiveFont.js for why.
export async function getPageTitle(pageKey, eventId) {
  try {
    eventId = eventId ?? await getCurrentEventId();
    const result = await query(
      "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'page_titles'",
      [eventId]
    );
    const stored = result.rows[0]?.value ?? {};
    const def = DEFAULTS[pageKey] ?? { title: '', subtitle: '' };
    return { ...def, ...(stored[pageKey] ?? {}) };
  } catch {
    return DEFAULTS[pageKey] ?? { title: '', subtitle: '' };
  }
}
