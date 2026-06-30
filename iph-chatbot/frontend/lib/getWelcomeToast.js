import 'server-only';
import { query } from './db';

const DEFAULT = { enabled: true, template: 'خوش آمدید، {name}!' };

export async function getWelcomeToast() {
  try {
    const { rows } = await query("SELECT value FROM app_settings WHERE key = 'welcome_toast'");
    if (!rows[0]?.value) return DEFAULT;
    return { ...DEFAULT, ...rows[0].value };
  } catch {
    return DEFAULT;
  }
}
