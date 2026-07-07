import 'server-only';
import { query } from './db';

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
};

export async function getPageTitle(pageKey) {
  try {
    const result = await query(
      "SELECT value FROM app_settings WHERE key = 'page_titles'"
    );
    const stored = result.rows[0]?.value ?? {};
    const def = DEFAULTS[pageKey] ?? { title: '', subtitle: '' };
    return { ...def, ...(stored[pageKey] ?? {}) };
  } catch {
    return DEFAULTS[pageKey] ?? { title: '', subtitle: '' };
  }
}
