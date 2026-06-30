import 'server-only';
import { query } from './db';

const DEFAULT = {
  enabled: true,
  icon_type: 'emoji',
  icon_value: '🔔',
  icon_size: 32,
  title: 'فعال‌سازی اعلان‌ها',
  description: 'با فعال‌سازی، اطلاعیه‌های مهم نمایشگاه را حتی در پس‌زمینه دریافت کنید.',
  confirm_button: 'فعال‌سازی',
  dismiss_button: 'بعداً',
};

export async function getPushPrompt() {
  try {
    const { rows } = await query("SELECT value FROM app_settings WHERE key = 'push_prompt'");
    if (!rows[0]?.value) return DEFAULT;
    return { ...DEFAULT, ...rows[0].value };
  } catch {
    return DEFAULT;
  }
}
