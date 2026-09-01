import 'server-only';
import { query } from './db';
import { getCurrentEventId } from './currentEvent';

const DEFAULT = {
  enabled: true,
  icon_type: 'emoji',
  icon_value: '🔔',
  icon_size: 32,
  title: 'فعال‌سازی اعلان‌ها',
  description: 'با فعال‌سازی، اطلاعیه‌های مهم نمایشگاه را حتی در پس‌زمینه دریافت کنید.',
  confirm_button: 'فعال‌سازی',
  dismiss_button: 'بعداً',
  icon_color_dark: '',
  icon_color_light: '',
};

// eventId: pass explicitly from inside an unstable_cache-wrapped call site --
// see lib/getActiveFont.js for why.
export async function getPushPrompt(eventId) {
  try {
    eventId = eventId ?? await getCurrentEventId();
    const { rows } = await query(
      "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'push_prompt'",
      [eventId]
    );
    if (!rows[0]?.value) return DEFAULT;
    return { ...DEFAULT, ...rows[0].value };
  } catch {
    return DEFAULT;
  }
}
