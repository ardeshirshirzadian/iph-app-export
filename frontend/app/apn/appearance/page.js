import AdminPageHeader from '@/components/AdminPageHeader';
import AppearanceClient from './AppearanceClient';
import { query } from '@/lib/db';
import { BUTTON_DEFAULTS } from '@/lib/getButtonStyles';

export const dynamic = 'force-dynamic';

export default async function AppearancePage() {
  let savedConfig = {};
  try {
    const result = await query(
      "SELECT value FROM app_settings WHERE key = 'button_styles_config'"
    );
    savedConfig = result.rows[0]?.value ?? {};
  } catch { /* fall back to defaults */ }

  const config = {
    dark:  { ...BUTTON_DEFAULTS.dark },
    light: { ...BUTTON_DEFAULTS.light },
  };
  for (const theme of ['dark', 'light']) {
    for (const v of ['primary', 'secondary', 'danger', 'ghost', 'icon']) {
      config[theme][v] = { ...BUTTON_DEFAULTS[theme][v], ...(savedConfig?.[theme]?.[v] ?? {}) };
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <AdminPageHeader
        title="تنظیمات ظاهری — دکمه‌ها"
        subtitle="رنگ، متن و سایز هر دسته از دکمه‌های اپ را برای تم تاریک و روشن به‌طور مستقل تنظیم کنید"
        backHref="/apn"
      />
      <AppearanceClient initialConfig={config} />
    </div>
  );
}
